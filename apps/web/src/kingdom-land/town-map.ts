import { waterSurfaceAt, type KingdomGeography, type KingdomTown, type XZ } from '@chatdom/world';

/**
 * Small plan map of the founded town: water, streets by kind, Crown Road, every claimed lot coloured by its
 * quarter, the greens, the square with its sites and the castle. North (-Z) is up; world metres throughout.
 */
const QUARTER_ROOFS = ['#b4553c', '#4f7894', '#7c8f45', '#8e5b86', '#c4873a', '#3f8572', '#a8506e', '#5d6aa8'];
const SITE_FILL: Record<string, string> = {
  forge: '#5b4434', statue: '#c99c3f', well: '#3f7387', stall: '#a8492f', bench: '#7b6043',
};

const polygon = (points: readonly XZ[]) => `M${points.map(([x, z]) => `${x.toFixed(2)} ${z.toFixed(2)}`).join('L')}Z`;
const polyline = (points: readonly (readonly number[])[]) => `M${points.map(p => `${p[0]!.toFixed(2)} ${p[2]!.toFixed(2)}`).join('L')}`;

export function townMapSvg(geography: KingdomGeography, town: KingdomTown, size: number): string {
  const { plan, sites } = town;
  const extents = [...plan.reservations.map(plot => plot.lot), plan.castle.bounds];
  let minX = Math.min(...extents.map(b => b.minX)), maxX = Math.max(...extents.map(b => b.maxX));
  let minZ = Math.min(...extents.map(b => b.minZ)), maxZ = Math.max(...extents.map(b => b.maxZ));
  // Room above the castle for its label and around the town for the scale bar and north arrow.
  minZ -= 18;
  const span = Math.max(maxX - minX, maxZ - minZ) + 24;
  minX = (minX + maxX - span) / 2; minZ = (minZ + maxZ - span) / 2; maxX = minX + span; maxZ = minZ + span;
  const unit = span / size, parts: string[] = [];

  // Wet ground on a 3 m lattice, merged into runs along each row.
  const step = 3;
  for (let z = Math.floor(minZ / step) * step; z < maxZ; z += step) {
    let start: number | undefined;
    for (let x = Math.floor(minX / step) * step; x <= maxX + step; x += step) {
      const wet = x <= maxX && waterSurfaceAt(plan.landform, x + step / 2, z + step / 2) !== null;
      if (wet && start === undefined) start = x;
      if (!wet && start !== undefined) { parts.push(`<rect x="${start}" y="${z}" width="${x - start}" height="${step + .3}" class="water"/>`); start = undefined; }
    }
  }
  // The woods' edge.
  const treeline = [...geography.places.forest.treeline].sort((a, b) => a[1] - b[1]);
  parts.push(`<path d="M${minX - 10} ${treeline[0]![1]}${treeline.map(([x, z]) => `L${x} ${z}`).join('')}L${minX - 10} ${treeline.at(-1)![1]}Z" class="woods"/>`);

  const ways = plan.streets.filter(edge => edge.kind !== 'approach');
  for (const edge of plan.streets) if (edge.kind === 'approach') parts.push(`<path d="${polyline(edge.points)}" class="approach"/>`);
  for (const edge of ways) parts.push(`<path d="${polyline(edge.points)}" class="verge" stroke-width="${edge.width + 2 * edge.verge}"/>`);
  for (const edge of ways) parts.push(`<path d="${polyline(edge.points)}" class="${edge.name === 'Crown Road' ? 'crown' : edge.kind}" stroke-width="${edge.width}"/>`);
  for (const green of plan.courts) parts.push(`<path d="${polygon(green.boundary)}" class="green"/>`);
  parts.push(`<path d="${polygon(plan.market.boundary)}" class="market"/>`);
  for (const site of sites) parts.push(`<path d="${polygon(site.footprint)}" fill="${SITE_FILL[site.kind] ?? '#6a5a48'}" class="site"/>`);

  const years = [...new Set(plan.reservations.map(plot => plot.quarterYear))].sort((a, b) => a - b);
  const homes = new Set(plan.homes.map(home => home.id));
  for (const plot of plan.reservations) {
    const colour = QUARTER_ROOFS[years.indexOf(plot.quarterYear) % QUARTER_ROOFS.length];
    parts.push(`<rect x="${plot.lot.minX}" y="${plot.lot.minZ}" width="${plot.lot.maxX - plot.lot.minX}" height="${plot.lot.maxZ - plot.lot.minZ}" fill="${colour}" fill-opacity="${homes.has(plot.id) ? .88 : .3}" class="lot"/>`);
  }
  const { bounds } = plan.castle;
  parts.push(`<rect x="${bounds.minX}" y="${bounds.minZ}" width="${bounds.maxX - bounds.minX}" height="${bounds.maxZ - bounds.minZ}" rx="2" class="castle"/>`);

  const label = (x: number, z: number, text: string) => `<text x="${x.toFixed(1)}" y="${z.toFixed(1)}" font-size="${(11 * unit).toFixed(2)}" class="label">${text}</text>`;
  const heart = plan.nodes.find(node => node.id === 'market')!.position;
  parts.push(label(heart[0], heart[2] - 20, 'Market'), label((bounds.minX + bounds.maxX) / 2, bounds.minZ - 5 * unit, 'Castle'));
  // Scale bar and north.
  const bar = 50, x0 = minX + 14 * unit, z0 = maxZ - 14 * unit;
  parts.push(`<path d="M${x0} ${z0}h${bar}" class="bar" stroke-width="${2.2 * unit}"/>`, label(x0 + bar / 2, z0 - 5 * unit, '50 m'));
  parts.push(`<path d="M${maxX - 18 * unit} ${minZ + 26 * unit}l${5 * unit} ${-14 * unit}l${5 * unit} ${14 * unit}z" class="north"/>`,
    label(maxX - 13 * unit, minZ + 37 * unit, 'N'));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ} ${span} ${span}" width="${size}" height="${size}">
<style>.water{fill:#7aa6b2}.woods{fill:#5d7a4e;opacity:.55}.approach{fill:none;stroke:#cdb892;stroke-width:1.2}
.verge{fill:none;stroke:#d9c9a3;stroke-linecap:round;stroke-linejoin:round}.main,.lane,.crown{fill:none;stroke-linecap:round;stroke-linejoin:round}
.main{stroke:#b89c6c}.lane{stroke:#c8b083}.crown{stroke:#9c7a48}.green{fill:#9fb978;stroke:#6f8a4c;stroke-width:.6}
.market{fill:#e2c88f;stroke:#8f7346;stroke-width:.9}.site{stroke:#3a2c20;stroke-width:.35}.lot{stroke:#3d2f25;stroke-width:.3}
.castle{fill:#8c8178;stroke:#4f463f;stroke-width:.8}.label{fill:#3b2e22;font-family:Georgia,serif;font-weight:600;text-anchor:middle}
.bar{stroke:#3b2e22}.north{fill:#3b2e22}</style>
<rect x="${minX}" y="${minZ}" width="${span}" height="${span}" fill="#eee3c7"/>${parts.join('')}</svg>`;
}
