import { Command } from 'commander';
import { createSdkReadonly } from '../lib/sdk';
import { output, outputError, type OutputOptions } from '../lib/output';
import { loadConfig } from '../lib/config';
import { roundStatusToString, getNetwork } from '../lib/helpers';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Get round status')
    .requiredOption('--round <id>', 'Round ID')
    .option('--tier <id>', 'Tier ID')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .action(async (opts: OutputOptions & { round: string; tier?: string; rpc?: string }, cmd: Command) => {
      try {
        const network = getNetwork(cmd);
        const config = loadConfig(network);
        const { sdk } = createSdkReadonly({ rpc: opts.rpc, network });

        const roundId = parseInt(opts.round, 10);
        const tierId = opts.tier !== undefined ? parseInt(opts.tier, 10) : config.defaultTier;

        if (isNaN(roundId)) {
          outputError('Invalid round ID', 1, opts);
        }

        const round = await sdk.fetch.round(roundId, tierId);
        if (!round) {
          outputError(`Round ${roundId} not found on tier ${tierId}`, 2, opts);
        }

        const root = await sdk.fetch.root();
        const tierConfig = root.tierConfigs[tierId];

        const statusStr = roundStatusToString(round.status);

        const data = {
          roundId,
          tierId,
          status: statusStr,
          joinedCount: round.joinedCount,
          maxPlayers: round.maxPlayers,
          entryLamports: round.entryLamports?.toString() ?? '0',
          entrySol: (Number(round.entryLamports?.toString() ?? '0') / 1_000_000_000).toFixed(4),
          createdTs: round.createdTs?.toString() ?? null,
          seedHex: round.seedHex ?? null,
        };

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Round #${roundId} (Tier ${tierId})`, opts);
          output(`  Status:   ${data.status}`, opts);
          output(`  Players:  ${data.joinedCount}/${data.maxPlayers}`, opts);
          output(`  Entry:    ${data.entrySol} SOL`, opts);
          if (data.createdTs) {
            output(`  Created:  ${new Date(Number(data.createdTs) * 1000).toISOString()}`, opts);
          }
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to fetch round status', 1, opts);
      }
    });
}
