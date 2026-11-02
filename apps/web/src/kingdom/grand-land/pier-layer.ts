import { registerKingdomLayer } from './kingdom-layer';
import { registerPierKingdomLayer } from '../../fishing/kingdom-layer';

/*
 * The pier's lanterns in every kingdom scene (pier SEAMS 3a). The kingdom scene imports this module once, so the
 * stream view, a watcher's page, the panel's painter and the walk all draw the same lanterns. A kingdom without an
 * installed pier mounts nothing. It imports the layer registry directly rather than `kingdom/scene.ts`, so the
 * scene can import this file without a cycle; the pier's own module stays the pier's.
 */
registerPierKingdomLayer(registerKingdomLayer);
