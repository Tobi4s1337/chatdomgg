// A comparison build of this branch with no grand recipe, so every kingdom draws today's land. It relies on the
// GW10 guarantee that a kingdom without a grand recipe renders exactly as before, and exists only for same-pose
// "today beside grand" evidence. Written to an ignored directory, never served as a product.
//
//   nice -n 10 node work/lanes/grand-world/build-today.mjs [--out /tmp/gw-today-dist]
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'vite';

const { values } = parseArgs({ options: { out: { type: 'string', default: '/tmp/gw-today-dist' } } });
const recipes = fileURLToPath(new URL('../../../apps/web/src/kingdom/grand-land/recipes.ts', import.meta.url));
const signature = 'export function grandRecipeFor(kingdomId: string | undefined): GrandLandRecipe | undefined {';
await build({
  root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'warn',
  build: { outDir: values.out, emptyOutDir: true },
  plugins: [{ name: 'today-land-comparison', enforce: 'pre', transform(code, id) {
    if (id.split('?')[0] !== recipes) return;
    if (!code.includes(signature)) throw new Error('grandRecipeFor changed; update the comparison build');
    return { code: code.replace(signature, `${signature}\n  if (kingdomId !== '') return undefined;`), map: null };
  } }],
});
console.log(`today's-land comparison build in ${values.out}`);
