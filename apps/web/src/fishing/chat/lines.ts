import '@chatdom/ui/kit.css';
import './chat.css';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks, getEnvironment, windowGlowForHour } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import type { FishingPierSite, PierFeedEvent, PierFeedLine, VoxelAsset } from '@chatdom/shared';
import { createFishModel, FISH_SPECIES } from '../../../../../packages/content/src/fish';
import { createPierFloat } from '../../../../../packages/content/src/pier/float';
import { paintItemPortrait } from '../../bag/portrait';
import { createDroplets, createFishShadows, createRings } from '../layer/effects';
import { createPierFeedState, type PierFeedBeat } from './feed';
import { CAST_S, LEAP_S, blankPose, floatDone, floatPose, leapPose, type FloatExit, type FloatMotion, type FloatPose, type Vec } from './motion';
import { brokenWords, cardSummary, catchWords, createCardStack, fullWords, CARD_ENTER_S, CARD_LEAVE_S, type ChatCardWords, type StackedCard } from './words';

/*
 * Chat's floats at the pier, drawn wherever the kingdom is watched: each `!fish` is a float off the end of the pier
 * with the chatter's own window light on it, glowing on the water, so a viewer can find "my light out there". Bites dip
 * it, fights drag it in zigzags over a dark shape, catches leap out in an arc, and a legend boils the water and takes
 * the float under. Cards in the overlay tell the stream what happened, in the kingdom's carved and inked hand.
 *
 * Costs: one draw for every float, one for every light (bead, water pool and reflection), and the pier's shared rings,
 * droplets and fish shadows; a leaping fish is one more draw while it is in the air.
 */

export interface ChatLinesHost {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** The pier's frame with `waterY` set to the drawn water under its head. */
  readonly site: FishingPierSite;
  /** A positioned container over the canvas; the floats' names and the cards are drawn into it. */
  readonly overlay: HTMLElement;
  viewport(): { readonly width: number; readonly height: number };
  readonly kingdomName: string | null;
  /** A phone or a narrow window: smaller cards, bottom-centred above the safe area. */
  readonly compact: boolean;
  /** The kingdom's hour, for the floats' and splashes' light. Dusk when left out. */
  hour?(): number;
  /** Paints a fish's picture into a card; the bag's own voxel portrait when left out. */
  portrait?(speciesId: string, canvas: HTMLCanvasElement, size: number): Promise<boolean>;
  /** Meshes a voxel model; the shared worker pool when left out. */
  mesh?(asset: VoxelAsset): Promise<THREE.BufferGeometry>;
}
export interface ChatLinesStats {
  readonly floats: number;
  readonly leaving: number;
  readonly leaps: number;
  readonly cards: number;
  readonly names: number;
  readonly draws: number;
  readonly triangles: number;
}
export interface ChatLines {
  apply(event: PierFeedEvent): void;
  /** Once per rendered frame, before the render. `timeSeconds` is any steady clock in seconds. */
  update(timeSeconds: number): void;
  stats(): ChatLinesStats;
  dispose(): void;
}

const CELL = .0625;
/** Chat's floats are read from across a stream: drawn larger than a walker's float in the hand. */
const FLOAT_SCALE = 2;
/** Eight lines (the realm's cap) plus a few still leaving the water. */
const SLOTS = 12, LEAPS = 3, SHADOWS = SLOTS + 2;
const GLOW_KINDS = 3;
const SPECIES = new Map(FISH_SPECIES.map(fish => [fish.id, fish]));
const SVG = 'http://www.w3.org/2000/svg';

interface Slot {
  used: boolean;
  id: string;
  line: PierFeedLine | null;
  motion: FloatMotion;
  colour: [number, number, number];
  pose: FloatPose;
  nibble: number; ring: number; drop: number;
  label: HTMLElement | null; labelText: string; labelColour: string; labelX: number; labelY: number; labelOn: boolean;
}
interface Leap {
  used: boolean; mesh: THREE.Mesh; ready: boolean; start: number; from: Vec; dir: [number, number];
  height: number; distance: number; scale: number; size: Vec; noseForward: boolean; splashed: boolean; speciesId: string;
}
interface Sweep { start: number; from: Vec; dir: [number, number]; pull: [number, number] }
interface Card {
  words: ChatCardWords; root: HTMLElement; height: number; y: number; e: string; stamp: string; yText: string; placed: boolean; announced: boolean;
}

/** A warm hex to sRGB 0..1, written straight to the glow shader (which, like the lanterns, writes display colour). */
function rgb(hex: string | null): [number, number, number] {
  const value = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffd9a0';
  return [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255];
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The lights on the water: per float a bead on its tip (never smaller than a few pixels), a pool on the water and a reflected streak toward the eye. */
function createChatGlows(capacity: number) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const centre = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const colour = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const info = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  for (const attribute of [centre, colour, info]) attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCentre', centre); geometry.setAttribute('aColour', colour); geometry.setAttribute('aInfo', info);
  geometry.instanceCount = 0;
  const uniforms = { uTime: { value: 0 }, uPixel: { value: 540 }, uMinPx: { value: 7 }, uEye: { value: new THREE.Vector3() }, uNight: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aCentre; attribute vec3 aColour; attribute vec4 aInfo; uniform float uPixel; uniform float uMinPx; uniform vec3 uEye;
      varying vec2 vUv; varying vec3 vColour; varying float vStrength; varying float vKind; varying float vSeed;
      void main(){ vUv=position.xy; vColour=aColour; vStrength=aInfo.y; vKind=aInfo.x; vSeed=aInfo.w;
        if(aInfo.y<.003){gl_Position=vec4(2.,2.,2.,1.);return;}
        if(aInfo.x<.5){ vec3 w=aCentre+vec3(position.x*aInfo.z,0.,position.y*aInfo.z); gl_Position=projectionMatrix*viewMatrix*vec4(w,1.); }
        else if(aInfo.x<1.5){ vec4 v=viewMatrix*vec4(aCentre,1.); float depth=max(.1,-v.z);
          float px=aInfo.z*projectionMatrix[1][1]*uPixel/depth; float size=aInfo.z*max(1.,uMinPx/max(px,.001));
          v.xy+=position.xy*size; gl_Position=projectionMatrix*v; }
        else { vec2 to=uEye.xz-aCentre.xz; float d=length(to); to=d>.001?to/d:vec2(0.,1.); vec2 side=vec2(-to.y,to.x);
          float along=(position.y*.5+.5)*aInfo.z; float width=.13+.05*(position.y*.5+.5);
          vec3 w=aCentre+vec3(side.x*position.x*width+to.x*along,0.,side.y*position.x*width+to.y*along);
          gl_Position=projectionMatrix*viewMatrix*vec4(w,1.); } }`,
    fragmentShader: `uniform float uTime; uniform float uNight; varying vec2 vUv; varying vec3 vColour; varying float vStrength; varying float vKind; varying float vSeed;
      void main(){ float d=length(vUv); float a; vec3 c=vColour;
        if(vKind<.5){ a=(exp(-d*d*3.)*.75+exp(-d*d*14.)*.5)*(1.-smoothstep(.82,1.,d))*(.86+.14*sin(d*16.-uTime*1.6+vSeed))*(.6+.4*uNight); }
        else if(vKind<1.5){ float core=exp(-d*d*22.); float halo=exp(-d*d*3.)*.7; a=(core+halo)*(1.-smoothstep(.86,1.,d)); c=mix(c,vec3(1.,.97,.9),core*.4); }
        else { float v=vUv.y*.5+.5; float across=1.-abs(vUv.x);
          float broken=.55+.45*sin(v*38.-uTime*2.6+vSeed*3.)*sin(v*13.+uTime*1.3+vSeed);
          a=across*across*(1.-v)*broken*.9*uNight; }
        a*=vStrength; if(a<.003)discard; gl_FragColor=vec4(c,min(a,1.)); }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'pier-chat-lights'; mesh.frustumCulled = false; mesh.renderOrder = 6;
  let count = 0;
  return {
    mesh, uniforms,
    begin() { count = 0; },
    /** kind 0 a pool on the water, 1 the bead, 2 the reflected streak; size in metres. */
    add(kind: number, x: number, y: number, z: number, c: readonly [number, number, number], strength: number, size: number, seed: number) {
      if (count >= capacity) return;
      centre.setXYZ(count, x, y, z); colour.setXYZ(count, c[0], c[1], c[2]); info.setXYZW(count, kind, strength, size, seed); count++;
    },
    end() {
      geometry.instanceCount = count; mesh.visible = count > 0;
      if (count) for (const attribute of [centre, colour, info]) { attribute.clearUpdateRanges(); attribute.addUpdateRange(0, count * attribute.itemSize); attribute.needsUpdate = true; }
      return count;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

/* ---------- The cards' pieces ---------- */

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, parent?: Element): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

/** Red wax pressed with the kingdom's little crown. */
function waxSeal(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'pier-chat-wax');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = '<path class="pier-chat-wax-pool" d="M24 2.6c3.4 0 4.6 2.4 7.6 3.1 3.1.7 5.9-.7 8.1 1.5s1.2 4.9 2.1 7.8c1 3 3.6 4.3 3.6 7.9 0 3.5-2.5 4.9-3.2 7.8-.7 3.1.8 5.8-1.5 8.1s-5.1 1.1-8 2.1c-2.9 1-4.3 3.5-7.9 3.5-3.4 0-4.9-2.4-7.8-3.3-3-.9-5.9.4-8.1-1.8-2.3-2.3-.9-5-1.9-8C4.4 28.3 2.3 27 2.3 24s2.6-4.9 3.3-7.8c.7-2.9-.9-5.8 1.4-8.1 2.2-2.2 5-1 7.9-1.9 3-.9 4.4-3.6 9.1-3.6Z"/>'
    + '<circle class="pier-chat-wax-face" cx="24" cy="24" r="15.4"/><circle class="pier-chat-wax-rim" cx="24" cy="24" r="15.4"/><circle class="pier-chat-wax-ring" cx="24" cy="24" r="12.4"/>'
    + '<path class="pier-chat-wax-crown" d="M15.6 28.6 14 18.8l5 4.1 5-7.3 5 7.3 5-4.1-1.6 9.8Z"/><path class="pier-chat-wax-band" d="M16 30.8h16"/>'
    + '<circle class="pier-chat-wax-gem" cx="24" cy="15" r="1.3"/><circle class="pier-chat-wax-gem" cx="14" cy="18.4" r="1.1"/><circle class="pier-chat-wax-gem" cx="34" cy="18.4" r="1.1"/>'
    + '<path class="pier-chat-wax-shine" d="M14.4 12.2c2.8-2.1 6.6-3 10.3-2.5"/>';
  return svg;
}

/** The float's own silhouette, inked, for the honest "pier is full" slip. */
function floatGlyph(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'pier-chat-glyph');
  svg.setAttribute('viewBox', '0 0 24 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = '<path class="pier-chat-glyph-water" d="M1 22.5c3 0 3-1.4 5.5-1.4S9 22.5 12 22.5s3-1.4 5.5-1.4 2.5 1.4 5.5 1.4"/>'
    + '<path class="pier-chat-glyph-tip" d="M12 2.5v8"/><path class="pier-chat-glyph-body" d="M12 10.5c3.1 0 4.6 3.4 4.6 6.4S14.6 24 12 26c-2.6-2-4.6-6.1-4.6-9.1s1.5-6.4 4.6-6.4Z"/><path class="pier-chat-glyph-band" d="M7.8 15.2h8.4"/>';
  return svg;
}

/** Chat's floats and the pier's public catches, in the world and on the overlay. */
export function mountChatLines(host: ChatLinesHost): ChatLines {
  const { site } = host, waterY = site.waterY;
  const doc = host.overlay.ownerDocument;
  const out: [number, number] = site.turn === 0 ? [0, 1] : site.turn === 1 ? [1, 0] : site.turn === 2 ? [0, -1] : [-1, 0];
  const right: [number, number] = [out[1], -out[0]];
  // Where a chat cast comes from: the end of the T-head, a little above the rail, as though a hand there threw it.
  const reach = site.walk + 3.4;
  const castFrom: Vec = [site.root[0] + out[0] * reach, site.deckY + 1.35, site.root[2] + out[1] * reach];

  /* ---- the world ---- */
  const pool = host.mesh ? null : new VoxelWorkerPool({ size: 1, maxQueue: 16 });
  const mesh = host.mesh ?? (async (asset: VoxelAsset) => {
    const result = await pool!.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error('A pier model could not be meshed.');
    return geometryFromChunks(result.chunks, 'avatar');
  });
  const material = createVoxelMaterial(MATERIALS, 'avatar');
  const root = new THREE.Group(); root.name = 'pier-chat';
  const floatModel = createPierFloat();
  // The float turns about its keel; its light sits on the tip of the quill.
  const keel = floatModel.waterline * CELL * FLOAT_SCALE, tip = floatModel.eye[1] * CELL * FLOAT_SCALE + .035;
  let floats: THREE.InstancedMesh | null = null;
  const geometries: THREE.BufferGeometry[] = [];
  let disposed = false;
  void mesh(floatModel.asset).then(geometry => {
    if (disposed) { geometry.dispose(); return; }
    geometries.push(geometry);
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(SLOTS).fill(1), 1));
    floats = new THREE.InstancedMesh(geometry, material.material, SLOTS);
    floats.count = 0; floats.frustumCulled = false; floats.name = 'pier-chat-floats';
    floats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(floats);
  }).catch(error => { if (!disposed) console.error('The chat floats could not be shaped; their lights still show.', error); });
  const glows = createChatGlows(SLOTS * GLOW_KINDS);
  const rings = createRings(160), droplets = createDroplets(360), shadows = createFishShadows(SHADOWS);
  droplets.uniforms.uWater.value = waterY; shadows.mesh.position.y = waterY;
  root.add(glows.mesh, rings.mesh, droplets.points, shadows.mesh);
  let ringsUntil = -1, dropletsUntil = -1;
  const ring = (x: number, z: number, radius: number, life: number, strength: number, at: number) => {
    ringsUntil = Math.max(ringsUntil, at + life); rings.spawn(x, waterY, z, radius, life, strength, at);
  };
  const burst = (x: number, z: number, count: number, force: number, size: number, at: number) => {
    dropletsUntil = Math.max(dropletsUntil, at + 1.7); droplets.burst(x, waterY, z, count, force, size, at);
  };
  const fishGeometry = new Map<string, Promise<{ geometry: THREE.BufferGeometry; size: Vec; noseForward: boolean }>>();
  const speciesModel = (id: string) => {
    let job = fishGeometry.get(id);
    if (!job) {
      const model = createFishModel(id);
      job = mesh(model.asset).then(geometry => {
        if (disposed) geometry.dispose(); else geometries.push(geometry);
        const size = [...model.asset.size] as Vec;
        return { geometry, size, noseForward: model.mouth[2] >= size[2] / 2 };
      });
      fishGeometry.set(id, job);
    }
    return job;
  };
  const leaps: Leap[] = Array.from({ length: LEAPS }, (_, index) => {
    const object = new THREE.Mesh(new THREE.BufferGeometry(), material.material);
    object.visible = false; object.matrixAutoUpdate = false; object.frustumCulled = false; object.name = `pier-chat-fish-${index}`;
    root.add(object);
    return { used: false, mesh: object, ready: false, start: 0, from: [0, 0, 0], dir: [1, 0], height: 1, distance: 1.5, scale: 1, size: [1, 1, 1], noseForward: true, splashed: false, speciesId: '' };
  });
  const sweeps: Sweep[] = [];
  host.scene.add(root);

  /* ---- the overlay ---- */
  const layer = el(doc, 'div', 'pier-chat');
  layer.dataset.compact = host.compact ? 'true' : 'false';
  const names = el(doc, 'div', 'pier-chat-names', layer);
  names.setAttribute('aria-hidden', 'true');
  const stackNode = el(doc, 'div', 'pier-chat-cards', layer);
  const announcer = el(doc, 'div', 'pier-chat-sr', layer);
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  host.overlay.appendChild(layer);
  // A card's height changes once its fonts and picture arrive; the stack makes room without reading layout every frame.
  const heights = new WeakMap<Element, Card>();
  const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    for (const entry of entries) {
      const card = heights.get(entry.target), box = entry.borderBoxSize?.[0];
      if (card) card.height = box ? box.blockSize : entry.contentRect.height;
    }
  }) : null;

  const feed = createPierFeedState();
  const slots: Slot[] = Array.from({ length: SLOTS }, () => ({ used: false, id: '', line: null,
    motion: { phase: 'float', since: 0, born: 0, cast: false, from: castFrom, at: [0, 0, 0], waterY, seed: 0, pull: out, exit: null, exitAt: 0 },
    colour: [1, .85, .6], pose: blankPose(), nibble: -1, ring: 0, drop: 0, label: null, labelText: '', labelColour: '', labelX: NaN, labelY: NaN, labelOn: false }));
  const byId = new Map<string, Slot>();
  const stack = createCardStack<Card>();
  let now = 0, origin: number | null = null, hourSeen = -1, night = 1;
  const temp = { matrix: new THREE.Matrix4(), q: new THREE.Quaternion(), euler: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3(), centre: new THREE.Matrix4(),
    project: new THREE.Vector3(), right: new THREE.Vector3(), leap: [0, 0, 0] as Vec };

  /** The camera's right, flat on the water: leaps and the legend's pass cross the picture, never into it. */
  const across = (): [number, number] => {
    temp.right.setFromMatrixColumn(host.camera.matrixWorld, 0);
    const length = Math.hypot(temp.right.x, temp.right.z);
    return length > 1e-4 ? [temp.right.x / length, temp.right.z / length] : [right[0], right[1]];
  };

  const label = (slot: Slot) => {
    const name = slot.line?.who.name ?? null;
    if (!name) { if (slot.label) { slot.label.remove(); slot.label = null; slot.labelText = ''; } return; }
    if (!slot.label) {
      slot.label = el(doc, 'div', 'pier-chat-name', names);
      el(doc, 'i', 'pier-chat-name-bead', slot.label);
      el(doc, 'span', 'pier-chat-name-text', slot.label);
      slot.labelX = slot.labelY = NaN; slot.labelOn = false; slot.label.dataset.off = 'true';
    }
    if (name !== slot.labelText) { slot.labelText = name; (slot.label.lastChild as HTMLElement).textContent = name; }
    const colour = slot.line?.who.colour ?? '#ffd9a0';
    if (colour !== slot.labelColour) { slot.labelColour = colour; slot.label.style.setProperty('--lamp', colour); }
  };
  const free = (slot: Slot) => {
    if (slot.label) slot.label.remove();
    byId.delete(slot.id);
    Object.assign(slot, { used: false, id: '', line: null, label: null, labelText: '', labelColour: '', labelOn: false });
  };
  const place = (line: PierFeedLine, quiet: boolean) => {
    let slot = byId.get(line.id);
    if (!slot) {
      slot = slots.find(entry => !entry.used);
      // Every slot busy: the float closest to finishing leaving gives way first.
      if (!slot) { slot = slots.reduce((a, b) => (a.motion.exit ? a.motion.exitAt : Infinity) <= (b.motion.exit ? b.motion.exitAt : Infinity) ? a : b); free(slot); }
      const seed = hash(line.id), angle = ((seed % 1000) / 1000 - .5) * 1.4;
      const pull: [number, number] = [out[0] * Math.cos(angle) - out[1] * Math.sin(angle), out[0] * Math.sin(angle) + out[1] * Math.cos(angle)];
      Object.assign(slot, { used: true, id: line.id, nibble: -1, ring: now, drop: now });
      slot.motion = { phase: line.phase, since: now, born: now, cast: !quiet, from: castFrom, at: [line.float[0], waterY, line.float[2]], waterY,
        seed: (seed % 6283) / 1000, pull, exit: null, exitAt: 0 };
      byId.set(line.id, slot);
    } else if (slot.motion.exit) {
      // A fresh snapshot still holds a float that was leaving: it stays, quietly.
      slot.motion = { ...slot.motion, phase: line.phase, since: now, exit: null, exitAt: 0 };
    } else if (slot.motion.phase !== line.phase || slot.motion.at[0] !== line.float[0] || slot.motion.at[2] !== line.float[2]) {
      slot.motion = { ...slot.motion, phase: line.phase, since: slot.motion.phase !== line.phase ? now : slot.motion.since, at: [line.float[0], waterY, line.float[2]] };
      if (line.phase === 'bite') {
        const [x, , z] = slot.motion.at;
        for (let i = 0; i < 3; i++) ring(x, z, .55 + i * .4, 1 + i * .3, .85, now + i * .09);
        burst(x, z, 12, 2.4, .04, now);
      }
      if (line.phase === 'fight') burst(slot.motion.at[0], slot.motion.at[2], 14, 3, .045, now);
    }
    slot.line = line; slot.colour = rgb(line.who.colour);
    label(slot);
  };
  const leave = (id: string, exit: FloatExit) => {
    const slot = byId.get(id);
    if (!slot || slot.motion.exit) return slot ?? null;
    slot.motion = { ...slot.motion, exit, exitAt: now };
    return slot;
  };

  const leap = (speciesId: string, from: Vec, lengthMm: number) => {
    let entry = leaps.find(item => !item.used);
    if (!entry) entry = leaps.reduce((a, b) => a.start <= b.start ? a : b);
    const metres = Math.max(.12, lengthMm / 1000);
    // Across the picture and toward its middle, so the leap never ends behind something at the frame's edge.
    const dir = across();
    temp.project.set(from[0], waterY, from[2]).project(host.camera);
    if (temp.project.x > 0) { dir[0] = -dir[0]; dir[1] = -dir[1]; }
    Object.assign(entry, { used: true, ready: false, start: now, from: [from[0], waterY, from[2]], dir, splashed: false, speciesId,
      height: .9 + Math.min(1, metres) * .7, distance: 1.2 + Math.min(1.2, metres) * .7 });
    entry.mesh.visible = false;
    const target = entry;
    void speciesModel(speciesId).then(model => {
      if (disposed || target.speciesId !== speciesId || !target.used) return;
      target.mesh.geometry = model.geometry; target.size = model.size; target.noseForward = model.noseForward;
      const authored = model.size[2] * CELL, wanted = Math.max(.5, metres * 1.8);
      target.scale = THREE.MathUtils.clamp(wanted / authored, .7, 3.2); target.ready = true;
    }).catch(() => { /* The splash still tells it without the body. */ });
    burst(from[0], from[2], 26, 4.4, .055, now);
    for (let i = 0; i < 3; i++) ring(from[0], from[2], 1 + i * .7, 1.4 + i * .4, .85, now + i * .12);
  };

  const portraitSize = () => {
    const view = host.viewport();
    return Math.round(THREE.MathUtils.clamp(Math.min(view.width, view.height) * (host.compact ? .15 : .1), 48, 132));
  };
  const card = (words: ChatCardWords, delay: number) => {
    const node = el(doc, 'article', 'pier-chat-card');
    node.dataset.kind = words.kind;
    node.setAttribute('aria-hidden', 'true');
    if (words.colour) node.style.setProperty('--lamp', words.colour);
    const board = el(doc, 'div', 'pier-chat-board', node);
    if (words.kind === 'full') {
      board.appendChild(floatGlyph(doc));
      el(doc, 'p', 'pier-chat-full', board).textContent = words.sentence;
    } else {
      const face = el(doc, 'div', words.kind === 'legend' ? 'pier-chat-lacquer' : 'pier-chat-paper', board);
      if (words.speciesId) {
        const print = el(doc, 'div', 'pier-chat-print', face);
        print.dataset.portrait = 'pending';
        const canvas = el(doc, 'canvas', 'pier-chat-portrait', print);
        const draw = host.portrait ?? ((id: string, target: HTMLCanvasElement, size: number) => paintItemPortrait(target, id, size));
        const speciesId = words.speciesId;
        void Promise.resolve().then(() => draw(speciesId, canvas, portraitSize())).then(drawn => {
          if (!disposed && print.isConnected !== false) print.dataset.portrait = drawn ? 'drawn' : 'none';
        }, () => { if (!disposed) print.dataset.portrait = 'none'; });
      }
      const text = el(doc, 'div', 'pier-chat-words', face);
      const sentence = el(doc, 'p', 'pier-chat-line', text);
      if (words.kind === 'catch') el(doc, 'i', 'pier-chat-lamp', sentence).setAttribute('aria-hidden', 'true');
      const lead = el(doc, 'span', 'pier-chat-lead', sentence);
      // The person's name stands upright and dark in the italic line, so it reads first.
      if (words.kind === 'catch' && words.who && words.lead.startsWith(words.who)) {
        el(doc, 'span', 'pier-chat-who', lead).textContent = words.who;
        lead.appendChild(doc.createTextNode(words.lead.slice(words.who.length)));
      } else lead.textContent = words.lead;
      el(doc, 'span', 'pier-chat-subject', sentence).textContent = words.subject;
      if (words.tail) el(doc, 'span', 'pier-chat-tail', sentence).textContent = words.tail;
      if (words.measure) el(doc, 'p', 'pier-chat-measure', text).textContent = words.measure;
      if (words.first || words.mount) {
        const honours = el(doc, 'div', 'pier-chat-honours', text);
        if (words.first) {
          const first = el(doc, 'span', 'pier-chat-first', honours);
          first.appendChild(waxSeal(doc));
          el(doc, 'span', 'pier-chat-first-words', first).textContent = words.first;
        }
        if (words.mount) el(doc, 'span', 'pier-chat-mount', honours).textContent = words.mount;
      }
      if (words.moral) {
        el(doc, 'i', 'pier-chat-gild-rule', text).setAttribute('aria-hidden', 'true');
        el(doc, 'p', 'pier-chat-moral', text).textContent = words.moral;
      }
    }
    node.dataset.state = 'waiting';
    const entry: Card = { words, root: node, height: 0, y: 0, e: '', stamp: '', yText: '', placed: false, announced: false };
    heights.set(node, entry);
    stack.add(entry, now + delay, words.hold);
  };

  const beat = (value: PierFeedBeat) => {
    switch (value.kind) {
      case 'line': place(value.line, value.quiet); return;
      case 'gone': {
        const slot = leave(value.id, 'gone');
        if (slot && !value.quiet) ring(slot.pose.x, slot.pose.z, .6, 1.2, .45, now);
        return;
      }
      case 'caught': {
        const { event } = value;
        const float = event.via === 'chat' ? event.float ?? value.line?.float ?? null : null;
        const words = catchWords(event, host.kingdomName);
        if (float && SPECIES.has(event.fish.speciesId)) {
          const slot = leave(event.id, 'caught');
          leap(event.fish.speciesId, slot ? [slot.pose.x, waterY, slot.pose.z] : [float[0], waterY, float[2]], event.fish.lengthMm);
          if (event.kingdomFirst || event.keepsake !== null) for (let i = 0; i < 2; i++) ring(float[0], float[2], 2.4 + i * 1.1, 2 + i * .4, .6, now + .2 + i * .15);
          card(words, .3);
        } else { if (float) leave(event.id, 'caught'); card(words, 0); }
        return;
      }
      case 'broken': {
        const { event } = value;
        const slot = leave(event.id, 'broken');
        const x = slot ? slot.pose.x : event.float[0], z = slot ? slot.pose.z : event.float[2];
        for (let i = 0; i < 5; i++) ring(x, z, 1.6 + i * .95, 1.6 + i * .35, .95, now + i * .1);
        burst(x, z, 80, 7.6, .12, now); burst(x, z, 46, 5.2, .1, now + .28);
        const dir = across(), pull = slot?.motion.pull ?? out;
        sweeps.push({ start: now, from: [x - dir[0] * 4.2 + pull[0] * .8, waterY, z - dir[1] * 4.2 + pull[1] * .8], dir, pull: [pull[0], pull[1]] });
        if (sweeps.length > 2) sweeps.shift();
        card(brokenWords(event), .35);
        return;
      }
      case 'full': card(fullWords(value.event), 0); return;
    }
  };

  const apply = (event: PierFeedEvent) => {
    if (disposed) return;
    feed.apply(event);
    for (const value of feed.drain()) beat(value);
  };

  const updateHour = () => {
    const hour = host.hour?.() ?? 19.2;
    if (Math.abs(hour - hourSeen) < .02) return;
    hourSeen = hour;
    const grade = getEnvironment(hour);
    material.setEnvironment(grade);
    night = Math.max(.35, windowGlowForHour(hour));
    glows.uniforms.uNight.value = night;
    const sky = new THREE.Color(grade.horizon), sun = new THREE.Color(grade.sun);
    rings.uniforms.uColor.value.copy(sky).lerp(sun, .25).multiplyScalar(1.15 - grade.night * .45);
    rings.uniforms.uFogColor.value.set(grade.fog); rings.uniforms.uFogDensity.value = grade.fogDensity;
    droplets.uniforms.uColor.value.copy(sky).lerp(new THREE.Color('#ffffff'), .5).multiplyScalar(1 - grade.night * .5);
    shadows.uniforms.uColor.value.set(grade.fog).lerp(new THREE.Color('#0b171c'), .86);
  };

  let laidAt = 0;
  let draws = 0, triangles = 0, active = 0, exiting = 0, flying = 0, shownCards = 0, shownNames = 0;
  const update = (clock: number) => {
    if (disposed) return;
    if (origin === null) origin = clock;
    // Shader time stays small: a GPU float cannot hold an epoch.
    now = clock - origin;
    updateHour();
    const view = host.viewport();
    rings.uniforms.uTime.value = now; droplets.uniforms.uTime.value = now; glows.uniforms.uTime.value = now;
    droplets.uniforms.uScale.value = view.height * .9;
    glows.uniforms.uPixel.value = view.height / 2; glows.uniforms.uMinPx.value = host.compact ? 5 : Math.max(5, view.height / 150);
    glows.uniforms.uEye.value.copy(host.camera.position);
    host.camera.updateMatrixWorld();

    glows.begin();
    let floatCount = 0, shadowCount = 0;
    active = 0; exiting = 0; shownNames = 0;
    for (const slot of slots) {
      if (!slot.used) continue;
      if (floatDone(slot.motion, now)) { free(slot); continue; }
      if (slot.motion.exit) exiting++; else active++;
      const pose = floatPose(slot.motion, now, slot.pose);
      const { motion } = slot, phaseAge = now - motion.since;
      const onWater = THREE.MathUtils.clamp(1 - (pose.y - waterY) / 1.2, 0, 1);
      // Phase-local splashes: the cast lands, nibbles ring, a fight throws rings and spray off the float.
      if (motion.cast && !motion.exit && now - motion.born >= CAST_S && slot.nibble === -1) {
        slot.nibble = 0;
        ring(motion.at[0], motion.at[2], .9, 1.5, .9, now); ring(motion.at[0], motion.at[2], 1.6, 2.2, .45, now + .15); burst(motion.at[0], motion.at[2], 8, 1.4, .035, now);
      }
      if (!motion.exit && motion.phase === 'bite') {
        const dip = Math.floor((phaseAge - .2) / .46);
        if (phaseAge > .2 && dip > slot.nibble) { slot.nibble = dip; ring(pose.x, pose.z, .45, .9, .55, now); }
      }
      if (!motion.exit && motion.phase === 'fight') {
        const [px, pz] = motion.pull;
        const fishX = pose.x + px * .7, fishZ = pose.z + pz * .7;
        shadows.set(shadowCount++, fishX, fishZ, Math.atan2(px, pz) + Math.sin(now * 2.3 + motion.seed) * .5, .62, 1, now * 8 + motion.seed);
        if (now - slot.ring > .3) { slot.ring = now; ring(pose.x, pose.z, .55, .9, .7, now); }
        if (now - slot.drop > .65) { slot.drop = now; burst(pose.x, pose.z, 6, 1.9, .032, now); }
      }
      if (floats && pose.scale > .01) {
        temp.euler.set(pose.tilt, pose.lean, 0, 'YXZ'); temp.q.setFromEuler(temp.euler);
        temp.p.set(pose.x, pose.y - keel * pose.scale, pose.z); temp.s.setScalar(FLOAT_SCALE * pose.scale);
        temp.centre.makeTranslation(-1.5 * CELL, 0, -1.5 * CELL);
        temp.matrix.compose(temp.p, temp.q, temp.s).multiply(temp.centre);
        floats.setMatrixAt(floatCount++, temp.matrix);
      }
      const glow = pose.glow, reachUp = tip * pose.scale, lean = Math.sin(pose.tilt) * reachUp;
      const top = pose.y - keel * pose.scale + Math.cos(pose.tilt) * reachUp;
      glows.add(1, pose.x + Math.sin(pose.lean) * lean, top, pose.z + Math.cos(pose.lean) * lean, slot.colour, glow * 1.2, .16, motion.seed);
      if (onWater > .01) {
        glows.add(0, pose.x, waterY + .02, pose.z, slot.colour, glow * onWater, 1.7 + (motion.phase === 'fight' ? .4 : 0), motion.seed);
        glows.add(2, pose.x, waterY + .025, pose.z, slot.colour, glow * onWater, 3.4, motion.seed);
      }
      // The name over the light, hidden off screen, behind the eye or once the float is leaving.
      if (slot.label) {
        temp.project.set(pose.x, top + .55, pose.z).project(host.camera);
        const on = !motion.exit && temp.project.z < 1 && temp.project.z > -1 && Math.abs(temp.project.x) < 1.05 && Math.abs(temp.project.y) < 1.05 && pose.scale > .3;
        if (on !== slot.labelOn) { slot.labelOn = on; slot.label.dataset.off = on ? 'false' : 'true'; }
        if (on) {
          shownNames++;
          const x = Math.round((temp.project.x * .5 + .5) * view.width * 2) / 2, y = Math.round((1 - (temp.project.y * .5 + .5)) * view.height * 2) / 2;
          if (x !== slot.labelX || y !== slot.labelY) { slot.labelX = x; slot.labelY = y; slot.label.style.transform = `translate(${x}px, ${y}px)`; }
        }
      }
    }
    // A legend's dark shape sweeping past under the boil.
    for (let i = sweeps.length - 1; i >= 0; i--) {
      const sweep = sweeps[i]!, u = (now - sweep.start) / 2.8;
      if (u >= 1) { sweeps.splice(i, 1); continue; }
      if (u < 0) continue;
      const travel = 8.4 * (u * .85 + .15 * u * u);
      const x = sweep.from[0] + sweep.dir[0] * travel, z = sweep.from[2] + sweep.dir[1] * travel;
      shadows.set(shadowCount++, x, z, Math.atan2(sweep.dir[0], sweep.dir[1]) + Math.sin(now * 2) * .12, Math.sin(u * Math.PI) * 1.6, 4.2, now * 3.2);
    }
    if (floats) { floats.count = floatCount; if (floatCount) floats.instanceMatrix.needsUpdate = true; }
    const glowCount = glows.end();
    shadows.show(shadowCount);
    // Leaping fish.
    flying = 0;
    for (const entry of leaps) {
      if (!entry.used) continue;
      const age = now - entry.start;
      if (age >= LEAP_S && !entry.splashed) {
        entry.splashed = true;
        const endX = entry.from[0] + entry.dir[0] * entry.distance, endZ = entry.from[2] + entry.dir[1] * entry.distance;
        burst(endX, endZ, 30, 3.6, .055, now);
        for (let i = 0; i < 3; i++) ring(endX, endZ, 1.1 + i * .7, 1.5 + i * .4, .8, now + i * .1);
      }
      if (age >= LEAP_S + .1) { entry.used = false; entry.mesh.visible = false; continue; }
      if (!entry.ready) { entry.mesh.visible = false; continue; }
      const pitch = leapPose(age, entry.from, entry.dir, entry.height, entry.distance, waterY, temp.leap);
      const yaw = Math.atan2(entry.dir[0], entry.dir[1]) + (entry.noseForward ? 0 : Math.PI);
      temp.euler.set(entry.noseForward ? -pitch : pitch, yaw, Math.sin(age * 20) * .3, 'YXZ'); temp.q.setFromEuler(temp.euler);
      temp.p.set(temp.leap[0], temp.leap[1], temp.leap[2]); temp.s.setScalar(entry.scale);
      temp.centre.makeTranslation(-entry.size[0] * CELL / 2, -entry.size[1] * CELL / 2, -entry.size[2] * CELL / 2);
      entry.mesh.matrix.compose(temp.p, temp.q, temp.s).multiply(temp.centre); entry.mesh.matrixWorld.copy(entry.mesh.matrix);
      entry.mesh.visible = temp.leap[1] > waterY - .3;
      if (entry.mesh.visible) flying++;
    }
    rings.mesh.visible = now < ringsUntil; droplets.points.visible = now < dropletsUntil;
    // Cards.
    const { shown, dropped } = stack.step(now);
    for (const entry of dropped) { sizes?.unobserve(entry.value.root); entry.value.root.remove(); }
    layCards(shown);
    shownCards = shown.length;
    draws = (floats && floatCount ? 1 : 0) + (glowCount ? 1 : 0) + (rings.mesh.visible ? 1 : 0) + (droplets.points.visible ? 1 : 0) + (shadowCount ? 1 : 0) + flying;
    triangles = (floats && floatCount ? (floats.geometry.index?.count ?? 0) / 3 * floatCount : 0) + glowCount * 2 + (rings.mesh.visible ? 320 : 0) + shadowCount * 2
      + leaps.reduce((sum, entry) => sum + (entry.mesh.visible ? (entry.mesh.geometry.index?.count ?? 0) / 3 : 0), 0);
  };

  /** Newest at the top on a stream (at the bottom on a phone), the rest sliding to make room; all in local time, so a frozen frame is exact. */
  const layCards = (shown: readonly StackedCard<Card>[]) => {
    const compact = host.compact, gap = compact ? 8 : Math.max(10, host.viewport().height * .012);
    // A frozen frame (the same time again) settles at once; a running one glides.
    const ease = now - laidAt > 0 ? 1 - Math.exp(-(now - laidAt) * 14) : 1;
    laidAt = now;
    let offset = 0;
    for (let i = shown.length - 1; i >= 0; i--) {
      const entry = shown[i]!, value = entry.value;
      if (!value.placed) {
        value.placed = true; value.root.dataset.state = 'in';
        stackNode.appendChild(value.root);
        value.height = value.root.offsetHeight || 0;
        sizes?.observe(value.root);
        value.y = offset;
      }
      if (!value.announced) { value.announced = true; announcer.textContent = cardSummary(value.words); }
      const arriving = Math.min(1, (now - entry.from) / CARD_ENTER_S);
      const going = entry.leaving === null ? 0 : Math.min(1, (now - entry.leaving) / CARD_LEAVE_S);
      const e = (arriving < 1 ? 1 - (1 - arriving) ** 3 : 1) * (1 - going * going);
      const stampAge = now - entry.from - .55, stamp = stampAge <= 0 ? 0 : Math.min(1, stampAge / .25);
      value.y += (offset - value.y) * ease;
      if (Math.abs(offset - value.y) < .5) value.y = offset;
      const eText = e.toFixed(3), stampText = stamp.toFixed(3), yText = `${Math.round(value.y * 2) / 2}px`;
      if (eText !== value.e) { value.e = eText; value.root.style.setProperty('--e', eText); }
      if (stampText !== value.stamp) { value.stamp = stampText; value.root.style.setProperty('--stamp', stampText); }
      if (yText !== value.yText) { value.yText = yText; value.root.style.setProperty('--y', yText); }
      if (entry.leaving !== null && value.root.dataset.state !== 'out') value.root.dataset.state = 'out';
      // A leaving card keeps its room until it is gone, so the others never jump under it.
      offset += (value.height || 0) * (entry.leaving === null ? 1 : 1 - going) + gap;
    }
  };

  return {
    apply,
    update,
    stats: () => ({ floats: active, leaving: exiting, leaps: flying, cards: shownCards, names: shownNames, draws, triangles: Math.round(triangles) }),
    dispose() {
      if (disposed) return;
      disposed = true;
      host.scene.remove(root);
      floats?.dispose();
      glows.dispose(); rings.dispose(); droplets.dispose(); shadows.dispose();
      for (const entry of leaps) entry.mesh.geometry = new THREE.BufferGeometry();
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      material.dispose(); pool?.dispose();
      for (const slot of slots) if (slot.used) free(slot);
      stack.clear();
      sizes?.disconnect();
      sweeps.length = 0;
      layer.remove();
    },
  };
}

