import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cast, chatter, displayName, locals, raiders, roster, subscriberBadge } from './roster';

const here = dirname(fileURLToPath(import.meta.url));

describe('roster', () => {
  it('is a community of about 120 invented people with unique, valid logins', () => {
    expect(roster.length).toBeGreaterThanOrEqual(110);
    expect(roster.length).toBeLessThanOrEqual(130);
    expect(new Set(roster.map((p) => p.login)).size).toBe(roster.length);
    for (const p of roster) {
      expect(p.login).toMatch(/^[a-z0-9][a-z0-9_]{3,24}$/);
      // Twitch lets the display name differ from the login only in letter case.
      expect(p.display.toLowerCase()).toBe(p.login);
      expect(p.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('never includes the real channels', () => {
    for (const real of ['tobi4s_', 'pinkkittyrose', 'the_aggman', 'mashad4']) expect(roster.map((p) => p.login)).not.toContain(real);
  });

  it('has badges in realistic proportions and no staff or partner badges', () => {
    const count = (set: string) => roster.filter((p) => p.badges.some((b) => b.set === set)).length;
    expect(roster.filter((p) => p.badges.length === 0).length / roster.length).toBeGreaterThan(0.4);
    expect(count('moderator')).toBeGreaterThanOrEqual(2);
    expect(count('moderator')).toBeLessThanOrEqual(3);
    expect(count('vip')).toBeGreaterThanOrEqual(1);
    expect(count('vip')).toBeLessThanOrEqual(2);
    expect(count('founder')).toBeGreaterThanOrEqual(1);
    expect(count('founder')).toBeLessThanOrEqual(2);
    expect(count('subscriber')).toBeGreaterThan(15);
    expect(count('bits')).toBeGreaterThan(5);
    expect(count('premium')).toBeGreaterThan(5);
    for (const banned of ['staff', 'partner', 'admin', 'global_mod', 'broadcaster']) expect(count(banned)).toBe(0);
    // Sub months vary.
    expect(new Set(roster.filter((p) => p.months > 0).map((p) => p.months)).size).toBeGreaterThan(12);
    // Nobody shows two subscriber-type badges or more than one chosen global badge.
    for (const p of roster) {
      expect(p.badges.filter((b) => b.set === 'subscriber' || b.set === 'founder').length).toBeLessThanOrEqual(1);
      expect(p.badges.filter((b) => ['premium', 'twitch-recap-2025', 'no_audio'].includes(b.set)).length).toBeLessThanOrEqual(1);
    }
    // Raiders are guests: no tobi4s_ channel badges.
    for (const r of raiders) expect(r.badges.some((b) => ['subscriber', 'founder', 'moderator', 'vip', 'sub-gifter'].includes(b.set))).toBe(false);
  });

  it('maps sub months onto Twitch\'s default badge ladder', () => {
    expect([1, 2, 3, 5, 6, 9, 11, 12, 41].map((m) => subscriberBadge(m).version)).toEqual(['0', '2', '3', '3', '4', '5', '5', '6', '6']);
  });

  it('names the cast the shots use', () => {
    expect(cast.lurker.chattiness).toBe(0);
    expect(cast.lurker.badges).toEqual([]);
    expect(cast.me.chattiness).toBe(0);
    expect(cast.me.avatar).toMatch(/\.png$/);
    expect(cast.mod1.badges[0]).toEqual({ set: 'moderator', version: '1' });
    expect(cast.mod2.badges[0]).toEqual({ set: 'moderator', version: '1' });
    expect(cast.vip.badges[0]).toEqual({ set: 'vip', version: '1' });
    expect(cast.regulars.length).toBeGreaterThanOrEqual(6);
    expect(cast.regulars.length).toBeLessThanOrEqual(10);
    expect(cast.broadcaster.badges).toEqual([{ set: 'broadcaster', version: '1' }]);
    expect(cast.pinkkittyrose.viewers).toBe(48);
    expect(locals.map((p) => p.login)).toContain(cast.forger.login);
    expect(chatter('@Tobi4s_')?.login).toBe('tobi4s_');
    expect(displayName('pinkkittyrose')).toBe('PinkKittyRose');
  });

  it('agrees with the name check: every invented login came back absent from Helix', () => {
    const checked = JSON.parse(readFileSync(join(here, 'names-checked.json'), 'utf8')) as { checkedAt: string; logins: { login: string; absent: boolean; checkedAt: string }[] };
    const byLogin = new Map(checked.logins.map((l) => [l.login, l]));
    for (const p of roster) {
      const entry = byLogin.get(p.login);
      expect(entry, `${p.login} has not been name-checked`).toBeDefined();
      expect(entry?.absent, `${p.login} exists on Twitch`).toBe(true);
      expect(Number.isNaN(Date.parse(entry?.checkedAt ?? ''))).toBe(false);
    }
  });
});
