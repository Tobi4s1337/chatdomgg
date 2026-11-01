import { KingdomIdSchema } from '@chatdom/shared';
import { RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { canonicalSceneJson } from '@chatdom/world/founded-codec';
import { decodeFoundedScene } from '@chatdom/world/founded-scene';
import { validateHistory, type History } from './replay';

export interface ChronicleWorld { readonly revision: string; readonly manifest: RealmFoundedManifest; readonly scene: RealmFoundedScene }
export interface DurableChronicle { readonly version: 1; readonly kingdomId: string; readonly origin: 'live' | 'simulated'; readonly throughSequence: number; readonly history: History; readonly worlds: readonly ChronicleWorld[] }
const BYTE_LIMIT = 64 * 1024 * 1024;

/** Validate every scene hash and public schema before any replay presentation is built. */
export async function validateDurableChronicle(value: unknown, expectedKingdom: string): Promise<DurableChronicle> {
  const kingdomId = KingdomIdSchema.parse(expectedKingdom);
  if (typeof value !== 'object' || value === null) throw new Error('Chronicle response is invalid.');
  const input = value as DurableChronicle;
  if (input.version !== 1 || input.kingdomId !== kingdomId || !['live', 'simulated'].includes(input.origin)
    || !Number.isSafeInteger(input.throughSequence) || input.throughSequence < 0 || !Array.isArray(input.worlds) || input.worlds.length > 128) throw new Error('Chronicle identity is invalid.');
  const history = validateHistory(input.history);
  if (history.label !== (input.origin === 'live' ? 'LIVE' : 'SIMULATED')) throw new Error('Chronicle provenance is invalid.');
  const worlds: ChronicleWorld[] = [], revisions = new Set<string>();
  for (const world of input.worlds) {
    const manifest = RealmFoundedManifestSchema.parse(world.manifest);
    if (manifest.kingdomId !== kingdomId || manifest.origin !== input.origin || world.revision !== manifest.sceneHash || revisions.has(world.revision)) throw new Error('Chronicle scene identity is invalid.');
    const scene = await decodeFoundedScene(new TextEncoder().encode(canonicalSceneJson(world.scene)), manifest);
    revisions.add(world.revision); worlds.push({ revision: world.revision, manifest, scene });
  }
  for (const snapshot of history.snapshots) {
    const world = worlds.find(item => item.revision === snapshot.worldRevision);
    if (snapshot.frame.kingdomId !== kingdomId || snapshot.frame.sequence > input.throughSequence || !world) throw new Error('Chronicle snapshot has no complete world.');
    for (const home of snapshot.homes) {
      if (!world.scene.placements.some(piece => piece.id === `home:${home.plotId}` && piece.assetHash === home.assetRevision)) throw new Error('Chronicle home revision does not match its world.');
    }
  }
  return { version: 1, kingdomId, origin: input.origin, throughSequence: input.throughSequence, history, worlds };
}

export async function readDurableChronicle(kingdom: string, options: { readonly signal?: AbortSignal; readonly fetch?: typeof fetch } = {}): Promise<DurableChronicle> {
  const kingdomId = KingdomIdSchema.parse(kingdom);
  const response = await (options.fetch ?? fetch)(`/api/realm/chronicle/${kingdomId}`, { credentials: 'same-origin', ...(options.signal ? { signal: options.signal } : {}) });
  if (!response.ok) throw new Error('The kingdom’s Chronicle is unavailable right now.');
  if (!response.body) throw new Error('The kingdom’s Chronicle is unavailable right now.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > BYTE_LIMIT) throw new Error('The Chronicle exceeds this reader’s capacity.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return validateDurableChronicle(JSON.parse(new TextDecoder().decode(bytes)), kingdomId);
}
