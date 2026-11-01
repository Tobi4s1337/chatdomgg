import { createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { DirectoryError, fetchSearch, type SearchReply, type SearchResult } from '../data/directory';
import type { PreviewSource, PreviewWorld } from '../data/preview';
import { formatCount, formatDayRange, TIER_NAMES } from './format';
import { ChannelFaceSeal } from './Face';

type Phase =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string }
  | { kind: 'results'; query: string; reply: SearchReply }
  | { kind: 'failed'; query: string; reason: DirectoryError['reason'] };

/** A keystroke waits this long for the next before the register is asked. */
const DEBOUNCE_MS = 170;
/** A search answered sooner than this shows no "searching" line at all, so fast answers never flicker. */
const QUIET_MS = 280;

/**
 * Find a channel by its Twitch login or display name, in any script (Spec 01 R17). The register answers named
 * channels only, best match first; choosing one flies the map to it and opens its card. Every state has its own
 * words: searching, nothing found (with a way on to Twitch's own search), the register still being read, names held
 * back, or the service unreachable with a retry. Keys: `/` focuses, arrows choose, Enter opens, Escape closes the
 * list and then clears.
 */
export function Search(props: {
  keyboardRoot?: HTMLElement;
  source: PreviewSource;
  world: PreviewWorld;
  /** Whether a result is on air in the live frame shown now. */
  onAir: (result: SearchResult) => boolean;
  onChoose: (result: SearchResult) => void;
  /** Text to search for, set by the page (a route that found nothing hands its login here). */
  seed?: { text: string; at: number } | null;
}) {
  let input: HTMLInputElement | undefined;
  let wrapper: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let lastSeed = 0;
  const [text, setText] = createSignal('');
  const [phase, setPhase] = createSignal<Phase>({ kind: 'idle' });
  const [showSearching, setShowSearching] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);

  const results = () => {
    const current = phase();
    return current.kind === 'results' ? current.reply.results : [];
  };

  const ask = (query: string) => {
    controller?.abort();
    clearTimeout(quiet);
    clearTimeout(retry);
    if (!query.trim()) {
      setPhase({ kind: 'idle' });
      setOpen(false);
      return;
    }
    const mine = new AbortController();
    controller = mine;
    setPhase({ kind: 'searching', query });
    setShowSearching(false);
    quiet = setTimeout(() => setShowSearching(true), QUIET_MS);
    setOpen(true);
    fetchSearch(props.source, props.world.id, query, mine.signal).then((reply) => {
      if (controller !== mine) return;
      clearTimeout(quiet);
      setActive(0);
      setPhase({ kind: 'results', query, reply });
    }, (error: unknown) => {
      if (controller !== mine || (error as Error).name === 'AbortError') return;
      clearTimeout(quiet);
      const reason = error instanceof DirectoryError ? error.reason : 'unavailable';
      setPhase({ kind: 'failed', query, reason });
      // A register still being read answers in a moment: ask again by itself, as it said.
      if (error instanceof DirectoryError && error.reason === 'warming') retry = setTimeout(() => ask(query), error.retryAfter * 1000);
    });
  };

  const onInput = (value: string) => {
    setText(value);
    clearTimeout(timer);
    timer = setTimeout(() => ask(value), DEBOUNCE_MS);
  };

  const choose = (result: SearchResult | undefined) => {
    if (!result) return;
    setOpen(false);
    props.onChoose(result);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const list = results();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open() && text().trim()) setOpen(true);
      if (list.length) setActive((active() + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(timer);
      const current = phase();
      // Enter before the answer arrives asks now; with an answer it opens the chosen result.
      if (current.kind === 'results' && current.query === text()) choose(list[active()]);
      else ask(text());
    } else if (event.key === 'Escape') {
      // The search is the top surface while its list is open: Escape belongs to it, not to a card beneath.
      event.stopPropagation();
      event.preventDefault();
      if (open()) setOpen(false);
      else if (text()) onInput('');
      else input?.blur();
    }
  };

  // `/` opens the search from anywhere on the map, unless the reader is typing elsewhere.
  const onWindowKey = (event: KeyboardEvent) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
    event.preventDefault();
    input?.focus();
    input?.select();
  };
  onMount(() => (props.keyboardRoot ?? window).addEventListener('keydown', onWindowKey as EventListener));
  onCleanup(() => {
    (props.keyboardRoot ?? window).removeEventListener('keydown', onWindowKey as EventListener);
    clearTimeout(timer);
    clearTimeout(quiet);
    clearTimeout(retry);
    controller?.abort();
  });

  // A page-supplied seed (a route that found nothing) fills the field and asks at once.
  createEffect(() => {
    const seed = props.seed;
    if (!seed || seed.at === lastSeed) return;
    lastSeed = seed.at;
    setText(seed.text);
    ask(seed.text);
    queueMicrotask(() => input?.focus({ preventScroll: true }));
  });

  const survey = () => formatDayRange(props.world.window.firstObservationAt, props.world.window.lastObservationAt);
  const place = (result: SearchResult) => {
    const region = props.world.regions[result.channel.region ?? -1];
    const realm = props.world.realms[result.channel.realm ?? -1];
    const land = region ? (region.kind === 'continent' && realm ? `${realm.name} · ${region.name}` : region.name) : null;
    if (result.channel.place === 'mapped') return [TIER_NAMES[result.channel.tier ?? 3], land].filter(Boolean).join(' · ');
    return ['No land yet', land].filter(Boolean).join(' · ');
  };

  return (
    <div
      ref={(element) => (wrapper = element)}
      class="atlas-search"
      data-open={open() ? 'true' : 'false'}
      data-phase={phase().kind === 'results' ? (results().length ? 'results' : 'none') : phase().kind === 'failed' ? (phase() as { reason: string }).reason : phase().kind}
      on:focusout={(event) => {
        // Leaving the search (a tap on the map, Tab onwards) folds the list away; the text stays for later.
        const next = event.relatedTarget as Node | null;
        if (!next || !wrapper?.contains(next)) setOpen(false);
      }}
    >
      <label class="atlas-search-field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /></svg>
        <span class="atlas-visually-hidden">Find a channel</span>
        <input
          ref={(element) => (input = element)}
          type="search"
          dir="auto"
          inputmode="search"
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          maxLength={120}
          placeholder="Find a channel by name"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open()}
          aria-controls="atlas-search-results"
          aria-activedescendant={open() && results().length ? `atlas-search-result-${active()}` : undefined}
          value={text()}
          on:input={(event) => onInput(event.currentTarget.value)}
          on:keydown={onKeyDown}
          on:focus={() => {
            if (text().trim() && phase().kind !== 'idle') setOpen(true);
          }}
        />
        <Show when={!text()}><kbd class="atlas-search-key" aria-hidden="true">/</kbd></Show>
      </label>
      <Show when={open()}>
        <div class="atlas-search-panel" id="atlas-search-results">
          <Switch>
            <Match when={phase().kind === 'searching'}>
              <p class="atlas-search-state" role="status">
                <Show when={showSearching()} fallback={<span class="atlas-visually-hidden">Searching</span>}>
                  <svg class="atlas-search-quill" viewBox="0 0 120 14" aria-hidden="true"><path d="M3 9c12-7 20 3 30-2s14-8 23-3 15 5 23 1 15-7 24-2 11 4 14 2" /></svg>
                  Searching the register…
                </Show>
              </p>
            </Match>
            <Match when={phase().kind === 'results' && results().length > 0}>
              <ul class="atlas-search-list" role="listbox" aria-label="Channels found">
                <For each={results()}>
                  {(result, i) => (
                    <li
                      id={`atlas-search-result-${i()}`}
                      role="option"
                      aria-selected={i() === active()}
                      class="atlas-search-result"
                      data-place={result.channel.place}
                      on:pointerenter={() => setActive(i())}
                      on:pointerdown={(event) => event.preventDefault()}
                      on:click={() => choose(result)}
                    >
                      <ChannelFaceSeal channelId={result.channel.id} name={result.channel.name} portrait={result.portrait} compact />
                      <span class="atlas-search-text">
                        <span class="atlas-search-name" dir="auto">
                          {result.channel.name}
                          <Show when={result.channel.login && result.channel.name!.toLowerCase() !== result.channel.login}>
                            <span class="atlas-quiet atlas-search-login"> {result.channel.login}</span>
                          </Show>
                        </span>
                        <span class="atlas-search-place">
                          <Show when={props.onAir(result)}><span class="atlas-search-air">On air · </span></Show>
                          {place(result)} · {formatCount(result.average)} avg.
                        </span>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={phase().kind === 'results' && (phase() as { reply: SearchReply }).reply.more}>
                <p class="atlas-search-more">More channels match; type more of the name to narrow them.</p>
              </Show>
            </Match>
            <Match when={phase().kind === 'results'}>
              <div class="atlas-search-state" role="status">
                <p>No channel called “<span dir="auto">{(phase() as { query: string }).query.trim()}</span>” is in the survey of {survey()}.</p>
                <p class="atlas-quiet">Names are shown only for channels seen live within a day, and the survey sees streams from five viewers up.</p>
                <a class="atlas-search-away" href={`https://www.twitch.tv/search?term=${encodeURIComponent((phase() as { query: string }).query.trim())}`} target="_blank" rel="noopener noreferrer">
                  Look for it on Twitch<span class="atlas-visually-hidden"> (opens twitch.tv in a new tab)</span>
                </a>
              </div>
            </Match>
            <Match when={phase().kind === 'failed'}>
              <div class="atlas-search-state" role="status">
                <Switch>
                  <Match when={(phase() as { reason: string }).reason === 'warming'}>
                    <p>The register of this survey is still being opened; asking again in a moment…</p>
                  </Match>
                  <Match when={(phase() as { reason: string }).reason === 'refused'}>
                    <p>Channel names are held back just now while the map’s moderation list is checked. The map itself is unchanged.</p>
                  </Match>
                  <Match when={(phase() as { reason: string }).reason === 'bad-query'}>
                    <p>That is longer than any name the register searches. Try the first part of it.</p>
                  </Match>
                  <Match when={true}>
                    <p>The register could not be read just now. The map is unchanged.</p>
                    <button type="button" class="atlas-search-retry" on:click={() => ask(text())}>Search again</button>
                  </Match>
                </Switch>
              </div>
            </Match>
          </Switch>
        </div>
      </Show>
    </div>
  );
}
