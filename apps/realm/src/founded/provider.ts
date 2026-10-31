import type { KingdomId, Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmBootstrap, RealmFoundedManifest, RealmPrivateState } from '@chatdom/shared/realm';
import type { RealmFoundedScene, SettlementPlan } from '@chatdom/world';
import type { DurableKingdomOptions } from '../persistence/kingdom';
import { foundedSpawnAnchors } from './anchors';
import { compileFoundedScene, sampleFoundedTerrain } from './collision';
import { canonicalSceneJson } from './codec';
import { loadAdoptedPlan, type FoundedLayoutSource } from './load';
import type { NativeTown } from './native';
import { assembleFoundedScene, type FoundedHomeBinding, type FoundedSceneBuild } from './scene';
import { encodeFoundedScene } from './validate';

export interface FoundedWorld {
  readonly scene: RealmFoundedScene;
  readonly world: CollisionWorld;
  readonly anchors: readonly Vec3[];
  readonly options: DurableKingdomOptions;
}

/** Immediate current-town composition: accepts validated exact scene data, never generates a plan. */
export function createFoundedWorld(scene: RealmFoundedScene): FoundedWorld {
  const world = compileFoundedScene(scene), anchors = foundedSpawnAnchors(scene.plan, world);
  const options: DurableKingdomOptions = { world, layoutRevision: scene.layoutRevision,
    spawn: (_principal, arrival) => {
      const anchor = anchors[arrival];
      if (!anchor) throw new Error('The founded arrival anchor capacity is exhausted.');
      return anchor;
    } };
  return { scene, world, anchors, options };
}

/** Durable artifact and collision-revision authority; implemented by FileFoundedStore below. */
export interface FoundedWorldStore {
  /** One exact geometry identity gets one uint32; another identity must never reuse it within this kingdom. */
  revision(kingdomId: KingdomId, geometryDigest: string): Promise<number>;
  put(bytes: Uint8Array, manifest: RealmFoundedManifest): Promise<void>;
  /** Exact persisted native baseline for the adopted plan, prepared outside the writer-opening window. */
  native(kingdomId: KingdomId, plan: SettlementPlan, origin: 'live' | 'simulated'): Promise<NativeTown>;
}
export interface FoundedPreparedWorld extends FoundedWorld {
  readonly build: FoundedSceneBuild;
  /** Prospective bytes are stored, but this method returns no receipt until actual authority agrees. */
  manifestFor(checkpoint: RealmBootstrap): RealmFoundedManifest | null;
}

/**
 * Compose as createDurableRealmServices({ kingdom: loader.options }). The existing writer acquires and loads
 * before calling it. There is no second writer, bootstrap principal, domain commit or publication here.
 * Prewarm store.native(kingdomId, adoptedPlan, source.origin) before room opening so expensive native generation is outside it.
 */
export function createFoundedWorldLoader(source: FoundedLayoutSource, store: FoundedWorldStore): {
  /** Prepare exact native baseline and terrain before the existing writer's acquire/load window. */
  prepare(kingdomId: KingdomId): Promise<void>;
  load(kingdomId: KingdomId, state: RealmPrivateState): Promise<FoundedPreparedWorld>;
  options(kingdomId: KingdomId, state: RealmPrivateState): Promise<DurableKingdomOptions>;
  current(kingdomId: KingdomId): FoundedPreparedWorld | undefined;
} {
  const current = new Map<KingdomId, FoundedPreparedWorld>();
  const load = async (kingdomId: KingdomId, state: RealmPrivateState): Promise<FoundedPreparedWorld> => {
    const adopted = await loadAdoptedPlan(source, kingdomId, state), native = await store.native(kingdomId, adopted.plan, source.origin);
    const candidate = await assembleFoundedScene({ kingdomId, plan: adopted.plan, state, native, collisionRevision: 0 });
    const collisionRevision = await store.revision(kingdomId, candidate.geometryDigest);
    const scene = { ...candidate.scene, collisionRevision }, encoded = await encodeFoundedScene(scene);
    const build: FoundedSceneBuild = { ...candidate, scene, bytes: encoded.bytes, manifest: encoded.manifest };
    await store.put(build.bytes, build.manifest);
    const prepared: FoundedPreparedWorld = { ...createFoundedWorld(scene), build,
      manifestFor: checkpoint => foundedCheckpointMatches(build, checkpoint) ? build.manifest : null };
    // Recheck layout head after asynchronous preparation. Caller still checks held writer/poses at adoption.
    const head = await source.currentLayout(kingdomId);
    if (!head || head.revision !== adopted.revision) throw new Error('The adopted layout changed during founded world preparation.');
    current.delete(kingdomId); current.set(kingdomId, prepared);
    while (current.size > 64) current.delete(current.keys().next().value!);
    return prepared;
  };
  const prepare = async (kingdomId: KingdomId): Promise<void> => {
    const head = await source.currentLayout(kingdomId);
    if (!head) throw new Error('The kingdom has no adopted layout to prepare.');
    const plan = await source.layoutPlan(kingdomId, head.revision);
    if (plan.revision !== head.revision) throw new Error('The stored adopted layout revision disagrees with its head.');
    await store.native(kingdomId, plan, source.origin);
    sampleFoundedTerrain(JSON.parse(canonicalSceneJson(plan)) as SettlementPlan);
  };
  return { prepare, load, options: async (kingdomId, state) => (await load(kingdomId, state)).options, current: kingdomId => current.get(kingdomId) };
}

/** Public checkpoint identity is separate from committed private sequence. Native plots have no owned view. */
export function foundedCheckpointMatches(build: Pick<FoundedSceneBuild, 'manifest' | 'homes'>, checkpoint: RealmBootstrap): boolean {
  const m = build.manifest;
  if (checkpoint.kingdomId !== m.kingdomId || checkpoint.layoutRevision !== m.layoutRevision || checkpoint.collisionRevision !== m.collisionRevision) return false;
  const owned = build.homes.filter(h => h.source === 'owned'), views = checkpoint.current.filter(v => v.type === 'home');
  if (views.length !== owned.length || new Set(views.map(v => v.plotId)).size !== views.length) return false;
  return owned.every((binding: FoundedHomeBinding) => {
    const view = views.find(v => v.plotId === binding.plotId);
    return view !== undefined && view.revision === binding.revision && view.assetHash === binding.digest
      && equalIds(view.attachments.map(a => a.id), binding.attachments);
  });
}
function equalIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort(), b = [...right].sort();
  return a.every((id, i) => id === b[i]);
}
