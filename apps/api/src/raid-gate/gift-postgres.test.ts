import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type PersonId } from '../../../../packages/shared/src/identity';
import { createRealmGiftHosts, GIFT_NAME_BATCH } from './gift-hosts';
import { createPostgresItemTransfers, type ItemRows } from './gift-postgres';
import type { GiftItem, ItemTransferRecord, VisitorGiftRecord } from './gifts';
import { RaidGateStorageError, type SqlPool } from './postgres-repository';
import type { SqlQueryable } from './session';

const HOME = KingdomIdSchema.parse('41000001');
const MIRA = KingdomIdSchema.parse('41000002');
const MIRA_MONARCH = PersonIdSchema.parse('41000002');
const WREN = PersonIdSchema.parse('52000001');
const T = 1_800_000_000_000;
const live = () => new AbortController().signal;

const lantern = (change: Partial<GiftItem> = {}): GiftItem => ({
  itemId: 'item-1', revision: 3, ownerId: WREN, kind: 'forged', title: 'Lantern', makerId: WREN, makerName: 'Wren', originKingdomId: HOME,
  originName: null, transferable: true, paid: false, origin: 'simulated', ...change,
});
const offer = (change: Partial<VisitorGiftRecord> = {}): VisitorGiftRecord => ({
  offerId: 'offer-1', revision: 1, requestId: 'req-1', giverId: WREN, recipientId: MIRA_MONARCH, arrivalId: 'arrival.t1', visitorId: WREN,
  kingdomId: MIRA, homeKingdomId: HOME, direction: 'left', itemId: 'item-1', itemRevision: 3, makerId: WREN, originKingdomId: HOME,
  story: { title: 'Lantern', kind: 'forged', makerName: 'Wren', originName: null }, giverName: 'Wren', recipientName: null, state: 'offered',
  offeredAt: T, expiresAt: T + 600_000, settledAt: null, transferId: null, rejection: null, origin: 'simulated', ...change,
});
const transfer = (change: Partial<ItemTransferRecord> = {}): ItemTransferRecord => ({
  transferId: 'offer-1', revision: 1, itemId: 'item-1', fromRevision: 3, toRevision: 4, from: WREN, to: MIRA_MONARCH, offerId: 'offer-1',
  arrivalId: 'arrival.t1', kingdomId: MIRA, homeKingdomId: HOME, makerId: WREN, originKingdomId: HOME, at: T + 1_000, origin: 'simulated', ...change,
});
const row = (record: { revision: number }) => ({ revision: String(record.revision), record: JSON.stringify(record) });

type Reply = { rows?: unknown[]; rowCount?: number } | Error | undefined;
/** A pg pool double: records every statement and answers from a script. */
function fakePool(script: (sql: string, params: readonly unknown[]) => Reply) {
  const log: { sql: string; params: readonly unknown[] }[] = [];
  const query = async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    log.push({ sql, params });
    const reply = script(sql, params);
    if (reply instanceof Error) throw reply;
    return { rows: reply?.rows ?? [], rowCount: reply?.rowCount ?? reply?.rows?.length ?? 0 };
  };
  const pool: SqlPool & SqlQueryable = { connect: async () => ({ query, release() {} }), query };
  const statements = () => log.map(entry => entry.sql.split(' ')[0]);
  return { pool, log, statements };
}

/** Main's item rows as a fixed answer per call. */
const itemRows = (answers: Partial<{ get: unknown; move: unknown; listOwned: unknown }>): ItemRows => ({
  get: async () => answers.get as GiftItem | null,
  move: async () => answers.move as never,
  listOwned: async () => answers.listOwned as GiftItem[],
});

describe('Postgres gift storage', () => {
  it('answers a lost offer insert with what is stored, and checks an update against the unique indexes before writing', async () => {
    const stored = offer({ requestId: 'req-0' });
    const db = fakePool(sql => {
      if (sql.startsWith('insert')) return { rowCount: 0 };
      if (sql.startsWith('select 1')) return { rows: [{ '?column?': 1 }] };
      if (sql.startsWith('select revision')) return { rows: [row(stored)] };
      return undefined;
    });
    const gifts = createPostgresItemTransfers({ pool: db.pool, origin: 'simulated', items: itemRows({}) });
    const [inserted, settled] = await gifts.transaction(async tx => [
      await tx.putOffer(offer(), 0),
      // Another offer already holds this giver's request key: refused before any update is attempted.
      await tx.putOffer(offer({ revision: 2, state: 'refused', settledAt: T + 5 }), 1),
    ], live());
    expect(inserted).toEqual({ kind: 'conflict', current: stored });
    expect(settled).toEqual({ kind: 'conflict', current: stored });
    expect(db.statements()).toEqual(['begin', 'insert', 'select', 'select', 'select', 'commit']);
    expect(db.log[1]!.sql).toMatch(/^insert into realm_raid_gifts \(offer_id, giver_id, request_id, recipient_id, arrival_id, kingdom_id, item_id, state, offered_at, origin, revision, record\) .* on conflict do nothing$/);
    expect(db.log[3]!.params).toEqual(['offer-1', WREN, 'req-1', 'item-1', false]);
  });

  it('throws on an item that fails its reader or is of the other origin, never reading it as missing', async () => {
    const malformed = [{ ...lantern(), kind: 'heirloom' }, { ...lantern(), extra: true }, lantern({ origin: 'live' }), lantern({ itemId: 'item-2' })];
    for (const get of malformed) {
      const db = fakePool(() => undefined);
      const gifts = createPostgresItemTransfers({ pool: db.pool, origin: 'simulated', items: itemRows({ get }) });
      await expect(gifts.transaction(tx => tx.getItem('item-1'), live())).rejects.toBeInstanceOf(RaidGateStorageError);
      expect(db.statements()).toEqual(['begin', 'rollback']);
    }
    const move = { kind: 'stored', record: lantern({ ownerId: MIRA_MONARCH, revision: 5 }) };
    const listOwned = [lantern(), lantern({ itemId: 'item-2', ownerId: MIRA_MONARCH })];
    const gifts = createPostgresItemTransfers({ pool: fakePool(() => undefined).pool, origin: 'simulated', items: itemRows({ move, listOwned }) });
    // A move to a revision other than the next one, and a listing with someone else's thing.
    await expect(gifts.transaction(tx => tx.moveItem('item-1', WREN, MIRA_MONARCH, 3), live())).rejects.toBeInstanceOf(RaidGateStorageError);
    await expect(gifts.transaction(tx => tx.listOwned(WREN, 12), live())).rejects.toBeInstanceOf(RaidGateStorageError);
  });

  it('decodes every listed offer and refuses a row that disagrees with the query', async () => {
    const newer = offer({ offerId: 'offer-2', requestId: 'req-2', itemId: 'item-2', offeredAt: T + 10 });
    const stray = offer({ offerId: 'offer-3', requestId: 'req-3', arrivalId: 'arrival.t9' });
    const records = new Map([newer, offer(), stray].map(each => [each.offerId, each]));
    const db = fakePool((sql, params) => {
      if (sql.startsWith('select offer_id')) return { rows: (params[0] === 'arrival.t1' ? ['offer-2', 'offer-1'] : ['offer-3']).map(offer_id => ({ offer_id })) };
      if (sql.startsWith('select revision')) return { rows: [row(records.get(params[0] as string)!)] };
      return undefined;
    });
    const gifts = createPostgresItemTransfers({ pool: db.pool, origin: 'simulated', items: itemRows({}) });
    expect(await gifts.transaction(tx => tx.listArrivalOffers('arrival.t1', 24), live())).toEqual([newer, offer()]);
    expect(db.log[1]!.sql).toMatch(/where arrival_id = \$1 order by offered_at desc, offer_id collate "C" limit \$2$/);
    expect(db.log[1]!.params).toEqual(['arrival.t1', 24]);
    await expect(gifts.transaction(tx => tx.listArrivalOffers('arrival.t2', 24), live())).rejects.toBeInstanceOf(RaidGateStorageError);
    await expect(gifts.transaction(tx => tx.listArrivalOffers('arrival.t1', 51), live())).rejects.toBeInstanceOf(RaidGateStorageError);
  });

  it('answers a second transfer under the same ID with the lineage already written', async () => {
    const first = transfer();
    const db = fakePool(sql => sql.startsWith('insert') ? { rowCount: 0 } : sql.startsWith('select') ? { rows: [row(first)] } : undefined);
    const gifts = createPostgresItemTransfers({ pool: db.pool, origin: 'simulated', items: itemRows({}) });
    const again = await gifts.transaction(tx => tx.appendTransfer(transfer({ at: T + 2_000 })), live());
    expect(again).toEqual({ kind: 'conflict', current: first });
    expect(db.log[1]!.sql).toMatch(/^insert into realm_raid_item_transfers \(transfer_id, item_id, origin, revision, record\) .* on conflict do nothing$/);
    expect(db.log[2]!.sql).toBe('select revision::text as revision, record from realm_raid_item_transfers where transfer_id = $1');
    await expect(gifts.transaction(tx => tx.appendTransfer(transfer({ origin: 'live' })), live())).rejects.toBeInstanceOf(RaidGateStorageError);
  });
});

describe('Realm gift hosts', () => {
  it('reads standing and names only of its own origin, at most a hundred people per query', async () => {
    const db = fakePool((sql, params) => {
      if (sql.startsWith('select exists')) return { rows: [{ kingdom: params[1] === MIRA, citizen: params[0] === WREN }] };
      const batch = params[0] as string[];
      return { rows: batch.flatMap((person_id): { person_id: string; person_name: string | null; citizen_name: string }[] => {
        if (person_id === WREN) return [{ person_id, person_name: 'Wren', citizen_name: 'wren_chat' }];
        if (person_id === MIRA_MONARCH) return [{ person_id, person_name: null, citizen_name: 'Mira' }];
        // An approved name that does not read as display text is not swapped for the chat one.
        if (person_id === '52000003') return [{ person_id, person_name: ' padded ', citizen_name: 'Clean' }];
        return [{ person_id, person_name: null, citizen_name: `p${person_id}` }];
      }) };
    });
    const hosts = createRealmGiftHosts({ pool: db.pool, origin: 'simulated' });
    expect(await hosts.standing(MIRA_MONARCH, MIRA, live())).toBe('monarch');
    expect(await hosts.standing(WREN, MIRA, live())).toBe('citizen');
    expect(await hosts.standing(PersonIdSchema.parse('52000002'), MIRA, live())).toBe('none');
    // The broadcaster of a kingdom the realm does not hold (or holds for the other origin) is no monarch here.
    expect(await hosts.standing(WREN, KingdomIdSchema.parse('52000001'), live())).toBe('none');
    for (const entry of db.log) expect(entry.params[2]).toBe('simulated');
    expect(db.log[0]!.sql).toMatch(/k\.origin = \$3\).*d\.origin = \$3 and d\.status <> 'void'/);

    db.log.length = 0;
    const many = Array.from({ length: 247 }, (_, index) => PersonIdSchema.parse(String(60_000_000 + index)));
    const asked: PersonId[] = [WREN, MIRA_MONARCH, PersonIdSchema.parse('52000003'), ...many, WREN];
    const names = await hosts.names(asked, live());
    expect(db.log.map(entry => (entry.params[0] as string[]).length)).toEqual([GIFT_NAME_BATCH, GIFT_NAME_BATCH, 50]);
    for (const entry of db.log) expect(entry.params.slice(1)).toEqual(['simulated', 'provider-display-name-v1']);
    expect(db.log[0]!.sql).toMatch(/p\.origin = \$2 .* c\.origin = \$2/);
    expect(names.get(WREN)).toBe('Wren');
    expect(names.get(MIRA_MONARCH)).toBe('Mira');
    expect(names.has(PersonIdSchema.parse('52000003'))).toBe(false);
    expect(names.size).toBe(2 + many.length);

    const aborted = new AbortController();
    aborted.abort(new Error('the viewer left'));
    await expect(hosts.names([WREN], aborted.signal)).rejects.toThrow('the viewer left');
  });
});
