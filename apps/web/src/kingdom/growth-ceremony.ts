import * as THREE from 'three';
import { geometryFromChunks, type VoxelRenderState, type WindowHouse } from '@chatdom/render';
import type { MaterialRegistry, Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { createScaffold, SCAFFOLD_OFFSET } from '../growth/stage/props';
import { createGrowthMaterial } from '../growth/stage/growth-material';
import { growPhases, smooth, span } from '../growth/score';
import type { ForgeReactionCue } from './forge-flight';
import type { GrowthCeremonyFeed, WitnessedHomeGrowth } from './growth-ceremony-feed';
import type { createKingdomSound } from './sound';

/** One authored home, its old geometry and construction timber; no new authority or substitute town. */
export function createHomeGrowthCeremony(options: {
  scene: THREE.Scene; founded: RealmFoundedScene; feed: GrowthCeremonyFeed; houses: readonly WindowHouse[];
  pool: VoxelWorkerPool; material: VoxelRenderState; registry: MaterialRegistry;
  sound: ReturnType<typeof createKingdomSound>;
  maskHome(id: string, hidden: boolean): void;
  maskLife(slot: number, hidden: boolean): void;
}) {
  type Piece = { mesh: THREE.Mesh; material: ReturnType<typeof createGrowthMaterial> };
  type Act = { growth: WitnessedHomeGrowth; home: WindowHouse; id: string; old?: Piece | undefined; next?: Piece | undefined; scaffold?: Piece | undefined; started?: number; done: boolean };
  const acts: Act[] = [], resources: Piece[] = [];
  let disposed = false, current: Act | undefined, elapsed = 0, cues = 0, held: number | null = null;
  const axis = new THREE.Vector3(0, 1, 0);
  for (const growth of options.feed.preview(options.founded)) {
    const plot = options.founded.plan.homes.find(p => p.id === growth.beat.plotId);
    const home = plot && options.houses.find(h => h.slot === plot.slot);
    const placement = options.founded.placements.find(p => p.plotId === growth.beat.plotId && p.assetHash === (home as WindowHouse & { assetHash?: string } | undefined)?.assetHash);
    if (!home || !placement) continue;
    acts.push({ growth, home, id: placement.id, done: false });
    options.maskHome(placement.id, true); options.maskLife(home.slot, true);
  }
  async function piece(blueprint: VoxelBlueprint, position: Vec3, yaw: number): Promise<Piece | undefined> {
    const result = await options.pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: options.registry.materials, materialRevision: options.registry.revision });
    if (disposed || result?.kind !== 'asset') return;
    const material = createGrowthMaterial(options.material);
    const mesh = new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), material.material);
    mesh.position.set(...position); mesh.rotation.y = yaw; mesh.frustumCulled = false;
    mesh.name = `home-growth:${blueprint.id}`; options.scene.add(mesh);
    const item = { mesh, material }; resources.push(item); return item;
  }
  const ready = Promise.all(acts.map(async act => {
    const { previous, beat } = act.growth;
    act.old = await piece(previous.blueprint, previous.position, previous.yaw);
    act.next = await piece(act.home.blueprint, act.home.position, act.home.yaw);
    const offset = new THREE.Vector3(...SCAFFOLD_OFFSET).applyAxisAngle(axis, act.home.yaw).add(new THREE.Vector3(...act.home.position));
    act.scaffold = await piece(createScaffold(act.home.blueprint, beat.to), offset.toArray() as Vec3, act.home.yaw);
    if (act.next) act.next.mesh.visible = false;
    if (act.scaffold) act.scaffold.mesh.visible = false;
  })).then(() => {});
  function finish(act: Act) {
    act.done = true;
    for (const piece of [act.old, act.next, act.scaffold]) if (piece) piece.mesh.visible = false;
    options.maskHome(act.id, false); options.maskLife(act.home.slot, false);
  }
  function anchor(act: Act): Vec3 {
    const window = act.home.blueprint.windows[0];
    const local = window?.centre ?? [act.home.blueprint.size[0] / 2, 8, act.home.blueprint.size[2]];
    return new THREE.Vector3(...local).multiplyScalar(.125).applyAxisAngle(axis, act.home.yaw).add(new THREE.Vector3(...act.home.position)).toArray() as Vec3;
  }
  function update(now: number, loaded: boolean) {
    if (disposed || !loaded) return;
    if (!current) {
      for (const act of acts) {
        if (act.done || !act.old || !act.next || !act.scaffold) continue;
        if (options.feed.claim(act.growth.key)) { current = act; act.started = now; cues = 0; break; }
        if (!options.feed.preview(options.founded).some(g => g.key === act.growth.key)) finish(act);
      }
    }
    if (!current) return;
    const act = current, phases = growPhases(act.growth.beat.to);
    elapsed = held ?? Math.max(0, (now - act.started!) / 1000);
    const build = smooth(span(elapsed, phases.build)), scaffold = smooth(span(elapsed, phases.scaffold));
    const strike = smooth(span(elapsed, phases.strike)), hearth = span(elapsed, phases.hearth);
    const bottom = act.home.position[1] - .02, height = act.home.blueprint.size[1] * .125;
    const top = bottom + height * build;
    act.old!.mesh.visible = build < 1;
    act.old!.material.setCut(build > 0 ? top : -1e6, 1e6);
    act.next!.mesh.visible = build > 0;
    act.next!.material.setCut(-1e6, build < 1 ? top : 1e6); act.next!.material.setGlow(build > 0 && build < 1 ? .12 : 0);
    // Once the roof arrives it gently seats on its original foundation; the door/plot never shifts.
    const settling = span(elapsed, phases.settle);
    act.next!.mesh.position.y = act.home.position[1] + (settling > 0 && settling < 1 ? .16 * Math.sin(settling * Math.PI) * (1 - settling) : 0);
    const timber = act.scaffold!;
    timber.mesh.visible = scaffold > 0 && strike < 1;
    timber.material.setCut(bottom + height * strike, bottom + (height + 1) * scaffold);
    if (hearth > 0) options.maskLife(act.home.slot, false);
    if (!(cues & 1) && scaffold > 0) { cues |= 1; options.sound.cue('step'); }
    if (!(cues & 2) && build >= 1) { cues |= 2; options.sound.cue('place'); }
    if (!(cues & 4) && hearth > 0) { cues |= 4; options.sound.cue('light'); }
    if (elapsed >= phases.length) { finish(act); current = undefined; }
  }
  return {
    ready, update,
    seek(seconds: number | null) { held = seconds === null ? null : Math.max(0, seconds); },
    active() { return !!current; },
    reaction(): ForgeReactionCue | null {
      if (!current) return null;
      const phases = growPhases(current.growth.beat.to), position = anchor(current);
      return elapsed >= phases.cheer[0] ? { position, socket: position, phase: 'landed', elapsed: 19 + elapsed - phases.cheer[0] } : { position, phase: 'flight', elapsed: 16 };
    },
    sources() {
      if (!current) return [];
      const p = growPhases(current.growth.beat.to), strength = smooth(span(elapsed, p.hearth)) * (1 - smooth(span(elapsed, [p.length - 1.6, p.length])));
      return [{ id: `growth-hearth:${current.home.slot}`, slot: current.home.slot, position: anchor(current), normal: [Math.sin(current.home.yaw), 0, Math.cos(current.home.yaw)] as Vec3, strength: strength * .8, level: Math.round(strength * 12), name: null }];
    },
    direct(camera: THREE.PerspectiveCamera, target: THREE.Vector3, permitted: boolean) {
      if (!current || !permitted) return false;
      const home = current.home, size = home.blueprint.size.map(n => n * .125), centre = new THREE.Vector3(size[0]! / 2, size[1]! * .4, size[2]! * .5).applyAxisAngle(axis, home.yaw).add(new THREE.Vector3(...home.position));
      // A three-quarter street view reads the growing rear wing, whole roof and neighbours together.
      const distance = Math.max(size[0]!, size[2]!) * (camera.aspect < 1 ? 2.25 : 1.48);
      const eye = new THREE.Vector3(distance * .8, distance * .67, distance).applyAxisAngle(axis, home.yaw).add(centre);
      const phases = growPhases(current.growth.beat.to), blend = smooth(Math.min(elapsed / 1.4, (phases.length - elapsed) / 1.4));
      camera.position.lerp(eye, blend); target.lerp(centre, blend); camera.fov = THREE.MathUtils.lerp(camera.fov, 48, blend); camera.updateProjectionMatrix(); camera.lookAt(target);
      return true;
    },
    inspect() { return { pending: acts.filter(a => !a.done).length, active: current?.growth.key ?? null, elapsed, plotId: current?.growth.beat.plotId ?? null }; },
    dispose() {
      if (disposed) return; disposed = true;
      for (const act of acts) finish(act);
      for (const { mesh, material } of resources) { options.scene.remove(mesh); mesh.geometry.dispose(); material.dispose(); }
      resources.length = 0;
    },
  };
}
