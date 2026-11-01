import { randomUUID } from 'node:crypto';
import { PRESENCE_MINUTE_MS, type KingdomId, type PresencePerson } from '@chatdom/shared';
import type { RealmPrincipal, RealmStoredOutcome } from '@chatdom/shared/realm';
import { RealmBusyError, type DurableKingdom, type DurableKingdomHold, type DurableRealmServices, type RealmLifecycleEvent } from '../persistence/kingdom';
import { RealmRecoveryError, RealmWriterFencedError, describeStorageFailure, type RealmDatabase } from '../persistence/database';
import { REALM_ANONYMOUS_PRESENTATION } from '../auth/authenticator';
import { IngressGate, type AdmittedObservation, type IngressCredentials } from './gate';
import { INGRESS_DRAIN_BATCH, PostgresIngressInbox, type PendingObservation } from './inbox';
import { presenceTransition } from './transition';
import { RealmSupportIngress } from '../moments/service';

/** A kingdom opened for ingress stays held this long after its last accepted observation (Herald beats every minute). */
export const INGRESS_KEEP_OPEN_MS = 180_000;
/** The writer looks for observations another process accepted at least this often. */
export const INGRESS_POLL_MS = 1_000;
/** Connected walkers are observed this often, inside one presence lease. */
export const WALKER_OBSERVE_MS = PRESENCE_MINUTE_MS;
/** In-process observations are stamped this far behind the estimated database clock, so they are never in its future. */
const WALKER_STAMP_LAG_MS = 500;

export type IngressReply =
  | { readonly http: 202; readonly body: { readonly version: 1; readonly status: 'accepted' | 'duplicate' | 'relayed' | 'absent' } }
  | { readonly http: 400 | 401 | 403 | 409 | 503; readonly body: { readonly version: 1; readonly status: 'refused' | 'unauthenticated' | 'unavailable'; readonly message: string } };

/**
 * Ingress for one realm process (spec 34 R7). Authenticated services report presence evidence; the realm commits it to
 * the durable inbox and answers. The kingdom's writer — in this process or another — drains the inbox in acceptance
 * order through `executeIngress`, which commits receipt, checkpoint, facts and the public frame in one transaction. If no
 * process holds the kingdom, this one opens it and keeps it while observations keep coming. Rooms report their own
 * authenticated walkers through `lifecycle`. Witnessed speech is relayed to the rooms present and never stored.
 */
export class RealmIngress {
  readonly gate: IngressGate;
  readonly inbox: PostgresIngressInbox;
  /** The town's spectacles and the dragon's battles share the moment records. */
  get moments(): RealmSupportIngress { return this.support; }
  private services: DurableRealmServices | null = null;
  private readonly drains = new Map<KingdomId, KingdomDrain>();
  private readonly keep = new Map<KingdomId, { hold: DurableKingdomHold; timer: ReturnType<typeof setTimeout> }>();
  private readonly retaining = new Set<KingdomId>();
  private sweep: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly support: RealmSupportIngress;

  constructor(db: RealmDatabase, private readonly origin: 'live' | 'simulated', credentials: IngressCredentials, private readonly log: (line: string) => void = () => {}) {
    this.gate = new IngressGate(credentials, origin);
    this.inbox = new PostgresIngressInbox(db, origin);
    this.support = new RealmSupportIngress(db, origin, log);
  }

  /** Late binding: the registry calls `attach` for each kingdom it opens, and ingress opens kingdoms through it. */
  use(services: DurableRealmServices) {
    this.services = services;
    this.support.use(services);
    // Observations accepted while no writer was running (or by a process that has since stopped) are picked up here.
    this.sweep ??= setInterval(() => void this.adopt(), INGRESS_POLL_MS * 5);
    this.sweep.unref?.();
  }

  /** The HTTP door's decision for one request. Never throws for a client's mistake; storage trouble is `unavailable`. */
  async accept(authorization: string | undefined, body: unknown): Promise<IngressReply> {
    const admission = this.gate.admit(authorization, body);
    if (!admission.ok) return admission.status === 'unauthenticated'
      ? { http: 401, body: { version: 1, status: 'unauthenticated', message: admission.message } }
      : { http: 400, body: { version: 1, status: 'refused', message: admission.message } };
    const admitted = admission.admitted;
    if (admitted.kind === 'support') return this.stopped
      ? { http: 503, body: { version: 1, status: 'unavailable', message: 'The realm is stopping; send this act again.' } }
      : this.support.accept(admitted.observation);
    if (admitted.kind === 'moment') return this.stopped
      ? { http: 503, body: { version: 1, status: 'unavailable', message: 'The realm is stopping; send this act again.' } }
      : this.support.acceptMoment(admitted.observation);
    if (admitted.kind === 'strike') return { http: 202, body: { version: 1, status: this.support.strike(admitted.strike) === 'accepted' ? 'accepted' : 'absent' } };
    if (admitted.kind === 'cue') {
      const kingdom = this.services?.kingdoms.get(admitted.kingdomId);
      const relayed = kingdom?.transient({ type: 'chat', cue: admitted.cue }) ?? false;
      return { http: 202, body: { version: 1, status: relayed ? 'relayed' : 'absent' } };
    }
    return this.commit(admitted);
  }

  /** Durable acceptance of one admitted observation, then a nudge to whoever writes the kingdom. */
  async commit(admitted: AdmittedObservation): Promise<IngressReply> {
    let answer;
    try { answer = await this.inbox.accept(admitted); }
    catch (error) {
      this.log(`[ingress] accept failed: ${describeStorageFailure(error)}`);
      return { http: 503, body: { version: 1, status: 'unavailable', message: 'The realm could not store this observation. Send it again; it is idempotent.' } };
    }
    switch (answer) {
      case 'conflict': return { http: 409, body: { version: 1, status: 'refused', message: 'This observation id was already used for different evidence.' } };
      case 'wrong-origin': return { http: 403, body: { version: 1, status: 'refused', message: `This kingdom is not a ${this.origin} kingdom.` } };
      case 'busy': return { http: 503, body: { version: 1, status: 'unavailable', message: 'This kingdom has too much waiting evidence. Send it again shortly.' } };
      default:
        this.wake(admitted.kingdomId);
        return { http: 202, body: { version: 1, status: answer } };
    }
  }

  /** Registry hook: drain this kingdom's inbox and observe its walkers while it is open here. */
  attach(kingdom: DurableKingdom): () => void {
    this.support.battles.attach(kingdom);
    const drain = new KingdomDrain(kingdom, this.inbox, this.log);
    const walkers = new WalkerPresence(kingdom, this, drain);
    this.drains.set(kingdom.kingdomId, drain);
    drain.kick();
    return () => {
      walkers.stop(); drain.stop();
      if (this.drains.get(kingdom.kingdomId) === drain) this.drains.delete(kingdom.kingdomId);
    };
  }

  async stop() {
    this.stopped = true;
    this.support.battles.stop();
    if (this.sweep) clearInterval(this.sweep);
    const held = [...this.keep.values()];
    this.keep.clear();
    for (const { timer } of held) clearTimeout(timer);
    await Promise.all(held.map(({ hold }) => hold.release()));
  }

  private wake(kingdomId: KingdomId) {
    const drain = this.drains.get(kingdomId);
    if (drain) drain.kick();
    void this.retain(kingdomId);
  }

  /** Holds the kingdom's writer for a while after evidence arrives, opening it here if nobody else holds it. */
  private async retain(kingdomId: KingdomId) {
    if (this.stopped || !this.services) return;
    const kept = this.keep.get(kingdomId);
    if (kept?.hold.kingdom.current) { kept.timer.refresh(); return; }
    if (this.retaining.has(kingdomId)) return;
    this.retaining.add(kingdomId);
    try {
      const hold = await this.services.retain(kingdomId);
      if (this.stopped) { await hold.release(); return; }
      const timer = setTimeout(() => { if (this.keep.get(kingdomId)?.hold === hold) this.keep.delete(kingdomId); void hold.release(); }, INGRESS_KEEP_OPEN_MS);
      timer.unref?.();
      if (kept) clearTimeout(kept.timer);
      this.keep.set(kingdomId, { hold, timer });
      hold.kingdom.onClosed(() => { if (this.keep.get(kingdomId)?.hold === hold) { clearTimeout(timer); this.keep.delete(kingdomId); void hold.release(); } });
    } catch {
      // Another server holds it (it drains the same inbox) or storage is down (the inbox keeps the evidence).
    } finally { this.retaining.delete(kingdomId); }
  }

  private async adopt() {
    try { for (const kingdomId of await this.inbox.waiting()) if (!this.drains.has(kingdomId)) void this.retain(kingdomId); }
    catch { /* The next sweep tries again; nothing accepted is lost. */ }
  }
}

/**
 * The writer side of one kingdom's inbox. Rows run one at a time, in acceptance order, behind the kingdom's command
 * queue. A row is settled only after its receipt exists (or after a final refusal); a crash in between just means the
 * next pass meets the stored receipt and settles it without applying anything twice.
 */
class KingdomDrain {
  private chain: Promise<void> = Promise.resolve();
  private queued = false;
  private stopped = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly kingdom: DurableKingdom, private readonly inbox: PostgresIngressInbox, private readonly log: (line: string) => void) {
    this.timer = setInterval(() => this.kick(), INGRESS_POLL_MS);
    this.timer.unref?.();
  }

  kick() {
    if (this.queued || this.stopped) return;
    this.queued = true;
    this.chain = this.chain.then(() => { this.queued = false; return this.run(); }).catch(error => this.log(`[ingress] drain failed: ${describeStorageFailure(error)}`));
  }

  stop() { this.stopped = true; clearInterval(this.timer); }

  private async run() {
    while (!this.stopped && this.kingdom.current) {
      const rows = await this.inbox.pending(this.kingdom.kingdomId, INGRESS_DRAIN_BATCH);
      if (rows.length === 0) return;
      for (const row of rows) if (!await this.apply(row)) return;
      if (rows.length < INGRESS_DRAIN_BATCH) return;
    }
  }

  /** False stops this pass; the row stays waiting for the next one (or the next writer). */
  private async apply(row: PendingObservation): Promise<boolean> {
    let outcome: RealmStoredOutcome;
    try {
      outcome = await this.kingdom.ingest({ source: row.service, digest: row.digest, receivedAt: row.receivedAt, observation: row.observation },
        presenceTransition({ service: row.service, observation: row.observation, writerEpoch: this.kingdom.writerEpoch }));
    } catch (error) {
      if (error instanceof RealmBusyError || error instanceof RealmWriterFencedError) return false;
      if (error instanceof RealmRecoveryError) { this.log(`[ingress] kingdom ${this.kingdom.kingdomId} holds ingress: ${error.message}`); this.stop(); return false; }
      this.log(`[ingress] observation waits: ${describeStorageFailure(error)}`);
      return false;
    }
    // A closed gate decided nothing; the row stays for whichever writer is current next.
    if (outcome.status === 'rejected' && outcome.reason === 'cold') return false;
    await this.inbox.settle(this.kingdom.kingdomId, row, outcome);
    return true;
  }
}

/**
 * Walkers are people this realm authenticated and who are connected right now. A join or reconnect is observed at
 * once, so a citizen's window lights as they arrive; everyone still connected is observed again every minute. A dropped
 * connection is not observed, and its evidence simply lapses with the presence lease.
 */
class WalkerPresence {
  private readonly walkers = new Map<string, { principal: RealmPrincipal; connectedAt: number | null }>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;

  constructor(private readonly kingdom: DurableKingdom, private readonly ingress: RealmIngress, private readonly drain: KingdomDrain) {
    this.unsubscribe = kingdom.onLifecycle((event, principal, walkerId) => this.lifecycle(event, principal, walkerId));
    this.timer = setInterval(() => this.observe([...this.walkers.values()]), WALKER_OBSERVE_MS);
    this.timer.unref?.();
  }

  stop() { this.unsubscribe(); clearInterval(this.timer); this.walkers.clear(); }

  private lifecycle(event: RealmLifecycleEvent, principal: RealmPrincipal, walkerId: string) {
    if (principal.kingdomId !== this.kingdom.kingdomId || principal.origin !== this.kingdom.origin) return;
    if (event === 'leave') { this.walkers.delete(walkerId); return; }
    if (event === 'drop') { const w = this.walkers.get(walkerId); if (w) w.connectedAt = null; return; }
    const walker = { principal, connectedAt: this.stamp() };
    this.walkers.set(walkerId, walker);
    this.observe([walker], walker.connectedAt);
  }

  /** The estimate leans early by its error bound, so the database never sees an observation from its future. */
  private stamp() { return Math.floor(this.kingdom.databaseNow()) - WALKER_STAMP_LAG_MS; }

  private observe(walkers: readonly { principal: RealmPrincipal; connectedAt: number | null }[], at = this.stamp()) {
    const people = new Map<string, PresencePerson>();
    for (const { principal, connectedAt } of walkers) {
      if (connectedAt === null || connectedAt > at) continue;
      // The realm's approved public name, or anonymous: the default presentation never names anybody.
      const named = principal.publicName !== REALM_ANONYMOUS_PRESENTATION.publicName;
      people.set(principal.personId, named ? { personId: principal.personId, disclosure: 'named', displayName: principal.publicName } : { personId: principal.personId, disclosure: 'anonymous' });
    }
    if (people.size === 0 || !this.kingdom.current) return;
    const admission = this.ingress.gate.observe('walker', {
      version: 1, id: `walk:${randomUUID()}`, kingdomId: this.kingdom.kingdomId, observedAt: at, origin: this.kingdom.origin,
      kind: 'observe', source: 'walker', coverage: 'activity', people: [...people.values()],
    });
    if (!admission.ok || admission.admitted.kind !== 'observation') return;
    void this.ingress.commit(admission.admitted).then(() => this.drain.kick());
  }
}
