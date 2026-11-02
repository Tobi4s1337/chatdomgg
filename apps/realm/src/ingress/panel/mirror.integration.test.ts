import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { DEFAULT_SETTINGS } from '../../../../panel/src/settings/schema';
import { createRealmPool, migrateRealmSchema, type RealmDatabase } from '../../persistence';
import { RealmPanelSettings } from './settings';
import { panelMirrorContent, type PanelMirrorBody } from './mirror';

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('durable panel mirror against isolated development Postgres', () => {
  const extensionId = 'testextension';
  const schema = `panel_window_test_${randomBytes(6).toString('hex')}`;
  let db: ReturnType<typeof createRealmPool>;
  let bindingId: string;
  const services = { retain: async () => { throw new Error('An unfounded settings read must not found a realm.'); } };
  const authority = () => new RealmPanelSettings({ db, services, origin: 'simulated' });
  const save = (id = '911', revision = '0', hidden = false, subject = authority()) => subject.save({ kingdomId: id, personId: id, expectedRevision: revision, settings: { ...DEFAULT_SETTINGS, hidden } });
  const claimed = (body: PanelMirrorBody) => {
    if (body.status !== 'claimed') throw new Error('Expected claim.');
    return body;
  };
  const due = () => db.query('UPDATE realm_panel_settings_mirror SET next_attempt_ms = 0, not_before_ms = 0');
  const finish = (job: ReturnType<typeof claimed>, content = panelMirrorContent(job.reading)) => authority().mirror.finish({ extensionId, bindingId, kingdomId: job.kingdomId, claimId: job.claimId, content });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5410') throw new Error('Mirror tests require development Postgres port 5410.');
    db = createRealmPool({ connectionString: url.toString(), schema });
    await migrateRealmSchema(db, schema);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE realm_panel_settings_mirror, realm_panel_settings');
    await db.query('UPDATE realm_panel_settings_mirror_quota SET next_http_ms = 0, extension_id = NULL, binding_id = NULL');
    const activation = await authority().mirror.activate({ extensionId });
    if (activation.body.status !== 'activated') throw new Error('Activation failed.');
    bindingId = activation.body.bindingId;
  });
  afterAll(async () => {
    if (db) { try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); } }
  });

  it('commits settings and its publication obligation atomically and recovers without a browser', async () => {
    const faulty = { query: db.query.bind(db), connect: async () => {
      const sql = await db.connect();
      return new Proxy(sql, { get(target, property) {
        if (property !== 'query') { const value: unknown = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; }
        return (...args: unknown[]) => {
          if (String(args[0]).startsWith('INSERT INTO realm_panel_settings_mirror')) throw new Error('Publication storage unavailable.');
          return Reflect.apply(target.query, target, args) as ReturnType<PoolClient['query']>;
        };
      } });
    } } as RealmDatabase;
    expect((await save('911', '0', false, new RealmPanelSettings({ db: faulty, services, origin: 'simulated' }))).http).toBe(503);
    expect((await db.query('SELECT 1 FROM realm_panel_settings')).rowCount).toBe(0);
    await save();
    const job = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    expect(job.reading).toMatchObject({ revision: '1', connected: false });
    expect(await authority().mirror.sync({ extensionId, kingdomId: '911' })).toMatchObject({ body: { publication: 'pending', verifiedAt: null } });
    expect(await finish(job)).toMatchObject({ body: { publication: 'verified' } });
    expect(await authority().mirror.sync({ extensionId, kingdomId: '911' })).toMatchObject({ body: { publication: 'verified', reading: job.reading } });
  });

  it('excludes competing processes, recovers expired claims, and fences their late acknowledgements', async () => {
    await save();
    const competing = await Promise.all([authority().mirror.claim({ extensionId, bindingId }), authority().mirror.claim({ extensionId, bindingId })]);
    expect(competing.map(reply => reply.body.status).sort()).toEqual(['claimed', 'idle']);
    const old = claimed(competing.find(reply => reply.body.status === 'claimed')!.body);
    await db.query('UPDATE realm_panel_settings_mirror SET lease_until_ms = 0, next_attempt_ms = 0, not_before_ms = 0');
    const replacement = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    expect(replacement.claimId).not.toBe(old.claimId);
    expect(await finish(old)).toMatchObject({ body: { publication: 'pending' } });
    expect(await authority().mirror.permit({ extensionId, bindingId, kingdomId: old.kingdomId, claimId: old.claimId })).toMatchObject({ body: { allowed: false, retryAfterMs: 0 } });
    expect(await finish(replacement)).toMatchObject({ body: { publication: 'verified' } });
  });

  it('coalesces saves while HTTP is outside the database and never acknowledges a superseded revision', async () => {
    await save();
    const first = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    // An active publication lease holds neither the world writer nor the settings row lock.
    expect(await save('911', '1', true)).toMatchObject({ body: { revision: '2', settings: { hidden: true } } });
    expect(await save('911', '2', false)).toMatchObject({ body: { revision: '3' } });
    expect(await finish(first)).toMatchObject({ body: { publication: 'pending' } });
    expect((await authority().mirror.claim({ extensionId, bindingId })).body.status).toBe('idle');
    await due();
    const latest = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    expect(latest.reading.revision).toBe('3');
    expect(await finish(latest)).toMatchObject({ body: { publication: 'verified' } });
  });

  it('persists failed retry cooldown and schedules another audit after verified success', async () => {
    await save();
    const first = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    await authority().mirror.finish({ extensionId, bindingId, kingdomId: first.kingdomId, claimId: first.claimId });
    expect((await authority().mirror.claim({ extensionId, bindingId })).body.status).toBe('idle');
    expect(await authority().mirror.sync({ extensionId, kingdomId: '911' })).toMatchObject({ body: { publication: 'pending' } });
    await due();
    const retry = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    await finish(retry);
    expect((await authority().mirror.claim({ extensionId, bindingId })).body.status).toBe('idle');
    await due();
    const audit = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    expect(audit.reading).toEqual(retry.reading);
    expect(await authority().mirror.sync({ extensionId, kingdomId: '911' })).toMatchObject({ body: { publication: 'pending' } });
    await finish(audit);
  });

  it('shares the conservative HTTP quota across channels and processes and rejects forged claims', async () => {
    await save('911'); await save('912'); await save('913');
    const a = claimed((await authority().mirror.claim({ extensionId, bindingId })).body), b = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    expect((await authority().mirror.claim({ extensionId, bindingId })).body.status).toBe('idle');
    const permissions = await Promise.all([authority().mirror.permit({ extensionId, bindingId, kingdomId: a.kingdomId, claimId: a.claimId }),
      authority().mirror.permit({ extensionId, bindingId, kingdomId: b.kingdomId, claimId: b.claimId })]);
    expect(permissions.map(result => result.body.status === 'permit' && result.body.allowed).sort()).toEqual([false, true]);
    expect(await authority().mirror.permit({ extensionId, bindingId, kingdomId: a.kingdomId, claimId: randomUUID() })).toMatchObject({ body: { allowed: false, retryAfterMs: 0 } });
    expect((await authority().mirror.claim({ kingdomId: '911' })).http).toBe(400);
    expect((await authority().mirror.finish({ extensionId, bindingId, kingdomId: '911', claimId: a.claimId, content: '🦊'.repeat(1000) })).http).toBe(400);
  });

  it('publishes a new broadcaster save before an older verified audit backlog', async () => {
    await save('911'); await save('912');
    await finish(claimed((await authority().mirror.claim({ extensionId, bindingId })).body));
    await finish(claimed((await authority().mirror.claim({ extensionId, bindingId })).body));
    // The old audit is overdue; the new save has a much later due timestamp but needs publication.
    await db.query("UPDATE realm_panel_settings_mirror SET next_attempt_ms = 1 WHERE kingdom_id = '911'");
    expect(await save('912', '1', true)).toMatchObject({ body: { revision: '2' } });
    await db.query('UPDATE realm_panel_settings_mirror SET not_before_ms = 0');
    const changed = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    expect(changed.kingdomId).toBe('912');
    expect(changed.reading).toMatchObject({ revision: '2', settings: { hidden: true } });
    await finish(changed);
    expect(claimed((await authority().mirror.claim({ extensionId, bindingId })).body).kingdomId).toBe('911');
  });

  it('fails closed on corrupt persisted preferences without starving another channel', async () => {
    await save('911'); await save('912');
    await db.query('UPDATE realm_panel_settings SET settings = $1 WHERE kingdom_id = $2', [JSON.stringify({ ...DEFAULT_SETTINGS, version: 2 }), '911']);
    expect((await authority().mirror.claim({ extensionId, bindingId })).http).toBe(503);
    expect(claimed((await authority().mirror.claim({ extensionId, bindingId })).body).kingdomId).toBe('912');
    expect((await authority().mirror.sync({ extensionId, kingdomId: '911' })).http).toBe(503);
  });

  it('rebinds every saved channel on startup and fences old applications across A to B to A changes', async () => {
    await save(); await save('912');
    const first = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    await finish(first);
    const interrupted = claimed((await authority().mirror.claim({ extensionId, bindingId })).body);
    expect(await authority().mirror.sync({ extensionId, kingdomId: '911' })).toMatchObject({ body: { publication: 'verified' } });
    const nextExtension = 'replacementextension';
    expect(await authority().mirror.sync({ extensionId: nextExtension, kingdomId: '911' })).toMatchObject({ body: { publication: 'pending', verifiedAt: null } });
    const activation = await authority().mirror.activate({ extensionId: nextExtension });
    if (activation.body.status !== 'activated') throw new Error('Activation failed.');
    const nextBinding = activation.body.bindingId;
    expect(nextBinding).not.toBe(bindingId);
    expect(await authority().mirror.activate({ extensionId: nextExtension })).toEqual(activation);
    expect(await finish(first)).toMatchObject({ body: { publication: 'pending' } });
    expect(await authority().mirror.permit({ extensionId, bindingId, kingdomId: interrupted.kingdomId, claimId: interrupted.claimId })).toMatchObject({ body: { allowed: false, retryAfterMs: 0 } });
    expect((await authority().mirror.claim({ extensionId, bindingId })).body.status).toBe('fenced');
    // Neither channel is opened again; an active old lease and future audit are both bypassed.
    const nextJobs = [];
    for (let index = 0; index < 2; index++) {
      const next = claimed((await authority().mirror.claim({ extensionId: nextExtension, bindingId: nextBinding })).body);
      nextJobs.push(next.kingdomId);
      expect(await authority().mirror.finish({ extensionId: nextExtension, bindingId: nextBinding, kingdomId: next.kingdomId, claimId: next.claimId, content: panelMirrorContent(next.reading) })).toMatchObject({ body: { publication: 'verified' } });
    }
    expect(nextJobs.sort()).toEqual(['911', '912']);
    await db.query('UPDATE realm_panel_settings_mirror SET verified_ms = 1');
    expect(await authority().mirror.sync({ extensionId: nextExtension, kingdomId: '911' })).toMatchObject({ body: { publication: 'pending', verifiedAt: null } });
    const returned = await authority().mirror.activate({ extensionId });
    if (returned.body.status !== 'activated') throw new Error('Activation failed.');
    expect(returned.body.bindingId).not.toBe(bindingId);
    expect((await authority().mirror.claim({ extensionId, bindingId })).body.status).toBe('fenced');
    expect((await authority().mirror.claim({ extensionId, bindingId: returned.body.bindingId })).body.status).toBe('claimed');
  });
});
