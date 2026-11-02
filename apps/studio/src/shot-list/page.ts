// Page shots: the tobi4s_ channel page on one Monday night, and a terse builder for each shot's page script.
import type { CameraValue, Key } from '../camera/path';
import { PAGE_CAMERA } from '../camera/path';
import type { CursorKey } from '../cursor/hand';
import type { ChannelInfo, ChatItem, CrowdBeat, HypeTrain, PlayerContent, SideChannel } from '../types';
import type { PageScript } from './types';

export const TOBI4S: ChannelInfo = {
  login: 'tobi4s_', display: 'tobi4s_',
  avatar: '/media/teaser/reference/avatars/tobi4s_.png',
  title: 'building a kingdom for my chat | !kingdom',
  category: 'Software and Game Development',
  tags: ['English', 'Deutsch', 'GameDev', 'Coding', 'Cozy'],
  followers: 1284,
  about: 'Web-Developer from Germany. Building Chatdom: every chat gets a kingdom.',
  uptimeAtStart: 0,
};

/** The side bar: the consenting Genesis channels, then invented channels (names checked like the chatters). */
export const SIDE: readonly SideChannel[] = [
  { login: 'pinkkittyrose', display: 'PinkKittyRose', avatar: '/media/teaser/reference/avatars/pinkkittyrose.png', category: 'The Legend of Zelda: A Link to the Past', viewers: 48, live: true },
  { login: 'mashad4', display: 'MashaD4', avatar: '/media/teaser/reference/avatars/mashad4.png', category: 'Chess', viewers: 1240, live: true },
  { login: 'the_aggman', display: 'The_AGGman', avatar: '/media/teaser/reference/avatars/the_aggman.png', category: 'Valheim', viewers: 37, live: true },
];

export interface PageShotOptions {
  seed: string;
  viewers: readonly Key<number>[];
  uptime: number;
  player: PlayerContent;
  panel: string;
  cursor: readonly CursorKey[];
  camera?: readonly Key<CameraValue>[];
  theatre?: boolean;
  scroll?: readonly Key<number>[];
  beats: readonly CrowdBeat[];
  scripted: readonly ChatItem[];
  composing?: PageScript['composing'];
  hypeTrain?: readonly Key<HypeTrain | null>[];
  /** The cursor's last key taps the panel's "Light your window" button. */
  clickPanel?: boolean;
}

export function pageShot(o: PageShotOptions): PageScript & { clickPanel: boolean } {
  const start = Math.min(-20, ...o.beats.map(b => b.at));
  const end = Math.max(...o.beats.map(b => b.at + b.duration), 10);
  return {
    theatre: [{ t: 0, v: o.theatre ?? false }],
    scroll: o.scroll ?? [{ t: 0, v: 0 }],
    viewers: o.viewers,
    following: [{ t: 0, v: true }],
    chat: { seed: o.seed, start, end, scripted: o.scripted, beats: o.beats },
    composing: o.composing ?? [],
    hypeTrain: o.hypeTrain ?? [{ t: 0, v: null }],
    player: o.player,
    panel: [{ t: 0, v: o.panel }],
    cursor: o.cursor,
    camera: o.camera ?? [{ t: 0, v: PAGE_CAMERA }],
    uptimeAtStart: o.uptime,
    clickPanel: o.clickPanel ?? false,
  };
}
