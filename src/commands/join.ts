import { Command } from 'commander';
import { Transaction, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createSdk, createMatrixModule, createIcpModule } from '../lib/sdk';
import { appendStats, writeLastRun, type RoundStats } from '../lib/stats';
import { loadKeypair } from '../lib/wallet';
import { loadConfig } from '../lib/config';
import { output, outputError, EXIT_CODES, type OutputOptions } from '../lib/output';
import { getNetwork, roundStatusToString } from '../lib/helpers';
import { solveMatrix, type MatrixConfig } from '../lib/matrixSolver';
import { generateRandomSpawn } from '@orbs-game/sdk';

export function registerJoinCommand(program: Command): void {
  program
    .command('join')
    .description('Join a round (V2 via Matrix Worker)')
    .option('--round <id>', 'Round ID (auto-detects next joinable if omitted)')
    .option('--tier <id>', 'Tier ID (default: from config)')
    .option('--tp <preset>', 'Take-profit preset: 0=off, 1=safe, 2=balanced, 3=fierce, 4=yolo (default: 2)')
    .option('--referrer <pubkey>', 'Referrer public key')
    .option('--wallet <path>', 'Wallet keypair path override')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--alloc <strategy>', 'Skill allocation strategy: even, aggro, defense, speed (default: even)')
    .option('--skills <a,d,s>', 'Exact skill allocation as aggro,defense,speed (e.g. --skills 5,3,2). Overrides --alloc')
    .option('--spawn <xNorm,yNorm[,rotRad]>', 'Spawn position (e.g. --spawn 0.3,-0.5 or --spawn 0.3,-0.5,1.57). Default: random')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Simulate without broadcasting')
    .option('--wait', 'Wait for round to settle and show results')
    .option('--auto', 'Continuous loop: join → wait → results → repeat')
    .option('--auto-delay <seconds>', 'Delay between auto loops (default: 5)')
    .option('--stats-file <path>', 'Path to stats file for tracking results (used with --wait or --auto)')
    .option('--quiet', 'Suppress progress messages on stderr')
    .action(async (opts: OutputOptions & {
      round?: string;
      tier?: string;
      tp?: string;
      referrer?: string;
      wallet?: string;
      rpc?: string;
      alloc?: string;
      skills?: string;
      spawn?: string;
      dryRun?: boolean;
      wait?: boolean;
      auto?: boolean;
      autoDelay?: string;
      statsFile?: string;
      quiet?: boolean;
    }, cmd: Command) => {
      const network = getNetwork(cmd);
      const config = loadConfig(network);
      const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network });
      const matrix = createMatrixModule(config);
      const keypair = loadKeypair(opts.wallet || config.wallet);
      const tierId = opts.tier !== undefined ? parseInt(opts.tier, 10) : config.defaultTier;
      const tpPreset = opts.tp !== undefined ? parseInt(opts.tp, 10) : 2;
      const autoDelayMs = (opts.autoDelay ? parseInt(opts.autoDelay, 10) : 5) * 1000;

      // Main loop for --auto mode
      do {
        try {
          let roundId: number;
          if (opts.round !== undefined && !opts.auto) {
            roundId = parseInt(opts.round, 10);
            if (isNaN(roundId)) {
              outputError('Invalid round ID', EXIT_CODES.ERROR, opts);
            }
          } else {
            if (!opts.json && !opts.quiet) {
              process.stderr.write('Auto-detecting next joinable round...\n');
            }
            roundId = await sdk.getNextRoundId(tierId);
            if (!opts.json && !opts.quiet) {
              process.stderr.write(`Found round #${roundId}\n`);
            }
          }

          // Check balance first
          const lamports = await sdk.provider.connection.getBalance(keypair.publicKey);
          const root = await sdk.fetch.root();
          const tierConfig = root.tierConfigs[tierId];
          if (!tierConfig) {
            outputError(`Tier ${tierId} not found`, EXIT_CODES.ERROR, opts);
          }

          const entryLamports = Number(tierConfig.entryLamports.toString());
          const minRequired = entryLamports + 0.003 * LAMPORTS_PER_SOL;

          if (lamports < minRequired) {
            outputError(
              `Insufficient balance: ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (need ~${(minRequired / LAMPORTS_PER_SOL).toFixed(4)} SOL)`,
              EXIT_CODES.INSUFFICIENT_BALANCE,
              opts,
            );
          }

          const pubkeyBase58 = keypair.publicKey.toBase58();

          // Step 1: Authenticate with Matrix Worker
          if (!opts.json && !opts.quiet) {
            process.stderr.write('Authenticating with Matrix Worker...\n');
          }
          await matrix.authenticateWithKeypair(keypair.secretKey, pubkeyBase58);

          // Step 2: Start matrix session
          if (!opts.json && !opts.quiet) {
            process.stderr.write('Starting matrix session...\n');
          }
          const startResponse = await matrix.startMatrix({
            roundId: String(roundId),
            tierId,
            tpPreset,
          });

          // Step 3: Solve matrix
          if (!opts.json && !opts.quiet) {
            process.stderr.write('Solving matrix...\n');
          }
          const matrixConfig: MatrixConfig = {
            gridSize: startResponse.config.gridSize,
            pointsTotal: startResponse.config.pointsTotal,
            shuffleAfterPoints: startResponse.config.shuffleAfterPoints,
            shuffleSteps: startResponse.config.shuffleSteps,
            maxClicks: startResponse.config.maxClicks,
          };

          const solution = solveMatrix(startResponse.playerSeed, matrixConfig);

          // Get maxPerSkill from server config (fallback to pointsTotal for backwards compat)
          const maxPerSkill = startResponse.config.maxPerSkill ?? matrixConfig.pointsTotal;

          if (!opts.json && !opts.quiet) {
            process.stderr.write(`Solved matrix: earned ${solution.earnedSp} SP\n`);
          }

          // Step 4: Allocate skills (BEFORE recording clicks to avoid wasting click budget on validation failure)
          let allocation: { splitAggro: number; tetherRes: number; power: number };
          if (opts.skills) {
            const parts = opts.skills.split(',').map(Number);
            if (parts.length !== 3 || parts.some(isNaN)) {
              outputError('Invalid --skills format. Use: --skills aggro,defense,speed (e.g. --skills 5,3,2)', EXIT_CODES.ERROR, opts);
            }
            const total = parts[0] + parts[1] + parts[2];
            if (total > solution.earnedSp) {
              outputError(`Skill total (${total}) exceeds earned SP (${solution.earnedSp})`, EXIT_CODES.ERROR, opts);
            }
            // Validate individual skills against maxPerSkill
            if (parts.some(p => p > maxPerSkill)) {
              outputError(`Each skill must be ≤ ${maxPerSkill} (maxPerSkill)`, EXIT_CODES.ERROR, opts);
            }
            allocation = { splitAggro: parts[0], tetherRes: parts[1], power: parts[2] };
          } else {
            const allocStrategy = opts.alloc || 'even';
            allocation = allocateSkills(solution.earnedSp, allocStrategy, maxPerSkill);
          }

          // Record click events with the server (required for earnedSp tracking)
          // Done AFTER validation to avoid wasting click budget if allocation is invalid
          for (const click of solution.clicks) {
            await matrix.recordEvent({
              roundId: String(roundId),
              kind: 'click',
              displayIdx: click.logicalIdx,
            });
          }

          // Step 5: Spawn position
          let spawn;
          if (opts.spawn) {
            const parts = opts.spawn.split(',').map(Number);
            if ((parts.length !== 2 && parts.length !== 3) || parts.some(isNaN)) {
              outputError('Invalid --spawn format. Use: --spawn xNorm,yNorm or --spawn xNorm,yNorm,rotRad', EXIT_CODES.ERROR, opts);
            }
            const [xNorm, yNorm] = parts;
            if (xNorm < -1 || xNorm > 1 || yNorm < -1 || yNorm > 1) {
              outputError('Spawn xNorm and yNorm must be in [-1, 1]', EXIT_CODES.ERROR, opts);
            }
            if (xNorm * xNorm + yNorm * yNorm > 0.81) {
              outputError('Spawn position is outside the arena (must be within 0.9 radius from center)', EXIT_CODES.ERROR, opts);
            }
            const rotRad = parts.length === 3 ? parts[2] : ((roundId * 2654435761) >>> 0) / 4294967296 * 2 * Math.PI;
            spawn = { xNorm, yNorm, rotRad };
          } else {
            spawn = generateRandomSpawn(roundId);
          }

          // Step 6: Submit to Matrix Worker
          if (!opts.json && !opts.quiet) {
            process.stderr.write('Submitting to Matrix Worker...\n');
          }
          const submitResponse = await matrix.submitMatrix({
            roundId: String(roundId),
            tierId,
            transcript: solution.transcript,
            earnedSp: solution.earnedSp,
            allocation: {
              splitAggro: allocation.splitAggro,
              tetherRes: allocation.tetherRes,
              orbPower: allocation.power,
            },
            spawn,
            tpPreset,
            referrer: opts.referrer || undefined,
          });

          if (opts.dryRun) {
            const data = {
              dryRun: true,
              roundId,
              tierId,
              pubkey: pubkeyBase58,
              tpPreset,
              earnedSp: solution.earnedSp,
              allocation,
              spawn,
              verifierPubkey: submitResponse.verifierPubkey,
            };
            output(data, opts);
            return;
          }

          // Step 7: Sign transaction
          if (!opts.json && !opts.quiet) {
            process.stderr.write('Signing transaction...\n');
          }
          const txBuffer = Buffer.from(submitResponse.joinTxBase64, 'base64');
          const tx = Transaction.from(txBuffer);
          tx.partialSign(keypair);

          // Step 8: Broadcast via Matrix Worker
          if (!opts.json && !opts.quiet) {
            process.stderr.write('Broadcasting transaction...\n');
          }
          const signedTxBase64 = Buffer.from(
            tx.serialize({ requireAllSignatures: false }),
          ).toString('base64');

          const broadcastResponse = await matrix.broadcast({
            signedTxBase64,
            roundId: String(roundId),
            tierId,
          });

          const data = {
            ok: true,
            signature: broadcastResponse.signature,
            roundId,
            tierId,
            pubkey: pubkeyBase58,
            tpPreset,
            earnedSp: solution.earnedSp,
            allocation,
          };

          // Write last-run timestamp immediately after successful join.
          // This ensures heartbeat/automation knows a round was joined
          // regardless of whether ICP results come back later.
          try {
            writeLastRun({
              round_id: roundId,
              tier: tierId,
              signature: broadcastResponse.signature,
              timestamp: new Date().toISOString(),
            });
          } catch {
            // Non-fatal — don't block the join flow
          }

          if (!opts.wait && !opts.auto) {
            if (opts.json) {
              output(data, opts);
            } else {
              output(`Joined Round #${roundId} (Tier ${tierId})`, opts);
              output(`  Signature: ${broadcastResponse.signature}`, opts);
              output(`  TP Preset: ${tpPreset}`, opts);
              output(`  Earned SP: ${solution.earnedSp}`, opts);
              output(`  Allocation: aggro=${allocation.splitAggro} defense=${allocation.tetherRes} speed=${allocation.power}`, opts);
            }
          } else {
            // --wait or --auto: poll until settled then show results
            if (!opts.json) {
              output(`Joined Round #${roundId} (Tier ${tierId})`, opts);
              output(`  Signature: ${broadcastResponse.signature}`, opts);
              process.stderr.write('\nWaiting for round to settle...\n');
            }

            const icp = createIcpModule(config);
            let settled = false;
            while (!settled) {
              const round = await sdk.fetch.round(roundId, tierId);
              if (round) {
                const isSettled = typeof round.status === 'object' && 'settled' in round.status;
                if (isSettled) {
                  settled = true;
                } else {
                  const statusStr = roundStatusToString(round.status);
                  if (!opts.json) {
                    process.stderr.write(`  Status: ${statusStr} (${round.joinedCount}/${round.maxPlayers})\r`);
                  }
                  await new Promise(resolve => setTimeout(resolve, 5000));
                }
              } else {
                await new Promise(resolve => setTimeout(resolve, 5000));
              }
            }

            // Fetch and display results (retry a few times as ICP may lag behind chain)
            if (!opts.json && !opts.quiet) {
              process.stderr.write('\nFetching results from ICP...\n');
            }
            let snapshot = null;
            for (let attempt = 0; attempt < 5; attempt++) {
              snapshot = await icp.getRoundSnapshot(tierId, roundId);
              if (snapshot && snapshot.players && snapshot.players.length > 0) break;
              if (!opts.json) {
                process.stderr.write(`  Waiting for results (attempt ${attempt + 1}/5)...\n`);
              }
              await new Promise(resolve => setTimeout(resolve, 3000));
            }

            if (snapshot && snapshot.players && snapshot.players.length > 0) {
              const players = [...snapshot.players].sort((a, b) => a.placement - b.placement);
              const pubkeys = players.map(p => new PublicKey(p.player));
              const nicknames = await sdk.fetch.nicknames(pubkeys);

              const results = players.map(p => {
                const pk = new PublicKey(p.player).toBase58();
                const nickname = nicknames.get(pk);
                return {
                  placement: p.placement,
                  player: nickname || pk.slice(0, 8) + '...',
                  pubkey: pk,
                  kills: p.kills,
                  payoutSol: (Number(p.payout_lamports) / 1_000_000_000).toFixed(4),
                  isMe: pk === pubkeyBase58,
                };
              });

              const myResult = results.find(r => r.isMe);

              // Track stats if we have results for this player
              if (myResult) {
                const statsEntry: RoundStats = {
                  round_id: roundId,
                  tier: tierId,
                  skills: {
                    aggro: allocation.splitAggro,
                    defense: allocation.tetherRes,
                    speed: allocation.power,
                  },
                  spawn,
                  placement: myResult.placement,
                  kills: myResult.kills,
                  payout_sol: parseFloat(myResult.payoutSol),
                  timestamp: new Date().toISOString(),
                };
                try {
                  appendStats(statsEntry, opts.statsFile);
                } catch (err) {
                  if (!opts.json) {
                    process.stderr.write(`Warning: Failed to save stats: ${err}\n`);
                  }
                }
              }

              if (opts.json) {
                output({ ...data, settled: true, results, myResult }, opts);
              } else {
                output(`\nRound #${roundId} Results:`, opts);
                output('Place  Player              Kills  Payout', opts);
                output('─'.repeat(45), opts);
                for (const r of results) {
                  const marker = r.isMe ? ' ←' : '';
                  output(`${r.placement.toString().padEnd(6)} ${r.player.padEnd(18)} ${r.kills.toString().padEnd(6)} ${r.payoutSol}${marker}`, opts);
                }
                if (myResult) {
                  output(`\nYour placement: #${myResult.placement}, Payout: ${myResult.payoutSol} SOL`, opts);
                }
              }
            } else {
              // Save partial stats even without ICP results so the round is recorded
              const partialEntry: RoundStats = {
                round_id: roundId,
                tier: tierId,
                skills: {
                  aggro: allocation.splitAggro,
                  defense: allocation.tetherRes,
                  speed: allocation.power,
                },
                spawn,
                placement: null,
                kills: null,
                payout_sol: null,
                timestamp: new Date().toISOString(),
              };
              try {
                appendStats(partialEntry, opts.statsFile);
              } catch {
                // Non-fatal
              }

              if (opts.json) {
                output({ ...data, settled: true, results: [], myResult: null, error: 'Results not available yet' }, opts);
              } else {
                output(`\nRound #${roundId} settled but results not yet available on ICP.`, opts);
                output(`Run: playorbs results --round ${roundId} --tier ${tierId}`, opts);
              }
            }

            // --auto: continue loop after delay
            if (opts.auto) {
              if (!opts.json) {
                process.stderr.write(`\nWaiting ${autoDelayMs / 1000}s before next round...\n\n`);
              }
              await new Promise(resolve => setTimeout(resolve, autoDelayMs));
            }
          }
        } catch (err: any) {
          const msg = err.message || 'Failed to join round';

          if (msg.includes('already joined') || msg.includes('AlreadyJoined')) {
            outputError(msg, EXIT_CODES.ALREADY_JOINED, opts);
          } else if (msg.includes('round is full') || msg.includes('not available')) {
            outputError(msg, EXIT_CODES.ROUND_UNAVAILABLE, opts);
          } else if (msg.includes('insufficient') || msg.includes('Insufficient')) {
            outputError(msg, EXIT_CODES.INSUFFICIENT_BALANCE, opts);
          } else {
            outputError(msg, EXIT_CODES.ERROR, opts);
          }
          // In auto mode, continue despite errors
          if (opts.auto) {
            if (!opts.json && !opts.quiet) {
              process.stderr.write(`\nError occurred, retrying in ${autoDelayMs / 1000}s...\n\n`);
            }
            await new Promise(resolve => setTimeout(resolve, autoDelayMs));
          }
        }
      } while (opts.auto);
    });
}

function allocateSkills(
  earnedSp: number,
  strategy: string,
  maxPerSkill: number,
): { splitAggro: number; tetherRes: number; power: number } {
  if (earnedSp === 0) {
    return { splitAggro: 0, tetherRes: 0, power: 0 };
  }

  const cap = maxPerSkill;

  switch (strategy) {
    case 'aggro': {
      const aggro = Math.min(earnedSp, cap);
      const remaining = earnedSp - aggro;
      const defense = Math.min(Math.floor(remaining / 2), cap);
      const speed = Math.min(remaining - defense, cap);
      return { splitAggro: aggro, tetherRes: defense, power: speed };
    }
    case 'defense': {
      const defense = Math.min(earnedSp, cap);
      const remaining = earnedSp - defense;
      const aggro = Math.min(Math.floor(remaining / 2), cap);
      const speed = Math.min(remaining - aggro, cap);
      return { splitAggro: aggro, tetherRes: defense, power: speed };
    }
    case 'speed': {
      const speed = Math.min(earnedSp, cap);
      const remaining = earnedSp - speed;
      const aggro = Math.min(Math.floor(remaining / 2), cap);
      const defense = Math.min(remaining - aggro, cap);
      return { splitAggro: aggro, tetherRes: defense, power: speed };
    }
    case 'even':
    default: {
      const perSkill = Math.floor(earnedSp / 3);
      const remainder = earnedSp % 3;
      const aggro = Math.min(perSkill + (remainder > 0 ? 1 : 0), cap);
      const defense = Math.min(perSkill + (remainder > 1 ? 1 : 0), cap);
      const speed = Math.min(perSkill, cap);
      return { splitAggro: aggro, tetherRes: defense, power: speed };
    }
  }
}
