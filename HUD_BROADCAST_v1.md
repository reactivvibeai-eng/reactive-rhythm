# HUD_BROADCAST_v1 — the in-game HUD as a broadcast graphic

**Source:** beta user **AkiraScare**, 2026-07-21, after reviewing his own stream VODs.
**Status:** planned, not built. Three owner calls open (§6).
**Method:** 6-agent code audit → Fable 5 creative direction → 4 adversarial verification lenses
(geometry/engine, mode coverage, brand, player-at-the-monitor). 11 agents, 0 errors.

---

## 1. The report

> 1. Move the song title and artist to the top left.
> 2. Lower the score below the song title and artist name.
> 3. Make all the letters bigger so that they are easier to see during the stream.

He is right, and he is describing symptoms. Do not implement this literally — see §3.

---

## 2. Diagnosis

### 2.1 The value inversion (the real defect)

The song title is the single piece of text on screen that **monetizes the stream** — it is how a
viewer discovers a track and how the AI-music catalog gets credit. Today it is:

- the **smallest body text on screen** (11px JetBrains Mono, `.hud-block .sub.bright`, index.html:2611)
- in the **dimmest** treatment
- **bottom-pinned** by `.hud-panel.left > .hud-block:last-child { margin-top:auto }` (index.html:2580)
  into the corner where three attackers converge: the panel scrim's thinnest band (0.64 alpha bottom
  vs 0.92 top), the `body::before` vignette's deepest region, and the corner a bottom-left webcam deletes.
- written as ONE concatenated string — `title + ' — ' + artist` at **game.js:3538**, the only write in
  the codebase. There is no artist element to style.

Meanwhile the **score** — a number with zero discovery value to a viewer — gets 44px and the top slot.

### 2.2 The measured legibility failure

| element | src | after 1080p→720p transcode | phone viewer (430px) |
|---|---|---|---|
| `#hud-track` title | 11px | 7.3px | **2.5px** |
| `.jc .lab` judgment labels | 9px | 6.0px | 2.0px |
| `.hud-block .label` | 10px | 6.7px | 2.2px |
| `#hud-score` | 44px | 29.3px | 9.9px |

9–11px is **0.83–1.02% of frame height**. Broadcast caption minimum is ~1.5%.

### 2.3 It is not a space problem — it is a style choice

`.game-screen.active` is overridden at ≥901px to
`minmax(300px,1fr) min(66vh,54vw) minmax(300px,1fr)` (index.html:5652). Measured:

| viewport | center | **each side panel** |
|---|---|---|
| 1280×720 | 475px | **402px** |
| 1920×1080 | 713px | **604px** |
| 2560×1440 | 950px | **805px** |

There is **~550px of unused content width and ~760px of unused height per panel at 1920**, filled with
10px type. Bigger costs the seated player nothing.

### 2.4 Two compositing layers are attacking the text

Contrast on the panel's own scrim is **fine** — ink-dim 6.74:1, chrome 13.96:1, both pass AA. The
killers composite on top:

- **`body::before`** — grain + 0→70% black radial, `position:fixed; inset:0; z-index:1000`
  (index.html:175-183). Drops the 11px title to **3.19:1** and `#hud-time` to **1.58:1**.
- **`.game-screen::after`** — 1px-period red scanlines at z-50 (index.html:2632). Pathological h.264
  DCT input sitting directly on 9–11px glyphs; it burns bitrate as high-frequency noise.

**Enlarging type without addressing these produces bigger mud.**

### 2.5 The strategic half: the panels are 0% of every vertical clip

The side rails are **62.9% of every 16:9 frame and 0% of every 9:16 crop, at every resolution.** A
TikTok/Reels/Shorts clip of this game **cannot name the track it is promoting.** And three of five
modes — mobile `.mhud`, couch split-screen, spectate — show **no title anywhere at all**.

---

## 3. Ruling: "make ALL the letters bigger" is rejected as literal

A uniform ~1.45× scale-up **preserves the exact inversion he is unknowingly reporting**: the title
would still be the smallest text on screen, the brand watermark would grow (reversing the build168 R4
ruling), and 0.3em-tracked labels would still shred under compression.

Broadcast legibility is **deciding which words a viewer must read** — title, score, accuracy, and the
Overdrive READY prompt — and armoring those. Everything else takes a **floor**, not a multiplier.

### 3.1 The type ladder

Survived all four adversarial lenses. One amendment (T2) from the brand lens.

| tier | used for | old | **new** |
|---|---|---|---|
| T0 BRAND | `.brand-name` | 10px | **10px — exempt** (R4: quiet except at the OD gold pulse) |
| T1 MICRO | `.vs-od-tag`, chips | 8–10px | **12px hard floor** — size class abolished |
| T2 LABEL | `.hud-block .label`, `.jc .lab` | 9–11px | **12px** + tracking cut 0.3em→0.14em ⚠ |
| T3 READOUT | `.sub` tier, `#hud-time`, OD/stability | 11–14px | **16px — the viewer floor** |
| T4 TITLE | `#hud-track` (new tier) | 11px | **clamp(18px, 7cqi, 26px)** title / 16px artist |
| T5 STAT | `#hud-acc`, `#hud-maxcombo` | 24px | **28px** |
| T6 HERO | `#hud-score`, `#hud-combo` | 44px | **clamp(40px, 22cqi, 56px)** |
| T7 CEREMONY | `#judge-flash`, `#combo-num` | 40–320px | **unchanged** — already broadcast-scale |

⚠ **T2 amended from Fable's 14px to 12px** (brand lens). At 14px the label→readout ratio compresses
to 1.14× and label→count to 1.5×; nine uppercase tracked labels then sit within 2px of the values
they label and the instrument cluster reads as a wall. 12px + the tracking cut + weight clears the
floor while restoring a 1.33× step.

**16px floor justification:** 1.48% of frame height ≈ broadcast caption minimum; renders at 10.7px
after a 720p re-encode.

### 3.2 Two rulings that make this shippable

- **Global default, NOT a "Broadcast Mode" toggle.** Every viewer of every clip consumes this as video
  whether the player streams or not. A toggle forks an already-quadruple HUD matrix into eight and
  ships the fix OFF by default. The audit proves the seated player loses nothing (§2.3).
- **Title face is Chakra Petch 700** — not Oxanium (numbers), not Unbounded (display headers only).
  The 11px JetBrains Mono title was a gap the Increment-15 type system never claimed.

---

## 4. Blockers found in verification — the mechanisms, not the direction

All four lenses returned **"rework"**. All four confirmed the diagnosis and ladder. Every break below
is in the *how*.

### B1 — the left-rail reorder collapses the panel 🔴
`.brand-row` is **not** a `.hud-block`. Swapping it to last child means the pin selector
`.hud-panel.left > .hud-block:last-child` matches **nothing**, `margin-top:auto` never applies, and
the left rail bunches at the top of a 1080px column with ~760px of dead space.
**Fix:** explicit `.hud-panel.left > .brand-row { margin-top:auto }` +
`.hud-panel.right > .hud-block:last-child { margin-top:auto }`. Drop the shared selector.
**Verify:** computed `marginTop` of the left panel's last child ≠ `'0px'`.

### B2 — the crop-safe chip is dead CSS as specified 🔴
`#vs-nowplaying` has **no static markup anywhere**. It is created in `mountVsHud()` and destroyed in
`unmountVsHud()`. "Un-gate it to all modes" un-gates nothing in solo, mobile, couch or spectate — the
single fix that reaches the 9:16 crop ships as dead CSS.
**Fix:** static markup with a **different id** (`#hud-np-chip`) so multiplayer.js:1656's teardown list
cannot delete it when a player leaves a versus match, plus its own lifecycle in `beginPlay()` and a
hard teardown alongside `.practice-tag` (game.js:3707).

### B3 — the scanline reparent lands on an occupied pseudo-element 🔴
Moving `.game-screen::after` onto `.game-center::after` collides with the **vs-mode Overdrive fire
flash** (index.html:2165, higher specificity) — firing OD in versus would blink the scanline off the
whole playfield for 620ms — and both `.game-center` pseudos are `display:none` below 901px, so mobile
loses it entirely.
**Fix: do not reparent anything.** One line: **`.hud-panel { z-index: 1001 }`** (panels are already
`position:relative`, index.html:5658). This lifts the HUD text above **both** the z-50 scanline **and**
the z-1000 vignette, leaves the playfield CRT texture and its vignette frame untouched, and needs zero
JS lifecycle. It resolves B3, M4 and M5 together.
**Verify:** nothing that must overlay the panels sits below 1001.

### M1 — the grid "fix" pays for HUD text with playfield 🟠
`min(66vh, 54vw, calc(100vw - 620px))` is the **one edit in the whole proposal that reaches
`guitarRect()`/`fretGeom()`**. In the affected band it costs up to **34–42% of highway width** — the
guitar, lanes, notes and DOM tap-zones all shrink so two 310px panels can hold bigger text. A player
would refuse that trade.
**Fix:** the 901–1313px overflow dead band is a **real pre-existing bug but a separate ticket.** If
fixed, take the space from the panels (`minmax(240px,1fr)`) or raise the panel-hiding breakpoint to
~1150px so the band falls through to the existing `.mhud` design. **Never shrink the center track.**

### M2 — the score overflow escape hatch does not exist 🟠
`_fmtScore` is **private to multiplayer.js** (not on `window.RhythmMP`, uncallable from game.js) and
abbreviates at **1,000,000, not 10,000,000**. Separately `.pop-big` scales **1.34×** and
`overflow:hidden` does **not** clip an element's own transform: 56px `"9,999,999"` = 260px → **349px
popped**, which eats the panel's entire 26px right padding at 1280×800.
**Fix:** `container-type: inline-size` on `.hud-block` + `font-size: clamp(40px, 22cqi, 56px)` — the
pattern already shipped on `.vs-val` (index.html:2188-2201) and `#mp-opp .mo-score` (index.html:4915).
Preserves the digit roll-up, never clips, self-adapts. Same clamp for the title (panel content width
varies 258–588px, a 2.3× range — a hard 26px truncates at ordinary desktop widths).

### M3 — enlarging `.sub` ships a fourth typeface 🟠
`.hud-block .sub` is the **JetBrains Mono** rule and governs five more strings the pass enlarges to
16px: `#hud-od-text`, `#stability-text`, `#hud-diff`, `// SIGNAL CONTROLLER`. At 11px mono reads as
instrument telemetry and disappears; at 16px it reads as a deliberate fourth voice someone forgot to
convert.
**Fix:** add `.hud-block .sub` to the Chakra Petch line at index.html:2658-2659 **in the same commit**.
Keep Oxanium only for `#hud-time` (a number).

### M4 — do not delete `body::before` 🟠
It is `position:fixed; inset:0` — it frames the **playfield**, not just the panels. Every authored
1080p level and every guitar skin was art-directed inside it; deleting it washes out the outer ~30% of
every level for every player. Fable's stated mechanism also had no hook (there is no "game is active"
class, and the codebase avoids `:has`).
**Fix:** subsumed by B3's `z-index:1001` — the panels rise above the vignette, the playfield keeps its
frame, no JS lifecycle to leak.

### M5 — do not raise the panel scrim 0.64→0.85 🟠
That buries the most expensive assets in the project: ~36% of the level video currently reads through
the panel bottoms, ~15% after. A HUD-legibility pass should not restage every authored level.
**Fix:** evict the vignette (B3), keep 0.64, and armor the glyphs instead with the `.mhud` text-shadow
already in the codebase (`0 1px 2px rgba(0,0,0,0.85)`, index.html:2403). Re-measure after.

### M6 — a real scrim bug worth fixing 🟠
On the three authored themes the `[data-rrtheme]` watermark rule uses a `background` **shorthand** that
already **destroys the entire panel gradient** — those panels render with no scrim at all, only
`backdrop-filter: blur(4px)` over raw level video. The busiest backdrops have the weakest scrim.
**Fix:** `background-image: linear-gradient(...), url(...)` (gradient first), or move the scrim to a
`::before`. **Verify:** `getComputedStyle(panel).backgroundImage` lists two layers, not one.

### M7 — the reorder makes the score's position title-dependent 🟠
With a 2-line clamp, a 1-line vs 2-line title moves the score **~30px vertically between songs**.
Today the score's y is invariant across all 852 tracks. A mid-run glance target that moves is strictly
worse for the player — this is the one place the streamer's requested order genuinely costs him.
**Fix:** `min-height` on the NOW PLAYING block so its box is identical for 1- and 2-line titles.

### M8 — the chip's mode coverage claims are false 🟠
Couch split-screen adds the **same `vs-mode` class**, so the rebuilt rail is `display:none` and couch
mounts no chip. Spectate is a **body-level z-252 fixed layer** where spectators never activate `#game`
— any chip inside `#game` is buried. On mobile the chip lands **on top of the `.mhud` center cell**.
**Fix:** gate on the *absence* of a mounted chip, not on the vs-mode class; add a real `.mss-np` to the
spectate stage head; under `@media (max-width:900px)` offset the chip below the `.mhud`. Test 390×844.

### Minor (8, carried)
`.od-hint` folded into a 14px label produces a two-line label with a floating diamond (give it its own
`.sub` row); `#hud-score`/`#hud-combo` blur shadows at 56px are an unmeasured per-frame paint cost —
check `?fps=1` on a dense Hard chart and drop the shadows, not the size, if it costs frames; `.mhud`
carries no artist and is exempted from the broadcast argument by assertion.

---

## 5. Staged plan

Fable called for one commit. **Verification proved that wrong** — the reorder depends on an
owner-decree amendment and the chip is a separate lifecycle build. Ship in this order; each stage is
independently valuable and independently revertible.

### Stage 0 — compositing (no type changes) · ~1 line
`.hud-panel { z-index: 1001 }`. Fixes B3 + M4 + M5's root cause. Ship and look at it first: this alone
may resolve a large share of the "hard to see" complaint, because the measured contrast failure was
compositing, not size.

### Stage 1 — the type ladder + armor (no reorder) · needs no owner call
Tokenize into the type-system block at **index.html:2656-2663** (edits elsewhere silently no-op — that
block shadows every per-element `font-family`). Add `--rr-fs-hud-*` rungs to the existing `--rr-fs-*`
ladder. Apply §3.1 with T2 at 12px. Add `.hud-block .sub` to Chakra Petch (M3). cqi clamps on score
and title (M2). Text-shadow armor. Fix the themed-scrim shorthand bug (M6). Delete the dead
`Unbounded` declaration at index.html:2595.
**Lockstep:** solo rail, right panel, vs-mode plates, `.mhud`, spectate stage — all five in this
commit, or the game ships two legibility standards the moment a streamer enters a versus night.

### Stage 2 — the NOW PLAYING masthead · **needs Owner Call 1**
Split `game.js:3538` into `#hud-track-title` + `#hud-track-artist` (with `:empty { display:none }` to
preserve the null-artist fix). Move the block to first child. Brand row to the bottom with the
**explicit** pin (B1). `min-height` on the block (M7).

### Stage 3 — the crop-safe chip · **needs Owner Call 2**
Its own build: static `#hud-np-chip` markup, own lifecycle, mobile offset, couch + spectate coverage
(B2, M8). This is the only work that reaches a 9:16 clip.

### Separate ticket — the 901–1313px grid dead band
Real pre-existing bug where the right panel clips off-screen. **Must not** be fixed by shrinking the
center track (M1).

---

## 6. Owner calls — ALL THREE APPROVED 2026-07-22

1. ✅ **APPROVED — the playtest-2 HUD decree is amended.** The NOW PLAYING masthead goes above the
   score; the score keeps dominance by **mass** (40–56px clamp), not by row order. The decree's intent
   ("Score big + dominant") is preserved and now reads: *dominance is visual weight, not position.*
   Stage 2 is unblocked.
2. ✅ **APPROVED — the transient now-playing chip ships.** 5s at song start, on unpause, and at the
   finish, then fades. Ceremony, not standing chrome — consistent with "strike line + multiplier only."
   Stage 3 is unblocked. Must use `#hud-np-chip` (its own id + lifecycle) per B2.
3. ✅ **APPROVED — R6 bundles into this pass.** Delete the `Vibe Channel` / `// SIGNAL CONTROLLER`
   block; `#hud-diff` moves into the track block. One right-panel relayout, not two. The freed slot
   goes to the Overdrive READY prompt — the one string that changes what the player's hands do.

---

## 7. Facts worth keeping

- **`game.js:3538` is the only write to `#hud-track` in the entire codebase** — one concatenated
  string, em-dash separated. Splitting title from artist is a markup change, not a CSS change.
- **The type-system block at index.html:2656-2663 shadows every per-element `font-family`.** The
  `JetBrains Mono` at :2583/:2649 and `Unbounded` at :2595 are **dead declarations**. Edit the block.
- **Panel content cannot move the playfield.** Grid tracks are viewport-derived; `game.js:708` reads
  only `.game-center`. The redesign stays inside the panel — *unless* someone touches the grid (M1).
- **`--rr-fs-xs/sm/md/lg/xl` exist and have exactly one HUD consumer** (`#vs-nowplaying .vs-np-a`).
  There is no single type lever today.
- **The brand row's 10px is an inline style** and defeats any stylesheet-level change.
