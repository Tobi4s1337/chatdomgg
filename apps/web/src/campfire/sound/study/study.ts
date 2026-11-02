import type { CampfireFrame, DuskCourtPlayerView, DuskCourtView, Vec3 } from '@chatdom/shared';
import { Mix, RAMP_SECONDS } from '../../../../../../packages/audio/src/mix';
import {
  campfireDarkness, campfireReach, createCampfireSound, createCampfireSoundGraph, CAMPFIRE_CUES, CAMPFIRE_SOUND_LIMITS,
  type CampfireCue, type CampfireListener, type CampfireSoundInspection,
} from '../index';
import { campfireMaterial } from '../materials';

/*
 * The campfire's offline listening study. One deterministic render of what a person at the fire hears, through the
 * shipped layer (`createCampfireSound`: observer, graph, host permission) into the kingdom's master input
 * (`Mixer.hostDestination` is `mix.master`), then a second render of every cue alone. This page is served only by
 * the local study runner. All times are render time; every frame is SIMULATED.
 */
const RATE = 32000, DURATION = 24.5, TICK_MS = 50;
const SETTINGS = { muted: false, volume: .65 } as const;
const PLACE = { fire: [0, 0, 0] as const };
const SEAT: CampfireListener = { feet: [0, 0, 2.5], forward: [0, 0, -1] };
/** 28 m from the fire, three metres beyond its reach. */
const START: Vec3 = [-10, 0, 26.15];
const NIGHT = 22, DAY = 13;
const EPOCH = 1_780_000_000_000;
const T = {
  walkFrom: 1000, walkTo: 4500,
  call: 7500, deal: 8300, night: 9200, dawn: 13300, ember: 13800, talk: 14300, ballot: 14600, vote: 15100, verdict: 15500, ended: 16300,
  dayFrom: 18800, dayTo: 19800, mute: 21500, nextCall: 22000, resume: 22500, tap: 23500,
} as const;

const SEGMENTS = [
  { id: 'far', label: 'Night, 28 m from the fire (reach ends at 25 m)', from: 200, to: 1000, silent: true },
  { id: 'walk', label: 'Night, walking in from 28 m to a log at 2.5 m', from: 1000, to: 4500, silent: false },
  { id: 'seated-night', label: 'Seated at 2.5 m, 22:00: fire bed and night bed', from: 5000, to: 7500, silent: false },
  { id: 'round', label: 'A Dusk Court round at night: public cues and the local click over the beds', from: 7500, to: 18800, silent: false },
  { id: 'dawn-sweep', label: 'Time-lapse from 22:00 through dawn to 13:00', from: 18800, to: 19800, silent: false },
  { id: 'seated-day', label: 'Seated at 2.5 m, 13:00: fire bed alone', from: 20000, to: 21500, silent: false },
  { id: 'muted', label: 'Muted: host withheld, layer quiet, mix front renewed', from: 21600, to: 22500, silent: true },
  { id: 'resumed', label: 'Unmuted: a fresh graph on the same master, fire bed back', from: 22600, to: 23500, silent: false },
  { id: 'resumed-tap', label: 'The local confirm() click after the resume', from: 23500, to: 24500, silent: false },
] as const;

type Players = readonly DuskCourtPlayerView[];
function player(seat: number, patch: Partial<DuskCourtPlayerView> = {}): DuskCourtPlayerView {
  return { seat, name: `Player${seat}`, lantern: 'lit', role: null, away: false, gone: false, embers: 0, voted: false, ...patch };
}
function court(match: string, revision: number, patch: Partial<DuskCourtView>): DuskCourtView {
  return { match, revision, phase: 'call', night: 1, startedAt: EPOCH + T.call, deadline: EPOCH + T.call + 10_000, waiting: false, wolves: 1,
    players: [1, 2, 3, 4, 5].map(seat => player(seat)), dawn: null, verdict: null, result: null, ...patch };
}
function frame(ms: number, view: DuskCourtView | null): CampfireFrame {
  return { at: EPOCH + ms, site: 'study', live: true, magistrate: null,
    seated: [1, 2, 3, 4, 5].map(seat => ({ seat, name: `Player${seat}` })), court: view };
}
const withEmbers = (players: Players, embers: Record<number, 0 | 1 | 2 | 3>): Players => players.map(p => ({ ...p, embers: embers[p.seat] ?? p.embers }));

/** The public frames a seated player witnesses, with the cue each should sound. */
function publications() {
  const lit = [1, 2, 3, 4, 5].map(seat => player(seat));
  const snuffed = lit.map(p => p.seat === 2 ? player(2, { lantern: 'snuffed', role: 'townsfolk' }) : p);
  const dawn = { night: 1, seat: 2 }, verdict = { night: 1, seat: 4, tie: false, votes: 4 };
  const talk = withEmbers(snuffed, { 3: 3, 5: 1 });
  const sent = talk.map(p => p.seat === 4 ? { ...p, lantern: 'sent' as const, role: 'wolf' as const } : p);
  const revealed = sent.map(p => ({ ...p, role: p.role ?? ('townsfolk' as const) }));
  let revision = 0;
  const step = (ms: number, label: string, patch: Partial<DuskCourtView>, expect: CampfireCue[]) =>
    ({ ms, label, frame: frame(ms, court('study-round', revision++, { startedAt: EPOCH + ms, ...patch })), expect });
  return [
    { ms: 0, label: 'the fire is free, five people on the logs', frame: frame(0, null), expect: [] as CampfireCue[] },
    step(T.call, 'a round is asked for', { phase: 'call' }, ['ask']),
    step(T.deal, 'cards dealt', { phase: 'deal' }, ['deal']),
    step(T.night, 'night falls on the circle', { phase: 'night' }, ['night']),
    step(T.dawn, 'dawn: seat 2 was snuffed', { phase: 'dawn', players: snuffed, dawn }, ['snuff']),
    step(T.ember, 'the Gallery warms to seat 3', { phase: 'dawn', players: withEmbers(snuffed, { 3: 2 }), dawn }, ['ember']),
    step(T.talk, 'talk; embers rise on seats 3 and 5', { phase: 'talk', players: talk, dawn }, ['ember']),
    step(T.ballot, 'the ballot opens', { phase: 'ballot', players: talk, dawn }, ['ballot']),
    step(T.vote, 'seat 1 has voted (the local player; confirm() follows)', { phase: 'ballot', players: talk.map(p => p.seat === 1 ? { ...p, voted: true } : p), dawn }, []),
    step(T.verdict, 'verdict: seat 4 is sent away', { phase: 'verdict', players: sent, dawn, verdict }, ['sent']),
    step(T.ended, 'the circle wins', { phase: 'ended', players: revealed, dawn, verdict, result: { winner: 'town', reason: 'caught' } }, ['town']),
    // Published while muted: on resume it is a baseline, never news.
    { ms: T.nextCall, label: 'while muted, a second round is asked for', frame: frame(T.nextCall, court('study-round-2', 0, { phase: 'call' })), expect: [] as CampfireCue[] },
  ];
}

function listenerAt(ms: number): CampfireListener {
  if (ms >= T.walkTo) return SEAT;
  const k = Math.max(0, Math.min(1, (ms - T.walkFrom) / (T.walkTo - T.walkFrom)));
  const feet: Vec3 = [START[0] + (SEAT.feet[0] - START[0]) * k, 0, START[2] + (SEAT.feet[2] - START[2]) * k];
  const dx = SEAT.feet[0] - START[0], dz = SEAT.feet[2] - START[2], length = Math.hypot(dx, dz);
  return { feet, forward: [dx / length, 0, dz / length] };
}
function hourAt(ms: number): number {
  if (ms < T.dayFrom) return NIGHT;
  if (ms >= T.dayTo) return DAY;
  return (NIGHT + (24 + DAY - NIGHT) * (ms - T.dayFrom) / (T.dayTo - T.dayFrom)) % 24;
}
const distanceOf = (listener: CampfireListener) => Math.hypot(PLACE.fire[0] - listener.feet[0], PLACE.fire[2] - listener.feet[2]);

function lcg(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
}
const frameOf = (ms: number) => Math.floor(ms * RATE / 1000 / 128 + 1e-9) * 128;

interface Action { ms: number; order: number; name: string; run: () => void }
/**
 * OfflineAudioContext quantizes suspensions to 128-frame render blocks and rejects duplicates: one suspension per
 * block, its actions in order. A tiny offset keeps an exact boundary out of the previous block.
 */
async function schedule(context: OfflineAudioContext, actions: Action[], after: (frame: number, group: Action[]) => void) {
  const blocks = new Map<number, Action[]>();
  for (const action of actions.sort((a, b) => a.ms - b.ms || a.order - b.order)) {
    const at = frameOf(action.ms), group = blocks.get(at) ?? [];
    group.push(action); blocks.set(at, group);
  }
  const groups = [...blocks.entries()].sort(([a], [b]) => a - b);
  const suspensions = groups.map(([at]) => context.suspend(at / context.sampleRate + 1e-8));
  const rendering = context.startRendering();
  for (let i = 0; i < groups.length; i++) {
    await suspensions[i];
    const [at, group] = groups[i]!;
    for (const action of group) action.run();
    after(at, group);
    await context.resume();
  }
  return rendering;
}

/* ---- measurement ---- */

const db = (value: number) => value > 0 ? Math.round(20 * Math.log10(value) * 10) / 10 : null;
const powerDb = (value: number) => value > 0 ? Math.round(10 * Math.log10(value) * 10) / 10 : null;
const FFT = 2048;
const BANDS = [['low', 20, 250], ['mid', 250, 2000], ['high', 2000, 6000], ['top', 6000, Infinity]] as const;

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = -2 * Math.PI / size;
    for (let start = 0; start < n; start += size) for (let k = 0; k < size / 2; k++) {
      const cos = Math.cos(step * k), sin = Math.sin(step * k), a = start + k, b = a + size / 2;
      const tr = re[b]! * cos - im[b]! * sin, ti = re[b]! * sin + im[b]! * cos;
      re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
    }
  }
}

/** Mean-square power per band (Hann frames, no overlap; Parseval-scaled so the bands sum to the signal's power). */
function spectrum(mono: Float32Array, rate: number) {
  const power = new Float64Array(FFT / 2);
  let frames = 0;
  for (let start = 0; start < mono.length; start += FFT) {
    const n = Math.min(FFT, mono.length - start);
    if (n < 256 && frames > 0) break;
    const re = new Float64Array(FFT), im = new Float64Array(FFT);
    let weights = 0;
    for (let i = 0; i < n; i++) { const w = .5 - .5 * Math.cos(2 * Math.PI * i / Math.max(1, n - 1)); weights += w * w; re[i] = mono[start + i]! * w; }
    fft(re, im);
    if (weights > 0) for (let k = 1; k < FFT / 2; k++) power[k]! += 2 * (re[k]! ** 2 + im[k]! ** 2) / (FFT * weights);
    frames++;
  }
  const bands: Record<string, number | null> = {};
  let total = 0, weighted = 0;
  for (let k = 1; k < FFT / 2; k++) { const hz = k * rate / FFT; if (hz >= 20) { total += power[k]!; weighted += power[k]! * hz; } }
  for (const [name, lo, hi] of BANDS) {
    let sum = 0;
    for (let k = 1; k < FFT / 2; k++) { const hz = k * rate / FFT; if (hz >= lo && hz < hi) sum += power[k]!; }
    bands[name] = powerDb(frames ? sum / frames : 0);
  }
  return { centroidHz: total > 0 ? Math.round(weighted / total) : null, bandsDbfs: bands };
}

function measure(channels: Float32Array[], rate: number, fromMs: number, toMs: number) {
  const a = Math.max(0, Math.round(fromMs * rate / 1000)), b = Math.min(channels[0]!.length, Math.round(toMs * rate / 1000));
  const per = channels.map(data => {
    let peak = 0, squares = 0, clipped = 0, nearFull = 0, zero = 0;
    for (let i = a; i < b; i++) {
      const x = data[i]!, size = Math.abs(x);
      if (!Number.isFinite(x)) throw new Error('Non-finite audio sample');
      peak = Math.max(peak, size); squares += x * x;
      if (size >= 1) clipped++;
      if (size >= .99) nearFull++;
      if (x === 0) zero++;
    }
    return { peak, rms: Math.sqrt(squares / Math.max(1, b - a)), clipped, nearFull, zero };
  });
  const mono = new Float32Array(b - a);
  for (let i = a; i < b; i++) { let sum = 0; for (const data of channels) sum += data[i]!; mono[i - a] = sum / channels.length; }
  return {
    fromS: fromMs / 1000, toS: toMs / 1000,
    rmsDbfs: per.map(c => db(c.rms)), peakDbfs: per.map(c => db(c.peak)),
    peak: Math.max(...per.map(c => c.peak)), rms: Math.sqrt(per.reduce((sum, c) => sum + c.rms ** 2, 0) / per.length),
    clipped: per.reduce((sum, c) => sum + c.clipped, 0), nearFull: per.reduce((sum, c) => sum + c.nearFull, 0),
    digitalSilence: per.every(c => c.zero === b - a),
    ...spectrum(mono, rate),
  };
}

/**
 * How abruptly the output changes after one render block's actions. Changes made in a suspension take effect from
 * the next 128-frame quantum, so the search covers two quanta. The largest sample step there is compared with the
 * steps in the 50 ms before; `silentAfterMs` is when the output became digital silence for good (within 50 ms).
 */
function cutProbe(channels: Float32Array[], frame: number, rate: number) {
  const steps: number[] = [];
  let jump = 0, jumpAt = frame, last = -1;
  for (const data of channels) {
    for (let i = frame; i <= frame + 256; i++) {
      const step = Math.abs(data[i]! - data[i - 1]!);
      if (step > jump) { jump = step; jumpAt = i; }
    }
    for (let i = frame - Math.round(rate * .05); i < frame; i++) steps.push(Math.abs(data[i]! - data[i - 1]!));
    for (let i = frame; i < frame + Math.round(rate * .05); i++) if (data[i] !== 0) last = Math.max(last, i);
  }
  steps.sort((x, y) => x - y);
  const quantile = (q: number) => steps[Math.min(steps.length - 1, Math.floor(q * steps.length))]!;
  const rms = (from: number, to: number) => {
    let sum = 0, n = 0;
    for (const data of channels) for (let i = from; i < to; i++) { sum += data[i]! ** 2; n++; }
    return db(Math.sqrt(sum / Math.max(1, n)));
  };
  const ramp = Math.round(rate * RAMP_SECONDS), ms = (samples: number) => Math.round(samples / rate * 10000) / 10;
  const p99 = quantile(.99);
  return {
    atS: frame / rate, largestStep: jump, largestStepDbfs: db(jump), largestStepAfterMs: ms(jumpAt - frame),
    stepsBefore50ms: { median: quantile(.5), p99, max: steps.at(-1) ?? 0 }, largestStepOverP99: Math.round(jump / p99 * 10) / 10,
    silentAfterMs: last < frame + Math.round(rate * .05) - 1 ? ms(last + 1 - frame) : null,
    rms30msBeforeDbfs: rms(frame - ramp, frame), rms30msAfterDbfs: rms(frame, frame + ramp),
  };
}

function wavOf(buffer: AudioBuffer) {
  const samples = buffer.length, channels = buffer.numberOfChannels, view = new DataView(new ArrayBuffer(44 + samples * channels * 2));
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, view.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let hash = 0x811c9dc5;
  for (let i = 0; i < samples; i++) for (let c = 0; c < channels; c++) {
    const value = Math.round(Math.max(-1, Math.min(1, data[c]![i]!)) * 32767);
    view.setInt16(44 + (i * channels + c) * 2, value, true);
    hash = Math.imul(hash ^ (value & 0xffff), 0x01000193) >>> 0;
  }
  const bytes = new Uint8Array(view.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { base64: btoa(binary), bytes: bytes.length, pcmFnv1a: hash.toString(16).padStart(8, '0') };
}

type Played = Partial<Record<CampfireCue, number>>;
const countOf = (played: Played) => Object.values(played).reduce((sum, n) => sum + (n ?? 0), 0);
interface Tick { ms: number; frame: number; distance: number; hour: number; reach: number; darkness: number; inspection: CampfireSoundInspection }

/* ---- the walk-through ---- */

async function renderStudy() {
  const context = new OfflineAudioContext(2, RATE * DURATION, RATE);
  // Between render quanta an OfflineAudioContext reports 'suspended' while this script runs, and the live layer
  // plays only on a running context. The study presents it as running, which is what a live kingdom context reports.
  Object.defineProperty(context, 'state', { configurable: true, get: () => 'running' });
  const mix = new Mix(context, SETTINGS, lcg(0x12345678));
  let available = true;
  // As in walk.ts: the host is withheld while muted; the kingdom's hosted layers connect to the master input.
  const sound = createCampfireSound(() => available ? { context, destination: mix.master } : null, PLACE);
  const frames = publications();
  let current: CampfireFrame | null = null;
  const actions: Action[] = [];
  for (const published of frames) actions.push({ ms: published.ms, order: 0, name: `publish: ${published.label}`, run: () => { current = published.frame; } });
  actions.push({ ms: T.mute, order: 1, name: 'mute: master ramps to 0, mix front renewed, host withheld', run: () => {
    mix.rampMaster({ ...SETTINGS, muted: true }); mix.renew(RAMP_SECONDS); available = false;
  } });
  actions.push({ ms: T.resume, order: 1, name: 'unmute: master ramps back, host offered again', run: () => {
    mix.rampMaster(SETTINGS); available = true;
  } });
  const ticks: Tick[] = [];
  for (let ms = 0; ms < DURATION * 1000 - TICK_MS / 2; ms += TICK_MS) {
    const at = ms;
    actions.push({ ms: at, order: 2, name: 'update', run: () => {
      const listener = listenerAt(at), hour = hourAt(at);
      sound.update(current, { now: 5000 + at, hour, listener });
    } });
  }
  actions.push({ ms: T.vote, order: 3, name: 'confirm(): the local vote was accepted', run: () => sound.confirm() });
  actions.push({ ms: T.tap, order: 3, name: 'confirm() after the resume', run: () => sound.confirm() });

  const events: { atS: number; actions: string[]; sounded: Played; inspection: CampfireSoundInspection }[] = [];
  const onsets: { cue: CampfireCue; ms: number }[] = [];
  let last: Played = {};
  const buffer = await schedule(context, actions, (frame, group) => {
    const ms = group[0]!.ms, listener = listenerAt(ms), hour = hourAt(ms), inspection = sound.inspect();
    const sounded: Played = {};
    for (const cue of CAMPFIRE_CUES) {
      const delta = (inspection.played[cue] ?? 0) - (last[cue] ?? 0);
      if (delta > 0) { sounded[cue] = delta; for (let i = 0; i < delta; i++) onsets.push({ cue, ms }); }
    }
    last = { ...inspection.played };
    const distance = distanceOf(listener);
    ticks.push({ ms, frame, distance, hour, reach: campfireReach(distance), darkness: campfireDarkness(hour), inspection });
    const named = group.filter(action => action.name !== 'update').map(action => action.name);
    if (named.length || countOf(sounded)) events.push({ atS: context.currentTime, actions: named, sounded, inspection });
  });
  sound.dispose();
  return { buffer, ticks, events, onsets, frames, final: sound.inspect() };
}

/** Every cue alone at the seat, four seconds apart, on a fresh context and graph: its own level, colour and end. */
async function renderSolo() {
  const spacing = 4500, lead = 500, length = CAMPFIRE_CUES.length * spacing / 1000 + 1;
  const context = new OfflineAudioContext(2, RATE * length, RATE);
  const mix = new Mix(context, SETTINGS, lcg(0x9e3779b9));
  const graph = createCampfireSoundGraph({ context, destination: mix.master }, PLACE, true);
  const actions = CAMPFIRE_CUES.map((cue, i) => ({ ms: lead + i * spacing, order: 0, name: cue, run: () => graph.play(cue, SEAT) }));
  const buffer = await schedule(context, actions, () => {});
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const cues = CAMPFIRE_CUES.map((cue, i) => {
    const onset = lead + i * spacing, duration = campfireMaterial(context, cue, 0).duration * 1000;
    const body = measure(channels, RATE, onset, onset + duration + 10);
    const after = measure(channels, RATE, onset + duration + 50, onset + spacing - 10);
    return { cue, durationS: Math.round(duration) / 1000, peakDbfs: db(body.peak), rmsDbfs: db(body.rms), centroidHz: body.centroidHz,
      bandsDbfs: body.bandsDbfs, clipped: body.clipped, silentAfterEnd: after.digitalSilence };
  });
  const beds = (['flame', 'crackle', 'air'] as const).map(bed => {
    const data = campfireMaterial(context, bed, 0).getChannelData(0);
    let peak = 0, squares = 0;
    for (const x of data) { peak = Math.max(peak, Math.abs(x)); squares += x * x; }
    const rms = Math.sqrt(squares / data.length);
    return { bed, loopS: Math.round(data.length / RATE * 1000) / 1000, peakDbfs: db(peak), rmsDbfs: db(rms), crestDb: db(peak / rms), ...spectrum(data, RATE) };
  });
  return { cues, beds, inspection: graph.inspect() };
}

async function render() {
  const study = await renderStudy();
  const solo = await renderSolo();
  const channels = [study.buffer.getChannelData(0), study.buffer.getChannelData(1)];
  const { ticks } = study;
  const within = (from: number, to: number) => ticks.filter(tick => tick.ms >= from && tick.ms < to);
  const range = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) });

  const segments = SEGMENTS.map(segment => {
    const span = within(segment.from, segment.to), first = within(0, segment.from).at(-1)?.inspection ?? span[0]!.inspection, end = span.at(-1)!.inspection;
    const played: Played = {};
    for (const cue of CAMPFIRE_CUES) { const n = (end.played[cue] ?? 0) - (first.played[cue] ?? 0); if (n > 0) played[cue] = n; }
    return { id: segment.id, label: segment.label, expectSilence: segment.silent, audio: measure(channels, RATE, segment.from, segment.to),
      inspection: {
        sources: range(span.map(t => t.inspection.sources)), voices: range(span.map(t => t.inspection.voices)),
        bedFire: range(span.map(t => t.inspection.beds.fire)), bedNight: range(span.map(t => t.inspection.beds.night)),
        peakSources: end.peakSources, peakVoices: end.peakVoices, played, dropped: end.dropped - first.dropped,
      } };
  });
  const segment = (id: string) => segments.find(s => s.id === id)!;

  const walk = [];
  for (let from = 0; from < 5000; from += 500) {
    const mid = within(from, from + 500)[5]!;
    walk.push({ fromS: from / 1000, toS: (from + 500) / 1000, distanceM: Math.round(mid.distance * 10) / 10, reach: Math.round(mid.reach * 1000) / 1000,
      bedFire: Math.round(mid.inspection.beds.fire * 1000) / 1000, rmsDbfs: db(measure(channels, RATE, from, from + 500).rms),
      sources: mid.inspection.sources });
  }
  const bed = segment('seated-night').audio;
  const nextOnset = (i: number) => study.onsets.slice(i + 1).find(o => o.ms > study.onsets[i]!.ms)?.ms ?? Infinity;
  const cues = study.onsets.map((onset, i) => {
    const own = solo.cues.find(c => c.cue === onset.cue)!, to = Math.min(onset.ms + own.durationS * 1000, nextOnset(i));
    const audio = measure(channels, RATE, onset.ms, to);
    return { cue: onset.cue, atS: onset.ms / 1000, windowS: Math.round(to - onset.ms) / 1000, peakDbfs: db(audio.peak), rmsDbfs: db(audio.rms),
      liftOverSeatedBed: { peakDb: Math.round((db(audio.peak)! - db(bed.peak)!) * 10) / 10, rmsDb: Math.round((db(audio.rms)! - db(bed.rms)!) * 10) / 10 },
      soloPeakVsBedPeakDb: Math.round((own.peakDbfs! - db(bed.peak)!) * 10) / 10, centroidHz: audio.centroidHz };
  });

  const cutAt = (predicate: (before: Tick, after: Tick) => boolean) => {
    for (let i = 1; i < ticks.length; i++) if (predicate(ticks[i - 1]!, ticks[i]!)) return ticks[i]!;
    return null;
  };
  const nightCut = cutAt((a, b) => a.inspection.beds.night > 0 && b.inspection.beds.night === 0 && b.ms >= T.dayFrom);
  const muteTick = ticks.find(t => t.ms === T.mute)!;
  const cuts = {
    nightBedStopAtDawn: nightCut ? { hour: Math.round(nightCut.hour * 100) / 100, previousNightLevel: ticks[ticks.indexOf(nightCut) - 1]!.inspection.beds.night, ...cutProbe(channels, nightCut.frame, RATE) } : null,
    mute: cutProbe(channels, muteTick.frame, RATE),
  };

  const final = study.final;
  const expected: Played = { ask: 1, deal: 1, night: 1, snuff: 1, ember: 2, ballot: 1, tap: 2, sent: 1, town: 1 };
  const all = measure(channels, RATE, 0, DURATION * 1000);
  const resumedTick = ticks.find(t => t.ms === T.resume)!;
  const checks = [
    { name: 'Far beyond the reach is digital silence with no sources', pass: segment('far').audio.digitalSilence && segment('far').inspection.sources.max === 0 },
    { name: 'Walking in, the fire bed only grows', pass: within(T.walkFrom, T.walkTo + 1).every((t, i, list) => i === 0 || t.inspection.beds.fire >= list[i - 1]!.inspection.beds.fire) && (walk.at(-1)!.rmsDbfs ?? -999) > (walk[4]!.rmsDbfs ?? -999) },
    { name: 'Seated at night: three beds (flame, crackle, night air), the night bed above 0.85', pass: segment('seated-night').inspection.sources.min === 3 && segment('seated-night').inspection.sources.max === 3 && segment('seated-night').inspection.bedNight.min > .85 },
    { name: 'Seated by day: two beds, the night bed at zero', pass: segment('seated-day').inspection.sources.max === 2 && segment('seated-day').inspection.sources.min === 2 && segment('seated-day').inspection.bedNight.max === 0 },
    { name: 'By day the 2-6 kHz band (leaves, crickets) falls', pass: (segment('seated-day').audio.bandsDbfs.high ?? -200) < (segment('seated-night').audio.bandsDbfs.high ?? -200) },
    { name: 'No sample clips and the peak stays under the 0.91 ceiling', pass: all.clipped === 0 && all.peak <= .91 },
    { name: 'Every public moment sounded exactly once, the click twice, nothing dropped', pass: CAMPFIRE_CUES.every(c => (final.played[c] ?? 0) === (expected[c] ?? 0)) && final.dropped === 0 },
    { name: 'Within the source and voice budget', pass: final.peakSources <= CAMPFIRE_SOUND_LIMITS.sources && final.peakVoices <= CAMPFIRE_SOUND_LIMITS.voices },
    { name: 'Muted is digital silence with no sources', pass: segment('muted').audio.digitalSilence && segment('muted').inspection.sources.max === 0 },
    { name: 'Resumed: only the two day beds, and the round asked for while muted is not replayed', pass: resumedTick.inspection.sources === 2 && segment('resumed').inspection.sources.max === 2 && (final.played.ask ?? 0) === 1 },
    { name: 'The click sounds after the resume', pass: (segment('resumed-tap').inspection.played.tap ?? 0) === 1 },
    { name: 'Every cue alone ends inside its own length and leaves silence', pass: solo.cues.every(c => c.silentAfterEnd && c.clipped === 0) },
  ];

  const wav = wavOf(study.buffer);
  return { wav: wav.base64, report: {
    provenance: 'OfflineAudioContext render of the shipped campfire layer (apps/web/src/campfire/sound: createCampfireSound, CampfireObserver, createCampfireSoundGraph, original procedural PCM from materials.ts) into the kingdom master input of the common Mix (packages/audio/src/mix.ts) at volume 0.65; no external samples.',
    limits: 'SIMULATED frames: a scripted five-seat Dusk Court round with placeholder seat names; no live realm and no real people. Time is compressed (a 3.5 s walk, a 4 s night, a 1 s time-lapse dawn). Numbers do not establish timbre, comfort or headphone quality: no headphone audition was possible on this server.',
    rerun: 'nice -n 10 node apps/web/src/campfire/sound/study/run.mjs',
    rate: RATE, durationS: DURATION, channels: 2, bytes: wav.bytes, pcmFnv1a: wav.pcmFnv1a,
    dbfs: 'dBFS relative to a full-scale sample of 1.0 (a full-scale sine reads -3 dB RMS); null is digital silence. Bands are mono mean-square levels: low 20-250 Hz, mid 250-2000 Hz, high 2-6 kHz, top 6 kHz to Nyquist.',
    limitsOfGraph: CAMPFIRE_SOUND_LIMITS,
    overall: { peakDbfs: db(all.peak), rmsDbfs: db(all.rms), clipped: all.clipped, nearFull: all.nearFull },
    checks, passed: checks.every(c => c.pass),
    segments, walk, cues, solo, cuts,
    final,
    timeline: study.frames.map(f => ({ atS: f.ms / 1000, frame: f.label, expect: f.expect })),
    events: study.events,
  } };
}

Object.assign(window, { renderCampfireSoundStudy: render });
