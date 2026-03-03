import { Command } from 'commander';
import { createSdkReadonly } from '../lib/sdk';
import { output, outputError, outputTable, type OutputOptions } from '../lib/output';
import { getNetwork } from '../lib/helpers';

export function registerTiersCommand(program: Command): void {
  program
    .command('tiers')
    .description('List all tier configurations')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .action(async (opts: OutputOptions & { rpc?: string }, cmd: Command) => {
      try {
        const { sdk } = createSdkReadonly({ rpc: opts.rpc, network: getNetwork(cmd) });
        const root = await sdk.fetch.root();

        const tiers = root.tierConfigs.map((tier: any, i: number) => ({
          id: i,
          entryLamports: tier.entryLamports.toString(),
          entrySol: (Number(tier.entryLamports.toString()) / 1_000_000_000).toFixed(4),
          maxPlayers: tier.maxPlayers,
          minPlayers: tier.minPlayers,
          countdownSecs: tier.countdownSecs,
          pointsMultiplier: tier.pointsMultiplier,
        }));

        if (opts.json) {
          output(tiers, opts);
        } else {
          outputTable(
            ['ID', 'Entry (SOL)', 'Min', 'Max', 'Countdown (s)', 'Points Mult'],
            tiers.map((t: any) => [
              String(t.id),
              t.entrySol,
              String(t.minPlayers),
              String(t.maxPlayers),
              String(t.countdownSecs),
              String(t.pointsMultiplier),
            ]),
            opts,
            tiers,
          );
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to fetch tiers', 1, opts);
      }
    });
}
