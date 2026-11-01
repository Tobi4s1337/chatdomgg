import { createMemo, createUniqueId, For, onCleanup, onMount, Show, type Accessor, type JSX } from 'solid-js';
import type { CursorView, PlayHost, WayHome } from '../host';
import { actionCode, PLAY_ACTIONS, DEFAULT_PLAY_SETTINGS, SETTING_LIMITS } from '../settings';
import type { ActionBinding, LedgerPageProvider, PlayAction, PlayContext, PlaySettings } from '../slots';
import { Choice, Keycap, Slider, Switch } from './controls';
import { keyName, type KeyLayout } from './keys';
import { buildMark, hearthMark, signpostMark } from './marks';
import { bindingOf, bindingTarget, type KeyNote, type KeyTarget, type Ledger, type LedgerState } from './model';
import {
  ACTION_WORDS, DENSITY_ORDER, DENSITY_WORDS, directionWords, distanceWords, fovWords, percentWords, SENSITIVITY_STOPS,
  sensitivityStop, sensitivityWords, wrapAngle,
} from './words';

export interface PageProps {
  readonly ledger: Ledger;
  readonly play: PlayHost;
  readonly state: Accessor<LedgerState>;
  readonly settings: Accessor<Readonly<PlaySettings>>;
  readonly cursor: Accessor<CursorView>;
  readonly layout: Accessor<KeyLayout | null>;
  readonly way: Accessor<WayHome | null>;
  /** Keys other lanes registered (the bag, the hotbar), listed after play's own. */
  readonly bindings: Accessor<readonly ActionBinding[]>;
}

const Section = (props: { title: string; area: string; aside?: JSX.Element; children: JSX.Element }) =>
  <section class="pl-section" data-area={props.area} aria-labelledby={`pl-section-${props.area}`}>
    <header class="pl-section-head"><h3 class="pl-section-title" id={`pl-section-${props.area}`}>{props.title}</h3>{props.aside}</header>
    {props.children}
  </section>;

/* ---------------------------------------------------------------- Settings */

const VOLUME_WORDS: readonly { key: keyof PlaySettings['volume']; words: string }[] = [
  { key: 'master', words: 'All sound' }, { key: 'world', words: 'The kingdom' }, { key: 'voice', words: 'Voices' }, { key: 'interface', words: 'Menus and signs' },
];
const FOV_MIN = SETTING_LIMITS.fov[0], FOV_MAX = SETTING_LIMITS.fov[1];

/** The plate's words and its key now, for play's actions and other lanes' bindings alike. */
function plateOf(target: KeyTarget, props: PageProps): { words: string; code: string } {
  const id = bindingOf(target), settings = props.settings();
  if (id === null) return { words: ACTION_WORDS[target as PlayAction], code: settings.keys[target as PlayAction] };
  const binding = props.bindings().find(each => each.id === id);
  return { words: binding?.label ?? id, code: binding ? actionCode(settings, binding) : '' };
}

function noteWords(note: KeyNote, props: PageProps): string {
  const name = (code: string) => keyName(code, props.layout()) || 'no key';
  switch (note.kind) {
    case 'bound': {
      const said = `${plateOf(note.target, props).words} is now ${name(note.code)}.`;
      if (!note.moved) return said;
      const moved = plateOf(note.moved, props);
      return moved.code ? `${said} ${moved.words} moved to ${name(moved.code)}.` : `${said} ${moved.words} needs a key now.`;
    }
    case 'reserved': return `${name(note.code)} stays with the browser and this ledger. Choose another key.`;
    case 'taken': return `${name(note.code)} is for ${ACTION_WORDS[note.holder].toLowerCase()}. Choose another key.`;
    case 'restored': return 'The usual keys are back.';
  }
}

function KeyPlate(props: { target: KeyTarget; page: PageProps }): JSX.Element {
  const plate = () => plateOf(props.target, props.page);
  const name = () => keyName(plate().code, props.page.layout());
  const on = () => props.page.state().capture === props.target;
  return <li class="pl-key-row">
    <button type="button" class="pl-keyplate" data-listening={on() ? 'true' : undefined} data-key-action={props.target}
      aria-label={on() ? `${plate().words}: press the new key` : `${plate().words}: ${name() || 'no key'}. Change`}
      onClick={() => props.page.ledger.beginCapture(props.target)}>
      <span class="pl-keyplate-words">{plate().words}</span>
      <span class="pl-keycap" classList={{ 'pl-keycap-wide': [...name()].length > 2, 'pl-keycap-listening': on(), 'pl-keycap-empty': !on() && !name() }}>
        {on() ? 'Press a key' : name() || 'Needs a key'}
      </span>
    </button>
  </li>;
}

export function SettingsPage(props: PageProps): JSX.Element {
  const s = props.settings, ledger = props.ledger;
  const plates = createMemo<readonly KeyTarget[]>(() => [
    ...PLAY_ACTIONS.filter(action => action !== 'fullscreen' || props.cursor().canFullscreen),
    ...props.bindings().map(binding => bindingTarget(binding.id)),
  ]);
  const listening = () => props.state().capture;
  const say = () => {
    const target = listening();
    const note = props.state().note;
    if (target && note && note.kind !== 'bound' && note.kind !== 'restored') return noteWords(note, props);
    if (target) {
      const plate = plateOf(target, props), now = keyName(plate.code, props.layout());
      return `Press the new key for ${plate.words.toLowerCase()}. Escape ${now ? `keeps ${now}` : 'leaves it as it is'}.`;
    }
    return note ? noteWords(note, props) : 'Choose a plate, then press the key you want.';
  };
  // On touch there is no mouse and no keyboard: the words follow the hands, and the key plates stay out of the way.
  const touch = () => props.cursor().state === 'touch';
  return <div class="pl-settings" data-touch={touch() ? 'true' : undefined}>
    <Section title="Camera" area="camera">
      <Choice id="pl-set-view" label="View" value={s().view} options={[
        { value: 'third', words: 'Third person' }, { value: 'first', words: 'First person' }]}
        hint={!touch() && s().keys.view ? `${keyName(s().keys.view, props.layout())} switches while you walk` : undefined}
        onChoose={view => ledger.change({ view }, 'wood')} />
      <Slider id="pl-set-sensitivity" label={touch() ? 'Look sensitivity' : 'Mouse sensitivity'} count={SENSITIVITY_STOPS.length} at={sensitivityStop(s().sensitivity)}
        usual={sensitivityStop(DEFAULT_PLAY_SETTINGS.sensitivity)} big={4} text={stop => sensitivityWords(SENSITIVITY_STOPS[stop]!)}
        onPick={stop => ledger.change({ sensitivity: SENSITIVITY_STOPS[stop]! }, 'brass')} />
      <Slider id="pl-set-fov" label="Field of view" count={FOV_MAX - FOV_MIN + 1} at={Math.round(s().fov) - FOV_MIN}
        usual={DEFAULT_PLAY_SETTINGS.fov - FOV_MIN} big={5} text={stop => fovWords(stop + FOV_MIN)}
        onPick={stop => ledger.change({ fov: stop + FOV_MIN }, 'brass')} />
      <Switch id="pl-set-invert" label="Invert up and down" hint={touch() ? 'Dragging upward looks down.' : 'Pushing the mouse forward looks down.'} on={s().invertY}
        onToggle={() => ledger.change({ invertY: !s().invertY }, 'brass')} />
    </Section>
    <Show when={props.play.volumes.length > 0}><Section title="Sound" area="sound">
      <For each={VOLUME_WORDS.filter(item => props.play.volumes.includes(item.key))}>{item => <Slider id={`pl-set-volume-${item.key}`} label={item.words} count={21}
        at={Math.round(s().volume[item.key] * 20)} big={4} usual={Math.round(DEFAULT_PLAY_SETTINGS.volume[item.key] * 20)}
        text={stop => stop === 0 ? 'Silent' : percentWords(stop / 20)}
        onPick={stop => ledger.change({ volume: { [item.key]: stop / 20 } }, 'brass')} />}</For>
    </Section></Show>
    <Section title="People" area="people">
      <Choice id="pl-set-labels" label="Names over heads" value={s().labels} options={DENSITY_ORDER.map(value => ({ value, words: DENSITY_WORDS[value] }))}
        onChoose={labels => ledger.change({ labels }, 'wood')} />
      <Choice id="pl-set-bubbles" label="Chat bubbles" value={s().bubbles} options={DENSITY_ORDER.map(value => ({ value, words: DENSITY_WORDS[value] }))}
        onChoose={bubbles => ledger.change({ bubbles }, 'wood')} />
    </Section>
    <Section title="Comfort" area="comfort">
      <Switch id="pl-set-motion" label="Reduce motion" hint="Short fades instead of swinging, turning and sliding." on={s().reducedMotion}
        onToggle={() => ledger.change({ reducedMotion: !s().reducedMotion }, 'brass')} />
      <Show when={props.cursor().canFullscreen}>
        <Switch id="pl-set-fullscreen" label="Fullscreen" on={props.cursor().fullscreen} onToggle={() => ledger.toggleFullscreen()}
          hint={props.cursor().canLockKeyboard ? 'In fullscreen, Escape opens this ledger and holding Escape leaves fullscreen.' : undefined} />
      </Show>
    </Section>
    <Show when={!touch()}><Section title="Keys" area="keys" aside={<button type="button" class="pl-quiet-button" onClick={() => ledger.restoreKeys()}>Restore the usual keys</button>}>
      <ul class="pl-keys" role="list">
        <For each={plates()}>{target => <KeyPlate target={target} page={props} />}</For>
      </ul>
      <p class="pl-key-note" aria-live="polite" data-kind={listening() ? 'listening' : props.state().note?.kind}>{say()}</p>
    </Section></Show>
  </div>;
}

/* ---------------------------------------------------------------- Way home */

/** A brass compass whose needle points at your door relative to where you look; it always turns the short way. */
function Compass(props: { relative: number; still: boolean }): JSX.Element {
  const id = createUniqueId();
  let shown = 0;
  const angle = createMemo(() => {
    const target = wrapAngle(props.relative) * 180 / Math.PI;
    const delta = ((target - shown) % 360 + 540) % 360 - 180;
    shown += delta;
    return shown;
  });
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);
  return <svg class="pl-compass" viewBox="-100 -100 200 200" aria-hidden="true" data-still={props.still ? 'true' : undefined}>
    <defs>
      <radialGradient id={`${id}-brass`} cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#fbe7b0" /><stop offset=".42" stop-color="#c99f5b" /><stop offset="1" stop-color="#6c4b22" /></radialGradient>
      <radialGradient id={`${id}-face`} cx="40%" cy="32%" r="78%"><stop offset="0" stop-color="#fbf1d8" /><stop offset=".7" stop-color="#efdfba" /><stop offset="1" stop-color="#d9c194" /></radialGradient>
      <linearGradient id={`${id}-lacquer`} x1="0" x2="1"><stop offset="0" stop-color="#b04a2c" /><stop offset=".5" stop-color="#8e3420" /><stop offset=".5" stop-color="#6e2416" /><stop offset="1" stop-color="#5a1c10" /></linearGradient>
      <linearGradient id={`${id}-steel`} x1="0" x2="1"><stop offset="0" stop-color="#5d6478" /><stop offset=".5" stop-color="#3f4558" /><stop offset=".5" stop-color="#2c3040" /><stop offset="1" stop-color="#22252f" /></linearGradient>
    </defs>
    <circle r="97" class="pl-compass-shadow" />
    <circle r="95" fill={`url(#${id}-brass)`} class="pl-compass-ring" />
    <circle r="84" class="pl-compass-bezel" />
    <circle r="80" fill={`url(#${id}-face)`} class="pl-compass-face" />
    <For each={ticks}>{deg => <line class="pl-compass-tick" data-major={deg % 90 === 0 ? 'true' : undefined}
      x1="0" y1={-78} x2="0" y2={deg % 90 === 0 ? -64 : deg % 30 === 0 ? -69 : -73}
      transform={`rotate(${deg})`} />}</For>
    <circle r="56" class="pl-compass-inner" />
    <path class="pl-compass-ahead" d="M0 -92 5.5 -84 -5.5 -84Z" />
    <g class="pl-compass-needle" style={{ transform: `rotate(${angle()}deg)` }}>
      <path d="M0 -70 9 0H-9Z" fill={`url(#${id}-lacquer)`} />
      <path d="M0 70 9 0H-9Z" fill={`url(#${id}-steel)`} />
      <path class="pl-compass-needle-edge" d="M0 -70 9 0 0 70-9 0Z" />
      <g class="pl-compass-home" transform="translate(0 -44)"><path d="M-6 3.5v-5.5L0 -7l6 5v5.5Z" /></g>
    </g>
    <circle r="11" fill={`url(#${id}-brass)`} class="pl-compass-cap" />
    <circle r="3.2" class="pl-compass-pin" />
  </svg>;
}

export function WayHomePage(props: PageProps): JSX.Element {
  return <div class="pl-way">
    <Show when={props.way()} fallback={<div class="pl-blank"><span class="pl-blank-mark">{signpostMark()}</span><p class="pl-lead">You have no home in this kingdom yet.</p></div>}>{way =>
      <Show when={!way().inside} fallback={<div class="pl-way-home">
        <span class="pl-way-hearth">{hearthMark()}</span>
        <div class="pl-way-words"><p class="pl-way-eyebrow">Your door</p><h3 class="pl-way-street">You are home.</h3>
          <Show when={way().street}><p class="pl-way-line">{way().street}</p></Show></div>
      </div>}>
        <div class="pl-way-out">
          <Compass relative={way().relative} still={props.settings().reducedMotion} />
          <div class="pl-way-words">
            <p class="pl-way-eyebrow">Your door</p>
            <h3 class="pl-way-street">{way().street ? `On ${way().street}` : 'Your home'}</h3>
            <p class="pl-way-line pl-way-far">{distanceWords(way().metres)}</p>
            <p class="pl-way-line">{way().metres < 3 ? 'Your door is here.' : `It lies ${directionWords(way().relative)}.`}</p>
            <p class="pl-way-note">The red end of the needle points to your door from where you are looking.</p>
          </div>
        </div>
      </Show>}
    </Show>
  </div>;
}

/* ---------------------------------------------------------------- Build */

export function BuildPage(props: PageProps): JSX.Element {
  return <div class="pl-build pl-blank">
    <span class="pl-blank-mark">{buildMark()}</span>
    <Show when={props.play.build.open} fallback={<p class="pl-lead">{props.play.build.note}</p>}>
      <p class="pl-lead">Shape your home with the build rack: tools, materials and your pieces, over the street.</p>
      <button type="button" class="pl-action" onClick={() => props.ledger.openBuild()}>{buildMark()}<span>Open the build rack</span></button>
      <Show when={props.play.build.note}><p class="pl-way-note">{props.play.build.note}</p></Show>
    </Show>
  </div>;
}

/* ---------------------------------------------------------------- Help */

const Row = (props: { keys: JSX.Element; children: JSX.Element }) =>
  <li class="pl-help-row"><span class="pl-help-keys">{props.keys}</span><span class="pl-help-words">{props.children}</span></li>;

export function HelpPage(props: PageProps): JSX.Element {
  const k = (action: PlayAction) => keyName(props.settings().keys[action], props.layout());
  const cap = (action: PlayAction) => <Show when={k(action)}><Keycap name={k(action)} /></Show>;
  const touch = () => props.cursor().state === 'touch';
  return <div class="pl-help">
    <Show when={!touch()} fallback={<><div class="pl-help-col">
      <Section title="Walking" area="help-walk"><ul class="pl-help-list" role="list">
        <Row keys={<span class="pl-gesture">Left thumb</span>}>Walk: put your thumb down low on the left and a stick appears under it</Row>
        <Row keys={<span class="pl-gesture">Push past the rim</span>}>Run</Row>
        <Row keys={<span class="pl-gesture">Drag</span>}>Look around: drag anywhere else</Row>
        <Row keys={<span class="pl-gesture">Two fingers</span>}>Pinch to zoom, in third person</Row>
        <Row keys={<span class="pl-gesture">Round button</span>}>Jump</Row>
      </ul></Section>
    </div><div class="pl-help-col">
      <Section title="This ledger" area="help-ledger"><ul class="pl-help-list" role="list">
        <Row keys={<span class="pl-gesture">Book button</span>}>Opens this ledger, in the corner by your right thumb</Row>
        <Row keys={<span class="pl-gesture">Back to the street</span>}>Closes it and puts you back on your feet</Row>
      </ul></Section>
    </div></>}>
      <div class="pl-help-col">
      <Section title="Walking" area="help-walk"><ul class="pl-help-list" role="list">
        <Row keys={<span class="pl-help-cluster">{cap('forward')}<span class="pl-help-cluster-row">{cap('left')}{cap('back')}{cap('right')}</span></span>}>Walk</Row>
        <Row keys={<>{cap('sprint')}<span class="pl-help-hold">hold</span></>}>Run</Row>
        <Row keys={cap('jump')}>Jump</Row>
        <Row keys={cap('use')}>Use what you face</Row>
      </ul></Section>
      <Show when={props.bindings().length}>
        <Section title="More keys" area="help-more"><ul class="pl-help-list" role="list">
          <For each={props.bindings()}>{binding => {
            const name = () => keyName(actionCode(props.settings(), binding), props.layout());
            return <Row keys={<Show when={name()} fallback={<span class="pl-help-hold">no key yet</span>}><Keycap name={name()} /></Show>}>{binding.label}</Row>;
          }}</For>
        </ul></Section>
      </Show>
      </div>
      <div class="pl-help-col">
      <Section title="Looking" area="help-look"><ul class="pl-help-list" role="list">
        <Row keys={<Keycap name="Mouse" />}>Look around</Row>
        <Row keys={<Keycap name="Wheel" />}>Zoom, in third person</Row>
        <Row keys={cap('view')}>First or third person</Row>
      </ul></Section>
      <Section title="This ledger" area="help-ledger"><ul class="pl-help-list" role="list">
        <Row keys={<><Keycap name="Esc" />{cap('ledger')}</>}>Open and close this ledger</Row>
        <Row keys={<Keycap name="Click" />}>Back to the street: the mouse is yours again</Row>
        <Show when={props.cursor().canFullscreen}><Row keys={cap('fullscreen')}>Fullscreen</Row></Show>
        <Show when={props.cursor().canFullscreen && props.cursor().canLockKeyboard}>
          <Row keys={<><Keycap name="Esc" /><span class="pl-help-hold">hold</span></>}>Leave fullscreen</Row>
        </Show>
      </ul></Section>
      </div>
    </Show>
  </div>;
}

/* ---------------------------------------------------------------- Registered pages */

/** A page from another lane, mounted into its own host and disposed when the reader turns away or closes. */
export function ProviderPage(props: { provider: LedgerPageProvider; ctx: PlayContext }): JSX.Element {
  let host!: HTMLDivElement;
  let failed = false;
  onMount(() => {
    let dispose: (() => void) | undefined;
    try { dispose = props.provider.mount(host, props.ctx); } catch (error) {
      failed = true;
      console.error(`The ledger page ${props.provider.id} could not open`, error);
      host.replaceChildren(Object.assign(document.createElement('p'), { className: 'pl-lead', textContent: 'This page could not be opened just now. Close the ledger and open it again.' }));
    }
    onCleanup(() => { if (failed) return; try { dispose?.(); } catch (error) { console.error(`The ledger page ${props.provider.id} could not close`, error); } });
  });
  return <div ref={element => { host = element; }} class="pl-provider" data-provider={props.provider.id} />;
}
