# Build Package 5 — Per-Level In-Game Visual Identity

> **Concern:** Make each level look visually DISTINCT and rich in-game. Today every level shares the
> same flat dark-red HUD chrome (crimson corner brackets, crimson label diamonds, crimson meters,
> crimson scanlines) regardless of `L.theme`; the only per-level signal is the faint accent wash on
> the narrow center column (`.game-center::before`) and the DOM backdrop hidden behind the guitar.
> This package drives the existing `#game.rr-lvl-themed[data-rrtheme=...]` + `--rr-lvl-accent` so the
> WHOLE gameplay screen (side HUD panels, frames, labels, meters) restyles to the level palette, adds
> an additive level-accent tint to the catcher/note glow, and paints a gated per-level ambient FX
> layer on the transparent canvas. Standard 6-string scoring/timing stays **byte-identical** — this is
> presentation only.

---

## 1) SUMMARY + WHAT STAYS THE SAME

**What this adds**
- (a) **HUD restyle by theme** — the side `.hud-panel` frames, corner brackets, label signal-diamonds,
  judgment-bar/counters tint, the meter fills (progress/overdrive), the scanline overlay, and the
  center-column accent wash all retint to `--rr-lvl-accent` when a themed level is active. Pure CSS,
  driven by the class/attr `applyLevelTheme()` already sets. Quick Play (no theme) is unchanged.
- (b) **Additive level-accent glow** on catchers + notes — an *extra additive pass* tinted toward the
  level accent. `LANE_COLORS` is NOT touched (gh/standard color sets stay exact); the gems/spheres/
  catcher rings keep their existing fills, we only add a soft accent halo on top, intensity-gated.
- (c) **Per-level ambient canvas FX** — a gated `drawLevelAmbient(t)` pass inside `drawCathedralBg`
  that drifts accent-colored embers/fog using the level accent (e.g. violet for the gothic Skully
  level), intensity tied to `energy`/`bgPulse`, fully `reduceMotion`/`fxLite`-gated.
- (d) **Reliable theme + reactive overlay** — a tiny robustness pass so the theme/`RhythmLevelFx`
  reactive cards (DEATH / THE WORLD) reliably re-apply at gameplay start and tear down on exit.

**What stays byte-identical / untouched**
- Hit detection, timing windows, scoring, combo/multiplier, overdrive math — **no game.js logic edit**.
- `LANE_COLORS` and the note/catcher base sprites (gems, obsidian spheres, ring PNGs) — unchanged.
- The locked guitar geometry (`guitarRect`/`fretGeom`/`ART.*`) — untouched.
- Quick Play / non-themed runs: `#game` has no `.rr-lvl-themed` class → **every new CSS rule is inert**
  (all selectors are scoped under `#game.rr-lvl-themed[...]`), and the new ambient/glow passes read a
  window flag that is null unless a theme is active → **zero visual change when no theme is set**.
- Brand law: themed accents are per-level *level* palettes (violet allowed for gothic per CLAUDE.md);
  the global UI chrome outside `#game` is never touched. No blue is introduced.

**Files touched:** `index.html` (CSS block + 2 tiny JS shims in the existing level-theme code) and
`game.js` (1 small gated render hook + 1 setter). Bump all `?v=80 → ?v=81`.

---

## 2) EXACT INTEGRATION STEPS

### STEP A — index.html: extend the per-level theme CSS (HUD / frames / meters / scanlines)

**FILE:** `index.html`
**ANCHOR (unique, existing):** the per-level theme block ends with this exact line (~line 735):

```css
    mix-blend-mode: screen; opacity: 0.55; transition: opacity 0.4s ease; }
```

**ACTION:** INSERT the following block **immediately AFTER** that line (before `#results-next { display: none; }`).
Everything is scoped under `#game.rr-lvl-themed` so it is inert for Quick Play.

```css
  /* ====================================================================
     PER-LEVEL IDENTITY — restyle the WHOLE gameplay screen to the level
     accent (--rr-lvl-accent, set by applyLevelTheme). Scoped under
     #game.rr-lvl-themed so Quick Play (no theme) is byte-identical.
     UI chrome OUTSIDE #game is never touched. (build5)
     ==================================================================== */
  #game.rr-lvl-themed {
    /* derived accent tints reused below (color-mix keeps everything on-palette) */
    --rr-acc:        var(--rr-lvl-accent, #ff1f2e);
    --rr-acc-line:   color-mix(in srgb, var(--rr-lvl-accent, #ff1f2e) 36%, transparent);
    --rr-acc-soft:   color-mix(in srgb, var(--rr-lvl-accent, #ff1f2e) 16%, transparent);
    --rr-acc-glow:   color-mix(in srgb, var(--rr-lvl-accent, #ff1f2e) 55%, transparent);
    --rr-acc-deepbg: color-mix(in srgb, var(--rr-lvl-accent, #ff1f2e) 12%, #0a0706);
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
  /* center-column divider lines */
  #game.rr-lvl-themed .game-center::before,
  #game.rr-lvl-themed .game-center::after { /* keep the chrome hairline; only the wash retints (above) */ }
  /* label signal-diamonds + their glow */
  #game.rr-lvl-themed .hud-block .label::before {
    background: var(--rr-acc);
    box-shadow: 0 0 8px var(--rr-acc-glow);
  }
  /* brand dot in the panel header */
  #game.rr-lvl-themed .hud-panel .brand-dot {
    background: var(--rr-acc); box-shadow: 0 0 12px var(--rr-acc-glow);
  }
  /* meters: progress + reality-stability fills lean to accent (crimson→accent) */
  #game.rr-lvl-themed .song-progress > i {
    background: linear-gradient(90deg,
      color-mix(in srgb, var(--rr-acc) 55%, #b3121f),
      var(--rr-acc));
    box-shadow: 0 0 12px var(--rr-acc-glow), inset 0 1px 0 rgba(255,255,255,0.35);
  }
  /* overdrive bar stays gold/ember by design (it's a universal reward signal) — leave #hud-od-fill.
     But the segmented track border picks up the accent so the cluster reads themed. */
  #game.rr-lvl-themed .od-bar { border-color: var(--rr-acc-line); }
  /* reality-stability fill: it has an inline gradient (crimson→green); override to accent→gold */
  #game.rr-lvl-themed #hud-stability {
    background: linear-gradient(90deg, var(--rr-acc), #e0a93f) !important;
  }
  /* judgment composition bar: the MISS segment + "perfect" segment lean warm-accent so the bar
     reads as part of the themed cluster (great/good keep their semantic gold/coral) */
  #game.rr-lvl-themed .judge-bar .perfect { background: color-mix(in srgb, var(--rr-acc) 30%, #dad7d2); }
  #game.rr-lvl-themed .judge-bar .miss    { background: var(--rr-acc); }
  #game.rr-lvl-themed .jc.miss .num       { color: var(--rr-acc); }
  /* the crimson combo readout retints to accent (it's the level's hero number) */
  #game.rr-lvl-themed .hud-block .val.crimson {
    color: var(--rr-acc);
    text-shadow: 0 0 26px var(--rr-acc-glow);
  }
  /* the faint full-screen scanline texture adopts a hint of the accent (kept very low alpha) */
  #game.rr-lvl-themed.game-screen::after {
    background: repeating-linear-gradient(0deg,
      color-mix(in srgb, var(--rr-acc) 30%, rgba(150,35,35,0.045)) 0,
      color-mix(in srgb, var(--rr-acc) 30%, rgba(150,35,35,0.045)) 1px,
      transparent 1px, transparent 3px);
  }
  /* footer hint keycaps get an accent edge so even the chrome below the board reads themed */
  #game.rr-lvl-themed .footer-hint kbd { border-color: var(--rr-acc-line); }
  /* lighten the center accent wash a touch for stronger presence behind the guitar */
  #game.rr-lvl-themed .game-center::before { opacity: 0.7; }
  /* reduce-motion: kill the wash transition (no perf cost; respects the global a11y rule) */
  html.rr-reduce-motion #game.rr-lvl-themed .game-center::before { transition: none; }
```

**Notes / brand-safety:**
- Every selector is prefixed `#game.rr-lvl-themed` — so **none of it applies to Quick Play** (no class)
  and **none touches the global UI** (start/jukebox/results screens).
- `color-mix` is supported in the user's target (Chrome). If you want a zero-dependency fallback, the
  defaults degrade gracefully: an unsupported `color-mix` makes the property invalid → the element keeps
  its existing crimson rule (i.e. it just looks like today). No breakage.
- `!important` on `#hud-stability` is required only because that element carries an **inline** gradient
  (`index.html` line 2760). It is scoped to themed runs only.

---

### STEP B — game.js: additive per-level accent glow on catchers + notes (NO LANE_COLORS edit)

This adds a soft accent halo *on top of* the existing catcher/note draw. It reads a single module
variable `levelAccentRGB` (set by the new setter in Step D); when null (Quick Play) every added pass
is skipped → byte-identical.

**FILE:** `game.js`

**B1 — declare the accent state.** ANCHOR (unique, existing, ~line 103):

```js
  let bgPulse = 0;
```

INSERT immediately AFTER that line:

```js
  // ---- PER-LEVEL VISUAL IDENTITY (build5) ----
  // Set by RhythmGame.setLevelAccent('r,g,b') from the level-theme code; null = Quick Play (no tint).
  // Used ONLY for ADDITIVE glow + ambient FX — LANE_COLORS / scoring / timing are untouched.
  let levelAccentRGB = null;     // e.g. '166,77,255' for violet, or null
  let levelAmbient = 0;          // 0..1 strength of the ambient FX layer (0 = off)
```

**B2 — additive accent halo on the catcher ring.** ANCHOR (unique, existing, the catcher loop in
`render()`, ~line 2017):

```js
      drawCatcher(nearX[i], cY, lw * 0.28, cCol, pulse, 0.4 + Math.max(bgPulse, energy) * 0.6, lanePulse[i]);
```

REPLACE that single line with:

```js
      drawCatcher(nearX[i], cY, lw * 0.28, cCol, pulse, 0.4 + Math.max(bgPulse, energy) * 0.6, lanePulse[i]);
      // build5: additive level-accent halo under the catcher (presentation only; skipped in Quick Play)
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
```

**B3 — additive accent halo behind near notes.** ANCHOR: the note draw loop. Find the existing note
sprite blit. Read the block first to pick the exact anchor — search for where the sphere is drawn,
e.g. the line that does `ctx.drawImage(spr.c, ...)` inside `for (const n of notes)`. Insert a glow
*before* the sprite blit, gated by the same `levelAccentRGB`. Use this exact, self-contained snippet
placed at the top of the per-note draw body (right after `let d = ...; if (...) continue;` and after
the on-screen `x`/`y` for the note are computed — they are local vars `nx`/`ny` style; adapt to the
real local names you see):

```js
        // build5: soft accent aura behind a note as it nears the catcher (additive; Quick Play skips)
        if (levelAccentRGB && !fxLite && d < 0.55) {
          const aa = (0.55 - d) / 0.55 * 0.16;
          if (aa > 0.01) {
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            const rr = (gfx ? gfx.base : 30) * 0.9;
            const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, rr);
            ng.addColorStop(0, 'rgba(' + levelAccentRGB + ',' + aa.toFixed(3) + ')');
            ng.addColorStop(1, 'rgba(' + levelAccentRGB + ',0)');
            ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(nx, ny, rr, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
        }
```

> **IMPORTANT for the integrator:** B3's local names `nx`/`ny` are placeholders. Before pasting, READ the
> note loop (`game.js` ~lines 2020–2120) and substitute the *actual* computed screen-x / screen-y
> locals used for that note (they come from `noteX(n.lane, d)` / `noteY(d)`). If the loop already stores
> them (e.g. `const x = noteX(...)`, `const y = noteY(...)`), reuse those. B2 (catcher) is exact and
> can ship as-is; B3 is the only spot needing a 2-token name match. If unsure, **ship B2 only** — the
> catcher halo alone delivers most of the per-level read with zero risk.

---

### STEP C — game.js: gated per-level ambient FX layer (accent embers/fog)

**FILE:** `game.js`
**ANCHOR (unique, existing, end of `drawCathedralBg`, ~line 2791):**

```js
      ctx.fillStyle = gl; ctx.fillRect(0, 0, cw, ch * 0.6);
      ctx.restore();
    }
  }
```

REPLACE that closing of `drawCathedralBg` with (adds one call before the final `}`):

```js
      ctx.fillStyle = gl; ctx.fillRect(0, 0, cw, ch * 0.6);
      ctx.restore();
    }
    drawLevelAmbient(t);   // build5: per-level accent ambient (gated, no-op in Quick Play)
  }

  // ---- PER-LEVEL AMBIENT (build5) ----
  // Drifting accent-colored embers + a soft accent fog band, painted on the transparent canvas so it
  // reads ACROSS the whole highway (not just the DOM backdrop hidden behind the guitar). Intensity is
  // tied to energy/bgPulse. Fully gated: no accent / reduceMotion / fxLite → returns immediately.
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
    // 2) drifting accent embers — count + glow scale with intensity (mirrors the crimson embers)
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

> Cost: one gradient fill + ~8–22 small arcs per frame, only when a themed level is active and FX are
> on. This mirrors the existing crimson ember pass (same magnitude) so it adds no new perf class.

---

### STEP D — game.js: the setter (the only new public hook)

**FILE:** `game.js`
**ANCHOR (unique, existing, ~line 933):**

```js
  window.RhythmGame.setLevelMods = (m) => { _levelMods = (m && typeof m === 'object') ? m : null; };
```

INSERT immediately AFTER that line:

```js
  // build5: per-level visual identity hook. accent = 'r,g,b' string (or null to clear);
  // amb = 0..1 ambient FX strength (default 0.6 when an accent is given). Presentation only.
  window.RhythmGame.setLevelAccent = (accent, amb) => {
    levelAccentRGB = (typeof accent === 'string' && /^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(accent))
      ? accent.replace(/\s+/g, '') : null;
    levelAmbient = levelAccentRGB ? (typeof amb === 'number' ? Math.max(0, Math.min(1, amb)) : 0.6) : 0;
  };
```

This is the clean, frame-cheap contract: the level-theme code pushes the accent ONCE at launch (and
clears it on exit), so `render()` never has to read DOM / `getComputedStyle` per frame.

---

### STEP E — index.html: wire the accent + harden theme apply/clear (level-theme JS)

**FILE:** `index.html`

**E1 — push the accent into the engine when a theme is applied.**
ANCHOR (unique, existing, inside `applyLevelTheme`, ~line 3308):

```js
    if (L && L.theme && LV_THEMES[L.theme]) { g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme); }
    else { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
```

REPLACE with:

```js
    if (L && L.theme && LV_THEMES[L.theme]) {
      g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme);
      // build5: push the accent into the engine for additive note/catcher glow + ambient FX.
      try {
        var _acc = ({ crimson:'255,31,46', ember:'255,122,74', gold:'224,169,63', chrome:'218,215,210', violet:'166,77,255' })[L.theme];
        // violet/gothic gets a richer ambient; chrome/gold are subtler (they're light, read as haze)
        var _amb = (L.theme === 'violet') ? 0.8 : (L.theme === 'chrome' ? 0.35 : 0.55);
        if (window.RhythmGame && window.RhythmGame.setLevelAccent) window.RhythmGame.setLevelAccent(_acc || null, _amb);
      } catch (e) {}
    } else {
      g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme');
      try { window.RhythmGame && window.RhythmGame.setLevelAccent && window.RhythmGame.setLevelAccent(null); } catch (e) {}
    }
```

> The hex-to-rgb map mirrors `SPLASH_THEME` / the CSS accent values exactly. Keep the two in sync if a
> new theme is added (single source of truth lives in CLAUDE.md's brand block).

**E2 — clear the accent on teardown (belt-and-suspenders).**
ANCHOR (unique, existing, inside `clearLevelTheme`, ~line 3365):

```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    hideReactive();
```

REPLACE the first two lines of the body with:

```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    try { window.RhythmGame && window.RhythmGame.setLevelAccent && window.RhythmGame.setLevelAccent(null); } catch (e) {}
    hideReactive();
```

> `clearLevelTheme()` is already called by `game.js:188` on any screen change away from `game`/
> `countdown`, so the accent + reactive overlay tear down on results/exit automatically. This makes the
> "reliably show in gameplay, reliably gone after" guarantee (concern d) hold without new wiring.

**E3 — (reliability for concern d) re-assert theme + reactive at gameplay start.** The theme is applied
in `launchLevel()` BEFORE `playDemo`/`launchTrack`. That ordering is correct, but `clearLevelTheme()`
fires on the menu→game screen transition path in some flows. To guarantee the theme survives the
loading→countdown→game screen sequence for the ACTIVE level, re-apply it when the game screen shows.
ANCHOR (unique, existing, the `launchLevel` body, ~line 3290):

```js
    applyLevelTheme(L);
    showSplash(L, track);   // themed intro card over the loading screen (skippable, reduceMotion/fxLite-safe)
    showReactive(L);        // per-level reactive overlay (e.g. Skully's DEATH / THE WORLD tarot cards)
```

REPLACE with:

```js
    applyLevelTheme(L);
    showSplash(L, track);   // themed intro card over the loading screen (skippable, reduceMotion/fxLite-safe)
    showReactive(L);        // per-level reactive overlay (e.g. Skully's DEATH / THE WORLD tarot cards)
    // build5: re-assert theme + reactive a beat after the screen settles, so a stray screen-change
    // teardown during loading can't strip the active level's identity before the countdown.
    try { setTimeout(function () { if (_activeLevel === L) { applyLevelTheme(L); showReactive(L); } }, 650); } catch (e) {}
```

> `_activeLevel === L` guards against re-applying a stale theme if the user bailed. Idempotent: calling
> `applyLevelTheme`/`showReactive` twice is harmless (they just set the same class/attr/handlers).

---

### STEP F — index.html: bump cache-bust

Change all four `?v=80` to `?v=81` (line 14 `jukebox.css`, lines 2992–2994 `game.js`/`jukebox.js`/
`catalog.js`). Per the project rule, bump on any JS/CSS edit.

---

## 3) NEW HOOKS + WIRING (recap)

| Hook | Where defined | Where called | Contract |
|---|---|---|---|
| `window.RhythmGame.setLevelAccent(accent, amb)` | game.js (Step D) | index.html `applyLevelTheme` (set) + `clearLevelTheme` (null) | `accent`='r,g,b' or null; `amb`=0..1 (default 0.6). Sets module `levelAccentRGB`/`levelAmbient`. |
| `levelAccentRGB`, `levelAmbient` (module) | game.js (Step B1) | catcher loop (B2), note loop (B3), `drawLevelAmbient` (C) | null/0 → all per-level passes skip. |
| `drawLevelAmbient(t)` | game.js (Step C) | end of `drawCathedralBg` | gated by accent + reduceMotion + fxLite. |
| CSS `#game.rr-lvl-themed[...]` rules | index.html (Step A) | driven by existing class/attr from `applyLevelTheme` | inert without `.rr-lvl-themed`. |

`RhythmLevelFx.onHit/onMiss` (the DEATH/THE WORLD cards) is **already** wired (game.js 1535/1595 →
index.html `showReactive`); Step E2/E3 only harden its lifecycle. No change to that contract.

---

## 4) ASSETS (generation prompts — optional, NOT required to ship)

The CSS/canvas package works with the **existing** `assets/levels/*` backdrops. These are *optional*
upgrades so the DOM backdrop behind the guitar matches the new themed HUD. Save under
`assets/levels/`. Generate via Higgsfield Seedance (loops) or GPT Image (stills). 16:9, dark, warm.

- **`pulse-bg.jpg`** (medium tier, ember/crimson): *"Dark warm-black concert backdrop, faint crimson
  and ember-orange volumetric haze drifting upward, distant blurred stage lights, subtle film grain,
  no text, no instruments, cinematic, 16:9, very dark so foreground UI stays legible."*
- **`fracture-bg.jpg`** (hard tier, violet gothic): *"Dark gothic cathedral interior dissolving into
  violet fracture light, drifting violet embers and cold purple fog, cracked stained-glass glow, eerie,
  warm-black shadows, no text, cinematic, 16:9, very dark."*
- **`boss-bg.jpg`** (boss, crimson): *"Ominous blood-red void with a pulsing dark core, swirling crimson
  smoke, sparks, high contrast, menacing, no text, 16:9, very dark edges."*
- **`skully-loop.mp4`** already exists (Seedance) — leave as-is; the violet HUD now frames it correctly.

If an asset 404s, `applyLevelTheme`'s existing self-heal falls back to the static bgArt then the moon
video — the themed HUD + canvas ambient still deliver the identity regardless.

---

## 5) VERIFY-OFFLINE NOTES + RISKS

**Syntax / structural**
- `node --check game.js` after the game.js edits (project rule).
- Grep confirms the new public hook exists exactly once:
  `rg "setLevelAccent" game.js index.html` → expect 1 def (game.js) + 2 calls + 1 null-call (index.html).
- Grep the new module vars are declared once: `rg "levelAccentRGB|levelAmbient|drawLevelAmbient" game.js`.
- Confirm cache-bust bumped: `rg "\?v=81" index.html` → 4 hits; `rg "\?v=80" index.html` → 0 hits.
- Confirm scoping (no accidental global leak): every new CSS rule line should contain
  `#game.rr-lvl-themed`. `rg -n "rr-lvl-themed" index.html` and eyeball the new block — all selectors
  prefixed.

**Behavioral reasoning (can't boot headless)**
- Quick Play: `#game` never gets `.rr-lvl-themed`, and `setLevelAccent` is only called from
  `applyLevelTheme` (themed levels) → `levelAccentRGB` stays null → B2/B3/C all early-return, all CSS
  inert. **Byte-identical to v80.** This is the core safety argument.
- Themed level (e.g. frac-01 violet): `applyLevelTheme` adds class + attr (CSS retints HUD) and calls
  `setLevelAccent('166,77,255',0.8)` (canvas glow + ambient). On results/exit, `clearLevelTheme()`
  (game.js:188) removes class + nulls the accent → next Quick Play run is clean.
- `reduceMotion`/`fxLite`: `drawLevelAmbient` returns immediately; B2/B3 are skipped when `fxLite`;
  the CSS wash transition is killed under `html.rr-reduce-motion`. Respects the global a11y rule.

**Risks / mitigations**
- *`color-mix` support:* fine on the user's Chrome target. On an old engine the property is dropped and
  the element keeps its existing crimson rule (degrades to "looks like today"), not broken. If you want
  belt-and-suspenders, precompute the 5 accents as static hex in the theme block instead of `color-mix`.
- *B3 local-var names:* the only spot needing a 2-token match to the real note-loop locals. Mitigation:
  ship B2 (catcher, exact) first; add B3 after reading the loop. Catcher halo alone already reads.
- *`!important` on `#hud-stability`:* required because that fill has an inline gradient; scoped to themed
  runs only, so it can't bleed into Quick Play.
- *Theme teardown timing:* the 650ms re-assert (E3) is idempotent and `_activeLevel`-guarded, so it
  can't re-theme a level the user already left.
- *Overdrive bar intentionally NOT retinted* (stays gold/ember) — it's a cross-level reward signal;
  retinting it would weaken the universal "charged" read. Only its track border picks up the accent.

---

### SUMMARY (4 lines)
Drives the existing `#game.rr-lvl-themed`/`--rr-lvl-accent` into a full gameplay restyle: themed CSS for HUD panels, corner brackets, label diamonds, meters, judgment bar and scanlines (Step A), all scoped so Quick Play stays byte-identical.
Adds a new frame-cheap `RhythmGame.setLevelAccent('r,g,b', amb)` hook that game.js reads for an ADDITIVE accent halo on catchers/notes (LANE_COLORS untouched) and a gated `drawLevelAmbient(t)` accent ember/fog layer tied to energy/bgPulse, all reduceMotion/fxLite-gated (Steps B–D).
The level-theme JS pushes the accent on apply and nulls it on clear, plus a 650ms idempotent re-assert so the theme + DEATH/THE WORLD reactive cards reliably show in gameplay and tear down on exit (Step E); bump ?v=80→81 (Step F).
Verify offline via node --check, grep for the single new hook + scoped selectors, and the Quick-Play-inert argument; only risk needing care is matching B3's note-loop local names (ship B2 catcher-only if unsure).
