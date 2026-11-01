import { GrowthSceneFrameSchema, VoxelBlueprintSchema, type GrowthSceneBeat, type VoxelBlueprint, type Vec3 } from '@chatdom/shared';
import type { RealmPublicDelivery, RealmWatchCheckpoint } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { sha256Hex, utf8 } from '@chatdom/world/founded-codec';
import type { RealmObservedRoom } from '../realm/adapters/observer';

type HomeBeat = Extract<GrowthSceneBeat, { kind: 'home-grown' }>;
export interface WitnessedHomeGrowth {
  readonly key: string;
  readonly beat: HomeBeat;
  /** HOME wire identity: Forge schema-order digest, distinct from the founded canonical content hash. */
  readonly targetHomeDigest: string;
  readonly previous: { readonly blueprint: VoxelBlueprint; readonly position: Vec3; readonly yaw: number; readonly assetHash: string };
}
/** Presentation session, owned by one stream entry. Reading/preparing never acknowledges a ceremony. */
export interface GrowthCeremonyFeed {
  preview(scene: RealmFoundedScene): readonly WitnessedHomeGrowth[];
  claim(key: string): boolean;
}
const WAIT_MS = 90_000;

/** A checkpoint is quiet. Only a world delivery witnessed by this entry may enter the bounded handoff queue. */
export function createGrowthCeremonySession(clock = Date.now) {
  const pending = new Map<string, { growth: WitnessedHomeGrowth; expires: number; preparing: number }>();
  const seen = new Set<string>();
  // Weak per-scene ownership bounds the cache to referenced validated scenes; only their home assets are hashed.
  const prepared = new WeakMap<RealmFoundedScene, Promise<void>>();
  const homeDigests = new WeakMap<RealmFoundedScene, ReadonlyMap<string, string>>();
  function prepare(scene: RealmFoundedScene): Promise<void> {
    const cached = prepared.get(scene);
    if (cached) return cached;
    const pending = (async () => {
      const assets = scene.assets.filter(asset => asset.blueprint.kind === 'home');
      const digests = new Map<string, string>();
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, assets.length) }, async () => {
        while (next < assets.length) {
          const asset = assets[next++]!;
          // Match server forgeHomeDigest exactly. assetHashOf sorts keys and is a different identity.
          const digest = await sha256Hex(utf8(JSON.stringify(VoxelBlueprintSchema.parse(asset.blueprint))));
          digests.set(asset.assetHash, digest);
        }
      }));
      homeDigests.set(scene, digests);
    })();
    prepared.set(scene, pending);
    return pending;
  }
  function expire() { for (const [key, item] of pending) if (!item.preparing && item.expires <= clock()) pending.delete(key); }
  const feed: GrowthCeremonyFeed & { retain(key: string): () => void } = {
    preview(scene) {
      expire();
      return [...pending.values()].flatMap(({ growth }) => {
        const placement = scene.placements.find(p => p.plotId === growth.beat.plotId && scene.assets.some(a => a.assetHash === p.assetHash && a.blueprint.kind === 'home'));
        // The entitlement may already be cottage while the hut is standing. Require the delivered geometry change.
        return placement && homeDigests.get(scene)?.get(placement.assetHash) === growth.targetHomeDigest && placement.assetHash !== growth.previous.assetHash ? [growth] : [];
      });
    },
    claim(key) { expire(); return pending.delete(key); },
    retain(key) {
      expire();
      const item = pending.get(key);
      if (!item) return () => {};
      item.preparing++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (pending.get(key) === item) { item.preparing--; expire(); }
      };
    },
  };
  return {
    feed, prepare,
    clear() { pending.clear(); },
    bind(room: RealmObservedRoom, checkpoint: RealmWatchCheckpoint, scene: RealmFoundedScene) {
      const digests = homeDigests.get(scene);
      if (!digests) throw new Error('Growth ceremonies require prepared authored home digests');
      let cursor = checkpoint.checkpoint.throughCursor;
      const floor = checkpoint.checkpoint.throughSequence;
      const commits = new Map<string, { sequence: number; homeDigest: string }>();
      const assets = new Map(scene.assets.map(a => [a.assetHash, a.blueprint]));
      const homes = new Map(scene.placements.filter(p => p.plotId && assets.get(p.assetHash)?.kind === 'home').map(p => [p.plotId!, p]));
      // This subscription deliberately precedes the collision-bound observer: its mismatch must not discard a
      // committed geometry beat immediately before the old watch requests a replacement scene.
      return room.onMessage('world', raw => {
        const row = raw as RealmPublicDelivery | null;
        if (!row || row.version !== 1 || row.kingdomId !== scene.kingdomId || row.writerEpoch !== checkpoint.checkpoint.writerEpoch
          || !Number.isSafeInteger(row.cursor) || row.cursor <= cursor || !Number.isSafeInteger(row.sequence) || row.sequence < 0) return;
        cursor = row.cursor;
        if (row.message?.type === 'home') {
          const home = row.message;
          if (homes.has(home.plotId) && row.sequence > floor && typeof home.assetHash === 'string' && /^[a-f0-9]{64}$/.test(home.assetHash)) {
            commits.set(home.plotId, { sequence: row.sequence, homeDigest: home.assetHash });
          }
          return;
        }
        if (row.message?.type !== 'growth') return;
        const parsed = GrowthSceneFrameSchema.safeParse(row.message.frame);
        if (!parsed.success || parsed.data.kingdomId !== scene.kingdomId || parsed.data.origin !== scene.origin || parsed.data.sequence > row.sequence) return;
        expire();
        for (const beat of parsed.data.beats) {
          if (beat.kind !== 'home-grown' || beat.sourceSeq <= floor) continue;
          const key = `${scene.kingdomId}:${beat.sourceSeq}:home-grown:${beat.plotId}`;
          if (seen.has(key)) continue;
          seen.add(key); if (seen.size > 1024) seen.delete(seen.values().next().value!);
          const home = homes.get(beat.plotId), blueprint = home && assets.get(home.assetHash), commit = commits.get(beat.plotId);
          if (!home || !blueprint || commit?.sequence !== beat.sourceSeq || commit.homeDigest === digests.get(home.assetHash)) continue;
          if (pending.size >= 32) {
            const evict = [...pending].find(([, item]) => !item.preparing);
            if (!evict) continue;
            pending.delete(evict[0]);
          }
          pending.set(key, { growth: { key, beat, targetHomeDigest: commit.homeDigest, previous: { blueprint, position: home.position, yaw: home.rotation * Math.PI / 2, assetHash: home.assetHash } }, expires: clock() + WAIT_MS, preparing: 0 });
        }
      });
    },
  };
}

/** Warming scenes can prepare authored meshes, but only the visible scene can claim/start the beat. */
export function deferGrowthCeremonies(feed: GrowthCeremonyFeed & { retain(key: string): () => void }): GrowthCeremonyFeed & { activate(): void; dispose(): void } {
  let active = false, disposed = false;
  const retained = new Map<string, () => void>();
  return {
    preview(scene) {
      if (disposed) return [];
      const matches = feed.preview(scene);
      // Exact authored target geometry is now owned by this preparing candidate. This lease neither
      // consumes the beat nor renews its original wait deadline; abandonment releases it immediately.
      for (const growth of matches) if (!retained.has(growth.key)) retained.set(growth.key, feed.retain(growth.key));
      return matches;
    },
    claim(key) {
      if (!active || disposed || !feed.claim(key)) return false;
      retained.get(key)?.(); retained.delete(key);
      return true;
    },
    activate() { if (!disposed) active = true; },
    dispose() {
      if (disposed) return;
      disposed = true; active = false;
      for (const release of retained.values()) release();
      retained.clear();
    },
  };
}
