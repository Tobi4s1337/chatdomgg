import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import { MAT } from '../materials';
import { createKeeperLook } from './look';
import { keeperRole } from './roles/index';
import { actPose, actToolPoint, fixtureToWorld, inHours, lowestFoot, planKeeperRound, visitHeading, type KeeperFixture, type KeeperPlaceSite } from './routine';
import { KEEPER_ROLES, KEEPER_TEMPERAMENTS, type KeeperAct, type KeeperRole } from './types';

const looks = (role: KeeperRole) => KEEPER_TEMPERAMENTS.map(temperament => {
  const def = keeperRole(role);
  return { temperament, look: createKeeperLook({ role, temperament, kit: 'tide', body: def.bodies[temperament], skin: MAT.skin4, hair: { form: def.hairForms[0]!, swatch: MAT.hairBrown } }) };
});
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('keeper acts', () => {
  for (const role of KEEPER_ROLES) {
    const def = keeperRole(role);
    const dressed = looks(role);

    it(`${role}: has acts at the fixtures it needs, and needs only fixtures it works at`, () => {
      expect(def.acts.length).toBeGreaterThanOrEqual(3);
      expect(new Set(def.acts.map(act => act.id)).size).toBe(def.acts.length);
      expect([...new Set(def.acts.map(act => act.at))].sort()).toEqual([...def.needs].sort());
    });

    for (const act of def.acts) {
      it(`${role}/${act.id}: is authored whole — labelled keys from t=0, a real tool, sane timing`, () => {
        expect(act.label.length).toBeGreaterThan(12);
        expect(act.keys[0]!.t).toBe(0);
        for (const [i, key] of act.keys.entries()) {
          expect(key.t).toBeGreaterThanOrEqual(0);
          expect(key.t).toBeLessThan(1);
          if (i) expect(key.t).toBeGreaterThan(act.keys[i - 1]!.t);
          expect(key.pose.label.length).toBeGreaterThan(3);
        }
        expect(act.cycle).toBeGreaterThan(1);
        expect(act.repeats).toBeGreaterThanOrEqual(1);
        expect(act.hours[0]).not.toBe(act.hours[1]);
        for (const { look } of dressed) {
          if (act.tool) expect(look.tools.map(tool => tool.id)).toContain(act.tool);
        }
        expect(Math.hypot(...act.stand)).toBeLessThan(2);
      });

      it(`${role}/${act.id}: keeps both feet on the ground through the whole cycle`, () => {
        for (const { temperament, look } of dressed) {
          for (let phase = 0; phase < 1; phase += 0.05) {
            expect(Math.abs(lowestFoot(look, actPose(def, act, temperament, phase)))).toBeLessThan(0.07);
          }
        }
      });

      if (act.reach) {
        const reach = act.reach;
        it(`${role}/${act.id}: lands the ${reach.toolPoint} on its target for every temperament`, () => {
          expect(act.tool).not.toBeNull();
          for (const { temperament, look } of dressed) {
            const pose = actPose(def, act, temperament, act.keys[reach.key]!.t);
            expect(distance(actToolPoint(look, act, pose, reach.toolPoint), reach.target)).toBeLessThanOrEqual(reach.tolerance);
          }
        });
        if (reach.toolPoint === 'butt') {
          it(`${role}/${act.id}: never slides the planted butt during the cycle`, () => {
            for (const { temperament, look } of dressed) {
              for (const key of act.keys) {
                const butt = actToolPoint(look, act, actPose(def, act, temperament, key.t), 'butt');
                expect(distance(butt, reach.target)).toBeLessThanOrEqual(reach.tolerance);
              }
            }
          });
        }
      }
    }

    it(`${role}: tool contacts lie at the fixture, not out in the street`, () => {
      for (const act of def.acts) if (act.reach) expect(Math.hypot(act.reach.target[0], act.reach.target[2])).toBeLessThan(1.3);
    });
  }

  it('the lamplighter tends lamps through dusk, and every role has work at dusk', () => {
    for (const role of KEEPER_ROLES) expect(keeperRole(role).acts.some(act => inHours(19.4, act.hours))).toBe(true);
    const dusk = keeperRole('lamplighter').acts.filter(act => inHours(18, act.hours)).map(act => act.id);
    expect(dusk).toContain('trim-wick');
  });

  it('wraps hours past midnight', () => {
    expect(inHours(23.5, [19, 6])).toBe(true);
    expect(inHours(3, [19, 6])).toBe(true);
    expect(inHours(12, [19, 6])).toBe(false);
    expect(inHours(-1, [19, 6])).toBe(true);
    expect(inHours(6, [6, 16])).toBe(true);
    expect(inHours(16, [6, 16])).toBe(false);
  });
});

describe('a keeper\'s round', () => {
  const lamp = (id: string, x: number, z: number, facing = 0): KeeperFixture => ({ id, kind: 'lamp', position: [x, 0, z], facing });
  const site: KeeperPlaceSite = {
    placeId: 'plaza', centre: [0, 0], radius: 12, provenance: 'host',
    fixtures: [lamp('a', 2, 1), lamp('b', -6, -4, 1.2), lamp('c', 8, -5, -0.4), lamp('far', 30, 0)],
  };
  const lamplighter = keeperRole('lamplighter');

  it('visits only fixtures inside the radius, at the act stand points and headings', () => {
    const round = planKeeperRound(lamplighter, site, 19.4, 'seed');
    expect(round.outOfBounds).toEqual(['far']);
    expect(round.missing).toEqual([]);
    expect(round.visits.length).toBeGreaterThan(0);
    for (const visit of round.visits) {
      expect(visit.fixtureId).not.toBe('far');
      expect(inHours(19.4, visit.act.hours)).toBe(true);
      const fixture = site.fixtures.find(f => f.id === visit.fixtureId)!;
      expect(visit.position).toEqual(fixtureToWorld(fixture, [visit.act.stand[0], 0, visit.act.stand[1]]));
      expect(visit.heading).toBeCloseTo(visitHeading(visit.act, fixture));
      expect(Math.hypot(visit.position[0], visit.position[2])).toBeLessThanOrEqual(site.radius);
      expect(visit.seconds).toBe(visit.act.cycle * visit.act.repeats);
    }
    expect(round.label).toBeNull();
  });

  it('faces the fixture it works at', () => {
    const round = planKeeperRound(lamplighter, site, 18, 'seed');
    for (const visit of round.visits) {
      const fixture = site.fixtures.find(f => f.id === visit.fixtureId)!;
      const toward: Vec3 = [fixture.position[0] - visit.position[0], 0, fixture.position[2] - visit.position[2]];
      const facing: Vec3 = [Math.sin(visit.heading), 0, Math.cos(visit.heading)];
      expect(toward[0] * facing[0] + toward[2] * facing[2]).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same seed and hour, and walks the nearest lamp next', () => {
    const a = planKeeperRound(lamplighter, site, 19.4, 'seed'), b = planKeeperRound(lamplighter, site, 19.4, 'seed');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const at = (id: string) => site.fixtures.find(f => f.id === id)!.position;
    const ids = a.visits.map(v => v.fixtureId);
    for (let i = 1; i < ids.length; i++) {
      const here = at(ids[i - 1]!), next = Math.hypot(at(ids[i]!)[0] - here[0], at(ids[i]!)[2] - here[2]);
      for (const later of ids.slice(i + 1)) expect(next).toBeLessThanOrEqual(Math.hypot(at(later)[0] - here[0], at(later)[2] - here[2]) + 1e-9);
    }
  });

  it('plans nothing it cannot do: a ferryman at a dry plaza only reports what is missing', () => {
    const round = planKeeperRound(keeperRole('ferryman'), site, 12, 'seed');
    expect(round.visits).toEqual([]);
    expect([...round.missing].sort()).toEqual(['mooring', 'water-edge']);
  });

  it('labels a round at a simulated site SIMULATED', () => {
    expect(planKeeperRound(lamplighter, { ...site, provenance: 'simulated' }, 19.4, 'seed').label).toBe('SIMULATED');
  });

  it('refuses a round without a finite hour or a radius', () => {
    expect(() => planKeeperRound(lamplighter, site, Number.NaN, 'seed')).toThrow();
    expect(() => planKeeperRound(lamplighter, { ...site, radius: 0 }, 12, 'seed')).toThrow();
  });

  it('works the landing: a ferryman with a mooring and a water edge has work day and night', () => {
    const landing: KeeperPlaceSite = {
      placeId: 'landing', centre: [0, 0], radius: 14, provenance: 'host',
      fixtures: [{ id: 'post', kind: 'mooring', position: [1, 0, 0], facing: 0 }, { id: 'edge', kind: 'water-edge', position: [0, 0, -2], facing: 0 }],
    };
    const ferryman = keeperRole('ferryman');
    for (const hour of [8, 13, 19.4, 23, 3]) {
      const round = planKeeperRound(ferryman, landing, hour, 'seed');
      expect(round.missing).toEqual([]);
      expect(round.visits.length).toBeGreaterThan(0);
    }
  });
});

describe('act tool points', () => {
  it('refuse an act with empty hands or an unknown point', () => {
    const def = keeperRole('innkeeper');
    const { look } = looks('innkeeper')[0]!;
    const empty = def.acts.find(act => act.tool === null)!;
    expect(() => actToolPoint(look, empty, actPose(def, empty, 'hearty', 0), 'rim')).toThrow(/nothing in hand/);
    const held: KeeperAct = def.acts.find(act => act.tool === 'broom')!;
    expect(() => actToolPoint(look, held, actPose(def, held, 'hearty', 0), 'nowhere')).toThrow(/no point/);
  });
});
