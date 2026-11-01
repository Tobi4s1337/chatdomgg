// The viewer's own citizen card in the panel: their painted portrait in an arched brass window, their name in their
// chat colour, the plain dates that explain why this place is theirs, their home and its size, what they earned and
// chose to wear, and the keepsakes their passport holds. Everything is supplied by the card authority (or the visibly
// SIMULATED night); the panel only lays it out. A turned-up corner at the foot of the page leads into the passport.
import { createSignal, For, Match, Show, Switch, type JSX } from 'solid-js';
import { CrestArms, type KeepsakeView, type PassportReadState } from '@chatdom/ui/passport';
import type { CitizenCard, WornPiece } from '../model';
import { homeLine, nameInk } from './words';

export { homeLine, nameInk };
import './card.css';

export interface CardSheetProps {
  readonly card: CitizenCard;
  /** The street words under the home's name ("Lantern Row"), and where on it. */
  readonly street: string | null;
  readonly place: string | null;
  /** The home's own small picture, when the kingdom made one. */
  readonly homePicture: { readonly url: string; readonly alt: string } | null;
  /** The window's state in words, as the home card has always said it. */
  readonly window: string;
  /** The passport as it is being read, for the keepsakes it carries. Null until the viewer has a passport to read. */
  readonly passport: PassportReadState | null;
  readonly simulated: boolean;
  readonly children?: JSX.Element;
}

export function CardSheet(props: CardSheetProps): JSX.Element {
  const ink = () => nameInk(props.card.colour);
  const long = () => [...props.card.name].length > 16;
  return <div class="cp-sheet cpc">
    <section class="cpc-face" aria-label="Your citizen card">
      <Portrait card={props.card} simulated={props.simulated} />
      <div class="cpc-who">
        <h3 class="cpc-name" classList={{ long: long() }} style={ink().ink ? { color: ink().ink! } : undefined}>
          <Show when={ink().swatch}>{swatch => <span class="cpc-swatch" style={{ background: swatch() }} aria-hidden="true" />}</Show>
          <bdi>{props.card.name}</bdi>
        </h3>
        <p class="cpc-standing">{props.card.standing}</p>
        <Flourish />
        <dl class="cpc-facts">
          <div><dt>Following since</dt><dd classList={{ unknown: !props.card.following }}>{props.card.following ?? 'Not known yet'}</dd></div>
          <div><dt>Subscribed</dt><dd classList={{ unknown: !props.card.subscribed }}>{props.card.subscribed ?? 'Not known yet'}</dd></div>
        </dl>
      </div>
    </section>

    <section class="cpc-home" aria-label="Your home">
      <Show when={props.homePicture}>{picture =>
        <span class="cpc-home-picture"><img src={picture().url} alt={picture().alt} width="76" height="56" decoding="async" /></span>}
      </Show>
      <div class="cpc-home-words">
        <Show when={props.card.home} fallback={<p class="cpc-home-name">A guest here</p>}>{home =>
          <p class="cpc-home-name"><bdi>{home().name}</bdi></p>}
        </Show>
        <Show when={props.street}>{street => <p class="cpc-home-line">{homeLine(props.card.home?.tier ?? null, street())}</p>}</Show>
        <Show when={props.place}>{place => <p class="cpc-home-place">{place()}</p>}</Show>
        <p class="cpc-home-window">{props.window}</p>
      </div>
    </section>
    <Show when={props.card.elsewhere.length > 0}>
      <p class="cpc-elsewhere"><span>Also at home in</span> <For each={props.card.elsewhere}>{(home, i) =>
        <><Show when={i() > 0}><span class="cpc-dot" aria-hidden="true"> · </span></Show><bdi class="cpc-elsewhere-name">{home.kingdom}</bdi><span class="cpc-elsewhere-home">, <bdi>{home.home}</bdi></span></>}
      </For></p>
    </Show>

    <Show when={props.card.worn.length > 0}>
      <section class="cpc-worn" aria-labelledby="cpc-worn-title">
        <p id="cpc-worn-title" class="cp-label">Earned, and worn</p>
        <ul>
          <For each={props.card.worn}>{piece => <li>
            <WornMark piece={piece} />
            <span class="cpc-worn-words"><strong>{piece.name}</strong><Show when={piece.story}>{story => <small>{story()}</small>}</Show></span>
          </li>}</For>
        </ul>
      </section>
    </Show>

    <Keepsakes state={props.passport} />
    {props.children}
  </div>;
}

/** Their painted portrait in an arched brass window. Without one, the window stays an honest empty arch. */
function Portrait(props: { card: CitizenCard; simulated: boolean }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  return <figure class="cpc-portrait">
    <span class="cpc-arch">
      <Show when={props.card.portrait && !failed() ? props.card.portrait : null} fallback={
        <span class="cpc-arch-empty">{props.card.portrait ? 'Your portrait could not be shown just now' : 'No portrait painted yet'}</span>}>{portrait =>
        <img src={portrait().url} alt={portrait().alt} width={portrait().width} height={portrait().height} decoding="async" onError={() => setFailed(true)} />}
      </Show>
    </span>
    <Show when={props.simulated && props.card.portrait?.origin === 'simulated'}>
      <figcaption class="cpc-portrait-note">Simulated citizen</figcaption>
    </Show>
  </figure>;
}

function Flourish(): JSX.Element {
  return <svg class="cpc-flourish" viewBox="0 0 120 8" aria-hidden="true">
    <path d="M2 4h46M72 4h46" />
    <path d="M52 4c3-3.2 6-3.2 8 0 2 3.2 5 3.2 8 0" />
    <circle cx="60" cy="4" r="1.3" />
  </svg>;
}

/**
 * The keepsakes the passport carries, beside the card. They come only from a visible book, through the same reading
 * that follows the card's disclosure: a private, unread or unreadable passport puts nothing here at all.
 */
function Keepsakes(props: { state: PassportReadState | null }): JSX.Element {
  // Three to show what the road gave, each a different thing: two sprigs of the same lavender read as a list, not a life.
  const keepsakes = (): readonly KeepsakeView[] => {
    if (props.state?.kind !== 'visible') return [];
    const seen = new Set<string>();
    return props.state.book.keepsakes.items.filter(item => !seen.has(item.name) && seen.add(item.name)).slice(0, 3);
  };
  return <Switch>
    <Match when={keepsakes().length > 0}>
      <section class="cpc-keepsakes" aria-labelledby="cpc-keepsakes-title">
        <p id="cpc-keepsakes-title" class="cp-label">Keepsakes from the road</p>
        <ul>
          <For each={keepsakes()}>{keepsake => <li>
            <CrestArms crest={keepsake.kingdom.crest} kingdomName={keepsake.kingdom.name} size={22} class="cpc-keepsake-arms" decorative />
            <span class="cpc-worn-words"><strong>{keepsake.name}</strong><small>From <bdi>{keepsake.kingdom.name}</bdi></small></span>
          </li>}</For>
        </ul>
      </section>
    </Match>
  </Switch>;
}

/**
 * Each earned piece drawn small, in its own colours, the way it sits on the citizen: a bar of month ribbons, the
 * tenure hood, a crest pin, the knitted raid scarf, a cape, a forged hat. Code-drawn marks, no icons.
 */
export function WornMark(props: { piece: WornPiece }): JSX.Element {
  return <svg class="cpc-mark" viewBox="0 0 32 32" aria-hidden="true">
    <Switch>
      <Match when={props.piece.family === 'ribbons' ? props.piece : null}>{piece => <Ribbons months={piece().months} />}</Match>
      <Match when={props.piece.family === 'hood' ? props.piece : null}>{piece =>
        <g>
          <path d="M5 23c0-7 5-12 11-12s11 5 11 12l-3 4H8z" fill={piece().colours[0]} stroke="#2a1a10" stroke-width="1.2" stroke-linejoin="round" />
          <path d="M8 23c1.5-4.4 4.5-6.6 8-6.6s6.5 2.2 8 6.6" fill="none" stroke={piece().colours[1]} stroke-width="2.2" stroke-linecap="round" />
          <path d="M8 27h16" stroke="#2a1a10" stroke-width="1.2" />
        </g>}
      </Match>
      <Match when={props.piece.family === 'pin' ? props.piece : null}>{piece =>
        <g>
          <circle cx="16" cy="16" r="12" fill="#e9c98a" stroke="#6a4c2b" stroke-width="1.2" />
          <path d={piece().shape === 'round' ? 'M16 8a7 7 0 1 1 0 15a7 7 0 1 1 0-15z' : piece().shape === 'swallowtail' ? 'M9.5 8.5h13v8c0 4-3 6.5-6.5 7.5-3.5-1-6.5-3.5-6.5-7.5z' : 'M10 8.5h12v7c0 4.2-2.8 6.8-6 8-3.2-1.2-6-3.8-6-8z'}
            fill={piece().colours[0]} stroke="#2a1a10" stroke-width="1.1" stroke-linejoin="round" />
          <circle cx="16" cy="15" r="2.3" fill={piece().colours[1]} />
        </g>}
      </Match>
      <Match when={props.piece.family === 'scarf' ? props.piece : null}>{piece =>
        <g>
          <path d="M6 9c6 3 14 3 20 0v6c-6 3-14 3-20 0z" fill={piece().colours[0]} stroke="#2a1a10" stroke-width="1.1" />
          <path d="M18 14l3 14h5l-3-14z" fill={piece().colours[0]} stroke="#2a1a10" stroke-width="1.1" stroke-linejoin="round" />
          <path d="M10 11.2v5.1M14 11.8v5.2M22 11.2v5.1M19.3 18.6h4.2M20.4 23.4h4.2" stroke={piece().colours[1]} stroke-width="1.8" />
        </g>}
      </Match>
      <Match when={props.piece.family === 'cape' ? props.piece : null}>{piece =>
        <path d="M10 6h12l5 22H5z" fill={piece().colours[0]} stroke={piece().colours[1]} stroke-width="1.6" stroke-linejoin="round" />}
      </Match>
      <Match when={props.piece.family === 'forgedHat' ? props.piece : null}>{piece =>
        <g>
          <path d="M5 22h22v3H5z" fill={piece().colours[0]} stroke="#2a1a10" stroke-width="1.1" />
          <path d="M9 22v-9h14v9" fill={piece().colours[0]} stroke="#2a1a10" stroke-width="1.1" />
          <circle cx="16" cy="17" r="2.6" fill={piece().colours[1]} />
        </g>}
      </Match>
    </Switch>
  </svg>;
}

/** The month ribbons as a medal bar: one stripe per mark reached, the newest on the right. */
function Ribbons(props: { months: number }): JSX.Element {
  const MARKS = [1, 3, 6, 9, 12, 18, 24, 36, 48, 60];
  const COLOURS = ['#b8443a', '#e3b955', '#2f6f5e', '#3d5f9e', '#7a3f8f', '#c76f2a', '#3a7d8c', '#9a2f4c', '#5c7a2e', '#d8c27a'];
  const reached = () => Math.max(1, MARKS.filter(mark => mark <= props.months).length);
  const width = () => Math.min(24, reached() * 3);
  return <g>
    <rect x={16 - width() / 2 - 1} y="10" width={width() + 2} height="10" rx="1" fill="#2a1a10" />
    <For each={Array.from({ length: Math.min(8, reached()) }, (_, i) => i)}>{i =>
      <rect x={16 - width() / 2 + i * (width() / Math.min(8, reached()))} y="11" width={width() / Math.min(8, reached())} height="8" fill={COLOURS[i]!} />}
    </For>
    <path d="M12 20l-2 8 3-2 3 2v-8M20 20l2 8-3-2-3 2" fill="#e3b955" stroke="#6a4c2b" stroke-width=".9" stroke-linejoin="round" />
  </g>;
}

/**
 * The turned-up corner at the foot of the card: the passport waits under it. A tap or a swipe to the left turns
 * the card away and the book lies open beneath.
 */
export function PassportCorner(props: { onTurn: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void; private: boolean; ref?: (element: HTMLButtonElement) => void }): JSX.Element {
  return <button ref={element => props.ref?.(element)} type="button" class="cpc-corner" data-opens="passport" onClick={event => props.onTurn(event)}
    aria-label={props.private ? 'Turn to your passport. Your travels are kept private.' : 'Turn the page to your passport'}>
    <span class="cpc-corner-leather" aria-hidden="true"><i /></span>
    <span class="cpc-corner-words"><strong>Your passport</strong><small>Turn the page</small></span>
  </button>;
}
