import { TwitchLoginSchema } from '@chatdom/shared';
import { Secret } from '@chatdom/twitch';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/** The only channel this lane reads for real acceptance. */
export const DEFAULT_CHANNEL_LOGIN = 'tobi4s_';
/** The local grant helper's callback port (Spec 03). */
export const AUTHORIZE_CALLBACK_PORT = 5195;

export interface ConfigProblem {
  readonly key: string;
  readonly issue: 'missing' | 'invalid' | 'unreadable' | 'readable_by_others';
}

export interface HeraldConfig {
  readonly channelLogin: string;
  readonly channelLoginDefaulted: boolean;
  readonly readerLogin: string | null;
  readonly redirectUri: URL | null;
  readonly credentials: { readonly clientId: string; readonly clientSecret: Secret } | null;
  readonly problems: readonly ConfigProblem[];
  readonly secretsFile: string;
  readonly settingsFile: string;
}

export interface ConfigSources {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: string;
  readonly readText?: (path: string) => Promise<string>;
  readonly fileMode?: (path: string) => Promise<number>;
}

/**
 * Loads Herald's configuration without ever placing a secret in `process.env` or a command line.
 *
 * - App keys (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`) come only from the external secrets file,
 *   `~/.config/chatdom/atlas.env` unless `HERALD_TWITCH_ENV_FILE` names another.
 * - Nonsecret `HERALD_*` settings come from the process environment, falling back to the optional
 *   `~/.config/chatdom/herald.env` (or `HERALD_ENV_FILE`), where deployment settings live outside the repo.
 */
export async function loadConfig(sources: ConfigSources = {}): Promise<HeraldConfig> {
  const env = sources.env ?? process.env;
  const home = sources.home ?? homedir();
  const readText = sources.readText ?? (path => readFile(path, 'utf8'));
  const fileMode = sources.fileMode ?? (async path => (await stat(path)).mode);
  const problems: ConfigProblem[] = [];

  const settingsFile = env.HERALD_ENV_FILE ?? join(home, '.config', 'chatdom', 'herald.env');
  let fileSettings: Record<string, string | undefined> = {};
  try {
    fileSettings = parseEnv(await readText(settingsFile));
  } catch (error) {
    if (!isMissingFile(error)) problems.push({ key: 'HERALD_ENV_FILE', issue: 'unreadable' });
  }
  const setting = (key: string): string | null => {
    const value = (env[key] ?? fileSettings[key])?.trim();
    return value ? value : null;
  };

  const rawChannel = setting('HERALD_CHANNEL_LOGIN');
  let channelLogin = DEFAULT_CHANNEL_LOGIN;
  if (rawChannel !== null) {
    const parsed = TwitchLoginSchema.safeParse(rawChannel.toLowerCase());
    if (parsed.success) channelLogin = parsed.data;
    else problems.push({ key: 'HERALD_CHANNEL_LOGIN', issue: 'invalid' });
  }

  const rawReader = setting('HERALD_READER_LOGIN');
  let readerLogin: string | null = null;
  if (rawReader === null) problems.push({ key: 'HERALD_READER_LOGIN', issue: 'missing' });
  else {
    const parsed = TwitchLoginSchema.safeParse(rawReader.toLowerCase());
    if (parsed.success) readerLogin = parsed.data;
    else problems.push({ key: 'HERALD_READER_LOGIN', issue: 'invalid' });
  }

  const rawRedirect = setting('HERALD_REDIRECT_URI');
  let redirectUri: URL | null = null;
  if (rawRedirect === null) problems.push({ key: 'HERALD_REDIRECT_URI', issue: 'missing' });
  else {
    redirectUri = parseRedirect(rawRedirect);
    if (redirectUri === null) problems.push({ key: 'HERALD_REDIRECT_URI', issue: 'invalid' });
  }

  const secretsFile = env.HERALD_TWITCH_ENV_FILE ?? join(home, '.config', 'chatdom', 'atlas.env');
  let credentials: HeraldConfig['credentials'] = null;
  try {
    const mode = await fileMode(secretsFile);
    if ((mode & 0o077) !== 0) problems.push({ key: 'HERALD_TWITCH_ENV_FILE', issue: 'readable_by_others' });
    const secrets = parseEnv(await readText(secretsFile));
    const clientId = secrets.TWITCH_CLIENT_ID?.trim() ?? '';
    const clientSecret = secrets.TWITCH_CLIENT_SECRET?.trim() ?? '';
    if (!clientId) problems.push({ key: 'TWITCH_CLIENT_ID', issue: 'missing' });
    else if (!/^[A-Za-z0-9]{8,64}$/.test(clientId)) problems.push({ key: 'TWITCH_CLIENT_ID', issue: 'invalid' });
    if (!clientSecret) problems.push({ key: 'TWITCH_CLIENT_SECRET', issue: 'missing' });
    if (/^[A-Za-z0-9]{8,64}$/.test(clientId) && clientSecret) credentials = { clientId, clientSecret: new Secret(clientSecret) };
  } catch (error) {
    problems.push({ key: 'HERALD_TWITCH_ENV_FILE', issue: isMissingFile(error) ? 'missing' : 'unreadable' });
  }

  return { channelLogin, channelLoginDefaulted: rawChannel === null, readerLogin, redirectUri, credentials, problems, secretsFile, settingsFile };
}

/** A redirect URI Twitch could have registered: absolute https, or http on a loopback host. No query or fragment. */
export function parseRedirect(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.search || url.hash || url.username || url.password) return null;
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return url;
  return null;
}

/** The helper can only receive the callback itself when Twitch redirects to loopback on the helper's port. */
export function isLocalCallback(url: URL): boolean {
  return url.protocol === 'http:' && isLoopback(url.hostname) && url.port === String(AUTHORIZE_CALLBACK_PORT);
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT';
}
