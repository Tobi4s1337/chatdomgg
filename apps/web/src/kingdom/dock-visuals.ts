import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import type { RealmDockStageState } from '@chatdom/shared/realm';
import type { CrowdCall } from '../twitch-moments/stage-beat';
import type { DockAct, DockActScene } from './dock-acts';

/** Real installed sites and real, currently visible citizens supplied by the kingdom scene. */
export interface DockVisualSites {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly target: THREE.Vector3;
  readonly gate: Vec3 | null;
  readonly gateBraziers: readonly Vec3[];
  readonly plaza: Vec3 | null;
  citizen(slot: number): Vec3 | undefined;
  setHour(hour: number): void;
  hour(): number;
  cue?(kind: DockAct['kind']): void;
  /** Overrides the installed gate flames while the scene plays; null restores ordinary life. */
  gateFlame(strength: number | null): void;
}

const DURATION = 8500;
const smooth = (n: number) => { const t = THREE.MathUtils.clamp(n, 0, 1); return t * t * (3 - 2 * t); };

/** Actual effects inside the existing kingdom scene. The caller owns the frame loop and camera arbitration. */
export function createDockVisuals(host: DockVisualSites): DockActScene & {
  crowd(): CrowdCall | null;
  active(): boolean;
  finished(): boolean;
  restoreState(state: RealmDockStageState): void;
  tick(now: number): void;
  sources(): readonly { position: Vec3; normal: Vec3; strength: number }[];
  dispose(): void;
} {
  const root = new THREE.Group(); root.name = 'dock-royal-acts'; host.scene.add(root);
  const wood = new THREE.MeshStandardMaterial({ color: 0x54331e, roughness: 1 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x736b60, roughness: 1 });
  const gold = new THREE.MeshBasicMaterial({ color: 0xf6ca62 });
  const amber = new THREE.MeshBasicMaterial({ color: 0xff9b32, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const core = new THREE.MeshBasicMaterial({ color: 0xffe192, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const ringGeo = new THREE.TorusGeometry(.48, .045, 5, 12);
  const stoneGeo = new THREE.BoxGeometry(.38, .25, .32), logGeo = new THREE.BoxGeometry(1.2, .17, .19);
  const flameGeo = new THREE.ConeGeometry(.28, 1.05, 5);
  const sparkGeo = new THREE.BoxGeometry(.055, .055, .055);
  const fire = new THREE.Group(); fire.name = 'dock-plaza-fire'; fire.visible = false; root.add(fire);
  for (let i = 0; i < 9; i++) { const a = i * Math.PI * 2 / 9, mesh = new THREE.Mesh(stoneGeo, stone); mesh.position.set(Math.cos(a) * .65, .12, Math.sin(a) * .65); mesh.rotation.y = -a; fire.add(mesh); }
  for (let i = 0; i < 3; i++) { const mesh = new THREE.Mesh(logGeo, wood); mesh.position.y = .16 + i * .04; mesh.rotation.y = i * Math.PI / 3; fire.add(mesh); }
  const flames = new THREE.Group(); fire.add(flames);
  for (let i = 0; i < 3; i++) { const mesh = new THREE.Mesh(flameGeo, i === 1 ? core : amber); mesh.position.set((i - 1) * .12, .72, 0); mesh.scale.set(i === 1 ? .55 : .8, i === 1 ? .75 : 1, i === 1 ? .55 : .8); flames.add(mesh); }
  const fireLight = new THREE.PointLight(0xff8b32, 15, 12, 2); fireLight.position.y = .8; fire.add(fireLight);
  const honor = new THREE.Group(); honor.visible = false; root.add(honor);
  const circlet = new THREE.Mesh(ringGeo, gold); circlet.rotation.x = Math.PI / 2; honor.add(circlet);
  for (let i = 0; i < 7; i++) { const mesh = new THREE.Mesh(sparkGeo, gold); const a = i * Math.PI * 2 / 7; mesh.position.set(Math.cos(a) * .48, .08, Math.sin(a) * .48); mesh.scale.set(1, 3, 1); honor.add(mesh); }
  const gateFlare = new THREE.Group(); root.add(gateFlare);
  for (const position of host.gateBraziers) { const flame = new THREE.Mesh(flameGeo, amber); flame.position.set(position[0], position[1] + .55, position[2]); gateFlare.add(flame); }
  gateFlare.visible = false;
  const sparks = new THREE.Group(); root.add(sparks);
  for (let i = 0; i < 16; i++) sparks.add(new THREE.Mesh(sparkGeo, i % 3 ? amber : core));
  sparks.visible = false;
  let current: DockAct | undefined, focus: Vec3 | undefined, elapsed = 0, finished = false, disposed = false, lit = false;
  let crowd: CrowdCall | null = null;
  let state: RealmDockStageState | undefined;
  const honours = new Map<string, THREE.Group>();
  const makeHonor = () => {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, gold); ring.rotation.x = Math.PI / 2; group.add(ring);
    for (let i = 0; i < 7; i++) { const mesh = new THREE.Mesh(sparkGeo, gold), a = i * Math.PI * 2 / 7; mesh.position.set(Math.cos(a) * .48, .08, Math.sin(a) * .48); mesh.scale.set(1, 3, 1); group.add(mesh); }
    root.add(group); return group;
  };
  const tick = (now: number) => {
    if (disposed || !Number.isFinite(now)) return;
    if (state) {
      lit = state.fire === 'lit' && now < state.fireUntil && !!host.plaza;
      fire.visible = lit;
      if (lit && host.plaza) fire.position.set(...host.plaza);
      const live = new Set<string>();
      for (const item of state.honours) {
        if (item.expiresAt <= now) continue;
        const position = host.citizen(item.slot);
        if (!position || live.size >= 64) continue;
        live.add(item.id);
        let group = honours.get(item.id);
        if (!group) { group = makeHonor(); honours.set(item.id, group); }
        group.visible = !(current?.targetSlot === item.slot && (current.kind === 'citizen-crown' || current.kind === 'citizen-knight'));
        group.position.set(position[0], position[1] + 2.25 + .08 * Math.sin(now / 700), position[2]);
        group.rotation.y = now / 3000;
      }
      for (const [id, group] of honours) if (!live.has(id)) { root.remove(group); honours.delete(id); }
    }
    if (lit) { flames.scale.y = .92 + .12 * Math.sin(now / 140); fireLight.intensity = 14 + 3 * Math.sin(now / 175); }
  };
  const removeAct = () => { current = undefined; focus = undefined; crowd = null; honor.visible = false; gateFlare.visible = false; sparks.visible = false; };
  return {
    begin(act) {
      if (disposed) return false;
      let point: Vec3 | undefined;
      if (act.kind === 'gate-open' || act.kind === 'gate-close' || act.kind === 'raid-welcome') {
        if (!host.gate || !host.gateBraziers.length || (act.kind === 'raid-welcome' && !act.targetId)) return false;
        point = host.gate;
      } else if (act.kind === 'fire-light') {
        if (!host.plaza) return false;
        point = host.plaza; fire.position.set(...point); lit = true; fire.visible = true;
      } else if (act.kind === 'citizen-crown' || act.kind === 'citizen-knight') {
        if (act.targetSlot === undefined || !act.targetId) return false;
        point = host.citizen(act.targetSlot); if (!point) return false;
        honor.visible = true;
      } else if (act.kind === 'moment-play' && act.moment === 'sky-dusk') {
        if (!host.plaza) return false;
        point = host.plaza; host.setHour(19);
      } else return false;
      host.cue?.(act.kind);
      current = act; focus = point; elapsed = 0; finished = false;
      sparks.visible = act.kind !== 'gate-close' && act.kind !== 'moment-play';
      gateFlare.visible = act.kind === 'gate-open' || act.kind === 'raid-welcome';
      return true;
    },
    frame(act, elapsedMs) {
      if (disposed || current !== act || !focus) return false;
      elapsed = elapsedMs; finished = elapsed >= DURATION;
      if (act.targetSlot !== undefined && (act.kind === 'citizen-crown' || act.kind === 'citizen-knight')) {
        const position = host.citizen(act.targetSlot); if (!position) { honor.visible = false; crowd = null; return false; }
        focus = position; honor.position.set(position[0], position[1] + 2.25 + .12 * Math.sin(elapsed / 400), position[2]); honor.rotation.y = elapsed / 1800;
      }
      if (lit) { flames.scale.y = .92 + .12 * Math.sin(elapsed / 140); fireLight.intensity = 14 + 3 * Math.sin(elapsed / 175); }
      if (act.kind === 'gate-open') host.gateFlame(.4 + .6 * smooth(elapsed / 1200));
      if (act.kind === 'gate-close') host.gateFlame(1 - smooth(elapsed / 2500));
      for (let i = 0; i < sparks.children.length; i++) { const age = ((elapsed / 1500 + i / sparks.children.length) % 1), angle = i * 2.4; sparks.children[i]!.position.set(focus[0] + Math.cos(angle) * (1 + age), focus[1] + .5 + age * 3, focus[2] + Math.sin(angle) * (1 + age)); }
      const look = new THREE.Vector3(...focus).add(new THREE.Vector3(0, act.targetSlot === undefined ? 1.2 : 1.4, 0));
      const eye = look.clone().add(new THREE.Vector3(8, 5, 11));
      host.camera.position.copy(eye); host.target.copy(look); host.camera.lookAt(look); host.camera.fov = 43; host.camera.updateProjectionMatrix();
      const attention = smooth(elapsed / 1300) * (1 - smooth((elapsed - 7000) / 1500));
      crowd = { id: act.id, beat: act.id, subject: { kind: 'place', place: act.kind === 'raid-welcome' || act.kind.startsWith('gate-') ? 'gate' : 'plaza' },
        profile: { rank: 3, climax: 1800, payoff: 6500, end: DURATION, reach: 'town', hush: 0, cheer: act.kind !== 'gate-close', voices: false },
        startAt: act.occurredAt, climaxAt: act.occurredAt + 1800, endAt: act.occurredAt + DURATION,
        phase: elapsed < 1800 ? 'gather' : elapsed < 6500 ? 'payoff' : 'settle', attention, cheer: act.kind === 'gate-close' ? 0 : attention, hush: 0, watchers: 24, point: focus };
      // Wait for the visible effect to develop; the scene acknowledges only after drawing this frame.
      return elapsed >= 1200 && (act.kind !== 'moment-play' || Math.abs(host.hour() - 19) < .25);
    },
    end() { removeAct(); },
    crowd: () => crowd,
    active: () => !!current,
    finished: () => finished,
    restoreState(next) {
      if (disposed) return;
      state = next;
      host.gateFlame(next.gate === 'open' ? 1 : 0);
      tick(next.asOf);
    },
    tick,
    sources: () => lit && host.plaza ? [{ position: [host.plaza[0], host.plaza[1] + .6, host.plaza[2]], normal: [0, 1, 0], strength: 1 }] : [],
    dispose() { if (disposed) return; disposed = true; removeAct(); host.gateFlame(null); host.scene.remove(root); for (const geometry of [ringGeo, stoneGeo, logGeo, flameGeo, sparkGeo]) geometry.dispose(); for (const material of [wood, stone, gold, amber, core]) material.dispose(); },
  };
}
