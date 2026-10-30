/**
 * The Atlas charges: small engraved silhouettes drawn for Chatdom, in a box from -1 to 1 (y down).
 *
 * Every charge is a bold silhouette first, so it still reads as a distinct blot at 5 px, with holes (a tower's
 * door, a fish's eye) that only start to show once the shield is large. Dexter-facing beasts face the viewer's
 * left, as heraldry draws them.
 *
 * Deliberately absent, because they already mean something on the map: crowns (season glory, monarchs), keys
 * (your home), tents (newcomers and settlers), flags and pennants (live), and anything with a face.
 */
import { circle, polygon, type PathCommand, type PathPiece, type Point } from './path';

export const CHARGE_KINDS = [
  'mullet', 'sun', 'crescent', 'roundel', 'annulet', 'lozenge', 'mascle', 'lily', 'crossPattee',
  'tower', 'martlet', 'fish', 'tree', 'bell', 'trefoil', 'anvil',
] as const;

export type ChargeKind = (typeof CHARGE_KINDS)[number];

export interface ChargeShape {
  readonly pieces: readonly PathPiece[];
}

function star(points: number, outer: readonly number[], inner: number, cy = 0, rotation = -Math.PI / 2): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points; i++) {
    const a = rotation + (i / points) * Math.PI * 2;
    const r = outer[i % outer.length]!;
    out.push([Math.cos(a) * r, cy + Math.sin(a) * r]);
    const b = a + Math.PI / points;
    out.push([Math.cos(b) * inner, cy + Math.sin(b) * inner]);
  }
  return out;
}

/** Outer disc minus an inner disc set higher: horns up, as a crescent is borne. */
function crescent(): PathCommand[] {
  const c1y = 0.14, r1 = 0.8, c2y = -0.16, r2 = 0.68;
  // Intersection of the two circles (both centred on x = 0).
  const y = (r2 * r2 - r1 * r1 + c1y * c1y - c2y * c2y) / (2 * (c1y - c2y));
  const x = Math.sqrt(r1 * r1 - (y - c1y) ** 2);
  const outerRight = Math.atan2(y - c1y, x);
  const outerLeft = Math.atan2(y - c1y, -x);
  const innerLeft = Math.atan2(y - c2y, -x);
  const innerRight = Math.atan2(y - c2y, x);
  return [
    ['M', x, y],
    ['A', 0, c1y, r1, outerRight, outerLeft + (outerLeft < outerRight ? Math.PI * 2 : 0), false],
    ['A', 0, c2y, r2, innerLeft, innerRight, true],
    ['Z'],
  ];
}

function crossPattee(): PathCommand[] {
  const end = 0.94, half = 0.44, waist = 0.13, bow = 0.17;
  const d: PathCommand[] = [];
  // One arm, rotated four times: end corner, end corner, concave flank down to the waist.
  for (let k = 0; k < 4; k++) {
    const rot = (p: Point): Point => {
      const [x, y] = p;
      switch (k) {
        case 0: return [x, y];
        case 1: return [-y, x];
        case 2: return [-x, -y];
        default: return [y, -x];
      }
    };
    const a = rot([-half, -end]);
    const b = rot([half, -end]);
    const c = rot([bow, -0.42]);
    const w = rot([waist, -waist]);
    const nextA = rot([end, -half]);
    const nextC = rot([0.42, -bow]);
    if (k === 0) d.push(['M', a[0], a[1]]);
    d.push(['L', b[0], b[1]], ['Q', c[0], c[1], w[0], w[1]], ['Q', nextC[0], nextC[1], nextA[0], nextA[1]]);
  }
  d.push(['Z']);
  return d;
}

const SHAPES: Record<ChargeKind, ChargeShape> = {
  mullet: { pieces: [{ d: polygon(star(5, [0.98], 0.4, 0.08)) }] },

  // A sun in splendour without a face: alternating long and short rays around a ringed disc.
  sun: {
    pieces: [{
      d: [...polygon(star(16, [0.98, 0.74], 0.5)), ...circle(0, 0, 0.36), ...circle(0, 0, 0.27)],
      evenOdd: true,
    }],
  },

  crescent: { pieces: [{ d: crescent() }] },

  roundel: { pieces: [{ d: circle(0, 0, 0.72) }] },

  annulet: { pieces: [{ d: [...circle(0, 0, 0.76), ...circle(0, 0, 0.46)], evenOdd: true }] },

  lozenge: { pieces: [{ d: polygon([[0, -0.98], [0.64, 0], [0, 0.98], [-0.64, 0]]) }] },

  mascle: {
    pieces: [{
      d: [...polygon([[0, -0.98], [0.66, 0], [0, 0.98], [-0.66, 0]]), ...polygon([[0, -0.54], [0.36, 0], [0, 0.54], [-0.36, 0]])],
      evenOdd: true,
    }],
  },

  // A lily of our own: a tall central petal, two petals that curl outwards and down, a band, a three-part foot.
  lily: {
    pieces: [
      { d: [['M', 0, -1], ['C', 0.24, -0.74, 0.34, -0.38, 0.13, 0.12], ['L', -0.13, 0.12], ['C', -0.34, -0.38, -0.24, -0.74, 0, -1], ['Z']] },
      {
        d: [['M', -0.1, 0.1], ['C', -0.3, -0.42, -0.72, -0.62, -0.92, -0.34], ['C', -1.02, -0.16, -0.9, 0.04, -0.7, 0.02],
          ['C', -0.82, -0.14, -0.74, -0.32, -0.58, -0.3], ['C', -0.42, -0.26, -0.34, -0.06, -0.38, 0.12], ['Z']],
      },
      {
        d: [['M', 0.1, 0.1], ['C', 0.3, -0.42, 0.72, -0.62, 0.92, -0.34], ['C', 1.02, -0.16, 0.9, 0.04, 0.7, 0.02],
          ['C', 0.82, -0.14, 0.74, -0.32, 0.58, -0.3], ['C', 0.42, -0.26, 0.34, -0.06, 0.38, 0.12], ['Z']],
      },
      { d: polygon([[-0.5, 0.08], [0.5, 0.08], [0.5, 0.27], [-0.5, 0.27]]) },
      {
        d: [['M', -0.1, 0.26], ['L', 0.1, 0.26], ['L', 0.07, 0.56], ['C', 0.22, 0.62, 0.36, 0.76, 0.32, 0.94],
          ['C', 0.2, 0.8, 0.07, 0.76, 0, 0.76], ['C', -0.07, 0.76, -0.2, 0.8, -0.32, 0.94],
          ['C', -0.36, 0.76, -0.22, 0.62, -0.07, 0.56], ['Z']],
      },
    ],
  },

  crossPattee: { pieces: [{ d: crossPattee() }] },

  tower: {
    pieces: [{
      d: [
        ...polygon([
          [-0.68, -0.96], [-0.4, -0.96], [-0.4, -0.76], [-0.14, -0.76], [-0.14, -0.96], [0.14, -0.96], [0.14, -0.76],
          [0.4, -0.76], [0.4, -0.96], [0.68, -0.96], [0.68, -0.46], [0.52, -0.4], [0.6, 0.96], [-0.6, 0.96],
          [-0.52, -0.4], [-0.68, -0.46],
        ]),
        // Arched door and an arrow slit.
        ['M', -0.18, 0.96], ['L', -0.18, 0.52], ['A', 0, 0.52, 0.18, Math.PI, Math.PI * 2, false], ['L', 0.18, 0.96], ['Z'],
        ...polygon([[-0.06, -0.3], [0.06, -0.3], [0.06, 0.06], [-0.06, 0.06]]),
      ],
      evenOdd: true,
    }],
  },

  // A martlet close, facing dexter: no feet, only the tufts where they would be.
  martlet: {
    pieces: [
      {
        d: [['M', -0.96, -0.24], ['L', -0.72, -0.36], ['C', -0.64, -0.56, -0.38, -0.6, -0.27, -0.42],
          ['C', -0.08, -0.3, 0.22, -0.28, 0.46, -0.1], ['L', 0.98, -0.34], ['L', 0.7, 0.02], ['L', 0.96, 0.26],
          ['L', 0.4, 0.14], ['C', 0.14, 0.42, -0.36, 0.44, -0.56, 0.14], ['C', -0.63, 0.02, -0.68, -0.1, -0.72, -0.16], ['Z'],
          ...circle(-0.58, -0.34, 0.055)],
        evenOdd: true,
      },
      { d: [['M', -0.3, -0.3], ['C', -0.1, -0.76, 0.34, -0.9, 0.66, -0.72], ['C', 0.38, -0.56, 0.18, -0.36, 0.12, -0.16], ['Z']] },
      { d: polygon([[-0.26, 0.3], [-0.1, 0.32], [-0.2, 0.6]]) },
      { d: polygon([[-0.02, 0.32], [0.14, 0.28], [0.06, 0.58]]) },
    ],
  },

  // A fish naiant, facing dexter.
  fish: {
    pieces: [
      {
        d: [['M', -0.98, 0.02], ['C', -0.72, -0.42, -0.1, -0.5, 0.4, -0.06], ['L', 0.9, -0.44],
          ['C', 0.8, -0.16, 0.8, 0.18, 0.9, 0.46], ['L', 0.4, 0.1], ['C', -0.1, 0.52, -0.72, 0.44, -0.98, 0.02], ['Z'],
          ...circle(-0.62, -0.06, 0.075)],
        evenOdd: true,
      },
      { d: [['M', -0.38, -0.32], ['C', -0.24, -0.56, -0.02, -0.66, 0.16, -0.62], ['C', 0.06, -0.48, 0.08, -0.34, 0.14, -0.24], ['Z']] },
      { d: [['M', -0.22, 0.32], ['L', -0.02, 0.58], ['L', 0.06, 0.28], ['Z']] },
    ],
  },

  // An oak eradicated: a clouded crown, a trunk and its roots.
  tree: {
    pieces: [
      { d: circle(0, -0.56, 0.38) },
      { d: circle(-0.42, -0.26, 0.34) },
      { d: circle(0.42, -0.26, 0.34) },
      { d: circle(-0.2, -0.04, 0.3) },
      { d: circle(0.2, -0.04, 0.3) },
      {
        d: [['M', -0.11, 0.04], ['L', 0.11, 0.04], ['L', 0.14, 0.6], ['C', 0.3, 0.7, 0.5, 0.78, 0.66, 0.96],
          ['L', 0.22, 0.86], ['L', 0, 0.96], ['L', -0.22, 0.86], ['L', -0.66, 0.96], ['C', -0.5, 0.78, -0.3, 0.7, -0.14, 0.6], ['Z']],
      },
    ],
  },

  bell: {
    pieces: [
      { d: [...circle(0, -0.8, 0.17), ...circle(0, -0.8, 0.08)], evenOdd: true },
      {
        d: [['M', -0.14, -0.66], ['C', -0.46, -0.64, -0.5, -0.3, -0.52, 0.1], ['C', -0.54, 0.42, -0.68, 0.54, -0.82, 0.64],
          ['L', 0.82, 0.64], ['C', 0.68, 0.54, 0.54, 0.42, 0.52, 0.1], ['C', 0.5, -0.3, 0.46, -0.64, 0.14, -0.66], ['Z']],
      },
      { d: polygon([[-0.88, 0.6], [0.88, 0.6], [0.88, 0.74], [-0.88, 0.74]]) },
      { d: circle(0, 0.84, 0.14) },
    ],
  },

  // A slipped trefoil: three round leaves and a curving stalk.
  trefoil: {
    pieces: [
      { d: circle(0, -0.48, 0.34) },
      { d: circle(-0.42, 0, 0.34) },
      { d: circle(0.42, 0, 0.34) },
      { d: circle(0, -0.1, 0.24) },
      { d: [['M', -0.07, 0.08], ['C', -0.02, 0.44, 0.12, 0.74, 0.36, 0.96], ['L', 0.24, 1], ['C', 0, 0.8, -0.14, 0.46, -0.16, 0.1], ['Z']] },
    ],
  },

  // The Forge's anvil, horn to dexter.
  anvil: {
    pieces: [{
      d: [['M', -0.4, -0.5], ['L', 0.9, -0.5], ['L', 0.9, -0.2], ['L', 0.5, -0.2], ['C', 0.3, -0.12, 0.25, 0.15, 0.3, 0.38],
        ['C', 0.4, 0.5, 0.6, 0.58, 0.68, 0.62], ['L', 0.68, 0.86], ['L', -0.68, 0.86], ['L', -0.68, 0.62],
        ['C', -0.6, 0.58, -0.4, 0.5, -0.3, 0.38], ['C', -0.25, 0.15, -0.3, -0.12, -0.45, -0.2],
        ['C', -0.66, -0.24, -0.86, -0.32, -1, -0.44], ['C', -0.8, -0.5, -0.6, -0.5, -0.4, -0.5], ['Z']],
    }],
  },
};

export function chargeShape(kind: ChargeKind): ChargeShape {
  return SHAPES[kind];
}

/** Heraldic names, used in blazons. */
export const CHARGE_NAMES: Record<ChargeKind, { one: string; many: string }> = {
  mullet: { one: 'a mullet', many: 'mullets' },
  sun: { one: 'a sun in splendour', many: 'suns in splendour' },
  crescent: { one: 'a crescent', many: 'crescents' },
  roundel: { one: 'a roundel', many: 'roundels' },
  annulet: { one: 'an annulet', many: 'annulets' },
  lozenge: { one: 'a lozenge', many: 'lozenges' },
  mascle: { one: 'a mascle', many: 'mascles' },
  lily: { one: 'a lily', many: 'lilies' },
  crossPattee: { one: 'a cross pattée', many: 'crosses pattée' },
  tower: { one: 'a tower', many: 'towers' },
  martlet: { one: 'a martlet', many: 'martlets' },
  fish: { one: 'a fish naiant', many: 'fishes naiant' },
  tree: { one: 'an oak eradicated', many: 'oaks eradicated' },
  bell: { one: 'a bell', many: 'bells' },
  trefoil: { one: 'a trefoil slipped', many: 'trefoils slipped' },
  anvil: { one: 'an anvil', many: 'anvils' },
};
