import { BreezeBed, LanternBed, LapBed, MistBed, RainBed, ReelBed, TensionBed } from './beds';
import type { PierRecipe } from './cues';
import { pierKit, type PierKit } from './kit';
import {
  coalesces, dbToGain, LEAD_SECONDS, MAX_VOICES, nextVariation, placeCue, RestClock, shade, STEAL_FADE_SECONDS, VoicePool,
} from './law';
import { Shot } from './shot';
import type { PierCue, PierCueOptions } from './types';

interface Voice {
  readonly shot: Shot;
  readonly input: GainNode;
  readonly placing: readonly AudioNode[];
}

export interface PierSoundReport {
  readonly voices: number;
  readonly beds: readonly string[];
  /** True while nothing sounds and the pier's output is disconnected. */
  readonly parked: boolean;
}

/**
 * The pier's sound on one audio context:
 *
 *   one-shots ─▶ placement (distance, air, pan) ─▶ bus ─▶ compressor ─▶ trim ─▶ host destination (world volume)
 *   one-shots ─▶ open-air send ─▶ convolver ─▶ tone ─────▲
 *   beds (reel, tension, lap, rain, breeze, mist, lantern) ─▶ bus
 *
 * The compressor is gentle and only rounds off stacked splashes; the kingdom's own ceiling sits after the host
 * destination. When nothing has sounded for two seconds the trim is disconnected, so the graph costs nothing.
 */
export class PierGraph {
  readonly kit: PierKit;
  readonly reelBed: ReelBed;
  readonly tensionBed: TensionBed;
  readonly lap: LapBed;
  readonly rain: RainBed;
  readonly breeze: BreezeBed;
  readonly mist: MistBed;
  readonly lantern: LanternBed;
  private readonly bus: GainNode;
  private readonly send: GainNode;
  private readonly output: GainNode;
  private readonly owned: AudioNode[];
  private readonly pool = new VoicePool<Voice>(MAX_VOICES);
  private readonly last = new Map<PierCue, { at: number; gain: number; variation: number }>();
  private readonly rest = new RestClock();
  private parked = true;
  private closed = false;

  constructor(readonly context: AudioContext, private destination: AudioNode, private readonly random: () => number = Math.random) {
    this.kit = pierKit(context);
    this.bus = context.createGain();
    this.send = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12; compressor.knee.value = 10; compressor.ratio.value = 4;
    compressor.attack.value = 0.003; compressor.release.value = 0.2;
    this.output = context.createGain();
    this.output.gain.value = 1;
    const air = context.createConvolver();
    air.normalize = true;
    air.buffer = this.kit.impulse;
    const low = context.createBiquadFilter(), high = context.createBiquadFilter(), wet = context.createGain();
    low.type = 'highpass'; low.frequency.value = 200; low.Q.value = 0.6;
    high.type = 'lowpass'; high.frequency.value = 4200; high.Q.value = 0.5;
    wet.gain.value = 0.55;
    this.send.connect(air); air.connect(low); low.connect(high); high.connect(wet); wet.connect(compressor);
    this.bus.connect(compressor); compressor.connect(this.output);
    this.owned = [this.bus, this.send, air, low, high, wet, compressor, this.output];

    this.reelBed = new ReelBed(this.kit, this.bus);
    this.tensionBed = new TensionBed(this.kit, this.bus);
    this.lap = new LapBed(this.kit, this.bus);
    this.rain = new RainBed(this.kit, this.bus);
    this.breeze = new BreezeBed(this.kit, this.bus);
    this.mist = new MistBed(this.kit, this.bus);
    this.lantern = new LanternBed(this.kit, this.bus);
  }

  private get beds() {
    return [this.reelBed, this.tensionBed, this.lap, this.rain, this.breeze, this.mist, this.lantern] as const;
  }

  get ambienceLive(): boolean {
    return this.lap.live || this.rain.live || this.breeze.live || this.mist.live || this.lantern.live;
  }

  /** The host may hand the same context a new destination. */
  retarget(destination: AudioNode): void {
    if (destination === this.destination) return;
    if (!this.parked) { this.output.disconnect(); this.output.connect(destination); }
    this.destination = destination;
  }

  /** Reconnects the output before something sounds. */
  wake(): void {
    this.rest.reset();
    if (!this.parked || this.closed) return;
    this.output.connect(this.destination);
    this.parked = false;
  }

  /** Once per frame: disconnects the output after two seconds with no voice and no bed. */
  settle(now = this.context.currentTime): void {
    if (this.parked) return;
    const busy = this.pool.size > 0 || this.reelBed.live || this.tensionBed.live || this.ambienceLive;
    if (this.rest.update(busy, now)) { this.output.disconnect(); this.parked = true; }
  }

  play(kind: PierCue, recipe: PierRecipe, options: PierCueOptions | undefined): void {
    const place = placeCue(options);
    if (!place || this.closed) return;
    const context = this.context, now = context.currentTime, previous = this.last.get(kind);
    if (coalesces(previous?.at, previous?.gain ?? 0, now, place.gain)) return;
    this.wake();

    const input = context.createGain();
    input.gain.value = place.gain * dbToGain(recipe.fader);
    const shot = new Shot(context, input, now + LEAD_SECONDS, this.kit, this.random);
    const variation = nextVariation(previous?.variation, recipe.variations, this.random);
    try { recipe.build(shot, shade(options?.intensity), variation); }
    catch (error) { shot.release(); input.disconnect(); throw error; }

    const placing: AudioNode[] = [];
    let head: AudioNode = input;
    if (place.air !== null) {
      const air = context.createBiquadFilter();
      air.type = 'lowpass'; air.frequency.value = place.air; air.Q.value = 0.5;
      head.connect(air); head = air; placing.push(air);
    }
    const panner = context.createStereoPanner();
    panner.pan.value = place.pan;
    head.connect(panner); panner.connect(this.bus); placing.push(panner);
    if (shot.room > 0) {
      const send = context.createGain();
      send.gain.value = shot.room * place.wet;
      panner.connect(send); send.connect(this.send); placing.push(send);
    }

    const voice: Voice = { shot, input, placing };
    const giving = this.pool.admit(voice);
    if (giving) giving.shot.fade(giving.input, STEAL_FADE_SECONDS);
    shot.start(() => this.release(voice));
    this.last.set(kind, { at: now, gain: place.gain, variation });
  }

  /** Silences everything quickly (the host went away, or the context stopped running). */
  sleep(): void {
    if (this.closed || (this.pool.size === 0 && !this.reelBed.live && !this.tensionBed.live && !this.ambienceLive)) return;
    const now = this.context.currentTime;
    for (const voice of this.pool.clear()) voice.shot.fade(voice.input, 0.02);
    for (const bed of this.beds) bed.stop(now, 0.03);
  }

  report(): PierSoundReport {
    const names = ['reel', 'tension', 'lap', 'rain', 'breeze', 'mist', 'lantern'];
    return { voices: this.pool.size, beds: this.beds.flatMap((bed, index) => bed.live ? [names[index]!] : []), parked: this.parked };
  }

  dispose(): void {
    if (this.closed) return;
    this.sleep();
    this.closed = true;
    const owned = this.owned, output = this.output, context = this.context;
    const release = () => { for (const node of owned) node.disconnect(); };
    if ((context.state as string) === 'closed' || this.parked) { release(); return; }
    try {
      const now = context.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(output.gain.value, now);
      output.gain.linearRampToValueAtTime(0, now + 0.03);
    } catch { /* closing */ }
    globalThis.setTimeout(release, 80);
  }

  private release(voice: Voice): void {
    this.pool.release(voice);
    voice.shot.release();
    voice.input.disconnect();
    for (const node of voice.placing) node.disconnect();
  }
}
