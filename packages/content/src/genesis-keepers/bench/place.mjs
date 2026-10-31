/* global navigator:readonly, ResizeObserver:readonly */
// The keepers' places at dusk, drawn through the production voxel mesher, clay, light fields, window lights, sun shadows,
// atmosphere and post stack. Which lamps burn and which windows are lit is SIMULATED host behaviour (a quiet town of a few
// people); the keepers stand where the real round planner puts them and move only through their authored act cycle.
import * as THREE from 'three';
import { createAtmosphere, createPostStack, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool, buildLightVolume, rasterizeLightOccluders } from '@chatdom/voxel';
import { MAT, MATERIALS } from '../../materials';
import { keeperRole } from '../roles/index';
import { actPose } from '../routine';
import { createKeeperFigure } from './figure.mjs';
import { courtBench, placed, tavernBench } from './scene';
import { createCitizenCapeRenderer } from '../../../../../apps/web/src/citizens/capes';

/** A soft round dot, white in the middle: the shared texture of every glow, mote and moth. */
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

export async function runPlace(canvas, { scene: sceneName, hour, query }) {
    if (sceneName !== 'court' && sceneName !== 'tavern')
        throw new Error(`Unknown scene ${sceneName}; choose court, tavern or lineup.`);
    const act = query.get('act') ?? undefined;
    const bench = sceneName === 'court' ? courtBench(hour, act) : tavernBench(hour, act);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
        console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
        throw new Error('A bench shader could not compile');
    };
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(44, 1, 0.1, 900);
    const atmosphere = createAtmosphere(scene);
    const fog = new THREE.FogExp2(0x000000);
    scene.fog = fog;
    const post = createPostStack(renderer, scene, camera, { quality: 'capture', toneMapping: 'aces', fog: 'material' });
    const clay = createVoxelMaterial(MATERIALS, 'build');
    const fine = createVoxelMaterial(MATERIALS, 'avatar');
    const states = [clay, fine];
    const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 256 });
    const sun = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(...bench.shadowBounds.min), new THREE.Vector3(...bench.shadowBounds.max)), resolution: 2048 });
    for (const s of states)
        sun.bindReceiver(s.material);
    const meshBlueprint = async (placement) => {
        const result = await pool.submit({ kind: 'blueprint', blueprint: placement.blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
        if (result?.kind !== 'asset' || !result.chunks.length)
            throw new Error(`Could not mesh ${placement.blueprint.id}`);
        const model = new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), clay.material);
        model.position.set(...placement.origin);
        model.rotation.y = placement.yaw;
        scene.add(model);
        model.updateMatrixWorld(true);
        sun.register(model);
    };
    const tasks = bench.placements.map(meshBlueprint);
    // SIMULATED presence: a few homes lit, through the production window lights.
    const homes = bench.placements.filter(p => bench.homes.includes(p.id));
    const windows = createWindowLights(scene, homes.map((p, slot) => ({ slot, blueprint: p.blueprint, position: p.origin, yaw: p.yaw })), { allWindows: true });
    const asOf = Date.UTC(2026, 9, 31, 19, 30);
    windows.setFrame({ version: 1, kingdomId: 'kingdom_simulated_keepers_bench', epoch: 'sim:keepers-bench', sequence: 1, asOf, origin: 'simulated', streamLive: true, connection: 'fresh',
        windows: homes.map((p, slot) => ({ slot, present: bench.litHomes.includes(p.id), publicName: null, since: asOf - 60_000 })) });
    // The light fields: the burning lamps' warm field and the lit windows, through the production flood.
    const occluders = [];
    for (const p of bench.placements) {
        if (p.id === 'paving')
            continue;
        for (const b of p.blueprint.boxes) {
            if (b.material === MAT.air || b.material === MAT.glass)
                continue;
            const a = placed(p, b.from), c = placed(p, b.to);
            occluders.push({ min: [Math.min(a[0], c[0]), a[1], Math.min(a[2], c[2])], max: [Math.max(a[0], c[0]), c[1], Math.max(a[2], c[2])] });
        }
    }
    const spec = { revision: 1, origin: bench.lightBounds.origin, size: bench.lightBounds.size, cellSize: 0.5 };
    const lampEmitters = bench.lamps.lit.map(position => ({ position, level: 13 }));
    const near = buildLightVolume({ ...spec, occupancy: rasterizeLightOccluders(spec, occluders), emitters: [...lampEmitters, ...windows.getSources().map(s => ({ position: s.position, level: 9 }))] });
    const farSpec = { revision: 1, origin: [-64, -4, -64], size: [64, 24, 64], cellSize: 2 };
    const far = buildLightVolume({ ...farSpec, occupancy: rasterizeLightOccluders(farSpec, []), emitters: lampEmitters.map(e => ({ ...e, level: 9 })) });
    for (const s of states) {
        s.setLight(near);
        s.setBeaconLight(far);
    }
    // The keepers, on the citizens' rig, and the coat tails through main's cape renderer.
    const capes = createCitizenCapeRenderer(scene, { registry: MATERIALS, material: fine, capacity: 4 });
    const figures = [];
    for (const keeper of bench.keepers) {
        tasks.push(createKeeperFigure(pool, fine, keeper.proposal.look).then(figure => {
            const stand = new THREE.Group();
            stand.position.set(...keeper.visit.position);
            stand.rotation.y = keeper.visit.heading;
            stand.add(figure.root);
            scene.add(stand);
            figures.push({ figure, keeper, stand });
        }));
    }
    // Glows: every burning lamp's glass, bright enough for the bloom to take it, and a soft halo.
    const glowTexture = dotTexture(0.22), glows = [];
    const glow = (at, scale, colour, flicker) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        sprite.position.set(...at);
        sprite.scale.setScalar(scale);
        scene.add(sprite);
        glows.push({ sprite, base: scale, flicker, at: new THREE.Vector3(...at) });
    };
    for (const at of bench.lamps.lit) {
        glow(at, 0.5, new THREE.Color(5, 2.6, 0.9), 0.05);
        glow(at, 2.1, new THREE.Color(0.55, 0.28, 0.08), 0.03);
    }
    // Moths round the burning lamps, warm motes in their light, and fireflies low over the grass margins.
    const MOTHS = 9 * bench.lamps.lit.length, MOTES = 26 * bench.lamps.lit.length, FLIES = 40;
    const points = (count, size, colour, map) => {
        const geometry = new THREE.BufferGeometry(), positions = new Float32Array(count * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({ map, size, color: colour, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
        const cloud = new THREE.Points(geometry, material);
        cloud.frustumCulled = false;
        scene.add(cloud);
        return { geometry, positions, material };
    };
    const moths = points(MOTHS, 0.05, new THREE.Color(1.6, 1.3, 1.0), dotTexture(0.6));
    const motes = points(MOTES, 0.035, new THREE.Color(2.2, 1.4, 0.6), dotTexture(0.4));
    const flies = points(FLIES, 0.07, new THREE.Color(2.4, 2.6, 0.7), dotTexture(0.3));
    const fliesBase = Array.from({ length: FLIES }, (_, i) => [-13 + rand(i, 1) * 26, 0.25 + rand(i, 2) * 0.9, (rand(i, 3) < 0.5 ? -11 : 7) + rand(i, 4) * 4]);
    function particles(t) {
        for (let i = 0; i < MOTHS; i++) {
            const lamp = bench.lamps.lit[i % bench.lamps.lit.length], a = t * (1.8 + rand(i, 5) * 1.6) + rand(i, 6) * 6.3;
            const r = 0.28 + rand(i, 7) * 0.32;
            moths.positions.set([lamp[0] + Math.cos(a) * r + 0.06 * Math.sin(t * 9 + i), lamp[1] + 0.12 * Math.sin(a * 1.7) + (rand(i, 8) - 0.4) * 0.4, lamp[2] + Math.sin(a) * r], i * 3);
        }
        moths.geometry.attributes.position.needsUpdate = true;
        for (let i = 0; i < MOTES; i++) {
            const lamp = bench.lamps.lit[i % bench.lamps.lit.length], life = 7 + rand(i, 9) * 5, age = (t + rand(i, 10) * life) % life;
            motes.positions.set([lamp[0] + (rand(i, 11) - 0.5) * 1.6 + 0.1 * Math.sin(age + i), lamp[1] - 1.9 + rand(i, 12) * 1.7 + age * 0.04, lamp[2] + (rand(i, 13) - 0.5) * 1.6], i * 3);
        }
        motes.geometry.attributes.position.needsUpdate = true;
        for (let i = 0; i < FLIES; i++) {
            const b = fliesBase[i], blink = Math.max(0, Math.sin(t * (0.9 + rand(i, 14)) + rand(i, 15) * 6.3));
            flies.positions.set([b[0] + 0.5 * Math.sin(t * 0.31 + i), b[1] + 0.15 * Math.sin(t * 0.7 + i * 2) - (blink < 0.25 ? 100 : 0), b[2] + 0.5 * Math.cos(t * 0.27 + i)], i * 3);
        }
        flies.geometry.attributes.position.needsUpdate = true;
    }
    let view = bench.views.wide;
    const resize = () => {
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        post.resize(canvas.clientWidth, canvas.clientHeight, 1);
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        view = canvas.clientWidth >= canvas.clientHeight ? bench.views.wide : bench.views.tall;
        camera.fov = view.fov;
        camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
    let loaded = false, shadowsSet = false;
    await Promise.all(tasks);
    loaded = true;
    const quiet = new THREE.Vector3(0, -100, 0), target = new THREE.Vector3();
    const stats = {
        scene: sceneName, label: 'SIMULATED', presence: { ...bench.presence, source: 'simulated' },
        keepers: bench.keepers.map(k => ({ id: k.proposal.id, role: k.proposal.keeper.role, name: k.proposal.keeper.name, place: k.proposal.place.name, temperament: k.proposal.temperament, act: k.visit.act.id, carriesPresenceLight: k.proposal.keeper.carriesPresenceLight, intent: k.intent, greeting: k.greeting, look: k.proposal.look.id })),
    };
    return {
        stats,
        render(time) {
            const grade = getEnvironment(hour);
            for (const s of states)
                s.setEnvironment(grade);
            renderer.toneMappingExposure = grade.exposure;
            camera.position.set(...view.eye);
            target.set(...view.target);
            camera.lookAt(target);
            camera.updateMatrixWorld();
            atmosphere.update(hour, time, camera, quiet, 0);
            for (const s of states)
                s.setBeaconSource(quiet.toArray(), 0);
            fog.color.set(grade.fog);
            fog.density = grade.fogDensity;
            if (loaded && !shadowsSet)
                shadowsSet = sun.updateSunDirection(grade.sunDirection) || true;
            // Each glow sits just in front of its glass toward the eye, so the lantern's own panes never hide the light.
            for (const [i, g] of glows.entries()) {
                g.sprite.position.copy(camera.position).sub(g.at).setLength(0.34).add(g.at);
                g.sprite.scale.setScalar(g.base * (1 + g.flicker * Math.sin(time * (6 + i) + i)));
            }
            particles(time);
            capes.beginFrame(time);
            for (const { figure, keeper, stand } of figures) {
                const role = keeperRole(keeper.proposal.keeper.role), visitAct = keeper.visit.act;
                figure.set(actPose(role, visitAct, keeper.proposal.temperament, (time / visitAct.cycle) % 1), visitAct.tool);
                stand.updateMatrixWorld(true);
                if (figure.look.cape)
                    capes.add({ id: keeper.proposal.id, heading: keeper.visit.heading, distance: 0, speed: 0 }, figure.look.cape, figure.attachments.get('back').matrixWorld);
            }
            capes.endFrame();
            windows.update(0, hour);
            post.update({ environment: grade, hour, focusDistance: null, beacon: { position: quiet, strength: 0 } });
            post.render(0);
            Object.assign(stats, { hour, time, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
        },
    };
}
