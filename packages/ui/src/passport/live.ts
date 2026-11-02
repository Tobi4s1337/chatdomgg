/** Shared book and reading without the bench-only fixture exports. Validate the wire before use. */
export { PassportBook, type PassportBookProps } from './Book';
export { PassportReading, createPassportReading, type PassportReadingProps } from './Reading';
export { ChargeMark, CrestArms } from './Arms';
export { createPassportSession, followDisclosure, newerDisclosure, continuesBook,
  type PassportDisclosureView, type PassportPageReplyView, type PassportReadState, type PassportReplyView,
  type PassportRequestView, type PassportSession, type PassportTransport } from './session';
export type * from './types';
export type { BookLayout, PageDensity, PassportShelf } from './pages';
