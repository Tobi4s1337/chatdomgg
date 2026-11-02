import * as THREE from 'three';

/**
 * Your own home, marked (Monarch.md §7.6): a thin thread of lantern light rising from your door, seen only by you,
 * strongest from across the town and gone as you reach the step. No solid, no collider, no shadow; it never moves
 * a thing in the world.
 */
const HEIGHT = 16, RADIUS = .34;
const VERTEX = /* glsl */ `
  varying float vHeight; varying vec3 vNormalView; varying vec3 vView;
  void main(){
    vHeight=position.y/${HEIGHT.toFixed(1)};
    vec4 view=modelViewMatrix*vec4(position,1.);
    vView=normalize(-view.xyz); vNormalView=normalize(normalMatrix*normal);
    gl_Position=projectionMatrix*view;
  }`;
const FRAGMENT = /* glsl */ `
  uniform float uStrength, uTime; uniform vec3 uColour;
  varying float vHeight; varying vec3 vNormalView; varying vec3 vView;
  void main(){
    // Soft at the rim, brightest at the door, thinning to nothing overhead; a slow lantern breath.
    float rim=pow(clamp(abs(dot(vNormalView,vView)),0.,1.),1.6);
    float rise=smoothstep(0.,.06,vHeight)*pow(1.-vHeight,2.2);
    float breath=.86+.14*sin(uTime*1.3-vHeight*5.);
    gl_FragColor=vec4(uColour*rim*rise*breath*uStrength,1.);
  }`;

/** How strongly the thread shows from `distance` metres away at the given night amount (0 day, 1 night). */
export function homeMarkStrength(distance: number, night: number): number {
  if (!Number.isFinite(distance)) return 0;
  const near = Math.max(0, Math.min(1, (distance - 5) / 9));
  return near * (.32 + .55 * Math.max(0, Math.min(1, night)));
}

export function createHomeMark(scene: THREE.Object3D) {
  const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS * .55, HEIGHT, 16, 1, true);
  geometry.translate(0, HEIGHT / 2, 0);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uStrength: { value: 0 }, uTime: { value: 0 }, uColour: { value: new THREE.Color('#ffc977').multiplyScalar(1.6) } },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'home-mark'; mesh.visible = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 2;
  scene.add(mesh);
  let shown = 0;
  return {
    mesh,
    /** `door` is the approach in front of your door on the ground; null takes the mark away. */
    update(door: readonly [number, number, number] | null, eye: THREE.Vector3, night: number, time: number, dt: number) {
      const target = door ? homeMarkStrength(Math.hypot(door[0] - eye.x, door[2] - eye.z), night) : 0;
      shown += (target - shown) * (1 - Math.exp(-Math.max(0, dt) * 2.2));
      if (door) mesh.position.set(door[0], door[1], door[2]);
      material.uniforms.uStrength!.value = shown; material.uniforms.uTime!.value = time;
      mesh.visible = shown > .01;
    },
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
