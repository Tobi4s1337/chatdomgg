import { AVATAR_CAPE_LIMITS, AvatarCapeBlueprintSchema, VOXEL_METRES, type AvatarAttachmentId, type AvatarCapeBlueprint, type AvatarPartBlueprint } from '@chatdom/shared';
import { BODY_FAMILIES, type BodyFamily } from '../avatars/body';
import { validateLook } from '../avatars/compile';
import { GARB, materialName, resolveSkin } from '../avatars/palette';
import { restPosition } from '../avatars/rig';
import { Sculpt } from '../avatars/sculpt';
import { styleBodyPieces, type StyleGarb } from './body';
import { partCells, sealScalp, styleHair } from './hair';
import { styleRig, type StyleRig } from './rig';
import { avatarStyle, styleRow, torsoTop, type AvatarStyle, type AvatarStyleId } from './styles';

const M = VOXEL_METRES.avatar;

/**
 * What a wardrobe look is, read from its actual parts: the body family, skin, the dyed shirt and breeches,
 * the look's own hair part and its cloth cloak. Conversion keeps every one of these; only the shape changes.
 */
export interface StyleLookSource {
  readonly id: string;
  readonly family: BodyFamily;
  readonly skin: number;
  readonly shirt: number;
  readonly trousers: number;
  /** The wardrobe hair part (layer `hair`, on `head`), or null for none. */
  readonly hair: AvatarPartBlueprint | null;
  /** The wardrobe cloak, refitted to the style's shoulders and length; null for none. */
  readonly cape: AvatarCapeBlueprint | null;
}

export interface StyledLook {
  readonly id: string;
  readonly style: AvatarStyleId;
  readonly rig: StyleRig;
  /** Rigid parts whose pivots are the style rig's joints: `(cell - pivot)` is attachment-local. */
  readonly parts: readonly AvatarPartBlueprint[];
  readonly cape: AvatarCapeBlueprint | null;
}

/** Export a workpiece as a part bound to an attachment of a style rig. */
function toStylePart(piece: Sculpt, id: string, attachment: AvatarAttachmentId, layer: AvatarPartBlueprint['layer'], rig: StyleRig): AvatarPartBlueprint {
  const part = piece.toPart(id, attachment, layer);
  // `toPart` binds to today's rig; shift the pivot to the style's joint, so rotation turns about it.
  const today = restPosition(attachment), style = rig.rest.get(attachment)!;
  return { ...part, pivot: [part.pivot[0] + style[0] - today[0], part.pivot[1] + style[1] - today[1], part.pivot[2] + style[2] - today[2]] };
}

/**
 * The cloak's rigid half in the style: cords in the cloak's colour along the collar line, meeting at a
 * brass clasp under the chin, riding the chest.
 */
function clasp(style: AvatarStyle, family: BodyFamily, cord: number): Sculpt {
  const top = torsoTop(style, family), row = styleRow(style, family, top);
  const s = new Sculpt();
  s.box([-row.half + 1, top, row.front], [row.half - 1, top + 1, row.front + 1], cord);
  s.box([-1, top - 1, row.front], [1, top + 1, row.front + 1], GARB.clasp);
  return s;
}

/**
 * The same cloak cut, refitted: pinned a row under the collar, its flared top spanning the shoulder joints
 * with a cell of ease, its hem spanning the hips, hanging to mid-thigh. Clamped to the cloth contract.
 */
function refitCape(source: AvatarCapeBlueprint, style: AvatarStyle, family: BodyFamily, rig: StyleRig): AvatarCapeBlueprint {
  const f = style.families[family];
  const top = torsoTop(style, family);
  const [, socketY, socketZ] = rig.rest.get('back')!;
  const shoulderX = rig.rest.get('upperArmRight')![0];
  const deepest = Math.min(...f.torso.map(s => s.back), f.leg.back);
  const hips = 2 * (Math.max(...f.torso.slice(0, 3).map(s => s.half)) + 1);
  const narrow = source.shape === 'flared' ? .72 : 1;
  const width = Math.min(Math.max(2 * (shoulderX + 1) / narrow, hips), AVATAR_CAPE_LIMITS.maxWidth / M);
  const hemRow = (style.hipY + style.kneeY) / 2;
  const round = (v: number): number => Math.round(v * 1e4) / 1e4;
  const cape = {
    ...source,
    id: `${source.id}.${style.id}`,
    width: round(width * M),
    length: round(Math.min(top - hemRow, AVATAR_CAPE_LIMITS.maxLength / M) * M),
    mount: { height: round((top - socketY) * M), back: round(Math.max(socketZ - deepest + .5, .75) * M) },
  };
  return AvatarCapeBlueprintSchema.parse(cape);
}

/** Convert one wardrobe look into a style: same person, same clothes, the style's shape. */
export function convertLook(styleId: AvatarStyleId, source: StyleLookSource): StyledLook {
  const style = avatarStyle(styleId);
  if (!BODY_FAMILIES.includes(source.family)) throw new Error(`Unknown body family ${String(source.family)}.`);
  const skin = resolveSkin(source.skin);
  const garb: StyleGarb = { skin, shirt: source.shirt, trousers: source.trousers };
  const rig = styleRig(style, source.family);
  const pieces = styleBodyPieces(style, source.family, garb);
  const head = pieces.get('head')!;
  const tag = `avatar-style.${style.id}.${source.family}.${materialName(skin)}.${materialName(source.shirt)}.${materialName(source.trousers)}`;
  let hair: Sculpt | null = null;
  if (source.hair) {
    if (source.hair.layer !== 'hair' || source.hair.attachment !== 'head') throw new Error(`${source.id}: ${source.hair.id} is not a head hair part.`);
    const styled = styleHair(partCells(source.hair), style, head);
    hair = styled.hair;
    sealScalp(head, hair, styled.fitted, style, skin);
  }
  const parts: AvatarPartBlueprint[] = [];
  for (const [attachment, piece] of pieces) parts.push(toStylePart(piece, `${tag}.${attachment}`, attachment, 'body', rig));
  if (hair && hair.size) parts.push(toStylePart(hair, `${source.hair!.id}.${style.id}`, 'head', 'hair', rig));
  let cape: AvatarCapeBlueprint | null = null;
  if (source.cape) {
    cape = refitCape(source.cape, style, source.family, rig);
    parts.push(toStylePart(clasp(style, source.family, source.cape.colours.cloth), `${cape.id}.clasp`, 'chest', 'accessory', rig));
  }
  validateLook(parts);
  return { id: `${source.id}.${style.id}`, style: style.id, rig, parts, cape };
}
