import * as THREE from 'three';

/**
 * The sky's own answer: a thin veil of night drawn over the painted sky (and only the sky, plus the farthest
 * hills), so before a great cheer the dusk deepens toward night like a theatre dimming, and the aurora's colour
 * spills into the sky low over the hills it hangs behind. It is a back-faced sphere kept centred on the camera,
 * smaller than the far plane, depth-tested so everything nearer than its radius stands in front of it, and drawn
 * before the other transparent things so the beacon beam, the aurora and the shells stay at full light.
 *
 * Premultiplied: colour = night × darkness + glow, so one draw both dims what is behind it and adds the glow.
 */

const RADIUS = 1500;

const vertexShader = /* glsl */ `
  out vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  in vec3 vDirection;
  out vec4 fragColor;
  uniform float uDark, uGlow;
  uniform vec3 uNight, uGlowColour, uGlowToward;
  void main() {
    vec3 d = normalize(vDirection);
    float up = max(d.y, 0.0);
    // Deepest overhead; the band at the horizon keeps most of its dusk rose, so the sky reads as drawn down from above.
    float dark = uDark * mix(0.38, 1.0, smoothstep(0.02, 0.5, up));
    vec2 level = normalize(d.xz + vec2(1e-5));
    float toward = max(dot(level, normalize(uGlowToward.xz + vec2(1e-5))), 0.0);
    // The glow sits low in the aurora's quarter of the sky and fades upward and to the sides.
    float glow = uGlow * pow(toward, 4.0) * exp(-max(up - 0.04, 0.0) * 6.0) * smoothstep(-0.03, 0.06, d.y);
    fragColor = vec4(uNight * dark + uGlowColour * glow, dark);
  }
`;

export interface SkyVeilFrame {
  /** 0..1: how far the sky has deepened toward night. */
  readonly dark: number;
  /** The aurora's colour low in the sky, and how strong (0..1); the horizontal direction it lies in. */
  readonly glow: number;
  readonly glowColour: readonly [number, number, number];
  readonly glowToward: readonly [number, number];
}

export function createSkyVeil(group: THREE.Group) {
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.BackSide, transparent: true, premultipliedAlpha: true,
    blending: THREE.NormalBlending, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
    uniforms: { uDark: { value: 0 }, uGlow: { value: 0 }, uNight: { value: new THREE.Color('#060b1f') }, uGlowColour: { value: new THREE.Color() },
      uGlowToward: { value: new THREE.Vector3(0, 0, -1) } },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 48, 24), material);
  mesh.name = 'sky-veil';
  mesh.frustumCulled = false;
  mesh.visible = false;
  // First among the transparent things: the beam, the aurora and the shells all draw over it.
  mesh.renderOrder = -10;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    // Follow the eye (in the parent's space) so the veil is always the same distance away in every direction.
    const eye = camera.getWorldPosition(new THREE.Vector3());
    mesh.parent?.worldToLocal(eye);
    if (!mesh.position.equals(eye)) { mesh.position.copy(eye); mesh.updateMatrixWorld(); }
  };
  group.add(mesh);
  return {
    apply(frame: SkyVeilFrame | null): void {
      const on = !!frame && (frame.dark > 0.002 || frame.glow > 0.002);
      mesh.visible = on;
      if (!on) return;
      const u = material.uniforms;
      u.uDark!.value = Math.min(0.8, Math.max(0, frame.dark));
      u.uGlow!.value = Math.min(1, Math.max(0, frame.glow));
      (u.uGlowColour!.value as THREE.Color).setRGB(...frame.glowColour);
      (u.uGlowToward!.value as THREE.Vector3).set(frame.glowToward[0], 0, frame.glowToward[1]);
    },
    stats: () => ({ veil: mesh.visible ? 1 : 0, darkness: mesh.visible ? Number(material.uniforms.uDark!.value) : 0 }),
    dispose(): void { group.remove(mesh); mesh.geometry.dispose(); material.dispose(); },
  };
}
