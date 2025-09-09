// Lightweight TON payout integration (server-side, use with care in prod)
// This implements a DRY_RUN mode to avoid real transfers in local dev.

import { config } from './config.js';

// Lazy import to avoid requiring package in restricted env
async function loadTon() {
  const ton = await import('@ton/ton');
  const core = await import('@ton/core');
  const bip39 = await import('@scure/bip39');
  const { mnemonicToSeedSync } = await import('@scure/bip39');
  const { wordlist } = await import('@scure/bip39/wordlists/english');
  return { ...ton, ...core, bip39, mnemonicToSeedSync, wordlist };
}

export async function sendTon({ toAddress, amountTon = 0.01, comment: commentText = 'DOGG payout' }) {
  if (config.dryRun) {
    return { ok: true, dryRun: true, txHash: 'dryrun_' + Date.now().toString(36) };
  }

  if (!config.ton.mnemonic) {
    throw new Error('TON_MNEMONIC not set');
  }
  const { TonClient, WalletContractV4, internal, toNano, mnemonicToPrivateKey, comment } = await loadTon();

  const client = new TonClient({ endpoint: config.ton.endpointUrl, apiKey: config.ton.apiKey });
  const keyPair = await mnemonicToPrivateKey(config.ton.mnemonic.split(' '));
  const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: config.ton.workchain });
  const walletContract = client.open(wallet);
  const seqno = await walletContract.getSeqno();
  const amount = toNano(amountTon);
  const tx = await walletContract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [internal({ to: toAddress, value: amount, body: comment(commentText) })]
  });
  return { ok: true, txHash: tx }; // Note: library may return a Message; adapt as needed
}

// Mint a Dog NFT by sending an internal message to the DogNftMinter contract
// Body layout matches contracts/dog_nft.tact OP_MINT handler
// - op: 0x4D494E54 ("MINT")
// - query_id: 0
// - address newOwner
// - ref: metadata cell (string JSON)
export async function mintDogNft({ ownerAddress, metadata, amountTon = 0.05 }) {
  if (!config.ton.dogNftContract) throw new Error('DOGG_NFT_COLLECTION_ADDRESS not set');
  if (config.dryRun) {
    return { ok: true, dryRun: true, txHash: 'dryrun_nft_' + Date.now().toString(36) };
  }

  const { TonClient, WalletContractV4, internal, toNano, mnemonicToPrivateKey, beginCell, Address } = await loadTon();

  const client = new TonClient({ endpoint: config.ton.endpointUrl, apiKey: config.ton.apiKey });
  const keyPair = await mnemonicToPrivateKey(config.ton.mnemonic.split(' '));
  const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: config.ton.workchain });
  const walletContract = client.open(wallet);
  const seqno = await walletContract.getSeqno();

  const opMint = 0x4d494e54; // 'MINT'
  const owner = Address.parse(ownerAddress);
  const body = beginCell()
    .storeUint(opMint, 32)
    .storeUint(0, 64)
    .storeAddress(owner)
    .storeRef(beginCell().storeStringTail(typeof metadata === 'string' ? metadata : JSON.stringify(metadata)).endCell())
    .endCell();

  const nftContract = Address.parse(config.ton.dogNftContract);
  const tx = await walletContract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [internal({ to: nftContract, value: toNano(amountTon), body })]
  });
  return { ok: true, txHash: tx };
}
