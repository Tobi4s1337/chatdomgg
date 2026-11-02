import { render } from 'solid-js/web';
import { createKingdomAudio } from '@chatdom/audio';
import {
  checkEarned, parseLook, seedLook, starterLookRecipe, twitchDefaultLook, type CitizenLook,
} from '../../../../packages/content/src/avatar-style';
import { AvatarBuilder, type LookAuthority } from './AvatarBuilder';
import { BENCH_PEOPLE, BENCH_RECORDS, freshMemory, type BenchPerson } from './bench-records';
import type { TabId } from './catalogue';
import type { FocusRegion } from './turntable';

/*
 * The builder's dev bench (`builder.html`, served only by the dev server and the capture script; no public route
 * reaches it). Invented people with invented records, on the page layout or at Twitch panel size.
 *   ?who=newcomer|regular|veteran|lapsed  ?layout=page|panel  ?tab=face|hair|beard|hat|trinkets|top|layer|below|carry|earned|yours
 *   ?still=1 for captures
 *   ?view=builder|reveal|mirror|ledger|doors|signin|pieces  ?focus=head|face|chest|badge|hands|legs|feet|back
 *   ?inspect=<card key> opens that item's card (`hair:curls`, `held:balloon`, an earned key such as `ribbons`)
 *   ?pieces=all on the `pieces` contact sheet shows every piece, not only the new ones
 *   ?save=ok|refuse|slow  how the bench's stand-in for the realm answers a save.
 * `reveal` opens with a fresh device memory, so its first unlock is shown; `builder` never reveals.
 */
declare global { interface Window { __chatdomReady?: boolean } }

const params = new URLSearchParams(location.search);
const who = (Object.keys(BENCH_PEOPLE) as BenchPerson[]).find(p => p === params.get('who')) ?? 'veteran';
const layout = params.get('layout') === 'panel' ? 'panel' : 'page';
const still = params.get('still') === '1';
const view = params.get('view') ?? 'builder';
const tab = (params.get('tab') ?? undefined) as TabId | undefined;
const focus = (params.get('focus') ?? undefined) as FocusRegion | undefined;
const inspect = params.get('inspect') ?? undefined;
const answer = params.get('save') ?? 'ok';
const person = BENCH_PEOPLE[who], entitlements = BENCH_RECORDS[who];
const town: CitizenLook[] = Array.from({ length: 60 }, (_, i) => seedLook(`bench-neighbour-${i}`));
const defaultLook = twitchDefaultLook({ personId: `bench:${person.name}`, nameColour: person.nameColour, entitlements, town });
const storageKey = `chatdom.bench-look.${who}`;
const stored = (() => {
  if (still) return null;
  try { const raw = localStorage.getItem(storageKey); return raw ? parseLook(JSON.parse(raw)) : null; } catch { return null; }
})();

/** The bench's stand-in for the realm: it checks earned pieces the way the realm does and keeps the look in this browser. */
const authority: LookAuthority = {
  async save(look) {
    await new Promise(r => setTimeout(r, answer === 'slow' ? 4000 : 380));
    if (answer === 'refuse') return { ok: false, reason: 'The realm is mending its wardrobe for a moment. Your look is safe here; try saving again shortly.' };
    const problems = checkEarned(look, entitlements);
    if (problems.length) return { ok: false, reason: problems[0]! };
    const clean = parseLook(JSON.parse(JSON.stringify(look)));
    try { localStorage.setItem(storageKey, JSON.stringify(clean)); } catch { /* the bench forgets */ }
    return { ok: true, look: clean };
  },
};

const audio = createKingdomAudio();
addEventListener('pointerdown', () => void audio.unlock(), { once: true });
if (layout === 'panel') document.body.classList.add('panel');

const root = document.getElementById('root');
if (!root) throw new Error('The builder bench has no root element.');

async function mount(): Promise<void> {
  if (view === 'mirror') {
    const { MirrorMoment } = await import('./Mirror');
    const look = parseLook(starterLookRecipe('tide'));
    render(() => <div class="bench-street"><MirrorMoment name={person.name} look={look} save={look => authority.save(look)} sounds={audio} still={still}
      onDone={() => undefined} /></div>, root!);
    return;
  }
  if (view === 'ledger') {
    const { LedgerBench } = await import('./bench-ledger');
    render(() => <LedgerBench name={person.name} look={stored ?? defaultLook} entitlements={entitlements} />, root!);
    return;
  }
  if (view === 'pieces') {
    const { PiecesSheet } = await import('./bench-pieces');
    render(() => <PiecesSheet look={stored ?? defaultLook} all={params.get('pieces') === 'all'} />, root!);
    return;
  }
  if (view === 'doors' || view === 'signin') {
    const { WardrobeDoors } = await import('./play-ui');
    render(() => <WardrobeDoors state={view === 'signin' ? 'anonymous' : 'loading'} signInUrl="/api/realm/auth/start?returnTo=%2F-%2Favatar-builder" />, root!);
    return;
  }
  render(() => <AvatarBuilder layout={layout} name={person.name} saved={stored ?? defaultLook} defaultLook={defaultLook}
    entitlements={entitlements} authority={authority} town={town} sounds={audio} still={still} tab={tab} focus={focus} inspect={inspect}
    reveal={view === 'reveal'} memory={view === 'reveal' ? freshMemory() : undefined}
    granted={who === 'veteran' ? [{ pieceId: 'bench-forged-moon-lantern', slot: 'held', source: 'forge', title: 'Moon lantern', grantedAt: Date.UTC(2026, 9, 3), recipe: null }] : []}
    onClose={params.get('close') === '1' ? () => undefined : undefined} closeLabel="Back to the street" />, root!);
}
void mount();

// Ready once the fonts are in and every picture on screen has painted.
void document.fonts.ready.then(() => {
  const check = () => {
    const waiting = document.querySelectorAll('.ab-thumb-waiting').length;
    const portrait = document.querySelector('.ab-portrait img, .lk-ledger-frame img, .lk-mirror, .lk-doors, .bp-grid');
    const reveal = view !== 'reveal' || document.querySelector('.ab-reveal-frame img');
    if (!waiting && portrait && reveal) setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => { window.__chatdomReady = true; })), view === 'builder' ? 0 : 400);
    else setTimeout(check, 120);
  };
  check();
});
