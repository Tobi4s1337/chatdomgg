import type { GrowthSceneFeed, GrowthSceneFrame } from '@chatdom/shared';
import type { RealmObserver } from './observer';

/** Current growth is durable; only deliveries after a checkpoint carry new ceremonies. */
export function createRoomGrowthFeed(observer: RealmObserver, origin: GrowthSceneFrame['origin']): GrowthSceneFeed {
  return {
    label: origin === 'live' ? 'LIVE' : 'SIMULATED',
    subscribe(receive, unavailable) {
      let closed = false, signalled = false;
      const fail = () => { if (!closed && !signalled) { signalled = true; unavailable(); } };
      const accept = (frame: GrowthSceneFrame, quiet: boolean) => {
        if (closed) return;
        if (frame.origin !== origin) { fail(); return; }
        signalled = false;
        receive(quiet ? { ...frame, beats: [] } : frame);
      };
      const install = () => {
        const snapshot = observer.current();
        if (snapshot.status === 'ready' && snapshot.growth) accept(snapshot.growth, true);
        else fail();
      };
      const off = observer.subscribe({
        status: status => { if (status === 'ready') install(); else fail(); },
        growth: (frame, cause) => { if (cause === 'delivery') accept(frame, false); },
      });
      const status = observer.current().status;
      if (status === 'ready') install();
      else if (status === 'mismatch' || status === 'unavailable' || status === 'disposed') fail();
      return () => { closed = true; off(); };
    },
  };
}
