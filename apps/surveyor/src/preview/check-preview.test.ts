import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDataDir, checkPreview } from '../check';
import { runImport, type ImportOutcome } from '../import';
import { readManifest } from '../store/revisions';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { previewIdFor } from './build';
import { PREVIEW_MANIFEST, previewDir } from './store';
import { allowRealImports } from '../test/timeouts';

allowRealImports();

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function published(outcome: ImportOutcome) {
  if (!outcome.ok) throw new Error(`import failed: ${outcome.error.code} ${outcome.error.message}`);
  return outcome;
}

async function imported() {
  const source = FixtureSource.standard();
  const dataDir = tempDataDir();
  cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
  const importAt = async (at: number) => published(await runImport(configFor(source, dataDir), {
    fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(at),
  }));
  const first = await importAt(sweepAt(10));
  return { source, dataDir, first, importAt };
}

describe('atlas:check survey preview', () => {
  it('passes a fresh import, whose current revision has its verified preview', async () => {
    const { dataDir, first } = await imported();
    expect(checkDataDir(dataDir)).toMatchObject({ ok: true, revision: first.revision, problems: [] });
    expect(checkPreview(dataDir, first.manifest)).toEqual([]);
  });

  it('fails when the current revision has no preview, and a re-import of the same revision draws it again', async () => {
    const { dataDir, first, importAt } = await imported();
    const id = previewIdFor(first.revision, first.manifest.asOf);
    rmSync(previewDir(dataDir, id), { recursive: true });
    expect(checkDataDir(dataDir)).toMatchObject({
      ok: false, revision: first.revision,
      problems: [`Survey preview ${id} for revision ${first.revision} is missing. Run atlas:preview to draw it from the local revision.`],
    });

    const again = await importAt(sweepAt(40));
    expect(again).toMatchObject({ outcome: 'unchanged', preview: { id, outcome: 'written' } });
    expect(checkDataDir(dataDir).ok).toBe(true);
  });

  it('fails a tampered, foreign or polluted preview with a clear message naming the preview', async () => {
    const { dataDir, first } = await imported();
    const id = first.preview.id;
    const dir = previewDir(dataDir, id);
    const prefix = `Survey preview ${id}: `;

    const chunkPath = join(dir, 'region-0.json');
    const original = readFileSync(chunkPath);
    const flipped = Buffer.from(original);
    flipped[25] = flipped[25]! ^ 0x01;
    writeFileSync(chunkPath, flipped);
    const tampered = checkDataDir(dataDir);
    expect(tampered.ok).toBe(false);
    // The hash mismatch comes first; the holdings it no longer vouches for are then missing from the counts.
    expect(tampered.problems[0]).toBe(`${prefix}region-0.json does not match its hash in world.json.`);
    expect(tampered.problems.every((problem) => problem.startsWith(prefix))).toBe(true);
    writeFileSync(chunkPath, original);
    expect(checkDataDir(dataDir).ok).toBe(true);

    const worldPath = join(dir, 'world.json');
    const world = readFileSync(worldPath);
    writeFileSync(worldPath, world.subarray(0, world.length - 2));
    expect(checkDataDir(dataDir).problems).toEqual([`${prefix}preview world.json does not match its manifest hash.`]);
    writeFileSync(worldPath, world);

    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(checkDataDir(dataDir).problems).toEqual([`${prefix}unexpected file notes.txt in the preview.`]);
    rmSync(join(dir, 'notes.txt'));

    // A manifest claiming another revision: the preview at this ID is not this revision's land.
    const manifestPath = join(dir, PREVIEW_MANIFEST);
    const manifest = readFileSync(manifestPath, 'utf8');
    const other = 'obs-20261030T000000Z-ffffffffffff';
    writeFileSync(manifestPath, manifest.replace(first.revision, other));
    expect(checkDataDir(dataDir).problems).toEqual(expect.arrayContaining([
      `${prefix}preview belongs to a different revision.`, `${prefix}preview world and manifest disagree.`,
    ]));
    writeFileSync(manifestPath, '{');
    expect(checkDataDir(dataDir).problems).toEqual([expect.stringMatching(new RegExp(`^${prefix}preview unreadable: `))]);
    writeFileSync(manifestPath, manifest);
    expect(checkDataDir(dataDir)).toMatchObject({ ok: true, problems: [] });
  });

  it('checks the preview of the revision asked for, not the current one', async () => {
    const { source, dataDir, first, importAt } = await imported();
    source.addSweeps(1);
    source.db.prepare('UPDATE channels SET last_live = ? WHERE live = 1').run(sweepAt(5));
    const second = await importAt(sweepAt(30));
    expect(second.revision).not.toBe(first.revision);

    rmSync(previewDir(dataDir, first.preview.id), { recursive: true });
    expect(checkDataDir(dataDir)).toMatchObject({ ok: true, revision: second.revision });
    const older = checkDataDir(dataDir, first.revision);
    expect(older).toMatchObject({ ok: false, revision: first.revision });
    expect(older.problems).toEqual([`Survey preview ${first.preview.id} for revision ${first.revision} is missing. Run atlas:preview to draw it from the local revision.`]);
    expect(checkPreview(dataDir, readManifest(dataDir, second.revision).manifest)).toEqual([]);
  });

  it('reports a corrupt revision and a missing preview together', async () => {
    const { dataDir, first } = await imported();
    rmSync(previewDir(dataDir, first.preview.id), { recursive: true });
    writeFileSync(join(dataDir, 'revisions', first.revision, 'debug-dump.json'), '{}');
    expect(checkDataDir(dataDir).problems).toEqual([
      'Unexpected file debug-dump.json in the revision.',
      `Survey preview ${first.preview.id} for revision ${first.revision} is missing. Run atlas:preview to draw it from the local revision.`,
    ]);
  });
});
