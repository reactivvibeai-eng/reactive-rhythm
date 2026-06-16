# Split-screen Versus HUD — "The Crimson Meridian" (validated spec)

Produced by a design+judge+adversarial-verify workflow (4 concepts × diverse lenses → judge panel →
synthesis re-checked against the real code). Winner: **seam-minimal** (43), grafting in rockband-mirror's
stat-discipline (also 43), esports' degrade-ladder, and two fighting-game spectacle beats. Anchors below
were re-verified against the live files.

## The shape
TRUE 50/50 split (desktop only; ≤900px = single deck + `#mp-opp` card). **YOUR deck = RIGHT** (`.game-center`,
crimson), **opponent ghost = LEFT** (`#vs-opp-deck`, chrome). A thin crimson→chrome **center seam** carries the
shared read: a progress hairline, one **signed delta** number (raw gap), and a vertical **lead bar**
(progress-normalized `(myPace−opPace)/(myPace+opPace+1)`, clock-skew-safe). Private stats never cross the seam.

- **Scores:** big, flanking the seam — YOUR score crimson top-left-inner of the right deck; OPP score chrome
  top-right-inner of the left deck (color alone distinguishes them). Feathered warm-black radial scrim behind each.
- **Multiplier / combo:** demoted to tiny pills on the **outer** edges (reuse `#mult-gauge`/`#combo-display`
  via `#game.vs-mode` CSS — restores to single-player layout on teardown).
- **Overdrive:** slim ~6px **gold underglow** along each deck's bottom (`#vs-od-you`/`#vs-od-opp`), READY pulse + SPACE tag.
- **Spectacle (scoped, never crowds the seam):** YOUR overdrive → full-deck gold wash + seam rim-light (~600ms);
  lead **sign-flip** → crimson↔gold jolt on the delta (~400ms).

## Synced countdown (in the centered card, NOT the seam)
The decks aren't on screen until `showScreen('game')` at `atMs`. So the 3·2·1·GO! paints in the existing
`#mpx-go-num` card during the lead-in. Widen the lead-in on BOTH paths via one shared `VS_LEADIN_MS = 3600`
(maybeStart 1300→, tournament 2600→, + startRoomMatch). A tiny rAF computes `atMs − Date.now()` (frame-synced
across machines off the shared atMs) → "GET READY"→3→2→1→GO!.

## VS intro (after the handoff, desktop only, reduced-motion early-out)
At `atMs+80` (engine live): seam wipes top→bottom, decks part ~12px from the seam, "VS" flashes, score plates
fly to their corners — the reveal teaches "you = right/crimson, opp = left/chrome". ~700ms one-shot.

## Ghost deck (P4) — lightweight, NOT a 2nd engine
`<canvas id="vs-opp-hwy">` at half-res. Re-base `getLaneFrame()` (page coords) into the ghost's own box.
Ship **strings + inferred FX** (multiplayer.js has no note list): dim chrome lane strings + a **pre-allocated
~24-slot sparkle pool** fired from `lastOppState.ev` (`p`/`g`→chrome sparkle, `m`→crimson dud), gold edge
vignette on opp overdrive. Ease all opp meters (lerp ~0.2) off the ~13/s stream. **Degrade:** no `state` >1s →
drive meters from the 6/s `tick` + "LAG" tag; `oppLeft` → tear down ghost, mount `#mp-opp` card into `#vs-opp-deck`.

## Build order
- **P3.0** Brand overrides (global): `.mpx-ready.armed` green→crimson (L2555), `#mp-opp .mo-live` green→chrome
  (L2575), `#mp-opp .mo-delta.ahead` green→gold (L2583). Leave the warm-safe `--cyan/--green/--gold` tokens.
- **P3.1** `VS_LEADIN_MS = 3600` on maybeStart/tournament/startRoomMatch.
- **P3.2** Countdown rAF in the card off shared atMs (`#mpx-go-num` + mpxpop keyframe + `.go` gold).
- **P3.3** `#game.vs-mode` HUD CSS block (after L1060) + `mountVsHud()`/`unmountVsHud()` (inject `#vs-opp-deck`,
  seam, scores, OD bars, opp chips) + beginMatch/teardown wiring (gated `!isMobile()`, fire resize).
- **P3.4** `renderVsHud(stt, myRf)` in startTick — **single** `getRenderFrame()` drain captured as `myRf`,
  reused; eased opp meters; lead bar (pr<0.03 midline guard, lerp 0.2, |Δpr|>0.06 freeze+"~").
- **P3.5** Spectacle beats + `runVsIntro()`.
- **P4.0** Ghost canvas (strings + pooled sparkles). **P4.1** Degrade ladder. **P4.2** User on-machine FPS pass.

## Open risks (human/on-machine)
1. **Perf** (unprovable headless): half-res ghost + sparkle pool must hold 60fps on the older Chromium — user
   verifies on the on-screen FPS meter; strings-only fallback ready.
2. **Score legibility** over Crimson-Chaos god-rays — tune the scrim alpha on a real render.
3. **atMs 3600ms** adds ~2.3s before every match/rematch — must feel like ceremony, not lag (human call; can drop
   to ~2800 once sync is proven).
4. **Ghost note gems** deferred — needs a read-only note-time getter (P4.5) if the user wants real gems.
5. **Tournaments use `startTourTick`, not `startTick`** — gate the split HUD into 1v1 first; decide per-round
   tournament split-screen with the user.
