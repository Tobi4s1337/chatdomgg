import type { Vec3 } from '@chatdom/shared';
import { createHash } from 'node:crypto';
import type { RealmFoundedScene } from '@chatdom/world';
import { foundedGroundAt } from '@chatdom/world/founded-collision';
import { canonicalSceneJson } from '../founded/codec';
import type { FishingInstallation } from './cast';
import { installPier, pierLocalToWorld, pierWaterAt } from './site';

export interface FishingRoomInstallation extends FishingInstallation {
  readonly rack: Vec3;
  /** The lantern glass the adopted pier carries, in world metres. */
  readonly lights?: readonly Vec3[];
}

/** Exact adopted content only: a plausible lake or a planned pier cannot authorize fishing. */
export function fishingInstallationFromScene(scene: RealmFoundedScene, revision: number,
  biome: string | null = null): FishingRoomInstallation | null {
  if (scene.collisionRevision !== revision || (biome !== null && (!/^[a-z][a-z0-9-]{0,63}$/.test(biome) || biome === 'unknown'))) return null;
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const pieces = [];
  for (const placement of scene.placements) {
    const blueprint = assets.get(placement.assetHash);
    if (!blueprint) return null;
    pieces.push({ ...placement, blueprint });
  }
  const installed = installPier(scene.plan, pieces);
  if (!installed) return null;
  const present = scene.placements.filter(piece => piece.id.startsWith('pier:'));
  if (present.length !== installed.pieces.length || new Set(present.map(piece => piece.id)).size !== present.length) return null;
  for (const expected of installed.pieces) {
    const actual = present.find(piece => piece.id === expected.id);
    const bytes = canonicalSceneJson(expected.blueprint);
    // Same canonical UTF-8/SHA-256 identity as the browser-safe async founded codec, without an async tick gap.
    const hash = createHash('sha256').update(bytes, 'utf8').digest('hex');
    if (!actual || actual.rotation !== expected.rotation || actual.assetHash !== hash
      || canonicalSceneJson(assets.get(actual.assetHash)) !== bytes
      || actual.position.some((value, axis) => value !== expected.position[axis])) return null;
  }
  return { site: biome === null ? installed.site : Object.freeze({ ...installed.site, biome }), revision, biome,
    rack: Object.freeze(pierLocalToWorld(installed.site, installed.content.anchors.rack)),
    lights: Object.freeze(installed.content.lights.map(light => Object.freeze(pierLocalToWorld(installed.site, light.at)))),
    sample: (x, z) => ({ waterY: pierWaterAt(scene.plan, x, z), groundY: foundedGroundAt(scene.plan, x, z)[1] }),
  };
}

/** The founded loader publishes immutable scene identities. Rebuild only when that adoption changes. */
export function createFishingInstallationReader(options: {
  scene(): RealmFoundedScene | null;
  revision(): number;
  /** Explicit adopted recipe identity, when available. Never infer it from a style or landscape character. */
  biome?(): string | null;
}) {
  let seen: RealmFoundedScene | null = null, seenBiome: string | null = null;
  let cached: FishingRoomInstallation | null = null;
  return (): FishingRoomInstallation | null => {
    const scene = options.scene(), revision = options.revision(), biome = options.biome?.() ?? null;
    if (!scene || scene.collisionRevision !== revision) return null;
    if (scene !== seen || biome !== seenBiome) {
      cached = fishingInstallationFromScene(scene, revision, biome); seen = scene; seenBiome = biome;
    }
    return cached;
  };
}
