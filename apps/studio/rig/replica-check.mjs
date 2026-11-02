// Replica check: renders the page replica in the same layout state as the live reference capture, measures the
// same boxes, text styles and background colours, and prints the deltas. It also writes the evidence images:
//   work/evidence/teaser/replica-vs-reference@1920x1080.png   replica | reference (identities covered) | difference
//   work/evidence/teaser/replica-sample@1920x1080.png         the replica's own sample (?fixture=page)
//
//   nice -n 19 node apps/studio/rig/replica-check.mjs [--port 5172] [--t 8]
//
// Reads media/teaser/reference/live.dump.json and live@1920x1080.png (from rig/reference-capture.mjs). The reference
// is another streamer's page, used only for layout: in every image written here their video, name, avatar, title,
// about text, side bar and chat text are covered by neutral boxes.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { MEDIA_ROOT, REPO_ROOT, startStudio } from '../server/serve.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const REF = join(MEDIA_ROOT, 'reference');
const WORK = join(REF, 'replica-check');
const EVIDENCE = resolve(REPO_ROOT, 'work/evidence/teaser');
mkdirSync(WORK, { recursive: true });
mkdirSync(EVIDENCE, { recursive: true });

// ---------------------------------------------------------------- a free studio port (never 5187 or 5190–5197)
function freePort() {
  const wanted = flag('--port');
  const busy = execFileSync('ss', ['-ltnH']).toString();
  const candidates = wanted ? [Number(wanted)] : [5175, 5173, 5172, 5171, 5170];
  for (const port of candidates) if (!new RegExp(`:${port}\\s`).test(busy)) return port;
  throw new Error('no free studio port among 5170–5175');
}

// ---------------------------------------------------------------- the reference dump
const dump = JSON.parse(readFileSync(join(REF, 'live.dump.json'), 'utf8'));
const els = dump.elements;
const byIndex = new Map(els.map(e => [e.i, e]));
const children = new Map();
for (const e of els) { if (!children.has(e.p)) children.set(e.p, []); children.get(e.p).push(e); }
const descendants = e => { const out = []; const walk = x => { for (const c of children.get(x.i) ?? []) { out.push(c); walk(c); } }; walk(e); return out; };
const has = (e, cls) => (e.cls ?? '').split(/\s+/).includes(cls);
const find = test => els.find(test);
const findAll = test => els.filter(test);
const inside = (e, box) => e.r[0] >= box[0] && e.r[1] >= box[1] && e.r[0] < box[0] + box[2] && e.r[1] < box[1] + box[3];

const sideNav = find(e => has(e, 'side-nav'));
const sideBox = sideNav.r;
const chatScroller = find(e => e.a === 'chat-scroller');
const chatLinesRef = descendants(chatScroller).filter(e => has(e, 'chat-line__message') && e.r[1] >= 90 && e.r[1] + e.r[3] <= 992);

/** The reference's boxes by role. Each is [x, y, width, height] in page CSS px. */
const refBoxes = {
  'top nav': find(e => e.a === 'top-nav-container')?.r,
  'browse link': find(e => e.text === 'Browse' && e.tag === 'p')?.r,
  'search input': find(e => e.a === 'tw-input' && e.aria === 'Search Input')?.r,
  'search button': find(e => e.aria === 'Search Button')?.r,
  'side nav': sideBox,
  'side header 1': find(e => e.tag === 'h3' && inside(e, sideBox))?.r,
  'side card 1': find(e => has(e, 'side-nav-card'))?.r,
  'side avatar 1': find(e => has(e, 'side-nav-card__avatar'))?.r,
  'side title 1': find(e => e.a === 'side-nav-title')?.r,
  'side live dot 1': find(e => has(e, 'tw-channel-status-indicator') && inside(e, sideBox))?.r,
  'side collapse': find(e => e.aria === 'Collapse Side Nav')?.r,
  player: find(e => has(e, 'channel-root__player'))?.r,
  'info column': find(e => has(e, 'channel-root__info'))?.r,
  'channel avatar': find(e => has(e, 'tw-image-avatar') && e.r[2] === 64)?.r,
  'live pill': find(e => has(e, 'tw-channel-status-text-indicator'))?.r,
  'channel name': find(e => e.tag === 'h1')?.r,
  'follow button': find(e => e.a === 'follow-button')?.r,
  'gift button': find(e => e.a === 'gift-button')?.r,
  'subscribe button': find(e => e.a === 'subscribe-button')?.r,
  'stream title': find(e => e.a === 'stream-title')?.r,
  category: find(e => e.a === 'stream-game-link')?.r,
  'tag 1': find(e => has(e, 'tw-tag'))?.r,
  'viewer count': find(e => e.a === 'animated-channel-viewers-count')?.r,
  uptime: find(e => has(e, 'live-time'))?.r,
  'share button': find(e => e.a === 'share-button')?.r,
  'about title': find(e => e.tag === 'h3' && has(e, 'tw-title'))?.r,
  'about box': find(e => has(e, 'about-section__panel--content'))?.r,
  'chat column': find(e => has(e, 'channel-root__right-column'))?.r,
  'chat header': find(e => has(e, 'stream-chat-header'))?.r,
  'chat title': find(e => e.t === 'chat-room-header-label')?.r,
  'chat collapse': find(e => e.aria === 'Collapse Chat')?.r,
  'chat community': find(e => e.aria === 'Community')?.r,
  'chat input': find(e => has(e, 'chat-wysiwyg-input-box'))?.r,
  'bits button': find(e => e.a === 'bits-button')?.r,
  'emote button': find(e => e.a === 'emote-picker-button')?.r,
  'points summary': find(e => e.t === 'community-points-summary')?.r,
  'chat settings': find(e => e.a === 'chat-settings')?.r,
  'chat button': find(e => e.a === 'chat-send-button')?.r,
  'last chat line': chatLinesRef.at(-1)?.r,
};
/** Boxes whose x or width depends on text we deliberately do not copy: only y and height are compared. */
/** Boxes sized by how much content sits below the fold (the info column runs on under the chat column on Twitch):
 * only x and y are compared. */
const POSITION_ONLY = new Set(['info column']);
const TEXT_SIZED = new Set(['channel name', 'stream title', 'viewer count', 'uptime', 'about title', 'side title 1', 'points summary', 'last chat line']);

/** Text roles: which element carries each style in the reference. */
const refText = {
  browse: find(e => e.text === 'Browse' && e.tag === 'p'),
  'side header': find(e => e.tag === 'h3' && inside(e, sideBox)),
  'side title': find(e => e.a === 'side-nav-title'),
  'side category': find(e => e.tag === 'p' && inside(e, sideBox) && e.s.color === 'rgb(211, 211, 217)'),
  'side viewers': find(e => e.tag === 'span' && inside(e, sideBox) && /^[\d.]+K?$/.test(e.text ?? '')),
  'channel name': find(e => e.tag === 'h1'),
  'stream title': find(e => e.a === 'stream-title'),
  category: find(e => e.a === 'stream-game-link'),
  tag: find(e => e.tag === 'span' && has(byIndex.get(byIndex.get(byIndex.get(e.p)?.p)?.p) ?? {}, 'tw-tag')) ?? find(e => has(e, 'tw-tag')),
  'viewer count': find(e => e.a === 'animated-channel-viewers-count'),
  uptime: find(e => has(e, 'live-time')),
  'button label': find(e => e.a === 'tw-core-button-label-text' && e.text === 'Gift a Sub'),
  'about title': find(e => e.tag === 'h3' && has(e, 'tw-title')),
  'chat title': find(e => e.t === 'chat-room-header-label'),
  'chat name': find(e => has(e, 'chat-author__display-name')),
  'chat text': find(e => has(e, 'text-fragment')),
  'reply line': find(e => e.tag === 'p' && /^Replying to/.test(e.text ?? '')),
  placeholder: find(e => has(e, 'chat-wysiwyg-input__placeholder')),
  'chat button': find(e => e.a === 'tw-core-button-label-text' && e.text === 'Chat'),
};

/** Background colours sampled at the same points in both screenshots. */
const SAMPLES = {
  'top nav': [500, 30], 'side nav': [120, 1060], 'main column': [800, 1060], 'chat room': [1700, 975], 'chat header': [1650, 60],
  'chat column rule': [1580, 600], 'chat header rule': [1650, 89], 'info rule': [800, 804], 'chat input': [1820, 1011],
  'follow button': [1172, 830], 'live pill': [272, 889], 'tag': [390, 884], 'about box': [1100, 1025], 'chat button': [1858, 1056],
  'search button': [1124, 40],
};

// ---------------------------------------------------------------- the replica's state, shaped like the reference
// Names from the chat roster: invented, each login checked absent on Helix (apps/studio/src/chat/names-checked.json).
const { roster } = await import('../src/chat/roster.ts');
const NAMES = roster.map(p => p.display);
const COLORS = ['#1E90FF', '#FF69B4', '#9ACD32', '#5F9EA0', '#DAA520', '#FF4500', '#8A2BE2', '#00FF7F', '#D2691E', '#2E8B57', '#B22222', '#FF7F50'];
const BADGES = [{ set: 'moderator', version: '1' }, { set: 'subscriber', version: '3' }, { set: 'premium', version: '1' }, { set: 'vip', version: '1' }];
const WORDS = 'the lanterns on the bridge look so warm tonight and my little house by the well finally has a chimney of its own we should build a second forge near the river so the night market has light'.split(' ');
/** Invented words of about `length` characters, so a line wraps where the reference's line wrapped. */
function filler(length, seed) {
  let out = '', i = seed;
  while (out.length < length) out += (out ? ' ' : '') + WORDS[i++ % WORDS.length];
  return out.slice(0, Math.max(1, length)).trimEnd();
}
function chatLike() {
  // The reference's list runs on above the top of the scroller; a few backlog lines make ours overflow the same way.
  const backlog = Array.from({ length: 6 }, (_, k) => ({ kind: 'message', id: `back${k}`, at: -200 + k,
    from: { login: NAMES[k].toLowerCase(), display: NAMES[k], color: COLORS[k % COLORS.length], badges: [] }, fragments: [{ kind: 'text', text: filler(30, k) }] }));
  return [...backlog, ...chatLinesRef.map((line, k) => {
    const all = descendants(line);
    const badges = all.filter(e => has(e, 'chat-badge') && e.tag === 'img').length;
    const nameEl = all.find(e => has(e, 'chat-author__display-name'));
    const textLen = all.filter(e => has(e, 'text-fragment')).reduce((n, e) => n + (e.text ?? '').length, 0);
    const emotes = all.filter(e => e.tag === 'img' && /emote/.test(e.cls ?? '')).length;
    const reply = all.some(e => e.tag === 'p' && /^Replying to/.test(e.text ?? ''));
    const nameLen = (nameEl?.text ?? 'chatter').length;
    const name = NAMES.find(n => n.length === nameLen) ?? NAMES[k % NAMES.length].slice(0, Math.max(3, nameLen));
    const from = { login: name.toLowerCase(), display: name, color: COLORS[k % COLORS.length], badges: BADGES.slice(0, Math.min(badges, 3)) };
    const fragments = [{ kind: 'text', text: filler(textLen, k * 3) }];
    for (let j = 0; j < emotes; j++) fragments.push({ kind: 'text', text: ' ' }, { kind: 'emote', id: '425618', code: 'LUL' });
    const item = { kind: 'message', id: `ref${k}`, at: -100 + k, from, fragments };
    if (reply) item.reply = { to: { ...from, display: NAMES[(k + 5) % NAMES.length] }, text: filler(40, k) };
    return item;
  })];
}
const sideTitles = findAll(e => has(e, 'side-nav-card')).length;
const refState = {
  t: 0,
  channel: {
    login: 'tobi4s_', display: 'tobi4s_', avatar: '/media/teaser/reference/avatars/tobi4s_.png',
    title: filler((find(e => e.a === 'stream-title')?.text ?? '').length + 12, 2), category: find(e => e.a === 'stream-game-link') ? (descendants(find(e => e.a === 'stream-game-link'))[0]?.text ?? 'Fortnite') : 'Fortnite',
    tags: findAll(e => has(e, 'tw-tag')).map(e => descendants(e).find(d => d.text)?.text ?? 'English'),
    followers: 253802, about: filler(40, 7), uptimeAtStart: 0,
  },
  side: Array.from({ length: sideTitles }, (_, k) => ({ login: `side${k}`, display: NAMES[k % NAMES.length], avatar: `/media/teaser/reference/avatars/default-${k % 12}.png`,
    category: ['Minecraft', 'Just Chatting', 'Art', 'Stardew Valley'][k % 4], viewers: [1200, 87, 46600, 6400, 723][k % 5], live: true })),
  me: { display: 'velvetbramble_', avatar: '/media/teaser/reference/avatars/default-6.png' },
  viewers: Number((find(e => e.a === 'animated-channel-viewers-count')?.text ?? descendants(find(e => e.a === 'animated-channel-viewers-count') ?? { i: -9 })[0]?.text ?? '1585').replace(/,/g, '')) || 1585,
  uptime: 3446, theatre: false, following: false, followPress: 0, chat: chatLike(), composing: '', hypeTrain: null, scroll: 0,
  player: { kind: 'key' }, panel: { query: 'state=named' },
  cursor: { x: 0, y: 0, visible: false, pressed: 0, shape: 'arrow' }, camera: { cx: 960, cy: 540, zoom: 1 },
};

// ---------------------------------------------------------------- in the replica
/** Measures the replica's boxes, text styles and the chat line metrics. Runs in the page. */
function measureReplica() {
  const scope = document.getElementById('check-root');
  const q = s => scope.querySelector(s);
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100); };
  const style = el => { if (!el) return null; const c = getComputedStyle(el); return { family: c.fontFamily.split(',')[0].replace(/"/g, ''), size: c.fontSize, weight: c.fontWeight, lineHeight: c.lineHeight, letterSpacing: c.letterSpacing, color: c.color }; };
  const lines = [...scope.querySelectorAll('.chat-line')];
  const visible = lines.filter(l => { const r = l.getBoundingClientRect(); return r.y >= 90 && r.y + r.height <= 992; });
  const buttons = [...scope.querySelectorAll('.channel-header__buttons > .button')];
  return {
    boxes: {
      'top nav': box(q('.top-nav')), 'browse link': box(q('.top-nav__browse')), 'search input': box(q('.top-nav__search-input')),
      'search button': box(q('.top-nav__search-button')), 'side nav': box(q('.side-nav')), 'side header 1': box(q('.side-nav__header h3')),
      'side card 1': box(q('.side-card')), 'side avatar 1': box(q('.side-card__avatar')), 'side title 1': box(q('.side-card__title')),
      'side live dot 1': box(q('.side-card .live-dot')), 'side collapse': box(q('.side-nav__collapse')), player: box(q('.player')),
      'info column': box(q('.info')), 'channel avatar': box(q('.channel-header__avatar img')), 'live pill': box(q('.live-pill span')),
      'channel name': box(q('.channel-header__name')), 'follow button': box(buttons[0]), 'gift button': box(buttons[1]), 'subscribe button': box(buttons[2]),
      'stream title': box(q('.channel-header__title')), category: box(q('.channel-header__category')), 'tag 1': box(q('.tag')),
      'viewer count': box(q('.viewer-count strong')), uptime: box(q('.live-time')), 'share button': box(q('.channel-header__right .icon-button')),
      'about title': box(q('.about__title')), 'about box': box(q('.about__box')), 'chat column': box(q('.chat-column')),
      'chat header': box(q('.chat-header')), 'chat title': box(q('.chat-header__title')), 'chat collapse': box(q('.chat-header__collapse')),
      'chat community': box(q('.chat-header__community')), 'chat input': box(q('.chat-input__box')), 'bits button': box(q('.chat-input__bits')),
      'emote button': box(q('.chat-input__emote')), 'points summary': box(q('.points-summary')), 'chat settings': box(q('.chat-input__right .icon-button')),
      'chat button': box(q('.chat-button')), 'last chat line': box(visible.at(-1)),
    },
    text: {
      browse: style(q('.top-nav__browse')), 'side header': style(q('.side-nav__header h3')), 'side title': style(q('.side-card__title')),
      'side category': style(q('.side-card__category')), 'side viewers': style(q('.side-card__viewers')), 'channel name': style(q('.channel-header__name')),
      'stream title': style(q('.channel-header__title')), category: style(q('.channel-header__category')), tag: style(q('.tag')),
      'viewer count': style(q('.viewer-count strong')), uptime: style(q('.live-time')), 'button label': style(q('.button__label')),
      'about title': style(q('.about__title')), 'chat title': style(q('.chat-header__title')), 'chat name': style(q('.display-name')),
      'chat text': style(q('.text-fragment')), 'reply line': style(q('.reply-text')), placeholder: style(q('.chat-input__placeholder')),
      'chat button': style(q('.chat-button')),
    },
    lines: visible.map(l => box(l)),
    tail: [...(scope.querySelector('.chat-list')?.children ?? [])].slice(-3).map(c => [c.className, box(c)]),
    list: box(scope.querySelector('.chat-list')), scroller: box(scope.querySelector('.chat-scroller')),
    badge: box(q('.chat-badge')), badge2: box(scope.querySelectorAll('.chat-badge')[1]), emote: box(q('.emote img')),
    name: box(q('.display-name')), fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family} ${f.weight}`),
  };
}

const textOf = e => e && { family: e.s['font-family'].split(',')[0].replace(/"/g, ''), size: e.s['font-size'], weight: e.s['font-weight'], lineHeight: e.s['line-height'], letterSpacing: e.s['letter-spacing'] ?? 'normal', color: e.s.color };

function pixel(file, [x, y]) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return `#${[...raw.subarray(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The neutral boxes that cover the other streamer's identity and their chatters, applied alike to every pane of the
 * evidence. Whole regions are covered, not single words, so nothing a person wrote or chose can show through: the
 * player, every side-bar card, the channel's avatar, name, title, category, tags and numbers, the about section and
 * goals, and the whole chat list. Only Twitch's own chrome stays legible. Seams mark where each chat line and
 * side-bar card ends, so the rhythm of the layout is still visible. */
function covers() {
  const boxes = [], seams = [];
  const add = (x, y, w, h) => { if (w > 0 && h > 0) boxes.push([x, y, w, h]); };
  const p = refBoxes.player; add(p[0], p[1], p[2], p[3]);
  // The side bar below its first header: every card and every later header (one names the channel).
  add(0, 90, 240, 990);
  for (const c of findAll(e => has(e, 'side-nav-card'))) seams.push([c.r[0], c.r[1] + c.r[3] - 1, c.r[2], 1]);
  // Channel identity: from the avatar to just before the Follow button, avatar top to below the tag row.
  const follow = refBoxes['follow button'];
  const tagBottom = Math.max(...findAll(e => has(e, 'tw-tag')).map(e => e.r[1] + e.r[3]), refBoxes.category[1] + refBoxes.category[3]);
  add(250, 814, follow[0] - 8 - 250, tagBottom + 4 - 814);
  // Viewer count and uptime (the channel's own numbers).
  const v = refBoxes['viewer count'], u = refBoxes.uptime;
  add(v[0] - 24, Math.min(v[1], u[1]) - 4, u[0] + u[2] - v[0] + 30, 28);
  // About: title (it carries the name), the box, and the goals column; everything below to the fold.
  const t = refBoxes['about title'], box = refBoxes['about box'];
  add(t[0] - 2, t[1] - 2, 1254, 1080 - t[1] + 2);
  void box;
  // The chat list, all of it, with a seam at the bottom of each line in view.
  const s = chatScroller.r;
  add(s[0], s[1], s[2], Math.min(s[3], 991 - s[1]));
  for (const line of descendants(chatScroller).filter(e => has(e, 'chat-line__message') || has(e, 'chat-line__status') || /user-notice-line|chat-line--inline/.test(e.cls ?? ''))) {
    const y = line.r[1] + line.r[3] - 1;
    if (y > s[1] && y < 991) seams.push([s[0], y, s[2], 1]);
  }
  return { boxes, seams };
}

const port = freePort();
const studio = await startStudio({ port, quiet: true });
const release = await acquireCaptureLock();
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => process.stderr.write(`page error: ${error.message}\n`));

  // 1. The sample, as a person sees it at /studio/?fixture=page.
  const sampleT = Number(flag('--t', '8'));
  await page.goto(`${studio.base}/studio/?fixture=page&t=${sampleT}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__studio?.ready === true, null, { timeout: 120_000 });
  // The sample's player is a keyed hole; show it as an empty (black) player rather than the page's white.
  await page.evaluate(() => { document.body.style.background = '#000'; });
  await page.screenshot({ path: join(EVIDENCE, 'replica-sample@1920x1080.png') });
  const sampleRects = await page.evaluate(() => window.__studio.rects?.());

  // 2. The replica in the reference's layout state.
  await page.evaluate(async state => {
    // A fresh mount beside the sample's (which is hidden), so the two never share a reactive root.
    document.getElementById('studio').style.display = 'none';
    const root = document.createElement('div');
    root.id = 'check-root';
    root.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden';
    document.body.appendChild(root);
    const { mountPage } = await import('/studio/src/page/index.ts');
    const view = mountPage(root);
    window.__check = view;
    await view.render(state);
  }, refState);
  const replicaFile = join(WORK, 'replica@1920x1080.png');
  await page.screenshot({ path: replicaFile });
  const replica = await page.evaluate(measureReplica);

  // 3. Rects the shots need: the player in normal and theatre layouts, and the panel's main button (S09 taps it in
  //    the unshared panel, with the page scrolled by 520).
  const layouts = await page.evaluate(async state => {
    const view = window.__check;
    await view.render({ ...state, theatre: true });
    const theatre = view.rects();
    await view.render({ ...state, scroll: 520, panel: { query: 'state=unshared' } });
    const scrolled = view.rects();
    const frame = document.querySelector('#check-root .extension-panel iframe');
    const doc = frame?.contentDocument;
    const panelSrc = frame?.getAttribute('src');
    const panelText = (doc?.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400);
    const buttons = doc ? [...doc.querySelectorAll('button, a, [role="button"]')].map(b => {
      const r = b.getBoundingClientRect();
      return { text: (b.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60), inPanel: [r.x + r.width / 2, r.y + r.height / 2].map(v => Math.round(v * 10) / 10), size: [r.width, r.height].map(Math.round) };
    }).filter(b => b.size[0] > 0) : [];
    await view.render(state);
    return { normal: view.rects(), theatre, scrolled, buttons, panelText, src: panelSrc };
  }, refState);

  // 4. Evidence: replica | reference with identities covered | difference of the two (both covered alike).
  const coverBoxes = covers();
  const evidence = await page.evaluate(async ({ coverBoxes }) => {
    const load = src => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = src; });
    const [rep, ref] = await Promise.all([load('/media/teaser/reference/replica-check/replica@1920x1080.png'), load('/media/teaser/reference/live@1920x1080.png')]);
    const layer = (img, covered) => {
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      if (covered) {
        g.fillStyle = '#3a3a40'; for (const [x, y, w, h] of coverBoxes.boxes) g.fillRect(x, y, w, h);
        g.fillStyle = '#5a5a62'; for (const [x, y, w, h] of coverBoxes.seams) g.fillRect(x, y, w, h);
      }
      return c;
    };
    const repCovered = layer(rep, true), refCovered = layer(ref, true);
    const diff = document.createElement('canvas'); diff.width = 1920; diff.height = 1080;
    const d = diff.getContext('2d');
    d.drawImage(repCovered, 0, 0); d.globalCompositeOperation = 'difference'; d.drawImage(refCovered, 0, 0);
    // Mean absolute difference over the page, for the record.
    const px = d.getImageData(0, 0, 1920, 1080).data; let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
    // Brighten the difference so small offsets show.
    d.globalCompositeOperation = 'source-over';
    const lifted = d.getImageData(0, 0, 1920, 1080);
    for (let i = 0; i < lifted.data.length; i += 4) for (let k = 0; k < 3; k++) lifted.data[i + k] = Math.min(255, lifted.data[i + k] * 3);
    d.putImageData(lifted, 0, 0);
    const out = document.createElement('canvas'); out.width = 2880; out.height = 600;
    const o = out.getContext('2d'); o.fillStyle = '#000'; o.fillRect(0, 0, 2880, 600);
    o.imageSmoothingQuality = 'high';
    o.drawImage(repCovered, 0, 60, 960, 540); o.drawImage(refCovered, 960, 60, 960, 540); o.drawImage(diff, 1920, 60, 960, 540);
    o.fillStyle = '#efeff1'; o.font = '600 28px Inter, sans-serif';
    o.fillText('Replica (studio), covered alike', 16, 40); o.fillText('Reference: live twitch.tv page, identities covered', 976, 40); o.fillText('Difference (×3), both covered alike', 1936, 40);
    return { png: out.toDataURL('image/png'), meanDiff: sum / (1920 * 1080) };
  }, { coverBoxes });
  const evidenceFile = join(EVIDENCE, 'replica-vs-reference@1920x1080.png');
  writeFileSync(evidenceFile, Buffer.from(evidence.png.split(',')[1], 'base64'));
  if (statSync(evidenceFile).size > 2_000_000) {
    // Keep the evidence under 2 MB: a 256-colour palette is plenty for a layout comparison.
    const tmp = join(WORK, 'evidence-palette.png');
    execFileSync('nice', ['-n', '19', 'ffmpeg', '-loglevel', 'error', '-y', '-i', evidenceFile, '-filter_complex', '[0]split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=none', '-threads', '2', tmp]);
    writeFileSync(evidenceFile, readFileSync(tmp));
  }
  await context.close();

  // ---------------------------------------------------------------- report
  const rows = [];
  let worst = 0;
  for (const [role, ref] of Object.entries(refBoxes)) {
    const rep = replica.boxes[role];
    if (!ref || !rep) { rows.push([role, ref ? ref.join(',') : 'missing', rep ? rep.join(',') : 'missing', '—', '']); continue; }
    const delta = ref.map((v, k) => Math.round((rep[k] - v) * 100) / 100);
    const counted = POSITION_ONLY.has(role) ? [delta[0], delta[1]] : TEXT_SIZED.has(role) ? [delta[1], delta[3]] : delta;
    const max = Math.max(...counted.map(Math.abs));
    worst = Math.max(worst, max);
    rows.push([role, ref.map(v => Math.round(v * 10) / 10).join(','), rep.map(v => Math.round(v * 10) / 10).join(','), delta.join(','), `${max <= 2 ? 'ok' : 'OFF'}${POSITION_ONLY.has(role) ? ' (x,y)' : TEXT_SIZED.has(role) ? ' (y,h)' : ''}`]);
  }
  const pad = (s, n) => String(s).padEnd(n);
  process.stdout.write(`\nLayout boxes (x,y,w,h in CSS px; delta = replica − reference)\n`);
  for (const r of rows) process.stdout.write(`${pad(r[0], 18)} ref ${pad(r[1], 28)} rep ${pad(r[2], 28)} Δ ${pad(r[3], 24)} ${r[4]}\n`);
  process.stdout.write(`worst box delta: ${worst.toFixed(2)} px\n`);

  process.stdout.write(`\nText styles (family size weight line-height letter-spacing colour)\n`);
  let styleMismatch = 0;
  for (const [role, el] of Object.entries(refText)) {
    const ref = textOf(el), rep = replica.text[role];
    const fmt = s => (s ? `${s.family} ${s.size} ${s.weight} ${s.lineHeight} ${s.letterSpacing} ${s.color}` : 'missing');
    const same = ref && rep && ['family', 'size', 'weight', 'lineHeight', 'color'].every(k => ref[k] === rep[k] || (k === 'color' && role === 'chat name'));
    if (!same) styleMismatch++;
    process.stdout.write(`${pad(role, 14)} ${same ? 'same' : 'DIFF'}  ref ${pad(fmt(ref), 64)} rep ${fmt(rep)}\n`);
  }

  process.stdout.write(`\nSampled colours\n`);
  let colourMismatch = 0;
  for (const [name, at] of Object.entries(SAMPLES)) {
    const a = pixel(join(REF, 'live@1920x1080.png'), at), b = pixel(replicaFile, at);
    if (a !== b) colourMismatch++;
    process.stdout.write(`${pad(name, 18)} @${pad(at.join(','), 10)} ref ${a}  rep ${b}  ${a === b ? 'same' : 'DIFF'}\n`);
  }

  const refLines = chatLinesRef.map(l => l.r);
  const lineHeights = ls => ls.map(r => Math.round(r[3] * 10) / 10);
  process.stdout.write(`\nChat line metrics\n`);
  process.stdout.write(`lines in view       ref ${refLines.length}  rep ${replica.lines.length}\n`);
  process.stdout.write(`line heights (ref)  ${lineHeights(refLines).join(' ')}\nline heights (rep)  ${lineHeights(replica.lines).join(' ')}\n`);
  const refBadges = findAll(e => has(e, 'chat-badge') && e.tag === 'img' && inside(e, chatScroller.r));
  process.stdout.write(`badge size          ref ${refBadges[0]?.r.slice(2).join('×')}  rep ${replica.badge?.slice(2).join('×')}\n`);
  if (refBadges[1] && replica.badge2) process.stdout.write(`badge pitch         ref ${(refBadges[1].r[0] - refBadges[0].r[0]).toFixed(1)}  rep ${(replica.badge2[0] - replica.badge[0]).toFixed(1)}\n`);
  const refEmote = find(e => e.tag === 'img' && /chat-line__message--emote/.test(e.cls ?? ''));
  process.stdout.write(`emote size          ref ${refEmote?.r.slice(2).join('×') ?? '—'}  rep ${replica.emote?.slice(2).join('×') ?? '—'}\n`);
  process.stdout.write(`first badge x       ref ${refBadges[0]?.r[0]}  rep ${replica.badge?.[0]}\n`);
  const bottom = r => (r ? (r[1] + r[3]).toFixed(1) : '—');
  process.stdout.write(`last line bottom    ref ${bottom(refLines.at(-1))}  rep ${bottom(replica.lines.at(-1))}\n`);
  process.stdout.write(`chat list ${JSON.stringify(replica.list)} scroller ${JSON.stringify(replica.scroller)} tail ${JSON.stringify(replica.tail)}\n`);
  process.stdout.write(`\nfonts loaded in the replica: ${[...new Set(replica.fonts)].join(', ')}\n`);
  process.stdout.write(`mean absolute difference (covered, 0–255): ${evidence.meanDiff.toFixed(2)}\n`);
  process.stdout.write(`text style differences: ${styleMismatch}, colour differences: ${colourMismatch}\n`);
  process.stdout.write(`\nplayer rect, normal:  ${JSON.stringify(layouts.normal.player)}\nplayer rect, theatre: ${JSON.stringify(layouts.theatre.player)}\n`);
  process.stdout.write(`panel rect, normal:   ${JSON.stringify(layouts.normal.panel)}\npanel rect, scroll 520: ${JSON.stringify(layouts.scrolled.panel)}\n`);
  process.stdout.write(`panel ${layouts.src}: ${layouts.panelText}\n`);
  for (const b of layouts.buttons) {
    const at = [layouts.scrolled.panel.x + b.inPanel[0], layouts.scrolled.panel.y + b.inPanel[1]].map(v => Math.round(v * 10) / 10);
    process.stdout.write(`panel button "${b.text}" ${b.size.join('×')} at ${b.inPanel.join(',')} in the panel; viewport at scroll 520: ${at.join(',')}\n`);
  }
  process.stdout.write(`sample rects at t=${sampleT}: ${JSON.stringify(sampleRects)}\n`);
  process.stdout.write(`\nwrote ${evidenceFile}\nwrote ${join(EVIDENCE, 'replica-sample@1920x1080.png')}\n`);
} finally {
  await browser?.close();
  await release();
  await studio.close();
}
