// Local ABI roundtrip test for Dog NFT mint message
// Builds the mint body as the server does and decodes it back to fields.

import { beginCell, Address } from '@ton/core';

function buildMintBody({ to, metadata }) {
  const opMint = 0x4d494e54; // 'MINT'
  return beginCell()
    .storeUint(opMint, 32)
    .storeUint(0, 64)
    .storeAddress(Address.parse(to))
    .storeRef(beginCell().storeStringTail(typeof metadata === 'string' ? metadata : JSON.stringify(metadata)).endCell())
    .endCell();
}

function decodeMintBody(cell) {
  const s = cell.beginParse();
  const op = s.loadUintBig(32);
  const q = s.loadUintBig(64);
  const to = s.loadAddress();
  const mdCell = s.loadRef();
  let mdText = null;
  try { mdText = mdCell.beginParse().loadStringTail(); } catch {}
  return { op: Number(op), queryId: Number(q), to, metadata: mdText, metadataCellBase64: mdCell.toBoc({ idx: false }).toString('base64') };
}

function main() {
  // Must be a valid TON address format, fallback to a zero-address format
  const to = process.argv[2] || 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
  const metadata = {
    name: 'Rex',
    breed: 'Border Collie',
    image: 'ipfs://example/rex.png',
    attributes: [{ trait_type: 'Energy', value: 9 }]
  };
  const body = buildMintBody({ to, metadata });
  const parsed = decodeMintBody(body);
  console.log({
    ok: true,
    bodyBocBase64: body.toBoc({ idx: false }).toString('base64'),
    parsed: { op: parsed.op.toString(16), queryId: parsed.queryId, to: parsed.to?.toString(), metadata: parsed.metadata }
  });
  if (parsed.op !== 0x4d494e54) throw new Error('op mismatch');
  if (parsed.queryId !== 0) throw new Error('queryId mismatch');
  if (!parsed.to) throw new Error('to missing');
  if (!parsed.metadata) throw new Error('metadata not decoded');
}

main();
