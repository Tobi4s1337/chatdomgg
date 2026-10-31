import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRunes, RUNE_SLOTS } from '../presentation/runes';
import { FORGE_ALPHABET, glyphStrokes, MARK_CENTRE, RUNE_SITES } from './runes';
import { ANVIL_MATERIALS, GRID_MIN, GRID_SIZE, H, sculptAnvilStage, Y_OFFSET } from './sculpt';

const sculpt = sculptAnvilStage();
const [nx, ny, nz] = GRID_SIZE;
/** Material of the cell containing a root-local point in metres. */
const cellAt = (p: THREE.Vector3) => {
  const i = Math.floor(p.x / H) - GRID_MIN[0], j = Math.floor((p.y - Y_OFFSET) / H) - GRID_MIN[1], k = Math.floor(p.z / H) - GRID_MIN[2];
  return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : sculpt.voxels[i + nx * (j + ny * k)]!;
};

describe('the anvil runes', () => {
  it('cut the ritual\'s own alphabet, stroke for stroke', () => {
    // The ritual keeps its glyphs private; read every one it can draw from its stroke buffer.
    const runes = createRunes(), seen = new Set<string>();
    const slot = runes.mesh.geometry.getAttribute('aSlot'), ends = runes.mesh.geometry.getAttribute('aEnds');
    const key = (strokes: number[][]) => JSON.stringify(strokes.map(s => s.map(v => Math.round(v * 1000))));
    for (let seed = 1; seed < 400 && seen.size < FORGE_ALPHABET.length; seed++) {
      runes.setGlyphs(seed, RUNE_SLOTS);
      for (let r = 0; r < RUNE_SLOTS; r++) {
        const strokes: number[][] = [];
        for (let k = 0; k < 6; k++) { const v = (r * 6 + k) * 4; if (slot.getX(v) === r) strokes.push([ends.getX(v), ends.getY(v), ends.getZ(v), ends.getW(v)]); }
        seen.add(key(strokes));
      }
    }
    runes.dispose();
    // The ritual draws a dot as a short diagonal; the anvil punches it as a round pit.
    const ours = new Set(FORGE_ALPHABET.map((_, g) => key(glyphStrokes(g).map(([ax, ay, bx, by]) => ax === bx && ay === by ? [ax - .07, ay - .07, ax + .07, ay + .07] : [ax, ay, bx, by]))));
    expect(seen).toEqual(ours);
  });

  it('places seven over the mark, five behind, three shrinking down each horn flank and one at the heel', () => {
    const count = (face: string) => RUNE_SITES.filter(s => s.face === face).length;
    expect([count('+z plate'), count('-z plate'), count('+z horn'), count('-z horn'), count('heel')]).toEqual([7, 5, 3, 3, 1]);
    const front = RUNE_SITES.filter(s => s.face === '+z plate');
    expect(front.reduce((x, s) => x + s.centre.x, 0) / front.length).toBeCloseTo(MARK_CENTRE.x, 6);
    for (const face of ['+z horn', '-z horn']) {
      const horn = RUNE_SITES.filter(s => s.face === face).sort((a, b) => a.centre.x - b.centre.x);
      for (let i = 1; i < horn.length; i++) expect(horn[i]!.scale).toBeLessThan(horn[i - 1]!.scale);
    }
    // Ranked by distance from the mark: nearest ignites first and cools last.
    const ranked = [...RUNE_SITES].sort((a, b) => a.order - b.order);
    expect(ranked.map(s => s.order)).toEqual(RUNE_SITES.map((_, i) => i));
    for (let i = 1; i < ranked.length; i++) expect(ranked[i]!.centre.distanceTo(MARK_CENTRE)).toBeGreaterThanOrEqual(ranked[i - 1]!.centre.distanceTo(MARK_CENTRE));
  });

  it('cuts each rune into one flat face of iron, a centimetre clear of its arrises and never through it', () => {
    for (const site of RUNE_SITES) {
      const up = new THREE.Vector3().crossVectors(site.normal, site.right);
      const reachX = .75 * site.unit + site.halfWidth + .01, reachY = site.unit + site.halfWidth + .01;
      for (let u = -1; u <= 1; u += .125) for (let v = -1; v <= 1; v += .125) {
        const p = site.centre.clone().addScaledVector(site.right, u * reachX).addScaledVector(up, v * reachY);
        expect(cellAt(p.clone().addScaledVector(site.normal, -H / 2)), `${site.face} rune behind ${u},${v}`).toBe(ANVIL_MATERIALS.iron);
        expect(cellAt(p.clone().addScaledVector(site.normal, H / 2)), `${site.face} rune in front ${u},${v}`).toBe(0);
        expect(cellAt(p.clone().addScaledVector(site.normal, -site.depth - .005)), `${site.face} rune depth ${u},${v}`).not.toBe(0);
      }
    }
  });
});
