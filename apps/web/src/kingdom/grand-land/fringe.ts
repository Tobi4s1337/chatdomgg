import type { Vec3 } from '@chatdom/shared';
import type { StyleFamily, TreeSite } from '../trees';

/**
 * The woods that come up to the town.
 *
 * The grand land keeps its own forest out of the kingdom's reserve, a band half the seat's blend width beyond the
 * physical region, so from the stream the town stood on a cleared meadow with the forest held back from it. These
 * trees close that band: groves stand right up to the edge of the walkable town and run out to meet the land's own
 * forest, with clearings between them so a walker at the edge of town still sees the ranges and the water through
 * the trees. Every trunk stands outside the physical region (unknown space is solid there, so a tree needs no
 * collider), and no crown may lean more than a step over the town's edge.
 *
 * Pure: a function of the region, the visual land and the kingdom's seed, so every screen grows the same woods.
 */
export interface FringeInput {
  /** The installed physical region in world metres; nothing of the fringe stands inside it. */
  readonly region: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /** Visual ground height, or null beyond the land. */
  readonly height: (x: number, z: number) => number | null;
  /** Water surface over a point, or null where it is dry. */
  readonly water: (x: number, z: number) => number | null;
  readonly seaLevel: number;
  readonly seed: string;
  readonly style: StyleFamily;
}

/** The band the fringe fills, in metres outside the region: from just past the edge to where the land's forest begins. */
export const FRINGE_NEAR = 2.5, FRINGE_FAR = 22;
/** Grid pitch of candidate trunks and the most trees the fringe may grow. */
const PITCH = 4.6, MAX_TREES = 720;
/** A crown may reach this far past its trunk's distance from the town. */
const OVERHANG = 1.5;

function hash(seed: string, ...parts: number[]): number {
  let h = 2166136261;
  const text = `${seed}:fringe:${parts.join(':')}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise on a coarse lattice: where the groves stand and where the clearings open. */
function groves(seed: string, x: number, z: number, scale: number): number {
  const gx = x / scale, gz = z / scale, x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
  const s = (t: number) => t * t * (3 - 2 * t), u = s(fx), v = s(fz);
  const a = hash(seed, x0, z0), b = hash(seed, x0 + 1, z0), c = hash(seed, x0, z0 + 1), d = hash(seed, x0 + 1, z0 + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

const smoothstep = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

export function planForestFringe(input: FringeInput): TreeSite[] {
  const { region, seed } = input;
  if (![region.minX, region.maxX, region.minZ, region.maxZ].every(Number.isFinite) || region.minX >= region.maxX || region.minZ >= region.maxZ)
    throw new Error('The forest fringe needs a finite installed region');
  const sites: TreeSite[] = [];
  const x0 = Math.floor((region.minX - FRINGE_FAR) / PITCH), x1 = Math.ceil((region.maxX + FRINGE_FAR) / PITCH);
  const z0 = Math.floor((region.minZ - FRINGE_FAR) / PITCH), z1 = Math.ceil((region.maxZ + FRINGE_FAR) / PITCH);
  for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
    const x = (gx + .15 + .7 * hash(seed, gx, gz, 1)) * PITCH, z = (gz + .15 + .7 * hash(seed, gx, gz, 2)) * PITCH;
    const outside = Math.hypot(Math.max(region.minX - x, 0, x - region.maxX), Math.max(region.minZ - z, 0, z - region.maxZ));
    if (outside < FRINGE_NEAR || outside > FRINGE_FAR) continue;
    // Groves with clearings between them; the first trees at the town's edge stand a little apart.
    const grove = smoothstep(.38, .62, groves(seed, x, z, 34) * .75 + groves(seed, x + 517, z - 211, 11) * .25);
    const density = grove * (.55 + .45 * smoothstep(FRINGE_NEAR, 12, outside));
    if (hash(seed, gx, gz, 3) >= density) continue;
    // Firm, dry, gentle ground above the sea: no trunk on a cliff, in a stream or on the shore.
    let low = Infinity, high = -Infinity, wetNear = false;
    for (const dx of [-1.25, 0, 1.25]) for (const dz of [-1.25, 0, 1.25]) {
      const ground = input.height(x + dx, z + dz);
      if (ground === null) { low = -Infinity; break; }
      low = Math.min(low, ground); high = Math.max(high, ground);
    }
    if (!Number.isFinite(low) || high - low > 2.5 || low < input.seaLevel + .5) continue;
    let shore = Infinity;
    for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [8, 0], [-8, 0], [0, 8], [0, -8]] as const) {
      const ground = input.height(x + dx, z + dz), level = input.water(x + dx, z + dz);
      if (level !== null && ground !== null && level > ground) shore = Math.min(shore, Math.hypot(dx, dz));
    }
    if (shore <= 3) wetNear = true;
    if (wetNear) continue;
    const position: Vec3 = [x, low, z];
    sites.push({ id: `fringe:${gx}:${gz}`, zone: shore <= 8 ? 'water' : 'grove', position, yaw: hash(seed, gx, gz, 4) * Math.PI * 2,
      style: input.style, seed, room: outside + OVERHANG });
  }
  if (sites.length <= MAX_TREES) return sites;
  // Too many: keep the trees nearest the town, which are the ones that read as the woods coming up to it.
  const distance = (site: TreeSite) => Math.hypot(Math.max(region.minX - site.position[0], 0, site.position[0] - region.maxX), Math.max(region.minZ - site.position[2], 0, site.position[2] - region.maxZ));
  return sites.map((site, index) => ({ site, index, d: distance(site) })).sort((a, b) => a.d - b.d || a.index - b.index).slice(0, MAX_TREES)
    .sort((a, b) => a.index - b.index).map(({ site }) => site);
}
