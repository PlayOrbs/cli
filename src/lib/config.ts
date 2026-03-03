import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type Network = 'mainnet' | 'devnet';

export interface NetworkPreset {
  rpc: string;
  icpCanisterId: string;
  icpHost: string;
  matrixWorkerUrl: string;
}

export const NETWORK_PRESETS: Record<Network, NetworkPreset> = {
  mainnet: {
    rpc: 'https://api.mainnet-beta.solana.com',
    icpCanisterId: 'uy5s7-myaaa-aaaam-qfnua-cai',
    icpHost: 'https://icp-api.io',
    matrixWorkerUrl: 'https://api.playorbs.com/matrix',
  },
  devnet: {
    rpc: 'https://api.devnet.solana.com',
    icpCanisterId: '2lvus-jqaaa-aaaam-qerkq-cai',
    icpHost: 'https://icp-api.io',
    matrixWorkerUrl: 'https://devapi.playorbs.com/matrix',
  },
};

export interface CliConfig {
  network: Network;
  rpc: string;
  wallet: string;
  defaultTier: number;
  icpCanisterId: string;
  icpHost: string;
  matrixWorkerUrl: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'playorbs');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: CliConfig = {
  network: 'mainnet',
  rpc: NETWORK_PRESETS.mainnet.rpc,
  wallet: path.join(os.homedir(), '.config', 'solana', 'id.json'),
  defaultTier: 0,
  icpCanisterId: NETWORK_PRESETS.mainnet.icpCanisterId,
  icpHost: NETWORK_PRESETS.mainnet.icpHost,
  matrixWorkerUrl: NETWORK_PRESETS.mainnet.matrixWorkerUrl,
};

export function loadConfig(networkOverride?: Network): CliConfig {
  let config: CliConfig;
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const saved = JSON.parse(raw);
    config = { ...DEFAULT_CONFIG, ...saved };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }

  // Apply network override (e.g. --devnet flag)
  const network = networkOverride || config.network;
  if (network !== config.network) {
    const preset = NETWORK_PRESETS[network];
    config = {
      ...config,
      network,
      rpc: preset.rpc,
      icpCanisterId: preset.icpCanisterId,
      icpHost: preset.icpHost,
      matrixWorkerUrl: preset.matrixWorkerUrl,
    };
  }

  return config;
}

export function saveConfig(config: Partial<CliConfig>): void {
  const existing = loadConfig();
  const merged = { ...existing, ...config };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n');
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function resolveWalletPath(walletPath: string): string {
  if (walletPath.startsWith('~')) {
    return path.join(os.homedir(), walletPath.slice(1));
  }
  return path.resolve(walletPath);
}
