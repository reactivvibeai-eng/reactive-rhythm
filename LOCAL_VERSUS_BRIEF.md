# Local couch split-screen versus — engineering plan & status

## Status (build79)
**Groundwork shipped, engine-doubling deferred (by design).** Surfaced behind `?couch=1` so it
does NOT appear in the playtest build until the engine work + 2-person test are done.

- ✅ `couch.js` — the orchestrator: the **device-claim "ready-up" flow** ("press your KEY to claim
  Player 1 · press your CONTROLLER button to claim Player 2"), captures P2's gamepad index, gates
  START on both devices, and the WIN/LOSE verdict screen (reuses the multiplayer.js `showWinner`
  pattern). Exposed as `window.RhythmCouch`.
- ✅ `#hwy2` canvas + `#couch-claim` overlay + split-screen CSS (`body.couch` → two half-width
  decks with a crimson seam). All additive + hidden by default.
- ✅ game.js **untouched** → single-player is byte-identical (verified).
- ⏳ **DEFERRED:** the actual second engine (below) + the mandatory 2-person hardware test.

## Why the engine-doubling was deferred (not skipped)
The engine is **single-instance / single-state / single-canvas**: `score`, `combo`, `notes[]`,
`laneDown[]`, `holdNote[]`, `overdrive` are closure globals in one IIFE behind `window.RhythmGame`.
There is **no Player object to clone.** Making it 2-player means instantiating the engine **twice**.
That is a cross-cutting refactor of the shipped 395KB engine — **79** `window.RhythmGame` sites
inside game.js plus ~100 external callers (catalog.js, multiplayer.js, procbg.js, index.html) all
assume the singleton. And the result **cannot be validated without two humans + a physical
controller** (gamepad input + audio sync + no-cross-drive are all hardware-gated). Doing that during
the pre-Friday stabilization pass would risk breaking the core single-player game right before the
playtest, for zero verifiable upside. So it's a clearly-scoped next effort, ideally in its own window.

## The plan when you greenlight it (from the design-swarm spec)
**Architecture: run TWO real engine instances, NOT one engine with a Player struct.** Refactoring
~200 closure globals into `Player[2]` + threading `playerIndex` through ~40 functions is a multi-week
rewrite that destabilizes the shipped game. Instead, make game.js a **factory** instantiated twice.

### Phase 1 — get two independent scoring lanes rendering (the ~80% hard part)
1. **game.js → factory.** Wrap the IIFE body in `function createEngine(opts){…}`; call
   `createEngine({canvasId:'hwy', expose:'RhythmGame'})` at the bottom (default = byte-identical to
   today). Parameterize: `canvasId`, `expose` (the `window[...]` target — convert the 79
   `window.RhythmGame.x =` sites to build a local `RG` object), `keyMap`, `gamepadIndex`, `clockFn`,
   `lsPrefix`, `noLevelFx`. Mechanical but large; verify single-player surface unchanged after.
2. **DOM/CSS** (already done here): `#hwy`/`#hwy2` in a `body.couch` grid; both engines call
   `setVsMode(true)` → the existing `_vsFit`/`guitarRect()` split branch (game.js:439-457) gives each
   half a full-height runway with **zero new geometry**.
3. **Input isolation (highest risk).** Two `window` keydown listeners + two `pollGamepad`s would
   cross-drive. Clean split: **P1 = keyboard-only** (`gamepadIndex:-1`), **P2 = gamepad-only**
   (`keyMap:{}`, `isP2:true` → keydown early-returns; `pollGamepad` filters `gp.index !==
   opts.gamepadIndex`). P2 Overdrive = a mapped pad button (no Space key).
4. **Shared chart + clock + single audio.** Build the chart once; P2 builds from P1's **same
   beats/seed** (identical timings, its OWN `judged[]` flags — NOT a shared array). ONE audio
   (P1 owns it); P2's `songTime()` reads **P1's clock** (`clockFn: () => RhythmGame.__time()`).
   `startAt(prov,{atMs})` both at one `atMs` so countdown + first note align. P1-clock-authoritative
   = no drift.

### Phase 2 — polish/result (low risk, additive)
Claim-overlay juice, the WIN/LOSE verdict (couch.js already has it), rematch, **P2 lean-render perf
pass** (skip backdrop/procbg/horror-lens — reuse the `fxLite` path; two full rAF loops can halve FPS),
OD-pad binding, seam/HUD brand polish.

### Risks to retest (from the spec)
R1 input cross-drive (hardware) · R2 clock drift / double audio · R3 `window.RhythmGame` singleton
assumptions in catalog/procbg/multiplayer (P2 must be a separate global, no level FX) · R4 localStorage
pollution (`lsPrefix`, P2 never records career) · R5 perf (two rAF loops) · R6 P2 Overdrive pad button ·
R7 shared pause/blur.

## MANDATORY gate before calling it done
A real **2-person hardware test**: one on keyboard, one on a physical controller, same song. Confirm
(a) each deck scores only its own inputs, (b) no audio echo/drift, (c) notes land identically timed on
both halves, (d) verdict picks the right winner, (e) FPS acceptable on the actual machine.
