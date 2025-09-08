import crypto from 'crypto';
import { config } from './config.js';

export function verifyHmacSignature(rawBody, signatureHex) {
  if (!config.hmacSecret) return false;
  if (!signatureHex || typeof signatureHex !== 'string') return false;
  const h = crypto.createHmac('sha256', config.hmacSecret);
  h.update(rawBody);
  const expected = h.digest('hex');
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signatureHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

export function isFreshTimestamp(tsMillis, skewSec) {
  const now = Date.now();
  const skew = skewSec * 1000;
  return Math.abs(now - Number(tsMillis)) <= skew;
}

