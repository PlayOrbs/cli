import { Command } from 'commander';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createSdk } from '../lib/sdk';
import { output, outputError, type OutputOptions } from '../lib/output';
import { getNetwork } from '../lib/helpers';

export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Show SOL balance for the configured wallet')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--wallet <path>', 'Wallet keypair path override')
    .action(async (opts: OutputOptions & { rpc?: string; wallet?: string }, cmd: Command) => {
      try {
        const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network: getNetwork(cmd) });
        const pubkey = sdk.provider.publicKey;

        if (!pubkey) {
          outputError('No wallet configured', 1, opts);
        }

        const lamports = await sdk.provider.connection.getBalance(pubkey);
        const sol = lamports / LAMPORTS_PER_SOL;

        const data = {
          pubkey: pubkey.toBase58(),
          lamports,
          sol: sol.toFixed(9),
        };

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Wallet: ${data.pubkey}`, opts);
          output(`  SOL:  ${data.sol}`, opts);
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to fetch balance', 1, opts);
      }
    });
}
