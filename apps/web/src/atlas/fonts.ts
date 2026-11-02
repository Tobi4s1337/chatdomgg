import fellItalic from './assets/fonts/im-fell-english-italic.woff2?url';
import fellRegular from './assets/fonts/im-fell-english-regular.woff2?url';
import fellCaps from './assets/fonts/im-fell-english-sc.woff2?url';
import alegreyaItalicCyrillic from './assets/fonts/alegreya-italic-cyrillic.woff2?url';
import alegreyaItalic from './assets/fonts/alegreya-italic-latin.woff2?url';
import alegreyaCyrillic from './assets/fonts/alegreya-roman-cyrillic.woff2?url';
import alegreya from './assets/fonts/alegreya-roman-latin.woff2?url';

/**
 * The faces the map is lettered in, the same files `atlas.css` declares. The still and the map both wait for them
 * before they letter, so they are asked for the moment a map is mounted, beside the scene's own code, rather than
 * when the scene's stylesheet is finally applied (which comes after the scene has been evaluated). Cyrillic is
 * included because the realms' own names are set in it.
 */
export const ATLAS_FACE_FILES: readonly string[] = [fellRegular, fellItalic, fellCaps, alegreya, alegreyaItalic, alegreyaCyrillic, alegreyaItalicCyrillic];

/** Ask for the map's faces once per document (font preloads are always CORS-mode, matching the stylesheet's fetch). */
export function preloadFaces(doc: Document = document): void {
  if (!doc.head || doc.head.querySelector('link[data-atlas-face]')) return;
  for (const href of ATLAS_FACE_FILES) {
    const link = doc.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.type = 'font/woff2';
    link.crossOrigin = 'anonymous';
    link.href = href;
    link.dataset.atlasFace = '';
    doc.head.append(link);
  }
}
