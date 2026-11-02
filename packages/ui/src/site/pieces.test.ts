import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FOOTER_LINKS, HOW_IT_WORKS, ICON_PATHS, NEVER_COLLECTED, TWITCH_LINE, escapeHtml, howItWorksSheet, iconSvg, signInSeal, siteFooter, twitchMark, watchOnTwitch,
} from './pieces.mjs';

const img = (key: string, width: number) => `/img/${key}-${width}.webp`;
const words = (text: string) => text.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;

describe('the Twitch mark', () => {
  it('is the official Purple Glitch, byte for byte', () => {
    const file = readFileSync(new URL('./twitch/glitch_flat_purple.svg', import.meta.url));
    expect(createHash('sha256').update(file).digest('hex')).toBe('7d18ac0c4b836855f913d51e88e97cb3cf2e0deabe8b21ef5c744a5dbe40e078');
  });

  it('is an image of the official file inside its plate, decorative unless named', () => {
    const mark = twitchMark({ glitch: '/g.svg' });
    expect(mark).toMatch(/^<span class="cd-twitch" aria-hidden="true"><img class="cd-twitch-glitch" src="\/g\.svg" alt=""/);
    expect(twitchMark({ glitch: '/g.svg', label: 'Twitch' })).toContain('role="img" aria-label="Twitch"');
    expect(() => twitchMark({ glitch: '' })).toThrow();
  });

  it('says "Sign in with Twitch" on the seal and leaves for the given address', () => {
    const seal = signInSeal({ href: '/api/realm/auth/start?returnTo=%2F', glitch: '/g.svg', size: 'header' });
    expect(seal).toContain('data-seal="out"');
    expect(seal).toContain('href="/api/realm/auth/start?returnTo=%2F"');
    expect(seal).toContain('data-size="header"');
    expect(seal).toContain('>Sign in with Twitch<');
  });

  it('opens a real channel on Twitch in a new tab, and refuses anything that is not a login', () => {
    const watch = watchOnTwitch({ login: 'tobi4s_', glitch: '/g.svg' });
    expect(watch).toContain('href="https://www.twitch.tv/tobi4s_"');
    expect(watch).toContain('target="_blank" rel="noopener noreferrer"');
    expect(watch).toContain('opens Twitch in a new tab');
    for (const login of ['', 'Tobi', 'a/b', '"><script>', 'x'.repeat(26)]) expect(() => watchOnTwitch({ login, glitch: '/g.svg' }), login).toThrow();
  });
});

describe('the site footer', () => {
  it('links every legal page and says where the data comes from', () => {
    const footer = siteFooter();
    for (const link of FOOTER_LINKS) expect(footer).toContain(`href="${link.path}"`);
    expect(footer).toContain('Imprint ·&#160;<span lang="de">Impressum</span>');
    expect(footer).toContain(TWITCH_LINE);
    expect(TWITCH_LINE).toBe('Live from Twitch. Chatdom is not affiliated with or endorsed by Twitch.');
    expect(footer).toContain('saartech Solutions UG (haftungsbeschränkt)');
    expect(footer).toContain('data-cd-foot-who hidden');
  });

  it('marks the current page once', () => {
    const footer = siteFooter({ current: 'privacy' });
    expect(footer.match(/aria-current="page"/g)).toHaveLength(1);
    expect(footer).toContain('data-page="privacy" aria-current="page"');
  });

  it('can stand away from chatdom.io without Twitch branding (the panel extension)', () => {
    const footer = siteFooter({ base: 'https://chatdom.io', external: true, twitch: false, compact: true });
    expect(footer).toContain('href="https://chatdom.io/privacy"');
    expect(footer).toContain('target="_blank" rel="noopener"');
    expect(footer).toContain('data-compact');
    expect(footer).not.toMatch(/Twitch|Glitch/);
  });
});

describe('How it works', () => {
  it('tells four panels in at most 40 words each, with every picture described', () => {
    expect(HOW_IT_WORKS).toHaveLength(4);
    for (const panel of HOW_IT_WORKS) {
      expect(words(panel.words), panel.title).toBeLessThanOrEqual(40);
      expect(panel.alt.length).toBeGreaterThan(20);
    }
    const sheet = howItWorksSheet({ img, title: 'A map of all of Twitch', heading: 2, id: 'how' });
    expect(sheet).toContain('<h1 id="how-title" class="cd-hiw-title">A map of all of Twitch</h1>');
    expect(sheet.match(/<h2>/g)).toHaveLength(4);
    expect(sheet).toContain('srcset="/img/read-400.webp 400w, /img/read-640.webp 640w"');
    expect(sheet).toContain('href="/privacy"');
    expect(NEVER_COLLECTED.length).toBe(4);
  });
});

describe('the icon family', () => {
  it('draws door, Atlas, card and panel, and every icon is decorative', () => {
    for (const name of ['door', 'atlas', 'card', 'panel'] as const) expect(ICON_PATHS[name]).toBeTruthy();
    for (const name of Object.keys(ICON_PATHS) as (keyof typeof ICON_PATHS)[]) {
      const svg = iconSvg(name);
      expect(svg).toContain('viewBox="0 0 20 20"');
      expect(svg).toContain('aria-hidden="true"');
      expect(ICON_PATHS[name]).toMatch(/^[MmLlHhVvCcSsAaZz0-9 .,-]+$/);
    }
    expect(() => iconSvg('nope' as never)).toThrow();
  });
});

it('escapes what it writes', () => {
  expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  expect(signInSeal({ href: '/x?a="b"', glitch: '/g.svg' })).toContain('href="/x?a=&quot;b&quot;"');
});
