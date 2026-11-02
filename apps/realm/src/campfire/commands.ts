import type { GatherChatEnvelope } from '@chatdom/shared';
import type { Campfires } from './index';

/*
 * The Gallery's `!sus name` through the realm's chat command registry (raid-show's `realmChatCommands`, which the
 * herald feeds from Twitch chat). The shapes are the structural part of that registry's `ChatCommand` and
 * `ChatCommandCleanup`, so this builds on either side of the merge. One registration line in `main.ts`:
 *   realmChatCommands.register(campfireChatCommands(campfires));
 *
 * A command counts once per Twitch identity per day (the court keeps who counted in its saved checkpoint, so a
 * redelivered or replayed message changes nothing). A ban, a timeout or a deleted line takes that identity's
 * suspicion back for the day. A whole-chat clear removes words, not anyone's single voice, so it is left alone.
 */
export interface ChatCommandInput {
  readonly kind: 'command';
  readonly origin: 'live' | 'simulated';
  readonly kingdomId: string;
  readonly messageId: string;
  readonly at: number;
  readonly chatter: { readonly twitchId: string; readonly login: string; readonly displayName: string };
  readonly command: string;
  readonly arg: string | null;
}
export interface ChatCleanupInput {
  readonly kind: 'cleanup';
  readonly origin: 'live' | 'simulated';
  readonly kingdomId: string;
  readonly messageId: string;
  readonly at: number;
  readonly twitchId: string | null;
  readonly reason: 'ban' | 'timeout' | 'delete' | 'clear';
  readonly targetMessageId: string | null;
}
export type ChatCommandResult = 'accepted' | 'duplicate' | 'ignored';

export const CAMPFIRE_COMMANDS = ['sus'] as const;

export function campfireChatCommands(campfires: Pick<Campfires, 'fire' | 'known'>) {
  return {
    id: 'campfire',
    commands: CAMPFIRE_COMMANDS,
    async command(input: ChatCommandInput): Promise<ChatCommandResult> {
      if (input.command !== 'sus' || !input.arg) return 'ignored';
      const envelope = { kind: 'command', kingdomId: input.kingdomId, messageId: input.messageId, at: input.at,
        chatter: { twitchId: input.chatter.twitchId, login: input.chatter.login, displayName: input.chatter.displayName },
        command: 'sus', arg: input.arg } as GatherChatEnvelope;
      return await campfires.fire(input.kingdomId).chat(envelope) === 'counted' ? 'accepted' : 'ignored';
    },
    async cleanup(input: ChatCleanupInput): Promise<ChatCommandResult> {
      // Only a fire that is burning has anything to take back; never wake one for a cleanup.
      const fire = campfires.known(input.kingdomId);
      if (!fire || input.reason === 'clear' || !input.twitchId) return 'ignored';
      await fire.chat({ kind: 'cleanup', kingdomId: input.kingdomId, twitchId: input.twitchId, at: input.at } as GatherChatEnvelope);
      return 'accepted';
    },
  };
}
