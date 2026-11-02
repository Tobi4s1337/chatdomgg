import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, parseRaidPennantArchiveCursor, RaidPennantArchivePageSchema, RaidPennantFrameSchema,
  type RaidPennant, type RaidPennantArchivePage } from '@chatdom/shared';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import { migrateRealmSchema } from '../persistence/migrate';
import { createRaidShowService } from './http';
import { RaidObservationLedger } from './observations';

const now = 1_800_000_000_000, day = 86_400_000;
const destination = KingdomIdSchema.parse('202');
const to = { kingdomId: destination, login: 'host', name: 'Host' };
const observation = (id: string, index: number, overrides: Record<string, unknown> = {}) => RaidObservationSchema.parse({
  version: 1, id, origin: 'simulated', kingdomId: destination, direction: 'incoming',
  occurredAt: now - (index % 2 === 0 ? index + 1 : 3650 + index) * day, receivedAt: now,
  from: { kingdomId: String(1000 + index % 4), login: `visitor_${index % 4}`, name: `Visitor ${index % 4}` },
  to, viewers: index + 1, ...overrides,
});

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('incoming pennant archive on isolated Postgres', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool, service: ReturnType<typeof createRaidShowService>;
  const expected: RaidPennant[] = [];
  const roadIds: string[] = [];
  const moment = vi.fn(async () => ({ http: 202, body: { status: 'accepted' } }));
  const boot = (origin: 'live' | 'simulated' = 'simulated', clock = now) => new RaidObservationLedger({ pool, origin, clock: () => clock, moment });
  const open = () => createRaidShowService({ pool, origin: 'simulated', clock: () => now,
    credentials: { herald: 'simulated-archive-service-secret-000000000' }, recoverEveryMs: 0, moment });
  const read = (query = '', kingdomId = destination) => service.handle(new Request(`http://realm.test/realm/raid-pennants/${kingdomId}${query}`));
  const archive = async (before: string | null, limit = 12): Promise<RaidPennantArchivePage> => {
    const query = new URLSearchParams({ archive: '1', limit: String(limit) });
    if (before !== null) query.set('before', before);
    const response = await read(`?${query}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return RaidPennantArchivePageSchema.parse(await response.json());
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await migrateRealmSchema(admin, schema);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
    const ledger = boot();
    for (let index = 0; index < 73; index++) {
      const visit = observation(`archive-visit-${index}`, index);
      const result = await ledger.record(visit);
      roadIds.push(result.raidId);
      expected.unshift({ raidId: result.raidId, from: visit.from, occurredAt: visit.occurredAt });
      if (index % 5 === 0) {
        expect((await ledger.record({ ...visit, receivedAt: now + 500 })).status).toBe('duplicate');
        roadIds.push((await ledger.record(observation(`other-destination-${index}`, index, {
          kingdomId: '303', to: { kingdomId: '303', login: 'other_host', name: 'Other Host' },
        }))).raidId);
        roadIds.push((await ledger.record(observation(`outgoing-${index}`, index, { direction: 'outgoing', kingdomId: visit.from.kingdomId }))).raidId);
        await boot('live').record({ ...visit, origin: 'live' });
      }
    }
    service = open();
  });
  afterAll(async () => {
    await service?.close(); await pool?.end();
    if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); }
  });

  it('retains the strict default frame and gives archive reads a separate bounded page shape', async () => {
    for (const query of ['', '?limit=24']) {
      const response = await read(query);
      expect(response.status).toBe(200);
      const frame = await response.json();
      expect(RaidPennantFrameSchema.parse(frame)).toEqual({ version: 1, origin: 'simulated', kingdomId: destination, asOf: now, items: expected.slice(0, 24) });
      expect(Object.hasOwn(frame, 'next')).toBe(false);
    }
    const defaultArchive = RaidPennantArchivePageSchema.parse(await (await read('?archive=1')).json());
    expect(defaultArchive.items).toEqual(expected.slice(0, 12));
    expect(defaultArchive.next).not.toBeNull();
    const maximum = await archive(null, 64);
    expect(maximum.items).toEqual(expected.slice(0, 64));
    const tail = await archive(maximum.next, 64);
    expect(tail.items).toEqual(expected.slice(64));
    expect(tail.next).toBeNull();
    expect(await boot().pennantArchive(KingdomIdSchema.parse('404'), null)).toEqual({
      version: 1, origin: 'simulated', kingdomId: '404', asOf: now, items: [], next: null,
    });
  });

  it('resumes forward roads in numeric commit order through all 103 sparse fixture records', async () => {
    const first = await boot().page(null, 7), collected = first.items.map(item => item.id);
    let next = first.next, pages = 1;
    for (;;) {
      // Reconstruct the authority on every page, preserving only the public tail cursor.
      const page = await boot().page(next, 7);
      if (page.items.length === 0) {
        expect(page.next).toBe(next);
        break;
      }
      collected.push(...page.items.map(item => item.id));
      next = page.next; pages++;
      expect(pages).toBeLessThanOrEqual(15);
    }
    expect(collected).toEqual(roadIds);
    expect(new Set(collected).size).toBe(103);
    expect(pages).toBe(15);
  });

  it('walks every sparse incoming commit exactly once across restart, fencing late commits until a fresh read', async () => {
    const first = await archive(null);
    const cursor = parseRaidPennantArchiveCursor(first.next);
    expect(cursor).not.toBeNull();
    const newest = await pool.query<{ sequence: string }>(`select sequence::text from realm_raid_observations
      where origin = 'simulated' and direction = 'incoming' and to_kingdom_id = $1 order by realm_raid_observations.sequence desc limit 1`, [destination]);
    expect(cursor!.ceiling).toBe(Number(newest.rows[0]!.sequence));
    const beforeLate = await boot().pennantArchive(destination, first.next);
    const lateVisit = observation('archive-new-commit-old-provider-date', 100, { occurredAt: now - 5000 * day });
    const late = await boot().record(lateVisit);
    expect((await boot().record({ ...lateVisit, receivedAt: now + 1000 })).status).toBe('duplicate');
    await service.close(); service = open();
    expect(await archive(first.next)).toEqual(beforeLate);

    const collected = [...first.items];
    let next = first.next, pages = 1;
    while (next !== null) {
      const page = await archive(next);
      collected.push(...page.items); pages++;
      if (page.next !== null) {
        const previous = parseRaidPennantArchiveCursor(next)!, current = parseRaidPennantArchiveCursor(page.next)!;
        expect(current.ceiling).toBe(cursor!.ceiling);
        expect(current.before).toBeLessThan(previous.before);
      }
      next = page.next;
      expect(pages).toBeLessThanOrEqual(7);
    }
    expect(pages).toBe(7);
    expect(collected).toEqual(expected);
    expect(new Set(collected.map(item => item.raidId)).size).toBe(73);
    expect(collected.some(item => item.raidId === late.raidId)).toBe(false);
    expect((await archive(null)).items).toEqual([{ raidId: late.raidId, from: lateVisit.from, occurredAt: lateVisit.occurredAt }, ...expected.slice(0, 11)]);

    // A one-item final page has no cursor; an explicit safe boundary before sequence one is empty.
    const maximum = await archive(null, 64), tail = await archive(maximum.next, 9);
    expect(tail.items).toEqual(expected.slice(63, 72));
    expect((await archive(tail.next, 9))).toMatchObject({ items: expected.slice(72), next: null });
    expect(await boot().pennantArchive(destination, `pennants:1:simulated:202:${cursor!.ceiling}:1`)).toMatchObject({ items: [], next: null });
    expect(moment).not.toHaveBeenCalled();
  });

  it('keeps origins and destinations scoped while allowing old cursors after years of clock advance', async () => {
    const first = await boot().pennantArchive(destination, null, 1);
    const later = await boot('simulated', now + 20 * 365 * day).pennantArchive(destination, first.next, 1);
    expect(later.items).toEqual(expected.slice(0, 1));
    expect(later.asOf).toBe(now + 20 * 365 * day);
    const live = await boot('live').pennantArchive(destination, null, 64);
    expect(live.items).toHaveLength(15);
    expect(live.items[0]).toEqual(expected[2]);
    const other = await boot().pennantArchive(KingdomIdSchema.parse('303'), null, 64);
    expect(other.items).toHaveLength(15);
    expect(other.items.some(item => expected.some(visit => visit.raidId === item.raidId))).toBe(false);
    await expect(boot('live').pennantArchive(destination, first.next)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(boot().pennantArchive(KingdomIdSchema.parse('303'), first.next)).rejects.toMatchObject({ kind: 'invalid' });
    for (const limit of [0, 65, 1.5, NaN, Infinity]) {
      await expect(boot().pennantArchive(destination, null, limit)).rejects.toMatchObject({ kind: 'invalid' });
    }
  });

  it('rejects invalid, cross-scope, duplicate and unknown query parameters without leaking history', async () => {
    const badCursors = ['', 'simulated:1', 'pennants:2:simulated:202:2:1', 'pennants:1:live:202:2:1',
      'pennants:1:simulated:303:2:1', 'pennants:1:simulated:202:0:0', 'pennants:1:simulated:202:2:0',
      'pennants:1:simulated:202:2:3', 'pennants:1:simulated:202:02:1', 'pennants:1:simulated:202:2:01',
      'pennants:1:simulated:202:9007199254740992:1', 'pennants:1:simulated:202:1:9007199254740992',
      'pennants:1:simulated:202:2:1:extra'];
    for (const before of badCursors) {
      const response = await read(`?${new URLSearchParams({ archive: '1', before })}`);
      expect(response.status, before).toBe(400);
      expect(await response.json()).toEqual({ version: 1, status: 'refused' });
    }
    for (const query of ['?archive=0', '?archive=', '?archive=true', '?before=pennants:1:simulated:202:2:1',
      '?archive=1&archive=1', '?archive=1&before=a&before=b', '?archive=1&limit=1&limit=2',
      '?archive=1&other=1', '?archive=1&offset=12', '?archive=1&after=1', '?other=1',
      '?archive=1&limit=0', '?archive=1&limit=65', '?archive=1&limit=01', '?archive=1&limit=1.5']) {
      expect((await read(query)).status, query).toBe(400);
    }
    expect((await service.handle(new Request(`http://realm.test/realm/raid-pennants/${destination}?archive=1`, { method: 'POST' }))).status).toBe(405);
  });
});
