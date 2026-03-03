import { Command } from 'commander';
import { createSdkReadonly } from '../lib/sdk';
import { output, outputError, outputTable, type OutputOptions } from '../lib/output';
import { roundStatusToString, getNetwork } from '../lib/helpers';

export function registerRoundsCommand(program: Command): void {
  program
    .command('rounds')
    .description('List active rounds')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--tier <id>', 'Filter by tier ID')
    .action(async (opts: OutputOptions & { rpc?: string; tier?: string }, cmd: Command) => {
      try {
        const { sdk, config } = createSdkReadonly({ rpc: opts.rpc, network: getNetwork(cmd) });
        const root = await sdk.fetch.root();

        const tierId = opts.tier !== undefined ? parseInt(opts.tier, 10) : config.defaultTier;
        const tierState = root.tierStates.find((ts: any) => ts.tierId === tierId);

        if (!tierState) {
          outputError(`Tier ${tierId} not found`, 1, opts);
        }

        // Derive next round from lastSettledRoundId
        const lastSettled = Number(tierState.lastSettledRoundId.toString());
        const roundIds: number[] = [];
        for (let id = Math.max(0, lastSettled - 3); id <= lastSettled + 2; id++) {
          roundIds.push(id);
        }

        const rounds: any[] = [];
        for (const roundId of roundIds) {
          try {
            const round = await sdk.fetch.round(roundId, tierId);
            if (round && Number(round.createdTs?.toString() ?? '0') > 0) {
              const statusStr = roundStatusToString(round.status);
              rounds.push({
                roundId,
                tierId,
                status: statusStr,
                joinedCount: round.joinedCount,
                maxPlayers: round.maxPlayers,
                entryLamports: round.entryLamports?.toString() ?? '0',
                entrySol: (Number(round.entryLamports?.toString() ?? '0') / 1_000_000_000).toFixed(4),
                createdTs: round.createdTs?.toString() ?? null,
              });
            }
          } catch {
            // Round may not exist yet
          }
        }

        if (opts.json) {
          output(rounds, opts);
        } else {
          if (rounds.length === 0) {
            output('No active rounds found', opts);
          } else {
            outputTable(
              ['Round', 'Tier', 'Status', 'Players', 'Entry (SOL)'],
              rounds.map((r) => [
                String(r.roundId),
                String(r.tierId),
                r.status,
                `${r.joinedCount}/${r.maxPlayers}`,
                r.entrySol,
              ]),
              opts,
              rounds,
            );
          }
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to fetch rounds', 1, opts);
      }
    });
}
