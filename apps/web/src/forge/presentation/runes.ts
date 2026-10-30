import * as THREE from 'three';

/**
 * The Forge's rune alphabet: sixteen staves drawn for Chatdom, in glyph units (x ±0.75, y ±1).
 * Each glyph is a list of polylines; a single point is a small diamond mark. They are deliberately not
 * letters, so no rune can spell a request, a plan or a person's name.
 */
const ALPHABET: readonly (readonly (readonly [number, number])[])[][] = [
  [[[0, -1], [0, 1], [.5, .6]], [[-.42, -.25]]],
  [[[-.6, -.15], [0, .55], [.6, -.15]], [[0, .55], [0, -1]]],
  [[[-.3, -1], [-.3, .6]], [[.3, -.6], [.3, 1]], [[-.3, .12], [.3, -.12]]],
  [[[0, 1], [.48, .42], [0, -.16], [-.48, .42], [0, 1]], [[0, -.16], [0, -1]]],
  [[[0, -1], [0, 1]], [[0, .78], [-.5, .36]], [[0, .08], [-.5, -.34]], [[.42, .5]]],
  [[[-.45, -1], [-.45, .45], [.08, 1]], [[.42, .3], [.42, -.62]], [[.0, -.2]]],
  [[[0, -1], [0, .66], [.42, 1], [.7, .74]], [[-.42, -.52], [0, -.52]]],
  [[[-.6, -.92], [0, .92], [.6, -.92]], [[0, -.32]]],
  [[[0, -1], [0, 1]], [[0, .46], [.36, 0], [0, -.46], [-.36, 0], [0, .46]]],
  [[[-.62, .7], [-.12, .7], [-.26, 0], [.24, 0], [.1, -.7], [.6, -.7]]],
  [[[0, -1], [0, .4], [-.5, 1]], [[0, .4], [.5, 1]], [[-.45, -.35], [.45, -.35]]],
  [[[0, -1], [0, 1]], [[-.5, .16], [.5, .58]], [[0, -1], [.42, -.7]]],
  [[[-.4, 1], [-.4, -.6], [.42, -1]], [[.14, .66]], [[.42, .16]]],
  [[[0, 1], [0, -.08], [-.5, -1]], [[0, -.08], [.5, -1]], [[-.4, .64]]],
  [[[-.2, 1], [.26, .2], [-.2, -.4], [.1, -1]], [[.26, .2], [.62, .36]]],
  [[[-.5, .92], [0, .52], [.5, .92]], [[-.5, .12], [0, -.28], [.5, .12]], [[0, -.28], [0, -1]]],
];

export const RUNE_SLOTS = 11;
const STROKES = 6;
type Stroke = [number, number, number, number];

function strokes(glyph: (typeof ALPHABET)[number]): Stroke[] {
  const out: Stroke[] = [];
  for (const line of glyph) {
    if (line.length === 1) { const [x, y] = line[0]!; out.push([x - .07, y - .07, x + .07, y + .07]); continue; }
    for (let i = 1; i < line.length; i++) out.push([line[i - 1]![0], line[i - 1]![1], line[i]![0], line[i]![1]]);
  }
  return out;
}
const GLYPHS = ALPHABET.map(strokes);
if (GLYPHS.some(g => g.length > STROKES)) throw new Error('A Forge rune has more strokes than its slot holds.');

/** One draw for every rune: camera-facing stroke quads placed by per-slot uniforms. */
export function createRunes() {
  const quads = RUNE_SLOTS * STROKES, geometry = new THREE.BufferGeometry();
  const corner = new Float32Array(quads * 12), slot = new Float32Array(quads * 4), ends = new Float32Array(quads * 16);
  const index = new Uint16Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    corner.set([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], q * 12);
    index.set([0, 1, 2, 0, 2, 3].map(i => i + q * 4), q * 6);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(corner, 3));
  const slotAttribute = new THREE.BufferAttribute(slot, 1), endsAttribute = new THREE.BufferAttribute(ends, 4);
  geometry.setAttribute('aSlot', slotAttribute); geometry.setAttribute('aEnds', endsAttribute);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const place = Array.from({ length: RUNE_SLOTS }, () => new THREE.Vector4());
  const look = Array.from({ length: RUNE_SLOTS }, () => new THREE.Vector4());
  const material = new THREE.ShaderMaterial({
    name: 'forge-runes',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uPlace: { value: place }, uLook: { value: look }, uWidth: { value: .36 },
      uWarm: { value: new THREE.Color('#ffb04a') }, uCore: { value: new THREE.Color('#ffe2a6') }, uCool: { value: new THREE.Color('#8fd0f0') },
    },
    vertexShader: /* glsl */`
      attribute float aSlot; attribute vec4 aEnds;
      uniform vec4 uPlace[${RUNE_SLOTS}]; uniform vec4 uLook[${RUNE_SLOTS}]; uniform float uWidth;
      varying float vSide; varying float vAlpha; varying float vWarmth; varying float vFlare;
      void main(){
        int s=int(aSlot+.5);
        vec4 place=uPlace[s], look=uLook[s];
        if(aSlot<-.5||place.w<=.001){gl_Position=vec4(2.,2.,2.,1.);return;}
        vec2 a=aEnds.xy,b=aEnds.zw,d=b-a;float len=length(d);vec2 dir=len>1e-4?d/len:vec2(1.,0.),perp=vec2(-dir.y,dir.x);
        vec2 p=mix(a,b,position.x)+dir*(position.x*2.-1.)*uWidth+perp*position.y*uWidth;
        float c=cos(look.y),sn=sin(look.y);p=vec2(c*p.x-sn*p.y,sn*p.x+c*p.y);
        vec4 view=modelViewMatrix*vec4(place.xyz,1.);view.xy+=p*look.x;
        gl_Position=projectionMatrix*view;
        vSide=position.y;vAlpha=place.w;vWarmth=look.z;vFlare=look.w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uWarm,uCore,uCool;
      varying float vSide; varying float vAlpha; varying float vWarmth; varying float vFlare;
      void main(){
        float s=abs(vSide);
        float core=1.-smoothstep(.36,.5,s);
        float halo=(1.-s)*(1.-s)*.28;
        vec3 ink=mix(uCool,uWarm,vWarmth);
        // Gold strokes with a slightly paler heart; additive, so keep the values below white.
        vec3 colour=mix(ink*.85,uCore,(1.-smoothstep(0.,.3,s))*(.3+.5*vFlare));
        gl_FragColor=vec4(colour*(1.+.5*vFlare),(core*.95+halo)*vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'forge-runes'; mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.visible = false;

  /** Choose this ritual's runes. Runs once per ritual id, never per frame. */
  function setGlyphs(seed: number, count: number) {
    let s = seed;
    for (let r = 0; r < RUNE_SLOTS; r++) {
      s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
      const glyph = GLYPHS[(s + r * 7) % GLYPHS.length]!;
      for (let k = 0; k < STROKES; k++) {
        const q = r * STROKES + k, stroke = glyph[k], on = r < count && stroke !== undefined;
        for (let v = 0; v < 4; v++) { slot[q * 4 + v] = on ? r : -1; ends.set(stroke ?? [0, 0, 0, 0], (q * 4 + v) * 4); }
      }
    }
    slotAttribute.needsUpdate = true; endsAttribute.needsUpdate = true;
  }
  return { mesh, place, look, setGlyphs, dispose() { geometry.dispose(); material.dispose(); } };
}
