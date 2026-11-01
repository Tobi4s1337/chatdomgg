import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it } from 'vitest';
import { validateFoundedScene, encodeFoundedScene } from '@chatdom/world/founded-scene';
import type { DurableChronicle } from './durable';
import { validateDurableChronicle, readDurableChronicle } from './durable';
let reply: DurableChronicle;
beforeAll(async () => {
  const scene = await validateFoundedScene(JSON.parse(await readFile('apps/realm/src/founded/artifacts/simulated-town.scene.json', 'utf8')));
  const { manifest } = await encodeFoundedScene(scene);
  reply = { version: 1, kingdomId: scene.kingdomId, origin: 'simulated', throughSequence: 5,
    history: { label: 'SIMULATED', snapshots: [{ frame: { version: 1, kingdomId: scene.kingdomId, origin: 'simulated', sequence: 5, asOf: 1000,
      homes: [], civic: { market: 1, tavern: 1, forge: 1, bridge: 1, 'castle-court': 1 }, beats: [] }, homes: [], worldRevision: manifest.sceneHash, caption: 'The kingdom woke.' }] },
    worlds: [{ revision: manifest.sceneHash, manifest, scene }] };
}, 30_000);
it('checks exact public scene bytes, frame provenance, and same-kingdom revisions before replay', async () => {
  const accepted = await validateDurableChronicle(reply, reply.kingdomId);
  expect(accepted.history.snapshots[0]?.worldRevision).toBe(accepted.worlds[0]?.manifest.sceneHash);
  await expect(validateDurableChronicle({ ...reply, origin: 'live' }, reply.kingdomId)).rejects.toThrow(/provenance/);
  await expect(validateDurableChronicle(reply, '42')).rejects.toThrow(/identity/);
  await expect(validateDurableChronicle({ ...reply, throughSequence: 4 }, reply.kingdomId)).rejects.toThrow(/complete world/);
  await expect(validateDurableChronicle({ ...reply, worlds: [] }, reply.kingdomId)).rejects.toThrow(/complete world/);
}, 30_000);
it('rejects modified historical geometry and public-schema smuggling', async () => {
  const world = reply.worlds[0]!;
  await expect(validateDurableChronicle({ ...reply, worlds: [{ ...world, scene: { ...world.scene, privateWords: 'must not appear' } }] }, reply.kingdomId)).rejects.toThrow();
  await expect(validateDurableChronicle({ ...reply, worlds: [{ ...world, scene: { ...world.scene, collisionRevision: 999 } }] }, reply.kingdomId)).rejects.toThrow();
}, 30_000);
it('fetches only the exact numeric read route and makes unavailable replies fail', async () => {
  let called = '';
  const read = await readDurableChronicle(reply.kingdomId, { fetch: async input => { called = String(input); return Response.json(reply); } });
  expect(called).toBe(`/api/realm/chronicle/${reply.kingdomId}`);
  expect(read.origin).toBe('simulated');
  await expect(readDurableChronicle(reply.kingdomId, { fetch: async () => new Response('', { status: 503 }) })).rejects.toThrow(/unavailable/);
}, 30_000);
