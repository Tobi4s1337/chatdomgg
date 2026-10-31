import { MATERIALS } from '../materials';

/**
 * How a colour reads to the people watching. Besides typical colour vision, the arms must hold up for the three
 * dichromacies: protanopia and deuteranopia (red-green, together about one viewer in twelve men) and tritanopia
 * (blue-yellow). Each is simulated with Machado, Oliveira and Fernandes (2009) at full severity, applied to linear
 * sRGB, then measured with the WCAG relative luminance and contrast ratio.
 */
export type Vision = 'typical' | 'protanopia' | 'deuteranopia' | 'tritanopia';
export const VISIONS: readonly Vision[] = ['typical', 'protanopia', 'deuteranopia', 'tritanopia'];

type Matrix = readonly [number, number, number, number, number, number, number, number, number];
const SIMULATION: Readonly<Record<Vision, Matrix>> = {
  typical: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const linear = (hex: string): [number, number, number] => [1, 3, 5].map(i => {
  const c = parseInt(hex.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}) as [number, number, number];

/** WCAG relative luminance of a #rrggbb colour as a viewer with `vision` sees it. */
export function visionLuminance(hex: string, vision: Vision): number {
  const [r, g, b] = linear(hex);
  const m = SIMULATION[vision];
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(m[0] * r + m[1] * g + m[2] * b) + 0.7152 * clamp(m[3] * r + m[4] * g + m[5] * b) + 0.0722 * clamp(m[6] * r + m[7] * g + m[8] * b);
}

const colourOf = new Map(MATERIALS.materials.map(material => [material.id, material.colour]));
const hexOf = (material: number) => {
  const hex = colourOf.get(material);
  if (!hex) throw new Error(`Material ${material} is not registered.`);
  return hex;
};

/** WCAG contrast ratio between two registered materials for each kind of colour vision. */
export function visionContrasts(a: number, b: number): Readonly<Record<Vision, number>> {
  const out = {} as Record<Vision, number>;
  for (const vision of VISIONS) {
    const [hi, lo] = [visionLuminance(hexOf(a), vision), visionLuminance(hexOf(b), vision)].sort((x, y) => y - x) as [number, number];
    out[vision] = (hi + 0.05) / (lo + 0.05);
  }
  return out;
}

/** The weakest contrast two materials keep across typical vision and the three dichromacies. */
export function readableContrast(a: number, b: number): number {
  return Math.min(...Object.values(visionContrasts(a, b)));
}
