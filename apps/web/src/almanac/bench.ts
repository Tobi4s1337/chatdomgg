import type { PierAlmanac } from '@chatdom/shared';
import { mountAlmanac, type AlmanacHandle } from './book';
import { SAOIRSE_MARKS, WILLOWMERE_ALMANAC } from './fixture';
import { AlmanacLoadError } from './fetch';
import { mountAlmanacPage, type AlmanacReadyWindow } from './page';
import { createGestureAlmanacSound } from './sound';

/**
 * Review bench for the Almanac (`/-/pier?view=almanac`), staging Willowmere:
 * `page=contents|<species id>`, `mode=walker|watcher`, `still=1` (no cover opening), and `state=loading|error|no-pier`
 * for the public page's designed states. The walker's book closes to the desk; a button opens it again.
 * `at=<seconds>` holds the cover's opening at that moment (plates drawn first), so a clip can be shot frame by frame.
 */
export function mountAlmanacBench(host: HTMLElement, query: URLSearchParams): () => void {
  const W = window as AlmanacReadyWindow;
  W.__chatdomReady = false;
  const sound = createGestureAlmanacSound(window);
  const page = query.get('page') ?? 'contents';
  const still = query.get('still') === '1';
  const state = query.get('state');

  if (state === 'loading' || state === 'error' || state === 'no-pier') {
    const load = (): Promise<PierAlmanac> => state === 'loading' ? new Promise<PierAlmanac>(() => undefined)
      : state === 'error' ? Promise.reject(new AlmanacLoadError('offline', 'The Almanac could not be reached. Check your connection and try again.'))
      : Promise.resolve({ ...WILLOWMERE_ALMANAC, water: null, entries: [], caught: 0, catches: 0 });
    const stop = mountAlmanacPage(host, { kingdomId: WILLOWMERE_ALMANAC.kingdomId, load, sound });
    if (state === 'loading') requestAnimationFrame(() => requestAnimationFrame(() => { W.__chatdomReady = true; }));
    return () => { stop(); sound.dispose(); };
  }

  const walker = query.get('mode') !== 'watcher';
  host.style.background = '#120b07';
  const at = query.has('at') ? Number(query.get('at')) : null;
  if (at !== null) {
    if (!Number.isFinite(at) || at < 0 || at > 10) throw new Error('Hold the opening between zero and ten seconds.');
    return holdOpening(host, at, page, walker, sound);
  }
  let book: AlmanacHandle | null = null, reopen: HTMLButtonElement | null = null;
  const open = (at: string, quiet: boolean) => {
    reopen?.remove(); reopen = null;
    W.__chatdomReady = false;
    book = mountAlmanac(host, {
      almanac: WILLOWMERE_ALMANAC, marks: walker ? SAOIRSE_MARKS : null, mode: walker ? 'walker' : 'watcher', open: at, sound, still: quiet,
      ...(walker ? { onClose: () => {
        const last = book?.page ?? 'contents';
        book?.dispose(); book = null;
        reopen = document.createElement('button');
        reopen.type = 'button';
        reopen.className = 'almp-again';
        reopen.textContent = 'Open the Almanac';
        Object.assign(reopen.style, { position: 'absolute', left: '50%', top: '50%', translate: '-50% -50%' });
        reopen.addEventListener('click', () => open(last, false));
        host.append(reopen);
        reopen.focus();
      } } : {}),
    });
    W.__chatdomAlmanac = book;
    const handle = book;
    void handle.ready.then(() => { if (book === handle) W.__chatdomReady = true; });
  };
  open(page, still);
  return () => { book?.dispose(); reopen?.remove(); sound.dispose(); host.style.background = ''; delete W.__chatdomAlmanac; };
}

/** Draws the book once still (the plates are cached by fish and size), then opens it again with every animation held at `at`. */
function holdOpening(host: HTMLElement, at: number, page: string, walker: boolean, sound: ReturnType<typeof createGestureAlmanacSound>): () => void {
  const W = window as AlmanacReadyWindow;
  let disposed = false, book: AlmanacHandle | null = null;
  const options = { almanac: WILLOWMERE_ALMANAC, marks: walker ? SAOIRSE_MARKS : null, mode: walker ? 'walker' as const : 'watcher' as const, open: page, sound };
  const warm = mountAlmanac(host, { ...options, still: true });
  void warm.ready.then(async () => {
    warm.dispose();
    if (disposed) return;
    book = mountAlmanac(host, { ...options, still: false });
    W.__chatdomAlmanac = book;
    // An animation already over at `at` is finished for real (the cover is then put away, as in the book).
    const hold = () => {
      for (const animation of document.getAnimations()) {
        const end = animation.effect?.getComputedTiming().endTime;
        if (typeof end === 'number' && Number.isFinite(end) && at * 1000 >= end) animation.finish();
        else { animation.pause(); animation.currentTime = at * 1000; }
      }
    };
    hold();
    await document.fonts?.ready;
    // The cached plates arrive a few frames after the page is placed; hold again once they have.
    await new Promise(done => setTimeout(done, 400));
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    if (disposed) return;
    hold();
    W.__chatdomReady = true;
  });
  return () => { disposed = true; warm.dispose(); book?.dispose(); sound.dispose(); host.style.background = ''; delete W.__chatdomAlmanac; };
}
