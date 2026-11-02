// `@chatdom/ui/site`: the kit's public pieces for pages on chatdom.io and for surfaces that link back to it, with no
// framework. Solid owners can use the components exported from `@chatdom/ui` instead; both draw the same markup.
export * from './pieces.mjs';
export { GLITCH_URL, howItWorksPicture } from './assets';
export { SIGNIN_NOTICES, SIGNIN_ROUTES, readOutcome, signInHref, signInReturnPath, type SignInOutcome } from './signin';
export { RETURN_VIEW_KEY, rememberReturnView, returnDestination, takeReturnView, walkHref, walkReturnView, type ReturnView } from './return-view';
export { forgetSeats, parseKingdoms, parseSession, readKingdoms, readSession, signOut, type OpenKingdom, type Session } from './session';
export { announceSignInOutcome, atlasFirstWays, createHowItWorks, createSignedInSeal, createSiteFooter, createTwitchMark, createWatchOnTwitch, defaultWay, hideNotice,
  mountSignInSeal, readSealSession, refreshSeals, SESSION_EVENT, showNotice, startSignInSeals, type SealHandle, type SealOptions, type SealWay } from './seal';
