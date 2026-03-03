import { Connection } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { OrbsGameSDK, ICPModule, MatrixModule } from '@orbs-game/sdk';
import { loadConfig, type CliConfig, type Network } from './config';
import { loadKeypair } from './wallet';

export interface SdkContext {
  sdk: OrbsGameSDK;
  config: CliConfig;
}

export interface FullContext extends SdkContext {
  icp: ICPModule;
  matrix: MatrixModule;
}

export function createSdk(overrides?: { rpc?: string; wallet?: string; network?: Network }): SdkContext {
  const config = loadConfig(overrides?.network);
  const rpc = overrides?.rpc || config.rpc;

  const connection = new Connection(rpc, 'confirmed');
  const keypair = loadKeypair(overrides?.wallet || config.wallet);
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  const sdk = new OrbsGameSDK({ provider });

  return { sdk, config };
}

export function createSdkReadonly(overrides?: { rpc?: string; network?: Network }): SdkContext {
  const config = loadConfig(overrides?.network);
  const rpc = overrides?.rpc || config.rpc;

  const connection = new Connection(rpc, 'confirmed');
  // Readonly provider with a dummy wallet — no signing needed
  const provider = new AnchorProvider(
    connection,
    { publicKey: null as any, signTransaction: async (tx: any) => tx, signAllTransactions: async (txs: any) => txs } as any,
    { commitment: 'confirmed' },
  );

  const sdk = new OrbsGameSDK({ provider });

  return { sdk, config };
}

export function createIcpModule(config: CliConfig): ICPModule {
  return new ICPModule({
    canisterId: config.icpCanisterId,
    host: config.icpHost,
  });
}

export function createMatrixModule(config: CliConfig): MatrixModule {
  return new MatrixModule({
    baseUrl: config.matrixWorkerUrl,
  });
}
