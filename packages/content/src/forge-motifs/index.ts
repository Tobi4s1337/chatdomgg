import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';

type Box = VoxelBlueprint['boxes'][number];
type Cell = [number, number, number];
export type ForgeMotif = 'sleeping-dragon' | 'crescent-moon' | 'watchful-owl';
export type MotifGeometry = { size: Cell; boxes: Box[]; mount: Cell; emitter: Cell };

/** Small, solid sculptures in build cells. The emitter is an anchor, not a lit voxel. */
export function createForgeMotif(motif: ForgeMotif, style: StyleKey): MotifGeometry {
  const boxes: Box[] = [];
  const add = (x:number,y:number,z:number,X:number,Y:number,Z:number,material:number) => boxes.push({from:[x,y,z],to:[X,Y,Z],material});
  const p = {
    hearth: {body:MAT.terracotta, shade:MAT.brick, light:MAT.limestone, dark:MAT.timber, metal:MAT.brass},
    tide: {body:MAT.slate, shade:MAT.darkStone, light:MAT.cream, dark:MAT.timber, metal:MAT.brass},
    grove: {body:MAT.moss, shade:MAT.bark, light:MAT.thatch, dark:MAT.bark, metal:MAT.goldLeaf},
  }[style];
  if (motif === 'sleeping-dragon') {
    // A real masonry throat rises through the coil, with a dark open chimney mouth.
    // Its foot includes the stable mount; the dragon wraps the exposed shaft.
    const stone = STYLES[style].stone;
    add(11,0,7,15,9,11,stone);
    add(10,8,6,16,10,12,stone);
    add(11,9,7,15,10,11,MAT.air);
    // Low hindquarters sit to the right of the stack, not over its top.
    add(16,0,7,20,3,12,p.shade);
    add(16,3,7,20,5,12,p.body);
    add(17,5,8,19,6,11,p.body);
    // A narrow neck runs around the near side of the masonry to the sleeping head.
    add(8,0,5,17,2,7,p.body);
    add(7,2,5,12,4,7,p.body);
    add(6,1,6,10,4,11,p.body);
    // A long tapered muzzle points left, with a clearly separate lower jaw.
    add(3,2,6,7,5,12,p.body);
    add(1,2,7,4,4,11,p.body);
    add(1,1,8,5,2,10,p.shade);
    // Two paws frame and support the chin, with warm claw tips.
    add(4,0,3,9,2,5,p.body); add(3,0,3,5,1,5,p.light);
    add(4,0,12,9,2,14,p.body); add(3,0,12,5,1,14,p.light);
    add(7,1,4,9,3,7,p.body); add(7,1,11,9,3,13,p.body);
    // Sleeping lids and nostrils on both sides.
    add(4,3,5,7,4,6,p.dark); add(4,3,12,7,4,13,p.dark);
    add(2,3,6,3,4,7,p.dark); add(2,3,11,3,4,12,p.dark);
    // Horns sweep back from the crown rather than forming a blunt cap.
    add(6,5,6,8,6,7,p.light); add(7,6,6,9,7,7,p.light);
    add(8,7,6,10,8,7,p.light);
    add(6,5,11,8,6,12,p.light); add(7,6,11,9,7,12,p.light);
    add(8,7,11,10,8,12,p.light);
    // Paired folded bat wings: a high leading finger, a dark membrane and
    // two small scallops along the trailing edge. The wing roots meet the body.
    for (const z of [5, 12]) {
      add(16,3,z,19,7,z+2,p.shade);
      add(17,7,z,19,10,z+2,p.shade);
      add(18,10,z,19,12,z+2,p.shade);
      add(19,5,z,21,9,z+2,p.shade);
      add(21,4,z,22,7,z+2,p.shade);
      add(22,3,z,23,5,z+2,p.shade);
      // A single raised spar describes the fold without stippling the membrane.
      const face = z === 5 ? 4 : 14;
      add(18,9,face,19,11,face+1,p.body);
      add(19,7,face,20,9,face+1,p.body);
      add(20,6,face,21,7,face+1,p.body);
      add(21,5,face,22,6,face+1,p.body);
    }
    // Slender tail turns around the rear, leaving an air gap inside its loop.
    add(19,0,10,22,2,13,p.body); add(21,0,12,23,2,16,p.body);
    add(16,0,15,23,1,17,p.body); add(12,0,16,17,1,18,p.body);
    add(10,0,16,12,1,17,p.light);
    // Native crest treatment stays local to the haunch.
    if (style === 'hearth') { add(17,6,9,19,7,11,p.body); add(18,7,9,19,8,10,p.light); }
    else if (style === 'tide') { add(17,6,9,20,7,11,p.body); add(19,7,9,21,8,10,p.light); }
    else { add(17,6,9,19,7,11,p.light); add(18,7,9,20,8,10,p.light); }
    // The flue opens straight out of the nose at the returned smoke anchor.
    add(1,2,8,4,3,10,MAT.air);
    return {size:[24,16,18],boxes,mount:[12,0,9],emitter:[0,2,9]};
  }
  if (motif === 'crescent-moon') {
    // The crescent cradles a lantern: continuous stepped rim and a caged glass heart.
    add(2,0,2,6,2,6,p.metal); add(1,2,2,3,5,6,p.metal);
    add(0,5,2,2,10,6,p.metal); add(1,10,2,3,13,6,p.metal);
    add(2,13,2,5,14,6,p.metal); add(3,12,2,5,13,6,p.metal);
    add(4,1,2,7,2,6,p.metal); add(6,2,3,7,3,5,p.metal);
    add(2,4,3,6,10,5,MAT.glass);
    add(2,3,2,6,4,6,p.metal); add(2,10,2,6,11,6,p.metal);
    add(2,4,2,3,10,3,p.metal); add(5,4,2,6,10,3,p.metal);
    add(2,4,5,3,10,6,p.metal); add(5,4,5,6,10,6,p.metal);
    // Small star on the high tip, cut differently in each native kit.
    add(4,11,3,6,12,5,p.light);
    if (style === 'hearth') { add(5,11,3,7,12,5,p.metal); add(6,10,3,7,13,5,p.metal); }
    else if (style === 'tide') { add(4,12,3,7,13,5,p.light); add(6,13,3,7,14,5,p.light); }
    else { add(4,12,2,6,13,6,p.light); add(5,13,3,7,14,5,p.light); }
    return {size:[8,14,8],boxes,mount:[4,0,4],emitter:[4,7,4]};
  }
  // Cast silhouette on an arrow, with raised face and separate folded wing plates.
  add(1,1,1,13,2,3,p.metal); add(6,0,1,8,2,3,p.metal); add(0,0,1,2,3,3,p.metal);
  add(12,0,1,14,3,3,p.metal);
  add(4,2,1,10,4,3,p.body); add(3,4,1,11,9,3,p.body);
  add(4,9,1,10,12,3,p.body); add(3,11,1,5,14,3,p.body); add(9,11,1,11,14,3,p.body);
  add(2,5,0,4,9,3,p.shade); add(10,5,0,12,9,3,p.shade);
  add(3,4,0,5,6,3,p.shade); add(9,4,0,11,6,3,p.shade);
  // Eye discs and beak are legible in the silhouette's front face.
  add(4,8,0,6,10,1,p.light); add(8,8,0,10,10,1,p.light);
  add(5,8,0,6,9,1,p.dark); add(8,8,0,9,9,1,p.dark);
  add(6,7,0,8,9,1,p.metal); add(5,2,0,6,4,1,p.light); add(8,2,0,9,4,1,p.light);
  if (style === 'hearth') { add(5,5,0,9,6,1,p.light); }
  else if (style === 'tide') { add(2,9,1,4,10,3,p.light); add(10,9,1,12,10,3,p.light); }
  else { add(4,12,1,6,13,3,p.light); add(8,12,1,10,13,3,p.light); }
  return {size:[14,14,4],boxes,mount:[7,0,2],emitter:[7,10,4]};
}
