/**
 * The Atlas palette: parchment, sepia ink and soft watercolour. The day map never darkens; vermilion is reserved
 * for live presence and appears nowhere in the land, the sea or the heraldry.
 */
export const PAPER = '#efe4c8';
export const PAPER_DEEP = '#e2d3ae';
export const INK = '#3b2f25';
export const INK_SOFT = 'rgba(59, 47, 37, 0.62)';
export const SEA = '#dcd8c0';
export const SEA_WASH = '#94b2ab';
export const LAND = '#f1e7cb';
export const GRAPHITE = '#5f5a52';
/**
 * Live presence (Spec 01 R8): vermilion pigment, multiplied into the paper so overlaps deepen toward the pigment and
 * stop there. It never lightens, glows or darkens toward black, and it is used for nothing but live.
 */
export const VERMILION = '#d9472b';
/** The pennant's cloth: the same pigment laid on thicker. */
export const VERMILION_DEEP = '#c23a22';

/** Watercolour tints for language lands, chosen so neighbouring continents part clearly without shouting. */
export const REGION_TINTS = [
  '#c4cf9a', // sage
  '#dcc08e', // ochre
  '#c9b3c8', // heather
  '#a9c6b9', // celadon
  '#dcb79f', // apricot clay
  '#c8cf86', // pistachio
  '#b9bfd6', // slate lilac
  '#d9c79a', // sand
  '#b7cfa5', // meadow
  '#d6b2ad', // rose madder, pale
] as const;

export function regionTint(index: number): string {
  return REGION_TINTS[index % REGION_TINTS.length]!;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Quiet earth pigments a family realm leans toward. None of them comes near vermilion. */
export const REALM_ACCENTS = ['#d8c27a', '#a8c09a', '#c7a7a0', '#a9b8c9', '#9fbfb3', '#bcaec6'] as const;
/** The Crossroads at a continent's heart: worn, paler ground. */
const HEART = '#f4e9cc';
/** The Wilds at its edge: moss and heath. */
const WILD = '#8e9878';
/** The Outer Isles are empty waiting land: a graphite-pale wash rather than a language's colour. */
export const OUTER_TINT = '#cdc8b8';

/** The base pigment of one region's land. */
export function landTint(region: { index: number; kind: string }): string {
  return region.kind === 'outer' ? OUTER_TINT : regionTint(region.index);
}

export interface TintRealm { index: number; region: number; kind: string; family: number; x: number; y: number; r: number }

/**
 * One wash per realm, derived from its region's pigment, so a realm reads as one place and the land still reads as
 * its language. Family realms lean toward an accent, preferring the same accent for the same family everywhere,
 * and take the next free one when a touching realm of the same land already wears it. The Crossroads is paler,
 * the Wilds mossier; an isle keeps its language's colour.
 */
export function realmTints(realms: readonly TintRealm[], regions: readonly { index: number; kind: string }[]): string[] {
  const accents: number[] = realms.map(() => -1);
  for (const realm of realms) {
    if (realm.kind !== 'family') continue;
    const taken = new Set<number>();
    for (const other of realms) {
      if (other === realm || other.region !== realm.region || accents[other.index]! < 0) continue;
      if (Math.hypot(other.x - realm.x, other.y - realm.y) < (other.r + realm.r) * 1.2) taken.add(accents[other.index]!);
    }
    const preferred = Math.max(0, realm.family) % REALM_ACCENTS.length;
    let accent = preferred;
    for (let k = 0; k < REALM_ACCENTS.length; k++) {
      const candidate = (preferred + k) % REALM_ACCENTS.length;
      if (!taken.has(candidate)) {
        accent = candidate;
        break;
      }
    }
    accents[realm.index] = accent;
  }
  return realms.map((realm) => {
    const region = regions[realm.region];
    const base = region ? landTint(region) : regionTint(realm.region);
    switch (realm.kind) {
      case 'family': return mixHex(base, REALM_ACCENTS[accents[realm.index]!]!, 0.62);
      case 'crossroads': return mixHex(base, HEART, 0.62);
      case 'wilds': return mixHex(base, WILD, 0.5);
      default: return base;
    }
  });
}
