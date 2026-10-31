import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment, type VoxelRenderState } from '@chatdom/render';
import type { Vec3 } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import { chooseWatchers, crowdPose, type CrowdCall, type CrowdPerson, type DoorAnchor } from '../twitch-moments';

/** How far a watcher steps out from the doorstep, in metres, and where they would stand to watch. */
const STEP = { from: 0.25, out: 2.1 } as const;

/**
 * The bench's crowd: the SIMULATED presence's present people, who step out of their own front doors when the town
 * attends to a staged beat, turn toward it and answer its climax, then go back inside. It renders through the
 * kingdom's own citizen renderer and default looks; it stands in for main's crowd until the production crowd takes
 * the same `crowdPose` calls. Nobody appears who is not present, and nobody stays out once the beat has settled.
 */
export async function createBenchCrowd(scene: THREE.Scene, pool: VoxelWorkerPool, clay: VoxelRenderState, door: (slot: number) => DoorAnchor | null) {
  const material = createVoxelMaterial(MATERIALS, 'avatar');
  // The same open-sky fill and shared light fields as the kingdom's citizens, so people read under the same lamps.
  material.material.fragmentShader = material.material.fragmentShader.replace('float sky=mix(.24,1.,vSky);', 'float sky=mix(.72,1.,vSky);')
    .replace('vec3 colour=base*edge*light*ao;', 'vec3 colour=base*edge*(light+vec3(.4,.32,.25))*ao;');
  for (const key of ['uLight', 'uLightOrigin', 'uLightExtent', 'uFarLight', 'uFarOrigin', 'uFarExtent', 'uFarCell', 'uBeaconLight', 'uBeaconOrigin', 'uBeaconExtent', 'uBeaconCell']) {
    material.material.uniforms[key] = clay.material.uniforms[key]!;
  }
  const looks = createDefaultCitizenLooks();
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 32, pool });
  let people: (CrowdPerson & { readonly door: DoorAnchor; readonly look: string })[] = [], call: CrowdCall | null = null, shown = 0;

  const standing = (d: DoorAnchor, out: number): Vec3 => [d.doorstep[0] + d.normal[0] * out, d.doorstep[1], d.doorstep[2] + d.normal[2] * out];
  const step = (turned: number) => { const t = Math.min(1, turned * 1.6); return t * t * (3 - 2 * t); };

  return {
    /** The present public windows: only these people can step out. */
    setPresent(slots: readonly number[]): void {
      people = slots.flatMap(slot => {
        const d = door(slot);
        return d ? [{ slot, door: d, look: looks[slot % looks.length]!.id, position: standing(d, STEP.out), heading: Math.atan2(d.normal[0], d.normal[2]) }] : [];
      });
    },
    call(next: CrowdCall | null): void { call = next; },
    /** Where present people would stand to watch: a step out from their own doors. */
    watchers: (): Vec3[] => people.map(p => p.position),
    update(atMs: number, hour: number, camera: THREE.Camera): void {
      const grade = getEnvironment(hour);
      material.setEnvironment({ ...grade, ambientIntensity: Math.max(0.65, grade.ambientIntensity) });
      if (!call) { if (shown) renderer.update([]); shown = 0; return; }
      const samples = chooseWatchers(call, people).flatMap(person => {
        const pose = crowdPose(call!, person, atMs), before = crowdPose(call!, person, atMs - 120);
        const out = STEP.from + (STEP.out - STEP.from) * step(pose.turned), was = STEP.from + (STEP.out - STEP.from) * step(before.turned);
        const opacity = Math.min(1, pose.turned * 4);
        if (opacity <= 0.01) return [];
        // While stepping out or back in they walk, facing the way they are going; standing, they turn to watch.
        const walking = Math.min(1, Math.abs(out - was) / 0.12);
        const heading = out < was ? person.heading + Math.PI : pose.heading;
        return [{ id: String(person.slot), look: person.look, position: standing(person.door, out), heading, distance: out, moving: walking, speed: walking * 1.1,
          opacity, gesture: walking > 0.2 ? 'none' as const : pose.gesture, time: atMs / 1000 + pose.offset, lookYaw: 0 }];
      });
      shown = samples.length;
      renderer.update(samples, camera);
    },
    stats: () => ({ people: people.length, shown }),
    dispose(): void { renderer.dispose(); material.dispose(); },
  };
}
