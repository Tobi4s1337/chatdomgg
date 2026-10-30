/** CPU-only necessary checks, not complete acceptance. Use --svg for diagnostic maps.
 * This does not prove reserved-verge clearance, rendered ground contact, or individual light projection. */
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd(), output = resolve(root, 'shots/kingdom/settlement-audit/audit.json');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const overlap = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
const segmentIntersectsLot = (a, b, lot) => {
  let lo = 0, hi = 1;
  for (const [start, end, min, max] of [[a[0], b[0], lot.minX, lot.maxX], [a[2], b[2], lot.minZ, lot.maxZ]]) {
    const delta = end - start;
    if (delta === 0) { if (start <= min || start >= max) return false; continue; }
    const t0 = (min - start) / delta, t1 = (max - start) / delta;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    if (lo >= hi) return false;
  }
  return true;
};
// Clip to the lot and measure area: boundary-only contact is permitted, while
// coincident polygon edges enclosing positive area must still count as overlap.
const polygonIntersectsLot = (polygon, lot) => {
  let clipped = polygon;
  for (const [axis, bound, sign] of [[0, lot.minX, 1], [0, lot.maxX, -1], [1, lot.minZ, 1], [1, lot.maxZ, -1]]) {
    const input = clipped;
    clipped = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const insideA = sign * (a[axis] - bound) >= 0, insideB = sign * (b[axis] - bound) >= 0;
      if (insideA) clipped.push(a);
      if (insideA !== insideB) {
        const t = (bound - a[axis]) / (b[axis] - a[axis]);
        clipped.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
  }
  let twiceArea = 0;
  for (let i = 0; i < clipped.length; i++) {
    const a = clipped[i], b = clipped[(i + 1) % clipped.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) > 1e-8;
};
// A paved segment has butt ends. Interior polyline vertices add the round joins;
// endpoints remain flush so an approach can terminate at its own frontage.
const pavedIntersectsLot = (edge, lot) => {
  const radius = edge.width / 2;
  if (!(radius > 0) || !Number.isFinite(radius)) return false;
  for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i], dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
    if (!length) continue;
    const x = -dz / length * radius, z = dx / length * radius;
    if (polygonIntersectsLot([[a[0] + x, a[2] + z], [b[0] + x, b[2] + z], [b[0] - x, b[2] - z], [a[0] - x, a[2] - z]], lot)) return true;
  }
  for (let i = 1; i + 1 < edge.points.length; i++) {
    const a = edge.points[i - 1], point = edge.points[i], b = edge.points[i + 1];
    const dx1 = point[0] - a[0], dz1 = point[2] - a[2], dx2 = b[0] - point[0], dz2 = b[2] - point[2];
    const len1 = Math.hypot(dx1, dz1), len2 = Math.hypot(dx2, dz2);
    if (!len1 || !len2) continue;
    const turn = dx1 * dz2 - dz1 * dx2;
    if (Math.abs(turn) < 1e-10 * len1 * len2) {
      // A reversal sweeps a semicircle; a full disk is conservative here.
      if (dx1 * dx2 + dz1 * dz2 >= 0) continue;
      const dx = point[0] - Math.max(lot.minX, Math.min(point[0], lot.maxX));
      const dz = point[2] - Math.max(lot.minZ, Math.min(point[2], lot.maxZ));
      if (dx * dx + dz * dz < radius * radius - 1e-8) return true;
      continue;
    }
    const sign = Math.sign(turn);
    const start = Math.atan2(-sign * dx1, sign * dz1);
    let sweep = Math.atan2(-sign * dx2, sign * dz2) - start;
    while (sign * sweep < 0) sweep += sign * Math.PI * 2;
    const steps = Math.ceil(Math.abs(sweep) / (Math.PI / 64));
    // Tangent intersections circumscribe the arc, avoiding missed sliver overlaps.
    // Excess radial reach is at most radius * (sec(pi/128) - 1).
    const sector = [[point[0], point[2]], [point[0] + radius * Math.cos(start), point[2] + radius * Math.sin(start)]];
    const step = sweep / steps, outerRadius = radius / Math.cos(step / 2);
    for (let j = 0; j < steps; j++) {
      const angle = start + step * (j + .5);
      sector.push([point[0] + outerRadius * Math.cos(angle), point[2] + outerRadius * Math.sin(angle)]);
    }
    const end = start + sweep;
    sector.push([point[0] + radius * Math.cos(end), point[2] + radius * Math.sin(end)]);
    if (polygonIntersectsLot(sector, lot)) return true;
  }
  return false;
};
// Check non-collinear centreline intersections through a 16 m spatial grid.
// Every crossing requires a shared junction; no overpasses are authored.
// Positive-length collinear overlaps are rejected as distinct graph edges.
const checkCrossings = (plan, fail, name) => {
  const grid = new Map(), checked = new Set(), nodes = new Map(plan.nodes.map(node => [node.id, node]));
  const cross = (ax, az, bx, bz) => ax * bz - az * bx;
  let serial = 0;
  for (const edge of plan.streets) for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i], segment = { edge, a, b, serial: serial++ };
    const minX = Math.floor(Math.min(a[0], b[0]) / 16), maxX = Math.floor(Math.max(a[0], b[0]) / 16);
    const minZ = Math.floor(Math.min(a[2], b[2]) / 16), maxZ = Math.floor(Math.max(a[2], b[2]) / 16);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const key = `${x},${z}`, bucket = grid.get(key) ?? [];
      for (const other of bucket) {
        if (other.edge === edge) continue;
        const pair = `${other.serial}:${segment.serial}`;
        if (checked.has(pair)) continue;
        checked.add(pair);
        const c = other.a, d = other.b, rx = b[0] - a[0], rz = b[2] - a[2], sx = d[0] - c[0], sz = d[2] - c[2];
        const denominator = cross(rx, rz, sx, sz);
        if (Math.abs(denominator) < 1e-9) {
          const lengthSquared = rx * rx + rz * rz;
          if (lengthSquared < 1e-18 || Math.abs(cross(c[0] - a[0], c[2] - a[2], rx, rz)) >= 1e-9) continue;
          const t0 = ((c[0] - a[0]) * rx + (c[2] - a[2]) * rz) / lengthSquared;
          const t1 = ((d[0] - a[0]) * rx + (d[2] - a[2]) * rz) / lengthSquared;
          const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
          if ((hi - lo) * Math.sqrt(lengthSquared) > 1e-8)
            fail(name, 'collinear street overlap', { edges: [other.edge.id, edge.id], length: (hi - lo) * Math.sqrt(lengthSquared) });
          continue;
        }
        const t = cross(c[0] - a[0], c[2] - a[2], sx, sz) / denominator;
        const u = cross(c[0] - a[0], c[2] - a[2], rx, rz) / denominator;
        if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
        const y = a[1] + t * (b[1] - a[1]), otherY = c[1] + u * (d[1] - c[1]);
        const shared = [edge.from, edge.to].filter(id => id === other.edge.from || id === other.edge.to);
        const px = a[0] + t * rx, pz = a[2] + t * rz;
        if (!shared.some(id => {
          const node = nodes.get(id);
          return node && Math.hypot(node.position[0] - px, node.position[2] - pz, node.position[1] - y) < 1e-6;
        })) fail(name, 'street crossing lacks junction', { edges: [other.edge.id, edge.id], position: [px, y, pz], heightDifference: Math.abs(y - otherY) });
      }
      bucket.push(segment); grid.set(key, bucket);
    }
  }
};
const byId = (xs, fixture, kind, fail) => {
  const map = new Map();
  for (const item of xs) { if (map.has(item.id)) fail(fixture, `duplicate ${kind} ID`, item.id); map.set(item.id, item); }
  return map;
};
export function audit(plan, name = 'fixture') {
  const failures = [];
  const fail = (fixture, check, detail) => failures.push({ fixture, check, detail });
  const nodes = byId(plan.nodes, name, 'node', fail), edges = byId(plan.streets, name, 'edge', fail);
  const reservations = byId(plan.reservations, name, 'reservation', fail);
  const expectedQuarters = plan.config.year - plan.config.firstYear + 1;
  if (plan.reservations.length !== expectedQuarters * 48) fail(name, 'incorrect reservation count', { actual: plan.reservations.length, expected: expectedQuarters * 48 });
  if (plan.homes.length !== expectedQuarters * (plan.config.tier === 'hamlet' ? 12 : 48)) fail(name, 'incorrect home count', { actual: plan.homes.length, expected: expectedQuarters * (plan.config.tier === 'hamlet' ? 12 : 48) });
  const active = new Set(plan.activeStreetIds), adjacency = new Map();
  for (const id of active) if (!edges.has(id)) fail(name, 'missing active edge', id);
  for (const edge of plan.streets) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to || edge.points.length < 2) { fail(name, 'edge endpoints missing', edge.id); continue; }
    if (dist(edge.points[0], from.position) > 1e-6 || dist(edge.points.at(-1), to.position) > 1e-6)
      fail(name, 'edge/node position mismatch', edge.id);
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i], run = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const grade = run ? Math.abs(b[1] - a[1]) / run : (a[1] === b[1] ? 0 : Infinity);
      const limit = edge.from === plan.castle.gateNodeId || edge.to === plan.castle.gateNodeId || /castle/i.test(edge.id) ? .15 : .12;
      if (!Number.isFinite(grade) || grade > limit + 1e-6) fail(name, 'edge grade exceeds target', { edge: edge.id, segment: i - 1, grade, limit });
    }
    if (active.has(edge.id)) for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const neighbors = adjacency.get(a) ?? []; neighbors.push(b); adjacency.set(a, neighbors);
    }
  }
  const reached = new Set([plan.market.nodeId]), queue = [plan.market.nodeId];
  for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]) ?? []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  if (!reached.has(plan.castle.gateNodeId)) fail(name, 'castle unreachable from market', plan.castle.gateNodeId);
  checkCrossings(plan, fail, name);
  const lake = plan.lake;
  for (const [i, plot] of plan.reservations.entries()) {
    const { lot, position, rotation } = plot, w = lot.maxX - lot.minX, d = lot.maxZ - lot.minZ;
    const expected = rotation % 2 ? [16, 8] : [8, 16];
    if (![0, 1, 2, 3].includes(rotation) || w !== expected[0] || d !== expected[1] || lot.height !== 20 || lot.frontage !== 8 || lot.depth !== 16 || (lot.minX + lot.maxX) / 2 !== position[0] || (lot.minZ + lot.maxZ) / 2 !== position[2]) fail(name, 'invalid full reservation', plot.id);
    for (let j = 0; j < i; j++) if (overlap(lot, plan.reservations[j].lot)) fail(name, 'overlapping reservations', [plot.id, plan.reservations[j].id]);
    if (overlap(lot, plan.castle.bounds)) fail(name, 'reservation intersects castle', plot.id);
    if (polygonIntersectsLot(plan.market.boundary, lot)) fail(name, 'reservation intersects market', plot.id);
    for (const edge of plan.streets) {
      if (pavedIntersectsLot(edge, lot)) fail(name, 'paved street intersects reservation', { plot: plot.id, edge: edge.id });
      for (let s = 1; s < edge.points.length; s++) if (segmentIntersectsLot(edge.points[s - 1], edge.points[s], lot)) {
        fail(name, 'street centreline intersects reservation', { plot: plot.id, edge: edge.id, segment: s - 1 }); break;
      }
    }
    const x = Math.max(lot.minX, Math.min(lake.x, lot.maxX)), z = Math.max(lot.minZ, Math.min(lake.z, lot.maxZ));
    if (Math.hypot((x - lake.x) / lake.radiusX, (z - lake.z) / lake.radiusZ) < .65) fail(name, 'reservation intersects lake interior', plot.id);
  }
  for (const home of plan.homes) {
    const reserved = reservations.get(home.id), edge = edges.get(home.approachId);
    if (!reserved || !equal(home.lot, reserved.lot) || !equal(home.position, reserved.position) || home.rotation !== reserved.rotation) fail(name, 'active home reservation mismatch', home.id);
    if (!edge || !active.has(home.approachId) || !reached.has(edge.from) || !reached.has(edge.to)) fail(name, 'active home unreachable', home.id);
    if (edge) {
      const outward = [[0, 1], [1, 0], [0, -1], [-1, 0]][home.rotation];
      const front = [home.position[0] + outward[0] * 8, home.position[1], home.position[2] + outward[1] * 8];
      if (Math.min(dist(edge.points[0], front), dist(edge.points.at(-1), front)) > 1e-6) fail(name, 'approach misses frontage', home.id);
    }
  }
  const b = plan.bounds, chunks = [Math.ceil((b.maxX - Math.floor(b.minX / 16) * 16) / 16), Math.ceil((b.maxZ - Math.floor(b.minZ / 16) * 16) / 16)];
  if (chunks.some(n => !Number.isFinite(n) || n > 32 || n < 1)) fail(name, 'terrain render chunk limit', chunks);
  let light;
  if (plan.homes.length) {
    const lots = plan.homes.map(h => h.lot), minX = Math.min(...lots.map(l => l.minX)) - 16, maxX = Math.max(...lots.map(l => l.maxX)) + 16, minZ = Math.min(...lots.map(l => l.minZ)) - 16, maxZ = Math.max(...lots.map(l => l.maxZ)) + 16;
    const size = [Math.ceil((maxX - Math.floor(minX / 2) * 2) / 2), 16, Math.ceil((maxZ - Math.floor(minZ / 2) * 2) / 2)];
    light = { bounds: { minX, maxX, minZ, maxZ }, size, cells: size[0] * size[1] * size[2] };
    if (light.cells > 524288) fail(name, '2m house light field cell limit', light);
  } else fail(name, 'no active homes', null);
  return { failures, summary: { homes: plan.homes.length, reservations: plan.reservations.length, edges: plan.streets.length, chunks, light } };
}
export function compare(a, b, name = 'comparison') {
  const failures = [];
  const fail = (fixture, check, detail) => failures.push({ fixture, check, detail });
  if (!equal(a.landform, b.landform) || !equal(a.lake, b.lake) || !equal(a.market, b.market) || !equal(a.castle, b.castle)) fail(name, 'founding geography changed', null);
  for (const key of ['reservations', 'streets', 'nodes', 'courts']) {
    const next = new Map(b[key].map(x => [x.id, x]));
    for (const item of a[key]) if (!equal(item, next.get(item.id))) fail(name, `older ${key} changed or missing`, item.id);
  }
  return failures;
}
export function diagnosticSvg(plan, name) {
  const active = new Set(plan.activeStreetIds), homes = new Set(plan.homes.map(home => home.id)), lake = plan.lake;
  // The diagnostic includes the complete plan, even outside the current render request.
  const extents = [plan.bounds, plan.castle.bounds, ...plan.reservations.map(plot => plot.lot),
    { minX: lake.x - lake.radiusX, maxX: lake.x + lake.radiusX, minZ: lake.z - lake.radiusZ, maxZ: lake.z + lake.radiusZ }];
  for (const edge of plan.streets) for (const point of edge.points) {
    const radius = edge.width / 2;
    extents.push({ minX: point[0] - radius, maxX: point[0] + radius, minZ: point[2] - radius, maxZ: point[2] + radius });
  }
  const b = extents.reduce((bounds, e) => ({ minX: Math.min(bounds.minX, e.minX), maxX: Math.max(bounds.maxX, e.maxX),
    minZ: Math.min(bounds.minZ, e.minZ), maxZ: Math.max(bounds.maxZ, e.maxZ) })), pad = 16;
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const points = ps => ps.map(p => `${p[0]},${p[2]}`).join(' ');
  const polygon = (square, color) => `<polygon points="${square.boundary.map(p => p.join(',')).join(' ')}" fill="${color}" stroke="#574d39" stroke-width=".8"/>`;
  const rect = (lot, color, attrs = '') => `<rect x="${lot.minX}" y="${lot.minZ}" width="${lot.maxX - lot.minX}" height="${lot.maxZ - lot.minZ}" fill="${color}" ${attrs}/>`;
  const years = [...new Set(plan.reservations.map(plot => plot.quarterYear))].sort((a, b) => a - b);
  const palette = ['#a73e39', '#287a93', '#77943b', '#ab6cbd', '#d48a24', '#27846b', '#b35478', '#6073bc'];
  const colors = new Map(years.map((year, i) => [year, palette[i % palette.length]]));
  const ports = new Set((plan.quarters ?? []).flatMap(q => q.growthNodeIds ?? []));
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${b.minZ - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxZ - b.minZ + 2 * pad}">`,
    `<title>${escape(name)} settlement diagnostic; lake ellipse is approximate</title>`,
    `<rect x="${b.minX - pad}" y="${b.minZ - pad}" width="${b.maxX - b.minX + 2 * pad}" height="${b.maxZ - b.minZ + 2 * pad}" fill="#e9e6d6"/>`,
    `<ellipse cx="${lake.x}" cy="${lake.z}" rx="${lake.radiusX}" ry="${lake.radiusZ}" fill="#a0c7d2" stroke="#568d9d" stroke-width="1"/>`,
    ...plan.streets.map(edge => `<polyline data-edge="${escape(edge.id)}" points="${points(edge.points)}" fill="none" stroke="${edge.kind === 'approach' ? '#c66836' : active.has(edge.id) ? '#96754e' : '#c9c1ad'}" stroke-opacity="${active.has(edge.id) ? '1' : '.5'}" stroke-width="${edge.width}" stroke-linecap="butt" stroke-linejoin="round"/>`),
    polygon(plan.market, '#e5bd6d'), ...plan.courts.map(court => polygon(court, '#c8d39a')),
    rect(plan.castle.bounds, '#777381', 'stroke="#392f24" stroke-width=".35"'), polygon(plan.castle.court, '#aaa4a0'),
    ...plan.reservations.map(plot => rect(plot.lot, colors.get(plot.quarterYear), `data-plot="${escape(plot.id)}" data-status="${homes.has(plot.id) ? 'active' : 'reserved'}" fill-opacity="${homes.has(plot.id) ? '.9' : '.24'}" stroke="${colors.get(plot.quarterYear)}" stroke-width=".5" ${homes.has(plot.id) ? '' : 'stroke-dasharray="1,1"'}`)),
    ...plan.nodes.filter(node => node.kind === 'frontier' || ports.has(node.id)).map(node => `<circle data-port="${escape(node.id)}" cx="${node.position[0]}" cy="${node.position[2]}" r="2" fill="#fff" stroke="#29232c" stroke-width=".8"><title>${escape(node.id)}</title></circle>`),
    `<g font-family="sans-serif" font-size="3.5" fill="#222"><rect x="${b.minX - pad}" y="${b.minZ - pad}" width="${Math.max(100, years.length * 17 + 6)}" height="15" fill="#fff" fill-opacity=".88"/>`,
    `<text x="${b.minX - pad + 2}" y="${b.minZ - pad + 4}">${escape(name)} · solid active · pale dashed reserved · orange approach · ○ frontier · lake approximate</text>`,
    ...years.map((year, i) => `<text x="${b.minX - pad + 2 + i * 17}" y="${b.minZ - pad + 10}" fill="${colors.get(year)}">■ ${escape(year)}</text>`), '</g></svg>'];
  return svg.join('\n') + '\n';
}
async function writeDiagnostic(plan, name) {
  const path = resolve(root, `shots/kingdom/settlement-audit/${name}.svg`);
  await mkdir(resolve(root, 'shots/kingdom/settlement-audit'), { recursive: true });
  await writeFile(path, diagnosticSvg(plan, name));
  return path;
}
async function main() {
const report = { passed: false, fixtures: {}, comparisons: {}, failures: [] };
const fail = (fixture, check, detail) => report.failures.push({ fixture, check, detail });
let server;
try {
  server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  const { generateSettlementPlan } = await server.ssrLoadModule('/packages/world/src/settlement/generator.ts');
  const fixtures = { hamlet: { seed: 'lanternmere', tier: 'hamlet', firstYear: 2022, year: 2026 }, town: { seed: 'lanternmere', tier: 'town', firstYear: 2022, year: 2026 }, appended: { seed: 'lanternmere', tier: 'town', firstYear: 2022, year: 2027 } };
  const plans = {};
  for (const [name, config] of Object.entries(fixtures)) {
    try { plans[name] = generateSettlementPlan(config); const result = audit(plans[name], name); report.fixtures[name] = result.summary; report.failures.push(...result.failures); if (process.argv.includes('--svg')) report.fixtures[name].diagnostic = (await writeDiagnostic(plans[name], name)).slice(root.length + 1); }
    catch (error) { fail(name, 'generation or audit threw', error.stack ?? String(error)); }
  }
  if (plans.hamlet && plans.town) { report.failures.push(...compare(plans.hamlet, plans.town, 'hamlet-to-town')); report.comparisons['hamlet-to-town'] = 'checked'; }
  if (plans.town && plans.appended) { report.failures.push(...compare(plans.town, plans.appended, 'year-append')); report.comparisons['year-append'] = 'checked'; }
} catch (error) { fail('setup', 'Vite SSR load failed', error.stack ?? String(error)); }
finally { if (server) await server.close(); }
report.passed = report.failures.length === 0;
await mkdir(resolve(root, 'shots/kingdom/settlement-audit'), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, fixtures: report.fixtures, comparisons: report.comparisons, failureCount: report.failures.length, failures: report.failures.slice(0, 12), output: 'shots/kingdom/settlement-audit/audit.json' }));
if (!report.passed) process.exitCode = 1;

}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
