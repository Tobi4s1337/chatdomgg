import { asAtlasError } from '../errors';
import { readWithheldIds } from '../policy/visibility';
import { readLiveSource, type SourceLiveSnapshot } from '../source/sqlite';
import { buildFrame, followsGap, judgeSweep, regateFrame, SWEEP_RULE, type FrameCounts } from './frame';
import { publishFrame, pruneLiveTargets, readFrame, readLiveManifest, readLiveState, writeLiveState, type LiveSourceState, type PublishOutcome } from './store';
import { listPreviews, loadLiveTarget, type LiveTarget } from './target';

export interface LiveRunResult {
  state: LiveSourceState;
  targets: { previewId: string; outcome: PublishOutcome | 'failed'; frame: string | null; counts: FrameCounts | null; error: string | null }[];
  pruned: string[];
}

export interface LiveDeps {
  now?: () => number;
  /** Test seam: a source read other than the database file. */
  readSource?: () => SourceLiveSnapshot;
}

/**
 * The withheld list, read once per run. Live paint names no one, but a withheld channel must not keep a dab or a
 * wash either, so an unreadable list publishes nothing new (fail closed) and the last frame stays.
 */
function readWithheld(dataDir: string): ReadonlySet<string> {
  // The operator's list and every owner's own hide, read once: a channel hidden since the last sweep loses its wash now.
  return readWithheldIds(dataDir);
}

/**
 * One producer step: read the latest sweep, and when it is complete and newer than the published frames, publish a
 * frame for every preview this service still keeps. Anything less (partial, incoherent, dated in the future, an
 * unreadable source or moderation list) is recorded in the state and publishes nothing, so readers keep the last
 * complete frame with its own observation time.
 */
export async function runLive(dataDir: string, dbPath: string | null, cache: Map<string, LiveTarget>, deps: LiveDeps = {}): Promise<LiveRunResult> {
  const now = deps.now ?? Date.now;
  let previous: LiveSourceState | null = null;
  try {
    previous = readLiveState(dataDir);
  } catch {
    // A damaged state file is rewritten below; the manifests themselves still refuse any older frame.
  }
  const base = { version: 1 as const, completeAt: previous?.completeAt ?? null, rule: SWEEP_RULE.id };
  const previews = listPreviews(dataDir);
  const pruned = pruneLiveTargets(dataDir, new Set(previews));
  for (const id of cache.keys()) if (!previews.includes(id)) cache.delete(id);
  const finish = (state: LiveSourceState, targets: LiveRunResult['targets'] = []): LiveRunResult => {
    writeLiveState(dataDir, state);
    return { state, targets, pruned };
  };
  const targetFor = async (previewId: string): Promise<LiveTarget> => {
    let target = cache.get(previewId);
    if (!target) {
      target = await loadLiveTarget(dataDir, previewId);
      cache.set(previewId, target);
    }
    return target;
  };
  /**
   * Whatever the source says this run, the published frames are held to the current withheld list: a channel
   * withheld since the last complete sweep loses its wash, pennant or dab now, under the same observation time.
   */
  const regate = async (withheld: ReadonlySet<string>): Promise<LiveRunResult['targets']> => {
    const out: LiveRunResult['targets'] = [];
    for (const previewId of previews) {
      try {
        const current = readLiveManifest(dataDir, previewId);
        if (!current) continue;
        const target = await targetFor(previewId);
        const frame = await regateFrame(target, await readFrame(dataDir, previewId, current, target.alignment), withheld, now());
        if (!frame) continue;
        const published = await publishFrame(dataDir, previewId, frame, target.alignment);
        out.push({ previewId, outcome: published.outcome, frame: frame.frameId, counts: frame.counts, error: null });
      } catch (error) {
        cache.delete(previewId);
        out.push({ previewId, outcome: 'failed', frame: null, counts: null, error: asAtlasError(error, 'store').message.slice(0, 300) });
      }
    }
    return out;
  };

  let withheld: ReadonlySet<string>;
  try {
    withheld = readWithheld(dataDir);
  } catch (error) {
    return finish({ ...base, checkedAt: now(), state: 'moderation-unreadable', sweepAt: previous?.sweepAt ?? null, gapBefore: false, reason: `The withheld list could not be read: ${asAtlasError(error, 'store').message.slice(0, 200)}` });
  }
  let source: SourceLiveSnapshot;
  try {
    source = deps.readSource ? deps.readSource() : readLiveSource(dbPath, { now });
  } catch (error) {
    return finish({ ...base, checkedAt: now(), state: 'unavailable', sweepAt: previous?.sweepAt ?? null, gapBefore: false, reason: asAtlasError(error, 'inventory-missing').message.slice(0, 300) }, await regate(withheld));
  }
  const checkedAt = now();
  const sweep = judgeSweep(source, checkedAt);
  if (!sweep.ok) return finish({ ...base, checkedAt, state: sweep.state, sweepAt: sweep.sweepAt, gapBefore: false, reason: sweep.reason }, await regate(withheld));
  // Older than what was already published (the source was restored from a backup, or rows went missing): refuse.
  if (base.completeAt !== null && sweep.asOf < base.completeAt) {
    return finish({ ...base, checkedAt, state: 'incoherent', sweepAt: sweep.asOf, gapBefore: false, reason: 'The latest sweep is older than a frame already published; nothing rolls back.' }, await regate(withheld));
  }

  const targets: LiveRunResult['targets'] = [];
  /** The observation each target now shows; an older sweep that was refused does not move `completeAt` back. */
  const shown: number[] = [];
  for (const previewId of previews) {
    try {
      const target = await targetFor(previewId);
      const frame = await buildFrame(target, sweep, withheld, now());
      const published = await publishFrame(dataDir, previewId, frame, target.alignment);
      shown.push(published.manifest.evidence.asOf);
      targets.push({ previewId, outcome: published.outcome, frame: frame.frameId, counts: frame.counts, error: null });
    } catch (error) {
      cache.delete(previewId);
      targets.push({ previewId, outcome: 'failed', frame: null, counts: null, error: asAtlasError(error, 'store').message.slice(0, 300) });
    }
  }
  const anyPublished = targets.some((target) => target.outcome !== 'failed');
  return finish({
    ...base, checkedAt, state: 'complete', sweepAt: sweep.asOf,
    completeAt: anyPublished ? Math.max(...shown, base.completeAt ?? 0) : base.completeAt,
    gapBefore: followsGap(sweep), reason: anyPublished ? null : 'No preview could take the frame.',
  }, targets);
}
