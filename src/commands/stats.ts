import { Command } from 'commander';
import { loadStats, aggregateStats, getDefaultStatsPath } from '../lib/stats';
import { output, type OutputOptions } from '../lib/output';

export function registerStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Show local round statistics')
    .option('--stats-file <path>', `Stats file path (default: ${getDefaultStatsPath()})`)
    .option('--json', 'Output as JSON')
    .action((opts: OutputOptions & { statsFile?: string }) => {
      const stats = loadStats(opts.statsFile);
      const aggregated = aggregateStats(stats);

      if (opts.json) {
        output(aggregated, opts);
        return;
      }

      if (aggregated.rounds_played === 0) {
        output('No stats recorded yet.', opts);
        output(`Stats file: ${opts.statsFile || getDefaultStatsPath()}`, opts);
        output('\nUse --wait or --auto with join to track round results.', opts);
        return;
      }

      output('PlayOrbs Local Stats', opts);
      output('═'.repeat(40), opts);
      output(`Rounds Played:   ${aggregated.rounds_played}`, opts);
      output(`Wins:            ${aggregated.wins}`, opts);
      output(`Win Rate:        ${(aggregated.win_rate * 100).toFixed(1)}%`, opts);
      output(`Total Earned:    ${aggregated.total_earned_sol.toFixed(4)} SOL`, opts);
      output(`Total Kills:     ${aggregated.total_kills}`, opts);
      output(`Avg Placement:   ${aggregated.avg_placement.toFixed(1)}`, opts);

      if (aggregated.best_strategy) {
        const s = aggregated.best_strategy;
        output('', opts);
        output('Best Strategy (by win rate):', opts);
        output(`  Skills:    aggro=${s.skills.aggro} defense=${s.skills.defense} speed=${s.skills.speed}`, opts);
        output(`  Record:    ${s.wins}/${s.rounds} (${(s.win_rate * 100).toFixed(1)}%)`, opts);
      }

      output('', opts);
      output(`Stats file: ${opts.statsFile || getDefaultStatsPath()}`, opts);
    });
}
