import { describe, expect, it } from 'vitest';
import { classify } from '../../../api/src/public/routes';

/*
 * The public gateway's one line for saved looks (apps/api/src/public/routes.ts): the signed-in person's own look
 * and the public recipe of a token or starter id reach the realm; any other shape under /api/realm/looks is a 404.
 */
describe('the public gateway routes saved looks to the realm', () => {
  it('passes the look routes the realm serves', () => {
    for (const path of ['/api/realm/looks/me', `/api/realm/looks/lk.${'a1'.repeat(20)}`, '/api/realm/looks/hearth', '/api/realm/looks/place']) {
      expect(classify(path, ''), path).toEqual({ kind: 'realm' });
    }
  });

  it('refuses any other shape under /api/realm/looks', () => {
    for (const path of ['/api/realm/looks', '/api/realm/looks/', '/api/realm/looks/me/extra',
      `/api/realm/looks/lk.${'A'.repeat(40)}`, '/api/realm/looks/..%2finternal']) {
      expect(classify(path, ''), path).toEqual({ kind: 'not-found', api: true });
    }
  });
});
