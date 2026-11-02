import { describe, expect, it } from 'vitest';
import type { KingdomId } from '@chatdom/shared';
import { bindPortalSource, registerPortalDestination, registerPortalDoor, type PortalDescriptor } from './portals';
import { worldPrompts } from './slots';

const kingdomId = '9' as KingdomId;
const door: PortalDescriptor = { id: 'tavern-front', kingdomId, sourceRoom: 'kingdom', destinationRoom: 'tavern',
  entryAnchor: { feet: [0, 0, 0], yaw: 0 }, returnAnchor: { feet: [40, 3, -12], yaw: 1.5 } };
const at = (x: number, y: number, z: number) => ({ position: [x, y, z] as const, yaw: 0 });

describe('a door prompt', () => {
  it('shows by the door only while the door really opens, in the destination’s words', () => {
    const off = registerPortalDoor(door);
    const prompt = () => worldPrompts().find(p => p.id === 'portal:tavern-front')!;
    expect(prompt().prompt(at(40.5, 3, -11))).toBeNull();          // no source and no destination: no dead door
    const unbind = bindPortalSource({ kingdomId, title: 'Lanternmere', endpoint: 'ws://realm', self: null,
      entry: { kingdomId, resumeScope: 'scope-0123456789abcdef', ticket: async () => { throw new Error('unused'); } },
      leave: async () => {}, rejoin: async () => {} });
    expect(prompt().prompt(at(40.5, 3, -11))).toBeNull();          // still no destination
    const unregister = registerPortalDestination({ room: 'tavern', title: 'The tavern', mount: () => ({ ready: Promise.resolve(), dispose() {} }) });
    expect(prompt().prompt(at(40.5, 3, -11))).toEqual({ label: 'Go into the tavern', at: [40, 4.4, -12] });
    expect(prompt().prompt(at(44, 3, -12))).toBeNull();            // too far across
    expect(prompt().prompt(at(40, 6, -12))).toBeNull();            // on the roof
    unbind();
    expect(prompt().prompt(at(40.5, 3, -11))).toBeNull();          // the walk has gone
    unregister(); off();
    expect(worldPrompts().some(p => p.id === 'portal:tavern-front')).toBe(false);
  });
});
