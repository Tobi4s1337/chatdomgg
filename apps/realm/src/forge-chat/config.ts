import { FORGE_CHAT_ROUTES } from '@chatdom/shared';
import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

export interface ForgeChatConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly tokenKey: Buffer;
}

/** Separate opt-in settings: absence never borrows the sign-in or broadcaster grant. */
export async function forgeChatConfig(publicOrigin: string, env: Readonly<Record<string, string | undefined>> = process.env): Promise<ForgeChatConfig | null> {
  const { TWITCH_CLIENT_ID: clientId, TWITCH_CLIENT_SECRET: clientSecret,
    FORGE_CHAT_REDIRECT_URI: redirectUri, FORGE_CHAT_TOKEN_KEY_FILE: path } = env;
  if (env.FORGE_CHAT_ENABLED !== '1' || !clientId || !clientSecret || !redirectUri || !path) return null;
  let url: URL;
  try { url = new URL(redirectUri); } catch { return null; }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password
    || url.search || url.hash || url.pathname !== FORGE_CHAT_ROUTES.callback
    || redirectUri !== publicOrigin + FORGE_CHAT_ROUTES.callback) return null;
  if (!isAbsolute(path)) return null;
  try {
    const actualPath = await realpath(path);
    let checkout = process.cwd();
    // pnpm may launch from apps/realm; find the workspace rather than permitting a key elsewhere in it.
    while (!existsSync(join(checkout, 'pnpm-workspace.yaml')) && dirname(checkout) !== checkout) checkout = dirname(checkout);
    const inside = relative(checkout, actualPath);
    if (inside !== '..' && !inside.startsWith('../') && !isAbsolute(inside)) return null;
    const info = await stat(actualPath);
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size > 256) return null;
    const encoded = (await readFile(actualPath, 'utf8')).trim();
    if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return null;
    const tokenKey = Buffer.from(encoded, 'base64');
    if (tokenKey.length !== 32) return null;
    return { clientId, clientSecret, redirectUri, tokenKey };
  } catch { return null; }
}
