/**
 * The throne's Raid Gate rules, kept apart from the view so they can be read and tested on their own. The gate's
 * authority decides everything; the dock only decides whom it offers the press to and how it tells a missing
 * Twitch permission.
 */
import type { GateAuthority } from '../../api/src/raid-gate/contracts';
import type { RaidGateApi } from '../../web/src/raid-gate/ports';

/** The gate's one URL for this kingdom (spec 23 RG07). The kingdom rides in the path; the role is the server's. */
export const raidGateUrl = (kingdomId: string) => `/api/raid-gate/${encodeURIComponent(kingdomId)}`;

/**
 * Only the monarch is offered the press. A moderator sees no Raid Gate at all rather than a royal button that cannot
 * be pressed; the gate's authority refuses everyone but the verified broadcaster regardless (spec 23 R1).
 */
export function offersRaidGate(state: Readonly<{ principal: Readonly<{ role: 'broadcaster' | 'moderator' }> }> | undefined): boolean {
  return state?.principal.role === 'broadcaster';
}

/**
 * The page where Herald asks Twitch for the monarch's raid permission, from the build's
 * `VITE_CHATDOM_RAID_GRANT_URL`. Only an https address or a path on this site is accepted; anything else means the
 * dock has no reconnect to offer.
 */
export function raidGrantUrl(raw: unknown, origin: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  if (value.startsWith('/') && !value.startsWith('//')) {
    try { return new URL(value, origin).origin === new URL(origin).origin ? value : null; } catch { return null; }
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export type AuthorityExplainer = Readonly<{
  heading: string;
  body: string;
  /** `reconnect`: a press that opens Twitch's permission page. `keeper`: a line saying who renews it. */
  remedy: 'reconnect' | 'keeper' | null;
  press: string | null;
  after: string | null;
}>;

/**
 * Why the monarch's gate cannot open yet, told plainly. A missing, withdrawn or switched-off permission offers the
 * reconnect only when a grant page exists; otherwise it names who renews it, with no button.
 */
export function explainAuthority(authority: Exclude<GateAuthority, 'ready'> | null, kingdom: string, canReconnect: boolean): AuthorityExplainer {
  const permission = (body: string, press: string): AuthorityExplainer => canReconnect
    ? { heading: 'Chatdom needs your Twitch permission', body, remedy: 'reconnect', press,
      after: 'Twitch opens on its own page. Once you have approved, come back and check again.' }
    : { heading: 'Chatdom needs your Twitch permission', body, remedy: 'keeper', press: null,
      after: `Your kingdom's keeper renews this permission with Twitch for ${kingdom}. Once it is renewed, check again here.` };
  switch (authority) {
    case 'not-connected':
      return permission(`Raids start on Twitch, so Twitch asks you once to let Chatdom start them from ${kingdom}'s channel. Nothing is sent to Twitch until you open the gate yourself.`, 'Give permission on Twitch');
    case 'revoked':
      return permission(`Twitch no longer lets Chatdom start raids for ${kingdom}. That happens when the connection is removed on Twitch. Renew the permission, and the gate can open again.`, 'Renew on Twitch');
    case 'disabled':
      return permission(`Chatdom isn't allowed to act on Twitch for ${kingdom} right now, so it can't start a raid for you. The gate opens once your Twitch permission is in place.`, 'Give permission on Twitch');
    case 'offline':
      return { heading: 'The gate opens while you are live', body: 'Raids leave from a live stream. Go live on Twitch, and your people can gather at the gate.', remedy: null, press: null, after: null };
    default:
      return { heading: "We couldn't check your raid permission", body: "We couldn't confirm your Twitch raid permission just now. Nothing has been sent, and you can check again in a moment.", remedy: null, press: null, after: null };
  }
}

/** Whether the session that sent a command is still the one signed in: `same`, `changed`, or a rejection when unknown. */
export type SessionCheck = () => Promise<'same' | 'changed'>;

/**
 * The dock's session rule around the gate: after each command, the session is checked again before its reply is
 * applied, so a replaced identity never inherits an answer. A changed session ends the sheet (`lost`) and the reply
 * is dropped as a transport failure; the controller then asks the authority what happened instead of sending again.
 * Nothing is ever resent from here.
 */
export function guardGateApi(api: RaidGateApi, check: SessionCheck, lost: () => void): RaidGateApi {
  return {
    origin: api.origin,
    async request(command, signal) {
      const reply = await api.request(command, signal);
      if (await check() === 'changed') {
        lost();
        throw new Error('The session changed before the gate answered.');
      }
      return reply;
    },
    subscribe: (requestId, onReply, signal) => api.subscribe(requestId, onReply, signal),
  };
}
