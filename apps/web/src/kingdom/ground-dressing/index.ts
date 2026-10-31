// Ground dressing (spec 28): the pure placement plan, its instanced mount and the capture poses computed from it.
export {
  planGroundDressing, planViews, pieceRole,
  type GroundPiece, type GroundBlocker, type GroundDressingInput, type GroundDressingPlan, type GroundViews,
} from './plan';
export { createGroundDressing, type GroundDressing, type GroundDressingHost, type GroundDressingStats } from './mount';
export { DRESSING_VERTEX_ANCHOR } from './material';
