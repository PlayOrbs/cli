import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface RoundStats {
  round_id: number;
  tier: number;
  skills: { aggro: number; defense: number; speed: number };
  spawn: { xNorm: number; yNorm: number; rotRad: number };
  placement: number;
  kills: number;
  payout_sol: number;
  timestamp: string;
}

const DEFAULT_STATS_FILE = path.join(os.homedir(), '.config', 'playorbs', 'stats.json');

export function getDefaultStatsPath(): string {
  return DEFAULT_STATS_FILE;
}

export function loadStats(statsFile?: string): RoundStats[] {
  const filePath = statsFile || DEFAULT_STATS_FILE;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function appendStats(stats: RoundStats, statsFile?: string): void {
  const filePath = statsFile || DEFAULT_STATS_FILE;
  const existing = loadStats(filePath);
  existing.push(stats);
  
  // Ensure directory exists
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n');
}

export interface AggregatedStats {
  rounds_played: number;
  wins: number;
  win_rate: number;
  total_earned_sol: number;
  total_kills: number;
  avg_placement: number;
  best_strategy: {
    skills: { aggro: number; defense: number; speed: number };
    wins: number;
    rounds: number;
    win_rate: number;
  } | null;
}

export function aggregateStats(stats: RoundStats[]): AggregatedStats {
  if (stats.length === 0) {
    return {
      rounds_played: 0,
      wins: 0,
      win_rate: 0,
      total_earned_sol: 0,
      total_kills: 0,
      avg_placement: 0,
      best_strategy: null,
    };
  }

  const rounds_played = stats.length;
  const wins = stats.filter(s => s.placement === 1).length;
  const win_rate = rounds_played > 0 ? wins / rounds_played : 0;
  const total_earned_sol = stats.reduce((sum, s) => sum + s.payout_sol, 0);
  const total_kills = stats.reduce((sum, s) => sum + s.kills, 0);
  const avg_placement = stats.reduce((sum, s) => sum + s.placement, 0) / rounds_played;

  // Find best strategy by win rate (group by skill allocation)
  const strategyMap = new Map<string, { wins: number; rounds: number; skills: { aggro: number; defense: number; speed: number } }>();
  
  for (const s of stats) {
    const key = `${s.skills.aggro},${s.skills.defense},${s.skills.speed}`;
    const existing = strategyMap.get(key) || { wins: 0, rounds: 0, skills: s.skills };
    existing.rounds++;
    if (s.placement === 1) existing.wins++;
    strategyMap.set(key, existing);
  }

  let best_strategy: AggregatedStats['best_strategy'] = null;
  let bestWinRate = -1;
  
  for (const [, data] of strategyMap) {
    // Only consider strategies with at least 3 rounds for statistical significance
    if (data.rounds >= 3) {
      const rate = data.wins / data.rounds;
      if (rate > bestWinRate) {
        bestWinRate = rate;
        best_strategy = {
          skills: data.skills,
          wins: data.wins,
          rounds: data.rounds,
          win_rate: rate,
        };
      }
    }
  }

  // If no strategy has 3+ rounds, pick the one with most rounds
  if (!best_strategy && strategyMap.size > 0) {
    let mostRounds = 0;
    for (const [, data] of strategyMap) {
      if (data.rounds > mostRounds) {
        mostRounds = data.rounds;
        best_strategy = {
          skills: data.skills,
          wins: data.wins,
          rounds: data.rounds,
          win_rate: data.rounds > 0 ? data.wins / data.rounds : 0,
        };
      }
    }
  }

  return {
    rounds_played,
    wins,
    win_rate,
    total_earned_sol,
    total_kills,
    avg_placement,
    best_strategy,
  };
}
