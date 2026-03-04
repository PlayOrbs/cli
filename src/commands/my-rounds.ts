import { Command } from 'commander';
import { createSdk } from '../lib/sdk';
import { loadKeypair } from '../lib/wallet';
import { output, outputError, type OutputOptions } from '../lib/output';
import { loadConfig } from '../lib/config';
import { getNetwork, roundStatusToString } from '../lib/helpers';

export function registerMyRoundsCommand(program: Command): void {
  program
    .command('my-rounds')
    .description('List rounds you have joined (pending settlement)')
    .option('--tier <id>', 'Tier ID')
    .option('--all', 'Show all rounds including settled')
    .option('--limit <n>', 'Number of recent rounds to check (default: 20)')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--wallet <path>', 'Wallet keypair path override')
    .action(async (opts: OutputOptions & { tier?: string; all?: boolean; limit?: string; rpc?: string; wallet?: string }, cmd: Command) => {
      try {
        const network = getNetwork(cmd);
        const config = loadConfig(network);
        const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network });
        const keypair = loadKeypair(opts.wallet || config.wallet);

        const tierId = opts.tier !== undefined ? parseInt(opts.tier, 10) : config.defaultTier;
        const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
        const showAll = opts.all || false;

        const playerPubkey = keypair.publicKey;

        // Get tier state to find recent rounds
        const root = await sdk.fetch.root();
        const tierConfig = root.tierConfigs[tierId];
        if (!tierConfig) {
          outputError(`Tier ${tierId} not found`, 1, opts);
        }

        // Check recent rounds for player participation
        const myRounds: Array<{
          roundId: number;
          tierId: number;
          status: string;
          joinedCount: number;
          maxPlayers: number;
        }> = [];

        // Get current round ID from root tier states (reuse root from above)
        const tierState = root.tierStates.find(ts => ts.tierId === tierId);
        const currentRoundId = tierState ? tierState.lastSettledRoundId.toNumber() + 5 : 10;

        // Check last N rounds
        const startRound = Math.max(0, currentRoundId - limit + 1);
        
        for (let roundId = currentRoundId; roundId >= startRound; roundId--) {
          try {
            const round = await sdk.fetch.round(roundId, tierId);
            if (!round || round.createdTs?.toNumber() === 0) continue;

            // Check if player is in this round
            const playerInRound = await sdk.fetch.roundPlayer(roundId, tierId, playerPubkey);
            if (!playerInRound) continue;

            const statusStr = roundStatusToString(round.status);
            const isSettled = typeof round.status === 'object' && 'settled' in round.status;

            if (!showAll && isSettled) continue;

            myRounds.push({
              roundId,
              tierId,
              status: statusStr,
              joinedCount: round.joinedCount,
              maxPlayers: round.maxPlayers,
            });
          } catch {
            // Round doesn't exist or error fetching, skip
          }
        }

        if (opts.json) {
          output({ rounds: myRounds }, opts);
        } else {
          if (myRounds.length === 0) {
            output('No pending rounds found.', opts);
          } else {
            output('Round  Tier  Status      Players', opts);
            output('─'.repeat(40), opts);
            for (const r of myRounds) {
              const round = r.roundId.toString().padEnd(6);
              const tier = r.tierId.toString().padEnd(5);
              const status = r.status.padEnd(11);
              const players = `${r.joinedCount}/${r.maxPlayers}`;
              output(`${round} ${tier} ${status} ${players}`, opts);
            }
          }
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to fetch rounds', 1, opts);
      }
    });
}
