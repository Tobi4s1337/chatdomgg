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

/**
 * One full authorization reading: app token, the configured accounts by login and their recorded grants.
 * It performs only public identity and app/grant reads.
 */
export async function inspectAuthorization(deps: AuthorityDeps): Promise<AuthReport> {
  const now = deps.now ?? Date.now;
  const { config } = deps;
  const failures: string[] = [];
  const logins: Record<Role, string | null> = { broadcaster: config.channelLogin, reader: config.readerLogin };

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
  if (appToken.state === 'valid' && deps.helix) {
    try {
      users = await deps.helix.getUsers({ logins: Object.values(logins).filter((login): login is string => login !== null) });
    } catch (error) {
      failures.push(describe(error));
    }
    const ids = users?.map(user => user.id) ?? [];
    if (ids.length > 0) {
      try {
        grants = await deps.helix.getAuthorizationByUser(ids);
      } catch (error) {
        failures.push(describe(error));
      }
    }
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

  constructor(deps: AuthorityDeps & { readonly tokens: AppTokenSession; readonly helix: HelixReader }) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  get report(): AuthReport | null {
    return this.#report;
  }

  available(capability: Capability): boolean {
    return this.#report?.capabilities.find(status => status.capability === capability)?.available ?? false;
  }

  on(listener: (event: AuthorityEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<AuthReport> {
    this.#unsubscribe = this.#deps.tokens.on(event => {
      if (event.type === 'acquired' && event.renewal) void this.refresh().catch(() => undefined);
    });
    this.#timer = setInterval(() => void this.#hourly(), VALIDATE_INTERVAL_MS);
    this.#timer.unref?.();
    return this.refresh();
  }

  /** Rereads grants. Concurrent callers share one reading. */
  refresh(): Promise<AuthReport> {
    if (this.#stopped) return Promise.reject(new Error('Authority stopped'));
    if (this.#refreshing) return this.#refreshing;
    const reading = inspectAuthorization(this.#deps).then(fresh => {
      const settled = this.#settle(fresh);
      if (!this.#stopped) {
        this.#report = settled;
        this.#emit({ type: 'report', report: settled });
      }
      return settled;
    }).finally(() => {
      if (this.#refreshing === reading) this.#refreshing = null;
    });
    this.#refreshing = reading;
    return reading;
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
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#listeners.clear();
    this.#report = null;
  }

  async #hourly(): Promise<void> {
    try {
      await this.#deps.tokens.validate();
    } catch {
      // The refresh below reports the app token as unavailable; nothing keeps running on a bad token.
    }
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
