import { PRESENCE_LEASE_MS, type KingdomPresenceFrame, type PresenceFeed } from '@chatdom/shared';
import type { RealmObserver } from './observer';

/**
 * The existing `PresenceFeed` over the room's committed public deliveries. Frames come only from the
 * room checkpoint and its outbox, never from Herald's diagnostic SSE or a browser simulation. The same
 * receipt-silence rule as every other feed applies: a frame older than one lease goes dark honestly.
 */
export function createRoomPresenceFeed(observer: RealmObserver, origin: KingdomPresenceFrame['origin'], clock: () => number = Date.now): PresenceFeed {
  return {
    label: origin === 'live' ? 'LIVE' : 'SIMULATED',
    subscribe(receive, unavailable) {
      let stale: ReturnType<typeof setTimeout> | undefined, signalled = false, closed = false;
      const fail = () => { clearTimeout(stale); if (!closed && !signalled) { signalled = true; unavailable(); } };
      const accept = (frame: KingdomPresenceFrame) => {
        if (closed) return;
        if (frame.origin !== origin) { fail(); return; }
        clearTimeout(stale);
        const remaining = Math.min(PRESENCE_LEASE_MS, frame.asOf + PRESENCE_LEASE_MS - clock());
        if (remaining <= 0) { fail(); return; }
        signalled = false;
        receive(frame);
        stale = setTimeout(fail, remaining);
      };
      const unsubscribe = observer.subscribe({
        presence: accept,
        status: status => { if (status !== 'ready') fail(); },
      });
      const now = observer.current();
      if (now.status === 'ready' && now.presence) accept(now.presence);
      else if (now.status === 'mismatch' || now.status === 'unavailable' || now.status === 'disposed') fail();
      return () => { closed = true; clearTimeout(stale); unsubscribe(); };
    },
  };
}
