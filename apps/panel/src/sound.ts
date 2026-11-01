// The panel's small sounds: wood pressed, paper turned, a brass tick while waiting, a dull
// knock when the answer is no, and glass catching light only when a window is really lit
// (in the panel today, only on the SIMULATED night). Every sound is made here from a few
// sine partials and a breath of noise, a little different each time, gone within a second.
//
// Nothing plays and no audio context exists until the viewer's first gesture inside the
// panel, and never while muted. The shared kingdom mix carries recorded foley; its samples
// are far larger than the panel's whole first load, so the panel draws its own.

export type PanelCue =
  /** A carved control pressed: tabs, choices, act buttons. */
  | 'tap'
  /** A parchment drawer unrolled or put back. */
  | 'page'
  /** Waiting on Twitch or the kingdom: two soft brass ticks, no resolution. */
  | 'pending'
  /** The kingdom confirmed a light: panes catching one by one, and a warm breath of flame. */
  | 'kindle'
  /** The kingdom counted a tap: one small glass note over the wood. */
  | 'counted'
  /** Not now, not available, closed without using Bits: a muffled low knock with no ring. */
  | 'dull'
  /** A leaf of the passport turned: stiffer paper lifting, a sweep through the air, a soft landing on the leaves below. */
  | 'leaf'
  /** The book's leather cover closing over the card, or the card laid back on top: a low pat of hide and board. */
  | 'cover';

export interface PanelSound {
  muted(): boolean;
  setMuted(muted: boolean): void;
  subscribe(listener: (muted: boolean) => void): () => void;
  /** Call from inside a user gesture. Only here may an audio context be made. */
  gesture(): void;
  play(cue: PanelCue): void;
  dispose(): void;
}

const STORE = 'chatdom-panel-muted';
const LEVEL = 0.2;

/** The mute choice is kept on this device when the browser allows it. It is a preference, nothing more. */
function remembered(): boolean {
  try { return globalThis.localStorage?.getItem(STORE) === '1'; } catch { return false; }
}
function remember(muted: boolean) {
  try { globalThis.localStorage?.setItem(STORE, muted ? '1' : '0'); } catch { /* storage refused: the choice lasts this visit */ }
}

export function createPanelSound(): PanelSound {
  const listeners = new Set<(muted: boolean) => void>();
  let muted = remembered();
  let context: AudioContext | null = null, master: GainNode | null = null, noise: AudioBuffer | null = null;
  let turn = 0;
  const vary = (spread: number) => 1 + (Math.random() * 2 - 1) * spread;

  const ensure = () => {
    if (context || muted) return;
    const Context = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    context = new Context();
    master = context.createGain();
    master.gain.value = LEVEL;
    // A gentle shelf off the top keeps every cue warm through laptop speakers and phones alike.
    const warm = context.createBiquadFilter();
    warm.type = 'lowpass'; warm.frequency.value = 6800; warm.Q.value = 0.5;
    master.connect(warm).connect(context.destination);
    noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.6), context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  };

  /** One decaying partial: a struck mode of wood, brass or glass. */
  const partial = (type: OscillatorType, hz: number, at: number, peak: number, tau: number, out: AudioNode) => {
    const ctx = context!, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.002);
    gain.gain.setTargetAtTime(0.0001, at + 0.002, tau);
    osc.connect(gain).connect(out);
    osc.start(at); osc.stop(at + 0.002 + tau * 7);
  };
  /** A breath of filtered noise: the press edge, paper fibres, flame. */
  const breath = (at: number, length: number, filter: BiquadFilterType, hz: number, q: number, peak: number, shape: (gain: AudioParam) => void = gain => {
    gain.setValueAtTime(0.0001, at); gain.linearRampToValueAtTime(peak, at + 0.003); gain.setTargetAtTime(0.0001, at + 0.004, length / 4);
  }) => {
    const ctx = context!, source = ctx.createBufferSource(), band = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = noise; band.type = filter; band.frequency.value = hz; band.Q.value = q;
    shape(gain.gain);
    source.connect(band).connect(gain).connect(master!);
    source.start(at, Math.random() * 0.3); source.stop(at + length + 0.05);
    return band;
  };

  const cues: Record<PanelCue, (at: number) => void> = {
    tap(at) {
      // A small dense block: three modes near 1 : 2.5 : 4.4, a soft thock under them, the seat of the press.
      const base = [760, 705, 830][turn % 3]! * vary(0.03);
      partial('sine', base, at, 0.12, 0.03, master!);
      partial('sine', base * 2.5, at, 0.045, 0.015, master!);
      partial('sine', base * 4.4, at, 0.016, 0.007, master!);
      partial('triangle', 200 * vary(0.06), at, 0.16, 0.022, master!);
      breath(at, 0.04, 'bandpass', 4800 * vary(0.12), 1.3, 0.05);
    },
    page(at) {
      // Parchment: two or three quick rustles of fibre, the second softer, no tone at all.
      const length = 0.16 * vary(0.2), rustles = 2 + (turn % 2);
      breath(at, length, 'bandpass', 3600 * vary(0.25), 0.7, 0.0001, gain => {
        gain.setValueAtTime(0.0001, at);
        for (let i = 0; i < rustles; i++) {
          const t = at + (i * length) / rustles;
          gain.linearRampToValueAtTime((0.11 - i * 0.03) * vary(0.2), t + 0.012);
          gain.linearRampToValueAtTime(0.012, t + length / rustles);
        }
        gain.linearRampToValueAtTime(0.0001, at + length + 0.03);
      });
      breath(at, length * 0.7, 'lowpass', 900, 0.5, 0.025);
    },
    pending(at) {
      // A brass escapement, twice, low and unresolved: waiting is not an answer.
      for (const [i, delay] of [0, 0.15].entries()) {
        const hz = (i ? 1480 : 1568) * vary(0.01);
        partial('sine', hz, at + delay, 0.035, 0.03, master!);
        partial('sine', hz * 2.76, at + delay, 0.01, 0.012, master!);
        breath(at + delay, 0.02, 'highpass', 5200, 0.7, 0.02);
      }
    },
    kindle(at) {
      // The panes catch in the order the window draws them, rising C, E, G, C; then the flame settles.
      const notes = [1046.5, 1318.5, 1568, 2093];
      notes.forEach((hz, i) => {
        const t = at + 0.1 + i * 0.22;
        partial('sine', hz * vary(0.004), t, 0.06, 0.32, master!);
        partial('sine', hz * 2.76, t, 0.012, 0.08, master!);
      });
      partial('sine', 523.25, at + 0.1, 0.035, 0.9, master!);
      const flame = breath(at + 0.05, 0.9, 'lowpass', 380, 0.8, 0.0001, gain => {
        gain.setValueAtTime(0.0001, at + 0.05);
        gain.linearRampToValueAtTime(0.06, at + 0.35);
        gain.setTargetAtTime(0.0001, at + 0.45, 0.2);
      });
      flame.frequency.linearRampToValueAtTime(1300, at + 0.4);
    },
    counted(at) {
      cues.tap(at);
      partial('sine', 1568 * vary(0.005), at + 0.07, 0.05, 0.22, master!);
      partial('sine', 1568 * 2.76, at + 0.07, 0.01, 0.06, master!);
    },
    leaf(at) {
      // Rag paper is stiffer than parchment: a crisp lift, a long airy sweep that falls in pitch, and the leaf settling.
      const sweep = 0.28 * vary(0.15);
      breath(at, 0.03, 'highpass', 5600 * vary(0.1), 0.8, 0.06);
      const air = breath(at + 0.02, sweep, 'bandpass', 2600 * vary(0.2), 0.9, 0.0001, gain => {
        gain.setValueAtTime(0.0001, at + 0.02);
        gain.linearRampToValueAtTime(0.07 * vary(0.2), at + 0.02 + sweep * 0.35);
        gain.linearRampToValueAtTime(0.0001, at + 0.02 + sweep);
      });
      air.frequency.exponentialRampToValueAtTime(900, at + 0.02 + sweep);
      const land = at + 0.02 + sweep * 0.92;
      partial('triangle', 180 * vary(0.08), land, 0.05, 0.02, master!);
      breath(land, 0.06, 'lowpass', 1400, 0.6, 0.05);
    },
    cover(at) {
      // A hide-bound board meeting the desk: a low pat, a little leather creak above it, nothing that rings.
      const muffled = context!.createBiquadFilter();
      muffled.type = 'lowpass'; muffled.frequency.value = 760; muffled.Q.value = 0.5;
      muffled.connect(master!);
      breath(at, 0.12, 'bandpass', 1900 * vary(0.15), 1.6, 0.03);
      partial('triangle', 118 * vary(0.05), at + 0.09, 0.2, 0.06, muffled);
      partial('sine', 236 * vary(0.05), at + 0.09, 0.06, 0.03, muffled);
      breath(at + 0.09, 0.08, 'lowpass', 600, 0.5, 0.06);
    },
    dull(at) {
      // Knuckles on a shut door through cloth: low, short, nothing rings.
      const muffled = context!.createBiquadFilter();
      muffled.type = 'lowpass'; muffled.frequency.value = 520; muffled.Q.value = 0.6;
      muffled.connect(master!);
      partial('triangle', 142 * vary(0.05), at, 0.24, 0.05, muffled);
      partial('sine', 96 * vary(0.05), at, 0.14, 0.07, muffled);
      breath(at, 0.05, 'lowpass', 700, 0.5, 0.05);
    },
  };

  return {
    muted: () => muted,
    setMuted(next) {
      if (next === muted) return;
      muted = next;
      remember(muted);
      if (muted && context) void context.suspend().catch(() => undefined);
      for (const listener of listeners) listener(muted);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    gesture() {
      ensure();
      if (context && !muted && context.state === 'suspended') void context.resume().catch(() => undefined);
    },
    play(cue) {
      if (muted || !context || !master || context.state === 'closed') return;
      turn++;
      cues[cue](context.currentTime + 0.005);
    },
    dispose() { listeners.clear(); void context?.close().catch(() => undefined); context = null; },
  };
}
