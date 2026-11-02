import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRaidChatLanternLayer, RAID_CHAT_LANTERN_LIMIT, raidChatLanternBlueprints, type RaidChatLantern } from './raid-chat-lantern';

const item = (id: string): RaidChatLantern => ({ id, sourceKingdomId: '129634568', position: [3, 2, 1], yaw: Math.PI / 2 });

describe('chatting raider lanterns', () => {
  it('prepares palette-locked build-lattice parts for every Atlas colour', () => {
    const parts = raidChatLanternBlueprints('hearth');
    expect(parts).toHaveLength(5);
    expect(new Set(parts.map(p => p.id)).size).toBe(5);
    expect(parts.every(p => p.lattice === 'build' && p.size.join(',') === '5,9,5')).toBe(true);
  });

  it('bounds instances, deduplicates identities, follows the supplied position and clears', () => {
    const root = new THREE.Group();
    const source = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const layer = createRaidChatLanternLayer(root, { kit: 'hearth', material, mesh: () => new THREE.Mesh(source, material) });
    layer.apply([item('a'), item('a'), { ...item('invalid'), sourceKingdomId: 'not-a-channel' }, ...Array.from({ length: 100 }, (_, i) => item(String(i)))]);
    expect(layer.stats().lanterns).toBe(RAID_CHAT_LANTERN_LIMIT);
    const light = root.getObjectByName('raid-chat-lantern-light') as THREE.InstancedMesh;
    expect(light.count).toBe(RAID_CHAT_LANTERN_LIMIT);
    const matrix = new THREE.Matrix4();
    light.getMatrixAt(0, matrix);
    const point = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(point.toArray()).toEqual([3, 2.5, 1]);
    layer.apply([item('a'), item('a')]);
    expect(layer.stats().lanterns).toBe(1);
    layer.clear();
    expect(light.count).toBe(0);
    expect(light.visible).toBe(false);
    layer.dispose();
    expect(root.children).toHaveLength(0);
    source.dispose(); material.dispose();
  });
});

import { RaidChatCueSchema, RaidChatLightSchema } from '@chatdom/shared';
import { createRaidLayer } from './raid-view';
import { raidScaleProfile, type RaidFrame } from './raid-beat';
import { createTwitchMomentView } from './view';

it('draws speech only on its exact current caravan and expires it on the advancing clock', () => {
  const raidId = `raid.${'a'.repeat(64)}`;
  const cue = RaidChatCueSchema.parse({ version: 1, id: `raid-chat.${'b'.repeat(64)}`, lightId: `raid-light.${'c'.repeat(64)}`,
    kingdomId: '201', origin: 'live', asOf: 1000, expiresAt: 9000,
    raid: { raidId, fromKingdomId: '129634568', fromName: 'Source' }, parts: [{ kind: 'text', text: 'Hello' }] });
  const root = new THREE.Group(), source = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const layer = createRaidLayer(root, { kit: 'hearth', material, mesh: () => new THREE.Mesh(source, material),
    place: () => ({ position: [0, 0, 0], facing: [1, 0, 0] }),
    route: () => ({ inbound: [[0, 0, 0], [100, 0, 0]], outbound: [] }) });
  const frame: RaidFrame = { id: 'beat', key: raidId, t: 6000, from: { kingdomId: '129634568', name: 'Source' }, founded: true,
    viewers: 3, units: 1, timing: raidScaleProfile(3), seed: 3, hold: 14000, sleep: 18000 };
  const light = RaidChatLightSchema.parse({ lightId: cue.lightId, kingdomId: cue.kingdomId, origin: cue.origin, asOf: 1000, expiresAt: 20000, raid: cue.raid });
  layer.chat([cue, cue], [light]);
  layer.apply([{ ...frame, key: `raid.${'d'.repeat(64)}` }], 6000);
  expect(layer.stats().chatLanterns).toBe(0);
  layer.apply([{ ...frame, from: { ...frame.from, kingdomId: '111' } }], 6000);
  expect(layer.chatAnchors()).toHaveLength(0);
  layer.apply([frame], 6000);
  expect(layer.stats().chatLanterns).toBe(1);
  expect(layer.chatAnchors().map(a => a.cue.id)).toEqual([cue.id]);
  const first = layer.chatAnchors()[0]!.position;
  layer.apply([{ ...frame, t: 7000 }], 7000);
  const second = layer.chatAnchors()[0]!.position;
  expect(second.x).toBeGreaterThan(first.x);
  expect(second.z).toBeCloseTo(first.z);
  layer.apply([frame], 9000);
  expect(layer.stats().chatLanterns).toBe(1);
  expect(layer.chatAnchors()).toHaveLength(0);
  layer.chat([], [light]); layer.apply([frame], 10000);
  expect(layer.stats().chatLanterns).toBe(1);
  expect(layer.chatAnchors()).toHaveLength(0);
  layer.apply([frame], 20000);
  expect(layer.stats().chatLanterns).toBe(0);
  layer.chat([cue], [light]); layer.apply([], 6000);
  expect(layer.chatAnchors()).toHaveLength(0);
  layer.dispose(); source.dispose(); material.dispose();
});


it('releases registered feed and overlay listeners once on disposal', () => {
  const material = new THREE.MeshBasicMaterial();
  const view = createTwitchMomentView({ parent: new THREE.Group(), material, kit: 'hearth',
    mesh: async () => new THREE.BoxGeometry(), homeAnchor: () => null, sound: null, camera: null,
    viewport: () => ({ width: 390, height: 844 }) });
  const calls: string[] = [];
  view.onDispose(() => calls.push('feed'));
  const remove = view.onDispose(() => calls.push('removed'));
  remove();
  view.onDispose(() => calls.push('overlay'));
  view.dispose(); view.dispose();
  view.onDispose(() => calls.push('late'));
  expect(calls).toEqual(['feed', 'overlay', 'late']);
  material.dispose();
});

it('uses free wagon fixtures for colliding authors and retains their slots until retracted', () => {
  const raidId = `raid.${'a'.repeat(64)}`, raid = { raidId, fromKingdomId: '129634568', fromName: 'Source' };
  const light = (c: string) => RaidChatLightSchema.parse({ lightId: `raid-light.${c.repeat(64)}`, kingdomId: '201', origin: 'live',
    asOf: 1000, expiresAt: 20000, raid });
  const cue = (c: string) => RaidChatCueSchema.parse({ version: 1, id: `raid-chat.${c.repeat(64)}`, lightId: `raid-light.${c.repeat(64)}`,
    kingdomId: '201', origin: 'live', asOf: 1000, expiresAt: 9000, raid, parts: [{ kind: 'text', text: 'Hello' }] });
  const root = new THREE.Group(), source = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const layer = createRaidLayer(root, { kit: 'hearth', material, mesh: () => new THREE.Mesh(source, material),
    place: () => ({ position: [0, 0, 0], facing: [1, 0, 0] }),
    route: () => ({ inbound: [[0, 0, 0], [100, 0, 0]], outbound: [] }) });
  const frame: RaidFrame = { id: 'beat', key: raidId, t: 6000, from: { kingdomId: '129634568', name: 'Source' }, founded: true,
    viewers: 3, units: 1, timing: raidScaleProfile(3), seed: 3, hold: 14000, sleep: 18000 };
  layer.chat([cue('c')], [light('c')]); layer.apply([frame], 6000);
  const original = layer.chatAnchors()[0]!.position.clone();
  layer.chat(['a', 'b', 'c'].map(cue), ['a', 'b', 'c'].map(light)); layer.apply([frame], 6000);
  expect(layer.stats().chatLanterns).toBe(3);
  const anchors = layer.chatAnchors();
  expect(new Set(anchors.map(a => a.position.toArray().join(','))).size).toBe(3);
  expect(anchors.find(a => a.cue.lightId === light('c').lightId)!.position.toArray()).toEqual(original.toArray());
  layer.chat([cue('c')], [light('c')]); layer.apply([frame], 6000);
  expect(layer.chatAnchors()[0]!.position.toArray()).toEqual(original.toArray());
  layer.apply([frame], 20000);
  expect(layer.stats().chatLanterns).toBe(0);
  layer.dispose(); source.dispose(); material.dispose();
});
