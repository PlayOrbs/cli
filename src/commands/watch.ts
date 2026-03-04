import { Command } from 'commander';
import { PublicKey } from '@solana/web3.js';
import { createSdkReadonly, createIcpModule } from '../lib/sdk';
import { output, outputError, type OutputOptions } from '../lib/output';
import { loadConfig } from '../lib/config';
import { getNetwork, roundStatusToString } from '../lib/helpers';

export function registerWatchCommand(program: Command): void {
  program
    .command('watch')
    .description('Watch a round until settled, then show results')
    .requiredOption('--round <id>', 'Round ID')
    .option('--tier <id>', 'Tier ID')
    .option('--interval <seconds>', 'Poll interval in seconds (default: 5)')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .action(async (opts: OutputOptions & { round: string; tier?: string; interval?: string; rpc?: string }, cmd: Command) => {
      try {
        const network = getNetwork(cmd);
        const config = loadConfig(network);
        const { sdk } = createSdkReadonly({ rpc: opts.rpc, network });
        const icp = createIcpModule(config);

        const roundId = parseInt(opts.round, 10);
        const tierId = opts.tier !== undefined ? parseInt(opts.tier, 10) : config.defaultTier;
        const intervalSec = opts.interval ? parseInt(opts.interval, 10) : 5;

        if (isNaN(roundId)) {
          outputError('Invalid round ID', 1, opts);
        }

        // Poll until settled
        let settled = false;
        while (!settled) {
          const round = await sdk.fetch.round(roundId, tierId);
          if (!round) {
            outputError(`Round ${roundId} not found on tier ${tierId}`, 2, opts);
          }

          const statusStr = roundStatusToString(round.status);
          const isSettled = typeof round.status === 'object' && 'settled' in round.status;

          if (isSettled) {
            settled = true;
            if (!opts.json) {
              process.stderr.write(`Round #${roundId} settled!\n`);
            }
          } else {
            if (!opts.json) {
              process.stderr.write(`Round #${roundId}: ${statusStr} (${round.joinedCount}/${round.maxPlayers}) - polling...\n`);
            }
            await new Promise(resolve => setTimeout(resolve, intervalSec * 1000));
          }
        }

        // Fetch and display results
        const snapshot = await icp.getRoundSnapshot(tierId, roundId);
        if (!snapshot) {
          outputError(`No results found for round ${roundId}`, 2, opts);
        }

        const players = [...snapshot.players].sort((a, b) => a.placement - b.placement);

        // Fetch nicknames
        const pubkeys = players.map(p => new PublicKey(p.player));
        const nicknames = await sdk.fetch.nicknames(pubkeys);

        const results = players.map(p => {
          const pubkey = new PublicKey(p.player).toBase58();
          const nickname = nicknames.get(pubkey);
          return {
            placement: p.placement,
            player: nickname || pubkey.slice(0, 8) + '...',
            pubkey,
            kills: p.kills,
            payoutLamports: p.payout_lamports.toString(),
            payoutSol: (Number(p.payout_lamports) / 1_000_000_000).toFixed(4),
            orbEarned: (Number(p.orb_earned_atoms) / 1_000_000_000).toFixed(2),
          };
        });

        if (opts.json) {
          output({ roundId, tierId, settled: true, results }, opts);
        } else {
          output(`\nRound #${roundId} Results (Tier ${tierId})`, opts);
          output('', opts);
          output('Place  Player              Kills  Payout (SOL)  ORB', opts);
          output('─'.repeat(55), opts);
          for (const r of results) {
            const place = r.placement.toString().padEnd(6);
            const player = r.player.padEnd(18);
            const kills = r.kills.toString().padEnd(6);
            const payout = r.payoutSol.padStart(12);
            const orb = r.orbEarned.padStart(6);
            output(`${place} ${player} ${kills} ${payout}  ${orb}`, opts);
          }
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to watch round', 1, opts);
      }
    });
}
