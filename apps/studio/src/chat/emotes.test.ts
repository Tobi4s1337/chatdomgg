import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../types';
import { crowd } from './crowd';
import { EMOTE_LIST, EMOTES } from './emotes';
import { badgesInUse, cast, PINKKITTYROSE } from './roster';
import { announce, fragments, gift, raid, say, sub } from './say';

// The media folder lives outside git; on a machine without it (CI) the file checks are skipped.
const MEDIA = process.env.TEASER_MEDIA ?? '/srv/chatdom/media/teaser';
const hasMedia = existsSync(join(MEDIA, 'reference/emotes'));

describe('emote vocabulary', () => {
  it('has unique codes and ids, and leaves out emotes that are not global', () => {
    expect(new Set(EMOTE_LIST.map((e) => e.code)).size).toBe(EMOTE_LIST.length);
    expect(new Set(EMOTE_LIST.map((e) => e.id)).size).toBe(EMOTE_LIST.length);
    for (const notGlobal of ['KEKW', 'OMEGALUL', 'Pog', 'monkaS', 'PepeHands', 'BibleThump']) expect(EMOTES[notGlobal]).toBeUndefined();
    for (const staple of ['LUL', 'Kappa', 'PogChamp', 'SeemsGood', 'HeyGuys', 'VoHiYo', '<3', 'CoolCat', 'twitchRaid']) expect(EMOTES[staple]?.owner).toBe('global');
  });

  it.skipIf(!hasMedia)('has a downloaded image for every emote, and for every emote the crowd used', () => {
    for (const e of EMOTE_LIST) expect(existsSync(join(MEDIA, 'reference/emotes', `${e.id}.png`)), e.code).toBe(true);
    const used = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const items = crowd({
        seed, start: -20, end: 60, scripted: [raid(30)],
        beats: [
          { at: 0, duration: 10, mood: 'greet' }, { at: 10, duration: 8, mood: 'hype' }, { at: 18, duration: 6, mood: 'emote-wave', emote: 'PopNemo' },
          { at: 24, duration: 6, mood: 'forge' }, { at: 30, duration: 14, mood: 'raid-welcome' }, { at: 44, duration: 6, mood: 'awe' }, { at: 50, duration: 10, mood: 'farewell' },
        ],
      });
      for (const i of items) {
        const frags = i.kind === 'message' || i.kind === 'announcement' ? i.fragments : i.kind === 'sub' ? (i.fragments ?? []) : [];
        for (const f of frags) if (f.kind === 'emote') used.add(f.id);
      }
    }
    expect(used.size).toBeGreaterThan(10);
    for (const id of used) expect(existsSync(join(MEDIA, 'reference/emotes', `${id}.png`)), id).toBe(true);
  });

  it.skipIf(!hasMedia)('has a downloaded image for every badge and both avatars', () => {
    for (const b of badgesInUse()) expect(existsSync(join(MEDIA, 'reference/badges', `${b.set}-${b.version}.png`)), `${b.set}-${b.version}`).toBe(true);
    expect(existsSync(join(MEDIA, 'reference/avatars/pinkkittyrose.png'))).toBe(true);
    expect(existsSync(join(MEDIA, 'reference/avatars/me.png'))).toBe(true);
  });
});

describe('hero-line helpers', () => {
  it('splits text into text, emote and mention fragments the way Twitch does', () => {
    expect(fragments('LUL that @Funkenflug_Jo, a DRAGON <3')).toEqual([
      { kind: 'emote', id: '425618', code: 'LUL' },
      { kind: 'text', text: ' that ' },
      { kind: 'mention', login: 'funkenflug_jo' },
      { kind: 'text', text: ', a DRAGON ' },
      { kind: 'emote', id: '9', code: '<3' },
    ]);
    // Emote codes are case-sensitive and whole words only.
    expect(fragments('lul KappaKappa')).toEqual([{ kind: 'text', text: 'lul KappaKappa' }]);
  });

  it('writes the S02 and S10 hero lines', () => {
    const first = say(3.2, 'lurker', 'been lurking for 4 years. first time chatting 👋', { firstTime: true });
    expect(first).toMatchObject({ kind: 'message', at: 3.2, from: cast.lurker, highlight: 'first-time', fragments: [{ kind: 'text', text: 'been lurking for 4 years. first time chatting 👋' }] });
    const wish = say(12, cast.forger, '!forge a chimney shaped like a sleeping dragon');
    expect(wish.from.login).toBe(cast.forger.login);
    expect(say(12, cast.forger, '!forge a chimney shaped like a sleeping dragon').id).toBe(wish.id);
  });

  it('writes replies with Twitch\'s leading mention', () => {
    const parent = say(1, 'mod1', 'that is the old quarter');
    const reply = say(3, 'vip', 'yes the first houses', { reply: parent });
    expect(reply.reply).toEqual({ to: cast.mod1, text: 'that is the old quarter' });
    expect(reply.fragments[0]).toEqual({ kind: 'mention', login: cast.mod1.login });
  });

  it('writes notices', () => {
    expect(raid(52)).toMatchObject({ kind: 'raid', viewers: 48, from: { login: 'pinkkittyrose', display: 'PinkKittyRose', avatar: PINKKITTYROSE.avatar } });
    expect(sub(5, 'kartoffelkiste_7')).toMatchObject({ kind: 'sub', months: 14, tier: 1 });
    expect(sub(5, 'kartoffelkiste_7', { months: 15, prime: true, text: 'still here <3' }).fragments?.[1]).toEqual({ kind: 'emote', id: '9', code: '<3' });
    expect(gift(6, 'css_hexe', 5)).toMatchObject({ kind: 'gift', count: 5, tier: 1 });
    expect((announce(7, 'mod2', 'welcome raiders!', 'purple') as Extract<ChatItem, { kind: 'announcement' }>).accent).toBe('purple');
    expect(() => say(1, 'nobody_here_at_all', 'hi')).toThrow(/unknown chatter/);
  });
});
