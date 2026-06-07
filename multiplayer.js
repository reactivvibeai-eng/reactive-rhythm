// ===========================================================================
// REACTIVE RHYTHM — Online OPEN-LOBBY Multiplayer via Supabase Realtime
//   • LOBBY: shared presence channel `rr-lobby` lists everyone online; the
//     longest-present player wears the HOST BADGE; challenge anyone.
//   • MATCH: a private `rr-match-<id>` channel (challenger = match host) locks
//     song+difficulty, ready check, synchronized start, live tick + winner.
//   • In-game opponent panel renders the rival side-by-side.
// Self-contained IIFE. Exposes window.RhythmMP. NO edits to catalog.js /
// jukebox.js. Uses ONLY public window.RhythmGame.* + window.RhythmCatalog.*.
//
// INTEGRATION REALITY (verified against the live v84/visual-overhaul files):
//   - The multiplayer screen ALREADY EXISTS as #multiplayer-screen (a full hub
//     child, z-index 240) reached via RhythmHub.toMultiplayer() (a hub tile),
//     NOT via a header icon. Its .mp-card was a placeholder; the hooks doc
//     fills it with the lobby/setup/go/winner steps (all namespaced .mpx-*).
//   - We DETECT activation by observing `.active` on #multiplayer-screen, then
//     joinLobby(). RhythmMP.open() simply delegates to RhythmHub.toMultiplayer().
//   - Esc / #mp-back already route to RhythmHub.show(); during a LIVE match the
//     active screen is #game (engine), so neither fires mid-song. We still guard
//     #mp-back so leaving the WINNER/SETUP step tears the match down cleanly.
//   - The engine's showScreen() is EXCLUSIVE: entering `game` strips .active from
//     #multiplayer-screen (overlay auto-closes, no flash); at song end it strips
//     us again — so showWinner() re-adds .active AFTER results render.
// Degrades gracefully: no supabase / no realtime → a "Sign in to play online"
// banner; the rest of the game is untouched.
// ===========================================================================
(function () {
  var CFG = window.RHYTHM_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var screen = $('multiplayer-screen'); if (!screen) return;

  // ---- supabase client (own instance; mirrors catalog.js line 25 config) ----
  var supa = null;
  try {
    if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_KEY) {
      supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
        auth: { storage: window.localStorage, persistSession: true, autoRefreshToken: true },
      });
    }
  } catch (e) { /* offline / no realtime → MP simply shows the sign-in banner */ }

  // ---- identity ----
  var ME = { id: localId(), name: 'Player', avatar: null, signedIn: false };
  function localId() {
    try {
      var k = localStorage.getItem('rr_mp_id');
      if (!k) { k = 'p_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('rr_mp_id', k); }
      return k;
    } catch (e) { return 'p_' + Math.random().toString(36).slice(2, 10); }
  }
  function resolveMe() {
    try {
      if (window.RhythmCatalog && window.RhythmCatalog.getUser) {
        window.RhythmCatalog.getUser().then(function (u) {
          if (u && u.id) { ME.id = u.id; ME.name = u.name || ME.name; ME.avatar = u.avatar_url || null; ME.signedIn = true; }
          paintYou();
          // if our identity changed while already in the lobby, re-announce it.
          try { if (lobbyCh) lobbyCh.track(myPresence(false)); } catch (e) {}
        }).catch(function () { paintYou(); });
      }
    } catch (e) {}
  }
  resolveMe();
  // re-resolve identity on auth changes (sign-in mid-session flips guest → named).
  try { if (window.RhythmCatalog && window.RhythmCatalog.onAuthChange) window.RhythmCatalog.onAuthChange(resolveMe); } catch (e) {}

  // ---- state ----
  var JOINED_AT = Date.now();
  var lobbyCh = null;              // presence channel rr-lobby
  var lobby = {};                  // id -> {id,name,avatar,at,inMatch}
  var amHost = false;             // lobby host badge (longest present)
  var matchCh = null;             // private match channel
  var matchId = null;
  var matchRole = null;           // 'host' (challenger) | 'guest'
  var oppMeta = null;             // {id,name,avatar}
  var oppPresent = false, oppLeft = false;
  var sel = { trackId: null, title: null, artist: null, art: null, difficulty: 'medium', demo: false };
  var meReady = false, oppReady = false;
  var matchLive = false, finishedLocal = false;
  var myFinal = null, oppFinal = null;
  var lastOppTick = null;
  var oppPanel = null, oppRaf = 0, _lastSend = 0;
  var pendingOut = null;          // {toId,mid} a challenge I sent, awaiting answer
  var incoming = {};              // id -> {mid} (challenges TO me)
  var activeNow = false;          // is #multiplayer-screen currently .active

  function initial(s) { return (s || '?').trim().charAt(0).toUpperCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function newMatchId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function safeUrl(u) { return String(u == null ? '' : u).replace(/["\\]/g, ''); }
  function myPresence(inMatch) { return { id: ME.id, name: ME.name, avatar: ME.avatar, at: JOINED_AT, inMatch: !!inMatch }; }

  // ---- step switching (only one .mpx-step shows at a time) ----
  function step(name) {
    var card = screen.querySelector('.mp-card'); if (card) card.setAttribute('data-mp-step', name);
    ['lobby', 'setup', 'go', 'winner'].forEach(function (s) {
      var el = screen.querySelector('.mpx-step-' + s); if (el) el.hidden = (s !== name);
    });
  }
  function banner(id, txt) { var el = $(id); if (!el) return; if (txt) { el.textContent = txt; el.hidden = false; } else { el.hidden = true; el.textContent = ''; } }

  // ===================== OPEN / CLOSE =====================
  // open() delegates to the hub router (it adds .active to #multiplayer-screen);
  // our MutationObserver then fires onActivated() → joinLobby().
  function open() {
    try { if (window.RhythmHub && window.RhythmHub.toMultiplayer) { window.RhythmHub.toMultiplayer(); return; } } catch (e) {}
    screen.classList.add('active');   // fallback if the hub router is absent
  }
  function onActivated() {
    paintYou();
    if (!matchLive && (!matchCh)) step('lobby');   // don't reset a returning winner overlay
    banner('mpx-lobby-msg', '');
    joinLobby();
  }
  function leaveAll() {
    teardownMatch();
    try { if (lobbyCh) { lobbyCh.untrack(); supa.removeChannel(lobbyCh); } } catch (e) {}
    lobbyCh = null; lobby = {};
    // hand back to the hub so the back-stack stays consistent.
    try {
      if (window.RhythmHub && window.RhythmHub.show) { window.RhythmHub.show(); return; }
    } catch (e) {}
    screen.classList.remove('active');
  }

  function paintYou() {
    var av = $('mpx-you-av');
    if (av) {
      if (ME.avatar) { av.style.backgroundImage = 'url("' + safeUrl(ME.avatar) + '")'; av.textContent = ''; }
      else { av.style.backgroundImage = ''; av.textContent = initial(ME.name); }
    }
    var nm = $('mpx-you-name'); if (nm) nm.textContent = ME.name + (ME.signedIn ? '' : ' (guest)');
  }

  // ===================== LOBBY (presence) =====================
  function joinLobby() {
    if (!supa) { banner('mpx-lobby-msg', 'Sign in to play online — multiplayer needs a connection.'); roEmpty(true, 'Online play is unavailable right now (no connection).'); return; }
    if (lobbyCh) { renderRoster(); return; }     // already in
    lobbyCh = supa.channel('rr-lobby', { config: { presence: { key: ME.id }, broadcast: { self: false } } });
    lobbyCh.on('presence', { event: 'sync' }, onLobbySync);
    lobbyCh.on('presence', { event: 'leave' }, onLobbySync);
    // challenge handshake rides the lobby channel (targeted by toId)
    lobbyCh.on('broadcast', { event: 'challenge' }, function (m) { onChallenge(m.payload); });
    lobbyCh.on('broadcast', { event: 'challenge-ans' }, function (m) { onChallengeAns(m.payload); });
    lobbyCh.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        lobbyCh.track(myPresence(false));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        banner('mpx-lobby-msg', 'Could not reach the live lobby. Check your connection and reopen.');
      }
    });
  }
  function setLobbyInMatch(flag) { try { if (lobbyCh) lobbyCh.track(myPresence(flag)); } catch (e) {} }

  function onLobbySync() {
    if (!lobbyCh) return;
    var st = lobbyCh.presenceState();
    lobby = {};
    Object.keys(st).forEach(function (k) { var p = st[k] && st[k][0]; if (p && p.id) lobby[p.id] = p; });
    // host election: smallest `at`, tie-broken by id (deterministic across clients)
    var ids = Object.keys(lobby);
    var hostId = null, hostAt = Infinity;
    ids.forEach(function (id) {
      var p = lobby[id], at = p.at || Infinity;
      if (at < hostAt || (at === hostAt && (!hostId || id < hostId))) { hostAt = at; hostId = id; }
    });
    amHost = (hostId === ME.id);
    var hb = $('mpx-you-host'); if (hb) hb.hidden = !amHost;
    renderRoster(hostId);
  }

  function roEmpty(show, txt) {
    var e = $('mpx-roster-empty'); if (!e) return;
    e.hidden = !show; if (txt) e.textContent = txt;
  }

  function renderRoster(hostId) {
    var host = $('mpx-roster'); if (!host) return;
    var ids = Object.keys(lobby).filter(function (id) { return id !== ME.id; });
    var cnt = $('mpx-roster-count'); if (cnt) cnt.textContent = (Object.keys(lobby).length) + ' online';
    roEmpty(ids.length === 0, 'No one else is online right now. Keep this open — challengers appear here live.');
    host.innerHTML = ids.map(function (id) {
      var p = lobby[id];
      var isHost = (id === hostId);
      var av = p.avatar
        ? '<span class="mpx-r-av" style="background-image:url(&quot;' + esc(safeUrl(p.avatar)) + '&quot;)"></span>'
        : '<span class="mpx-r-av">' + esc(initial(p.name)) + '</span>';
      var badge = isHost ? ' <span class="mpx-badge host">HOST</span>' : '';
      var inMatch = !!p.inMatch;
      var actions;
      if (incoming[id]) {
        actions = '<button class="mpx-acc" data-acc="' + esc(id) + '">ACCEPT</button><button class="mpx-dec" data-dec="' + esc(id) + '" aria-label="Decline">✕</button>';
      } else if (pendingOut && pendingOut.toId === id) {
        actions = '<button class="mpx-challenge" disabled>WAITING…</button>';
      } else {
        actions = '<button class="mpx-challenge" data-ch="' + esc(id) + '"' + (inMatch ? ' disabled' : '') + '>' + (inMatch ? 'IN MATCH' : 'CHALLENGE') + '</button>';
      }
      return '<div class="mpx-row' + (incoming[id] ? ' incoming' : '') + '">' + av +
        '<span class="mpx-r-meta"><span class="mpx-r-name">' + esc(p.name || 'Player') + badge + '</span>' +
        '<span class="mpx-r-sub">' + (incoming[id] ? 'wants to duel you' : (inMatch ? 'in a match' : 'online')) + '</span></span>' +
        actions + '</div>';
    }).join('');
    // wire row buttons
    [].forEach.call(host.querySelectorAll('[data-ch]'), function (b) { b.addEventListener('click', function () { sendChallenge(b.getAttribute('data-ch')); }); });
    [].forEach.call(host.querySelectorAll('[data-acc]'), function (b) { b.addEventListener('click', function () { acceptChallenge(b.getAttribute('data-acc')); }); });
    [].forEach.call(host.querySelectorAll('[data-dec]'), function (b) { b.addEventListener('click', function () { declineChallenge(b.getAttribute('data-dec')); }); });
  }

  // ===================== CHALLENGE HANDSHAKE =====================
  function sendChallenge(toId) {
    if (!lobbyCh || !toId || (lobby[toId] && lobby[toId].inMatch)) return;
    pendingOut = { toId: toId, mid: newMatchId() };
    lobbyCh.send({ type: 'broadcast', event: 'challenge', payload: { fromId: ME.id, fromName: ME.name, toId: toId, mid: pendingOut.mid } });
    banner('mpx-lobby-msg', 'Challenge sent — waiting for a reply…');
    onLobbySync();
  }
  function onChallenge(p) {
    if (!p || p.toId !== ME.id) return;          // not for me
    incoming[p.fromId] = { mid: p.mid };
    onLobbySync();
  }
  function acceptChallenge(fromId) {
    var inc = incoming[fromId]; if (!inc) return;
    lobbyCh.send({ type: 'broadcast', event: 'challenge-ans', payload: { fromId: ME.id, toId: fromId, mid: inc.mid, ok: true } });
    incoming = {};
    startMatchChannel(inc.mid, 'guest', lobby[fromId]);   // accepter = guest; challenger = host
  }
  function declineChallenge(fromId) {
    var inc = incoming[fromId]; if (!inc) return;
    lobbyCh.send({ type: 'broadcast', event: 'challenge-ans', payload: { fromId: ME.id, toId: fromId, mid: inc.mid, ok: false } });
    delete incoming[fromId]; onLobbySync();
  }
  function onChallengeAns(p) {
    if (!p || p.toId !== ME.id || !pendingOut || p.mid !== pendingOut.mid) return;
    if (p.ok) {
      var opp = lobby[p.fromId];
      var mid = pendingOut.mid; pendingOut = null;
      startMatchChannel(mid, 'host', opp);       // I challenged → I am host
    } else {
      banner('mpx-lobby-msg', 'Challenge declined.');
      pendingOut = null; onLobbySync();
    }
  }

  // ===================== MATCH CHANNEL =====================
  function startMatchChannel(mid, role, opp) {
    if (!supa) return;
    teardownMatch();   // safety
    matchId = mid; matchRole = role; oppMeta = opp || null;
    oppPresent = false; oppLeft = false; meReady = false; oppReady = false;
    sel = { trackId: null, title: null, artist: null, art: null, difficulty: sel.difficulty || 'medium', demo: false };
    setLobbyInMatch(true);
    matchCh = supa.channel('rr-match-' + mid, { config: { presence: { key: ME.id }, broadcast: { self: false } } });
    matchCh.on('presence', { event: 'sync' }, onMatchSync);
    matchCh.on('presence', { event: 'leave' }, onMatchLeave);
    matchCh.on('broadcast', { event: 'song' }, function (m) { onSong(m.payload); });
    matchCh.on('broadcast', { event: 'ready' }, function (m) { onReady(m.payload); });
    matchCh.on('broadcast', { event: 'start' }, function (m) { onStart(m.payload); });
    matchCh.on('broadcast', { event: 'tick' }, function (m) { onTick(m.payload); });
    matchCh.on('broadcast', { event: 'final' }, function (m) { onFinal(m.payload); });
    matchCh.on('broadcast', { event: 'rematch' }, function () { resetForRematch(); });
    matchCh.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        matchCh.track({ id: ME.id, name: ME.name, role: role, at: Date.now() });
        enterSetup();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        banner('mpx-setup-msg', 'Could not open the match channel. Back out and retry.');
      }
    });
  }
  function enterSetup() {
    step('setup');
    var dot = $('mpx-dot-opp'); if (dot) { dot.setAttribute('data-state', 'waiting'); dot.textContent = oppMeta ? (oppMeta.name || 'OPPONENT').slice(0, 12) : 'WAITING…'; }
    var isHost = matchRole === 'host';
    var pick = $('mpx-pick'); if (pick) pick.disabled = !isHost;
    var chev = $('mpx-pick-chev'); if (chev) chev.style.visibility = isHost ? '' : 'hidden';
    var diff = $('mpx-diff'); if (diff) [].forEach.call(diff.children, function (b) { b.disabled = !isHost; });
    var rs = $('mpx-readystate'); if (rs) rs.textContent = isHost ? 'Pick a track, then hit READY.' : 'Waiting for host to pick a track…';
    banner('mpx-setup-msg', '');
    paintSelection(); refreshReadyEnabled();
  }
  function onMatchSync() {
    if (!matchCh) return;
    var st = matchCh.presenceState();
    var others = Object.keys(st).filter(function (k) { return k !== ME.id; });
    oppPresent = others.length > 0;
    var opp = oppPresent ? st[others[0]][0] : null;
    var dot = $('mpx-dot-opp');
    if (dot) {
      if (oppPresent) { dot.setAttribute('data-state', 'here'); dot.textContent = (opp && opp.name ? opp.name : (oppMeta && oppMeta.name) || 'OPPONENT').slice(0, 12); oppLeft = false; }
      else { dot.setAttribute('data-state', 'waiting'); dot.textContent = 'WAITING…'; }
    }
    if (matchRole === 'host' && oppPresent && sel.trackId) broadcastSong();   // late-join catch-up
    refreshReadyEnabled();
  }
  function onMatchLeave() {
    var st = matchCh ? matchCh.presenceState() : {};
    var others = Object.keys(st).filter(function (k) { return k !== ME.id; });
    if (others.length === 0) {
      oppPresent = false; oppLeft = true;
      var dot = $('mpx-dot-opp'); if (dot) { dot.setAttribute('data-state', 'left'); dot.textContent = 'OPPONENT LEFT'; }
      if (matchLive) { markOppGone(); settleIfReady(); }
      else { oppReady = false; refreshReadyEnabled(); banner('mpx-setup-msg', 'Opponent left. Back to lobby to find another.'); }
    }
  }

  // ---- song selection (host) ----
  function broadcastSong() { if (matchCh) matchCh.send({ type: 'broadcast', event: 'song', payload: sel }); }
  function onSong(p) {
    if (!p) return;
    sel = p; paintSelection();
    meReady = false; oppReady = false; setReadyBtn(); refreshReadyEnabled();
    var rs = $('mpx-readystate'); if (rs) rs.textContent = matchRole === 'host' ? 'Track locked. Hit READY.' : 'Host locked a track. Hit READY when set.';
  }
  function paintSelection() {
    var t = $('mpx-pick-t'); if (t) t.textContent = sel.title || 'Host picks a track';
    var a = $('mpx-pick-a'); if (a) a.textContent = sel.artist || '—';
    var art = $('mpx-pick-art');
    if (art) {
      if (sel.art) { art.style.backgroundImage = 'url("' + safeUrl(sel.art) + '")'; art.textContent = ''; }
      else { art.style.backgroundImage = ''; art.textContent = '♪'; }
    }
    var diff = $('mpx-diff'); if (diff) [].forEach.call(diff.children, function (b) { b.classList.toggle('active', b.getAttribute('data-diff') === sel.difficulty); });
  }

  // ---- ready check ----
  function refreshReadyEnabled() {
    var ok = oppPresent && !!sel.trackId;
    var rb = $('mpx-ready'); if (rb) rb.disabled = !ok;
    var rs = $('mpx-readystate'); if (!rs) return;
    if (!sel.trackId) rs.textContent = matchRole === 'host' ? 'Pick a track to enable READY.' : 'Waiting for host to pick a track…';
    else if (!oppPresent) rs.textContent = 'Waiting for your opponent…';
  }
  function setReadyBtn() { var b = $('mpx-ready'); if (!b) return; b.classList.toggle('armed', meReady); b.textContent = meReady ? 'READY ✓' : 'READY'; }
  function toggleReady() {
    var b = $('mpx-ready'); if (!b || b.disabled) return;
    meReady = !meReady; setReadyBtn();
    matchCh.send({ type: 'broadcast', event: 'ready', payload: { ready: meReady, id: ME.id } });
    maybeStart();
  }
  function onReady(p) { oppReady = !!(p && p.ready); maybeStart(); }
  function maybeStart() {
    if (meReady && oppReady && sel.trackId && matchRole === 'host') {
      var atMs = Date.now() + 1300;          // lead-in so both schedule together
      matchCh.send({ type: 'broadcast', event: 'start', payload: { atMs: atMs, sel: sel } });
      beginMatch(atMs, sel);
    }
  }
  function onStart(p) { if (p && p.atMs) beginMatch(p.atMs, p.sel || sel); }

  // ===================== SYNCHRONIZED MATCH =====================
  function beginMatch(atMs, s) {
    sel = s || sel;
    matchLive = true; finishedLocal = false; myFinal = null; oppFinal = null; oppLeft = false; lastOppTick = null;
    step('go'); var gn = $('mpx-go-num'); if (gn) gn.textContent = 'GET READY';
    // register one-shot song-end handler BEFORE launch
    window.RhythmGame.onSongEnd(onLocalSongEnd);
    // resolve provider + start synced. The engine surface stays minimal: resolve the
    // track and reuse the SAME launch paths the rest of the app uses (byte-identical play).
    resolveAndStart(sel, atMs);
    // mount panel + tick right as the engine takes over (showScreen('game') auto-closes overlay)
    var delay = Math.max(0, atMs - Date.now());
    setTimeout(function () { mountOppPanel(); startTick(); }, delay + 80);
  }

  // Resolve a chart provider for `sel` and schedule the synced start via the public
  // RhythmGame.startAt(provider,{...}). Branch logic mirrors RhythmCatalog.launchTrack:
  //   server chart → liveProvider(id); else audio_url → __buffered/playUrl; else demo.
  function resolveAndStart(s, atMs) {
    var RC = window.RhythmCatalog;
    var t = (RC && RC.allTracks) ? RC.allTracks().filter(function (x) { return x.id === s.trackId; })[0] : null;
    var prov = null;
    try {
      if (s.demo || !t) {
        prov = window.RhythmGame.__demoProvider ? window.RhythmGame.__demoProvider() : null;
      } else if (RC && RC.liveProvider && RC.trackReady && RC.trackReady(t) && hasServerChart(t)) {
        prov = RC.liveProvider(t.id);
      } else {
        var url = t.audio_url || t.wav_url || (t.audio && t.audio.url);
        // tight-sync path: if the engine exposes __buffered, build a deferred provider so
        // startAt() can schedule it precisely. (Added by the hooks doc to the Object.assign.)
        if (url && window.RhythmGame.__buffered) {
          prov = (function (u, meta) { return function () { return window.RhythmGame.__buffered(u, meta); }; })(
            url, { title: t.title, artist: t.artist_credit_name || t.artist_name, genre: t.genre, artwork: t.artwork_url }
          );
        }
      }
    } catch (e) {}

    if (prov) { window.RhythmGame.startAt(prov, { atMs: atMs, difficulty: sel.difficulty }); return; }

    // Fallback (in-browser-charted track, no __buffered seam): set difficulty + fire the
    // public launchTrack at the synced timestamp. Sync is bounded by decode time only;
    // judgment stays 100% local, so this never affects fairness — only the comparative bar.
    try { window.RhythmGame.setDifficulty(sel.difficulty); } catch (e) {}
    setTimeout(function () {
      try { if (window.RhythmGame.getAC) window.RhythmGame.getAC().resume(); } catch (e) {}
      if (t && RC && RC.launchTrack) RC.launchTrack(t);
      else if (window.RhythmGame.playDemo) window.RhythmGame.playDemo();
    }, Math.max(0, atMs - Date.now()));
  }
  function hasServerChart(t) {
    return !!(t && (t.chart_status === 'ready' || t.has_chart || t._serverChart || (t.chart && t.chart.status === 'ready')));
  }

  // ---- opponent panel + tick (self-mounted into #game) ----
  function mountOppPanel() {
    var game = $('game'); if (!game) return;
    if (!oppPanel) {
      oppPanel = document.createElement('div'); oppPanel.id = 'mp-opp';
      oppPanel.innerHTML =
        '<div class="mo-who"><span id="mo-name">OPPONENT</span><span class="mo-live" id="mo-live">LIVE</span></div>' +
        '<div class="mo-score" id="mo-score">0</div>' +
        '<div class="mo-row"><span id="mo-combo">0x</span><span class="mo-delta" id="mo-delta">—</span></div>' +
        '<div class="mo-bar"><span id="mo-bar"></span></div>';
    }
    var nm = oppPanel.querySelector('#mo-name'); if (nm) nm.textContent = (oppMeta && oppMeta.name) ? oppMeta.name.slice(0, 12) : 'OPPONENT';
    var live = oppPanel.querySelector('#mo-live'); if (live) { live.textContent = 'LIVE'; live.classList.remove('gone'); }
    oppPanel.classList.remove('lead');
    game.appendChild(oppPanel);
  }
  function unmountOppPanel() { if (oppPanel && oppPanel.parentNode) oppPanel.parentNode.removeChild(oppPanel); }
  function markOppGone() { var l = oppPanel && oppPanel.querySelector('#mo-live'); if (l) { l.textContent = 'LEFT'; l.classList.add('gone'); } }

  function startTick() {
    stopTick();
    function frame() {
      oppRaf = requestAnimationFrame(frame);
      var now = performance.now();
      var stt = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;
      if (stt && matchCh && now - _lastSend > 160) {     // ~6/s
        _lastSend = now;
        matchCh.send({ type: 'broadcast', event: 'tick', payload: { score: stt.score, combo: stt.combo, acc: stt.acc, prog: stt.progress, name: ME.name } });
      }
      if (oppPanel && oppPanel.parentNode) renderOpp(stt);
    }
    oppRaf = requestAnimationFrame(frame);
  }
  function stopTick() { if (oppRaf) cancelAnimationFrame(oppRaf); oppRaf = 0; }
  function onTick(p) { if (p) lastOppTick = p; }
  function renderOpp(my) {
    if (!oppPanel) return;
    var o = lastOppTick;
    var sc = oppPanel.querySelector('#mo-score'), cb = oppPanel.querySelector('#mo-combo'),
        br = oppPanel.querySelector('#mo-bar'), dl = oppPanel.querySelector('#mo-delta');
    if (o && sc) { sc.textContent = Number(o.score || 0).toLocaleString(); cb.textContent = (o.combo || 0) + 'x'; br.style.width = Math.round((o.prog || 0) * 100) + '%'; }
    if (my && o && dl) {
      var d = (my.score || 0) - (o.score || 0);
      dl.textContent = (d >= 0 ? '+' : '') + d.toLocaleString();
      dl.className = 'mo-delta ' + (d >= 0 ? 'ahead' : 'behind');
      oppPanel.classList.toggle('lead', d < 0);
    }
  }

  // ---- end → finals → winner ----
  function onLocalSongEnd(reason, results) {
    finishedLocal = true; stopTick();
    var s = results ? {
      score: results.score, combo: results.max_combo, acc: Math.round((results.accuracy || 0) * 1000) / 10, grade: results.grade
    } : (window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : { score: 0, combo: 0, acc: 0, grade: 'D' });
    myFinal = s;
    if (matchCh) matchCh.send({ type: 'broadcast', event: 'final', payload: Object.assign({ name: ME.name }, s) });
    settleIfReady();
    setTimeout(function () { settleIfReady(true); }, 8000);   // safety if opponent never reports
  }
  function onFinal(p) { if (p) oppFinal = p; settleIfReady(); }
  function settleIfReady(force) {
    if (!matchLive || !finishedLocal) return;
    if (!oppFinal && !force && !oppLeft) return;
    matchLive = false;
    unmountOppPanel();
    setLobbyInMatch(false);
    showWinner();
  }
  function showWinner() {
    var me = myFinal || { score: 0, acc: 0, combo: 0 };
    var op = oppFinal;
    set('mpx-sc-you', Number(me.score || 0).toLocaleString());
    set('mpx-sc-you-meta', (me.acc != null ? me.acc + '% · ' : '') + (me.combo || 0) + 'x' + (me.grade ? ' · ' + me.grade : ''));
    set('mpx-sc-opp-who', (op && op.name) ? op.name.slice(0, 14) : (oppMeta && oppMeta.name ? oppMeta.name.slice(0, 14) : 'OPPONENT'));
    if (op) {
      set('mpx-sc-opp', Number(op.score || 0).toLocaleString());
      set('mpx-sc-opp-meta', (op.acc != null ? op.acc + '% · ' : '') + (op.combo || 0) + 'x' + (op.grade ? ' · ' + op.grade : ''));
    } else {
      set('mpx-sc-opp', oppLeft ? '—' : '…');
      set('mpx-sc-opp-meta', oppLeft ? 'left the match' : 'no result');
    }
    var v = $('mpx-verdict'), win, draw = false;
    if (!op || oppLeft) win = true;
    else if (me.score > op.score) win = true;
    else if (me.score < op.score) win = false;
    else draw = true;
    if (v) { v.className = 'mpx-verdict ' + (draw ? 'draw' : win ? 'win' : 'lose'); v.textContent = draw ? 'DRAW' : win ? 'YOU WIN' : 'YOU LOSE'; }
    step('winner');
    screen.classList.add('active');   // re-raise over the engine's results screen (showScreen stripped us)
    activeNow = true;
  }
  function set(id, txt) { var el = $(id); if (el) el.textContent = txt; }

  function resetForRematch() {
    myFinal = null; oppFinal = null; lastOppTick = null; meReady = false; oppReady = false;
    finishedLocal = false; matchLive = false; setReadyBtn(); setLobbyInMatch(true);
    step('setup'); paintSelection(); refreshReadyEnabled();
    var rs = $('mpx-readystate'); if (rs) rs.textContent = 'Rematch — READY when set.';
    screen.classList.add('active'); activeNow = true;
  }

  function teardownMatch() {
    stopTick(); unmountOppPanel();
    matchLive = false; finishedLocal = false; meReady = false; oppReady = false;
    try { if (matchCh) { matchCh.untrack(); supa.removeChannel(matchCh); } } catch (e) {}
    matchCh = null; matchId = null; matchRole = null; oppMeta = null; oppPresent = false; oppLeft = false;
    setLobbyInMatch(false);
  }
  function backToLobby() { teardownMatch(); step('lobby'); banner('mpx-lobby-msg', ''); onLobbySync(); }

  // ===================== TRACK PICKER (host) =====================
  function renderPicker(q) {
    var box = $('mpx-results'); if (!box) return;
    var RC = window.RhythmCatalog;
    var all = (RC && RC.allTracks) ? RC.allTracks() : [];
    if (RC && RC.trackReady) all = all.filter(function (t) { return RC.trackReady(t); });
    q = (q || '').toLowerCase();
    var rows = all.filter(function (t) {
      if (!q) return true;
      return (t.title || '').toLowerCase().indexOf(q) >= 0 || (t.artist_credit_name || t.artist_name || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 40);
    box.innerHTML = rows.map(function (t, i) {
      return '<div class="mpx-result" data-i="' + i + '"><div><div class="r-t">' + esc(t.title || 'Untitled') + '</div><div class="r-a">' + esc(t.artist_credit_name || t.artist_name || '') + '</div></div></div>';
    }).join('') || '<div class="mpx-result"><div class="r-a">No tracks found.</div></div>';
    [].forEach.call(box.querySelectorAll('.mpx-result[data-i]'), function (el) {
      el.addEventListener('click', function () {
        var t = rows[+el.getAttribute('data-i')]; if (!t) return;
        sel.trackId = t.id; sel.title = t.title; sel.artist = t.artist_credit_name || t.artist_name; sel.art = t.artwork_url; sel.demo = (t.id === 'demo');
        var pk = $('mpx-picker'); if (pk) pk.hidden = true;
        paintSelection(); broadcastSong();
        meReady = false; oppReady = false; setReadyBtn(); refreshReadyEnabled();
        var rs = $('mpx-readystate'); if (rs) rs.textContent = 'Track locked. Hit READY.';
      });
    });
  }

  // ===================== WIRING =====================
  function wire(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  wire('mpx-leave-setup', 'click', backToLobby);
  wire('mpx-leave-win', 'click', leaveAll);
  wire('mpx-backlobby', 'click', backToLobby);
  wire('mpx-rematch', 'click', function () { if (matchCh) matchCh.send({ type: 'broadcast', event: 'rematch', payload: {} }); resetForRematch(); });
  wire('mpx-ready', 'click', toggleReady);
  wire('mpx-diff', 'click', function (e) {
    var b = e.target.closest('button'); if (!b || matchRole !== 'host') return;
    sel.difficulty = b.getAttribute('data-diff');
    [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
    broadcastSong();
  });
  wire('mpx-pick', 'click', function () {
    if (matchRole !== 'host') return;
    var p = $('mpx-picker'); if (!p) return;
    p.hidden = !p.hidden; if (!p.hidden) { renderPicker(''); var s = $('mpx-search'); if (s) s.focus(); }
  });
  wire('mpx-search', 'input', function () { renderPicker(this.value); });

  // The hub's #mp-back / Esc already route to RhythmHub.show(). During a LIVE match the
  // active screen is #game (engine), so they can't fire mid-song. We additionally guard
  // #mp-back so leaving from a WINNER/SETUP step tears the match channel down cleanly.
  wire('mp-back', 'click', function () { try { teardownMatch(); if (lobbyCh) { lobbyCh.untrack(); supa.removeChannel(lobbyCh); } } catch (e) {} lobbyCh = null; lobby = {}; });

  // clean up presence if the tab closes
  window.addEventListener('beforeunload', function () { try { if (matchCh) matchCh.untrack(); if (lobbyCh) lobbyCh.untrack(); } catch (e) {} });

  // Detect activation of #multiplayer-screen (hub adds/removes .active). On show → join
  // the lobby; on hide (and not mid-match) → drop the lobby presence.
  function syncActive() {
    var nowActive = screen.classList.contains('active');
    if (nowActive && !activeNow) { activeNow = true; onActivated(); }
    else if (!nowActive && activeNow) { activeNow = false; if (!matchLive && !matchCh) { try { if (lobbyCh) { lobbyCh.untrack(); supa.removeChannel(lobbyCh); } } catch (e) {} lobbyCh = null; lobby = {}; } }
  }
  try {
    var mo = new MutationObserver(syncActive);
    mo.observe(screen, { attributes: true, attributeFilter: ['class'] });
  } catch (e) {}
  if (screen.classList.contains('active')) { activeNow = true; onActivated(); }

  // public hook
  window.RhythmMP = { open: open, close: leaveAll, isLive: function () { return matchLive; } };
})();
