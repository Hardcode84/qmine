import { Game, HIDDEN, REVEALED, FLAGGED, QMINE, QEMPTY } from './game.js';

const CELL_SIZE = 28;
const STATUS_CLEAR_MS = 3000;

const DIFFICULTIES = {
  beginner:     { rows: 9,  cols: 9,  mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert:       { rows: 16, cols: 30, mines: 99 },
  brutal:       { rows: 16, cols: 30, mines: 140 },
};

const boardEl = document.getElementById('board');
const mineCounterEl = document.getElementById('mine-counter');
const timerEl = document.getElementById('timer');
const qScoreEl = document.getElementById('quantum-score');
const collapseBtn = document.getElementById('collapse-btn');
const newGameBtn = document.getElementById('new-game-btn');
const difficultyEl = document.getElementById('difficulty');
const statusEl = document.getElementById('status-msg');
const gameEl = document.getElementById('game');
const evilModeEl = document.getElementById('evil-mode');

let game = null;
let cellEls = [];
let timerInterval = null;
let buttonsDown = 0;
let statusTimeout = null;

function showStatus(text, cls, temporary) {
  if (statusTimeout) { clearTimeout(statusTimeout); }
  statusEl.textContent = text;
  statusEl.className = cls || '';
  if (temporary) {
    statusTimeout = setTimeout(() => {
      if (!game.gameOver && !game.won) {
        statusEl.textContent = '';
        statusEl.className = '';
      }
    }, STATUS_CLEAR_MS);
  }
}

function newGame() {
  clearInterval(timerInterval);
  timerInterval = null;
  const d = DIFFICULTIES[difficultyEl.value];
  if (!d) return;
  game = new Game(d.rows, d.cols, d.mines, { evilMode: evilModeEl.checked });
  buildBoard();
  render();
}

function buildBoard() {
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${game.cols}, ${CELL_SIZE}px)`;
  cellEls = [];

  for (let r = 0; r < game.rows; r++) {
    const row = [];
    for (let c = 0; c < game.cols; c++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.dataset.row = r;
      el.dataset.col = c;
      boardEl.appendChild(el);
      row.push(el);
    }
    cellEls.push(row);
  }
}

function render() {
  for (let r = 0; r < game.rows; r++) {
    for (let c = 0; c < game.cols; c++) {
      renderCell(r, c);
    }
  }

  const rem = game.minesRemaining();
  if (rem < 0) {
    mineCounterEl.textContent = '-' + String(Math.abs(rem)).padStart(2, '0');
  } else {
    mineCounterEl.textContent = String(rem).padStart(3, '0');
  }

  qScoreEl.textContent = `Q:${game.quantumScore}`;

  const hasQ = game.hasQFlags() && !game.gameOver && !game.won;
  collapseBtn.classList.toggle('active', hasQ);
  gameEl.classList.toggle('evil-mode', game.evilMode);

  if (game.won) {
    newGameBtn.textContent = '😎';
    showStatus(`Cleared! Quantum moves: ${game.quantumScore}`, '');
  } else if (game.gameOver && game.decoherence) {
    newGameBtn.textContent = '🌀';
    showStatus('Quantum decoherence — no valid layout!', 'decoherence');
  } else if (game.gameOver) {
    newGameBtn.textContent = '💀';
    showStatus('Hit a mine!', '');
  } else {
    newGameBtn.textContent = '🙂';
    showStatus('', '');
  }

  updateTimer();
}

function renderCell(r, c) {
  const v = game.getCellView(r, c);
  const el = cellEls[r][c];
  el.className = 'cell';
  el.textContent = '';

  if (game.gameOver && !game.decoherence) {
    if (v.state === REVEALED && v.mine) {
      el.classList.add('exploded');
      el.textContent = '💣';
      return;
    }
    if (v.mine && v.state !== FLAGGED) {
      el.classList.add('mine-shown');
      el.textContent = '💣';
      return;
    }
    if (v.state === FLAGGED && !v.mine) {
      el.classList.add('wrong-flag');
      el.textContent = '🚩✕';
      return;
    }
  }

  switch (v.state) {
    case HIDDEN:
      break;
    case REVEALED:
      el.classList.add('revealed');
      if (v.quantum) { el.classList.add('quantum-resolved'); }
      if (v.number > 0) {
        el.classList.add('n' + v.number);
        el.textContent = v.number;
      }
      break;
    case FLAGGED:
      if (v.confirmedMine) {
        el.classList.add('confirmed-flag');
        el.textContent = '⚑';
      } else {
        el.classList.add('flagged');
        el.textContent = '🚩';
      }
      break;
    case QMINE:
      el.classList.add('qmine');
      el.textContent = '⚑';
      break;
    case QEMPTY:
      el.classList.add('qempty');
      el.textContent = '◇';
      break;
  }
}

function updateTimer() {
  timerEl.textContent = String(Math.min(game.elapsedSeconds(), 999)).padStart(3, '0');
}

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    if (game.gameOver || game.won) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    updateTimer();
  }, 1000);
}

function getCellCoords(e) {
  const el = e.target.closest('.cell');
  if (!el) return null;
  return { row: +el.dataset.row, col: +el.dataset.col };
}

// --- Input handling ---

boardEl.addEventListener('contextmenu', e => e.preventDefault());

boardEl.addEventListener('mousedown', e => {
  buttonsDown |= e.button === 0 ? 1 : e.button === 2 ? 2 : 4;
  if (game.gameOver || game.won) return;

  const pos = getCellCoords(e);
  if (pos && (buttonsDown & 3) === 3) {
    highlightChordTargets(pos.row, pos.col);
  }
});

boardEl.addEventListener('mouseup', e => {
  const pos = getCellCoords(e);
  const wasBoth = (buttonsDown & 3) === 3;
  buttonsDown &= ~(e.button === 0 ? 1 : e.button === 2 ? 2 : 4);

  if (!pos || game.gameOver || game.won) {
    clearHighlights();
    return;
  }

  const { row, col } = pos;

  if (wasBoth || e.button === 1) {
    game.chord(row, col);
    startTimer();
  } else if (e.button === 0 && !(buttonsDown & 2)) {
    game.reveal(row, col);
    startTimer();
  } else if (e.button === 2 && !(buttonsDown & 1)) {
    game.cycleFlag(row, col);
  }

  clearHighlights();
  render();
});

boardEl.addEventListener('mouseleave', () => {
  clearHighlights();
});

document.addEventListener('mouseup', e => {
  buttonsDown &= ~(e.button === 0 ? 1 : e.button === 2 ? 2 : 4);
});

// Reset button state when focus/visibility changes
window.addEventListener('blur', () => { buttonsDown = 0; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { buttonsDown = 0; }
});

// --- Touch handling ---
const LONG_PRESS_MS = 300;
let touchTimer = null;
let touchCell = null;
let touchHandled = false;

function getCellFromTouch(touch) {
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  if (!el) { return null; }
  const cell = el.closest('.cell');
  if (!cell) { return null; }
  return { row: +cell.dataset.row, col: +cell.dataset.col };
}

boardEl.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { return; }
  e.preventDefault();
  const pos = getCellFromTouch(e.touches[0]);
  touchCell = pos;
  touchHandled = false;
  if (!pos || game.gameOver || game.won) { return; }

  cellEls[pos.row][pos.col].classList.add('pressed');

  touchTimer = setTimeout(() => {
    if (touchCell) {
      game.cycleFlag(touchCell.row, touchCell.col);
      render();
      touchHandled = true;
      if (navigator.vibrate) { navigator.vibrate(50); }
    }
  }, LONG_PRESS_MS);
}, { passive: false });

boardEl.addEventListener('touchmove', e => {
  if (!touchCell) { return; }
  const pos = getCellFromTouch(e.touches[0]);
  if (!pos || pos.row !== touchCell.row || pos.col !== touchCell.col) {
    clearTimeout(touchTimer);
    touchTimer = null;
    cellEls[touchCell.row][touchCell.col].classList.remove('pressed');
  }
}, { passive: true });

boardEl.addEventListener('touchend', e => {
  e.preventDefault();
  clearTimeout(touchTimer);
  touchTimer = null;
  if (touchCell) {
    cellEls[touchCell.row][touchCell.col].classList.remove('pressed');
  }
  if (touchHandled || !touchCell || game.gameOver || game.won) {
    touchCell = null;
    return;
  }
  const { row, col } = touchCell;
  touchCell = null;

  const cell = game.cells[row][col];
  if (cell.state === REVEALED && cell.number > 0) {
    game.chord(row, col);
    startTimer();
  } else if (cell.state === HIDDEN) {
    game.reveal(row, col);
    startTimer();
  }
  render();
}, { passive: false });

boardEl.addEventListener('touchcancel', () => {
  clearTimeout(touchTimer);
  touchTimer = null;
  if (touchCell) {
    cellEls[touchCell.row][touchCell.col].classList.remove('pressed');
  }
  touchCell = null;
});

document.addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    doCollapse();
  }
  if (e.key === 'n' || e.key === 'F2') {
    e.preventDefault();
    newGame();
  }
});

function doCollapse() {
  if (game.gameOver || game.won) return;
  const result = game.collapse();
  if (result.success) {
    startTimer();
  } else if (result.reason === 'no_qflags') {
    showStatus('Place ⚑ or ◇ first', '', true);
  }
  render();
}

function highlightChordTargets(row, col) {
  const cell = game.cells[row][col];
  if (cell.state !== REVEALED) return;
  for (const [nr, nc] of game.neighbors(row, col)) {
    const n = game.cells[nr][nc];
    if (n.state === HIDDEN || n.state === QEMPTY) {
      cellEls[nr][nc].style.borderStyle = 'inset';
    }
  }
  cellEls[row][col].style.borderStyle = 'inset';
}

function clearHighlights() {
  for (let r = 0; r < game.rows; r++) {
    for (let c = 0; c < game.cols; c++) {
      cellEls[r][c].style.borderStyle = '';
    }
  }
}

collapseBtn.addEventListener('click', doCollapse);
newGameBtn.addEventListener('click', newGame);
difficultyEl.addEventListener('change', newGame);
evilModeEl.addEventListener('change', newGame);

newGame();
