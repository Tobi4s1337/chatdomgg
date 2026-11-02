import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CampfireFrame, DuskCourtView } from '@chatdom/shared';
import { campfireClearing } from './clearing';
import { EFFECT_DRAWS, lanternShow, mountCampfireEffects, nightAt, SNUFF_SECONDS, type CampfireEffectsInput } from './effects';

const AT = Date.UTC(2026, 10, 2, 21, 0, 0);
const court = (lanterns: Record<number, 'lit' | 'snuffed' | 'sent'> = {}, overrides: Partial<DuskCourtView> = {}): DuskCourtView => ({
  match: 'm1', revision: 1, phase: 'night', night: 1, startedAt: AT, deadline: AT + 30_000, waiting: false, wolves: 1,
  players: [1, 2, 3, 4, 5].map(seat => ({ seat, name: `P${seat}`, lantern: lanterns[seat] ?? 'lit', role: null, away: false, gone: false, embers: (seat === 3 ? 2 : 0) as 0 | 2, voted: false })),
  dawn: null, verdict: null, result: null, ...overrides });
const frame = (c: DuskCourtView | null): CampfireFrame => ({ at: AT, site: 'clearing', live: true, magistrate: null, seated: [], court: c });

function mount() {
  const scene = new THREE.Scene(), arrangement = campfireClearing();
  const effects = mountCampfireEffects({ parent: scene, frame: { origin: [10, 2, -4], turn: 1, arrangement }, chat: { kingdomId: () => '41245072', origin: () => 'live' }, clock: () => AT });
  const input: CampfireEffectsInput = { time: 0, now: AT, hour: 22, frame: null, focus: null, chosen: null };
  return { scene, effects, input };
}

const drawn = (root: THREE.Object3D) => {
  let n = 0;
  root.traverse(o => { if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) n++; });
  return n;
};

describe('the fire at the clearing', () => {
  it('is lit by day and comes into its own at night', () => {
    expect(nightAt(12)).toBe(0);
    expect(nightAt(23)).toBe(1);
    expect(nightAt(2)).toBe(1);
    expect(nightAt(19)).toBeGreaterThan(0);
    const { effects, input } = mount();
    input.hour = 12; effects.update(input);
    const day = effects.lightSources()[0]!.strength;
    input.hour = 22; effects.update(input);
    expect(effects.lightSources()[0]!.strength).toBeGreaterThan(day);
    expect(day).toBeGreaterThan(0);
    effects.dispose();
  });

  it('stays within its draw budget and adds no real light', () => {
    const { scene, effects, input } = mount();
    input.frame = frame(court()); effects.update(input);
    // Without a voxel pool the lantern body is not drawn; everything else is.
    expect(drawn(effects.group)).toBe(EFFECT_DRAWS - 1);
    let lights = 0;
    scene.traverse(o => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
    effects.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('offers warmth at the hearth and at every burning lantern, in world metres', () => {
    const { effects, input } = mount();
    input.frame = frame(court({ 2: 'snuffed' })); effects.update(input);
    const sources = effects.lightSources();
    // The hearth, plus four lit lanterns (the snuffed one shows dark from the first frame).
    expect(sources).toHaveLength(5);
    const hearth = sources[0]!;
    expect(hearth.position[0]).toBeCloseTo(10); expect(hearth.position[2]).toBeCloseTo(-4);
    for (const source of sources.slice(1)) expect(Math.hypot(source.position[0] - 10, source.position[2] + 4)).toBeLessThan(campfireClearing().radius);
    effects.dispose();
  });

  it('snuffs a lantern with a short fall of its flame, but never on the first frame seen', () => {
    const out = { level: 0, smoke: 0, tip: 0 };
    expect(lanternShow('lit', 0, 5, out).level).toBe(1);
    expect(lanternShow('snuffed', 0, SNUFF_SECONDS / 2, out).level).toBeGreaterThan(0);
    expect(lanternShow('snuffed', 0, SNUFF_SECONDS / 2, out).smoke).toBeGreaterThan(0);
    expect(lanternShow('snuffed', 0, SNUFF_SECONDS + .01, out).level).toBe(0);
    expect(lanternShow('sent', 0, 3, out).tip).toBe(1);
    expect(lanternShow('snuffed', -1e6, 0, out).level).toBe(0);

    const { effects, input } = mount();
    input.frame = frame(court()); input.time = 1; effects.update(input);
    expect(effects.lightSources()).toHaveLength(6);
    input.frame = frame(court({ 4: 'snuffed' }, { phase: 'dawn', revision: 2 })); input.time = 1.2; effects.update(input);
    // Still going out: its warmth is fading, not gone.
    expect(effects.lightSources()).toHaveLength(6);
    input.time = 1.2 + SNUFF_SECONDS + .1; effects.update(input);
    expect(effects.lightSources()).toHaveLength(5);
    effects.dispose();
  });

  it('raises chat as lanterns beyond the logs and puts its words beside them', () => {
    const { effects, input } = mount();
    effects.chat!.receive({ type: 'chat', cue: { version: 1, id: 'c1', kingdomId: '41245072', epoch: 'e1', origin: 'live', slot: 1, asOf: AT - 10, expiresAt: AT + 8_000, parts: [{ kind: 'text', text: 'it was the miller' }] } });
    input.now = AT + 1_000; input.time = 1; effects.update(input);
    const camera = new THREE.PerspectiveCamera(40, 16 / 9, .1, 200);
    camera.position.set(10, 8, 12); camera.lookAt(10, 0, -4); camera.updateMatrixWorld(true);
    const labels = effects.chatLabels(camera, 1600, 900);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ id: 'c1', words: 'it was the miller', visible: true });
    expect(effects.chatLabels(camera, 1600, 900)).toBe(labels);
    effects.dispose();
  });

  it('finds each seat’s lantern in the world for pointing at it', () => {
    const { effects } = mount();
    const at = effects.lanternAt(1, new THREE.Vector3());
    expect(at).not.toBeNull();
    expect(Math.hypot(at!.x - 10, at!.z + 4)).toBeGreaterThan(.5);
    expect(effects.lanternAt(40, new THREE.Vector3())).toBeNull();
    effects.dispose();
  });
});
