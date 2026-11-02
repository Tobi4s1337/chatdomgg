// Measuring rendered voice and sound with ffmpeg, and turning ElevenLabs'
// character alignment into word timings for captions.
//
// Every ffmpeg run is niced and limited to four threads (the host is shared).

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Run a tool under nice and return its output; ffmpeg writes its analysis to stderr. */
function runBoth(cmd, args) {
  const r = spawnSync('nice', ['-n', '19', cmd, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error) throw r.error;
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

export function probe(path) {
  const out = runBoth('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=sample_rate,channels,codec_name', '-of', 'json', path]).stdout;
  const j = JSON.parse(out);
  const s = j.streams?.[0] ?? {};
  return {
    duration: Number(j.format?.duration ?? 0),
    bitRate: Number(j.format?.bit_rate ?? 0),
    sampleRate: Number(s.sample_rate ?? 0),
    channels: Number(s.channels ?? 0),
    codec: s.codec_name ?? '',
  };
}

/** Integrated loudness (LUFS), loudness range (LU) and true peak (dBTP) from ebur128. */
export function loudness(path) {
  const { stderr } = runBoth('ffmpeg', ['-hide_banner', '-nostats', '-threads', '4', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const num = (re) => {
    const m = summary.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    integratedLufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/),
    lraLu: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeakDbtp: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/),
  };
}

/** Silences at or below `noiseDb` lasting at least `minDur` seconds. */
export function silences(path, { noiseDb = -45, minDur = 0.12 } = {}) {
  const { stderr } = runBoth('ffmpeg', ['-hide_banner', '-nostats', '-threads', '4', '-i', path, '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-']);
  const out = [];
  let start = null;
  for (const line of stderr.split('\n')) {
    let m = line.match(/silence_start: (-?[\d.]+)/);
    if (m) start = Math.max(0, Number(m[1]));
    m = line.match(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/);
    if (m) {
      out.push({ start: start ?? 0, end: Number(m[1]), duration: Number(m[2]) });
      start = null;
    }
  }
  if (start != null) out.push({ start, end: null, duration: null });
  return out;
}

/** Peak level (dBFS) of a window, used to spot clipped or abrupt starts and ends. */
export function windowPeak(path, startSec, durSec) {
  const { stderr } = runBoth('ffmpeg', ['-hide_banner', '-nostats', '-threads', '4', '-ss', String(Math.max(0, startSec)), '-t', String(durSec), '-i', path, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = stderr.match(/max_volume: (-?[\d.]+|-inf) dB/);
  return m ? Number(m[1]) : null;
}

/**
 * Lead and tail silence (speech bounds) from silencedetect, plus the pauses inside the line.
 */
export function speechBounds(path, opts) {
  const { duration } = probe(path);
  const sil = silences(path, opts);
  let lead = 0;
  let tail = duration;
  const inner = [];
  for (const s of sil) {
    const end = s.end ?? duration;
    if (s.start <= 0.02) lead = end;
    else if (s.end == null || end >= duration - 0.02) tail = s.start;
    else inner.push({ start: round(s.start), end: round(end), duration: round(end - s.start) });
  }
  return { duration: round(duration), lead: round(lead), tail: round(duration - tail), speechEnd: round(tail), pauses: inner };
}

export function round(x, d = 3) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/**
 * A full measurement of one rendered clip. With an alignment, the speech bounds come from the
 * signal envelope near the first and last words, so a stray blip after a long silence at the end
 * is reported as trailing noise instead of being counted as speech.
 */
export function measure(path, alignment) {
  const p = probe(path);
  const l = loudness(path);
  const b = speechBounds(path);
  const startPeak = windowPeak(path, 0, 0.02);
  const endPeak = windowPeak(path, Math.max(0, p.duration - 0.05), 0.05);
  const out = {
    duration: round(p.duration),
    sampleRate: p.sampleRate,
    bitRateKbps: Math.round(p.bitRate / 1000),
    channels: p.channels,
    ...l,
    pauses: b.pauses,
    startPeakDb: startPeak,
    endPeakDb: endPeak,
    clippedStart: startPeak != null && startPeak > -30,
    clippedEnd: endPeak != null && endPeak > -30,
  };
  const env = envelope(path);
  const loud = (i) => env.db[i] > -45;
  let onsetIdx = env.db.findIndex((_, i) => loud(i));
  let offsetIdx = env.db.length - 1;
  while (offsetIdx > 0 && !loud(offsetIdx)) offsetIdx -= 1;
  if (alignment) {
    const words = wordsFromAlignment(alignment);
    if (words.length) {
      // Speech ends at the last loud hop no later than 0.35 s after the last aligned word.
      const limit = Math.min(env.db.length - 1, Math.ceil((words.at(-1).end + 0.35) / env.hop));
      let last = limit;
      while (last > 0 && !loud(last)) last -= 1;
      if (last < offsetIdx) out.trailingNoise = { from: round((last + 1) * env.hop, 2), to: round((offsetIdx + 1) * env.hop, 2), peakDb: round(Math.max(...env.db.slice(last + 1, offsetIdx + 1)), 1) };
      offsetIdx = last;
      out.alignment = alignmentCheck(path, alignment);
    }
  }
  if (onsetIdx < 0) onsetIdx = 0;
  out.speechStart = round(onsetIdx * env.hop, 2);
  out.speechEnd = round((offsetIdx + 1) * env.hop, 2);
  out.lead = out.speechStart;
  out.tail = round(p.duration - out.speechEnd, 2);
  return out;
}

/**
 * Two-pass loudnorm to a target (default -16 LUFS, -1.5 dBTP), written as mp3 44.1 kHz 192 kb/s.
 * Optionally trims to [trimStart, trimEnd] first, with short fades so the cut never clicks.
 *
 * Linear loudnorm cannot add more gain than the true-peak headroom allows, so a short, peaky line
 * would land under target. When pass one shows that shortfall, a measured pre-stage raises the
 * level by the shortfall plus 1 dB and a lookahead limiter holds the peaks where they were; the
 * two loudnorm passes then run on that. `limitedDb` reports how much limiting it took.
 */
export function normalise(input, output, { target = -16, tp = -1.5, lra = 11, trimStart, trimEnd, fadeIn = 0.005, fadeOut = 0.04 } = {}) {
  mkdirSync(dirname(output), { recursive: true });
  const trimmed = trimStart != null || trimEnd != null;
  const trim = trimmed ? `atrim=start=${trimStart ?? 0}${trimEnd != null ? `:end=${trimEnd}` : ''},asetpts=N/SR/TB,` : '';
  const len = trimEnd != null ? trimEnd - (trimStart ?? 0) : null;
  const fades = len != null ? `,afade=t=in:d=${fadeIn},afade=t=out:st=${Math.max(0, len - fadeOut).toFixed(3)}:d=${fadeOut}` : '';
  const ln = `loudnorm=I=${target}:TP=${tp}:LRA=${lra}`;
  const firstPass = (pre) => {
    const err = runBoth('ffmpeg', ['-hide_banner', '-nostats', '-threads', '4', '-i', input, '-af', `${trim}${pre}${ln}:print_format=json`, '-f', 'null', '-']).stderr;
    return JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  };
  let pre = '';
  let limitedDb = 0;
  let m = firstPass(pre);
  const need = target - Number(m.input_i);
  const headroom = tp - Number(m.input_tp);
  if (need > headroom) {
    limitedDb = round(need - headroom + 1, 1);
    const limit = Math.min(1, Math.max(0.0625, 10 ** (Number(m.input_tp) / 20)));
    pre = `volume=${limitedDb}dB,alimiter=limit=${limit.toFixed(4)}:attack=3:release=60:level=false:latency=true,`;
    m = firstPass(pre);
  }
  const filter =
    `${trim}${pre}${ln}` +
    `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}` +
    `:offset=${m.target_offset}:linear=true:print_format=json,aresample=44100${fades}`;
  const r = runBoth('ffmpeg', ['-hide_banner', '-nostats', '-y', '-threads', '4', '-i', input, '-af', filter, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k', output]);
  if (r.status !== 0) throw new Error(`loudnorm failed for ${input}: ${r.stderr.slice(-400)}`);
  const pass2 = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('{'), r.stderr.lastIndexOf('}') + 1));
  // loudnorm falls back to dynamic mode when linear gain would still break the true-peak limit.
  return { output, measured: m, normalizationType: pass2.normalization_type, limitedDb };
}

// ---------------------------------------------------------------------------
// Alignment

/**
 * Words with start and end times from a character alignment.
 * Bracketed audio tags ([warm]) are skipped; punctuation stays on its word.
 */
export function wordsFromAlignment(alignment) {
  if (!alignment) return [];
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const words = [];
  let cur = null;
  let inTag = false;
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    if (c === '[') {
      inTag = true;
      continue;
    }
    if (inTag) {
      if (c === ']') inTag = false;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    const isPunct = /[.,!?;:…"'’”)\-–—]/.test(c);
    if (!cur) {
      if (isPunct && words.length) {
        // Leading punctuation (rare): attach to the previous word.
        const prev = words[words.length - 1];
        prev.text += c;
        continue;
      }
      cur = { text: c, start: starts[i], end: ends[i] };
    } else {
      cur.text += c;
      // Trailing punctuation does not extend a word's spoken end.
      if (!isPunct) cur.end = ends[i];
    }
  }
  if (cur) words.push(cur);
  return words.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) }));
}

/** Spoken characters (no tags, no spaces) and pace in characters per second over the spoken span. */
export function pace(alignment) {
  const words = wordsFromAlignment(alignment);
  if (!words.length) return { spokenChars: 0, cps: 0, wordGaps: [] };
  const spokenChars = words.reduce((n, w) => n + w.text.replace(/[^\p{L}\p{N}']/gu, '').length, 0);
  const span = words[words.length - 1].end - words[0].start;
  const wordGaps = [];
  for (let i = 1; i < words.length; i += 1) {
    const gap = words[i].start - words[i - 1].end;
    if (gap >= 0.15) wordGaps.push({ after: words[i - 1].text, gap: round(gap, 2) });
  }
  return { spokenChars, span: round(span), cps: round(spokenChars / span, 2), firstWordAt: words[0].start, lastWordEnd: words[words.length - 1].end, wordGaps };
}

/** RMS level in dBFS per `hop` seconds, from the decoded mono signal. */
export function envelope(path, hop = 0.01) {
  const r = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-threads', '4', '-i', path, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`decode failed for ${path}`);
  const buf = r.stdout;
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const n = Math.round(44100 * hop);
  const out = [];
  for (let i = 0; i < samples.length; i += n) {
    let sum = 0;
    const end = Math.min(samples.length, i + n);
    for (let j = i; j < end; j += 1) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / Math.max(1, end - i));
    out.push(rms > 0 ? 20 * Math.log10(rms) : -120);
  }
  return { hop, db: out };
}

/**
 * How well the alignment agrees with the audio: where speech actually starts and ends
 * (first and last hop above `floorDb`), against the first word's start and last word's end;
 * and the level inside each pause the alignment claims.
 */
export function alignmentCheck(path, alignment, { floorDb = -40 } = {}) {
  const env = envelope(path);
  const words = wordsFromAlignment(alignment);
  const idx = env.db.map((d, i) => (d > floorDb ? i : -1)).filter((i) => i >= 0);
  const onset = idx.length ? idx[0] * env.hop : null;
  const offset = idx.length ? (idx[idx.length - 1] + 1) * env.hop : null;
  const level = (a, b) => {
    const s = env.db.slice(Math.floor(a / env.hop), Math.max(Math.floor(a / env.hop) + 1, Math.ceil(b / env.hop)));
    return s.length ? round(Math.max(...s), 1) : null;
  };
  const gaps = [];
  for (let i = 1; i < words.length; i += 1) {
    const a = words[i - 1].end;
    const b = words[i].start;
    if (b - a >= 0.15) gaps.push({ after: words[i - 1].text, from: a, to: b, peakDbInGap: level(a + 0.03, b - 0.03) });
  }
  // Sound that is not speech: anything above the floor after a long quiet stretch at the very end.
  let trailingNoise = null;
  if (words.length && offset != null && offset > words[words.length - 1].end + 0.3) {
    trailingNoise = { from: round(words[words.length - 1].end, 3), soundUntil: round(offset, 3), peakDb: level(words[words.length - 1].end + 0.1, offset) };
  }
  return {
    audioOnset: onset == null ? null : round(onset, 2),
    firstWordStart: words[0]?.start ?? null,
    onsetError: onset == null || !words.length ? null : round(words[0].start - onset, 3),
    audioOffset: offset == null ? null : round(offset, 2),
    lastWordEnd: words.at(-1)?.end ?? null,
    offsetError: offset == null || !words.length ? null : round(words.at(-1).end - offset, 3),
    gaps,
    trailingNoise,
  };
}

function decodeMono(path, rate = 16000) {
  const r = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-threads', '4', '-i', path, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`decode failed for ${path}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
}

function bandRmsDb(path, filter) {
  const r = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-nostats', '-threads', '4', '-i', path, '-af', `${filter},astats=measure_perchannel=none:measure_overall=RMS_level`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr ?? '').match(/RMS level dB: (-?[\d.]+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Proxies for how a voice sounds, since a script cannot listen:
 * - median pitch and its 10th to 90th percentile range in semitones (how deep; how much it moves),
 *   from a plain autocorrelation pitch tracker over voiced frames;
 * - low/high balance: RMS below 300 Hz minus RMS above 3 kHz, in dB (higher reads warmer and darker);
 * - samples at or above -0.1 dBFS (clipping).
 */
export function voiceStats(path) {
  const rate = 16000;
  const x = decodeMono(path, rate);
  const frame = Math.round(0.04 * rate);
  const hop = Math.round(0.01 * rate);
  const minLag = Math.floor(rate / 300);
  const maxLag = Math.ceil(rate / 60);
  const f0 = [];
  for (let s = 0; s + frame + maxLag < x.length; s += hop) {
    let energy = 0;
    for (let i = 0; i < frame; i += 1) energy += x[s + i] * x[s + i];
    if (10 * Math.log10(energy / frame + 1e-12) < -35) continue;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let num = 0;
      let e2 = 0;
      for (let i = 0; i < frame; i += 1) {
        num += x[s + i] * x[s + i + lag];
        e2 += x[s + i + lag] * x[s + i + lag];
      }
      const c = num / Math.sqrt(energy * e2 + 1e-12);
      if (c > best) {
        best = c;
        bestLag = lag;
      }
    }
    if (best > 0.6 && bestLag > 0) f0.push(rate / bestLag);
  }
  f0.sort((a, b) => a - b);
  const q = (p) => (f0.length ? f0[Math.min(f0.length - 1, Math.floor(p * f0.length))] : null);
  const semis = f0.length ? 12 * Math.log2(q(0.9) / q(0.1)) : null;
  const full = decodeMono(path, 44100);
  let clipped = 0;
  for (const v of full) if (Math.abs(v) >= 0.9886) clipped += 1;
  const low = bandRmsDb(path, 'lowpass=f=300:poles=2,lowpass=f=300:poles=2');
  const high = bandRmsDb(path, 'highpass=f=3000:poles=2,highpass=f=3000:poles=2');
  return {
    medianF0Hz: f0.length ? round(q(0.5), 0) : null,
    f0RangeSemitones: semis == null ? null : round(semis, 1),
    voicedFrames: f0.length,
    lowHighBalanceDb: low != null && high != null ? round(low - high, 1) : null,
    clippedSamples: clipped,
  };
}
