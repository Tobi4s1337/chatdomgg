import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, Switch, Match } from 'solid-js';
import { createPassportReading } from '@chatdom/ui/passport';
import { selectAdapter } from './adapters/select';
import { CardSheet, PassportCorner } from './card/CardSheet';
import { PanelPassport } from './passport/PanelPassport';
import { createPanelSound } from './sound';
import { GiftShelf } from './gifts/GiftShelf';
import { windowViewCrop } from './window-view';
import type { Home, PanelAdapter, PanelSnapshot, PassportSource, Privacy } from './model';
import './panel.css';
import './places.css';
import './window.css';

type Tab = 'kingdom' | 'you' | 'gifts';
type Reading = PanelSnapshot & { readonly kingdomLights?: number | null; readonly moment?: string | null };
const cardOf = (home: Home) => (home.kind === 'citizen' || home.kind === 'guest' || home.kind === 'known') && home.card
  ? { card: home.card, passport: home.passport } : null;

function PrivacySettings(props: { privacy: Privacy | undefined; onClose: () => void; onRetry: () => void; onQuiet: (quiet: boolean) => void; onForget: () => void }) {
  const [confirmForget, setConfirmForget] = createSignal(false);
  const settings = () => {
    const privacy = props.privacy;
    return privacy?.kind === 'ready' || privacy?.kind === 'pending' ? privacy : null;
  };
  const status = () => {
    const privacy = props.privacy;
    if (privacy?.kind === 'forgotten') return `Forgotten: ${privacy.erased.join(', ')}.`;
    if (privacy?.kind === 'loading') return 'Opening your settings…';
    return 'Your settings are out of reach. Please try again later.';
  };
  return <div class="cw-privacy">
    <button class="cw-back" onClick={props.onClose}>‹ Back to You</button>
    <div class="cw-privacy-content">
      <h2>Your privacy</h2>
      <Show when={settings()} fallback={<>
        <p role="status">{status()}</p>
        <Show when={props.privacy?.kind === 'unavailable'}><button class="cw-privacy-row" onClick={props.onRetry}>Try again <span>›</span></button></Show>
      </>}>
        {privacy => <>
          <p>Your card and home stay yours. This setting concerns your name on stream.</p>
          <button class="cw-privacy-row" disabled={privacy().kind === 'pending'} aria-pressed={privacy().quiet} onClick={() => { if (privacy().kind === 'ready') props.onQuiet(!privacy().quiet); }}>
            <span>Keep my name off the stream</span><strong>{privacy().kind === 'pending' ? 'Saving…' : privacy().quiet ? 'On' : 'Off'}</strong>
          </button>
          <Show when={privacy().kind === 'ready' && privacy().projection === 'pending'}><p class="cw-privacy-note" role="status">{privacy().quiet ? 'Preference saved; stream update pending.' : 'Stream name hiding is not connected yet.'}</p></Show>
          <Show when={privacy().forgetAvailable === true} fallback={<div class="cw-privacy-unavailable"><strong>Forget me</strong><p>Forgetting is not connected yet.</p></div>}>
            <Show when={!confirmForget()} fallback={<div class="cw-confirm">
              <p>Forget your Twitch-derived records across Chatdom’s kingdoms? You can take your place again later.</p>
              <button class="cw-primary" disabled={privacy().kind === 'pending'} onClick={props.onForget}>Yes, forget me</button>
              <button class="cw-back" onClick={() => setConfirmForget(false)}>Keep my records</button>
            </div>}><button class="cw-privacy-row" disabled={privacy().kind === 'pending'} onClick={() => setConfirmForget(true)}>Forget me <span>›</span></button></Show>
          </Show>
        </>}
      </Show>
    </div>
  </div>;
}

export default function Panel(props: { adapter?: PanelAdapter; embedded?: boolean; onReady?: () => void }) {
  const adapter = props.adapter ?? selectAdapter();
  const sound = createPanelSound();
  const [muted, setMuted] = createSignal(sound.muted());
  const unlistenSound = sound.subscribe(setMuted);
  const [snap, setSnap] = createSignal<Reading>(adapter.get());
  const [tab, setTab] = createSignal<Tab>('kingdom');
  const [page, setPage] = createSignal<'card' | 'passport' | 'privacy' | null>(null);
  const [walking, setWalking] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const unsubscribe = adapter.subscribe(next => {
    if (next.privacy?.kind === 'forgotten' && page() !== 'privacy') setPage(null);
    if (snap().light.kind === 'pending' && next.light.kind === 'lit') sound.play('kindle');
    const before = snap().gifts, after = next.gifts;
    if (after?.kind === 'open' && (before?.kind !== 'open' || before.request.kind !== after.request.kind)) {
      if (after.request.kind === 'confirming' || after.request.kind === 'pending') sound.play('pending');
      else if (after.request.kind === 'delivered') sound.play('counted');
      else if (after.request.kind === 'cancelled') sound.play('dull');
    }
    setSnap(next);
  });
  const pictureUrl = createMemo(() => { const picture = snap().picture; return picture.kind === 'still' ? picture.url : null; });
  createEffect(() => { void pictureUrl(); setFailed(false); });
  createEffect(() => { const settings = snap().settings; if (settings && !settings.tabs[tab()]) { setPage(null); setTab('kingdom'); } });
  const card = () => cardOf(snap().home);
  const source = createMemo<Extract<PassportSource, { kind: 'readable' }> | null>(() => { const value = card()?.passport; return value?.kind === 'readable' ? value : null; });
  const picture = () => { const value = snap().picture; return value.kind === 'still' && !failed() ? value : null; };
  // A new painting dissolves in over the one it replaces, so a turn of the camera or a street coming alight never
  // reads as a cut. The adapter keeps the replaced painting readable until the next one arrives.
  const placeOf = (value: { mark?: { x: number; y: number } }) => value.mark ? `${value.mark.x * 100}% ${value.mark.y * 100}%` : '50% 50%';
  const [fading, setFading] = createSignal<{ url: string; position: string } | null>(null);
  const [settling, setSettling] = createSignal(false);
  let shown: { url: string; position: string } | null = null;
  createEffect(on(picture, value => {
    const next = value ? { url: value.url, position: placeOf(value) } : null;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (next && shown && next.url !== shown.url && tab() === 'kingdom' && !calm) { setFading(shown); setSettling(true); }
    else if (next?.url !== shown?.url) { setFading(null); setSettling(false); }
    shown = next;
  }));
  // Two frames, so the hidden new painting has been drawn once before its fade begins.
  const reveal = () => { if (settling()) requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false))); };
  const gate = () => { const value = snap().entry; return value.kind === 'gate' ? value : null; };
  // The arch on the You tab looks into the painting only while that painting shows the viewer's own window lit.
  const windowView = createMemo(() => {
    const value = picture();
    if (snap().light.kind !== 'lit' || !value?.mark) return null;
    const crop = windowViewCrop(value.mark, value);
    return crop ? { url: value.url, crop, time: value.provenance.caption } : null;
  });
  const [portraitFailed, setPortraitFailed] = createSignal(false);
  const portrait = () => { const value = card()?.card.portrait; return value && !portraitFailed() ? value : null; };
  createEffect(() => { void card()?.card.portrait?.url; setPortraitFailed(false); });
  const reading = createMemo(() => {
    const value = source();
    return value && value.kind === 'readable' ? createPassportReading(value.transport, value.disclosure ? { disclosure: () => value.disclosure ?? undefined } : {}) : null;
  });
  let cardButton: HTMLButtonElement | undefined;
  const openTab = (next: Tab) => { sound.gesture(); sound.play('tap'); setPage(null); setWalking(false); setTab(next); };
  const place = () => { sound.gesture(); sound.play('tap'); adapter.requestLight('named'); };
  const closeCard = () => { sound.play('page'); setPage(null); queueMicrotask(() => cardButton?.focus()); };
  const lightWords = () => {
    const light = snap().light;
    switch (light.kind) {
      case 'lit': return 'Your window is lit';
      case 'resting': return 'Your window is resting';
      case 'held': return 'Your window is quiet';
      case 'unfounded': return light.pledged ? 'Your tent waits' : null;
      case 'pending': return light.step === 'sharing' ? 'Waiting for Twitch…' : 'Lighting your window…';
      case 'logged-out': return 'Log in to Twitch to take your place';
      case 'outside-twitch': return 'Open this panel on Twitch';
      case 'out-of-reach': return 'Out of reach for now';
      case 'unavailable': return 'Your window is unavailable just now';
      default: return null;
    }
  };
  // One line under the picture. A kingdom out of reach tells nothing stale; a resting one counts no lights.
  const unreached = () => {
    const connection = snap().connection;
    return connection.kind === 'lost' ? `Out of reach since ${connection.asOf}` : connection.kind === 'kingdom-unavailable' ? 'Out of reach' : null;
  };
  const footCount = () => {
    // Unfounded land has no kingdom to rest or light yet.
    if (snap().light.kind === 'unfounded') return null;
    const lights = snap().kingdomLights;
    return snap().stream === 'resting' ? 'Resting' : lights != null ? `${lights} ${lights === 1 ? 'light' : 'lights'}` : null;
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
    <header class="cw-head"><span class="cw-mark" aria-hidden="true">✦</span><h1>{snap().kingdom?.name ?? (snap().streamer ? `${snap().streamer}’s land` : 'The kingdom')}</h1><button class="cw-sound" type="button" aria-label={muted() ? 'Turn panel sound on' : 'Mute panel sound'} aria-pressed={!muted()} onClick={() => { sound.setMuted(!muted()); if (!muted()) { sound.gesture(); sound.play('tap'); } }}>{muted() ? '♪̸' : '♪'}</button></header>
    <main class="cw-main">
      <Show when={!page()} fallback={<section class="cw-deep" aria-label={page() === 'card' ? 'Your citizen card' : page() === 'privacy' ? 'Your privacy' : 'Your passport'}>
        <Show when={page() !== 'privacy'} fallback={<PrivacySettings privacy={snap().privacy} onClose={closeCard} onRetry={() => adapter.requestPrivacy?.()} onQuiet={quiet => adapter.requestQuiet?.(quiet)} onForget={() => adapter.requestForget?.()} />}>
          <Show when={page() === 'card'} fallback={<Show when={source()}>{value => <PanelPassport transport={value().transport} places={value().places} {...(reading() ? { reading: reading()! } : {})} onClose={() => setPage('card')} backLabel="Your card" />}</Show>}>
          <button class="cw-back" onClick={closeCard}>‹ <span>Back to You</span></button>
          <Show when={card()}>{found => <>
            <CardSheet card={found().card} street={snap().home.kind === 'citizen' ? (snap().home as Extract<Home, { kind: 'citizen' }>).street : null} place={snap().home.kind === 'citizen' ? (snap().home as Extract<Home, { kind: 'citizen' }>).place : null} homePicture={null} window={lightWords() ?? 'Your window'} passport={reading()?.state() ?? null} />
            <Show when={reading()}><PassportCorner private={reading()?.state().kind === 'hidden'} onTurn={() => setPage('passport')} /></Show>
          </>}</Show>
        </Show></Show>
      </section>}>
        <Switch>
          <Match when={tab() === 'kingdom'}>
            <figure class="cw-picture" classList={{ settling: settling() }}>
              <Show when={picture()} fallback={<div class="cw-absence"><span class="cw-absence-arch" aria-hidden="true"><span>✦</span></span><p>{snap().connection.kind === 'outside-twitch' ? 'Open on Twitch to see the kingdom' : snap().light.kind === 'unfounded' ? 'No kingdom here yet' : 'The kingdom is out of view'}</p></div>}>{picture =>
                <><Show when={fading()}>{old => <img class="cw-picture-under" src={old().url} alt="" aria-hidden="true" style={{ 'object-position': old().position }} />}</Show>
                <img class="cw-picture-image" src={picture().url} alt={picture().mark ? `${picture().alt} Your lit window is marked.` : picture().alt} onError={() => setFailed(true)}
                  onLoad={reveal} onTransitionEnd={event => { if (event.propertyName === 'opacity' && !settling()) setFading(null); }}
                  style={{ 'object-position': placeOf(picture()) }} />
                <Show when={picture().mark}>{mark => <span class="cw-yours" aria-hidden="true"
                  classList={{ low: mark().y < .2, west: mark().x < .2, east: mark().x > .8 }} style={{ left: `${mark().x * 100}%`, top: `${mark().y * 100}%` }}>
                  <span class="cw-yours-ring" /><span class="cw-yours-tag">Yours</span></span>}</Show><figcaption aria-label={picture().provenance.origin === 'realm' ? `Painted at ${picture().provenance.caption}` : picture().provenance.caption}><Show when={picture().provenance.origin === 'realm'}><span class="cw-brush" aria-hidden="true">✎</span></Show>{picture().provenance.caption}</figcaption></>}
              </Show>
            </figure>
            <Show when={unreached() || footCount() || snap().moment || gate()}>
            <div class="cw-kingdom-foot">
              <Show when={!walking()} fallback={<Show when={gate()}>{gate => <div class="cw-walk-open">
                <p class="cw-walk-note">Leaves Twitch for chatdom.gg</p>
                <div class="cw-links">
                  <For each={[['Kingdom', 'the kingdom'], ['Tavern', 'the kingdom, then its tavern'], ['Forge', 'the kingdom, then its Forge']] as const}>{([label, where]) =>
                    <a href={new URL(gate().path, 'https://chatdom.gg').href} target="_blank" rel="noopener noreferrer" aria-label={`Walk into ${where} on chatdom.gg (leaves Twitch)`}>{label} ↗</a>}</For>
                  <button type="button" class="cw-walk-close" aria-label="Close the walk-in links" onClick={() => setWalking(false)}>×</button>
                </div>
              </div>}</Show>}>
                <div class="cw-foot-row">
                  <p class="cw-moment"><Show when={!unreached()} fallback={unreached()}><Show when={footCount()}><span class="cw-light-dot" classList={{ resting: snap().stream === 'resting' }} aria-hidden="true" />{footCount()}<Show when={snap().moment}> · </Show></Show>{snap().moment ?? ''}</Show></p>
                  <Show when={gate()}><button type="button" class="cw-walk" aria-expanded="false" onClick={() => { sound.gesture(); sound.play('tap'); setWalking(true); }}>Walk in ↗</button></Show>
                </div>
              </Show>
            </div>
            </Show>
          </Match>
          <Match when={tab() === 'you'}>
            <section class="cw-you">
              <div class="cw-you-view">
              <Show when={windowView()} fallback={<div class="cw-window" classList={{ lit: snap().light.kind === 'lit' }} aria-hidden="true"><span /><span /><span /><span /></div>}>{view =>
                <button type="button" class="cw-window-view" aria-label={`Your lit window in the painting from ${view().time}. Show the kingdom`} onClick={() => openTab('kingdom')}>
                  <img src={view().url} alt="" draggable={false} style={{ width: `${view().crop.zoom * 100}%`, transform: `translate(${-view().crop.centre.x * 100}%, ${-view().crop.centre.y * 100}%)` }} onError={() => setFailed(true)} />
                  <span class="cw-window-view-ring" style={{ left: `${view().crop.ring.x * 100}%`, top: `${view().crop.ring.y * 100}%` }} />
                </button>}</Show>
              </div>
              <div class="cw-you-act">
              <Show when={canPlace()} fallback={<p class="cw-status" role="status">{lightWords() ?? 'Your place is waiting'}</p>}><button class="cw-primary" onClick={place}>Take your place</button></Show>
              <Show when={homeLine()}><p class="cw-home"><span class="cw-portrait-slot" aria-hidden="true"><Show when={portrait()}>{found => <img src={found().url} alt="" onError={() => setPortraitFailed(true)} />}</Show></span><span>{homeLine()}</span></p></Show>
              <Show when={snap().light.kind === 'unfounded'}><p class="cw-home">Tell {snap().streamer ?? 'the streamer'} their kingdom is waiting</p></Show>
              <div class="cw-personal-links">
              <Show when={snap().privacy && snap().privacy?.kind !== 'forgotten'}><button class="cw-card-link cw-settings-link" onClick={() => setPage('privacy')} aria-label="Your privacy">Privacy <span>›</span></button></Show>
              <Show when={card()}><button ref={element => { cardButton = element; }} class="cw-card-link" onClick={() => { sound.gesture(); sound.play('page'); setPage('card'); }} aria-label="Your citizen card">Your card <span>›</span></button></Show>
              </div>
              </div>
            </section>
          </Match>
          <Match when={tab() === 'gifts'}><GiftShelf shelf={snap().gifts ?? { kind: 'closed', reason: 'Gifts open when the channel turns them on.' }}
            onMore={() => { sound.play('page'); adapter.moreGiftChoices?.(); }} onResolve={intentId => { sound.gesture(); sound.play('tap'); adapter.resolveGiftIntent?.(intentId); }}
            onUse={sku => { sound.gesture(); sound.play('tap'); adapter.requestProduct(sku); }}
            onTarget={plotId => { sound.gesture(); sound.play('tap'); adapter.chooseGiftTarget?.(plotId); }}
            onCancelChoice={() => { sound.play('page'); adapter.cancelGiftChoice?.(); }} onReset={() => { sound.play('page'); adapter.resetGift?.(); }} /></Match>
        </Switch>
      </Show>
    </main>
    <nav class="cw-nav" aria-label="Panel"><For each={(['kingdom', 'you', 'gifts'] as const).filter(item => snap().settings?.tabs[item] !== false)}>{item => <button type="button" aria-current={tab() === item ? 'page' : undefined} onClick={() => openTab(item)}>{item === 'kingdom' ? 'Kingdom' : item === 'you' ? 'You' : 'Gifts'}</button>}</For></nav>
  </div></div>;
}
