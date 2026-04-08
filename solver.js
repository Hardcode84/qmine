/**
 * Flat cell index from row/col.
 * Shared encoding used by solver, game, and tests.
 * @param {number} row
 * @param {number} col
 * @param {number} cols - board width
 * @returns {number}
 */
export function cellKey(row, col, cols) {
  return row * cols + col;
}

/**
 * Return coordinates of all neighbors of (row, col) within the grid.
 * @param {number} row
 * @param {number} col
 * @param {number} rows - board height
 * @param {number} cols - board width
 * @returns {Array<[number, number]>}
 */
export function neighbors(row, col, rows, cols) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        result.push([nr, nc]);
      }
    }
  }
  return result;
}

/**
 * Find a valid mine layout satisfying all constraints.
 *
 * @param {Object} params
 * @param {number}  params.rows       - board height
 * @param {number}  params.cols       - board width
 * @param {number}  params.totalMines - exact mine count to preserve
 * @param {Array<{row:number, col:number, number:number}>} params.revealed
 *   Revealed cells with their displayed number.
 * @param {Array<[number,number]>} params.forcedMine
 *   Cells that must contain mines.
 * @param {Array<[number,number]>} params.forcedEmpty
 *   Cells that must not contain mines.
 * @param {function(): number} [params.random=Math.random]
 *   RNG for shuffle/tiebreaking. Injectable for deterministic tests.
 * @returns {Set<number>|null} Set of mine cell keys, or null if impossible.
 */
export function solve({
  rows, cols, totalMines,
  revealed = [], forcedMine = [], forcedEmpty = [],
  random = Math.random,
}) {
  const key = (r, c) => cellKey(r, c, cols);

  const mineSet = new Set();
  for (const [r, c] of forcedMine) { mineSet.add(key(r, c)); }

  const emptySet = new Set();
  for (const [r, c] of forcedEmpty) { emptySet.add(key(r, c)); }

  const revealedMap = new Map();
  for (const { row, col, number } of revealed) {
    const k = key(row, col);
    revealedMap.set(k, number);
    emptySet.add(k);
  }

  for (const k of mineSet) {
    if (emptySet.has(k)) return null;
  }
  if (mineSet.size > totalMines) return null;

  const constraints = [];
  const boundarySet = new Set();

  for (const { row, col, number } of revealed) {
    const nbrs = neighbors(row, col, rows, cols);
    let knownMines = 0;
    const unknowns = [];

    for (const [nr, nc] of nbrs) {
      const nk = key(nr, nc);
      if (mineSet.has(nk)) {
        knownMines++;
      } else if (!emptySet.has(nk)) {
        unknowns.push(nk);
        boundarySet.add(nk);
      }
    }

    const remaining = number - knownMines;
    if (remaining < 0 || remaining > unknowns.length) return null;

    if (unknowns.length > 0) {
      constraints.push({ cells: unknowns, count: remaining });
    }
  }

  const boundaryCells = [...boundarySet];

  const decided = new Set([...mineSet, ...emptySet, ...boundarySet]);
  const interiorCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = key(r, c);
      if (!decided.has(k)) { interiorCells.push(k); }
    }
  }

  const maxBoundaryMines = totalMines - mineSet.size;
  const minBoundaryMines = Math.max(0, totalMines - mineSet.size - interiorCells.length);

  // Most-constrained-variable ordering with random tiebreak
  const constraintCount = new Map();
  for (const constraint of constraints) {
    for (const c of constraint.cells) {
      constraintCount.set(c, (constraintCount.get(c) || 0) + 1);
    }
  }
  shuffle(boundaryCells, random);
  boundaryCells.sort((a, b) =>
    (constraintCount.get(b) || 0) - (constraintCount.get(a) || 0)
  );

  const assignment = new Map();

  function propagate() {
    const added = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const constraint of constraints) {
        let mines = 0;
        const unknowns = [];
        for (const c of constraint.cells) {
          if (assignment.has(c)) {
            if (assignment.get(c)) { mines++; }
          } else {
            unknowns.push(c);
          }
        }
        const rem = constraint.count - mines;
        if (rem < 0 || rem > unknowns.length) {
          for (const c of added) { assignment.delete(c); }
          return null;
        }
        if (unknowns.length === 0) continue;
        if (rem === 0) {
          for (const c of unknowns) {
            if (!assignment.has(c)) {
              assignment.set(c, false);
              added.push(c);
              changed = true;
            }
          }
        } else if (rem === unknowns.length) {
          for (const c of unknowns) {
            if (!assignment.has(c)) {
              assignment.set(c, true);
              added.push(c);
              changed = true;
            }
          }
        }
      }
    }
    return added;
  }

  function backtrack(cellIdx) {
    const added = propagate();
    if (added === null) return false;

    while (cellIdx < boundaryCells.length && assignment.has(boundaryCells[cellIdx])) {
      cellIdx++;
    }

    if (cellIdx === boundaryCells.length) {
      let bMines = 0;
      for (const c of boundaryCells) {
        if (assignment.get(c)) { bMines++; }
      }
      if (bMines >= minBoundaryMines && bMines <= maxBoundaryMines) {
        return true;
      }
      for (const c of added) { assignment.delete(c); }
      return false;
    }

    const cell = boundaryCells[cellIdx];
    const values = random() < 0.5 ? [true, false] : [false, true];
    for (const val of values) {
      assignment.set(cell, val);
      if (backtrack(cellIdx + 1)) return true;
      assignment.delete(cell);
    }

    for (const c of added) { assignment.delete(c); }
    return false;
  }

  if (!backtrack(0)) return null;

  const mines = new Set(mineSet);
  for (const [cell, isMine] of assignment) {
    if (isMine) { mines.add(cell); }
  }

  const interiorMines = totalMines - mines.size;
  shuffle(interiorCells, random);
  for (let i = 0; i < interiorMines; i++) {
    mines.add(interiorCells[i]);
  }

  return mines;
}

/**
 * Verify a mine layout against all constraints.
 *
 * @param {Object} params - Same as solve(), plus `mines`.
 * @param {Set<number>} params.mines - Set of mine cell keys to verify.
 * @returns {{valid: boolean, reason?: string}}
 */
export function verify({ rows, cols, totalMines, revealed = [], forcedMine = [], forcedEmpty = [], mines }) {
  if (!mines || typeof mines.size !== 'number') {
    return { valid: false, reason: 'mines is not a Set' };
  }

  const key = (r, c) => cellKey(r, c, cols);

  if (mines.size !== totalMines) {
    return { valid: false, reason: `mine count: expected ${totalMines}, got ${mines.size}` };
  }

  for (const [r, c] of forcedMine) {
    if (!mines.has(key(r, c))) {
      return { valid: false, reason: `forced mine missing at (${r},${c})` };
    }
  }

  for (const [r, c] of forcedEmpty) {
    if (mines.has(key(r, c))) {
      return { valid: false, reason: `mine at forced-empty (${r},${c})` };
    }
  }

  for (const { row, col, number } of revealed) {
    if (mines.has(key(row, col))) {
      return { valid: false, reason: `mine at revealed (${row},${col})` };
    }
    let count = 0;
    for (const [nr, nc] of neighbors(row, col, rows, cols)) {
      if (mines.has(key(nr, nc))) { count++; }
    }
    if (count !== number) {
      return { valid: false, reason: `number mismatch at (${row},${col}): expected ${number}, got ${count}` };
    }
  }

  return { valid: true };
}

/** Fisher-Yates in-place shuffle. */
function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
