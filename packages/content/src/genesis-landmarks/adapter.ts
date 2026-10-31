import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandmark, GenesisLandscape } from '../../../world/src/genesis/contracts';
import { VOXEL_METRES } from '@chatdom/shared';
import { WATCHTOWER_AXIS, createHarbourWatchtower, type WatchtowerCrown } from './harbour-watchtower/tower';
import { LANDMARK_KITS, snapToCloth } from './kit';
import type { LandmarkPiece } from './types';

/**
 * The local Genesis landmark adapter. It reads a frozen recipe and the landscape the ceremony actually selected
 * (never the recommendation by default) and returns deterministic content proposals: the authored piece, how it is
 * turned, a candidate site and the checks main must run before anything stands there. It adopts nothing, grounds
 * nothing and asserts no valid placement.
 *
 * The landscape character picks the showcase landmark (explicit art direction for the three landscapes). The
 * recipe's own `identity.landmark` is a separate input: it is passed through untouched and only shapes the
 * showcase's crown, so a lighthouse kingdom's harbour tower carries a lamp room.
 */
export type GenesisShowcase = 'harbour-watchtower';
type XZ = readonly [number, number];
type Turn = 0 | 1 | 2 | 3;

export interface GenesisLandmarkProposal {
  /** `<landscape id>/landmark/<showcase>`: stable for the same recipe and landscape. */
  readonly id: string;
  readonly landscapeId: string;
  readonly character: GenesisLandscape['character'];
  readonly showcase: GenesisShowcase;
  /** The recipe's landmark family, unchanged. */
  readonly recipeLandmark: GenesisLandmark;
  readonly crown: WatchtowerCrown;
  readonly piece: LandmarkPiece;
  /**
   * Positive-Y quarter turns about the piece's local origin; turn 1 maps local +Z (the door) to world +X. The door
   * faces the settlement, away from `coast.oceanToward`; the beacon loft looks out to sea from every side.
   */
  readonly quarterTurns: Turn;
  /**
   * A candidate, in world metres, for the tower's axis and the matching local origin. It sits on the line from the
   * gate out to the shore, `setback` metres inland of the authored shoreline. Not sampled, graded or validated.
   */
  readonly site: { readonly axis: XZ; readonly origin: XZ; readonly setback: number; readonly basis: 'gate-to-shore'; readonly status: 'unvalidated' };
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
  throw new Error(`No landmark is authored for the ${landscape.character} landscape yet.`);
}

function harbourWatchtower(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>): GenesisLandmarkProposal {
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
    provenance: recipe.evidence.kind === 'simulated' ? { evidence: 'simulated', label: 'SIMULATED' } : { evidence: 'observed', label: null },
    checks: [
      'Sample the selected surface under every footing; ground within one cell of y = 0 except where a footing allows embed.',
      'The door approach clearance and its outer ground run are dry, air and within one cell of groundAt.',
      'The footprint is dry land, outside the settlement reserve, home lots and other places, with a road reaching the approach.',
      'Lookouts, flag swing and beacon flame stay clear of every other placed solid.',
    ],
  };
}

function snapPalette(targets: readonly string[], style: keyof typeof LANDMARK_KITS): GenesisLandmarkProposal['palette'] {
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
