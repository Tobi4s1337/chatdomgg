import { randomInt, randomUUID } from 'node:crypto';
import { CAMPFIRE_MESSAGES, CampfireActSchema, DUSK_COURT, kingdomForBroadcaster, type CampfireFrame, type CampfireSelf, type GatherChatEnvelope, type PersonId } from '@chatdom/shared';
import type { RealmPrincipal } from '@chatdom/shared/realm';
import type { CampfireSeatHost } from '../interactions/hosts';
import type { InteractionAdmission } from '../interactions/ports';
import { advance, call, choose, courtSelf, courtView, openCourt, seatedNow, suspect, type CourtSeat, type CourtState } from './court';
import type { FireStore } from './store';

/** The kingdom room as the fire uses it. Delivery to one person goes to their current session only. */
export interface FireRoomPort {
  on(type: string, handler: (principal: RealmPrincipal, raw: unknown) => void): void;
  send(personId: string, type: string, message: unknown): void;
  broadcast(type: string, message: unknown): void;
  /** The approved public name of a person walking in this room now, else null. */
  nameOf(personId: string): string | null;
}
export interface FireOptions {
  readonly kingdomId: string;
  readonly site?: string;
  readonly store?: FireStore;
  readonly clock?: () => number;
  readonly seed?: () => number;
  /** Ticks while a room is attached. Tests drive `tick` themselves with `tickMs: 0`. */
  readonly tickMs?: number;
}

const HEARTBEAT_MS = 5_000;
const MAX_MESSAGE_IDS = 4_096;
const clone = <T>(value: T): T => structuredClone(value);

/**
 * One kingdom's fire: the physical logs (as the kingdom room's `CampfireSeatHost`), the round, its checkpoint and
 * its delivery. Logs are ordinary seats; the round only reads who sits where. Every accepted change is saved before
 * it is published, mutations run one at a time, and a seat's secrets are only ever sent to that seat's person.
 */
export class CampfireFire {
  readonly kingdomId: string;
  readonly site: string;
  private readonly store: FireStore | undefined;
  private readonly clock: () => number;
  private readonly seed: () => number;
  private readonly tickMs: number;
  private court: CourtState | null = null;
  private version: number | null = null;
  private restored: Promise<void> | null = null;
  private storeHealthy = true;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly occupancy = new Map<number, { person: string; generation: number | null }>();
  private room: FireRoomPort | null = null;
  private live: () => boolean = () => false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastFrame = '';
  private lastFrameAt = 0;
  private readonly lastSelf = new Map<string, string>();
  private readonly messageIds = new Set<string>();

  constructor(options: FireOptions) {
    this.kingdomId = options.kingdomId; this.site = options.site ?? 'clearing'; this.store = options.store;
    this.clock = options.clock ?? Date.now; this.seed = options.seed ?? (() => randomInt(0, 0x1_0000_0000));
    this.tickMs = options.tickMs ?? 250;
  }

  /** The kingdom room's campfire seat host: the Magistrate's chair is the streamer's, a round's logs are its players'. */
  readonly seats: CampfireSeatHost = {
    admit: async ({ site, seat, personId }): Promise<InteractionAdmission> => {
      await this.restore();
      if (site !== this.site || !Number.isInteger(seat) || seat < 0 || seat > 12) return { admitted: false, reason: 'refused' };
      if (seat === 0 && !this.monarch(personId)) return { admitted: false, reason: 'refused' };
      const court = this.court, running = court && court.phase !== 'call' && court.phase !== 'ended';
      if (running && seat > 0) {
        const holder = court.players.find(p => p.seat === seat && !p.gone);
        if (holder && holder.person !== personId) return { admitted: false, reason: 'refused' };
        const mine = court.players.find(p => p.person === personId && !p.gone);
        if (mine && mine.seat !== seat) return { admitted: false, reason: 'refused' };
      }
      return { admitted: true, cancel: () => {}, seated: ({ generation }) => {
        this.occupancy.set(seat, { person: personId, generation }); this.nudge();
      } };
    },
    released: (held) => {
      if (held.place.site !== this.site) return;
      const current = this.occupancy.get(held.place.seat);
      if (current && current.person === held.personId && (current.generation === null || current.generation === held.generation)) {
        this.occupancy.delete(held.place.seat); this.nudge();
      }
    },
  };

  /** The kingdom's liveness, from its own stream record (the evening attach knows it). */
  bindLive(live: () => boolean): () => void {
    this.live = live;
    return () => { if (this.live === live) this.live = () => false; };
  }

  /** The kingdom room. Messages: `campfire.act`, `campfire.hello`; frames and self views go out through the port. */
  attachRoom(port: FireRoomPort): () => void {
    this.room = port;
    port.on(CAMPFIRE_MESSAGES.act, (principal, raw) => { void this.act(principal, raw); });
    port.on(CAMPFIRE_MESSAGES.hello, principal => { void this.restore().then(() => this.hello(principal.personId)); });
    void this.restore().then(() => this.nudge());
    if (this.tickMs > 0) { this.timer = setInterval(() => this.tick(), this.tickMs); this.timer.unref?.(); }
    return () => {
      if (this.room !== port) return;
      clearInterval(this.timer); this.timer = undefined; this.room = null;
      this.occupancy.clear(); this.lastSelf.clear(); this.lastFrame = '';
    };
  }

  restore(): Promise<void> {
    this.restored ??= (async () => {
      if (!this.store) return;
      try {
        const snapshot = await this.store.load(this.kingdomId, this.site);
        this.version = snapshot?.version ?? null; this.court = snapshot?.court ?? null; this.storeHealthy = true;
      } catch (error) {
        this.storeHealthy = false;
        console.error('The campfire could not read its checkpoint; rounds wait until it can.', error);
        this.restored = null;
      }
    })();
    return this.restored;
  }

  private monarch(personId: string): boolean {
    try { return kingdomForBroadcaster(personId as PersonId) === this.kingdomId; } catch { return false; }
  }
  private presiding(): boolean {
    const chair = this.occupancy.get(0);
    return !!chair && this.monarch(chair.person) && this.live();
  }
  private roster(): CourtSeat[] {
    const seated: CourtSeat[] = [];
    for (const [seat, { person }] of this.occupancy) {
      if (seat < 1) continue;
      const name = this.room?.nameOf(person);
      if (name) seated.push({ seat, person, name });
    }
    return seated.sort((a, b) => a.seat - b.seat);
  }

  /** Run one change at a time; adopt and publish it only once it is saved. */
  private mutate<T>(work: (draft: CourtState | null, now: number) => { next: CourtState | null; outcome: T }): Promise<T | 'unavailable'> {
    const run = this.queue.then(async () => {
      await this.restore();
      const now = this.clock(), before = this.court;
      const { next, outcome } = work(before ? clone(before) : null, now);
      if (JSON.stringify(next) !== JSON.stringify(before)) {
        if (this.store) {
          try {
            const result = await this.store.save(this.kingdomId, this.site, this.version, { version: (this.version ?? 0) + 1, at: now, court: next });
            if (result !== 'committed') throw new Error('The campfire checkpoint moved underneath this fire.');
            this.version = (this.version ?? 0) + 1; this.storeHealthy = true;
          } catch (error) {
            if (this.storeHealthy) console.error('The campfire could not save; nothing was changed.', error);
            this.storeHealthy = false;
            // Re-read the durable truth before the next change.
            this.restored = null;
            return 'unavailable' as const;
          }
        }
        this.court = next;
      }
      this.publish(now);
      return outcome;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Clock and presence: called by the room's timer, and after every seat change. */
  tick(): Promise<unknown> {
    if (!this.court && this.occupancy.size === 0 && !this.lastFrame) return Promise.resolve();
    return this.mutate((draft, now) => {
      if (!draft) return { next: null, outcome: null };
      seatedNow(draft, this.roster(), now);
      const state = advance(draft, now, this.presiding());
      return { next: state === 'running' ? draft : null, outcome: state };
    });
  }
  private nudge(): void { void this.tick(); }

  async act(principal: RealmPrincipal, raw: unknown): Promise<boolean> {
    const parsed = CampfireActSchema.safeParse(raw);
    if (!parsed.success || principal.kingdomId !== this.kingdomId) return false;
    const act = parsed.data, person = principal.personId;
    const outcome = await this.mutate((draft, now) => {
      const seat = [...this.occupancy].find(([, o]) => o.person === person)?.[0] ?? null;
      if (draft) { seatedNow(draft, this.roster(), now); advance(draft, now, this.presiding()); }
      if (act.action === 'ask') {
        if (!this.canAsk(draft, seat)) return { next: draft, outcome: false };
        return { next: openCourt(`fire-${randomUUID()}`, this.seed(), now, this.roster()), outcome: true };
      }
      if (!draft || draft.match !== act.match) return { next: draft, outcome: false };
      if (act.action === 'call') {
        if (seat !== 0 || !this.presiding()) return { next: draft, outcome: false };
        return { next: draft, outcome: call(draft, now) === 'accepted' };
      }
      const mine = draft.players.find(p => p.person === person);
      if (!mine || seat !== mine.seat) return { next: draft, outcome: false };
      return { next: draft, outcome: choose(draft, mine.seat, act.seat) === 'accepted' };
    });
    const accepted = outcome === true;
    this.room?.send(person, CAMPFIRE_MESSAGES.receipt, { id: act.id, accepted });
    return accepted;
  }

  /** The Gallery, from Twitch chat through the herald: `!sus name`, once per identity per day. */
  async chat(envelope: GatherChatEnvelope): Promise<'counted' | 'ignored'> {
    if (envelope.kingdomId !== this.kingdomId) return 'ignored';
    if (envelope.kind === 'cleanup') {
      // A timeout, ban or deleted line takes that identity's suspicion back for today.
      const done = await this.mutate(draft => {
        if (draft && Object.hasOwn(draft.gallery.counted, envelope.twitchId)) { delete draft.gallery.counted[envelope.twitchId]; draft.revision += 1; }
        return { next: draft, outcome: 'ignored' as const };
      });
      return done === 'unavailable' ? 'ignored' : done;
    }
    if (envelope.command !== 'sus' || !envelope.arg) return 'ignored';
    if (this.messageIds.has(envelope.messageId)) return 'ignored';
    this.messageIds.add(envelope.messageId);
    if (this.messageIds.size > MAX_MESSAGE_IDS) this.messageIds.delete(this.messageIds.values().next().value!);
    const outcome = await this.mutate(draft => draft ? { next: draft, outcome: suspect(draft, envelope.chatter.twitchId, envelope.arg!) } : { next: draft, outcome: 'ignored' as const });
    return outcome === 'unavailable' ? 'ignored' : outcome;
  }

  private canAsk(court: CourtState | null, seat: number | null): boolean {
    if (court && court.phase !== 'ended') return false;
    if (seat === null || (seat === 0 && !this.presiding()) || !this.storeHealthy) return false;
    return this.roster().length >= DUSK_COURT.minPlayers;
  }

  frame(now = this.clock()): CampfireFrame {
    const presiding = this.presiding(), chair = this.occupancy.get(0);
    const seated: { seat: number; name: string }[] = [];
    for (const [seat, { person }] of [...this.occupancy].sort(([a], [b]) => a - b)) {
      const name = this.room?.nameOf(person);
      if (name) seated.push({ seat, name });
    }
    return { at: now, site: this.site, live: this.live(), magistrate: presiding && chair ? this.room?.nameOf(chair.person) ?? null : null,
      seated, court: this.court ? courtView(this.court) : null };
  }

  self(person: string): CampfireSelf {
    const seat = [...this.occupancy].find(([, o]) => o.person === person)?.[0] ?? null;
    const court = this.court, magistrate = seat === 0 && this.presiding();
    const own = court ? courtSelf(court, person) : { match: null, role: null, wolves: [], choice: null, answers: [] };
    return { seat, magistrate, canAsk: this.canAsk(court, seat),
      canCall: !!court && magistrate && (court.phase === 'talk' || court.waiting), ...own };
  }

  private hello(person: string): void {
    const room = this.room;
    if (!room) return;
    room.send(person, CAMPFIRE_MESSAGES.frame, this.frame());
    const self = this.self(person), text = JSON.stringify(self);
    this.lastSelf.set(person, text);
    room.send(person, CAMPFIRE_MESSAGES.self, self);
  }

  /** Frames go to everyone when they change (and as a slow heartbeat); a self view only ever to its own person. */
  private publish(now: number): void {
    const room = this.room;
    if (!room) return;
    const frame = this.frame(now), text = JSON.stringify({ ...frame, at: 0 });
    if (text !== this.lastFrame || now - this.lastFrameAt >= HEARTBEAT_MS) {
      if (text !== this.lastFrame || this.court || this.occupancy.size) room.broadcast(CAMPFIRE_MESSAGES.frame, frame);
      this.lastFrame = text; this.lastFrameAt = now;
    }
    const people = new Set<string>([...this.occupancy.values()].map(o => o.person));
    for (const player of this.court?.players ?? []) people.add(player.person);
    for (const person of [...this.lastSelf.keys()]) if (!people.has(person)) people.add(person);
    for (const person of people) {
      const self = this.self(person), json = JSON.stringify(self);
      if (this.lastSelf.get(person) === json) continue;
      if (self.seat === null && !self.match) this.lastSelf.delete(person); else this.lastSelf.set(person, json);
      room.send(person, CAMPFIRE_MESSAGES.self, self);
    }
  }

  dispose(): void { clearInterval(this.timer); this.timer = undefined; this.room = null; }
}
