import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { GATE_LIMITS } from '../../../api/src/raid-gate/contracts';
import type { GateSnapshot, RaidGateController } from './controller';
import {
  countdownSeconds, countdownShare, marchActions, marchCallShows, marchNews, marchNotice, marchWords, twitchChannelUrl, watchLogin,
  type MarchAction, type MarchNews,
} from './march-call';
import { Seal } from './Seal';
import './raid-gate.css';
import './march-call.css';

/** News told on this tab's earlier visits stays told after a reload (request IDs only; nothing personal). */
const TOLD_KEY = 'chatdom.raid-gate.told';
const TOLD_KEPT = 24;
/** How long the piece takes to fade out of the picture. */
const LEAVE_MS = 380;

export type MarchCallProps = {
  controller: RaidGateController;
  clock: () => number;
  /** The page's current path; the piece is never there on a stream page. */
  pathname: () => string;
  /** Where told news is remembered across reloads; null keeps it for this page only. Defaults to session storage. */
  storage?: Storage | null;
};

function sessionStore(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

function readTold(storage: Storage | null): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(TOLD_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string').slice(-TOLD_KEPT) : [];
  } catch { return []; }
}

/**
 * The march call in the walking view: a small walnut-and-parchment plaque at the foot of the picture, with the
 * destination's wax seal, what the gate is doing and the one or two things this person may do about it.
 */
export function MarchCall(props: MarchCallProps) {
  const storage = props.storage === undefined ? sessionStore() : props.storage;
  const [snap, setSnap] = createSignal<GateSnapshot>(props.controller.snapshot());
  const [now, setNow] = createSignal(props.clock());
  const told = new Set<string>(readTold(storage));
  const [toldVersion, setToldVersion] = createSignal(0);
  /** The news on show and when it first showed; a different piece of news starts its own hold. */
  const [current, setCurrent] = createSignal<Readonly<{ key: string; since: number }> | null>(null);

  const stop = props.controller.subscribe(next => { setSnap(next); setNow(props.clock()); });
  // Twitch's countdown is read in whole seconds; a quarter-second tick keeps the numeral honest to the second.
  const timer = window.setInterval(() => { setNow(props.clock()); setSnap(props.controller.snapshot()); }, 250);
  onCleanup(() => { stop(); window.clearInterval(timer); });

  function tell(key: string, lasting: boolean): void {
    if (told.has(key)) return;
    told.add(key);
    if (lasting && storage) {
      try {
        const kept = readTold(storage).filter(held => held !== key);
        storage.setItem(TOLD_KEY, JSON.stringify([...kept, key].slice(-TOLD_KEPT)));
      } catch { /* a full or blocked store only means it may be told again after a reload */ }
    }
    setToldVersion(version => version + 1);
  }

  const news = createMemo(() => marchNews(snap()));
  createEffect(() => {
    const item = news();
    const held = current();
    if (!item) { if (held) setCurrent(null); return; }
    if (held?.key !== item.key) setCurrent({ key: item.key, since: props.clock() });
  });

  /** Puts the news away: hides it, or puts the ended journey away so the next ride is free. */
  function putAway(item: MarchNews | null): void {
    if (!item) return;
    tell(item.key, item.lasting);
    if (item.covers) tell(item.covers, true);
    if (item.ends === 'journey') props.controller.dismissJourney();
  }

  // News that has been read long enough goes away on its own.
  createEffect(() => {
    const item = news();
    const held = current();
    if (!item || item.holdMs === null || !held || held.key !== item.key || told.has(item.key)) return;
    if (now() - held.since >= item.holdMs) putAway(item);
  });

  const visible = createMemo(() => {
    void toldVersion();
    const s = snap();
    if (!marchCallShows(s, props.pathname())) return false;
    const item = news();
    return !(item && told.has(item.key));
  });

  // The piece eases out with the words it last said, then leaves the page.
  const [shown, setShown] = createSignal<GateSnapshot | null>(visible() ? snap() : null);
  const [leaving, setLeaving] = createSignal(false);
  let leaveTimer = 0;
  createEffect(() => {
    if (visible()) {
      window.clearTimeout(leaveTimer); leaveTimer = 0;
      setLeaving(false); setShown(snap());
    } else if (shown() && !leaveTimer) {
      setLeaving(true);
      leaveTimer = window.setTimeout(() => { leaveTimer = 0; setShown(null); setLeaving(false); }, LEAVE_MS);
    }
  });
  onCleanup(() => window.clearTimeout(leaveTimer));

  return <div class="mc-layer" onPointerDown={event => event.stopPropagation()}>
    <Show when={shown()}>{s => <Piece snap={s()} now={now()} leaving={leaving()} controller={props.controller} putAway={() => putAway(news())} />}</Show>
  </div>;
}

function Piece(props: { snap: GateSnapshot; now: number; leaving: boolean; controller: RaidGateController; putAway: () => void }) {
  const s = () => props.snap;
  const words = createMemo(() => marchWords(s(), props.now));
  const actions = () => marchActions(s());
  const notice = () => marchNotice(s());
  /** Whose seal the piece carries: where the road goes, or home when coming home. */
  const sealOf = () => {
    const j = s().journey;
    if (j) return j.kind === 'return' ? { id: s().source.kingdomId, wax: 'crimson' as const } : { id: j.to, wax: j.destination && !j.destination.target.founded ? 'umber' as const : 'crimson' as const };
    const destination = s().phase === 'quiet' ? s().farewell?.destination ?? null : s().destination;
    if (!destination) return { id: s().source.kingdomId, wax: 'crimson' as const };
    return { id: destination.target.kingdomId, wax: destination.target.founded && destination.land !== 'waiting' && destination.land !== 'edge' ? 'crimson' as const : 'umber' as const };
  };
  // The seal is redrawn only when it changes, not on every tick of the clock.
  const sealId = createMemo(() => sealOf().id);
  const sealWax = createMemo(() => sealOf().wax);
  const breath = () => words().tone === 'breath';
  const seconds = () => countdownSeconds(s().countdownEndsAt, props.now);
  const share = () => countdownShare(s().countdownEndsAt, props.now, GATE_LIMITS.twitchCountdownMs);
  /** The real opted-in count rides along while people may still choose. */
  const counting = () => !s().journey && (words().tone === 'call' || words().tone === 'breath' || words().tone === 'checking');
  const step = () => journeyStep(s());

  return <section class="mc-call" data-tone={words().tone} data-leaving={props.leaving ? '' : undefined} inert={props.leaving}
    role="region" aria-label="The Raid Gate">
    <div class="mc-mark">
      <span class="mc-seal-ring" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <circle class="mc-ring-track" cx="32" cy="32" r="29.5" />
          <Show when={breath()}><circle class="mc-ring-ink" cx="32" cy="32" r="29.5" pathLength="100" stroke-dasharray={`${share() * 100} 100`} /></Show>
          <Show when={words().tone === 'checking' || words().tone === 'journey'}><circle class="mc-ring-asking" cx="32" cy="32" r="29.5" pathLength="100" /></Show>
        </svg>
      </span>
      <Seal kingdomId={sealId()} size={50} wax={sealWax()} />
      <Show when={breath() && seconds() !== null}>
        <span class="mc-seconds" role="timer" aria-label={`Twitch counts down, ${seconds()} seconds left`}><b>{seconds()}</b><i>s</i></span>
      </Show>
    </div>
    <div class="mc-sheet">
      <div class="mc-words" aria-live="polite">
        <p class="mc-eyebrow">
          <span>{words().eyebrow}</span>
          <Show when={step() !== null}>
            <span class="mc-steps" aria-hidden="true"><For each={[0, 1, 2]}>{index => <i data-step={index < (step() ?? 0) ? 'done' : index === step() ? 'now' : 'later'} />}</For></span>
          </Show>
        </p>
        <h2 class="mc-title">{words().title}</h2>
        <p class="mc-detail" classList={{ 'mc-notice': notice() !== null }}>{notice() ?? words().detail}</p>
      </div>
      <Show when={actions().length > 0 || counting()}>
        <div class="mc-actions">
          <Show when={counting()}>
            <span class="mc-count" aria-label={`${s().optedIn} marching`}><b>{s().optedIn}</b><span>marching</span></span>
          </Show>
          <For each={actions()}>{action => <ActionControl action={action} snap={s()} controller={props.controller} putAway={props.putAway} />}</For>
        </div>
      </Show>
    </div>
  </section>;
}

/** Which of the three stages of a journey is under way: a place held, the world drawn, the step through. */
function journeyStep(s: GateSnapshot): number | null {
  const j = s.journey;
  if (!j || j.refusal) return null;
  switch (j.state) {
    case 'asking': case 'reserved': return 0;
    case 'preparing': return 1;
    case 'ready': case 'committing': case 'unknown': return 2;
    default: return null;
  }
}

/** A press from a pointer leaves no focus behind, so Space and Enter go back to walking rather than pressing again. */
function pressed(event: MouseEvent, act: () => void): void {
  if (event.detail > 0 && event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
  act();
}

function ActionControl(props: { action: MarchAction; snap: GateSnapshot; controller: RaidGateController; putAway: () => void }) {
  const s = () => props.snap;
  const c = props.controller;
  const monarch = () => s().viewer === 'monarch';
  const j = () => s().journey;
  const gateBusy = () => s().busy !== null;
  const journeyBusy = () => j()?.busy != null;
  const login = () => watchLogin(s());

  switch (props.action) {
    case 'join':
      return <button class="mc-button mc-primary" disabled={gateBusy()} aria-busy={s().busy === 'join'} onClick={event => pressed(event, () => void c.join())}>
        <Glyph kind="boot" />{s().busy === 'join' ? 'Joining…' : monarch() ? 'Lead the march' : 'Join the march'}
      </button>;
    case 'leave':
      return <button class="mc-button mc-subtle" disabled={gateBusy()} aria-busy={s().busy === 'leave'} onClick={event => pressed(event, () => void c.leave())}>
        {s().busy === 'leave' ? 'Leaving…' : monarch() ? 'Stay behind' : 'Leave the march'}
      </button>;
    case 'ride':
      return <button class="mc-button mc-primary mc-ride" onClick={event => pressed(event, () => void c.travel())}><Glyph kind="gate" />Ride out</button>;
    case 'stay':
      return <button class="mc-button mc-subtle" onClick={event => pressed(event, props.putAway)}>Stay home</button>;
    case 'watch':
      return <Show when={login()}>{name =>
        <a class="mc-button mc-subtle mc-watch" href={twitchChannelUrl(name())} target="_blank" rel="noopener noreferrer"><Glyph kind="eye" />Watch on Twitch</a>
      }</Show>;
    case 'turn-back':
      return <button class="mc-button mc-subtle" disabled={journeyBusy()} aria-busy={j()?.busy === 'cancel'} onClick={event => pressed(event, () => void c.cancelTravel())}>
        {j()?.busy === 'cancel' ? 'Turning back…' : j()?.kind === 'return' ? 'Stay a while longer' : 'Turn back'}
      </button>;
    case 'check':
      return <button class="mc-button mc-subtle" disabled={journeyBusy()} aria-busy={j()?.busy === 'reconcile'} onClick={event => pressed(event, () => void c.reconcileTravel())}>
        {j()?.busy === 'reconcile' ? 'Checking…' : 'Check again'}
      </button>;
    case 'return':
      return <button class="mc-button mc-primary" disabled={journeyBusy()} onClick={event => pressed(event, () => void c.returnHome())}><Glyph kind="boot" />Return home</button>;
    case 'again':
      return <button class="mc-button mc-primary" onClick={event => pressed(event, () => { c.dismissJourney(); void c.travel(); })}>
        <Glyph kind="gate" />{j()?.refusal === 'full' ? 'Ask again' : 'Try the gate again'}
      </button>;
    case 'done':
      // Beside another choice it is the plain way to stay; on its own it is the small mark that puts news away.
      return <Show when={marchActions(s()).length > 1} fallback={
        <button class="mc-close" aria-label="Put this away" title="Put this away" onClick={event => pressed(event, props.putAway)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
        </button>
      }>
        <button class="mc-button mc-subtle" onClick={event => pressed(event, props.putAway)}>{j()?.kind === 'return' ? 'Stay here' : 'Stay home'}</button>
      </Show>;
  }
}

function Glyph(props: { kind: 'boot' | 'gate' | 'eye' }) {
  const paths: Record<typeof props.kind, string[]> = {
    boot: ['M8 3h5v9l6 3.5c1.3.8 2 1.8 2 3.2V20H4V14c2.5 0 4-1.4 4-4Z', 'M4 17h17'],
    // An arch with both leaves swung outward.
    gate: ['M4 21V10a8 8 0 0 1 16 0v11', 'M4 21h16', 'M8 21v-8l-3-2', 'M16 21v-8l3-2'],
    eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'M12 9.2a2.8 2.8 0 1 0 .01 0Z'],
  };
  return <svg class="mc-glyph" viewBox="0 0 24 24" aria-hidden="true"><For each={paths[props.kind]}>{d => <path d={d} />}</For></svg>;
}
