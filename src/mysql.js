import mysql from 'mysql2/promise';
import { config } from './config.js';

let pool;
export function getPool() {
  if (config.mysqlSkip) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      connectionLimit: 10,
      enableKeepAlive: true
    });
  }
  return pool;
}

export async function ensureUserExists(userId) {
  if (config.mysqlSkip) return;
  const p = getPool();
  await p.execute('INSERT IGNORE INTO users (id) VALUES (?)', [userId]);
}

export async function upsertDailyTaps(userId, yyyymmdd, inc) {
  if (config.mysqlSkip) return;
  const p = getPool();
  await p.execute(
    'INSERT INTO tap_daily (user_id, yyyymmdd, taps) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE taps = taps + VALUES(taps)',
    [userId, yyyymmdd, inc]
  );
}

export async function upsertBalance(userId, doggDelta) {
  if (config.mysqlSkip) return;
  const p = getPool();
  await p.execute(
    'INSERT INTO balances (user_id, dogg_balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE dogg_balance = dogg_balance + VALUES(dogg_balance)',
    [userId, doggDelta]
  );
}

export async function recordTransaction(userId, type, amount, chainTxHash = null) {
  if (config.mysqlSkip) return;
  const p = getPool();
  await p.execute(
    'INSERT INTO transactions (user_id, type, amount, chain_tx_hash) VALUES (?, ?, ?, ?)',
    [userId, type, amount, chainTxHash]
  );
}
