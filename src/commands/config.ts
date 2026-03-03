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
    .action((opts: OutputOptions, cmd: Command) => {
      const config = loadConfig(getNetwork(cmd));
      if (opts.json) {
        output(config, opts);
      } else {
        output(`Config file: ${getConfigPath()}\n`, opts);
        for (const [key, value] of Object.entries(config)) {
          process.stdout.write(`  ${key}: ${value}\n`);
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
