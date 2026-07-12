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
  // ══ pkg3.0(F) LEGIBILITY CONTRACT — every Tier-I renderer obeys: ONE SIGNAL, ONE JOB ══
  //   bass   = motion SPEED          · mid  = structure INTENSITY   · treble = sparkle/DETAIL
  //   beat   = ONE discrete event    · combo = SLOW state (earned-motion floor + tier ignition/sun)
  //   OD     = white-hot override
  //   Budget: ≤1200 path ops/frame desktop, ≤450 lite. The _soft watchdog below is the enforcement.
  //   Frames open with an OPAQUE #000 clear — no translucent trail fills; tails are DRAWN per object.
  //   'lighter' glows allowed, always over true black. 1px strokes pixel-snap via (x|0)+0.5.
  //   Renderers overscan −0.04·_w … 1.04·_w so the camera tilt/zoom never reveals an edge.
  // ══ pt4 VFX-LEVELS DENSITY PASS — _soft now guards ALL THREE Tier-I renderers, not just kaleido's EQ ring ══
  //   dawn:  god-rays loop (11 drawImage/frame) skipped under _soft; stars/stars2 unaffected (cheap fillRect).
  //   weave: dust-mote loop (≤90 fillRect/frame) AND the sub-harmonic string layer both skipped under _soft (sub-harmonic is weave's heaviest new add); main strings unaffected.
  //   ember: FAR/MID per-FRAME draw ceiling halved under _soft (_densCap) — takes effect the instant _soft trips, NOT gated on a reseed (which never re-fires mid-session).
  //   New population (dawn stars2 ≤80, weave sub-harmonic strings ≤NS-1, ember FAR 140→220) stays inside the
  //   desktop budget above BECAUSE each new layer reuses a cheap primitive (1 fillRect / 1 stroke / 1 arc-fill)
  //   and array length is fixed at reseed — verify any FUTURE add against this same rule before merging.
  //   DENSITY (not just intensity) now scales per-frame via an activeFrac cutoff derived from bassN/trebleN —
  //   this SKIPS DRAWS on low-index array members when audio is quiet, it never .push/.splice (no per-frame alloc).
  // ══ build127 DEPTH+COMPOSITION PASS — fill the empty frame with FG/MG/BG layers + PLACE (owner: "lackluster, empty room") ══
  //   All new pools are allocated ONLY at the _state.dirty reseed (Float32Array / fixed-length arrays); the render
  //   loop NEVER .push/new — it walks fixed pools with index cutoffs. Every new hue is warm (crimson/amber/gold/warm-grey).
  //   dawn:  + 4 sky BANDS (4 fillRect), + AURORA ribbons (≤3×24 lineTo, dropped under _soft), + horizon LIGHTS
  //          (≤40 fillRect pool), + sun ATMOSPHERE halo (1 drawImage), + 2 parallax RIDGE silhouettes (16+26-pt pools,
  //          2 filled polylines). Ribbons+god-rays shed first under _soft; ridges/bands/lights are cheap and stay.
  //   weave: + woven-texture HAZE backdrop (3 drawImage, !lite), + NW≤18 vertical WARP threads (near pass always;
  //          FAR dim pass + intersection NODES (cap 60/24) dropped under _soft), forming a real crossing LOOM.
  //          NEAR warp ≈ 18×11 lineTo ≈ 200 ops; nodes cap-limited — the ~1200 desktop path budget still holds.
  //   ember: + AMBIENT forge-glow wash (1 radial fill), + forge COAL bed (≤46 glow+ellipse pool, the SOURCE),
  //          + layered HEAT-HAZE columns (≤7 drawImage smoke, dropped under _soft — heaviest ember add). Particle
  //          planes unchanged. Coal/ambient are cheap and always on; haze sheds under _soft.
  // ══ build139 EMBER BUSIER PASS (owner: "more movement, more particles — starting to look good") ══
  //   MORE PARTICLES (all counts set at reseed, never per-frame): FAR 220→330, MID 120→180, NEAR 40→52 desktop
  //          (lite 70/60/10 → 96/84/14). + a new RISING-SPARK pool (≤64/26) lifting off the coal bed = 1 arc().fill() each.
  //   MORE MOVEMENT: per-particle lateral SWIRL on FAR/MID drift (hoisted amp + spawn-set phase), livelier 2-sine coal
  //          FLICKER, and the rising-spark stream (continuous mod-1 rise + sin() end-fade + sine sway). All alloc-free.
  //   _soft: FAR/MID draw ceiling already halved via _densCap; the rising sparks also halve their draw count under _soft.
  //   LOOP-SEAMLESS at rest: bands/lights/coals/ridges have NO positional reset (only slow brightness breathe);
  //   ribbons/haze/warp-sway/ember-swirl use continuous sines or mod-1 rise with sin() fade at the ends → no pop at the wrap.
  //   reduce-motion: ALL new parallax/drift/rise/sway/swirl/flicker frozen (ribbons, ridge parallax, warp sway, haze rise,
  //          ember swirl + rising sparks + coal flicker).
  // ══ pkg3.0(D) CAMERA RIG — breathe/kick zoom + slow tilt + LFO drift; identity under reduce-motion ══
  var CAM = { z: 1, tilt: 0, dx: 0, dy: 0 };
  function _updateCam(dt, st) {
    if (_reduce()) { CAM.z = 1; CAM.tilt = 0; CAM.dx = 0; CAM.dy = 0; return; }
    var breathe = Math.sin(_t * 0.45) * 0.006;
    CAM.z = clamp(1 + breathe + _kick * 0.03 + (st.od || 0) * 0.012, 1, 1.05);
    CAM.tilt = clamp(Math.sin(_t * 0.07) * 0.010 + (bassN - 0.5) * 0.006, -0.024, 0.024);
    CAM.dx = Math.sin(_t * 0.05) * 0.012 * _w;    // slow LFO drifts (±1.2% / ±0.8% of frame)
    CAM.dy = Math.cos(_t * 0.037) * 0.008 * _h;
  }
  // pkg3.1 shared combo CUTAWAY state (drama earned at tier-up; dim on break) + hoisted miss envelope
  var _prevTier = 0, _cut = 0, _hold = 0, _missK = 0, _prevComboSt = 0;
  // the level's tier-up shockwave: two strokes — main ring + inner echo. p = 1-_cut (0→1 across 600ms).
  function _shockRing(p, hue, cx0, cy0) {
    var cx = cx0 != null ? cx0 : _w * 0.5, cy = cy0 != null ? cy0 : _h * 0.5;
    var maxR = Math.sqrt(_w * _w + _h * _h) * 0.5;
    var e = 1 - Math.pow(1 - p, 3), r = maxR * (0.15 + 0.85 * e);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = _hsl(hue, 92, 64, 0.85 * (1 - p)); ctx.lineWidth = (14 * (1 - p) + 2) * _dpr;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = _hsl(hue, 92, 64, 0.34 * (1 - p));
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.92, 0, 6.2832); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  // pkg3.1 earned-motion floor — combo 0 is near-still (LAW-compliant); full speed from combo 25
  function _motionFloor(st) { return 0.25 + 0.75 * clamp((st.combo || 0) / 25, 0, 1); }

  // ══ build187 RIFTFIELD — the shared Tier-I particle core (owner spec, VFX-director plan: ONE engine,
  //    three skins · Z-TUNNEL WARP vertigo · music+player BLENDED intensity · VISIBLE waveform ribbon). ══
  //    A fake-3D field of ~1900 particles streaming TOWARD the camera: bass/mid drive speed+density,
  //    treble drives twinkle, beatPunch surges the warp, and the COMBO TIER caps the top intensity —
  //    the song makes it move, the player EARNS the spectacle. Camera FOV "pull" rises with comboGlow/OD
  //    (the vertigo ladder inside the tunnel grammar). A projected time-domain WAVEFORM RIBBON (procAudio's
  //    _wave, already captured every frame — zero new plumbing) sweeps from the vanishing point toward the
  //    camera as a luminous serpent; ~25% of particle respawns seed ON the ribbon, so the field visibly
  //    condenses around the song's literal shape (O(1) per spawn, alloc-free).
  //    CONTRACTS KEPT: all pools/sprites Float32Array'd ONLY at seed; the far field is fillRect (NO path
  //    ops) walked in 4 depth-band passes (4 fillStyle sets/frame, additive 'lighter' = order-independent,
  //    no sorting); the near field is ≤~260 pre-rendered sprite stamps; the ONLY path ops are the ribbon's
  //    ≤3 polylines (~300 ops) — the ≤1200 desktop budget holds. _soft sheds: density cap 0.55× → ribbon
  //    glow pass off → near cap halved. reduce-motion: z-motion + camera pull FROZEN (the ribbon still
  //    shows the wave — it is data, not motion). Hues ride the shared warm ramp only. Headless _feed has
  //    no analyser _wave → a slow synthetic serpent stands in so captures exercise the ribbon path.
  var _RF_THEMES = {   // hue band (warm 0..58) · pool scale · base speed · lateral curl · updraft · ribbon lane/amp/mode · world spread · near-sprite lightness
    // ribMode 'depth' = the serpent recedes into the rift (ribX offsets the lane off the note highway; flat<1
    // softens the Y-perspective dive). ribMode 'weft' = a HORIZONTAL oscilloscope thread — the waveform woven
    // straight across the loom (capture review: the depth mode collapsed to a sliver at weave's center lane).
    dawn:  { hue0: 34, span: 18, count: 1.00, speed: 0.30, curl: 0.10, up: -0.020, ribY: -0.14, ribX: 0,     flat: 1.0,  ribMode: 'depth', ribAmp: 0.34, spread: 1.30, nearL: 84 },
    weave: { hue0: 28, span: 16, count: 1.00, speed: 0.34, curl: 0.16, up:  0.000, ribY: -0.06, ribX: 0,     flat: 1.0,  ribMode: 'weft',  ribAmp: 0.10, spread: 1.25, nearL: 80 },
    ember: { hue0: 6,  span: 20, count: 0.75, speed: 0.38, curl: 0.24, up: -0.055, ribY:  0.16, ribX: -0.26, flat: 0.55, ribMode: 'depth', ribAmp: 0.34, spread: 1.20, nearL: 76 }
  };
  function _rfSprite(px, rgb, coreL) {   // pre-rendered additive glow stamp (seed-time only)
    var c = document.createElement('canvas'); c.width = c.height = px;
    var x = c.getContext('2d'), g = x.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    g.addColorStop(0, 'rgba(255,250,240,' + (coreL / 100) + ')');
    g.addColorStop(0.35, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.8)');
    g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, px, px); return c;
  }
  function _rfSeed(themeKey, lite) {
    var T = _RF_THEMES[themeKey];
    var N = Math.round((lite ? 620 : 1900) * T.count);
    var R = { N: N, x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), ph: new Float32Array(N), sz: new Float32Array(N),
              rib: new Float32Array(96), heatQ: -1, cols: ['', '', '', ''], spr: null, sprB: null };
    for (var i = 0; i < N; i++) {
      R.x[i] = (Math.random() * 2 - 1) * T.spread; R.y[i] = (Math.random() * 2 - 1) * T.spread * 0.72;
      R.z[i] = 0.10 + Math.random() * 0.88; R.ph[i] = Math.random() * 6.2832; R.sz[i] = 0.55 + Math.random() * 0.9;
    }
    var mid = _hslToRgb(T.hue0 + T.span * 0.6, 88, 62);
    R.spr = _rfSprite(18, mid, 95); R.sprB = _rfSprite(44, mid, 88);
    return R;
  }
  function _rfColors(R, T, heat) {   // 4 depth-band colors, rebuilt only when the quantized heat step moves
    var q = clamp(Math.round(heat * 4), 0, 4); if (q === R.heatQ) return; R.heatQ = q;
    var hh = q / 4;
    for (var b = 0; b < 4; b++) {   // b0 = deepest/dimmest … b3 = nearest fillRect band
      var l = 30 + b * 12 + hh * 16, a = 0.20 + b * 0.16 + hh * 0.12;
      var rgb = _hslToRgb(clamp(T.hue0 + T.span * (0.25 + 0.25 * b), 0, 58), 86 - b * 6, clamp(l, 0, 92));
      R.cols[b] = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + clamp(a, 0, 0.85).toFixed(2) + ')';
    }
  }
  function _rfDraw(R, dt, st, themeKey) {
    if (!R) return;
    var T = _RF_THEMES[themeKey], reduce = _reduce(), lite = _lite();
    var mf = _motionFloor(st), missK = st.missK || 0, calm = 1 - missK * 0.4;
    // BLENDED intensity: the music breathes moment-to-moment; the combo tier CAPS the ceiling (earned show)
    var tierCap = clamp(0.55 + 0.45 * clamp((st.combo || 0) / 60, 0, 1) + (st.od || 0) * 0.15, 0.55, 1.15);
    var energy = clamp(0.30 * level + 0.55 * bassN + 0.25 * midN, 0, 1) * tierCap;
    var pull = 1 + comboGlow * 0.10 + (st.od || 0) * 0.06 + _kick * 0.02;   // FOV pull = the top of the vertigo ladder
    var f = Math.min(_w, _h) * 0.52 * pull;
    var cx = _w * 0.5 + CAM.dx * 0.4, cy = _h * 0.47 + CAM.dy * 0.4;
    // ── ribbon lateral samples: real analyser wave when live; a slow synthetic serpent under _feed/headless ──
    var n = R.rib.length;
    if (_wave && _wave.length && !_fed) {
      var stride = Math.max(1, (_wave.length / n) | 0);
      for (var ri = 0; ri < n; ri++) { var wv = (_wave[ri * stride] - 128) / 128; R.rib[ri] += (wv - R.rib[ri]) * 0.30; }
    } else {
      for (var rj = 0; rj < n; rj++) R.rib[rj] += (Math.sin(_t * 2.1 + rj * 0.24) * (0.25 + bassN * 0.75) - R.rib[rj]) * 0.12;
    }
    // ── field update + draw ──
    var speed = reduce ? 0 : T.speed * (0.20 + energy * 1.5 + beatPunch * 0.85) * mf;
    var frac = (0.60 + 0.40 * energy) * (_soft ? 0.55 : 1);            // density rides energy; _soft sheds
    var actN = Math.min(R.N, Math.round(R.N * frac));
    _rfColors(R, T, energy);
    var prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    var i, z, sx, sy, s, band, tw = trebleN;
    var nearCap = Math.round((lite ? 70 : 260) * (_soft ? 0.5 : 1)), nearDrawn = 0;
    var bloom = 1 + beatPunch * 0.5;
    for (i = 0; i < actN; i++) {                                        // advance ONCE (band passes below only draw)
      z = R.z[i] - speed * dt * (0.7 + R.sz[i] * 0.45);
      if (z <= 0.085) {                                                 // fly-past → respawn (25% ON the ribbon)
        if (Math.random() < 0.25) {
          var rr = (Math.random() * n) | 0;
          R.x[i] = R.rib[rr] * T.ribAmp * (1 + energy) + (Math.random() - 0.5) * 0.06;
          R.y[i] = T.ribY + (Math.random() - 0.5) * 0.07;
          z = 0.92 - (rr / n) * 0.72;
        } else {
          R.x[i] = (Math.random() * 2 - 1) * T.spread; R.y[i] = (Math.random() * 2 - 1) * T.spread * 0.72; z = 0.98;
        }
      }
      R.z[i] = z;
      if (!reduce) { R.x[i] += Math.sin(_t * 0.7 + R.ph[i]) * T.curl * dt * 0.35; R.y[i] += T.up * dt * mf; }
    }
    for (band = 0; band < 4; band++) {                                  // 4 depth-band fillRect passes (4 fillStyle sets)
      ctx.fillStyle = R.cols[band];
      var z0 = 0.86 - band * 0.22, z1 = z0 + 0.22 + (band === 0 ? 0.2 : 0);   // b0 covers the deep tail
      for (i = 0; i < actN; i++) {
        z = R.z[i]; if (z < z0 || z >= z1) continue;
        if (((i * 7) & 15) < 3 && Math.sin(R.ph[i] + _t * 7) < 0.6 - tw) continue;   // treble TWINKLE = strided skip, no alpha churn
        sx = cx + (R.x[i] / z) * f; if (sx < -8 || sx > _w + 8) continue;
        sy = cy + (R.y[i] / z) * f; if (sy < -8 || sy > _h + 8) continue;
        s = clamp(R.sz[i] * (0.9 / z) * _dpr, 1, 5.5) * (band === 3 ? bloom : 1);
        ctx.fillRect(sx, sy, s, s);
      }
    }
    for (i = 0; i < actN && nearDrawn < nearCap; i++) {                 // NEAR fly-past sprites — the vertigo sell
      z = R.z[i]; if (z >= 0.30) continue;
      sx = cx + (R.x[i] / z) * f; if (sx < -60 || sx > _w + 60) continue;
      sy = cy + (R.y[i] / z) * f; if (sy < -60 || sy > _h + 60) continue;
      var szp = clamp(R.sz[i] * (0.055 / z) * Math.min(_w, _h) * 0.1, 5, 88) * bloom * _dpr;
      ctx.globalAlpha = clamp((0.30 - z) * 5.5, 0, 1) * clamp(z * 9 - 0.05, 0.15, 1) * (0.5 + energy * 0.5) * calm;
      ctx.drawImage(z < 0.16 ? R.sprB : R.spr, sx - szp / 2, sy - szp / 2, szp, szp);
      nearDrawn++;
    }
    ctx.globalAlpha = 1;
    // ── the WAVEFORM RIBBON — the song's literal shape as a serpent of light receding into the rift ──
    var hue = clamp(T.hue0 + T.span * (0.4 + energy * 0.6) + comboHue * 0.3, 0, 58);
    var amp = T.ribAmp * (0.55 + energy * 0.9), sway = reduce ? 0 : Math.sin(_t * 0.4) * 0.05;
    var passes = (_soft || lite) ? 1 : 2 + ((st.od || 0) > 0.5 ? 1 : 0);
    for (var p = 0; p < passes; p++) {
      ctx.beginPath();
      for (var k = 0; k < n; k++) {
        var lx, ly;
        if (T.ribMode === 'weft') {                                     // horizontal thread of light woven across the loom
          lx = cx + ((k / (n - 1)) - 0.5) * _w * 0.94;
          ly = cy + T.ribY * f + R.rib[k] * amp * f * 3.2 + (p === 2 ? 4 * _dpr : 0) + sway * f * 0.4;
        } else {                                                        // serpent receding into the rift (dawn helix / ember off-axis coil)
          var zr = 0.92 - (k / (n - 1)) * 0.72;
          lx = (T.ribX + R.rib[k] * amp + sway * (1 - zr)) / zr * f + cx;
          ly = (T.ribY + (p === 2 ? 0.03 : 0)) / zr * f * T.flat + cy;
        }
        if (k === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
      }
      if (p === 0 && passes > 1) {                                      // wide soft glow under the core
        ctx.strokeStyle = _hsl(hue, 88, 58, (0.07 + level * 0.14) * calm); ctx.lineWidth = 10 * _dpr;
      } else if (p === 2) {                                             // OD echo — a second harmonic shadow
        ctx.strokeStyle = _hsl(clamp(hue + 8, 0, 58), 92, 70, 0.16 * calm); ctx.lineWidth = 1.6 * _dpr;
      } else {                                                          // luminous core
        ctx.strokeStyle = _hsl(hue, 90, 62 + energy * 20, (0.26 + level * 0.44) * calm); ctx.lineWidth = 2.2 * _dpr;
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = prevOp;
  }

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
    _dpr = _lite() ? 1 : Math.min(1.5, window.devicePixelRatio || 1);   // pkg3.0(A) CRISP: 1.5 cap (was 1.1) — cost paid back by deleting the per-frame cv.style.filter blur (3.0 C)
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
    // pkg3.1: comboGlow re-tuned STEPPED-then-eased on the tier ladder — the between-tier base is stable, so a
    // tier-up (and its cutaway) reads as the event (the old continuous combo/200 ramp made tier-ups invisible).
    comboGlow = lerp(comboGlow, clamp(clamp(tier / 5, 0, 1) + od * 0.5, 0, 1), 0.06);
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

  // ───────────────────────── EMBER (Ember Drift) — pkg3.2 FIRESTORM DRIVE (in-place rewrite; key stays 'ember') ──
  //  Radial OUTFLOW from a vanishing point (the starfield z-illusion, bass = the accelerator): three planes
  //  FAR/MID/NEAR drawn back-to-front over an OPAQUE #000 clear — motion is DRAWN (per-object streaks), never
  //  smeared (3.0 contract; the per-frame cv.style.filter blur + EMBER_MODES css-tone cycling are DELETED).
  //  Beat = ONE eruption AT the VP; tier-up cutaway = shockwave + the palette MODE advance (earned, not a timer).
  var EMBER_MODES = [
    { pal: { base: 0,  span: 46 }, smoke: 0.12, spark: 0.22 },   // 0 Ember — crimson→amber
    { pal: { base: 22, span: 30 }, smoke: 0.08, spark: 0.34 },   // 1 Gold Rush — amber→gold, sparkly
    { pal: { base: 0,  span: 18 }, smoke: 0.12, spark: 0.10 },   // 2 Smolder — deep crimson, smoky
    { pal: { base: 6,  span: 52 }, smoke: 0.06, spark: 0.40 }    // 3 Inferno — hot, dense sparks
  ];
  var _FS_FLOW = [0.25, 0.6, 1.6];   // FAR / MID / NEAR outflow rates
  // (re)seed an ember NEAR the VP (radius 0.05–0.25·h). layer: 0 far · 1 mid · 2 near. burst = outward speed px/s.
  function _fsSpawn(e, layer, mix, burst) {
    var ang = Math.random() * 6.2832, r0 = (0.05 + Math.random() * 0.20) * _h;
    e.x = _w * 0.5 + Math.cos(ang) * r0; e.y = _h * 0.58 + Math.sin(ang) * r0;
    e.vx = burst ? Math.cos(ang) * burst : 0; e.vy = burst ? Math.sin(ang) * burst : 0;
    e.life = 0; e.maxlife = 2.2 + Math.random() * 3.2; e.z = Math.random(); e.gold = false;
    e.sw = Math.random() * 6.2832; e.swf = 0.5 + Math.random() * 1.1;   // build139: per-particle swirl phase + freq → gentle lateral turbulence (alloc-free; only mutates e, never a new object)
    var r = Math.random();
    e.kind = layer === 1 ? (r < mix.smoke ? 2 : r < mix.smoke + mix.spark ? 1 : 0) : 0;   // smoke/spark live on MID only
    e.px1 = e.px2 = e.x; e.py1 = e.py2 = e.y;   // NEAR streak memory (drawn tails)
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
  // a soft, wide, warm-grey SMOKE puff sprite — fills the black negative space so the field reads full (no "box")
  function _smokeSprite() {
    if (_state.smk) return _state.smk;
    var s = document.createElement('canvas'); s.width = s.height = 96;
    var c = s.getContext('2d'), g = c.createRadialGradient(48, 48, 0, 48, 48, 48);
    g.addColorStop(0, 'rgba(150,96,60,0.5)'); g.addColorStop(0.45, 'rgba(96,52,34,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 96, 96); _state.smk = s; return s;
  }
  function drawEmber(dt, st) {
    var w = _w, h = _h, lite = _lite(), reduce = _reduce();
    var VPX = w * 0.5, VPY = h * 0.58, mf = _motionFloor(st), missK = st.missK || 0, calm = 1 - missK * 0.4;
    // ── seed / reseed (level switch sets _state.dirty — the _state.dirty reset pattern) ──
    var S = _state.fs;
    if (!S || _state.dirty) {
      _state.dirty = false; _state.fmode = 0; _state.bcd = 0; _state.cutFired = 0;
      _state.fmix = { base: EMBER_MODES[0].pal.base, span: EMBER_MODES[0].pal.span, smoke: EMBER_MODES[0].smoke, spark: EMBER_MODES[0].spark };
      // pt4: FAR 140→220 desktop (cheapest draw — 1 arc().fill() each, see L~378) — reads as a full "storm" at negligible cost.
      // pt4 PERF GUARD: array stays full-sized here; _soft relief is applied per-FRAME as a draw cap (see _densCap below), NOT at reseed —
      //   _soft flips mid-session and never re-dirties _state, so a reseed-time halving would never fire for a machine that slows down while already in ember.
      // build139 BUSIER PASS (owner: "more movement, more particles"): FAR 220→330, MID 120→180, NEAR 40→52 desktop.
      //   FAR is the cheapest draw (1 arc().fill() each) so the +110 far sparks add real DEPTH/populate at negligible
      //   cost; MID +60 fills the mid plane. Lite counts bump only modestly (70→96 / 60→84 / 10→14) so slow machines
      //   stay light — and _densCap (see below) still halves the FAR/MID per-FRAME draw ceiling the instant _soft trips.
      var nF = lite ? 96 : 330, nM = lite ? 84 : 180, nN = lite ? 14 : 52, si, e0;
      S = _state.fs = { far: [], mid: [], near: [], coals: [], haze: [], rise: [] };
      for (si = 0; si < nF; si++) { e0 = _fsSpawn({}, 0, _state.fmix); e0.x = Math.random() * w; e0.y = Math.random() * h; e0.life = Math.random() * e0.maxlife; S.far.push(e0); }
      for (si = 0; si < nM; si++) { e0 = _fsSpawn({}, 1, _state.fmix); e0.x = Math.random() * w; e0.y = Math.random() * h; e0.life = Math.random() * e0.maxlife; S.mid.push(e0); }
      for (si = 0; si < nN; si++) { e0 = _fsSpawn({}, 2, _state.fmix); e0.x = Math.random() * w; e0.y = Math.random() * h; e0.px1 = e0.px2 = e0.x; e0.py1 = e0.py2 = e0.y; S.near.push(e0); }
      // build127: SOURCE + VOLUME PASS — new fixed pools (alloc ONLY here at reseed). A glowing forge COAL bed along
      // the bottom gives the embers an origin; layered HAZE columns give the smoke real volume (not just dots).
      var nC = lite ? 22 : 46; for (si = 0; si < nC; si++) S.coals.push({ x: Math.random(), w: 0.02 + Math.random() * 0.06, ph: Math.random() * 6.28, h0: 0.5 + Math.random() * 0.9 });   // xf, size, flicker phase, brightness
      var nH = lite ? 3 : 7; for (si = 0; si < nH; si++) S.haze.push({ x: 0.08 + Math.random() * 0.84, rise: 0, sp: 0.10 + Math.random() * 0.14, sz: 0.5 + Math.random() * 0.7, ph: Math.random() * 6.28 });   // rising smoke columns
      // build139: RISING-SPARK STREAM (alloc ONLY here) — a fixed pool of sparks that lift OFF the coal bed and float up
      //   with lateral sway, tying the embers to their forge SOURCE and adding constant gentle upward motion. Each rise
      //   is a continuous 0..1 progress (mod-1, sin() end-fade → LOOP-SEAMLESS, no pop); drawn as ONE cheap arc().fill().
      //   xf = base column across the frame, sp = rise speed, sway/swf = lateral swirl amp+freq, ph = phase, br = brightness.
      var nR = lite ? 26 : 64; for (si = 0; si < nR; si++) S.rise.push({ xf: Math.random(), t: Math.random(), sp: 0.10 + Math.random() * 0.16, sway: 0.02 + Math.random() * 0.05, swf: 0.6 + Math.random() * 1.4, ph: Math.random() * 6.28, br: 0.5 + Math.random() * 0.7, z: Math.random() });
      S.rf = _rfSeed('ember', lite);   // build187 RIFTFIELD — the shared z-tunnel core, ember skin (see engine block)
    }
    // ── palette-mode advance is EARNED: fires once per tier-up cutaway (never a timer). Eased, never a hard jump. ──
    if ((st.hold > 0 || st.cut > 0.9) && !_state.cutFired) {
      _state.cutFired = 1;
      _state.fmode = (_state.fmode + 1) % EMBER_MODES.length;
      var gb = lite ? 0 : 40;                                    // 40 gold MID embers burst radially with the shockwave
      for (var gq = 0; gq < gb; gq++) { var ge = S.mid[(gq * 3) % S.mid.length]; _fsSpawn(ge, 1, _state.fmix, 160 + Math.random() * 240); ge.gold = true; ge.kind = 0; }
    }
    if (st.cut <= 0 && st.hold <= 0) _state.cutFired = 0;
    var Mo = EMBER_MODES[_state.fmode], fx = _state.fmix, kf = Math.min(1, dt * 0.9);
    fx.base = lerp(fx.base, Mo.pal.base, kf); fx.span = lerp(fx.span, Mo.pal.span, kf);
    fx.smoke = lerp(fx.smoke, Mo.smoke, kf); fx.spark = lerp(fx.spark, Mo.spark, kf);
    var pal = { base: fx.base, span: fx.span };
    var frozen = st.hold > 0;                                    // build127: hoisted ABOVE the new forge/haze layers (was declared lower) so held-breath freezes them too
    var spr = _emberGlow(), smk = lite ? null : _smokeSprite();  // build127: hoisted ABOVE the coal bed so its glow sprite (coalSpr) is defined when the bed draws (var-hoisting made it undefined before)
    // ── 3.0(B) OPAQUE clear (overscanned for the camera) — tails are drawn, never smeared ──
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(-w * 0.06, -h * 0.06, w * 1.12, h * 1.12);
    ctx.globalCompositeOperation = 'lighter';
    // build127: AMBIENT FORGE-GLOW — a broad, soft warm wash rising from the bottom that fills the whole lower/mid
    // frame so the scene reads as LIT BY A FORGE, not sparse dots on black. Calm at rest (base 0.05), bass adds heat.
    // LOOP-SEAMLESS: it's a static gradient modulated only by slow audio envelopes, no motion/reset.
    var amb = _hslToRgb(_warmHue(0.25, pal, 0), 78, 34);
    var gA = ctx.createRadialGradient(w * 0.5, h * 1.02, h * 0.05, w * 0.5, h * 1.02, h * 0.95);
    var ambA = (0.05 + bass * 0.10 + comboGlow * 0.06 + (st.od || 0) * 0.06) * calm;
    gA.addColorStop(0, 'rgba(' + amb[0] + ',' + amb[1] + ',' + amb[2] + ',' + clamp(ambA * 2.4, 0, 0.7) + ')');
    gA.addColorStop(0.5, 'rgba(' + amb[0] + ',' + amb[1] + ',' + amb[2] + ',' + clamp(ambA, 0, 0.4) + ')');
    // build182 (visual QA): fill the FULL overscanned frame — the old rect started at h*0.28, slicing the radial
    // mid-alpha into a hard full-width SEAM across the frame (caught on capture review). The gradient's own
    // radius (0.95h from the bottom) reaches zero before the frame top, so the full fill is naturally seamless.
    gA.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gA; ctx.fillRect(-w * 0.06, -h * 0.06, w * 1.12, h * 1.12);
    // ground glow — bottom-anchored, subtle (alpha 0.04 + bass·0.12)
    var gr0 = _hslToRgb(_warmHue(0.3, pal, 0), 82, 40);
    var gG = ctx.createLinearGradient(0, h, 0, h * 0.5);
    gG.addColorStop(0, 'rgba(' + gr0[0] + ',' + gr0[1] + ',' + gr0[2] + ',' + ((0.04 + bass * 0.12) * calm) + ')');
    gG.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gG; ctx.fillRect(-w * 0.04, h * 0.5, w * 1.08, h * 0.54);
    // build187 RIFTFIELD — the deep z-tunnel storm streams behind the forge scene (haze/road/planes draw over it)
    if (S.rf) _rfDraw(S.rf, dt, st, 'ember');
    // build127: layered HEAT-HAZE / SMOKE VOLUME — a few big soft smoke columns rising from the forge, drawn as
    // cached smoke puffs at column scale (VOLUME, not the dot-smoke of the MID plane). Rise loops smoothly (mod 1 →
    // fade at top/bottom so there's no pop). Rise FROZEN under reduce-motion. Dropped under _soft (heaviest add here).
    if (!lite && !_soft && S.haze && smk) {
      var smkV = smk;                                             // reuse the hoisted smoke sprite (already cached)
      for (var hz = 0; hz < S.haze.length; hz++) {
        var HZ = S.haze[hz];
        if (!frozen && !reduce) { HZ.rise += dt * HZ.sp * (0.6 + bassN * 0.8) * mf; if (HZ.rise > 1) HZ.rise -= 1; }
        var hzY = h * (1.02 - HZ.rise * 0.95);                       // rises from just below bottom up past mid
        var fade = Math.sin(HZ.rise * 3.14159);                      // 0 at ends, 1 mid → seamless loop, no pop
        var hzA = (0.05 + bass * 0.06) * fade * calm; if (hzA < 0.012) continue;
        var hzsz = (h * 0.16 * HZ.sz) * (0.7 + 0.6 * HZ.rise);       // widens as it rises (smoke expands)
        var hzx = HZ.x * w + Math.sin(_t * 0.3 + HZ.ph) * w * 0.02;
        ctx.globalAlpha = clamp(hzA, 0, 0.3); ctx.drawImage(smkV, hzx - hzsz, hzY - hzsz, hzsz * 2, hzsz * 2); ctx.globalAlpha = 1;
      }
    }
    // ROAD — two sagging rails from the bottom corners toward the VP. build182 (visual QA): the old single-stroke
    // pair met at the VP as a hard-edged WIREFRAME TRIANGLE apex — it read as a vector glitch, not a road (the
    // exact "lines and blocks" failure the owner hates). Now each rail is sampled along the same quadratic and
    // drawn in 6 short segments whose alpha FADES to zero approaching the VP (perspective haze), so the rails
    // ground the composition then dissolve into the glow. Cost: 12 short strokes vs 2 long (still trivial).
    ctx.lineCap = 'round';
    for (var rd = 0; rd < 2; rd++) {
      var x0r = rd ? w * 1.04 : -w * 0.04, cxr = rd ? w * 0.76 : w * 0.24;
      var RSEGS = 6, pxr = x0r, pyr = h * 1.04;
      for (var rq = 1; rq <= RSEGS; rq++) {
        var tq = rq / RSEGS, uq = 1 - tq;   // quadratic bezier sample: P0=(x0r,1.04h) C=(cxr,0.88h) P1=(VPX,VPY)
        var qx = uq * uq * x0r + 2 * uq * tq * cxr + tq * tq * VPX;
        var qy = uq * uq * h * 1.04 + 2 * uq * tq * h * 0.88 + tq * tq * VPY;
        var ra2 = 0.5 * (1 - tq * tq) * calm; if (tq > 0.83) ra2 = 0;   // last stretch fully dissolves — no apex
        if (ra2 > 0.02) {
          ctx.strokeStyle = _hsl(20, 50, 14 + bassN * 8, ra2); ctx.lineWidth = (2.4 - tq * 1.3) * _dpr;
          ctx.beginPath(); ctx.moveTo(pxr, pyr); ctx.lineTo(qx, qy); ctx.stroke();
        }
        pxr = qx; pyr = qy;
      }
    }
    // build127: glowing forge COAL BED along the bottom — the SOURCE the embers rise from. Each coal is a warm glow
    // sprite + hot core, flickering on its own phase (bass/beat drive the flare). Fixed positions (pool) → no motion
    // reset → LOOP-SEAMLESS; only brightness breathes. This is the single biggest "give the embers an origin" win.
    if (S.coals) {
      var coalY = h * 0.965, coalSpr = spr;
      for (var cb = 0; cb < S.coals.length; cb++) {
        var CO = S.coals[cb];
        // build139: livelier flicker — a slow breath PLUS a faster shimmer term (two coprime-ish sines) so the coals
        //   pulse actively instead of drifting. FROZEN under reduce-motion (flicker IS motion): hold a steady mid value.
        var flick = reduce ? 0.5 : (0.5 + 0.34 * Math.sin(_t * (2.0 + CO.h0) + CO.ph) + 0.16 * Math.sin(_t * (5.3 + CO.h0 * 1.7) + CO.ph * 2.1));
        var cheat = clamp(0.25 + bassN * 0.4 + beatPunch * 0.35, 0, 1);
        var ca = (0.22 + 0.4 * flick) * (0.5 + bass * 0.6) * CO.h0 * calm; if (ca < 0.03) continue;
        var cx0 = CO.x * w, csz = CO.w * w * (0.8 + 0.4 * flick);
        var chue = _warmHue(cheat, pal, 0);
        if (coalSpr && !lite) { ctx.globalAlpha = clamp(ca * 0.7, 0, 0.8); ctx.drawImage(coalSpr, cx0 - csz, coalY - csz * 0.7, csz * 2, csz * 1.4); ctx.globalAlpha = 1; }
        ctx.fillStyle = _hsl(chue, _heatS(cheat), _heatL(cheat, 46), clamp(ca, 0, 0.9));
        ctx.beginPath(); ctx.ellipse ? ctx.ellipse(cx0, coalY, csz * 0.42, csz * 0.24, 0, 0, 6.2832) : ctx.arc(cx0, coalY, csz * 0.3, 0, 6.2832); ctx.fill();
      }
    }
    // build139: RISING-SPARK STREAM — sparks lift off the coal bed and float up with lateral sway, giving the field
    //   constant gentle UPWARD motion tied to the forge SOURCE. Walks the FIXED S.rise pool (alloc'd at reseed) — NO
    //   push/new here. rise.t is a continuous 0..1 (mod-1) so there's no positional pop; a sin(t·π) fade zeroes alpha
    //   at both ends → LOOP-SEAMLESS. Sway is a continuous sine (swirl). FROZEN under reduce-motion. Sheds under _soft
    //   via a draw-count cutoff (halve the visible sparks). Bottom alpha kept modest so it never washes out the lanes.
    if (S.rise) {
      var riseCap = (_soft ? 0.5 : 1) * S.rise.length, riseSpeed = (0.6 + bassN * 0.7 + (st.od || 0) * 0.4) * mf;
      for (var rs = 0; rs < S.rise.length; rs++) {
        var RS = S.rise[rs];
        if (!frozen && !reduce) { RS.t += dt * RS.sp * riseSpeed; if (RS.t >= 1) RS.t -= 1; }
        if (rs > riseCap) continue;                                  // _soft: skip the draw on the upper half (never splice — no alloc)
        var rfade = Math.sin(RS.t * 3.14159);                        // 0 at coal bed + at top → seamless, no pop
        var rA = (0.10 + bass * 0.10 + comboGlow * 0.08) * rfade * RS.br * calm; if (rA < 0.02) continue;
        var ry = h * (0.965 - RS.t * 0.82);                          // from the coal bed (0.965h) up past mid
        var swirl = reduce ? 0 : Math.sin(_t * RS.swf + RS.ph) * RS.sway * w;   // lateral swirl (frozen under reduce)
        var rx = RS.xf * w + swirl;
        var rheat = clamp(0.3 + bassN * 0.35 + beatPunch * 0.3 + comboGlow * 0.3, 0, 1);
        var rhue = _warmHue(rheat, pal, 0);
        var rsz = (0.9 + RS.z * 1.6) * _dpr * (0.7 + 0.6 * (1 - RS.t));         // fades small as it climbs (cools)
        if (spr && !lite) { var rgd = rsz * 6; ctx.globalAlpha = clamp(rA * 0.5, 0, 0.4); ctx.drawImage(spr, rx - rgd, ry - rgd, rgd * 2, rgd * 2); ctx.globalAlpha = 1; }
        ctx.fillStyle = _hsl(rhue, _heatS(rheat), _heatL(rheat, 62), clamp(rA, 0, 0.5));
        ctx.beginPath(); ctx.arc(rx, ry, rsz, 0, 6.2832); ctx.fill();
      }
    }
    // ── beat ERUPTION fires AT the VP (one discrete event per beat; 0.10s cooldown) ──
    _state.bcd -= dt;
    if (beatPunch > 0.28 && missK < 0.5 && _state.bcd <= 0) {
      _state.bcd = 0.10;
      var bn = lite ? 12 : 26, b0 = (Math.random() * S.mid.length) | 0;
      for (var q = 0; q < bn; q++) _fsSpawn(S.mid[(b0 + q) % S.mid.length], 1, fx, 120 + beatPunch * 420);
    }
    // (spr/smk/frozen already declared above the forge/haze layers)
    var flowE = (0.25 + bassN * 1.1 + (st.od || 0) * 0.5) * mf;
    // ── the three planes, back to front. Per-axis update: outward velocity grows with distance from the VP. ──
    // pt4: DENSITY scales with live audio, not just intensity — activeFrac (FAR/MID only; NEAR streaks stay full so the drive always reads) derives from bassN (existing normalized input).
    // pt4: base floor 0.62 (was 0.5) keeps the resting field visibly FULL (Backdrop-LAW: base reads stable; audio only ADDS the top ~38%) — also answers the "feels empty" note directly.
    // pt4 PERF: _densCap halves the per-FRAME FAR/MID draw ceiling under the _soft watchdog — relief now fires the instant a machine slows, independent of the reseed timing.
    var _densCap = _soft ? 0.5 : 1;
    var farActive = S.far.length * (0.62 + 0.38 * bassN) * _densCap, midActive = S.mid.length * (0.62 + 0.38 * bassN) * _densCap;
    // build121 PERF: dt is invariant across the whole L/k double-loop below (it's the drawEmber(dt,st)
    // parameter, never reassigned) — hoist the burst-velocity decay factor out of the per-particle loop
    // instead of recomputing the identical Math.pow(0.18, dt) for every one of the ~760 live embers/frame.
    // Mathematically identical (same base, same exponent, every iteration).
    var _decay = Math.pow(0.18, dt);
    // build139: TURBULENCE — a gentle per-particle lateral swirl on FAR/MID so embers waver as they drift instead of
    //   flying dead-straight (more "alive"). Amplitude hoisted (invariant across the loop); the per-particle phase
    //   uses e.sw/e.swf (set at spawn). Continuous sine → LOOP-SEAMLESS. Zeroed under reduce-motion (it IS motion).
    var _swirlAmp = reduce ? 0 : (h * 0.055) * (0.5 + bassN * 0.6);
    for (var L = 0; L < 3; L++) {
      var arr = L === 0 ? S.far : L === 1 ? S.mid : S.near;
      var activeCap = L === 0 ? farActive : L === 1 ? midActive : arr.length;
      var flow = reduce ? 0 : _FS_FLOW[L] * flowE;
      var swirlL = L < 2 ? _swirlAmp * (L === 0 ? 0.7 : 1) : 0;   // FAR waver less than MID; NEAR streaks stay straight (drive reads clean)
      for (var k = 0; k < arr.length; k++) {
        var e = arr[k];
        if (!frozen) {
          if (L === 2) { e.px2 = e.px1; e.py2 = e.py1; e.px1 = e.x; e.py1 = e.y; }   // streak memory (drawn tail)
          var fk = flow * dt;
          e.x += (e.x - VPX) * fk + e.vx * dt + missK * w * 0.25 * dt * e.z + (swirlL ? Math.sin(_t * e.swf + e.sw) * swirlL * dt : 0);   // + gentle lateral swirl
          e.y += (e.y - VPY) * fk + e.vy * dt + (reduce ? -14 * dt : 0);             // reduce-motion: embers drift up in place
          e.vx *= _decay; e.vy *= _decay;                                            // burst velocity decays
          e.life += dt;
          if (e.life > e.maxlife || e.x < -w * 0.05 || e.x > w * 1.05 || e.y < -h * 0.05 || e.y > h * 1.05) {
            _fsSpawn(e, L, fx); continue;
          }
        }
        if (k > activeCap) continue;                              // pt4: below-threshold members of FAR/MID still simulate (so they're phase-ready when it gets loud) but skip the draw — this IS the density scaling
        var lt = e.life / e.maxlife, envb = Math.min(1, lt * 6) * (1 - Math.max(0, lt - 0.8) * 5);   // quick in, late out
        var heat = clamp(0.2 + bassN * 0.4 + beatPunch * 0.4 + comboGlow * 0.3, 0, 1);
        var hue = e.gold ? 45 : _warmHue(heat, pal, 0);
        if (L === 0) {                                           // FAR — one arc fill each
          ctx.fillStyle = _hsl(hue, 80, 40 + bassN * 14, 0.3 * envb * calm);
          ctx.beginPath(); ctx.arc(e.x, e.y, 1.4 * _dpr, 0, 6.2832); ctx.fill();
        } else if (L === 1) {                                    // MID — sprite glow + core dot (smoke = soft puff)
          if (e.kind === 2) {
            var sa = Math.min(0.28, envb * (0.10 + bass * 0.14)) * calm;
            if (smk && sa > 0.01) { ctx.globalAlpha = sa; var ssz = (26 + e.z * 30) * _dpr; ctx.drawImage(smk, e.x - ssz, e.y - ssz, ssz * 2, ssz * 2); ctx.globalAlpha = 1; }
            continue;
          }
          var a1 = clamp(envb * (0.35 + level * 0.5 + beatPunch * 0.4) * calm, 0, 1);
          if (a1 < 0.02) continue;
          if (spr && !lite) { var gd = (6 + e.z * 10) * _dpr; ctx.globalAlpha = a1 * 0.6; ctx.drawImage(spr, e.x - gd * 0.5, e.y - gd * 0.5, gd, gd); ctx.globalAlpha = 1; }
          ctx.fillStyle = _hsl(hue, _heatS(heat), e.kind === 1 ? 88 : _heatL(heat, 48), a1);
          ctx.beginPath(); ctx.arc(e.x, e.y, (e.kind === 1 ? 1.1 : 1.7) * _dpr, 0, 6.2832); ctx.fill();
        } else {                                                 // NEAR — drawn 3-segment streak + hot head (lite: flat dot)
          var a2 = clamp(envb * (0.5 + level * 0.5) * calm, 0, 1);
          if (a2 < 0.02) continue;
          if (lite) { ctx.fillStyle = _hsl(hue, 90, 80, a2); ctx.beginPath(); ctx.arc(e.x, e.y, 2 * _dpr, 0, 6.2832); ctx.fill(); continue; }
          ctx.strokeStyle = _hsl(hue, 92, 70 + e.z * 25, a2); ctx.lineWidth = (2.5 + e.z * 2) * _dpr; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(e.px2, e.py2); ctx.lineTo(e.px1, e.py1); ctx.lineTo(e.x, e.y); ctx.stroke();
          ctx.fillStyle = _hsl(hue, 85, 95, a2);
          ctx.beginPath(); ctx.arc(e.x, e.y, (1.6 + e.z * 1.4) * _dpr, 0, 6.2832); ctx.fill();
        }
      }
    }
    // ── tier-up CUTAWAY: the shockwave at the VP (fxLite: no ring; reduce-motion: st.cut is already 0) ──
    if (st.cut > 0 && !lite) _shockRing(1 - st.cut, 40, VPX, VPY);
    ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────────────────── WEAVE (Steady Hands) — pkg3.3 THE WEAVE (new Tier-I renderer) ─────────────
  //  A loom of horizontal strings in perspective — LOW band = BOTTOM string (inverted _spec read). Strings
  //  RING (350ms release — never strobe); combo IGNITES the loom bottom-up (the scene IS the progression
  //  bar); a beat plucks a traveling light down the hottest string; a gold hand-blade SWEEPS on sections.
  //  Opaque clear; motion drawn, never smeared. Fixes the two-levels-share-one-kaleido content bug.
  function _bladeSprite() {
    if (_state.blade) return _state.blade;
    var s = document.createElement('canvas'); s.width = 300; s.height = 80;
    var c = s.getContext('2d'), g = c.createLinearGradient(0, 0, 300, 0);
    g.addColorStop(0, 'rgba(255,220,140,0)'); g.addColorStop(0.5, 'rgba(255,226,150,0.55)'); g.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = g; c.fillRect(0, 0, 300, 80);
    _state.blade = s; return s;
  }
  // build127: a soft warm woven-texture HAZE sprite — drawn (source-over, low alpha) behind the loom so the strings
  // read as threads on FABRIC, not lonely lines on black. Warm-grey/amber vertical-ish weave, cheap single drawImage.
  function _weaveHaze() {
    if (_state.whz) return _state.whz;
    var s = document.createElement('canvas'); s.width = s.height = 128;
    var c = s.getContext('2d');
    // build182 (visual QA): baked ~50% brighter — at the old values the "fabric" was invisible over black and the
    // loom read as bare graph-paper lines in a void (the owner's "lines and blocks" failure, caught on capture review).
    var g = c.createRadialGradient(64, 64, 4, 64, 64, 78);
    g.addColorStop(0, 'rgba(88,50,30,0.8)'); g.addColorStop(0.5, 'rgba(56,32,20,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    // warm cross-hatch to read as woven cloth (baked once — not per-frame)
    c.globalAlpha = 0.16; c.strokeStyle = 'rgba(170,110,64,1)'; c.lineWidth = 1;
    for (var hx = 8; hx < 128; hx += 12) { c.beginPath(); c.moveTo(hx, 0); c.lineTo(hx, 128); c.stroke(); }
    for (var hy = 8; hy < 128; hy += 16) { c.beginPath(); c.moveTo(0, hy); c.lineTo(128, hy); c.stroke(); }
    c.globalAlpha = 1;
    _state.whz = s; return s;
  }
  function drawWeave(dt, st) {
    var w = _w, h = _h, lite = _lite(), reduce = _reduce();
    var NS = lite ? 7 : 11, SEG = lite ? 20 : 40, mf = _motionFloor(st), missK = st.missK || 0;
    var NW = lite ? 9 : 18;   // build127: WARP threads — near-vertical threads crossing the horizontal weft → a real LOOM
    var W = _state.wv;
    if (!W || _state.dirty || W.NS !== NS) {
      _state.dirty = false;
      // build127: DEPTH+FABRIC PASS. New fixed pools (alloc ONLY here at reseed — never in the render loop): vertical
      // WARP threads (xf base + sway phase) that cross the horizontal weft strings into a woven fabric, so the loom
      // fills the frame instead of being a few lonely lines. Nodes are computed inline at draw (no pool needed).
      W = _state.wv = { NS: NS, NW: NW, S: [], warp: [], pulses: [], pi: 0, sweep: -1, sweepCd: 0, swept: 0, dust: [] };
      // build182 (visual QA): LOOM-LIGHT — a cached warm radial wash behind the loom so the scene has a light
      // SOURCE instead of pure void (the single biggest "not just lines on black" win; mirrors ember's ambient
      // forge glow). Built ONLY here at reseed (resize re-dirties _state → rebuilds); drawn as one fill per frame
      // with live globalAlpha modulation — zero per-frame allocation, inside the path-op budget.
      var lg = ctx.createRadialGradient(w * 0.5, h * 0.55, h * 0.06, w * 0.5, h * 0.55, h * 0.85);
      lg.addColorStop(0, 'rgba(122,70,38,0.34)'); lg.addColorStop(0.55, 'rgba(84,46,26,0.18)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
      W.lightG = lg;
      for (var i0 = 0; i0 < NS; i0++) W.S.push({ amp: 0 });
      for (var iw = 0; iw < NW; iw++) W.warp.push({ xf: (iw + 0.5) / NW, ph: Math.random() * 6.28, band: Math.random() });   // xf across the frame, own sway phase, own spectrum band for its shimmer
      for (var p0 = 0; p0 < 3; p0++) W.pulses.push({ on: false, i: 0, x: 0 });                  // max 3 concurrent (ring buffer)
      if (!lite) for (var d0 = 0; d0 < 90; d0++) W.dust.push({ x: Math.random(), y: Math.random(), v: 0.004 + Math.random() * 0.01 });   // pt4: 40→90 — fills empty negative space between strings
      W.rf = _rfSeed('weave', lite);   // build187 RIFTFIELD — the shared z-tunnel core, molten-thread skin
    }
    var frozen = st.hold > 0;                                       // held breath: freeze phase accumulators
    var sp = _spec(NS);
    // attack/release per string — LOW = BOTTOM (string i reads band NS-1-i); miss drops the release to 0.12s (the loom goes quiet)
    var rel = missK > 0.02 ? 0.12 : 0.35, hotI = 0, hotV = -1;
    for (var i2 = 0; i2 < NS; i2++) {
      var Sst = W.S[i2], v = sp[NS - 1 - i2] || 0;
      if (!frozen) Sst.amp = Math.max(Sst.amp * Math.pow(0.5, dt / rel), Math.min(1.4, v * v * 1.6));
      if (Sst.amp > hotV) { hotV = Sst.amp; hotI = i2; }
    }
    var strum = st.cut > 0 ? st.cut : 0;                            // cutaway STRUM: whole loom slams bright, fades with st.cut
    if (!reduce && !frozen && beatPunch > 0.3) {                    // pluck — brightest-band string, ~0.45s crossing
      var pl = W.pulses[W.pi]; if (!pl.on) { pl.on = true; pl.i = hotI; pl.x = 0; W.pi = (W.pi + 1) % W.pulses.length; }
    }
    W.sweepCd -= dt;                                                // hand-sweep — sections/heavy beats, 2.5s cooldown
    if (!reduce && W.sweep < 0 && W.sweepCd <= 0 && (_secPulse > 0.8 || beatPunch > 0.55)) { W.sweep = 0; W.sweepCd = 2.5; W.swept = 0; }
    if (st.cut > 0.9 && W.sweep < 0) { W.sweep = 0; W.swept = 0; }  // cutaway = a full-frame strum-blade run too
    // 3.0(B) opaque clear (overscanned for the camera)
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(-w * 0.06, -h * 0.06, w * 1.12, h * 1.12);
    // build127: woven-texture BACKDROP HAZE — 3 overlapping warm cloth patches (source-over, low alpha) behind the
    // loom so the frame reads as fabric, not lonely lines on black. brightens gently with combo (the loom "warms up").
    // build182: LOOM-LIGHT first — the cached warm radial wash gives the scene a light source (never a void).
    // Breathes with level/combo/OD via globalAlpha only; the gradient object itself is reseed-cached (no alloc).
    if (W.lightG) {
      ctx.globalAlpha = clamp(0.55 + level * 0.35 + comboGlow * 0.30 + (st.od || 0) * 0.25, 0, 1.2) * (1 - missK * 0.35);
      ctx.fillStyle = W.lightG; ctx.fillRect(-w * 0.06, -h * 0.06, w * 1.12, h * 1.12);
      ctx.globalAlpha = 1;
    }
    // build187 RIFTFIELD — the deep z-tunnel storm streams behind the loom (haze/threads/nodes draw over it)
    if (W.rf) _rfDraw(W.rf, dt, st, 'weave');
    if (!lite) {
      var haze = _weaveHaze(), hzA = 0.30 + comboGlow * 0.25 + level * 0.12;   // build182: +~40% — the fabric must READ
      ctx.globalAlpha = clamp(hzA, 0, 0.75);
      ctx.drawImage(haze, w * 0.02, h * 0.10, w * 0.5, h * 0.82);
      ctx.drawImage(haze, w * 0.30, h * 0.06, w * 0.55, h * 0.9);
      ctx.drawImage(haze, w * 0.58, h * 0.12, w * 0.5, h * 0.8);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    var litFrom = NS - Math.round(clamp(st.tier, 0, 5) / 5 * NS);   // combo ignition bottom-up: lit if i >= litFrom
    if (missK > 0.02) litFrom = Math.min(NS, litFrom + 1);          // display-only: the loom loses a string while dim
    var glow = _emberGlow();
    for (var si = 0; si < NS; si++) {
      var Ss = W.S[si], amp = Math.min(1.4, Math.max(Ss.amp, strum * 1.0));
      var yB = h * (0.14 + 0.76 * Math.pow((si + 1) / NS, 1.25));
      var lit = si >= litFrom;
      var alpha = (lit ? 0.42 : 0.26) + amp * 0.28 + strum * 0.3;   // build182: string BODY — floors raised so the loom reads at rest, not just when a band spikes
      var lightC = 58 + amp * 35 + (lit ? 12 : 0) + strum * 24;     // strum drives lightness → 90+
      for (var pass = lite ? 1 : 0; pass < 2; pass++) {             // glow pass (lighter) + pixel-snapped core; lite = core only
        ctx.beginPath();
        for (var g2 = 0; g2 <= SEG; g2++) {
          var xx = -w * 0.04 + (w * 1.08) * (g2 / SEG), xf = xx / w;
          var wave = Math.sin(xf * 3.14159 * (2 + si % 3)) * Math.sin(_t * (9 + si)) * amp * h * 0.012;
          var bow = reduce ? 0 : Math.sin(xf * 3.14159) * h * 0.03 * Math.sin(_t * 0.45 + si * 0.3) * mf;   // breathing-cylinder bow rides the motion floor
          var yy = yB + wave + bow;
          if (pass === 1) yy = (yy | 0) + 0.5;                      // 3.0(E) pixel-snap the 1.6px core
          if (g2 === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        if (pass === 0) { ctx.strokeStyle = _hsl(38, 80, 60, clamp(0.10 + amp * 0.28, 0, 0.55)); ctx.lineWidth = (6 + amp * 8) * _dpr; }   // build182: glow floor 0.05→0.10 + a touch wider — the halo is what makes a string read as LIGHT
        else { ctx.strokeStyle = _hsl(40, 72, clamp(lightC, 30, 96), clamp(alpha, 0, 1)); ctx.lineWidth = 1.6 * _dpr; }
        ctx.stroke();
      }
    }
    // build127: VERTICAL WARP THREADS — the weft (horizontal strings) now crosses a set of warp threads into a real
    // woven LOOM. Each thread runs top→bottom with a subtle perspective FAN (converges toward center at the top,
    // spreads at the bottom) + a gentle per-thread sway; a FAR dim pass + a near brighter pass give depth. Threads
    // shimmer on their own spectrum band. Sway/fan FROZEN under reduce-motion. Cost: NW×2passes×~10 segs, capped.
    var loomTop = h * 0.09, loomBot = h * 0.95, warpN = W.warp.length;
    var WSEG = lite ? 6 : 10;
    // FAR dim ghost warp pass (depth) — skipped under _soft
    if (!lite && !_soft) {
      for (var wf = 0; wf < warpN; wf++) {
        var TWf = W.warp[wf], sprF = 0.16 + 0.68 * TWf.xf;           // far layer packed tighter (reads as "behind")
        ctx.strokeStyle = _hsl(30, 40, 34 + comboGlow * 12, 0.05 + comboGlow * 0.06); ctx.lineWidth = 1 * _dpr;
        ctx.beginPath();
        for (var gf = 0; gf <= WSEG; gf++) {
          var tf = gf / WSEG, yf = loomTop + (loomBot - loomTop) * tf;
          var fanF = (sprF - 0.5) * (0.45 + 0.55 * tf);              // perspective: narrow at top, wide at bottom
          var swF = reduce ? 0 : Math.sin(_t * 0.5 + TWf.ph + tf * 2.2) * w * 0.004 * mf;
          var xf2 = w * (0.5 + fanF) + swF;
          if (gf === 0) ctx.moveTo(xf2, yf); else ctx.lineTo(xf2, yf);
        }
        ctx.stroke();
      }
    }
    // NEAR warp pass — brighter, thicker; shimmer on its band + combo ignition. This is the fabric the player sees.
    var warpLit = comboGlow;
    for (var wn = 0; wn < warpN; wn++) {
      var TW = W.warp[wn], spr = 0.06 + 0.88 * TW.xf;                // near layer spans the full frame
      var wv2 = sp[(TW.band * NS) | 0] || 0, wamp = Math.min(1.2, Math.max(wv2 * wv2 * 1.4, strum * 0.6));
      var wAlpha = (0.15 + 0.12 * warpLit) + wamp * 0.24 + strum * 0.25;   // build182: warp floor up — the crossing threads are half the "woven" read
      var wLight = 48 + wamp * 34 + warpLit * 14 + strum * 22;
      ctx.strokeStyle = _hsl(36, 66, clamp(wLight, 30, 92), clamp(wAlpha, 0, 0.9)); ctx.lineWidth = (1.2 + wamp * 1.6) * _dpr;
      ctx.beginPath();
      for (var gn = 0; gn <= WSEG; gn++) {
        var tn = gn / WSEG, yn = loomTop + (loomBot - loomTop) * tn;
        var fanN = (spr - 0.5) * (0.5 + 0.5 * tn);
        var swN = reduce ? 0 : Math.sin(_t * (0.7 + wn * 0.03) + TW.ph + tn * 2.6) * w * 0.008 * wamp * mf;
        var xn = w * (0.5 + fanN) + swN;
        yn = (yn | 0) + 0.5;
        if (gn === 0) ctx.moveTo(xn, yn); else ctx.lineTo(xn, yn);
      }
      ctx.stroke();
    }
    // build127: glowing INTERSECTION NODES at warp×weft crossings — pulse on beat/strum. Sampled on a coarse grid
    // (every other warp × every other weft, capped) so it's a jewelled lattice without exploding the draw count.
    if (!lite) {
      var nodeGlow = _emberGlow(), nodePulse = clamp(beatPunch * 0.9 + strum * 0.8 + comboGlow * 0.3, 0, 1.3);
      var wStep = warpN > 12 ? 2 : 1, sStep = NS > 8 ? 2 : 1, nodeCount = 0, nodeCap = _soft ? 24 : 60;
      for (var nwi = 0; nwi < warpN && nodeCount < nodeCap; nwi += wStep) {
        var NW2 = W.warp[nwi], nspr = 0.06 + 0.88 * NW2.xf;
        for (var nsi = 0; nsi < NS && nodeCount < nodeCap; nsi += sStep) {
          var nyB = h * (0.14 + 0.76 * Math.pow((nsi + 1) / NS, 1.25));
          var ntn = clamp((nyB - loomTop) / (loomBot - loomTop), 0, 1);
          var nfan = (nspr - 0.5) * (0.5 + 0.5 * ntn), nx = w * (0.5 + nfan);
          var na = (0.20 + 0.5 * nodePulse) * (0.5 + 0.5 * (W.S[nsi].amp || 0)); if (na < 0.04) { nodeCount++; continue; }   // build182: floor 0.14→0.20 — the jewelled lattice must be visible at rest
          if (nodeGlow && !_soft) { var ngd = (12 + nodePulse * 16) * _dpr; ctx.globalAlpha = clamp(na * 0.55, 0, 0.7); ctx.drawImage(nodeGlow, nx - ngd * 0.5, nyB - ngd * 0.5, ngd, ngd); ctx.globalAlpha = 1; }
          ctx.fillStyle = _hsl(42, 88, 84, clamp(na, 0, 0.85)); ctx.beginPath(); ctx.arc(nx, nyB, (1.9 + nodePulse * 1.5) * _dpr, 0, 6.2832); ctx.fill();   // build182: core 1.3→1.9 — a 1px dot vanished at 1080p
          nodeCount++;
        }
      }
    }
    if (!lite && !_soft) {                                          // pt4: SUB-HARMONIC string layer at half-opacity between the main strings — reuses the yB formula offset by 0.5 index (visually doubles density, no new logic)
      // pt4 PERF: coarse SHSEG (half of SEG) keeps weave under the ~1200 path-op contract — main strings already cost 11×2×41≈900 lineTo; a full-SEG sub-harmonic would tip it over. Half-res is invisible on a half-opacity background string. Also gated by !_soft so the watchdog can shed this layer under load.
      var SHSEG = SEG >> 1;
      for (var sh = 0; sh < NS - 1; sh++) {
        var ampA = W.S[sh].amp, ampB = W.S[sh + 1].amp, ampH = Math.min(1.4, Math.max((ampA + ampB) * 0.5, strum * 0.7));
        var yBh = h * (0.14 + 0.76 * Math.pow((sh + 1.5) / NS, 1.25));
        var alphaH = ((ampH > 0.02) ? 0.09 : 0.05) + ampH * 0.14 + strum * 0.16;   // half of the main-string alpha budget
        ctx.beginPath();
        for (var g3 = 0; g3 <= SHSEG; g3++) {
          var xxh = -w * 0.04 + (w * 1.08) * (g3 / SHSEG), xfh = xxh / w;
          var waveh = Math.sin(xfh * 3.14159 * (2 + sh % 3)) * Math.sin(_t * (7 + sh)) * ampH * h * 0.010;
          var yyh = (yBh + waveh) | 0; yyh += 0.5;
          if (g3 === 0) ctx.moveTo(xxh, yyh); else ctx.lineTo(xxh, yyh);
        }
        ctx.strokeStyle = _hsl(40, 60, clamp(48 + ampH * 30, 30, 88), clamp(alphaH, 0, 0.5)); ctx.lineWidth = 1 * _dpr;
        ctx.stroke();
      }
    }
    for (var pu = 0; pu < W.pulses.length; pu++) {                  // traveling plucks (reduce-motion: stationary node flash)
      var P2 = W.pulses[pu]; if (!P2.on) continue;
      if (!frozen) P2.x += dt * 2.2;
      if (P2.x >= 1) { P2.on = false; continue; }
      var py0 = h * (0.14 + 0.76 * Math.pow((P2.i + 1) / NS, 1.25));
      var pxx = reduce ? w * 0.5 : (-w * 0.04 + w * 1.08 * P2.x);
      var pa = Math.sin(P2.x * 3.14159);
      if (glow && !lite) { var pgd = 26 * _dpr; ctx.globalAlpha = 0.5 * pa; ctx.drawImage(glow, pxx - pgd / 2, py0 - pgd / 2, pgd, pgd); ctx.globalAlpha = 1; }
      ctx.fillStyle = _hsl(44, 90, 92, 0.8 * pa); ctx.beginPath(); ctx.arc(pxx, py0, 2.5 * _dpr, 0, 6.2832); ctx.fill();
    }
    if (W.sweep >= 0) {                                             // the gold hand-blade — 320ms crossing at 18°
      if (!frozen) W.sweep += dt / 0.32;
      if (W.sweep >= 1) W.sweep = -1;
      else {
        var bx = -w * 0.1 + (w * 1.2) * W.sweep;
        ctx.save(); ctx.translate(bx, h * 0.5); ctx.rotate(-18 * Math.PI / 180);
        if (lite) { ctx.fillStyle = 'rgba(255,226,150,0.25)'; ctx.fillRect(-16 * _dpr, -h * 0.6, 32 * _dpr, h * 1.2); }   // flat-gradient-ish band on lite
        else { ctx.globalAlpha = 0.75; ctx.drawImage(_bladeSprite(), -150, -h * 0.6, 300, h * 1.2); ctx.globalAlpha = 1; }
        ctx.restore();
        var crossed = Math.min(NS - 1, Math.floor(W.sweep * NS));   // kick each crossed string's amp +0.5
        while (W.swept <= crossed) { W.S[W.swept].amp = Math.min(1.4, W.S[W.swept].amp + 0.5); W.swept++; }
      }
    }
    if (!lite && !_soft) {                                          // dust — 90 slow 1px motes; pt4: _soft watchdog drops this loop first (dust is decorative, cheapest to cut)
      // pt4: DENSITY scales with treble — base floor 0.6 keeps the field visibly full at rest (Backdrop-LAW), audio adds the top ~40% (reuses trebleN, no new plumbing)
      var dustActive = W.dust.length * (0.6 + 0.4 * trebleN);
      ctx.fillStyle = _hsl(40, 40, 82, clamp(0.16 + trebleN * 0.24, 0, 0.42));   // build182: brighter — the motes fill the negative space between strings
      for (var dm = 0; dm < W.dust.length; dm++) {
        if (dm > dustActive) break;
        var Dd = W.dust[dm];
        if (!frozen && !reduce) { Dd.y -= Dd.v * dt * mf * 8; if (Dd.y < 0) { Dd.y = 1; Dd.x = Math.random(); } }
        ctx.fillRect(((Dd.x * w) | 0) + 0.5, ((Dd.y * h) | 0) + 0.5, 1.5 * _dpr, 1.5 * _dpr);   // build182: 1px→1.5px (visible at 1080p)
      }
    }
    if (st.cut > 0 && !lite) _shockRing(1 - st.cut, 40, w * 0.5, h * 0.5);   // pt4: restore combo/OD tier-up shockwave into weave's cutaway (matches ember/dawn payoff for consistency)
    ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────────────────── DAWN (First Light) — pkg3.4 DAWN BREAK (new Tier-I renderer; the showcase) ──
  //  THE SUN IS THE COMBO METER: below the horizon at tier 0 → blazing gold disc at tier 5. Stars twinkle on
  //  treble and DISSOLVE with elevation (the player killed the night). A one-point-perspective fretboard
  //  scrolls toward the horizon (bass = speed) — the constant low z-flight + the 3.0 beat z-pump is the vertigo.
  function _raySprite() {
    if (_state.ray) return _state.ray;
    var s = document.createElement('canvas'); s.width = s.height = 256;
    var c = s.getContext('2d');
    var g = c.createRadialGradient(128, 256, 0, 128, 256, 256);
    g.addColorStop(0, 'rgba(255,236,190,0.85)'); g.addColorStop(1, 'rgba(255,236,190,0)');
    var half = Math.tan(7 * Math.PI / 180) * 256;                   // ONE cached 14°-clip wedge (11 fanned draws/frame)
    c.beginPath(); c.moveTo(128, 256); c.lineTo(128 - half, 0); c.lineTo(128 + half, 0); c.closePath();
    c.clip(); c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    _state.ray = s; return s;
  }
  function drawDawn(dt, st) {
    var w = _w, h = _h, lite = _lite(), reduce = _reduce();
    var HY = h * 0.62, cx = w * 0.5, mf = _motionFloor(st), missK = st.missK || 0;
    var D = _state.dw;
    if (!D || _state.dirty) {
      _state.dirty = false;
      // build127: DEPTH PASS — the empty upper sky was the worst offender. New fixed pools (allocated ONLY here at
      // reseed, never in the render loop — the hard no-per-frame-alloc invariant): two parallax horizon RIDGE
      // silhouettes (near+far skyline profiles → a sense of PLACE), high aurora RIBBONS, and distant horizon LIGHTS
      // (city glints). Sky BANDS are drawn procedurally (no pool). All warm-only (crimson/amber/gold/warm-grey).
      D = _state.dw = { elev: 0, sky: null, skyElev: -1, stars: [], stars2: [], scroll: 0, flash: 0, ridgeF: null, ridgeN: null, ribbons: [], lights: [] };
      var nSt = lite ? 70 : 140;   // pt4: 70→140 desktop — fills the empty upper sky (LEGIBILITY CONTRACT budget, see RENDERERS note)
      for (var i0 = 0; i0 < nSt; i0++) D.stars.push({ x: Math.random(), y: Math.random() * 0.55, tw: Math.random() * 6.28 });   // precomputed, top 55%
      if (!lite) { var nSt2 = 80; for (var i1 = 0; i1 < nSt2; i1++) D.stars2.push({ x: Math.random(), y: Math.random() * 0.5, tw: Math.random() * 6.28, d: 0.4 + Math.random() * 0.4 }); }   // pt4: dimmer PARALLAX second layer, bassN-scrolled
      // RIDGE silhouettes — fixed normalized (x,y) profile points (0..1). Far = smooth low hills; near = jagged skyline
      // (city strip). Drawn as filled dark-warm polygons parallax-shifted by bass. Point count fixed → no loop alloc.
      var RF = 16, RN = 26; D.ridgeF = new Float32Array(RF); D.ridgeN = new Float32Array(RN);
      for (var rf = 0; rf < RF; rf++) D.ridgeF[rf] = 0.30 + 0.55 * Math.abs(Math.sin(rf * 1.7 + 0.6)) * (0.6 + 0.4 * Math.random());   // rolling far hills (height frac of the ridge band)
      for (var rn = 0; rn < RN; rn++) { var tall = Math.random(); D.ridgeN[rn] = (tall < 0.28 ? 0.55 + Math.random() * 0.45 : 0.12 + Math.random() * 0.32); }   // jagged skyline: some towers, mostly low
      // AURORA ribbons — high warm light-bands, each a slow sine polyline. Fixed params; phase drifts (frozen on reduce).
      if (!lite) { var nRib = 3; for (var rb = 0; rb < nRib; rb++) D.ribbons.push({ yc: 0.10 + rb * 0.12, amp: 0.03 + Math.random() * 0.04, k: 1.4 + rb * 0.7, sp: (0.05 + Math.random() * 0.06) * (rb % 2 ? -1 : 1), ph: Math.random() * 6.28, hue: 6 + rb * 10 }); }
      // distant horizon LIGHTS — a row of tiny warm glints just under the horizon (city). Fixed x, twinkle on treble.
      if (!lite) { var nLi = 40; for (var li = 0; li < nLi; li++) D.lights.push({ x: Math.random(), off: Math.random() * 0.018, tw: Math.random() * 6.28, s: 0.5 + Math.random() * 0.9 }); }
      D.rf = _rfSeed('dawn', lite);   // build187 RIFTFIELD — the shared z-tunnel core, light-mote skin
    }
    var frozen = st.hold > 0;
    // the sun eases toward the tier; the cutaway overshoots +0.2 and eases back — the sun JUMPS a notch
    var elevT = clamp(clamp(st.tier, 0, 5) / 5 + (st.cut > 0 ? 0.2 * st.cut : 0), 0, 1.2);
    if (!frozen) D.elev += (elevT - D.elev) * Math.min(1, dt * 1.5);
    var elev = clamp(D.elev * (1 - missK * 0.15), 0, 1.2);          // miss: the sky cools
    var sunY = HY + h * 0.10 - elev * h * 0.22;
    if (!D.sky || Math.abs(elev - D.skyElev) > 0.03) {              // sky gradient CACHED — rebuilt only on real elevation moves
      D.skyElev = elev;
      // build182 (visual QA): the atmospheric STRATA now live INSIDE this cached gradient as feathered stops —
      // the old 4 hard-edged band fillRects produced visible full-width SEAMS across the sky at high elevation
      // (caught on capture review). Same layered-dawn read, zero seams, and 4 fewer fills per frame.
      var g0 = ctx.createLinearGradient(0, -h * 0.06, 0, HY);
      g0.addColorStop(0, '#000');
      g0.addColorStop(0.38, _hsl(6 + elev * 10, 46 + elev * 18, 3 + elev * 6, 1));
      g0.addColorStop(0.55, _hsl(8 + elev * 14, 50 + elev * 20, 4 + elev * 9, 1));
      g0.addColorStop(0.70, _hsl(12 + elev * 15, 56 + elev * 20, 5 + elev * 13, 1));   // strata: each step slightly warmer/brighter
      g0.addColorStop(0.84, _hsl(16 + elev * 16, 62 + elev * 18, 6 + elev * 18, 1));
      g0.addColorStop(1, _hsl(20 + elev * 16, 70, 8 + elev * 24, 1));
      D.sky = g0;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(-w * 0.06, -h * 0.06, w * 1.12, h * 1.12);   // 3.0(B) opaque clear
    ctx.save(); ctx.beginPath(); ctx.rect(-w * 0.06, -h * 0.06, w * 1.12, HY + h * 0.06); ctx.clip();   // sun/sky clipped → the sun rises BEHIND the horizon
    ctx.fillStyle = D.sky; ctx.fillRect(-w * 0.06, -h * 0.06, w * 1.12, HY + h * 0.06);
    // build187 RIFTFIELD — the z-tunnel light-mote storm streams through the SKY (the clip above confines it
    // over the horizon, so near motes fly past the camera and vanish behind the ridge line — real depth).
    if (D.rf) _rfDraw(D.rf, dt, st, 'dawn');
    // build127: atmospheric SKY BANDS — 4 stratified warm bands stacked toward the horizon so the sky reads as a
    // living, layered dawn (not one flat fill). Alpha grows with elevation; hue warms band-by-band down to the horizon.
    // Cheap: 4 fillRects, source-over. LOOP-SEAMLESS — no motion, purely elevation-driven (a slow state, not a strobe).
    // build182: the 4 stratified band fillRects are DELETED — their hard edges were visible full-width seams.
    // The strata now ride the cached D.sky gradient above as feathered color stops (same read, no seams).
    if (!lite) {                                                    // stars — treble twinkles them, elevation dissolves them
      // pt4: DENSITY scales with live audio, not just per-star twinkle intensity — quiet passages show fewer stars lit,
      // loud passages fill the sky. activeFrac reuses trebleN (existing normalized input, no new plumbing).
      var starActive = D.stars.length * (0.68 + 0.32 * trebleN);     // pt4: floor 0.68 — the sky reads full at rest; treble adds the top ~32% (Backdrop-LAW)
      for (var s2 = 0; s2 < D.stars.length; s2++) {
        if (s2 > starActive) break;                                 // array is stable-ordered (spawn order is already effectively random) — no per-frame allocation, just an early cutoff
        var S3 = D.stars[s2];
        var sa = (0.25 + 0.35 * Math.sin(_t * 2 + S3.tw)) * trebleN * (1 - Math.min(1, elev));
        if (sa < 0.02) continue;
        ctx.fillStyle = 'rgba(255,240,220,' + sa.toFixed(3) + ')';
        ctx.fillRect(((S3.x * w) | 0) + 0.5, ((S3.y * h) | 0) + 0.5, _dpr, _dpr);
      }
      if (D.stars2.length) {                                        // pt4: dimmer PARALLAX second starfield, scroll tied to bassN (mirrors curtain() parallax pattern)
        var par = reduce ? 0 : _t * (0.004 + bassN * 0.02);         // a11y: freeze the lateral scroll under reduce-motion (main stars have NO positional motion — only alpha twinkle — so the parallax layer must match, not introduce new drift)
        var star2Active = D.stars2.length * (0.6 + 0.4 * bassN);     // pt4: floor 0.6 (dimmer parallax layer can thin a touch more than the main field)
        for (var s3 = 0; s3 < D.stars2.length; s3++) {
          if (s3 > star2Active) break;
          var S4 = D.stars2[s3];
          var sx = (((S4.x + par * S4.d) % 1 + 1) % 1);
          var sa2 = (0.10 + 0.14 * Math.sin(_t * 1.3 + S4.tw)) * (0.4 + trebleN * 0.6) * (1 - Math.min(1, elev)) * S4.d;
          if (sa2 < 0.015) continue;
          ctx.fillStyle = 'rgba(255,232,206,' + sa2.toFixed(3) + ')';
          ctx.fillRect(((sx * w) | 0) + 0.5, ((S4.y * h) | 0) + 0.5, _dpr, _dpr);
        }
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    // build127: AURORA RIBBONS — soft warm light-bands drifting high in the sky, filling the previously-dead upper
    // third. Each is a smooth sine polyline (SEG-capped), additive at low alpha. Phase drift is FROZEN under
    // reduce-motion (a11y) and under frozen (held-breath). LOOP-SEAMLESS: pure continuous sine, no reset pop.
    // Perf: dropped entirely under _soft (like the god-rays); ≤3 ribbons × 24 segs ≤ 72 lineTo — inside budget.
    if (!lite && !_soft && D.ribbons.length) {
      var RSEG = 24, ribFade = 1 - Math.min(1, elev) * 0.4;         // ribbons soften as the sun rises (dawn burns them off)
      for (var rbi = 0; rbi < D.ribbons.length; rbi++) {
        var RB = D.ribbons[rbi];
        var ph = (reduce || frozen) ? RB.ph : RB.ph + _t * RB.sp;   // drift frozen under reduce-motion / held-breath
        var ra2 = (0.05 + 0.06 * midN + 0.05 * (st.od || 0)) * ribFade; if (ra2 < 0.015) continue;
        ctx.strokeStyle = _hsl(RB.hue + comboHue * 0.2, 82, 60 + midN * 20, ra2);
        ctx.lineWidth = (h * 0.018 * (0.7 + 0.6 * Math.min(1, midN * 1.5 + 0.3))) * (0.6 + 0.4 * RB.amp * 12);
        ctx.beginPath();
        for (var rg = 0; rg <= RSEG; rg++) {
          var rx = -w * 0.06 + w * 1.12 * (rg / RSEG), rxf = rg / RSEG;
          var ry = RB.yc * h + Math.sin(rxf * 6.2832 * RB.k + ph) * RB.amp * h + Math.sin(rxf * 3.1 - ph * 0.7) * RB.amp * h * 0.4;
          if (rg === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
        }
        ctx.stroke();
      }
    }
    // build127: distant horizon LIGHTS — a row of tiny warm city glints hugging the horizon, twinkling on treble.
    // Fixed x positions (pool), no motion → LOOP-SEAMLESS. Cheap 1px+glow fillRects. Fades as the sun rises.
    if (!lite && D.lights.length) {
      var liFade = clamp(1 - Math.min(1, elev) * 0.5, 0.3, 1), liY = HY - h * 0.006;
      for (var lii = 0; lii < D.lights.length; lii++) {
        var LI = D.lights[lii];
        var la = (0.18 + 0.5 * (0.5 + 0.5 * Math.sin(_t * 1.6 + LI.tw)) * (0.4 + trebleN * 0.7)) * liFade * LI.s;
        if (la < 0.03) continue;
        var lx = ((LI.x * w) | 0) + 0.5, ly = ((liY - LI.off * h) | 0) + 0.5;
        ctx.fillStyle = _hsl(34 + trebleN * 10, 92, 78, clamp(la, 0, 0.85));
        ctx.fillRect(lx, ly, 1.4 * _dpr, 1.4 * _dpr);
      }
    }
    if (!lite && !_soft) {                                          // god-rays — 11 fanned draws of the one cached wedge; pt4: _soft watchdog drops this first (heaviest add here, 11 drawImage/frame)
      var ray = _raySprite();
      var ra = clamp(0.10 + midN * 0.25 + (st.od || 0) * 0.3, 0, 0.7);
      var sweepOff = (st.od || 0) > 0.3 ? Math.sin(_t * 0.5) * 0.2 : 0;   // OD adds a slow sweep
      var rw = 64 * _dpr, rh = h * 0.42 * (0.5 + midN * 0.9);
      for (var rk = 0; rk < 11; rk++) {
        var angR = ((rk - 5) * 12) * Math.PI / 180 + sweepOff;      // −90°±60° fan (0 = straight up)
        ctx.save(); ctx.translate(cx, sunY); ctx.rotate(angR); ctx.globalAlpha = ra;
        ctx.drawImage(ray, -rw / 2, -rh, rw, rh); ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    var glow = _emberGlow();                                        // the sun — glow sprite + crisp core
    var sd = h * (0.18 + Math.min(1, elev) * 0.16 + bassN * 0.03);
    // build127: volumetric ATMOSPHERE HALO — a wide, soft warm wash behind the sun so the disc reads as a glowing
    // body embedded in air, not a flat sprite. One extra drawImage of the SAME cached glow at ~2× scale, low alpha.
    if (glow) { var hd = sd * (2.0 + 0.5 * Math.min(1, elev)); ctx.globalAlpha = clamp(0.16 + elev * 0.22 + midN * 0.06, 0, 0.6); ctx.drawImage(glow, cx - hd, sunY - hd, hd * 2, hd * 2); ctx.globalAlpha = 1; }
    if (glow) { ctx.globalAlpha = clamp(0.55 + elev * 0.4, 0, 1); ctx.drawImage(glow, cx - sd, sunY - sd, sd * 2, sd * 2); ctx.globalAlpha = 1; }
    if (!lite && elev > 0.02) { ctx.fillStyle = _hsl(38, 100, 88, 1); ctx.beginPath(); ctx.arc(cx, sunY, h * 0.035 * Math.min(1, elev), 0, 6.2832); ctx.fill(); }
    ctx.restore();                                                  // sky clip off (restore also resets gco)
    // build127: layered horizon RIDGE silhouettes — FAR rolling hills + NEAR jagged skyline, both drawn as solid
    // dark-warm filled profiles just above the horizon. This gives the scene PLACE + parallax depth (they slide
    // opposite the bass-driven star scroll). source-over solid so they read as true silhouettes (occlude the sky).
    // Points are a fixed pool (no loop alloc). Parallax offset FROZEN under reduce-motion.
    ctx.globalCompositeOperation = 'source-over';
    if (D.ridgeF) {
      var parF = reduce ? 0 : Math.sin(_t * 0.03) * 0.010 * w + (bassN - 0.5) * 0.006 * w;   // far ridge: gentle
      var ridgeBand = h * 0.16, baseF = HY;                          // far ridge sits right on the horizon
      ctx.fillStyle = _hsl(14, 42, 5 + elev * 4, 0.92);
      ctx.beginPath(); ctx.moveTo(-w * 0.08, HY + h * 0.02);
      for (var qf = 0; qf < D.ridgeF.length; qf++) { var fx = -w * 0.08 + (w * 1.16) * (qf / (D.ridgeF.length - 1)) + parF; ctx.lineTo(fx, baseF - D.ridgeF[qf] * ridgeBand); }
      ctx.lineTo(w * 1.08, HY + h * 0.02); ctx.closePath(); ctx.fill();
      var parN = reduce ? 0 : Math.sin(_t * 0.05 + 1.3) * 0.020 * w + (bassN - 0.5) * 0.014 * w;   // near skyline: stronger parallax
      var skyBand = h * 0.24, baseN = HY + h * 0.012;
      ctx.fillStyle = _hsl(10, 46, 3 + elev * 3, 0.97);
      ctx.beginPath(); ctx.moveTo(-w * 0.08, HY + h * 0.03);
      for (var qn = 0; qn < D.ridgeN.length; qn++) { var nx = -w * 0.08 + (w * 1.16) * (qn / (D.ridgeN.length - 1)) + parN; var ny = baseN - D.ridgeN[qn] * skyBand; ctx.lineTo(nx, ny); }
      ctx.lineTo(w * 1.08, HY + h * 0.03); ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    // GROUND — the endless one-point-perspective fretboard (bass = scroll speed × the earned-motion floor)
    if (!frozen && !reduce) D.scroll += dt * (0.05 + bassN * 0.22 + (st.od || 0) * 0.1) * mf;
    if (!frozen) D.flash = beatPunch > 0.4 ? 1 : D.flash * 0.85;    // beat: the fret line nearest p=0.85 flares gold
    var FL = lite ? 12 : 22, nearestI = -1, nearestD = 9, f, p;
    for (f = 0; f < FL; f++) { p = ((f / FL + D.scroll) % 1 + 1) % 1; var dd = Math.abs(p - 0.85); if (dd < nearestD) { nearestD = dd; nearestI = f; } }
    for (f = 0; f < FL; f++) {
      p = ((f / FL + D.scroll) % 1 + 1) % 1;
      var fy = ((HY + (h - HY) * p * p) | 0) + 0.5;                 // 3.0(E) pixel-snap
      // build182 (visual QA): width rides the SAME p² perspective curve as the y-spacing (was linear p — mid-
      // distance frets stuck out ~2× beyond the string-rail fan, reading as a TRON grid glued under a separate
      // fan instead of ONE converging fretboard highway).
      var halfW = (w * 0.56) * p * p + w * 0.02;
      var isNear = f === nearestI && D.flash > 0.05;
      ctx.strokeStyle = isNear ? _hsl(44, 90, clamp(30 + p * 20 + D.flash * 40, 0, 95), 0.5 + D.flash * 0.4)
                               : _hsl(24, 60, 30 + p * 20, 0.30 + p * 0.28);
      ctx.lineWidth = (0.8 + p * 2.4) * _dpr;
      ctx.beginPath(); ctx.moveTo(cx - halfW, fy); ctx.lineTo(cx + halfW, fy); ctx.stroke();
    }
    for (var r2 = 0; r2 < 6; r2++) {                                // six string-rails fanning to the bottom corners
      var rt = r2 / 5, ex = -w * 0.04 + (w * 1.08) * rt;
      ctx.strokeStyle = _hsl(30, 60, 40, 0.15 + bassN * 0.2); ctx.lineWidth = 1.2 * _dpr;
      ctx.beginPath(); ctx.moveTo(cx, HY); ctx.lineTo(ex, h * 1.04); ctx.stroke();
    }
    if (st.cut > 0 && !lite) {                                      // cutaway — a light band sweeps from HY to both edges
      var ce = 1 - Math.pow(1 - (1 - st.cut), 3), bh = (3 + 30 * st.cut) * _dpr;
      var bandU = HY - (HY + h * 0.06) * ce, bandD = HY + (h * 1.04 - HY) * ce;
      ctx.fillStyle = _hsl(46, 95, 80, 0.5 * st.cut);
      ctx.fillRect(-w * 0.04, bandU - bh / 2, w * 1.08, bh);
      ctx.fillRect(-w * 0.04, bandD - bh / 2, w * 1.08, bh);
    }
    ctx.globalCompositeOperation = 'source-over';
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

  var RENDERERS = { warp: drawWarp, fractal: drawWarp, waveform: drawWaveform, ember: drawEmber,   // warp/waveform/kaleido* stay REGISTERED (legacy levels may reference them) but are demoted from Tier-I
    kaleido: function (dt, st) { return drawKaleido(dt, st, 0); }, kaleido2: function (dt, st) { return drawKaleido(dt, st, 1); },
    weave: drawWeave, dawn: drawDawn };   // pkg3 Tier-I: dawn (First Light) · weave (Steady Hands) · ember rewritten in-place (Ember Drift)

  // pkg3.0: renderers that obey the CRISP contract (opaque clear, drawn tails) ride the camera; the legacy
  // trail-fill renderers (warp/waveform/kaleido — registered-but-unused for Tier-I) must NOT be transformed:
  // a rotating/zooming camera under a translucent trail fill double-images the whole frame.
  var CRISP = { ember: 1, weave: 1, dawn: 1 };
  function _drawOnce(dt) {
    _t += dt;
    var st;
    if (_fed) { _energy = 1; st = { combo: _fedCombo, playing: true, tier: _fedTier, od: od }; }
    else { _energy = lerp(_energy, _playing ? 1 : 0.25, 0.05); _readAudio(); st = _readStats(); }
    // SECTION / TEMPO-CHANGE detector — MUST live here (runs in BOTH fed + live paths); _readAudio is SKIPPED when _fed, so it can't go there.
    _secFast = lerp(_secFast, level, 0.22); _secSlow = lerp(_secSlow, level, 0.015); _secPulse *= 0.90;
    if (Math.abs(_secFast - _secSlow) > 0.18 && (_t - _lastSection) > 5.5 && beatPunch > 0.42) { _lastSection = _t; _spinDir *= -1; _secPulse = 1; }   // a real section change → flip the spin + fire a one-shot pulse
    if (beatPunch > _kick) _kick = beatPunch; else _kick *= 0.80;   // fast-attack beat env → instant pump that snaps back
    // pkg3.1 CUTAWAY state machine (runs in BOTH fed + live paths so _feed can drive it):
    // tier-UP at combo≥25 → 90ms held breath (_hold) then a 600ms shockwave (_cut 1→0); tier DROP kills it.
    var tierNow = st.tier | 0, comboNow = st.combo | 0;
    if (tierNow > _prevTier && comboNow >= 25) { _cut = 1; _hold = 0.09; }
    else if (tierNow < _prevTier) { _cut = 0; _hold = 0; }
    _prevTier = tierNow;
    if (comboNow < _prevComboSt - 2) _missK = 1;                    // hoisted from ember (3.1): every renderer dims on a break
    _prevComboSt = comboNow;
    _missK = Math.max(0, _missK - dt / 1.5);
    if (_hold > 0) _hold = Math.max(0, _hold - dt);                 // held breath FIRST…
    else if (_cut > 0) _cut = Math.max(0, _cut - dt / 0.6);         // …then the 600ms wave
    // v415 review fix: reduce-motion must be FULLY uneventful — st.cut was already zeroed, but st.hold leaked the
    // ~90ms phase-freeze AND still armed the (st.hold>0) cutaway gate (palette advance + 40-particle gold burst).
    // Zero BOTH so a reduce-motion tier-up neither freezes nor erupts (matches the documented contract).
    var _rm = _reduce();
    st.cut = _rm ? 0 : _cut;
    st.hold = _rm ? 0 : _hold; st.missK = _missK;
    var crisp = !!CRISP[_type];
    if (crisp) {
      _updateCam(dt, st);
      // one setTransform: rotate(tilt)+scale(z) about the frame center, plus the LFO drift
      var cosT = Math.cos(CAM.tilt) * CAM.z, sinT = Math.sin(CAM.tilt) * CAM.z;
      ctx.setTransform(cosT, sinT, -sinT, cosT,
        _w * 0.5 - (cosT * _w * 0.5 - sinT * _h * 0.5) + CAM.dx,
        _h * 0.5 - (sinT * _w * 0.5 + cosT * _h * 0.5) + CAM.dy);
    }
    (RENDERERS[_type] || drawWaveform)(dt, st);
    if (crisp) ctx.setTransform(1, 0, 0, 1, 0, 0);                  // camera off before the vignette/punch overlays
    if (!_reduce()) _punch(st);
    _vignette();
    _audioDbg = { bass: bass, mid: mid, treble: treble, bassN: bassN, level: level, beat: beat, beatPunch: beatPunch, od: od, comboHue: comboHue, comboGlow: comboGlow, combo: st.combo, tier: st.tier, spinDir: _spinDir, secPulse: _secPulse, kick: _kick, cut: st.cut, hold: st.hold, missK: st.missK, camZ: CAM.z, camTilt: CAM.tilt };
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
      _prevTier = 0; _cut = 0; _hold = 0; _missK = 0; _prevComboSt = 0; CAM.z = 1; CAM.tilt = 0; CAM.dx = 0; CAM.dy = 0;   // pkg3.1: fresh cutaway/camera per level
      // toggle the solid-black backdrop base on the ROOT element — tied to the canvas being active, so EVERY path that
      // activates a reactive backdrop gets it (kills the warm-gradient + scrim "lines and blocks" the owner can't stand).
      try { document.documentElement.classList[type ? 'add' : 'remove']('rr-procbg-on'); } catch (e) {}
      if (!_ensureCanvas()) return;
      if (type) { cv.style.display = 'block'; cv.style.width = ''; cv.style.height = ''; cv.style.filter = ''; _resize(); _hidden = 0; _start(); }   // clear any ember combo-blur/filter so it can't leak onto the next level
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
