import { Command } from 'commander';
import { PublicKey } from '@solana/web3.js';
import { createSdkReadonly, createIcpModule } from '../lib/sdk';
import { output, outputError, type OutputOptions } from '../lib/output';
import { loadConfig } from '../lib/config';
import { getNetwork } from '../lib/helpers';

export function registerResultsCommand(program: Command): void {
  program
    .command('results')
    .description('Get round results (placements, payouts, kills)')
    .requiredOption('--round <id>', 'Round ID')
    .option('--tier <id>', 'Tier ID')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .action(async (opts: OutputOptions & { round: string; tier?: string; rpc?: string }, cmd: Command) => {
      try {
        const network = getNetwork(cmd);
        const config = loadConfig(network);
        const { sdk } = createSdkReadonly({ rpc: opts.rpc, network });
        const icp = createIcpModule(config);

        const roundId = parseInt(opts.round, 10);
        const tierId = opts.tier !== undefined ? parseInt(opts.tier, 10) : config.defaultTier;

        if (isNaN(roundId)) {
          outputError('Invalid round ID', 1, opts);
        }

        // Check round status first
        const round = await sdk.fetch.round(roundId, tierId);
        if (!round) {
          outputError(`Round ${roundId} not found on tier ${tierId}`, 2, opts);
        }

        // Round must be settled to have results
        const statusNum = typeof round.status === 'object' && 'settled' in round.status ? 4 : 
                          typeof round.status === 'number' ? round.status : -1;
        if (statusNum !== 4) {
          outputError(`Round ${roundId} is not settled yet`, 2, opts);
        }

        // Fetch round snapshot from ICP
        const snapshot = await icp.getRoundSnapshot(tierId, roundId);
        if (!snapshot) {
          outputError(`No results found for round ${roundId}`, 2, opts);
        }

        // Sort players by placement
        const players = [...snapshot.players].sort((a, b) => a.placement - b.placement);

        // Fetch nicknames for players
        const pubkeys = players.map(p => new PublicKey(p.player));
        const nicknames = await sdk.fetch.nicknames(pubkeys);

        const results = players.map((p, i) => {
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
          output({ roundId, tierId, results }, opts);
        } else {
          output(`Round #${roundId} Results (Tier ${tierId})`, opts);
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
        outputError(err.message || 'Failed to fetch round results', 1, opts);
      }
    });
}
