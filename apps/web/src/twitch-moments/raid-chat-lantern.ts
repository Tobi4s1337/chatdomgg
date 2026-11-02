import * as THREE from 'three';
import { MAT } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import type { Colour } from '../atlas/heraldry/design';
import { blueprint, box, CELL, type BannerKit } from './banner';
import { raiderArms, TINCTURE_MAT } from './raid-art';
import { Pool } from './train-view';

/** Each input is one independently witnessed chatter, already positioned by the caravan owner. */
export interface RaidChatLantern {
  readonly id: string;
  readonly sourceKingdomId: string;
  /** World-space centre of the lantern's bottom, in metres. */
  readonly position: readonly [number, number, number];
  readonly yaw: number;
  readonly opacity?: number;
}

export const RAID_CHAT_LANTERN_LIMIT = 64;
const COLOURS: readonly Colour[] = ['azure', 'vert', 'purpure', 'sable', 'gules'];

/** A 5 × 9 × 5 build-cell hanging lamp. The small tie takes the same dye as the source wagon. */
export function raidChatLanternBlueprint(kit: BannerKit, colour: Colour): VoxelBlueprint {
  const b = [
    box(0, 0, 0, 5, 1, 5, MAT.bark),
    box(1, 1, 1, 4, 2, 4, MAT.brass),
    box(0, 6, 0, 5, 7, 5, MAT.brass),
    box(1, 7, 1, 4, 8, 4, MAT.timber),
    box(2, 8, 2, 3, 9, 3, MAT.brass),
    // Corner uprights leave the warm glass visible on all four sides.
    ...[0, 4].flatMap(x => [0, 4].map(z => box(x, 2, z, x + 1, 6, z + 1, MAT.brass))),
    // A folded cloth knot and a short tail, on the outside of the cap.
    box(3, 7, 0, 5, 8, 2, TINCTURE_MAT[colour]),
    box(4, 5, 0, 5, 7, 1, TINCTURE_MAT[colour]),
  ];
  return blueprint(`moment-raid-chat-lantern-${kit}-${colour}`, kit, [5, 9, 5], b);
}

/** Prewarm these with the scene's normal voxel mesh host before applying a frame. */
export const raidChatLanternBlueprints = (kit: BannerKit): VoxelBlueprint[] =>
  COLOURS.map(colour => raidChatLanternBlueprint(kit, colour));

export interface RaidChatLanternHost {
  readonly kit: BannerKit;
  readonly material: THREE.Material;
  mesh(blueprint: VoxelBlueprint, offset: THREE.Vector3): THREE.Mesh;
}

/** The caller owns identity proof, positioning and temporal fades; this layer only draws supplied lanterns. */
export function createRaidChatLanternLayer(root: THREE.Group, host: RaidChatLanternHost) {
  const layer = new THREE.Group();
  layer.name = 'raid-chat-lanterns';
  root.add(layer);
  const pools = new Map<Colour, Pool>();
  const colours = new Map<string, Colour | null>();
  const lightGeometry = new THREE.BoxGeometry(1, 1, 1);
  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffd797, toneMapped: false });
  const lights = new THREE.InstancedMesh(lightGeometry, lightMaterial, RAID_CHAT_LANTERN_LIMIT);
  lights.name = 'raid-chat-lantern-light';
  lights.count = 0;
  lights.visible = false;
  lights.frustumCulled = false;
  lights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  layer.add(lights);
  const matrix = new THREE.Matrix4(), translate = new THREE.Matrix4(), scale = new THREE.Matrix4();
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), unit = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  let count = 0;
  let disposed = false;

  function pool(colour: Colour): Pool {
    let result = pools.get(colour);
    if (!result) {
      const part = raidChatLanternBlueprint(host.kit, colour);
      result = new Pool(host.mesh(part, new THREE.Vector3()).geometry, host.material, RAID_CHAT_LANTERN_LIMIT, layer, part.id);
      pools.set(colour, result);
    }
    return result;
  }
  function clear(): void {
    count = 0;
    for (const p of pools.values()) { p.count = 0; p.flush(); }
    lights.count = 0; lights.visible = false;
  }
  return {
    blueprints: () => raidChatLanternBlueprints(host.kit),
    apply(items: readonly RaidChatLantern[]): void {
      if (disposed) return;
      clear();
      const seen = new Set<string>();
      for (const item of items) {
        if (count >= RAID_CHAT_LANTERN_LIMIT) break;
        const opacity = item.opacity ?? 1;
        if (!item.id || seen.has(item.id) || !Number.isFinite(opacity) || opacity <= 0.01 ||
            !Number.isFinite(item.yaw) || item.position.length !== 3 || !item.position.every(Number.isFinite)) continue;
        if (!colours.has(item.sourceKingdomId)) {
          if (colours.size >= RAID_CHAT_LANTERN_LIMIT) colours.delete(colours.keys().next().value!);
          colours.set(item.sourceKingdomId, raiderArms(item.sourceKingdomId)?.colour ?? null);
        }
        const colour = colours.get(item.sourceKingdomId);
        if (!colour) continue;
        seen.add(item.id);
        const fade = Math.min(1, opacity);
        position.fromArray(item.position);
        matrix.compose(position, quaternion.setFromAxisAngle(up, item.yaw), unit);
        // The voxel mesh is min-corner based; the supplied point is bottom centre.
        pool(colour).push(matrix.clone().multiply(translate.makeTranslation(-2.5 * CELL, 0, -2.5 * CELL)), fade);
        // A restrained emissive core, not an individual point light or a large halo.
        lights.setMatrixAt(count, matrix.clone().multiply(translate.makeTranslation(0, 4 * CELL, 0))
          .multiply(scale.makeScale(2.5 * CELL * fade, 3.5 * CELL * fade, 2.5 * CELL * fade)));
        count++;
      }
      for (const p of pools.values()) p.flush();
      lights.count = count; lights.visible = count > 0;
      if (count) lights.instanceMatrix.needsUpdate = true;
    },
    clear,
    stats: () => ({ lanterns: count }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const p of pools.values()) p.dispose();
      pools.clear(); colours.clear();
      lights.removeFromParent(); lights.dispose(); lightGeometry.dispose(); lightMaterial.dispose();
      layer.removeFromParent();
      count = 0;
    },
  };
}
