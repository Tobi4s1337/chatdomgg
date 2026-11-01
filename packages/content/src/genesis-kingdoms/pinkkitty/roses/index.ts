/**
 * PinkKittyRose's river town roses: the clipped garden rose, the lane-mouth rose arch, the riverside fire cresset and
 * the long rose planter. Every factory is pure: its geometry comes from its parameters and a seeded hash of them, and
 * every id encodes those parameters. All pieces are Hearth-kit build-lattice blueprints with y = 0 on the ground.
 */
export { createRoseBush, ROSE_BUSH_FORMS, type RoseBushVariant } from './bush';
export { createRoseArch, roseArchFrame, ROSE_ARCH_POST, ROSE_ARCH_CLEAR_HEIGHT, ROSE_ARCH_WIDTHS, type RoseArchFrame } from './arch';
export { createRiverCresset, RIVER_CRESSET } from './cresset';
export { createRosePlanter, ROSE_PLANTER, ROSE_PLANTER_LENGTHS, type RosePlanterLength } from './planter';
export { BLOOMS as ROSE_BLOOM_MATERIALS } from './shape';
