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
  { broadcasterId: '63920635', login: 'The_AGGman', character: 'harbour', forest: 'pine', secondary: 'gold', crest: '#5a8293', castle: [-115, 23, 72], harbour: [0, 0, -20], fields: [64, 9, -40], forestCentre: [-137, 9, 30], riverX: 145, ridgeHeight: 48, town: [-3, 9, -30] },
  { broadcasterId: '4363967', login: 'PinkKittyRose', character: 'river', forest: 'cherry', secondary: 'willow', crest: '#b7758c', castle: [105, 22, 75], harbour: [-40, 0, -120], fields: [65, 9, -65], forestCentre: [-132, 9, 35], riverX: 0, ridgeHeight: 48, town: [0, 9, -36] },
  { broadcasterId: '154972160', login: 'MashaD4', character: 'mountain', forest: 'pine', secondary: 'birch', crest: '#8b7197', castle: [-100, 38, 66], harbour: [48, 0, -124], fields: [62, 9, -50], forestCentre: [-145, 12, -10], riverX: 150, ridgeHeight: 118, town: [3, 18, -37] },
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
  const river = (z: number) => p.riverX + (p.character === 'river' ? 17 : 9) * Math.sin(z / 45);
  const riverLevel = (z: number) => p.character === 'river' ? Math.max(0, Math.min(3, Math.round((175-Math.abs(z))/10))) : z > 54 ? 27 : z > 25 ? 15 : z > -32 ? 7 : z > -85 ? 3 : 0;
  const inMere = (x: number, z: number) => p.character === 'mere' && ((x + 84) / 38) ** 2 + ((z + 14) / 27) ** 2 < 1;
  const width = (z: number) => p.character === 'river' ? 15 + Math.max(0, 60-z)/40 : 5 + Math.max(0, 80-z)/22;
  const wet = (x: number, z: number) => inMere(x,z) || ((p.character === 'river' || (p.character === 'mere' && z < 92)) && Math.abs(x - river(z)) < width(z));
  // Smooth signed ellipse fields with a seeded shoreline rhythm. The masks fit
  // entirely inside the sampled domain; no straight sampling edge becomes coast.
  const shorePhase = Number(p.broadcasterId.slice(-3)) / 71;
  const ellipse = (x:number,z:number,cx:number,cz:number,rx:number,rz:number) =>
    1 - Math.hypot((x-cx)/rx, (z-cz)/rz);
  const landMask = (x:number,z:number) => {
    const wobble = .025*Math.sin(x/19+shorePhase)*Math.sin(z/31-shorePhase)
      + .018*Math.sin((x+z)/26+shorePhase);
    if (p.character === 'harbour') {
      const land = Math.max(ellipse(x,z,0,65,205,100), ellipse(x,z,-140,-45,65,125), ellipse(x,z,140,-45,65,125));
      return Math.min(land+wobble, -ellipse(x,z,0,-95,98,100));
    }
    if (p.character === 'mere') return ellipse(x,z,0,0,215,158)+wobble;
    if (p.character === 'river') return ellipse(x,z,0,0,212,165)+wobble;
    return ellipse(x,z,0,0,218,162)+wobble;
  };
  const terrain = (x: number, z: number) => {
    const coast = landMask(x,z);
    if (coast <= 0) return sea;
    let h = Math.min(9, 2 + coast * 65);
    // Long connected spine, asymmetric shoulders and a low saddle instead of
    // regularly spaced cones. Masha's pass descends between two massif shoulders.
    const ridgeZ = 112 + 15 * Math.sin(x / 95);
    const spine = Math.max(0, 1 - Math.abs(z - ridgeZ) / 76);
    const shoulder = .55 + .32 * Math.exp(-(((x+115)/65)**2)) + .43 * Math.exp(-(((x-110)/58)**2));
    const saddle = p.character === 'mountain' ? 1 - .72 * Math.exp(-((x/46)**2)) : 1;
    h += p.ridgeHeight * spine ** 1.35 * shoulder * saddle;
    if (p.character === 'mountain') h += Math.max(0, 20 - Math.abs(x+80)/7) * Math.max(0,1-Math.abs(z-10)/140);
    const castleD = Math.hypot(x - p.castle[0], z - p.castle[2]);
    if ((p.character === 'mere' || p.character === 'mountain') && castleD < 50) h = Math.max(h, p.castle[1] - Math.max(0, castleD - 40) * 1.5);
    if ((p.character === 'harbour' ? ((Math.abs(x)<120 && z>=8 && z<100) || (Math.abs(x)>100 && z>-110 && z<8)) : (Math.abs(x-p.town[0])<100 && z>-100 && z<8))) h = p.character === 'mountain' ? (z < -55 ? 12 : z < -20 ? 18 : 24) : p.town[1];
    // A graded terrace receives the mill and parcels. The public generator must fit it to its source field.
    if (p.character === 'mere' && x >= p.fields[0] - 5 && x <= p.fields[0] + 108 && z >= p.fields[2] - 5 && z <= p.fields[2] + 108) h = 9;
    if (wet(x,z)) h = Math.min(h, (inMere(x,z) ? 7 : riverLevel(z)) - 3);
    // Fade height at the actual curved shore, not at the sampling rectangle.
    return Math.round(h * Math.min(1, coast * 18));
  };
  // Coherent columns, coloured bands and slope-sensitive snow; no independent random voxel colour.
  for (let z = -190; z <= 190; z += 2) for (let x = -240; x <= 240; x += 2) {
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
  if (p.character === 'mere' || p.character === 'river') for (let z=-185;z<=185;z++) {
    const x=Math.round(river(z));
    if (landMask(x,z) <= 0 || (p.character === 'mere' && z >= 92)) continue;
    const width=Math.round(p.character === 'river' ? 15+Math.max(0,60-z)/40 : 5+Math.max(0,80-z)/22), level=riverLevel(z);
    b.box(x-width,level,z,width*2+1,1,1,CLAY.water);
    if (p.character === 'mere' && (z===54||z===25||z===-32||z===-85)) {
      const upper=riverLevel(z+1); b.box(x-width,level,z,width*2+1,upper-level+1,1,'#8bbbc1');
      b.box(x-width,level+1,z-2,width*2+1,1,1,CLAY.foam);
    }
  }
  if (p.character==='mere') for(let z=-41;z<13;z++) {
    const half=Math.round(38*Math.sqrt(Math.max(0,1-((z+14)/27)**2)));
    b.box(-84-half,7,z,2*half+1,1,1,CLAY.water);
  }
  // Broadleaf and conifer groves live in separate masses. Trees never enter the settlement reserve.
  for(let i=0;i<58;i++) {
    const a=rng()*Math.PI*2, d=Math.sqrt(rng())*48;
    const x=Math.round(p.forestCentre[0]+Math.cos(a)*d), z=Math.round(p.forestCentre[2]+Math.sin(a)*d);
    if(wet(x,z)||terrain(x,z)<5) continue;
    const species=i%5===0?p.secondary:p.forest;
    b.add(createTree(species,`${seed}:grove:${i}`, .72+rng()*.3),[x,terrain(x,z)+1,z]);
  }
  if (terrain(-85,-61)>4) b.add(createTree(p.secondary,seed+':hero',1.6),[-85,terrain(-85,-61)+1,-61]);
  if (p.character === 'mere' || p.character === 'mountain') b.add(createCitadel(seed),p.castle);
  if (p.character === 'mere') {
    b.add(createFields(seed),p.fields);
    b.add(createWindmill(seed),[p.fields[0]+13,10,p.fields[2]+91]);
  }
  if (p.character === 'harbour') b.add(createHarbour(seed),p.harbour);
  // Roads and native home origins use the exact accepted models in the app review, never substitute boxes.
  const targets: Record<ChannelComposition['character'], { hero: Point; street: Point; coast: Point; dusk: Point }> = {
    mere: { hero: [-32, 24, 6], street: [0, 15, -40], coast: [-84, 8, -14], dusk: [-55, 20, 6] },
    harbour: { hero: [0, 18, -35], street: [0, 15, 40], coast: [0, 12, -20], dusk: [0, 16, -25] },
    river: { hero: [0, 17, -25], street: [-43, 15, -42], coast: [0, 9, -68], dusk: [0, 15, -25] },
    mountain: { hero: [-25, 38, 30], street: [-20, 24, -35], coast: [0, 24, -55], dusk: [-45, 38, 30] },
  };
  const anchors:Record<string,Point>={
    ...targets[p.character], castle:p.castle, harbour:p.harbour, fields:p.fields,
  };
  // Streets and lot origins follow the banks or rising contours; each full
  // native 8 x 12 m cottage envelope must be dry and supported.
  const rows = p.character === 'mountain' ? [-85,-50,-15] : p.character === 'harbour' ? [-85,-50,12,47] : [-76,-33];
  for (let row=0;row<rows.length;row++) {
    const z=rows[row]!;
    const level=p.character === 'mountain' ? (z < -55 ? 12 : z < -20 ? 18 : 24) : p.town[1];
    for (let col=0;col<(p.character === 'harbour' ? 20 : 10);col++) {
      const x=(p.character === 'harbour' ? -181 : -91)+col*19;
      let supported=true;
      for(let dz=0;dz<24;dz+=2) for(let dx=0;dx<16;dx+=2)
        if(wet(x+dx,z+dz)||terrain(x+dx,z+dz)!==level) supported=false;
      if(supported) anchors[`home-${row*20+col}`]=[x,level+1,z];
    }
    // Broken into dry segments so roads never span the river unsupported.
    for(let x=-94;x<94;x+=2) if(!wet(x,z+25) && terrain(x,z+25)===level)
      b.box(x,level+1,z+25,2,1,4,'#b7a385');
  }
  if (p.character === 'river') {
    // Two separate bridges connect both banks of the town.
    for(const z of [-68,-22]) {
      const x=Math.round(river(z)), half=Math.ceil(width(z))+4;
      b.box(x-half,8,z,half*2,3,7,CLAY.stoneLight);
      for(const side of [-1,1]) b.box(x-half,11,z+(side<0?0:6),half*2,2,1,CLAY.trim);
      for(const side of [-1,1]) b.box(x+side*(half-3)-2,3,z,4,5,7,CLAY.stone);
    }
    for (let z=-100;z<70;z+=25) for(const side of [-1,1]) {
      const x=Math.round(river(z)+side*(width(z)+10));
      if(terrain(x,z)>4) b.add(createTree('willow',`${seed}:bank:${z}:${side}`,1),[x,terrain(x,z)+1,z]);
    }
  }
  if (p.character === 'mountain') {
    // Retaining walls expose the rising terraces and sit against the terrain.
    for(const [z,y] of [[-55,12],[-20,18]] as const)
      b.box(-100,y,z,200,6,2,CLAY.stone);
  }
  return b.finish(`grand-composition-${p.login}`,anchors);
}
