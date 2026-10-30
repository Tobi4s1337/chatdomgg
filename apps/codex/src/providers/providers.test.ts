import { describe, expect, it, vi } from 'vitest';
import { createForgeProviders, ForgeProviderColdError } from './index';
import { forgeJudgeQuestions } from './policy';
import type { CodexDraftRunner } from './codex-cli';
import type { ForgeDraft, ForgeHouseSocket } from '../../../../packages/shared/src/index';

const safetyIdentifier = 'sha256_citizen_1234567890';
const wish = 'A sleeping dragon chimney with copper scales.';
const draft: ForgeDraft = { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'copper', accent: 'scales' }, title: 'The Dozing Ember', plaque: 'A little dragon keeps the hearth warm.' };
const socket: ForgeHouseSocket = { id: 'stack', kind: 'chimney', profile: 'stack', origin: [0, 0, 0], supports: [[0, 0, 0]], hostId: 'home', hostFingerprint: 'hash', clearanceHeight: 8 };
const sheet = 'data:image/png;base64,iVBORw0KGgo=';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function luna(image = false, overrides: Record<string, number> = {}) {
  return { model: 'gpt-6-luna', answers: forgeJudgeQuestions(image).map(({ name }) => ({ type: 'predicate', name, probability: overrides[name] ?? 0.01 })), usage: { input_tokens: 60 } };
}
function httpMock(decisions: unknown = luna(), moderation: unknown = { model: 'omni-moderation-latest', results: [{ flagged: false }] }, second: unknown = { status: 'completed', model: 'gpt-6.1-terra', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"outcome":"pass"}' }] }] }) {
  return vi.fn<typeof fetch>(async (url) => response(String(url).endsWith('/decisions') ? decisions : String(url).endsWith('/moderations') ? moderation : second));
}
const config = (http: typeof fetch) => ({ apiKey: 'test-secret-not-a-real-key', fetch: http });

describe('independent Forge judges', () => {
  it('requires API credentials without calling either endpoint', async () => {
    const http = httpMock();
    const providers = createForgeProviders({ ...config(http), apiKey: '' });
    await expect(providers.judgeWords({ words: 'a dragon chimney', safetyIdentifier })).rejects.toBeInstanceOf(ForgeProviderColdError);
    expect(http).not.toHaveBeenCalled();
  });

  it('starts both gates concurrently and carries opaque safety identifiers', async () => {
    const started: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const http = vi.fn<typeof fetch>(async (url, init) => {
      started.push(String(url));
      const body = JSON.parse(init!.body as string);
      expect(body.safety_identifier).toBe(safetyIdentifier);
      expect(init!.redirect).toBe('error');
      await gate;
      return response(String(url).endsWith('/decisions') ? luna() : { results: [{ flagged: false }] });
    });
    const pending = createForgeProviders(config(http)).judgeWords({ words: 'a dragon chimney', safetyIdentifier });
    expect(started).toHaveLength(2);
    release!();
    const verdict = await pending;
    expect(verdict.outcome).toBe('pass');
    expect(verdict.records).toHaveLength(2);
    expect(JSON.stringify(verdict.records)).not.toContain('test-secret');
    expect(JSON.stringify(verdict.records)).not.toContain('a dragon chimney');
  });

  it('refuses a confident policy breach without echoing the evidence', async () => {
    const http = httpMock(luna(false, { hate: 0.99 }));
    const verdict = await createForgeProviders(config(http)).judgeWords({ words: 'private evidence', safetyIdentifier });
    expect(verdict.outcome).toBe('refuse');
    expect(verdict.reason).not.toContain('private evidence');
  });

  it('holds ambiguous words and never asks the drafting model to decide', async () => {
    const http = httpMock(luna(false, { privacy: 0.4 }));
    const runner = vi.fn();
    expect((await createForgeProviders({ ...config(http), runCodex: runner }).judgeWords({ words: 'a named bust', safetyIdentifier })).outcome).toBe('hold');
    expect(http).toHaveBeenCalledTimes(2);
    expect(runner).not.toHaveBeenCalled();
  });

  it.each([{}, { answers: [] }, { answers: [{ type: 'predicate', name: 'hate', probability: NaN }] }])('holds incomplete or malformed Decisions evidence', async value => {
    expect((await createForgeProviders(config(httpMock(value))).judgeWords({ words: 'a dragon', safetyIdentifier })).outcome).toBe('hold');
  });

  it('makes the Forge cold if Luna cannot answer', async () => {
    const http = vi.fn<typeof fetch>(async url => String(url).endsWith('/decisions') ? response({}, 503) : response({ results: [{ flagged: false }] }));
    await expect(createForgeProviders(config(http)).judgeWords({ words: 'a dragon', safetyIdentifier })).rejects.toMatchObject({ code: 'FORGE_COLD' });
  });

  it('holds if moderation disappears, even with safe Luna answers', async () => {
    const http = vi.fn<typeof fetch>(async url => String(url).endsWith('/moderations') ? response({}, 503) : response(luna()));
    expect((await createForgeProviders(config(http)).judgeWords({ words: 'a dragon', safetyIdentifier })).outcome).toBe('hold');
  });

  it('refuses a moderation flag even if Luna passes', async () => {
    const http = httpMock(luna(), { results: [{ flagged: true }] });
    expect((await createForgeProviders(config(http)).judgeWords({ words: 'a dragon', safetyIdentifier })).outcome).toBe('refuse');
  });

  it('judges composed title and plaque with the actual contact sheet, then asks Terra about uncertainty', async () => {
    const http = httpMock(luna(true, { hate: 0.5 }));
    const verdict = await createForgeProviders(config(http)).judgeResult({ wish, draft, contactSheet: sheet, safetyIdentifier });
    expect(verdict.outcome).toBe('pass');
    const bodies = http.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies[0].input[1].content).toContainEqual({ type: 'input_image', image_url: sheet, detail: 'high' });
    expect(bodies[0].input[1].content[0].text).toContain(`${draft.title}\n${draft.plaque}`);
    expect(bodies[0].input[1].content[0].text).toContain(JSON.stringify(wish));
    expect(bodies[0].questions).toContainEqual(expect.objectContaining({ name: 'unfaithful_subject', instructions: expect.stringContaining('actual contact sheet') }));
    expect(bodies[2]).toMatchObject({ model: 'gpt-6.1-terra', reasoning: { effort: 'none' }, store: false, tools: [], safety_identifier: safetyIdentifier });
    expect(verdict.records).toHaveLength(3);
  });

  it.each(['hate', 'unfaithful_subject'])('never lets a second opinion override a confident %s refusal', async concern => {
    const http = httpMock(luna(true, { [concern]: 0.99, privacy: 0.5 }));
    expect((await createForgeProviders(config(http)).judgeResult({ wish, draft, contactSheet: sheet, safetyIdentifier })).outcome).toBe('refuse');
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('keeps unknown languages private after an image passes', async () => {
    const http = httpMock(luna(true, { uncertain_language: 0.99 }));
    expect((await createForgeProviders(config(http)).judgeResult({ wish, draft, contactSheet: sheet, safetyIdentifier })).outcome).toBe('hold');
  });

  it('holds a malformed Terra answer', async () => {
    const http = httpMock(luna(true, { hate: 0.5 }), undefined, { status: 'completed', output: [] });
    expect((await createForgeProviders(config(http)).judgeResult({ wish, draft, contactSheet: sheet, safetyIdentifier })).outcome).toBe('hold');
  });

  it('bounds a stalled endpoint even when a fetch implementation ignores abort', async () => {
    const http = vi.fn<typeof fetch>(() => new Promise(() => {}));
    await expect(createForgeProviders({ ...config(http), judgeTimeoutMs: 5 }).judgeWords({ words: 'a dragon', safetyIdentifier })).rejects.toBeInstanceOf(ForgeProviderColdError);
  });

  it('rejects oversized judge responses without permitting a result', async () => {
    const http = vi.fn<typeof fetch>(async url => String(url).endsWith('/decisions') ? response({ ...luna(), id: 'x'.repeat(512_001) }) : response({ results: [{ flagged: false }] }));
    await expect(createForgeProviders(config(http)).judgeWords({ words: 'a dragon', safetyIdentifier })).rejects.toMatchObject({ code: 'FORGE_COLD' });
  });

  it('propagates caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const http = httpMock();
    await expect(createForgeProviders(config(http)).judgeWords({ words: 'a dragon', safetyIdentifier, signal: controller.signal })).rejects.toBeDefined();
    expect(http).not.toHaveBeenCalled();
  });

  it('rejects remote image URLs and cleartext nonlocal API destinations', async () => {
    expect(() => createForgeProviders({ baseUrl: 'http://example.com/v1' })).toThrow('HTTPS');
    await expect(createForgeProviders(config(httpMock())).judgeResult({ wish, draft, contactSheet: 'https://example.com/tracking.png', safetyIdentifier })).rejects.toThrow('PNG');
  });
});

describe('Codex draft adapter', () => {
  it('passes a strict shared schema and no citizen identity to Codex', async () => {
    const runner = vi.fn<CodexDraftRunner>(async () => JSON.stringify(draft));
    const result = await createForgeProviders({ runCodex: runner }).draft({ words: 'a sleeping dragon', family: 'hearth', availableSockets: [socket] });
    expect(result).toEqual(draft);
    const input = runner.mock.calls[0]![0] as unknown;
    expect(input).toMatchObject({ schema: { type: 'object', additionalProperties: false, required: ['plan', 'title', 'plaque'] } });
    expect(JSON.stringify(input)).not.toContain('hostFingerprint');
  });

  it('rejects invented properties, malformed JSON and unavailable slots', async () => {
    for (const output of [JSON.stringify({ ...draft, voxels: [] }), 'not JSON', JSON.stringify({ ...draft, plan: { ...draft.plan, kind: 'lantern' } })]) {
      await expect(createForgeProviders({ runCodex: async () => output }).draft({ words: 'a dragon', family: 'hearth', availableSockets: [socket] })).rejects.toBeDefined();
    }
  });

  it('bounds drafting time and aborts the runner', async () => {
    let active: AbortSignal | undefined;
    const runCodex = vi.fn(async ({ signal }: { signal: AbortSignal }) => { active = signal; return new Promise<string>(() => {}); });
    await expect(createForgeProviders({ runCodex, draftTimeoutMs: 5 }).draft({ words: 'a dragon', family: 'hearth', availableSockets: [socket] })).rejects.toThrow('timed out');
    expect(active?.aborted).toBe(true);
  });
});
