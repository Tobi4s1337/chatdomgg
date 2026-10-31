import { expect, it } from 'vitest';
import { boundsOverlap, homeFrame } from '../settlement/geometry';
import { compileChannelGenesis } from './index';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from './observed-fixtures';
import { compileGenesisSettlement } from './settlement';
import { sampleGenesisSurface } from './surface';

it('reserves deterministic, dry, connected potential homes for the three observed Genesis compositions', () => {
  const scenarios = [
    ...OBSERVED_GENESIS_FIXTURES.map((facts, i) => ({ facts, character: OBSERVED_GENESIS_SHOWCASE_CHOICES[i]!.character })),

  ];
  for (const { facts, character } of scenarios) {
    const recipe = compileChannelGenesis(facts), landscape = recipe.landscapes.find(candidate => candidate.character === character)!;
    const plan = compileGenesisSettlement(recipe, landscape.id);
    expect(plan.homes.length).toBe(recipe.size.homeCapacity);
    expect(plan.reservations.length).toBe(recipe.size.homeCapacity);
    expect(JSON.stringify(compileGenesisSettlement(recipe, landscape.id))).toBe(JSON.stringify(plan));
    expect(new Set(plan.homes.map(home => home.id)).size).toBe(plan.homes.length);
    const adjacency = new Map<string, string[]>();
    for (const edge of plan.streets) {
      for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) adjacency.set(from!, [...adjacency.get(from!) ?? [], to!]);
      for (let i = 0; i < edge.points.length; i++) {
        const p = edge.points[i]!, surface = sampleGenesisSurface(landscape, p[0], p[2]);
        expect(surface.waterLevel === null || surface.ground > surface.waterLevel + .5).toBe(true);
        if (i) { const a = edge.points[i - 1]!; expect(Math.abs(p[1] - a[1])).toBeLessThanOrEqual(.121 * Math.hypot(p[0] - a[0], p[2] - a[2]) + 1e-6); }
      }
    }
    const visited = new Set(['market']), queue = ['market'];
    for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]!) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    expect(plan.nodes.every(node => visited.has(node.id))).toBe(true);
    for (let i = 0; i < plan.homes.length; i++) {
      const home = plan.homes[i]!, front = homeFrame(home).front, approach = plan.streets.find(edge => edge.id === home.approachId)!;
      expect(approach.points[0]).toEqual(front);
      expect(plan.streets.some(edge => edge.id === home.streetId && (edge.from === approach.to || edge.to === approach.to))).toBe(true);
      expect([home.lot.maxX - home.lot.minX, home.lot.maxZ - home.lot.minZ].sort((a, b) => a - b)).toEqual([8, 16]);
      for (const x of [home.lot.minX, (home.lot.minX + home.lot.maxX) / 2, home.lot.maxX]) for (const z of [home.lot.minZ, (home.lot.minZ + home.lot.maxZ) / 2, home.lot.maxZ]) {
        const surface = sampleGenesisSurface(landscape, x, z);
        expect(surface.waterLevel === null || surface.ground > surface.waterLevel + .5).toBe(true);
      }
      for (let j = 0; j < i; j++) expect(boundsOverlap(home.lot, plan.homes[j]!.lot, 1)).toBe(false);
    }
    if (recipe.size.tier === 'city') {
      expect(Math.ceil(plan.bounds.maxX / 16) - Math.floor(plan.bounds.minX / 16)).toBeLessThanOrEqual(32);
      expect(Math.ceil(plan.bounds.maxZ / 16) - Math.floor(plan.bounds.minZ / 16)).toBeLessThanOrEqual(32);
    }
    expect(plan.homes.every(home => !('citizenId' in home) && !('presence' in home))).toBe(true);
    expect(() => compileGenesisSettlement(recipe, 'missing')).toThrow();
  }
}, 60000);
