import * as THREE from 'three';
import { kingdomAudioHost, type KingdomAudio } from '@chatdom/audio';
import { MATERIALS } from '@chatdom/content/materials';
import { createVoxelMaterial, getEnvironment, type VoxelRenderState } from '@chatdom/render';
import type { RealmFoundedScene } from '@chatdom/world';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { findClearing, FLAME_BASE, toWorld } from './clearing';
import { listenForChat, mountCampfireEffects, type CampfireEffects } from './effects';
import { bindFireHand, type FireHand } from './input';
import { windowKeys } from './keys';
import { createCampfireSession, type CampfireRoomPort, type CampfireSession } from './session';
import { createCampfireSound, type CampfireSound } from './sound';
import '@chatdom/ui/kit.css';
import './campfire.css';

/*
 * The fire in a kingdom walk. Play mounts this for every walk (its walk feature slot, `register.ts`); it finds the
 * installed clearing in the walk's own founded scene and adds what moves and glows there: the flame, the embers, a
 * lantern by each playing seat, the Gallery's embers and Twitch chat rising as lanterns in the dark. The logs, the
 * hearth and the Magistrate's chair are founded geometry the kingdom already draws and collides with.
 *
 * The round comes from the same kingdom room the walk moves in (`campfire` frames, your own `campfire.self`). Its
 * carved HUD shows while you sit at the fire, or stand near it while a round is played; walking elsewhere, the
 * fire says nothing. Sitting frees the cursor so names can be tapped, and the keys round the circle work too.
 */

/** What the fire needs of a walk: the structural part of play's `WalkFeatureContext`. */
export interface CampfireWalk {
  readonly kingdomId: string;
  readonly self: unknown;
  readonly mode: 'walking' | 'watching' | 'stream';
  readonly room: CampfireRoomPort;
  readonly scene: THREE.Object3D;
  readonly camera: THREE.Camera;
  /** Your predicted feet, or null while not placed. */
  pose(): { readonly position: readonly [number, number, number] } | null;
  hour(): number;
  readonly founded?: RealmFoundedScene;
  /** A pointer-transparent layer over the world, under play's HUD pieces. */
  readonly overlay: HTMLElement;
  audio(): KingdomAudio | null;
  /** Free the cursor from pointer lock while you sit (names are tapped). */
  requestCursor(reason: string): { release(): void };
  onFrame(listener: (dt: number, now: number) => void): () => void;
}

/** Standing this close to the hearth while a round runs shows it; beyond it the fire keeps quiet. */
export const WATCH_RADIUS = 9;

export interface CampfireWalkOptions {
  /** The shared voxel pool for the lantern bodies; one small pool of its own by default. */
  readonly voxels?: { readonly pool: VoxelWorkerPool; readonly material: VoxelRenderState };
  /** Mounts the carved HUD into its layer (`walk-hud.tsx`); returns its unmount. */
  readonly mountHud: (host: HTMLElement, session: CampfireSession, hand: () => FireHand | null) => () => void;
  readonly clock?: () => number;
}

export function mountCampfireWalk(walk: CampfireWalk, options: CampfireWalkOptions): () => void {
  const founded = walk.founded;
  if (!founded || founded.kingdomId !== walk.kingdomId) return () => {};
  const frame = findClearing(founded);
  if (!frame) return () => {};

  const disposers: (() => void)[] = [];
  let disposed = false;
  try {
    // The lantern bodies are voxels lit by the hour like every other build-lattice piece.
    let voxels = options.voxels;
    if (!voxels) {
      const pool = new VoxelWorkerPool({ size: 1 }), material = createVoxelMaterial(MATERIALS, 'build');
      disposers.push(() => { pool.dispose(); material.dispose(); });
      voxels = { pool, material };
    }
    const voxelState = voxels;
    let graded = -1;
    const grade = (hour: number) => {
      const rounded = Math.round(hour * 20) / 20;
      if (rounded === graded) return;
      graded = rounded; voxelState.material.setEnvironment(getEnvironment(hour));
    };
    grade(walk.hour());

    const effects: CampfireEffects = mountCampfireEffects({ parent: walk.scene, frame, voxels: { pool: voxelState.pool, material: voxelState.material.material },
      chat: { kingdomId: () => walk.kingdomId, origin: () => founded.origin }, ...(options.clock ? { clock: options.clock } : {}) });
    disposers.push(() => effects.dispose());
    void effects.ready.catch(error => console.error('The campfire lanterns could not be built', error));
    disposers.push(listenForChat(walk.room, effects));

    // A walker's own view is private; a watcher or the stream view never reads a card.
    const session = createCampfireSession(walk.room, { private: walk.mode === 'walking' && !!walk.self, ...(options.clock ? { clock: options.clock } : {}) });
    disposers.push(() => session.dispose());

    const hearth = toWorld(frame, FLAME_BASE);
    const sound: CampfireSound = createCampfireSound(() => {
      const audio = walk.audio();
      if (!audio) return null;
      const { status, settings } = audio.getState();
      return status === 'ready' && !settings.muted && settings.volume > 0 && !document.hidden ? kingdomAudioHost(audio) : null;
    }, { fire: hearth });
    disposers.push(() => sound.dispose());

    // Chat words beside their lanterns, one reusable element each.
    const words = document.createElement('div');
    words.className = 'campfire-words cd-kit';
    walk.overlay.append(words);
    disposers.push(() => words.remove());
    const chatEls = new Map<string, HTMLElement>();

    // The HUD: mounted only while it has something to say to you.
    const hudHost = document.createElement('div');
    hudHost.className = 'campfire-walk-hud';
    let hudOff: (() => void) | null = null, hand: FireHand | null = null, cursor: { release(): void } | null = null;
    const showHud = (on: boolean) => {
      if (on === !!hudOff) return;
      if (on) {
        walk.overlay.append(hudHost);
        hudOff = options.mountHud(hudHost, session, () => hand);
      } else {
        hudOff?.(); hudOff = null; hudHost.remove();
      }
    };
    const sitting = (on: boolean) => {
      if (on === !!hand) return;
      if (on) {
        cursor = walk.requestCursor('campfire');
        hand = bindFireHand(windowKeys(), () => {
          const state = session.current();
          return { choice: state.self?.choice ?? null, canAsk: !!state.self?.canAsk, canCall: !!state.self?.canCall, connected: state.connected };
        }, {
          choose: seat => void session.choose(seat).then(ok => { if (ok) sound.confirm(); }),
          ask: () => void session.ask(),
          call: () => void session.call(),
        });
      } else {
        hand?.dispose(); hand = null; cursor?.release(); cursor = null;
      }
      // The HUD binds the hand it is given when it mounts: a HUD already up remounts with the new one.
      showHud(false);
    };
    disposers.push(() => { sitting(false); showHud(false); });

    const camera = walk.camera, forward = new THREE.Vector3();
    const offFrame = walk.onFrame((_dt, now) => {
      if (disposed) return;
      const hour = walk.hour();
      grade(hour);
      const state = session.current(), self = state.self, court = state.frame?.court ?? null;
      const seated = !!self && self.seat !== null;
      const feet = walk.pose()?.position ?? null;
      const near = !!feet && Math.hypot(feet[0] - hearth[0], feet[2] - hearth[2]) <= WATCH_RADIUS;
      sitting(seated && walk.mode === 'walking');
      showHud(seated || (near && !!court));
      hand?.frame();
      const focus = hand?.focus() ?? null;
      effects.update({ time: now / 1000, now: Date.now(), hour, frame: state.frame,
        focus: typeof focus === 'number' ? focus : null, chosen: self?.choice?.chosen ?? null });
      if (feet) {
        camera.getWorldDirection(forward);
        sound.update(state.frame, { now, hour, listener: { feet: [feet[0], feet[1], feet[2]], forward: [forward.x, forward.y, forward.z] } });
      } else sound.quiet();

      // Words beside each chat lantern, in the overlay's own pixels.
      const width = walk.overlay.clientWidth, height = walk.overlay.clientHeight;
      const seen = new Set<string>();
      if (width && height) for (const label of effects.chatLabels(camera, width, height)) {
        if (!label.visible || label.glow < .05) continue;
        seen.add(label.id);
        let el = chatEls.get(label.id);
        if (!el) { el = document.createElement('p'); el.className = 'campfire-chat'; el.textContent = label.words; words.append(el); chatEls.set(label.id, el); }
        el.style.transform = `translate(${Math.round(label.x + 10)}px, ${Math.round(label.y - 8)}px)`;
        el.style.opacity = String(Math.min(1, label.glow * 1.2));
      }
      for (const [id, el] of chatEls) if (!seen.has(id)) { el.remove(); chatEls.delete(id); }
    });
    disposers.push(offFrame);
  } catch (error) {
    for (const off of disposers.reverse()) { try { off(); } catch { /* already failing */ } }
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    for (const off of disposers.reverse()) {
      try { off(); } catch (error) { console.error('The campfire failed to leave the walk', error); }
    }
  };
}
