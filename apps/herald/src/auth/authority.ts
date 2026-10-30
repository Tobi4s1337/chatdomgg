import { type AppTokenSession, type HelixAuthorization, type HelixReader, type HelixUser, isTwitchFailure, VALIDATE_INTERVAL_MS } from '@chatdom/twitch';
import type { ConfigProblem, HeraldConfig } from '../config';
import {
  type Account, type AppTokenState, assessCapabilities, type Capability, type CapabilityStatus, HERALD_SCOPES, type Role,
} from './grants';

export interface AuthReport {
  readonly observedAt: number;
  /** Every capability is authorized. */
  readonly ok: boolean;
  readonly problems: readonly ConfigProblem[];
  readonly appToken: AppTokenState;
  readonly accounts: Readonly<Record<Role, Account>>;
  readonly capabilities: readonly CapabilityStatus[];
  /** Scopes an account granted this client that Herald does not use (other Chatdom features may). */
  readonly otherScopes: Readonly<Record<Role, readonly string[]>>;
  /** Redacted reasons for reads that failed, so "missing" is never confused with "unknown". */
  readonly failures: readonly string[];
}

export interface AuthorityDeps {
  readonly config: HeraldConfig;
  /** Null when the app credentials are not configured; every capability then reports why. */
  readonly tokens: AppTokenSession | null;
  readonly helix: HelixReader | null;
  readonly now?: () => number;
}

const TOKEN_CHANGED = 'app token changed during authorization inspection';

function uncheckedAccounts(config: HeraldConfig): Record<Role, Account> {
  const account = (role: Role, login: string | null): Account => ({
    role, login, id: null, displayName: null,
    state: login === null ? 'not_designated' : 'unchecked', authorized: null, granted: [],
  });
  return { broadcaster: account('broadcaster', config.channelLogin), reader: account('reader', config.readerLogin) };
}

/**
 * One full authorization reading: app token, the configured accounts by login and their recorded grants.
 * It performs only public identity and app/grant reads.
 */
export async function inspectAuthorization(deps: AuthorityDeps): Promise<AuthReport> {
  const now = deps.now ?? Date.now;
  const { config } = deps;
  const failures: string[] = [];
  const logins: Record<Role, string | null> = { broadcaster: config.channelLogin, reader: config.readerLogin };
  let tokenGeneration = 0;
  const unsubscribe = deps.tokens?.on(() => { tokenGeneration += 1; });

  try {
    let appToken: AppTokenState = { state: 'unavailable', reason: 'app credentials are not configured' };
    if (deps.tokens) {
      try {
        await deps.tokens.current();
        appToken = { state: 'valid', expiresAt: deps.tokens.status.expiresAt ?? now() };
      } catch (error) {
        appToken = { state: 'unavailable', reason: describe(error) };
      }
    }

    let users: HelixUser[] | null = null;
    let grants: HelixAuthorization[] | null = null;
    const inspectedGeneration = tokenGeneration;
    const readFailure = (error: unknown): void => {
      const reason = describe(error);
      failures.push(reason);
      if (isTwitchFailure(error) && ['unauthorized', 'wrong_client', 'not_app_token', 'credentials_rejected', 'closed'].includes(error.kind)) {
        appToken = { state: 'unavailable', reason };
      }
    };
    if (appToken.state === 'valid' && deps.helix) {
      try {
        users = await deps.helix.getUsers({ logins: Object.values(logins).filter((login): login is string => login !== null) });
      } catch (error) {
        readFailure(error);
      }
      const ids = users?.map(user => user.id) ?? [];
      if (ids.length > 0) {
        try {
          grants = await deps.helix.getAuthorizationByUser(ids);
        } catch (error) {
          readFailure(error);
        }
      }
    }

    // Reads can renew or lose the token after the initial snapshot. Never certify
    // capabilities using evidence assembled across different token generations.
    if (appToken.state === 'valid') {
      if (!deps.tokens?.status.held) appToken = { state: 'unavailable', reason: 'app token is no longer available' };
      else if (tokenGeneration !== inspectedGeneration) appToken = { state: 'unavailable', reason: TOKEN_CHANGED };
    }

    const account = (role: Role): Account => {
      const login = logins[role];
      if (login === null) return { role, login, id: null, displayName: null, state: 'not_designated', authorized: null, granted: [] };
      if (users === null) return { role, login, id: null, displayName: null, state: 'unchecked', authorized: null, granted: [] };
      const user = users.find(candidate => candidate.login === login);
      if (!user) return { role, login, id: null, displayName: null, state: 'not_found', authorized: null, granted: [] };
      const grant = grants?.find(entry => entry.userId === user.id);
      return {
        role, login, id: user.id, displayName: user.displayName,
        state: grant ? 'resolved' : 'unchecked',
        authorized: grant ? grant.hasAuthorized : null,
        granted: grant ? grant.scopes : [],
      };
    };
    const accounts = { broadcaster: account('broadcaster'), reader: account('reader') };
    return report(now(), config.problems, appToken, accounts, failures);
  } finally {
    unsubscribe?.();
  }
}

function report(observedAt: number, problems: readonly ConfigProblem[], appToken: AppTokenState, accounts: Readonly<Record<Role, Account>>, failures: readonly string[]): AuthReport {
  const capabilities = assessCapabilities(appToken, accounts);
  const otherScopes = {
    broadcaster: accounts.broadcaster.granted.filter(scope => !HERALD_SCOPES.includes(scope)),
    reader: accounts.reader.granted.filter(scope => !HERALD_SCOPES.includes(scope)),
  };
  return { observedAt, ok: capabilities.every(status => status.available), problems, appToken, accounts, capabilities, otherScopes, failures };
}

export type AuthorityEvent =
  | { readonly type: 'report'; readonly report: AuthReport }
  | { readonly type: 'revoked'; readonly role: Role };

type RevocationPhase = 'awaiting_absence' | 'absence_seen';

/**
 * The long-running authorization authority. It validates the app token at start and hourly, rechecks
 * grants after every token renewal, and honors `user.authorization.revoke` for the configured accounts:
 * a revoked role stays blocked until Twitch first reports the grant gone and then reports a new one.
 */
export class HeraldAuthority {
  readonly #deps: AuthorityDeps & { readonly tokens: AppTokenSession; readonly helix: HelixReader };
  readonly #now: () => number;
  readonly #listeners = new Set<(event: AuthorityEvent) => void>();
  readonly #revocations = new Map<Role, RevocationPhase>();
  #report: AuthReport | null = null;
  #refreshing: Promise<AuthReport> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #unsubscribe: (() => void) | null = null;
  #stopped = false;
  #generation = 0;

  constructor(deps: AuthorityDeps & { readonly tokens: AppTokenSession; readonly helix: HelixReader }) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  get report(): AuthReport | null {
    return this.#report;
  }

  /** Changes when previously authorized work must be discarded, even if a fresh grant follows. */
  get generation(): number {
    return this.#generation;
  }

  available(capability: Capability): boolean {
    return this.#report?.capabilities.find(status => status.capability === capability)?.available ?? false;
  }

  on(listener: (event: AuthorityEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<AuthReport> {
    if (this.#unsubscribe) return this.refresh();
    this.#unsubscribe = this.#deps.tokens.on(event => {
      this.#block(event.type === 'invalidated' ? `app token ${event.reason}` : 'checking authorization for the new app token');
      // Expiry replacement is an acquisition too, even when renewal is false.
      if (event.type === 'acquired') void this.refresh().catch(() => undefined);
    });
    this.#timer = setInterval(() => void this.#hourly(), VALIDATE_INTERVAL_MS);
    this.#timer.unref?.();
    return this.refresh();
  }

  /** Rereads grants. Concurrent callers share one reading. */
  refresh(): Promise<AuthReport> {
    if (this.#stopped) return Promise.reject(new Error('Authority stopped'));
    if (this.#refreshing) return this.#refreshing;
    const reading = this.#read().finally(() => {
      if (this.#refreshing === reading) this.#refreshing = null;
    });
    this.#refreshing = reading;
    return reading;
  }

  async #read(): Promise<AuthReport> {
    // A replacement during inspection requires a complete new reading. Bound
    // retries so a repeatedly rejected token cannot create an acquisition loop.
    for (let attempt = 0; attempt < 3 && !this.#stopped; attempt += 1) {
      try {
        await this.#deps.tokens.validate();
      } catch (error) {
        return this.#block(describe(error));
      }
      if (this.#stopped) break;
      const generation = this.#generation;
      const fresh = await inspectAuthorization(this.#deps);
      if (this.#stopped) break;
      if (generation !== this.#generation) {
        if (fresh.appToken.state === 'valid' || fresh.appToken.reason === TOKEN_CHANGED) continue;
        return this.#block(fresh.appToken.reason);
      }
      const settled = this.#settle(fresh);
      this.#report = settled;
      this.#emit({ type: 'report', report: settled });
      return settled;
    }
    return this.#block(this.#stopped ? 'authority stopped' : 'app token changed repeatedly during authorization inspection');
  }

  #block(reason: string): AuthReport {
    this.#generation += 1;
    const blocked = report(this.#now(), this.#deps.config.problems, { state: 'unavailable', reason },
      this.#report?.accounts ?? uncheckedAccounts(this.#deps.config), [reason]);
    if (!this.#stopped) {
      this.#report = blocked;
      this.#emit({ type: 'report', report: blocked });
    }
    return blocked;
  }

  /**
   * A `user.authorization.revoke` notification. Only the configured broadcaster or reader is acted on;
   * returns the affected roles. Consumers drop that role's transient and Twitch-derived private state.
   */
  revoked(userId: string): Role[] {
    const current = this.#report;
    if (!current || this.#stopped) return [];
    const roles = (['broadcaster', 'reader'] as const).filter(role => current.accounts[role].id === userId);
    if (roles.length === 0) return [];
    this.#generation += 1;
    const accounts = { ...current.accounts };
    for (const role of roles) {
      this.#revocations.set(role, 'awaiting_absence');
      accounts[role] = { ...accounts[role], authorized: false, granted: [] };
    }
    this.#report = report(this.#now(), current.problems, current.appToken, accounts, current.failures);
    for (const role of roles) this.#emit({ type: 'revoked', role });
    this.#emit({ type: 'report', report: this.#report });
    return roles;
  }

  stop(): void {
    this.#stopped = true;
    this.#generation += 1;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#listeners.clear();
    this.#report = null;
  }

  async #hourly(): Promise<void> {
    await this.refresh().catch(() => undefined);
  }

  #settle(fresh: AuthReport): AuthReport {
    for (const [role, phase] of this.#revocations) {
      const account = fresh.accounts[role];
      if (account.state !== 'resolved') continue;
      if (!account.authorized) this.#revocations.set(role, 'absence_seen');
      else if (phase === 'absence_seen') this.#revocations.delete(role);
    }
    if (this.#revocations.size === 0) return fresh;
    const accounts = { ...fresh.accounts };
    for (const role of this.#revocations.keys()) accounts[role] = { ...accounts[role], authorized: false, granted: [] };
    return report(fresh.observedAt, fresh.problems, fresh.appToken, accounts, fresh.failures);
  }

  #emit(event: AuthorityEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // One consumer's failure cannot block revocation reaching the others.
      }
    }
  }
}

export function describe(error: unknown): string {
  if (isTwitchFailure(error)) return error.message;
  if (error instanceof RangeError) return 'request was outside Twitch limits';
  return 'unexpected failure (details withheld)';
}
