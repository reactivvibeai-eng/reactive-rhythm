# _build7_loading — FINAL, ready-to-apply: premium on-brand LOADING animation

Concern: replace the basic loading symbol with a premium, on-brand animated loader on
`#loading` — a crimson/ember energy ring + igniting-atom + equalizer pulse with an Oxanium
label. Pure CSS/SVG (no new asset). `reduceMotion`-safe (static fallback). Re-anchored from
`_build6_polish.md` §3.1/§3.2 against the **CURRENT v84 `index.html`** (the design's line
numbers had drifted; these anchors are verified against the live file on disk).

SCOPE GUARD: This artifact touches **only `index.html`** — the `#loading` screen CSS block and
the loading markup. It does **NOT** touch `#menu` / `.lib` / the browse video backdrop
(`#lib-bg`, `browse-loop.mp4`) — the integrator wires that directly, so we avoid the
index.html collision the brief warned about. (`_build6_polish.md` §3.3/§3.4 are intentionally
NOT carried over here.)

GAMEPLAY: byte-identical. No JS, no engine code, no game.js/jukebox.js/catalog.js/jukebox.css
edits → **no `?v=NN` bump required.** The four JS-driven hooks `#loading-ring`, `#loading-msg`,
`#loading-pct`, `#loading-stage` and the SVG ring math (`r="100"`, `stroke-dasharray="628"`,
`stroke-dashoffset`) are preserved exactly, so `setLoading()` / `demoProvider()` in game.js stay
wired with zero changes.

ASSET CHECK (verified on disk): **none needed** — loader is pure CSS + the existing inline SVG.
No `assets/*` reference is introduced, so there is nothing to 404 and no self-heal layer needed
here. (The atom SVG, `linearGradient#rr-wood`, `filter#rr-glow`, and `<span class="atom-halo">`
already exist in the current markup and are reused.)

reduceMotion is honoured two ways, both already in the codebase:
  1. `html.rr-reduce-motion` — toggled by `applyReduceMotion()` (game.js:954) from the Settings
     reduce-motion control. Existing rule at index.html:455 only froze `.atom-spin`/`.atom-core`;
     this artifact extends it to freeze the new sweep/chrome/eq layers too.
  2. `@media (prefers-reduced-motion: reduce)` — OS-level fallback (covers users who never opened
     Settings). Both collapse to a clean, legible STATIC frame.

---

## PATCH 1 of 2 — REPLACE the loading-screen CSS block

**FILE:** `D:/sunoai music plan/animev1/veo 3 round 2/can i pet that dog/cloudcode/v2/index.html`

**OPERATION:** REPLACE (exact, unique).

**ANCHOR — find this exact contiguous block** (currently index.html lines 401–455; it begins at
the `/* ============ LOADING ============ */` comment and ends at the `rr-reduce-motion .atom-spin`
line — this exact run is unique in the file):

```css
  /* ============ LOADING ============ */
  .loading-wrap {
    display: flex; flex-direction: column; align-items: center; gap: 32px;
    font-family: 'JetBrains Mono', monospace;
  }
  .loading-glyph {
    width: 120px; height: 120px;
    position: relative;
  }
  .loading-glyph::before, .loading-glyph::after {
    content: ''; position: absolute; inset: 0;
    border: 1px solid var(--crimson);
    animation: spin 4s linear infinite;
  }
  .loading-glyph::after { border-color: var(--cyan); animation-direction: reverse; animation-duration: 3s; inset: 15px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-glyph .core {
    position: absolute; inset: 40px;
    background: var(--crimson);
    box-shadow: 0 0 40px var(--crimson);
    animation: pulse 1s ease-in-out infinite;
  }
  .loading-text {
    font-size: 14px;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }
  .loading-text .pct { color: var(--cyan); margin-left: 12px; }
  .loading-stage {
    font-family: 'Oxanium', sans-serif;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink);
    text-shadow: 0 0 26px rgba(255,42,48,0.5);
  }
  /* ---- reactive-atom loader ---- */
  .atom-loader {
    width: 210px; height: 210px; position: relative;
    filter: drop-shadow(0 0 34px rgba(255,42,48,0.28));
  }
  .atom-svg { width: 100%; height: 100%; overflow: visible; }
  .atom-spin { transform-origin: 110px 110px; animation: atom-rot 16s linear infinite; }
  @keyframes atom-rot { to { transform: rotate(360deg); } }
  .atom-core { transform-origin: 110px 110px; animation: atom-core 1.05s ease-in-out infinite; }
  @keyframes atom-core {
    0%,100% { transform: scale(1);    filter: drop-shadow(0 0 6px rgba(255,42,48,0.7)); }
    50%     { transform: scale(1.18); filter: drop-shadow(0 0 18px rgba(255,42,48,1)); }
  }
  #loading-ring { transition: stroke-dashoffset 0.25s ease; filter: drop-shadow(0 0 6px rgba(255,42,48,0.8)); }
  .loading-text { font-family: 'Chakra Petch', monospace; }
  .loading-text .pct { color: var(--crimson); font-family: 'Oxanium', sans-serif; font-weight: 700; }
  html.rr-reduce-motion .atom-spin, html.rr-reduce-motion .atom-core { animation: none; }
```

**REPLACE WITH (drop-in, full):**

```css
  /* ============ LOADING ============ */
  .loading-wrap {
    display: flex; flex-direction: column; align-items: center; gap: 30px;
    font-family: 'JetBrains Mono', monospace;
    position: relative; z-index: 1;
  }
  /* legacy glyph (kept verbatim — current markup doesn't use it, but referenced defensively) */
  .loading-glyph {
    width: 120px; height: 120px;
    position: relative;
  }
  .loading-glyph::before, .loading-glyph::after {
    content: ''; position: absolute; inset: 0;
    border: 1px solid var(--crimson);
    animation: spin 4s linear infinite;
  }
  .loading-glyph::after { border-color: var(--cyan); animation-direction: reverse; animation-duration: 3s; inset: 15px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-glyph .core {
    position: absolute; inset: 40px;
    background: var(--crimson);
    box-shadow: 0 0 40px var(--crimson);
    animation: pulse 1s ease-in-out infinite;
  }
  .loading-text {
    font-family: 'Chakra Petch', monospace;
    font-size: 14px;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--ink-dim);
    display: flex; align-items: baseline; gap: 0;
  }
  .loading-text .pct { color: var(--crimson); font-family: 'Oxanium', sans-serif; font-weight: 700; margin-left: 12px; }
  .loading-stage {
    font-family: 'Oxanium', sans-serif;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink);
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
  /* counter-rotating chrome outer hairline ring (warm-tinted, no blue/purple) */
  .atom-loader::after {
    content: ''; position: absolute; inset: -2%; border-radius: 50%; pointer-events: none;
    border: 1px solid rgba(218,215,210,0.18);
    border-top-color: rgba(218,215,210,0.55); border-right-color: rgba(255,122,74,0.40);
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

  /* equalizer pulse — 5 ember/gold bars beneath the loader, "music is decoding" energy cue */
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

  /* reduced-motion (Settings toggle): freeze to a clean static frame, no spin/sweep/pulse/eq */
  html.rr-reduce-motion .atom-spin,
  html.rr-reduce-motion .atom-core,
  html.rr-reduce-motion .atom-loader::before,
  html.rr-reduce-motion .atom-loader::after,
  html.rr-reduce-motion .loading-eq i { animation: none; }
  html.rr-reduce-motion .atom-loader::before { opacity: 0.45; }
  html.rr-reduce-motion .loading-eq i { transform: scaleY(0.7); opacity: 0.85; }

  /* reduced-motion (OS-level): same static frame for users who never opened Settings */
  @media (prefers-reduced-motion: reduce) {
    .atom-spin, .atom-core,
    .atom-loader::before, .atom-loader::after,
    .loading-eq i,
    .atom-loader .atom-halo { animation: none !important; }
    .atom-loader::before { opacity: 0.45; }
    .loading-eq i { transform: scaleY(0.7); opacity: 0.85; }
  }
```

> NOTE: the existing `.atom-loader .atom-halo` rule (index.html:1782) and its
> `html.rr-reduce-motion` line (1790) live elsewhere in the stylesheet — **leave them as-is.**
> They layer fine under the new `::before`/`::after`. The `@media (prefers-reduced-motion)` block
> above also covers `.atom-halo` so the OS-level path freezes it too.
>
> COLOR / BRAND: all values are black/crimson `#ff1f2e` (rgba 255,31,46) / ember `#ff7a4a`
> (rgba 255,122,74) / gold `var(--gold)` `#e0a93f` / chrome `#dad7d2` (rgba 218,215,210). No
> blue/purple. The previous block mixed `#ff2a30`; this normalizes to the brand crimson `#ff1f2e`.

---

## PATCH 2 of 2 — ADD the equalizer bars to the loading markup

**FILE:** `D:/sunoai music plan/animev1/veo 3 round 2/can i pet that dog/cloudcode/v2/index.html`

**OPERATION:** INSERT-BEFORE (anchor is unique — index.html:2834).

**ANCHOR (exact, unique line):**
```html
      <div class="loading-stage display" id="loading-stage">DECODING SIGNAL</div>
```

**INSERT this line immediately BEFORE the anchor** (so the order becomes:
atom loader → eq strip → DECODING SIGNAL stage → msg/pct row):
```html
      <div class="loading-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
```

Result (markup, for reference — do not retype, just confirm shape):
```html
      </div>
      <div class="loading-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="loading-stage display" id="loading-stage">DECODING SIGNAL</div>
      <div class="loading-text">
        <span id="loading-msg">Awakening ECH0</span>
        <span class="pct" id="loading-pct">0%</span>
      </div>
```

---

## VERIFY CHECKLIST

**A. Structural greps (run from project root; expected counts noted):**
```
grep -n 'class="loading-eq"' index.html                       # → 1 hit (new eq strip in markup)
grep -n 'atom-loader::before\|atom-sweep\|atom-chrome\|loading-eq i' index.html
                                                              # → CSS present (sweep + chrome + eq)
grep -n 'id="loading-ring"\|id="loading-msg"\|id="loading-pct"\|id="loading-stage"' index.html
                                                              # → 4 hits (JS hooks preserved)
grep -n 'stroke-dasharray="628"\|stroke-dashoffset="628"' index.html   # → 1 line (ring math intact)
grep -n 'function setLoading' game.js                         # → present, UNCHANGED
grep -n 'prefers-reduced-motion: reduce' index.html           # → ≥1 (OS reduced-motion path added)
```
Sanity (no collateral): `?v=` lines (index.html:14, 3220, 3221, 3222) stay at `?v=84` — **no
JS/CSS external file changed, so do NOT bump.** No `assets/` path was introduced.

**B. Brand guard (must be empty — no blue/purple in the loader):**
```
grep -n 'atom-loader\|loading-eq\|loading-ring' index.html | grep -Ei '#[0-9a-f]*(ff|cc|aa)[0-9a-f]*\b' | grep -Ei 'blue|purple'   # → no hits
```
(All loader colors are warm: crimson 255,31,46 / ember 255,122,74 / gold #e0a93f / chrome 218,215,210.)

**C. Claude_Preview headless runtime test:**
1. `preview_start` (name `rhythm-rift`), navigate with a cache-bust:
   `location.href = '/index.html?cb=' + Date.now()` (do NOT use location.replace — it hangs).
2. Force-show the loader without a full song decode:
   `document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById('loading').classList.add('active');`
3. Read computed styles to confirm the new layers animate:
   - `getComputedStyle(document.querySelector('.atom-loader'),'::before').animationName` → `atom-sweep`
   - `getComputedStyle(document.querySelector('.atom-loader'),'::after').animationName`  → `atom-chrome`
   - `document.querySelectorAll('.loading-eq i').length` → `5`
   - `getComputedStyle(document.querySelector('.loading-eq i')).animationName` → `eqPulse`
4. Drive the ring via the live hook to prove game.js wiring is intact:
   `document.getElementById('loading-pct').textContent='55%'; document.getElementById('loading-ring').setAttribute('stroke-dashoffset', 628*(1-0.55));`
   → ring visibly fills; pct text updates.
5. reduceMotion check: `document.documentElement.classList.add('rr-reduce-motion');` then re-read
   `getComputedStyle(document.querySelector('.loading-eq i')).animationName` → `none` (static frame).
6. `preview_console_logs` level=error → expect **0 errors**.

---

## SUMMARY (4 lines)
1. Final, exact patch (index.html ONLY): PATCH 1 replaces the LOADING CSS block (401–455) with a premium crimson/ember loader — conic energy sweep (`atom-sweep`) + counter-rotating chrome ring (`atom-chrome`) + glowing progress ring + 5-bar `eqPulse` equalizer; PATCH 2 inserts the `.loading-eq` strip before `#loading-stage` (2834).
2. Pure CSS/SVG, no new asset (reuses the existing atom SVG/halo); reduceMotion-safe via BOTH `html.rr-reduce-motion` (Settings) and `@media (prefers-reduced-motion)` (OS) → clean static frame.
3. Gameplay byte-identical; JS hooks `#loading-ring`/`#loading-msg`/`#loading-pct`/`#loading-stage` + ring math (628) preserved, so `setLoading()`/`demoProvider()` stay wired — no JS edited, so NO `?v=` bump; deliberately does NOT touch `#menu`/browse video (integrator owns that).
4. Anchors re-verified against the live v84 file (design's line numbers had drifted ~360→401); brand-locked warm colors only (crimson #ff1f2e / ember #ff7a4a / gold #e0a93f / chrome #dad7d2), no blue/purple; verify = greps + Claude_Preview computed-style/animationName checks.
