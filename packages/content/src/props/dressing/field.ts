import { MAT } from '../../materials';
import { sculpt, type Kit, type Piece } from './garden';

const { leaf, moss, petal, thatch, cream, goldLeaf } = MAT;

/** Marks of one course along a run, one per X: a letter is a stone, a change of letter a joint, upper case proud. */
function course(marks: string) {
  if (marks.length !== 32) throw new Error(`A wall course must be 32 marks, not ${marks.length}.`);
  return {
    proud: (x: number) => marks[x]! >= 'A' && marks[x]! <= 'Z',
    joint: (x: number) => x > 0 && marks[x]!.toLowerCase() !== marks[x - 1]!.toLowerCase(),
    at: (x: number) => marks[x]!,
  };
}

/**
 * The faces of the wall in courses of two cells. Every face stone of the lowest course stands proud; above it
 * some stones stand proud and some are set back a cell, so the faces step in toward the top (battered) and break
 * into stones. Front and back are laid differently.
 */
const FRONT = [course('AAAABBBBBCCCDDDDDDEEEEFFFFFGGGGH'), course('aaaBBBBccDDDDDeeeFFFFggHHHHHiiJJ'), course('AAAAAbbbCCCCddddEEEEEEfffGGGGhhh')];
const BACK = [course('AAABBBBBBCCCCDDDDDEEEFFFFFFGGGGG'), course('AAAAbbbCCCCCDDDeeeeFFFFFFggHHHHH'), course('aaBBBBCCCddddEEEEEffGGGGGGhhhIII')];
/**
 * The column heights at both ends, across Z. The left end is lower and narrower and lies strictly inside the right
 * end one pitch (30 cells) on, so the next run's left end hides in this run's right end without a shared face.
 */
const LEFT_END = [[0, 2, 3, 2, 0], [0, 3, 4, 3, 0], [3, 5, 6, 5, 3]];
const RIGHT_END = [[4, 6, 6, 6, 4], [4, 5, 6, 5, 4], [3, 4, 5, 4, 3]];
/** Kit tops, one mark per X: Hearth's cope stones, Tide's slabs (upper case through-stones), Grove's turf. */
const TOPS: Readonly<Record<string, string>> = {
  hearth: '....AA.BBB..CC.DDDD.EE..FFF.G...',
  tide: '...aaaa.bbbbb.CCCC.ddd.EEEEE....',
  grove: '...mmmllmmm.mmmlmm.mmmm.mlmmm...',
};
/** Where moss has settled on the top stones of Hearth and Tide. */
const MOSS: Readonly<Record<string, string>> = {
  hearth: '.......mm.....mmm..........m....',
  tide: '....mm.........mm.......m.......',
};

/**
 * A 4 m dry-stone field wall in the kit's stone, battered from five cells at the foot to a ridge of one, with an
 * uneven top and rounded ends. Hearth's limestone wears upright cope stones and a few patches of gold lichen;
 * Tide's grey stone carries flat slabs, two of them through-stones lipping both faces, and a tuft of sea thrift on
 * a ledge; Grove's dark stone is capped with turf and has a fern at its foot.
 */
export function fieldWall(kit: Kit): Piece {
  const s = sculpt([32, 7, 5]);
  const look = kit.id as string;
  const heights = (x: number): number[] => {
    if (x < 3) return LEFT_END[x]!;
    if (x > 28) return RIGHT_END[x - 29]!;
    const [a, b, c] = [FRONT[1]!.proud(x), FRONT[2]!.proud(x), BACK[2]!.proud(x)];
    return [a ? 4 : 2, b ? 6 : 4, 6, c ? 6 : 4, BACK[1]!.proud(x) ? 4 : 2];
  };
  for (let x = 0; x < 32; x++) heights(x).forEach((h, z) => s.fill(x, 0, z, x + 1, h, z + 1, kit.stone));
  // Joints between face stones: a cell left open where two stones meet, so the courses read stone by stone.
  for (let x = 4; x < 28; x++) {
    if (FRONT[0]!.joint(x)) s.clear(x, 1, 0);
    if (BACK[0]!.joint(x)) s.clear(x, 1, 4);
    if (FRONT[1]!.joint(x) && FRONT[1]!.proud(x) && FRONT[1]!.proud(x - 1)) s.clear(x, 3, 0);
  }
  const top = TOPS[look]!;
  for (let x = 3; x < 29; x++) {
    const mark = top[x]!;
    if (mark === '.') continue;
    if (look === 'hearth') s.set(x, 6, 2, kit.stone);
    else if (look === 'tide') s.fill(x, 6, mark === mark.toUpperCase() ? 0 : 1, x + 1, 7, mark === mark.toUpperCase() ? 5 : 4, kit.stone);
    else s.set(x, 6, 2, mark === 'l' ? leaf : moss);
  }
  const topCell = (x: number, z: number) => { for (let y = 6; y >= 0; y--) if (s.has(x, y, z)) return y; return -1; };
  if (look === 'grove') {
    // A turf cap over the whole ridge, and a fern hugging the front foot.
    for (let x = 3; x < 29; x++) for (const z of [1, 2, 3]) { const y = topCell(x, z); if (y >= 0 && !(z === 2 && y === 6)) s.set(x, y, z, moss); }
    s.fill(9, 0, 0, 11, 2, 1, leaf); s.set(10, 2, 0, leaf); s.set(9, 2, 0, leaf); s.set(10, 3, 0, leaf);
    s.fill(21, 0, 4, 23, 2, 5, leaf); s.set(22, 2, 4, leaf);
  } else {
    const mossy = MOSS[look]!;
    for (let x = 3; x < 29; x++) if (mossy[x] === 'm') for (const z of [1, 2, 3]) { const y = topCell(x, z); if (y >= 0) s.set(x, y, z, moss); }
  }
  if (look === 'hearth') for (const [x, y] of [[7, 1], [8, 1], [8, 0], [19, 2], [20, 2], [20, 3]] as const) s.set(x, y, 0, goldLeaf);
  if (look === 'tide') { s.fill(14, 2, 0, 16, 3, 1, leaf); s.fill(14, 3, 0, 16, 4, 1, petal); }
  return s.piece();
}

/**
 * A 4 m split-rail run: two leaning posts set in from the ends and rails that overrun both ends by two cells.
 * Each rail drops a cell where it passes through the left post, so its left end rides one cell above the right
 * end of the run before it and rests on it, against that run's end post. Hearth has three timber rails and
 * limestone packed round the post feet; Tide two salt-bleached rails on stone; Grove three bark rails, moss on
 * the post tops and a dark boulder at one foot.
 */
export function railFence(kit: Kit): Piece {
  const s = sculpt([32, 10, 4]);
  const look = kit.id as string;
  const rails = look === 'tide' ? [2, 6] : [1, 4, 7];
  const wood = look === 'tide' ? thatch : kit.trim;
  const height = look === 'tide' ? 9 : 10;
  /** Each post leans a cell toward +X above its fifth course. */
  const post = (base: number) => (y: number) => (y < 5 ? base : base + 1);
  const [left, right] = [post(2), post(27)];
  /** Split rails thin to one cell deep in places: [rail, from, to, z]. */
  const thin = [[0, 9, 14, 2], [1, 18, 23, 1], [2, 7, 11, 1], [2, 20, 24, 2]] as const;
  rails.forEach((r, i) => {
    for (let x = 0; x < left(r + 1); x++) s.fill(x, r + 1, 1, x + 1, r + 2, 3, wood);
    for (let x = left(r) + 2; x < 32; x++) s.fill(x, r, 1, x + 1, r + 1, 3, wood);
    for (const [rail, from, to, z] of thin) if (rail === i) for (let x = from; x < to; x++) s.clear(x, r, z);
  });
  for (const p of [left, right]) for (let y = 0; y < height; y++) s.fill(p(y), y, 1, p(y) + 2, y + 1, 3, kit.trim);
  const foot = look === 'grove' ? [] : [[2, 0], [3, 0], [2, 3], [4, 1], [4, 2], [26, 1], [27, 3], [28, 3], [28, 0]] as const;
  for (const [x, z] of foot) s.set(x, 0, z, kit.stone);
  if (look === 'grove') {
    s.fill(25, 0, 0, 27, 2, 2, kit.stone); s.set(25, 0, 2, kit.stone); s.set(26, 2, 0, moss);
    for (const p of [left, right]) s.fill(p(9), 9, 1, p(9) + 2, 10, 3, moss);
    s.fill(4, 0, 0, 6, 1, 1, leaf); s.set(4, 1, 0, leaf); s.set(5, 0, 3, leaf);
  }
  return s.piece();
}

/**
 * The lot's 8 m back fence: a post every 2 m and at both ends, two rails on the house side and low pales in
 * front of them. Hearth's timber pales rise in a gentle arch across each bay above limestone post pads; Tide's
 * pales are painted cream and cut level, every fourth one taller, on timber posts capped with grey stone; Grove's
 * are rustic bark staves of uneven height with a few fresh pale ones, on mossy posts with ferns at their feet.
 */
export function backFence(kit: Kit): Piece {
  const s = sculpt([64, 9, 3]);
  const look = kit.id as string;
  const posts = [0, 16, 32, 48, 62];
  for (const y of [2, 5]) s.fill(0, y, 2, 64, y + 1, 3, kit.trim);
  // Grove's staves, bay by bay: one height per stave (0 leaves a gap), `p` a fresh pale stave.
  const RUSTIC = ['6.7.5.67.6.p7.', '7.6.6.5.7.7p.6', '6.75.6.7.p6.7.', '7.5.6p.7.6.6'];
  posts.forEach((at, bay) => {
    const next = posts[bay + 1];
    if (next === undefined) return;
    const [from, to] = [at + 2, next];
    for (let x = from; x < to; x++) {
      const i = x - from;
      if (look === 'grove') {
        const mark = RUSTIC[bay]![i] ?? '.';
        if (mark === '.') continue;
        const h = mark === 'p' ? 6 : Number(mark);
        s.fill(x, 1, 1, x + 1, h + 1, 2, mark === 'p' ? thatch : kit.trim);
        continue;
      }
      if (i % 2) continue;
      const h = look === 'hearth' ? 6 + Math.round(1.4 * Math.sin(Math.PI * (i + 0.5) / (to - from))) : i % 8 === 6 ? 7 : 6;
      s.fill(x, 1, 1, x + 1, h + 1, 2, look === 'tide' ? cream : kit.trim);
    }
  });
  for (const at of posts) {
    s.fill(at, 0, 0, at + 2, look === 'tide' ? 8 : 9, 3, kit.trim);
    if (look === 'hearth') s.fill(Math.max(0, at - 1), 0, 0, Math.min(64, at + 3), 1, 3, kit.stone);
    if (look === 'tide') s.fill(at, 8, 0, at + 2, 9, 3, kit.stone);
    if (look === 'grove') s.fill(at, 8, 0, at + 2, 9, 3, moss);
  }
  if (look === 'grove') {
    for (const at of [16, 48]) s.fill(at - 1, 0, 0, at + 3, 1, 1, kit.stone);
    for (const [x, h] of [[5, 2], [6, 1], [27, 2], [28, 3], [29, 1], [56, 2]] as const) s.fill(x, 0, 0, x + 1, h, 1, leaf);
  }
  return s.piece();
}
