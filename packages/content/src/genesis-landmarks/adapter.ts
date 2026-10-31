import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandmark, GenesisLandscape } from '../../../world/src/genesis/contracts';
import { VOXEL_METRES } from '@chatdom/shared';
import { WATCHTOWER_AXIS, createHarbourWatchtower, type WatchtowerCrown } from './harbour-watchtower/tower';
import { RIVER_HALL, RIVER_HALL_AXIS, createRiverHall } from './river-hall/hall';
import { CROWN_TOWER_AXIS, createCrownTower, type CrownTowerHead } from './crown-tower/crown';
import { CATHEDRAL_SITE_AXIS, CATHEDRAL_SITE_SIZE, createCathedralSite } from './cathedral-site/site';
import { LANDMARK_KITS, snapToCloth } from './kit';
import type { LandmarkPiece } from './types';

/**
 * The local Genesis landmark adapter. It reads a frozen recipe and the landscape the ceremony actually selected
 * (never the recommendation by default) and returns deterministic content proposals: the authored piece, how it is
 * turned, a candidate site and the checks main must run before anything stands there. It adopts nothing, grounds
 * nothing and asserts no valid placement.
 *
 * The landscape character picks the showcase landmark (explicit art direction for the three landscapes): the coast
 * gets the harbour watchtower, the river valley the river hall, the mountain pass the crown tower. The recipe's own
 * `identity.landmark` is a separate input: it is passed through untouched and only shapes a detail of the showcase,
 * so a lighthouse kingdom's harbour tower carries a lamp room, a watermill kingdom's river hall turns a wheel and a
 * bell-garden kingdom's crown tower hangs a bell where the others keep a watch fire.
 *
 * A recipe whose size reserves a cathedral site (a city or a capital) also gets that site, on any landscape: the
 * land held and set out for a cathedral its people may raise, never a building and never a population.
 */
export type GenesisShowcase = 'harbour-watchtower' | 'river-hall' | 'crown-tower' | 'cathedral-site';
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

export interface MountainLandmarkProposal extends ProposalBase {
  readonly showcase: 'crown-tower';
  /** A bell-garden kingdom hangs a bell in the tower's head; every other kingdom keeps a watch fire there. */
  readonly head: CrownTowerHead;
  /**
   * A candidate, in world metres: `setback` metres from the pass's saddle towards the plaza, the door and its board
   * turned to the plaza. `elevation` is the saddle's recorded height, for the piece's y = 0; `pass` is the saddle
   * and its recorded width between its two hills. Not sampled, graded or validated.
   */
  readonly site: {
    readonly axis: XZ; readonly origin: XZ; readonly elevation: number; readonly setback: number;
    readonly pass: { readonly saddle: readonly [number, number, number]; readonly width: number; readonly between: readonly [string, string] };
    readonly basis: 'pass-towards-plaza'; readonly status: 'unvalidated';
  };
}

export interface CathedralSiteProposal extends ProposalBase {
  readonly showcase: 'cathedral-site';
  /**
   * A candidate, in world metres, for the middle of the reserve: across the plaza from the gate, its west front
   * (local +Z) `forecourt` metres beyond the plaza's anchor and turned back to face it. `footprint` is the turned
   * reserve's world bounds; `withinSettlementReserve` says only whether those bounds lie inside the landscape's
   * recorded settlement reserve. Not sampled, graded, cleared of lots or validated.
   */
  readonly site: {
    readonly axis: XZ; readonly origin: XZ; readonly forecourt: number;
    readonly footprint: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
    readonly withinSettlementReserve: boolean;
    readonly basis: 'plaza-frontage'; readonly status: 'unvalidated';
  };
}

export type GenesisLandmarkProposal = HarbourLandmarkProposal | RiverLandmarkProposal | MountainLandmarkProposal | CathedralSiteProposal;

const METRE = VOXEL_METRES.build;
const SETBACK = 14;
/** How far the crown tower stands from the pass's saddle, towards the town. */
const PASS_SETBACK = 20;
/** The open ground between the plaza's anchor and the cathedral site's west front. */
const FORECOURT = 10;

export function proposeGenesisLandmarks(
  recipe: DeepReadonly<ChannelKingdomRecipe>,
  landscape: DeepReadonly<GenesisLandscape>,
): readonly GenesisLandmarkProposal[] {
  if (recipe.version !== 'channel-genesis-1') throw new Error(`Unsupported recipe version ${String(recipe.version)}.`);
  const own = recipe.landscapes.find(candidate => candidate.id === landscape.id);
  if (!own) throw new Error(`Landscape ${landscape.id} is not one of this recipe's candidates.`);
  if (own !== landscape && JSON.stringify(own) !== JSON.stringify(landscape)) throw new Error(`Landscape ${landscape.id} differs from the recipe's candidate.`);
  const landmark = landscape.character === 'coastal-harbour' ? harbourWatchtower(recipe, landscape)
    : landscape.character === 'river-valley' ? riverHall(recipe, landscape)
      : landscape.character === 'mountain-pass' ? crownTower(recipe, landscape) : null;
  if (!landmark) throw new Error(`No landmark is authored for the ${String(landscape.character)} landscape.`);
  return recipe.size.cathedralSite ? [landmark, cathedralSite(recipe, landscape)] : [landmark];
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

function crownTower(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>): MountainLandmarkProposal {
  const { identity } = recipe;
  const style = identity.styleFamily;
  if (!(style in LANDMARK_KITS)) throw new Error(`Unknown style family ${String(style)}.`);
  const palette = snapPalette(identity.profileColourTargets, style);
  const head: CrownTowerHead = identity.landmark === 'bell-garden' ? 'bell' : 'watch-fire';
  const crest = { shape: identity.crest.shape, charge: identity.crest.charge };
  const piece = createCrownTower({ style, head, crest, bannerCut: identity.banner.cut, colours: { field: palette.field.material, band: palette.band.material } });

  const { saddle, width, betweenHillIds } = landscape.mountainPass;
  const plaza = placeOf(landscape, 'plaza');
  const toPlaza = unit([plaza.anchor[0] - saddle[0], plaza.anchor[1] - saddle[2]]);
  const axis: XZ = [saddle[0] + toPlaza[0] * PASS_SETBACK, saddle[2] + toPlaza[1] * PASS_SETBACK];
  const quarterTurns = facing(unit([plaza.anchor[0] - axis[0], plaza.anchor[1] - axis[1]]));
  const local = rotate([CROWN_TOWER_AXIS.x * METRE, CROWN_TOWER_AXIS.z * METRE], quarterTurns);

  return {
    id: `${landscape.id}/landmark/crown-tower`,
    landscapeId: landscape.id, character: landscape.character, showcase: 'crown-tower',
    recipeLandmark: identity.landmark, head, piece, quarterTurns,
    site: {
      axis, origin: [axis[0] - local[0], axis[1] - local[1]], elevation: saddle[1], setback: PASS_SETBACK,
      pass: { saddle: [saddle[0], saddle[1], saddle[2]], width, between: [betweenHillIds[0], betweenHillIds[1]] },
      basis: 'pass-towards-plaza', status: 'unvalidated',
    },
    palette, crest, bannerCut: identity.banner.cut,
    provenance: provenanceOf(recipe),
    checks: [
      'Sample the selected surface under the terrace: ground within one cell of y = 0 at its front edge and the steps, and no higher than y = 4 anywhere under it; the rock outcrop may sink up to six cells into rising ground at the back.',
      'The door approach and its outer ground run are dry, air and within one cell of groundAt, with a road from the plaza reaching the steps.',
      'The road through the pass stays open beside the terrace: the saddle\'s recorded width is not taken by the piece or by its clear volumes.',
      'The footprint is outside the settlement reserve\'s home lots and other places.',
      'The board, the lookouts, the flag swing and the fire\'s flame (or the bell\'s swing) stay clear of every other placed solid.',
    ],
  };
}

function cathedralSite(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>): CathedralSiteProposal {
  const { identity } = recipe;
  const style = identity.styleFamily;
  if (!(style in LANDMARK_KITS)) throw new Error(`Unknown style family ${String(style)}.`);
  const palette = snapPalette(identity.profileColourTargets, style);
  const crest = { shape: identity.crest.shape, charge: identity.crest.charge };
  const piece = createCathedralSite({ style, crest, colours: { field: palette.field.material, band: palette.band.material } });

  // Across the plaza from the gate: whoever enters by the gate crosses the plaza towards the site's west front.
  const plaza = placeOf(landscape, 'plaza'), gate = placeOf(landscape, 'gate');
  const onward = unit([plaza.anchor[0] - gate.anchor[0], plaza.anchor[1] - gate.anchor[1]]);
  const quarterTurns = facing([-onward[0], -onward[1]]);
  const halfLength = (CATHEDRAL_SITE_SIZE[2] * METRE) / 2;
  const axis: XZ = [plaza.anchor[0] + onward[0] * (FORECOURT + halfLength), plaza.anchor[1] + onward[1] * (FORECOURT + halfLength)];
  const local = rotate([CATHEDRAL_SITE_AXIS.x * METRE, CATHEDRAL_SITE_AXIS.z * METRE], quarterTurns);
  const origin: XZ = [axis[0] - local[0], axis[1] - local[1]];
  const corners = ([[0, 0], [CATHEDRAL_SITE_SIZE[0], 0], [0, CATHEDRAL_SITE_SIZE[2]], [CATHEDRAL_SITE_SIZE[0], CATHEDRAL_SITE_SIZE[2]]] as const)
    .map(([x, z]) => rotate([x * METRE, z * METRE], quarterTurns)).map(([x, z]) => [origin[0] + x, origin[1] + z] as const);
  const footprint = {
    minX: Math.min(...corners.map(c => c[0])), maxX: Math.max(...corners.map(c => c[0])),
    minZ: Math.min(...corners.map(c => c[1])), maxZ: Math.max(...corners.map(c => c[1])),
  };
  const reserve = landscape.settlementReserve;
  const withinSettlementReserve = footprint.minX >= reserve.minX && footprint.maxX <= reserve.maxX && footprint.minZ >= reserve.minZ && footprint.maxZ <= reserve.maxZ;

  return {
    id: `${landscape.id}/landmark/cathedral-site`,
    landscapeId: landscape.id, character: landscape.character, showcase: 'cathedral-site',
    recipeLandmark: identity.landmark, piece, quarterTurns,
    site: { axis, origin, forecourt: FORECOURT, footprint, withinSettlementReserve, basis: 'plaza-frontage', status: 'unvalidated' },
    palette, crest, bannerCut: identity.banner.cut,
    provenance: provenanceOf(recipe),
    checks: [
      'Sample the selected surface over the whole reserve: dry, and within the slope the future cathedral\'s plan can be graded to.',
      'The reserve is held out of the home-lot allocator, every other place and every road but the one to its west front.',
      'The forecourt between the plaza and the west front stays open ground.',
      'Nothing is built in the reserve but its setting-out until the community raises the cathedral; no light, sound or figure implies people who are not there.',
    ],
  };
}

function placeOf(landscape: DeepReadonly<GenesisLandscape>, purpose: GenesisLandscape['places'][number]['purpose']): DeepReadonly<GenesisLandscape['places'][number]> {
  const place = landscape.places.find(candidate => candidate.purpose === purpose);
  if (!place) throw new Error(`Landscape ${landscape.id} has no ${purpose}.`);
  return place;
}

function unit([x, z]: XZ): XZ {
  const length = Math.hypot(x, z);
  if (length < 1e-9) throw new Error('Cannot take a direction between two coincident places.');
  return [x / length, z / length];
}

/** The quarter turn whose local +Z points closest to `direction` (the first, on a tie). */
function facing(direction: XZ): Turn {
  let best: Turn = 0, dot = -Infinity;
  for (const turn of [0, 1, 2, 3] as const) {
    const [fx, fz] = rotate([0, 1], turn), d = fx * direction[0] + fz * direction[1];
    if (d > dot + 1e-9) { dot = d; best = turn; }
  }
  return best;
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
