import { redis } from './redis.js';

// Simple sliding window-ish limiter: max N per windowSec per key
export function ipRateLimiter({ max = 120, windowSec = 60 } = {}) {
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
      const key = `rl:ip:${ip}`;
      const ttl = windowSec;
      const p = redis.multi();
      p.incr(key);
      p.ttl(key);
      const [count, keyTtl] = await p.exec().then((r) => r.map((x) => x[1]));
      if (Number(keyTtl) === -1) await redis.expire(key, ttl);
      if (Number(count) > max) {
        return res.status(429).json({ error: 'rate_limited' });
      }
      next();
    } catch (e) {
      next(); // fail open to avoid false positives, but log
    }
  };
}

