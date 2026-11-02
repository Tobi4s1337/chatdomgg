import { createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';
import type { DirectoryError } from '../data/directory';
import type { FinderEntry, FinderGroupKind, FinderReply } from '../data/roads';
import { ChannelFaceSeal } from '../ui/Face';
import { formatCount, formatTime } from '../ui/format';
import { faceName } from '../ui/Register';
import { roadSilence } from '../road/story';
import { selectable } from './select';
import './finder.css';

export type FinderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; reply: FinderReply }
  | { status: 'failed'; reason: DirectoryError['reason'] };

const GROUP_TITLES: Record<FinderGroupKind, string> = {
  roads: 'Along your roads',
  realm: 'Your realm',
  neighbours: 'Neighbouring realms',
  search: 'Any live channel',
};

const EMPTY: Record<Exclude<FinderGroupKind, 'search'>, string> = {
  roads: 'No one along your roads is live right now.',
  realm: 'No one else in your realm is live right now.',
  neighbours: 'No one in the neighbouring realms is live right now.',
};

/** What a row says under the name: what they play, how many watch, and the road you share. */
function entryLine(entry: FinderEntry): string {
  const parts: string[] = [];
  if (entry.game) parts.push(entry.game);
  if (entry.live && entry.viewers !== null) parts.push(`${formatCount(entry.viewers)} watching`);
  else if (entry.live && entry.size !== null) parts.push(`about ${formatCount(entry.size)} viewers`);
  if (entry.roads) parts.push(`${formatCount(entry.roads.raids)} ${entry.roads.raids === 1 ? 'raid' : 'raids'} together`);
  if (!entry.live) parts.push('offline now');
  return parts.join(' · ');
}

export { selectable };

/**
 * The Raid Gate's finder (SEAMS §2): live friends along existing roads first, then live channels in the same and the
 * neighbouring realms, then any live Twitch channel by name, smaller channels first inside each group. Nothing paid
 * or sponsored exists anywhere in its order. It only proposes: the Raid Gate's authority decides who may raid.
 */
export function FinderBoard(props: {
  state: FinderState;
  search: FinderState;
  picked: string | null;
  onSearch: (query: string) => void;
  onPick: (entry: FinderEntry) => void;
  onPreview: (entry: FinderEntry | null) => void;
  onClose: () => void;
  onRetry: () => void;
  /** The source's own roads, once read: with none yet, the first group says since when the watch has looked. */
  sourceRoads?: { total: number; since: number } | null;
}) {
  const [query, setQuery] = createSignal('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const type = (value: string) => {
    setQuery(value);
    clearTimeout(timer);
    timer = setTimeout(() => props.onSearch(value.trim()), value.trim() ? 260 : 0);
  };
  const reply = () => (props.state.status === 'ready' ? props.state.reply : null);
  const proposals = () => reply()?.groups.filter(group => group.kind !== 'search') ?? [];
  const found = () => (props.search.status === 'ready' ? props.search.reply.groups.find(group => group.kind === 'search')?.entries ?? [] : []);
  return (
    <section class="atlas-finder cd-plate" aria-labelledby="atlas-finder-title" data-atlas-chrome="finder" data-state={props.state.status}>
      <header class="atlas-finder-head">
        <p class="atlas-finder-eyebrow cd-label">Raid Gate</p>
        <h2 id="atlas-finder-title" class="atlas-finder-title">Where will the raid ride?</h2>
        <button type="button" class="atlas-finder-close" on:click={() => props.onClose()} aria-label="Close the finder">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </header>
      <div class="atlas-finder-sheet">
        <label class="atlas-finder-search">
          <span class="atlas-visually-hidden">Find any live Twitch channel</span>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4.5 4.5" /></svg>
          <input type="search" placeholder="Any live channel" autocomplete="off" spellcheck={false} maxlength={120}
            value={query()} on:input={(event) => type(event.currentTarget.value)} />
        </label>
        <div class="atlas-finder-scroll" tabindex="-1">
          <Show when={query().trim()}>
            <FinderGroup title={GROUP_TITLES.search} entries={found()} picked={props.picked} onPick={props.onPick} onPreview={props.onPreview}
              empty={props.search.status === 'loading' ? 'Asking the register…' : props.search.status === 'failed' ? 'The register did not answer just now.'
                : props.search.status === 'ready' && props.search.reply.unavailable ? 'Twitch cannot be asked just now; channels already on the map still answer.' : `No live channel called “${query().trim()}”.`} />
          </Show>
          <Switch>
            <Match when={props.state.status === 'loading' || props.state.status === 'idle'}>
              <p class="atlas-finder-wait" role="status">
                <svg class="atlas-search-quill" viewBox="0 0 120 14" aria-hidden="true"><path d="M3 9c12-7 20 3 30-2s14-8 23-3 15 5 23 1 15-7 24-2 11 4 14 2" /></svg>
                Looking along your roads…
              </p>
            </Match>
            <Match when={props.state.status === 'failed'}>
              <p class="atlas-finder-empty" role="status">The finder could not be read just now. <button type="button" class="atlas-link-button" on:click={() => props.onRetry()}>Read again</button></p>
            </Match>
            <Match when={reply()}>
              <For each={proposals()}>
                {(group) => (
                  <FinderGroup title={GROUP_TITLES[group.kind]} entries={group.entries} picked={props.picked} onPick={props.onPick} onPreview={props.onPreview}
                    empty={group.kind === 'roads' && props.sourceRoads?.total === 0
                      ? `${roadSilence(props.sourceRoads.since, undefined, 'to or from your channel')}; your first raid draws one.`
                      : EMPTY[group.kind as Exclude<FinderGroupKind, 'search'>]} />
                )}
              </For>
            </Match>
          </Switch>
        </div>
        <Show when={reply()?.liveAsOf}>{(at) => <p class="atlas-finder-foot">On air as of {formatTime(at())} · smaller channels first</p>}</Show>
      </div>
    </section>
  );
}

function FinderGroup(props: {
  title: string;
  entries: FinderEntry[];
  picked: string | null;
  empty: string;
  onPick: (entry: FinderEntry) => void;
  onPreview: (entry: FinderEntry | null) => void;
}) {
  return (
    <section class="atlas-finder-group">
      <h3 class="cd-label">{props.title}</h3>
      <Show when={props.entries.length > 0} fallback={<p class="atlas-finder-empty">{props.empty}</p>}>
        <ul>
          <For each={props.entries}>
            {(entry) => (
              <li>
                <button
                  type="button"
                  class="atlas-finder-row"
                  data-live={entry.live ? 'true' : 'false'}
                  aria-pressed={props.picked === entry.channel.id}
                  disabled={!selectable(entry)}
                  on:click={() => props.onPick(entry)}
                  on:pointerenter={() => props.onPreview(entry)}
                  on:pointerleave={() => props.onPreview(null)}
                  on:focus={() => props.onPreview(entry)}
                  on:blur={() => props.onPreview(null)}
                >
                  <ChannelFaceSeal channelId={entry.channel.id} name={entry.channel.name} portrait={entry.portrait ?? null} compact />
                  <span class="atlas-finder-text">
                    <span class="atlas-finder-name" dir="auto" classList={{ 'atlas-card-unnamed': !entry.channel.name }}>{faceName(entry.channel)}</span>
                    <span class="atlas-finder-line">{entryLine(entry)}</span>
                  </span>
                  <Show when={props.picked === entry.channel.id} fallback={<Show when={entry.live}><span class="atlas-finder-air" aria-label="On air" /></Show>}>
                    <span class="atlas-finder-chosen cd-label">Chosen</span>
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
