import type * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import type { VoxelRenderState } from '@chatdom/render';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { createCitizenRenderer, createDefaultCitizenLooks, type CitizenSample } from '../citizens';
import type { SoulFrame, SoulRole } from '../../../../packages/world/src/soul';

const looks: Record<SoulRole, string> = { baker: 'hearth', lamplighter: 'tide', smith: 'clay', 'harbour-master': 'grove' };

/** Keepers use the same shaped, animated rig as the world, with role labels owned by soul. */
export async function createSoulKeeperRenderer(scene: THREE.Scene, material: VoxelRenderState, pool: VoxelWorkerPool) {
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material,
    looks: createDefaultCitizenLooks().filter(look => Object.values(looks).includes(look.id)), capacity: 4, pool });
  const prior = new Map<SoulRole, { point: readonly [number, number, number]; distance: number }>();
  let disposed = false;
  return {
    update(frame: SoulFrame, seconds: number, camera?: THREE.Camera) {
      if (disposed) return;
      const samples: CitizenSample[] = frame.keepers.filter(keeper => keeper.visible).map(keeper => {
        const previous = prior.get(keeper.role);
        const step = previous && keeper.moving ? Math.hypot(...keeper.position.map((v, i) => v - previous.point[i]!)) : 0;
        // A mount, seek or route reset never creates a large artificial stride.
        const distance = (previous?.distance ?? 0) + (step < 2 ? step : 0);
        prior.set(keeper.role, { point: keeper.position, distance });
        return { id: `keeper:${keeper.role}`, look: looks[keeper.role], position: keeper.position, heading: keeper.heading,
          distance, moving: keeper.moving ? 1 : 0, speed: keeper.moving ? .55 : 0, time: seconds };
      });
      for (const role of prior.keys()) if (!frame.keepers.some(keeper => keeper.role === role && keeper.visible)) prior.delete(role);
      renderer.update(samples, camera, seconds * 1000);
    },
    dispose() { if (disposed) return; disposed = true; prior.clear(); renderer.dispose(); },
  };
}
