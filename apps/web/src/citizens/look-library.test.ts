import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PORTRAIT_FIXTURES, parseLook, starterLookRecipe } from '@chatdom/content/avatar-style';
import { createCitizenLookLibrary, lookTokenFor } from './look-library';

const recipe = parseLook(PORTRAIT_FIXTURES[7]!.look);
const other = parseLook(PORTRAIT_FIXTURES[9]!.look);
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted((value as Record<string, unknown>)[key])])) : value;
const tokenOf = (look: unknown) => `lk.${createHash('sha256').update(JSON.stringify(sorted(look))).digest('hex').slice(0, 40)}`;
const reply = (token: string, look: unknown, status = 200) => new Response(JSON.stringify({ version: 1, token, look }), { status, headers: { 'content-type': 'application/json' } });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe('citizen look library', () => {
  it('recomputes the realm token from canonical JSON', async () => {
    expect(await lookTokenFor(recipe)).toBe(tokenOf(recipe));
    expect(await lookTokenFor({ b: 1, a: [-0, 'x'] })).toBe(tokenOf({ a: [0, 'x'], b: 1 }));
  });

  it('serves the six starters at once, without a fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const library = createCitizenLookLibrary({ fetch });
    for (const id of ['hearth', 'tide', 'grove', 'clay', 'sun', 'dusk']) {
      expect(library.has(id)).toBe(true);
      expect(library.recipe(id)).toEqual(starterLookRecipe(id));
      expect(library.status(id)).toBe('ready');
    }
    library.request('hearth');
    await expect(library.load('dusk')).resolves.toEqual(starterLookRecipe('dusk'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches an unknown saved look once, checks it and announces it', async () => {
    const token = tokenOf(recipe);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => reply(token, recipe));
    const library = createCitizenLookLibrary({ fetch, base: 'https://realm.test' });
    const ready = vi.fn();
    library.onReady(ready);
    expect(library.has(token)).toBe(false);
    library.request(token); library.request(token);
    const loaded = library.load(token);
    expect(library.status(token)).toBe('loading');
    await expect(loaded).resolves.toEqual(recipe);
    library.request(token);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![0]).toBe(`https://realm.test/api/realm/looks/${token}`);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit' });
    expect(ready).toHaveBeenCalledExactlyOnceWith(token);
    expect(library.has(token)).toBe(true);
    expect(library.recipe(token)).toEqual(recipe);
  });

  it('never asks again after a 404 or a 400', async () => {
    const missing = tokenOf(other), bad = tokenOf({ ...recipe, blush: !recipe.blush });
    const fetch = vi.fn<typeof globalThis.fetch>(async input => new Response('{}', { status: String(input).includes(missing) ? 404 : 400 }));
    const library = createCitizenLookLibrary({ fetch });
    await expect(library.load(missing)).rejects.toThrow('404');
    await expect(library.load(bad)).rejects.toThrow('400');
    library.request(missing); library.request(bad);
    await expect(library.load(missing)).rejects.toThrow('refused');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(library.status(missing)).toBe('refused');
    expect(library.has(missing)).toBe(false);
  });

  it('refuses a reply whose token or recipe does not match what was asked', async () => {
    const token = tokenOf(recipe), otherToken = tokenOf(other);
    const fetch = vi.fn<typeof globalThis.fetch>(async input => String(input).includes(token) ? reply(token, other) : reply(token, recipe));
    const library = createCitizenLookLibrary({ fetch });
    const ready = vi.fn();
    library.onReady(ready);
    // The recipe is a real look, but not the one this token names.
    await expect(library.load(token)).rejects.toThrow('does not match');
    // A reply naming a different token.
    await expect(library.load(otherToken)).rejects.toThrow('something else');
    expect(ready).not.toHaveBeenCalled();
    expect(library.has(token)).toBe(false);
    expect(library.status(otherToken)).toBe('refused');
  });

  it('ignores anything that is not a look token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const library = createCitizenLookLibrary({ fetch });
    for (const value of ['', 'unknown', 'lk.', 'lk.ABC', `lk.${'g'.repeat(40)}`, '../../etc', 'x'.repeat(10_000), 'constructor', '__proto__']) {
      expect(() => library.request(value)).not.toThrow();
      expect(library.has(value)).toBe(false);
      expect(library.recipe(value)).toBeNull();
      expect(library.status(value)).toBe('invalid');
      await expect(library.load(value)).rejects.toThrow('Not a look token');
    }
    library.remember('unknown', recipe);
    expect(library.has('unknown')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries a network failure with backoff, then succeeds', async () => {
    vi.useFakeTimers();
    const token = tokenOf(recipe);
    let calls = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      calls++;
      if (calls === 1) throw new TypeError('network down');
      if (calls === 2) return new Response('busy', { status: 503 });
      return reply(token, recipe);
    });
    const library = createCitizenLookLibrary({ fetch, backoff: { firstMs: 1000, maxMs: 8000, attempts: 5 } });
    library.request(token);
    await vi.advanceTimersByTimeAsync(0);
    expect(library.status(token)).toBe('waiting');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(library.has(token)).toBe(true));
  });

  it('gives up a run after its attempts and lets a later request start again', async () => {
    vi.useFakeTimers();
    const token = tokenOf(recipe);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new TypeError('offline'); });
    const library = createCitizenLookLibrary({ fetch, backoff: { firstMs: 10, maxMs: 20, attempts: 2 } });
    const loaded = library.load(token);
    const failed = expect(loaded).rejects.toThrow('offline');
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(library.status(token)).toBe('idle');
    library.request(token);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('remembers a recipe already held and draws it without a round trip', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const library = createCitizenLookLibrary({ fetch });
    const ready = vi.fn();
    library.onReady(ready);
    const token = tokenOf(recipe);
    library.remember(token, recipe);
    expect(library.has(token)).toBe(true);
    expect(ready).toHaveBeenCalledWith(token);
    library.request(token);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the most recently used recipes within its capacity', () => {
    const library = createCitizenLookLibrary({ fetch: vi.fn(), capacity: 2 });
    const [a, b, c] = ['a', 'b', 'c'].map(hex => `lk.${hex.repeat(40)}`) as [string, string, string];
    library.remember(a, recipe); library.remember(b, other);
    expect(library.has(a)).toBe(true); // a is now the most recent
    library.remember(c, recipe);
    expect(library.has(b)).toBe(false);
    expect(library.has(a)).toBe(true);
    expect(library.has(c)).toBe(true);
  });

  it('stops waiting when a load is aborted', async () => {
    const token = tokenOf(recipe);
    const library = createCitizenLookLibrary({ fetch: vi.fn<typeof globalThis.fetch>(() => new Promise(() => {})) });
    const controller = new AbortController();
    const loaded = library.load(token, controller.signal);
    controller.abort(new Error('closed'));
    await expect(loaded).rejects.toThrow('closed');
    await settle();
  });
});
