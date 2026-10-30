import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, type StyleKey } from '../materials';

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
    // A low haunch tapers into a narrower neck and a head resting on its paws.
    add(9,0,5,19,2,14,p.shade);
    add(9,2,4,19,6,15,p.body); add(10,6,5,18,9,14,p.body);
    add(12,9,6,17,10,13,p.body);
    add(7,1,7,11,4,11,p.body); add(7,4,7,10,5,11,p.body);
    add(3,1,5,8,5,13,p.body); add(1,1,7,4,3,11,p.body);
    // Cut the closed eyes into the head instead of placing blocks on its cheeks.
    add(4,3,5,7,4,6,MAT.air); add(4,3,5,7,4,6,p.dark);
    add(4,3,12,7,4,13,MAT.air); add(4,3,12,7,4,13,p.dark);
    add(2,3,6,3,4,7,p.dark); add(2,3,11,3,4,12,p.dark);
    // Small swept-back horns are attached to the crown, not a broad white cap.
    add(6,5,5,7,7,7,p.light); add(7,6,5,8,8,7,p.light);
    add(6,5,11,7,7,13,p.light); add(7,6,11,8,8,13,p.light);
    // Folded wing roots sweep back to narrow, pointed tips.
    add(10,5,3,14,8,5,p.shade); add(14,5,3,17,7,5,p.shade);
    add(17,5,4,19,6,5,p.shade); add(12,8,4,15,9,6,p.shade);
    add(11,7,3,13,8,4,p.body); add(13,6,3,16,7,4,p.body);
    add(10,5,14,14,8,16,p.shade); add(14,5,14,17,7,16,p.shade);
    add(17,5,14,19,6,15,p.shade); add(12,8,13,15,9,15,p.shade);
    add(11,7,15,13,8,16,p.body); add(13,6,15,16,7,16,p.body);
    // The tail returns around the visible side, finishing in a tapered tip.
    add(18,2,5,21,5,14,p.body); add(20,1,10,22,4,16,p.body);
    add(17,0,14,22,3,17,p.body); add(13,0,15,18,2,18,p.body);
    add(11,0,15,14,1,17,p.light);
    // Native silhouettes: rounded tiles, swept fins, or leaf-like ridges.
    if (style === 'hearth') { add(14,10,7,16,11,12,p.body); add(15,11,8,16,12,11,p.light); }
    else if (style === 'tide') { add(14,10,7,17,11,11,p.body); add(16,11,8,19,12,10,p.light); }
    else { add(13,10,7,16,11,11,p.light); add(15,11,8,18,12,10,p.light); }
    // A hollow flue through the blunt muzzle; the sleeping eyelids remain untouched.
    add(1,2,8,5,3,10,MAT.air);
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
