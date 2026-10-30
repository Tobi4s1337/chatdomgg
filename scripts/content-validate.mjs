import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const collection = option('--collection') ?? 'core';
// Intermediate lane commits contain only finished models. Final acceptance must omit this flag.
const partial = args.includes('--partial');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const fail = message => { throw new Error(message); };
try {
  const { loadContentCollection } = await server.ssrLoadModule('/packages/content/src/catalogue.ts');
  const { MATERIALS, MAT, STYLES } = await server.ssrLoadModule('/packages/content/src/materials.ts');
  const { VoxelBlueprintSchema, HomeTierSchema, HOME_DEPTH_METRES } = await server.ssrLoadModule('/packages/shared/src/index.ts');
  const { rasterizeBlueprint, prepareAssetChunks, meshVoxelChunk } = await server.ssrLoadModule('/packages/voxel/src/index.ts');
  const blueprints = await loadContentCollection(collection);
  const repeat = await loadContentCollection(collection);
  if (JSON.stringify(blueprints) !== JSON.stringify(repeat)) fail('Collection output is not reproducible.');
  const families = collection === 'homes-hearth' ? ['emberfold', 'bramblecross', 'heatherstead'] : ['gullstep', 'saltbend', 'keelcroft'];
  const forms = ['fence-straight', 'fence-corner', 'fence-end', 'wall-straight', 'wall-corner', 'wall-end', 'flower-pot', 'flower-trough', 'rock-cluster', 'leafy-shrub'];
  const propSizes = [[16,12,4],[16,12,16],[4,12,4],[16,9,4],[16,9,16],[4,10,4],[8,12,8],[16,10,6],[12,7,10],[12,12,12]];
  const expected = collection.startsWith('homes-') ? families.flatMap(family => HomeTierSchema.options.map(tier => `home-${collection.slice(6)}-${family}-${tier}`))
    : collection === 'street-props' ? ['hearth','tide'].flatMap(style => forms.map(form => `street-${style}-${form}`)) : null;
  if (expected) {
    const actual = blueprints.map(b => b.id);
    const wanted = partial ? expected.filter(id => actual.includes(id)) : expected;
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail('Collection count, IDs or ordering do not match the lane contract.');
  }
  if (collection === 'core' && blueprints.length !== 51) fail('Core must contain 45 homes, three castles and three trees.');
  if (collection.startsWith('homes-') || collection === 'street-props') {
    const modulePath = collection === 'street-props' ? '/packages/content/src/props/street/index.ts' : `/packages/content/src/homes/${collection.slice(6)}/index.ts`;
    const module = await server.ssrLoadModule(modulePath);
    for (const b of blueprints) {
      const i = expected.indexOf(b.id);
      const create = collection === 'street-props' ? () => module.createStreetProp(forms[i%10],i<10?'hearth':'tide')
        : () => module[collection === 'homes-hearth'?'createHearthHome':'createTideHome'](HomeTierSchema.options[i%5],Math.floor(i/5));
      if (JSON.stringify(create()) !== JSON.stringify(b) || JSON.stringify(create()) !== JSON.stringify(b)) fail(`${b.id}: factory is not reproducible or differs from BLUEPRINTS.`);
    }
  }
  const civic = collection === 'civic-props', attached = collection === 'forge-pieces';
  if (!partial && civic && blueprints.length !== 20) fail('Civic collection requires twenty finished assets.');
  if (!partial && attached && blueprints.length !== 48) fail('Forge collection requires forty-five pieces and three door leaves.');
  const ids = new Set();
  const registered = new Set(MATERIALS.materials.map(m => m.id));
  if (new Set(MATERIALS.materials.map(m => m.name)).size !== MATERIALS.materials.length) fail('Material names must be unique.');
  if (new Set(Object.values(STYLES).map(kit=>kit.id)).size !== Object.keys(STYLES).length) fail('Style IDs must be unique.');
  const rows = [];
  for (const input of blueprints) {
    const b = VoxelBlueprintSchema.parse(input);
    if (ids.has(b.id)) fail(`Duplicate asset ID ${b.id}`);
    ids.add(b.id);
    const kit = Object.values(STYLES).find(kit => kit.id === b.styleId);
    if (!kit) fail(`${b.id}: unregistered style ${b.styleId}`);
    const lane = collection !== 'core';
    const prop = collection === 'street-props';
    const allowed = new Set([MAT.air, kit.wall, kit.roof, kit.trim, kit.stone, MAT.glass, MAT.earth, MAT.bark, MAT.leaf, MAT.moss, MAT.petal, MAT.blueFlower]);
    if (civic || attached) for (const key of ['brass','cloth','cream','darkStone','thatch']) allowed.add(MAT[key]);
    if (prop) { allowed.delete(kit.wall); allowed.delete(kit.roof); allowed.delete(MAT.glass); }
    for (const box of b.boxes) {
      if (!registered.has(box.material)) fail(`${b.id}: unregistered material ${box.material}`);
      if (lane && !allowed.has(box.material)) fail(`${b.id}: material ${box.material} is outside its style palette.`);
    }
    if (lane) {
      const solids=b.boxes.filter(box=>box.material!==MAT.air).map(box=>JSON.stringify(box));
      if (new Set(solids).size!==solids.length) fail(`${b.id}: duplicate occupied source boxes.`);
    }
    if (lane && b.boxes.length > (prop ? 512 : 2000)) fail(`${b.id}: authored box budget exceeded.`);
    let tier;
    if (collection.startsWith('homes-')) {
      tier = b.id.split('-').at(-1);
      if (b.kind !== 'home' || b.styleId !== collection.slice(6) || JSON.stringify(b.size) !== '[64,160,128]') fail(`${b.id}: wrong home kind, kit or reserved dimensions.`);
      if (!b.windows.length) fail(`${b.id}: a home needs executable presence window anchors.`);
      const rear = 128 - HOME_DEPTH_METRES[tier] * 8;
      if (b.boxes.some(box => box.material !== MAT.air && box.from[2] < rear)) fail(`${b.id}: geometry occupies the locked rear land.`);
    }
    if (prop) {
      const index = forms.findIndex(form => b.id === `street-${b.styleId}-${form}`);
      if (index < 0 || b.kind !== 'prop' || b.windows.length || b.size.some((v, axis) => v > propSizes[index][axis])) fail(`${b.id}: wrong prop kind, dimensions or windows.`);
    }
    const asset = rasterizeBlueprint(b);
    const [sx,sy,sz] = b.size;
    const index = (x,y,z) => x + sx * (y + sy * z);
    const get = (x,y,z) => x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : asset.voxels[index(x,y,z)];
    let occupied = 0, ground = 0;
    const min = [sx,sy,sz], max = [0,0,0];
    for (let z=0;z<sz;z++) for (let y=0;y<sy;y++) for (let x=0;x<sx;x++) if (get(x,y,z)) {
      occupied++; if (y === 0) ground++;
      min[0]=Math.min(min[0],x); min[1]=Math.min(min[1],y); min[2]=Math.min(min[2],z);
      max[0]=Math.max(max[0],x+1); max[1]=Math.max(max[1],y+1); max[2]=Math.max(max[2],z+1);
    }
    if (!occupied || (!attached && !ground)) fail(`${b.id}: empty asset or no ground support.`);
    if (lane && occupied > (prop ? 20_000 : 1_000_000)) fail(`${b.id}: occupied-cell budget exceeded.`);
    if (lane && !attached) {
      // All occupied geometry must connect through face neighbours to a ground cell.
      const visited = new Uint8Array(asset.voxels.length), queue = new Uint32Array(occupied);
      let head=0,tail=0;
      for (let z=0;z<sz;z++) for (let x=0;x<sx;x++) { const i=index(x,0,z); if(asset.voxels[i]) {visited[i]=1;queue[tail++]=i;} }
      while(head<tail) {
        const i=queue[head++], x=i%sx, y=Math.floor(i/sx)%sy, z=Math.floor(i/(sx*sy));
        for(const n of [x>0?i-1:-1,x+1<sx?i+1:-1,y>0?i-sx:-1,y+1<sy?i+sx:-1,z>0?i-sx*sy:-1,z+1<sz?i+sx*sy:-1]) {
          if(n>=0&&!visited[n]&&asset.voxels[n]) {visited[n]=1;queue[tail++]=n;}
        }
      }
      if(tail!==occupied) fail(`${b.id}: ${occupied-tail} occupied cells float without a structural path to ground.`);
    }
    for (const w of b.windows) {
      const horizontal = w.facing === 'south' || w.facing === 'north' ? 0 : 2;
      const normal = horizontal === 0 ? 2 : 0;
      const direction = w.facing === 'south' || w.facing === 'east' ? 1 : -1;
      let glass = 0;
      for(let y=Math.ceil(w.centre[1]-w.height/2);y<w.centre[1]+w.height/2;y++) for(let u=Math.ceil(w.centre[horizontal]-w.width/2);u<w.centre[horizontal]+w.width/2;u++) {
        const cell=[...w.centre];cell[1]=y;cell[horizontal]=u;
        // Metadata lies on the outward face, so positive faces sample the preceding cell.
        cell[normal]=w.centre[normal]-(direction>0?1:0);
        if(get(...cell)===MAT.glass) glass++;
        const outside=w.centre[normal]+(direction<0?-1:0);
        for(let n=outside;n>=0&&n<b.size[normal]&&Math.abs(n-outside)<2;n+=direction) {
          cell[normal]=n;
          if(get(...cell)) fail(`${b.id}/${w.id}: outward window rectangle is obstructed.`);
        }
      }
      if(!glass) fail(`${b.id}/${w.id}: window rectangle has no glass on its facade plane.`);
    }
    if (tier) {
      // Find a 1.25 × 2.5 m entrance volume running from outside into the ground-floor room.
      let passage=false;
      for(let floor=0;floor<12&&!passage;floor++) for(let x=0;x<=sx-10&&!passage;x++) {
        let clear=true, support=0;
        for(let z=sz-1;z>=sz-18&&clear;z--) for(let xx=x;xx<x+10&&clear;xx++) {
          if(get(xx,floor,z)) support++;
          for(let y=floor+1;y<=floor+20;y++) if(get(xx,y,z)) {clear=false;break;}
        }
        if(clear&&support>=40) passage=true;
      }
      if(!passage) fail(`${b.id}: no clear 10×20-cell front passage with floor support in the front eighteen depth cells.`);
    }
    let triangles=0,vertices=0,chunks=0;
    for(const prepared of prepareAssetChunks(asset,MATERIALS.materials,MATERIALS.revision)) {
      const mesh=meshVoxelChunk(prepared); triangles+=mesh.indices.length/3; vertices+=mesh.vertices.length/2;chunks++;
    }
    if(civic && (b.kind!=='civic'||b.windows.length||b.boxes.length>1024||occupied>120000||triangles>120000)) fail(`${b.id}: invalid civic asset or cost.`);
    if(attached && (b.boxes.length>512||occupied>100000||triangles>80000)) fail(`${b.id}: Forge piece exceeds authored cost.`);
    if(lane&&triangles>(prop?40_000:250_000)) fail(`${b.id}: triangle budget exceeded.`);
    rows.push({id:b.id,boxes:b.boxes.length,occupied,windows:b.windows.length,chunks,vertices,triangles,modelDrawBudget:1,bounds:`${min.join(',')}..${max.join(',')}`});
    console.log(`${b.id}: ${occupied} cells · ${triangles} triangles · ${b.boxes.length} boxes`);
  }
  if (collection.startsWith('homes-')) for (let family=0;family<3;family++) for(let tier=1;tier<5;tier++) {
    const previous=blueprints.find(b=>b.id===expected[family*5+tier-1]),next=blueprints.find(b=>b.id===expected[family*5+tier]);
    if(!previous||!next) continue;
    for (const anchor of previous.windows) {
      if (!next.windows.some(window=>JSON.stringify(window)===JSON.stringify(anchor))) fail(`${next.id}: previous-tier window ${anchor.id} moved or disappeared.`);
    }
  }
  console.table(rows);
  console.log(`Validated ${rows.length} real assets in ${collection}${partial ? ' (PARTIAL: full collection count not checked)' : ''}; schema, registry, geometry and mesher checks plus applicable lane rules passed. Draws are a model budget; measured calls require content:render. Geometry checks do not prove an interior route, join compatibility or full structural construction.`);
} catch(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode=1;
} finally { await server.close(); }
