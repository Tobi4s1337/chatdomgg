import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, type StyleKey } from '../materials';

type Cell = [number, number, number];
export type ForgeOrnament = 'sleeping-fox' | 'sunflower' | 'scallop-shell' | 'shooting-star';
export type OrnamentGeometry = { boxes: VoxelBlueprint['boxes']; size: Cell; mount: Cell; emitter: Cell };

/** Carved build-cell ornaments. The emitter is an attachment anchor, never a light. */
export function createForgeOrnament(id: ForgeOrnament, family: StyleKey, revision = 1): OrnamentGeometry {
  if (revision !== 1 && revision !== 2) throw new Error('Unregistered Forge ornament revision.');
  const boxes: VoxelBlueprint['boxes'] = [];
  const add = (x:number,y:number,z:number,X:number,Y:number,Z:number,material:number) => boxes.push({from:[x,y,z],to:[X,Y,Z],material});
  const p = {
    hearth: { body:MAT.terracotta, shade:MAT.brick, light:MAT.limestone, dark:MAT.timber, gold:MAT.brass },
    tide: { body:MAT.slate, shade:MAT.darkStone, light:MAT.cream, dark:MAT.timber, gold:MAT.brass },
    grove: { body:MAT.moss, shade:MAT.bark, light:MAT.thatch, dark:MAT.bark, gold:MAT.goldLeaf },
  }[family];
  // A modest foot makes the point of attachment part of the carving.
  add(10,0,7,15,1,12,p.shade);
  let emitter: Cell;
  if (id === 'sleeping-fox' && revision === 2) {
    // A low, tucked head faces left; broad, short ears step to small tips.
    // The light cheek sits below the closed eye, separate from the dark nose.
    add(9,1,5,19,3,13,p.shade); add(9,3,5,19,6,13,p.body);
    add(10,6,6,18,7,12,p.body); add(12,7,7,17,8,11,p.body);
    add(5,2,6,11,5,12,p.body); add(4,2,7,7,4,11,p.body);
    add(2,1,7,6,3,11,p.light); add(1,2,8,3,3,10,p.dark);
    add(5,5,5,8,6,8,p.body); add(5,6,6,7,8,8,p.body);
    add(5,8,7,6,9,8,p.body);
    add(5,5,10,8,6,13,p.body); add(5,6,10,7,8,12,p.body);
    add(5,8,10,6,9,11,p.body);
    add(6,6,6,7,7,7,p.shade); add(6,6,11,7,7,12,p.shade);
    add(4,2,12,8,4,13,p.light); add(4,2,5,8,4,6,p.light);
    add(5,4,12,8,5,13,p.dark); add(5,4,5,8,5,6,p.dark);
    add(5,1,11,10,2,13,p.light); add(7,1,4,11,2,6,p.light);
    // The brush grows out of the rump, rounds its outer corner and folds
    // forward into a wide pale tip held beside the sleeping cheek.
    add(17,1,10,21,4,15,p.body); add(17,1,14,21,3,16,p.body);
    add(13,1,13,19,4,17,p.body); add(11,1,14,15,4,17,p.light);
    add(8,1,13,12,3,16,p.light); add(7,1,13,9,2,15,p.light);
    emitter = [1,2,9];
  } else if (id === 'sleeping-fox') {
    // Compact curled body, head laid low on its paws, and a broad white-tipped tail.
    add(9,1,5,19,3,13,p.shade); add(9,3,5,18,6,13,p.body);
    add(10,6,6,17,8,12,p.body); add(11,8,7,16,9,11,p.body);
    add(5,1,5,11,3,12,p.body); add(3,2,6,9,5,12,p.body);
    add(2,2,7,5,4,11,p.light); add(2,2,8,3,3,10,p.dark);
    add(4,5,6,6,7,8,p.body); add(7,5,10,9,7,12,p.body);
    add(4,6,6,5,7,8,p.shade); add(8,6,10,9,7,12,p.shade);
    add(4,3,12,7,4,13,p.dark); // closed eye on the visible cheek
    add(4,1,12,9,2,14,p.light); add(6,1,4,10,2,6,p.light);
    add(17,1,9,21,4,14,p.body); add(17,1,13,21,3,16,p.body);
    add(12,1,14,18,3,17,p.body); add(10,1,14,13,3,17,p.light);
    if (family === 'hearth') add(13,8,7,16,9,11,p.light);
    else if (family === 'tide') { add(16,7,7,18,8,11,p.light); add(17,6,8,19,7,10,p.light); }
    else { add(12,8,7,15,9,11,p.light); add(15,8,8,17,9,10,p.light); }
    emitter = [2,3,9];
  } else if (id === 'sunflower') {
    // Stem and opposing leaves support a thick carved flower, facing +Z.
    add(11,1,8,14,7,11,p.shade);
    add(7,3,8,11,5,11,p.body); add(6,4,8,8,5,11,p.body);
    add(14,2,8,18,4,11,p.body); add(17,3,8,19,4,11,p.body);
    add(8,7,8,17,13,11,p.gold); add(9,6,8,16,14,11,p.gold);
    add(11,5,8,14,15,11,p.gold); add(7,9,8,18,11,11,p.gold);
    add(9,8,11,16,12,12,p.shade); add(10,7,11,15,13,12,p.shade);
    add(10,9,12,15,11,13,p.dark); add(11,8,12,14,12,13,p.dark);
    if (family === 'hearth') { add(11,13,9,14,15,11,p.light); add(7,9,9,9,11,11,p.light); }
    else if (family === 'tide') { add(14,13,9,16,14,11,p.light); add(16,10,9,18,11,11,p.light); }
    else { add(9,13,9,11,14,11,p.light); add(7,10,9,9,11,11,p.light); }
    emitter = [12,10,13];
  } else if (id === 'scallop-shell') {
    // Fan grows from a narrow hinge to a gently scalloped rim; raised ribs converge below.
    add(10,1,8,15,4,11,p.shade); add(8,3,8,17,6,11,p.body);
    add(6,5,8,19,9,11,p.body); add(5,8,8,20,12,11,p.body);
    add(6,12,8,19,13,11,p.body); add(7,13,8,10,14,11,p.body);
    add(11,13,8,14,15,11,p.body); add(15,13,8,18,14,11,p.body);
    add(11,2,11,14,5,12,p.light); add(10,5,11,12,8,12,p.light);
    add(8,8,11,10,12,12,p.light); add(7,12,11,9,13,12,p.light);
    add(12,5,11,13,14,12,p.light); add(13,5,11,15,8,12,p.light);
    add(15,8,11,17,12,12,p.light); add(17,12,11,18,13,12,p.light);
    if (family === 'hearth') add(10,1,11,15,2,12,p.gold);
    else if (family === 'tide') { add(5,10,11,7,12,12,p.light); add(18,10,11,20,12,12,p.light); }
    else { add(10,1,11,15,2,12,p.gold); add(11,2,12,14,3,13,p.gold); }
    emitter = [12,8,12];
  } else {
    // A four-point star leads three tapering, swept comet trails.
    add(10,1,8,15,3,11,p.gold); add(12,3,8,14,6,11,p.gold);
    add(8,6,8,18,9,11,p.gold); add(10,5,8,16,11,11,p.gold);
    add(12,4,8,15,13,11,p.gold); add(13,13,8,14,15,11,p.light);
    add(15,8,8,19,10,11,p.body); add(18,9,8,21,11,11,p.body);
    add(20,10,8,23,11,11,p.light);
    add(16,6,8,19,8,11,p.shade); add(19,7,8,22,8,11,p.shade);
    add(11,7,11,16,9,12,p.light); add(12,6,11,15,10,12,p.light);
    if (family === 'hearth') add(18,9,11,21,10,12,p.light);
    else if (family === 'tide') { add(19,10,8,22,12,11,p.light); add(21,11,8,23,13,11,p.light); }
    else { add(18,8,11,21,9,12,p.light); add(20,9,11,22,10,12,p.light); }
    emitter = [13,8,12];
  }
  return { boxes, size:[24,16,18], mount:[12,0,9], emitter };
}
