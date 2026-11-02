import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImport } from '../import';
import { sha256 } from '../export/project';
import { layout, readCurrent, revisionDir } from '../store/revisions';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor } from '../test/fixture-source';
import { RoadLedger } from './ledger';
import { backfillPairs } from './backfill-pairs';

const dirs: string[] = []; const sources: FixtureSource[] = [];
afterEach(() => { for (const s of sources.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'road-pairs-')); dirs.push(dir);
  const source = FixtureSource.standard(); sources.push(source);
  const result = await runImport(configFor(source, dir), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(), sleep: async () => {} });
  if (!result.ok) throw new Error(result.error.message);
  const pointer = readCurrent(dir)!;
  const manifestPath = join(revisionDir(dir, pointer.revision), 'import.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const pairPath = join(revisionDir(dir, pointer.revision), manifest.files.raidPairs.path);
  return { dir, pointer, manifestPath, manifest, pairPath };
}
const signal = () => new AbortController().signal;

it('imports aggregate pairs even when the older recorder checkpoint already matches', async () => {
  const { dir, pointer } = await fixture(); const ledger = new RoadLedger(dir);
  try {
    ledger.advance('surveyor-recorder', null, pointer.revision);
    expect(await backfillPairs(dir, ledger, signal())).toMatchObject({ stored: 1 });
    expect(ledger.checkpoint('surveyor-pair-import')).toBe(pointer.revision);
    expect(ledger.roads()).toHaveLength(1);
    expect(await backfillPairs(dir, ledger, signal())).toEqual({ stored: 0, duplicates: 0 });
  } finally { ledger.close(); }
});

it.each(['hash mismatch', 'invalid schema', 'after source cut'])('rejects %s before writing any aggregate or checkpoint', async damage => {
  const { dir, pointer, manifest, manifestPath, pairPath } = await fixture();
  const pair = JSON.parse(readFileSync(pairPath, 'utf8').trim());
  if (damage === 'hash mismatch') {
    pair.viewersTotal += 1;
    writeFileSync(pairPath, JSON.stringify(pair) + '\n');
  } else {
    if (damage === 'invalid schema') pair.unexpected = true;
    else pair.lastAt = manifest.source.database.openedAt + 1;
    const bytes = Buffer.from(JSON.stringify(pair) + '\n'); writeFileSync(pairPath, bytes);
    manifest.files.raidPairs.bytes = bytes.length; manifest.files.raidPairs.sha256 = sha256(bytes);
    const manifestBytes = JSON.stringify(manifest); writeFileSync(manifestPath, manifestBytes);
    writeFileSync(layout(dir).current, JSON.stringify({ ...pointer, manifestSha256: sha256(manifestBytes) }));
  }
  const ledger = new RoadLedger(dir);
  try {
    await expect(backfillPairs(dir, ledger, signal())).rejects.toThrow();
    expect(ledger.roads()).toHaveLength(0);
    expect(ledger.checkpoint('surveyor-pair-import')).toBeNull();
  } finally { ledger.close(); }
});
