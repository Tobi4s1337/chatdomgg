import { describe, expect, it } from 'vitest';
import { MAT } from '@chatdom/content';
import { cornerAccessibility, haloIndex, unpackVoxelVertex, type AssetChunkMesh } from '@chatdom/voxel';
import { generateKingdom, terrainHeight, type KingdomLayout } from '@chatdom/world';
import { buildTerrain, prepareTerrainField, sampleRenderedTerrainHeight, terrainChunkRequest,
  TERRAIN_SURFACE_BOUNDS_PADDING, type TerrainWorkerResponse } from './terrain-worker';
import { createSettlementContent } from './settlement-content';

function collect(layout: KingdomLayout): { chunks: AssetChunkMesh[]; messages: TerrainWorkerResponse[]; phaseMs: number[] } {
  const chunks: AssetChunkMesh[] = [], messages: TerrainWorkerResponse[] = [];
  const phaseMs: number[] = [];
  let phaseStart = performance.now();
  buildTerrain(layout, response => {
    messages.push(response);
    if (response.kind === 'chunk' && response.progress.chunk) chunks.push(response.progress.chunk);
    if (response.kind === 'start' || response.kind === 'complete'
      || (response.kind === 'chunk' && response.progress.completed === response.progress.total / 2)) {
      const now = performance.now(); phaseMs.push(now - phaseStart); phaseStart = now;
    }
  });
  return { chunks, messages, phaseMs };
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe('conforming terrain surface', () => {
  it.each(['hamlet','town'] as const)('keeps the current capture seed inside the existing %s height budgets',tier=>{
    const layout=generateKingdom({seed:'willowmere',tier,firstYear:tier==='hamlet'?2025:2022,year:2026});
    const field=prepareTerrainField(layout),width=field.chunkCounts[0]*16+1;
    let contactOffset=0,packedDisplacement=0;
    for(let z=0;z<field.rows-2;z+=2)for(let x=0;x<field.columns-2;x+=2){
      const sample=x/2+width*z/2,column=x+1+field.columns*(z+1);
      const a=field.renderHeights[sample]!,b=field.renderHeights[sample+width]!;
      const c=field.renderHeights[sample+width+1]!,d=field.renderHeights[sample+1]!;
      const rawOwner=field.origin[1]+field.heights[column]!*.5;
      for(const height of [a,b,c,d])packedDisplacement=Math.max(packedDisplacement,Math.abs(height-rawOwner));
      for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++){
        const u=.25+dx*.5,v=.25+dz*.5;
        const height=u<=v?(1-v)*a+(v-u)*b+u*c:(1-u)*a+(u-v)*d+v*c;
        const rawTop=field.origin[1]+field.heights[column+dx+field.columns*dz]!*.5;
        contactOffset=Math.max(contactOffset,Math.abs(height-rawTop));
      }
    }
    expect(contactOffset).toBeLessThan(.4);
    expect(packedDisplacement).toBeLessThanOrEqual(TERRAIN_SURFACE_BOUNDS_PADDING);
    console.info(`Capture terrain ${tier}: max contact offset ${contactOffset.toFixed(4)} m, packed displacement ${packedDisplacement.toFixed(4)} m`);
  });
  it.each(['hamlet','town'] as const)('grounds actual authored %s foundations and street props after placement',tier=>{
    const layout=generateKingdom({seed:'lanternmere',tier,firstYear:tier==='hamlet'?2025:2022,year:2026});
    const content=createSettlementContent(layout),placements=[...content.houses,...content.props];
    let hearthFoundations=0,propFoundations=0;
    for(const placement of placements){
      const {blueprint,position,yaw}=placement,c=Math.cos(yaw),s=Math.sin(yaw);
      for(const box of blueprint.boxes){
        if(box.material===MAT.air||box.from[1]!==0)continue;
        if(blueprint.id.startsWith('home-hearth-'))hearthFoundations++;
        if(blueprint.kind==='prop'||blueprint.kind==='flora')propFoundations++;
        for(const lx of [box.from[0]*.125,box.to[0]*.125])for(const lz of [box.from[2]*.125,box.to[2]*.125]){
          const x=position[0]+lx*c+lz*s,z=position[2]-lx*s+lz*c;
          const ground=sampleRenderedTerrainHeight(layout,x,z);
          invariant(Math.abs(ground-position[1])<1e-6,`${blueprint.id} base misses ground at ${x},${z}: ${ground-position[1]} m`);
        }
      }
    }
    expect(hearthFoundations).toBeGreaterThan(0);
    expect(propFoundations).toBeGreaterThan(0);
  });
  it.each(['hamlet', 'town'] as const)('covers the entire %s with matching shared edges, source materials and shading', tier => {
    const layout = generateKingdom({ seed: 'lanternmere', tier, firstYear: tier === 'hamlet' ? 2025 : 2022, year: 2026 });
    const field = prepareTerrainField(layout), startTime = performance.now(), { chunks, messages, phaseMs } = collect(layout);
    const buildMs = performance.now() - startTime;
    const cellsX = field.chunkCounts[0] * 16, cellsZ = field.chunkCounts[1] * 16;
    const patchOwners = new Set<string>();
    const edges = new Map<string, number>();
    const corners = new Map<string, { height: number; ao: number; sky: number; layers: Set<number> }>();
    const materials = new Set<number>();
    let maxDisplacement = 0, maxContactOffset = 0, shadedCorners = 0, bytes = 0;
    for (const { coordinate, mesh } of chunks) {
      bytes += mesh.vertices.byteLength + mesh.indices.byteLength;
      expect(mesh.stamp.dependencies).toHaveLength(26);
      expect(mesh.stamp.dependencies.every(dependency => dependency.revision === 1)).toBe(true);
      expect(mesh.vertices.length).toBe(mesh.quadCount * 8);
      expect(mesh.indices.length).toBe(mesh.quadCount * 6);
      for (let offset = 0; offset < mesh.vertices.length; offset += 8) {
        const vertices = [0, 1, 2, 3].map(corner => {
          const packed = unpackVoxelVertex(mesh.vertices[offset + corner * 2]!, mesh.vertices[offset + corner * 2 + 1]!);
          invariant(packed.face === 2, 'Only the heightfield top may be rendered');
          const x = coordinate[0] * 16 + packed.x / 2, z = coordinate[2] * 16 + packed.z / 2;
          const rawY = field.origin[1] + coordinate[1] * 16 + packed.y / 2;
          const height = Math.fround(terrainHeight(layout, field.origin[0] + x, field.origin[2] + z));
          maxDisplacement = Math.max(maxDisplacement, Math.abs(height - rawY));
          const key = `${x},${z}`, existing = corners.get(key);
          if (existing) {
            invariant(height === existing.height && packed.ao === existing.ao && packed.sky === existing.sky,
              `Shared position/shading differs at ${key}`);
            existing.layers.add(coordinate[1]);
          } else corners.set(key, { height, ao: packed.ao, sky: packed.sky, layers: new Set([coordinate[1]]) });
          if (packed.ao < 3) shadedCorners++;
          return { ...packed, key, height };
        });
        const a = vertices[0]!, b = vertices[1]!, c = vertices[2]!, d = vertices[3]!;
        // Packed x/z are chunk local; shared corner keys above use global metres.
        invariant(b.x === a.x && b.z === a.z + 2 && c.x === a.x + 2 && c.z === a.z + 2 && d.x === a.x + 2 && d.z === a.z,
          `Nonconforming patch at ${a.key}`);
        invariant(!patchOwners.has(a.key), `Duplicate patch at ${a.key}`); patchOwners.add(a.key);
        const column = coordinate[0] * 32 + a.x + 1 + field.columns * (coordinate[2] * 32 + a.z + 1);
        const source = [field.surfaces[column]!, field.surfaces[column + 1]!,
          field.surfaces[column + field.columns]!, field.surfaces[column + field.columns + 1]!];
        invariant(source.includes(a.material) && vertices.every(vertex => vertex.material === a.material), 'Material must come from the source voxels');
        invariant(source.filter(value => value === a.material).length === Math.max(...source.map(candidate => source.filter(value => value === candidate).length)),
          'Surface material must represent the dominant source material');
        // At each authoritative column centre the smoothed skin stays near the quantized top.
        // The larger render-bounds displacement comes only from a 1 m patch's packed owner Y.
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
          const u = 0.25 + dx * 0.5, v = 0.25 + dz * 0.5;
          const contact = u <= v ? (1 - v) * a.height + (v - u) * b.height + u * c.height
            : (1 - u) * a.height + (u - v) * d.height + v * c.height;
          const solidTop = field.origin[1] + field.heights[column + dx + field.columns * dz]! / 2;
          maxContactOffset = Math.max(maxContactOffset, Math.abs(contact - solidTop));
        }
        materials.add(a.material);
        for (let corner = 0; corner < 4; corner++) {
          const p = vertices[corner]!.key, q = vertices[(corner + 1) % 4]!.key;
          const key = p < q ? `${p}:${q}` : `${q}:${p}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
        const base = offset / 2;
        const expected = [base, base + 1, base + 2, base, base + 2, base + 3], index = offset / 8 * 6;
        invariant(expected.every((value, i) => mesh.indices[index + i] === value), 'Wrong winding or triangle diagonal');
      }
    }
    expect(patchOwners.size).toBe(cellsX * cellsZ);
    expect(corners.size).toBe((cellsX + 1) * (cellsZ + 1));
    let perimeterEdges = 0;
    for (const [key, count] of edges) {
      const [a, b] = key.split(':').map(point => point.split(',').map(Number));
      const boundary = (a![0] === b![0] && (a![0] === 0 || a![0] === cellsX))
        || (a![1] === b![1] && (a![1] === 0 || a![1] === cellsZ));
      invariant(count === (boundary ? 1 : 2), `Open or overlapping edge at ${key}`);
      if (boundary) perimeterEdges++;
    }
    expect(perimeterEdges).toBe(2 * (cellsX + cellsZ));
    expect([...corners.values()].some(corner => corner.layers.size > 1)).toBe(true);
    expect(materials).toEqual(new Set([MAT.grass, MAT.paving, MAT.waterbed]));
    expect(shadedCorners).toBeGreaterThan(0);
    expect(maxDisplacement).toBeLessThanOrEqual(TERRAIN_SURFACE_BOUNDS_PADDING);
    expect(maxContactOffset).toBeLessThan(0.4);
    expect(bytes).toBe(cellsX * cellsZ * 56);
    // Ordered observable progress includes occupancy/AO preparation and the final surface pass.
    const start = messages[0]!, last = messages.at(-1)!;
    expect(start.kind).toBe('start');
    expect(last.kind).toBe('complete');
    if (start.kind !== 'start' || last.kind !== 'complete') throw new Error('Missing worker lifecycle');
    expect(last.completed).toBe(start.total);
    for (let index = 1; index < messages.length - 1; index++) {
      const message = messages[index]!;
      expect(message.kind).toBe('chunk');
      if (message.kind === 'chunk') expect(message.progress.completed).toBe(index);
    }
    console.info(`Terrain ${tier}: ${cellsX * cellsZ * 2} triangles, ${bytes} transfer bytes, max packed displacement ${maxDisplacement.toFixed(4)} m, voxel-centre contact offset ${maxContactOffset.toFixed(4)} m, worker ${buildMs.toFixed(0)} ms (prepare/occupancy/surface ${phaseMs.map(ms => ms.toFixed(0)).join('/')} ms)`);
  }, 60_000);

  it('derives surface AO from authoritative voxel columns across a chunk seam', () => {
    const layout = generateKingdom({ seed: 'terrain-ao', tier: 'hamlet', firstYear: 2025, year: 2026 });
    // Keep the fixture small while crossing both a horizontal and a vertical chunk seam.
    layout.bounds = { minX: 80, maxX: 112, minZ: 64, maxZ: 96 };
    const field = prepareTerrainField(layout), { chunks } = collect(layout);
    let checked = 0;
    for (const { coordinate, mesh } of chunks) for (let offset = 0; offset < mesh.vertices.length; offset += 2) {
      const vertex = unpackVoxelVertex(mesh.vertices[offset]!, mesh.vertices[offset + 1]!);
      const x = coordinate[0] * 32 + vertex.x, z = coordinate[2] * 32 + vertex.z;
      if (x !== 32 || z < 2 || z > 62) continue;
      let ao = 0;
      for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
        const cx = x + dx, cz = z + dz;
        const top = field.heights[cx + 1 + field.columns * (cz + 1)]!;
        const solid = (sx: number, sz: number): boolean => field.heights[sx + 1 + field.columns * (sz + 1)]! > top;
        const sideX = dx === -1 ? 1 : -1, sideZ = dz === -1 ? 1 : -1;
        ao += cornerAccessibility(solid(cx + sideX, cz), solid(cx, cz + sideZ), solid(cx + sideX, cz + sideZ));
      }
      expect(vertex.ao).toBe(Math.round(ao / 4));
      expect(vertex.sky).toBe(15);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('uses matching raw occupancy on both sides of chunk halos and preserves road solidity', () => {
    const layout = generateKingdom({ seed: 'occupancy', tier: 'hamlet', firstYear: 2025, year: 2026 });
    const field = prepareTerrainField(layout);
    const a = terrainChunkRequest(field, [5, 1, 6]), b = terrainChunkRequest(field, [6, 1, 6]);
    for (let z = -1; z <= 32; z++) for (let y = -1; y <= 32; y++) {
      expect(a.halo[haloIndex(31, y, z)]).toBe(b.halo[haloIndex(-1, y, z)]);
      expect(a.halo[haloIndex(32, y, z)]).toBe(b.halo[haloIndex(0, y, z)]);
    }
    const roadColumn = field.surfaces.findIndex(surface => surface === MAT.paving);
    expect(roadColumn).toBeGreaterThan(-1);
    expect(field.heights[roadColumn]).toBeGreaterThan(0);
  });

  it('samples the actual triangle plane at negative coordinates and along both diagonal sides', () => {
    const layout = generateKingdom({ seed: 'contact', tier: 'hamlet', firstYear: 2025, year: 2026 });
    for (const [x, z] of [[-43.2, -24.7], [43.7, 83.2], [-11.5, -83.5], [5, -4]] as const) {
      const left = Math.floor(x), back = Math.floor(z), u = x - left, v = z - back;
      const h = (dx: number, dz: number): number => Math.fround(terrainHeight(layout, left + dx, back + dz));
      const expected = u <= v ? (1 - v) * h(0, 0) + (v - u) * h(0, 1) + u * h(1, 1)
        : (1 - u) * h(0, 0) + (u - v) * h(1, 0) + v * h(1, 1);
      expect(sampleRenderedTerrainHeight(layout, x, z)).toBeCloseTo(expected, 12);
    }
    expect(() => sampleRenderedTerrainHeight(layout, NaN, 0)).toThrow('finite coordinates');
  });
});
