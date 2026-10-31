import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import { RUNE_GLSL, RUNE_SITES, runeTable } from './runes';
import { ANVIL_MATERIALS, CHEEK_Z, GRID_MIN, GRID_SIZE, H, MARK_WINDOW, Y_OFFSET, type AnvilSculpt } from './sculpt';

export interface AnvilMaterial {
  state: VoxelRenderState;
  material: THREE.ShaderMaterial;
  uniforms: { uAnvilHeat: { value: number }; uAnvilTime: { value: number }; uAnvilShaping: { value: number }; uAnvilCells: { value: THREE.Data3DTexture }; uAnvilRunes: { value: THREE.DataTexture } };
  dispose(): void;
}

const ids = ANVIL_MATERIALS;
/** Below this height (root-local metres) no rune is cut, so the cheek and feet never search the table. */
const RUNE_FLOOR = Math.min(...RUNE_SITES.map(s => s.centre.y - s.unit - s.halfWidth)) - .01;

/**
 * The iron's own response, identical to the engraving's metal (engraving/index.ts): the same
 * view-space key, the same grazing edge and the same near-black values. A plate cut from that
 * metal and set flush in the cheek has nothing to separate it from the anvil, so the mark reads
 * as cut into the iron, not stuck on it.
 */
export const ANVIL_IRON_GLSL = `
  vec3 anvilIronResponse(vec3 vn){
    float key=max(0.,dot(vn,normalize(vec3(-.45,.75,1.))));
    float edge=pow(1.-abs(vn.z),2.);
    return vec3(.008,.009,.010)+vec3(.018,.020,.022)*key+vec3(.025,.023,.021)*edge;
  }`;

/**
 * The anvil's world light on top of that response. Faces that look up take the hour's sky, so the
 * working face is a cool lilac plane above dark flanks (the vertical cheek takes none, and stays
 * the engraving's exact value). Worn steel is several steps brighter and carries the sky's lilac
 * and the low sun's gold where the sun reaches it. Warm street and forge light tints it all.
 */
const ANVIL_LIGHT_GLSL = `
  vec3 anvilIron(uint id,vec3 vn,vec3 n,vec3 sky,vec3 sun,vec3 warm){
    vec3 metal=anvilIronResponse(vn);
    float up=max(n.y,0.),key=max(0.,dot(vn,normalize(vec3(-.45,.75,1.)))),edge=pow(1.-abs(vn.z),2.);
    metal+=sky*.24*up*up+sun*.03*up+warm*.06;
    if(id==${ANVIL_MATERIALS.steel}u)
      metal=vec3(.02,.022,.027)+vec3(.04,.044,.052)*key+vec3(.035,.035,.037)*edge+sky*.26*(.3+.7*up)+sun*.08+warm*.14;
    if(id==${ANVIL_MATERIALS.rust}u)metal=vec3(.016,.009,.006)+vec3(.022,.012,.007)*key+sky*.04*up+warm*.05;
    if(id==${ANVIL_MATERIALS.dent}u)metal*=.86;
    return metal;
  }`;
const isIron = `(vMaterial==${ids.iron}u||vMaterial==${ids.steel}u||vMaterial==${ids.rust}u||vMaterial==${ids.dent}u)`;

const linear = (hex: string) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(5)},${c.g.toFixed(5)},${c.b.toFixed(5)})`; };
const v3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)})`;
/** Root-local metres of the sculpt's first cell corner: where the stage mesh sits under the root. */
export const STAGE_OFFSET: readonly [number, number, number] = [GRID_MIN[0] * H, GRID_MIN[1] * H + Y_OFFSET, GRID_MIN[2] * H];

/**
 * Light that lives only in the cuts. The rune table (runes.ts) is fixed, so the heat is a pure
 * function of the caller's {time, heat, shaping}: it can be seeked backwards and forwards.
 *
 * - Each rune lights when the heat passes its own threshold, ranked by distance from the mark, so
 *   rising heat flows outward from the mark and falling heat drains from the horn back to it.
 * - Its own temperature walks the cooling ramp amber → orange → red → ember, with a deeper edge
 *   colour against the walls; pour flickers ±8%, the strike adds a last tenth.
 * - While shaping, a fuse runs out through the runes 0.12 s apart.
 * - At pour the working face's arrises warm faintly. Nothing glows outside a cut.
 */
const ANVIL_HEAT_GLSL = `
  const float ANVIL_GLOW=1.15;
  vec3 runeHeat(int r,float core){
    float o=runeTexel(r,1).w,a=.25+.5*o;
    float lit=smoothstep(a,a+.1,uAnvilHeat);
    if(lit<=0.)return vec3(0.);
    float tau=clamp((uAnvilHeat-a)/max(.85-a,.05),0.,1.);
    vec3 ramp=tau>.66?mix(${linear('#ff6a1f')},${linear('#ffb347')},(tau-.66)/.34)
      :tau>.33?mix(${linear('#c2301a')},${linear('#ff6a1f')},(tau-.33)/.33):mix(${linear('#6b1f12')},${linear('#c2301a')},tau/.33);
    vec3 edge=mix(${linear('#6b1f12')},${linear('#c2461a')},tau);
    vec3 colour=mix(edge,ramp,smoothstep(0.,.8,core));
    float flicker=1.+.08*sin(uAnvilTime*6.1+o*17.)*sin(uAnvilTime*2.3+o*7.);
    float span=.12*float(ANVIL_RUNES-1),phase=mod(max(uAnvilTime,0.),span+1.2)-o*span;
    float fuse=uAnvilShaping*exp(-phase*phase*90.);
    float strike=smoothstep(.93,1.,uAnvilHeat);
    return colour*lit*(.5+.4*tau+.1*strike)*flicker*(1.+.45*fuse)*ANVIL_GLOW;
  }`;

/**
 * The sculpt's occupancy, sampled in the fragment shader to find the iron's convex arrises (a narrow
 * worn sheen, never a texture) and where each face runs out.
 */
const ANVIL_CELLS_GLSL = `
  const vec3 ANVIL_GRID=${v3(...STAGE_OFFSET)};
  const ivec3 ANVIL_SIZE=ivec3(${GRID_SIZE.join(',')});
  const float ANVIL_H=${H.toFixed(5)};
  bool anvilSolid(ivec3 c){return all(greaterThanEqual(c,ivec3(0)))&&all(lessThan(c,ANVIL_SIZE))&&texelFetch(uAnvilCells,c,0).r>.5;}
  // Metres from a point on a face to that face's nearest convex arris (where the next cell is air).
  float anvilArris(vec3 p,vec3 n){
    vec3 q=(p-ANVIL_GRID)/ANVIL_H;ivec3 c=ivec3(floor(q-n*.5));vec3 f=q-vec3(c);
    vec3 a=abs(n.x)>.5?vec3(0,1,0):vec3(1,0,0),b=abs(n.z)>.5?vec3(0,1,0):vec3(0,0,1);
    ivec3 ia=ivec3(a),ib=ivec3(b);float fa=dot(f,a),fb=dot(f,b),d=1.;
    if(!anvilSolid(c+ia))d=min(d,1.-fa);
    if(!anvilSolid(c-ia))d=min(d,fa);
    if(!anvilSolid(c+ib))d=min(d,1.-fb);
    if(!anvilSolid(c-ib))d=min(d,fb);
    return d*ANVIL_H;
  }`;

/**
 * A cut seen through its opening. The ray from the eye enters the stroke at the face and travels into
 * the iron until it meets a wall or the bed, so the walls show their true depth from every angle and
 * the silhouette of the stroke is exact at any distance. Returns 0 outside a cut, 1 on a wall, 2 on
 * the bed; with the surface normal hit (local), how deep it is (0..1) and, on the bed, how far from
 * the walls (0 at a wall, 1 on the stroke's centre line).
 */
const ANVIL_CUT_GLSL = `
  float anvilCut(vec3 p,vec3 n,out vec3 hitN,out float depth,out float core,out int rune){
    hitN=n;depth=0.;core=0.;rune=-1;
    // Every rune is cut into a side or end face of the plate, step or horn: nothing below them is searched.
    if(abs(n.y)>.5||p.y<${RUNE_FLOOR.toFixed(4)})return 0.;
    for(int r=0;r<ANVIL_RUNES;r++){
      vec4 face=runeTexel(r,1);vec3 N=face.xyz;
      if(dot(n,N)<.99)continue;
      vec4 place=runeTexel(r,0);vec3 dp=p-place.xyz;
      if(abs(dot(dp,N))>.003)continue;
      vec3 U=runeTexel(r,2).xyz,V=cross(N,U);float s=place.w;
      vec2 q=vec2(dot(dp,U),dot(dp,V))/s;
      if(abs(q.x)>1.3||abs(q.y)>1.4)continue;
      rune=r;
      if(runeField(r,q)>0.)return 0.;
      vec3 rd=normalize(p-vAnvilEye);float k=max(-dot(rd,N),.08);
      vec3 L=(rd+N*k)/k;vec2 l=vec2(dot(L,U),dot(L,V))/s;
      float D=runeTexel(r,3).z,lo=0.,hi=D;bool wall=false;
      for(int i=1;i<=10;i++){float t=D*float(i)/10.;if(runeField(r,q+l*t)>0.){hi=t;wall=true;break;}lo=t;}
      if(wall)for(int i=0;i<5;i++){float m=(lo+hi)*.5;if(runeField(r,q+l*m)>0.)hi=m;else lo=m;}
      float t=wall?hi:D;vec2 h=q+l*t;depth=t/D;
      if(wall){
        float e=.02;
        vec2 g=vec2(runeField(r,h+vec2(e,0.))-runeField(r,h-vec2(e,0.)),runeField(r,h+vec2(0.,e))-runeField(r,h-vec2(0.,e)));
        hitN=normalize(-(g.x*U+g.y*V));
        return 1.;
      }
      core=clamp(-runeField(r,h)/runeTexel(r,2).w,0.,1.);
      return 2.;
    }
    return 0.;
  }`;

/**
 * The production voxel material on the character lattice, with a hero treatment for the iron.
 *
 * Iron is the engraving's metal (ANVIL_IRON_GLSL) plus the hour's sky on its upward faces; the
 * mesher's corner AO and sky openness still darken the hardy hole, the arches and the hollows.
 * Every convex arris of the iron carries a narrow cool sheen where the edge has been rounded by use.
 * The runes are cut 1.5 cm into it with walls and a bed, and glow only on that bed (and faintly on
 * the walls beside it). Stone keeps the kingdom's light, sky, sun and shadow response, as a matte
 * monolith rather than coursed masonry. Dusk reaches the iron as a lilac and gold rim on the steel.
 */
export function createAnvilMaterial(sculpt: AnvilSculpt): AnvilMaterial {
  const state = createVoxelMaterial(MATERIALS, 'avatar');
  const source = state.material;
  const occupancy = new Uint8Array(sculpt.voxels.length);
  sculpt.voxels.forEach((m, i) => { occupancy[i] = m ? 255 : 0; });
  // The mark's window is filled by the engraving's plate: its rim is not an arris, so it takes no worn sheen.
  for (let x = MARK_WINDOW.x[0]; x < MARK_WINDOW.x[1]; x++) for (let row = MARK_WINDOW.rows[0]; row < MARK_WINDOW.rows[1]; row++) {
    occupancy[(x - GRID_MIN[0]) + sculpt.size[0] * ((row - GRID_MIN[1]) + sculpt.size[1] * (CHEEK_Z - 1 - GRID_MIN[2]))] = 255;
  }
  const cells = new THREE.Data3DTexture(occupancy, ...sculpt.size);
  cells.format = THREE.RedFormat; cells.type = THREE.UnsignedByteType;
  cells.minFilter = cells.magFilter = THREE.NearestFilter; cells.unpackAlignment = 1; cells.needsUpdate = true;
  const table = runeTable();
  const runes = new THREE.DataTexture(table.data, table.width, 1, THREE.RGBAFormat, THREE.FloatType);
  runes.minFilter = runes.magFilter = THREE.NearestFilter; runes.needsUpdate = true;
  const uniforms = { uAnvilHeat: { value: 0 }, uAnvilTime: { value: 0 }, uAnvilShaping: { value: 0 }, uAnvilCells: { value: cells }, uAnvilRunes: { value: runes } };
  const replace = (shader: string, from: string, to: string) => {
    if (shader.split(from).length !== 2) throw new Error(`The anvil material no longer matches the voxel shader at "${from.slice(0, 40)}".`);
    return shader.replace(from, to);
  };
  // Root-local position, eye and face axis, plus the model's axes to light a cut's walls in the world.
  let vertex = replace(source.vertexShader, 'void main(){', `out vec3 vAnvilLocal,vAnvilEye,vAnvilNormal,vAnvilX,vAnvilY,vAnvilZ;
    const vec3 ANVIL_STAGE=${v3(...STAGE_OFFSET)};
    void main(){`);
  vertex = replace(vertex, 'vWorld=world.xyz;', `vWorld=world.xyz;
      vAnvilLocal=local.xyz+ANVIL_STAGE;vAnvilEye=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz+ANVIL_STAGE;vAnvilNormal=n;
      vAnvilX=normalize(mat3(modelMatrix)*vec3(1,0,0));vAnvilY=normalize(mat3(modelMatrix)*vec3(0,1,0));vAnvilZ=normalize(mat3(modelMatrix)*vec3(0,0,1));`);
  let fragment = replace(source.fragmentShader, 'void main(){', `uniform float uAnvilHeat,uAnvilTime,uAnvilShaping;
    uniform highp sampler3D uAnvilCells;
    uniform highp sampler2D uAnvilRunes;
    in vec3 vAnvilLocal,vAnvilEye,vAnvilNormal,vAnvilX,vAnvilY,vAnvilZ;
    ${ANVIL_IRON_GLSL}
    ${ANVIL_LIGHT_GLSL}
    ${RUNE_GLSL}
    ${ANVIL_HEAT_GLSL}
    ${ANVIL_CELLS_GLSL}
    ${ANVIL_CUT_GLSL}
    void main(){`);
  // Keep the sky and the (shadowed) sun apart before the street's warm light joins them.
  fragment = replace(fragment, 'vec3 uvw=(vWorld-uLightOrigin)/uLightExtent;', `vec3 anvilSky=cool,anvilSun=light-cool;
      vec3 uvw=(vWorld-uLightOrigin)/uLightExtent;`);
  fragment = replace(fragment, 'float kind=swatch.a;', `float kind=swatch.a;
      bool heroIron=${isIron};
      // A monolith: the block is one dressed stone, without the kingdom's coursed mortar.
      if(vMaterial==${ids.stone}u)kind=5.;
      if(vMaterial==${ids.stain}u){base=texelFetch(uPalette,ivec2(${ids.stone},0),0).rgb*vec3(.5,.47,.45);kind=5.;}
      if(heroIron)kind=8.;`);
  fragment = replace(fragment, 'vec3 colour=base*edge*light*ao;', `vec3 colour=base*edge*light*ao;
      if(heroIron){
        vec3 ln=normalize(vAnvilNormal),anvilWarm=light-anvilSky-anvilSun;
        float shade=mix(.42,1.,vAo)*mix(.3,1.,smoothstep(.0,.55,vSky));
        colour=anvilIron(vMaterial,normalize((viewMatrix*vec4(n,0.)).xyz),n,anvilSky,anvilSun,anvilWarm)*shade;
        // Use has rounded every outer edge a little: a narrow cool line, brighter where it faces the sky.
        float arris=anvilArris(vAnvilLocal,ln),worn=1.-smoothstep(.0015,.0065,arris);
        colour+=(vec3(.016,.017,.02)+anvilSky*(.05+.07*max(n.y,0.)))*worn*shade;
        // Dusk rim: the worn upper arrises catch the sky's lilac and the low sun's gold. Up close it is
        // the same 6 mm sheen; from across the square it never drops below about one pixel, so the
        // anvil's top line and horn still draw themselves against the houses when the iron is cold.
        float footprint=length(fwidth(vAnvilLocal)),reach=max(.0065,footprint*1.15);
        float rim=(1.-smoothstep(reach*.3,reach,arris))*smoothstep(.95,1.25,vAnvilLocal.y)*mix(.45,1.,max(ln.y,0.));
        float far=smoothstep(.004,.02,footprint);
        colour+=(anvilSky*.42+anvilSun*.3+${linear('#3a2f4a')}*.12)*rim*mix(.35,1.,far)*mix(.6,1.,shade);
        // At pour, the working face's edges warm a little, and only within two centimetres of them.
        colour+=${linear('#5a2a18')}*.2*ANVIL_GLOW*smoothstep(.6,.85,uAnvilHeat)*(1.-smoothstep(0.,.02,arris))*step(.5,ln.y)*step(${(1.3).toFixed(2)},vAnvilLocal.y);
        vec3 hitN;float depth,core;int rune;
        float cut=anvilCut(vAnvilLocal,ln,hitN,depth,core,rune);
        if(cut>0.){
          vec3 worldN=normalize(hitN.x*vAnvilX+hitN.y*vAnvilY+hitN.z*vAnvilZ);
          vec3 metal=anvilIron(${ids.iron}u,normalize((viewMatrix*vec4(worldN,0.)).xyz),worldN,anvilSky,anvilSun,anvilWarm);
          vec3 heat=runeHeat(rune,core);
          // Walls darken with depth and catch the bed's heat near the bottom; the bed sits in shadow.
          colour=cut<1.5?metal*shade*mix(1.15,.45,depth)+heat*.5*depth*depth:metal*shade*.5+heat;
        }
      }`);
  const material = new THREE.ShaderMaterial({
    glslVersion: source.glslVersion, uniforms: { ...source.uniforms, ...uniforms },
    vertexShader: vertex, fragmentShader: fragment,
  });
  return {
    state, material, uniforms,
    dispose() { material.dispose(); state.dispose(); cells.dispose(); runes.dispose(); },
  };
}
