/* global ResizeObserver:readonly */
// Bench-only: every keeper role in each temperament, side by side at street distance, each at work in one of its acts.
// The figures are keepers, never citizens; the page is labelled SIMULATED. Production code never imports this.
import * as THREE from 'three';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { MAT, MATERIALS } from '../../materials';
import { KEEPER_TEMPERAMENTS } from '../types';
import { keeperRole } from '../roles/index';
import { createKeeperLook } from '../look';
import { actPose } from '../routine';
import { createKeeperFigure } from './figure.mjs';
import { createCitizenCapeRenderer } from '../../../../../apps/web/src/citizens/capes';

const SKINS = [MAT.skin2, MAT.skin5, MAT.skin7, MAT.skin3, MAT.skin8, MAT.skin1, MAT.skin6, MAT.skin4, MAT.skin2];
const HAIRS = [MAT.hairChestnut, MAT.hairSilver, MAT.hairBlack, MAT.hairCopper, MAT.hairBrown, MAT.hairGold, MAT.hairBlack, MAT.hairSilver, MAT.hairBrown];

/** options: { roles, kit, hour, angle: front|side|back, acts: { [role]: actId }, phase (negative plays the cycle) } */
export async function runLineup(canvas, options) {
    const environment = getEnvironment(options.hour);
    document.body.style.background = `linear-gradient(180deg, ${environment.zenith} 0%, ${environment.horizon} 78%, ${environment.fog} 100%)`;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.debug.onShaderError = () => { throw new Error('A keeper bench shader failed to compile.'); };
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const scene = new THREE.Scene();
    const material = createVoxelMaterial(MATERIALS, 'avatar');
    material.setEnvironment(environment);
    const pool = new VoxelWorkerPool({ size: 3 });
    const capes = createCitizenCapeRenderer(scene, { registry: MATERIALS, material, capacity: 16 });
    const entries = [];
    let index = 0;
    for (const role of options.roles) {
        const def = keeperRole(role);
        for (const temperament of KEEPER_TEMPERAMENTS) {
            const look = createKeeperLook({
                role, temperament, kit: options.kit, body: def.bodies[temperament], skin: SKINS[index % SKINS.length],
                hair: { form: def.hairForms[index % def.hairForms.length], swatch: HAIRS[index % HAIRS.length] },
            });
            const figure = await createKeeperFigure(pool, material, look);
            const slot = new THREE.Group();
            const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.12, 28), new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95 }));
            plinth.position.y = -0.06;
            const turn = new THREE.Group();
            turn.add(figure.root);
            slot.add(plinth, turn);
            scene.add(slot);
            entries.push({ figure, role, temperament, slot, turn });
            index++;
        }
    }
    scene.add(new THREE.HemisphereLight(new THREE.Color(environment.zenith), new THREE.Color(environment.fog), 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(...environment.sunDirection);
    scene.add(sun);
    const spacing = 1.45, count = entries.length;
    const yaw = { front: 0.38, side: Math.PI / 2, back: Math.PI - 0.38 }[options.angle] ?? 0.38;
    for (const [i, entry] of entries.entries()) {
        entry.slot.position.set((i - (count - 1) / 2) * spacing, 0, 0);
        entry.turn.rotation.y = yaw;
    }
    const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 200);
    const resize = () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const width = count * spacing + 0.6, fit = Math.max(width / camera.aspect, 3.4);
        const distance = fit / 2 / Math.tan((camera.fov * Math.PI) / 360) + 1;
        camera.position.set(0, 1.35, distance);
        camera.lookAt(0, 1.05, 0);
        camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
    const stats = { scene: 'lineup', label: 'SIMULATED', keepers: entries.map(e => ({ role: e.role, temperament: e.temperament, look: e.figure.look.id, report: e.figure.look.report, triangles: e.figure.stats.triangles })) };
    return {
        stats,
        render(time) {
            capes.beginFrame(time);
            for (const entry of entries) {
                const def = keeperRole(entry.role);
                const act = def.acts.find(a => a.id === options.acts[entry.role]) ?? def.acts[0];
                const phase = options.phase >= 0 ? options.phase : (time / act.cycle) % 1;
                entry.figure.set(actPose(def, act, entry.temperament, phase), act.tool);
                entry.slot.updateMatrixWorld(true);
                if (entry.figure.look.cape)
                    capes.add({ id: entry.figure.look.id, heading: yaw, distance: 0, speed: 0 }, entry.figure.look.cape, entry.figure.attachments.get('back').matrixWorld);
            }
            capes.endFrame();
            renderer.render(scene, camera);
            stats.calls = renderer.info.render.calls;
            stats.triangles = renderer.info.render.triangles;
        },
    };
}
