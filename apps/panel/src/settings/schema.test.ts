import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parsePanelSettings } from './schema';

describe('public panel preferences', () => {
  it('refuses coercible band values before they can become purchase configuration', () => {
    for (const band of [['a'], ['b'], ['c'], { value: 'a' }, null, 1, true]) {
      expect(parsePanelSettings({ ...DEFAULT_SETTINGS, gifts: [{ giftId: 'kites', band }] })).toBeNull();
    }
  });
  it('preserves a valid literal band without changing the selected gift', () => {
    const settings = { ...DEFAULT_SETTINGS, gifts: [{ giftId: 'kites', band: 'b' }] };
    expect(parsePanelSettings(settings)).toEqual(settings);
  });
});
