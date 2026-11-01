import { createEffect, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from 'solid-js';
import type { CardReply, CardRoad, ChannelFace, DirectoryError, RoadReply, RoadTally } from '../data/directory';
import { waitingDoorHolding, type DoorHolding } from '../data/holding';
import type { PreviewWorld } from '../data/preview';
import { formatCount, formatDayRange, formatMoment, formatTime, TIER_NAMES, watchUrl } from './format';
import { ShieldIcon } from './marks';
import { ChannelFaceSeal } from './Face';

/** What the page knows of the open card's register entry. */
export type RegisterState<T> =
  | { status: 'loading' }
  | { status: 'ready'; reply: T }
  | { status: 'missing' }
  | { status: 'failed'; reason: DirectoryError['reason'] };

/** A channel's mark in lists: its arms when it holds land, a pencil flag when it waits, a dotted ring when unseen. */
export function PlaceMark(props: { face: ChannelFace; onAir?: boolean; size: number }) {
  return (
    <Switch>
      <Match when={props.face.place === 'mapped'}>
        <ShieldIcon channelId={props.face.id} width={Math.round(props.size * 0.78)} />
      </Match>
      <Match when={props.face.place === 'waiting'}>
        <svg class="atlas-place-flag" data-on-air={props.onAir ? 'true' : 'false'} viewBox="0 0 40 52" width={props.size * 0.8} height={props.size * 1.04} aria-hidden="true">
          <path d="M12 48V8" />
          <path d="M12.6 9.5c6 1.6 11-1.8 17 0.6-2.4 3-2.6 6.4 0.4 9.6-6.2-2-11.2 1.4-17.4-0.4z" />
        </svg>
      </Match>
      <Match when={true}>
        <svg class="atlas-place-unseen" viewBox="0 0 32 32" width={props.size * 0.8} height={props.size * 0.8} aria-hidden="true">
          <circle cx="16" cy="16" r="10.5" />
        </svg>
      </Match>
    </Switch>
  );
}

/** A face's name, or the honest description of a channel the register may not name. */
export function faceName(face: ChannelFace): string {
  if (face.name) return face.name;
  if (face.place === 'mapped') return `Unnamed ${TIER_NAMES[face.tier ?? 3]!.toLowerCase()}`;
  if (face.place === 'waiting') return 'An unnamed small channel';
  return 'A channel below the survey’s floor';
}

/** Realm and land of a face as the map names them ("Shooters · English", "Polski"). */
export function faceLand(face: ChannelFace, world: PreviewWorld): string | null {
  const region = world.regions[face.region ?? -1];
  const realm = world.realms[face.realm ?? -1];
  if (!region) return null;
  return region.kind === 'continent' && realm ? `${realm.name} · ${region.name}` : region.name;
}

const raids = (n: number) => `${formatCount(n)} ${n === 1 ? 'raid' : 'raids'}`;

/**
 * The register's part of a channel card: the last stream the survey saw and the strongest three observed roads, with
 * the dates they come from. Raid figures are the raid watch's totals per pair, never individual journeys, and a
 * missing road is a raid the watch did not see, not one that did not happen.
 */
export function RegisterFacts(props: {
  state: RegisterState<CardReply>;
  world: PreviewWorld;
  /** Whether the live frame shown now has this channel on air. */
  onAirNow: boolean | null;
  onRoad: (road: CardRoad) => void;
  onRetry: () => void;
}) {
  const card = () => (props.state.status === 'ready' ? props.state.reply : null);
  return (
    <Switch>
      <Match when={props.state.status === 'loading'}>
        <p class="atlas-register-wait" role="status">
          <svg class="atlas-search-quill" viewBox="0 0 120 14" aria-hidden="true"><path d="M3 9c12-7 20 3 30-2s14-8 23-3 15 5 23 1 15-7 24-2 11 4 14 2" /></svg>
          Reading its stream and roads from the register…
        </p>
      </Match>
      <Match when={props.state.status === 'failed'}>
        <div class="atlas-card-missing atlas-register-failed" role="status">
          <Show
            when={props.state.status === 'failed' && props.state.reason === 'refused'}
            fallback={<>Its last stream and roads could not be read from the register just now. <button type="button" class="atlas-link-button" on:click={() => props.onRetry()}>Read again</button></>}
          >
            Its last stream and roads are held back just now while the map’s moderation list is checked.
          </Show>
        </div>
      </Match>
      <Match when={card()}>
        {(c) => (
          <>
            <dl class="atlas-card-facts atlas-register-stream">
              <div>
                <dt>{props.onAirNow ? 'Streaming' : 'Last stream'}</dt>
                <Show when={c().stream} fallback={<dd class="atlas-quiet">Not live within the last day; titles are kept only that long.</dd>}>
                  {(stream) => (
                    <dd>
                      <span>{stream().game ?? 'No category given'}</span>
                      <Show when={stream().viewers !== null}><span class="atlas-quiet"> · {formatCount(stream().viewers!)} viewers</span></Show>
                      <span class="atlas-quiet">
                        {stream().live ? ` at the survey of ${formatTime(c().asOf)}` : ` · last live ${formatTime(c().lastLiveAt)}`}
                      </span>
                      <Show when={stream().title}><span class="atlas-register-title" dir="auto">{stream().title}</span></Show>
                    </dd>
                  )}
                </Show>
              </div>
            </dl>
            <section class="atlas-roads" aria-labelledby="atlas-roads-title">
              <h3 id="atlas-roads-title">
                Roads
                <Show when={c().roads.total > c().roads.strongest.length}>
                  <span class="atlas-quiet"> · strongest {c().roads.strongest.length} of {formatCount(c().roads.total)}</span>
                </Show>
              </h3>
              <Show
                when={c().roads.strongest.length > 0}
                fallback={<p class="atlas-roads-empty">No raid to or from this channel was seen between {formatMoment(c().roads.window.from)} and {formatMoment(c().roads.window.to)}.</p>}
              >
                <ul class="atlas-road-list">
                  <For each={c().roads.strongest}>
                    {(road) => (
                      <li>
                        <button type="button" class="atlas-road" on:click={() => props.onRoad(road)} aria-label={`Road with ${faceName(road.other)}: ${roadSummary(road)}`}>
                          <PlaceMark face={road.other} size={24} />
                          <span class="atlas-road-text">
                            <span class="atlas-road-name" classList={{ 'atlas-card-unnamed': !road.other.name }} dir="auto">{faceName(road.other)}</span>
                            <span class="atlas-road-tally">{roadSummary(road)}</span>
                          </span>
                          <svg class="atlas-road-go" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <p class="atlas-roads-source">
                Raids the raid watch saw, {formatDayRange(c().roads.window.from, c().roads.window.to)}, following up to {formatCount(c().coverage.raidWatch.watching)} live channels at a time. A raid it did not watch is missing here, not denied.
              </p>
            </section>
          </>
        )}
      </Match>
    </Switch>
  );
}

function roadSummary(road: CardRoad): string {
  const ways = [road.sent ? `${raids(road.sent)} sent` : '', road.received ? `${raids(road.received)} received` : ''].filter(Boolean).join(', ');
  return `${ways} · ${formatCount(road.travellers)} travellers · last ${formatTime(road.lastAt)}`;
}

/**
 * Share or copy a map link. On a phone with a share sheet it offers the sheet; elsewhere it copies the address and says
 * so. If neither works the address is shown to copy by hand, never a silent failure.
 */
export function ShareButton(props: { path: string; title: string }) {
  const [said, setSaid] = createSignal<'copied' | 'shared' | 'manual' | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  createEffect(() => {
    void props.path;
    setSaid(null);
  });
  const url = () => `${window.location.origin}${props.path}`;
  const share = async () => {
    clearTimeout(timer);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
    const data = { title: props.title, url: url() };
    try {
      if (nav.share && matchMedia('(pointer: coarse)').matches && (!nav.canShare || nav.canShare(data))) {
        await nav.share(data);
        setSaid('shared');
      } else {
        await navigator.clipboard.writeText(url());
        setSaid('copied');
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setSaid('manual');
      return;
    }
    timer = setTimeout(() => setSaid(null), 2400);
  };
  return (
    <div class="atlas-share">
      <button type="button" class="atlas-button atlas-button-quiet" on:click={() => void share()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M5.2 7.8L3.6 9.4a2.3 2.3 0 003.2 3.2l1.6-1.6M10.8 8.2l1.6-1.6a2.3 2.3 0 00-3.2-3.2L7.6 5" /></svg>
        <Show when={said() === 'copied'} fallback={said() === 'shared' ? 'Shared' : 'Share this place'}>Link copied</Show>
      </button>
      <Show when={said() === 'manual'}>
        <p class="atlas-share-manual">Copy this link: <span class="atlas-share-url">{url()}</span></p>
      </Show>
      <span class="atlas-visually-hidden" role="status">{said() === 'copied' ? 'Link copied' : ''}</span>
    </div>
  );
}

function CloseButton(props: { onClose: () => void; ref: (element: HTMLButtonElement) => void }) {
  return (
    <button ref={props.ref} class="atlas-card-close" type="button" on:click={() => props.onClose()} aria-label="Close card">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
    </button>
  );
}

/** Focus the close button whenever the card's subject changes, and let Escape close the card. */
function useCardKeys(key: () => unknown, onClose: () => void): (element: HTMLButtonElement) => void {
  let close: HTMLButtonElement | undefined;
  createEffect(() => {
    void key();
    queueMicrotask(() => close?.focus({ preventScroll: true }));
  });
  const onKey = (event: KeyboardEvent) => {
    const map = close?.closest('[data-chatdom-atlas]');
    if (map && event.target instanceof Node && !map.contains(event.target)) return;
    if (event.key === 'Escape') onClose();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
  return (element) => (close = element);
}

/**
 * A named channel without land: seen by the survey, but below the village line, or not mapped in this preview. It
 * keeps its name, its last stream and its roads; while it is live it is pencilled in near its realm (the flag on the
 * map), otherwise the map flies to that realm and marks nothing, because no place is its own yet.
 */
export function WaitingCard(props: {
  face: ChannelFace;
  state: RegisterState<CardReply>;
  world: PreviewWorld;
  /** The pencil flag's start when it is live in the frame shown, else null; `asOf` is that frame's sweep. */
  live: { startedAt: number | null; asOf: number } | null;
  onAir: boolean;
  onEnter: (holding: DoorHolding) => void;
  onClose: () => void;
  onRoad: (road: CardRoad) => void;
  onRetry: () => void;
}) {
  const close = useCardKeys(() => props.face.id, props.onClose);
  const card = () => (props.state.status === 'ready' ? props.state.reply : null);
  const url = () => (props.face.login ? watchUrl(props.face.login) : null);
  const land = () => faceLand(props.face, props.world);
  const door = () => { const c = card(); return c && c.channel.id === props.face.id ? waitingDoorHolding(c, props.world) : null; };
  const enter = (event: MouseEvent, holding: DoorHolding) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onEnter(holding);
  };
  return (
    <section class="atlas-card" aria-labelledby="atlas-card-title" data-kind="waiting">
      <CloseButton ref={close} onClose={props.onClose} />
      <header class="atlas-card-head">
        <ChannelFaceSeal channelId={props.face.id} name={props.face.name} portrait={card()?.channel.id === props.face.id ? card()?.portrait : null} />
        <div class="atlas-card-names">
          <p class="atlas-card-status">{props.onAir ? 'On air · no land of its own' : 'Waiting · no land of its own'}</p>
          <h2 id="atlas-card-title" dir="auto" classList={{ 'atlas-card-unnamed': !props.face.name }}>{faceName(props.face)}</h2>
          <Show when={props.face.login && props.face.name && props.face.name.toLowerCase() !== props.face.login}>
            <p class="atlas-card-login">{props.face.login}</p>
          </Show>
        </div>
      </header>
      <dl class="atlas-card-facts">
        <Show when={land()}>
          {(name) => <div><dt>{props.onAir ? 'Pencilled in' : 'Realm'}</dt><dd>{name()}</dd></div>}
        </Show>
        <Show when={card()}>
          {(c) => <div><dt>Observed</dt><dd>{formatCount(c().average)} average viewers <span class="atlas-quiet">· land begins at {formatCount(props.world.tiers.minAverage.village)}</span></dd></div>}
        </Show>
        <Show when={props.live}>
          {(live) => (
            <div class="atlas-card-live" data-live={props.onAir ? 'true' : 'false'}>
              <dt>On air</dt>
              <Show when={props.onAir} fallback={<dd class="atlas-quiet">Not in the sweep of {formatTime(live().asOf)}.</dd>}>
                <dd>{live().startedAt !== null ? `Live since ${formatTime(live().startedAt!)}` : 'Live; start not known'}</dd>
              </Show>
            </div>
          )}
        </Show>
      </dl>
      <RegisterFacts state={props.state} world={props.world} onAirNow={props.live ? props.onAir : null} onRoad={props.onRoad} onRetry={props.onRetry} />
      <p class="atlas-card-note">
        A channel below {formatCount(props.world.tiers.minAverage.village)} average viewers holds no land in a survey preview. While it is
        live it is pencilled in near the realm of its language and game, at a place drawn from its channel ID.
      </p>
      <Show when={door()}>{(holding) => (
        <a class="atlas-watch atlas-door" href={`/kingdom/${holding().id}`} on:click={(event) => enter(event, holding())}>
          Enter the land <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 14V7a5 5 0 0 1 10 0v7M3 14h10M8 9v2" /></svg>
        </a>
      )}</Show>
      <div class="atlas-card-actions">
        <Show when={url()}>
          {(href) => <WatchLink href={href()} />}
        </Show>
        <Show when={props.face.login}>{(login) => <ShareButton path={`/map/${login()}`} title={`${props.face.name} on the Atlas of Kingdoms`} />}</Show>
      </div>
    </section>
  );
}

export function WatchLink(props: { href: string }): JSX.Element {
  return (
    <a class="atlas-watch" href={props.href} target="_blank" rel="noopener noreferrer">
      Watch on Twitch
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M13 3L4 12" /></svg>
      <span class="atlas-visually-hidden"> (opens twitch.tv in a new tab)</span>
    </a>
  );
}

function tallyLine(tally: RoadTally | null): string {
  if (!tally) return 'None seen';
  return `${raids(tally.raids)} · ${formatCount(tally.travellers)} travellers · last ${formatTime(tally.lastAt)}`;
}

/**
 * The road between two channels: what the raid watch saw each way, as totals over the survey. A pair with nothing seen
 * still opens, and says so plainly, because a shared link must not pretend a road exists or that none could.
 */
export function RoadCard(props: {
  state: RegisterState<RoadReply>;
  world: PreviewWorld;
  onClose: () => void;
  onOpen: (face: ChannelFace) => void;
  onRetry: () => void;
}) {
  const road = () => (props.state.status === 'ready' ? props.state.reply : null);
  const close = useCardKeys(() => (road() ? `${road()!.a.id}:${road()!.b.id}` : props.state.status), props.onClose);
  const share = () => {
    const r = road();
    return r && r.a.login && r.b.login ? `/map/road/${r.a.login}/${r.b.login}` : null;
  };
  return (
    <section class="atlas-card" aria-labelledby="atlas-card-title" data-kind="road">
      <CloseButton ref={close} onClose={props.onClose} />
      <Switch>
        <Match when={road()}>
          {(r) => (
            <>
              <header class="atlas-road-head">
                <p class="atlas-card-status">Road · raids observed</p>
                <div class="atlas-road-ends">
                  <PlaceMark face={r().a} size={40} />
                  <svg class="atlas-road-ink" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true"><path d="M4 16C30 4 48 22 70 11S104 6 116 12" /></svg>
                  <PlaceMark face={r().b} size={40} />
                </div>
                <h2 id="atlas-card-title">
                  <span dir="auto" classList={{ 'atlas-card-unnamed': !r().a.name }}>{faceName(r().a)}</span>
                  <span class="atlas-road-and"> and </span>
                  <span dir="auto" classList={{ 'atlas-card-unnamed': !r().b.name }}>{faceName(r().b)}</span>
                </h2>
              </header>
              <dl class="atlas-card-facts">
                <div><dt>{`To ${faceName(r().b)}`}</dt><dd classList={{ 'atlas-quiet': !r().aToB }}>{tallyLine(r().aToB)}</dd></div>
                <div><dt>{`To ${faceName(r().a)}`}</dt><dd classList={{ 'atlas-quiet': !r().bToA }}>{tallyLine(r().bToA)}</dd></div>
              </dl>
              <p class="atlas-card-note">
                <Show when={r().aToB || r().bToA} fallback={<>The raid watch saw no raid between these two channels from {formatMoment(r().window.from)} to {formatMoment(r().window.to)}. </>}>
                  Totals of what the raid watch saw from {formatMoment(r().window.from)} to {formatMoment(r().window.to)}, not single journeys.{' '}
                </Show>
                It follows up to {formatCount(r().coverage.raidWatch.watching)} live channels at a time, so a raid it did not watch is missing here, not denied.
              </p>
              <div class="atlas-road-open">
                <For each={[r().a, r().b].filter((face) => face.place !== 'unseen')}>
                  {(face) => (
                    <button type="button" class="atlas-road" on:click={() => props.onOpen(face)}>
                      <PlaceMark face={face} size={22} />
                      <span class="atlas-road-text"><span class="atlas-road-name" dir="auto">{faceName(face)}</span><span class="atlas-road-tally">Open its card</span></span>
                      <svg class="atlas-road-go" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>
                    </button>
                  )}
                </For>
              </div>
              <Show when={share()}>{(path) => <div class="atlas-card-actions"><ShareButton path={path()} title={`${r().a.name} and ${r().b.name} on the Atlas of Kingdoms`} /></div>}</Show>
            </>
          )}
        </Match>
        <Match when={props.state.status === 'loading'}>
          <p class="atlas-card-status">Road</p>
          <p class="atlas-register-wait" role="status">
            <svg class="atlas-search-quill" viewBox="0 0 120 14" aria-hidden="true"><path d="M3 9c12-7 20 3 30-2s14-8 23-3 15 5 23 1 15-7 24-2 11 4 14 2" /></svg>
            Reading the road from the register…
          </p>
        </Match>
        <Match when={props.state.status === 'missing'}>
          <p class="atlas-card-status">Road</p>
          <h2 id="atlas-card-title">This road is not on the map</h2>
          <p class="atlas-card-note">
            One of its channels is not in the survey of {formatDayRange(props.world.window.firstObservationAt, props.world.window.lastObservationAt)} under that name. Names are shown only for
            channels seen live within a day.
          </p>
        </Match>
        <Match when={true}>
          <p class="atlas-card-status">Road</p>
          <h2 id="atlas-card-title">The road could not be read</h2>
          <p class="atlas-card-note">The register did not answer just now. The map is unchanged.</p>
          <button type="button" class="atlas-button" on:click={() => props.onRetry()}>Read again</button>
        </Match>
      </Switch>
    </section>
  );
}
