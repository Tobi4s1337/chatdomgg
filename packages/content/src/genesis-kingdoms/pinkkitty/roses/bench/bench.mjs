/* global location:readonly, navigator:readonly, requestAnimationFrame:readonly, ResizeObserver:readonly, URLSearchParams:readonly */
// The PinkKittyRose roses bench: the rose arch, two river cressets, three planters and the four bushes on a SIMULATED
// river landing, drawn through the production voxel mesher, clay and terrain materials, light field, sun shadows,
// atmosphere, water surface and post stack. The cresset fires burn as a host would mount them (SIMULATED host
// behaviour shown to judge the pieces, not a claim about any kingdom). Served by the Vite dev server only
// (capture.mjs); the app never loads it.
import * as THREE from 'three';
import { createAtmosphere, createPostStack, createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool, buildLightVolume, rasterizeLightOccluders } from '@chatdom/voxel';
import { MAT, MATERIALS } from '../../../../materials';
import { groundMaterial, meshGround } from '../../../../../../../apps/web/src/places/water/surface-bench/ground';
import { createWaterSurface } from '../../../../../../../apps/web/src/places/water/surface/index';
import { CELL, rosesBench } from './scene';

const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const fail = (error) => {
    console.error('Roses bench failed', error);
    document.body.dataset.error = error instanceof Error ? error.message : String(error);
};
const number = (name, fallback) => {
    const raw = query.get(name), value = raw === null ? fallback : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${name} must be a number, not "${raw}".`);
    return value;
};
/** A soft round dot, white in the middle: the texture of every glow and ember. */
function dotTexture(soft) {
    const size = 64, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(soft, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
/** A deterministic hash in [0, 1). */
const rand = (i, salt) => { const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return s - Math.floor(s); };

try {
    let hour = number('hour', 19.9), time = number('time', 42);
    const bench = rosesBench(), { ground, river, fires } = bench;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(44, 1, 0.15, 1600);
    const atmosphere = createAtmosphere(scene);
    const fog = new THREE.FogExp2(0x000000);
    scene.fog = fog;
    const post = createPostStack(renderer, scene, camera, { quality: 'capture', toneMapping: 'aces', fog: 'material' });
    const clay = createVoxelMaterial(MATERIALS, 'build');
    const states = [clay];
    const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 256 });
    const mesh = async (blueprint) => {
        const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
        if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`Could not mesh ${blueprint.id}`);
        return geometryFromChunks(result.chunks, 'build');
    };
    const made = groundMaterial(ground, river.level);
    states.push(made.state);
    const sun = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(...bench.shadowBounds.min), new THREE.Vector3(...bench.shadowBounds.max)), resolution: 2048 });
    for (const s of states) sun.bindReceiver(s.material);
    const water = createWaterSurface({ bodies: [river], reaches: [], ground: { data: ground.data, width: ground.width, height: ground.depth, origin: ground.origin, step: ground.step }, outsideGroundHeight: -8, quality: 'full' });
    scene.add(water.root);

    // The fires' warm field through the production flood, occluded by every placed piece's solid boxes.
    const occluders = [];
    for (const p of bench.placements) for (const b of p.blueprint.boxes) if (b.material !== MAT.air)
        occluders.push({ min: [p.origin[0] + b.from[0] * CELL, p.origin[1] + b.from[1] * CELL, p.origin[2] + b.from[2] * CELL], max: [p.origin[0] + b.to[0] * CELL, p.origin[1] + b.to[1] * CELL, p.origin[2] + b.to[2] * CELL] });
    const field = (spec, emitters) => buildLightVolume({ ...spec, occupancy: rasterizeLightOccluders(spec, occluders), emitters });
    const lift = (p, dy) => [p[0], p[1] + dy, p[2]];
    const near = field({ revision: 1, origin: [-20, -2, -10], size: [80, 32, 64], cellSize: 0.5 }, fires.map(p => ({ position: lift(p, 0.3), level: 13 })));
    const far = field({ revision: 1, origin: [-48, -4, -48], size: [48, 24, 48], cellSize: 2 }, fires.map(p => ({ position: lift(p, 0.3), level: 9 })));
    for (const s of states) { s.setLight(near); s.setBeaconLight(far); }

    const tasks = bench.placements.map(async (placement) => {
        const model = new THREE.Mesh(await mesh(placement.blueprint), clay.material);
        model.position.set(...placement.origin);
        model.rotation.y = placement.yaw;
        scene.add(model);
        model.updateMatrixWorld(true);
        sun.register(model);
    });
    tasks.push(meshGround(pool, ground, made, (x, z, h) => h < river.level + 0.05 || water.waterAt(x, z) !== null).then(land => { scene.add(land); land.updateMatrixWorld(true); sun.register(land); }));

    // The flames a host mounts at each fire point: a hot core, a warm halo, embers lifting and a thread of smoke.
    const glowTexture = dotTexture(0.22), glows = [];
    const glow = (at, scale, colour, flicker) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        sprite.position.set(...at);
        sprite.scale.setScalar(scale);
        scene.add(sprite);
        glows.push({ sprite, base: scale, flicker });
    };
    for (const f of fires) {
        glow(lift(f, 0.22), 0.5, new THREE.Color(7, 3.4, 0.9), 0.1);
        glow(lift(f, 0.42), 0.34, new THREE.Color(6, 2.2, 0.5), 0.14);
        glow(lift(f, 0.35), 2.6, new THREE.Color(0.75, 0.34, 0.09), 0.06);
    }
    const EMBERS = 36, emberGeometry = new THREE.BufferGeometry(), emberPositions = new Float32Array(EMBERS * fires.length * 3);
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
    const embers = new THREE.Points(emberGeometry, new THREE.PointsMaterial({ map: dotTexture(0.3), size: 0.07, color: new THREE.Color(6, 2.4, 0.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    embers.frustumCulled = false;
    scene.add(embers);
    function particles(t) {
        fires.forEach((f, k) => {
            for (let i = 0; i < EMBERS; i++) {
                const n = k * EMBERS + i, life = 1.8 + rand(n, 1) * 1.6, age = (t + rand(n, 2) * life) % life, a = age / life;
                const swirl = rand(n, 3) * Math.PI * 2 + age * 2;
                emberPositions.set([f[0] + Math.cos(swirl) * 0.12 * (0.5 + a), f[1] + 0.3 + age * 0.9, f[2] + Math.sin(swirl) * 0.12 * (0.5 + a)], n * 3);
                if (a > 0.9 || (rand(n, 6) < 0.2 && a > 0.55)) emberPositions[n * 3 + 1] = -100;
            }
        });
        emberGeometry.attributes.position.needsUpdate = true;
    }

    let pose = bench.views.wide;
    function resize() {
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        post.resize(canvas.clientWidth, canvas.clientHeight, 1);
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        const named = bench.views[query.get('view') ?? ''];
        pose = named ?? (canvas.clientWidth >= canvas.clientHeight ? bench.views.wide : bench.views.tall);
        camera.fov = pose.fov;
        camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(canvas);
    resize();
    const stats = { ready: false, scene: 'roses', label: 'SIMULATED', pieces: bench.placements.map(p => ({ id: p.blueprint.id, boxes: p.blueprint.boxes.length })), fires };
    let loaded = false, drawn = 0, frame = 0, shadowsSet = false;
    void Promise.all(tasks).then(() => { loaded = true; }, fail);
    const fireVector = new THREE.Vector3(...fires[0]), target = new THREE.Vector3();
    function draw() {
        const grade = getEnvironment(hour);
        for (const s of states) s.setEnvironment(grade);
        renderer.toneMappingExposure = grade.exposure;
        camera.position.set(...pose.eye);
        target.set(...pose.target);
        camera.lookAt(target);
        camera.updateMatrixWorld();
        const flame = 0.92 + 0.05 * Math.sin(time * 7.3) + 0.03 * Math.sin(time * 13.1);
        atmosphere.update(hour, time, camera, fireVector, 0);
        for (const s of states) s.setBeaconSource(fires[0], 0);
        fog.color.set(grade.fog);
        fog.density = grade.fogDensity;
        if (loaded && !shadowsSet) shadowsSet = sun.updateSunDirection(grade.sunDirection) || true;
        for (const [i, g] of glows.entries()) g.sprite.scale.setScalar(g.base * (1 + g.flicker * Math.sin(time * (6 + i) + i)));
        particles(time);
        water.update({ time, environment: grade, camera, sources: fires.map(p => ({ position: lift(p, 0.35), strength: flame, kind: 'lamp', size: 0.6 })) });
        water.reflect({ renderer, scene, camera, frame: ++frame, exclusions: [...atmosphere.reflectionExclusions] });
        post.update({ environment: grade, hour, focusDistance: null, beacon: { position: fireVector, strength: 0 } });
        post.render(0);
        Object.assign(stats, { hour, time, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
    }
    function render() {
        try {
            draw();
            if (loaded && ++drawn === 3) {
                renderer.getContext().finish();
                stats.ready = true;
                window.__chatdomReady = true;
            }
            requestAnimationFrame(render);
        }
        catch (error) {
            fail(error);
        }
    }
    requestAnimationFrame(render);
    window.__chatdomRoses = { stats, time: t => { time = t; }, hour: h => { hour = h; } };
}
catch (error) {
    fail(error);
}
