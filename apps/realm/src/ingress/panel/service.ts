import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { KingdomIdSchema, PersonIdSchema, TokenSchema, type HomeTier, type KingdomId, type KingdomPresenceFrame, type PersonId } from '@chatdom/shared';
import { projectPresence } from '@chatdom/world';
import { REALM_CASTLE_SLOT, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { TwitchMomentFactSchema, type TwitchMomentFact } from '@chatdom/shared/twitch-moments';
import { approvedPublicName, DISPLAY_NAME_APPROVAL } from '../../../../api/src/realm-auth/presentation';
import type { AllocationService, Deed } from '../../allocation';
import type { createRealmCitizens } from '../../evening/citizens';
import type { createFoundedReader } from '../../bootstrap/founded';
import type { createFoundedWorldLoader } from '../../founded';
import type { DurableKingdom, DurableRealmServices, RealmDatabase } from '../../persistence';
import { RealmRecoveryError } from '../../persistence/database';
import { decodeIngressCheckpoint, presencePerson } from '../codec';
import { IngressGate, INGRESS_SECRET_MIN } from '../gate';
import { personPrivacy, setPersonQuiet, forgetPerson, type RealmForgetAuthority, type PersonPrivacy } from './privacy';
import type { RealmPanelGifts, PanelGiftReply } from './gifts';
import type { PanelGiftFact } from '../../../../../packages/shared/src/panel';

const KingdomRequest = z.strictObject({ kingdomId: KingdomIdSchema });
const PersonRequest = KingdomRequest.extend({ personId: PersonIdSchema });
const QuietRequest = PersonRequest.extend({ quiet: z.boolean() });
const ForgetRequest = PersonRequest.extend({ confirm: z.literal(true) });
const ClaimRequest = PersonRequest.extend({ name: z.string().min(1).max(64) });
const NOW_MS = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';

/** Only bands leave the private pledge ledger; never exact counts or pledger identities. */
export type PanelPledgeBand = '0' | '1–9' | '10–24' | '25–49' | '50–99' | '100+';
export function panelPledgeBand(count: number): PanelPledgeBand {
  return count < 1 ? '0' : count < 10 ? '1–9' : count < 25 ? '10–24' : count < 50 ? '25–49' : count < 100 ? '50–99' : '100+';
}
export interface PanelClaimHome {
  readonly plotId: string; readonly street: string; readonly place: string; readonly tier: HomeTier; readonly quarterYear: number;
}
export type PanelClaimResult =
  | { readonly version: 1; readonly status: 'deed'; readonly home: PanelClaimHome }
  | { readonly version: 1; readonly status: 'guest'; readonly reason: 'three-homes' | 'kingdom-full' }
  | { readonly version: 1; readonly status: 'castle' | 'unfounded' | 'held' };
export interface PanelKingdomResult {
  readonly giftMoment: PanelGiftFact | null;
  readonly version: 1; readonly status: 'kingdom'; readonly kingdomId: KingdomId;
  readonly stream: 'live' | 'resting'; readonly lights: number; readonly presence: KingdomPresenceFrame | null;
  readonly moment: TwitchMomentFact | null; readonly revision: string; readonly manifest: RealmFoundedManifest | null;
  readonly publicEvent: PanelPublicEvent | null;
  readonly pledges: PanelPledgeBand;
}
/** A factual last-event line, with its time. It never asks a new panel to replay a historical spectacle. */
export type PanelPublicEvent = { readonly at: number; readonly cursor: number } & (
  | { readonly type: 'home'; readonly plotId: string }
  | { readonly type: 'forge'; readonly activityId: string }
  | { readonly type: 'moment'; readonly fact: TwitchMomentFact });
export type PanelDoorBody = PanelClaimResult | PanelKingdomResult | PanelGiftReply['body']
  | ({ readonly version: 1; readonly status: 'privacy' | 'quiet' } & PersonPrivacy)
  | { readonly version: 1; readonly status: 'forgotten'; readonly operationId: string; readonly erased: readonly string[]; readonly retained: readonly string[] }
  | { readonly version: 1; readonly status: 'pending'; readonly operationId: string }
  | { readonly version: 1; readonly status: 'unfounded'; readonly pledges: PanelPledgeBand }
  | { readonly version: 1; readonly status: 'pledged'; readonly band: PanelPledgeBand }
  | { readonly version: 1; readonly status: 'presence'; readonly lit: boolean; readonly stream: 'live' | 'resting'; readonly held: boolean }
  | { readonly version: 1; readonly status: 'refused' | 'unavailable'; readonly message: string };
export interface PanelDoorReply { readonly http: 200 | 400 | 401 | 503; readonly body: PanelDoorBody }
export interface RealmPanelOptions {
  readonly gifts?: RealmPanelGifts;
  readonly forgetAuthority?: RealmForgetAuthority;
  readonly db: Pick<RealmDatabase, 'query'>;
  readonly origin: 'live' | 'simulated';
  readonly secret: string | undefined;
  readonly services: Pick<DurableRealmServices, 'retain'>;
  readonly allocation: Pick<AllocationService, 'currentLayout' | 'allocate' | 'deedIn'>;
  readonly citizens: Pick<ReturnType<typeof createRealmCitizens>, 'settle'>;
  /** Existing native keep authority and guard, on this same writer. */
  readonly castle?: (kingdom: DurableKingdom, personId: PersonId, name: string) => Promise<void>;
  readonly loader?: Pick<ReturnType<typeof createFoundedWorldLoader>, 'current'>;
  readonly founded?: Pick<ReturnType<typeof createFoundedReader>, 'manifest' | 'scene'>;
}

/** Trusted API door. Identity and the provider-approved public name come from its verified Extension JWT and Helix. */
export class RealmPanelService {
  private readonly gate: IngressGate;
  constructor(private readonly options: RealmPanelOptions) {
    if (options.secret !== undefined && options.secret.length < INGRESS_SECRET_MIN) throw new Error('REALM_INGRESS_PANEL_SECRET must be at least 32 characters.');
    this.gate = new IngressGate(options.secret ? { panel: options.secret } : {}, options.origin);
  }
  authenticate(authorization: string): boolean { return this.gate.authenticate(authorization) === 'panel'; }

  private async gift(authorization: string, raw: unknown, method: 'gifts' | 'intent' | 'status' | 'cancel' | 'resolve' | 'choices' | 'evidence' | 'reconcile' | 'inbox' | 'drain'): Promise<PanelDoorReply> {
    if (!this.authenticate(authorization)) return unauthorized();
    return this.options.gifts ? this.options.gifts[method](raw) : unavailable();
  }
  gifts(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'gifts'); }
  giftIntent(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'intent'); }
  giftStatus(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'status'); }
  giftCancel(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'cancel'); }
  giftEvidence(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'evidence'); }
  giftReconcile(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'reconcile'); }
  giftInbox(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'inbox'); }
  giftDrain(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'drain'); }
  giftChoices(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'choices'); }
  giftResolve(authorization: string, raw: unknown) { return this.gift(authorization, raw, 'resolve'); }

  async claim(authorization: string, raw: unknown): Promise<PanelDoorReply> {
    if (!this.authenticate(authorization)) return unauthorized();
    const request = ClaimRequest.safeParse(raw);
    if (!request.success) return invalid();
    const { kingdomId, personId } = request.data, name = approvedPublicName(request.data.name);
    if (!name || name.length > 64) return invalid();
    try {
      // Check the authoritative layout before retaining: opening a missing kingdom must never found one.
      if (!await this.options.allocation.currentLayout(kingdomId)) return ok({ version: 1, status: 'unfounded' });
      const hold = await this.options.services.retain(kingdomId);
      try {
        const kingdom = hold.kingdom;
        this.assertCurrent(kingdom);
        if (await this.held(kingdom, personId)) return ok({ version: 1, status: 'held' });
        // The castle is already the broadcaster's seat. It must never enter street allocation or the cap.
        if (String(kingdomId) === String(personId)) {
          // `citizens.settle` excludes the monarch before its provider-name write. The existing keep guard needs
          // this same authenticated provider evidence, so record it here without pretending it was chat or sign-in.
          await this.options.db.query(`INSERT INTO realm_citizen_names AS n (person_id, origin, public_name, name_approval, observed_ms)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT (person_id, origin) DO UPDATE
            SET public_name = excluded.public_name, name_approval = excluded.name_approval, observed_ms = excluded.observed_ms
            WHERE n.observed_ms < excluded.observed_ms`, [personId, this.options.origin, name, DISPLAY_NAME_APPROVAL, Math.floor(kingdom.databaseNow())]);
          await this.options.castle?.(kingdom, personId, name);
          this.assertCurrent(kingdom);
          if (!kingdom.privateState.castle || kingdom.privateState.castle.ownerId !== personId) return unavailable();
          return ok({ version: 1, status: 'castle' });
        }
        await this.options.citizens.settle(kingdom, { personId, name }, {});
        this.assertCurrent(kingdom);
        if (await this.held(kingdom, personId)) return ok({ version: 1, status: 'held' });
        // `settle` deliberately returns null for guests and refusals. The existing allocator owns their distinction.
        const result = await this.options.allocation.allocate({ kingdomId, personId, evidence: [] });
        this.assertCurrent(kingdom);
        if (result.status === 'deed') {
          // Never turn a counted but interrupted pending deed into a successful claim.
          const deed = await this.options.allocation.deedIn(kingdomId, personId);
          if (!deed || deed.status !== 'installed' || deed.origin !== this.options.origin) return unavailable();
          return ok({ version: 1, status: 'deed', home: homeOf(deed) });
        }
        if (result.status === 'guest') return ok({ version: 1, status: 'guest', reason: result.reason });
        if (result.status === 'castle') return ok({ version: 1, status: 'castle' });
        return result.reason === 'unfounded' ? ok({ version: 1, status: 'unfounded' }) : unavailable();
      } finally { await hold.release(); }
    } catch { return unavailable(); }
  }

  async pledge(authorization: string, raw: unknown): Promise<PanelDoorReply> {
    if (!this.authenticate(authorization)) return unauthorized();
    const request = PersonRequest.safeParse(raw);
    if (!request.success) return invalid();
    const { kingdomId, personId } = request.data;
    try {
      await this.options.db.query(`INSERT INTO realm_panel_pledges (kingdom_id, person_id, origin, pledged_ms)
        VALUES ($1, $2, $3, ${NOW_MS}) ON CONFLICT (kingdom_id, person_id, origin) DO NOTHING`, [kingdomId, personId, this.options.origin]);
      return ok({ version: 1, status: 'pledged', band: await this.pledges(kingdomId) });
    } catch { return unavailable(); }
  }

  async privacy(authorization: string, raw: unknown): Promise<PanelDoorReply> {
    if (!this.authenticate(authorization)) return unauthorized();
    const request = PersonRequest.safeParse(raw);
    if (!request.success) return invalid();
    try { return ok({ version: 1, status: 'privacy', ...await personPrivacy(this.options.db, this.options.origin, request.data.personId, !!this.options.forgetAuthority) }); }
    catch { return unavailable(); }
  }

  async quiet(authorization: string, raw: unknown): Promise<PanelDoorReply> {
    if (!this.authenticate(authorization)) return unauthorized();
    const request = QuietRequest.safeParse(raw);
    if (!request.success) return invalid();
    try {
      await setPersonQuiet(this.options.db, this.options.origin, request.data.personId, request.data.quiet);
      return ok({ version: 1, status: 'quiet', ...await personPrivacy(this.options.db, this.options.origin, request.data.personId, !!this.options.forgetAuthority) });
    } catch { return unavailable(); }
  }

  async forget(authorization: string, raw: unknown): Promise<PanelDoorReply> {
    if (!this.authenticate(authorization)) return unauthorized();
    const request = ForgetRequest.safeParse(raw);
    if (!request.success) return invalid();
    try {
      const answer = await forgetPerson(this.options.forgetAuthority, { personId: request.data.personId,
        requestedFromKingdomId: request.data.kingdomId, origin: this.options.origin, requestId: randomUUID() });
      if (answer.status === 'unavailable') return { http: 503, body: { version: 1, status: 'unavailable', message: 'Forgetting is not connected yet. Nothing was erased.' } };
      return answer.status === 'pending' ? ok({ version: 1, status: 'pending', operationId: answer.operationId }) : ok({ version: 1, ...answer });
    } catch { return unavailable(); }
  }

  async presence(authorization: string, raw: unknown): Promise<PanelDoorReply> {
    if (!this.authenticate(authorization)) return unauthorized();
    const request = PersonRequest.safeParse(raw);
    if (!request.success) return invalid();
    const { kingdomId, personId } = request.data;
    try {
      if (!await this.options.allocation.currentLayout(kingdomId)) return ok({ version: 1, status: 'unfounded' });
      const hold = await this.options.services.retain(kingdomId);
      try {
        const kingdom = hold.kingdom;
        this.assertCurrent(kingdom);
        const checkpoint = await this.readPresence(kingdom);
        const publicCheckpoint = await kingdom.preparePublicCheckpoint();
        const frame = publicCheckpoint.current.find(message => message.type === 'presence')?.frame;
        const state = kingdom.privateState, now = kingdom.databaseNow();
        const stream = state.stream.sessionId && state.stream.liveUntil > now ? 'live' : 'resting';
        const held = !!state.rights[personId]?.blocked || this.restricted(checkpoint, personId, now);
        const home = Object.values(state.homes).find(home => home.ownerId === personId);
        const slot = state.castle?.ownerId === personId ? REALM_CASTLE_SLOT : home?.slot;
        const projected = checkpoint && slot !== undefined
          ? projectPresence(checkpoint.presence, [{ personId, slot }], now, frame?.sequence ?? 0) : null;
        this.assertCurrent(kingdom);
        const lit = !held && stream === 'live' && slot !== undefined && !!projected?.windows[0]?.present
          && !!frame?.windows.some(window => window.slot === slot && window.present);
        return ok({ version: 1, status: 'presence', lit, stream, held });
      } finally { await hold.release(); }
    } catch { return unavailable(); }
  }

  async kingdom(authorization: string, raw: unknown): Promise<PanelDoorReply> {
    if (!this.authenticate(authorization)) return unauthorized();
    const request = KingdomRequest.safeParse(raw);
    if (!request.success) return invalid();
    const { kingdomId } = request.data;
    try {
      const pledges = await this.pledges(kingdomId);
      if (!await this.options.allocation.currentLayout(kingdomId)) return ok({ version: 1, status: 'unfounded', pledges });
      const hold = await this.options.services.retain(kingdomId);
      try {
        const kingdom = hold.kingdom;
        this.assertCurrent(kingdom);
        const checkpoint = await kingdom.preparePublicCheckpoint();
        const prepared = this.options.loader?.current(kingdomId), manifest = prepared?.manifestFor(checkpoint) ?? null;
        if (this.options.loader && (!manifest || kingdom.world !== prepared?.world)) return unavailable();
        const committedPresence = checkpoint.current.find(message => message.type === 'presence')?.frame ?? null;
        const presence = committedPresence ? await this.currentPublicPresence(kingdom, committedPresence) : null;
        const [moments, events] = await Promise.all([
          this.options.db.query<{ message: string }>(`SELECT message FROM realm_outbox
            WHERE kingdom_id = $1 AND kind = 'moment' AND id <= $2 ORDER BY id DESC LIMIT 1`, [kingdomId, checkpoint.throughCursor]),
          this.options.db.query<PublicEventRow>(`SELECT id, created_ms, message FROM realm_outbox
            WHERE kingdom_id = $1 AND id <= $2 AND (kind IN ('home', 'moment')
              OR (kind = 'forge' AND message::jsonb->'event'->>'type' = 'committed'))
            ORDER BY id DESC LIMIT 1`, [kingdomId, checkpoint.throughCursor]),
        ]);
        const latest = moments.rows[0];
        let moment: TwitchMomentFact | null = null;
        if (latest) {
          const message = JSON.parse(latest.message) as { type?: string; fact?: unknown };
          const parsed = TwitchMomentFactSchema.safeParse(message.fact);
          if (message.type !== 'moment' || !parsed.success || parsed.data.kingdomId !== kingdomId || parsed.data.origin !== this.options.origin) {
            throw new RealmRecoveryError(kingdomId, 'The latest public moment is invalid.');
          }
          moment = parsed.data;
        }
        this.assertCurrent(kingdom);
        const now = kingdom.databaseNow(), stream = kingdom.privateState.stream;
        const giftMoment = await this.options.gifts?.latest(kingdomId) ?? null;
        return ok({ version: 1, status: 'kingdom', kingdomId, pledges, manifest, giftMoment,
          stream: stream.sessionId && stream.liveUntil > now ? 'live' : 'resting',
          // These are the committed public windows, never extension connections or local client counts.
          lights: presence?.windows.filter(window => window.present).length ?? 0, presence, moment,
          publicEvent: events.rows[0] ? publicEventOf(events.rows[0], kingdomId, this.options.origin) : null,
          revision: `${manifest?.sceneHash ?? checkpoint.layoutRevision}:${checkpoint.throughSequence}:${checkpoint.throughCursor}` });
      } finally { await hold.release(); }
    } catch { return unavailable(); }
  }

  /** Exact bytes from the existing approved-scene reader; an old public hash is not permission to see withdrawn art. */
  async scene(authorization: string, rawKingdomId: string): Promise<Uint8Array | PanelDoorReply> {
    if (!this.authenticate(authorization)) return unauthorized();
    const kingdomId = KingdomIdSchema.safeParse(rawKingdomId);
    if (!kingdomId.success) return invalid();
    if (!this.options.founded) return unavailable();
    try {
      const request = { authorization, cookie: '', origin: '' };
      const manifest = await this.options.founded.manifest(kingdomId.data, request);
      return await this.options.founded.scene(manifest.sceneHash, request);
    } catch { return unavailable(); }
  }

  /** Read-time disclosure may remove expired light or a quiet name; it never invents a committed window. */
  private async currentPublicPresence(kingdom: DurableKingdom, frame: KingdomPresenceFrame): Promise<KingdomPresenceFrame> {
    const checkpoint = await this.readPresence(kingdom);
    if (!checkpoint) throw new RealmRecoveryError(kingdom.kingdomId, 'Public presence has no private evidence.');
    const state = kingdom.privateState;
    const bindings = Object.values(state.homes).filter(home => home.ownerId !== state.castle?.ownerId).map(home => ({ personId: home.ownerId, slot: home.slot }));
    if (state.castle) bindings.push({ personId: state.castle.ownerId, slot: REALM_CASTLE_SLOT });
    const projected = projectPresence(checkpoint.presence, bindings, kingdom.databaseNow(), frame.sequence, frame.epoch);
    const quiet = new Set((await this.options.db.query<{ person_id: string }>('SELECT person_id FROM realm_panel_privacy WHERE origin = $1 AND quiet = true AND person_id = ANY($2::text[])',
      [this.options.origin, bindings.map(binding => binding.personId)])).rows.map(row => row.person_id));
    const quietSlots = new Set(bindings.filter(binding => quiet.has(binding.personId)).map(binding => binding.slot));
    const bySlot = new Map(projected.windows.map(window => [window.slot, window]));
    return { ...frame, streamLive: frame.streamLive && projected.streamLive,
      connection: projected.streamLive ? frame.connection : projected.connection,
      windows: frame.windows.map(window => {
        const current = bySlot.get(window.slot), present = window.present && current?.present === true;
        return { ...window, present, publicName: present && !quietSlots.has(window.slot) && current?.publicName === window.publicName ? window.publicName : null };
      }) };
  }

  private assertCurrent(kingdom: DurableKingdom): void {
    if (!kingdom.current || kingdom.origin !== this.options.origin) throw new Error('The panel writer is unavailable.');
  }
  private async held(kingdom: DurableKingdom, personId: PersonId): Promise<boolean> {
    if (kingdom.privateState.rights[personId]?.blocked) return true;
    return this.restricted(await this.readPresence(kingdom), personId, kingdom.databaseNow());
  }
  private restricted(checkpoint: ReturnType<typeof decodeIngressCheckpoint> | null, personId: PersonId, now: number): boolean {
    const restriction = checkpoint && presencePerson(checkpoint.presence, personId)?.restriction;
    return !!restriction && (restriction.until === null || restriction.until > now);
  }
  private async readPresence(kingdom: DurableKingdom): Promise<ReturnType<typeof decodeIngressCheckpoint> | null> {
    const row = (await this.options.db.query<{ revision: string; codec: string; data: Buffer }>(
      'SELECT revision, codec, data FROM realm_ingress_checkpoints WHERE kingdom_id = $1', [kingdom.kingdomId])).rows[0];
    if (!row) return null;
    if (row.codec !== 'presence-v1') throw new RealmRecoveryError(kingdom.kingdomId, 'The presence checkpoint is unavailable.');
    return decodeIngressCheckpoint({ version: 1, revision: Number(row.revision), codec: 'presence-v1', data: new Uint8Array(row.data) }, kingdom.kingdomId, this.options.origin);
  }
  private async pledges(kingdomId: KingdomId): Promise<PanelPledgeBand> {
    const row = (await this.options.db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM realm_panel_pledges WHERE kingdom_id = $1 AND origin = $2', [kingdomId, this.options.origin])).rows[0];
    if (!row || !/^\d+$/.test(row.n)) throw new Error('The pledge count is unavailable.');
    return panelPledgeBand(Number(row.n));
  }
}

function homeOf(deed: Deed): PanelClaimHome {
  const p = deed.placement, number = p.ordinal + 1;
  return { plotId: deed.plotId, street: p.street, place: `Number ${number} on ${p.street}, in the ${p.quarterYear} quarter`, tier: p.tier, quarterYear: p.quarterYear };
}
interface PublicEventRow { readonly id: string; readonly created_ms: string; readonly message: string }
const HomeEvent = z.object({ type: z.literal('home'), plotId: TokenSchema });
const ForgeEvent = z.object({ type: z.literal('forge'), event: z.object({ type: z.literal('committed'), activityId: TokenSchema }) });
function publicEventOf(row: PublicEventRow, kingdomId: KingdomId, origin: 'live' | 'simulated'): PanelPublicEvent {
  const at = Number(row.created_ms), cursor = Number(row.id), message: unknown = JSON.parse(row.message);
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(cursor) || cursor < 1) throw new RealmRecoveryError(kingdomId, 'Invalid public event time.');
  // Reconstruct a tiny allowlist; attachment geometry, maker words and opaque private evidence never enter this line.
  const home = HomeEvent.safeParse(message);
  if (home.success) return { type: 'home', at, cursor, plotId: home.data.plotId };
  const forge = ForgeEvent.safeParse(message);
  if (forge.success) return { type: 'forge', at, cursor, activityId: forge.data.event.activityId };
  const moment = z.object({ type: z.literal('moment'), fact: TwitchMomentFactSchema }).safeParse(message);
  if (moment.success && moment.data.fact.kingdomId === kingdomId && moment.data.fact.origin === origin) return { type: 'moment', at, cursor, fact: moment.data.fact };
  throw new RealmRecoveryError(kingdomId, 'The public event is unavailable.');
}
const ok = (body: PanelDoorBody): PanelDoorReply => ({ http: 200, body });
const invalid = (): PanelDoorReply => ({ http: 400, body: { version: 1, status: 'refused', message: 'Send a valid panel request.' } });
const unauthorized = (): PanelDoorReply => ({ http: 401, body: { version: 1, status: 'refused', message: 'Unknown panel service.' } });
const unavailable = (): PanelDoorReply => ({ http: 503, body: { version: 1, status: 'unavailable', message: 'The kingdom is not reaching the panel just now.' } });
