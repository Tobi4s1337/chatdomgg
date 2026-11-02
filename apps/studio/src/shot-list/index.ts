// Evaluates a shot script at time t into the page's state. Pure: the crowd is generated once per shot from its
// seed, and every other value is a keyframed function of t.
import { camera, num, step } from '../camera/path';
import { cursorAt } from '../cursor/hand';
import { crowd } from '../chat/crowd';
import { cast } from '../chat/roster';
import type { Camera, ChatItem, PageRects, PageState } from '../types';
import { SHOTS } from './list';
import { SIDE, TOBI4S } from './page';
import type { PageScript, ShotScript } from './types';

export { SHOTS } from './list';
export type { ShotScript } from './types';

export function findShot(id: string): ShotScript {
  const shot = SHOTS.find(s => s.id === id.toUpperCase());
  if (!shot) throw new Error(`No shot ${id}`);
  return shot;
}

const chats = new Map<string, readonly ChatItem[]>();
function chatOf(shot: ShotScript): readonly ChatItem[] {
  let items = chats.get(shot.id);
  if (!items) { items = crowd(shot.page!.chat); chats.set(shot.id, items); }
  return items;
}

/** Where the panel's "Light your window" button sits inside the 318×496 panel frame. */
export const PANEL_BUTTON: readonly [number, number] = [159, 317];

/** The scripted inputs of a shot, as viewport points (the recorder dispatches real clicks there). */
export function shotActions(shot: ShotScript, rects: PageRects): { at: number; kind: 'click'; x: number; y: number }[] {
  const page = shot.page as (PageScript & { clickPanel?: boolean }) | undefined;
  if (!page?.clickPanel) return [];
  const key = page.cursor[page.cursor.length - 1]!;
  return [{ at: key.t, kind: 'click', ...panelButton(page, rects, key.t) }];
}

/** The panel button as a viewport point at time t. The rects are measured on frame 0, at that frame's scroll. */
function panelButton(page: PageScript, rects: PageRects, t: number): { x: number; y: number } {
  return { x: rects.panel.x + PANEL_BUTTON[0], y: rects.panel.y + num(page.scroll, 0) - num(page.scroll, t) + PANEL_BUTTON[1] };
}

/** The virtual camera never looks past the page: its view stays inside the 1920×1080 frame at every zoom. */
function framed(view: Camera): Camera {
  const zoom = Math.max(1, view.zoom), hw = 960 / zoom, hh = 540 / zoom;
  return { zoom, cx: Math.min(1920 - hw, Math.max(hw, view.cx)), cy: Math.min(1080 - hh, Math.max(hh, view.cy)) };
}

export function evaluate(shot: ShotScript, t: number, rects?: PageRects): PageState {
  const page = shot.page as (PageScript & { clickPanel?: boolean }) | undefined;
  if (!page) throw new Error(`${shot.id} is a kingdom shot; it has no page`);
  const scroll = num(page.scroll, t);
  // The tap lands on the panel button wherever the layout put it.
  const keys = page.clickPanel && rects
    ? page.cursor.map((key, i) => i === page.cursor.length - 1 ? { ...key, ...panelButton(page, rects, key.t) } : key)
    : page.cursor;
  let composing = '';
  for (const line of page.composing) {
    if (t >= line.at && t < line.send) composing = line.text.slice(0, Math.round(line.text.length * Math.min(1, (t - line.at) / line.typing)));
  }
  return {
    t,
    channel: TOBI4S,
    side: SIDE,
    me: { display: cast.me.display, avatar: cast.me.avatar },
    viewers: Math.round(num(page.viewers, t)),
    uptime: Math.floor(page.uptimeAtStart + t),
    theatre: step(page.theatre, t),
    following: step(page.following, t),
    followPress: 0,
    chat: chatOf(shot).filter(item => item.at <= t),
    composing,
    hypeTrain: step(page.hypeTrain, t),
    scroll,
    player: page.player,
    panel: { query: step(page.panel, t) },
    cursor: cursorAt(keys, t),
    camera: framed(camera(page.camera, t)),
  };
}
