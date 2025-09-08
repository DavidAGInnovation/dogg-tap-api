import Redis from 'ioredis';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';

function makeInMemoryRedis() {
  const store = new Map(); // key -> { val: string, exp?: number(ms) }

  function now() { return Date.now(); }
  function getRec(key) {
    const rec = store.get(key);
    if (!rec) return null;
    if (rec.exp && rec.exp <= now()) { store.delete(key); return null; }
    return rec;
  }
  function get(key) { const r = getRec(key); return r ? r.val : null; }
  function set(key, val) { store.set(key, { val: String(val) }); return 'OK'; }
  function setex(key, ttl, val) { store.set(key, { val: String(val), exp: now() + ttl * 1000 }); return 'OK'; }
  function expire(key, ttl) { const r = getRec(key); if (!r) return 0; r.exp = now() + ttl * 1000; store.set(key, r); return 1; }
  function incr(key) { const v = Number(get(key) || '0') + 1; set(key, String(v)); return v; }
  function ttl(key) { const r = store.get(key); if (!r) return -2; if (!r.exp) return -1; return Math.max(0, Math.floor((r.exp - now()) / 1000)); }
  function ping() { return 'PONG'; }

  function multi() {
    const ops = [];
    return {
      incr: (k) => { ops.push(['incr', k]); return { cmd: 'incr', k }; },
      ttl: (k) => { ops.push(['ttl', k]); return { cmd: 'ttl', k }; },
      exec: async () => {
        const out = [];
        for (const [cmd, k] of ops) {
          if (cmd === 'incr') out.push([null, incr(k)]);
          else if (cmd === 'ttl') out.push([null, ttl(k)]);
        }
        return out;
      }
    };
  }

  async function evalFn(_script, _numKeys, tapsKey, balanceKey, incArg, capArg, ttlArg, awardEveryArg) {
    const current = Number(get(tapsKey) || '0');
    const inc = Number(incArg);
    const cap = Number(capArg);
    const ttlSecs = Number(ttlArg);
    const awardEvery = Number(awardEveryArg);

    let remaining = cap - current; if (remaining < 0) remaining = 0;
    let allowed = inc; if (allowed > remaining) allowed = remaining;
    const newTotal = current + allowed;

    if (allowed > 0) {
      set(tapsKey, String(newTotal));
      if (ttlSecs > 0) expire(tapsKey, ttlSecs);
    }
    const prevAwards = Math.floor(current / awardEvery);
    const newAwards = Math.floor(newTotal / awardEvery);
    const deltaAwards = newAwards - prevAwards;

    let newBalance = Number(get(balanceKey) || '0');
    if (deltaAwards > 0) {
      newBalance = newBalance + deltaAwards;
      set(balanceKey, String(newBalance));
    }
    return [allowed, newTotal, deltaAwards, newBalance];
  }

  return { get, set, setex, expire, incr, ttl, ping, multi, eval: evalFn };
}

let redis;
if (config.useInMemory) {
  console.log('[redis] Using in-memory mock');
  redis = makeInMemoryRedis();
} else {
  redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3, enableAutoPipelining: true });
  redis.on('error', (err) => console.error('[redis] error', err));
}

const luaPath = path.join(process.cwd(), 'lua', 'tap.lua');
export const tapLua = fs.readFileSync(luaPath, 'utf8');
export { redis };
