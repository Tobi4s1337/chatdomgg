/**
 * `@chatdom/ui/passport`: the raid passport's book (spec 45). Surfaces validate a `PassportBook` with the frozen
 * schema and pass it through the card's disclosure gate before handing a visible book to `PassportBook`.
 */
export * from './craft';
export { PassportBook, type PassportBookProps } from './Book';
export { PassportStampMark } from './Stamp';
export { ChargeMark, CrestArms } from './Arms';
