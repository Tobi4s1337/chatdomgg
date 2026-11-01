/**
 * The frozen sign-in routes (`REALM_AUTH_ROUTES` in @chatdom/shared/realm), spoken without their schemas so the
 * front page stays small, and the return rule of the sign-in service: it accepts `/`, `/<word>` and short plain
 * paths below it, never queries, fragments or hyphenated first segments. Pages it would refuse return to `/`, and
 * the stored view carries the visitor on from there.
 */
export const SIGNIN_ROUTES = { session: '/api/realm/session', start: '/api/realm/auth/start', signout: '/api/realm/signout' } as const;
const RETURN_PATH = /^\/(?:-\/realm|map(?:\/[a-z0-9_]{1,25})?|[a-z0-9_]{1,25}(?:\/[a-z0-9-]{1,32}){0,3})?$/;

export function signInReturnPath(pathname: string): string {
  return RETURN_PATH.test(pathname) ? pathname : '/';
}
export function signInHref(pathname: string): string {
  return `${SIGNIN_ROUTES.start}?returnTo=${encodeURIComponent(signInReturnPath(pathname))}`;
}

export type SignInOutcome = 'declined' | 'expired' | 'refused' | 'unavailable';
/** What each way back from Twitch means, said in the kingdom's voice: what happened, and what to do next. */
export const SIGNIN_NOTICES: Readonly<Record<SignInOutcome | 'signed-out', string>> = {
  declined: 'You turned back at Twitch’s gate, so nothing was shared. The seal is here whenever you want it.',
  expired: 'That sign-in took too long, or began in another browser. Press the seal once more.',
  refused: 'Twitch’s answer could not be checked, so nobody was signed in. Press the seal to try again.',
  unavailable: 'Twitch or the kingdom could not be reached just now. Nothing changed. Try again in a moment.',
  'signed-out': 'You have signed out. Your home keeps its place for you.',
};
export function readOutcome(search: string): SignInOutcome | null {
  const value = new URLSearchParams(search).get('signin');
  return value === 'declined' || value === 'expired' || value === 'refused' || value === 'unavailable' ? value : null;
}
