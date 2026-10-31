import { EMOTE_SOURCE_LIMITS } from '../profiles';
import { sha256Hex } from '../sha256';
import type { DecodedEmote, EmoteImageDecoder, EmoteRendition } from '../types';
import { EmoteDecodeError, overBudget, throwIfAborted, unsupported, type EmoteDecodeFailureCode } from './errors';
import { decodeGif } from './gif';
import { decodePng, PNG_SIGNATURE } from './png';
import { decodeWebp } from './webp';

export { EmoteDecodeError, type EmoteDecodeFailureCode } from './errors';

/**
 * Identifies a raster by its magic bytes alone. File names, URLs and Content-Type headers are never
 * trusted. SVG, HTML, scripts and anything else return null and are never decoded.
 */
export function sniffEmoteFormat(bytes: Uint8Array): EmoteRendition | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, i) => bytes[i] === value)) return 'png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  return null;
}

/**
 * Decodes fetched emote bytes into full coalesced RGBA canvases. The declared rendition comes from
 * checked provider metadata and must agree with the bytes; a mismatch is refused rather than
 * guessed. Rejects with `EmoteDecodeError` (code `corrupt`, `over-budget`, `unsupported` or
 * `aborted`). Run it on a worker: the bench and the server both do.
 */
export async function decodeEmoteBytes(bytes: Uint8Array, format: EmoteRendition, signal?: AbortSignal): Promise<DecodedEmote> {
  throwIfAborted(signal);
  if (!(bytes instanceof Uint8Array)) throw unsupported('Emote bytes must be a byte array.');
  if (bytes.length > EMOTE_SOURCE_LIMITS.compressedBytes) throw overBudget(`The emote file is ${bytes.length} bytes; the limit is ${EMOTE_SOURCE_LIMITS.compressedBytes}.`);
  const sniffed = sniffEmoteFormat(bytes);
  if (!sniffed) throw unsupported('The bytes are not a PNG, GIF or WebP image.');
  if (sniffed !== format) throw unsupported(`The provider said ${format}, but the bytes are ${sniffed}.`);
  if (format === 'png') return decodePng(bytes, signal);
  if (format === 'gif') return decodeGif(bytes, signal);
  return decodeWebp(bytes, signal);
}

export type EmoteDecodeResult =
  | { ok: true; decoded: DecodedEmote; sourceHash: string; format: EmoteRendition }
  | { ok: false; code: EmoteDecodeFailureCode; message: string };

/**
 * The structured form for review and UI code: never throws. `sourceHash` is the SHA-256 of exactly
 * the bytes that were decoded, which is the content address every approval binds to.
 */
export async function decodeEmoteImage(bytes: Uint8Array, format: EmoteRendition, signal?: AbortSignal): Promise<EmoteDecodeResult> {
  try {
    const decoded = await decodeEmoteBytes(bytes, format, signal);
    return { ok: true, decoded, sourceHash: sha256Hex(bytes), format };
  } catch (error) {
    if (error instanceof EmoteDecodeError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: 'corrupt', message: 'The image could not be decoded.' };
  }
}

/** The Spec 24 decoder port, backed by this module's own PNG, GIF and WebP decoders. */
export function createEmoteImageDecoder(): EmoteImageDecoder {
  return { decode: (bytes, format, signal) => decodeEmoteBytes(bytes, format, signal) };
}
