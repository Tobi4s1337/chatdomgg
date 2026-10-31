import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { GATE_LIMITS, type GateDenial } from '../../../api/src/raid-gate/contracts';
import type { GateDestination, GateFarewell, GateNotice, GateSnapshot, RaidGateController } from './controller';
import { Seal } from './Seal';

/**
 * The gate board: a walnut and brass plaque with a parchment inlay, docked beside the kingdom on desktop and as a
 * sheet at the foot of a phone. It reads the controller's snapshot and sends nothing on its own.
 */
export function RaidGatePane(props: { controller: RaidGateController; clock: () => number }) {
  const [snap, setSnap] = createSignal<GateSnapshot>(props.controller.snapshot());
  const [now, setNow] = createSignal(props.clock());
  onMount(() => {
    const stop = props.controller.subscribe(setSnap);
    // Remaining preview time is shown in whole seconds; the authority decides when it truly ends.
    const timer = window.setInterval(() => { setNow(props.clock()); setSnap(props.controller.snapshot()); }, 1000);
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && snap().phase === 'choosing') { event.preventDefault(); props.controller.close(); }
    };
    window.addEventListener('keydown', keys);
    onCleanup(() => { stop(); window.clearInterval(timer); window.removeEventListener('keydown', keys); });
  });
  const s = snap;
  const simulated = () => s().origin === 'simulated';
  const name = () => s().source.name;

  return <aside class="rg-pane" data-phase={s().phase} data-viewer={s().viewer ?? 'none'} aria-labelledby="rg-title">
    <div class="rg-board">
      <Corner at="tl" /><Corner at="tr" /><Corner at="bl" /><Corner at="br" />
      <header class="rg-head">
        <Seal kingdomId={s().source.kingdomId} size={58} label={`Arms of ${name()}`} />
        <div class="rg-head-words">
          <p class="rg-eyebrow">The gate of {name()}</p>
          <h2 id="rg-title" class="rg-title">{title(s())}</h2>
        </div>
      </header>
      <div class="rg-parchment">
        <Show when={s().notice}>{notice => <p class="rg-notice" role="alert">{noticeText(notice(), s())}</p>}</Show>
        <Switch>
          <Match when={s().phase === 'unbound'}>
            <p class="rg-lede">This view isn't signed in to {name()}'s gate, so nothing here can call a raid or move anyone.</p>
            <p class="rg-quiet">Sign in at the kingdom to gather at the gate. Watching on Twitch is always enough to enjoy the night.</p>
          </Match>
          <Match when={s().phase === 'loading'}>
            <p class="rg-lede rg-waiting"><Quill />Asking the gatekeeper…</p>
          </Match>
          <Match when={s().phase === 'unreachable'}>
            <p class="rg-lede">The gatekeeper can't be reached right now. Nothing has changed, and everyone is where they were.</p>
            <div class="rg-actions"><button class="rg-button" onClick={() => void props.controller.refresh()}>Ask again</button></div>
          </Match>
          <Match when={s().phase === 'authority'}>
            <AuthorityState snap={s()} controller={props.controller} />
          </Match>
          <Match when={s().phase === 'idle'}>
            <Show when={s().farewell}>{farewell => <Farewell farewell={farewell()} snap={s()} />}</Show>
            <p class="rg-lede">Pick a live kingdom on the Atlas. You'll see who has chosen to march before anything happens on Twitch.</p>
            <div class="rg-actions"><button class="rg-button rg-primary" onClick={() => props.controller.open()}><MapGlyph />Choose where to ride</button></div>
            <p class="rg-quiet">Opening the map changes nothing. Only people who choose to march will travel.</p>
          </Match>
          <Match when={s().phase === 'choosing'}>
            <p class="rg-lede">Choose a live kingdom on the map. The gate stays shut while you look.</p>
            <div class="rg-actions"><button class="rg-button" onClick={() => props.controller.close()}>Put the map away <kbd>Esc</kbd></button></div>
          </Match>
          <Match when={s().phase === 'previewing'}>
            <p class="rg-lede rg-waiting"><Quill />Asking the road to {s().asking?.displayName ?? 'that kingdom'}…</p>
          </Match>
          <Match when={(s().phase === 'preview' || s().phase === 'gathering') && s().destination}>
            <Show when={s().farewell}>{farewell => <Farewell farewell={farewell()} snap={s()} />}</Show>
            <Journey snap={s()} destination={s().destination!} now={now()} />
            <Party snap={s()} controller={props.controller} />
            <Show when={s().phase === 'preview'}>
              <ul class="rg-facts">
                <li><Glyph kind="hourglass" /><span>When you open the gate, Twitch counts down <b>90 seconds</b> before the raid begins. The party sets out only when Twitch confirms it.</span></li>
                <li><Glyph kind="seal" /><span>This preview holds for <b class="rg-numeral">{remaining(s().expiresAt, now())}</b>. Pick again any time.</span></li>
              </ul>
              <div class="rg-actions">
                <Show when={s().canStart} fallback={
                  <button class="rg-button rg-primary" disabled={s().busy !== null} onClick={() => void props.controller.preview(s().destination!.target.kingdomId)}><Glyph kind="seal" />Renew this preview</button>
                }>
                  <button class="rg-button rg-primary" disabled={s().busy !== null} onClick={() => void props.controller.start()}><Glyph kind="gate" />Open the gate</button>
                </Show>
                <button class="rg-button" disabled={s().busy !== null} onClick={() => props.controller.open()}><MapGlyph />Choose another</button>
                <button class="rg-button rg-subtle" disabled={s().busy !== null} aria-busy={s().busy === 'close'} onClick={() => void props.controller.cancel()}><Glyph kind="bar" />{s().busy === 'close' ? 'Closing the gate…' : 'Close the gate'}</button>
              </div>
            </Show>
          </Match>
          <Match when={(s().phase === 'starting' || s().phase === 'countdown' || s().phase === 'checking') && s().destination}>
            <Journey snap={s()} destination={s().destination!} now={now()} />
            <Switch>
              <Match when={s().phase === 'starting'}>
                <p class="rg-lede rg-waiting"><Quill />{s().viewer === 'monarch' ? 'Asking Twitch to start the raid…' : 'The monarch is opening the gate…'}</p>
              </Match>
              <Match when={s().phase === 'countdown'}>
                <Countdown endsAt={s().countdownEndsAt} now={now()} />
              </Match>
              <Match when={s().phase === 'checking'}>
                <p class="rg-checking" role="status"><Quill /><span>{s().checking === 'countdown'
                  ? "Twitch's countdown has ended, but the raid hasn't been seen on Twitch yet. Nobody has left, and staying home is always fine."
                  : "We haven't seen the raid begin on Twitch yet, so we're checking. Nobody has left, and nothing is sent to Twitch twice."}</span></p>
              </Match>
            </Switch>
            <Party snap={s()} controller={props.controller} />
            <div class="rg-actions">
              <Show when={s().phase === 'checking'}>
                <button class="rg-button" disabled={s().busy !== null} aria-busy={s().busy === 'reconcile'} onClick={() => void props.controller.reconcile()}>{s().busy === 'reconcile' ? 'Checking…' : 'Check again'}</button>
              </Show>
              <Show when={s().viewer === 'monarch' && s().phase !== 'starting'}>
                <button class="rg-button rg-subtle" disabled={s().busy !== null} aria-busy={s().busy === 'close'} onClick={() => void props.controller.cancel()}><Glyph kind="bar" />{s().busy === 'close' ? 'Calling it off…' : 'Call off the raid'}</button>
              </Show>
            </div>
          </Match>
          <Match when={s().phase === 'departed' && s().destination && s().raid}>
            <Departure snap={s()} destination={s().destination!} />
          </Match>
          <Match when={(s().phase === 'called-off' || s().phase === 'refused') && s().destination}>
            <p class="rg-farewell" role="status">
              <Seal kingdomId={s().destination!.target.kingdomId} size={34} wax={s().destination!.land === 'founded' ? 'crimson' : 'umber'} />
              <span>{s().phase === 'called-off'
                ? `Twitch confirmed the raid to ${destinationName(s().destination!)} was called off. Nobody left, and everyone is home.`
                : `Twitch didn't start the raid to ${destinationName(s().destination!)}. Nothing left the kingdom, and everyone is home.`}</span>
            </p>
            <Show when={s().viewer === 'monarch'} fallback={<p class="rg-quiet">When the monarch calls the realm to the gate again, you can choose to march. Staying is always fine.</p>}>
              <div class="rg-actions"><button class="rg-button rg-primary" disabled={s().authority !== 'ready'} onClick={() => props.controller.open()}><MapGlyph />Choose where to ride</button></div>
            </Show>
          </Match>
          <Match when={s().phase === 'lapsed'}>
            <p class="rg-lede">The preview ran out before the gate opened. Everyone who chose to march is free again.</p>
            <div class="rg-actions"><button class="rg-button rg-primary" onClick={() => props.controller.open()}><MapGlyph />Choose where to ride</button></div>
          </Match>
          <Match when={s().phase === 'quiet' && s().farewell}>
            <Farewell farewell={s().farewell!} snap={s()} />
            <p class="rg-quiet">When {name()}'s monarch calls the realm to the gate again, you can choose to march with them. Staying is always fine.</p>
          </Match>
          <Match when={s().phase === 'quiet'}>
            <p class="rg-lede">When {name()}'s monarch calls the realm to the gate, you can choose to march with them.</p>
            <p class="rg-quiet">Nobody travels unless they choose to. Staying is always fine.</p>
          </Match>
        </Switch>
      </div>
      <Show when={simulated()}><p class="rg-simulated" title="Bench authority, walkers and Twitch answers; nothing reaches Twitch"><span class="rg-pip" />SIMULATED</p></Show>
    </div>
  </aside>;
}

function title(s: GateSnapshot): string {
  const destination = s.destination ? destinationName(s.destination) : null;
  switch (s.phase) {
    case 'unbound': return 'The gate is shut here';
    case 'loading': return 'At the gate';
    case 'unreachable': return 'The gatekeeper is away';
    case 'authority': return AUTHORITY_TITLES[s.authority ?? 'unavailable'];
    case 'idle': return s.farewell ? 'You closed the gate' : 'Call your people to the gate';
    case 'choosing': return 'The Atlas is open';
    case 'previewing': return 'Asking the road';
    case 'preview': return `Ride to ${destination ?? 'a neighbour'}?`;
    case 'lapsed': return 'The preview ran out';
    case 'quiet': return s.farewell?.reason === 'lapsed' ? 'The call has ended' : s.farewell ? 'The gate has closed' : 'The gate is quiet';
    case 'gathering': return `${s.source.name} gathers at the gate`;
    case 'starting': return 'The gate is opening';
    case 'countdown': return `The road to ${destination ?? 'a neighbour'} is open`;
    case 'checking': return 'Checking whether the raid began';
    case 'departed': return `The party set out for ${destination ?? 'a neighbour'}`;
    case 'called-off': return 'The raid was called off';
    case 'refused': return "Twitch didn't start the raid";
  }
}

const AUTHORITY_TITLES = {
  ready: 'Ready to ride', offline: 'The gate opens while you are live', 'not-connected': "Twitch raids aren't connected",
  revoked: 'Raid permission was withdrawn', disabled: 'Royal acts are switched off', unavailable: "Twitch isn't answering",
} as const;

function AuthorityState(props: { snap: GateSnapshot; controller: RaidGateController }) {
  const name = props.snap.source.name;
  const body: Record<string, string> = {
    offline: 'Raids leave from a live stream. Go live, and your people can gather here.',
    'not-connected': `To ride out, Chatdom needs your permission to start raids on ${name}'s channel. You approve it once on Twitch, and nothing is sent until you open the gate.`,
    revoked: `Twitch no longer lets Chatdom start raids for ${name}. Reconnect to open the gate again.`,
    disabled: "You've switched off Chatdom's writes to Twitch. The gate stays shut until you switch them back on.",
    unavailable: "We couldn't confirm your raid permission just now. Nothing has been sent.",
  };
  const reconnect = props.snap.authority === 'not-connected' || props.snap.authority === 'revoked';
  return <>
    <p class="rg-lede">{body[props.snap.authority ?? 'unavailable']}</p>
    <div class="rg-actions">
      <Show when={reconnect && props.snap.canReconnect}><button class="rg-button rg-primary" onClick={() => props.controller.reconnect()}><Glyph kind="key" />{props.snap.authority === 'revoked' ? 'Reconnect Twitch' : 'Connect Twitch raids'}</button></Show>
      <Show when={props.snap.authority === 'unavailable' || props.snap.authority === 'offline'}><button class="rg-button" onClick={() => void props.controller.refresh()}>Check again</button></Show>
    </div>
    <Show when={reconnect && !props.snap.canReconnect}><p class="rg-quiet">Reconnect from the throne's Twitch settings; this view has no account controls.</p></Show>
  </>;
}

function destinationName(destination: GateDestination): string {
  return destination.channel?.kingdomName ?? destination.channel?.displayName ?? 'a live channel';
}

function Journey(props: { snap: GateSnapshot; destination: GateDestination; now: number }) {
  const d = () => props.destination;
  const land = () => d().land ?? (d().target.founded ? 'founded' : 'waiting');
  return <section class="rg-journey" data-stage={props.snap.phase} aria-label="The road">
    <div class="rg-road">
      <figure class="rg-end"><Seal kingdomId={props.snap.source.kingdomId} size={64} /><figcaption>{props.snap.source.name}</figcaption></figure>
      <svg class="rg-ink-road" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true">
        <path d="M2 26C22 6 38 34 60 20s36-10 58 2" />
        <path class="rg-road-arrow" d="m108 15 10 7-11 4" />
      </svg>
      <figure class="rg-end"><Seal kingdomId={d().target.kingdomId} size={64} wax={land() === 'founded' ? 'crimson' : 'umber'} /><figcaption>{destinationName(d())}</figcaption></figure>
    </div>
    <ul class="rg-tags">
      <li class="rg-live"><span class="rg-live-pip" />{d().target.live ? 'Live on Twitch now' : 'Not live'}</li>
      <li>{land() === 'founded' ? 'A founded kingdom' : land() === 'waiting' ? 'Waiting land' : 'At the edge of the map'}</li>
      <Show when={d().channel && d().channel!.kingdomName && d().channel!.displayName !== d().channel!.kingdomName}><li>{d().channel!.displayName}</li></Show>
    </ul>
    <Show when={land() !== 'founded'}>
      <p class="rg-quiet">{d().channel?.displayName ?? 'This channel'} has no kingdom yet. The road ends at their waiting land, and the raid still lands on Twitch.</p>
    </Show>
  </section>;
}

/** A gate that ended with nobody leaving, told once and calmly. Nobody is at fault and nothing was lost. */
function Farewell(props: { farewell: GateFarewell; snap: GateSnapshot }) {
  const f = () => props.farewell;
  const where = () => destinationName(f().destination);
  const choice = () => f().joined ? ', and your choice to march ended with it' : '';
  const text = () => {
    if (f().reason === 'changed') return `The monarch now calls the realm to ${props.snap.destination ? destinationName(props.snap.destination) : 'another kingdom'} instead of ${where()}, so your choice to march ended. Join again if you'd like to come.`;
    if (props.snap.viewer === 'monarch') return `You closed the gate before the ride to ${where()}. Nothing was sent to Twitch, nobody left, and everyone who chose to march is home.`;
    if (f().reason === 'lapsed') return `The call to ${where()} ran out before the gate opened. Nobody left${choice()}.`;
    return `${props.snap.source.name}'s monarch closed the gate before the ride to ${where()}. Nobody left${choice()}.`;
  };
  return <p class="rg-farewell" role="status">
    <Seal kingdomId={f().destination.target.kingdomId} size={34} wax={f().destination.land === 'founded' ? 'crimson' : 'umber'} />
    <span>{text()}</span>
  </p>;
}

function Party(props: { snap: GateSnapshot; controller: RaidGateController }) {
  const s = () => props.snap;
  const count = () => s().optedIn;
  const others = () => count() - (s().joined ? 1 : 0);
  const line = () => count() === 0 ? (s().phase === 'gathering' || s().phase === 'preview' ? 'No one has chosen to march yet.' : 'No one has chosen to march.')
    : s().joined ? (others() === 0 ? 'You are the first to choose to march.' : `You and ${others()} ${others() === 1 ? 'other' : 'others'} have chosen to march.`)
    : `${count() === 1 ? 'One walker has' : `${count()} walkers have`} chosen to march.`;
  return <section class="rg-party" aria-label="Who is marching">
    <div class="rg-count" aria-live="polite"><span class="rg-numeral rg-count-number">{count()}</span><span class="rg-count-label">{count() === 1 ? 'walker' : 'walkers'}<br />marching</span></div>
    <div class="rg-party-words">
      <p>{line()}</p>
      <p class="rg-quiet">{s().viewer === 'monarch' ? 'Only people who choose to march travel. Chat can enjoy the whole ride on stream.' : 'Staying is always fine. Nobody is moved without choosing.'}</p>
    </div>
    <div class="rg-actions rg-party-actions">
      <Show when={s().joined} fallback={
        <button class="rg-button rg-primary" disabled={s().busy !== null} aria-busy={s().busy === 'join'} onClick={() => void props.controller.join()}><Glyph kind="boot" />{s().viewer === 'monarch' ? 'Lead the march' : 'Join the march'}</button>
      }>
        <p class="rg-joined" role="status"><Glyph kind="check" />{s().viewer === 'monarch' ? 'You lead the march' : "You're marching"}</p>
        <button class="rg-button" disabled={s().busy !== null} aria-busy={s().busy === 'leave'} onClick={() => void props.controller.leave()}>{s().viewer === 'monarch' ? 'Stay behind' : 'Stay home instead'}</button>
      </Show>
    </div>
  </section>;
}

/** Twitch's own countdown, read from Twitch's acceptance time; the party still waits for Twitch's raid after it. */
function Countdown(props: { endsAt: number | null; now: number }) {
  const left = () => props.endsAt === null ? 0 : Math.max(0, props.endsAt - props.now);
  return <div class="rg-countdown" role="timer" aria-label={`Twitch counts down ${remaining(props.endsAt, props.now)}`}>
    <svg class="rg-countdown-ring" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="19" class="rg-ring-track" />
      <circle cx="22" cy="22" r="19" class="rg-ring-ink" pathLength="100" stroke-dasharray={`${(left() / GATE_LIMITS.twitchCountdownMs) * 100} 100`} />
    </svg>
    <div>
      <p class="rg-countdown-time rg-numeral">{remaining(props.endsAt, props.now)}</p>
      <p class="rg-countdown-words">{left() > 0 ? 'Twitch is counting down. The party sets out when Twitch confirms the raid.' : 'The countdown has ended. Waiting for Twitch to confirm the raid.'}</p>
    </div>
  </div>;
}

/** The party set out on Twitch's verified raid. The Atlas carries the public caravan; the board tells this viewer's part. */
function Departure(props: { snap: GateSnapshot; destination: GateDestination }) {
  const s = () => props.snap;
  const raid = () => s().raid!;
  const where = () => destinationName(props.destination);
  const others = () => s().optedIn - (s().joined ? 1 : 0);
  const land = () => props.destination.land ?? (props.destination.target.founded ? 'founded' : 'waiting');
  const when = () => new Date(raid().occurredAt ?? raid().observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <section class="rg-departure" aria-label="The party set out">
    <div class="rg-road rg-road-departed">
      <figure class="rg-end"><Seal kingdomId={s().source.kingdomId} size={64} /><figcaption>{s().source.name}</figcaption></figure>
      <svg class="rg-ink-road rg-ink-road-set" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true">
        <path class="rg-road-trace" d="M2 26C22 6 38 34 60 20s36-10 58 2" />
        <path class="rg-road-inked" pathLength="100" d="M2 26C22 6 38 34 60 20s36-10 58 2" />
      </svg>
      <figure class="rg-end"><Seal kingdomId={props.destination.target.kingdomId} size={64} wax={land() === 'founded' ? 'crimson' : 'umber'} /><figcaption>{where()}</figcaption></figure>
    </div>
    <p class="rg-witnessed"><Glyph kind="seal" /><span>Twitch confirmed the raid at <b class="rg-numeral">{when()}</b>, with <b class="rg-numeral">{raid().viewers.toLocaleString()}</b> {raid().viewers === 1 ? 'viewer' : 'viewers'} riding along on stream.</span></p>
    <div class="rg-party rg-party-set">
      <div class="rg-count"><span class="rg-numeral rg-count-number">{s().optedIn}</span><span class="rg-count-label">{s().optedIn === 1 ? 'walker' : 'walkers'}<br />marched</span></div>
      <div class="rg-party-words">
        <p>{s().joined
          ? (others() === 0 ? `You marched out for ${where()}.` : `You marched out with ${others()} ${others() === 1 ? 'other' : 'others'}.`)
          : s().optedIn === 0 ? 'Nobody chose to march this time; the raid rode on Twitch.' : `${s().optedIn === 1 ? 'One walker' : `${s().optedIn} walkers`} marched out. You stayed home, and your door is right where you left it.`}</p>
        <Show when={land() !== 'founded'}><p class="rg-quiet">{props.destination.channel?.displayName ?? 'This channel'} has no kingdom yet. The road ends at their waiting land.</p></Show>
      </div>
    </div>
    <Show when={props.destination.channel}>{channel =>
      <a class="rg-button rg-watch" href={`https://www.twitch.tv/${channel().login}`} target="_blank" rel="noopener noreferrer"><Glyph kind="eye" />Watch {channel().displayName} on Twitch</a>
    }</Show>
  </section>;
}

function remaining(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return '0:00';
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const DENIALS: Record<GateDenial, (s: GateSnapshot) => string> = {
  unauthorized: s => `Only ${s.source.name}'s monarch can do that, and only while Twitch allows it.`,
  stale: () => 'That gate has moved on. This is where it stands now.',
  unavailable: () => "That kingdom can't be reached right now. Nothing was sent.",
  full: () => 'That kingdom is full right now. Nobody was moved.',
  invalid: () => "That request didn't look right, so nothing was sent.",
};

function noticeText(notice: GateNotice, s: GateSnapshot): string {
  if (notice.kind === 'denied') return DENIALS[notice.code](s);
  if (notice.kind === 'not-sent') return "Your press didn't reach the gate, so nothing was sent to Twitch. Open the gate again when you're ready.";
  if (notice.kind === 'no-map') return "The Atlas isn't open in this view.";
  return "Couldn't reach the gatekeeper. Nothing changed.";
}

function Corner(props: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  return <svg class={`rg-corner rg-corner-${props.at}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M1 1h22l-3 5H6v14l-5 3Z" fill="url(#rg-brass)" stroke="#2b1c10" stroke-width=".8" stroke-linejoin="round" />
    <path d="M2.6 2.6h17.6M2.6 2.6v17" stroke="#fff1cc" stroke-width=".6" opacity=".55" fill="none" />
    <circle cx="4.6" cy="4.6" r="1.5" fill="#4a321b" /><circle cx="4.3" cy="4.3" r=".6" fill="#f7deae" />
  </svg>;
}

/** Brass gradients, defined once per page. */
export function GateDefs() {
  return <svg class="rg-defs" aria-hidden="true" width="0" height="0">
    <linearGradient id="rg-brass" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#f3d69c" /><stop offset=".35" stop-color="#c69a5c" /><stop offset=".7" stop-color="#8d6537" /><stop offset="1" stop-color="#5f4224" />
    </linearGradient>
  </svg>;
}

function Glyph(props: { kind: 'hourglass' | 'seal' | 'key' | 'boot' | 'check' | 'bar' | 'gate' | 'eye' }) {
  const paths: Record<typeof props.kind, string[]> = {
    hourglass: ['M6 3h12M6 21h12', 'M7 3c0 6 10 6 10 9s-10 3-10 9', 'M17 3c0 6-10 6-10 9s10 3 10 9'],
    seal: ['M12 3a9 9 0 1 0 .1 0Z', 'M12 7.5 13.4 11l3.6.2-2.8 2.3 1 3.5-3.2-2-3.2 2 1-3.5L7 11.2l3.6-.2Z'],
    key: ['M14.5 4a5.5 5.5 0 1 1-4.2 9.1L4 19.5V21h3v-2h2v-2h2l1.6-1.6', 'M16.5 7.5h.01'],
    boot: ['M8 3h5v9l6 3.5c1.3.8 2 1.8 2 3.2V20H4V14c2.5 0 4-1.4 4-4Z', 'M4 17h17'],
    check: ['m5 12.5 4.5 4.5L19 7'],
    // Two gate leaves and the bar laid across them.
    bar: ['M5 4v16M19 4v16', 'M5 4c2.3-1 4.7-1 7 0s4.7 1 7 0', 'M3 12.5h18', 'M12 4v16'],
    // An arch with both leaves swung outward.
    gate: ['M4 21V10a8 8 0 0 1 16 0v11', 'M4 21h16', 'M8 21v-8l-3-2', 'M16 21v-8l3-2'],
    eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'M12 9.2a2.8 2.8 0 1 0 .01 0Z'],
  };
  return <svg class="rg-glyph" viewBox="0 0 24 24" aria-hidden="true"><For each={paths[props.kind]}>{d => <path d={d} />}</For></svg>;
}

function MapGlyph() {
  return <svg class="rg-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z" /><path d="M9 4v13.5M15 6.5V20" /><path d="M5.5 12.5c1.5-1.6 3-1 4.2.2s3.1 1.6 4.6.2 2.6-1.4 4-.6" stroke-dasharray="1.6 1.6" /></svg>;
}

function Quill() {
  return <svg class="rg-glyph rg-quill" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3C12 4 7 9 5 19" /><path d="M20 3c-1 6-5 10-11 11" /><path d="M4 21l1-2" /></svg>;
}
