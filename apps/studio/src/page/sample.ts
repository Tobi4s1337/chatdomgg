// The replica's own sample: a busy, plausible frame of tobi4s_ live, for building and checking the page at
// /studio/?fixture=page&t=…  Every chatter and recommended channel here is invented and comes from the chat roster
// (apps/studio/src/chat/roster.ts, every login checked absent on Helix); the side bar's followed channels are the
// consenting Genesis channels.
import { cast, chatter, roster } from '../chat/roster';
import { MEDIA, type ChatItem, type Chatter, type Fragment, type PageState, type SideChannel } from '../types';
import { smooth } from './format';

const avatar = (name: string) => `${MEDIA}/reference/avatars/${name}.png`;

/** The sample's chatters, all from the chat roster (every login there is checked absent on Helix). */
const people: Record<string, Chatter> = Object.fromEntries([
  'kaffeesatz_kalle', 'quietmeadow_', 'lilac_lantern', 'rubberducky_dev', 'yuki_hoshizora', 'css_hexe', 'noor_codes_', 'nachteule_42',
  'sleepyraccoon_04', 'moonpie_mara', 'dustbunny_dev', 'pebble_paws_pdx', 'umbra_moth', 'tealkettle_', 'minty_moose_mo', 'funkenflug_jo',
  'rosepetal_rae', 'kittenmittens_k', 'bramble_bee_',
].map(login => [login, chatter(login)!]));

const text = (t: string): Fragment => ({ kind: 'text', text: t });
const emote = (id: string, code: string): Fragment => ({ kind: 'emote', id, code });
const LUL = emote('425618', 'LUL'), POG = emote('305954156', 'PogChamp'), HEY = emote('30259', 'HeyGuys'), HEART = emote('555555584', '<3');
const NEMO = emote('emotesv2_5d523adb8bbb4786821cd7091e47da21', 'PopNemo'), HYPE = emote('emotesv2_13b6dd7f3a3146ef8dc10f66d8b42a96', 'TwitchConHYPE');
const RAID = emote('62836', 'twitchRaid'), GOOD = emote('64138', 'SeemsGood'), KAPPA = emote('25', 'Kappa'), LIT = emote('166263', 'TwitchLit');

let n = 0;
const msg = (at: number, who: string, fragments: Fragment[], extra: Partial<Extract<ChatItem, { kind: 'message' }>> = {}): ChatItem =>
  ({ kind: 'message', id: `s${n++}`, at, from: people[who]!, fragments, ...extra });

/** The chat timeline: a backlog before t = 0, then a raid, a sub and a hype train inside the sample's ten seconds. */
const CHAT: readonly ChatItem[] = [
  msg(-95, 'kaffeesatz_kalle', [text('evening everyone '), HEY]),
  msg(-88, 'lilac_lantern', [text('is the bakery new? it was not there yesterday')]),
  msg(-80, 'rubberducky_dev', [text('my house finally has a chimney')]),
  msg(-74, 'quietmeadow_', [text('the lanterns on the bridge look so good at night')]),
  msg(-66, 'css_hexe', [text('can we get a second forge')]),
  msg(-60, 'yuki_hoshizora', [text('tobi what are you building next')]),
  msg(-52, 'nachteule_42', [text('first time catching this live, what is this? '), POG], { highlight: 'first-time' }),
  msg(-47, 'moonpie_mara', [text('welcome! say something in chat and you get a house in the kingdom '), HEART]),
  msg(-41, 'nachteule_42', [text('wait seriously '), LUL]),
  msg(-36, 'pebble_paws_pdx', [text('mine is the blue roof by the well')], { reply: { to: people.nachteule_42!, text: 'wait seriously' } }),
  msg(-30, 'dustbunny_dev', [text('the fog this morning was so pretty '), GOOD]),
  msg(-26, 'sleepyraccoon_04', [NEMO, text(' '), NEMO, text(' '), NEMO]),
  msg(-21, 'tealkettle_', [text('did anyone see the cat on the roof of the tavern')]),
  msg(-17, 'noor_codes_', [{ kind: 'mention', login: 'tealkettle_' }, text(' it walks the roofs every night '), KAPPA]),
  { kind: 'sub', id: 's-sub', at: -12, from: people.funkenflug_jo!, tier: 1, months: 7, streak: 7, fragments: [text('seven months in the kingdom, my garden is huge now '), HEART] },
  msg(-9, 'minty_moose_mo', [text('gg jo '), HYPE]),
  msg(-6, 'rubberducky_dev', [text('the forge is lit again '), LIT]),
  msg(-3, 'umbra_moth', [text('when is the next raid night')]),
  msg(-1, 'kaffeesatz_kalle', [{ kind: 'mention', login: cast.me.login }, text(' your house got a new door!')]),
  { kind: 'raid', id: 's-raid', at: 1.5, from: { login: 'pinkkittyrose', display: 'PinkKittyRose', avatar: avatar('pinkkittyrose') }, viewers: 48 },
  msg(2.0, 'rosepetal_rae', [RAID, text(' '), RAID, text(' welcome raiders')]),
  msg(2.4, 'kittenmittens_k', [text('PINK IS HERE '), HEART, HEART]),
  msg(2.9, 'bramble_bee_', [RAID, text(' '), RAID, text(' '), RAID]),
  msg(3.3, 'lilac_lantern', [text('look at the gate!! the banners')]),
  { kind: 'gift', id: 's-gift', at: 4.0, from: people.moonpie_mara!, count: 5, tier: 1 },
  msg(4.6, 'pebble_paws_pdx', [text('thank you mara '), HEART]),
  msg(5.2, 'dustbunny_dev', [HYPE, text(' '), HYPE, text(' hype train!')]),
  { kind: 'announcement', id: 's-ann', at: 6.0, from: people.kaffeesatz_kalle!, accent: 'purple', fragments: [text('Raiders: type anything in chat and the kingdom builds you a home tonight '), HEART] },
  msg(6.8, 'sleepyraccoon_04', [text('the caravan is still coming in '), POG]),
  msg(7.5, 'tealkettle_', [LUL, text(' the cart got stuck on the bridge')]),
  msg(8.3, 'noor_codes_', [text('this is the coziest stream on twitch')]),
];

const SIDE: readonly SideChannel[] = [
  { login: 'the_aggman', display: 'The_AGGman', avatar: avatar('the_aggman'), category: 'Minecraft', viewers: 41, live: true },
  { login: 'pinkkittyrose', display: 'PinkKittyRose', avatar: avatar('pinkkittyrose'), category: 'Just Chatting', viewers: 48, live: true },
  { login: 'mashad4', display: 'MashaD4', avatar: avatar('mashad4'), category: 'Art', viewers: 0, live: false },
  // Recommended channels: invented, from the checked roster (they never chat in the sample).
  ...(['aino_koivu', 'leo_aux_croissants', 'ines_bocadillo'] as const).map((login, k): SideChannel => ({
    login, display: roster.find(p => p.login === login)!.display, avatar: avatar(['default-3', 'default-1', 'default-9'][k]!),
    category: ['Stardew Valley', 'Software and Game Development', 'Terraria'][k]!, viewers: [212, 1384, 87][k]!, live: true,
  })),
];

/** The sample at t seconds: the cursor drifts to the follow button and clicks at 3 s; a raid lands at 1.5 s. */
export function samplePage(t: number): PageState {
  const press = Math.min(1, Math.max(0, (t - 3) / 0.6));
  const move = smooth(t / 2.6);
  const typed = 'welcome raiders! grab a house <3';
  const chars = Math.max(0, Math.min(typed.length, Math.floor((t - 6.5) * 9)));
  return {
    t,
    channel: {
      login: 'tobi4s_', display: 'tobi4s_', avatar: avatar('tobi4s_'),
      title: 'Building a kingdom with chat — every chatter gets a home | !kingdom',
      category: 'Software and Game Development', tags: ['English', 'Chatdom', 'Voxel', 'GameDev', 'Cozy'],
      followers: 289, about: 'Every viewer gets a home in the kingdom.', uptimeAtStart: 7342,
    },
    side: SIDE,
    me: { display: cast.me.display, avatar: cast.me.avatar },
    viewers: t < 1.5 ? 23 : 71,
    uptime: 7342 + t,
    theatre: false,
    following: t >= 3.6,
    followPress: t >= 3 && t < 3.6 ? press : 0,
    chat: CHAT.filter(item => item.at <= t),
    composing: typed.slice(0, chars),
    hypeTrain: t >= 5 ? { level: 2, progress: 0.42 + 0.03 * (t - 5), expiresIn: 268 - (t - 5) } : null,
    scroll: 0,
    player: { kind: 'key' },
    panel: { query: 'state=named' },
    cursor: { x: 760 + (1214 - 760) * move, y: 620 + (830 - 620) * move, visible: true, pressed: t >= 3 && t < 3.25 ? 1 : 0, shape: move > 0.92 ? 'hand' : 'arrow' },
    camera: { cx: 960, cy: 540, zoom: 1 },
  };
}
