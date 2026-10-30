import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { KingdomIdSchema, PersonIdSchema, kingdomForBroadcaster, type KingdomId, type PersonId, type VoxelBlueprint } from '@chatdom/shared';
import type { RealmDomainCommand, RealmOwnedHome, RealmStoredOutcome } from '@chatdom/shared/realm';
import type { SettlementHome, SettlementPlan } from '@chatdom/world';

type PlotReservation = SettlementPlan['reservations'][number];
import { canonicalJson, sha256Hex } from '../persistence/codec';
import { RealmCommitUncertainError, RealmRecoveryError, RealmStorageUnavailableError, describeStorageFailure, type RealmDatabase } from '../persistence/database';
import type { DurableKingdom } from '../persistence/kingdom';
import { TenureEvidenceVerifier } from './evidence';
import { choosePlot, type PlotChoice, type TenurePlacement } from './placement';

/** Citizen homes one person may hold across every kingdom. A monarch's own castle is a seat, not one of them. */
export const REALM_HOME_LIMIT = 3;
/** Pending deeds installed per recovery pass; the rest wait for the next open or pass. */
const RECOVERY_BATCH = 256;
const NOW_MS = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';

type Tx = pg.PoolClient;

export interface Deed {
  readonly deedId: string;
  /** The allocation receipt a home carries. Private: it never enters a public delivery. */
  readonly receipt: string;
  readonly personId: PersonId; readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated';
  /** The revision the plot was allocated under: the home's original placement, kept through every extension. */
  readonly layoutRevision: string;
  readonly plotId: string; readonly slot: number;
  readonly placement: SettlementHome;
  readonly tenure: TenurePlacement;
  readonly status: 'pending' | 'installed' | 'void';
  readonly installedSequence: number | null;
}

export type AllocationOutcome =
  | { readonly status: 'deed'; readonly deed: Deed; readonly fresh: boolean }
  /** The person is this kingdom's monarch: the castle is their seat and does not count toward three homes. */
  | { readonly status: 'castle' }
  /** A guest light and a traveller's tent; their history keeps gathering and waits for a free place. */
  | { readonly status: 'guest'; readonly reason: 'three-homes' | 'kingdom-full' }
  | { readonly status: 'refused'; readonly reason: 'unfounded' | 'origin' };

export type LayoutAdoption =
  | { readonly status: 'founded' | 'extended' | 'unchanged'; readonly revision: string }
  | { readonly status: 'rejected'; readonly reason: 'invalid' | 'origin' | 'regenerated' | 'revision-conflict' | 'superseded' | 'moved-plot' | 'moved-street' | 'occupied-plot-changed'; readonly detail: string };

export type InstallOutcome =
  | { readonly status: 'installed'; readonly sequence: number }
  | { readonly status: 'pending'; readonly reason: string }
  | { readonly status: 'void'; readonly reason: string };

/** A deed's first home: approved content and names supplied by the content/naming services, never a fixture. */
export interface FurnishedHome {
  readonly revision: string; readonly digest: string; readonly family: 'hearth' | 'tide' | 'grove';
  readonly blueprint: VoxelBlueprint;
  readonly attribution: RealmOwnedHome['attribution'];
}
export type HomeFurnisher = (deed: Deed) => Promise<FurnishedHome>;

export interface AllocationServiceOptions {
  readonly origin: 'live' | 'simulated';
  readonly verifier: TenureEvidenceVerifier;
  /** Without a furnisher, deeds are allocated and held pending (counted, never orphaned) until one is composed. */
  readonly furnish?: HomeFurnisher;
  readonly log?: (line: string) => void;
}

export class AllocationUnavailableError extends Error {
  readonly code = 'realm.allocation-unavailable';
  constructor(detail: string) { super(detail); this.name = 'AllocationUnavailableError'; }
}

/**
 * Global citizen-home allocation and immutable founded layouts (spec 34 R6), on the realm's Postgres schema.
 *
 * Allocation is two-phase and recoverable. `allocate` locks the person, then the kingdom's layout head, and commits
 * a pending deed that already counts toward the person's three. The kingdom's fenced writer then commits
 * `home.installAllocated`; `verifyAllocation` checks the deed in that same transaction and marks it installed.
 * A crash between the two leaves a counted pending deed that `recover` installs when the kingdom next opens, so a
 * crash can neither free a slot nor create a fourth home.
 */
export class AllocationService {
  readonly origin: 'live' | 'simulated';
  private readonly verifier: TenureEvidenceVerifier;
  private readonly furnish: HomeFurnisher | undefined;

  constructor(private readonly db: RealmDatabase, private readonly options: AllocationServiceOptions) {
    this.origin = options.origin;
    if (options.verifier.origin !== options.origin) throw new TypeError('The evidence verifier must serve the same origin as the allocation service');
    this.verifier = options.verifier;
    this.furnish = options.furnish;
  }

  // Layouts ---------------------------------------------------------------------------------------------------------

  /**
   * Adopts a founded plan whole, or an extension of the current revision. An extension keeps the founding seed and
   * first year, every plot's and home's transform, and every piece of the current ground: street geometry, approach,
   * node, court, quarter, market, castle and landform. So no street, plot or occupied home can move. What it may
   * change is a home's `streetId`, the graph segment a frontage joins: a new year's frontages add junctions, and the
   * generator then splits a lane it had merged, renaming the segment without moving a single stone. Anything else is
   * an explicit rejection; an adopted revision is never overwritten.
   */
  async adoptLayout(kingdomId: KingdomId, plan: SettlementPlan): Promise<LayoutAdoption> {
    KingdomIdSchema.parse(kingdomId);
    const invalid = validatePlan(plan);
    if (invalid) return { status: 'rejected', reason: 'invalid', detail: invalid };
    const text = canonicalJson(plan), digest = sha256Hex(text);
    return this.transaction(`adopt:${plan.revision}`, async tx => {
      const now = await dbNow(tx);
      const kingdom = (await tx.query<{ origin: string }>('SELECT origin FROM realm_kingdoms WHERE kingdom_id = $1', [kingdomId])).rows[0];
      if (kingdom && kingdom.origin !== this.origin) return { status: 'rejected', reason: 'origin', detail: `kingdom ${kingdomId} is ${kingdom.origin}` };
      const founded = await tx.query(`INSERT INTO realm_layout_heads (kingdom_id, origin, revision, seed, first_year, adopted_ms, founded_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (kingdom_id) DO NOTHING`, [kingdomId, this.origin, plan.revision, plan.config.seed, plan.config.firstYear, now]);
      if (founded.rowCount === 1) {
        await insertLayout(tx, kingdomId, plan, null, text, digest, now);
        return { status: 'founded', revision: plan.revision };
      }
      const head = (await tx.query<{ origin: string; revision: string; seed: string; first_year: number }>(
        'SELECT origin, revision, seed, first_year FROM realm_layout_heads WHERE kingdom_id = $1 FOR UPDATE', [kingdomId])).rows[0]!;
      if (head.origin !== this.origin) return { status: 'rejected', reason: 'origin', detail: `kingdom ${kingdomId} has a ${head.origin} layout` };
      const known = (await tx.query<{ digest: string }>('SELECT digest FROM realm_layouts WHERE kingdom_id = $1 AND revision = $2', [kingdomId, plan.revision])).rows[0];
      if (known) {
        if (known.digest !== digest) return { status: 'rejected', reason: 'revision-conflict', detail: `revision ${plan.revision} is already adopted with other content` };
        if (plan.revision !== head.revision) return { status: 'rejected', reason: 'superseded', detail: `revision ${plan.revision} was extended by ${head.revision}` };
        return { status: 'unchanged', revision: plan.revision };
      }
      if (plan.config.seed !== head.seed || plan.config.firstYear !== head.first_year) {
        return { status: 'rejected', reason: 'regenerated', detail: 'an extension must keep the founding seed and first year' };
      }
      const current = await this.readPlan(tx, kingdomId, head.revision);
      const moved = movedPlot(current, plan);
      if (moved) return { status: 'rejected', reason: 'moved-plot', detail: moved };
      const street = movedStreet(current, plan);
      if (street) return { status: 'rejected', reason: 'moved-street', detail: street };
      // An occupied home keeps the deed's original placement exactly, whichever segment its lane is now cut into.
      const homes = new Map(plan.homes.map(home => [home.id, homeTransform(home)]));
      const occupied = await tx.query<{ plot_id: string; placement: string }>(`SELECT plot_id, placement FROM realm_deeds WHERE kingdom_id = $1 AND status <> 'void'`, [kingdomId]);
      for (const deed of occupied.rows) {
        if (homes.get(deed.plot_id) !== homeTransform(JSON.parse(deed.placement) as SettlementHome)) return { status: 'rejected', reason: 'occupied-plot-changed', detail: `occupied plot ${deed.plot_id} is missing or moved` };
      }
      await insertLayout(tx, kingdomId, plan, head.revision, text, digest, now);
      await tx.query('UPDATE realm_layout_heads SET revision = $2, adopted_ms = $3 WHERE kingdom_id = $1', [kingdomId, plan.revision, now]);
      return { status: 'extended', revision: plan.revision };
    });
  }

  /** The kingdom's current adopted revision, or null when none is founded. Rooms take their layout from here. */
  async currentLayout(kingdomId: KingdomId): Promise<{ readonly revision: string; readonly foundedAt: number; readonly adoptedAt: number } | null> {
    const row = (await this.query<{ revision: string; founded_ms: string; adopted_ms: string; origin: string }>(
      'SELECT revision, founded_ms, adopted_ms, origin FROM realm_layout_heads WHERE kingdom_id = $1', [kingdomId])).rows[0];
    if (!row || row.origin !== this.origin) return null;
    return { revision: row.revision, foundedAt: Number(row.founded_ms), adoptedAt: Number(row.adopted_ms) };
  }

  /** An adopted revision exactly as stored; a digest mismatch is a recovery error, never a regenerated plan. */
  async layoutPlan(kingdomId: KingdomId, revision: string): Promise<SettlementPlan> {
    return this.transaction('layout', tx => this.readPlan(tx, kingdomId, revision));
  }

  // Allocation ------------------------------------------------------------------------------------------------------

  /**
   * Settles a person in a kingdom, at most once. Idempotent by its natural key: asking again returns the same deed
   * (placement is set once, when you settle), the same guest status, or a deed if a place has since become free.
   * Evidence is verified before any lock; it is persisted on the deed that it placed.
   */
  async allocate(request: { readonly kingdomId: KingdomId; readonly personId: PersonId; readonly evidence: readonly unknown[] }): Promise<AllocationOutcome> {
    const kingdomId = KingdomIdSchema.parse(request.kingdomId), personId = PersonIdSchema.parse(request.personId);
    // The kingdom is the broadcaster's Twitch ID: the monarch's castle is a seat, never one of their three homes.
    if (kingdomForBroadcaster(personId) === kingdomId) return { status: 'castle' };
    const attempt = () => this.transaction(`allocate:${kingdomId}:${personId}`, async tx => {
      const now = await dbNow(tx);
      const tenure = this.verifier.verify(request.evidence, { kingdomId, personId, now });
      // Lock order: person, then the kingdom's layout head, then deed rows.
      await tx.query(`INSERT INTO realm_deed_holders (person_id, origin, citizen_deeds, updated_ms) VALUES ($1, $2, 0, $3) ON CONFLICT (person_id) DO NOTHING`, [personId, this.origin, now]);
      const holder = (await tx.query<{ origin: string; citizen_deeds: number }>('SELECT origin, citizen_deeds FROM realm_deed_holders WHERE person_id = $1 FOR UPDATE', [personId])).rows[0]!;
      if (holder.origin !== this.origin) return { status: 'refused', reason: 'origin' } as const;
      const head = (await tx.query<{ revision: string; origin: string }>('SELECT revision, origin FROM realm_layout_heads WHERE kingdom_id = $1 FOR UPDATE', [kingdomId])).rows[0];
      if (!head) return { status: 'refused', reason: 'unfounded' } as const;
      if (head.origin !== this.origin) return { status: 'refused', reason: 'origin' } as const;
      const existing = (await tx.query<DeedRow>(`SELECT ${DEED_COLUMNS} FROM realm_deeds WHERE kingdom_id = $1 AND person_id = $2 AND status <> 'void'`, [kingdomId, personId])).rows[0];
      if (existing) return { status: 'deed', deed: deedOf(existing), fresh: false } as const;
      const counted = Number((await tx.query<{ n: string }>(`SELECT count(*) AS n FROM realm_deeds WHERE person_id = $1 AND status <> 'void'`, [personId])).rows[0]!.n);
      if (counted !== holder.citizen_deeds) throw new RealmRecoveryError(kingdomId, `person ${personId} holds ${counted} deeds but is counted at ${holder.citizen_deeds}`);
      if (counted >= REALM_HOME_LIMIT) return this.guest(tx, kingdomId, personId, 'three-homes', now);

      const plots = await tx.query<{ plot_id: string; slot: number; quarter_year: number; row_id: string; ordinal: number; placement: string }>(
        'SELECT plot_id, slot, quarter_year, row_id, ordinal, placement FROM realm_layout_plots WHERE kingdom_id = $1 AND revision = $2', [kingdomId, head.revision]);
      const taken = await tx.query<{ plot_id: string }>(`SELECT plot_id FROM realm_deeds WHERE kingdom_id = $1 AND status <> 'void'`, [kingdomId]);
      const choices: PlotChoice[] = plots.rows.map(r => ({ plotId: r.plot_id, slot: r.slot, quarterYear: r.quarter_year, rowId: r.row_id, ordinal: r.ordinal }));
      const chosen = choosePlot(choices, new Set(taken.rows.map(r => r.plot_id)), tenure);
      if (!chosen) return this.guest(tx, kingdomId, personId, 'kingdom-full', now);
      const placement = plots.rows.find(r => r.plot_id === chosen.plot.plotId)!.placement;
      const deedId = randomBytes(16).toString('hex'), receipt = `deed:${randomBytes(32).toString('hex')}`;
      const row = (await tx.query<DeedRow>(`INSERT INTO realm_deeds (deed_id, receipt, person_id, kingdom_id, origin, layout_revision, plot_id, slot, placement, tenure, evidence, status, allocated_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12) RETURNING ${DEED_COLUMNS}`,
      [deedId, receipt, personId, kingdomId, this.origin, head.revision, chosen.plot.plotId, chosen.plot.slot, placement,
        canonicalJson(chosen.placement), canonicalJson(tenure.records), now])).rows[0]!;
      await tx.query('UPDATE realm_deed_holders SET citizen_deeds = citizen_deeds + 1, updated_ms = $2 WHERE person_id = $1', [personId, now]);
      await tx.query('DELETE FROM realm_guests WHERE kingdom_id = $1 AND person_id = $2', [kingdomId, personId]);
      return { status: 'deed', deed: deedOf(row), fresh: true } as const;
    });
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof RealmCommitUncertainError)) throw error;
      // The COMMIT may have landed. The natural key answers: the deed exists, or the whole attempt runs again.
      const deed = await this.deedIn(kingdomId, personId);
      return deed ? { status: 'deed', deed, fresh: true } : attempt();
    }
  }

  /** The person's non-void deed in this kingdom, if any. */
  async deedIn(kingdomId: KingdomId, personId: PersonId): Promise<Deed | null> {
    const row = (await this.query<DeedRow>(`SELECT ${DEED_COLUMNS} FROM realm_deeds WHERE kingdom_id = $1 AND person_id = $2 AND status <> 'void'`, [kingdomId, personId])).rows[0];
    return row ? deedOf(row) : null;
  }

  /** Every home a person holds, for their citizen card. At most three. */
  async deedsOf(personId: PersonId): Promise<Deed[]> {
    const rows = await this.query<DeedRow>(`SELECT ${DEED_COLUMNS} FROM realm_deeds WHERE person_id = $1 AND status <> 'void' ORDER BY allocated_ms, deed_id`, [personId]);
    return rows.rows.map(deedOf);
  }

  /** Whether the person keeps a guest light here, and why. */
  async guestIn(kingdomId: KingdomId, personId: PersonId): Promise<{ readonly reason: 'three-homes' | 'kingdom-full'; readonly since: number } | null> {
    const row = (await this.query<{ reason: 'three-homes' | 'kingdom-full'; since_ms: string }>('SELECT reason, since_ms FROM realm_guests WHERE kingdom_id = $1 AND person_id = $2', [kingdomId, personId])).rows[0];
    return row ? { reason: row.reason, since: Number(row.since_ms) } : null;
  }

  // Installation ----------------------------------------------------------------------------------------------------

  /**
   * Fixes the deed's exact install command once (furnishing its first home), so every retry and every recovery
   * sends identical bytes and the command ID can never meet a different payload.
   */
  async prepare(deed: Deed): Promise<Extract<RealmDomainCommand, { type: 'home.installAllocated' }>> {
    const stored = await this.installCommand(deed.deedId);
    if (stored) return stored;
    if (!this.furnish) throw new AllocationUnavailableError('No home furnisher is composed; the deed stays pending and counted.');
    const furnished = await this.furnish(deed);
    const problem = furnishedProblem(furnished, deed);
    if (problem) throw new AllocationUnavailableError(`The furnished home for deed ${deed.deedId} is unusable: ${problem}`);
    const home: RealmOwnedHome = { id: deed.plotId, ownerId: deed.personId, slot: deed.slot, allocationReceipt: deed.receipt, layoutRevision: deed.layoutRevision,
      revision: furnished.revision, digest: furnished.digest, family: furnished.family, blueprint: furnished.blueprint,
      attribution: { makerName: furnished.attribution.makerName, kingdomName: furnished.attribution.kingdomName, approvalId: furnished.attribution.approvalId }, attachments: {} };
    await this.query(`UPDATE realm_deeds SET install_command = $2 WHERE deed_id = $1 AND status = 'pending' AND install_command IS NULL`,
      [deed.deedId, canonicalJson({ type: 'home.installAllocated', home })]);
    const fixed = await this.installCommand(deed.deedId);
    if (!fixed) throw new AllocationUnavailableError(`Deed ${deed.deedId} is no longer pending.`);
    return fixed;
  }

  /**
   * Commits the deed's home through the kingdom's fenced writer. Committed: the deed is installed in that same
   * transaction. Refused as a conflict while still pending: the deed is voided, releasing its plot and count.
   * Anything else (cold gate, busy, storage) leaves it pending for the next attempt.
   */
  async install(kingdom: DurableKingdom, deed: Deed): Promise<InstallOutcome> {
    if (kingdom.kingdomId !== deed.kingdomId || kingdom.origin !== deed.origin) throw new TypeError(`Deed ${deed.deedId} does not belong to kingdom ${kingdom.kingdomId}`);
    if (deed.status === 'installed') return { status: 'installed', sequence: deed.installedSequence! };
    if (deed.status === 'void') return { status: 'void', reason: 'void' };
    const command = await this.prepare(deed);
    const result: RealmStoredOutcome = await kingdom.execute(installCommandId(deed), command, 'allocation',
      { actor: null, cause: { kind: 'external', source: 'allocation', id: deed.deedId } });
    if (result.status === 'committed') return { status: 'installed', sequence: result.sequence };
    if (result.reason !== 'conflict') return { status: 'pending', reason: result.reason };
    const fresh = await this.deedById(deed.deedId);
    if (fresh?.status === 'installed') return { status: 'installed', sequence: fresh.installedSequence! };
    await this.voidDeed(deed, 'install-refused');
    return { status: 'void', reason: 'install-refused' };
  }

  /** Installs this kingdom's pending deeds, oldest first. Run when the kingdom opens and after any interruption. */
  async recover(kingdom: DurableKingdom): Promise<{ readonly installed: number; readonly pending: number; readonly voided: number }> {
    const rows = await this.query<DeedRow>(`SELECT ${DEED_COLUMNS} FROM realm_deeds WHERE kingdom_id = $1 AND origin = $2 AND status = 'pending' ORDER BY allocated_ms, deed_id LIMIT $3`,
      [kingdom.kingdomId, kingdom.origin, RECOVERY_BATCH]);
    let installed = 0, pending = 0, voided = 0;
    for (const row of rows.rows) {
      if (!kingdom.current) { pending += 1; continue; }
      try {
        const outcome = await this.install(kingdom, deedOf(row));
        if (outcome.status === 'installed') installed += 1; else if (outcome.status === 'void') voided += 1; else pending += 1;
      } catch (error) {
        pending += 1;
        this.log(`deed ${row.deed_id} stays pending: ${error instanceof AllocationUnavailableError ? error.message : describeStorageFailure(error)}`);
      }
    }
    if (rows.rows.length) this.log(`kingdom ${kingdom.kingdomId} recovered deeds: ${installed} installed, ${pending} pending, ${voided} void`);
    return { installed, pending, voided };
  }

  // -----------------------------------------------------------------------------------------------------------------

  private async guest(tx: Tx, kingdomId: KingdomId, personId: PersonId, reason: 'three-homes' | 'kingdom-full', now: number): Promise<AllocationOutcome> {
    await tx.query(`INSERT INTO realm_guests (kingdom_id, person_id, reason, since_ms, updated_ms) VALUES ($1, $2, $3, $4, $4)
      ON CONFLICT (kingdom_id, person_id) DO UPDATE SET reason = excluded.reason, updated_ms = excluded.updated_ms`, [kingdomId, personId, reason, now]);
    return { status: 'guest', reason };
  }

  /** Releases a pending deed's plot and count. Same lock order as allocation: person, then deed. */
  private async voidDeed(deed: Deed, reason: string): Promise<void> {
    await this.transaction(`void:${deed.deedId}`, async tx => {
      const now = await dbNow(tx);
      await tx.query('SELECT 1 FROM realm_deed_holders WHERE person_id = $1 FOR UPDATE', [deed.personId]);
      const row = (await tx.query<{ status: string }>('SELECT status FROM realm_deeds WHERE deed_id = $1 FOR UPDATE', [deed.deedId])).rows[0];
      if (row?.status !== 'pending') return;
      await tx.query(`UPDATE realm_deeds SET status = 'void', void_reason = $2, settled_ms = $3 WHERE deed_id = $1`, [deed.deedId, reason, now]);
      await tx.query('UPDATE realm_deed_holders SET citizen_deeds = citizen_deeds - 1, updated_ms = $2 WHERE person_id = $1', [deed.personId, now]);
      this.log(`deed ${deed.deedId} in kingdom ${deed.kingdomId} void: ${reason}`);
    });
  }

  private async deedById(deedId: string): Promise<Deed | null> {
    const row = (await this.query<DeedRow>(`SELECT ${DEED_COLUMNS} FROM realm_deeds WHERE deed_id = $1`, [deedId])).rows[0];
    return row ? deedOf(row) : null;
  }

  private async installCommand(deedId: string): Promise<Extract<RealmDomainCommand, { type: 'home.installAllocated' }> | null> {
    const row = (await this.query<{ install_command: string | null }>('SELECT install_command FROM realm_deeds WHERE deed_id = $1', [deedId])).rows[0];
    return row?.install_command ? JSON.parse(row.install_command) as Extract<RealmDomainCommand, { type: 'home.installAllocated' }> : null;
  }

  private async readPlan(tx: Tx, kingdomId: KingdomId, revision: string): Promise<SettlementPlan> {
    const row = (await tx.query<{ plan: string; digest: string }>('SELECT plan, digest FROM realm_layouts WHERE kingdom_id = $1 AND revision = $2', [kingdomId, revision])).rows[0];
    if (!row) throw new RealmRecoveryError(kingdomId, `layout revision ${revision} is not adopted`);
    if (sha256Hex(row.plan) !== row.digest) throw new RealmRecoveryError(kingdomId, `layout revision ${revision} fails its digest`);
    return JSON.parse(row.plan) as SettlementPlan;
  }

  private async query<R extends pg.QueryResultRow>(sql: string, values: unknown[]): Promise<pg.QueryResult<R>> {
    try { return await this.db.query<R>(sql, values); }
    catch (error) { throw unavailable(error); }
  }

  private async transaction<T>(label: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    let tx: Tx;
    try { tx = await this.db.connect(); } catch { throw new RealmStorageUnavailableError('The realm database is unavailable.'); }
    let committing = false;
    try {
      await tx.query('BEGIN');
      const result = await work(tx);
      committing = true;
      await tx.query('COMMIT');
      committing = false;
      return result;
    } catch (error) {
      if (committing) throw new RealmCommitUncertainError('allocation', label);
      await tx.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      tx.release(committing ? true : undefined);
    }
  }

  private log(line: string) { this.options.log?.(`[realm] ${line}`); }
}

export const installCommandId = (deed: Pick<Deed, 'deedId'>) => `allocation:${deed.deedId}`;

// ---------------------------------------------------------------------------------------------------------------------

type DeedRow = { deed_id: string; receipt: string; person_id: string; kingdom_id: string; origin: 'live' | 'simulated'; layout_revision: string; plot_id: string; slot: number;
  placement: string; tenure: string; status: Deed['status']; installed_seq: string | null };
const DEED_COLUMNS = 'deed_id, receipt, person_id, kingdom_id, origin, layout_revision, plot_id, slot, placement, tenure, status, installed_seq';

function deedOf(row: DeedRow): Deed {
  return { deedId: row.deed_id, receipt: row.receipt, personId: PersonIdSchema.parse(row.person_id), kingdomId: KingdomIdSchema.parse(row.kingdom_id), origin: row.origin,
    layoutRevision: row.layout_revision, plotId: row.plot_id, slot: row.slot, placement: JSON.parse(row.placement) as SettlementHome,
    tenure: JSON.parse(row.tenure) as TenurePlacement, status: row.status, installedSequence: row.installed_seq === null ? null : Number(row.installed_seq) };
}

async function dbNow(tx: Tx): Promise<number> {
  return Number((await tx.query<{ now: string }>(`SELECT ${NOW_MS} AS now`)).rows[0]!.now);
}

async function insertLayout(tx: Tx, kingdomId: KingdomId, plan: SettlementPlan, parent: string | null, text: string, digest: string, now: number) {
  await tx.query('INSERT INTO realm_layouts (kingdom_id, revision, parent_revision, plan, digest, adopted_ms) VALUES ($1, $2, $3, $4, $5, $6)',
    [kingdomId, plan.revision, parent, text, digest, now]);
  const homes = plan.homes;
  await tx.query(`INSERT INTO realm_layout_plots (kingdom_id, revision, plot_id, slot, quarter_year, row_id, ordinal, placement)
    SELECT $1, $2, * FROM unnest($3::text[], $4::int[], $5::int[], $6::text[], $7::int[], $8::text[])`,
  [kingdomId, plan.revision, homes.map(h => h.id), homes.map(h => h.slot), homes.map(h => h.quarterYear), homes.map(h => h.streetId), homes.map(h => h.ordinal), homes.map(h => canonicalJson(h))]);
}

/** A plot's place in the world: everything but `streetId`, the merged graph segment a later year may split. */
const PLOT_KEYS = ['id', 'quarterYear', 'ordinal', 'street', 'courtId', 'approachId', 'position', 'rotation', 'lot'] as const;
const plotTransform = (plot: PlotReservation) => canonicalJson(Object.fromEntries(PLOT_KEYS.map(key => [key, plot[key]])));
/** A home's whole placement (transform, slot, tier, style, variant) without its graph segment ID. */
const homeTransform = (home: SettlementHome) => canonicalJson({ ...home, streetId: undefined });

/** The first plot or home of `current` that `next` drops or moves, or null when every one stays where it stands. */
function movedPlot(current: SettlementPlan, next: SettlementPlan): string | null {
  const reservations = new Map(next.reservations.map(plot => [plot.id, plotTransform(plot)]));
  for (const plot of current.reservations) if (reservations.get(plot.id) !== plotTransform(plot)) return `plot ${plot.id} is missing or moved`;
  const homes = new Map(next.homes.map(home => [home.id, homeTransform(home)]));
  for (const home of current.homes) if (homes.get(home.id) !== homeTransform(home)) return `home plot ${home.id} is missing or changed`;
  return null;
}

/**
 * The first piece of current ground that `next` moves or drops, or null. Public streets compare as geometry: every
 * stretch between two consecutive points of a current lane must still be paved in `next`, however the graph now
 * splits it into edges. Approaches, nodes, courts and quarter roots compare by ID; the market, castle and landform whole.
 */
function movedStreet(current: SettlementPlan, next: SettlementPlan): string | null {
  const paved = new Set(next.streets.filter(edge => edge.kind !== 'approach').flatMap(stretches));
  for (const edge of current.streets) {
    if (edge.kind === 'approach') continue;
    const missing = stretches(edge).find(stretch => !paved.has(stretch));
    if (missing) return `street ${edge.id} (${edge.name}) is moved or narrowed near ${missing}`;
  }
  const kept = <T extends { readonly id: string }>(kind: string, now: readonly T[], later: readonly T[]) => {
    const byId = new Map(later.map(item => [item.id, canonicalJson(item)]));
    const changed = now.find(item => byId.get(item.id) !== canonicalJson(item));
    return changed ? `${kind} ${changed.id} is missing or moved` : null;
  };
  // A quarter's growth edge is where the town grows next, so it follows the newest ring; its root and courts stay.
  const quarter = (plan: SettlementPlan) => plan.quarters.map(q => ({ ...q, id: String(q.year), growthNodeIds: undefined }));
  const whole = (['market', 'castle', 'landform'] as const).find(key => canonicalJson(current[key]) !== canonicalJson(next[key]));
  return kept('approach', current.streets.filter(edge => edge.kind === 'approach'), next.streets.filter(edge => edge.kind === 'approach'))
    ?? kept('node', current.nodes, next.nodes) ?? kept('court', current.courts, next.courts) ?? kept('quarter', quarter(current), quarter(next))
    ?? (whole ? `the ${whole} changed` : null);
}

/** One public street's paved stretches, each a pair of consecutive points with its width and verge. */
function stretches(edge: SettlementPlan['streets'][number]): string[] {
  return edge.points.slice(1).map((point, i) => canonicalJson([edge.kind, edge.width, edge.verge, edge.points[i]!, point]));
}

function validatePlan(plan: SettlementPlan): string | null {
  if (!plan || plan.version !== 2) return 'only version 2 settlement plans can be adopted';
  if (typeof plan.revision !== 'string' || plan.revision.length < 1 || plan.revision.length > 128) return 'the plan has no usable revision';
  if (!plan.config || typeof plan.config.seed !== 'string' || !Number.isInteger(plan.config.firstYear)) return 'the plan has no founding seed or year';
  const years = new Set(plan.quarters.map(q => q.year)), ids = new Set<string>(), slots = new Set<number>();
  const reservations = new Set(plan.reservations.map(r => r.id));
  if (plan.homes.length === 0) return 'the plan opens no home plots';
  for (const home of plan.homes) {
    if (typeof home.id !== 'string' || home.id.length < 1 || home.id.length > 128 || ids.has(home.id)) return `home plot ${String(home.id)} is not unique`;
    if (!Number.isSafeInteger(home.slot) || home.slot < 0 || slots.has(home.slot)) return `home slot ${home.slot} is not unique`;
    if (!years.has(home.quarterYear) || !reservations.has(home.id)) return `home plot ${home.id} lies outside the planned quarters`;
    ids.add(home.id); slots.add(home.slot);
  }
  return null;
}

function furnishedProblem(f: FurnishedHome, deed: Deed): string | null {
  if (!f || typeof f.revision !== 'string' || f.revision.length < 1 || f.revision.length > 128) return 'no revision';
  if (!/^[a-f0-9]{64}$/.test(f.digest)) return 'digest is not SHA-256 hex';
  if (f.family !== deed.placement.style) return `family ${f.family} does not match the plot's ${deed.placement.style} street`;
  if (!f.attribution?.approvalId || !f.attribution.makerName || !f.attribution.kingdomName) return 'names are not approved';
  if (!f.blueprint || typeof f.blueprint !== 'object') return 'no blueprint';
  return null;
}

function unavailable(error: unknown): Error {
  return error instanceof RealmStorageUnavailableError ? error : new RealmStorageUnavailableError(describeStorageFailure(error));
}
