import { describe, expect, it } from 'vitest';
import { BuildDraft, BuildError } from '@chatdom/world';
import { STYLES } from '@chatdom/content';
import { HOME_BUILD_LIMITS, type VoxelBlueprint } from '@chatdom/shared';
import { BLUEPRINTS, createBuildTemplate, activeRear } from '../../../../packages/content/src/templates';
import { FINISHED_CHOICES, SelectionError, readSelection, reviewEditCell, reviewPolicy } from './selection';

const first = FINISHED_CHOICES[0]!;
/** Byte equality of whole occupancy grids; a structural diff of a million cells is needlessly slow. */
const same = (a: Uint16Array, b: Uint16Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

describe('a starting shape becomes the citizen’s own voxels', () => {
  it('inserts as one step, edits a wall, undoes back to the empty plot and redoes exactly', () => {
    const policy = reviewPolicy(first.style, first.tier);
    const draft = new BuildDraft(policy);
    const empty = draft.serialize();

    const inserted = draft.insertBlueprint(createBuildTemplate(first.style, first.form, first.tier), [0, 0, 0]);
    expect(inserted.changed).toBeGreaterThan(0);
    expect(draft.voxelCount).toBe(inserted.voxelCount);
    expect(draft.voxelCount).toBeLessThan(HOME_BUILD_LIMITS[first.tier].maxVoxels);
    const afterInsert = draft.serialize(), cellsAfterInsert = draft.cloneVoxels();

    const wall = reviewEditCell(draft, first);
    expect(draft.get(wall)).toBe(STYLES[first.style].wall);
    draft.apply({ kind: 'erase', from: [...wall], to: [wall[0] + 1, wall[1] + 1, wall[2] + 1] });
    expect(draft.get(wall)).toBe(0);
    expect(draft.voxelCount).toBe(afterInsert.runs.reduce((n, run) => n + run[1], 0) - 1);

    draft.undo();
    expect(draft.get(wall)).toBe(STYLES[first.style].wall);
    expect(same(draft.cloneVoxels(), cellsAfterInsert)).toBe(true);
    draft.undo();
    expect(draft.serialize().runs).toEqual(empty.runs);
    expect(draft.voxelCount).toBe(0);
    expect(draft.canUndo).toBe(false);

    draft.redo();
    expect(same(draft.cloneVoxels(), cellsAfterInsert)).toBe(true);
    expect(draft.serialize().runs).toEqual(afterInsert.runs);
    // The executed shape compiles to production geometry with windows derived from its own glass.
    expect(draft.compile().windows.length).toBeGreaterThan(0);
  }, 60_000);

  it('refuses a source that reaches the locked rear land and leaves the draft untouched', () => {
    const policy = reviewPolicy(first.style, first.tier);
    const draft = new BuildDraft(policy);
    draft.insertBlueprint(createBuildTemplate(first.style, first.form, first.tier), [0, 0, 0]);
    const before = draft.serialize(), revision = draft.revision, canRedo = draft.canRedo;
    const rear = activeRear(first.tier);
    const trespass: VoxelBlueprint = { ...createBuildTemplate(first.style, first.form, first.tier) };
    trespass.boxes = [...trespass.boxes, { from: [20, 0, rear - 4], to: [28, 4, rear], material: STYLES[first.style].stone }];
    expect(() => draft.insertBlueprint(trespass, [0, 0, 0])).toThrow(BuildError);
    expect(() => draft.insertBlueprint(trespass, [0, 0, 0])).toThrow(/unlocked plot/);
    expect(draft.serialize()).toEqual(before);
    expect([draft.revision, draft.canRedo, draft.canUndo]).toEqual([revision, canRedo, true]);
  }, 60_000);

  it('fits every finished shape into its own tier’s policy', () => {
    for (const blueprint of BLUEPRINTS) {
      const choice = FINISHED_CHOICES.find(c => blueprint.id.endsWith(`${c.style}-${c.form}-${c.tier}`))!;
      const draft = new BuildDraft(reviewPolicy(choice.style, choice.tier));
      expect(() => draft.insertBlueprint(blueprint, [0, 0, 0]), blueprint.id).not.toThrow();
    }
  });
});

describe('review selectors', () => {
  it('chooses the first finished shape only when nothing is asked for', () => {
    expect(readSelection('')).toMatchObject({ ...first, angle: 'front', hour: 19 });
  });

  it('names a refused selector instead of quietly substituting another', () => {
    expect(() => readSelection('?style=marble')).toThrow(SelectionError);
    expect(() => readSelection('?form=tower')).toThrow(/no shape called “tower”/);
    expect(() => readSelection('?angle=top')).toThrow(/no view/);
    expect(() => readSelection('?hour=25')).toThrow(/whole hour/);
    expect(() => readSelection('?seed=Not%20Ok')).toThrow(/seed/);
  });
});
