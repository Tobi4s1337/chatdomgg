import { describe, expect, it } from 'vitest';
import type { Vec3, VoxelBlueprint } from '../deps';
import type { ApprovedEmoteVisual, EmoteCatalogueView, InlineEmoteVisual } from '../types';
import { createEmoteWeather, emoteWeatherParticles, type EmoteWeatherBatch } from '../render/weather';
import { emoteChatParts, soleEmote } from './parts';
import { createEmoteChatPresentation, EMOTE_CHAT_TUNING as T } from './presentation';
import { playEmoteChatSound } from './sound';

const KINGDOM = '900000000000000001';
const EPOCH = 'sim-stream-1';
const T0 = 1_800_000_000_000;

const blueprint = (id: string, frame: number): VoxelBlueprint => ({
  version: 1, id, styleId: 'hearth' as VoxelBlueprint['styleId'], kind: 'prop', lattice: 'build', size: [12, 16, 2], windows: [],
  boxes: [{ from: [0, 0, 0], to: [12, 8, 2], material: 3 }, { from: [frame, 8, 0], to: [frame + 4, 16, 2], material: 5 }],
});
const effect = (id: string, revision: string, frames = 2): ApprovedEmoteVisual => ({
  id, revision, origin: 'simulated', purpose: 'effect',
  frames: Array.from({ length: frames }, (_, i) => ({ blueprint: blueprint(`fx.${i}`, i * 4), durationMs: frames > 1 ? 100 : 0 })),
  periodMs: frames > 1 ? frames * 100 : 0, mask: { width: 12, height: 16, materialIds: new Uint16Array(12 * 16) },
});
const flat = (id: string, alt: string): InlineEmoteVisual => ({ id, revision: `${'a'.repeat(63)}${id.length % 10}`, origin: 'simulated', alt, mediaType: 'image/gif', bytes: new Uint8Array([71, 73, 70]) });

/** A catalogue with the toad approved flat and as an effect, the frog flat only, everything else unknown. */
function catalogue(overrides: { effects?: Record<string, ApprovedEmoteVisual>; flats?: Record<string, InlineEmoteVisual> } = {}): EmoteCatalogueView & { inlineCalls: number } {
  const effects = overrides.effects ?? { 'twitch.toad': effect('twitch.toad', 'rev-toad-1') };
  const flats = overrides.flats ?? { 'twitch.toad': flat('twitch.toad', 'toadWave'), 'twitch.frog': flat('twitch.frog', 'frogNod'), '7tv.kekw': flat('7tv.kekw', 'KEKW') };
  const view = {
    kingdomId: KINGDOM, revision: 3, checkedAt: T0, health: 'current' as const, inlineCalls: 0,
    resolveApprovedEmote: (id: string, purpose: string) => purpose === 'effect' ? effects[id] ?? null : null,
    resolveInlineEmote: (id: string) => { view.inlineCalls++; const v = flats[id]; return v ? { ...v, bytes: v.bytes.slice() } : null; },
  };
  return view as unknown as EmoteCatalogueView & { inlineCalls: number };
}

let next = 0;
const cue = (slot: number, parts: unknown[], asOf: number, extra: Record<string, unknown> = {}) => ({
  version: 1, id: `cue${(next++).toString(36)}`, kingdomId: KINGDOM, epoch: EPOCH, origin: 'simulated', slot, asOf, expiresAt: asOf + 8_000, parts, ...extra,
});
const toad = { kind: 'emote', id: 'toad', alt: 'toadWave' };
const frog = { kind: 'emote', id: 'frog', alt: 'frogNod' };
const text = (value: string) => ({ kind: 'text', text: value });
const crowd = (count: number): Map<number, Vec3> => new Map(Array.from({ length: count }, (_, slot) => [slot, [slot * 1.5, .5, 4] as Vec3]));
const make = (view = catalogue(), device: 'desktop' | 'phone' = 'desktop') => createEmoteChatPresentation({ kingdomId: KINGDOM, epoch: EPOCH, origin: 'simulated', catalogue: view, device });

describe('Chat parts', () => {
  it('keeps Twitch fragments as catalogue keys and text as text, never guessing Twitch names from words', () => {
    const parts = emoteChatParts([{ kind: 'text', text: 'toadWave hi ' }, { kind: 'emote', id: 'toad', alt: 'toadWave' }]);
    expect(parts).toEqual([{ kind: 'text', text: 'toadWave hi ' }, { kind: 'emote', id: 'twitch.toad', alt: 'toadWave', from: 'fragment' }]);
  });

  it('matches opted-in third-party names exactly, by whole word, never inside URLs, other words or other cases', () => {
    const tokens = new Map([['KEKW', '7tv.kekw']]);
    const parts = emoteChatParts([{ kind: 'text', text: 'KEKW https://x.test/KEKW kekw KEKWW (KEKW) KEKW' }, { kind: 'emote', id: 'toad', alt: 'KEKW' }], tokens);
    expect(parts.filter(p => p.kind === 'emote').map(p => [p.id, p.from])).toEqual([['7tv.kekw', 'token'], ['7tv.kekw', 'token'], ['twitch.toad', 'fragment']]);
    expect(parts.map(p => p.kind === 'text' ? p.text : `[${p.alt}]`).join('')).toBe('[KEKW] https://x.test/KEKW kekw KEKWW (KEKW) [KEKW][KEKW]');
    // Off means off: the same words stay words.
    expect(emoteChatParts([{ kind: 'text', text: 'KEKW' }], null)).toEqual([{ kind: 'text', text: 'KEKW' }]);
    expect(emoteChatParts([{ kind: 'text', text: 'KEKW' }], new Map())).toEqual([{ kind: 'text', text: 'KEKW' }]);
  });

  it('calls a message a sole emote only when it is one emote and optional whitespace', () => {
    const sole = (parts: unknown[]) => soleEmote(emoteChatParts(parts as never))?.alt ?? null;
    expect(sole([toad])).toBe('toadWave');
    expect(sole([text(' '), toad, text('  ')])).toBe('toadWave');
    expect(sole([text('hi '), toad])).toBeNull();
    expect(sole([toad, text(' '), toad])).toBeNull();
    expect(sole([text('   ')])).toBeNull();
  });
});

describe('Chat emotes in the world', () => {
  it('pops a sole emote above a present slot, keeps mixed text as a bubble, and leaves unknown emotes readable', () => {
    const chat = make(), positions = crowd(3);
    expect(chat.receive(cue(0, [toad], T0), T0, positions)).toMatchObject({ status: 'accepted', pop: true, weather: null, sound: { kind: 'pop', slot: 0 } });
    expect(chat.receive(cue(1, [text('look '), toad], T0 + 10), T0 + 10, positions)).toMatchObject({ status: 'accepted', pop: false });
    expect(chat.receive(cue(2, [{ kind: 'emote', id: 'gone', alt: 'goneFish' }], T0 + 20), T0 + 20, positions)).toMatchObject({ status: 'accepted', pop: false });
    const frame = chat.frame(T0 + 400, positions);
    expect(frame.gestures.map(g => [g.slot, g.emote.alt, g.emote.visual.mediaType])).toEqual([[0, 'toadWave', 'image/gif']]);
    expect(frame.gestures[0]!.position).toEqual([0, .5, 4]);
    expect(frame.bubbles.map(b => b.slot)).toEqual([1, 2]);
    expect(frame.bubbles[0]!.parts).toMatchObject([{ kind: 'text', text: 'look ' }, { kind: 'emote', alt: 'toadWave', visual: { mediaType: 'image/gif' } }]);
    // Unknown, unavailable or retired: no image, but the words chat typed.
    expect(frame.bubbles[1]!.parts).toEqual([{ kind: 'emote', id: 'twitch.gone', alt: 'goneFish', from: 'fragment', visual: null }]);
    // The pop rises, then fades, and ends inside the cue's life.
    const late = chat.frame(T0 + T.popMs - 100, positions).gestures[0]!;
    expect(late.lift).toBeGreaterThan(frame.gestures[0]!.lift);
    expect(late.opacity).toBeLessThan(1);
    expect(chat.frame(T0 + T.popMs + 1, positions).gestures).toEqual([]);
  });

  it('passes hostile text through as words: no markup, no URL, no person, no archive', () => {
    const chat = make(), positions = crowd(2);
    const hostile = '<img src=x onerror=alert(1)> </p><script>x()</script> javascript:alert(1)';
    expect(chat.receive(cue(0, [text(hostile)], T0), T0, positions).status).toBe('accepted');
    const [bubble] = chat.frame(T0 + 1, positions).bubbles;
    expect(bubble!.parts).toEqual([{ kind: 'text', text: hostile }]);
    expect(JSON.stringify(bubble)).not.toMatch(/https?:|name|person/i);
    // Malformed shapes never get in: a URL part, a top-level text field, an over-long alt, a wrong kingdom.
    for (const bad of [
      cue(0, [{ kind: 'image', url: 'https://evil.test/x.png' }], T0),
      { ...cue(0, [text('hi')], T0), text: 'hi' },
      cue(0, [{ kind: 'emote', id: 'toad', alt: 'x'.repeat(33) }], T0),
      cue(0, [{ kind: 'emote', id: '../../etc', alt: 'x' }], T0),
    ]) expect(chat.receive(bad, T0, positions)).toEqual({ status: 'rejected', reason: 'invalid' });
    expect(chat.receive(cue(0, [text('hi')], T0, { kingdomId: '900000000000000002' }), T0, positions)).toEqual({ status: 'rejected', reason: 'foreign' });
    expect(chat.receive(cue(0, [text('hi')], T0, { origin: 'live' }), T0, positions)).toEqual({ status: 'rejected', reason: 'foreign' });
  });

  it('refuses duplicate, expired, early and absent cues; an older cue never replaces a newer bubble', () => {
    const chat = make(), positions = crowd(2);
    const first = cue(0, [text('second')], T0 + 500);
    expect(chat.receive(first, T0 + 500, positions).status).toBe('accepted');
    expect(chat.receive(first, T0 + 600, positions)).toEqual({ status: 'rejected', reason: 'duplicate' });
    expect(chat.receive(cue(0, [text('first')], T0), T0 + 600, positions).status).toBe('accepted');
    expect(chat.frame(T0 + 700, positions).bubbles.map(b => b.parts[0])).toEqual([{ kind: 'text', text: 'second' }]);
    expect(chat.receive(cue(1, [text('old')], T0 - 9_000), T0 + 700, positions)).toEqual({ status: 'rejected', reason: 'expired' });
    expect(chat.receive(cue(1, [text('soon')], T0 + 5_000), T0, positions)).toEqual({ status: 'rejected', reason: 'early' });
    // Slot 7 has no body here: no bubble, no pop, no chant share, no invented person.
    expect(chat.receive(cue(7, [toad], T0 + 800), T0 + 800, positions)).toEqual({ status: 'rejected', reason: 'absent' });
    expect(chat.stats().pops).toBe(0);
  });

  it('raises weather only for three different present people in the window, once, then rests the emote', () => {
    const chat = make(), positions = crowd(6);
    // One person spamming is one voice.
    for (let i = 0; i < 20; i++) expect(chat.receive(cue(0, [toad, text(' '), toad], T0 + i * 10), T0 + i * 10, positions)).toMatchObject({ weather: null });
    expect(chat.receive(cue(1, [toad], T0 + 400), T0 + 400, positions)).toMatchObject({ weather: null });
    // A voice outside the window does not count.
    const third = chat.receive(cue(2, [text('yes '), toad], T0 + 6_500), T0 + 6_500, positions);
    expect(third).toMatchObject({ weather: null });
    const fourth = chat.receive(cue(3, [toad], T0 + 6_600), T0 + 6_600, positions);
    expect(fourth).toMatchObject({ status: 'accepted', weather: null });
    const fifth = chat.receive(cue(4, [toad], T0 + 6_700), T0 + 6_700, positions);
    expect(fifth).toMatchObject({ status: 'accepted', weather: `weather.twitch.toad.${T0 + 6_700}`, sound: { kind: 'weather', slot: null } });
    const [weather] = chat.frame(T0 + 7_000, positions).weather;
    expect(weather).toMatchObject({ emoteId: 'twitch.toad', slots: 3, startedAt: T0 + 6_700, endsAt: T0 + 6_700 + T.weatherMs, origin: 'simulated' });
    expect(weather!.particles).toBe(T.particleBase.desktop);
    expect(weather!.spawn).toEqual([2, 3, 4].map(slot => positions.get(slot)));
    // Cooling down: a fresh chant of the same emote waits for the rest, even after the weather ends.
    for (const slot of [0, 1, 2, 5]) chat.receive(cue(slot, [toad], T0 + 19_000 + slot), T0 + 19_000 + slot, positions);
    expect(chat.frame(T0 + 19_100, positions).weather).toEqual([]);
    expect(chat.receive(cue(3, [toad], T0 + 26_800), T0 + 26_800, positions)).toMatchObject({ weather: null });
    for (const slot of [1, 4]) chat.receive(cue(slot, [toad], T0 + 26_900 + slot), T0 + 26_900 + slot, positions);
    expect(chat.frame(T0 + 27_000, positions).weather.map(w => w.slots)).toEqual([3]);
  });

  it('bounds a chant on both sides of a late, out-of-order message', () => {
    const chat = make(), positions = crowd(6);
    // A voice from just ahead of the host's clock arrives before a straggler from 6.1 s earlier: the
    // straggler cannot pull it into a chant that would have started before it spoke.
    chat.receive(cue(0, [toad], T0 + 6_000), T0 + 10_000, positions);
    chat.receive(cue(1, [toad], T0 + 11_400), T0 + 10_000, positions);
    expect(chat.receive(cue(2, [toad], T0 + 5_300), T0 + 10_100, positions)).toMatchObject({ status: 'accepted', weather: null });
    expect(chat.frame(T0 + 10_200, positions).weather).toEqual([]);
    // A straggler inside one window with the voices that came before it starts that chant at itself.
    expect(chat.receive(cue(3, [toad], T0 + 9_000), T0 + 11_600, positions)).toMatchObject({ weather: `weather.twitch.toad.${T0 + 9_000}` });
    expect(chat.frame(T0 + 11_700, positions).weather).toMatchObject([{ startedAt: T0 + 9_000, slots: 3, spawn: [0, 2, 3].map(slot => positions.get(slot)) }]);
    // A straggler that only completes a window with later voices: the chant starts at the newest of them.
    const other = make();
    other.receive(cue(0, [toad], T0 + 6_000), T0 + 10_000, positions);
    other.receive(cue(1, [toad], T0 + 11_400), T0 + 10_000, positions);
    expect(other.receive(cue(2, [toad], T0 + 6_200), T0 + 10_100, positions)).toMatchObject({ weather: `weather.twitch.toad.${T0 + 11_400}` });
    expect(other.frame(T0 + 11_500, positions).weather).toMatchObject([{ startedAt: T0 + 11_400, endsAt: T0 + 11_400 + T.weatherMs, slots: 3 }]);
  });

  it('keeps independent slots honest per emote, needs an approved effect, and caps two motifs', () => {
    const view = catalogue({ effects: { 'twitch.toad': effect('twitch.toad', 'r1'), 'twitch.frog': effect('twitch.frog', 'r2'), 'twitch.fish': effect('twitch.fish', 'r3') } });
    const chat = make(view), positions = crowd(9);
    // The unapproved emote reaches three voices but has no carved effect: no weather.
    for (const slot of [0, 1, 2]) chat.receive(cue(slot, [{ kind: 'emote', id: 'bare', alt: 'bare' }], T0 + slot), T0 + slot, positions);
    expect(chat.frame(T0 + 10, positions).weather).toEqual([]);
    // One message with two emotes counts once toward each.
    for (const slot of [0, 1, 2]) chat.receive(cue(slot, [toad, text(' '), frog], T0 + 100 + slot), T0 + 100 + slot, positions);
    expect(chat.frame(T0 + 200, positions).weather.map(w => w.emoteId).sort()).toEqual(['twitch.frog', 'twitch.toad']);
    for (const slot of [3, 4, 5]) chat.receive(cue(slot, [{ kind: 'emote', id: 'fish', alt: 'fish' }], T0 + 300 + slot), T0 + 300 + slot, positions);
    expect(chat.frame(T0 + 400, positions).weather).toHaveLength(T.maxWeathers);
  });

  it('removes a deleted cue, its pop and its uncounted share; clears slots and epochs completely', () => {
    const chat = make(), positions = crowd(4);
    const a = cue(0, [toad], T0), b = cue(1, [toad], T0 + 10);
    chat.receive(a, T0, positions); chat.receive(b, T0 + 10, positions);
    expect(chat.stats()).toMatchObject({ pops: 2, contributions: 2 });
    expect(chat.removeCue(a.id)).toBe(true);
    expect(chat.frame(T0 + 50, positions).gestures.map(g => g.slot)).toEqual([1]);
    // Redelivery after deletion stays deleted, and the chant now needs a fresh third voice.
    expect(chat.receive(a, T0 + 60, positions)).toEqual({ status: 'rejected', reason: 'duplicate' });
    chat.receive(cue(2, [toad], T0 + 70), T0 + 70, positions);
    expect(chat.frame(T0 + 80, positions).weather).toEqual([]);
    chat.clearSlot(1);
    expect(chat.frame(T0 + 90, positions).gestures.map(g => g.slot)).toEqual([2]);
    chat.receive(cue(3, [toad], T0 + 95), T0 + 95, positions);
    expect(chat.frame(T0 + 100, positions).weather).toEqual([]);
    chat.receive(cue(0, [toad], T0 + 110), T0 + 110, positions);
    expect(chat.frame(T0 + 120, positions).weather).toHaveLength(1);
    chat.clearEpoch({ epoch: 'sim-stream-2' });
    expect(chat.stats()).toEqual({ bubbles: 0, pops: 0, contributions: 0, seen: 0, weather: 0, cooldowns: 0 });
    expect(chat.receive(cue(0, [toad], T0 + 130), T0 + 130, positions)).toEqual({ status: 'rejected', reason: 'foreign' });
    expect(chat.receive(cue(0, [toad], T0 + 130, { epoch: 'sim-stream-2' }), T0 + 130, positions).status).toBe('accepted');
  });

  it('stops weather and pops at once when the catalogue retires the emote, and resolves bytes once per view', () => {
    const view = catalogue(), chat = make(view), positions = crowd(3);
    for (const slot of [0, 1, 2]) chat.receive(cue(slot, [toad], T0 + slot), T0 + slot, positions);
    for (let i = 0; i < 50; i++) chat.frame(T0 + 10 + i, positions);
    expect(view.inlineCalls).toBe(1);
    expect(chat.frame(T0 + 100, positions).weather).toHaveLength(1);
    chat.setCatalogue(catalogue({ effects: {}, flats: {} }));
    const after = chat.frame(T0 + 110, positions);
    expect(after.weather).toEqual([]);
    expect(after.gestures).toEqual([]);
  });

  it('holds bounded state through 50,000 cues and stays deterministic', { timeout: 60_000 }, () => {
    const run = () => {
      const chat = make(catalogue(), 'phone'), positions = crowd(400);
      let accepted = 0, sounds = 0;
      const most = { bubbles: 0, pops: 0, contributions: 0, seen: 0, weather: 0, cooldowns: 0 };
      for (let i = 0; i < 50_000; i++) {
        const at = T0 + i * 3;
        const parts = i % 3 === 0 ? [toad] : i % 3 === 1 ? [text('hi '), frog] : [text(`message ${i}`)];
        const receipt = chat.receive({ ...cue(i % 401, parts, at), id: `burst${i}` }, at, positions);
        if (receipt.status === 'accepted') { accepted++; if (receipt.sound) sounds++; }
        const stats = chat.stats();
        for (const key of Object.keys(most) as (keyof typeof most)[]) most[key] = Math.max(most[key], stats[key]);
      }
      const frame = chat.frame(T0 + 150_000, positions);
      return { accepted, most, sounds, frame: JSON.stringify({ b: frame.bubbles.map(b => [b.cueId, b.slot]), g: frame.gestures.map(g => [g.cueId, g.lift]), w: frame.weather.map(w => [w.id, w.particles, w.seed, w.spawn]) }) };
    };
    const first = run(), second = run();
    expect(first).toEqual(second);
    expect(first.accepted).toBeGreaterThan(49_000);
    expect(first.most.seen).toBeLessThanOrEqual(T.maxSeen);
    expect(first.most.bubbles).toBeLessThanOrEqual(T.maxBubbles);
    expect(first.most.pops).toBeLessThanOrEqual(T.maxPops);
    expect(first.most.contributions).toBeLessThanOrEqual(T.maxContributions);
    expect(first.most.weather).toBeLessThanOrEqual(T.maxWeathers);
    // Pops in a burst share sounds: far fewer sounds than pops.
    expect(first.sounds).toBeLessThan(50_000 / 3 / 10);
  });
});

describe('Chant weather', () => {
  const weatherOf = (particles = 40, spawn: Vec3[] = [[0, 0, 0], [2, 0, 0], [4, 0, 1]]) => ({
    id: 'weather.twitch.toad.1', emoteId: 'twitch.toad', origin: 'simulated' as const, visual: effect('twitch.toad', 'rev-1', 3),
    startedAt: T0, endsAt: T0 + T.weatherMs, slots: 3, particles, spawn, seed: 12345,
  });

  it('writes the same bounded particles for the same caller time, above the chanters, and none outside the weather', () => {
    const weather = weatherOf();
    const a = new Float32Array(40 * 16), b = new Float32Array(40 * 16), fades = new Float32Array(40);
    const count = emoteWeatherParticles(weather, T0 + 3_000, a, fades);
    expect(count).toBeGreaterThan(5);
    expect(emoteWeatherParticles(weather, T0 + 3_000, b)).toBe(count);
    expect(Array.from(a.subarray(0, count * 16))).toEqual(Array.from(b.subarray(0, count * 16)));
    for (let i = 0; i < count; i++) {
      const y = a[i * 16 + 13]!, x = a[i * 16 + 12]!;
      expect(y).toBeGreaterThan(1);
      expect(y).toBeLessThan(10.5);
      expect(x).toBeGreaterThan(-7); expect(x).toBeLessThan(11);
      expect(fades[i]).toBeGreaterThan(0); expect(fades[i]).toBeLessThanOrEqual(1);
      // Uniform scale: about 0.8 m tall from a 2 m carving, so each column's length is near 0.4.
      const scale = Math.hypot(a[i * 16]!, a[i * 16 + 1]!, a[i * 16 + 2]!);
      expect(scale).toBeLessThan(.5);
    }
    expect(emoteWeatherParticles(weather, T0 - 1, a)).toBe(0);
    expect(emoteWeatherParticles(weather, T0 + T.weatherMs, a)).toBe(0);
    // Never more than the output can hold.
    expect(emoteWeatherParticles(weatherOf(200), T0 + 5_000, new Float32Array(10 * 16))).toBeLessThanOrEqual(10);
  });

  it('drives one batch per raining revision on the emote timing and disposes what stops raining', () => {
    const events: string[] = [];
    const host = {
      createBatch: (visual: ApprovedEmoteVisual, capacity: number): EmoteWeatherBatch => {
        events.push(`create ${visual.revision} ${capacity}`);
        return { show: (frame, _m, _f, count) => events.push(`show ${visual.revision} f${frame} n${count > 0}`), hide: () => events.push(`hide ${visual.revision}`), dispose: () => events.push(`dispose ${visual.revision}`) };
      },
    };
    const weather = createEmoteWeather(host, { capacity: 128 });
    const one = weatherOf();
    const stats = weather.update([one], T0 + 150);
    expect(stats).toMatchObject({ batches: 1, motifs: [{ revision: 'rev-1', frame: 1 }] });
    weather.update([one], T0 + 250);
    expect(events).toEqual(['create rev-1 128', 'show rev-1 f1 ntrue', 'show rev-1 f2 ntrue']);
    weather.update([], T0 + 300);
    expect(events.at(-1)).toBe('dispose rev-1');
    weather.update([one], T0 + 400);
    weather.dispose();
    expect(events.filter(e => e.startsWith('create')).length).toBe(2);
    expect(events.at(-1)).toBe('dispose rev-1');
    expect(weather.update([one], T0 + 500)).toEqual({ batches: 0, particles: 0, motifs: [] });
  });

  it('maps a pop and a weather onto the shared sound port, one cue each', () => {
    const cues: unknown[] = [];
    const port = { cue: (kind: string, options?: unknown) => { cues.push([kind, options]); return true; } };
    playEmoteChatSound(port, { kind: 'pop', slot: 3, variant: 1 }, { pan: 4, distance: 12 });
    playEmoteChatSound(port, { kind: 'weather', slot: null, variant: 2 });
    expect(cues).toEqual([['material', { material: 'glass', pan: 1, distance: 12 }], ['wave', {}]]);
  });
});
