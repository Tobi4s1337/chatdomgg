import type { Pool } from 'pg';
import { createRealmAuthenticator } from '../auth/authenticator';
import type { RealmChannelSender } from '../room-channels';
import type { ItemTransaction } from './store';
import type { RealmReadiness } from '../diagnostics/readiness';
import { postgresItemClient } from './postgres';

export type ItemChannelAdmission = (from: RealmChannelSender, tx: ItemTransaction) => Promise<boolean>;

/** Reuse the realm's actual session rules without checking out a second connection inside a transaction. */
export function createPostgresItemAdmission(options: { pool: Pool; origin: 'live' | 'simulated'; readiness: Pick<RealmReadiness, 'held'> }): ItemChannelAdmission {
  return async (from, tx) => {
    if (options.readiness.held() || !from.present()) return false;
    const scoped = postgresItemClient(tx);
    const queryPool = new Proxy(options.pool, { get(_target, property) {
      if (property === 'query') return scoped.query;
      throw new Error('The transaction session check may only query its own connection.');
    } });
    const auth = createRealmAuthenticator({ pool: queryPool, origin: options.origin });
    return await auth.current(from.principal, Date.now()) && !options.readiness.held() && from.present();
  };
}
