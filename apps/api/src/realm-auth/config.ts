import { REALM_AUTH_ROUTES } from '@chatdom/shared/realm';

export interface RealmAuthConfig {
  readonly mode: 'live' | 'simulated';
  readonly databaseUrl: string;
  readonly schema: string;
  readonly publicOrigin: string;
  readonly redirectUri: string;
  readonly secureCookies: boolean;
  readonly host: string;
  readonly port: number;
  readonly twitch: { readonly clientId: string; readonly clientSecret: string } | null;
  readonly internalSecret: string | undefined;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
export const LIVE_SCHEMA = 'realm';
export const SIMULATED_SCHEMA = 'realm_simulated';

/**
 * Reads ignored environment configuration. Errors name the missing setting, never its value. Live mode has no
 * bypass: it needs Twitch credentials and a live schema. SIMULATED mode needs its own schema and never touches
 * the live one, so simulated people cannot enter live data.
 */
export function readRealmAuthConfig(env: Record<string, string | undefined>): RealmAuthConfig {
  const mode = env.REALM_AUTH_MODE ?? 'live';
  if (mode !== 'live' && mode !== 'simulated') throw new Error('REALM_AUTH_MODE must be live or simulated');
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured; the sign-in service has no in-memory fallback');
  const schema = env.REALM_DATABASE_SCHEMA ?? (mode === 'live' ? LIVE_SCHEMA : SIMULATED_SCHEMA);
  if (!SCHEMA.test(schema) || schema.startsWith('pg_')) throw new Error('REALM_DATABASE_SCHEMA must be a lowercase identifier');
  if (mode === 'simulated' && (schema === LIVE_SCHEMA || schema === 'public')) throw new Error('SIMULATED sign-in must use its own schema, never the live realm schema');
  if (mode === 'live' && /^(?:realm_)?(?:simulated|sim|test)/.test(schema)) throw new Error('Live sign-in cannot use a simulated or test schema');

  let publicOrigin: URL;
  try { publicOrigin = new URL(env.REALM_PUBLIC_ORIGIN ?? 'http://localhost:5190'); } catch { throw new Error('REALM_PUBLIC_ORIGIN must be an absolute origin'); }
  if (publicOrigin.origin === 'null' || publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash) throw new Error('REALM_PUBLIC_ORIGIN must be a bare origin such as https://chatdom.gg');
  const loopback = LOOPBACK.has(publicOrigin.hostname);
  if (publicOrigin.protocol !== 'https:' && !(publicOrigin.protocol === 'http:' && loopback)) throw new Error('REALM_PUBLIC_ORIGIN must use https outside loopback development');

  const port = Number(env.API_PORT ?? 5192);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a TCP port');
  const twitch = mode === 'live' ? { clientId: env.TWITCH_CLIENT_ID ?? '', clientSecret: env.TWITCH_CLIENT_SECRET ?? '' } : null;
  if (twitch && (!twitch.clientId || !twitch.clientSecret)) throw new Error('Live sign-in needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (~/.config/chatdom/atlas.env)');
  const internalSecret = env.REALM_INTERNAL_SECRET || undefined;
  if (internalSecret !== undefined && internalSecret.length < 32) throw new Error('REALM_INTERNAL_SECRET must be at least 32 characters');

  return {
    mode, databaseUrl, schema, publicOrigin: publicOrigin.origin,
    redirectUri: `${publicOrigin.origin}${REALM_AUTH_ROUTES.callback}`,
    secureCookies: publicOrigin.protocol === 'https:', host: env.API_HOST ?? '127.0.0.1', port, twitch, internalSecret,
  };
}
