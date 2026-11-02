import { expect, it, vi } from 'vitest';

// Binding validation does not mount either UI; keep their TSX out of the node-only test.
vi.mock('../interactions', () => ({}));
vi.mock('../play', () => ({}));
import { createCastleModule, MATERIALS } from '@chatdom/content';
import { VOXEL_FIXTURE } from '@chatdom/shared/world-fixtures';
import { generateSettlementPlan, type RealmFoundedScene } from '@chatdom/world';
import { KingdomRoomState, REALM_CASTLE_SLOT, castleHostId, kingdomRoomId, type RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmClient } from '../realm/client';
import { foundedContent } from './founded-content';
import { checkWalkBinding } from './walk-scene';

it('installs hash-distinct approved homes at their exact plots and refuses a walk in different geometry', () => {
  const plan = generateSettlementPlan({seed:'founded-install',tier:'hamlet',firstYear:2025,year:2026});
  const a = VOXEL_FIXTURE, b = {...a, size:[24,24,8] as [number,number,number]};
  const scene: RealmFoundedScene = {
    version:1, kingdomId:'999000001' as RealmFoundedScene['kingdomId'], origin:'simulated',
    layoutRevision:plan.revision, collisionRevision:7, plan, materials:MATERIALS,
    assets:[{assetHash:'a'.repeat(64),blueprint:a},{assetHash:'b'.repeat(64),blueprint:b}],
    placements:plan.homes.map((home, i)=>({id:`home:${i}`,plotId:home.id,assetHash:(i%2?'b':'a').repeat(64),position:home.position,rotation:home.rotation})),
  };
  const installed = foundedContent(scene);
  expect(installed.houses).toHaveLength(plan.homes.length);
  const module = plan.castle.modules.find(module => module.id === plan.castle.beaconModuleId)!;
  const castle = createCastleModule('keep', module.size, 'tide');
  const withKeep = foundedContent({ ...scene, assets: [...scene.assets, { assetHash: 'd'.repeat(64), blueprint: castle }], placements: [...scene.placements,
    { id: castleHostId(module.id), assetHash: 'd'.repeat(64), position: module.position, rotation: module.rotation }] });
  expect(withKeep.houses).toHaveLength(plan.homes.length);
  expect(withKeep.forgeHosts).toHaveLength(plan.homes.length + 1);
  expect(withKeep.forgeHosts.at(-1)).toMatchObject({ blueprint: castle, position: module.position, yaw: module.rotation * Math.PI / 2, slot: REALM_CASTLE_SLOT });
  expect(installed.houses[0]!.blueprint).toBe(a);
  expect(installed.houses[1]!.blueprint).toBe(b); // Same semantic ID, genuinely different asset bytes.
  expect(installed.content[1]!.position).toBe(plan.homes[1]!.position);
  expect(installed.content[1]!.yaw).toBe(plan.homes[1]!.rotation*Math.PI/2);
  expect(() => foundedContent({...scene,placements:scene.placements.slice(1)})).toThrow('missing');
  expect(() => foundedContent({...scene,placements:[...scene.placements,scene.placements[0]!]})).toThrow('unresolved');
  const manifest:RealmFoundedManifest = {version:1,kingdomId:scene.kingdomId,origin:scene.origin,layoutRevision:scene.layoutRevision,collisionRevision:7,sceneHash:'c'.repeat(64)};
  const state = new KingdomRoomState(); Object.assign(state,manifest);
  const client = {room:{roomId:kingdomRoomId(scene.kingdomId),state}} as unknown as RealmClient;
  const binding = {client,manifest,collision:{revision:7,query:()=>[]}};
  expect(() => checkWalkBinding(scene,binding)).not.toThrow();
  expect(() => checkWalkBinding(undefined,binding)).toThrow('founded');
  state.collisionRevision=8;
  expect(() => checkWalkBinding(scene,binding)).toThrow('founded');
  state.collisionRevision=7;
  expect(() => checkWalkBinding(scene,{...binding,collision:{world:()=>null}})).toThrow('ground');
});
