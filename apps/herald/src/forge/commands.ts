import { FORGE_WISH_WORDS_MAX, PersonIdSchema, PRESENCE_LEASE_MS, type KingdomId, type PersonId } from '@chatdom/shared';
import type { PresenceSource } from '../source/source';

/** Private creation input. This is never part of a presence frame, health report or public event. */
export interface ForgeChatCommand {
  readonly kingdomId: KingdomId;
  readonly personId: PersonId;
  readonly messageId: string;
  readonly slot: number;
  readonly words: string;
  readonly observedAt: number;
}
export interface ForgeCommandLease {
  readonly signal: AbortSignal;
  /** Recheck immediately before recording approval or revealing a piece. */
  current(): boolean;
}
/** A trusted server application supplies home/eligibility authority and both model gates. */
export type ForgeCommandSink = (command: ForgeChatCommand, lease: ForgeCommandLease) => Promise<void>;
export interface ForgeBroadcast {
  readonly live: boolean;
  readonly sessionId: string | null;
  readonly generation: number;
  /** Accepted stream state changes before the serialized presence projection is published. */
  onChange(listener: () => void): () => void;
}
export interface ForgeCommandApplication { readonly run: ForgeCommandSink; readonly broadcast: ForgeBroadcast }

/** Ordinary chat is discarded; only an explicitly addressed, bounded creation wish crosses this port. */
export function extractForgeWords(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || !('message' in raw)) return null;
  const message = raw.message;
  if (!message || typeof message !== 'object' || !('text' in message) || typeof message.text !== 'string' || message.text.length > 500) return null;
  const match = /^!forge\s+([\s\S]+)$/i.exec(message.text.trim());
  const words = match?.[1]?.trim();
  return words && words.length <= FORGE_WISH_WORDS_MAX ? words : null;
}

interface Work { readonly command: ForgeChatCommand; readonly abort: AbortController; readonly timer: ReturnType<typeof setTimeout>; current(): boolean }
const MAX_PENDING = 32;
const MAX_WAIT_MS = 600_000;

/** Bounded handoff, not an entitlement ledger or a public Forge. No sink means no text extraction. */
export class ForgeCommandHandoff {
  readonly #work = new Map<string, Work>();
  readonly #unsubscribe: () => void;
  #disposed = false;

  constructor(readonly source: PresenceSource, readonly application: ForgeCommandApplication, readonly now: () => number = Date.now) {
    const refresh = () => { for (const [id, work] of this.#work) if (!work.current()) this.cancel(id); };
    const sourceOff = source.subscribe({
      frame: refresh,
      unavailable: () => this.clear(),
    });
    const broadcastOff = application.broadcast.onChange(refresh);
    this.#unsubscribe = () => { sourceOff(); broadcastOff(); };
  }

  offer(input: { personId: string; messageId: string; words: string; observedAt: number }, valid: () => boolean): void {
    if (this.#disposed || this.#work.size >= MAX_PENDING || this.#work.has(input.messageId)) return;
    if (!Number.isFinite(input.observedAt) || input.observedAt > this.now() || this.now() - input.observedAt >= PRESENCE_LEASE_MS) return;
    const personId = PersonIdSchema.parse(input.personId), slot = this.source.boundSlot(personId);
    if (slot === null || input.words.length < 1 || input.words.length > FORGE_WISH_WORDS_MAX) return;
    const command: ForgeChatCommand = { ...input, personId, slot, kingdomId: this.source.kingdomId };
    const sessionId = this.application.broadcast.sessionId;
    const generation = this.application.broadcast.generation;
    const abort = new AbortController();
    const current = () => {
      const frame = this.source.current?.frame;
      return !this.#disposed && !abort.signal.aborted && valid() && this.source.origin === 'live'
        && this.application.broadcast.live && this.application.broadcast.sessionId === sessionId && sessionId !== null
        && this.application.broadcast.generation === generation
        && !!frame?.streamLive && frame.connection === 'fresh' && frame.asOf <= this.now()
        && this.now() - frame.asOf < PRESENCE_LEASE_MS
        && frame.windows.some(window => window.slot === slot && window.present && window.since <= command.observedAt);
    };
    if (!current()) return;
    const timer = setTimeout(() => this.cancel(input.messageId), MAX_WAIT_MS); timer.unref?.();
    const work = { command, abort, timer, current };
    this.#work.set(input.messageId, work);
    void Promise.resolve().then(() => {
      if (current()) return this.application.run(command, { signal: abort.signal, current });
    }).catch(() => { /* The application owns private failure reporting; no provider body is logged here. */ })
      .finally(() => { if (this.#work.get(input.messageId) === work) { clearTimeout(timer); this.#work.delete(input.messageId); } });
  }

  cancel(messageId: string): void {
    const work = this.#work.get(messageId); if (!work) return;
    // A slow provider still occupies its bounded slot until its promise settles.
    clearTimeout(work.timer); work.abort.abort();
  }
  cancelAuthor(personId: string): void { for (const [id, work] of this.#work) if (work.command.personId === personId) this.cancel(id); }
  clear(): void { for (const id of this.#work.keys()) this.cancel(id); }
  dispose(): void { this.#disposed = true; this.clear(); this.#unsubscribe(); }
}
