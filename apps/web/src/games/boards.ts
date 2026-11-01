import * as THREE from 'three';
import type { GatherFrame, GatherGame, StonesView, DiceView } from '@chatdom/shared';
import { MATERIALS, MAT } from '@chatdom/content/materials';
import type { TavernTable } from '../../../../packages/content/src/tavern';

/** Fixed game homes are also visible when no match has started. */
export function tableGame(id: string): GatherGame {
  return id === 'middle' ? 'pong' : id === 'hearth' ? 'hearth-dice' : 'stones';
}

const colour = (id: number) => new THREE.Color(MATERIALS.materials.find(m => m.id === id)!.colour);
const palette = {
  wood: colour(MAT.timber), frame: colour(MAT.earth), dark: colour(MAT.bark), brass: colour(MAT.brass),
  felt: colour(MAT.fabricMutedGreen), cream: colour(MAT.cream), red: colour(MAT.fabricRed),
};
interface SeenStones { view: StonesView; started: number; moving: number | null }
interface SeenDice { view: DiceView; started: number }

/** Two instanced draws for all five tables; nothing here owns game state. */
export function createTurnBoards(root: THREE.Group, tables: readonly TavernTable[]): {
  frame(frame: GatherFrame, now: number): void; dispose(): void;
} {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .92 });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  // Eight sides and a thin bevelled silhouette make these feel like carved counters.
  const stoneGeometry = new THREE.CylinderGeometry(.5, .5, 1, 8, 1);
  stoneGeometry.rotateX(Math.PI / 2);
  const boxes = new THREE.InstancedMesh(boxGeometry, material, 1024);
  const stones = new THREE.InstancedMesh(stoneGeometry, material, 256);
  boxes.name = 'tavern:turn-board-wood-and-dice'; stones.name = 'tavern:turn-board-stones';
  boxes.frustumCulled = false; stones.frustumCulled = false;
  root.add(boxes, stones);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), identity = new THREE.Quaternion();
  const previousStones = new Map<string, SeenStones>(), previousDice = new Map<string, SeenDice>();
  let nb = 0, ns = 0;
  function box(x: number, y: number, z: number, w: number, h: number, d: number, tint: THREE.Color, angle = 0) {
    position.set(x, y, z); scale.set(w, h, d); rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
    matrix.compose(position, rotation, scale); boxes.setMatrixAt(nb, matrix); boxes.setColorAt(nb++, tint);
  }
  function counter(x: number, y: number, z: number, tint: THREE.Color, diameter: number, depth: number) {
    position.set(x, y, z); scale.set(diameter, diameter, depth);
    matrix.compose(position, identity, scale); stones.setMatrixAt(ns, matrix); stones.setColorAt(ns++, tint);
  }
  function update(frame: GatherFrame, now: number) {
    nb = 0; ns = 0;
    for (const table of tables) {
      const [x, y, z] = table.centre;
      const publicTable = frame.tables.find(t => t.table === table.id);
      const game = tableGame(table.id);
      if (game === 'stones') {
        // 1.24m wide, .88m tall, standing along X at the table centre.
        box(x, y + .035, z, 1.34, .07, .28, palette.dark);
        box(x, y + .095, z, 1.25, .05, .19, palette.frame);
        for (const side of [-1, 1]) {
          box(x + side * .605, y + .475, z, .075, .76, .18, palette.frame);
          box(x + side * .59, y + .035, z, .15, .07, .4, palette.frame);
          box(x + side * .605, y + .79, z + .093, .036, .036, .012, palette.brass);
        }
        box(x, y + .86, z, 1.28, .075, .19, palette.frame);
        // Open lattice gives each real counter a clear cell, seen from either chair.
        for (let col = 0; col < 8; col++) box(x + (col - 3.5) * .16, y + .48, z, .011, .72, .045, palette.frame);
        for (let row = 0; row < 7; row++) box(x, y + .12 + row * .12, z, 1.13, .009, .045, palette.frame);
        const view = publicTable?.stones;
        if (!view) { previousStones.delete(table.id); continue; }
        let seen = previousStones.get(table.id);
        if (!seen || seen.view.match !== view.match) seen = { view, started: now, moving: null };
        else if (seen.view.revision !== view.revision) {
          const last = view.last, index = last ? last.row * 7 + last.column : -1;
          const changed = view.board.reduce((n, v, i) => n + (v !== seen!.view.board[i] ? 1 : 0), 0);
          const accepted = view.revision === seen.view.revision + 1 && last && changed === 1 &&
            seen.view.board[index] === 0 && view.board[index] === last.seat + 1;
          seen = { view, started: now, moving: accepted ? index : null };
        }
        previousStones.set(table.id, seen);
        view.board.forEach((value, index) => {
          if (!value) return;
          const col = index % 7, row = Math.floor(index / 7);
          const progress = Math.min(1, Math.max(0, (now - seen!.started) / 380));
          const drop = seen!.moving === index ? (1 - progress) ** 2 * (.74 - row * .12) : 0;
          const cy = y + .18 + row * .12 + drop, cx = x + (col - 3) * .16;
          if (view.winning.includes(index)) counter(cx, cy, z, palette.brass, .137, .112);
          counter(cx, cy, z, value === 1 ? palette.cream : palette.red, .112, .13);
        });
      } else if (game === 'hearth-dice') {
        // Shallow tray and a hollow cup, resting directly on the tabletop.
        box(x, y + .026, z, 1.03, .052, .70, palette.dark);
        box(x, y + .056, z, .94, .012, .61, palette.felt);
        for (const side of [-1, 1]) {
          box(x + side * .49, y + .095, z, .05, .13, .70, palette.wood);
          box(x, y + .095, z + side * .325, .94, .13, .05, palette.wood);
        }
        const cupX = x - .32, cupZ = z + .13;
        box(cupX, y + .075, cupZ, .19, .035, .19, palette.dark);
        for (const side of [-1, 1]) {
          box(cupX + side * .082, y + .16, cupZ, .025, .16, .19, palette.wood);
          box(cupX, y + .16, cupZ + side * .082, .14, .16, .025, palette.wood);
        }
        const view = publicTable?.dice;
        if (!view) { previousDice.delete(table.id); continue; }
        let seen = previousDice.get(table.id);
        if (!seen || seen.view.match !== view.match) seen = { view, started: now - 400 };
        else if (seen.view.revision !== view.revision) seen = { view, started: view.last === 'roll' || view.last === 'bust' ? now : now - 400 };
        previousDice.set(table.id, seen);
        if (view.die !== null) {
          const progress = Math.min(1, Math.max(0, (now - seen.started) / 400));
          const angle = (1 - progress) * Math.PI * 2 * (view.revision % 2 ? 1 : -1);
          const dx = x + .12, dz = z, size = .16, dy = y + .14 + Math.sin(progress * Math.PI) * .07;
          box(dx, dy, dz, size, size, size, palette.cream, angle);
          const positions: readonly (readonly [number, number])[] = [[-1,-1],[1,-1],[-1,1],[1,1],[-1,0],[1,0],[0,0]];
          const pipIndices: readonly (readonly number[])[] = [[], [6], [0,3], [0,6,3], [0,1,2,3], [0,1,6,2,3], [0,1,4,5,2,3]];
          for (const i of pipIndices[view.die]!) {
            const [px, pz] = positions[i]!, ox = px * .045, oz = pz * .045;
            box(dx + ox * Math.cos(angle) + oz * Math.sin(angle), dy + size / 2 + .002,
              dz - ox * Math.sin(angle) + oz * Math.cos(angle), .022, .006, .022, palette.dark, angle);
          }
        }
      }
    }
    boxes.count = nb; stones.count = ns;
    boxes.instanceMatrix.needsUpdate = true; stones.instanceMatrix.needsUpdate = true;
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
  }
  update({ at: 0, tables: [] }, 0);
  return { frame: update, dispose() {
    root.remove(boxes, stones); boxes.dispose(); stones.dispose(); boxGeometry.dispose(); stoneGeometry.dispose(); material.dispose();
    previousStones.clear(); previousDice.clear();
  } };
}
