import { Command } from 'commander';
import { createSdkReadonly } from '../lib/sdk';
import { outputError, type OutputOptions } from '../lib/output';
import { roundStatusToString, getNetwork } from '../lib/helpers';
import { loadConfig } from '../lib/config';

export function registerMonitorCommand(program: Command): void {
  program
    .command('monitor')
    .description('Monitor active rounds and fire a webhook when player threshold is met')
    .option('--tier <id>', 'Tier to monitor (default from config)')
    .option('--min-players <n>', 'Player threshold to trigger alert (default: 3)')
    .option('--interval <seconds>', 'Poll interval in seconds (default: 10)')
    .requiredOption('--hook-url <url>', 'Hook endpoint')
    .option('--hook-token <token>', 'Hook auth token')
    .option('--hook-payload <json>', 'Custom JSON payload (template vars: {{id}}, {{tier}}, {{players}}, {{max}})')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .action(async (opts: OutputOptions & {
      tier?: string;
      minPlayers?: string;
      interval?: string;
      hookUrl: string;
      hookToken?: string;
      hookPayload?: string;
      rpc?: string;
    }, cmd: Command) => {
      try {
        const network = getNetwork(cmd);
        const config = loadConfig(network);
        const { sdk } = createSdkReadonly({ rpc: opts.rpc, network });

        const tierId = opts.tier !== undefined ? parseInt(opts.tier, 10) : config.defaultTier;
        const minPlayers = opts.minPlayers ? parseInt(opts.minPlayers, 10) : 3;
        const intervalSec = opts.interval ? parseInt(opts.interval, 10) : 10;
        const hookUrl = opts.hookUrl;
        const hookToken = opts.hookToken || process.env.OPENCLAW_HOOK_TOKEN || '';
        let hookPayloadTemplate: Record<string, unknown> | undefined;
        if (opts.hookPayload) {
          try {
            hookPayloadTemplate = JSON.parse(opts.hookPayload);
          } catch {
            outputError('Invalid JSON in --hook-payload', 1, opts);
          }
        }

        if (!hookToken) {
          outputError('Hook token required: pass --hook-token or set OPENCLAW_HOOK_TOKEN', 1, opts);
        }

        const alertedRounds = new Set<number>();

        process.stderr.write(
          `Monitoring tier ${tierId} | min-players=${minPlayers} | interval=${intervalSec}s | hook=${hookUrl}\n`,
        );

        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            const root = await sdk.fetch.root();
            const tierState = root.tierStates.find((ts: any) => ts.tierId === tierId);

            if (!tierState) {
              process.stderr.write(`Tier ${tierId} not found, retrying...\n`);
              await sleep(intervalSec * 1000);
              continue;
            }

            const lastSettled = Number(tierState.lastSettledRoundId.toString());
            const roundIds: number[] = [];
            for (let id = lastSettled; id <= lastSettled + 2; id++) {
              roundIds.push(id);
            }

            for (const roundId of roundIds) {
              try {
                const round = await sdk.fetch.round(roundId, tierId);
                if (!round || Number(round.createdTs?.toString() ?? '0') === 0) continue;

                const statusStr = roundStatusToString(round.status);
                const isSettled = typeof round.status === 'object' && 'settled' in round.status;

                // Clear alerted rounds that have settled
                if (isSettled && alertedRounds.has(roundId)) {
                  alertedRounds.delete(roundId);
                  process.stderr.write(`Round #${roundId} settled — cleared from alerts\n`);
                  continue;
                }

                // Check threshold
                if (
                  !isSettled &&
                  round.joinedCount >= minPlayers &&
                  !alertedRounds.has(roundId)
                ) {
                  const text = `🎮 PlayOrbs alert: Round #${roundId} (Tier ${tierId}) has ${round.joinedCount}/${round.maxPlayers} players — time to jump in!`;

                  process.stderr.write(`Alerting: ${text}\n`);

                  const payload = hookPayloadTemplate
                    ? expandTemplate(hookPayloadTemplate, { id: roundId, tier: tierId, players: round.joinedCount, max: round.maxPlayers })
                    : { text, mode: 'now' };

                  const ok = await fireHook(hookUrl, hookToken, payload);
                  if (ok) {
                    alertedRounds.add(roundId);
                    process.stderr.write(`Hook delivered for round #${roundId}\n`);
                  } else {
                    process.stderr.write(`Hook delivery failed for round #${roundId}, will retry next cycle\n`);
                  }
                } else if (!isSettled && !opts.json) {
                  process.stderr.write(
                    `Round #${roundId}: ${statusStr} (${round.joinedCount}/${round.maxPlayers})${alertedRounds.has(roundId) ? ' [alerted]' : ''}\n`,
                  );
                }
              } catch {
                // Round may not exist yet
              }
            }
          } catch (err: any) {
            process.stderr.write(`Poll error: ${err.message}\n`);
          }

          await sleep(intervalSec * 1000);
        }
      } catch (err: any) {
        outputError(err.message || 'Monitor failed', 1, opts);
      }
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function expandTemplate(obj: unknown, vars: Record<string, string | number>): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{(id|tier|players|max)\}\}/g, (_, key) => String(vars[key]));
  }
  if (Array.isArray(obj)) return obj.map(v => expandTemplate(v, vars));
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = expandTemplate(v, vars);
    return out;
  }
  return obj;
}

async function fireHook(url: string, token: string, payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err: any) {
    process.stderr.write(`Hook request error: ${err.message}\n`);
    return false;
  }
}
