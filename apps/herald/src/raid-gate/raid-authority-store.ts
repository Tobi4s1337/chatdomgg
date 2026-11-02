import { TwitchIdSchema, TwitchLoginSchema } from '@chatdom/shared';
import { isTwitchFailure, type GrantIdentity, type FetchLike, Secret, send, TWITCH_ID_URL, TwitchRequestError, ValidationSchema } from '@chatdom/twitch';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { isInside } from '../source/bindings';

/** The one scope the raid control needs. */
export const RAID_SCOPE = 'channel:manage:raids';
export const RAID_AUTHORITY_FILE = 'raid-authority.json';
const FILE_VERSION = 1;
const MAX_FILE_BYTES = 64 * 1024;
const AAD_LABEL = 'chatdom.herald.raid-authority.v1';

/**
 * `HERALD_TOKEN_KEY`: exactly 32 bytes as base64 (standard or URL alphabet, padding optional). Anything else is
 * refused rather than stretched or truncated, so a mistyped key never seals a token nobody can open again.
 */
export function decodeTokenKey(raw: string): Buffer | null {
  const text = raw.trim();
  if (!/^[A-Za-z0-9+/_-]{43}={0,1}$/u.test(text)) return null;
  const key = Buffer.from(text.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64');
  return key.length === 32 ? key : null;
}

export type RaidAuthorityStoreFault = 'corrupt' | 'tampered' | 'insecure' | 'inside_repository' | 'unreadable' | 'unwritable';

export class RaidAuthorityStoreError extends Error {
  override readonly name = 'RaidAuthorityStoreError';
  constructor(readonly fault: RaidAuthorityStoreFault) {
    super(`raid authority store ${fault.replace('_', ' ')}`);
  }
}

/** What Herald keeps of the broadcaster's grant. The refresh token only ever exists sealed on disk. */
export interface HeldAuthority {
  readonly userId: string;
  readonly login: string;
  readonly scopes: readonly string[];
  readonly recordedAt: number;
}

export type AuthorityRecord =
  | (HeldAuthority & { readonly state: 'held'; readonly refresh: Secret })
  | (HeldAuthority & { readonly state: 'revoked'; readonly revokedAt: number });

const Sealed = z.strictObject({
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  data: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/u),
});
const FileSchema = z.strictObject({
  version: z.literal(FILE_VERSION),
  clientId: z.string().regex(/^[A-Za-z0-9]{8,64}$/u),
  userId: TwitchIdSchema,
  login: TwitchLoginSchema,
  scopes: z.array(z.string().min(1).max(128)).max(512),
  recordedAt: z.number().int().nonnegative(),
  revokedAt: z.number().int().nonnegative().nullable(),
  sealed: Sealed.nullable(),
}).refine(file => (file.revokedAt === null) === (file.sealed !== null), 'A held grant is sealed; a revoked one is not.');
type AuthorityFile = z.infer<typeof FileSchema>;

export interface RaidAuthorityStoreOptions {
  /** Absolute, outside the repository. */
  readonly dataDir: string;
  readonly key: Buffer;
  /** The app the grant was given to. A record for another client is not this Herald's to use. */
  readonly clientId: string;
  readonly repositoryRoot?: string | null;
}

/**
 * The broadcaster's raid control at rest: `<dataDir>/raid-authority.json`, owner-only. The refresh token is sealed
 * with AES-256-GCM under `HERALD_TOKEN_KEY`; the associated data binds it to the Twitch user, the client and the
 * recorded login, scopes and time, so a moved, edited or re-keyed record fails closed. Writes are atomic: a synced
 * temporary file renamed over the record, then the directory synced.
 */
export class RaidAuthorityStore {
  readonly path: string;
  readonly #options: RaidAuthorityStoreOptions;
  #serial: Promise<unknown> = Promise.resolve();

  constructor(options: RaidAuthorityStoreOptions) {
    if (options.key.length !== 32) throw new RangeError('The raid authority key must be 32 bytes');
    this.#options = options;
    this.path = join(options.dataDir, RAID_AUTHORITY_FILE);
  }

  /** The record, or null when nothing is stored for this client. Throws `RaidAuthorityStoreError` when it cannot tell. */
  async read(): Promise<AuthorityRecord | null> {
    await this.#directory(false);
    let text: string;
    try {
      const info = await stat(this.path);
      if ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new RaidAuthorityStoreError('insecure');
      if (info.size > MAX_FILE_BYTES) throw new RaidAuthorityStoreError('corrupt');
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if (error instanceof RaidAuthorityStoreError) throw error;
      if (isCode(error, 'ENOENT')) return null;
      throw new RaidAuthorityStoreError('unreadable');
    }
    let file: AuthorityFile;
    try {
      file = FileSchema.parse(JSON.parse(text));
    } catch {
      throw new RaidAuthorityStoreError('corrupt');
    }
    // A grant given to another app is not this Herald's: as if nothing were stored.
    if (file.clientId !== this.#options.clientId) return null;
    const held: HeldAuthority = { userId: file.userId, login: file.login, scopes: file.scopes, recordedAt: file.recordedAt };
    if (file.sealed === null) return { ...held, state: 'revoked', revokedAt: file.revokedAt ?? file.recordedAt };
    return { ...held, state: 'held', refresh: this.#open(file.sealed, held) };
  }

  /** Keeps a fresh grant, replacing whatever was stored. */
  write(authority: HeldAuthority, refresh: Secret): Promise<void> {
    return this.#serialize(() => this.#persist({ version: FILE_VERSION, clientId: this.#options.clientId, ...normalize(authority),
      revokedAt: null, sealed: this.#seal(refresh, authority) }));
  }

  /**
   * Twitch rotated the refresh token. Only the grant it was issued for is updated: a re-grant recorded meanwhile by
   * `authorize` wins, and so does a revocation.
   */
  rotate(authority: HeldAuthority, refresh: Secret): Promise<boolean> {
    return this.#serialize(async () => {
      const current = await this.read();
      if (current?.state !== 'held' || current.recordedAt !== authority.recordedAt || current.userId !== authority.userId) return false;
      await this.#persist({ version: FILE_VERSION, clientId: this.#options.clientId, ...normalize(current), revokedAt: null, sealed: this.#seal(refresh, current) });
      return true;
    });
  }

  /**
   * Twitch definitely refused the grant. The token is dropped from disk; the record stays so standing reads
   * `revoked` across restarts, until the broadcaster grants again.
   */
  revoke(authority: HeldAuthority, at: number): Promise<boolean> {
    return this.#serialize(async () => {
      const current = await this.read();
      if (current?.state !== 'held' || current.recordedAt !== authority.recordedAt || current.userId !== authority.userId) return false;
      await this.#persist({ version: FILE_VERSION, clientId: this.#options.clientId, ...normalize(current), revokedAt: Math.max(at, current.recordedAt), sealed: null });
      return true;
    });
  }

  #seal(refresh: Secret, authority: HeldAuthority): AuthorityFile['sealed'] {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#options.key, iv);
    cipher.setAAD(this.#aad(authority));
    const data = Buffer.concat([cipher.update(refresh.reveal(), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
  }

  #open(sealed: NonNullable<AuthorityFile['sealed']>, authority: HeldAuthority): Secret {
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#options.key, Buffer.from(sealed.iv, 'base64url'));
      decipher.setAAD(this.#aad(authority));
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'));
      const plain = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64url')), decipher.final()]).toString('utf8');
      return new Secret(plain);
    } catch {
      throw new RaidAuthorityStoreError('tampered');
    }
  }

  #aad(authority: HeldAuthority): Buffer {
    const { userId, login, scopes, recordedAt } = normalize(authority);
    return Buffer.from(JSON.stringify([AAD_LABEL, userId, this.#options.clientId, login, scopes, recordedAt]), 'utf8');
  }

  async #directory(create: boolean): Promise<void> {
    const { dataDir, repositoryRoot } = this.#options;
    if (!isAbsolute(dataDir)) throw new RaidAuthorityStoreError('unwritable');
    if (repositoryRoot && isInside(resolve(repositoryRoot), resolve(dataDir))) throw new RaidAuthorityStoreError('inside_repository');
    if (create) await mkdir(dataDir, { recursive: true, mode: 0o700 }).catch(() => { throw new RaidAuthorityStoreError('unwritable'); });
    const info = await stat(dataDir).catch(() => null);
    if (!info) {
      if (create) throw new RaidAuthorityStoreError('unwritable');
      return;
    }
    // Others may list the directory; nobody else may replace what is in it.
    if (!info.isDirectory() || (info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new RaidAuthorityStoreError('insecure');
  }

  async #persist(file: AuthorityFile): Promise<void> {
    await this.#directory(true);
    const temporary = `${this.path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify(file)}\n`); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, this.path);
      await syncDirectory(this.#options.dataDir);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (error instanceof RaidAuthorityStoreError) throw error;
      throw new RaidAuthorityStoreError('unwritable');
    }
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#serial.then(task);
    this.#serial = run.catch(() => undefined);
    return run;
  }
}

function normalize(authority: HeldAuthority): HeldAuthority & { readonly scopes: string[] } {
  return { userId: authority.userId, login: authority.login, scopes: [...new Set(authority.scopes)].sort(), recordedAt: authority.recordedAt };
}

export async function syncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === code;
}

const UserTokenSchema = z.object({
  access_token: z.string().min(1).max(512),
  refresh_token: z.string().min(1).max(1024).optional(),
  expires_in: z.number().int().positive().optional(),
  token_type: z.string().regex(/^bearer$/iu),
});

/**
 * The authorization-code exchange that keeps the refresh token: the same checks as `confirmGrant` (the validation
 * answer is authoritative for user, client and scopes), but the refresh token is handed back, still wrapped, for the
 * caller to seal. The access token is never kept.
 */
export async function exchangeUserCode(input: {
  readonly clientId: string; readonly clientSecret: Secret; readonly code: Secret; readonly redirectUri: string;
  readonly fetch: FetchLike; readonly timeoutMs?: number; readonly signal?: AbortSignal; readonly idUrl?: string;
}): Promise<{ readonly identity: GrantIdentity; readonly refresh: Secret | null }> {
  const idUrl = input.idUrl ?? TWITCH_ID_URL;
  let raw: unknown;
  try {
    ({ body: raw } = await send(input.fetch, { operation: 'authorization code exchange', method: 'POST', url: new URL('/oauth2/token', idUrl),
      form: new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret.reveal(), code: input.code.reveal(),
        grant_type: 'authorization_code', redirect_uri: input.redirectUri }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), signal: input.signal }));
  } catch (error) {
    if (isTwitchFailure(error, 'forbidden') || isTwitchFailure(error, 'unauthorized')) throw new TwitchRequestError('credentials_rejected', 'authorization code exchange', error.status);
    throw error;
  }
  const exchanged = UserTokenSchema.safeParse(raw);
  if (!exchanged.success) throw new TwitchRequestError('invalid_response', 'authorization code exchange');
  const access = new Secret(exchanged.data.access_token);
  const identity = await validateUserToken({ access, fetch: input.fetch, idUrl, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.signal ? { signal: input.signal } : {}) });
  return { identity: identity.grant, refresh: exchanged.data.refresh_token ? new Secret(exchanged.data.refresh_token) : null };
}

/** `/oauth2/validate` for a user token: who it speaks for, for which client, with which scopes, for how long. */
export async function validateUserToken(input: {
  readonly access: Secret; readonly fetch: FetchLike; readonly idUrl?: string; readonly timeoutMs?: number; readonly signal?: AbortSignal;
}): Promise<{ readonly grant: GrantIdentity; readonly expiresIn: number }> {
  const { body } = await send(input.fetch, { operation: 'validate user token', method: 'GET', url: new URL('/oauth2/validate', input.idUrl ?? TWITCH_ID_URL),
    headers: { Authorization: `OAuth ${input.access.reveal()}` }, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), signal: input.signal });
  const validation = ValidationSchema.safeParse(body);
  if (!validation.success) throw new TwitchRequestError('invalid_response', 'validate user token');
  const userId = TwitchIdSchema.safeParse(validation.data.user_id);
  const login = TwitchLoginSchema.safeParse(validation.data.login);
  if (!userId.success || !login.success) throw new TwitchRequestError('invalid_response', 'validate user token');
  return { grant: { clientId: validation.data.client_id, userId: userId.data, login: login.data, scopes: [...new Set(validation.data.scopes ?? [])].sort() },
    expiresIn: validation.data.expires_in };
}

export { UserTokenSchema };
