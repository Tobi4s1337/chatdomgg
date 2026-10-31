import '../kit.css';
import './passport.css';
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch, type JSX } from 'solid-js';
import { ProvenanceSeal } from '../ProvenanceSeal';
import { CrestArms } from './Arms';
import { PassportStampMark } from './Stamp';
import { folio, initialOf, isoDay, longDate, monthSpan } from './format';
import { inkFor } from './ink';
import {
  DENSITY, buildLeaves, buildViews, sectionOfView, sectionTabs, shelfOf, viewCaption,
  type BookLayout, type Leaf, type PassportPage, type PassportShelf,
} from './pages';
import type { BondView, KeepsakeView, PassportCollection, StampView, VisiblePassportView, VisitView } from './types';

export interface PassportBookProps {
  /** A visible book that already passed the schema and the card's disclosure gate. */
  readonly book: VisiblePassportView;
  /** Loaded records per collection, when a reader has turned further than the first pages. */
  readonly shelf?: PassportShelf;
  /** Two facing pages (card page, bench) or one at a time (panel, phone). */
  readonly layout?: BookLayout;
  /** 0 is the closed cover; 1 opens on the flyleaf. */
  readonly initialView?: number;
  /** Ask the owner for the next page of one collection. Without it, the leaf says the history continues elsewhere. */
  readonly onMore?: (collection: PassportCollection) => void;
  /**
   * Kingdom names the surface already shows publicly beside the book, such as the card's disclosed homes. They let a
   * raid's road name where it began; the book's own records still name every kingdom they carry.
   */
  readonly places?: ReadonlyMap<string, string>;
  readonly class?: string;
}

const MORE_WORDS: Readonly<Record<PassportCollection, { title: string; action: string }>> = {
  stamps: { title: 'Older journeys are further back', action: 'Turn to older journeys' },
  kingdoms: { title: 'More kingdoms are written further back', action: 'Turn to more kingdoms' },
  bonds: { title: 'More bonds are written further back', action: 'Turn to more bonds' },
  keepsakes: { title: 'More keepsakes are tied in further back', action: 'Turn to more keepsakes' },
};

/**
 * The passport: a worn leather book with a stitched spine, brass corners and parchment leaves. It opens on its
 * cover, turns by buttons, thumb tabs, arrow keys and swipes, and keeps every fact as real text beside the inked
 * stamps. It never counts, ranks or infers; an empty book opens on a named flyleaf and room for the first journey.
 */
export function PassportBook(props: PassportBookProps): JSX.Element {
  const layout = () => props.layout ?? 'spread';
  const shelf = () => props.shelf ?? shelfOf(props.book);
  const leaves = createMemo(() => buildLeaves(props.book, shelf(), DENSITY[layout()]));
  const views = createMemo(() => buildViews(leaves(), layout()));
  const tabs = createMemo(() => sectionTabs(views()));
  const [view, setView] = createSignal(Math.max(0, props.initialView ?? 0));
  const [turn, setTurn] = createSignal<{ dir: 'next' | 'prev'; n: number } | null>(null);
  const current = () => views()[Math.min(view(), views().length - 1)];
  const at = () => Math.min(view(), views().length - 1);
  // A different holder is a different book: close it so nothing of the previous subject stays on the open page.
  createEffect(on(() => props.book.holder.personId, () => { setView(Math.max(0, props.initialView ?? 0)); setTurn(null); }, { defer: true }));
  // A layout change keeps the reader on the same leaf, not the same view number.
  let lastLayout = layout();
  createEffect(on(layout, next => {
    if (next === lastLayout) return;
    const leaf = current()?.kind === 'leaves' ? (current() as { leaves: readonly Leaf[] }).leaves[0]?.index ?? 0 : -1;
    lastLayout = next;
    if (leaf >= 0) setView(1 + (next === 'spread' ? Math.floor(leaf / 2) : leaf));
  }, { defer: true }));

  const go = (target: number) => {
    const clamped = Math.max(0, Math.min(views().length - 1, target));
    if (clamped === at()) return;
    setTurn({ dir: clamped > at() ? 'next' : 'prev', n: (turn()?.n ?? 0) + 1 });
    setView(clamped);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const keys: Record<string, () => number> = {
      ArrowRight: () => at() + 1, PageDown: () => at() + 1, ArrowLeft: () => at() - 1, PageUp: () => at() - 1,
      Home: () => 0, End: () => views().length - 1,
    };
    const target = keys[event.key];
    if (!target) return;
    event.preventDefault();
    go(target());
  };
  let swipe: { x: number; y: number; id: number } | null = null;
  const onPointerDown = (event: PointerEvent) => { if (event.pointerType !== 'mouse') swipe = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
  const onPointerUp = (event: PointerEvent) => {
    if (!swipe || swipe.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 44 && Math.abs(dy) < Math.abs(dx) * 0.6) go(at() + (dx < 0 ? 1 : -1));
  };

  const names = createMemo(() => {
    const known = new Map<string, string>(props.places ?? []);
    const s = shelf();
    for (const stamp of s.stamps.items) known.set(stamp.kingdom.kingdomId, stamp.kingdom.name);
    for (const visit of s.kingdoms.items) known.set(visit.kingdom.kingdomId, visit.kingdom.name);
    for (const keepsake of s.keepsakes.items) known.set(keepsake.kingdom.kingdomId, keepsake.kingdom.name);
    for (const bond of s.bonds.items) if (bond.with.kind === 'kingdom') known.set(bond.with.kingdom.kingdomId, bond.with.kingdom.name);
    return known;
  });
  const simulated = () => props.book.origin === 'simulated';
  const section = () => sectionOfView(current());

  return <section class={`pp-book cd-kit${props.class ? ` ${props.class}` : ''}`} data-layout={layout()} data-view={current()?.kind}
    aria-roledescription="passport" aria-label={`Passport of ${props.book.holder.name}`} onKeyDown={onKey}>
    <Show when={layout() === 'page' && current()?.kind === 'leaves'}>
      <nav class="pp-tabs pp-tabs-row" aria-label="Sections of the passport">
        <For each={tabs()}>{tab => <button type="button" class="pp-tab" aria-current={section() === tab.id ? 'true' : undefined}
          onClick={() => go(tab.view)}>{tab.label}</button>}</For>
      </nav>
    </Show>
    <div class="pp-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipe = null; }}>
      <Show when={current()?.kind === 'leaves' ? current() as { kind: 'leaves'; leaves: readonly Leaf[] } : undefined} fallback={
        <Cover book={props.book} simulated={simulated()} onOpen={() => go(1)} />
      }>{open => <div class="pp-case">
        <div class="pp-spread" data-count={open().leaves.length}>
          <For each={open().leaves}>{leaf => <Page leaf={leaf} total={leaves().length} names={names()} asOf={props.book.asOf}
            holder={props.book.holder.name} {...(props.onMore ? { onMore: props.onMore } : {})} />}</For>
          <Show when={turn()} keyed>{t => <div class="pp-leaf" data-dir={t.dir} aria-hidden="true" onAnimationEnd={() => setTurn(null)} />}</Show>
        </div>
        <Show when={layout() === 'spread'}>
          <nav class="pp-tabs pp-tabs-edge" aria-label="Sections of the passport">
            <For each={tabs()}>{tab => <button type="button" class="pp-tab" aria-current={section() === tab.id ? 'true' : undefined}
              onClick={() => go(tab.view)}>{tab.label}</button>}</For>
          </nav>
        </Show>
        <span class="pp-ribbon" aria-hidden="true" />
      </div>}</Show>
    </div>
    {/* The turn buttons are never disabled: a disabled button drops keyboard focus out of the book at either end. */}
    <div class="pp-controls">
      <button type="button" class="pp-turn" data-dir="prev" aria-disabled={at() === 0 ? 'true' : undefined} onClick={() => go(at() - 1)}
        aria-label={at() === 1 ? 'Close the passport' : 'Turn back a page'}><TurnGlyph dir="prev" /></button>
      <p class="pp-where" aria-live="polite" aria-atomic="true">{viewCaption(current(), leaves().length)}</p>
      <button type="button" class="pp-turn" data-dir="next" aria-disabled={at() >= views().length - 1 ? 'true' : undefined} onClick={() => go(at() + 1)}
        aria-label={at() === 0 ? 'Open the passport' : 'Turn the page'}><TurnGlyph dir="next" /></button>
    </div>
    <Show when={simulated() && current()?.kind === 'leaves'}>
      <ProvenanceSeal class="pp-provenance" state="simulated" detail="an illustrative passport" />
    </Show>
  </section>;
}

function TurnGlyph(props: { dir: 'next' | 'prev' }): JSX.Element {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" class="pp-turn-glyph">
    <path d={props.dir === 'next' ? 'M5 5.5c3.2-.9 6-.6 7 .4v12.6c-1-1-3.8-1.3-7-.4ZM12 5.9c1-1 3.8-1.3 7-.4v12.6c-3.2-.9-6-.6-7 .4' : 'M19 5.5c-3.2-.9-6-.6-7 .4v12.6c1-1 3.8-1.3 7-.4ZM12 5.9c-1-1-3.8-1.3-7-.4v12.6c3.2-.9 6-.6 7 .4'}
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
    <path d={props.dir === 'next' ? 'M14.2 12h3.4m-1.6-1.8 1.8 1.8-1.8 1.8' : 'M9.8 12H6.4m1.6-1.8L6.2 12 8 13.8'} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>;
}

/** The blind-tooled compass rose with a dashed road across it, pressed into every cover. */
export function CoverEmblem(): JSX.Element {
  return <svg class="pp-cover-emblem" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="50" fill="none" stroke-width="2.2" />
    <circle cx="60" cy="60" r="43" fill="none" stroke-width="1" stroke-dasharray="2 3.4" />
    <path d="M60 14v92M14 60h92" stroke-width="1" />
    <path d="M60 22l7 31 31 7-31 7-7 31-7-31-31-7 31-7Z" stroke-width="1.6" />
    <path d="M60 37l3 20 20 3-20 3-3 20-3-20-20-3 20-3Z" stroke-width="1" />
    <path d="M30 96c10-12 22-6 30-18s20-8 30-22" fill="none" stroke-width="1.6" stroke-dasharray="5 3.4" />
  </svg>;
}

/** The closed book: blind-tooled leather, the word PASSPORT in worn gilt, the holder's name tooled beneath. */
function Cover(props: { book: VisiblePassportView; simulated: boolean; onOpen: () => void }): JSX.Element {
  return <div class="pp-cover-wrap">
    <button type="button" class="pp-cover" onClick={() => props.onOpen()} aria-label={`Open the passport of ${props.book.holder.name}`}>
      <span class="pp-cover-tooling" aria-hidden="true" />
      <CoverEmblem />
      <span class="pp-cover-title">Passport</span>
      <span class="pp-cover-rule" aria-hidden="true" />
      <span class="pp-cover-name" dir="auto">{props.book.holder.name}</span>
      <span class="pp-cover-open" aria-hidden="true">Open the book</span>
    </button>
    <Show when={props.simulated}><ProvenanceSeal class="pp-provenance pp-provenance-cover" state="simulated" detail="an illustrative passport" /></Show>
  </div>;
}

interface PageProps { leaf: Leaf; total: number; names: ReadonlyMap<string, string>; asOf: number; holder: string; onMore?: (collection: PassportCollection) => void }

function Page(props: PageProps): JSX.Element {
  const side = () => (props.leaf.index % 2 === 0 ? 'left' : 'right');
  const page = () => props.leaf.page;
  const of = <K extends PassportPage['kind']>(kind: K) => (page().kind === kind ? page() as Extract<PassportPage, { kind: K }> : undefined);
  return <article class="pp-page" data-side={side()} data-kind={page().kind} aria-label={`Page ${props.leaf.index + 1}`}>
    <div class="pp-page-body">
      <Switch>
        <Match when={of('flyleaf')}>{flyleaf => <Flyleaf holder={flyleaf().holder.name} empty={flyleaf().empty} asOf={props.asOf} />}</Match>
        <Match when={of('invitation')}><Invitation /></Match>
        <Match when={of('stamps')}>{p => <StampsPage stamps={p().stamps} names={props.names} />}</Match>
        <Match when={of('kingdoms')}>{p => <KingdomsPage visits={p().visits} />}</Match>
        <Match when={of('bonds')}>{p => <BondsPage bonds={p().bonds} />}</Match>
        <Match when={of('keepsakes')}>{p => <KeepsakesPage keepsakes={p().keepsakes} />}</Match>
        <Match when={of('more')}>{p => <MorePage collection={p().collection} pending={p().pending} failed={p().failed} {...(props.onMore ? { onMore: props.onMore } : {})} />}</Match>
        <Match when={of('endpaper')}>{p => <Endpaper asOf={p().asOf} holder={props.holder} />}</Match>
        <Match when={of('blank')}><Fleuron /></Match>
      </Switch>
    </div>
    <Show when={page().kind !== 'endpaper'}><span class="pp-folio" aria-hidden="true">{folio(props.leaf.index)}</span></Show>
  </article>;
}

function Fleuron(): JSX.Element {
  return <svg class="pp-fleuron" viewBox="0 0 80 24" aria-hidden="true">
    <path d="M4 12h24M52 12h24" stroke-width="1" />
    <path d="M40 4c-3 4-8 5-12 8 4 3 9 4 12 8 3-4 8-5 12-8-4-3-9-4-12-8Z" stroke-width="1.1" />
    <circle cx="40" cy="12" r="2" />
  </svg>;
}

function Flyleaf(props: { holder: string; empty: boolean; asOf: number }): JSX.Element {
  return <div class="pp-flyleaf">
    <p class="pp-flyleaf-label">This passport belongs to</p>
    <h2 class="pp-holder" dir="auto">{props.holder}</h2>
    <Fleuron />
    <p class="pp-flyleaf-note">
      {props.empty
        ? 'Its pages are waiting for the first kingdom reached. When you ride out with a raid or walk through another kingdom’s gate, that kingdom presses its stamp here.'
        : 'Each stamp was pressed where the world saw the arrival: the raids ridden, the kingdoms walked into, and what was given on the road.'}
    </p>
    <p class="pp-flyleaf-asof">Written as of <time datetime={isoDay(props.asOf)}>{longDate(props.asOf)}</time></p>
  </div>;
}

/** The empty book's facing page: a printed field of fine lines with room for a stamp, and nothing pressed on it. */
function Invitation(): JSX.Element {
  return <div class="pp-invitation">
    <svg class="pp-guilloche" viewBox="0 0 200 200" aria-hidden="true">
      {/* A printed rosette, the security pattern of a real passport page: even ellipses turned about one centre. */}
      <For each={Array.from({ length: 24 }, (_, i) => i)}>{i =>
        <ellipse cx="100" cy="100" rx="92" ry="34" transform={`rotate(${i * 7.5} 100 100)`} />}</For>
      <circle cx="100" cy="100" r="96" /><circle cx="100" cy="100" r="98.5" />
    </svg>
    <div class="pp-invitation-room" aria-hidden="true" />
    <p class="pp-invitation-title">Room for the first journey</p>
    <p class="pp-invitation-note">No kingdom has stamped this page yet.</p>
  </div>;
}

function StampsPage(props: { stamps: readonly StampView[]; names: ReadonlyMap<string, string> }): JSX.Element {
  return <div class="pp-stamps">
    <p class="pp-running-head">{monthSpan(props.stamps.map(stamp => stamp.at))}</p>
    <ol class="pp-stamp-list">
      <For each={props.stamps}>{stamp => <StampEntry stamp={stamp} names={props.names} />}</For>
    </ol>
  </div>;
}

function StampEntry(props: { stamp: StampView; names: ReadonlyMap<string, string> }): JSX.Element {
  // Which side of the line the stamp lands on, by its own ink: a hand works down a page, not to a grid.
  const flip = () => inkFor(props.stamp.id).grain % 2 === 1;
  const raid = () => (props.stamp.kind === 'raid' ? props.stamp : undefined);
  const from = () => { const r = raid(); return r ? props.names.get(r.road.from) : undefined; };
  return <li class="pp-entry" data-flip={flip() ? 'true' : undefined} data-kind={props.stamp.kind}>
    <PassportStampMark stamp={props.stamp} size={150} class="pp-entry-mark" />
    <div class="pp-entry-words">
      <h3 class="pp-entry-name" dir="auto">{props.stamp.kingdom.name}</h3>
      <p class="pp-entry-kind">
        <Show when={raid()} fallback={<>Visited</>}>{r => <>Raid{r().leader ? <>, led by <span dir="auto">{r().leader!.name}</span></> : <>, its leader not recorded</>}</>}</Show>
      </p>
      <p class="pp-entry-date"><time datetime={isoDay(props.stamp.at)}>{longDate(props.stamp.at)}</time></p>
      {/* The road is named only when this book already knows where it began. */}
      <Show when={from()}>{name => <p class="pp-entry-road"><RoadGlyph />By the road from <span dir="auto">{name()}</span></p>}</Show>
      <Show when={props.stamp.gifts.length > 0}>
        <ul class="pp-gifts">
          <For each={props.stamp.gifts}>{gift => <li class="pp-gift" data-direction={gift.direction}>
            <span class="pp-gift-way">{gift.direction === 'left' ? 'Left' : 'Brought back'}</span> <span dir="auto">{gift.name}</span>
          </li>}</For>
        </ul>
      </Show>
    </div>
  </li>;
}

/** A few inked dashes from a dot to the stamp: the road, drawn the way it is on the Atlas. */
function RoadGlyph(): JSX.Element {
  return <svg class="pp-road-glyph" viewBox="0 0 30 12" aria-hidden="true">
    <circle cx="3" cy="8" r="2" />
    <path d="M6.5 7.6c4-3.4 8-3.8 11.5-2.2 2.4 1.1 4.4 1.2 6.4-.4" stroke-dasharray="2.4 2" />
    <path d="M22.6 2.6l3.4 2.1-3.1 2.4" />
  </svg>;
}

function SectionHead(props: { title: string; note: string }): JSX.Element {
  return <header class="pp-section-head"><h3>{props.title}</h3><p>{props.note}</p></header>;
}

function KingdomsPage(props: { visits: readonly VisitView[] }): JSX.Element {
  return <div class="pp-list-page">
    <SectionHead title="Kingdoms reached" note="First and latest arrival in each." />
    <ul class="pp-rows">
      <For each={props.visits}>{visit => <li class="pp-row">
        <CrestArms crest={visit.kingdom.crest} kingdomName={visit.kingdom.name} size={40} />
        <div class="pp-row-words">
          <p class="pp-row-name" dir="auto">{visit.kingdom.name}</p>
          <p class="pp-row-note">
            <Show when={isoDay(visit.firstAt) !== isoDay(visit.lastAt)} fallback={<>Reached <time datetime={isoDay(visit.firstAt)}>{longDate(visit.firstAt)}</time></>}>
              First <time datetime={isoDay(visit.firstAt)}>{longDate(visit.firstAt)}</time>, latest <time datetime={isoDay(visit.lastAt)}>{longDate(visit.lastAt)}</time>
            </Show>
          </p>
        </div>
      </li>}</For>
    </ul>
  </div>;
}

function BondsPage(props: { bonds: readonly BondView[] }): JSX.Element {
  return <div class="pp-list-page">
    <SectionHead title="Bonds" note="Written as each bond was named." />
    <ul class="pp-rows">
      <For each={props.bonds}>{bond => <li class="pp-row pp-bond">
        <Show when={bond.with.kind === 'kingdom' ? bond.with.kingdom : undefined} fallback={
          <span class="pp-monogram" aria-hidden="true" dir="auto">{initialOf(bond.with.kind === 'citizen' ? bond.with.person.name : '')}</span>
        }>{kingdom => <CrestArms crest={kingdom().crest} kingdomName={kingdom().name} size={40} decorative />}</Show>
        <div class="pp-row-words">
          <p class="pp-row-name" dir="auto">{bond.name}</p>
          <p class="pp-row-note">
            With <span dir="auto">{bond.with.kind === 'kingdom' ? bond.with.kingdom.name : bond.with.person.name}</span>, since <time datetime={isoDay(bond.since)}>{longDate(bond.since)}</time>
          </p>
        </div>
      </li>}</For>
    </ul>
  </div>;
}

function KeepsakesPage(props: { keepsakes: readonly KeepsakeView[] }): JSX.Element {
  return <div class="pp-list-page">
    <SectionHead title="Keepsakes" note="Each one stays on its shelf in the kingdom it came from." />
    <ul class="pp-rows">
      <For each={props.keepsakes}>{keepsake => <li class="pp-row pp-keepsake">
        <span class="pp-tag" aria-hidden="true"><CrestArms crest={keepsake.kingdom.crest} kingdomName={keepsake.kingdom.name} size={24} decorative /></span>
        <div class="pp-row-words">
          <p class="pp-row-name" dir="auto">{keepsake.name}</p>
          <p class="pp-row-note">From <span dir="auto">{keepsake.kingdom.name}</span>, <time datetime={isoDay(keepsake.earnedAt)}>{longDate(keepsake.earnedAt)}</time></p>
        </div>
      </li>}</For>
    </ul>
  </div>;
}

function MorePage(props: { collection: PassportCollection; pending: boolean; failed: boolean; onMore?: (collection: PassportCollection) => void }): JSX.Element {
  const words = () => MORE_WORDS[props.collection];
  return <div class="pp-more">
    <Fleuron />
    <p class="pp-more-title">{words().title}</p>
    <Show when={props.onMore} fallback={<p class="pp-more-note">These pages are not open on this surface.</p>}>{more =>
      <Switch>
        <Match when={props.pending}><p class="pp-more-note" role="status">Turning to the next pages…</p></Match>
        <Match when={props.failed}>
          <p class="pp-more-note" role="status">Those pages could not be read just now.</p>
          <button type="button" class="pp-more-action" onClick={() => more()(props.collection)}>Try again</button>
        </Match>
        <Match when={true}><button type="button" class="pp-more-action" onClick={() => more()(props.collection)}>{words().action}</button></Match>
      </Switch>}</Show>
  </div>;
}

function Endpaper(props: { asOf: number; holder: string }): JSX.Element {
  return <div class="pp-endpaper">
    <div class="pp-endpaper-colophon">
      <Fleuron />
      <p>The passport of <span dir="auto">{props.holder}</span>, as written <time datetime={isoDay(props.asOf)}>{longDate(props.asOf)}</time>.</p>
      <p class="pp-endpaper-note">A stamp is pressed only where the world saw the arrival. Dates are UTC days.</p>
    </div>
  </div>;
}
