import type { StyleLookSource, StyleStudyFixture } from '../../../../../packages/content/src/avatar-style';
import type { CitizenLook, CitizenPart } from '../index';

function part(look: CitizenLook, attachment: string, layer = 'body'): CitizenPart {
  const found = look.parts.find(p => p.blueprint.layer === layer && p.blueprint.attachment === attachment);
  if (!found) throw new Error(`${look.id}: no ${layer} part on ${attachment}.`);
  return found;
}

/** The material most of a part is made of. */
function dominant(p: CitizenPart): number {
  const tally = new Map<number, number>();
  for (const v of p.asset.voxels) if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

/**
 * Reads what a wardrobe look actually is from its compiled parts: the body family from the body part
 * IDs, skin from the head, the dyed shirt from a sleeve, breeches from a thigh, the hair part itself and
 * the cloth cloak. Nothing is re-declared, so the study always shows the real fixtures.
 */
export function readStyleSource(look: CitizenLook): StyleLookSource {
  const head = part(look, 'head');
  const family = head.blueprint.id.split('.')[1];
  if (family !== 'balanced' && family !== 'slender' && family !== 'broad' && family !== 'round') throw new Error(`${look.id}: unknown body family in ${head.blueprint.id}.`);
  const hair = look.parts.find(p => p.blueprint.layer === 'hair')?.blueprint ?? null;
  return {
    id: look.id, family, skin: dominant(head), shirt: dominant(part(look, 'upperArmLeft')), trousers: dominant(part(look, 'thighLeft')),
    hair, cape: look.cape ?? null,
  };
}

/** A fixture that has drifted from what the study says it shows fails loudly. */
export function checkFixture(fixture: StyleStudyFixture, source: StyleLookSource): void {
  const problems: string[] = [];
  if (source.family !== fixture.expect.family) problems.push(`body ${source.family}, expected ${fixture.expect.family}`);
  if (!source.hair?.id.startsWith(`hair.${fixture.expect.hair}.`)) problems.push(`hair ${source.hair?.id ?? 'none'}, expected ${fixture.expect.hair}`);
  if (Boolean(source.cape) !== fixture.expect.cloak) problems.push(`cloak ${source.cape ? 'worn' : 'absent'}`);
  if (problems.length) throw new Error(`Study fixture ${fixture.look}: ${problems.join('; ')}.`);
}
