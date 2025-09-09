Dog NFT Minter (Tact)

Files
- `contracts/dog_nft.tact`: Minimal Dog NFT minter (admin-only minting)

Prerequisites
- Node 18+
- Tact compiler (`npm i -g @tact-lang/compiler`) or use the official Tact Docker image.

Compile
- `tact compile contracts/dog_nft.tact`
  - Outputs compiled .fc and .cell artifacts in `./build` (depending on your Tact setup).

Deploy
- Use your preferred TON tool (e.g., Tact Blueprint, ton-cli, or wallets supporting deployment).
- Pass constructor arg `owner` as the server wallet address used by this API (the wallet with `TON_MNEMONIC`).
- After deploy, set the env var `DOGG_NFT_COLLECTION_ADDRESS=<deployed_address>` in `.env`.

Mint Flow
- The server sends an internal message with op `0x4D494E54` ("MINT") to the minter with:
  - `newOwner` = destination owner address
  - `metadata` = JSON string (name, image, breed, attributes[])
- The contract assigns the next token id, stores `(owner, metadata)`, and increments the counter.

Reading On-Chain
- `get_next_id() -> uint64`
- `get_token(id:uint64) -> (owner:Address, metadata:String)`

Notes
- This is a simplified contract for demos. For production NFTs, consider a TIP-4 compliant collection + item contracts or extend this minter to support transfers, burn, royalties, etc.

