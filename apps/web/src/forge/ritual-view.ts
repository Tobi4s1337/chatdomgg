import * as THREE from 'three';
import type { VoxelRenderState } from '@chatdom/render';
import type { ForgeRitualFrame } from '@chatdom/shared';
import { createCodexEngraving } from './engraving';

/** The stage owns its decorative resources; the voxel geometry and lighting textures remain with their callers. */
export function createForgeRitualView(scene: THREE.Scene, material: VoxelRenderState) {
  const root = new THREE.Group();
  scene.add(root);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const ownGeometry = <T extends THREE.BufferGeometry>(g: T): T => {
    // A fixed, warm studio light is baked into decorative geometry so the
    // stage reads consistently with the kingdom's custom-lit voxel shader.
    const normals = g.getAttribute('normal');
    if (normals) {
      const colors = new Float32Array(normals.count * 3);
      for (let i = 0; i < normals.count; i++) {
        const shade = .68 + .26 * Math.max(0, normals.getY(i)) + .06 * Math.max(0, normals.getX(i));
        colors.set([shade, shade * .98, shade * .95], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geometries.add(g); return g;
  };
  const ownMaterial = <T extends THREE.Material>(m: T): T => { materials.add(m); return m; };
  const stone = ownMaterial(new THREE.MeshBasicMaterial({ color: 0x393b3d, vertexColors: true }));
  const stoneEdge = ownMaterial(new THREE.MeshBasicMaterial({ color: 0x59534a, vertexColors: true }));
  const iron = ownMaterial(new THREE.MeshBasicMaterial({ color: 0x272c30, vertexColors: true }));
  const ironEdge = ownMaterial(new THREE.MeshBasicMaterial({ color: 0x62666a, vertexColors: true }));
  const brass = ownMaterial(new THREE.MeshBasicMaterial({ color: 0xad8045, vertexColors: true }));
  const glow = ownMaterial(new THREE.MeshBasicMaterial({ color: 0xe6b66a, transparent: true, opacity: .68 }));
  const cyan = ownMaterial(new THREE.LineBasicMaterial({ color: 0x8dd6cf, transparent: true, opacity: .65, depthWrite: false }));
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(ownGeometry(new THREE.BoxGeometry(w, h, d)), mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const cylinder = (r1: number, r2: number, h: number, y: number, mat: THREE.Material, segments = 8) => {
    const mesh = new THREE.Mesh(ownGeometry(new THREE.CylinderGeometry(r1, r2, h, segments)), mat); mesh.position.y = y; root.add(mesh); return mesh;
  };
  cylinder(1.4, 1.5, .2, .1, stone);
  cylinder(1.23, 1.35, .12, .26, stoneEdge);
  cylinder(1.17, 1.2, .46, .55, stone);
  cylinder(1.24, 1.17, .12, .84, stoneEdge);
  cylinder(1.24, 1.24, .035, .91, brass);
  const engraving = createCodexEngraving(root);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const stud = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(.045, 8, 6)), brass);
    stud.position.set(Math.cos(a) * 1.12, .945, Math.sin(a) * 1.12); root.add(stud);
  }
  box(.72, .18, .58, iron, 0, 1.02, 0);
  box(.54, .3, .47, iron, 0, 1.22, 0);
  box(1.28, .13, .64, ironEdge, 0, 1.35, 0);
  box(1.14, .035, .58, iron, 0, 1.43, 0);
  const horn = new THREE.Mesh(ownGeometry(new THREE.ConeGeometry(.3, .68, 4)), iron);
  horn.rotation.z = -Math.PI / 2; horn.rotation.y = Math.PI / 4; horn.position.set(.95, 1.34, 0); root.add(horn);
  // Fine rings and ticks make the forge feel inscribed rather than electrically lit.
  const rings = new THREE.Group(); root.add(rings);
  for (const radius of [1.53, 1.7]) {
    const line = new THREE.LineLoop(ownGeometry(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => {
      const a = i * Math.PI * 2 / 96; return new THREE.Vector3(Math.cos(a) * radius, .025, Math.sin(a) * radius);
    }))), ownMaterial(new THREE.LineBasicMaterial({ color: 0xbd8f51, transparent: true, opacity: .65 })));
    rings.add(line);
  }
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12, tick = box(.025, .012, i % 3 === 0 ? .15 : .07, glow, Math.cos(a) * 1.62, .03, Math.sin(a) * 1.62, rings);
    tick.rotation.y = -a + Math.PI / 2;
  }
  const hammer = new THREE.Group(); hammer.position.set(-.7, 2.3, 0); root.add(hammer);
  box(.1, 1.05, .1, brass, .35, -.38, 0, hammer).rotation.z = .65;
  const head = box(.56, .27, .31, ironEdge, .7, -.78, 0, hammer); head.rotation.z = .65;
  box(.2, .30, .33, iron, .7, -.78, 0, hammer).rotation.z = .65;
  const source = material.material;
  const ritualMaterial = new THREE.ShaderMaterial({
    glslVersion: source.glslVersion, uniforms: { ...source.uniforms, uForgeReveal: { value: -1 }, uForgeHeat: { value: 0 } },
    vertexShader: source.vertexShader.replace('out float vLodFade;', 'out float vLodFade; out float vForgeLocalY;').replace('uint face=(aPacked>>18u)&7u;', 'vForgeLocalY=p.y*uScale; uint face=(aPacked>>18u)&7u;'),
    fragmentShader: source.fragmentShader.replace('out vec4 voxelColour;', 'out vec4 voxelColour; in float vForgeLocalY; uniform float uForgeReveal; uniform float uForgeHeat;').replace('void main(){\n      float threshold', 'void main(){\n      if(vForgeLocalY>uForgeReveal) discard;\n      float threshold').replace('gl_FragColor=vec4(colour,1.);', 'colour=mix(colour,vec3(3.1,.78,.08),uForgeHeat*.8);\n      gl_FragColor=vec4(colour,1.);'),
  });
  materials.add(ritualMaterial);
  const empty = ownGeometry(new THREE.BufferGeometry());
  const piece = new THREE.Mesh(empty, ritualMaterial); piece.frustumCulled = false; root.add(piece); piece.visible = false;
  const blueprint = new THREE.Group(); root.add(blueprint);
  const wordsGroup = new THREE.Group(); root.add(wordsGroup);
  let pieceBounds = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  const makeText = (text: string, color: string) => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (ctx) { ctx.font = '600 32px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, 256, 48, 490); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const sprite = new THREE.Sprite(ownMaterial(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })));
    sprite.scale.set(2.8, .65, 1); return sprite;
  };
  const stamp = makeText('FIT FOR THIS HOME · SIMULATED', '#f4d399'); stamp.position.set(0, 2.1, 0); stamp.scale.set(2.6, .48, 1); root.add(stamp);
  function beginWords(){
    wordsGroup.children.forEach(child=>{const m=(child as THREE.Sprite).material;if(m.map){m.map.dispose();textures.delete(m.map);}m.dispose();materials.delete(m);});wordsGroup.clear();
    // Authored runes never encode an unjudged request's words, length or identity.
    const clusters=['ᚠᚨᛃ','ᚱᛉᚷ','ᛗᛚᚲ','ᚢᛈᛇ','ᛟᛒᚹ','ᚺᛋᚦ','ᚲᚾᛖ','ᛃᚷᛏ'];
    clusters.forEach((glyphs,i)=>{const sprite=makeText(glyphs,'#e9c78e');sprite.userData.angle=i*Math.PI*2/clusters.length;wordsGroup.add(sprite);});
  }
  function setPiece(geometry: THREE.BufferGeometry, bounds: THREE.Box3) {
    piece.geometry = geometry; pieceBounds = bounds.clone();
    piece.rotation.set(0, 0, 0); piece.scale.set(1, 1, 1);
    const center = bounds.getCenter(new THREE.Vector3());
    piece.position.set(-center.x, 1.6 - bounds.min.y, -center.z);
    for (const child of blueprint.children) {
      const line = child as THREE.LineSegments; line.geometry.dispose(); geometries.delete(line.geometry);
    }
    blueprint.clear();
    // Decode the production packed vertices into a temporary mesh solely for its
    // silhouette. EdgesGeometry removes coplanar triangle diagonals by position.
    const packed = geometry.getAttribute('aPacked');
    const detail = geometry.getAttribute('aMaterial');
    if (packed && detail && geometry.index) {
      const positions = new Float32Array(packed.count * 3);
      const scale = Number(source.uniforms.uScale!.value);
      for (let i = 0; i < packed.count; i++) {
        const p = packed.getX(i) >>> 0, m = detail.getX(i) >>> 0;
        positions[i * 3] = ((p & 63) + 32 * ((m >>> 16) & 31)) * scale + piece.position.x;
        positions[i * 3 + 1] = (((p >>> 6) & 63) + 32 * ((m >>> 21) & 31)) * scale + piece.position.y;
        positions[i * 3 + 2] = (((p >>> 12) & 63) + 32 * ((m >>> 26) & 31)) * scale + piece.position.z;
      }
      const decoded = new THREE.BufferGeometry();
      decoded.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      decoded.setIndex(geometry.index.clone());
      const edges = ownGeometry(new THREE.EdgesGeometry(decoded, 1)); decoded.dispose();
      blueprint.add(new THREE.LineSegments(edges, cyan));
    }
    beginWords();
  }
  function update(frame: ForgeRitualFrame | null, shaping = false) {
    const orbitTime=frame?.elapsed??0;
    const t = frame?.phase==='words'?Math.min(2.99,orbitTime):orbitTime;
    const active = frame !== null;
    const heat = !active ? 0 : shaping || t >= 3 && t < 12.7 ? 1 : t < 3 ? .2 : Math.max(0, 1 - (t - 12.7) / 2.8);
    engraving.update({time:orbitTime, heat, shaping});
    rings.visible = active; hammer.visible = active && t >= 11 && t < 13.3;
    const strikeTime=THREE.MathUtils.clamp((t-12.2)/.5,0,1);
    hammer.rotation.z=t<12.2?.8:strikeTime<.28?THREE.MathUtils.lerp(.8,-.35,strikeTime/.28):THREE.MathUtils.lerp(-.35,.15,(strikeTime-.28)/.72);
    blueprint.visible = active && t >= 3 && t < 11;
    cyan.opacity = t < 5 ? .25 + .4 * Math.min(1, (t - 3) / 2) : .6 * (1 - (t - 5) / 6);
    wordsGroup.visible = active && t < 5;
    wordsGroup.children.forEach((child, i) => {
      const a = child.userData.angle + orbitTime * .32;
      const lift = THREE.MathUtils.smootherstep(orbitTime - i * .08, 0, 1.4);
      child.position.copy(engraving.origin).lerp(new THREE.Vector3(Math.cos(a) * 1.9, 2 + Math.sin(a * 2 + orbitTime) * .18, Math.sin(a) * 1.9), lift);
      child.scale.set(2.8, .65, 1).multiplyScalar(.2 + .8 * lift);
    });
    stamp.visible = active && t >= 11 && t < 15.5 && frame.source === 'simulated';
    piece.visible = active && t >= 5;
    ritualMaterial.uniforms.uForgeReveal!.value = t < 5 ? -1 : t < 11 ? THREE.MathUtils.lerp(pieceBounds.min.y, pieceBounds.max.y + .01, (t - 5) / 6) : pieceBounds.max.y + 1;
    ritualMaterial.uniforms.uForgeHeat!.value = t < 5 ? 0 : t < 11 ? .55 : t < 12.7 ? 1 : Math.max(0, 1 - (t - 12.7) / 2.8);
  }
  function dispose() { engraving.dispose(); scene.remove(root); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); }
  update(null);
  return { root, piece, setPiece, beginWords, update, dispose };
}
