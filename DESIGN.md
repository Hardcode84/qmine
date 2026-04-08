# Quantum Minesweeper — Design Document

## Concept

Standard minesweeper with one addition: **quantum clicks**.

Normal clicks work exactly like classic minesweeper — reveal a cell
against the real mine layout, risk explosion, cost nothing.

Right-clicking cycles an unopened cell through: none → flag → q-mine →
q-empty → none. Q-mine and q-empty are quantum assertions — you can
place as many as you want, then press the **Collapse** button. The
board reshuffles to satisfy all assertions at once: q-mines become
normal flags, q-empties open like normal reveals. If no valid layout
exists, you die ("quantum decoherence").

**Goal:** solve the board minimizing the total number of q-flags used.


## Rules

1. Game starts with a real, fixed mine layout (standard minesweeper).
2. Left-click → normal reveal (can explode, free).
3. Right-click cycles cell state: none → flag → q-mine → q-empty → none.
4. Flag = standard minesweeper flag (cosmetic, no game effect).
5. Q-mine / q-empty = quantum assertions (batched, not immediate).
6. **Collapse button** → triggers reshuffle considering ALL current
   q-flags at once. On success:
   - q-mine cells become normal flags.
   - q-empty cells open like a normal left-click (flood-fill if 0).
   - Each collapse increments quantum score by number of q-flags used.
   If no valid layout exists → game over ("quantum decoherence").
7. Win when all non-mine cells are revealed.
8. Score = total number of q-flags collapsed (lower is better).


## Reshuffle Constraints

When the Collapse button is pressed, the solver finds a new mine
layout satisfying ALL of:

- Every revealed cell keeps its displayed number.
- All previous quantum assertions (from earlier collapses) hold.
- All current q-mine cells have mines.
- All current q-empty cells have no mines.
- Total mine count is preserved.
- New layout is randomly sampled from valid configurations
  (not deterministic — prevents exploitation).


## Architecture

```
┌─────────────┐
│   UI Layer  │  clicks, right-clicks, collapse button
└──────┬──────┘
       │
┌──────▼──────┐
│  Game State │  grid, revealed cells + numbers, flags,
│             │  quantum assertions, mine count, score
└──────┬──────┘
       │
┌──────▼──────┐
│  CSP Solver │  runs ONLY on collapse
│             │  finds valid layout satisfying all constraints
└─────────────┘
```

Normal clicks never touch the solver — just check the real grid.


## CSP Solver Approach

Coupled-sets backtracking:

1. Identify boundary cells (hidden, adjacent to a revealed number).
2. Partition boundary into independent constraint groups.
3. For each group, enumerate valid mine assignments via backtracking
   with constraint propagation.
4. Interior (non-boundary) hidden cells are unconstrained except by
   total mine count — handle combinatorially.
5. Randomly sample a full valid configuration from the solution space.

For standard board sizes (up to 30×16), this runs in milliseconds.


## UI / UX

- Looks and feels like classic minesweeper.
- Full standard controls:
  - Left-click: reveal cell.
  - Right-click: cycle unopened cell: none → flag → q-mine → q-empty → none.
  - Chord (left+right on revealed number): if adjacent flags match
    the number, reveal all unflagged neighbors. Implemented by
    tracking button state via mousedown/mouseup + event.buttons
    bitmask. Middle-click as alternative chord trigger.
- Q-mine and q-empty cells get distinct visual indicators
  (e.g. tinted flag, tinted question mark, glow).
- Collapse button visible when any q-flags are placed.
- Cells resolved by collapse get a subtle permanent marker so the
  player can see which cells were "forced" vs normally revealed.
- Quantum score counter displayed prominently.
- Optional: show per-cell mine probability (togglable, for learning).


## Board Sizes

| Difficulty   | Size  | Mines |
|--------------|-------|-------|
| Beginner     | 9×9   | 10    |
| Intermediate | 16×16 | 40    |
| Expert       | 30×16 | 99    |


## Solver Testing

Tests run in the browser via a `test.html` page — no Node/Bun/Deno
required. Imports the solver as an ES module, runs assertions, renders
pass/fail results in the page. Open `test.html` in any browser to run.

Solver is a pure JS ES module (`solver.js`) with no DOM dependencies,
importable by both the game (`index.html`) and tests (`test.html`).

### Test Categories

**Constraint satisfaction — valid inputs**
- Revealed number cells: output layout must produce identical numbers.
- Total mine count preserved after reshuffle.
- Q-mine cells have mines in output.
- Q-empty cells have no mines in output.
- Previous quantum assertions still hold after adding new ones.

**Infeasibility detection**
- Contradictory q-flags (same cell marked q-mine and q-empty — UI
  prevents this, but solver should reject).
- Q-empty on a cell where every valid config has a mine → no solution.
- Q-mine on a cell where every valid config has no mine → no solution.
- More q-mines than remaining mine count → no solution.
- More q-empties than remaining safe count → no solution.

**Correctness on known boards**
- Fully determined board (all cells deducible): solver returns the
  unique valid layout.
- Board with exactly 2 valid layouts: q-flag that distinguishes them
  forces the correct one.
- Minimal boards (e.g. 3×3 with 1 mine, partial reveal) with
  hand-verified solutions.

**Randomness**
- Multiple solver calls on ambiguous boards produce different valid
  layouts (statistical test over N runs).

**Edge cases**
- Empty board (no reveals yet, no constraints): any layout valid.
- Fully revealed board: only one layout possible.
- Single unrevealed cell: mine count determines it exactly.
- Corner/edge cells with fewer neighbors.

**Performance**
- Expert board (30×16, 99 mines) mid-game state: solver completes
  in < 1 second.
- Worst-case boundary: long chain of coupled constraints.


## Tech Stack

Static browser game: HTML + CSS + JS, no dependencies, no build step.
Hostable on GitHub Pages as-is. Retro minesweeper aesthetic.
Single HTML file (or small file set with index.html entry point).
