import { VoxelBlueprintSchema, type KingdomId, type Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmBootstrap, RealmFoundedManifest, RealmPrivateState } from '@chatdom/shared/realm';
import type { RealmFoundedScene, SettlementPlan } from '@chatdom/world';
import { createFoundedInteractionRegistry, interactionTargetId } from '@chatdom/world/interactions';
import type { DurableKingdomOptions } from '../persistence/kingdom';
import { foundedSpawnAnchors } from './anchors';
import { compileFoundedScene, sampleFoundedTerrain } from './collision';
import { assetHashOf, canonicalSceneJson } from './codec';
import { loadAdoptedPlan, type FoundedLayoutSource } from './load';
import type { NativeTown } from './native';
import { enrichNativePictureGroves } from './picture-groves';
import { enrichNativeMarket } from './market-furnishings';
import { enrichNativeForgeHearth, enrichNativeForgeWorkshop } from './forge-hearth-furnishings';
import { enrichNativeMarketSeats } from './market-seats';
import { assembleFoundedScene, type FoundedHomeBinding, type FoundedSceneBuild } from './scene';
import { encodeFoundedScene } from './validate';
import { foundedWorldAdoption } from './adoption';

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

/** Bind only committed deeds to the actual installed, collision-checked outside door threshold. */
function withOwnedDoorSpawns(physical: FoundedWorld, state: RealmPrivateState): FoundedWorld {
  const doors = new Map<string, Vec3>();
  const homes = Object.values(state.homes).filter(home => home.layoutRevision === physical.scene.layoutRevision);
  if (homes.length) {
    const registry = createFoundedInteractionRegistry(physical.scene, physical.world);
    for (const home of homes) {
      const door = registry.get(interactionTargetId.homeDoor(home.id));
      if (door?.target.kind === 'home-door' && door.target.plotId === home.id) doors.set(home.ownerId, door.target.approach);
    }
  }
  const fallback: DurableKingdomOptions['spawn'] = (_principal, arrival) => {
    const anchor = physical.anchors[arrival];
    if (!anchor) throw new Error('The founded arrival anchor capacity is exhausted.');
    return anchor;
  };
  return { ...physical, options: { ...physical.options, spawn: (principal, arrival) =>
    principal.kingdomId === state.kingdomId && principal.origin === state.origin
      ? doors.get(principal.personId) ?? fallback(principal, arrival) : fallback(principal, arrival) } };
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
  const staged = new Map<KingdomId, { homes: RealmPrivateState['homes']; castle: RealmPrivateState['castle']; attachments: RealmPrivateState['attachments']; civic: NonNullable<RealmPrivateState['growth']>['civic'] | undefined; prepared: FoundedPreparedWorld }>();
  const publish = (kingdomId: KingdomId, prepared: FoundedPreparedWorld) => {
    current.delete(kingdomId); current.set(kingdomId, prepared);
    while (current.size > 64) current.delete(current.keys().next().value!);
  };
  const stage = async (kingdomId: KingdomId, state: RealmPrivateState): Promise<FoundedPreparedWorld> => {
    const cached = staged.get(kingdomId), head = await source.currentLayout(kingdomId);
    if (cached && cached.homes === state.homes && cached.castle === state.castle && cached.attachments === state.attachments && cached.civic === state.growth?.civic
      && head?.revision === cached.prepared.scene.layoutRevision) return cached.prepared;
    // First chat claims a native home already standing here. Rebind its public ownership only after checking
    // the actual blueprint against that placement's immutable asset; no geometry or scene bytes change.
    if (cached && head?.revision === cached.prepared.scene.layoutRevision && state.kingdomId === kingdomId
      && state.origin === source.origin && cached.castle === state.castle && cached.attachments === state.attachments && cached.civic === state.growth?.civic) {
      const build = await claimNativeHomes(cached.prepared.build, cached.homes, state.homes);
      if (build) {
        const latest = await source.currentLayout(kingdomId);
        if (!latest || latest.revision !== head.revision) throw new Error('The adopted layout changed during founded world preparation.');
        const prepared: FoundedPreparedWorld = { ...withOwnedDoorSpawns(cached.prepared, state), build,
          manifestFor: checkpoint => foundedCheckpointMatches(build, checkpoint) ? build.manifest : null };
        staged.delete(kingdomId); staged.set(kingdomId, { homes: state.homes, castle: state.castle, attachments: state.attachments, civic: state.growth?.civic, prepared });
        return prepared;
      }
    }
    const adopted = await loadAdoptedPlan(source, kingdomId, state), native = await store.native(kingdomId, adopted.plan, source.origin);
    // Add reviewed public furnishings around installed stalls without regenerating the pinned town. These
    // solids use the same immutable scene, digest and room adoption as homes; never a browser-only overlay.
    const furnished = enrichNativeForgeWorkshop(adopted.plan, enrichNativeForgeHearth(adopted.plan, enrichNativeMarketSeats(adopted.plan, enrichNativeMarket(adopted.plan, native))));
    const candidate = await assembleFoundedScene({ kingdomId, plan: adopted.plan, state, native: enrichNativePictureGroves(adopted.plan, furnished), collisionRevision: 0 });
    const collisionRevision = await store.revision(kingdomId, candidate.geometryDigest);
    const scene = { ...candidate.scene, collisionRevision }, encoded = await encodeFoundedScene(scene);
    const build: FoundedSceneBuild = { ...candidate, scene, bytes: encoded.bytes, manifest: encoded.manifest };
    await store.put(build.bytes, build.manifest);
    // A public home metadata change can retain identical geometry. Keep the exact current collision object so
    // its stable revision does not cause a false physical adoption or reset occupied walkers.
    const active = current.get(kingdomId), physical = active?.build.geometryDigest === build.geometryDigest ? active : createFoundedWorld(scene);
    const prepared: FoundedPreparedWorld = { ...withOwnedDoorSpawns({ ...physical, scene }, state), scene, build,
      manifestFor: checkpoint => foundedCheckpointMatches(build, checkpoint) ? build.manifest : null };
    // Recheck layout head after asynchronous preparation. Caller still checks held writer/poses at adoption.
    const latest = await source.currentLayout(kingdomId);
    if (!latest || latest.revision !== adopted.revision) throw new Error('The adopted layout changed during founded world preparation.');
    staged.delete(kingdomId); staged.set(kingdomId, { homes: state.homes, castle: state.castle, attachments: state.attachments, civic: state.growth?.civic, prepared });
    while (staged.size > 64) staged.delete(staged.keys().next().value!);
    return prepared;
  };
  const load = async (kingdomId: KingdomId, state: RealmPrivateState): Promise<FoundedPreparedWorld> => {
    const prepared = await stage(kingdomId, state);
    publish(kingdomId, prepared);
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
  return { prepare, load, options: async (kingdomId, state) => {
    const initial = await load(kingdomId, state);
    return { ...initial.options, prepareWorld: async committed => {
      const next = await stage(kingdomId, committed);
      return foundedWorldAdoption(next, () => publish(kingdomId, next));
    } };
  }, current: kingdomId => current.get(kingdomId) };
}

/** Only additive native ownership qualifies. Edits, removals, attachments and layout changes still assemble. */
async function claimNativeHomes(build: FoundedSceneBuild, before: RealmPrivateState['homes'], after: RealmPrivateState['homes']): Promise<FoundedSceneBuild | null> {
  if (Object.entries(before).some(([id, home]) => after[id] !== home)) return null;
  const added = Object.entries(after).filter(([id]) => !Object.hasOwn(before, id));
  if (!added.length) return null;
  const claims = new Map<string, FoundedHomeBinding>();
  for (const [id, home] of added) {
    const plot = build.scene.plan.homes.find(plot => plot.id === id), binding = build.homes.find(home => home.plotId === id);
    const placement = build.scene.placements.find(piece => piece.id === `home:${id}` && piece.plotId === id);
    if (home.id !== id || !plot || home.slot !== plot.slot || binding?.source !== 'native' || !placement
      || Object.keys(home.attachments).length || home.blueprint.kind !== 'home' || !VoxelBlueprintSchema.safeParse(home.blueprint).success
      || await assetHashOf(home.blueprint) !== placement.assetHash) return null;
    claims.set(id, { plotId: id, source: 'owned', revision: home.revision, digest: home.digest, attachments: [] });
  }
  return { ...build, homes: build.homes.map(home => claims.get(home.plotId) ?? home),
    counts: { ...build.counts, ownedHomes: build.counts.ownedHomes + claims.size } };
}

/** Public checkpoint identity is separate from committed private sequence. Native plots have no owned view. */
export function foundedCheckpointMatches(build: Pick<FoundedSceneBuild, 'manifest' | 'homes' | 'castle'>, checkpoint: RealmBootstrap): boolean {
  const m = build.manifest;
  if (checkpoint.kingdomId !== m.kingdomId || checkpoint.layoutRevision !== m.layoutRevision || checkpoint.collisionRevision !== m.collisionRevision) return false;
  const castles = checkpoint.current.filter(v => v.type === 'castle');
  if (build.castle) {
    const castle = build.castle, view = castles[0];
    if (castles.length !== 1 || !view || view.moduleId !== castle.moduleId || view.revision !== castle.revision
      || view.assetHash !== castle.digest || !equalIds(view.attachments.map(a => a.id), castle.attachments)) return false;
  } else if (castles.length) return false;
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
