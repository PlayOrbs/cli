import { Command } from 'commander';
import { createSdk } from '../lib/sdk';
import { loadKeypair } from '../lib/wallet';
import { loadConfig } from '../lib/config';
import { output, outputError, type OutputOptions } from '../lib/output';
import { getNetwork } from '../lib/helpers';

export function registerReferralCommand(program: Command): void {
  program
    .command('claim-referral')
    .description('Claim pending referral rewards')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--wallet <path>', 'Wallet keypair path override')
    .action(async (opts: OutputOptions & { rpc?: string; wallet?: string }, cmd: Command) => {
      try {
        const network = getNetwork(cmd);
        const config = loadConfig(network);
        const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network });
        const keypair = loadKeypair(opts.wallet || config.wallet);

        if (!opts.json) {
          process.stderr.write('Claiming referral rewards...\n');
        }

        const result = await sdk.claimReferralRewards(keypair);

        const data = {
          ok: true,
          signature: result.signature,
          pubkey: keypair.publicKey.toBase58(),
        };

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Referral rewards claimed!`, opts);
          output(`  Signature: ${result.signature}`, opts);
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to claim referral rewards', 1, opts);
      }
    });
}
