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
- Tact/FunC contract for Dog NFTs (optional mint on payout)

Quick Start
1) Prereqs: Node 18+, Redis, MySQL.
2) Copy `.env.example` to `.env` and fill in values.
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

Optional NFT mint:
- If request includes `{"mintNft": true, "dog": { name, breed, image, attributes }}` and `DOGG_NFT_COLLECTION_ADDRESS` is set, the server will also mint a Dog NFT to `toAddress` after the TON payout by calling the on-chain minter contract.
- Returns an `nft` field with the mint result.

MySQL Schema
- See `sql/schema.sql` for `users`, `balances`, `tap_daily`, `transactions` (types: `tap_reward`, `payout_ton`, `nft_mint`).

Operational Notes
- Source of truth: Redis is used for fast, atomic gates and counters; MySQL is the durable store.

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

Dog NFTs (Tact Contract)

Overview
- A minimal Tact contract `contracts/dog_nft.tact` that lets an admin wallet mint Dog NFTs with off-chain JSON metadata. Contract enforces admin-only minting: only messages from the configured `owner` address are accepted for `OP_MINT`.
- Not a full TIP-4 implementation. It records owner and metadata per tokenId and exposes get-methods.

Storage
- `owner`: admin address authorized to mint
- `nextId`: uint64 token counter
- `tokens`: map tokenId -> { owner, metadata }

Message ABI (internal)
- OP_MINT: `0x4D494E54` ("MINT")
- Body: `uint32 op | uint64 query_id | address newOwner | ref(metadataCell)`
- `metadataCell` stores JSON string via `storeStringTail` (example below).

Get Methods
- `get_next_id() -> uint64`
- `get_token(id:uint64) -> (owner:Address, metadata:Cell)` where `metadata` is a cell containing the UTF‑8 JSON string

Compile & Deploy (Tact)
- Install Tact CLI: `npm i -g @tact-lang/compiler` (or see Tact docs)
- Compile: `tact compile contracts/dog_nft.tact`
- Deploy: Use your preferred TON tool (e.g., blueprint, ton-cli). Set the contract init param `owner` to your server wallet address (the same wallet used by the API). Save the deployed address to `.env` as `DOGG_NFT_COLLECTION_ADDRESS`.

Server Integration
- Env: set `DOGG_NFT_COLLECTION_ADDRESS` to the deployed minter address.
- The API constructs the mint message as described and sends ~0.05 TON for gas to the minter from the server wallet.

Request Example
```
POST /payout/ton
Headers:
  Content-Type: application/json
  X-Signature: <hex hmac>
Body:
{
  "userId": 123,
  "toAddress": "EQC...",
  "mintNft": true,
  "dog": {
    "name": "Buddy",
    "breed": "Shiba Inu",
    "image": "ipfs://.../buddy.png",
    "attributes": [
      { "trait_type": "Cuteness", "value": 10 },
      { "trait_type": "Speed", "value": 7 }
    ]
  }
}
```

Response Example
```
{
  "ok": true,
  "dryRun": false,
  "txHash": "<payout_tx>",
  "nft": { "ok": true, "txHash": "<mint_tx>" }
}
```

Metadata Encoding
- Server encodes the dog metadata as JSON and stores it in a cell using `storeStringTail`. The contract stores this cell per token. Clients can read the cell from `get_token` and decode as a UTF‑8 string off-chain.

Notes & Limitations
- This is a simple, educational NFT minter. It does not support transfers or TIP-4 index/royalties. For production NFTs, consider using full TIP-4/TIP-64 implementations or extend this contract.

Verify On-Chain State
- Script: `scripts/verify_nft.js`
- Usage:
  - `TON_ENDPOINT_URL=... TON_API_KEY=... DOGG_NFT_COLLECTION_ADDRESS=EQ... node scripts/verify_nft.js`
  - Or specify an ID and address: `node scripts/verify_nft.js --id 0 --address EQ...`
- Output:

Mint And Verify
- Script: `scripts/mint_and_verify_nft.js`
- Danger: This sends a real mint transaction. Ensure your server wallet has funds and you are on the intended network.
- Required env: `TON_ENDPOINT_URL`, `TON_MNEMONIC`, `DOGG_NFT_COLLECTION_ADDRESS` (and `TON_API_KEY` if the endpoint requires it)
- Example:
  - `TON_ENDPOINT_URL=... TON_API_KEY=... TON_MNEMONIC="word1 ... word24" DOGG_NFT_COLLECTION_ADDRESS=EQ... \
     node scripts/mint_and_verify_nft.js --to EQ... --name "Buddy" --breed "Shiba" --image ipfs://... \
     --attributes '[{"trait_type":"Cuteness","value":10}]' --amountTon 0.05 --confirm`
- Behavior:
  - Reads `get_next_id`, sends a mint message to the minter with your metadata, then polls `get_token(id)` until it appears or times out.
  - Prints `nextId`
  - If `--id` provided, prints token owner and metadata JSON directly (decoded from the cell). If decoding fails, prints the metadata cell BOC in base64.
