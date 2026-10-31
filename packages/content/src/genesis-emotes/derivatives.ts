import { createSha256, type DecodedEmote, type EmoteRendition } from './deps';

export type EmoteUse = 'statue' | 'weathervane' | 'stained-glass';
export const EMOTE_USES: readonly EmoteUse[] = ['statue', 'weathervane', 'stained-glass'];

/** The recipe's reference to one approved asset: identifiers, never proof of approval. */
export interface EmoteAssetReference {
  readonly assetHash: string;
  readonly approvalId: string;
}

/** One `identity.emoteWorks` entry of the frozen recipe. */
export interface EmoteWork {
  readonly emoteId: string;
  readonly use: EmoteUse;
  readonly asset: EmoteAssetReference;
}

/**
 * One approved, use-specific raster derivative, supplied by main's server facts adapter after it has resolved a
 * current, channel-bound receipt for exactly this use. The adapter here never fetches, never reads a URL and never
 * treats these fields as proof: it only refuses what does not match. Publication validates the composed result
 * again. `raster` is decoded straight-alpha RGBA, every frame the full canvas, within the emote source limits.
 */
export interface ApprovedEmoteDerivative {
  readonly emoteId: string;
  readonly broadcasterId: string;
  readonly use: EmoteUse;
  readonly asset: EmoteAssetReference;
  readonly origin: 'live' | 'simulated';
  readonly rendition: EmoteRendition;
  readonly raster: DecodedEmote;
}

export type EmoteRefusal =
  | 'malformed'
  | 'use-mismatch'
  | 'asset-mismatch'
  | 'raster-mismatch'
  | 'other-channel'
  | 'origin-mismatch'
  | 'ambiguous';

export type EmoteWorkMatch =
  | { readonly kind: 'matched'; readonly work: EmoteWork; readonly derivative: ApprovedEmoteDerivative }
  | { readonly kind: 'missing'; readonly work: EmoteWork }
  | { readonly kind: 'refused'; readonly work: EmoteWork; readonly refusal: EmoteRefusal };

const DERIVATIVE_KEYS = ['asset', 'broadcasterId', 'emoteId', 'origin', 'raster', 'rendition', 'use'];
const ASSET_KEYS = ['approvalId', 'assetHash'];
const RASTER_KEYS = ['frames', 'height', 'width'];
const FRAME_KEYS = ['durationMs', 'rgba'];
const RENDITIONS = new Set(['png', 'gif', 'webp']);
const SHA256 = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const sameKeys = (value: unknown, keys: readonly string[]): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === keys.join();

/**
 * The derivative's own identity: SHA-256 over a versioned header, each frame's normalised delay and its RGBA.
 * The recipe's `assetHash` must equal it. One asset per emote serves every use it is approved for, so the hash
 * names the raster, not a use-specific geometry; the use travels separately and is enforced separately.
 */
export function derivativeRasterHash(raster: DecodedEmote): string {
  const hash = createSha256();
  hash.update(new TextEncoder().encode(`chatdom-genesis-emote-derivative.1|${raster.width}x${raster.height}|${raster.frames.length}|`));
  const delay = new Uint8Array(4);
  for (const frame of raster.frames) {
    const ms = Math.max(0, Math.min(0xffffffff, Math.round(Number.isFinite(frame.durationMs) ? frame.durationMs : 0)));
    delay[0] = ms >>> 24; delay[1] = (ms >>> 16) & 255; delay[2] = (ms >>> 8) & 255; delay[3] = ms & 255;
    hash.update(delay);
    hash.update(frame.rgba);
  }
  return hash.hex();
}

/** Strict shape: no extra fields (no URL can ride along), tokens and hashes well formed, RGBA covering the canvas. */
function wellFormed(value: unknown): value is ApprovedEmoteDerivative {
  if (!sameKeys(value, DERIVATIVE_KEYS)) return false;
  const d = value as ApprovedEmoteDerivative;
  if (typeof d.emoteId !== 'string' || !TOKEN.test(d.emoteId) || typeof d.broadcasterId !== 'string' || !/^[1-9][0-9]{0,31}$/.test(d.broadcasterId)) return false;
  if (!EMOTE_USES.includes(d.use) || (d.origin !== 'live' && d.origin !== 'simulated') || !RENDITIONS.has(d.rendition)) return false;
  if (!sameKeys(d.asset, ASSET_KEYS) || typeof d.asset.assetHash !== 'string' || !SHA256.test(d.asset.assetHash) || typeof d.asset.approvalId !== 'string' || !TOKEN.test(d.asset.approvalId)) return false;
  const raster = d.raster;
  if (!sameKeys(raster, RASTER_KEYS) || !Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width < 1 || raster.height < 1) return false;
  if (raster.width > 512 || raster.height > 512 || !Array.isArray(raster.frames) || raster.frames.length < 1 || raster.frames.length > 120) return false;
  return raster.frames.every(frame => sameKeys(frame, FRAME_KEYS) && frame.rgba instanceof Uint8Array && frame.rgba.length === raster.width * raster.height * 4 && typeof frame.durationMs === 'number');
}

/**
 * Pairs each recipe work with the one derivative supplied for exactly its emote and use. A derivative approved for
 * glass never satisfies a statue: a work whose only candidates carry another use is refused as `use-mismatch`.
 * Candidates for the right use that disagree on channel, origin, asset reference or raster hash are refused, as
 * are two candidates for one work. No candidate at all is `missing`, which composes as an honest absence.
 */
export function matchEmoteWorks(
  works: readonly EmoteWork[],
  derivatives: readonly unknown[],
  channel: { readonly broadcasterId: string; readonly origin: 'live' | 'simulated' },
): EmoteWorkMatch[] {
  return works.map((work): EmoteWorkMatch => {
    const forEmote = derivatives.filter(candidate => !!candidate && typeof candidate === 'object' && (candidate as { emoteId?: unknown }).emoteId === work.emoteId);
    if (!forEmote.length) return { kind: 'missing', work };
    if (!forEmote.every(wellFormed)) return { kind: 'refused', work, refusal: 'malformed' };
    const forUse = forEmote.filter(candidate => candidate.use === work.use);
    if (!forUse.length) return { kind: 'refused', work, refusal: 'use-mismatch' };
    if (forUse.length > 1) return { kind: 'refused', work, refusal: 'ambiguous' };
    const derivative = forUse[0]!;
    if (derivative.broadcasterId !== channel.broadcasterId) return { kind: 'refused', work, refusal: 'other-channel' };
    if (derivative.origin !== channel.origin) return { kind: 'refused', work, refusal: 'origin-mismatch' };
    if (derivative.asset.assetHash !== work.asset.assetHash || derivative.asset.approvalId !== work.asset.approvalId) return { kind: 'refused', work, refusal: 'asset-mismatch' };
    if (derivativeRasterHash(derivative.raster) !== work.asset.assetHash) return { kind: 'refused', work, refusal: 'raster-mismatch' };
    return { kind: 'matched', work, derivative };
  });
}
