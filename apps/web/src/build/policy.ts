import { MAT, STYLES } from '@chatdom/content';
import { HOME_BUILD_LIMITS, HOME_DEPTH_METRES, RESERVED_LOT_METRES, VOXEL_METRES, type BuildDraftPolicy, type Vec3 } from '@chatdom/shared';
import type { SettlementHome } from '@chatdom/world';

/** Map an already assigned home to its local build limits. This does not authenticate a deed. */
export function createPlotBuildPolicy(home: SettlementHome, ownerId: string): BuildDraftPolicy {
  const style = STYLES[home.style], limits = HOME_BUILD_LIMITS[home.tier];
  const size: Vec3 = [RESERVED_LOT_METRES[0] / VOXEL_METRES.build, RESERVED_LOT_METRES[1] / VOXEL_METRES.build, RESERVED_LOT_METRES[2] / VOXEL_METRES.build];
  const depth = Math.min(home.allowedDepth, HOME_DEPTH_METRES[home.tier]);
  return {
    plotId: home.id, ownerId, styleId: style.id, size,
    editableFrom: [0, 0, size[2] - depth / VOXEL_METRES.build], editableTo: [size[0], limits.height, size[2]],
    maxVoxels: limits.maxVoxels,
    palette: [...new Set([style.wall, style.roof, style.trim, style.stone, MAT.glass,
      MAT.earth, MAT.grass, MAT.leaf, MAT.moss, MAT.bark, MAT.petal, MAT.blueFlower, MAT.brass, MAT.cloth])],
    shaping: { wall: [style.wall], roof: [style.roof], trim: style.trim, stone: style.stone, glass: MAT.glass },
  };
}
