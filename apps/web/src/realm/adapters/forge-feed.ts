import type { CommittedForgeAttachment, ForgeActivity } from '@chatdom/shared/realm';
import type { ForgeObservationHandlers } from './forge';
import type { RealmObserver } from './observer';

/** App-local, entry-owned live ceremony. Standing snapshot parts never become a new ceremony. */
export interface RealmForgeFeed {
  subscribe(handlers: ForgeObservationHandlers): () => void;
  /** Acknowledge the actual landing, so a later scene revision cannot celebrate it again. */
  settled(attachmentId: string): void;
}

type Stage = Extract<ForgeActivity, { type: 'stage' }>['stage'];
const STAGES: readonly Stage[] = ['judging-words', 'drafting', 'assembling', 'judging-piece'];
const ENDED = STAGES.length, COMMITTED = ENDED + 1;
const WAIT_MS = 120_000, HANDOFF_MS = 90_000, MAX_PENDING = 32, MAX_SEEN = 1024;

/** One closure per entry UI, never persisted to browser storage or shared with a new visitor. */
export function createRealmForgeFeed(clock = Date.now): RealmForgeFeed & {
  bind(observer: RealmObserver): () => void;
  unavailable(): void;
} {
  const listeners = new Set<ForgeObservationHandlers>();
  const waiting = new Map<string, { stage: Stage; expiresAt: number }>();
  const pending = new Map<string, { activityId: string; attachment: CommittedForgeAttachment; expiresAt: number }>();
  // A bounded activity history prevents repeated stage messages from restarting words or reversing progress.
  const seen = new Map<string, number>();
  const committedIds = new Set<string>();
  let standing = new Map<string, CommittedForgeAttachment>();
  let ready = false, binding = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (call: (handlers: ForgeObservationHandlers) => void) => {
    for (const handlers of [...listeners]) {
      try { call(handlers); } catch (error) { console.error('Realm Forge listener failed', error); }
    }
  };
  const remember = (id: string, stage: number) => {
    seen.set(id, stage);
    if (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value!);
  };
  function cancel() {
    clearTimeout(timer); timer = undefined;
    waiting.clear(); pending.clear();
    emit(handlers => handlers.unavailable?.());
  }
  function schedule() {
    clearTimeout(timer); timer = undefined;
    const deadlines = [...waiting.values(), ...pending.values()].map(item => item.expiresAt);
    if (deadlines.length) timer = setTimeout(expire, Math.max(0, Math.min(...deadlines) - clock()));
  }
  function expire() {
    // Silence is never approval. Expired activity loses its ceremony; its durable part remains standing.
    if ([...waiting.values(), ...pending.values()].some(item => item.expiresAt <= clock())) cancel();
    else schedule();
  }
  function accept(event: ForgeActivity) {
    expire();
    if (event.type === 'stage') {
      const order = STAGES.indexOf(event.stage);
      if ((seen.get(event.activityId) ?? -1) >= order) return;
      remember(event.activityId, order);
      if (waiting.size + pending.size >= MAX_PENDING && !waiting.has(event.activityId)) cancel();
      waiting.set(event.activityId, { stage: event.stage, expiresAt: clock() + WAIT_MS });
      emit(handlers => handlers.stage?.(event.activityId, event.stage));
    } else if (event.type === 'ended') {
      if ((seen.get(event.activityId) ?? -1) >= ENDED) return;
      remember(event.activityId, ENDED);
      waiting.delete(event.activityId);
      emit(handlers => handlers.ended?.(event.activityId));
    } else {
      if (committedIds.has(event.attachment.id) || seen.get(event.activityId) === COMMITTED) return;
      committedIds.add(event.attachment.id);
      if (committedIds.size > MAX_SEEN) committedIds.delete(committedIds.values().next().value!);
      remember(event.activityId, COMMITTED);
      waiting.delete(event.activityId);
      if (waiting.size + pending.size >= MAX_PENDING) cancel();
      standing.set(event.attachment.id, event.attachment);
      pending.set(event.attachment.id, { activityId: event.activityId, attachment: event.attachment, expiresAt: clock() + HANDOFF_MS });
      emit(handlers => handlers.committed?.(event.attachment, event.activityId));
    }
    schedule();
  }
  return {
    subscribe(handlers) {
      expire(); listeners.add(handlers);
      if (ready) handlers.restored?.([...standing.values()]);
      for (const [id, item] of waiting) handlers.stage?.(id, item.stage);
      for (const item of pending.values()) handlers.committed?.(item.attachment, item.activityId);
      if (!ready && !waiting.size && !pending.size) handlers.unavailable?.();
      return () => { listeners.delete(handlers); };
    },
    settled(id) { pending.delete(id); schedule(); },
    unavailable() { ready = false; cancel(); },
    bind(observer) {
      const currentBinding = ++binding;
      const restore = () => {
        const now = observer.current();
        if (now.status !== 'ready') return;
        ready = true; standing = new Map(now.attachments);
        emit(handlers => handlers.restored?.([...standing.values()]));
      };
      const off = observer.subscribe({
        forge: accept,
        status(status) {
          if (status === 'ready') restore();
          // A known exact-geometry replacement keeps only this UI's observed work through the remount.
          else if (status !== 'mismatch' && status !== 'installing') { ready = false; cancel(); }
        },
      });
      restore();
      return () => { off(); if (binding === currentBinding) ready = false; };
    },
  };
}
