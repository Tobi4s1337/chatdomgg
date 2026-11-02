import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RaidChatCueSchema, RaidChatLightSchema, type RaidChatCue, type RaidChatLight } from '@chatdom/shared';
import { createRaidLayer } from './raid-view';
import { raidScaleProfile, type RaidFrame } from './raid-beat';

const now = 480_000;
const raid = { raidId: `raid.${'a'.repeat(64)}`, fromKingdomId: '129634568', fromName: 'Source' };
function chatter(char: string, source = raid) {
  const light = RaidChatLightSchema.parse({ lightId: `raid-light.${char.repeat(64)}`, kingdomId: '201', origin: 'live',
    asOf: now, expiresAt: now + 90_000, raid: source });
  const cue = RaidChatCueSchema.parse({ version: 1, id: `raid-chat.${char.repeat(64)}`, lightId: light.lightId,
    kingdomId: light.kingdomId, origin: light.origin, asOf: now, expiresAt: now + 10_000, raid: source,
    parts: [{ kind: 'text', text: `Hello ${char}` }] });
  return { cue, light };
}
function fixture(ground?: (x: number, z: number) => number | null) {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const layer = createRaidLayer(root, { kit: 'hearth', material, mesh: () => new THREE.Mesh(geometry, material),
    place: () => ({ position: [0, 0, 0], facing: [1, 0, 0] }),
    route: () => ({ inbound: [[0, 0, 0], [100, 0, 0]], outbound: [] }), ...(ground ? { ground } : {}) });
  return { root, layer, dispose: () => { layer.dispose(); geometry.dispose(); material.dispose(); } };
}
function show(layer: ReturnType<typeof createRaidLayer>, people: { cue: RaidChatCue; light: RaidChatLight }[], at = now + 500) {
  layer.chat(people.map(p => p.cue), people.map(p => p.light)); layer.apply([], at);
}
function positions(layer: ReturnType<typeof createRaidLayer>) {
  return new Map(layer.chatAnchors().map(a => [a.cue.lightId, a.position.toArray()]));
}

describe('post-show raid chat', () => {
  it('draws a newly witnessed chatter at minute eight, grounded, and expires the original leases', () => {
    const ground = vi.fn(() => 5), f = fixture(ground), person = chatter('b');
    try {
      show(f.layer, [person]);
      expect(ground).toHaveBeenCalled();
      expect(f.layer.stats()).toMatchObject({ caravans: 0, wagons: 0, gate: 0, chatLanterns: 1, chatGateLanterns: 1 });
      expect(f.layer.chatAnchors()).toHaveLength(1);
      expect(f.layer.chatAnchors()[0]!.position.y).toBeGreaterThan(5);
      const mesh = f.root.getObjectByName('raid-chat-lantern-light') as THREE.InstancedMesh;
      expect(mesh.count).toBe(1);
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
      expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeGreaterThan(5);
      f.layer.apply([], now + 10_000);
      expect(f.layer.chatAnchors()).toHaveLength(0);
      expect(f.layer.stats().chatGateLanterns).toBe(1);
      f.layer.apply([], now + 90_000);
      expect(f.layer.stats().chatLanterns).toBe(0);
      expect(f.layer.chatAnchors()).toHaveLength(0);
    } finally { f.dispose(); }
  });

  it('keeps distinct assignments through insertion, removal, and reorder, then clears them', () => {
    const f = fixture(() => 5), a = chatter('b'), b = chatter('c'), c = chatter('d');
    try {
      show(f.layer, [a]); const original = positions(f.layer).get(a.light.lightId);
      expect(original).toBeDefined();
      show(f.layer, [c, a, b]); const all = positions(f.layer);
      expect(all.size).toBe(3);
      expect(new Set([...all.values()].map(p => p.join(','))).size).toBe(3);
      expect(all.get(a.light.lightId)).toEqual(original);
      show(f.layer, [b, a]); expect(positions(f.layer).get(a.light.lightId)).toEqual(original);
      show(f.layer, []); expect(f.layer.stats().chatLanterns).toBe(0); expect(f.layer.chatAnchors()).toEqual([]);
    } finally { f.dispose(); }
  });

  it('does not attach a different raid or source to an unrelated active wagon', () => {
    const f = fixture(() => 5), person = chatter('b');
    const frame: RaidFrame = { id: 'unrelated', key: `raid.${'f'.repeat(64)}`, t: 6000,
      from: { kingdomId: '111', name: 'Other' }, founded: true, viewers: 3, units: 1,
      timing: raidScaleProfile(3), seed: 3, hold: 14000, sleep: 18000 };
    try {
      show(f.layer, [person]); const postshow = positions(f.layer).get(person.light.lightId);
      f.layer.apply([frame], now + 500);
      expect(positions(f.layer).get(person.light.lightId)).toEqual(postshow);
      expect(f.layer.stats().chatGateLanterns).toBe(1);
      const other = chatter('b', { raidId: `raid.${'e'.repeat(64)}`, fromKingdomId: '222', fromName: 'Another' });
      show(f.layer, [other]);
      expect(f.layer.chatAnchors()[0]?.cue.raid).toEqual(other.cue.raid);
      expect(f.layer.stats().chatGateLanterns).toBe(1);
    } finally { f.dispose(); }
  });

  it.each([undefined, () => null, () => NaN, () => Infinity])('fails closed without valid ground (%s)', ground => {
    const f = fixture(ground), person = chatter('b');
    try { show(f.layer, [person]); expect(f.layer.stats().chatLanterns).toBe(0); expect(f.layer.chatAnchors()).toEqual([]); }
    finally { f.dispose(); }
  });

  it('removes post-show lights immediately when ground support is withdrawn', () => {
    const f = fixture(() => 5), person = chatter('b');
    try {
      show(f.layer, [person]); expect(f.layer.stats().chatGateLanterns).toBe(1);
      f.layer.ground(undefined); f.layer.apply([], now + 600);
      expect(f.layer.stats().chatLanterns).toBe(0); expect(f.layer.chatAnchors()).toEqual([]);
    } finally { f.dispose(); }
  });
});

it('does not acquire the raid camera or replay wagons for post-show speech', async () => {
  const { createTwitchMomentView } = await import('./view');
  const { createTwitchMoments } = await import('./controller');
  const { KingdomIdSchema } = await import('@chatdom/shared');
  const person = chatter('b'), material = new THREE.MeshBasicMaterial();
  const acquire = vi.fn(() => null);
  const view = createTwitchMomentView({ parent: new THREE.Group(), kit: 'hearth', material,
    mesh: async () => new THREE.BoxGeometry(), homeAnchor: () => null, sound: null, camera: { acquire },
    viewport: () => ({ width: 1440, height: 900 }),
    placeAnchor: () => ({ position: [0, 0, 0], facing: [1, 0, 0] }),
    giftRoute: () => ({ inbound: [[0, 0, 0], [100, 0, 0]], outbound: [] }) });
  const moments = createTwitchMoments({ kingdomId: KingdomIdSchema.parse('201'), expectedOrigin: 'live', clock: { now: () => now + 500 } });
  try {
    expect(moments.reset({ epoch: 'test', asOf: now, throughSeq: 0, current: [] })).toEqual({ accepted: true });
    await view.prepare(); view.setRaidChatGround(() => 5);
    view.receiveRaidChat({ version: 1, kingdomId: KingdomIdSchema.parse('201'), origin: 'live', asOf: now + 500,
      lights: [person.light], cues: [person.cue] });
    const frame = moments.sample(now + 500);
    expect(frame.raids).toEqual([]); expect(frame.focus).toBeNull();
    view.apply(frame);
    expect(view.stats()).toMatchObject({ 'raid.caravans': 0, 'raid.wagons': 0, 'raid.gate': 0, 'raid.chatLanterns': 1 });
    expect(acquire).not.toHaveBeenCalled();
  } finally { view.dispose(); material.dispose(); }
});

it('reclaims stand assignments across more than 32 successive retractions', () => {
  const f = fixture(() => 5);
  try {
    for (let i = 0; i < 40; i++) {
      const seed = chatter('b'), hex = i.toString(16).padStart(64, '0');
      const light = RaidChatLightSchema.parse({ ...seed.light, lightId: `raid-light.${hex}` });
      const cue = RaidChatCueSchema.parse({ ...seed.cue, id: `raid-chat.${hex}`, lightId: light.lightId });
      show(f.layer, [{ light, cue }]);
      expect(f.layer.stats().chatGateLanterns, `author ${i}`).toBe(1);
      expect(f.layer.chatAnchors(), `author ${i}`).toHaveLength(1);
      show(f.layer, []);
    }
  } finally { f.dispose(); }
});

it('probes another fixture when a candidate has no supported ground', () => {
  let samples = 0;
  const f = fixture(() => ++samples === 1 ? null : 5);
  try {
    show(f.layer, [chatter('b')]);
    expect(samples).toBeGreaterThan(1);
    expect(f.layer.stats().chatGateLanterns).toBe(1);
    expect(f.layer.chatAnchors()).toHaveLength(1);
  } finally { f.dispose(); }
});

it('does not rebuild raid banners for stationary lights from many sources', async () => {
  const art = await import('./raid-art');
  const banners = vi.spyOn(art, 'bannerRuns');
  const f = fixture(() => 5);
  try {
    const people = '012345678'.split('').map((char, index) => chatter(char, {
      raidId: `raid.${char.repeat(64)}`, fromKingdomId: String(1000 + index), fromName: `Source ${index}`,
    }));
    show(f.layer, people);
    expect(f.layer.stats().chatGateLanterns).toBe(9);
    f.layer.apply([], now + 600); f.layer.apply([], now + 700);
    expect(banners).not.toHaveBeenCalled();
  } finally { f.dispose(); banners.mockRestore(); }
});

it('fades a visible wagon light into its stationary place without extending its lease', () => {
  const f = fixture(() => 5), person = chatter('b');
  const frame: RaidFrame = { id: 'beat', key: raid.raidId, t: 6000,
    from: { kingdomId: raid.fromKingdomId, name: raid.fromName }, founded: true, viewers: 3, units: 1,
    timing: raidScaleProfile(3), seed: 3, hold: 14000, sleep: 18000 };
  try {
    f.layer.chat([person.cue], [person.light]); f.layer.apply([frame], now + 500);
    expect(f.layer.stats().wagons).toBe(1);
    expect(f.layer.stats().chatLanterns).toBe(1);
    expect(f.layer.stats().chatGateLanterns).toBe(0);
    f.layer.apply([], now + 600);
    expect(f.layer.stats().chatGateLanterns).toBe(0);
    expect(f.layer.chatAnchors()).toHaveLength(0);
    f.layer.apply([], now + 775);
    expect(f.layer.stats().chatGateLanterns).toBe(1);
    expect(f.layer.chatAnchors()[0]!.opacity).toBeCloseTo(0.5, 2);
    f.layer.apply([], now + 950);
    expect(f.layer.chatAnchors()[0]!.opacity).toBeCloseTo(1, 2);
    f.layer.apply([], now + 90_000);
    expect(f.layer.stats().chatLanterns).toBe(0);
  } finally { f.dispose(); }
});

it('fades a newly arriving post-show light from its own timestamp without a caravan', () => {
  const f = fixture(() => 5), person = chatter('b');
  try {
    f.layer.chat([person.cue], [person.light]); f.layer.apply([], now);
    expect(f.layer.stats().chatGateLanterns).toBe(0);
    f.layer.apply([], now + 175);
    expect(f.layer.stats().chatGateLanterns).toBe(1);
    expect(f.layer.chatAnchors()[0]!.opacity).toBeCloseTo(0.5, 2);
    f.layer.apply([], now + 350);
    expect(f.layer.chatAnchors()[0]!.opacity).toBeCloseTo(1, 2);
  } finally { f.dispose(); }
});

it('keeps 32 distinct fixtures stable at capacity and gives a retracted slot to the waiting light', () => {
  const f = fixture(() => 5), seed = chatter('b');
  const people = Array.from({ length: 33 }, (_, i) => {
    const hex = i.toString(16).padStart(64, '0');
    const light = RaidChatLightSchema.parse({ ...seed.light, lightId: `raid-light.${hex}` });
    const cue = RaidChatCueSchema.parse({ ...seed.cue, id: `raid-chat.${hex}`, lightId: light.lightId });
    return { light, cue };
  });
  try {
    show(f.layer, people);
    expect(f.layer.stats().chatGateLanterns).toBe(32);
    const first = positions(f.layer);
    expect(first.size).toBe(32);
    expect(new Set([...first.values()].map(p => p.join(','))).size).toBe(32);
    const waiting = people.find(p => !first.has(p.light.lightId));
    expect(waiting).toBeDefined();
    show(f.layer, [...people].reverse());
    expect(positions(f.layer)).toEqual(first);
    const removedId = first.keys().next().value!;
    const freed = first.get(removedId);
    show(f.layer, people.filter(p => p.light.lightId !== removedId));
    const after = positions(f.layer);
    expect(after.size).toBe(32);
    for (const [id, position] of first) if (id !== removedId) expect(after.get(id)).toEqual(position);
    expect(after.get(waiting!.light.lightId)).toEqual(freed);
  } finally { f.dispose(); }
});

it('bounds unsupported-ground queries per frame, retries, and fails closed on exceptions', () => {
  const ground = vi.fn((): number | null => null), f = fixture(ground), seed = chatter('b');
  const people = Array.from({ length: 32 }, (_, i) => {
    const hex = i.toString(16).padStart(64, '0');
    const light = RaidChatLightSchema.parse({ ...seed.light, lightId: `raid-light.${hex}` });
    return { light, cue: RaidChatCueSchema.parse({ ...seed.cue, id: `raid-chat.${hex}`, lightId: light.lightId }) };
  });
  try {
    show(f.layer, people);
    expect(f.layer.stats().chatGateLanterns).toBe(0);
    expect(f.layer.chatAnchors()).toEqual([]);
    const firstCalls = ground.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    expect(firstCalls).toBeLessThanOrEqual(128);
    f.layer.apply([], now + 600);
    const secondCalls = ground.mock.calls.length - firstCalls;
    expect(secondCalls).toBeGreaterThan(0);
    expect(secondCalls).toBeLessThanOrEqual(128);
    f.layer.ground(() => { throw new Error('ground unavailable'); });
    expect(() => f.layer.apply([], now + 700)).not.toThrow();
    expect(f.layer.stats().chatGateLanterns).toBe(0);
    expect(f.layer.chatAnchors()).toEqual([]);
  } finally { f.dispose(); }
});
