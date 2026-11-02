import { describe, expect, it, vi } from 'vitest';
import type { GateReply } from '../../api/src/raid-gate/contracts';
import type { RaidGateApi } from '../../web/src/raid-gate/ports';
import { explainAuthority, guardGateApi, offersRaidGate, raidGateUrl, raidGrantUrl } from './raid-gate';

describe('the Raid Gate press', () => {
  it('is offered to the monarch only', () => {
    expect(offersRaidGate({ principal: { role: 'broadcaster' } })).toBe(true);
    expect(offersRaidGate({ principal: { role: 'moderator' } })).toBe(false);
    expect(offersRaidGate(undefined)).toBe(false);
  });

  it('asks the gate at the kingdom\'s own URL', () => {
    expect(raidGateUrl('129634568')).toBe('/api/raid-gate/129634568');
  });
});

describe('the grant page', () => {
  const origin = 'https://chatdom.gg';
  it('accepts an https address or a path on this site', () => {
    expect(raidGrantUrl('https://herald.chatdom.gg/grant/raids', origin)).toBe('https://herald.chatdom.gg/grant/raids');
    expect(raidGrantUrl(' /herald/grant?scope=raids ', origin)).toBe('/herald/grant?scope=raids');
  });
  it('offers nothing for a missing, insecure or foreign-looking address', () => {
    for (const raw of [undefined, '', '   ', 'http://herald.chatdom.gg/grant', '//evil.example/grant', 'javascript:alert(1)', 'https://user:pw@herald.chatdom.gg/', 42]) {
      expect(raidGrantUrl(raw, origin)).toBeNull();
    }
  });
});

describe('the authority explainer', () => {
  it('offers the reconnect for a missing, withdrawn or switched-off permission when a grant page exists', () => {
    for (const authority of ['not-connected', 'revoked', 'disabled'] as const) {
      const told = explainAuthority(authority, 'Willowmere', true);
      expect(told.heading).toBe('Chatdom needs your Twitch permission');
      expect(told.remedy).toBe('reconnect');
      expect(told.press).toMatch(/on Twitch$/);
      expect(told.body).toContain('Willowmere');
    }
    expect(explainAuthority('revoked', 'Willowmere', true).press).toBe('Renew on Twitch');
  });

  it('names who renews it, with no press, when there is no grant page', () => {
    for (const authority of ['not-connected', 'revoked', 'disabled'] as const) {
      const told = explainAuthority(authority, 'Willowmere', false);
      expect(told.remedy).toBe('keeper');
      expect(told.press).toBeNull();
      expect(told.after).toMatch(/kingdom's keeper renews this permission/);
    }
  });

  it('tells an offline monarch the gate opens while live, and an unknown answer plainly', () => {
    const offline = explainAuthority('offline', 'Willowmere', true);
    expect(offline.heading).toBe('The gate opens while you are live');
    expect(offline.remedy).toBeNull();
    expect(offline.press).toBeNull();
    const unknown = explainAuthority('unavailable', 'Willowmere', true);
    expect(unknown.remedy).toBeNull();
    expect(unknown.body).toContain('Nothing has been sent');
    expect(explainAuthority(null, 'Willowmere', false).remedy).toBeNull();
  });
});

describe('the gate under the throne\'s session rule', () => {
  const reply: GateReply = { kind: 'denied', code: 'unavailable' };
  const api = (): RaidGateApi & { calls: number } => {
    const inner = { origin: 'live' as const, calls: 0,
      request: async () => { inner.calls++; return reply; },
      subscribe: vi.fn() };
    return inner;
  };

  it('applies a reply only when the same session is still signed in', async () => {
    const inner = api();
    const lost = vi.fn();
    const guarded = guardGateApi(inner, async () => 'same', lost);
    expect(guarded.origin).toBe('live');
    expect(await guarded.request({ op: 'gate' }, new AbortController().signal)).toBe(reply);
    expect(lost).not.toHaveBeenCalled();
  });

  it('drops the reply and ends the sheet when the session changed, without asking again', async () => {
    const inner = api();
    const lost = vi.fn();
    const guarded = guardGateApi(inner, async () => 'changed', lost);
    await expect(guarded.request({ op: 'gate' }, new AbortController().signal)).rejects.toThrow();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(inner.calls).toBe(1);
  });

  it('treats an unanswered session check as a lost reply, not a changed person', async () => {
    const inner = api();
    const lost = vi.fn();
    const guarded = guardGateApi(inner, () => Promise.reject(new Error('offline')), lost);
    await expect(guarded.request({ op: 'gate' }, new AbortController().signal)).rejects.toThrow('offline');
    expect(lost).not.toHaveBeenCalled();
    expect(inner.calls).toBe(1);
  });

  it('passes the live gate stream through', () => {
    const inner = api();
    const guarded = guardGateApi(inner, async () => 'same', () => undefined);
    const onReply = () => undefined;
    const signal = new AbortController().signal;
    guarded.subscribe(null, onReply, signal);
    expect(inner.subscribe).toHaveBeenCalledWith(null, onReply, signal);
  });
});
