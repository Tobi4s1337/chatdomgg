import { HOME_DEPTH_METRES, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';

export const CASTLE_BEACON_HEIGHT_METRES = 30.5;
/** Centre of the authored lantern cap, relative to the castle asset origin. */
export const CASTLE_BEACON_ANCHOR_METRES = [16, CASTLE_BEACON_HEIGHT_METRES, 14] as const;

type Box = VoxelBlueprint['boxes'][number];
type Window = VoxelBlueprint['windows'][number];
const box = (boxes: Box[], x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => {
  if (x < X && y < Y && z < Z) boxes.push({ from: [x,y,z], to: [X,Y,Z], material });
};

/** A compact, walkable shell: the entrance is permanently open until doors are interactive. */
export function createHome(tier: HomeTier, style: StyleKey, variant: number): VoxelBlueprint {
  const kit = STYLES[style], v = ((Math.floor(variant) % 3) + 3) % 3;
  const depth = HOME_DEPTH_METRES[tier] * 8, boxes: Box[] = [], windows: Window[] = [];
  const front = depth - 5, back = 5, left = 5, right = 59;
  const wallTop = tier === 'hut' ? 31 : tier === 'cottage' ? 36 : 42;
  // Foundation and independent walls leave an actual interior volume.
  box(boxes, 3,0,3,61,4,depth-3,kit.stone);
  box(boxes,left,4,back,right,wallTop,back+2,kit.wall);
  box(boxes,left,4,back,left+2,wallTop,front,kit.wall);
  box(boxes,right-2,4,back,right,wallTop,front,kit.wall);
  box(boxes,left,4,front-2,right,wallTop,front,kit.wall);
  // Door passage and rounded stepped arch (1.25 m wide, 2.5 m tall).
  const doorX = v === 1 ? 18 : v === 2 ? 39 : 29;
  box(boxes,doorX-5,4,front-3,doorX+5,22,front+1,MAT.air);
  box(boxes,doorX-4,22,front-3,doorX+4,24,front+1,MAT.air);
  box(boxes,doorX-6,4,front-2,doorX-5,23,front+1,kit.trim);
  box(boxes,doorX+5,4,front-2,doorX+6,23,front+1,kit.trim);
  box(boxes,doorX-5,24,front-2,doorX+5,25,front+1,kit.trim);
  // Timber corner posts and lower rail are purposeful broad strokes.
  for (const x of [left,right-2]) for (const z of [back,front-2]) box(boxes,x-1,4,z-1,x+3,wallTop+1,z+3,kit.trim);
  box(boxes,left,11,front-1,right,13,front+1,kit.trim);
  // Keep the door clear where the rail crosses it.
  box(boxes,doorX-5,4,front-2,doorX+5,22,front+1,MAT.air);
  const windowXs = v === 1 ? [39,49] : v === 2 ? [15,25] : [15,46];
  for (let i=0; i<windowXs.length; i++) {
    const x=windowXs[i]!;
    box(boxes,x-5,15,front-2,x+5,27,front+1,kit.trim);
    box(boxes,x-4,16,front-1,x+4,26,front+1,MAT.glass);
    box(boxes,x-1,16,front,x+1,26,front+1,kit.trim);
    box(boxes,x-6,14,front-1,x+6,15,front+2,kit.stone);
    windows.push({id:`front-${i}`,centre:[x,21,front+1],width:8,height:10,facing:'south'});
  }
  // Low stone threshold and a pair of small planted window boxes.
  box(boxes,doorX-6,0,front,doorX+6,4,front+4,kit.stone);
  for (const x of windowXs) {
    box(boxes,x-5,12,front,x+5,14,front+4,kit.trim);
    box(boxes,x-4,14,front+1,x+4,15,front+3,MAT.leaf);
    box(boxes,x-3,14,front+1,x-1,15,front+3,MAT.petal);
    box(boxes,x+1,14,front+1,x+3,15,front+3,MAT.petal);
  }
  // Side windows give the shell life when seen down the street.
  const sideZ = Math.floor((back+front)/2);
  for (const [x,facing] of [[left,'west'],[right,'east']] as const) {
    box(boxes,x-1,15,sideZ-5,x+1,27,sideZ+5,kit.trim);
    box(boxes,x-1,16,sideZ-4,x+1,26,sideZ+4,MAT.glass);
    windows.push({id:`side-${facing}`,centre:[facing === 'west' ? x-1 : x+1,21,sideZ],width:8,height:10,facing});
  }
  // Gables: stepped plaster within a roof whose broad, continuous courses read as tile, not noise.
  for (let i=0;i<24;i+=2) {
    const y=wallTop+i, inset=Math.floor(i*1.15);
    box(boxes,left+inset,y,back,right-inset,y+2,back+2,kit.wall);
    box(boxes,left+inset,y,front-2,right-inset,y+2,front,kit.wall);
  }
  // A little timber-framed attic window breaks the gable's broad plaster plane.
  box(boxes,25,wallTop+3,front-1,39,wallTop+5,front+1,kit.trim);
  box(boxes,28,wallTop+6,front-1,36,wallTop+15,front+1,kit.trim);
  box(boxes,29,wallTop+7,front,35,wallTop+14,front+1,MAT.glass);
  box(boxes,31,wallTop+7,front,33,wallTop+14,front+1,kit.trim);
  windows.push({id:'gable',centre:[32,wallTop+10,front+1],width:6,height:7,facing:'south'});
  for (let i=0;i<28;i+=2) {
    const inset=Math.floor(i*1.05), y=wallTop+i;
    box(boxes,2+inset,y,2,6+inset,y+2,depth-2,kit.roof);
    box(boxes,58-inset,y,2,62-inset,y+2,depth-2,kit.roof);
  }
  box(boxes,29,wallTop+27,2,35,wallTop+29,depth-2,kit.trim);
  // A crooked chimney, offset with a cap.
  const cx = v === 2 ? 17 : 46, cz = back+Math.floor((front-back)*0.3);
  box(boxes,cx,wallTop+10,cz,cx+7,wallTop+30,cz+7,kit.stone);
  box(boxes,cx+1,wallTop+30,cz,cx+8,wallTop+37,cz+7,kit.stone);
  box(boxes,cx,wallTop+37,cz-1,cx+9,wallTop+39,cz+8,kit.trim);
  return {version:1,id:`home-${tier}-${style}-${v}`,styleId:kit.id,kind:'home',lattice:'build',size:[64,Math.max(80,wallTop+40),depth],boxes,windows};
}

/** The monarch's seat: four towers, a raised court and an open gate. */
export function createCastle(style: StyleKey): VoxelBlueprint {
  const kit=STYLES[style], boxes:Box[]=[], windows:Window[]=[];
  box(boxes,12,0,10,244,8,246,kit.stone);
  box(boxes,20,8,20,236,13,238,MAT.paving);
  // Walls frame a real court. Their entrance is carved through front and foundation.
  box(boxes,31,13,32,225,71,39,kit.stone);
  box(boxes,31,13,32,38,71,211,kit.stone);
  box(boxes,218,13,32,225,71,211,kit.stone);
  box(boxes,31,13,204,225,71,211,kit.stone);
  box(boxes,111,0,202,145,45,247,MAT.air);
  box(boxes,115,45,202,141,51,247,MAT.air);
  box(boxes,120,51,202,136,55,247,MAT.air);
  // Entrance arch voussoirs and projecting gate frame.
  box(boxes,106,8,210,111,55,218,kit.trim);
  box(boxes,145,8,210,150,55,218,kit.trim);
  box(boxes,111,55,210,145,60,218,kit.trim);
  // Thirteen shallow, supported courses climb from the approach to the court.
  // Each rises one build cell over four cells of run (0.125 m over 0.5 m).
  for (let step=0; step<13; step++) {
    box(boxes,111,0,202+step*4,145,13-step,206+step*4,MAT.paving);
  }
  // Regular battlements; their gaps establish an iconic roofline.
  for(let x=40;x<218;x+=16) { box(boxes,x,71,204,x+9,79,211,kit.stone); box(boxes,x,71,32,x+9,79,39,kit.stone); }
  for(let z=43;z<204;z+=16) { box(boxes,31,71,z,38,79,z+9,kit.stone); box(boxes,218,71,z,225,79,z+9,kit.stone); }
  // Four chamfered towers, each hollow with small deep windows and steep roofs.
  for (const [cx,cz] of [[38,39],[218,39],[38,205],[218,205]] as const) {
    box(boxes,cx-25,8,cz-19,cx+25,108,cz+19,kit.stone);
    box(boxes,cx-19,8,cz-25,cx+19,108,cz+25,kit.stone);
    box(boxes,cx-18,13,cz-18,cx+18,106,cz+18,MAT.air);
    // Cap ring, then narrow slit windows on the outward-facing tower side.
    box(boxes,cx-27,100,cz-21,cx+27,105,cz+21,kit.trim);
    box(boxes,cx-21,100,cz-27,cx+21,105,cz+27,kit.trim);
    for (const y of [45,72]) {
      if (cz < 100) {
        box(boxes,cx-3,y,cz-26,cx+3,y+12,cz-17,MAT.glass);
        windows.push({id:`tower-${cx}-${cz}-${y}`,centre:[cx,y+6,cz-26],width:6,height:12,facing:'north'});
      } else {
        box(boxes,cx-3,y,cz+17,cx+3,y+12,cz+26,MAT.glass);
        windows.push({id:`tower-${cx}-${cz}-${y}`,centre:[cx,y+6,cz+26],width:6,height:12,facing:'south'});
      }
    }
    for(let i=0;i<22;i+=2) {
      const inset=i, y=105+i*2;
      box(boxes,cx-26+inset,y,cz-20+inset,cx+26-inset,y+4,cz+20-inset,kit.roof);
      box(boxes,cx-20+inset,y,cz-26+inset,cx+20-inset,y+4,cz+26-inset,kit.roof);
    }
    box(boxes,cx-3,149,cz-3,cx+3,170,cz+3,MAT.brass);
    // Small swallowtail flag, fixed to its finial.
    box(boxes,cx+3,162,cz-1,cx+12,169,cz+1,MAT.cloth);
    box(boxes,cx+12,164,cz-1,cx+16,169,cz+1,MAT.cloth);
  }
  // Keep rises from the court, with its own ridged roof and beacon seat.
  box(boxes,76,13,75,180,103,169,kit.wall);
  box(boxes,81,13,80,175,101,164,MAT.air);
  box(boxes,76,13,164,180,103,169,kit.stone);
  box(boxes,116,13,163,140,42,170,MAT.air);
  for (let i=0;i<52;i+=2) {
    box(boxes,72+i,103+i,70,78+i,105+i,174,kit.roof);
    box(boxes,178-i,103+i,70,184-i,105+i,174,kit.roof);
  }
  box(boxes,124,154,70,132,158,174,kit.trim);
  // The slender octagonal lantern tower rises from the keep, turning the
  // beacon into the castle's unmistakable high point.
  box(boxes,104,93,90,152,188,134,kit.stone);
  box(boxes,108,93,86,148,188,138,kit.stone);
  box(boxes,109,105,95,147,185,129,MAT.air);
  // Recessed dark lancets read from afar without claiming to be presence lights.
  for (const x of [115,136]) {
    box(boxes,x,128,134,x+5,159,139,MAT.darkStone);
    box(boxes,x+1,159,134,x+4,164,139,MAT.darkStone);
    box(boxes,x-2,121,135,x+7,124,140,kit.trim);
  }
  box(boxes,101,181,88,155,186,136,kit.trim);
  box(boxes,106,181,83,150,186,141,kit.trim);
  // Two crossed courses per level leave an octagonal, tapering roof.
  for (let i=0;i<24;i+=2) {
    box(boxes,102+i,186+i,90+i,154-i,188+i,134-i,kit.roof);
    box(boxes,108+i,186+i,84+i,148-i,188+i,140-i,kit.roof);
  }
  box(boxes,117,210,101,139,214,123,kit.stone);
  box(boxes,120,214,104,136,226,120,MAT.brass);
  box(boxes,122,226,106,134,240,118,MAT.glass);
  box(boxes,119,240,103,137,244,121,MAT.brass);
  // Banners and buttresses read from the approach.
  for(const x of [59,186]) {
    box(boxes,x,18,208,x+10,62,214,kit.stone);
    box(boxes,x+2,34,214,x+8,62,216,MAT.cloth);
    box(boxes,x+4,39,216,x+6,54,217,MAT.brass);
  }
  return {version:1,id:`castle-${style}`,styleId:kit.id,kind:'civic',lattice:'build',size:[256,248,256],boxes,windows};
}

/** Rounded clusters preserve a readable trunk and an uneven, broadleaf silhouette. */
export function createTree(variant: number): VoxelBlueprint {
  const v=((Math.floor(variant)%3)+3)%3, boxes:Box[]=[];
  const h=34+v*5;
  box(boxes,27,0,27,37,h,37,MAT.bark);
  box(boxes,23,0,29,29,4,35,MAT.bark); box(boxes,35,0,29,41,4,35,MAT.bark);
  box(boxes,29,0,23,35,4,29,MAT.bark); box(boxes,29,0,35,35,4,41,MAT.bark);
  box(boxes,17,h-8,27,32,h-2,34,MAT.bark); box(boxes,32,h-6,30,47,h,37,MAT.bark);
  const leaf=v===1?MAT.goldLeaf:MAT.leaf;
  // Overlapping rounded masses use continuous, stepped ellipsoid courses.
  // Their offsets make an irregular canopy without random speckle.
  for(const [cx,cy,cz,rx,ry,rz] of [[22,h+1,29,13,11,12],[42,h+3,34,13,12,12],[32,h+9,23,12,12,11],[30,h+11,40,12,12,11],[32,h+17,31,11,11,11]] as const) {
    for (let dy=-ry; dy<=ry; dy+=2) {
      const fy = Math.sqrt(Math.max(0, 1 - ((dy+1)/ry)**2));
      for (let dz=-rz; dz<rz; dz+=2) {
        const fz = (dz+1)/rz;
        const half = Math.floor(rx * Math.sqrt(Math.max(0, fy*fy-fz*fz)));
        if (half>0) box(boxes,cx-half,cy+dy,cz+dz,cx+half,cy+dy+2,cz+dz+2,leaf);
      }
    }
  }
  return {version:1,id:`tree-${v}`,styleId:STYLES.grove.id,kind:'flora',lattice:'build',size:[64,80,64],boxes,windows:[]};
}
