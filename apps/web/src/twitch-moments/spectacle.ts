import type * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { BannerKit } from './banner';

/**
 * The shared spectacles: cheers and Power-ups in the sky, the Hype Train on its track, and the earned dragon.
 * Authored timings (ms from a beat's start) and the sampled frame shapes the view layers read. Every pose is a
 * pure function of elapsed time, so a beat looks and sounds the same at any render frame interval.
 */

// ---------------------------------------------------------------- the cheer ladder

/** The fixed set of sky reactions a monarch may arrange into a ladder (Twitch.md §6). None wakes the dragon. */
export const SKY_RUNGS = ['spark', 'street-fireworks', 'castle-volley', 'hearthbeast', 'skyfire', 'kites'] as const;
export type SkyRung = typeof SKY_RUNGS[number];
export interface LadderStep { readonly minBits: number; readonly rung: SkyRung }
/** Default ladder, newer Twitch.md §6 table: 1–99 spark, 100 street fireworks, 500 castle volley, 1,000 Hearthbeast, 5,000 Skyfire, 10,000 kites. */
export const DEFAULT_CHEER_LADDER: readonly LadderStep[] = [
  { minBits: 1, rung: 'spark' }, { minBits: 100, rung: 'street-fireworks' }, { minBits: 500, rung: 'castle-volley' },
  { minBits: 1000, rung: 'hearthbeast' }, { minBits: 5000, rung: 'skyfire' }, { minBits: 10000, rung: 'kites' },
];
export const rungFor = (bits: number, ladder: readonly LadderStep[] = DEFAULT_CHEER_LADDER): SkyRung =>
  [...ladder].reverse().find(step => bits >= step.minBits)?.rung ?? ladder[0]!.rung;
/** Rung order, so a merged volley plays its highest contributing rung. */
export const RUNG_RANK: Readonly<Record<SkyRung, number>> = { spark: 0, 'street-fireworks': 1, 'castle-volley': 2, hearthbeast: 3, skyfire: 4, kites: 5 };

/**
 * Authored sky beats. `end` is the whole beat including its quiet close; the named key instants drive both the
 * view and the sound so they never drift apart.
 */
export const SKY_BEAT = {
  /** A single bright mote climbs from the cheerer's roof, hangs, twinkles once and fades. */
  spark: { end: 4600, launch: 250, peak: 1900, twinkle: 2300, fade: [3000, 4200] },
  /** Three shells from the cheerer's street, in the kingdom's colours. */
  'street-fireworks': { end: 7800, launches: [400, 1150, 2000], fuse: 1250, burst: 2600 },
  /** Seven shells off the castle walls in a rising fan; each bursts into an approved channel emote, or the kingdom's own star. */
  'castle-volley': { end: 10400, launches: [300, 700, 1100, 1600, 2100, 2700, 3400], fuse: 1500, burst: 3200 },
  /** The Hearthbeast's low pass: from beyond the far roofs, over the town, out past the near ones. */
  hearthbeast: { end: 11000, enter: 0, overhead: 4800, exit: 9600, call: 900, wings: [1800, 3300, 4800, 6300, 7800] },
  /** The aurora unrolls over the walls; a procession of shells walks the walls; the name is written in sparks. */
  skyfire: { end: 19000, aurora: [0, 3200, 14500, 18200], procession: [2400, 12400], shells: 12, fuse: 1300, burst: 2800, name: [4200, 5400, 11800, 13400] },
  /** A kite rises from every home, the cheerer's leading them; they sway, then drift away on the wind. */
  kites: { end: 19000, rise: [600, 6400], lead: 400, drift: [14200, 18400] },
} as const satisfies Record<SkyRung, { readonly end: number; readonly [key: string]: unknown }>;

/** Power-ups. A celebration is the castle's confetti storm; a gigantified emote floats over the plaza for 20 s. */
export const POWER_UP_BEAT = {
  confetti: { end: 8200, burst: [300, 900, 1500], fall: 6800 },
  balloon: { end: 21500, rise: [0, 1500], drift: [1500, 20000], away: [20000, 21500] },
  bubble: { end: 6000 },
} as const;

/** Coalescing windows for the sky (Twitch.md §6): every beat in a hamlet; a town merges per 10 s, a capital per 20 s. */
export const SKY_MERGE_MS = { hamlet: 0, town: 10_000, capital: 20_000 } as const;
export type KingdomScale = keyof typeof SKY_MERGE_MS;
/** Hard caps for the sky: live beats, names in a ribbon, kites, firework motes. */
export const SKY_LIMITS = { beats: 6, ribbonNames: 5, kites: 64, motes: 2400, balloons: 2 } as const;

// ---------------------------------------------------------------- the Hype Train and the dragon

export const TRAIN_BEAT = {
  /** The train steams onto its track and the streets dress in bunting. */
  arrive: 4200, bunting: [600, 3400] as const,
  /** One lap of the town at the running pace. */
  lapMs: 72_000,
  /** A festival train's top running pace, metres per ms: round a town's long ring it trundles rather than races. */
  topSpeed: 0.0085,
  /** A new carriage couples on: it rolls up behind, bumps and rides. */
  couple: 1800,
  /** After the end: the closing fireworks (below level 3), then the train steams away and the bunting comes down. */
  closing: { fireworks: [400, 4800] as const, away: [5200, 10_200] as const, bunting: [7000, 10_000] as const, end: 10_400 },
  /** Carriages shown: one per level, bounded. */
  carriages: 8,
  /** Names riding in the carriages while the train runs. */
  names: 8,
} as const;

/** Dragon poses by phase. All times are ms into that phase. */
export const DRAGON_BEAT = {
  /** Below level 3 at the train's end: the dragon in the hills lifts its head, breathes smoke and sleeps again. */
  stir: { end: 9000, lift: [600, 2400] as const, breath: 3000, settle: [5200, 7800] as const },
  /** Woken: eyes open, it rises, roars, takes off and climbs to the town's sky. Then it circles until active. */
  summoning: { eyes: 400, rise: [900, 2600] as const, roar: 3000, takeoff: 4400, climb: [4400, 8400] as const, end: 8400 },
  /** Active: it circles the town; every cycle telegraphs a swoop, then a breath; accepted strikes make it flinch. */
  active: { orbitMs: 26_000, cycle: 11_000, swoop: { windup: 1300, strike: 2200, at: 2000 }, breath: { windup: 1600, strike: 2000, at: 7000 }, flinch: 520 },
  /** The crowd won: it reels, spirals down beyond the walls, lands with a dust cloud and bows its head. */
  victory: { reel: [0, 1400] as const, spiral: [1400, 6000] as const, land: 6000, bow: [6800, 8600] as const, end: 13_000 },
  /** Time ran out: it turns, roars once and flies home to the hills. Nothing is lost. */
  retreat: { turn: [0, 1300] as const, roar: 900, away: [1300, 7600] as const, settle: [7600, 9200] as const, end: 9600 },
} as const;

export type DragonForm = 'young' | 'elder' | '10' | '25' | '50' | '100' | 'record' | 'golden';
export const DRAGON_FORMS: readonly DragonForm[] = ['young', 'elder', '10', '25', '50', '100', 'record', 'golden'];

/** The Wyrm Bell rings at the castle before the free dragon wakes; the same battle follows. */
export const WYRM_BELL = { strokes: [0, 900, 1800] as const, end: 3200 } as const;

// ---------------------------------------------------------------- frames

/** Where a sky beat starts: the cheerer's own home, or a public place for an anonymous or homeless cheerer. */
export type SkyOrigin = { readonly kind: 'home'; readonly slot: number } | { readonly kind: 'place'; readonly place: 'market' | 'castle' };

/** An approved emote effect, structurally narrowed from Spec 24's `resolveApprovedEmote(id, 'effect')`. */
export interface ApprovedEffect {
  readonly id: string;
  readonly revision: number;
  readonly origin: 'live' | 'simulated';
  readonly frames: readonly { readonly blueprint: VoxelBlueprint; readonly durationMs: number }[];
  readonly periodMs: number;
}

export interface SkyBeatFrame {
  readonly id: string;
  /** `festival` is the train's closing fireworks over the castle: drawn like a castle volley, credited to nobody. */
  readonly kind: 'cheer' | 'festival' | 'confetti' | 'balloon' | 'bubble';
  /** For a cheer: the merged volley's highest rung; a festival is a castle volley. Null for Power-ups. */
  readonly rung: SkyRung | null;
  /** Ms into the beat. */
  readonly t: number;
  readonly origin: SkyOrigin;
  /** Deterministic variation for this beat (shell colours, kite order, drift). */
  readonly seed: number;
  /** The credited name (or the friend line) and, for a merged volley, a bounded ribbon of the others. */
  readonly name: string;
  readonly ribbon: readonly string[];
  readonly others: number;
  /** Castle volley bursts and balloons: the approved effect, exact revision and origin. Null bursts as the kingdom's star. */
  readonly effect: ApprovedEffect | null;
  /** Bubble dressing: the speaker's home, or null when it has none. */
  readonly bubbleSlot: number | null;
}

export interface TrainFrame {
  readonly key: string;
  /** Ms since the train appeared, which sets its place on the track. */
  readonly t: number;
  readonly state: 'arriving' | 'running' | 'closing';
  /** Ms since the end (for closing), or null while it runs. */
  readonly closingT: number | null;
  readonly level: number;
  /** 0..1 toward the next level: the lead lantern fills. */
  readonly progress: number;
  readonly carriages: number;
  /** Ms since the newest carriage coupled, or null when none is coupling. */
  readonly coupling: number | null;
  readonly golden: boolean;
  readonly treasure: boolean;
  /** Treasure trains at level 2 open the chest: parcels stand ready. */
  readonly treasureOpen: boolean;
  readonly names: readonly string[];
  readonly others: number | null;
  /** Bunting dressing over the streets, 0..1. */
  readonly bunting: number;
  /** True when the train ended below level 3: closing fireworks and a sleeping stir. */
  readonly closingFireworks: boolean;
  readonly endsAt: number;
}

export type DragonPhase = 'stir' | 'summoning' | 'active' | 'victory' | 'retreat';
export interface DragonFrame {
  readonly key: string;
  readonly source: 'hype' | 'wyrm-bell';
  readonly phase: DragonPhase;
  readonly form: DragonForm;
  /** Ms into this phase: the pose clock. */
  readonly t: number;
  /** Ms since the encounter started, for the orbit and telegraph cycle; 0 before it starts. */
  readonly elapsed: number;
  /** 0..1, authoritative. */
  readonly health: number;
  readonly fighters: number;
  readonly strikes: number;
  /** Ms since the latest authoritative strike increase, or null. */
  readonly flinch: number | null;
  /** The telegraphed attack this instant, or null between attacks. */
  readonly telegraph: { readonly kind: 'swoop' | 'breath'; readonly t: number } | null;
  readonly endsAt: number;
}

/** Truthful battle status for an earned train, shown beside it. */
export type BattleStatus = 'sleeping' | 'requested' | 'battle' | 'unavailable' | 'ended';

// ---------------------------------------------------------------- layer hosts

/** Supplied public places. Each can be unavailable; a spectacle never places itself at a guessed address. */
export interface SpectaclePlaces {
  /** The town's sky: its centre on the ground, a radius covering the roofs, and a comfortable ceiling height above it. */
  sky(): { readonly centre: Vec3; readonly radius: number; readonly ceiling: number } | null;
  /** The castle's crown (keep top) and the wall walk the volley and procession launch from. */
  castle(): { readonly crown: Vec3; readonly walls: readonly Vec3[] } | null;
  /** The plaza where balloons float. */
  plaza(): Vec3 | null;
  /** The dragon's lair in the hills beyond the town, and the direction it faces the town from. */
  lair(): { readonly position: Vec3; readonly facing: Vec3 } | null;
  /** The train's closed track around the town, on the ground. */
  track(): readonly Vec3[] | null;
  /** Bunting runs: street polylines at eave height. */
  bunting(): readonly (readonly Vec3[])[];
  /** A home's roof top (spark and kite origin), or null. */
  roof(slot: number): Vec3 | null;
  /** Every home slot that has a roof, in street order (kites rise from each, bounded). */
  homes(): readonly number[];
}

export interface SpectacleLayerHost {
  readonly kit: BannerKit;
  readonly places: SpectaclePlaces;
  /** A mesh of a part prepared up front by `blueprints()`. */
  mesh(blueprint: VoxelBlueprint, offset: THREE.Vector3): THREE.Mesh;
  /** Mesh a runtime blueprint (an approved effect frame); the layer shows nothing until it resolves. */
  meshAsync(blueprint: VoxelBlueprint): Promise<THREE.BufferGeometry>;
  /** The kingdom's crafted voxel material. */
  readonly material: THREE.Material;
}

/** Every layer has the same small lifecycle; each owns only the objects and materials it creates. */
export interface SpectacleLayer<F> {
  blueprints(): readonly VoxelBlueprint[];
  apply(frame: F, atMs: number): void;
  stats(): Readonly<Record<string, number>>;
  dispose(): void;
}

/** Deterministic 0..1 from an integer seed and a salt, shared by every layer. */
export function hash01(seed: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
