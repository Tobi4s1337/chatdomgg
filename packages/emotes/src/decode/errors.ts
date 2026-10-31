/**
 * Why a decode stopped. Decoders throw this one class internally; the public facade turns it into a
 * typed result so review and UI code never parse an error message.
 * - `corrupt`: the bytes break the format's own rules (bad signature, CRC, truncated stream, bad code).
 * - `over-budget`: a declared size, frame count, playback or byte count is past `EMOTE_SOURCE_LIMITS`,
 *   found before the buffer it would need is allocated.
 * - `unsupported`: a well-formed feature this module deliberately does not decode (APNG, an unknown
 *   format, a mismatched signature). Never silently replaced by a poster frame.
 * - `aborted`: the caller's signal fired; every buffer from this decode is dropped.
 */
export type EmoteDecodeFailureCode = 'corrupt' | 'over-budget' | 'unsupported' | 'aborted';

export class EmoteDecodeError extends Error {
  readonly code: EmoteDecodeFailureCode;
  constructor(code: EmoteDecodeFailureCode, message: string) {
    super(message);
    this.name = 'EmoteDecodeError';
    this.code = code;
  }
}

export const corrupt = (message: string): EmoteDecodeError => new EmoteDecodeError('corrupt', message);
export const overBudget = (message: string): EmoteDecodeError => new EmoteDecodeError('over-budget', message);
export const unsupported = (message: string): EmoteDecodeError => new EmoteDecodeError('unsupported', message);

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EmoteDecodeError('aborted', 'The decode was cancelled.');
}
