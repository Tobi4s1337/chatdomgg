// The portrait sitting: paints the SIMULATED sitter's saved look through the citizen portrait renderer (the same one
// the builder and the card use) and leaves the PNG bytes on the window for the panel capture to keep as the panel's
// fixture portrait. Bench only; never part of a product bundle.
//   /src/citizen-card/sitting.html?size=512
import { createPortraitRenderer } from '../avatar-builder/portrait-renderer';
import { SITTER, SITTER_LOOK, SITTER_RECORDS, SITTER_WORN } from './sitter';

declare global {
  interface Window { __chatdomReady?: boolean; __chatdomSitting?: { size: number; png: string; look: unknown; sitter: unknown; records: unknown; worn: unknown } }
}

const size = Math.min(1024, Math.max(128, Number(new URLSearchParams(location.search).get('size')) || 512));
const renderer = createPortraitRenderer();
try {
  const canvas = renderer.render(SITTER_LOOK, size);
  const png = canvas.toDataURL('image/png');
  const image = new Image();
  image.src = png;
  image.alt = 'Wren Tarnwalker’s portrait (SIMULATED)';
  image.width = Math.min(size, 384);
  document.getElementById('root')!.append(image);
  window.__chatdomSitting = { size, png, look: SITTER_LOOK, sitter: SITTER, records: SITTER_RECORDS, worn: SITTER_WORN.map(offer => ({ key: offer.key, name: offer.name, story: offer.story, piece: offer.piece })) };
} finally {
  renderer.dispose();
}
window.__chatdomReady = true;
