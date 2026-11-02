import { KingdomIdSchema, PersonIdSchema, PresenceInputSchema, type KingdomId, type PersonId, type PresenceInput } from '@chatdom/shared';
import { applyPresence, createPresenceState } from '@chatdom/world';
import type { AllocationService } from '../../allocation';
import type { TownSettler } from '../../moments/service';
import type { DurableKingdom, DurableRealmServices, RealmDatabase } from '../../persistence';
import { canonicalJson, digestOf } from '../../persistence/codec';
import { RealmRecoveryError } from '../../persistence/database';
import { decodeIngressCheckpoint, presencePerson } from '../codec';
import { presenceTransition } from '../transition';

/**
 * Quiet keeps a name off the stream: windows and credits tied to the person's home show no name (see `disclosure.ts`).
 * `applied` means the realm's public watch honours it; a realm composed without that projection says `pending`.
 * `renewal` says whether taking your place after forget can light the window again (see `CONSENT_RENEWAL`).
 */
export type PersonPrivacy = {
  readonly quiet: boolean; readonly projection: 'applied' | 'pending'; readonly forgetAvailable: boolean; readonly renewal: Renewal;
};
export type Renewal = 'applied' | 'pending';

/**
 * Whether this realm's presence contract and reducer let a person's fresh consent lift their own forget hold. The
 * shared presence schema and reducer own that rule (`work/lanes/panel-window/PW11-RENEW-NEEDS.patch`); until they
 * carry it, a forget hold stays, so the panel says the window cannot be lit again yet instead of pretending it can.
 * This is a real run of the shared schema and reducer, so it switches on by itself when they do.
 */
export const CONSENT_RENEWAL: boolean = (() => {
  const kingdomId = KingdomIdSchema.parse('1'), personId = PersonIdSchema.parse('2');
  const at = (observedAt: number, id: string) => ({ version: 1 as const, kingdomId, origin: 'simulated' as const, observedAt, id });
  const renew = PresenceInputSchema.safeParse({ ...at(2, 'probe.renew'), kind: 'restore', personId, consent: 'renewed' });
  if (!renew.success) return false;
  try {
    let state = createPresenceState(kingdomId, 'simulated');
    state = applyPresence(state, { ...at(1, 'probe.forget'), kind: 'remove', personId, reason: 'forget', until: null }, 1);
    state = applyPresence(state, renew.data, 2);
    return presencePerson(state, personId)?.restriction == null;
  } catch { return false; }
})();
export const renewalState = (): Renewal => CONSENT_RENEWAL ? 'applied' : 'pending';
type Database = Pick<RealmDatabase, 'query'>;
type Origin = 'live' | 'simulated';
const NOW_MS = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';

/** One preference per person, across all kingdoms. No provider profile or content ownership is changed. */
export async function personPrivacy(db: Database, origin: Origin, personId: PersonId, composed: { readonly projection: boolean; readonly forget: boolean }): Promise<PersonPrivacy> {
  const result = await db.query<{ quiet: boolean }>('SELECT quiet FROM realm_panel_privacy WHERE person_id = $1 AND origin = $2', [personId, origin]);
  return { quiet: result.rows[0]?.quiet ?? false, projection: composed.projection ? 'applied' : 'pending', forgetAvailable: composed.forget, renewal: renewalState() };
}

/** "Keep my name off the stream" and "!chatdom quiet" both land here; neither invents another preference. */
export async function setPersonQuiet(db: Database, origin: Origin, personId: PersonId, quiet: boolean): Promise<void> {
  await db.query(`INSERT INTO realm_panel_privacy (person_id, origin, quiet, updated_ms)
    VALUES ($1, $2, $3, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    ON CONFLICT (person_id, origin) DO UPDATE SET quiet = excluded.quiet, updated_ms = excluded.updated_ms`, [personId, origin, quiet]);
}

/** What forget erased, by kind. Each appears only when something of that kind existed. */
export type ForgottenKind = 'light' | 'name' | 'quiet' | 'pledges' | 'observations';
/** What stays, and why: it is the kingdom's own, or someone else's, or a record Twitch requires. */
export type RetainedKind = 'homes' | 'nights' | 'gifts';
export interface ForgetAnswer {
  readonly status: 'forgotten';
  readonly erased: readonly ForgottenKind[];
  readonly retained: readonly RetainedKind[];
  /** Kingdoms whose light went out now. */
  readonly kingdoms: number;
  /** Whether taking your place again can light the window again (`CONSENT_RENEWAL`). */
  readonly renewal: Renewal;
}
export interface ForgetDependencies {
  readonly db: Pick<RealmDatabase, 'query' | 'connect'>;
  readonly origin: Origin;
  readonly services: Pick<DurableRealmServices, 'retain'>;
  readonly allocation: Pick<AllocationService, 'currentLayout'>;
  /** The realm's first-chat settlement, seen through the note (`ForgetGuard`). Forget waits for what it already began. */
  readonly guard?: Pick<ForgetGuard, 'close' | 'settled'>;
}

/** In-process control observations are stamped this far behind the writer's database clock, never in its future. */
const CONTROL_LAG_MS = 500;

/**
 * "Forget me" and "!chatdom forget". One function, every kingdom of this realm's origin.
 *
 * 1. The person is noted as forgotten in this origin (`realm_panel_forgotten`), and any kingdom they had taken their
 *    place in again since an earlier forget loses that return. From that commit on, no kingdom stores anything of
 *    them, including one they first appear in afterwards: every ingress inbox insert, from any source or realm
 *    process, leaves their entry out, the realm's name store skips them (`0012f`), and first-chat settlement no
 *    longer sees them (`ForgetGuard`).
 * 2. Forget waits out every write that checked before the note: settlement this process began, and, through the
 *    shared barrier lock, any inbox or name write in flight in any process.
 * 3. Only then are the kingdoms that know the person found, so one settled in the meantime is among them. In each
 *    founded one, the light goes out through the kingdom's own writer: a presence `forget` hold clears their leases
 *    and the name the presence record carried, and keeps evidence already accepted from relighting them. Where a
 *    moderation hold already keeps them dark and nameless, that hold stays as it is.
 * 4. In one transaction: the Twitch display names the realm keeps, the quiet preference, tent pledges, and the
 *    person's part of every presence observation, settled or still waiting for the writer.
 *
 * It answers only after all four, so nothing of theirs is stored after the answer. Homes and what they made stay
 * theirs, keyed to the account so "Take your place" brings them home; the nights their light counted stay as times in
 * the kingdom's coal ledger; Bits gifts stay as the receipts Twitch requires. Other people's records are never touched:
 * a shared observation loses only this person's entry. Running it again, or after a crash part way, is safe: each step
 * is idempotent and the answer is the same kind of answer.
 */
export async function forgetPerson(deps: ForgetDependencies, input: { readonly personId: PersonId }): Promise<ForgetAnswer> {
  const personId = PersonIdSchema.parse(input.personId), { db, origin } = deps;
  // Settlement already under way finishes whole (its home and name), then forget erases what it can of it.
  const reopen = deps.guard?.close(personId);
  try {
    await deps.guard?.settled();
    await noteForgotten(db, origin, personId);
  } finally { reopen?.(); }
  await barrier(db);
  const known = await knownKingdoms(db, origin, personId);
  let kingdoms = 0, retainedNights = false;
  for (const kingdomId of known) {
    // Opening a kingdom that has no adopted layout would found it. An unfounded channel has no light to put out.
    if (!await deps.allocation.currentLayout(kingdomId)) continue;
    const hold = await deps.services.retain(kingdomId);
    try {
      const kingdom = hold.kingdom;
      current(kingdom, origin);
      const person = personIn((await readPresence(db, kingdom, origin))?.presence ?? null, personId);
      if (Object.keys(kingdom.privateState.qualification).some(key => key.startsWith(`${personId}:`))) retainedNights = true;
      const restriction = person?.restriction;
      if (restriction && restriction.reason !== 'forget' && (restriction.until === null || restriction.until > kingdom.databaseNow())) continue;
      const observedAt = Math.max(Math.floor(kingdom.databaseNow()) - CONTROL_LAG_MS, (person?.controlAt ?? -1) + 1);
      await control(kingdom, { version: 1, id: `panel.forget.${personId}.${observedAt}`, kingdomId, origin, observedAt, kind: 'remove', personId, reason: 'forget', until: null });
      kingdoms++;
    } finally { await hold.release(); }
  }

  const erased = new Set<ForgottenKind>();
  if (kingdoms) erased.add('light');
  const retained = new Set<RetainedKind>();
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const count = async (sql: string, params: unknown[]) => (await tx.query(sql, params)).rowCount ?? 0;
    if (await count('DELETE FROM realm_citizen_names WHERE person_id = $1 AND origin = $2', [personId, origin])
      + await count(`UPDATE realm_persons SET public_name = NULL, name_approval = NULL, name_approved_at = NULL
        WHERE person_id = $1 AND origin = $2 AND public_name IS NOT NULL`, [personId, origin])) erased.add('name');
    if (await count('DELETE FROM realm_panel_privacy WHERE person_id = $1 AND origin = $2', [personId, origin])) erased.add('quiet');
    if (await count('DELETE FROM realm_panel_pledges WHERE person_id = $1 AND origin = $2', [personId, origin])) erased.add('pledges');
    const rows = await tx.query<{ kingdom_id: string; source: string; observation_id: string; observation: string; settled: boolean }>(`
      SELECT i.kingdom_id, i.source, i.observation_id, i.observation, i.settled_ms IS NOT NULL AS settled
      FROM realm_ingress_inbox i JOIN realm_kingdoms k USING (kingdom_id)
      WHERE k.origin = $1 AND ${OBSERVED_IN('i.observation', '$2')} FOR UPDATE OF i`, [origin, personId]);
    for (const row of rows.rows) {
      const observation = JSON.parse(row.observation) as PresenceInput;
      if (observation.kind !== 'observe') continue;
      const people = observation.people.filter(person => person.personId !== personId);
      if (people.length === observation.people.length) continue;
      const key = [row.kingdom_id, row.source, row.observation_id];
      // A settled row is spent evidence (the receipt answers a retry), so an empty one goes. A waiting row stays for
      // the writer, without this person: it still owes the sender a receipt, and a roster still speaks for others.
      if (people.length || !row.settled) await tx.query('UPDATE realm_ingress_inbox SET observation = $4 WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3',
        [...key, canonicalJson({ ...observation, people })]);
      else await tx.query('DELETE FROM realm_ingress_inbox WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3', key);
      erased.add('observations');
    }
    if ((await tx.query(`SELECT 1 FROM realm_deeds WHERE person_id = $1 AND origin = $2 AND status <> 'void'
      UNION ALL SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND origin = $2 LIMIT 1`, [personId, origin])).rowCount) retained.add('homes');
    if ((await tx.query('SELECT 1 FROM realm_panel_gift_transactions WHERE person_id = $1 AND origin = $2 LIMIT 1', [personId, origin])).rowCount) retained.add('gifts');
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { tx.release(); }
  if (retainedNights) retained.add('nights');
  return { status: 'forgotten', erased: ORDER_ERASED.filter(kind => erased.has(kind)), retained: ORDER_RETAINED.filter(kind => retained.has(kind)), kingdoms, renewal: renewalState() };
}

/** Step 1 of forget: the person-wide note, and no kingdom keeps a return from before it. One commit. */
async function noteForgotten(db: ForgetDependencies['db'], origin: Origin, personId: PersonId): Promise<void> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    await tx.query(`INSERT INTO realm_panel_forgotten (person_id, origin, since_ms) VALUES ($1, $2, ${NOW_MS})
      ON CONFLICT (person_id, origin) DO UPDATE SET since_ms = excluded.since_ms`, [personId, origin]);
    await tx.query(`DELETE FROM realm_panel_returned r USING realm_kingdoms k
      WHERE r.kingdom_id = k.kingdom_id AND r.person_id = $1 AND k.origin = $2`, [personId, origin]);
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { tx.release(); }
}

/** Step 2: waits for every guarded write that holds the barrier lock, in any process. Taken and released at once. */
async function barrier(db: ForgetDependencies['db']): Promise<void> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('chatdom.realm.panel.forget', 0))");
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { tx.release(); }
}

/** Step 3: every kingdom of this origin that knows the person, found after the barrier so none slips past it. */
async function knownKingdoms(db: Database, origin: Origin, personId: PersonId): Promise<KingdomId[]> {
  const known = await db.query<{ kingdom_id: KingdomId }>(`
    SELECT kingdom_id FROM realm_deeds WHERE person_id = $1 AND origin = $2 AND status <> 'void'
    UNION SELECT g.kingdom_id FROM realm_guests g JOIN realm_kingdoms k USING (kingdom_id) WHERE g.person_id = $1 AND k.origin = $2
    UNION SELECT kingdom_id FROM realm_kingdoms WHERE kingdom_id = $1 AND origin = $2
    UNION SELECT DISTINCT i.kingdom_id FROM realm_ingress_inbox i JOIN realm_kingdoms k USING (kingdom_id)
      WHERE k.origin = $2 AND (${OBSERVED_IN('i.observation', '$1')} OR (strpos(i.observation, $1) > 0 AND i.observation::jsonb ->> 'personId' = $1))`, [personId, origin]);
  return known.rows.map(row => row.kingdom_id).sort((a, b) => a.localeCompare(b));
}

/**
 * The note, seen by the realm's first-chat settlement (`citizens.observe`, composed in `main.ts`): it settles and names
 * only the people a kingdom may keep. Forget waits for every settlement this guard began before its note; one that
 * begins after it reads the note. The inbox and the name store enforce the same note in the database (`0012f`).
 */
export class ForgetGuard {
  private readonly running = new Set<Promise<unknown>>();
  /** People whose forget is being noted by this process: settlement leaves them out before the note commits. */
  private readonly closing = new Map<string, number>();
  constructor(private readonly db: Database, private readonly origin: Origin) {}

  /** From now on, settlement here leaves the person out. Returns the release, called once the note has committed. */
  close(personId: PersonId): () => void {
    this.closing.set(personId, (this.closing.get(personId) ?? 0) + 1);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      const left = (this.closing.get(personId) ?? 1) - 1;
      if (left > 0) this.closing.set(personId, left); else this.closing.delete(personId);
    };
  }

  run<T>(input: PresenceInput, step: (kept: PresenceInput) => Promise<T>): Promise<T> {
    return this.track((async () => step(await this.keep(input)))());
  }

  /** The moments' settler (a follow, a reward, a shared sub), which makes no home or name for a withheld person. */
  settler(base: TownSettler): TownSettler {
    return {
      settle: (kingdom, person, tenure) => {
        const closing = this.closing.has(person.personId);
        return this.track((async () =>
          closing || await withheld(this.db, kingdom, person.personId) ? null : base.settle(kingdom, person, tenure))());
      },
    };
  }

  /** The observation without anyone this kingdom must keep nothing of. Everything else passes as it is. */
  keep(input: PresenceInput): Promise<PresenceInput> {
    if (input.kind !== 'observe' || !input.people.length) return Promise.resolve(input);
    // Read before the first await, so a settlement either sees a forget that is closing or is waited for by it.
    const closing = input.people.filter(person => this.closing.has(person.personId)).map(person => person.personId);
    return this.kept(input, closing);
  }

  private async kept(input: Extract<PresenceInput, { kind: 'observe' }>, closing: readonly string[]): Promise<PresenceInput> {
    const withheld = new Set([...closing, ...(await this.db.query<{ person_id: string }>(
      'SELECT p AS person_id FROM unnest($2::text[]) AS p WHERE realm_panel_withheld($1, p, $3)',
      [input.kingdomId, input.people.map(person => person.personId), this.origin])).rows.map(row => row.person_id)]);
    return withheld.size ? { ...input, people: input.people.filter(person => !withheld.has(person.personId)) } : input;
  }

  /** Resolves once every settlement begun so far has finished, however it ended. */
  async settled(): Promise<void> { await Promise.all([...this.running]); }

  private track<T>(task: Promise<T>): Promise<T> {
    const tracked: Promise<void> = task.then(() => {}, () => {}).finally(() => this.running.delete(tracked));
    this.running.add(tracked);
    return task;
  }
}

/** Whether this kingdom keeps nothing of the person: forgotten in its origin and not returned here. */
export async function withheld(db: Database, kingdom: Pick<DurableKingdom, 'kingdomId' | 'origin'>, personId: PersonId): Promise<boolean> {
  return (await db.query<{ withheld: boolean }>('SELECT realm_panel_withheld($1, $2, $3) AS withheld', [kingdom.kingdomId, personId, kingdom.origin])).rows[0]?.withheld === true;
}

/**
 * "Take your place" after forget: the person's fresh consent counts in this kingdom only. It never lifts a moderation
 * hold (the claim stops before this for a held person). Where a forget hold stands and the shared presence rules
 * cannot carry renewed consent yet (`CONSENT_RENEWAL`), it writes nothing, the hold stays, and the kingdom keeps
 * nothing of them. Otherwise it lifts the forget hold, if any, and records the return, so this kingdom may keep their
 * evidence and name again. Returns whether a renewal control was written.
 */
export async function renewConsent(db: Database, kingdom: DurableKingdom, personId: PersonId): Promise<boolean> {
  current(kingdom, kingdom.origin);
  const person = personIn((await readPresence(db, kingdom, kingdom.origin))?.presence ?? null, personId);
  let renewed = false;
  if (person?.restriction?.reason === 'forget') {
    if (!CONSENT_RENEWAL) return false;
    const observedAt = Math.max(Math.floor(kingdom.databaseNow()) - CONTROL_LAG_MS, person.controlAt + 1);
    // Parsed through the shared schema: the field exists only where the contract carries it.
    await control(kingdom, PresenceInputSchema.parse({ version: 1, id: `panel.renew.${personId}.${observedAt}`, kingdomId: kingdom.kingdomId,
      origin: kingdom.origin, observedAt, kind: 'restore', personId, consent: 'renewed' }));
    renewed = true;
  }
  if (await withheld(db, kingdom, personId)) {
    await db.query(`INSERT INTO realm_panel_returned (kingdom_id, person_id, since_ms) VALUES ($1, $2, ${NOW_MS}) ON CONFLICT (kingdom_id, person_id) DO NOTHING`,
      [kingdom.kingdomId, personId]);
  }
  return renewed;
}

/** Whether the person asked to be forgotten here and has not yet taken their place again. */
export function forgotten(presence: Presence | null, personId: PersonId): boolean {
  return personIn(presence, personId)?.restriction?.reason === 'forget';
}
type Presence = ReturnType<typeof decodeIngressCheckpoint>['presence'];
const personIn = (presence: Presence | null, personId: PersonId) => presence ? presencePerson(presence, personId) : undefined;

const ORDER_ERASED: readonly ForgottenKind[] = ['light', 'name', 'quiet', 'pledges', 'observations'];
const ORDER_RETAINED: readonly RetainedKind[] = ['homes', 'nights', 'gifts'];
/**
 * SQL: the observation text names `param` among its people. Stored text is canonical JSON from the inbox, or JSON the
 * forget trigger rewrote, so the match reads the JSON rather than its spelling; `strpos` only skips rows that cannot.
 */
const OBSERVED_IN = (column: string, param: string) =>
  `(strpos(${column}, ${param}) > 0 AND (${column}::jsonb -> 'people') @> jsonb_build_array(jsonb_build_object('personId', ${param}::text)))`;

async function control(kingdom: DurableKingdom, observation: PresenceInput): Promise<void> {
  const outcome = await kingdom.ingest({ source: 'panel', digest: digestOf(observation), receivedAt: observation.observedAt, observation },
    presenceTransition({ service: 'panel', observation, writerEpoch: kingdom.writerEpoch }));
  if (outcome.status === 'rejected') throw new Error(`The kingdom refused the privacy control (${outcome.reason}).`);
}
function current(kingdom: DurableKingdom, origin: Origin) {
  if (!kingdom.current || kingdom.origin !== origin) throw new Error('The privacy writer is unavailable.');
}
async function readPresence(db: Database, kingdom: DurableKingdom, origin: Origin) {
  const row = (await db.query<{ revision: string; codec: string; data: Buffer }>(
    'SELECT revision, codec, data FROM realm_ingress_checkpoints WHERE kingdom_id = $1', [kingdom.kingdomId])).rows[0];
  if (!row) return null;
  if (row.codec !== 'presence-v1') throw new RealmRecoveryError(kingdom.kingdomId, 'The presence checkpoint is unavailable.');
  return decodeIngressCheckpoint({ version: 1, revision: Number(row.revision), codec: 'presence-v1', data: new Uint8Array(row.data) }, kingdom.kingdomId, origin);
}
