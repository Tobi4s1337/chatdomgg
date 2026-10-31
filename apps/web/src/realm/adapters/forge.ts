import type { CommittedForgeAttachment, ForgeActivity } from '@chatdom/shared/realm';
import type { RealmObserver } from './observer';

export type { RealmForgeFeed } from './forge-feed';

export interface ForgeObservationHandlers {
  /** An observed live ritual stage, by opaque activity ID. No words, maker identity or candidate. */
  stage?(activityId: string, stage: Extract<ForgeActivity, { type: 'stage' }>['stage']): void;
  /** A part the room just committed: the one moment its arrival ritual may play. */
  committed?(attachment: CommittedForgeAttachment, activityId: string): void;
  /** Parts already standing when this client arrived or resynced. Install them; never celebrate them. */
  restored?(attachments: readonly CommittedForgeAttachment[]): void;
  /** Present-tense activity is no longer confirmed. Cancel waiting work without inventing an outcome. */
  unavailable?(): void;
}

export function observeForgeActivity(observer: RealmObserver, handlers: ForgeObservationHandlers): () => void {
  const restore = () => { const now = observer.current(); if (now.status === 'ready') handlers.restored?.([...now.attachments.values()]); };
  const unsubscribe = observer.subscribe({
    forge: event => { if (event.type === 'stage') handlers.stage?.(event.activityId, event.stage); else handlers.committed?.(event.attachment, event.activityId); },
    status: status => { if (status === 'ready') restore(); else if (status !== 'mismatch') handlers.unavailable?.(); },
  });
  restore();
  return unsubscribe;
}
