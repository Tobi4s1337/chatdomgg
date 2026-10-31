/* global location:readonly, navigator:readonly, requestAnimationFrame:readonly, ResizeObserver:readonly, URLSearchParams:readonly */
// The Genesis landmark bench: the harbour watchtower the adapter proposes for the coastal showcase recipe, on a
// SIMULATED headland, drawn through the production voxel mesher, clay and terrain materials, light fields, sun
// shadows, atmosphere, water surface and post stack. The lanterns burn as they would with people about, the beacon
// as it would under a full kingdom, and the flag moves on its hoist: all SIMULATED host behaviour shown to judge the
// piece, not a claim about any kingdom. Served by the Vite dev server only (capture.mjs); the app never loads it.
import * as THREE from 'three';
import { createAtmosphere, createPostStack, createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool, buildLightVolume, rasterizeLightOccluders } from '@chatdom/voxel';
import { MAT, MATERIALS } from '../../materials';
import { groundMaterial, meshGround } from '../../../../../apps/web/src/places/water/surface-bench/ground';
import { createWaterSurface } from '../../../../../apps/web/src/places/water/surface/index';
import { CELL, harbourBench } from './scene';
const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const fail = (error) => {
    console.error('Landmark bench failed', error);
    document.body.dataset.error = error instanceof Error ? error.message : String(error);
};
const number = (name, fallback) => {
    const raw = query.get(name), value = raw === null ? fallback : Number(raw);
    if (!Number.isFinite(value))
        throw new Error(`${name} must be a number, not "${raw}".`);
    return value;
};
/** A soft round dot, white in the middle: the shared texture of every glow, ember and puff of smoke. */
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
    let hour = number('hour', 20.4), time = number('time', 42);
    const bench = harbourBench(), { proposal } = bench, piece = proposal.piece;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
        console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
        throw new Error('A bench shader could not compile');
    };
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(44, 1, 0.15, 1600);
    const atmosphere = createAtmosphere(scene);
    const fog = new THREE.FogExp2(0x000000);
    scene.fog = fog;
    const post = createPostStack(renderer, scene, camera, { quality: 'capture', toneMapping: 'aces', fog: 'material' });
    const clay = createVoxelMaterial(MATERIALS, 'build');
    // The flag's own clay: the same material with its cloth lifted on a travelling wave away from the hoist.
    const cloth = createVoxelMaterial(MATERIALS, 'build');
    cloth.material.uniforms.uWind = { value: 0 };
    cloth.material.vertexShader = cloth.material.vertexShader
        .replace('uniform float uScale;', 'uniform float uScale; uniform float uWind;')
        .replace('vec4 world=modelMatrix*local;', 'float fly=local.x/2.75;local.z+=fly*(.32*sin(local.x*3.1-uWind*5.3)+.1*sin(local.x*7.3-uWind*8.9+local.y*2.));local.y-=fly*fly*.18;vec4 world=modelMatrix*local;');
    if (!cloth.material.vertexShader.includes('uWind*5.3'))
        throw new Error('The flag wave could not be fitted to the clay shader.');
    // The lantern floats are avatar-lattice content, drawn with that lattice's own clay.
    const fine = createVoxelMaterial(MATERIALS, 'avatar');
    const states = [clay, cloth, fine];
    const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 256 });
    const mesh = async (blueprint) => {
        const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
        if (result?.kind !== 'asset' || !result.chunks.length)
            throw new Error(`Could not mesh ${blueprint.id}`);
        return geometryFromChunks(result.chunks, 'build');
    };
    const { ground, sea, tower } = bench;
    const made = groundMaterial(ground, sea.level);
    states.push(made.state);
    const sun = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(...bench.shadowBounds.min), new THREE.Vector3(...bench.shadowBounds.max)), resolution: 2048 });
    for (const s of states)
        sun.bindReceiver(s.material);
    const water = createWaterSurface({ bodies: [sea], reaches: [], ground: { data: ground.data, width: ground.width, height: ground.depth, origin: ground.origin, step: ground.step }, outsideGroundHeight: -8, quality: 'full' });
    scene.add(water.root);
    // World positions of the piece's own anchors.
    const world = (cells) => [tower[0] + cells[0] * CELL, tower[1] + cells[1] * CELL, tower[2] + cells[2] * CELL];
    const beacon = world(piece.emitters.find(e => e.id === 'beacon').position);
    const lanterns = piece.emitters.filter(e => e.kind === 'lantern').map(e => world(e.position));
    // The light fields, through the production flood: the lanterns' warm field round the door and the beacon's
    // coarse field over the headland. Occluders are the tower's own solid boxes.
    const occluders = piece.blueprint.boxes.filter(b => b.material !== MAT.air).map(b => ({ min: world(b.from), max: world(b.to) }));
    const field = (spec, emitters) => buildLightVolume({ ...spec, occupancy: rasterizeLightOccluders(spec, occluders), emitters });
    const near = field({ revision: 1, origin: [-16, -1, -12], size: [64, 32, 64], cellSize: 0.5 }, lanterns.map(position => ({ position, level: 13 })));
    const far = field({ revision: 1, origin: [-48, -4, -48], size: [48, 24, 48], cellSize: 2 }, [{ position: [beacon[0], beacon[1] + 0.6, beacon[2]], level: 13 }]);
    for (const s of states) {
        s.setLight(near);
        s.setBeaconLight(far);
    }
    // Statics, the boat that rides the swell, and the flag on its hoist.
    const boats = [];
    const tasks = bench.placements.map(async (placement) => {
        const model = new THREE.Mesh(await mesh(placement.blueprint), clay.material);
        model.position.set(...placement.origin);
        model.rotation.y = placement.yaw;
        scene.add(model);
        model.updateMatrixWorld(true);
        sun.register(model);
        if (placement.bob)
            boats.push({ mesh: model, base: placement.origin, yaw: placement.yaw });
    });
    const part = piece.parts.find(p => p.id === 'flag'), hoist = piece.mounts.find(m => m.id === part.mount);
    const flagPivot = world(hoist.position), flagLocal = part.pivot.map(v => v * CELL);
    let flag = null;
    tasks.push(mesh(part.blueprint).then(geometry => {
        flag = new THREE.Mesh(geometry, cloth.material);
        flag.matrixAutoUpdate = false;
        scene.add(flag);
        sun.register(flag);
    }));
    // SIMULATED lantern floats on the basin, as citizens would set them down: they drift and ride the swell.
    const AVATAR = 0.0625, floats = [];
    for (const f of bench.floats) {
        const body = f.critter.parts[0];
        tasks.push(pool.submit({ kind: 'asset', asset: body.asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }).then(result => {
            if (result?.kind !== 'asset' || !result.chunks.length)
                throw new Error(`Could not mesh ${f.id}`);
            const mesh = new THREE.Mesh(geometryFromChunks(result.chunks, 'avatar'), fine.material);
            mesh.matrixAutoUpdate = false;
            scene.add(mesh);
            sun.register(mesh);
            floats.push({ ...f, mesh, pivot: body.pivot.map(v => v * AVATAR), light: f.critter.light.map(v => v * AVATAR) });
        }));
    }
    tasks.push(meshGround(pool, ground, made, (x, z, h) => h < sea.level + 0.05 || water.waterAt(x, z) !== null).then(land => { scene.add(land); land.updateMatrixWorld(true); sun.register(land); }));
    // Glows: each lantern's glass and the beacon's fire, bright enough for the bloom to take them.
    const glowTexture = dotTexture(0.22), glows = [];
    const glow = (at, scale, colour, flicker) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        sprite.position.set(...at);
        sprite.scale.setScalar(scale);
        scene.add(sprite);
        const made = { sprite, base: scale, flicker };
        glows.push(made);
        return made;
    };
    for (const at of lanterns) {
        glow(at, 0.55, new THREE.Color(5, 2.6, 0.9), 0.06);
        glow(at, 2.2, new THREE.Color(0.55, 0.28, 0.08), 0.03);
    }
    glow([beacon[0], beacon[1] + 0.35, beacon[2]], 1.6, new THREE.Color(7, 3.2, 0.8), 0.12);
    glow([beacon[0], beacon[1] + 0.6, beacon[2]], 6.5, new THREE.Color(0.9, 0.42, 0.1), 0.08);
    // Embers lifting off the beacon and smoke that curls away downwind.
    const EMBERS = 70, SMOKE = 34, wind = new THREE.Vector3(-0.9, 0, -0.25).normalize();
    const emberGeometry = new THREE.BufferGeometry(), emberPositions = new Float32Array(EMBERS * 3);
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
    const embers = new THREE.Points(emberGeometry, new THREE.PointsMaterial({ map: dotTexture(0.3), size: 0.16, color: new THREE.Color(6, 2.4, 0.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    embers.frustumCulled = false;
    scene.add(embers);
    const smokeGeometry = new THREE.BufferGeometry(), smokePositions = new Float32Array(SMOKE * 3), smokeColours = new Float32Array(SMOKE * 4);
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
    smokeGeometry.setAttribute('color', new THREE.BufferAttribute(smokeColours, 4));
    const smoke = new THREE.Points(smokeGeometry, new THREE.PointsMaterial({ map: dotTexture(0.5), size: 2.4, vertexColors: true, transparent: true, depthWrite: false }));
    smoke.frustumCulled = false;
    scene.add(smoke);
    function particles(t) {
        for (let i = 0; i < EMBERS; i++) {
            const life = 3.2 + rand(i, 1) * 2.4, age = (t + rand(i, 2) * life) % life, a = age / life;
            const swirl = rand(i, 3) * Math.PI * 2 + age * (1.4 + rand(i, 4));
            const rise = age * (1.5 + rand(i, 5) * 1.1);
            emberPositions.set([
                beacon[0] + Math.cos(swirl) * 0.35 * (0.4 + a) + wind.x * rise * 0.55,
                beacon[1] + 0.2 + rise - a * a * 0.6,
                beacon[2] + Math.sin(swirl) * 0.35 * (0.4 + a) + wind.z * rise * 0.55,
            ], i * 3);
            if (a > 0.92 || rand(i, 6) < 0.15 && a > 0.6)
                emberPositions[i * 3 + 1] = -100;
        }
        emberGeometry.attributes.position.needsUpdate = true;
        for (let i = 0; i < SMOKE; i++) {
            const life = 9 + rand(i, 7) * 4, age = (t + rand(i, 8) * life) % life, a = age / life;
            const curl = Math.sin(age * 0.8 + rand(i, 9) * 6) * (0.4 + a * 1.4);
            const drift = age * age * 0.11 + age * 0.35;
            smokePositions.set([
                beacon[0] + wind.x * drift + wind.z * curl, beacon[1] + 2.4 + age * 0.95, beacon[2] + wind.z * drift - wind.x * curl,
            ], i * 3);
            const grey = 0.32 + rand(i, 10) * 0.08, alpha = 0.34 * Math.sin(Math.PI * Math.min(1, a * 1.15)) * (1 - a * 0.4);
            smokeColours.set([grey, grey * 0.95, grey * 0.92, alpha], i * 4);
        }
        smokeGeometry.attributes.position.needsUpdate = true;
        smokeGeometry.attributes.color.needsUpdate = true;
    }
    let pose = bench.views.wide;
    function resize() {
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        post.resize(canvas.clientWidth, canvas.clientHeight, 1);
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        pose = canvas.clientWidth >= canvas.clientHeight ? bench.views.wide : bench.views.tall;
        camera.fov = pose.fov;
        camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(canvas);
    resize();
    const stats = { ready: false, proposal: proposal.id, blueprint: piece.blueprint.id, crown: proposal.crown, recipeLandmark: proposal.recipeLandmark, label: 'SIMULATED' };
    let loaded = false, drawn = 0, frame = 0, shadowsSet = false;
    void Promise.all(tasks).then(() => { loaded = true; }, fail);
    const beaconVector = new THREE.Vector3(...beacon), target = new THREE.Vector3();
    const pivot = new THREE.Matrix4(), turn = new THREE.Matrix4(), back = new THREE.Matrix4();
    function draw() {
        const grade = getEnvironment(hour);
        for (const s of states)
            s.setEnvironment(grade);
        renderer.toneMappingExposure = grade.exposure;
        camera.position.set(...pose.eye);
        target.set(...pose.target);
        camera.lookAt(target);
        camera.updateMatrixWorld();
        // A full kingdom's beacon (SIMULATED), its flicker a pure function of time.
        const flame = 0.92 + 0.05 * Math.sin(time * 7.3) + 0.03 * Math.sin(time * 13.1);
        // The kingdom beacon's sky column is not drawn: this fire burns in a roofed loft, and the column would stand
        // through the spire and hide the flag. The loft's own glow, embers and smoke carry it instead.
        atmosphere.update(hour, time, camera, beaconVector, 0);
        for (const s of states)
            s.setBeaconSource(beacon, flame);
        fog.color.set(grade.fog);
        fog.density = grade.fogDensity;
        if (loaded && !shadowsSet)
            shadowsSet = sun.updateSunDirection(grade.sunDirection) || true;
        for (const [i, g] of glows.entries())
            g.sprite.scale.setScalar(g.base * (1 + g.flicker * Math.sin(time * (6 + i) + i)));
        particles(time);
        for (const boat of boats) {
            boat.mesh.position.set(boat.base[0], boat.base[1] + 0.05 * Math.sin(time * 1.1), boat.base[2]);
            boat.mesh.rotation.set(0.025 * Math.sin(time * 0.9 + 1), boat.yaw + 0.04 * Math.sin(time * 0.37), 0.04 * Math.sin(time * 1.3));
        }
        for (const [i, f] of floats.entries()) {
            const x = f.at[0] + f.drift[0] * time, z = f.at[1] + f.drift[1] * time;
            const y = sea.level - AVATAR + 0.025 * Math.sin(time * 1.2 + i * 1.7);
            const pivot = new THREE.Matrix4().makeTranslation(x, y, z), back = new THREE.Matrix4().makeTranslation(-f.pivot[0], -f.pivot[1], -f.pivot[2]);
            const sway = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.05 * Math.sin(time * 0.9 + i), f.yaw + 0.02 * time, 0.05 * Math.sin(time * 1.1 + i * 2)));
            f.mesh.matrix.copy(pivot).multiply(sway).multiply(back);
            f.mesh.matrixWorld.copy(f.mesh.matrix);
            f.at3 = new THREE.Vector3(...f.light).applyMatrix4(f.mesh.matrix);
            f.glow ??= [glow([0, 0, 0], 0.32, new THREE.Color(4.2, 2.1, 0.75), 0.08), glow([0, 0, 0], 1.5, new THREE.Color(0.5, 0.24, 0.07), 0.05)];
            for (const g of f.glow)
                g.sprite.position.copy(f.at3);
        }
        if (flag) {
            // The flag streams downwind and swings a little about its hoist.
            const yaw = Math.atan2(wind.z, -wind.x) + Math.PI + 0.12 * Math.sin(time * 0.9) + 0.05 * Math.sin(time * 2.3);
            flag.matrix.copy(pivot.makeTranslation(...flagPivot)).multiply(turn.makeRotationY(yaw)).multiply(back.makeTranslation(-flagLocal[0], -flagLocal[1], -flagLocal[2]));
            flag.matrixWorld.copy(flag.matrix);
            cloth.material.uniforms.uWind.value = time;
        }
        water.update({ time, environment: grade, camera, sources: [
                ...lanterns.map(position => ({ position, strength: 0.85, kind: 'window' })),
                { position: beacon, strength: flame, kind: 'beacon' },
            ] });
        water.reflect({ renderer, scene, camera, frame: ++frame, exclusions: [...atmosphere.reflectionExclusions] });
        post.update({ environment: grade, hour, focusDistance: null, beacon: { position: beaconVector, strength: flame } });
        post.render(0);
        const flagAt = flag ? new THREE.Vector3().setFromMatrixPosition(flag.matrixWorld).toArray() : null;
        Object.assign(stats, { hour, time, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, flag: flagAt, flagVertices: flag ? flag.geometry.attributes.aPacked.count : 0 });
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
    window.__chatdomLandmark = { stats, time: t => { time = t; }, hour: h => { hour = h; } };
}
catch (error) {
    fail(error);
}
