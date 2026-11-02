import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import type { Pool } from 'pg';
import type { KingdomId } from '@chatdom/shared';
import type { DurableRealmServices } from '../persistence';
import { createForgeChatService, ForgeChatCipher, forgeChatConfig, installForgeChatSchema,
  mountForgeChatRoutes, PostgresForgeChatStore } from '../forge-chat';
import { forgeChatAuthority } from './forge-chat-authority';

/** Additive composition only. Sign-in, Herald intake and the Forge write gate retain their authority. */
export async function createRealmForgeChat(options: {
  readonly pool: Pool;
  readonly origin: 'live' | 'simulated';
  readonly services: Pick<DurableRealmServices, 'retain'>;
  readonly founded: (kingdomId: KingdomId) => boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}) {
  const env = options.env ?? process.env;
  let publicOrigin: URL;
  try { publicOrigin = new URL(env.REALM_PUBLIC_ORIGIN ?? 'http://localhost:5190'); }
  catch { throw new Error('Forge chat requires a valid REALM_PUBLIC_ORIGIN.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(publicOrigin.hostname);
  if (publicOrigin.origin === 'null' || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== '/'
    || publicOrigin.search || publicOrigin.hash || (publicOrigin.protocol !== 'https:' && !(loopback && publicOrigin.protocol === 'http:'))) {
    throw new Error('Forge chat requires a bare HTTPS public origin, or HTTP loopback for development.');
  }
  const config = await forgeChatConfig(publicOrigin.origin, env);
  await installForgeChatSchema(options.pool);
  const store = new PostgresForgeChatStore(options.pool, options.origin,
    config ? new ForgeChatCipher(config.tokenKey, config.clientId) : null);
  const authority = forgeChatAuthority(options);
  const service = createForgeChatService({ origin: options.origin, store, config, ...authority });
  return {
    observe: service.observe,
    start: service.start,
    stop: service.stop,
    mount(app: uWebSocketsTransport['app']) {
      mountForgeChatRoutes(app, service, { pool: options.pool, origin: options.origin,
        publicOrigin: publicOrigin.origin, secureCookies: publicOrigin.protocol === 'https:' });
    },
  };
}
