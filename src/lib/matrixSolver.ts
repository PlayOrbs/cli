/**
 * Matrix solver for the pre-round skill game.
 * Computes SP tile positions deterministically from the player seed,
 * then generates the optimal click sequence to collect all points.
 *
 * Pure functions adapted from src/ui/preRound/seededRng.ts — no DOM deps.
 */

// ============================================================================
// Seeded RNG (mulberry32)
// ============================================================================

type SeededRng = () => number;

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

function createSeededRng(seed: number | string): SeededRng {
  let state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;

  return function mulberry32(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createTaggedRng(seed: string | number, tag: string): SeededRng {
  const combinedSeed = `${seed}:${tag}`;
  return createSeededRng(combinedSeed);
}

// ============================================================================
// Tile placement & shuffle
// ============================================================================

function generatePointTileIndices(
  rng: SeededRng,
  gridSize: number,
  count: number,
): Set<number> {
  const totalTiles = gridSize * gridSize;
  const indices: number[] = [];
  for (let i = 0; i < totalTiles; i++) {
    indices.push(i);
  }

  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (totalTiles - i));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }

  return new Set(indices.slice(0, count));
}

interface ShuffleStep {
  axis: 'row' | 'col';
  index: number;
  dir: 1 | -1;
}

function generateShufflePlan(
  rng: SeededRng,
  gridSize: number,
  steps: number,
): ShuffleStep[] {
  const plan: ShuffleStep[] = [];
  for (let i = 0; i < steps; i++) {
    const axis: 'row' | 'col' = i % 2 === 0 ? 'row' : 'col';
    const index = Math.floor(rng() * gridSize);
    const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
    plan.push({ axis, index, dir });
  }
  return plan;
}

function slideRow(mapping: number[], gridSize: number, rowIndex: number, dir: 1 | -1): number[] {
  const m = [...mapping];
  const s = rowIndex * gridSize;
  if (dir === 1) {
    const last = m[s + gridSize - 1];
    for (let i = gridSize - 1; i > 0; i--) m[s + i] = m[s + i - 1];
    m[s] = last;
  } else {
    const first = m[s];
    for (let i = 0; i < gridSize - 1; i++) m[s + i] = m[s + i + 1];
    m[s + gridSize - 1] = first;
  }
  return m;
}

function slideCol(mapping: number[], gridSize: number, colIndex: number, dir: 1 | -1): number[] {
  const m = [...mapping];
  if (dir === 1) {
    const last = m[(gridSize - 1) * gridSize + colIndex];
    for (let i = gridSize - 1; i > 0; i--) m[i * gridSize + colIndex] = m[(i - 1) * gridSize + colIndex];
    m[colIndex] = last;
  } else {
    const first = m[colIndex];
    for (let i = 0; i < gridSize - 1; i++) m[i * gridSize + colIndex] = m[(i + 1) * gridSize + colIndex];
    m[(gridSize - 1) * gridSize + colIndex] = first;
  }
  return m;
}

function applyShuffleStep(mapping: number[], gridSize: number, step: ShuffleStep): number[] {
  return step.axis === 'row'
    ? slideRow(mapping, gridSize, step.index, step.dir)
    : slideCol(mapping, gridSize, step.index, step.dir);
}

function createIdentityMapping(gridSize: number): number[] {
  const n = gridSize * gridSize;
  const m: number[] = [];
  for (let i = 0; i < n; i++) m.push(i);
  return m;
}

// ============================================================================
// Solver
// ============================================================================

export interface MatrixConfig {
  gridSize: number;
  pointsTotal: number;
  shuffleAfterPoints: number;
  shuffleSteps: number;
  maxClicks: number;
}

export interface SolverClick {
  logicalIdx: number;
  displayIdx: number;
  isPoint: boolean;
}

export interface SolverResult {
  clicks: SolverClick[];
  earnedSp: number;
  transcript: TranscriptEvent[];
}

export interface TranscriptEvent {
  type: 'collect' | 'miss' | 'reveal' | 'shuffle';
  tMs: number;
  idx?: number;
}

/**
 * Solve the matrix game deterministically from the seed.
 * Returns the optimal click sequence to collect all SP tiles.
 */
export function solveMatrix(seed: string, config: MatrixConfig): SolverResult {
  const { gridSize, pointsTotal, shuffleAfterPoints, shuffleSteps, maxClicks } = config;

  // Generate point positions using same RNG streams as frontend
  const placementRng = createTaggedRng(seed, 'placement');
  const shuffleRng = createTaggedRng(seed, 'shuffle');

  const pointIndices = generatePointTileIndices(placementRng, gridSize, pointsTotal);
  const shufflePlan = generateShufflePlan(shuffleRng, gridSize, shuffleSteps);

  // Start with identity mapping (displayIdx == logicalIdx)
  let boardMapping = createIdentityMapping(gridSize);

  // Build reverse mapping: logicalIdx -> displayIdx
  function reverseMapping(mapping: number[]): Map<number, number> {
    const rev = new Map<number, number>();
    for (let displayIdx = 0; displayIdx < mapping.length; displayIdx++) {
      rev.set(mapping[displayIdx], displayIdx);
    }
    return rev;
  }

  const clicks: SolverClick[] = [];
  const transcript: TranscriptEvent[] = [];
  let earnedSp = 0;
  let tMs = 500; // Start clicking after 500ms (realistic delay)
  let shuffled = false;

  // Click each point tile in order
  const pointList = Array.from(pointIndices);

  for (const logicalIdx of pointList) {
    if (clicks.length >= maxClicks) break;

    // Find where this logical tile is displayed
    const rev = reverseMapping(boardMapping);
    const displayIdx = rev.get(logicalIdx);
    if (displayIdx === undefined) continue;

    clicks.push({ logicalIdx, displayIdx, isPoint: true });
    earnedSp++;
    transcript.push({ type: 'collect', tMs, idx: logicalIdx });
    tMs += 200; // 200ms between clicks (realistic)

    // Trigger shuffle after N points found
    if (!shuffled && earnedSp >= shuffleAfterPoints) {
      shuffled = true;
      for (let step = 0; step < shufflePlan.length; step++) {
        boardMapping = applyShuffleStep(boardMapping, gridSize, shufflePlan[step]);
        transcript.push({ type: 'shuffle', tMs });
        tMs += 900; // ~800ms animation + 100ms pause
      }
    }
  }

  return { clicks, earnedSp, transcript };
}
