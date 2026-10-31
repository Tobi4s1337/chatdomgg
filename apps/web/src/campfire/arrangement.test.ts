import { describe, expect, it } from 'vitest';
import { HEARTH_RADIUS, PATH_ANGLE, approachRoute, campfireArrangement, type Arrangement, type XZ } from './arrangement';

const distanceToSegment = (p: XZ, a: XZ, b: XZ): number => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};
const logEnds = (arrangement: Arrangement) => arrangement.logs.map(log => {
  const half = log.length / 2, dx = Math.cos(log.yaw) * half, dz = -Math.sin(log.yaw) * half;
  return [[log.centre[0] - dx, log.centre[1] - dz], [log.centre[0] + dx, log.centre[1] + dz]] as const;
});
const angleGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('campfire arrangement', () => {
  it('seats every count from five to eleven players with the Magistrate, without overlap', () => {
    for (let players = 0; players <= 11; players++) {
      const ring = campfireArrangement(players, true);
      expect(ring.seats.filter(s => s.kind === 'player')).toHaveLength(players);
      expect(ring.seats[0]).toMatchObject({ seat: 0, kind: 'magistrate' });
      expect(new Set(ring.seats.map(s => s.seat)).size).toBe(players + 1);
      // Sitters are at least shoulder-width apart and face the fire.
      for (const a of ring.seats) {
        expect(Math.hypot(...a.hip)).toBeGreaterThan(HEARTH_RADIUS + .9);
        const toFire = Math.atan2(-a.hip[0], -a.hip[1]);
        expect(angleGap(a.heading, toFire)).toBeLessThan(.35);
        for (const b of ring.seats) if (a !== b) expect(Math.hypot(a.hip[0] - b.hip[0], a.hip[1] - b.hip[1])).toBeGreaterThan(.75);
      }
      // Logs never touch each other, the footpath or the Magistrate's chair.
      const ends = logEnds(ring);
      for (const [i, [a0, a1]] of ends.entries()) {
        for (const [j, [b0, b1]] of ends.entries()) if (i !== j) expect(Math.min(distanceToSegment(a0, b0, b1), distanceToSegment(a1, b0, b1))).toBeGreaterThan(.3);
        for (const t of [0, .25, .5, .75, 1]) {
          const p: XZ = [a0[0] + (a1[0] - a0[0]) * t, a0[1] + (a1[1] - a0[1]) * t];
          expect(angleGap(Math.atan2(p[0], p[1]), PATH_ANGLE)).toBeGreaterThan(.3);
          expect(Math.hypot(p[0] - ring.magistrate!.centre[0], p[1] - ring.magistrate!.centre[1])).toBeGreaterThan(.7);
        }
      }
      // Lanterns stand between each player and the hearth, clear of feet and the stone ring.
      for (const s of ring.seats.filter(s => s.kind === 'player')) {
        expect(s.lantern).not.toBeNull();
        expect(Math.hypot(...s.lantern!)).toBeGreaterThan(HEARTH_RADIUS + .2);
        for (const other of ring.seats) {
          expect(Math.hypot(s.lantern![0] - other.hip[0], s.lantern![1] - other.hip[1])).toBeGreaterThan(.45);
          // Knees and feet run forward from the hip within ±0.2 m.
          for (const d of [.1, .2, .3, .4]) {
            const foot: XZ = [other.hip[0] + Math.sin(other.heading) * d, other.hip[1] + Math.cos(other.heading) * d];
            expect(Math.hypot(s.lantern![0] - foot[0], s.lantern![1] - foot[1])).toBeGreaterThan(.3);
          }
        }
        for (const other of ring.seats.filter(o => o !== s && o.lantern)) expect(Math.hypot(s.lantern![0] - other.lantern![0], s.lantern![1] - other.lantern![1])).toBeGreaterThan(.3);
      }
    }
  });

  it('is deterministic', () => {
    expect(campfireArrangement(11, true)).toEqual(campfireArrangement(11, true));
  });

  it('routes an arriving person round the ring, never through a log or the hearth', () => {
    for (const players of [5, 11]) {
      const ring = campfireArrangement(players, true);
      const ends = logEnds(ring);
      for (const seat of ring.seats) {
        const route = approachRoute(ring, seat.seat, .35);
        const lanterns = ring.seats.flatMap(s => s.lantern ? [s.lantern] : []);
        for (let i = 1; i < route.length; i++) {
          const a = route[i - 1]!, b = route[i]!;
          for (let t = 0; t <= 1; t += .05) {
            const p: XZ = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            expect(Math.hypot(...p)).toBeGreaterThan(HEARTH_RADIUS + .25);
            for (const [e0, e1] of ends) expect(distanceToSegment(p, e0, e1)).toBeGreaterThan(.35);
            for (const l of lanterns) expect(Math.hypot(p[0] - l[0], p[1] - l[1])).toBeGreaterThan(.3);
          }
        }
      }
    }
  });
});
