import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { GATE_LIMITS, type GateDenial } from '../../../api/src/raid-gate/contracts';
import type { GateDestination, GateFarewell, GateNotice, GateSnapshot, JourneySnapshot, RaidGateController } from './controller';
import { Seal } from './Seal';
import { VisitorGiftPane } from './VisitorGifts';

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
  const name = () => s().source.name;

  return <aside class="rg-pane" data-phase={s().journey ? 'journey' : s().phase} data-viewer={s().viewer ?? 'none'} aria-labelledby="rg-title">
    <div class="rg-board">
      <Corner at="tl" /><Corner at="tr" /><Corner at="bl" /><Corner at="br" />
      <header class="rg-head">
        <Seal kingdomId={s().source.kingdomId} size={58} label={`Arms of ${name()}`} />
        <div class="rg-head-words">
          <p class="rg-eyebrow">The gate of {name()}</p>
          <h2 id="rg-title" class="rg-title">{s().journey ? journeyTitle(s(), s().journey!) : title(s())}</h2>
        </div>
      </header>
      <div class="rg-parchment">
        <Show when={s().notice}>{notice => <p class="rg-notice" role="alert">{noticeText(notice(), s())}</p>}</Show>
        <Show when={!s().journey} fallback={<TravelBoard snap={s()} journey={s().journey!} controller={props.controller} now={now()} />}>
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
            <Show when={s().canTravel}>
              <div class="rg-actions rg-follow">
                <button class="rg-button rg-primary" onClick={() => void props.controller.travel()}><Glyph kind="gate" />Follow the party through the gate</button>
              </div>
              <p class="rg-quiet">You'll stay in {name()} until {destinationName(s().destination!)} is ready for you. Your door here is kept.</p>
            </Show>
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
        </Show>
      </div>
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
      <Show when={props.snap.authority === 'unavailable' || props.snap.authority === 'offline' || (reconnect && !props.snap.canReconnect)}><button class="rg-button" onClick={() => void props.controller.refresh()}>Check again</button></Show>
    </div>
    <Show when={reconnect && !props.snap.canReconnect}><p class="rg-quiet">Your kingdom's keeper renews this permission with Twitch. Check again once it is renewed.</p></Show>
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

// ---- One walker's journey through the gate ------------------------------------------------------------------------

function journeyNames(s: GateSnapshot, j: JourneySnapshot): Readonly<{ leaving: string; going: string }> {
  const away = j.destination ? destinationName(j.destination) : 'that kingdom';
  return j.kind === 'return' ? { leaving: away, going: s.source.name } : { leaving: s.source.name, going: away };
}

function journeyTitle(s: GateSnapshot, j: JourneySnapshot): string {
  const { going } = journeyNames(s, j);
  if (j.refusal) return j.refusal === 'full' ? `${going} is full right now` : "You're still home";
  switch (j.state) {
    case 'asking': case 'reserved': return j.kind === 'return' ? 'Setting out for home' : `Setting out for ${going}`;
    case 'preparing': return j.overrun ? `${going} is still drawing its world` : `${going} draws its world`;
    case 'ready': case 'committing': return 'Stepping through the gate';
    case 'unknown': return 'Confirming where you stand';
    case 'committed': return j.kind === 'return' ? `Home in ${going}` : `At the gate of ${going}`;
    case 'cancelled': return 'You turned back';
    case 'expired': return 'The held place lapsed';
    case 'denied': return `${going} couldn't take you`;
  }
}

const JOURNEY_ORDER = ['asking', 'reserved', 'preparing', 'ready', 'committing', 'unknown', 'committed'] as const;

/** Where the lantern stands on the road, as a fraction of the way. Rolled-back journeys never left. */
function lanternAt(j: JourneySnapshot): number {
  switch (j.state) {
    case 'asking': case 'reserved': return .14;
    case 'preparing': return .42;
    case 'ready': case 'committing': case 'unknown': return .76;
    case 'committed': return 1;
    default: return 0;
  }
}

/**
 * A point on the road's curve (`M2 26C22 6 38 34 60 20s36-10 58 2`, in its 120×40 drawing), a fraction of the way
 * along: two cubic segments, the second the smooth continuation of the first.
 */
function roadPoint(fraction: number): Readonly<{ x: number; y: number }> {
  const segments = [[[2, 26], [22, 6], [38, 34], [60, 20]], [[60, 20], [82, 6], [96, 10], [118, 22]]] as const;
  const f = Math.min(1, Math.max(0, fraction));
  const [p0, p1, p2, p3] = segments[f <= .5 ? 0 : 1];
  const t = f <= .5 ? f * 2 : f * 2 - 1, u = 1 - t;
  const at = (axis: 0 | 1) => u * u * u * p0[axis] + 3 * u * u * t * p1[axis] + 3 * u * t * t * p2[axis] + t * t * t * p3[axis];
  return { x: at(0), y: at(1) };
}

function TravelBoard(props: { snap: GateSnapshot; journey: JourneySnapshot; controller: RaidGateController; now: number }) {
  const s = () => props.snap;
  const j = () => props.journey;
  const names = () => journeyNames(s(), j());
  const away = () => j().destination;
  const waxAway = () => away()?.land && away()!.land !== 'founded' ? 'umber' as const : 'crimson' as const;
  const leftSeal = () => j().kind === 'return' ? away()?.target.kingdomId ?? j().from : s().source.kingdomId;
  const rightSeal = () => j().kind === 'return' ? s().source.kingdomId : j().to;
  const rolledBack = () => j().state === 'cancelled' || j().state === 'expired' || j().state === 'denied' || j().refusal !== null;
  const arrived = () => j().state === 'committed';
  return <section class="rg-travel" data-state={j().refusal ? 'refused' : j().state} data-kind={j().kind} aria-label="Your journey">
    <div class="rg-road rg-road-travel" style={{ '--lantern': String(lanternAt(j())) }}>
      <figure class="rg-end">
        <Seal kingdomId={leftSeal()} size={64} wax={j().kind === 'return' ? waxAway() : 'crimson'} />
        <figcaption>{names().leaving}</figcaption>
      </figure>
      <div class="rg-travel-way" aria-hidden="true">
        <svg class="rg-ink-road rg-ink-road-travel" viewBox="0 0 120 40" preserveAspectRatio="none">
          <path class="rg-road-trace" d="M2 26C22 6 38 34 60 20s36-10 58 2" />
          <path class="rg-road-walked" pathLength="100" d="M2 26C22 6 38 34 60 20s36-10 58 2" />
        </svg>
        <Show when={!rolledBack()}>{(() => {
          const point = () => roadPoint(lanternAt(j()));
          return <span class="rg-lantern" style={{ left: `${(point().x / 120) * 100}%`, top: `${12 + point().y}px` }}><span class="rg-lantern-flame" /></span>;
        })()}</Show>
      </div>
      <figure class="rg-end rg-end-goal" classList={{ 'rg-end-lit': arrived() }}>
        <Show when={arrived()}><span class="rg-torchlight" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span></Show>
        <Seal kingdomId={rightSeal()} size={64} wax={j().kind === 'return' ? 'crimson' : waxAway()} />
        <figcaption>{names().going}</figcaption>
      </figure>
    </div>
    <Switch>
      <Match when={j().refusal}>{code => <RefusedJourney snap={s()} journey={j()} code={code()} controller={props.controller} />}</Match>
      <Match when={rolledBack()}>
        <p class="rg-farewell" role="status">
          <Seal kingdomId={rightSeal()} size={34} wax={j().kind === 'return' ? 'crimson' : waxAway()} />
          <span>{j().state === 'cancelled' ? `You turned back before stepping through. You never left ${names().leaving}, and nothing moved.`
            : j().state === 'expired' ? `The place ${names().going} held for you lapsed before you stepped through. You never left ${names().leaving}.`
            : `${names().going} couldn't take you just now. You never left ${names().leaving}, and your door is where you left it.`}</span>
        </p>
        <div class="rg-actions">
          <Show when={j().kind === 'raid'}><button class="rg-button rg-primary" onClick={() => { props.controller.dismissJourney(); void props.controller.travel(); }}><Glyph kind="gate" />Try the gate again</button></Show>
          <button class="rg-button" onClick={() => props.controller.dismissJourney()}>{j().kind === 'raid' ? 'Stay home' : 'Stay here'}</button>
        </div>
      </Match>
      <Match when={arrived() && j().kind === 'raid'}>
        <Arrived snap={s()} journey={j()} controller={props.controller} now={props.now} />
      </Match>
      <Match when={arrived()}>
        <p class="rg-arrival-line">You're home in {names().going}. Your door is right where you left it.</p>
        <div class="rg-actions"><button class="rg-button rg-primary" onClick={() => props.controller.dismissJourney()}><Glyph kind="check" />Put the journey away</button></div>
      </Match>
      <Match when={j().state === 'unknown'}>
        <JourneySteps snap={s()} journey={j()} />
        <p class="rg-checking" role="status"><Quill /><span>Your step through the gate is being confirmed with {names().going}. You stand in exactly one place, and nothing will move you twice.</span></p>
        <div class="rg-actions">
          <button class="rg-button" disabled={j().busy !== null} aria-busy={j().busy === 'reconcile'} onClick={() => void props.controller.reconcileTravel()}>{j().busy === 'reconcile' ? 'Checking…' : 'Check again'}</button>
        </div>
      </Match>
      <Match when={true}>
        <JourneySteps snap={s()} journey={j()} />
        <Show when={j().overrun} fallback={<p class="rg-quiet">You're still in {names().leaving} until you step through. {j().kind === 'raid' ? 'Your door there is kept.' : ''}</p>}>
          <p class="rg-overrun" role="status"><Quill /><span>{names().going} is taking longer than usual to ready its world. The road holds, and you're still in {names().leaving} until it's ready.</span></p>
        </Show>
        <Show when={j().state !== 'committing'}>
          <div class="rg-actions">
            <button class="rg-button rg-subtle" disabled={j().busy !== null || j().ticket === null} aria-busy={j().busy === 'cancel'} onClick={() => void props.controller.cancelTravel()}>
              <Glyph kind="bar" />{j().busy === 'cancel' ? 'Turning back…' : j().kind === 'raid' ? 'Turn back and stay home' : 'Stay a while longer'}
            </button>
          </div>
        </Show>
      </Match>
    </Switch>
  </section>;
}

/** The authority's real stages, inked as each one is answered. */
function JourneySteps(props: { snap: GateSnapshot; journey: JourneySnapshot }) {
  const j = () => props.journey;
  const going = () => journeyNames(props.snap, j()).going;
  const at = () => JOURNEY_ORDER.indexOf(j().state as typeof JOURNEY_ORDER[number]);
  const steps = () => [
    { label: `${going()} holds a place for you`, from: 0, until: 2 },
    { label: `${going()} draws its world`, from: 2, until: 3 },
    { label: 'Stepping through the gate', from: 3, until: 6 },
  ];
  return <ol class="rg-steps">
    <For each={steps()}>{step => {
      const state = () => at() >= step.until ? 'done' : at() >= step.from ? 'now' : 'later';
      return <li data-step={state()} aria-current={state() === 'now' ? 'step' : undefined}>
        <span class="rg-step-mark" aria-hidden="true"><Show when={state() === 'done'}><Glyph kind="check" /></Show></span>
        <span>{step.label}</span>
      </li>;
    }}</For>
  </ol>;
}

function Arrived(props: { snap: GateSnapshot; journey: JourneySnapshot; controller: RaidGateController; now: number }) {
  const s = () => props.snap;
  const j = () => props.journey;
  const going = () => journeyNames(s(), j()).going;
  const role = () => j().role === 'monarch' ? `You're on your own throne in ${going()}.`
    : j().role === 'citizen' ? `You're at your own door in ${going()}.`
    : `You stand at ${going()}'s gate as a visitor. You carry no rank here, only your company.`;
  return <>
    <p class="rg-arrival-line">{role()}</p>
    <Show when={s().welcome?.view}>
      <VisitorGiftPane welcome={s().welcome!} hostName={going()} now={props.now}
        actions={{ accept: id => void props.controller.acceptGift(id), refuse: id => void props.controller.refuseGift(id), leave: (id, to) => void props.controller.leaveGift(id, to) }} />
    </Show>
    <p class="rg-quiet">Your home in {s().source.name} waits behind you, exactly as you left it. Coming home is your choice, whenever you like.</p>
    <div class="rg-actions">
      <button class="rg-button rg-primary" disabled={j().busy !== null} onClick={() => void props.controller.returnHome()}><Glyph kind="boot" />Return to {s().source.name}</button>
      <Show when={j().destination?.channel}>{channel =>
        <a class="rg-button rg-watch" href={`https://www.twitch.tv/${channel().login}`} target="_blank" rel="noopener noreferrer"><Glyph kind="eye" />Watch on Twitch</a>
      }</Show>
    </div>
  </>;
}

function RefusedJourney(props: { snap: GateSnapshot; journey: JourneySnapshot; code: GateDenial; controller: RaidGateController }) {
  const names = () => journeyNames(props.snap, props.journey);
  const text = () => {
    switch (props.code) {
      case 'full': return `${names().going} has no room right now. Nobody was moved and nothing was held. Wait a moment and ask again, or stay home.`;
      case 'unauthorized': return `${names().going} isn't admitting you right now. You never left ${names().leaving}.`;
      case 'unavailable': return `${names().going} can't be reached right now. Nothing moved.`;
      case 'stale': return `That journey has moved on. You're still in ${names().leaving}.`;
      case 'invalid': return "That journey didn't look right, so nothing moved.";
    }
  };
  const retry = () => props.journey.kind === 'raid' ? props.controller.travel() : props.controller.returnHome();
  return <>
    <p class="rg-farewell" role="status"><Seal kingdomId={props.journey.to} size={34} wax="umber" /><span>{text()}</span></p>
    <div class="rg-actions">
      <Show when={props.code === 'full' && props.journey.kind === 'raid'}><button class="rg-button rg-primary" onClick={() => { props.controller.dismissJourney(); void retry(); }}><Glyph kind="hourglass" />Ask again</button></Show>
      <button class="rg-button" onClick={() => props.controller.dismissJourney()}>{props.journey.kind === 'raid' ? 'Stay home' : 'Stay here'}</button>
    </div>
  </>;
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
