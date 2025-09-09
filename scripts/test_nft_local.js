// Local smoke test: payout + NFT mint in DRY_RUN using in-memory services

import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/server.js';

function hmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function main() {
  const secret = process.env.HMAC_SECRET || 'test-secret';
  const api = request(app);

  const userId = 202;
  const base = { userId, ts: Date.now(), nonce: 'nft-1' };

  // quick warm-up tap
  const tapBody = JSON.stringify({ ...base, taps: 5 });
  await api
    .post('/tap')
    .set('Content-Type', 'application/json')
    .set('X-Signature', hmac(secret, tapBody))
    .set('Idempotency-Key', 'idem-nft-tap')
    .send(tapBody);

  // payout + mintNft
  const reqBody = JSON.stringify({
    userId,
    toAddress: 'EQDUMMYOWNERADDRESS',
    ts: Date.now(),
    nonce: 'payout-nft-1',
    mintNft: true,
    dog: {
      name: 'Rex',
      breed: 'Border Collie',
      image: 'ipfs://example/rex.png',
      attributes: [
        { trait_type: 'Energy', value: 9 },
        { trait_type: 'Intelligence', value: 10 }
      ]
    }
  });

  const res = await api
    .post('/payout/ton')
    .set('Content-Type', 'application/json')
    .set('X-Signature', hmac(secret, reqBody))
    .set('Idempotency-Key', 'idem-nft-1')
    .send(reqBody);

  console.log('Payout+Mint response:', { status: res.status, body: res.body });

  if (res.status !== 200) throw new Error('Request failed');
  if (!res.body.ok) throw new Error('Payout not ok');
  if (!res.body.nft || !res.body.nft.ok) throw new Error('NFT mint not ok');
}

main().catch((e) => { console.error(e); process.exit(1); });

