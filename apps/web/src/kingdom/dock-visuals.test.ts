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
