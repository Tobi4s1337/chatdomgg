/**
 * The passport in the Chatdom panel (spec 45), for main to bind. `PanelPassport` fills a 318 x 496 slot (or the
 * phone sheet) with the viewer's own book read through a transport; `passportExtensionTransport` reads it from the
 * kingdom's Extension backend with the Helper's token. Main owns the mount, the endpoint and the subject.
 */
export { PanelPassport, type PanelPassportProps } from './PanelPassport';
export { PANEL_DENSITY, simulatedOrigin } from './model';
export { PANEL_PASSPORT_REPLY_LIMIT, PanelPassportUnauthorized, passportExtensionTransport, type PanelPassportEndpoint } from './transport';
