import { expect, it } from 'vitest';
import { StyleIdSchema, VoxelBlueprintSchema, type BuildDraftPolicy } from '@chatdom/shared';
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
