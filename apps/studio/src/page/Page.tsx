// The Twitch channel page, drawn from a PageState and nothing else: a logged-in viewer watching tobi4s_ live.
// Layout boxes, fonts and colours are measured from the real page (reference capture, 1920×1080, dark theme).
import { For, Match, Show, Switch, createMemo, type JSX } from 'solid-js';
import type { PageState, PlayerContent, SideChannel } from '../types';
import { ChatColumn } from './Chat';
import { Cursor } from './Cursor';
import { followerGoal, fullCount, shortCount, smooth, uptime } from './format';
import { Icon, OwnIcon } from './icons';

/** Page geometry at 1920×1080 CSS px, as measured on the real page. */
export const GEOMETRY = {
  topNav: 50, sideNav: 240, chat: 340,
  /** The player keeps 16:9 across the main column: 1340 × 753.75 in the normal layout. */
  player: { x: 240, y: 50, width: 1340, height: 753.75 },
  theatre: { x: 0, y: 95.625, width: 1580, height: 888.75 },
  /** The Chatdom panel's iframe, inside Twitch's extension panel frame. */
  panel: { width: 318, height: 496 },
} as const;

export interface PageRefs {
  chatList?: HTMLDivElement; chatScroller?: HTMLDivElement; panelFrame?: HTMLIFrameElement; playerFrame?: HTMLIFrameElement;
  player?: HTMLDivElement; panel?: HTMLDivElement; chat?: HTMLDivElement;
}

function TopNav(props: { state: PageState }): JSX.Element {
  return (
    <nav class="top-nav">
      <span class="top-nav__logo"><Icon name="logo" size={40} /></span>
      <span class="top-nav__browse">Browse</span>
      <span class="icon-button top-nav__more"><Icon name="kebab" size={20} /></span>
      <div class="top-nav__search">
        <div class="top-nav__search-input"><span>Search</span></div>
        <div class="top-nav__search-button"><Icon name="search" size={24} /></div>
      </div>
      <div class="top-nav__right">
        <span class="icon-button"><Icon name="prime" size={20} /></span>
        <span class="icon-button"><Icon name="bell" size={20} /></span>
        <span class="icon-button"><OwnIcon name="whispers" size={20} /></span>
        <span class="top-nav__bits"><Icon name="bits" size={20} /><span>Get Bits</span></span>
        <span class="top-nav__avatar"><img src={props.state.me.avatar} alt="" draggable={false} /></span>
      </div>
    </nav>
  );
}

function SideCard(props: { channel: SideChannel }): JSX.Element {
  const c = () => props.channel;
  return (
    <div class={`side-card${c().live ? '' : ' side-card--offline'}`}>
      <img class="side-card__avatar" src={c().avatar} alt="" draggable={false} />
      <div class="side-card__meta">
        <p class="side-card__title">{c().display}</p>
        <Show when={c().live}><p class="side-card__category">{c().category}</p></Show>
      </div>
      <div class="side-card__status">
        <Show when={c().live} fallback={<span class="side-card__offline">Offline</span>}>
          <span class="live-dot" /><span class="side-card__viewers">{shortCount(c().viewers)}</span>
        </Show>
      </div>
    </div>
  );
}

/**
 * The expanded side bar. `state.side` lists the followed channels first, then the recommended ones: the first half
 * (rounded up) sits under "Followed Channels", the rest under "Recommended Channels".
 */
function SideNav(props: { state: PageState }): JSX.Element {
  const split = createMemo(() => { const n = Math.ceil(props.state.side.length / 2); return [props.state.side.slice(0, n), props.state.side.slice(n)] as const; });
  return (
    <aside class="side-nav">
      <div class="side-nav__section">
        <div class="side-nav__header"><h3>Followed Channels</h3><span class="icon-button side-nav__collapse"><Icon name="collapse-left" size={20} /></span></div>
        <For each={split()[0]}>{c => <SideCard channel={c} />}</For>
      </div>
      <Show when={split()[1].length}>
        <div class="side-nav__section">
          <div class="side-nav__header"><h3>Recommended Channels</h3></div>
          <For each={split()[1]}>{c => <SideCard channel={c} />}</For>
          <div class="side-nav__more"><span>Show More</span></div>
        </div>
      </Show>
    </aside>
  );
}

/** The player rectangle. `key` leaves it truly transparent for a later composite. */
function Player(props: { state: PageState; refs: PageRefs }): JSX.Element {
  const p = (): PlayerContent => props.state.player;
  const t = () => props.state.t;
  const frameSrc = createMemo(() => {
    const c = p();
    if (c.kind !== 'plate') return '';
    const frame = Math.min(c.frames - 1, Math.max(0, Math.round((t() - c.offset) * 60)));
    return `/media/teaser/takes/${c.take}/${String(frame).padStart(6, '0')}.${c.ext}`;
  });
  // A still drifts from `from` to `to` over `duration` seconds: x and y in CSS px, scale about the centre.
  const stillTransform = () => {
    const c = p();
    if (c.kind !== 'still') return '';
    const k = smooth(c.duration > 0 ? t() / c.duration : 1);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    return `translate(${lerp(c.from.x, c.to.x)}px, ${lerp(c.from.y, c.to.y)}px) scale(${lerp(c.from.scale, c.to.scale)})`;
  };
  return (
    <div class={`player${props.state.theatre ? ' player--theatre' : ''}`}>
      <Show when={props.state.theatre}><div class="player__bar player__bar--top" /><div class="player__bar player__bar--bottom" /></Show>
      <div class="player__video" ref={el => { props.refs.player = el; }}>
        <Switch>
          <Match when={p().kind === 'plate'}><img class="player__plate" src={frameSrc()} alt="" draggable={false} /></Match>
          <Match when={p().kind === 'still' && (p() as Extract<PlayerContent, { kind: 'still' }>)}>{c => (
            <img class="player__still" src={c().src} alt="" draggable={false} style={{ transform: stillTransform() }} />
          )}</Match>
          <Match when={p().kind === 'live' && (p() as Extract<PlayerContent, { kind: 'live' }>)}>{c => (
            <iframe class="player__live" src={c().src} title="" ref={el => { props.refs.playerFrame = el; }} />
          )}</Match>
        </Switch>
      </div>
    </div>
  );
}

function ChannelHeader(props: { state: PageState }): JSX.Element {
  const c = () => props.state.channel;
  const press = () => props.state.followPress;
  // The heart swells and settles while the follow button is pressed.
  const heartScale = () => 1 + 0.35 * Math.sin(Math.PI * Math.min(1, Math.max(0, press())));
  return (
    <section class="channel-header">
      <div class="channel-header__avatar">
        <img src={c().avatar} alt="" draggable={false} />
        <div class="live-pill"><span>Live</span></div>
      </div>
      <div class="channel-header__main">
        <div class="channel-header__row1">
          <h1 class="channel-header__name">{c().display}</h1>
          <div class="channel-header__buttons">
            <Show when={props.state.following} fallback={
              <span class="button button--primary follow-button">
                <span class="follow-heart" style={{ transform: `scale(${heartScale()})` }}><Icon name="heart" size={20} /></span><span>Follow</span>
              </span>
            }>
              <span class="button button--secondary follow-button follow-button--following">
                <span class="follow-heart" style={{ transform: `scale(${heartScale()})` }}><OwnIcon name="heart-filled" size={20} /></span>
              </span>
            </Show>
            <span class="button button--secondary"><Icon name="gift" size={20} /><span class="button__label">Gift a Sub</span><Icon name="chevron" size={20} /></span>
            <span class="button button--secondary"><Icon name="star" size={20} /><span class="button__label">Subscribe</span><Icon name="chevron" size={20} /></span>
          </div>
        </div>
        <div class="channel-header__row2">
          <div class="channel-header__left">
            <p class="channel-header__title">{c().title}</p>
            <div class="channel-header__category-row">
              <span class="channel-header__category">{c().category}</span>
              <div class="channel-header__tags"><For each={c().tags}>{tag => <span class="tag"><span>{tag}</span></span>}</For></div>
            </div>
          </div>
          <div class="channel-header__right">
            <span class="viewer-count"><Icon name="viewers" size={20} /><strong>{fullCount(props.state.viewers)}</strong></span>
            <span class="live-time">{uptime(props.state.uptime)}</span>
            <span class="icon-button"><Icon name="share" size={20} /></span>
            <span class="icon-button"><Icon name="kebab" size={20} /></span>
          </div>
        </div>
      </div>
    </section>
  );
}

function About(props: { state: PageState }): JSX.Element {
  const c = () => props.state.channel;
  const goal = () => followerGoal(c().followers);
  return (
    <div class="about">
      <div class="about__panel">
        <h3 class="tw-title about__title">About {c().display}</h3>
        <div class="about__box">
          <div class="about__followers"><b>{shortCount(c().followers)}</b> followers</div>
          <p class="about__text">{c().about}</p>
        </div>
      </div>
      <div class="about__goals">
        <h3 class="tw-title">{c().display}'s Goals</h3>
        <div class="goal">
          <div class="goal__row">
            <span class="goal__icon"><OwnIcon name="heart-filled" size={36} fill="#f06883" /></span>
            <div class="goal__text">
              <p class="goal__head">{goal() - c().followers} followers to go!</p>
              <p class="goal__count"><b>{c().followers}</b>/{goal()} Followers</p>
            </div>
            <span class="button button--primary goal__follow"><Icon name="heart" size={20} /></span>
          </div>
          <div class="goal__bar"><div class="goal__fill" style={{ width: `${Math.min(100, (c().followers / goal()) * 100)}%` }} /></div>
        </div>
      </div>
    </div>
  );
}

function Panels(props: { state: PageState; refs: PageRefs; onPanelLoad: (frame: HTMLIFrameElement) => void }): JSX.Element {
  // A memo, so the iframe's src is set only when the query changes: setting an iframe's src, even to the same
  // URL, reloads its document.
  const src = createMemo(() => `/panel?source=simulated${props.state.panel.query ? `&${props.state.panel.query}` : ''}`);
  return (
    <div class="panels">
      <div class="panels__column">
        <div class="extension-panel" ref={el => { props.refs.panel = el; }}>
          <div class="extension-panel__frame">
            <iframe src={src()} title="" scrolling="no" ref={el => { props.refs.panelFrame = el; el.addEventListener('load', () => props.onPanelLoad(el)); }} />
          </div>
          <div class="extension-panel__footer">
            <span class="extension-panel__name">Chatdom</span>
            <span class="icon-button"><Icon name="popout" size={20} /></span>
            <span class="icon-button"><Icon name="kebab" size={20} /></span>
          </div>
        </div>
      </div>
      <div class="panels__column">
        <div class="default-panel">
          <h3 class="default-panel__title">The kingdom</h3>
          <p>Every viewer who chats gets a home here. Walk in, look around, and say hi in chat to move in.</p>
        </div>
      </div>
      <div class="panels__column">
        <div class="default-panel">
          <h3 class="default-panel__title">Rules</h3>
          <ul><li>Be kind to each other.</li><li>No spoilers for games on stream.</li><li>English in chat, please.</li></ul>
        </div>
      </div>
    </div>
  );
}

export function Page(props: { state: PageState; refs: PageRefs; onPanelLoad: (frame: HTMLIFrameElement) => void }): JSX.Element {
  const s = () => props.state;
  const cam = () => {
    const { cx, cy, zoom } = s().camera;
    return zoom === 1 && cx === 960 && cy === 540 ? 'none' : `translate(${960 - cx * zoom}px, ${540 - cy * zoom}px) scale(${zoom})`;
  };
  return (
    <div class="tw-page">
      <div class="tw-camera" style={{ transform: cam() }}>
        <Show when={!s().theatre}><TopNav state={s()} /><SideNav state={s()} /></Show>
        <div class={`main${s().theatre ? ' main--theatre' : ''}`}>
          <div class="main__scroll" style={{ transform: s().theatre ? 'none' : `translateY(${-s().scroll}px)` }}>
            <Player state={s()} refs={props.refs} />
            {/* The info column stays mounted in theatre mode (hidden), so the panel's frame keeps its document. */}
            <div class="info">
              <ChannelHeader state={s()} />
              <div class="info__below"><About state={s()} /><Panels state={s()} refs={props.refs} onPanelLoad={props.onPanelLoad} /></div>
            </div>
          </div>
        </div>
        <ChatColumn state={s()} listRef={el => { props.refs.chatList = el; }} scrollRef={el => { props.refs.chatScroller = el; }} />
        <Cursor cursor={s().cursor} />
      </div>
    </div>
  );
}
