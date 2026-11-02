import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { RealmEntryInfoSchema, REALM_ENTRY_ROUTE } from '@chatdom/shared/realm';
import { Icon, SignInSeal, SiteFooter } from '@chatdom/ui';
import { announceSignInOutcome, brandLink, readSealSession, refreshSeals, SESSION_EVENT, walkReturnView, type Session } from '@chatdom/ui/site';
import { RealmEntryError, realmEntryFailureMessage } from '../realm/adapters/entry';
import { gateKingdom, gateWords, type GateState } from './gate';
import type { KingdomEntryConnection, KingdomEntrySource } from './types';
import '@chatdom/ui/kit.css';
import '@chatdom/ui/fonts.css';
import '@chatdom/ui/site.css';
import './entry.css';

export type { KingdomEntryConnection, KingdomEntrySource } from './types';
export { gateKingdom, gateWords, type GateState } from './gate';

/** The approved public name of the kingdom, if the realm can say it; the gate reads well without it. */
async function kingdomName(kingdomId: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(REALM_ENTRY_ROUTE.replace(':kingdomId', kingdomId), { signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const info = RealmEntryInfoSchema.safeParse(await response.json());
    return info.success && info.data.kingdomId === kingdomId ? info.data.name : null;
  } catch { return null; }
}

/**
 * The walk-in gate. It reads who is signed in first, so a visitor who is not is offered the seal at once (without
 * waiting on the kingdom's realm); a signed-in visitor goes straight through. The kingdom's engine loads only then.
 * Sign-in returns to the front page, which carries the visitor back to this gate (the sign-in service accepts no
 * query in its return address), with the way back from Twitch shown here.
 */
export default function KingdomEntry(props: { open: KingdomEntrySource }) {
  const query = new URLSearchParams(location.search);
  const staged = query.get('source') === 'simulated';
  const kingdomId = gateKingdom(location.search);
  const [state, setState] = createSignal<GateState>(!kingdomId && !staged ? 'lost' : 'opening');
  const [notice, setNotice] = createSignal<string>();
  const [said, setSaid] = createSignal<string>();
  const [name, setName] = createSignal<string | null>(null);
  let host!: HTMLDivElement;
  let generation = 0, closed = false;
  let request: AbortController | undefined;
  let connection: KingdomEntryConnection | undefined;
  let unmount: (() => void) | undefined;
  const naming = new AbortController();

  function release(sceneRevision = false) {
    generation++;
    // The walk/controller and scene must stop reading the client before its source closes it.
    unmount?.(); unmount = undefined;
    connection?.dispose(sceneRevision ? 'scene-revision' : undefined); connection = undefined;
    request?.abort(); request = undefined;
    setNotice(undefined);
  }

  async function open(sceneRevision = false) {
    release(sceneRevision);
    if (closed) return;
    const current = generation, controller = new AbortController();
    request = controller;
    setState('opening');
    setSaid(undefined);
    try {
      // The engine and the entry come in together; neither waits on the other.
      const [{ default: Kingdom }, next] = await Promise.all([import('../kingdom'), props.open(controller.signal)]);
      if (closed || current !== generation || controller.signal.aborted) { next.dispose(); return; }
      connection = next;
      unmount = render(() => <Kingdom founded={next.scene} presenceFeed={next.presenceFeed} {...(next.chatFeed ? { chatFeed: next.chatFeed } : {})}
        {...(next.growthFeed ? { growthFeed: next.growthFeed } : {})}
        {...(next.forgeFeed ? { forgeFeed: next.forgeFeed } : {})}
        {...(next.momentFeed ? { momentFeed: next.momentFeed } : {})}
        kingdomName={next.kingdomName} walk={{ client: next.client, collision: next.collision,
          manifest: next.manifest, onSceneNeeded: () => {
            // Finish the current scene frame before disposing its renderer and controller.
            queueMicrotask(() => { if (!closed && current === generation) void open(true); });
          } }} />, host);
      setNotice(next.notice);
      setState('connected');
    } catch (error) {
      if (closed || current !== generation) return;
      release();
      const status = error instanceof RealmEntryError ? error.status : 'unavailable';
      if (status === 'unauthenticated') {
        // The visit ended (or never began): every seal on the page reads the session again before it is offered.
        setState('waiting');
        void refreshSeals();
        return;
      }
      setSaid(realmEntryFailureMessage(error));
      setState(status === 'refused' ? 'refused' : 'closed');
    }
  }

  async function begin() {
    if (state() === 'lost') return;
    if (kingdomId) void kingdomName(kingdomId, naming.signal).then(found => { if (found) setName(found); });
    // The staged rehearsal is a development bench with its own reference sign-in; it skips the session check.
    if (!staged) {
      const { session } = await readSealSession();
      if (closed) return;
      if (session.status === 'anonymous') { setState('waiting'); return; }
    }
    void open();
  }

  const onSession = (event: Event) => {
    // Signed out from the gate's own seal: the visit is over, and the gate offers the seal again.
    if ((event as CustomEvent<Session>).detail?.status === 'anonymous' && state() !== 'lost') { release(); setState('waiting'); }
  };

  onMount(() => {
    announceSignInOutcome();
    window.addEventListener(SESSION_EVENT, onSession);
    void begin();
  });
  onCleanup(() => { closed = true; naming.abort(); window.removeEventListener(SESSION_EVENT, onSession); release(); });

  const resting = () => state() !== 'connected';
  const words = () => gateWords(state() as Exclude<GateState, 'connected'>, name(), typeof navigator !== 'undefined' && navigator.onLine === false);
  const keep = () => (kingdomId ? walkReturnView(kingdomId) : { path: '/' });
  const mapWay = (words: string, primary: boolean): JSX.Element =>
    <a class={primary ? 'ke-way ke-way-brass' : 'ke-way ke-way-quiet'} href="/map"><Icon name="atlas" />{words}</a>;

  return <div class="kingdom-entry">
    <div ref={element => { host = element; }} />
    <Show when={resting()}>
      <div class="ke-gate cd-kit" data-gate={state()}>
        <div class="ke-sky" aria-hidden="true" />
        <header class="ke-top">
          <span class="ke-brand" innerHTML={brandLink()} />
          <Show when={state() !== 'waiting' && state() !== 'lost'}>
            <SignInSeal size="header" returnPath="/" view={keep} way={() => ({ href: '/map', words: 'Open the Atlas', short: 'The map' })} />
          </Show>
        </header>
        <div class="ke-stage" role="main">
          <section class="ke-plate cd-plate" aria-labelledby="ke-title" aria-describedby="ke-words" aria-busy={state() === 'opening'}>
            <p class="cd-visually-hidden" role="status" aria-live="polite">{`${words().title} ${words().words}`}</p>
            <GateArch state={state()} />
            <p class="ke-kicker cd-label">{name() ? `The gate of ${name()}` : 'The walk-in gate'}</p>
            <h1 id="ke-title">{words().title}</h1>
            <p id="ke-words" class="ke-words">{words().words}</p>
            <Show when={said()}>{text => <p class="ke-said"><span class="cd-label">What the gate said</span> {text()}</p>}</Show>
            <div class="ke-ways">
              <Show when={state() === 'waiting'}>
                {/* Sign-in returns to the front page, which brings the visitor back to this same gate. */}
                <SignInSeal size="large" returnPath="/" view={keep} way={() => null} />
                {mapWay('Look around the Atlas first', false)}
              </Show>
              <Show when={state() === 'lost'}>
                {mapWay('Open the Atlas', true)}
                <a class="ke-way ke-way-quiet" href="/"><Icon name="home" />The front page</a>
              </Show>
              <Show when={state() === 'closed'}>
                <button class="ke-way ke-way-brass" type="button" onClick={() => { void open(); }}><Icon name="door" />Try the gate again</button>
                {mapWay('Back to the Atlas', false)}
              </Show>
              <Show when={state() === 'refused'}>
                {mapWay('Back to the Atlas', true)}
                {/* Some refusals pass (too many entries at once); the gate can always be tried again. */}
                <button class="ke-way ke-way-quiet" type="button" onClick={() => { void open(); }}><Icon name="door" />Try the gate again</button>
              </Show>
            </div>
          </section>
        </div>
        <div class="ke-foot"><SiteFooter compact /></div>
      </div>
    </Show>
    <Show when={notice()}>{text => <aside class="kingdom-entry-notice" aria-label="About this kingdom">{text()}</aside>}</Show>
  </div>;
}

/** The gate itself, drawn in brass: an arch with its doors, a lantern that glows while the gate opens. */
function GateArch(props: { state: GateState }): JSX.Element {
  const studs = [30, 42, 54];
  return <svg class="ke-arch" data-state={props.state} viewBox="0 0 120 92" aria-hidden="true">
    <path class="ke-arch-stone" d="M14 88V40a46 46 0 0 1 92 0v48" />
    <path class="ke-arch-inner" d="M26 88V42a34 34 0 0 1 68 0v46" />
    <path class="ke-arch-door" d="M30 88V44a30 30 0 0 1 29-29.9V88ZM61 88V14.1A30 30 0 0 1 90 44v44Z" />
    <For each={studs}>{y => <path class="ke-arch-stud" d={`M38 ${y + 10}h.01M51 ${y + 10}h.01M69 ${y + 10}h.01M82 ${y + 10}h.01`} />}</For>
    <path class="ke-arch-step" d="M6 88h108" />
    <circle class="ke-arch-glow" cx="60" cy="8" r="9" />
    <path class="ke-arch-lantern" d="M57 4h6l1 7h-8ZM60 1.6V4" />
  </svg>;
}
