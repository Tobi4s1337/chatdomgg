import { For, Match, Switch } from 'solid-js';
import type { PreviewWorld } from '../data/preview';
import { ShieldIcon, StampIcon } from './marks';

/**
 * The map key: every mark the map draws, named in words beside the mark itself, so nothing on the paper needs a
 * hover to be understood. Marks are drawn from the map's own stamps and arms where they exist, the rest in the same
 * engraved hand. Pigment is kept for what is live.
 */
export const KEY_ITEMS = [
  { id: 'holding', name: 'Channel', line: 'Its arms and name. A bigger town is a bigger audience.' },
  { id: 'live', name: 'Live now', line: 'A red pennant flies while the stream is on air.' },
  { id: 'glow', name: 'Live glow', line: 'The red wash deepens where many streams are live.' },
  { id: 'waiting', name: 'Pencilled in', line: 'Found on Twitch, waiting for land of its own.' },
  { id: 'kingdom', name: 'Chatdom kingdom', line: 'Founded in Chatdom by its streamer.' },
  { id: 'realms', name: 'Lands and realms', line: 'Each land is a language; its realms are what they play.' },
  { id: 'road', name: 'Road', line: 'Inked by raids between channels; dotted once unused.' },
] as const;
export type KeyItem = (typeof KEY_ITEMS)[number];

/** Arms drawn in the key: a fixed channel ID, so the key looks the same on every visit. */
const KEY_ARMS = '23161357';
const KINGDOM_ARMS = '40961027';

function KeyMark(props: { kind: KeyItem['id'] }) {
  return (
    <span class="atlas-key-mark" data-atlas-key-mark={props.kind} aria-hidden="true">
      <Switch>
        <Match when={props.kind === 'holding'}>
          <StampIcon group="town" index={1} width={30} />
          <ShieldIcon channelId={KEY_ARMS} width={10} />
        </Match>
        <Match when={props.kind === 'kingdom'}>
          <StampIcon group="village" index={2} width={24} />
          <ShieldIcon channelId={KINGDOM_ARMS} width={10} />
        </Match>
        <Match when={props.kind === 'live'}>
          <svg class="atlas-key-glyph" viewBox="0 0 40 40">
            <path d="M15 34V8" />
            <path class="atlas-key-pennant" d="M15.4 9c5 1.6 9-1.6 15 .8l-3.4 3.6 3.4 3.6c-6-2.2-10 1-15-.6z" />
            <path class="atlas-key-shield" d="M9 22h12v6c0 4-3 6-6 7.5C12 34 9 32 9 28z" />
          </svg>
        </Match>
        <Match when={props.kind === 'glow'}>
          <svg class="atlas-key-glyph" viewBox="0 0 40 40">
            <ellipse class="atlas-key-pigment" cx="20" cy="21" rx="16" ry="11" />
            <ellipse class="atlas-key-pigment" cx="17" cy="20" rx="8" ry="5.5" />
          </svg>
        </Match>
        <Match when={props.kind === 'waiting'}>
          <svg class="atlas-key-glyph" viewBox="0 0 40 40">
            <path class="atlas-key-graphite" d="M14 35V7" />
            <path class="atlas-key-graphite atlas-key-hatch" d="M14.4 8l13 .9-3.2 3.5 3.2 3.4-13 .6z" />
            <path class="atlas-key-graphite" d="M9 35.5h10" />
          </svg>
        </Match>
        <Match when={props.kind === 'realms'}>
          <span class="atlas-key-swatch" data-kind="realms" />
        </Match>
        <Match when={props.kind === 'road'}>
          <svg class="atlas-key-glyph" viewBox="0 0 40 40">
            <path d="M4 16c7 0 8-7 15-7s8 7 17 2" />
            <circle cx="4.5" cy="16" r="2.2" /><circle cx="35" cy="11" r="2.2" />
            <path class="atlas-key-dotted" d="M4 31c7 0 8-7 15-7s8 7 17 2" />
          </svg>
        </Match>
      </Switch>
    </span>
  );
}

/** The labelled key, as a list: each mark with its name and one line. */
export function LegendBody(props: { world: PreviewWorld }) {
  void props.world;
  return (
    <ul class="atlas-key-list" aria-label="What the marks mean">
      <For each={KEY_ITEMS}>{(item) => (
        <li data-atlas-key-item={item.id}>
          <KeyMark kind={item.id} />
          <span class="atlas-key-words">
            <span class="atlas-key-name">{item.name}</span>
            <span class="atlas-key-line">{item.line}</span>
          </span>
        </li>
      )}</For>
    </ul>
  );
}
