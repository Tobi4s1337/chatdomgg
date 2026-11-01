import { PreviewError } from './data/preview';

/** Only the Atlas data reader can declare the service unavailable. A drawing failure keeps its still. */
export function atlasFailureState(error: unknown): 'still' | 'empty' | 'invalid' | 'unavailable' {
  return error instanceof PreviewError ? error.reason === 'mismatch' ? 'invalid' : error.reason : 'still';
}

/** Each call creates a new renderer/canvas; keep the same loaded survey and selection. */
export async function mountAtlasWithRetry<T>(mount: () => Promise<T>, report: (error: unknown) => void): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await mount(); }
    catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      report(error);
    }
  }
  return null;
}
