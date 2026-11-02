// A shot script is typed data. The studio evaluates it at a time t into a PageState (page shots), and the edit
// reads its kingdom source (plates and stills). Nothing here reads the clock: (shot, t) decides every pixel.
import type { CameraValue, Key } from '../camera/path';
import type { CursorKey } from '../cursor/hand';
import type { CrowdScript, HypeTrain, PlayerContent } from '../types';

/** Where a shot's kingdom pixels come from, today. */
export type KingdomSource =
  /** A frame-stepped GPU take in the media folder (`takes/<take>/`), from frame `in`. */
  | { kind: 'take'; take: string; in: number; route: string; note?: string }
  /** A real still, moved in the edit (Ken Burns), until the moment can be staged. */
  | { kind: 'still'; src: string; from: { scale: number; x: number; y: number }; to: { scale: number; x: number; y: number }; crop?: readonly [number, number, number, number]; note: string }
  /** A real video render already in the repo's evidence, retimed. */
  | { kind: 'clip'; src: string; in: number; speed: number; crop?: readonly [number, number, number, number]; note: string };

/**
 * A film take (rig/film.mjs) a shot uses in the first cut, from `in` seconds of the take. A shot made of several
 * moments of one take (the Forge) or of two takes (the rise into the map) lists each; `share` is its part of the
 * shot's length, and `enter` the transition into it from the moment before.
 */
export interface FilmUse { take: string; in: number; share?: number; enter?: { kind: 'cut' } | { kind: 'dissolve' | 'fadeblack' | 'fadewhite'; dur: number } }

export interface PageScript {
  theatre: readonly Key<boolean>[];
  scroll: readonly Key<number>[];
  viewers: readonly Key<number>[];
  following: readonly Key<boolean>[];
  chat: CrowdScript;
  /** Lines typed into the viewer's own chat box: the text appears over [at, at + typing], then sends at `send`. */
  composing: readonly { at: number; typing: number; text: string; send: number }[];
  hypeTrain: readonly Key<HypeTrain | null>[];
  player: PlayerContent;
  panel: readonly Key<string>[];
  cursor: readonly CursorKey[];
  camera: readonly Key<CameraValue>[];
  /** Seconds the stream has been live at t = 0. */
  uptimeAtStart: number;
}

export interface ShotScript {
  id: string;
  title: string;
  /** The shot's place in the cut (seconds), before the edit snaps it to the music. */
  cut: readonly [number, number];
  duration: number;
  narration?: string;
  source: 'page' | 'kingdom' | 'set piece' | 'page then kingdom';
  /** What the shot shows, in a sentence. */
  picture: string;
  /** The product hooks and routes the shot depends on (checked by rig/hooks-check.mjs). */
  hooks: readonly string[];
  page?: PageScript;
  kingdom?: KingdomSource;
  /** The film takes that replace `kingdom` in the first cut, once each is verified. */
  film?: readonly FilmUse[];
  /** Today's state: 'staged' is a real render of today's build; 'stand-in' is a real still or clip, moved. */
  status: 'staged' | 'stand-in';
  doubts?: string;
}
