// Imported from grand-land directly: this module loads under kingdom/scene.ts (via play/providers), so going through
// scene.ts would read the registry before it has been evaluated.
import { registerKingdomLayer } from '../kingdom/grand-land/kingdom-layer';
import { registerPierKingdomLayer } from './kingdom-layer';

/** The pier's lanterns, mist and chat lines wherever the kingdom is drawn, walking, watching or on stream (SEAMS 3a). */
registerPierKingdomLayer(registerKingdomLayer);
