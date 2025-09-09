// Comprehensive local tests: security, idempotency, caps, payout+nft branches
// Runs with in-memory Redis and MySQL skip, DRY_RUN=true

import request from 'supertest';
import crypto from 'crypto';
import assert from 'assert';
import { app } from '../src/server.js';

function hmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function postJson(api, path, body, secret, extraHeaders = {}) {
  const raw = JSON.stringify(body);
  const req = api
    .post(path)
    .set('Content-Type', 'application/json')
    .set('X-Signature', hmac(secret, raw))
    .send(raw);
  for (const [k, v] of Object.entries(extraHeaders)) req.set(k, v);
  return req;
}

async function main() {
  const secret = process.env.HMAC_SECRET || 'test-secret';
  const api = request(app);

  // 1) Invalid signature
  {
    const raw = JSON.stringify({ userId: 1, taps: 1, ts: Date.now(), nonce: 'x' });
    const r = await api
      .post('/tap')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'deadbeef')
      .send(raw);
    assert.equal(r.status, 401, 'invalid signature should be 401');
  }

  // 2) Stale timestamp
  {
    const r = await postJson(api, '/tap', { userId: 2, taps: 1, ts: Date.now() - 10 * 60_000, nonce: 'old' }, secret);
    assert.equal(r.status, 400, 'stale timestamp should be 400');
    assert.equal(r.body.error, 'stale_timestamp');
  }

  // 3) Idempotency behavior on /tap
  {
    const body = { userId: 3, taps: 5, ts: Date.now(), nonce: 'idem1' };
    const idem = 'tap-idem-1';
    const r1 = await postJson(api, '/tap', body, secret, { 'Idempotency-Key': idem });
    assert.equal(r1.status, 200);
    const r2 = await postJson(api, '/tap', body, secret, { 'Idempotency-Key': idem });
    assert.equal(r2.status, 200);
    assert.equal(r2.headers['idempotent-replay'], 'true');
    assert.deepEqual(r2.body, r1.body, 'idempotent response should match');
  }

  // 4) Cap enforcement with batches (daily cap default 200)
  {
    const userId = 4;
    let totalAccepted = 0;
    for (let i = 0; i < 2; i++) {
      const r = await postJson(api, '/tap', { userId, taps: 100, ts: Date.now(), nonce: 'c' + i }, secret);
      assert.equal(r.status, 200);
      totalAccepted += r.body.acceptedTaps;
    }
    // Third call should accept 0 since cap reached (2 * 100 = 200)
    const r3 = await postJson(api, '/tap', { userId, taps: 100, ts: Date.now(), nonce: 'c2' }, secret);
    assert.equal(r3.status, 200);
    assert.equal(r3.body.acceptedTaps, 0);
    assert.equal(totalAccepted, 200);
  }

  // 5) Payout idempotency
  {
    const body = { userId: 5, toAddress: 'EQPAYOUTIDEM', ts: Date.now(), nonce: 'p1' };
    const idem = 'payout-idem-1';
    const r1 = await postJson(api, '/payout/ton', body, secret, { 'Idempotency-Key': idem });
    assert.equal(r1.status, 200);
    const r2 = await postJson(api, '/payout/ton', body, secret, { 'Idempotency-Key': idem });
    assert.equal(r2.status, 200);
    assert.equal(r2.headers['idempotent-replay'], 'true');
    assert.deepEqual(r2.body, r1.body);
  }

  // 6) Payout + NFT mint: missing collection address -> nft error but payout ok
  {
    const body = {
      userId: 6,
      toAddress: 'EQMISSNFT',
      ts: Date.now(),
      nonce: 'p2',
      mintNft: true,
      dog: { name: 'Doggo', breed: 'Mutt', image: 'ipfs://doggo', attributes: [] }
    };
    const r = await postJson(api, '/payout/ton', body, secret);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.nft && r.body.nft.ok === false, 'NFT mint should fail without collection address');
  }

  // 7) Payout + NFT mint: invalid dog metadata -> 400
  {
    const body = { userId: 7, toAddress: 'EQBADMD', ts: Date.now(), nonce: 'p3', mintNft: true };
    const r = await postJson(api, '/payout/ton', body, secret);
    assert.equal(r.status, 400, 'missing dog metadata should be 400');
    assert.equal(r.body.error, 'invalid_dog_metadata');
  }

  console.log('All tests passed.');
}

main().catch((e) => { console.error('Test failed:', e); process.exit(1); });

