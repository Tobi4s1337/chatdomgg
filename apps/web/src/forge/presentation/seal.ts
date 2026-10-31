import * as THREE from 'three';

/** The two seal lines. Only an externally judged live seal may say the first. */
export const SEAL_TEXT = { live: 'Fit for the realm', simulated: 'Fit for this home · SIMULATED' } as const;

/** Seal layout in metres, facing the viewer: a wax medallion over a parchment ribbon with forked tails. */
const R = .46, RIBBON = { y: -.56, half: .17, width: 1.2, notch: .15, text: 1.0 };

/** Both lines are lettered once at construction; nothing is drawn to a canvas per frame. */
function letter(): THREE.Texture {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const context = canvas?.getContext('2d');
  if (!canvas || !context) {
    // Without a document (tests, workers) the ribbon is plain; the stage and its timing are unchanged.
    const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true; return blank;
  }
  canvas.width = 1024; canvas.height = 256;
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#3a2216';
  context.font = '600 84px Georgia, "Times New Roman", serif';
  context.fillText(SEAL_TEXT.live, 512, 68, 990);
  context.font = '600 80px Georgia, "Times New Roman", serif';
  context.fillText(SEAL_TEXT.simulated, 512, 196, 990);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

export interface SealState {
  visible: boolean;
  /** World anchor: the part's centre on the anvil. */
  place: THREE.Vector3;
  /** View-space distance from the anchor to the seal (right of the part; below it in portrait). */
  side: number; below: number;
  alpha: number; stamp: number; emboss: number; hot: number; ribbon: number; live: boolean;
}

/**
 * A wax seal pressed with the Forge's anvil mark, on a ribbon that names what was judged. One view-aligned
 * quad: the medallion is shaded procedurally from a height field so it reads as pressed wax at any distance.
 */
export function createSeal() {
  const text = letter();
  const geometry = new THREE.BufferGeometry();
  const x0 = -RIBBON.width - .02, x1 = RIBBON.width + .02, y0 = RIBBON.y - RIBBON.half - .08, y1 = R * 1.75;
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.ShaderMaterial({
    name: 'forge-seal', transparent: true, depthWrite: false, depthTest: false,
    uniforms: {
      uPlace: { value: new THREE.Vector3() }, uSide: { value: 1 }, uBelow: { value: 1 },
      uAlpha: { value: 0 }, uStamp: { value: 1 }, uEmboss: { value: 0 }, uHot: { value: 0 }, uRibbon: { value: 0 }, uLive: { value: 0 },
      uText: { value: text },
      uWax: { value: new THREE.Color('#9b2226') }, uWaxDeep: { value: new THREE.Color('#5a1015') }, uWaxHot: { value: new THREE.Color('#ff6a3a') },
      uParchment: { value: new THREE.Color('#e8d3a2') }, uParchmentEdge: { value: new THREE.Color('#b8955d') }, uBrass: { value: new THREE.Color('#9a6a3a') },
    },
    vertexShader: /* glsl */`
      uniform vec3 uPlace;uniform float uSide,uBelow;
      varying vec2 vLocal;
      void main(){
        // Beside the part in landscape; below it, a little larger, on a phone held upright.
        float aspect=projectionMatrix[1][1]/projectionMatrix[0][0];
        bool portrait=aspect<.8;
        vec4 view=modelViewMatrix*vec4(uPlace,1.);
        float grow=portrait?1.22:1.;
        view.xy+=(portrait?vec2(0.,-uBelow):vec2(uSide,0.))+position.xy*grow;
        vLocal=position.xy;
        gl_Position=projectionMatrix*view;
      }`,
    fragmentShader: /* glsl */`
      uniform float uAlpha,uStamp,uEmboss,uHot,uRibbon,uLive;uniform sampler2D uText;
      uniform vec3 uWax,uWaxDeep,uWaxHot,uParchment,uParchmentEdge,uBrass;
      varying vec2 vLocal;
      float box(vec2 p,vec2 c,vec2 h){vec2 d=abs(p-c)-h;return length(max(d,0.))+min(max(d.x,d.y),0.);}
      /** The Forge's mark: an anvil with a spark above it. */
      float mark(vec2 p){
        float d=box(p,vec2(.05,.22),vec2(.56,.1));
        d=min(d,box(p,vec2(-.62,.27),vec2(.2,.05)));
        d=min(d,box(p,vec2(.05,-.02),vec2(.2,.16)));
        d=min(d,box(p,vec2(.05,-.3),vec2(.44,.09)));
        d=min(d,abs(p.x-.05)+abs(p.y-.66)-.15);
        return 1.-smoothstep(-.03,.03,d);
      }
      float rim(float a){return 1.+.05*sin(a*7.+1.3)+.03*sin(a*13.+.4)+.02*sin(a*3.);}
      float wax(vec2 q){
        float r=length(q),e=rim(atan(q.y,q.x));
        float t=r/e;
        float h=.34*sqrt(max(0.,1.-t*t*t*t));
        h+=.1*smoothstep(.64,.7,t)*(1.-smoothstep(.79,.86,t));
        return h-.22*uEmboss*mark(q/.58);
      }
      void main(){
        vec4 colour=vec4(0.);
        // Ribbon: parchment with forked tails, unrolled from the middle.
        vec2 rp=vLocal-vec2(0.,${RIBBON.y.toFixed(3)}+.022*sin(vLocal.x*2.4));
        float across=abs(rp.y)/${RIBBON.half.toFixed(3)};
        float reach=${RIBBON.width.toFixed(3)}-${RIBBON.notch.toFixed(3)}*(1.-across);
        if(across<1.&&abs(rp.x)<reach&&abs(rp.x)<uRibbon*${RIBBON.width.toFixed(3)}){
          vec3 paper=mix(uParchment,uParchmentEdge,smoothstep(.55,1.,across)*.55+smoothstep(.55,1.,abs(rp.x)/${RIBBON.width.toFixed(3)})*.35);
          float rule=1.-smoothstep(.0,.04,abs(across-.8));
          paper=mix(paper,uBrass*.8,rule*.6);
          vec2 uv=vec2(rp.x/${(RIBBON.text * 2).toFixed(3)}+.5,rp.y/(${RIBBON.half.toFixed(3)}*1.75)+.5);
          if(uv.x>0.&&uv.x<1.&&uv.y>0.&&uv.y<1.){vec4 ink=texture2D(uText,vec2(uv.x,uLive>.5?.5+uv.y*.5:uv.y*.5));paper=mix(paper,ink.rgb,ink.a);}
          // The medallion sits on the ribbon and shades it.
          float shade=1.-.35*(1.-smoothstep(.9,1.25,length(vLocal-vec2(.03,-.04))/(${R}*uStamp)))*step(.001,uStamp);
          colour=vec4(paper*shade,1.);
        }
        if(uStamp>.001){
          vec2 q=vLocal/(${R}*uStamp);
          float r=length(q),e=rim(atan(q.y,q.x));
          if(r<e){
            float h=wax(q),eps=.015;
            vec3 n=normalize(vec3(-(wax(q+vec2(eps,0.))-h)/eps,-(wax(q+vec2(0.,eps))-h)/eps,1.));
            vec3 light=normalize(vec3(-.45,.65,.62));
            float diffuse=max(dot(n,light),0.),spec=pow(max(dot(reflect(-light,n),vec3(0.,0.,1.)),0.),18.);
            vec3 c=mix(uWaxDeep,uWax,.35+.75*diffuse)+vec3(1.,.82,.72)*spec*.32;
            c*=1.-.35*smoothstep(.86,1.,r/e);
            c=mix(c,uWaxHot,uHot*(.6+.4*diffuse));
            float edge=1.-smoothstep(e-.04,e,r);
            colour=vec4(mix(colour.rgb,c,edge),max(colour.a,edge));
          }
        }
        if(colour.a<=.001)discard;
        gl_FragColor=vec4(colour.rgb,colour.a*uAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'forge-seal'; mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.visible = false;
  const u = material.uniforms;
  return {
    mesh,
    set(state: SealState) {
      mesh.visible = state.visible && state.alpha > .002;
      (u.uPlace!.value as THREE.Vector3).copy(state.place);
      u.uSide!.value = state.side; u.uBelow!.value = state.below;
      u.uAlpha!.value = state.alpha; u.uStamp!.value = state.stamp; u.uEmboss!.value = state.emboss;
      u.uHot!.value = state.hot; u.uRibbon!.value = state.ribbon; u.uLive!.value = state.live ? 1 : 0;
    },
    dispose() { geometry.dispose(); material.dispose(); text.dispose(); },
  };
}

/** A small, local highlight: a soft core and one expanding ring. Never a fullscreen flash. */
export function createFlash() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.ShaderMaterial({
    name: 'forge-flash', transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uPlace: { value: new THREE.Vector3() }, uSize: { value: 1 }, uCore: { value: 0 }, uRing: { value: 0 }, uRingAlpha: { value: 0 }, uColour: { value: new THREE.Color('#ffe7b8') } },
    vertexShader: /* glsl */`
      uniform vec3 uPlace;uniform float uSize;varying vec2 vUv;
      void main(){vec4 view=modelViewMatrix*vec4(uPlace,1.);view.xy+=position.xy*uSize;vUv=position.xy;gl_Position=projectionMatrix*view;}`,
    fragmentShader: /* glsl */`
      uniform float uCore,uRing,uRingAlpha;uniform vec3 uColour;varying vec2 vUv;
      void main(){
        float r=length(vUv);
        // A soft warm core and a broad, faint shock ring: light on the metal, not a drawn circle.
        float core=exp(-r*r*9.)*uCore,ring=exp(-pow((r-uRing)/.11,2.))*uRingAlpha*.55*(1.-smoothstep(.7,1.,r));
        float a=min(1.,core+ring);
        if(a<=.002)discard;
        gl_FragColor=vec4(uColour*a,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'forge-flash'; mesh.frustumCulled = false; mesh.renderOrder = 7; mesh.visible = false;
  const u = material.uniforms;
  return {
    mesh,
    set(visible: boolean, place: THREE.Vector3, size: number, core: number, ring: number, ringAlpha: number, colour: THREE.Color) {
      mesh.visible = visible && (core > .002 || ringAlpha > .002);
      (u.uPlace!.value as THREE.Vector3).copy(place); u.uSize!.value = size;
      u.uCore!.value = core; u.uRing!.value = ring; u.uRingAlpha!.value = ringAlpha; (u.uColour!.value as THREE.Color).copy(colour);
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
