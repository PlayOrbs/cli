import { Command } from 'commander';
import { PublicKey } from '@solana/web3.js';
import { createSdk } from '../lib/sdk';
import { loadKeypair } from '../lib/wallet';
import { loadConfig } from '../lib/config';
import { output, outputError, type OutputOptions } from '../lib/output';
import { getNetwork } from '../lib/helpers';

export function registerProfileCommand(program: Command): void {
  const cmd = program
    .command('profile')
    .description('Manage player profile, nickname, and referral');

  cmd
    .command('init')
    .description('Initialize your player profile (required before setting nickname or receiving referrals)')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--wallet <path>', 'Wallet keypair path override')
    .action(async (opts: OutputOptions & { rpc?: string; wallet?: string }, subcmd: Command) => {
      try {
        const network = getNetwork(subcmd);
        const config = loadConfig(network);
        const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network });
        const keypair = loadKeypair(opts.wallet || config.wallet);

        if (!opts.json) {
          process.stderr.write('Initializing player profile...\n');
        }

        const result = await sdk.initPlayerProfile(keypair);

        const data = {
          ok: true,
          signature: result.signature,
          pubkey: keypair.publicKey.toBase58(),
        };

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Profile initialized!`, opts);
          output(`  Pubkey:    ${data.pubkey}`, opts);
          output(`  Signature: ${result.signature}`, opts);
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to initialize profile', 1, opts);
      }
    });

  cmd
    .command('nickname <name>')
    .description('Set your nickname (3-20 alphanumeric chars or underscores, costs 0.2 SOL)')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--wallet <path>', 'Wallet keypair path override')
    .action(async (name: string, opts: OutputOptions & { rpc?: string; wallet?: string }, subcmd: Command) => {
      try {
        const network = getNetwork(subcmd);
        const config = loadConfig(network);
        const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network });
        const keypair = loadKeypair(opts.wallet || config.wallet);

        if (!opts.json) {
          process.stderr.write(`Setting nickname to "${name}"...\n`);
        }

        const result = await sdk.setNickname(keypair, name);

        const data = {
          ok: true,
          signature: result.signature,
          pubkey: keypair.publicKey.toBase58(),
          nickname: name,
        };

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Nickname set!`, opts);
          output(`  Nickname:  ${name}`, opts);
          output(`  Signature: ${result.signature}`, opts);
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to set nickname', 1, opts);
      }
    });

  cmd
    .command('refer <referrer>')
    .description('Set your referrer (their pubkey). Both players must have a profile initialized.')
    .option('--json', 'Output as JSON')
    .option('--rpc <url>', 'RPC endpoint override')
    .option('--wallet <path>', 'Wallet keypair path override')
    .action(async (referrer: string, opts: OutputOptions & { rpc?: string; wallet?: string }, subcmd: Command) => {
      try {
        const network = getNetwork(subcmd);
        const config = loadConfig(network);
        const { sdk } = createSdk({ rpc: opts.rpc, wallet: opts.wallet, network });
        const keypair = loadKeypair(opts.wallet || config.wallet);

        let referrerPubkey: PublicKey;
        try {
          referrerPubkey = new PublicKey(referrer);
        } catch {
          outputError(`Invalid referrer pubkey: ${referrer}`, 1, opts);
          return;
        }

        if (!opts.json) {
          process.stderr.write(`Setting referrer to ${referrer}...\n`);
        }

        const result = await sdk.initReferral(keypair, referrerPubkey);

        const data = {
          ok: true,
          signature: result.signature,
          pubkey: keypair.publicKey.toBase58(),
          referrer,
        };

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Referral set!`, opts);
          output(`  Referrer:  ${referrer}`, opts);
          output(`  Signature: ${result.signature}`, opts);
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to set referral', 1, opts);
      }
    });
}
