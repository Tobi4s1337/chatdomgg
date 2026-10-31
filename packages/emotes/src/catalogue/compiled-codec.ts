import { VoxelBlueprintSchema } from '../deps';
import type { CompiledEmote } from '../types';

/** The compiled geometry blob is UTF-8 JSON; this caps what a reader will parse. */
export const COMPILED_BLOB_MAX_BYTES = 12 * 1024 * 1024;
const PURPOSES = new Set(['statue', 'heraldry', 'motif', 'effect']);

/**
 * Serializes a compiled emote for the content-addressed blob port. The candidate record stores the
 * blob's SHA-256, so the bytes a reviewer saw are exactly the bytes a resolver later serves.
 */
export function encodeCompiledEmote(emote: CompiledEmote): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    format: 'chatdom-emote-compiled.1',
    ...emote,
    mask: { width: emote.mask.width, height: emote.mask.height, materialIds: Array.from(emote.mask.materialIds) },
  }));
}

/** Parses and re-checks a stored blob. Returns null for anything that is not a valid compiled emote. */
export function decodeCompiledEmote(bytes: Uint8Array): CompiledEmote | null {
  if (bytes.length > COMPILED_BLOB_MAX_BYTES) return null;
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.format !== 'chatdom-emote-compiled.1') return null;
  const strings = ['id', 'revision', 'sourceHash', 'geometryHash', 'compilerVersion'] as const;
  if (!strings.every(key => typeof value[key] === 'string')) return null;
  if (value.origin !== 'live' && value.origin !== 'simulated') return null;
  if (!PURPOSES.has(value.purpose as string)) return null;
  if (![value.paletteRevision, value.targetHeightCells, value.periodMs].every(n => Number.isInteger(n) && (n as number) >= 0)) return null;
  if (!Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > 120) return null;
  const frames: CompiledEmote['frames'][number][] = [];
  for (const frame of value.frames as unknown[]) {
    if (!frame || typeof frame !== 'object') return null;
    const { blueprint, durationMs } = frame as { blueprint: unknown; durationMs: unknown };
    const parsed = VoxelBlueprintSchema.safeParse(blueprint);
    if (!parsed.success || !Number.isInteger(durationMs) || (durationMs as number) < 0) return null;
    frames.push({ blueprint: parsed.data, durationMs: durationMs as number });
  }
  const size = frames[0]!.blueprint.size;
  if (frames.some(frame => frame.blueprint.size.some((n, i) => n !== size[i]))) return null;
  const mask = value.mask as { width?: unknown; height?: unknown; materialIds?: unknown } | undefined;
  if (!mask || mask.width !== size[0] || mask.height !== size[1] || !Array.isArray(mask.materialIds) || mask.materialIds.length !== size[0] * size[1]) return null;
  if (!mask.materialIds.every(id => Number.isInteger(id) && id >= 0 && id < 65536)) return null;
  return {
    id: value.id as string, revision: value.revision as string, origin: value.origin, purpose: value.purpose as CompiledEmote['purpose'],
    sourceHash: value.sourceHash as string, geometryHash: value.geometryHash as string, compilerVersion: value.compilerVersion as string,
    paletteRevision: value.paletteRevision as number, targetHeightCells: value.targetHeightCells as number,
    frames, periodMs: value.periodMs as number,
    mask: { width: size[0], height: size[1], materialIds: Uint16Array.from(mask.materialIds as number[]) },
  };
}
