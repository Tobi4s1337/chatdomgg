/**
 * The passport's share image over HTTP (spec 45 R3, R5): `GET` answers the holder's current spread as a 1200 × 800
 * PNG, drawn by `composePassportShare` from the same book every surface opens. Main mounts it beside the public card
 * (for example `/-/citizens/:kingdomId/:personId/passport.png`) with the same `subject` resolver as the passport read.
 *
 * Privacy holds through the whole job, not just its start:
 *
 * 1. **Fresh, every time.** Each request reads the book through the passport reader, which runs the card's
 *    disclosure gate before and after the history. There is no image cache to answer instead, and every response is
 *    `no-store`, so no proxy can serve an old picture after the travels are hidden.
 * 2. **Hidden draws nothing.** A hidden book (never signed in, travels kept private, Gate hidden) answers 404 with no
 *    image and no words about travel. The renderer is never asked.
 * 3. **Checked again before release.** After the picture is drawn the book is read once more. If the travels were
 *    hidden meanwhile, the picture is thrown away. If the book moved on (a new journey, another holder), the
 *    picture of the older snapshot is thrown away and the current one is drawn, once; a book that keeps moving
 *    answers 503 rather than an image of a moment that has passed.
 *
 * Already downloaded copies cannot be recalled; removal is promised only from what this handler serves.
 */
import { SHARE_SIZE, composePassportShare, type PassportShare } from '../../../../packages/ui/src/passport/craft';
import type { CitizenKey } from '../citizen-card/contracts';
import type { VisiblePassportBook } from './contracts';
import type { PassportSubject } from './http';
import type { PassportReader } from './read';

/** Draws a composition to PNG bytes of exactly `SHARE_SIZE`. Main may bind any equivalent worker. */
export interface PassportImageRenderer {
  render(share: PassportShare, signal: AbortSignal): Promise<Uint8Array>;
}

/** The renderer's queue is full: the handler answers 503 with a short retry hint instead of waiting without end. */
export class PassportRendererBusy extends Error {
  constructor() { super('The passport renderer is busy'); this.name = 'PassportRendererBusy'; }
}

export type PassportShareFault =
  | Readonly<{ kind: 'read' | 'render' | 'image'; detail: string }>
  | Readonly<{ kind: 'discarded'; reason: 'hidden' | 'moved' | 'unavailable' }>;

export type PassportShareHttpOptions = Readonly<{
  reader: PassportReader;
  subject: PassportSubject;
  renderer: PassportImageRenderer;
  /** The server clock; the browser's clock is never consulted. */
  clock: () => number;
  /** `@font-face` rules with embedded bytes (`passportFontFaces()`); the composition never fetches. */
  fontFaces?: string;
  /**
   * Kingdom names the public card already shows for this subject (its disclosed homes), so a road can name where it
   * began. Read through the card's projection by main; never a source the card would not show.
   */
  places?: (key: CitizenKey, signal: AbortSignal) => Promise<ReadonlyMap<string, string>>;
  /** The site mark printed on the desk, e.g. `chatdom.gg`. */
  site?: string;
  /** How long one picture may take, in milliseconds. */
  deadlineMs?: number;
  /** Faults and discarded pictures, for main's logs. Never part of a response. */
  report?: (fault: PassportShareFault) => void;
}>;

const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;
const say = (status: number, text: string, extra: Record<string, string> = {}) =>
  new Response(text, { status, headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8', ...extra } });

type Read = Readonly<{ kind: 'visible'; book: VisiblePassportBook }> | Readonly<{ kind: 'hidden' }> | Readonly<{ kind: 'unavailable' }>;

/** A PNG of exactly the share size: signature, then an IHDR naming 1200 × 800. Anything else is not served. */
export function isShareImage(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || signature.some((byte, i) => bytes[i] !== byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  return type === 'IHDR' && view.getUint32(16) === SHARE_SIZE.width && view.getUint32(20) === SHARE_SIZE.height;
}

const sameSnapshot = (a: VisiblePassportBook, b: VisiblePassportBook) =>
  a.holder.personId === b.holder.personId && a.holder.name === b.holder.name && a.revision === b.revision && a.origin === b.origin;

export function createPassportShareHttp(options: PassportShareHttpOptions): { handle(request: Request): Promise<Response> } {
  const deadline = options.deadlineMs ?? 15_000;

  async function read(key: CitizenKey, signal: AbortSignal): Promise<Read> {
    try {
      const reply = await options.reader.handle({ key, now: options.clock(), signal }, { op: 'book' });
      if (reply.kind !== 'book') return { kind: 'unavailable' };
      return reply.book.visibility === 'visible' ? { kind: 'visible', book: reply.book } : { kind: 'hidden' };
    } catch (error) {
      options.report?.({ kind: 'read', detail: error instanceof Error ? error.message : 'read failed' });
      return { kind: 'unavailable' };
    }
  }

  async function draw(key: CitizenKey, book: VisiblePassportBook, signal: AbortSignal): Promise<Uint8Array> {
    const places = options.places ? await options.places(key, signal) : undefined;
    const share = composePassportShare(book, {
      ...(options.fontFaces ? { fontFaces: options.fontFaces } : {}), ...(places ? { places } : {}), ...(options.site ? { site: options.site } : {}),
    });
    const bytes = await options.renderer.render(share, signal);
    if (!isShareImage(bytes)) throw new Error('the renderer answered something other than a 1200 × 800 PNG');
    return bytes;
  }

  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return say(405, 'Method not allowed', { allow: 'GET, HEAD' });
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deadline * 2 + 5_000)]);
      const key = await options.subject(request, signal);
      if (!key) return say(404, 'No passport here');
      let current = await read(key, signal);
      if (current.kind === 'hidden') return say(404, 'No passport to share');
      if (current.kind === 'unavailable') return say(503, 'The passport cannot be read just now', { 'retry-after': '30' });
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { ...NO_STORE, 'content-type': 'image/png' } });

      for (let attempt = 0; attempt < 2; attempt++) {
        let bytes: Uint8Array;
        try {
          bytes = await draw(key, current.book, AbortSignal.any([signal, AbortSignal.timeout(deadline)]));
        } catch (error) {
          if (error instanceof PassportRendererBusy) return say(503, 'The passport is being drawn for others; try again shortly', { 'retry-after': '5' });
          options.report?.({ kind: error instanceof Error && /PNG/.test(error.message) ? 'image' : 'render', detail: error instanceof Error ? error.message : 'render failed' });
          return say(503, 'The passport image cannot be drawn just now', { 'retry-after': '30' });
        }
        // The picture is of the book as it was when the job began. Read it again before letting the picture out.
        const after = await read(key, signal);
        if (after.kind === 'hidden') { options.report?.({ kind: 'discarded', reason: 'hidden' }); return say(404, 'No passport to share'); }
        if (after.kind === 'unavailable') { options.report?.({ kind: 'discarded', reason: 'unavailable' }); return say(503, 'The passport cannot be read just now', { 'retry-after': '30' }); }
        if (sameSnapshot(current.book, after.book)) {
          return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: {
            ...NO_STORE, 'content-type': 'image/png', 'content-length': String(bytes.byteLength), 'content-disposition': 'inline; filename="passport.png"',
          } });
        }
        options.report?.({ kind: 'discarded', reason: 'moved' });
        current = after;
      }
      return say(503, 'The passport changed while it was drawn; try again shortly', { 'retry-after': '5' });
    },
  };
}
