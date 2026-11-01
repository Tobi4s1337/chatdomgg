import { For, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import type { CitizenKey } from '@chatdom/shared';
import type { CardAssetRef, CitizenCardDocument } from '../../../api/src/citizen-card/contracts';
import { CitizenCard, type CardMode } from './CitizenCard';
import { CARD_FIXTURES, findFixture, type CardFixture } from './fixtures';
import type { CardHost, CardLight, CardLoad } from './host';
import './bench.css';

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomCardBench?: { readonly fixture: string; readonly mode: CardMode; readonly state: BenchState; readonly travels: Travels; readonly portraits: number; readonly passport: string | null; readonly picture: string | null };
    __chatdomCardError?: string;
  }
}

/** What the bench's SIMULATED authority answers: the fixture itself, or one of the card's designed states. */
type BenchState = 'ready' | 'loading' | 'missing' | 'withdrawn' | 'unavailable';
const STATES: readonly BenchState[] = ['ready', 'loading', 'missing', 'withdrawn', 'unavailable'];
const MODES: readonly CardMode[] = ['page', 'dialog'];
const LIGHTS: readonly CardLight[] = ['day', 'dusk', 'night'];
/** Whether the SIMULATED citizen keeps their travels private: the card stays, the book and its picture go. */
type Travels = 'shown' | 'hidden';
const TRAVELS: readonly Travels[] = ['shown', 'hidden'];

const pick = <T extends string>(value: string | null, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? value as T : fallback;

/**
 * The citizen card bench, a SIMULATED kingdom ledger: deterministic fixtures, their portraits painted by the
 * product citizen renderer, every designed state, dialog and page modes. On the page, a citizen who holds a
 * SIMULATED passport (Wren Tarnwalker) has it read beneath their card, through the real passport reader. It is the
 * lane's runnable proof and the default export main mounts; it stores nothing and talks to no server.
 *
 * On the page the card is also shared: its picture is `/-/citizens/share.png`, which only the card capture serves
 * (the real composition of the bench's card and the passport reader's answer, drawn by Chrome). Opened without the
 * capture, the print shows its designed could-not-be-drawn state rather than a stand-in.
 *
 *   /src/citizen-card/bench.html?fixture=wren&mode=page&light=dusk&state=ready&travels=shown&chrome=0
 */
export default function CitizenCardBench() {
  const params = new URLSearchParams(window.location.search);
  const fixture = findFixture(params.get('fixture') ?? 'wren') ?? CARD_FIXTURES[0]!;
  const mode = pick(params.get('mode'), MODES, 'page');
  const state = pick(params.get('state'), STATES, 'ready');
  const light = pick(params.get('light'), LIGHTS, 'dusk');
  const travels = pick(params.get('travels'), TRAVELS, 'shown');
  const chrome = params.get('chrome') !== '0';
  const [subject, setSubject] = createSignal<CitizenKey | null>(null);
  const [status, setStatus] = createSignal<string | null>('Painting the portraits…');
  type Beneath = (document: CitizenCardDocument) => JSX.Element;
  const [beneath, setBeneath] = createSignal<Beneath>();
  /** The passport's reading state on the page: the capture waits until it has settled. */
  let passport: string | null = null;
  const portraits = new Map<string, string>();
  const sitting = new AbortController();
  let disposed = false;
  let opener: HTMLButtonElement | undefined;
  window.__chatdomReady = false;

  const announce = () => {
    void settle().then(() => {
      if (disposed) return;
      window.__chatdomCardBench = { fixture: fixture.id, mode, state, travels, portraits: portraits.size, passport, picture: document.querySelector('.cc-share')?.getAttribute('data-picture') ?? null };
      window.__chatdomReady = true;
    });
  };

  const host: CardHost = {
    load(key, signal) {
      window.__chatdomReady = false;
      const answer = (load: CardLoad) => { setTimeout(announce); return load; };
      if (state === 'loading') {
        // The ledger never answers: the card stays in its reading state until it is closed or replaced.
        setTimeout(announce);
        return new Promise<CardLoad>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }
      if (state !== 'ready') return Promise.resolve(answer({ status: state }));
      const match = CARD_FIXTURES.find(item => item.document.key.personId === key.personId && item.document.key.kingdomId === key.kingdomId);
      // Travels kept private: the authority's projected card carries a hidden passport; homes and the rest remain.
      const shown = match && travels === 'hidden' ? { ...match.document, passport: { hidden: true } as const } : match?.document;
      return Promise.resolve(answer(shown ? { status: 'ready', document: shown } : { status: 'missing' }));
    },
    assetUrl: (ref: CardAssetRef) => portraits.get(`${ref.id}@${ref.revision}`) ?? null,
    close() { setSubject(null); },
    navigate(path) { window.location.assign(path); },
    // The bench's own page for this card is its public page; the picture's route is the capture's.
    share(card) {
      if (card.key.personId !== fixture.document.key.personId) return null;
      const page = new URL(window.location.pathname, window.location.href);
      page.search = new URLSearchParams({ fixture: fixture.id, mode: 'page', ...(travels === 'hidden' ? { travels } : {}) }).toString();
      return { pageUrl: page.href, imageUrl: `/-/citizens/share.png?${new URLSearchParams({ fixture: fixture.id, travels })}` };
    },
  };

  onMount(() => {
    void (async () => {
      const sitters = CARD_FIXTURES.filter((item): item is CardFixture & { portraitLook: NonNullable<CardFixture['portraitLook']> } => item.portraitLook !== null && item.document.identity.portrait !== null);
      // three.js and the voxel pipeline load only here, never with the card itself.
      const { paintPortraits } = await import('./portrait');
      // Their passport, read beneath their card on the page. The reader and its SIMULATED authorities load only here.
      const book = fixture.passport;
      if (mode === 'page' && book) {
        passport = 'pending';
        const { simulatedCardPassport } = await import('./passport');
        if (disposed) return;
        setBeneath(() => (card: CitizenCardDocument) => simulatedCardPassport(card, book, reading => { passport = reading.kind; }, travels === 'hidden'));
      }
      const painted = await paintPortraits(sitters.map(item => ({ id: item.id, look: item.portraitLook })), { signal: sitting.signal });
      if (disposed) return;
      for (const item of sitters) {
        const blob = painted.get(item.id), ref = item.document.identity.portrait!;
        if (blob) portraits.set(`${ref.id}@${ref.revision}`, URL.createObjectURL(blob));
      }
      setStatus(null);
      if (mode === 'page') setSubject(fixture.document.key);
      else open();
    })().catch((error: unknown) => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      window.__chatdomCardError = message;
      setStatus(`The portraits could not be painted: ${message}`);
      console.error(message);
    });
  });
  onCleanup(() => {
    disposed = true;
    sitting.abort();
    for (const url of portraits.values()) URL.revokeObjectURL(url);
    portraits.clear();
    window.__chatdomReady = false;
  });

  const open = () => { opener?.focus(); setSubject(fixture.document.key); };
  const href = (changes: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) next.set(k, v);
    return `?${next}`;
  };

  return <div class="ccb" data-mode={mode} data-light={light}>
    <Show when={chrome}>
      <nav class="ccb-bar" aria-label="Card bench">
        <p class="ccb-title"><b>SIMULATED</b> Citizen card bench</p>
        <Choice label="Citizen" items={CARD_FIXTURES.map(item => ({ value: item.id, text: item.id, note: item.note }))} current={fixture.id} href={value => href({ fixture: value })} />
        <Choice label="Mode" items={MODES.map(value => ({ value, text: value }))} current={mode} href={value => href({ mode: value })} />
        <Choice label="Ledger" items={STATES.map(value => ({ value, text: value }))} current={state} href={value => href({ state: value })} />
        <Choice label="Light" items={LIGHTS.map(value => ({ value, text: value }))} current={light} href={value => href({ light: value })} />
        <Choice label="Travels" items={TRAVELS.map(value => ({ value, text: value }))} current={travels} href={value => href({ travels: value })} />
      </nav>
    </Show>
    <Show when={mode === 'dialog'}>
      <section class="ccb-world" aria-label="A SIMULATED street behind the card">
        <p class="ccb-world-note">A SIMULATED street. In the kingdom, picking a citizen or their house opens their card here.</p>
        <button type="button" class="ccb-open" ref={element => (opener = element)} onClick={open} disabled={status() !== null}>
          Open {fixture.document.identity.name}’s card
        </button>
      </section>
    </Show>
    <Show when={status()}>{text => <p class="ccb-status" role={window.__chatdomCardError ? 'alert' : 'status'}>{text()}</p>}</Show>
    <CitizenCard mode={mode} subject={subject()} host={host} light={light} beneath={beneath()}
      worn={fixture.worn ? { key: fixture.document.key, pieces: fixture.worn } : null} />
  </div>;
}

function Choice(props: { label: string; items: readonly { value: string; text: string; note?: string }[]; current: string; href: (value: string) => string }) {
  return <div class="ccb-choice" role="group" aria-label={props.label}>
    <span>{props.label}</span>
    <For each={props.items}>{item => <a href={props.href(item.value)} title={item.note} aria-current={item.value === props.current ? 'true' : undefined}>{item.text}</a>}</For>
  </div>;
}

/** Fonts, every image in the card, finished entrances and two frames: the card a person would actually see, not a half-drawn one. */
async function settle(): Promise<void> {
  // A passport on the page settles first: its reading answers, then its book draws.
  for (let wait = 0; document.querySelector('.cpc[data-state="pending"]') && wait < 600; wait++) await new Promise(resolve => setTimeout(resolve, 50));
  await document.fonts.ready;
  // The share print settles too: drawn, or its designed could-not-be-drawn state.
  for (let wait = 0; document.querySelector('.cc-share[data-picture="loading"]') && wait < 1200; wait++) await new Promise(resolve => setTimeout(resolve, 50));
  const images = [...document.querySelectorAll<HTMLImageElement>('.cc-plaque img, .cpc img, .cc-share img')];
  await Promise.all(images.map(image => image.decode().catch(() => undefined)));
  // Let the card's entrance and the seal's press finish; a looping quill never does, so it is not awaited.
  const finite = document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations ?? Infinity));
  await Promise.all(finite.map(animation => animation.finished.catch(() => undefined)));
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
