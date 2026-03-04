import { Command } from 'commander';
import { createSdk } from '../lib/sdk';
import { output, outputError, type OutputOptions } from '../lib/output';
import { getNetwork } from '../lib/helpers';

export function registerMeCommand(program: Command): void {
  program
    .command('me')
    .description('Show player stats for the configured wallet')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--wallet <path>', 'Wallet keypair path override')
    .option('--season <id>', 'Season ID (default: 0)')
    .action(async (opts: OutputOptions & { rpc?: string; wallet?: string; season?: string }, cmd: Command) => {
      try {
        const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network: getNetwork(cmd) });
        const pubkey = sdk.provider.publicKey;

        if (!pubkey) {
          outputError('No wallet configured', 1, opts);
        }

        const seasonId = opts.season !== undefined ? parseInt(opts.season, 10) : 0;
        
        let stats;
        try {
          stats = await sdk.getPlayerStats(pubkey, seasonId);
        } catch {
          stats = null;
        }

        // Return zeros if no stats found (new player)
        const data = {
          pubkey: pubkey.toBase58(),
          seasonId,
          roundsPlayed: stats?.roundsPlayed ?? 0,
          wins: stats?.wins ?? 0,
          kills: stats?.kills ?? 0,
          seasonPoints: stats?.seasonPoints?.toString() ?? '0',
          solEarnedLamports: stats?.solEarnedLamports?.toString() ?? '0',
          solEarned: (Number(stats?.solEarnedLamports?.toString() ?? '0') / 1_000_000_000).toFixed(4),
        };

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Player: ${data.pubkey}`, opts);
          output(`  Season:        ${data.seasonId}`, opts);
          output(`  Rounds Played: ${data.roundsPlayed}`, opts);
          output(`  Wins:          ${data.wins}`, opts);
          output(`  Kills:         ${data.kills}`, opts);
          output(`  Season Points: ${data.seasonPoints}`, opts);
          output(`  SOL Earned:    ${data.solEarned}`, opts);
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to fetch player stats', 1, opts);
      }
    });
}
