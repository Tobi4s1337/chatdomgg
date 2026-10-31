import { describe, expect, it } from 'vitest';
import { simulatedPassport } from '../../../../packages/ui/src/passport/craft';
import type { PassportShare } from '../../../../packages/ui/src/passport/craft';
import type { CitizenKey } from '../citizen-card/contracts';
import { createChromiumPassportImageRenderer } from './chromium';
import type { PassportReply, VisiblePassportBook } from './contracts';
import type { PersonId } from '../citizen-card/contracts';
import { createPassportReader, type PassportReader, type PassportSnapshot } from './read';
import { PassportRendererBusy, createPassportShareHttp, isShareImage, type PassportImageRenderer, type PassportShareFault } from './share';
import { simulatedPassportAuthorities, type SimulatedScenario } from './simulated';

/** The smallest bytes `isShareImage` accepts: a PNG signature and an IHDR naming 1200 x 800. */
function png(marker = 0): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1200); view.setUint32(20, 800);
  bytes[39] = marker;
  return bytes;
}

/** A renderer that records what it was asked to draw and can run something while it "draws". */
function recordingRenderer(during: (call: number) => void | Promise<void> = () => undefined): PassportImageRenderer & { drawn: PassportShare[] } {
  const drawn: PassportShare[] = [];
  return {
    drawn,
    async render(share) {
      drawn.push(share);
      await during(drawn.length);
      return png(drawn.length);
    },
  };
}

const KEY = { personId: '930000001', kingdomId: '910000101' } as CitizenKey;

const GORSEHOLD = new Map([['910000101', 'Gorsehold']]);
/** A snapshot as the reader makes one from a reply: the card's places and disclosure revision alongside. */
const snapshotOf = (reply: PassportReply, places: ReadonlyMap<string, string> = GORSEHOLD, revision = 3): PassportSnapshot =>
  reply.kind !== 'book' ? { kind: 'unavailable' }
  : reply.book.visibility === 'hidden' ? { kind: 'hidden' }
  : { kind: 'visible', book: reply.book, places, disclosure: { origin: reply.book.origin, travels: 'shown', revision } };

/** A reader stub that answers each book read from a script, so the handler's order of operations can be watched. */
function scriptedReader(script: (PassportReply | PassportSnapshot)[]): PassportReader & { reads: number } {
  const stub = {
    reads: 0,
    async handle(): Promise<PassportReply> { throw new Error('the share handler reads snapshots only'); },
    async snapshot() {
      const entry = script[Math.min(stub.reads, script.length - 1)]!;
      stub.reads++;
      return 'book' in entry && entry.kind === 'book' || entry.kind === 'denied' || entry.kind === 'page' ? snapshotOf(entry as PassportReply) : entry as PassportSnapshot;
    },
  };
  return stub;
}

const book = (revision = 'p1.1.1.1.1', name = 'Pellam Rook'): PassportReply =>
  ({ kind: 'book', book: { ...(simulatedPassport('few') as VisiblePassportBook), revision, holder: { personId: '930000001' as PersonId, name } } });
const hidden: PassportReply = { kind: 'book', book: { version: 1, origin: 'simulated', visibility: 'hidden' } };

function handlerWith(reader: PassportReader, renderer: PassportImageRenderer, faults: PassportShareFault[] = []) {
  return createPassportShareHttp({ reader, renderer, subject: async () => KEY, clock: () => 0, report: fault => faults.push(fault) });
}
const get = (method = 'GET') => new Request('https://chatdom.example/-/citizens/910000101/930000001/passport.png', { method });

describe('the passport share image over HTTP', () => {
  it('reads the book fresh, draws it, reads again and only then serves the picture, never stored', async () => {
    const reader = scriptedReader([book()]);
    const renderer = recordingRenderer();
    const answer = await handlerWith(reader, renderer).handle(get());
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('image/png');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(isShareImage(new Uint8Array(await answer.arrayBuffer()))).toBe(true);
    expect(reader.reads).toBe(2);
    expect(renderer.drawn[0]!.spread.holder.name).toBe('Pellam Rook');
    // A second request is a second fresh read: there is no picture kept to answer from.
    await handlerWith(reader, renderer).handle(get());
    expect(reader.reads).toBe(4);
    expect(renderer.drawn).toHaveLength(2);
  });

  it('draws nothing for a hidden book: 404, no picture, no travel words, the renderer never asked', async () => {
    const renderer = recordingRenderer();
    const answer = await handlerWith(scriptedReader([hidden]), renderer).handle(get());
    expect(answer.status).toBe(404);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('content-type')).not.toContain('image');
    expect(await answer.text()).not.toMatch(/Pellam|raid|journey|stamp/i);
    expect(renderer.drawn).toHaveLength(0);
  });

  it('throws away a picture when the travels were hidden while it was drawn', async () => {
    const faults: PassportShareFault[] = [];
    const answer = await handlerWith(scriptedReader([book(), hidden]), recordingRenderer(), faults).handle(get());
    expect(answer.status).toBe(404);
    expect(answer.headers.get('content-type')).not.toContain('image');
    expect(faults).toContainEqual({ kind: 'discarded', reason: 'hidden' });
  });

  it('throws away a picture of an older snapshot and draws the current one, once', async () => {
    const faults: PassportShareFault[] = [];
    const renderer = recordingRenderer();
    const answer = await handlerWith(scriptedReader([book('p1.1.1.1.1'), book('p1.2.2.1.1'), book('p1.2.2.1.1')]), renderer, faults).handle(get());
    expect(answer.status).toBe(200);
    expect(renderer.drawn.map(share => share.spread.revision)).toEqual(['p1.1.1.1.1', 'p1.2.2.1.1']);
    expect(new Uint8Array(await answer.arrayBuffer())[39]).toBe(2);
    expect(faults).toContainEqual({ kind: 'discarded', reason: 'moved' });
  });

  it('a holder renamed mid-draw is another snapshot too', async () => {
    const renderer = recordingRenderer();
    await handlerWith(scriptedReader([book('p1.1.1.1.1', 'Pellam Rook'), book('p1.1.1.1.1', 'Pellam of the Rook'), book('p1.1.1.1.1', 'Pellam of the Rook')]), renderer).handle(get());
    expect(renderer.drawn.map(share => share.spread.holder.name)).toEqual(['Pellam Rook', 'Pellam of the Rook']);
  });

  it('throws away a picture whose road names a home the card no longer shows, and draws it with the card as it is', async () => {
    const faults: PassportShareFault[] = [];
    const renderer = recordingRenderer();
    const few = book();
    const moved = new Map([['910000101', 'Gorse Hold on the Moor']]);
    const answer = await handlerWith(scriptedReader([snapshotOf(few), snapshotOf(few, moved, 4), snapshotOf(few, moved, 4)]), renderer, faults).handle(get());
    expect(answer.status).toBe(200);
    expect(renderer.drawn).toHaveLength(2);
    expect(renderer.drawn[0]!.html).toContain('By the road from <bdi dir="auto">Gorsehold</bdi>');
    expect(renderer.drawn[1]!.html).toContain('By the road from <bdi dir="auto">Gorse Hold on the Moor</bdi>');
    expect(renderer.drawn[1]!.html).not.toContain('<bdi dir="auto">Gorsehold</bdi>');
    expect(new Uint8Array(await answer.arrayBuffer())[39]).toBe(2);
    expect(faults).toContainEqual({ kind: 'discarded', reason: 'moved' });
  });

  it('treats a home taken off the card, or any newer disclosure, as another snapshot', async () => {
    const few = book();
    const gone = recordingRenderer();
    await handlerWith(scriptedReader([snapshotOf(few), snapshotOf(few, new Map(), 4), snapshotOf(few, new Map(), 4)]), gone).handle(get());
    expect(gone.drawn).toHaveLength(2);
    expect(gone.drawn[1]!.html).not.toContain('By the road from');
    // Hidden and shown again while the picture was drawn: the same book, but drawn under the newer disclosure.
    const again = recordingRenderer();
    await handlerWith(scriptedReader([snapshotOf(few, GORSEHOLD, 3), snapshotOf(few, GORSEHOLD, 5), snapshotOf(few, GORSEHOLD, 5)]), again).handle(get());
    expect(again.drawn).toHaveLength(2);
  });

  it('answers 503 rather than a picture of a moment that keeps passing', async () => {
    const answer = await handlerWith(scriptedReader([book('p1.1.1.1.1'), book('p1.2.1.1.1'), book('p1.3.1.1.1')]), recordingRenderer()).handle(get());
    expect(answer.status).toBe(503);
    expect(answer.headers.get('content-type')).not.toContain('image');
  });

  it('is honest when the passport or the renderer cannot answer', async () => {
    expect((await handlerWith(scriptedReader([{ kind: 'denied', code: 'unavailable' }]), recordingRenderer()).handle(get())).status).toBe(503);
    const busy: PassportImageRenderer = { render: () => Promise.reject(new PassportRendererBusy()) };
    const answer = await handlerWith(scriptedReader([book()]), busy).handle(get());
    expect(answer.status).toBe(503);
    expect(answer.headers.get('retry-after')).toBe('5');
    const faults: PassportShareFault[] = [];
    const garbage: PassportImageRenderer = { render: async () => new Uint8Array([1, 2, 3]) };
    expect((await handlerWith(scriptedReader([book()]), garbage, faults).handle(get())).status).toBe(503);
    expect(faults[0]?.kind).toBe('image');
  });

  it('answers HEAD after disclosure without drawing, refuses other methods, and 404s an unknown subject', async () => {
    const renderer = recordingRenderer();
    const head = await handlerWith(scriptedReader([book()]), renderer).handle(get('HEAD'));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('image/png');
    expect(renderer.drawn).toHaveLength(0);
    expect((await handlerWith(scriptedReader([hidden]), renderer).handle(get('HEAD'))).status).toBe(404);
    expect((await handlerWith(scriptedReader([book()]), renderer).handle(get('POST'))).status).toBe(405);
    const nobody = createPassportShareHttp({ reader: scriptedReader([book()]), renderer, subject: async () => null, clock: () => 0 });
    expect((await nobody.handle(get())).status).toBe(404);
  });
});

describe('the share image through the real reader and the card’s disclosure', () => {
  function realHandler(scenario: SimulatedScenario, during?: (flip: () => void) => void) {
    const sim = simulatedPassportAuthorities('few', scenario);
    let hide = false;
    const ports = { ...sim.ports, card: async (key: CitizenKey, signal: AbortSignal) => ({ ...await sim.ports.card(key, signal), ...(hide ? { travelsHidden: true } : {}) }) };
    const renderer = recordingRenderer(() => during?.(() => { hide = true; }));
    const handler = createPassportShareHttp({ reader: createPassportReader(ports), renderer, subject: async () => sim.key, clock: () => sim.now });
    return { handler, renderer };
  }

  it('before the first sign-in and with travels hidden, nothing is drawn', async () => {
    for (const scenario of [{ signedIn: false, travelsHidden: false }, { signedIn: true, travelsHidden: true }]) {
      const { handler, renderer } = realHandler(scenario);
      expect((await handler.handle(get())).status).toBe(404);
      expect(renderer.drawn).toHaveLength(0);
    }
  });

  it('a hide that lands while the picture is drawn wins: the late picture is never served', async () => {
    const { handler, renderer } = realHandler({ signedIn: true, travelsHidden: false }, flip => flip());
    const answer = await handler.handle(get());
    expect(renderer.drawn).toHaveLength(1);
    expect(answer.status).toBe(404);
    expect(answer.headers.get('content-type')).not.toContain('image');
  });

  it('refuses a stale cached card after a hide: no picture from the moment before', async () => {
    const sim = simulatedPassportAuthorities('few', { signedIn: true, travelsHidden: false });
    // A replica that has seen the hide (revision 4) and one that still holds revision 3, answering in turn.
    let stale = false;
    const ports = { ...sim.ports, card: async (key: CitizenKey, signal: AbortSignal) => {
      const source = await sim.ports.card(key, signal);
      return stale ? source : { ...source, travelsHidden: true, document: { ...source.document, revision: { ...source.document.revision, person: 4 } } };
    } };
    const renderer = recordingRenderer();
    const handler = createPassportShareHttp({ reader: createPassportReader(ports), renderer, subject: async () => sim.key, clock: () => sim.now });
    expect((await handler.handle(get())).status).toBe(404);
    stale = true;
    const answer = await handler.handle(get());
    expect(answer.status).toBe(503);
    expect(answer.headers.get('content-type')).not.toContain('image');
    expect(renderer.drawn).toHaveLength(0);
  });

  it('a home renamed on the card while the picture is drawn: the old road start is never released', async () => {
    const sim = simulatedPassportAuthorities('few', { signedIn: true, travelsHidden: false });
    let renamed = false;
    const ports = { ...sim.ports, card: async (key: CitizenKey, signal: AbortSignal) => {
      const source = await sim.ports.card(key, signal);
      if (!renamed) return source;
      const document = { ...source.document, kingdomName: 'Gorse Hold', revision: { ...source.document.revision, person: 4 },
        homes: source.document.homes.map(home => ({ ...home, kingdomName: 'Gorse Hold' })) };
      return { ...source, document };
    } };
    const renderer = recordingRenderer(call => { if (call === 1) renamed = true; });
    const handler = createPassportShareHttp({ reader: createPassportReader(ports), renderer, subject: async () => sim.key, clock: () => sim.now });
    expect((await handler.handle(get())).status).toBe(200);
    expect(renderer.drawn).toHaveLength(2);
    expect(renderer.drawn[1]!.html).toContain('By the road from <bdi dir="auto">Gorse Hold</bdi>');
  });

  it('a shown book is drawn with the card’s disclosed home naming where its roads began', async () => {
    const { handler, renderer } = realHandler({ signedIn: true, travelsHidden: false });
    expect((await handler.handle(get())).status).toBe(200);
    expect(renderer.drawn[0]!.html).toContain('By the road from <bdi dir="auto">Gorsehold</bdi>');
    expect(renderer.drawn[0]!.html).toContain('<b>SIMULATED</b>');
  });
});

describe('the warm renderer', () => {
  /** A stand-in browser whose screenshots wait for the test to let them go. */
  function fakeBrowser() {
    const pending: (() => void)[] = [];
    let contexts = 0, closed = 0;
    const browser = {
      on: () => browser,
      close: async () => undefined,
      newContext: async () => {
        contexts++;
        return {
          route: async () => undefined,
          close: async () => { closed++; },
          newPage: async () => ({
            setContent: async () => undefined,
            evaluate: async () => undefined,
            screenshot: () => new Promise<Uint8Array>(resolve => pending.push(() => resolve(png())))
          }),
        };
      },
    };
    return { browser, pending, counts: () => ({ contexts, closed }) };
  }
  const share = { html: '<!doctype html>', title: '', alt: '', spread: {} } as unknown as PassportShare;
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('draws one picture at a time, queues four more and refuses the rest as busy', async () => {
    const fake = fakeBrowser();
    const renderer = createChromiumPassportImageRenderer({ launch: async () => fake.browser as never });
    const signal = new AbortController().signal;
    const jobs = Array.from({ length: 5 }, () => renderer.render(share, signal));
    await expect(renderer.render(share, signal)).rejects.toBeInstanceOf(PassportRendererBusy);
    for (let i = 0; i < 5; i++) {
      while (!fake.pending.length) await settle();
      expect(fake.counts().contexts).toBe(i + 1);
      fake.pending.shift()!();
      expect(isShareImage(await jobs[i]!)).toBe(true);
    }
    expect(fake.counts().closed).toBeGreaterThanOrEqual(5);
    await renderer.dispose();
    await expect(renderer.render(share, signal)).rejects.toThrow(/closed/);
  });

  it('abandons a picture whose deadline passed, closing its page', async () => {
    const fake = fakeBrowser();
    const renderer = createChromiumPassportImageRenderer({ launch: async () => fake.browser as never });
    const controller = new AbortController();
    const job = renderer.render(share, controller.signal);
    while (!fake.pending.length) await settle();
    controller.abort(new Error('deadline'));
    fake.pending.shift()!();
    await expect(job).rejects.toThrow(/deadline/);
    expect(fake.counts().closed).toBeGreaterThanOrEqual(1);
    await renderer.dispose();
  });
});
