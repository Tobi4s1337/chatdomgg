import * as THREE from 'three';
import { createTree, MATERIALS } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWater, createWindowLights, geometryFromChunks, getEnvironment, type WindowHouse } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { randomUnit, samplePublicGround, seedHash, terrainHeight, type CitizenMotionSample, type SettlementPlan } from '@chatdom/world';
import type { KingdomPresenceFrame, Vec3, VoxelBlueprint } from '@chatdom/shared';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import { placeMarketContent, placeSettlementContent } from '../kingdom/settlement-content';
import { createCastleContent } from '../kingdom/castle-content';
import { createLightField } from '../kingdom/light-field';
import { inhabitedLightBounds } from '../kingdom/light-bounds';
import { loadTerrain } from '../kingdom/terrain-client';
import { terrainBatches } from '../kingdom/terrain-batches';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from '../kingdom/terrain-worker';
import { toCitizenSample, type BehaviourFrame } from './loop';

/**
 * `doorstep`/`close` hold a greeting; `follow` keeps one person through a routine; `market` holds the
 * square around a visitor; `street` is a wide look down the street; `aerial` takes in a whole town.
 */
export type BenchView = 'doorstep' | 'close' | 'street' | 'follow' | 'market' | 'aerial';
/** Two people the doorstep camera should hold: the one who notices, and the one noticed. */
export interface BenchFocus {
  readonly slot: number;
  readonly subject: Vec3; readonly subjectHeading: number; readonly subjectSpeed: number;
  readonly other: Vec3; readonly otherHeading: number; readonly otherSpeed: number;
}

const LIGHT_UNIFORMS = ['uLight', 'uLightOrigin', 'uLightExtent', 'uFarLight', 'uFarOrigin', 'uFarExtent', 'uFarCell', 'uBeaconLight', 'uBeaconOrigin', 'uBeaconExtent', 'uBeaconCell'];

/**
 * The real settlement, homes, market, castle, terrain, window light and citizen renderer around
 * one street. It renders samples it is given; it never moves, routes or poses anyone itself.
 */
export async function createBehaviourStage(canvas: HTMLCanvasElement, plan: SettlementPlan, streetSlots: readonly number[], options: { hour: number; onProgress(text: string): void }) {
  const cleanups: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => { cleanups.push(() => resource.dispose()); return resource; };
  const dispose = (): void => { for (const cleanup of cleanups.splice(0).reverse()) { try { cleanup(); } catch { /* Release the rest. */ } } };
  try {
    const renderer = own(new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }));
    renderer.debug.onShaderError = () => { throw new Error('A bench shader could not compile'); };
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(46, 1, .15, 2200), atmosphere = own(createAtmosphere(scene));
    const clay = own(createVoxelMaterial(MATERIALS, 'build')), ground = own(createVoxelMaterial(MATERIALS, 'terrain'));
    for (const key of LIGHT_UNIFORMS) ground.material.uniforms[key] = clay.material.uniforms[key]!;
    const heightOrigin: [number, number] = [Math.floor(plan.bounds.minX) - 20, Math.floor(plan.bounds.minZ) - 20];
    const heightWidth = Math.ceil(plan.bounds.maxX - heightOrigin[0]) + 21, heightDepth = Math.ceil(plan.bounds.maxZ - heightOrigin[1]) + 21;
    const heightData = new Float32Array(heightWidth * heightDepth);
    for (let z = 0; z < heightDepth; z++) for (let x = 0; x < heightWidth; x++) heightData[x + z * heightWidth] = terrainHeight(plan, heightOrigin[0] + x, heightOrigin[1] + z);
    ground.setTerrainHeight(heightData, heightWidth, heightDepth, heightOrigin, 1);
    ground.setShoreLevel(plan.lake.level, [plan.lake.x - plan.lake.radiusX * 1.3, plan.lake.x + plan.lake.radiusX * 1.3, plan.lake.z - plan.lake.radiusZ * 1.3, plan.lake.z + plan.lake.radiusZ * 1.3]);
    const pool = own(new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 192 }));

    // Citizens use main's avatar material, with the kingdom consumer's open-sky fill so a face
    // stays readable before a window lights it. Same light volume as the town.
    const avatar = own(createVoxelMaterial(MATERIALS, 'avatar'));
    avatar.material.fragmentShader = avatar.material.fragmentShader.replace('float sky=mix(.24,1.,vSky);', 'float sky=mix(.72,1.,vSky);').replace('vec3 colour=base*edge*light*ao;', 'vec3 colour=base*edge*(light+vec3(.4,.32,.25))*ao;');
    for (const key of LIGHT_UNIFORMS) avatar.material.uniforms[key] = clay.material.uniforms[key]!;
    const looks = createDefaultCitizenLooks();

    const { houses, props } = placeSettlementContent(plan.homes, (x, z) => terrainHeight(plan, x, z));
    props.push(...placeMarketContent(plan.market));
    const { buildings: castle } = createCastleContent(plan.castle);
    const blockers: WindowHouse[] = [...houses, ...castle], placements = [...blockers, ...props];
    const windows = own(createWindowLights(scene, houses));
    const shadows = own(createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(plan.bounds.minX - 40, -8, plan.bounds.minZ - 70), new THREE.Vector3(plan.bounds.maxX + 40, 60, plan.bounds.maxZ + 20)), resolution: 2048 }));
    shadows.bindReceiver(clay.material); shadows.bindReceiver(ground.material); shadows.bindReceiver(avatar.material);
    const nearBlockers = [...blockers, ...props.map(prop => ({ ...prop, slot: 65534 }))];
    let nearBytes = 0, farBytes = 0, lightError: string | null = null;
    const field = own(createLightField(plan, nearBlockers, volume => { clay.setLight(volume); nearBytes = volume.estimatedPeakBytes; }, error => { lightError = error.message; }));
    const farField = own(createLightField(plan, blockers, volume => { clay.setFarLight(volume); farBytes = volume.estimatedPeakBytes; }, error => { lightError = error.message; }, { mode: 'kingdom', bounds: inhabitedLightBounds(plan.homes) }));

    // A modest grove on the same rules as the kingdom: never on a reservation, street, castle or lake.
    const trees = [createTree(0), createTree(1), createTree(2)], treePlaces = trees.map(() => [] as { position: Vec3; yaw: number }[]);
    const planted: [number, number][] = [], crown = 4.25;
    const plant = (x: number, z: number, variant: number): void => {
      if (plan.reservations.some(({ lot }) => x > lot.minX - crown && x < lot.maxX + crown && z > lot.minZ - crown && z < lot.maxZ + crown)) return;
      if ((samplePublicGround(plan, x, z)?.reservedDistance ?? Infinity) < crown) return;
      const c = plan.castle.bounds;
      if (x > c.minX - crown && x < c.maxX + crown && z > c.minZ - crown && z < c.maxZ + crown) return;
      if (Math.hypot((x - plan.lake.x) / plan.lake.radiusX, (z - plan.lake.z) / plan.lake.radiusZ) < 1.19) return;
      if (planted.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 8)) return;
      let root = Infinity;
      for (const dx of [-1.25, 0, 1.25]) for (const dz of [-1.25, 0, 1.25]) root = Math.min(root, terrainHeight(plan, x + dx, z + dz));
      planted.push([x, z]); treePlaces[variant]!.push({ position: [x - 4, root, z - 4], yaw: 0 });
    };
    for (let i = 0; i < 1200 && planted.length < 110; i++) {
      const group = Math.floor(i / 7), rand = (part: string): number => randomUnit(seedHash(`${plan.config.seed}:bench-grove:${part}`));
      const cx = plan.bounds.minX - 30 + rand(`${group}:x`) * (plan.bounds.maxX - plan.bounds.minX + 60);
      const cz = plan.bounds.minZ - 50 + rand(`${group}:z`) * (plan.bounds.maxZ - plan.bounds.minZ + 40);
      const angle = rand(`${i}:a`) * Math.PI * 2, radius = Math.sqrt(rand(`${i}:r`)) * 10;
      plant(cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius, group % 3);
    }

    const geometries: THREE.BufferGeometry[] = [];
    cleanups.push(() => { for (const geometry of geometries) geometry.dispose(); });
    const instance = (blueprint: VoxelBlueprint, geometry: THREE.BufferGeometry, list: readonly { position: Vec3; yaw: number }[], scale: number): void => {
      geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(list.length).fill(1), 1)); geometries.push(geometry);
      const mesh = new THREE.InstancedMesh(geometry, clay.material, list.length), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
      list.forEach((place, i) => mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(...place.position), rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), place.yaw), new THREE.Vector3(scale, scale, scale))));
      mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; mesh.name = blueprint.id; scene.add(mesh); shadows.register(mesh);
      cleanups.push(() => mesh.dispose());
    };
    const unique = new Map<string, VoxelBlueprint>();
    for (const { blueprint } of placements) unique.set(blueprint.id, blueprint);
    let built = 0;
    const assets = [...unique.values(), ...trees];
    options.onProgress('Raising the street');
    const work = assets.map(async blueprint => {
      // Flora is authored at half resolution in the kingdom; it keeps that detail level here.
      const flora = trees.includes(blueprint), factor = flora ? 2 : 1;
      const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision, ...(factor === 1 ? {} : { lodFactor: factor }) });
      if (result?.kind !== 'asset') throw new Error(`Could not build ${blueprint.id}`);
      instance(blueprint, geometryFromChunks(result.chunks, 'build'), flora ? treePlaces[trees.indexOf(blueprint)]! : placements.filter(place => place.blueprint.id === blueprint.id), factor);
      options.onProgress(`Raising the street · ${++built}/${assets.length}`);
    });
    const abort = new AbortController(); cleanups.push(() => abort.abort());
    work.push(loadTerrain(plan, undefined, { signal: abort.signal }).then(({ chunks, origin }) => {
      for (const tile of terrainBatches(chunks)) {
        const geometry = geometryFromChunks(tile, 'terrain'); geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);
        geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere()); geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, ground.material); mesh.position.set(...origin); scene.add(mesh); shadows.register(mesh);
      }
    }));
    const water = own(createWater(scene, { lake: plan.lake, terrain: { data: heightData, width: heightWidth, height: heightDepth, origin: heightOrigin, step: 1 } }));
    await Promise.all(work);
    options.onProgress('Fitting the neighbours');
    const citizens = own(await createCitizenRenderer(scene, { registry: MATERIALS, material: avatar, looks, capacity: streetSlots.length, pool }));
    const blobGeometry = own(new THREE.CircleGeometry(.29, 12)); blobGeometry.rotateX(-Math.PI / 2);
    const blobMaterial = own(new THREE.MeshBasicMaterial({ color: '#252a24', transparent: true, opacity: .22, depthWrite: false }));
    const blobs = own(new THREE.InstancedMesh(blobGeometry, blobMaterial, streetSlots.length)); blobs.count = 0; blobs.frustumCulled = false; scene.add(blobs);
    const fog = new THREE.FogExp2(0x000000, .0016); scene.fog = fog;

    // Camera framing comes only from the actual sample positions supplied by the bench.
    const doors = streetSlots.map(slot => plan.homes.find(home => home.slot === slot)!.position);
    const streetCentre = new THREE.Vector3(doors.reduce((s, p) => s + p[0], 0) / doors.length, 0, doors.reduce((s, p) => s + p[2], 0) / doors.length);
    streetCentre.y = terrainHeight(plan, streetCentre.x, streetCentre.z);
    const eye = new THREE.Vector3(), target = new THREE.Vector3(), anchor = new THREE.Vector3(), follow = new THREE.Vector3(), look = new THREE.Vector3();
    let hour = options.hour, view: BenchView = 'doorstep', focus: BenchFocus | null = null, litKey = '', lastField = -Infinity;
    const blocked = (x: number, z: number, margin = .6): boolean => plan.reservations.some(({ lot }) => x > lot.minX - margin && x < lot.maxX + margin && z > lot.minZ - margin && z < lot.maxZ + margin);
    const townSpan = Math.max(plan.bounds.maxX - plan.bounds.minX, plan.bounds.maxZ - plan.bounds.minZ);
    function place(): void {
      const portrait = canvas.clientWidth < canvas.clientHeight;
      if (view === 'aerial') {
        // The whole inhabited town from above its edge, castle behind: windows read as people.
        const homesCentre = new THREE.Vector3(doors.reduce((s, p) => s + p[0], 0) / doors.length, 0, doors.reduce((s, p) => s + p[2], 0) / doors.length);
        homesCentre.y = terrainHeight(plan, homesCentre.x, homesCentre.z);
        camera.fov = portrait ? 64 : 42;
        target.copy(homesCentre);
        eye.copy(homesCentre).add(new THREE.Vector3(townSpan * .08, townSpan * (portrait ? .42 : .3), townSpan * (portrait ? .2 : .38)));
        anchor.set(0, 0, 0);
      } else if (view === 'market' && focus) {
        // Over the visitor's shoulder into the square: the person, and what they are watching.
        const subject = new THREE.Vector3(...focus.subject), centre = new THREE.Vector3(...focus.other);
        const away = Math.atan2(subject.x - centre.x, subject.z - centre.z), side = portrait ? .3 : .55;
        let azimuth = away + side;
        for (const turn of [side, -side, side * 1.6, -side * 1.6]) {
          const a = away + turn, x = subject.x + Math.sin(a) * 8, z = subject.z + Math.cos(a) * 8;
          if (!blocked(x, z)) { azimuth = a; break; }
        }
        // High and back enough that the square's stalls share the frame with the person watching them.
        const distance = portrait ? 7.4 : 8.6;
        camera.fov = portrait ? 62 : 48;
        eye.set(subject.x + Math.sin(azimuth) * distance, 0, subject.z + Math.cos(azimuth) * distance);
        eye.y = Math.max(terrainHeight(plan, eye.x, eye.z), subject.y) + (portrait ? 4.6 : 4.2);
        target.copy(subject).lerp(centre, portrait ? .38 : .5); target.y = subject.y + .6;
        anchor.copy(subject);
      } else if (view === 'street' || !focus) {
        camera.fov = portrait ? 62 : 46;
        const centre = focus ? new THREE.Vector3(...focus.subject) : streetCentre;
        target.copy(centre).add(new THREE.Vector3(focus ? 0 : -8, 1, 0));
        eye.copy(centre).add(portrait ? new THREE.Vector3(26, 30, -6) : new THREE.Vector3(30, 20, -24));
        anchor.set(0, 0, 0);
      } else {
        // The camera travels with the noticer, so it is placed relative to them. The other person
        // moves relative to that camera; keep their whole passage clear of the lens.
        const subject = new THREE.Vector3(...focus.subject), other = new THREE.Vector3(...focus.other);
        const forward = (heading: number, speed = 1): THREE.Vector2 => new THREE.Vector2(Math.sin(heading) * speed, Math.cos(heading) * speed);
        const relative = forward(focus.otherHeading, focus.otherSpeed).sub(forward(focus.subjectHeading, focus.subjectSpeed));
        const close = view === 'close', span = Math.hypot(other.x - subject.x, other.z - subject.z);
        const middle = subject.clone().lerp(other, close || portrait ? .3 : .42);
        const radius = close ? (portrait ? 3.4 : 3.6) + span * (portrait ? .2 : .35) : (portrait ? 4.2 : 5.4) + span * (portrait ? .35 : .55);
        let best = -Infinity, azimuth = 0;
        for (let i = 0; i < 72; i++) {
          const a = i / 72 * Math.PI * 2, direction = new THREE.Vector2(Math.sin(a), Math.cos(a));
          const x = middle.x + direction.x * radius, z = middle.z + direction.y * radius;
          const toCamera = (from: THREE.Vector3): THREE.Vector2 => new THREE.Vector2(x - from.x, z - from.z).normalize();
          // The noticer's face first, the other person's second; both apart on screen.
          let score = forward(focus.subjectHeading).dot(toCamera(subject)) * 1.4 + forward(focus.otherHeading).dot(toCamera(other)) * .35;
          score -= Math.abs(direction.dot(new THREE.Vector2(other.x - subject.x, other.z - subject.z).normalize())) * .45;
          // Neither person may walk through the lens or stand between it and the noticer.
          const lens = new THREE.Vector2(x, z), face = new THREE.Vector2(subject.x, subject.z), sight = face.clone().sub(lens);
          for (let t = -1.5; t <= 3; t += .25) {
            const passer = new THREE.Vector2(other.x + relative.x * t, other.z + relative.y * t);
            const along = Math.max(0, Math.min(1, passer.clone().sub(lens).dot(sight) / sight.lengthSq()));
            if (passer.distanceTo(lens.clone().addScaledVector(sight, along)) < .85 && along < .97) score -= .9;
            if (passer.distanceTo(lens) < radius * .55) score -= .6;
          }
          for (let t = .2; t <= 1; t += .2) if (blocked(middle.x + direction.x * radius * t, middle.z + direction.y * radius * t)) score -= 3;
          // A wall beside the lens fills the frame's edge even when the sight line is clear.
          if (view === 'follow' && blocked(x, z, 2.4)) score -= 2;
          if (terrainHeight(plan, x, z) > middle.y + 1.2) score -= 3;
          if (score > best) { best = score; azimuth = a; }
        }
        camera.fov = close ? (portrait ? 46 : 34) : portrait ? 52 : 40;
        eye.set(middle.x + Math.sin(azimuth) * radius, 0, middle.z + Math.cos(azimuth) * radius);
        eye.y = Math.max(terrainHeight(plan, eye.x, eye.z), middle.y) + (close ? 1.6 : portrait ? 1.9 : 2.2);
        target.copy(middle).add(new THREE.Vector3(0, close ? 1.05 : .95, 0));
        // Follow the noticer from here on: same screen place, same angle.
        anchor.copy(subject);
      }
      camera.position.copy(eye); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    }
    function resize(): void {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight); place();
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); cleanups.push(() => observer.disconnect()); resize();

    /** Window light follows actual arrival at home, exactly like the kingdom consumer. */
    function lightFrame(frame: KingdomPresenceFrame | null, samples: readonly CitizenMotionSample[], atMs: number): KingdomPresenceFrame | null {
      if (!frame) return null;
      const lit = new Map(samples.filter(sample => sample.homeLit).map(sample => [sample.slot, sample.homeLitAtMs!]));
      return { ...frame, asOf: Math.max(frame.asOf, Math.ceil(atMs)), windows: frame.windows.map(window => ({ ...window,
        since: lit.has(window.slot) ? Math.ceil(lit.get(window.slot)!) : window.since,
        present: window.present && lit.has(window.slot), publicName: window.present && lit.has(window.slot) ? window.publicName : null })) };
    }
    const blob = new THREE.Matrix4();
    return {
      camera,
      setHour(next: number): void { hour = next; },
      setView(next: BenchView, nextFocus: BenchFocus | null): void { view = next; focus = nextFocus; place(); },
      /** Draw one frame. `settle` jumps window fades to their end state for a fixed capture. */
      draw(nowMs: number, elapsedSeconds: number, frame: KingdomPresenceFrame | null, current: BehaviourFrame, settle: boolean): void {
        const grade = getEnvironment(hour);
        clay.setEnvironment(grade); ground.setEnvironment(grade); avatar.setEnvironment({ ...grade, ambientIntensity: Math.max(.65, grade.ambientIntensity) });
        const subject = view !== 'street' && view !== 'aerial' && focus ? current.samples.find(sample => sample.slot === focus!.slot) : undefined;
        follow.set(0, 0, 0);
        if (subject) follow.set(subject.position[0], subject.position[1], subject.position[2]).sub(anchor);
        camera.position.copy(eye).add(follow); look.copy(target).add(follow); camera.lookAt(look); camera.updateMatrixWorld();
        const lights = lightFrame(frame, current.samples, nowMs);
        const key = lights ? lights.windows.filter(window => window.present).map(window => window.slot).join(',') : '';
        if (lights && key !== litKey) { windows.setFrame(lights); litKey = key; lastField = -Infinity; }
        windows.update(settle ? 1 : 1 / 60, hour);
        const now = performance.now();
        if (settle || now - lastField > 240) {
          lastField = now;
          // Centre the near light between eye and subject so the foreground ground is inside it.
          const x = (camera.position.x + look.x) / 2, z = (camera.position.z + look.z) / 2;
          const centre: Vec3 = [x, terrainHeight(plan, x, z), z];
          field.update(centre, windows.getSources()); farField.update(centre, windows.getSources());
        }
        citizens.update(current.samples.map(sample => toCitizenSample(sample, current.overlays.get(sample.slot), looks[sample.slot % looks.length]!.id)), camera);
        blobs.count = 0;
        for (const sample of current.samples) {
          blob.makeScale(1, 1, .8); blob.setPosition(sample.position[0], sample.position[1] + .018, sample.position[2]);
          blobs.setMatrixAt(blobs.count++, blob);
        }
        blobs.instanceMatrix.needsUpdate = true;
        atmosphere.update(hour, elapsedSeconds, camera, new THREE.Vector3(...plan.castle.centre), 0);
        fog.color.set(grade.fog);
        water.update(grade, elapsedSeconds, camera);
        shadows.updateSunDirection(grade.sunDirection);
        renderer.render(scene, camera);
      },
      /** Both light volumes hold the latest window state. Background refinement, not a load gate. */
      get lightSettled(): boolean {
        if (lightError) throw new Error(lightError);
        const done = (stats: typeof field.stats): boolean => stats.publishedRevision === stats.requestedRevision && !stats.busy && !stats.queued;
        return nearBytes > 0 && farBytes > 0 && done(field.stats) && done(farField.stats);
      },
      finish(): void { renderer.getContext().finish(); },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
