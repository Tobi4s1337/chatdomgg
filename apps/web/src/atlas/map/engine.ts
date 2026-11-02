/**
 * The moving map's renderer (Pixi and everything drawn with it), split from the scene so the first frame (the
 * still) never waits for its code or its start-up. The scene asks for it once the still is up.
 */
export { MapView } from './view';
export { AtlasRoadsLayer } from '../road/atlas-roads';
