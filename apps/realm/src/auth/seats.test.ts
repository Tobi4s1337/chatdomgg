import { expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmPrincipal } from '@chatdom/shared/realm';
import { REALM_RECONNECT_GRACE_MS, REALM_SESSION_UNAVAILABLE_MS, RealmSeats } from './seats';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

it('R8 seat policy: newest window wins, grace is 30 s inside the session, ended or unanswered sessions end the seat', async () => {
  let wall = 1_800_000_000_000, mono = 0, answer: boolean | Error = true;
  const closed: [string, number][] = [];
  const seats = new RealmSeats({
    auth: { current: async () => { if (answer instanceof Error) throw answer; return answer; } },
    close: (walkerId, code) => closed.push([walkerId, code]), now: () => wall, monotonic: () => mono,
  });
  const principal = (personId: string, life: number): RealmPrincipal => ({ personId: PersonIdSchema.parse(personId), kingdomId: KingdomIdSchema.parse('999000001'),
    sessionId: crypto.randomUUID(), expiresAt: wall + life, origin: 'simulated', publicName: 'Citizen', look: 'neutral' });

  // Drop and reconnect keep the same seat; walking is held for the whole gap.
  const ash = principal('990100021', 3_600_000);
  expect(seats.seat(ash, 'a1')).toBeNull();
  expect(seats.held('a1')).toBe(false);
  expect(seats.dropped('a1')).toBe(REALM_RECONNECT_GRACE_MS / 1_000);
  expect(seats.held('a1')).toBe(true);
  let cancelled = 0;
  seats.awaiting('a1', () => cancelled++);
  await seats.reconnected('a1');
  expect(seats.held('a1')).toBe(false);

  // A second window of the same person takes the seat; the first socket closes with 4409 and gets no grace.
  expect(seats.seat(ash, 'a2')).toBe('a1');
  expect(closed).toEqual([['a1', 4409]]);
  expect(seats.dropped('a1')).toBe(0);
  await expect(seats.reconnected('a1')).rejects.toMatchObject({ code: 4409 });
  seats.left('a1');
  expect(seats.seatOf(ash.personId)).toBe('a2');

  // Revocation during the grace ends it at the next check instead of 30 s later, and refuses the reconnect.
  expect(seats.dropped('a2')).toBe(30);
  seats.awaiting('a2', () => cancelled++);
  answer = false; seats.check(); await flush();
  expect(cancelled).toBe(1);
  await expect(seats.reconnected('a2')).rejects.toMatchObject({ code: 4401 });
  seats.left('a2');
  expect(seats.seatOf(ash.personId)).toBeUndefined();

  // A connected seat whose session is refused closes with 4401; a seat that is gone refuses with 4410.
  answer = true;
  const bryn = principal('990100022', 12_000);
  seats.seat(bryn, 'b1');
  answer = false; seats.check(); await flush();
  expect(closed.at(-1)).toEqual(['b1', 4401]);
  expect(seats.dropped('b1')).toBe(0);
  seats.left('b1');
  await expect(seats.reconnected('b1')).rejects.toMatchObject({ code: 4410 });

  // The grace never outlives the session, and an expired principal ends without asking the store.
  answer = true;
  const brief = principal('990100023', 12_000);
  seats.seat(brief, 'c1');
  expect(seats.dropped('c1')).toBe(12);
  await seats.reconnected('c1');
  wall += 12_000;
  seats.check();
  expect(closed.at(-1)).toEqual(['c1', 4401]);
  seats.left('c1');

  // An unanswered store holds walking without closing; after 15 s of silence the seat ends with 4503.
  const cara = principal('990100024', 3_600_000);
  seats.seat(cara, 'd1');
  answer = new Error('session store unreachable'); seats.check(); await flush();
  expect(seats.held('d1')).toBe(true);
  expect(closed.at(-1)).toEqual(['c1', 4401]);
  answer = true; seats.check(); await flush();
  expect(seats.held('d1')).toBe(false);
  answer = new Error('session store unreachable');
  mono += REALM_SESSION_UNAVAILABLE_MS; seats.check(); await flush();
  expect(closed.at(-1)).toEqual(['d1', 4503]);

  // A disposing room ends every pending grace.
  answer = true;
  const dax = principal('990100025', 3_600_000);
  seats.seat(dax, 'e1'); seats.dropped('e1'); seats.awaiting('e1', () => cancelled++);
  seats.dispose();
  expect(cancelled).toBe(2);
});
