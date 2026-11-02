/**
 * The land opens as its people arrive (GW13). The whole world exists from founding and never changes; what grows
 * is how much of it stands clear of the sea mist. A hamlet sees its own valley. Each milestone of citizens lifts the
 * mist further, and it lifts the way weather would: along the valleys first, over the passes later, across the water
 * last. That order is not authored per kingdom; it is the land's own shape, measured as a climb-weighted walking
 * distance from the town over the baked surface (the same ground and water every viewer downloads).
 *
 * Everything here is a pure function of the founded land (its surface and the town's columns) and the citizen
 * count, so the server, the stream and every browser agree on what is open, and a larger count never closes
 * anything (the cost field is fixed and the budgets only grow).
 */

/** Citizens (claimed homes) at which each stage opens. Stage 0 is the founding valley; the last is the whole land. */
export const GRAND_REVEAL_MILESTONES = Object.freeze([0, 25, 60, 150, 400, 1000, 2500, 5000] as const);
/** Share of the land beyond the town's own ground (dry cells by walking cost) each stage holds clear, before its
 * soft edge. The town's ground is always clear; the last stage is all of it. */
const STAGE_SHARE = [0.04, 0.12, 0.22, 0.34, 0.48, 0.63, 0.8, 1] as const;
export const GRAND_REVEAL_STAGES = GRAND_REVEAL_MILESTONES.length;
/** Columns per reveal cell: 16 half-metre columns, 8 m. A 2560-column land is a 160² field. */
export const GRAND_REVEAL_CELL = 16;

export type GrandRevealKind = 'founding' | 'valley' | 'mere' | 'heights' | 'isle' | 'coast' | 'whole';

/** What a stage opens, in the words the stream and the Chronicle use for it. */
export interface GrandRevealOpening {
  readonly stage: number;
  readonly citizens: number;
  readonly kind: GrandRevealKind;
  /** Share of the land's dry cells this stage newly opened. */
  readonly opened: number;
  readonly line: string;
  /** Where the eye should go: the centre of what opened, in land columns. */
  readonly focus: readonly [number, number];
}

export const GRAND_REVEAL_LINES: Readonly<Record<GrandRevealKind, string>> = Object.freeze({
  founding: 'The kingdom is founded in its own valley; the rest of the land sleeps under the sea mist.',
  valley: 'The sea mist lifts off the next valley.',
  mere: 'The mist draws back, and a mere lies open below the hills.',
  heights: 'The cloud breaks on the high pass.',
  isle: 'Across the water, an outer island comes out of the mist.',
  coast: 'The mist rolls back along the coast.',
  whole: 'The whole land stands clear, from the summit to the sea.',
});

export interface GrandRevealSurface {
  /** Columns per side. */
  readonly size: number;
  readonly seaLevel: number;
  /** Top solid y + 1 per column, half-metre cells. */
  readonly ground: ArrayLike<number>;
  /** Water surface y + 1 per column, 0 where dry. */
  readonly water: ArrayLike<number>;
}

/** The town's own ground in land columns (exclusive max): the founded region with its blend band, always clear. */
export interface GrandRevealHome { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }

export interface GrandRevealField {
  /** Cells per side. */
  readonly cells: number;
  /** Columns per cell. */
  readonly cell: number;
  /** Climb-weighted walking cost from the home ground, per cell; Infinity where unreachable. */
  readonly cost: Float32Array;
  /** 0 dry land, 1 lake or river, 2 sea. */
  readonly kind: Uint8Array;
  /** Mean ground height per cell, in half-metre cells. */
  readonly height: Float32Array;
  /** 1 where the cheapest way there crosses open sea. */
  readonly overSea: Uint8Array;
  /** Cost at which each stage's clear land ends (the last is Infinity). */
  readonly budgets: readonly number[];
  readonly seaLevel: number;
}

/** The stage a kingdom of this many citizens stands at. Never decreases as citizens grow. */
export function grandRevealStage(citizens: number): number {
  if (!Number.isFinite(citizens) || citizens < 0) throw new RangeError('A citizen count is a non-negative number');
  let stage = 0;
  for (let s = 1; s < GRAND_REVEAL_MILESTONES.length; s++) if (citizens >= GRAND_REVEAL_MILESTONES[s]!) stage = s;
  return stage;
}

/** Measure the land once: the cost of reaching every cell from the town. Deterministic and allocation-bounded. */
export function grandRevealField(surface: GrandRevealSurface, home: GrandRevealHome): GrandRevealField {
  const { size, seaLevel, ground, water } = surface, cell = GRAND_REVEAL_CELL;
  if (!Number.isSafeInteger(size) || size <= 0 || size % cell || ground.length !== size * size || water.length !== size * size)
    throw new RangeError('The reveal needs a whole surface in reveal cells');
  if (!(home.x0 < home.x1 && home.z0 < home.z1)) throw new RangeError('The reveal needs the town\'s own ground');
  const cells = size / cell, n = cells * cells;
  const height = new Float32Array(n), kind = new Uint8Array(n);
  for (let cz = 0; cz < cells; cz++) for (let cx = 0; cx < cells; cx++) {
    let sum = 0, sea = 0, wet = 0, samples = 0;
    for (let z = cz * cell + 2; z < (cz + 1) * cell; z += 4) for (let x = cx * cell + 2; x < (cx + 1) * cell; x += 4) {
      const i = x + z * size, g = ground[i]!, w = water[i]!;
      sum += g; samples++;
      if (w > g) { if (w <= seaLevel) sea++; else wet++; }
    }
    const c = cx + cz * cells;
    height[c] = sum / samples;
    kind[c] = sea * 2 > samples ? 2 : (sea + wet) * 3 > samples * 2 ? 1 : 0;
  }
  // Dijkstra over 8-neighbours from every cell of the home ground.
  const cost = new Float32Array(n).fill(Infinity), overSea = new Uint8Array(n), seaRun = new Uint16Array(n);
  const heap = new Int32Array(n * 4), keys = new Float32Array(n * 4);
  let count = 0;
  const push = (c: number, k: number) => {
    let i = count++;
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p]! <= k) break; heap[i] = heap[p]!; keys[i] = keys[p]!; i = p; }
    heap[i] = c; keys[i] = k;
  };
  const pop = () => {
    const top = heap[0]!, key = keys[0]!, last = heap[--count]!, lastKey = keys[count]!;
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= count) break;
      if (child + 1 < count && keys[child + 1]! < keys[child]!) child++;
      if (keys[child]! >= lastKey) break;
      heap[i] = heap[child]!; keys[i] = keys[child]!; i = child;
    }
    heap[i] = last; keys[i] = lastKey;
    return [top, key] as const;
  };
  const hx0 = Math.max(0, Math.floor(home.x0 / cell)), hz0 = Math.max(0, Math.floor(home.z0 / cell));
  const hx1 = Math.min(cells, Math.ceil(home.x1 / cell)), hz1 = Math.min(cells, Math.ceil(home.z1 / cell));
  for (let z = hz0; z < hz1; z++) for (let x = hx0; x < hx1; x++) { const c = x + z * cells; cost[c] = 0; push(c, 0); }
  const metres = cell * 0.5;
  while (count > 0) {
    if (count + 8 > heap.length) throw new RangeError('Reveal queue overflow');
    const [c, key] = pop();
    if (key > cost[c]!) continue;
    const cx = c % cells, cz = (c - cx) / cells;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oz) continue;
      const nx = cx + ox, nz = cz + oz;
      if (nx < 0 || nz < 0 || nx >= cells || nz >= cells) continue;
      const d = nx + nz * cells, run = Math.hypot(ox, oz) * metres;
      // Climbing is dearer than walking, and the high ground dearer still: the mist holds the passes longest.
      const climb = Math.max(0, height[d]! - height[c]!) * 0.5, altitude = Math.max(0, (height[d]! - seaLevel) * 0.5 - 30);
      const over = kind[d] === 2 ? 5 : kind[d] === 1 ? 1.4 : 1;
      const step = run * over + climb * 2.2 + altitude * run * 0.03;
      const next = cost[c]! + step;
      if (next < cost[d]!) {
        cost[d] = next;
        seaRun[d] = kind[d] === 2 ? Math.min(65535, seaRun[c]! + 1) : 0;
        // An island is land reached only after a real sea crossing (two or more open-sea cells, 16 m and up).
        overSea[d] = overSea[c]! || (kind[d] !== 2 && seaRun[c]! >= 2) ? 1 : 0;
        push(d, next);
      }
    }
  }
  // Budgets: each stage holds a share of the dry land clear, by walking cost.
  const dry: number[] = [];
  for (let c = 0; c < n; c++) if (kind[c] !== 2 && cost[c]! > 0 && Number.isFinite(cost[c]!)) dry.push(cost[c]!);
  dry.sort((a, b) => a - b);
  const budgets = STAGE_SHARE.map((share, s) => s === STAGE_SHARE.length - 1 || !dry.length ? Infinity
    : dry[Math.min(dry.length - 1, Math.floor(share * dry.length))]!);
  for (let s = 1; s < budgets.length; s++) if (budgets[s]! < budgets[s - 1]!) budgets[s] = budgets[s - 1]!;
  return { cells, cell, cost, kind, height, overSea, budgets, seaLevel };
}

/**
 * The edge of the open land, as a share of a stage's budget (at least two cells): narrow, so land is either open or
 * under the mist. The renderer feathers the mist itself outward from it (`featherMistMask`), never over open land.
 */
const FEATHER = 0.03;

/**
 * Clearness per cell for a stage: 255 clear, 0 under mist, with a narrow soft edge. Pointwise non-decreasing in `stage`.
 */
export function grandRevealMask(field: GrandRevealField, stage: number): Uint8Array {
  if (!Number.isInteger(stage) || stage < 0 || stage >= GRAND_REVEAL_STAGES) throw new RangeError('Unknown reveal stage');
  const out = new Uint8Array(field.cost.length), budget = field.budgets[stage]!;
  if (!Number.isFinite(budget)) return out.fill(255);
  const edge = Math.max(budget * FEATHER, 16);
  for (let c = 0; c < out.length; c++) {
    const t = (field.cost[c]! - budget) / edge;
    out[c] = t <= 0 ? 255 : t >= 1 ? 0 : Math.round(255 * (1 - t * t * (3 - 2 * t)));
  }
  return out;
}

/** What opening `stage` revealed, judged from the cells it newly cleared. Stage 0 is the founding itself. */
export function grandRevealOpening(field: GrandRevealField, stage: number): GrandRevealOpening {
  const citizens = GRAND_REVEAL_MILESTONES[stage];
  if (citizens === undefined) throw new RangeError('Unknown reveal stage');
  const now = grandRevealMask(field, stage), before = stage > 0 ? grandRevealMask(field, stage - 1) : new Uint8Array(now.length);
  let dry = 0, opened = 0, wet = 0, isle = 0, high = 0, shore = 0, sx = 0, sz = 0, weight = 0;
  for (let c = 0; c < now.length; c++) {
    if (field.kind[c] !== 2) dry++;
    const gained = (now[c]! - before[c]!) / 255;
    if (gained <= 0.5 || field.kind[c] === 2) continue;
    opened++;
    const cx = c % field.cells, cz = (c - cx) / field.cells;
    sx += (cx + 0.5) * field.cell; sz += (cz + 0.5) * field.cell; weight++;
    if (field.kind[c] === 1) wet++;
    if (field.overSea[c]) isle++;
    if ((field.height[c]! - field.seaLevel) * 0.5 > 45) high++;
    if (hasSeaNeighbour(field, c)) shore++;
  }
  const share = dry ? opened / dry : 0;
  const kind: GrandRevealKind = stage === 0 ? 'founding' : stage === GRAND_REVEAL_STAGES - 1 ? 'whole'
    : opened && isle / opened > 0.2 ? 'isle' : opened && wet / opened > 0.08 ? 'mere'
      : opened && high / opened > 0.35 ? 'heights' : opened && shore / opened > 0.3 ? 'coast' : 'valley';
  const focus: readonly [number, number] = weight ? [sx / weight, sz / weight] : [field.cells * field.cell / 2, field.cells * field.cell / 2];
  return { stage, citizens, kind, opened: share, line: GRAND_REVEAL_LINES[kind], focus };
}

function hasSeaNeighbour(field: GrandRevealField, c: number): boolean {
  const cx = c % field.cells, cz = (c - cx) / field.cells;
  for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
    const x = cx + ox, z = cz + oz;
    if (x >= 0 && z >= 0 && x < field.cells && z < field.cells && field.kind[x + z * field.cells] === 2) return true;
  }
  return false;
}
