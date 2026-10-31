import { randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createNativeForgeHost } from '@chatdom/forge';
import { PersonIdSchema, type PresenceInput } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as personId } from '@chatdom/shared/world-fixtures';
import type { RealmPrivateState, RealmStoredOutcome } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createRealmState } from '@chatdom/world/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { AllocationService, TenureEvidenceVerifier, type Deed } from '../allocation';
import { createDurableRealmServices, type DurableRepository, type RealmDatabase } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import { createRealmCitizens } from './citizens';

/** Controlled SIMULATED store. Production allocation, furnishing, reducer and retained registry run unchanged. */
it('recovers an interrupted native installation from durable provider names, retains one writer, and invents no history or rights', async () => {
  const now = Date.now(), origin = 'simulated' as const;
  const plan = generateSettlementPlan({ seed: 'SIMULATED-citizens', tier: 'hamlet', firstYear: 2026, year: 2026 });
  const names = new Map<string, { public_name: string; name_approval: string; observed_ms: number }>();
  const deeds: Record<string, unknown>[] = [];
  let count = 0;
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    let rows: unknown[] = [];
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) { /* SIMULATED transaction boundary */ }
    else if (sql.startsWith('SELECT floor(extract')) rows = [{ now: String(now) }];
    else if (sql.startsWith('INSERT INTO realm_citizen_names')) {
      const key = String(args[0]), observed = Number(args[4]);
      if ((names.get(key)?.observed_ms ?? -1) < observed) names.set(key, { public_name: String(args[2]), name_approval: String(args[3]), observed_ms: observed });
    } else if (sql.includes('FROM realm_citizen_names')) rows = names.has(String(args[0])) ? [names.get(String(args[0]))] : [];
    else if (sql.startsWith('INSERT INTO realm_deed_holders')) { /* counted below */ }
    else if (sql.startsWith('SELECT origin, citizen_deeds')) rows = [{ origin, citizen_deeds: count }];
    else if (sql.startsWith('SELECT revision, origin')) rows = [{ origin, revision: plan.revision }];
    else if (sql.startsWith('SELECT count(*)')) rows = [{ n: String(count) }];
    else if (sql.startsWith('SELECT plot_id, slot')) rows = plan.homes.map(home => ({ plot_id: home.id, slot: home.slot,
      quarter_year: home.quarterYear, row_id: home.streetId, ordinal: home.ordinal, placement: JSON.stringify(home) }));
    else if (sql.startsWith('SELECT plot_id FROM realm_deeds')) rows = deeds;
    else if (sql.startsWith('INSERT INTO realm_deeds ')) {
      const keys = ['deed_id', 'receipt', 'person_id', 'kingdom_id', 'origin', 'layout_revision', 'plot_id', 'slot', 'placement', 'tenure', 'evidence'];
      const deed = { ...Object.fromEntries(keys.map((key, i) => [key, args[i]])), status: 'pending', installed_seq: null, install_command: null };
      deeds.push(deed); rows = [deed];
    } else if (sql.startsWith('UPDATE realm_deed_holders SET citizen_deeds = citizen_deeds +')) count++;
    else if (sql.startsWith('DELETE FROM realm_guests')) { /* no previous guest */ }
    else if (sql.startsWith('SELECT install_command')) rows = deeds.filter(deed => deed.deed_id === args[0]);
    else if (sql.startsWith('UPDATE realm_deeds SET install_command')) {
      const deed = deeds.find(deed => deed.deed_id === args[0]);
      if (deed?.status === 'pending' && !deed.install_command) deed.install_command = args[1];
    } else if (sql.includes('FROM realm_deeds') && sql.includes("status = 'pending'")) rows = deeds.filter(deed => deed.status === 'pending');
    else if (sql.includes('FROM realm_deeds') && sql.includes('person_id = $2')) rows = deeds.filter(deed => deed.person_id === args[1]);
    else throw new Error(`Unexpected SIMULATED query: ${sql}`);
    return { rows, rowCount: rows.length };
  });
  const db = { query, connect: async () => ({ query, release() {} }) } as unknown as RealmDatabase;
  let state: RealmPrivateState = createRealmState(kingdomId, origin), interrupted = true;
  const receipts = new Map<string, RealmStoredOutcome>();
  const repository: DurableRepository = {
    leaseMs: 15_000, acquire: vi.fn(async () => ({ kingdomId, epoch: 'SIMULATED-writer', expiresAt: Date.now() + 15_000 })),
    renew: async lease => ({ ...lease, expiresAt: Date.now() + 15_000 }), load: async () => state, committedState: () => state,
    execute: async (_lease, id, command, decide, current) => {
      if (!current()) throw new Error('SIMULATED fenced');
      if (interrupted) return { status: 'rejected', reason: 'cold' };
      const previous = receipts.get(id); if (previous) return previous;
      const decision = decide(state, now);
      if (decision.kind !== 'accepted') return { status: decision.kind, reason: decision.reason };
      expect(command.type).toBe('home.installAllocated');
      if (command.type === 'home.installAllocated') {
        const deed = deeds.find(deed => deed.receipt === command.home.allocationReceipt)!;
        deed.status = 'installed'; deed.installed_seq = String(decision.state.sequence);
      }
      state = decision.state;
      const result: RealmStoredOutcome = { status: 'committed', sequence: state.sequence, at: now };
      receipts.set(id, result); return result;
    },
    lookup: async (_id, commandId) => receipts.get(commandId) ?? null,
    snapshot: async () => state.sequence, release: async () => {}, loadIngress: async () => null,
    executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }),
  };
  const outbox: RealmOutboxStore = { open: async () => 0,
    prefix: async () => ({ homes: [], presence: null, sequence: 0, committed: 0 }), read: async () => [], acknowledge: async () => {} };
  const services = createDurableRealmServices({ repository, outbox,
    auth: { authenticate: async () => { throw new Error('SIMULATED no sign-in'); }, current: async () => false },
    kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: plan.revision, spawn: () => [0, 0, 6] }) });
  const options = { db, origin, kingdomNames: new Map([[kingdomId, 'SIMULATED kingdom']]) };
  const citizens = createRealmCitizens(options);
  const allocation = new AllocationService(db, { origin, verifier: new TenureEvidenceVerifier(origin, randomBytes(32)), furnish: citizens.furnish });
  citizens.use(allocation, services);
  const hold = await services.retain(kingdomId);
  vi.spyOn(hold.kingdom, 'databaseNow').mockReturnValue(now);
  const observe: PresenceInput = { version: 1, id: 'chat:SIMULATED-person', kingdomId, origin, observedAt: now,
    kind: 'observe', source: 'chat', coverage: 'activity', people: [{ personId, disclosure: 'named', displayName: '  SIMULATED\u202e Wren  ' }] };
  try {
    await citizens.observe({ ...observe, origin: 'live' });
    expect(deeds).toHaveLength(0);
    await expect(citizens.observe(observe)).rejects.toThrow('remains pending');
    const pending = await allocation.deedIn(kingdomId, personId);
    expect(pending).toMatchObject({ status: 'pending', tenure: { followYear: null, quarter: 'unknown-newest', subscriptionStep: false } });
    expect(JSON.parse(String(deeds[0]!.evidence))).toEqual([]);
    // Simulate restart before preparation as well: erase the fixed command, retaining only the committed deed/name.
    deeds[0]!.install_command = null;
    const restarted = createRealmCitizens(options);
    const recoveredAllocation = new AllocationService(db, { origin, verifier: new TenureEvidenceVerifier(origin, randomBytes(32)), furnish: restarted.furnish });
    restarted.use(recoveredAllocation, services); interrupted = false;
    await restarted.recover(hold.kingdom);
    const installed = Object.values(state.homes)[0]!;
    expect(installed.ownerId).toBe(personId);
    expect(installed.blueprint).toEqual(createNativeForgeHost((pending as Deed).placement).blueprint);
    expect(installed.slot).toBe(pending?.slot);
    expect(installed.attribution).toEqual({ makerName: 'SIMULATED Wren', kingdomName: 'SIMULATED kingdom', approvalId: 'provider-display-name-v1' });
    await restarted.observe(observe);
    expect(state.sequence).toBe(1); expect(deeds).toHaveLength(1);
    expect(state.rights).toEqual({}); expect(state.coals).toEqual({});
    await restarted.observe({ ...observe, people: [{ personId: PersonIdSchema.parse(kingdomId), disclosure: 'named', displayName: 'SIMULATED monarch' }] });
    expect(deeds).toHaveLength(1); expect(repository.acquire).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.every(([sql]) => !sql.includes('realm_persons') && !sql.includes('realm_sessions'))).toBe(true);
  } finally { await hold.release(); }
});
