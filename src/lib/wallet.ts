import * as fs from 'fs';
import { Keypair } from '@solana/web3.js';
import { resolveWalletPath } from './config';

export function loadKeypair(walletPath: string): Keypair {
  const resolved = resolveWalletPath(walletPath);
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Wallet file not found: ${resolved}`);
    }
    throw new Error(`Failed to read wallet file: ${err.message}`);
  }

  let secretKey: Uint8Array;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      secretKey = Uint8Array.from(parsed);
    } else {
      throw new Error('Expected JSON array of bytes');
    }
  } catch (err: any) {
    throw new Error(`Invalid wallet file format: ${err.message}`);
  }

  if (secretKey.length !== 64) {
    throw new Error(`Invalid keypair length: expected 64 bytes, got ${secretKey.length}`);
  }

  return Keypair.fromSecretKey(secretKey);
}
