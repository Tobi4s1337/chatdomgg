/**
 * The kit's own fonts, embedded as bytes in the server bundle so the share image never fetches a font (or anything
 * else) while it renders. The same files the book uses in the browser; SIL Open Font License, see
 * `packages/ui/src/fonts/OFL-*.txt`.
 */
import alegreyaItalic from '../../../../packages/ui/src/fonts/alegreya-italic-latin.woff2?inline';
import alegreya from '../../../../packages/ui/src/fonts/alegreya-roman-latin.woff2?inline';
import fellItalic from '../../../../packages/ui/src/fonts/im-fell-english-italic.woff2?inline';
import fell from '../../../../packages/ui/src/fonts/im-fell-english-regular.woff2?inline';
import fellSc from '../../../../packages/ui/src/fonts/im-fell-english-sc.woff2?inline';

const face = (family: string, style: 'normal' | 'italic', source: string, weight = '400') => {
  // Only a data URL Vite produced from the files above may stand here; anything else would be a fetch.
  if (!/^data:(font\/woff2|application\/octet-stream|application\/font-woff2);base64,[A-Za-z0-9+/=]+$/.test(source)) throw new Error(`The ${family} font did not embed`);
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;src:url(${source}) format('woff2')}`;
};

/** `@font-face` rules for the share composition, with every byte inline. */
export function passportFontFaces(): string {
  return [
    face('IM Fell English', 'normal', fell), face('IM Fell English', 'italic', fellItalic), face('IM Fell English SC', 'normal', fellSc),
    face('Alegreya', 'normal', alegreya, '400 900'), face('Alegreya', 'italic', alegreyaItalic, '400 900'),
  ].join('');
}
