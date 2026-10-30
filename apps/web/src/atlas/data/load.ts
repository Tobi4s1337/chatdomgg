import { fetchPointer, fetchWorld, PreviewError, validatePointer, type PreviewPointer, type PreviewSource, type PreviewWorld } from './preview';

/** The preview a tab first drew stays its preview: a new survey never redraws the land under someone's cursor. */
export const PIN_KEY = 'chatdom.atlas.preview.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadedPreview {
  pointer: PreviewPointer;
  world: PreviewWorld;
  /** A newer survey the service now offers, while this session keeps drawing the pinned one. */
  newer: PreviewPointer | null;
}

function readPin(storage: StorageLike | null): PreviewPointer | null {
  const raw = storage?.getItem(PIN_KEY);
  if (!raw) return null;
  try {
    return validatePointer(JSON.parse(raw) as unknown);
  } catch {
    storage?.removeItem(PIN_KEY);
    return null;
  }
}

function writePin(storage: StorageLike | null, pointer: PreviewPointer): void {
  try {
    storage?.setItem(PIN_KEY, JSON.stringify(pointer));
  } catch {
    // Private mode or a full quota: the session simply is not pinned.
  }
}

/**
 * Read the current pointer, then the world it names. If this session already drew an earlier preview that the
 * service still serves, keep drawing that one and report the newer survey instead. A pinned preview that has been
 * pruned (or fails its hash) falls back to the current one.
 */
export async function loadPreview(source: PreviewSource, storage: StorageLike | null, signal?: AbortSignal): Promise<LoadedPreview> {
  const pinned = readPin(storage);
  const current = await fetchPointer(source, signal);
  if (pinned && pinned.id !== current.id && pinned.asOf < current.asOf) {
    try {
      const world = await fetchWorld(source, pinned, signal);
      return { pointer: pinned, world, newer: current };
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      if (!(error instanceof PreviewError)) throw error;
    }
  }
  const world = await fetchWorld(source, current, signal);
  writePin(storage, current);
  return { pointer: current, world, newer: null };
}

/** Accept the newer survey: the next load draws it. */
export function adoptPreview(storage: StorageLike | null, pointer: PreviewPointer): void {
  writePin(storage, pointer);
}
