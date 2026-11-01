import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../panel/src/settings/schema';
import { createPanelConfiguration, verifyBroadcaster } from './configuration';

const key = randomBytes(32), secret = key.toString('base64');
const settings = { ...DEFAULT_SETTINGS, hidden: true };
const current = { version: 1, status: 'settings', revision: '1', settings, connected: true };
const claims = { channel_id: '123', user_id: '123', opaque_user_id: 'Uowner', role: 'broadcaster' };
async function signed(payload: Record<string, unknown> = {}, signingKey: Uint8Array = key, algorithm = 'HS256', expires = Math.floor(Date.now() / 1000) + 300) {
  return `Bearer ${await new SignJWT({ ...claims, ...payload, exp: expires }).setProtectedHeader({ alg: algorithm }).sign(signingKey)}`;
}

describe('authenticated panel configuration', () => {
  it('takes the channel only from a verified viewer token and returns a bounded typed reading', async () => {
    const realm = vi.fn(async () => ({ ...current, unexpectedPrivateField: 'must not leave' }));
    const api = createPanelConfiguration({ extensionSecret: secret, realm });
    expect(await api.handle('configuration', await signed({ role: 'viewer', user_id: undefined }), {})).toEqual({ http: 200, body: current });
    expect(realm).toHaveBeenCalledWith('/internal/realm/panel/settings', { kingdomId: '123' });
    expect((await api.handle('configuration', await signed(), { kingdomId: '456' })).http).toBe(400);
    expect(realm).toHaveBeenCalledTimes(1);
  });

  it('saves only with verified broadcaster identity matching the channel, without making Twitch calls', async () => {
    const realm = vi.fn(async () => current), api = createPanelConfiguration({ extensionSecret: secret, realm });
    const authorization = await signed();
    expect(await verifyBroadcaster(authorization, key)).toEqual({ channelId: '123', personId: '123', role: 'broadcaster', kind: 'shared' });
    expect(await api.handle('configure', authorization, { expectedRevision: '0', settings })).toEqual({ http: 200, body: current });
    expect(realm).toHaveBeenCalledWith('/internal/realm/panel/settings-save', { kingdomId: '123', personId: '123', expectedRevision: '0', settings });
  });

  it('refuses malformed, forged, expired, wrong-algorithm, external, unshared and mismatched broadcaster claims before the realm', async () => {
    const realm = vi.fn(async () => current), api = createPanelConfiguration({ extensionSecret: secret, realm });
    const invalid = [null, 'Bearer not-a-jwt', await signed({}, randomBytes(32)), await signed({}, key, 'HS512'),
      await signed({}, key, 'HS256', Math.floor(Date.now() / 1000) - 1),
      await signed({ role: 'viewer' }), await signed({ role: 'moderator' }), await signed({ role: 'external' }),
      await signed({ user_id: '456' }), await signed({ user_id: undefined }), await signed({ channel_id: 'all' }),
      await signed({ opaque_user_id: 'Aanonymous' }), await signed({ is_unlinked: true }), await signed({ is_unlinked: 'true' }),
    ];
    for (const token of invalid) expect((await api.handle('configure', token, { expectedRevision: '0', settings })).http).toBeGreaterThanOrEqual(400);
    const noExpiry = `Bearer ${await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(key)}`;
    expect((await api.handle('configure', noExpiry, { expectedRevision: '0', settings })).http).toBe(401);
    expect(realm).not.toHaveBeenCalled();
  });

  it('rejects body identity, unsupported settings, purchased authority claims, oversized selections and invalid revisions', async () => {
    const realm = vi.fn(async () => current), api = createPanelConfiguration({ extensionSecret: secret, realm }), authorization = await signed();
    const bad = [
      { expectedRevision: '0', settings, personId: '123' }, { expectedRevision: '0', settings, kingdomId: '123' },
      { expectedRevision: '0', settings: { ...settings, version: 2 } },
      { expectedRevision: '0', settings: { ...settings, connected: true } },
      { expectedRevision: '0', settings: { ...settings, gifts: [...settings.gifts, settings.gifts[0]] } },
      { expectedRevision: '0', settings: { ...settings, gifts: [{ giftId: 'unknown', band: 'a' }] } },
      { expectedRevision: '0', settings: { ...settings, gifts: [{ giftId: 'kites', band: 'd' }] } },
      { expectedRevision: '0', settings: { ...settings, tabs: { kingdom: false, you: true, gifts: true } } },
      { expectedRevision: '0', settings: { ...settings, gifts: [settings.gifts[0], settings.gifts[0]] } },
      ...[-1, '01', '1e5', 0, '9223372036854775807'].map(expectedRevision => ({ expectedRevision, settings })),
    ];
    for (const body of bad) expect((await api.handle('configure', authorization, body)).http).toBe(400);
    expect(realm).not.toHaveBeenCalled();
  });

  it('preserves conflicts and fails closed for invalid stored configuration and unavailable authority', async () => {
    const realm = vi.fn(async (): Promise<Record<string, unknown>> => ({ version: 1, status: 'conflict', current }));
    const api = createPanelConfiguration({ extensionSecret: secret, realm }), authorization = await signed();
    expect(await api.handle('configure', authorization, { expectedRevision: '0', settings })).toEqual({ http: 200, body: { version: 1, status: 'conflict', current } });
    realm.mockResolvedValueOnce({ ...current, settings: { ...settings, version: 2 } });
    expect((await api.handle('configuration', authorization, {})).http).toBe(503);
    realm.mockResolvedValueOnce({ ...current, connected: 'true' });
    expect((await api.handle('configuration', authorization, {})).http).toBe(503);
    realm.mockRejectedValueOnce(new Error('Authority unavailable'));
    expect((await api.handle('configure', authorization, { expectedRevision: '0', settings })).http).toBe(503);
    expect((await createPanelConfiguration({ extensionSecret: '', realm }).handle('configuration', authorization, {})).http).toBe(503);
  });
});
