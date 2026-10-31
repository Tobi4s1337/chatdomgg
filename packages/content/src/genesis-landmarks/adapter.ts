import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandmark, GenesisLandscape } from '../../../world/src/genesis/contracts';
import { VOXEL_METRES } from '@chatdom/shared';
import { WATCHTOWER_AXIS, createHarbourWatchtower, type WatchtowerCrown } from './harbour-watchtower/tower';
import { RIVER_HALL, RIVER_HALL_AXIS, createRiverHall } from './river-hall/hall';
import { LANDMARK_KITS, snapToCloth } from './kit';
import type { LandmarkPiece } from './types';

/**
 * The local Genesis landmark adapter. It reads a frozen recipe and the landscape the ceremony actually selected
 * (never the recommendation by default) and returns deterministic content proposals: the authored piece, how it is
 * turned, a candidate site and the checks main must run before anything stands there. It adopts nothing, grounds
 * nothing and asserts no valid placement.
 *
 * The landscape character picks the showcase landmark (explicit art direction for the three landscapes): the coast
 * gets the harbour watchtower, the river valley the river hall. The recipe's own `identity.landmark` is a separate
 * input: it is passed through untouched and only shapes a detail of the showcase, so a lighthouse kingdom's harbour
 * tower carries a lamp room and a watermill kingdom's river hall turns a wheel.
 */
export type GenesisShowcase = 'harbour-watchtower' | 'river-hall';
type XZ = readonly [number, number];
type Turn = 0 | 1 | 2 | 3;

interface ProposalBase {
  /** `<landscape id>/landmark/<showcase>`: stable for the same recipe and landscape. */
  readonly id: string;
  readonly landscapeId: string;
  readonly character: GenesisLandscape['character'];
  /** The recipe's landmark family, unchanged. */
  readonly recipeLandmark: GenesisLandmark;
  readonly piece: LandmarkPiece;
  /** Positive-Y quarter turns about the piece's local origin; turn 1 maps local +Z (the door) to world +X. */
  readonly quarterTurns: Turn;
  /** The colour targets considered and the cloth they snapped to; `null` targets fall back to the kit. */
  readonly palette: {
    readonly targets: readonly string[];
    readonly field: { readonly material: number; readonly target: string | null };
    readonly band: { readonly material: number; readonly target: string | null };
  };
  readonly crest: { readonly shape: ChannelKingdomRecipe['identity']['crest']['shape']; readonly charge: ChannelKingdomRecipe['identity']['crest']['charge'] };
  readonly bannerCut: ChannelKingdomRecipe['identity']['banner']['cut'];
  /** Recipe provenance: a simulated recipe carries its SIMULATED label wherever the proposal is shown. */
  readonly provenance: { readonly evidence: 'observed' | 'simulated'; readonly label: 'SIMULATED' | null };
  /** What main must prove before this proposal stands anywhere. */
  readonly checks: readonly string[];
}

export interface HarbourLandmarkProposal extends ProposalBase {
  readonly showcase: 'harbour-watchtower';
  /** The door faces the settlement, away from `coast.oceanToward`; the beacon loft looks out to sea from every side. */
  readonly crown: WatchtowerCrown;
  /**
   * A candidate, in world metres, for the tower's axis and the matching local origin. It sits on the line from the
   * gate out to the shore, `setback` metres inland of the authored shoreline. Not sampled, graded or validated.
   */
  readonly site: { readonly axis: XZ; readonly origin: XZ; readonly setback: number; readonly basis: 'gate-to-shore'; readonly status: 'unvalidated' };
}

export interface RiverLandmarkProposal extends ProposalBase {
  readonly showcase: 'river-hall';
  /** A watermill kingdom's hall turns an undershot wheel; every other kingdom's does not. */
  readonly wheel: boolean;
  /**
   * A candidate, in world metres: the middle of the span on the river's centre line where it passes closest to the
   * plaza, turned so the door faces the plaza's bank. `elevation` puts the piece's y = 0 `water` cells below the
   * stream's recorded level there, so the drawn water line meets the river's; `river` is the stream's recorded
   * level, bed and width at the site against the hall's clear span; `skew` is the angle in degrees between the flow
   * and the hall's arch axis (local X) after the quarter turn. Not sampled, graded or validated.
   */
  readonly site: {
    readonly axis: XZ; readonly origin: XZ; readonly elevation: number;
    readonly river: { readonly id: string; readonly level: number; readonly bed: number; readonly width: number; readonly clearSpan: number };
    readonly skew: number;
    readonly basis: 'river-nearest-plaza'; readonly status: 'unvalidated';
  };
}

export type GenesisLandmarkProposal = HarbourLandmarkProposal | RiverLandmarkProposal;

const METRE = VOXEL_METRES.build;
const SETBACK = 14;

export function proposeGenesisLandmarks(
  recipe: DeepReadonly<ChannelKingdomRecipe>,
  landscape: DeepReadonly<GenesisLandscape>,
): readonly GenesisLandmarkProposal[] {
  if (recipe.version !== 'channel-genesis-1') throw new Error(`Unsupported recipe version ${String(recipe.version)}.`);
  const own = recipe.landscapes.find(candidate => candidate.id === landscape.id);
  if (!own) throw new Error(`Landscape ${landscape.id} is not one of this recipe's candidates.`);
  if (own !== landscape && JSON.stringify(own) !== JSON.stringify(landscape)) throw new Error(`Landscape ${landscape.id} differs from the recipe's candidate.`);
  if (landscape.character === 'coastal-harbour') return [harbourWatchtower(recipe, landscape)];
  if (landscape.character === 'river-valley') return [riverHall(recipe, landscape)];
  throw new Error(`No landmark is authored for the ${landscape.character} landscape yet.`);
}

function harbourWatchtower(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>): HarbourLandmarkProposal {
  const { identity } = recipe;
  const style = identity.styleFamily;
  if (!(style in LANDMARK_KITS)) throw new Error(`Unknown style family ${String(style)}.`);
  const palette = snapPalette(identity.profileColourTargets, style);
  const crown: WatchtowerCrown = identity.landmark === 'lighthouse' ? 'lamp-room' : 'beacon-loft';
  const crest = { shape: identity.crest.shape, charge: identity.crest.charge };
  const piece = createHarbourWatchtower({ style, crown, crest, bannerCut: identity.banner.cut, colours: { field: palette.field.material, band: palette.band.material } });

  const ocean = landscape.coast.oceanToward as Turn;
  const quarterTurns = ((ocean + 2) % 4) as Turn;
  const gate = landscape.places.find(place => place.purpose === 'gate');
  if (!gate) throw new Error(`Landscape ${landscape.id} has no gate to face.`);
  // Work in the coast's own frame, where the sea lies towards +v.
  const [u] = toCoast(gate.anchor, ocean);
  const shore = landscape.coast.shoreline.map(point => toCoast(point, ocean)).sort((a, b) => a[0] - b[0]);
  const axis = fromCoast([u, shoreAt(shore, u) - SETBACK], ocean);
  const local = rotate([WATCHTOWER_AXIS.x * METRE, WATCHTOWER_AXIS.z * METRE], quarterTurns);
  const origin: XZ = [axis[0] - local[0], axis[1] - local[1]];

  return {
    id: `${landscape.id}/landmark/harbour-watchtower`,
    landscapeId: landscape.id, character: landscape.character, showcase: 'harbour-watchtower',
    recipeLandmark: identity.landmark, crown, piece, quarterTurns,
    site: { axis, origin, setback: SETBACK, basis: 'gate-to-shore', status: 'unvalidated' },
    palette, crest, bannerCut: identity.banner.cut,
    provenance: provenanceOf(recipe),
    checks: [
      'Sample the selected surface under every footing; ground within one cell of y = 0 except where a footing allows embed.',
      'The door approach clearance and its outer ground run are dry, air and within one cell of groundAt.',
      'The footprint is dry land, outside the settlement reserve, home lots and other places, with a road reaching the approach.',
      'Lookouts, flag swing and beacon flame stay clear of every other placed solid.',
    ],
  };
}

function riverHall(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>): RiverLandmarkProposal {
  const { identity } = recipe;
  const style = identity.styleFamily;
  if (!(style in LANDMARK_KITS)) throw new Error(`Unknown style family ${String(style)}.`);
  const palette = snapPalette(identity.profileColourTargets, style);
  const wheel = identity.landmark === 'watermill';
  const crest = { shape: identity.crest.shape, charge: identity.crest.charge };
  const piece = createRiverHall({ style, wheel, crest, bannerCut: identity.banner.cut, colours: { field: palette.field.material, band: palette.band.material } });

  const stream = landscape.terrainCore.streams.find(candidate => candidate.id === 'river') ?? landscape.terrainCore.streams[0];
  if (!stream || stream.points.length < 2) throw new Error(`Landscape ${landscape.id} has no river to span.`);
  const plaza = landscape.places.find(place => place.purpose === 'plaza');
  if (!plaza) throw new Error(`Landscape ${landscape.id} has no plaza to face.`);
  // The point of the river's centre line nearest the plaza (the first, on a tie), with the stream's own records there.
  let best = { distance: Infinity, at: [0, 0] as XZ, tangent: [0, 1] as XZ, level: 0, bed: 0, width: 0 };
  for (let i = 1; i < stream.points.length; i++) {
    const a = stream.points[i - 1]!, b = stream.points[i]!;
    const dx = b.position[0] - a.position[0], dz = b.position[1] - a.position[1], length2 = dx * dx + dz * dz;
    if (!length2) continue;
    const t = Math.min(1, Math.max(0, ((plaza.anchor[0] - a.position[0]) * dx + (plaza.anchor[1] - a.position[1]) * dz) / length2));
    const at: XZ = [a.position[0] + dx * t, a.position[1] + dz * t];
    const distance = Math.hypot(plaza.anchor[0] - at[0], plaza.anchor[1] - at[1]);
    if (distance >= best.distance) continue;
    const length = Math.sqrt(length2);
    best = { distance, at, tangent: [dx / length, dz / length], level: a.level + (b.level - a.level) * t, bed: a.bed + (b.bed - a.bed) * t, width: a.width + (b.width - a.width) * t };
  }
  // The door faces the plaza's bank: the quarter turn whose front is nearest the plaza side of the flow.
  const [tx, tz] = best.tangent, toPlaza: XZ = [plaza.anchor[0] - best.at[0], plaza.anchor[1] - best.at[1]];
  const along = toPlaza[0] * tx + toPlaza[1] * tz;
  let side: XZ = [toPlaza[0] - along * tx, toPlaza[1] - along * tz];
  if (Math.hypot(side[0], side[1]) < 1e-9) side = [-tz, tx];
  let quarterTurns: Turn = 0, facing = -Infinity;
  for (const turn of [0, 1, 2, 3] as const) {
    const [fx, fz] = rotate([0, 1], turn), dot = fx * side[0] + fz * side[1];
    if (dot > facing + 1e-9) { facing = dot; quarterTurns = turn; }
  }
  const [ax, az] = rotate([1, 0], quarterTurns);
  const skew = (Math.acos(Math.min(1, Math.abs(ax * tx + az * tz))) * 180) / Math.PI;
  const local = rotate([RIVER_HALL_AXIS.x * METRE, RIVER_HALL_AXIS.z * METRE], quarterTurns);
  const origin: XZ = [best.at[0] - local[0], best.at[1] - local[1]];
  const clearSpan = (RIVER_HALL.deck.z[1] - RIVER_HALL.deck.z[0]) * METRE;

  return {
    id: `${landscape.id}/landmark/river-hall`,
    landscapeId: landscape.id, character: landscape.character, showcase: 'river-hall',
    recipeLandmark: identity.landmark, wheel, piece, quarterTurns,
    site: {
      axis: best.at, origin, elevation: best.level - RIVER_HALL.water * METRE,
      river: { id: stream.id, level: best.level, bed: best.bed, width: best.width, clearSpan },
      skew, basis: 'river-nearest-plaza', status: 'unvalidated',
    },
    palette, crest, bannerCut: identity.banner.cut,
    provenance: provenanceOf(recipe),
    checks: [
      'Sample both banks along each abutment: ground within one cell of y = water.bank at the faces, never above it, and the door approach\'s outer run within one cell of groundAt.',
      'The river at the site is no wider than the clear span between the abutments, its surface within half a cell of y = water.level, and its bed at or below every pier footing (piers may embed up to the water line).',
      'The flow passes square through the arches: re-site or re-turn if the skew exceeds 30 degrees.',
      'The footprint is outside the settlement reserve, home lots and other places, with a road reaching the approach on the town bank.',
      'Every waterway, the flag swing and the bell swing stay clear of every other placed solid.',
    ],
  };
}

function provenanceOf(recipe: DeepReadonly<ChannelKingdomRecipe>): ProposalBase['provenance'] {
  return recipe.evidence.kind === 'simulated' ? { evidence: 'simulated', label: 'SIMULATED' } : { evidence: 'observed', label: null };
}

function snapPalette(targets: readonly string[], style: keyof typeof LANDMARK_KITS): ProposalBase['palette'] {
  const kit = LANDMARK_KITS[style];
  const list = targets.map(target => target.toLowerCase());
  const snapped = list.map(target => ({ target, material: snapToCloth(target) }));
  const field = snapped[0] ?? { target: null, material: kit.field };
  const band = snapped.find(entry => entry.material !== field.material) ?? { target: null, material: field.material === kit.charge ? kit.field : kit.charge };
  return { targets: list, field, band };
}

/** World XZ to the coast frame (the inverse of the landscape's own turn). */
function toCoast([x, z]: XZ, turn: Turn): XZ {
  if (turn === 0) return [x, z];
  if (turn === 1) return [-z, x];
  if (turn === 2) return [-x, -z];
  return [z, -x];
}

/** The landscape's turn: the same mapping `point()` and local +Z→world use. */
function rotate([x, z]: XZ, turn: Turn): XZ {
  if (turn === 0) return [x, z];
  if (turn === 1) return [z, -x];
  if (turn === 2) return [-x, -z];
  return [-z, x];
}
const fromCoast = rotate;

/** The shoreline's v at u, by straight runs between its authored points (clamped at its ends). */
function shoreAt(shore: readonly XZ[], u: number): number {
  if (!shore.length) throw new Error('The coast has no shoreline.');
  if (u <= shore[0]![0]) return shore[0]![1];
  for (let i = 1; i < shore.length; i++) {
    const [u0, v0] = shore[i - 1]!, [u1, v1] = shore[i]!;
    if (u <= u1) return v0 + (v1 - v0) * ((u - u0) / (u1 - u0 || 1));
  }
  return shore[shore.length - 1]![1];
}
