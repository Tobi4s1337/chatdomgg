import { PresenceInputSchema, type PresenceInput } from '@chatdom/shared';
import { REALM_HERALD_ROUTE, RealmHeraldEnvelopeSchema, RealmMomentObservationSchema, RealmStrikeSchema, RealmSupportObservationSchema,
  type RealmMomentObservation, type RealmStrike, type RealmSupportObservation, type RealmHeraldEnvelope } from '@chatdom/shared/realm';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RealmDeliverySink } from './sink';

const INGRESS_ROUTE = '/internal/realm/ingress';
const MAX_PENDING = 4096, CLEANUP_RESERVE = 128, MAX_BYTES = 32 * 1024 * 1024;
const MAX_TRANSIENT = 64;
const SupportEnvelope = z.strictObject({ version: z.literal(1), support: RealmSupportObservationSchema });
const MomentEnvelope = z.strictObject({ version: z.literal(1), moment: RealmMomentObservationSchema });
/** Spectacle evidence waiting at once. It never takes the room presence and its cleanup need. */
export const MAX_SPECTACLES = 512;
/** A spectacle the realm has not taken within this long is dropped: its beat has passed and nothing waits on it. */
export const SPECTACLE_LIFETIME_MS = 15 * 60_000;
/** `!strike` posts awaiting the realm at once; more are dropped, never queued. */
export const MAX_STRIKES_IN_FLIGHT = 32;
/**
 * `spectacle` entries (Bits, Hype Train, raids) retry on their own clock, so a realm that cannot take one yet never
 * holds presence or cleanup behind it. Presence keeps its strict order.
 */
interface Entry {
  readonly file: string; readonly body: string; readonly bytes: number; readonly urgent: boolean;
  readonly spectacle: boolean; readonly queuedAt: number; failures: number; retryAt: number;
}
export interface RealmDeliveryOptions {
  readonly url: string;
  readonly secret: string;
  readonly directory: string;
  readonly repositoryRoot?: string | null;
  readonly origin: 'live' | 'simulated';
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly retryMs?: number;
}

/** Durable bounded evidence outbox; speech and private wishes never enter it or retry. */
export class RealmDelivery implements RealmDeliverySink {
  readonly #entries: Entry[] = [];
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #directory: string;
  readonly #base: URL;
  #bytes = 0;
  #fileStamp = 0;
  #serial: Promise<void> = Promise.resolve();
  #flushing: Promise<void> | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #failures = 0;
  #transient = 0;
  #closed = false;
  #fault: 'storage' | 'capacity' | 'delivery' | null = null;
  readonly #counters = { accepted: 0, delivered: 0, retries: 0, refused: 0, transientSent: 0, transientDropped: 0, expired: 0, strikesSent: 0, strikesDropped: 0 };
  #strikes = 0;
  #spectacleWake: ReturnType<typeof setTimeout> | null = null;

  private constructor(readonly options: RealmDeliveryOptions) {
    this.#base = realmUrl(options.url);
    if (!/^[\x21-\x7e]{32,512}$/.test(options.secret)) throw new Error('REALM_INGRESS_HERALD_SECRET must contain 32–512 printable characters');
    if (!isAbsolute(options.directory)) throw new Error('HERALD_REALM_OUTBOX_DIR must be absolute');
    this.#directory = resolve(options.directory);
    if (options.repositoryRoot) {
      const path = relative(resolve(options.repositoryRoot), this.#directory);
      if (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)) throw new Error('Herald realm outbox must be outside the repository');
    }
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  static async open(options: RealmDeliveryOptions): Promise<RealmDelivery> {
    const sender = new RealmDelivery(options);
    await mkdir(sender.#directory, { recursive: true, mode: 0o700 });
    const info = await stat(sender.#directory);
    if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('Herald realm outbox must be owner-only');
    const contents = await readdir(sender.#directory);
    // A crash before the atomic rename leaves only an uncommitted normalized temporary file.
    for (const file of contents.filter(file => /^\d{16}-[a-f0-9-]+\.json\.tmp$/.test(file))) await rm(join(sender.#directory, file));
    const files = contents.filter(file => /^\d{16}-[a-f0-9-]+\.json$/.test(file)).sort();
    if (files.length > MAX_PENDING + CLEANUP_RESERVE) throw new Error('Herald realm outbox exceeds capacity');
    for (const file of files) {
      sender.#fileStamp = Math.max(sender.#fileStamp, Number(file.slice(0, 16)));
      const path = join(sender.#directory, file), metadata = await stat(path);
      if ((metadata.mode & 0o077) !== 0 || metadata.size > MAX_BYTES || sender.#bytes + metadata.size > MAX_BYTES) throw new Error('Herald realm outbox is insecure or too large');
      const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
      const support = SupportEnvelope.safeParse(raw), moment = support.success ? null : MomentEnvelope.safeParse(raw);
      const envelope = support.success ? support.data : moment?.success ? moment.data : null;
      const input = envelope ? null : PresenceInputSchema.parse(raw);
      const origin = support.success ? support.data.support.origin : moment?.success ? moment.data.moment.origin : input!.origin;
      if (origin !== options.origin && origin !== 'recovered') throw new Error('Herald realm outbox origin differs');
      sender.#entries.push({ file, body: JSON.stringify(envelope ?? { version: 1, observation: input }), bytes: metadata.size, urgent: input !== null && urgent(input),
        spectacle: moment?.success === true, queuedAt: Number(file.slice(0, 16)), failures: 0, retryAt: 0 });
      sender.#bytes += metadata.size;
    }
    void sender.flush();
    return sender;
  }

  health() {
    return { configured: true, pending: this.#entries.length, spectacles: this.#entries.filter(entry => entry.spectacle).length, bytes: this.#bytes,
      transient: this.#transient, fault: this.#fault, counters: { ...this.#counters } };
  }

  observation(raw: PresenceInput): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const input = PresenceInputSchema.parse(raw);
    if (input.origin !== this.options.origin && input.origin !== 'recovered') throw new Error('Herald realm outbox origin differs');
    const cleanup = input.kind === 'source-lost' || input.kind === 'remove' || input.kind === 'stream';
    return this.#enqueue(input, { version: 1, observation: input }, cleanup, urgent(input));
  }

  support(raw: RealmSupportObservation): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const input = RealmSupportObservationSchema.parse(raw);
    if (input.origin !== this.options.origin) throw new Error('Herald realm outbox origin differs');
    const envelope = { version: 1 as const, support: input };
    return this.#enqueue(envelope, envelope, false, false);
  }

  /** Bits, Hype Train and raid evidence, durable under its EventSub message ID on its own retry lane. */
  moment(raw: RealmMomentObservation): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const input = RealmMomentObservationSchema.parse(raw);
    if (input.origin !== this.options.origin) throw new Error('Herald realm outbox origin differs');
    const envelope = { version: 1 as const, moment: input };
    return this.#enqueue(envelope, envelope, false, false, true);
  }

  /** A witnessed `!strike`. Transient: sent once while its chat still stands, never stored or resent. */
  strike(raw: RealmStrike, current: () => boolean): void {
    const parsed = RealmStrikeSchema.safeParse(raw);
    if (this.#closed || !parsed.success || parsed.data.origin !== this.options.origin || this.#strikes >= MAX_STRIKES_IN_FLIGHT || !current()) {
      this.#counters.strikesDropped++; return;
    }
    this.#strikes++;
    void this.#post(INGRESS_ROUTE, JSON.stringify({ version: 1, strike: parsed.data })).then(response => {
      if (response.status === 202) this.#counters.strikesSent++; else this.#counters.strikesDropped++;
      void response.body?.cancel();
    }, () => { this.#counters.strikesDropped++; }).finally(() => { this.#strikes--; });
  }

  #enqueue(stored: unknown, envelope: unknown, cleanup: boolean, isUrgent: boolean, spectacle = false): Promise<void> {
    const data = JSON.stringify(stored), bytes = Buffer.byteLength(data);
    return this.#serialize(async () => {
      if (spectacle && this.#entries.filter(entry => entry.spectacle).length >= MAX_SPECTACLES) { this.#fault = 'capacity'; this.#counters.refused++; return; }
      if (this.#entries.length >= MAX_PENDING + (cleanup ? CLEANUP_RESERVE : 0) || this.#bytes + bytes > MAX_BYTES - (cleanup ? 0 : 1024 * 1024)) {
        this.#fault = 'capacity'; this.#counters.refused++; return;
      }
      this.#fileStamp = Math.max(this.#now(), this.#fileStamp + 1);
      const file = `${String(this.#fileStamp).padStart(16, '0')}-${randomUUID()}.json`;
      const path = join(this.#directory, file), temporary = `${path}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, path);
        await this.#syncDirectory();
        this.#entries.push({ file, body: JSON.stringify(envelope), bytes, urgent: isUrgent, spectacle, queuedAt: this.#now(), failures: 0, retryAt: 0 });
        this.#bytes += bytes; this.#counters.accepted++;
        if (isUrgent && this.#retry) { clearTimeout(this.#retry); this.#retry = null; }
      } catch {
        this.#fault = 'storage'; this.#counters.refused++;
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    }).then(() => { void this.flush(); });
  }

  speech(input: Parameters<RealmDeliverySink['speech']>[0], current: () => boolean): void {
    if (!current()) return;
    const common = { kingdomId: input.kingdomId, personId: input.personId, origin: this.options.origin };
    if (input.words !== null) {
      this.#sendTransient({ version: 1, forge: { type: 'wish', origin: this.options.origin,
        command: { kingdomId: input.kingdomId, personId: input.personId, messageId: input.messageId,
          slot: 0, words: input.words, observedAt: input.observedAt } } }, current);
    } else if (input.parts.length && this.#now() < input.observedAt + 10_000) {
      this.#sendTransient({ version: 1, chat: { version: 1, ...common, id: input.messageId,
        asOf: input.observedAt, expiresAt: input.observedAt + 10_000, parts: input.parts } }, current);
    }
  }

  remove(kingdomId: Parameters<RealmDeliverySink['remove']>[0], messageId: string): void {
    this.#sendTransient({ version: 1, chatCleanup: { type: 'remove', origin: this.options.origin, kingdomId, messageIds: [messageId] } }, undefined, true);
    this.#sendTransient({ version: 1, forge: { type: 'cancel', origin: this.options.origin, kingdomId, messageId } }, undefined, true);
  }

  clear(kingdomId: Parameters<RealmDeliverySink['clear']>[0], personId?: Parameters<RealmDeliverySink['clear']>[1]): void {
    const target = { origin: this.options.origin, kingdomId, ...(personId ? { personId } : {}) };
    this.#sendTransient({ version: 1, chatCleanup: { type: 'clear', ...target } }, undefined, true);
    this.#sendTransient({ version: 1, forge: { type: 'clear', ...target } }, undefined, true);
  }

  flush(): Promise<void> {
    if (this.#flushing) return this.#flushing;
    if (this.#closed || this.#retry) return Promise.resolve();
    const run = (async () => {
      await this.#serial;
      while (!this.#closed && this.#entries.length) {
        // Cleanup overtakes queued activity. Reducer timestamps fence any older evidence delivered later. A due spectacle
        // goes next: a cheer or a train's beat is felt the moment it happens, and in a hype train's chat burst it would
        // otherwise wait out every queued presence post. Presence carries its own timestamps, so it loses nothing.
        const now = this.#now();
        const due = this.#entries.filter(entry => !entry.spectacle || entry.retryAt <= now);
        const entry = due.find(entry => entry.urgent) ?? due.find(entry => entry.spectacle) ?? due[0];
        if (!entry) { this.#wakeForSpectacles(); return; }
        try {
          const response = await this.#post(INGRESS_ROUTE, entry.body);
          const result: unknown = await response.json();
          if (response.status !== 202 || !result || typeof result !== 'object' || !('status' in result)
            || result.status !== 'accepted' && result.status !== 'duplicate') throw new Error('Realm has not acknowledged evidence');
          await this.#remove(entry, 'delivered');
          if (!entry.spectacle) { this.#failures = 0; this.#fault = null; }
        } catch {
          if (entry.spectacle) {
            // Its own clock: the presence behind it is never held. A beat long past is let go.
            this.#counters.retries++; entry.failures++;
            if (this.#now() - entry.queuedAt > SPECTACLE_LIFETIME_MS) await this.#remove(entry, 'expired').catch(() => undefined);
            else entry.retryAt = this.#now() + Math.min(30_000, (this.options.retryMs ?? 500) * 2 ** Math.min(6, entry.failures - 1));
            continue;
          }
          this.#failures++; this.#fault = 'delivery'; this.#counters.retries++;
          const delay = !entry.urgent && this.#entries.some(pending => pending.urgent) ? 0
            : Math.min(30_000, (this.options.retryMs ?? 500) * 2 ** Math.min(6, this.#failures - 1));
          this.#retry = setTimeout(() => { this.#retry = null; void this.flush(); }, delay);
          this.#retry.unref?.(); return;
        }
      }
    })().finally(() => { if (this.#flushing === run) this.#flushing = null; });
    this.#flushing = run;
    return run;
  }

  #remove(entry: Entry, counter: 'delivered' | 'expired'): Promise<void> {
    return this.#serialize(async () => {
      await rm(join(this.#directory, entry.file)); await this.#syncDirectory();
      const at = this.#entries.indexOf(entry);
      if (at >= 0) { this.#entries.splice(at, 1); this.#bytes -= entry.bytes; this.#counters[counter]++; }
    });
  }

  /** Only spectacles are waiting, each on its own clock: come back for the earliest. */
  #wakeForSpectacles(): void {
    if (this.#closed || !this.#entries.length) return;
    if (this.#spectacleWake) clearTimeout(this.#spectacleWake);
    const next = Math.min(...this.#entries.map(entry => entry.retryAt));
    this.#spectacleWake = setTimeout(() => { this.#spectacleWake = null; void this.flush(); }, Math.max(0, next - this.#now()));
    this.#spectacleWake.unref?.();
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#retry) clearTimeout(this.#retry);
    if (this.#spectacleWake) clearTimeout(this.#spectacleWake);
    this.#retry = null;
    await this.#serial;
    await this.#flushing;
  }

  #sendTransient(raw: RealmHeraldEnvelope, current?: () => boolean, cleanup = false): void {
    const parsed = RealmHeraldEnvelopeSchema.safeParse(raw);
    // Reserve a separate bounded cleanup allowance, so a slow wish never blocks its cancellation.
    if (this.#closed || this.#transient >= MAX_TRANSIENT + (cleanup ? 32 : 0) || !parsed.success || current && !current()) {
      this.#counters.transientDropped++; return;
    }
    this.#transient++;
    void this.#post(REALM_HERALD_ROUTE, JSON.stringify(parsed.data)).then(response => {
      if (response.status === 202) this.#counters.transientSent++;
      else this.#counters.transientDropped++;
      void response.body?.cancel();
    }, () => { this.#counters.transientDropped++; }).finally(() => { this.#transient--; });
  }

  #post(route: string, body: string): Promise<Response> {
    return this.#fetch(new URL(route, this.#base), { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${this.options.secret}`, 'content-type': 'application/json' },
      body, signal: AbortSignal.timeout(5_000) });
  }
  #serialize(task: () => Promise<void>): Promise<void> {
    const run = this.#serial.then(task);
    this.#serial = run.catch(() => undefined);
    return run;
  }
  async #syncDirectory(): Promise<void> {
    const handle = await open(this.#directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
}

function realmUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('HERALD_REALM_URL must be an origin');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('HERALD_REALM_URL needs HTTPS or loopback HTTP');
  return url;
}

function urgent(input: PresenceInput): boolean {
  return input.kind === 'source-lost' || input.kind === 'remove' || input.kind === 'stream' && !input.live;
}
