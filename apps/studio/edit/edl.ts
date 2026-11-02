// The edit is data. One list of clips, cards, narration and sound renders every cut (rough, first, final);
// `render.mjs` turns it into ffmpeg. Times are seconds in the cut. Sources resolve to the media folder.
import { SHOTS } from '../src/shot-list/list';
import type { FilmUse, ShotScript } from '../src/shot-list/types';

export interface EditClip {
  shot: string;
  /** Where the clip's picture comes from: a recorded studio take (page or frame), a GPU take, or a video file. */
  source: { kind: 'frames'; dir: string; ext: 'png' | 'jpg'; in: number; fps: number } | { kind: 'video'; file: string; in: number; speed: number; crop?: readonly [number, number, number, number] };
  at: number;
  dur: number;
  /** The transition into this clip, overlapping the previous one by `dur`. */
  enter: { kind: 'cut' } | { kind: 'dissolve' | 'fadeblack' | 'fadewhite'; dur: number };
}
export interface EditCard { card: string; at: number; dir: string }
/** `caption: false` for a line the picture already shows in words (the close card's line). */
export interface EditLine { id: string; text: string; at: number; audio: string; duration: number; words: { text: string; start: number; end: number }[]; caption: boolean }
export interface EditSound { file: string; at: number; gain: number; fadeOut?: number; dur?: number }
export interface Edit {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  clips: EditClip[];
  cards: EditCard[];
  lines: EditLine[];
  music: { file: string; gain: number; duckDb: number } | null;
  sounds: EditSound[];
  /** Video bitrate target in kb/s (to land a review encode under its size cap), or null for quality mode. */
  kbps: number | null;
}

export const MEDIA = '/srv/chatdom/media/teaser';
const TAKES = `${MEDIA}/takes`;

/** Where a shot's picture is, for the rough cut. Page shots and moved stills are studio recordings. */
export function clipSource(shot: ShotScript): EditClip['source'] {
  if (shot.page) return { kind: 'frames', dir: `${TAKES}/page-${shot.id}`, ext: 'png', in: 0, fps: 60 };
  const k = shot.kingdom!;
  if (k.kind === 'still') return { kind: 'frames', dir: `${TAKES}/still-${shot.id}`, ext: 'jpg', in: 0, fps: 60 };
  if (k.kind === 'clip') return { kind: 'video', file: k.src, in: k.in, speed: k.speed, ...(k.crop ? { crop: k.crop } : {}) };
  return { kind: 'frames', dir: `${TAKES}/${k.take}`, ext: 'jpg', in: k.in / 60, fps: 60 };
}

/** Transitions by shot: most cuts are hard (cut on the beat); a few breathe. */
const ENTER: Record<string, EditClip['enter']> = {
  S04: { kind: 'dissolve', dur: 0.5 },
  S08: { kind: 'dissolve', dur: 0.35 },
  S11: { kind: 'fadewhite', dur: 0.25 },
  S13: { kind: 'dissolve', dur: 0.4 },
  S19: { kind: 'dissolve', dur: 0.6 },
  S20: { kind: 'dissolve', dur: 0.6 },
  S21: { kind: 'dissolve', dur: 0.8 },
  S22: { kind: 'dissolve', dur: 0.9 },
};

/** Narration lands a beat into its shot, so the picture speaks first. */
const LINE_DELAY: Record<string, number> = { S01: 0.7, S02: 0.5, S04: 1.2, S05: 0.6, S06: 0.4, S08: 0.9, S09: 0.9, S10: 0.3, S11: 0.4, S13: 1.0, S15: 0.6, S17: 0.8, S18: 0.6, S19: 0.9, S21: 0.6, S22: 1.2, CARD: 0 };

export interface Scratch { lines: { shot: string; text: string; audio: string; duration: number; words: { text: string; start: number; end: number }[] }[] }

/** A verified film take's master (rig/verify.mjs), by take name; the first cut uses a shot's film takes only when
 * every one of them is in here. */
export type Masters = Record<string, string>;

/** The film takes of a shot as video sources over [a, b), split by their shares. */
function filmClips(shot: ShotScript, uses: readonly FilmUse[], masters: Masters, a: number, b: number, enter: EditClip['enter']): EditClip[] {
  const total = uses.reduce((n, u) => n + (u.share ?? 1 / uses.length), 0);
  const out: EditClip[] = [];
  let at = a;
  for (const [i, use] of uses.entries()) {
    const len = (b - a) * (use.share ?? 1 / uses.length) / total;
    const into = i === 0 ? enter : use.enter ?? { kind: 'cut' as const };
    const overlap = into.kind === 'cut' ? 0 : into.dur;
    // A moment cut out of a longer take enters a little early so a dissolve has picture under it.
    out.push({ shot: uses.length > 1 ? `${shot.id}${'abcd'[i]}` : shot.id, source: { kind: 'video', file: masters[use.take]!, in: Math.max(0, use.in - overlap), speed: 1 }, at: at - overlap, dur: len + overlap, enter: into });
    at += len;
  }
  return out;
}

export function buildEdit({ name, width, height, fps, scratch, music, kbps, extend = {}, masters = null }: {
  name: string; width: number; height: number; fps: number; scratch: Scratch; music: Edit['music']; kbps: number | null;
  /** Override a shot's cut range, e.g. snapped to the music. */
  extend?: Record<string, readonly [number, number]>;
  /** The first cut: verified film masters by take (null for the rough cut, which uses TS10's sources). */
  masters?: Masters | null;
}): Edit & { sources: Record<string, string> } {
  const clips: EditClip[] = [];
  /** Where each shot's kingdom picture came from in this cut, for the report. */
  const sources: Record<string, string> = {};
  for (const shot of SHOTS) {
    const [a, b] = extend[shot.id] ?? shot.cut;
    const enter = ENTER[shot.id] ?? { kind: 'cut' as const };
    const overlap = enter.kind === 'cut' ? 0 : enter.dur;
    const film = masters && shot.film?.every(u => masters[u.take]) ? shot.film : null;
    const paged = shot.source === 'page then kingdom';
    if (film && !paged) {
      clips.push(...filmClips(shot, film, masters!, a, b, enter));
      sources[shot.id] = film.map(u => u.take).join(' + ');
      continue;
    }
    clips.push({ shot: shot.id, source: clipSource(shot), at: a - overlap, dur: b - a + overlap, enter });
    sources[shot.id] = shot.page ? 'studio page' : shot.kingdom?.kind === 'take' ? `TS10 take ${shot.kingdom.take}` : `stand-in ${shot.kingdom?.kind ?? ''}`;
    // A page shot that pushes into the player continues as the full-frame kingdom take.
    if (paged && (film || shot.kingdom?.kind === 'take')) {
      const split = shot.id === 'S03' ? 3.2 : 1.4;
      const page = clips[clips.length - 1]!;
      page.dur = split + overlap;
      const blend = shot.id === 'S03' ? 0.25 : 0.3;
      const into = { kind: 'dissolve' as const, dur: blend };
      if (film) {
        clips.push(...filmClips(shot, film, masters!, a + split, b, into).map(c => ({ ...c, shot: `${shot.id}k` })));
        sources[shot.id] = `studio page + ${film.map(u => u.take).join(' + ')}`;
      } else if (shot.kingdom?.kind === 'take') {
        clips.push({ shot: `${shot.id}k`, source: { kind: 'frames', dir: `${TAKES}/${shot.kingdom.take}`, ext: 'jpg', in: shot.kingdom.in / 60, fps: 60 },
          at: a + split - blend, dur: b - a - split + blend, enter: into });
        sources[shot.id] = `studio page + TS10 take ${shot.kingdom.take}`;
      }
    }
  }
  const end = Math.max(...SHOTS.map(s => (extend[s.id] ?? s.cut)[1]));
  const s04 = extend.S04 ?? SHOTS.find(s => s.id === 'S04')!.cut;
  const s22 = extend.S22 ?? SHOTS.find(s => s.id === 'S22')!.cut;
  const cards: EditCard[] = [
    { card: 'title', at: s04[0], dir: `${TAKES}/card-title` },
    { card: 'close', at: s22[0], dir: `${TAKES}/card-close` },
  ];
  const lines: EditLine[] = [];
  for (const line of scratch.lines) {
    const shot = line.shot === 'CARD' ? 'S22' : line.shot;
    const range = extend[shot] ?? SHOTS.find(s => s.id === shot)?.cut;
    if (!range) continue;
    // The card's line follows "Your chat is waiting." once the card is up.
    const at = line.shot === 'CARD' ? range[0] + 3.4 : range[0] + (LINE_DELAY[line.shot] ?? 0.5);
    lines.push({ id: line.shot, text: line.text, at, audio: line.audio, duration: line.duration, words: line.words, caption: line.shot !== 'CARD' });
  }
  const start = (id: string) => (extend[id] ?? SHOTS.find(s => s.id === id)!.cut)[0];
  const AMB = `${MEDIA}/audio/ambience/edit`;
  // The kingdom's own sounds (rendered offline from packages/audio), placed on the picture.
  const sounds: EditSound[] = [
    { file: `${AMB}/bed-evening-town.wav`, at: start('S04'), gain: 0.35, dur: start('S08') - start('S04') + 1, fadeOut: 1 },
    { file: `${AMB}/hero-light.wav`, at: start('S03') + 3.4, gain: 0.7 },
    { file: `${AMB}/hero-wave.wav`, at: start('S08') + 0.4, gain: 0.75 },
    { file: `${AMB}/hero-light.wav`, at: start('S09') + 1.65, gain: 0.8 },
    // The strike's impact is 0.65 s into the file; it lands on the music's hammer hit.
    { file: `${AMB}/hero-forge-strike.wav`, at: 40.851 - 0.65, gain: 0.9, dur: 3.2, fadeOut: 1.2 },
    { file: `${AMB}/hero-forge-landing.wav`, at: start('S12') + 0.2, gain: 0.8 },
    { file: `${AMB}/hero-crowd-murmur.wav`, at: start('S13') + 2.2, gain: 0.5 },
    { file: `${AMB}/hero-crowd-cheer.wav`, at: start('S14') + 0.3, gain: 0.7 },
    { file: `${AMB}/hero-cart-roll.wav`, at: start('S15'), gain: 0.6 },
    { file: `${AMB}/hero-beacon.wav`, at: start('S17') + 0.2, gain: 0.75 },
    { file: `${AMB}/hero-horn.wav`, at: start('S18'), gain: 0.7 },
    { file: `${AMB}/bed-night-town.wav`, at: start('S20'), gain: 0.3, dur: end - start('S20') + 1, fadeOut: 2 },
  ];
  return { name, width, height, fps, duration: end + 1.2, clips, cards, lines, music, sounds, kbps, sources };
}
