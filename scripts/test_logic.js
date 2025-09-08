// Logic-level test of tap Lua via in-memory Redis
import { redis, tapLua } from '../src/redis.js';
import { config } from '../src/config.js';

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

async function main() {
  const userId = 202;
  const day = yyyymmdd();
  const tapsKey = `tap:${userId}:${day}`;
  const balanceKey = `balance:dogg:${userId}`;
  const ttl = secondsUntilUtcMidnight();

  console.log('Config:', { dailyCap: config.rules.dailyCap, awardEvery: config.rules.awardEvery });

  const r1 = await redis.eval(tapLua, 2, tapsKey, balanceKey, 7, config.rules.dailyCap, ttl, config.rules.awardEvery);
  console.log('After 7 taps:', r1);

  const r2 = await redis.eval(tapLua, 2, tapsKey, balanceKey, 6, config.rules.dailyCap, ttl, config.rules.awardEvery);
  console.log('After +6 taps:', r2);

  const r3 = await redis.eval(tapLua, 2, tapsKey, balanceKey, 200, config.rules.dailyCap, ttl, config.rules.awardEvery);
  console.log('After +200 taps (cap enforcement):', r3);
}

main().catch((e) => { console.error(e); process.exit(1); });

