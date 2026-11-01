// chatdom.io's front door. One plate on a lit kingdom: what Chatdom is in a sentence, the kingdom that is open,
// one way in with Twitch, one way to look around first, and the showcase a click away. It reads two things from
// its own origin (which kingdoms are open, and whether this browser is signed in) and draws nothing it was not told.
import { createResource, createSignal, For, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import '@chatdom/ui/kit.css';
import './door.css';
import hero from './willowmere-night.webp';
import heroTall from './willowmere-night-tall.webp';

interface DoorKingdom { readonly kingdomId: string; readonly name: string; readonly login: string }
interface DoorData { readonly mode: 'live' | 'simulated'; readonly kingdoms: readonly DoorKingdom[] }
type Session = { readonly status: 'anonymous' } | { readonly status: 'authenticated'; readonly csrfToken: string; readonly resumeScope: string };

const LOGIN = /^[a-z0-9_]{1,25}$/, ID = /^[1-9][0-9]{0,31}$/;
// The door stays tiny (it paints before anything else loads), so it speaks the frozen sign-in routes
// (`REALM_AUTH_ROUTES` in @chatdom/shared/realm) without pulling in their schemas.
const ROUTES = { session: '/api/realm/session', start: '/api/realm/auth/start', signout: '/api/realm/signout' } as const;
const signInUrl = (returnTo: string) => `${ROUTES.start}?returnTo=${encodeURIComponent(returnTo)}`;
/** The walk page keeps reconnect seats per tab under this prefix; signing out here forgets this session's seats. */
function forgetSeats(resumeScope: string) {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (!key?.startsWith('chatdom:realm:v1:')) continue;
    try { const parts: unknown = JSON.parse(key.slice('chatdom:realm:v1:'.length)); if (Array.isArray(parts) && parts[2] === resumeScope) sessionStorage.removeItem(key); }
    catch { /* not a seat */ }
  }
}

async function readDoor(): Promise<DoorData> {
  const response = await fetch('/api/public/door', { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('door');
  const body = await response.json() as { mode?: unknown; kingdoms?: unknown };
  const kingdoms = Array.isArray(body.kingdoms) ? body.kingdoms.flatMap(raw => {
    const k = raw as Partial<DoorKingdom>;
    return typeof k.kingdomId === 'string' && ID.test(k.kingdomId) && typeof k.login === 'string' && LOGIN.test(k.login)
      && typeof k.name === 'string' && k.name.trim() && k.name.length <= 80 ? [{ kingdomId: k.kingdomId, login: k.login, name: k.name.trim() }] : [];
  }) : [];
  return { mode: body.mode === 'simulated' ? 'simulated' : 'live', kingdoms };
}

async function readSession(): Promise<Session> {
  const response = await fetch(ROUTES.session, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const body = (response.ok ? await response.json().catch(() => null) : null) as { status?: unknown; csrfToken?: unknown; resumeScope?: unknown; expiresAt?: unknown } | null;
  if (body?.status !== 'authenticated' || typeof body.csrfToken !== 'string' || typeof body.resumeScope !== 'string'
    || typeof body.expiresAt !== 'number' || body.expiresAt <= Date.now()) return { status: 'anonymous' };
  return { status: 'authenticated', csrfToken: body.csrfToken, resumeScope: body.resumeScope };
}

const OUTCOMES: Record<string, string> = {
  declined: 'You stepped back from Twitch’s sign-in. Nothing was shared. Walk in whenever you like.',
  expired: 'That sign-in took too long or came from another browser. Try once more.',
  refused: 'Twitch’s answer could not be verified, so nobody was signed in. Try once more.',
  unavailable: 'Twitch or the kingdom could not be reached just now. Nothing changed; try again in a moment.',
};

function Door() {
  const [door] = createResource(readDoor);
  const [session, { mutate }] = createResource(readSession);
  const [chosen, setChosen] = createSignal(0);
  const [leaving, setLeaving] = createSignal(false);
  const query = new URLSearchParams(location.search);
  const outcome = OUTCOMES[query.get('signin') ?? ''] ?? null;
  const lost = location.pathname !== '/' && location.pathname !== '/door/' && location.pathname !== '/door/index.html';
  const kingdom = () => door()?.kingdoms[chosen()] ?? door()?.kingdoms[0] ?? null;
  const walkPath = (k: DoorKingdom) => `/?walk=1&kingdom=${k.kingdomId}`;
  const signedIn = () => session()?.status === 'authenticated';
  const walkHref = (k: DoorKingdom) => (signedIn() ? walkPath(k) : signInUrl(walkPath(k)));

  async function signOut() {
    const current = session();
    if (current?.status !== 'authenticated' || leaving()) return;
    setLeaving(true);
    try {
      const response = await fetch(ROUTES.signout, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', 'X-CSRF-Token': current.csrfToken } });
      if (response.ok) { forgetSeats(current.resumeScope); mutate({ status: 'anonymous' }); }
    } finally { setLeaving(false); }
  }

  onMount(() => {
    if (outcome || lost) history.replaceState(null, '', '/');
    // Ready once the plate and the scene beneath it are drawn.
    const image = document.querySelector<HTMLImageElement>('.door-scene img');
    void Promise.all([document.fonts.ready, image?.decode().catch(() => undefined)]).then(() => {
      requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
    });
  });

  return <div class="door" data-mode={door()?.mode ?? 'loading'}>
    <picture class="door-scene">
      <source media="(max-aspect-ratio: 4/5)" srcset={heroTall} />
      <img src={hero} alt="Willowmere at nightfall: the castle on its hill above the lanes and roofs of the town." width="1920" height="1080" fetchpriority="high" />
    </picture>
    <div class="door-shade" aria-hidden="true" />

    <header class="door-top">
      <a class="door-brand" href="/" aria-label="Chatdom, front door"><span class="door-mark" aria-hidden="true">C</span><span>Chatdom</span></a>
      <a class="door-showcase" href="/showcase">See everything Chatdom does <span aria-hidden="true">→</span></a>
    </header>

    <main class="door-plate cd-plate cd-kit">
      <Show when={door()?.mode === 'simulated'}>
        <p class="door-stamp" role="note"><span class="cd-label">SIMULATED</span> Sign-in here uses simulated people, never real Twitch accounts.</p>
      </Show>
      <Show when={outcome}>{text => <p class="door-notice" role="status">{text()}</p>}</Show>
      <Show when={lost}><p class="door-notice" role="status">That path does not lead anywhere in Chatdom. Here is the front door.</p></Show>

      <p class="door-kicker cd-label">A kingdom for every Twitch chat</p>
      <h1>Your chat<br />has a home.</h1>
      <p class="door-lede">Every Twitch channel gets a kingdom of its own, and every viewer a home in it. Your window lights while you watch, and your name stays on the door.</p>

      <Show when={kingdom()} fallback={
        <div class="door-kingdom cd-slip door-waiting" role="status">
          <p>{door.error ? 'The gate is not answering right now. Try again in a moment.' : door.loading ? 'Opening the gate…' : 'No kingdom is open on this host yet.'}</p>
        </div>}>{k =>
        <>
          <Show when={(door()?.kingdoms.length ?? 0) > 1}>
            <div class="door-choices" role="radiogroup" aria-label="Kingdoms open now">
              <For each={door()?.kingdoms}>{(item, i) =>
                <button type="button" role="radio" aria-checked={i() === chosen()} classList={{ chosen: i() === chosen() }} onClick={() => setChosen(i())}>{item.name}</button>}
              </For>
            </div>
          </Show>
          <section class="door-kingdom cd-slip" aria-label={`${k().name}, open now`}>
            <svg class="door-keep" viewBox="0 0 48 48" aria-hidden="true"><path d="M10 42V18l6-5 6 5V9l5-4 5 4v9l6-5 6 5v24M6 42h36M21 42V32a3 3 0 0 1 6 0v10M15 24h2M31 24h2M23 19h2" /></svg>
            <div>
              <p class="door-kingdom-label cd-label">Open now</p>
              <h2>{k().name}</h2>
              <p class="door-kingdom-line">The kingdom of <a href={`https://www.twitch.tv/${k().login}`} target="_blank" rel="noopener noreferrer">{k().login}<span class="door-out" aria-label="opens Twitch in a new tab">↗</span></a></p>
            </div>
          </section>
          <div class="door-ways">
            <a class="door-walk" href={walkHref(k())}>
              <span>{signedIn() ? `Walk into ${k().name}` : 'Sign in with Twitch and walk in'}</span>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" /></svg>
            </a>
            <a class="door-look" href={`/stream?source=realm&kingdom=${k().kingdomId}`}>Look around first, no sign-in</a>
          </div>
        </>}
      </Show>

      <Show when={signedIn()} fallback={<p class="door-fine">Twitch tells Chatdom only your public name. Chatdom never posts for you.</p>}>
        <p class="door-fine">You are signed in with Twitch. <button type="button" class="door-signout" disabled={leaving()} onClick={() => void signOut()}>Sign out</button></p>
      </Show>
    </main>

    <footer class="door-foot">
      <p class="door-caption">Willowmere, drawn by its own realm on 1 November 2026.</p>
      <p class="door-foot-links"><a href="/showcase">Showcase</a><span aria-hidden="true">·</span><a href="/map">The Atlas of Twitch</a></p>
    </footer>
  </div>;
}

const root = document.getElementById('door');
if (!root) throw new Error('The front door has no root');
render(() => <Door />, root);
