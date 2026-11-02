// The people in tobi4s_'s chat. Everyone here is invented, except the broadcaster himself and
// the consenting raid channel PinkKittyRose. Every invented login is checked against Helix Get
// Users by `check-names.mjs` (see `names-checked.json`), so none of them is a real account.
//
// This file has type-only imports so the Node scripts can load it directly.
import type { Badge, Chatter } from '../types';

/** A chatter plus what the crowd model needs to know about them. Assignable to `Chatter`. */
export interface Person extends Chatter {
  /** Months subscribed to tobi4s_ (drives the badge and resub notices); 0 when not a sub. */
  readonly months: number;
  /** How often this person talks: 0 never, 1 now and then, up to about 8 for the chattiest. */
  readonly chattiness: number;
  /** Which community they come from. */
  readonly crew: 'local' | 'raider';
  /** German speakers now and then drop a German line; everyone writes English most of the time. */
  readonly lang: 'de' | 'en';
}

// Badges, by their global set and version as Helix returns them.
const MOD: Badge = { set: 'moderator', version: '1' };
const VIP: Badge = { set: 'vip', version: '1' };
const BROADCASTER: Badge = { set: 'broadcaster', version: '1' };
const FOUNDER: Badge = { set: 'founder', version: '0' };
const PRIME: Badge = { set: 'premium', version: '1' };
const RECAP: Badge = { set: 'twitch-recap-2025', version: '1' };
const NO_AUDIO: Badge = { set: 'no_audio', version: '1' };
const bits = (n: 1 | 100 | 1000 | 5000): Badge => ({ set: 'bits', version: String(n) });
const gifter = (n: 1 | 5 | 10): Badge => ({ set: 'sub-gifter', version: String(n) });

/**
 * tobi4s_ has no custom subscriber badges, so Twitch shows its default ladder from the global
 * `subscriber` set: purple (1 month), teal (2), blue (3), red (6), pink (9) and gold (a year on).
 */
export function subscriberBadge(months: number): Badge {
  const version = months >= 12 ? '6' : months >= 9 ? '5' : months >= 6 ? '4' : months >= 3 ? '3' : months >= 2 ? '2' : '0';
  return { set: 'subscriber', version };
}

/** Twitch's preset name colours (what most people never change). */
export const TWITCH_COLORS = {
  red: '#FF0000', blue: '#0000FF', green: '#008000', firebrick: '#B22222', coral: '#FF7F50',
  yellowgreen: '#9ACD32', orangered: '#FF4500', seagreen: '#2E8B57', goldenrod: '#DAA520',
  chocolate: '#D2691E', cadetblue: '#5F9EA0', dodgerblue: '#1E90FF', hotpink: '#FF69B4',
  blueviolet: '#8A2BE2', springgreen: '#00FF7F',
} as const;
const C = TWITCH_COLORS;

type Role = 'mod' | 'vip';
interface Spec {
  login: string;
  display?: string;
  color: string;
  months?: number;
  role?: Role;
  /** One of the channel's first subscribers: the founder badge replaces the subscriber badge. */
  founder?: true;
  bits?: 1 | 100 | 1000 | 5000;
  gifter?: 1 | 5 | 10;
  /** The one global badge a person chooses to show. */
  global?: 'prime' | 'recap' | 'no-audio';
  chat?: number;
  lang?: 'de' | 'en';
}

function person(s: Spec, crew: Person['crew']): Person {
  const badges: Badge[] = [];
  // Twitch's order: role, then subscriber or founder, then bits and gifts, then the chosen global badge.
  if (s.role === 'mod') badges.push(MOD);
  if (s.role === 'vip') badges.push(VIP);
  if (s.founder) badges.push(FOUNDER);
  else if (s.months) badges.push(subscriberBadge(s.months));
  if (s.bits) badges.push(bits(s.bits));
  if (s.gifter) badges.push(gifter(s.gifter));
  if (s.global === 'prime') badges.push(PRIME);
  if (s.global === 'recap') badges.push(RECAP);
  if (s.global === 'no-audio') badges.push(NO_AUDIO);
  return Object.freeze({
    login: s.login,
    display: s.display ?? s.login,
    color: s.color,
    badges: Object.freeze(badges),
    months: s.months ?? 0,
    chattiness: s.chat ?? 1,
    crew,
    lang: s.lang ?? (crew === 'local' ? 'de' : 'en'),
  });
}

// ---- The cast: the people the shots name. ------------------------------------------------------

const lurker = person({ login: 'nachteule_42', color: C.cadetblue, chat: 0 }, 'local');
const me = person({ login: 'stillwasser_', color: C.blueviolet, chat: 0 }, 'local');
const forger = person({ login: 'funkenflug_jo', display: 'Funkenflug_Jo', color: C.orangered, months: 7, chat: 2 }, 'local');
const mod1 = person({ login: 'kaffeesatz_kalle', display: 'Kaffeesatz_Kalle', color: C.dodgerblue, role: 'mod', months: 41, bits: 1000, chat: 6 }, 'local');
const mod2 = person({ login: 'moonpie_mara', color: C.hotpink, role: 'mod', founder: true, months: 31, bits: 100, chat: 5 }, 'local');
const mod3 = person({ login: 'zwiebelfisch_hb', color: C.seagreen, role: 'mod', months: 19, chat: 2 }, 'local');
const vip = person({ login: 'rubberducky_dev', display: 'RubberDucky_Dev', color: C.goldenrod, lang: 'en', role: 'vip', months: 26, bits: 5000, chat: 6 }, 'local');

const REGULARS: readonly Person[] = [
  person({ login: 'kartoffelkiste_7', color: C.yellowgreen, months: 14, bits: 100, chat: 8 }, 'local'),
  person({ login: 'semikolon_sophie', color: C.coral, months: 9, global: 'prime', chat: 7 }, 'local'),
  person({ login: 'nullpointer_nik', color: '#00C8AF', months: 22, chat: 7 }, 'local'),
  person({ login: 'gleisdreieck_ost', color: C.firebrick, founder: true, months: 33, bits: 1000, chat: 6 }, 'local'),
  person({ login: 'fennek_jule', color: '#FFB3D9', months: 3, global: 'recap', chat: 6 }, 'local'),
  person({ login: 'deploy_am_freitag', color: C.chocolate, months: 11, bits: 100, chat: 6 }, 'local'),
  person({ login: 'der_brezelbaron', display: 'Der_BrezelBaron', color: '#E8D44D', months: 30, chat: 5 }, 'local'),
];

// ---- Everyone else in the community. ------------------------------------------------------------

const LOCAL_SPECS: readonly Spec[] = [
  // Subscribers.
  { login: 'mausklick_mia', color: C.hotpink, months: 5, chat: 2 },
  { login: 'flexbox_felix', color: C.dodgerblue, months: 2, chat: 2 },
  { login: 'css_hexe', color: C.blueviolet, months: 16, gifter: 5, chat: 3 },
  { login: 'spaetzle_coder', color: C.goldenrod, months: 8, global: 'prime', chat: 2 },
  { login: 'async_annika', color: C.seagreen, months: 1, chat: 2 },
  { login: 'waschbaer_willi', display: 'Waschbaer_Willi', color: C.cadetblue, months: 13, chat: 2 },
  { login: 'tomasz_wrzos', color: C.red, lang: 'en', months: 6, chat: 1 },
  { login: 'ana_bolachinha', color: C.coral, lang: 'en', months: 4, global: 'prime', chat: 2 },
  { login: 'igel_im_herbst', color: C.yellowgreen, months: 10, chat: 2 },
  { login: 'merge_konflikt', color: C.firebrick, months: 2, bits: 1, chat: 2 },
  { login: 'hafermilch_hanna', color: C.springgreen, months: 18, chat: 3 },
  { login: 'yuki_hoshizora', color: '#A970FF', lang: 'en', months: 3, chat: 1 },
  { login: 'dagny_fjord', color: C.dodgerblue, lang: 'en', months: 1, global: 'prime', chat: 1 },
  { login: 'segfault_sven', display: 'Segfault_Sven', color: C.orangered, months: 27, bits: 1000, chat: 3 },
  { login: 'leuchtturm_lisa', color: C.hotpink, months: 12, chat: 2 },
  { login: 'pixelpusher_pia', color: '#C79BFF', months: 7, chat: 2 },
  { login: 'kraehennest_ol', color: C.seagreen, months: 20, chat: 2 },
  { login: 'regex_rita', color: C.chocolate, months: 5, bits: 100, chat: 2 },
  { login: 'emre_kahve', color: C.goldenrod, lang: 'en', months: 1, chat: 1 },
  { login: 'quarkbaellchen_22', color: '#FFB3D9', months: 9, chat: 2 },
  { login: 'localhost_lars', color: C.cadetblue, months: 15, gifter: 1, chat: 2 },
  { login: 'tabs_not_spaces_', color: C.yellowgreen, lang: 'en', months: 2, chat: 1 },
  { login: 'mirka_vltava', color: C.blueviolet, lang: 'en', months: 6, chat: 1 },
  { login: 'holzwurm_hb', color: C.chocolate, months: 36, chat: 2 },
  { login: 'sternschnuppe_88', color: '#E8D44D', months: 4, chat: 1 },
  // Bits, no sub.
  { login: 'apfelstrudel_anna', color: C.coral, bits: 100, chat: 1 },
  { login: 'vim_escape_plan', color: C.springgreen, lang: 'en', bits: 1, chat: 2 },
  { login: 'gummistiefel_g', color: C.dodgerblue, bits: 100, global: 'prime', chat: 1 },
  { login: 'the404cat', color: C.red, lang: 'en', bits: 1, chat: 1 },
  { login: 'matti_saunamaki', color: C.seagreen, lang: 'en', bits: 1000, chat: 1 },
  // Prime Gaming, no sub.
  { login: 'dachsbau_dennis', color: C.firebrick, global: 'prime', chat: 1 },
  { login: 'keksdose_kim', color: '#FF8FB1', global: 'prime', chat: 2 },
  { login: 'giulia_pesto', color: C.springgreen, lang: 'en', global: 'prime', chat: 1 },
  { login: 'lowkey_owl_07', color: C.blueviolet, lang: 'en', global: 'prime', chat: 1 },
  { login: 'frostbyte_krk', color: '#7FDBFF', lang: 'en', global: 'prime', chat: 1 },
  { login: 'sudo_make_sandwich', color: C.goldenrod, lang: 'en', global: 'prime', chat: 1 },
  { login: 'marzipan_marie_', display: 'Marzipan_Marie_', color: C.coral, global: 'prime', chat: 1 },
  { login: 'orbital_waffel', color: C.yellowgreen, lang: 'en', global: 'prime', chat: 1 },
  // Twitch Recap 2025 badge, no sub.
  { login: 'darkmode_dani', color: '#7FDBFF', lang: 'en', global: 'recap', chat: 1 },
  { login: 'zugvogel_zoe', color: C.hotpink, global: 'recap', chat: 1 },
  { login: 'pablo_tostada', color: C.orangered, lang: 'en', global: 'recap', chat: 1 },
  { login: 'mossy_mango_mu', color: C.yellowgreen, lang: 'en', global: 'recap', chat: 1 },
  // Watching without audio.
  { login: 'schlafmuetze_sam', color: C.cadetblue, global: 'no-audio', chat: 1 },
  // No badges: most of chat.
  { login: 'maultasche_max', color: C.red },
  { login: 'tannenzapfen_t', color: C.seagreen },
  { login: 'funkloch_fritz', color: C.dodgerblue },
  { login: 'laubfrosch_lu', color: C.springgreen },
  { login: 'eichhoernchen_ella', color: C.chocolate },
  { login: 'brotkruemel_b', color: C.goldenrod },
  { login: 'rotkehlchen_rk', color: C.orangered },
  { login: 'ahornsirup_anke', color: C.firebrick },
  { login: 'butterbrot_bernd', color: C.cadetblue },
  { login: 'nebelhorn_nils', color: C.blue },
  { login: 'kieselstein_kiel', color: C.yellowgreen },
  { login: 'tischtennis_tom', color: C.coral },
  { login: 'wolkenkratzer_k', color: C.blueviolet },
  { login: 'schnurrbart_ben', color: C.chocolate },
  { login: 'kuchenkruemel_k', color: C.hotpink },
  { login: 'regenschirm23', color: C.seagreen },
  { login: 'kaesekuchen_kai', color: C.goldenrod },
  { login: 'ostseebrise_', color: C.dodgerblue },
  { login: 'gurkenglas_gerd', color: C.green },
  { login: 'pfannkuchen_paul', color: C.red },
  { login: 'div_soup', color: C.blueviolet , lang: 'en'},
  { login: 'git_gud_greta', color: C.hotpink },
  { login: 'typo_in_prod', color: C.orangered },
  { login: 'npm_install_life', color: C.cadetblue },
  { login: 'z_index_9999', color: C.dodgerblue , lang: 'en'},
  { login: 'ctrlz_carla', color: C.coral },
  { login: 'webpack_wolf', color: C.firebrick },
  { login: 'devtools_dora', color: C.yellowgreen },
  { login: 'refactor_rainer', color: C.seagreen },
  { login: 'bugfix_bea', color: C.goldenrod },
  { login: 'shader_schnecke', color: C.springgreen },
  { login: 'leo_aux_croissants', color: C.dodgerblue , lang: 'en'},
  { login: 'noor_codes_', color: C.hotpink , lang: 'en'},
  { login: 'aino_koivu', color: C.cadetblue , lang: 'en'},
  { login: 'ines_bocadillo', color: C.red , lang: 'en'},
  { login: 'sleepyraccoon_04', color: C.blueviolet , lang: 'en'},
  { login: 'pebble_paws_pdx', color: C.coral , lang: 'en'},
  { login: 'toasted_marsh_mal', color: C.chocolate , lang: 'en'},
  { login: 'quietmeadow_', color: C.seagreen , lang: 'en'},
  { login: 'lilac_lantern', color: C.blueviolet , lang: 'en'},
  { login: 'cozyfox_04', color: C.orangered , lang: 'en'},
  { login: 'tealkettle_', color: C.cadetblue , lang: 'en'},
  { login: 'umbra_moth', color: C.blue , lang: 'en'},
  { login: 'dustbunny_dev', color: C.yellowgreen , lang: 'en'},
  { login: 'minty_moose_mo', color: C.springgreen , lang: 'en'},
  { login: 'clover_kat_ie', color: C.green , lang: 'en'},
  { login: 'hazelnut_hans', color: C.chocolate },
  { login: 'lindwurm_lea', color: C.firebrick },
  { login: 'fischbroetchen_fin', color: C.dodgerblue },
  { login: 'halbmond_hugo', color: C.goldenrod },
  { login: 'pinselstrich_pb', color: C.hotpink },
];
const LOCALS: readonly Person[] = LOCAL_SPECS.map((s) => person({ chat: 1, ...s }, 'local'));

// ---- PinkKittyRose's raiders: no tobi4s_ badges, they are guests here. ----------------------------

const RAIDER_SPECS: readonly Spec[] = [
  { login: 'rosepetal_rae', color: C.hotpink, global: 'prime' },
  { login: 'kittenmittens_k', color: '#FFB3D9' },
  { login: 'thornbush_tess', color: C.seagreen },
  { login: 'catnap_carmen', color: C.blueviolet, global: 'recap' },
  { login: 'sundae_sprinkle', color: C.coral },
  { login: 'bramble_bee_', color: C.goldenrod, bits: 100 },
  { login: 'pixel_peony', color: C.hotpink },
  { login: 'hatkid_hugs', color: '#A970FF', global: 'prime' },
  { login: 'glitterglitch_gg', color: '#C79BFF' },
  { login: 'marmalade_mo', color: C.chocolate },
  { login: 'fuzzy_slipper_', color: C.dodgerblue },
  { login: 'lunarmoth_lou', color: C.blueviolet, global: 'prime' },
  { login: 'velvet_teapot', color: C.firebrick },
  { login: 'bubblegum_bard_b', color: C.hotpink, bits: 1 },
];
const RAIDERS: readonly Person[] = RAIDER_SPECS.map((s) => person({ chat: 2, ...s }, 'raider'));

// ---- The real accounts (not invented, not name-checked). -----------------------------------------

/** The broadcaster. He has no chat colour set, so Twitch picks one; the studio fixes it to this. */
export const BROADCASTER_CHATTER: Chatter = Object.freeze({ login: 'tobi4s_', display: 'tobi4s_', color: C.blueviolet, badges: Object.freeze([BROADCASTER]) });

/** The consenting raid channel, as Twitch's raid notice shows it. */
export const PINKKITTYROSE = Object.freeze({
  login: 'pinkkittyrose',
  display: 'PinkKittyRose',
  /** Local copy of her avatar in the media folder (served by the studio). */
  avatar: '/media/teaser/reference/avatars/pinkkittyrose.png',
  /** Where the copy came from. */
  avatarSource: 'https://static-cdn.jtvnw.net/jtv_user_pictures/dc07f9635451bf32-profile_image-300x300.png',
  color: '#FF69B4',
  viewers: 48,
});

/** The logged-in viewer's avatar: Twitch's own default avatar (blue), copied into the media folder. */
export const ME_AVATAR = '/media/teaser/reference/avatars/me.png';
export const ME_AVATAR_SOURCE = 'https://static-cdn.jtvnw.net/user-default-pictures-uv/998f01ae-def8-11e9-b95c-784f43822e80-profile_image-300x300.png';

// ---- Exports. -------------------------------------------------------------------------------------

/** The named people the shots use. */
export const cast = Object.freeze({
  /** A four-year follower who has never chatted; writes for the first time in S02. */
  lurker,
  /** The logged-in viewer whose screen this is. Never chats. */
  me: Object.freeze({ ...me, avatar: ME_AVATAR }),
  /** Types `!forge a chimney shaped like a sleeping dragon` in S10. */
  forger,
  mod1,
  mod2,
  mod3,
  vip,
  /** The people who talk the most. */
  regulars: Object.freeze([mod1, vip, mod2, ...REGULARS]),
  broadcaster: BROADCASTER_CHATTER,
  pinkkittyrose: PINKKITTYROSE,
});

/** tobi4s_'s own community (everyone invented). */
export const locals: readonly Person[] = Object.freeze([lurker, me, forger, mod1, mod2, mod3, vip, ...REGULARS, ...LOCALS]);
/** PinkKittyRose's raiders who chat (invented). */
export const raiders: readonly Person[] = Object.freeze(RAIDERS);
/** Every invented chatter. */
export const roster: readonly Person[] = Object.freeze([...locals, ...raiders]);

const BY_LOGIN = new Map<string, Chatter>([...roster.map((p) => [p.login, p] as const), [BROADCASTER_CHATTER.login, BROADCASTER_CHATTER]]);

/** The real channels that appear by name: the broadcaster and the consenting channels. */
const REAL_DISPLAY = new Map([['tobi4s_', 'tobi4s_'], ['pinkkittyrose', 'PinkKittyRose'], ['the_aggman', 'The_AGGman'], ['mashad4', 'MashaD4']]);

/** The display name for a login (as an @mention shows it), falling back to the login. */
export function displayName(login: string): string {
  const l = login.toLowerCase().replace(/^@/, '');
  return BY_LOGIN.get(l)?.display ?? REAL_DISPLAY.get(l) ?? l;
}

/** Finds a chatter by login (case-insensitive), including the broadcaster. */
export function chatter(login: string): Chatter | undefined {
  return BY_LOGIN.get(login.toLowerCase().replace(/^@/, ''));
}

/** Every badge any roster member, the broadcaster or a sub notice can show. */
export function badgesInUse(): Badge[] {
  const seen = new Map<string, Badge>();
  const add = (b: Badge) => seen.set(`${b.set}-${b.version}`, b);
  for (const p of roster) p.badges.forEach(add);
  BROADCASTER_CHATTER.badges.forEach(add);
  for (const m of [1, 2, 3, 6, 9, 12]) add(subscriberBadge(m));
  add(FOUNDER);
  return [...seen.values()];
}
