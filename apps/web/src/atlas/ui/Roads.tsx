import { createEffect, For, Match, onCleanup, Show, Switch } from 'solid-js';
import type { ChannelFace } from '../data/directory';
import type { ChannelRoads, RoadEntry, RoadStory } from '../data/roads';
import type { PreviewWorld } from '../data/preview';
import { roadRest, roadSilence, roadStory, roadWays } from '../road/story';
import { formatCount, formatMoment } from './format';
import { faceName, PlaceMark, ShareButton, type RegisterState } from './Register';

/** Roads a card lists by name; the map draws all of them. */
export const CARD_ROAD_ROWS = 4;

const raidsOf = (road: RoadEntry) => road.sent + road.received;

/**
 * A kingdom's roads on its card, from the road ledger: the strongest few by name with their stories, and how many
 * more the map draws. Following one opens the road; a channel with none yet says since when the watch has looked.
 */
export function LedgerRoads(props: { reply: ChannelRoads; onRoad: (road: RoadEntry) => void }) {
  const shown = () => props.reply.roads.slice(0, CARD_ROAD_ROWS);
  return (
    <section class="atlas-roads" aria-labelledby="atlas-roads-title" data-atlas-roads={props.reply.total}>
      <h3 id="atlas-roads-title">
        Roads
        <Show when={props.reply.total > 0}><span class="atlas-quiet"> · {formatCount(props.reply.total)}</span></Show>
      </h3>
      <Show when={shown().length > 0} fallback={<p class="atlas-roads-empty">{roadSilence(props.reply.since, undefined, 'to or from this channel')}.</p>}>
        <ul class="atlas-road-list">
          <For each={shown()}>
            {(road) => (
              <li>
                <button type="button" class="atlas-road" on:click={() => props.onRoad(road)}
                  aria-label={`Road with ${faceName(road.other)}: ${roadStory({ raids: raidsOf(road), firstAt: road.firstAt, lastAt: road.lastAt, basis: road.basis })}`}>
                  <PlaceMark face={road.other} size={24} />
                  <span class="atlas-road-text">
                    <span class="atlas-road-name" classList={{ 'atlas-card-unnamed': !road.other.name }} dir="auto">{faceName(road.other)}</span>
                    <span class="atlas-road-tally">
                      {roadStory({ raids: raidsOf(road), firstAt: road.firstAt, lastAt: road.lastAt, basis: road.basis })}
                      <span class="atlas-quiet"> · {roadWays(road.sent, road.received)}</span>
                    </span>
                    <Show when={roadRest(road.lastAt)}>{(rest) => <span class="atlas-road-tally atlas-quiet">{rest()}</span>}</Show>
                  </span>
                  <svg class="atlas-road-go" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>
                </button>
              </li>
            )}
          </For>
        </ul>
        <Show when={props.reply.total > shown().length}>
          <p class="atlas-roads-source">{formatCount(props.reply.total - shown().length)} more drawn on the map.</p>
        </Show>
      </Show>
    </section>
  );
}

function useCloseKeys(key: () => unknown, onClose: () => void): (element: HTMLButtonElement) => void {
  let close: HTMLButtonElement | undefined;
  createEffect(() => {
    void key();
    queueMicrotask(() => close?.focus({ preventScroll: true }));
  });
  const onKey = (event: KeyboardEvent) => {
    const map = close?.closest('[data-chatdom-atlas]');
    if (map && event.target instanceof Node && !map.contains(event.target)) return;
    if (event.key === 'Escape') onClose();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
  return (element) => (close = element);
}

/**
 * A road's own card: its story ("7 raids since 30 October"), each way, the last few raids, and a way to follow the road
 * to either end. Two channels with no witnessed raid still open, and say since when the watch has looked.
 */
export function RoadStoryCard(props: {
  state: RegisterState<RoadStory>;
  world: PreviewWorld;
  onClose: () => void;
  onFollow: (face: ChannelFace) => void;
  onRetry: () => void;
}) {
  const story = () => (props.state.status === 'ready' ? props.state.reply : null);
  const close = useCloseKeys(() => (story() ? `${story()!.a.id}:${story()!.b.id}` : props.state.status), props.onClose);
  const total = (s: RoadStory) => (s.aToB?.raids ?? 0) + (s.bToA?.raids ?? 0);
  const share = () => {
    const s = story();
    return s && s.a.login && s.b.login ? `/map/road/${s.a.login}/${s.b.login}` : null;
  };
  const way = (tally: { raids: number; travellers: number } | null) => (tally && tally.raids > 0
    ? `${formatCount(tally.raids)} ${tally.raids === 1 ? 'raid' : 'raids'} · ${formatCount(tally.travellers)} ${tally.travellers === 1 ? 'traveller' : 'travellers'}`
    : 'None seen');
  return (
    <section class="atlas-card" aria-labelledby="atlas-card-title" data-kind="road">
      <button ref={close} class="atlas-card-close" type="button" on:click={() => props.onClose()} aria-label="Close card">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
      </button>
      <Switch>
        <Match when={story()}>
          {(s) => (
            <>
              <header class="atlas-road-head">
                <p class="atlas-card-status">Road</p>
                <div class="atlas-road-ends">
                  <PlaceMark face={s().a} size={40} />
                  <svg class="atlas-road-ink" data-pen={s().basis === 'none' ? 'pencil' : 'ink'} viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true"><path d="M4 16C30 4 48 22 70 11S104 6 116 12" /></svg>
                  <PlaceMark face={s().b} size={40} />
                </div>
                <h2 id="atlas-card-title">
                  <span dir="auto" classList={{ 'atlas-card-unnamed': !s().a.name }}>{faceName(s().a)}</span>
                  <span class="atlas-road-and"> and </span>
                  <span dir="auto" classList={{ 'atlas-card-unnamed': !s().b.name }}>{faceName(s().b)}</span>
                </h2>
                <p class="atlas-road-story" data-atlas-road-story="true">
                  {s().basis === 'none' ? roadSilence(s().since) : roadStory({ raids: total(s()), firstAt: s().firstAt, lastAt: s().lastAt, basis: s().basis })}
                </p>
                <Show when={roadRest(s().lastAt)}>{(rest) => <p class="atlas-quiet atlas-road-rest">{rest()} · drawn dotted until it is used again</p>}</Show>
              </header>
              <div class="atlas-card-scroll" tabindex="0" aria-label="Road details">
                <dl class="atlas-card-facts">
                  <div><dt>{`To ${faceName(s().b)}`}</dt><dd classList={{ 'atlas-quiet': !s().aToB?.raids }}>{way(s().aToB)}</dd></div>
                  <div><dt>{`To ${faceName(s().a)}`}</dt><dd classList={{ 'atlas-quiet': !s().bToA?.raids }}>{way(s().bToA)}</dd></div>
                </dl>
                <Show when={s().recent.length > 0}>
                  <section class="atlas-roads" aria-labelledby="atlas-road-recent">
                    <h3 id="atlas-road-recent">Last raids</h3>
                    <ul class="atlas-road-recent">
                      <For each={s().recent}>
                        {(raid) => (
                          <li>
                            <span>{formatMoment(raid.at)}</span>
                            <span class="atlas-quiet"> · to {faceName(raid.from === s().a.id ? s().b : s().a)} · {formatCount(raid.viewers)} {raid.viewers === 1 ? 'traveller' : 'travellers'}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>
                <Show when={s().basis === 'at-least'}>
                  <p class="atlas-card-note">Part of this count comes from the raid watch’s totals before each raid was kept one by one, so it is a floor.</p>
                </Show>
              </div>
              <div class="atlas-road-open">
                <For each={[s().b, s().a].filter((face) => face.place !== 'unseen')}>
                  {(face) => (
                    <button type="button" class="atlas-road" on:click={() => props.onFollow(face)}>
                      <PlaceMark face={face} size={22} />
                      <span class="atlas-road-text"><span class="atlas-road-tally">Follow the road to</span><span class="atlas-road-name" dir="auto">{faceName(face)}</span></span>
                      <svg class="atlas-road-go" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>
                    </button>
                  )}
                </For>
              </div>
              <Show when={share()}>{(path) => <div class="atlas-card-actions"><ShareButton path={path()} title={`${s().a.name} and ${s().b.name} on the Atlas of Kingdoms`} /></div>}</Show>
            </>
          )}
        </Match>
        <Match when={props.state.status === 'loading'}>
          <p class="atlas-card-status">Road</p>
          <p class="atlas-register-wait" role="status">
            <svg class="atlas-search-quill" viewBox="0 0 120 14" aria-hidden="true"><path d="M3 9c12-7 20 3 30-2s14-8 23-3 15 5 23 1 15-7 24-2 11 4 14 2" /></svg>
            Reading the road…
          </p>
        </Match>
        <Match when={props.state.status === 'missing'}>
          <p class="atlas-card-status">Road</p>
          <h2 id="atlas-card-title">This road is not on the map</h2>
          <p class="atlas-card-note">One of its channels is not drawn on this map under that name.</p>
        </Match>
        <Match when={true}>
          <p class="atlas-card-status">Road</p>
          <h2 id="atlas-card-title">The road could not be read</h2>
          <p class="atlas-card-note">The Atlas service did not answer just now. The map is unchanged.</p>
          <button type="button" class="atlas-button" on:click={() => props.onRetry()}>Read again</button>
        </Match>
      </Switch>
    </section>
  );
}

export function isRoadEntry(road: unknown): road is RoadEntry {
  return typeof road === 'object' && road !== null && 'basis' in road;
}
