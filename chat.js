// ===========================================================================
// REACTIVE RHYTHM — chat.js (build111 s1)
//   Shared TEXT-chat primitives: profanity filter + matcher, extracted out of
//   catalog.js's IIFE (scrubName/LB_BADWORDS were trapped in its closure and
//   unreachable from multiplayer.js). Load BEFORE catalog.js and multiplayer.js
//   — both <script>-include this file and consume window.RhythmChat.
//
//   filterChatText(s) is MASK-not-REJECT: matched substrings become '***' —
//   the message is never discarded outright (differs from scrubName/cleanName,
//   which return a generic replacement for the WHOLE string — that's the right
//   call for a single display NAME, but wrong for a chat MESSAGE where most of
//   the text is fine and should survive).
//
//   ZERO behavior change to existing leaderboard-name filtering: catalog.js's
//   scrubName and index.html's cleanName keep their own copies/logic for now
//   (both already ship, both already work) — this file exists so NEW chat
//   surfaces (lobby/room chat, reports) have one shared source instead of a
//   third hand-copied wordlist. See CHANGELOG build111 for the extraction note.
// ===========================================================================
(function () {
  'use strict';

  // Same list as catalog.js `LB_BADWORDS` / index.html `LB_BADWORDS` — kept in
  // sync by hand (three call sites total: leaderboard names ×2 + chat text ×1).
  // If you touch this list, touch the other two too.
  var BADWORDS = ['nigger', 'nigga', 'faggot', 'retard', 'cunt', 'rape', 'kike', 'spic', 'chink', 'fuck', 'shit', 'bitch', 'whore', 'slut', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'nazi', 'wank', 'twat', 'jizz', 'coon', 'tranny'];

  // Leet-speak normalization (mirrors scrubName/cleanName) — used only to DETECT
  // a hit; the mask is applied against the ORIGINAL string so punctuation/case
  // in the source text survives untouched outside the masked span.
  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\s_\-.]/g, '')
      .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
      .replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's').replace(/!/g, 'i');
  }

  // Builds one case-insensitive regex alternation from BADWORDS, longest-first
  // so a longer match (e.g. a compound) wins over a shorter substring inside it.
  var _rx = null;
  function matcher() {
    if (_rx) return _rx;
    var words = BADWORDS.slice().sort(function (a, b) { return b.length - a.length; });
    var esc = words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    _rx = new RegExp('(' + esc.join('|') + ')', 'gi');
    return _rx;
  }

  // mask-not-reject: replace each matched run of letters with a same-length
  // '***' (fixed 3 stars, not length-matched — avoids leaking word length as a
  // side channel for anything egregious, matches common chat-filter convention).
  // Runs a plain substring pass on the RAW text first (catches exact-cased
  // hits fast + handles the common case); falls back to a normalized re-scan
  // so leet/spacing tricks ("n1gg3r", "n i g g e r") still get caught, at the
  // cost of masking the whole matched span (normalization collapses spacing,
  // so we can't map back to exact original offsets in that fallback path —
  // acceptable for a defense-in-depth chat filter, not a leaderboard identity).
  function filterChatText(s) {
    var raw = String(s == null ? '' : s);
    if (!raw) return raw;
    var out = raw.replace(matcher(), '***');
    // fallback: normalized scan catches leet/spaced variants the raw regex missed.
    // If the normalized form contains a badword but the raw pass found nothing,
    // mask the ENTIRE message — we can't safely map normalized offsets back to
    // the original string's punctuation/spacing.
    if (out === raw) {
      var norm = normalize(raw);
      for (var i = 0; i < BADWORDS.length; i++) {
        if (norm.indexOf(BADWORDS[i]) >= 0) return '***';
      }
    }
    return out;
  }

  // Whole-string mask used for display NAMES (roster/kebab/report target labels
  // inside chat.js's own UI) — same semantics as catalog.js scrubName / index.html
  // cleanName, exposed here so chat-adjacent code (chat.js itself, multiplayer.js
  // mod UI) has one call instead of a 4th hand-copy. Leaderboard rendering paths
  // keep using their existing local copies unchanged (zero behavior change).
  function filterDisplayName(s) {
    var raw = String(s == null ? '' : s).trim();
    if (!raw) return 'anon';
    var norm = normalize(raw);
    for (var i = 0; i < BADWORDS.length; i++) { if (norm.indexOf(BADWORDS[i]) >= 0) return 'player'; }
    return raw;
  }

  // =========================================================================
  // build111 s2: LOBBY + ROOM text chat.
  //   No new Realtime channel — rides the EXISTING lobbyCh (rr-lobby) and room
  //   ch (rr-room-<rid>) that multiplayer.js already opens. multiplayer.js
  //   calls mountLobbyChat(lobbyCh)/mountRoomChat(ch,...) at the same points it
  //   already wires 'room-start'/'song' listeners, and teardownLobbyChat() /
  //   teardownRoomChat() at its existing teardown sites (leaveAll, mp-back,
  //   syncActive's idle-close, closeRoom, onRoomStart). Everything here is
  //   pure DOM + closures — chat.js owns its own drawer/panel markup, injected
  //   once on first mount so index.html doesn't need hand-authored chat rows.
  // =========================================================================
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  function initial(s) { return (s || '?').trim().charAt(0).toUpperCase(); }
  // build111 s4 defines the real modal — forward-declared here so s2's flag-button wiring (chat rows render a
  // report flag) never throws before s4 lands. Reassigned near the bottom of this file.
  var openReportModal = function () {};
  function relTime(at) {
    var d = Date.now() - (at || Date.now());
    if (d < 15000) return 'now';
    if (d < 60000) return Math.floor(d / 1000) + 's';
    if (d < 3600000) return Math.floor(d / 60000) + 'm';
    return Math.floor(d / 3600000) + 'h';
  }

  // ---- token-bucket rate limiter: 1 msg / 1.5s sustained, burst 3 ----
  function makeBucket() {
    var tokens = 3, max = 3, refillMs = 1500, last = Date.now();
    return function take() {
      var now = Date.now();
      var elapsed = now - last;
      if (elapsed > 0) { tokens = Math.min(max, tokens + elapsed / refillMs); last = now; }
      if (tokens >= 1) { tokens -= 1; return true; }
      return false;
    };
  }

  // ---- tiny local toast (chat.js is self-contained — doesn't assume game.js loaded yet) ----
  function localToast(msg) {
    try { if (window.RhythmGame && window.RhythmGame.showToast) { window.RhythmGame.showToast(msg, 'neutral'); return; } } catch (e) {}
    // fallback mini-toast so "slow down" still surfaces even if game.js hasn't exposed showToast yet
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:99999;background:rgba(10,7,6,0.92);color:#f4eef0;border:1px solid rgba(224,169,63,0.4);border-radius:10px;padding:8px 14px;font-family:"Chakra Petch",sans-serif;font-size:12px;letter-spacing:.03em;pointer-events:none;opacity:0;transition:opacity .2s;';
      document.body.appendChild(t);
      requestAnimationFrame(function () { t.style.opacity = '1'; });
      setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { try { t.remove(); } catch (e) {} }, 250); }, 1800);
    } catch (e) {}
  }

  // ---- shared row renderer (chat message OR system line) ----
  function rowHtml(m, opts) {
    if (m.sys) return '<div class="rrc-row sys">' + esc(m.text) + '</div>';
    var muted = opts && opts.isMuted && opts.isMuted(m.id);
    if (muted) return '';   // muted peer's bubbles are hidden for everyone honoring the mute (mod-mute 'text')
    var hostTag = (opts && opts.hostId && m.id === opts.hostId) ? ' host' : '';
    var av = '<span class="rrc-av">' + esc(initial(m.name)) + '</span>';
    var flag = (opts && opts.onReport && m.id !== (opts.meId || '')) ?
      '<button class="rrc-flag" type="button" data-flag="' + esc(m.id) + '" data-flagname="' + esc(m.name || 'Player') + '" aria-label="Report ' + esc(m.name || 'this player') + '">' + FLAG_SVG + '</button>' : '';
    return '<div class="rrc-row' + hostTag + '" data-mid="' + esc(m.id) + '">' + av +
      '<span class="rrc-body"><span class="rrc-meta"><span class="rrc-name">' + esc(m.name || 'Player') + '</span><span class="rrc-t">' + relTime(m.at) + '</span></span>' +
      '<span class="rrc-txt">' + esc(m.text) + '</span></span>' + flag + '</div>';
  }
  var FLAG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"></path><path d="M5 4h13l-3 4 3 4H5"></path></svg>';

  // ---- CSS injected once (keeps index.html untouched for the bulk of chat styling) ----
  var _cssInjected = false;
  function injectCss() {
    if (_cssInjected) return; _cssInjected = true;
    var css = '' +
      '.rrc-drawer{position:fixed;right:16px;bottom:16px;z-index:520;display:flex;flex-direction:column;align-items:flex-end;font-family:"Chakra Petch",sans-serif;}' +
      '.rrc-drawer[hidden]{display:none;}' +
      '.rrc-toggle{display:flex;align-items:center;gap:8px;background:linear-gradient(180deg, rgba(40,20,22,0.82), rgba(16,9,10,0.90));border:1px solid rgba(218,210,206,0.22);color:#f4eef0;border-radius:999px;padding:9px 16px;cursor:pointer;font-family:"Oxanium",sans-serif;font-weight:700;font-size:12px;letter-spacing:.06em;box-shadow:0 10px 24px -12px rgba(0,0,0,0.6);}' +
      '.rrc-toggle:hover{border-color:rgba(255,31,46,0.5);}' +
      '.rrc-badge{background:#ff1f2e;color:#fff;border-radius:999px;min-width:17px;height:17px;padding:0 5px;font-size:10px;line-height:17px;text-align:center;font-weight:800;display:none;}' +
      '.rrc-badge.on{display:inline-block;}' +
      '.rrc-panel{width:290px;max-width:calc(100vw - 32px);margin-bottom:10px;background:linear-gradient(180deg, rgba(40,20,22,0.90), rgba(10,7,6,0.94));border:1px solid rgba(218,210,206,0.18);border-radius:14px;box-shadow:0 18px 40px -16px rgba(0,0,0,0.7);overflow:hidden;display:flex;flex-direction:column;}' +
      '.rrc-panel[hidden]{display:none;}' +
      '.rrc-panel.room{position:static;width:100%;max-width:none;height:240px;margin:10px 0;}' +
      '.rrc-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid rgba(218,210,206,0.14);}' +
      '.rrc-head-t{font-family:"Oxanium",sans-serif;font-weight:800;font-size:11px;letter-spacing:.1em;color:#e0a93f;text-transform:uppercase;}' +
      '.rrc-close{background:none;border:none;color:#a0938f;cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;}' +
      '.rrc-close:hover{color:#f4eef0;}' +
      '.rrc-list{flex:1;min-height:120px;max-height:280px;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:7px;}' +
      '.rrc-panel.room .rrc-list{max-height:none;}' +
      '.rrc-row{display:flex;gap:8px;align-items:flex-start;animation:rrc-in .18s var(--ease-settle,ease-out);}' +
      '.rrc-row.sys{justify-content:center;text-align:center;color:#8d8380;font-style:italic;font-size:11px;opacity:.85;padding:2px 0;}' +
      '@keyframes rrc-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}' +
      'html.rr-reduce-motion .rrc-row{animation:rrc-fade .18s linear;}' +
      '@keyframes rrc-fade{from{opacity:0;}to{opacity:1;}}' +
      '.rrc-av{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:rgba(224,169,63,0.16);border:1px solid rgba(224,169,63,0.35);color:#e0a93f;display:grid;place-items:center;font-family:"Oxanium",sans-serif;font-weight:800;font-size:10px;}' +
      '.rrc-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}' +
      '.rrc-meta{display:flex;align-items:baseline;gap:6px;}' +
      '.rrc-name{font-family:"Oxanium",sans-serif;font-weight:700;font-size:11.5px;color:#dad7d2;}' +
      '.rrc-row.host .rrc-name{color:#e0a93f;}' +
      '.rrc-t{font-size:9.5px;color:#7d736e;letter-spacing:.03em;}' +
      '.rrc-txt{font-size:12.5px;color:#f4eef0;word-break:break-word;line-height:1.35;}' +
      '.rrc-flag{flex:0 0 auto;background:none;border:none;color:#7d736e;cursor:pointer;padding:2px;opacity:.6;}' +
      '.rrc-flag svg{width:13px;height:13px;display:block;}' +
      '.rrc-flag:hover{color:#ff1f2e;opacity:1;}' +
      '.rrc-inputrow{display:flex;gap:6px;padding:8px 10px;border-top:1px solid rgba(218,210,206,0.14);}' +
      '.rrc-input{flex:1;min-width:0;background:rgba(10,7,6,0.55);border:1px solid rgba(218,210,206,0.2);border-radius:8px;color:#f4eef0;font-family:"Chakra Petch",sans-serif;font-size:12.5px;padding:8px 10px;}' +
      '.rrc-input:focus{outline:none;border-color:rgba(255,31,46,0.5);}' +
      '.rrc-send{flex:0 0 auto;background:linear-gradient(180deg, #ff3a47 0%, #e21d2b 46%, #b3121f 100%);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:8px;padding:0 13px;cursor:pointer;font-family:"Oxanium",sans-serif;font-weight:800;font-size:11px;letter-spacing:.05em;}' +
      '.rrc-send:hover{filter:brightness(1.08);}' +
      '.rrc-send:disabled{opacity:.5;cursor:default;filter:none;}' +
      '.rrc-roompanel-wrap{display:flex;flex-direction:column;}' +
      '.rrc-roompanel-wrap[hidden]{display:none;}' +
      // report modal
      '.rrc-modal-scrim{position:fixed;inset:0;z-index:600;background:rgba(6,3,3,0.72);display:flex;align-items:center;justify-content:center;padding:16px;}' +
      '.rrc-modal-scrim[hidden]{display:none;}' +
      '.rrc-modal{width:360px;max-width:100%;background:linear-gradient(180deg, rgba(40,20,22,0.96), rgba(10,7,6,0.98));border:1px solid rgba(218,210,206,0.22);border-radius:16px;padding:18px;box-shadow:0 24px 60px -20px rgba(0,0,0,0.8);}' +
      '.rrc-modal h3{font-family:"Oxanium",sans-serif;font-size:15px;letter-spacing:.04em;color:#f4eef0;margin-bottom:3px;}' +
      '.rrc-modal .rrc-sub{font-size:11.5px;color:#a0938f;margin-bottom:14px;}' +
      '.rrc-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}' +
      '.rrc-chip{background:rgba(218,210,206,0.08);border:1px solid rgba(218,210,206,0.22);color:#dad7d2;border-radius:999px;padding:7px 13px;font-family:"Chakra Petch",sans-serif;font-size:12px;cursor:pointer;}' +
      '.rrc-chip.active{background:rgba(255,31,46,0.18);border-color:#ff1f2e;color:#fff;}' +
      '.rrc-modal textarea{width:100%;background:rgba(10,7,6,0.55);border:1px solid rgba(218,210,206,0.2);border-radius:8px;color:#f4eef0;font-family:"Chakra Petch",sans-serif;font-size:12.5px;padding:9px 10px;resize:none;height:56px;margin-bottom:14px;}' +
      '.rrc-modal textarea:focus{outline:none;border-color:rgba(255,31,46,0.5);}' +
      '.rrc-modal-btns{display:flex;gap:10px;justify-content:flex-end;}' +
      '.rrc-btn{font-family:"Oxanium",sans-serif;font-weight:700;font-size:12px;letter-spacing:.04em;border-radius:8px;padding:9px 16px;cursor:pointer;}' +
      '.rrc-btn.ghost{background:none;border:1px solid rgba(218,210,206,0.24);color:#dad7d2;}' +
      '.rrc-btn.ghost:hover{border-color:rgba(218,210,206,0.5);}' +
      '.rrc-btn.primary{background:linear-gradient(180deg, #ff3a47 0%, #e21d2b 46%, #b3121f 100%);border:1px solid rgba(255,255,255,0.2);color:#fff;}' +
      '.rrc-btn.primary:disabled{opacity:.5;cursor:default;}' +
      // kebab menu (host mute/kick)
      '.rrc-kebab-wrap{position:relative;display:inline-block;}' +
      '.rrc-kebab{background:none;border:none;color:#a0938f;cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;}' +
      '.rrc-kebab:hover{color:#f4eef0;}' +
      '.rrc-kmenu{position:absolute;right:0;top:100%;margin-top:4px;background:rgba(10,7,6,0.97);border:1px solid rgba(218,210,206,0.22);border-radius:10px;min-width:132px;box-shadow:0 14px 30px -10px rgba(0,0,0,0.7);z-index:60;overflow:hidden;}' +
      '.rrc-kmenu[hidden]{display:none;}' +
      '.rrc-kmenu button{display:block;width:100%;text-align:left;background:none;border:none;color:#dad7d2;font-family:"Chakra Petch",sans-serif;font-size:12px;padding:9px 12px;cursor:pointer;}' +
      '.rrc-kmenu button:hover{background:rgba(255,31,46,0.14);color:#fff;}' +
      '.rrc-kmenu button.danger{color:#ff8a7a;}';
    var st = document.createElement('style'); st.setAttribute('data-rrc', '1'); st.textContent = css;
    document.head.appendChild(st);
  }

  // =========================================================================
  // LOBBY CHAT — bottom-right collapsible drawer (mirrors .mpx-friends-panel's
  // collapse mechanic: hidden attr + a toggle pill; NOT literally docked in the
  // same DOM spot — that panel lives inline in the lobby flow, this is a fixed
  // overlay so it survives across lobby/room/setup steps without re-mounting).
  // =========================================================================
  var lobby = { ch: null, buf: [], unread: 0, open: false, bucket: null, els: null, meId: null, meName: null };

  function ensureLobbyDom() {
    if (lobby.els) return lobby.els;
    injectCss();
    var wrap = document.createElement('div');
    wrap.className = 'rrc-drawer'; wrap.id = 'rrc-lobby-drawer'; wrap.hidden = true;
    wrap.innerHTML =
      '<div class="rrc-panel" id="rrc-lobby-panel" hidden>' +
        '<div class="rrc-head"><span class="rrc-head-t">Lobby chat</span><button class="rrc-close" id="rrc-lobby-close" type="button" aria-label="Collapse chat">–</button></div>' +
        '<div class="rrc-list" id="rrc-lobby-list" role="log" aria-live="polite"></div>' +
        '<div class="rrc-inputrow"><input class="rrc-input" id="rrc-lobby-input" type="text" maxlength="140" aria-label="Chat message" placeholder="Say something…" autocomplete="off" />' +
          '<button class="rrc-send" id="rrc-lobby-send" type="button">SEND</button></div>' +
      '</div>' +
      '<button class="rrc-toggle" id="rrc-lobby-toggle" type="button" aria-expanded="false" aria-controls="rrc-lobby-panel">CHAT ▲<span class="rrc-badge" id="rrc-lobby-badge">0</span></button>';
    document.body.appendChild(wrap);
    var els = {
      wrap: wrap, panel: wrap.querySelector('#rrc-lobby-panel'), list: wrap.querySelector('#rrc-lobby-list'),
      input: wrap.querySelector('#rrc-lobby-input'), send: wrap.querySelector('#rrc-lobby-send'),
      toggle: wrap.querySelector('#rrc-lobby-toggle'), badge: wrap.querySelector('#rrc-lobby-badge'),
      close: wrap.querySelector('#rrc-lobby-close')
    };
    function setOpen(v) {
      lobby.open = v; els.panel.hidden = !v; els.toggle.setAttribute('aria-expanded', v ? 'true' : 'false');
      els.toggle.hidden = v;   // pill hides while the panel is open (close button on the panel returns to it)
      if (v) { lobby.unread = 0; paintBadge(); renderLobbyList(); try { els.input.focus(); } catch (e) {} }
    }
    function paintBadge() { els.badge.textContent = String(lobby.unread); els.badge.classList.toggle('on', lobby.unread > 0 && !lobby.open); }
    els.toggle.addEventListener('click', function () { setOpen(true); });
    els.close.addEventListener('click', function () { setOpen(false); });
    function doSend() {
      var v = els.input.value; if (!v || !v.trim()) return;
      sendLobbyMsg(v);
      els.input.value = '';
    }
    els.send.addEventListener('click', doSend);
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
    els._setOpen = setOpen; els._paintBadge = paintBadge;
    lobby.els = els;
    return els;
  }

  function renderLobbyList() {
    var els = lobby.els; if (!els) return;
    var opts = { hostId: lobby.hostIdFn ? lobby.hostIdFn() : null, meId: lobby.meId, onReport: !!lobby.onReport, isMuted: lobby.isMutedFn };
    els.list.innerHTML = lobby.buf.map(function (m) { return rowHtml(m, opts); }).join('');
    els.list.scrollTop = els.list.scrollHeight;
    // wire any flag buttons just rendered
    [].forEach.call(els.list.querySelectorAll('[data-flag]'), function (b) {
      b.addEventListener('click', function () { try { openReportModal({ targetId: b.getAttribute('data-flag'), targetName: b.getAttribute('data-flagname'), roomId: null, matchId: null }); } catch (e) {} });
    });
  }

  function pushLobbyRow(m) {
    lobby.buf.push(m);
    if (lobby.buf.length > 50) lobby.buf.shift();
    if (lobby.els) {
      if (lobby.open) renderLobbyList();
      else { lobby.unread++; lobby.els._paintBadge(); }
    }
  }

  function sendLobbyMsg(text) {
    if (!lobby.ch) return;
    if (!lobby.bucket()) { localToast('Slow down — chat is rate-limited'); return; }
    var clean = filterChatText(String(text).trim().slice(0, 140));
    if (!clean) return;
    var payload = { id: lobby.meId, name: lobby.meName, text: clean, at: Date.now() };
    try { lobby.ch.send({ type: 'broadcast', event: 'chat-msg', payload: payload }); } catch (e) { return; }
    pushLobbyRow(payload);   // optimistic local echo (broadcast self:false — sender doesn't get its own message back)
  }

  // mountLobbyChat(ch, me, opts) — me:{id,name}; opts:{hostIdFn, onReport, isMutedFn}
  function mountLobbyChat(ch, me, opts) {
    opts = opts || {};
    var els = ensureLobbyDom();
    lobby.ch = ch; lobby.meId = me && me.id; lobby.meName = me && me.name;
    lobby.hostIdFn = opts.hostIdFn || null; lobby.onReport = opts.onReport !== false; lobby.isMutedFn = opts.isMutedFn || function () { return false; };
    lobby.bucket = makeBucket();
    els.wrap.hidden = false;
    try {
      ch.on('broadcast', { event: 'chat-msg' }, function (m) {
        var p = m && m.payload; if (!p || !p.id || !p.text) return;
        pushLobbyRow({ id: p.id, name: p.name, text: filterChatText(String(p.text).slice(0, 140)), at: p.at || Date.now() });
      });
    } catch (e) {}
  }

  function lobbySystemLine(text) { pushLobbyRow({ sys: true, text: text, at: Date.now() }); }

  function teardownLobbyChat() {
    lobby.ch = null; lobby.buf = []; lobby.unread = 0;
    if (lobby.els) { lobby.els.wrap.hidden = true; lobby.els._setOpen(false); lobby.els.list.innerHTML = ''; }
  }

  // =========================================================================
  // ROOM CHAT — fixed ~240px panel, mounted INTO a host element (the caller
  // passes the DOM node to render into — multiplayer.js hands it #mpx-roomctx's
  // parent). Visible pre-match only; hidden the instant room-start fires.
  // =========================================================================
  var room = { ch: null, buf: [], bucket: null, els: null, meId: null, meName: null, hostId: null, mountEl: null };

  function ensureRoomDom(mountEl) {
    if (room.els && room.mountEl === mountEl) return room.els;
    injectCss();
    var wrap = document.createElement('div');
    wrap.className = 'rrc-roompanel-wrap'; wrap.id = 'rrc-room-wrap';
    wrap.innerHTML =
      '<div class="rrc-panel room" id="rrc-room-panel">' +
        '<div class="rrc-head"><span class="rrc-head-t">Room chat</span></div>' +
        '<div class="rrc-list" id="rrc-room-list" role="log" aria-live="polite"></div>' +
        '<div class="rrc-inputrow"><input class="rrc-input" id="rrc-room-input" type="text" maxlength="140" aria-label="Chat message" placeholder="Message the room…" autocomplete="off" />' +
          '<button class="rrc-send" id="rrc-room-send" type="button">SEND</button></div>' +
      '</div>';
    if (mountEl) { if (mountEl._rrcAnchor && mountEl._rrcAnchor.nextSibling) mountEl.insertBefore(wrap, mountEl._rrcAnchor.nextSibling); else mountEl.appendChild(wrap); } else document.body.appendChild(wrap);
    var els = {
      wrap: wrap, list: wrap.querySelector('#rrc-room-list'), input: wrap.querySelector('#rrc-room-input'),
      send: wrap.querySelector('#rrc-room-send')
    };
    function doSend() { var v = els.input.value; if (!v || !v.trim()) return; sendRoomMsg(v); els.input.value = ''; }
    els.send.addEventListener('click', doSend);
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
    room.els = els; room.mountEl = mountEl;
    return els;
  }

  function renderRoomList() {
    var els = room.els; if (!els) return;
    var opts = { hostId: room.hostId, meId: room.meId, onReport: !!room.onReport, isMuted: room.isMutedFn };
    els.list.innerHTML = room.buf.map(function (m) { return rowHtml(m, opts); }).join('');
    els.list.scrollTop = els.list.scrollHeight;
    [].forEach.call(els.list.querySelectorAll('[data-flag]'), function (b) {
      b.addEventListener('click', function () { try { openReportModal({ targetId: b.getAttribute('data-flag'), targetName: b.getAttribute('data-flagname'), roomId: room.roomId, matchId: null }); } catch (e) {} });
    });
  }

  function pushRoomRow(m) {
    room.buf.push(m);
    if (room.buf.length > 50) room.buf.shift();
    renderRoomList();
  }

  function sendRoomMsg(text) {
    if (!room.ch) return;
    if (!room.bucket()) { localToast('Slow down — chat is rate-limited'); return; }
    var clean = filterChatText(String(text).trim().slice(0, 140));
    if (!clean) return;
    var payload = { id: room.meId, name: room.meName, text: clean, at: Date.now() };
    try { room.ch.send({ type: 'broadcast', event: 'chat-msg', payload: payload }); } catch (e) { return; }
    pushRoomRow(payload);
  }

  // mountRoomChat(ch, me, mountEl, opts) — opts:{hostId, roomId, onReport, isMutedFn}
  function mountRoomChat(ch, me, mountEl, opts) {
    opts = opts || {};
    teardownRoomChat();   // a fresh room mount always starts from a clean ring buffer (never leaks a prior room's chat)
    var els = ensureRoomDom(mountEl);
    room.ch = ch; room.meId = me && me.id; room.meName = me && me.name;
    room.hostId = opts.hostId || null; room.roomId = opts.roomId || null;
    room.onReport = opts.onReport !== false; room.isMutedFn = opts.isMutedFn || function () { return false; };
    room.bucket = makeBucket();
    els.wrap.hidden = false;
    renderRoomList();
    try {
      ch.on('broadcast', { event: 'chat-msg' }, function (m) {
        var p = m && m.payload; if (!p || !p.id || !p.text) return;
        pushRoomRow({ id: p.id, name: p.name, text: filterChatText(String(p.text).slice(0, 140)), at: p.at || Date.now() });
      });
    } catch (e) {}
  }

  function roomSystemLine(text) { if (room.els) pushRoomRow({ sys: true, text: text, at: Date.now() }); }

  // hides (does not destroy) the room panel — called the instant room-start fires (match/live view has no chat)
  function hideRoomChat() { if (room.els) room.els.wrap.hidden = true; }

  // full teardown — called from closeRoom()/leaveRoomChannel() so a rejoin (same OR different room) never leaks
  // a prior room's ring buffer into the new one.
  function teardownRoomChat() {
    room.ch = null; room.buf = []; room.hostId = null; room.roomId = null;
    if (room.els) { room.els.wrap.hidden = true; room.els.list.innerHTML = ''; room.els.wrap.remove(); room.els = null; room.mountEl = null; }
  }

  window.RhythmChat = {
    filterChatText: filterChatText,
    filterDisplayName: filterDisplayName,
    BADWORDS: BADWORDS,   // read-only convenience export (array reference — don't mutate)
    mountLobbyChat: mountLobbyChat,
    teardownLobbyChat: teardownLobbyChat,
    lobbySystemLine: lobbySystemLine,
    mountRoomChat: mountRoomChat,
    teardownRoomChat: teardownRoomChat,
    hideRoomChat: hideRoomChat,
    roomSystemLine: roomSystemLine
  };
})();
