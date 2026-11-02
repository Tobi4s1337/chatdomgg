// The studio's shared vocabulary. Every frame the studio draws is a pure function of (shot, t):
// a shot script (typed data) is evaluated at a time t in seconds into a PageState, and the page
// replica renders that state and nothing else. Nothing on the page animates on its own.

/** A Twitch chat badge, by its global badge set id and version (e.g. `subscriber`/`12`, `moderator`/`1`). */
export interface Badge { set: string; version: string }

/** One invented chatter. Names are checked against Helix Get Users so that none is a real account. */
export interface Chatter {
  login: string;
  display: string;
  /** Twitch name colour, `#rrggbb`. */
  color: string;
  badges: readonly Badge[];
}

/** A run of chat text: plain words, a Twitch emote by id and code, or an @mention. */
export type Fragment =
  | { kind: 'text'; text: string }
  | { kind: 'emote'; id: string; code: string }
  | { kind: 'mention'; login: string };

export type ChatItem =
  | { kind: 'message'; id: string; at: number; from: Chatter; fragments: readonly Fragment[]; reply?: { to: Chatter; text: string }; highlight?: 'first-time' }
  /** Twitch's own notices in chat: subs, resubs, gifts, raids, announcements. */
  | { kind: 'sub'; id: string; at: number; from: Chatter; tier: 1 | 2 | 3; months: number; streak?: number; prime?: boolean; fragments?: readonly Fragment[] }
  | { kind: 'gift'; id: string; at: number; from: Chatter; count: number; tier: 1 | 2 | 3 }
  | { kind: 'raid'; id: string; at: number; from: { login: string; display: string; avatar: string }; viewers: number }
  | { kind: 'announcement'; id: string; at: number; from: Chatter; fragments: readonly Fragment[]; accent: 'primary' | 'purple' | 'green' | 'orange' | 'blue' };

/** The channel as the page header shows it. */
export interface ChannelInfo {
  login: string;
  display: string;
  avatar: string;
  title: string;
  category: string;
  tags: readonly string[];
  followers: number;
  about: string;
  /** Seconds the stream has been live at t = 0 of the shot. */
  uptimeAtStart: number;
}

/** A recommended channel in the side bar. Invented except for the consenting Genesis channels. */
export interface SideChannel { login: string; display: string; avatar: string; category: string; viewers: number; live: boolean }

/** What fills the player rectangle. */
export type PlayerContent =
  /** Transparent: a kingdom plate is composited later at the player's exact rectangle. */
  | { kind: 'key' }
  /** A rendered frame sequence from the media folder; frame = round((t - offset) * 60). */
  | { kind: 'plate'; take: string; offset: number; frames: number; ext: 'jpg' | 'png' }
  /** A real still, moved in the edit: a slow scale and drift as functions of t. */
  | { kind: 'still'; src: string; from: { scale: number; x: number; y: number }; to: { scale: number; x: number; y: number }; duration: number }
  /** The real stream view in an iframe on the same origin (GPU recordings only). */
  | { kind: 'live'; src: string };

export interface HypeTrain { level: number; progress: number; expiresIn: number; conductors?: readonly Chatter[] }

/** The cursor, drawn by the studio over the page. */
export interface Cursor { x: number; y: number; visible: boolean; pressed: number; shape: 'arrow' | 'hand' }

/** The virtual camera over the composed page: a centre point in page pixels and a zoom (1 = the whole page). */
export interface Camera { cx: number; cy: number; zoom: number }

/** Everything the page needs to draw one frame. */
export interface PageState {
  t: number;
  channel: ChannelInfo;
  side: readonly SideChannel[];
  /** The logged-in viewer whose screen this is (an invented account): the top bar's avatar. */
  me: { display: string; avatar: string };
  /** Viewer count shown under the follow button. */
  viewers: number;
  /** Seconds live, for the uptime clock. */
  uptime: number;
  theatre: boolean;
  following: boolean;
  /** 0..1 progress of the follow button's press, for the heart animation. */
  followPress: number;
  /** Chat items that have arrived by t, oldest first; the page keeps the latest that fit. */
  chat: readonly ChatItem[];
  /** The line being typed in the viewer's own chat box, if any. */
  composing: string;
  hypeTrain: HypeTrain | null;
  /** Main column scroll in CSS pixels (0 = top). */
  scroll: number;
  player: PlayerContent;
  /** The Chatdom panel: its iframe query (`state=` etc.), shown in the About/panels area. */
  panel: { query: string };
  cursor: Cursor;
  camera: Camera;
}

/** The rectangles the compositor and the recorder need, in page CSS pixels at 1920×1080. */
export interface PageRects { player: Rect; chat: Rect; panel: Rect }
export interface Rect { x: number; y: number; width: number; height: number }

/** A crowd beat: how chat behaves around a moment. The chat model turns beats into timed lines from a seed. */
export interface CrowdBeat {
  at: number;
  duration: number;
  mood: 'trickle' | 'greet' | 'hype' | 'awe' | 'forge' | 'raid-welcome' | 'emote-wave' | 'farewell';
  /** Messages per second at the beat's peak; the model shapes the rise and fall. */
  rate?: number;
  /** An emote code for emote waves (e.g. `LUL`, `PopNemo`). */
  emote?: string;
  /** Free words the crowd reacts to (e.g. `dragon chimney`), used to pick lines. */
  topic?: string;
}

/** The chat of one shot: hero lines placed exactly, plus a seeded crowd around them. */
export interface CrowdScript {
  seed: string;
  /** Shot time range the crowd fills, in seconds; lines before `start` pre-fill the backlog. */
  start: number;
  end: number;
  scripted: readonly ChatItem[];
  beats: readonly CrowdBeat[];
}

/** Media served by the studio server from the lane's media folder (never in git). */
export const MEDIA = '/media/teaser';
export const emoteUrl = (id: string) => `${MEDIA}/reference/emotes/${id}.png`;
export const badgeUrl = (badge: Badge) => `${MEDIA}/reference/badges/${badge.set}-${badge.version}.png`;

/** What a studio page exposes to the recorder as `window.__studio`. */
export interface StudioApi {
  shot: string;
  duration: number;
  /** Draws the frame at t seconds and resolves once every image in view has decoded. */
  frame(t: number): Promise<void>;
  /** The page's layout boxes (page shots only). */
  rects?(): PageRects;
  /** Scripted inputs as viewport points; the recorder dispatches them as real clicks. */
  actions: { at: number; kind: 'click'; x: number; y: number }[];
  ready: boolean;
}
declare global { interface Window { __studio?: StudioApi; __chatdomReady?: boolean } }
