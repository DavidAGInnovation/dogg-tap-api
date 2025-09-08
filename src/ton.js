// Lightweight TON payout integration (server-side, use with care in prod)
// This implements a DRY_RUN mode to avoid real transfers in local dev.

import { config } from './config.js';

// Lazy import to avoid requiring package in restricted env
async function loadTon() {
  const mod = await import('@ton/ton');
  const bip39 = await import('@scure/bip39');
  const { mnemonicToSeedSync } = await import('@scure/bip39');
  const { wordlist } = await import('@scure/bip39/wordlists/english');
  return { ...mod, bip39, mnemonicToSeedSync, wordlist };
}

export async function sendTon({ toAddress, amountTon = 0.01, comment = 'DOGG payout' }) {
  if (config.dryRun) {
    return { ok: true, dryRun: true, txHash: 'dryrun_' + Date.now().toString(36) };
  }

  if (!config.ton.mnemonic) {
    throw new Error('TON_MNEMONIC not set');
  }
  const { TonClient, WalletContractV4, internal, toNano, mnemonicToPrivateKey } = await loadTon();

  const client = new TonClient({ endpoint: config.ton.endpointUrl, apiKey: config.ton.apiKey });
  const keyPair = await mnemonicToPrivateKey(config.ton.mnemonic.split(' '));
  const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: config.ton.workchain });
  const walletContract = client.open(wallet);
  const seqno = await walletContract.getSeqno();
  const amount = toNano(amountTon);
  const tx = await walletContract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [internal({ to: toAddress, value: amount, body: comment })]
  });
  return { ok: true, txHash: tx }; // Note: library may return a Message; adapt as needed
}

