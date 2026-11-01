import { KingdomIdSchema } from '@chatdom/shared';
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { DockAct } from './dock-acts';
import { createDockVisuals } from './dock-visuals';

const act: DockAct = { version: 1, id: 'event:1', actionId: 'act:1', kingdomId: KingdomIdSchema.parse('123'), origin: 'live', kind: 'fire-light', occurredAt: 100, expiresAt: 10000, gate: 'open', fire: 'lit' };

it('stages a real fire at the installed plaza and waits for the beat before witnessing', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), target = new THREE.Vector3();
  const visuals = createDockVisuals({ scene, camera, target, gate: [0, 0, 0], gateBraziers: [[1, 0, 0]], plaza: [10, 0, 4], citizen: () => undefined, setHour: vi.fn(), hour: () => 19, gateFlame: vi.fn() });
  expect(visuals.begin(act)).toBe(true);
  expect(visuals.frame(act, 100)).toBe(false);
  expect(visuals.frame(act, 1500)).toBe(true);
  expect(visuals.sources()[0]?.position).toEqual([10, .6, 4]);
  expect(visuals.crowd()?.point).toEqual([10, 0, 4]);
  expect(target.x).toBe(10);
  visuals.end(act); expect(visuals.sources()).toHaveLength(1);
  visuals.dispose(); expect(scene.children).toHaveLength(0);
});

it('refuses to stage an unknown person or an unearned moment', () => {
  const visuals = createDockVisuals({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), target: new THREE.Vector3(), gate: null, gateBraziers: [], plaza: [0, 0, 0], citizen: () => undefined, setHour: vi.fn(), hour: () => 19, gateFlame: vi.fn() });
  expect(visuals.begin({ ...act, kind: 'citizen-crown', targetId: 'person', targetSlot: 2 })).toBe(false);
  expect(visuals.begin({ ...act, kind: 'moment-play', targetId: 'dragon' })).toBe(false);
  expect(visuals.begin({ ...act, kind: 'raid-welcome', targetId: 'raid' })).toBe(false);
  visuals.dispose();
});

it('presents a directed gate undo and refuses an undo whose original citizen vanished', () => {
  const gateFlame = vi.fn();
  const visuals = createDockVisuals({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), target: new THREE.Vector3(),
    gate: [2, 0, 0], gateBraziers: [[3, 0, 0]], plaza: [0, 0, 0], citizen: () => undefined, setHour: vi.fn(), hour: () => 19, gateFlame });
  const undo: DockAct = { ...act, kind: 'undo', undoOf: 'closed:1', undoSubject: { kind: 'gate-close' }, fire: 'unlit' };
  expect(visuals.begin(undo)).toBe(true);
  expect(visuals.frame(undo, 1500)).toBe(true);
  expect(gateFlame).toHaveBeenLastCalledWith(1);
  visuals.end(undo);
  expect(visuals.begin({ ...undo, undoSubject: { kind: 'citizen-crown', targetId: 'citizen:1', targetName: 'Juniper', targetSlot: 1 } })).toBe(false);
  visuals.dispose();
});

it('requires the actual witnessed incoming banner renderer before accepting a welcome', () => {
  const welcomeRaid = vi.fn(() => false);
  const visuals = createDockVisuals({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), target: new THREE.Vector3(),
    gate: [2, 0, 0], gateBraziers: [[3, 0, 0]], plaza: [0, 0, 0], citizen: () => undefined, setHour: vi.fn(), hour: () => 19, gateFlame: vi.fn(), welcomeRaid });
  const welcome: DockAct = { ...act, kind: 'raid-welcome', targetId: 'raid:1', targetName: 'Mossbrook',
    raid: { raidKey: 'raid:1', from: { kingdomId: KingdomIdSchema.parse('456'), displayName: 'Mossbrook', crestKey: null }, viewers: 3, founded: false } };
  expect(visuals.begin(welcome)).toBe(false);
  welcomeRaid.mockReturnValue(true);
  expect(visuals.begin(welcome)).toBe(true);
  expect(visuals.frame(welcome, 1500)).toBe(true);
  expect(welcomeRaid).toHaveBeenLastCalledWith(welcome, 1500);
  visuals.dispose();
});
