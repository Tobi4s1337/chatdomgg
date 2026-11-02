import { describe, expect, it } from 'vitest';
import { gateHref, hostOf } from './gate';

const twitch = { pathname: '/panel.html', origin: 'https://abc123.ext-twitch.tv' };

describe('the panel walk link', () => {
  it("follows the realm's full walk address and names its site", () => {
    const walk = 'https://chatdom.io/?walk=1&kingdom=129634568';
    expect(gateHref(walk, twitch)).toBe(walk);
    expect(hostOf(walk, twitch)).toBe('chatdom.io');
  });
  it('fills a bare path in on chatdom.io, never a site that does not answer', () => {
    expect(gateHref('/?walk=1&kingdom=129634568', twitch)).toBe('https://chatdom.io/?walk=1&kingdom=129634568');
    expect(hostOf('/kingdom/129634568', twitch)).toBe('chatdom.io');
  });
  it('stays on the same app when the panel is reviewed at /panel', () => {
    expect(gateHref('/?walk=1', { pathname: '/panel', origin: 'http://127.0.0.1:5190' })).toBe('http://127.0.0.1:5190/?walk=1');
  });
});
