import { REALM_FOUNDED_ROUTES, RealmFoundedManifestSchema, RealmJoinSchema, type CollisionWorld, type RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import { decodeFoundedScene, FOUNDED_SCENE_LIMITS } from '@chatdom/world/founded-scene';
import { connectRealm, type RealmClient } from '../realm/client';

/*
 * Explicit loopback-only testing, the same door as the tavern's: `?testWalker=1&realm=<loopback>` on a loopback page
 * joins the kingdom room of a SIMULATED realm as a test walker. The realm must expose its own test session issuer and
 * its founded scene; a live kingdom never admits a test walker, and nothing here is offered anywhere but loopback.
 */
export interface TestWalker {
  readonly client: RealmClient;
  readonly scene: RealmFoundedScene;
  readonly manifest: RealmFoundedManifest;
  readonly world: CollisionWorld;
}

const REFUSED = 'Walk to the campfire from your kingdom.';
const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '127.0.0.10' || host === '[::1]';

/** The realm endpoint a test walker may use, or null when this page may not admit one. */
export function testWalkerEndpoint(params: URLSearchParams): string | null {
  if (params.get('testWalker') !== '1' || !loopback(location.hostname)) return null;
  let endpoint: URL;
  try { endpoint = new URL(params.get('realm') ?? '/live-realm-data', location.origin); } catch { return null; }
  if (!loopback(endpoint.hostname) || (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')) return null;
  return endpoint.toString().replace(/\/$/, '');
}

export async function openLocalTestWalker(params: URLSearchParams, signal?: AbortSignal): Promise<TestWalker> {
  const endpoint = testWalkerEndpoint(params);
  if (!endpoint) throw new Error(REFUSED);
  const response = await fetch(`${endpoint}/reference/session`, { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error('This fire does not admit test walkers.');
  const join = RealmJoinSchema.parse(await response.json());
  const read = async (path: string) => {
    const answer = await fetch(`${endpoint}${path}`, { cache: 'no-store', headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
    if (!answer.ok) throw new Error('The test kingdom has no founded clearing to show.');
    return answer;
  };
  const manifest = RealmFoundedManifestSchema.parse(await (await read(REALM_FOUNDED_ROUTES.manifest.replace(':kingdomId', encodeURIComponent(join.kingdomId)))).json());
  if (manifest.kingdomId !== join.kingdomId || manifest.origin !== 'simulated') throw new Error('This fire does not admit test walkers.');
  const bytes = new Uint8Array(await (await read(REALM_FOUNDED_ROUTES.scene.replace(':sceneHash', manifest.sceneHash))).arrayBuffer());
  if (bytes.byteLength > FOUNDED_SCENE_LIMITS.bytes) throw new Error('The founded scene exceeds its byte bound.');
  const scene = await decodeFoundedScene(bytes, manifest);
  const world = compileFoundedScene(scene);
  signal?.throwIfAborted();
  const client = await connectRealm(endpoint, {
    kingdomId: join.kingdomId, resumeScope: params.get('resumeScope') ?? crypto.randomUUID(), ticket: async () => join,
  }, world, sessionStorage);
  if (client.room.state.origin !== 'simulated' || client.room.state.collisionRevision !== manifest.collisionRevision) {
    client.dispose();
    throw new Error('This fire does not admit test walkers.');
  }
  if (signal?.aborted) { client.dispose(); signal.throwIfAborted(); }
  return { client, scene, manifest, world };
}
