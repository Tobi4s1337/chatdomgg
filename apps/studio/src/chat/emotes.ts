// The emotes chat may use, by code. Every id here came back from Helix on the check date below:
// Twitch's global emotes (`chat/emotes/global`) and the consenting channels' own emotes
// (`chat/emotes?broadcaster_id=`). `fetch-reference.mjs` re-verifies every code against the API
// and downloads each image (static, dark theme, scale 2.0) into the media folder.
//
// Rules the crowd follows:
// - Everyone may use the globals.
// - tobi4s_'s two channel emotes are used only by his subscribers.
// - PinkKittyRose's emotes are used only by her raiders, in the raid welcome.
// - The_AGGman's and MashaD4's emotes are here for shot scripts that need them; the crowd
//   never picks them on its own.
// Only subscriber-tier channel emotes are listed: follower emotes work only in their own channel.

export type EmoteOwner = 'global' | 'tobi4s_' | 'pinkkittyrose' | 'the_aggman' | 'mashad4';

export interface EmoteDef {
  code: string;
  id: string;
  owner: EmoteOwner;
  /** Twitch serves an animated version; the studio shows its static frame, so the crowd avoids these. */
  animated?: true;
}

/** When the ids below were last checked against Helix. */
export const EMOTES_CHECKED_AT = '2026-11-01';

const g = (code: string, id: string, animated?: true): EmoteDef => (animated ? { code, id, owner: 'global', animated } : { code, id, owner: 'global' });
const ch = (owner: EmoteOwner, code: string, id: string): EmoteDef => ({ code, id, owner });

const LIST: readonly EmoteDef[] = [
  // Global staples.
  g('Kappa', '25'),
  g('LUL', '425618'),
  g('PogChamp', '305954156'),
  g('SeemsGood', '64138'),
  g('HeyGuys', '30259'),
  g('VoHiYo', '81274'),
  g('<3', '9'),
  g(':)', '1'),
  g(':D', '3'),
  g(':O', '8'),
  g('B)', '7'),
  g('CoolCat', '58127'),
  g('Kreygasm', '41'),
  g('KomodoHype', '81273'),
  g('TwitchLit', '166263'),
  g('GlitchCat', '304486301'),
  g('GlitchLit', '304489128'),
  g('CurseLit', '116625'),
  g('bleedPurple', '62835'),
  g('twitchRaid', '62836'),
  g('TwitchUnity', '196892'),
  g('VirtualHug', '301696583'),
  g('NotLikeThis', '58765'),
  g('FailFish', '360'),
  g('ResidentSleeper', '245'),
  g('Jebaited', '114836'),
  g('PopCorn', '724216'),
  g('KonCha', '160400'),
  g('TehePelo', '160404'),
  g('PartyHat', '965738'),
  g('GivePLZ', '112291'),
  g('TakeNRG', '112292'),
  g('PowerUpL', '425688'),
  g('PowerUpR', '425671'),
  g('HSCheers', '444572'),
  g('BOP', '301428702'),
  g('SingsNote', '300116350'),
  g('MercyWing1', '1003187'),
  g('PinkMercy', '1003190'),
  g('MercyWing2', '1003189'),
  g('Squid1', '191762'),
  g('Squid2', '191763'),
  g('Squid3', '191764'),
  g('Squid4', '191767'),
  g('CoolStoryBob', '123171'),
  g('RaccAttack', '114870'),
  g('OhMyDog', '81103'),
  g('NomNom', '90075'),
  g('DarkMode', '461298'),
  g('FrankerZ', '65'),
  g('MaxLOL', '1290325'),
  g('4Head', '354'),
  g('NewRecord', 'emotesv2_53f6a6af8b0e453d874bbefee49b3e73'),
  g('WhoaFace', 'emotesv2_688a35afcf564c7597940322074c73dd'),
  g('HmmFace', 'emotesv2_e455cf70a96e44db9da533b89d40f062'),
  g('ImTyping', 'emotesv2_b0c6ccb3b12b4f99a9cc83af365a09f1'),
  g('PizzaTime', 'emotesv2_f202746ed88f4e7c872b50b1f7fd78cc'),
  g('ModLove', 'emotesv2_a2dfbbbbf66f4a75b0f53db841523e6c'),
  g('BigSad', 'emotesv2_db3cd788399347a8b2ebfb8a85f5badb'),
  g('Shush', 'emotesv2_819621bcb8f44566a1bd8ea63d06c58f'),
  g('MyAvatar', 'emotesv2_c0c9c932c82244ff920ad2134be90afb'),
  g('SUBprise', 'emotesv2_fcbeed664f7c47d6ba3b57691275ef51'),
  g('PopNemo', 'emotesv2_5d523adb8bbb4786821cd7091e47da21', true),
  g('DinoDance', 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7', true),
  g('ClapHands', 'emotesv2_cb4c93c8bef44ae6888cf239f98754b7', true),
  g('WeDidThat', 'emotesv2_a7ab2c184e334d4a9784e6e5d51947f7', true),

  // tobi4s_'s own channel emotes (his subscribers).
  ch('tobi4s_', 'tobi4s1GG', 'emotesv2_45dc6d709cb94e8eac6017920130ca4b'),
  ch('tobi4s_', 'tobi4s1Tissue', '305308328'),

  // PinkKittyRose (her raiders).
  ch('pinkkittyrose', 'pkroseHeart', '306925729'),
  ch('pinkkittyrose', 'pkroseHello', '306930058'),
  ch('pinkkittyrose', 'pkroseHype', '306913944'),
  ch('pinkkittyrose', 'pkroseSalute', 'emotesv2_572ee6c7814148c5a4b45d83c95e17e4'),
  ch('pinkkittyrose', 'pkroseGG', '306853584'),
  ch('pinkkittyrose', 'pkroseZoom', '306833990'),
  ch('pinkkittyrose', 'pkroseBloop', '306924875'),
  ch('pinkkittyrose', 'pkroseLurk', '306910897'),
  ch('pinkkittyrose', 'pkroseMega', 'emotesv2_20f35c0038c54e5998146f93a049a0d0'),
  ch('pinkkittyrose', 'pkroseBOOM', 'emotesv2_a4082f719098443da8fda99926a82e4f'),
  ch('pinkkittyrose', 'pkroseFeels', '306845103'),
  ch('pinkkittyrose', 'pkroseShowtime', '307009414'),
  ch('pinkkittyrose', 'pkroseWHAT', '306914654'),

  // The_AGGman (for shot scripts only).
  ch('the_aggman', 'theagg5HYPE', 'emotesv2_4b849118bbfc487dbaeb2187965f830b'),
  ch('the_aggman', 'theagg5LOVE', 'emotesv2_f204a49c5d204a6d8b4524c0d89be539'),
  ch('the_aggman', 'theagg5Cozy', 'emotesv2_bc3481407e7348d4a7606f01e30f06ff'),
  ch('the_aggman', 'theagg5Ohhhh', 'emotesv2_20a1ead2d7a8438b8547ae6653a7fc92'),
  ch('the_aggman', 'theagg5CRY', 'emotesv2_9c16315561d84286b20f610a401e2286'),

  // MashaD4 (for shot scripts only).
  ch('mashad4', 'lovaHype', 'emotesv2_74a064420a5e4129834bbb8051c549b5'),
  ch('mashad4', 'lovaRaid', 'emotesv2_701ab58070674e5db57ecc51e959d547'),
  ch('mashad4', 'lovaHeart', 'emotesv2_9692ea40273c45cbaa43eb884a891211'),
  ch('mashad4', 'lovaWOW', 'emotesv2_3e824f1364964a1fa0afadc695bc59cb'),
  ch('mashad4', 'lovaGG', 'emotesv2_4eebc4c690094ad69cc3b26aaa4767bf'),
  ch('mashad4', 'lovaLove', 'emotesv2_4659ebf36d8d455c9b68ec209dba94b6'),
  ch('mashad4', 'lovaOHH', 'emotesv2_1e55e97954504b16882a4da628cd3802'),
];

/** Every known emote, by its exact (case-sensitive) code. */
export const EMOTES: Readonly<Record<string, EmoteDef>> = Object.freeze(Object.fromEntries(LIST.map((e) => [e.code, e])));

/** All emote definitions in a stable order. */
export const EMOTE_LIST: readonly EmoteDef[] = LIST;

/** Looks up an emote by code; undefined when the word is not an emote. */
export function emote(code: string): EmoteDef | undefined {
  return Object.prototype.hasOwnProperty.call(EMOTES, code) ? EMOTES[code] : undefined;
}
