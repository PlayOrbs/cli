import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { Keypair } from '@solana/web3.js';
import { output, outputError, type OutputOptions } from '../lib/output';

export function registerKeygenCommand(program: Command): void {
  program
    .command('keygen')
    .description('Generate a new Solana wallet keypair')
    .option('--json', 'Output as JSON')
    .option('--outfile <path>', 'Output file path (default: ~/.config/solana/id.json)')
    .option('--force', 'Overwrite existing keypair file')
    .action(async (opts: OutputOptions & { outfile?: string; force?: boolean }) => {
      try {
        const defaultPath = path.join(
          process.env.HOME || process.env.USERPROFILE || '~',
          '.config', 'solana', 'id.json',
        );
        const outfile = opts.outfile || defaultPath;
        const resolved = path.resolve(outfile);

        if (fs.existsSync(resolved) && !opts.force) {
          outputError(
            `File already exists: ${resolved}\nUse --force to overwrite, or --outfile to write elsewhere.`,
            1,
            opts,
          );
        }

        const keypair = Keypair.generate();
        const pubkey = keypair.publicKey.toBase58();

        // Write as JSON array (same format as solana-keygen)
        const dir = path.dirname(resolved);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(resolved, JSON.stringify(Array.from(keypair.secretKey)) + '\n', { mode: 0o600 });

        const data = {
          pubkey,
          outfile: resolved,
        };

        if (opts.json) {
          output(data, opts);
        } else {
          output(`Generated new wallet`, opts);
          output(`  Pubkey:  ${pubkey}`, opts);
          output(`  Saved:   ${resolved}`, opts);
        }
      } catch (err: any) {
        outputError(err.message || 'Failed to generate keypair', 1, opts);
      }
    });
}
