import * as THREE from 'three';

/** A temporary material for the arriving piece. The realm keeps ownership of its lighting uniforms. */
export function createLandingMaterial(source: THREE.ShaderMaterial) {
  const material = source.clone();
  const warmth = { value: 0 };
  // Share uniform objects, not just their current values: light volumes can be replaced as the realm updates.
  material.uniforms = { ...source.uniforms, uLandingWarmth: warmth };
  material.onBeforeRender = source.onBeforeRender;
  const fogStage = '      float distanceToCamera=length(cameraPosition-vWorld);';
  if (!material.fragmentShader.includes(fogStage)) {
    material.dispose();
    throw new Error('Landing light requires the voxel material fog stage');
  }
  material.fragmentShader = material.fragmentShader
    .replace('    uniform float uGlassKind,uGlassDither;', '    uniform float uGlassKind,uGlassDither;\n    uniform float uLandingWarmth;')
    .replace(fogStage, `      // A little hearth light lifts the dark faces; the grazing edge catches a warmer glint.
      vec3 landingEye=normalize(cameraPosition-vWorld);
      float landingRim=pow(1.-abs(dot(n,landingEye)),2.5);
      float landingUnder=.35+.65*max(-n.y,0.);
      colour+=uLandingWarmth*(base*vec3(.34,.18,.08)*landingUnder+vec3(.20,.075,.025)*landingRim);
${fogStage}`);
  return {
    material,
    setWarmth(value: number) { warmth.value = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0; },
    dispose() { material.dispose(); },
  };
}
