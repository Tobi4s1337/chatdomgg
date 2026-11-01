import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRealmPool, migrateRealmSchema } from '../../persistence';
import { RealmPanelService, type RealmPanelOptions } from './service';
import { forgetPerson } from './privacy';

it('does not substitute deletion or presence suppression for missing erasure authority', async () => {
  expect(await forgetPerson(undefined, { personId: '123' as never, requestedFromKingdomId: '456' as never, origin: 'live', requestId: 'request' })).toEqual({ status: 'unavailable' });
});

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('person privacy on development Postgres', () => {
  const schema = `panel_window_test_${randomBytes(6).toString('hex')}`;
  const secret = randomBytes(32).toString('hex'), authorization = `Bearer ${secret}`;
  let db: ReturnType<typeof createRealmPool>;
  const make = () => new RealmPanelService({ db, origin: 'live', secret, services: {}, allocation: {}, citizens: {} } as unknown as RealmPanelOptions);
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5410') throw new Error('Panel tests require development Postgres port 5410.');
    db = createRealmPool({ connectionString: url.toString(), schema });
    await migrateRealmSchema(db, schema);
    await db.query(`INSERT INTO realm_citizen_names VALUES ('123', 'live', 'Wren', 'provider-display-name-v1', 1), ('789', 'live', 'Juniper', 'provider-display-name-v1', 1)`);
    await db.query(`INSERT INTO realm_panel_pledges VALUES ('456', '123', 'live', 1), ('456', '789', 'live', 1)`);
  });
  afterAll(async () => { if (db) { try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); } } });
  it('persists the same subject-wide preference across kingdoms and reloads, leaving identity and other people alone', async () => {
    const panel = make();
    expect(await panel.privacy(authorization, { kingdomId: '456', personId: '123' })).toMatchObject({ http: 200, body: { quiet: false, projection: 'pending', forgetAvailable: false } });
    expect(await panel.quiet(authorization, { kingdomId: '456', personId: '123', quiet: true })).toMatchObject({ body: { status: 'quiet', quiet: true, projection: 'pending' } });
    expect(await make().privacy(authorization, { kingdomId: '999', personId: '123' })).toMatchObject({ body: { quiet: true } });
    expect(await make().privacy(authorization, { kingdomId: '456', personId: '789' })).toMatchObject({ body: { quiet: false } });
    expect((await db.query('SELECT public_name FROM realm_citizen_names ORDER BY person_id')).rows).toEqual([{ public_name: 'Wren' }, { public_name: 'Juniper' }]);
    expect(await panel.quiet(authorization, { kingdomId: '456', personId: '123', quiet: false })).toMatchObject({ body: { quiet: false } });
    expect(await make().privacy(authorization, { kingdomId: '456', personId: '123' })).toMatchObject({ body: { quiet: false } });
  });
  it('authenticates and confirms first; unavailable forget changes no rows and cannot report success', async () => {
    const panel = make(), query = vi.spyOn(db, 'query');
    expect(await panel.quiet('', { kingdomId: '456', personId: '123', quiet: true })).toMatchObject({ http: 401 });
    expect(await panel.quiet(authorization, { kingdomId: '456', personId: '123', quiet: 'true' })).toMatchObject({ http: 400 });
    expect(await panel.forget(authorization, { kingdomId: '456', personId: '123' })).toMatchObject({ http: 400 });
    expect(await panel.forget(authorization, { kingdomId: '456', personId: '123', confirm: false })).toMatchObject({ http: 400 });
    expect(await panel.forget(authorization, { kingdomId: '456', personId: '123', confirm: true, otherPersonId: '789' })).toMatchObject({ http: 400 });
    expect(await panel.forget(authorization, { kingdomId: '456', personId: '123', confirm: true })).toMatchObject({ http: 503, body: { status: 'unavailable', message: 'Forgetting is not connected yet. Nothing was erased.' } });
    expect(query).not.toHaveBeenCalled(); query.mockRestore();
    expect((await db.query('SELECT person_id FROM realm_citizen_names ORDER BY person_id')).rows).toEqual([{ person_id: '123' }, { person_id: '789' }]);
    expect((await db.query('SELECT person_id FROM realm_panel_pledges ORDER BY person_id')).rows).toEqual([{ person_id: '123' }, { person_id: '789' }]);
  });
});
