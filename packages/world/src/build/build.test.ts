import { expect, it } from 'vitest';
import { cellIndex, StyleIdSchema, VoxelBlueprintSchema, type BuildDraftPolicy } from '@chatdom/shared';
import { BuildDraft, prepareBuildPublication, previewBuildPublication, submitBuildPublication } from './index';

it('keeps one citizen’s editable house through undo, save and an honest publication boundary', async () => {
  const policy: BuildDraftPolicy = { plotId: 'plot:juniper', ownerId: 'citizen:juniper', styleId: StyleIdSchema.parse('hearth'),
    size: [24, 24, 24], editableFrom: [0, 0, 0], editableTo: [24, 24, 24], maxVoxels: 6000,
    palette: [4, 5, 6, 8, 14], shaping: { wall: [6], roof: [8], trim: 5, stone: 4, glass: 14 } };
  const draft = new BuildDraft(policy);
  draft.apply([
    { kind: 'place', from: [4, 0, 4], to: [20, 2, 20], material: 4 },
    { kind: 'place', from: [4, 2, 4], to: [20, 14, 20], material: 6 },
    { kind: 'erase', from: [6, 2, 6], to: [18, 14, 18] },
    { kind: 'erase', from: [12, 2, 18], to: [16, 12, 20] },
    { kind: 'place', from: [3, 14, 3], to: [21, 16, 21], material: 8 },
    { kind: 'place', from: [7, 6, 19], to: [11, 12, 20], material: 14 },
  ]);
  const before = draft.serialize();
  draft.beginGesture();
  draft.apply({ kind: 'place', from: [1, 0, 1], to: [2, 4, 2], material: 5, mirror: 'x' });
  draft.apply({ kind: 'place', from: [2, 0, 1], to: [3, 4, 2], material: 5, mirror: 'x' });
  draft.endGesture();
  expect(draft.get([22, 3, 1])).toBe(5);
  draft.apply({ kind: 'fill', at: [1, 0, 1], material: 4, mirror: 'x' });
  expect(draft.get([22, 3, 1])).toBe(4);
  draft.undo(); draft.undo();
  expect(draft.serialize().runs).toEqual(before.runs);
  draft.redo(); draft.undo();
  const unchanged = draft.serialize();
  expect(() => draft.apply([
    { kind: 'paint', from: [4, 2, 4], to: [6, 14, 6], material: 5 },
    { kind: 'place', from: [23, 0, 23], to: [25, 1, 24], material: 6 },
  ])).toThrow(/plot/);
  expect(draft.serialize()).toEqual(unchanged);
  expect(() => draft.apply({ kind: 'place', from: [0, 0, 0], to: [24, 24, 24], material: 6 })).toThrow(/allowance/);
  expect(() => draft.apply({ kind: 'paint', from: [4, 0, 4], to: [5, 1, 5], material: 99 })).toThrow(/material/);

  const restored = new BuildDraft(policy, JSON.parse(JSON.stringify(draft.serialize())));
  expect(restored.cloneVoxels()).toEqual(draft.cloneVoxels());
  expect(() => new BuildDraft({ ...policy, ownerId: 'someone-else' }, draft.serialize())).toThrow(/another plot/);
  const raw = restored.cloneVoxels(), shaped = restored.compile();
  expect(shaped.windows).toHaveLength(1);
  expect(shaped.windows[0]).toMatchObject({ width: 4, height: 6, facing: 'south' });
  expect(shaped.asset.voxels).not.toEqual(raw);
  expect(restored.cloneVoxels()).toEqual(raw);
  const blueprint = restored.toBlueprint();
  expect(VoxelBlueprintSchema.safeParse(blueprint).success).toBe(true);
  expect(blueprint.boxes.length).toBeLessThan(100);

  const candidate = prepareBuildPublication(restored, { ownerName: 'Juniper', name: 'Juniper’s Hearth' });
  const preview = previewBuildPublication(candidate);
  expect(preview).toMatchObject({ mode: 'SIMULATED', status: 'local-preview', housewarming: { durationMs: 6000, ownerName: 'Juniper' } });
  await expect(submitBuildPublication(candidate)).rejects.toThrow(/review service/);
  await expect(submitBuildPublication(candidate, { reviewAndPublish: async () => ({ status: 'held', revision: candidate.revision, message: 'The Watch is reviewing this home.' }) })).resolves.toMatchObject({ status: 'held' });
  restored.apply({ kind: 'erase', from: [7, 6, 19], to: [11, 12, 20] });
  expect(candidate.blueprint.windows).toHaveLength(1);
  expect(restored.compile().windows).toHaveLength(0);
  restored.undo();
  const copy = new BuildDraft(policy);
  copy.insertBlueprint(restored.toRawBlueprint(), [0, 0, 0]);
  expect(copy.cloneVoxels()).toEqual(raw);
  copy.undo(); expect(copy.voxelCount).toBe(0);
});

it('finishes a wall box and flat cap as a framed pitched house without rewriting the citizen’s geometry', () => {
  const policy: BuildDraftPolicy = { plotId: 'plot:roof', ownerId: 'citizen:roof', styleId: StyleIdSchema.parse('hearth'),
    size: [32, 44, 32], editableFrom: [4, 0, 4], editableTo: [28, 40, 28], maxVoxels: 6000,
    palette: [4, 5, 6, 8, 14], shaping: { wall: [6], roof: [8], trim: 5, stone: 4, glass: 14 } };
  const draft = new BuildDraft(policy);
  draft.apply([
    { kind: 'place', from: [8, 0, 8], to: [24, 2, 24], material: 4 },
    { kind: 'place', from: [8, 2, 8], to: [24, 18, 24], material: 6 },
    { kind: 'erase', from: [10, 2, 10], to: [22, 18, 22] },
    { kind: 'erase', from: [17, 2, 22], to: [21, 18, 24] },
    { kind: 'place', from: [10, 6, 23], to: [14, 12, 24], material: 14 },
    { kind: 'place', from: [7, 18, 7], to: [25, 20, 25], material: 8 },
    { kind: 'place', from: [19, 18, 10], to: [22, 29, 13], material: 4 },
  ]);
  const saved = draft.serialize(), raw = draft.cloneVoxels(), occupied = draft.voxelCount;
  // The source can already use its entire earned allowance; ordinary automatic details are not bought blocks.
  const full = new BuildDraft({ ...policy, maxVoxels: occupied }, saved), { asset, windows } = full.compile();
  const at = (x: number, y: number, z: number) => asset.voxels[cellIndex(x, y, z, 32, 44)];
  const roofTop = (x: number, z: number) => {
    for (let y = 39; y >= 0; y--) if (at(x, y, z) === 8) return y;
    return -1;
  };
  expect(roofTop(15, 16)).toBeGreaterThan(roofTop(6, 16) + 6);
  expect(roofTop(15, 16)).toBe(roofTop(16, 16));
  expect(roofTop(9, 16)).toBe(roofTop(22, 16));
  expect(at(15, 22, 16)).toBe(0); // A roof shell, not a solid wedge filling the attic.
  expect(at(12, 22, 23)).toBe(6); // The gable closes on the authored end wall.
  expect(at(15, 22, 23)).toBe(5);
  expect(at(20, 28, 11)).toBe(4); // A narrow authored chimney pierces the roof without suppressing it.
  expect(at(6, 17, 16)).toBe(5); // Projecting eave fascia.
  expect(at(14, 17, 23)).toBe(5); // Wall plate ties the corner posts together.
  expect(at(11, 8, 23)).toBe(14);
  expect(at(11, 8, 24)).toBe(0); // The pane's outward face stays visible to the presence renderer.
  expect(windows).toHaveLength(1);
  expect(windows[0]).toMatchObject({ facing: 'south', width: 4, height: 6 });
  expect(full.voxelCount).toBe(occupied);
  expect(full.serialize()).toEqual(saved);
  expect(full.cloneVoxels()).toEqual(raw);
  let generated = 0, escaped = false, offPalette = false;
  for (let z = 0; z < 32; z++) for (let y = 0; y < 44; y++) for (let x = 0; x < 32; x++) {
    const material = at(x, y, z)!;
    if (!material) continue;
    generated++;
    escaped ||= x < 4 || x >= 28 || y >= 40 || z < 4 || z >= 28;
    offPalette ||= !policy.palette.includes(material);
  }
  expect(generated).toBeGreaterThan(occupied);
  expect(escaped || offPalette).toBe(false);

  // A deliberate ridge makes this an authored roof; a hole makes it an irregular footprint. Neither is infilled.
  draft.apply({ kind: 'place', from: [15, 20, 7], to: [17, 25, 25], material: 8 });
  const deliberate = draft.compile().asset.voxels;
  expect(deliberate[cellIndex(11, 24, 16, 32, 44)]).toBe(0);
  expect(deliberate[cellIndex(15, 24, 16, 32, 44)]).toBe(8);
  draft.undo();
  draft.apply({ kind: 'erase', from: [14, 18, 14], to: [18, 20, 18] });
  expect(draft.compile().asset.voxels[cellIndex(15, 27, 16, 32, 44)]).toBe(0);
});
