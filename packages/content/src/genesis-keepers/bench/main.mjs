/* global location:readonly, requestAnimationFrame:readonly, URLSearchParams:readonly */
// The keepers bench. `?scene=lineup` stands every keeper role in each temperament side by side at work; `?scene=court`
// (the default) is the coastal showcase recipe's Bell Court at dusk with its lamplighter on the round, and `?scene=tavern`
// its innkeeper at the inn door. Every scene is SIMULATED: bench ground, bench placements and bench lighting, never a
// claim about any kingdom. Served by the Vite dev server only (capture.mjs); the app never loads it.
import { KEEPER_ROLES } from '../types';
import { runLineup } from './lineup.mjs';

const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const fail = (error) => {
    console.error('Keepers bench failed', error);
    document.body.dataset.error = error instanceof Error ? error.message : String(error);
};
const number = (name, fallback) => {
    const raw = query.get(name), value = raw === null ? fallback : Number(raw);
    if (!Number.isFinite(value))
        throw new Error(`${name} must be a number, not "${raw}".`);
    return value;
};

async function start() {
    const sceneName = query.get('scene') ?? 'court';
    let time = number('time', 12);
    const hour = number('hour', 19.4);
    let view;
    if (sceneName === 'lineup') {
        const role = query.get('role');
        if (role && !KEEPER_ROLES.includes(role))
            throw new Error(`Unknown role ${role}.`);
        const acts = {};
        for (const r of KEEPER_ROLES) {
            const a = query.get(`act-${r}`) ?? (role === r ? query.get('act') : null);
            if (a)
                acts[r] = a;
        }
        view = await runLineup(canvas, { roles: role ? [role] : KEEPER_ROLES, kit: query.get('kit') ?? 'tide', hour, angle: query.get('angle') ?? 'front', acts, phase: number('phase', 0.25) });
    }
    else {
        const { runPlace } = await import('./place.mjs');
        view = await runPlace(canvas, { scene: sceneName, hour, query });
    }
    let drawn = 0;
    const frame = () => {
        try {
            view.render(time);
            if (++drawn === 3)
                window.__chatdomReady = true;
            requestAnimationFrame(frame);
        }
        catch (error) {
            fail(error);
        }
    };
    requestAnimationFrame(frame);
    window.__chatdomKeepers = { stats: view.stats, time: t => { time = t; } };
}
start().catch(fail);
