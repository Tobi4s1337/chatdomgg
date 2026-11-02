import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CAMPFIRE_MESSAGES, type CampfireFrame, type CampfireSelf, type DuskCourtView } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { VoxelRenderState } from '@chatdom/render';
import { campfireClearing, CLEARING_ID, FLAME_BASE, toWorld } from './clearing';
import type { CampfireRoomPort } from './session';
import { mountCampfireWalk, WATCH_RADIUS, type CampfireWalk } from './walk';

const AT = Date.UTC(2026, 10, 2, 21, 0, 0);
const KINGDOM = '41245072';

/** Just enough of an element for the walk's layers: no DOM in this test runner. */
class FakeElement {
  className = ''; textContent = ''; style: Record<string, string> = {}; children: FakeElement[] = []; parent: FakeElement | null = null;
  clientWidth = 1440; clientHeight = 900;
  append(...nodes: FakeElement[]) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
}
const keyListeners = new Set<unknown>();
let saved: { document?: unknown; window?: unknown } = {};
beforeEach(() => {
  const g = globalThis as { document?: unknown; window?: unknown };
  saved = { document: g.document, window: g.window };
  g.document = { createElement: () => new FakeElement(), hidden: false };
  g.window = { addEventListener: (_: string, l: unknown) => { keyListeners.add(l); }, removeEventListener: (_: string, l: unknown) => { keyListeners.delete(l); } };
});
afterEach(() => { const g = globalThis as { document?: unknown; window?: unknown }; g.document = saved.document; g.window = saved.window; });

function founded(withClearing = true): RealmFoundedScene {
  const arrangement = campfireClearing();
  return { kingdomId: KINGDOM, origin: 'simulated', layoutRevision: 1, collisionRevision: 1,
    placements: withClearing ? [{ id: CLEARING_ID, position: [20, 1, -30], rotation: 1, assetHash: 'fire' }] : [],
    assets: [{ assetHash: 'fire', blueprint: arrangement.blueprint }] } as unknown as RealmFoundedScene;
}

const court = (): DuskCourtView => ({ match: 'm1', revision: 1, phase: 'talk', night: 1, startedAt: AT, deadline: AT + 60_000, waiting: false, wolves: 1,
  players: [1, 2, 3, 4].map(seat => ({ seat, name: `Sitter ${seat}`, lantern: 'lit' as const, role: null, away: false, gone: false, embers: 0 as const, voted: false })),
  dawn: null, verdict: null, result: null });
const frame = (withCourt: boolean): CampfireFrame => ({ at: AT, site: 'clearing', live: false, magistrate: null, seated: [], court: withCourt ? court() : null });
const self = (seat: number | null): CampfireSelf => ({ seat, magistrate: false, canAsk: false, canCall: false, match: seat === null ? null : 'm1',
  role: seat === null ? null : 'wolf', wolves: [], choice: null, answers: [] });

function harness(options: { mode?: CampfireWalk['mode']; self?: unknown; founded?: RealmFoundedScene } = {}) {
  const handlers = new Map<string, Set<(message: unknown) => void>>(), sent: string[] = [];
  const room: CampfireRoomPort = {
    onMessage(type, callback) { let set = handlers.get(type); if (!set) handlers.set(type, set = new Set()); set.add(callback as (m: unknown) => void); return () => { set!.delete(callback as (m: unknown) => void); }; },
    send(type) { sent.push(type); },
  };
  const deliver = (type: string, message: unknown) => { for (const h of [...handlers.get(type) ?? []]) h(message); };
  const frames = new Set<(dt: number, now: number) => void>();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const overlay = new FakeElement();
  let feet: [number, number, number] | null = [0, 0, 0], cursors = 0, released = 0, huds = 0, hudsOff = 0;
  const walk: CampfireWalk = {
    kingdomId: KINGDOM, self: options.self === undefined ? { personId: '1', publicName: 'Mira', lookToken: 'x' } : options.self, mode: options.mode ?? 'walking',
    room, scene, camera, pose: () => feet ? { position: feet } : null, hour: () => 22,
    founded: options.founded ?? founded(), overlay: overlay as unknown as HTMLElement, audio: () => null,
    requestCursor: () => { cursors++; return { release() { released++; } }; },
    onFrame(listener) { frames.add(listener); return () => { frames.delete(listener); }; },
  };
  const voxels = { pool: { submit: () => new Promise(() => {}) } as unknown as VoxelWorkerPool,
    material: { material: new THREE.MeshBasicMaterial(), setEnvironment() {}, dispose() {} } as unknown as VoxelRenderState };
  const dispose = mountCampfireWalk(walk, { voxels, clock: () => AT, mountHud: () => { huds++; return () => { hudsOff++; }; } });
  let now = 0;
  const tick = () => { now += 16; for (const f of [...frames]) f(.016, now); };
  return { dispose, scene, overlay, sent, deliver, tick, handlers, frames,
    stand(at: [number, number, number] | null) { feet = at; },
    get cursors() { return cursors; }, get released() { return released; }, get huds() { return huds; }, get hudsOff() { return hudsOff; } };
}

const hearth = () => toWorld({ origin: [0, 0, 0], turn: 0 }, FLAME_BASE);

describe('the fire in a kingdom walk', () => {
  it('does nothing in a kingdom with no installed clearing', () => {
    const h = harness({ founded: founded(false) });
    expect(h.scene.children).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
    expect(h.frames.size).toBe(0);
    h.dispose();
  });

  it('puts the fire at the clearing, asks for the frame and leaves nothing behind', () => {
    const h = harness();
    expect(h.scene.getObjectByName('campfire.effects')).toBeTruthy();
    expect(h.sent).toEqual([CAMPFIRE_MESSAGES.hello]);
    expect(h.handlers.get('transient')?.size).toBe(1);
    h.dispose();
    expect(h.scene.children).toHaveLength(0);
    expect(h.frames.size).toBe(0);
    expect([...h.handlers.values()].every(set => set.size === 0)).toBe(true);
    expect(h.overlay.children).toHaveLength(0);
  });

  it('shows its HUD and frees the cursor only while you sit, and to a passer-by only near a round', () => {
    const h = harness(), spot = founded().placements[0]!.position;
    void hearth;
    h.stand([spot[0] + WATCH_RADIUS + 20, spot[1], spot[2]]);
    h.deliver(CAMPFIRE_MESSAGES.frame, frame(true));
    h.tick();
    expect(h.huds).toBe(0);
    // Close to the hearth while a round is played: you can follow it.
    h.stand([spot[0] + 2, spot[1], spot[2]]);
    h.tick();
    expect(h.huds).toBe(1);
    expect(h.cursors).toBe(0);
    // Sitting: your own card, the cursor for tapping names.
    h.deliver(CAMPFIRE_MESSAGES.self, self(2));
    h.tick();
    expect(h.cursors).toBe(1);
    // Remounted with the seat's hand, so the circle's focus follows your keys.
    expect(h.huds).toBe(2);
    expect(h.hudsOff).toBe(1);
    expect(keyListeners.size).toBe(2);
    // Standing up and walking away: quiet again.
    h.deliver(CAMPFIRE_MESSAGES.self, self(null));
    h.stand([spot[0] + WATCH_RADIUS + 20, spot[1], spot[2]]);
    h.tick();
    expect(h.released).toBe(1);
    expect(h.hudsOff).toBe(2);
    // The fire's keys are let go with the seat.
    expect(keyListeners.size).toBe(0);
    // No round and nobody sitting: nothing at all, even beside the fire.
    h.deliver(CAMPFIRE_MESSAGES.frame, frame(false));
    h.stand([spot[0] + 1, spot[1], spot[2]]);
    h.tick();
    expect(h.huds).toBe(2);
    h.dispose();
  });

  it('never reads a card when watching or on stream', () => {
    for (const mode of ['watching', 'stream'] as const) {
      const h = harness({ mode, self: null });
      expect(h.handlers.get(CAMPFIRE_MESSAGES.self)?.size ?? 0).toBe(0);
      h.deliver(CAMPFIRE_MESSAGES.self, self(2));
      h.tick();
      expect(h.cursors).toBe(0);
      h.dispose();
    }
  });
});
