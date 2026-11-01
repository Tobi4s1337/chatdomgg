import { createReplay, type History, type ReplayBinding, type ReplayState } from './replay';
import './view.css';

export interface ChronicleViewOptions {
  /** The host owns a separate replay presentation, and restores its live view on dispose. */
  readonly binding: ReplayBinding;
  readonly history: History | null;
  /** Called even if scene cleanup fails, so the host can restore live presentation or report the error. */
  readonly onClose: (cleanupError?: unknown) => void;
  readonly simulationNote?: string;
  /** Provenance of any host scene still visible when history is unavailable. */
  readonly presentationLabel?: History['label'];
  /** Host UI sound, shared with the rest of the kingdom. */
  readonly sound: (action: 'seek' | 'play' | 'close') => void;
}

/** Mount only within a host-provided replay scene. No historical beat is sent to the live feeds. */
export function mountChronicle(root: HTMLElement, options: ChronicleViewOptions) {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  root.innerHTML = `<section class="chronicle" aria-label="Kingdom Chronicle">
    <div class="chronicle-heading"><div><p class="chronicle-eyebrow">THE KINGDOM REMEMBERS</p><h1>Chronicle</h1></div><button class="chronicle-close" type="button" aria-label="Close Chronicle">×</button></div>
    <p class="chronicle-origin" aria-live="polite"></p><p class="chronicle-note"></p>
    <div class="chronicle-fact" aria-live="polite" aria-atomic="true"><p class="chronicle-date"></p><p class="chronicle-caption"></p></div>
    <div class="chronicle-controls"><button class="chronicle-play" type="button">Play</button><div class="chronicle-track"><label>Travel through the nights<input type="range" min="0" max="0" value="0" step="1"></label><div class="chronicle-ends"><span>First entry</span><span>Most recent</span></div></div></div>
    <p class="chronicle-status" aria-hidden="true"></p>
  </section>`;
  const get = <T extends Element>(selector: string): T => {
    const node = root.querySelector<T>(selector); if (!node) throw new Error(`Chronicle element missing: ${selector}`); return node;
  };
  const origin = get<HTMLElement>('.chronicle-origin'), note = get<HTMLElement>('.chronicle-note'), date = get<HTMLElement>('.chronicle-date');
  const caption = get<HTMLElement>('.chronicle-caption'), status = get<HTMLElement>('.chronicle-status');
  const play = get<HTMLButtonElement>('.chronicle-play'), seek = get<HTMLInputElement>('.chronicle-track input');
  const close = get<HTMLButtonElement>('.chronicle-close');
  let timer: ReturnType<typeof setInterval> | undefined;
  const stopClock = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
  const describeDate = (at: number) => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(at);
  const show = (state: ReplayState) => {
    if (state.status !== 'ready') {
      stopClock();
      const simulatedHistory = state.status === 'empty' && state.label === 'SIMULATED';
      const simulatedScene = options.presentationLabel === 'SIMULATED';
      origin.textContent = simulatedHistory ? 'SIMULATED · A local history' : simulatedScene ? 'SIMULATED · Scene' : '';
      note.textContent = simulatedHistory || simulatedScene ? options.simulationNote ?? '' : ''; date.textContent = '';
      seek.value = '0'; seek.max = '0'; seek.removeAttribute('aria-valuetext');
      caption.textContent = state.status === 'empty' ? 'There are no recorded nights to read yet.' : 'The Chronicle is unavailable right now.';
      status.textContent = state.status === 'empty' ? 'No recorded nights' : 'History unavailable';
      play.disabled = true; seek.disabled = true; play.textContent = 'Play'; return;
    }
    origin.textContent = state.label === 'SIMULATED' ? 'SIMULATED · A local history' : 'Recorded history';
    note.textContent = state.label === 'SIMULATED' ? options.simulationNote ?? '' : '';
    date.textContent = describeDate(state.snapshot.frame.asOf);
    caption.textContent = state.snapshot.caption;
    seek.disabled = false; seek.max = String(state.count - 1); seek.value = String(state.index);
    seek.setAttribute('aria-valuetext', `${describeDate(state.snapshot.frame.asOf)}; entry ${state.index + 1} of ${state.count}`);
    play.disabled = state.count < 2;
    play.textContent = state.playing ? 'Pause' : state.index === state.count - 1 ? 'Play again' : 'Play';
    status.textContent = `Entry ${state.index + 1} of ${state.count}`;
    if (!state.playing) stopClock();
  };
  const replay = createReplay(options.binding, show);
  const cue = (action: 'seek' | 'play' | 'close') => { try { options.sound(action); } catch { /* A host audio fault must not disable controls. */ } };
  const onSeek = () => {
    const requested = Number(seek.value);
    cue('seek'); replay.pause();
    try { replay.seek(requested); } catch { /* The unavailable state is already displayed. */ }
  };
  const onPlay = () => {
    cue('play');
    if (replay.state().playing) { replay.pause(); return; }
    const current = replay.state();
    if (current.status === 'ready' && current.index === current.count - 1) {
      try { replay.seek(0); } catch { return; }
    }
    replay.play();
    if (replay.state().playing) timer = setInterval(() => { try { replay.step(); } catch { /* The unavailable state is already displayed. */ } }, 3000);
  };
  let disposed = false;
  const restoreFocus = () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  const dispose = (restore = true) => {
    if (disposed) return; disposed = true; stopClock(); seek.removeEventListener('input', onSeek);
    play.removeEventListener('click', onPlay); close.removeEventListener('click', onClose); root.removeEventListener('keydown', onKeyDown);
    const focusedInside = root.contains(document.activeElement);
    try { replay.dispose(); } finally {
      root.replaceChildren();
      if (restore && focusedInside) restoreFocus();
    }
  };
  const onClose = () => {
    cue('close');
    const focusedInside = root.contains(document.activeElement);
    let cleanupError: unknown;
    try { dispose(false); } catch (error) { cleanupError = error; }
    try { options.onClose(cleanupError); } finally { if (focusedInside) restoreFocus(); }
  };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
  root.addEventListener('keydown', onKeyDown);
  seek.addEventListener('input', onSeek); play.addEventListener('click', onPlay); close.addEventListener('click', onClose);
  try { replay.load(options.history); } catch { /* Validation already presents the unavailable state. */ }
  return { replay, dispose: () => dispose() };
}
