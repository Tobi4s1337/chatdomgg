import { describe, expect, it } from 'vitest';
import { mapPath, readLogin } from './find';

describe('finding a channel', () => {
  it('reads names, @names and channel links', () => {
    expect(readLogin('tobi4s_')).toBe('tobi4s_');
    expect(readLogin('  Tobi4s_ ')).toBe('tobi4s_');
    expect(readLogin('@PinkKittyRose')).toBe('pinkkittyrose');
    expect(readLogin('https://www.twitch.tv/the_aggman')).toBe('the_aggman');
    expect(readLogin('twitch.tv/mashad4/videos')).toBe('mashad4');
    expect(mapPath('tobi4s_')).toBe('/map/tobi4s_');
  });

  it('refuses what cannot be a Twitch name', () => {
    for (const typed of ['', '   ', 'two words', 'ünïcode', 'a'.repeat(26), '../etc', 'name?x=1', 'https://example.com/x']) expect(readLogin(typed), typed).toBeNull();
  });
});
