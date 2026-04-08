import { solve, neighbors as getNeighbors, cellKey } from './solver.js';

export const HIDDEN = 0;
export const REVEALED = 1;
export const FLAGGED = 2;
export const QMINE = 3;
export const QEMPTY = 4;

/**
 * Quantum Minesweeper game state.
 *
 * @param {number} rows      - board height (positive integer)
 * @param {number} cols      - board width  (positive integer)
 * @param {number} mineCount - number of mines (0 ≤ n ≤ rows*cols-1)
 */
export class Game {
  constructor(rows, cols, mineCount, { evilMode = false } = {}) {
    if (!Number.isInteger(rows) || rows <= 0) { throw new Error('rows must be a positive integer'); }
    if (!Number.isInteger(cols) || cols <= 0) { throw new Error('cols must be a positive integer'); }
    this.rows = rows;
    this.cols = cols;
    this.mineCount = Math.max(0, Math.min(mineCount, rows * cols - 1));
    this.evilMode = evilMode;
    this.cells = [];
    this.started = false;
    this.gameOver = false;
    this.decoherence = false;
    this.won = false;
    this.quantumScore = 0;
    this.confirmedMines = new Set();
    this.startTime = null;
    this.endTime = null;
    this._initCells();
  }

  _initCells() {
    this.cells = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        row.push({ mine: false, state: HIDDEN, number: 0, quantum: false });
      }
      this.cells.push(row);
    }
  }

  reset() {
    this.started = false;
    this.gameOver = false;
    this.decoherence = false;
    this.won = false;
    this.quantumScore = 0;
    this.confirmedMines = new Set();
    this.startTime = null;
    this.endTime = null;
    this._initCells();
  }

  key(r, c) { return cellKey(r, c, this.cols); }

  neighbors(r, c) { return getNeighbors(r, c, this.rows, this.cols); }

  _inBounds(row, col) {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  /** @returns {Array<{row:number, col:number, number:number}>} — empty when !started (no cells are REVEALED before game begins). */
  _getRevealedConstraints() {
    const revealed = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state === REVEALED) {
          revealed.push({ row: r, col: c, number: this.cells[r][c].number });
        }
      }
    }
    return revealed;
  }

  /** @returns {Array<[number, number]>} confirmed mine coords for solver forcedMine input. */
  _confirmedMineCoords() {
    return [...this.confirmedMines].map(k => [Math.floor(k / this.cols), k % this.cols]);
  }

  /** Solve for a mine layout with the given forced constraints. */
  _solveLayout(forcedMine, forcedEmpty) {
    return solve({
      rows: this.rows, cols: this.cols, totalMines: this.mineCount,
      revealed: this._getRevealedConstraints(),
      forcedMine,
      forcedEmpty,
    });
  }

  /**
   * Read-only view of a cell for rendering.
   * @param {number} row
   * @param {number} col
   * @returns {{state:number, number:number, mine:boolean, quantum:boolean, confirmedMine:boolean}}
   */
  getCellView(row, col) {
    const cell = this.cells[row][col];
    return {
      state: cell.state,
      number: cell.number,
      mine: cell.mine,
      quantum: cell.quantum,
      confirmedMine: this.confirmedMines.has(this.key(row, col)),
    };
  }

  /** Whether a cell state counts as a flag for chord purposes. */
  isChordFlag(state) {
    return state === FLAGGED || state === QMINE;
  }

  /** Whether a cell state is revealable by chord. */
  isChordRevealable(state) {
    return state === HIDDEN;
  }

  _placeMines(safeRow, safeCol) {
    const safe = new Set();
    safe.add(this.key(safeRow, safeCol));
    for (const [nr, nc] of this.neighbors(safeRow, safeCol)) {
      safe.add(this.key(nr, nc));
    }

    let candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!safe.has(this.key(r, c))) {
          candidates.push([r, c]);
        }
      }
    }

    if (candidates.length < this.mineCount) {
      candidates = [];
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (r !== safeRow || c !== safeCol) {
            candidates.push([r, c]);
          }
        }
      }
    }

    // Clamp mine count to available space
    this.mineCount = Math.min(this.mineCount, candidates.length);

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (let i = 0; i < this.mineCount; i++) {
      const [r, c] = candidates[i];
      this.cells[r][c].mine = true;
    }

    this._computeNumbers();
    this.started = true;
    this.startTime = Date.now();
  }

  _computeNumbers() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].mine) { continue; }
        let count = 0;
        for (const [nr, nc] of this.neighbors(r, c)) {
          if (this.cells[nr][nc].mine) { count++; }
        }
        this.cells[r][c].number = count;
      }
    }
  }

  reveal(row, col) {
    if (this.gameOver || this.won) return;
    if (!this._inBounds(row, col)) return;
    const cell = this.cells[row][col];
    if (cell.state !== HIDDEN) return;

    if (this.evilMode) {
      this._evilReveal(row, col);
      return;
    }

    if (!this.started) { this._placeMines(row, col); }

    if (cell.mine) {
      this.gameOver = true;
      this.endTime = Date.now();
      cell.state = REVEALED;
      return;
    }

    this._floodFill(row, col);
    this._checkWin();
  }

  /** Iterative flood fill (BFS) to avoid stack overflow on large boards. */
  _floodFill(startRow, startCol) {
    const stack = [[startRow, startCol]];
    while (stack.length > 0) {
      const [row, col] = stack.pop();
      const cell = this.cells[row][col];
      if (cell.state !== HIDDEN || cell.mine) { continue; }

      cell.state = REVEALED;
      if (cell.number === 0) {
        for (const [nr, nc] of this.neighbors(row, col)) {
          if (this.cells[nr][nc].state === HIDDEN) {
            stack.push([nr, nc]);
          }
        }
      }
    }
  }

  /** Adversarial reveal: kills if any valid layout has a mine at (row, col). */
  _evilReveal(row, col) {
    const confirmed = this._confirmedMineCoords();

    if (!this.started) {
      const layout = this._solveLayout(confirmed, [[row, col]]);
      if (!layout) {
        this.gameOver = true;
        this.decoherence = true;
        this.endTime = Date.now();
        return;
      }
      this._applyMineLayout(layout);
      this.started = true;
      this.startTime = Date.now();
      this._floodFill(row, col);
      this._checkWin();
      return;
    }

    const deathLayout = this._solveLayout([...confirmed, [row, col]], []);
    if (deathLayout) {
      this._applyMineLayout(deathLayout);
      this.cells[row][col].state = REVEALED;
      this.gameOver = true;
      this.endTime = Date.now();
      return;
    }

    const safeLayout = this._solveLayout(confirmed, [[row, col]]);
    if (safeLayout) {
      this._applyMineLayout(safeLayout);
      this._floodFill(row, col);
      this._checkWin();
      return;
    }

    this.gameOver = true;
    this.decoherence = true;
    this.endTime = Date.now();
  }

  setQState(row, col, target) {
    if (this.gameOver || this.won) return;
    if (!this._inBounds(row, col)) return;
    const cell = this.cells[row][col];
    if (cell.state === REVEALED) return;
    cell.state = cell.state === target ? HIDDEN : target;
  }

  cycleFlag(row, col) {
    if (this.gameOver || this.won) return;
    if (!this._inBounds(row, col)) return;
    const cell = this.cells[row][col];
    if (cell.state === REVEALED) return;

    const cycle = [HIDDEN, FLAGGED, QMINE, QEMPTY];
    const idx = cycle.indexOf(cell.state);
    cell.state = cycle[(idx + 1) % cycle.length];
  }

  chord(row, col) {
    if (this.gameOver || this.won) return;
    if (!this._inBounds(row, col)) return;
    const cell = this.cells[row][col];
    if (cell.state !== REVEALED || cell.number <= 0) return;

    let flagCount = 0;
    const toReveal = [];
    for (const [nr, nc] of this.neighbors(row, col)) {
      const n = this.cells[nr][nc];
      if (this.isChordFlag(n.state)) {
        flagCount++;
      } else if (this.isChordRevealable(n.state)) {
        toReveal.push([nr, nc]);
      }
    }

    if (flagCount !== cell.number) return;
    for (const [nr, nc] of toReveal) {
      this.reveal(nr, nc);
    }
  }

  hasQFlags() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const s = this.cells[r][c].state;
        if (s === QMINE || s === QEMPTY) { return true; }
      }
    }
    return false;
  }

  _gatherQFlags() {
    const qMines = [];
    const qEmpties = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const s = this.cells[r][c].state;
        if (s === QMINE) { qMines.push([r, c]); }
        if (s === QEMPTY) { qEmpties.push([r, c]); }
      }
    }
    return { qMines, qEmpties };
  }

  _applyMineLayout(mineSet) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.cells[r][c].mine = mineSet.has(this.key(r, c));
      }
    }
    this._computeNumbers();
  }

  _finalizeQuantumFlags(qMines, qEmpties) {
    for (const [r, c] of qMines) {
      this.cells[r][c].state = FLAGGED;
      this.confirmedMines.add(this.key(r, c));
    }

    // Set state to HIDDEN before flood fill so _floodFill can process them
    for (const [r, c] of qEmpties) {
      this.cells[r][c].state = HIDDEN;
      this.cells[r][c].quantum = true;
    }
    for (const [r, c] of qEmpties) {
      this._floodFill(r, c);
    }
  }

  /**
   * Collapse all current q-flags.
   * @returns {{success: boolean, reason?: string, qCount?: number}}
   */
  collapse() {
    if (this.gameOver || this.won) {
      return { success: false, reason: 'game_over' };
    }

    const { qMines, qEmpties } = this._gatherQFlags();
    if (qMines.length === 0 && qEmpties.length === 0) {
      return { success: false, reason: 'no_qflags' };
    }

    const result = this._solveLayout(
      [...this._confirmedMineCoords(), ...qMines],
      qEmpties,
    );

    if (result === null) {
      this.gameOver = true;
      this.decoherence = true;
      this.endTime = Date.now();
      return { success: false, reason: 'decoherence' };
    }

    this._applyMineLayout(result);

    if (!this.started) {
      this.started = true;
      this.startTime = Date.now();
    }

    const qCount = qMines.length + qEmpties.length;
    this.quantumScore += qCount;

    this._finalizeQuantumFlags(qMines, qEmpties);
    this._checkWin();
    return { success: true, qCount };
  }

  _checkWin() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (!cell.mine && cell.state !== REVEALED) return;
      }
    }
    this.won = true;
    this.endTime = Date.now();
  }

  minesRemaining() {
    let flagged = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const s = this.cells[r][c].state;
        if (s === FLAGGED || s === QMINE) { flagged++; }
      }
    }
    return this.mineCount - flagged;
  }

  elapsedSeconds() {
    if (!this.startTime) return 0;
    const end = this.endTime || Date.now();
    return Math.floor((end - this.startTime) / 1000);
  }
}
