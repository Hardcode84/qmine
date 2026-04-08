import { solve, neighbors as getNeighbors } from './solver.js';

export const HIDDEN = 0;
export const REVEALED = 1;
export const FLAGGED = 2;
export const QMINE = 3;
export const QEMPTY = 4;

export class Game {
  constructor(rows, cols, mineCount) {
    this.rows = rows;
    this.cols = cols;
    this.mineCount = mineCount;
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

  key(r, c) { return r * this.cols + c; }

  neighbors(r, c) { return getNeighbors(r, c, this.rows, this.cols); }

  _placeMines(safeRow, safeCol) {
    const safe = new Set();
    safe.add(this.key(safeRow, safeCol));
    for (const [nr, nc] of this.neighbors(safeRow, safeCol)) {
      safe.add(this.key(nr, nc));
    }

    let candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!safe.has(this.key(r, c))) candidates.push([r, c]);
      }
    }

    // Shrink safe zone if board is too small to fit all mines
    if (candidates.length < this.mineCount) {
      candidates = [];
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (r !== safeRow || c !== safeCol) candidates.push([r, c]);
        }
      }
    }

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (let i = 0; i < this.mineCount && i < candidates.length; i++) {
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
        if (this.cells[r][c].mine) continue;
        let count = 0;
        for (const [nr, nc] of this.neighbors(r, c)) {
          if (this.cells[nr][nc].mine) count++;
        }
        this.cells[r][c].number = count;
      }
    }
  }

  reveal(row, col) {
    if (this.gameOver || this.won) return;
    const cell = this.cells[row][col];
    if (cell.state !== HIDDEN) return;

    if (!this.started) this._placeMines(row, col);

    if (cell.mine) {
      this.gameOver = true;
      this.endTime = Date.now();
      cell.state = REVEALED;
      return;
    }

    this._floodFill(row, col);
    this._checkWin();
  }

  _floodFill(row, col) {
    const cell = this.cells[row][col];
    if (cell.state !== HIDDEN) return;
    if (cell.mine) return;

    cell.state = REVEALED;
    if (cell.number === 0) {
      for (const [nr, nc] of this.neighbors(row, col)) {
        this._floodFill(nr, nc);
      }
    }
  }

  cycleFlag(row, col) {
    if (this.gameOver || this.won) return;
    const cell = this.cells[row][col];
    if (cell.state === REVEALED) return;

    const cycle = [HIDDEN, FLAGGED, QMINE, QEMPTY];
    const idx = cycle.indexOf(cell.state);
    cell.state = cycle[(idx + 1) % cycle.length];
  }

  chord(row, col) {
    if (this.gameOver || this.won) return;
    const cell = this.cells[row][col];
    if (cell.state !== REVEALED || cell.number <= 0) return;

    let flagCount = 0;
    const toReveal = [];
    for (const [nr, nc] of this.neighbors(row, col)) {
      const n = this.cells[nr][nc];
      if (n.state === FLAGGED || n.state === QMINE) {
        flagCount++;
      } else if (n.state === HIDDEN) {
        toReveal.push([nr, nc]);
      }
    }

    if (flagCount !== cell.number) return;
    for (const [nr, nc] of toReveal) this.reveal(nr, nc);
  }

  hasQFlags() {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const s = this.cells[r][c].state;
        if (s === QMINE || s === QEMPTY) return true;
      }
    return false;
  }

  collapse() {
    if (this.gameOver || this.won) return { success: false, reason: 'game_over' };

    const qMines = [];
    const qEmpties = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const s = this.cells[r][c].state;
        if (s === QMINE) qMines.push([r, c]);
        if (s === QEMPTY) qEmpties.push([r, c]);
      }
    }

    if (qMines.length === 0 && qEmpties.length === 0) {
      return { success: false, reason: 'no_qflags' };
    }

    const revealed = [];
    if (this.started) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (this.cells[r][c].state === REVEALED) {
            revealed.push({ row: r, col: c, number: this.cells[r][c].number });
          }
        }
      }
    }

    const forcedMine = [
      ...[...this.confirmedMines].map(k => [Math.floor(k / this.cols), k % this.cols]),
      ...qMines,
    ];

    const result = solve({
      rows: this.rows,
      cols: this.cols,
      totalMines: this.mineCount,
      revealed,
      forcedMine,
      forcedEmpty: qEmpties,
    });

    if (result === null) {
      this.gameOver = true;
      this.decoherence = true;
      this.endTime = Date.now();
      return { success: false, reason: 'decoherence' };
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.cells[r][c].mine = result.has(this.key(r, c));
      }
    }
    this._computeNumbers();

    if (!this.started) {
      this.started = true;
      this.startTime = Date.now();
    }

    const qCount = qMines.length + qEmpties.length;
    this.quantumScore += qCount;

    for (const [r, c] of qMines) {
      this.cells[r][c].state = FLAGGED;
      this.confirmedMines.add(this.key(r, c));
    }

    for (const [r, c] of qEmpties) {
      this.cells[r][c].state = HIDDEN;
      this.cells[r][c].quantum = true;
    }
    for (const [r, c] of qEmpties) {
      this._floodFill(r, c);
    }

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
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const s = this.cells[r][c].state;
        if (s === FLAGGED || s === QMINE) flagged++;
      }
    return this.mineCount - flagged;
  }

  elapsedSeconds() {
    if (!this.startTime) return 0;
    const end = this.endTime || Date.now();
    return Math.floor((end - this.startTime) / 1000);
  }
}
