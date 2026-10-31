import { noteHz } from '../palette';
import type { ForgeCue } from './conductor';
import type { ForgeVoice } from './voice';

/**
 * The Forge's instruments, all original synthesis. One physical story: brass and breath while the words gather,
 * hot grit and thick bubbles in the pour, wax and parchment at the seal, a single weighty strike on a steel anvil
 * with room after it, cooling ticks, air past the part, and a timber arrival on the roof. Tuned layers sit in the
 * kingdom's D major pentatonic palette (`../palette.ts`); struck metal keeps its own inharmonic ratios on top.
 *
 * Levels are linear gains into the layer's bus, before the room, the glue compressor and the mix.
 */
export type CueBuilder = (voice: ForgeVoice, variation: number) => void;

const GLINT = ['A5', 'D6', 'B5', 'E6'] as const;

/** A rune surfacing: a small brass bar, its fundamental and the bar's first overtone (×2.76), struck by a breath. */
function glint(v: ForgeVoice, i: number) {
  const t = v.t, f = noteHz(GLINT[i % GLINT.length]!), body = v.filter('lowpass', 7000, .5);
  v.chain(body, v.out);
  v.pan = [-.32, .26, -.12, .36][i % 4]!; v.room = .42;
  v.mode(body, f, t, .004, .016, .34);
  v.mode(body, f * 2.76, t, .002, .005, .09);
}

/** The runes gather onto the drawing: an inhale through the bellows and a soft brass chord swelling with it. */
function gather(v: ForgeVoice) {
  const t = v.t, body = v.filter('lowpass', 3600, .5);
  v.chain(body, v.out); v.room = .38;
  for (const [note, peak] of [['D4', .014], ['A4', .011], ['D5', .008]] as const) {
    const amp = v.gain(0), f = noteHz(note);
    v.bloom(amp.gain, t, .55, peak, .55);
    v.chain(v.osc('triangle', f, t, t + .55 + .55 * 7), amp, body);
  }
  const air = v.filter('bandpass', 700, 1.1), amp = v.gain(0);
  v.glide(air.frequency, t, 700, 2300, .55);
  v.bloom(amp.gain, t, .5, .022, .16);
  v.chain(v.noise(t, t + .5 + .16 * 7), air, amp, v.out);
}

/** The blueprint locks: a brass latch, then a cool glassy fifth that beats slowly as it settles. */
function lock(v: ForgeVoice) {
  const t = v.t, latch = t + .1, body = v.filter('lowpass', 9000, .5);
  v.chain(body, v.out); v.room = .45;
  const click = v.filter('bandpass', 3600, 2.2), amp = v.gain(0);
  v.envelope(amp.gain, latch, .0006, .05, .004);
  v.chain(v.noise(latch, latch + .05), click, amp, body);
  for (const [note, detune, peak] of [['D5', -1.4, .011], ['D5', 1.2, .009], ['A5', -.9, .007], ['A5', 1.6, .005]] as const) {
    v.mode(body, noteHz(note) + detune, latch, .018, peak, .55);
  }
}

/** The iron crucible on its bracket: a short inharmonic clank, set down a little lower and softer. */
function clank(v: ForgeVoice, i: number) {
  const t = v.t, f = i ? 196 : 233, body = v.filter('lowpass', 4200, .6), level = i ? .7 : 1;
  v.chain(body, v.out); v.room = .3; v.pan = i ? .08 : -.08;
  const hit = v.filter('bandpass', 1500, .9), amp = v.gain(0);
  v.envelope(amp.gain, t, .0008, .05 * level, .008);
  v.chain(v.noise(t, t + .07), hit, amp, body);
  [[1, .03, .16], [2.32, .02, .1], [3.91, .012, .07]].forEach(([ratio, peak, tau]) => v.mode(body, f * ratio!, t, .001, peak! * level, tau!));
}

/** A thick molten bubble breaking: a low sine pulled upward as the cavity closes. */
function bubble(v: ForgeVoice, i: number) {
  const t = v.t, f = 150 + ((i * 53) % 170), amp = v.gain(0), osc = v.osc('sine', f, t, t + .16);
  v.pan = ((i * 37) % 11 - 5) / 16; v.room = .18;
  v.glide(osc.frequency, t, f, f * (1.5 + (i % 3) * .12), .05);
  v.envelope(amp.gain, t, .002, .024 + (i % 4) * .004, .028);
  v.chain(osc, amp, v.out);
}

/** A bead of warm wax: a soft plip with a breath of contact. */
function drip(v: ForgeVoice) {
  const t = v.t, amp = v.gain(0), osc = v.osc('sine', 880, t, t + .2);
  v.room = .3;
  v.glide(osc.frequency, t, 880, 470, .035);
  v.envelope(amp.gain, t, .002, .012, .04);
  v.chain(osc, amp, v.out);
  const soft = v.filter('lowpass', 1100, .7), puff = v.gain(0);
  v.envelope(puff.gain, t, .002, .012, .02);
  v.chain(v.noise(t, t + .12), soft, puff, v.out);
}

/** The seal pressed into hot wax: a thick thup, the wooden handle's knock and a small ring of the brass die. */
function stamp(v: ForgeVoice) {
  const t = v.t;
  v.room = .26;
  const thick = v.filter('lowpass', 680, .8), amp = v.gain(0), noise = v.noise(t, t + .35);
  v.envelope(amp.gain, t, .003, .075, .05);
  v.chain(noise, thick, amp, v.out);
  const body = v.osc('sine', 150, t, t + .5), weight = v.gain(0);
  v.glide(body.frequency, t, 150, 88, .07);
  v.envelope(weight.gain, t, .002, .06, .08);
  v.chain(body, weight, v.out);
  const knock = v.filter('lowpass', 3000, .5);
  v.chain(knock, v.out);
  v.mode(knock, 523, t + .004, .001, .02, .028);
  v.mode(knock, 1187, t + .004, .001, .01, .018);
  v.mode(v.out, noteHz('B5'), t + .006, .002, .0045, .3);
}

/** The ribbon unrolls: one dry slide of parchment with a little crinkle. */
function ribbon(v: ForgeVoice) {
  const t = v.t, noise = v.noise(t, t + 1.1);
  v.room = .3; v.pan = .14;
  const slide = v.filter('bandpass', 2300, .9), amp = v.gain(0);
  v.bloom(amp.gain, t, .14, .011, .16);
  v.chain(noise, slide, amp, v.out);
  const crinkle = v.filter('highpass', 3800, .7), grit = v.gain(0);
  v.chain(noise, crinkle, grit, v.out);
  v.spikes(grit.gain, [.03, .07, .1, .16, .2, .27, .35].map(d => t + d), [.012, .007, .01, .006, .008, .005, .004], .006);
}

/** The hammer rises into its wind-up: air past the head and the strain of its handle. */
function lift(v: ForgeVoice) {
  const t = v.t, noise = v.noise(t, t + 1.4);
  v.room = .3; v.pan = -.18;
  const air = v.filter('bandpass', 380, 1.2), amp = v.gain(0);
  v.glide(air.frequency, t, 380, 820, .36);
  v.bloom(amp.gain, t, .36, .016, .18);
  v.chain(noise, air, amp, v.out);
  const creak = v.filter('bandpass', 1050, 5), strain = v.gain(0);
  v.chain(noise, creak, strain, v.out);
  const times = [.16, .19, .215, .235, .26, .275, .295, .31, .33].map(d => t + d);
  v.spikes(strain.gain, times, [.05, .04, .06, .045, .055, .04, .05, .035, .03], .004);
}

/** The downswing: air rising in pitch and level into the instant of contact, then cut by it. */
function swing(v: ForgeVoice) {
  const t = v.t, impact = t + .15, air = v.filter('bandpass', 360, 1.4), amp = v.gain(0);
  v.room = .15; v.pan = -.1;
  v.glide(air.frequency, t, 360, 1700, .15);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(.004, t + .05);
  amp.gain.exponentialRampToValueAtTime(.03, impact);
  amp.gain.setTargetAtTime(0, impact, .012);
  v.chain(v.noise(t, impact + .12), air, amp, v.out);
}

/**
 * The strike. A hammer on hot iron over a steel anvil: the bright contact, the dull squash of the hot part, a body
 * thump that drops in pitch, the anvil's long inharmonic ring (a slow beat on its fundamental), and sparks
 * crackling away. Then the room, and space.
 */
function strike(v: ForgeVoice) {
  const t = v.t, noise = v.noise(t, t + .9);
  v.room = .3;
  const contact = v.filter('highpass', 2600, .7), click = v.gain(0);
  v.envelope(click.gain, t, .0006, .3, .006);
  v.chain(noise, contact, click, v.out);
  const hot = v.filter('lowpass', 900, .8), squash = v.gain(0);
  v.envelope(squash.gain, t, .001, .2, .032);
  v.chain(noise, hot, squash, v.out);
  const thump = v.osc('sine', 124, t, t + .9), weight = v.gain(0);
  v.glide(thump.frequency, t, 124, 57, .09);
  v.envelope(weight.gain, t, .0018, .3, .13);
  v.chain(thump, weight, v.out);
  const ring = v.filter('lowpass', 6500, .5);
  v.chain(ring, v.out);
  const f = noteHz('A5');
  for (const [ratio, peak, tau] of [[1, .028, 1.05], [1.0028, .022, 1.15], [1.51, .03, .72], [2.42, .022, .48], [3.18, .013, .3], [4.27, .008, .18]] as const) {
    v.mode(ring, f * ratio, t + .0015, .0012, peak, tau);
  }
  const sparks = v.filter('bandpass', 5200, .8), crackle = v.gain(0);
  v.chain(noise, sparks, crackle, v.out);
  const times = [.05, .08, .1, .14, .17, .19, .24, .29, .33, .4, .46, .55, .63, .74];
  v.spikes(crackle.gain, times.map(d => t + d), times.map((d, i) => (.06 - d * .06) * (i % 3 === 1 ? .55 : 1)), .0035);
}

/** The struck part meets cooler air: a quench hiss that falls away, with a faint fizz of boiling scale. */
function quench(v: ForgeVoice) {
  const t = v.t, noise = v.noise(t, t + 2.2);
  v.room = .25;
  const hiss = v.filter('bandpass', 5600, .6), amp = v.gain(0);
  v.envelope(amp.gain, t, .03, .04, .38);
  v.chain(noise, hiss, amp, v.out);
  const fizz = v.filter('highpass', 2400, .7), grit = v.gain(0);
  v.chain(noise, fizz, grit, v.out);
  const times = Array.from({ length: 16 }, (_, i) => .04 + i * .045 + ((i * 7) % 5) * .006);
  v.spikes(grit.gain, times.map(d => t + d), times.map(d => .02 * Math.exp(-d * 2.2)), .003);
}

/** The cooling skin contracts: one small high tink. */
function tick(v: ForgeVoice, i: number) {
  const t = v.t, f = 2400 + ((i * 397) % 1800);
  v.pan = ((i * 29) % 13 - 6) / 14; v.room = .35;
  v.mode(v.out, f, t, .0008, .009 + (i % 3) * .002, .045, 'triangle');
}

/** The part springs off the anvil: a soft release thump and air drawn up after it. */
function launch(v: ForgeVoice) {
  const t = v.t;
  v.room = .2;
  const thump = v.osc('sine', 98, t, t + .6), weight = v.gain(0);
  v.glide(thump.frequency, t, 98, 70, .06);
  v.envelope(weight.gain, t, .002, .05, .07);
  v.chain(thump, weight, v.out);
  const air = v.filter('bandpass', 300, 1.2), amp = v.gain(0);
  v.glide(air.frequency, t, 300, 1200, .3);
  v.bloom(amp.gain, t, .26, .022, .12);
  v.chain(v.noise(t, t + 1.1), air, amp, v.out);
}

/**
 * Home: the part meets its timber socket. A low body thump, a roof-board thock (the board's few modes), a dry contact,
 * a short chatter of the roof tiles round it, the dust settling and the faint warm click of a fitting seated.
 */
function land(v: ForgeVoice) {
  const t = v.t, noise = v.noise(t, t + 1.3);
  v.room = .22;
  const thump = v.osc('sine', 112, t, t + 1), weight = v.gain(0);
  v.glide(thump.frequency, t, 112, 52, .085);
  v.envelope(weight.gain, t, .0015, .3, .12);
  v.chain(thump, weight, v.out);
  const board = v.filter('lowpass', 2600, .6);
  v.chain(board, v.out);
  for (const [f, peak, tau] of [[196, .15, .12], [452, .085, .07], [788, .045, .045], [1210, .025, .03]] as const) {
    v.mode(board, f, t, .0012, peak, tau);
  }
  const contact = v.filter('bandpass', 1800, .8), knock = v.gain(0);
  v.envelope(knock.gain, t, .0008, .13, .011);
  v.chain(noise, contact, knock, v.out);
  const tiles = v.filter('highpass', 3000, .8), chatter = v.gain(0);
  v.chain(noise, tiles, chatter, v.out);
  v.spikes(chatter.gain, [.028, .061, .09].map(d => t + d), [.05, .03, .016], .006);
  const settle = v.filter('lowpass', 1200, .7), dust = v.gain(0);
  v.bloom(dust.gain, t + .03, .08, .018, .22);
  v.chain(noise, settle, dust, v.out);
  v.mode(v.out, noteHz('D6'), t + .012, .002, .006, .22);
}

/** Settled: the timber under it takes the weight with one small creak. */
function creak(v: ForgeVoice) {
  const t = v.t, wood = v.filter('bandpass', 880, 4.5), strain = v.gain(0);
  v.room = .3; v.pan = .1;
  v.chain(v.noise(t, t + .5), wood, strain, v.out);
  const times = [0, .03, .055, .075, .095, .112, .128, .142, .156, .17].map(d => t + d);
  v.spikes(strain.gain, times, [.03, .036, .04, .042, .04, .036, .03, .024, .018, .012], .005);
}

export const FORGE_CUES: Readonly<Record<ForgeCue, CueBuilder>> = {
  glint, gather, lock, clank, bubble, drip, stamp, ribbon, lift, swing, strike, quench, tick, launch, land, creak,
};

/**
 * The forge coughs and sulks: a sooty bellows cough (or two), a cold iron tunk with no ring at all, and a low
 * falling groan of air through the coals. Three takes. Never a buzzer and never a voice.
 */
export function refusalCue(v: ForgeVoice, variant: 0 | 1 | 2) {
  const t = v.t, noise = v.noise(t, t + 1.6), pitch = [1, .94, 1.07][variant] ?? 1;
  // +8 dB on the voice fader: tuned against a −16 LUFS stream voice, the cough at its authored level sat 25 dB under
  // speech and went unnoticed; here it peaks near the seal's level, still well under the strike.
  v.out.gain.value = 2.5;
  v.room = .22;
  const coughs: readonly (readonly [number, number])[] = [[0, .07], [.17, .045]].slice(0, variant === 1 ? 1 : 2) as [number, number][];
  const throat = v.filter('bandpass', 720 * pitch, 1.2), rasp = v.gain(0);
  const soot = v.filter('lowpass', 260, .9), puff = v.gain(0);
  v.chain(noise, throat, rasp, v.out);
  v.chain(noise, soot, puff, v.out);
  rasp.gain.setValueAtTime(0, t); puff.gain.setValueAtTime(0, t);
  for (const [at, peak] of coughs) {
    rasp.gain.setValueAtTime(0, t + at); rasp.gain.linearRampToValueAtTime(peak, t + at + .012); rasp.gain.setTargetAtTime(0, t + at + .012, .07);
    puff.gain.setValueAtTime(0, t + at); puff.gain.linearRampToValueAtTime(peak * .9, t + at + .01); puff.gain.setTargetAtTime(0, t + at + .01, .09);
  }
  const iron = v.filter('lowpass', 900, .6);
  v.chain(iron, v.out);
  v.mode(iron, 131 * pitch, t + .05, .0015, .045, .09);
  v.mode(iron, 309 * pitch, t + .05, .0015, .02, .05);
  const sigh = t + (variant === 1 ? .2 : .34), groan = v.osc('sawtooth', 147 * pitch, sigh, sigh + .1 + .3 * 7);
  const dark = v.filter('lowpass', 520, 1.6), amp = v.gain(0);
  v.glide(groan.frequency, sigh, 147 * pitch, 108 * pitch, .55);
  v.bloom(amp.gain, sigh, .1, .012, .3);
  v.chain(groan, dark, amp, v.out);
  const wheeze = v.filter('bandpass', 1400, 1.4), air = v.gain(0);
  v.glide(wheeze.frequency, sigh, 1400 * pitch, 480 * pitch, .5);
  v.bloom(air.gain, sigh, .09, .016, .17);
  v.chain(noise, wheeze, air, v.out);
}
