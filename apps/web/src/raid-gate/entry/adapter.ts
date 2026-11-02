import { REALM_AUTH_ROUTES, REALM_ENTRY_ROUTE, RealmEntryInfoSchema, RealmSessionReplySchema } from '@chatdom/shared/realm';
import { parseRaidWelcomePath, RAID_GUEST_PREFIX, RaidGuestBeginReplySchema, RaidGuestReadReplySchema } from '../../../../api/src/raid-gate/guest-contracts';
import type { KingdomEntrySource, KingdomEntryConnection } from '../../kingdom-entry/types';
import { RealmEntryError, readRealmJson, type RealmFetch } from '../../realm/adapters/entry';

export type RaidWelcomeStatus =
  | { kind: 'checking' | 'pending' | 'ordinary' | 'unavailable'; message: string }
  | { kind: 'choice'; message: string }
  | { kind: 'confirmed'; message: string; watchUrl: string };

export interface RaidWelcomeEntryOptions {
  pathname: string;
  fetcher: RealmFetch;
  /** The existing live entry source remains the only ticket and room authority. */
  openKingdom(info: { kingdomId: ReturnType<typeof RealmEntryInfoSchema.parse>['kingdomId']; kingdomName: string }): KingdomEntrySource;
  status(value: RaidWelcomeStatus): void;
  now?: () => number;
  pollMs?: number;
  confirmationMs?: number;
}

/** A welcome link is an invitation. Only a successful room join followed by the private read greets a guest. */
export function createRaidWelcomeEntry(options: RaidWelcomeEntryOptions): { open: KingdomEntrySource; enterOrdinarily(): void } {
  const route = parseRaidWelcomePath(options.pathname);
  if (!route) throw new RealmEntryError('refused', 'This raid invitation is not a kingdom gate.');
  const { kingdomId, raidId } = route, now = options.now ?? Date.now;
  const endpoint = `${RAID_GUEST_PREFIX}/${encodeURIComponent(kingdomId)}`;
  let ordinary = false;
  const request = async (path: string, signal: AbortSignal, init?: RequestInit) => {
    const response = await options.fetcher(path, { credentials: 'same-origin', cache: 'no-store', signal,
      ...init, headers: { Accept: 'application/json', ...init?.headers } });
    if (!response.ok) throw new RealmEntryError(response.status === 401 ? 'unauthenticated' : 'unavailable',
      response.status === 401 ? 'Sign in with Twitch to walk into this kingdom.' : `The raid gate is unavailable (HTTP ${response.status}).`);
    return readRealmJson(response, 'Reading the raid gate');
  };
  const open: KingdomEntrySource = async signal => {
    options.status({ kind: 'checking', message: 'Checking your invitation at the gate.' });
    const session = RealmSessionReplySchema.safeParse(await request(REALM_AUTH_ROUTES.session, signal));
    if (!session.success) throw new RealmEntryError('unavailable', 'The gate could not verify your sign-in.');
    if (session.data.status === 'anonymous' || session.data.expiresAt <= now()) {
      throw new RealmEntryError('unauthenticated', 'Sign in with Twitch to walk into this kingdom.');
    }
    const info = RealmEntryInfoSchema.safeParse(await request(REALM_ENTRY_ROUTE.replace(':kingdomId', encodeURIComponent(kingdomId)), signal));
    if (!info.success || info.data.kingdomId !== kingdomId || info.data.origin !== 'live') {
      throw new RealmEntryError('unavailable', 'The kingdom’s approved name is not available yet.');
    }
    let invited = false;
    if (!ordinary) {
      const begin = RaidGuestBeginReplySchema.safeParse(await request(endpoint, signal, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.data.csrfToken },
        body: JSON.stringify({ version: 1, raidId }) }));
      if (!begin.success) throw new RealmEntryError('unavailable', 'The raid gate answered in a way we cannot trust.');
      if (begin.data.status === 'refused') {
        if (begin.data.reason === 'session' || begin.data.reason === 'not_signed_in') {
          throw new RealmEntryError('unauthenticated', 'Your visit has ended. Sign in with Twitch again.');
        }
        if (begin.data.reason !== 'citizen_here') {
          const message = begin.data.reason === 'expired' ? 'This raid’s arrival window has ended. You can still visit the kingdom.'
            : begin.data.reason === 'unknown_raid' ? 'This raid invitation could not be found. You can still visit the kingdom.'
              : 'The gate could not tie this visit to the raid. You can still enter the kingdom.';
          options.status({ kind: 'choice', message });
          throw new RealmEntryError('refused', message);
        }
        options.status({ kind: 'ordinary', message: 'Your home is here. The gate is bringing you home.' });
      } else {
        const invitation = begin.data.invitation;
        if (invitation.kingdomId !== kingdomId || invitation.raidId !== raidId || invitation.expiresAt <= now()) {
          throw new RealmEntryError('unavailable', 'The raid invitation does not match this gate or has expired.');
        }
        invited = true;
        options.status({ kind: 'pending', message: 'Opening the kingdom. Your arrival will be checked once you are inside.' });
      }
    } else options.status({ kind: 'ordinary', message: 'Opening the kingdom for your visit.' });
    signal.throwIfAborted();
    const connection = await options.openKingdom({ kingdomId, kingdomName: info.data.name })(signal);
    if (!invited) return connection;
    const confirmation = new AbortController();
    const abort = () => confirmation.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { connection.dispose(); abort(); signal.throwIfAborted(); }
    void confirm(connection, confirmation.signal).finally(() => signal.removeEventListener('abort', abort));
    return { ...connection, dispose(reason) { confirmation.abort(); connection.dispose(reason); } };
  };

  async function confirm(connection: KingdomEntryConnection, signal: AbortSignal): Promise<void> {
    const deadline = new AbortController();
    const duration = Math.max(1, Math.min(options.confirmationMs ?? 5_000, 5_000));
    const timer = setTimeout(() => deadline.abort(), duration);
    const combined = AbortSignal.any([signal, deadline.signal]);
    const attempts = Math.min(11, Math.ceil(duration / Math.max(1, options.pollMs ?? 500)) + 1);
    try {
      for (let attempt = 0; attempt < attempts; attempt++) {
        combined.throwIfAborted();
        const reply = RaidGuestReadReplySchema.safeParse(await request(endpoint, combined));
        if (!reply.success) throw new Error('The gate could not verify the arrival record.');
        if (reply.data.guest) {
          const guest = reply.data.guest, room = connection.client.room.state;
          if (guest.raidId !== raidId || guest.kingdomId !== kingdomId || guest.to.kingdomId !== kingdomId || guest.origin !== 'live'
            || room.kingdomId !== kingdomId || room.origin !== guest.origin) throw new Error('The arrival record does not match this kingdom.');
          const name = room.walkers.get(connection.client.selfId)?.name;
          if (!name?.trim()) throw new Error('Your name has not arrived from the kingdom yet.');
          if (!combined.aborted) options.status({ kind: 'confirmed', message: `Welcome, ${name}, with ${guest.from.name}’s raid.`,
            watchUrl: `https://www.twitch.tv/${guest.to.login}` });
          return;
        }
        if (attempt + 1 < attempts) await pause(Math.max(1, options.pollMs ?? 500), combined);
      }
      if (!signal.aborted) options.status({ kind: 'pending', message: 'You are inside. The gate has not confirmed your raid arrival yet.' });
    } catch {
      if (!signal.aborted) options.status(deadline.signal.aborted
        ? { kind: 'pending', message: 'You are inside. The gate has not confirmed your raid arrival yet.' }
        : { kind: 'unavailable', message: 'You are inside. Your raid arrival could not be checked right now.' });
    } finally { clearTimeout(timer); }
  }
  return { open, enterOrdinarily() { ordinary = true; } };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Entry was cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
