import { mkdir, writeFile } from 'node:fs/promises';

// Run only inside our GPU lease, with our already-built preview on 5192.
// An isolated browser context supplies an empty cache without clearing anybody else's browser data.
const base = 'http://127.0.0.1:9333';
const directory = 'work/evidence/grand-world';
const version = await (await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(4_000) })).json();
const socket = new WebSocket(version.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, base.replace('http', 'ws')));
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let serial = 0, session;
const pending = new Map(), network = { completedBytes: 0, completedResources: 0, diskCacheResponses: 0 };
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  } else if (message.sessionId === session) {
    if (message.method === 'Network.loadingFinished') {
      network.completedBytes += message.params.encodedDataLength; network.completedResources++;
    } else if (message.method === 'Network.responseReceived' && message.params.response.fromDiskCache) network.diskCacheResponses++;
  }
};
function send(method, params = {}, sessionId) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
const page = (method, params) => send(method, params, session);
async function evaluate(expression) {
  const value = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
  return value.result.value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let context;
try {
  ({ browserContextId: context } = await send('Target.createBrowserContext', { disposeOnDetach: true }));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: context, background: false });
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
  await page('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page('Page.bringToFront');
  const { windowId, bounds } = await send('Browser.getWindowForTarget', { targetId });
  if (bounds.windowState === 'minimized') await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__grandLoad = { loaderFrameMs: null, readyFrameMs: null };
    const observe = () => {
      const gate = document.querySelector('.stream-curtain');
      if (window.__grandLoad.loaderFrameMs === null && gate?.getBoundingClientRect().width > 0)
        window.__grandLoad.loaderFrameMs = performance.now();
      const kingdom = window.__chatdomKingdom;
      if (window.__chatdomReady && kingdom?.inspect().renderCompletedAt > 0) {
        window.__grandLoad.readyFrameMs = performance.now(); return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  ` });
  await page('Page.navigate', { url: 'http://localhost:5192/stream?source=realm&kingdom=129634568&hour=17.5' });
  const deadline = Date.now() + 150_000;
  let loaded;
  while (Date.now() < deadline) {
    loaded = await evaluate('window.__grandLoad').catch(() => null);
    if (loaded?.readyFrameMs !== null && loaded?.readyFrameMs !== undefined) break;
    await sleep(500);
  }
  if (!loaded?.readyFrameMs) throw new Error('Native stream did not draw its loaded frame within 150 seconds');
  await evaluate('document.fonts.ready.then(() => true)');
  const firstNetwork = { ...network };
  const snapshot = `(() => { const k = window.__chatdomKingdom, i = k.inspect(); return {
    stats: k.stats, land: i.land, water: i.water, loaded: i.loaded,
    renderStartedAt: i.renderStartedAt, renderCompletedAt: i.renderCompletedAt,
    visibility: document.visibilityState, placeShot: i.placeShot
  }; })()`;
  const before = await evaluate(snapshot);
  const frames = await evaluate(`new Promise(resolve => {
    const samples = []; let last = null, lastDraw = null, drawn = 0;
    const end = performance.now() + 10000;
    function frame(now) {
      if (last !== null) samples.push(now - last); last = now;
      const completed = window.__chatdomKingdom.inspect().renderCompletedAt;
      if (lastDraw !== null && completed > lastDraw) drawn++; lastDraw = completed;
      if (now < end) return requestAnimationFrame(frame);
      const sorted = [...samples].sort((a,b) => a-b), q = p => sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
      resolve({samples:samples.length,renderAdvanceSamples:drawn,p50:q(.5),p95:q(.95),p99:q(.99),worst:sorted.at(-1),over33:samples.filter(x=>x>33.4).length});
    } requestAnimationFrame(frame);
  })`);
  const after = await evaluate(snapshot);
  if (after.renderCompletedAt <= before.renderCompletedAt || frames.renderAdvanceSamples === 0) throw new Error('RAF advanced without a rendered world');
  const gpu = (await send('SystemInfo.getInfo')).gpu.devices.map(device => ({
    vendor: device.vendorString, device: device.deviceString, driver: device.driverVersion,
  }));
  const hours = [];
  await mkdir(directory, { recursive: true });
  const report = { browser: version.Browser, gpu, cache: 'new isolated browser context', loaded, network: firstNetwork,
    timingMeaning: 'RAF-observed visible loader and loaded render submission; not GPU timer queries or walk readiness',
    before, frames, after, hours, complete: false };
  const save = () => writeFile(`${directory}/gw10-native-cold.json`, JSON.stringify(report, null, 2) + '\n');
  await save();
  for (const [name, hour] of [['golden',17.5],['dawn',6.5],['noon',12],['night',22]]) {
    await evaluate(`window.__chatdomKingdom.hour(${hour})`);
    const limit = Date.now() + 20_000;
    while (Date.now() < limit) {
      if (await evaluate(`Math.abs(window.__chatdomKingdom.stats.hour - ${hour}) < .01`)) break;
      await sleep(250);
    }
    const state = await evaluate(snapshot);
    if (Math.abs(state.stats.hour-hour) >= .01) throw new Error(`The shared hour did not reach ${hour}`);
    const { data } = await page('Page.captureScreenshot', { format: 'png' });
    const path = `${directory}/gw10-native-stream-${name}@1920x1080.png`;
    await writeFile(path, Buffer.from(data, 'base64'));
    hours.push({ hour, path, state }); console.log(JSON.stringify({ captured: path, hour: state.stats.hour }));
    await save();
  }
  report.complete = true; await save();
  console.log(JSON.stringify({ loaded, network:firstNetwork, frames, renderAdvance:after.renderCompletedAt-before.renderCompletedAt }));
} finally {
  if (context) await send('Target.disposeBrowserContext', { browserContextId: context }).catch(() => {});
  socket.close();
  for (const request of pending.values()) clearTimeout(request.timer);
}
