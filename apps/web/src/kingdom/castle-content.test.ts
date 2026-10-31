import { describe, expect, it } from 'vitest';
import { createCastlePlan, type CastlePlan } from '@chatdom/world';
import { createCastleContent, createCastleCourtContent } from './castle-content';

const fixture: CastlePlan = {
  centre: [10,20,-30], bounds: { minX: -30, maxX: 50, minZ: -70, maxZ: 10 },
  modules: [
    { id: 'keep', kind: 'keep', position: [10,20,-30], rotation: 1, size: [32,31,32] },
    { id: 'gate', kind: 'gatehouse', position: [0,20,0], rotation: 0, size: [16,18,10] },
  ],
  court: { id: 'court', nodeId: 'gate-node', elevation: 20, boundary: [[0,0],[16,0],[16,10],[0,10]] },
  gateNodeId: 'gate-node', beaconModuleId: 'keep',
};

describe('placed castle content', () => {
  it('mounts welcome fires at the real gate flanks, including a rotated gate', () => {
    const court = createCastleCourtContent(createCastlePlan());
    expect(court.braziers.map(fire => fire.position)).toEqual([[-10,22,-34.5],[10,22,-34.5]]);
    const rotated = createCastleCourtContent({ ...fixture, modules: fixture.modules.map(module => module.kind === 'gatehouse' ? { ...module, rotation: 1 } : module) });
    expect(rotated.braziers.map(fire => fire.position)).toEqual([[11.5,22,2],[11.5,22,-18]]);
    expect(rotated.props.every(prop => prop.yaw === Math.PI / 2)).toBe(true);
  });
  it('installs the authoritative compound at its true scale with one real beacon', () => {
    const plan = createCastlePlan();
    const { buildings, beaconPosition } = createCastleContent(plan);
    expect(buildings).toHaveLength(12);
    expect(new Set(buildings.map(part => part.id)).size).toBe(12);
    expect(beaconPosition).toEqual([0,50.5,-66]);
    expect(plan.bounds).toEqual({ minX: -32, maxX: 32, minZ: -84, maxZ: -36 });
    for (const part of buildings) {
      const source = plan.modules.find(module => module.id === part.id)!;
      expect(part.position).toEqual(source.position);
      expect(part.blueprint.size.map(value => value * .125)).toEqual(source.size);
    }
  });
  it('resolves the actual rotated lantern anchor once and retains every physical module', () => {
    const { buildings, beaconPosition } = createCastleContent(fixture);
    expect(buildings.map(part => part.id)).toEqual(['keep','gate']);
    expect(buildings[0]!.yaw).toBe(Math.PI / 2);
    expect(buildings[0]!.position).toEqual([10,20,-30]);
    expect(beaconPosition).toEqual([24,50.5,-46]);
    expect(buildings[1]!.blueprint.size).toEqual([128,144,80]);
  });
  it('fails when the single beacon anchor or unique module identity cannot resolve', () => {
    expect(() => createCastleContent({ ...fixture, beaconModuleId: 'missing' })).toThrow(/beacon/);
    expect(() => createCastleContent({ ...fixture, beaconModuleId: 'gate' })).toThrow(/keep/);
    expect(() => createCastleContent({ ...fixture, modules: [fixture.modules[0]!,fixture.modules[0]!] })).toThrow(/Duplicate/);
  });
});
