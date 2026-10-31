/**
 * The passport (spec 45) for main to bind. The book, its reading states and its session come from
 * `@chatdom/ui/passport`; `passportHttpTransport` reads main's passport route through the boundary reader.
 * `CardPassport` is the citizen card page's adapter: the open book plus the print of its shared spread, served by
 * `createPassportShareHttp` in `apps/api/src/passport`. The default export is the SIMULATED bench at `/-/passport`.
 */
export { PassportBook, PassportReading, createPassportReading, type PassportBookProps, type PassportReadingProps } from '@chatdom/ui/passport';
export { passportHttpTransport, passportLocalTransport } from './transport';
export { CardPassport, type CardPassportProps, type CardPassportShare } from './CardPassport';
export { default } from './PassportBench';
