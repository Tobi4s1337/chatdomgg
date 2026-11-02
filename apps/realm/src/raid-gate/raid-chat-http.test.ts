import { expect, it, vi } from 'vitest';
import { KingdomIdSchema, RaidChatFrameSchema, parseRaidChatFrame } from '@chatdom/shared';
import { classify } from '../../../api/src/public/routes';
import { RaidChatPresentation } from './raid-chat-presentation';
import { createRaidChatReader } from './raid-chat-http';

const kingdomId = KingdomIdSchema.parse('201');
const request = (path: string, method = 'GET') => new Request(`http://realm.test${path}`, { method });
it('serves only a literal GET without query and returns a private, non-cacheable valid frame', async () => {
  const presentation = new RaidChatPresentation({ origin: 'simulated' });
  const reader = createRaidChatReader({ origin: 'simulated', presentation, current: () => true });
  const response = reader.handle(request('/realm/raid-chat/201'));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const frame: unknown = await response.json();
  expect(RaidChatFrameSchema.safeParse(frame).success).toBe(true); expect(parseRaidChatFrame(frame, Date.now())).not.toBeNull();
  expect(frame).toMatchObject({ kingdomId, origin: 'simulated', cues: [] });
  for (const key of ['personId', 'sessionId', 'messageId', 'slot']) expect(JSON.stringify(frame)).not.toContain(key);
  expect(reader.handle(request('/realm/raid-chat/201', 'POST')).status).toBe(405);
  expect(reader.handle(request('/realm/raid-chat/201?after=1')).status).toBe(400);
  for (const path of ['/realm/raid-chat/0', '/realm/raid-chat/0201', '/realm/raid-chat/201/private', '/realm/raid-chat/%32%30%31']) {
    expect(reader.handle(request(path)).status, path).toBe(404);
  }
  presentation.close();
});
it('clears when the retained writer is lost, rejects a foreign frame, and closes with 503', () => {
  const presentation = new RaidChatPresentation({ origin: 'simulated' });
  const clear = vi.spyOn(presentation, 'clear'); let current = false;
  const reader = createRaidChatReader({ origin: 'simulated', presentation, current: () => current });
  expect(reader.handle(request('/realm/raid-chat/201')).status).toBe(503); expect(clear).toHaveBeenCalledWith(kingdomId);
  current = true; const foreign = createRaidChatReader({ origin: 'live', presentation, current: () => true });
  expect(foreign.handle(request('/realm/raid-chat/201')).status).toBe(503);
  reader.close(); expect(reader.handle(request('/realm/raid-chat/201')).status).toBe(503); presentation.close();
});
it('public gateway exposes only the literal reader route in either supported prefix', () => {
  for (const prefix of ['', '/live-realm-data']) {
    expect(classify(`${prefix}/realm/raid-chat/201`, '')).toEqual({ kind: 'realm' });
    for (const path of ['/realm/raid-chat/0', '/realm/raid-chat/0201', '/realm/raid-chat/201/private', '/realm/raid-chat/%32%30%31',
      '/realm/raid-chat/../internal/realm/chat-commands', '/internal/realm/chat-commands']) {
      expect(classify(`${prefix}${path}`, '').kind, `${prefix}${path}`).not.toBe('realm');
    }
  }
});
