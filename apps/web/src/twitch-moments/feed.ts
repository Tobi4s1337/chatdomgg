/* global EventSource:readonly */
import { TokenSchema } from '@chatdom/shared';
import { MOMENT_MESSAGE_BYTES, MomentResetInfoSchema, type MomentResetInfo, type TwitchMomentFact, type TwitchMomentFeed } from './contracts';
import { z } from './zod';

/** A real connection that is not bound stays unavailable. It never falls back to fixtures. */
export function createUnavailableMomentFeed(origin: 'live' | 'simulated' = 'live'): TwitchMomentFeed {
  return {
    origin,
    subscribe(_reset, _receive, unavailable) {
      const timer = setTimeout(unavailable, 0);
      return () => clearTimeout(timer);
    },
  };
}

const FactMessage = z.strictObject({ epoch: TokenSchema, fact: z.unknown() });

/**
 * Browser adapter for the lane's public SSE stream (`reset` and `fact` events). The URL is explicitly supplied
 * by main's route binding; there is no guessed default. Messages are size-limited before parsing, and every fact
 * is validated again by the controller. Opening the connection alone never establishes LIVE.
 */
export function createEventSourceMomentFeed(url: string, origin: 'live' | 'simulated'): TwitchMomentFeed {
  if (!url.startsWith('/')) throw new Error('The moments stream must be a same-origin path supplied by its route binding');
  return {
    origin,
    subscribe(reset, receive, unavailable) {
      const source = new EventSource(url);
      let closed = false;
      const fail = () => { if (closed) return; closed = true; source.close(); unavailable(); };
      const decode = (event: MessageEvent) => {
        if (typeof event.data !== 'string' || event.data.length > MOMENT_MESSAGE_BYTES) return undefined;
        try { return JSON.parse(event.data) as unknown; } catch { return undefined; }
      };
      source.addEventListener('reset', event => {
        const info = MomentResetInfoSchema.safeParse(decode(event as MessageEvent));
        if (!info.success) { fail(); return; }
        reset(info.data as MomentResetInfo);
      });
      source.addEventListener('fact', event => {
        const message = FactMessage.safeParse(decode(event as MessageEvent));
        if (!message.success) { fail(); return; }
        receive(message.data.epoch, message.data.fact as TwitchMomentFact);
      });
      source.addEventListener('unavailable', fail);
      source.onerror = fail;
      return () => { closed = true; source.close(); };
    },
  };
}
