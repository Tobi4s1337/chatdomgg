import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import Kingdom from '../kingdom';
import { RealmEntryError, realmSignInUrl } from '../realm/adapters/entry';
import type { KingdomEntryConnection, KingdomEntrySource } from './types';
import './entry.css';

export type { KingdomEntryConnection, KingdomEntrySource } from './types';

/** The source establishes entry; this component owns its lifetime and the drawn kingdom. */
export default function KingdomEntry(props: { open: KingdomEntrySource }) {
  const [state, setState] = createSignal<'opening' | 'connected' | 'refused' | 'unauthenticated'>('opening');
  const [notice, setNotice] = createSignal<string>();
  const [message, setMessage] = createSignal<string>();
  const signInUrl = realmSignInUrl(`${location.pathname}${location.search}`);
  let host!: HTMLDivElement;
  let generation = 0, closed = false;
  let request: AbortController | undefined;
  let connection: KingdomEntryConnection | undefined;
  let unmount: (() => void) | undefined;

  function release() {
    generation++;
    // The walk/controller and scene must stop reading the client before its source closes it.
    unmount?.(); unmount = undefined;
    connection?.dispose(); connection = undefined;
    request?.abort(); request = undefined;
    setNotice(undefined);
  }

  async function open() {
    release();
    if (closed) return;
    const current = generation, controller = new AbortController();
    request = controller;
    setState('opening');
    setMessage(undefined);
    try {
      const next = await props.open(controller.signal);
      if (closed || current !== generation || controller.signal.aborted) { next.dispose(); return; }
      connection = next;
      unmount = render(() => <Kingdom founded={next.scene} presenceFeed={next.presenceFeed} {...(next.chatFeed ? { chatFeed: next.chatFeed } : {})}
        kingdomName={next.kingdomName} walk={{ client: next.client, collision: next.collision,
          manifest: next.manifest, onSceneNeeded: () => {
            // Finish the current scene frame before disposing its renderer and controller.
            queueMicrotask(() => { if (!closed && current === generation) void open(); });
          } }} />, host);
      setNotice(next.notice);
      setState('connected');
    } catch (error) {
      if (closed || current !== generation) return;
      release();
      const unauthenticated = error instanceof RealmEntryError && error.status === 'unauthenticated';
      setMessage(error instanceof RealmEntryError ? error.message : undefined);
      setState(unauthenticated ? 'unauthenticated' : 'refused');
    }
  }

  onMount(() => { void open(); });
  onCleanup(() => { closed = true; release(); });

  return <div class="kingdom-entry">
    <div ref={element => { host = element; }} />
    <Show when={state() !== 'connected'}>
      <div class="kingdom-gate kingdom-entry-gate" role="status" aria-live="polite">
        <svg viewBox="0 0 80 80" aria-hidden="true"><path d="M17 70V25l12-12h22l12 12v45M26 70V31a14 14 0 0 1 28 0v39M12 70h56M31 13V7h6v6m6 0V7h6v6" /></svg>
        <h2>{state() === 'unauthenticated' ? 'Your place is waiting.' : state() === 'refused' ? 'The gate could not open.' : 'Finding your way home'}</h2>
        <p>{message() ?? (state() === 'refused' ? 'Your visit could not be confirmed. Try the gate again.' : 'The street is getting ready for you.')}</p>
        <Show when={state() === 'unauthenticated'}><a class="kingdom-entry-signin" href={signInUrl}>Sign in with Twitch</a></Show>
        <Show when={state() === 'refused'}><button type="button" onClick={() => { void open(); }}>Try the gate again</button></Show>
      </div>
    </Show>
    <Show when={notice()}>{text => <aside class="kingdom-entry-notice" aria-label="About this kingdom">{text()}</aside>}</Show>
  </div>;
}
