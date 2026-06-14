# Multiplayer Split-Screen Versus — build spec (researched + adversarially reviewed)

Design phase, internal only. Produced by a research+design+review pass (GH/Rock Band/Clone Hero MP
research + engine/HUD/MP-sync mapping + adversarial review). Verdict: **build-with-changes** (changes folded
in below). Brand: warm black + crimson + chrome (gold only for overdrive). Engine-compat: NO `:has()` /
`@container` (older app engine) — gate everything with a JS class.

## The shape
TRUE 50/50 split: **opponent ghost deck LEFT, YOUR deck RIGHT**, one shared bottom contact-line, a thin
crimson→chrome center seam that owns the SHARED HUD (synced 3·2·1 countdown, VS badge, vertical LEAD bar,
signed score-delta, ONE shared song-progress bar). Each player's private HUD sits on THEIR half near the
seam/edges — never read across the seam for your own stats (RB3 lesson).

## Key engineering realities (why this is feasible + cheap)
- **Canvas auto-refits to a half cell with ZERO engine math** — `resize()` reads `.game-center`'s box; the
  5-lane string-measured geometry (`fretGeom`→`guitarRect`, `ART.bridgeXF/nutXF`, cover-fit) re-fits into
  the narrower box. **PROVEN (P1):** at a 640px half-cell the catchers ride the painted strings exactly
  (`_cap_v140_vs_right`). The ONLY css needed is `#game.vs-mode` + `min-width:0` on the deck cell (so the
  1fr column can shrink below the canvas's intrinsic width) + a fired `resize` after the class toggle.
- **No second engine instance** — the engine is a singleton IIFE (one `#hwy`, one rAF, global audio/input/
  scoring; judgment is 100% local by contract). The opponent is a **lightweight GHOST DECK** on its own
  small canvas, NOT a 2nd engine.
- **We don't stream the opponent's notes** — both clients share the same chart + `atMs`, so the ghost deck
  scrolls the SAME notes in sync; hit/miss FEEL is inferred from the score/combo stream (combo up = hit
  sparkle, combo reset = miss flash), driven by a small additive broadcast.
- **The synced start already exists** — `maybeStart()` broadcasts `atMs`; both run `beginMatch(atMs)`;
  `startAt`→`setTimeout(play, atMs-now)` is atMs-synced. Only the visible 3·2·1 is missing.

## Compact HUD (the big side panels are GONE)
- YOUR score: top-inner corner of the right deck (hugging seam). Opponent score: mirrored top-inner left.
  The two flank the seam → who's-ahead is one glance.
- Multiplier: small circular chip at the contact line (inner edge). Overdrive: slim ~6px gold bar at the
  BOTTOM of each deck (full deck width). Combo: small chip near the contact line. Stability: thin vertical
  bar on the OUTER edge of each deck.
- Center seam: vertical LEAD bar (biases toward whoever leads) + bold signed delta + VS badge + one shared
  progress hairline. Accuracy / max-combo / judgment log → DEMOTED to the end-of-song winner card.

## Opponent stream (additive — never touch the 6/s `tick`)
New event `state` on the match channel, ~12–15/s from the existing `startTick` rAF (own cadence gate):
`{ sc, cb, mu, od, oda, st, pr, ev:[{l:lane, j:'p'|'g'|'m'} …≤4] }`. Receive → store `lastOppState` → ease
meters (lerp ~0.25) → fire one-shot lane sparkles on `ev`. **Degrade:** no `state` >1s → drive from the 6/s
`tick`; stream gone/oppLeft → collapse ghost to the existing `#mp-opp` stats card.

## REQUIRED CHANGES from the review (do these)
1. **P1 first, prove alignment** — toggle `vs-mode`, fire resize, verify `lanesPx().nearX` lands on the
   strings in the half box BEFORE any HUD/stream work. ✅ DONE (v140).
2. **Hits buffer hook:** push `{lane,judge}` in `missNote()` (has `note.lane`) and the HIT resolver call
   sites (where `spawnHitParticles(lane,kind)` is called) — NOT `flashJudgment()` (it has no lane).
3. **Ghost perf:** fixed pre-allocated sparkle POOL (write-in-place), cache lane geometry once on
   mount/resize — zero per-event/per-frame literals (the engine's own particle helpers GC-thrash; don't copy that).
4. **Brand:** override the inherited green `#2fd27a` (ahead) + cyan (`#mhud .m-acc`, progress) — vs-mode:
   ahead=chrome/gold, behind=crimson, bars=crimson→chrome. No blue.
5. **Clock skew:** normalize the LEAD bar by PROGRESS (compare scores at equal `getLiveStats().progress`),
   not wall-clock; optional ping-offset for the countdown.
6. **Data plumbing first:** land `getRenderFrame()` + hits buffer + the additive `state` broadcast as a
   no-op pass and prove `tick`/winner-settle/spectate/tournament still work, BEFORE building HUD against it.
7. **Degrade seam:** generalize a `mountOppRenderer` out of `spectateMatch` WITHOUT its `finishedLocal=true`
   side effect (you ARE playing locally in versus).
8. **Responsive / PLATFORM GATING (firm rule):** SPLIT-SCREEN IS DESKTOP/PC ONLY. On **mobile** (and any
   narrow window ≤900px), multiplayer AND tournaments run **SINGLE-DECK** — your full highway + the
   opponent as the compact `#mp-opp` stats card, NEVER a second highway (two half-width decks are
   unplayable on a phone; shipping that = shipping broken). Two layers:
   - **CSS safety net (done, v141):** inside the existing `@media (max-width:900px)` block, `.game-screen.
     active` is already `display:block` + `.game-center` full-screen, so `vs-mode` can't split there; we
     also force `#vs-opp-deck { display:none !important }` on mobile. Verified at 430px: deck stays
     full-width, opponent deck hidden, lanes on the strings.
   - **JS gate (P4):** `beginMatch` only adds `.vs-mode` when `!isMobile()` (the engine's existing
     `matchMedia('(max-width:900px)')`); on mobile it runs the current single-deck + `#mp-opp` card path.
   - Desktop narrow windows: a debounced ResizeObserver `.vs-narrow` fallback can still collapse to single
     deck (no `:has`/`@container`); re-fire resize+verify on every narrow↔wide flip.

## Build phases
- **P1 — split layout + alignment proof** ✅ DONE (v140): `#game.vs-mode` CSS (2×1fr, hide `.hud-panel`,
  your deck right, `min-width:0`); verified the half-width deck keeps catchers on the strings.
- **P2 — data plumbing (review #6):** `getRenderFrame()` + hits ring-buffer + additive `state` broadcast;
  prove `tick`/winner/spectate/tournament unaffected.
- **P3 — compact HUD + synced 3·2·1 countdown:** the edge/seam HUD (brand-clean), widen `atMs` lead-in to
  ~3600ms, paint the countdown off shared `atMs`; lead bar normalized by progress.
- **P4 — ghost highway renderer:** `<canvas id="vs-opp-hwy">` in `#vs-opp-deck`, geometry from a read-only
  `getLaneGeom()` getter (don't duplicate constants), pooled sparkles, half-res, throttled to stream
  cadence, FX-off under reduced-motion; degrade to the stats card. Wire `beginMatch`→add `vs-mode`,
  `teardownMatch`→remove. Verify perf on the user's on-screen FPS meter (headless rAF is untrustworthy).

Then: B3 animated bracket, B4 winner celebration (FX + generated clip), B5 robustness — see ROADMAP.md.
