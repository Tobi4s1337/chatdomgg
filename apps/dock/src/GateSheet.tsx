/**
 * The Raid Gate inside the throne: the gate board on its own sheet, sized for an OBS dock and fine in a browser.
 * It mounts the same controller and board as every other host. The Atlas mounts into this sheet only when the board
 * first needs the map. A gate the monarch cannot open yet is explained here in the throne's own words.
 */
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { KingdomIdSchema } from '@chatdom/shared';
import { deferGateAtlas } from '../../web/src/raid-gate/atlas-gate';
import { createRaidGateController, type GateSnapshot, type RaidGateController } from '../../web/src/raid-gate/controller';
import { createHttpRaidGateApi } from '../../web/src/raid-gate/http-api';
import type { GateAccount, RaidGatePorts } from '../../web/src/raid-gate/ports';
import { GateDefs, RaidGatePane } from '../../web/src/raid-gate/RaidGatePane';
import { Seal } from '../../web/src/raid-gate/Seal';
import '../../web/src/raid-gate/raid-gate.css';
import { explainAuthority, guardGateApi, raidGateUrl, type SessionCheck } from './raid-gate';
import './gate.css';

export type GateSheetProps = Readonly<{
  kingdomId: string;
  kingdomName: string;
  /** The dock API's own mode, which the gate's transports share. */
  origin: 'live' | 'simulated';
  /** Herald's grant page, when this build knows one. */
  grantUrl: string | null;
  check: SessionCheck;
  /** The session changed under the sheet; the throne closes it and reads itself again. */
  lost: () => void;
  close: () => void;
}>;

function openGrantPage(url: string): void {
  const opened = window.open(url, '_blank');
  if (opened) opened.opener = null;
  else location.assign(url);
}

export default function GateSheet(props: GateSheetProps) {
  const life = new AbortController();
  const clock = () => Date.now();
  let map!: HTMLDivElement;
  let back!: HTMLButtonElement;
  const kingdomId = KingdomIdSchema.parse(props.kingdomId);
  const account: GateAccount | null = props.grantUrl ? { reconnect: () => openGrantPage(props.grantUrl!) } : null;
  const ports: RaidGatePorts = {
    api: guardGateApi(createHttpRaidGateApi({ url: raidGateUrl(kingdomId), origin: props.origin }), props.check, props.lost),
    atlas: deferGateAtlas(() => map, life.signal),
    // The board names the source by its kingdom; the dock is not told the channel login and the board never reads it.
    source: { kingdomId, name: props.kingdomName, login: '' },
    clock,
    ...(account ? { account } : {}),
  };
  const controller = createRaidGateController(ports);
  const [snap, setSnap] = createSignal<GateSnapshot>(controller.snapshot());
  const stop = controller.subscribe(setSnap);
  const overflow = document.body.style.overflow;

  onMount(() => {
    document.body.style.overflow = 'hidden';
    back.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      // The board puts the map away on Escape first; only an Escape it did not take leaves the gate.
      if (event.key !== 'Escape' || event.defaultPrevented || controller.snapshot().phase === 'choosing') return;
      event.preventDefault();
      props.close();
    };
    window.addEventListener('keydown', keys);
    onCleanup(() => window.removeEventListener('keydown', keys));
  });
  onCleanup(() => {
    stop(); controller.dispose(); life.abort();
    document.body.style.overflow = overflow;
  });

  return <div class="gate-sheet" role="dialog" aria-modal="true" aria-label={`The Raid Gate of ${props.kingdomName}`} data-phase={snap().phase}>
    <GateDefs />
    <div class="gate-sheet-inner">
      <nav class="gate-sheet-bar">
        <button ref={element => { back = element; }} class="gate-back" type="button" onClick={() => props.close()}>
          <span aria-hidden="true">‹</span> Back to the throne
        </button>
      </nav>
      <div ref={element => { map = element; }} class="gate-map" classList={{ 'is-open': snap().phase === 'choosing' }} aria-hidden={snap().phase === 'choosing' ? undefined : 'true'} />
      <Show when={snap().phase === 'authority'} fallback={<RaidGatePane controller={controller} clock={clock} />}>
        <AuthorityBoard snap={snap()} controller={controller} />
      </Show>
    </div>
  </div>;
}

/** The gate is the monarch's, but Twitch has not given Chatdom what it needs to start a raid yet. */
function AuthorityBoard(props: { snap: GateSnapshot; controller: RaidGateController }) {
  const [checking, setChecking] = createSignal(false);
  const name = () => props.snap.source.name;
  const told = () => explainAuthority(props.snap.authority === 'ready' ? null : props.snap.authority, name(), props.snap.canReconnect);
  async function check() {
    if (checking()) return;
    setChecking(true);
    try { await props.controller.refresh(); } finally { setChecking(false); }
  }
  return <aside class="rg-pane gate-authority" data-phase="authority" data-viewer="monarch" aria-labelledby="gate-authority-title">
    <div class="rg-board">
      <For each={['tl', 'tr', 'bl', 'br'] as const}>{at => <BrassCorner at={at} />}</For>
      <header class="rg-head">
        <Seal kingdomId={props.snap.source.kingdomId} size={58} label={`Arms of ${name()}`} />
        <div class="rg-head-words">
          <p class="rg-eyebrow">The gate of {name()}</p>
          <h2 id="gate-authority-title" class="rg-title">{told().heading}</h2>
        </div>
      </header>
      <div class="rg-parchment">
        <Show when={props.snap.notice?.kind === 'unreachable'}><p class="rg-notice" role="alert">Couldn't reach the gatekeeper. Nothing changed.</p></Show>
        <p class="rg-lede">{told().body}</p>
        <div class="rg-actions">
          <Show when={told().remedy === 'reconnect'}>
            <button class="rg-button rg-primary" type="button" onClick={() => props.controller.reconnect()}><KeyGlyph />{told().press}</button>
          </Show>
          <button class="rg-button" classList={{ 'rg-subtle': told().remedy === 'reconnect' }} type="button" disabled={checking()} aria-busy={checking()} onClick={() => void check()}>
            {checking() ? 'Checking…' : 'Check again'}
          </button>
        </div>
        <Show when={told().after}>{after => <p class="rg-quiet">{after()}</p>}</Show>
      </div>
    </div>
  </aside>;
}

function BrassCorner(props: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  return <svg class={`rg-corner rg-corner-${props.at}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M1 1h22l-3 5H6v14l-5 3Z" fill="url(#rg-brass)" stroke="#2b1c10" stroke-width=".8" stroke-linejoin="round" />
    <path d="M2.6 2.6h17.6M2.6 2.6v17" stroke="#fff1cc" stroke-width=".6" opacity=".55" fill="none" />
    <circle cx="4.6" cy="4.6" r="1.5" fill="#4a321b" /><circle cx="4.3" cy="4.3" r=".6" fill="#f7deae" />
  </svg>;
}

function KeyGlyph() {
  return <svg class="rg-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14.5 4a5.5 5.5 0 1 1-4.2 9.1L4 19.5V21h3v-2h2v-2h2l1.6-1.6" /><path d="M16.5 7.5h.01" />
  </svg>;
}
