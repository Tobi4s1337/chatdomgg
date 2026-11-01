import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, Switch, Match } from 'solid-js';
import { createPassportReading } from '@chatdom/ui/passport';
import { selectAdapter } from './adapters/select';
import { CardSheet, PassportCorner } from './card/CardSheet';
import { PanelPassport } from './passport/PanelPassport';
import { createPanelSound } from './sound';
import type { Home, PanelAdapter, PanelSnapshot, PassportSource } from './model';
import './panel.css';
import './places.css';
import './window.css';

type Tab = 'kingdom' | 'you' | 'gifts';
type Reading = PanelSnapshot & { readonly kingdomLights?: number | null; readonly moment?: string | null };
const cardOf = (home: Home) => (home.kind === 'citizen' || home.kind === 'guest' || home.kind === 'known') && home.card
  ? { card: home.card, passport: home.passport } : null;

export default function Panel(props: { adapter?: PanelAdapter; embedded?: boolean; onReady?: () => void }) {
  const adapter = props.adapter ?? selectAdapter();
  const sound = createPanelSound();
  const [muted, setMuted] = createSignal(sound.muted());
  const unlistenSound = sound.subscribe(setMuted);
  const [snap, setSnap] = createSignal<Reading>(adapter.get());
  const [tab, setTab] = createSignal<Tab>('kingdom');
  const [page, setPage] = createSignal<'card' | 'passport' | null>(null);
  const [failed, setFailed] = createSignal(false);
  const unsubscribe = adapter.subscribe(next => { if (snap().light.kind === 'pending' && next.light.kind === 'lit') sound.play('kindle'); setSnap(next); });
  const pictureUrl = createMemo(() => { const picture = snap().picture; return picture.kind === 'still' ? picture.url : null; });
  createEffect(() => { void pictureUrl(); setFailed(false); });
  const card = () => cardOf(snap().home);
  const source = createMemo<Extract<PassportSource, { kind: 'readable' }> | null>(() => { const value = card()?.passport; return value?.kind === 'readable' ? value : null; });
  const picture = () => { const value = snap().picture; return value.kind === 'still' && !failed() ? value : null; };
  const gate = () => { const value = snap().entry; return value.kind === 'gate' ? value : null; };
  const reading = createMemo(() => {
    const value = source();
    return value && value.kind === 'readable' ? createPassportReading(value.transport, value.disclosure ? { disclosure: () => value.disclosure ?? undefined } : {}) : null;
  });
  let cardButton: HTMLButtonElement | undefined;
  const openTab = (next: Tab) => { sound.gesture(); sound.play('tap'); setPage(null); setTab(next); };
  const place = () => { sound.gesture(); sound.play('tap'); adapter.requestLight('named'); };
  const closeCard = () => { sound.play('page'); setPage(null); queueMicrotask(() => cardButton?.focus()); };
  const lightWords = () => {
    const light = snap().light;
    switch (light.kind) {
      case 'lit': return 'Your window is lit';
      case 'resting': return 'Your window is resting';
      case 'held': return 'Your window is quiet';
      case 'unfounded': return light.pledged ? 'Your place is waiting' : null;
      case 'pending': return light.step === 'sharing' ? 'Waiting for Twitch…' : 'Lighting your window…';
      case 'logged-out': return 'Log in to Twitch to take your place';
      case 'outside-twitch': return 'Open this panel on Twitch';
      case 'out-of-reach': return 'Your window is out of reach';
      case 'unavailable': return 'Your window is unavailable just now';
      default: return null;
    }
  };
  const canPlace = () => ['ready', 'unshared', 'refused'].includes(snap().light.kind) || (snap().light.kind === 'unfounded' && !(snap().light as Extract<PanelSnapshot['light'], { kind: 'unfounded' }>).pledged);
  const homeLine = () => {
    const home = snap().home;
    if (home.kind === 'citizen') return [home.displayName, home.street].filter(Boolean).join(' · ');
    if (home.kind === 'guest') return [home.displayName, 'Guest'].filter(Boolean).join(' · ');
    if (home.kind === 'known') return home.card.name;
    return '';
  };
  let frame: HTMLDivElement | undefined;
  onMount(() => {
    if (!props.embedded) document.documentElement.classList.add('cp-document');
    const ready = async () => {
      await document.fonts.ready;
      const img = frame?.querySelector('img.cw-picture-image') as HTMLImageElement | null;
      if (img) await img.decode().catch(() => undefined);
      if (props.embedded) props.onReady?.(); else (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
    };
    void ready();
  });
  onCleanup(() => { unsubscribe(); unlistenSound(); sound.dispose(); adapter.dispose(); if (!props.embedded) document.documentElement.classList.remove('cp-document'); });
  return <div class="cp-frame" classList={{ embedded: props.embedded }} ref={element => { frame = element; }}><div class="cp cw" data-chatdom-panel data-light={snap().light.kind} data-connection={snap().connection.kind} data-view={tab()} data-ready="true">
    <header class="cw-head"><span class="cw-mark" aria-hidden="true">✦</span><h1>{snap().kingdom?.name ?? 'The kingdom'}</h1><button class="cw-sound" type="button" aria-label={muted() ? 'Turn panel sound on' : 'Mute panel sound'} aria-pressed={!muted()} onClick={() => { sound.setMuted(!muted()); if (!muted()) { sound.gesture(); sound.play('tap'); } }}>{muted() ? '♪̸' : '♪'}</button></header>
    <main class="cw-main">
      <Show when={!page()} fallback={<section class="cw-deep" aria-label={page() === 'card' ? 'Your citizen card' : 'Your passport'}>
        <Show when={page() === 'card'} fallback={<Show when={source()}>{value => <PanelPassport transport={value().transport} places={value().places} simulated={false} {...(reading() ? { reading: reading()! } : {})} onClose={() => setPage('card')} backLabel="Your card" />}</Show>}>
          <button class="cw-back" onClick={closeCard}>‹ <span>Back to You</span></button>
          <Show when={card()}>{found => <>
            <CardSheet card={found().card} street={snap().home.kind === 'citizen' ? (snap().home as Extract<Home, { kind: 'citizen' }>).street : null} place={snap().home.kind === 'citizen' ? (snap().home as Extract<Home, { kind: 'citizen' }>).place : null} homePicture={null} window={lightWords() ?? 'Your window'} passport={reading()?.state() ?? null} simulated={false} />
            <Show when={reading()}><PassportCorner private={reading()?.state().kind === 'hidden'} onTurn={() => setPage('passport')} /></Show>
          </>}</Show>
        </Show>
      </section>}>
        <Switch>
          <Match when={tab() === 'kingdom'}>
            <figure class="cw-picture">
              <Show when={picture()} fallback={<div class="cw-absence"><span class="cw-absence-arch" aria-hidden="true"><span>✦</span></span><p>{snap().connection.kind === 'outside-twitch' ? 'Open on Twitch to see the kingdom' : 'The kingdom is out of view'}</p></div>}>{picture =>
                <><img class="cw-picture-image" src={picture().url} alt={picture().alt} onError={() => setFailed(true)} /><figcaption>{picture().provenance.caption}</figcaption></>}
              </Show>
            </figure>
            <div class="cw-kingdom-foot">
              <p class="cw-moment"><Show when={snap().kingdomLights != null}><span class="cw-light-dot" aria-hidden="true" />{snap().kingdomLights} {snap().kingdomLights === 1 ? 'light' : 'lights'}<Show when={snap().moment}> · </Show></Show>{snap().moment ?? ''}</p>
              <Show when={gate()}>{gate => <div class="cw-links"><a href={new URL(gate().path, 'https://chatdom.gg').href} target="_blank" rel="noopener noreferrer">Tavern ↗</a><a href={new URL(gate().path, 'https://chatdom.gg').href} target="_blank" rel="noopener noreferrer">Forge ↗</a><small>Leave Twitch</small></div>}</Show>
            </div>
          </Match>
          <Match when={tab() === 'you'}>
            <section class="cw-you">
              <div class="cw-window" classList={{ lit: snap().light.kind === 'lit' }} aria-hidden="true"><span /><span /><span /><span /></div>
              <Show when={canPlace()} fallback={<p class="cw-status" role="status">{lightWords() ?? 'Your place is waiting'}</p>}><button class="cw-primary" onClick={place}>Take your place</button></Show>
              <Show when={homeLine()}><p class="cw-home">{homeLine()}</p></Show>
              <Show when={snap().light.kind === 'unfounded'}><p class="cw-home">Tell {snap().kingdom?.name ?? 'the streamer'} their kingdom is waiting</p></Show>
              <Show when={card()}><button ref={element => { cardButton = element; }} class="cw-card-link" onClick={() => { sound.gesture(); sound.play('page'); setPage('card'); }}>Your citizen card <span>›</span></button></Show>
            </section>
          </Match>
          <Match when={tab() === 'gifts'}><section class="cw-gifts"><div class="cw-gift-mark" aria-hidden="true">✧</div><h2>Gifts</h2><p>Gifts open when the channel turns them on.</p></section></Match>
        </Switch>
      </Show>
    </main>
    <nav class="cw-nav" aria-label="Panel"><For each={(['kingdom', 'you', 'gifts'] as const)}>{item => <button type="button" aria-current={tab() === item ? 'page' : undefined} onClick={() => openTab(item)}>{item === 'kingdom' ? 'Kingdom' : item === 'you' ? 'You' : 'Gifts'}</button>}</For></nav>
  </div></div>;
}
