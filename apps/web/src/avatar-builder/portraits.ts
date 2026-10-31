import { PORTRAIT_FIXTURES, seedLook, type CitizenLook } from '../../../../packages/content/src/avatar-style';
import { createPortraitRenderer } from './portrait-renderer';

/*
 * Portrait bench (spec 49, AS03): twenty SIMULATED citizens as bust portraits, laid out 4 × 5 like the
 * reference, each rendered at 512 px (shown at 256) and at 128 px (shown at actual size).
 * `?set=fixtures` is the hand-made range; `?set=seeded` is twenty seeded default looks.
 */
declare global { interface Window { __chatdomReady?: boolean; __portraits?: { name: string; look: CitizenLook; p512: string; p128: string }[] } }

const set = new URLSearchParams(location.search).get('set') ?? 'fixtures';
const people = set === 'seeded'
  ? Array.from({ length: 20 }, (_, i) => ({ name: `Simulated viewer ${i + 1}`, look: seedLook(`simulated-viewer-${i + 1}`) }))
  : PORTRAIT_FIXTURES;
document.querySelector('#sub')!.textContent = set === 'seeded'
  ? 'Twenty seeded default looks, from simulated person ids'
  : 'Every hair style, both beards, every eye variant, freckles, blush and the skin range';

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
