import { Command } from 'commander';
import { PublicKey } from '@solana/web3.js';
import { createSdkReadonly, createIcpModule } from '../lib/sdk';
import { output, outputError, outputTable, type OutputOptions } from '../lib/output';
import { getNetwork } from '../lib/helpers';

const PAGE_SIZE = 50;

export function registerLeaderboardCommand(program: Command): void {
  program
    .command('leaderboard')
    .description('Show top players by season points')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--season <id>', 'Season ID (default: 0)')
    .option('--limit <n>', 'Number of players to show (default: 20)')
    .option('--sort <field>', 'Sort by: points, wins, kills, rounds, earned (default: points)')
    .action(async (opts: OutputOptions & { rpc?: string; season?: string; limit?: string; sort?: string }, cmd: Command) => {
      try {
        const { sdk, config } = createSdkReadonly({ rpc: opts.rpc, network: getNetwork(cmd) });
        const icp = createIcpModule(config);

        const seasonId = opts.season !== undefined ? parseInt(opts.season, 10) : 0;
        const limit = opts.limit !== undefined ? parseInt(opts.limit, 10) : 20;
        const sortField = opts.sort || 'points';

        // Fetch player pubkeys from ICP
        const playerPage = await icp.getPlayers(0, Math.min(limit, PAGE_SIZE));
        const totalPlayers = Number(playerPage.total);

        if (playerPage.players.length === 0) {
          if (opts.json) {
            output({ entries: [], totalPlayers: 0 }, opts);
          } else {
            output('No players found', opts);
          }
          return;
        }

        // Convert to PublicKey objects
        const pubkeys = playerPage.players.map((bytes: Uint8Array) => new PublicKey(bytes));

        // Fetch stats and nicknames in parallel
        const [statsMap, nicknamesMap] = await Promise.all([
          sdk.fetch.playerStatsMultiple(pubkeys, seasonId),
          sdk.fetch.nicknames(pubkeys),
        ]);

        // Build entries
        type Entry = {
          rank: number;
          pubkey: string;
          nickname: string;
          seasonPoints: string;
          roundsPlayed: number;
          wins: number;
          kills: number;
          solEarned: string;
        };

        let entries: Entry[] = pubkeys.map((pubkey: PublicKey, idx: number) => {
          const pubkeyStr = pubkey.toBase58();
          const stats = statsMap.get(pubkeyStr);

          return {
            rank: idx + 1,
            pubkey: pubkeyStr,
            nickname: nicknamesMap.get(pubkeyStr) || '',
            seasonPoints: stats?.seasonPoints?.toString() ?? '0',
            roundsPlayed: stats?.roundsPlayed ?? 0,
            wins: stats?.wins ?? 0,
            kills: stats?.kills ?? 0,
            solEarned: (Number(stats?.solEarnedLamports?.toString() ?? '0') / 1_000_000_000).toFixed(4),
          };
        });

        // Sort
        const sortKey = ({
          points: 'seasonPoints',
          wins: 'wins',
          kills: 'kills',
          rounds: 'roundsPlayed',
          earned: 'solEarned',
        } as Record<string, string>)[sortField] || 'seasonPoints';

        entries.sort((a: any, b: any) => {
          const av = sortKey === 'seasonPoints' || sortKey === 'solEarned'
            ? parseFloat(b[sortKey]) - parseFloat(a[sortKey])
            : b[sortKey] - a[sortKey];
          return av;
        });

        // Re-rank after sort
        entries = entries.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));

        if (opts.json) {
          output({ entries, totalPlayers, seasonId }, opts);
        } else {
          output(`Leaderboard (Season ${seasonId}, ${totalPlayers} total players)\n`, opts);
          outputTable(
            ['#', 'Player', 'Nickname', 'Points', 'Rounds', 'Wins', 'Kills', 'SOL Earned'],
            entries.map((e) => [
              String(e.rank),
              e.pubkey.slice(0, 8) + '...',
              e.nickname || '-',
              e.seasonPoints,
              String(e.roundsPlayed),
              String(e.wins),
              String(e.kills),
              e.solEarned,
            ]),
            opts,
            { entries, totalPlayers, seasonId },
          );
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to fetch leaderboard', 1, opts);
      }
    });
}
