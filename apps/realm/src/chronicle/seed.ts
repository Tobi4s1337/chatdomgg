/** Explicit private capture fixture. Never imported by runtime routes or enabled in a managed realm. */
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmCapability, RealmDomainCommand } from '@chatdom/shared/realm';
import { decideRealm } from '@chatdom/world/realm';
import { AllocationService, TenureEvidenceVerifier, type Deed } from '../allocation';
import { forgeHomeDigest } from '../wiring/forge';
import { simulatedFurnisher } from '../founded/simulated';
import { planNativeHomeGrowth } from '../growth';
import { createRealmPool } from '../persistence/database';
import { PostgresRealmRepository } from '../persistence/postgres-repository';

export async function seed(input: { readonly schema: string; readonly kingdomId: string; readonly evidenceHex: string; readonly foundedDirectory: string }) {
  if (!/^winddown_round_[a-z0-9_]+$/.test(input.schema) || input.schema.length > 63) throw new Error('Chronicle seed requires its own winddown_round_ schema.');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('The isolated Chronicle fixture requires a database.');
  const db = createRealmPool({ connectionString, schema: input.schema }), kingdomId = KingdomIdSchema.parse(input.kingdomId);
  const allocation = new AllocationService(db, { origin: 'simulated', verifier: new TenureEvidenceVerifier('simulated', Buffer.from(input.evidenceHex, 'hex')), furnish: async deed => { const furnished = await simulatedFurnisher(deed); return { ...furnished, digest: forgeHomeDigest(furnished.blueprint) }; } });
  const repository = new PostgresRealmRepository(db, { origin: 'simulated', snapshotEvery: 64 });
  let lease: Awaited<ReturnType<typeof repository.acquire>> | undefined;
  try {
    const namespace = (await db.query<{ name: string }>('SELECT current_schema() AS name')).rows[0]?.name;
    if (namespace !== input.schema) throw new Error('The Chronicle fixture database is not isolated.');
    const existing = (await db.query<{ origin: string; sequence: string }>('SELECT origin, sequence FROM realm_kingdoms WHERE kingdom_id = $1', [kingdomId])).rows[0];
    if (existing && (existing.origin !== 'simulated' || Number(existing.sequence) !== 0)) throw new Error('Chronicle fixture only seeds an untouched simulated kingdom before services start.');
    if (!await allocation.currentLayout(kingdomId)) throw new Error('Chronicle fixture requires the operator’s adopted layout.');
    lease = await repository.acquire(kingdomId); await repository.load(lease);
    let id = 0, grown = 0;
    const run = async (command: RealmDomainCommand, capability: RealmCapability) => {
      const currentLease = lease!;
      const commandId = `SIMULATED-chronicle:${++id}`;
      const result = await repository.execute(currentLease, commandId, command, (state, now) => decideRealm(state, command, {
        now, writerEpoch: currentLease.epoch, commandId, capability, current: true, anvilCapacity: 2,
        cause: { kind: 'scheduled', id: 'SIMULATED-chronicle-history' },
      }), () => true);
      if (result.status !== 'committed' && result.status !== 'unchanged') throw new Error(`SIMULATED Chronicle ${command.type} was ${result.reason}.`);
    };
    const dayMs = 86_400_000, now = Date.now(), first = Math.floor(now / dayMs) * dayMs - 43 * dayMs;
    await run({ type: 'stream.observe', sessionId: 'SIMULATED-chronicle-night:0', startedAt: first, liveUntil: Date.now() + 3_600_000 }, 'presence');
    const deeds: Deed[] = [];
    for (let citizen = 0; citizen < 3; citizen++) {
      const personId = PersonIdSchema.parse(String(990000001 + citizen));
      const outcome = await allocation.allocate({ kingdomId, personId, evidence: [] });
      if (outcome.status !== 'deed') throw new Error('A simulated citizen could not settle in the isolated Chronicle.');
      const deed = outcome.deed; deeds.push(deed);
      await run(await allocation.prepare(deed), 'allocation');
      await run({ type: 'growth.bindHome', homeId: deed.plotId, installedTier: deed.placement.tier, evidenceReceipt: deed.receipt }, 'allocation');
    }
    for (let day = 0; day < 42; day++) {
      lease = await repository.renew(lease);
      const startedAt = first + day * dayMs, sessionId = `SIMULATED-chronicle-night:${day}`;
      if (day > 0) await run({ type: 'stream.observe', sessionId, startedAt, liveUntil: Date.now() + 3_600_000 }, 'presence');
      for (const [index, deed] of deeds.entries()) {
        // One quieter citizen misses each fifth night. All credit is synthetic witnessed interval evidence.
        if (index === 2 && day % 5 === 4) continue;
        await run({ type: 'presence.confirmInterval', personId: deed.personId, streamSessionId: sessionId,
          from: startedAt, through: startedAt + 600_000, evidenceReceipt: `SIMULATED-presence:${index}:${day}` }, 'presence');
        const state = repository.committedState(lease)!;
        const plan = planNativeHomeGrowth(state, deed.plotId, deed.placement, Date.now());
        if (plan.kind === 'ready') { await run(plan.command, 'allocation'); grown++; }
      }
    }
    await run({ type: 'stream.observe', sessionId: null, startedAt: first + 41 * dayMs, liveUntil: 0 }, 'presence');
    const state = repository.committedState(lease)!;
    if (!state.growth || state.growth.civic.qualifiedDays !== 42 || grown < 1 || Object.keys(state.coals).length) throw new Error(`The simulated Chronicle witnessed ${state.growth?.civic.qualifiedDays ?? 0} days, ${grown} home constructions and ${Object.keys(state.coals).length} coal balances.`);
    await repository.snapshot(lease);
    return { label: 'SIMULATED', days: 42, citizens: deeds.length, facts: state.sequence, homeConstructions: grown, civic: state.growth.civic.levels };
  } finally { if (lease) await repository.release(lease); await db.end(); }
}
