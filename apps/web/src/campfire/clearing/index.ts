import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content/materials';
import { geometryFromChunks, type VoxelRenderState } from '@chatdom/render';
import { VOXEL_METRES, type Vec3, type VoxelAsset, type VoxelLattice } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { HEARTH_RADIUS, PATH_ANGLE, approachRoute, campfireArrangement, facing, forward, type Arrangement, type XZ } from '../arrangement';
import { createDistantLand, KINGDOM_ANGLE } from '../distance';
import { createFire, createLanternFlames, createSuspicionEmbers } from '../fire';
import { buildClearingLight, rasterizeOccupancy, type ClearingLight, type LightBox } from '../light';
import { lookKey, seatLookParts } from '../looks';
import { PartMeshes, createSeatedFigure, type SeatedFigure } from '../people';
import { seatedPose, sharedSeatTop, solveSeat, SEATED_POSTURES, type SeatedPosture } from '../pose';
import type { CampfirePublicSeat, CampfirePublicView, CampfireScenePort, CampfireSeatAnchor, CampfireShotSuggestion } from '../ports';
import { FIRE_FLAME_BASE, createClearingGround, createFireRing, createGameLantern, createMagistrateSeat, createRock, createSeatLog, createTree, createUndergrowth, type CampfireProp } from './props';

/*
 * The clearing at the edge of the Wilds, mounted into a scene the caller owns. It never creates a
 * second world: the caller supplies the scene, the voxel worker pool and the shared voxel
 * materials, renders, and decides the camera. `update(view, atMs)` is a pure function of the public
 * view and public time; the only state it keeps is what it has already meshed.
 */

export interface ClearingMaterials { readonly build: VoxelRenderState; readonly avatar: VoxelRenderState; readonly terrain: VoxelRenderState }
export interface ClearingOptions { readonly scene: THREE.Scene; readonly pool: VoxelWorkerPool; readonly materials: ClearingMaterials }

export interface SeatScreenAnchor { readonly seat: number; readonly label: string; readonly head: THREE.Vector3; readonly kind: CampfirePublicSeat['kind'] }

export interface CampfireClearing extends CampfireScenePort {
  /** Resolves once the static clearing is meshed. */
  readonly ready: Promise<void>;
  /** Resolves once the given view's people, logs and lanterns are meshed and placed. */
  update(view: CampfirePublicView, atMs: number): Promise<void>;
  readonly arrangement: () => Arrangement;
  readonly beacon: THREE.Vector3;
  readonly distance: ReturnType<typeof createDistantLand>;
  anchors(): readonly SeatScreenAnchor[];
  dispose(): void;
}

const hash = (n: number): number => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

interface Placed { readonly object: THREE.Object3D; readonly occluders: readonly LightBox[] }
interface SeatState { readonly key: string; readonly figure: SeatedFigure; readonly seat: CampfirePublicSeat; readonly posture: SeatedPosture }

export function mountCampfireClearing(options: ClearingOptions): CampfireClearing {
  const { scene, pool, materials } = options;
  const root = new THREE.Group();
  root.name = 'campfire.clearing';
  scene.add(root);
  const geometries = new Map<string, Promise<THREE.BufferGeometry>>();
  const parts = new PartMeshes(pool);
  const seatTop = sharedSeatTop();
  let disposed = false;

  const mesh = (asset: VoxelAsset, lattice: VoxelLattice = 'build'): Promise<THREE.BufferGeometry> => {
    const known = geometries.get(asset.id);
    if (known) return known;
    const made = pool.submit({ kind: 'asset', asset: { ...asset, voxels: asset.voxels.slice() }, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }).then(result => {
      if (result?.kind !== 'asset') throw new Error(`The clearing piece ${asset.id} did not mesh.`);
      return geometryFromChunks(result.chunks, lattice);
    });
    geometries.set(asset.id, made);
    return made;
  };

  /** Places a prop with its anchor on (x, 0, z), turned by yaw about +Y. */
  async function place(prop: CampfireProp, at: XZ, yaw: number, parent: THREE.Object3D, y = 0): Promise<Placed> {
    const geometry = await mesh(prop.asset);
    const holder = new THREE.Group();
    holder.position.set(at[0], y, at[1]);
    holder.rotation.y = yaw;
    const voxels = new THREE.Mesh(geometry, materials.build.material);
    voxels.position.set(...prop.anchor.map(v => -v * VOXEL_METRES.build) as [number, number, number]);
    voxels.name = prop.asset.id;
    holder.add(voxels);
    parent.add(holder);
    holder.updateMatrixWorld(true);
    const occluders = prop.occluders.map(box => {
      const bounds = new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max)).applyMatrix4(holder.matrixWorld);
      return { min: bounds.min.toArray() as unknown as Vec3, max: bounds.max.toArray() as unknown as Vec3 };
    });
    return { object: holder, occluders };
  }

  // ── The place itself: floor, hearth, the Wilds around it and the land beyond.
  const fire = createFire();
  fire.group.position.set(...FIRE_FLAME_BASE);
  root.add(fire.group);
  const lanternFlames = createLanternFlames(12), suspicion = createSuspicionEmbers(11);
  root.add(lanternFlames.group, suspicion.group);
  const distance = createDistantLand();
  root.add(distance.group);
  const staticOccluders: LightBox[] = [];
  const ready = (async () => {
    const tasks: Promise<Placed>[] = [
      place(createClearingGround({ radius: 10.5, path: { direction: PATH_ANGLE, width: 1.1 }, hearthRadius: 1.25, seed: 11 }), [0, 0], 0, root),
      place(createFireRing(3), [0, 0], 0, root),
    ];
    tasks.push(placeOuterGround());
    // Wilds: a ring of trees, thinned along the footpath so the kingdom shows through.
    const trees = forest();
    for (const tree of trees) tasks.push(place(createTree(tree.variant, tree.seed), tree.at, tree.yaw, root));
    for (const [i, rock] of [[-1.15, 7.4, 0], [.95, 8.3, 1], [2.3, 6.8, 2], [-2.85, 8.9, 1], [3.1, 9.6, 0], [-.4, 10.6, 2]].entries()) {
      const [angle, radius, variant] = rock as [number, number, 0 | 1 | 2];
      tasks.push(place(createRock(variant, 40 + i), [Math.sin(angle) * radius, Math.cos(angle) * radius], hash(i + 3) * 6.28, root));
    }
    for (let i = 0; i < 34; i++) {
      const angle = hash(i + 70) * Math.PI * 2, radius = 4.4 + hash(i + 90) * 5.6;
      if (Math.abs(wrap(angle - PATH_ANGLE)) < .3) continue;
      const kind = (['fern', 'grass', 'grass', 'flowers', 'fern', 'mushrooms'] as const)[i % 6]!;
      tasks.push(place(createUndergrowth(kind, 100 + (i % 4)), [Math.sin(angle) * radius, Math.cos(angle) * radius], Math.floor(hash(i + 5) * 4) * Math.PI / 2, root));
    }
    for (const placed of await Promise.all(tasks)) staticOccluders.push(...placed.occluders);
  })();

  async function placeOuterGround(): Promise<Placed> {
    // Beyond the clearing the Wilds floor runs to the ridges on the coarse terrain lattice.
    const cells = 200, asset: VoxelAsset = { id: 'campfire.wilds-floor', revision: 1, lattice: 'terrain', size: [cells, 2, cells], voxels: new Uint16Array(cells * 2 * cells) };
    for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
      const n = hash(x * 3.1 + z * 7.7);
      const top = n < .08 ? MAT.earth : n < .4 ? MAT.moss : n < .47 ? MAT.leaf : MAT.grass;
      asset.voxels[x + cells * (0 + 2 * z)] = MAT.earth;
      asset.voxels[x + cells * (1 + 2 * z)] = top;
    }
    const geometry = await mesh(asset, 'terrain');
    const floor = new THREE.Mesh(geometry, materials.terrain.material);
    // Its top sits a hair below the clearing floor, inside that slab, so the two never fight.
    floor.position.set(-cells * VOXEL_METRES.terrain / 2, -2 * VOXEL_METRES.terrain - .02, -cells * VOXEL_METRES.terrain / 2);
    root.add(floor);
    return { object: floor, occluders: [] };
  }

  function forest(): { at: XZ; yaw: number; variant: 0 | 1 | 2 | 3 | 4; seed: number }[] {
    const out: { at: XZ; yaw: number; variant: 0 | 1 | 2 | 3 | 4; seed: number }[] = [];
    for (let i = 0; i < 44; i++) {
      const ring = i < 26 ? 0 : 1;
      const angle = (i / (ring ? 18 : 26)) * Math.PI * 2 + hash(i) * .2;
      const radius = ring ? 17 + hash(i + 7) * 9 : 10.6 + hash(i + 3) * 3.4;
      // Keep the path and the view to the kingdom open, and the near camera side light.
      if (Math.abs(wrap(angle - PATH_ANGLE)) < .26 || Math.abs(wrap(angle - KINGDOM_ANGLE)) < (ring ? .2 : .14)) continue;
      if (Math.abs(wrap(angle)) < .5 && !ring) continue;
      const variant = (hash(i + 11) < .12 ? 4 : hash(i + 13) < .3 ? 3 : hash(i + 17) < .5 ? 2 : i % 2) as 0 | 1 | 2 | 3 | 4;
      // Two authored seeds per variant, turned and placed apart, keep the build small and shared.
      out.push({ at: [Math.sin(angle) * radius, Math.cos(angle) * radius], yaw: Math.floor(hash(i + 19) * 4) * Math.PI / 2, variant, seed: 200 + (i % 2) });
    }
    return out;
  }

  // ── The ring: logs, the Magistrate's chair, lanterns and people, rebuilt when the circle changes.
  let arrangement = campfireArrangement(0, false);
  let ring: { key: string; group: THREE.Group; occluders: LightBox[]; lanterns: { seat: number; flame: THREE.Vector3; at: XZ; object: THREE.Object3D }[] } | null = null;
  let building: Promise<void> | null = null;
  let buildingKey = '';
  const seats = new Map<number, SeatState>();
  let current: CampfirePublicView | null = null;
  let lightKey = '';
  let lightRevision = 0;

  async function buildRing(players: number, magistrate: boolean, key: string): Promise<void> {
    const next = campfireArrangement(players, magistrate);
    const group = new THREE.Group();
    group.name = `campfire.ring.${key}`;
    const occluders: LightBox[] = [];
    const lanterns: { seat: number; flame: THREE.Vector3; at: XZ; object: THREE.Object3D }[] = [];
    const tasks: Promise<unknown>[] = [];
    for (const [i, log] of next.logs.entries()) tasks.push(place(createSeatLog({ length: log.length, seatTop, seed: 31 + i }), log.centre, log.yaw, group).then(p => occluders.push(...p.occluders)));
    if (next.magistrate) {
      const chair = next.seats[0]!;
      tasks.push(place(createMagistrateSeat({ seatTop, seed: 5 }), forward(chair.hip, chair.heading, -.02), chair.heading, group).then(p => occluders.push(...p.occluders)));
    }
    for (const seat of next.seats) if (seat.lantern) {
      const lantern = createGameLantern(60 + seat.seat);
      const yaw = facing(seat.lantern, [0, 0]);
      tasks.push(place(lantern, seat.lantern, yaw, group).then(p => {
        occluders.push(...p.occluders);
        lanterns.push({ seat: seat.seat, at: seat.lantern!, object: p.object, flame: new THREE.Vector3(...lantern.flame).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(seat.lantern![0], 0, seat.lantern![1])) });
      }));
    }
    await Promise.all(tasks);
    if (disposed) return;
    ring?.group.removeFromParent();
    root.add(group);
    ring = { key, group, occluders, lanterns };
    arrangement = next;
    for (const state of seats.values()) state.figure.dispose();
    seats.clear();
    lightKey = '';
  }

  const postureFor = (seat: CampfirePublicSeat): SeatedPosture => seat.kind === 'magistrate' ? 'upright' : SEATED_POSTURES[Math.floor(hash(seat.seat * 5 + seat.label.length) * 3)]!;

  async function seatPeople(view: CampfirePublicView): Promise<void> {
    const wanted = view.seats.filter(s => s.presence !== 'departed');
    for (const [seat, state] of seats) if (!wanted.some(s => s.seat === seat && lookKey(s.look) === state.key)) { state.figure.dispose(); seats.delete(seat); }
    await Promise.all(wanted.filter(s => !seats.has(s.seat)).map(async seat => {
      const figure = await createSeatedFigure(seatLookParts(seat.look), parts, materials.avatar);
      if (disposed) return;
      root.add(figure.root);
      seats.set(seat.seat, { key: lookKey(seat.look), figure, seat, posture: postureFor(seat) });
    }));
    for (const seat of wanted) { const state = seats.get(seat.seat); if (state) seats.set(seat.seat, { ...state, seat }); }
  }

  function headOf(seat: number): THREE.Vector3 | null {
    const place = arrangement.seats.find(s => s.seat === seat);
    const state = seats.get(seat);
    if (!place || !state) return null;
    const head = solveSeat(state.posture).head;
    return new THREE.Vector3(head[0], head[1], head[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), place.heading).add(new THREE.Vector3(place.hip[0], 0, place.hip[1]));
  }

  /** Whom each sitter attends to: the fire, the Magistrate, a neighbour, or whoever the Gallery suspects. */
  function attention(seat: number, time: number, view: CampfirePublicView): number {
    const place = arrangement.seats.find(s => s.seat === seat);
    if (!place) return 0;
    const others = arrangement.seats.filter(s => s.seat !== seat && seats.has(s.seat));
    const suspect = view.gallery?.embers.reduce<{ seat: number; glow: number } | null>((best, e) => !best || e.glow > best.glow ? e : best, null)?.seat;
    const period = 5.5 + hash(seat * 3) * 4;
    const target = (k: number): THREE.Vector3 | null => {
      const r = hash(seat * 17 + k * 7.3);
      if (r < .3 || !others.length) return null;
      if (suspect !== undefined && suspect !== seat && r < .52) return headOf(suspect);
      if (r < .66 && seat !== 0 && seats.has(0)) return headOf(0);
      return headOf(others[Math.floor(hash(seat + k * 11) * others.length)]!.seat);
    };
    const yawTo = (point: THREE.Vector3 | null): number => {
      const to = point ? [point.x, point.z] as const : [0, 0] as const;
      return Math.max(-1.2, Math.min(1.2, wrap(facing(place.hip, to) - place.heading)));
    };
    const phase = (time + hash(seat) * period) / period, k = Math.floor(phase), blend = Math.min(1, (phase - k) * period / .9);
    const eased = blend * blend * (3 - 2 * blend);
    return yawTo(target(k - 1)) * (1 - eased) + yawTo(target(k)) * eased;
  }

  function updateLight(view: CampfirePublicView, fireStrength: number): void {
    if (!ring) return;
    const lit = ring.lanterns.filter(l => view.seats.some(s => s.seat === l.seat && s.lantern === 'lit'));
    const people = [...seats.keys()].sort((a, b) => a - b);
    const key = `${ring.key}|${fireStrength.toFixed(2)}|${lit.map(l => l.seat).join(',')}|${people.join(',')}`;
    if (key === lightKey) return;
    lightKey = key;
    const bodies: LightBox[] = people.flatMap(seat => {
      const head = headOf(seat), place = arrangement.seats.find(s => s.seat === seat);
      if (!head || !place) return [];
      return [{ min: [head.x - .2, head.y - .25, head.z - .2], max: [head.x + .2, head.y + .25, head.z + .2] },
        { min: [place.hip[0] - .2, .2, place.hip[1] - .2], max: [place.hip[0] + .2, .7, place.hip[1] + .2] }];
    });
    const sources: ClearingLight[] = [
      { position: [FIRE_FLAME_BASE[0], FIRE_FLAME_BASE[1] + .3, FIRE_FLAME_BASE[2]], strength: .5 + .5 * fireStrength, reach: 4 + 6 * fireStrength },
      ...lit.map(l => ({ position: [l.flame.x, l.flame.y + .05, l.flame.z] as Vec3, strength: .5, reach: 1.7 })),
    ];
    const volume = buildClearingLight(++lightRevision, rasterizeOccupancy([...staticOccluders, ...ring.occluders, ...bodies]), sources);
    for (const material of Object.values(materials)) material.setLight(volume);
  }

  return {
    ready, beacon: distance.beacon, distance,
    arrangement: () => arrangement,
    async update(view, atMs) {
      current = view;
      // Seat numbers are stable: an empty or departed seat must not hide higher-numbered sitters.
      const players = Math.max(0, ...view.seats.filter(s => s.kind === 'player').map(s => s.seat));
      const magistrate = view.seats.some(s => s.kind === 'magistrate' && s.presence !== 'departed');
      const key = `${players}:${magistrate}`;
      if (ring?.key !== key) {
        if (buildingKey !== key) { buildingKey = key; building = buildRing(players, magistrate, key); }
        await building;
      }
      await seatPeople(view);
      if (disposed || current !== view) return;
      const time = atMs / 1000;
      const fireStrength = view.lifecycle === 'closed' ? 0 : view.lifecycle === 'ended' || view.lifecycle === 'interrupted' ? .55 : 1;
      fire.update(time, { strength: fireStrength, wind: .12 + .05 * Math.sin(time * .31) });
      for (const [seat, state] of seats) {
        const place = arrangement.seats.find(s => s.seat === seat);
        if (!place) { state.figure.root.visible = false; continue; }
        state.figure.root.visible = true;
        state.figure.root.position.set(place.hip[0], 0, place.hip[1]);
        state.figure.root.rotation.y = place.heading;
        state.figure.root.updateMatrix();
        state.figure.pose(seatedPose({ posture: state.posture, time, phase: hash(seat + 1), attend: attention(seat, time, view), attention: view.phase?.id === 'discussion' ? .5 : 0 }));
      }
      const lanterns = ring?.lanterns ?? [];
      lanternFlames.update(time, lanterns.flatMap(l => {
        const seat = view.seats.find(s => s.seat === l.seat);
        return seat && seat.lantern !== 'none' ? [{ flame: l.flame, lit: seat.lantern === 'lit', seed: l.seat }] : [];
      }));
      // Game lanterns belong to a match; between games the ring is only logs.
      for (const l of lanterns) l.object.visible = view.seats.some(s => s.seat === l.seat && s.lantern !== 'none');
      suspicion.update(time, (view.gallery?.embers ?? []).flatMap(e => {
        const place = arrangement.seats.find(s => s.seat === e.seat);
        if (!place) return [];
        const at = forward(place.hip, place.heading, .62);
        return [{ at: new THREE.Vector3(at[0], .02, at[1]), glow: e.glow }];
      }));
      updateLight(view, fireStrength);
    },
    anchors() {
      return [...seats.values()].flatMap(state => {
        const head = headOf(state.seat.seat);
        return head ? [{ seat: state.seat.seat, label: state.seat.label, kind: state.seat.kind, head: head.add(new THREE.Vector3(0, .42, 0)) }] : [];
      });
    },
    seats(): readonly CampfireSeatAnchor[] {
      return arrangement.seats.map(place => {
        const posture = seats.get(place.seat)?.posture ?? 'knees';
        const solution = solveSeat(posture);
        const soles = forward(place.hip, place.heading, solution.soleForward);
        const head = headOf(place.seat) ?? new THREE.Vector3(place.hip[0], solution.head[1], place.hip[1]);
        return { seat: place.seat, soles: [soles[0], 0, soles[1]], heading: place.heading, head: [head.x, head.y, head.z] };
      });
    },
    approach(seat) {
      return approachRoute(arrangement, seat, solveSeat(seats.get(seat)?.posture ?? 'knees').soleForward).map(([x, z]) => [x, 0, z] as const);
    },
    suggestions(view, atMs): readonly CampfireShotSuggestion[] {
      const out: CampfireShotSuggestion[] = [{ shot: 'establishing', seats: [], priority: 1, expiresAtMs: atMs + 12_000, reason: 'gathering' }];
      const suspect = view.gallery?.embers.find(e => e.glow === 3);
      if (view.phase?.id === 'discussion' && suspect) out.push({ shot: 'face', seats: [suspect.seat], priority: 2, expiresAtMs: atMs + 6_000, reason: 'suspicion' });
      const out_ = view.seats.filter(s => s.lantern === 'out').map(s => s.seat);
      if (view.phase?.id === 'dawn' && out_.length) out.push({ shot: 'lantern', seats: out_, priority: 3, expiresAtMs: view.phase.deadlineMs ?? atMs + 8_000, reason: 'dawn' });
      return out.sort((a, b) => b.priority - a.priority);
    },
    dispose() {
      disposed = true;
      for (const state of seats.values()) state.figure.dispose();
      seats.clear();
      fire.dispose(); lanternFlames.dispose(); suspicion.dispose(); distance.dispose();
      root.removeFromParent();
      void parts.dispose();
      for (const geometry of geometries.values()) void geometry.then(g => g.dispose(), () => {});
      geometries.clear();
    },
  };
}

export { HEARTH_RADIUS };
