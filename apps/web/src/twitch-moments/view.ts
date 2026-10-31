import * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { BANNER_CELLS, BANNER_TIERS, CELL, RIBBON_SLOTS, bannerBracket, bannerParts, bannerRibbon, type BannerKit, type BannerTier } from './banner';
import { breeze } from './choreography';
import { CameraPoseSchema, type CameraPose } from './contracts';
import type { FocusFrame, HomeDressFrame, MomentCue, MomentFrame } from './controller';

/** Public anchors for one home, supplied by the host's real settlement. Never derived from a deed. */
export interface HomeAnchor {
  /** Wall surface under the middle of the banner rod. */
  readonly mount: Vec3;
  /** Outward wall normal and the wall's right-hand direction, both horizontal unit vectors. */
  readonly normal: Vec3;
  readonly right: Vec3;
  /** The doorstep: what a shot of this home keeps in view. */
  readonly doorstep: Vec3;
}

export interface MomentSoundPort {
  /** Schedule a finite cue at kingdom time `atMs`; the return cancels it, including any tail. */
  play(cue: MomentCue, atMs: number, gain: number): () => void;
}

export interface CameraLease {
  read(): CameraPose;
  /** False once the lease has been revoked; the view then stops writing. */
  write(pose: CameraPose): boolean;
  release(): void;
}
export interface CameraLeasePort {
  acquire(owner: string, priority: number, signal: AbortSignal): CameraLease | null;
}

export interface MomentViewHost {
  /** A dedicated removable group under the real scene. The view owns only what it adds to it. */
  readonly parent: THREE.Group;
  /** The kingdom's crafted voxel material (build lattice). */
  readonly material: THREE.Material;
  readonly kit: BannerKit;
  /** Mesh a blueprint through the host's voxel pipeline. */
  mesh(blueprint: VoxelBlueprint): Promise<THREE.BufferGeometry>;
  homeAnchor(slot: number): HomeAnchor | null;
  readonly sound: MomentSoundPort | null;
  readonly camera: CameraLeasePort | null;
  /** Current picture size, for shot composition and labels. */
  viewport(): { width: number; height: number };
  /** Optional host check of near bounds/occlusion; returning null forbids the pose. */
  validatePose?(pose: CameraPose): CameraPose | null;
}

export interface ScreenCaption { readonly id: string; readonly title: string; readonly line: string; readonly opacity: number; readonly x: number; readonly y: number }

const DIRECTOR_PRIORITY = 20;
const EASE_IN_MS = 1500, EASE_OUT_MS = 1700, CANCEL_MS = 700;
const MOUNT = BANNER_CELLS.mount;
const local = (x: number, y: number, z: number) => new THREE.Vector3((x - MOUNT[0]) * CELL, (y - MOUNT[1]) * CELL, (z - MOUNT[2]) * CELL);
const smooth = (t: number) => { const v = Math.min(1, Math.max(0, t)); return v * v * (3 - 2 * v); };

interface HomeBanner {
  readonly root: THREE.Group;
  readonly tier: BannerTier;
  readonly bracket: THREE.Mesh;
  readonly head: THREE.Mesh;
  readonly rows: THREE.Mesh[];
  readonly roll: THREE.Group;
  readonly ribbons: THREE.Mesh[];
}

/**
 * Applies sampled frames to the host scene: banners on real homes, cue playback through the sound port and a
 * leased director shot. Every resource it creates is released on hide, frame removal or dispose.
 */
export function createTwitchMomentView(host: MomentViewHost) {
  const root = new THREE.Group();
  root.name = 'twitch-moments';
  host.parent.add(root);
  const geometries = new Map<string, Promise<THREE.BufferGeometry>>(), ready = new Map<string, THREE.BufferGeometry>();
  const banners = new Map<number, HomeBanner>();
  const playing = new Map<string, () => void>();
  let director: { focus: FocusFrame; lease: CameraLease; prior: CameraPose; shot: CameraPose; abort: AbortController; leaving: number | null; from: CameraPose | null } | null = null;
  let lastFrame: MomentFrame | null = null, disposed = false;

  function geometry(blueprint: VoxelBlueprint): Promise<THREE.BufferGeometry> {
    let promise = geometries.get(blueprint.id);
    if (!promise) {
      promise = host.mesh(blueprint).then(g => { if (disposed) g.dispose(); else ready.set(blueprint.id, g); return g; });
      geometries.set(blueprint.id, promise);
    }
    return promise;
  }

  /** Mesh every banner part before the first meaningful frame, so no beat waits on a worker. */
  async function prepare(): Promise<void> {
    const parts: VoxelBlueprint[] = [bannerBracket(host.kit), ...RIBBON_SLOTS.map((_, i) => bannerRibbon(host.kit, i))];
    for (const tier of BANNER_TIERS) { const p = bannerParts(tier, host.kit); parts.push(p.head, p.roll, ...p.rows); }
    await Promise.all(parts.map(geometry));
  }

  const meshOf = (blueprint: VoxelBlueprint, position: THREE.Vector3) => {
    const g = ready.get(blueprint.id);
    if (!g) throw new Error('Banner part used before prepare()');
    const mesh = new THREE.Mesh(g, host.material);
    mesh.position.copy(position); mesh.frustumCulled = false; mesh.matrixAutoUpdate = true;
    return mesh;
  };

  function build(slot: number, tier: BannerTier, anchor: HomeAnchor): HomeBanner {
    const group = new THREE.Group();
    group.name = `banner-${slot}`;
    const [nx, , nz] = anchor.normal, [rx, , rz] = anchor.right;
    group.matrixAutoUpdate = false;
    group.matrix.makeBasis(new THREE.Vector3(rx, 0, rz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)).setPosition(...anchor.mount);
    const parts = bannerParts(tier, host.kit);
    const bracket = meshOf(bannerBracket(host.kit), local(0, 0, 0));
    const head = meshOf(parts.head, local(BANNER_CELLS.cloth.x, BANNER_CELLS.rod.y, 1));
    const rows = parts.rows.map((row, i) => meshOf(row, local(BANNER_CELLS.cloth.x, BANNER_CELLS.rod.y - 1 - i, BANNER_CELLS.cloth.z)));
    const roll = new THREE.Group();
    roll.add(meshOf(parts.roll, new THREE.Vector3(-4.5 * CELL, -1.5 * CELL, -1.5 * CELL)));
    const ribbons = RIBBON_SLOTS.map((s, i) => meshOf(bannerRibbon(host.kit, i), local(s.x, s.top - s.length + 1, s.z)));
    group.add(bracket, head, ...rows, roll, ...ribbons);
    root.add(group);
    return { root: group, tier, bracket, head, rows, roll, ribbons };
  }

  function remove(slot: number): void {
    const banner = banners.get(slot);
    if (!banner) return;
    root.remove(banner.root);
    banners.delete(slot);
  }

  function pose(banner: HomeBanner, dress: HomeDressFrame, atMs: number): void {
    const { rows: count, x: clothX, z: clothZ } = BANNER_CELLS.cloth;
    const air = breeze(atMs, dress.slot) * (dress.active ? 1 : 0.2);
    const seated = dress.drop < 0.02;
    // The bracket is set with a weighted little settle as the roll arrives; it never sways.
    const setIn = dress.phase === 'anticipation' ? smooth((0.45 - dress.drop) / 0.12) : 1;
    banner.bracket.scale.setScalar(0.85 + 0.15 * setIn);
    banner.bracket.visible = dress.phase !== 'anticipation' || dress.drop < 0.4;
    banner.head.visible = seated;
    const length = dress.unfurl * count;
    banner.rows.forEach((row, i) => {
      const depth = (i + 1) / count;
      row.visible = seated && i + 1 <= length + 0.001;
      const out = (air * 0.028 + dress.swingPhase * 0.11) * depth ** 1.4;
      const side = Math.sin(atMs / 1000 * 1.9 + dress.slot + depth * 2.1) * 0.012 * depth * (dress.active ? 1 : 0);
      row.position.copy(local(clothX, BANNER_CELLS.rod.y - 1 - i, clothZ)).add(new THREE.Vector3(side, 0, Math.max(-0.02, out)));
    });
    // The roll rides down the wall, unwinding as it goes; it disappears once the cloth is fully out.
    const rollY = BANNER_CELLS.rod.y - length - 0.5;
    banner.roll.visible = dress.unfurl < 0.995;
    banner.roll.position.copy(local(clothX + 4.5, rollY, clothZ + 0.5)).add(new THREE.Vector3(0, dress.drop, 0.03 * Math.min(1, length / 4)));
    const thickness = 1 - 0.55 * dress.unfurl;
    banner.roll.scale.set(1, thickness, thickness);
    banner.ribbons.forEach((ribbon, i) => {
      ribbon.visible = seated && i < dress.ribbons;
      const slot = RIBBON_SLOTS[i]!;
      ribbon.position.copy(local(slot.x, slot.top - slot.length + 1, slot.z)).add(new THREE.Vector3(0, 0, air * 0.01));
    });
  }

  function syncAudio(frame: MomentFrame): void {
    const wanted = new Set(frame.audio.map(c => c.id));
    for (const [id, cancel] of playing) if (!wanted.has(id)) { cancel(); playing.delete(id); }
    if (!host.sound || !frame.visible) return;
    for (const cue of frame.audio) {
      // Play each cue once, near its authored time; a seek far past it never fires a stale sound.
      if (playing.has(cue.id) || frame.atMs < cue.atMs - 120 || frame.atMs > cue.atMs + 400) continue;
      playing.set(cue.id, host.sound.play(cue.cue, cue.atMs, cue.gain));
    }
  }

  /** A close, slightly oblique shot of the banner and its doorstep, composed for the picture's shape. */
  function shotFor(anchor: HomeAnchor): CameraPose | null {
    const { width, height } = host.viewport(), portrait = height > width;
    const mount = new THREE.Vector3(...anchor.mount), normal = new THREE.Vector3(...anchor.normal), right = new THREE.Vector3(...anchor.right);
    const door = new THREE.Vector3(...anchor.doorstep);
    const subject = mount.clone().lerp(door, 0.35).add(new THREE.Vector3(0, -0.15, 0));
    const eye = subject.clone().addScaledVector(normal, portrait ? 9.5 : 7.4).addScaledVector(right, portrait ? 1.4 : 2.6).add(new THREE.Vector3(0, portrait ? 1.6 : 1.2, 0));
    const candidate = CameraPoseSchema.safeParse({ eye: eye.toArray(), target: subject.toArray(), fov: portrait ? 56 : 44 });
    if (!candidate.success) return null;
    return host.validatePose ? host.validatePose(candidate.data) : candidate.data;
  }

  const mix = (a: CameraPose, b: CameraPose, t: number): CameraPose => {
    const k = smooth(t), lerp3 = (p: readonly number[], q: readonly number[]) => p.map((v, i) => v + (q[i]! - v) * k) as [number, number, number];
    return { eye: lerp3(a.eye, b.eye), target: lerp3(a.target, b.target), fov: a.fov + (b.fov - a.fov) * k };
  };

  function release(): void {
    if (!director) return;
    const { lease, prior, abort } = director;
    director = null;
    // Return to the actual prior view, then hand the camera back.
    lease.write(prior); lease.release(); abort.abort();
  }

  function direct(frame: MomentFrame): void {
    const atMs = frame.atMs, focus = frame.visible && frame.focus?.cut ? frame.focus : null;
    if (director && director.leaving === null && atMs < director.focus.endAt && (!focus || focus.id !== director.focus.id)) {
      // Cancelled or replaced before its end: leave promptly from wherever the shot is now.
      director.leaving = atMs; director.from = director.lease.read();
    }
    if (!director && focus && host.camera && atMs < focus.endAt) {
      const anchor = host.homeAnchor(focus.slot), shot = anchor && shotFor(anchor), abort = new AbortController();
      const lease = shot ? host.camera.acquire('twitch-moments', DIRECTOR_PRIORITY, abort.signal) : null;
      if (lease && shot) director = { focus, lease, prior: lease.read(), shot, abort, leaving: null, from: null };
    }
    if (!director) return;
    const { focus: f, lease, prior, shot } = director;
    let next: CameraPose;
    if (director.leaving !== null) {
      const t = (atMs - director.leaving) / CANCEL_MS;
      if (t >= 1) { release(); return; }
      next = mix(director.from!, prior, t);
    } else if (atMs >= f.endAt) {
      const t = (atMs - f.endAt) / EASE_OUT_MS;
      if (t >= 1) { release(); return; }
      next = mix(shot, prior, t);
    } else {
      next = mix(prior, shot, (atMs - f.startAt) / EASE_IN_MS);
    }
    if (!lease.write(next)) { director.abort.abort(); director = null; }
  }

  return {
    prepare,
    apply(frame: MomentFrame): void {
      if (disposed) return;
      lastFrame = frame;
      root.visible = frame.visible;
      const present = new Set<number>();
      for (const dress of frame.homes) {
        const anchor = host.homeAnchor(dress.slot);
        // An unavailable anchor shows nothing; a banner is never placed at a guessed address.
        if (!anchor) continue;
        let banner = banners.get(dress.slot);
        if (banner && banner.tier !== dress.tier) { remove(dress.slot); banner = undefined; }
        banner ??= build(dress.slot, dress.tier, anchor);
        banners.set(dress.slot, banner);
        pose(banner, dress, frame.atMs);
        present.add(dress.slot);
      }
      for (const slot of [...banners.keys()]) if (!present.has(slot)) remove(slot);
      syncAudio(frame);
      if (frame.visible) direct(frame); else release();
    },
    labels(camera: THREE.Camera): ScreenCaption[] {
      if (!lastFrame?.visible) return [];
      const { width, height } = host.viewport(), out: ScreenCaption[] = [];
      for (const caption of lastFrame.captions) {
        const anchor = host.homeAnchor(caption.slot);
        if (!anchor) continue;
        const p = new THREE.Vector3(...anchor.mount).add(new THREE.Vector3(0, 0.55, 0)).project(camera);
        if (p.z < 0 || p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) continue;
        out.push({ id: caption.id, title: caption.title, line: caption.line, opacity: caption.opacity, x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 });
      }
      return out;
    },
    stats: () => ({ banners: banners.size, meshes: [...banners.values()].reduce((n, b) => n + b.rows.length + b.ribbons.length + 3, 0),
      geometries: ready.size, sounds: playing.size, leased: director !== null, attached: root.parent === host.parent }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      release();
      for (const cancel of playing.values()) cancel();
      playing.clear();
      for (const slot of [...banners.keys()]) remove(slot);
      host.parent.remove(root);
      for (const g of ready.values()) g.dispose();
      ready.clear(); geometries.clear();
    },
  };
}
export type TwitchMomentView = ReturnType<typeof createTwitchMomentView>;
