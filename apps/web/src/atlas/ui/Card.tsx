import { createEffect, onCleanup, Show, type JSX } from 'solid-js';
import { blazon, shieldDesign } from '../heraldry';
import type { CardReply, CardRoad } from '../data/directory';
import type { Settler } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import { holdingNote, holdingStatus, mapNoun } from './edition';
import { formatCount, formatTime, tierBand, TIER_NAMES, watchUrl } from './format';
import { LIVE_CLASS_NAMES } from './live-line';
import { ChannelFaceSeal } from './Face';
import { doorHolding, type DoorHolding } from '../data/holding';
import { EnterKingdom, RegisterFacts, ShareButton, WatchLink, type RegisterState } from './Register';
import type { FoundedKingdom } from '../data/kingdoms';

export type NamesState = 'loading' | 'ready' | 'failed';

/**
 * A mapped channel's public card. Everything on it is observed survey data: the holding's tier, its realm and
 * land, the observed average audience and main category over the survey window. It is mapped, not founded; in an
 * edition its tier is the one its land was granted at, whatever the audience since. Its
 * name and Watch link come from the names projection and are shown only while fresh; without them the card still
 * reads as the holding it is, and says why the name is missing.
 */
export function Card(props: {
  settler: Settler;
  /** Passed separately so the card follows a refreshed or expired name on the same holding. */
  name: string | null;
  login: string | null;
  names: NamesState;
  world: PreviewWorld;
  /** What the live frame shown says of this holding, or null before any frame was taken. */
  live: { liveClass: number; startedAt: number | null; asOf: number } | null;
  /** This holding's register entry: its last stream and strongest roads. */
  register: RegisterState<CardReply>;
  onClose: () => void;
  onRoad: (road: CardRoad) => void;
  onRetry: () => void;
  onEnter?: (holding: DoorHolding) => void;
  /** The road ledger's view of its roads (see RegisterFacts). */
  ledger?: (() => JSX.Element | null) | undefined;
  /** Only on the signed-in broadcaster's own card: the line that hides it. */
  owner?: (() => JSX.Element | null) | undefined;
  /** The kingdom this holding's channel founded in Chatdom, when the site's door names it: its way in leads. */
  kingdom?: FoundedKingdom | null;
}) {
  let closeButton: HTMLButtonElement | undefined;
  const region = () => props.world.regions[props.settler.region];
  const arms = () => blazon(shieldDesign(props.settler.id));
  const url = () => (props.login ? watchUrl(props.login) : null);
  const showLogin = () => props.name !== null && props.login !== null && props.name.toLowerCase() !== props.login;
  const title = () => props.name ?? `Unnamed ${TIER_NAMES[props.settler.tierRank]!.toLowerCase()}`;
  // A named, shown holding has a door. Reading the name keeps it in step with a refreshed or expired name.
  const door = () => (!props.kingdom && props.name !== null && props.login !== null ? doorHolding(props.settler, props.world) : null);
  const enter = (event: MouseEvent, holding: DoorHolding) => {
    if (!props.onEnter || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onEnter(holding);
  };
  const missing = () => {
    if (props.name !== null) return null;
    if (props.names === 'loading') return `Reading the names of this ${mapNoun(props.world)}…`;
    if (props.names === 'failed') return `The names of this ${mapNoun(props.world)} could not be read just now, so this holding shows its arms alone. Its name and Watch link return when the Atlas service answers.`;
    return 'This holding is not named in the current public projection.';
  };

  createEffect(() => {
    void props.settler.id;
    queueMicrotask(() => closeButton?.focus({ preventScroll: true }));
  });
  const onKey = (event: KeyboardEvent) => {
    const map = closeButton?.closest('[data-chatdom-atlas]');
    if (map && event.target instanceof Node && !map.contains(event.target)) return;
    if (event.key === 'Escape') props.onClose();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));

  return (
    <section class="atlas-card atlas-card-with-actions" aria-labelledby="atlas-card-title" data-tier={props.settler.tier} data-kind={props.kingdom ? 'kingdom' : 'holding'}>
      <button ref={(element) => (closeButton = element)} class="atlas-card-close" type="button" on:click={() => props.onClose()} aria-label="Close card">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
      </button>
      <header class="atlas-card-head">
        <ChannelFaceSeal channelId={props.settler.id} name={props.name} portrait={props.name && props.register.status === 'ready' && props.register.reply.channel.id === props.settler.id ? props.register.reply.portrait : null} />
        <div class="atlas-card-names">
          <p class="atlas-card-status">{props.kingdom ? 'A Chatdom kingdom' : holdingStatus(props.world)}</p>
          <h2 id="atlas-card-title" dir="auto" classList={{ 'atlas-card-unnamed': props.name === null }}>{title()}</h2>
          <Show when={showLogin()}><p class="atlas-card-login">{props.settler.login}</p></Show>
        </div>
      </header>
      <Show when={props.kingdom}>{(kingdom) => <EnterKingdom kingdom={kingdom()} />}</Show>
      <div class="atlas-card-scroll" tabindex="0" aria-label="Holding details">
      <dl class="atlas-card-facts">
        <Show when={props.kingdom}>
          {(kingdom) => <div data-atlas-kingdom="true"><dt>Kingdom</dt><dd dir="auto">{kingdom().name}</dd></div>}
        </Show>
        <div><dt>Holding</dt><dd>{TIER_NAMES[props.settler.tierRank]} <span class="atlas-quiet">· {tierBand(props.world.tiers.minAverage, props.settler.tierRank)}</span></dd></div>
        <Show when={region()}>
          {(r) => (
            <div>
              <dt>Realm</dt>
              <dd>
                {/* An isle is one realm and the Outer Isles one archipelago: their realm is the land itself. */}
                <Show when={r().kind === 'continent' && props.settler.realmName}>{props.settler.realmName} · </Show>
                <span lang="en">{r().name}</span>
                <Show when={r().englishName !== r().name}><span class="atlas-quiet"> · {r().englishName}</span></Show>
                <Show when={r().kind === 'isle'}><span class="atlas-quiet"> · isle</span></Show>
              </dd>
            </div>
          )}
        </Show>
        <div><dt>Observed</dt><dd>{formatCount(props.settler.average)} average viewers</dd></div>
        <Show when={props.live}>
          {(live) => (
            <div class="atlas-card-live" data-live={live().liveClass > 0 ? 'true' : 'false'}>
              <dt>On air</dt>
              <Show
                when={live().liveClass > 0}
                fallback={<dd class="atlas-quiet">Not in the sweep of {formatTime(live().asOf)}; its standard flies bare.</dd>}
              >
                <dd>
                  {live().startedAt !== null ? `Live since ${formatTime(live().startedAt!)}` : 'Live; start not known'}
                  <span class="atlas-quiet"> · {LIVE_CLASS_NAMES[live().liveClass]}</span>
                </dd>
              </Show>
            </div>
          )}
        </Show>
        <Show when={props.settler.game}><div><dt>Most streamed</dt><dd>{props.settler.game}</dd></div></Show>
        <div><dt>Arms</dt><dd class="atlas-blazon">{arms()}</dd></div>
      </dl>
      <RegisterFacts
        state={props.register}
        world={props.world}
        onAirNow={props.live ? props.live.liveClass > 0 : null}
        onRoad={props.onRoad}
        onRetry={props.onRetry}
        ledger={props.ledger}
      />
      <p class="atlas-card-note">{holdingNote(props.world)}</p>
      <Show when={missing()}>{(text) => <p class="atlas-card-missing">{text()}</p>}</Show>
      </div>
      <footer class="atlas-card-footer">
      <Show when={door()}>
        {(holding) => (
          <a class="atlas-watch atlas-door" href={`/kingdom/${holding().id}`} on:click={(event) => enter(event, holding())}>
            Enter the land
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 14V7a5 5 0 0 1 10 0v7M3 14h10M8 9v2" /></svg>
          </a>
        )}
      </Show>
      <div class="atlas-card-actions">
        <Show when={url()}>{(href) => <WatchLink href={href()} />}</Show>
        <Show when={props.login}>{(login) => <ShareButton path={`/map/${login()}`} title={`${props.name} on the Atlas of Kingdoms`} />}</Show>
      </div>
      {props.owner?.()}
      </footer>
    </section>
  );
}
