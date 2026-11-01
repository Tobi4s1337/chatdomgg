import { AVATAR_RIG, type AvatarBoneId, type AvatarCapeBlueprint, type Vec3 } from '@chatdom/shared';
import {
  buildCitizen, capeCut, meshCitizen, parseLook, slotColours, VoxelGrid,
  type Cell, type CitizenLook as StyledCitizenRecipe, type CitizenMesh, type Slot,
} from '@chatdom/content/avatar-style';
import { MAT } from '@chatdom/content/materials';

export type { StyledCitizenRecipe };

/** A renderer input, not a saved appearance or an equip/ownership protocol. */
export interface StyledCitizenLook {
  readonly kind: 'paint-grid';
  readonly id: string;
  readonly recipe: StyledCitizenRecipe;
  /** Existing thin cloth remains separate from the painted solid body. */
  readonly cape?: AvatarCapeBlueprint;
  readonly dim?: boolean;
  /** Exact authored sRGB colours for a worn cape; the blueprint carries the sheet cut. */
  readonly capePaint?: { readonly cloth: readonly [number, number, number]; readonly lining: readonly [number, number, number]; readonly trim: readonly [number, number, number]; readonly dim: boolean };
}

/** Keep the caller's stable appearance ID; portraits consume this exact recipe too. */
export function createStyledCitizenLook(
  id: string, recipe: StyledCitizenRecipe, options: { readonly cape?: AvatarCapeBlueprint; readonly dim?: boolean } = {},
): StyledCitizenLook {
  if (!id.trim()) throw new Error('A styled citizen needs a look ID.');
  return { kind: 'paint-grid', id, recipe: parseLook(recipe), ...options };
}

/** Build the runtime appearance from a worn recipe; eligibility is owned by the caller. */
export function createWornCitizenLook(id: string, recipe: StyledCitizenRecipe, dim = false): StyledCitizenLook {
  const worn = createStyledCitizenLook(id, recipe, { dim });
  const earned = worn.recipe.earned.cape;
  if (!earned) return worn;
  const cut = capeCut(earned, dim && earned.kind !== 'cheer');
  // The shared sheet contract names palette IDs. The renderer uses capePaint for
  // exact per-person dyes; these registered fallbacks keep the contract valid.
  const cape: AvatarCapeBlueprint = {
    version: 1, id: 'cape.worn', kind: 'cape', attachment: 'back',
    shape: cut.shape, width: cut.width, length: cut.length, hem: cut.hem,
    trimWidth: cut.trimWidth, mount: cut.mount,
    colours: { cloth: MAT.fabricRed, lining: MAT.cream, trim: MAT.brass },
    ...(cut.shimmer ? { shimmer: { swatches: [MAT.fabricRed, MAT.fabricOrange, MAT.fabricGold, MAT.fabricGreen, MAT.fabricBlue, MAT.fabricViolet] as const, strength: cut.shimmer.strength } } : {}),
  };
  const rgb = (hex: string): readonly [number, number, number] => [
    parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255,
  ];
  return { ...worn, cape, capePaint: { cloth: rgb(cut.colours.cloth), lining: rgb(cut.colours.lining), trim: rgb(cut.colours.trim), dim: cut.dim } };
}

/**
 * The new six-cell torso has shoulders at ±4. This bind belongs only to painted
 * looks: moving the shared rig would also move legacy wardrobe and place keepers.
 * All rows, limb lengths and sockets remain those of the established animation.
 */
export const STYLED_CITIZEN_RIG: typeof AVATAR_RIG = AVATAR_RIG.map(bone => ({
  ...bone,
  offset: bone.id === 'upperArmLeft' ? [-4, 3, 0] : bone.id === 'upperArmRight' ? [4, 3, 0] : bone.offset,
}));

const bindPositions = new Map<AvatarBoneId, Vec3>();
for (const bone of STYLED_CITIZEN_RIG) {
  const parent = bone.parent ? bindPositions.get(bone.parent)! : [0, 0, 0];
  bindPositions.set(bone.id, bone.offset.map((n, i) => n + parent[i]!) as unknown as Vec3);
}

const headPaint = new Set<Slot>([
  'eye', 'blush', 'freckle', 'hair', 'hairDeep', 'hairLight', 'scalp', 'band',
  'beard', 'beardDeep', 'stubble', 'stache', 'stacheDeep', 'hat', 'hatDeep', 'hatTrim', 'hatTrimDeep',
  'frame', 'lens', 'metal', 'petal', 'petalHeart', 'leaf',
]);

/** A renderer-local continuous skirt panel, hinged at the hips only when seated. */
export type StyledCitizenBone = AvatarBoneId | 'hem';

/**
 * Rigid ownership follows the authored body, not just a horizontal slice: long
 * hair follows the head, shirt sleeves follow arms, and skirt/coat hems follow
 * the pelvis. Every source cell belongs to exactly one part. Joint cut faces are
 * closed by meshing parts separately, so bending never exposes a hollow limb.
 */
export function styledCellBone([x, y]: Cell, slot: Slot, recipe: StyledCitizenRecipe): StyledCitizenBone {
  if (y >= 16 || headPaint.has(slot)) return 'head';
  if ((x < -3 || x >= 3) && y >= 7) {
    const side = x < 0 ? 'Left' : 'Right';
    return `${y >= 11 ? 'upperArm' : y >= 9 ? 'forearm' : 'hand'}${side}`;
  }
  if (y >= 10) return 'chest';
  // These are continuous garments; splitting the hem into left/right legs
  // tears their authored silhouette in two on the first walking stride.
  if ((recipe.top.style === 'robe' && slot.startsWith('top'))
    || (recipe.bottom.style === 'skirt' && slot.startsWith('bottom'))
    || (recipe.outer?.style === 'coat' && slot.startsWith('outer'))) return y < 8 ? 'hem' : 'pelvis';
  // The upper legs reach the y=8 hip pivot, including the outer hip cells.
  // Leaving those cells fixed at y=6..8 opens a two-cell gap when sitting.
  if (y >= 8 || (y >= 6 && x >= -1 && x < 1)) return 'pelvis';
  const side = x < 0 ? 'Left' : 'Right';
  return `${y >= 4 ? 'thigh' : y >= 2 ? 'shin' : 'foot'}${side}`;
}

export function partitionStyledCitizen(recipe: StyledCitizenRecipe): ReadonlyMap<StyledCitizenBone, VoxelGrid> {
  const parts = new Map<StyledCitizenBone, VoxelGrid>();
  for (const [cell, slot] of buildCitizen(recipe).entries()) {
    const bone = styledCellBone(cell, slot, recipe);
    let grid = parts.get(bone);
    if (!grid) { grid = new VoxelGrid(); parts.set(bone, grid); }
    grid.set(...cell, slot);
  }
  return parts;
}

export interface StyledCitizenPart {
  readonly attachment: AvatarBoneId;
  /** Root-space bind translation in cells; mesh coordinates use the same frame. */
  readonly pivot: Vec3;
  readonly surface: 'solid' | 'glass';
  readonly seatedHem: boolean;
  readonly mesh: CitizenMesh;
}

/** Once per look at preparation; no meshing, colour conversion or recipes in update(). */
export function meshStyledCitizen(look: StyledCitizenLook): readonly StyledCitizenPart[] {
  const colours = slotColours(look.recipe, { subLapsed: look.dim }), parts: StyledCitizenPart[] = [];
  for (const [bone, grid] of partitionStyledCitizen(look.recipe)) {
    const attachment = bone === 'hem' ? 'pelvis' : bone;
    for (const surface of ['solid', 'glass'] as const) {
      const mesh = meshCitizen(grid, colours, surface);
      if (mesh.faces) parts.push({ attachment, pivot: bindPositions.get(attachment)!, surface, seatedHem: bone === 'hem', mesh });
    }
  }
  return parts;
}
