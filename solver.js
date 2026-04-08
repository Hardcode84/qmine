export function neighbors(row, col, rows, cols) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr, nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        result.push([nr, nc]);
      }
    }
  }
  return result;
}

export function solve({ rows, cols, totalMines, revealed, forcedMine, forcedEmpty }) {
  const key = (r, c) => r * cols + c;

  const mineSet = new Set();
  for (const [r, c] of forcedMine) mineSet.add(key(r, c));

  const emptySet = new Set();
  for (const [r, c] of forcedEmpty) emptySet.add(key(r, c));

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
      if (!decided.has(k)) interiorCells.push(k);
    }
  }

  const maxBoundaryMines = totalMines - mineSet.size;
  const minBoundaryMines = Math.max(0, totalMines - mineSet.size - interiorCells.length);

  // Most-constrained-variable ordering with random tiebreak
  const constraintCount = new Map();
  for (const con of constraints) {
    for (const c of con.cells) {
      constraintCount.set(c, (constraintCount.get(c) || 0) + 1);
    }
  }
  shuffle(boundaryCells);
  boundaryCells.sort((a, b) =>
    (constraintCount.get(b) || 0) - (constraintCount.get(a) || 0)
  );

  const assignment = new Map();

  function propagate() {
    const added = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const con of constraints) {
        let mines = 0;
        const unknowns = [];
        for (const c of con.cells) {
          if (assignment.has(c)) {
            if (assignment.get(c)) mines++;
          } else {
            unknowns.push(c);
          }
        }
        const rem = con.count - mines;
        if (rem < 0 || rem > unknowns.length) {
          for (const c of added) assignment.delete(c);
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
        if (assignment.get(c)) bMines++;
      }
      if (bMines >= minBoundaryMines && bMines <= maxBoundaryMines) {
        return true;
      }
      for (const c of added) assignment.delete(c);
      return false;
    }

    const cell = boundaryCells[cellIdx];
    const values = Math.random() < 0.5 ? [true, false] : [false, true];
    for (const val of values) {
      assignment.set(cell, val);
      if (backtrack(cellIdx + 1)) return true;
      assignment.delete(cell);
    }

    for (const c of added) assignment.delete(c);
    return false;
  }

  if (!backtrack(0)) return null;

  const mines = new Set(mineSet);
  for (const [cell, isMine] of assignment) {
    if (isMine) mines.add(cell);
  }

  const interiorMines = totalMines - mines.size;
  shuffle(interiorCells);
  for (let i = 0; i < interiorMines; i++) {
    mines.add(interiorCells[i]);
  }

  return mines;
}

export function verify({ rows, cols, totalMines, revealed, forcedMine, forcedEmpty, mines }) {
  const key = (r, c) => r * cols + c;

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
      if (mines.has(key(nr, nc))) count++;
    }
    if (count !== number) {
      return { valid: false, reason: `number mismatch at (${row},${col}): expected ${number}, got ${count}` };
    }
  }

  return { valid: true };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
