import { createHash } from 'node:crypto';
import { canonicalSceneJson } from '../../../../packages/world/src/founded-world/codec';
import { decodeBakedMetadata } from '../../../../packages/world/src/grand/baked/codec';
import { decodeSketchRecord } from '../../../../packages/world/src/grand/sketch';
import { LandArtifactStore } from './store';
import type { SketchService, SketchStatus } from './sketches';

export interface LandResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array }
const empty = new Uint8Array();
const failure = (status: number): LandResponse => ({ status, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' }, body: empty });

/** Read-only adapter for a realm HTTP host. Only complete published receipt bindings and complete sketch records
 * (`/<channel>/<recipe-hash>`, GW13) are addressable; a sketch's blobs are served only under its own record.
 * Gzip is the explicit artifact format, not Content-Encoding, so the client can verify both digests. */
export async function readLandRoute(store: LandArtifactStore, pathname: string, method = 'GET', ifNoneMatch?: string): Promise<LandResponse | null> {
  if (!pathname.startsWith('/api/realm/land/')) return null;
  if (method !== 'GET' && method !== 'HEAD') return { ...failure(405), headers: { ...failure(405).headers, allow: 'GET, HEAD, POST' } };
  const world = /^\/api\/realm\/land\/([1-9][0-9]{0,31})\/world$/.exec(pathname);
  if (world) return readWorld(store, world[1]!, method, ifNoneMatch);
  const match = /^\/api\/realm\/land\/([1-9][0-9]{0,31})\/([a-f0-9]{64})(?:\/([a-f0-9]{64}))?$/.exec(pathname);
  if (!match) return failure(404);
  try {
    const binding = await store.binding(match[1]!, match[2]!);
    let bytes: Uint8Array, digest: string, contentType: string;
    if (!binding) {
      const sketch = await store.sketchBytes(match[1]!, match[2]!);
      if (!sketch) return failure(404);
      if (!match[3]) { bytes = sketch; digest = createHash('sha256').update(bytes).digest('hex'); contentType = 'application/json'; }
      else {
        const record = decodeSketchRecord(sketch, { kingdomId: match[1]!, recipeHash: match[2]! });
        const selected = record.surface.hash === match[3] ? record.surface : record.meshes.find(mesh => mesh.hash === match[3]);
        if (!selected) return failure(404);
        bytes = await store.compressed(selected); digest = selected.gzipHash; contentType = 'application/gzip';
      }
    } else if (!match[3]) {
      bytes = Buffer.from(canonicalSceneJson(binding));
      digest = createHash('sha256').update(bytes).digest('hex'); contentType = 'application/json';
    } else {
      let ref = binding.manifest;
      if (match[3] !== ref.hash) {
        const metadata = decodeBakedMetadata(await store.read(binding.manifest));
        if (metadata.kingdomId !== binding.kingdomId || metadata.recipeHash !== binding.recipeHash
          || metadata.sourcePlanHash !== binding.sourcePlanHash || metadata.sourcePlanRevision !== binding.layoutRevision)
          throw new Error('Published land identity mismatch');
        const selected = metadata.surface.hash === match[3] ? metadata.surface
          : metadata.regions.flatMap(region => region.meshes).find(mesh => mesh.hash === match[3]);
        if (!selected) return failure(404);
        ref = selected;
      }
      bytes = await store.compressed(ref); digest = ref.gzipHash; contentType = 'application/gzip';
    }
    const headers = { 'cache-control': 'public, max-age=31536000, immutable', 'content-type': contentType,
      etag: `"${digest}"`, 'x-content-type-options': 'nosniff', 'content-length': String(bytes.byteLength) };
    if (ifNoneMatch === headers.etag) return { status: 304, headers, body: empty };
    return { status: 200, headers, body: method === 'HEAD' ? empty : bytes };
  } catch {
    // A missing published blob is an incomplete/corrupt installation, never a request to generate one.
    return failure(503);
  }
}

/**
 * `GET /api/realm/land/<channel>/world`: the channel's world (GW13), the sketch recipe pinned the first time anyone
 * looked it up, which its founding raises the kingdom on. 404 while the channel has none. A pin never changes, but
 * it is cached for an hour only, so an operator's repair reaches visitors.
 */
async function readWorld(store: LandArtifactStore, kingdomId: string, method: string, ifNoneMatch?: string): Promise<LandResponse> {
  try {
    const pinned = await store.world(kingdomId);
    if (!pinned) return failure(404);
    const headers = { 'cache-control': 'public, max-age=3600', 'content-type': 'application/json', etag: `"${pinned.hash}"`,
      'x-content-type-options': 'nosniff', 'content-length': String(pinned.bytes.byteLength) };
    if (ifNoneMatch === headers.etag) return { status: 304, headers, body: empty };
    return { status: 200, headers, body: method === 'HEAD' ? empty : pinned.bytes };
  } catch { return failure(503); }
}

const json = (status: number, value: unknown): LandResponse => ({ status,
  headers: { 'cache-control': 'no-store', 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
  body: Buffer.from(JSON.stringify(value)) });
const REFUSED: Record<Extract<SketchStatus, { state: 'refused' }>['reason'], number> = { invalid: 400, pinned: 409, founded: 409, busy: 429, resting: 503, failed: 503 };

/**
 * `POST /api/realm/land/<channel>/<recipe-hash>` with the recipe as canonical JSON: ask the realm to raise that
 * channel's sketch. 200 ready, 202 being raised (the bake's own counts and how many lands are ahead), or a refusal.
 * Asking again is how a visitor follows the bake; it never starts a second one.
 */
export async function postLandRoute(sketches: SketchService | null, pathname: string, body: Uint8Array): Promise<LandResponse | null> {
  if (!pathname.startsWith('/api/realm/land/')) return null;
  const match = /^\/api\/realm\/land\/([1-9][0-9]{0,31})\/([a-f0-9]{64})$/.exec(pathname);
  if (!match) return failure(404);
  if (!sketches) return json(503, { state: 'refused', reason: 'resting' });
  try {
    const status = await sketches.request(match[1]!, match[2]!, body);
    return json(status.state === 'ready' ? 200 : status.state === 'raising' ? 202 : REFUSED[status.reason], status);
  } catch { return failure(503); }
}
