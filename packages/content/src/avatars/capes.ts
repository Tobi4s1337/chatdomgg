import { AVATAR_CAPE_LIMITS, AvatarCapeBlueprintSchema, VOXEL_METRES, type AvatarCapeBlueprint } from '@chatdom/shared';
import { MAT } from '../materials';
import { bodyContour } from './body';
import { AVATAR_MATERIALS, KIT_ACCENTS, type WearableStyle } from './palette';
import { restPosition } from './rig';
import type { WearableFit } from './wearables';

/**
 * Back garments are cloth, never voxels: each is a thin sheet pinned at the frozen `back` socket and
 * moved by the citizen runtime. This file authors the cut and its registered swatches; any clasp or
 * cord that holds it on is an ordinary rigid part in `wearables.ts`.
 */
export const CAPE_FORMS = ['shortCloak'] as const;
export type CapeFormId = (typeof CAPE_FORMS)[number];

/** Registered material keys for one kingdom's version of a cape: outside, inside and hem band. */
interface CapeColours { readonly cloth: number; readonly lining: number; readonly trim: number }

/** A body-independent cut. Rows are root-local avatar cells; `fit` turns them into metres per body. */
interface CapeCut {
  readonly shape: AvatarCapeBlueprint['shape'];
  readonly hem: AvatarCapeBlueprint['hem'];
  /** The row the pinned top edge sits on: just under the head, across the shoulder blades. */
  readonly mountRow: number;
  /** The row the hem's longest point reaches when the cloth hangs still. */
  readonly hemRow: number;
  /** Cells of cloth beyond the shoulder line at the top edge, and beyond the hips at the hem, each side. */
  readonly shoulderEase: number;
  readonly hipEase: number;
  readonly trimWidth: number;
  readonly colours: Record<WearableStyle, CapeColours>;
}

const CUTS: Record<CapeFormId, CapeCut> = {
  /**
   * Short cloak: an everyday flared half-cape from the shoulder joints to mid-thigh. Its bell flares past the
   * arms, so the cloak reads from the front at street distance. The rounded hem is longest at the centre and
   * lifts at the sides, so a stride shows the lining. Hearth wears madder red
   * over a rose lining with a plaster hem band; Tide wears sea blue over sand with a cream band.
   */
  shortCloak: {
    shape: 'flared', hem: 'rounded', mountRow: 15, hemRow: 6, shoulderEase: 1, hipEase: 1.5, trimWidth: .02,
    colours: {
      hearth: { cloth: MAT.fabricRed, lining: MAT.petal, trim: KIT_ACCENTS.hearth.cloth },
      tide: { cloth: MAT.fabricBlue, lining: MAT.limestone, trim: KIT_ACCENTS.tide.cloth },
    },
  },
};

export const isCapeForm = (id: string): id is CapeFormId => (CAPE_FORMS as readonly string[]).includes(id);

/** A cape's registered swatches in one kingdom, for the rigid cords and clasps that match it. */
export function capeColours(id: CapeFormId, style: WearableStyle): CapeColours {
  const colours = CUTS[id]?.colours[style];
  if (!colours) throw new Error(`No ${String(style)} colours for cape ${String(id)}.`);
  return colours;
}

/** Narrowed end of a flared or tapered cut, as a share of the widest span (frozen in the cape schema). */
const NARROW = .72;
/**
 * Cells of air between the deepest point of the back and the hanging cloth. Three quarters of a cell
 * keeps the slender back (flush with the socket) clear of the contract's mount floor.
 */
const BACK_CLEARANCE = .75;
const M = VOXEL_METRES.avatar;

const round = (metres: number): number => Math.round(metres * 1e4) / 1e4;

/**
 * The cape cut fitted to a body family. The sheet hangs just clear of the deepest point of the back
 * (shoulder blades, waist, seat or calves), its top edge spans the shoulders and its hem clears the hips.
 * Dimensions come from the body contour, so a new family is fitted without a hand-tuned table.
 */
export function createCape(id: CapeFormId, fit: WearableFit): AvatarCapeBlueprint {
  const cut = CUTS[id];
  if (!cut) throw new Error(`Unknown cape ${String(id)}.`);
  const c = bodyContour(fit.body);
  const colours = capeColours(id, fit.style);
  if (fit.subscription !== undefined) throw new Error(`${id} has no subscription state.`);
  for (const swatch of Object.values(colours)) if (!AVATAR_MATERIALS.has(swatch)) throw new Error(`${id}: material ${swatch} is outside the avatar palette.`);
  const [, socketY, socketZ] = restPosition('back');
  const deepest = Math.min(c.chest.back, c.waist.back, c.hip.back, c.leg.back);
  const shoulders = 2 * (c.chest.half + cut.shoulderEase), hips = 2 * (Math.max(c.hip.half, c.waist.half) + cut.hipEase);
  // `width` is the widest span; the narrowed end of a flared or tapered cut must still cover what it hangs over.
  const wanted = cut.shape === 'flared' ? Math.max(hips, shoulders / NARROW)
    : cut.shape === 'tapered' ? Math.max(shoulders, hips / NARROW)
    : Math.max(shoulders, hips);
  // A wide body may want more than the contract's widest sheet; it then loses only the shoulder ease.
  const width = Math.min(wanted, AVATAR_CAPE_LIMITS.maxWidth / M);
  const top = cut.shape === 'flared' ? width * NARROW : width;
  // The pinned edge covers the shoulder blades: the whole back, or the span between the shoulder joints on a broad chest.
  const blades = Math.min(2 * c.chest.half, 2 * Math.abs(restPosition('upperArmLeft')[0]));
  if (top < blades) throw new Error(`${id} on ${fit.body} cannot span the shoulder blades within the cape contract.`);
  const cape: AvatarCapeBlueprint = {
    version: 1,
    id: `cape.${id}.${fit.style}.${fit.body}`,
    kind: 'cape',
    attachment: 'back',
    shape: cut.shape,
    width: round(width * M),
    length: round((cut.mountRow - cut.hemRow) * M),
    hem: cut.hem,
    trimWidth: cut.trimWidth,
    mount: { height: round((cut.mountRow - socketY) * M), back: round((socketZ - deepest + BACK_CLEARANCE) * M) },
    colours: { ...colours },
  };
  const parsed = AvatarCapeBlueprintSchema.safeParse(cape);
  if (!parsed.success) throw new Error(`${cape.id} does not fit the cape contract: ${parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}
