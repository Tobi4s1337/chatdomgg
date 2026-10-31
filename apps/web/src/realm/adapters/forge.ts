import type { CommittedForgeAttachment, ForgeActivity } from '@chatdom/shared/realm';
import type { RealmObserver } from './observer';

export interface ForgeObservationHandlers {
  /** A committed ritual stage, by opaque activity ID. No words, maker identity or candidate. */
  stage?(activityId: string, stage: Extract<ForgeActivity, { type: 'stage' }>['stage']): void;
  /** A part the room just committed: the one moment its arrival ritual may play. */
  committed?(attachment: CommittedForgeAttachment): void;
  /** Parts already standing when this client arrived or resynced. Install them; never celebrate them. */
  restored?(attachments: readonly CommittedForgeAttachment[]): void;
}

export function observeForgeActivity(observer: RealmObserver, handlers: ForgeObservationHandlers): () => void {
  const restore = () => { const now = observer.current(); if (now.status === 'ready') handlers.restored?.([...now.attachments.values()]); };
  const unsubscribe = observer.subscribe({
    forge: event => { if (event.type === 'stage') handlers.stage?.(event.activityId, event.stage); else handlers.committed?.(event.attachment); },
    status: status => { if (status === 'ready') restore(); },
  });
  restore();
  return unsubscribe;
}
