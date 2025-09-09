// Mint-and-verify script for Dog NFT Minter
// Sends a mint message to DOGG_NFT_COLLECTION_ADDRESS and then verifies the minted token via get-methods.
//
// Usage (REAL chain action):
//   TON_ENDPOINT_URL=... TON_API_KEY=... TON_MNEMONIC="...24 words..." \
//   DOGG_NFT_COLLECTION_ADDRESS=EQ... node scripts/mint_and_verify_nft.js \
//   --to EQ... --name "Buddy" --breed "Shiba" --image ipfs://... --attributes '[{"trait_type":"Cuteness","value":10}]' \
//   --amountTon 0.05 --confirm
//
// Notes: Requires sufficient TON balance on the wallet derived from TON_MNEMONIC.

import 'dotenv/config';
import { TonClient, WalletContractV4, mnemonicToPrivateKey, Address, internal, toNano } from '@ton/ton';
import { beginCell } from '@ton/core';

function parseArgs(argv) {
  const args = {
    to: null,
    name: 'Dog NFT',
    breed: '',
    image: '',
    attributes: [],
    amountTon: 0.05,
    confirm: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to' && argv[i + 1]) { args.to = argv[++i]; continue; }
    if (a === '--name' && argv[i + 1]) { args.name = argv[++i]; continue; }
    if (a === '--breed' && argv[i + 1]) { args.breed = argv[++i]; continue; }
    if (a === '--image' && argv[i + 1]) { args.image = argv[++i]; continue; }
    if (a === '--attributes' && argv[i + 1]) { try { args.attributes = JSON.parse(argv[++i]); } catch { /* ignore */ } continue; }
    if (a === '--amountTon' && argv[i + 1]) { args.amountTon = parseFloat(argv[++i]); continue; }
    if (a === '--confirm') { args.confirm = true; continue; }
  }
  return args;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const { to, name, breed, image, attributes, amountTon, confirm } = parseArgs(process.argv);
  const endpoint = process.env.TON_ENDPOINT_URL;
  const apiKey = process.env.TON_API_KEY;
  const mnemonic = process.env.TON_MNEMONIC;
  const workchain = Number(process.env.TON_WALLET_WORKCHAIN || 0);
  const minterAddrStr = process.env.DOGG_NFT_COLLECTION_ADDRESS || process.env.DOGG_NFT_COLLECTION_ADDRESS;

  if (!endpoint) throw new Error('TON_ENDPOINT_URL is required');
  if (!mnemonic) throw new Error('TON_MNEMONIC is required');
  if (!minterAddrStr) throw new Error('DOGG_NFT_COLLECTION_ADDRESS is required');
  if (!to) throw new Error('Target owner address is required via --to');
  if (!confirm) throw new Error('Refusing to mint without --confirm');

  const client = new TonClient({ endpoint, apiKey });
  const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '));
  const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain });
  const walletContract = client.open(wallet);

  // Read current nextId
  const minterAddr = Address.parse(minterAddrStr);
  const nextIdRes = await client.runMethod(minterAddr, 'get_next_id', []);
  if (nextIdRes.exit_code !== 0) throw new Error('get_next_id failed with exit_code ' + nextIdRes.exit_code);
  const prevNextId = nextIdRes.stack.readNumber();
  console.log('Current nextId =', prevNextId);

  // Build metadata JSON and body per ABI
  const metadata = { name, breed, image, attributes };
  const opMint = 0x4d494e54; // 'MINT'
  const body = beginCell()
    .storeUint(opMint, 32)
    .storeUint(0, 64)
    .storeAddress(Address.parse(to))
    .storeRef(beginCell().storeStringTail(JSON.stringify(metadata)).endCell())
    .endCell();

  const seqno = await walletContract.getSeqno();
  console.log('Sending mint to', minterAddr.toString(), 'seqno =', seqno, 'amountTon =', amountTon);
  await walletContract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [internal({ to: minterAddr, value: toNano(amountTon), body })]
  });
  console.log('Mint message sent. Waiting for confirmation...');

  // Poll get_token for new id = prevNextId
  const targetId = BigInt(prevNextId); // client.readNumber returns number; cast to BigInt for runMethod param
  const deadline = Date.now() + 120_000; // 2 minutes
  while (Date.now() < deadline) {
    try {
      const r = await client.runMethod(minterAddr, 'get_token', [{ type: 'int', value: targetId }]);
      if (r.exit_code === 0) {
        const owner = r.stack.readAddress();
        const mdCell = r.stack.readCell();
        let metadataText = null;
        try { metadataText = mdCell.beginParse().loadStringTail(); } catch {}
        console.log('Mint confirmed for id', targetId.toString());
        console.log('Owner:', owner?.toString());
        console.log('Metadata:', metadataText ?? mdCell.toBoc({ idx: false }).toString('base64'));
        return;
      }
    } catch {}
    await sleep(3000);
  }
  console.warn('Timed out waiting for token id', targetId.toString(), 'to appear. It may confirm later.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

