# _build6_polish — Loading-screen glow-up + Browse-section video backdrop

Concern: (A) a premium, on-brand animated **loading** loader and (B) a full-bleed looping
**video backdrop behind the library/browse (coverflow) screen** (`#menu` → `.lib`), replacing the
static red moon, with a dark scrim + self-heal fallback. **index.html + jukebox.css only. No
gameplay change. No game.js/jukebox.js/catalog.js logic edits** (only the shared `?v=` bump).

Branch: visual-overhaul (~v84). Integrator applies by finding the unique anchor strings below,
then runtime-tests in the Claude_Preview headless browser.

---

## 1) SUMMARY — what changes / what stays byte-identical

### What changes
- **(A) Loading screen** (`#loading`): the atom SVG loader is **upgraded in place** — same markup
  IDs, richer CSS. New: a counter-rotating chrome outer ring, an ember conic energy sweep, a
  3-bar equalizer pulse under the nucleus, and a brighter crimson→ember progress ring. All pure
  CSS (no new asset). The four JS-driven hooks (`#loading-ring`, `#loading-msg`, `#loading-pct`,
  `#loading-stage`) are **untouched** so `setLoading()` / `demoProvider()` in game.js stay
  byte-identical. reduceMotion kills every animation to a clean static frame.
- **(B) Browse backdrop**: a new `<video id="lib-video">` layer + scrim is added as the **first
  children of `#menu`** (behind `.lib`). It plays `assets/levels/browse-loop.mp4` (blood-moon
  loop). A dark scrim keeps coverflow + text legible. If the video 404s / can't play, it
  self-heals: hides itself and the **existing static `.lib::after` moon + `.lib::before` glow show
  through unchanged** (they remain in the CSS as the fallback). Gated by `?novideo` and
  `html.rr-perf-bg` exactly like `#bg-video`/`#start-video`.

### What stays byte-identical (DO NOT TOUCH)
- **game.js, jukebox.js, catalog.js logic** — zero edits. (Only their `?v=84`→`?v=85` query bumps
  in index.html, plus jukebox.css `?v=`.)
- `setLoading()` (game.js:790-794), `demoProvider()` (game.js:813+), `showScreen()`
  (game.js:186-197), `applyBgMode()` (game.js:958-970), `applyLevelTheme()` (index.html:3345).
- Loader DOM **IDs**: `loading`, `loading-ring`, `loading-stage`, `loading-msg`, `loading-pct`.
  The `#loading-ring` circle keeps `r="100"` / `stroke-dasharray="628"` / `stroke-dashoffset` math
  (circumference 2π·100≈628) — game.js drives `strokeDashoffset = 628*(1-pct/100)`.
- **gameplay / scoring / timing**: nothing touched. No flag needed (this is pure presentation).
- Brand: black · crimson `#ff1f2e` · ember `#ff7a4a` · gold `#e0a93f` · chrome `#dad7d2`; warm
  darks; NO blue/purple. Fonts Oxanium / Chakra Petch / JetBrains Mono.
- The existing static moon (`.lib::after` desktop `assets/moon.png`) and ambient glow
  (`.lib::before`) **remain in jukebox.css** — they are the deliberate fallback when the video is
  absent. We only lower their z-order under the new video and dim them slightly so the video reads
  as primary when present (CSS-only, no removal).

---

## 2) FLOW / IA (screens, steps, back-nav) — UNCHANGED

No screen graph change. For reference of where the pieces live:
- `#start` (active on boot) → tap → `#menu` (the library: `.lib` with `#view-jukebox` coverflow,
  `#view-browse`, `#view-songs`, `#view-credits`).
- Pick a song → jukebox.js `openSheet` (difficulty sheet) → `launchTrack` → `#loading` →
  `#countdown-screen` → `#game`.
- `#loading` is shown by game.js `demoProvider()`/`showScreen('loading')` while audio decodes +
  `analyzeBeats` runs; the ring fills 0→100%.

This package only restyles `#loading` and adds a backdrop layer inside `#menu`. Back-nav, screen
exclusivity (`showScreen`), and theme-clear all behave as before.

---

## 3) EXACT INTEGRATION STEPS

> Apply in order. Every anchor below is a **unique** existing string (verified by grep). After
> each edit: `node --check game.js` is N/A (no JS file edited except inline scripts — see §3.5),
> but run the structural greps in §7.

---

### 3.1 — REPLACE the loading-screen CSS block (the loader styles)

**FILE:** `index.html`
**ANCHOR (unique, replace the whole run from `/* ============ LOADING ============ */` through the
reduce-motion line at the end of the loader block):**

Find this exact opening line:
```
  /* ============ LOADING ============ */
```
and the loader block currently runs to (index.html:414):
```
  html.rr-reduce-motion .atom-spin, html.rr-reduce-motion .atom-core { animation: none; }
```

**REPLACE everything from `/* ============ LOADING ============ */` (line 360) through that
`html.rr-reduce-motion .atom-spin...` line (line 414) with the block below.** (It re-defines the
same selectors plus new ones; the old `.loading-glyph` styles are kept verbatim since unrelated
legacy markup may reference them — harmless.)

```css
  /* ============ LOADING ============ */
  .loading-wrap {
    display: flex; flex-direction: column; align-items: center; gap: 30px;
    font-family: 'JetBrains Mono', monospace;
    position: relative; z-index: 1;
  }
  /* legacy glyph (kept; unused by current markup but referenced defensively) */
  .loading-glyph { width: 120px; height: 120px; position: relative; }
  .loading-glyph::before, .loading-glyph::after {
    content: ''; position: absolute; inset: 0;
    border: 1px solid var(--crimson); animation: spin 4s linear infinite;
  }
  .loading-glyph::after { border-color: var(--cyan); animation-direction: reverse; animation-duration: 3s; inset: 15px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-glyph .core { position: absolute; inset: 40px; background: var(--crimson); box-shadow: 0 0 40px var(--crimson); animation: pulse 1s ease-in-out infinite; }

  .loading-text {
    font-family: 'Chakra Petch', monospace;
    font-size: 14px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink-dim);
    display: flex; align-items: baseline; gap: 0;
  }
  .loading-text .pct { color: var(--crimson); font-family: 'Oxanium', sans-serif; font-weight: 700; margin-left: 12px; }
  .loading-stage {
    font-family: 'Oxanium', sans-serif; font-size: 30px; font-weight: 800;
    letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink);
    text-shadow: 0 0 26px rgba(255,31,46,0.55);
  }

  /* ---- premium reactive-atom loader (crimson/ember energy core) ---- */
  .atom-loader {
    width: 220px; height: 220px; position: relative;
    filter: drop-shadow(0 0 38px rgba(255,31,46,0.30));
  }
  /* conic ember energy sweep behind the atom (GPU-cheap rotation of a masked ring) */
  .atom-loader::before {
    content: ''; position: absolute; inset: 4%; border-radius: 50%; pointer-events: none;
    background: conic-gradient(from 0deg,
      transparent 0deg, rgba(255,31,46,0.0) 40deg, rgba(255,122,74,0.55) 130deg,
      rgba(255,31,46,0.9) 168deg, rgba(255,122,74,0.55) 206deg, transparent 300deg, transparent 360deg);
    -webkit-mask: radial-gradient(circle, transparent 60%, #000 62%, #000 78%, transparent 82%);
    mask: radial-gradient(circle, transparent 60%, #000 62%, #000 78%, transparent 82%);
    animation: atom-sweep 2.6s linear infinite;
    opacity: 0.85;
  }
  @keyframes atom-sweep { to { transform: rotate(360deg); } }
  /* counter-rotating chrome outer hairline ring */
  .atom-loader::after {
    content: ''; position: absolute; inset: -2%; border-radius: 50%; pointer-events: none;
    border: 1px solid rgba(218,215,210,0.18);
    border-top-color: rgba(218,215,210,0.55); border-right-color: rgba(255,122,74,0.4);
    animation: atom-chrome 5.5s linear infinite reverse;
  }
  @keyframes atom-chrome { to { transform: rotate(360deg); } }

  .atom-svg { position: relative; z-index: 1; width: 100%; height: 100%; overflow: visible; }
  .atom-spin { transform-origin: 110px 110px; animation: atom-rot 14s linear infinite; }
  @keyframes atom-rot { to { transform: rotate(360deg); } }
  .atom-core { transform-origin: 110px 110px; animation: atom-core 1.05s ease-in-out infinite; }
  @keyframes atom-core {
    0%,100% { transform: scale(1);    filter: drop-shadow(0 0 7px rgba(255,31,46,0.75)); }
    50%     { transform: scale(1.2);  filter: drop-shadow(0 0 20px rgba(255,31,46,1)); }
  }
  #loading-ring {
    transition: stroke-dashoffset 0.25s ease;
    filter: drop-shadow(0 0 7px rgba(255,31,46,0.85)) drop-shadow(0 0 14px rgba(255,122,74,0.4));
  }

  /* equalizer pulse — 3 ember bars beneath the loader, "music is decoding" energy cue */
  .loading-eq { display: flex; align-items: flex-end; gap: 6px; height: 26px; margin-top: -8px; }
  .loading-eq i {
    width: 5px; height: 100%; border-radius: 3px;
    background: linear-gradient(180deg, var(--crimson), var(--gold));
    box-shadow: 0 0 10px rgba(255,31,46,0.55);
    transform-origin: bottom; animation: eqPulse 0.9s ease-in-out infinite;
  }
  .loading-eq i:nth-child(1) { animation-delay: 0s;     height: 60%; }
  .loading-eq i:nth-child(2) { animation-delay: 0.12s;  height: 100%; }
  .loading-eq i:nth-child(3) { animation-delay: 0.24s;  height: 75%; }
  .loading-eq i:nth-child(4) { animation-delay: 0.36s;  height: 92%; }
  .loading-eq i:nth-child(5) { animation-delay: 0.48s;  height: 55%; }
  @keyframes eqPulse { 0%,100% { transform: scaleY(0.35); opacity: 0.7; } 50% { transform: scaleY(1); opacity: 1; } }

  /* reduced-motion: freeze everything to a clean static frame (no spin/sweep/pulse/eq motion) */
  html.rr-reduce-motion .atom-spin,
  html.rr-reduce-motion .atom-core,
  html.rr-reduce-motion .atom-loader::before,
  html.rr-reduce-motion .atom-loader::after,
  html.rr-reduce-motion .loading-eq i { animation: none; }
  html.rr-reduce-motion .atom-loader::before { opacity: 0.45; }
  html.rr-reduce-motion .loading-eq i { transform: scaleY(0.7); opacity: 0.85; }
```

> Note: the existing `.atom-loader .atom-halo` rule (index.html:1741) and its reduce-motion line
> (1749) live in a **different** part of the stylesheet — leave them as-is; they layer fine with
> the new `::before`/`::after`. (The `<span class="atom-halo">` stays in the markup.)

---

### 3.2 — ADD the equalizer bars to the loading markup

**FILE:** `index.html`
**ANCHOR (unique):**
```
      <div class="loading-stage display" id="loading-stage">DECODING SIGNAL</div>
```
**INSERT-BEFORE** that line:
```html
      <div class="loading-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
```

(Result: atom loader → eq bars → DECODING SIGNAL stage → msg/pct row. The eq sits as a tasteful
energy strip between the atom and the stage label.)

---

### 3.3 — ADD the browse video backdrop layer + scrim inside `#menu`

**FILE:** `index.html`
**ANCHOR (unique — the menu screen open tag):**
```
  <div class="screen menu-screen" id="menu">
    <div class="lib">
```
**REPLACE** those two lines with (inserts the video layer as the FIRST child of `#menu`, before
`.lib`):
```html
  <div class="screen menu-screen" id="menu">
    <!-- FULL-BLEED LIBRARY BACKDROP — blood-moon Seedance loop behind the coverflow.
         Paints behind .lib (z-index:0). 404 / no-asset self-heals: this layer hides and the
         static .lib::after moon + .lib::before glow show through. Gated by ?novideo + rr-perf-bg
         exactly like #bg-video. -->
    <div id="lib-bg" aria-hidden="true">
      <video id="lib-video" src="assets/levels/browse-loop.mp4" autoplay loop muted playsinline preload="auto"></video>
      <div class="lib-bg-scrim"></div>
    </div>
    <div class="lib">
```

---

### 3.4 — ADD the browse backdrop CSS

**FILE:** `jukebox.css`
**ANCHOR (unique — the very first rule, the `.lib` block at top of file):**
```css
.lib {
  position: relative;
  width: 100%;
  max-width: 720px;
  height: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```
**INSERT-AFTER** that block:
```css
/* ===========================================================================
   FULL-BLEED LIBRARY VIDEO BACKDROP (#lib-bg) — blood-moon loop behind .lib.
   Self-heals: if #lib-video is absent/404, JS hides #lib-bg and the static
   .lib::after moon + .lib::before glow (kept below) become the backdrop.
   =========================================================================== */
#lib-bg {
  position: absolute; inset: 0; z-index: 0; overflow: hidden;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 0%, #160c0b, #0a0706 72%); /* instant warm fill under the video */
}
#lib-video {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; opacity: 0; transition: opacity 0.6s ease;
}
#lib-video.lib-video-on { opacity: 1; }   /* faded in by JS once it actually plays */
/* dark scrim keeps coverflow art + title/artist text legible over the video */
.lib-bg-scrim {
  position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(180deg, rgba(7,6,10,0.62) 0%, rgba(7,6,10,0.30) 24%, rgba(7,6,10,0.20) 50%, rgba(7,6,10,0.66) 86%, rgba(7,6,10,0.92) 100%),
    radial-gradient(ellipse at 50% 30%, transparent 42%, rgba(7,6,10,0.45) 100%);
}
/* the .lib content must sit ABOVE the backdrop */
.menu-screen .lib { position: relative; z-index: 1; }
/* honour the global perf/novideo gate (same mechanism as #bg-video/#start-video) */
html.rr-perf-bg #lib-video { display: none !important; }
/* when the video is live, dim the static moon so they don't double-up (still visible as fallback) */
.menu-screen.rr-libvid-on .lib::after { opacity: 0.18; }
.menu-screen.rr-libvid-on .lib::before { opacity: 0.55; }
@media (prefers-reduced-motion: reduce) {
  #lib-video { opacity: 0 !important; }   /* reduced motion: skip the moving video, use static moon */
}
html.rr-reduce-motion #lib-video { opacity: 0 !important; }
```

> The static `.lib::before` (jukebox.css:18) and desktop `.lib::after` moon (jukebox.css:471) are
> left **fully in place** — they are the fallback layer. We only dim them via the
> `.rr-libvid-on` class (added by JS only when the video truly plays). The `prefers-reduced-motion`
> and `rr-reduce-motion` rules force the static moon for motion-sensitive users.

---

### 3.5 — ADD the browse-video controller script (self-heal + perf gate + play/pause)

This is a small **self-contained inline IIFE** — no edit to game.js/jukebox.js logic. It:
mirrors the `?novideo` handling, respects `html.rr-perf-bg` (toggled by game.js `applyBgMode`),
self-heals on 404/`error`, fades the video in only once it plays, and **pauses the video when
`#menu` is not active** (perf — no decode cost during gameplay), play/pause driven by observing
the `.active` class on `#menu`.

**FILE:** `index.html`
**ANCHOR (unique — the existing `?novideo` diag block opening):**
```
<!-- ===========================================================================
     DIAG (test build): add ?novideo=1 to the URL to disable the moon VIDEO backdrop
```
**INSERT-BEFORE** that comment block, add:
```html
<!-- ===========================================================================
     LIBRARY BACKDROP CONTROLLER (#lib-video) — self-heal + perf gate + play/pause.
     Pure presentation; no gameplay. Self-contained; safe to delete.
     =========================================================================== */ -->
<script>
(function () {
  try {
    var bg  = document.getElementById('lib-bg');
    var vid = document.getElementById('lib-video');
    var menu = document.getElementById('menu');
    if (!bg || !vid || !menu) return;

    var killed = false;
    function fallback() {            // hide the video layer → static .lib moon shows through
      if (killed) return; killed = true;
      try { vid.pause(); } catch (e) {}
      vid.classList.remove('lib-video-on');
      menu.classList.remove('rr-libvid-on');
      bg.style.display = 'none';     // reveal .lib::after / .lib::before fallback
    }
    function blocked() {             // ?novideo or perf-bg or reduced motion → never play video
      try { if (/[?&]novideo=1/.test(location.search)) return true; } catch (e) {}
      if (document.documentElement.classList.contains('rr-perf-bg')) return true;
      if (document.documentElement.classList.contains('rr-reduce-motion')) return true;
      try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true; } catch (e) {}
      return false;
    }

    // 404 / decode failure → fallback to static moon
    vid.addEventListener('error', fallback);
    vid.addEventListener('stalled', function () { /* keep poster fill; no fallback on transient stall */ });
    // only fade in + dim the static moon once it's actually playing
    vid.addEventListener('playing', function () {
      if (killed) return;
      vid.classList.add('lib-video-on');
      menu.classList.add('rr-libvid-on');
    });

    function sync() {
      if (killed) return;
      if (blocked()) { try { vid.pause(); } catch (e) {} vid.classList.remove('lib-video-on'); menu.classList.remove('rr-libvid-on'); return; }
      // play only while the library is on-screen (perf: no decode during gameplay)
      if (menu.classList.contains('active')) { try { var p = vid.play(); if (p && p.catch) p.catch(function(){}); } catch (e) {} }
      else { try { vid.pause(); } catch (e) {} }
    }

    // react to screen changes (showScreen toggles .active on #menu)
    try {
      var mo = new MutationObserver(sync);
      mo.observe(menu, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
    // react to perf-bg toggle (game.js applyBgMode toggles html.rr-perf-bg)
    try {
      var mo2 = new MutationObserver(sync);
      mo2.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}

    if (blocked()) { try { vid.pause(); } catch (e) {} }
    sync();
  } catch (e) {}
})();
</script>
```

> Why an observer instead of a hook into showScreen: `showScreen` lives in game.js and we are
> NOT editing game.js. The MutationObserver on `#menu`'s class is a zero-touch way to start/stop
> the video with library visibility. It is cheap (fires only on class change).

---

### 3.6 — Extend the existing `?novideo` block to also kill the library video

**FILE:** `index.html`
**ANCHOR (unique):**
```
      document.querySelectorAll('#bg-video, #start-video').forEach(function (v) {
```
**REPLACE** with (adds `#lib-video` to the selector so `?novideo=1` also disables the new layer):
```
      document.querySelectorAll('#bg-video, #start-video, #lib-video').forEach(function (v) {
```

> The controller in §3.5 already treats `?novideo` as blocked, but extending this existing block
> keeps the single source of truth consistent and guarantees the element is paused/hidden even if
> the controller script is later stripped.

---

### 3.7 — Bump the cache-bust version (HARD CONSTRAINT — jukebox.css changed)

**FILE:** `index.html`
Four one-line replacements (`?v=84` → `?v=85`):

| Anchor (unique)                         | Replace with                          |
|-----------------------------------------|---------------------------------------|
| `<link rel="stylesheet" href="jukebox.css?v=84" />` | `<link rel="stylesheet" href="jukebox.css?v=85" />` |
| `<script src="game.js?v=84"></script>`   | `<script src="game.js?v=85"></script>`   |
| `<script src="jukebox.js?v=84"></script>`| `<script src="jukebox.js?v=85"></script>`|
| `<script src="catalog.js?v=84"></script>`| `<script src="catalog.js?v=85"></script>`|

> Only jukebox.css actually changed content; bumping all four keeps them in lockstep (existing
> convention in this repo — they're always equal). The start-screen version stamp reads game.js's
> `?v=` and will display **v85** automatically.

---

## 4) NEW HOOKS + WHERE THEY WIRE

| Hook | Type | Where it wires |
|------|------|----------------|
| `#lib-bg` | DOM (new) | first child of `#menu`; the backdrop container. |
| `#lib-video` | DOM (new) | the `<video>`; src `assets/levels/browse-loop.mp4`. Controlled by §3.5 script. |
| `.lib-bg-scrim` | DOM/CSS (new) | legibility scrim over the video. |
| `.lib-video-on` | CSS class on `#lib-video` | added by §3.5 on `playing` → fades video in. |
| `.rr-libvid-on` | CSS class on `#menu` | added by §3.5 on `playing` → dims static moon. Removed on fallback/pause. |
| `.loading-eq` + `<i>×5` | DOM/CSS (new) | equalizer bars in `#loading`; pure CSS animation. |
| `.atom-loader::before/::after` | CSS (new) | ember sweep + chrome ring; pure CSS. |
| `html.rr-perf-bg` | EXISTING (game.js:961) | §3.5 reads it + CSS `html.rr-perf-bg #lib-video{display:none}` hides the lib video in performance mode. **No game.js change** — we just consume the class it already sets. |
| `html.rr-reduce-motion` | EXISTING | freezes the loader + forces static moon for the lib backdrop. |
| `?novideo=1` | EXISTING flag | §3.6 extends it to `#lib-video`; §3.5 treats it as blocked. |

No new JS globals. `setLoading`/`demoProvider`/`showScreen`/`applyBgMode`/`applyLevelTheme`
unchanged. `#loading-ring`/`#loading-msg`/`#loading-pct`/`#loading-stage` IDs preserved.

---

## 5) ASSET GENERATION (Seedance) — prompt + exact save path + self-heal

The integrator CANNOT generate art this session. The code above **ships first** and self-heals:
if `assets/levels/browse-loop.mp4` is missing/404, `#lib-bg` hides itself and the existing static
`assets/moon.png` moon + crimson glow render exactly as today. When the asset agent drops the file
in, it lights up automatically (no code change).

### Asset 1 — Library blood-moon backdrop loop (REQUIRED for the video aesthetic)
- **Save path (EXACT):** `assets/levels/browse-loop.mp4`
- **Tool:** Seedance (image-to-video or text-to-video), 1080p+ landscape, **seamless loop**, ~8–12s,
  muted, dark/low-key so a scrim keeps text legible. H.264 mp4, target < 4 MB (mirrors
  skully-loop.mp4 ≈ 2.7 MB).
- **Seedance prompt (brand-correct — black/crimson/ember, NO blue/purple):**
  > A slow, hypnotic blood-moon over a black void. A massive deep-crimson moon hangs high,
  > faint ember sparks and warm cinder dust drifting upward across the frame. Thin volumetric
  > god-rays in crimson and ember-orange sweep gently. Far below, a dark silhouette horizon with a
  > subtle heat-haze shimmer. Color palette strictly black, crimson (#ff1f2e), ember orange
  > (#ff7a4a), and warm gold (#e0a93f) highlights — absolutely no blue or purple. Cinematic, moody,
  > premium music-app hero backdrop. Very slow drift, seamless loop, no text, no characters,
  > low-key exposure with deep blacks so foreground UI stays readable. Subtle film grain.
- **Negative / avoid:** text, watermark, logos, people, blue tint, purple tint, bright daylight,
  fast motion, hard cuts.
- **Why these specs:** the scrim (§3.4) darkens top/bottom; the moon should read in the upper-center
  (matches the static `.lib::after` placement `top:-7%`), so framing the moon high keeps continuity
  with the fallback.

### (Optional) Asset 2 — static poster fallback already exists
- `assets/moon.png` (already present) is the no-video fallback. No new poster needed. If the asset
  agent also wants a still poster for faster first-paint, save `assets/levels/browse-poster.jpg`
  (1920×1080, a single frame of the loop) and add `poster="assets/levels/browse-poster.jpg"` to the
  `<video>` tag in §3.3 — optional, not required.

---

## 6) LOVABLE BACKEND BRIEF

**None required.** This concern is 100% client-side presentation (index.html + jukebox.css). No API,
no schema, no backend store item. The video is a static asset served from `assets/levels/`.

---

## 7) VERIFY-OFFLINE (greps / structural / node-check) + RISKS

### Node check
- No standalone `.js` file is edited (only inline `<script>`s and CSS). Still run, as a smoke test
  that the repo's JS is intact: `node --check game.js && node --check jukebox.js && node --check catalog.js`.

### Structural greps (run from project root; all should match after integration)
```
# loader markup hooks PRESERVED (must still be exactly these 4 + ring math)
grep -n 'id="loading-ring"\|id="loading-msg"\|id="loading-pct"\|id="loading-stage"' index.html   # → 4 hits
grep -n 'stroke-dasharray="628"' index.html                                                       # → 1 hit (ring math intact)

# new loader pieces present
grep -n 'class="loading-eq"' index.html            # → 1 hit (eq bars added)
grep -n 'atom-loader::before\|atom-sweep\|loading-eq i' index.html   # → CSS present

# browse backdrop present
grep -n 'id="lib-bg"\|id="lib-video"\|lib-bg-scrim' index.html      # → 3 hits (markup)
grep -n '#lib-video\|#lib-bg\|rr-libvid-on' jukebox.css             # → CSS present
grep -n 'browse-loop.mp4' index.html                                # → 1 hit (src)

# ?novideo extended + perf gate consumed (NOT redefined)
grep -n "#bg-video, #start-video, #lib-video" index.html           # → 1 hit (extended selector)
grep -n 'rr-perf-bg #lib-video' jukebox.css                        # → 1 hit
grep -n "classList.add('rr-perf-bg')\|toggle('rr-perf-bg'" game.js  # → still only game.js:961 (we did NOT touch it)

# version bumped
grep -n '?v=85' index.html       # → 4 hits
grep -n '?v=84' index.html       # → 0 hits

# game.js logic untouched (these must be unchanged)
grep -n 'function setLoading' game.js     # → game.js:790 unchanged
grep -n 'function showScreen' game.js     # → game.js:186 unchanged
```

### Preview runtime test (integrator)
1. `location.replace('/index.html?cb='+Date.now())` — tap start → library. Confirm `#lib-video`
   plays (or, with no asset, `#lib-bg` is `display:none` and the static moon shows). Coverflow +
   title text must stay legible over the video (scrim working).
2. `?novideo=1` → `#lib-video` hidden, static moon visible, no console errors.
3. Settings → Performance background (sets `bgMode:'performance'` → `html.rr-perf-bg`): confirm
   `#lib-video` hides (CSS `display:none`) and the controller pauses it.
4. Pick a song → `#loading` shows: atom spins, ember sweep + chrome ring rotate, eq bars pulse,
   `#loading-ring` fills as pct climbs, `#loading-msg`/`#loading-pct`/`#loading-stage` update —
   confirming game.js `setLoading()` still drives the (unchanged) hooks.
5. Toggle reduce motion (`document.documentElement.classList.add('rr-reduce-motion')`): loader
   freezes (no spin/sweep/eq), and the lib video stops (static moon). No motion.
6. `mcp__Claude_Preview__preview_console_logs` (level error) at the end → expect none.

### RISKS / COLLISIONS
- **Collision risk — `applyBgMode` adds `#lib-video`?** No. game.js `applyBgMode` only touches
  `['bg-video','start-video']` (game.js:962). The lib video is NOT in that list, so it is governed
  solely by the CSS `html.rr-perf-bg #lib-video{display:none}` rule + our controller. This is
  intentional (zero game.js edits). If a later integrator wants the lib video to also pause via
  `applyBgMode`, that's a separate game.js change — out of scope here.
- **z-index:** `#lib-bg` is z-index 0; `.menu-screen .lib` forced to z-index 1; the global
  `body::before` grain/vignette is z-index 1000 (unaffected). Header `.lib-bar` is z-index 5
  *within* `.lib`'s stacking context — fine. No new stacking conflicts.
- **Autoplay:** muted + playsinline → autoplay-allowed on Chrome/mobile. The `playing` listener
  (not `autoplay` assumption) gates the fade-in, so a blocked autoplay just leaves the warm
  `#lib-bg` fill until the user interacts (they already tapped Start to reach the library, so the
  page has a user gesture — autoplay will succeed).
- **Loader `.atom-halo`:** untouched legacy rule still applies on top of the new `::before`/`::after`
  — verified visually compatible (halo is a faint radial; sweep is a masked conic). No conflict.
- **Reduced-motion double-guard:** both the CSS media query and `html.rr-reduce-motion` force the
  static moon; the controller also treats both as `blocked()`. Triple-safe.
- **Mobile:** `.lib::after` moon is desktop-only (`@media min-width:901px`), but `#lib-video` is
  full-bleed at all sizes and `.lib::before` glow exists at all sizes — so on mobile the fallback
  (if video absent) is the crimson glow + warm `#lib-bg` gradient (no jarring void). Acceptable.
- **Perf:** one extra `<video>` decode while the library is on-screen only (paused during gameplay
  via the observer, and hidden in performance mode). Mirrors the cost profile of `#start-video`.
```
