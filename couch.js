/* ============================================================================
   couch.js — LOCAL COUCH SPLIT-SCREEN VERSUS (build79)
   ----------------------------------------------------------------------------
   The orchestrator for keyboard-P1-vs-controller-P2 on one screen. This file is
   SELF-CONTAINED and INERT until invoked (auto-launches only with ?couch=1) — it
   touches NOTHING in game.js, so single-player is byte-identical with it loaded.

   SHIPPED HERE (verifiable now):
     - the device-claim "ready-up" flow ("press your KEY to claim P1 / press your
       CONTROLLER button to claim P2") + P2 gamepad-index capture + START gate
     - the WIN/LOSE/DRAW verdict screen (brand: gold for the winner)
     - window.RhythmCouch API the future 2nd-engine spawn drops into

   DEFERRED (needs the game.js factory refactor + a real 2-person hardware test —
   see LOCAL_VERSUS_BRIEF.md): the actual second engine. startMatch() detects the
   future RhythmGame.createEngine() factory and, until it exists, shows an honest
   "engine integration pending" note instead of dead-ending.
   ============================================================================ */
(function () {
  'use strict';

  var P1 = null;          // P1 claim: { device:'keyboard' }
  var P2 = null;          // P2 claim: { device:'gamepad', index:N, id:'…' }
  var claimRaf = 0;
  var _padBaseline = {};  // gamepad button baseline so we capture a fresh PRESS, not a held button
  function _el(tag, id, cls) { var e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; return e; }

  // ---- one-time CSS (injected; keeps index.html untouched beyond the canvas) --------------
  function injectCss() {
    if (document.getElementById('couch-css')) return;
    var s = document.createElement('style'); s.id = 'couch-css';
    s.textContent = [
      '.couch-overlay{position:fixed;inset:0;z-index:120;display:none;align-items:center;justify-content:center;',
      '  background:rgba(6,4,3,0.86);backdrop-filter:blur(6px);font-family:"Chakra Petch",sans-serif;}',
      '.couch-overlay.open{display:flex;}',
      '.couch-card{width:min(760px,92vw);background:linear-gradient(180deg,rgba(20,12,10,0.96),rgba(10,7,6,0.97));',
      '  border:1px solid rgba(255,42,48,0.4);border-radius:16px;padding:26px 28px;box-shadow:0 0 50px rgba(255,30,30,0.25);}',
      '.couch-title{font-family:"Unbounded",sans-serif;font-weight:800;font-size:24px;letter-spacing:0.02em;color:#f3efeb;text-align:center;margin:0 0 4px;}',
      '.couch-sub{font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#b9b2ac;text-align:center;margin:0 0 22px;}',
      '.couch-slots{display:grid;grid-template-columns:1fr 1fr;gap:16px;}',
      '.couch-slot{border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:20px 16px;text-align:center;background:rgba(8,5,4,0.6);transition:border-color .2s,box-shadow .2s,transform .2s;}',
      '.couch-slot.claimed{border-color:var(--gold,#e0a93f);box-shadow:0 0 22px rgba(224,169,63,0.3);transform:translateY(-2px);}',
      '.couch-slot .pn{font-family:"Oxanium",sans-serif;font-weight:800;font-size:34px;color:#f3efeb;line-height:1;}',
      '.couch-slot .dev{margin-top:8px;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#b9b2ac;}',
      '.couch-slot.claimed .dev{color:var(--gold,#e0a93f);}',
      '.couch-slot .hint{margin-top:10px;font-size:11px;color:#8a847d;}',
      '.couch-actions{display:flex;gap:12px;justify-content:center;margin-top:22px;}',
      '.couch-btn{font-family:"Chakra Petch",sans-serif;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;font-size:13px;',
      '  padding:11px 22px;border-radius:10px;border:1px solid rgba(255,255,255,0.16);background:rgba(14,9,8,0.8);color:#dad7d2;cursor:pointer;}',
      '.couch-btn.go{border-color:var(--crimson,#ff1f2e);color:#fff;background:linear-gradient(180deg,rgba(255,42,48,0.3),rgba(120,10,14,0.4));}',
      '.couch-btn:disabled{opacity:0.4;cursor:not-allowed;}',
      '.couch-note{margin-top:16px;font-size:11px;color:#8a847d;text-align:center;line-height:1.5;}',
      /* verdict */
      '.couch-verdict{text-align:center;}',
      '.couch-verdict .vt{font-family:"Unbounded",sans-serif;font-weight:800;font-size:30px;margin:0 0 16px;}',
      '.couch-verdict .vt.win{color:var(--gold,#e0a93f);text-shadow:0 0 22px rgba(224,169,63,0.5);}',
      '.couch-verdict .vt.draw{color:#dad7d2;}',
      '.couch-verdict .vrow{display:grid;grid-template-columns:1fr 1fr;gap:16px;}',
      '.couch-verdict .vcell{border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:16px;}',
      '.couch-verdict .vcell.won{border-color:var(--gold,#e0a93f);box-shadow:0 0 20px rgba(224,169,63,0.3);}',
      '.couch-verdict .vp{font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#b9b2ac;}',
      '.couch-verdict .vs{font-family:"Oxanium",sans-serif;font-weight:800;font-size:30px;color:#f3efeb;}'
    ].join('');
    document.head.appendChild(s);
  }

  function host() {
    var el = document.getElementById('couch-claim');
    // Parent to <body>, NOT #game: the engine's endGame() calls showScreen('results') which strips
    // #game.active and would hide a #game-parented overlay. A body-parented fixed/z-120 overlay (the
    // claim flow AND the verdict) survives that screen switch and stays on top. (COUCH-OVERLAY-BODY)
    if (!el) { el = document.createElement('div'); el.id = 'couch-claim'; el.className = 'couch-overlay'; document.body.appendChild(el); }
    else if (el.parentNode !== document.body) { document.body.appendChild(el); }
    el.className = 'couch-overlay'; // reset
    return el;
  }

  // ---- the claim / ready-up flow ----------------------------------------------------------
  function renderClaim() {
    var el = host();
    el.classList.add('open');   // host() resets className each render — re-assert visibility so a claim doesn't hide the overlay (COUCH-1)
    el.innerHTML =
      '<div class="couch-card">' +
        '<h2 class="couch-title">Local Versus — Claim Your Player</h2>' +
        '<p class="couch-sub">Press your KEY for P1 · press your CONTROLLER for P2</p>' +
        '<div class="couch-slots">' +
          '<div class="couch-slot' + (P1 ? ' claimed' : '') + '" id="couch-p1"><div class="pn">P1</div><div class="dev">' + (P1 ? 'Keyboard ✓' : 'Keyboard') + '</div><div class="hint">' + (P1 ? 'Ready' : 'Press any lane key…') + '</div></div>' +
          '<div class="couch-slot' + (P2 ? ' claimed' : '') + '" id="couch-p2"><div class="pn">P2</div><div class="dev">' + (P2 ? ('Controller ✓ (#' + P2.index + ')') : 'Controller') + '</div><div class="hint">' + (P2 ? 'Ready' : 'Press any button…') + '</div></div>' +
        '</div>' +
        '<div class="couch-actions">' +
          '<button class="couch-btn" id="couch-cancel">Cancel</button>' +
          '<button class="couch-btn go" id="couch-start"' + (P1 && P2 ? '' : ' disabled') + '>Start</button>' +
        '</div>' +
        '<div class="couch-note">Two highways, one screen. Same song, independent scores.</div>' +
      '</div>';
    var c = document.getElementById('couch-cancel'); if (c) c.onclick = close;
    var st = document.getElementById('couch-start'); if (st) { st.onclick = function () { if (P1 && P2) startMatch(); }; if (P1 && P2) st.focus(); }   // focus Start when both ready so keyboard P1 can Enter — COUCH-FOCUS
  }

  function onClaimKey(e) {
    if (e.key === 'Escape') { close(); return; }                       // Escape always closes (even after P1 claimed) — COUCH-ESC
    if (e.key === 'Enter' && P1 && P2) { startMatch(); return; }        // both ready → Enter starts (keyboard-friendly) — COUCH-FOCUS
    if (P1) return;                                                     // first keyboard press claims P1
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    P1 = { device: 'keyboard' };
    renderClaim();
  }

  function pollClaimPads() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) {
      var gp = pads[i]; if (!gp) continue;
      var base = _padBaseline[gp.index];
      if (!base) { _padBaseline[gp.index] = gp.buttons.map(function (b) { return b.pressed; }); continue; }
      for (var b = 0; b < gp.buttons.length; b++) {
        if (gp.buttons[b].pressed && !base[b]) {       // a fresh press on this pad
          if (!P2) { P2 = { device: 'gamepad', index: gp.index, id: gp.id, claimBtn: b }; renderClaim(); }
        }
      }
      _padBaseline[gp.index] = gp.buttons.map(function (bb) { return bb.pressed; });
    }
    claimRaf = requestAnimationFrame(pollClaimPads);
  }

  function open() {
    injectCss();
    P1 = null; P2 = null; _padBaseline = {};
    renderClaim();
    host().classList.add('open');
    window.addEventListener('keydown', onClaimKey, true);
    if (!claimRaf) claimRaf = requestAnimationFrame(pollClaimPads);
  }

  function close() {
    window.removeEventListener('keydown', onClaimKey, true);
    if (claimRaf) { cancelAnimationFrame(claimRaf); claimRaf = 0; }
    var el = document.getElementById('couch-claim'); if (el) el.classList.remove('open');
    abortMatch();   // also tear down any live couch match (Escape/Cancel/Done mid-versus)
  }
  // clean teardown of a running match WITHOUT showing the verdict (cancel/escape path)
  function abortMatch() {
    if (typeof _deckRaf !== 'undefined' && _deckRaf) { cancelAnimationFrame(_deckRaf); _deckRaf = 0; }
    try { if (typeof _p2 !== 'undefined' && _p2 && _p2.teardown) _p2.teardown(); } catch (e) {}
    if (typeof _p2 !== 'undefined') _p2 = null;
    try { unmountDeck(); } catch (e) {}
  }

  // ---- the live match: P2 shadow-scorer + a second highway deck ---------------------------
  var _p2 = null;            // the RhythmGameP2 layer (from RhythmGame.createEngine)
  var _deckRaf = 0;         // the P2 deck render loop
  var _gctx = null;         // P2 deck canvas 2D context
  var _spk = [];            // P2 deck sparkle pool (reused across frames, zero per-frame alloc)
  (function () { for (var i = 0; i < 48; i++) _spk.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, cr: false }); })();
  var _gFlash = [0, 0, 0, 0, 0, 0], _gFlashCr = [false, false, false, false, false, false];
  var _matchEnded = false, _lastDur = 0;

  function startMatch() {
    close();
    var RG = window.RhythmGame;
    // The real path: RhythmGame.createEngine() (build99j) spins up the P2 shadow-scorer. If it's
    // somehow absent (older game.js), fall back to the honest "pending" note instead of crashing.
    if (!RG || typeof RG.createEngine !== 'function') { notePending(); return; }

    _matchEnded = false; _lastDur = 0;
    for (var l = 0; l < 6; l++) { _gFlash[l] = 0; _gFlashCr[l] = false; }
    for (var s = 0; s < _spk.length; s++) _spk[s].on = false;
    _gctx = null;

    mountDeck();            // split-screen layout + the P2 deck/HUD chrome (reuses the vs-mode CSS)

    // spawn the P2 layer FIRST so it's listening before the song clock starts. setVsMode(true) is
    // called inside createEngine; it reports P2's final score to onSongEnd → showVerdict.
    try {
      _p2 = RG.createEngine({
        canvasId: 'hwy2', expose: 'RhythmGameP2', isP2: true,
        gamepadIndex: P2 && P2.index, keyMap: {}, lsPrefix: 'p2_', noLevelFx: true,
        onSongEnd: function (p2Score) { onMatchEnd(p2Score); }
      });
    } catch (e) { _p2 = null; }

    // start P1's song. A currently-picked catalog track replays if the platform exposes a re-launch;
    // otherwise the bundled demo track is the reliable, fully-local versus song.
    startSong();

    // drive the P2 deck every frame while the match is live
    if (_deckRaf) cancelAnimationFrame(_deckRaf);
    _deckRaf = requestAnimationFrame(deckLoop);
  }

  function startSong() {
    var RG = window.RhythmGame, RC = window.RhythmCatalog;
    try {
      // honor the difficulty already chosen for solo play (createEngine reads the same global)
      if (RC && RC.getCouchTrack && RC.launchTrack) {
        var tk = RC.getCouchTrack();
        if (tk) { RC.launchTrack(tk, { keepEnvironment: false }); return; }
      }
    } catch (e) {}
    try { RG.playDemo(); } catch (e) { try { RG.play && RG.play(); } catch (e2) {} }
  }

  // ---- split-screen layout: P2 deck (LEFT) + center seam, reusing the vs-mode grid + CSS ----
  function mountDeck() {
    var game = document.getElementById('game'); if (!game) return;
    game.classList.add('vs-mode');                 // the existing two-column split (#game.vs-mode in index.html)
    try { document.documentElement.classList.add('rr-vs'); } catch (e) {}   // hide single-deck level fate-cards/mechanic on the half-deck
    if (document.getElementById('couch-deck')) return;   // idempotent
    // P2 deck = LEFT grid cell. We reuse the MP vs ids/classes so the polished CSS applies for free.
    var deck = _el('div', 'vs-opp-deck'); deck.id = 'couch-deck';
    var cv = _el('canvas', 'vs-opp-hwy'); cv.id = 'couch-hwy2'; deck.appendChild(cv);
    var sc = _el('div', 'vs-opp-score');
    var lab = _el('div', null, 'vs-lab'); lab.textContent = 'P2 · CONTROLLER'; sc.appendChild(lab);
    var val = _el('div', 'couch-p2-val', 'vs-val'); val.textContent = '0'; sc.appendChild(val);
    deck.appendChild(sc);
    var mult = _el('div', 'couch-p2-mult', 'vs-opp-pill'); mult.textContent = '1x'; deck.appendChild(mult);
    var cmb = _el('div', 'couch-p2-combo', 'vs-opp-pill'); cmb.textContent = '0x'; deck.appendChild(cmb);
    var od = _el('div', 'couch-p2-od', 'vs-od'); od.appendChild(_el('i')); deck.appendChild(od);
    game.appendChild(deck);
    // center seam: the live P1↔P2 delta
    var seam = _el('div', 'vs-seam'); seam.id = 'couch-seam';
    seam.appendChild(_el('div', 'vs-prog'));
    var delta = _el('div', 'vs-delta'); delta.textContent = 'EVEN'; seam.appendChild(delta);
    game.appendChild(seam);
    // YOUR (P1) score plate into .game-center (the right deck is P1's real highway)
    var center = game.querySelector('.game-center');
    if (center && !document.getElementById('couch-p1-score')) {
      var ys = _el('div', 'vs-you-score'); ys.id = 'couch-p1-score';
      var yl = _el('div', null, 'vs-lab'); yl.textContent = 'P1 · KEYBOARD'; ys.appendChild(yl);
      var yv = _el('div', 'couch-p1-val', 'vs-val'); yv.textContent = '0'; ys.appendChild(yv);
      center.appendChild(ys);
    }
  }
  function unmountDeck() {
    var game = document.getElementById('game');
    if (game) game.classList.remove('vs-mode');
    try { document.documentElement.classList.remove('rr-vs'); } catch (e) {}
    ['couch-deck', 'couch-seam', 'couch-p1-score'].forEach(function (id) {
      var e = document.getElementById(id); if (e && e.parentNode) e.parentNode.removeChild(e);
    });
    _gctx = null;
  }

  // ---- the P2 deck render loop: P2's REAL play, drawn beside P1's highway --------------------
  // Ported from multiplayer.js renderGhost(): reads the LOCAL board's lane frame + guitar art
  // (public RhythmGame API) and P2's OWN ghost-notes + drained hit/miss events. The strings, gems,
  // perspective + neck-recede warp all mirror P1's deck so it reads as a live second board.
  function deckLoop() {
    _deckRaf = requestAnimationFrame(deckLoop);
    var RG = window.RhythmGame; if (!RG) return;
    var stt = RG.getLiveStats && RG.getLiveStats();
    var p2f = (_p2 && _p2.getP2Frame) ? _p2.getP2Frame() : null;
    // end-of-song safety net: if the engine's onSongEnd didn't fire (e.g. demo with no end cb chain),
    // detect playing→stopped and resolve the verdict from the last frames.
    if (stt) {
      if (stt.playing) _lastDur = 1; else if (_lastDur === 1 && !_matchEnded) { onMatchEnd(p2f ? p2f.sc : (_p2 ? _p2.getP2Score() : 0)); }
    }
    renderHud(stt, p2f);
    renderP2Deck(p2f);
  }

  function renderHud(stt, p2f) {
    var p1 = stt ? Math.round(stt.score) : 0;
    var p2 = p2f ? p2f.sc : (_p2 && _p2.getP2Score ? Math.round(_p2.getP2Score()) : 0);
    var e;
    e = document.getElementById('couch-p1-val'); if (e) e.textContent = p1.toLocaleString();
    e = document.getElementById('couch-p2-val'); if (e) e.textContent = p2.toLocaleString();
    if (p2f) {
      e = document.getElementById('couch-p2-mult'); if (e) e.textContent = (p2f.mu || 1) + 'x';
      e = document.getElementById('couch-p2-combo'); if (e) e.textContent = (p2f.cb || 0) + 'x';
      e = document.getElementById('couch-p2-od'); if (e) { var fi = e.firstChild; if (fi) fi.style.transform = 'scaleX(' + Math.max(0, Math.min(1, p2f.od || 0)) + ')'; e.classList.toggle('active', !!p2f.oda); }
    }
    e = document.querySelector('#couch-seam .vs-delta');
    if (e) { var d = p1 - p2; e.textContent = d === 0 ? 'EVEN' : (d > 0 ? 'P1 +' + _fmtK(Math.abs(d)) : 'P2 +' + _fmtK(Math.abs(d))); }
    var prog = document.querySelector('#couch-seam .vs-prog');
    if (prog && stt) prog.style.setProperty('--p', Math.round((stt.progress || 0) * 100) + '%');
  }
  function _fmtK(n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

  function renderP2Deck(p2f) {
    var RG = window.RhythmGame;
    var cv = document.getElementById('couch-hwy2'); if (!cv) return;
    if (!_gctx) { _gctx = cv.getContext('2d'); if (!_gctx) return; }
    var lf = RG.getLaneFrame && RG.getLaneFrame();
    if (!lf || !lf.nearX || !lf.w) return;
    var cw = cv.clientWidth, chh = cv.clientHeight; if (!cw || !chh) return;
    var bw = Math.max(1, cw), bh = Math.max(1, chh);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    var sx = bw / lf.w, sy = bh / lf.h, N = lf.nearX.length, i;
    var g = _gctx;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh);
    // guitar behind the strings — warped to match P1's neck-recede (reads as a live second board)
    var art = RG.getGuitarArt && RG.getGuitarArt();
    if (art && art.img) {
      g.save(); g.globalAlpha = 0.9;
      try {
        var gwp = art.warp || 0;
        if (gwp > 0 && art.nutFY != null && art.bridgeFY != null) {
          var giw = art.img.width, gih = art.img.height, GNS = 40;
          var gnY = (art.gy + art.bridgeFY * art.gh) * sy, gfY = (art.gy + art.nutFY * art.gh) * sy;
          var gcX = (art.gx + 0.5 * art.gw) * sx, gwpx = art.gw * sx;
          for (var gb = 0; gb < GNS; gb++) {
            var gv0 = gb / GNS, gv1 = (gb + 1) / GNS;
            var gdy0 = (art.gy + gv0 * art.gh) * sy, gdy1 = (art.gy + gv1 * art.gh) * sy;
            var guu = ((gdy0 + gdy1) / 2 - gnY) / (gfY - gnY);
            var gdw = gwpx * (1 - gwp * (guu < 0 ? 0 : guu));
            g.drawImage(art.img, 0, gv0 * gih, giw, (gv1 - gv0) * gih, gcX - gdw / 2, gdy0, gdw, (gdy1 - gdy0) + 0.6);
          }
        } else { g.drawImage(art.img, art.gx * sx, art.gy * sy, art.gw * sx, art.gh * sy); }
      } catch (e) {}
      g.restore();
    }
    // lane strings (far -> near)
    g.lineWidth = Math.max(1, lf.lw * 0.06 * sx);
    g.strokeStyle = 'rgba(220,217,212,0.44)';
    g.beginPath();
    for (i = 0; i < N; i++) { g.moveTo(lf.farX[i] * sx, lf.farY * sy); g.lineTo(lf.nearX[i] * sx, lf.nearY * sy); }
    g.stroke();
    var cols = lf.colors || null;
    // P2's gems — the SAME chart, marked with P2's REAL judged state (a struck gem fades)
    var gn = (_p2 && _p2.getP2Ghost) ? _p2.getP2Ghost() : null;
    if (gn && gn.n) {
      var zf = lf.persp || 0, warp = lf.warp || 0, cxw = (lf.nearX[0] + lf.nearX[N - 1]) / 2, gi, u, z, lx, gx, gy, ds, rad, aGem;
      for (gi = 0; gi < gn.n; gi++) {
        var it = gn.items[gi], dd = it.d < 0 ? 0 : it.d;
        if (zf > 1) { z = 1 + dd * (zf - 1); u = (1 - 1 / z) / (1 - 1 / zf); } else { u = dd; }
        lx = lf.nearX[it.lane] + (lf.farX[it.lane] - lf.nearX[it.lane]) * u;
        if (warp > 0) lx = cxw + (lx - cxw) * (1 - warp * (u < 0 ? 0 : u));
        gx = lx * sx; gy = (lf.nearY + (lf.farY - lf.nearY) * u) * sy;
        ds = (zf > 1) ? (1 / (1 + (dd < -0.2 ? -0.2 : dd) * (zf - 1))) : (1 - 0.7 * dd);
        rad = lf.lw * 0.22 * ds * sx; if (rad < 1) rad = 1;
        if (it.type === 3) {   // bomb → hollow dim ring
          g.strokeStyle = 'rgba(180,178,174,' + (0.35 * (1 - u * 0.5)).toFixed(3) + ')';
          g.lineWidth = Math.max(1, rad * 0.4);
          g.beginPath(); g.arc(gx, gy, rad, 0, 6.283); g.stroke();
          continue;
        }
        var lcol = (cols && cols[it.lane]) ? cols[it.lane] : '255,60,60';
        aGem = (0.62 + 0.38 * (1 - u)) * (it.hit ? 0.18 : 1);   // P2 already hit it → fade the gem
        if (it.type === 1) {   // hold → lane-colored beam toward the nut
          var d2 = dd + 0.12; if (d2 > 1.02) d2 = 1.02;
          var u2; if (zf > 1) { var z2 = 1 + d2 * (zf - 1); u2 = (1 - 1 / z2) / (1 - 1 / zf); } else { u2 = d2; }
          var lx2 = lf.nearX[it.lane] + (lf.farX[it.lane] - lf.nearX[it.lane]) * u2;
          if (warp > 0) lx2 = cxw + (lx2 - cxw) * (1 - warp * (u2 < 0 ? 0 : u2));
          g.strokeStyle = 'rgba(' + lcol + ',' + (aGem * 0.5).toFixed(3) + ')';
          g.lineWidth = Math.max(1.5, rad * 0.8);
          g.beginPath(); g.moveTo(gx, gy); g.lineTo(lx2 * sx, (lf.nearY + (lf.farY - lf.nearY) * u2) * sy); g.stroke();
        }
        g.fillStyle = 'rgba(' + lcol + ',' + aGem.toFixed(3) + ')';
        g.beginPath(); g.arc(gx, gy, rad, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(255,255,255,' + (aGem * 0.55).toFixed(3) + ')';
        g.beginPath(); g.arc(gx - rad * 0.3, gy - rad * 0.3, rad * 0.34, 0, 6.283); g.fill();
        if (it.type === 2) {   // chord → white double-rim
          g.strokeStyle = 'rgba(255,255,255,' + (aGem * 0.7).toFixed(3) + ')';
          g.lineWidth = Math.max(1, rad * 0.3);
          g.beginPath(); g.arc(gx, gy, rad * 1.3, 0, 6.283); g.stroke();
        }
      }
    }
    // P2 hit/miss events → authoritative lane flashes + sparkles (drained from getP2Frame)
    var ev = p2f && p2f.ev;
    if (ev && ev.length) {
      for (var e = 0; e < ev.length; e++) {
        var L = ev[e].l | 0; if (L < 0 || L >= N) continue;
        var crimson = (ev[e].j === 'm');
        _gFlash[L] = 1; _gFlashCr[L] = crimson;
        var cxp = lf.nearX[L] * sx, cyp = lf.nearY * sy;
        for (var sp = 0; sp < _spk.length; sp++) {
          var Pk = _spk[sp]; if (Pk.on) continue;
          Pk.on = true; Pk.x = cxp; Pk.y = cyp; Pk.cr = crimson;
          Pk.vx = (Math.random() - 0.5) * 1.6 * sx; Pk.vy = -(0.8 + Math.random() * 1.4) * sy;
          Pk.life = 0; Pk.max = crimson ? 0.30 : 0.42; break;
        }
      }
    }
    // per-lane catcher buttons — press down + light white-hot (crimson on a miss) when P2 strikes
    for (i = 0; i < N; i++) {
      var fl = _gFlash[i];
      var bcol = (cols && cols[i]) ? cols[i] : '255,60,60';
      var press = fl * lf.lw * 0.10 * sy, bx = lf.nearX[i] * sx, by = lf.nearY * sy + press, brad = lf.lw * 0.26 * sx;
      g.save();
      g.lineWidth = Math.max(1.4, lf.lw * 0.055 * sx);
      g.strokeStyle = 'rgba(' + bcol + ',' + (0.5 + fl * 0.5).toFixed(3) + ')';
      if (fl > 0.02) { g.shadowColor = _gFlashCr[i] ? '#ff2834' : 'rgba(255,250,235,1)'; g.shadowBlur = 16 * sx * fl; }
      g.beginPath(); g.arc(bx, by, brad, 0, 6.283); g.stroke();
      if (fl > 0.04) { g.globalAlpha = fl; g.fillStyle = _gFlashCr[i] ? 'rgba(255,40,52,0.85)' : 'rgba(255,250,238,0.95)'; g.beginPath(); g.arc(bx, by, brad * (0.5 + fl * 0.35), 0, 6.283); g.fill(); }
      g.restore();
      _gFlash[i] *= 0.84; if (_gFlash[i] <= 0.02) _gFlash[i] = 0;
    }
    // sparkles
    for (var k = 0; k < _spk.length; k++) {
      var Q = _spk[k]; if (!Q.on) continue;
      Q.life += 0.016; if (Q.life >= Q.max) { Q.on = false; continue; }
      Q.x += Q.vx; Q.y += Q.vy; Q.vy += 0.06 * sy;
      var a = 1 - Q.life / Q.max;
      g.fillStyle = Q.cr ? 'rgba(255,60,70,' + a.toFixed(3) + ')' : 'rgba(255,240,210,' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(Q.x, Q.y, 2.2 * sx * a + 0.6, 0, 6.283); g.fill();
    }
  }

  function onMatchEnd(p2Score) {
    if (_matchEnded) return; _matchEnded = true;
    if (_deckRaf) { cancelAnimationFrame(_deckRaf); _deckRaf = 0; }
    var RG = window.RhythmGame;
    var p1 = 0;
    try { var lr = RG && RG.lastResults && RG.lastResults(); if (lr && typeof lr.score === 'number') p1 = lr.score; else { var st = RG.getLiveStats && RG.getLiveStats(); p1 = st ? Math.round(st.score) : 0; } } catch (e) {}
    var p2 = (typeof p2Score === 'number') ? Math.round(p2Score) : (_p2 && _p2.getP2Score ? Math.round(_p2.getP2Score()) : 0);
    try { if (_p2 && _p2.teardown) _p2.teardown(); } catch (e) {}
    _p2 = null;
    unmountDeck();
    // onSongEnd fires from inside endGame() RIGHT BEFORE showScreen('results') runs synchronously.
    // Defer the verdict one macrotask so it paints AFTER the results screen settles → the body-parented
    // z-120 overlay lands cleanly on top instead of racing the screen switch. (COUCH-VERDICT-DEFER)
    setTimeout(function () { showVerdict(p1, p2); }, 0);
  }

  function notePending() {
    injectCss();
    var el = host(); el.classList.add('open');
    el.innerHTML =
      '<div class="couch-card couch-verdict">' +
        '<div class="vt draw">Versus — almost there</div>' +
        '<div class="couch-note">Both devices are claimed (P1 keyboard, P2 controller #' + (P2 ? P2.index : '?') + ').<br>' +
        'The split-screen second deck needs the engine-doubling pass before it can run — see LOCAL_VERSUS_BRIEF.md.<br>' +
        'Everything up to here (the ready-up + device capture) is live.</div>' +
        '<div class="couch-actions"><button class="couch-btn" id="couch-ok">OK</button></div>' +
      '</div>';
    var ok = document.getElementById('couch-ok'); if (ok) ok.onclick = close;
  }

  // ---- verdict screen (reused for the local result once the 2nd engine reports scores) ----
  function showVerdict(p1Score, p2Score) {
    injectCss();
    var el = host(); el.classList.add('open');
    var draw = p1Score === p2Score, p1won = p1Score > p2Score;
    var title = draw ? 'DRAW' : ('PLAYER ' + (p1won ? '1' : '2') + ' WINS');
    el.innerHTML =
      '<div class="couch-card couch-verdict">' +
        '<div class="vt ' + (draw ? 'draw' : 'win') + '">' + title + '</div>' +
        '<div class="vrow">' +
          '<div class="vcell' + (!draw && p1won ? ' won' : '') + '"><div class="vp">P1 · Keyboard</div><div class="vs">' + (p1Score | 0).toLocaleString() + '</div></div>' +
          '<div class="vcell' + (!draw && !p1won ? ' won' : '') + '"><div class="vp">P2 · Controller</div><div class="vs">' + (p2Score | 0).toLocaleString() + '</div></div>' +
        '</div>' +
        '<div class="couch-actions"><button class="couch-btn" id="couch-rematch">Rematch</button><button class="couch-btn" id="couch-done">Done</button></div>' +
      '</div>';
    var rm = document.getElementById('couch-rematch'); if (rm) rm.onclick = open;
    var dn = document.getElementById('couch-done'); if (dn) dn.onclick = close;
  }

  // ---- public API + auto-launch gate ------------------------------------------------------
  window.RhythmCouch = {
    open: open, close: close, startMatch: startMatch, showVerdict: showVerdict,
    claimState: function () { return { p1: P1, p2: P2, ready: !!(P1 && P2) }; },
    // test helpers (no hardware): simulate the claims so the flow is verifiable headless
    _claimP1: function () { if (!P1) { P1 = { device: 'keyboard' }; renderClaim(); } return P1; },
    _claimP2: function (idx) { if (!P2) { P2 = { device: 'gamepad', index: idx == null ? 0 : idx, id: 'sim' }; renderClaim(); } return P2; }
  };

  function maybeAutoLaunch() {
    try { if (/[?&]couch=1\b/.test(location.search)) { /* dev preview of the claim flow */ open(); } } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeAutoLaunch);
  else maybeAutoLaunch();
})();
