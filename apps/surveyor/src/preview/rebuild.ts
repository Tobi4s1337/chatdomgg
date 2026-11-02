import { checkRevisionDir } from '../check';
import { AtlasError } from '../errors';
import { sha256 } from '../export/project';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquireLock, MANIFEST_FILE, readCurrent, revisionDir } from '../store/revisions';
import { buildAndWritePreview } from './store';

/** Rebuild derived land from a verified local revision. Never opens the collector or founds an edition. */
export function rebuildPreview(dataDir: string): { id: string; outcome: 'written' | 'existing' } {
  const release = acquireLock(dataDir);
  try {
    const pointer = readCurrent(dataDir);
    if (!pointer) throw new AtlasError('check', 'No imported revision is available for drawing.');
    const dir = revisionDir(dataDir, pointer.revision);
    const report = checkRevisionDir(dir);
    if (!report.ok || !report.manifest || !report.records) {
      throw new AtlasError('check', 'The local revision failed verification; no preview was drawn.', report.problems);
    }
    if (sha256(readFileSync(join(dir, MANIFEST_FILE))) !== pointer.manifestSha256) {
      throw new AtlasError('check', 'The local revision does not match current.json; no preview was drawn.');
    }
    return buildAndWritePreview(dataDir, { manifest: report.manifest, channels: report.records.channels, games: report.records.games });
  } finally { release(); }
}
