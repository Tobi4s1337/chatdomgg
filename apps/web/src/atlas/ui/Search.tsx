import { createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { DirectoryError, fetchSearch, type SearchReply, type SearchResult } from '../data/directory';
import { findOpenKingdom, matchFoundedChannel, readOpenKingdoms } from '../data/open-kingdoms';
import type { OpenKingdom } from '@chatdom/ui/site';
import type { PreviewSource, PreviewWorld } from '../data/preview';
import { mapNoun } from './edition';
import { formatCount, SEARCH_PLACEHOLDER, TIER_NAMES } from './format';
import { ChannelFaceSeal } from './Face';

type Phase =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string }
  | { kind: 'results'; query: string; reply: SearchReply }
  | { kind: 'failed'; query: string; reason: DirectoryError['reason'] };

/** Wait for a typing pause so ordinary keystrokes do not spend the external lookup allowance. Enter asks immediately. */
const DEBOUNCE_MS = 500;
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
  /** The signed-in broadcaster's own hidden channel when the query names it: only they see it, first in the list. */
  own?: ((query: string) => SearchResult | null) | undefined;
}) {
  let input: HTMLInputElement | undefined;
  let wrapper: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let lastSeed = 0;
  let selectionFrame: number | undefined;
  const [pressed, setPressed] = createSignal<string | null>(null);
  const cancelSelection = () => {
    if (selectionFrame !== undefined) cancelAnimationFrame(selectionFrame);
    selectionFrame = undefined;
    setPressed(null);
  };
  const [text, setText] = createSignal('');
  const [phase, setPhase] = createSignal<Phase>({ kind: 'idle' });
  // A name the register does not know may still be a kingdom chatdom.io opens (founded before the survey saw it).
  const [openKingdom, setOpenKingdom] = createSignal<{ query: string; kingdomId: string; name: string; login: string } | null>(null);
  createEffect(() => {
    const now = phase();
    if (now.kind !== 'results' || now.reply.results.length) { setOpenKingdom(null); return; }
    const query = now.query;
    void findOpenKingdom(query).then(kingdom => { if (phase() === now) setOpenKingdom(kingdom ? { query, ...kingdom } : null); });
  });
  // A channel the survey has not given land may still have a founded kingdom: its row says so, like its card.
  const [founded, setFounded] = createSignal<readonly OpenKingdom[]>([]);
  onMount(() => { void readOpenKingdoms().then(setFounded); });
  const [showSearching, setShowSearching] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);

  const results = () => {
    const current = phase();
    if (current.kind !== 'results') return [];
    const own = props.own?.(current.query) ?? null;
    return own && !current.reply.results.some((result) => result.channel.id === own.channel.id) ? [own, ...current.reply.results] : current.reply.results;
  };
  const isOwn = (result: SearchResult) => props.own?.(phase().kind === 'results' ? (phase() as { query: string }).query : '')?.channel.id === result.channel.id;

  const ask = (query: string) => {
    cancelSelection();
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
    cancelSelection();
    setText(value);
    controller?.abort();
    controller = null;
    clearTimeout(quiet);
    clearTimeout(retry);
    clearTimeout(timer);
    timer = setTimeout(() => ask(value), DEBOUNCE_MS);
  };

  const choose = (result: SearchResult | undefined) => {
    if (!result || selectionFrame !== undefined) return;
    setPressed(result.channel.id);
    // Paint the real row's pressed wax before selection relays out a dense still or reads a region.
    // Both frames belong to this search and are cancelled if its query, focus or owner changes.
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = requestAnimationFrame(() => {
        selectionFrame = undefined;
        setOpen(false);
        setPressed(null);
        props.onChoose(result);
      });
    });
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
      if (current.kind === 'results' && current.query === text() && list.length) choose(list[active()]);
      else ask(text());
    } else if (event.key === 'Escape') {
      cancelSelection();
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
    cancelSelection();
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

  const place = (result: SearchResult) => {
    const region = props.world.regions[result.channel.region ?? -1];
    const realm = props.world.realms[result.channel.realm ?? -1];
    const land = region ? (region.kind === 'continent' && realm ? `${realm.name} · ${region.name}` : region.name) : null;
    if (result.channel.place === 'mapped') return [TIER_NAMES[result.channel.tier ?? 3], land].filter(Boolean).join(' · ');
    const kingdom = result.channel.login ? matchFoundedChannel(founded(), result.channel.login) : null;
    return [kingdom ? `Founded · ${kingdom.name}` : 'No land yet', land].filter(Boolean).join(' · ');
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
        if (!next || !wrapper?.contains(next)) { cancelSelection(); setOpen(false); }
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
          placeholder={SEARCH_PLACEHOLDER}
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
                      data-atlas-press={pressed() === result.channel.id ? 'true' : undefined}
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
                          <Show when={isOwn(result)}><span class="atlas-search-own">Hidden by you · </span></Show>
                          <Show when={!isOwn(result) && props.onAir(result)}><span class="atlas-search-air">On air · </span></Show>
                          {place(result)}<Show when={result.average !== null}> · {formatCount(result.average!)} avg.</Show>
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
                <p>“<span dir="auto">{(phase() as { query: string }).query.trim()}</span>” is not on the map yet.</p>
                <Show when={openKingdom()}>{kingdom => <>
                  <p>{kingdom().name}, {kingdom().login}’s kingdom, is open all the same.</p>
                  <a class="atlas-search-away atlas-search-door" href={`/kingdom/${encodeURIComponent(kingdom().kingdomId)}`}>Enter {kingdom().name}</a>
                </>}</Show>
                <Show when={(phase() as { reply: SearchReply }).reply.unavailable === 'limited' || (phase() as { reply: SearchReply }).reply.unavailable === 'upstream'}>
                  <p class="atlas-quiet">Try again in a moment.</p>
                  <button type="button" class="atlas-search-retry" on:click={() => ask(text())}>Search again</button>
                </Show>
                <a class="atlas-search-away" href={`https://www.twitch.tv/search?term=${encodeURIComponent((phase() as { query: string }).query.trim())}`} target="_blank" rel="noopener noreferrer">
                  Look for it on Twitch<span class="atlas-visually-hidden"> (opens twitch.tv in a new tab)</span>
                </a>
              </div>
            </Match>
            <Match when={phase().kind === 'failed'}>
              <div class="atlas-search-state" role="status">
                <Switch>
                  <Match when={(phase() as { reason: string }).reason === 'warming'}>
                    <p>The register of this {mapNoun(props.world)} is still being opened; asking again in a moment…</p>
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
