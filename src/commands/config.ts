import { Command } from 'commander';
import { loadConfig, saveConfig, getConfigPath, NETWORK_PRESETS, type CliConfig, type Network } from '../lib/config';
import { output, outputError, type OutputOptions } from '../lib/output';
import { getNetwork } from '../lib/helpers';

const VALID_KEYS: (keyof CliConfig)[] = [
  'network', 'rpc', 'wallet', 'defaultTier', 'icpCanisterId', 'icpHost', 'matrixWorkerUrl',
];

export function registerConfigCommand(program: Command): void {
  const cmd = program
    .command('config')
    .description('Show or update CLI configuration');

  cmd
    .command('show')
    .description('Show current configuration')
    .option('--json', 'Output as JSON')
    .option('--reveal', 'Show full RPC URL (default: redacted for security)')
    .action((opts: OutputOptions & { reveal?: boolean }, cmd: Command) => {
      const config = loadConfig(getNetwork(cmd));
      
      // Redact RPC URL by default to prevent accidental exposure of private endpoints
      const redactRpc = (url: string | undefined): string => {
        if (!url) return '(not set)';
        if (opts.reveal) return url;
        try {
          const parsed = new URL(url);
          // Show host but redact path/query which may contain API keys
          return `${parsed.protocol}//${parsed.host}/***`;
        } catch {
          return '***';
        }
      };
      
      const displayConfig = {
        ...config,
        rpc: redactRpc(config.rpc),
      };
      
      if (opts.json) {
        output(displayConfig, opts);
      } else {
        output(`Config file: ${getConfigPath()}\n`, opts);
        for (const [key, value] of Object.entries(displayConfig)) {
          process.stdout.write(`  ${key}: ${value}\n`);
        }
        if (!opts.reveal) {
          process.stdout.write('\n  (RPC redacted — use --reveal to show full URL)\n');
        }
      }
    });

  cmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .option('--json', 'Output as JSON')
    .action((key: string, value: string, opts: OutputOptions) => {
      if (!VALID_KEYS.includes(key as keyof CliConfig)) {
        outputError(`Invalid config key: ${key}. Valid keys: ${VALID_KEYS.join(', ')}`, 1, opts);
      }

      let parsed: string | number = value;
      if (key === 'defaultTier') {
        parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
          outputError(`Invalid value for defaultTier: ${value}`, 1, opts);
        }
      }
      if (key === 'network') {
        if (value !== 'mainnet' && value !== 'devnet') {
          outputError(`Invalid network: ${value}. Must be 'mainnet' or 'devnet'`, 1, opts);
        }
        // When switching network, also update RPC/ICP/matrix to preset values
        const preset = NETWORK_PRESETS[value as Network];
        saveConfig({ network: value, rpc: preset.rpc, icpCanisterId: preset.icpCanisterId, icpHost: preset.icpHost, matrixWorkerUrl: preset.matrixWorkerUrl });
        output(opts.json ? { ok: true, key, value } : `Switched to ${value} (all endpoints updated)`, opts);
        return;
      }

      saveConfig({ [key]: parsed });
      output(opts.json ? { ok: true, key, value: parsed } : `Set ${key} = ${parsed}`, opts);
    });
}
