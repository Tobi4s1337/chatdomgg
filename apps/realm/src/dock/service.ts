import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { ACTIONS, DockOutcomeSchema, DockStateSchema, RealmDockActionRequestSchema, RealmDockPresentationSchema, RealmDockStageStateSchema,
  RealmDockStatusRequestSchema, RealmDockWitnessRequestSchema, type DockOutcome, type DockState, type RealmDockActor,
  type RealmDockActionRequest, type RealmDockPresentation, type RealmDockStageState, type RealmWriterLease } from '@chatdom/shared/realm';
import { TwitchMomentFactSchema } from '@chatdom/shared/twitch-moments';
import { projectPresence } from '@chatdom/world';
import type pg from 'pg';
import { approvedPublicName, DISPLAY_NAME_APPROVAL } from '../../../api/src/realm-auth/presentation';
import { decodeIngressCheckpoint, type IngressCheckpointState } from '../ingress/codec';
import { digestOf } from '../persistence/codec';
import { RealmCommitUncertainError, RealmWriterFencedError, type RealmDatabase } from '../persistence/database';
import type { DurableKingdom, DurableKingdomHold, DurableRealmServices } from '../persistence/kingdom';

const NOW = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
const CADENCE = 2_000;
const honour = z.strictObject({ kind: z.enum(['citizen-crown', 'citizen-knight']), name: z.string(), slot: z.number(), until: z.number() });
const base = { gate: z.enum(['open', 'closed']), fireUntil: z.number(), honours: z.record(z.string(), honour) };
const HeadSchema = z.strictObject({ ...base, lastAt: z.number(), consumedRaids: z.array(z.string()),
  undo: z.strictObject({ eventId: z.string(), until: z.number(), before: z.strictObject(base) }).nullable() });
type Head = z.infer<typeof HeadSchema>;
const blank = (): Head => ({ gate: 'open', fireUntil: 0, honours: {}, lastAt: 0, consumedRaids: [], undo: null });
type Tx = Pick<pg.PoolClient, 'query'>;
type Session = { public_name: string | null; name_approval: string | null };
interface Candidate { id: string; name: string; slot: number }
interface Snapshot { state: DockState; head: Head; revision: number; now: number; citizens: Candidate[]; raidBodies: Map<string, NonNullable<RealmDockPresentation['raid']>> }
interface Grant { kingdomId: KingdomId; principal: RealmDockActor; seen: Set<string>; expires: number }
interface Listener { presenter: boolean; receive: (event: RealmDockPresentation) => boolean; state: (state: RealmDockStageState) => boolean; close: () => void }
export interface DockHttpReply { readonly http: 200 | 400 | 401 | 403 | 503; readonly body: unknown }
export interface DockPresentationConnection { readonly presenterToken?: string; readonly close: () => void }

/** Royal acts enter the already retained writer queue; this service never acquires a writer of its own. */
export class RealmDockService {
  private services: Pick<DurableRealmServices, 'retain'> | null = null;
  private readonly secret: Buffer | null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly grants = new Map<string, Grant>();
  private readonly awaiting = new Map<string, Set<() => void>>();
  private active = 0;
  private pendingActions = 0;

  constructor(private readonly db: RealmDatabase, readonly origin: 'live' | 'simulated', secret: string | undefined,
    private readonly witnessWaitMs = 1_800, private readonly names: ReadonlyMap<KingdomId, string> = new Map()) {
    if (secret && secret.length < 32) throw new Error('REALM_INTERNAL_SECRET must contain at least 32 characters.');
    this.secret = secret ? hash(secret) : null;
  }
  use(services: Pick<DurableRealmServices, 'retain'>) { this.services = services; }
  authenticate(authorization: string | undefined): boolean {
    const bearer = /^Bearer ([\x21-\x7e]{1,512})$/.exec(authorization ?? '');
    return !!this.secret && !!bearer && timingSafeEqual(this.secret, hash(bearer[1]!));
  }

  async status(authorization: string | undefined, raw: unknown): Promise<DockHttpReply> {
    if (!this.authenticate(authorization)) return denied();
    const parsed = RealmDockStatusRequestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.origin !== this.origin) return malformed();
    try {
      const state = await this.withKingdom(parsed.data.kingdomId, kingdom => kingdom.writeMoments((lease, current) =>
        this.transaction(lease, current, parsed.data.principal, async (tx, now) => {
          const session = await this.session(tx, parsed.data.principal);
          if (!session || String(parsed.data.principal.personId) !== String(parsed.data.kingdomId)) return null;
          return (await this.snapshot(tx, kingdom, session, now)).state;
        })));
      return { http: 200, body: state };
    } catch { return unavailable(); }
  }

  async action(authorization: string | undefined, raw: unknown): Promise<DockHttpReply> {
    if (!this.authenticate(authorization)) return denied();
    const parsed = RealmDockActionRequestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.origin !== this.origin) return malformed();
    const request = parsed.data;
    if (request.principal.personId !== request.action.kingdomId) return { http: 200, body: refused('Only this kingdom’s broadcaster may press a royal act.') };
    if (this.pendingActions >= 32) return unavailable();
    this.pendingActions++;
    let committedToRealm = false;
    try {
      const committed = await this.withKingdom(KingdomIdSchema.parse(request.action.kingdomId), kingdom => kingdom.writeMoments((lease, current) =>
        this.transaction(lease, current, request.principal, async (tx, now) => this.commit(tx, kingdom, request, now))));
      if (!committed.event) return { http: 200, body: committed.outcome };
      committedToRealm = true;
      this.publish(committed.event);
      // A receipt means a connected, authenticated presenter acknowledged drawing THIS committed event.
      const witnessed = await this.waitForWitness(committed.event.id);
      return { http: 200, body: witnessed ? accepted(committed.event) : committed.outcome };
    } catch (error) {
      return committedToRealm || error instanceof RealmCommitUncertainError
        ? { http: 200, body: { status: 'unknown', message: 'The reply was lost. Check the stream before pressing again.' } }
        : unavailable();
    } finally { this.pendingActions--; }
  }

  /** Only the private service door can create a presenter grant; the named session is independently checked. */
  async connect(authorization: string | undefined, raw: unknown,
    receive: (event: RealmDockPresentation) => boolean, closed: () => void, presenter: boolean,
    receiveState: (state: RealmDockStageState) => boolean = () => true): Promise<DockPresentationConnection> {
    if (!this.authenticate(authorization)) throw new Error('Unauthenticated stream service');
    const authenticated = presenter ? RealmDockStatusRequestSchema.parse(raw) : undefined;
    const parsed = authenticated ?? RealmDockStatusRequestSchema.omit({ principal: true }).parse(raw);
    // Anonymous viewers cannot exhaust the broadcaster's independently reserved draw capacity.
    const full = () => {
      const all = [...this.listeners.values()].flatMap(set => [...set]);
      return presenter ? all.filter(listener => listener.presenter).length >= 8
        || [...this.listeners.get(parsed.kingdomId) ?? []].filter(listener => listener.presenter).length >= 2
        : all.filter(listener => !listener.presenter).length >= 32;
    };
    if (parsed.origin !== this.origin || !this.services || full()) throw new Error('Unavailable stream');
    const principal = authenticated?.principal;
    if (presenter && (!principal || String(principal.personId) !== String(parsed.kingdomId) || !await this.session(this.db, principal))) throw new Error('Forbidden presenter');
    const hold = await this.services.retain(parsed.kingdomId);
    if (full()) { await hold.release(); throw new Error('The stream feed is full'); }
    let ended = false;
    const token = presenter ? randomBytes(32).toString('base64url') : undefined;
    const grant: Grant | undefined = token && principal ? { kingdomId: parsed.kingdomId, principal, seen: new Set(), expires: Date.now() + 15 * 60_000 } : undefined;
    if (token && grant) this.grants.set(token, grant);
    const listeners = this.listeners.get(parsed.kingdomId) ?? new Set<Listener>();
    this.listeners.set(parsed.kingdomId, listeners);
    let detach = () => {};
    const close = () => {
      if (ended) return;
      ended = true; listeners.delete(listener); if (!listeners.size) this.listeners.delete(parsed.kingdomId);
      if (token) this.grants.delete(token); detach(); clearTimeout(expiry);
      void hold.release().catch(() => {}); closed();
    };
    const listener: Listener = { presenter, close, state: receiveState, receive: event => {
      if (ended || !hold.kingdom.current) return false;
      if (!receive(event)) { close(); return false; }
      grant?.seen.add(event.id); return true;
    } };
    listeners.add(listener);
    const expiry = setTimeout(close, 15 * 60_000); expiry.unref?.();
    const stopClosed = hold.kingdom.onClosed(close);
    let refreshPending = false;
    const stopWorld = hold.kingdom.subscribe(() => {
      if (ended || refreshPending) return;
      refreshPending = true;
      void hold.kingdom.writeMoments(async () => this.stageState(hold.kingdom)).then(state => {
        if (!ended && !receiveState(state)) close();
      }).catch(close).finally(() => { refreshPending = false; });
    });
    detach = () => { stopWorld(); stopClosed(); };
    try {
      const stage = await hold.kingdom.writeMoments(async () => this.stageState(hold.kingdom));
      if (!receiveState(stage)) throw new Error('Stream checkpoint not delivered');
      // Subscribe first, then replay the bounded committed prefix. Duplicate IDs are harmless to the renderer.
      const rows = await this.db.query<{ presentation: string }>(`SELECT presentation FROM realm_dock_presentations
        WHERE kingdom_id = $1 AND origin = $2 AND witnessed_ms IS NULL AND created_ms > ${NOW} - 60000
        ORDER BY created_ms, event_id LIMIT 100`, [parsed.kingdomId, this.origin]);
      for (const row of rows.rows) {
        const event = RealmDockPresentationSchema.parse(JSON.parse(row.presentation));
        if ((event.kind === 'citizen-crown' || event.kind === 'citizen-knight') && !stage.honours.some(honour =>
          honour.id === event.targetId && honour.name === event.targetName && honour.slot === event.targetSlot && honour.kind === event.kind)) continue;
        listener.receive(event);
      }
      if (ended) throw new Error('Presenter disconnected');
      return { ...(token ? { presenterToken: token } : {}), close };
    } catch (error) { close(); throw error; }
  }

  async witness(authorization: string | undefined, raw: unknown): Promise<DockHttpReply> {
    if (!this.authenticate(authorization)) return denied();
    const parsed = RealmDockWitnessRequestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.origin !== this.origin) return malformed();
    const request = parsed.data, grant = this.grants.get(request.presenterToken);
    if (!grant || grant.expires <= Date.now() || grant.kingdomId !== request.kingdomId
      || grant.principal.personId !== request.principal.personId || grant.principal.sessionId !== request.principal.sessionId
      || !grant.seen.has(request.streamEventId)) return { http: 403, body: { status: 'refused', message: 'This connection did not present that event.' } };
    try {
      const matched = await this.withKingdom(request.kingdomId, kingdom => kingdom.writeMoments((lease, current) =>
        this.transaction(lease, current, request.principal, async tx => {
          if (!await this.session(tx, request.principal)) return false;
          const updated = await tx.query(`UPDATE realm_dock_presentations SET witnessed_ms = coalesce(witnessed_ms, ${NOW})
            WHERE event_id = $1 AND kingdom_id = $2 AND origin = $3 AND created_ms > ${NOW} - 60000 RETURNING event_id`,
          [request.streamEventId, request.kingdomId, this.origin]);
          return updated.rowCount === 1;
        })));
      if (!matched) return { http: 403, body: { status: 'refused', message: 'That presentation expired or the session ended.' } };
      for (const resolve of this.awaiting.get(request.streamEventId) ?? []) resolve();
      return { http: 200, body: { status: 'witnessed' } };
    } catch { return unavailable(); }
  }

  stop() { for (const set of [...this.listeners.values()]) for (const listener of [...set]) listener.close(); }

  private async stageState(kingdom: DurableKingdom): Promise<RealmDockStageState> {
    if (!kingdom.current) throw new RealmWriterFencedError(kingdom.kingdomId);
    const row = (await this.db.query<{ revision: string; state: string; now: string }>(`SELECT h.revision, h.state, ${NOW} AS now
      FROM realm_dock_heads h WHERE kingdom_id = $1`, [kingdom.kingdomId])).rows[0];
    const head = row ? HeadSchema.parse(JSON.parse(row.state)) : blank();
    const now = row ? Number(row.now) : Math.floor(kingdom.databaseNow());
    const ingress = await kingdom.loadIngress();
    const presence = ingress ? decodeIngressCheckpoint(ingress, kingdom.kingdomId, this.origin).presence : null;
    const candidates = new Map(this.publicCitizens(kingdom, presence, now).map(candidate => [candidate.id, candidate]));
    const honours = Object.entries(head.honours).filter(([id, value]) => value.until > now && candidates.get(id)?.name === value.name && candidates.get(id)?.slot === value.slot)
      .map(([id, value]) => ({ id, name: value.name, slot: value.slot, kind: value.kind, expiresAt: value.until }));
    if (!kingdom.current) throw new RealmWriterFencedError(kingdom.kingdomId);
    const fire = head.fireUntil > now ? 'lit' : 'unlit';
    return RealmDockStageStateSchema.parse({ version: 1, kingdomId: kingdom.kingdomId, origin: this.origin, asOf: now,
      revision: `dock-stage:${digestOf({ revision: row?.revision ?? '0', fire, honours })}`, gate: head.gate, fire,
      fireUntil: head.fireUntil, honours });
  }

  private async session(tx: Tx, actor: RealmDockActor): Promise<Session | null> {
    const row = (await tx.query<Session>(`SELECT p.public_name, p.name_approval FROM realm_sessions s
      JOIN realm_persons p ON p.person_id = s.person_id
      WHERE s.session_id = $1 AND s.person_id = $2 AND s.origin = $3 AND p.origin = $3
        AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()`, [actor.sessionId, actor.personId, this.origin])).rows[0];
    return row ?? null;
  }

  private publicCitizens(kingdom: DurableKingdom, presence: IngressCheckpointState['presence'] | null, now: number): Candidate[] {
    const windows = this.publicWindows(kingdom, presence, now);
    const citizens: Candidate[] = [];
    for (const home of Object.values(kingdom.privateState.homes).sort((a, b) => a.slot - b.slot)) {
      if (citizens.length >= 1000) break;
      if (home.layoutRevision !== kingdom.layoutRevision || kingdom.privateState.rights[home.ownerId]?.blocked) continue;
      const person = windows.get(home.slot);
      if (!person?.present || person.publicName === null) continue;
      const name = approvedPublicName(person.publicName);
      if (!name || name !== person.publicName) continue;
      citizens.push({ id: `citizen:${digestOf({ kingdomId: kingdom.kingdomId, ownerId: home.ownerId, slot: home.slot, layout: kingdom.layoutRevision })}`, name, slot: home.slot });
    }
    return citizens;
  }

  private publicWindows(kingdom: DurableKingdom, presence: IngressCheckpointState['presence'] | null, now: number) {
    if (!presence) return new Map<number, { present: boolean; publicName: string | null }>();
    const bindings = Object.values(kingdom.privateState.homes)
      .filter(home => home.layoutRevision === kingdom.layoutRevision && !kingdom.privateState.rights[home.ownerId]?.blocked)
      .map(home => ({ personId: home.ownerId, slot: home.slot }));
    return new Map(projectPresence(presence, bindings, now, 0).windows.map(window => [window.slot, window]));
  }

  private async snapshot(tx: Tx, kingdom: DurableKingdom, session: Session, now: number): Promise<Snapshot> {
    const row = (await tx.query<{ revision: string; state: string }>('SELECT revision, state FROM realm_dock_heads WHERE kingdom_id = $1', [kingdom.kingdomId])).rows[0];
    const head = row ? HeadSchema.parse(JSON.parse(row.state)) : blank();
    const revision = Number(row?.revision ?? 0);
    for (const [id, honour] of Object.entries(head.honours)) if (honour.until <= now) delete head.honours[id];
    // Reuse this transaction's kingdom lock. loadIngress() opens a separate fenced transaction.
    const checkpoint = (await tx.query<{ revision: string; codec: string; data: Buffer }>(
      'SELECT revision, codec, data FROM realm_ingress_checkpoints WHERE kingdom_id = $1', [kingdom.kingdomId])).rows[0];
    if (checkpoint && checkpoint.codec !== 'presence-v1') throw new Error('Unsupported ingress checkpoint');
    const presence = checkpoint ? decodeIngressCheckpoint({ version: 1, revision: Number(checkpoint.revision), codec: 'presence-v1',
      data: new Uint8Array(checkpoint.data) }, kingdom.kingdomId, this.origin).presence : null;
    const citizens = this.publicCitizens(kingdom, presence, now);
    const raids: { id: string; name: string }[] = [];
    const raidBodies = new Map<string, NonNullable<RealmDockPresentation['raid']>>();
    const facts = await tx.query<{ fact: string }>(`SELECT fact FROM realm_moment_facts WHERE kingdom_id = $1 AND committed_ms > $2
      AND (fact::jsonb->'body'->>'kind') = 'raid' ORDER BY seq DESC LIMIT 100`, [kingdom.kingdomId, now - 60_000]);
    for (const row of facts.rows) {
      const fact = TwitchMomentFactSchema.parse(JSON.parse(row.fact));
      if (fact.origin !== this.origin || fact.kingdomId !== kingdom.kingdomId || fact.body.kind !== 'raid'
        || fact.body.displayUntil <= now || head.consumedRaids.includes(fact.body.raidKey)) continue;
      raids.push({ id: fact.body.raidKey, name: fact.body.from.displayName });
      raidBodies.set(fact.body.raidKey, { raidKey: fact.body.raidKey, from: fact.body.from, viewers: fact.body.viewers, founded: fact.body.founded });
    }
    const ready = now - head.lastAt >= CADENCE;
    const undoRow = head.undo ? (await tx.query<{ presentation: string }>('SELECT presentation FROM realm_dock_presentations WHERE event_id = $1 AND witnessed_ms IS NOT NULL', [head.undo.eventId])).rows[0] : undefined;
    const undoEvent = undoRow ? RealmDockPresentationSchema.parse(JSON.parse(undoRow.presentation)) : undefined;
    const undoWitnessed = !!undoEvent;
    const undoable = undoEvent && undoEvent.kind !== 'undo' && head.undo && head.undo.until > now
      ? [{ id: `receipt:${undoEvent.id}`, kind: undoEvent.kind, label: undoEvent.kind.replaceAll('-', ' ') }] : [];
    const capabilities = ACTIONS.map(kind => {
      const eligible = kind === 'gate-open' ? head.gate !== 'open' : kind === 'gate-close' ? head.gate !== 'closed'
        : kind === 'fire-light' ? head.fireUntil <= now : kind === 'raid-welcome' ? raids.length > 0
          : kind === 'citizen-crown' || kind === 'citizen-knight' ? citizens.length > 0
            : kind === 'undo' ? !!head.undo && head.undo.until > now && undoWitnessed : true;
      return { kind, allowed: ready && eligible, reason: !ready ? 'Let this moment land.' : !eligible ? 'No eligible act right now.' : '' };
    });
    const name = session.name_approval === DISPLAY_NAME_APPROVAL ? approvedPublicName(session.public_name) : null;
    const stream = presence?.stream;
    const observedLive = !!stream?.live && stream.expiresAt > now;
    const attendance = [...this.publicWindows(kingdom, presence, now).values()].filter(window => window.present).length;
    const presenceLabel = !presence || !stream || stream.expiresAt <= now ? 'Attendance is not currently observed.'
      : `${attendance} settled citizen${attendance === 1 ? '' : 's'} observed here · ${observedLive ? 'stream awake' : 'stream resting'} · coverage incomplete`;
    const kingdomName = this.names.get(kingdom.kingdomId);
    if (!kingdomName) throw new Error('This kingdom has no approved entry name.');
    const state = DockStateSchema.parse({ kingdom: { id: kingdom.kingdomId, name: kingdomName },
      principal: { role: 'broadcaster', displayName: name ?? 'Monarch' },
      town: { gate: head.gate, fire: head.fireUntil > now ? 'lit' : 'unlit',
        presenceLabel,
        growthLabel: `${Object.keys(kingdom.privateState.homes).length} settled homes`,
        comingLabel: raids.length ? `${raids.length} witnessed arrival${raids.length === 1 ? '' : 's'} at the gate` : 'No pending witnessed arrivals' },
      raids, citizens: citizens.map(({ id, name }) => ({ id, name })),
      moments: [{ id: 'sky-dusk', name: 'Gather beneath the dusk sky', available: ready, reason: ready ? '' : 'Let this moment land.' }],
      capabilities, undoable,
      revision: `dock:${digestOf({ revision, domain: kingdom.sequence, layout: kingdom.layoutRevision, raids, citizens,
        capabilities, fire: head.fireUntil > now, undo: !!head.undo && head.undo.until > now && undoWitnessed })}` });
    return { state, head, revision, now, citizens, raidBodies };
  }

  private async commit(tx: Tx, kingdom: DurableKingdom, request: RealmDockActionRequest, now: number): Promise<{ outcome: DockOutcome; event?: RealmDockPresentation }> {
    const { action, principal } = request;
    const session = await this.session(tx, principal);
    if (!session) return { outcome: refused('Your session ended. Sign in again.') };
    const digest = digestOf({ origin: request.origin, principal: principal.personId, action });
    const old = (await tx.query<{ digest: string; outcome: string; event_id: string | null }>(`SELECT digest, outcome, event_id FROM realm_dock_actions
      WHERE kingdom_id = $1 AND origin = $2 AND action_id = $3`, [kingdom.kingdomId, this.origin, action.id])).rows[0];
    if (old) {
      if (old.digest !== digest) return { outcome: refused('That action ID belongs to a different press.') };
      if (!old.event_id) return { outcome: DockOutcomeSchema.parse(JSON.parse(old.outcome)) };
      const delivered = (await tx.query<{ presentation: string; witnessed_ms: string | null }>('SELECT presentation, witnessed_ms FROM realm_dock_presentations WHERE event_id = $1', [old.event_id])).rows[0];
      if (!delivered) throw new Error('Missing dock presentation');
      const event = RealmDockPresentationSchema.parse(JSON.parse(delivered.presentation));
      return delivered.witnessed_ms ? { outcome: accepted(event) } : { outcome: uncertain(), event };
    }
    const snap = await this.snapshot(tx, kingdom, session, now);
    let rejection: string | undefined;
    if (action.expectedRevision !== snap.state.revision) rejection = 'The kingdom changed. Check its current state before pressing again.';
    else if (!snap.state.capabilities.find(cap => cap.kind === action.kind)?.allowed) rejection = 'That act is not eligible right now.';
    const target = action.targetId;
    const citizen = snap.citizens.find(candidate => candidate.id === target);
    const raid = snap.state.raids.find(candidate => candidate.id === target);
    let original: RealmDockPresentation | undefined;
    if (action.kind === 'undo' && snap.head.undo) {
      const row = (await tx.query<{ presentation: string }>(`SELECT presentation FROM realm_dock_presentations
        WHERE event_id = $1 AND kingdom_id = $2 AND origin = $3 AND witnessed_ms IS NOT NULL`,
      [snap.head.undo.eventId, kingdom.kingdomId, this.origin])).rows[0];
      original = row ? RealmDockPresentationSchema.parse(JSON.parse(row.presentation)) : undefined;
    }
    if ((action.kind === 'citizen-crown' || action.kind === 'citizen-knight') && !citizen) rejection = 'That citizen is not an eligible public target.';
    if (action.kind === 'raid-welcome' && !raid) rejection = 'That witnessed raid is no longer waiting.';
    if (action.kind === 'moment-play' && target !== 'sky-dusk') rejection = 'That moment has not been offered by the realm.';
    if (action.kind === 'undo' && (!snap.head.undo || target !== `receipt:${snap.head.undo.eventId}`)) rejection = 'That receipt is not the last eligible witnessed act.';
    if (action.kind === 'undo' && (!original || !['gate-open', 'gate-close', 'fire-light', 'citizen-crown', 'citizen-knight'].includes(original.kind))) rejection = 'That witnessed act has no reversible presentation.';
    if (original?.kind.startsWith('citizen-') && !snap.citizens.some(candidate => candidate.id === original!.targetId
      && candidate.name === original!.targetName && candidate.slot === original!.targetSlot)) rejection = 'That citizen is no longer a public presentation target.';
    if (['gate-open', 'gate-close', 'fire-light'].includes(action.kind) && target !== undefined) rejection = 'That royal act has no named target.';
    if (rejection) {
      const outcome = refused(rejection);
      await this.record(tx, request, digest, outcome, null, now);
      return { outcome };
    }
    const head = snap.head;
    const before = { gate: head.gate, fireUntil: head.fireUntil, honours: structuredClone(head.honours) };
    const undoOf = action.kind === 'undo' ? head.undo?.eventId : undefined;
    const restored = original?.targetId ? head.undo?.before.honours[original.targetId] : undefined;
    const undoSubject = original ? { kind: original.kind,
      ...(original.targetId ? { targetId: original.targetId } : {}), ...(original.targetName ? { targetName: original.targetName } : {}),
      ...(original.targetSlot !== undefined ? { targetSlot: original.targetSlot } : {}),
      ...(restored && restored.until > now ? { restoredHonour: { kind: restored.kind, expiresAt: restored.until } } : {}) } : undefined;
    if (action.kind === 'gate-open') head.gate = 'open';
    if (action.kind === 'gate-close') head.gate = 'closed';
    if (action.kind === 'fire-light') head.fireUntil = now + 10 * 60_000;
    if (citizen && (action.kind === 'citizen-crown' || action.kind === 'citizen-knight')) {
      head.honours[citizen.id] = { kind: action.kind, name: citizen.name, slot: citizen.slot, until: now + 24 * 60 * 60_000 };
    }
    if (raid && action.kind === 'raid-welcome') head.consumedRaids = [...head.consumedRaids, raid.id].slice(-1000);
    if (action.kind === 'undo' && head.undo) Object.assign(head, head.undo.before);
    const event = RealmDockPresentationSchema.parse({ version: 1, id: `dock:${randomBytes(24).toString('hex')}`, actionId: action.id,
      kingdomId: kingdom.kingdomId, origin: this.origin, kind: action.kind,
      ...(target ? { targetId: target } : {}), ...(citizen ? { targetName: citizen.name, targetSlot: citizen.slot } : {}),
      ...(raid ? { targetName: raid.name, raid: snap.raidBodies.get(raid.id) } : {}), ...(undoOf ? { undoOf, undoSubject } : {}),
      ...(action.kind === 'moment-play' ? { moment: 'sky-dusk' } : {}),
      occurredAt: now, expiresAt: now + 60_000, gate: head.gate, fire: head.fireUntil > now ? 'lit' : 'unlit' });
    head.lastAt = now;
    // Welcoming a real raid cannot erase its provenance or restore a consumed incoming raid.
    head.undo = ['undo', 'raid-welcome', 'moment-play'].includes(action.kind) ? null : { eventId: event.id, until: now + 30_000, before };
    await tx.query(`INSERT INTO realm_dock_heads (kingdom_id, revision, state) VALUES ($1, $2, $3)
      ON CONFLICT (kingdom_id) DO UPDATE SET revision = excluded.revision, state = excluded.state`, [kingdom.kingdomId, snap.revision + 1, JSON.stringify(head)]);
    await tx.query(`INSERT INTO realm_dock_presentations (event_id, kingdom_id, origin, action_id, presentation, created_ms)
      VALUES ($1, $2, $3, $4, $5, $6)`, [event.id, kingdom.kingdomId, this.origin, action.id, JSON.stringify(event), now]);
    const outcome = uncertain();
    await this.record(tx, request, digest, outcome, event.id, now);
    return { outcome, event };
  }

  private async record(tx: Tx, request: RealmDockActionRequest, digest: string, outcome: DockOutcome, eventId: string | null, now: number) {
    await tx.query(`INSERT INTO realm_dock_actions (kingdom_id, origin, action_id, digest, actor_id, outcome, event_id, created_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [request.action.kingdomId, this.origin, request.action.id, digest,
      request.principal.personId, JSON.stringify(outcome), eventId, now]);
  }

  private async transaction<T>(lease: RealmWriterLease, current: () => boolean, principal: RealmDockActor,
    work: (tx: Tx, now: number) => Promise<T>): Promise<T> {
    const tx = await this.db.connect();
    let committing = false;
    try {
      await tx.query('BEGIN');
      const fence = await tx.query<{ now: string }>(`SELECT ${NOW} AS now FROM realm_kingdoms
        WHERE kingdom_id = $1 AND writer_epoch = $2 AND origin = $3 AND lease_expires_ms > ${NOW} FOR UPDATE`, [lease.kingdomId, lease.epoch, this.origin]);
      if (fence.rowCount !== 1 || !current()) throw new RealmWriterFencedError(lease.kingdomId);
      // Revocation waits for this transaction, and the final check also fences natural expiry.
      await tx.query(`SELECT 1 FROM realm_sessions s JOIN realm_persons p ON p.person_id = s.person_id
        WHERE s.session_id = $1 AND s.person_id = $2 FOR SHARE OF s, p`, [principal.sessionId, principal.personId]);
      const startedWithSession = await this.session(tx, principal);
      const result = await work(tx, Number(fence.rows[0]!.now));
      if (startedWithSession && !await this.session(tx, principal)) throw new Error('The actor session expired during this act.');
      const final = await tx.query(`SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND writer_epoch = $2
        AND origin = $3 AND lease_expires_ms > ${NOW}`, [lease.kingdomId, lease.epoch, this.origin]);
      if (final.rowCount !== 1 || !current()) throw new RealmWriterFencedError(lease.kingdomId);
      committing = true; await tx.query('COMMIT'); committing = false;
      return result;
    } catch (error) {
      if (committing) throw new RealmCommitUncertainError(lease.kingdomId, 'dock');
      await tx.query('ROLLBACK').catch(() => {}); throw error;
    } finally { tx.release(committing ? true : undefined); }
  }
  private async withKingdom<T>(kingdomId: KingdomId, work: (kingdom: DurableKingdom) => Promise<T>): Promise<T> {
    if (!this.services || this.active >= 32) throw new Error('Dock unavailable');
    this.active++; let hold: DurableKingdomHold | undefined;
    try { hold = await this.services.retain(kingdomId); return await work(hold.kingdom); }
    finally { this.active--; await hold?.release(); }
  }
  private publish(event: RealmDockPresentation) {
    if (event.expiresAt <= Date.now()) return;
    for (const listener of this.listeners.get(event.kingdomId) ?? []) listener.receive(event);
    // Durable state is a separate checkpoint, never a witnessable ceremony.
    void this.withKingdom(event.kingdomId, kingdom => kingdom.writeMoments(async () => this.stageState(kingdom))).then(state => {
      for (const listener of this.listeners.get(event.kingdomId) ?? []) if (!listener.state(state)) listener.close();
    }).catch(() => {});
  }
  private async waitForWitness(eventId: string): Promise<boolean> {
    const known = async () => (await this.db.query('SELECT 1 FROM realm_dock_presentations WHERE event_id = $1 AND witnessed_ms IS NOT NULL', [eventId])).rowCount === 1;
    const set = this.awaiting.get(eventId) ?? new Set<() => void>();
    this.awaiting.set(eventId, set);
    let resolve!: () => void;
    const signal = new Promise<void>(done => { resolve = done; set.add(done); });
    const timer = setTimeout(resolve, Math.max(0, Math.min(2_500, this.witnessWaitMs)));
    try { if (await known()) return true; await signal; return await known(); }
    finally { clearTimeout(timer); set.delete(resolve); if (!set.size) this.awaiting.delete(eventId); }
  }
}

const hash = (value: string) => createHash('sha256').update(value).digest();
const refused = (message: string): DockOutcome => ({ status: 'refused', message });
const uncertain = (): DockOutcome => ({ status: 'unknown', message: 'The act is committed. Check the stream; presentation has not been confirmed.' });
const accepted = (event: RealmDockPresentation): DockOutcome => ({ status: 'accepted', message: 'The stream presented this royal act.',
  receipt: `receipt:${event.id}`, witness: { actionId: event.actionId, kingdomId: event.kingdomId, origin: event.origin, streamEventId: event.id } });
const denied = (): DockHttpReply => ({ http: 401, body: { status: 'refused', message: 'This service is not known to the realm.' } });
const malformed = (): DockHttpReply => ({ http: 400, body: { status: 'refused', message: 'The dock request is invalid or belongs to another origin.' } });
const unavailable = (): DockHttpReply => ({ http: 503, body: { status: 'unavailable', message: 'The authoritative dock is unavailable.' } });
