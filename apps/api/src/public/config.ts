import { isAbsolute, resolve } from 'node:path';
import { parseTarget, parseTrustedProxies, type ProxyTarget, type TrustedProxies } from './proxy';

/** One kingdom the front door offers, by its Twitch channel id and login (for "Watch on Twitch"). */
export interface DoorKingdom { readonly kingdomId: string; readonly login: string }

export interface PublicConfig {
  readonly host: string;
  readonly port: number;
  /** The scheme visitors use (`https` behind the host's TLS), told to the realm in X-Forwarded-Proto. */
  readonly proto: 'http' | 'https';
  readonly webRoot: string;
  readonly doorKingdoms: readonly DoorKingdom[];
  /** `spawn` runs and supervises the realm build on `realm.port`; `proxy` uses a realm that is already running. */
  readonly realm: { readonly mode: 'spawn' | 'proxy'; readonly target: ProxyTarget; readonly entry: string };
  readonly optional: { readonly herald: ProxyTarget | null; readonly map: ProxyTarget | null; readonly forge: ProxyTarget | null };
  readonly extension: { readonly clientId: string; readonly secret: string } | null;
  /** Whether search engines may list the site (`PUBLIC_INDEXING`, closed unless set to open). See ./site.ts. */
  readonly indexing: 'closed' | 'open';
  /** The host's TLS proxy (PUBLIC_TRUSTED_PROXIES), whose X-Forwarded-For names the visitor; null trusts nobody. */
  readonly trustedProxies: TrustedProxies | null;
}

const KINGDOM = /^([1-9][0-9]{0,31}):([a-z0-9_]{1,25})$/;

/** Reads the public server's own settings. Errors name the setting, never its value. */
export function readPublicConfig(env: Record<string, string | undefined>, repoRoot: string): PublicConfig {
  const port = Number(env.PUBLIC_PORT ?? 5175);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PUBLIC_PORT must be a TCP port');
  let origin: URL;
  try { origin = new URL(env.REALM_PUBLIC_ORIGIN ?? `http://localhost:${port}`); }
  catch { throw new Error('REALM_PUBLIC_ORIGIN must be an absolute http(s) origin'); }
  const proto = origin.protocol === 'https:' ? 'https' : 'http';
  const at = (path: string) => (isAbsolute(path) ? path : resolve(repoRoot, path));

  const doorKingdoms = (env.PUBLIC_KINGDOMS ?? '').split(',').map(item => item.trim()).filter(Boolean).map(item => {
    const match = KINGDOM.exec(item);
    if (!match) throw new Error('PUBLIC_KINGDOMS must list kingdoms as <channel id>:<login>, comma separated');
    return { kingdomId: match[1]!, login: match[2]! };
  });
  if (!doorKingdoms.length) throw new Error('PUBLIC_KINGDOMS must name at least one kingdom for the front door');

  const existing = env.PUBLIC_REALM_TARGET?.trim();
  const realmPort = Number(env.REALM_PORT ?? 5173);
  if (!existing && (!Number.isInteger(realmPort) || realmPort < 5170 || realmPort > 5199)) throw new Error('REALM_PORT must be a port in 5170–5199');
  // The realm's rooms and reads live at its root; the web app reaches them under /live-realm-data (as in development).
  const realmTarget = parseTarget('PUBLIC_REALM_TARGET', existing || `http://127.0.0.1:${realmPort}`, '/live-realm-data');
  const optional = (name: string, strip: string) => { const value = env[name]?.trim(); return value ? parseTarget(name, value, strip) : null; };

  const clientId = env.TWITCH_EXTENSION_CLIENT_ID?.trim() ?? '', secret = env.TWITCH_EXTENSION_SECRET?.trim() ?? '';
  if (Boolean(clientId) !== Boolean(secret)) throw new Error('Set both TWITCH_EXTENSION_CLIENT_ID and TWITCH_EXTENSION_SECRET, or neither');

  const indexing = env.PUBLIC_INDEXING?.trim() || 'closed';
  if (indexing !== 'closed' && indexing !== 'open') throw new Error('PUBLIC_INDEXING must be closed or open');

  return {
    host: env.PUBLIC_HOST ?? '127.0.0.1', port, proto,
    webRoot: at(env.PUBLIC_WEB_ROOT ?? 'apps/web/dist'),
    doorKingdoms,
    realm: { mode: existing ? 'proxy' : 'spawn', target: realmTarget, entry: at('apps/realm/dist/realm.mjs') },
    optional: { herald: optional('PUBLIC_HERALD_TARGET', '/presence-data'), map: optional('PUBLIC_MAP_TARGET', '/map-data'), forge: optional('PUBLIC_FORGE_TARGET', '/forge-data') },
    extension: clientId ? { clientId, secret } : null,
    indexing,
    trustedProxies: parseTrustedProxies('PUBLIC_TRUSTED_PROXIES', env.PUBLIC_TRUSTED_PROXIES),
  };
}

/**
 * The simulated sign-in provider signs anyone in as anyone. It exists for development on a loopback origin, so the
 * server refuses to start with it on an https origin, where real visitors could reach it.
 */
export function refuseSimulatedOnHttps(mode: 'live' | 'simulated', publicOrigin: string): void {
  if (mode === 'simulated' && publicOrigin.startsWith('https:')) {
    throw new Error('REALM_AUTH_MODE=simulated cannot serve an https REALM_PUBLIC_ORIGIN; the public origin needs live Twitch sign-in');
  }
}
