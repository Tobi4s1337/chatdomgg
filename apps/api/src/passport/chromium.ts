/**
 * A warm Chromium that draws passport share compositions to PNG. One browser for the process, one picture at a
 * time, a bounded queue, a deadline per picture and explicit disposal: no browser per visitor, no retry loop.
 *
 * The page it draws is the composition alone. Scripts are off, every network request is refused (fonts and marks
 * are inline), and the composition carries its own `default-src 'none'` policy, so a name can never make the
 * renderer fetch, run or reveal anything. Playwright is loaded only when the first picture is asked for; main's
 * production packaging keeps the dependency or binds an equivalent `PassportImageRenderer`.
 */
import type { Browser } from '@playwright/test';
import { SHARE_SIZE, type PassportShare } from '../../../../packages/ui/src/passport/craft';
import { PassportRendererBusy, type PassportImageRenderer } from './share';

export type ChromiumPassportRendererOptions = Readonly<{
  /** Launch the browser. Defaults to Playwright's headless Chromium. */
  launch?: () => Promise<Browser>;
  /** Pictures waiting behind the one being drawn before new ones are refused as busy. */
  queue?: number;
}>;

export interface ChromiumPassportRenderer extends PassportImageRenderer {
  /** Close the browser and refuse further pictures. Pictures already waiting reject. */
  dispose(): Promise<void>;
}

const defaultLaunch = async (): Promise<Browser> => {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'] });
};

const aborted = (signal: AbortSignal) => signal.reason instanceof Error ? signal.reason : new Error('The picture was abandoned');

export function createChromiumPassportImageRenderer(options: ChromiumPassportRendererOptions = {}): ChromiumPassportRenderer {
  const launch = options.launch ?? defaultLaunch;
  const limit = Math.max(0, options.queue ?? 4);
  let browser: Promise<Browser> | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let waiting = 0;
  let disposed = false;

  const warm = () => {
    if (!browser) {
      const starting = launch();
      browser = starting;
      // A browser that crashes or is closed elsewhere is forgotten, so the next picture starts a fresh one.
      starting.then(b => b.on('disconnected', () => { if (browser === starting) browser = null; }), () => { if (browser === starting) browser = null; });
    }
    return browser;
  };

  async function draw(share: PassportShare, signal: AbortSignal): Promise<Uint8Array> {
    if (signal.aborted) throw aborted(signal);
    const context = await (await warm()).newContext({
      viewport: { width: SHARE_SIZE.width, height: SHARE_SIZE.height }, deviceScaleFactor: 1, javaScriptEnabled: false,
      offline: true, serviceWorkers: 'block', reducedMotion: 'reduce',
    });
    const stop = () => { void context.close().catch(() => undefined); };
    signal.addEventListener('abort', stop, { once: true });
    try {
      await context.route('**/*', route => route.abort('blockedbyclient'));
      const page = await context.newPage();
      await page.setContent(share.html, { waitUntil: 'load', timeout: 10_000 });
      // Inline fonts still decode asynchronously: wait for them so no picture is drawn in a fallback face.
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      if (signal.aborted) throw aborted(signal);
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...SHARE_SIZE }, animations: 'disabled', timeout: 10_000 });
      if (signal.aborted) throw aborted(signal);
      return new Uint8Array(png);
    } finally {
      signal.removeEventListener('abort', stop);
      stop();
    }
  }

  return {
    render(share, signal) {
      if (disposed) return Promise.reject(new Error('The passport renderer is closed'));
      if (waiting > limit) return Promise.reject(new PassportRendererBusy());
      waiting++;
      const job = tail.then(() => {
        if (disposed) throw new Error('The passport renderer is closed');
        return draw(share, signal);
      });
      tail = job.catch(() => undefined).finally(() => { waiting--; });
      return job;
    },
    async dispose() {
      disposed = true;
      const open = browser;
      browser = null;
      await (await open?.catch(() => null))?.close().catch(() => undefined);
    },
  };
}
