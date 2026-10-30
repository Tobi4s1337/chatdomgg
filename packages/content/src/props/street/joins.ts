/**
 * Review assemblies for the content bench: one front garden per kit, laid in front of a core house whose
 * facade sits behind z=0. Positions are integer build cells; each instance turns by positive-Y quarter turns
 * around its own origin, then translates. These are review transforms, not placement sockets.
 *
 * Both gardens share one plan. A wall and a fence each run straight → corner → straight from the street edge
 * (z 32..36) back toward the house, and end-piece → straight at the path. The path opening x 20..40 stays
 * clear in front of the house door. The kits swap which side carries the wall, so every corner, end and
 * straight is exercised in more than one orientation across the two fixtures.
 */
type Instance = { assetId: string; position: readonly [number, number, number]; quarterTurns: 0 | 1 | 2 | 3 };
type Side = 'fence' | 'wall';

const leftRun = (style: string, kind: Side): Instance[] => [
  { assetId: `street-${style}-${kind}-corner`, position: [0, 0, 36], quarterTurns: 2 },
  { assetId: `street-${style}-${kind}-straight`, position: [0, 0, 32], quarterTurns: 0 },
  { assetId: `street-${style}-${kind}-end`, position: [16, 0, 32], quarterTurns: 0 },
  { assetId: `street-${style}-${kind}-straight`, position: [-16, 0, 20], quarterTurns: 1 },
  { assetId: `street-${style}-${kind}-end`, position: [-16, 0, 4], quarterTurns: 1 },
];
const rightRun = (style: string, kind: Side): Instance[] => [
  { assetId: `street-${style}-${kind}-end`, position: [44, 0, 36], quarterTurns: 2 },
  { assetId: `street-${style}-${kind}-straight`, position: [44, 0, 32], quarterTurns: 0 },
  { assetId: `street-${style}-${kind}-corner`, position: [76, 0, 20], quarterTurns: 3 },
  { assetId: `street-${style}-${kind}-straight`, position: [72, 0, 20], quarterTurns: 1 },
  { assetId: `street-${style}-${kind}-end`, position: [72, 0, 4], quarterTurns: 1 },
];

export const JOIN_FIXTURES: readonly {
  id: 'joins-hearth' | 'joins-tide';
  instances: readonly Instance[];
}[] = [
  {
    id: 'joins-hearth',
    instances: [
      ...leftRun('hearth', 'wall'),
      ...rightRun('hearth', 'fence'),
      // Pots flank the door two cells clear of it; the trough lines the inside of the side wall, where the
      // street sees its whole face; a stone marks where the path enters the garden; the shrub fills the fence corner.
      { assetId: 'street-hearth-flower-pot', position: [13, 0, 2], quarterTurns: 0 },
      { assetId: 'street-hearth-flower-pot', position: [37, 0, 10], quarterTurns: 1 },
      { assetId: 'street-hearth-flower-trough', position: [-11, 0, 30], quarterTurns: 1 },
      { assetId: 'street-hearth-rock-cluster', position: [6, 0, 14], quarterTurns: 0 },
      { assetId: 'street-hearth-leafy-shrub', position: [58, 0, 16], quarterTurns: 0 },
    ],
  },
  {
    id: 'joins-tide',
    instances: [
      ...leftRun('tide', 'fence'),
      ...rightRun('tide', 'wall'),
      // The fence garden keeps its trough and stone in view through the rails; the shrub stands taller than
      // the wall so it shows over the cap, as a garden behind a wall does.
      { assetId: 'street-tide-flower-pot', position: [13, 0, 2], quarterTurns: 0 },
      { assetId: 'street-tide-flower-pot', position: [37, 0, 10], quarterTurns: 1 },
      { assetId: 'street-tide-flower-trough', position: [-11, 0, 30], quarterTurns: 1 },
      { assetId: 'street-tide-rock-cluster', position: [2, 0, 28], quarterTurns: 1 },
      { assetId: 'street-tide-leafy-shrub', position: [56, 0, 12], quarterTurns: 0 },
    ],
  },
];
