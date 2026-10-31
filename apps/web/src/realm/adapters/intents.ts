import { RealmIntentSchema, type RealmIntent, type RealmReceipt } from '@chatdom/shared/realm';
import type { RealmObservedRoom } from './observer';

/** `pending` means the room has not answered yet: the work is not failed, refunded or done. */
export type RealmIntentAnswer = { readonly kind: 'receipt'; readonly receipt: RealmReceipt } | { readonly kind: 'pending'; readonly id: string };
export interface RealmIntents {
  send(intent: RealmIntent): Promise<RealmIntentAnswer>;
  /** A late private receipt for a request that was answered `pending` earlier. */
  onLate(listener: (receipt: RealmReceipt) => void): () => void;
  dispose(): void;
}

/**
 * Sends validated intents and matches private receipts by request ID. Private interaction messages are
 * left to their owner. Silence never becomes a fabricated failure or success.
 */
export function createRealmIntents(room: RealmObservedRoom, options: { readonly answerMs?: number } = {}): RealmIntents {
  const waiting = new Map<string, (answer: RealmIntentAnswer) => void>(), late = new Set<(receipt: RealmReceipt) => void>(), asked = new Set<string>();
  const release = room.onMessage('private', (payload: never) => {
    const message = payload as { type?: unknown; receipt?: RealmReceipt } | null;
    if (message?.type !== 'receipt' || typeof message.receipt?.id !== 'string') return;
    const receipt = message.receipt, resolve = waiting.get(receipt.id);
    if (resolve) { waiting.delete(receipt.id); resolve({ kind: 'receipt', receipt }); }
    else if (asked.has(receipt.id)) for (const listener of late) listener(receipt);
  });
  return {
    send(intent) {
      const parsed = RealmIntentSchema.parse(intent);
      if (waiting.has(parsed.id)) throw new Error('That request is already on its way');
      asked.add(parsed.id); if (asked.size > 256) asked.delete(asked.values().next().value!);
      return new Promise(resolve => {
        const timer = setTimeout(() => { if (waiting.delete(parsed.id)) resolve({ kind: 'pending', id: parsed.id }); }, options.answerMs ?? 15_000);
        waiting.set(parsed.id, answer => { clearTimeout(timer); resolve(answer); });
        room.send('intent', parsed);
      });
    },
    onLate(listener) { late.add(listener); return () => { late.delete(listener); }; },
    dispose() { release(); for (const [id, resolve] of waiting) resolve({ kind: 'pending', id }); waiting.clear(); late.clear(); },
  };
}
