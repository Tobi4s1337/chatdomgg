import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createKingdomAudio } from '@chatdom/audio';
import { DockOutcomeSchema, DockStateSchema, type DockAction, type DockOutcome, type DockState } from '../../api/src/dock/contracts';

type Kind = DockAction['kind'];
type Ready = DockState & { version: 1; status: 'ready'; mode: 'LIVE' | 'SIMULATED'; message: string; signInUrl: string; csrfToken: string };
type Status = Ready | { version: 1; status: 'anonymous' | 'forbidden' | 'unavailable'; mode: 'LIVE' | 'SIMULATED'; message: string; signInUrl: string };
type Reply = DockOutcome & { version: 1 };

function Insignia(props: { kind: Kind | 'throne' }) {
  const path = () => ({ 'throne': 'M5 20V7h3v4h3V5h3v6h3V7h3v13M4 20h17M9 20v-5h6v5', 'gate-open': 'M4 21V9l8-5 8 5v12M8 21v-9l4-2 4 2v9M3 21h18', 'gate-close': 'M4 21V9l8-5 8 5v12M8 21v-9l4-2 4 2v9M12 10v11M3 21h18', 'fire-light': 'M12 3c1 5-4 6-3 10 1-2 2-3 3-4 0 3 4 4 3 7a3 3 0 0 1-6 0M6 20l12 2M18 20L6 22', 'raid-welcome': 'M6 22V4m0 1c5-3 8 3 13 0v9c-5 3-8-3-13 0', 'citizen-crown': 'M4 8l3 3 5-6 5 6 3-3-2 10H6L4 8zm2 13h12', 'citizen-knight': 'M5 20l11-11m-3-3 5 5M17 4l3 3-3 3-3-3 3-3zM4 17l3 3-2 2-3-3z', 'moment-play': 'M12 3l2 6 6 3-6 2-2 6-2-6-6-2 6-3zM19 3v4M17 5h4', 'undo': 'M9 7L4 12l5 5M4 12h9c4 0 6 2 6 6' })[props.kind];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={path()} /></svg>;
}

export function App() {
  const sound = createKingdomAudio({ volume: 0.2 });
  const [muted, setMuted] = createSignal(false);
  const [status, setStatus] = createSignal<Status>();
  const [loading, setLoading] = createSignal(true);
  const [connected, setConnected] = createSignal(false);
  const [pending, setPending] = createSignal<{ kind: Kind; target?: string }>();
  const [notice, setNotice] = createSignal<{ text: string; error: boolean }>();
  const [raidPage, setRaidPage] = createSignal(0);
  const [citizenPage, setCitizenPage] = createSignal(0);
  const [momentPage, setMomentPage] = createSignal(0);
  const [receipt, setReceipt] = createSignal('');
  const [uncertain, setUncertain] = createSignal(sessionStorage.getItem('chatdom-dock-uncertain') ?? '');
  let alive = true;
  let timer: ReturnType<typeof setInterval> | undefined;
  let reading = false;
  let generation = 0;
  const params = new URLSearchParams(location.search);
  const requestedKingdom = params.get('kingdom');
  if (requestedKingdom && /^[1-9][0-9]{0,31}$/.test(requestedKingdom)) sessionStorage.setItem('chatdom-dock-kingdom', requestedKingdom);
  const kingdom = requestedKingdom ?? sessionStorage.getItem('chatdom-dock-kingdom');
  const query = new URLSearchParams();
  if (kingdom) query.set('kingdom', kingdom);
  async function refresh() {
    if (reading || pending()) return;
    reading = true;
    const started = generation;
    try {
      const response = await fetch(`/api/dock/status${query.size ? `?${query}` : ''}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
      const value = await response.json() as Status;
      if (value.version !== 1 || !['ready', 'anonymous', 'forbidden', 'unavailable'].includes(value.status) || !['LIVE', 'SIMULATED'].includes(value.mode) || typeof value.message !== 'string' || value.signInUrl !== '/api/realm/auth/start?returnTo=%2Fdock') throw new Error('Invalid status');
      if (value.status === 'ready') { const { kingdom, principal, town, raids, citizens, moments, capabilities, revision } = value; if (typeof value.csrfToken !== 'string' || !DockStateSchema.safeParse({ kingdom, principal, town, raids, citizens, moments, capabilities, revision }).success) throw new Error('Invalid state'); }
      if (!alive || started !== generation) return;
      setStatus(value); setConnected(value.status !== 'unavailable');
    } catch {
      if (alive && started === generation) setConnected(false);
    } finally { reading = false; if (alive) setLoading(false); }
  }
  onMount(() => { void (async () => { await refresh(); await document.fonts.ready; window.__chatdomReady = true; })(); timer = setInterval(() => void refresh(), 10000); });
  onCleanup(() => { sound.dispose(); alive = false; if (timer) clearInterval(timer); });
  const ready = () => { const current = status(); return current?.status === 'ready' ? current : undefined; };
  const capability = (kind: Kind) => ready()?.capabilities.find(item => item.kind === kind);
  const can = (kind: Kind) => connected() && !pending() && !uncertain() && ready()?.principal.role === 'broadcaster' && capability(kind)?.allowed === true;
  async function act(kind: Kind, targetId?: string) {
    const state = ready();
    if (!state || !can(kind) || (['raid-welcome', 'citizen-crown', 'citizen-knight', 'moment-play'].includes(kind) && !targetId)) return;
    void sound.unlock().then(() => sound.cue('wood', { ui: 'brass' }));
    generation++;
    const actionId = crypto.randomUUID();
    sessionStorage.setItem('chatdom-dock-uncertain', actionId);
    setPending({ kind, ...(targetId ? { target: targetId } : {}) }); setNotice(undefined);
    try {
      const response = await fetch('/api/dock/actions', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': state.csrfToken }, body: JSON.stringify({ id: actionId, kingdomId: state.kingdom.id, kind, ...(targetId ? { targetId } : {}), expectedRevision: state.revision }) });
      const raw = await response.json() as Reply;
      const { version, ...outcome } = raw;
      if (version !== 1) throw new Error('Invalid reply');
      const result = DockOutcomeSchema.parse(outcome);
      if (!alive) return;
      sound.cue(result.status === 'accepted' ? 'light' : 'wood', { ui: 'wood' });
      if (result.status === 'unknown') setUncertain(actionId);
      else { sessionStorage.removeItem('chatdom-dock-uncertain'); setUncertain(''); }
      setNotice({ text: result.message, error: result.status !== 'accepted' });
      if (result.state) setStatus({ ...state, ...result.state });
      if (result.status === 'accepted') setReceipt(kind === 'undo' ? '' : result.receipt ?? '');
      if (result.status === 'unavailable') setConnected(false);
    } catch {
      if (alive) { sound.cue('wood', { ui: 'wood' }); setUncertain(actionId); setConnected(false); setNotice({ text: 'The reply was lost. This action may have reached the kingdom; check its state before trying again.', error: true }); }
    } finally { if (alive) { setPending(undefined); void refresh(); } }
  }
  const pageStart = (page: number, length: number) => Math.min(page * 3, Math.max(0, Math.ceil(length / 3) - 1) * 3);
  const Action = (props: { kind: Kind; title: string; detail: string; target?: string; unavailable?: boolean }) => {
    const sending = () => pending()?.kind === props.kind && pending()?.target === props.target;
    return <button class="action" type="button" disabled={!can(props.kind) || props.unavailable} onClick={() => void act(props.kind, props.target)} title={capability(props.kind)?.reason || undefined}>
      <span class="action-icon" aria-hidden="true"><Insignia kind={props.kind} /></span>
      <span class="action-copy"><span class="action-title">{sending() ? 'Sending…' : props.title}</span><span class="action-detail">{props.unavailable ? props.detail : capability(props.kind)?.allowed === false ? capability(props.kind)?.reason : props.detail}</span></span>
      <span class="arrow" aria-hidden="true">›</span>
    </button>;
  };
  const Pages = (props: { label: string; page: number; count: number; change: (page: number) => void }) => {
    const current = () => pageStart(props.page, props.count) / 3;
    return <Show when={props.count > 3}><nav class="pages" aria-label={`${props.label} pages`}>
      <button type="button" disabled={!!pending() || !!uncertain() || current() === 0} onClick={() => props.change(current() - 1)}>‹ Previous</button>
      <span>{current() + 1} / {Math.ceil(props.count / 3)}</span>
      <button type="button" disabled={!!pending() || !!uncertain() || current() >= Math.ceil(props.count / 3) - 1} onClick={() => props.change(current() + 1)}>Next ›</button>
    </nav></Show>;
  };
  return <main class="dock"><div class="frame">
    <header class="masthead"><span class="crest" aria-hidden="true"><Insignia kind="throne" /></span><div><div class="eyebrow">Chatdom · The throne</div><h1>{ready()?.kingdom.name ?? 'Your kingdom'}</h1><div class="statusline"><span classList={{ dot: true, live: connected() && !!ready() }} />{loading() ? 'Finding your kingdom…' : !connected() ? 'Connection unavailable' : ready() ? `${ready()!.principal.displayName} · ${ready()!.principal.role === 'broadcaster' ? 'Monarch' : 'Moderator'}` : 'The throne'}</div></div></header>
    <Show when={status()?.mode === 'SIMULATED' || params.get('rehearsal') === '1'}><div class="notice"><strong>SIMULATED</strong> · Rehearsal data, not a live kingdom.</div></Show>
    <Show when={loading()}><div class="paper summary" role="status"><h2>Opening the throne</h2><p>Finding your kingdom and checking your place in it.</p></div></Show>
    <Show when={!loading() && !connected()}><div class="paper summary" role="status"><h2>The kingdom is out of reach</h2><p>{status()?.status === 'unavailable' ? status()?.message : 'We couldn’t connect to the dock. Your controls will return when the connection does.'}</p><button class="retry" type="button" onClick={() => void refresh()}>Try again</button></div></Show>
    <Show when={connected() && status()?.status === 'anonymous'}><div class="paper summary"><h2>Take your place</h2><p>Sign in with Twitch to open your kingdom’s throne.</p><a class="paper-link" href={status()?.signInUrl}>Sign in with Twitch →</a></div></Show>
    <Show when={connected() && status()?.status === 'forbidden'}><div class="paper summary"><h2>This throne belongs to another kingdom</h2><p>{status()?.message || 'Only the broadcaster and their moderators can enter this dock.'}</p><button class="retry" type="button" onClick={() => void refresh()}>Try again</button> <a class="paper-link" href={status()?.signInUrl}>Sign in with Twitch</a></div></Show>
    <Show when={notice()}>{item => <div classList={{ notice: true, error: item().error }} role="status" aria-live="polite">{item().text}</div>}</Show>
    <Show when={uncertain()}><div class="notice error" role="status">An action may have reached the kingdom. Check the stream before sending another.<br /><button class="retry" type="button" onClick={() => { sessionStorage.removeItem('chatdom-dock-uncertain'); setUncertain(''); }}>I checked the stream</button></div></Show>
    <Show when={connected() && ready()}>{state => <>
      <div class="paper summary"><div class="section-label">Around the kingdom</div><h2>{state().town.presenceLabel}</h2><p>{state().town.growthLabel}<br />{state().town.comingLabel}</p></div>
      <Show when={state().principal.role === 'moderator'}><div class="notice">You’re here as a moderator. Royal acts belong to the monarch.</div></Show>
      <section class="section"><h2 class="section-heading section-label">The kingdom</h2>
        <Action kind={state().town.gate === 'open' ? 'gate-close' : 'gate-open'} title={state().town.gate === 'open' ? 'Close the gate' : 'Open the gate'} detail={state().town.gate === 'open' ? 'Send the kingdom a goodnight' : 'Wake the town and gather everyone'} />
        <Action kind="fire-light" title={state().town.fire === 'lit' ? 'The fire is burning' : 'Light the fire'} detail={state().town.fire === 'lit' ? 'A warm place to gather' : 'Bring everyone together in the square'} />
      </section>
      <section class="section"><h2 class="section-heading section-label">At the gate</h2>
        <Show when={state().raids.length} fallback={<p class="empty">No visitors on the road just now.</p>}>
          <For each={state().raids.slice(pageStart(raidPage(), state().raids.length), pageStart(raidPage(), state().raids.length) + 3).map(item => item.id)}>{id =>
            <Action kind="raid-welcome" title={`Welcome ${state().raids.find(item => item.id === id)?.name ?? ''}`} detail="Bring the visitors up the road" target={id} />
          }</For>
          <Pages label="Visitors" page={raidPage()} count={state().raids.length} change={setRaidPage} />
        </Show>
      </section>
      <section class="section"><h2 class="section-heading section-label">A royal honour</h2>
        <Show when={state().citizens.length} fallback={<p class="empty">No citizens are available for a ceremony just now.</p>}>
          <For each={state().citizens.slice(pageStart(citizenPage(), state().citizens.length), pageStart(citizenPage(), state().citizens.length) + 3).map(item => item.id)}>{id =>
            <div class="honour-row">
              <Action kind="citizen-crown" title={`Crown ${state().citizens.find(item => item.id === id)?.name ?? ''}`} detail="A royal ceremony" target={id} />
              <Action kind="citizen-knight" title={`Knight ${state().citizens.find(item => item.id === id)?.name ?? ''}`} detail="Knight for the day" target={id} />
            </div>
          }</For>
          <Pages label="Citizens" page={citizenPage()} count={state().citizens.length} change={setCitizenPage} />
        </Show>
      </section>
      <section class="section"><h2 class="section-heading section-label">A moment for the realm</h2>
        <Show when={state().moments.length} fallback={<p class="empty">There are no moments ready to play just now.</p>}>
          <For each={state().moments.slice(pageStart(momentPage(), state().moments.length), pageStart(momentPage(), state().moments.length) + 3).map(item => item.id)}>{id =>
            <Action kind="moment-play" title={`Play ${state().moments.find(item => item.id === id)?.name ?? ''}`} detail={state().moments.find(item => item.id === id)?.available ? 'Let the kingdom take the stage' : state().moments.find(item => item.id === id)?.reason || 'Not available just now'} target={id} unavailable={!state().moments.find(item => item.id === id)?.available} />
          }</For>
          <Pages label="Moments" page={momentPage()} count={state().moments.length} change={setMomentPage} />
        </Show>
      </section>
      <Show when={capability('undo')?.allowed && receipt()}><section class="section"><Action kind="undo" title="Undo last act" detail="Return the kingdom to its previous state" target={receipt()} /></section></Show>
    </>}</Show>
    <footer class="foot"><span>The kingdom carries on, even while you’re away.</span><button class="sound-toggle" type="button" aria-pressed={!muted()} onClick={() => { const next = !muted(); setMuted(next); sound.setSettings({ muted: next }); if (!next) void sound.unlock().then(() => sound.cue('wood', { ui: 'brass' })); }}>{muted() ? 'Sound off' : 'Sound on'}</button></footer>
  </div></main>;
}

declare global { interface Window { __chatdomReady?: boolean } }
