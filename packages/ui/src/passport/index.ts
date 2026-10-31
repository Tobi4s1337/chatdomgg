/**
 * `@chatdom/ui/passport`: the raid passport's book (spec 45). Surfaces validate a `PassportBook` with the frozen
 * schema and pass it through the card's disclosure gate before handing a visible book to `PassportBook`.
 * `createPassportReading` + `PassportReading` read one through a checked transport and show every state honestly.
 */
export * from './craft';
export { PassportBook, type PassportBookProps } from './Book';
export { PassportReading, createPassportReading, type PassportReadingProps } from './Reading';
export { PassportStampMark } from './Stamp';
export { ChargeMark, CrestArms } from './Arms';
