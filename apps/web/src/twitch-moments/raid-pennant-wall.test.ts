import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { RaidPennantFrameSchema, VoxelBlueprintSchema } from '@chatdom/shared';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '@chatdom/voxel';
import { createRaidPennantWall, formatRaidPennantPlaque } from './raid-pennant-wall';

const now = 1_800_000_000_000;
const frame = RaidPennantFrameSchema.parse({ version: 1, origin: 'simulated', kingdomId: '202', asOf: now,
  items: Array.from({ length: 16 }, (_, i) => ({ raidId: `raid.${i.toString(16).padStart(64, '0')}`,
    from: { kingdomId: '101', login: 'visitor', name: 'Visitor' }, occurredAt: now - i * 86400_000 })) });
function setup(kit: 'hearth' | 'tide', route = true) {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const wall = createRaidPennantWall(root, { kit, material, mesh: () => new THREE.Mesh(geometry, material),
    place: () => ({ position: [0, 0, 0], facing: [1, 0, 0] }),
    route: () => route ? { inbound: [[0, 0, 0], [100, 0, 0]], outbound: [] } : null });
  return { root, wall, cleanup: () => { wall.dispose(); geometry.dispose(); material.dispose(); } };
}

describe('raid pennant wall', () => {
  it.each(['hearth', 'tide'] as const)('meshes the %s production blueprints within asset budgets', kit => {
    const { wall, cleanup } = setup(kit);
    try {
      const materials = new Set(MATERIALS.materials.map(m => m.id));
      expect(wall.blueprints().length).toBeGreaterThan(1);
      for (const blueprint of wall.blueprints()) {
        expect(VoxelBlueprintSchema.safeParse(blueprint).success).toBe(true);
        expect(blueprint.styleId).toBe(kit);
        expect(blueprint.boxes.length).toBeLessThanOrEqual(512);
        expect(blueprint.boxes.every(box => materials.has(box.material))).toBe(true);
        const asset = rasterizeBlueprint(blueprint);
        expect(asset.voxels.filter(v => v !== 0).length).toBeGreaterThan(0);
        expect(asset.voxels.filter(v => v !== 0).length).toBeLessThanOrEqual(20_000);
        const triangles = prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)
          .reduce((n, chunk) => n + meshVoxelChunk(chunk).indices.length / 3, 0);
        expect(triangles).toBeGreaterThan(0); expect(triangles).toBeLessThanOrEqual(40_000);
      }
    } finally { cleanup(); }
  });
  it('retains up to twelve distinct visits from one channel without age expiry, and clears on hide or dispose', () => {
    const { root, wall, cleanup } = setup('hearth');
    try {
      wall.receive(frame); wall.ground(() => 0); wall.apply(now + 50 * 365 * 86400_000, true);
      expect(wall.stats().pennants).toBe(12);
      const shownRevision = wall.stats().revision!;
      wall.apply(now, false); expect(wall.stats().pennants).toBe(0);
      expect(wall.stats().revision).toBeGreaterThan(shownRevision);
      const hiddenRevision = wall.stats().revision!;
      wall.apply(now, true); expect(wall.stats().pennants).toBe(12);
      expect(wall.stats().revision).toBeGreaterThan(hiddenRevision);
      wall.receive(null); wall.apply(now, true); expect(wall.stats().pennants).toBe(0);
      wall.dispose(); expect(root.children).toHaveLength(0);
    } finally { cleanup(); }
  });
  it('keeps retained visit slots when a newer visit is inserted and clears drawn sites on hide, support loss or disposal', () => {
    const { wall, cleanup } = setup('hearth');
    try {
      const sample = () => 7;
      wall.ground(sample); wall.receive({ ...frame, items: frame.items.slice(1, 4) }); wall.apply(now, true);
      const before = new Map(wall.sites().map(site => [site.raidId, site.foot]));
      wall.receive({ ...frame, items: frame.items.slice(0, 4) }); wall.apply(now, true);
      expect(wall.sites()).toHaveLength(4);
      for (const site of wall.sites().slice(1)) expect(site.foot).toEqual(before.get(site.raidId));
      wall.apply(now, false); expect(wall.sites()).toHaveLength(0);
      wall.apply(now, true); expect(wall.sites()).toHaveLength(4);
      wall.ground(() => null); wall.apply(now, true); expect(wall.sites()).toHaveLength(0);
      wall.dispose(); expect(wall.sites()).toHaveLength(0);
    } finally { cleanup(); }
  });
  it('ignores font completion after disposal', async () => {
    let settle!: () => void;
    const fonts = new Promise<void>(resolve => { settle = resolve; });
    vi.stubGlobal('document', { fonts: { load: () => fonts } });
    const { wall, root, cleanup } = setup('hearth');
    try {
      wall.dispose(); const revision = wall.stats().revision;
      settle(); await fonts; await Promise.resolve(); await Promise.resolve();
      expect(wall.stats().revision).toBe(revision); expect(root.children).toHaveLength(0);
    } finally { cleanup(); vi.unstubAllGlobals(); }
  });
  it('uses the provider date in UTC', () => {
    expect(formatRaidPennantPlaque({ ...frame.items[0]!, occurredAt: Date.parse('2025-01-01T00:30:00+02:00') }))
      .toEqual({ name: 'Visitor', date: '31 Dec 2024' });
  });
  it('does not place a wall without ground, a route, or a valid sampled height', () => {
    const a = setup('hearth'), b = setup('hearth', false);
    try {
      a.wall.receive(frame); a.wall.apply(now, true); expect(a.wall.stats().pennants).toBe(0);
      a.wall.ground(() => NaN); a.wall.apply(now, true); expect(a.wall.stats().pennants).toBe(0);
      b.wall.receive(frame); b.wall.ground(() => 0); b.wall.apply(now, true); expect(b.wall.stats().pennants).toBe(0);
    } finally { a.cleanup(); b.cleanup(); }
  });
  it('renders each repeated source visit as a separate bay', () => {
    const { root, wall, cleanup } = setup('hearth');
    try {
      wall.receive({ ...frame, items: frame.items.slice(0, 3) }); wall.ground(() => 0); wall.apply(now, true);
      const bays = root.getObjectByName('moment-raid-pennant-bay-hearth') as THREE.InstancedMesh;
      expect(bays.count).toBe(3);
      const positions = Array.from({ length: 3 }, (_, i) => { const matrix = new THREE.Matrix4(); bays.getMatrixAt(i, matrix); return new THREE.Vector3().setFromMatrixPosition(matrix).toArray().join(','); });
      expect(new Set(positions).size).toBe(3);
    } finally { cleanup(); }
  });
  it('renders history without requesting sound or a camera lease', async () => {
    const { createTwitchMomentView } = await import('./view');
    const { createTwitchMoments } = await import('./controller');
    const material = new THREE.MeshBasicMaterial(), acquire = vi.fn(() => null), play = vi.fn(() => () => {});
    const view = createTwitchMomentView({ parent: new THREE.Group(), kit: 'hearth', material,
      mesh: async () => new THREE.BoxGeometry(), homeAnchor: () => null, sound: { play }, camera: { acquire },
      viewport: () => ({ width: 1440, height: 900 }), placeAnchor: () => ({ position: [0, 0, 0], facing: [1, 0, 0] }),
      giftRoute: () => ({ inbound: [[0, 0, 0], [100, 0, 0]], outbound: [] }) });
    const moments = createTwitchMoments({ kingdomId: frame.kingdomId, expectedOrigin: 'simulated', clock: { now: () => now } });
    try {
      expect(moments.reset({ epoch: 'test', asOf: now, throughSeq: 0, current: [] })).toEqual({ accepted: true });
      await view.prepare(); view.setRaidPennantGround(() => 5); view.receiveRaidPennants(frame); view.apply(moments.sample(now));
      expect(view.stats()['pennantWall.pennants']).toBe(12);
      expect(acquire).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
    } finally { view.dispose(); material.dispose(); }
  });

});
