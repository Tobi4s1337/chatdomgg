import type { TwitchMomentFeed } from '@chatdom/shared/twitch-moments';
import type { RealmObserver } from './observer';

/** The realm checkpoint restores current state quietly; only later outbox deliveries animate. */
export function createRoomMomentFeed(observer: RealmObserver, origin: TwitchMomentFeed['origin'], clock = Date.now): TwitchMomentFeed {
  return {
    origin,
    subscribe(reset, receive, unavailable) {
      let ready = false, closed = false, signalled = false;
      const fail = () => { if (!closed && !signalled) { ready = false; signalled = true; unavailable(); } };
      const install = () => {
        const snapshot = observer.current();
        if (snapshot.status !== 'ready' || !snapshot.writerEpoch || !snapshot.moments) { fail(); return; }
        ready = true; signalled = false;
        reset({ epoch: snapshot.writerEpoch, asOf: clock(), throughSeq: snapshot.moments.throughSeq, current: [...snapshot.moments.current.values()] });
      };
      const off = observer.subscribe({
        status: status => { if (status === 'ready') install(); else fail(); },
        moment: fact => { const snapshot = observer.current(); if (ready && snapshot.status === 'ready' && snapshot.writerEpoch) receive(snapshot.writerEpoch, fact); },
      });
      if (observer.current().status === 'ready') install();
      else fail();
      return () => { closed = true; off(); };
    },
  };
}
