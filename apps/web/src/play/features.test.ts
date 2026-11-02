import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalkFeatures, type WalkFeatureWorld } from './features';
import { registerWalkFeature, type PlayContext, type WalkFeatureContext } from './slots';
import type { PlayWorld } from './tools';

// The runtime only needs a div it can append and remove; the play tests run without a DOM.
interface FakeNode { className: string; attrs: Record<string, string>; children: FakeNode[]; parent: FakeNode | null;
  setAttribute(name: string, value: string): void; appendChild(child: FakeNode): FakeNode; remove(): void }
const node = (): FakeNode => ({
  className: '', attrs: {}, children: [], parent: null,
  setAttribute(name, value) { this.attrs[name] = value; },
  appendChild(child) { child.parent = this; this.children.push(child); return child; },
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; },
});
const realDocument = globalThis.document;
beforeEach(() => { (globalThis as { document?: unknown }).document = { createElement: () => node() }; });
afterEach(() => { (globalThis as { document?: unknown }).document = realDocument; vi.restoreAllMocks(); });

const ctx = { kingdomId: '1', self: null, live: true, mode: 'walk', settings: {},
  requestCursor: vi.fn(), closeLedger: vi.fn(), requestInput: vi.fn(), hideSelf: vi.fn() } as unknown as PlayContext;
const room = { id: 'room' }, scene = { id: 'scene' }, camera = { id: 'camera' };
const world = { room, scene, camera, pose: () => null, hand: () => null, holdPose: vi.fn(), now: () => 0, interactionFocused: () => false } as unknown as PlayWorld;

function harness(placed = true) {
  const host = node();
  let self: string | null = placed ? 'me' : null;
  const audio = { id: 'mixer' };
  const facts: WalkFeatureWorld = {
    selfWalkerId: () => self,
    walkers: () => [{ id: 'me', position: [1, 2, 3], yaw: .5, self: true, name: 'Wren' }],
    hour: () => 21, kingdomName: 'Lanternmere', audio: () => audio as never,
    overlayHost: host as unknown as HTMLElement,
  };
  const runtime = createWalkFeatures(ctx, world, facts);
  return { runtime, host, audio, place: () => { self = 'me'; } };
}

describe('the walk features', () => {
  it('mount only once the room has placed you, under an overlay of their own', () => {
    const mount = vi.fn(() => () => {});
    const off = registerWalkFeature({ id: 'pier', mount });
    const { runtime, host, place } = harness(false);
    expect(host.children.map(c => c.className)).toEqual(['pl-features']);
    expect(host.children[0]!.attrs['aria-hidden']).toBe('true');
    runtime.frame(.016, 1);
    expect(mount).not.toHaveBeenCalled();
    place(); runtime.frame(.016, 2);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(runtime.mounted).toEqual(['pier']);
    runtime.frame(.016, 3);
    expect(mount).toHaveBeenCalledTimes(1);
    runtime.dispose(); off();
  });

  it('give a feature the walk, the room, the hour, the kingdom, the mixer and the overlay', () => {
    let seen: WalkFeatureContext | null = null;
    const off = registerWalkFeature({ id: 'pier', mount: c => { seen = c; return () => {}; } });
    const { runtime, host, audio } = harness();
    runtime.frame(.016, 1);
    const c = seen as unknown as WalkFeatureContext;
    expect(c.room).toBe(room); expect(c.scene).toBe(scene); expect(c.camera).toBe(camera);
    expect(c.selfWalkerId()).toBe('me');
    expect(c.walkers()).toEqual([{ id: 'me', position: [1, 2, 3], yaw: .5, self: true, name: 'Wren' }]);
    expect(c.hour()).toBe(21); expect(c.kingdomName).toBe('Lanternmere'); expect(c.audio()).toBe(audio);
    expect(c.overlay).toBe(host.children[0]);
    expect(c.kingdomId).toBe('1'); expect(c.mode).toBe('walk');
    expect('holdPose' in c).toBe(false);
    runtime.dispose(); off();
  });

  it('mount a feature registered while you walk on the next frame, and dispose one unregistered', () => {
    const { runtime } = harness();
    runtime.frame(.016, 1);
    const left = vi.fn();
    const off = registerWalkFeature({ id: 'late', mount: () => left });
    expect(runtime.mounted).toEqual([]);
    runtime.frame(.016, 2);
    expect(runtime.mounted).toEqual(['late']);
    off(); runtime.frame(.016, 3);
    expect(left).toHaveBeenCalledTimes(1);
    expect(runtime.mounted).toEqual([]);
    runtime.dispose();
  });

  it('hand frames to the listeners of mounted features only, and stop at dispose', () => {
    const heard: [number, number][] = [];
    let c: WalkFeatureContext | null = null;
    const off = registerWalkFeature({ id: 'pier', mount: x => { c = x; x.onFrame((dt, now) => heard.push([dt, now])); return () => {}; } });
    const { runtime } = harness();
    runtime.frame(.02, 10); runtime.frame(.03, 11);
    expect(heard).toEqual([[.02, 10], [.03, 11]]);
    runtime.dispose();
    runtime.frame(.04, 12);
    expect(heard).toHaveLength(2);
    (c as unknown as WalkFeatureContext).onFrame(() => heard.push([0, 0]))();
    runtime.frame(.04, 13);
    expect(heard).toHaveLength(2);
    off();
  });

  it('leave out a feature that throws, and keep the others and the walk going', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const offBroken = registerWalkFeature({ id: 'a-broken', mount: () => { throw new Error('no pier here'); } });
    const offNothing = registerWalkFeature({ id: 'b-nothing', mount: () => undefined as never });
    const tick = vi.fn(() => { throw new Error('bad frame'); }), good = vi.fn();
    const offLoud = registerWalkFeature({ id: 'c-loud', mount: c => { c.onFrame(tick); return () => {}; } });
    const offGood = registerWalkFeature({ id: 'd-good', mount: c => { c.onFrame(good); return () => {}; } });
    const { runtime } = harness();
    runtime.frame(.016, 1);
    expect(runtime.mounted).toEqual(['c-loud', 'd-good']);
    expect(good).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(3);
    runtime.frame(.016, 2);
    expect(good).toHaveBeenCalledTimes(2);
    runtime.dispose(); offBroken(); offNothing(); offLoud(); offGood();
  });

  it('dispose every feature in reverse order and take the overlay away', () => {
    const order: string[] = [];
    const offA = registerWalkFeature({ id: 'a', mount: () => () => order.push('a') });
    const offB = registerWalkFeature({ id: 'b', mount: () => () => order.push('b') });
    const { runtime, host } = harness();
    runtime.frame(.016, 1);
    runtime.dispose(); runtime.dispose();
    expect(order).toEqual(['b', 'a']);
    expect(host.children).toEqual([]);
    expect(runtime.mounted).toEqual([]);
    offA(); offB();
  });
});
