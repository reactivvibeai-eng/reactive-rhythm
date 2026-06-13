# Reactive Rhythm — Overnight refinement pass

Goal: take the build from "works" to **website-ready**, focused on the two things
called out as broken/missing in the handoff (chat + `design-source/ROADMAP.md`):

1. **Desktop layout** — song-select was a narrow column in a black void; the
   gameplay HUD was stranded at the screen edges.
2. **Settings** — no custom keybinds, no controller/MIDI setup.

Baseline backed up to `design-source/original-build/` before any edits.

Held to the ROADMAP quality bar: motion, feedback, hierarchy, depth, brand, 60fps.

---

## Changes

### 1. Desktop song-select — full-width "deck"  ✅ verified
`jukebox.css` (new `@media (min-width:901px)` block; mobile untouched).
- The library was a 720px column centered in black. Now at >900px `#view-jukebox`
  is a CSS grid: a large reactive **coverflow stage** (~820px, 276px focused cover)
  on the left, and a **"NOW FOCUSED" hero rail** on the right (eyebrow label, big
  Unbounded title with a crimson tick, artist, meta chips, mastery, and a hero
  Play + Browse) — using the width that used to be a void.
- `.lib` widened to `min(1480px, 95vw)`; ultrawide rail capped so it stays readable.
- Browse genre/artist grids become responsive multi-column; the songs list keeps a
  tasteful ~860px reading column instead of 1480px-wide rows.
- Verified at 1600×900: `.lib` = 1480px wide, coverflow 822px, rail 560px, 0 errors.

### 2. Desktop gameplay HUD — framed playfield  ✅ verified
`index.html` (new `@media (min-width:901px)` block).
- Score/combo/judgment were stranded at the screen edges. Now the playfield is a
  capped, centered **880px stage** (`box-shadow` frame) flanked by the left/right
  HUD panels, with ambient blood-moon **gutters** that grow on wide monitors.
- HUD hierarchy polish: crimson top-accent rule per panel, score bumped to 46px,
  live crimson glow on the combo value.
- Verified at 1600×900: grid = `38px 322px 880px 322px 38px`, 0 errors.

### 3. Settings — custom keybinds  ✅ verified
`game.js` + `index.html`.
- `KEY_MAP` const → a persisted, remappable `keyMap` (localStorage `rr_keymap`);
  defaults unchanged (A S D · J K L) so muscle memory carries over.
- New "Lane Keys" row: 6 lane-colored keycaps (crimson/chrome, matching the
  highway). Click a cap → it listens → next key binds it (capture-phase catcher so
  the key never leaks to gameplay/mute). One key per lane, one lane per key; Esc
  cancels; Reset restores defaults. The Inputs line reflects the live mapping.
- Engine API: `getKeyMap`, `setKeyBinding`, `resetKeys`, `getInputStatus`.
- Verified: rebind `a→q` updates map + keycap; reset restores; 0 errors.

### 4. Settings — controllers/MIDI + live input test  ✅ verified
`game.js` + `index.html`.
- Unified `onLaneInput(lane, source)` now funnels **all** input sources (touch /
  keyboard / MIDI / gamepad) through one path: gameplay reacts only while playing;
  a `laneProbe` lights a lane in the test panel from any device.
- "Controllers & MIDI" status rows: Keyboard (Ready), MIDI (device names / none /
  unsupported), Controller (gamepad id / none) — live via MIDI statechange +
  gamepadconnected/disconnected.
- "Input Test" mode: 6 lane pips that light on any matching key/MIDI-note/pad-button.
  Gamepads are polled during the test (gameplay polls in its own loop).
- Verified: pressing `s` lights only lane-1 pip; toggle on/off clean; 0 errors.
- MIDI/gamepad → lane *remapping* (beyond keyboard) intentionally deferred; the
  test confirms detection + lane mapping, which is the website-readiness need.

### 5. Polish + atmosphere  ✅ verified
- **Blood-moon backdrop** behind the desktop deck: the in-world `assets/moon.png`
  (a crimson moon, previously unused) as a `screen`-blended, masked, slowly floating
  ambient layer — depth + brand, pure CSS, no per-frame cost. (ROADMAP Pillar A:
  "the moon/world reacting behind it.")
- Rebinding keycap now **pulses** (reuses `odpulse`) as a clear "press a key" affordance.
- Redundant static MIDI note replaced by the live device-status section.

---

## Verification (headless preview, eval/inspect/geometry — screenshots can't
## capture this GPU-heavy canvas, so behavior + computed styles were checked directly)

- **Desktop 1600×900**: library `.lib` 1480px, coverflow 822px + 276px cover, hero
  rail 560px; gameplay grid `38px 322px 880px 322px 38px`. Moon backdrop applies
  (`screen`, 0.5). 0 console errors.
- **Mobile 375×812**: `.lib` 375px, `#view-jukebox` stays `flex` (desktop grid is
  ≥901 only), meta re-centers, Settings panel scrolls. No regression.
- **Settings**: keycaps render A S D J K L; rebind `a→q` updates map + cap; reset
  restores; device rows show Keyboard/MIDI/Controller; Test Input toggles and a `s`
  press lights only lane-1's pip.
- **Gameplay**: demo decode → analyze → countdown → play; clock advanced to 0:09 /
  4:12; canvas rendering (~13.8k px); a lane-key press fires a judgment via the new
  unified input path. Core loop and keyboard input intact.

## Not touched / deliberately deferred (net-new systems — would be half-built tonight)
- Level/progression system (ROADMAP Pillar B / VS6).
- Player identity, profiles, global/friend leaderboards (Pillar F / VS8).
- MIDI/gamepad button → lane *remapping* UI (keyboard remap shipped; device test shipped).
- Backend: the **live catalog API returns HTTP 500** (`radio_tracks` ↔
  `game_dev_opt_ins` relationship missing in the Supabase schema cache). The game
  degrades gracefully to the mock catalog + the local demo track, but the real
  library won't load until that server-side relationship is fixed. Not fixable from
  this repo — it lives in your Supabase `game-catalog` edge function.

## Safety
- Verified baseline in `design-source/original-build/` (restore by copying those 5
  files back to the project root).
- All changes are desktop-gated (`@media min-width:901px`) or additive Settings
  markup/logic; the mobile-first experience is unchanged.

---

# Increment 2 — Results moment, desktop sheet, accessibility

### 6. Results screen — a reward, not a stat dump  ✅ verified
`index.html` + `game.js` + `catalog.js`.
- **Judgment composition bar**: a single bar split into proportional Perfect /
  Great / Good / Miss segments (colors match the in-game judgment text), with a
  count legend — you instantly see the shape of your run. Fills with a transition.
- **Badges**: a gold **FULL COMBO** chip and a pulsing crimson **NEW BEST** chip
  (the latter detected by comparing to the prior saved best *before* it's overwritten).
- **COPY SCORE** action — copies a clean score summary to the clipboard (no backend).
- Verified: segments resolve proportionally (70/20/7/3 → 0.70/0.20/… of the bar),
  both badges render, IDs match the renderer, share button present.
- Note: the segment fill uses a CSS `width` transition — it animates correctly in a
  real browser; the headless preview throttles the transition so I verified the
  resolved widths with transitions disabled.

### 7. Song sheet → desktop-native modal  ✅ verified
`index.html` (CSS, `@media min-width:901px`).
- The difficulty/Play sheet was a mobile bottom-sheet even on desktop. At >900px it's
  now a vertically-centered modal (scale-in, rounded, grip hidden). Mobile bottom-sheet
  untouched. Verified: `top: 450px` (centered in 900px viewport), grip `display:none`.

### 8. Accessibility / website-readiness  ✅ verified
`game.js` + `index.html`.
- **Reduce Motion** setting (Settings → Reduce Motion, persisted): toggles a
  `.rr-reduce-motion` class that near-zeroes CSS animation/transition durations and
  also gates the canvas god-rays/embers. Defaults on when the OS reports
  `prefers-reduced-motion: reduce`. Verified: toggling flips the class + setting both ways.
- **Keyboard focus** — visible `:focus-visible` crimson outlines on interactive
  controls (menu, settings, covers, difficulty), so the deck is keyboard-navigable
  without affecting mouse/touch.

### Increment-2 verification
- Reduce Motion on/off flips `html.rr-reduce-motion` + `getSettings().reduceMotion`.
- Results composition bar resolves proportional segments; FULL COMBO + NEW BEST render.
- Desktop sheet is a centered modal (`top:450px`, grip hidden, title populated).
- Gameplay regression after the `game.js` changes: demo reaches play, clock advances
  0:00 → 0:13, progress 5.3%, canvas rendering. **0 console errors.**
- `catalog.js`/`jukebox.js` results path unchanged except the additive NEW-BEST check.

### 10. CRITICAL FIX: guitar / strings / marbles now line up  ✅ verified in a real browser
`game.js`. The playfield was unplayable — the neon strings, catcher rings and notes
were positioned with hardcoded **canvas-relative** fractions (x 0.215–0.785 of the
canvas), while the guitar **image** was sized by height and centered. The moment the
canvas aspect changed they diverged, so the strings/marbles floated off the guitar.
- New single source of truth: a shared `guitarRect()` + `fretGeom()` that derives
  `nearX/farX/nearY/farY` (and the lane width that sizes the notes/catchers) from the
  guitar image's drawn rectangle plus where its strings actually sit in the art
  (measured from the PNG: nut at image-y 0.05 spanning x 0.452–0.548; bridge at
  image-y 0.75 spanning x 0.32–0.68; neck centered at 0.50).
- `render()`, the mobile `tap-zones` (`layoutTapZones`), the hit `particles`
  (`spawnHitParticles`), and the guitar draw in `drawCathedralBg` all now use that one
  geometry, so they're aligned with each other and with the art at **any** canvas size.
- Verified objectively (every string samples on the guitar art, brightness 24–73, none
  on the black background) AND visually in a real Chrome at 1568×653: the six catcher
  rings seat exactly on the six bridge saddles, the strings run up the neck, and a note
  rides the string into the catcher. This is the issue the user flagged as "horrible /
  unplayable" — now fixed.

### 9. Fix: in-game footer hint showed wrong/stale keys  ✅ verified
`index.html` + `game.js`. The gameplay footer hardcoded `D F J K` — wrong (the game
uses 6 lanes A S D · J K L) and stale (ignored remapping). It now renders the live
lane keys and updates on rebind/reset. Verified: `ASDJKL` on load, `QSDJKL` after
remapping lane 0→Q, `ASDJKL` after reset.

---

# Increment 4 — gameplay feel + string/button alignment (user-flagged blockers)

All `game.js`. Verified in a real (muted) browser.

### 11. Sluggish gameplay → faster scroll  ✅
Note approach times lowered (lower = faster): Easy 1.9→1.30, Medium 1.45→0.95,
Hard 1.05→0.68 — roughly 1.5× snappier. The Settings → Note Speed slider still
fine-tunes around this. (Feel is the user's to confirm; easy to push further.)

### 12. Catcher buttons now sit ON the guitar strings  ✅ verified
The buttons/strings were bunched in the center while the painted strings fanned wide
to the bridge saddles. Measured the real string positions from the art with a
canvas-fraction grid overlay and widened the bridge span: `bridgeX` 0.32–0.68 →
**0.227–0.754**, `nutX` 0.452–0.548 → 0.445–0.553. Verified at the bridge: the six
rings land on canvas-fraction ~0.371…0.619 = the six saddle centers, and the strings
run straight down into each ring along the whole neck.

### 13. Button press-down + string vibrate on every press  ✅ verified
- `lanePluckT` is now reset on **every** press (not just successful hits), so the
  lane's string plucks/vibrates whenever you hit its button.
- `drawCatcher` takes a press amount (`lanePulse`): the ring **pushes down** into the
  bridge (`dy = press·r·0.75`) and **squashes** (`scale 1−0.16·press`) while lit.
- Verified (magnified pressed frame): rings light + depress, all six strings show the
  pluck standing-wave wobble, each string feeding into its ring.

Note: clock advancing was confirmed via a real click-through (audio unlocks on a real
gesture; muted so silent). The bundled demo still needs a real tap to start the clock.

---

# Increment 5 — input responsiveness (the real touch bug)

User reported touch "delayed, sluggish, not accurate." Measured the render first:
**0.13 ms/frame** — frame rate was NOT the cause. The real problems were in the input
path. All `game.js` + `index.html`. Verified in a real browser.

### 14. Touch lanes were tiny + hidden  ✅ verified — the core bug
- The 6 touch lanes were keyed to the (narrow, centered) catcher positions, so lanes
  0 and 5 grabbed ~40% of the width each while **inner lanes 1–4 were 4.9%-wide slivers**
  — almost impossible to tap accurately. Now **6 equal columns** (16.67% each):
  `layoutTapZones()` rewritten to even columns.
- The tap-zones were **`display:none` above 900px**, so on a desktop-width / touchscreen
  window touch did *nothing*. Now the touch lanes are live during gameplay on **every**
  device/width (`.tap-zones { display:block }`), and touch-capable devices also get the
  on-screen pause button (`body.has-touch`). Verified: zones now `block`, 6×16.67%.

### 15. Unified Pointer Events  ✅ verified
Tap-zones switched from `touchstart` + `mousedown` to **`pointerdown`/up/cancel** — one
path for touch, mouse, and pen, no touch→mouse double-fire, chords intact. Verified:
clicking a lane in a real (mouse, non-touch) desktop browser fires `handleHit` (the "—"
judgment flash appeared) — i.e. click/tap now registers, where before it was dead.

### 16. Timestamp-accurate judging  ✅
`handleHit` now back-dates the hit by `now − event.timeStamp` (clamped 0–50 ms), so a
press is judged at the instant you actually touched — not whenever the handler got to
run behind a busy frame. Routed `evTime` through `onLaneInput`; touch + keyboard pass it.

Render perf: deliberately **not** changed — measurement showed it's already ~0.13 ms/frame,
so the bottleneck was input, not drawing.

---

# Increment 6 — gameplay-screen overhaul (in progress)

### 17. Guitar fills the playfield — no empty space, no cropped body  ✅ verified
`game.js` (guitarRect) + `index.html` (desktop grid). The guitar was a small centered
image with big empty margins (desktop) / cropped body (mobile). Now `guitarRect()` is a
**contain-fit** that scales the guitar to fill the playfield without cropping the body
sides, and anchors the bridge at a fixed screen height. Desktop playfield is now a
**portrait strip (`min(66vh,54vw)`)** sized to the guitar, with the HUD panels filling
the sides (no dead gutters). Verified numerically: desktop fill 93% (body 0.035–0.963,
panels 423px each); mobile fills width ~0.999 (no crop). Catcher row anchored at 0.78h.

### 18. Removed stray boxes on the playfield  ✅
Tap-zones are now fully transparent (were drawing faint gradient/border columns that
showed as boxes around the buttons in gameplay).

### 19. EXACT per-string button alignment — measured from the PNG  ✅ verified
`game.js` (ART + fretGeom). Instead of eyeballing, I read `assets/guitar.png` pixel-by-pixel
(PIL ridge detection) to find where the 6 painted strings actually sit, at the nut and at
the catcher row. The strings **fan** (tight cluster at the nut → wide saddle spread at the
bridge) and are **not** an even split — so each string is now pinned to its measured
position rather than interpolated between two endpoints:
- nut (y≈0.10):    `[0.430, 0.466, 0.492, 0.515, 0.538, 0.570]`
- bridge (y≈0.75): `[0.247, 0.358, 0.469, 0.570, 0.659, 0.750]`
This corrected a real bug: the old config placed bass-side catchers ~18–24px **left** of
the actual strings (that "buttons aren't on the strings" look). Catchers, notes, and the
neon string overlay all ride these measured positions, so they sit exactly on the art at
any size. Verified in a real browser: buttons land on the painted strings; guitar fills the
playfield (mobile 0.002–0.997, desktop 0.047–0.953); no crop.

### 20. Touch lanes track the visible buttons  ✅ verified
`game.js` (layoutTapZones). Equal columns mismatched the fanned buttons (you'd tap a button
and trigger the neighbouring lane). Now each touch lane is centred on its button — bounds at
the midpoints between adjacent buttons, the two outer lanes stretched to the edges. Full-
width coverage, no slivers, every tap hits the button you pressed. Confirmed in-browser:
zone widths `30.3 / 11.0 / 10.5 / 9.5 / 9.0 / 29.7 %`, every button inside its own zone.
A deferred relayout (rAF + 60 ms) absorbs the one-frame layout settle at game start.

### 21. Real hold / sustain notes  ✅ verified (no errors at runtime)
`game.js`. Hold notes were visual-only (scored as one tap). Now they're a true mechanic:
strike the head, **keep the key/finger down** and the sustain pays out continuously (string
keeps ringing, catcher glows, sparks trickle up the lane); a satisfying "HOLD!" pop + haptic
at the tail. Forgiving by design — an early release just stops the payout (no combo break),
and the head hit still counts (so `notes_total`/anti-cheat is unchanged). Keyboard (with
auto-repeat ignored), touch, and pointer all drive it.

### 22. Cache-busting on local JS/CSS (`?v=6`)  ✅
`index.html`. Browsers were serving a stale `game.js` from disk cache (you'd need a hard-
refresh to see updates). All local includes now carry `?v=6`, so updated code loads
automatically. (Bump the number when you next change JS/CSS.)

### Catalog brief delivered
`LOVABLE_BRIEF.md` — hand to the site/backend agent. Includes the fast **Path B** (a
simple Mux+artwork JSON feed → the game streams + charts in-browser → real songs playable
soon) and **Path A** (fix the Supabase 500 + pre-bake charts for scale).

### Still open
- **HUD / side-panel redesign**: genuinely needs visual judgement (designing premium wide
  panels blind risks making it worse) — doing this next, want your eyes on it.
- **Real music catalog**: blocked on the Lovable/backend agent returning a track feed (brief sent).
- **60fps**: kept the video background (you like it); read the FPS meter — if it's still ~30,
  the video is the likely cap and I'll offer a canvas-world swap.
- **Level picker**: deferred per your call.

### Verification this increment (no screenshots — done via headless eval + PNG pixel reads)
Real-browser run, zero console errors through: load → game-start → chart gen (with holds) →
render → input → scoring → sustain. Alignment math cross-checked against measured PNG; tap
zones and canvas-fill confirmed live; full build re-served fresh and validated.

---

# Increment 7 — brand colour + top alignment + holds-that-show (from screenshot feedback)

User feedback on the v6 build: alignment/side-UI good, but (a) "can't stand that purple",
brand is **black/red/chrome/crimson**; (b) top-of-neck strings don't match; (c) never saw
hold notes and holding the key did nothing; (d) still 30 fps.

### 23. Killed the purple — strict black/red/chrome/crimson palette  ✅ verified
The darks were **blue-tinted** (`--bg #07060a`, B>R) and the "chrome"/"cyan" greys were
cool blue-greys — so red glows layered over them blended to **purple/magenta**. Warmed/
neutralised every offender (R≥G≥B): `--bg → #0a0706`, `--bg-2 → #160c0b`,
`--chrome → #dad7d2`, `--cyan → #cbc7c2`, `--line` neutral; body chrome-glow neutralised;
the canvas lane accent `#e6ebf5`(blue-white) → `#ece7e3`(chrome); note bevel + glitch
scanline greys neutralised; dev FPS-pill border cyan → crimson. Crimson untouched (already
brand). Verified live: computed `--bg #0a0706`, `--chrome #dad7d2` — no blue channel.

### 24. Top-of-neck alignment retightened  ✅ measured
Notes spawn at the very top (y≈0.05) but `nutXF` had been measured lower (y≈0.10), where the
fanning strings are wider — so notes spread wider than the strings at the top. Re-measured
the PNG at the spawn row (strings span only 0.448–0.552 there) and set
`nutXF → [0.450,0.470,0.490,0.510,0.530,0.550]` (tight, centred). Bridge end unchanged (was
confirmed good).

### 25. Hold notes now actually appear — and holding works  ✅ verified end-to-end
Root cause they saw none: the old rule (`gap>0.62 && i%5==2`) almost never matched on a
dense chart. Rewrote derivation to be generous + spaced (`gap>0.5`, ≥5 notes apart, tail
0.45–1.6 s capped to the gap). Result on the demo: **35 holds / 180 notes** (was ~0).
Redrew the sustain as a **bold glossy crimson bar** (outer glow + solid body + chrome core),
brightening when held — a clear "long brick", not a faint ribbon. Verified the mechanic with
a deterministic in-browser test: pressed exactly on a hold head → +375, then the score
climbed continuously across the 0.5 s hold (375→398→442→…→595) for the **full +220 sustain**,
completing at the tail. So "holding the key" works; the issue was purely that holds existed.

### 26. 30 fps diagnostic  ⏳ for the user to run
Render is ~0.13 ms/frame, so the 30-fps lock is the DOM `<video>` backdrop compositing, not
draw cost. Can't measure the user's real GPU from the headless preview (it throttles), so
added **`?novideo=1`** — disables the moon video (canvas atmosphere still renders). If FPS
jumps 30→60 with it on, the video is the cap and we swap it for a canvas/static backdrop.

### Dev hooks (test build only — strip before launch)
`window.__rrChartStats` (note/hold counts) and `window.__rrDebug` (state/score/press/release
for deterministic testing). Both guarded; no effect on real play.

Cache: bumped local includes to `?v=8`. NOTE: a one-time hard-refresh (Ctrl+Shift+R) is
needed to pick up `index.html` itself (inline CSS/palette) — the `?v=` query only busts the
JS/CSS files, not the HTML document.

---

# Increment 8 — held-button feel + the REAL purple + no-cache server

Feedback on v7/8: scene reds good, but holding a key didn't make the button stay down /
glow white / vibrate the string (so long notes felt unresponsive — "you gotta hit on
point"); still "purple borders"; still 30 fps.

### 27. Held button STAYS down, glows white, string keeps vibrating  ✅
`game.js`. Root cause: `lanePulse` decayed in ~0.25 s, so even while you held a key the
button popped back up and the string stopped — a long press felt like a fleeting tap. Now
while `laneDown[i]` is true, the loop pins `lanePulse≥0.9` (button stays squashed + lit),
`laneHitPulse≥0.55`, and `lanePluckT≤0.035` (string keeps ringing). Plus an explicit bright
**white bloom + ring** drawn on any held catcher so you can plainly see it's held. Added a
window-`blur` safety that releases all lanes (a missed key-up can't stick a button down).
Combined with the already-working sustain payout, a long press now reads as genuinely held.

### 28. The REAL source of the purple — hardcoded blue-greys  ✅ verified
Increment 7 warmed the CSS *variables*, but dozens of **hardcoded** cool literals remained:
`rgba(200,212,232,…)` and `rgba(214,219,228,…)` (blue-grey, B highest) in borders / box-
shadows / card backgrounds, plus `#d6dbe4`, `#9aa3b2`, `#6b7280`. Those blue-greys over the
red scene were the persistent purple. Warmed every one to chrome (R≥G≥B): triplets →
`222,216,212` / `224,218,214`, `#d6dbe4 → #dad7d2`, grade greys warmed. Verified live: the
HUD panel border computes `rgba(220,214,212,0.12)` — no blue channel anywhere.

### 29. No-cache dev server — never hard-refresh again  ✅ verified
The "still purple" was partly **stale cached `index.html`** (the `?v=` trick can't bust the
HTML document). Replaced `python -m http.server` with `serve.py`, which sends
`Cache-Control: no-store` (+ Pragma/Expires). Now a normal refresh always loads the latest.
Run it with `python serve.py` (localhost:8787, localhost-only). Verified headers live.

### 30. 30 fps — still needs the `?novideo=1` reading
Unchanged pending the user's measurement (couldn't be measured remotely). The `?novideo=1`
diagnostic is in place; the result decides whether we replace the video backdrop.

Cache/version: includes bumped to `?v=9`. Dev hooks extended (`__rrDebug.lanes()` for
held-state inspection) — still test-build only, strip before launch.

---

# Increment 9 — fix the floating white ring, the real purple, + a Background/FPS toggle

Feedback: button press-down works now, but the white ring "hovers above" the button and
doesn't fit; borders still that "same ugly" purple; FPS still 30.

### 31. Removed the floating white ring  ✅
The extra white bloom/ring I added drew at the catcher's RESTING position, but `drawCatcher`
pushes the button DOWN when pressed — so the ring stayed up where the button used to be
("hovers above"). Deleted it. The held button now glows white via `drawCatcher`'s own
`ringWhite` glow (driven by the held `press≥0.9`), which moves down WITH the button — so the
white glow stays attached. Press-down + white glow + string vibrate all read correctly.

### 32. The purple borders — finally  ✅ verified
`--line` was a light translucent grey; over the crimson bg-glow a light line blends to
pink/magenta = "purple". A neutral line can't avoid this. Switched `--line` to a muted
**crimson** `rgba(160,40,46,0.32)` — red over anything stays red, never purple, and it's
on-brand (the dividers/hairlines now frame in crimson). Verified live.

### 33. Background toggle (Cinematic / Performance) — the FPS lever, self-serve  ✅ verified
Rather than keep asking for the `?novideo` reading, added a real **Settings → Background**
toggle: *Cinematic* (moon video, default) vs *Performance* (video hidden + paused → its
compositing can't cap the frame-rate; the canvas atmosphere still renders). Persists in
`rr_settings.bgMode`; `?novideo=1` still forces Performance. Verified: toggling adds/removes
`html.rr-perf-bg`, video flips `display:none`↔`block`, setting persists, game boots clean.
If Performance reads 60 fps, the video is confirmed as the cap and we'll build a 60-fps
backdrop that keeps the look; default stays Cinematic so nothing changes unless chosen.

Version bumped to `?v=10` (no-cache server also makes refresh always-fresh).

---

# Increment 10 — sustain redesigned as a molten energy beam; FPS narrowed to display

Feedback: holds work + feel right now; borders black ("fine for now"); the long sustain bar
"looks like a giant awkward bar — we could do better"; FPS still 30.

### 34. Sustain = molten energy beam (no more flat slab)  ✅ no-error verified
`game.js`. Replaced the solid 3-stroke "brick" with a glowing **energy beam**: slimmer
(`lw*0.30` vs `0.42`), **soft feathered edges** (layered additive strokes — wide+dim →
tight+bright, so no hard rectangle), a **hot white core thread**, and **lava pulses flowing
down** the beam toward the catcher (animated `lineDash` + `lineDashOffset`). Brightens when
struck. Reads as living energy on the string instead of a slab. (Aesthetic tuning is the
user's call — screenshots of this animated canvas time out on my side.)

### 35. 30 fps — now a display/diagnostic question, not a render one
Reaffirmed: render ≈0.13 ms/frame. The lock is either the video compositing (test via the
Background→Performance toggle) or — given a steady 30 fps / 33 ms on Windows where a desktop
browser usually composites video fine — the **monitor's refresh rate** (e.g. 4K@30 Hz over
HDMI) or a power/vsync setting. If Performance mode is still 30, it's the display (Windows
Settings → System → Display → Advanced display → refresh rate), not anything in the game.

Version `?v=11`. `serve.py` (no-cache) is the dev server; relaunching the preview can reclaim
the port, so restart with `python serve.py` if 8787 drops.

---

# Increment 11 — HUD visual-polish pass (the "lazy panels")

Kept the information architecture (user said the side UI reads well) and all live-update
IDs; elevated the flat text into a proper instrument console. `index.html` (CSS + markup) +
`game.js` (one wiring add). Verified in-browser: elements render, styles apply, no errors.

### 36. Side-panel HUD reworked  ✅ verified (look is the user's call)
- **Signal motif**: every label gets a small glowing **crimson diamond** tick — ties the
  panels to the brand and kills the "unstyled text" feel.
- **Hierarchy**: SCORE/COMBO are heavier with subtle glow (combo crimson-glow); labels are
  tracked-out mono; track title + "// SIGNAL CONTROLLER" promoted to readable chrome.
- **Instrument cluster**: Accuracy + Max Combo now sit **side-by-side** (`.hud-row`) instead
  of a lonely vertical stack.
- **Judgment Log → composition bar**: added a stacked **proportion bar**
  (perfect=chrome / great=amber / good=pink / miss=crimson) above the counters, so you read
  the run at a glance. Wired in `updateHUD` (segment widths = count ÷ total). Verified live:
  2 GOOD hits → good segment filled 100%.
- **Refined gauges**: progress + stability bars are thicker, rounded, with a crimson glow.
- **Fills the height on purpose**: each panel's last block is bottom-anchored
  (`margin-top:auto`) so the top cluster + bottom readout frame the empty space intentionally
  instead of leaving a dead gap.

Version `?v=12`. (Colors stay strictly black/red/chrome/crimson; counter colors now match the
composition bar.)

---

# Increment 12 — REAL MUSIC CATALOG IS LIVE 🎵

The Lovable agent fixed the feed (replaced the broken PostgREST embed-join with a manual
two-step query). `GET /game-catalog/tracks` now returns **100 opted-in tracks** (real titles,
artists, genres, cover art, Supabase/Mux audio). The catch: they come back
`chart_status:"pending"` (audio but no server-baked chart). So I built the **Fast Path** —
in-browser charting — to make them playable now.

### 37. Live tracks play via in-browser charting  ✅ verified end-to-end
- `game.js`: new `bufferedProvider(url, meta)` + `RhythmGame.playUrl(url, meta)` — fetch a
  track's direct audio file → `decodeAudioData` → reuse the existing onset `analyzeBeats` →
  play the decoded buffer with the sample-accurate `DemoPlayer`. (Caches the last decode so
  replays are instant.)
- `catalog.js`: `trackReady` now counts a track as playable if it has a **server chart OR a
  decodable audio file** (`trackAudioUrl()` — prefers `audio_url`/`wav_url`, skips HLS which
  can't be decoded). Launch routing: server chart → `liveProvider` (scored + leaderboard);
  else audio → `playUrl` (in-browser, practice); else demo.
- Titles: the feed packs the description into `title`; trimmed to the first line (≤80 chars).

**Verified live in-browser:** catalog `isLive:true`, **raw 100 / playable 83**; launched a real
track ("…" by *Absolute Introspect*) → fetched the Supabase mp3 → **charted to 226 notes /
42 holds** → played through (clock advanced 21s→30s) → **zero console errors**. Real platform
music, real covers, on the guitar.

### What this unlocks + what's next
- **Now:** every opted-in track with audio is instantly playable — including brand-new
  uploads, with no per-track pipeline. The flywheel's first turn.
- **Next (additive, no rework):** "New / Hot / Trending" rails fed by `created_at` /
  `play_count`; and the **Scale Path** — server pre-baked charts (`generate-chart.ts` on
  upload) for instant load + competition-grade leaderboards (engine already prefers a server
  chart when present).
- **Data niceties (backend, low priority):** `duration_seconds`/`bpm` are null (we derive
  duration from the decoded audio, so cosmetic only); 17/100 tracks have no audio file yet
  (correctly hidden). Mux `audio_url` (M4A) is ideal for the tracks that have a Mux id.

Version `?v=14`.

---

# Increment 13 — real hit SFX + chords + bomb hazards + hit-reliability fix

### 38. Hit sound = real palm-mute guitar chug (no more beep)  ✅ verified
User supplied `Palm-mute Chug.mp3`. ffmpeg-trimmed to a tight 0.62s punch (dropped 1.4s of
dead tail + the embedded cover-art stream) → `assets/hit-chug.mp3` (12KB). `game.js` decodes
it once into a WebAudio buffer (zero-latency, overlapping) and plays it per hit with
**per-lane pitch** (lanes 0–5 → playbackRate ~0.92–1.08, so each string rings differently
and simultaneous chords sound like real chords) + per-judgment level, balanced at
`SFX_LEVEL 0.85`. Falls back to the old blip if the sample hasn't decoded. Verified: fetch
200, decodes (0.62s, stereo).

### 39. Chord notes (press two keys at once)  ✅ verified (38 in the demo chart)
`buildNotes`: on spaced strong beats (not easy difficulty), a second simultaneous note is
added in another lane. The engine already judges lanes independently, so the player presses
both keys together; the per-lane pitch makes it ring as a chord.

### 40. Bomb / trap hazards (don't-hit notes)  ✅ verified (12 in the demo chart)
New `type:'bomb'` sprinkled into the gaps (denser on hard). Rendered by `drawBomb` as a dark
orb with a pulsing red warning halo + a bright ✕. **Hitting** its lane while it's in the
window → penalty (combo break, stability/score-gate hit, screen shake, "✕ BOMB"); **letting
it pass** → safe (`hit:'avoided'`, never a miss). The per-frame miss sweep skips bombs.

### 41. Hit-reliability + accuracy  ✅
Confirmed the judge model is correct and frame-rate-independent: `t = songTime() − audioOffset
− inputLag`, and the marble's on-screen position is driven by the **same** song clock — so a
hit when the marble sits on the catcher is a true PERFECT. Added `notes.sort((a,b)=>a.time−b.time)`
after the chord/bomb inserts — important: those inserts were out of time order, and
`handleHit`'s early-`break` (which assumes ascending time) could otherwise skip a valid
target = dropped hits. Now every in-window note is found. (Remaining motion-smoothness lever
is the 30 fps → Background:Performance test.)

Verified end-to-end (demo): 211 notes / 35 holds / 38 chords / 12 bombs, hits + misses
register, zero console errors. Version `?v=15`.

---

# Increment 14 — catalog at scale (full library + searchable + fresh-upload-first)

Decision: uploading already opts a track in (per ToS), so the game serves the WHOLE library,
not a gated 100. Game side prepped now; the unlock is a one-line backend change (brief below).

### 42. Catalog loader scaled + fresh-upload sort fixed  ✅ verified live
`catalog.js`: paging cap 25→**60 pages (~12k tracks)**; and normalized `created_at` (live
rows return an ISO **string**, mock returns a **number**) to a numeric ms timestamp on load —
so the **"New" rail sorts correctly** and a just-uploaded track surfaces at the top. Verified
on live data: New rail leads with the most-recent uploads (2026-05-31), descending. Search
(title/artist/genre) + sort (New/Hot/A–Z) already run client-side over the loaded set, and the
songs list renders in pages of 40 (infinite scroll) — so it scales gracefully.

### 43. Backend unlock briefed  →  `CATALOG_SCALE_BRIEF.md`
Copy-paste prompt for the Lovable agent: **remove the `game_dev_opt_ins` gate** (return every
track that has audio), keep limit/offset, and **add server-side `?q=` search + `?sort=new|hot`**
for when it's thousands+ (so search doesn't require downloading the whole library). Optional
`/my-tracks` for a "Your Tracks" shelf. The moment the gate is lifted, the full library is
searchable + playable with zero further game changes; I'll switch search to server-side when
`?q=` is live. Version `?v=16`.

---

# Increment 15 — "game feel" typography + juice pass

User: the side UI reads good but the **text doesn't look like game text** (Unity/Unreal feel).
Researched it (game UI = immersion + instrument type + motion; web UI = flat clean). Applied:

### 44. Game-HUD type system  ✅ verified
Added two free game fonts — **Oxanium** ("the scoreboard of a video game") for all
readouts/numbers (SCORE, COMBO, judgment counts, gauges, mobile HUD) and **Chakra Petch**
(cyberpunk-UI) for labels — replacing web-display Unbounded/Mono in the HUD. Judge-flash +
countdown also moved to Oxanium. Verified live: fonts load, `#hud-score` → Oxanium, labels →
Chakra Petch.

### 45. Angular corner-bracket frames  ✅ verified
Each HUD panel now has crimson **corner brackets** (tactical-HUD motif) via pseudo-elements —
a game frame instead of a plain web card. (Global scanline + grain already present.)

### 46. Animated score count-up  ✅ (juice)
`scoreDisplay` lerps toward the real score every loop frame, so the score **rolls up** on a hit
instead of snapping — the classic game counter. `updateHUD` writes the animated value so there's
no snap-then-jump; resets to 0 per run.

Version `?v=17`. (Big display headers like PAUSED/SETTINGS left on Unbounded for now — easy to
move to a game face too if wanted.)

---

# Increment 16 — branded animated loader (the "DECODING SIGNAL" screen)

User hated the generic spinner loader — wants it on-brand (the ReactivVibe blood-atom symbol)
and animated/fun. Rebuilt it as a **reactive-atom** loader (`index.html` SVG/CSS + `game.js`):

### 47. Reactive-atom loading screen  ✅ verified
- An inline **SVG atom**: three tilted wood-gold orbits (gradient + glow), a **glowing electron
  whizzing around each** (SMIL `animateMotion` along the ellipse paths), and a **pulsing
  wood/crimson nucleus** (the "drum"). Whole cluster slowly rotates (`atom-rot`).
- A **progress ring** around the atom **fills as the song is analyzed** — `setLoading` drives
  `stroke-dashoffset` from the %; verified at 5% the ring sat at exactly `628·(1−.05)=596.6`.
- Text moved to the game fonts (Oxanium stage + %, Chakra Petch messages), crimson glow.
- Respects reduce-motion (animations off). Verified: renders, electrons + spin animate,
  ring tracks progress, zero errors.

Note: this is a procedural atom that *evokes* the brand symbol. If you want your **exact
textured/blood-drip atom art** as the centerpiece, drop the PNG in `assets/` and I'll composite
it (static art + the animated electrons/glow/ring orbiting it). Version `?v=18`.

---

# Increment 17 — FULL LIBRARY UNLOCKED 🎉

Lovable shipped the unlock: `game-catalog/tracks` dropped the `game_dev_opt_ins` gate and now
returns **852 tracks** (X-Total-Count header), only rows with playable audio, plus server-side
`?q=` search + `?sort=new|hot|az`, and `play_count` from real `click_count`.

**Verified live in the game (no code changes needed — it was already built for this):**
- Catalog loads the **whole library: 852 fetched, 758 instantly playable** (up from 83).
- **Search works across all of it** ("love" → Love Me Like You Mean It, Love 4 Live, …).
- **New rail = freshest uploads** (today's 2026-06-02 tracks lead).
- A random library track charts in-browser + plays with full mechanics; zero console errors.

### Notes / small follow-ups
- ~~94 of 852 aren't playable yet~~ **FIXED.** Lovable backfilled Mux **audio-only static
  renditions** (`.m4a`) for the 105 affected assets + set `mp4_support:"audio-only"` on new
  uploads. Verified: endpoint returns **0 null / 0 HLS-only** audio URLs; the game now counts
  **852 / 852 playable** (was 758); an `.m4a` track decodes + charts + plays end-to-end (AAC
  works in-browser). Every track in the library is playable, and future uploads will be too.

---

# Increment 18 — How to Play (teach the mechanics)

### 48. "How to Play" legend  ✅ verified
New players now learn the note types. Added a **How-to-Play overlay** (`index.html` + `game.js`):
on-brand card (Oxanium/Chakra Petch, crimson), with a labelled mini-icon for each mechanic —
**TAP** (the real note sprite), **HOLD** (a crimson beam), **CHORD** (two overlapping notes),
**BOMB** (the ✕ "don't hit"). Opens from a new **?** button in the jukebox header, **auto-shows
once** on first visit (`rr_howto_seen` flag), and closes via "Got it" or backdrop click.
Verified: 4 items render, fonts applied, auto-shows first-run, close sets the flag, ? reopens,
zero errors. Version `?v=19`.

---

# Increment 19 — How-to fix + fuller Pulse + Guitar Hero juice

Playtest feedback: How-to-Play rendered behind the jukebox; Pulse felt empty; wanted GH-style
fire/lightning on combos (researched [GH mechanics](https://guitarhero.fandom.com/wiki/Star_Power)).

### 49. How-to-Play overlay fixed  ✅ verified
It had no z-index (sat under the jukebox) + a 50%-opaque centre, so everything bled through.
Now `z-index:260` (above settings/calib) + an **opaque** warm-black backdrop with a crimson
glow. Verified live: `z-index 260`, background `rgb(10,7,6)` — fully covers.

### 50. Pulse (medium) density — no more dead air  ✅ verified
Added a **gap-fill pass**: after holds/chords/bombs, any remaining empty stretch gets evenly
spaced filler taps (per-difficulty max gap: hard .62 / medium .74 / easy 1.05s), measured from
a hold's END so sustains aren't crowded and bombs keep a clean lead-in. Verified: a medium demo
went **211 → 332 notes (121 fillers)** — steady flow, still not hard.

### 51. Guitar-Hero combo juice  ✅ (logic verified; visuals on a real streak)
- **Streak flames**: the catchers throw rising fire (warm ember particles) once your multiplier
  hits **x2+, scaling to x4** — the classic GH "fretboard on fire" / "keys lighting up". Gated
  by reduce-motion + lite.
- **Lightning strike**: every **25-combo milestone** fires jagged bolts + a hot screen flash +
  shake + a "N STREAK" callout.
  (Couldn't sustain a 25-combo in the throttled headless preview, so these are verified
  error-free + valid; you'll see them live when you streak.)

### Deferred to next
- **Chord "bars"** — 3-note chords + a connector bar so a chord reads as one bar to hit
  together (GH all-keys feel).
- **Browse/search overhaul** — prominent typed search across the 852; doing it as a focused
  redesign rather than bolting onto this batch.

Version `?v=20`.

---

# Increment 20 — audio rebalance, miss "squelch", strings-on-fire (GH philosophy)

GH-grounded ([missed-note error sound](https://gamefaqs.gamespot.com/boards/944203-guitar-hero-world-tour/47619133); the song keeps playing, your guitar "clams").

### 52. Hit chug turned down  ✅
`SFX_LEVEL 0.85 → 0.5` — the chug now accents instead of overpowering the song.

### 53. Music no longer ducks on a miss — a "squelch" plays instead  ✅ verified
Removed the volume-dip-on-miss (and on bomb) so the **music stays at full quality**, matching
the GH model. On a miss/bomb we now play the user's **`Guitar Squelch Mistake`** SFX
(`assets/miss-squelch.mp3`, trimmed to 0.5s) — the GarageBand/GH "you clammed it" cue — plus a
**dull downward "dud" spatter + dead-string snap** at the missed lane (no bright burst). Verified:
squelch fetches + decodes (200, 0.5s); music gate now constant.

### 54. Strings catch fire as the combo climbs  ✅ (logic verified)
The neon strings now read the multiplier: crimson at x1 → **hot orange, thicker glow, shimmer,
and rising flame-licks along their length by x4** — real "energy/feel" on a streak (on top of
the catcher flames + 25-combo lightning). Reduce-motion/lite aware.
(High-multiplier visuals need a sustained streak the throttled headless preview can't hold, so
they're verified error-free + valid; you'll see them live.)

Version `?v=21`. Open: chord "bars", browse/search overhaul.

---

# Increment 21 — prominent typed search (browse overhaul, part 1)

Pain: the coverflow is hard to scroll through 852, and search was buried behind an icon —
"people are gonna wanna look for their own music."

### 55. Persistent header search bar  ✅ verified
Added an always-visible **search field in the library header** (between the brand and the
icons): crimson focus ring, Chakra-Petch, magnifier + clear (✕). Type → instantly switches to
the results list filtered by **title or artist across the whole library**; clear/Esc → back to
the coverflow. (`openSongs` now takes an initial query; the header input drives it, debounced
140 ms.) Hidden < 640px (mobile keeps the search icon). Verified live: typing "love" → 18 real
matches ("Love Me Like You Mean It · Airoyu", …), header reads `Search · "love"`, clear returns
to the jukebox, zero errors.

Note: searches the loaded set (all 852) client-side — instant. When the library reaches several
thousand I'll switch this to the server `?q=` endpoint (already built) + on-demand paging.

Version `?v=22`. Still open: chord "bars" (3-note + connector); deeper browse polish if wanted.

---

# Increment 22 — chord "bars" + project handoff doc (CLAUDE.md)

### 56. Chord bars (Guitar-Hero "hit the bar together")  ✅ verified
`buildNotes` now builds chord GROUPS (a shared `chordId` + `chordLanes`, one `chordLead`):
mostly 2-note, with **occasional 3-note chords** (often on Hard, rare on Medium). Render draws a
**glowing horizontal rail connecting the simultaneous notes** (crimson body + hot-white core)
that rides down with them — so a chord reads as one bar to strum together. Verified on a Hard
demo: 497 notes / 89 chord-notes / 61 holds / 25 bombs, chord-bar renders, zero errors.

### Project handoff — `CLAUDE.md`  ✅
Wrote a top-level **`CLAUDE.md`** (Claude Code auto-loads it) so a fresh agent can continue if
context fills: absolute project path, run command (`python serve.py` → localhost:8787 no-cache),
file map, architecture, conventions/constraints (cache-bump `?v`, brand = no purple, localhost
bind, restart serve after preview), the verify-by-eval method + dev hooks, the catalog API, and
the open/next list. **Read CLAUDE.md first, then this CHANGELOG.**

Version `?v=23`.

---

# Increment 23 — hit SFX barely-there
`SFX_LEVEL 0.5 → 0.12` (game.js) — the per-note chug is now almost inaudible, per user. Music
+ miss-squelch unchanged. Version `?v=24`.
- **Server-side `?q=` search now exists** — at 852, loading the full set + client-side search is
  instant, so no change needed yet. When the library hits several thousand, I'll switch the
  search box to query the server (and load rails on demand) so startup stays fast. Threshold is
  roughly when the full load (200/page) exceeds a few seconds.

---

# Increment 24 — hit SFX lowered again
`SFX_LEVEL 0.12 → 0.05` (game.js) — the per-note chug is now even quieter (a faint accent on
PERFECT hits, near-silent otherwise). Music + miss-squelch unchanged. Made `SFX_LEVEL` a `let`
so it can be wired to a Settings slider if we want self-serve control (the level's now been
dialed down 4× — `0.85 → 0.5 → 0.12 → 0.05`; a slider would end the round-trips, same way the
Background→Performance toggle replaced repeated FPS readings). Version `?v=25`.
- Verified: `node --check game.js` clean; serve.py up on :8787 with no-store headers.
- Audio level is a by-ear call I can't make from here (game is driven muted + headless throttles
  audio) — confirm on your machine; if 0.05 is still too present, say so or I'll add the slider /
  a full mute toggle.

---

# Increment 25 — Overdrive is finally playable + self-serve audio (overnight pass)

A fresh agent picked this up overnight. The headline: **Overdrive (Star Power) existed but was
mouse-only** — you had to click a tiny flame to use it, so in practice nobody ever fired it. And
**Space silently restarted your whole run mid-song** (a real footgun). Fixed both, then added the
audio control the last few increments kept asking for. All verified in a real browser (muted),
`node --check` clean each step, zero console errors throughout.

### 57. Overdrive on the keyboard + Space no longer nukes your run  ✅ verified live
`game.js` + `index.html`. **Space now activates Overdrive** when the meter is charged (was
`restartGame()` — an accidental run-killer; Restart still lives in the pause menu). Added a
one-shot **"OVERDRIVE READY"** flash the moment the meter fills, an activation **riser SFX**
(`playOverdriveSfx` — a short two-saw synth sweep, mute-gated, no asset) + triple haptic, and
discovery cues: the gauge reads **"OVERDRIVE · SPACE"** with a tooltip, the in-game footer hint
fixed (`SPACE RESTART` → `SPACE OVERDRIVE`), and How-to-Play gained **STAR** + **OVERDRIVE** cards.
Verified end-to-end: charge → READY flash → Space engages (2× multiplier, 8 s timer, flame active),
re-press while active is a no-op, Space mid-run keeps the clock running (footgun gone).

### 58. Self-serve audio — Music + Hit-Sound sliders  ✅ verified
`game.js` + `index.html`. Two persisted Settings sliders (in `rr_settings`): **Music Volume**
(0–100%, multiplies the music gain via `applyGate`/`DemoPlayer`) and **Hit Sound** (0–50% →
`SFX_LEVEL`, default 10% = the current 0.05, so nothing changes unless you move it). Ends the
SFX-tuning round-trips (the chug was dialed `0.85 → 0.05` over four increments). Hoisted the
`SFX_LEVEL` declaration so persisted prefs can set it without a temporal-dead-zone error.
Verified: round-trip + persistence + live apply; settings panel populates from saved prefs.

### 59. UX flow + a11y polish  ✅ verified
- **Results screen keyboard flow**: Enter = Play Again, Esc = Menu (was mouse-only), with an
  on-screen hint — chain runs without the mouse.
- **Pause overlay**: "ESC Resume" hint.
- **a11y**: `aria-label`s on all Settings sliders; shared `.results-keys` style (warm on-brand).

### Dev hooks added (still test-only — strip before launch)
`__rrDebug.chargeOd()` / `.od()` (overdrive state) and `.audio()` (music gain / mute / SFX level),
used to verify the above deterministically despite headless audio/rAF throttling.

Versions `?v=25 → ?v=29` (bumped per commit batch). Git: this pass initialised a local repo and
landed as focused commits (baseline + one per batch).

---

# Increment 26 — the reward loop: real persistence + Career profile + results payoff (overnight)

> Context: a second agent was editing this folder **concurrently**. I detected the live edits
> (my writes kept bouncing with "file modified since read"), backed out of the files it was
> actively writing to avoid corrupting its work (audio + Overdrive — Increment 25 above), waited
> for it to go quiet, then built the one big system nobody had touched: **progression / the reward
> loop** (ROADMAP Pillar B, deferred since day one). Sole-editor once the coast was clear;
> `node --check` clean each step, verified in a real (headless) browser, **zero console errors**.

### 60. Real plays now PERSIST — the reward loop was cosmetic before  ✅ verified
`game.js` + `catalog.js`. Root cause: `endGame` only saved a best **inside `if (session.submit)`**,
which only the (currently unused) server-chart path has — so for every in-browser-charted track
(**all 852 live tracks today**) and the demo, `saveBest` never ran. The cover-art grade chips and
the "BEST" rail were showing only the **mock seed** (`_mockBest`), never your real play. Fixed:
`endGame` now ALWAYS calls a new `RhythmCatalog.recordLocal(results)` (separate from the leaderboard
submit). `recordLocal` saves the per-song best (compared against your REAL saved scores, not the
seed) and accumulates lifetime **career** stats. `onSubmitResult` is now leaderboard-only (no double
record). Verified: a simulated run round-trips into `getBest` + `getCareer` with correct totals
(2 runs → score 42,345, best combo 140, full-combos 1, grades A:1/S:1, lifetime acc 96.0%).

### 61. Career / Controller Profile  ✅ verified
`index.html` (self-contained — a header button, an overlay, CSS, a render script reading
`RhythmCatalog.getCareer()`; backed by `rr_career` in localStorage). A new **person icon** in the
library header opens a branded overlay (Oxanium/Chakra Petch, crimson, mirrors the How-to-Play
card): lifetime **Score / Runs / Songs Played / Best Combo / Accuracy / Full Combos**, a **grade
distribution** (S·A·B·C·D counts), and a flavor **rank title** that climbs with play
(SIGNAL INITIATE → RIFT TAPPER → ECHO RUNNER → … → SIGNAL ARCHITECT). Empty-state for new players;
a two-tap **RESET CAREER** (wipes `rr_career` + `rr_scores`); Esc / backdrop closes. Verified live:
opens, renders 6 stat cells + 5 grade cells + the rank from real data, closes clean; 0 errors.

### 62. Results payoff — star rating + GRADE UP  ✅ verified
`index.html` + `game.js` + `catalog.js`. The results screen now shows a **1–5 star rating**
(derived from accuracy) that pops in sequentially right after the big grade stamps — a quick visual
"how'd I do" on top of the letter. And beating your prior grade on a track fires a gold
**"GRADE UP · <grade>"** badge alongside the existing FULL COMBO / NEW BEST. (Star fill + badge are
node-valid and wired; the pop animation shows on a real run, like the other combo visuals.)

### Why these, and not the OPEN/NEXT list
The other agent had the obvious roadmap covered (audio sliders, Overdrive). The genuinely
un-addressed, high-value gap was **progression** — the "why keep playing" layer the game never had.
It's also what makes the *other* agent's polish pay off: your S-ranks, combos and grades are now
*yours*, and they accumulate across sessions.

### Notes / deliberate non-actions
- A **miss-SFX volume slider was intentionally not added** — the other agent's mixing board
  (Music + Hit Sound) is their design and covers the real need (hit-chug control). I removed my
  stray `set-miss` stubs rather than compete on audio.
- New storage key **`rr_career`** (lifetime aggregate). `rr_scores` (per-song best) now fills from
  real play, not just the seed.
- Server-chart tracks (when they exist) still submit to the leaderboard exactly as before — local
  recording is additive and always-on, so practice runs build your Career too.

Version `?v=32 → ?v=33`. Landed as focused git commits on top of the other agent's history.

---

# Increment 27 — post-feedback: juice pass, results "Career" shortcut, network hardening

User tested the audio-reactive build and is happy ("mechanics feel precise and good"). This pass adds
the game-feel juice they asked for, a results→career shortcut, and the first Track-B hardening.

### 63. Game-feel juice  ✅ (verified live by the user)
`game.js` + `index.html`. **Combo heat** — screen edges glow hotter crimson as the multiplier climbs
x1→x4 (additive, reduce-motion aware). **Perfect shockwave** — a big crimson ring cracks out on
PERFECT hits. **Punchier judgment** — the PERFECT/GREAT popup overshoots in with a blur-pop +
color-matched glow + float-up. **Audio-reactive scene** — an AnalyserNode taps the music *pre-gain*
(so it reacts even when muted) and pulses `bgPulse` on bass onsets, so the whole scene breathes with
the actual track, not just on hits. **Escalating combo milestones** — every 25-combo streak ramps the
lightning/shake; every 100 is a bigger "STREAK!!" moment.

### 64. Results → CAREER shortcut  ✅
`index.html`. A **CAREER** button on the results screen opens the Career/Controller Profile overlay
(reuses the header button's handler) — finish a run, jump straight to your stats.

### 65. Track B (hardening) — network timeout  ✅ node-verified
`game.js`. New `fetchAudio()` wraps both providers (demo + live) with a 30s `AbortController` timeout,
so a dead/slow connection fails cleanly (toast + back to menu) instead of hanging the loading screen
forever. Friendlier error copy. First of the launch-hardening track (dev-hook stripping deferred to
just-before-deploy so debug tools stay available during the build).

Version `?v=33 → ?v=36`.

---

# Increment 28 — LEVELS: a tiered Level Select (the "different levels to play")

User asked for "different levels that could be played" + a level picker. (My earlier star-gated
"campaign" pitch over-complicated it — backed out of the unlock economy.) v1 is a clean tiered
**Level Select** layered on the live catalog, no gating.

### 66. Level Select  ✅ verified (structure + launch wiring; visuals show on the user's screen)
`catalog.js` + `index.html`. A new **LEVELS** button (stacked-layers icon) in the library header
opens a branded overlay with **three tiers — WARM-UP (Easy) · PULSE (Medium) · FRACTURE (Hard)** —
each a row of **4 level cards** drawn from the live library (12 distinct real tracks, spread across
the catalog, each with cover art + title + artist + your best-grade chip). Tap a card → it sets that
tier's difficulty and launches the track straight into play, via a new
`RhythmCatalog.launchTrack(track)` that reuses the sheet's routing (server-chart vs. in-browser vs.
demo) with no sheet. Esc/backdrop closes. Jukebox free-play untouched.
- Verified live (headless eval): `launchTrack` exposed, catalog 872 tracks, overlay opens with 3
  tiers / 12 distinct real cards, closes clean, **0 console errors**.
- v1 notes: songs are auto-assigned from the catalog (spread for variety). Easy to curate specific
  songs per level, add tiers, or gate by stars for a campaign — pending the user's vision of "levels."

Version `?v=36 → ?v=37`.

---

# Increment 29 — optional fail-state + desktop launcher

### 67. Fail Mode — optional rock-meter death  ✅ node-verified (inert by default)
`game.js` + `index.html`. The stability meter was cosmetic; now it can matter. New
**Settings → Fail Mode** toggle (**No-Fail** default / **Fail Out**): when on, an emptied stability
meter collapses the run — `failRun()` flashes "SIGNAL LOST", ends the run, and the results screen
shows a crimson **⚠ Signal Lost** badge + a fail blurb. Persisted in `rr_settings`; the per-frame
check is gated on `failMode`, so the default-off path is completely inert (one boolean short-circuit,
no behavior change). Addresses the "no stakes" GH-standard gap; opt-in so casual/beta runs aren't
punished. `node --check` clean; settings plumbing mirrors the proven reduce-motion toggle.

### 68. Desktop launcher + shortcut  ✅
`launch-game.bat` (gitignored — machine-local) + a **"Reactive Rhythm" desktop shortcut** (created on
the user's OneDrive Desktop, with Chrome's icon). One click ensures serve.py is up on :8787 and opens
the game in a clean **Chrome app window** (`--app=`). For convenient local dev access until the site deploy.

Version `?v=37 → ?v=38`.

---

# Increment 30 — holds feel TIGHT (user feedback: the sustain mechanic was loose)

User: hitting a long-note's head cleared it without holding, and the beam "disappeared rapidly" —
the hold didn't feel as tight as the taps. Root cause: holds were "forgiving by design" (Increment
21) — the head scored like a tap, holding was an optional bonus, and the beam vanished the instant
you weren't actively holding.

### 69. Tight holds — you actually have to hold them  ✅ node-verified (feel is the user's to confirm)
`game.js`. Two changes:
- **Beam persists + depletes.** A struck hold's beam stays and retracts into the catcher across its
  full length; let go early and it goes **dim and dies in place** (a new `resolving` render state)
  instead of vanishing — so a drop reads clearly.
- **Holding is required.** Release before **75%** held = a **DROPPED**: combo break + miss squelch +
  the lane's string goes dead. Release in the home stretch (≥75%) still completes cleanly (fair tail
  grace); holding to the tail gives the crisp **HOLD!** payout as before. A quick tap no longer
  clears a sustain — you have to push it down.
- Tunable: `GRACE = 0.75` in `endHoldEarly` (raise = more forgiving). The combo break can be
  softened/removed if it reads too harsh on auto-charts.

Version `?v=38 → ?v=39`.

---

# Increment 31 — Easy difficulty restructure (a real on-ramp)

Per the GH-standard critique: difficulty only changed speed/density, not structure — Easy was just a
slower 6-lane chart. Now Easy is genuinely simpler (GH uses fewer frets on lower difficulties).

### 70. Easy = fewer lanes + no bombs  ✅ node-verified (Medium/Hard provably unchanged)
`game.js` (buildNotes). A per-difficulty active-lane window: **Easy uses 4 centered strings**
(lanes 1–4), **Medium/Hard use all 6**. Implemented as `LANE_SPAN = {easy:4, medium:6, hard:6}` + an
`inSpan()` wrap on every lane pick (main, chords, bombs, gap-fill). Span 6 makes `inSpan` the
identity, so **Medium and Hard charts are byte-for-byte unchanged** — only Easy is restructured.
**Bombs are also removed from Easy** (a "don't-hit" hazard is confusing for newcomers). Added
`lanesUsed` to `__rrChartStats` for verification. Result: Easy is a clean on-ramp (4 strings, no
hazards, already the slowest/sparsest) — important for beta testers who've never touched a rhythm game.

Version `?v=39 → ?v=40`.

---

# Increment 32 — UI polish pass (conservative, on-brand)

The high-traffic screens (start/library/results) are already strongly designed + brand-locked, so
this pass is deliberately conservative — safe, additive touches justified from the code. (I can't
screenshot the animated canvas, so deeper aesthetic polish is best done with the user's eye.)

### 71. Overlay entrances + results-row wrap  ✅
`index.html` (CSS). (1) The modal overlays — **How-to, Levels, Career** — now **scale/fade in**
(`cardIn`, reduce-motion aware) instead of popping in flat, matching the crafted entrances elsewhere
(logo slam, grade reveal). (2) The results action row now **wraps + centers** (`flex-wrap`) — it had
grown to 4 buttons (PLAY AGAIN / MENU / CAREER / COPY SCORE) and could crowd a narrow desktop row.
Deeper screen-level aesthetic polish deferred to user-directed iteration.

Version `?v=40 → ?v=41`.

---

# Increment 33 — beta resilience: error capture + auto-pause on focus loss

Safe, invisible Track-B hardening (no feel/visual risk) toward beta-readiness.

### 72. Global error guard  ✅
`index.html`. Uncaught errors + promise rejections were vanishing silently; now they're captured to
`localStorage.rr_errlog` (last 25, with message + source + timestamp), retrievable via
`window.__rrErrors()` and cleared via `__rrClearErrors()`. Registered before the app scripts so it
also catches load-time errors. Foundation for beta bug reports / future telemetry (no backend yet).

### 73. Auto-pause on focus loss  ✅
`game.js`. Tabbing away mid-song used to keep the track playing → the run was ruined. The window
`blur` handler now also pauses while playing (audio suspends, pause overlay shows; resume on return).
Pairs with the existing lane-release-on-blur safety.

Version `?v=41 → ?v=42`.

---

# Increment 34 — onboarding calibration nudge + musical-chart A/B (toward beta)

### 74. First-run calibration nudge  ✅
`index.html` + `game.js`. The How-to overlay (auto-shows first run) now nudges new players to
calibrate — a "⊹ CALIBRATE MY TIMING" button + a one-line prompt that opens the existing A/V
calibration. Timing is the core of the feel; an uncalibrated setup makes even great charts feel off,
so this matters for a beta tester's first impression.

### 75. "Musical" chart mode (A/B toggle, default Classic)  ✅ node-verified (feel is the user's A/B)
`game.js` + `index.html`. A safe swing at the #1 GH gap: **Settings → Chart Feel: Classic / Musical**,
default **Classic** (current behaviour, byte-identical). In **Musical** mode, each note snaps to the
**strongest onset within its step-window** instead of a blind every-Nth onset — so notes land on the
song's actual hits (kicks/snares) at the same density. Toggle + replay a track to A/B. (Hard is
unaffected — step 1 = every onset already; mostly reshapes Easy/Medium.) The user's ears decide if it wins.

Version `?v=42 → ?v=43`.

---

# Increment 35 — deploy handoff: README + GitHub push steps (#3)

Added `README.md` (repo front-page: run / file map / deploy / the one-time GitHub push + Lovable
connection / backend notes). The repo is clean with full history; the only step that needs the user
is GitHub auth — create a private repo, `git remote add`, `git push`, then connect Lovable so its
agent pulls the latest. After that, every change here is one push from a gated beta on
`reactivvibe.com/play`. No game code changed (no `?v` bump).

---

> _(Increments 36–v91 — the `visual-overhaul` branch: photoreal asset set, Skully level, env
> picker, menu hub, store, open-lobby MP, library rails — are captured in the git history +
> `_HANDOFF_v91.md`, not transcribed here.)_

---

# v92–v96 — `visual-overhaul` continuation (the `_HANDOFF_v91.md` queue)

Five queued build-8 packages, integrated one at a time and headless-tested before each commit.
Gameplay/scoring/timing **byte-identical** throughout (all additive, guarded side-channels).

### v92 — Flipbook FX hooked into the engine  ✅
Wired the asset agent's `assets/fx/fx-player.js` into `game.js` (per the handoff — used fx-player.js,
not the duplicate `flipbook.js` the build doc proposed). Load FxPlayer once (31 sheets), composite
`fx.draw(ctx)` at the end of `render()` inside the camera-shake transform. `emitFx()` maps
hit/perfect/miss/combo/overdrive → additive bursts scaled to lane width, at the real hit/HOPO/miss/
bomb/milestone/overdrive sites. `THEME_FX` (read from `#game[data-rrtheme]`) gives Skully violet
soul-burst variants (bone/pink slots ready). Bombs are now animated hazards: a **bomb-fuse** loop
rides each bomb, **bomb-explode** on strike. `__rrDebug.fx/fxEmit/fxDraw` dev hooks. Verified: 31/31
sheets load, emit→draw paints (maxLum 765) + culls, no errors.

### v93 — 6 premium guitars: geometry + store  ✅
Added `crimson_chrome` / `ember_bone` / `gold_relic` to `SKIN_GEOM` (per-skin nut/bridge fractions
from ASSET_PROMPTS.md) so their catchers ride the painted strings; added `bone_daddy` + `melody_pink`
to the store so all 6 premium guitars are purchasable + equippable. `__rrDebug.geom()` hook. Verified:
each skin applies its measured geometry, store lists 6 skins + boss + theme.

### v94 — Bone Daddy + Melody levels, mechanics, Random stage  ✅
Two showcase levels in `AUTHORED[]`: **Bone Daddy** ("Get Busy", medium, theme `bone`, booty-shake)
and **Melody** ("Highway Lover", hard BOSS, theme `pink`, cat-paw, purchasable via new `melody_boss`
store item). Registered `bone`/`pink` themes across all 6 theme maps. New per-level `mechanic` field +
`buildMechanic()` overlay driven by `RhythmLevelFx` (booty bounces on hit/combo; paw bats across the
catcher). First env chip is now **Random** (`assets/ui/random-stage.png`, default-selected) — rolls a
random non-boss/non-paid environment each play; "Arena" keeps plain Quick Play. Verified: trackIds
resolve, themes + geometry apply, mechanics fire, Bone Daddy launches to `playing` with identity intact.

### v95 — Multiplayer ROOM SYSTEM  ✅ (structural)
Applied `_build8_multiplayer.md`: lobby action bar (⚡ Quick Match, ＋ Open a Room, 🜨 Browse Rooms),
a rooms step (browser + open-a-room form + waiting room), per-room `rr-room-<id>` presence, room→match
handoff into the existing `startMatchChannel` lifecycle, quick-match deterministic pairing, and
spectate. `multiplayer.js` + `#multiplayer-screen` only; match engine not forked. Verified single-
browser: step switching, openRoom→waiting area, close, quick-match toggle, offline guards, no errors.
**2-peer matching/join/spectate need the user's two-device test** (one browser can't host two presences).

### v96 — RYO menu visuals  ✅
Applied `_build8_menuvisuals.md` (index.html only). Hub gets the `menu-loop.mp4` cinematic backdrop +
a lower-right **RYO hero** (placed inside `#menu-hub`, not a fixed child of `#start` — inactive
screens are `opacity:0`, which hides fixed descendants). Six **living tiles** (per-accent `--ta`,
hover bloom, glass sheen, drifting hairline). Loader gains an optional `atom-loading.png` spin/pulse
core (self-heals to the SVG — PNG still absent). **First-run RYO intro** (`ryo-intro.mp4`) plays once
before the hub (skippable, `localStorage rr_ryo_intro_seen`, `?ryo=replay`). Skipped the doc's
Default→Random patch (already shipped in v94). Verified: video + hero load, tiles distinct, intro
activates/skips/persists, `?novideo` kills it, no errors.

**State after v96:** all five `_HANDOFF_v91.md` items done. Open: 2-device MP test; per-skin lane
fine-tune + per-level mechanic feel are the user's visual call (canvas screenshots time out headless).
Dev hooks (`__rrDebug.*`, `?dev/?novideo/?ryo`, FPS meter) still present — strip at content-freeze.

### v129 — 3D MARBLE notes (glossy spheres rolling at you) + lane-colored comet trails  ✅
Playtest: contrast was right but the notes read as FLAT faceted hexagons — the user wants 3D MARBLES
rolling down at the player ("that's what makes it easily playable"). A multi-agent workflow (genre
research + code diagnosis + asset-approach incl. a Blender connectivity probe) settled it: **procedural
canvas** beats pre-rendered (Blender is offline; raster sprites mip-blur under the 1/z rescale across
the 20–90px note travel; canvas recolors free for all 5 lanes). New `buildMarble(base, lane)` replaces
the flat hexagon: a glossy lane-colored SPHERE with the full 3D stack in draw order — contact shadow
(grounds it), offset radial body (lit cap → true color → shadow core → reflected-light rim), deepened
terminator (bottom-right falls to shadow), fresnel reflected rim, the warm near-black OUTER RING
(pops on BRIGHT guitars), thin white top rim, and a two-stage white SPECULAR hotspot upper-left (the
#1 "this is a 3D ball" cue). gfx.gems[] now build via buildMarble (was buildGem); dead sphere/sphereHot
dropped. The "rolling at you" read = fixed upper-left specular + the existing depthScale grow-on-approach.
**Trail upgraded** (the actually-shipping inline trail, game.js ~2945): recolored from hardcoded crimson
to the note's LANE color + a hot-white core speed-line, so the comet matches its marble. Verified
in-engine: Melody red+yellow marbles, Bone Daddy red/yellow/orange marbles in a row — all read as
glossy 3D spheres with specular + terminator + lane comet trails, pop on pink/bone, distinct lane
colors, zero console errors (captures `_cap_v129_*`). Zero credits. Bump ?v 128→129.

### v128 — READABILITY: GH-grade high-contrast notes + clean vector catchers (no more black box)  ✅
Playtest: the falling marbles were nearly invisible (pink-on-pink on Melody, bone-on-bone on Bone,
blend-into-dark on Skully) and the catcher buttons read as a "black box" on bright guitars. A
multi-agent workflow (GH/Clone Hero research + code diagnosis) proved both share one root: the play
elements were dark or theme-matched instead of bright + contrasting. Fix (all free canvas-code; also
REMOVES 3 PNG deps):
- **Notes → bright per-lane faceted GEMS.** Routed drawNote through the (previously unused) buildGem()
  — saturated gh lane color (green/red/yellow/chrome/orange) + white inner core + white rim + lane
  glow — and ADDED a warm near-black OUTER RING so the gem pops on BRIGHT guitars too (white core
  handles dark guitars). Sized ~1.55× the lane width (clearly readable). Cached per-lane in
  gfx.gems[] (rebuilt on resize). Star = gold buildStar; bomb unchanged (dark = negative cue).
- **Killed the theme gem-tint** (`_gemTintFor` returns null + setLevelGemTint(null) in index.html) —
  the recolor-to-theme was the pink-on-pink bug. Notes are NEVER the guitar color now.
- **Catcher → clean vector component.** Rewrote drawCatcher: deleted the dark ring-red.png blit (the
  "black box"); now a translucent lane-tinted well (guitar shows THROUGH) + thin dark inner ring +
  crisp chrome rim + additive lane glow + white-cored hit flash. Removed ring-red/white/gold.png loads.
**Verified in-engine all 3 levels (captures `_cap_v128_*`):** Melody green gem + clean catchers; Bone
yellow gem + clean catchers; Skully orange gem + clean catchers — every note pops against its guitar,
zero black box, per-lane colors distinct, zero console errors. Per-level note SHAPE (e.g. Melody paws)
deferred — contrast was the requirement. Zero credits. Bump ?v 127→128.

### v127 — BESPOKE THEMED GUITARS, done right (built to the template, verified on-strings)  ✅
With the v126 standard + gate in place, re-rendered Melody's and Bone Daddy's guitars the CORRECT
way (user chose bespoke over standardizing). Method that finally worked: image-to-image FROM the
proven crimson-chaos-ryo template (so the new art INHERITS the receding neck + body-at-bottom +
wide 5-string fan), restyling ONLY the body — Melody = candy-pink kawaii (bows, paws, hearts, atom
emblem), Bone Daddy = pink crushed-velvet with a white ribcage, gold skulls/chains/dollar charms.
NEVER off the old bass photos (that was the whole failure). Pipeline: 4 low drafts (confirm framing)
→ 2 high finals → Higgsfield bg-removal → trim → **measurement gate PASSED**: Melody 56 clean
exactly-5 rows (res 1.78px), Bone 111 (res 5.08px) — vs the bass photos' 5 and 0 — → _calibrate.py
→ overlay-proof (catchers on strings nut→bridge) → SKIN_GEOM `verified:true`. Old bass photos kept
as `_bassphoto_*.png`. **Verified in-engine, both levels:** the new pink guitars drive the surface
(their own measured nutXF, not the fallback), catchers sit exactly on the 5 painted strings at the
bridge (captures `_cap_v127_mel_catch.jpg`, `_cap_v127_bone_catch.jpg`), span 200/197px ≈ Crimson's
203, receding neck + faded top, zero console errors. Spend: ~10cr (4 low drafts + 2 high finals;
bg-removal free) → balance 77/412. Bump ?v 126→127.

### v126 — THE STANDARD: one verified play surface · the strings-on-guitar illusion guaranteed  ✅
Multi-agent investigation (workflow) found the real root cause with measured proof: melody-pink.png
and bone-daddy.png are flat front-on bass PHOTOS — string-measurement finds 0 clean 5-string rows on
Bone, 5 on Melody, vs 64 on Crimson and 57 on Skully's violet-gothic-5. Near-parallel strings, no
receding neck, no fade → you physically cannot ride 5 fanning lanes on them, and the v125 comfort
floor (k≈1.43 on Bone) flung the catchers ±63px onto the body. **The fix is a STANDARD, not another
patch:** (1) DELETED the v125 comfort floor + the skin lw hack — note/catcher size is now the ONE
proven Crimson formula on every level; (2) a **verification gate** in `_applySkinImg`: a guitar may
only become the play surface if its SKIN_GEOM entry is `verified: true` (template-framed, exactly-5
measured strings — crimson-chaos-ryo, violet-gothic-5, violet-gothic). Any other art (incl. the bass
photos) is rejected and the level falls back to the canonical surface — image AND lanes — so the
lanes/catchers can NEVER detach from the painted strings again, on any current or future level.
Removed the broken bone/melody SKIN_GEOM entries. **Verified in-engine:** Bone Daddy + Melody now
fall back to the proven public-demo guitar (guitar5) — `nutXF` = canonical crimson fractions, 203px
span / 51px step (identical to Crimson), catchers sitting exactly on the 5 painted strings at the
bridge, receding neck + faded top (capture `_cap_v126_bone_catch.jpg`), zero console errors. Levels
stay themed via world backdrop + reactive cards + mechanic + accent. NEXT (user's call): optional
themed pink guitars re-rendered to the template. Bump ?v 125→126.

### v125 — PLAYABILITY: every level now plays like the default Crimson highway  ✅
Playtest verdict: the character levels were "extremely difficult… items coming down are too small…
hard to hit the keys," and "doesn't feel the same as the default Crimson level." Measured the root
cause in-engine: note/lane/catcher size (`lw`) = skin bridge-span × guitar draw-width, and BOTH
were shrunk on skins → notes rendered ~40% smaller than default. Two culprits killed:
1. **`skinWF` shrink removed** — skins now draw FULL-BLEED like the default (the build13 0.78/0.92
   shrink was the "guitar is smaller"; it scaled the whole playfield down with it).
2. **Comfort floor in `fretGeom`** — if a skin's painted strings cluster tighter than the default
   gh highway's span, the playable fan is widened (both ends, about their centers, shape preserved)
   up to the default's comfortable span. Note size derives from the floored span → always readable.
   Also dropped skin warp 0.34→0.20 (matches default; far notes no longer bunch).
**Verified in-engine via fxPt lane-position probes (594px canvas):** default Crimson = 203px catcher
span / 51px lane step (reference). Bone Daddy was 112px/28px → **now 203px/51px**. Melody was
124px/31px → **now 209px/52px**. All three levels now identical note size, lane spacing, catcher
spacing, travel + readability. Catch-zone captures confirm big bright well-spread catchers
(`_cap_bd_*`, `_cap_ml_v125_*`); zero console errors. The string-cluster tradeoff: on the tightest
art (bone) the functional lanes now sit slightly wider than the painted gold strings — playability
wins per the explicit directive; the bright functional strings/catchers are what the player reads.
Bump ?v 124→125.

### v124 — the black box dies: guitars become ALPHA CUTOUTS · alignment PROVEN IN-ENGINE  ✅
Round-3 playtest fallout: the v123 5-string re-renders shipped as FULL-FRAME images with their
baked dark backgrounds (the prompt literally asked for "same dark background" — original assets
were transparent cutouts). The engine warped that whole rectangle onto the board → the user's
"odd black box around his guitar", and the frame margins skewed the fit → strings drifting off
the controls. Fix: **Higgsfield background-remover → true alpha cutouts**, trimmed to content
(`_trim_remap.py` remaps every calibration fraction into the cutout frame), SKIN_GEOM updated
(melody 1290×2036 / bone 1354×2048; bone keeps widthF 0.92). **Verification upgraded to
IN-ENGINE proof:** serve.py is now THREADED (the single-thread server head-of-line-blocked the
headless browser into a dead page) + a dev `/__cap` POST sink (canvas dataURL → file → Read; no
more lossy base64 transcription — that bit us once this round). Launch.json now runs serve.py
(was python -m http.server: no sink, no no-cache). Captured live catch-zone proofs both levels
(`_cap_bd_catch2.jpg`, `_cap_ml_catch.jpg`): **all five catcher rings sit ON the five painted
strings at the bridge**, lanes track the strings, zero black box, zero console errors.
Headless gotchas logged: fresh preview viewport is 0×0 (resize first), the skin materialize
cinematic needs ~260 manual ticks before geometry reads true. DEV-STRIP list grows: /__cap sink
+ serve_main.py. No new credit spend (bg-removal jobs were free).

### v123 — playtest round 2: BOTH character guitars go TRUE 5-STRING · the baron comes alive  ✅
**Melody + Bone Daddy re-rendered with exactly five strings** (5-string decree — their art still
painted six; the engine rode 5-of-6 leaving an orphan string). gpt_image_2 i2i at high (Bone's
first take kept 6 — regen with the count led structurally passed: the measurer found 13
exactly-5-peak rows; Melody 9). Calibration: fretboard-only least-squares lines (residuals
≤3.3px over 30 rows) + ruler-read saddle endpoints, proof-overlay verified at nut/mid/bridge
(`_proof_ml5b_*`, `_proof_bd5b_*`). Art ships at 1376×2048; SKIN_GEOM updated with true-5 arrays;
**bone-daddy `widthF` 0.78→0.92** (his guitar played too small — notes were hard to read).
**The skull LIVES:** 172px (was 150), deeper idle float + sway, eye sockets smolder on a slow
loop (never fully asleep), hit = harder jaw chatter (12°) + a cranium counter-nod, milestone =
whole-skull POP + double chatter + gold flare. **Tournament buttons branded** (`.rh-refresh`
was scoped to the rooms header — SEARCH/REROLL/INVITE rendered as naked native buttons; now a
global branded mini-button, emoji stripped). **Browse backdrop video REMOVED** (user verdict —
read as a floating photo at library scale; clean dark room + warm vignette stays). Verified
live: both env launches play (bone theme + skull anims rrm-bob/smolder/jaw/nod/pop firing;
pink theme + paw mech), buttons computed-styled, lib video gone, zero console errors.
Spend ~21cr (2 uploads free, 3 high i2i renders incl. 1 regen + the v122 batch's 9cr already
logged separately → this round's guitars 12cr). Bump ?v 122→123.

### v122 — playtest feedback round: tournaments get a REAL setup · levels system resurrected  ✅
Direct response to the user's first MP-era playtest. **CRITICAL FIX FIRST:** the v121 ftfy repair
had a second bite — its default `uncurl_quotes` flattened curly apostrophes inside JS strings
(`'…level's track…'`) → SyntaxError silently killed the LEVELS inline script: Campaign tile dead,
levels screen empty, env picker reduced to one "Default" chip, `RhythmLevels` unexported, and the
transparent #menu let the ENGINE's backdrop bleed through ("photo hanging in the background").
Repaired: 4 curly-quote lines restored byte-exact from the clean v119 blob; **every inline
`<script>` block now node-checked** (`assets/levels/_fix_quotes.py`); audit: all 6 hub tiles
route, 13 environments, 18 level cards, zero console errors. Opaque base coats on #menu +
#menu-hub + an edge-feather mask on the library video — no hard frames, no bleed-through, ever.
**Tournament setup, rebuilt:** 🔍 **library search picker** (whole catalog, title/artist, tap to
lock — verified live: 27 hits for "love", pick syncs to everyone); host picks the **STAGE** the
bracket is fought on (env chips: Random rolls a fresh level EVERY round host-side so all duelists
match; fixed pick rides every t-round; entrants auto-apply the level theme before launch);
🔗 **COPY INVITE LINK** — `?mpjoin=<id>` deep link auto-opens multiplayer, pings the lobby, joins
the bracket (5s direct-join fallback if the directory meta is slow). **MP screen dressed:** the
flat maroon lobby became the VERSUS ROOM — full-bleed backstage key art (crimson vs gold trophy
podiums, blood-moon stage through the bay; edges vignette to black) under a glass panel, plus a
drip-metal **MULTIPLAYER wordmark** (screen-blended; `// //` header dupe fixed). Assets ~9cr
(2 drafts + 2 high finals), gpt_image_2. Bump ?v 121→122.

### v121 — HUB TILES BECOME GAME ASSETS + UTF-8 corruption repaired  ✅
The six menu-hub tiles now wear **formula-locked key art** (gpt_image_2, drafts → composition
locked via image-to-image → high finals; `assets/hub/*.jpg`, 1024×688 ≈140KB each): Campaign =
the molten tier-climb to the blood moon; Quick Play = a chrome-crimson guitar mid power-chord;
Multiplayer = crimson-vs-gold guitars crossed like dueling blades; Store = the golden pick over
a spark-gem hoard; Leaderboards = the winged chrome trophy; Profile = the horned legend before
the stadium. Art rides a new z-0 `.mh-art` layer under the labels with a bottom scrim (labels
stay crisp); the generic SVG icon hides when art lands — the painting IS the icon; hover zooms
the art slightly. **Self-healing loader**: tiles only dress when the file actually loads.
**INCIDENT + REPAIR:** the v120 `?v` bump (PowerShell `Get-Content`/`Set-Content` on BOM-less
UTF-8 — PS 5.1 misreads as cp1252) double-encoded every non-ASCII glyph in index.html (em-dashes,
·, ✕, ⚡, ▶, 🔥 → mojibake on screen). Repaired with ftfy + targeted reverse-transform for
◆⚡▸▶⚠; byte-audited: zero mojibake markers, legacy lines byte-match the clean v119 blob, full
non-ASCII inventory is sane. **Rule: never rewrite game files with PowerShell — bump `?v` via
python or the Edit tool.** Spend: 27cr exactly as quoted (6 drafts 3 + 6 finals 24, zero regens);
balance 112/412 Ultra. Verified headless: 6/6 tiles `has-art`, icons hidden, labels visible,
clean glyph rendering, zero console errors. Bump ?v 120→121.

### v120 — TOURNAMENT BRACKETS (5–10 players) + the lobby actually comes ALIVE  ✅
The headline multiplayer order: **single-elimination tournaments**. New 🏆 action in the MP lobby →
named bracket, up to 10 seats (starts at 3+, copy steers 5–10). ONE `rr-tour-<id>` channel with
self-receiving broadcasts (host + entrants run identical handlers): host rolls a random ready track
(🎲 reroll + difficulty seg), START shuffles seeds and broadcasts round 1 with a synced `atMs` —
**everyone alive plays the SAME track simultaneously**, the bracket decides who you're scored
against. Live duel board (ticks ~3/s), rival side-panel in-game, byes auto-advance, winners roll
into the next round on a fresh random track (7s intermission), final round labeled THE FINAL,
champion gets the gold 👑 banner + full bracket-strip recap. Forfeits: leavers stub `score:-1`
(instant on graceful leave, 45s lag window after a pair's first final otherwise). Eliminated
players stay as spectators of the board. Tournament cards advertise in Browse (BRACKET/LIVE/FULL).
**Foundation fix (critical): native Supabase presence NEVER syncs on this project** (track() acks
"ok", zero sync events — verified live) — so the lobby roster, rooms, and matches were silently
dead. Replaced ALL presence with a **soft-presence layer over broadcast** (hb every 10s + instant
hello-back + bye on leave + 75s expiry — survives background-tab timer clamping). The roster now
shows real players ("1 online" verified live). Guards: round-token on onSongEnd (stale
registrations can't bank bogus finals), first-report-wins finals, Enter-key primary actions
(tour start / ready / rematch). E2E verified against LIVE Supabase with 4 synthetic protocol
clients: full 5-seat bracket (R1 2 duels + bye → R2 → THE FINAL → champion BOT-ACE), real engine
launch mid-bracket (75s of actual play), then a 4-seat forfeit cup (walkout → -1 → survivor
advances → champion). Zero console errors. Bump ?v 119→120.

### v119 — MELODY'S ROOM lives · both levels finished + e2e verified  ✅
Completes the two-level order ("get down all the way up to Melody's level"). **Melody's world**:
4K kawaii-punk collector's room (gpt_image_2, image-to-image from the approved draft — neon heart
sign, plushie wall, city window), **8s 1080p ambient loop** (start+end pinned, seam 5.5/px PASS)
+ **melody-intense.mp4** — the cat-chaos GAG clip (seam 2.6/px PASS, mid-frame verified: cat
scrambling through flying plushies). The gag is the REWARD: `RhythmLevelFx.onCombo` milestone
swaps the backdrop to the intense clip then eases back to the calm loop ~5.2s later (verified
swap + revert headless). **Fate-pairs for BOTH levels** (440w keyed cards): Bone Daddy tombstone
(miss/death meter) + golden chalice (hit/world meter); Melody torn plush (miss) + heart jar
(hit). Melody's cards arrived on GREEN — `_key_card.py` now auto-detects the key color from
corners (magenta/green/blue) + despills. **Paw fret-rows**: in the pink theme the fret lines
render as alternating cat-paw prints marching down the highway (`_drawPaw`, depth-scaled).
**HUD character watermarks**: a faint theme motif (bone skull / pink paw data-SVG) inside the
HUD panel per `data-rrtheme`. E2E verified headless BOTH levels: launch → theme → video
true-cover+playing → cards on meters → watermark → jaw-chatter / paw-mech → intense swap+revert
→ zero console errors. Spend: Melody pack ~166cr (the two 1080p clips are 72cr each; round-1
nsfw/failed jobs confirmed NOT charged) on top of Bone Daddy's ~96cr — two-level arc ~273cr off
the 412 start, balance now 139 (Ultra). Bump ?v 118→119.

### v118 — BONE DADDY'S GRAVEYARD lives  ✅
The first level built under the full pipeline (formula → drafts → user-approved comp → 4K final →
pinned-loop video → rig): **4K cathedral world** (gpt_image_2, image-to-image from the approved
draft — blood moon over the rose window, staircase aligned with the guitar neck, fog-clean lower
third), **8s 1080p ambient loop** (seedance, start+end frames PINNED to the still — seam QA
4.8/px PASS; mid-frame verified no morph), **two-piece SKULL-CROWN rig** (gpt_image_2 keyed on
magenta, split at the teeth gap: cranium + mandible full-frame layers; jaw CHATTERS on every hit,
double-chatter + gold eye-socket flare on milestones, slow idle bob; self-healing). Level wired:
bgVideo + 4K-derived bgArt fallback, mechanic 'skull'. E2E verified: launch → bone theme →
cinematic completes → video true-cover + plays → rig classes fire on hit/milestone → zero console
errors. New tools: assets/levels/_make_loop.py (loop QA/crossfade/stitch), _skull_rig.py.
Spend: ~96cr (drafts 4 + 4K 12 + loop 72 + skull 1 + dead nano drafts 3 — nano now banned).
Remaining for his level: fate-pair (tombstone/chalice) + themed HUD dressing. Bump ?v 117→118.

### v117 — LIGHT HAS FALLOFF, NOT BOUNDARIES · OD swirl dead · the REAL wordmark  ✅
The user marked the v116 clip's SEAMS along the neck + circled the center swirl again. Root
lessons internalized (memory updated):
- **Soft-falloff energy layer:** a clip is a hard boundary — ALL board energy (combo heat, scan
  sweep, OD wash) now paints into one small OFFSCREEN, feathered lw·1.35 along both trapezoid
  edges + melted at both ends (destination-out is safe there), then composited additively.
  Alphas toned down (the column outshouted the world). PROBE: max 3px-step across the old
  boundary with OD blazing = **1** (v116's clip showed a wall; smooth ramp now). The probe chase
  also identified the full-canvas miss-flash as a measurement confound (uniform, edgeless — by
  design) → edge defects are verified by STEP/derivative, not absolute alpha.
- **The circled "flame that doesn't fit" = the overdrive-aura LOOP** (a fireball spinning at the
  catcher-row center for the entire OD — also the earlier default-level "spinning fire" sighting).
  Spawn REMOVED; star power reads through activation comets, burning strings/wash, catcher fire,
  the HUD flame.
- **Title wordmark, properly this time:** `npx skills add higgsfield-ai/skills` installed (the
  playbook: **gpt_image_2 is the default for typography/design**; nano-banana is for characters —
  my first roll used the wrong model). Regenerated with gpt_image_2, single-line lockup chosen
  (G2 stacked variant kept on disk for the title screen), flood-fill keyed to transparency,
  EYEBALL-VERIFIED (spelling, moon, waveform, clean cutout) + numeric brand audit. Live in the
  hub slot. Zero console errors. Bump ?v 116→117.

### v116 — energy gets the BOARD's shape · guitar-anchored fade · title wordmark slot  ✅
The user's marked Skully screenshot + two design notes, all shipped + probe-verified:
- **The "red rectangle glow with visible edges":** EVERY additive board-energy layer (combo heat
  bands/wash, the milestone/OD SCAN sweep, the OD-active wash) painted full-width rects — their
  straight bounds landed mid-video. All three now clip to the shared **NECK TRAPEZOID**
  (`_neckClipPath` — warped outer lanes, nut→bridge + a lane skirt). PROBE: outside-trapezoid
  max alpha during full OD dropped **179 → 20** (noise floor). The chase also caught that the
  scan + OD wash — not just the combo layer — were rectangle offenders.
- **"Top of the guitar should fade toward the background":** the headstock fade was
  SCREEN-anchored (top 22% of the viewport) — on tall windows the shrunk skin starts ~480px down
  and floated unfaded. Now **GUITAR-anchored** (art top → just past the nut). PROBE at the
  user's window shape: alpha ≤46 at the guitar top vs 255 below the nut.
- **The floating multiplier flame ring (default level):** multiplier-up/gradeup-flare centered
  flares REMOVED — a tier climb is now a small **ripple across the catcher row** from the hit
  lane (verified: string-ripple ×row at the x3 climb) + the comet up that string.
- **Level fog** → bottom-center radial (the full-width rect ended in straight seams at the canvas
  bounds); **side HUD darkening bands** lightened + narrowed (the gutters read as world, not dead
  strips); **TITLE WORDMARK slot** wired in the hub (self-healing `assets/title-wordmark.png`,
  text title stays until the art lands + stays for a11y after) — order in ASSET_ORDERS_GUITARS.md
  §3 (crimson blood-moon / chaos energy / anime / music-driven). Zero console errors.
  Bump ?v 115→116.

### v115 — FX = pure responses (edge feather, no mid-board) · ENTRANCE polish  ✅
The user's playtest sign-off pass ("they play great, they look good") + final FX/polish notes:
- **The combo "rectangle cropped on both sides" (Skully):** sheet content reaching a frame cell's
  border survives the luminance key as a hard crop. SYSTEMIC fix in the keyer: every cell's
  borders get a ~7% smoothstep ALPHA FEATHER at load — no sheet can ever show frame bounds again
  (verified: border alpha 0 on a keyed cell, interior intact). All 31 sheets, all layers.
- **The "spinning fire in the center of the guitar":** the tier-3 mid-board explosion + century
  mid-board shockwave — effects with no cause at that spot — are GONE. FX doctrine locked:
  every effect is a RESPONSE at the interaction site — the catcher row (hits, ripples, fire),
  the strings (surges, comets), the sky (century fireworks; now with a row ECHO ripple).
- **ENTRANCE polish (user order):** the materialize cinematic + zoom-settle now runs on EVERY
  level (the default included — buildT 0→1 verified) and the catcher row IGNITES L→R the moment
  the print completes (`_igniteCatchers`, verified pulses at all five buttons). Hub tiles ARRIVE
  with a staggered rise (50ms steps, fill-backwards so hover still wins); the title foreground
  rises with the same language. All reduce-motion-gated. Wave audit post-change: combo-burst
  row+echo, lane-pulse surges, sky fireworks, **zero explosion/shockwave instances**. Zero
  console errors. Bump ?v 114→115.

### v114 — the REAL "weird line" fix · millimeter alignment proof · EYES-ON screenshots  ✅
The user challenged readiness — rightly. Two deliverables:
- **The line "towards the top of the guitar":** the v111 hairline removal targeted the wrong
  artifact. The real offenders: the static **spawn-band glow** (hardcoded-crimson full-width
  stripe at ch 0.16–0.34 over every level's video — REMOVED; the headstock fade + notes carry
  the cue) and the **moon-world atmosphere** (god-rays/horizon-haze-band/embers, all hardcoded
  crimson) — now gated to the DEFAULT world only; themed levels show their video PURE.
- **Alignment proof at pixel zoom** (`_overlay_proof.py` → lane chords composited on the art,
  crops eyeballed): both guitars dead-on at nut/mid/bridge. **In-game screenshots** (downscaled
  canvas+video composite via toDataURL — headless `preview_screenshot` times out; this works):
  default = Crimson Chaos full-bleed in the moon world, no top band; Skully = her world
  full-bleed, guitar centered + crisp, notes falling FROM Skully down the neck, zero floaters.
  Art nit for the asset backlog: violet-gothic-5's headstock paints SIX tuner pegs (decorative;
  the playable neck is 5-string clean; headstock sits in the top fade in-game). Zero console
  errors. Bump ?v 113→114.

### v113 — THE 5-STRING GUITARS LAND: Crimson Chaos is the default · Skully re-skinned  ✅
Asset commit `0698670` delivered both v111 orders (1080×1920, exactly 5 strings, guitar5 framing).
- **Calibration kit built** (`assets/guitars/_measure_strings.py` + `_calibrate.py` + probes):
  per-row contrast peaks → exactly-5-peak clean rows (57/64 rows, residuals ≤7.3px) → per-string
  least-squares lines → **local-peak SNAP at the eval rows** (the leftmost string curves outward
  toward the body; linear extrapolation drifted up to 14px — snapping nails it, verified 253–255
  luminance at every snapped point).
- **"CRIMSON CHAOS" (RYO) is the DEFAULT guitar** — gh profile img + measured fractions swapped
  (nut span 0.0908 ≈ guitar5's 0.0905; bridge gaps even to ±0.001; guitar5 fractions in git for
  revert). **Skully runs `violet-gothic-5.png`** (level + store).
- **EXACT-STRINGS RULE:** when art paints exactly LANE_COUNT strings, lanes ride the MEASURED
  painted strings (the guitar5 ideal — engine strings land ON the art's); the build13 even fan
  survives only for legacy 6-string art (count mismatch).
**Self-playtest:** default = Crimson Chaos draws (neck 3593/3600 opaque px), lanes at the new
geometry (lw 37), 15/15 PERFECT; Skully = `exactNotFanned:true` (measured arrays live, not the
fan), 0.78 shrink retained, materialize completes, string columns hot, 13/13 pressed PERFECT;
zero console errors. Bump ?v 112→113.

### v112 — RYO INTRO HAS ITS VOICE (asset delivered + wired)  ✅
The asset agent delivered the intro re-export WITH audio (`assets/ryo/` drop, installed as
`ryo-intro.mp4`; silent original kept as `ryo-intro-noaudio.bak.mp4`). **Binary-verified:**
'soun' handler + 'mp4a' atoms present (the old file had neither). The proven WebAudio path stays
(video stays muted — Chrome unmute-after-gesture was unreliable): the loader now fetches +
**decodes the mp4's OWN audio track** (verified in-browser: stereo / 48kHz / 6.08s decode OK),
gesture-started + synced to the video clock, gain 0.9 fast fade-in; **lunar-waves is demoted to
decode-failure fallback**. Flow verified headless: start → Enter → intro active (new file,
duration 6.08) → skip → menu-hub; zero console errors. Bump ?v 111→112.

### v111 — the weird line over the video · 5-STRING ASSET DECREE · guitar re-render orders  ✅
- **"A weird line over the video" (Skully):** the `.game-center::before/::after` 1px chrome
  hairlines — invisible in the dark-column era, a stray artifact over the v110 full-bleed video.
  REMOVED (verified: pseudo-element content none, zero errors).
- **STANDING ASSET RULE (user decree): every guitar asset paints EXACTLY 5 STRINGS** — Skully's
  art paints 6 ("just kills it") and will be RECREATED. Default Quick Play is getting a flagship
  **"Crimson Chaos" RYO-style guitar**. Both ordered in **`ASSET_ORDERS_GUITARS.md`** (exact
  files: `assets/guitars/violet-gothic-5.png`, `assets/guitars/crimson-chaos-ryo.png`; guitar5
  framing spec ~0.56 aspect / neck-dominant / body sliver; engine re-measures on delivery).
  Bump ?v 110→111.

### v110 — backdrop TRUE COVER · seam feather on the CONTENT box · causeless floaters killed  ✅
The user rejected v109's backdrop ("still too small / cropped at the sides; Skully cropped at the
top; random floating particle effects I don't understand"). Three fixes, verified live on frac-01:
- **Bleed cap 1.18 → 2.4** — on the user's tall window the moon loop (portrait, ratio ~1.94) AND
  Skully's 16:9 (~1.99) now go **TRUE COVER**: full-bleed, zero bands, mask removed. Only the
  pathological portrait-on-widescreen case stays capped.
- **v109's real mask bug:** the feather spanned the ELEMENT box — the video's interior letterbox
  seam was never feathered (the user's eye caught what the computed-style probe missed). The mask
  is now painted in px ALIGNED TO THE DRAWN CONTENT BOX (verified: stops 505/541/825/861 = the
  moon column ±35px feather at 1366×768). Fill = near-seamless continuation (blur 14, brightness .96).
- **MICROTASK LIVELOCK found + fixed:** fitBg's style writes re-triggered the src/style
  MutationObserver → sync → fitBg forever — froze the renderer with NO console error (the
  webkit/standard mask-composite aliases never reach a serialization fixpoint). Observer now
  refits ONLY on src mutations + every style write is diff-guarded (`setIf`). Plus the metadata
  race (cached video beats listener attach): refit at init when readyState≥1 + on 'playing'.
- **The "random floating particles" = the THEME AURA** (skull-flame-violet looping causelessly
  behind the neck — a black box pre-v108; the luminance key exposed it) **+ level-ambient drifting
  embers — both REMOVED** (static fog band stays; all gameplay-anchored FX untouched).
Verified: frac-01 live with theme violet and ZERO floating loops after 25 rendered frames;
skully-loop true cover no mask; materialize completes; zero console errors. Bump ?v 109→110.

### v109 — backdrop SMART-FIT · FX become BOARD particles · skins shrink w/ engine-string lanes  ✅
The user's v108 playtest, three verdicts, all shipped + self-playtested end-to-end:
- **Backdrop composition ("contain = cropped box, cover = blown up"):** the sharp layer now scales
  BETWEEN contain and cover — JS sets `--rr-bgfit` = min(cover/contain, **1.18**) per video×viewport
  (moon-loop is 976×2116 PORTRAIT — the root of the "box") — its edges **FEATHER** (6% mask) into a
  **brighter** blurred fill (brightness .72→.86, blur 30) so sharp melts into blur with no seam;
  content biased UP (`object-position 50% 42%` — the guitar owns the lower third; also fixes Skully's
  "video too lowered"). `rrCineZoom` keyframes multiply the fit var (no snap). **Depth:** the guitar
  grounds via a real **CONTACT SHADOW** (its own blurred silhouette, cached, sliced with the same warp
  + materialize gates) and the fill layer gets a 38s Ken-Burns **drift** — three planes: drifting blur
  → locked video → reactive guitar. Skully's 1280×720 loop on 16:9 ≈ true full-bleed (fit 1.0005).
- **FX = particles ON THE BOARD ("effects float at the bottom"):** GH rule applied — anchor to
  gameplay geometry, energy flows UP the strings. Streak milestones → `emitComboWave`: catcher-row
  RIPPLE spreading from the hit lane (y lifted lw·0.4 off the buttons) + `lane-pulse` SURGE traveling
  up the lanes along the exact warped/1-z note path (`_lanePtPx`, scale shrinks with depth) + tier≥3
  mid-board detonation + CENTURY = 3 gold fireworks in the BACKDROP SKY above the nut + mid-board
  shockwave. Multiplier-up: flare lifts off the button + a comet surges up that string. **x3+ sets the
  catcher buttons ON FIRE** (the unused `fire-loop` sheet rides each button via handles, rages at max;
  stops on tier drop/reset). OD activation: bursts lifted + comets race up all five strings.
  Spawns are generation-guarded (`_fxGen`) so queued waves die with the run.
- **Custom guitars (user decree): SHRINK + OUR STRINGS.** A skin draws at `widthF` **0.78** of the
  panel (crisper — violet-gothic ≈ native px at 1366×768 — and the level world shows at the sides);
  lanes are an **EVEN FAN across the art's neck band** (measured outer strings × 1.16 spread) — the
  ENGINE's neon strings (alpha floor .50, +0.8px, dark seat under-stroke) are now the visible play
  lanes on skin art; painted-string matching is retired. Default guitar byte-identical (skinWF=0).
- New dev hooks (strip at freeze): `__rrDebug.tick` (manual frame — headless rAF is FULLY frozen, 0
  ticks), `fxWave`, `fxPt`, `fx().pts`, chord-aware `nextNote` (`lanes[]`, `holdDur`, opens included).
**Self-playtest (real input, audio-clock busy-wait):** demo run 26/26 PERFECT zero miss; milestone
wave verified at combo 25 live + by position audit (5 ripple bursts at the catcher xs, 20 surge
pulses climbing 429→110px converging with the warp, fireworks y 15–50 ABOVE the nut at 75, shockwave
mid-board); fire-loop ×5 riding all catchers at x3 (combo 13 + OD), scale lw·0.92; OD comets;
Skully: even fan (bridge step .0640 about her measured center .4661), gw 394.7 = .78×506 with
transparent gutters (video visible), materialize print Δ208.7/px, strings read over her art
(center-line 228–252 vs 155–184 sides at idle); unequip restores gh defaults byte-identical;
**zero console errors across the whole session**. Catalog fetch flaked once mid-test (supabase,
transient — warn + mock fallback worked as designed; unrelated). Bump ?v 108→109.

### v107–v108 — THE GUITAR IS THE GUITAR · black-box FX root cause · backdrop detail · intro-audio truth  ✅
User playtest + a 31-agent adversarial review workflow. **Guitar:** the projection experiment is gone —
a custom guitar is a PROFILE RESKIN (whole art, cover-fit like the default, lanes on ITS measured
strings, materialize in the smooth slicer w/ body fade, crimson frontier). **FX black-box root cause:**
additive RGB-on-black sheets over TRANSPARENT canvases paint black rectangles; all sheets are now
luminance-keyed at load (`RhythmFxKey`, cached/shared ×3 layers) → real particles on every surface.
**Backdrop:** #bg-video contain (full frame, native sharpness) over a blurred cover fill; side bands
lightened; ?novideo/perf-bg own both layers. **Intro audio root cause: ryo-intro.mp4 HAS NO AUDIO
TRACK** (binary-verified) — asset re-export needed; lunar-waves bed stopgap (gesture-side AudioContext).
**Asset debt flagged:** crimson-chrome + gold-relic too tall for natural framing (re-render needed).
Verified: Skully whole-guitar + lanes-on-strings + materialize + exact-press PERFECT in one run; UI
burst = 0 opaque-black px; novideo hides+pauses both videos; zero console errors. ?v→108.

### v105–v106 — gameplay sign-off + Skully anatomy + FX as real impacts  ✅
**v105:** precision input probes — exact-time press → PERFECT on BOTH guitars (−2ms default, −1ms
Skully under the projection); early press consumes nothing (GH semantics). **v106 (user playtest):**
(1) Skully guitar matches the DEFAULT's anatomy — the projection draws only a tapering NECK BAND
(1.8× lane span, measured) + the body as a playfield-width strip at PROFILE scale (was: full flat art
≈1.5× playfield = "blown up"). (2) FX = impacts, not clips: one-shots spawn AT their measured PEAK
frame (shockwave peaked at 12/16 — 75% wind-up!) + cut before the smoke tail; combo ESCALATION
(25/50/75/centuries), multiplier tiers (x4 adds gradeup-flare), OD-end dissipate; tighter scales.
First draw after a hit verified instantly bright. Judge re-verified post-change. ?v→106.

### v104 — square-marbles fix (gem tint preserves sprite alpha)  ✅
Canvas `multiply` composites source-over → the opaque tint fill made the whole sprite canvas opaque =
colored SQUARES on every gem-tinted level (since build8). Fixed with a `destination-in` alpha restore;
`__rrDebug.gemTint` regression probe (corners transparent / center opaque — Skully verified live).
**Asset inventory (the "100 videos" question): the repo holds 36 mp4s total** — 31 FX clips (ALL 31
tiled + wired), 3 level loops, moon loop, ryo-intro. No new asset-agent commits in 3 days; any larger
clip batch hasn't been delivered into the repo yet (drop path: `assets/fx/_src/` → tile via
`build_sheet.py` → union `manifest.json`). Bump ?v 103→104.

### v103 — projection UNIT FIX (the guitar exists) + one-time lane migration  ✅
The user's screenshots caught what headless probes missed: (1) the projection's destination width was
`sc*iw` (≈676,000px) — Chrome silently refused the draw → **Skully had no guitar at all**; fixed in
slice + body (`dw = sc`; body `dh = rows*(sc/iw)`). (2) Their browser stored pre-decree `standard` →
the huge flat 6-string default; one-time migration to gh (marker `rr_lane_migrated5`; a deliberate
post-decree standard choice sticks). **Verification upgraded** to region-RGB-distance probes: print-
sweep diff 74/px (wood prints in), skin-vs-default art diff 66–120/px (violet-gothic truly renders),
re-applied skin reproduces pixels (diff 3). Zero console errors. Bump ?v 102→103.

### v102 — LEVEL-START CINEMATIC + beta-sweep fix  ✅
On custom-guitar levels the backdrop opens zoomed-in and settles while the guitar **materializes** —
the projection renderer prints the neck horizon→bridge behind an accent energy frontier; body fades in
last (`_skinBuildT`, reduceMotion-safe, restart replays). Beta-sweep critical fix: the hub-Enter leak
(engine menu shortcut now requires the LIBRARY to be the active screen). Full sweep verified with zero
console errors (boot→intro→hub→Skully+cinematic→library/Random→overlays→mobile). Bump ?v 101→102.

### v101 — SKIN HIGHWAY PROJECTION + UI FX layer + intro SOUND  ✅
**Projection (the user's Skully playtest fix):** flat custom-guitar art is now texture-mapped onto the
SAME 1/z highway plane the notes ride (slices uniform in screen y, source row at P⁻¹(u), x-fitted so
the painted outer strings sit on the outer lanes at every depth). The neck TILTS DOWN into the level,
sized to the lane field — the backdrop video is visible around it (canvas margins alpha≈2), and the
full runway is back so note pacing matches default. gh+skin only; default byte-identical. Bomb-warn
telegraph loop rides wall-bomb rows. **UI FX:** `RhythmUiFx` menu-layer canvas — title ember ambience,
ENTER "ignition" (shockwave+explosion + the explosion clip's BASS via pooled `<audio>` over
`assets/fx/_src/*.mp4`), per-tile button bursts (delegated), respecting mute/SFX/reduce-motion.
**Intro now plays WITH SOUND** (unmuted post-gesture, vol .9, muted-retry rather than skip). Verified
on a fresh log buffer: zero console errors. Bump ?v 100→101.

### v100 — TITLE SCREEN (RYO key art) + SKULLY playability + e2e fixes  ✅
**Title:** full-bleed cinematic RYO key art (Ken-Burns drift, warm grade, fire FX over it), lower-third
lockup (Nosifer slam + breathe, gold hairline, PRESS ENTER · TAP, console meta bar), ENTER/SPACE starts;
mascot.png removed; the hub's pasted RYO rect removed (RYO owns the title). **Skully:** the DEATH/WORLD
fate cards now HUG THE GUITAR ARM (new public `RhythmGame.getLaneFrame()`; symmetric 16px gaps, sized to
the visible neck, resize-tracking); themed NECK SCRIM behind the playfield (notes readable over the
video); tinted gems re-lit (specular core survives the violet bake); bombs adopt the level accent.
**Critical e2e finds:** Enter on the title also fired the engine's menu play-shortcut (launched a song
under the intro) — guarded; the first-run HOW-TO popped on a boot timer UNDER the title/intro — now
waits for them. Verified end-to-end muted: title→intro→hub→Skully (cards flank arm, fate meters fill
from real misses)→resize→exit→default Arena regression; zero console errors. Bump ?v 99→100.

### v99 — 5-LANE DECREE: gh default + invariant-lane skin fit + pixel-measured skins  ✅
The game is **5-lane** (user decision 2026-06-09). (1) `gh` is the boot default (legacy 6-string =
dormant `?gh=0`/Settings toggle). (2) **Invariant-lane skin fit:** lanes never move — catcher row,
span and center come from the calibrated profile; a skin's art is fitted so its measured strings land
ON those lanes (tall art crops; lw pinned to the outer span → uniform note/catcher sizes on every
guitar). Kills the misalignment class (skins used to flip to 6-string contain-fit; crimson-chrome's
lanes were ~4× narrower). (3) **SKIN_GEOM v2:** per-string pixel-measured fractions for all 6 skins
via string-tracking (validated vs guitar5's hand calibration ≤0.003); bone-daddy + melody-pink are
6-string art (centered-5 subset). Dev: `?align=1` lane-guide overlay, `__rrDebug.lanesPx/rect`.
Verified in REAL play (Skully): skin on/off at same canvas → outer lanes Δ0.00px, catcher row Δ0.00px,
interior 1.5px (honest painted strings). Bump ?v 98→99.

### v98 — FX union COMPLETE (all 31 effects wired)  ✅
multiplier-up (tier climb) · note-comet (hits streak during OD) · string-ripple (chord bar, centered) ·
lane-pulse (sustain banked) · chrome-pulse-ring (every catcher pulses while OD is READY — the
press-Space cue) · charge-loop (rides a sustaining hold) · ember-rise (ambient aura for ember/crimson
levels) · note-sparkle-pink (2nd layer on Melody perfects) · shard-burst (wipeout glass-shatter) ·
**results celebration** (own FxPlayer + `#results-fx` canvas: confetti-pop/firework-gold staggered
bursts, gradeup-flare on the GRADE UP/NEW BEST badge; none on fail/reduceMotion, fewer on fxLite).
All headless-verified (mappings, ready-rings stop on activate, charge-loop on a real hold, celebration
paints). Bump ?v 97→98.

### v97 — FX deepening + RYO startup intro  ✅
Wire more of the asset agent's 31-effect union + make RYO the startup intro. All additive/guarded.
- **Theme aura loops:** a subtle low-alpha ambient loop drifts behind the upper neck while a themed
  level plays — Skully `skull-flame-violet`, Bone Daddy `ember-skull-loop` (localized, NOT a wash —
  respects the "no muddy violet wash" note). `THEME_AURA`, managed in render; stops on clear/reset.
- **Melody `paw-poof`** as the pink hit FX (cat-paw bat lands with a poof); perfect stays heart-pop-pink.
- **`overdrive-aura`** sustained loop over the board for the whole star-power window (+ the existing
  per-lane shockwave/explosion ripple); stopped on expire/reset.
- **`star-pickup`** pop on hitting a surge (star) note. `_fxRide` gains an alpha arg; `__rrDebug.fx().names`.
- **RYO intro → every startup** (was first-run-once): plays each app load, skippable + reduce-motion-safe,
  in-session `done` guards back-to-menu replay, `?ryo=off` disables. Bump ?v 96→97.
Verified headless: themed hits → paw-poof/soul-burst-violet/bone-shatter; overdrive → shockwave+explosion;
ember-skull-loop aura live in Bone Daddy play; overdrive-aura on activate; intro fires every load; no errors.