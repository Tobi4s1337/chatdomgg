// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PORTRAIT_MAX_AGE_MS, portraitUrl } from './portrait';

const now = 1_800_000_000_000;
const url = 'https://static-cdn.jtvnw.net/jtv_user_pictures/123-profile_image-70x70.png';

describe('channel portrait freshness and origin', () => {
  it('returns only a fresh portrait within the 24-hour clock allowance', () => {
    expect(PORTRAIT_MAX_AGE_MS).toBe(86_400_000);
    expect(portraitUrl({ url, freshUntil: now + 1 }, now)).toBe(url);
    expect(portraitUrl({ url, freshUntil: now + PORTRAIT_MAX_AGE_MS + 60_000 }, now)).toBe(url);
    expect(portraitUrl({ url, freshUntil: now }, now)).toBeNull();
    expect(portraitUrl({ url, freshUntil: now - 1 }, now)).toBeNull();
    expect(portraitUrl({ url, freshUntil: now + PORTRAIT_MAX_AGE_MS + 60_001 }, now)).toBeNull();
    expect(portraitUrl(null, now)).toBeNull();
    expect(portraitUrl(undefined, now)).toBeNull();
    expect(portraitUrl({ url, freshUntil: Number.NaN }, now)).toBeNull();
  });

  it('rejects lookalike origins and non-HTTPS sources', () => {
    for (const bad of [
      'http://static-cdn.jtvnw.net/jtv_user_pictures/a.png',
      'https://static-cdn.jtvnw.net.evil.example/jtv_user_pictures/a.png',
      'https://evil.example/static-cdn.jtvnw.net/a.png',
      'data:image/png;base64,AAAA',
      '//static-cdn.jtvnw.net/jtv_user_pictures/a.png',
      'not a url',
    ]) expect(portraitUrl({ url: bad, freshUntil: now + 1 }, now), bad).toBeNull();
  });
});
