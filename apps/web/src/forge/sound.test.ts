import { describe, expect, it, vi } from 'vitest';
import { PHRASE_LIMITS, renderKingdomAudio, type KingdomPhrase, type PhraseVoice } from '@chatdom/audio';
import { FORGE_STAGE_TIMING } from '@chatdom/forge';
import { playForgeSound, renderForgeRitualAudio } from './sound';

vi.mock('@chatdom/audio', async importOriginal => ({
  ...await importOriginal<typeof import('@chatdom/audio')>(),
  renderKingdomAudio: vi.fn(),
}));

function authoredSources(phrase: KingdomPhrase, variation: number) {
  const sources: { start: number; stop: number }[] = [];
  const node = { connect: () => node, gain: {} };
  const source = (_kind: unknown, _frequency: number, start: number, stop: number) => {
    sources.push({ start, stop }); return node;
  };
  const voice = {
    t: 10, out: node, room: 0, gain: () => node, filter: () => node, chain: () => node,
    envelope: () => undefined, osc: source,
    noise: (start: number, stop: number) => source('noise', 0, start, stop),
  } as unknown as PhraseVoice;
  phrase.build(voice, variation);
  return sources;
}

describe('Forge sound bridge', () => {
  it('keeps every audible phase and refusal within one shared-engine phrase budget', () => {
    const phrases: KingdomPhrase[] = [];
    const output = { phrase: (phrase: KingdomPhrase) => { phrases.push(phrase); return true; } };
    for (const [phase] of FORGE_STAGE_TIMING) expect(playForgeSound(output, phase)).toBe(true);
    expect(playForgeSound(output, 'refusal')).toBe(true);
    expect(playForgeSound(null, 'words')).toBe(false);
    expect(phrases.map(phrase => phrase.key)).toEqual([
      ...FORGE_STAGE_TIMING.map(([phase]) => `forge:${phase}`), 'forge:refusal',
    ]);
    for (const phrase of phrases) for (let variation = 0; variation < phrase.variations!; variation++) {
      const sources = authoredSources(phrase, variation);
      expect(sources.length).toBeGreaterThan(0);
      expect(sources.length).toBeLessThanOrEqual(PHRASE_LIMITS.sources);
      for (const { start, stop } of sources) {
        expect(start).toBeGreaterThanOrEqual(10);
        expect(stop).toBeGreaterThan(start);
        expect(stop).toBeLessThanOrEqual(10 + PHRASE_LIMITS.seconds);
      }
    }
  });

  it('renders the same live phase objects at the ritual timings and writes interleaved stereo PCM', async () => {
    const live: KingdomPhrase[] = [];
    for (const [phase] of FORGE_STAGE_TIMING) {
      playForgeSound({ phrase: phrase => { live.push(phrase); return true; } }, phase);
    }
    vi.mocked(renderKingdomAudio).mockResolvedValueOnce({
      buffer: {
        numberOfChannels: 2, sampleRate: 48000, length: 2,
        getChannelData: (channel: number) => channel === 0 ? Float32Array.of(0.5, -1) : Float32Array.of(-0.5, 1),
      } as AudioBuffer,
      played: FORGE_STAGE_TIMING.map(([phase, at]) => ({ at, cue: `phrase:forge:${phase}`, played: true })),
    });
    const wav = Uint8Array.from(await renderForgeRitualAudio());
    const [script, options] = vi.mocked(renderKingdomAudio).mock.calls.at(-1)!;
    expect(script.map(step => step.at)).toEqual(FORGE_STAGE_TIMING.map(([, at]) => at));
    expect(script.map(step => 'phrase' in step ? step.phrase : null)).toEqual(live);
    expect(options).toMatchObject({ duration: 22, sampleRate: 48000 });
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(28, true)).toBe(192000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([44, 46, 48, 50].map(offset => view.getInt16(offset, true))).toEqual([16383, -16384, -32768, 32767]);
  });

  it('fails an incomplete offline soundtrack instead of returning fake audio', async () => {
    vi.mocked(renderKingdomAudio).mockResolvedValueOnce({ buffer: {} as AudioBuffer, played: [] });
    await expect(renderForgeRitualAudio()).rejects.toThrow('every ritual phase');
  });
});
