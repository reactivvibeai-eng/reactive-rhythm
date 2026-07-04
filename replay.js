/* =====================================================================================
   replay.js — Reactive Rhythm "RIFT REPLAY"  (window.RhythmReplay)
   -------------------------------------------------------------------------------------
   The shareable ~6-second vertical clip of a run's HOTTEST moment (the peak-combo window).
   share.js makes a static PNG of numbers; nobody shares a screenshot of a score — they
   share a CLIP of a sick run. This is that clip.

   HOW IT WORKS (pull interface — game.js feeds us, we never reach into game.js):
     • init({ getFrame, getStats })  — game.js hands us two pull callbacks.
     • Every ~frame, game.js calls RhythmReplay.tick() (cheap early-out). We sample the
       lane frame at a capped fps into a FIXED-SIZE ring buffer of downscaled bitmaps, and
       track which contiguous ~6s window held the highest combo (the "hottest" window).
     • capture() composites that peak window — recorded frames + crimson neck framing +
       Oxanium HUD (score/combo) + a gold score/grade END-CARD — into an offscreen canvas,
       recorded via canvas.captureStream() + MediaRecorder → webm Blob.
       FALLBACK CHAIN (feature-detected, never throws):
         MediaRecorder+captureStream (webm)  →  animated GIF (~14 frames)  →  branded PNG still.
     • share(blob) — native share (navigator.share w/ files) if available, else download.
       Reuses RhythmShare's approach/panel when present.
     • offerOnResults(container) — injects a branded "SHARE YOUR RIFT" button that runs
       capture() → share() inside the click's transient activation.

   Brand: BLACK · CRIMSON · CHROME · GOLD. Warm darks. NO blue/purple/green.
   Pure vanilla, no deps, no build step. Reduce-motion / fxLite aware. All API access is
   feature-detected + guarded so an old browser degrades, never crashes.
   ===================================================================================== */
(function () {
  'use strict';

  // ---- brand tokens (mirror share.js / index.html :root) ----
  var C = {
    bg:      '#0a0706',
    bgDeep:  '#050303',
    ink:     '#f4eef0',
    inkDim:  '#8a7f7c',
    chrome:  '#dad7d2',
    silver:  '#cbc7c2',
    crimson: '#ff1f2e',
    crimsonDeep: '#a3060f',
    gold:    '#e0a93f',
    goldHot: '#ffd27a'
  };
  var PLAY_URL = 'https://reactivvibe.com/play';

  // ---- tunables ---------------------------------------------------------------------
  var CAP_FPS      = 12;    // sample rate into the ring (12fps × 6s = 72 frames; plenty for a clip, cheap on memory)
  var WINDOW_SEC   = 6;     // length of the shareable window
  var RING_FRAMES  = CAP_FPS * WINDOW_SEC + 6;   // fixed ring capacity (+small margin) — NEVER grows past this
  var FRAME_W      = 288;   // downscaled capture width  (portrait-ish source crop)
  var FRAME_H      = 512;   // downscaled capture height (9:16). ~288×512×4 ≈ 590KB/frame ×78 ≈ 46MB worst-case bitmap budget
  var OUT_W        = 720;   // output clip width  (vertical 9:16)
  var OUT_H        = 1280;  // output clip height
  var PLAY_FPS     = 30;    // playback fps of the composited clip
  var END_CARD_SEC = 2.2;   // gold end-card hold after the gameplay window
  var GIF_FRAMES   = 14;    // fallback GIF frame count

  // ---- module state -----------------------------------------------------------------
  var _opts = null;           // { getFrame, getStats }
  var _ring = [];             // fixed-size ring of { canvas, t, combo, score } ; length capped at RING_FRAMES
  var _ringHead = 0;          // next write index (overwrites oldest)
  var _ringCount = 0;         // how many slots are populated (<= RING_FRAMES)
  var _lastSampleT = 0;       // perf-time of last sample (ms)
  var _armed = false;         // recording enabled (between init and reset)
  var _scratch = null;        // reused downscale canvas
  var _scratchCtx = null;
  var _reduceMotion = false;  // set from getStats().reduceMotion or settings (kills the end-card animation)
  var _t0 = 0;                // run start perf-time (ms) for relative timestamps

  function now() {
    try { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
    catch (e) { return Date.now(); }
  }

  // =================================================================================
  // INIT / lifecycle
  // =================================================================================
  // opts: { getFrame: () => (HTMLCanvasElement | ImageData | function(ctx,w,h) drawFn | null),
  //         getStats: () => ({ combo, score, grade, maxCombo, reduceMotion?, fxLite? }) }
  // Degrades gracefully if opts (or either callback) is missing — tick() becomes a no-op and
  // capture() falls straight to the branded PNG still using whatever getStats returns.
  function init(opts) {
    _opts = opts || null;
    reset();
    try {
      var st = _stats();
      _reduceMotion = !!(st && st.reduceMotion);
    } catch (e) {}
    ensureScratch();
    _armed = !!(_opts && typeof _opts.getFrame === 'function');
    return window.RhythmReplay;
  }

  // Clear the ring (call at the start of each run so a clip only covers the current run).
  function reset() {
    // release bitmaps promptly so the GC has less to chew
    for (var i = 0; i < _ring.length; i++) {
      var s = _ring[i];
      if (s && s.canvas) { try { s.canvas.width = 0; s.canvas.height = 0; } catch (e) {} }
    }
    _ring = [];
    _ringHead = 0;
    _ringCount = 0;
    _lastSampleT = 0;
    _t0 = now();
  }

  function ensureScratch() {
    if (_scratch) return;
    try {
      _scratch = document.createElement('canvas');
      _scratch.width = FRAME_W; _scratch.height = FRAME_H;
      _scratchCtx = _scratch.getContext('2d');
    } catch (e) { _scratch = null; _scratchCtx = null; }
  }

  function _stats() {
    try {
      if (_opts && typeof _opts.getStats === 'function') {
        var s = _opts.getStats();
        return s && typeof s === 'object' ? s : {};
      }
    } catch (e) {}
    return {};
  }

  // =================================================================================
  // TICK — called ~every animation frame by game.js. Cheap early-out; samples at CAP_FPS.
  // =================================================================================
  function tick() {
    if (!_armed || !_opts) return;
    var t = now();
    // fps gate — only sample every 1000/CAP_FPS ms
    if (_lastSampleT && (t - _lastSampleT) < (1000 / CAP_FPS) - 1) return;
    var st = _stats();
    // don't record dead frames (not playing) if the caller tells us so — keeps the window "live"
    if (st && st.playing === false) return;
    var src;
    try { src = _opts.getFrame(); } catch (e) { src = null; }
    if (!src) return;
    var snap = downscale(src);
    if (!snap) return;
    _pushFrame(snap, t, +(st && st.combo) || 0, +(st && st.score) || 0, st && st.grade);
    _lastSampleT = t;
  }

  // Downscale ANY supported source into a fresh small canvas (cover-fit, portrait crop).
  // Accepts: HTMLCanvasElement | HTMLVideoElement | ImageData | drawFn(ctx,w,h).
  function downscale(src) {
    ensureScratch();
    if (!_scratchCtx) return null;
    var ctx = _scratchCtx, W = FRAME_W, H = FRAME_H;
    try {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, W, H);
      if (typeof src === 'function') {
        // drawFn — let game.js paint straight into our small buffer
        src(ctx, W, H);
      } else if (src && src.data && typeof src.width === 'number' && src.data.length) {
        // ImageData — blit via a temp then cover-fit scale
        var tmp = document.createElement('canvas');
        tmp.width = src.width; tmp.height = src.height;
        tmp.getContext('2d').putImageData(src, 0, 0);
        coverDraw(ctx, tmp, W, H);
      } else if (src && (src.width || src.videoWidth)) {
        // HTMLCanvasElement / HTMLImageElement / HTMLVideoElement
        coverDraw(ctx, src, W, H);
      } else {
        return null;
      }
    } catch (e) { return null; }
    // copy scratch into an owned bitmap (scratch is reused next tick)
    try {
      var out = document.createElement('canvas');
      out.width = W; out.height = H;
      out.getContext('2d').drawImage(_scratch, 0, 0);
      return out;
    } catch (e) { return null; }
  }

  // cover-fit draw of a source drawable into (W,H), center-cropped
  function coverDraw(ctx, img, W, H) {
    var iw = img.width || img.videoWidth || W;
    var ih = img.height || img.videoHeight || H;
    if (!iw || !ih) { return; }
    var ir = iw / ih, dr = W / H, dw, dh, dx, dy;
    if (ir > dr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
    else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
    try { ctx.drawImage(img, dx, dy, dw, dh); } catch (e) {}
  }

  // Push a frame into the FIXED-SIZE ring (overwrite oldest — memory is bounded).
  function _pushFrame(canvas, t, combo, score, grade) {
    var slot = { canvas: canvas, t: t, combo: combo, score: score, grade: grade };
    if (_ring.length < RING_FRAMES) {
      _ring.push(slot);
    } else {
      // overwrite oldest at head, releasing the bitmap it held
      var old = _ring[_ringHead];
      if (old && old.canvas) { try { old.canvas.width = 0; old.canvas.height = 0; } catch (e) {} }
      _ring[_ringHead] = slot;
    }
    _ringHead = (_ringHead + 1) % RING_FRAMES;
    if (_ringCount < RING_FRAMES) _ringCount++;
  }

  // Return the ring frames in chronological order (oldest → newest).
  function _ordered() {
    if (_ring.length < RING_FRAMES) return _ring.slice();     // not wrapped yet — already in order
    var out = [];
    for (var i = 0; i < RING_FRAMES; i++) out.push(_ring[(_ringHead + i) % RING_FRAMES]);
    return out;
  }

  // Pick the contiguous WINDOW_SEC window whose frames hold the highest PEAK combo.
  // Falls back to "the last WINDOW_SEC" if combos are flat/zero (still the freshest moment).
  function _pickPeakWindow() {
    var frames = _ordered();
    if (!frames.length) return { frames: [], peakCombo: 0, peakGrade: null };
    // index of the single peak-combo frame
    var peakI = 0, peakCombo = -1;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].combo > peakCombo) { peakCombo = frames[i].combo; peakI = i; }
    }
    // center a WINDOW_SEC span so the peak sits ~65% through (build to the crescendo, then land it)
    var spanFrames = Math.min(frames.length, Math.round(CAP_FPS * WINDOW_SEC));
    var end = Math.min(frames.length, peakI + Math.round(spanFrames * 0.35) + 1);
    var start = Math.max(0, end - spanFrames);
    // if the peak is a flat zero (no combo built), just take the freshest window
    if (peakCombo <= 0) { end = frames.length; start = Math.max(0, end - spanFrames); }
    var win = frames.slice(start, end);
    return { frames: win, peakCombo: Math.max(0, peakCombo), peakGrade: (win.length ? win[win.length - 1].grade : null) };
  }

  // =================================================================================
  // CAPTURE — produce a branded vertical clip Blob (webm) or fallback (GIF / PNG).
  // opts (optional): { format:'webm'|'gif'|'png' to force a path; song, artist, endStats }
  // Returns Promise<{ blob, type, w, h }>  (never rejects — worst case a branded PNG still).
  // =================================================================================
  function capture(opts) {
    opts = opts || {};
    var win = _pickPeakWindow();
    var st = _stats();
    var endStats = opts.endStats || {
      score: (+st.score || 0),
      combo: win.peakCombo || (+st.maxCombo || +st.combo || 0),
      grade: win.peakGrade || st.grade || 'D'
    };
    var meta = { song: opts.song || st.song || '', artist: opts.artist || st.artist || '', peakCombo: win.peakCombo, endStats: endStats };

    // force path if asked
    if (opts.format === 'png') return _capturePng(win, meta);
    if (opts.format === 'gif') return _captureGif(win, meta).catch(function () { return _capturePng(win, meta); });

    // PRIMARY: MediaRecorder + captureStream
    if (win.frames.length >= 2 && _supportsRecorder()) {
      return _captureWebm(win, meta).catch(function () {
        // recorder died mid-flight → GIF → PNG
        return _captureGif(win, meta).catch(function () { return _capturePng(win, meta); });
      });
    }
    // no recorder / too few frames → GIF → PNG
    return _captureGif(win, meta).catch(function () { return _capturePng(win, meta); });
  }

  function _supportsRecorder() {
    try {
      if (typeof MediaRecorder === 'undefined') return false;
      var c = document.createElement('canvas');
      if (typeof c.captureStream !== 'function') return false;
      // at least one webm mime must be recordable
      return !!_pickMime();
    } catch (e) { return false; }
  }
  function _pickMime() {
    var cands = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    try {
      if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return cands[2];
      for (var i = 0; i < cands.length; i++) { if (MediaRecorder.isTypeSupported(cands[i])) return cands[i]; }
    } catch (e) {}
    return '';
  }

  // ---- WEBM via MediaRecorder --------------------------------------------------------
  function _captureWebm(win, meta) {
    return new Promise(function (resolve, reject) {
      var stage, sctx, stream, rec;
      try {
        stage = document.createElement('canvas');
        stage.width = OUT_W; stage.height = OUT_H;
        sctx = stage.getContext('2d');
        stream = stage.captureStream(PLAY_FPS);
        var mime = _pickMime();
        rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);
      } catch (e) { reject(e); return; }

      var chunks = [];
      var settled = false;
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      rec.onerror = function (ev) { if (!settled) { settled = true; try { rec.stop(); } catch (e) {} reject(ev && ev.error || new Error('recorder error')); } };
      rec.onstop = function () {
        if (settled) return; settled = true;
        try {
          var blob = new Blob(chunks, { type: (rec.mimeType || 'video/webm') });
          if (!blob.size) { reject(new Error('empty recording')); return; }
          resolve({ blob: blob, type: 'video/webm', w: OUT_W, h: OUT_H });
        } catch (e) { reject(e); }
      };

      // schedule the render — must run frames onto the stage while the recorder is live
      var frames = win.frames;
      var totalGameplayMs = WINDOW_SEC * 1000;
      var perFrameMs = totalGameplayMs / Math.max(1, frames.length);
      var start = now();
      var stopped = false;
      // hard safety timeout: never let the recorder hang the tab
      var guard = setTimeout(function () { if (!stopped) { stopped = true; try { rec.stop(); } catch (e) {} } }, (WINDOW_SEC + END_CARD_SEC) * 1000 + 1500);

      try { rec.start(); } catch (e) { clearTimeout(guard); reject(e); return; }

      function loop() {
        if (stopped) return;
        var elapsed = now() - start;
        if (elapsed <= totalGameplayMs) {
          var idx = Math.min(frames.length - 1, Math.floor(elapsed / perFrameMs));
          drawGameplayFrame(sctx, frames[idx], meta, elapsed / totalGameplayMs);
          requestAnimationFrame(loop);
        } else if (elapsed <= totalGameplayMs + END_CARD_SEC * 1000) {
          var ep = (elapsed - totalGameplayMs) / (END_CARD_SEC * 1000);
          drawEndCard(sctx, meta, _reduceMotion ? 1 : ep);
          requestAnimationFrame(loop);
        } else {
          stopped = true; clearTimeout(guard);
          // one last full end-card frame, then stop
          drawEndCard(sctx, meta, 1);
          setTimeout(function () { try { rec.stop(); } catch (e) {} }, 60);
        }
      }
      requestAnimationFrame(loop);
    });
  }

  // ---- GIF fallback (self-contained tiny encoder, no deps) ---------------------------
  // Samples GIF_FRAMES across the window + a couple end-card frames. Returns image/gif Blob.
  function _captureGif(win, meta) {
    return new Promise(function (resolve, reject) {
      try {
        var frames = win.frames;
        if (!frames.length) { reject(new Error('no frames')); return; }
        var stage = document.createElement('canvas');
        stage.width = OUT_W; stage.height = OUT_H;
        var sctx = stage.getContext('2d');
        var gw = 360, gh = 640;   // downscale the GIF (256-color + big canvas = huge; keep it lean)
        var enc = new GifEncoder(gw, gh);
        var n = GIF_FRAMES;
        for (var i = 0; i < n; i++) {
          var idx = Math.min(frames.length - 1, Math.floor(i / n * frames.length));
          drawGameplayFrame(sctx, frames[idx], meta, i / n);
          enc.addFrame(scaleToImageData(stage, gw, gh), 90);
        }
        // 3 end-card frames
        for (var k = 0; k < 3; k++) {
          drawEndCard(sctx, meta, 1);
          enc.addFrame(scaleToImageData(stage, gw, gh), k === 2 ? 900 : 260);
        }
        var bytes = enc.finish();
        var blob = new Blob([bytes], { type: 'image/gif' });
        if (!blob.size) { reject(new Error('empty gif')); return; }
        resolve({ blob: blob, type: 'image/gif', w: gw, h: gh });
      } catch (e) { reject(e); }
    });
  }

  function scaleToImageData(srcCanvas, w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var cx = c.getContext('2d');
    cx.drawImage(srcCanvas, 0, 0, w, h);
    return cx.getImageData(0, 0, w, h);
  }

  // ---- PNG still fallback (last resort — a branded single frame + end-card overlay) --
  function _capturePng(win, meta) {
    return new Promise(function (resolve) {
      var stage = document.createElement('canvas');
      stage.width = OUT_W; stage.height = OUT_H;
      var sctx = stage.getContext('2d');
      try {
        var frames = win.frames;
        if (frames.length) {
          // pick the peak frame for the still
          var best = 0, bc = -1;
          for (var i = 0; i < frames.length; i++) { if (frames[i].combo > bc) { bc = frames[i].combo; best = i; } }
          drawGameplayFrame(sctx, frames[best], meta, 0.65);
        } else {
          drawGameplayFrame(sctx, null, meta, 0.65);
        }
        // compact gold end-strip along the bottom so a still still reads as a RIFT REPLAY
        drawStillFooter(sctx, meta);
      } catch (e) {
        try { sctx.fillStyle = C.bg; sctx.fillRect(0, 0, OUT_W, OUT_H); } catch (_) {}
      }
      var done = function (blob) { resolve({ blob: blob || new Blob([], { type: 'image/png' }), type: 'image/png', w: OUT_W, h: OUT_H }); };
      try { stage.toBlob(function (b) { done(b); }, 'image/png'); }
      catch (e) { done(null); }
    });
  }

  // =================================================================================
  // COMPOSITING — the branded look (crimson neck frame + Oxanium HUD + gold end-card)
  // =================================================================================
  function roundRect(ctx, x, y, w, h, r) {
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + w - r.tr, y);
    ctx.arcTo(x + w, y, x + w, y + r.tr, r.tr);
    ctx.lineTo(x + w, y + h - r.br);
    ctx.arcTo(x + w, y + h, x + w - r.br, y + h, r.br);
    ctx.lineTo(x + r.bl, y + h);
    ctx.arcTo(x, y + h, x, y + h - r.bl, r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.arcTo(x, y, x + r.tl, y, r.tl);
    ctx.closePath();
  }
  function fmt(n) { try { return (Math.round(+n || 0)).toLocaleString('en-US'); } catch (e) { return String(n || 0); } }
  function gradeColor(g) {
    g = (g || 'D').toUpperCase();
    if (g === 'S') return C.gold;
    if (g === 'A') return C.crimson;
    if (g === 'B') return C.chrome;
    return C.inkDim;
  }
  function drawTrackedCenter(ctx, text, cx, y, tracking) {
    var total = 0, i;
    for (i = 0; i < text.length; i++) total += ctx.measureText(text[i]).width + tracking;
    total -= tracking;
    var start = cx - total / 2;
    var prev = ctx.textAlign; ctx.textAlign = 'left';
    for (i = 0; i < text.length; i++) { ctx.fillText(text[i], start, y); start += ctx.measureText(text[i]).width + tracking; }
    ctx.textAlign = prev;
  }

  // one composited gameplay frame onto the OUT_W×OUT_H stage
  // prog 0..1 = position within the window (drives a subtle intensity ramp on the HUD)
  function drawGameplayFrame(ctx, slot, meta, prog) {
    var W = OUT_W, H = OUT_H;
    // backdrop
    ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, W, H);
    // the gameplay bitmap, cover-fit into the full vertical frame
    if (slot && slot.canvas) {
      try { coverDraw(ctx, slot.canvas, W, H); } catch (e) {}
    } else {
      // no frame — crimson bloom placeholder so the clip is never blank
      var bl = ctx.createRadialGradient(W * 0.5, H * 0.42, 40, W * 0.5, H * 0.42, W * 0.8);
      bl.addColorStop(0, 'rgba(120,12,20,0.5)'); bl.addColorStop(1, 'rgba(10,7,6,0)');
      ctx.fillStyle = bl; ctx.fillRect(0, 0, W, H);
    }
    // crimson neck vignette so the gameplay reads as framed, not a raw grab
    var vig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.34, W * 0.5, H * 0.5, H * 0.78);
    vig.addColorStop(0, 'rgba(5,3,3,0)'); vig.addColorStop(1, 'rgba(5,3,3,0.72)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
    // top + bottom crimson scrims (HUD legibility)
    var topG = ctx.createLinearGradient(0, 0, 0, 210);
    topG.addColorStop(0, 'rgba(10,7,6,0.85)'); topG.addColorStop(1, 'rgba(10,7,6,0)');
    ctx.fillStyle = topG; ctx.fillRect(0, 0, W, 210);
    var botG = ctx.createLinearGradient(0, H - 170, 0, H);
    botG.addColorStop(0, 'rgba(10,7,6,0)'); botG.addColorStop(1, 'rgba(10,7,6,0.9)');
    ctx.fillStyle = botG; ctx.fillRect(0, H - 170, W, 170);

    // crimson corner brackets (HUD language)
    drawBrackets(ctx, 22, 22, W - 44, H - 44);

    // ---- TOP HUD: wordmark + live combo ----
    ctx.textAlign = 'left';
    drawBolt(ctx, 34, 44, 30, C.crimson);
    ctx.fillStyle = C.chrome; ctx.font = '800 26px Unbounded';
    ctx.fillText('RIFT REPLAY', 74, 66);
    ctx.fillStyle = C.silver; ctx.font = '600 13px "Chakra Petch"';
    ctx.fillText('REACTIVVIBE.AI', 76, 88);

    // live combo (Oxanium) top-right — glows hotter toward the peak
    var combo = slot ? slot.combo : (meta.peakCombo || 0);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.inkDim; ctx.font = '600 14px "Chakra Petch"';
    drawTrackedRight(ctx, 'COMBO', W - 34, 58, 3);
    ctx.save();
    var heat = 0.35 + 0.5 * Math.max(0, Math.min(1, prog));
    ctx.shadowColor = 'rgba(255,31,46,' + heat.toFixed(2) + ')'; ctx.shadowBlur = 22;
    ctx.fillStyle = C.chrome; ctx.font = '800 62px Oxanium';
    ctx.fillText(combo + 'x', W - 30, 116);
    ctx.restore();

    // ---- BOTTOM HUD: live score ----
    ctx.textAlign = 'left';
    ctx.fillStyle = C.inkDim; ctx.font = '600 14px "Chakra Petch"';
    drawTracked(ctx, 'SCORE', 34, H - 96, 3);
    ctx.save();
    ctx.shadowColor = 'rgba(255,31,46,0.5)'; ctx.shadowBlur = 18;
    var sgrad = ctx.createLinearGradient(34, H - 90, 34, H - 40);
    sgrad.addColorStop(0, '#ffffff'); sgrad.addColorStop(1, C.silver);
    ctx.fillStyle = sgrad; ctx.font = '800 56px Oxanium';
    ctx.fillText(fmt(slot ? slot.score : (meta.endStats && meta.endStats.score)), 34, H - 44);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  function drawTracked(ctx, text, x, y, tracking) {
    var cx = x;
    for (var i = 0; i < text.length; i++) { ctx.fillText(text[i], cx, y); cx += ctx.measureText(text[i]).width + tracking; }
  }
  function drawTrackedRight(ctx, text, x, y, tracking) {
    // measure then draw left-anchored so the right edge lands at x
    var total = 0, i; var prev = ctx.textAlign; ctx.textAlign = 'left';
    for (i = 0; i < text.length; i++) total += ctx.measureText(text[i]).width + tracking;
    total -= tracking;
    var start = x - total;
    for (i = 0; i < text.length; i++) { ctx.fillText(text[i], start, y); start += ctx.measureText(text[i]).width + tracking; }
    ctx.textAlign = prev;
  }

  function drawBrackets(ctx, x, y, w, h) {
    var L = 40, o = 6;
    ctx.save();
    ctx.strokeStyle = C.crimson; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + o, y + o + L); ctx.lineTo(x + o, y + o); ctx.lineTo(x + o + L, y + o); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - o, y + h - o - L); ctx.lineTo(x + w - o, y + h - o); ctx.lineTo(x + w - o - L, y + h - o); ctx.stroke();
    ctx.restore();
  }

  function drawBolt(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y - size); ctx.scale(size / 32, size / 32);
    ctx.fillStyle = color;
    try {
      var p = new Path2D('M18 4 8 18h6l-2 10 12-16h-7l1-8z');
      ctx.shadowColor = 'rgba(255,31,46,0.6)'; ctx.shadowBlur = 12; ctx.fill(p);
    } catch (e) {}
    ctx.restore();
  }

  // the gold score/grade END-CARD (ep 0..1 = entrance progress; 1 = fully settled)
  function drawEndCard(ctx, meta, ep) {
    var W = OUT_W, H = OUT_H;
    ep = Math.max(0, Math.min(1, ep));
    var es = meta.endStats || {};
    // warm-black + crimson bloom
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    var bloom = ctx.createRadialGradient(W * 0.5, H * 0.4, 40, W * 0.5, H * 0.4, W * 0.9);
    bloom.addColorStop(0, 'rgba(120,12,20,0.5)'); bloom.addColorStop(0.65, 'rgba(120,12,20,0)');
    ctx.fillStyle = bloom; ctx.fillRect(0, 0, W, H);
    var vig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.3, W * 0.5, H * 0.5, H * 0.8);
    vig.addColorStop(0, 'rgba(5,3,3,0)'); vig.addColorStop(1, 'rgba(5,3,3,0.9)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

    // outer frame + brackets
    ctx.strokeStyle = 'rgba(218,215,210,0.4)'; ctx.lineWidth = 2;
    roundRect(ctx, 30, 30, W - 60, H - 60, 20); ctx.stroke();
    drawBrackets(ctx, 24, 24, W - 48, H - 48);

    // entrance: content rises + fades in (skipped when reduce-motion → ep forced to 1)
    var rise = (1 - ep) * 40;
    ctx.save();
    ctx.globalAlpha = ep;
    ctx.translate(0, rise);

    // wordmark
    ctx.textAlign = 'center';
    drawBolt(ctx, W / 2 - 108, H * 0.22, 34, C.crimson);
    ctx.fillStyle = C.chrome; ctx.font = '800 34px Unbounded';
    drawTrackedCenter(ctx, 'RIFT REPLAY', W / 2 + 18, H * 0.225, 2);
    ctx.fillStyle = C.silver; ctx.font = '600 16px "Chakra Petch"';
    drawTrackedCenter(ctx, 'REACTIVE RHYTHM', W / 2, H * 0.225 + 32, 4);

    // grade ring
    var cy = H * 0.44, r = 118;
    drawGradeRing(ctx, W / 2, cy, r, (es.grade || 'D'));

    // PEAK COMBO gold pill
    var pc = meta.peakCombo || es.combo || 0;
    ctx.font = '700 20px "Chakra Petch"';
    var pcTxt = 'PEAK ' + pc + 'x COMBO';
    var pw = ctx.measureText(pcTxt).width + 44, ph = 46, px = W / 2 - pw / 2, py = cy + r + 34;
    ctx.fillStyle = 'rgba(224,169,63,0.14)'; roundRect(ctx, px, py, pw, ph, 10); ctx.fill();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2; roundRect(ctx, px, py, pw, ph, 10); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.textAlign = 'center'; ctx.fillText(pcTxt, W / 2, py + 30);

    // SCORE block
    ctx.fillStyle = C.inkDim; ctx.font = '700 20px "Chakra Petch"';
    drawTrackedCenter(ctx, 'FINAL SCORE', W / 2, py + ph + 66, 4);
    ctx.save();
    ctx.shadowColor = 'rgba(255,31,46,0.55)'; ctx.shadowBlur = 26;
    var sg = ctx.createLinearGradient(0, py + ph + 80, 0, py + ph + 160);
    sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, C.silver);
    ctx.fillStyle = sg; ctx.font = '800 96px Oxanium';
    ctx.fillText(fmt(es.score), W / 2, py + ph + 150);
    ctx.restore();

    ctx.restore(); // end entrance transform

    // footer CTA (static — always readable)
    ctx.textAlign = 'center'; ctx.fillStyle = C.chrome; ctx.font = '700 24px "Chakra Petch"';
    var cta = 'PLAY FREE  →  reactivvibe.com/play';
    ctx.fillText(cta, W / 2, H - 70);
    var ulw = ctx.measureText(cta).width;
    ctx.strokeStyle = C.crimson; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - ulw / 2, H - 56); ctx.lineTo(W / 2 + ulw / 2, H - 56); ctx.stroke();
    ctx.textAlign = 'left';
  }

  // compact gold end-strip for the PNG-still fallback (bottom banner)
  function drawStillFooter(ctx, meta) {
    var W = OUT_W, H = OUT_H, es = meta.endStats || {};
    var by = H - 150;
    ctx.fillStyle = 'rgba(10,7,6,0.92)'; ctx.fillRect(0, by, W, H - by);
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(W, by); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = C.inkDim; ctx.font = '600 14px "Chakra Petch"';
    drawTracked(ctx, 'PEAK ' + (meta.peakCombo || es.combo || 0) + 'x  ·  GRADE ' + (es.grade || 'D'), 34, by + 34, 2);
    ctx.fillStyle = gradeColor(es.grade); ctx.font = '800 44px Oxanium';
    ctx.fillText(fmt(es.score), 34, by + 88);
    ctx.textAlign = 'right'; ctx.fillStyle = C.crimson; ctx.font = '700 18px "Chakra Petch"';
    ctx.fillText('reactivvibe.com/play', W - 34, by + 82);
    ctx.textAlign = 'left';
  }

  function drawGradeRing(ctx, cx, cy, r, grade) {
    grade = (grade || 'D').toUpperCase();
    var col = gradeColor(grade);
    var glow = grade === 'S' ? 'rgba(224,169,63,0.55)' : (grade === 'A' ? 'rgba(255,31,46,0.5)' : 'rgba(218,215,210,0.3)');
    ctx.save();
    ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(218,215,210,0.18)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.shadowColor = glow; ctx.shadowBlur = 28; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI * 0.5, Math.PI * 1.28); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col; ctx.shadowColor = glow; ctx.shadowBlur = 24;
    ctx.font = '800 ' + Math.round(r * 1.3) + 'px Oxanium';
    ctx.fillText(grade, cx, cy + r * 0.06);
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // =================================================================================
  // SHARE — native share w/ files, else download (reuses RhythmShare's ethos)
  // =================================================================================
  function share(payload) {
    // accept either a raw Blob or a { blob, type } from capture()
    var blob = payload && payload.blob ? payload.blob : payload;
    var type = (payload && payload.type) || (blob && blob.type) || 'video/webm';
    if (!blob || !blob.size) return Promise.resolve('error');
    var ext = type.indexOf('gif') >= 0 ? 'gif' : (type.indexOf('png') >= 0 ? 'png' : 'webm');
    var name = 'reactive-rhythm-rift.' + ext;
    var caption = 'My hottest 6 seconds in Reactive Rhythm 🎸 play free → ' + PLAY_URL + ' #ReactiveRhythm #ReactivVibe';

    var file = null;
    try { file = new File([blob], name, { type: type }); } catch (e) { file = null; }

    // PRIMARY: native share sheet WITH the file (mobile / desktop Safari)
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        return navigator.share({ files: [file], text: caption, title: 'Reactive Rhythm — Rift Replay' })
          .then(function () { return 'shared'; })
          .catch(function (e) {
            if (e && e.name === 'AbortError') return 'cancelled';
            _download(blob, name); return 'downloaded';
          });
      }
    } catch (e) {}
    // FALLBACK: download the clip
    _download(blob, name);
    return Promise.resolve('downloaded');
  }

  function _download(blob, name) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
    } catch (e) {}
  }

  // =================================================================================
  // offerOnResults — inject a branded "SHARE YOUR RIFT" button into a results element
  // that runs capture() → share() inside the click's transient activation.
  // =================================================================================
  function offerOnResults(container, opts) {
    opts = opts || {};
    if (!container || !container.appendChild) return null;
    // don't double-inject
    var existing = container.querySelector && container.querySelector('.rr-rift-btn');
    if (existing) return existing;
    injectStyles();
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rr-rift-btn';
    btn.setAttribute('aria-label', 'Share your Rift Replay clip');
    var LABEL = '<span class="rr-rift-glyph" aria-hidden="true">▶</span> SHARE YOUR RIFT';
    btn.innerHTML = LABEL;
    var busy = false;
    var reset = function () { busy = false; btn.disabled = false; btn.innerHTML = LABEL; };
    btn.addEventListener('click', function () {
      if (busy) return;
      busy = true; btn.disabled = true; btn.textContent = 'BUILDING RIFT…';
      // build + share; capture() never rejects, but guard anyway
      Promise.resolve().then(function () { return capture(opts.capture || {}); })
        .then(function (res) {
          btn.textContent = 'SHARING…';
          return share(res);
        })
        .then(function (outcome) {
          if (outcome === 'shared') btn.textContent = 'SHARED ✓';
          else if (outcome === 'downloaded') btn.textContent = 'SAVED ✓';
          else if (outcome === 'error') btn.textContent = 'TRY AGAIN';
          else { reset(); return; }   // cancelled
          setTimeout(reset, 1800);
        })
        .catch(function () { btn.textContent = 'TRY AGAIN'; setTimeout(reset, 1800); });
    });
    container.appendChild(btn);
    return btn;
  }

  function injectStyles() {
    if (document.getElementById('rr-rift-style')) return;
    var css = [
      '.rr-rift-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:12px;',
      'border:1px solid rgba(224,169,63,0.55);background:linear-gradient(180deg,rgba(40,20,8,0.6),rgba(20,10,6,0.55));',
      'color:#e0a93f;font-family:"Chakra Petch",sans-serif;font-weight:700;font-size:13px;letter-spacing:.14em;',
      'text-transform:uppercase;cursor:pointer;transition:box-shadow .15s ease,border-color .15s ease,transform .1s ease;}',
      '.rr-rift-btn:hover{border-color:#e0a93f;box-shadow:0 0 18px rgba(224,169,63,0.4);}',
      '.rr-rift-btn:active{transform:translateY(1px);}',
      '.rr-rift-btn:disabled{opacity:.7;cursor:default;box-shadow:none;}',
      '.rr-rift-glyph{color:#ff1f2e;font-size:12px;}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'rr-rift-style'; st.textContent = css;
    try { document.head.appendChild(st); } catch (e) {}
  }

  // =================================================================================
  // Minimal GIF89a encoder (no deps) — median-cut-ish global palette via a coarse quantizer.
  // Good enough for a fallback share artifact; kept tiny + fully guarded.
  // =================================================================================
  function GifEncoder(w, h) {
    this.w = w; this.h = h;
    this.frames = [];   // { indices:Uint8Array, delayCs:int }
    this.palette = null;
  }
  GifEncoder.prototype.addFrame = function (imageData, delayMs) {
    // build/refresh a global palette from the FIRST frame (cheap; frames are similar)
    if (!this.palette) this.palette = buildPalette(imageData.data);
    var idx = quantize(imageData.data, this.palette);
    this.frames.push({ indices: idx, delayCs: Math.max(2, Math.round((delayMs || 100) / 10)) });
  };
  GifEncoder.prototype.finish = function () {
    return encodeGif(this.w, this.h, this.palette, this.frames);
  };

  // coarse uniform 6-6-6 -> 216-ish palette quantizer (web-safe-ish; deterministic, fast)
  function buildPalette(data) {
    // fixed 3-3-2 bit palette (256 entries) — no allocation storms, stable across frames
    var pal = new Uint8Array(256 * 3);
    for (var i = 0; i < 256; i++) {
      var r = (i >> 5) & 7, g = (i >> 2) & 7, b = i & 3;
      pal[i * 3] = Math.round(r * 255 / 7);
      pal[i * 3 + 1] = Math.round(g * 255 / 7);
      pal[i * 3 + 2] = Math.round(b * 255 / 3);
    }
    return pal;
  }
  function quantize(data, pal) {
    var n = data.length / 4;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      out[i] = ((r >> 5) << 5) | ((g >> 5) << 2) | (b >> 6);
    }
    return out;
  }

  // GIF89a byte assembly with LZW compression
  function encodeGif(w, h, pal, frames) {
    var out = [];
    function byte(b) { out.push(b & 0xff); }
    function word(v) { out.push(v & 0xff); out.push((v >> 8) & 0xff); }
    function str(s) { for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); }
    str('GIF89a');
    word(w); word(h);
    byte(0xF7);   // global color table, 256 entries, 8bpp
    byte(0);      // bg color index
    byte(0);      // aspect ratio
    for (var i = 0; i < 256 * 3; i++) out.push(pal[i]);
    // loop forever (NETSCAPE ext)
    byte(0x21); byte(0xFF); byte(0x0B); str('NETSCAPE2.0'); byte(0x03); byte(0x01); word(0); byte(0x00);
    for (var f = 0; f < frames.length; f++) {
      var fr = frames[f];
      // graphic control ext
      byte(0x21); byte(0xF9); byte(0x04); byte(0x00); word(fr.delayCs); byte(0x00); byte(0x00);
      // image descriptor
      byte(0x2C); word(0); word(0); word(w); word(h); byte(0x00);
      // LZW-compressed pixels
      var min = 8;
      byte(min);
      var lzw = lzwEncode(fr.indices, min);
      // sub-block the LZW stream
      var p = 0;
      while (p < lzw.length) {
        var chunk = Math.min(255, lzw.length - p);
        byte(chunk);
        for (var k = 0; k < chunk; k++) out.push(lzw[p + k]);
        p += chunk;
      }
      byte(0x00); // block terminator
    }
    byte(0x3B); // trailer
    return new Uint8Array(out);
  }

  // GIF LZW encoder
  function lzwEncode(indices, minCodeSize) {
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var dict = {};
    function resetDict() {
      dict = {};
      for (var i = 0; i < clearCode; i++) dict[String.fromCharCode(i)] = i;
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }
    var nextCode;
    var out = [];
    var cur = 0, curBits = 0;
    function emit(code) {
      cur |= (code << curBits);
      curBits += codeSize;
      while (curBits >= 8) { out.push(cur & 0xff); cur >>= 8; curBits -= 8; }
    }
    resetDict();
    emit(clearCode);
    var prefix = String.fromCharCode(indices[0]);
    for (var i = 1; i < indices.length; i++) {
      var c = String.fromCharCode(indices[i]);
      if (dict[prefix + c] != null) {
        prefix += c;
      } else {
        emit(dict[prefix]);
        dict[prefix + c] = nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
        else if (nextCode > 4095) { emit(clearCode); resetDict(); }
        prefix = c;
      }
    }
    emit(dict[prefix]);
    emit(eoiCode);
    if (curBits > 0) out.push(cur & 0xff);
    return out;
  }

  // =================================================================================
  // EXPORTS
  // =================================================================================
  window.RhythmReplay = {
    init: init,
    reset: reset,
    tick: tick,
    capture: capture,
    share: share,
    offerOnResults: offerOnResults,
    // introspection (dev/QA) — how many frames buffered + the peak window's combo
    stats: function () {
      var win = _pickPeakWindow();
      return {
        armed: _armed, buffered: _ringCount, cap: RING_FRAMES,
        peakCombo: win.peakCombo, windowFrames: win.frames.length,
        recorder: _supportsRecorder(), mime: _pickMime()
      };
    }
  };

  // dev hook — synthetic-frame smoke test (STRIP at content-freeze alongside __rrDebug).
  window.__rrReplay = {
    // feed N synthetic frames with a rising-then-falling combo, then return capture() result meta.
    smoke: function (n) {
      n = n || 60;
      init({
        getFrame: function () {
          // a simple animated test frame (crimson bars) so the ring has real bitmaps
          var c = document.createElement('canvas'); c.width = 200; c.height = 356;
          var x = c.getContext('2d');
          x.fillStyle = '#0a0706'; x.fillRect(0, 0, 200, 356);
          for (var i = 0; i < 5; i++) { x.fillStyle = i % 2 ? '#ff1f2e' : '#dad7d2'; x.fillRect(10 + i * 38, (Math.random() * 300) | 0, 24, 40); }
          return c;
        },
        getStats: (function () {
          var k = 0;
          return function () {
            k++;
            var combo = Math.round(160 * Math.sin(Math.min(Math.PI, k / n * Math.PI)));   // rise then fall
            return { combo: combo, score: k * 1234, grade: combo > 120 ? 'S' : 'A', playing: true, reduceMotion: false };
          };
        })()
      });
      // drive ticks (bypass the fps gate by resetting _lastSampleT is internal; just tick with waits)
      var i = 0;
      function step() {
        _lastSampleT = 0;   // force-sample each call in the smoke test
        tick();
        if (++i < n) return step();
      }
      step();
      return capture({ song: 'Smoke Test', artist: 'QA' }).then(function (res) {
        return { ok: !!(res && res.blob && res.blob.size), type: res && res.type, size: res && res.blob && res.blob.size, stats: window.RhythmReplay.stats() };
      });
    }
  };
})();
