import { writeFile } from 'node:fs/promises';

/**
 * The one browser page an RS10 stage drives, on either renderer:
 * - `openSwiftShaderPage`: headless Chrome here, software WebGL, under the shared capture lock.
 * - `openPcPage`: Tobias's own Chrome on a real GPU, reached through his tunnel's DevTools port while this lane holds
 *   pc-lease. It speaks raw CDP to one target in its own browser context (no cookies or tabs of his are touched, and
 *   the context is disposed afterwards) instead of attaching a driver to his whole browser.
 */
export interface StagePage {
  readonly renderer: string;
  readonly errors: string[];
  readonly console: string[];
  goto(url: string): Promise<void>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  waitReady(ms: number): Promise<void>;
  screenshot(path: string): Promise<void>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const RENDERER = `(() => { const gl = document.createElement('canvas').getContext('webgl2'); if (!gl) return 'no WebGL';
  const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`;
const READY = 'window.__chatdomReady === true';

export async function openSwiftShaderPage(width: number, height: number): Promise<StagePage> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors: string[] = [], lines: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') lines.push(`${message.type()}: ${message.text()}`.slice(0, 400)); });
  page.on('requestfailed', request => lines.push(`failed: ${request.url()} ${request.failure()?.errorText ?? ''}`.slice(0, 300)));
  page.on('response', response => { if (response.status() >= 400) lines.push(`http ${response.status()}: ${response.url()}`.slice(0, 300)); });
  await page.goto('about:blank');
  const renderer = String(await page.evaluate(RENDERER));
  return {
    renderer, errors, console: lines,
    goto: async url => { await page.goto(url); },
    evaluate: fn => page.evaluate(fn),
    waitReady: async ms => { await page.waitForFunction(READY, null, { timeout: ms }); },
    screenshot: async path => { await page.screenshot({ path, timeout: 60_000 }); },
    close: () => browser.close(),
  };
}

interface CdpMessage { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; result?: unknown; error?: { message: string } }

/** Opens one page on the PC's Chrome. Throws when the tunnel is down: the caller holds pc-lease, which checked it. */
export async function openPcPage(width: number, height: number, cdp = process.env.PC_CDP ?? 'http://127.0.0.1:9333'): Promise<StagePage> {
  const version = await (await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(4_000) })).json() as { webSocketDebuggerUrl: string };
  // Chrome names its own port; the tunnel's end is the address that answers here.
  const socket = new WebSocket(version.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/u, cdp.replace(/^http/u, 'ws')));
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('The PC DevTools socket did not open')); });
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners: ((message: CdpMessage) => void)[] = [];
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    const waiter = message.id ? pending.get(message.id) : undefined;
    if (waiter) { pending.delete(message.id!); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); return; }
    for (const listen of listeners) listen(message);
  };
  const send = <T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<T>((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve: value => resolve(value as T), reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { browserContextId } = await send<{ browserContextId: string }>('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', browserContextId, newWindow: true, background: false });
  const { sessionId } = await send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  const on = (method: string, params: Record<string, unknown> = {}) => send(method, params, sessionId);
  const errors: string[] = [], lines: string[] = [];
  listeners.push(message => {
    if (message.sessionId !== sessionId || !message.params) return;
    const params = message.params as Record<string, unknown>;
    if (message.method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails as { text: string; exception?: { description?: string } };
      errors.push((details.exception?.description ?? details.text).split('\n')[0]!);
    } else if (message.method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'warning')) {
      lines.push(`${params.type}: ${(params.args as { value?: unknown; description?: string }[]).map(arg => String(arg.value ?? arg.description ?? '')).join(' ')}`.slice(0, 400));
    } else if (message.method === 'Network.loadingFailed') {
      lines.push(`failed: ${String(params.errorText)}${params.canceled ? ' (canceled)' : ''}`.slice(0, 300));
    } else if (message.method === 'Network.responseReceived') {
      const response = params.response as { status: number; url: string };
      if (response.status >= 400) lines.push(`http ${response.status}: ${response.url}`.slice(0, 300));
    }
  });
  await on('Page.enable'); await on('Runtime.enable'); await on('Network.enable');
  await on('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await on('Page.bringToFront');
  // A minimised window draws no frames, so the page would never say it is ready.
  try {
    const { windowId, bounds } = await send<{ windowId: number; bounds: { windowState?: string } }>('Browser.getWindowForTarget', { targetId });
    if (bounds.windowState === 'minimized') await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  } catch { /* the window is managed by his desktop */ }

  const run = async <T>(expression: string): Promise<T> => {
    const answer = await on('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }) as { result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } };
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
    return answer.result.value;
  };
  const until = async (expression: string, ms: number, what: string) => {
    for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(250)) {
      if (await run<boolean>(expression).catch(() => false)) return;
    }
    throw new Error(`${what} within ${ms} ms`);
  };
  const renderer = await run<string>(RENDERER);
  return {
    renderer, errors, console: lines,
    goto: async url => { await on('Page.navigate', { url }); await until(`document.readyState !== 'loading' && location.href !== 'about:blank'`, 60_000, `Load ${url}`); },
    evaluate: fn => run(`(${fn.toString()})()`),
    waitReady: ms => until(READY, ms, 'The page was not ready'),
    screenshot: async path => { const { data } = await on('Page.captureScreenshot', { format: 'png' }) as { data: string }; await writeFile(path, Buffer.from(data, 'base64')); },
    close: async () => {
      await send('Target.closeTarget', { targetId }).catch(() => {});
      await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
      socket.close();
    },
  };
}
