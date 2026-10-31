/*
 * The citizen, for main to wire into the kingdom, the stream, the card and the passport, and the builder for the
 * web page and the Twitch panel. Every surface draws the same person from the same recipe.
 *
 * - `citizenObject(look, { dim })`: the whole citizen as a three.js group in avatar cells (scale 1/16 for metres),
 *   voxels with per-vertex colour, lenses, and a cape at rest. `noCape` leaves the cape to a cloth runtime,
 *   which takes its cut from `capeCut(look.earned.cape)`.
 * - `createPortraitRenderer().render(look, size, { view })` / `.renderBlob(...)`: the bust portrait on the
 *   Twitch-purple gradient for the card and the passport, or the whole figure.
 * - `AvatarBuilder`: the builder, `layout: 'page' | 'panel'`, saving through the `LookAuthority` main supplies.
 * - From the content package: `twitchDefaultLook`, `settleLook`, `earnedOffers`, `checkEarned`, `wornIn`,
 *   `subLapsed`, `parseLook`.
 */
export { citizenObject, citizenMaterial, citizenGlassMaterial, citizenGeometry, disposeCitizen, createPortraitRenderer, type CitizenOptions, type PortraitOptions, type PortraitRenderer, type PortraitView } from './portrait-renderer';
export { animateCape, capeObject, disposeCape } from './cape';
export { createTurntable, type Turntable, type TurntableOptions } from './turntable';
export { AvatarBuilder, type AvatarBuilderProps, type BuilderSounds, type LookAuthority, type SaveResult } from './AvatarBuilder';
export { TABS, type TabId } from './catalogue';
