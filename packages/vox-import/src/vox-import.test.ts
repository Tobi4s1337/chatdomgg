import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MAT, MATERIALS, STYLES } from '@chatdom/content';
import type { BuildDraftPolicy, Vec3 } from '@chatdom/shared';
import { BuildDraft } from '@chatdom/world';
import { parseVox, prepareVoxImport, voxPlacementError, type VoxFile, type VoxScale } from './index';

const bytes = new Uint8Array(readFileSync(new URL('../fixtures/lantern-cottage.vox', import.meta.url)));
const style = STYLES.hearth;
const policy: BuildDraftPolicy = {
  plotId: 'plot:juniper', ownerId: 'citizen:juniper', styleId: style.id, size: [64, 160, 128],
  editableFrom: [0, 0, 48], editableTo: [64, 64, 128], maxVoxels: 49152,
  palette: [style.wall, style.roof, style.trim, style.stone, MAT.glass, MAT.earth, MAT.grass, MAT.leaf, MAT.moss, MAT.bark, MAT.petal, MAT.blueFlower, MAT.brass, MAT.cloth],
  shaping: { wall: [style.wall], roof: [style.roof], trim: style.trim, stone: style.stone, glass: MAT.glass },
};
const materials = policy.palette.map(id => MATERIALS.materials.find(m => m.id === id)!);
const prepare = (file: VoxFile, scale: VoxScale, origin: Vec3 = [20, 0, 90]) =>
  prepareVoxImport({ file, model: 0, materials, styleId: policy.styleId, scale, origin, destination: policy });
const offsetOf = (id: string) => Buffer.from(bytes).indexOf(id, 8, 'latin1');
const rgb = (file: VoxFile, index: number) => [...file.palette.subarray(index * 4, index * 4 + 4)];

it('reads the authored cottage upright in kingdom materials and refuses broken bytes without touching the draft', () => {
  const parsed = parseVox(bytes);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const file = parsed.file;
  expect(file.models.map(m => [m.size, m.count])).toEqual([[[20, 16, 26], 1745], [[6, 6, 14], 37]]);
  expect(file.paletteSource).toBe('file');
  expect(rgb(file, 1)).toEqual([230, 211, 174, 255]); // the first RGBA record is colour index 1
  expect(file.scene).toMatchObject({ nodes: 6, placements: 2, instanced: false, animated: false });
  expect([file.effects.get(6), file.effects.get(10)]).toEqual(['glass', 'emit']);

  const prepared = prepare(file, 1);
  if (!prepared.ok) throw new Error(prepared.error.message);
  const { blueprint, origin, summary } = prepared;
  expect(summary.uprightSize).toEqual([18, 24, 16]);
  expect(blueprint).toMatchObject({ size: [18, 24, 16], lattice: 'build', kind: 'prop', styleId: 'hearth', windows: [] });
  expect(summary.effects).toEqual(['glass']);
  expect(summary.materials.find(m => m.id === MAT.plaster)?.sources[0]).toBe('#e6d3ae');

  const draft = new BuildDraft(policy);
  expect(draft.insertBlueprint(blueprint, origin).voxelCount).toBe(1745);
  // MagicaVoxel (x, y, z-up) lands at build (x - 1, z, 15 - y) after trimming empty bounds.
  const at = (x: number, y: number, z: number) => draft.get([origin[0] + x, origin[1] + y, origin[2] + z]);
  expect(at(4, 4, 13)).toBe(MAT.bark); // the door, left of centre on the street side
  expect(at(5, 5, 14)).not.toBe(0); // its black knob stays a block
  expect([at(3, 10, 14), at(4, 10, 14)]).toEqual([MAT.brass, MAT.blueFlower]); // two-colour emblem
  expect(at(13, 23, 5)).toBe(MAT.cloth); // chimney top: back right, standing upright
  expect(at(4, 23, 10)).toBe(0);
  expect([at(0, 0, 0), at(0, 0, 1), at(1, 2, 2)]).toEqual([0, MAT.limestone, MAT.plaster]); // eaves overhang the foundation

  const half = prepare(file, 0.5), double = prepare(file, 2), quadruple = prepare(file, 4);
  expect(half.ok && half.summary).toMatchObject({ size: [9, 12, 8], reduced: true });
  expect(double.ok && double.summary).toMatchObject({ size: [36, 48, 32], boxes: summary.boxes, cells: 1745 * 8 });
  expect(quadruple.ok ? null : quadruple.error).toMatchObject({ code: 'destination', remedy: 'Try 2×.' });

  // Raised past the 64-block height and pushed behind the plot: the same blueprint, honestly outside, and the core agrees.
  expect(summary.placement.inside).toBe(true);
  const outside = prepare(file, 2, [0, 20, 40]);
  if (!outside.ok) throw new Error(outside.error.message);
  expect(outside.summary.placement.over).toEqual([[0, 0], [0, 4], [8, 0]]);
  expect(voxPlacementError(outside.summary.placement, policy)).toMatchObject({ code: 'placement', message: 'It reaches 4 blocks above your 64-block height and 8 blocks behind the back of your plot.' });
  const before = draft.serialize();
  expect(() => draft.insertBlueprint(outside.blueprint, outside.origin)).toThrow();
  expect(draft.serialize()).toEqual(before);
  expect(prepare(file, 1, [50, 0, 90]).ok ? 'accepted' : 'refused').toBe('refused'); // past the lattice is never a blueprint origin

  // Without RGBA the documented default table applies unshifted: index 1 is white, index 255 is #111111.
  const rgba = offsetOf('RGBA'), stripped = new Uint8Array(bytes.length - 1036);
  stripped.set(bytes.subarray(0, rgba)); stripped.set(bytes.subarray(rgba + 1036), rgba);
  new DataView(stripped.buffer).setUint32(16, new DataView(bytes.buffer, bytes.byteOffset).getUint32(16, true) - 1036, true);
  const plain = parseVox(stripped);
  expect(plain.ok && [plain.file.paletteSource, rgb(plain.file, 1), rgb(plain.file, 255)]).toEqual(['default', [255, 255, 255, 255], [17, 17, 17, 255]]);

  const accepted = draft.serialize();
  const corrupt = (edit: (b: Uint8Array, v: DataView) => void, length = bytes.length) => {
    const b = bytes.slice(0, length); edit(b, new DataView(b.buffer)); return parseVox(b);
  };
  const xyzi = offsetOf('XYZI');
  const failures = [
    corrupt(() => {}, bytes.length - 100),
    corrupt(b => { b[0] = 0x50; }),
    corrupt((_, v) => v.setUint32(xyzi + 12, 0x7fffffff, true)),
    corrupt(b => { b[xyzi + 16] = 200; }),
    corrupt((_, v) => v.setUint32(4, 151, true)),
  ];
  expect(failures.map(f => f.ok ? 'accepted' : f.error.code)).toEqual(['truncated', 'not-vox', 'limit', 'voxel', 'version']);
  for (const f of failures) expect(f.ok ? '' : f.error.remedy).toMatch(/\w/);
  expect(draft.serialize()).toEqual(accepted);
});
