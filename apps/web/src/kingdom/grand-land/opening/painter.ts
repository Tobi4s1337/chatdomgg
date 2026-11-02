import type { OpeningBounds, OpeningLand, OpeningState, OpeningStreets } from './journal';

/**
 * Draws the opening map in ink on the parchment. Every mark comes from the journal: the streets and lots from the
 * verified plan, the coast, contours and relief from the verified land surface, the colour wash only over regions
 * whose meshes are really in the scene, the raised homes from real meshing counts, the window glow from the first
 * drawn frame. Time only animates marks whose step has already happened.
 */
export interface OpeningPaint { readonly width: number; readonly height: number; readonly dpr: number; readonly now: number; readonly reduced: boolean }

const INK = '#2f2216', INK_SOFT = 'rgba(47,34,22,', WATER = 'rgba(86,118,124,';
const ease = (t: number) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };
const since = (at: number | undefined, now: number, ms: number, reduced: boolean) => at === undefined ? 0 : reduced ? 1 : ease((now - at) / ms);

interface LandLayers {
  readonly land: OpeningLand;
  /** Relief shading in ink over transparent paper, at the grid's resolution. */
  readonly relief: HTMLCanvasElement;
  /** Watercolour of the land (meadow, heath, rock, snow, water) at the grid's resolution. */
  readonly colour: HTMLCanvasElement;
  readonly coast: Float32Array;
  readonly contours: Float32Array;
  /** The dry land's extent: the map frames the island, not the open sea around it. */
  readonly dry: OpeningBounds;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement('canvas'); element.width = width; element.height = height; return element;
}

/** Marching squares over a grid; returns segments x0,z0,x1,z1 in world metres. */
export function isolines(columns: number, rows: number, value: (column: number, row: number) => number, level: number,
  bounds: OpeningBounds): Float32Array {
  const out: number[] = [], cw = (bounds.maxX - bounds.minX) / columns, ch = (bounds.maxZ - bounds.minZ) / rows;
  const x = (c: number) => bounds.minX + (c + .5) * cw, z = (r: number) => bounds.minZ + (r + .5) * ch;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < columns - 1; c++) {
    const a = value(c, r) - level, b = value(c + 1, r) - level, d = value(c, r + 1) - level, e = value(c + 1, r + 1) - level;
    const points: number[] = [];
    const edge = (p: number, q: number, x0: number, z0: number, x1: number, z1: number) => {
      if ((p < 0) === (q < 0)) return;
      const t = p / (p - q); points.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    };
    edge(a, b, x(c), z(r), x(c + 1), z(r));
    edge(b, e, x(c + 1), z(r), x(c + 1), z(r + 1));
    edge(e, d, x(c + 1), z(r + 1), x(c), z(r + 1));
    edge(d, a, x(c), z(r + 1), x(c), z(r));
    for (let i = 0; i + 3 < points.length; i += 4) out.push(points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!);
  }
  return Float32Array.from(out);
}

function buildLand(land: OpeningLand): LandLayers {
  const { columns, rows, heights, water, seaLevel } = land;
  const relief = canvas(columns, rows), colour = canvas(columns, rows);
  const reliefData = relief.getContext('2d')!.createImageData(columns, rows), colourData = colour.getContext('2d')!.createImageData(columns, rows);
  const cell = (land.bounds.maxX - land.bounds.minX) / columns;
  let high = seaLevel + 1, c0 = columns, c1 = -1, r0 = rows, r1 = -1;
  for (let i = 0; i < heights.length; i++) if (!water[i]) {
    high = Math.max(high, heights[i]!);
    const c = i % columns, r = (i - c) / columns;
    c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
  }
  const ch = (land.bounds.maxZ - land.bounds.minZ) / rows;
  const dry = c1 < 0 ? land.bounds : { minX: land.bounds.minX + c0 * cell, maxX: land.bounds.minX + (c1 + 1) * cell,
    minZ: land.bounds.minZ + r0 * ch, maxZ: land.bounds.minZ + (r1 + 1) * ch };
  const at = (c: number, r: number) => heights[Math.max(0, Math.min(columns - 1, c)) + Math.max(0, Math.min(rows - 1, r)) * columns]!;
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const i = c + r * columns, o = i * 4, h = heights[i]!;
    if (water[i]) {
      // Water stays paper: the inked coast and shore wash carry it, and the colour never tints open sea.
      continue;
    }
    // Light from the north-west, the cartographer's convention.
    const dx = (at(c + 1, r) - at(c - 1, r)) / (2 * cell), dz = (at(c, r + 1) - at(c, r - 1)) / (2 * cell);
    const shade = Math.max(0, Math.min(1, .5 + (dx + dz) * .9));
    const slope = Math.min(1, Math.hypot(dx, dz) * 1.4);
    reliefData.data.set([47, 34, 22, Math.round(255 * Math.min(.55, shade * .42 + slope * .18))], o);
    const t = Math.max(0, Math.min(1, (h - seaLevel) / Math.max(30, high - seaLevel)));
    // Meadow green, to heath gold, to rock grey, to snow.
    const stops: [number, readonly [number, number, number]][] = [[0, [146, 168, 96]], [.35, [162, 160, 92]], [.62, [158, 134, 104]], [.84, [150, 144, 140]], [1, [236, 232, 222]]];
    let k = 0; while (k < stops.length - 2 && t > stops[k + 1]![0]) k++;
    const [t0, c0] = stops[k]!, [t1, c1] = stops[k + 1]!, f = (t - t0) / (t1 - t0);
    colourData.data.set([c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f, 150], o);
  }
  relief.getContext('2d')!.putImageData(reliefData, 0, 0);
  colour.getContext('2d')!.putImageData(colourData, 0, 0);
  const wet = (c: number, r: number) => water[c + r * columns] ? 1 : -1;
  const coast = isolines(columns, rows, (c, r) => wet(c, r), 0, land.bounds);
  const contour: number[] = [];
  for (let level = seaLevel + 24; level < high; level += 24) contour.push(...isolines(columns, rows, (c, r) => water[c + r * columns] ? seaLevel - 1 : at(c, r), level, land.bounds));
  return { land, relief, colour, coast, contours: Float32Array.from(contour), dry };
}

function lerpBounds(a: OpeningBounds, b: OpeningBounds, t: number): OpeningBounds {
  return { minX: a.minX + (b.minX - a.minX) * t, maxX: a.maxX + (b.maxX - a.maxX) * t, minZ: a.minZ + (b.minZ - a.minZ) * t, maxZ: a.maxZ + (b.maxZ - a.maxZ) * t };
}
function pad(bounds: OpeningBounds, fraction: number): OpeningBounds {
  const x = (bounds.maxX - bounds.minX) * fraction, z = (bounds.maxZ - bounds.minZ) * fraction;
  return { minX: bounds.minX - x, maxX: bounds.maxX + x, minZ: bounds.minZ - z, maxZ: bounds.maxZ + z };
}
const centre = (b: OpeningBounds): [number, number] => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];

/** The home that the opening lights: the viewer's own, else the castle keep's window. */
export function openingFocus(streets: OpeningStreets | null): [number, number] | null {
  if (!streets) return null;
  const own = streets.homes.find(home => home.slot === streets.ownSlot);
  if (own) return centre(own);
  return streets.castle ? centre(streets.castle) : centre(streets.bounds);
}

export function createOpeningPainter(target: HTMLCanvasElement) {
  const ctx = target.getContext('2d')!;
  let layers: LandLayers | undefined, mask: HTMLCanvasElement | undefined;
  let maskRegions = -1, maskComplete = false, drawnKey = '';
  /** Draws when the journal or the size changed, or while a step's own animation runs; returns whether it drew.
   * Between events the map is still, so the page's main thread stays free for the kingdom that is opening. */
  function draw(state: OpeningState, paint: OpeningPaint): boolean {
    const { width, height, dpr, now, reduced } = paint;
    const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
    const key = `${state.revision}:${w}:${h}`, at = state.at;
    const settles = reduced ? 0 : Math.max(-Infinity, (at.land ?? -Infinity) + 1700, (at.lit ?? -Infinity) + 1100, (at.scene ?? -Infinity) + 1300,
      (state.regions.at(-1)?.at ?? -Infinity) + 700);
    if (key === drawnKey && now > settles) return false;
    drawnKey = key;
    if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
    if (state.land && layers?.land !== state.land) { layers = buildLand(state.land); maskRegions = -1; }
    const streets = state.streets;
    const town = streets ? pad(streets.bounds, .1) : state.land ? pad(state.land.town, .1) : null;
    if (!town) return true;
    // The map opens on the verified streets and draws back to the whole land when its surface arrives.
    const zoom = state.land ? since(state.at.land, now, 1700, reduced) : 0;
    const lit = since(state.at.lit, now, 1100, reduced);
    let frame = layers ? lerpBounds(town, pad(layers.dry, .06), zoom) : town;
    const focus = openingFocus(streets);
    if (focus && lit > 0) {
      const span = Math.max(town.maxX - town.minX, town.maxZ - town.minZ) * .55;
      frame = lerpBounds(frame, { minX: focus[0] - span, maxX: focus[0] + span, minZ: focus[1] - span, maxZ: focus[1] + span }, lit * .35);
    }
    const fw = frame.maxX - frame.minX, fh = frame.maxZ - frame.minZ;
    const scale = Math.min(w / fw, h / fh), ox = (w - fw * scale) / 2 - frame.minX * scale, oz = (h - fh * scale) / 2 - frame.minZ * scale;
    const px = scale / dpr; // CSS pixels per metre, for line weights.
    ctx.setTransform(scale, 0, 0, scale, ox, oz);
    const line = (cssPixels: number) => cssPixels / scale * dpr;

    if (layers) {
      const { land } = layers, lb = land.bounds;
      const reveal = since(state.at.land, now, 1500, reduced);
      const [cx, cz] = centre(state.land!.town), reach = Math.hypot(lb.maxX - lb.minX, lb.maxZ - lb.minZ) * reveal;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cz, Math.max(1, reach), 0, Math.PI * 2); ctx.clip();
      // Colour rises only where a region's mesh is really in the scene.
      if (state.regions.length) {
        const animating = !reduced && state.regions.some(region => now - region.at < 700);
        if (maskRegions !== state.regions.length || animating || !maskComplete) {
          mask ??= canvas(land.columns, land.rows);
          const m = mask.getContext('2d')!, sx = land.columns / (lb.maxX - lb.minX), sz = land.rows / (lb.maxZ - lb.minZ);
          m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, mask.width, mask.height);
          m.filter = `blur(${Math.max(1, land.columns / 90)}px)`;
          for (const region of state.regions) {
            m.globalAlpha = reduced ? 1 : ease((now - region.at) / 650);
            m.fillStyle = '#000';
            m.fillRect((region.bounds.minX - lb.minX) * sx, (region.bounds.minZ - lb.minZ) * sz,
              (region.bounds.maxX - region.bounds.minX) * sx, (region.bounds.maxZ - region.bounds.minZ) * sz);
          }
          m.filter = 'none'; m.globalAlpha = 1; m.globalCompositeOperation = 'source-in';
          m.drawImage(layers.colour, 0, 0); m.globalCompositeOperation = 'source-over';
          maskRegions = state.regions.length; maskComplete = !animating;
        }
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(mask!, lb.minX, lb.minZ, lb.maxX - lb.minX, lb.maxZ - lb.minZ);
      }
      // Sea wash, relief and the inked coast.
      ctx.globalAlpha = .9; ctx.drawImage(layers.relief, lb.minX, lb.minZ, lb.maxX - lb.minX, lb.maxZ - lb.minZ); ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      strokeSegments(ctx, layers.contours, line(.7), `${INK_SOFT}.26)`);
      strokeSegments(ctx, layers.coast, line(7), `${WATER}.10)`);
      strokeSegments(ctx, layers.coast, line(3.5), `${WATER}.22)`);
      strokeSegments(ctx, layers.coast, line(1.3), INK);
      ctx.restore();
    }

    if (streets) {
      const [mx, mz] = centre(streets.bounds);
      const reveal = since(state.at.scene, now, 1300, reduced);
      const reach = Math.hypot(streets.bounds.maxX - streets.bounds.minX, streets.bounds.maxZ - streets.bounds.minZ) * .62 * reveal;
      ctx.save();
      ctx.beginPath(); ctx.arc(mx, mz, Math.max(.1, reach), 0, Math.PI * 2); ctx.clip();
      if (!layers && streets.lake) {
        ctx.beginPath(); ctx.ellipse(streets.lake.x, streets.lake.z, streets.lake.radiusX, streets.lake.radiusZ, 0, 0, Math.PI * 2);
        ctx.fillStyle = `${WATER}.28)`; ctx.fill(); ctx.lineWidth = line(1.2); ctx.strokeStyle = INK; ctx.stroke();
      }
      ctx.fillStyle = `${INK_SOFT}.10)`; ctx.strokeStyle = `${INK_SOFT}.55)`; ctx.lineWidth = line(.8);
      for (const square of streets.squares) { polygon(ctx, square); ctx.fill(); ctx.stroke(); }
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const street of streets.streets) {
        if (street.points.length < 2) continue;
        ctx.beginPath(); street.points.forEach(([x, z], i) => i ? ctx.lineTo(x, z) : ctx.moveTo(x, z));
        if (street.open) {
          ctx.setLineDash([]); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(line(street.kind === 'trail' ? .9 : 1.3), street.width * .55);
        } else {
          ctx.setLineDash([line(1.5), line(4)]); ctx.strokeStyle = `${INK_SOFT}.5)`; ctx.lineWidth = line(1);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (streets.castle) {
        const c = streets.castle;
        ctx.fillStyle = `${INK_SOFT}.16)`; ctx.fillRect(c.minX, c.minZ, c.maxX - c.minX, c.maxZ - c.minZ);
        ctx.lineWidth = line(1.6); ctx.strokeStyle = INK; ctx.strokeRect(c.minX, c.minZ, c.maxX - c.minX, c.maxZ - c.minZ);
        for (const [x, z] of [[c.minX, c.minZ], [c.maxX, c.minZ], [c.minX, c.maxZ], [c.maxX, c.maxZ]] as const) {
          ctx.beginPath(); ctx.arc(x, z, line(3.2), 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
        }
      }
      // Lots stand in ink as their homes are meshed: real counts, nearest the market first.
      const raised = state.assets ? Math.round(state.assets.done / state.assets.total * streets.homes.length) : state.at.lit !== undefined ? streets.homes.length : 0;
      const order = [...streets.homes].sort((a, b) => Math.hypot(...centre(a).map((v, i) => v - [mx, mz][i]!) as [number, number])
        - Math.hypot(...centre(b).map((v, i) => v - [mx, mz][i]!) as [number, number]));
      const inset = Math.min(1.2, line(.6));
      order.forEach((home, index) => {
        const x = home.minX + inset, z = home.minZ + inset, hw = home.maxX - home.minX - inset * 2, hd = home.maxZ - home.minZ - inset * 2;
        ctx.lineWidth = line(.8);
        if (index < raised) { ctx.fillStyle = 'rgba(66,46,28,.78)'; ctx.fillRect(x, z, hw, hd); }
        else { ctx.strokeStyle = `${INK_SOFT}.5)`; ctx.strokeRect(x, z, hw, hd); }
      });
      ctx.restore();
    }

    // The window lights with the first drawn frame.
    if (focus && state.at.lit !== undefined) {
      const glow = since(state.at.lit, now, 700, reduced), r = line(26 + 10 * glow);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gradient = ctx.createRadialGradient(focus[0], focus[1], 0, focus[0], focus[1], r);
      gradient.addColorStop(0, `rgba(255,214,140,${.95 * glow})`); gradient.addColorStop(.25, `rgba(255,170,80,${.55 * glow})`); gradient.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(focus[0], focus[1], r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (focus && streets?.ownSlot !== null && streets) {
      // The viewer's own lot carries a small diamond from the moment the streets are inked.
      const size = line(5);
      ctx.save(); ctx.translate(focus[0], focus[1]); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#7a2f1c'; ctx.globalAlpha = since(state.at.scene, now, 900, reduced); ctx.fillRect(-size / 2, -size / 2, size, size); ctx.restore();
    }
    void px;
    return true;
  }
  return { draw, dispose() { layers = undefined; mask = undefined; } };
}

function strokeSegments(ctx: CanvasRenderingContext2D, segments: Float32Array, width: number, style: string) {
  if (!segments.length) return;
  ctx.beginPath();
  for (let i = 0; i + 3 < segments.length; i += 4) { ctx.moveTo(segments[i]!, segments[i + 1]!); ctx.lineTo(segments[i + 2]!, segments[i + 3]!); }
  ctx.lineWidth = width; ctx.strokeStyle = style; ctx.stroke();
}
function polygon(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]) {
  ctx.beginPath(); points.forEach(([x, z], i) => i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)); ctx.closePath();
}
