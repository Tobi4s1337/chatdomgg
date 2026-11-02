import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestTavern } from './test-entry';

vi.mock('./client', () => ({ connectTavern: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

describe('local tavern inspection admission', () => {
  it('allows the explicit gather loopback address to request only its local test issuer', async () => {
    const fetch = vi.fn(async () => { throw new Error('No local fixture is running'); });
    vi.stubGlobal('location', { hostname: '127.0.0.10', origin: 'http://127.0.0.10:5171' });
    vi.stubGlobal('fetch', fetch);
    await expect(openLocalTestTavern(new URLSearchParams('testWalker=1'))).rejects.toThrow('No local fixture');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.10:5171/live-realm-data/reference/session', { method: 'POST', cache: 'no-store' });
  });

  it.each([
    ['chatdom.gg', 'http://127.0.0.10:5170', '1'],
    ['127.0.0.10', 'https://chatdom.gg', '1'],
    ['127.0.0.10', 'http://127.0.0.10.example.com', '1'],
    ['127.0.0.10', 'http://127.0.0.11:5170', '1'],
    ['127.0.0.10', 'http://127.0.0.10:5170', '0'],
  ])('refuses %s to %s with testWalker=%s before fetching', async (hostname, endpoint, testWalker) => {
    const fetch = vi.fn();
    vi.stubGlobal('location', { hostname, origin: `http://${hostname}:5171` });
    vi.stubGlobal('fetch', fetch);
    await expect(openLocalTestTavern(new URLSearchParams({ testWalker, realm: endpoint }))).rejects.toThrow('Enter the tavern from your kingdom');
    expect(fetch).not.toHaveBeenCalled();
  });
});
