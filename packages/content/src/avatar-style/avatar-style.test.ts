import { describe, expect, it } from 'vitest';
import { BODY_FAMILIES, headVolume } from '../avatars/body';
import { createCape } from '../avatars/capes';
import { HAIR_FORMS, createHairParts } from '../avatars/hair';
import { GARB } from '../avatars/palette';
import { Sculpt } from '../avatars/sculpt';
import { MAT } from '../materials';
import { AVATAR_STYLE_IDS, avatarStyle, convertLook, partCells, styleHead, styleRig, type AvatarStyleId, type StyleLookSource } from './index';

const source = (form: (typeof HAIR_FORMS)[number], family: (typeof BODY_FAMILIES)[number], cloak = false): StyleLookSource => ({
  id: `fixture.${form}.${family}`, family, skin: MAT.skin8, shirt: MAT.fabricMutedGreen, trousers: MAT.fabricMutedBlue,
  hair: createHairParts(form, { body: family, hair: MAT.hairCopper, headwear: null })[0]!,
  cape: cloak ? createCape('shortCloak', { body: family, style: 'hearth' }) : null,
});

/** Root-local cells of a styled part at rest under its style rig. */
function restCells(look: ReturnType<typeof convertLook>, layer: 'body' | 'hair', attachment?: string): Sculpt {
  const out = new Sculpt();
  for (const part of look.parts) {
    if (part.layer !== layer || (attachment && part.attachment !== attachment)) continue;
    const rest = look.rig.rest.get(part.attachment)!;
    for (const box of part.boxes) for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) for (let x = box.from[0]; x < box.to[0]; x++) {
      out.set(x - part.pivot[0] + rest[0], y - part.pivot[1] + rest[1], z - part.pivot[2] + rest[2], box.material);
    }
  }
  return out;
}

/** Largest Euclidean distance from any hair cell to the nearest skull cell. */
function reach(hair: Sculpt, head: Sculpt): number {
  const skull: [number, number, number][] = [];
  head.forEachCell((x, y, z) => { skull.push([x, y, z]); });
  let worst = 0;
  hair.forEachCell((x, y, z) => {
    let best = Infinity;
    for (const [a, b, c] of skull) best = Math.min(best, (x - a) ** 2 + (y - b) ** 2 + (z - c) ** 2);
    worst = Math.max(worst, Math.sqrt(best));
  });
  return worst;
}

describe('avatar style study', () => {
  it.each(AVATAR_STYLE_IDS)('converts every body, hair treatment and the cloak into %s within the look budget', id => {
    for (const family of BODY_FAMILIES) for (const form of HAIR_FORMS) {
      const look = convertLook(id, source(form, family, form === 'sidePart'));
      expect(look.parts.every(p => p.pivot.every(Number.isInteger))).toBe(true);
      const head = restCells(look, 'body', 'head'), hair = restCells(look, 'hair');
      // Hair meets the skull face to face, never inside it.
      hair.forEachCell((x, y, z) => { expect(head.get(x, y, z)).toBe(0); });
      // Eyes stay open: nothing stands in front of the eye rows.
      const h = avatarStyle(id).head;
      for (let y = h.eyeBottom; y < h.eyeTop; y++) for (let x = h.white; x < -h.white; x++) for (let z = h.z[1] - 1; z < h.z[1] + 4; z++) {
        expect(hair.get(x, y, z), `${id} ${family} ${form} covers the eyes at ${x},${y},${z}`).toBe(0);
      }
    }
  });

  it.each(AVATAR_STYLE_IDS)('%s keeps hair as close to the skull as the wardrobe does, so nothing bloats', id => {
    for (const form of HAIR_FORMS) {
      if (form === 'longBraid' || form === 'bareScalp') continue; // the braid hangs down the back; brows only
      const wardrobe = reach(partCells(createHairParts(form, { body: 'balanced', hair: MAT.hairBlack, headwear: null })[0]!), headVolume(MAT.skin1));
      const look = convertLook(id, source(form, 'balanced'));
      const styled = reach(restCells(look, 'hair'), styleHead(avatarStyle(id), MAT.skin8));
      expect(styled, `${id} ${form}`).toBeLessThanOrEqual(wardrobe + 1.5);
    }
  });

  it('gives the three options clearly different proportions', () => {
    const measure = (id: AvatarStyleId) => {
      const s = avatarStyle(id), look = convertLook(id, source('closeCrop', 'balanced'));
      const body = restCells(look, 'body');
      const { min, max } = body.bounds();
      const height = max[1] - min[1];
      return { height, head: (s.head.y[1] - s.head.y[0]) / height, legs: s.hipY / height, headWidth: (s.head.x[1] - s.head.x[0]) / (max[0] - min[0]) };
    };
    const a = measure('hearthling'), b = measure('blockwright'), c = measure('storybook');
    expect(a.head).toBeGreaterThan(.42);
    expect(b.head).toBeLessThan(.32);
    expect(c.head).toBeLessThan(.3);
    expect(c.legs).toBeGreaterThan(.4);
    expect(a.legs).toBeLessThan(.3);
    expect(a.headWidth).toBeGreaterThan(b.headWidth);
    expect(new Set([a.height, b.height, c.height]).size).toBe(3);
  });

  it('keeps the blockwright head a sharp cube and the others bevelled', () => {
    expect(styleHead(avatarStyle('blockwright'), MAT.skin1).size).toBe(8 * 8 * 8);
    for (const id of ['hearthling', 'storybook'] as const) {
      const { x, y, z } = avatarStyle(id).head;
      expect(styleHead(avatarStyle(id), MAT.skin1).size).toBeLessThan((x[1] - x[0]) * (y[1] - y[0]) * (z[1] - z[0]) * .9);
    }
  });

  it('keeps each look recognisable: its skin, garb colours, hair swatch and cloak colours survive', () => {
    for (const id of AVATAR_STYLE_IDS) {
      const look = convertLook(id, source('bob', 'round', true));
      const materials = new Set(look.parts.flatMap(p => p.boxes.map(b => b.material)));
      for (const m of [MAT.skin8, MAT.fabricMutedGreen, MAT.fabricMutedBlue, MAT.hairCopper, GARB.leather, GARB.clasp, GARB.eye, GARB.sclera]) expect(materials.has(m), `${id} ${m}`).toBe(true);
      expect(look.cape?.colours).toEqual(createCape('shortCloak', { body: 'round', style: 'hearth' }).colours);
      // The pinned top of the flared cloak spans the shoulder joints, or is the widest sheet the cloth contract allows.
      const shoulder = look.rig.rest.get('upperArmRight')![0] * .0625;
      expect(look.cape!.width * .72).toBeGreaterThanOrEqual(Math.min(2 * shoulder, .95 * .72) - 1e-6);
    }
  });

  it('mirrors left and right limbs exactly about the centre line', () => {
    for (const id of AVATAR_STYLE_IDS) for (const family of BODY_FAMILIES) {
      const look = convertLook(id, source('bareScalp', family));
      for (const limb of ['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot']) {
        const left = restCells(look, 'body', `${limb}Left`), right = restCells(look, 'body', `${limb}Right`);
        left.forEachCell((x, y, z, m) => { expect(right.get(-1 - x, y, z)).toBe(m); });
        expect(left.size).toBe(right.size);
      }
      const rig = styleRig(avatarStyle(id), family);
      expect(rig.rest.get('upperArmLeft')![0]).toBe(-rig.rest.get('upperArmRight')![0]);
    }
  });
});
