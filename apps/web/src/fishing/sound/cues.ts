import type { PierSampleId } from './kit';
import type { Shade } from './law';
import type { Shot } from './shot';
import type { PierCue } from './types';

/**
 * Every beat of a catch, as a recipe of wood, water and line. Water is noise bursts with resonant bubbles and
 * droplets; line is narrow-band noise sweeps and a plucked, tuned delay; the reel is a train of tiny clicks; wood
 * and paper are Kenney's recorded contacts, each given its own resonance. Levels are written at intensity 0.5 and
 * scaled by the cue's shade; each recipe's fader was set by measuring its peak against the kingdom's own cues.
 */
export interface PierRecipe {
  readonly variations: number;
  /** The recipe's fader in dB. */
  readonly fader: number;
  build(shot: Shot, shade: Shade, variation: number): void;
}

const KNOCKS: readonly PierSampleId[] = ['knock-a', 'knock-b', 'knock-c'];
const SETS: readonly PierSampleId[] = ['set-a', 'set-b', 'set-a'];
const BOARDS: readonly PierSampleId[] = ['board-a', 'board-b', 'board-c'];
const SOFTS: readonly PierSampleId[] = ['soft-a', 'soft-b', 'soft-c'];
const CLOTHS: readonly PierSampleId[] = ['cloth-a', 'cloth-b', 'cloth-c'];
const PAGES: readonly PierSampleId[] = ['page-a', 'page-b', 'page-c'];
/** Where each knock's own wood rings, Hz (measured on the recordings by the kingdom's audio). */
const KNOCK_RING = [690, 640, 735] as const;

/** A recording, filtered, into `target`; silently absent while it decodes. */
function contact(shot: Shot, target: AudioNode, id: PierSampleId, at: number, rate: number, gain: number, low: number, high: number): void {
  const take = shot.sample(id, at, rate, gain);
  if (take) shot.chain(take, shot.filter('highpass', low, 0.6), shot.filter('lowpass', high, 0.5), target);
}

/** Three places in the stereo field for droplets and spray. */
function spread(shot: Shot, width: number): AudioNode[] {
  return [-width, 0, width].map(value => { const node = shot.pan(value); node.connect(shot.out); return node; });
}

/** The rod drawn back: the cork grip tightening, the willow loading with a creak, the line drawn through the rings. */
const DRAW: PierRecipe = {
  variations: 3,
  fader: 7,
  build(shot, s, v) {
    const t = shot.t, r = shot.random;
    shot.room = 0.05;
    contact(shot, shot.out, CLOTHS[v]!, t, 1.1 + 0.08 * r(), 0.12 * s.level, 300, 3200);
    shot.creak(shot.out, t + 0.04, 0.5, [19 + 4 * r(), 33 + 6 * r(), 16 + 3 * r()], 0.05 * s.level, [610, 1340, 2480]);
    shot.breath(shot.out, t + 0.13, 'bandpass', 2300, 9, 0.07, 0.03 * s.level, 0.07, 3500 * s.bright, 0.2);
  },
};

/** The cast: the rod swishing over the shoulder, the line singing off the spool, falling in pitch as the float flies. */
const CAST: PierRecipe = {
  variations: 3,
  fader: 5.5,
  build(shot, s, v) {
    const t = shot.t, r = shot.random;
    shot.room = 0.08;
    const travel = shot.pan(-0.3);
    travel.pan.setValueAtTime(-0.3, t);
    travel.pan.linearRampToValueAtTime(0.3, t + 0.24);
    travel.connect(shot.out);
    const swish = shot.breath(travel, t, 'bandpass', 520, 1.3, 0.085, 0.2 * s.level, 0.05, 1900 * s.bright, 0.085);
    swish.frequency.exponentialRampToValueAtTime(640, t + 0.27);

    const sing = shot.gain(0), start = t + 0.07, fall = 0.6 + 0.08 * v;
    sing.gain.setValueAtTime(0, start);
    sing.gain.linearRampToValueAtTime(0.05 * s.level, start + 0.05);
    sing.gain.setTargetAtTime(0.034 * s.level, start + 0.05, 0.15);
    sing.gain.setTargetAtTime(0, t + fall - 0.14, 0.06);
    const source = shot.noise(start, t + fall + 0.35);
    for (const [ratio, q, level] of [[1, 12, 1], [1.5, 14, 0.5]] as const) {
      const band = shot.filter('bandpass', 3400 * s.bright * ratio, q), amp = shot.gain(level);
      band.frequency.setValueAtTime((3300 + 250 * r()) * s.bright * ratio, start);
      band.frequency.exponentialRampToValueAtTime(1050 * ratio, t + fall);
      shot.chain(source, band, amp, sing);
    }
    sing.connect(shot.out);
    // The spool paying out against its check: a faint, fast purr.
    shot.ratchet(shot.out, t + 0.08, 0.5, [92, 112, 46], 0.02 * s.level, 2600);
  },
};

/** The float landing: the nose touching, a round plop as the cavity closes, then the ring spreading out. */
const PLOP: PierRecipe = {
  variations: 3,
  fader: 0,
  build(shot, s) {
    const t = shot.t, r = shot.random, z = s.size;
    shot.room = 0.12;
    shot.burst(shot.out, t, 'bandpass', 1500 * s.bright, 1, 0.0008, 0.07 * s.level, 0.006);
    shot.bubble(shot.out, t + 0.004, 330 / z + 40 * r(), 0.032 * z, 1.2, 0.2 * s.level);
    shot.burst(shot.out, t, 'lowpass', 300, 0.8, 0.002, 0.08 * s.level, 0.025);
    shot.droplets(spread(shot, 0.3), t + 0.05, t + 0.28, 3, 1500, 2800, 0.03 * s.level);
    shot.breath(shot.out, t + 0.03, 'bandpass', 5200 * s.bright, 2, 0.06, 0.012 * s.level, 0.12);
    shot.breath(shot.out, t + 0.06, 'lowpass', 420, 0.7, 0.05, 0.03 * s.level, 0.12);
  },
};

/** A nibble: the float knocked on the water, tick and tock, barely there. */
const NIBBLE: PierRecipe = {
  variations: 3,
  fader: 7.5,
  build(shot, s, v) {
    const t = shot.t, r = shot.random;
    shot.room = 0.06;
    const taps: readonly (readonly [number, number, number, number])[] = v === 2
      ? [[0, 760, 0.009, 0.8], [0.09 + 0.02 * r(), 1080, 0.006, 1], [0.2 + 0.03 * r(), 900, 0.007, 0.55]]
      : [[0, 1100 + 80 * v, 0.006, 1], [0.1 + 0.03 * r(), 780, 0.009, 0.8]];
    for (const [at, hz, tau, level] of taps) {
      shot.bubble(shot.out, t + at, hz, tau, 0.2, 0.03 * s.level * level);
      shot.burst(shot.out, t + at, 'bandpass', 2800, 2, 0.0004, 0.015 * s.level * level, 0.0025);
    }
    shot.breath(shot.out, t + 0.02, 'lowpass', 650, 0.7, 0.03, 0.012 * s.level, 0.05);
  },
};

/** The bite: the float snatched under, a sharp wet snap, the water closing over it and a few drops. */
const BITE: PierRecipe = {
  variations: 3,
  fader: 7,
  build(shot, s) {
    const t = shot.t, z = s.size;
    shot.room = 0.1;
    shot.burst(shot.out, t, 'bandpass', 3000 * s.bright, 0.9, 0.0006, 0.2 * s.level, 0.009);
    shot.burst(shot.out, t, 'highpass', 1800, 0.7, 0.0005, 0.08 * s.level, 0.004);
    shot.burst(shot.out, t + 0.003, 'bandpass', 2400 * s.bright, 0.8, 0.002, 0.16 * s.level, 0.045, 850, 0.12);
    shot.bubble(shot.out, t + 0.012, 300 / z, 0.035 * z, 1.1, 0.08 * s.level);
    shot.burst(shot.out, t + 0.004, 'lowpass', 340, 0.8, 0.003, 0.1 * s.level, 0.035 * z);
    shot.droplets(spread(shot, 0.35), t + 0.05, t + 0.3, 3 + Math.round(2 * z), 1100, 2600, 0.04 * s.level);
  },
};

/** The strike: the rod whipped up, the willow taking the weight, the line coming taut with a short twang. */
const STRIKE: PierRecipe = {
  variations: 3,
  fader: 10,
  build(shot, s) {
    const t = shot.t, r = shot.random;
    shot.room = 0.07;
    const whip = shot.breath(shot.out, t, 'bandpass', 650, 1.8, 0.045, 0.2 * s.level, 0.035, 3000 * s.bright, 0.06);
    whip.frequency.exponentialRampToValueAtTime(1100, t + 0.16);
    shot.creak(shot.out, t + 0.04, 0.24, [34, 26, 18], 0.04 * s.level, [700, 1500]);
    shot.pluck(shot.out, t + 0.055, 210 + 30 * r(), 0.16, 2000 * s.bright, 0.25 * s.level);
  },
};

/** The run: line peeling off the reel against its drag, hissing through the rings and cutting the water. */
const RUN: PierRecipe = {
  variations: 3,
  fader: 8.5,
  build(shot, s) {
    const t = shot.t, r = shot.random, length = 0.5 + 0.45 * s.size;
    shot.room = 0.06;
    shot.ratchet(shot.out, t, length, [48, 80 + 12 * r(), 56], 0.12 * s.level, 2500 * s.bright ** 0.3);

    const hiss = shot.gain(0);
    hiss.gain.setValueAtTime(0, t);
    hiss.gain.linearRampToValueAtTime(0.02 * s.level, t + 0.03);
    hiss.gain.setTargetAtTime(0, t + length - 0.1, 0.05);
    shot.chain(shot.noise(t, t + length + 0.3), shot.filter('bandpass', 3800 * s.bright, 6), hiss, shot.out);

    // Where the line enters the water it hisses and flutters.
    const flutter = shot.gain(0.5), cut = shot.gain(0), place = shot.pan(0.15);
    const wobble = shot.gain(0.5);
    shot.chain(shot.osc('sine', 21 + 6 * r(), t, t + length + 0.3), wobble);
    wobble.connect(flutter.gain);
    cut.gain.setValueAtTime(0, t);
    cut.gain.linearRampToValueAtTime(0.03 * s.level, t + 0.05);
    cut.gain.setTargetAtTime(0, t + length - 0.1, 0.06);
    shot.chain(shot.noise(t, t + length + 0.3), shot.filter('bandpass', 1500, 2.5), flutter, cut, place, shot.out);
  },
};

/** The line breaking: a dry crack of fibres, the last twang cut short, the loose end whipping back, the rod springing straight. */
const SNAP: PierRecipe = {
  variations: 3,
  fader: 7.5,
  build(shot, s, v) {
    const t = shot.t;
    shot.room = 0.1;
    shot.burst(shot.out, t, 'highpass', 1700, 0.7, 0.0003, 0.3 * s.level, 0.0035);
    shot.burst(shot.out, t + 0.006, 'bandpass', 3600, 0.8, 0.0003, 0.14 * s.level, 0.004);
    shot.burst(shot.out, t, 'bandpass', 1100, 2, 0.0006, 0.12 * s.level, 0.01);
    shot.pluck(shot.out, t + 0.002, 340, 0.06, 3200, 0.25 * s.level);

    const flap = shot.gain(0.55), travel = shot.pan(0.4);
    const swing = shot.gain(0.45);
    shot.chain(shot.osc('sine', 17, t + 0.03, t + 0.7), swing);
    swing.connect(flap.gain);
    travel.pan.setValueAtTime(0.4, t + 0.03);
    travel.pan.linearRampToValueAtTime(-0.3, t + 0.36);
    const band = shot.filter('bandpass', 2600, 2), amp = shot.gain(0);
    band.frequency.setValueAtTime(2600, t + 0.03);
    band.frequency.exponentialRampToValueAtTime(600, t + 0.36);
    shot.bloom(amp.gain, t + 0.03, 0.035, 0.09 * s.level, 0.09);
    shot.chain(shot.noise(t + 0.03, t + 0.7), band, flap, amp, travel, shot.out);

    contact(shot, shot.out, KNOCKS[v]!, t + 0.09, 1.25, 0.05 * s.level, 200, 2400);
  },
};

/** The fish throwing the hook: a flat slap on the surface, the gurgle of it diving, the line falling slack. */
const ESCAPE: PierRecipe = {
  variations: 3,
  fader: 10,
  build(shot, s) {
    const t = shot.t, r = shot.random, z = s.size;
    shot.room = 0.12;
    shot.burst(shot.out, t, 'bandpass', 1200 * s.bright, 0.7, 0.001, 0.2 * s.level, 0.022 * z);
    shot.burst(shot.out, t, 'lowpass', 380 / z, 0.8, 0.002, 0.14 * s.level, 0.04 * z);
    const bubbles = 2 + Math.floor(r() * 2);
    for (let i = 0; i < bubbles; i++) {
      shot.bubble(shot.out, t + 0.03 + r() * 0.18, 380 + 600 * r(), 0.012 + 0.012 * r(), 0.4, 0.025 * s.level);
    }
    shot.breath(shot.out, t + 0.08, 'bandpass', 2400, 4, 0.05, 0.02 * s.level, 0.06, 1200, 0.2);
    shot.burst(shot.out, t + 0.2, 'bandpass', 1700, 1.2, 0.002, 0.025 * s.level, 0.012);
  },
};

/** The fish breaking the surface: the rush of water up, the hole ringing as it closes, spray, and the drops falling back. */
const LEAP: PierRecipe = {
  variations: 3,
  fader: 6.3,
  build(shot, s) {
    const t = shot.t, r = shot.random, z = s.size;
    shot.room = 0.14;
    const [left, middle, right] = spread(shot, 0.45) as [AudioNode, AudioNode, AudioNode];
    shot.breath(middle, t, 'bandpass', 900, 0.7, 0.012, 0.2 * s.level, 0.07 * z, 3200 * s.bright, 0.05);
    shot.burst(middle, t, 'lowpass', 420 / z, 0.8, 0.004, 0.16 * s.level, 0.06 * z);
    shot.bubble(middle, t + 0.02, 220 / z, 0.05 * z, 1.4, 0.1 * s.level);
    shot.breath(middle, t + 0.01, 'bandpass', 6000 * s.bright, 1.2, 0.08, 0.035 * s.level, 0.18);
    shot.droplets([left, middle, right], t + 0.12, t + 0.75, Math.round(6 + 10 * z), 900, 3000, 0.055 * s.level);
    for (const side of [left, right]) shot.burst(side, t + 0.25 + 0.3 * r(), 'bandpass', 1500, 1, 0.001, 0.05 * s.level, 0.01);
  },
};

/** The fish on the planks: its weight on the boards, a wet slap, water spattering, and two little flaps. */
const FLOP: PierRecipe = {
  variations: 3,
  fader: 3,
  build(shot, s, v) {
    const t = shot.t, r = shot.random, z = s.size;
    shot.room = 0.05;
    const board = shot.sample(BOARDS[v]!, t, 0.92 / Math.sqrt(z), 0.5 * s.level);
    if (board) {
      shot.chain(board, shot.filter('highpass', 90, 0.7), shot.filter('peaking', 430, 1, 3), shot.filter('lowpass', 3600 * s.bright, 0.5), shot.out);
    }
    contact(shot, shot.out, SOFTS[v]!, t + 0.002, 1, 0.4 * s.level, 60, 2200);
    shot.burst(shot.out, t, 'bandpass', 1700 * s.bright, 0.8, 0.0005, 0.16 * s.level, 0.014);
    shot.burst(shot.out, t, 'lowpass', 320 / z, 0.8, 0.0015, 0.12 * s.level, 0.03 * z);
    // The hollow of the deck under the boards.
    const hollow = shot.filter('lowpass', 1300, 0.5);
    hollow.connect(shot.out);
    shot.partial(hollow, 'triangle', 190, t + 0.002, 0.003, 0.04 * s.level, 0.03);
    for (let i = 0; i < 4; i++) shot.burst(shot.out, t + 0.01 + r() * 0.08, 'bandpass', 3000 + 1500 * r(), 1.5, 0.0003, 0.02 * s.level, 0.002);
    for (const [at, level] of [[0.22 + 0.04 * r(), 1], [0.4 + 0.05 * r(), 0.7]] as const) {
      shot.burst(shot.out, t + at, 'bandpass', 1900 * s.bright, 0.9, 0.0005, 0.045 * s.level * level, 0.01);
      contact(shot, shot.out, SOFTS[(v + 1) % 3]!, t + at, 1.35, 0.09 * s.level * level, 120, 2600);
      shot.burst(shot.out, t + at, 'lowpass', 400, 0.8, 0.001, 0.025 * s.level * level, 0.02);
    }
  },
};

/** The paper tag sliding in over the wood, and settling. */
const TAG: PierRecipe = {
  variations: 3,
  fader: 8,
  build(shot, s, v) {
    const t = shot.t;
    shot.room = 0.03;
    contact(shot, shot.out, PAGES[v]!, t, 1.06, 0.3 * s.level, 500, 6000);
    shot.breath(shot.out, t, 'bandpass', 2400, 1.2, 0.11, 0.025 * s.level, 0.05, 4200, 0.14);
    shot.burst(shot.out, t + 0.16, 'bandpass', 2600, 1.4, 0.0005, 0.02 * s.level, 0.003);
  },
};

/** The ink stamp: a soft, padded thump through the paper, its wooden handle, and a tacky lift. */
const SEAL: PierRecipe = {
  variations: 3,
  fader: -3.7,
  build(shot, s, v) {
    const t = shot.t;
    shot.room = 0.04;
    contact(shot, shot.out, SOFTS[v]!, t, 0.85, 0.45 * s.level, 50, 1600);
    shot.burst(shot.out, t, 'lowpass', 220, 0.9, 0.002, 0.12 * s.level, 0.03);
    contact(shot, shot.out, KNOCKS[v]!, t + 0.001, 0.8, 0.06 * s.level, 120, 1800);
    shot.burst(shot.out, t, 'bandpass', 3200, 1.2, 0.0004, 0.02 * s.level, 0.004);
    shot.breath(shot.out, t + 0.14, 'bandpass', 1700, 1.5, 0.035, 0.012 * s.level, 0.02, 2700, 0.05);
  },
};

/** The rod lifted off its rack: a light knock and its ring, the sleeve against the grip, the lift. */
const TAKE: PierRecipe = {
  variations: 3,
  fader: 8,
  build(shot, s, v) {
    const t = shot.t;
    shot.room = 0.05;
    contact(shot, shot.out, KNOCKS[v]!, t, 1.05, 0.38 * s.level, 220, 5500);
    shot.partial(shot.out, 'sine', KNOCK_RING[v]!, t, 0.0015, 0.02 * s.level, 0.02);
    contact(shot, shot.out, CLOTHS[v]!, t + 0.05, 1.05, 0.14 * s.level, 300, 4000);
    const air = shot.filter('lowpass', 2800, 0.5);
    air.connect(shot.out);
    shot.breath(air, t + 0.03, 'bandpass', 480, 0.9, 0.07, 0.02 * s.level, 0.04, 1450, 0.15);
  },
};

/** The rod set down in the rack: the sleeve, a fuller knock, and a smaller one as it settles. */
const STOW: PierRecipe = {
  variations: 3,
  fader: -3.5,
  build(shot, s, v) {
    const t = shot.t;
    shot.room = 0.05;
    contact(shot, shot.out, CLOTHS[(v + 1) % 3]!, t, 0.95, 0.12 * s.level, 300, 3600);
    contact(shot, shot.out, SETS[v]!, t + 0.06, 1, 0.36 * s.level, 120, 5200);
    shot.partial(shot.out, 'sine', KNOCK_RING[v]! * 0.93, t + 0.06, 0.0015, 0.025 * s.level, 0.025);
    contact(shot, shot.out, KNOCKS[v]!, t + 0.14, 1.25, 0.1 * s.level, 300, 4800);
    const seat = shot.filter('lowpass', 900, 0.5);
    seat.connect(shot.out);
    shot.partial(seat, 'triangle', 230, t + 0.14, 0.002, 0.025 * s.level, 0.015);
  },
};

export const PIER_RECIPES: Readonly<Record<PierCue, PierRecipe>> = {
  draw: DRAW, cast: CAST, plop: PLOP, nibble: NIBBLE, bite: BITE, strike: STRIKE, run: RUN, snap: SNAP,
  escape: ESCAPE, leap: LEAP, flop: FLOP, tag: TAG, seal: SEAL, take: TAKE, stow: STOW,
};
