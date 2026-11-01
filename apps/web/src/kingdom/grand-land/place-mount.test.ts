import { describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import type { Vec3 } from '@chatdom/shared';
import { createPlaceMounts, type PlaceMount, type PlaceMounter } from './place-mount';

function host() {
  let hour = 17.5, quality: 'high' | 'balanced' | 'low' = 'high', feet: Vec3 | null = null;
  const placements: PlaceMount['placements'] = [
    { id: 'gather:tavern:v1', position: [12, 3, -4], rotation: 1, assetHash: 'tavern-asset' },
    { id: 'gather:campfire:v1', position: [-16, 2, 8], rotation: 0, assetHash: 'fire-asset' },
    { id: 'home:one', position: [3, 1, 2], rotation: 2, assetHash: 'house-asset' },
  ];
  return {
    context: { scene: new Scene(), camera: new PerspectiveCamera(), placements, localFeet: () => feet, hour: () => hour, quality: () => quality },
    update() { hour = 21; quality = 'low'; feet = [8, 2, -5]; },
  };
}

describe('place mounts in the shared scene', () => {
  it('retains every host placement with no mounters and needs no animated frames', () => {
    const { context } = host();
    for (const mounters of [undefined, []]) {
      const mounts = createPlaceMounts(context, mounters);
      expect(context.placements.filter(p => mounts.hostDraws(p.id))).toEqual(context.placements);
      mounts.tick(.016, 100); mounts.resize(1440, 900); mounts.dispose(); mounts.dispose();
      expect(mounts.revision).toBe(0);
    }
  });

  it('passes exact scene/camera/placements and live feet, shared hour and actual quality', () => {
    const owner = host();
    let mounted: PlaceMount | undefined;
    const mounts = createPlaceMounts(owner.context, [mount => { mounted = mount; return () => {}; }]);
    expect(mounted!.scene).toBe(owner.context.scene);
    expect(mounted!.camera).toBe(owner.context.camera);
    expect(mounted!.placements).toBe(owner.context.placements);
    expect(mounted!.localFeet()).toBeNull();
    expect(mounted!.hour()).toBe(17.5);
    expect(mounted!.quality()).toBe('high');
    owner.update();
    expect(mounted!.localFeet()).toEqual([8, 2, -5]);
    expect(mounted!.hour()).toBe(21);
    expect(mounted!.quality()).toBe('low');
    mounts.dispose();
  });

  it('hands over campfire drawing once and keeps the tavern exterior without removing the physical or light-blocking source', () => {
    const { context } = host(), drawn: string[] = [];
    const source = context.placements;
    const mounter: PlaceMounter = mount => {
      for (const place of mount.placements.filter(p => p.id.startsWith('gather:campfire:'))) {
        drawn.push(place.id); mount.claimPlacement(place.id);
      }
      return () => {};
    };
    const mounts = createPlaceMounts(context, [mounter]);
    const hostDrawn = source.filter(p => mounts.hostDraws(p.id));
    const visualIds = [...drawn, ...hostDrawn.map(p => p.id)];
    expect(visualIds.sort()).toEqual(source.map(p => p.id).sort());
    expect(new Set(visualIds).size).toBe(source.length);
    expect(hostDrawn.map(p => p.id)).toEqual(['gather:tavern:v1', 'home:one']);
    expect(context.placements).toBe(source);
    expect(source).toHaveLength(3);
    expect(mounts.hostDraws('gathering:festival')).toBe(true);
    expect(mounts.hostDraws(undefined)).toBe(true);
    mounts.dispose();
    expect(mounts.hostDraws('gather:tavern:v1')).toBe(true);
  });

  it('keeps the campfire visible when an unrelated mounted provider claims nothing', () => {
    const { context } = host();
    const mounts = createPlaceMounts(context, [() => () => {}]);
    expect(context.placements.filter(p => mounts.hostDraws(p.id))).toEqual(context.placements);
    mounts.dispose();
  });

  it.each([
    ['unknown placement', 'gather:campfire:missing', 'missing place placement'],
    ['tavern exterior', 'gather:tavern:v1', 'host owns'],
    ['ordinary home', 'home:one', 'host owns'],
  ])('rejects a claim of %s and releases previously mounted owners', (_, id, error) => {
    const { context } = host(), released = vi.fn();
    expect(() => createPlaceMounts(context, [
      () => released,
      mount => { mount.claimPlacement(id!); return () => {}; },
    ])).toThrow(error);
    expect(released).toHaveBeenCalledOnce();
  });

  it('rejects duplicate claims rather than drawing two campfires and prohibits late claims', () => {
    const { context } = host(), released = vi.fn();
    expect(() => createPlaceMounts(context, [
      mount => { mount.claimPlacement('gather:campfire:v1'); return released; },
      mount => { mount.claimPlacement('gather:campfire:v1'); return () => {}; },
    ])).toThrow('already claimed');
    expect(released).toHaveBeenCalledOnce();
    let captured: PlaceMount | undefined;
    const mounts = createPlaceMounts(context, [mount => { captured = mount; return () => {}; }]);
    expect(() => captured!.claimPlacement('gather:campfire:v1')).toThrow('during initialization');
    mounts.dispose();
  });

  it('uses host ticks/resizes and releases subscriptions before one reverse-order teardown', () => {
    const { context } = host(), tick = vi.fn(), resize = vi.fn(), order: string[] = [];
    let lateMount: PlaceMount | undefined, stopTick = () => {}, stopResize = () => {};
    const mounts = createPlaceMounts(context, [
      mount => {
        lateMount = mount; stopTick = mount.onTick(tick); stopResize = mount.onResize(resize);
        return () => { order.push('tavern'); mounts.tick(.01, 300); mounts.resize(1, 1); };
      },
      () => () => { order.push('campfire'); },
    ]);
    mounts.resize(1440, 900); mounts.tick(.016, 200);
    expect(resize).toHaveBeenLastCalledWith(1440, 900);
    expect(tick).toHaveBeenLastCalledWith(.016, 200);
    const animatedRevision = mounts.revision;
    stopTick(); stopTick(); stopResize();
    mounts.tick(.016, 216); mounts.resize(390, 844);
    expect(mounts.revision).toBe(animatedRevision);
    mounts.dispose(); mounts.dispose();
    expect(order).toEqual(['campfire', 'tavern']);
    lateMount!.onTick(tick); lateMount!.onResize(resize);
    mounts.tick(.016, 400); mounts.resize(1, 1);
    expect(tick).toHaveBeenCalledTimes(1); expect(resize).toHaveBeenCalledTimes(1);
  });

  it('rolls back prior mounts and failed initializer roots without disturbing the host', () => {
    const { context } = host(), hostRoot = new Group(), firstRoot = new Group(), failedRoot = new Group();
    context.scene.add(hostRoot);
    const dispose = vi.fn(() => firstRoot.removeFromParent()), tick = vi.fn(), resize = vi.fn();
    let failedMount: PlaceMount | undefined;
    expect(() => createPlaceMounts(context, [
      mount => { mount.scene.add(firstRoot); mount.onTick(tick); return dispose; },
      mount => { failedMount = mount; mount.scene.add(failedRoot); mount.onResize(resize); throw new Error('interior failed'); },
    ])).toThrow('interior failed');
    expect(dispose).toHaveBeenCalledOnce();
    expect(context.scene.children).toEqual([hostRoot]);
    // A failed initializer cannot retain a live route back to host callbacks.
    const stop = failedMount!.onTick(tick); stop();
    expect(tick).not.toHaveBeenCalled(); expect(resize).not.toHaveBeenCalled();
  });

  it('continues releasing owners when one disposer fails', () => {
    const { context } = host(), disposed = vi.fn(), error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mounts = createPlaceMounts(context, [() => disposed, () => () => { throw new Error('cleanup failed'); }]);
    try {
      expect(() => mounts.dispose()).not.toThrow();
      expect(disposed).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledOnce();
    } finally { error.mockRestore(); }
  });
});
