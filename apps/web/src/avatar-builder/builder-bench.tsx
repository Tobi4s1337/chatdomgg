import { render } from 'solid-js/web';
import { createKingdomAudio } from '@chatdom/audio';
import {
  SIMULATED_ENTITLEMENTS, checkEarned, parseLook, seedLook, twitchDefaultLook, type CitizenLook, type SimulatedPersona,
} from '../../../../packages/content/src/avatar-style';
import { AvatarBuilder, type LookAuthority } from './AvatarBuilder';
import type { TabId } from './catalogue';

/*
 * The builder bench: SIMULATED people with SIMULATED verified records, on the page layout or at Twitch panel
 * size. `?who=newcomer|regular|veteran|lapsed`, `?layout=page|panel`, `?tab=hair|…|earned`, `?still=1` for
 * captures. Saves go to this browser only, through a bench authority that checks earned pieces the way main's
 * authority must: nothing here is saved to a real person.
 */
declare global { interface Window { __chatdomReady?: boolean } }

const PEOPLE: Record<SimulatedPersona, { name: string; nameColour: string }> = {
  newcomer: { name: 'pebble_wren', nameColour: '#1E90FF' },
  regular: { name: 'cozy_otter', nameColour: '#FF7F50' },
  veteran: { name: 'old_lamplighter', nameColour: '#8A2BE2' },
  lapsed: { name: 'moss_and_mead', nameColour: '#2E8B57' },
};
const params = new URLSearchParams(location.search);
const who = (Object.keys(PEOPLE) as SimulatedPersona[]).find(p => p === params.get('who')) ?? 'veteran';
const layout = params.get('layout') === 'panel' ? 'panel' : 'page';
const still = params.get('still') === '1';
const tab = (params.get('tab') ?? undefined) as TabId | undefined;
const person = PEOPLE[who], entitlements = SIMULATED_ENTITLEMENTS[who];
const town: CitizenLook[] = Array.from({ length: 60 }, (_, i) => seedLook(`simulated-neighbour-${i}`));
const defaultLook = twitchDefaultLook({ personId: `simulated:${person.name}`, nameColour: person.nameColour, entitlements, town });
const storageKey = `chatdom.simulated-look.${who}`;
const stored = (() => {
  if (still) return null;
  try { const raw = localStorage.getItem(storageKey); return raw ? parseLook(JSON.parse(raw)) : null; } catch { return null; }
})();

const authority: LookAuthority = {
  origin: 'simulated',
  async save(look) {
    await new Promise(r => setTimeout(r, 380));
    const problems = checkEarned(look, entitlements);
    if (problems.length) return { ok: false, reason: problems[0]! };
    const clean = parseLook(JSON.parse(JSON.stringify(look)));
    localStorage.setItem(storageKey, JSON.stringify(clean));
    return { ok: true, look: clean };
  },
};

const audio = createKingdomAudio();
addEventListener('pointerdown', () => void audio.unlock(), { once: true });
if (layout === 'panel') document.body.classList.add('panel');

const root = document.getElementById('root');
if (!root) throw new Error('The builder bench has no root element.');
render(() => <AvatarBuilder layout={layout} name={person.name} saved={stored ?? defaultLook} defaultLook={defaultLook}
  entitlements={entitlements} authority={authority} town={town} sounds={audio} still={still} tab={tab} />, root);

// Ready once the fonts are in and the tiles of the open tab have painted.
void document.fonts.ready.then(() => {
  const check = () => {
    const waiting = document.querySelectorAll('.ab-thumb-waiting').length;
    const portrait = document.querySelector('.ab-portrait img');
    if (!waiting && portrait) requestAnimationFrame(() => requestAnimationFrame(() => { window.__chatdomReady = true; }));
    else setTimeout(check, 120);
  };
  check();
});
