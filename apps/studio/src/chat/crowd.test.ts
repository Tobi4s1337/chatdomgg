import { describe, expect, it } from 'vitest';
import type { ChatItem, CrowdScript } from '../types';
import { crowd } from './crowd';
import { emote } from './emotes';
import { cast, raiders, type Person } from './roster';
import { plainText, raid, say } from './say';

const night: CrowdScript = {
  seed: 'test-night',
  start: -30,
  end: 60,
  scripted: [
    say(4, 'lurker', 'been lurking for 4 years. first time chatting 👋', { firstTime: true }),
    say(18, 'forger', '!forge a chimney shaped like a sleeping dragon'),
    raid(40),
  ],
  beats: [
    { at: 0, duration: 4, mood: 'trickle' },
    { at: 4, duration: 8, mood: 'greet' },
    { at: 12, duration: 6, mood: 'awe', topic: 'windows lighting up' },
    { at: 19, duration: 8, mood: 'forge', topic: 'dragon chimney' },
    { at: 27, duration: 6, mood: 'emote-wave', emote: 'LUL' },
    { at: 33, duration: 7, mood: 'hype' },
    { at: 40, duration: 14, mood: 'raid-welcome' },
    { at: 54, duration: 6, mood: 'farewell' },
  ],
};

const messages = (items: readonly ChatItem[]) => items.filter((i): i is Extract<ChatItem, { kind: 'message' }> => i.kind === 'message');
const scriptedIds = new Set(night.scripted.map((i) => i.id));
const generated = (items: readonly ChatItem[]) => items.filter((i) => !scriptedIds.has(i.id));

describe('crowd', () => {
  it('is deterministic for a seed', () => {
    expect(JSON.stringify(crowd(night))).toBe(JSON.stringify(crowd(night)));
  });

  it('differs for a different seed', () => {
    const a = crowd(night).map((i) => `${i.at.toFixed(3)} ${i.kind === 'message' ? plainText(i.fragments) : i.kind}`);
    const b = crowd({ ...night, seed: 'another-night' }).map((i) => `${i.at.toFixed(3)} ${i.kind === 'message' ? plainText(i.fragments) : i.kind}`);
    expect(a).not.toEqual(b);
  });

  it('returns items sorted by time with unique ids, inside the shot range', () => {
    const items = crowd(night);
    for (let i = 1; i < items.length; i++) expect((items[i] as ChatItem).at).toBeGreaterThanOrEqual((items[i - 1] as ChatItem).at);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of generated(items)) {
      expect(i.at).toBeGreaterThanOrEqual(night.start);
      expect(i.at).toBeLessThanOrEqual(night.end);
    }
  });

  it('keeps every scripted item exactly as given', () => {
    const items = crowd(night);
    for (const s of night.scripted) expect(items).toContainEqual(s);
  });

  it('pre-fills the backlog before t = 0', () => {
    const before = crowd(night).filter((i) => i.at < 0);
    // About one line every five seconds over the 30 s backlog.
    expect(before.length).toBeGreaterThanOrEqual(3);
    expect(before.length).toBeLessThanOrEqual(14);
  });

  it('bursts a beat after a hype moment, then decays', () => {
    // Messages per second, averaged over many seeds: before the moment, in its first second,
    // 1 to 4 s after it, and once it has passed.
    const windows = { before: [14, 20], first: [20, 21], peak: [21, 24], after: [30, 34] } as const;
    const totals = { before: 0, first: 0, peak: 0, after: 0 };
    const seeds = 24;
    for (let s = 0; s < seeds; s++) {
      const items = crowd({ seed: `burst-${s}`, start: 0, end: 40, scripted: [], beats: [{ at: 20, duration: 14, mood: 'hype', rate: 3 }] });
      for (const key of Object.keys(windows) as (keyof typeof windows)[]) {
        const [a, z] = windows[key];
        totals[key] += items.filter((i) => i.at >= a && i.at < z).length / (z - a) / seeds;
      }
    }
    expect(totals.peak).toBeGreaterThan(1.5);
    expect(totals.peak).toBeGreaterThan(totals.before * 4);
    expect(totals.peak).toBeGreaterThan(totals.first * 2);
    expect(totals.after).toBeLessThan(totals.peak * 0.6);
    expect(totals.after).toBeGreaterThan(totals.before * 0.5);
  });

  it('leaves silence where a beat has rate 0', () => {
    const items = crowd({ seed: 'quiet', start: 0, end: 30, scripted: [say(12, 'forger', '!forge a chimney shaped like a sleeping dragon')], beats: [{ at: 0, duration: 8, mood: 'hype' }, { at: 10, duration: 6, mood: 'trickle', rate: 0 }] });
    expect(items.filter((i) => i.at >= 10 && i.at < 16).map((i) => i.id)).toEqual([items.find((i) => i.at === 12)?.id]);
  });

  it('never lets the lurker or the viewer speak on their own, and never uses the word simulated or the product name', () => {
    for (const seed of ['a', 'b', 'c']) {
      for (const m of messages(generated(crowd({ ...night, seed })))) {
        expect([cast.lurker.login, cast.me.login, cast.broadcaster.login]).not.toContain(m.from.login);
        expect(plainText(m.fragments).toLowerCase()).not.toMatch(/simulated|chatdom/);
      }
    }
  });

  it('keeps channel emotes with their people', () => {
    const raiderLogins = new Set(raiders.map((r) => r.login));
    for (const seed of ['a', 'b', 'c', 'd']) {
      for (const m of messages(generated(crowd({ ...night, seed })))) {
        for (const f of m.fragments) {
          if (f.kind !== 'emote') continue;
          const def = emote(f.code);
          expect(def?.id).toBe(f.id);
          if (def?.owner === 'pinkkittyrose') expect(raiderLogins.has(m.from.login)).toBe(true);
          if (def?.owner === 'tobi4s_') expect((m.from as Person).months).toBeGreaterThan(0);
          expect(['the_aggman', 'mashad4']).not.toContain(def?.owner);
        }
      }
    }
  });

  it('brings raiders in only with the raid, and they paste the raid message', () => {
    const items = messages(crowd(night));
    const raiderLines = items.filter((m) => (m.from as Partial<Person>).crew === 'raider');
    expect(raiderLines.length).toBeGreaterThan(4);
    for (const m of raiderLines) expect(m.at).toBeGreaterThan(39.5);
    expect(raiderLines.some((m) => plainText(m.fragments).includes('PINKKITTYROSE RAID'))).toBe(true);
  });

  it('welcomes a first-time chatter', () => {
    const welcomes = messages(crowd(night)).filter((m) => m.at > 4 && m.at < 12 && (m.reply?.to.login === cast.lurker.login || m.fragments.some((f) => f.kind === 'mention' && f.login === cast.lurker.login)));
    expect(welcomes.length).toBeGreaterThanOrEqual(1);
  });

  it('only replies to lines that were already on screen', () => {
    for (const seed of ['a', 'b', 'c']) {
      const items = messages(crowd({ ...night, seed }));
      const replies = items.filter((m) => m.reply);
      expect(replies.length).toBeGreaterThan(0);
      for (const r of replies) {
        const parent = items.find((m) => m.from.login === r.reply?.to.login && plainText(m.fragments) === r.reply?.text);
        expect(parent, `parent of "${plainText(r.fragments)}"`).toBeDefined();
        expect((parent as { at: number }).at).toBeLessThan(r.at);
        expect(r.fragments[0]).toEqual({ kind: 'mention', login: r.reply?.to.login });
      }
    }
  });

  it('reads as people: emote spam, mentions, varied senders, no one talking over themselves', () => {
    const items = messages(generated(crowd(night)));
    const wave = items.filter((m) => m.at >= 27 && m.at < 33);
    expect(wave.filter((m) => m.fragments.some((f) => f.kind === 'emote' && f.code === 'LUL')).length).toBeGreaterThanOrEqual(4);
    expect(items.some((m) => !m.reply && m.fragments.some((f) => f.kind === 'mention'))).toBe(true);
    expect(new Set(items.map((m) => m.from.login)).size).toBeGreaterThan(25);
    // Gaps between lines are uneven, not a metronome.
    const gaps = items.slice(1).map((m, i) => m.at - (items[i] as { at: number }).at);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    expect(sd / mean).toBeGreaterThan(0.5);
  });

  it('rejects an emote wave with an unknown emote code', () => {
    expect(() => crowd({ seed: 'x', start: 0, end: 10, scripted: [], beats: [{ at: 0, duration: 10, mood: 'emote-wave', emote: 'KEKW' }] })).toThrow(/KEKW/);
  });
});
