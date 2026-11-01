import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, type KingdomId } from '@chatdom/shared';
import type { RealmWriterLease } from '@chatdom/shared/realm';
import type { PanelGiftFact, PanelGiftFriend, PanelGiftOffer, PanelGiftResult } from '../../../../../packages/shared/src/panel';
import { projectPresence } from '@chatdom/world';
import { GIFT_CATALOGUE, DEFAULT_GIFT_IDS, type GiftDefinition } from '../../../../panel/src/gifts/catalogue';
import { approvedPublicName } from '../../../../api/src/realm-auth/presentation';
import { canonicalJson, digestOf, RealmCommitUncertainError, RealmWriterFencedError,
  type DurableKingdom, type DurableRealmServices, type RealmDatabase } from '../../persistence';
import { decodeIngressCheckpoint, presencePerson } from '../codec';

type Sql = Pick<PoolClient, 'query'>;
type Origin = 'live' | 'simulated';
/** A mounted effect owns a real durable dispatch. A boolean configuration flag is not an authority. */
export interface PanelGiftEffectAuthority {
  ready(giftId: string, kingdomId: KingdomId): { readonly version: number } | null | Promise<{ readonly version: number } | null>;
  /** Append durable dispatch with this transaction. Never send/render before COMMIT or commit this client yourself. */
  append(tx: Sql, lease: RealmWriterLease, fact: PanelGiftFact): Promise<void>;
}
export interface RealmPanelGiftOptions {
  readonly db: RealmDatabase;
  readonly services: Pick<DurableRealmServices, 'retain'>;
  readonly origin: Origin;
  readonly effectAuthority?: PanelGiftEffectAuthority;
}
export type PanelGiftBody = PanelGiftResult
  | { readonly version: 1; readonly status: 'gifts'; readonly stream: 'live' | 'resting'; readonly offers: readonly PanelGiftOffer[];
      readonly friends: readonly PanelGiftFriend[]; readonly activeIntent?: { readonly intentId: string; readonly sku: string } }
  | { readonly version: 1; readonly status: 'intent'; readonly intentId: string; readonly sku: string }
  | { readonly version: 1; readonly status: 'cancelled' }
  | { readonly version: 1; readonly status: 'drained'; readonly attempted: number; readonly committed: number; readonly pending: number }
  | { readonly version: 1; readonly status: 'cursor'; readonly cursor: string | null }
  | { readonly version: 1; readonly status: 'inbox'; readonly transactionIds?: readonly string[] };
export interface PanelGiftReply { readonly http: 200 | 400 | 401 | 503; readonly body: PanelGiftBody }

const Extension = z.string().regex(/^[A-Za-z0-9]{1,128}$/);
const ProviderId = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const Sku = z.string().regex(/^[a-z0-9]{1,64}$/);
const Person = z.strictObject({ kingdomId: KingdomIdSchema, personId: PersonIdSchema });
const Intent = Person.extend({ extensionId: Extension, requestId: z.uuid(), sku: Sku, targetPlotId: TokenSchema.nullable() });
const Status = Person.extend({ intentId: z.uuid() });
const Resolve = Status.extend({ paymentRef: z.uuid() });
const Choices = Person.extend({ paymentRef: z.uuid(), cursor: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).optional() });
const ChoiceCursor = z.strictObject({ createdAt: EpochMsSchema, intentId: z.uuid() });
const Evidence = Person.extend({ extensionId: Extension, transactionId: ProviderId, sku: Sku,
  bits: z.number().int().min(0).max(10_000), inDevelopment: z.boolean(), occurredAt: EpochMsSchema,
  name: z.string().min(1).max(64), intentId: z.uuid().optional() }).refine(v => v.inDevelopment || v.bits > 0);
const Reconcile = z.strictObject({ extensionId: Extension, cursor: z.string().max(512).nullable().optional() });
const Inbox = z.strictObject({ extensionId: Extension, transactionId: ProviderId.optional() });
const Drain = z.strictObject({ extensionId: Extension });
const NOW = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
const CHECKOUT_MS = 10 * 60_000;
const FRIEND_LIMIT = 48;
const MAX_PENDING = 32;
type EvidenceInput = z.infer<typeof Evidence>;
interface IntentRow {
  intent_id: string; extension_id: string; kingdom_id: string; person_id: string; request_id: string; request_digest: string;
  sku: string; gift_id: string; effect_version: number; duration_ms: string; public_line: string;
  target_plot_id: string | null; target_slot: number | null; state: 'open' | 'cancelled' | 'paid' | 'committed';
  created_ms: string; checkout_until_ms: string;
}
interface PaymentRow {
  payment_ref: string;
  extension_id: string; transaction_id: string; kingdom_id: string; person_id: string; sku: string; evidence_digest: string;
  occurred_ms: string; public_name: string; intent_id: string | null; fact_id: string | null;
}
interface Context { sql: Sql; kingdom: DurableKingdom; lease: RealmWriterLease; now: number; current(): boolean }
interface People {
  readonly held: ReadonlySet<string>;
  readonly quiet: ReadonlySet<string>;
  readonly named: ReadonlyMap<string, { plotId: string; slot: number; name: string }>;
}
class MissingKingdom extends Error {}

/** Own gift facts share the realm writer; they never masquerade as a Twitch moment or award attendance. */
export class RealmPanelGifts {
  private pending = 0;
  constructor(private readonly options: RealmPanelGiftOptions) {}

  async gifts(raw: unknown): Promise<PanelGiftReply> {
    const parsed = Person.safeParse(raw); if (!parsed.success) return invalid();
    try {
      return await this.withKingdom(parsed.data.kingdomId, async ctx => {
        const people = await this.people(ctx, [parsed.data.personId]), live = this.live(ctx);
        const offers: PanelGiftOffer[] = [];
        if (live && !people.held.has(parsed.data.personId)) for (const gift of GIFT_CATALOGUE) {
          if (!DEFAULT_GIFT_IDS.includes(gift.id) || !await this.ready(gift.id, ctx.kingdom.kingdomId)) continue;
          offers.push({ sku: gift.bands[0].id, giftId: gift.id, title: gift.title, what: gift.what, target: gift.target, durationMs: gift.durationMs });
        }
        const friends = [...people.named.entries()].filter(([id]) => id !== parsed.data.personId)
          .map(([, p]) => ({ plotId: p.plotId, name: p.name })).sort((a, b) => a.plotId.localeCompare(b.plotId)).slice(0, FRIEND_LIMIT);
        const active = (await ctx.sql.query<{ intent_id: string; sku: string }>(`SELECT i.intent_id, i.sku FROM realm_panel_gift_intents i
          WHERE i.origin = $1 AND i.kingdom_id = $2 AND i.person_id = $3 AND (i.state IN ('open', 'paid') OR (
            NOT EXISTS (SELECT 1 FROM realm_panel_gift_transactions q WHERE q.intent_id = i.intent_id) AND EXISTS (
            SELECT 1 FROM realm_panel_gift_transactions p WHERE p.origin = i.origin AND p.extension_id = i.extension_id
            AND p.kingdom_id = i.kingdom_id AND p.person_id = i.person_id AND p.sku = i.sku AND p.intent_id IS NULL
            AND i.created_ms <= p.occurred_ms + 5000))) ORDER BY i.created_ms, i.intent_id LIMIT 1`,
        [this.options.origin, parsed.data.kingdomId, parsed.data.personId])).rows[0];
        return ok({ version: 1, status: 'gifts', stream: live ? 'live' : 'resting', offers, friends,
          ...(active ? { activeIntent: { intentId: active.intent_id, sku: active.sku } } : {}) });
      });
    } catch (error) {
      return error instanceof MissingKingdom ? ok({ version: 1, status: 'gifts', stream: 'resting', offers: [], friends: [] }) : unavailable();
    }
  }

  async intent(raw: unknown): Promise<PanelGiftReply> {
    const parsed = Intent.safeParse(raw); if (!parsed.success) return invalid();
    const input = parsed.data, requestDigest = digestOf(input);
    try {
      return await this.withKingdom(input.kingdomId, async ctx => {
        const prior = await this.requestIntent(ctx.sql, input);
        if (prior) return prior.request_digest === requestDigest ? intentReply(prior) : refused('That request already has a different gift.');
        const chosen = giftForSku(input.sku);
        if (!chosen || !DEFAULT_GIFT_IDS.includes(chosen.gift.id) || input.sku !== chosen.gift.bands[0].id) return refused('That gift is not on this shelf.');
        const ready = await this.ready(chosen.gift.id, input.kingdomId), people = await this.people(ctx, [input.personId]);
        if (!this.live(ctx) || !ready || people.held.has(input.personId)) return unavailable('This gift is not available just now.');
        const unresolved = await ctx.sql.query(`SELECT 1 FROM realm_panel_gift_intents WHERE origin = $1 AND extension_id = $2
          AND kingdom_id = $3 AND person_id = $4 AND sku = $5 AND state IN ('open', 'paid') LIMIT 1`,
        [this.options.origin, input.extensionId, input.kingdomId, input.personId, input.sku]);
        if (unresolved.rowCount) return refused('Your earlier gift is still waiting.');
        let target: { plotId: string; slot: number } | null = null;
        if (chosen.gift.target === 'none') { if (input.targetPlotId !== null) return invalid(); }
        else if (chosen.gift.target === 'self') {
          if (input.targetPlotId !== null) return invalid();
          const home = Object.values(ctx.kingdom.privateState.homes).find(home => home.ownerId === input.personId)
            ?? (ctx.kingdom.privateState.castle?.ownerId === input.personId ? ctx.kingdom.privateState.castle : null);
          if (!home) return refused('This gift needs your own home.');
          target = { plotId: home.id, slot: home.slot };
        } else {
          const candidates = [...people.named.entries()].filter(([id]) => id !== input.personId)
            .sort((a, b) => a[1].plotId.localeCompare(b[1].plotId)).slice(0, FRIEND_LIMIT);
          target = candidates.find(([, p]) => p.plotId === input.targetPlotId)?.[1] ?? null;
          if (!target) return refused('Choose a friend whose window is lit.');
        }
        const id = randomUUID();
        await ctx.sql.query(`INSERT INTO realm_panel_gift_intents
          (intent_id, origin, extension_id, kingdom_id, person_id, request_id, request_digest, sku, gift_id, effect_version,
           duration_ms, public_line, target_plot_id, target_slot, state, created_ms, checkout_until_ms, updated_ms)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'open',$15,$16,$15)`,
        [id, this.options.origin, input.extensionId, input.kingdomId, input.personId, input.requestId, requestDigest,
          input.sku, chosen.gift.id, ready.version, chosen.gift.durationMs, chosen.gift.title, target?.plotId ?? null,
          target?.slot ?? null, ctx.now, ctx.now + CHECKOUT_MS]);
        return ok({ version: 1, status: 'intent', intentId: id, sku: input.sku });
      });
    } catch (error) {
      if (error instanceof RealmCommitUncertainError) {
        const prior = await this.requestIntent(this.options.db, input).catch(() => null);
        if (prior?.request_digest === requestDigest) return intentReply(prior);
      }
      return unavailable();
    }
  }

  async status(raw: unknown): Promise<PanelGiftReply> { return this.changeIntent(raw, false); }
  async cancel(raw: unknown): Promise<PanelGiftReply> { return this.changeIntent(raw, true); }

  /** A fresh, authenticated choice after verified payment; it selects a retained target, never edits one. */
  async resolve(raw: unknown): Promise<PanelGiftReply> {
    const parsed = Resolve.safeParse(raw); if (!parsed.success) return invalid();
    const input = parsed.data;
    try {
      return await this.withKingdom(input.kingdomId, async ctx => {
        const payment = (await ctx.sql.query<PaymentRow>(`SELECT * FROM realm_panel_gift_transactions
          WHERE origin = $1 AND kingdom_id = $2 AND person_id = $3 AND payment_ref = $4 FOR UPDATE`,
        [this.options.origin, input.kingdomId, input.personId, input.paymentRef])).rows[0];
        if (!payment) return refused('That payment is not yours to resolve.');
        const intent = await this.bind(ctx, payment, input.intentId, true);
        if (!intent || intent === 'conflict') return refused('Choose one of this payment’s retained gifts.');
        return this.complete(ctx, payment, intent);
      });
    } catch (error) {
      if (error instanceof RealmCommitUncertainError) return this.status({ kingdomId: input.kingdomId, personId: input.personId, intentId: input.intentId });
      return unavailable();
    }
  }

  /** Private keyset pages keep every retained target reachable without exposing an unbounded payment history. */
  async choices(raw: unknown): Promise<PanelGiftReply> {
    const parsed = Choices.safeParse(raw); if (!parsed.success) return invalid();
    const input = parsed.data;
    let cursor: z.infer<typeof ChoiceCursor> | undefined;
    if (input.cursor) {
      try { cursor = ChoiceCursor.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
      catch { return invalid(); }
    }
    try {
      return await this.withKingdom(input.kingdomId, async ctx => {
        const payment = (await ctx.sql.query<PaymentRow>(`SELECT * FROM realm_panel_gift_transactions
          WHERE origin = $1 AND kingdom_id = $2 AND person_id = $3 AND payment_ref = $4 FOR UPDATE`,
        [this.options.origin, input.kingdomId, input.personId, input.paymentRef])).rows[0];
        if (!payment) return refused('That payment is not yours to read.');
        if (payment.intent_id) {
          const bound = await this.bind(ctx, payment);
          return bound && bound !== 'conflict' ? this.complete(ctx, payment, bound) : pending();
        }
        return this.awaitingTarget(ctx, payment, cursor);
      });
    } catch { return unavailable(); }
  }

  /** API has verified the receipt/webhook and obtained this exact canonical provider transaction. */
  async evidence(raw: unknown): Promise<PanelGiftReply> {
    const parsed = Evidence.safeParse(raw); if (!parsed.success) return invalid();
    const input = parsed.data, name = approvedPublicName(input.name);
    if (!name || name.length > 64) return invalid();
    try {
      return await this.withKingdom(input.kingdomId, async ctx => {
        if (input.occurredAt > ctx.now + 5_000) return invalid();
        const payment = await this.recordPayment(ctx.sql, input, name, ctx.now);
        if (!payment) return refused('That transaction has conflicting evidence.');
        const bound = await this.bind(ctx, payment, input.intentId);
        if (bound === 'conflict') return refused('That transaction cannot be attached to this gift.');
        return bound ? this.complete(ctx, payment, bound) : this.awaitingTarget(ctx, payment);
      });
    } catch (error) {
      // No adopted kingdom can consume this payment, but verified money must still have a durable home.
      if (error instanceof MissingKingdom) {
        try { return await this.storeUnmatched(input, name); } catch { return unavailable(); }
      }
      if (error instanceof RealmCommitUncertainError) return this.recoverPayment(input);
      return unavailable();
    }
  }

  /** Current committed public line. Disclosure is read again; a saved historic name is not current permission. */
  async latest(rawKingdomId: string): Promise<PanelGiftFact | null> {
    const kingdomId = KingdomIdSchema.parse(rawKingdomId);
    const row = (await this.options.db.query<{ fact: string; person_id: string }>(`SELECT f.fact, p.person_id
      FROM realm_panel_gift_facts f JOIN realm_panel_gift_transactions p ON p.fact_id = f.id
      WHERE f.origin = $1 AND f.kingdom_id = $2 ORDER BY f.sequence DESC LIMIT 1`, [this.options.origin, kingdomId])).rows[0];
    if (!row) return null;
    // Public reads fail closed for names if there is no current retained writer.
    try { return await this.withKingdom(kingdomId, async ctx => this.disclose(ctx, JSON.parse(row.fact) as PanelGiftFact, row.person_id)); }
    catch { return { ...JSON.parse(row.fact) as PanelGiftFact, credit: null }; }
  }

  /** Bounded committed feed for the world/stream owner. This is independent of Twitch moment and domain sequences. */
  async feed(rawKingdomId: string, afterSequence: number): Promise<{ throughSequence: number; facts: readonly PanelGiftFact[] }> {
    const kingdomId = KingdomIdSchema.parse(rawKingdomId);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new TypeError('Invalid gift cursor.');
    return this.withKingdom(kingdomId, async ctx => {
      const rows = (await ctx.sql.query<{ fact: string; person_id: string }>(`SELECT f.fact, p.person_id
        FROM realm_panel_gift_outbox o JOIN realm_panel_gift_facts f ON f.id = o.fact_id
        JOIN realm_panel_gift_transactions p ON p.fact_id = f.id
        WHERE o.origin = $1 AND o.kingdom_id = $2 AND o.sequence > $3 ORDER BY o.sequence LIMIT 64`,
      [this.options.origin, kingdomId, afterSequence])).rows;
      const people = await this.people(ctx, rows.map(row => row.person_id));
      const facts = rows.map(row => {
        const fact = JSON.parse(row.fact) as PanelGiftFact;
        return people.quiet.has(row.person_id) || people.held.has(row.person_id) ? { ...fact, credit: null } : fact;
      });
      return { throughSequence: facts.at(-1)?.sequence ?? afterSequence, facts };
    });
  }

  /** Only the API worker advances after every canonical row in the preceding page is durably accepted. */
  async reconcile(raw: unknown): Promise<PanelGiftReply> {
    const parsed = Reconcile.safeParse(raw); if (!parsed.success) return invalid();
    try {
      if ('cursor' in parsed.data) await this.options.db.query(`INSERT INTO realm_panel_gift_reconciliation (origin, extension_id, cursor, updated_ms)
        VALUES ($1,$2,$3,${NOW}) ON CONFLICT (origin, extension_id) DO UPDATE SET cursor = excluded.cursor, updated_ms = excluded.updated_ms`,
      [this.options.origin, parsed.data.extensionId, parsed.data.cursor ?? null]);
      const row = (await this.options.db.query<{ cursor: string | null }>('SELECT cursor FROM realm_panel_gift_reconciliation WHERE origin = $1 AND extension_id = $2',
        [this.options.origin, parsed.data.extensionId])).rows[0];
      return ok({ version: 1, status: 'cursor', cursor: row?.cursor ?? null });
    } catch { return unavailable(); }
  }

  /** Verified webhook acceptance only queues its transaction ID. Provider lookup happens outside the HTTP deadline. */
  async inbox(raw: unknown): Promise<PanelGiftReply> {
    const parsed = Inbox.safeParse(raw); if (!parsed.success) return invalid();
    try {
      if (parsed.data.transactionId) {
        await this.options.db.query(`INSERT INTO realm_panel_gift_inbox (origin, extension_id, transaction_id, queued_ms, done)
          VALUES ($1,$2,$3,${NOW},EXISTS (SELECT 1 FROM realm_panel_gift_transactions WHERE origin = $1 AND extension_id = $2 AND transaction_id = $3))
          ON CONFLICT (origin, extension_id, transaction_id) DO NOTHING`, [this.options.origin, parsed.data.extensionId, parsed.data.transactionId]);
        return ok({ version: 1, status: 'inbox' });
      }
      const result = await this.options.db.query<{ transaction_id: string }>(`SELECT transaction_id FROM realm_panel_gift_inbox
        WHERE origin = $1 AND extension_id = $2 AND done = false ORDER BY queued_ms, transaction_id LIMIT 50`, [this.options.origin, parsed.data.extensionId]);
      return ok({ version: 1, status: 'inbox', transactionIds: result.rows.map(row => row.transaction_id) });
    } catch { return unavailable(); }
  }

  /** Retry already verified, bound payments after the panel closes. This never asks Twitch to prove them again. */
  async drain(raw: unknown): Promise<PanelGiftReply> {
    const parsed = Drain.safeParse(raw); if (!parsed.success) return invalid();
    try {
      const rows = (await this.options.db.query<{ transaction_id: string; kingdom_id: string; person_id: string; intent_id: string }>(`
        SELECT p.transaction_id, p.kingdom_id, p.person_id, p.intent_id FROM realm_panel_gift_transactions p
        LEFT JOIN realm_panel_gift_inbox i ON i.origin = p.origin AND i.extension_id = p.extension_id AND i.transaction_id = p.transaction_id
        WHERE p.origin = $1 AND p.extension_id = $2 AND p.intent_id IS NOT NULL AND p.fact_id IS NULL
        ORDER BY coalesce(i.queued_ms, p.received_ms), p.transaction_id LIMIT 32`,
      [this.options.origin, parsed.data.extensionId])).rows;
      let committed = 0;
      for (const payment of rows) {
        // Rotate before trying the writer, including offline/busy failures. Canonical proof is already durable,
        // so this bookkeeping must never put the provider inbox back into its unverified lookup queue.
        await this.options.db.query(`INSERT INTO realm_panel_gift_inbox (origin, extension_id, transaction_id, queued_ms, done)
          VALUES ($1,$2,$3,${NOW},true) ON CONFLICT (origin, extension_id, transaction_id)
          DO UPDATE SET queued_ms = excluded.queued_ms, done = true`,
        [this.options.origin, parsed.data.extensionId, payment.transaction_id]);
        const result = await this.status({ kingdomId: payment.kingdom_id, personId: payment.person_id, intentId: payment.intent_id });
        if (result.body.status === 'delivered') committed++;
      }
      return ok({ version: 1, status: 'drained', attempted: rows.length, committed, pending: rows.length - committed });
    } catch { return unavailable(); }
  }

  private async changeIntent(raw: unknown, cancel: boolean): Promise<PanelGiftReply> {
    const parsed = Status.safeParse(raw); if (!parsed.success) return invalid();
    const input = parsed.data;
    try {
      return await this.withKingdom(input.kingdomId, async ctx => {
        const intent = (await ctx.sql.query<IntentRow>(`SELECT * FROM realm_panel_gift_intents
          WHERE origin = $1 AND kingdom_id = $2 AND person_id = $3 AND intent_id = $4 FOR UPDATE`,
        [this.options.origin, input.kingdomId, input.personId, input.intentId])).rows[0];
        if (!intent) return refused('That gift is not yours to read.');
        let payment = (await ctx.sql.query<PaymentRow>('SELECT * FROM realm_panel_gift_transactions WHERE intent_id = $1 FOR UPDATE', [intent.intent_id])).rows[0];
        if (!payment) {
          // A webhook may precede the receipt. Only a uniquely matching immutable checkout can claim it.
          const candidates = (await ctx.sql.query<PaymentRow>(`SELECT * FROM realm_panel_gift_transactions
            WHERE origin = $1 AND extension_id = $2 AND kingdom_id = $3 AND person_id = $4 AND sku = $5 AND intent_id IS NULL
            AND occurred_ms >= $6 ORDER BY occurred_ms, transaction_id LIMIT 2 FOR UPDATE`,
          [this.options.origin, intent.extension_id, intent.kingdom_id, intent.person_id, intent.sku, Number(intent.created_ms) - 5_000])).rows;
          if (candidates.length >= 1) {
            const bound = await this.bind(ctx, candidates[0]!);
            if (bound && bound !== 'conflict' && bound.intent_id === intent.intent_id) payment = candidates[0];
            else if (!bound) return this.awaitingTarget(ctx, candidates[0]!);
          }
        }
        if (payment) return this.complete(ctx, payment, intent);
        if (cancel) {
          await ctx.sql.query(`UPDATE realm_panel_gift_intents SET state = 'cancelled', updated_ms = $2 WHERE intent_id = $1 AND state = 'open'`, [intent.intent_id, ctx.now]);
          return ok({ version: 1, status: 'cancelled' });
        }
        if (intent.state === 'cancelled') return ok({ version: 1, status: 'cancelled' });
        return pending(intent.state === 'open');
      });
    } catch (error) {
      if (error instanceof RealmCommitUncertainError) {
        try {
          const row = (await this.options.db.query<{ fact: string | null; state: string }>(`SELECT f.fact, i.state FROM realm_panel_gift_intents i
            LEFT JOIN realm_panel_gift_transactions p ON p.intent_id = i.intent_id LEFT JOIN realm_panel_gift_facts f ON f.id = p.fact_id
            WHERE i.origin = $1 AND i.kingdom_id = $2 AND i.person_id = $3 AND i.intent_id = $4`,
          [this.options.origin, input.kingdomId, input.personId, input.intentId])).rows[0];
          if (row?.fact) return ok({ version: 1, status: 'delivered', fact: { ...JSON.parse(row.fact) as PanelGiftFact, credit: null } });
          if (row?.state === 'cancelled') return ok({ version: 1, status: 'cancelled' });
          if (row) return pending();
        } catch { /* Unknown commit state remains unavailable. */ }
      }
      return unavailable();
    }
  }

  private async recordPayment(sql: Sql, input: EvidenceInput, name: string, now: number): Promise<PaymentRow | null> {
    const digest = evidenceDigest(input);
    await sql.query(`INSERT INTO realm_panel_gift_transactions (origin, extension_id, transaction_id, kingdom_id, person_id,
      sku, bits, in_development, occurred_ms, public_name, evidence_digest, received_ms, payment_ref)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (origin, extension_id, transaction_id) DO NOTHING`,
    [this.options.origin, input.extensionId, input.transactionId, input.kingdomId, input.personId, input.sku, input.bits, input.inDevelopment,
      input.occurredAt, name, digest, now, randomUUID()]);
    const row = (await sql.query<PaymentRow>('SELECT * FROM realm_panel_gift_transactions WHERE origin = $1 AND extension_id = $2 AND transaction_id = $3 FOR UPDATE',
      [this.options.origin, input.extensionId, input.transactionId])).rows[0]!;
    if (row.evidence_digest !== digest) return null;
    await sql.query('UPDATE realm_panel_gift_inbox SET done = true WHERE origin = $1 AND extension_id = $2 AND transaction_id = $3',
      [this.options.origin, input.extensionId, input.transactionId]);
    return row;
  }

  private async candidates(ctx: Context, payment: PaymentRow, cursor?: z.infer<typeof ChoiceCursor>, exactId?: string): Promise<IntentRow[]> {
    // Expired/cancelled checkouts remain possible origins of a delayed Twitch confirmation. Never discard them
    // merely to make a newer target look unique; only a separate post-payment choice may resolve that uncertainty.
    return (await ctx.sql.query<IntentRow>(`SELECT i.* FROM realm_panel_gift_intents i WHERE origin = $1 AND extension_id = $2
      AND kingdom_id = $3 AND person_id = $4 AND sku = $5 AND created_ms <= $6
      AND NOT EXISTS (SELECT 1 FROM realm_panel_gift_transactions p WHERE p.intent_id = i.intent_id)
      AND ($7::bigint IS NULL OR (i.created_ms, i.intent_id) < ($7::bigint, $8::uuid))
      AND ($9::uuid IS NULL OR i.intent_id = $9::uuid)
      ORDER BY created_ms DESC, intent_id DESC LIMIT 9 FOR UPDATE`,
    [this.options.origin, payment.extension_id, payment.kingdom_id, payment.person_id, payment.sku, Number(payment.occurred_ms) + 5_000,
      cursor?.createdAt ?? null, cursor?.intentId ?? null, exactId ?? null])).rows;
  }

  private async awaitingTarget(ctx: Context, payment: PaymentRow, cursor?: z.infer<typeof ChoiceCursor>): Promise<PanelGiftReply> {
    const candidates = await this.candidates(ctx, payment, cursor);
    if (!candidates.length && !cursor) return pending();
    const people = await this.people(ctx), names = new Map([...people.named.values()].map(person => [person.plotId, person.name]));
    const last = candidates[7];
    return ok({ version: 1, status: 'awaiting-target', paymentRef: payment.payment_ref,
      nextCursor: candidates.length > 8 && last ? Buffer.from(JSON.stringify({ createdAt: Number(last.created_ms), intentId: last.intent_id })).toString('base64url') : null,
      choices: candidates.slice(0, 8).map(intent => ({ intentId: intent.intent_id, title: intent.public_line,
        targetName: intent.target_plot_id ? names.get(intent.target_plot_id) ?? null : null, createdAt: Number(intent.created_ms) })) });
  }

  private async bind(ctx: Context, payment: PaymentRow, explicit?: string, resolve = false): Promise<IntentRow | null | 'conflict'> {
    if (payment.intent_id && explicit && payment.intent_id !== explicit) return 'conflict';
    const values = [this.options.origin, payment.extension_id, payment.kingdom_id, payment.person_id, payment.sku];
    let intent: IntentRow | undefined;
    if (payment.intent_id) {
      intent = (await ctx.sql.query<IntentRow>(`SELECT * FROM realm_panel_gift_intents WHERE origin = $1 AND extension_id = $2
        AND kingdom_id = $3 AND person_id = $4 AND sku = $5 AND intent_id = $6 FOR UPDATE`, [...values, payment.intent_id])).rows[0];
      return intent ?? 'conflict';
    }
    // A receipt's optional intent ID is only a hint, not an authorization to choose between multiple checkouts.
    const candidates = await this.candidates(ctx, payment, undefined, resolve ? explicit : undefined);
    if (resolve) {
      intent = candidates.find(candidate => candidate.intent_id === explicit);
      if (!intent) return 'conflict';
    } else {
      if (candidates.length !== 1) return null;
      intent = candidates[0]!;
      if (explicit && intent.intent_id !== explicit) return 'conflict';
      if (Number(payment.occurred_ms) > Number(intent.checkout_until_ms) + 5_000) return null;
    }
    await ctx.sql.query('UPDATE realm_panel_gift_transactions SET intent_id = $4 WHERE origin = $1 AND extension_id = $2 AND transaction_id = $3',
      [this.options.origin, payment.extension_id, payment.transaction_id, intent.intent_id]);
    await ctx.sql.query(`UPDATE realm_panel_gift_intents SET state = 'paid', updated_ms = $2 WHERE intent_id = $1`, [intent.intent_id, ctx.now]);
    payment.intent_id = intent.intent_id;
    return intent;
  }

  private async complete(ctx: Context, payment: PaymentRow, intent: IntentRow): Promise<PanelGiftReply> {
    if (payment.fact_id) {
      const stored = (await ctx.sql.query<{ fact: string }>('SELECT fact FROM realm_panel_gift_facts WHERE id = $1', [payment.fact_id])).rows[0];
      if (!stored) throw new Error('Gift receipt has no committed fact.');
      return ok({ version: 1, status: 'delivered', fact: await this.disclose(ctx, JSON.parse(stored.fact) as PanelGiftFact, payment.person_id) });
    }
    const ready = await this.ready(intent.gift_id, ctx.kingdom.kingdomId);
    if (!this.live(ctx) || !ready || ready.version !== intent.effect_version || !this.options.effectAuthority) return pending();
    if (intent.target_plot_id !== null && !Object.values(ctx.kingdom.privateState.homes).some(home => home.id === intent.target_plot_id && home.slot === intent.target_slot)
      && !(ctx.kingdom.privateState.castle?.id === intent.target_plot_id && ctx.kingdom.privateState.castle.slot === intent.target_slot)) return pending();
    const people = await this.people(ctx, [payment.person_id]), owner = people.named.get(payment.person_id);
    const credit = people.quiet.has(payment.person_id) || people.held.has(payment.person_id) ? null
      : { name: payment.public_name, slot: owner?.slot ?? null };
    // An unavailable effect rolls back its dispatch and fact, but the verified payment and immutable binding survive.
    await ctx.sql.query('SAVEPOINT panel_gift_dispatch');
    try {
      await ctx.sql.query('INSERT INTO realm_panel_gift_heads (origin, kingdom_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [this.options.origin, ctx.kingdom.kingdomId]);
      const head = (await ctx.sql.query<{ sequence: string }>('UPDATE realm_panel_gift_heads SET sequence = sequence + 1 WHERE origin = $1 AND kingdom_id = $2 RETURNING sequence',
        [this.options.origin, ctx.kingdom.kingdomId])).rows[0]!;
      const sequence = Number(head.sequence); if (!Number.isSafeInteger(sequence)) throw new Error('Gift sequence exceeded its range.');
      const fact: PanelGiftFact = { version: 1, type: 'panel.gift', id: `gift:${randomUUID()}`, kingdomId: ctx.kingdom.kingdomId,
        giftId: intent.gift_id, sequence, effectVersion: ready.version, committedAt: ctx.now, endsAt: ctx.now + Number(intent.duration_ms), credit,
        target: intent.target_plot_id === null ? null : { plotId: intent.target_plot_id, slot: intent.target_slot! }, line: intent.public_line };
      const encoded = canonicalJson(fact); if (Buffer.byteLength(encoded) > 4_096) throw new Error('Gift fact exceeded its bound.');
      await ctx.sql.query('INSERT INTO realm_panel_gift_facts (id, origin, kingdom_id, sequence, writer_epoch, fact, committed_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [fact.id, this.options.origin, fact.kingdomId, sequence, ctx.lease.epoch, encoded, ctx.now]);
      await ctx.sql.query('INSERT INTO realm_panel_gift_outbox (origin, kingdom_id, sequence, fact_id) VALUES ($1,$2,$3,$4)', [this.options.origin, fact.kingdomId, sequence, fact.id]);
      await this.options.effectAuthority.append(ctx.sql, ctx.lease, fact);
      if (!ctx.current()) throw new RealmWriterFencedError(ctx.kingdom.kingdomId);
      await ctx.sql.query('UPDATE realm_panel_gift_transactions SET fact_id = $4 WHERE origin = $1 AND extension_id = $2 AND transaction_id = $3',
        [this.options.origin, payment.extension_id, payment.transaction_id, fact.id]);
      await ctx.sql.query(`UPDATE realm_panel_gift_intents SET state = 'committed', updated_ms = $2 WHERE intent_id = $1`, [intent.intent_id, ctx.now]);
      await ctx.sql.query('RELEASE SAVEPOINT panel_gift_dispatch');
      return ok({ version: 1, status: 'delivered', fact });
    } catch (error) {
      await ctx.sql.query('ROLLBACK TO SAVEPOINT panel_gift_dispatch');
      await ctx.sql.query('RELEASE SAVEPOINT panel_gift_dispatch');
      if (error instanceof RealmWriterFencedError) throw error;
      return pending();
    }
  }

  private async disclose(ctx: Context, fact: PanelGiftFact, personId: string): Promise<PanelGiftFact> {
    const people = await this.people(ctx, [personId]);
    return people.quiet.has(personId) || people.held.has(personId) ? { ...fact, credit: null } : fact;
  }
  private async ready(giftId: string, kingdomId: KingdomId): Promise<{ version: number } | null> {
    try {
      const value = await this.options.effectAuthority?.ready(giftId, kingdomId);
      return value && Number.isSafeInteger(value.version) && value.version > 0 ? value : null;
    } catch { return null; }
  }
  private live(ctx: Context): boolean { const stream = ctx.kingdom.privateState.stream; return stream.sessionId !== null && stream.liveUntil > ctx.now; }

  private async people(ctx: Context, extraPersonIds: readonly string[] = []): Promise<People> {
    const state = ctx.kingdom.privateState, homes = [...Object.values(state.homes), ...(state.castle ? [state.castle] : [])];
    const subjects = [...new Set([...homes.map(home => home.ownerId), ...extraPersonIds])];
    const quiet = new Set((await ctx.sql.query<{ person_id: string }>('SELECT person_id FROM realm_panel_privacy WHERE origin = $1 AND quiet = true AND person_id = ANY($2::text[])',
      [this.options.origin, subjects])).rows.map(row => row.person_id));
    const held = new Set(Object.entries(state.rights).filter(([, rights]) => rights.blocked).map(([id]) => id));
    const row = (await ctx.sql.query<{ revision: string; codec: string; data: Buffer }>('SELECT revision, codec, data FROM realm_ingress_checkpoints WHERE kingdom_id = $1', [ctx.kingdom.kingdomId])).rows[0];
    const named = new Map<string, { plotId: string; slot: number; name: string }>();
    if (!row) return { quiet, held, named };
    if (row.codec !== 'presence-v1') throw new Error('Unknown presence checkpoint.');
    const checkpoint = decodeIngressCheckpoint({ version: 1, revision: Number(row.revision), codec: 'presence-v1', data: new Uint8Array(row.data) }, state.kingdomId, state.origin);
    for (const bucket of checkpoint.presence.people) for (const [id, person] of bucket) if (person.restriction && (person.restriction.until === null || person.restriction.until > ctx.now)) held.add(id);
    const projected = projectPresence(checkpoint.presence, homes.map(home => ({ personId: home.ownerId, slot: home.slot })), Math.max(ctx.now, checkpoint.presence.asOf), Number(row.revision));
    const slots = new Map(projected.windows.map(window => [window.slot, window]));
    for (const home of homes) {
      const window = slots.get(home.slot);
      if (!quiet.has(home.ownerId) && !held.has(home.ownerId) && window?.present && window.publicName
        && presencePerson(checkpoint.presence, home.ownerId)?.publicName === window.publicName) named.set(home.ownerId, { plotId: home.id, slot: home.slot, name: window.publicName });
    }
    return { quiet, held, named };
  }

  private async requestIntent(sql: Sql, input: z.infer<typeof Intent>): Promise<IntentRow | undefined> {
    return (await sql.query<IntentRow>(`SELECT * FROM realm_panel_gift_intents WHERE origin = $1 AND extension_id = $2
      AND kingdom_id = $3 AND person_id = $4 AND request_id = $5`, [this.options.origin, input.extensionId, input.kingdomId, input.personId, input.requestId])).rows[0];
  }
  private async recoverPayment(input: EvidenceInput): Promise<PanelGiftReply> {
    try {
      const row = (await this.options.db.query<{ evidence_digest: string; fact: string | null }>(`SELECT p.evidence_digest, f.fact
        FROM realm_panel_gift_transactions p LEFT JOIN realm_panel_gift_facts f ON f.id = p.fact_id
        WHERE p.origin = $1 AND p.extension_id = $2 AND p.transaction_id = $3`, [this.options.origin, input.extensionId, input.transactionId])).rows[0];
      if (!row || row.evidence_digest !== evidenceDigest(input)) return unavailable();
      return row.fact ? ok({ version: 1, status: 'delivered', fact: { ...JSON.parse(row.fact) as PanelGiftFact, credit: null } }) : pending();
    } catch { return unavailable(); }
  }
  private async storeUnmatched(input: EvidenceInput, name: string): Promise<PanelGiftReply> {
    const sql = await this.options.db.connect(); let committing = false, released = false;
    try {
      await sql.query('BEGIN');
      const now = Number((await sql.query<{ now: string }>(`SELECT ${NOW} AS now`)).rows[0]!.now);
      if (input.occurredAt > now + 5_000) { await sql.query('ROLLBACK'); return invalid(); }
      const row = await this.recordPayment(sql, input, name, now);
      committing = true; await sql.query('COMMIT'); committing = false;
      return row ? pending() : refused('That transaction has conflicting evidence.');
    } catch (error) {
      if (committing) { sql.release(true); released = true; return this.recoverPayment(input); }
      await sql.query('ROLLBACK').catch(() => {}); throw error;
    } finally { if (!released) sql.release(committing ? true : undefined); }
  }

  private async withKingdom<T>(kingdomId: KingdomId, work: (ctx: Context) => Promise<T>): Promise<T> {
    if (this.pending >= MAX_PENDING) throw new Error('Gift writer queue is full.');
    this.pending++;
    try {
      const exists = await this.options.db.query('SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND origin = $2', [kingdomId, this.options.origin]);
      if (!exists.rowCount) throw new MissingKingdom();
      const hold = await this.options.services.retain(kingdomId);
      try {
        const kingdom = hold.kingdom;
        if (!kingdom.current || kingdom.origin !== this.options.origin) throw new RealmWriterFencedError(kingdomId);
        return await kingdom.writeMoments(async (lease, current) => {
          const sql = await this.options.db.connect(); let committing = false;
          try {
            await sql.query('BEGIN');
            const fence = (await sql.query<{ now: string; sequence: string; mine: boolean }>(`SELECT ${NOW} AS now, sequence,
              (writer_epoch = $2 AND lease_expires_ms > ${NOW} AND origin = $3) IS TRUE AS mine
              FROM realm_kingdoms WHERE kingdom_id = $1 FOR UPDATE`, [kingdomId, lease.epoch, this.options.origin])).rows[0];
            if (!fence?.mine || !current() || Number(fence.sequence) !== kingdom.sequence) throw new RealmWriterFencedError(kingdomId);
            const result = await work({ sql, kingdom, lease, now: Number(fence.now), current });
            const final = await sql.query(`SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND writer_epoch = $2
              AND lease_expires_ms > ${NOW} AND origin = $3 AND sequence = $4`, [kingdomId, lease.epoch, this.options.origin, fence.sequence]);
            if (final.rowCount !== 1 || !current()) throw new RealmWriterFencedError(kingdomId);
            committing = true; await sql.query('COMMIT'); committing = false;
            return result;
          } catch (error) {
            if (committing) throw new RealmCommitUncertainError(kingdomId, 'panel-gifts');
            await sql.query('ROLLBACK').catch(() => {}); throw error;
          } finally { sql.release(committing ? true : undefined); }
        });
      } finally { await hold.release(); }
    } finally { this.pending--; }
  }
}

function giftForSku(sku: string): { gift: GiftDefinition } | null {
  const gift = GIFT_CATALOGUE.find(gift => gift.bands.some(band => band.id === sku)); return gift ? { gift } : null;
}
function evidenceDigest(input: EvidenceInput): string {
  return digestOf({ extensionId: input.extensionId, transactionId: input.transactionId, kingdomId: input.kingdomId,
    personId: input.personId, sku: input.sku, bits: input.bits, inDevelopment: input.inDevelopment, occurredAt: input.occurredAt });
}
const ok = (body: PanelGiftBody): PanelGiftReply => ({ http: 200, body });
const pending = (canCancel = false): PanelGiftReply => ok({ version: 1, status: 'pending', ...(canCancel ? { canCancel: true } : {}) });
const refused = (message: string): PanelGiftReply => ({ http: 400, body: { version: 1, status: 'refused', message } });
const invalid = (): PanelGiftReply => refused('Send a valid gift request.');
const unavailable = (message = 'The gift could not be confirmed. Check its status again shortly.'): PanelGiftReply => ({ http: 503, body: { version: 1, status: 'unavailable', message } });
const intentReply = (row: IntentRow): PanelGiftReply => ok({ version: 1, status: 'intent', intentId: row.intent_id, sku: row.sku });
