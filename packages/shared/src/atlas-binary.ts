import {
  ATLAS_DAB_BYTES, ATLAS_LIMITS, AtlasAlignmentSchema, AtlasDabSchema, AtlasLiveSlotSchema,
  AtlasLiveStartsSchema, AtlasManifestSchema, assertSettlerIndex,
  type AtlasAlignment, type AtlasDab, type AtlasEdition, type AtlasLiveSlot, type AtlasLiveStarts,
  type AtlasManifest, type AtlasSettler,
} from './atlas';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createAtlasAlignment(edition: AtlasEdition, settlers: readonly AtlasSettler[]): Promise<AtlasAlignment> {
  assertSettlerIndex(edition, settlers);
  // ASCII IDs + LF are unambiguous; include a domain/version prefix, including for the empty index.
  const canonical = `chatdom:atlas-settler-order:v1\n${settlers.map((settler) => `${settler.kingdomId}\n`).join('')}`;
  return AtlasAlignmentSchema.parse({
    editionId: edition.id,
    worldHash: edition.worldHash,
    settlerOrderHash: await sha256Hex(new TextEncoder().encode(canonical)),
    settlerCount: settlers.length,
  });
}

export function assertAtlasAlignment(actual: AtlasAlignment, expected: AtlasAlignment): void {
  AtlasAlignmentSchema.parse(actual);
  AtlasAlignmentSchema.parse(expected);
  if (actual.editionId !== expected.editionId || actual.worldHash !== expected.worldHash ||
    actual.settlerOrderHash !== expected.settlerOrderHash || actual.settlerCount !== expected.settlerCount) {
    throw new Error('Atlas edition or settler order mismatch; reload the matching index.');
  }
}

async function verifiedBytes(bytes: Uint8Array, asset: { byteLength: number; sha256: string }): Promise<Uint8Array> {
  if (bytes.byteLength !== asset.byteLength) throw new Error('Atlas artifact length mismatch.');
  // Own the exact view before the await; an offset view or caller mutation must not change the validated bytes.
  const snapshot = Uint8Array.from(bytes);
  if (await sha256Hex(snapshot) !== asset.sha256) throw new Error('Atlas artifact hash mismatch.');
  return snapshot;
}

function validLiveBytes(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i += 2) {
    const liveClass = bytes[i];
    const spectacle = bytes[i + 1];
    if (liveClass === undefined || spectacle === undefined || liveClass > 5 || spectacle > 6) {
      throw new Error('Invalid Atlas live class or spectacle code.');
    }
  }
}

function completeManifest(input: AtlasManifest): AtlasManifest {
  const manifest = AtlasManifestSchema.parse(input);
  if (manifest.coverage !== 'complete-sweep') throw new Error('A partial observation cannot replace the Atlas snapshot.');
  return manifest;
}

/** Vision format: exactly [liveClass, spectacle] per global settler ordinal; no in-band header. */
export function encodeLiveV2(slots: readonly AtlasLiveSlot[]): Uint8Array {
  if (slots.length > ATLAS_LIMITS.settlers) throw new Error('Atlas settler limit exceeded.');
  const bytes = new Uint8Array(slots.length * 2);
  slots.forEach((input, ordinal) => {
    const slot = AtlasLiveSlotSchema.parse(input);
    bytes[ordinal * 2] = slot.liveClass;
    bytes[ordinal * 2 + 1] = slot.spectacle;
  });
  return bytes;
}

/** Returns owned interleaved bytes, not one JS object per kingdom. Decode at fetch, never per frame. */
export async function decodeLiveV2(bytes: Uint8Array, input: AtlasManifest, expected: AtlasAlignment): Promise<Uint8Array> {
  const manifest = completeManifest(input);
  assertAtlasAlignment(manifest.alignment, expected);
  if (manifest.coverage !== 'complete-sweep') throw new Error('Partial Atlas observation cannot replace a coherent live frame.');
  const snapshot = await verifiedBytes(bytes, manifest.live);
  validLiveBytes(snapshot);
  return snapshot;
}

/** A sidecar is necessary: two live bytes cannot also encode a real stream start timestamp. */
export async function decodeLiveStartsV1(
  bytes: Uint8Array, input: AtlasManifest, expected: AtlasAlignment, liveBytes: Uint8Array,
): Promise<AtlasLiveStarts> {
  const manifest = completeManifest(input);
  assertAtlasAlignment(manifest.alignment, expected);
  const snapshot = await verifiedBytes(bytes, manifest.starts);
  const starts = AtlasLiveStartsSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot)) as unknown);
  assertAtlasAlignment(starts.alignment, expected);
  if (starts.asOf !== manifest.evidence.asOf) throw new Error('Atlas start times belong to a different observation.');
  // Reverify the input frame, so cross-snapshot starts cannot be attached even at identical order/count.
  const verifiedLive = await decodeLiveV2(liveBytes, manifest, expected);
  let entry = 0;
  for (let ordinal = 0; ordinal < expected.settlerCount; ordinal++) {
    if (verifiedLive[ordinal * 2] !== 0) {
      if (starts.entries[entry]?.ordinal !== ordinal) throw new Error('Missing or mismatched Atlas live start entry.');
      entry++;
    }
  }
  if (entry !== starts.entries.length) throw new Error('An offline Atlas slot has a stream start entry.');
  return starts;
}

/** Proposed dabs-v1: LE u32 realm + eight raw hash bytes + LE u64 epoch ms, twenty bytes per record. */
export function encodeDabsV1(inputs: readonly AtlasDab[]): Uint8Array {
  if (inputs.length > ATLAS_LIMITS.dabs) throw new Error('Atlas dab limit exceeded.');
  const dabs = inputs.map((dab) => AtlasDabSchema.parse(dab));
  dabs.sort((a, b) => a.realmIndex - b.realmIndex || (a.channelHash < b.channelHash ? -1 : a.channelHash > b.channelHash ? 1 : 0));
  const hashes = new Set<string>();
  const bytes = new Uint8Array(dabs.length * ATLAS_DAB_BYTES);
  const view = new DataView(bytes.buffer);
  for (const [index, dab] of dabs.entries()) {
    if (hashes.has(dab.channelHash)) throw new Error('Duplicate or colliding Atlas dab hash.');
    hashes.add(dab.channelHash);
    const offset = index * ATLAS_DAB_BYTES;
    view.setUint32(offset, dab.realmIndex, true);
    for (let byte = 0; byte < 8; byte++) bytes[offset + 4 + byte] = Number.parseInt(dab.channelHash.slice(byte * 2, byte * 2 + 2), 16);
    view.setBigUint64(offset + 12, BigInt(dab.startedAt), true);
  }
  return bytes;
}

export async function decodeDabsV1(bytes: Uint8Array, input: AtlasManifest, expected: AtlasAlignment): Promise<AtlasDab[]> {
  const manifest = completeManifest(input);
  assertAtlasAlignment(manifest.alignment, expected);
  const snapshot = await verifiedBytes(bytes, manifest.dabs);
  const view = new DataView(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);
  const dabs: AtlasDab[] = [];
  const hashes = new Set<string>();
  for (let index = 0; index < manifest.dabs.count; index++) {
    const offset = index * ATLAS_DAB_BYTES;
    const realmIndex = view.getUint32(offset, true);
    const channelHash = Array.from(snapshot.subarray(offset + 4, offset + 12), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const startedAt = view.getBigUint64(offset + 12, true);
    if (realmIndex >= manifest.realmCount || startedAt > BigInt(manifest.evidence.asOf)) {
      throw new Error('Atlas dab has an unknown realm or a future start time.');
    }
    if (hashes.has(channelHash)) throw new Error('Duplicate or colliding Atlas dab hash.');
    const previous = dabs[index - 1];
    if (previous && (realmIndex < previous.realmIndex || (realmIndex === previous.realmIndex && channelHash < previous.channelHash))) {
      throw new Error('Atlas dabs are not in canonical order.');
    }
    hashes.add(channelHash);
    dabs.push({ realmIndex, channelHash, startedAt: Number(startedAt) });
  }
  return dabs;
}
