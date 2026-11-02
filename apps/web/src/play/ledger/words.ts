import type { PlayAction, PlaySettings } from '../slots';
import { SETTING_LIMITS } from '../settings';

/** The words the ledger writes. Plain, warm and short; numbers are rounded to what a person can use. */

export const DENSITY_WORDS: Readonly<Record<PlaySettings['labels'], string>> = { all: 'Everyone', nearby: 'Close by', few: 'Only a few' };
export const DENSITY_ORDER: readonly PlaySettings['labels'][] = ['all', 'nearby', 'few'];

export const ACTION_WORDS: Readonly<Record<PlayAction, string>> = {
  forward: 'Walk forward', back: 'Walk back', left: 'Step left', right: 'Step right', jump: 'Jump', sprint: 'Run',
  use: 'Use', view: 'First or third person', ledger: 'Open the ledger', fullscreen: 'Fullscreen',
};

const ROMAN: readonly [number, string][] = [[50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
/** Folio numbers, the way a ledger numbers its leaves. */
export function folio(n: number): string {
  let left = Math.max(1, Math.min(89, Math.round(n))), out = '';
  for (const [value, mark] of ROMAN) while (left >= value) { out += mark; left -= value; }
  return out;
}

const grouped = new Intl.NumberFormat('en-GB');
/**
 * How far, in metres only (one honest unit): exact while close, then rounded the way a person would say it.
 * Straight-line distance, so "about" once it is rounded.
 */
export function distanceWords(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '';
  if (metres < 3) return 'right beside you';
  if (metres < 20) { const m = Math.round(metres); return `${m} metres away`; }
  const step = metres < 100 ? 5 : metres < 1000 ? 10 : 50;
  return `about ${grouped.format(Math.round(metres / step) * step)} metres away`;
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(radians: number): number {
  const turn = Math.PI * 2;
  let a = ((radians % turn) + turn) % turn;
  if (a > Math.PI) a -= turn;
  return a;
}

/** Which way, relative to where you look: 0 ahead, positive to the right. */
export function directionWords(relative: number): string {
  if (!Number.isFinite(relative)) return '';
  const a = wrapAngle(relative), deg = Math.abs(a) * 180 / Math.PI, side = a > 0 ? 'right' : 'left';
  if (deg <= 22.5) return 'straight ahead';
  if (deg <= 67.5) return `ahead, to your ${side}`;
  if (deg <= 112.5) return `to your ${side}`;
  if (deg <= 157.5) return `behind you, to your ${side}`;
  return 'behind you';
}

/** Mouse sensitivity moves in even steps of feel: 33 stops from a quarter to four times, with 1 in the middle. */
export const SENSITIVITY_STOPS: readonly number[] = Object.freeze(Array.from({ length: 33 }, (_, i) =>
  Math.round(SETTING_LIMITS.sensitivity[0] * 2 ** (i / 8) * 100) / 100));
export function sensitivityStop(value: number): number {
  let best = 0;
  for (let i = 1; i < SENSITIVITY_STOPS.length; i++) {
    if (Math.abs(Math.log(SENSITIVITY_STOPS[i]! / value)) < Math.abs(Math.log(SENSITIVITY_STOPS[best]! / value))) best = i;
  }
  return best;
}
export const sensitivityWords = (value: number) => `${value.toFixed(2)}×`;
export const percentWords = (value: number) => `${Math.round(value * 100)}%`;
export const fovWords = (value: number) => `${Math.round(value)}°`;
