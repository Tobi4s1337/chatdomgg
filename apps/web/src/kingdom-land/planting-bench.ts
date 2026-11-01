import { foundPlantingZones, naturalLandHeight, waterSurfaceAt, LAND_FRAME, type TreeZoneKind } from '@chatdom/world';
import { geographyFixture } from './geography-fixture';
import { plantingMapSvg, ZONE_STYLE } from './planting-map';

/**
 * Planting bench: the founded zones and landmarks over the version 2 land, with a SIMULATED town fixture
 * standing in for the street generator's complete reservations. Draws a plan map; it plants no trees.
 *   /src/kingdom-land/planting-bench.html?seed=chatdom
 */
function relief(land: ReturnType<typeof geographyFixture>['land']): string {
  const step = 2, size = (LAND_FRAME.maxX - LAND_FRAME.minX) / step, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!, image = context.createImageData(size, size), ground = land.landform;
  const heights = new Float32Array((size + 1) * (size + 1));
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) heights[i + j * (size + 1)] = naturalLandHeight(ground, LAND_FRAME.minX + i * step, LAND_FRAME.minZ + j * step);
  const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, k) => v + (b[k]! - v) * Math.max(0, Math.min(1, t)));
  const meadow = [176, 192, 124], upland = [192, 186, 122], high = [205, 188, 146], low = [160, 186, 120];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const h = heights[i + j * (size + 1)]!, x = LAND_FRAME.minX + (i + .5) * step, z = LAND_FRAME.minZ + (j + .5) * step;
    const dx = (heights[i + 1 + j * (size + 1)]! - h) / step, dz = (heights[i + (j + 1) * (size + 1)]! - h) / step;
    // Light from the north-west, softened so the plan stays legible.
    const shade = Math.max(.55, Math.min(1.25, 1 + (dx + dz) * -.55));
    let colour = h < 4 ? mix(low, meadow, h / 4) : h < 14 ? mix(meadow, upland, (h - 4) / 10) : mix(upland, high, (h - 14) / 14);
    colour = colour.map(v => v * shade);
    const surface = waterSurfaceAt(ground, x, z);
    if (surface !== null) { const depth = surface - h; colour = mix([120, 168, 176], [56, 102, 124], depth / 2.2); }
    // Faint 2 m contours.
    if (Math.floor(h / 2) !== Math.floor(heights[i + 1 + j * (size + 1)]! / 2) || Math.floor(h / 2) !== Math.floor(heights[i + (j + 1) * (size + 1)]! / 2))
      if (surface === null) colour = colour.map(v => v * .9);
    const k = (i + j * size) * 4;
    image.data[k] = colour[0]!; image.data[k + 1] = colour[1]!; image.data[k + 2] = colour[2]!; image.data[k + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search), seed = params.get('seed') ?? 'chatdom';
  const { plan, land, kept } = geographyFixture(seed);
  const planting = foundPlantingZones(land, plan);
  const image = relief(land), map = document.querySelector<HTMLElement>('#map')!, box = map.getBoundingClientRect();
  map.innerHTML = plantingMapSvg(land, plan, planting, { minX: LAND_FRAME.minX, minZ: LAND_FRAME.minZ, size: LAND_FRAME.maxX - LAND_FRAME.minX },
    { relief: image, width: Math.round(box.width), height: Math.round(box.height), scaleBar: 50 });
  const inset = document.querySelector<HTMLElement>('#inset')!, insetBox = inset.getBoundingClientRect(), c = planting.clearing, span = 104;
  if (insetBox.width > 0) inset.innerHTML = plantingMapSvg(land, plan, planting, { minX: c.centre[0] - span / 2 + 8, minZ: c.centre[1] - span / 2 + 4, size: span },
    { relief: image, width: Math.round(insetBox.width), height: Math.round(insetBox.height), scaleBar: 10 });
  document.querySelector('#inset-caption')!.textContent = `The campfire clearing · ${c.campfire} m fire envelope inside an ${c.radius} m clearing; no crown inside ${c.crownLimit.toFixed(1)} m. The beacon gap stays at least 8 m wide between crowns.`;
  const counts = new Map<TreeZoneKind, { zones: number; area: number }>();
  for (const zone of planting.treeZones) {
    let area = 0;
    for (let i = 0; i < zone.outline.length; i++) { const a = zone.outline[i]!, b = zone.outline[(i + 1) % zone.outline.length]!; area += a[0] * b[1] - b[0] * a[1]; }
    const entry = counts.get(zone.kind) ?? { zones: 0, area: 0 };
    counts.set(zone.kind, { zones: entry.zones + 1, area: entry.area + area / 2 });
  }
  document.querySelector('#legend')!.innerHTML = Object.entries(ZONE_STYLE).map(([kind, style]) => {
    const entry = counts.get(kind as TreeZoneKind);
    return `<li><i style="background:${style.fill};border-color:${style.edge}"></i><span>${style.label}<br><small>${entry ? `${entry.zones} · ${Math.round(entry.area).toLocaleString('en')} m²` : 'none on this land'}</small></span></li>`;
  }).join('') + '<li><i style="background:#3d5a2b;border-radius:50%"></i><span>Elder oak · summit pine<br><small>landmarks, crowns drawn to size</small></span></li>';
  document.querySelector('#fixture')!.textContent = `Seed ${seed}. Today's installed homes re-seated on the new land (${kept} full lots) stand in for the street generator's complete reservations.`;
  document.querySelector('#status')!.textContent = '';
  requestAnimationFrame(() => requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }));
}

main().catch(error => {
  console.error(error);
  (window as Window & { __chatdomLandError?: string }).__chatdomLandError = error instanceof Error ? error.message : String(error);
  document.querySelector('#status')!.textContent = String(error);
});
