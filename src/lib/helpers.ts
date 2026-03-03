import type { Command } from 'commander';
import type { Network } from './config';

/**
 * Convert SDK RoundStatus union type to a human-readable string.
 * RoundStatus = { open: {} } | { countdown: { startTs: BN } } | { settled: {} }
 */
export function roundStatusToString(status: any): string {
  if ('open' in status) return 'open';
  if ('countdown' in status) return 'countdown';
  if ('settled' in status) return 'settled';
  return 'unknown';
}

/**
 * Extract --devnet flag from the root command's options.
 * Walks up the full parent chain to find the root.
 */
export function getNetwork(cmd: Command): Network | undefined {
  let root = cmd;
  while (root.parent) root = root.parent;
  const rootOpts = root.opts();
  return rootOpts.devnet ? 'devnet' : undefined;
}
