/* global URLSearchParams:readonly */
// Captures the citizen-behaviour bench on the real motion and renderer:
//   greeting — the first doorstep-street encounter at web sizes, a midday grounding frame and timed sheets
//              (look → gesture → settle; walker takeover; departure);
//   routine  — street, market and home frames at web sizes, a midday grounding frame, one timed routine
//              sheet through a complete stroll, and the closed-market branch;
//   chat     — a witnessed line at web sizes and midday, a timed look sheet (lift → nod → two staggered looks →
//              settle), the no-storm burst frame and sheet, walker takeover and reconnect sheets;
//   town     — the 240-slot town at dusk, from above and in a lane.
//   node apps/web/src/citizen-behaviour-bench/capture.mjs --base-url http://127.0.0.1:5196 [--only greeting,routine,chat,town]
// Without --base-url it starts its own preview (port from CHATDOM_BEHAVIOUR_PORT, default any free port).
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const only = new Set((option('--only') ?? 'greeting,routine,chat,town').split(','));
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/citizen-behaviour`;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview('CHATDOM_BEHAVIOUR_PORT'));
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const errors = [];
  const open = async (query, width, height) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(`${JSON.stringify(query)}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${JSON.stringify(query)}: ${message.text()}`); });
    await page.goto(`${base}/-/citizen-behaviour?${new URLSearchParams(query)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomBehaviourError === 'string', {}, { timeout: 900_000 });
    const failure = await page.evaluate(() => window.__chatdomBehaviourError);
    if (failure) throw new Error(`${JSON.stringify(query)}: ${failure}`);
    if (errors.length) throw new Error(errors.join('\n'));
    return page;
  };
  const seek = async (page, seconds) => {
    await page.evaluate(t => window.__chatdomBehaviourSeek(t), seconds);
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 900_000 });
    if (errors.length) throw new Error(errors.join('\n'));
    const report = await page.evaluate(() => window.__chatdomBehaviour);
    if (!report.lightSettled) console.warn(`[capture] window light still refining at ${seconds.toFixed(2)} s`);
    return report;
  };
  const report = page => page.evaluate(() => window.__chatdomBehaviour);
  const frame = async (name, query, width, height, check) => {
    const page = await open(query, width, height);
    const current = await report(page);
    check?.(current);
    await page.screenshot({ path: `${output}/${name}@${width}x${height}.png` });
    await page.close();
    console.log(`[capture] ${name}@${width}x${height}`);
    return current;
  };

  /** A timed contact sheet on one still page, sought forward through the story. */
  const sheet = async (name, query, frames, title, detail) => {
    const page = await open({ ...query, t: String(frames[0].t), frame: 'still' }, 560, 420);
    const tiles = [];
    for (const item of frames) {
      const current = await seek(page, item.t);
      const path = `${output}/${name}-${item.t.toFixed(2)}.png`;
      await page.screenshot({ path });
      tiles.push({ ...item, data: (await readFile(path)).toString('base64'), detail: detail(current) });
    }
    await page.close();
    const columns = 4, tile = 560 / 1.4, rows = Math.ceil(tiles.length / columns), width = columns * tile + (columns + 1) * 10;
    const html = `<body style="margin:0;background:#28232a;font-family:Georgia;color:#efe3c8"><div style="padding:14px 14px 4px"><div style="font-size:20px">Chatdom · citizens at ease · ${escape(title)}</div><div style="font-size:12px;letter-spacing:.14em;color:#e8bd62;margin-top:4px">SIMULATED neighbours · real motion and citizen renderer · times in kingdom seconds</div></div><div style="display:grid;grid-template-columns:repeat(${columns},${tile}px);gap:10px;padding:10px">${tiles.map(t => `<figure style="margin:0"><img style="width:${tile}px;height:${tile * .75}px;display:block;border:1px solid #8d7650" src="data:image/png;base64,${t.data}"><figcaption style="font-size:12px;padding:4px 2px"><b style="color:#f2c56b;font-weight:normal">${escape(t.label)}</b> · ${t.t.toFixed(2)} s<br><span style="font-size:10px;color:#c9b48e">${escape(t.detail)}</span></figcaption></figure>`).join('')}</div></body>`;
    const composer = await browser.newPage({ viewport: { width: Math.ceil(width), height: 80 + rows * (tile * .75 + 60) } });
    await composer.setContent(html); await composer.screenshot({ path: `${output}/${name}-sheet.png`, fullPage: true }); await composer.close();
    console.log(`[capture] ${name}-sheet.png`);
  };

  if (only.has('greeting')) {
    // Read the story's real encounter times from the bench itself.
    const probe = await open({ t: '0', frame: 'still' }, 320, 240);
    const { encounter } = await report(probe);
    await probe.close();
    console.log(`[capture] encounter: slot ${encounter.greeter} ${encounter.gesture}s to slot ${encounter.recipient}, ${encounter.start.toFixed(1)}–${encounter.end.toFixed(1)} s`);
    const visible = current => { if (!current.overlays.some(o => o.slot === encounter.greeter && o.gesture === encounter.gesture)) throw new Error('The greeting gesture is not visible at its own pose time.'); };
    const deepest = encounter.pose + Math.PI / 6;
    for (const [width, height] of [[1440, 900], [390, 844]]) for (const hour of width === 1440 ? ['19', '12'] : ['19']) {
      await frame(`doorstep-${hour === '12' ? 'midday' : 'dusk'}`, { t: String(deepest), hour, view: 'doorstep' }, width, height, visible);
    }
    const greeting = current => {
      const greeter = current.overlays.find(o => o.slot === encounter.greeter), recipient = current.overlays.find(o => o.slot === encounter.recipient);
      return `noticer ${greeter ? `${greeter.gesture} · yaw ${greeter.lookYaw.toFixed(2)}` : 'at rest'} · other ${recipient ? `yaw ${recipient.lookYaw.toFixed(2)}` : 'at rest'}`;
    };
    const e = encounter, lookEnd = e.poseEnd + (e.end - e.poseEnd) * .4;
    await sheet('greeting', { view: 'close', scenario: 'encounter' }, [
      { t: e.start - .6, label: 'walking' }, { t: e.start + (e.pose - e.start) * .5, label: 'head turns' }, { t: e.pose + .05, label: 'gesture begins' },
      { t: deepest, label: 'deepest' }, { t: e.poseEnd - .08, label: 'gesture ends' }, { t: lookEnd, label: 'holds the look' },
      { t: e.end - .2, label: 'settling' }, { t: e.end + .4, label: 'at ease' },
    ], `${e.gesture} · look, pose, settle`, greeting);
    const cut = e.pose + .3;
    await sheet('takeover', { view: 'close', scenario: 'takeover' }, [
      { t: cut - .1, label: 'mid-gesture' }, { t: cut + .1, label: 'walker control' }, { t: cut + .3, label: 'glance easing' }, { t: cut + .6, label: 'released' },
    ], 'walker takeover', greeting);
    await sheet('departure', { view: 'close', scenario: 'departure' }, [
      { t: cut - .1, label: 'mid-gesture' }, { t: cut + .15, label: 'neighbour left' }, { t: e.poseEnd + .05, label: 'dip finished' }, { t: e.poseEnd + .6, label: 'settled' },
    ], 'neighbour leaves', greeting);
  }

  if (only.has('routine')) {
    const beatsOf = async scenario => {
      const page = await open({ t: '0', frame: 'still', scenario }, 320, 240);
      const { routine } = await report(page);
      await page.close();
      console.log(`[capture] ${scenario}: slot ${routine.slot} · ${routine.beats.map(b => `${b.kind} ${b.from.toFixed(1)}–${b.to.toFixed(1)}`).join(' · ')}`);
      return routine;
    };
    const describe = current => current.subject
      ? `${current.subject.routine} · ${current.subject.activity}${Math.abs(current.subject.lookYaw) > .02 ? ` · head ${current.subject.lookYaw.toFixed(2)}` : ''}${current.subject.gesture !== 'none' ? ` · ${current.subject.gesture}` : ''}`
      : 'held';
    const stroll = await beatsOf('stroll'), market = await beatsOf('market'), closed = await beatsOf('closed');
    const beat = (routine, kind, index = 0) => routine.beats.filter(b => b.kind === kind)[index];
    // A look holds from ~1.0–2.0 s after an arrival; these frames sit inside it.
    const strollStop = beat(stroll, 'pause'), marketStop = beat(market, 'pause'), marketHome = beat(market, 'rest', 1);
    const pausing = kind => current => { if (current.subject?.activity !== kind) throw new Error(`Expected the subject ${kind}, saw ${JSON.stringify(current.subject)}`); };
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await frame('street-stroll-dusk', { scenario: 'stroll', t: String(strollStop.from + 1.6), view: 'follow' }, width, height, pausing('pausing'));
      await frame('market-dusk', { scenario: 'market', t: String(marketStop.from + 1.7), view: 'market' }, width, height, pausing('pausing'));
      await frame('home-dusk', { scenario: 'market', t: String(marketHome.from + 1.9), view: 'follow' }, width, height, pausing('resting'));
    }
    await frame('street-wide-dusk', { scenario: 'stroll', t: String(strollStop.from + 1.6), view: 'street' }, 1440, 900);
    await frame('street-stroll-midday', { scenario: 'stroll', t: String(beat(stroll, 'walk').from + 3), view: 'follow', hour: '12' }, 1440, 900);
    // One complete routine, timed: the doorstep, out, a pause with a look, back, the doorstep again.
    const out = beat(stroll, 'walk', 0), back = beat(stroll, 'walk', 1), home = beat(stroll, 'rest', 1);
    await sheet('routine', { scenario: 'stroll', view: 'follow' }, [
      { t: beat(stroll, 'rest').from + .5, label: 'resting at the door' }, { t: out.from + .5, label: 'sets off' },
      { t: (out.from + out.to) / 2, label: 'strolling' }, { t: strollStop.from + .25, label: 'arrives · settles' },
      { t: strollStop.from + 1.6, label: 'looks along the lane' }, { t: back.from + .6, label: 'turns for home' },
      { t: home.from + .3, label: 'home · window warm' }, { t: home.from + 1.9, label: 'settled at the door' },
    ], `one stroll, ${(home.from - out.from).toFixed(0)} s door to door`, describe);
    const refused = beat(closed, 'wait'), instead = beat(closed, 'pause');
    await sheet('closed', { scenario: 'closed', view: 'follow' }, [
      { t: refused.from + .4, label: 'route refused' }, { t: (refused.from + refused.to) / 2, label: 'resting where they stand' },
      { t: instead.from + 1.6, label: 'a stroll instead' }, { t: beat(closed, 'rest', 1).from + .4, label: 'home again' },
    ], 'the market closed (simulated reserved action)', describe);
  }

  if (only.has('chat')) {
    const lineOf = async scenario => {
      const page = await open({ t: '0', frame: 'still', scenario }, 320, 240);
      const { chat } = await report(page);
      await page.close();
      console.log(`[capture] ${scenario}: slot ${chat.speaker} · nod ${chat.nod.toFixed(2)}–${chat.nodEnd.toFixed(2)} s · listeners ${chat.listeners.map(l => `${l.slot}@${l.at.toFixed(2)}`).join(', ') || 'none'} · ${chat.reactions}/${chat.lines} lines turned heads · ${chat.outcomes.map(o => `${o.id.replace('simulated-', '')}:${o.outcome}`).join(' ')}`);
      return chat;
    };
    const heads = current => {
      const { chat } = current, of = slot => current.overlays.find(o => o.slot === slot);
      const speaker = of(chat.speaker), parts = [`speaker ${speaker ? `${speaker.gesture === 'none' ? 'still' : speaker.gesture} · yaw ${speaker.lookYaw.toFixed(2)}` : 'no overlay'}`];
      for (const listener of chat.listeners) { const o = of(listener.slot); parts.push(`${listener.slot}: ${o ? `yaw ${o.lookYaw.toFixed(2)}` : 'at rest'}`); }
      return `${parts.join(' · ')} · ${current.bubbles} bubble${current.bubbles === 1 ? '' : 's'}`;
    };
    const line = await lineOf('chat'), [first, second] = line.listeners;
    const bothLook = second ? (second.at + Math.min(first.out, second.out)) / 2 + .2 : (first.at + first.out) / 2;
    const looking = current => { if (!current.overlays.some(o => o.slot === first.slot && Math.abs(o.lookYaw) > .15)) throw new Error('The first listener is not looking at the speaker.'); };
    for (const [width, height] of [[1440, 900], [390, 844]]) for (const hour of width === 1440 ? ['19', '12'] : ['19']) {
      await frame(`chat-${hour === '12' ? 'midday' : 'dusk'}`, { scenario: 'chat', t: String(bothLook), hour, view: 'doorstep' }, width, height, looking);
    }
    await sheet('chat', { scenario: 'chat', view: 'doorstep' }, [
      { t: line.start - .5, label: 'at ease' }, { t: (line.start + line.nod) / 2, label: 'the speaker lifts' }, { t: line.nod + .26, label: 'nod' },
      { t: first.at + .22, label: 'a neighbour turns' }, { t: (second ?? first).at + .3, label: second ? 'the second turns' : 'looking' },
      { t: bothLook, label: 'both look' }, { t: Math.max(first.out, second?.out ?? 0) + .25, label: 'settling' }, { t: line.end + .3, label: 'at ease' },
    ], 'a line in chat · lift, nod, staggered looks, settle', heads);

    const burst = await lineOf('burst');
    const crowd = current => { if (current.chat.reactions > 2) throw new Error(`A burst turned ${current.chat.reactions} lines into reactions.`); };
    for (const [width, height] of [[1440, 900], [390, 844]]) await frame('burst-dusk', { scenario: 'burst', t: String(burst.nod + .5), view: 'doorstep' }, width, height, crowd);
    await frame('burst-street-dusk', { scenario: 'burst', t: String(burst.nod + .5), view: 'street' }, 1440, 900, crowd);
    await sheet('burst', { scenario: 'burst', view: 'doorstep' }, [
      { t: burst.start - .3, label: 'before' }, { t: burst.nod + .2, label: 'six lines arrive' }, { t: burst.nod + .9, label: 'a second reaction' }, { t: burst.end + .3, label: 'settled' },
    ], `a burst · ${burst.reactions} of ${burst.lines} lines turn heads`, heads);

    const walker = await lineOf('chat-walker'), watcher = walker.listeners[0];
    await sheet('chat-walker', { scenario: 'chat-walker', view: 'doorstep' }, [
      { t: walker.nod + .15, label: 'nod begins' }, { t: walker.cut + .1, label: 'walker control' },
      { t: (watcher.at + watcher.out) / 2, label: 'neighbours still look' }, { t: walker.end + .3, label: 'settled' },
    ], 'the speaker comes under walker control (simulated)', heads);

    const reconnect = await lineOf('reconnect'), heard = reconnect.listeners[0];
    await sheet('reconnect', { scenario: 'reconnect', view: 'doorstep' }, [
      { t: heard.at + .45, label: 'neighbours look' }, { t: reconnect.cut - .05, label: 'source drops' },
      { t: reconnect.cut + .05, label: 'reconnected · reset' }, { t: reconnect.cut + 1.5, label: 'line not replayed' },
    ], 'a reconnect mid-look (simulated)', heads);
  }

  if (only.has('town')) {
    // 240 simulated neighbours, settled into their evening: arrivals end at 120 s.
    for (const [width, height] of [[1440, 900], [390, 844]]) await frame('town-above-dusk', { scenario: 'town', t: '150', view: 'aerial' }, width, height);
    await frame('town-lane-dusk', { scenario: 'town', t: '150', view: 'follow' }, 1440, 900);
  }
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await release?.();
}
