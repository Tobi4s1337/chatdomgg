import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';
import { createCastle } from './index';

type CastleModuleKind = 'keep' | 'gatehouse' | 'curtain' | 'tower';
type Box = VoxelBlueprint['boxes'][number];

/** Individually placeable parts of the castle, measured in metres at the scene boundary. */
export function createCastleModule(kind: CastleModuleKind, size: Vec3, style: StyleKey): VoxelBlueprint {
  const expected: Record<CastleModuleKind, readonly Vec3[]> = {
    keep: [[32, 31, 32]], tower: [[12, 24, 12]], gatehouse: [[16, 18, 10]],
    curtain: [[12, 10, 3], [20, 10, 3], [24, 10, 3]],
  };
  if (!expected[kind]?.some(candidate => candidate.every((n, i) => n === size[i]))) {
    throw new Error(`Unsupported ${kind} dimensions: ${size.join('×')} metres`);
  }
  if (kind === 'keep') return createCastle(style);

  const kit = STYLES[style];
  const [sx, sy, sz] = size.map(n => n * 8) as [number, number, number];
  const boxes: Box[] = [];
  const box = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => {
    if (x < X && y < Y && z < Z) boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  };
  const ring = (inset: number, y: number, top: number, thickness: number, material: number) => {
    box(inset,y,inset,sx-inset,top,inset+thickness,material);
    box(inset,y,sz-inset-thickness,sx-inset,top,sz-inset,material);
    box(inset,y,inset+thickness,inset+thickness,top,sz-inset-thickness,material);
    box(sx-inset-thickness,y,inset+thickness,sx-inset,top,sz-inset-thickness,material);
  };

  if (kind === 'curtain') {
    // Wall-walk is backed by a real, regularly broken parapet.
    box(0,0,2,sx,8,sz-2,kit.stone);
    box(0,8,4,sx,65,sz-4,kit.wall);
    box(0,57,2,sx,62,sz-2,kit.stone);
    box(0,65,1,sx,70,sz-1,kit.stone);
    for (let x=0; x<sx; x+=16) {
      box(x,70,1,Math.min(x+9,sx),80,6,kit.stone);
      box(x,70,sz-6,Math.min(x+9,sx),80,sz-1,kit.stone);
    }
    for (let x=20; x<sx-10; x+=48) {
      box(x,0,0,x+10,38,4,kit.stone);
      box(x+1,38,1,x+9,46,4,kit.stone);
      box(x+3,26,sz-4,x+7,45,sz-2,MAT.darkStone);
    }
  } else if (kind === 'tower') {
    // Hollow, chamfered at the corners. The southern opening leads into the court.
    box(8,0,2,sx-8,144,sz-2,kit.stone);
    box(2,0,8,sx-2,144,sz-8,kit.stone);
    box(13,0,13,sx-13,140,sz-13,MAT.air);
    box(36,0,sz-14,60,40,sz,MAT.air);
    // Short grounded corner tongues meet the curtain ends without filling the hollow.
    // Above the wall line the shaft keeps its chamfered outline.
    for (const p of [8,72]) {
      box(0,0,p,2,80,p+16,kit.stone); box(94,0,p,96,80,p+16,kit.stone);
      box(p,0,0,p+16,80,2,kit.stone); box(p,0,94,p+16,80,96,kit.stone);
    }
    // Foot and crown courses frame the tall pale shaft.
    ring(2,12,18,5,kit.wall);
    ring(0,136,142,7,kit.wall);
    ring(0,142,149,7,kit.stone);
    // Corbel inward from the shaft: the roof bears on this continuous masonry ring.
    ring(7,144,150,10,kit.stone);
    for (let p=8; p<88; p+=16) {
      box(p,149,0,p+9,158,7,kit.stone); box(p,149,89,p+9,158,96,kit.stone);
      box(0,149,p,7,158,p+9,kit.stone); box(89,149,p,96,158,p+9,kit.stone);
    }
    // Restore the entrance after the continuous foot course crosses it.
    box(36,0,sz-14,60,40,sz,MAT.air);
    // A low slate spire sits behind the battlements, its brass cap marking the skyline.
    for (let i=0; i<16; i+=2) box(12+i,149+i*2,12+i,84-i,153+i*2,84-i,kit.roof);
    box(42,181,42,54,185,54,kit.stone);
    box(46,185,46,50,192,50,MAT.brass);
    for (const y of [48,90]) for (const x of [27,65]) {
      box(x-2,y,sz-3,x+2,y+20,sz-1,MAT.darkStone);
      box(x-1,y+20,sz-3,x+1,y+24,sz-1,MAT.darkStone);
      box(x-4,y-3,sz-3,x+4,y-1,sz,kit.wall);
    }
  } else {
    // Gatehouse is open through its entire depth, including at ground level.
    box(0,0,0,48,104,sz,kit.stone); box(80,0,0,sx,104,sz,kit.stone);
    box(0,104,0,sx,125,sz,kit.wall);
    // Crown and two thick projecting shoulders form a recognisable gate silhouette.
    box(0,96,0,sx,102,sz,kit.wall);
    box(0,125,0,sx,130,sz,kit.stone);
    for (let x=0; x<sx; x+=16) {
      box(x,130,0,Math.min(x+9,sx),140,7,kit.stone);
      box(x,130,sz-7,Math.min(x+9,sx),140,sz,kit.stone);
    }
    for (const x of [4,108]) {
      box(x,0,0,x+16,110,8,kit.wall);
      box(x,0,sz-8,x+16,110,sz,kit.wall);
      box(x,110,0,x+16,116,sz,kit.stone);
    }
    // The arch steps back above the six metre clear opening; masonry voussoirs frame it.
    box(48,48,0,52,57,sz,kit.stone); box(76,48,0,80,57,sz,kit.stone);
    box(52,56,0,56,62,sz,kit.stone); box(72,56,0,76,62,sz,kit.stone);
    box(48,62,0,80,67,sz,kit.stone);
    for (const x of [28,100]) {
      box(x-2,54,sz-2,x+2,75,sz,MAT.darkStone);
      box(x-1,75,sz-2,x+1,79,sz,MAT.darkStone);
      box(x-4,50,sz-3,x+4,52,sz,kit.wall);
    }
    // A single restrained heraldic brass finial, grounded in the crown.
    box(60,130,35,68,140,45,kit.stone);
    box(62,140,37,66,144,43,MAT.brass);
  }
  return { version: 1, id: `castle-${kind}-${style}-${size[0]}`, styleId: kit.id,
    kind: 'civic', lattice: 'build', size: [sx,sy,sz], boxes, windows: [] };
}
