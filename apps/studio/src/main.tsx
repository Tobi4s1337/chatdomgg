// The studio page. It draws one frame of one shot: /studio/?shot=S01&t=2.5
// The recorder drives it through `window.__studio`; a person can open the same URL to look at a frame.
//   ?fixture=page&t=…   the page replica's own sample state (for building the replica)
//   &player=key         a keyed player (transparent), for page plates composited later
import { mountPage, type PageView } from './page';
import type { PageRects, PageState, StudioApi } from './types';


const query = new URLSearchParams(location.search);
const root = document.getElementById('studio')!;
const view: PageView = mountPage(root);

async function boot(): Promise<void> {
  let state: (t: number) => PageState, shot: string, duration: number, actions: StudioApi['actions'] = [];
  if (query.get('fixture') === 'page') {
    const { samplePage } = await import('./page/sample');
    state = samplePage; shot = 'fixture'; duration = 10;
  } else {
    const { findShot, evaluate, shotActions } = await import('./shot-list');
    const script = findShot(query.get('shot') ?? 'S01');
    // The layout is fixed, so the rectangles of a first frame hold for the whole shot.
    await view.render(evaluate(script, 0));
    const rects = view.rects();
    state = t => evaluate(script, t, rects); shot = script.id; duration = script.duration;
    actions = shotActions(script, rects);
  }
  const keyed = query.get('player') === 'key';
  const draw = (t: number) => { const s = state(t); return view.render(keyed ? { ...s, player: { kind: 'key' } } : s); };
  await document.fonts.ready;
  const api: StudioApi = { shot, duration, actions, ready: false, frame: draw, rects: () => view.rects() };
  await api.frame(Number(query.get('t') ?? 0));
  api.ready = true;
  window.__studio = api;
  window.__chatdomReady = true;
}
void boot();
