import type { AvatarPartBlueprint } from '@chatdom/shared';
import { createBodyParts, createHairParts, validateLook } from '../avatars/index';
import { partToSculpt } from './roles/tailor';
import { GARB } from '../avatars/index';
import { MAT } from '../materials';
import { keeperPalette } from './palette';
import { keeperRole } from './roles/index';
import type { KeeperCostume, KeeperLook, KeeperLookSpec } from './types';

const SHIRT_BONES = new Set(['chest', 'pelvis', 'upperArmLeft', 'upperArmRight', 'forearmLeft', 'forearmRight']);
const TROUSER_BONES = new Set(['pelvis', 'thighLeft', 'thighRight', 'shinLeft', 'shinRight']);

/** Re-dye only the neutral garb's linen and breeches; face, hands, belt and shoes keep their authored keys. */
function dyeGarb(part: AvatarPartBlueprint, costume: KeeperCostume, skin: number): AvatarPartBlueprint {
  const forearm = part.attachment === 'forearmLeft' || part.attachment === 'forearmRight';
  const shirt = forearm && costume.rolledSleeves ? skin : costume.dye.shirt;
  return { ...part, boxes: part.boxes.map(box => ({ ...box,
    material: SHIRT_BONES.has(part.attachment) && box.material === MAT.cream ? shirt
      : TROUSER_BONES.has(part.attachment) && box.material === MAT.earth ? costume.dye.breeches : box.material,
  })) };
}

/** Cut hair to sit under a hat: nothing at or above the ceiling row, nothing inside the hat's own volume. */
function fitHair(part: AvatarPartBlueprint, hat: NonNullable<KeeperCostume['hat']>, tag: string): AvatarPartBlueprint | null {
  const hair = partToSculpt(part).carveWhere((_x, y) => y >= hat.ceiling);
  if (hat.exclude) hair.subtract(hat.exclude);
  hair.tidy(2);
  return hair.size ? hair.toPart(part.id.replace(/^hair\./, `hair.keeper.${tag}.`), part.attachment, part.layer) : null;
}

/**
 * One keeper's look on the citizens' own rig: the wardrobe body in its neutral garb re-dyed to the role, the seeded hair
 * cut to fit under the role's headwear, the role's garments, and its tools (one in hand at a time). Pure and deterministic.
 */
export function createKeeperLook(spec: KeeperLookSpec): KeeperLook {
  const role = keeperRole(spec.role);
  const palette = keeperPalette(spec.kit);
  if (!role.hairForms.includes(spec.hair.form)) throw new Error(`A ${spec.role} does not wear ${spec.hair.form} hair.`);
  const costume = role.costume({ body: spec.body, palette, temperament: spec.temperament, skin: spec.skin, hair: spec.hair.swatch });
  const body = createBodyParts(spec.body, spec.skin).map(part => dyeGarb(part, costume, spec.skin));
  const hair = createHairParts(spec.hair.form, { body: spec.body, hair: spec.hair.swatch, headwear: null })
    .map(part => (costume.hat ? fitHair(part, costume.hat, `${spec.role}.${spec.temperament}.${spec.body}`) : part))
    .filter((part): part is AvatarPartBlueprint => part !== null);
  const parts = [...body, ...hair, ...costume.garments];
  // Budget the heaviest variant: every always-drawn part plus the largest tool.
  const heaviest = [...costume.tools].sort((a, b) => cells(b.parts) - cells(a.parts))[0];
  const report = validateLook([...parts, ...(heaviest?.parts ?? [])]);
  for (const tool of costume.tools) validateLook([...parts, ...tool.parts]);
  if (new Set(costume.tools.map(tool => tool.id)).size !== costume.tools.length) throw new Error(`${spec.role} repeats a tool id.`);
  const id = `keeper.${spec.role}.${spec.temperament}.${spec.kit}.${spec.body}`;
  return { id, spec, parts, tools: costume.tools, cape: costume.cape, report };
}

function cells(parts: readonly AvatarPartBlueprint[]): number {
  let n = 0;
  for (const part of parts) for (const box of part.boxes) if (box.material) n += (box.to[0] - box.from[0]) * (box.to[1] - box.from[1]) * (box.to[2] - box.from[2]);
  return n;
}

/** The registered keys that make a keeper's eyes, kept on every look so no costume hides the face. */
export const FACE_KEYS = [GARB.eye, GARB.sclera] as const;
