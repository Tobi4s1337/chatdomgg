// Reference capture of the real Twitch channel page, for the studio's page replica.
//
// Logged out and read only. The recorder never clicks or types on twitch.tv and never posts anything: it opens
// the page, waits, scrolls the main column with a script (nothing is sent to Twitch), takes screenshots and reads
// boxes and computed styles. Banners that cover the page are hidden with a style injected on our side.
//
//   nice -n 19 node --env-file=$HOME/.config/chatdom/atlas.env apps/studio/rig/reference-capture.mjs
//     [--channel <login>]   the live layout reference (default: a small English channel live right now)
//     [--only offline|live] capture one page only
//     [--skip-assets]       don't fetch the avatar, badges and emotes again
//     [--assets-only]       only fetch the avatars, badges and emotes
//     [--local-only]        only rebuild reference/fonts/fonts.css and reference/icons/icons.json from the saved capture
//     [--settle <s>]        seconds the live page settles before the capture, so chat fills (default 90)
//
// Everything lands in the media folder (never in git): reference/<name>@<w>x<h>[@2x].png, reference/<name>.json
// (curated measurements), reference/<name>.dump.json (every visible element with its box and computed style),
// reference/css/ (Twitch's stylesheets, to read exact values), reference/fonts/, reference/icons/,
// reference/badges/, reference/emotes/, reference/avatars/.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

const MEDIA = process.env.CHATDOM_TEASER_MEDIA ?? '/srv/chatdom/media/teaser';
const OUT = join(MEDIA, 'reference');
for (const dir of ['', 'css', 'fonts', 'icons', 'badges', 'emotes', 'avatars']) mkdirSync(join(OUT, dir), { recursive: true });

const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf(name); return at >= 0 ? (args[at + 1] ?? '') : null; };
const only = flag('--only');
const CONSENTING = ['the_aggman', 'pinkkittyrose', 'mashad4'];
const DEFAULT_AVATARS = ['ce57700a-def9-11e9-842d-784f43822e80', '998f01ae-def8-11e9-b95c-784f43822e80', '13e5fa74-defa-11e9-809c-784f43822e80',
  '215b7342-def9-11e9-9a66-784f43822e80', 'cdd517fe-def4-11e9-948e-784f43822e80', '294c98b5-e34d-42cd-a8f0-140b72fba9b0',
  'ead5c8b2-a4c9-4724-b1dd-9f00b46cbd3d', '41780b5a-def8-11e9-94d9-784f43822e80', 'dbdc9198-def8-11e9-8681-784f43822e80',
  '75305d54-c7cc-40d1-bb9c-91fbe85943c7', 'de130ab0-def7-11e9-b668-784f43822e80', 'ebe4cd89-b4f4-4cd9-adac-2f30151b4209'];
const TOBI_AVATAR = 'https://static-cdn.jtvnw.net/jtv_user_pictures/ac103f41-a845-4258-bb68-eb5e0c776af3-profile_image-300x300.png';

// ---------------------------------------------------------------- Helix (read only, app token)
async function helixToken() {
  const id = process.env.TWITCH_CLIENT_ID, secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Load the Twitch credentials with node --env-file=~/.config/chatdom/atlas.env');
  const res = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST',
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }) });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return { id, token: (await res.json()).access_token };
}
async function helix(auth, path) {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: { 'Client-Id': auth.id, Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) throw new Error(`helix ${path.split('?')[0]}: ${res.status}`);
  return res.json();
}

/** Small English channels live right now with no content labels, best first (a layout reference only). */
async function liveCandidates(auth) {
  const found = [];
  let cursor = '';
  for (let page = 0; page < 40; page++) {
    const body = await helix(auth, `streams?language=en&type=live&first=100${cursor ? `&after=${cursor}` : ''}`);
    for (const s of body.data) if (s.viewer_count >= 150 && s.viewer_count <= 1500 && !s.is_mature) found.push(s);
    cursor = body.pagination?.cursor ?? '';
    const last = body.data.at(-1);
    if (!cursor || !last || last.viewer_count < 150 || found.length >= 300) break;
  }
  const info = new Map();
  for (let i = 0; i < found.length; i += 100) {
    const ids = found.slice(i, i + 100).map(s => `broadcaster_id=${s.user_id}`).join('&');
    for (const c of (await helix(auth, `channels?${ids}`)).data) info.set(c.broadcaster_id, c);
  }
  return found.filter(s => (info.get(s.user_id)?.content_classification_labels ?? []).length === 0 && s.tags?.length)
    .sort((a, b) => b.viewer_count - a.viewer_count);
}

async function download(url, file) {
  if (existsSync(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** tobi4s_'s avatar plus Twitch's global badges and a few global emotes, for the replica and its sample. */
async function fetchAssets(auth) {
  await download(TOBI_AVATAR, join(OUT, 'avatars', 'tobi4s_.png'));
  // The consenting Genesis channels by their real avatars; everyone else (invented) wears one of Twitch's defaults.
  const users = await helix(auth, `users?${CONSENTING.map(l => `login=${l}`).join('&')}`);
  for (const u of users.data) await download(u.profile_image_url.replace('300x300', '150x150'), join(OUT, 'avatars', `${u.login}.png`)).catch(() => {});
  for (const [i, id] of DEFAULT_AVATARS.entries()) {
    await download(`https://static-cdn.jtvnw.net/user-default-pictures-uv/${id}-profile_image-150x150.png`, join(OUT, 'avatars', `default-${i}.png`)).catch(() => {});
  }
  const badges = await helix(auth, 'chat/badges/global');
  const index = {};
  for (const set of badges.data) for (const v of set.versions) {
    index[`${set.set_id}/${v.id}`] = v.title;
    // Only the sets a chat line normally shows: the rest stay on demand.
    if (['broadcaster', 'moderator', 'vip', 'subscriber', 'premium', 'turbo', 'partner', 'verified', 'staff', 'glhf-pledge',
      'sub-gifter', 'bits', 'founder', 'no_audio', 'no_video', 'artist-badge', 'twitch-recap-2024', 'clips-leader'].includes(set.set_id)) {
      await download(v.image_url_4x, join(OUT, 'badges', `${set.set_id}-${v.id}.png`)).catch(() => {});
    }
  }
  writeFileSync(join(OUT, 'badges', 'global.json'), JSON.stringify(badges.data, null, 1));
  const emotes = await helix(auth, 'chat/emotes/global');
  writeFileSync(join(OUT, 'emotes', 'global.json'), JSON.stringify(emotes.data.map(e => ({ id: e.id, name: e.name, format: e.format })), null, 1));
  const wanted = ['Kappa', 'LUL', 'PogChamp', 'KEKW', 'HeyGuys', 'PopNemo', 'BibleThump', 'Kreygasm', 'SeemsGood', 'VoHiYo', 'CoolCat',
    'TwitchUnity', '<3', 'PJSalt', 'CoolStoryBob', 'NotLikeThis', 'DinoDance', 'GlitchCat', 'TwitchConHYPE', 'HSWP', 'PopCorn', 'Jebaited',
    'BloodTrail', 'ResidentSleeper', 'FBtouchdown', 'StinkyGlitch', 'GoldPLZ', 'TPFufun', 'MercyWing1', 'MercyWing2', 'SUBprise', 'TwitchLit'];
  for (const e of emotes.data) if (wanted.includes(e.name)) {
    await download(`https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/static/dark/2.0`, join(OUT, 'emotes', `${e.id}.png`)).catch(() => {});
  }
}

/**
 * Twitch's own Latin web fonts (Inter and Roobert) for local rendering, with a fonts.css that declares them the way
 * Twitch does. Read from the stylesheets the capture saved; local only, never committed and never served publicly.
 */
async function localFonts() {
  const faces = [];
  for (const file of readdirSync(join(OUT, 'css'))) {
    const css = readFileSync(join(OUT, 'css', file), 'utf8');
    for (const [rule] of css.matchAll(/@font-face\{[^}]*\}/g)) {
      const src = rule.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
      if (!src || !/(Roobert-|inter-latin-(ext-)?variable)/.test(src)) continue;
      const name = src.split('/').pop();
      if (faces.some(f => f.rule === rule)) continue;
      await download(src, join(OUT, 'fonts', name));
      faces.push({ rule, css: rule.replace(/src:[^;}]+/, `src:url(./${name}) format("woff2")`) });
    }
  }
  if (faces.length) writeFileSync(join(OUT, 'fonts', 'fonts.css'), `/* Twitch's Latin web fonts, as Twitch declares them. Local rendering only. */\n${faces.map(f => f.css).join('\n')}\n`);
  return faces.length;
}

/** The icons the replica draws, picked from the captured SVGs by label or by a piece of their path. */
const ICONS = {
  logo: i => i.label === 'Twitch Home', kebab: i => i.label === 'More Options', search: i => i.label === 'Search Button',
  prime: i => i.label === 'Prime offers', user: i => i.label === 'User Menu', 'collapse-left': i => i.label === 'Collapse Side Nav',
  'collapse-right': i => i.label === 'Collapse Chat', community: i => i.label === 'Community', gift: i => i.label === 'Gift a Sub',
  star: i => i.label === 'Subscribe', viewers: i => i.label === 'Stream Information', share: i => i.label === 'Share',
  verified: i => i.label === 'Verified Partner', popout: i => i.label === 'Pop Out Extension', settings: i => i.label === 'Settings',
  bits: i => i.label === 'Cheer', emote: i => i.label === 'Emote picker', info: i => i.label === 'About Panel',
  reply: i => i.label.startsWith('Replying to'), 'reply-button': i => i.label.startsWith('Click to reply'),
  heart: i => i.html.includes('m12 6.429 1.036-1.006'), chevron: i => i.html.includes('m12.207 15.621'),
  points: i => i.html.includes('M12 5v2a5 5 0 0 1 5 5h2'), bell: i => i.html.includes('M3 17h18v-2'),
  pause: i => i.label.startsWith('Pause'), mute: i => i.label.startsWith('Mute'), theatre: i => i.label.startsWith('Theatre'),
  fullscreen: i => i.label.startsWith('Fullscreen'),
};
function localIcons() {
  const all = [];
  for (const file of readdirSync(join(OUT, 'icons'))) if (file.endsWith('.icons.json')) all.push(...JSON.parse(readFileSync(join(OUT, 'icons', file), 'utf8')));
  const picked = {};
  for (const [name, test] of Object.entries(ICONS)) {
    const icon = all.find(test);
    // Keep only the drawing: no sizes, labels or roles, so the replica sizes and colours it.
    if (icon) picked[name] = icon.html.replace(/\s(width|height|focusable|aria-hidden|role|class|aria-label)="[^"]*"/g, '');
  }
  writeFileSync(join(OUT, 'icons', 'icons.json'), JSON.stringify(picked, null, 1));
  return Object.keys(picked).length;
}

// ---------------------------------------------------------------- in-page measurement
/** Every visible element: box, own text, the computed style that matters for a replica. Runs in the page. */
function dumpPage() {
  const keep = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color',
    'border-radius', 'padding', 'margin', 'border', 'opacity', 'text-transform', 'box-shadow', 'gap', 'display', 'position',
    'overflow-y', 'white-space', 'text-overflow', 'font-feature-settings', 'background-image', 'fill', 'z-index'];
  const nodes = [...document.querySelectorAll('body *')];
  const indexOf = new Map(nodes.map((n, i) => [n, i]));
  const out = [];
  for (const [i, el] of nodes.entries()) {
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) continue;
    if (r.bottom < -200 || r.top > innerHeight + 2400 || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join(' ');
    const s = {};
    for (const k of keep) { const v = cs.getPropertyValue(k); if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)' && v !== 'auto') s[k] = v; }
    s.color = cs.color; s['font-family'] = cs.fontFamily; s['font-size'] = cs.fontSize;
    const cls = typeof el.className === 'string' ? el.className : el.className?.baseVal ?? '';
    out.push({ i, p: indexOf.get(el.parentElement) ?? -1, tag: el.tagName.toLowerCase(), cls: cls.slice(0, 200),
      a: el.getAttribute('data-a-target') ?? undefined, t: el.getAttribute('data-test-selector') ?? undefined,
      aria: el.getAttribute('aria-label') ?? undefined, src: el.getAttribute('src')?.slice(0, 160) ?? undefined,
      alt: el.getAttribute('alt') ?? undefined,
      r: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100), text: own.slice(0, 120) || undefined, s,
      scroll: el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(cs.overflowY) ? [el.scrollTop, el.scrollHeight, el.clientHeight] : undefined });
  }
  // Twitch's styled-components rules live in same-origin sheets; their custom properties carry the theme colours.
  const styled = [], names = new Set();
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) { if (!sheet.href) styled.push(rule.cssText); for (const m of rule.cssText.matchAll(/--[a-z0-9-]+/g)) names.add(m[0]); }
  }
  const themed = getComputedStyle(document.querySelector('.tw-root--theme-dark') ?? document.documentElement);
  const vars = Object.fromEntries([...names].sort().map(n => [n, themed.getPropertyValue(n).trim()]).filter(([, v]) => v));
  const fonts = [...document.fonts].map(f => ({ family: f.family, weight: f.weight, style: f.style, status: f.status, unicodeRange: f.unicodeRange }));
  return { url: location.href, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, fonts, vars, styled, html: document.documentElement.className, elements: out };
}

/** Every distinct SVG icon on the page with the label of what it sits in. Runs in the page. */
function dumpIcons() {
  const seen = new Map();
  for (const svg of document.querySelectorAll('svg')) {
    const r = svg.getBoundingClientRect();
    if (r.width < 4) continue;
    const host = svg.closest('[aria-label],[data-a-target],[data-test-selector],button,a');
    const label = host?.getAttribute('aria-label') ?? host?.getAttribute('data-a-target') ?? host?.getAttribute('data-test-selector') ?? host?.tagName ?? 'svg';
    const html = svg.outerHTML;
    if (![...seen.values()].some(v => v.html === html)) seen.set(`${label}#${seen.size}`, { label, html, size: [r.width, r.height], at: [r.x, r.y] });
  }
  return [...seen.values()];
}

/** Hides banners that cover the page, on our side only. */
const HIDE_BANNERS = `
  .consent-banner, [data-a-target="consent-banner"], [class*="ConsentBanner"], #onetrust-consent-sdk,
  #root footer, .upsell-banner, [data-test-selector="persistent-login-banner"],
  [data-test-selector="chat-private-callout-queue__callout-container"], [class*="community-highlight-stack"],
  .chat-room__content > div:has(button[aria-label*="Leaderboard"]) { display: none !important; }
`;

async function capturePage(browser, { name, url, scale, settle, scrollShots }) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale, colorScheme: 'dark',
    locale: 'en-US', timezoneId: 'Europe/Berlin', userAgent: undefined });
  const page = await context.newPage();
  const saves = [];
  if (scale === 1) page.on('response', response => {
    const u = response.url(), type = response.request().resourceType();
    if (type === 'font' || /\.woff2?(\?|$)/.test(u)) saves.push(response.body().then(b => {
      writeFileSync(join(OUT, 'fonts', u.split('/').pop().split('?')[0]), b);
    }).catch(() => {}));
    if (type === 'stylesheet' || /\.css(\?|$)/.test(u)) saves.push(response.body().then(b => {
      writeFileSync(join(OUT, 'css', `${createHash('sha1').update(u).digest('hex').slice(0, 10)}-${u.split('/').pop().split('?')[0]}`), b);
    }).catch(() => {}));
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.addStyleTag({ content: HIDE_BANNERS }).catch(() => {});
  // The mouse stays at the corner so the player's controls fade out as they do for a viewer who looks at chat.
  await page.mouse.move(1919, 1079);
  await page.waitForTimeout(settle);
  await page.addStyleTag({ content: HIDE_BANNERS }).catch(() => {});
  const suffix = scale === 1 ? '' : `@${scale}x`;
  await page.screenshot({ path: join(OUT, `${name}@1920x1080${suffix}.png`) });
  if (scale === 1) {
    const dump = await page.evaluate(dumpPage);
    writeFileSync(join(OUT, `${name}.dump.json`), JSON.stringify(dump));
    const icons = await page.evaluate(dumpIcons);
    writeFileSync(join(OUT, 'icons', `${name}.icons.json`), JSON.stringify(icons, null, 1));
    writeFileSync(join(OUT, `${name}.html`), await page.content());
  }
  for (const [i, y] of (scrollShots ?? []).entries()) {
    // Scroll the main column with a script: local, nothing is sent to Twitch.
    await page.evaluate(top => {
      const scrollers = [...document.querySelectorAll('main *, [data-a-target="root-scroller"] *')]
        .filter(el => el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(el).overflowY) && el.getBoundingClientRect().width > 800);
      const s = scrollers[0]; if (s) s.scrollTop = top;
    }, y);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `${name}-scroll${i + 1}@1920x1080${suffix}.png`) });
    if (scale === 1) writeFileSync(join(OUT, `${name}-scroll${i + 1}.dump.json`), JSON.stringify(await page.evaluate(dumpPage)));
  }
  await Promise.all(saves);
  await context.close();
}

async function session(work) {
  const release = await acquireCaptureLock();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
    await work(browser);
  } finally {
    await browser?.close();
    await release();
  }
}

const auth = await helixToken();
if (!args.includes('--skip-assets')) await fetchAssets(auth);
if (args.includes('--assets-only')) { await fetchAssets(auth); process.exit(0); }
if (args.includes('--local-only')) { process.stdout.write(`fonts: ${await localFonts()} faces, icons: ${localIcons()}\n`); process.exit(0); }
const pick = { channel: flag('--channel') };
if (only !== 'offline' && !pick.channel) {
  const candidates = await liveCandidates(auth);
  if (!candidates.length) throw new Error('no small English channel is live right now');
  // A layout reference needs a chat that moves: look at a few candidates for twenty seconds each.
  await session(async browser => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark', locale: 'en-US' });
    const page = await context.newPage();
    for (const c of candidates.slice(0, 8)) {
      await page.goto(`https://www.twitch.tv/${c.user_login}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(20_000);
      const lines = await page.evaluate(() => document.querySelectorAll('.chat-line__message').length).catch(() => 0);
      process.stdout.write(`probe ${c.user_login}: ${c.viewer_count} viewers, ${lines} chat lines in 20 s\n`);
      if (lines >= 8) { pick.channel = c.user_login; pick.viewers = c.viewer_count; pick.game = c.game_name; break; }
    }
    await context.close();
  });
  if (!pick.channel) throw new Error('no candidate had an active chat');
  writeFileSync(join(OUT, 'live-pick.json'), JSON.stringify(pick, null, 1));
}
const pages = [];
if (only !== 'live') pages.push({ name: 'tobi4s-offline', url: 'https://www.twitch.tv/tobi4s_', settle: 9000, scrollShots: [700, 1500] });
if (only !== 'offline') pages.push({ name: 'live', url: `https://www.twitch.tv/${pick.channel}`, settle: Number(flag('--settle') ?? 90) * 1000, scrollShots: [900] });
for (const target of pages) {
  await session(async browser => { await capturePage(browser, { ...target, scale: 1 }); });
  await session(async browser => { await capturePage(browser, { ...target, scale: 2, scrollShots: [] }); });
  process.stdout.write(`captured ${target.name}\n`);
}
process.stdout.write(`fonts: ${await localFonts()} faces in reference/fonts/fonts.css, icons: ${localIcons()} in reference/icons/icons.json\n`);
