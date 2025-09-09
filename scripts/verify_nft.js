// Verifies Dog NFT contract state via get-methods using @ton/ton
// Usage:
//   node scripts/verify_nft.js [--id <n>] [--address <EQ...>]
// Env:
//   TON_ENDPOINT_URL (required)
//   TON_API_KEY (optional)
//   DOGG_NFT_COLLECTION_ADDRESS (fallback if --address not provided)

import 'dotenv/config';
import { TonClient, Address } from '@ton/ton';
import { Cell } from '@ton/core';

function parseArgs(argv) {
  const out = { id: null, address: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id' && i + 1 < argv.length) { out.id = BigInt(argv[++i]); continue; }
    if (a === '--address' && i + 1 < argv.length) { out.address = argv[++i]; continue; }
  }
  return out;
}

async function main() {
  const { id, address } = parseArgs(process.argv);
  const endpoint = process.env.TON_ENDPOINT_URL;
  const apiKey = process.env.TON_API_KEY;
  const fallback = process.env.DOGG_NFT_COLLECTION_ADDRESS || process.env.DOGG_NFT_COLLECTION_ADDRESS;
  const addr = address || fallback;
  if (!endpoint) throw new Error('TON_ENDPOINT_URL is required');
  if (!addr) throw new Error('Provide --address or set DOGG_NFT_COLLECTION_ADDRESS');

  const client = new TonClient({ endpoint, apiKey });
  const contract = Address.parse(addr);

  // get_next_id
  const r1 = await client.runMethod(contract, 'get_next_id', []);
  if (r1.exit_code !== 0) throw new Error('get_next_id failed with exit_code ' + r1.exit_code);
  const nextId = r1.stack.readNumber();
  console.log('nextId =', nextId);

  // Optionally fetch a token
  if (id !== null) {
    const r2 = await client.runMethod(contract, 'get_token', [{ type: 'int', value: id }]);
    if (r2.exit_code !== 0) throw new Error('get_token failed with exit_code ' + r2.exit_code);
    const owner = r2.stack.readAddress();
    const mdCell = r2.stack.readCell();
    let metadataText = null;
    try {
      metadataText = mdCell.beginParse().loadStringTail();
    } catch (e) {
      // Fallback: just print BOC if decoding fails
    }
    console.log('token', id.toString(), 'owner =', owner?.toString());
    if (metadataText != null) {
      console.log('metadata json =', metadataText);
    } else {
      console.log('metadata cell boc =', mdCell.toBoc({ idx: false }).toString('base64'));
    }
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
