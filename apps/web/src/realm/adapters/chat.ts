import { CitizenChatCueSchema, TokenSchema, type CitizenChatCue } from '@chatdom/shared';
import type { RealmTransientMessage } from '@chatdom/shared/realm';
import type { RealmObservedRoom, RealmObserver } from './observer';

export type RealmChatMessage = Extract<RealmTransientMessage, { type: 'chat' | 'chat.remove' | 'chat.clear' }>;
/** Transient speech is delivered once, never restored from a checkpoint or retained as an archive. */
export interface RealmChatFeed { subscribe(receive: (message: RealmChatMessage) => void): () => void }

export function createRoomChatFeed(room: RealmObservedRoom, observer: RealmObserver, clock = Date.now): RealmChatFeed & { dispose(): void } {
  const listeners = new Set<(message: RealmChatMessage) => void>();
  const seen = new Set<string>();
  let disposed = false, clearedAt = -1;
  const emit = (message: RealmChatMessage) => { for (const receive of [...listeners]) { try { receive(message); } catch (error) { console.error('Realm chat listener failed', error); } } };
  const clear = () => { seen.clear(); clearedAt = clock(); emit({ type: 'chat.clear' }); };
  const accept = (cue: CitizenChatCue) => {
    const current = observer.current(), frame = current.presence, now = clock();
    if (current.status !== 'ready' || !frame || frame.kingdomId !== cue.kingdomId || frame.origin !== cue.origin
      || frame.epoch !== cue.epoch || cue.asOf <= clearedAt || cue.asOf > now || cue.expiresAt <= now || seen.has(cue.id)
      || !frame.windows.some(window => window.slot === cue.slot && window.present)) return;
    seen.add(cue.id);
    if (seen.size > 1024) seen.delete(seen.values().next().value!);
    emit({ type: 'chat', cue });
  };
  const offMessage = room.onMessage('transient', (raw: never) => {
    const message = raw as RealmTransientMessage | null;
    if (message?.type === 'chat') { const parsed = CitizenChatCueSchema.safeParse(message.cue); if (parsed.success) accept(parsed.data); }
    else if (message?.type === 'chat.clear') clear();
    else if (message?.type === 'chat.remove' && Array.isArray(message.cueIds) && message.cueIds.length <= 1024
      && message.cueIds.every(id => TokenSchema.safeParse(id).success)) {
      for (const id of message.cueIds) { seen.add(id); if (seen.size > 1024) seen.delete(seen.values().next().value!); }
      emit({ type: 'chat.remove', cueIds: message.cueIds });
    }
  });
  let presenceEpoch: string | null = null;
  const offObserver = observer.subscribe({
    status: status => { if (status !== 'ready') clear(); },
    presence: frame => { if (presenceEpoch !== null && presenceEpoch !== frame.epoch) clear(); presenceEpoch = frame.epoch; },
  });
  return {
    subscribe(receive) { if (disposed) return () => {}; listeners.add(receive); return () => { listeners.delete(receive); }; },
    dispose() { if (disposed) return; disposed = true; clear(); offMessage(); offObserver(); listeners.clear(); },
  };
}
