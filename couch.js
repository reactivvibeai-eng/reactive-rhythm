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
    if (!el) { el = document.createElement('div'); el.id = 'couch-claim'; el.className = 'couch-overlay'; (document.getElementById('game') || document.body).appendChild(el); }
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
    var st = document.getElementById('couch-start'); if (st) st.onclick = function () { if (P1 && P2) startMatch(); };
  }

  function onClaimKey(e) {
    // first keyboard press claims P1 (keyboard). Ignore modifier-only / Escape.
    if (P1) return;
    if (e.key === 'Escape') { close(); return; }
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
  }

  // ---- start the match (forward-compatible with the future 2nd-engine factory) ------------
  function startMatch() {
    close();
    var RG = window.RhythmGame;
    // The 2nd engine requires the game.js factory refactor (see LOCAL_VERSUS_BRIEF.md). When that
    // lands, RhythmGame.createEngine exists and we spawn P2 here. Until then, be honest — don't
    // dead-end or crash; the device-claim flow above is the shippable, verifiable part today.
    if (RG && typeof RG.createEngine === 'function') {
      // FUTURE PATH (drops in once the factory exists):
      //   document.body.classList.add('couch');
      //   document.getElementById('hwy2').hidden = false;
      //   var p2 = RG.createEngine({ canvasId:'hwy2', expose:'RhythmGameP2', isP2:true,
      //     gamepadIndex:P2.index, keyMap:{}, lsPrefix:'p2_', noLevelFx:true,
      //     clockFn:function(){ return RG.__time(); }, beats:RG.__beats && RG.__beats() });
      //   RG.setVsMode && RG.setVsMode(true); p2.setVsMode && p2.setVsMode(true);
      //   ... startAt both at one atMs, then on end call showVerdict(p1.score, p2.score) ...
      try { RG.createEngine({ canvasId: 'hwy2', expose: 'RhythmGameP2', isP2: true, gamepadIndex: P2 && P2.index, keyMap: {}, lsPrefix: 'p2_', noLevelFx: true }); } catch (e) {}
      return;
    }
    notePending();
  }

  function notePending() {
    injectCss();
    var el = host(); el.classList.add('open');
    el.innerHTML =
      '<div class="couch-card couch-verdict">' +
        '<div class="vt">Versus — almost there</div>' +
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
