import { MONARCH_CHANNEL, MonarchChannelRequestSchema, isVerifiedMonarch, type MonarchChannelReply } from '@chatdom/shared/realm';
import type { RealmRoomChannel } from '../room-channels';
import type { RealmMonarchTitles } from './titles';

/**
 * Who rules here, and the monarch's choice of title. Anyone in the room may ask who; only the verified broadcaster of
 * this very kingdom may choose a title, and the choice is one of three words. No other power rides on this channel.
 */
export function createMonarchRoomChannel(titles: RealmMonarchTitles): RealmRoomChannel {
  return {
    type: MONARCH_CHANNEL, rate: 2,
    attach(room) {
      let open = true;
      room.onMessage(async (from, raw) => {
        const request = MonarchChannelRequestSchema.safeParse(raw);
        if (!request.success || !open) return;
        const principal = from.principal, you = isVerifiedMonarch(principal) && principal.kingdomId === room.kingdomId;
        if (request.data.type === 'title') {
          if (!you) return;
          await titles.choose(room.kingdomId, request.data.title);
        }
        const [title, name] = await Promise.all([titles.title(room.kingdomId), titles.name(room.kingdomId)]);
        if (!open || !from.present()) return;
        const reply: MonarchChannelReply = { version: 1, type: 'monarch', name, title, you };
        room.toPerson(principal.personId, reply);
      });
      return () => { open = false; };
    },
  };
}
