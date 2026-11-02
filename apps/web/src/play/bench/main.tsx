/**
 * A dev-only bench for the play HUD and the ledger: the real `mountPlayHud` over a still of a dusk street, with a
 * host that takes real pointer lock where the browser allows it. Served by the web dev server at
 * /src/play/bench/index.html; never linked from a route and never in the build.
 *
 * Query: cursor=idle|cooldown|touch|locked|unavailable · page=settings|way-home|build|help|look ·
 * home=none|inside · angle=<degrees> · build=closed · slots=1 (a sample look page, Forge entry, bag key, map piece) ·
 * prompt=1 · reduced=1 · store=device (keep settings in this browser).
 */
import { createKingdomAudio } from '@chatdom/audio';
import type { KingdomId } from '@chatdom/shared';
import backdrop from '../../../../../work/evidence/PL03/street-final@1920x1080.png?url';
import type { CursorState, CursorView, PlayCue, PlayHost, PlayHud, WayHome } from '../host';
import { mountPlayHud } from '../index';
import { createPlaySettings } from '../settings';
import { registerActionBinding, registerForgeEntry, registerHudPiece, registerLedgerPage, type PlayContext } from '../slots';
import './bench.css';

const query = new URLSearchParams(location.search);
const stage = document.querySelector<HTMLDivElement>('#stage')!;
stage.style.setProperty('--bench-backdrop', `url("${backdrop}")`);

const memory = new Map<string, string>();
const settings = createPlaySettings(query.get('store') === 'device' ? undefined
  : { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } });
if (query.get('reduced') === '1') settings.set({ reducedMotion: true });

const audio = createKingdomAudio();
const cues: PlayCue[] = [];
addEventListener('pointerdown', () => { void audio.unlock(); }, { once: true, capture: true });
// The bench owns its sound, so its master fader is real; the kingdom's groups wait for the engine to offer them.
const applyMaster = (next: typeof settings.current) => audio.setSettings({ volume: next.volume.master });
applyMaster(settings.current);
settings.subscribe(applyMaster);

const touch = query.get('cursor') === 'touch';
let cursor: CursorView = {
  state: (query.get('cursor') as CursorState | null) ?? 'idle', fullscreen: !!document.fullscreenElement, keyboardLocked: false,
  canFullscreen: !touch && typeof document.documentElement.requestFullscreen === 'function', canLockKeyboard: !touch && 'keyboard' in navigator,
};
const cursorListeners = new Set<(view: CursorView) => void>();
const setCursor = (patch: Partial<CursorView>) => { cursor = { ...cursor, ...patch }; for (const listener of cursorListeners) listener(cursor); };
let hud: PlayHud | null = null, leases = 0;

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) { setCursor({ state: 'locked' }); return; }
  if (leases > 0) return;
  // The browser ate the Escape that let the mouse go: the ledger opens on the unlock, as in the walk.
  setCursor({ state: 'idle' });
  if (hud && !hud.ledgerOpen) hud.openLedger();
});
document.addEventListener('pointerlockerror', () => {
  setCursor({ state: 'cooldown' });
  setTimeout(() => { if (cursor.state === 'cooldown') setCursor({ state: 'idle' }); }, 1200);
});
document.addEventListener('fullscreenchange', () => setCursor({ fullscreen: !!document.fullscreenElement }));

const lock = () => {
  if (touch) return;
  setCursor({ state: 'requesting' });
  try { const asked = stage.requestPointerLock() as unknown as Promise<void> | undefined; asked?.catch?.(() => setCursor({ state: 'cooldown' })); }
  catch { setCursor({ state: 'cooldown' }); }
};
stage.addEventListener('click', event => { if (event.target === stage && cursor.state !== 'locked' && !hud?.ledgerOpen) lock(); });

const ctx: PlayContext = {
  kingdomId: '1' as KingdomId,
  self: { personId: 'bench', publicName: 'Rowan', lookToken: 'starter-1' }, live: true, mode: 'walking', settings,
  requestCursor() {
    leases++;
    if (document.pointerLockElement) document.exitPointerLock();
    if (!touch) setCursor({ state: 'leased' });
    let active = true;
    return { get active() { return active; }, release() { if (!active) return; active = false; leases--; if (!touch && leases === 0) setCursor({ state: 'idle' }); } };
  },
  closeLedger: () => hud?.closeLedger(),
  requestInput: () => ({ active: true, onKey: () => () => {}, onPointer: () => () => {}, release() {} }),
  hideSelf: () => ({ release() {} }),
};

const started = performance.now();
const angle = Number(query.get('angle') ?? 38) * Math.PI / 180;
const home = query.get('home');
const promptShown = query.get('prompt') === '1' ? { id: 'rod', label: 'Take a rod' } : null;

const play: PlayHost = {
  ctx, settings,
  get cursor() { return cursor; },
  onCursor(listener) { cursorListeners.add(listener); return () => cursorListeners.delete(listener); },
  resume(event) { if (!event.isTrusted) return; hud?.closeLedger(); lock(); },
  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().then(() => (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }).keyboard?.lock?.())
      .then(() => setCursor({ keyboardLocked: true })).catch(() => {});
  },
  wayHome(): WayHome | null {
    if (home === 'none') return null;
    if (home === 'inside') return { street: 'Lantern Row', metres: 0, relative: 0, inside: true };
    const drift = query.get('spin') === '1' ? Math.sin((performance.now() - started) / 1600) * .9 : 0;
    return { street: 'Lantern Row', metres: 128, relative: angle + drift, inside: false };
  },
  build: query.get('build') === 'closed'
    ? { open: null, note: 'Building opens once your street is founded. Until then your home is drawn as the town planned it.' }
    : { open: () => console.info('The build rack opens here in the walk.'), note: '' },
  volumes: ['master'],
  cue(surface) { cues.push(surface); audio.cue('wood', { ui: surface }); },
  prompt: promptShown,
  onPrompt: () => () => {},
  usePrompt: () => console.info('The prompt is used here in the walk.'),
};

if (query.get('slots') === '1') {
  registerLedgerPage({
    id: 'look', title: 'Your look', order: 15, available: () => true,
    mount(host) {
      host.innerHTML = '<p class="pl-lead">Your look is drawn here by the wardrobe: hair, top and colour, worn the same on every screen.</p>';
      return () => { host.textContent = ''; };
    },
  });
  registerForgeEntry({ available: () => true, openForge: () => console.info('The Forge opens here.') });
  registerActionBinding({ id: 'bag', label: 'Open your bag', defaultCode: 'KeyB', onPress() {} });
  registerHudPiece({
    id: 'bench-map', region: 'top-right', order: 10, available: () => true,
    mount(host) { host.className += ' bench-piece'; host.textContent = 'Lantern Row'; return () => { host.textContent = ''; }; },
  });
}

hud = mountPlayHud(stage, play);
const page = query.get('page');
if (page) hud.openLedger(page);
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') { if (hud?.escape()) event.preventDefault(); return; }
  if (!hud || hud.ledgerOpen || event.repeat) return;
  if (event.code === settings.current.keys.ledger) hud.openLedger();
  else if (event.code === settings.current.keys.fullscreen) play.toggleFullscreen();
});

Object.assign(window, { __bench: { hud, play, setCursor, cues } });
void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
  (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
})));
