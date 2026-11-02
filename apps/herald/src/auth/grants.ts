/**
 * Herald reads chat through an app-token conduit. Twitch only delivers when the people involved have
 * previously granted this client the right scopes, so every capability is derived from recorded grants,
 * never from holding the app secret.
 */
export const READER_SCOPES = ['user:bot', 'user:read:chat', 'user:write:chat'] as const;
/**
 * The monarch's grant. Follows, rewards and polls ask for the manage scopes: the same grant then lets the monarch's
 * own scripts create Chatdom's rewards and open a decree poll on their channel, and Herald settle the redemptions.
 */
export const BROADCASTER_SCOPES = ['channel:bot', 'moderator:read:chatters', 'bits:read', 'channel:read:hype_train',
  'moderator:read:followers', 'channel:manage:redemptions', 'channel:manage:polls', 'channel:manage:raids', 'moderator:read:shield_mode'] as const;
export const HERALD_SCOPES: readonly string[] = [...READER_SCOPES, ...BROADCASTER_SCOPES];

export type Role = 'reader' | 'broadcaster';
export type Capability = 'chat' | 'chatters' | 'stream' | 'revocation' | 'bits' | 'hype' | 'follows' | 'rewards' | 'polls' | 'raids' | 'shield';
export const CAPABILITIES: readonly Capability[] = ['chat', 'chatters', 'stream', 'revocation', 'bits', 'hype', 'follows', 'rewards', 'polls', 'raids', 'shield'];

export const ROLE_SCOPES: Readonly<Record<Role, readonly string[]>> = { reader: READER_SCOPES, broadcaster: BROADCASTER_SCOPES };

/** Which role must have granted which scopes for each capability. */
const REQUIREMENTS: Readonly<Record<Capability, ReadonlyArray<{ readonly role: Role; readonly scopes: readonly string[] }>>> = {
  // channel.chat.message and its cleanup types (message_delete, clear, clear_user_messages) over a conduit.
  chat: [{ role: 'reader', scopes: ['user:bot', 'user:read:chat'] }, { role: 'broadcaster', scopes: ['channel:bot'] }],
  // Get Chatters with an app token, the broadcaster as moderator_id.
  chatters: [{ role: 'broadcaster', scopes: ['moderator:read:chatters'] }],
  // Get Streams and stream.online/offline need only the app token.
  stream: [],
  // user.authorization.revoke is conditioned on the client ID alone.
  revocation: [],
  // channel.bits.use: cheers and Power-ups, the sky's answer.
  bits: [{ role: 'broadcaster', scopes: ['bits:read'] }],
  // channel.hype_train.begin/progress/end v2: the festival train and the dragon.
  hype: [{ role: 'broadcaster', scopes: ['channel:read:hype_train'] }],
  // channel.follow v2, the broadcaster as moderator: a new home on the edge of town.
  follows: [{ role: 'broadcaster', scopes: ['moderator:read:followers'] }],
  // channel.channel_points_custom_reward_redemption.add: Chatdom's kingdom rewards.
  rewards: [{ role: 'broadcaster', scopes: ['channel:manage:redemptions'] }],
  // channel.poll.begin/progress/end: the decree board, and the decrees the kingdom carries out.
  polls: [{ role: 'broadcaster', scopes: ['channel:manage:polls'] }],
  // These grants do not gate observing raids: only the monarch's Start/Cancel presses and Shield Mode reads.
  raids: [{ role: 'broadcaster', scopes: ['channel:manage:raids'] }],
  shield: [{ role: 'broadcaster', scopes: ['moderator:read:shield_mode'] }],
};

export type AccountState = 'resolved' | 'not_designated' | 'not_found' | 'unchecked';

export interface Account {
  readonly role: Role;
  readonly login: string | null;
  readonly id: string | null;
  readonly displayName: string | null;
  readonly state: AccountState;
  /** null until Get Authorization By User has answered for this account. */
  readonly authorized: boolean | null;
  readonly granted: readonly string[];
}

export type AppTokenState =
  | { readonly state: 'valid'; readonly expiresAt: number }
  | { readonly state: 'unavailable'; readonly reason: string };

export type Blocker =
  | { readonly kind: 'app_token'; readonly reason: string }
  | { readonly kind: 'not_designated'; readonly role: Role }
  | { readonly kind: 'account_not_found'; readonly role: Role; readonly login: string }
  | { readonly kind: 'grant_unchecked'; readonly role: Role; readonly login: string }
  | { readonly kind: 'not_authorized'; readonly role: Role; readonly login: string; readonly scopes: readonly string[] }
  | { readonly kind: 'missing_scopes'; readonly role: Role; readonly login: string; readonly scopes: readonly string[] };

export interface CapabilityStatus {
  readonly capability: Capability;
  readonly available: boolean;
  readonly blockers: readonly Blocker[];
}

export function assessCapabilities(app: AppTokenState, accounts: Readonly<Record<Role, Account>>): CapabilityStatus[] {
  return CAPABILITIES.map(capability => {
    if (app.state !== 'valid') return { capability, available: false, blockers: [{ kind: 'app_token', reason: app.reason }] };
    const blockers: Blocker[] = [];
    for (const { role, scopes } of REQUIREMENTS[capability]) {
      const blocker = blockerFor(accounts[role], scopes);
      if (blocker) blockers.push(blocker);
    }
    return { capability, available: blockers.length === 0, blockers };
  });
}

function blockerFor(account: Account, required: readonly string[]): Blocker | null {
  if (account.state === 'not_designated' || account.login === null) return { kind: 'not_designated', role: account.role };
  if (account.state === 'not_found') return { kind: 'account_not_found', role: account.role, login: account.login };
  if (account.state === 'unchecked' || account.authorized === null) return { kind: 'grant_unchecked', role: account.role, login: account.login };
  if (!account.authorized) return { kind: 'not_authorized', role: account.role, login: account.login, scopes: [...required] };
  const missing = missingScopes(account.granted, required);
  return missing.length === 0 ? null : { kind: 'missing_scopes', role: account.role, login: account.login, scopes: missing };
}

export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  const have = new Set(granted);
  return required.filter(scope => !have.has(scope));
}

/**
 * Consent expands this client's existing grant for the resolved account; it never narrows it.
 * Preserve even scopes owned by other Chatdom features, not just known Herald scopes.
 */
export function scopesToRequest(role: Role, alreadyGranted: readonly string[]): string[] {
  return [...new Set([...ROLE_SCOPES[role], ...alreadyGranted])].sort();
}
