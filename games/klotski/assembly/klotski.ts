// Klotski solver — compiled to WebAssembly with AssemblyScript (--runtime minimal).
// State encoding (canonical, 50 bits):
//   bits 0..4   Cao 2×2 anchor (2-bit col @0, 3-bit row @2)
//   bits 5..9   horizontal Guan anchor
//   bits 10..29 four vertical generals, anchors sorted by col+row*4
//   bits 30..49 four soldiers, anchors sorted by col+row*4
// Soldiers and vertical generals are interchangeable, so sorting makes
// equivalent states collide into one — the searchable space stays small.

const W: i32 = 4;
const H: i32 = 5;
const NBLOCKS: i32 = 10;
const BW: StaticArray<i32> = [2, 2, 1, 1, 1, 1, 1, 1, 1, 1];
const BH: StaticArray<i32> = [2, 1, 2, 2, 2, 2, 1, 1, 1, 1];
const CAP: i32 = 1 << 17;
const QCAP: i32 = 1 << 17;
const DIRS_X: StaticArray<i32> = [0, 1, 0, -1];
const DIRS_Y: StaticArray<i32> = [-1, 0, 1, 0];

const cells: StaticArray<i32> = new StaticArray<i32>(W * H);
const occ: StaticArray<i32> = new StaticArray<i32>(W * H);
const visitedKeys: StaticArray<i64> = new StaticArray<i64>(CAP);
const visitedDist: StaticArray<i32> = new StaticArray<i32>(CAP);
const visitedFirst: StaticArray<i32> = new StaticArray<i32>(CAP);
const queue: StaticArray<i64> = new StaticArray<i64>(QCAP);
const workCols: StaticArray<i32> = new StaticArray<i32>(NBLOCKS);
const workRows: StaticArray<i32> = new StaticArray<i32>(NBLOCKS);
const canonCols: StaticArray<i32> = new StaticArray<i32>(NBLOCKS);
const canonRows: StaticArray<i32> = new StaticArray<i32>(NBLOCKS);
const scratchA: StaticArray<i32> = new StaticArray<i32>(4);
const scratchB: StaticArray<i32> = new StaticArray<i32>(4);
let current: i64 = 0;
let lastMinMoves: i32 = -1;
let lastHint: i32 = -1;

export function setCell(index: i32, value: i32): void {
  cells[index] = value;
}

/** Decode the 20 cells written via setCell into the packed current state. */
export function commitBoard(): i32 {
  const cols = new StaticArray<i32>(NBLOCKS);
  const rows = new StaticArray<i32>(NBLOCKS);
  const seen = new StaticArray<i32>(NBLOCKS);
  for (let i = 0; i < NBLOCKS; i++) {
    cols[i] = -1;
    rows[i] = -1;
    seen[i] = 0;
  }
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const value = cells[row * W + col];
      if (value == 0) continue;
      const group = value - 1;
      if (group < 0 || group >= NBLOCKS) return -3;
      if (cols[group] < 0) {
        cols[group] = col;
        rows[group] = row;
      }
      const dx = col - cols[group];
      const dy = row - rows[group];
      if (dx < 0 || dx >= BW[group] || dy < 0 || dy >= BH[group]) return -3;
      seen[group]++;
    }
  }
  for (let i = 0; i < NBLOCKS; i++) {
    if (seen[i] != BW[i] * BH[i]) return -3;
    if (cols[i] < 0 || cols[i] + BW[i] > W || rows[i] < 0 || rows[i] + BH[i] > H) return -3;
  }
  current = canonical(packState(cols, rows));
  return 0;
}

function packState(cols: StaticArray<i32>, rows: StaticArray<i32>): i64 {
  let packed: i64 = 0;
  for (let i = 0; i < NBLOCKS; i++) {
    packed |= <i64>cols[i] << <i64>(i * 5);
    packed |= <i64>rows[i] << <i64>(i * 5 + 2);
  }
  return packed;
}

function decodeState(state: i64, cols: StaticArray<i32>, rows: StaticArray<i32>): void {
  for (let i = 0; i < NBLOCKS; i++) {
    cols[i] = <i32>((state >> <i64>(i * 5)) & <i64>3);
    rows[i] = <i32>((state >> <i64>(i * 5 + 2)) & <i64>7);
  }
}

function sort4(a: StaticArray<i32>, b: StaticArray<i32>): void {
  for (let i = 1; i < 4; i++) {
    const keyA = a[i];
    const keyB = b[i];
    let j = i - 1;
    while (j >= 0 && a[j] > keyA) {
      a[j + 1] = a[j];
      b[j + 1] = b[j];
      j -= 1;
    }
    a[j + 1] = keyA;
    b[j + 1] = keyB;
  }
}

/** Merge same-shape pieces into sorted anchors so equivalent states compare equal. */
function canonical(state: i64): i64 {
  decodeState(state, canonCols, canonRows);
  let packed: i64 = <i64>canonCols[0] | (<i64>canonRows[0] << 2) | (<i64>canonCols[1] << 5) | (<i64>canonRows[1] << 7);
  for (let i = 0; i < 4; i++) {
    scratchA[i] = canonCols[2 + i] + canonRows[2 + i] * W;
    scratchB[i] = canonRows[2 + i];
  }
  sort4(scratchA, scratchB);
  for (let i = 0; i < 4; i++) {
    packed |= <i64>(scratchA[i] - scratchB[i] * W) << <i64>(10 + i * 5);
    packed |= <i64>scratchB[i] << <i64>(12 + i * 5);
  }
  for (let i = 0; i < 4; i++) {
    scratchA[i] = canonCols[6 + i] + canonRows[6 + i] * W;
    scratchB[i] = canonRows[6 + i];
  }
  sort4(scratchA, scratchB);
  for (let i = 0; i < 4; i++) {
    packed |= <i64>(scratchA[i] - scratchB[i] * W) << <i64>(30 + i * 5);
    packed |= <i64>scratchB[i] << <i64>(32 + i * 5);
  }
  return packed;
}

function hashKey(key: i64): i32 {
  let mixed = key as u64;
  mixed ^= mixed >> 33;
  mixed *= <u64>0xff51afd7ed558ccd;
  mixed ^= mixed >> 29;
  return (i32)(mixed as i64) & (CAP - 1);
}

function visitedInsert(state: i64, dist: i32, firstMove: i32): boolean {
  let slot = hashKey(state);
  for (let probe = 0; probe < 96; probe++) {
    const existing = visitedKeys[slot];
    if (existing == state) return false;
    if (existing == 0) {
      visitedKeys[slot] = state;
      visitedDist[slot] = dist;
      visitedFirst[slot] = firstMove;
      return true;
    }
    slot = (slot + 1) & (CAP - 1);
  }
  return false;
}

function visitedLookup(state: i64): i32 {
  let slot = hashKey(state);
  for (let probe = 0; probe < 96; probe++) {
    const existing = visitedKeys[slot];
    if (existing == state) return visitedDist[slot];
    if (existing == 0) return -1;
    slot = (slot + 1) & (CAP - 1);
  }
  return -1;
}

function visitedFirstMove(state: i64): i32 {
  let slot = hashKey(state);
  for (let probe = 0; probe < 96; probe++) {
    const existing = visitedKeys[slot];
    if (existing == state) return visitedFirst[slot];
    if (existing == 0) return -1;
    slot = (slot + 1) & (CAP - 1);
  }
  return -1;
}

function clearVisited(): void {
  for (let i = 0; i < CAP; i++) {
    visitedKeys[i] = 0;
    visitedDist[i] = -1;
    visitedFirst[i] = -1;
  }
}

function caoAtGoal(state: i64): boolean {
  decodeState(state, workCols, workRows);
  return workCols[0] == 1 && workRows[0] == 3;
}

/** BFS from the canonical current state; caches min moves and the first move. */
export function solve(): i32 {
  clearVisited();
  let head: i32 = 0;
  let tail: i32 = 0;
  if (visitedInsert(current, 0, -1)) {
    queue[tail] = current;
    tail++;
  }
  while (head < tail) {
    const state = queue[head];
    head++;
    const dist = visitedLookup(state);
    const firstMove = visitedFirstMove(state);
    if (caoAtGoal(state)) {
      lastMinMoves = dist;
      lastHint = firstMove;
      return dist;
    }
    decodeState(state, workCols, workRows);
    for (let i = 0; i < W * H; i++) occ[i] = 0;
    for (let b = 0; b < NBLOCKS; b++) {
      for (let dy = 0; dy < BH[b]; dy++) {
        for (let dx = 0; dx < BW[b]; dx++) {
          occ[(workRows[b] + dy) * W + (workCols[b] + dx)] = b + 1;
        }
      }
    }
    for (let b = 0; b < NBLOCKS; b++) {
      for (let dir = 0; dir < 4; dir++) {
        const dx = DIRS_X[dir];
        const dy = DIRS_Y[dir];
        let free = true;
        for (let sy = 0; sy < BH[b] && free; sy++) {
          for (let sx = 0; sx < BW[b] && free; sx++) {
            const cellCol = workCols[b] + sx + dx;
            const cellRow = workRows[b] + sy + dy;
            if (cellCol < 0 || cellCol >= W || cellRow < 0 || cellRow >= H) {
              free = false;
              break;
            }
            const occupied = occ[cellRow * W + cellCol];
            if (occupied != 0 && occupied != b + 1) free = false;
          }
        }
        if (!free) continue;
        workCols[b] += dx;
        workRows[b] += dy;
        const next = canonical(packState(workCols, workRows));
        workCols[b] -= dx;
        workRows[b] -= dy;
        const encoded = (b << 2) | dir;
        if (visitedInsert(next, dist + 1, dist == 0 ? encoded : firstMove)) {
          if (tail < QCAP) {
            queue[tail] = next;
            tail++;
          }
        }
      }
    }
  }
  lastMinMoves = -1;
  lastHint = -1;
  return -1;
}

export function minMoves(): i32 {
  return lastMinMoves;
}

export function hintMove(): i32 {
  return lastHint;
}
