import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { createCitizenRenderer, createDefaultCitizenLooks, type CitizenSample } from '../citizens';
import { kingdomWaterMood, type FishingMood, type FishingPierSite, type Vec3 } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from '@chatdom/world/founded-collision';
import { pierLocalToWorld, pierWaterAt, type PierInstallation } from '../../../realm/src/fishing/site';
import { createFishingController, type FishingController } from './controller';
import { bindFishingInput } from './input';
import { mountPierLayer, type PierLayer, type PierLayerSound, type PierLayerUi, type PierWalker } from './layer';
import { fishingLink } from './link';
import { createStagedPier } from './staged';

const CELL = .125;

export interface PlayStageOptions {
  readonly scene: THREE.Scene; readonly camera: THREE.PerspectiveCamera; readonly canvas: HTMLCanvasElement; readonly hud: HTMLElement;
  readonly site: FishingPierSite; readonly installation: PierInstallation; readonly plan: SettlementPlan;
  readonly query: URLSearchParams;
  hour(): number;
  readonly sound?: PierLayerSound | null;
  readonly ui?: PierLayerUi | null;
  readonly portrait?: (defId: string) => Promise<CanvasImageSource | null>;
  readonly onGrant?: Parameters<typeof createStagedPier>[0]['onGrant'];
  /** Joins the person's controller to the HUD around the stage (belt, bag). */
  readonly attach?: (controller: FishingController) => void;
  /** Told the stage clock (ms) on every drawn frame; a recording runs the overlay's timers on it. */
  readonly onClock?: (clock: number) => void;
}

export interface PlayStage {
  readonly controller: FishingController;
  readonly layer: PierLayer;
  frame(): void;
  /** Seconds since the stage opened, on its own (pausable, steppable) clock: the water and sky move with it. */
  seconds(): number;
  /** Review handles: a paused clock that can be stepped, and a fair automatic player. */
  readonly debug: {
    pause(paused: boolean): void; advance(ms: number, drawEvery?: number): Promise<void>; auto(on: boolean): void; mood(value: FishingMood | null): void;
    press(): void; release(): void; take(): void; camera(view: 'shoulder' | 'first' | 'side' | 'shore'): void;
    state(): unknown; stats(): unknown; fight(): unknown;
  };
  dispose(): void;
}

/** The staged pier on the review bench: one person's first-person rod and a second fisher across the head. */
export async function createPlayStage(options: PlayStageOptions): Promise<PlayStage> {
  const { site, installation, plan, camera } = options;
  const turnYaw = site.turn * Math.PI / 2, byteYaw = site.turn * 64;
  const local = (x: number, z: number): Vec3 => pierLocalToWorld(site, [10 + x / CELL, 0, z / CELL]);
  const selfAt = local(-1.1, site.walk + 3.35), otherAt = local(2.3, site.walk + 3.3);
  let clock = Date.UTC(2026, 10, 2) + Math.floor(options.hour() * 3_600_000), paused = false, last = performance.now(), auto = false;
  // Server time is whole milliseconds; frames advance it by fractions.
  const now = () => Math.floor(clock);
  let moodOverride: FishingMood | null = (options.query.get('mood') as FishingMood | null) ?? null;
  const pose = (at: Vec3, yaw: number) => () => ({ position: [at[0], site.deckY, at[2]] as Vec3, yaw, grounded: true, collisionRevision: 1 });
  const staged = createStagedPier({ kingdomId: '129634568', site, rack: pierLocalToWorld(site, installation.content.anchors.rack), revision: 1,
    sample: (x, z) => ({ waterY: pierWaterAt(plan, x, z), groundY: foundedGroundAt(plan, x, z)[1] }), where: 'Willowmere pier', clock: now,
    ...(options.query.get('seed') ? { seeds: [Number(options.query.get('seed'))] } : {}),
    ...(options.onGrant ? { onGrant: options.onGrant } : {}),
    people: [{ personId: '1001', walkerId: 'juniper', name: 'Juniper', pose: pose(selfAt, (byteYaw + 252) % 256) },
      { personId: '1002', walkerId: 'saoirse', name: 'saoirse_k', pose: pose(otherAt, (byteYaw + 6) % 256) }] });
  const controller = createFishingController({ link: fishingLink(staged.room('1001')), selfWalkerId: 'juniper', now });
  const other = createFishingController({ link: fishingLink(staged.room('1002')), selfWalkerId: 'saoirse', now });
  const walkers: PierWalker[] = [
    { id: 'juniper', position: [selfAt[0], site.deckY, selfAt[2]], yaw: turnYaw - 4 * Math.PI / 128, self: true, name: 'Juniper' },
    { id: 'saoirse', position: [otherAt[0], site.deckY, otherAt[2]], yaw: turnYaw + 6 * Math.PI / 128, self: false, name: 'saoirse_k' },
  ];
  // Two people stand at the lip in the kingdom's own bodies; the rods sit in their right-hand grips.
  const looks = createDefaultCitizenLooks();
  const bodyMaterial = createVoxelMaterial(MATERIALS, 'avatar');
  const bodies = await createCitizenRenderer(options.scene, { registry: MATERIALS, material: bodyMaterial, looks: looks.filter(look => look.id === 'tide' || look.id === 'hearth'), capacity: 2 });
  const samples: CitizenSample[] = [];
  let lastGrade = -1;
  const mood = () => moodOverride ?? kingdomWaterMood('129634568' as never, Math.floor(clock));
  const layer = await mountPierLayer({ scene: options.scene, camera, site, lights: installation.content.lights.map(light => pierLocalToWorld(site, light.at)),
    rack: pierLocalToWorld(site, installation.content.anchors.rack), controller,
    hour: () => ((clock - Date.UTC(2026, 10, 2)) / 3_600_000) % 24, mood, walkers: () => walkers,
    viewport: () => ({ width: options.canvas.clientWidth, height: options.canvas.clientHeight }),
    touch: () => matchMedia('(pointer: coarse)').matches,
    ...(options.sound ? { sound: options.sound } : {}), ...(options.ui ? { ui: options.ui } : {}), ...(options.portrait ? { portrait: options.portrait } : {}) });
  const abort = new AbortController();
  const input = bindFishingInput(options.canvas, controller, { armed: () => !!controller.state().rod, nearRack: () => true, hud: options.hud, signal: abort.signal });
  options.attach?.(controller);
  controller.sync(); other.sync();
  if (options.query.get('rod') !== '0') { controller.take(); other.take(); }
  // The other fisher is staged by the same fair player, so its line, bite and catch are real rules too.
  let view: 'shoulder' | 'first' | 'side' | 'shore' = (options.query.get('camera') as 'shoulder' | 'first' | 'side' | 'shore' | null) ?? 'shoulder';
  const player = (who: FishingController, since: { at: number; phase: string }) => {
    const state = who.state(), cast = state.cast, phase = cast?.phase ?? (state.input === 'drawing' ? 'drawing-local' : 'idle');
    if (phase !== since.phase) { since.phase = phase; since.at = clock; }
    const age = clock - since.at;
    if (!state.rod || state.pendingCastId) return;
    if (phase === 'idle' && age > 2200) who.press();
    else if ((phase === 'drawing' || phase === 'drawing-local') && age > 900) who.release();
    else if (phase === 'bite' && age > 260) who.press();
    else if (phase === 'fighting') { const fight = cast?.fight; if (fight && (fight.phase === 'run' || fight.tension > 6500)) who.release(); else who.press(); }
  };
  const notes: string[] = [];
  controller.subscribe(event => { if (event.kind === 'note') notes.push(event.message); if (notes.length > 6) notes.shift(); });
  const mine = { at: 0, phase: '' }, theirs = { at: 0, phase: '' };
  const eye = new THREE.Vector3(), look = new THREE.Vector3();
  const head = local(0, site.walk + 2);
  let tick = 0, stepped = 0;
  const opened = clock;
  return {
    controller, layer,
    seconds: () => (clock - opened) / 1000,
    frame() {
      const real = performance.now(), dt = Math.min(100, real - last); last = real;
      if (!paused) clock += dt;
      player(other, theirs);
      if (auto) player(controller, mine);
      if (++tick % 10 === 0) input.refresh();
      const self = walkers[0]!;
      if (view === 'shoulder') {
        // Play's walking camera: a 6.5 m boom with a gentle downward look. The bench puts the person on the right third,
        // so the catch board at the head stays out of the shot (play's own boom shortens around it instead).
        const portrait = options.canvas.clientWidth < options.canvas.clientHeight, pitch = .18, boom = 6.5;
        const ahead = [Math.sin(self.yaw), Math.cos(self.yaw)], right = [-Math.cos(self.yaw), Math.sin(self.yaw)], shift = (portrait ? -.9 : -1.7) * (options.query.get('side') === 'right' ? -1 : 1);
        look.set(self.position[0] + right[0]! * shift + ahead[0]! * 1.5, self.position[1] + 1.5, self.position[2] + right[1]! * shift + ahead[1]! * 1.5);
        eye.set(look.x - ahead[0]! * boom * Math.cos(pitch), look.y + boom * Math.sin(pitch), look.z - ahead[1]! * boom * Math.cos(pitch));
        camera.fov = portrait ? 64 : 50;
      } else if (view === 'first') {
        eye.set(self.position[0], self.position[1] + 1.6, self.position[2]);
        look.set(eye.x + Math.sin(self.yaw) * 10, eye.y - 1.6, eye.z + Math.cos(self.yaw) * 10);
        camera.fov = options.canvas.clientWidth < options.canvas.clientHeight ? 70 : 62;
      } else if (view === 'side') {
        // Out over the water to one side, level with the lip: both fishers, their lines and the floats in one frame.
        const right = [Math.cos(turnYaw), -Math.sin(turnYaw)], ahead = [Math.sin(turnYaw), Math.cos(turnYaw)];
        eye.set(head[0] - right[0]! * 9 + ahead[0]! * 7.5, site.deckY + 2.4, head[2] - right[1]! * 9 + ahead[1]! * 7.5);
        look.set(head[0] + ahead[0]! * 4.5 + right[0]! * 1, site.deckY + .4, head[2] + ahead[1]! * 4.5 + right[1]! * 1);
        camera.fov = options.canvas.clientWidth < options.canvas.clientHeight ? 68 : 52;
      } else {
        eye.set(head[0] - Math.sin(turnYaw) * 30 - Math.cos(turnYaw) * 16, site.deckY + 9, head[2] - Math.cos(turnYaw) * 30 + Math.sin(turnYaw) * 16);
        look.set(head[0] + Math.sin(turnYaw) * 3, site.deckY, head[2] + Math.cos(turnYaw) * 3);
        camera.fov = 45;
      }
      camera.position.copy(eye); camera.lookAt(look); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      const hour = ((clock - Date.UTC(2026, 10, 2)) / 3_600_000) % 24;
      if (Math.abs(hour - lastGrade) > .05) { bodyMaterial.setEnvironment(getEnvironment(hour)); lastGrade = hour; }
      samples.length = 0;
      for (const walker of walkers) samples.push({ id: walker.id, look: walker.self ? 'tide' : 'hearth', position: walker.position, heading: walker.yaw, distance: 0, moving: 0,
        time: clock / 1000, lookPitch: walker.self ? -.2 : -.12, ...(walker.self && view === 'first' ? { opacity: 0 } : {}) });
      bodies.update(samples, camera, clock);
      layer.update(clock / 1000);
      options.onClock?.(clock);
    },
    debug: {
      pause(value) { paused = value; },
      async advance(ms, drawEvery = 1) {
        // Step the shared clock in server ticks so every rule and beat sees the same time, with a drawn frame every
        // `drawEvery` ticks so presented beats (the leap, the landing) are not skipped over.
        for (let left = ms; left > 0; left -= 50) {
          clock += Math.min(50, left);
          await new Promise(resolve => (++stepped % Math.max(1, drawEvery) === 0 ? requestAnimationFrame(() => setTimeout(resolve, 0)) : setTimeout(resolve, 0)));
        }
      },
      auto(on) { auto = on; },
      mood(value) { moodOverride = value; },
      press: () => controller.press(), release: () => controller.release(), take: () => controller.take(),
      camera(value) { view = value; },
      state: () => { const state = controller.state(); return { rod: !!state.rod, cast: state.cast?.phase ?? null, input: state.input, pending: state.pendingCastId, other: other.state().cast?.phase ?? null, mood: mood(), ready: state.ready, busy: state.busy, notes: [...notes] }; },
      stats: () => layer.stats(),
      fight: () => controller.state().cast?.fight ?? null,
    },
    dispose() { abort.abort(); input.dispose(); layer.dispose(); bodies.dispose(); bodyMaterial.dispose(); controller.dispose(); other.dispose(); staged.dispose(); },
  };
}
