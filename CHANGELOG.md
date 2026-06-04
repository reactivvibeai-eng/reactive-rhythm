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