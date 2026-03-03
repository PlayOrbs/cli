import { Command } from 'commander';
import { Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createSdk, createMatrixModule } from '../lib/sdk';
import { loadKeypair } from '../lib/wallet';
import { loadConfig } from '../lib/config';
import { output, outputError, EXIT_CODES, type OutputOptions } from '../lib/output';
import { getNetwork } from '../lib/helpers';
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
    .option('--alloc <strategy>', 'Skill allocation: even, aggro, defense, speed (default: even)')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Simulate without broadcasting')
    .action(async (opts: OutputOptions & {
      round?: string;
      tier?: string;
      tp?: string;
      referrer?: string;
      wallet?: string;
      rpc?: string;
      alloc?: string;
      dryRun?: boolean;
    }, cmd: Command) => {
      try {
        const network = getNetwork(cmd);
        const config = loadConfig(network);
        const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network });
        const matrix = createMatrixModule(config);
        const keypair = loadKeypair(opts.wallet || config.wallet);

        const tierId = opts.tier !== undefined ? parseInt(opts.tier, 10) : config.defaultTier;
        const tpPreset = opts.tp !== undefined ? parseInt(opts.tp, 10) : 2;

        let roundId: number;
        if (opts.round !== undefined) {
          roundId = parseInt(opts.round, 10);
          if (isNaN(roundId)) {
            outputError('Invalid round ID', EXIT_CODES.ERROR, opts);
          }
        } else {
          if (!opts.json) {
            process.stderr.write('Auto-detecting next joinable round...\n');
          }
          roundId = await sdk.getNextRoundId(tierId);
          if (!opts.json) {
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
        const minRequired = entryLamports + 0.003 * LAMPORTS_PER_SOL; // entry + rent/fees buffer

        if (lamports < minRequired) {
          outputError(
            `Insufficient balance: ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (need ~${(minRequired / LAMPORTS_PER_SOL).toFixed(4)} SOL)`,
            EXIT_CODES.INSUFFICIENT_BALANCE,
            opts,
          );
        }

        const pubkeyBase58 = keypair.publicKey.toBase58();

        // Step 1: Authenticate with Matrix Worker
        if (!opts.json) {
          process.stderr.write('Authenticating with Matrix Worker...\n');
        }
        await matrix.authenticateWithKeypair(keypair.secretKey, pubkeyBase58);

        // Step 2: Start matrix session
        if (!opts.json) {
          process.stderr.write('Starting matrix session...\n');
        }
        const startResponse = await matrix.startMatrix({
          roundId: String(roundId),
          tierId,
          tpPreset,
        });

        // Step 3: Solve matrix
        if (!opts.json) {
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

        // Record click events with the server
        for (const click of solution.clicks) {
          await matrix.recordEvent({
            roundId: String(roundId),
            kind: 'click',
            displayIdx: click.logicalIdx,
          });
          // Small delay between clicks for realism
          await new Promise(resolve => setTimeout(resolve, 150));
        }

        if (!opts.json) {
          process.stderr.write(`Solved matrix: earned ${solution.earnedSp} SP\n`);
        }

        // Step 4: Allocate skills
        const allocStrategy = opts.alloc || 'even';
        const allocation = allocateSkills(solution.earnedSp, allocStrategy, matrixConfig.pointsTotal);

        // Step 5: Generate spawn position
        const spawn = generateRandomSpawn(roundId);

        // Step 6: Submit to Matrix Worker
        if (!opts.json) {
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
        if (!opts.json) {
          process.stderr.write('Signing transaction...\n');
        }
        const txBuffer = Buffer.from(submitResponse.joinTxBase64, 'base64');
        const tx = Transaction.from(txBuffer);
        tx.partialSign(keypair);

        // Step 8: Broadcast via Matrix Worker
        if (!opts.json) {
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

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Joined Round #${roundId} (Tier ${tierId})`, opts);
          output(`  Signature: ${broadcastResponse.signature}`, opts);
          output(`  TP Preset: ${tpPreset}`, opts);
          output(`  Earned SP: ${solution.earnedSp}`, opts);
          output(`  Allocation: aggro=${allocation.splitAggro} defense=${allocation.tetherRes} speed=${allocation.power}`, opts);
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
      }
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
