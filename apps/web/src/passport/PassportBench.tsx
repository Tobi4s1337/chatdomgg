import { createMemo, createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { PassportBondSchema, PassportBookSchema, PassportKeepsakeSchema, PassportStampSchema, PassportVisitSchema } from '@chatdom/shared/passport';
import {
  PASSPORT_FIXTURE_NAMES, PASSPORT_FIXTURE_TITLES, PassportBook, shelfOf, simulatedPassport, simulatedPassportPage,
  type BookLayout, type Loaded, type PassportCollection, type PassportFixtureName, type PassportShelf, type VisiblePassportView,
} from '@chatdom/ui/passport';
import './bench.css';

/**
 * The passport bench: the three SIMULATED books read through the frozen schema exactly as a surface would, then
 * opened in the book. `?fixture=none|few|many`, `?layout=spread|page`, `?view=<n>` (0 is the cover) and `?chrome=0`
 * for a frame without the bench header. Older pages come from the same SIMULATED fixture, validated record by record.
 */
const ITEM_SCHEMA = { stamps: PassportStampSchema, kingdoms: PassportVisitSchema, bonds: PassportBondSchema, keepsakes: PassportKeepsakeSchema } as const;

type ReadResult = { ok: true; book: VisiblePassportView } | { ok: false; reason: string };

/** The boundary every surface keeps: the frozen schema decides, and a hidden book is never opened. */
function readFixture(name: PassportFixtureName): ReadResult {
  const parsed = PassportBookSchema.safeParse(simulatedPassport(name));
  if (!parsed.success) return { ok: false, reason: `The SIMULATED ${name} book failed the passport schema.` };
  if (parsed.data.visibility !== 'visible') return { ok: false, reason: 'This passport is kept private.' };
  return { ok: true, book: simulatedPassport(name) };
}

const param = (key: string) => new URLSearchParams(window.location.search).get(key);
const isFixture = (value: string | null): value is PassportFixtureName => PASSPORT_FIXTURE_NAMES.includes(value as PassportFixtureName);

export default function PassportBench(): JSX.Element {
  const initial = param('fixture');
  const [fixture, setFixture] = createSignal<PassportFixtureName>(isFixture(initial) ? initial : 'many');
  const [layout, setLayout] = createSignal<BookLayout>(param('layout') === 'page' || (param('layout') !== 'spread' && window.innerWidth < 760) ? 'page' : 'spread');
  const chrome = param('chrome') !== '0';
  const initialView = Math.max(0, Number(param('view') ?? 1) || 0);
  const read = createMemo(() => readFixture(fixture()));
  const [shelf, setShelf] = createSignal<PassportShelf | null>(null);
  const currentShelf = () => shelf() ?? (read().ok ? shelfOf((read() as { book: VisiblePassportView }).book) : null);

  const choose = (name: PassportFixtureName) => { setShelf(null); setFixture(name); };
  const more = (collection: PassportCollection) => {
    const base = currentShelf();
    const cursor = base?.[collection].nextCursor;
    if (!base || !cursor) return;
    const page = simulatedPassportPage(fixture(), collection, cursor);
    const schema = ITEM_SCHEMA[collection];
    const valid = page && page.items.length <= 50 && page.items.every(item => schema.safeParse(item).success);
    const loaded = base[collection] as Loaded<unknown>;
    const next: Loaded<unknown> = valid
      ? { items: [...loaded.items, ...page.items], nextCursor: page.nextCursor }
      : { ...loaded, failed: true };
    setShelf({ ...base, [collection]: next } as PassportShelf);
  };

  onMount(() => {
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
    })));
  });

  return <main class="ppb" data-chrome={chrome ? 'on' : 'off'}>
    <Show when={chrome}>
      <header class="ppb-head cd-plate">
        <div class="ppb-title">
          <p class="cd-label ppb-eyebrow">Chatdom · passport bench</p>
          <h1 class="ppb-h1">The raid passport</h1>
          <p class="ppb-sim"><b>SIMULATED</b> invented citizens and kingdoms, read through the frozen passport schema. No live travel.</p>
        </div>
        <div class="ppb-pick" role="group" aria-label="Choose a SIMULATED book">
          <For each={PASSPORT_FIXTURE_NAMES}>{name => <button type="button" class="ppb-chip" aria-pressed={fixture() === name}
            onClick={() => choose(name)}>{PASSPORT_FIXTURE_TITLES[name]}</button>}</For>
        </div>
        <div class="ppb-pick" role="group" aria-label="Pages shown at once">
          <button type="button" class="ppb-chip" aria-pressed={layout() === 'spread'} onClick={() => setLayout('spread')}>Two pages</button>
          <button type="button" class="ppb-chip" aria-pressed={layout() === 'page'} onClick={() => setLayout('page')}>One page</button>
        </div>
      </header>
    </Show>
    <Show when={read().ok ? read() as { ok: true; book: VisiblePassportView } : undefined} keyed fallback={
      <p class="ppb-refusal" role="status">{(read() as { reason: string }).reason}</p>
    }>{result => <PassportBook book={result.book} shelf={currentShelf() ?? shelfOf(result.book)} layout={layout()} initialView={initialView} onMore={more} />}</Show>
  </main>;
}
