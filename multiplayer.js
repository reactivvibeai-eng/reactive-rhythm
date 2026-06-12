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
          reannounce();
        }).catch(function () { paintYou(); });
      }
    } catch (e) {}
  }
  resolveMe();
  // re-resolve identity on auth changes (sign-in mid-session flips guest → named).
  try { if (window.RhythmCatalog && window.RhythmCatalog.onAuthChange) window.RhythmCatalog.onAuthChange(resolveMe); } catch (e) {}

  // ---- state ----
  var JOINED_AT = Date.now();
  var lobbyCh = null;              // rr-lobby channel (soft-presence + handshake broadcasts)
  var lobbySP = null, matchSP = null, roomSP = null, tourSP = null;   // build9: soft-presence handles
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
  // ---- build8: rooms + quick-match state ----
  var room = { id: null, name: null, priv: false, isHost: false, ch: null, seat: null,
               members: {}, p1: null, p2: null };   // current room (host or joined/spectating)
  var roomsDir = {};              // rid -> {rid,name,priv,hostId,hostName,count,max,at} (browser directory)
  var QM = { looking: false, t: 0 };   // quick-match: am I in the queue?
  var spectating = false;         // joined a match purely as a watcher
  var _fromRoom = null;           // build8: one-shot carry across room→match handoff
  // ---- build9: tournament state (5–10 player single-elim bracket on ONE channel) ----
  var TOUR_MAX = 10, TOUR_MIN = 3;          // copy advertises 5–10; 3 makes a real bracket testable
  var tour = nullTour();
  var toursDir = {};                         // tid -> {tid,name,hostId,hostName,count,max,state,at}
  var _tourRaf = 0, _tourLastSend = 0;
  function nullTour() {
    return { id: null, name: null, isHost: false, hostId: null, ch: null, members: {}, state: 'open',
      round: 0, alive: [], pairs: [], byes: [], sel: null, finals: {}, settled: {}, _settleT: {},
      rival: null, meIn: false, history: [], champ: null };
  }

  // ===================== SOFT PRESENCE (build9 foundation fix) =====================
  // VERIFIED against the live project: Realtime BROADCAST round-trips fine, but native
  // PRESENCE never syncs (track() acks "ok", zero presence_state/sync events — project-side).
  // So every "who's here" surface rides this broadcast-heartbeat layer instead:
  //   hb {meta} every 5s + instant hello-back when a newcomer appears + bye on leave +
  //   13s expiry sweep for crashes. Deterministic, project-independent, ≤10 peers/channel.
  function softPresence(ch, getMeta, onChange) {
    var peers = {}, hbT = 0, sweepT = 0;
    function selfMeta() { var m = getMeta() || {}; if (!m.at) m.at = Date.now(); return m; }
    function beat() { try { ch.send({ type: 'broadcast', event: 'hb', payload: selfMeta() }); } catch (e) {} }
    function snapshot() {
      var all = {}; Object.keys(peers).forEach(function (k) { all[k] = peers[k].meta; });
      var me = selfMeta(); if (me.id) all[me.id] = me;
      return all;
    }
    function emit() { try { onChange(snapshot()); } catch (e) {} }
    ch.on('broadcast', { event: 'hb' }, function (m) {
      var p = m.payload; if (!p || !p.id) return;
      var me = selfMeta(); if (p.id === me.id) return;          // self-echo on self:true channels
      var fresh = !peers[p.id];
      peers[p.id] = { meta: p, t: Date.now() };
      if (fresh) beat();                                        // newcomer learns me in ~1 RTT
      emit();
    });
    ch.on('broadcast', { event: 'bye' }, function (m) {
      var p = m.payload; if (p && p.id && peers[p.id]) { delete peers[p.id]; emit(); }
    });
    return {
      start: function () {
        beat(); emit();
        // 10s beat / 75s expiry: background tabs clamp timers to ~1/min, so a tabbed-away
        // player still beats inside the expiry window instead of being purged from rosters.
        hbT = setInterval(beat, 10000);
        sweepT = setInterval(function () {
          var now = Date.now(), changed = false;
          Object.keys(peers).forEach(function (k) { if (now - peers[k].t > 75000) { delete peers[k]; changed = true; } });
          if (changed) emit();
        }, 8000);
      },
      refresh: beat,                                            // call when my flags change (replaces .track())
      stop: function () {
        clearInterval(hbT); clearInterval(sweepT);
        try { ch.send({ type: 'broadcast', event: 'bye', payload: { id: (getMeta() || {}).id } }); } catch (e) {}
      },
      peers: snapshot
    };
  }

  function initial(s) { return (s || '?').trim().charAt(0).toUpperCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function newMatchId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function safeUrl(u) { return String(u == null ? '' : u).replace(/["\\]/g, ''); }
  function myPresence(inMatch) {
    return { id: ME.id, name: ME.name, avatar: ME.avatar, at: JOINED_AT, inMatch: !!inMatch,
      lf: !!QM.looking, room: (room.id || null), hostRoom: (room.id && room.isHost ? room.id : null),
      tourn: (tour.id || null), hostTourn: (tour.id && tour.isHost ? tour.id : null) };
  }
  function reannounce() { try { if (lobbySP) { lobbySP.refresh(); lobby = lobbySP.peers(); onLobbySync(); } } catch (e) {} }

  // ---- step switching (only one .mpx-step shows at a time) ----
  function step(name) {
    var card = screen.querySelector('.mp-card'); if (card) card.setAttribute('data-mp-step', name);
    ['lobby', 'rooms', 'tour', 'setup', 'go', 'winner'].forEach(function (s) {
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
    if (!matchLive && !matchCh && !tour.id) step('lobby');   // don't reset a returning winner overlay or a live bracket (build9)
    banner('mpx-lobby-msg', '');
    paintQuickBtn(); updateBrowseCount();           // build8
    joinLobby();
  }
  function leaveAll() {
    try { closeRoom(true); } catch (e) {}    // build8: host closes / guest leaves room cleanly
    try { closeTour(true); } catch (e) {}    // build9: host dissolves / entrant forfeits the bracket
    QM.looking = false;                       // build8: drop quick-match queue
    teardownMatch();
    try { if (lobbySP) lobbySP.stop(); if (lobbyCh) supa.removeChannel(lobbyCh); } catch (e) {}
    lobbyCh = null; lobbySP = null; lobby = {};
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
    lobbyCh = supa.channel('rr-lobby', { config: { broadcast: { self: false } } });
    lobbySP = softPresence(lobbyCh, function () { return myPresence(matchLive || !!matchCh); }, function (all) { lobby = all; onLobbySync(); });
    // challenge handshake rides the lobby channel (targeted by toId)
    lobbyCh.on('broadcast', { event: 'challenge' }, function (m) { onChallenge(m.payload); });
    lobbyCh.on('broadcast', { event: 'challenge-ans' }, function (m) { onChallengeAns(m.payload); });
    // build8: open-room directory advertisements (host → everyone) + close notices
    lobbyCh.on('broadcast', { event: 'room-meta' }, function (m) { onRoomMeta(m.payload); });
    lobbyCh.on('broadcast', { event: 'room-gone' }, function (m) { var p = m.payload; if (p && p.rid) { delete roomsDir[p.rid]; renderRooms(); updateBrowseCount(); } });
    lobbyCh.on('broadcast', { event: 'room-ping' }, function () { if (room.id && room.isHost) advertiseRoom(); if (tour.id && tour.isHost) advertiseTour(); });   // late-joiner asks; hosts re-announce
    // build9: tournament directory advertisements
    lobbyCh.on('broadcast', { event: 'tour-meta' }, function (m) { onTourMeta(m.payload); });
    lobbyCh.on('broadcast', { event: 'tour-gone' }, function (m) { var p = m.payload; if (p && p.tid) { delete toursDir[p.tid]; renderRooms(); updateBrowseCount(); } });
    // build8: quick-match pairing broadcast (deterministic proposer avoids double-pair)
    lobbyCh.on('broadcast', { event: 'qm-pair' }, function (m) { onQuickPair(m.payload); });
    lobbyCh.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        lobbySP.start();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        banner('mpx-lobby-msg', 'Could not reach the live lobby. Check your connection and reopen.');
      }
    });
  }
  function setLobbyInMatch(flag) { reannounce(); }

  function onLobbySync() {
    if (!lobbyCh) return;
    // `lobby` is maintained by the soft-presence layer (broadcast heartbeats)
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
    reconcileRoomsFromPresence();   // build8: drop rooms whose host vanished; learn new hosts
    reconcileToursFromPresence();   // build9: same prune for tournament cards
    updateBrowseCount();
    if (QM.looking) tryQuickPair();  // build8: someone new might be queued
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
    matchCh = supa.channel('rr-match-' + mid, { config: { broadcast: { self: false } } });
    matchSP = softPresence(matchCh, function () { return { id: ME.id, name: ME.name, role: matchRole, at: Date.now() }; }, onMatchPeers);
    matchCh.on('broadcast', { event: 'song' }, function (m) { onSong(m.payload); });
    matchCh.on('broadcast', { event: 'ready' }, function (m) { onReady(m.payload); });
    matchCh.on('broadcast', { event: 'start' }, function (m) { onStart(m.payload); });
    matchCh.on('broadcast', { event: 'tick' }, function (m) { onTick(m.payload); });
    matchCh.on('broadcast', { event: 'final' }, function (m) { onFinal(m.payload); });
    matchCh.on('broadcast', { event: 'rematch' }, function () { resetForRematch(); });
    matchCh.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        matchSP.start();
        enterSetup();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        banner('mpx-setup-msg', 'Could not open the match channel. Back out and retry.');
      }
    });
  }
  function enterSetup() {
    step('setup');
    var _rcx = $('mpx-roomctx'); if (_rcx) _rcx.hidden = true;   // build8: hide room strip by default; enterRoomWaiting re-shows it
    var dot = $('mpx-dot-opp'); if (dot) { dot.setAttribute('data-state', 'waiting'); dot.textContent = oppMeta ? (oppMeta.name || 'OPPONENT').slice(0, 12) : 'WAITING…'; }
    var isHost = matchRole === 'host';
    var pick = $('mpx-pick'); if (pick) pick.disabled = !isHost;
    var chev = $('mpx-pick-chev'); if (chev) chev.style.visibility = isHost ? '' : 'hidden';
    var diff = $('mpx-diff'); if (diff) [].forEach.call(diff.children, function (b) { b.disabled = !isHost; });
    var rs = $('mpx-readystate'); if (rs) rs.textContent = isHost ? 'Pick a track, then hit READY.' : 'Waiting for host to pick a track…';
    banner('mpx-setup-msg', '');
    // build8: room→match handoff — restore the host's locked track + auto-arm READY so play starts
    // without a second ready-tap (both already readied in the room).
    if (_fromRoom) {
      if (_fromRoom.sel) { sel = _fromRoom.sel; paintSelection(); }
      var fr = _fromRoom; _fromRoom = null;
      setTimeout(function () {
        try {
          if (matchRole === 'host' && sel.trackId) broadcastSong();
          if (sel.trackId && oppPresent) { meReady = true; setReadyBtn();
            if (matchCh) matchCh.send({ type: 'broadcast', event: 'ready', payload: { ready: true, id: ME.id } });
            maybeStart();
          }
        } catch (e) {}
      }, 350);   // let opponent presence land on the new channel
    }
    paintSelection(); refreshReadyEnabled();
  }
  function onMatchPeers(all) {
    if (!matchCh) return;
    var others = Object.keys(all).filter(function (k) { return k !== ME.id; });
    var wasPresent = oppPresent;
    oppPresent = others.length > 0;
    var opp = oppPresent ? all[others[0]] : null;
    var dot = $('mpx-dot-opp');
    if (oppPresent) {
      if (dot) { dot.setAttribute('data-state', 'here'); dot.textContent = (opp && opp.name ? opp.name : (oppMeta && oppMeta.name) || 'OPPONENT').slice(0, 12); }
      oppLeft = false;
      if (matchRole === 'host' && sel.trackId && !wasPresent) broadcastSong();   // late-join catch-up
    } else if (wasPresent) {
      oppLeft = true;
      if (dot) { dot.setAttribute('data-state', 'left'); dot.textContent = 'OPPONENT LEFT'; }
      if (matchLive) { markOppGone(); settleIfReady(); }
      else { oppReady = false; banner('mpx-setup-msg', 'Opponent left. Back to lobby to find another.'); }
    } else if (dot) { dot.setAttribute('data-state', 'waiting'); dot.textContent = 'WAITING…'; }
    refreshReadyEnabled();
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
    // build8: in the ROOM WAITING AREA (no match channel yet), the host's start rides the ROOM
    // channel via room-start; both seated players then open the same rr-match-<mid>. Once that
    // match channel exists (matchCh set) — including quick-match, challenge, and the room handoff —
    // we take the original synchronized-start path below.
    if (room.id && room.isHost && !matchCh && meReady && oppReady && sel.trackId) { startRoomMatch(); return; }
    if (meReady && oppReady && sel.trackId && matchRole === 'host' && matchCh) {
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
    try { if (matchSP) matchSP.stop(); if (matchCh) supa.removeChannel(matchCh); } catch (e) {}
    matchCh = null; matchSP = null; matchId = null; matchRole = null; oppMeta = null; oppPresent = false; oppLeft = false;
    setLobbyInMatch(false);
  }
  function backToLobby() {
    teardownMatch();
    QM.looking = false; paintQuickBtn();   // build8
    step('lobby'); banner('mpx-lobby-msg', ''); onLobbySync();
  }

  // ===================== BUILD8: QUICK-MATCH =====================
  function toggleQuickMatch() {
    if (!supa || !lobbyCh) { banner('mpx-lobby-msg', 'Sign in to play online — quick-match needs a connection.'); return; }
    QM.looking = !QM.looking; QM.t = Date.now();
    paintQuickBtn(); reannounce();
    banner('mpx-lobby-msg', QM.looking ? 'Looking for a match — pairing you with the next available rival…' : '');
    if (QM.looking) tryQuickPair();
  }
  function paintQuickBtn() {
    var b = $('mpx-act-quick'); if (!b) return;
    b.setAttribute('aria-busy', QM.looking ? 'true' : 'false');
    var t = b.querySelector('.a-t'), d = b.querySelector('.a-d');
    if (t) t.textContent = QM.looking ? '⚡ Searching…' : '⚡ Quick Match';
    if (d) d.textContent = QM.looking ? 'Tap to cancel' : 'Auto-pair a random rival';
  }
  // Deterministic proposer: of the two queued ids, the lexicographically-smaller one emits the pair.
  // Both sides receive qm-pair and route into the SAME match channel — no race, no double match.
  function tryQuickPair() {
    if (!QM.looking || matchCh || matchLive) return;
    var cands = Object.keys(lobby).filter(function (id) {
      var p = lobby[id]; return id !== ME.id && p && p.lf && !p.inMatch && !p.room;
    });
    if (!cands.length) return;
    cands.sort();
    var opp = cands[0];
    if (ME.id < opp) {   // I propose
      var mid = newMatchId();
      lobbyCh.send({ type: 'broadcast', event: 'qm-pair', payload: { aId: ME.id, bId: opp, mid: mid } });
      QM.looking = false; paintQuickBtn(); reannounce();
      startMatchChannel(mid, 'host', lobby[opp]);   // proposer = host
    }
    // else: wait — the smaller id will propose and I'll catch it in onQuickPair
  }
  function onQuickPair(p) {
    if (!p || p.bId !== ME.id || !QM.looking) return;
    QM.looking = false; paintQuickBtn(); reannounce();
    startMatchChannel(p.mid, 'guest', lobby[p.aId]);  // I'm the callee = guest
  }

  // ===================== BUILD8: ROOMS =====================
  function newRoomId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function gotoRooms(mode) {   // mode: 'browse' | 'create' | 'tour-create' (build9)
    step('rooms');
    var creating = (mode === 'create' || mode === 'tour-create');
    var br = $('mpx-rooms-browse'), cr = $('mpx-rooms-create');
    if (br) br.hidden = creating;
    if (cr) cr.hidden = !creating;
    banner('mpx-rooms-msg', '');
    if (creating) {
      var isTour = (mode === 'tour-create');
      if (cr) cr.setAttribute('data-mode', isTour ? 'tour' : 'duel');
      var ttl = $('mpx-create-title'); if (ttl) ttl.textContent = isTour ? '🏆 OPEN A TOURNAMENT' : 'OPEN A ROOM';
      var go = $('mpx-room-create-go'); if (go) go.textContent = isTour ? 'OPEN TOURNAMENT' : 'OPEN ROOM';
      var msg = $('mpx-room-create-msg'); if (msg) msg.textContent = isTour ? 'Single-elimination bracket · 5–10 players · winners advance until one remains.' : "Public rooms appear in everyone's browser.";
      var pv = $('mpx-room-priv'); if (pv) pv.style.display = isTour ? 'none' : '';
      var nm = $('mpx-room-name'); if (nm) { nm.value = ''; nm.placeholder = isTour ? 'Bracket name (e.g. Friday Showdown)' : 'Room name (e.g. Friday Shred)'; setTimeout(function () { nm.focus(); }, 30); }
    }
    else { try { if (lobbyCh) lobbyCh.send({ type: 'broadcast', event: 'room-ping', payload: { from: ME.id } }); } catch (e) {} renderRooms(); }
  }

  // ---- host: open / advertise / close ----
  function openRoom() {
    if (!supa || !lobbyCh) { banner('mpx-rooms-msg', 'Sign in to play online — rooms need a connection.'); return; }
    var nm = ($('mpx-room-name') && $('mpx-room-name').value || '').trim().slice(0, 28) || (ME.name + "'s Room");
    var priv = !!(screen.querySelector('#mpx-room-priv button.active') && screen.querySelector('#mpx-room-priv button.active').getAttribute('data-priv') === 'private');
    room = { id: newRoomId(), name: nm, priv: priv, isHost: true, ch: null, seat: 'p1', members: {}, p1: ME.id, p2: null };
    joinRoomChannel(room.id, 'p1');
    reannounce();
    enterRoomWaiting();
    advertiseRoom();
  }
  function advertiseRoom() {
    if (!lobbyCh || !room.id || !room.isHost) return;
    var count = 1 + (room.p2 ? 1 : 0);
    lobbyCh.send({ type: 'broadcast', event: 'room-meta', payload: {
      rid: room.id, name: room.name, priv: room.priv, hostId: ME.id, hostName: ME.name, count: count, max: 2, at: Date.now() } });
  }
  function closeRoom(silent) {
    if (room.id && room.isHost && lobbyCh) { try { lobbyCh.send({ type: 'broadcast', event: 'room-gone', payload: { rid: room.id } }); } catch (e) {} }
    leaveRoomChannel();
    room = { id: null, name: null, priv: false, isHost: false, ch: null, seat: null, members: {}, p1: null, p2: null };
    spectating = false; reannounce();
    if (!silent) { step('lobby'); banner('mpx-lobby-msg', ''); onLobbySync(); }
  }

  // ---- room presence channel (the waiting area; 2 seats + spectators) ----
  function joinRoomChannel(rid, seat) {
    leaveRoomChannel();
    room.id = rid; room.seat = seat;
    var ch = supa.channel('rr-room-' + rid, { config: { broadcast: { self: false } } });
    room.ch = ch;
    roomSP = softPresence(ch, function () { return { id: ME.id, name: ME.name, avatar: ME.avatar, seat: room.seat, at: Date.now() }; }, onRoomPeers);
    ch.on('broadcast', { event: 'room-start' }, function (m) { onRoomStart(m.payload); });
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') { roomSP.start(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { banner('mpx-rooms-msg', 'Could not reach that room. Back out and retry.'); }
    });
  }
  function leaveRoomChannel() { try { if (roomSP) roomSP.stop(); if (room.ch) supa.removeChannel(room.ch); } catch (e) {} room.ch = null; roomSP = null; }
  function onRoomPeers(all) {
    if (!room.ch) return;
    room.members = all;
    // seat assignment is host-authoritative: host = p1; first non-spec joiner = p2.
    if (room.isHost) {
      var others = Object.keys(room.members).filter(function (id) { return id !== ME.id && room.members[id].seat !== 'spec'; });
      var p2 = others[0] || null;
      if (p2 !== room.p2) { room.p2 = p2; advertiseRoom(); }
    }
    paintRoomWaiting();
  }
  // host launches: tells both seats to spin up the SAME match channel; spectators get the mid too.
  function startRoomMatch() {
    if (!room.isHost || !room.p2) return;
    var mid = 'm' + room.id.slice(1) + Date.now().toString(36).slice(-3);
    room.ch.send({ type: 'broadcast', event: 'room-start', payload: { mid: mid, p1Id: room.p1, p2Id: room.p2 } });
    onRoomStart({ mid: mid, p1Id: room.p1, p2Id: room.p2 });
  }
  function onRoomStart(p) {
    if (!p || !p.mid) return;
    var oppId = (ME.id === p.p1Id) ? p.p2Id : p.p1Id;
    var oppMetaLocal = room.members[oppId] || lobby[oppId] || null;
    if (room.seat === 'spec' || (ME.id !== p.p1Id && ME.id !== p.p2Id)) { spectateMatch(p.mid, room.members[p.p1Id], room.members[p.p2Id]); return; }
    var role = (ME.id === p.p1Id) ? 'host' : 'guest';
    _fromRoom = { sel: (sel.trackId ? Object.assign({}, sel) : null) };   // carry host's locked track
    startMatchChannel(p.mid, role, oppMetaLocal);
  }

  // ---- guest: join a listed room (as duelist or spectator) ----
  function joinRoom(rid, asSpec) {
    if (!supa || !lobbyCh) return;
    var meta = roomsDir[rid]; if (!meta) { banner('mpx-rooms-msg', 'That room just closed.'); return; }
    if (!asSpec && meta.count >= meta.max) { banner('mpx-rooms-msg', 'Room is full — spectate instead.'); return; }
    room = { id: rid, name: meta.name, priv: meta.priv, isHost: false, ch: null, seat: asSpec ? 'spec' : 'p2', members: {}, p1: meta.hostId, p2: asSpec ? null : ME.id };
    spectating = !!asSpec;
    joinRoomChannel(rid, room.seat);
    reannounce();
    enterRoomWaiting();
  }

  // ---- waiting-room view (reuses the setup step shell) ----
  function enterRoomWaiting() {
    enterSetup();   // reuse the existing setup UI (track pick disabled for non-host as usual)
    var ctx = $('mpx-roomctx'); if (ctx) ctx.hidden = false;
    var nmEl = $('mpx-roomctx-name'); if (nmEl) nmEl.textContent = room.name || 'Room';
    var pv = $('mpx-roomctx-priv'); if (pv) pv.textContent = room.priv ? '· PRIVATE' : '· PUBLIC';
    var closeBtn = $('mpx-room-close');
    if (closeBtn) closeBtn.textContent = room.isHost ? 'CLOSE ROOM' : 'LEAVE ROOM';
    paintRoomWaiting();
  }
  function paintRoomWaiting() {
    var specCount = Object.keys(room.members).filter(function (id) { return room.members[id].seat === 'spec'; }).length;
    var sc = $('mpx-roomctx-spec'); if (sc) sc.textContent = specCount ? (specCount + ' watching') : '';
    var opp = room.isHost ? (room.p2 && room.members[room.p2]) : (room.members[room.p1]);
    var dot = $('mpx-dot-opp');
    if (dot) {
      if (opp) { dot.setAttribute('data-state', 'here'); dot.textContent = (opp.name || 'OPPONENT').slice(0, 12); }
      else { dot.setAttribute('data-state', 'waiting'); dot.textContent = spectating ? 'WATCHING' : 'WAITING…'; }
    }
  }

  // ---- room directory (browser) ----
  function onRoomMeta(p) {
    if (!p || !p.rid || p.priv) return;   // private rooms are not listed (invite/qm only)
    if (p.hostId === ME.id) return;
    roomsDir[p.rid] = p; roomsDir[p.rid].at = Date.now();
    renderRooms(); updateBrowseCount();
  }
  function reconcileRoomsFromPresence() {
    // a room is only real if its host is still present in the lobby; prune stale cards.
    Object.keys(roomsDir).forEach(function (rid) {
      var hid = roomsDir[rid].hostId;
      if (!lobby[hid] || lobby[hid].hostRoom !== rid) {
        if (Date.now() - (roomsDir[rid].at || 0) > 4000) delete roomsDir[rid];   // grace for meta lag
      }
    });
  }
  function openRoomCount() { return Object.keys(roomsDir).length + Object.keys(toursDir).length; }
  function updateBrowseCount() {
    var n = openRoomCount();
    var el = $('mpx-act-browse-n'); if (el) el.textContent = n ? ('(' + n + ')') : '';
  }
  function renderRooms() {
    var host = $('mpx-roomlist'); if (!host) return;
    var ids = Object.keys(roomsDir);
    var tids = Object.keys(toursDir);
    var empty = $('mpx-rooms-empty'); if (empty) empty.hidden = (ids.length + tids.length) !== 0;
    // build9: tournament cards lead the list (gold spark; join gated on open + seats)
    var tourCards = tids.map(function (tid) {
      var r = toursDir[tid], live = r.state === 'live' || r.state === 'done', full = (r.count || 1) >= (r.max || 10);
      return '<div class="mpx-roomcard' + (full || live ? ' full' : '') + '">' +
        '<span class="mpx-rc-spark tour">🏆</span>' +
        '<span class="mpx-rc-meta"><span class="mpx-rc-name">' + esc(r.name || 'Bracket') + '</span>' +
        '<span class="mpx-rc-sub"><span class="mpx-rc-tag ' + (live ? 'live">LIVE' : 'tour">BRACKET') + '</span> host ' + esc(r.hostName || 'host') + ' · <span class="mpx-rc-count">' + (r.count || 1) + '/' + (r.max || 10) + '</span></span></span>' +
        '<span class="mpx-rc-act"><button class="mpx-rc-join" data-jt="' + esc(tid) + '"' + (full || live ? ' disabled' : '') + '>' + (live ? 'LIVE' : full ? 'FULL' : 'JOIN') + '</button></span></div>';
    }).join('');
    host.innerHTML = tourCards + ids.map(function (rid) {
      var r = roomsDir[rid], full = (r.count || 1) >= (r.max || 2);
      return '<div class="mpx-roomcard' + (full ? ' full' : '') + '">' +
        '<span class="mpx-rc-spark">🎸</span>' +
        '<span class="mpx-rc-meta"><span class="mpx-rc-name">' + esc(r.name || 'Room') + '</span>' +
        '<span class="mpx-rc-sub"><span class="mpx-rc-tag pub">PUBLIC</span> host ' + esc((r.hostName || 'host')) + ' · <span class="mpx-rc-count">' + (r.count || 1) + '/' + (r.max || 2) + '</span></span></span>' +
        '<span class="mpx-rc-act">' +
          '<button class="mpx-rc-join" data-join="' + esc(rid) + '"' + (full ? ' disabled' : '') + '>' + (full ? 'FULL' : 'JOIN') + '</button>' +
          '<button class="mpx-rc-spec" data-spec="' + esc(rid) + '">WATCH</button>' +
        '</span></div>';
    }).join('');
    [].forEach.call(host.querySelectorAll('[data-join]'), function (b) { b.addEventListener('click', function () { joinRoom(b.getAttribute('data-join'), false); }); });
    [].forEach.call(host.querySelectorAll('[data-spec]'), function (b) { b.addEventListener('click', function () { joinRoom(b.getAttribute('data-spec'), true); }); });
    [].forEach.call(host.querySelectorAll('[data-jt]'), function (b) { b.addEventListener('click', function () { joinTour(b.getAttribute('data-jt')); }); });   // build9
  }

  // ===================== BUILD8: SPECTATE =====================
  function spectateMatch(mid, p1meta, p2meta) {
    spectating = true; matchLive = true; finishedLocal = true;   // finishedLocal=true → never wait on "my" result
    oppMeta = p1meta || p2meta || null;
    step('go'); var gn = $('mpx-go-num'); if (gn) gn.textContent = 'SPECTATING';
    var watchCh = supa.channel('rr-match-' + mid, { config: { broadcast: { self: false } } });
    matchCh = watchCh;
    watchCh.on('broadcast', { event: 'tick' }, function (m) { lastOppTick = m.payload; });
    watchCh.on('broadcast', { event: 'final' }, function (m) { oppFinal = m.payload; myFinal = myFinal || { score: 0 }; showWinner(); });
    watchCh.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        // mount a read-only panel over whatever screen is up; spectators don't run the engine.
        screen.classList.add('active'); activeNow = true;
        mountOppPanel();
        var panel = $('mp-opp'); if (panel) panel.classList.add('spectate');
        var sp = panel && panel.querySelector('.mo-spec'); if (!sp && panel) { var s = document.createElement('div'); s.className = 'mo-spec'; s.textContent = 'SPECTATING'; panel.insertBefore(s, panel.firstChild); }
        startSpectatorTick();
      }
    });
  }
  function startSpectatorTick() {
    stopTick();
    function frame() { oppRaf = requestAnimationFrame(frame); if (oppPanel && oppPanel.parentNode) renderOpp(null); }
    oppRaf = requestAnimationFrame(frame);
  }

  // ===================== BUILD9: TOURNAMENT (5–10 player single-elim bracket) =====================
  // ONE channel `rr-tour-<tid>` with broadcast.self=true → the HOST's own t-round/t-result/t-champ
  // arrive back as events, so host and entrants run the SAME receive handlers (no forked paths).
  // Host is the clock + referee: rolls the track, broadcasts rounds with a synced atMs, collects
  // finals, settles pairs (score → acc → id), advances winners, crowns the champion. Every round
  // ALL alive players play the SAME track simultaneously; the bracket decides who you're scored
  // against. Odd counts: last seed is a BYE (auto-advance). Leavers forfeit (score -1).
  function newTourId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function tourSeat(id) { return tour.members[id] || lobby[id] || { id: id, name: 'Player' }; }
  function tourName(id) { return (tourSeat(id).name || 'Player').slice(0, 14); }

  // ---- create / join / advertise / close ----
  function openTour() {
    if (!supa || !lobbyCh) { banner('mpx-rooms-msg', 'Sign in to play online — tournaments need a connection.'); return; }
    var nm = ($('mpx-room-name') && $('mpx-room-name').value || '').trim().slice(0, 28) || (ME.name + "'s Bracket");
    tour = nullTour(); tour.id = newTourId(); tour.name = nm; tour.isHost = true; tour.hostId = ME.id;
    joinTourChannel(tour.id);
    reannounce(); enterTourRoom(); advertiseTour();
    rollTrack();   // host pre-rolls the round-1 track
  }
  function joinTour(tid) {
    if (!supa || !lobbyCh) return;
    var meta = toursDir[tid]; if (!meta) { banner('mpx-rooms-msg', 'That bracket just closed.'); return; }
    if (meta.state === 'live') { banner('mpx-rooms-msg', 'That bracket is already underway.'); return; }
    if ((meta.count || 1) >= TOUR_MAX) { banner('mpx-rooms-msg', 'Bracket is full (10 max).'); return; }
    tour = nullTour(); tour.id = tid; tour.name = meta.name; tour.isHost = false; tour.hostId = meta.hostId;
    joinTourChannel(tid);
    reannounce(); enterTourRoom();
  }
  function advertiseTour() {
    if (!lobbyCh || !tour.id || !tour.isHost) return;
    lobbyCh.send({ type: 'broadcast', event: 'tour-meta', payload: {
      tid: tour.id, name: tour.name, hostId: ME.id, hostName: ME.name,
      count: Object.keys(tour.members).length || 1, max: TOUR_MAX, state: tour.state, at: Date.now() } });
  }
  function closeTour(silent) {
    if (tour.id && tour.isHost && lobbyCh) { try { lobbyCh.send({ type: 'broadcast', event: 'tour-gone', payload: { tid: tour.id } }); } catch (e) {} }
    stopTourTick();
    Object.keys(tour._settleT).forEach(function (k) { clearTimeout(tour._settleT[k]); });
    try { if (tourSP) tourSP.stop(); if (tour.ch) supa.removeChannel(tour.ch); } catch (e) {}
    tourSP = null; tour = nullTour(); reannounce();
    if (!silent) { step('lobby'); banner('mpx-lobby-msg', ''); onLobbySync(); }
  }

  // ---- the tournament channel ----
  function joinTourChannel(tid) {
    var ch = supa.channel('rr-tour-' + tid, { config: { broadcast: { self: true } } });
    tour.ch = ch;
    tourSP = softPresence(ch, function () { return { id: ME.id, name: ME.name, avatar: ME.avatar, at: Date.now() }; }, onTourPeers);
    ch.on('broadcast', { event: 't-track' },  function (m) { onTourTrack(m.payload); });
    ch.on('broadcast', { event: 't-round' },  function (m) { onTourRound(m.payload); });
    ch.on('broadcast', { event: 't-tick' },   function (m) { onTourTick(m.payload); });
    ch.on('broadcast', { event: 't-final' },  function (m) { onTourFinal(m.payload); });
    ch.on('broadcast', { event: 't-result' }, function (m) { onTourResult(m.payload); });
    ch.on('broadcast', { event: 't-champ' },  function (m) { onTourChamp(m.payload); });
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') { tourSP.start(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { banner('mpx-tour-msg', 'Could not reach the bracket. Back out and retry.'); }
    });
  }
  function onTourPeers(all) {
    if (!tour.ch) return;
    var was = Object.keys(tour.members).length;
    tour.members = all;
    var n = Object.keys(tour.members).length;
    // host vanished mid-bracket → the tournament dissolves for everyone (v1: no host migration)
    if (tour.hostId && !tour.members[tour.hostId] && tour.state !== 'done' && !tour.isHost && n > 0) {
      banner('mpx-tour-msg', 'The host disconnected — tournament dissolved.');
      setTimeout(function () { if (tour.id) closeTour(); }, 1800);
      return;
    }
    if (tour.isHost && n !== was) advertiseTour();
    // host: a live duelist vanishing forfeits their unsettled pair
    if (tour.isHost && tour.state === 'live') {
      tour.pairs.forEach(function (pr, i) {
        if (tour.settled[i] != null) return;
        pr.forEach(function (id) {
          if (id && !tour.members[id] && !tour.finals[id]) {
            tour.finals[id] = { id: id, score: -1, acc: 0, combo: 0, gone: true };
            trySettlePair(i);
          }
        });
      });
    }
    paintTourRoom();
  }

  // ---- track roll (host) ----
  function rollTrack() {
    if (!tour.isHost || tour.state !== 'open') return;
    var RC = window.RhythmCatalog, all = (RC && RC.allTracks) ? RC.allTracks() : [];
    if (RC && RC.trackReady) all = all.filter(function (t) { return RC.trackReady(t); });
    var sel = null;
    if (all.length) {
      var t = all[Math.floor(Math.random() * all.length)];
      sel = { trackId: t.id, title: t.title, artist: t.artist_credit_name || t.artist_name, art: t.artwork_url, difficulty: tourDiff(), demo: (t.id === 'demo') };
    }
    if (!sel) sel = { trackId: 'demo', title: 'Lunar Waves', artist: 'ReactivVibe', art: null, difficulty: tourDiff(), demo: true };
    tour.ch.send({ type: 'broadcast', event: 't-track', payload: { sel: sel } });
  }
  function tourDiff() {
    var d = screen.querySelector('#mpx-tdiff button.active');
    return (d && d.getAttribute('data-diff')) || 'medium';
  }
  function onTourTrack(p) { if (p && p.sel) { tour.sel = p.sel; paintTourRoom(); } }

  // ---- host: start + run rounds ----
  function buildPairs(alive) {
    var pairs = [], byes = [];
    for (var i = 0; i + 1 < alive.length; i += 2) pairs.push([alive[i], alive[i + 1]]);
    if (alive.length % 2 === 1) byes.push(alive[alive.length - 1]);
    return { pairs: pairs, byes: byes };
  }
  function startTour() {
    if (!tour.isHost || tour.state !== 'open' || !tour.sel) return;
    var ids = Object.keys(tour.members);
    if (ids.length < TOUR_MIN) return;
    for (var i = ids.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
    hostBeginRound(1, ids, tour.sel);
  }
  function hostBeginRound(n, alive, sel) {
    var pb = buildPairs(alive);
    tour.ch.send({ type: 'broadcast', event: 't-round', payload: {
      n: n, alive: alive, pairs: pb.pairs, byes: pb.byes, sel: sel, atMs: Date.now() + 2600 } });
  }
  function hostNextTrack() {
    var RC = window.RhythmCatalog, all = (RC && RC.allTracks) ? RC.allTracks() : [];
    if (RC && RC.trackReady) all = all.filter(function (t) { return RC.trackReady(t); });
    if (!all.length) return tour.sel;
    var t = all[Math.floor(Math.random() * all.length)];
    return { trackId: t.id, title: t.title, artist: t.artist_credit_name || t.artist_name, art: t.artwork_url, difficulty: (tour.sel && tour.sel.difficulty) || 'medium', demo: (t.id === 'demo') };
  }

  // ---- uniform round handler (host included via self:true) ----
  function onTourRound(p) {
    if (!p || !p.n) return;
    tour.state = 'live'; tour.round = p.n; tour.alive = p.alive || []; tour.pairs = p.pairs || [];
    tour.byes = p.byes || []; tour.sel = p.sel; tour.finals = {}; tour.settled = {};
    Object.keys(tour._settleT).forEach(function (k) { clearTimeout(tour._settleT[k]); }); tour._settleT = {};
    if (tour.isHost) advertiseTour();
    var myPair = null;
    tour.pairs.forEach(function (pr) { if (pr.indexOf(ME.id) >= 0) myPair = pr; });
    tour.meIn = !!myPair; tour.rival = myPair ? myPair[(myPair.indexOf(ME.id) + 1) % 2] : null;
    paintTourRoom(); renderTourBoard(); renderTourBracket();
    var rchip = $('mpx-tour-chip'); if (rchip) { rchip.setAttribute('data-state', 'live'); rchip.textContent = tour.alive.length === 2 ? 'THE FINAL' : 'ROUND ' + p.n; }
    screen.classList.add('active'); activeNow = true; step('tour');   // pull everyone back from results/winner views
    if (myPair) {
      oppMeta = tourSeat(tour.rival);
      banner('mpx-tour-msg', 'ROUND ' + p.n + ' — you vs ' + tourName(tour.rival) + '. Launching…');
      // round-token guard: onSongEnd registrations are one-shot but only consumed when a song
      // ENDS — a leftover registration from an aborted round must not bank a bogus final later.
      var tok = tour.id + ':' + p.n;
      window.RhythmGame.onSongEnd(function (reason, results) {
        if (!tour.id || tok !== tour.id + ':' + tour.round || !tour.meIn) return;
        onTourSongEnd(reason, results);
      });
      sel = Object.assign({}, tour.sel);   // resolveAndStart reads module `sel.difficulty`; matchCh is null mid-bracket so no 1v1 collision
      resolveAndStart(tour.sel, p.atMs);
      var delay = Math.max(0, p.atMs - Date.now());
      setTimeout(function () { mountOppPanel(); startTourTick(); }, delay + 80);
    } else if (tour.byes.indexOf(ME.id) >= 0) {
      banner('mpx-tour-msg', 'BYE this round — you auto-advance. Watch the board.');
    } else if (tour.alive.indexOf(ME.id) < 0 && tour.round > 1) {
      banner('mpx-tour-msg', 'Eliminated — but the bracket rolls on. Watch it live.');
    }
  }

  // ---- live ticks (duelists broadcast ~3/s; everyone paints the board) ----
  function startTourTick() {
    stopTourTick();
    function frame() {
      _tourRaf = requestAnimationFrame(frame);
      var now = performance.now();
      var stt = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;
      if (stt && tour.ch && tour.meIn && now - _tourLastSend > 350) {
        _tourLastSend = now;
        tour.ch.send({ type: 'broadcast', event: 't-tick', payload: { id: ME.id, score: stt.score, combo: stt.combo, prog: stt.progress } });
      }
      if (oppPanel && oppPanel.parentNode) renderOpp(stt);
    }
    _tourRaf = requestAnimationFrame(frame);
  }
  function stopTourTick() { if (_tourRaf) cancelAnimationFrame(_tourRaf); _tourRaf = 0; }
  function onTourTick(p) {
    if (!p || !p.id) return;
    if (p.id === tour.rival) lastOppTick = p;
    updateBoardScore(p.id, p.score);
  }

  // ---- finals + host settlement ----
  function onTourSongEnd(reason, results) {
    stopTourTick(); unmountOppPanel();
    var s = results
      ? { score: results.score, acc: Math.round((results.accuracy || 0) * 1000) / 10, combo: results.max_combo, grade: results.grade }
      : (window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : { score: 0, acc: 0, combo: 0 });
    try { tour.ch.send({ type: 'broadcast', event: 't-final', payload: { id: ME.id, score: s.score, acc: s.acc, combo: s.combo, grade: s.grade } }); } catch (e) {}
    // come straight back to the bracket board (skip lingering on the solo results screen)
    screen.classList.add('active'); activeNow = true; step('tour');
    banner('mpx-tour-msg', 'Run banked — waiting on the rest of the bracket…');
  }
  function onTourFinal(p) {
    if (!p || !p.id) return;
    if (tour.finals[p.id]) return;   // first report wins; a forfeit stub or settled pair never flips late
    tour.finals[p.id] = p;
    updateBoardScore(p.id, p.score, true);
    if (!tour.isHost) return;
    tour.pairs.forEach(function (pr, i) {
      if (pr.indexOf(p.id) >= 0 && tour.settled[i] == null) {
        // 45s lag window after the FIRST final of a pair: same track ends near-simultaneously,
        // but a slow decode on one side can stretch the gap — then absent = forfeit.
        if (!tour._settleT[i]) tour._settleT[i] = setTimeout(function () { trySettlePair(i, true); }, 45000);
        trySettlePair(i);
      }
    });
  }
  function trySettlePair(i, force) {
    if (!tour.isHost || tour.settled[i] != null) return;
    var pr = tour.pairs[i]; if (!pr) return;
    var fa = tour.finals[pr[0]], fb = tour.finals[pr[1]];
    if (!force && (!fa || !fb)) return;
    fa = fa || { id: pr[0], score: -1, acc: 0 }; fb = fb || { id: pr[1], score: -1, acc: 0 };
    var win;
    if (fa.score !== fb.score) win = fa.score > fb.score ? pr[0] : pr[1];
    else if ((fa.acc || 0) !== (fb.acc || 0)) win = (fa.acc || 0) > (fb.acc || 0) ? pr[0] : pr[1];
    else win = pr[0] < pr[1] ? pr[0] : pr[1];
    tour.settled[i] = win;
    if (tour._settleT[i]) { clearTimeout(tour._settleT[i]); delete tour._settleT[i]; }
    if (Object.keys(tour.settled).length === tour.pairs.length) hostFinishRound();
  }
  function hostFinishRound() {
    var winners = tour.pairs.map(function (pr, i) { return tour.settled[i]; }).concat(tour.byes);
    var detail = tour.pairs.map(function (pr, i) {
      var fa = tour.finals[pr[0]] || { score: -1 }, fb = tour.finals[pr[1]] || { score: -1 };
      return { a: pr[0], b: pr[1], as: fa.score, bs: fb.score, win: tour.settled[i] };
    });
    tour.ch.send({ type: 'broadcast', event: 't-result', payload: { n: tour.round, winners: winners, detail: detail, byes: tour.byes } });
    if (winners.length === 1) {
      setTimeout(function () { try { tour.ch.send({ type: 'broadcast', event: 't-champ', payload: { id: winners[0], name: tourName(winners[0]) } }); } catch (e) {} }, 2400);
    } else {
      var nextSel = hostNextTrack(), nextN = tour.round + 1;
      setTimeout(function () { try { hostBeginRound(nextN, winners, nextSel); } catch (e) {} }, 7000);
    }
  }

  // ---- uniform result / champion handlers ----
  function onTourResult(p) {
    if (!p) return;
    tour.history.push(p);
    renderTourBoard(p); renderTourBracket();
    screen.classList.add('active'); activeNow = true; step('tour');
    var survived = p.winners.indexOf(ME.id) >= 0;
    if (tour.meIn && !survived) banner('mpx-tour-msg', 'Eliminated in round ' + p.n + '. Stick around — the bracket rolls on.');
    else if (survived && p.winners.length > 1) banner('mpx-tour-msg', 'You advance! Next round starts in a moment…');
    var chip = $('mpx-tour-chip'); if (chip) { chip.setAttribute('data-state', 'live'); chip.textContent = 'ROUND ' + p.n + ' DONE'; }
  }
  function onTourChamp(p) {
    if (!p) return;
    tour.state = 'done'; tour.champ = p.id;
    stopTourTick(); unmountOppPanel();
    if (tour.isHost) advertiseTour();
    screen.classList.add('active'); activeNow = true; step('tour');
    var live = $('mpx-tour-live'); if (live) live.hidden = false;
    var box = $('mpx-tour-champ'); if (box) { box.hidden = false; box.classList.toggle('you', p.id === ME.id); }
    set('mpx-tour-champ-name', p.id === ME.id ? 'YOU' : tourName(p.id));
    set('mpx-tour-champ-sub', p.id === ME.id ? 'YOU ARE THE BRACKET CHAMPION' : 'BRACKET CHAMPION');
    var chip = $('mpx-tour-chip'); if (chip) { chip.setAttribute('data-state', 'done'); chip.textContent = 'CHAMPION'; }
    banner('mpx-tour-msg', '');
    renderTourBracket();
    paintTourRoom();
  }

  // ---- tournament UI ----
  function enterTourRoom() {
    step('tour');
    set('mpx-tour-name', (tour.name || 'TOURNAMENT').toUpperCase());
    var chip = $('mpx-tour-chip'); if (chip) { chip.setAttribute('data-state', 'open'); chip.textContent = 'FILLING'; }
    var live = $('mpx-tour-live'); if (live) live.hidden = true;
    var champ = $('mpx-tour-champ'); if (champ) champ.hidden = true;
    var setup = $('mpx-tour-setup'); if (setup) setup.hidden = false;
    var roll = $('mpx-tour-roll'); if (roll) roll.hidden = !tour.isHost;
    var st = $('mpx-tour-start'); if (st) st.hidden = !tour.isHost;
    var diff = $('mpx-tdiff'); if (diff) [].forEach.call(diff.children, function (b) { b.disabled = !tour.isHost; });
    banner('mpx-tour-msg', '');
    paintTourRoom();
  }
  function paintTourRoom() {
    if (!tour.id) return;
    var grid = $('mpx-tour-grid');
    if (grid) {
      var ids = Object.keys(tour.members);
      var html = ids.map(function (id) {
        var m = tour.members[id];
        var out = tour.state === 'live' && tour.alive.length && tour.alive.indexOf(id) < 0;
        var av = m.avatar
          ? '<span class="ts-av" style="background-image:url(&quot;' + esc(safeUrl(m.avatar)) + '&quot;)">' : '<span class="ts-av">' + esc(initial(m.name));
        av += (id === tour.hostId ? '<span class="ts-crown">♛</span>' : '') + '</span>';
        return '<div class="mpx-tour-seat' + (id === ME.id ? ' me' : '') + (out ? ' out' : '') + '">' + av +
          '<span class="ts-n">' + esc((m.name || 'Player').slice(0, 12)) + '</span></div>';
      });
      for (var k = ids.length; k < TOUR_MAX; k++) html.push('<div class="mpx-tour-seat empty"><span class="ts-av">·</span><span class="ts-n">open</span></div>');
      grid.innerHTML = html.join('');
    }
    var t = $('mpx-tour-t'), a = $('mpx-tour-a'), art = $('mpx-tour-art');
    if (t) t.textContent = tour.sel ? tour.sel.title : 'Rolling a track…';
    if (a) a.textContent = tour.sel ? (tour.sel.artist || '—') : '—';
    if (art) {
      if (tour.sel && tour.sel.art) { art.style.backgroundImage = 'url("' + safeUrl(tour.sel.art) + '")'; art.textContent = ''; }
      else { art.style.backgroundImage = ''; art.textContent = '♪'; }
    }
    var n = Object.keys(tour.members).length;
    var st = $('mpx-tour-start');
    if (st && tour.isHost) {
      var ok = tour.state === 'open' && n >= TOUR_MIN && !!tour.sel;
      st.disabled = !ok;
      st.textContent = 'START BRACKET (' + n + '/' + TOUR_MAX + ')';
    }
    var msg = $('mpx-tour-state');
    if (msg) {
      if (tour.state !== 'open') msg.textContent = '';
      else if (n < TOUR_MIN) msg.textContent = 'Need ' + (TOUR_MIN - n) + ' more to start — best with 5–10. Share the lobby!';
      else msg.textContent = tour.isHost ? (n + ' in. Start when the table feels full (5–10 is the sweet spot).') : 'Waiting for the host to start the bracket…';
    }
    if (tour.state === 'live') {
      var setup = $('mpx-tour-setup'); if (setup) setup.hidden = true;
      var live = $('mpx-tour-live'); if (live) live.hidden = false;
      var chip = $('mpx-tour-chip');
      if (chip && tour.state === 'live' && (!chip.textContent || chip.getAttribute('data-state') === 'open')) { chip.setAttribute('data-state', 'live'); chip.textContent = 'LIVE'; }
      var rd = $('mpx-tour-round');
      if (rd) {
        var duels = tour.pairs.length;
        rd.textContent = (tour.alive.length === 2 ? 'THE FINAL' : 'ROUND ' + tour.round) + ' — ' + duels + (duels === 1 ? ' DUEL' : ' DUELS') + ' · ' + (tour.sel ? tour.sel.title : '');
      }
    }
  }
  function renderTourBoard(result) {
    var box = $('mpx-tour-board'); if (!box) return;
    var html = tour.pairs.map(function (pr, i) {
      var win = result ? (result.detail[i] && result.detail[i].win) : tour.settled[i];
      var fa = tour.finals[pr[0]], fb = tour.finals[pr[1]];
      var clsA = win ? (win === pr[0] ? 'winner' : 'loser') : '', clsB = win ? (win === pr[1] ? 'winner' : 'loser') : '';
      return '<div class="mpx-tour-duel' + (pr.indexOf(ME.id) >= 0 ? ' mine' : '') + '" data-pair="' + i + '">' +
        '<span class="td-n ' + clsA + '">' + esc(tourName(pr[0])) + '</span>' +
        '<span class="td-s ' + clsA + '" data-sc="' + esc(pr[0]) + '">' + scoreTxt(fa) + '</span>' +
        '<span class="td-vs">VS</span>' +
        '<span class="td-s ' + clsB + '" data-sc="' + esc(pr[1]) + '">' + scoreTxt(fb) + '</span>' +
        '<span class="td-n r ' + clsB + '">' + esc(tourName(pr[1])) + '</span></div>';
    });
    tour.byes.forEach(function (id) {
      html.push('<div class="mpx-tour-duel bye"><span class="td-n">' + esc(tourName(id)) + '</span><span class="td-bye">BYE · AUTO-ADVANCE</span></div>');
    });
    box.innerHTML = html.join('');
  }
  function scoreTxt(f) { return f ? (f.score < 0 ? 'FORFEIT' : Number(f.score || 0).toLocaleString()) : '0'; }
  function updateBoardScore(id, score, isFinal) {
    var el = screen.querySelector('[data-sc="' + id + '"]');
    if (el) el.textContent = (score < 0 ? 'FORFEIT' : Number(score || 0).toLocaleString()) + (isFinal ? ' ✓' : '');
  }
  function renderTourBracket() {
    var box = $('mpx-tour-bracket'); if (!box) return;
    var cols = tour.history.map(function (h) {
      var cells = h.detail.map(function (d) {
        return '<div class="mpx-tour-bcell w">' + esc(tourName(d.win)) + ' <span style="opacity:.6">def.</span> ' + esc(tourName(d.win === d.a ? d.b : d.a)) + '</div>';
      }).concat((h.byes || []).map(function (id) { return '<div class="mpx-tour-bcell">' + esc(tourName(id)) + ' · bye</div>'; }));
      return '<div class="mpx-tour-bcol"><div class="bc-h">ROUND ' + h.n + '</div>' + cells.join('') + '</div>';
    });
    if (tour.champ) cols.push('<div class="mpx-tour-bcol"><div class="bc-h">CHAMPION</div><div class="mpx-tour-bcell w">👑 ' + esc(tourName(tour.champ)) + '</div></div>');
    box.innerHTML = cols.join('');
    box.scrollLeft = box.scrollWidth;
  }

  // ---- tournament directory (lobby cards) ----
  function onTourMeta(p) {
    if (!p || !p.tid) return;
    if (p.hostId === ME.id) return;
    toursDir[p.tid] = p; toursDir[p.tid].at = Date.now();
    renderRooms(); updateBrowseCount();
  }
  function reconcileToursFromPresence() {
    Object.keys(toursDir).forEach(function (tid) {
      var hid = toursDir[tid].hostId;
      if (!lobby[hid] || lobby[hid].hostTourn !== tid) {
        if (Date.now() - (toursDir[tid].at || 0) > 4000) { delete toursDir[tid]; }
      }
    });
  }
  function leaveTourBtn() {
    if (tour.state === 'live' && tour.meIn && !tour.isHost) {
      // leaving mid-bracket = forfeit; presence-leave on the channel handles it host-side
      closeTour();
      return;
    }
    closeTour();
  }

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
  // build8: lobby action bar
  wire('mpx-act-quick', 'click', toggleQuickMatch);
  wire('mpx-act-open', 'click', function () { gotoRooms('create'); });
  wire('mpx-act-browse', 'click', function () { gotoRooms('browse'); });
  // build8: rooms step
  wire('mpx-rooms-refresh', 'click', function () { try { if (lobbyCh) lobbyCh.send({ type: 'broadcast', event: 'room-ping', payload: { from: ME.id } }); } catch (e) {} renderRooms(); });
  wire('mpx-rooms-back', 'click', function () { step('lobby'); onLobbySync(); });
  wire('mpx-room-create-go', 'click', function () {
    var cr = $('mpx-rooms-create');
    if (cr && cr.getAttribute('data-mode') === 'tour') openTour(); else openRoom();   // build9
  });
  wire('mpx-room-create-cancel', 'click', function () { step('lobby'); onLobbySync(); });
  wire('mpx-room-priv', 'click', function (e) { var b = e.target.closest('button'); if (!b) return; [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); }); });
  // build8: room context (inside setup) — host closes / guest leaves
  wire('mpx-room-close', 'click', function () { if (room.isHost) closeRoom(); else { leaveRoomChannel(); room = { id: null, name: null, priv: false, isHost: false, ch: null, seat: null, members: {}, p1: null, p2: null }; spectating = false; reannounce(); backToLobby(); } });
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
  // build9: tournament controls
  wire('mpx-act-tour', 'click', function () { gotoRooms('tour-create'); });
  wire('mpx-tour-roll', 'click', rollTrack);
  wire('mpx-tour-start', 'click', startTour);
  wire('mpx-tour-leave', 'click', leaveTourBtn);
  wire('mpx-tdiff', 'click', function (e) {
    var b = e.target.closest('button'); if (!b || !tour.isHost || tour.state !== 'open') return;
    [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
    if (tour.sel) { tour.sel.difficulty = b.getAttribute('data-diff'); try { tour.ch.send({ type: 'broadcast', event: 't-track', payload: { sel: tour.sel } }); } catch (err) {} }
  });
  // build9: keyboard polish — Enter advances the obvious primary action on the MP screen
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !screen.classList.contains('active')) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'button') return;
    var card = screen.querySelector('.mp-card'), stepName = card && card.getAttribute('data-mp-step');
    if (stepName === 'tour') { var st = $('mpx-tour-start'); if (st && !st.hidden && !st.disabled) { e.preventDefault(); startTour(); } }
    else if (stepName === 'setup') { var rb = $('mpx-ready'); if (rb && !rb.disabled) { e.preventDefault(); toggleReady(); } }
    else if (stepName === 'winner') { var rm = $('mpx-rematch'); if (rm) { e.preventDefault(); rm.click(); } }
  });

  // The hub's #mp-back / Esc already route to RhythmHub.show(). During a LIVE match the
  // active screen is #game (engine), so they can't fire mid-song. We additionally guard
  // #mp-back so leaving from a WINNER/SETUP step tears the match channel down cleanly.
  wire('mp-back', 'click', function () { try { closeTour(true); teardownMatch(); if (lobbySP) lobbySP.stop(); if (lobbyCh) supa.removeChannel(lobbyCh); } catch (e) {} lobbyCh = null; lobbySP = null; lobby = {}; });

  // clean up presence if the tab closes
  window.addEventListener('beforeunload', function () { try {
    if (room.id && room.isHost && lobbyCh) lobbyCh.send({ type: 'broadcast', event: 'room-gone', payload: { rid: room.id } });
    if (tour.id && tour.isHost && lobbyCh) lobbyCh.send({ type: 'broadcast', event: 'tour-gone', payload: { tid: tour.id } });
    if (roomSP) roomSP.stop(); if (tourSP) tourSP.stop(); if (matchSP) matchSP.stop(); if (lobbySP) lobbySP.stop();
  } catch (e) {} });

  // Detect activation of #multiplayer-screen (hub adds/removes .active). On show → join
  // the lobby; on hide (and not mid-match) → drop the lobby presence.
  function syncActive() {
    var nowActive = screen.classList.contains('active');
    if (nowActive && !activeNow) { activeNow = true; onActivated(); }
    else if (!nowActive && activeNow) { activeNow = false; if (!matchLive && !matchCh && !tour.id) { try { if (lobbySP) lobbySP.stop(); if (lobbyCh) supa.removeChannel(lobbyCh); } catch (e) {} lobbyCh = null; lobbySP = null; lobby = {}; } }
  }
  try {
    var mo = new MutationObserver(syncActive);
    mo.observe(screen, { attributes: true, attributeFilter: ['class'] });
  } catch (e) {}
  if (screen.classList.contains('active')) { activeNow = true; onActivated(); }

  // public hook
  window.RhythmMP = { open: open, close: leaveAll, isLive: function () { return matchLive || tour.state === 'live'; } };
  // DEV HOOK (strip at content-freeze with the other __rr hooks): drive/inspect the bracket headlessly
  window.RhythmMP.__tour = {
    state: function () { return tour; },
    dir: function () { return toursDir; },
    send: function (event, payload) { if (tour.ch) tour.ch.send({ type: 'broadcast', event: event, payload: payload }); },
    open: openTour, join: joinTour, start: startTour, roll: rollTrack
  };
})();
