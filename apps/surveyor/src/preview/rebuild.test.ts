import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runImport } from '../import';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, tempDataDir } from '../test/fixture-source';
import { allowRealImports } from '../test/timeouts';
import { rebuildPreview } from './rebuild';
import { previewDir } from './store';
import { revisionDir } from '../store/revisions';
allowRealImports();
const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
async function imported() {
  const source = FixtureSource.standard();
  const dataDir = tempDataDir();
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const result = await runImport(configFor(source, dataDir), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock() });
  source.close();
  if (!result.ok) throw new Error(result.error.message);
  // The collector is gone: rebuilding must use only the verified local snapshot.
  return { dataDir, result };
}
describe('rebuild a preview without the collector', () => {
  it('reproduces the exact bytes, retaining the import pointer and ledger', async () => {
    const { dataDir, result } = await imported();
    const dir = previewDir(dataDir, result.preview.id);
    const world = readFileSync(join(dir, 'world.json'));
    const pointer = readFileSync(join(dataDir, 'current.json'));
    const ledger = readFileSync(join(dataDir, 'ledger', 'imports.ndjson'));
    rmSync(dir, { recursive: true });
    expect(rebuildPreview(dataDir)).toEqual({ id: result.preview.id, outcome: 'written' });
    expect(readFileSync(join(dir, 'world.json'))).toEqual(world);
    expect(readFileSync(join(dataDir, 'current.json'))).toEqual(pointer);
    expect(readFileSync(join(dataDir, 'ledger', 'imports.ndjson'))).toEqual(ledger);
    expect(rebuildPreview(dataDir).outcome).toBe('existing');
  });
  it('refuses corrupt source bytes and preserves the existing preview', async () => {
    const { dataDir, result } = await imported();
    const dir = previewDir(dataDir, result.preview.id);
    const world = readFileSync(join(dir, 'world.json'));
    writeFileSync(join(revisionDir(dataDir, result.revision), 'channels.ndjson'), '{}\n');
    expect(() => rebuildPreview(dataDir)).toThrow(/failed verification/);
    expect(readFileSync(join(dir, 'world.json'))).toEqual(world);
  });
});
