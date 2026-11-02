import { createHash } from 'node:crypto';
import { canonicalSceneJson } from '../../../../packages/world/src/founded-world/codec';
import { decodeBakedMetadata } from '../../../../packages/world/src/grand/baked/codec';
import { LandArtifactStore } from './store';

export interface LandResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array }
const empty = new Uint8Array();
const failure = (status: number): LandResponse => ({ status, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' }, body: empty });

/** Read-only adapter for a realm HTTP host. Only complete published receipt bindings are addressable.
 * Gzip is the explicit artifact format, not Content-Encoding, so the client can verify both digests. */
export async function readLandRoute(store: LandArtifactStore, pathname: string, method = 'GET', ifNoneMatch?: string): Promise<LandResponse | null> {
  if (!pathname.startsWith('/api/realm/land/')) return null;
  if (method !== 'GET' && method !== 'HEAD') return { ...failure(405), headers: { ...failure(405).headers, allow: 'GET, HEAD' } };
  const match = /^\/api\/realm\/land\/([1-9][0-9]{0,31})\/([a-f0-9]{64})(?:\/([a-f0-9]{64}))?$/.exec(pathname);
  if (!match) return failure(404);
  try {
    const binding = await store.binding(match[1]!, match[2]!);
    if (!binding) return failure(404);
    let bytes: Uint8Array, digest: string, contentType: string;
    if (!match[3]) {
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
