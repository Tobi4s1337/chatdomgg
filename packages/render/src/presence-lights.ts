import * as THREE from 'three';
import { VOXEL_METRES, type KingdomPresenceFrame, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { getEnvironment } from './atmosphere';

export type WindowHouse = { slot: number; blueprint: VoxelBlueprint; position: Vec3; yaw: number };
type WindowSource = { slot: number; position: Vec3; normal: Vec3; strength: number; name: string | null };
type SlotState = { value: number; target: number; name: string | null; initialized: boolean };
type LodFactor = 1 | 2 | 4;
type WindowPlacement = { house: WindowHouse; window: VoxelBlueprint['windows'][number]; normal: THREE.Vector3; rotation: THREE.Quaternion; width: number; height: number };

/** A halo is sized to its pane (spec 26 R3): it warms the frame, reveal and sill, never the wall as a blob. */
export const WINDOW_HALO_SCALE = 1.3;

/** Warm window light by hour: glass by day, rising through the afternoon and full from 18.5 h until dawn. */
export function windowGlowForHour(hour: number): number {
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 12;
  return THREE.MathUtils.smoothstep(Math.abs(h - 12), 4.2, 6.5);
}

/** Coarse voxel occupancy expands to cell boundaries along the outward face normal. */
export function windowLodCentre(centre: Vec3, facing: VoxelBlueprint['windows'][number]['facing'], factor: LodFactor): Vec3 {
  if (factor === 1) return [...centre];
  const result: [number, number, number] = [...centre];
  const axis = facing === 'east' || facing === 'west' ? 0 : 2;
  const outward = facing === 'east' || facing === 'south' ? Math.ceil : Math.floor;
  result[axis] = outward(result[axis] / factor) * factor;
  return result;
}

/** Windows are independent of the voxel mesh. A single texture carries presence for every plot. */
export function createWindowLights(scene: THREE.Scene, houses: readonly WindowHouse[], options: { allWindows?: boolean } = {}): {
  setFrame(frame: KingdomPresenceFrame): void;
  setHidden(slot:number,hidden:boolean):void;
  setLod(slot: number, factor: LodFactor): void;
  setDetail(slot: number, from: LodFactor, to: LodFactor, progress: number): void;
  update(elapsedSeconds: number, hour: number): void;
  getSources(): readonly WindowSource[];
  clear(): void;
  dispose(): void;
} {
  const maxSlot = houses.reduce((max, house) => Math.max(max, house.slot), 0);
  const width = Math.min(256, maxSlot + 1);
  const height = Math.ceil((maxSlot + 1) / width);
  const pixels = new Uint8Array(width * height * 4);
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const states = new Map<number, SlotState>();
  const hiddenSlots=new Set<number>();
  const sources: WindowSource[] = [];
  const slots: number[] = [];
  const transforms: THREE.Matrix4[] = [];
  const haloTransforms: THREE.Matrix4[] = [];
  const placements: WindowPlacement[] = [];
  const slotIndices = new Map<number, number[]>();
  const slotDetails = new Map<number, { from: LodFactor; to: LodFactor; progress: number }>();
  const namedSlots = new Set<number>();
  const direction = { north: Math.PI, east: Math.PI / 2, south: 0, west: -Math.PI / 2 } as const;
  for (const house of houses) {
    if (!Number.isInteger(house.slot) || house.slot < 0 || house.slot > 65534) throw new Error('Invalid window slot');
    if (!states.has(house.slot)) states.set(house.slot, { value: 0, target: 0, name: null, initialized: false });
    // The first authored window is the citizen's presence light; other anchors
    // remain available to content inspection without implying extra people.
    for (const window of options.allWindows ? house.blueprint.windows : house.blueprint.windows.slice(0, 1)) {
      const angle = direction[window.facing] + house.yaw;
      const normal = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      const local = new THREE.Vector3(...window.centre).multiplyScalar(VOXEL_METRES.build).applyAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw);
      // The authored centre is on the exterior glass face. A small offset avoids
      // coplanar depth fighting without visibly lifting the glass out of its frame.
      const centre = local.add(new THREE.Vector3(...house.position)).addScaledVector(normal, 0.006);
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      const w = window.width * VOXEL_METRES.build;
      const h = window.height * VOXEL_METRES.build;
      const index = placements.length;
      placements.push({ house, window, normal, rotation, width: w, height: h });
      const indices = slotIndices.get(house.slot) ?? [];
      indices.push(index);
      slotIndices.set(house.slot, indices);
      slotDetails.set(house.slot, { from: 1, to: 1, progress: 1 });
      const paneMatrix = new THREE.Matrix4().compose(centre, rotation, new THREE.Vector3(w, h, 1));
      const haloMatrix = new THREE.Matrix4().compose(centre.clone().addScaledVector(normal, 0.04), rotation, new THREE.Vector3(w * WINDOW_HALO_SCALE, h * WINDOW_HALO_SCALE, 1));
      transforms.push(paneMatrix, paneMatrix.clone());
      haloTransforms.push(haloMatrix, haloMatrix.clone());
      slots.push(house.slot, house.slot);
      const point = centre.clone().addScaledVector(normal, 0.4);
      sources.push({ slot: house.slot, position: [point.x, point.y, point.z], normal: [normal.x, normal.y, normal.z], strength: 0, name: null });
    }
  }
  const uniforms = { presence: { value: texture }, textureSize: { value: new THREE.Vector2(width, height) }, night: { value: 1 },
    skyZenith: { value: new THREE.Color() }, skyHorizon: { value: new THREE.Color() }, skyFog: { value: new THREE.Color() } };
  let gradedHour = Number.NaN;
  function grade(hour: number): void {
    // The hour eases continuously; regrade the reflected sky only when it has visibly moved.
    if (Math.abs(hour - gradedHour) < 0.02) return;
    gradedHour = hour;
    const environment = getEnvironment(hour);
    uniforms.skyZenith.value.set(environment.zenith); uniforms.skyHorizon.value.set(environment.horizon); uniforms.skyFog.value.set(environment.fog);
    uniforms.night.value = windowGlowForHour(hour);
  }
  grade(23);
  const vertexShader = `
    attribute float plotSlot;
    attribute float detailFade;
    varying vec2 vUv;
    varying float vSlot, vDetailFade;
    varying vec3 vWorld, vFacing;
    void main() {
      vUv = uv;
      vSlot = plotSlot;
      vDetailFade = detailFade;
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vFacing = normalize(mat3(modelMatrix * instanceMatrix) * vec3(0.0, 0.0, 1.0));
      gl_Position = projectionMatrix * viewMatrix * world;
    }`;
  const shared = `
    uniform sampler2D presence;
    uniform vec2 textureSize;
    uniform float night;
    uniform vec3 skyZenith, skyHorizon, skyFog;
    varying vec2 vUv;
    varying float vSlot, vDetailFade;
    varying vec3 vWorld, vFacing;
    void discardDetail() {
      float threshold = fract(dot(floor(gl_FragCoord.xy), vec2(.754877666, .569840296)));
      if (vDetailFade >= 0.0 && threshold >= vDetailFade) discard;
      if (vDetailFade < 0.0 && threshold < -vDetailFade - 1.0) discard;
    }
    float windowPresence() {
      // Interpolation can land just below an integer slot at a row boundary.
      // Snap the discrete instance ID before computing its texture coordinates.
      float slot = floor(vSlot + 0.5);
      vec2 cell = vec2(mod(slot, textureSize.x), floor(slot / textureSize.x));
      return texture2D(presence, (cell + 0.5) / textureSize).r;
    }`;
  const paneMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: `${shared}
    void main() {
      discardDetail();
      float presence = windowPresence();
      // Across the town a pane is a few pixels: it settles to its bright warm average so it still counts.
      float distant = smoothstep(0.04, 0.2, max(fwidth(vUv.x), fwidth(vUv.y)));
      vec2 p = abs(vUv - 0.5);
      float frame = max(step(0.455, p.x), step(0.455, p.y));
      float bars = max(1.0 - smoothstep(0.024, 0.036, p.x), 1.0 - smoothstep(0.022, 0.034, p.y));
      float wood = max(frame, bars) * (1.0 - distant * 0.7);
      // Glass reflects the sky it faces, the same reflection as every voxel pane: dark blue-grey at night,
      // pale sky by day, a little brighter towards the head of the pane. Never a black hole.
      vec3 view = normalize(vWorld - cameraPosition), mirror = reflect(view, normalize(vFacing));
      vec3 seen = mix(skyHorizon, skyZenith, smoothstep(0.0, 0.65, mirror.y));
      seen = mix(skyFog * 0.42, seen, smoothstep(-0.3, 0.04, mirror.y));
      float fresnel = 0.42 + 0.5 * pow(1.0 - abs(dot(view, normalize(vFacing))), 3.0);
      vec3 reflection = seen * mix(0.62, 0.42, night) * fresnel * (0.78 + 0.34 * vUv.y);
      float sheen = 1.0 - smoothstep(0.0, 0.07, abs(vUv.x * 0.9 + vUv.y * 0.55 - 0.86));
      reflection += seen * sheen * 0.16;
      // A lamp-lit room: brightest low and centred, warming through amber to the edges of the glass.
      vec2 c = (vUv - vec2(0.5, 0.34)) * vec2(1.3, 1.0);
      float core = exp(-dot(c, c) * 5.2);
      vec3 room = mix(vec3(0.62, 0.17, 0.03), vec3(1.0, 0.52, 0.14), smoothstep(0.02, 0.5, core));
      room = mix(room, vec3(1.0, 0.80, 0.50), smoothstep(0.5, 1.0, core));
      // By day the glass stays glass, with only a hint of the room behind it.
      float lit = presence * mix(0.07, 1.0, night);
      // Tiny distant panes retain amber chroma instead of averaging into pale stone.
      room = mix(room, vec3(1.15, 0.38, 0.055) * 1.35, distant);
      // A lit lamp is a source of light, not just a pale pigment. Keep the core above
      // display white in linear space so it survives pane transparency and feeds HDR bloom.
      // The distant average already carries extra energy; temper the core there.
      room *= 1.0 + 4.8 * night * core * (1.0 - 0.6 * distant);
      vec3 glass = mix(reflection, room * mix(0.9, 1.25, night), lit);
      // Mullions and frame stay dark; their inner edges catch the room's light.
      float catchLight = frame * (1.0 - smoothstep(0.455, 0.49, max(p.x, p.y))) * lit;
      vec3 timber = mix(vec3(0.2, 0.13, 0.09), vec3(0.07, 0.04, 0.035), night) + vec3(0.36, 0.13, 0.03) * catchLight;
      // The real voxel glass remains visible through this presentation layer.
      float street = gl_FrontFacing ? 1.0 : 0.18;
      float glassAlpha = mix(0.1, mix(0.2, 0.68, night), presence) * street;
      gl_FragColor = vec4(mix(glass, timber, wood), mix(glassAlpha, 1.0, wood));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const haloMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: `${shared}
    void main() {
      discardDetail();
      // In pane units the glass spans +-0.5; the quad reaches the halo scale's edge.
      vec2 q = (vUv - 0.5) * ${WINDOW_HALO_SCALE.toFixed(3)};
      vec2 outside = max(abs(q) - 0.5, 0.0);
      float distance = length(outside);
      float edge = 1.0 - smoothstep(0.5 * ${WINDOW_HALO_SCALE.toFixed(3)} - 0.07, 0.5 * ${WINDOW_HALO_SCALE.toFixed(3)}, max(abs(q.x), abs(q.y)));
      // A thin warm spill on the reveal, heavier on the sill below, leaving the glass itself untouched.
      float sill = step(q.y, -0.5) * (1.0 - smoothstep(0.18, 0.5, abs(q.x)));
      float glow = exp(-distance * 26.0) * smoothstep(0.0, 0.012, distance) * (1.0 + 1.3 * sill) * edge;
      gl_FragColor = vec4(1.0, 0.46, 0.13, glow * windowPresence() * night * 0.42);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  function makeMesh(material: THREE.ShaderMaterial, matrices: readonly THREE.Matrix4[]): THREE.InstancedMesh {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('plotSlot', new THREE.InstancedBufferAttribute(new Float32Array(slots), 1));
    const fades = new Float32Array(slots.length);
    for (let i = 0; i < fades.length; i += 2) fades[i] = 1;
    geometry.setAttribute('detailFade', new THREE.InstancedBufferAttribute(fades, 1));
    const mesh = new THREE.InstancedMesh(geometry, material, slots.length);
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }
  const panes = makeMesh(paneMaterial, transforms);
  const halos = makeMesh(haloMaterial, haloTransforms);
  // Both layers are translucent: the pane first, then the halo around it.
  panes.renderOrder = 1; halos.renderOrder = 2;
  function setDetail(slot: number, from: LodFactor, to: LodFactor, progress: number): void {
    const indices = slotIndices.get(slot);
    if (!indices) return;
    const amount = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
    const previous = slotDetails.get(slot)!;
    if (previous.from === from && previous.to === to && previous.progress === amount) return;
    const matricesChanged = previous.from !== from || previous.to !== to;
    slotDetails.set(slot, { from, to, progress: amount });
    const paneFade = panes.geometry.getAttribute('detailFade') as THREE.InstancedBufferAttribute;
    const haloFade = halos.geometry.getAttribute('detailFade') as THREE.InstancedBufferAttribute;
    for (const index of indices) {
      const placement = placements[index]!;
      if (matricesChanged) for (const [layer, factor] of [from, to].entries()) {
        const centre = new THREE.Vector3(...windowLodCentre(placement.window.centre, placement.window.facing, factor))
          .multiplyScalar(VOXEL_METRES.build)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), placement.house.yaw)
          .add(new THREE.Vector3(...placement.house.position))
          .addScaledVector(placement.normal, 0.006);
        panes.setMatrixAt(index * 2 + layer, new THREE.Matrix4().compose(centre, placement.rotation, new THREE.Vector3(placement.width, placement.height, 1)));
        halos.setMatrixAt(index * 2 + layer, new THREE.Matrix4().compose(centre.clone().addScaledVector(placement.normal, 0.04), placement.rotation, new THREE.Vector3(placement.width * WINDOW_HALO_SCALE, placement.height * WINDOW_HALO_SCALE, 1)));
      }
      // Complementary masks use the same screen threshold as the voxel meshes.
      const outgoing = hiddenSlots.has(slot)?0:from === to ? 1 : -1 - amount;
      const incoming = hiddenSlots.has(slot)?0:from === to ? 0 : amount;
      paneFade.setX(index * 2, outgoing); paneFade.setX(index * 2 + 1, incoming);
      haloFade.setX(index * 2, outgoing); haloFade.setX(index * 2 + 1, incoming);
    }
    if (matricesChanged) { panes.instanceMatrix.needsUpdate = true; halos.instanceMatrix.needsUpdate = true; }
    paneFade.needsUpdate = true; haloFade.needsUpdate = true;
  }
  function sync(): void {
    for (const [slot, state] of states) pixels[slot * 4] = Math.round(state.value * 255);
    texture.needsUpdate = true;
    namedSlots.clear();
    for (const source of sources) {
      const state = states.get(source.slot)!;
      source.strength = hiddenSlots.has(source.slot)?0:state.value;
      source.name = !namedSlots.has(source.slot) && state.value > 0 ? state.name : null;
      namedSlots.add(source.slot);
    }
  }
  return {
    setLod(slot, factor) {
      setDetail(slot, factor, factor, 1);
    },
    setDetail,
    setHidden(slot,hidden){
      if(hiddenSlots.has(slot)===hidden)return;
      if(hidden)hiddenSlots.add(slot);else hiddenSlots.delete(slot);
      const detail=slotDetails.get(slot);if(detail){slotDetails.set(slot,{...detail,progress:-1});setDetail(slot,detail.from,detail.to,detail.progress);}sync();
    },
    setFrame(frame) {
      const incoming = new Map(frame.windows.map(window => [window.slot, window]));
      for (const [slot, state] of states) {
        const window = incoming.get(slot);
        // A witnessed chat act may light a home while its broadcast rests.
        // The castle's beacon follows stream state separately.
        const present = Boolean(frame.connection !== 'stale' && window?.present);
        const target = present ? 1 : 0;
        // A recovered snapshot may describe a transition already in progress or finished.
        const age = window ? Math.min(1, Math.max(0, (frame.asOf - window.since) / 700)) : 1;
        if (!state.initialized) {
          state.value = present ? age : 0;
          state.initialized = true;
        } else if (state.target !== target) {
          state.value = present ? Math.max(state.value, age) : Math.min(state.value, 1 - age);
        }
        state.target = target;
        state.name = present ? window?.publicName ?? null : null;
      }
      sync();
    },
    update(elapsedSeconds, hour) {
      const step = Math.max(0, elapsedSeconds) / 0.7;
      for (const state of states.values()) state.value += Math.max(-step, Math.min(step, state.target - state.value));
      grade(hour);
      sync();
    },
    getSources() { return sources; },
    clear() {
      for (const state of states.values()) { state.value = 0; state.target = 0; state.name = null; state.initialized = false; }
      sync();
    },
    dispose() {
      scene.remove(panes, halos);
      panes.geometry.dispose(); halos.geometry.dispose(); panes.dispose(); halos.dispose(); paneMaterial.dispose(); haloMaterial.dispose(); texture.dispose();
    },
  };
}
