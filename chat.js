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
  // in the source text survives untouched outside the masked span. Strips
  // spacing/punctuation WITHIN a token (so "n1gg3r", "n-i-g-g-e-r" still
  // normalize to a hit) — callers that need cross-word safety must chunk the
  // input into words FIRST (see filterChatText's fallback below), because
  // collapsing spaces across an entire multi-word string is exactly the
  // "Scunthorpe problem": "was hitting" -> "washitting" contains "shit".
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
    // build111 review: \b word boundaries on pass 1. Without them the substring match masked ordinary words
    // that merely CONTAIN a listed fragment — "cockatoo"→"***atoo", "grapefruit"→"g***fruit", "shitake"→"***ake",
    // "scunthorpe"→"s***horpe". \b makes pass 1 only mask a badword as a standalone word ("you shit!" still masks;
    // "class action" / "cockatoo" no longer do). Leet/spaced variants remain the job of pass 2/3 on normalized text.
    _rx = new RegExp('(\\b(?:' + esc.join('|') + ')\\b)', 'gi');
    return _rx;
  }

  // mask-not-reject: replace each matched run of letters with a fixed '***'
  // (not length-matched — avoids leaking word length as a side channel for
  // anything egregious, matches common chat-filter convention).
  // Pass 1: a plain substring regex over the RAW text (catches exact-cased
  // hits, preserves surrounding punctuation/case exactly).
  // Pass 2 (fallback, only runs if pass 1 found nothing): a PER-WORD leet-
  // normalized re-scan, so "n1gg3r" / "n-i-g-g-e-r" still get caught — but
  // normalization + substring-matching happens WITHIN each whitespace-
  // separated token, never across the whole message. Matching across the
  // whole space-stripped string is the classic "Scunthorpe problem": "was
  // hitting notes" -> "washittingnotes" contains "shit" as a false positive
  // spanning a word boundary. Chunking by word first avoids that while still
  // catching the leet/hyphen/dot tricks within a single word.
  function filterChatText(s) {
    var raw = String(s == null ? '' : s);
    if (!raw) return raw;
    var out = raw.replace(matcher(), '***');
    if (out === raw) {
      var tokens = raw.split(/(\s+)/);   // keep whitespace runs as their own tokens so the mask can drop back in-place
      var hit = false;
      var masked = tokens.map(function (tok) {
        if (!tok || /^\s+$/.test(tok)) return tok;
        var norm = normalize(tok);
        if (!norm) return tok;
        // build111 review: pass 2 is the LEET catcher only. Substring-scan a token ONLY when normalization
        // actually FOLDED leet (digits/@/$ → letters). A plain word whose normalization is just its lowercase
        // (no leet) must be left to pass 1's \b matcher — otherwise ordinary words containing a listed fragment
        // ("cockatoo"⊃"cock", "shitake"⊃"shit", "grapefruit"⊃"rape", "scunthorpe"⊃"cunt") get falsely masked.
        var light = String(tok).toLowerCase().replace(/[\s_\-.]/g, '');
        if (norm === light) return tok;   // no leet folding → plain text, already covered by pass 1's \b
        for (var i = 0; i < BADWORDS.length; i++) {
          if (norm.indexOf(BADWORDS[i]) >= 0) { hit = true; return '***'; }
        }
        return tok;
      });
      if (hit) return masked.join('');
    }
    // build111 review — pass 3: spaced-letter evasion ("s h i t you"). Pass 1's substring can't see it (spaces
    // break the literal) and pass 2's per-token loop sees only single letters. Collapse a RUN of >=3 single
    // alnum chars glued by separators, leet-normalize the run, and mask it only if the collapsed run itself
    // CONTAINS a badword — so "a b c d" / "R U ok" (collapse to non-words) stay untouched (no cross-word
    // Scunthorpe risk: this only ever joins single-char tokens, never real multi-letter words).
    if (out === raw) {
      out = raw.replace(/[A-Za-z0-9](?:[^A-Za-z0-9]+[A-Za-z0-9]){2,}/g, function (run) {
        var collapsed = normalize(run);
        for (var i = 0; i < BADWORDS.length; i++) { if (collapsed.indexOf(BADWORDS[i]) >= 0) return '***'; }
        return run;
      });
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
      '.rrc-drawer{position:fixed;left:16px;bottom:16px;z-index:520;display:flex;flex-direction:column;align-items:flex-start;font-family:"Chakra Petch",sans-serif;}' +   /* build111 review: bottom-LEFT (was bottom-right) — the bottom-right corner holds the battle-call ring (accept/decline) + friends panel; a z-520 chat pill there overlapped the ACCEPT button and floated over the note highway. Left corner is clear + conventional for chat. */
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
    lobby.hostIdFn = opts.hostIdFn || null; lobby.onReport = opts.onReport !== false; lobby.isMutedFn = opts.isMutedFn || isMuted;
    lobby.bucket = makeBucket();
    els.wrap.hidden = false;
    try {
      ch.on('broadcast', { event: 'chat-msg' }, function (m) {
        var p = m && m.payload; if (!p || !p.id || !p.text) return;
        pushLobbyRow({ id: p.id, name: filterDisplayName(p.name), text: filterChatText(String(p.text).slice(0, 140)), at: p.at || Date.now() });   // build111 review: a modified client can broadcast a slur as its display NAME — filter it, not just escape it
      });
    } catch (e) {}
  }

  function lobbySystemLine(text) { pushLobbyRow({ sys: true, text: text, at: Date.now() }); }

  function teardownLobbyChat() {
    lobby.ch = null; lobby.buf = []; lobby.unread = 0;
    if (lobby.els) { lobby.els.wrap.hidden = true; lobby.els._setOpen(false); lobby.els.list.innerHTML = ''; }
  }
  // build111 review: temporarily hide the fixed lobby drawer while a match is live (it's z-520, fixed
  // bottom-right — otherwise the "CHAT ▲" pill floats over the note highway all song, and it also overlaps
  // the battle-call ring's ACCEPT button). Distinct from teardown: keeps the channel + ring buffer intact so
  // returning to the lobby restores the conversation. Collapses the panel so it can't reopen while hidden.
  function hideLobbyChat() { if (lobby.els) { lobby.els._setOpen(false); lobby.els.wrap.hidden = true; } }
  function showLobbyChat() { if (lobby.els && lobby.ch) lobby.els.wrap.hidden = false; }

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
    room.onReport = opts.onReport !== false; room.isMutedFn = opts.isMutedFn || isMuted;
    room.bucket = makeBucket();
    els.wrap.hidden = false;
    renderRoomList();
    try {
      ch.on('broadcast', { event: 'chat-msg' }, function (m) {
        var p = m && m.payload; if (!p || !p.id || !p.text) return;
        pushRoomRow({ id: p.id, name: filterDisplayName(p.name), text: filterChatText(String(p.text).slice(0, 140)), at: p.at || Date.now() });   // build111 review: filter the broadcast display NAME, not just escape it
      });
    } catch (e) {}
  }

  function roomSystemLine(text) { if (room.els) pushRoomRow({ sys: true, text: text, at: Date.now() }); }

  // hides (does not destroy) the room panel — called the instant room-start fires (match/live view has no chat)
  function hideRoomChat() { if (room.els) room.els.wrap.hidden = true; }
  // build116 p2: the inverse — un-hide a still-mounted panel (buffer + channel intact). Used by the tournament
  // "between rounds" (t-await) transition, mirroring how showLobbyChat restores the lobby drawer after a match.
  function showRoomChat() { if (room.els && room.ch) room.els.wrap.hidden = false; }

  // full teardown — called from closeRoom()/leaveRoomChannel() so a rejoin (same OR different room) never leaks
  // a prior room's ring buffer into the new one.
  function teardownRoomChat() {
    room.ch = null; room.buf = []; room.hostId = null; room.roomId = null;
    if (room.els) { room.els.wrap.hidden = true; room.els.list.innerHTML = ''; room.els.wrap.remove(); room.els = null; room.mountEl = null; }
  }

  // =========================================================================
  // build111 s3: HOST MUTE/KICK — kebab UI + mute-state tracking.
  //   Kick itself is wired entirely in multiplayer.js (it's a leave-path
  //   trigger, not a chat concern) — this module owns the KEBAB BUTTON + MENU
  //   (host-only, painted next to the opponent name) and the MUTE state (which
  //   chat rows to hide). Session-scoped only, matches the codebase's existing
  //   client-trusted-broadcast model: cosmetic, not enforcement.
  // =========================================================================
  var mutedIds = {};   // { [peerId]: { text: bool } } — session-scoped, cleared on full page reload
  var reportCounts = {};   // { [targetId]: n } — session-scoped 3-reports circuit breaker (see recordReportForCircuitBreaker)

  function isMuted(id) { return !!(mutedIds[id] && mutedIds[id].text); }
  function applyModMute(id, kind, on) {
    if (!id || kind !== 'text') return;   // voice was explicitly out of scope for this build — only 'text' kind exists
    mutedIds[id] = mutedIds[id] || {};
    mutedIds[id].text = !!on;
    // re-render both surfaces so the mute takes effect immediately for everyone honoring it (including the muted peer's own client)
    try { renderLobbyList(); } catch (e) {}
    try { renderRoomList(); } catch (e) {}
  }

  var _kebabState = null;   // { anchorEl, opts } — the single live kebab (room is 1v1, so at most one target at a time)
  function closeKebabMenu() { var m = document.getElementById('rrc-kmenu-live'); if (m) m.remove(); }
  document.addEventListener('click', function (e) {
    var live = document.getElementById('rrc-kmenu-live');
    if (live && !live.contains(e.target) && e.target.id !== 'rrc-kebab-btn') closeKebabMenu();
  });

  // paintModKebab(anchorEl, {isHost, oppId, oppName, roomCh, meId, hostId, roomId}) — called from multiplayer.js's
  // paintRoomWaiting() every repaint; mounts/unmounts a report-flag (always, once an opponent is seated) + a
  // host-only kebab (⋮ mute/kick) next to `anchorEl` (the #mpx-dot-opp span). Both live in one small wrap so
  // repaint diffing stays a single insert/remove.
  function paintModKebab(anchorEl, opts) {
    if (!anchorEl || !anchorEl.parentNode) return;
    var existing = anchorEl.parentNode.querySelector('.rrc-kebab-wrap');
    if (!opts.oppId) { if (existing) existing.remove(); closeKebabMenu(); return; }
    injectCss();
    var wrapEl = existing;
    if (!wrapEl) {
      wrapEl = document.createElement('span');
      wrapEl.className = 'rrc-kebab-wrap';
      anchorEl.parentNode.insertBefore(wrapEl, anchorEl.nextSibling);
    }
    // build111 review: paintModKebab runs on EVERY softPresence heartbeat repaint; the innerHTML rebuild below
    // would delete an OPEN kebab dropdown out from under the host's click (they open ⋮, a heartbeat lands, the
    // menu vanishes, "Kick" clicks nothing). If our menu is open, skip this repaint's rebuild — the opp-left
    // teardown (above, when !opts.oppId) still runs, and the open menu already froze its opts at open time.
    var _openMenu = document.getElementById('rrc-kmenu-live');
    if (_openMenu && wrapEl.contains(_openMenu)) { _kebabState = { anchorEl: anchorEl, opts: opts }; return; }
    var wantFlag = opts.oppId !== opts.meId;   // never let a player flag themselves (defensive — oppId is never meId in practice)
    var wantKebab = !!opts.isHost;
    wrapEl.innerHTML =
      (wantFlag ? '<button class="rrc-flag" id="rrc-peer-flag" type="button" aria-label="Report ' + esc(opts.oppName || 'this player') + '">' + FLAG_SVG + '</button>' : '') +
      (wantKebab ? '<button class="rrc-kebab" id="rrc-kebab-btn" type="button" aria-label="Moderation menu" aria-haspopup="true">⋮</button>' : '');
    if (wantFlag) {
      wrapEl.querySelector('#rrc-peer-flag').addEventListener('click', function (e) {
        e.stopPropagation();
        openReportModal({ targetId: opts.oppId, targetName: opts.oppName, roomId: opts.roomId || null, matchId: null });
      });
    }
    if (wantKebab) {
      wrapEl.querySelector('#rrc-kebab-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        var already = document.getElementById('rrc-kmenu-live');
        closeKebabMenu();
        if (already) return;   // toggle off
        openKebabMenu(wrapEl, _kebabState.opts);
      });
    }
    _kebabState = { anchorEl: anchorEl, opts: opts };
  }

  function openKebabMenu(wrapEl, opts) {
    var muted = isMuted(opts.oppId);
    var menu = document.createElement('div');
    menu.className = 'rrc-kmenu'; menu.id = 'rrc-kmenu-live';
    menu.innerHTML =
      '<button type="button" data-act="mute">' + (muted ? 'Unmute chat' : 'Mute chat') + '</button>' +
      '<button type="button" class="danger" data-act="kick">Kick from room</button>';
    wrapEl.appendChild(menu);
    menu.querySelector('[data-act="mute"]').addEventListener('click', function () {
      var nowOn = !isMuted(opts.oppId);
      applyModMute(opts.oppId, 'text', nowOn);
      try { if (opts.roomCh) opts.roomCh.send({ type: 'broadcast', event: 'mod-mute', payload: { id: opts.oppId, kind: 'text', on: nowOn, byHost: opts.hostId } }); } catch (e) {}
      localToast(nowOn ? ((opts.oppName || 'Player') + ' muted') : ((opts.oppName || 'Player') + ' unmuted'));
      closeKebabMenu();
    });
    menu.querySelector('[data-act="kick"]').addEventListener('click', function () {
      try { if (opts.roomCh) opts.roomCh.send({ type: 'broadcast', event: 'mod-kick', payload: { id: opts.oppId, byHost: opts.hostId, at: Date.now() } }); } catch (e) {}
      localToast((opts.oppName || 'Player') + ' removed');
      closeKebabMenu();
    });
  }

  // 3-reports-in-a-session circuit breaker: called from the report-submit flow (build111 s4) for whichever
  // room the report targeted. Session-scoped, client-side, never touches the target's account — cannot be
  // weaponized into a permanent ban via report-brigading; it just auto-hides a pile-on target's chat locally
  // until the host manually unmutes via the kebab.
  function recordReportForCircuitBreaker(targetId) {
    if (!targetId) return;
    reportCounts[targetId] = (reportCounts[targetId] || 0) + 1;
    if (reportCounts[targetId] >= 3 && !isMuted(targetId)) {
      applyModMute(targetId, 'text', true);
      localToast('Auto-muted after multiple reports this session');
    }
  }

  // =========================================================================
  // build111 s4: REPORT MODAL — reason chips + optional filtered note. Reported
  // user is NEVER notified (no broadcast sent at all — this only talks to
  // RhythmCatalog.submitReport, a local queue). Session-scoped "already
  // reported this target" guard prevents re-reporting the same id/session.
  // Evidence = the last ~30 buffered chat lines across BOTH surfaces (lobby +
  // room ring buffers) at submit time — best-effort context for a reviewer,
  // matches the localStorage-buffered-evidence approach from the spec (no
  // durable chat persistence in this build).
  // =========================================================================
  var REASONS = ['Harassment', 'Hate speech', 'Cheating', 'Spam', 'Other'];
  var alreadyReported = {};   // session-scoped: { [targetId]: true }

  function collectEvidence() {
    var all = [].concat(lobby.buf || [], room.buf || [])
      .filter(function (m) { return !m.sys; })
      .sort(function (a, b) { return (a.at || 0) - (b.at || 0); })
      .slice(-30)
      .map(function (m) { return { id: m.id, name: m.name, text: m.text, at: m.at }; });
    return all;
  }

  function closeReportModal() {
    var scrim = document.getElementById('rrc-modal-scrim'); if (scrim) scrim.remove();
  }

  // openReportModal({targetId, targetName, roomId, matchId}) — real implementation, replaces the s2 forward stub.
  openReportModal = function (ctx) {
    ctx = ctx || {};
    if (!ctx.targetId) return;
    if (alreadyReported[ctx.targetId]) { localToast('You already reported this player this session'); return; }
    injectCss();
    closeReportModal();
    var chosenReason = REASONS[0];
    var scrim = document.createElement('div');
    scrim.className = 'rrc-modal-scrim'; scrim.id = 'rrc-modal-scrim';
    scrim.innerHTML =
      '<div class="rrc-modal" role="dialog" aria-modal="true" aria-labelledby="rrc-modal-h">' +
        '<h3 id="rrc-modal-h">Report ' + esc(ctx.targetName || 'player') + '</h3>' +
        '<div class="rrc-sub">They won’t be notified. Pick the closest reason.</div>' +
        '<div class="rrc-chips" id="rrc-modal-chips">' +
          REASONS.map(function (r, i) { return '<button type="button" class="rrc-chip' + (i === 0 ? ' active' : '') + '" data-reason="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') +
        '</div>' +
        '<textarea id="rrc-modal-note" maxlength="140" aria-label="Optional note (140 characters)" placeholder="Optional details (140 chars)…"></textarea>' +
        '<div class="rrc-modal-btns"><button class="rrc-btn ghost" id="rrc-modal-cancel" type="button">CANCEL</button><button class="rrc-btn primary" id="rrc-modal-submit" type="button">SUBMIT REPORT</button></div>' +
      '</div>';
    document.body.appendChild(scrim);
    scrim.addEventListener('click', function (e) { if (e.target === scrim) closeReportModal(); });
    var chipsWrap = scrim.querySelector('#rrc-modal-chips');
    chipsWrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-reason]'); if (!b) return;
      chosenReason = b.getAttribute('data-reason');
      [].forEach.call(chipsWrap.querySelectorAll('.rrc-chip'), function (c) { c.classList.toggle('active', c === b); });
    });
    scrim.querySelector('#rrc-modal-cancel').addEventListener('click', closeReportModal);
    scrim.querySelector('#rrc-modal-submit').addEventListener('click', function () {
      var btn = scrim.querySelector('#rrc-modal-submit'); btn.disabled = true;
      var note = filterChatText(String(scrim.querySelector('#rrc-modal-note').value || '').trim().slice(0, 140));
      var payload = {
        targetId: ctx.targetId, targetName: ctx.targetName || 'Player',
        roomId: ctx.roomId || null, matchId: ctx.matchId || null,
        reason: chosenReason, note: note, evidence: collectEvidence()
      };
      alreadyReported[ctx.targetId] = true;   // session guard set optimistically — fire-and-forget submit below never blocks the UI
      try {
        if (window.RhythmCatalog && window.RhythmCatalog.submitReport) {
          window.RhythmCatalog.submitReport(payload).catch(function () {});
        }
      } catch (e) { /* silent-fail-safe: the report attempt itself must never throw into the caller */ }
      recordReportForCircuitBreaker(ctx.targetId);
      closeReportModal();
      localToast('Report submitted — thanks for flagging this');
    });
    try { scrim.querySelector('#rrc-modal-note').focus(); } catch (e) {}
  };

  window.RhythmChat = {
    filterChatText: filterChatText,
    filterDisplayName: filterDisplayName,
    BADWORDS: BADWORDS,   // read-only convenience export (array reference — don't mutate)
    mountLobbyChat: mountLobbyChat,
    teardownLobbyChat: teardownLobbyChat,
    hideLobbyChat: hideLobbyChat,     // build111 review: temporarily hide the fixed lobby drawer during a live match (keeps buffer)
    showLobbyChat: showLobbyChat,
    lobbySystemLine: lobbySystemLine,
    mountRoomChat: mountRoomChat,
    teardownRoomChat: teardownRoomChat,
    hideRoomChat: hideRoomChat,
    showRoomChat: showRoomChat,
    roomSystemLine: roomSystemLine,
    paintModKebab: paintModKebab,
    applyModMute: applyModMute,
    isMuted: isMuted,
    recordReportForCircuitBreaker: recordReportForCircuitBreaker,
    openReportModal: function (ctx) { return openReportModal(ctx); }   // stable reference — openReportModal itself is reassigned once (s2 stub -> s4 real impl)
  };
})();
