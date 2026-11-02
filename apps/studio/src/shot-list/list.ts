// The teaser, shot by shot. Times in `cut` are the shot's place in the edit before the music snaps it; times
// inside a shot run from 0 to `duration`. Page shots carry a PageScript; kingdom shots name their source.
//
// The night the page shows: tobi4s_ live at about 20:30 on a Monday, tens of viewers (Decision 4). The lurker
// is nachteule_42, a follower since 2022 who has never written in chat; the screen is the quiet viewer's own.
import type { ShotScript } from './types';
import { pageShot } from './page';
import { cast, PINKKITTYROSE } from '../chat/roster';
import { raid, say, sub } from '../chat/say';
import { PLAYER_PLATE } from './plates';

const STREAM = '/stream?source=simulated&layout=stage&seam=starting&hour=19.3';
const SHOW = '/stream?source=simulated&layout=stage&mood=show&camera=window&hour=19.6';
const SET = (path: string, channel = 'tobi4s_') => `/studio/set.html?scene=grand&channel=${channel}&path=${path}`;
const EVIDENCE = 'work/evidence';

/** The player shows the GPU take of the stream view, frame for frame with the shot. */
const streamPlate = (offset = 0, take = PLAYER_PLATE.take, frames = PLAYER_PLATE.frames) => ({ kind: 'plate' as const, take, offset: -offset, frames, ext: PLAYER_PLATE.ext });

export const SHOTS: readonly ShotScript[] = [
  {
    id: 'S01', title: 'The channel', cut: [0, 4], duration: 4, narration: 'Every stream has a chat.', source: 'page',
    picture: 'twitch.tv/tobi4s_ live on a quiet evening: the kingdom at dusk in the player, chat trickling, 34 viewers, the Chatdom panel under the video. The cursor drifts like a hand.',
    hooks: ['/stream source=simulated seam=starting', '/panel source=simulated'], status: 'staged',
    page: pageShot({
      seed: 's01', viewers: [{ t: 0, v: 34 }, { t: 2.6, v: 35, ease: 'hold' }], uptime: 4310,
      player: streamPlate(1.5), panel: 'state=unshared',
      cursor: [{ t: 0, x: 1210, y: 640 }, { t: 1.8, x: 1150, y: 700, move: 1.6 }, { t: 3.6, x: 1080, y: 735, move: 1.5 }],
      beats: [{ at: -90, duration: 94, mood: 'trickle' }],
      scripted: [say(0.9, 'vip', 'the windows at dusk never get old'), say(2.7, cast.regulars[3]!, 'evening all o7')],
    }),
  },
  {
    id: 'S02', title: 'The line', cut: [4, 7], duration: 3, narration: 'Every chat… is a people.', source: 'page',
    picture: 'The camera pushes in on chat: a four-year lurker writes for the first time, with Twitch’s first-time-chatter highlight.',
    hooks: ['studio virtual camera'], status: 'staged',
    page: pageShot({
      seed: 's02', viewers: [{ t: 0, v: 35 }], uptime: 4314, player: streamPlate(5.33), panel: 'state=unshared',
      cursor: [{ t: 0, x: 1080, y: 735 }, { t: 2.8, x: 1040, y: 760, move: 2.4 }],
      camera: [{ t: 0, v: { cx: 960, cy: 540, zoom: 1 } }, { t: 3, v: { cx: 1745, cy: 880, zoom: 3.1 }, ease: 'smooth' }],
      beats: [{ at: -90, duration: 91, mood: 'trickle' }, { at: 1.0, duration: 2, mood: 'trickle', rate: 0 }],
      scripted: [say(1.0, 'lurker', 'been lurking for 4 years. first time chatting 👋', { firstTime: true })],
    }),
  },
  {
    id: 'S03', title: 'Through the screen', cut: [7, 11], duration: 4, source: 'page then kingdom',
    picture: 'The camera slides off the chat line, across the player and through it into the kingdom, where a window lights.',
    hooks: ['studio virtual camera', '/stream source=simulated seam=starting'], status: 'staged',
    film: [{ take: 'film-stream-dusk', in: 703 / 60 }],
    page: pageShot({
      seed: 's02', viewers: [{ t: 0, v: 35 }], uptime: 4317, player: streamPlate(8.52), panel: 'state=unshared',
      cursor: [{ t: 0, x: 1040, y: 760, hidden: true }],
      camera: [{ t: 0, v: { cx: 1745, cy: 880, zoom: 3.1 } }, { t: 1.6, v: { cx: 1100, cy: 520, zoom: 1.6 }, ease: 'smooth' }, { t: 3.2, v: { cx: 910, cy: 426.875, zoom: 1920 / 1340 }, ease: 'in' }],
      beats: [{ at: -90, duration: 91, mood: 'trickle' }],
      scripted: [say(-2.0, 'lurker', 'been lurking for 4 years. first time chatting 👋', { firstTime: true }), say(0.8, 'mod1', '@nachteule_42 welcome!! 4 years wow'), say(1.6, 'vip', 'WELCOME nachteule <3')],
    }),
    kingdom: { kind: 'take', take: 'stream-dusk', in: 703, route: STREAM, note: 'From 3.2 s the full-frame stream take continues the same picture the player showed.' },
  },
  {
    id: 'S04', title: 'The island at golden hour', cut: [11, 17], duration: 6, narration: 'And every people deserves a kingdom.', source: 'kingdom',
    picture: 'A slow aerial over the grand land: low by the ships in the harbour, rising over the shore as the peaks, waterfalls and the mere open up, pulling back to the whole island in the sea. Card: CHATDOM.',
    hooks: ['GrandEngine (read-only import)', 'grandChannel(tobi4s_)'], status: 'staged',
    film: [{ take: 'film-S04', in: 0.5 }],
    kingdom: { kind: 'take', take: 'island-golden', in: 30, route: SET('island-golden') },
    doubts: 'The grand land carries no town yet on main (GK11 not merged): the shore shows land and ships, not the town.',
  },
  {
    id: 'S05', title: 'The Way Home I: the road', cut: [17, 21], duration: 4, narration: 'Show up…', source: 'set piece',
    picture: 'Low tracking shot: the lurker walks up the road to the gate at golden hour; banners stir.',
    hooks: ['/stream source=simulated mood=show (citizen)'], status: 'stand-in',
    film: [{ take: 'film-S05', in: 0 }],
    kingdom: { kind: 'take', take: 'stream-show', in: 630, route: SHOW, note: 'Stand-in: the stream director’s citizen shot until a walker can be driven along the road.' },
  },
  {
    id: 'S06', title: 'The Way Home II: the street', cut: [21, 25], duration: 4, narration: '…and the road leads home.', source: 'kingdom',
    picture: 'The camera lifts over the gate and flies down the street to the old quarter, where four years of following put their home.',
    hooks: ['__chatdomKingdom.pose'], status: 'stand-in',
    film: [{ take: 'film-S06', in: 0 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/live-twitch/homes@1920x1080.png`, crop: [40, 70, 1840, 920], from: { scale: 1.08, x: 0.02, y: -0.02 }, to: { scale: 1.22, x: -0.03, y: 0.03 }, note: 'Stand-in: the real dusk street still, moved, until a pose path flies the street.' },
  },
  {
    id: 'S07', title: 'The Way Home III: the door', cut: [25, 29], duration: 4, source: 'kingdom',
    picture: 'Their window lights, the door opens, and they step out in the look they picked.',
    hooks: ['homecoming (stream view)'], status: 'stand-in',
    film: [{ take: 'film-S07', in: 0 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/live-twitch/homecoming-native-reviewed@1920x1080.png`, crop: [440, 440, 1100, 619], from: { scale: 1.05, x: 0, y: 0 }, to: { scale: 1.18, x: 0.02, y: -0.01 }, note: 'Stand-in: the real homecoming still, moved.' },
  },
  {
    id: 'S08', title: 'Chat becomes lights', cut: [29, 34], duration: 5, narration: 'Every minute in chat… a light in the window.', source: 'page',
    picture: 'Theatre mode: chat bursts as the night warms up, and in the player the town’s windows light with each message, then in a wave.',
    hooks: ['/stream source=simulated seam=starting'], status: 'staged',
    page: pageShot({
      seed: 's08', theatre: true, viewers: [{ t: 0, v: 38 }, { t: 2, v: 41, ease: 'hold' }, { t: 4, v: 43, ease: 'hold' }], uptime: 5120,
      player: streamPlate(13.5), panel: 'state=unshared',
      cursor: [{ t: 0, x: 900, y: 600, hidden: true }],
      beats: [{ at: -90, duration: 90.2, mood: 'trickle' }, { at: 0.2, duration: 5, mood: 'hype', rate: 3.2, topic: 'lights windows' }, { at: 2.4, duration: 2.6, mood: 'emote-wave', emote: 'SeemsGood' }],
      scripted: [say(0.4, 'broadcaster', 'chat, look at the town lighting up'), say(1.7, 'mod2', 'every light is one of us'), sub(2.9, cast.regulars[4]!, { months: 14 })],
    }),
  },
  {
    id: 'S09', title: 'The quiet one', cut: [34, 37], duration: 3, narration: 'Even the quiet ones.', source: 'page then kingdom',
    picture: 'The cursor taps “Light your window” in the Chatdom panel; a dark window on a quiet lane lights.',
    hooks: ['/panel source=simulated state=unshared → named', '/stream source=simulated mood=show (window)'], status: 'staged',
    film: [{ take: 'film-S09', in: 0.4 }],
    page: pageShot({
      seed: 's09', viewers: [{ t: 0, v: 43 }], uptime: 5180, scroll: [{ t: 0, v: 520 }], player: streamPlate(18), panel: 'state=unshared',
      cursor: [{ t: 0, x: 980, y: 380 }, { t: 1.1, x: 0, y: 0, move: 0.9, shape: 'hand', click: true }],
      clickPanel: true,
      beats: [{ at: -90, duration: 93, mood: 'trickle' }],
      scripted: [],
    }),
    kingdom: { kind: 'take', take: 'stream-show', in: 90, route: SHOW, note: 'The director’s window shot follows the tap.' },
  },
  {
    id: 'S10', title: 'The wish', cut: [37, 39], duration: 2, narration: 'Speak it…', source: 'page',
    picture: 'A close-up on chat: !forge a chimney shaped like a sleeping dragon.',
    hooks: ['studio virtual camera'], status: 'staged',
    page: pageShot({
      seed: 's10', viewers: [{ t: 0, v: 44 }], uptime: 5240, player: streamPlate(20), panel: 'state=named',
      cursor: [{ t: 0, x: 980, y: 500, hidden: true }],
      camera: [{ t: 0, v: { cx: 1730, cy: 900, zoom: 2.6 } }, { t: 2, v: { cx: 1740, cy: 910, zoom: 2.9 }, ease: 'linear' }],
      beats: [{ at: -90, duration: 90.5, mood: 'trickle' }, { at: 0.5, duration: 1.5, mood: 'forge', rate: 0 }],
      scripted: [say(0.5, 'forger', '!forge a chimney shaped like a sleeping dragon')],
    }),
  },
  {
    id: 'S11', title: 'The Forge', cut: [39, 43], duration: 4, narration: '…and the Forge makes it real.', source: 'kingdom',
    picture: 'Runes off the anvil, the blueprint, the pour, the hammer strike.',
    hooks: ['/stream forgeFixture=1 → __chatdomKingdom.forge'], status: 'stand-in',
    // Runes, blueprint and pour a beat each, then the strike: its impact (ritual 12.37 s) lands on the score's hammer
    // hit, 1.915 s into the snapped shot (three beats at 94 BPM).
    film: [{ take: 'film-S11', in: 1.5, share: 0.157 }, { take: 'film-S11', in: 4.0, share: 0.157 }, { take: 'film-S11', in: 8.0, share: 0.13 }, { take: 'film-S11', in: 12.155, share: 0.556 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/forge/dragon@1440x900.png`, crop: [640, 120, 800, 450], from: { scale: 1.0, x: 0, y: 0 }, to: { scale: 1.12, x: 0.01, y: 0.01 }, note: 'Stand-in: the real forged dragon chimney, moved, until the ritual is shot frame by frame.' },
  },
  {
    id: 'S12', title: 'It lands', cut: [43, 47], duration: 4, source: 'kingdom',
    picture: 'The piece arcs across town and settles on the house; smoke curls from the dragon’s nostrils; the neighbours react.',
    hooks: ['/stream forgeFixture=1 (landing)'], status: 'stand-in',
    film: [{ take: 'film-S12', in: 0 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/forge/dragon@1440x900.png`, crop: [470, 90, 970, 546], from: { scale: 1.15, x: 0.02, y: 0.02 }, to: { scale: 1.0, x: 0, y: 0 }, note: 'Stand-in: the same still pulling back.' },
  },
  {
    id: 'S13', title: 'Growth', cut: [47, 52], duration: 5, narration: 'Come back… and it grows with you.', source: 'kingdom',
    picture: 'One locked camera: the hamlet becomes a town in seconds, homes rising, streets filling.',
    hooks: ['growth ceremony / Chronicle replay'], status: 'stand-in',
    film: [{ take: 'film-S13', in: 0 }],
    kingdom: { kind: 'clip', src: `${EVIDENCE}/growth/growth-sequence-1280.mp4`, in: 0, speed: 1, crop: [347, 60, 933, 525], note: 'Stand-in: the growth lane’s real sequence render, cropped clear of its chip and captions.' },
  },
  {
    id: 'S14', title: 'The raid notice', cut: [52, 54], duration: 2.5, source: 'page',
    picture: 'Twitch’s own raid notice in chat, “PinkKittyRose is raiding with 48 viewers”, and chat erupts.',
    hooks: ['studio chat'], status: 'staged',
    page: pageShot({
      seed: 's14', viewers: [{ t: 0, v: 44 }, { t: 0.6, v: 92, ease: 'hold' }], uptime: 6010, player: streamPlate(22), panel: 'state=named',
      cursor: [{ t: 0, x: 1020, y: 640, hidden: true }],
      camera: [{ t: 0, v: { cx: 1500, cy: 620, zoom: 1.35 } }, { t: 2.5, v: { cx: 1560, cy: 640, zoom: 1.5 }, ease: 'linear' }],
      beats: [{ at: -90, duration: 90.08, mood: 'trickle' }, { at: 0.08, duration: 2.4, mood: 'raid-welcome', rate: 7 }],
      scripted: [raid(0.08, { viewers: 48, from: PINKKITTYROSE }), say(0.95, 'broadcaster', 'PINKKITTYROSE?! welcome raiders!!')],
    }),
  },
  {
    id: 'S15', title: 'The caravan', cut: [54, 58], duration: 4, narration: 'Friends arrive under their own banners.', source: 'kingdom',
    picture: 'The caravan rolls in under PinkKittyRose’s banner and colours, lanterns along the road, guests walking in.',
    hooks: ['raid moments (twitch-moments)'], status: 'stand-in',
    film: [{ take: 'film-S15', in: 0 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/live-twitch/raid@1920x1080.png`, crop: [60, 60, 1600, 900], from: { scale: 1.0, x: 0, y: 0 }, to: { scale: 1.14, x: -0.02, y: 0.02 }, note: 'Stand-in: the live bench’s real caravan still, moved.' },
  },
  {
    id: 'S16', title: 'The column', cut: [58, 61], duration: 3, source: 'set piece',
    picture: 'A huge raid: a long line of wagons under one house’s colours, lanterns swinging, pours along the road and in through the gate as the camera cranes up. No name, no number.',
    hooks: ['raid column (raid-show)'], status: 'stand-in',
    film: [{ take: 'film-S16', in: 0 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/raid-road/before-departure-1920.png`, crop: [80, 110, 1280, 720], from: { scale: 1.0, x: 0, y: 0 }, to: { scale: 1.1, x: 0, y: -0.03 }, note: 'Stand-in: the castle beacon over the town (cropped clear of the card) until a column can be staged.' },
  },
  {
    id: 'S17', title: 'The gate wakes', cut: [61, 65], duration: 4, narration: 'And when the night ends…', source: 'kingdom',
    picture: 'The end of the night: at the castle gate the braziers catch and the gate swings open; townsfolk with lanterns gather in its light.',
    hooks: ['/-/raid-gate'], status: 'stand-in',
    film: [{ take: 'film-S17', in: 0 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/raid-road/after-gate-1920.png`, crop: [640, 640, 700, 394], from: { scale: 1.0, x: 0, y: 0 }, to: { scale: 1.12, x: 0.03, y: -0.02 }, note: 'Stand-in: the gathering at the gate (cropped clear of text) until the departure is staged without cards.' },
  },
  {
    id: 'S18', title: 'Ride out', cut: [65, 68], duration: 3, narration: '…ride out.', source: 'kingdom',
    picture: 'Ride out: from just inside the open gate the camera rises over it and out along the road beyond the town, climbing into the night.',
    hooks: ['/-/raid-gate departure'], status: 'stand-in',
    film: [{ take: 'film-S18', in: 0 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/live-twitch/raid@1920x1080.png`, crop: [400, 100, 1400, 788], from: { scale: 1.2, x: 0.03, y: 0.02 }, to: { scale: 1.0, x: 0, y: -0.04 }, note: 'Stand-in: the caravan still reversed into a rising pull-back.' },
  },
  {
    id: 'S19', title: 'Rise to the map', cut: [68, 73], duration: 5, narration: 'Every raid leaves a road.', source: 'set piece',
    picture: 'The kingdom falls away into haze and ink, the Atlas of Twitch opens beneath, and the road inks across.',
    hooks: ['GrandEngine (read-only import)', 'Atlas'], status: 'staged',
    film: [{ take: 'film-S19rise', in: 0, share: 0.42 }, { take: 'film-S19map', in: 0, share: 0.58, enter: { kind: 'dissolve', dur: 0.7 } }],
    kingdom: { kind: 'take', take: 'island-rise', in: 0, route: SET('island-rise'), note: 'The rise is a real GPU take; the ink into the Atlas is a dissolve in the edit until the Atlas can be driven.' },
    doubts: 'The cloud deck is hidden for the climb; a dithered moon glint shows a faint grid on the sea from 2.5 s.',
  },
  {
    id: 'S20', title: 'Arrival', cut: [73, 76], duration: 3, source: 'kingdom',
    picture: 'At MashaD4’s gate the party arrives under tobi4s_’s banner, and her town’s lights come on.',
    hooks: ['raid arrival (raid-show)', 'grandChannel(mashad4)'], status: 'stand-in',
    film: [{ take: 'film-S20', in: 0 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/raid-road/before-welcome-1920.png`, crop: [690, 690, 600, 338], from: { scale: 1.0, x: 0, y: 0 }, to: { scale: 1.08, x: 0.02, y: 0 }, note: 'Stand-in: guests arriving at a Genesis kingdom’s gate (cropped clear of the card and caption); not yet MashaD4’s own town.' },
    doubts: 'A small “You” marker over the viewer’s walker stays in frame; Decision 9 wants no labels in the raid shots.',
  },
  {
    id: 'S21', title: 'The Atlas of Twitch', cut: [76, 80], duration: 4, narration: 'Thousands of chats. Thousands of kingdoms.', source: 'kingdom',
    picture: 'Pull back to the whole map: thousands of kingdoms, roads between them.',
    hooks: ['Atlas (labels for consenting channels only)'], status: 'stand-in',
    film: [{ take: 'film-S21', in: 0 }],
    kingdom: { kind: 'still', src: `${EVIDENCE}/atlas/atlas@1440x900.png`, crop: [190, 0, 1250, 900], from: { scale: 1.25, x: 0, y: 0 }, to: { scale: 1.0, x: 0, y: 0 }, note: 'Stand-in: the Atlas still, softened so no channel name is legible (only consenting channels may be).' },
  },
  {
    id: 'S22', title: 'Close', cut: [80, 87], duration: 7, narration: 'Your chat is waiting.', source: 'kingdom',
    picture: 'The night town, the lurker’s window still lit. Card: “Every chat deserves a kingdom.” chatdom.gg',
    hooks: ['/stream source=simulated seam=starting'], status: 'staged',
    film: [{ take: 'film-S22', in: 0 }],
    kingdom: { kind: 'take', take: 'stream-dusk', in: 150, route: STREAM },
    doubts: 'Today the close is the dusk overview of the town (a bookend to S01), not yet the night street with the lurker’s window.',
  },
];

export const SHOT_IDS = SHOTS.map(shot => shot.id);
