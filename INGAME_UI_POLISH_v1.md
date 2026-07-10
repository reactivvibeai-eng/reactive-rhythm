# INGAME_UI_POLISH_v1 — Fable 5 ruling: the solo in-play surface

> Scope: **only what a solo player sees while a song is playing** — HUD, highway/strings, hit
> feedback, callouts, combo/multiplier, Overdrive, pause, run in/out. Not menus, not hub, not MP.
> Binding constraints honored throughout: ceiling-safe (the 15 real `score +=` sites stay 15;
> file count incl. 2 comments stays 17 — verified: comments at game.js:307, game.js:5342),
> `CHART_VERSION` 2, `MAX_MULT` 4, difficulty untouched, 5 lanes, measured geometry untouched,
> black·crimson·chrome·gold warm-darks only, Oxanium/Chakra Petch/Unbounded ladder,
> reduce-motion respected, 60fps budget.

---

## §0 — READ THIS FIRST: half his complaint is already fixed and simply UNSHIPPED

The owner playtested **production at `?v=451` = build147**. Local is **`?v=465` = build165** —
fourteen builds of exactly the kind of polish he asked for are sitting on this disk and have
never been in front of him:

| Unshipped thing he'd feel immediately | Build | Where |
|---|---|---|
| **Real audio**: Overdrive-ignite slam, combo-flare chime on every 25-streak, shield-save "coin catch", clear fanfare | 157 | game.js:1221–1232, :1321 |
| **Flow Shield** — an OD-active miss keeps your combo, flashes crimson-gold `◆ SAVED` | 148/156 | game.js:6478 |
| **FEVER ladder** on the multiplier gauge — something visibly climbs past the 4× cap all the way to combo 500 | 160 | game.js:6820–6839 |
| **OD legibility** — `▸ READY — FIRE NOW · DENSE AHEAD` cue + `OVERDRIVE +N` payout tally | 160 | game.js:6845–6851, :5348 |
| **Hold ceremony** (HOLD!→CLEAN!) + SLIP warm-smoke recolor | 160 | game.js:4920 |
| **T6 note grammar** — chord crossbar, hold grip-ring + drain arc, accent spike-ring | 153 | CHANGELOG build153 |
| **Live calibration readout in Pause** ("your hits land ~40ms late" + RE-CALIBRATE) | 164 | CHANGELOG build164 |
| **FOUT fix + label legibility floor + lane-color unification** | 160 | CHANGELOG build160 (index.html) |

**Ruling: the #1 polish action is a deploy, not a spec.** Publish v465 (through the sync-game.mjs
pipeline, never hand-editing `public/game/*`), then have him replay. The audio package alone
(build157) changes the perceived production value more than anything below. Everything in §3 is
written against the **local v465** surface so nothing here re-specifies existing work.

---

## §1 — The honest read: what is actually on screen during play

Desktop composition (`.game-screen.active`, index.html:1847): a `280px | 1fr | 280px` grid.

**The center column is genuinely game-grade. Do not touch its systems.** The canvas already has:
measured strings that heat crimson→orange and shimmer as the multiplier climbs (game.js:7331–7395),
catcher buttons that literally catch fire at ×3 and rage at ×4 (game.js:7259–7271), a strike-line
with a dark contrast seat + crimson underglow + chrome core that flares on hits (game.js:7410–7434),
translucent chrome-rimmed catchers with press-squash (game.js:8253–8286), combo-tier neck energy
whose hue rides the named ladder (game.js:8713–8825, tiers at game.js:447–454), a judgment callout
system with priority arming so ceremonies never get stomped by a plain GREAT (game.js:6657–6664,
:5861 — PERFECT is deliberately wordless; correct, keep), a top-center combo capsule with named
modes, tier recolor, INFERNO shimmer and an ASCENDANT chrome sweep (index.html:2605–2667,
game.js:6871–6882), score count-up + milestone pops (game.js:436, :7155–7158; index.html:2538–2551),
and a per-frame beat var `--rr-beat` the engine writes so DOM chrome breathes with the music
(game.js:7077, index.html:1848–1852). That is a music game.

**What reads as generic-web-app is the frame around it:**

1. **The side panels do not play the game.** The entire center escalates — strings ignite, neck
   energy shifts crimson→gold→chrome, combo capsule changes mode — while the two 280px panels sit
   at room temperature for the whole run: static `linear-gradient` cards, 1px `var(--line)` border,
   backdrop-blur (index.html:2434–2442). The only live thing on them is the brand-dot beat glow
   (index.html:1852). This seam — "game in the middle, dashboard on the sides" — is the single
   biggest tell.

2. **The right panel is an accountant, not a hype man.** The Judgment Log renders four live
   counters + a composition bar mid-run (index.html:7742–7753, updated game.js:6856–6864). Nobody
   reads four JetBrains-Mono tallies at 5 notes/sec; its correct home is the results screen, and
   the results screen already has it. It is the coldest, most "web dashboard" block on screen.

3. **Reality Stability is a health bar with no stakes.** `failMode` defaults false (game.js:353);
   the meter drains (game.js:4933, :5718, :6496), refills per hit (game.js:5815), and is only
   consequential at game.js:7108 when Fail Mode / boss / level-fail is on. In the default solo run
   it is a meter that never matters — which trains the player to ignore meters, including the OD
   bar right above it.

4. **Vibe Channel is dead pixels in premium real estate.** `// SIGNAL CONTROLLER` is a hardcoded
   string (index.html:7773); `#hud-diff` is written once per run (game.js:3416). A static text
   block anchored to the bottom of the panel (`margin-top:auto`, index.html:2449–2450).

5. **The in-play brand presence is a 10px URL** (`REACTIVVIBEAI.COM`, index.html:7624–7627).
   That's a watermark, not a brand. During play, brand = palette + fonts + the guitar — good but
   anonymous at the moment of peak emotion.

6. **The best psychological system in the game is rendered at caption size.** The FEVER readout —
   the named-tier ladder that keeps climbing after the honest ×4 badge caps — is injected at
   **9px text and a 52px bar** (inline styles, game.js:6833). The most important escalation
   display in the game is the smallest text on the screen.

7. **Tutorial residue is permanent.** The `A S D J K · ESC PAUSE · SPACE OVERDRIVE` kbd strip
   (index.html:7778–7780, CSS :2947–2955) sits on screen for the run's entire duration, forever,
   for every player, every run.

8. Minor honesty debt: `.val.cyan` is chrome and `.val.green` is gold (index.html:2479–2480) —
   legacy class names from the banned palette; and `.judge-flash`'s Unbounded declaration
   (index.html:2569) is dead code, overridden by the id rule `#judge-flash → Oxanium`
   (index.html:2536).

---

## §2 — The brand thesis for gameplay

Within 5 seconds of the first note, a stranger should feel: **this machine is alive, and it heats
up with me.** ReactivVibe's fingerprint is not a logo — it is a *photographed real guitar* whose
pixel-measured strings you play (nobody else ships that), wrapped in a strict warm ladder —
black → crimson → ember → gold → white-hot chrome — that the whole screen climbs **as one
instrument** when you play well. Palm-mute chugs answer your fingers; Oxanium digits roll like a
machined counter. The moment the *frame* joins the ladder the game stops being "canvas in a web
page" and becomes one forged object. The moves that deliver it: (1) the frame feels the heat —
side panels ride the combo-tier hue; (2) the named tier speaks at full voice on the multiplier
gauge; (3) the brand stamps the peak (Overdrive ignition), not the margins; (4) meters only move
when they mean something; (5) ship the audio that already exists.

---

## §3 — Ranked, buildable list

**R1 — PUBLISH v465. (deploy, no code)** Ceiling-safe: trivially. Reason: fourteen builds of
in-play polish — including the entire hero-SFX package — are invisible to the person asking for
polish. Everything else is second to this.

**R2 — HEAT-REACTIVE FRAME: the side panels join the combo-tier ladder. (game.js ~3 lines +
index.html CSS)** In the existing once-per-tier-change block (game.js:6873–6877, where
`--ct-num`/`--ct-glow` are already set on `#combo-display`), additionally write one var on `#game`:
`--rr-tier: <COMBO_TIERS[i].board rgb>` (and reset it in `resetScoring`, game.js:3302-region).
CSS: repoint the panel border colors (index.html:2441–2442), the corner brackets
(index.html:2555–2562), the label diamonds (index.html:2458–2462) and the brand-dot glow
(index.html:1852) at `rgba(var(--rr-tier, 255,42,48), …)` at their **current** alphas. At combo 0
it renders byte-identical crimson; at BLAZE the whole frame runs ember; at ASCENDANT the brackets
go chrome. Ceiling-safe: one CSS-var write per tier change, zero per-frame cost, zero score paths.
Reduce-motion unaffected (color, not motion). **This is the one move that dissolves the
game/dashboard seam** — the frame finally reacts to the run. Must also ride the existing
`rr-lvl-themed` accent override (index.html:1630–1648) so themed levels keep their identity:
level accent wins at tier 0–1, tier hue wins from BLAZE up.

**R3 — FEVER AT FULL VOICE. (game.js:6833 inline styles only)** The injected `#mult-fever` block:
9px → 12px Chakra Petch for the tier text, bar 52px → 62px (the badge's width), and when tier > 0
swap the vertical `MULTIPLIER` gauge label (index.html:2338) for the tier name via the same
once-per-tier hook. The tier color write already exists (game.js:6837). Ceiling-safe: display-only
strings and pixels, already vs-mode-gated (game.js:6835–6836). Reason: the ladder that gives a
capped player something to climb deserves more than 9px.

**R4 — BRAND THE PEAK, NOT THE MARGINS. (game.js ~4 lines + index.html ~6 lines CSS)** On
Overdrive ignition (`_fireOverdrivePayoff`, fired from game.js:7164–7166) toggle a short-lived
class on the left `brand-row`; CSS gives the brand-dot + `REACTIVVIBEAI.COM` one hot gold pulse
riding the existing `odactive`/`odpulse` keyframes (index.html:2328–2329), ~1.2s, reduce-motion:
none. Ceiling-safe: class toggle. Reason: the brand should be welded to the best moment the game
produces — Star Power — instead of existing only as a permanent 10px whisper. One pulse per
ignition; never looping.

**R5 — FOOTER-HINT AUTO-FADE. (game.js ~3 lines + index.html ~2 lines)** Add a CSS opacity
transition on `.footer-hint` (index.html:2947); when `state === 'playing'` and songTime > 8s,
add a `.faded` class (opacity 0); remove it on pause/menu. First-run players keep the full 8s +
countdown exposure; veterans get their pixels back. Ceiling-safe: cosmetic. Decree note: the
playtest-2 decree enumerated the combo capsule + lore stats as KEEP; the footer hint was never
part of that list — this is a fade, not a removal, and it returns whenever paused.

**R6 — OWNER DECISION REQUIRED: amend the HUD decree for the right panel.** The decree
(playtest-2, owner-locked) says keep the Judgment Log and the lore stats, and I will not quietly
touch them. But I am formally arguing the decree now costs more than it buys, on two blocks only:

- **Judgment Log (index.html:7742–7753):** mid-run it is unreadable-by-design and duplicates the
  results screen. Proposal: replace the 4-counter grid with the composition bar alone (which IS
  glanceable) + the live accuracy % moved beside it; counters remain on results. The panel loses
  its "spreadsheet" center of mass.
- **Vibe Channel (index.html:7771–7775):** a static string. Proposal: delete the block; move the
  difficulty chip (`#hud-diff`) up into the Track block; let the freed bottom slot be breathing
  room (the `margin-top:auto` anchor at index.html:2449–2450 then elevates Reality Stability —
  which becomes an honest block once Fail Mode is on).

  **Reality Stability itself: KEEP.** It's the owner's lore, and it becomes real stakes under
  Fail Mode / boss / levels (game.js:7108). No change proposed.

If the owner declines, R2–R5 still stand alone; nothing above depends on R6.

**Killed on principle** (decoration without meaning / wrong altitude): a persistent in-play
wordmark (watermark energy); any new floating particles or ambient FX (the build14 lesson —
"random floating particle effects which I don't understand" — is codified at game.js:7228–7234);
any second combo readout; countdown/pause redesigns (both already strong: game.js:3507–3554 has
GET READY→3·2·1→GO!, pause has the crimson radial + build164 calibration line); a font change on
the 80px combo digits (Unbounded at index.html:2617 is sanctioned — an 80px hero number IS a
display header).

---

## §4 — What this pass deletes

1. **`meterSheen`** (index.html:2498–2504): an *infinite* 2.4s gradient sweep on every filled
   meter — progress, stability, OD — repainting constantly for the entire run, for zero
   information. It is exactly the class of always-on motion the hub IA pass (build165's attention
   cap) just purged from the menus. Delete the `::after` + keyframes; the machined inset track
   (index.html:2485–2497) already reads as game hardware without it. Perf: three fewer
   perpetually-animating layers during play.
2. **Dead `.judge-flash` Unbounded declaration** (index.html:2569–2570) — overridden by
   `#judge-flash` Oxanium (index.html:2536) since the type-system pass. Dead code out.
3. **Legacy class names `.val.cyan` / `.val.green`** (index.html:2479–2480, used at
   index.html:7638) → `.val.chrome` / `.val.gold`. Zero visual change; removes banned-palette
   words from the brand-critical file (and stops the next brand sweep from "fixing" them).
4. **Vibe Channel block** — pending R6 owner sign-off.
5. **Footer hint's permanence** — via R5's fade (the element stays).

---

## §5 — Verification recipes

Standing rules: `node --check game.js` after every JS edit; bump `?v` before the boot smoke;
`preview_console_logs` (error) must be clean; run muted; preview = the `rr-verify` config against
the MAIN dir (the session worktree is stale).

- **R1 (ship):** after Lovable publish, `fetch('https://reactivvibe.com/game/index.html')` and
  assert `game.js?v=465` in the body; probe one SFX asset (`assets/overdrive-ignite.mp3` → 200).
- **R2 (frame heat):** headless-provable. `preview_eval`:
  `__rrDebug.setCombo(80)` then read
  `getComputedStyle(document.querySelector('.hud-panel.left')).borderRightColor` and
  `document.getElementById('game').style.getPropertyValue('--rr-tier')` — expect the BLAZE board
  rgb (255,124,44); `setCombo(0)` → var empty/crimson fallback. Positive control: assert the
  computed color actually *differs* between the two reads. Confirm one write per tier change
  (spy via a MutationObserver on `#game[style]` while stepping combo 1→24 — expect ≤1 mutation).
  **Human-only:** whether the heated frame stays readable over bright level videos at 60fps.
- **R3 (FEVER voice):** `preview_eval`: `__rrDebug.setCombo(80)`;
  `getComputedStyle(document.getElementById('mult-fever-txt')).fontSize === '12px'`; gauge label
  swap: `document.querySelector('#mult-gauge .gauge-lab').textContent === 'BLAZE'`; at combo 0 it
  reads `MULTIPLIER`. vs-mode guard already exists — assert `#mult-fever` display none with
  `#game.vs-mode` class set.
- **R4 (brand peak):** headless can only prove wiring: `__rrDebug.chargeOd()` + `od()` then fire
  Space via `__rrDebug.press`; assert the brand-row class appears then self-clears ≤1.5s. The
  *feel* (does the pulse read as signature, not noise) is **human-only**.
- **R5 (hint fade):** `preview_eval` with a running demo (`RhythmGame.playDemo()`, muted): after
  `__rrDebug.jt() > 8`, `getComputedStyle(document.querySelector('.footer-hint')).opacity === '0'`;
  send Escape → pause → opacity back to 1. (Headless rAF throttling: drive time via the audio
  clock, not wall time.)
- **R6 (if approved):** DOM assertions — `#jc-perfect` etc. absent in-game but present on
  `#results`; `#hud-diff` now inside the Track block; no console errors from `updateHUD`'s
  null-guards (they already tolerate missing ids: game.js:6855–6859).
- **Deletions:** grep-zero for `meterSheen`; animation census on `#game` while playing (the
  build165 pseudo-element-aware census pattern) drops by ≥3; reduce-motion census stays 0.
  Brand-linter (`tools/brand-linter.py`) stays at 0 violations after the cyan/green rename.

---

## §6 — Closing: is bomb/hazard *variety* a real gap? (analysis only — not this pass)

What `buildNotes` actually emits today: **two hazard generators, both narrow.** Scattered single
bombs are Hard/RIFT-only — `bombGap = _rift ? 11 : hard ? 48 : Infinity` (game.js:1975) — placed
mid-gap at a *deterministic* lane offset (`inSpan(n.lane + 3)`, game.js:1987), grid-snapped so
they land on the pulse. Bomb ROWS (the ones he saw) fire at most every 20–22s (rift 14,
game.js:1999), are always `rowLanes = 3` wide (rift 4, game.js:2001), and are **always anchored
to the same center lanes** — `startLane = floor((LANE_COUNT − rowLanes) / 2)` (game.js:2016) is a
constant, so every wall in every song on every run spans the identical lanes 1–3 with lanes 0 and
4 open. On Medium — his tier — rows are the *only* hazard that exists. So "a couple rows of bombs
but it wasn't very diverse" is not an impression; it is a structural description of the emitter.
He noticed a real thing.

Is it worth a future spec? **Yes — but small, and not now.** The sanctioned shape is a
"hazard-shapes v1": vary the wall anchor (left/center/right, seeded per-row off the snapped time so
it stays deterministic per chart), occasionally stagger a wall across two adjacent instants (a
diagonal you weave through), and keep everything inside the existing placement guards (rest-gap
only, `COLLIDE 0.17` so no wall ever shares a window with a real note — game.js:2013–2015).
Critically this is **ceiling-safe by construction**: bombs add no scored notes, are excluded from
`total` (game.js:3882), and dodging pays nothing — so achievable score for a fixed
(track, difficulty) is unchanged and `CHART_VERSION` stays 2 (same class of change as build141's
bomb retunes, which shipped without a bump). It is a ~20-line, one-function change with
`__rrChartStats`-verifiable output (add a `bombRowAnchors` histogram). But it ranks *below*
everything in §3: hazard variety is seasoning, and the owner explicitly said the balance already
feels right — so ship the frame, ship the sound, and let a future charting pass season the dodges.

---
*Fable 5 · 2026-07-10 · written against local v465 (build165); production reference v451 (build147).
Read-only pass — no code was modified. Implementation: Opus 4.8.*

---

## §7 — EXECUTOR'S VERIFICATION APPENDIX (Opus 4.8, before implementing)

I re-derived every load-bearing claim in this spec against the source. **All of them hold.** Recorded so
the next reader doesn't have to redo it:

| claim | verdict |
|---|---|
| once-per-tier DOM block, `--ct-num`/`--ct-glow` on `#combo-display` (game.js:6873) | ✅ confirmed — `if (cd._tier !== _ti)` guard is real; correct seam for `--rr-tier` |
| `COMBO_TIERS[i].board` exists | ✅ confirmed — and BLAZE is `[255,124,44]`, exactly the value §5 tells me to assert |
| `#mult-fever-txt` renders at `font-size:9px` (game.js:6833) | ✅ confirmed, inline style |
| `failMode = false` default (game.js:353) | ✅ confirmed |
| Vibe Channel is a hardcoded `// SIGNAL CONTROLLER` (index.html:7773) | ✅ confirmed |
| `@keyframes meterSheen` (index.html:2504) | ✅ confirmed |
| `.hud-block .val.cyan` / `.val.green` (index.html:2479–2480), used at 7638 | ✅ confirmed — `class="val small cyan"` |
| `_fireOverdrivePayoff` (game.js:5313), fired at 7166 | ✅ confirmed |
| `__rrDebug.setCombo` exists and returns tier + `--ct-num` | ✅ confirmed (game.js:5012) |
| bomb rows always centered: `startLane = floor((LANE_COUNT - rowLanes)/2)` (game.js:2016) | ✅ confirmed — a **constant**, so every row is center-anchored |
| `bombGap = Infinity` on Medium (game.js:1975) | ✅ confirmed — rows are the only hazard on the difficulty the owner played |
| `tools/brand-linter.py` exists (§5 depends on it) | ✅ confirmed |
| `score +=` count still 17 (15 real + 2 comments) | ✅ confirmed |

**One under-scope to fix while executing §4.3.** The rename targets only `.hud-block .val.cyan/.green`.
There are three more banned-palette class names in the same file that the next brand sweep will trip over:
`.meta-cell .v.cyan` (index.html:315), `.calib-cell .n.cyan` (index.html:3142), and its usage
(index.html:6894, `class="n cyan"`). All three already resolve to `var(--silver)` — a **warm** silver, per
the build58 note at index.html:90 ("renamed from the misleading `--cyan` — it's a warm silver, never blue").
So these are naming debt, not brand violations. Rename them in the same pass: zero visual change, and the
word stops appearing in the brand-critical file.

**Sequencing note (mine, not Fable's).** R2–R5 and §4's deletions touch `game.js` + `index.html`, which the
pre-launch hardening swarm (`wejkxyadu`) is currently reading. Its findings cite `file:line` and its refute
pass **re-reads the source**. Editing underneath it would shift every citation and could cause a real defect
to be refuted as a phantom. Implementation waits for that swarm to land. R6 stays untouched: the HUD decree
is owner-locked, and Fable correctly refused to amend it unilaterally — so do I.
