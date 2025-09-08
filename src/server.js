import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { redis, tapLua } from './redis.js';
import { verifyHmacSignature, isFreshTimestamp } from './security.js';
import { ipRateLimiter } from './rateLimiter.js';
import { ensureUserExists, upsertDailyTaps, upsertBalance, recordTransaction } from './mysql.js';
import { sendTon } from './ton.js';

export const app = express();

// Capture raw body for HMAC verification
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(helmet());
app.use(morgan('tiny'));
app.set('trust proxy', true);
app.use(ipRateLimiter({ max: 120, windowSec: 60 }));

function yyyymmdd(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return Number(`${y}${m}${d}`);
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1, Math.floor((+next - +now) / 1000));
}

async function verifyRequest(req, res) {
  const sig = req.header('X-Signature');
  if (!verifyHmacSignature(req.rawBody || Buffer.from(''), sig)) {
    res.status(401).json({ error: 'invalid_signature' });
    return false;
  }
  const { ts } = req.body || {};
  if (!isFreshTimestamp(ts, config.rules.tsSkewSec)) {
    res.status(400).json({ error: 'stale_timestamp' });
    return false;
  }
  return true;
}

async function handleIdempotency(req, res, next) {
  const idem = req.header('Idempotency-Key');
  if (!idem) return next();
  const userId = req.body?.userId;
  const key = `idem:${userId || 'na'}:${idem}`;
  const cached = await redis.get(key);
  if (cached) {
    res.setHeader('Idempotent-Replay', 'true');
    return res.status(200).json(JSON.parse(cached));
  }
  res.locals.idemKey = key;
  next();
}

app.post('/tap', handleIdempotency, async (req, res) => {
  if (!(await verifyRequest(req, res))) return;
  const { userId, taps, ts, nonce } = req.body || {};
  if (!userId || typeof userId !== 'number') return res.status(400).json({ error: 'invalid_userId' });
  if (!Number.isInteger(taps) || taps < 1 || taps > config.rules.maxBatchTaps) return res.status(400).json({ error: 'invalid_taps' });

  const day = yyyymmdd();
  const tapsKey = `tap:${userId}:${day}`;
  const balanceKey = `balance:dogg:${userId}`;
  const ttl = secondsUntilUtcMidnight();

  try {
    // Ensure user exists for MySQL FK
    await ensureUserExists(userId);

    const result = await redis.eval(
      tapLua,
      2,
      tapsKey,
      balanceKey,
      taps,
      config.rules.dailyCap,
      ttl,
      config.rules.awardEvery
    );

    const [allowed, tapsToday, newRewards, doggBalance] = result.map(Number);

    // Persist deltas in background (best-effort)
    Promise.all([
      allowed > 0 ? upsertDailyTaps(userId, day, allowed) : null,
      newRewards > 0 ? upsertBalance(userId, newRewards) : null,
      newRewards > 0 ? recordTransaction(userId, 'tap_reward', newRewards, null) : null
    ].filter(Boolean)).catch((e) => console.error('[mysql] persist error', e));

    const payload = {
      userId,
      acceptedTaps: allowed,
      tapsToday,
      newRewards, // $DOGG units awarded this call
      doggBalance,
      dailyCap: config.rules.dailyCap,
      awardEvery: config.rules.awardEvery
    };

    if (res.locals.idemKey) {
      // Cache response for short time to ensure idempotency
      await redis.setex(res.locals.idemKey, 120, JSON.stringify(payload));
    }

    return res.json(payload);
  } catch (e) {
    console.error('[tap] error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.post('/payout/ton', handleIdempotency, async (req, res) => {
  if (!(await verifyRequest(req, res))) return;
  const { userId, toAddress } = req.body || {};
  if (!userId || typeof userId !== 'number' || !toAddress || typeof toAddress !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }
  try {
    await ensureUserExists(userId);
    const result = await sendTon({ toAddress, amountTon: 0.01, comment: 'DOGG payout' });
    await recordTransaction(userId, 'payout_ton', 0.01, result.txHash || null);
    const payload = { ok: true, dryRun: !!result.dryRun, txHash: result.txHash || null };
    if (res.locals.idemKey) await redis.setex(res.locals.idemKey, 300, JSON.stringify(payload));
    res.json(payload);
  } catch (e) {
    console.error('[payout] error', e);
    res.status(500).json({ error: 'payout_failed' });
  }
});

app.get('/health', async (req, res) => {
  try {
    await redis.ping();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

if (process.env.START_SERVER !== 'false') {
  app.listen(config.port, () => {
    console.log(`tap-api listening on :${config.port}`);
  });
}
