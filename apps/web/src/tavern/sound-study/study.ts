import { Mix } from '../../../../../packages/audio/src/mix';
import { createTavernSoundGraph, TAVERN_SOUND_LIMITS } from '../audio/graph';
import type { TavernCue } from '../audio/observer';

// This page is served only by the local study runner. All times are render time.
async function render() {
  const rate = 32000, duration = 13;
  const context = new OfflineAudioContext(2, rate * duration, rate);
  let seed = 0x12345678;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const mix = new Mix(context, { muted: false, volume: .65 }, random);
  const listener = { feet: [0, 0, 0] as const, forward: [0, 0, -1] as const };
  const position = [1, 1, -2] as const;
  const places = { hearth: [-2, 1, -2] as const, tables: [{ id: 'study', centre: position }] };
  const newGraph = () => createTavernSoundGraph({ context, destination: mix.bus }, places, true);
  let graph = newGraph();
  const snapshots: { at: number; action: string; inspection: ReturnType<typeof graph.inspect> }[] = [];
  const actions: { at: number; name: string; run: () => void }[] = [];
  // Repeated updates keep the finite ambience watchdog alive, as the real host does.
  for (let at = .05; at < 8.9; at += .25) {
    const time = Number(at.toFixed(3));
    actions.push({ at: time, name: 'occupancy update', run: () => graph.update(listener, time < 1.5 ? 1 : 5) });
  }
  const cue = (at: number, sound: TavernCue) => actions.push({ at, name: sound, run: () => graph.play(sound, position, listener) });
  cue(2, 'paddle'); cue(2.65, 'rail'); cue(3.4, 'stone'); cue(4.3, 'dice');
  cue(5.4, 'bank'); cue(6.3, 'point'); cue(7.3, 'finish'); cue(8.7, 'dice');
  actions.push({ at: 9, name: 'mute and quiet', run: () => { mix.rampMaster({ muted: true, volume: .65 }); graph.quiet(); mix.renew(.03); } });
  actions.push({ at: 10, name: 'resume on renewed bus without new sources', run: () => { graph.dispose(); graph = newGraph(); mix.rampMaster({ muted: false, volume: .65 }); } });
  cue(11, 'paddle');
  actions.sort((a, b) => a.at - b.at);
  // OfflineAudioContext quantizes suspensions to 128-frame render blocks and rejects duplicates.
  // Schedule one suspension per block, even when distinct requested times land in that block.
  const blocks = new Map<number, typeof actions>();
  for (const action of actions) {
    const frame = Math.floor(action.at * rate / 128 + 1e-9) * 128;
    const group = blocks.get(frame) ?? [];
    group.push(action); blocks.set(frame, group);
  }
  const groups = [...blocks.entries()].sort(([a], [b]) => a - b);
  // A tiny offset avoids binary representation putting an exact boundary in the previous block.
  const suspensions = groups.map(([frame]) => context.suspend(frame / rate + 1e-8));
  const rendering = context.startRendering();
  for (let i = 0; i < groups.length; i++) {
    await suspensions[i];
    for (const action of groups[i]![1]) {
      action.run();
      snapshots.push({ at: context.currentTime, action: action.name, inspection: graph.inspect() });
    }
    await context.resume();
  }
  const buffer = await rendering;
  const samples = buffer.length, pcm = new DataView(new ArrayBuffer(44 + samples * 4));
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) pcm.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); pcm.setUint32(4, pcm.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  pcm.setUint32(16, 16, true); pcm.setUint16(20, 1, true); pcm.setUint16(22, 2, true);
  pcm.setUint32(24, rate, true); pcm.setUint32(28, rate * 4, true); pcm.setUint16(32, 4, true); pcm.setUint16(34, 16, true);
  write(36, 'data'); pcm.setUint32(40, samples * 4, true);
  let peak = 0, squares = 0;
  const windows = [[0, 1.4], [1.6, 1.9], [9.2, 9.9], [10.2, 10.9], [11, 11.4], [12, 13]].map(([from, to]) => ({ from, to, peak: 0, squares: 0, count: 0 }));
  for (let i = 0; i < samples; i++) for (let channel = 0; channel < 2; channel++) {
    const sample = buffer.getChannelData(channel)[i] ?? 0;
    if (!Number.isFinite(sample)) throw new Error('Non-finite audio sample');
    peak = Math.max(peak, Math.abs(sample)); squares += sample * sample;
    for (const window of windows) if (i >= window.from! * rate && i < window.to! * rate) { window.peak = Math.max(window.peak, Math.abs(sample)); window.squares += sample * sample; window.count++; }
    pcm.setInt16(44 + (i * 2 + channel) * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  }
  const metrics = windows.map(({ squares: sum, count, ...rest }) => ({ ...rest, rms: Math.sqrt(sum / count) }));
  const peakSources = Math.max(...snapshots.map(s => s.inspection.peakSources));
  if (peak > .951 || peakSources > TAVERN_SOUND_LIMITS.sources || metrics[3]!.peak > .00001 || metrics[4]!.rms < .00001) throw new Error('Ceiling, source budget, resumed old-tail silence or post-resume cue failed');
  const wav = new Uint8Array(pcm.buffer);
  let binary = ''; for (let i = 0; i < wav.length; i += 8192) binary += String.fromCharCode(...wav.subarray(i, i + 8192));
  return { wav: btoa(binary), report: { provenance: 'OfflineAudioContext, original procedural PCM from tavern/audio/materials.ts, through the common Mix at volume 0.65; no external samples. See tavern/audio/README.md.', limits: 'Synthetic scripted occupancy and events; no live realm or real people represented. Numeric checks do not establish timbre, comfort or headphone quality; no headphone audition was performed.', rate, duration, channels: 2, bytes: wav.length, peak, rms: Math.sqrt(squares / (samples * 2)), windows: metrics, sourceLimits: TAVERN_SOUND_LIMITS, peakSources, snapshots } };
}
Object.assign(window, { renderTavernSoundStudy: render });
