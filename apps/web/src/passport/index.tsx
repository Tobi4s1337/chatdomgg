/**
 * The passport (spec 45) for main to bind. The book, its reading states and its session come from
 * `@chatdom/ui/passport`; `passportHttpTransport` reads main's passport route through the boundary reader. The
 * default export is the SIMULATED bench mounted at `/-/passport`.
 */
export { PassportBook, PassportReading, createPassportReading, type PassportBookProps, type PassportReadingProps } from '@chatdom/ui/passport';
export { passportHttpTransport, passportLocalTransport } from './transport';
export { default } from './PassportBench';
