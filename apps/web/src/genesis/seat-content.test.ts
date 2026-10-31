import { expect, it } from 'vitest';
import { proposeGenesisLandmarks, WATCHTOWER_AXIS } from '@chatdom/content/genesis-landmarks';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { transformCardinalPoint } from '@chatdom/world';
import { compileChannelGenesis, compileGenesisSettlement } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES } from '@chatdom/world/genesis/observed';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from './channels';
import { createGenesisSeatContent } from './seat-content';

it('mounts the observed harbour tower and its flag and lamps on the accepted castle parcel without changing the plan', () => {
  const facts = OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === '63920635')!;
  const channel = GENESIS_CHANNELS.find(item => item.id === facts.broadcasterId)!;
  const recipe = compileChannelGenesis({ ...facts, profileColours: [...channel.palette], evidence: {
    kind: 'observed', sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse(PROFILE_CAPTURED_AT),
  } });
  const landscape = recipe.landscapes.find(item => item.character === 'coastal-harbour')!;
  const plan = compileGenesisSettlement(recipe, landscape.id), before = JSON.stringify(plan);
  const proposal = proposeGenesisLandmarks(recipe, landscape).find(item => item.showcase === 'harbour-watchtower')!;
  const seat = createGenesisSeatContent(recipe, landscape, plan)!;
  expect(seat).toBeDefined();
  const keep = plan.castle.modules.find(module => module.id === plan.castle.beaconModuleId)!;
  const building = seat.buildings[0]!, cell = VOXEL_METRES.build;
  const world = (p: Vec3) => transformCardinalPoint(building.position, keep.rotation, [p[0] * cell, p[1] * cell, p[2] * cell]);
  expect(world([WATCHTOWER_AXIS.x, 0, WATCHTOWER_AXIS.z])).toEqual(plan.castle.centre);
  expect(building).toMatchObject({ id: plan.castle.beaconModuleId, slot: 65534, yaw: keep.rotation * Math.PI / 2 });
  expect(building.blueprint.windows).toEqual([]);
  expect(seat.props.map(part => part.position)).toEqual(proposal.piece.parts.map(part => world(part.offset)));
  expect(seat.beaconPosition).toEqual(world(proposal.piece.emitters.find(emitter => emitter.kind === 'beacon')!.position));
  expect(seat.braziers.map(lamp => lamp.position)).toEqual(proposal.piece.emitters.filter(emitter => emitter.kind === 'lantern').map(emitter => world(emitter.position)));
  expect(JSON.stringify(plan)).toBe(before);
});
