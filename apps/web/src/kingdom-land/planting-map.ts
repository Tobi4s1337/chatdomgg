import { CROWN_REACH, LANDMARK_CROWN, type KingdomGeography, type PlantingPlan, type PlantingTown, type TreeZoneKind,
  type XZ } from '@chatdom/world';

/**
 * Plan map of where the woods stand: zones as tree-hatched masses, the reach of their crowns as dashed lines,
 * the views kept open as pale corridors and the clearing's envelopes drawn to scale. North (-Z) is up.
 * Pure string output in world metres; the caller supplies the relief image.
 */
export interface MapWindow { minX: number; minZ: number; size: number }

export const ZONE_STYLE: Readonly<Record<TreeZoneKind, { fill: string; edge: string; label: string }>> = {
  'forest-wall': { fill: '#2f5236', edge: '#1d3423', label: 'Forest wall' },
  'clearing-ring': { fill: '#3e6a3c', edge: '#22401f', label: 'Clearing ring' },
  ridge: { fill: '#55703a', edge: '#33461f', label: 'Ridge stands' },
  grove: { fill: '#6c8a3f', edge: '#405423', label: 'Groves on the greens' },
  'stream-alders': { fill: '#3c6e60', edge: '#20453b', label: 'Stream alders' },
  'lake-alders': { fill: '#356b6c', edge: '#1c4344', label: 'Lake alders' },
};

const path = (outline: readonly XZ[]) => `M${outline.map(([x, z]) => `${x.toFixed(2)} ${z.toFixed(2)}`).join('L')}Z`;
const line = (points: readonly XZ[]) => `M${points.map(([x, z]) => `${x.toFixed(2)} ${z.toFixed(2)}`).join('L')}`;
const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function corridor(view: PlantingPlan['sightlines'][number]): XZ[] {
  const [a, b] = [view.from, view.to], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
  const nx = -dz / length, nz = dx / length, [h0, h1] = view.halfWidth;
  return [[a[0] + nx * h0, a[1] + nz * h0], [b[0] + nx * h1, b[1] + nz * h1], [b[0] - nx * h1, b[1] - nz * h1], [a[0] - nx * h0, a[1] - nz * h0]];
}

const VIEW_LABEL: Record<string, string> = {
  'clearing-beacon': '8 m gap · clearing → beacon', 'parapet-lake': 'parapet → lake', 'summit-view': 'summit → town',
  'summit-oak': 'summit → elder oak', 'pier-pine': 'pier → summit pine',
};

export function plantingMapSvg(land: KingdomGeography, town: PlantingTown, planting: PlantingPlan, window: MapWindow,
  options: { relief?: string; width: number; height: number; labels?: boolean; scaleBar?: number }): string {
  const { minX, minZ, size } = window, unit = size / Math.min(options.width, options.height), labels = options.labels ?? true;
  const text = (x: number, z: number, value: string, scale = 1, anchor = 'middle', weight = 600) =>
    `<text x="${x}" y="${z}" font-size="${(13 * unit * scale).toFixed(2)}" text-anchor="${anchor}" font-weight="${weight}" class="label">${escape(value)}</text>`;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ} ${size} ${size}" width="${options.width}" height="${options.height}" preserveAspectRatio="xMidYMid slice">`);
  parts.push(`<defs><style>.label{font-family:Georgia,'Iowan Old Style',serif;fill:#2b2418;paint-order:stroke;stroke:#f4ead2;stroke-width:${(3.2 * unit).toFixed(2)}px;stroke-linejoin:round}</style>`);
  // Each wood is hatched with small crowns, so it reads as trees on the map rather than a flat fill.
  for (const [kind, style] of Object.entries(ZONE_STYLE)) {
    const r = Math.min(CROWN_REACH[kind as TreeZoneKind], 5) * .55;
    parts.push(`<pattern id="crowns-${kind}" width="${r * 3.4}" height="${r * 3}" patternUnits="userSpaceOnUse" patternTransform="rotate(${kind.length * 7})">`
      + `<rect width="${r * 3.4}" height="${r * 3}" fill="${style.fill}" opacity=".78"/>`
      + `<circle cx="${r * .9}" cy="${r}" r="${r * .82}" fill="${style.edge}" opacity=".55"/><circle cx="${r * 2.6}" cy="${r * 2.4}" r="${r * .7}" fill="${style.edge}" opacity=".45"/>`
      + `<circle cx="${r * .75}" cy="${r * .82}" r="${r * .32}" fill="#d9e3b4" opacity=".28"/></pattern>`);
  }
  parts.push('</defs>');
  if (options.relief) parts.push(`<image href="${options.relief}" x="${-240}" y="${-160}" width="480" height="480" preserveAspectRatio="none"/>`);

  // Town: streets under lots, then the founded squares and sites.
  const streetColour = { main: '#e8d9b4', lane: '#e2d1a8', approach: '#dbc89c', trail: '#c9b083' } as const;
  for (const street of town.streets) {
    parts.push(`<path d="${line(street.points.map(p => [p[0], p[2]] as XZ))}" fill="none" stroke="${streetColour[street.kind]}" stroke-width="${street.width}" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>`);
  }
  for (const trail of [land.places.lookout.trail, land.places.forest.path, ...(town.trails ?? []).map(t => t.map(([x, z]) => [x, 0, z] as const))])
    parts.push(`<path d="${line(trail.map(p => [p[0], p[2]] as XZ))}" fill="none" stroke="#b99a6a" stroke-width="1.6" stroke-dasharray="2.4 1.6" stroke-linecap="round"/>`);
  for (const square of [town.market, ...town.courts, land.places.court])
    parts.push(`<path d="${path(square.boundary)}" fill="#e9dcbc" stroke="#b9a37a" stroke-width="${.6 * unit}"/>`);
  for (const plot of town.reservations) {
    const l = plot.lot;
    parts.push(`<rect x="${l.minX}" y="${l.minZ}" width="${l.maxX - l.minX}" height="${l.maxZ - l.minZ}" fill="#f2e6c9" stroke="#a7825a" stroke-width="${.5 * unit}" opacity=".9"/>`);
  }
  const castle = land.castle.bounds;
  parts.push(`<rect x="${castle.minX}" y="${castle.minZ}" width="${castle.maxX - castle.minX}" height="${castle.maxZ - castle.minZ}" fill="#cdbfa3" stroke="#6f6252" stroke-width="${unit}"/>`);
  for (const module of land.castle.modules) {
    const turned = module.rotation % 2 === 1, w = turned ? module.size[2] : module.size[0], d = turned ? module.size[0] : module.size[2];
    const z = module.rotation === 1 ? module.position[2] - d : module.position[2];
    parts.push(`<rect x="${module.position[0]}" y="${z}" width="${w}" height="${d}" fill="#9d9283" stroke="#5a5046" stroke-width="${.5 * unit}"/>`);
  }
  for (const site of land.sites) parts.push(`<path d="${path(site.footprint)}" fill="#a8774b" stroke="#5b3d22" stroke-width="${.5 * unit}"/>`);

  // Kept views: pale corridors the crowns stay out of.
  for (const view of planting.sightlines)
    parts.push(`<path d="${path(corridor(view))}" fill="#f6d27a" opacity=".2" stroke="#b9862d" stroke-width="${.9 * unit}" stroke-dasharray="${5 * unit} ${4 * unit}"/>`);

  // Woods, then how far their crowns can reach.
  for (const zone of planting.treeZones)
    parts.push(`<path d="${path(zone.outline)}" fill="url(#crowns-${zone.kind})" stroke="${ZONE_STYLE[zone.kind].edge}" stroke-width="${.9 * unit}" stroke-linejoin="round"/>`);
  for (const reach of planting.crownReach)
    parts.push(`<path d="${path(reach.outline)}" fill="none" stroke="${ZONE_STYLE[reach.kind].edge}" stroke-width="${.8 * unit}" stroke-dasharray="${2.2 * unit} ${2.2 * unit}" opacity=".85"/>`);

  // The clearing: campfire envelope, the clearing itself and the limit no crown crosses.
  const c = planting.clearing;
  parts.push(`<circle cx="${c.centre[0]}" cy="${c.centre[1]}" r="${c.radius}" fill="#d7c48c" opacity=".55"/>`);
  parts.push(`<circle cx="${c.centre[0]}" cy="${c.centre[1]}" r="${c.campfire}" fill="#ee9a45" opacity=".42" stroke="#b2541c" stroke-width="${unit}"/>`);
  parts.push(`<circle cx="${c.centre[0]}" cy="${c.centre[1]}" r="${c.crownLimit}" fill="none" stroke="#8e3b1d" stroke-width="${1.1 * unit}" stroke-dasharray="${3 * unit} ${2 * unit}"/>`);
  parts.push(`<circle cx="${c.centre[0]}" cy="${c.centre[1]}" r="${1.2}" fill="#fff1c9" stroke="#8e3b1d" stroke-width="${.5 * unit}"/>`);

  // Landmarks: their full crown, trunk and facing.
  for (const tree of planting.landmarks) {
    const [x, , z] = tree.position, r = LANDMARK_CROWN[tree.id];
    parts.push(`<circle cx="${x}" cy="${z}" r="${r}" fill="${tree.id === 'elder-oak' ? '#3d5a2b' : '#24402f'}" opacity=".9" stroke="#14231a" stroke-width="${unit}"/>`);
    parts.push(`<circle cx="${x}" cy="${z}" r="${r * .45}" fill="#7f9b54" opacity=".55"/><circle cx="${x}" cy="${z}" r=".9" fill="#5a3b22"/>`);
    // The oak faces its meadow with local +Z; the pine leans along its local +X.
    const [fx, fz] = tree.id === 'elder-oak' ? [Math.sin(tree.yaw), Math.cos(tree.yaw)] : [Math.cos(tree.yaw), -Math.sin(tree.yaw)];
    parts.push(`<path d="M${x} ${z}L${x + fx * (r + 3)} ${z + fz * (r + 3)}" stroke="#f4ead2" stroke-width="${1.4 * unit}" stroke-linecap="round" marker-end="none"/>`);
  }

  if (labels) {
    const oak = planting.landmarks.find(tree => tree.id === 'elder-oak')!, pine = planting.landmarks.find(tree => tree.id === 'summit-pine')!;
    parts.push(text(oak.position[0] + 11, oak.position[2] + 3, 'Elder oak', 1.05, 'start'));
    parts.push(text(pine.position[0] - 2, pine.position[2] - 9, 'Summit pine', 1.05, 'middle'));
    parts.push(text(c.centre[0], c.centre[1] - c.crownLimit - 3, 'Campfire clearing', 1.05));
    parts.push(text(land.landform.lake.x, land.landform.lake.z + 3, 'Lake', 1.15, 'middle', 500));
    parts.push(text(0, -100, 'Castle', 1.05));
    for (const view of planting.sightlines) {
      const length = Math.hypot(view.to[0] - view.from[0], view.to[1] - view.from[1]);
      const t = view.id === 'clearing-beacon' ? 34 / length : view.id === 'summit-oak' ? .55 : .5;
      const x = view.from[0] + (view.to[0] - view.from[0]) * t, z = view.from[1] + (view.to[1] - view.from[1]) * t;
      let angle = Math.atan2(view.to[1] - view.from[1], view.to[0] - view.from[0]) * 180 / Math.PI;
      if (angle > 90) angle -= 180; else if (angle < -90) angle += 180;
      parts.push(`<g transform="translate(${x.toFixed(2)} ${z.toFixed(2)}) rotate(${angle.toFixed(1)})">${text(0, -2 * unit, VIEW_LABEL[view.id] ?? view.id, .78, 'middle', 500)}</g>`);
    }
  }
  if (options.scaleBar) {
    const x = minX + size * .05, z = minZ + size * .95, length = options.scaleBar;
    parts.push(`<path d="M${x} ${z}h${length}" stroke="#2b2418" stroke-width="${2 * unit}"/><path d="M${x} ${z - 3 * unit}v${6 * unit}M${x + length} ${z - 3 * unit}v${6 * unit}" stroke="#2b2418" stroke-width="${1.2 * unit}"/>`);
    parts.push(text(x + length / 2, z - 6 * unit, `${length} m`, .85));
  }
  parts.push('</svg>');
  return parts.join('');
}
