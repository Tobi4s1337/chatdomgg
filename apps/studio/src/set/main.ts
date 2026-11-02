// The studio's set pieces: product modules staged by read-only import, for shots the product cannot stage from
// its own routes. `?scene=` picks the module; every module follows the contract in contract.ts.
//
//   /studio/set.html?scene=grand&channel=tobi4s_&path=island-golden
import type { SetModule } from './contract';

const SCENES: Record<string, () => Promise<SetModule>> = {
  grand: () => import('./grand'),
  kingdom: () => import('./kingdom/index'),
  raid: () => import('./raid/index'),
  forge: () => import('./forge/index'),
  atlas: () => import('./atlas/index'),
  growth: () => import('./growth/index'),
};

const query = new URLSearchParams(location.search);
const canvas = document.getElementById('set') as HTMLCanvasElement;
const name = query.get('scene') ?? 'grand';
const load = SCENES[name];
if (!load) throw new Error(`no set piece called ${name}`);
void load().then(module => module.start(query, canvas));
