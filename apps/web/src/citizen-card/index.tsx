/**
 * The citizen card (spec 19). Main mounts `CitizenCard` wherever a person or their house is opened and binds its
 * `CardHost`; the default export is the SIMULATED bench. Neither pulls in three.js: portraits arrive as images.
 */
export { CitizenCard, type CardMode } from './CitizenCard';
export type { CardCue, CardHost, CardLight, CardLoad } from './host';
export type { CardAssetRef, CitizenCardDocument } from './host';
export { default } from './CardBench';
