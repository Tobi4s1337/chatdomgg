import {
  BEARD_STYLE_IDS, HAIR_STYLE_IDS, HAT_STYLE_IDS, MOUSTACHE_STYLE_IDS, NATURAL_HAIR, PORTRAIT_FIXTURES, SKIN_TONES, WILD_HAIR, DYES,
  DEFAULT_BOTTOM, DEFAULT_SHOES, NO_EARNED, NECKWEAR_STYLE_IDS, OUTER_STYLE_IDS, TOP_STYLE_IDS, defaultAccent, seedLook, type CitizenLook, type Hex, type PatternId,
} from '../../../../packages/content/src/avatar-style';
import { createPortraitRenderer } from './portrait-renderer';

/*
 * Portrait bench (spec 49, AS03): twenty SIMULATED citizens as bust portraits, laid out 4 × 5 like the
 * reference, each rendered at 512 px (shown at 256) and at 128 px (shown at actual size).
 * `?set=fixtures` is the hand-made range; `?set=seeded` is twenty seeded default looks.
 */
declare global { interface Window { __chatdomReady?: boolean; __portraits?: { name: string; look: CitizenLook; p512: string; p128: string }[] } }

type Person = { readonly name: string; readonly look: CitizenLook };
const plain = (i: number, patch: Partial<CitizenLook>): CitizenLook => ({
  version: 1, skin: SKIN_TONES[(i * 7) % SKIN_TONES.length]!.hex, eyes: { shape: 'dot', spacing: 'set' }, freckles: 'none', blush: false,
  hair: { style: 'short-crop', colour: NATURAL_HAIR[i % NATURAL_HAIR.length]!.hex }, beard: null, moustache: null, hat: null, glasses: null,
  earrings: null, flower: null, top: { style: 'tee', dye: DYES[(i * 5) % DYES.length]!.hex, pattern: 'plain', accent: '#1e1d22' },
  outer: null, bottom: DEFAULT_BOTTOM, neckwear: null, shoes: DEFAULT_SHOES, earned: NO_EARNED, ...patch,
});
const hairColour = (i: number): Hex => (i % 4 === 3 ? WILD_HAIR[i % WILD_HAIR.length]! : NATURAL_HAIR[(i * 3) % NATURAL_HAIR.length]!).hex;
const covered = ['short-crop', 'curls', 'long-waves', 'ponytail'] as const;

/** Every bench sheet. `hair`, `hats` and `faces` show one part family each, on otherwise plain citizens. */
const SETS: Record<string, { readonly sub: string; readonly people: () => readonly Person[] }> = {
  fixtures: { sub: 'Twenty hand-made citizens: every part family, the skin range', people: () => PORTRAIT_FIXTURES },
  seeded: {
    sub: 'Twenty seeded default looks, from simulated person ids',
    people: () => Array.from({ length: 20 }, (_, i) => ({ name: `Simulated viewer ${i + 1}`, look: seedLook(`simulated-viewer-${i + 1}`) })),
  },
  hair: {
    sub: 'Every hair style, any colour',
    people: () => [...HAIR_STYLE_IDS, 'bald' as const].slice(0, 20).map((style, i) => ({
      name: `Simulated ${style}`,
      look: plain(i, { hair: { style, colour: hairColour(i) }, beard: style === 'bald' && i === 19 ? { style: 'full', colour: '#8e8c8a' } : null }),
    })),
  },
  hats: {
    sub: 'Every hat over four hair lengths',
    people: () => HAT_STYLE_IDS.flatMap((hat, h) => covered.map((style, c) => ({
      name: `Simulated ${hat} · ${style}`,
      look: plain(h * 4 + c, {
        hair: { style, colour: hairColour(h * 4 + c) },
        hat: { style: hat, colour: hat === 'straw-hat' ? '#ecd9a6' : DYES[(h * 4 + c * 3) % DYES.length]!.hex, trim: DYES[(h * 7 + c * 2 + 1) % DYES.length]!.hex },
      }),
    }))),
  },
  wardrobe: {
    sub: 'Every top, outer layer, bottom, neckwear and pattern',
    people: () => {
      const g = <S extends string>(style: S, dye: Hex, pattern: PatternId = 'plain', accent: Hex = defaultAccent(dye)) => ({ style, dye, pattern, accent });
      const d = (i: number) => DYES[i % DYES.length]!.hex;
      const looks: Partial<CitizenLook>[] = [
        ...TOP_STYLE_IDS.map((style, i) => ({ top: g(style, d(i * 5 + 1)) })),
        ...OUTER_STYLE_IDS.map((style, i) => ({ top: g('tee', '#f3f1ee'), outer: g(style, d(i * 4 + 2)) })),
        ...(['stripes', 'plaid', 'dots', 'print'] as const).map((pattern, i) => ({ top: g(i % 2 ? 'shirt' : 'tee', d(i * 3 + 9), pattern, i === 1 ? '#1e1d22' : d(i * 7 + 4)) })),
        ...NECKWEAR_STYLE_IDS.map((style, i) => ({ top: g(style === 'tie' ? 'shirt' : 'tee', d(i * 5 + 13)), neckwear: { style, dye: d(i * 5 + 1), accent: d(i * 5 + 4) } })),
        { top: g('tee', '#f3f1ee'), bottom: g('overalls', '#2d5fd8') },
        { top: g('sweater', '#1ea59a', 'stripes'), outer: g('coat', '#8a5a32'), neckwear: { style: 'scarf', dye: '#d3202a', accent: '#f6d23c' } },
      ];
      return looks.map((patch, i) => ({ name: `Simulated outfit ${i + 1}`, look: plain(i, patch) }));
    },
  },
  faces: {
    sub: 'Glasses, beards, moustaches, earrings and flowers',
    people: () => {
      const looks: Partial<CitizenLook>[] = [
        ...(['round', 'square', 'goggles'] as const).flatMap((style, i) => (['set', 'wide'] as const).map(spacing => ({
          eyes: { shape: 'dot' as const, spacing }, hair: { style: HAIR_STYLE_IDS[i * 3 + 1]!, colour: hairColour(i * 2 + 1) },
          glasses: { style, colour: ['#e8b54a', '#1f1d22', '#55565e'][i]! as Hex, lens: ['#ffb7c4', '#e9f2ff', '#3b3546'][i]! as Hex },
        }))),
        ...BEARD_STYLE_IDS.map((style, i) => ({ hair: { style: 'short-crop' as const, colour: hairColour(i + 4) }, beard: { style, colour: hairColour(i + 4) } })),
        ...MOUSTACHE_STYLE_IDS.map((style, i) => ({ hair: { style: (['side-part', 'slicked', 'bald'] as const)[i]!, colour: '#3a2519' as Hex }, moustache: { style, colour: '#3a2519' as Hex } })),
        ...(['stud', 'hoop', 'drop'] as const).map((style, i) => ({ hair: { style: (['bob', 'buns', 'side-shave'] as const)[i]!, colour: hairColour(i + 8) }, earrings: { style, colour: '#e8b54a' as Hex } })),
        { hair: { style: 'long-waves', colour: '#7b4322' }, flower: { colour: '#ff4d4d' } },
        { hair: { style: 'braids', colour: '#1c191c' }, flower: { colour: '#fbfaf5' }, earrings: { style: 'hoop', colour: '#e8b54a' } },
        { hair: { style: 'curls', colour: '#d98a2e' }, flower: { colour: '#9f6bff' }, hat: { style: 'straw-hat', colour: '#ecd9a6', trim: '#d3202a' } },
        { hair: { style: 'afro', colour: '#1c191c' }, flower: { colour: '#ff6fa8' } },
      ];
      return looks.map((patch, i) => ({ name: `Simulated face ${i + 1}`, look: plain(i, patch) }));
    },
  },
};
const set = new URLSearchParams(location.search).get('set') ?? 'fixtures';
const chosen = SETS[set] ?? SETS.fixtures!;
const people = chosen.people();
document.querySelector('#sub')!.textContent = chosen.sub;

const renderer = createPortraitRenderer();
const sheet = document.querySelector('#sheet')!, strip = document.querySelector('#strip')!;
const out: NonNullable<Window['__portraits']> = [];
for (const person of people) {
  const p512 = renderer.render(person.look, 512).toDataURL('image/png');
  const p128 = renderer.render(person.look, 128).toDataURL('image/png');
  out.push({ name: person.name, look: person.look, p512, p128 });
  const figure = document.createElement('figure');
  const img = Object.assign(document.createElement('img'), { src: p512, alt: person.name });
  const caption = Object.assign(document.createElement('figcaption'), { textContent: person.name });
  figure.append(img, caption);
  sheet.append(figure);
  strip.append(Object.assign(document.createElement('img'), { src: p128, alt: person.name }));
}
renderer.dispose();
window.__portraits = out;
window.__chatdomReady = true;
