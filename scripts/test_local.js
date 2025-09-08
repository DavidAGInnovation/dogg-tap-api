// Local smoke test without external Redis/MySQL
// Uses USE_INMEMORY=true and SKIP_MYSQL=true

import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/server.js';

function hmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function main() {
  const secret = process.env.HMAC_SECRET || 'test-secret';
  const api = request(app);

  const userId = 101;
  const base = { userId, ts: Date.now(), nonce: 'n1' };

  console.log('Tap #1: 7 taps');
  const body1 = JSON.stringify({ ...base, taps: 7 });
  let r1 = await api
    .post('/tap')
    .set('Content-Type', 'application/json')
    .set('X-Signature', hmac(secret, body1))
    .set('Idempotency-Key', 'idem-1')
    .send(body1);
  console.log({ status: r1.status, body: r1.body });

  console.log('Tap #2: 6 taps');
  const body2 = JSON.stringify({ ...base, ts: Date.now(), taps: 6 });
  let r2 = await api
    .post('/tap')
    .set('Content-Type', 'application/json')
    .set('X-Signature', hmac(secret, body2))
    .set('Idempotency-Key', 'idem-2')
    .send(body2);
  console.log({ status: r2.status, body: r2.body });

  console.log('Payout 0.01 TON (dry run)');
  const body3 = JSON.stringify({ userId, toAddress: 'EQDUMMYADDRESS', ts: Date.now(), nonce: 'p1' });
  let p1 = await api
    .post('/payout/ton')
    .set('Content-Type', 'application/json')
    .set('X-Signature', hmac(secret, body3))
    .set('Idempotency-Key', 'idem-3')
    .send(body3);
  console.log({ status: p1.status, body: p1.body });
}

main().catch((e) => { console.error(e); process.exit(1); });
