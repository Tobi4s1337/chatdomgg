import { CLAY, KitBuilder, random, type ArtisanKit, type Point } from '../kit';
import { createTree, type ForestSpecies } from '../forest';
import { createCitadel } from '../citadel';
import { createWindmill, createFields } from '../fields';
import { createHarbour } from '../harbour';
import { createGeologySampler, GEOLOGY_COLOURS } from '../geology';

/** Authored composition choices, bound to broadcaster identity, never a mutable display login. */
export interface ChannelComposition {
  readonly broadcasterId: string;
  readonly login: string;
  readonly character: 'mere' | 'harbour' | 'river' | 'mountain';
  readonly forest: ForestSpecies;
  readonly secondary: ForestSpecies;
  readonly crest: string;
  readonly castle: Point;
  readonly harbour: Point;
  readonly fields: Point;
  readonly forestCentre: Point;
  readonly riverX: number;
  readonly ridgeHeight: number;
  readonly town: Point;
}
export const CHANNEL_COMPOSITIONS: readonly ChannelComposition[] = [
  { broadcasterId: '129634568', login: 'tobi4s_', character: 'mere', forest: 'gold', secondary: 'teal', crest: '#bd675b', castle: [-12, 23, 38], harbour: [38, 0, -120], fields: [66, 9, -53], forestCentre: [-112, 9, -13], riverX: -68, ridgeHeight: 86, town: [0, 9, -38] },
  { broadcasterId: '63920635', login: 'The_AGGman', character: 'harbour', forest: 'pine', secondary: 'gold', crest: '#5a8293', castle: [-38, 22, 56], harbour: [10, 0, -113], fields: [64, 9, -40], forestCentre: [-126, 9, -5], riverX: 70, ridgeHeight: 72, town: [-3, 9, -30] },
  { broadcasterId: '4363967', login: 'PinkKittyRose', character: 'river', forest: 'cherry', secondary: 'willow', crest: '#b7758c', castle: [37, 22, 55], harbour: [-40, 0, -120], fields: [65, 9, -65], forestCentre: [-114, 9, 3], riverX: -42, ridgeHeight: 70, town: [17, 9, -36] },
  { broadcasterId: '154972160', login: 'MashaD4', character: 'mountain', forest: 'pine', secondary: 'birch', crest: '#8b7197', castle: [0, 32, 38], harbour: [48, 0, -124], fields: [62, 9, -50], forestCentre: [-113, 12, -2], riverX: -72, ridgeHeight: 118, town: [3, 12, -37] },
];
export function channelComposition(identity: string): ChannelComposition {
  const key = identity.toLowerCase();
  const result = CHANNEL_COMPOSITIONS.find(p => p.broadcasterId === identity || p.login.toLowerCase() === key);
  if (!result) throw new Error(`No authored grand composition for ${identity}`);
  return result;
}

/** Macro visual study; the grand builder applies these constraints to its canonical field.
 * Installed lots/streets take precedence over this preview's unoccupied home origins. */
export function createComposition(identity: string): ArtisanKit {
  const p = channelComposition(identity), seed = `grand-artisans-v1/${p.broadcasterId}`;
  const b = new KitBuilder(), rng = random(seed), geo = createGeologySampler(seed);
  const sea = 0;
  const river = (z: number) => p.riverX + 9 * Math.sin(z / 39);
  const riverLevel = (z: number) => z > 54 ? 27 : z > 25 ? 15 : z > -32 ? 7 : z > -85 ? 3 : 0;
  const inMere = (x: number, z: number) => p.character === 'mere' && ((x + 86) / 20) ** 2 + ((z - 19) / 15) ** 2 < 1;
  const wet = (x: number, z: number) => inMere(x,z) || Math.abs(x - river(z)) < 5 + Math.max(0, 80 - z) / 22;
  const terrain = (x: number, z: number) => {
    const ellipse = Math.hypot(x / 195, z / 150);
    const coast = 1 - ellipse + .035 * Math.sin(x / 17) * Math.sin(z / 26);
    if (coast < 0) return sea;
    let h = Math.min(9, 2 + coast * 65);
    const ridgeZ = 99 + 9 * Math.sin(x / 48);
    const spine = Math.max(0, 1 - Math.abs(z - ridgeZ) / 43);
    const peaks = .6 + .24 * Math.sin(x / 20) + .16 * Math.sin(x / 7.7);
    h += p.ridgeHeight * spine ** 1.55 * peaks;
    const castleD = Math.hypot(x - p.castle[0], z - p.castle[2]);
    if (castleD < 50) h = Math.max(h, p.castle[1] - Math.max(0, castleD - 40) * 1.5);
    if (Math.abs(x - p.town[0]) < 64 && z > -88 && z < 5) h = p.town[1];
    // A graded terrace receives the mill and parcels. The public generator must fit it to its source field.
    if (x >= p.fields[0] - 5 && x <= p.fields[0] + 108 && z >= p.fields[2] - 5 && z <= p.fields[2] + 108) h = 9;
    if (wet(x,z)) h = Math.min(h, (inMere(x,z) ? 7 : riverLevel(z)) - 3);
    return Math.round(h);
  };
  // Coherent columns, coloured bands and slope-sensitive snow; no independent random voxel colour.
  for (let z = -150; z <= 150; z += 2) for (let x = -198; x <= 198; x += 2) {
    const y = terrain(x,z); if (y <= sea) continue;
    const slope = Math.max(Math.abs(terrain(x+2,z)-y), Math.abs(terrain(x,z+2)-y))/2;
    const col = geo.column(x,z);
    if (y > 18) {
      for (let lo = sea; lo < y;) {
        const mat = col.material(lo,y-1,slope,p.character==='mountain'?68:56,.4,false);
        let hi = lo+1; while (hi < y && col.material(hi,y-1,slope,p.character==='mountain'?68:56,.4,false)===mat) hi++;
        b.box(x,lo,z,2,hi-lo,2,GEOLOGY_COLOURS[mat]!); lo=hi;
      }
    } else b.box(x,sea,z,2,y-sea,2,CLAY.earth);
    if (!wet(x,z)) b.box(x,y,z,2,1,2,y < 4 ? CLAY.sand : y > 22 && slope > 1.1 ? GEOLOGY_COLOURS[col.material(y,y,slope,56,.4,false)]! : CLAY.grass);
  }
  // The open sea is a single study surface. A warmer sand shelf makes the coast legible.
  b.box(-228,sea-1,-180,456,1,350,'#4b8797');
  for (let z=-140;z<92;z++) {
    const x=Math.round(river(z)), width=Math.round(5+Math.max(0,80-z)/22), level=riverLevel(z);
    b.box(x-width,level,z,width*2+1,1,1,CLAY.water);
    if (z===54||z===25||z===-32||z===-85) {
      const upper=riverLevel(z+1); b.box(x-width,level,z,width*2+1,upper-level+1,1,'#8bbbc1');
      b.box(x-width,level+1,z-2,width*2+1,1,1,CLAY.foam);
    }
  }
  if (p.character==='mere') for(let z=5;z<34;z++) {
    const half=Math.round(19*Math.sqrt(Math.max(0,1-((z-19)/15)**2)));
    b.box(-86-half,7,z,2*half+1,1,1,CLAY.water);
  }
  // Broadleaf and conifer groves live in separate masses. Trees never enter the settlement reserve.
  for(let i=0;i<58;i++) {
    const a=rng()*Math.PI*2, d=Math.sqrt(rng())*48;
    const x=Math.round(p.forestCentre[0]+Math.cos(a)*d), z=Math.round(p.forestCentre[2]+Math.sin(a)*d);
    if(wet(x,z)||terrain(x,z)<5) continue;
    const species=i%5===0?p.secondary:p.forest;
    b.add(createTree(species,`${seed}:grove:${i}`, .72+rng()*.3),[x,terrain(x,z)+1,z]);
  }
  b.add(createTree(p.secondary,seed+':hero',1.6),[-85,terrain(-85,-61)+1,-61]);
  b.add(createCitadel(seed),p.castle);
  b.add(createFields(seed),p.fields);
  b.add(createWindmill(seed),[p.fields[0]+13,10,p.fields[2]+91]);
  b.add(createHarbour(seed),p.harbour);
  // Backing ground receives the quay rather than leaving it suspended above the sea.
  b.box(p.harbour[0]-61,sea,p.harbour[2]+20,123,13,15,CLAY.earth);
  b.box(p.harbour[0]-61,10,p.harbour[2]+20,123,1,15,CLAY.grass);
  // Roads and native home origins use the exact accepted models in the app review, never substitute boxes.
  const anchors:Record<string,Point>={
    hero:[p.castle[0],52,p.castle[2]], street:[p.town[0],15,-40],
    coast:[p.harbour[0],18,p.harbour[2]], dusk:[p.castle[0],47,15],
    castle:p.castle, harbour:p.harbour, fields:p.fields,
  };
  b.box(p.town[0]-61,p.town[1]+1,-56,122,1,5,'#b7a385');
  b.box(p.town[0]-2,p.town[1]+1,-88,5,1,104,'#b7a385');
  for(let row=0;row<2;row++) for(let col=0;col<7;col++) {
    const x=p.town[0]-59+col*18, z=-76+row*43;
    let supported = true;
    for (let dz=0;dz<24;dz+=2) for (let dx=0;dx<16;dx+=2) {
      if (wet(x+dx,z+dz) || terrain(x+dx,z+dz)!==p.town[1]) supported=false;
    }
    if(!supported) continue;
    anchors[`home-${row*7+col}`]=[x,p.town[1]+1,z];
  }
  // A masonry bridge carries the preview street over its actual channel; no paving floats over it.
  const crossing = Math.round(river(-54)), half = Math.round(5+134/22);
  if (crossing+half > p.town[0]-61 && crossing-half < p.town[0]+61) {
    b.box(crossing-half-3,p.town[1]-1,-57,half*2+7,3,7,CLAY.stoneLight);
    for(const z of [-58,-51]) {
      b.box(crossing-half-3,p.town[1]+2,z,half*2+7,1,1,CLAY.trim);
      for(let x=crossing-half-3;x<=crossing+half+3;x+=4)b.box(x,p.town[1]+3,z,1,2,1,CLAY.stone);
    }
    for(let inset=0;inset<4;inset++) {
      const h=4-inset;
      b.box(crossing-half-3+inset,p.town[1]-1-h,-57,1,h,7,CLAY.stone);
      b.box(crossing+half+3-inset,p.town[1]-1-h,-57,1,h,7,CLAY.stone);
    }
  }
  for(const [x,z,h] of [[-182,-80,19],[168,-106,13]] as const) {
    for(let y=0;y<h;y+=3) {
      const r=Math.max(2,6-Math.floor(y/5));
      b.box(x-r,sea+y,z-r,2*r+1,Math.min(3,h-y),2*r+1,GEOLOGY_COLOURS[14+(y/3|0)]!);
    }
    b.box(x-2,sea+h,z-2,5,1,5,CLAY.grass);
  }
  // Side walls frame the street without enclosing the castle or inventing occupied districts.
  for(const side of [-1,1]) {
    const x=p.town[0]+side*68;
    b.box(x,p.town[1]+1,-88,3,11,94,CLAY.stone);
    b.box(x-1,p.town[1]+12,-88,5,2,94,CLAY.trim);
    for(let z=-86;z<6;z+=7)b.box(x-1,p.town[1]+14,z,5,3,3,CLAY.stoneLight);
  }
  return b.finish(`grand-composition-${p.login}`,anchors);
}
