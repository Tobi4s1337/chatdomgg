/**
 * The raid passport's server side (spec 45). Main binds `createPassportReader` to the real card source, Gate
 * passport, kingdom directory, witnessed roads, accepted gift receipts and the visits, bonds and keepsakes
 * authorities, and mounts `createPassportHttp` beside the public card, with `createPassportShareHttp` (and a renderer
 * such as `createChromiumPassportImageRenderer`) answering the 1200 x 800 share image. Browsers import `contracts.ts`
 * only.
 */
export * from './contracts';
export { createPassportReader, type PassportPorts, type PassportReadContext, type PassportReadFault, type PassportReader, type RevisionedPage } from './read';
export { enrichGateStamps, type AcceptedGiftRecord, type EnrichedStamps, type EnrichmentGap, type StampFacts, type WitnessedRoad } from './gate';
export { createPassportHttp, type PassportHttpOptions, type PassportSubject } from './http';
export { simulatedPassportAuthorities, type SimulatedPassport, type SimulatedScenario } from './simulated';
export { PassportRendererBusy, createPassportShareHttp, isShareImage, type PassportImageRenderer, type PassportShareFault, type PassportShareHttpOptions } from './share';
export { createChromiumPassportImageRenderer, type ChromiumPassportRenderer, type ChromiumPassportRendererOptions } from './chromium';
export { passportFontFaces } from './fonts';
