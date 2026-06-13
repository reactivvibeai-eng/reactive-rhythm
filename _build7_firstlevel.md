# Build Package 7 — FIRST LEVEL DONE RIGHT (Skully "The World" / frac-01 as the template)

> **Concern:** Make `frac-01` "The World" (Skullyrae, trackId `53613a30-84c6-417e-89dd-d2aa06549141`)
> the **reference** level — a complete, distinct, rich level whose pattern other levels copy:
> (1) a **custom per-level guitar** (the violet/gothic skin), (2) **per-level HUD identity** (the
> build5 themed restyle + additive accent glow + ambient FX, RE-ANCHORED to the CURRENT v84 code),
> (3) confirmation that the violet theme + `skully-loop.mp4` backdrop + DEATH/THE WORLD reactive
> fill-cards are correct, and (4) a documented **LEVEL RECIPE** schema.
> Standard 6-string + gh 5-string gameplay/scoring/timing stay **BYTE-IDENTICAL** — presentation only.

**Verified against the live files on `visual-overhaul` (game.js/index.html at `?v=84`).** Every anchor
below was copied from the real current file. Apply by find-anchor; zero guesswork.

---

## 0) READ-FIRST: collision map with the other build packages (IMPORTANT)

The guitar-skin engine layer + the frac-01 `guitarSkin` field + their apply/restore wiring are **shared**
with `_build6_guitarstore.md` (it needs the same hooks to equip store skins). To prevent double-definition:

- **STEPS 1.A–1.E below ARE the canonical guitar-skin layer** — identical code, identical anchors to
  `_build6_guitarstore.md` §3.1–3.4. Whichever package is integrated **first** lands them; the other
  package **skips** these steps (a quick grep tells you — see each step's GUARD note).
- **STEPS 2.* (HUD identity / accent glow / ambient) are UNIQUE to build7** (re-anchored build5). No other
  package touches them. The old build5 STEP-A anchor was removed by the full-bleed work; build5 STEP-E
  anchors changed too — this package supersedes `_build5_levelidentity.md` with corrected anchors.
- `?v` bump (STEP 4): bump **game.js + jukebox.js + catalog.js + jukebox.css** `?v=84 → ?v=85`. If build6
  already bumped to 85, leave it; this package's edits ride the same bump (do NOT bump twice in one pass).

`node --check game.js` after every game.js edit.

---

## 1) CUSTOM GUITAR — the per-level skin swap (image-only; geometry-safe)

**Asset (verified on disk):** `assets/guitars/violet-gothic.png` (743 KB; one of 4 geometry-matched
recolors: `crimson-chrome.png`, `ember-bone.png`, `gold-relic.png`, `violet-gothic.png`). These are
recolors of `assets/guitar.png`, so `ART.nutXF/bridgeXF` string geometry stays aligned — notes ride the
geometry, not the image. A 404 self-heals to the lane-profile default (`guitarImg`/`guitarImg5`).

> **GUARD for the whole of STEP 1:** if `_build6_guitarstore.md` was already integrated, these hooks
> already exist. Check first:
> `rg -n "function setGuitarSkin|applyEquippedSkin" game.js`
> - **0 hits →** apply STEP 1.A–1.E (build7 lands the layer).
> - **≥1 hit →** SKIP STEP 1.A–1.E entirely; the layer is present. Then verify STEP 1.D (frac-01 field)
>   and STEP 1.E (apply/restore) are also present (`rg -n "guitarSkin" index.html`); if build6 added
>   them, you are done with STEP 1.

### 1.A — game.js: add the skin layer

**FILE:** `game.js`
**ANCHOR (unique, exists once — ~line 404):**
```js
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}
```
**ACTION:** INSERT the following block **immediately AFTER** that line:
```js
  // ---- GUITAR SKIN LAYER (image-only swap) -------------------------------------
  // Swaps activeGuitarImg to a re-skinned guitar PNG WITHOUT touching geometry
  // (LANE_COUNT / ART.nutXF / ART.bridgeXF / aspect / fit all stay from the lane
  // profile), so notes & strings stay aligned. The skin art MUST share the active
  // profile's silhouette + string positions (the assets/guitars/*.png are recolors
  // of assets/guitar.png). A 404 self-heals back to the lane-profile default image.
  // Equipped skin persists in rr_skin; a per-level guitarSkin is a temporary
  // override that does NOT touch rr_skin. (build7 / shared with build6 store)
  const SKIN_STORE = 'rr_skin';
  let equippedSkinSrc = null;       // persisted (rr_skin) — the global equip
  let _levelSkinActive = false;     // true while a per-level override is showing
  function _profileDefaultImg() { const p = LANE_PROFILES[laneProfile]; return (p && p.img) || guitarImg; }
  function _applySkinImg(src) {
    if (!src) { activeGuitarImg = _profileDefaultImg(); return; }
    const im = new Image(); im._ready = false;
    im.onload = () => { im._ready = true; };
    im.onerror = () => { /* self-heal: missing skin → profile default */ if (activeGuitarImg === im) activeGuitarImg = _profileDefaultImg(); };
    im.src = src;
    activeGuitarImg = im;            // drawCathedralBg already guards on _ready, so a not-yet-loaded image just skips a frame
  }
  // Per-level override (temporary). Pass falsy to drop the override → back to equipped/default.
  function setGuitarSkin(src) {
    if (src) { _levelSkinActive = true; _applySkinImg(src); }
    else { _levelSkinActive = false; _applySkinImg(equippedSkinSrc); }
  }
  // Equip a skin globally (persisted). Pass falsy to clear the equip (back to default).
  function equipGuitarSkin(src) {
    equippedSkinSrc = src || null;
    try { if (equippedSkinSrc) localStorage.setItem(SKIN_STORE, equippedSkinSrc); else localStorage.removeItem(SKIN_STORE); } catch (e) {}
    if (!_levelSkinActive) _applySkinImg(equippedSkinSrc);   // don't stomp an active per-level skin
  }
  // Re-assert the equipped skin (used on game start + after a level clears its override).
  function applyEquippedSkin() {
    _levelSkinActive = false;
    try { equippedSkinSrc = localStorage.getItem(SKIN_STORE) || null; } catch (e) { equippedSkinSrc = null; }
    _applySkinImg(equippedSkinSrc);
  }
  // boot the equipped skin (after the lane profile booted just below; safe to read storage now)
  try { equippedSkinSrc = localStorage.getItem(SKIN_STORE) || null; } catch (e) { equippedSkinSrc = null; }
  window.RhythmGame = window.RhythmGame || {};
  window.RhythmGame.setGuitarSkin = setGuitarSkin;       // per-level temporary override
  window.RhythmGame.equipGuitarSkin = equipGuitarSkin;   // global persisted equip
  window.RhythmGame.applyEquippedSkin = applyEquippedSkin;
  window.RhythmGame.getEquippedSkin = () => equippedSkinSrc;
```

**Why this is safe:** `_applySkinImg` only writes `activeGuitarImg`. The two draw sites already guard
`if (activeGuitarImg._ready)` (game.js ~line 2713) and `if (!activeGuitarImg || !activeGuitarImg._ready)
return;` (`drawComboEnergy`, ~line 2628), so a not-yet-loaded or failed image never breaks rendering.

### 1.B — game.js: keep the equip after a 6↔5-string profile swap

**FILE:** `game.js`
**ANCHOR (unique, the close of `applyLaneProfile` + the export line right after — ~lines 402–404):**
```js
    try { if (typeof layoutTapZones === 'function') layoutTapZones(); } catch (e) {}
  }
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}
```
**ACTION:** REPLACE with (adds ONE re-assert line inside `applyLaneProfile`, before its `}`):
```js
    try { if (typeof layoutTapZones === 'function') layoutTapZones(); } catch (e) {}
    // build7: keep the active skin after a profile swap: per-level override wins, else equipped, else this profile's default (already set above)
    try { if (typeof _applySkinImg === 'function') { if (_levelSkinActive) {} else if (equippedSkinSrc) _applySkinImg(equippedSkinSrc); } } catch (e) {}
  }
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}
```
> `_applySkinImg`/`equippedSkinSrc`/`_levelSkinActive` are declared in 1.A (which inserts AFTER this export
> line in source order), but `applyLaneProfile` only RUNS later (boot calls it via `bootLaneProfile` at
> ~line 988, after the whole IIFE body is defined). The `typeof` guard + hoisted `let` make this TDZ-safe.

### 1.C — game.js: re-assert the equipped skin on every game start

**FILE:** `game.js`
**ANCHOR (unique, the start of `play` — ~lines 905–907):**
```js
  async function play(prov, opts) {
    provider = prov;
    bossMode = !!(opts && opts.boss) || bossFlag;   // Boss Stage: Levels boss card → playBoss(), or ?boss=1 to test
```
**ACTION:** REPLACE with:
```js
  async function play(prov, opts) {
    provider = prov;
    bossMode = !!(opts && opts.boss) || bossFlag;   // Boss Stage: Levels boss card → playBoss(), or ?boss=1 to test
    // build7: re-assert the equipped skin at start UNLESS a per-level override is active (launchLevel sets it just before play())
    try { if (!_levelSkinActive && typeof applyEquippedSkin === 'function') applyEquippedSkin(); } catch (e) {}
```
> Per-level flow calls `setGuitarSkin(L.guitarSkin)` (sets `_levelSkinActive=true`) BEFORE
> `launchTrack→playUrl→play`, so this guard preserves the level override. Quick Play / library tracks have
> `_levelSkinActive=false` → equipped (or default) skin re-asserts.

### 1.D — index.html: add `guitarSkin` to frac-01 + document the field

**FILE:** `index.html`

**(d1) The frac-01 entry. ANCHOR (unique, exists once — ~line 3382):**
```js
    { id:'frac-01', tier:'hard', title:'The World', song:{ trackId:'53613a30-84c6-417e-89dd-d2aa06549141' }, theme:'violet',
      cover:'assets/levels/tarot.jpg', bgArt:'assets/levels/skully-bg.jpg', bgVideo:'assets/levels/skully-loop.mp4',
      reactiveCards:{ hit:'assets/levels/card-world.jpg', miss:'assets/levels/card-death.jpg' },
      mods:{ speed:1.15, mirror:false }, unlock:{ stars:1 } },   // SKULLY showcase level (Lil' Clay Skullyrae)
```
**ACTION:** REPLACE with (adds the `guitarSkin` line):
```js
    { id:'frac-01', tier:'hard', title:'The World', song:{ trackId:'53613a30-84c6-417e-89dd-d2aa06549141' }, theme:'violet',
      cover:'assets/levels/tarot.jpg', bgArt:'assets/levels/skully-bg.jpg', bgVideo:'assets/levels/skully-loop.mp4',
      reactiveCards:{ hit:'assets/levels/card-world.jpg', miss:'assets/levels/card-death.jpg' },
      guitarSkin:'assets/guitars/violet-gothic.png',   // per-level custom guitar (geometry-matched recolor of assets/guitar.png; 404 → default)
      mods:{ speed:1.15, mirror:false }, unlock:{ stars:1 } },   // SKULLY showcase level (Lil' Clay Skullyrae)
```

**(d2) Document the field. ANCHOR (unique, in the LEVEL SCHEMA comment — ~line 3363):**
```js
    //  mods  (opt) {speed,mirror,failOn} applied only if LEVELDESIGN_MODS=true (off)
```
**ACTION:** REPLACE with:
```js
    //  guitarSkin (opt) 'assets/guitars/x.png' per-level guitar art (MUST be a geometry-matched recolor of the active profile's PNG; 404→default)
    //  mods  (opt) {speed,mirror,failOn} applied only if LEVELDESIGN_MODS=true (off)
```

### 1.E — index.html: apply the per-level skin in `applyLevelTheme`, restore on clear

> **GUARD:** if `rg -n "setGuitarSkin\(L" index.html` already shows a hit (build6 landed this), SKIP 1.E.

**(e1) Apply with the theme. ANCHOR (unique, top of `applyLevelTheme` — ~lines 3534–3537):**
```js
  function applyLevelTheme(L) {
    var g = $('game'); if (!g) return;
    if (L && L.theme && LV_THEMES[L.theme]) { g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme); }
    else { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
```
**ACTION:** REPLACE with (this REPLACE is also re-used + EXTENDED in STEP 2.E1 — apply 2.E1's larger version
if you are integrating both; if applying only STEP 1 now, use this version):
```js
  function applyLevelTheme(L) {
    var g = $('game'); if (!g) return;
    if (L && L.theme && LV_THEMES[L.theme]) { g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme); }
    else { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    // build7: per-level custom guitar (temporary override; self-heals to default on 404). Falsy guitarSkin → equipped/default.
    try { if (window.RhythmGame && window.RhythmGame.setGuitarSkin) window.RhythmGame.setGuitarSkin(L && L.guitarSkin ? L.guitarSkin : null); } catch (e) {}
```
> `setGuitarSkin(null)` for a level without `guitarSkin` clears any stale override → equipped/default
> (correct because levels can be replayed back-to-back).

**(e2) Restore on teardown. ANCHOR (unique, top of `clearLevelTheme` — ~lines 3603–3605):**
```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    hideReactive();
```
**ACTION:** REPLACE with (this REPLACE is also re-used + EXTENDED in STEP 2.E2 — apply 2.E2's larger version
if integrating both):
```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    // build7: restore the equipped (or default) guitar when a custom-guitar level ends
    try { if (window.RhythmGame && window.RhythmGame.applyEquippedSkin) window.RhythmGame.applyEquippedSkin(); } catch (e) {}
    hideReactive();
```
> `clearLevelTheme()` is invoked by `showScreen('menu'|'results')` (game.js ~line 188) — so returning to
> menu/results after the Skully level restores the equipped/default guitar automatically.

---

## 2) PER-LEVEL HUD IDENTITY — themed restyle + additive accent glow + ambient (re-anchored build5)

These steps are UNIQUE to build7 and supersede `_build5_levelidentity.md` (its STEP-A and STEP-E anchors
no longer exist — the full-bleed work moved the accent to `#game.rr-lvl-themed #game-bg .bg-accent` and
edited `applyLevelTheme`/`clearLevelTheme`/`launchLevel`). All CSS is scoped under `#game.rr-lvl-themed`
so **Quick Play (no theme) is byte-identical**; the canvas passes read a module var that is null unless a
themed level is active → **zero change when no theme is set**.

### 2.A — index.html: extend the per-level theme CSS (HUD / frames / meters / scanlines)

**FILE:** `index.html`
**ANCHOR (unique, exists once — the existing themed bg-accent toggle at ~lines 779–781):**
```css
  /* per-level accent glow across the FULL backdrop (only when a level theme is active) */
  #game.rr-lvl-themed #game-bg .bg-accent { opacity: 0.5; }
  #results-next { display: none; }
```
**ACTION:** REPLACE with (inserts the themed-HUD block BETWEEN the bg-accent toggle and `#results-next`):
```css
  /* per-level accent glow across the FULL backdrop (only when a level theme is active) */
  #game.rr-lvl-themed #game-bg .bg-accent { opacity: 0.5; }
  /* violet/gothic (Skully) reads stronger behind the guitar than the lighter accents */
  #game.rr-lvl-themed[data-rrtheme="violet"] #game-bg .bg-accent { opacity: 0.62; }
  /* ====================================================================
     PER-LEVEL IDENTITY — restyle the WHOLE gameplay screen to the level
     accent (--rr-lvl-accent, set by the [data-rrtheme=...] rules above).
     Scoped under #game.rr-lvl-themed so Quick Play (no theme) is
     byte-identical. UI chrome OUTSIDE #game is never touched. (build7)
     ==================================================================== */
  #game.rr-lvl-themed {
    --rr-acc:        var(--rr-lvl-accent, #ff1f2e);
    --rr-acc-line:   color-mix(in srgb, var(--rr-lvl-accent, #ff1f2e) 36%, transparent);
    --rr-acc-glow:   color-mix(in srgb, var(--rr-lvl-accent, #ff1f2e) 55%, transparent);
  }
  /* side HUD panels: warm-dark base tinted toward the level accent + accent hairline */
  #game.rr-lvl-themed .hud-panel {
    background: linear-gradient(180deg,
      color-mix(in srgb, var(--rr-acc) 10%, rgba(14,7,8,0.9)),
      color-mix(in srgb, var(--rr-acc) 6%,  rgba(20,10,11,0.5)));
  }
  #game.rr-lvl-themed .hud-panel.left  { border-right: 1px solid var(--rr-acc-line); }
  #game.rr-lvl-themed .hud-panel.right { border-left:  1px solid var(--rr-acc-line); }
  /* angular corner brackets adopt the level accent */
  #game.rr-lvl-themed .hud-panel::before,
  #game.rr-lvl-themed .hud-panel::after {
    border-color: color-mix(in srgb, var(--rr-acc) 70%, transparent);
  }
  /* label signal-diamonds + their glow */
  #game.rr-lvl-themed .hud-block .label::before {
    background: var(--rr-acc);
    box-shadow: 0 0 8px var(--rr-acc-glow);
  }
  /* brand dot in the panel header */
  #game.rr-lvl-themed .hud-panel .brand-dot {
    background: var(--rr-acc); box-shadow: 0 0 12px var(--rr-acc-glow);
  }
  /* meters: song-progress fill leans crimson→accent */
  #game.rr-lvl-themed .song-progress > i {
    background: linear-gradient(90deg,
      color-mix(in srgb, var(--rr-acc) 55%, #b3121f),
      var(--rr-acc));
    box-shadow: 0 0 12px var(--rr-acc-glow), inset 0 1px 0 rgba(255,255,255,0.35);
  }
  /* overdrive bar stays gold/ember (universal reward signal) — only its segmented track border tints */
  #game.rr-lvl-themed .od-bar { border-color: var(--rr-acc-line); }
  /* reality-stability fill carries an INLINE gradient (index.html ~line 2988) → override to accent→gold */
  #game.rr-lvl-themed #hud-stability {
    background: linear-gradient(90deg, var(--rr-acc), #e0a93f) !important;
  }
  /* judgment composition bar: perfect/miss segments lean to the themed cluster (great/good keep semantic gold/coral) */
  #game.rr-lvl-themed .judge-bar .perfect { background: color-mix(in srgb, var(--rr-acc) 30%, #dad7d2); }
  #game.rr-lvl-themed .judge-bar .miss    { background: var(--rr-acc); }
  /* the crimson hero readouts retint to the level accent */
  #game.rr-lvl-themed .hud-block .val.crimson {
    color: var(--rr-acc);
    text-shadow: 0 0 26px var(--rr-acc-glow);
  }
  /* the faint full-screen scanline texture picks up a hint of the accent (kept very low alpha) */
  #game.rr-lvl-themed.game-screen::after {
    background: repeating-linear-gradient(0deg,
      color-mix(in srgb, var(--rr-acc) 30%, rgba(150,35,35,0.045)) 0,
      color-mix(in srgb, var(--rr-acc) 30%, rgba(150,35,35,0.045)) 1px,
      transparent 1px, transparent 3px);
  }
  /* footer hint keycaps get an accent edge so the chrome below the board reads themed */
  #game.rr-lvl-themed .footer-hint kbd { border-color: var(--rr-acc-line); }
  #results-next { display: none; }
```

**Brand-safety / a11y:**
- Every new selector is prefixed `#game.rr-lvl-themed` → **inert for Quick Play** (no class) and never
  touches the global UI (start/jukebox/results). Violet is the only non-warm hue and is permitted as a
  *level* palette per CLAUDE.md; core UI chrome stays crimson.
- `color-mix` is supported on the user's Chrome target. On an engine without it, the property is dropped
  and the element keeps its existing crimson rule (degrades to "looks like today"), not broken.
- `!important` on `#hud-stability` is required only because that fill has an **inline** gradient; scoped to
  themed runs only, so it can't bleed into Quick Play.
- No new animation/transition is introduced, so there is nothing for `reduceMotion` to gate here (the
  canvas passes in 2C are the motion-bearing parts and are gated there).

### 2.B — game.js: declare the accent state (module vars)

**FILE:** `game.js`
**ANCHOR (unique, exists once — ~line 103):**
```js
  let bgPulse = 0;
```
**ACTION:** INSERT immediately AFTER that line:
```js
  // ---- PER-LEVEL VISUAL IDENTITY (build7) ----
  // Set by RhythmGame.setLevelAccent('r,g,b') from the level-theme code; null = Quick Play (no tint).
  // Used ONLY for ADDITIVE glow + ambient FX — LANE_COLORS / scoring / timing are untouched.
  let levelAccentRGB = null;     // e.g. '166,77,255' for violet, or null
  let levelAmbient = 0;          // 0..1 strength of the ambient FX layer (0 = off)
```

### 2.B2 — game.js: additive accent halo under the catcher ring

**FILE:** `game.js`
**ANCHOR (unique, exists once — the catcher draw in `render()` at ~line 2023):**
```js
      drawCatcher(nearX[i], cY, lw * 0.28, cCol, pulse, 0.4 + Math.max(bgPulse, energy) * 0.6, lanePulse[i]);
    }
```
**ACTION:** REPLACE with (adds the halo INSIDE the catcher `for` loop, before its closing `}`):
```js
      drawCatcher(nearX[i], cY, lw * 0.28, cCol, pulse, 0.4 + Math.max(bgPulse, energy) * 0.6, lanePulse[i]);
      // build7: additive level-accent halo under the catcher (presentation only; skipped in Quick Play / fxLite)
      if (levelAccentRGB && !fxLite) {
        const ag = (0.10 + Math.max(pulse, Math.max(bgPulse, energy)) * 0.22);
        if (ag > 0.02) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const r2 = lw * 0.5;
          const grd = ctx.createRadialGradient(nearX[i], cY, 0, nearX[i], cY, r2);
          grd.addColorStop(0, 'rgba(' + levelAccentRGB + ',' + ag.toFixed(3) + ')');
          grd.addColorStop(1, 'rgba(' + levelAccentRGB + ',0)');
          ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(nearX[i], cY, r2, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }
```

### 2.B3 — game.js: soft accent aura behind a near note (uses the REAL note radius `lw*0.46*sc`)

**FILE:** `game.js`
**ANCHOR (unique, exists once — the per-note sprite blit at the end of the notes loop, ~line 2128):**
```js
      if (!resolving) drawNote(nx, ny, lw * 0.46 * sc, n);
    }
```
**ACTION:** REPLACE with (inserts an additive aura BEFORE the sprite blit; `nx`/`ny`/`lw`/`sc`/`d` are the
real locals already computed at lines 2033–2037):
```js
      // build7: soft accent aura behind a note as it nears the catcher (additive; Quick Play / fxLite skip).
      // Radius uses the SAME note size as drawNote (lw*0.46*sc), so the halo tracks the sphere exactly.
      if (!resolving && levelAccentRGB && !fxLite && d < 0.55) {
        const aa = (0.55 - d) / 0.55 * 0.16;
        if (aa > 0.01) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const rr = lw * 0.46 * sc * 2.0;
          const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, rr);
          ng.addColorStop(0, 'rgba(' + levelAccentRGB + ',' + aa.toFixed(3) + ')');
          ng.addColorStop(1, 'rgba(' + levelAccentRGB + ',0)');
          ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(nx, ny, rr, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
      if (!resolving) drawNote(nx, ny, lw * 0.46 * sc, n);
    }
```
> `lw*0.46*sc` is the exact radius `drawNote` is called with on the very next line, so the aura is centered
> and sized to the sphere; `*2.0` makes it a soft halo around (not under) the note. `d < 0.55` keeps it to
> notes within ~half the approach so it doesn't smear the whole highway. Bombs (`continue` at ~line 2049),
> open/chord bars (`continue`/no early sphere), and judged-and-gone notes all bypass this naturally.

### 2.C — game.js: gated per-level ambient FX layer (accent embers + fog)

**FILE:** `game.js`
**ANCHOR (unique, exists once — the close of `drawCathedralBg` at ~lines 2795–2798):**
```js
      ctx.fillStyle = gl; ctx.fillRect(0, 0, cw, ch * 0.6);
      ctx.restore();
    }
  }
```
**ACTION:** REPLACE with (adds one call before the final `}`, then defines `drawLevelAmbient`):
```js
      ctx.fillStyle = gl; ctx.fillRect(0, 0, cw, ch * 0.6);
      ctx.restore();
    }
    drawLevelAmbient(t);   // build7: per-level accent ambient (gated, no-op in Quick Play)
  }

  // ---- PER-LEVEL AMBIENT (build7) ----
  // Drifting accent-colored embers + a soft accent fog band, painted on the transparent canvas so it
  // reads ACROSS the whole highway (not just the DOM backdrop hidden behind the guitar). Intensity is
  // tied to energy/bgPulse. Fully gated: no accent / no ambient / reduceMotion / fxLite → returns at once.
  function drawLevelAmbient(t) {
    if (!levelAccentRGB || !levelAmbient || reduceMotion || fxLite) return;
    const A = levelAccentRGB;
    const inten = Math.max(bgPulse, energy * 0.85) * levelAmbient;
    // 1) low accent fog rising off the bottom third (cheap, big-read color)
    {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fg = ctx.createLinearGradient(0, ch, 0, ch * 0.55);
      fg.addColorStop(0, 'rgba(' + A + ',' + (0.05 + inten * 0.10).toFixed(3) + ')');
      fg.addColorStop(1, 'rgba(' + A + ',0)');
      ctx.fillStyle = fg; ctx.fillRect(0, ch * 0.55, cw, ch * 0.45);
      ctx.restore();
    }
    // 2) drifting accent embers — count + glow scale with intensity (mirrors the crimson ember pass)
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const n = 8 + Math.floor(energy * 14 * levelAmbient);
    for (let i = 0; i < n; i++) {
      const seed = i * 91.7;
      const x = (Math.sin(seed * 1.3) * 0.5 + 0.5) * cw;
      const prog = ((t * (0.03 + (i % 4) * 0.01) + (seed % 1)) % 1);
      const y = ch * (0.96 - prog * 0.78);
      const sz = (0.7 + (i % 3) * 0.8) * (1 + energy * 0.8);
      const a = (0.10 + inten * 0.30) * (1 - prog);
      ctx.fillStyle = 'rgba(' + A + ',' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x + Math.sin(t * 0.9 + i) * 7, y, sz, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
```
> Cost: one gradient fill + ~8–22 small arcs per frame, only when a themed level is active and FX are on.
> Mirrors the existing crimson ember pass (same magnitude) — no new perf class.

### 2.D — game.js: the `setLevelAccent` setter (the only new public hook)

**FILE:** `game.js`
**ANCHOR (unique, exists once — ~line 939):**
```js
  window.RhythmGame.setLevelMods = (m) => { _levelMods = (m && typeof m === 'object') ? m : null; };
```
**ACTION:** INSERT immediately AFTER that line:
```js
  // build7: per-level visual identity hook. accent = 'r,g,b' string (or null to clear);
  // amb = 0..1 ambient FX strength (default 0.6 when an accent is given). Presentation only.
  window.RhythmGame.setLevelAccent = (accent, amb) => {
    levelAccentRGB = (typeof accent === 'string' && /^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(accent))
      ? accent.replace(/\s+/g, '') : null;
    levelAmbient = levelAccentRGB ? (typeof amb === 'number' ? Math.max(0, Math.min(1, amb)) : 0.6) : 0;
  };
```
> Frame-cheap contract: the level-theme code pushes the accent ONCE at launch and clears it on exit, so
> `render()` never reads DOM / `getComputedStyle` per frame.

### 2.E — index.html: wire the accent + harden theme apply/clear/launch

**FILE:** `index.html`

**2.E1 — push the accent when a theme applies (also carries the STEP 1.E1 guitar-skin line).**
**ANCHOR (unique, top of `applyLevelTheme` — ~lines 3534–3537):**
```js
  function applyLevelTheme(L) {
    var g = $('game'); if (!g) return;
    if (L && L.theme && LV_THEMES[L.theme]) { g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme); }
    else { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
```
**ACTION:** REPLACE with (this is the FULL version — includes the STEP 1.E1 guitar-skin line, so if you
applied STEP 1.E1 first, the `var g = $('game')...` head already matches and this REPLACE supersedes it):
```js
  function applyLevelTheme(L) {
    var g = $('game'); if (!g) return;
    if (L && L.theme && LV_THEMES[L.theme]) {
      g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme);
      // build7: push the accent into the engine for additive note/catcher glow + ambient FX.
      try {
        var _acc = ({ crimson:'255,31,46', ember:'255,122,74', gold:'224,169,63', chrome:'218,215,210', violet:'166,77,255' })[L.theme];
        // violet/gothic (Skully) gets a richer ambient; chrome/gold are subtler (light hues read as haze)
        var _amb = (L.theme === 'violet') ? 0.8 : (L.theme === 'chrome' ? 0.35 : 0.55);
        if (window.RhythmGame && window.RhythmGame.setLevelAccent) window.RhythmGame.setLevelAccent(_acc || null, _amb);
      } catch (e) {}
    } else {
      g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme');
      try { window.RhythmGame && window.RhythmGame.setLevelAccent && window.RhythmGame.setLevelAccent(null); } catch (e) {}
    }
    // build7: per-level custom guitar (temporary override; self-heals to default on 404). Falsy guitarSkin → equipped/default.
    try { if (window.RhythmGame && window.RhythmGame.setGuitarSkin) window.RhythmGame.setGuitarSkin(L && L.guitarSkin ? L.guitarSkin : null); } catch (e) {}
```
> The hex→rgb map mirrors `SPLASH_THEME` and the `[data-rrtheme]` CSS values exactly (note: violet's CSS
> accent is `#a64dff` = `166,77,255`). Keep the two in sync if a new theme is added.

**2.E2 — clear the accent on teardown (also carries the STEP 1.E2 skin restore).**
**ANCHOR (unique, top of `clearLevelTheme` — ~lines 3603–3605):**
```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    hideReactive();
```
**ACTION:** REPLACE with (FULL version — supersedes STEP 1.E2):
```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    // build7: clear the level accent (additive glow + ambient off) and restore the equipped/default guitar
    try { window.RhythmGame && window.RhythmGame.setLevelAccent && window.RhythmGame.setLevelAccent(null); } catch (e) {}
    try { if (window.RhythmGame && window.RhythmGame.applyEquippedSkin) window.RhythmGame.applyEquippedSkin(); } catch (e) {}
    hideReactive();
```
> `clearLevelTheme()` fires on every screen change away from `game`/`countdown` (game.js ~line 188), so the
> accent, ambient, reactive cards, and custom guitar all tear down on results/exit — the "reliably gone
> after" guarantee holds with no extra wiring.

**2.E3 — re-assert theme + reactive a beat after launch (reliability for the loading→countdown→game seq).**
**ANCHOR (unique, the `launchLevel` body — ~lines 3518–3520):**
```js
    applyLevelTheme(L);
    showSplash(L, track);   // themed intro card over the loading screen (skippable, reduceMotion/fxLite-safe)
    showReactive(L);        // per-level reactive overlay (e.g. Skully's DEATH / THE WORLD tarot cards)
```
**ACTION:** REPLACE with:
```js
    applyLevelTheme(L);
    showSplash(L, track);   // themed intro card over the loading screen (skippable, reduceMotion/fxLite-safe)
    showReactive(L);        // per-level reactive overlay (e.g. Skully's DEATH / THE WORLD tarot cards)
    // build7: re-assert theme + reactive a beat after the screen settles, so a stray screen-change
    // teardown during loading can't strip the active level's identity before the countdown.
    try { setTimeout(function () { if (_activeLevel === L) { applyLevelTheme(L); showReactive(L); } }, 650); } catch (e) {}
```
> `_activeLevel === L` guards against re-applying a stale theme if the user bailed. Idempotent: re-calling
> `applyLevelTheme`/`showReactive` just re-sets the same class/attr/handlers/skin.

---

## 3) CONFIRMATION — violet theme + skully backdrop + DEATH/THE WORLD cards (already correct)

Verified in the live files; no edit needed, listed so the integrator can confirm by grep:
- **Violet theme accent:** `index.html:778` → `#game.rr-lvl-themed[data-rrtheme="violet"] { --rr-lvl-accent: #a64dff; }`
  and `SPLASH_THEME.violet = '#a64dff'` (index.html ~3432). `LV_THEMES.violet = 1` (index.html:3351).
- **frac-01 backdrop:** `bgVideo:'assets/levels/skully-loop.mp4'` + poster `bgArt:'assets/levels/skully-bg.jpg'`
  — both exist on disk; `applyLevelTheme`'s `v.onerror → showStatic()` self-heals the loop to the poster,
  then the moon video, if the mp4 ever 404s.
- **Reactive cards (the "fill up" mechanic):** `reactiveCards:{ hit:'assets/levels/card-world.jpg',
  miss:'assets/levels/card-death.jpg' }` — both exist. `showReactive` paints them into `#rc-world`/`#rc-death`,
  `setFill(card, v)` drives `--fill` (card height) + the `.charged` class at ≥0.55; THE WORLD charges on
  hits, DEATH on misses (index.html:3590–3595). `.rc-world .rc-fill` already uses a violet-tinted gradient
  (index.html:619) — on-theme for Skully. `html.rr-reduce-motion` kills the card transition/flash
  (index.html:630–631). All correct as-is.

---

## 4) ?v BUMP (only if not already bumped this pass)

`index.html` line 14 (`jukebox.css`) + lines 3220–3222 (`game.js`/`jukebox.js`/`catalog.js`):
change `?v=84` → `?v=85`. Per the project rule, bump on any JS/CSS edit. **If `_build6_*` already bumped to
85 in this integration pass, leave it at 85 — do not double-bump.** (jukebox.css/jukebox.js are bumped only
to keep all four stamps in lockstep; this package edits game.js + index.html.)

---

## 5) THE LEVEL RECIPE — copy this to author every other level

A level is one object in the `AUTHORED[]` array (index.html ~line 3352). frac-01 is the complete template:

```js
{
  id:'frac-01',                 // REQ  unique, stable string  (rr_levelprog key + unlock chain)
  tier:'hard',                  // REQ  'easy' | 'medium' | 'hard'   (difficulty band; gameplay byte-identical per tier)
  title:'The World',            // REQ  card + splash title
  song:{ trackId:'53613a30-…' },// REQ  pin a real track: {trackId:'<uuid>'} · or {stride:N} (library index) · or {demo:true}
  theme:'violet',               // OPT  crimson|ember|gold|chrome|violet → HUD restyle + accent glow + ambient + splash palette
  cover:'assets/levels/tarot.jpg',          // OPT  card + splash key art (missing → title initial)
  bgArt:'assets/levels/skully-bg.jpg',      // OPT  full-bleed backdrop poster (instant; also the bgVideo poster)
  bgVideo:'assets/levels/skully-loop.mp4',  // OPT  full-bleed backdrop loop (404 → bgArt → moon)
  reactiveCards:{ hit:'assets/levels/card-world.jpg', miss:'assets/levels/card-death.jpg' }, // OPT  flanking fill-cards (hit→world, miss→death)
  guitarSkin:'assets/guitars/violet-gothic.png', // OPT  per-level guitar — MUST be a geometry-matched recolor of assets/guitar.png (404 → equipped/default)
  mods:{ speed:1.15, mirror:false },        // OPT  {speed,mirror,failOn} — applied ONLY if LEVELDESIGN_MODS=true (presentation/dev; off by default)
  unlock:{ stars:1 },           // OPT  {stars:N} gate on prior level · or {stars:N, entitlement:{item_type:'level',item_id:'…'}} for premium
  boss:true                     // OPT  routes through playBoss() (boss provider)
}
```

**The five things that make a level "done right" (frac-01 has all five):**
1. **A pinned song** (`song.trackId`) so it's always the same track.
2. **A `theme`** → drives the full HUD restyle (STEP 2.A) + additive note/catcher accent glow + ambient
   embers/fog (STEPS 2.B–2.D) + the splash palette.
3. **A backdrop** (`bgArt` + optional `bgVideo`) for the full-bleed environment.
4. **A `guitarSkin`** (STEP 1) — a geometry-matched recolor in `assets/guitars/` so the instrument itself
   changes while notes stay perfectly aligned (the 4 on disk: `crimson-chrome`, `ember-bone`, `gold-relic`,
   `violet-gothic`).
5. **`reactiveCards`** — the live "fate meter" fill-cards that react to your hits/misses.

Asset naming convention: covers/backdrops under `assets/levels/`, guitar skins under `assets/guitars/`
(recolor of `assets/guitar.png`, same silhouette + string positions), store covers under `assets/store/`.

---

## 6) VERIFY CHECKLIST

**Static / grep (offline):**
```
node --check game.js
rg -n "setLevelAccent" game.js index.html      # 1 def (game.js) + 1 set + 1 null (E1) + 1 null (E2) in index.html
rg -n "levelAccentRGB|levelAmbient|drawLevelAmbient" game.js   # declared once each; used in 2B2/2B3/2C
rg -n "setGuitarSkin|applyEquippedSkin|equipGuitarSkin" game.js index.html  # layer + level wiring present once each
rg -n "guitarSkin" index.html                  # frac-01 field + schema comment + setGuitarSkin call
rg -n "violet-gothic.png" index.html           # frac-01 points at the real asset
rg -n "lw \* 0.46 \* sc \* 2.0" game.js         # note-aura uses the real note radius (not gfx.base)
rg -n "rr-lvl-themed" index.html               # every new CSS line in 2A is prefixed (eyeball: no global leak)
rg -n "\?v=85" index.html                       # 4 hits ; rg -n "\?v=84" index.html → 0 hits
ls assets/guitars/violet-gothic.png assets/levels/skully-loop.mp4 assets/levels/card-world.jpg assets/levels/card-death.jpg
```

**Runtime (Claude_Preview headless — name "rhythm-rift"):**
1. `preview_start` → `preview_eval`: `location.href = '/index.html?dev=1&cb=' + Date.now()` (dev unlocks all
   levels so frac-01 launches directly). Wait for boot.
2. Open the Levels overlay (layers icon) and launch **The World** (or `preview_eval`:
   `window.RhythmLibrary && window.RhythmLibrary.activeLevel` after launching) — then assert presentation:
   - `document.getElementById('game').classList.contains('rr-lvl-themed')` → `true`
   - `document.getElementById('game').getAttribute('data-rrtheme')` → `'violet'`
   - `getComputedStyle(document.getElementById('game')).getPropertyValue('--rr-lvl-accent').trim()` → `#a64dff`
   - `document.getElementById('rr-reactive').classList.contains('show')` → `true` (DEATH/THE WORLD up)
3. Confirm gameplay byte-identical: `window.__rrChartStats` note/hold/chord/bomb/filler counts are produced
   by the SAME chart builder (no code path in STEPS 1–2 touches `buildNotes`/scoring/timing).
4. Exit to menu/results → assert teardown:
   - `document.getElementById('game').classList.contains('rr-lvl-themed')` → `false`
   - `window.RhythmGame.getEquippedSkin()` returns the equipped (or null) skin (guitar restored)
5. `preview_console_logs` (level error) → expect none.

> The custom-guitar swap, additive glow, and ambient are visuals the headless canvas throttles; the code is
> node-valid + console-clean + the DOM/computed-style assertions above prove the wiring. The user confirms
> the violet guitar + accent glow + embers visually on their 60/30fps Chrome.

---

### SUMMARY (4 lines)
frac-01 "The World" becomes the reference level: STEP 1 adds an image-only `guitarSkin` swap layer (RhythmGame.setGuitarSkin/applyEquippedSkin, self-healing, geometry-safe) wired to the real `assets/guitars/violet-gothic.png`, with the frac-01 field + apply-on-theme / restore-on-clear — shared byte-for-byte with `_build6_guitarstore.md` (GUARDed so it lands once).
STEP 2 is the build5 per-level HUD identity RE-ANCHORED to live v84 code: scoped `#game.rr-lvl-themed` CSS restyle (panels/brackets/diamonds/meters/judge-bar/scanlines, violet bg-accent boost), a new frame-cheap `RhythmGame.setLevelAccent('r,g,b',amb)` driving an additive catcher halo + a note aura sized to the real `lw*0.46*sc` radius + a gated `drawLevelAmbient(t)` ember/fog pass, all pushed on apply and nulled on clear plus a 650ms idempotent re-assert.
Standard 6-string + gh gameplay/scoring/timing are byte-identical (all new passes early-return on null accent / Quick Play / reduceMotion / fxLite; no `buildNotes`/scoring edit); the violet theme + skully-loop.mp4 backdrop + DEATH/THE WORLD fill-cards are confirmed already-correct, and the LEVEL RECIPE schema (STEP 5) documents id/tier/song/theme/cover/bgArt/bgVideo/reactiveCards/guitarSkin/mods/unlock for copying to other levels.
Bump `?v=84→85` (4 stamps, skip if build6 already did); verify via `node --check`, the grep set, and the Claude_Preview `?dev=1` runtime assertions (rr-lvl-themed/data-rrtheme=violet/--rr-lvl-accent=#a64dff/#rr-reactive.show on launch, all gone + guitar restored on exit, console clean).
