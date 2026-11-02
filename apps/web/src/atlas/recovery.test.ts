// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PreviewError } from './data/preview';
import { atlasFailureState, mountAtlasWithRetry } from './recovery';

describe('Atlas rendering recovery', () => {
  it('keeps a drawing failure on the still and reserves unavailable for a real data-reader failure', () => {
    expect(atlasFailureState(new Error('Current environment does not allow unsafe-eval'))).toBe('still');
    expect(atlasFailureState(new TypeError('A renderer could not mount'))).toBe('still');
    expect(atlasFailureState(new PreviewError('unavailable', 'The Atlas service could not be reached.'))).toBe('unavailable');
    expect(atlasFailureState(new PreviewError('mismatch', 'Pinned bytes changed.'))).toBe('invalid');
  });

  it('retries a fresh mount once and reports the original errors before falling back', async () => {
    const first = new Error('first renderer'), second = new Error('second renderer');
    const report = vi.fn(), mount = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second);
    expect(await mountAtlasWithRetry(mount, report)).toBeNull();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(report.mock.calls).toEqual([[first], [second]]);
    const next = {};
    expect(await mountAtlasWithRetry(vi.fn().mockRejectedValueOnce(first).mockResolvedValueOnce(next), report)).toBe(next);
  });
});
