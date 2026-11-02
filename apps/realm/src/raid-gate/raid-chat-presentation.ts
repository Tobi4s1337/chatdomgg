import { createHmac, randomBytes } from 'node:crypto';
import { EpochMsSchema, KingdomIdSchema, PresenceInputSchema, RAID_CHAT_CUE_TTL_MS, RAID_CHAT_MAX_CUES, RAID_CHAT_FRAME_MAX_BYTES,
  RAID_CHAT_LIGHT_LEASE_MS, RaidChatCueSchema, RaidChatLightSchema, type KingdomId, type PresenceInput, type RaidChatCue,
  type RaidChatLight, type RaidChatFrame } from '@chatdom/shared';
import { RealmHeraldEnvelopeSchema, type RealmHeraldChat, type RealmHeraldEnvelope } from '@chatdom/shared/realm';
import { RaidChatQualificationSchema, type RaidChatQualification } from './raid-chat-contracts';
import type { RaidGuestChatResult } from './guests';

export const RAID_CHAT_JOIN_MS = 1_000;
export const RAID_CHAT_MAX_PENDING = 64;
const MAX_PROOFS = 1_024, MAX_ACTIVE = 256, MAX_FENCES = 4_096;
type Handled = 'handled' | 'unhandled';
type Proof = { asOf: number; until: number; qualified: RaidChatQualification | null; duplicate: boolean };
type Pending = { chat: RealmHeraldChat; promise: Promise<Handled>; resolve(value: Handled): void; timer: ReturnType<typeof setTimeout> };
type Active = { personId: string; messageId: string; cue: RaidChatCue };
type Light = { personId: string; messageId: string; light: RaidChatLight };
type Cutoff = { through: number; until: number };

/**
 * Process-local, disposable join of two EXISTING trusted deliveries. Only observe's committed authority result
 * can qualify speech. No SQL, person roster, home slot, avatar or text recovery path exists here. The host must
 * feed this only authenticated Herald envelopes, and clear a kingdom whenever its retained writer disappears.
 *
 * Work is capped at 1,024 proof/seen keys, 64 waiting speech bodies (one second), 256 active bodies globally and
 * 32 per frame, plus 256 text-free lights on their original ninety-second presence lease. One author's latest
 * bubble replaces their previous bubble and shares the same opaque light. Ninety-second tombstones survive
 * cleanup-before-chat. Fence saturation temporarily fails closed, never evicts a
 * tombstone to make deleted text eligible. Detach/restart cannot re-stage pre-instance speech.
 */
export class RaidChatPresentation {
  private readonly secret = randomBytes(32);
  private readonly proofs = new Map<string, Proof>();
  private readonly pending = new Map<string, Pending>();
  private readonly active = new Map<string, Active>();
  private readonly lights = new Map<string, Light>();
  private readonly seen = new Map<string, number>();
  private readonly removed = new Map<string, number>();
  private readonly cleared = new Map<string, Cutoff>();
  private readonly startedAt: number;
  private mutedUntil = 0;
  private closed = false;
  private readonly expiry: ReturnType<typeof setInterval>;
  constructor(readonly options: { readonly origin: 'live' | 'simulated'; readonly clock?: () => number }) {
    this.startedAt = this.now();
    this.expiry = setInterval(() => this.sweep(), 1_000); this.expiry.unref();
  }

  observe(raw: PresenceInput, result: RaidGuestChatResult | null): void {
    if (this.closed) return;
    const parsed = PresenceInputSchema.safeParse(raw);
    if (!parsed.success || parsed.data.origin !== this.options.origin) return;
    const input = parsed.data; this.sweep();
    if (input.kind === 'remove') { this.cutoff(input.kingdomId, input.personId, input.observedAt); return; }
    if (input.kind === 'source-lost' && input.sources.includes('chat') || input.kind === 'stream' && !input.live) {
      this.clear(input.kingdomId); return;
    }
    if (input.kind !== 'observe' || input.source !== 'chat' || input.people.length !== 1 || !input.id.startsWith('chat:')) return;
    const messageId = input.id.slice(5), key = this.key(input.kingdomId, messageId), person = input.people[0]!;
    if (input.observedAt < this.startedAt || input.observedAt > this.now() || input.observedAt + RAID_CHAT_LIGHT_LEASE_MS <= this.now()) return;
    // Repeated authority delivery cannot erase the first accepted result or mint another disposable effect.
    if (this.proofs.has(key) || this.seen.has(key)) return;
    // Ordinary volume drops a new disposable effect; it never extinguishes already witnessed lights.
    if (this.proofs.size >= MAX_PROOFS) return;
    const metadata = result && result.status !== 'ignored' ? RaidChatQualificationSchema.safeParse(result.presentation) : null;
    const qualified = person.disclosure === 'named' && result?.status === 'accepted' && metadata?.success
      && metadata.data.origin === input.origin && metadata.data.kingdomId === input.kingdomId
      && metadata.data.messageId === input.id && metadata.data.personId === person.personId
      && metadata.data.at === (input.providerAt ?? input.observedAt) ? metadata.data : null;
    this.proofs.set(key, { asOf: input.observedAt, until: input.observedAt + RAID_CHAT_CUE_TTL_MS,
      qualified, duplicate: result?.status === 'duplicate' });
    if (qualified && !this.blocked({ kingdomId: input.kingdomId, id: messageId, personId: person.personId, asOf: input.observedAt })) {
      const lightId = this.lightKey(qualified), previous = this.lights.get(lightId);
      if (!previous || previous.light.asOf < input.observedAt) {
        if (this.lights.size >= MAX_ACTIVE && !previous) this.dropLight(this.lights.keys().next().value!);
        this.lights.delete(lightId);
        this.lights.set(lightId, { personId: person.personId, messageId, light: {
          lightId, kingdomId: input.kingdomId, origin: qualified.origin, raid: qualified.raid,
          asOf: input.observedAt, expiresAt: input.observedAt + RAID_CHAT_LIGHT_LEASE_MS,
        } });
      }
    }
    const pending = this.pending.get(key);
    if (pending) this.finish(key, this.present(pending.chat));
  }

  /** Cleanup is synchronous before returning this Promise; callers also pass it to ordinary speech cleanup. */
  accept(raw: RealmHeraldEnvelope): Promise<Handled> {
    if (this.closed) return Promise.resolve('unhandled');
    const parsed = RealmHeraldEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return Promise.resolve('unhandled');
    const input = parsed.data; this.sweep();
    if ('chatCleanup' in input) {
      const cleanup = input.chatCleanup;
      if (cleanup.origin !== this.options.origin) return Promise.resolve('unhandled');
      if (cleanup.type === 'clear') this.cutoff(cleanup.kingdomId, cleanup.personId, this.now());
      else for (const id of cleanup.messageIds) {
        const key = this.key(cleanup.kingdomId, id);
        if (this.removed.size + this.cleared.size >= MAX_FENCES && !this.removed.has(key)) { this.failClosed(); break; }
        this.removed.set(key, this.now() + RAID_CHAT_LIGHT_LEASE_MS); this.active.delete(key); this.finish(key, 'handled');
        for (const [lightId, value] of this.lights) if (value.light.kingdomId === cleanup.kingdomId && value.messageId === id) this.dropLight(lightId);
      }
      return Promise.resolve('unhandled');
    }
    if (!('chat' in input) || input.chat.origin !== this.options.origin) return Promise.resolve('unhandled');
    const chat = input.chat, key = this.key(chat.kingdomId, chat.id);
    if (this.blocked(chat) || this.seen.has(key)) return Promise.resolve('handled');
    if (!this.fresh(chat)) return Promise.resolve('unhandled');
    if (this.proofs.has(key)) return Promise.resolve(this.present(chat));
    const prior = this.pending.get(key);
    // A colliding private envelope cannot replace the original author's text while evidence is in flight.
    if (prior) return Promise.resolve('handled');
    if (this.pending.size >= RAID_CHAT_MAX_PENDING) return Promise.resolve('unhandled');
    let resolve!: (value: Handled) => void;
    const promise = new Promise<Handled>(done => { resolve = done; });
    const timer = setTimeout(() => this.finish(key, 'unhandled'), Math.min(RAID_CHAT_JOIN_MS, chat.expiresAt - this.now()));
    timer.unref(); this.pending.set(key, { chat, promise, resolve, timer });
    return promise;
  }

  read(kingdomId: KingdomId | string): RaidChatFrame {
    const kingdom = KingdomIdSchema.parse(kingdomId); this.sweep();
    const asOf = this.now();
    const lights = this.closed ? [] : [...this.lights.values()].filter(value => value.light.kingdomId === kingdom
      && value.light.asOf <= asOf && value.light.expiresAt > asOf).map(value => value.light).slice(-RAID_CHAT_MAX_CUES);
    const visible = new Set(lights.map(light => light.lightId));
    const cues = this.closed ? [] : [...this.active.values()].filter(value => value.cue.kingdomId === kingdom
      && value.cue.asOf <= asOf && value.cue.expiresAt > asOf && visible.has(value.cue.lightId))
      .map(value => value.cue).slice(-RAID_CHAT_MAX_CUES);
    // Fresh copies keep an HTTP consumer from mutating another reader's live projection.
    const frame: RaidChatFrame = { version: 1, kingdomId: kingdom, origin: this.options.origin, asOf,
      lights: lights.map(light => RaidChatLightSchema.parse(light)), cues: cues.map(cue => RaidChatCueSchema.parse(cue)) };
    // UTF-8 emote/name maxima can cost more than a plain-text frame. Trim oldest whole cues, never text parts.
    while (Buffer.byteLength(JSON.stringify(frame), 'utf8') > RAID_CHAT_FRAME_MAX_BYTES) frame.cues.shift();
    return frame;
  }

  clear(kingdomId: KingdomId | string): void { this.cutoff(KingdomIdSchema.parse(kingdomId), undefined, this.now()); }
  close(): void {
    this.closed = true; clearInterval(this.expiry);
    for (const key of this.pending.keys()) this.finish(key, 'handled');
    this.active.clear(); this.lights.clear(); this.proofs.clear(); this.seen.clear(); this.removed.clear(); this.cleared.clear();
  }

  private present(chat: RealmHeraldChat): Handled {
    const key = this.key(chat.kingdomId, chat.id), proof = this.proofs.get(key);
    if (this.blocked(chat) || this.seen.has(key) || proof?.duplicate) return 'handled';
    if (!proof?.qualified || !this.fresh(chat) || proof.asOf !== chat.asOf
      || proof.qualified.personId !== chat.personId) return 'unhandled';
    if (this.seen.size >= MAX_PROOFS) return 'handled';
    const lightId = this.lightKey(proof.qualified);
    if (!this.lights.has(lightId)) return 'handled';
    const cue = RaidChatCueSchema.parse({ version: 1, id: `raid-chat.${this.digest([chat.origin, chat.kingdomId, chat.id])}`,
      lightId, kingdomId: chat.kingdomId, origin: chat.origin, asOf: chat.asOf, expiresAt: chat.expiresAt,
      raid: proof.qualified.raid, parts: chat.parts });
    this.seen.set(key, chat.asOf + RAID_CHAT_CUE_TTL_MS);
    for (const [oldKey, value] of this.active) if (value.cue.lightId === lightId) {
      // A delayed older message never replaces this author's newer speech or extends its lamp.
      if (value.cue.asOf >= chat.asOf) return 'handled';
      this.active.delete(oldKey);
    }
    if (this.active.size >= MAX_ACTIVE) this.active.delete(this.active.keys().next().value!);
    this.active.set(key, { personId: chat.personId, messageId: chat.id, cue });
    const roomKeys = [...this.active].filter(([, value]) => value.cue.kingdomId === chat.kingdomId).map(([id]) => id);
    if (roomKeys.length > RAID_CHAT_MAX_CUES) this.active.delete(roomKeys[0]!);
    return 'handled';
  }
  private fresh(chat: RealmHeraldChat): boolean {
    const now = this.now(); return chat.asOf >= this.startedAt && chat.asOf <= now && chat.expiresAt > now;
  }
  private blocked(chat: Pick<RealmHeraldChat, 'kingdomId' | 'personId' | 'id' | 'asOf'>): boolean {
    return this.now() < this.mutedUntil || this.removed.has(this.key(chat.kingdomId, chat.id))
      || [this.clearKey(chat.kingdomId), this.clearKey(chat.kingdomId, chat.personId)]
        .some(key => chat.asOf <= (this.cleared.get(key)?.through ?? -1));
  }
  private cutoff(kingdomId: string, personId: string | undefined, through: number): void {
    this.sweep(); const key = this.clearKey(kingdomId, personId);
    if (this.removed.size + this.cleared.size >= MAX_FENCES && !this.cleared.has(key)) { this.failClosed(); return; }
    this.cleared.set(key, { through: Math.max(through, this.cleared.get(key)?.through ?? 0), until: this.now() + RAID_CHAT_LIGHT_LEASE_MS });
    for (const [id, value] of this.active) if (value.cue.kingdomId === kingdomId
      && (personId === undefined || value.personId === personId) && value.cue.asOf <= through) this.active.delete(id);
    for (const [id, value] of this.lights) if (value.light.kingdomId === kingdomId
      && (personId === undefined || value.personId === personId) && value.light.asOf <= through) this.dropLight(id);
    for (const [id, value] of this.pending) if (value.chat.kingdomId === kingdomId
      && (personId === undefined || value.chat.personId === personId) && value.chat.asOf <= through) this.finish(id, 'handled');
  }
  private failClosed(): void {
    this.mutedUntil = this.now() + RAID_CHAT_LIGHT_LEASE_MS; this.active.clear(); this.lights.clear(); this.proofs.clear();
    for (const key of this.pending.keys()) this.finish(key, 'handled');
  }
  private finish(key: string, value: Handled): void {
    const pending = this.pending.get(key); if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(key); pending.resolve(value);
  }
  private sweep(): void {
    const now = this.now();
    for (const [key, value] of this.proofs) if (value.until <= now) this.proofs.delete(key);
    for (const [key, value] of this.active) if (value.cue.expiresAt <= now) this.active.delete(key);
    for (const [key, value] of this.lights) if (value.light.expiresAt <= now) this.dropLight(key);
    for (const map of [this.seen, this.removed]) for (const [key, until] of map) if (until <= now) map.delete(key);
    for (const [key, value] of this.cleared) if (value.until <= now) this.cleared.delete(key);
    for (const [key, value] of this.pending) if (value.chat.expiresAt <= now) this.finish(key, 'unhandled');
  }
  private key(kingdom: string, id: string): string { return JSON.stringify([kingdom, id]); }
  private digest(value: unknown): string { return createHmac('sha256', this.secret).update(JSON.stringify(value)).digest('hex'); }
  private lightKey(proof: RaidChatQualification): string {
    return `raid-light.${this.digest([proof.origin, proof.kingdomId, proof.raid.raidId, proof.personId])}`;
  }
  private dropLight(id: string): void {
    this.lights.delete(id);
    for (const [key, value] of this.active) if (value.cue.lightId === id) this.active.delete(key);
  }
  private clearKey(kingdom: string, person?: string): string { return JSON.stringify([kingdom, person ?? null]); }
  private now(): number { return EpochMsSchema.parse(Math.floor((this.options.clock ?? Date.now)())); }
}
