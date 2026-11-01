import { MAT } from '@chatdom/content';
import type { Vec3 } from '@chatdom/shared';
import { TOWN_COLOURS, type TownColour } from '@chatdom/shared/twitch-moments';
import type { DoorAnchor, PlaceAnchor } from './gift-view';
import type { SpectacleLayerHost } from './spectacle';

/**
 * The acts that shape the town, as the stream view draws them: a follower's sapling and a planted tree (the grove),
 * a citizen coming home (the relight), the night opening at the gate, the bell, a festival, and the decree board where
 * the town decides together. Authored timings (ms from a beat's start) and the sampled frame the town layers read.
 * Every pose is a pure function of elapsed time; a restored state has no beat and stands as it is.
 */

export { TOWN_COLOURS, type TownColour };

/** Each colour the town can fly, woven in the kingdom's own dyes: the field and the trim. */
export const TOWN_DYES: Readonly<Record<TownColour, { readonly field: number; readonly trim: number; readonly name: string }>> = {
  ember: { field: MAT.fabricRed, trim: MAT.fabricOrange, name: 'Ember' },
  gold: { field: MAT.fabricGold, trim: MAT.cream, name: 'Gold' },
  rose: { field: MAT.petal, trim: MAT.cream, name: 'Rose' },
  tide: { field: MAT.fabricBlue, trim: MAT.cream, name: 'Tide' },
  meadow: { field: MAT.fabricGreen, trim: MAT.fabricGold, name: 'Meadow' },
  dusk: { field: MAT.fabricViolet, trim: MAT.fabricGold, name: 'Dusk' },
  snow: { field: MAT.cream, trim: MAT.fabricBlue, name: 'Snow' },
  night: { field: MAT.hairBlack, trim: MAT.fabricGold, name: 'Night' },
};
/** The colours a town flies before it has ever decreed its own: the kingdom's warm default. */
export const DEFAULT_TOWN_COLOUR: TownColour = 'gold';

/** A poll choice is a colour when its title, trimmed and in any case, is one of the town's colour names. */
export function colourOf(title: string): TownColour | null {
  const key = title.trim().toLowerCase();
  return (TOWN_COLOURS as readonly string[]).includes(key) ? key as TownColour : null;
}

export const TOWN_BEAT = {
  /** A follower's sapling: the soil breaks, the sapling sprouts and unfolds, its name tag swings on its peg. */
  sapling: { end: 9000, soil: [300, 900] as const, sprout: [700, 3400] as const, tag: [2600, 3800] as const, caption: [1400, 8200] as const },
  /** Plant a Tree: the same planting, a full tree that grows up out of the plot. */
  tree: { end: 10_500, soil: [300, 900] as const, grow: [700, 5200] as const, tag: [4400, 5600] as const, caption: [1600, 9600] as const },
  /** Coming home: the window flares warm, the neighbours' windows answer one by one, the light settles. */
  relight: { end: 7000, flare: [250, 1300] as const, answer: [900, 3200] as const, settle: [3200, 6400] as const, caption: [700, 6600] as const },
  /** The night opens: the gate's braziers catch, its standard climbs in the town's colours, the castle beacon catches. */
  gate: { end: 16_000, braziers: [600, 2400] as const, standard: [1800, 5600] as const, beacon: [4200, 6800] as const, caption: [2400, 14_500] as const },
  /** Ring the Bell: three strokes from the castle; every face turns up toward it. */
  bell: { end: 9000, strokes: [500, 2300, 4100] as const, caption: [600, 8200] as const },
  /** Call a Festival: the town dresses in its colours, stays dressed for ten minutes, then the bunting comes down. */
  festival: { length: 600_000, dress: [0, 4000] as const, undress: 5000, caption: [800, 9000] as const },
  /** The decree board: it rises in the plaza; each pennant climbs to its share; at the end the winner tops its pole. */
  board: { rise: [0, 2400] as const, climb: 1600, decide: [0, 3600] as const, hold: 45_000, lower: [45_000, 48_000] as const },
  /** A carried-out colours decree: the new colours run across the town's bunting from the plaza outward. */
  colours: { wave: [800, 6000] as const },
} as const;

/** Bounds the town layers draw within. */
export const TOWN_LIMITS = { plantings: 512, relights: 6, answers: 4, choices: 5 } as const;

/** One planting at a home: a follower's sapling or a planted tree. `grow` 0..1 (1 is grown; restored plantings are 1). */
export interface PlantingFrame {
  readonly slot: number;
  readonly kind: 'sapling' | 'tree';
  /** The name on the tag; null when the home's citizen is not publicly named. */
  readonly name: string | null;
  readonly grow: number;
  /** The tag's swing on its peg, radians; 0 at rest. */
  readonly tag: number;
  /** Ms since this planting's beat began, or null when it is standing state. */
  readonly t: number | null;
}

/**
 * A citizen's home relighting as they come home: their window flares, then the nearest neighbours' windows answer
 * one by one (the layer picks up to `TOWN_LIMITS.answers` nearest homes and staggers them over `TOWN_BEAT.relight.answer`).
 */
export interface RelightFrame {
  readonly id: string;
  readonly slot: number;
  /** Ms into the relight beat. */
  readonly t: number;
  /** The flare's envelope at the window, 0..1. */
  readonly flare: number;
}

/** The gate when the night is open: braziers lit, the standard flying the town's colours. */
export interface GateFrame {
  readonly number: number;
  readonly colour: TownColour;
  /** Ms since the night opened live, or null when restored (everything already lit and raised). */
  readonly t: number | null;
  /** 0..1: the braziers' fire, the standard's climb up its pole, the castle beacon. */
  readonly braziers: number;
  readonly standard: number;
  readonly beacon: number;
}

export interface BoardChoiceFrame {
  readonly id: string;
  readonly title: string;
  /** The choice's share of one-person votes, 0..1, eased as tallies change. */
  readonly share: number;
  readonly votes: number;
  /** The pennant's dye: the colour the choice names, or a fixed dye by position for any other poll. */
  readonly colour: TownColour;
  readonly winner: boolean;
}

/** The decree board in the plaza while a poll runs, and for a while after it decides. */
export interface BoardFrame {
  readonly key: string;
  readonly title: string;
  /** Ms since the board rose. */
  readonly t: number;
  readonly choices: readonly BoardChoiceFrame[];
  readonly phase: 'open' | 'decided' | 'divided' | 'cancelled';
  /** Ms since the poll ended, or null while it runs. */
  readonly decidedT: number | null;
  /** Whether this poll was a colours decree the kingdom carries out. */
  readonly decree: boolean;
  /** 1 standing, 0 lowered (rising at the start, lowering after the hold). */
  readonly raised: number;
}

export interface BellFrame { readonly id: string; readonly t: number }
export interface FestivalFrame {
  readonly id: string;
  /** Ms since the festival was called; the dressing is up from `TOWN_BEAT.festival.dress[1]`. */
  readonly t: number;
  /** 0..1, how dressed the streets are (rising at the start, falling at the end). */
  readonly dressed: number;
  readonly colour: TownColour;
}

export interface TownFrame {
  readonly plantings: readonly PlantingFrame[];
  /** The colours the town flies: the last carried-out decree, else the default. */
  readonly colour: TownColour;
  /** A decree landing now: the new colours run outward from the plaza, `wave` 0..1. */
  readonly colourChange: { readonly from: TownColour; readonly to: TownColour; readonly wave: number } | null;
  readonly gate: GateFrame | null;
  readonly board: BoardFrame | null;
  readonly relights: readonly RelightFrame[];
  readonly bell: BellFrame | null;
  readonly festival: FestivalFrame | null;
}

export const EMPTY_TOWN: TownFrame = {
  plantings: [], colour: DEFAULT_TOWN_COLOUR, colourChange: null, gate: null, board: null, relights: [], bell: null, festival: null,
};

/** What the town layers may stand on: the host's own supplied anchors, never a guessed address. */
export interface TownLayerHost extends SpectacleLayerHost {
  /** A home's doorstep and its facing, for the planting beside the door. */
  door(slot: number): DoorAnchor | null;
  /** A home's presence window: centre on the glass, outward normal, right, pane size (m). */
  window(slot: number): { readonly centre: Vec3; readonly normal: Vec3; readonly right: Vec3; readonly width: number; readonly height: number } | null;
  /** The gate where the road enters the town, facing into it. */
  gate(): PlaceAnchor | null;
}

export const smoothstep = (from: number, to: number, t: number) => {
  const v = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return v * v * (3 - 2 * v);
};
