# \_build8\_flipbook — Flipbook particle-FX hookup (re-derived against v87)

**Concern:** the prior FX patch (`assets/fx/fx-player.js` + `INTEGRATION.md`) was written at a
stale base and was never wired in. This re-derives the hookup against the **live v87** files and
delivers a self-contained FX layer that consumes the ready sprite-sheets.

**What this patch does (5 lines):**
1. Adds a NEW root **`flipbook.js`** exposing `window.RhythmFX` — it self-heals
   `assets/fx/manifest.json`, owns its **own overlay `<canvas id="fx-canvas">`** glued to the
   `#hwy` rect, runs its **own rAF**, draws additive (`'lighter'`), supports one-shot + loop, and
   is **reduceMotion/fxLite-capped + default-inert when assets are missing**.
2. `RhythmFX.spawn(name,x,y,opts)` plays any sheet; a `window` **`'rr-fx'` CustomEvent** listener
   maps gameplay events → effects.
3. Minimal **game.js hooks** dispatch `'rr-fx'` `{type,kind,lane,x,y}` at the **real**
   hit / perfect / miss / overdrive / combo-milestone sites (coords = catcher
   `fretGeom().nearX[lane]` + `fretGeom().nearY`).
4. **Bombs** are wired too: a throttled **bomb-warn** telegraph as a wall-bomb nears, and
   **bomb-explode** when a bomb is struck (uses `assets/fx/bomb-*.png` when present; self-heals
   to inert if absent).
5. Adds `<script src="flipbook.js">` **after** `game.js` in index.html. Gameplay/scoring/timing
   is **byte-identical** — every hook is a pure visual side-channel (dispatch only).

**Type → effect map (in flipbook.js):** `hit→hit-burst`, `perfect→perfect-flare`,
`miss→miss-shatter`, `overdrive→shockwave` (+ `explosion`), `combo-milestone→explosion`,
`bomb-warn→bomb-warn` (loopable telegraph), `bomb-explode→bomb-explode`.

> **Integrator notes:** apply serially, preview-test after each step. **Do NOT bump `?v`** here —
> the integrator bumps once across all files. The game.js edits are all **inserts** (no behavior
> replaced). After the game.js edits run `node --check game.js`; after creating flipbook.js run
> `node --check flipbook.js`. Both must pass.

---

## STEP 1 — CREATE new file `flipbook.js` (repo root, next to `game.js`)

Create the file **`D:/sunoai music plan/animev1/veo 3 round 2/can i pet that dog/cloudcode/v2/flipbook.js`**
with exactly this content:

```js
/*
 * flipbook.js — sprite-sheet ("flipbook") particle-FX layer for Reactive Rhythm.
 * Vanilla Canvas2D, zero deps. Self-contained: owns its own overlay <canvas id="fx-canvas">
 * glued to the #hwy rect, its own rAF, additive ('lighter') compositing.
 *
 * Public API (window.RhythmFX):
 *   RhythmFX.ready()                      -> Promise (resolves after manifest+images settle)
 *   RhythmFX.spawn(name, x, y, opts)      -> handle {move(x,y), setScale(s), stop(), alive()}
 *        x,y = effect CENTER in #hwy canvas CSS px (same space as fretGeom().nearX/nearY).
 *        opts: { scale, alpha, rot, loop }  (loop defaults to the sheet's manifest.loop)
 *   RhythmFX.clear()                      -> kill all live instances
 *   RhythmFX.has(name)                    -> bool (sheet loaded & drawable)
 *
 * It also listens for window CustomEvent 'rr-fx' {detail:{type,kind,lane,x,y}} dispatched by
 * game.js and maps type -> effect (see EVENT_MAP). Default-inert if assets/canvas missing.
 *
 * reduceMotion -> fully inert (no spawns, rAF parks). fxLite -> hard concurrency cap + no loops.
 */
(function (global) {
  "use strict";

  var MANIFEST_URL = "assets/fx/manifest.json";

  // Fallback manifest (used if manifest.json 404s or a sheet is absent from it). Sheet images that
  // fail to load just mark that one effect inert; the rest still play. Bomb sheets are optional —
  // they self-heal: if the PNG is missing the bomb effects are simply no-ops.
  var DEFAULT_MANIFEST = {
    "hit-burst":     { src: "assets/fx/hit-burst.png",     frameW:128, frameH:128, cols:4, rows:4, count:16, fps:30, blend:"lighter", loop:false },
    "perfect-flare": { src: "assets/fx/perfect-flare.png", frameW:128, frameH:128, cols:5, rows:4, count:20, fps:30, blend:"lighter", loop:false },
    "explosion":     { src: "assets/fx/explosion.png",     frameW:128, frameH:128, cols:7, rows:4, count:28, fps:30, blend:"lighter", loop:false },
    "shockwave":     { src: "assets/fx/shockwave.png",     frameW:128, frameH:128, cols:4, rows:4, count:16, fps:30, blend:"lighter", loop:false },
    "fire-loop":     { src: "assets/fx/fire-loop.png",     frameW:128, frameH:128, cols:6, rows:4, count:24, fps:24, blend:"lighter", loop:true  },
    "miss-shatter":  { src: "assets/fx/miss-shatter.png",  frameW:128, frameH:128, cols:4, rows:4, count:16, fps:24, blend:"lighter", loop:false },
    "soulwisp-violet":{src: "assets/fx/soulwisp-violet.png",frameW:128,frameH:128, cols:6, rows:4, count:24, fps:14, blend:"lighter", loop:true  },
    // bomb sheets may arrive later — declared so they load if present, inert if not
    "bomb-warn":     { src: "assets/fx/bomb-warn.png",     frameW:128, frameH:128, cols:4, rows:4, count:16, fps:18, blend:"lighter", loop:true  },
    "bomb-fuse":     { src: "assets/fx/bomb-fuse.png",     frameW:128, frameH:128, cols:4, rows:4, count:16, fps:18, blend:"lighter", loop:true  },
    "bomb-explode":  { src: "assets/fx/bomb-explode.png",  frameW:128, frameH:128, cols:7, rows:4, count:28, fps:30, blend:"lighter", loop:false }
  };

  // gameplay event 'type' -> array of {name, scale} layers to spawn
  var EVENT_MAP = {
    "hit":             [ { name:"hit-burst",     scale:0.85 } ],
    "perfect":         [ { name:"perfect-flare", scale:1.15 } ],
    "miss":            [ { name:"miss-shatter",  scale:0.95 } ],
    "overdrive":       [ { name:"shockwave",     scale:1.7 }, { name:"explosion", scale:1.5 } ],
    "combo-milestone": [ { name:"explosion",     scale:1.25 }, { name:"shockwave", scale:1.15 } ],
    "bomb-explode":    [ { name:"bomb-explode",  scale:1.2 }, { name:"miss-shatter", scale:1.0 } ]
  };

  var HARD_CAP = 80;        // absolute live-instance ceiling (full-FX)
  var LITE_CAP = 10;        // fxLite ceiling
  var FALLBACK_SCALE = 0.6; // bomb-explode falls back to miss-shatter at this rel-scale if no sheet

  function basename(p) { return String(p).split("/").pop(); }

  // ---- motion settings (re-read live each frame; cheap) ----
  function motionState() {
    var reduce = false, lite = false;
    try {
      if (global.document && document.documentElement &&
          document.documentElement.classList.contains("rr-reduce-motion")) reduce = true;
      if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) reduce = true;
      var g = global.RhythmGame;
      if (g && typeof g.getSettings === "function") {
        var s = g.getSettings();
        if (s && s.reduceMotion) reduce = true;
        if (s && s.fxLite) lite = true;
      }
    } catch (e) {}
    return { reduce: reduce, lite: lite };
  }

  function FX() {
    this.manifest = {};
    this.images = {};          // name -> HTMLImageElement (only if loaded OK)
    this.active = [];
    this.canvas = null;
    this.ctx = null;
    this.dpr = Math.min(2, (global.devicePixelRatio || 1));
    this.host = null;          // #game (positioned ancestor we live inside)
    this.hwy = null;           // #hwy (the rect we glue to)
    this._raf = 0;
    this._lastRect = "";
    this._readyResolve = null;
    this._readyP = new Promise(function (res) { this._readyResolve = res; }.bind(this));
    this._booted = false;
  }

  // ---------- asset load (self-healing) ----------
  FX.prototype._loadManifest = function () {
    var self = this;
    return fetch(MANIFEST_URL).then(function (r) {
      if (!r.ok) throw new Error("manifest " + r.status);
      return r.json();
    }).then(function (m) {
      // merge: bomb-* defaults fill in even if the live manifest predates them
      var merged = {};
      var k;
      for (k in DEFAULT_MANIFEST) if (DEFAULT_MANIFEST.hasOwnProperty(k)) merged[k] = DEFAULT_MANIFEST[k];
      for (k in m) if (m.hasOwnProperty(k)) merged[k] = m[k];
      return merged;
    }).catch(function () {
      console.warn("[fx] manifest.json unavailable — using built-in defaults");
      return DEFAULT_MANIFEST;
    });
  };

  FX.prototype._preload = function (manifest) {
    var self = this;
    this.manifest = manifest;
    var base = new URL(MANIFEST_URL, global.location.href);
    var names = Object.keys(manifest);
    return Promise.all(names.map(function (name) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { self.images[name] = img; resolve(); };
        img.onerror = function () { /* inert effect: leave out of self.images */ resolve(); };
        // resolve sheet by basename next to the manifest, so /play subpath works too
        img.src = new URL(basename(manifest[name].src), base).href;
      });
    }));
  };

  // ---------- overlay canvas ----------
  FX.prototype._ensureCanvas = function () {
    if (this.canvas) return true;
    var hwy = (global.document && document.getElementById("hwy")) || null;
    if (!hwy) return false;
    var host = hwy.closest ? (hwy.closest("#game") || hwy.parentElement) : hwy.parentElement;
    if (!host) host = hwy.parentElement;
    var c = document.createElement("canvas");
    c.id = "fx-canvas";
    c.style.position = "absolute";
    c.style.left = "0px"; c.style.top = "0px";
    c.style.pointerEvents = "none";
    c.style.zIndex = "2";          // above #hwy (z:1), below HUD chrome
    c.style.mixBlendMode = "screen"; // extra glow over the neck (additive draw already does most)
    // make sure the host is a positioning context (#game is .screen => position:absolute; safe)
    try {
      var pos = global.getComputedStyle ? getComputedStyle(host).position : "";
      if (pos === "static" || !pos) host.style.position = "relative";
    } catch (e) {}
    host.appendChild(c);
    this.canvas = c; this.ctx = c.getContext("2d");
    this.host = host; this.hwy = hwy;
    this._syncRect(true);
    return true;
  };

  // glue the overlay to the #hwy rect (relative to its host). Re-measured each frame (1 rect read).
  FX.prototype._syncRect = function (force) {
    if (!this.canvas || !this.hwy || !this.host) return;
    var hr = this.hwy.getBoundingClientRect();
    var pr = this.host.getBoundingClientRect();
    var left = hr.left - pr.left, top = hr.top - pr.top;
    var w = hr.width, h = hr.height;
    var key = (left | 0) + "," + (top | 0) + "," + (w | 0) + "," + (h | 0) + "," + this.dpr;
    if (!force && key === this._lastRect) return;
    this._lastRect = key;
    this.canvas.style.left = left + "px";
    this.canvas.style.top = top + "px";
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    // back the buffer at device pixels; draw in CSS px (matches #hwy's setTransform(dpr,...))
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  // ---------- spawn ----------
  FX.prototype.has = function (name) { return !!this.images[name]; };

  FX.prototype.spawn = function (name, x, y, opts) {
    var dead = { move: function () {}, setScale: function () {}, stop: function () {}, alive: function () { return false; } };
    var mo = motionState();
    if (mo.reduce) return dead;                       // reduceMotion -> fully inert
    if (!this._ensureCanvas()) return dead;           // no #hwy yet
    var meta = this.manifest[name], img = this.images[name];
    if (!meta || !img) return dead;                   // missing sheet -> inert (self-heal)
    var cap = mo.lite ? LITE_CAP : HARD_CAP;
    if (this.active.length >= cap) {
      if (mo.lite) return dead;                        // lite: just drop
      this.active.shift();                             // full: evict oldest to stay bounded
    }
    opts = opts || {};
    var loop = opts.loop != null ? opts.loop : !!meta.loop;
    if (mo.lite && loop) return dead;                  // lite: no loops (they accumulate)
    var inst = {
      meta: meta, img: img, x: x, y: y,
      scale: opts.scale != null ? opts.scale : 1,
      alpha: opts.alpha != null ? opts.alpha : 1,
      rot: opts.rot || 0,
      loop: loop, start: null, dead: false
    };
    this.active.push(inst);
    return {
      move: function (nx, ny) { inst.x = nx; inst.y = ny; },
      setScale: function (s) { inst.scale = s; },
      stop: function () { inst.dead = true; },
      alive: function () { return !inst.dead; }
    };
  };

  FX.prototype.clear = function () { this.active.length = 0; };

  // map a 'rr-fx' event to one or more spawns
  FX.prototype._onEvent = function (d) {
    if (!d) return;
    var layers = EVENT_MAP[d.type];
    if (!layers) return;
    var x = +d.x, y = +d.y;
    if (!isFinite(x) || !isFinite(y)) return;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i], nm = L.name;
      // self-heal: bomb-explode -> miss-shatter if no bomb sheet present
      if (!this.has(nm)) {
        if (nm === "bomb-explode" && this.has("miss-shatter")) { this.spawn("miss-shatter", x, y, { scale: (L.scale || 1) * FALLBACK_SCALE }); }
        continue;
      }
      this.spawn(nm, x, y, { scale: L.scale });
    }
  };

  // bomb-warn telegraph: a single looping handle, repositioned while the bomb nears, auto-stopped.
  // (driven by repeated 'rr-fx' {type:'bomb-warn'} from the render loop; throttled game-side.)
  FX.prototype._bombWarn = function (d) {
    if (!this.has("bomb-warn")) return;               // no sheet -> game already draws its own ring
    if (motionState().reduce) return;
    var x = +d.x, y = +d.y; if (!isFinite(x) || !isFinite(y)) return;
    if (!this._warn || !this._warn.alive()) {
      this._warn = this.spawn("bomb-warn", x, y, { scale: 0.7, alpha: 0.9, loop: true });
    } else {
      this._warn.move(x, y);
    }
    this._warnSeen = performance.now();
  };

  // ---------- frame ----------
  FX.prototype._frame = function (now) {
    this._raf = global.requestAnimationFrame(this._frame.bind(this));
    if (!this.canvas) { this._ensureCanvas(); return; }
    this._syncRect(false);
    // auto-cull the bomb-warn loop if no telegraph event arrived recently
    if (this._warn && this._warn.alive() && (now - (this._warnSeen || 0) > 140)) { this._warn.stop(); this._warn = null; }
    var ctx = this.ctx, live = this.active, kept = [];
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);  // own overlay -> clear each frame
    if (motionState().reduce) { this.active = []; return; }      // parked: nothing draws
    for (var n = 0; n < live.length; n++) {
      var it = live[n];
      if (it.dead) continue;
      if (it.start === null) it.start = now;
      var m = it.meta;
      var f = Math.floor((now - it.start) / (1000 / m.fps));
      if (it.loop) { f = ((f % m.count) + m.count) % m.count; }
      else if (f >= m.count) { continue; }            // one-shot finished -> cull
      var sx = (f % m.cols) * m.frameW;
      var sy = ((f / m.cols) | 0) * m.frameH;
      var w = m.frameW * it.scale, h = m.frameH * it.scale;
      ctx.save();
      ctx.globalAlpha = it.alpha;
      ctx.globalCompositeOperation = (m.blend === "lighter") ? "lighter" : "source-over";
      ctx.translate(it.x, it.y);
      if (it.rot) ctx.rotate(it.rot);
      ctx.drawImage(it.img, sx, sy, m.frameW, m.frameH, -w / 2, -h / 2, w, h);
      ctx.restore();
      kept.push(it);
    }
    this.active = kept;
  };

  FX.prototype.ready = function () { return this._readyP; };

  FX.prototype.boot = function () {
    if (this._booted) return this._readyP;
    this._booted = true;
    var self = this;
    // listen for gameplay FX events immediately (spawns are no-ops until assets settle)
    global.addEventListener("rr-fx", function (ev) {
      var d = ev && ev.detail;
      if (!d) return;
      if (d.type === "bomb-warn") self._bombWarn(d);
      else self._onEvent(d);
    });
    global.addEventListener("resize", function () {
      self.dpr = Math.min(2, (global.devicePixelRatio || 1));
      self._syncRect(true);
    });
    // try to build the overlay as soon as #hwy exists; rAF will retry until it does
    this._ensureCanvas();
    this._raf = global.requestAnimationFrame(this._frame.bind(this));
    this._loadManifest()
      .then(function (m) { return self._preload(m); })
      .then(function () { if (self._readyResolve) self._readyResolve(self); })
      .catch(function () { if (self._readyResolve) self._readyResolve(self); });
    return this._readyP;
  };

  var inst = new FX();
  global.RhythmFX = inst;
  if (global.document) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { inst.boot(); });
    } else {
      inst.boot();
    }
  }
})(typeof window !== "undefined" ? window : this);
```

---

## STEP 2 — index.html: add the script tag AFTER `game.js`

**FILE:** `index.html`
**ANCHOR (unique, current):**
```html
<script src="game.js?v=87"></script>
```
**ACTION:** INSERT a new line **immediately after** that anchor line (before the `jukebox.js`
line). Result should read:
```html
<script src="game.js?v=87"></script>
<script src="flipbook.js?v=87"></script>
<script src="jukebox.js?v=87"></script>
```
> Integrator: the `?v=87` shown is the current value — bump ALL of these to the next `v` in your
> single version bump. flipbook.js must load **after** game.js (it reads `window.RhythmGame`),
> order vs jukebox/catalog/multiplayer doesn't matter.

---

## STEP 3 — game.js HOOKS (all pure-visual INSERTS; no behavior changed)

A tiny dispatch helper, then five (well, six) one-line dispatch calls at the real event sites.
Each uses the catcher screen coords `fretGeom().nearX[lane]` + `fretGeom().nearY` exactly as the
existing particle spawners do.

### 3a — add the dispatch helper (once)

**FILE:** `game.js`
**ANCHOR (unique, current)** — the existing miss-FX helper signature:
```js
  // VISUAL-ONLY: register a miss/break for the feedback FX (vignette + lane desat + recoil + mass-fail).
  // Does NOT touch combo/score/stability — call it ALONGSIDE the existing miss logic.
  function registerMissFx(lane) {
```
**ACTION:** INSERT the helper **immediately BEFORE** that comment block (so it sits next to the
other FX helpers and is hoisted/available to all callers). Insert:
```js
  // VISUAL-ONLY: fire a flipbook FX event at the catcher for `lane` (or explicit x/y). The
  // flipbook layer (flipbook.js / window.RhythmFX) listens for 'rr-fx' and maps type->sprite-sheet.
  // No-op if nothing is listening or assets are missing. NEVER affects gameplay/scoring/timing.
  function emitFx(type, kind, lane, x, y) {
    try {
      if (x == null || y == null) {
        const _g = fretGeom();
        if (typeof lane === 'number' && lane >= 0 && lane < _g.nearX.length) { x = _g.nearX[lane]; y = _g.nearY; }
        else { x = _g.nearX[(_g.nearX.length / 2) | 0]; y = _g.nearY; }
      }
      window.dispatchEvent(new CustomEvent('rr-fx', { detail: { type: type, kind: kind, lane: lane, x: x, y: y } }));
    } catch (e) {}
  }
```

### 3b — HIT + PERFECT (the main note-hit path)

**FILE:** `game.js`
**ANCHOR (unique, current):**
```js
    spawnHitParticles(lane, kind);
    flashJudgment(JUDGE[kind].name, JUDGE[kind].color);
```
**ACTION:** INSERT one line **immediately after** `spawnHitParticles(lane, kind);` (i.e. between
those two lines). `kind` here is `'perfect' | 'great' | 'good'`; perfect maps to the flare, the
rest to the burst:
```js
    spawnHitParticles(lane, kind);
    emitFx(kind === 'perfect' ? 'perfect' : 'hit', kind, lane);
    flashJudgment(JUDGE[kind].name, JUDGE[kind].color);
```

### 3c — HOPO / FLOW chain hits

**FILE:** `game.js`
**ANCHOR (unique, current)** — inside `chainHopos()`:
```js
      spawnHitParticles(n.lane, 'great');
      resolved++;
```
**ACTION:** INSERT one line **immediately after** `spawnHitParticles(n.lane, 'great');`:
```js
      spawnHitParticles(n.lane, 'great');
      emitFx('hit', 'great', n.lane);
      resolved++;
```

### 3d — MISS (single choke point for all real misses)

**FILE:** `game.js`
**ANCHOR (unique, current)** — inside `missNote()`:
```js
    spawnMissDud(note.lane);
    flashJudgment('MISS', '#ff1f2e');
```
**ACTION:** INSERT one line **immediately after** `spawnMissDud(note.lane);`:
```js
    spawnMissDud(note.lane);
    emitFx('miss', 'miss', note.lane);
    flashJudgment('MISS', '#ff1f2e');
```

### 3e — BOMB struck (bomb-explode)

**FILE:** `game.js`
**ANCHOR (unique, current)** — the bomb-hit hazard block:
```js
      registerMissFx(lane);
      playMissSfx();   // squelch (music level stays full — no ducking)
      flashJudgment('✕ BOMB', '#ff1f2e');
```
**ACTION:** INSERT one line **immediately after** the `playMissSfx();` line in that block:
```js
      registerMissFx(lane);
      playMissSfx();   // squelch (music level stays full — no ducking)
      emitFx('bomb-explode', 'bomb', lane);
      flashJudgment('✕ BOMB', '#ff1f2e');
```
> Note: a bomb that is *passed* (dodged) is intentionally **safe / no FX** — we do NOT hook the
> `n.hit = 'avoided'` site. Correct per design.

### 3f — COMBO MILESTONE (every 25)

**FILE:** `game.js`
**ANCHOR (unique, current)** — the milestone branch:
```js
    if (combo > 0 && combo % 25 === 0) {
      const tier = combo / 25;                                  // 1, 2, 3, … — escalates with the streak
      lightningT = Math.min(0.55, 0.3 + tier * 0.05);
```
**ACTION:** INSERT one line **immediately after** the `const tier = combo / 25; …` line:
```js
    if (combo > 0 && combo % 25 === 0) {
      const tier = combo / 25;                                  // 1, 2, 3, … — escalates with the streak
      emitFx('combo-milestone', 'milestone', lane);
      lightningT = Math.min(0.55, 0.3 + tier * 0.05);
```
> `lane` is in scope here (this block is inside the hit handler). The explosion lands on the
> just-struck lane's catcher — reads as the streak "popping" off the note you just nailed.

### 3g — OVERDRIVE activate

**FILE:** `game.js`
**ANCHOR (unique, current)** — inside `activateOverdrive()`:
```js
    odActive = true; odTimer = OD_DURATION; overdrive = 1;
    scanT = scanDur = 0.62; scanTier = 3;   // big activation scan sweep up the whole guitar
```
**ACTION:** INSERT one line **immediately after** the `scanT = scanDur = 0.62; …` line. Overdrive
is a full-board moment → fire the shockwave/explosion across **every** catcher:
```js
    odActive = true; odTimer = OD_DURATION; overdrive = 1;
    scanT = scanDur = 0.62; scanTier = 3;   // big activation scan sweep up the whole guitar
    try { const _g = fretGeom(); for (let _i = 0; _i < LANE_COUNT; _i++) emitFx('overdrive', 'od', _i, _g.nearX[_i], _g.nearY); } catch (e) {}
```
> `LANE_COUNT` + `fretGeom` are module-scope and in scope here. Firing per-lane (with explicit
> x/y) gives a board-wide ripple; the `overdrive` map spawns shockwave+explosion per catcher.

### 3h — BOMB-WARN telegraph (render loop, throttled)

**FILE:** `game.js`
**ANCHOR (unique, current)** — the wall-bomb approach-warning block in the note render loop:
```js
      if (n.type === 'bomb') {
        if (n._bombRow && d > 0.12 && !reduceMotion && !fxLite) {
          const warn = 0.25 + 0.25 * Math.sin(performance.now() / 90);
```
**ACTION:** INSERT one line **immediately after** the `if (n._bombRow && d > 0.12 && !reduceMotion && !fxLite) {` line (so the flipbook telegraph rides alongside the existing hand-drawn ember ring, gated by the same conditions):
```js
      if (n.type === 'bomb') {
        if (n._bombRow && d > 0.12 && !reduceMotion && !fxLite) {
          emitFx('bomb-warn', 'warn', n.lane, nx, ny);
          const warn = 0.25 + 0.25 * Math.sin(performance.now() / 90);
```
> This dispatches every frame the bomb is approaching; flipbook.js keeps **one** looping
> `bomb-warn` handle and `.move()`s it to the latest `nx,ny`, auto-stopping ~140ms after the last
> event (i.e. once the bomb resolves/leaves). It's a **no-op if `assets/fx/bomb-warn.png` is
> absent** — the existing ring still draws, so this is purely additive. Uses the note's live
> screen coords `nx,ny` (already computed two lines above as `noteX/noteY`), not the catcher,
> because the telegraph should track the falling bomb.

---

## VERIFY

```
node --check flipbook.js     # new file
node --check game.js         # after the 7 inserts (3a–3h; 3a is the helper, 3b–3h are call sites)
```
Then preview (Claude_Preview, name "rhythm-rift"): boot, start a track, and in the console:
```js
window.RhythmFX && window.RhythmFX.has('hit-burst')          // true once assets settle
document.getElementById('fx-canvas')                         // present, sized to #hwy
window.dispatchEvent(new CustomEvent('rr-fx',{detail:{type:'overdrive',x:300,y:400}})) // manual smoke test
```
Check `preview_console_logs` (level error) — expect none. With `assets/fx/bomb-*.png` absent you
should see one benign `[fx] missing` skip at most (errors are swallowed; bomb FX just stay inert).

---

## ANCHORS USED (all verified unique in the live v87 files)

| # | File | Anchor (verbatim substring) | Op |
|---|---|---|---|
| 2 | index.html | `<script src="game.js?v=87"></script>` | insert after |
| 3a | game.js | `// VISUAL-ONLY: register a miss/break for the feedback FX` … `function registerMissFx(lane) {` | insert before |
| 3b | game.js | `spawnHitParticles(lane, kind);` (followed by `flashJudgment(JUDGE[kind].name…`) | insert after |
| 3c | game.js | `spawnHitParticles(n.lane, 'great');` | insert after |
| 3d | game.js | `spawnMissDud(note.lane);` | insert after |
| 3e | game.js | `playMissSfx();   // squelch (music level stays full — no ducking)` | insert after |
| 3f | game.js | `const tier = combo / 25;                                  // 1, 2, 3, … — escalates with the streak` | insert after |
| 3g | game.js | `scanT = scanDur = 0.62; scanTier = 3;   // big activation scan sweep up the whole guitar` | insert after |
| 3h | game.js | `if (n._bombRow && d > 0.12 && !reduceMotion && !fxLite) {` | insert after |

## SELF-HEAL / ASSET NOTES
- **manifest.json present** (verified) with 7 sheets: hit-burst, perfect-flare, explosion,
  shockwave, fire-loop, miss-shatter, soulwisp-violet — all 128×128 cells, `blend:"lighter"`.
  flipbook.js merges a built-in default over it, so it works even if manifest.json 404s.
- **Bomb sheets** (`bomb-warn`, `bomb-fuse`, `bomb-explode`) are **NOT present yet** — declared in
  the default manifest so they auto-load if/when dropped into `assets/fx/`. Until then: `bomb-warn`
  is inert (game's own ember ring still shows) and `bomb-explode` **self-heals to `miss-shatter`**
  at a reduced scale, so a struck bomb still pops.
- **Default-inert everywhere:** missing manifest, missing/failed sheet image, or no `#hwy` yet →
  `spawn()` returns a dead handle; no errors thrown (all wrapped). Game runs identically with the
  FX layer absent or unloaded.
- **reduceMotion → fully inert** (no spawns, rAF parks, instances dropped). **fxLite → capped**
  (max 10 live, no loops) so the warn-telegraph and fire-loop won't accumulate on low-end devices.
- **Geometry:** dispatch coords are `fretGeom().nearX[lane]` / `.nearY` (catcher, canvas CSS px)
  for hits/miss/overdrive/milestone; the bomb-warn uses the falling bomb's live `nx,ny`. The
  overlay `#fx-canvas` is glued to the `#hwy` rect every frame (incl. layout shifts) and uses the
  same `dpr` + `setTransform(dpr,…)` as `#hwy`, so those coords map 1:1 onto the overlay.
- **No `?v` bump in this doc** — integrator bumps all script tags once. Existing `assets/fx/`
  files (`fx-player.js`, `preview.html`, `INTEGRATION.md`) are left untouched; `flipbook.js`
  supersedes `fx-player.js` for the in-game layer (own overlay + event bus + self-heal).
```
