/* procbg.js — Reactive Rhythm: PROCEDURAL, music-reactive level backdrops (build66; rebuilt build66.11).
   A full-bleed canvas behind the highway that GENERATES the backdrop from the live audio (FFT spectrum + waveform) + your
   combo/Overdrive — the "ReactivVibe" identity made literal. All three are now CRISP + push VERTIGO toward the player:
     • 'warp'     — a hyperspace light-streak TUNNEL flying at you; speed = bass/beat, hue climbs the combo (First Light)
     • 'waveform' — full-screen SPECTRUM CURTAINS streaming in from every edge (top falls down) + a slow geometry MORPH (Steady Hands)
     • 'ember'    — a dense, busy particle STORM (embers/petals/sparks) populating everywhere; BURSTS on the beat, grows, morphs color + falls (Ember Drift)
   THE BACKDROP LAW: a shared center-vignette keeps the note lane dark + readable; energy lives at the edges. The music + the
   streak are the drama — a spectral-flux beat PUNCH + an Overdrive/combo white-hot crescendo.
   Reads the engine via window.RhythmGame (getMusicAnalyser / getLiveStats / getSettings). Selected per level by index.html
   applyLevelTheme(L.procBg); driven play/pause/stop by game.js lifecycle hooks. Quality auto-scales (DPR cap + fxLite/reduceMotion).
   Add an effect by registering it in RENDERERS. Dev: RhythmProcBg.tick() / .procAudio() / ._feed(). No external deps; fails soft. */
(function () {
  'use strict';
  var cv = null, ctx = null;
  var _type = null, _raf = 0, _playing = false, _energy = 0, _t = 0, _last = 0, _hidden = 0;
  var _w = 0, _h = 0, _dpr = 1;
  var _an = null, _freq = null, _wave = null, _bins = 0;
  var bass = 0, mid = 0, treble = 0, level = 0, beat = 0;
  var _prevFreq = null, _fluxMean = 0, _fluxVar = 1, _lastBeat = 0, beatPunch = 0;
  var bassN = 0, midN = 0, trebleN = 0, _mx = { b: 0.15, m: 0.15, t: 0.15 };
  var comboHue = 0, comboGlow = 0, od = 0;
  var _secSlow = 0, _secFast = 0, _spinDir = 1, _secPulse = 0, _lastSection = -99, _kick = 0;   // build67: section/tempo detector → reversible spin (_spinDir ±1) + one-shot section pulse (_secPulse 0..1); _kick = fast-attack beat env
  var _slowF = 0, _soft = 0;   // soft-lite frame-time watchdog (degrade gracefully if a machine can't hold 60fps)
  var _state = {};
  var _audioDbg = {};
  var _fed = false, _fedCombo = 80, _fedTier = 2;

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function env(prev, t, atk, rel) { return t > prev ? lerp(prev, t, atk) : lerp(prev, t, rel); }
  function agc(v, k) { _mx[k] = Math.max(v, _mx[k] * 0.999); return clamp(v / Math.max(0.08, _mx[k]), 0, 1); }
  function _hsl(h, s, l, a) { return 'hsla(' + (h | 0) + ',' + (s | 0) + '%,' + (l | 0) + '%,' + a + ')'; }
  // build67: ONE warm palette source. Lightness is the LOUD axis (white-hot on beats/OD); hue rides a SHARED 0..58 budget
  // (crimson→amber→gold) that warm-arc + combo + phrase-travel split, never SUM past — so hue keeps traveling at high combo.
  function _heatL(heat, base) { return clamp(base + clamp(heat, 0, 1) * 40, base, 99); }
  function _heatS(heat) { return clamp(100 - clamp(heat, 0, 1) * 30, 62, 100); }
  function _warmHue(heat, PAL, travel) { return clamp(PAL.base + clamp(heat, 0, 1) * PAL.span + comboHue * 0.35 + (travel || 0), 0, 58); }
  function _hue2(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
  function _hslToRgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else { var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = _hue2(p, q, h + 1 / 3); g = _hue2(p, q, h); b = _hue2(p, q, h - 1 / 3); }
    return [(r * 255) | 0, (g * 255) | 0, (b * 255) | 0];
  }
  function _settings() { try { return (window.RhythmGame && window.RhythmGame.getSettings) ? window.RhythmGame.getSettings() : {}; } catch (e) { return {}; } }
  function _lite() { var s = _settings(); return !!(s.fxLite || s.reduceMotion); }
  function _reduce() { try { return !!_settings().reduceMotion; } catch (e) { return false; } }

  function _ensureCanvas() {
    if (cv) return cv;
    cv = $('bg-procedural'); if (!cv) return null;
    ctx = cv.getContext('2d'); _resize(); return cv;
  }
  function _resize() {
    if (!cv) return;
    // measure the canvas's OWN laid-out box (CSS keeps it FULL-BLEED via inset:0 + width/height:100%); fall back to parent/viewport.
    var W = cv.clientWidth || (cv.parentElement ? cv.parentElement.clientWidth : 0) || window.innerWidth;
    var H = cv.clientHeight || (cv.parentElement ? cv.parentElement.clientHeight : 0) || window.innerHeight;
    W = Math.max(2, Math.round(W)); H = Math.max(2, Math.round(H));
    _dpr = _lite() ? 1 : Math.min(1.1, window.devicePixelRatio || 1);   // a soft backdrop doesn't need full DPR; capping at 1.1 cuts ~23% of the pixel/overdraw cost (perf)
    cv.width = Math.round(W * _dpr); cv.height = Math.round(H * _dpr);
    // NO inline cv.style.width/height — an inline px size (measured before #game-bg was laid out) was the "black box in the middle" bug.
    _w = cv.width; _h = cv.height; _state.dirty = true; _state.vig = null;
  }
  window.addEventListener('resize', function () { try { if (_type) _resize(); } catch (e) {} });

  function _readAudio() {
    try {
      var an = (window.RhythmGame && window.RhythmGame.getMusicAnalyser) ? window.RhythmGame.getMusicAnalyser() : null;
      if (an && an !== _an) { _an = an; _bins = an.frequencyBinCount; _freq = new Uint8Array(_bins); _wave = new Uint8Array(an.fftSize); _prevFreq = new Uint8Array(_bins); }
      if (!an) _an = null;
      if (_an && _freq) {
        _an.getByteFrequencyData(_freq); _an.getByteTimeDomainData(_wave);
        var n = _bins, i;
        if (!_prevFreq || _prevFreq.length !== n) _prevFreq = new Uint8Array(n);
        var flux = 0;
        for (i = 0; i < n; i++) { var d = _freq[i] - _prevFreq[i]; if (d > 0) flux += d; _prevFreq[i] = _freq[i]; }
        flux /= (n * 255);
        var dev = flux - _fluxMean; _fluxMean += dev * 0.04; _fluxVar = lerp(_fluxVar, dev * dev, 0.04);
        var thresh = _fluxMean + 1.4 * Math.sqrt(_fluxVar) + 0.004;
        var onset = (flux > thresh && (_t - _lastBeat) > 0.11) ? clamp((flux - thresh) / (thresh + 1e-4), 0, 1) : 0;
        if (onset > 0) _lastBeat = _t;
        beatPunch = Math.max(onset, beatPunch * 0.82); beat = Math.max(onset * 0.9, beat * 0.90);
        var b = 0, m = 0, tr = 0, kb = Math.max(1, (n * 0.12) | 0), km = (n * 0.5) | 0;
        for (i = 0; i < n; i++) { var v = _freq[i] / 255; if (i < kb) b += v; else if (i < km) m += v; else tr += v; }
        b /= kb; m /= Math.max(1, km - kb); tr /= Math.max(1, n - km);
        bass = env(bass, b, 0.6, 0.12); mid = env(mid, m, 0.5, 0.14); treble = env(treble, tr, 0.55, 0.16);
        level = env(level, (b + m + tr) / 3, 0.5, 0.10);
        bassN = agc(bass, 'b'); midN = agc(mid, 'm'); trebleN = agc(treble, 't');
      } else { bass *= 0.96; mid *= 0.96; treble *= 0.96; level *= 0.96; beat *= 0.9; beatPunch *= 0.85; bassN *= 0.95; midN *= 0.95; trebleN *= 0.95; }
    } catch (e) {}
  }
  function _readStats() {
    var combo = 0, playing = false, s = null;
    try { s = window.RhythmGame.getLiveStats(); combo = s.combo || 0; playing = !!s.playing; } catch (e) {}
    var tier = combo >= 250 ? 5 : combo >= 150 ? 4 : combo >= 75 ? 3 : combo >= 25 ? 2 : combo >= 5 ? 1 : 0;
    var targetHue = [0, 8, 20, 36, 44, 50][tier];
    var odRaw = 0; try { if (s) odRaw = (s.overdrive != null ? s.overdrive : (s.starPower != null ? s.starPower : s.od)) || 0; } catch (e) {}
    if (odRaw > 1) odRaw /= 100; od = lerp(od, clamp(odRaw, 0, 1), 0.12);
    var ramp = clamp(combo / 200, 0, 1); ramp *= ramp;
    comboGlow = lerp(comboGlow, clamp(ramp + od * 0.5, 0, 1), 0.06);
    comboHue = lerp(comboHue, targetHue + od * 8, 0.06);
    return { combo: combo, playing: playing, tier: tier, od: od };
  }

  // ── shared center-vignette (Backdrop Law: dark readable center) ──
  function _buildVignette() {
    // GENTLE, WIDE center dim for note readability — soft + elliptical (NOT a dark box / black hole that kills the effect).
    var g = ctx.createRadialGradient(_w * 0.5, _h * 0.5, _h * 0.18, _w * 0.5, _h * 0.5, _w * 0.62);
    g.addColorStop(0, 'rgba(6,4,4,0.24)'); g.addColorStop(0.45, 'rgba(6,4,4,0.07)'); g.addColorStop(1, 'rgba(6,4,4,0)');   // softened — the game's own scrim already dims for lane readability; a heavy multiply here starved the center into a "box"
    _state.vig = g; _state.vigH = _h; _state.vigW = _w;
  }
  function _vignette() {
    ctx.globalCompositeOperation = 'multiply';
    if (_lite()) { ctx.fillStyle = 'rgba(6,4,4,0.22)'; ctx.fillRect(0, _h * 0.30, _w, _h * 0.40); }
    else { if (!_state.vig || _state.vigH !== _h || _state.vigW !== _w) _buildVignette(); ctx.fillStyle = _state.vig; ctx.fillRect(0, 0, _w, _h); }
    ctx.globalCompositeOperation = 'source-over';
  }
  // ── shared beat/OD flash (dark center) ──
  function _punch(st) {
    var p = Math.max(beatPunch * 0.6, (st.od || 0) * 0.5);
    var tierBoost = st.tier >= 5 ? 0.5 : st.tier >= 4 ? 0.25 : 0; p = clamp(p + tierBoost * beatPunch, 0, 1);
    if (p < 0.02) return;
    ctx.globalCompositeOperation = 'lighter';
    var rgb = _hslToRgb(comboHue, 95, 60);
    if (_lite()) { ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.12 * p) + ')'; ctx.fillRect(0, 0, _w, _h * 0.16); ctx.fillRect(0, _h * 0.84, _w, _h * 0.16); }
    else {
      var g = ctx.createRadialGradient(_w * 0.5, _h * 0.5, _h * 0.2, _w * 0.5, _h * 0.5, _h * 0.95);
      g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)'); g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.18 * p) + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, _w, _h);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────────────────── WARP (First Light) — a SPIRAL hyperspace vortex that ROTATES + twists to the music ─────────────
  function _newStreak() { return { a: Math.random() * 6.2832, z: Math.random(), spd: 0.35 + Math.random() * 0.8 }; }
  function drawWarp(dt, st) {
    var w = _w, h = _h, lite = _lite(), cx = w * 0.5, cy = h * 0.5, maxR = Math.sqrt(cx * cx + cy * cy);
    var S = _state.s;
    if (!S || _state.dirty) { var N = lite ? 100 : 210; S = _state.s = []; for (var i = 0; i < N; i++) S.push(_newStreak()); _state.dirty = false; _state.rot = 0; }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6,5,4,' + (0.28 + 0.16 * beat) + ')'; ctx.fillRect(0, 0, w, h);   // motion-blur trail (matches the solid-black base)
    ctx.globalCompositeOperation = 'lighter';
    // the WHOLE vortex SPINS to the music (owner: "the whole visual effect rotate/twist/turn to the music"); spiral curl twists each streak
    _state.rot = (_state.rot || 0) + (0.10 + bass * 0.9 + beat * 0.5 + comboGlow * 0.7 + (st.od || 0) * 0.8) * dt;
    var rot = _state.rot, twist = 0.6 + comboGlow * 1.8 + beatPunch * 1.3, SEG = lite ? 2 : 3, hue = comboHue;
    // "first light" — a glow at the vanishing point you fly toward, pulsing + wider so it fills (no dark central tangle)
    var gr = _hslToRgb(comboHue, 90, 56 + comboGlow * 22);
    var gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * (0.34 + 0.18 * level + 0.12 * beatPunch));
    gl.addColorStop(0, 'rgba(' + gr[0] + ',' + gr[1] + ',' + gr[2] + ',' + (0.26 + 0.34 * level + 0.30 * beatPunch) + ')');
    gl.addColorStop(1, 'rgba(' + gr[0] + ',' + gr[1] + ',' + gr[2] + ',0)');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h);
    var speed = (0.12 + bass * 1.0 + beat * 0.7 + (st.od || 0) * 0.6) * (lite ? 0.85 : 1);
    for (var k = 0; k < S.length; k++) {
      var s = S[k];
      s.z -= speed * s.spd * dt;
      if (s.z <= 0.015) { S[k] = _newStreak(); S[k].z = 1; continue; }
      var near = 1 - s.z;
      var alpha = clamp(near * near * 1.3, 0, 1) * (0.5 + comboGlow * 0.5);
      var lw = (0.4 + near * 2.8) * _dpr;
      var r0 = near * maxR, r1 = Math.max(0, near - 0.05 - speed * 0.05) * maxR;   // head (outer) → tail (inner)
      ctx.lineWidth = lw; ctx.strokeStyle = _hsl(hue + near * 12, 95, 56 + near * 30, alpha);
      ctx.beginPath();   // SPIRAL: the angle twists with radius so the streak curves, and the whole field rotates via `rot`
      for (var sg = 0; sg <= SEG; sg++) {
        var rr = r1 + (r0 - r1) * (sg / SEG), ang = s.a + rot + (rr / maxR) * twist;
        var px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
        if (sg === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (near > 0.55) { var ha = s.a + rot + (r0 / maxR) * twist; ctx.fillStyle = _hsl(hue, 78, 92, alpha); ctx.beginPath(); ctx.arc(cx + Math.cos(ha) * r0, cy + Math.sin(ha) * r0, lw * 0.9, 0, 6.2832); ctx.fill(); }   // bright head
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────────────────── WAVEFORM (Steady Hands) — full-screen spectrum CURTAINS from every edge + a slow geometry morph ──
  function _spec(N) {                                    // downsample the live FFT to N temporally-smoothed 0..1 bars (log-ish bins so bass doesn't eat the whole curtain)
    var sp = _state.spec; if (!sp || sp.length !== N) sp = _state.spec = new Float32Array(N);
    var src = _freq ? _bins : 0, lo = 1;
    for (var c = 0; c < N; c++) {
      var i0 = lo + ((Math.pow(c / N, 1.35) * (src - lo)) | 0), i1 = lo + ((Math.pow((c + 1) / N, 1.35) * (src - lo)) | 0);
      var acc = 0, cnt = 0; for (var j = i0; j <= i1 && j < src; j++) { acc += _freq[j]; cnt++; }
      var v = cnt ? (acc / cnt) / 255 : 0;
      sp[c] = lerp(sp[c], v, 0.45);
    }
    return sp;
  }
  function drawWaveform(dt, st) {
    var w = _w, h = _h, lite = _lite();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6,5,4,' + (0.30 + 0.12 * beat) + ')'; ctx.fillRect(0, 0, w, h);   // trail fade (matches the solid-black base)
    ctx.globalCompositeOperation = 'lighter';
    var drift = Math.sin(_t * 0.11) * 18;                                 // slow hue CYCLE through the fire band (owner: "change hue colors a bit more")
    var hueBase = 10 + drift + comboGlow * 18 + trebleN * 10, glow = 0.45 + comboGlow * 0.55, kick = 1 + beatPunch * 0.9;
    var scroll = _t * (2.0 + comboGlow * 2.5);                            // the curtain SCROLLS left→right (owner: "scroll from left to right, add dimension")
    var N = lite ? 40 : 76, sp = _spec(N);
    var mA = 0.5 + 0.5 * Math.sin(_t * 0.285), mB = 0.5 + 0.5 * Math.sin(_t * 0.205 + 1.7), mC = 0.5 + 0.5 * Math.sin(_t * 0.12 + 3.1);
    var reachT = h * (0.28 + 0.34 * mC), reachB = h * (0.30 + 0.30 * (1 - mC)), reachS = w * 0.17;
    function curtain(edge, count, depth) {                               // depth 1 = front; <1 = a dimmer, shorter, slower-scrolling PARALLAX layer behind (dimension)
      var sh = scroll * (0.5 + 0.7 * depth);                             // back layer travels slower → parallax
      for (var i = 0; i < count; i++) {
        var t = i / (count - 1);
        var si = ((((i + sh) % count) + count) % count) * N / count;     // SCROLLED spectrum sample → the whole pattern slides sideways
        var v = sp[si | 0] || 0, lvl = clamp(v * v * 1.7 + level * 0.16, 0, 1);
        var a = (0.16 + 0.72 * lvl) * glow * depth; if (a < 0.02) continue;
        var wob = Math.sin(t * 9 + _t * 1.3 + edge * 1.7) * (3 + 10 * mA) * _dpr;   // the geometry wobble (morphs via mA)
        var bx, by, dx, dy, len;
        if (edge === 0) { bx = t * w + wob; by = 0; dx = 0; dy = 1; len = reachT * lvl * kick * depth; }
        else if (edge === 1) { bx = t * w + wob; by = h; dx = 0; dy = -1; len = reachB * lvl * kick * depth; }
        else if (edge === 2) { bx = 0; by = t * h + wob; dx = 1; dy = 0; len = reachS * lvl * kick * depth; }
        else { bx = w; by = t * h + wob; dx = -1; dy = 0; len = reachS * lvl * kick * depth; }
        var ex = bx + dx * len, ey = by + dy * len, hue = hueBase + t * 22 + edge * 6, lw = (1 + (1 - mB) * 6 * lvl) * _dpr * depth;
        ctx.strokeStyle = _hsl(hue, 92, 52 + lvl * 30, a); ctx.lineWidth = lw; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = _hsl(hue, 80, 88, a); ctx.beginPath(); ctx.arc(ex, ey, lw * 0.7 + 0.6 * _dpr, 0, 6.2832); ctx.fill();   // hot tip
      }
    }
    if (!lite) { curtain(0, (N * 0.7) | 0, 0.5); curtain(1, (N * 0.7) | 0, 0.5); }   // PARALLAX back layer first (depth)
    curtain(0, N, 1); curtain(1, N, 1);                                              // TOP (falls down) + BOTTOM front layer — fills the empty top the user flagged
    if (!lite) { curtain(2, (N * 0.62) | 0, 1); curtain(3, (N * 0.62) | 0, 1); }     // + side curtains for full-screen coverage
    // a faint time-domain oscilloscope across the middle (the original "waveform along the whole background") — low alpha so the lane stays readable
    if (!lite && _wave) {
      var amp = Math.min(w, h) * 0.055 * (0.5 + _energy * 0.8 + beat * 0.6), midY = h * 0.5, M = 150, bs = Math.max(1, (_wave.length / M) | 0);
      ctx.beginPath();
      for (var c2 = 0; c2 <= M; c2++) { var s2 = (_wave[Math.min(_wave.length - 1, c2 * bs)] - 128) / 128, x2 = (c2 / M) * w, y2 = midY + s2 * amp + Math.sin(c2 * 0.2 + _t) * amp * 0.3; if (c2 === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2); }
      ctx.lineWidth = (1 + beatPunch * 1.5) * _dpr; ctx.strokeStyle = _hsl(hueBase, 90, 62, 0.13 + comboGlow * 0.18); ctx.stroke();
    }
    ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────────────────── EMBER (Ember Drift) — a dense, busy particle STORM: populates EVERYWHERE, bursts on the beat, grows + morphs color + falls ──
  function _newEmber(w, h, burst) {
    var e = { x: w * (0.5 + (Math.random() - 0.5) * (0.5 + bassN * 0.5)), y: h * (0.86 + Math.random() * 0.12), vx: 0, vy: 0, spd: Math.random(),   // build67: spawn LOW + toward center = the base of a FIRE (an updraft column, narrow at dead-center)
      life: 0, maxlife: 0.8 + Math.random() * 2.4, z: Math.pow(Math.random(), 1.4),
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 2.6, hue: Math.random() * 28,
      kind: (Math.random() < 0.58 ? 0 : Math.random() < 0.78 ? 1 : 2), vb: 0 };   // 0 ember streak · 1 petal · 2 spark
    e.vb = e.kind === 1 ? (0.5 + Math.random() * 0.6) : e.kind === 0 ? -(0.55 + Math.random() * 0.6) : (Math.random() - 0.5) * 0.5;   // petals FALL, embers rise, sparks drift
    if (burst) {   // a beat ERUPTION — a fast UPWARD fountain from the floor, short-lived + bright
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.4, s = (2.2 + beatPunch * 7) * _dpr;
      e.x = burst.x; e.y = burst.y; e.vx = Math.cos(ang) * s; e.vy = Math.sin(ang) * s; e.vb = (Math.random() - 0.5) * 0.4;
      e.z = 0.55 + Math.random() * 0.45; e.maxlife = 0.5 + Math.random() * 0.9; e.kind = Math.random() < 0.7 ? 2 : 0;
    }
    return e;
  }
  // a cached warm radial GLOW sprite — drawImage'd per particle for cheap volumetric fullness (the pro way to make a sparse field read as a busy STORM)
  function _emberGlow() {
    if (_state.spr) return _state.spr;
    var s = document.createElement('canvas'); s.width = s.height = 64;
    var c = s.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,246,224,1)'); g.addColorStop(0.32, 'rgba(255,176,86,0.6)'); g.addColorStop(0.7, 'rgba(214,74,28,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    _state.spr = s; return s;
  }
  function drawEmber(dt, st) {
    var w = _w, h = _h, lite = _lite();
    var P = _state.p;
    if (!P || _state.dirty) { var N = lite ? 260 : 440; P = _state.p = []; for (var i = 0; i < N; i++) { var e0 = _newEmber(w, h); e0.y = Math.random() * h; P.push(e0); } if (!lite) P.sort(function (a, b) { return a.z - b.z; }); _state.dirty = false; _state.bcd = 0; _state.erupted = 0; }   // initial fill spread vertically; respawns rise from the floor
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,' + (0.17 + 0.08 * beat) + ')'; ctx.fillRect(0, 0, w, h);   // PURE-BLACK trail — empties decay to TRUE black (rgba(6,5,4) left a faint warm rectangle vs the black gutters = the "box" the owner saw ONLY on ember)
    ctx.globalCompositeOperation = 'lighter';
    // ambient bass BLOOM — the whole frame breathes on the low end so it's never "blank" between beats
    if (!lite) {
      var amb = 0.12 + bass * 0.55 + comboGlow * 0.3, ar = _hslToRgb(comboHue, 80, 42);
      var ag = ctx.createRadialGradient(w * 0.5, h * 0.6, 0, w * 0.5, h * 0.6, Math.max(w, h) * 0.72);
      ag.addColorStop(0, 'rgba(' + ar[0] + ',' + ar[1] + ',' + ar[2] + ',' + (0.06 * amb) + ')'); ag.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ag; ctx.fillRect(0, 0, w, h);
    }
    // ember BED — one stretched glow sprite along the floor = the glowing base of the fire
    if (!lite) { var bedH = h * 0.14 * (0.7 + bass * 0.6 + comboGlow * 0.5); ctx.globalAlpha = clamp(0.12 + bass * 0.4, 0, 0.6); ctx.drawImage(_emberGlow(), 0, h * 0.93 - bedH * 0.5, w, bedH); ctx.globalAlpha = 1; }
    // beat ERUPTION — a fountain bursts UP from the floor near center (not a random interior pop)
    _state.bcd -= dt;
    if (beatPunch > 0.30 && _state.bcd <= 0) {
      _state.bcd = 0.11;
      var bx = w * (0.5 + (Math.random() - 0.5) * 0.4), by = h * 0.90, bn = lite ? 14 : 32, s0 = (Math.random() * P.length) | 0;
      for (var q = 0; q < bn; q++) { var qi = (s0 + q) % P.length; P[qi] = _newEmber(w, h, { x: bx, y: by }); }
    }
    // SECTION eruption — a one-shot floor blast on a section change (shares the spin-reverse vocabulary via _spinDir below)
    if (_secPulse > 0.9 && !_state.erupted) { _state.erupted = 1; var bn2 = lite ? 30 : 60; for (var z = 0; z < bn2; z++) { var zi = (z * 7) % P.length; P[zi] = _newEmber(w, h, { x: w * 0.5, y: h * 0.92 }); } }
    if (_secPulse < 0.3) _state.erupted = 0;
    var sp = _t * 0.5 * _spinDir, turb = 0.55 + bassN * 2.2 + beat * 1.4 + (st.od || 0) * 1.6, rise = (18 + bass * 95 + _energy * 42) * _dpr, spr = _emberGlow(), EMBER_PAL = { base: 0, span: 50 };   // sp*_spinDir = the curl flow REVERSES on a section change; od → white-hot crescendo
    function Pot(px, py) { return Math.sin(px * 0.004 + sp) * Math.cos(py * 0.004 - sp * 0.8) + (lite ? 0 : 0.5 * Math.sin(px * 0.0012 - sp * 0.5) * Math.cos(py * 0.0012 + sp * 0.4)); }
    for (var k = 0; k < P.length; k++) {
      var e = P[k];
      var tvx = (Pot(e.x, e.y + 1) - Pot(e.x, e.y - 1)) * turb * 52 * _dpr, tvy = -(Pot(e.x + 1, e.y) - Pot(e.x - 1, e.y)) * turb * 52 * _dpr;
      e.vx = lerp(e.vx, tvx, 0.06); e.vy = lerp(e.vy, tvy, 0.06);   // burst velocity decays INTO the curl flow over ~0.7s
      var driftZ = rise * (0.4 + e.z * 1.1);   // near particles move faster + bigger = depth/vertigo
      var cxn = e.x / w - 0.5;   // BUOYANCY — net updraft, strongest in the central column (narrow at center) = a real fire, not omnidirectional haze
      e.vy -= (0.6 + bass * 1.2) * driftZ * dt * clamp(1 - Math.abs(cxn) * 1.3, 0, 1); e.vx -= cxn * 0.4 * driftZ * dt;
      e.x += e.vx; e.y += e.vy + e.vb * driftZ * dt; e.rot += e.vr * dt * (0.4 + e.z);
      e.life += dt;
      if (e.life >= e.maxlife || e.y < -24 || e.y > h + 24) { P[k] = _newEmber(w, h); continue; }
      if (e.x < -20) e.x = w + 16; else if (e.x > w + 20) e.x = -16;
      var lt = e.life / e.maxlife, envb = Math.sin(lt * 3.14159);   // grow → peak → dim over the particle's life
      var bright = envb * (0.42 + level * 0.7 + beatPunch * 0.6) * (0.6 + comboGlow * 0.7);
      var flameY = clamp(e.y / h * 1.5 - 0.1, 0, 1), flameX = clamp(1.5 - Math.abs(e.x / w - 0.5) * 2.4, 0, 1);   // FLAME envelope — dark at the TOP + a central column, bright at the floor → reads as FIRE, not a uniform lit "box" (the owner's ember-box)
      bright *= flameY * (0.4 + 0.6 * flameX);
      if (bright < 0.012) continue;
      var grow = 0.7 + lt * 0.9, sz = (1.0 + e.z * 4.8) * _dpr * grow * (1 + beatPunch * 0.5 * e.z);
      var yn = clamp(1 - e.y / h, 0, 1), heat = clamp((1 - yn) * 0.5 + bassN * 0.4 + beatPunch * 0.5 + comboGlow * 0.3 + 0.15, 0, 1);   // THERMAL — hottest (white) at the floor → crimson at the rising tips
      var hue = _warmHue(heat, EMBER_PAL, 0), sat = _heatS(heat), lcol = clamp(_heatL(heat, 42) + envb * 8, 38, 99);
      var a = clamp(bright * (0.4 + e.z * 0.7), 0, 1), col = _hsl(hue, sat, lcol, a);
      if (spr) {   // soft volumetric glow halo (cached sprite) — turns a sparse field into a BUSY, full storm; cheap (one drawImage)
        var gd = sz * (4.0 + e.z * 2.0); ctx.globalAlpha = clamp(a * 0.72, 0, 1);
        ctx.drawImage(spr, e.x - gd * 0.5, e.y - gd * 0.5, gd, gd); ctx.globalAlpha = 1;
      }
      if (e.z < 0.34 && bright < 0.5) continue;   // PERF: far/dim particles are glow-only — skip the crisp core draw (near-invisible saving, ~40% fewer stroke/arc ops)
      if (e.kind === 1 && !lite) {   // petal — a small rotated teardrop that tumbles
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rot); ctx.fillStyle = col;
        ctx.beginPath(); ctx.ellipse(0, 0, sz * 0.7, sz * 1.8, 0, 0, 6.2832); ctx.fill(); ctx.restore();
      } else if (e.kind === 2) {   // spark — a hot dot with a cross glint at peak
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(e.x, e.y, sz * 0.5, 0, 6.2832); ctx.fill();
        if (!lite && bright > 0.5) { ctx.strokeStyle = _hsl(hue, 70, 93, a * 0.7); ctx.lineWidth = _dpr; var gl2 = sz * 1.7; ctx.beginPath(); ctx.moveTo(e.x - gl2, e.y); ctx.lineTo(e.x + gl2, e.y); ctx.moveTo(e.x, e.y - gl2); ctx.lineTo(e.x, e.y + gl2); ctx.stroke(); }
      } else {   // ember — an elongated streak along velocity + a hot head
        var vlen = Math.min(1, Math.hypot(e.vx, e.vy) / 7);
        ctx.strokeStyle = col; ctx.lineWidth = sz * 0.9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - e.vx * (1.5 + vlen * 3), e.y - e.vy * (1.5 + vlen * 3)); ctx.stroke();
        ctx.fillStyle = _hsl(hue, sat, Math.min(98, lcol + 16), a); ctx.beginPath(); ctx.arc(e.x, e.y, sz * 0.5, 0, 6.2832); ctx.fill();
      }
    }
    ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────────────────── KALEIDOSCOPE (First Light / Steady Hands) — N-fold MIRROR symmetry built from glowing particles that MORPHS its geometry through the song ──
  // Owner direction: "in the back it just looks like lines and blocks… I'd want it to change geometry mid-song — think of a kaleidoscope."
  // So: no lines — glowing motifs reflected in rotational+mirror symmetry; the segment count snaps to a new value on section onsets (eased, never jarring).
  function drawKaleido(dt, st, flavor) {
    var w = _w, h = _h, lite = _lite(), cx = w * 0.5, cy = h * 0.5;
    // FAM = the symmetry FAMILY (the structural identity); PAL = the warm palette WINDOW (base+span <= 44 so combo+travel still fit under 58).
    var FAM = flavor
      ? { segOpts: [8, 10, 12], spinMul: 0.55, motif: 'leaf',  ringN: 3, spokeAlpha: 0.16, breatheHz: 0.30, breatheAmp: 0.45 }   // Steady Hands — a woven GOLD even-fold lattice; SLOW + deliberate
      : { segOpts: [5, 7, 9],   spinMul: 0.85, motif: 'spike', ringN: 2, spokeAlpha: 0.30, breatheHz: 0.60, breatheAmp: 0.20 };  // First Light — a sharp CRIMSON odd-fold star
    var PAL = flavor ? { base: 22, span: 22, lightBase: 50 } : { base: 0, span: 24, lightBase: 44 };
    var K = _state.k;
    if (!K || _state.dirty) {
      var KN = lite ? 5 : 7;
      K = _state.k = []; for (var i = 0; i < KN; i++) K.push({ band: Math.random(), ar: 0.28 + Math.random() * 0.62, aa: Math.random() * 6.2832, sz: 0.5 + Math.random() * 0.9, ph: Math.random() * 6.28 });
      _state.dirty = false; _state.krot = 0; _state.kav = 0; _state.kavT = 0; _state.kmorph = 0; _state.kcd = 2; _state.hueShift = 0; _state.kphase = 0;   // init ALL — _state is reseeded on set(), undefined → NaN poison
      _state.kseg = FAM.segOpts[0]; _state.ksegT = _state.kseg; _state.ksegIdx = 0;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,' + (0.30 + 0.14 * beat) + ')'; ctx.fillRect(0, 0, w, h);   // PURE-BLACK trail
    ctx.globalCompositeOperation = 'lighter';
    var spN = lite ? 28 : 44, sp = _spec(spN), glow = lite ? null : _emberGlow();
    // SIGNED EASED SPIN — eases toward _spinDir*speed, so a section change DECELERATES through 0 and counter-rotates (not a teleport) + a section whip.
    var spd = (0.08 + bass * 0.30 + beat * 0.22 + comboGlow * 0.32 + (st.od || 0) * 0.45) * FAM.spinMul;   // calmer — owner: "they spin really fast, a little jarring" (was ~2x this)
    _state.kavT = _spinDir * spd; _state.kav = lerp(_state.kav, _state.kavT, Math.min(1, dt * 1.8));
    _state.krot = (_state.krot || 0) + (_state.kav + _secPulse * _spinDir * 2.5) * dt;   // gentler section "whip" (was *6)
    // GEOMETRY + PALETTE MORPH on the SAME section event (so direction + fold + hue flip together).
    _state.kcd -= dt;
    if (_secPulse > 0.6 && _state.kcd <= 0) { _state.kcd = 3; var o = FAM.segOpts; _state.ksegIdx = (_state.ksegIdx + 1) % o.length; _state.ksegT = o[_state.ksegIdx]; _state.kmorph = 1; _state.hueShift = (_state.hueShift + (flavor ? 12 : 18)) % 48; }
    _state.kseg += (_state.ksegT - _state.kseg) * Math.min(1, dt * 0.9); _state.kmorph *= 0.90;
    var segCap = lite ? 6 : 10, seg = Math.max(4, Math.min(segCap, Math.round(_state.kseg))), segAng = 6.2832 / seg, rot = _state.krot;
    var breathe = FAM.breatheAmp / 2 + 0.78 + FAM.breatheAmp * Math.sin(_t * FAM.breatheHz) + bassN * 0.30 + _kick * 0.55;   // whole pattern SCALES/zooms with the kick + bass
    _state.kphase += (0.04 + trebleN * 0.10 + comboGlow * 0.06) * dt;
    var travelDeg = (Math.sin(_state.kphase) * 0.5 + 0.5) * (flavor ? 10 : 7) + _state.hueShift * 0.2;   // phrase hue TRAVEL within the warm budget
    // ── MANDALA SKELETON (cy-anchored radii so the note lane stays readable) ──
    var rIn = cy * 0.34; ctx.lineCap = 'round';
    for (var s2 = 0; s2 < seg; s2++) {                              // SPOKES on the wedge seams — makes seg 5→8 finally VISIBLE
      var a0 = rot + s2 * segAng, rOut = cy * (0.55 + 0.7 * breathe);
      ctx.strokeStyle = _hsl(_warmHue(0.2 + midN * 0.5, PAL, travelDeg), 85, 46 + midN * 22, FAM.spokeAlpha + 0.22 * midN + 0.18 * beatPunch + 0.3 * _state.kmorph);
      ctx.lineWidth = (0.6 + 1.8 * midN + beatPunch * 2.2) * _dpr;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a0) * rIn, cy + Math.sin(a0) * rIn); ctx.lineTo(cx + Math.cos(a0) * rOut, cy + Math.sin(a0) * rOut); ctx.stroke();
    }
    var ringN = lite ? 1 : FAM.ringN;
    for (var ri = 0; ri < ringN; ri++) {                           // concentric per-band RINGS
      var rv = sp[(((ri + 1) / 4) * spN) | 0] || 0, rad = cy * (0.40 + ri * 0.34) * breathe * (0.9 + rv * 0.5);
      ctx.strokeStyle = _hsl(_warmHue(0.25 + ri * 0.18 + rv * 0.3, PAL, travelDeg), 88, 52 + rv * 30, 0.08 + rv * 0.5 + beatPunch * 0.2);
      ctx.lineWidth = (0.8 + rv * 4) * _dpr; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.stroke();
    }
    if (glow) { var hd = cy * (0.12 + bassN * 0.10); ctx.globalAlpha = clamp((0.2 + 0.5 * bassN) * _kick, 0, 0.6); ctx.drawImage(glow, cx - hd, cy - hd, hd * 2, hd * 2); ctx.globalAlpha = 1; }   // bass HUB (decays to black between hits)
    if (_state.kmorph > 0.05) {                                     // morph SHOCKWAVE — "geometry reconfigured" is felt
      var swr = cy * (0.4 + (1 - _state.kmorph) * 0.9);
      ctx.strokeStyle = _hsl(_warmHue(0.6, PAL, travelDeg), 90, 70, 0.5 * _state.kmorph); ctx.lineWidth = (2 + 6 * _state.kmorph) * _dpr;
      ctx.beginPath(); ctx.arc(cx, cy, swr, 0, 6.2832); ctx.stroke();
    }
    // ── RADIAL SPECTRUM EQ (the reactivity IS the structure) — heaviest add: !lite only, capped, dropped first under soft-lite ──
    if (!lite && !_soft) {
      var B = 8, rInner = cy * 0.42 * breathe, kickScale = 1 + _kick * 0.8;
      for (var es = 0; es < seg; es++) for (var b2 = 0; b2 < B; b2++) {
        var frac = b2 / (B - 1), ev = sp[((frac * 0.9 + 0.05) * spN) | 0] || 0, barLen = cy * (0.08 + ev * ev * 0.42) * kickScale;
        for (var em = 0; em < 2; em++) {
          var ea = rot + es * segAng + (em ? (segAng - frac * segAng * 0.9) : frac * segAng * 0.9);
          var ex0 = cx + Math.cos(ea) * rInner, ey0 = cy + Math.sin(ea) * rInner, ex1 = cx + Math.cos(ea) * (rInner + barLen), ey1 = cy + Math.sin(ea) * (rInner + barLen);
          ctx.strokeStyle = _hsl(_warmHue(0.1 + frac * 0.5 + ev * 0.2, PAL, travelDeg), 92, 50 + ev * 34, 0.18 + ev * 0.7); ctx.lineWidth = (1 + ev * 3) * _dpr;
          ctx.beginPath(); ctx.moveTo(ex0, ey0); ctx.lineTo(ex1, ey1); ctx.stroke();
        }
      }
    }
    // ── CHIRAL JEWELS — teardrop/spike oriented along the radial; the MIRROR negates the perpendicular so the seam is visible (a dot can't show a mirror) ──
    for (var m = 0; m < K.length; m++) {
      var e = K[m], v = sp[(e.band * spN) | 0] || 0;
      var rr = (e.ar + 0.09 * Math.sin(_t * 0.6 + e.ph)) * cy * 1.15 * breathe * (0.88 + 0.5 * v);
      var size = (6 + e.sz * 22) * _dpr * (0.5 + v * 1.4 + _kick * 1.1);
      var heat = clamp(0.20 + v * 0.7 + beatPunch * 0.45 + comboGlow * 0.35 + (st.od || 0) * 0.5, 0, 1);
      var bright = clamp(0.22 + v * 0.95 + comboGlow * 0.4, 0, 1); if (bright < 0.04) continue;
      var o = e.aa % segAng, jhue = _warmHue(heat, PAL, travelDeg), jl = _heatL(heat, PAL.lightBase), js = _heatS(heat);
      for (var sgi = 0; sgi < seg; sgi++) {
        var base = rot + sgi * segAng;
        for (var mir = 0; mir < 2; mir++) {
          var ang = base + (mir ? (segAng - o) : o);
          var px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
          if (glow && bright > 0.32) { var gd = Math.min(cy * 0.5, size * 1.7); ctx.globalAlpha = clamp(bright * 0.55, 0, 1); ctx.drawImage(glow, px - gd * 0.5, py - gd * 0.5, gd, gd); ctx.globalAlpha = 1; }
          ctx.fillStyle = _hsl(jhue, js, jl, bright);
          var dirX = Math.cos(ang), dirY = Math.sin(ang), perpX = -dirY * (mir ? -1 : 1), perpY = dirX * (mir ? -1 : 1);
          if (lite) { ctx.beginPath(); ctx.arc(px, py, size * 0.42, 0, 6.2832); ctx.fill(); }
          else if (FAM.motif === 'spike') { ctx.beginPath(); ctx.moveTo(px + dirX * size, py + dirY * size); ctx.lineTo(px + perpX * size * 0.5, py + perpY * size * 0.5); ctx.lineTo(px - dirX * size * 0.5, py - dirY * size * 0.5); ctx.closePath(); ctx.fill(); }
          else { ctx.beginPath(); ctx.moveTo(px + dirX * size, py + dirY * size); ctx.quadraticCurveTo(px + perpX * size * 0.9, py + perpY * size * 0.9, px - dirX * size * 0.7, py - dirY * size * 0.7); ctx.quadraticCurveTo(px - perpX * size * 0.5, py - perpY * size * 0.5, px + dirX * size, py + dirY * size); ctx.fill(); }
        }
      }
    }
    ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
  }

  var RENDERERS = { warp: drawWarp, fractal: drawWarp, waveform: drawWaveform, ember: drawEmber,   // warp/waveform kept registered (future use); the Easy levels now use the kaleidoscope
    kaleido: function (dt, st) { return drawKaleido(dt, st, 0); }, kaleido2: function (dt, st) { return drawKaleido(dt, st, 1); } };

  function _drawOnce(dt) {
    _t += dt;
    var st;
    if (_fed) { _energy = 1; st = { combo: _fedCombo, playing: true, tier: _fedTier, od: od }; }
    else { _energy = lerp(_energy, _playing ? 1 : 0.25, 0.05); _readAudio(); st = _readStats(); }
    // SECTION / TEMPO-CHANGE detector — MUST live here (runs in BOTH fed + live paths); _readAudio is SKIPPED when _fed, so it can't go there.
    _secFast = lerp(_secFast, level, 0.22); _secSlow = lerp(_secSlow, level, 0.015); _secPulse *= 0.90;
    if (Math.abs(_secFast - _secSlow) > 0.18 && (_t - _lastSection) > 5.5 && beatPunch > 0.42) { _lastSection = _t; _spinDir *= -1; _secPulse = 1; }   // a real section change → flip the spin + fire a one-shot pulse
    if (beatPunch > _kick) _kick = beatPunch; else _kick *= 0.80;   // fast-attack beat env → instant pump that snaps back
    (RENDERERS[_type] || drawWaveform)(dt, st);
    if (!_reduce()) _punch(st);
    _vignette();
    _audioDbg = { bass: bass, mid: mid, treble: treble, bassN: bassN, level: level, beat: beat, beatPunch: beatPunch, od: od, comboHue: comboHue, comboGlow: comboGlow, combo: st.combo, tier: st.tier, spinDir: _spinDir, secPulse: _secPulse, kick: _kick };
  }
  function _frame(now) {
    _raf = 0;
    if (!_type || !cv) return;
    // suspend the rAF when we're not on the game screen (inactive screens are opacity:0 NOT display:none, so offsetParent stays
    // non-null — the canvas would otherwise render FOREVER + bleed onto menu/jukebox/results). Restarts on set()/play()/resume().
    var g = document.getElementById('game');
    if (cv.offsetParent === null || (g && !g.classList.contains('active'))) { if (++_hidden > 24) return; } else _hidden = 0;
    if (!_fed && cv.clientWidth && Math.abs(cv.clientWidth * _dpr - _w) > 2) _resize();   // auto-correct if the laid-out size changed (set() may have run before #game-bg was full-size)
    var dt = _last ? Math.min(0.05, (now - _last) / 1000) : 0.016; _last = now;
    if (dt > 0.024) { if (++_slowF > 30) _soft = 1; } else { _slowF = 0; }   // soft-lite watchdog: 30 sustained slow frames → drop the heaviest add (the kaleido EQ ring)
    try { _drawOnce(dt); } catch (e) {}
    _raf = requestAnimationFrame(_frame);
  }
  function _start() { if (!_raf && _type && _ensureCanvas()) { _last = 0; _raf = requestAnimationFrame(_frame); } }
  function _stopRaf() { if (_raf) { cancelAnimationFrame(_raf); _raf = 0; } }

  window.RhythmProcBg = {
    set: function (type) {
      type = (type && RENDERERS[type]) ? type : null;
      _type = type; _state = { dirty: true };
      bass = mid = treble = level = beat = beatPunch = 0; bassN = midN = trebleN = 0; comboHue = 0; comboGlow = 0; od = 0;
      _spinDir = 1; _secFast = 0; _secSlow = 0; _secPulse = 0; _lastSection = -99; _kick = 0;   // fresh section/spin state per level (don't inherit the previous level's direction or a stale cooldown)
      _fluxMean = 0; _fluxVar = 1; _lastBeat = 0; _prevFreq = null; _mx = { b: 0.15, m: 0.15, t: 0.15 };
      // toggle the solid-black backdrop base on the ROOT element — tied to the canvas being active, so EVERY path that
      // activates a reactive backdrop gets it (kills the warm-gradient + scrim "lines and blocks" the owner can't stand).
      try { document.documentElement.classList[type ? 'add' : 'remove']('rr-procbg-on'); } catch (e) {}
      if (!_ensureCanvas()) return;
      if (type) { cv.style.display = 'block'; cv.style.width = ''; cv.style.height = ''; _resize(); _hidden = 0; _start(); }
      else { _stopRaf(); cv.style.display = 'none'; try { if (ctx) ctx.clearRect(0, 0, _w, _h); } catch (e) {} }
    },
    play: function () { _playing = true; _hidden = 0; _start(); },
    pause: function () { _playing = false; },
    resume: function () { _playing = true; _hidden = 0; _start(); },
    stop: function () { _playing = false; },
    active: function () { return !!_type; },
    types: function () { var k = []; for (var t in RENDERERS) k.push(t); return k; },
    tick: function () { if (!_type) return 'no-type'; if (!_ensureCanvas()) return 'no-canvas'; try { _drawOnce(0.016); return 'ok'; } catch (e) { return 'ERR: ' + ((e && e.message) || e); } },
    procAudio: function () { return _audioDbg; },
    _feed: function (o) {
      o = o || {};
      if (o.w && cv) { cv.width = o.w | 0; cv.height = (o.h | 0) || 720; cv.style.width = o.w + 'px'; cv.style.height = (o.h || 720) + 'px'; cv.style.display = 'block'; _w = cv.width; _h = cv.height; _state = { dirty: true }; }
      if (o.spec && o.spec.length) { var sn = o.spec.length; if (!_freq || _bins !== sn) { _bins = sn; _freq = new Uint8Array(sn); _wave = new Uint8Array(sn * 2); } for (var si = 0; si < sn; si++) { _freq[si] = clamp(o.spec[si] * 255, 0, 255) | 0; _wave[si * 2] = clamp(128 + (o.spec[si] - 0.5) * 200, 0, 255); _wave[si * 2 + 1] = clamp(128 - (o.spec[si] - 0.5) * 160, 0, 255); } }   // test-only: inject a fake spectrum so the waveform curtains can be verified headless
      if (o.bass != null) bass = o.bass; if (o.mid != null) mid = o.mid; if (o.treble != null) treble = o.treble; if (o.level != null) level = o.level;
      if (o.beat != null) beat = o.beat; if (o.beatPunch != null) beatPunch = o.beatPunch;
      if (o.bassN != null) bassN = o.bassN; if (o.midN != null) midN = o.midN; if (o.trebleN != null) trebleN = o.trebleN;
      if (o.comboHue != null) comboHue = o.comboHue; if (o.comboGlow != null) comboGlow = o.comboGlow; if (o.od != null) od = o.od;
      if (o.combo != null) _fedCombo = o.combo; if (o.tier != null) _fedTier = o.tier; if (o.t != null) _t = o.t;
      _fed = o.off !== true; return _fed;
    }
  };
  try { window.__rrProcAudio = function () { return _audioDbg; }; } catch (e) {}
})();
