/**
 * The holder's "Keep my travels private" clasp, answered by the Raid Gate's own record of the choice
 * (`/api/raid-gate/passport/travels`). The person is the signed-in session's; the page never names one. The answer is
 * the committed choice as the passport disclosure, so `CardPassport` moves the clasp only on an acknowledgement.
 */
import { RealmSessionReplySchema } from '@chatdom/shared/realm';
import type { PassportDisclosureView } from '@chatdom/ui/passport';
import { RAID_PASSPORT_TRAVELS_ROUTE, TravelsReplySchema } from '../../../api/src/raid-gate/passport-contracts';
import type { CardPassportOwner } from './CardPassport';

export function gateTravelsOwner(init: { fetch?: typeof fetch } = {}): CardPassportOwner {
  const send = init.fetch ?? ((input, options) => fetch(input, options));
  return {
    async setTravels(travels, signal): Promise<PassportDisclosureView> {
      const session = await send('/api/realm/session', { credentials: 'same-origin', cache: 'no-store', signal });
      if (!session.ok) throw new Error('Sign in to choose who reads your travels.');
      const who = RealmSessionReplySchema.parse(await session.json());
      if (who.status !== 'authenticated') throw new Error('Sign in to choose who reads your travels.');
      const response = await send(RAID_PASSPORT_TRAVELS_ROUTE, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': who.csrfToken },
        body: JSON.stringify({ version: 1, travels }),
      });
      if (!response.ok) throw new Error(`The choice was not recorded (${response.status}).`);
      const answer = TravelsReplySchema.parse(await response.json());
      return { origin: answer.origin, travels: answer.travels, revision: answer.revision };
    },
  };
}
