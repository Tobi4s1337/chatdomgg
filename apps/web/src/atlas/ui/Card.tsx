import { createEffect, onCleanup, Show } from 'solid-js';
import { blazon, shieldDesign } from '../heraldry';
import type { Settler } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import { formatCount, formatDayRange, TIER_NAMES, watchUrl } from './format';
import { ShieldIcon } from './marks';

export type NamesState = 'loading' | 'ready' | 'failed';

/**
 * A mapped channel's public card. Everything on it is observed survey data: the holding's tier, its realm and
 * land, the observed average audience and main category over the survey window. It is mapped, not founded. Its
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
  onClose: () => void;
}) {
  let closeButton: HTMLButtonElement | undefined;
  const region = () => props.world.regions[props.settler.region];
  const minimum = () => props.world.tiers.minAverage[props.settler.tier];
  const arms = () => blazon(shieldDesign(props.settler.id));
  const url = () => (props.login ? watchUrl(props.login) : null);
  const showLogin = () => props.name !== null && props.login !== null && props.name.toLowerCase() !== props.login;
  const title = () => props.name ?? `Unnamed ${TIER_NAMES[props.settler.tierRank]!.toLowerCase()}`;
  const missing = () => {
    if (props.name !== null) return null;
    if (props.names === 'loading') return 'Reading the names of this survey…';
    if (props.names === 'failed') return 'The names of this survey could not be read just now, so this holding shows its arms alone. Its name and Watch link return when the Atlas service answers.';
    return 'Twitch names appear on the map only while the survey has seen them within a day. This channel has not been seen since, so it keeps its arms alone until it is.';
  };

  createEffect(() => {
    void props.settler.id;
    queueMicrotask(() => closeButton?.focus({ preventScroll: true }));
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') props.onClose();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));

  return (
    <section class="atlas-card" aria-labelledby="atlas-card-title" data-tier={props.settler.tier}>
      <button ref={(element) => (closeButton = element)} class="atlas-card-close" type="button" onClick={() => props.onClose()} aria-label="Close card">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
      </button>
      <header class="atlas-card-head">
        {/* Keyed so the canvas redraws when another holding is chosen. */}
        <Show when={props.settler.id} keyed>
          {(id) => <ShieldIcon channelId={id} width={52} label={`Arms: ${arms()}`} />}
        </Show>
        <div class="atlas-card-names">
          <p class="atlas-card-status">Mapped holding · not yet founded</p>
          <h2 id="atlas-card-title" classList={{ 'atlas-card-unnamed': props.name === null }}>{title()}</h2>
          <Show when={showLogin()}><p class="atlas-card-login">{props.settler.login}</p></Show>
        </div>
      </header>
      <dl class="atlas-card-facts">
        <div><dt>Holding</dt><dd>{TIER_NAMES[props.settler.tierRank]} <span class="atlas-quiet">· {formatCount(minimum())}+ average viewers</span></dd></div>
        <Show when={region()}>
          {(r) => (
            <div>
              <dt>Realm</dt>
              <dd>
                {/* An isle is one realm and the Outer Isles one archipelago: their realm is the land itself. */}
                <Show when={r().kind === 'continent' && props.settler.realmName}>{props.settler.realmName} · </Show>
                <span lang={r().language ?? undefined}>{r().name}</span>
                <Show when={r().englishName !== r().name}><span class="atlas-quiet"> · {r().englishName}</span></Show>
                <Show when={r().kind === 'isle'}><span class="atlas-quiet"> · isle</span></Show>
              </dd>
            </div>
          )}
        </Show>
        <div><dt>Observed</dt><dd>{formatCount(props.settler.average)} average viewers</dd></div>
        <Show when={props.settler.game}><div><dt>Most streamed</dt><dd>{props.settler.game}</dd></div></Show>
        <div><dt>Arms</dt><dd class="atlas-blazon">{arms()}</dd></div>
      </dl>
      <p class="atlas-card-note">
        Survey of {formatDayRange(props.world.window.firstObservationAt, props.world.window.lastObservationAt)} (UTC). Draft land: this holding may still move before the first edition.
      </p>
      <Show when={missing()}>{(text) => <p class="atlas-card-missing">{text()}</p>}</Show>
      <Show when={url()}>
        {(href) => (
          <a class="atlas-watch" href={href()} target="_blank" rel="noopener noreferrer">
            Watch on Twitch
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M13 3L4 12" /></svg>
            <span class="atlas-visually-hidden"> (opens twitch.tv in a new tab)</span>
          </a>
        )}
      </Show>
    </section>
  );
}
