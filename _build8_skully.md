# _build8_skully.md — Skully "The World" level visual overhaul (the TEMPLATE)

> Branch `visual-overhaul`, currently **v87**. Reference level = AUTHORED `frac-01` "The World"
> (theme `violet`, Skullyrae / Lil' Clay). Goal: make this level read **CRISP + fully themed**
> as the per-level reference. Standard 6-string + gh 5-string **gameplay/scoring/timing
> BYTE-IDENTICAL** — every change here is presentation-only and either scoped to the active
> violet level or gated behind the existing `levelAccentRGB` / `_levelSkinActive` state.
>
> **Integrator:** apply serially, preview-test after each PART, then bump `?v=NN` **once** at the end.
> Files touched: `game.js`, `index.html`. Do NOT bump `?v` per-part.
>
> All anchors below are **exact current text** from the live files (verified at v87). Each patch
> gives FILE → unique ANCHOR → action (REPLACE / INSERT-AFTER / INSERT-BEFORE) → exact code.

---

## TL;DR — what this patch does
1. **Guitar fix:** the ENV-picker synthetic level dropped `guitarSkin`, so `setGuitarSkin` never
   fired on that path. `envFromAuthored()` + `applyEnvironment()`'s synthetic now copy `guitarSkin`,
   so the violet guitar shows whether launched via campaign **or** the environment picker.
2. **Kill the purple wash:** drop `.bg-accent` violet opacity `0.62 → 0.12`, lower the base accent
   `0.5 → 0.14`, cut `drawLevelAmbient` violet fog/embers strength (and the IIFE passes `_amb 0.8 → 0.34`
   for violet), and lighten the themed scanline. Backdrop video + neck read clear, not muddy.
3. **Reactive cards up:** DEATH (left) / WORLD (right) move from the low corners to **flank the
   upper-mid playfield** (necromancer's hands), bigger and clearly in view; fate-meter fill behavior kept.
4. **Per-level theming:** note **gems recolor to violet** (cached tinted sprite, swapped by a new
   `setLevelGemTint` engine hook), plus the existing scoped CSS already themes meters/combo/HUD —
   we tighten it so the WHOLE level reads as hers, crisply.
5. **Combo → video switch:** at a combo milestone / overdrive the engine fires `RhythmLevelFx.onCombo`;
   the IIFE swaps `#bg-video` to `assets/levels/skully-intense.mp4` for a dopamine spike, then eases
   back to the normal loop. **Self-heals** to the normal loop if the intense file is absent.

---

## CONSTRAINTS / DECISIONS (read before applying)

- **Guitar geometry constraint (documented, safe path taken).** The skin layer (`game.js`
  ~413-456) is an **image-only swap**: it changes `activeGuitarImg` but NEVER touches geometry —
  notes/strings/catchers keep riding `ART.nutXF` / `ART.bridgeXF` from the lane profile. The skin
  art must therefore **share the active profile's silhouette + string x-positions**.
  `assets/guitars/violet-gothic.png` is a geometry-matched recolor of `assets/guitar.png` (the
  standard 6-string). So: in **standard 6-string** the violet guitar aligns perfectly. In **gh
  5-string** the cover-fit + 5-string spacing differ from the 6-string silhouette, so a 6-string
  recolor will visually mismatch. **Safe path (this patch):** load the skin in BOTH modes but keep
  notes on `ART.nutXF/bridgeXF` (already how it works — we change nothing in the draw geometry).
  The skin is purely cosmetic and self-heals on 404. If/when a 5-string violet guitar art ships
  (`assets/guitars/violet-gothic-5.png`), the level can point `guitarSkin` at it; no code change
  needed here. **We do not gate the skin off in gh** — a recolor is still on-brand and the 404
  self-heal covers a missing file; the only cost is silhouette mismatch in gh, which is acceptable
  for the reference level and documented here.

- **Gem tint approach = cached recolor, not an additive wash.** Additive violet over the crimson
  gem PNG is exactly what makes the board muddy. Instead we build a **one-time tinted copy** of the
  note sprite (`source-atop` violet fill over the existing art) and swap `drawNote` to it while the
  level's gem-tint is active. Crisp, cheap (built once, cached), and reduceMotion/fxLite-agnostic
  (it's just which image we blit). Scoring/hit-detection untouched.

- **Engine ↔ DOM seam.** The bg-video is owned by the index.html LEVELS IIFE (`applyLevelTheme` /
  `clearLevelTheme` do all `#bg-video` src swaps). The engine already calls
  `window.RhythmLevelFx.onHit/onMiss` (game.js 1603 / 1663) which the IIFE installs in
  `showReactive`. We extend that same proven seam with **`onCombo`** rather than reaching into the
  DOM from the engine.

- **Asset notes / self-heal:**
  - `assets/guitars/violet-gothic.png` — **EXISTS** (verified).
  - `assets/levels/skully-loop.mp4` — **EXISTS** (the normal level loop).
  - `assets/levels/skully-intense.mp4` — **MAY BE ABSENT** (being generated). The combo-video swap
    sets `<video>.onerror` to revert to the saved loop, so a 404 silently keeps the normal loop —
    no broken state. If you (Ryan) generate it: a ~6-10s seamless loop, **more intense** Skullyrae
    energy (faster necro-violet motion, more particles/lightning), same framing/scrim-friendly as
    `skully-loop.mp4`, muted, H.264 mp4. Drop it at `assets/levels/skully-intense.mp4`.

---

# PART 1 — GUITAR FIX (env path copies guitarSkin)

### 1A · `index.html` — `envFromAuthored()` must carry `guitarSkin`

**ANCHOR (exact current text):**
```js
    function envFromAuthored(L) {
      return {
        id: L.id, name: L.title, tier: L.tier, theme: L.theme || 'crimson',
        accent: ENV_ACCENT_HEX[L.theme] || '#ff1f2e',
        cover: L.cover || '', bgArt: L.bgArt || '', bgVideo: L.bgVideo || '',
        reactiveCards: L.reactiveCards || null, boss: !!L.boss,
        paid: !!(L.unlock && L.unlock.entitlement)
      };
    }
```
**ACTION:** REPLACE the whole block with (adds `guitarSkin`):
```js
    function envFromAuthored(L) {
      return {
        id: L.id, name: L.title, tier: L.tier, theme: L.theme || 'crimson',
        accent: ENV_ACCENT_HEX[L.theme] || '#ff1f2e',
        cover: L.cover || '', bgArt: L.bgArt || '', bgVideo: L.bgVideo || '',
        guitarSkin: L.guitarSkin || '',                 // build8: carry per-level guitar onto the env path (was dropped → skin never fired)
        reactiveCards: L.reactiveCards || null, boss: !!L.boss,
        paid: !!(L.unlock && L.unlock.entitlement)
      };
    }
```

### 1B · `index.html` — `applyEnvironment()` synthetic level must include `guitarSkin`

**ANCHOR (exact current text):**
```js
      var synthetic = { id: 'env:' + e.id, title: e.name, tier: e.tier || 'medium', theme: e.theme,
        cover: e.cover, bgArt: e.bgArt, bgVideo: e.bgVideo, reactiveCards: e.reactiveCards, boss: false, _isEnv: true };
```
**ACTION:** REPLACE with (adds `guitarSkin: e.guitarSkin`):
```js
      var synthetic = { id: 'env:' + e.id, title: e.name, tier: e.tier || 'medium', theme: e.theme,
        cover: e.cover, bgArt: e.bgArt, bgVideo: e.bgVideo, guitarSkin: e.guitarSkin || '', reactiveCards: e.reactiveCards, boss: false, _isEnv: true };
```

> **Result:** `applyLevelTheme(synthetic)` (already called at the line right below the anchor) reaches
> its existing `setGuitarSkin(L && L.guitarSkin ? L.guitarSkin : null)` call (index.html ~3861) with a
> real path, so the violet guitar now loads on the env-picker path too — matching the campaign
> `launchLevel` path. No change needed at the `setGuitarSkin` call site itself.

---

# PART 2 — KILL THE PURPLE WASH

### 2A · `index.html` CSS — drop `.bg-accent` opacities (the redundant violet wash)

**ANCHOR (exact current text):**
```css
  /* per-level accent glow across the FULL backdrop (only when a level theme is active) */
  #game.rr-lvl-themed #game-bg .bg-accent { opacity: 0.5; }
  /* violet/gothic (Skully) reads stronger behind the guitar than the lighter accents */
  #game.rr-lvl-themed[data-rrtheme="violet"] #game-bg .bg-accent { opacity: 0.62; }
```
**ACTION:** REPLACE with (the Skully video is already violet — this wash was double-tinting):
```css
  /* per-level accent glow across the FULL backdrop (only when a level theme is active).
     build8: dialed WAY down — the wash was muddying the board. Light hues stay subtle. */
  #game.rr-lvl-themed #game-bg .bg-accent { opacity: 0.14; }
  /* violet/gothic (Skully): the backdrop video is ALREADY violet, so the redundant wash is nearly off */
  #game.rr-lvl-themed[data-rrtheme="violet"] #game-bg .bg-accent { opacity: 0.10; }
```

### 2B · `index.html` CSS — lighten the themed scanline

**ANCHOR (exact current text):**
```css
  /* the faint full-screen scanline texture picks up a hint of the accent (kept very low alpha) */
  #game.rr-lvl-themed.game-screen::after {
    background: repeating-linear-gradient(0deg,
      color-mix(in srgb, var(--rr-acc) 30%, rgba(150,35,35,0.045)) 0,
      color-mix(in srgb, var(--rr-acc) 30%, rgba(150,35,35,0.045)) 1px,
      transparent 1px, transparent 3px);
  }
```
**ACTION:** REPLACE with (lower accent share + lower base alpha, wider gap → lighter texture):
```css
  /* the faint full-screen scanline texture picks up a hint of the accent (kept very low alpha).
     build8: lighter — less accent share, lower alpha, wider gap so the neck reads crisp. */
  #game.rr-lvl-themed.game-screen::after {
    background: repeating-linear-gradient(0deg,
      color-mix(in srgb, var(--rr-acc) 16%, rgba(150,35,35,0.025)) 0,
      color-mix(in srgb, var(--rr-acc) 16%, rgba(150,35,35,0.025)) 1px,
      transparent 1px, transparent 4px);
  }
```

### 2C · `index.html` JS — `applyLevelTheme` passes a lower ambient strength for violet

**ANCHOR (exact current text):**
```js
        // violet/gothic (Skully) gets a richer ambient; chrome/gold are subtler (light hues read as haze)
        var _amb = (L.theme === 'violet') ? 0.8 : (L.theme === 'chrome' ? 0.35 : 0.55);
```
**ACTION:** REPLACE with (violet ambient cut hard — the video already carries the mood):
```js
        // build8: violet ambient cut HARD (the Skully video already carries the violet mood; the fog was muddying the board)
        var _amb = (L.theme === 'violet') ? 0.30 : (L.theme === 'chrome' ? 0.30 : 0.45);
```

### 2D · `game.js` — `drawLevelAmbient` fog + embers greatly reduced

**ANCHOR (exact current text):**
```js
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
```
**ACTION:** REPLACE the whole block with (fog ~half + lower ceiling; embers ~half count + dimmer):
```js
    // 1) low accent fog rising off the bottom third (cheap, big-read color)
    //    build8: greatly reduced — was washing the board purple. Floor lowered, ceiling halved.
    {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fg = ctx.createLinearGradient(0, ch, 0, ch * 0.62);
      fg.addColorStop(0, 'rgba(' + A + ',' + (0.018 + inten * 0.045).toFixed(3) + ')');
      fg.addColorStop(1, 'rgba(' + A + ',0)');
      ctx.fillStyle = fg; ctx.fillRect(0, ch * 0.62, cw, ch * 0.38);
      ctx.restore();
    }
    // 2) drifting accent embers — count + glow scale with intensity (mirrors the crimson ember pass)
    //    build8: ~half the count and dimmer so they sparkle instead of fogging.
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const n = 4 + Math.floor(energy * 7 * levelAmbient);
    for (let i = 0; i < n; i++) {
      const seed = i * 91.7;
      const x = (Math.sin(seed * 1.3) * 0.5 + 0.5) * cw;
      const prog = ((t * (0.03 + (i % 4) * 0.01) + (seed % 1)) % 1);
      const y = ch * (0.96 - prog * 0.78);
      const sz = (0.6 + (i % 3) * 0.7) * (1 + energy * 0.8);
      const a = (0.05 + inten * 0.16) * (1 - prog);
      ctx.fillStyle = 'rgba(' + A + ',' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x + Math.sin(t * 0.9 + i) * 7, y, sz, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
```

> Note: `drawLevelAmbient` already early-returns on `reduceMotion || fxLite` and when there's no
> accent — Quick Play and low-FX stay untouched.

---

# PART 3 — REACTIVE CARDS MOVE UP

### 3 · `index.html` CSS — reposition + enlarge DEATH / WORLD to flank the upper-mid playfield

**ANCHOR (exact current text):**
```css
  /* Cards sit LOW, flanking the guitar bridge (closer in, clearly in view), and FILL UP like fate
     meters: DEATH charges with misses, THE WORLD charges with hits. */
  .rc-card {
    position: absolute; bottom: 9vh;
    width: min(11vw, 138px); aspect-ratio: 2 / 3; border-radius: 13px; overflow: hidden;
    background-size: cover; background-position: center; background-color: #0a0706;
    opacity: 0.6; filter: grayscale(0.32) brightness(0.62);
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 10px 34px rgba(0,0,0,0.5);
    transition: opacity 0.4s ease, filter 0.4s ease, box-shadow 0.4s ease, border-color 0.4s ease;
  }
  .rc-death { left: 16vw; }
  .rc-world { right: 16vw; }
```
**ACTION:** REPLACE the whole block with (cards rise to mid-playfield via `top`, bigger, pulled toward the neck):
```css
  /* build8: cards FLANK THE UPPER-MID PLAYFIELD (where the necromancer's hands are), bigger and
     clearly in view — not the bottom corners. Vertically centered on the mid-neck via `top`; they
     still FILL UP like fate meters: DEATH charges with misses, THE WORLD charges with hits. */
  .rc-card {
    position: absolute; top: 30vh;
    width: min(14vw, 178px); aspect-ratio: 2 / 3; border-radius: 13px; overflow: hidden;
    background-size: cover; background-position: center; background-color: #0a0706;
    opacity: 0.62; filter: grayscale(0.30) brightness(0.66);
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 10px 34px rgba(0,0,0,0.5);
    transition: opacity 0.4s ease, filter 0.4s ease, box-shadow 0.4s ease, border-color 0.4s ease;
  }
  .rc-death { left: 19vw; }
  .rc-world { right: 19vw; }
```

**ALSO** update the mobile breakpoint so small screens keep the cards visible and out of the HUD.

**ANCHOR (exact current text):**
```css
  @media (max-width: 900px) { .rc-card { width: 76px; bottom: 6vh; } .rc-death { left: 8px; } .rc-world { right: 8px; } }
```
**ACTION:** REPLACE with:
```css
  @media (max-width: 900px) { .rc-card { width: 84px; top: 24vh; } .rc-death { left: 6px; } .rc-world { right: 6px; } }
```

> The fill meter (`.rc-fill` height-driven by `--fill`), the `.charged` brighten, and the
> `rc-flash` pop are all unchanged — only position/size move. `showReactive`'s fate-meter closure
> (index.html ~3912-3919) is untouched, so DEATH-on-miss / WORLD-on-hit fill behavior is identical.

---

# PART 4 — PER-LEVEL THEMING (violet gem marbles + tightened HUD)

The scoped CSS at `#game.rr-lvl-themed[data-rrtheme="violet"]` already retints meters (progress /
stability), the combo/score crimson readouts, the judge bar, side HUD panels, and corner brackets
(index.html 853-909). Those stay. The missing piece is the **note gems themselves** (drawn on the
canvas from a crimson PNG) — they still read crimson. This part adds a violet gem variant.

### 4A · `game.js` — add a level gem-tint hook + cached tinted sprite

**ANCHOR (exact current text):** (the gem-aura comment + `setLevelAccent` declaration block — we
insert our new state + helper right after the `setLevelAccent` definition closes)
```js
    levelAmbient = levelAccentRGB ? (typeof amb === 'number' ? Math.max(0, Math.min(1, amb)) : 0.6) : 0;
  };
  window.RhythmGame.lastResults = () => _lastResults;
```
**ACTION:** INSERT-AFTER the `};` that closes `setLevelAccent` (i.e. between that `};` and the
`window.RhythmGame.lastResults` line):
```js
  // build8: per-level GEM TINT — recolor the note marbles to the level identity (e.g. Skully violet).
  // Crisp cached recolor (NOT an additive wash, which muddies). Built once per hex, swapped in drawNote.
  // Presentation only; pass falsy to clear (back to the crimson default sprite).
  let levelGemHex = null;                 // e.g. '#a64dff' while a level wants tinted gems, else null
  const _gemTintCache = {};               // hex -> { normal: <canvas|null>, star: <canvas|null> }
  function _buildTintedGem(srcImg, hex) {
    if (!srcImg || !srcImg._ready || !srcImg.width) return null;
    const c = document.createElement('canvas'); c.width = srcImg.width; c.height = srcImg.height;
    const x = c.getContext('2d');
    x.drawImage(srcImg, 0, 0);
    // keep the marble's shading/AA but push its hue to the level color: multiply darkens to the
    // tint, then a soft source-atop glaze lifts the body so it reads richly violet (not black).
    x.globalCompositeOperation = 'multiply'; x.fillStyle = hex; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'source-atop'; x.globalAlpha = 0.42; x.fillStyle = hex; x.fillRect(0, 0, c.width, c.height);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    return c;
  }
  function _gemTintFor(kind) {
    if (!levelGemHex) return null;
    let entry = _gemTintCache[levelGemHex];
    if (!entry) entry = _gemTintCache[levelGemHex] = { normal: undefined, star: undefined };
    const slot = (kind === 'star') ? 'star' : 'normal';
    if (entry[slot] === undefined) {   // undefined = not yet attempted; null = source not ready, retry next frame
      entry[slot] = _buildTintedGem(kind === 'star' ? noteStarImg : noteImg, levelGemHex);
    }
    return entry[slot] || null;
  }
  // Hook: set '#rrggbb' (or 'r,g,b'/'r, g, b') to tint gems; falsy clears. Cheap; result is cached.
  window.RhythmGame.setLevelGemTint = (hex) => {
    let h = null;
    if (typeof hex === 'string') {
      const s = hex.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(s)) h = s[0] === '#' ? s : '#' + s;
      else { const m = s.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
        if (m) h = '#' + [m[1], m[2], m[3]].map(n => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, '0')).join(''); }
    }
    levelGemHex = h;
  };
```

### 4B · `game.js` — `drawNote` blits the tinted sprite when active

**ANCHOR (exact current text):**
```js
  function drawNote(cx, y, w, note) {
    const img = note.type === 'star' ? noteStarImg : noteImg;
    let S = w * 1.3;
    if (note.type === 'accent') S *= 1.12;
    if (img && img._ready) ctx.drawImage(img, cx - S / 2, y - S / 2, S, S);
    else { ctx.fillStyle = '#141016'; ctx.beginPath(); ctx.arc(cx, y, w * 0.5, 0, Math.PI * 2); ctx.fill(); }
```
**ACTION:** REPLACE those lines with (prefer the cached tinted canvas; fall back to the PNG, then the dot):
```js
  function drawNote(cx, y, w, note) {
    const img = note.type === 'star' ? noteStarImg : noteImg;
    let S = w * 1.3;
    if (note.type === 'accent') S *= 1.12;
    const tinted = _gemTintFor(note.type);   // build8: violet (etc.) gem when a level sets a gem tint; null otherwise
    if (tinted) ctx.drawImage(tinted, cx - S / 2, y - S / 2, S, S);
    else if (img && img._ready) ctx.drawImage(img, cx - S / 2, y - S / 2, S, S);
    else { ctx.fillStyle = '#141016'; ctx.beginPath(); ctx.arc(cx, y, w * 0.5, 0, Math.PI * 2); ctx.fill(); }
```

> The rest of `drawNote` (the HOPO ember ring) is unchanged. The existing additive accent aura
> behind the gem (game.js ~2205) still layers on top, so the marble gets a violet body **and** a
> soft violet halo — crisp + themed. Hit-detection reads `note.type`/timing only; visuals don't
> touch it → scoring byte-identical.

### 4C · `index.html` — drive the gem tint from `applyLevelTheme` / clear it on teardown

**ANCHOR (exact current text):** (the existing per-level guitar line inside `applyLevelTheme`)
```js
    // build7: per-level custom guitar (temporary override; self-heals to default on 404). Falsy guitarSkin → equipped/default.
    try { if (window.RhythmGame && window.RhythmGame.setGuitarSkin) window.RhythmGame.setGuitarSkin(L && L.guitarSkin ? L.guitarSkin : null); } catch (e) {}
```
**ACTION:** INSERT-AFTER that line:
```js
    // build8: per-level GEM TINT — recolor the note marbles to the level accent (e.g. Skully violet).
    try {
      if (window.RhythmGame && window.RhythmGame.setLevelGemTint) {
        var _gemHex = (L && L.theme && LV_THEMES[L.theme]) ? ({ crimson:'#ff1f2e', ember:'#ff7a4a', gold:'#e0a93f', chrome:'#dad7d2', violet:'#a64dff' })[L.theme] : null;
        // only tint when the accent is meaningfully different from the crimson default gem (violet/ember/gold/chrome)
        window.RhythmGame.setLevelGemTint((_gemHex && _gemHex !== '#ff1f2e') ? _gemHex : null);
      }
    } catch (e) {}
```

**ANCHOR (exact current text):** (inside `clearLevelTheme`, the existing accent-clear + skin-restore lines)
```js
    // build7: clear the level accent (additive glow + ambient off) and restore the equipped/default guitar
    try { window.RhythmGame && window.RhythmGame.setLevelAccent && window.RhythmGame.setLevelAccent(null); } catch (e) {}
    try { if (window.RhythmGame && window.RhythmGame.applyEquippedSkin) window.RhythmGame.applyEquippedSkin(); } catch (e) {}
```
**ACTION:** INSERT-AFTER those two lines (still inside `clearLevelTheme`):
```js
    // build8: clear the per-level gem tint (back to the crimson default marble)
    try { window.RhythmGame && window.RhythmGame.setLevelGemTint && window.RhythmGame.setLevelGemTint(null); } catch (e) {}
```

> **Note on the violet HUD panels reading muddy:** the panel tint at `#game.rr-lvl-themed .hud-panel`
> (index.html 859-863) mixes the accent into a warm-dark at only 10%/6% — it's already subtle and
> reads as "themed instrument," not purple mud. With the wash (PART 2) cut, the panels are the right
> amount of violet. **No change needed there;** leaving it avoids over-tinting. (If the integrator
> finds the panels still too cool against the now-crisp board, the single lever is those two
> `color-mix … var(--rr-acc) 10%/6%` values — lower to 7%/4%. Optional, not applied.)

---

# PART 5 — COMBO → VIDEO SWITCH (dopamine spike, self-healing)

### 5A · `game.js` — fire `RhythmLevelFx.onCombo` at the combo milestone / overdrive

**ANCHOR (exact current text):** (the combo-milestone block in the hit handler)
```js
      const big = combo % 100 === 0;                            // every 100 is a bigger moment
      flashJudgment(combo + (big ? ' STREAK!!' : ' STREAK'), big ? '#fff2cd' : '#ffe08a');
      if (navigator.vibrate) { try { navigator.vibrate(big ? [12, 18, 12, 18, 12] : [10, 20, 10]); } catch (e) {} }
    }
```
**ACTION:** REPLACE with (adds the level-fx combo hook; fires every 25 with the milestone):
```js
      const big = combo % 100 === 0;                            // every 100 is a bigger moment
      flashJudgment(combo + (big ? ' STREAK!!' : ' STREAK'), big ? '#fff2cd' : '#ffe08a');
      if (navigator.vibrate) { try { navigator.vibrate(big ? [12, 18, 12, 18, 12] : [10, 20, 10]); } catch (e) {} }
      // build8: level-fx combo milestone hook (Skully swaps to the intense backdrop). No-op when unset.
      try { if (window.RhythmLevelFx && window.RhythmLevelFx.onCombo) window.RhythmLevelFx.onCombo(combo, big); } catch (e) {}
    }
```

### 5B · `game.js` — also pulse it on Overdrive activation

**ANCHOR (exact current text):** (inside `activateOverdrive`)
```js
    flashJudgment('OVERDRIVE', '#ffd98a');
    if (odFlame) odFlame.classList.add('active');
    playOverdriveSfx();
```
**ACTION:** REPLACE with:
```js
    flashJudgment('OVERDRIVE', '#ffd98a');
    if (odFlame) odFlame.classList.add('active');
    // build8: tell a level its big moment landed (Skully kicks the intense backdrop). No-op when unset.
    try { if (window.RhythmLevelFx && window.RhythmLevelFx.onCombo) window.RhythmLevelFx.onCombo(combo, true); } catch (e) {}
    playOverdriveSfx();
```

### 5C · `index.html` — install `onCombo` in `showReactive`; swap `#bg-video` then ease back

`showReactive` already builds `window.RhythmLevelFx` with `onHit` / `onMiss` closures. We add an
`onCombo` closure to the SAME object so the engine's calls land, and have it swap the backdrop.

**ANCHOR (exact current text):**
```js
    window.RhythmLevelFx = {
      // THE WORLD charges with clean hits (and slightly cools DEATH); flash on each.
      onHit: function (kind, lane) { worldFill = Math.min(1, worldFill + 0.035); deathFill = Math.max(0, deathFill - 0.015); setFill($('rc-world'), worldFill); setFill($('rc-death'), deathFill); flashCard($('rc-world')); },
      // DEATH charges with misses (and slightly cools THE WORLD); flash on each.
      onMiss: function (lane) { deathFill = Math.min(1, deathFill + 0.07); worldFill = Math.max(0, worldFill - 0.03); setFill($('rc-death'), deathFill); setFill($('rc-world'), worldFill); flashCard($('rc-death')); }
    };
```
**ACTION:** REPLACE the whole assignment with (adds `onCombo` + the intense-video swap; only active
when the level declares an `intenseVideo`):
```js
    var _intenseSrc = L.intenseVideo || null;   // build8: a more-intense backdrop for combo spikes (Skully). null → no swap.
    var _intenseOn = false, _intenseT = null;
    function _intenseRevert() {
      if (!_intenseOn) return; _intenseOn = false;
      var v = $('bg-video'); if (!v) return;
      try { v.onerror = function () { try { v.onerror = null; } catch (e) {} };
        var back = (L.bgVideo || (_bgSaved && _bgSaved.src) || QUICKPLAY_BG);
        if (v.getAttribute('src') !== back) { v.setAttribute('src', back); v.load(); }
        v.play().catch(function(){});
      } catch (e) {}
    }
    function _intenseKick() {
      if (!_intenseSrc) return;
      var v = $('bg-video'); if (!v) return;
      if (!_intenseOn) {
        _intenseOn = true;
        try {
          // self-heal: a 404 on the intense clip reverts to the normal loop with no broken state
          v.onerror = function () { try { v.onerror = null; } catch (e) {} _intenseOn = false; _intenseRevert(); };
          if (v.getAttribute('src') !== _intenseSrc) { v.setAttribute('src', _intenseSrc); v.load(); }
          v.play().catch(function(){});
        } catch (e) { _intenseOn = false; }
      }
      if (_intenseT) clearTimeout(_intenseT);
      _intenseT = setTimeout(_intenseRevert, 5200);   // hold the spike, then ease back to the loop
    }
    window.RhythmLevelFx = {
      // THE WORLD charges with clean hits (and slightly cools DEATH); flash on each.
      onHit: function (kind, lane) { worldFill = Math.min(1, worldFill + 0.035); deathFill = Math.max(0, deathFill - 0.015); setFill($('rc-world'), worldFill); setFill($('rc-death'), deathFill); flashCard($('rc-world')); },
      // DEATH charges with misses (and slightly cools THE WORLD); flash on each.
      onMiss: function (lane) { deathFill = Math.min(1, deathFill + 0.07); worldFill = Math.max(0, worldFill - 0.03); setFill($('rc-death'), deathFill); setFill($('rc-world'), worldFill); flashCard($('rc-death')); },
      // build8: combo milestone / overdrive → kick the intense backdrop (dopamine spike), then ease back.
      onCombo: function (combo, big) { _intenseKick(); }
    };
```

> **Cleanup on teardown.** `hideReactive` clears `window.RhythmLevelFx` (so `onCombo` stops firing),
> and `clearLevelTheme` already restores `#bg-video` to the saved/loop src + poster (index.html
> ~3934-3941), so a song that ends mid-spike reverts the backdrop cleanly. The `_intenseT` timer is
> harmless after teardown (it only touches `#bg-video`, which `clearLevelTheme` has already reset to
> the loop; the `getAttribute('src') !== back` guard makes the revert a no-op if it's already loop).
> If you want belt-and-suspenders, the integrator may add `try { window.RhythmLevelFx = null; }`
> remains in `hideReactive` (already present) — no extra code required.

### 5D · `index.html` AUTHORED `frac-01` — declare the intense clip

**ANCHOR (exact current text):**
```js
    { id:'frac-01', tier:'hard', title:'The World', song:{ trackId:'53613a30-84c6-417e-89dd-d2aa06549141' }, theme:'violet',
      cover:'assets/levels/tarot.jpg', bgArt:'assets/levels/skully-bg.jpg', bgVideo:'assets/levels/skully-loop.mp4',
      reactiveCards:{ hit:'assets/levels/card-world.jpg', miss:'assets/levels/card-death.jpg' },
      guitarSkin:'assets/guitars/violet-gothic.png',   // PREMIUM Skullyrae in-game guitar skin (geometry-matched recolor of assets/guitar.png; 404 → default)
      mods:{ speed:1.15, mirror:false }, unlock:{ stars:1 } },   // SKULLY showcase level (Lil' Clay Skullyrae)
```
**ACTION:** REPLACE with (adds `intenseVideo`; everything else identical):
```js
    { id:'frac-01', tier:'hard', title:'The World', song:{ trackId:'53613a30-84c6-417e-89dd-d2aa06549141' }, theme:'violet',
      cover:'assets/levels/tarot.jpg', bgArt:'assets/levels/skully-bg.jpg', bgVideo:'assets/levels/skully-loop.mp4',
      intenseVideo:'assets/levels/skully-intense.mp4',   // build8: combo-spike backdrop (404 → self-heals to skully-loop.mp4)
      reactiveCards:{ hit:'assets/levels/card-world.jpg', miss:'assets/levels/card-death.jpg' },
      guitarSkin:'assets/guitars/violet-gothic.png',   // PREMIUM Skullyrae in-game guitar skin (geometry-matched recolor of assets/guitar.png; 404 → default)
      mods:{ speed:1.15, mirror:false }, unlock:{ stars:1 } },   // SKULLY showcase level (Lil' Clay Skullyrae)
```

### 5E · `index.html` — carry `intenseVideo` onto the ENV path too (so the env picker also spikes)

So the combo-video works whether the level is launched via campaign or the environment picker,
thread `intenseVideo` through `envFromAuthored` + the synthetic level (same shape as PART 1).

**ANCHOR (exact current text):** (the `envFromAuthored` return — now already edited in PART 1A; match the **post-1A** text)
```js
        cover: L.cover || '', bgArt: L.bgArt || '', bgVideo: L.bgVideo || '',
        guitarSkin: L.guitarSkin || '',                 // build8: carry per-level guitar onto the env path (was dropped → skin never fired)
        reactiveCards: L.reactiveCards || null, boss: !!L.boss,
```
**ACTION:** REPLACE with (adds `intenseVideo`):
```js
        cover: L.cover || '', bgArt: L.bgArt || '', bgVideo: L.bgVideo || '',
        guitarSkin: L.guitarSkin || '',                 // build8: carry per-level guitar onto the env path (was dropped → skin never fired)
        intenseVideo: L.intenseVideo || '',             // build8: carry the combo-spike backdrop onto the env path
        reactiveCards: L.reactiveCards || null, boss: !!L.boss,
```

**ANCHOR (exact current text):** (the synthetic level — now already edited in PART 1B; match the **post-1B** text)
```js
      var synthetic = { id: 'env:' + e.id, title: e.name, tier: e.tier || 'medium', theme: e.theme,
        cover: e.cover, bgArt: e.bgArt, bgVideo: e.bgVideo, guitarSkin: e.guitarSkin || '', reactiveCards: e.reactiveCards, boss: false, _isEnv: true };
```
**ACTION:** REPLACE with (adds `intenseVideo: e.intenseVideo`):
```js
      var synthetic = { id: 'env:' + e.id, title: e.name, tier: e.tier || 'medium', theme: e.theme,
        cover: e.cover, bgArt: e.bgArt, bgVideo: e.bgVideo, guitarSkin: e.guitarSkin || '', intenseVideo: e.intenseVideo || '', reactiveCards: e.reactiveCards, boss: false, _isEnv: true };
```

> `showReactive(synthetic)` (already called by `applyEnvironment`) reads `L.intenseVideo`, so the
> env path now spikes too.

---

## VERIFY (integrator)
1. `node --check game.js` after the game.js edits.
2. `python serve.py` → open `http://localhost:8787`, keep **muted**.
3. Launch the reference level (campaign Tier III "The World", OR the environment picker → "The World"):
   - **Guitar:** the violet-gothic guitar shows in **both** launch paths (was missing on the env path).
     In standard 6-string it aligns; in gh 5-string expect the documented silhouette mismatch
     (cosmetic) — confirm notes still ride the strings (geometry unchanged).
   - **Wash:** board + neck read **crisp**, not muddy purple. The backdrop video is the violet source,
     not a flat wash.
   - **Cards:** DEATH (left) / WORLD (right) flank the **upper-mid** playfield, bigger, fill on
     miss/hit respectively.
   - **Gems:** note marbles read **violet** (crisp body, not a hazy overlay).
   - **Combo video:** drive a 25+ combo (or trigger Overdrive via `window.__rrDebug` / Space) →
     `#bg-video` swaps to `skully-intense.mp4` for ~5s then eases back. With the file absent, it
     **stays on the loop** (self-heal) — confirm no broken/blank video.
4. `preview_console_logs` (level error) clean.
5. **Quick Play regression:** play any non-level song → no violet anywhere, gems crimson, cards
   hidden, no combo-video swap (all gated on level state). Scoring/timing identical.
6. Bump `?v=NN` **once** in index.html (integrator).

---

## ANCHORS USED (for the integrator's grep)
- `game.js`
  - `levelAmbient = levelAccentRGB ? (typeof amb === 'number'` … (PART 4A insert point — after `setLevelAccent`'s closing `};`)
  - `function drawNote(cx, y, w, note) {` → `const img = note.type === 'star' ? noteStarImg : noteImg;` (PART 4B)
  - `// 1) low accent fog rising off the bottom third (cheap, big-read color)` … through the embers `ctx.restore();` (PART 2D)
  - `const big = combo % 100 === 0;` … `navigator.vibrate(big ? [12, 18, 12, 18, 12]` (PART 5A)
  - `flashJudgment('OVERDRIVE', '#ffd98a');` / `if (odFlame) odFlame.classList.add('active');` / `playOverdriveSfx();` (PART 5B)
- `index.html`
  - `#game.rr-lvl-themed #game-bg .bg-accent { opacity: 0.5; }` + `…[data-rrtheme="violet"] … opacity: 0.62;` (PART 2A)
  - `#game.rr-lvl-themed.game-screen::after {` scanline block (PART 2B)
  - `var _amb = (L.theme === 'violet') ? 0.8 : (L.theme === 'chrome' ? 0.35 : 0.55);` (PART 2C)
  - `.rc-card { position: absolute; bottom: 9vh;` block + `.rc-death { left: 16vw; }` / `.rc-world { right: 16vw; }` (PART 3)
  - `@media (max-width: 900px) { .rc-card { width: 76px; bottom: 6vh; } …` (PART 3 mobile)
  - `// build7: per-level custom guitar (temporary override…` → its `setGuitarSkin` line (PART 4C insert)
  - `// build7: clear the level accent (additive glow + ambient off)…` lines in `clearLevelTheme` (PART 4C clear)
  - `window.RhythmLevelFx = { … onHit … onMiss … };` in `showReactive` (PART 5C)
  - `{ id:'frac-01', tier:'hard', title:'The World', …` AUTHORED entry (PART 5D)
  - `function envFromAuthored(L) { return { …` (PART 1A, then PART 5E re-edit)
  - `var synthetic = { id: 'env:' + e.id, …` in `applyEnvironment` (PART 1B, then PART 5E re-edit)

## SELF-HEAL / ASSET NOTES
- `assets/guitars/violet-gothic.png` — EXISTS. Skin layer 404-self-heals to the lane-profile default.
- `assets/levels/skully-loop.mp4` — EXISTS (normal level backdrop).
- `assets/levels/skully-intense.mp4` — **may be ABSENT**; the combo swap sets `<video>.onerror` to
  revert to the loop, so a 404 keeps the normal backdrop (no broken state). Generate a ~6-10s
  seamless, more-intense violet Skullyrae loop, same framing as `skully-loop.mp4`, muted H.264 mp4.
- New engine hooks are additive and inert when unset: `window.RhythmGame.setLevelGemTint`,
  `window.RhythmLevelFx.onCombo`. Quick Play / non-themed levels never see them.
