#!/usr/bin/env node

import { Command } from 'commander';
import { registerConfigCommand } from './commands/config';
import { registerTiersCommand } from './commands/tiers';
import { registerRoundsCommand } from './commands/rounds';
import { registerJoinCommand } from './commands/join';
import { registerStatusCommand } from './commands/status';
import { registerMeCommand } from './commands/me';
import { registerBalanceCommand } from './commands/balance';
import { registerLeaderboardCommand } from './commands/leaderboard';
import { registerReferralCommand } from './commands/referral';
import { registerClaimCommand } from './commands/claim';
import { registerKeygenCommand } from './commands/keygen';
import { registerProfileCommand } from './commands/profile';
import { registerResultsCommand } from './commands/results';

const program = new Command();

program
  .name('playorbs')
  .description('CLI for interacting with the PlayOrbs Solana program')
  .version('0.1.0')
  .option('--devnet', 'Use devnet configuration');

registerConfigCommand(program);
registerTiersCommand(program);
registerRoundsCommand(program);
registerJoinCommand(program);
registerStatusCommand(program);
registerMeCommand(program);
registerBalanceCommand(program);
registerLeaderboardCommand(program);
registerReferralCommand(program);
registerClaimCommand(program);
registerKeygenCommand(program);
registerProfileCommand(program);
registerResultsCommand(program);

program.parse(process.argv);
