import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import codexSvg from './codex.svg?raw';

/** A cut into the iron facing of the hearth. The source paths are the unmodified publisher asset. */
export function createCodexEngraving(parent: THREE.Object3D): {
  root: THREE.Group;
  update(input: { time: number; heat: number; shaping: boolean }): void;
  origin: THREE.Vector3;
  dispose(): void;
} {
  const root = new THREE.Group();
  // CylinderGeometry's first vertex points along +Z: the actual flat face is 22.5° to its right.
  const faceAngle = Math.PI / 8;
  const faceRadius = 1.185 * Math.cos(faceAngle) + 0.020;
  root.position.set(Math.sin(faceAngle) * faceRadius, .55, Math.cos(faceAngle) * faceRadius);
  root.rotation.set(-Math.atan(.03 / .46), faceAngle, 0, 'YXZ');
  parent.add(root);

  const paths = new SVGLoader().parse(codexSvg).paths;
  const marks = paths.flatMap((path) => SVGLoader.createShapes(path));
  const plaque = new THREE.Shape();
  // Coordinates are in the original SVG's 24-unit space, with uniform scaling below.
  plaque.moveTo(-16.5, -3.75);
  plaque.lineTo(40.5, -3.75);
  plaque.lineTo(40.5, 27.75);
  plaque.lineTo(-16.5, 27.75);
  plaque.closePath();
  const islands: THREE.Shape[] = [];
  const contains = (shape:THREE.Shape, point:THREE.Vector2) => {
    const polygon=shape.getPoints(32);let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const a=polygon[i]!,b=polygon[j]!;
      if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    return inside;
  };
  // The cloud's counter is an island of iron. Cut the actual terminal paths into
  // that island as well; a solid counter would cover >_ despite faithful SVG paths.
  for(const mark of marks)for(const counter of mark.holes){
    const island=new THREE.Shape();island.curves=counter.curves.map(curve=>curve.clone());islands.push(island);
  }
  for(const mark of marks){
    const cut=new THREE.Path();cut.curves=mark.curves.map(curve=>curve.clone());
    const island=islands.find(candidate=>contains(candidate,mark.getPoints(12)[0]!));
    (island??plaque).holes.push(cut);
  }
  const depth = 1.25;
  const metalGeometry = new THREE.ExtrudeGeometry([plaque, ...islands], {
    depth, bevelEnabled: true, bevelThickness: .13, bevelSize: .13, bevelSegments: 2, curveSegments: 12,
  });
  metalGeometry.translate(-12, -12, -depth);
  const cutGeometry = new THREE.ShapeGeometry(marks, 12);
  cutGeometry.translate(-12, -12, -depth + .05);
  const uniforms = { uHeat: { value: 0 }, uTime: { value: 0 }, uShaping: { value: 0 } };
  // These materials do not depend on scene lights: the surrounding voxel scene uses its own light shader.
  const vertexShader = `varying vec3 vNormal; varying vec3 vPos;
    void main() { vNormal = normalize(normalMatrix * normal); vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const metal = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: `
    uniform float uHeat; uniform float uTime; uniform float uShaping;
    varying vec3 vNormal; varying vec3 vPos;
    void main() {
      vec3 n = normalize(vNormal);
      float key = max(0.0, dot(n, normalize(vec3(-.45,.75,1.0))));
      float edge = pow(1.0 - abs(n.z), 2.0);
      float sweep = exp(-pow((vPos.x + vPos.y * .35 - sin(uTime * .85) * 14.0) * .18, 2.0)) * uShaping;
      vec3 iron = vec3(.008,.009,.010) + vec3(.018,.020,.022) * key + vec3(.025,.023,.021) * edge;
      iron += vec3(.19,.075,.023) * uHeat * edge * (.55 + sweep * .25);
      gl_FragColor = vec4(iron, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });
  const cut = new THREE.ShaderMaterial({ uniforms, vertexShader, side: THREE.DoubleSide, fragmentShader: `
    uniform float uHeat; uniform float uTime; uniform float uShaping;
    varying vec3 vPos;
    void main() {
      float sweep = exp(-pow((vPos.x + vPos.y * .35 - sin(uTime * .85) * 14.0) * .2, 2.0)) * uShaping;
      vec3 iron = vec3(.035,.039,.041) + vec3(.34,.105,.025) * uHeat * (.55 + .3 * sweep);
      gl_FragColor = vec4(iron, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });
  const scale = .32 / 24;
  const metalMesh = new THREE.Mesh(metalGeometry, metal);
  const cutMesh = new THREE.Mesh(cutGeometry, cut);
  // SVG Y grows down; the reflection keeps the publisher's mark upright.
  metalMesh.scale.set(scale, -scale, scale);
  cutMesh.scale.copy(metalMesh.scale);
  root.add(metalMesh, cutMesh);
  const origin = root.position.clone().add(new THREE.Vector3(0, 0, .025).applyQuaternion(root.quaternion));
  return {
    root, origin,
    update({ time, heat, shaping }) {
      uniforms.uTime.value = time;
      uniforms.uHeat.value = THREE.MathUtils.clamp(heat, 0, 1);
      uniforms.uShaping.value = shaping ? 1 : 0;
    },
    dispose() {
      parent.remove(root);
      metalGeometry.dispose(); cutGeometry.dispose(); metal.dispose(); cut.dispose();
    },
  };
}
