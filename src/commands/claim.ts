import { Command } from 'commander';
import { createSdk } from '../lib/sdk';
import { loadKeypair } from '../lib/wallet';
import { loadConfig } from '../lib/config';
import { output, outputError, type OutputOptions } from '../lib/output';
import { getNetwork } from '../lib/helpers';

export function registerClaimCommand(program: Command): void {
  program
    .command('convert-points')
    .description('Convert season points to ORB tokens')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--wallet <path>', 'Wallet keypair path override')
    .option('--season <id>', 'Season ID (default: 0)')
    .action(async (opts: OutputOptions & { rpc?: string; wallet?: string; season?: string }, cmd: Command) => {
      try {
        const network = getNetwork(cmd);
        const config = loadConfig(network);
        const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network });
        const keypair = loadKeypair(opts.wallet || config.wallet);

        const seasonId = opts.season !== undefined ? parseInt(opts.season, 10) : 0;

        if (!opts.json) {
          process.stderr.write(`Converting points for season ${seasonId}...\n`);
        }

        const result = await sdk.convertPoints(keypair, seasonId);

        const data = {
          ok: true,
          signature: result.signature,
          pubkey: keypair.publicKey.toBase58(),
          seasonId,
        };

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Points converted!`, opts);
          output(`  Signature: ${result.signature}`, opts);
          output(`  Season:    ${seasonId}`, opts);
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to convert points', 1, opts);
      }
    });
}
