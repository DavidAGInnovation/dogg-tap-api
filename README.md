Tap API (Taps, Rewards, TON Payout)

Overview
- POST `/tap`: Atomically counts taps in Redis, enforces a strict daily cap (default 200), and awards 1 $DOGG per N taps (default 10). Persists deltas to MySQL.
- POST `/payout/ton`: Sends 0.01 TON to a user address via TON wallet integration (server-side). Supports `DRY_RUN=true` for development.
- Security: HMAC request signing, timestamp freshness check, idempotency cache, and simple Redis-backed rate limit.

Stack
- Node.js + Express
- Redis (hot path: taps and balances)
- MySQL (system of record: users, daily counters, balances, transactions)
- TON SDK (via `@ton/ton`) for payouts

Quick Start
1) Prereqs: Node 18+, Redis, MySQL.
2) Copy `.env.example` to `.env` and fill values.
3) Create DB and tables:
   - Create database: `CREATE DATABASE tap_api;`
   - Run schema: see `sql/schema.sql`.
4) Install deps: `npm install`.
5) Run: `npm run dev`.

Environment
- `PORT`: API port (default 3000)
- `HMAC_SECRET`: Shared secret for request signing (required for non-dev)
- `REDIS_URL`: e.g., `redis://localhost:6379/0`
- `MYSQL_*`: connection settings
- `DAILY_TAP_CAP`: default 200
- `AWARD_EVERY_N_TAPS`: default 10
- `DRY_RUN`: if `true`, TON payouts do not touch the chain
- `TON_ENDPOINT_URL`, `TON_API_KEY`, `TON_MNEMONIC`, `TON_WALLET_WORKCHAIN`: TON settings

Security Model
- HMAC: The client computes `X-Signature = HMAC_SHA256(HMAC_SECRET, rawBody)` and sends a JSON body with `{ userId, taps, ts, nonce }`. The server validates using the raw request body.
- Freshness: `ts` must be within `±tsSkewSec` (default 120s).
- Idempotency: Optional `Idempotency-Key` header caches and replays the last response for short periods.
- Rate limiting: Basic per-IP limiter (120 req/min) using Redis keys.

Tap Flow (POST /tap)
Request:
```
POST /tap
Headers:
  Content-Type: application/json
  X-Signature: <hex hmac>
  Idempotency-Key: <optional>
Body:
  { "userId": 123, "taps": 7, "ts": 1725750000000, "nonce": "abc123" }
```
Response:
```
{
  "userId": 123,
  "acceptedTaps": 7,
  "tapsToday": 57,
  "newRewards": 0,
  "doggBalance": 5,
  "dailyCap": 200,
  "awardEvery": 10
}
```

Atomicity & Accuracy
- The hot-path logic is a Redis Lua script (`lua/tap.lua`):
  - Caps daily taps at `DAILY_TAP_CAP`.
  - Computes newly awarded $DOGG as `floor(newTaps/awardEvery) - floor(prevTaps/awardEvery)`.
  - Increments a Redis `balance:dogg:{userId}` key by any new reward units.
  - Sets an expiry on the daily taps key to UTC midnight.
- Server then persists deltas to MySQL asynchronously: `tap_daily`, `balances`, and a `transactions` row for rewards.

TON Payouts (POST /payout/ton)
Request:
```
POST /payout/ton
Headers: same security headers
Body: { "userId": 123, "toAddress": "EQC..." }
```
Behavior:
- If `DRY_RUN=true`, returns a fake `txHash` without chain calls.
- Otherwise, uses `@ton/ton` to send 0.01 TON from the server wallet to `toAddress` and records a `transactions` row (type `payout_ton`).

MySQL Schema
- See `sql/schema.sql` for `users`, `balances`, `tap_daily`, `transactions`.

Operational Notes
- Source of truth: Redis is used for fast, atomic gates and counters; MySQL is the durable store. If desired, add a periodic reconciliation job to compact Redis state to MySQL and/or audit for drift.
- Hardening ideas:
  - Add Telegram Mini App initData verification if fronted by Telegram.
  - Move to `rate-limiter-flexible` for advanced limiting strategies.
  - Add per-user anti-abuse heuristics (device fingerprinting, slop detection, velocity checks).
  - Enforce minimal `taps` batch sizes and add jittered client batching (e.g., send every ~1s).

Client HMAC Example (pseudo-code)
```
const body = JSON.stringify({ userId, taps, ts: Date.now(), nonce });
const sig = hex(hmacSHA256(HMAC_SECRET, body));
fetch('/tap', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': sig, 'Idempotency-Key': uuid }, body });
```

Local Development Tips
- Set `DRY_RUN=true` to avoid real TON transfers.
- Use `curl` to validate HMAC and endpoints.
- Use `redis-cli` to inspect keys: `tap:<user>:<yyyymmdd>`, `balance:dogg:<user>`.