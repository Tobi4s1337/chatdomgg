import { describe, expect, it } from 'vitest';
import { classify } from '../public/routes';

describe('raid public read allowlist', () => {
  it('publishes only literal roads and pennant reads; service commands stay private', () => {
    for (const prefix of ['', '/live-realm-data']) {
      for (const path of ['/realm/raid-roads', '/realm/raid-pennants/123']) expect(classify(`${prefix}${path}`, '')).toEqual({ kind: 'realm' });
      for (const path of ['/realm/raid-roads/private', '/realm/raid-pennants/001', '/realm/raid-pennants/%31',
        '/internal/realm/chat-commands', '/internal/realm/raid-gate/observe']) expect(classify(`${prefix}${path}`, '').kind).not.toBe('realm');
    }
  });
});
