import { expect, it } from 'vitest';
import { FORGE_CHAT_ROUTES } from '@chatdom/shared';
import { classify } from '../../../api/src/public/routes';

it('publishes only the five literal Forge chat doors without exposing encoded or nested service routes', () => {
  for (const path of Object.values(FORGE_CHAT_ROUTES)) {
    expect(classify(path, '?kingdomId=123')).toEqual({ kind: 'realm' });
    for (const invalid of [path + '/', path + '/private', path.replace('/forge/', '/%66orge/'), '/live-realm-data' + path]) {
      expect(classify(invalid, ''), invalid).toEqual({ kind: 'not-found', api: true });
    }
  }
  for (const tail of ['internal', 'send', 'tokens', 'observe', 'state', '%2563allback']) {
    expect(classify('/api/realm/forge/chat/' + tail, '')).toEqual({ kind: 'not-found', api: true });
  }
});
