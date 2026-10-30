import type { ImportConfig } from './config';
import { asAtlasError, type AtlasError } from './errors';
import { assertRevisionDir } from './check';
import { projectSnapshot } from './export/project';
import type { ChannelObservation, Game, SnapshotManifest } from './export/schema';
import { buildAndWritePreview, prunePreviews } from './preview/store';
import { readSurveyorHttp } from './source/http';
import { readSourceSnapshot } from './source/sqlite';
import { acquireLock, appendLedger, layout, publishRevision, readCurrent } from './store/revisions';
import { readdirSync } from 'node:fs';

export interface ImportDeps {
  now?: () => number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Test seam inside the source read transaction. */
  afterFirstRead?: () => void;
  /** Test seam between verification and the pointer swap. */
  beforePublish?: () => void;
}

export type ImportOutcome =
  | { ok: true; outcome: 'published' | 'unchanged'; revision: string; manifest: SnapshotManifest; pruned: string[]; preview: { id: string; outcome: 'written' | 'existing' } }
  | { ok: false; error: AtlasError; currentRevision: string | null };

/**
 * One import: HTTP status and recent aggregates, then one read-only database transaction, then an atomically
 * published revision. A failure anywhere leaves the previous revision current and is written to the ledger.
 */
export async function runImport(config: ImportConfig, deps: ImportDeps = {}): Promise<ImportOutcome> {
  const now = deps.now ?? Date.now;
  let release: (() => void) | null = null;
  try {
    release = acquireLock(config.dataDir);
    const http = await readSurveyorHttp(config.surveyorBaseUrl, {
      timeoutMs: config.httpTimeoutMs,
      now,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    });
    const source = readSourceSnapshot(config.surveyorDbPath, { now, ...(deps.afterFirstRead ? { afterFirstRead: deps.afterFirstRead } : {}) });
    const projected = projectSnapshot(http, source, { importedAt: now(), keepRevisions: config.keepRevisions });
    // The survey preview is drawn before the pointer swap: a revision never becomes current without its land.
    const preview = buildAndWritePreview(config.dataDir, {
      manifest: projected.manifest,
      channels: ndjsonRecords<ChannelObservation>(projected.files.bytes.channels),
      games: ndjsonRecords<Game>(projected.files.bytes.games),
    });
    const result = publishRevision(config.dataDir, projected, {
      now,
      keepRevisions: config.keepRevisions,
      verify: (dir) => {
        assertRevisionDir(dir);
        deps.beforePublish?.();
      },
    });
    prunePreviews(config.dataDir, new Set(readdirSync(layout(config.dataDir).revisions)));
    appendLedger(config.dataDir, {
      at: now(), outcome: result.outcome, revision: result.revision, asOf: projected.manifest.asOf, code: null, message: null,
      details: [`preview ${preview.id} ${preview.outcome}`],
    });
    return { ok: true, ...result, manifest: projected.manifest, preview };
  } catch (thrown) {
    const error = asAtlasError(thrown, 'store');
    try {
      appendLedger(config.dataDir, {
        at: now(), outcome: 'failed', revision: null, asOf: null, code: error.code, message: error.message, details: [...error.details],
      });
    } catch {
      // The ledger is evidence, not a precondition; a full disk must not mask the original failure.
    }
    return { ok: false, error, currentRevision: currentOrNull(config.dataDir) };
  } finally {
    release?.();
  }
}

function currentOrNull(dataDir: string): string | null {
  try {
    return readCurrent(dataDir)?.revision ?? null;
  } catch {
    return null;
  }
}

function ndjsonRecords<T>(bytes: Uint8Array): T[] {
  const text = new TextDecoder().decode(bytes);
  const records: T[] = [];
  for (const line of text.split('\n')) if (line) records.push(JSON.parse(line) as T);
  return records;
}
