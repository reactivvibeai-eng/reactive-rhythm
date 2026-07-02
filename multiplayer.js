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
      // build50: reuse the ONE shared client (created by catalog.js or here, whichever runs first) — no double GoTrue.
      supa = window.__rrSupa || (window.__rrSupa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
        auth: { storage: window.localStorage, persistSession: true, autoRefreshToken: true },
      }));
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
  // build64 FIX: the picker (track / stage / difficulty) must be enabled for whoever OWNS the selection — the match-channel
  // host OR the ROOM host. room.isHost is true the instant you open a room, long before matchRole flips to 'host' (which only
  // happens when a match channel opens). The old gates checked only matchRole==='host', so a room host (matchRole still null)
  // was treated as a guest and couldn't pick the track/stage/difficulty in the waiting room. amPicker() fixes every gate.
  function amPicker() { return matchRole === 'host' || !!(room && room.id && room.isHost); }
  var oppMeta = null;             // {id,name,avatar}
  var oppPresent = false, oppLeft = false;
  var sel = { trackId: null, title: null, artist: null, art: null, difficulty: 'medium', demo: false, env: '__default' };   // v262: env = the room's chosen STAGE/level (host picks; rides the song payload; applied on match start). __default = plain Arena.
  var meReady = false, oppReady = false;
  var matchLive = false, finishedLocal = false;
  var myFinal = null, oppFinal = null;
  var lastOppTick = null;
  var lastOppState = null;        // versus P2: latest opponent render frame (ghost deck source)
  var _lastStateSend = 0, _vsActive = false;   // _vsActive: gate the high-rate 'state' stream (P4 turns it on)
  var _vsMode = false;            // versus P3: split-screen HUD is mounted/active for this match
  var VS_LEADIN_MS = 10000;       // build100t (owner): ~10s 1v1 lead-in (was 3.6s — too short to get set). Wall-clock synced via atMs; the longer window also buffers slower machines.
  var TOUR_LEADIN_MS = 10000;     // build100t: ~10s tournament lead-in (host-adjustable via the lead-in control)
  var _countdownRaf = 0;          // the 1v1 lead-in 3·2·1·GO! loop (off shared atMs)
  var _tourCdRaf = 0, _verdictT = 0;   // the tournament cinematic-countdown loop (own rAF so it can't cancel the 1v1 one) + verdict auto-hide timer
  var _mountT = 0;                // deferred split-screen mount timer (beginMatch/onTourRound) — cleared on teardown so a mid-lead-in abort can't resurrect vs-mode
  var _settleSafetyT = 0;         // v258: the 8s "opponent never reported" settle safety-timer (stored so settle/teardown/rematch can cancel a stale fire)
  var _startWatchdog = 0;         // "did the round actually start?" watchdog — fail loud + recover instead of hanging silently
  var _botRampT = 0;              // dev: drives bot scores UP over the round so a spectator can watch the race (not instant)
  var oppPanel = null, oppRaf = 0, _lastSend = 0;
  var pendingOut = null;          // {toId,mid} a challenge I sent, awaiting answer
  var _chalT = null;              // build58: challenge-timeout — a crashed/ignoring opponent must not leave a permanent "WAITING…"
  var incoming = {};              // id -> {mid} (challenges TO me)
  var activeNow = false;          // is #multiplayer-screen currently .active
  // ---- v254: P-vs-P COMBAT state (the MP ranked-record model lives just below the helpers) ----
  var combatOn = false;           // local toggle: P-vs-P combat (your combos SHOCK the rival ~2.2s) vs P-vs-E (pure score race)
  try { combatOn = localStorage.getItem('rr_mp_combat') === '1'; } catch (e) {}
  var matchCombat = false;        // EFFECTIVE combat mode for the live match (the host decides; broadcast in `start`)
  var _lastShockCombo = 0;        // highest combo milestone that fired a shock this streak (reset to 0 on a combo break)
  var _lastOdActive = false;      // build100r: OD rising-edge tracker — activating Overdrive ("boost") fires a shock too
  var SHOCK_COMBO_STEP = 15;      // build100r: combo milestones that SHOCK the rival. Was 30 — unreachable in a casual playtest (max combo ~10), so the rival was literally never zapped. 15 + the OD trigger make combat actually land.
  var _rankRecorded = false;      // guard: record each settled result exactly once (CPU warm-ups never record — oppMeta.bot)
  // build100i: server-authoritative round (Lovable /mp/round/{start,settle}). HOST opens a round at match start + gets a
  // uuid, broadcasts it ('round' event); both peers pass that uuid to /mp/round/settle at song end. All fail-open — the
  // in-match verdict stays peer-broadcast, so a missing endpoint never affects play.
  var _serverRoundId = null;      // the server round uuid for the live round (from /mp/round/start)
  var _roundSeq = 0;              // client round nonce counter → distinct (room_id, round_id) per rematch
  var _roundStartFired = false;   // guard: HOST opens each round's server round exactly once
  // ---- build8: rooms + quick-match state ----
  var room = { id: null, name: null, priv: false, combat: false, isHost: false, ch: null, seat: null,
               members: {}, p1: null, p2: null,
               show: false, submitterId: null, submitterName: '', revToken: null, invited: false, pendingChal: null, declined: {} };   // current room (host or joined/spectating). build69: combat = the host's per-room modifier (set at openRoom, advertised, adopted by joiners). build102s: LIVE-SHOW fields — normal MP never sets `show`, so every Phase-2 gate below is dead code outside a show room. revToken NEVER rides any broadcast/persist.
  var roomsDir = {};              // rid -> {rid,name,priv,hostId,hostName,count,max,at} (browser directory)
  var QM = { looking: false, t: 0 };   // quick-match: am I in the queue?
  var spectating = false;         // joined a match purely as a watcher
  var _specFocus = null;          // build96 (playtest): in a tournament SPECTATOR view, the player id whose LIVE deck you're watching — defaults to the leader; cycle with WATCH NEXT
  var _fromRoom = null;           // build8: one-shot carry across room→match handoff
  // ---- build102s: LIVE SHOW (Phase-2 C1) — a host review track played as a live match. Every behavior
  // keyed on room.show / sel.audioUrl so normal MP (rooms, quick match, tournaments, couch) stays byte-identical.
  var _pendingShowRoom = null;    // openShowRoom() spec awaiting the lobby (consumed on SUBSCRIBED or the 600ms fast-path)
  var _lastShowSpec = null;       // last GO LIVE spec — the solo-always-works fallback re-opens the review card from it
  var _showOpenT = 0;             // ~8s watchdog: lobby/room channel never SUBSCRIBED → banner + re-show the review card (owner: solo PLAY must always stay reachable)
  var _showHbT = 0;               // 4s 'show-snap' heartbeat handle (host only; mirrors the t-snapshot pattern)
  var _showAtMs = 0;              // the live run's shared start timestamp (rides show-snap so late arrivals can align)
  var _soloRun = false;           // SNAPSHOT taken at beginMatch: was this a SOLO show run? (security judge BLOCKER: the
                                  // settle/rank gates key on this snapshot, never live room.p2 — a mid-run seat can't flip a
                                  // solo run into a ranked forfeit-W or a phantom YOU-WIN)
  var _specShowSolo = false;      // spectating a SOLO show run → no verdict card; back to the waiting room on 'final'
  var _specShow = false;          // snapshot at spectateMatch entry: is this a SHOW-room spectate? (normal spectate keeps the pre-diff card byte-identical)
  var _specFinals = {}, _specVerdictT = 0;   // show spectate: BOTH finals collected (keyed id||name) before the neutral verdict names the higher score
  var _inviteBusy = false, _inviteAt = 0, _inviteRenotified = false;   // CALL IN THE ARTIST button state (60s NUDGE re-arm)
  // ---- build102t (Phase-2 C2): SPECTATOR DUAL-DECK state — all dead unless a SHOW spectate mounts ----
  var _specStage = null;          // stage overlay root (JS-created DOM; absent from the page unless watching a show)
  var _specGen = 0;               // build102u (review fix 3): mount GENERATION — stale chartUrl resolves/rejects + the 4s verdict timer check it so a leftover async callback can never poison/kill a NEWER stage
  var _specFedReal = false;       // build102u (review fix 2b): flips true on the first REAL tick/state — after that the show-snap live:true vouch stops feeding liveness (a frozen host must trip the 12s recovery)
  var _specChart = null;          // { notes, duration, buffer } from RhythmGame.chartUrl — the players' chart rebuilt locally
  var _specDp = null;             // spectator audio (engine DemoPlayer, offset-started; obeys global mute + music volume)
  var _specAtMs = 0;              // the live run's shared start (from the match 'start' broadcast or the show-snap)
  var _specRaf = 0, _specGainT = 0, _specIdx = 0;
  var _specStates = {}, _specTicks = {};   // player-id → latest id-tagged 'state' / 'tick' payload
  var _specIds = { p1: null, p2: null };   // deck seat assignment (host left, challenger right)
  var _specSolo = false;          // solo run → one centered deck
  var _specLastFeedAt = 0;        // liveness (judge): ~12s with no tick/state while decks are mounted ⇒ the run died silently
  var _specDecks = null;          // per-deck render state (ctx + flash/sparkle pools — two independent pools, couch.js pattern)
  var _specNCache = 0;            // show-room watcher count (drives the host's state-interval degrade rule + the 10+ chip)
  // ---- build9: tournament state (5–10 player single-elim bracket on ONE channel) ----
  var TOUR_MAX = 10, TOUR_MIN = 3;          // copy advertises 5–10; 3 makes a real bracket testable
  // build42: the BEFORE-PUBLIC gate. Keep FALSE until server-authoritative scoring (re-judge) is live — see
  // MP_SERVER_SCORING_BRIEF.md. While false, brackets are friends/solo only and no MP result is marked "ranked".
  var MP_PUBLIC = true;   // build100k LAUNCH: MP public (mirror of index.html). Needs Supabase Realtime enabled on the project to sync.
  var tour = nullTour();
  var toursDir = {};                         // tid -> {tid,name,hostId,hostName,count,max,state,at}
  var _tourRaf = 0, _tourLastSend = 0;
  // ---- DEV NPC harness (solo + stress test; on the strip-before-launch list) ----
  // build58: keep in sync with index.html's MP_DEV — the BUILDER (localhost or ?dev=1) gets the full MP + the solo test harness.
  var MP_DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);   // build65 SECURITY (cycle-3 P0): LOCALHOST-only. The old `?dev=1 OR localhost` let /play?dev=1 trip the MP dev harness + bypass the MP_PUBLIC gate in production. Keep in sync with index.html's MP_DEV.
  var _devBots = {}, _devAuto = false, _devSpectate = false, _devN = 0, _awaitAutoT = 0;
  var BOT_NAMES = ['Riff', 'Vex', 'Shred', 'Nova', 'Kai', 'Zed', 'Echo', 'Lux', 'Jinx', 'Onyx', 'Pyre', 'Mara', 'Drift', 'Crash', 'Bolt', 'Ora'];
  function nullTour() {
    return { id: null, name: null, isHost: false, hostId: null, ch: null, members: {}, state: 'open',
      round: 0, alive: [], pairs: [], byes: [], sel: null, finals: {}, settled: {}, _settleT: {},
      rival: null, meIn: false, history: [], champ: null, awaiting: false, _next: null,
      size: 8, envPool: ['__random'], envName: 'Random',
      combat: false, songPool: [],   // build100q: #172 per-tournament combat (host-set, snapshot-replicated); #173 host-curated per-round song list (empty = legacy random)
      version: 0, _joinAt: 0, _alive: {}, _awaitWinners: null, env: null, atMs: 0,
      stakes: 'free', buyIn: 0, currency: 'bonus', potId: null, paid: {}, bets: {}, pot: 0,   // build66: WAGER — host-run prize pool. stakes: free|pool|sidebet; paid: id->{at,idemKey} (HOST-verified roster); pot mirrors the escrow for display. Real cashable Sparks stay OFF (currency locked to 'bonus' client-side; see RhythmWager swap-seam).
      _lastSnapV: -1, _snapHost: null, _roundTok: null, _hostHold: false };   // build58: snapshot-version FLOOR lives per-bracket (was a session-global that starved the 2nd tournament + rejected a promoted host's low-versioned snapshots); _roundTok = per-emission round nonce. build61: _hostHold = streamer pause of the auto-advance timers (host-only; a promoted heir starts un-held)
  }
  var _pendingTourJoin = null;   // build11: ?mpjoin=<tid> deep link — join once the lobby is up
  try { var _mj = location.search.match(/[?&]mpjoin=(t[a-z0-9]+)/); if (_mj) _pendingTourJoin = _mj[1]; } catch (e) {}
  var _pendingRoomJoin = null;   // build60: ?mproom=<rid> deep link — join the friend's room once the lobby is up
  try { var _mr = location.search.match(/[?&]mproom=([a-z0-9]+)/i); if (_mr) _pendingRoomJoin = _mr[1]; } catch (e) {}
  // build102 (Phase-2 judge blocker): &spectate=1 riding ?mproom= = join as a WATCHER — without this, a public
  // spectate link would take the CHALLENGER seat (first fan to click steals the artist's spot in a live-show room).
  var _pendingRoomSpec = false;
  try { _pendingRoomSpec = /[?&]spectate=1\b/.test(location.search); } catch (e) {}

  // ===================== SOFT PRESENCE (build9 foundation fix) =====================
  // VERIFIED against the live project: Realtime BROADCAST round-trips fine, but native
  // PRESENCE never syncs (track() acks "ok", zero presence_state/sync events — project-side).
  // So every "who's here" surface rides this broadcast-heartbeat layer instead:
  //   hb {meta} every 10s + instant hello-back when a newcomer appears + bye on leave +
  //   75s expiry sweep for crashes. Deterministic, project-independent, ≤10 peers/channel.
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
  // ---- v254: MP RANKED LADDER (local-first; SWAP-SEAM for a future server ladder) ----
  // 1v1 quick-match / challenge / room results record here on settle. Points: win +25, draw +8, loss -12 (floored 0); a
  // FORFEIT win (rival left) counts in the W column but awards 0 points (so leaving can't farm rank). CPU warm-ups never
  // record (oppMeta.bot). Rank tier is derived from points. The leaderboard MULTIPLAYER tab + the lobby rank chip read
  // getRank(). NOTE: like all peer-broadcast MP scoring here, the result is client-trusted — a real competitive ladder
  // needs server adjudication (same gate as MP_PUBLIC). This is the honest local record + UX; the seam is server-ready.
  var MP_RANK_TIERS = [
    { n: 'UNRANKED',  min: -1,   c: '#8a7f7c' },
    { n: 'BRONZE',    min: 1,    c: '#c8854f' },
    { n: 'SILVER',    min: 150,  c: '#c9c4bf' },
    { n: 'GOLD',      min: 350,  c: '#e0a93f' },
    { n: 'CRIMSON',   min: 600,  c: '#ff4a52' },
    { n: 'INFERNO',   min: 950,  c: '#ff7a4a' },
    { n: 'ASCENDANT', min: 1400, c: '#fff2cd' }
  ];
  function mpRankLoad() {
    try { var r = JSON.parse(localStorage.getItem('rr_mp_rank') || 'null'); if (r && typeof r === 'object') return r; } catch (e) {}
    return { wins: 0, losses: 0, draws: 0, points: 0, streak: 0, best: 0, history: [] };
  }
  function mpRankTier(points) { var t = MP_RANK_TIERS[0]; for (var i = 0; i < MP_RANK_TIERS.length; i++) if (points >= MP_RANK_TIERS[i].min) t = MP_RANK_TIERS[i]; return t; }
  function mpRankNext(points) { for (var i = 0; i < MP_RANK_TIERS.length; i++) if (MP_RANK_TIERS[i].min > points) return MP_RANK_TIERS[i]; return null; }
  function getRank() {
    var r = mpRankLoad(), t = mpRankTier(r.points), nx = mpRankNext(r.points);
    return { wins: r.wins, losses: r.losses, draws: r.draws, points: r.points, streak: r.streak || 0, best: r.best || 0,
      games: r.wins + r.losses + r.draws, winPct: (r.wins + r.losses) ? Math.round(r.wins / (r.wins + r.losses) * 100) : 0,
      tier: t.n, color: t.c, next: nx ? { tier: nx.n, at: nx.min, need: Math.max(0, nx.min - r.points) } : null,
      history: (r.history || []).slice(0, 15) };
  }
  function recordMpResult(result, info) {   // result: 'win' | 'loss' | 'draw'; info: { op, song, my, ops, forfeit }
    var r = mpRankLoad(); info = info || {}; var _beforeTier = mpRankTier(r.points).n;
    if (result === 'win') { r.wins++; if (!info.forfeit) r.points += 25; r.streak = (r.streak > 0 ? r.streak : 0) + 1; }
    else if (result === 'draw') { r.draws++; r.points += 8; r.streak = 0; }
    else { r.losses++; r.points = Math.max(0, r.points - 12); r.streak = (r.streak < 0 ? r.streak : 0) - 1; }
    if (r.points > (r.best || 0)) r.best = r.points;
    if (result === 'win' && mpRankTier(r.points).n !== _beforeTier) { try { window.RhythmGame && window.RhythmGame.playSting && window.RhythmGame.playSting('big'); } catch (e) {} }   // v257: rank-up sting
    r.history = r.history || [];
    r.history.unshift({ result: result, op: String(info.op || '').slice(0, 18), song: String(info.song || '').slice(0, 40), my: info.my || 0, ops: info.ops || 0, ff: !!info.forfeit, at: Date.now() });
    if (r.history.length > 30) r.history.length = 30;
    try { localStorage.setItem('rr_mp_rank', JSON.stringify(r)); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('rr-mp-rank', { detail: getRank() })); } catch (e) {}
    return r;
  }
  var _lastStunAt = 0;
  function onShock(p) {   // v254: a rival's combo milestone zapped you → brief gameplay stun (combat mode, human-only)
    if (!matchLive || !matchCombat || (oppMeta && oppMeta.bot)) return;
    // build65 (cycle-3): RECEIVE-SIDE COOLDOWN — back-to-back shocks (a rival on a hot streak fires every 30 combo) could
    // chain-lock you with no comeback path. Ignore a new shock within 4s of the last. Cosmetic to scoring (it gates input
    // timing, never the score ceiling) → leaderboard-safe. Exact cadence is a feel call; this guard prevents the runaway.
    var now = Date.now();
    if (now - _lastStunAt < 4000) return;
    _lastStunAt = now;
    try { window.RhythmGame.mpStun && window.RhythmGame.mpStun(2.2, (p && p.from) || 'RIVAL'); } catch (e) {}
  }
  // build100q #172: TOURNAMENT combat shock receiver. Rounds flow over tour.ch (matchCh/matchLive are null mid-bracket),
  // so the 1v1 onShock above never fires in a bracket. A t-shock broadcasts to EVERYONE on the channel, so gate strictly:
  // only MY current rival can zap ME (p.to === my id AND p.from === my rival). Same 4s receive-cooldown; cosmetic to scoring.
  function onTourShock(p) {
    if (!p || !matchCombat || spectating) return;
    if (p.to !== ME.id || p.fromId !== tour.rival) return;   // only the player I'm actually dueling can shock me
    var now = Date.now();
    if (now - _lastStunAt < 4000) return;
    _lastStunAt = now;
    try { window.RhythmGame.mpStun && window.RhythmGame.mpStun(2.2, (p && p.from) || 'RIVAL'); } catch (e) {}
  }
  function _reduceMo() { try { var s = window.RhythmGame && window.RhythmGame.getSettings && window.RhythmGame.getSettings(); return !!(s && s.reduceMotion) || document.documentElement.classList.contains('rr-reduce-motion'); } catch (e) { return false; } }
  function _spawnZapBolt() {   // v257: a visible lightning bolt streaking from your deck toward the rival's when YOU land a combat shock
    if (_reduceMo()) return;
    try {
      var host = document.getElementById('game'); if (!host) return;
      var opp = document.getElementById('mp-opp'), hr = host.getBoundingClientRect();
      var tx, ty;
      if (opp) { var orc = opp.getBoundingClientRect(); tx = orc.left + orc.width / 2 - hr.left; ty = orc.top + orc.height / 2 - hr.top; }
      else if (_vsMode) { tx = hr.width * 0.75; ty = hr.height * 0.30; }   // desktop split → the rival half
      else { tx = hr.width - 56; ty = 56; }                                 // fallback → top-right
      var sx = hr.width * 0.5, sy = hr.height * 0.82;                       // from your deck (bottom-center)
      var bolt = document.createElement('div');
      bolt.className = 'mp-zap-bolt'; bolt.textContent = '⚡';
      bolt.style.left = sx + 'px'; bolt.style.top = sy + 'px';
      bolt.style.setProperty('--zx', (tx - sx) + 'px'); bolt.style.setProperty('--zy', (ty - sy) + 'px');
      host.appendChild(bolt);
      setTimeout(function () { try { bolt.parentNode && bolt.parentNode.removeChild(bolt); } catch (e) {} }, 600);
      if (opp) setTimeout(function () { try { opp.classList.add('zapped'); setTimeout(function () { opp.classList.remove('zapped'); }, 480); } catch (e) {} }, 300);   // strike-flash on the rival panel as it lands
    } catch (e) {}
  }
  function paintRankChip() {   // v254: the lobby rank chip (tier · W/L · RP) — reads the local ladder
    var el = $('mpx-rank-chip'); if (!el) return;
    var r = getRank();
    el.style.setProperty('--rk', r.color);
    el.innerHTML = '<span class="rk-tier" style="color:' + r.color + '">' + r.tier + '</span>' +
      '<span class="rk-wl">' + r.wins + 'W&nbsp;·&nbsp;' + r.losses + 'L' + (r.streak >= 2 ? '&nbsp;·&nbsp;🔥' + r.streak : '') + '</span>' +
      '<span class="rk-pts">' + r.points + ' RP</span>';
    el.hidden = false;
  }
  function paintCombatToggle() {   // v254: the P-vs-P / P-vs-E combat toggle in the lobby
    var t = $('mpx-combat-toggle'); if (!t) return;
    t.setAttribute('aria-pressed', combatOn ? 'true' : 'false');
    t.classList.toggle('on', combatOn);
    var lab = t.querySelector('.ct-state'); if (lab) lab.textContent = combatOn ? 'Combat (when I host): On' : 'Combat (when I host): Off';
  }
  function toggleCombat() {
    combatOn = !combatOn;
    try { localStorage.setItem('rr_mp_combat', combatOn ? '1' : '0'); } catch (e) {}
    paintCombatToggle();
    // build69: this is your DEFAULT when YOU host (quick-match) + the prefill for the Room dialog — NOT a lobby-wide switch.
    banner('mpx-lobby-msg', combatOn ? '⚡ Combat default ON — when YOU host a match your combo streaks SHOCK the rival (~2s stun). Set it per room when you open one. Nobody can flip combat for the whole lobby.' : 'Combat default OFF — pure score race when you host. Pick Combat per room when you create one.');
  }
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
    if (name === 'lobby') { try { paintRankChip(); paintCombatToggle(); } catch (e) {} }   // v254: keep the rank chip + combat toggle in sync whenever the lobby shows
    if (name === 'setup') { try { renderStageRow(); } catch (e) {} }   // v262: render the room STAGE picker when the setup step shows
  }
  function banner(id, txt) { var el = $(id); if (!el) return; if (txt) { el.textContent = txt; el.hidden = false; } else { el.hidden = true; el.textContent = ''; } }
  // close any transient full-screen overlay that could occlude a starting round (the first-run How-To at z-260 was
  // covering the whole tournament — root cause of "the round never started").
  function closeTransientOverlays() {
    ['howto-screen', 'store-screen', 'levels-screen', 'profile-screen', 'settings-screen', 'leaderboard-screen'].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.classList.remove('active');
    });
  }

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
    try { paintRankChip(); paintCombatToggle(); } catch (e) {}   // v254: rank chip + combat toggle
    // build60: collapse the friends disclosure on entry, surface the sign-in note, and show the one-time coach card.
    try { toggleFriends(false); refreshSigninNote(); if (!mpSeen()) showCoach(); } catch (e) {}
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
    try { refreshSigninNote(); } catch (e) {}   // build60: hide the sign-in note once identity resolves
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
      try { console.warn('[mp] lobby channel status:', status); } catch (e) {}   // build100n: live diagnostic — SUBSCRIBED = Realtime OK; CHANNEL_ERROR/TIMED_OUT = anon can't reach Realtime (Lovable: confirm anon broadcast authorization)
      if (status === 'SUBSCRIBED') {
        lobbySP.start();
        if (_pendingShowRoom) _consumeShowRoom();   // build102s: GO LIVE was waiting on the lobby — open the show room now
        // build11: invite deep-link — ask hosts to re-advertise, then join the target bracket
        if (_pendingTourJoin) {
          try { lobbyCh.send({ type: 'broadcast', event: 'room-ping', payload: { from: ME.id } }); } catch (e) {}
          banner('mpx-lobby-msg', 'Joining the bracket you were invited to…');
          setTimeout(function () {   // meta never came (host gone or slow) → join the channel directly
            if (_pendingTourJoin && !tour.id) { var tid = _pendingTourJoin; _pendingTourJoin = null; joinTourDirect(tid); }
          }, 5000);
        }
        // build60: room invite deep-link — ask the host to re-advertise; onRoomMeta auto-joins when it lands.
        if (_pendingRoomJoin) {
          try { lobbyCh.send({ type: 'broadcast', event: 'room-ping', payload: { from: ME.id } }); } catch (e) {}
          banner('mpx-lobby-msg', 'Joining the room you were invited to…');
          setTimeout(function () {
            if (_pendingRoomJoin && !room.id) { banner('mpx-lobby-msg', 'That room isn\'t open anymore — hit PLAY NOW, or open your own room.'); _pendingRoomJoin = null; }
          }, 6000);
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        banner('mpx-lobby-msg', 'Could not reach the live lobby (' + status + '). Online multiplayer needs Realtime — retry shortly.');   // build100n: surface the exact status so a Realtime/anon issue is diagnosable
      }
    });
  }
  function setLobbyInMatch(flag) { reannounce(); }

  function onLobbySync() {
    if (!lobbyCh) return;
    // build58: if the player I'm WAITING on has left the lobby (soft-presence dropped them), clear the dead challenge so
    // their row stops showing a permanent "WAITING…" and I can challenge someone else.
    if (pendingOut && !lobby[pendingOut.toId]) { pendingOut = null; if (_chalT) { clearTimeout(_chalT); _chalT = null; } }
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
    roEmpty(ids.length === 0, 'No one online yet — Play Now for a CPU warm-up.');
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
    if (_chalT) clearTimeout(_chalT);   // build58: auto-clear a dead challenge so the lobby never locks on a stuck WAITING…
    _chalT = setTimeout(function () { if (pendingOut && pendingOut.toId === toId) { pendingOut = null; banner('mpx-lobby-msg', 'No response — try another player.'); onLobbySync(); } }, 12000);
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
    if (_chalT) { clearTimeout(_chalT); _chalT = null; }   // build58: answered → cancel the timeout
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
    matchCh.on('broadcast', { event: 'state' }, function (m) { onState(m.payload); });   // versus ghost-deck stream (additive)
    matchCh.on('broadcast', { event: 'final' }, function (m) { onFinal(m.payload); });
    matchCh.on('broadcast', { event: 'round' }, function (m) { if (m && m.payload && m.payload.rid) _serverRoundId = m.payload.rid; });   // build100i: peer adopts the host's server round uuid for /mp/round/settle
    matchCh.on('broadcast', { event: 'rematch' }, function () { resetForRematch(); });
    matchCh.on('broadcast', { event: 'shock' }, function (m) { onShock(m.payload); });   // v254: P-vs-P combat — the rival's combo zapped you
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
    // build102s: scrub stale SHOW chrome when entering a NON-show setup — quick-match/challenge setups never run
    // paintRoomWaiting, so a prior show's banner/seat/START-label/back-label would otherwise linger. This is the
    // ONE authoritative restore point for the show-relabeled shared elements. DELIBERATE minor deviation from
    // strict byte-identity: setReadyBtn() repaints from live meReady, which also fixes a stale 'READY ✓' that
    // pre-diff could linger from a prior session — an owner-visible copy improvement, accepted in review.
    if (!room.show) {
      var _sbn = $('mpx-show-banner'); if (_sbn) _sbn.hidden = true;
      var _sst = $('mpx-show-seat'); if (_sst) _sst.hidden = true;
      var _lsx = $('mpx-leave-setup'); if (_lsx) _lsx.textContent = 'BACK TO LOBBY';
      setReadyBtn();
    }
    // build60: invite bar is room-only — hide it by default (enterRoomWaiting re-shows it); seed a duel waiting line.
    var ib = $('mpx-invitebar'); if (ib) ib.hidden = true;
    var ws = $('mpx-waitstatus');
    if (ws) {
      if (oppPresent) { ws.hidden = true; }
      else { ws.hidden = false; ws.classList.remove('ready'); ws.textContent = 'Waiting for your opponent to join…'; }
    }
    var dot = $('mpx-dot-opp'); if (dot) { dot.setAttribute('data-state', 'waiting'); dot.textContent = oppMeta ? (oppMeta.name || 'OPPONENT').slice(0, 12) : 'WAITING…'; }
    var isHost = amPicker();
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
          // build102s SOLO SHOW START: the host begins with an EMPTY challenger seat — broadcast the real 'start'
          // and beginMatch with NO guest ready-handshake. devVsNpc proves beginMatch runs fine host-only; here the
          // channel is REAL so already-subscribed watchers receive 'start'/'tick'. Combat is locked OFF for shows.
          if (fr.solo && matchRole === 'host' && sel.trackId && matchCh) {
            broadcastSong();
            matchCombat = false;
            var soloAt = Date.now() + VS_LEADIN_MS; _showAtMs = soloAt;
            matchCh.send({ type: 'broadcast', event: 'start', payload: { atMs: soloAt, sel: sel, combat: false } });
            beginMatch(soloAt, sel);
            return;
          }
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
    var oppName = (opp && opp.name) || (oppMeta && oppMeta.name) || 'Your opponent';
    var dot = $('mpx-dot-opp');
    if (oppPresent) {
      if (dot) { dot.setAttribute('data-state', 'here'); dot.textContent = oppName.slice(0, 12); }
      oppLeft = false;
      if (matchRole === 'host' && sel.trackId && !wasPresent) broadcastSong();   // late-join catch-up
      if (!wasPresent) paintWaitStatus(oppName + ' joined — ' + (matchRole === 'host' ? 'pick a track and hit READY.' : 'the host is choosing a track.'));   // build60: announce the arrival
    } else if (wasPresent) {
      oppLeft = true;
      if (dot) { dot.setAttribute('data-state', 'left'); dot.textContent = 'OPPONENT LEFT'; }
      if (matchLive) { markOppGone(); settleIfReady(); }
      else { oppReady = false; banner('mpx-setup-msg', 'Opponent left. Back to lobby to find another.'); paintWaitStatus('Your opponent left — back out to find another.'); }
    } else { if (dot) { dot.setAttribute('data-state', 'waiting'); dot.textContent = 'WAITING…'; } paintWaitStatus('Waiting for your opponent to join…'); }
    refreshReadyEnabled();
  }
  // build60: a single place to drive the explicit, updating waiting-room status line (duels + rooms).
  function paintWaitStatus(txt, isReady) {
    var ws = $('mpx-waitstatus'); if (!ws) return;
    if (txt == null) { ws.hidden = true; return; }
    ws.hidden = false; ws.classList.toggle('ready', !!isReady); ws.textContent = txt;
  }

  // ---- song selection (host) ----
  function broadcastSong() { if (matchCh) matchCh.send({ type: 'broadcast', event: 'song', payload: sel }); else if (room && room.id && room.isHost && room.ch) room.ch.send({ type: 'broadcast', event: 'song', payload: sel }); }
  function onSong(p) {
    if (!p) return;
    sel = p; paintSelection();
    meReady = false; oppReady = false; setReadyBtn(); refreshReadyEnabled();
    var rs = $('mpx-readystate'); if (rs) rs.textContent = amPicker() ? 'Track locked. Hit READY.' : 'Host locked a track. Hit READY when set.';
  }
  // v262: the room STAGE (level/environment) options — Arena + every FINISHED level the player OWNS. No Random in MP (the host
  // must pick a concrete stage so BOTH sides apply the identical backdrop/journey — a per-side random roll would desync).
  function _stageList() {
    try {
      var L = window.RhythmLevels; if (!L || !L.environments) return [];
      var fin = window.RR_FINISHED_LEVELS || {};
      return L.environments().filter(function (e) {
        if (e.isRandom) return false;
        if (e.isDefault) return true;
        if (!fin[e.id]) return false;
        if (e.paid) { try { var rc = window.RhythmCatalog; return !!(rc && rc.ownsItem && rc.ownsItem('level', e.entId || e.id)); } catch (x) { return false; } }   // build100q: entId (underscore entitlement id) — admin/owner/purchaser owns it
        return true;
      });
    } catch (e) { return []; }
  }
  function renderStageRow() {
    var row = $('mpx-stage-row'); if (!row) return;
    var list = _stageList(), host = amPicker(), cur = sel.env || '__default';
    row.innerHTML = '';
    list.forEach(function (e) {
      var b = document.createElement('button'); b.type = 'button';
      b.className = 'mpx-stage-chip' + (cur === e.id ? ' sel' : '');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', cur === e.id ? 'true' : 'false'); b.disabled = !host;
      if (e.accent) b.style.setProperty('--ec', e.accent);
      b.textContent = e.isDefault ? 'Arena' : (e.name || 'Stage');
      b.addEventListener('click', function () { if (!amPicker()) return; sel.env = e.id; broadcastSong(); renderStageRow(); });
      row.appendChild(b);
    });
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
    try { renderStageRow(); } catch (e) {}   // v262: keep the stage picker in sync with the broadcast selection
  }

  // ---- ready check ----
  function refreshReadyEnabled() {
    // build102s: a SHOW-room host can always start (solo run with an empty challenger seat — owner's non-negotiable);
    // normal duels keep the exact oppPresent gate.
    var ok = (oppPresent || (room.show && room.isHost)) && !!sel.trackId;
    var rb = $('mpx-ready'); if (rb) rb.disabled = !ok;
    var rs = $('mpx-readystate'); if (!rs) return;
    if (room.show) {   // build102s: show-room copy (song is locked to the review, host is never blocked)
      rs.textContent = room.isHost ? (room.p2 ? 'Challenger seated — START runs the head-to-head.' : 'START plays it solo — the artist can join between runs.')
                                   : 'The host runs the show — you’re pulled in when the match starts.';
      return;
    }
    if (!sel.trackId) rs.textContent = amPicker() ? 'Pick a track to enable READY.' : 'Waiting for host to pick a track…';
    else if (!oppPresent) rs.textContent = 'Waiting for your opponent…';
  }
  function setReadyBtn() { var b = $('mpx-ready'); if (!b) return; b.classList.toggle('armed', meReady);
    if (room.show && room.isHost) { b.textContent = meReady ? 'STARTING…' : (room.p2 ? '⚔ START VERSUS' : '▶ START (SOLO)'); return; }   // build102s: the show host's button IS the start switch
    b.textContent = meReady ? 'READY ✓' : 'READY'; }
  function toggleReady() {
    var b = $('mpx-ready'); if (!b || b.disabled) return;
    meReady = !meReady; setReadyBtn();
    // build102s: a show-room host readies with NO match channel yet (the room-start path) — guard the send.
    // Normal duels always have matchCh here (the button only enables via onMatchPeers), so this is byte-identical.
    if (matchCh) matchCh.send({ type: 'broadcast', event: 'ready', payload: { ready: meReady, id: ME.id } });
    // build60: reflect my own ready alongside the opponent's so both sides stay legible.
    var oppName = (oppMeta && oppMeta.name) || 'Opponent';
    if (meReady && oppReady) paintWaitStatus('Both ready — starting…', true);
    else if (meReady && !oppReady) paintWaitStatus('You\'re READY — waiting for ' + oppName + '…', true);
    else if (!meReady && oppReady) paintWaitStatus(oppName + ' is READY — tap READY to start.', true);
    else paintWaitStatus(sel.trackId ? 'Tap READY when you\'re set.' : 'Waiting for a track…');
    maybeStart();
  }
  function onReady(p) {
    oppReady = !!(p && p.ready);
    // build60: make the opponent's READY visibly land so the wait never reads as frozen.
    var oppName = (oppMeta && oppMeta.name) || 'Opponent';
    if (oppReady && !meReady) paintWaitStatus(oppName + ' is READY — tap READY to start.', true);
    else if (oppReady && meReady) paintWaitStatus('Both ready — starting…', true);
    else if (!oppReady && sel.trackId) paintWaitStatus('Waiting for ' + oppName + ' to ready up…');
    maybeStart();
  }
  function maybeStart() {
    // build8: in the ROOM WAITING AREA (no match channel yet), the host's start rides the ROOM
    // channel via room-start; both seated players then open the same rr-match-<mid>. Once that
    // match channel exists (matchCh set) — including quick-match, challenge, and the room handoff —
    // we take the original synchronized-start path below.
    // build102s: in a SHOW room the host's meReady ALONE fires the room-start — solo (no p2) or versus (seated
    // challenger; the ready handshake then runs on the real match channel via the _fromRoom handoff). Room-stage
    // oppReady never syncs pre-matchCh, so gating a show on it would deadlock; normal rooms keep the exact old gate.
    if (room.id && room.isHost && !matchCh && meReady && (oppReady || room.show) && sel.trackId) { startRoomMatch(); return; }
    if (meReady && oppReady && sel.trackId && matchRole === 'host' && matchCh) {
      var atMs = Date.now() + VS_LEADIN_MS;          // lead-in so both schedule together (room for a visible 3·2·1)
      if (room.show) _showAtMs = atMs;               // build102s: show-snap carries the shared start for late arrivals
      matchCombat = (room.id && room.isHost) ? !!room.combat : !!combatOn;   // build69: a ROOM match uses the room's FIXED modifier (every match in the room is consistent); quick-match/challenge uses the host's default
      matchCh.send({ type: 'broadcast', event: 'start', payload: { atMs: atMs, sel: sel, combat: matchCombat } });
      beginMatch(atMs, sel);
      // build100i: HOST opens the SERVER round (Lovable /mp/round/start) so both peers can settle against a shared uuid
      // for the trustworthy global MP ladder. Fire-and-forget; broadcast the uuid to the peer. Human matches only;
      // _roundStartFired guards re-entry (maybeStart can fire more than once before the round goes live).
      try {
        if (!_roundStartFired && !(oppMeta && oppMeta.bot) && window.RhythmCatalog && RhythmCatalog.mpRoundStart) {
          _roundStartFired = true; _roundSeq++;
          RhythmCatalog.mpRoundStart({
            room_id: (room && room.id) || matchId,
            round_id: 'r' + _roundSeq,
            track_id: sel.trackId || null,
            difficulty: sel.difficulty || null,
            mode: (tour && tour.id) ? 'tournament' : '1v1',
            player_ids: [ME.id, oppMeta && oppMeta.id].filter(Boolean),
          }).then(function (rid) {
            if (rid) { _serverRoundId = rid; try { if (matchCh) matchCh.send({ type: 'broadcast', event: 'round', payload: { rid: rid } }); } catch (e) {} }
          });
        }
      } catch (e) {}
    }
  }
  function onStart(p) { if (p && p.atMs) { matchCombat = !!p.combat; beginMatch(p.atMs, p.sel || sel); } }   // v254: adopt the host's combat mode

  // ===================== SYNCHRONIZED MATCH =====================
  // 3·2·1·GO! painted in the centered #mpx-go-num card during the lead-in. Every client computes
  // atMs - now off the SAME shared atMs, so the countdown is frame-synced across machines.
  function setGo(t, cls) {
    var gn = $('mpx-go-num'); if (!gn) return;
    gn.textContent = t; gn.classList.remove('pop', 'go'); void gn.offsetWidth;   // restart the pop
    gn.classList.add('pop'); if (cls) gn.classList.add(cls);
  }
  function startCountdown(atMs) {
    stopCountdown();
    var last = null;
    (function tick() {
      var rem = atMs - Date.now(), label;
      if (rem > 600) { var n = Math.ceil((rem - 600) / 1000); label = n > 9 ? 'GET READY' : String(n); }
      else { label = 'GO!'; }
      if (label !== last) { setGo(label, label === 'GO!' ? 'go' : ''); last = label; }
      if (rem > 0) _countdownRaf = requestAnimationFrame(tick);
    })();
  }
  function stopCountdown() { if (_countdownRaf) cancelAnimationFrame(_countdownRaf); _countdownRaf = 0; }

  // ---- tournament cinematic countdown / verdict veil (FLOW-C1/M1/M2/M3) ----
  // A veil OVER the live bracket room (the room never blanks). Runs a 3-beat build off the shared atMs:
  // ROUND card → VS reveal → 3·2·1·GO numerals. Own rAF (_tourCdRaf) so it never cancels the 1v1 loop.
  function hideTourCd() { var cd = $('mpx-tour-cd'); if (cd) { cd.hidden = true; cd.classList.remove('win', 'lose'); cd.removeAttribute('data-beat'); } }
  function stopTourCountdown() { if (_tourCdRaf) cancelAnimationFrame(_tourCdRaf); _tourCdRaf = 0; }
  function startTourCountdown(atMs, info) {
    stopTourCountdown(); info = info || {};
    var cd = $('mpx-tour-cd'); if (!cd) return;
    cd.classList.remove('win', 'lose');
    set('tcd-stage', info.label || 'ROUND');
    set('tcd-sub', info.sub || '');
    var vs = $('tcd-vs'); if (vs) vs.innerHTML = info.vsHtml || '';
    cd.hidden = false;
    var total = Math.max(1, atMs - Date.now()), lastBeat = '', lastNum = '';
    (function tick() {
      var rem = atMs - Date.now();
      // ROUND for the first ~38%, VS for the next ~32%, numerals for the last ~30% — all gated on atMs (synced)
      var beat = rem > total * 0.62 ? 'round' : rem > total * 0.30 ? 'vs' : 'go';
      if (beat !== lastBeat) { cd.setAttribute('data-beat', beat); lastBeat = beat; }
      if (beat === 'go') {
        var label; if (rem > 600) { var n = Math.ceil((rem - 600) / 1000); label = n > 9 ? 'GET READY' : String(n); } else label = 'GO!';
        if (label !== lastNum) {
          var g = $('mpx-tour-go');
          if (g) { g.textContent = label; g.classList.remove('pop', 'go'); void g.offsetWidth; g.classList.add('pop'); if (label === 'GO!') g.classList.add('go'); }
          lastNum = label;
        }
      }
      if (rem > 0) _tourCdRaf = requestAnimationFrame(tick);
    })();
  }
  // a single big WON/OUT (or CHAMPION DECIDED) flash — reuses the same veil + #tcd-stage
  function showTourVerdict(text, isWin) {
    var cd = $('mpx-tour-cd'); if (!cd) return;
    stopTourCountdown();
    set('tcd-stage', text); set('tcd-sub', ''); var vs = $('tcd-vs'); if (vs) vs.innerHTML = ''; set('mpx-tour-go', '');
    cd.classList.toggle('win', !!isWin); cd.classList.toggle('lose', !isWin);
    cd.setAttribute('data-beat', 'verdict'); cd.hidden = false;
    if (_verdictT) clearTimeout(_verdictT);
    _verdictT = setTimeout(function () { hideTourCd(); }, 1700);
  }

  // ---- versus split-screen HUD (P3): "The Crimson Meridian" ----
  var _myRf = null, _oppEase = null, _leadEase = 0, _vsScoreDisp = 0, _lastDeltaSign = 0, _lastOda = false;
  var _npcRaf = 0, _npcLastEv = 0;   // dev NPC 1v1: the synthetic-opponent drive loop
  // versus P4: opponent ghost-highway renderer state — pre-allocated sparkle pool (zero per-frame alloc)
  var _gCtx = null;
  var _spk = []; (function () { for (var i = 0; i < 48; i++) _spk.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, cr: false }); })();
  // ghost deck "co-op" feedback: per-lane catcher FLASH (0..1, decays) + crimson(miss)/gold(hit) flag, so a glance
  // at the rival deck reads 'nailing it' vs 'choked'. Fed by real ev hits/misses (1v1) OR synthesized from
  // ghost-note arrivals + the rival's combo trend (tournaments stream only score/combo/prog, no per-note ev).
  var _gFlash = [0, 0, 0, 0, 0, 0], _gFlashCr = [false, false, false, false, false, false];
  var _gPrevCombo = 0, _gMissWin = 0;   // _gMissWin: frames left to paint note-arrivals as misses after a rival combo drop
  function vsIsMobile() { try { return window.matchMedia('(max-width:900px)').matches; } catch (e) { return false; } }
  function _vsEl(tag, id, cls) { var e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; return e; }
  function _lerp(a, b, t) { return a + (b - a) * t; }
  function _fmtK(n) { var a = Math.abs(n); if (a >= 10000) return (n < 0 ? '-' : '+') + (a / 1000).toFixed(1) + 'k'; return (n >= 0 ? '+' : '') + n; }
  function _fmtScore(n) { n = Math.round(n); return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : n.toLocaleString(); }   // abbreviate ≥1M so the score never overflows its chrome plate
  function mountVsHud() {
    var game = $('game'); if (!game || document.getElementById('vs-seam')) return;   // idempotent
    // opponent ghost deck (LEFT grid cell)
    var deck = _vsEl('div', 'vs-opp-deck');
    deck.appendChild(_vsEl('canvas', 'vs-opp-hwy'));
    var oppScore = _vsEl('div', 'vs-opp-score');
    var ol = _vsEl('div', null, 'vs-lab'); ol.textContent = (oppMeta && oppMeta.name ? oppMeta.name.slice(0, 12) : 'OPPONENT'); oppScore.appendChild(ol);
    var ov = _vsEl('div', 'vs-opp-val', 'vs-val'); ov.textContent = '0'; oppScore.appendChild(ov);
    deck.appendChild(oppScore);
    var oMult = _vsEl('div', 'vs-opp-mult', 'vs-opp-pill'); oMult.textContent = '1x'; deck.appendChild(oMult);
    var oCombo = _vsEl('div', 'vs-opp-combo', 'vs-opp-pill'); oCombo.textContent = '0x'; deck.appendChild(oCombo);
    var oOd = _vsEl('div', 'vs-od-opp', 'vs-od'); oOd.appendChild(_vsEl('i')); deck.appendChild(oOd);
    game.appendChild(deck);
    // center seam
    var seam = _vsEl('div', 'vs-seam');
    seam.appendChild(_vsEl('div', 'vs-prog'));
    var delta = _vsEl('div', 'vs-delta'); delta.textContent = 'EVEN'; seam.appendChild(delta);
    var lead = _vsEl('div', 'vs-lead'); lead.appendChild(_vsEl('i')); lead.appendChild(_vsEl('b')); seam.appendChild(lead);
    game.appendChild(seam);
    // build100q (#tug-of-war): a horizontal TOP bar showing who's winning at a glance — the "rope knot" slides toward
    // the leader's side; each half fills with that player's color. Driven by the same eased score-lead as the seam puck.
    var tug = _vsEl('div', 'vs-tug');
    var tOpp = _vsEl('div', 'vs-tug-opp'); tug.appendChild(tOpp);
    var tYou = _vsEl('div', 'vs-tug-you'); tug.appendChild(tYou);
    var tKnot = _vsEl('div', 'vs-tug-knot'); tug.appendChild(tKnot);
    var tlO = _vsEl('span', null, 'vs-tug-lab opp'); tlO.textContent = (oppMeta && oppMeta.name ? oppMeta.name.slice(0, 12) : 'OPPONENT'); tug.appendChild(tlO);
    var tlY = _vsEl('span', null, 'vs-tug-lab you'); tlY.textContent = 'YOU'; tug.appendChild(tlY);
    game.appendChild(tug);
    // your score plate + OD bar (into .game-center)
    var center = game.querySelector('.game-center');
    if (center) {
      var yScore = _vsEl('div', 'vs-you-score');
      var yl = _vsEl('div', null, 'vs-lab'); yl.textContent = 'YOU'; yScore.appendChild(yl);
      var yv = _vsEl('div', 'vs-you-val', 'vs-val'); yv.textContent = '0'; yScore.appendChild(yv);
      center.appendChild(yScore);
      var yOd = _vsEl('div', 'vs-od-you', 'vs-od'); yOd.appendChild(_vsEl('i'));
      var tag = _vsEl('span', null, 'vs-od-tag'); tag.textContent = 'SPACE'; yOd.appendChild(tag);
      center.appendChild(yOd);
    }
    _myRf = null; _oppEase = { sc: 0, cb: 0, od: 0, mu: 1, st: 1, pr: 0 }; _leadEase = 0; _vsScoreDisp = 0; _lastDeltaSign = 0; _lastOda = false;
    _gCtx = null; for (var _i = 0; _i < _spk.length; _i++) _spk[_i].on = false;   // ghost: re-grab the context, clear the pool
    for (var _l = 0; _l < 6; _l++) { _gFlash[_l] = 0; _gFlashCr[_l] = false; } _gPrevCombo = 0; _gMissWin = 0;   // reset the rival-deck flash state
    try { document.documentElement.classList.add('rr-vs'); } catch (e) {}   // hide the level's single-deck reactive fate-cards + mechanic prop (they break on a half-deck)
    try { if (window.RhythmGame.setVsMode) window.RhythmGame.setVsMode(true); } catch (e) {}   // engine: fit the guitar to deck HEIGHT (runway)
  }
  function unmountVsHud() {
    try { document.documentElement.classList.remove('rr-vs'); } catch (e) {}   // restore the level's reactive cards / mechanic for single-deck play
    try { if (window.RhythmGame.setVsMode) window.RhythmGame.setVsMode(false); } catch (e) {}   // restore full-deck cover-fit
    ['vs-opp-deck', 'vs-seam', 'vs-tug', 'vs-you-score', 'vs-od-you', 'vs-intro-vs'].forEach(function (id) {
      var e = document.getElementById(id); if (e && e.parentNode) e.parentNode.removeChild(e);
    });
    var mg = $('mult-gauge'); if (mg) mg.classList.remove('boosted');
  }
  // the pre-match reveal (you-right / opponent-left); cosmetic + non-blocking; reduced-motion early-out
  function runVsIntro() {
    var game = $('game'); if (!game || document.documentElement.classList.contains('rr-reduce-motion')) return;
    game.classList.add('vs-intro');
    var vs = _vsEl('div', 'vs-intro-vs'); vs.innerHTML = '<span class="v">V</span><span class="s">S</span>'; game.appendChild(vs);
    setTimeout(function () {
      if (game) game.classList.remove('vs-intro');
      var v = $('vs-intro-vs'); if (v && v.parentNode) v.parentNode.removeChild(v);
    }, 720);
  }
  // drive the compact HUD every frame from getLiveStats (you) + eased lastOppState (opp); myRf = the SINGLE
  // getRenderFrame() drain captured in startTick (never call getRenderFrame twice — it drains the hits buffer)
  function renderVsHud(stt, myRf) {
    if (!_vsMode || !stt) return;
    var game = $('game');
    // YOUR side
    _vsScoreDisp = _lerp(_vsScoreDisp, stt.score, 0.25);
    var yv = $('vs-you-val'); if (yv) yv.textContent = _fmtScore(_vsScoreDisp);
    if (myRf) {
      var mg = $('mult-gauge'); if (mg) mg.classList.toggle('boosted', !!myRf.oda);
      var odY = $('vs-od-you'); if (odY) { var fi = odY.firstChild; if (fi) fi.style.transform = 'scaleX(' + Math.max(0, Math.min(1, myRf.od)) + ')';   // scaleX-driven (no overshoot past the trough cap)
        odY.classList.toggle('ready', myRf.od >= 1 && !myRf.oda); odY.classList.toggle('active', !!myRf.oda); }
      if (myRf.oda && !_lastOda && game) { game.classList.add('you-od-fire'); setTimeout(function () { var g = $('game'); if (g) g.classList.remove('you-od-fire'); }, 620); }
      _lastOda = !!myRf.oda;
    }
    // OPPONENT side (ease the ~13/s stream)
    if (!_oppEase) _oppEase = { sc: 0, cb: 0, od: 0, mu: 1, st: 1, pr: 0 };
    var os = lastOppState;
    ['sc', 'cb', 'od', 'mu', 'st', 'pr'].forEach(function (k) { var tgt = (os && typeof os[k] === 'number') ? os[k] : _oppEase[k]; _oppEase[k] = _lerp(_oppEase[k], tgt, 0.2); });
    var ov = $('vs-opp-val'); if (ov) ov.textContent = _fmtScore(_oppEase.sc);
    var om = $('vs-opp-mult'); if (om) om.textContent = Math.round(_oppEase.mu) + 'x';
    var oc = $('vs-opp-combo'); if (oc) oc.textContent = Math.round(_oppEase.cb) + 'x';
    var odO = $('vs-od-opp'); if (odO) { var foi = odO.firstChild; if (foi) foi.style.transform = 'scaleX(' + Math.max(0, Math.min(1, _oppEase.od)) + ')';
      odO.classList.toggle('ready', !!(os && os.od >= 1 && !os.oda)); odO.classList.toggle('active', !!(os && os.oda)); }
    // SEAM: progress + lead bar + delta
    var myP = stt.progress, opP = os ? os.pr : 0;
    var prog = $('vs-prog'); if (prog) prog.style.height = (Math.max(myP, _oppEase.pr) * 100) + '%';
    var lead = $('vs-lead'), fill = lead && lead.firstChild, puck = lead && lead.children[1], delta = $('vs-delta');
    var frozen = Math.abs(myP - opP) > 0.06;   // one stream lagging badly → freeze the bar
    if (lead) lead.style.opacity = frozen ? '0.5' : '1';   // a lagging stream freezes the bar — dim the WHOLE indicator (puck + fill), not just the delta, so they never contradict
    if (myP < 0.03 || opP < 0.03) {
      if (fill) { fill.style.top = '50%'; fill.style.bottom = 'auto'; fill.style.height = '0%'; }
      if (puck) puck.style.top = '50%';
      if (lead) lead.style.opacity = '1';
      if (delta) { delta.textContent = 'EVEN'; delta.classList.remove('ahead', 'behind', 'flip'); delta.style.opacity = '1'; }
    } else {
      // build58: drive the lead puck from the SAME raw score diff the delta text uses (normalized by half the leader's
      // score) — the old score/progress "pace" exploded near song start (÷0.02) and could contradict the +/- number.
      var lv = Math.max(-1, Math.min(1, (stt.score - _oppEase.sc) / (Math.max(stt.score, _oppEase.sc, 1) * 0.5)));
      if (!frozen) _leadEase = _lerp(_leadEase, lv, 0.2);
      var mag = Math.min(0.5, Math.abs(_leadEase) * 0.5);
      if (fill) {
        if (_leadEase >= 0) { fill.style.bottom = '50%'; fill.style.top = 'auto'; fill.style.height = (mag * 100) + '%'; fill.style.background = 'linear-gradient(0deg, var(--gold), #ffd98a)'; }
        else { fill.style.top = '50%'; fill.style.bottom = 'auto'; fill.style.height = (mag * 100) + '%'; fill.style.background = 'linear-gradient(180deg, var(--crimson), #ff5a64)'; }
      }
      if (puck) puck.style.top = (50 - _leadEase * 44) + '%';
      var d = Math.round(stt.score - _oppEase.sc), sign = d > 150 ? 1 : d < -150 ? -1 : 0;
      if (delta) {
        delta.textContent = sign === 0 ? 'EVEN' : (frozen ? '~' : '') + _fmtK(d);
        delta.classList.toggle('ahead', sign > 0); delta.classList.toggle('behind', sign < 0);
        if (sign !== 0 && sign !== _lastDeltaSign && _lastDeltaSign !== 0) { delta.classList.remove('flip'); void delta.offsetWidth; delta.classList.add('flip'); }
        _lastDeltaSign = sign; delta.style.opacity = frozen ? '0.65' : '1';
      }
    }
    // build100q (#tug-of-war): horizontal top bar — knot at P% from the OPP (left) side. You ahead (_leadEase>0) → P
    // shrinks → your gold (right) half grows; opp ahead → P grows → their crimson (left) half grows. 50% = even.
    var tugP = Math.max(4, Math.min(96, 50 - _leadEase * 44));
    var tOpp = $('vs-tug-opp'), tYou = $('vs-tug-you'), tKnot = $('vs-tug-knot');
    if (tOpp) tOpp.style.width = tugP + '%';
    if (tYou) tYou.style.width = (100 - tugP) + '%';
    if (tKnot) { tKnot.style.left = tugP + '%'; tKnot.classList.toggle('you-lead', _leadEase > 0.04); tKnot.classList.toggle('opp-lead', _leadEase < -0.04); }
  }

  // P4: paint the opponent ghost highway — dim chrome strings (re-based from getLaneFrame's page coords into
  // the ghost canvas's own box) + a pooled sparkle per lastOppState.ev. Runs inside startTick's rAF (no second
  // loop, no extra getRenderFrame drain). ZERO per-frame heap allocation (reuses _spk + stack primitives).
  function renderGhost() {
    var cv = $('vs-opp-hwy'); if (!cv) return;
    if (!_gCtx) { _gCtx = cv.getContext('2d'); if (!_gCtx) return; }
    var lf = window.RhythmGame.getLaneFrame && window.RhythmGame.getLaneFrame();
    if (!lf || !lf.nearX || !lf.w) return;                       // engine canvas not sized yet
    var cw = cv.clientWidth, chh = cv.clientHeight; if (!cw || !chh) return;
    var bw = Math.max(1, cw), bh = Math.max(1, chh);   // FULL-RES backing store — crisp rival deck (was half-res >>1 = blurry, the "doesn't look right")
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    // getLaneFrame's nearX/farX/nearY/farY are CANVAS-LOCAL coords (0->canvas size), not page coords — so
    // scale them straight into the ghost's own box (NO origin subtraction; both canvases share a local origin).
    var sx = bw / lf.w, sy = bh / lf.h, N = lf.nearX.length, i;
    _gCtx.setTransform(1, 0, 0, 1, 0, 0);
    _gCtx.clearRect(0, 0, bw, bh);
    // opponent GUITAR behind the strings — WARPED to match your deck's neck-recede + bright, so it reads as a LIVE
    // second board played beside you (was a dim 0.5 FLAT blit = the "looks like a sticker, not them playing").
    var art = window.RhythmGame.getGuitarArt && window.RhythmGame.getGuitarArt();
    if (art && art.img) {
      _gCtx.save(); _gCtx.globalAlpha = 0.9;
      try {
        var gwp = art.warp || 0;
        if (gwp > 0 && art.nutFY != null && art.bridgeFY != null) {
          // replicate the engine's NECK-RECEDE warp: slice the guitar into bands, narrow each toward the centerline
          // by (1 - warp*u) (u: 0 at the bridge → 1 at the nut), so the rival neck recedes exactly like yours.
          var giw = art.img.width, gih = art.img.height, GNS = 40;
          var gnY = (art.gy + art.bridgeFY * art.gh) * sy, gfY = (art.gy + art.nutFY * art.gh) * sy;
          var gcX = (art.gx + 0.5 * art.gw) * sx, gwpx = art.gw * sx;
          for (var gb = 0; gb < GNS; gb++) {
            var gv0 = gb / GNS, gv1 = (gb + 1) / GNS;
            var gdy0 = (art.gy + gv0 * art.gh) * sy, gdy1 = (art.gy + gv1 * art.gh) * sy;
            var guu = ((gdy0 + gdy1) / 2 - gnY) / (gfY - gnY);
            var gdw = gwpx * (1 - gwp * (guu < 0 ? 0 : guu));
            _gCtx.drawImage(art.img, 0, gv0 * gih, giw, (gv1 - gv0) * gih, gcX - gdw / 2, gdy0, gdw, (gdy1 - gdy0) + 0.6);
          }
        } else {
          _gCtx.drawImage(art.img, art.gx * sx, art.gy * sy, art.gw * sx, art.gh * sy);   // skins without warp: plain blit
        }
      } catch (e) {}
      _gCtx.restore();
    }
    // lane strings (far -> near) — brighter so the rival reads as a LIVE highway, not a faint 18% ghost
    _gCtx.lineWidth = Math.max(1, lf.lw * 0.06 * sx);
    _gCtx.strokeStyle = 'rgba(220,217,212,0.44)';
    _gCtx.beginPath();
    for (i = 0; i < N; i++) {
      _gCtx.moveTo(lf.farX[i] * sx, lf.farY * sy);
      _gCtx.lineTo(lf.nearX[i] * sx, lf.nearY * sy);
    }
    _gCtx.stroke();
    var cols = lf.colors || null;   // build45: per-lane note colors (mirror YOUR deck) — drive the gems + catcher buttons below
    // rival COMBO TREND → arrivals paint as misses (crimson) for a short window after a combo drop, else hits (gold)
    var _oc = (lastOppState && lastOppState.cb) || 0;
    if (_oc < _gPrevCombo - 0.5) _gMissWin = 20;
    _gPrevCombo = _oc;
    if (_gMissWin > 0) _gMissWin--;
    // ghost GEMS — scroll the SAME chart the engine draws on your board (dim chrome), re-projected with the
    // real board's 1/z perspective + neck-recede warp (read from getLaneFrame) so they ride the painted lanes.
    var gn = window.RhythmGame.getGhostNotes && window.RhythmGame.getGhostNotes();
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
        if (it.type === 3) {                                       // bomb → hollow dim ring (never reads as a hit)
          _gCtx.strokeStyle = 'rgba(180,178,174,' + (0.35 * (1 - u * 0.5)).toFixed(3) + ')';
          _gCtx.lineWidth = Math.max(1, rad * 0.4);
          _gCtx.beginPath(); _gCtx.arc(gx, gy, rad, 0, 6.283); _gCtx.stroke();
          continue;
        }
        var lcol = (cols && cols[it.lane]) ? cols[it.lane] : '255,60,60';
        aGem = 0.62 + 0.38 * (1 - u);                              // bright LANE-COLORED gem — the SAME colored note as your deck
        if (it.type === 1) {                                       // hold → lane-colored beam toward the nut (behind the head)
          var d2 = dd + 0.12; if (d2 > 1.02) d2 = 1.02;
          var u2; if (zf > 1) { var z2 = 1 + d2 * (zf - 1); u2 = (1 - 1 / z2) / (1 - 1 / zf); } else { u2 = d2; }
          var lx2 = lf.nearX[it.lane] + (lf.farX[it.lane] - lf.nearX[it.lane]) * u2;
          if (warp > 0) lx2 = cxw + (lx2 - cxw) * (1 - warp * (u2 < 0 ? 0 : u2));
          _gCtx.strokeStyle = 'rgba(' + lcol + ',' + (aGem * 0.5).toFixed(3) + ')';
          _gCtx.lineWidth = Math.max(1.5, rad * 0.8);
          _gCtx.beginPath(); _gCtx.moveTo(gx, gy); _gCtx.lineTo(lx2 * sx, (lf.nearY + (lf.farY - lf.nearY) * u2) * sy); _gCtx.stroke();
        }
        _gCtx.fillStyle = 'rgba(' + lcol + ',' + aGem.toFixed(3) + ')';   // LANE-COLORED core (matches your deck's note)
        _gCtx.beginPath(); _gCtx.arc(gx, gy, rad, 0, 6.283); _gCtx.fill();
        _gCtx.fillStyle = 'rgba(255,255,255,' + (aGem * 0.55).toFixed(3) + ')';   // glossy highlight → reads as a real gem, not a flat dot
        _gCtx.beginPath(); _gCtx.arc(gx - rad * 0.3, gy - rad * 0.3, rad * 0.34, 0, 6.283); _gCtx.fill();
        if (it.type === 2) {                                       // chord → white double-rim
          _gCtx.strokeStyle = 'rgba(255,255,255,' + (aGem * 0.7).toFixed(3) + ')';
          _gCtx.lineWidth = Math.max(1, rad * 0.3);
          _gCtx.beginPath(); _gCtx.arc(gx, gy, rad * 1.3, 0, 6.283); _gCtx.stroke();
        }
        if (u >= 0.9 && u <= 1.06 && _gFlash[it.lane] < 0.5) { _gFlash[it.lane] = 1; _gFlashCr[it.lane] = _gMissWin > 0; }   // gem reaches the catcher → synthesize a strike (t-tick-only fallback)
      }
    }
    // per-lane CATCHER BUTTONS — colored rings (mirror YOUR deck) that PRESS DOWN + light WHITE-HOT (crimson on a miss)
    // when the rival strikes that lane, driven by their real feed. This is the "you can SEE them pushing the buttons" GH split-screen.
    for (i = 0; i < N; i++) {
      var fl = _gFlash[i];
      var bcol = (cols && cols[i]) ? cols[i] : '255,60,60';
      var press = fl * lf.lw * 0.10 * sy, bx = lf.nearX[i] * sx, by = lf.nearY * sy + press, brad = lf.lw * 0.26 * sx;
      _gCtx.save();
      _gCtx.lineWidth = Math.max(1.4, lf.lw * 0.055 * sx);
      _gCtx.strokeStyle = 'rgba(' + bcol + ',' + (0.5 + fl * 0.5).toFixed(3) + ')';
      if (fl > 0.02) { _gCtx.shadowColor = _gFlashCr[i] ? '#ff2834' : 'rgba(255,250,235,1)'; _gCtx.shadowBlur = 16 * sx * fl; }
      _gCtx.beginPath(); _gCtx.arc(bx, by, brad, 0, 6.283); _gCtx.stroke();
      if (fl > 0.04) {   // strike pop — white-hot core (crimson on a miss)
        _gCtx.globalAlpha = fl;
        _gCtx.fillStyle = _gFlashCr[i] ? 'rgba(255,40,52,0.85)' : 'rgba(255,250,238,0.95)';
        _gCtx.beginPath(); _gCtx.arc(bx, by, brad * (0.5 + fl * 0.35), 0, 6.283); _gCtx.fill();
      }
      _gCtx.restore();
      _gFlash[i] *= 0.84; if (_gFlash[i] <= 0.02) _gFlash[i] = 0;
    }
    if (document.documentElement.classList.contains('rr-reduce-motion')) return;   // strings + gems + flashes only, no sparkles
    // spawn sparkles from fresh opponent events ('p'/'g' = chrome hit, 'm' = crimson miss) + drive the lane flash from REAL hits/misses (1v1)
    var os = lastOppState, ev = os && os.ev, e, s, P;
    if (ev && ev.length) {
      for (e = 0; e < ev.length; e++) {
        var L = ev[e].l | 0; if (L < 0 || L >= N) continue;
        var cxp = lf.nearX[L] * sx, cyp = lf.nearY * sy, crimson = (ev[e].j === 'm');
        _gFlash[L] = 1; _gFlashCr[L] = crimson;   // real hit/miss → authoritative lane flash
        for (s = 0; s < _spk.length; s++) {
          P = _spk[s]; if (P.on) continue;
          P.on = true; P.x = cxp; P.y = cyp; P.cr = crimson;
          P.vx = (Math.random() - 0.5) * 1.6 * sx; P.vy = -(0.8 + Math.random() * 1.4) * sy;
          P.life = 0; P.max = crimson ? 0.30 : 0.42; break;
        }
      }
      os.ev = null;   // consume — onState replaces lastOppState wholesale each ~13/s packet
    }
    for (s = 0; s < _spk.length; s++) {
      P = _spk[s]; if (!P.on) continue;
      P.life += 0.016; if (P.life >= P.max) { P.on = false; continue; }
      P.x += P.vx; P.y += P.vy; P.vy += 0.05 * sy;
      var a = 1 - (P.life / P.max), rad = Math.max(1, (P.cr ? 2.2 : 1.6) * sx);
      _gCtx.fillStyle = P.cr ? 'rgba(255,40,52,' + (a * 0.9) + ')' : 'rgba(225,222,214,' + (a * 0.85) + ')';
      _gCtx.beginPath(); _gCtx.arc(P.x, P.y, rad, 0, 6.283); _gCtx.fill();
    }
  }

  function beginMatch(atMs, s) {
    sel = s || sel;
    // build102s (security judge BLOCKER): snapshot the solo-show flag NOW — the settle path keys on this,
    // never on live room.p2, so a challenger seating mid-run can't flip the run into a ranked versus.
    _soloRun = !!(room.show && room.isHost && !room.p2);
    // build102u (review MAJOR 2a): a live-show PERFORMER alt-tabbing must not freeze the show — watcher clocks are
    // wall-locked to atMs, so an auto-pause desyncs every deck permanently. Show runs only; teardown restores.
    try { if (room.show && window.RhythmGame.setAutoPauseSuppressed) window.RhythmGame.setAutoPauseSuppressed(true); } catch (e) {}
    closeTransientOverlays();   // no overlay can occlude the starting 1v1 match
    matchLive = true; finishedLocal = false; myFinal = null; oppFinal = null; oppLeft = false; lastOppTick = null; lastOppState = null;
    _lastShockCombo = 0; _lastOdActive = false; _rankRecorded = false;   // v254/build100r: fresh combat-shock (combo + OD) + ranked-record state per match
    try { console.warn('[mp] match starting — combat (damage) =', matchCombat ? 'ON' : 'OFF'); } catch (e) {}   // build100r: confirm whether shocks will fire this match (combat is the HOST's setting)
    step('go'); startCountdown(atMs);   // synced 3·2·1·GO! in the centered card, off the shared atMs
    // register one-shot song-end handler BEFORE launch
    window.RhythmGame.onSongEnd(onLocalSongEnd);
    // v262: apply the room's chosen STAGE (level/env) on BOTH sides before launch so the backdrop/journey matches. Arena → clear.
    try { if (window.RhythmLevels) { if (sel.env && sel.env !== '__default') window.RhythmLevels.applyEnvironment(sel.env); else window.RhythmLevels.clearEnvironment(); } } catch (e) {}
    // resolve provider + start synced. The engine surface stays minimal: resolve the
    // track and reuse the SAME launch paths the rest of the app uses (byte-identical play).
    resolveAndStart(sel, atMs);
    // mount HUD + tick right as the engine takes over (showScreen('game') auto-closes overlay)
    var delay = Math.max(0, atMs - Date.now());
    _mountT = setTimeout(function () {
      _mountT = 0; stopCountdown();
      if (!matchLive) return;                    // teardown fired during the lead-in → DON'T resurrect the split (would leak a tick rAF + _vsFit into the next solo session)
      if (_soloRun) { startTick(); return; }     // build102s: SOLO show run = single full deck (no empty rival split/panel); tick keeps streaming so watchers see the live score
      if (!vsIsMobile()) {                       // DESKTOP/PC → true split-screen versus
        var g = $('game'); if (g) g.classList.add('vs-mode');
        _vsActive = true; _vsMode = true;
        mountVsHud();
        try { window.dispatchEvent(new Event('resize')); } catch (e) {}   // refit the engine canvas into the half cell
        startTick();
        runVsIntro();                            // cosmetic, non-blocking
      } else {                                   // mobile / narrow → single deck + the compact opponent card
        mountOppPanel(); startTick();
      }
    }, delay + 80);
  }

  // Resolve a chart provider for `sel` and schedule the synced start via the public
  // RhythmGame.startAt(provider,{...}). Branch logic mirrors RhythmCatalog.launchTrack:
  //   server chart → liveProvider(id); else audio_url → __buffered/playUrl; else demo.
  function resolveAndStart(s, atMs) {
    // build102s (stability judge BLOCKER): a show/review sel carries sel.audioUrl (the decodable analysis_url —
    // it is NOT in the catalog). Route DIRECTLY to the buffered decoder; if that's impossible, ABORT LOUD — the
    // silent demo fallback below must never play Lunar Waves on-air. Non-show sels (no audioUrl) are byte-identical.
    // chartMode note: all seats chart the same audioUrl + difficulty through the normal path, so no chartMode
    // forcing is needed here — if it ever is, use a per-run TRANSIENT override, NEVER RhythmGame.applySettings
    // (that persists to rr_settings and would silently overwrite the player's saved Musical/Classic A-B choice).
    // Belt-and-braces (review fix 1): the show route only exists INSIDE a show room — a leaked/forged audioUrl
    // must never hijack a normal match with stale review audio; strip it and resolve by trackId as always.
    if (s && s.audioUrl && room.show) { resolveShowStart(s, atMs); return; }
    if (s && s.audioUrl) { try { delete s.audioUrl; } catch (e) {} }
    var RC = window.RhythmCatalog;
    var t = (RC && RC.allTracks) ? RC.allTracks().filter(function (x) { return x.id === s.trackId; })[0] : null;
    if (t && RC && RC.isVideo && RC.isVideo(t)) t = null;   // defense-in-depth: never start a video in MP → falls to demo
    var prov = null;
    try {
      if (s.demo || !t) {
        prov = window.RhythmGame.__demoProvider ? window.RhythmGame.__demoProvider() : null;
      } else if (RC && RC.liveProvider && RC.trackReady && RC.trackReady(t) && hasServerChart(t)) {
        prov = RC.liveProvider(t.id);
      } else {
        // build100q (#174): use the HLS-skipping resolver — a track can be "ready" with an .m3u8 audio_url that the
        // in-browser decoder CANNOT decode → the round never reaches #game → the start-watchdog aborts EVERYONE back to
        // the room ("round 2 never played"). trackAudioUrl returns null for HLS-only → we fall through to the demo below.
        var url = (RC && RC.trackAudioUrl ? RC.trackAudioUrl(t) : null) || (!/\.m3u8(\?|$)/i.test(String(t.audio_url || '')) ? t.audio_url : null) || t.wav_url || (t.audio && t.audio.url);
        // tight-sync path: if the engine exposes __buffered, build a deferred provider so
        // startAt() can schedule it precisely. (Added by the hooks doc to the Object.assign.)
        if (url && window.RhythmGame.__buffered) {
          prov = (function (u, meta) { return function () { return window.RhythmGame.__buffered(u, meta); }; })(
            url, { title: t.title, artist: t.artist_credit_name || t.artist_name, genre: t.genre, artwork: t.artwork_url }
          );
        }
      }
    } catch (e) { console.error('[mp] provider resolve failed', e); }

    if (prov) {
      window.RhythmGame.startAt(prov, { atMs: atMs, difficulty: sel.difficulty });
    } else {
      // Fallback (in-browser-charted track, no __buffered seam): set difficulty + fire the public launchTrack at the
      // synced timestamp. Judgment stays 100% local (fairness unaffected — only the comparative bar).
      try { window.RhythmGame.setDifficulty(sel.difficulty); } catch (e) {}
      setTimeout(function () {
        try { if (window.RhythmGame.getAC) window.RhythmGame.getAC().resume(); } catch (e) {}
        try {
          if (t && RC && RC.launchTrack) RC.launchTrack(t, (sel.env && sel.env !== '__default') ? { keepEnvironment: true } : undefined);   // v262: keep the applied stage env on the fallback launch path
          else if (window.RhythmGame.playDemo) window.RhythmGame.playDemo();
          else throw new Error('no provider, track, or demo available to launch');
        } catch (e) { console.error('[mp] fallback launch failed', e); }
      }, Math.max(0, atMs - Date.now()));
    }
    // WATCHDOG: recover ONLY if the round truly fails to start — never false-abort a valid round. A real track
    // legitimately spends SECONDS on the #loading (decode) screen before #game, so #loading OR #game both count as
    // "progressing"; we keep waiting through the decode and only abort if NEITHER screen is up past the synced start
    // (i.e. play() never fired). This was the bug behind "round never started + advanced without playing."
    if (_startWatchdog) clearTimeout(_startWatchdog);
    var _wdT0 = Date.now();
    function _wdCheck() {
      _startWatchdog = 0;
      if (!matchLive && !tour.id) return;                       // torn down — nothing to abort
      var g = document.getElementById('game'), ld = document.getElementById('loading');
      if (g && g.classList.contains('active')) return;          // playing → success
      if (ld && ld.classList.contains('active')) {              // still decoding → grant more time (don't yank a slow decode)
        if (Date.now() - _wdT0 < 30000) _startWatchdog = setTimeout(_wdCheck, 3000);
        return;
      }
      console.error('[mp] round did not start (no loading/game screen past the synced start) — aborting to recover');
      abortRound('Could not start the track — back to the bracket.');
    }
    _startWatchdog = setTimeout(_wdCheck, Math.max(0, atMs - Date.now()) + 4000);
  }
  // tear the round down cleanly and return to the bracket (or 1v1 setup) with a visible message, instead of hanging.
  function abortRound(msg) {
    var g = $('game'), ld = $('loading');
    if ((g && g.classList.contains('active')) || (ld && ld.classList.contains('active'))) return;   // playing or still decoding — don't yank
    stopTourCountdown(); hideTourCd(); stopTourTick();
    if (_mountT) { clearTimeout(_mountT); _mountT = 0; }
    if (g) g.classList.remove('vs-mode', 'vs-tour', 'you-od-fire', 'vs-intro');
    _vsActive = false; _vsMode = false; unmountVsHud();
    if (tour.id) {
      screen.classList.add('active'); activeNow = true; step('tour');
      banner('mpx-tour-msg', msg || 'Could not start the track — back to the bracket.');
    } else {
      matchLive = false; screen.classList.add('active'); activeNow = true; step('setup');
      banner('mpx-readystate', msg || 'Could not start the track. Try READY again.');
    }
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
        // build102t: id-tagged (additive — old receivers read only known fields; mirrors the t-tick convention)
        matchCh.send({ type: 'broadcast', event: 'tick', payload: { score: stt.score, combo: stt.combo, acc: stt.acc, prog: stt.progress, name: ME.name, id: ME.id } });
      }
      // build100r: P-vs-P combat — SHOCK the rival on (a) each new combo milestone (every SHOCK_COMBO_STEP, re-arms on a
      // combo break) AND (b) the moment you activate Overdrive ("boost"). The old code only fired at combo≥30 and never on
      // boost, so in a casual match (max combo ~10) the rival was never zapped.
      if (matchCombat && matchLive && matchCh && stt && !(oppMeta && oppMeta.bot)) {
        var _c = stt.combo || 0;
        if (_c < _lastShockCombo) _lastShockCombo = 0;                       // combo broke → re-arm
        var _ms = Math.floor(_c / SHOCK_COMBO_STEP) * SHOCK_COMBO_STEP;
        var _odRise = (!!stt.odActive && !_lastOdActive);                    // Overdrive just turned ON → a shock
        _lastOdActive = !!stt.odActive;
        var _comboHit = (_ms >= SHOCK_COMBO_STEP && _ms > _lastShockCombo);
        if (_comboHit || _odRise) {
          if (_comboHit) _lastShockCombo = _ms;
          try { matchCh.send({ type: 'broadcast', event: 'shock', payload: { from: ME.name, combo: _c, od: _odRise } }); } catch (e) {}
          try { console.warn('[mp] SHOCK sent →', _odRise ? 'OVERDRIVE' : ('combo ' + _c)); } catch (e) {}   // build100r: live diagnostic
          try { window.RhythmGame.mpShockSent && window.RhythmGame.mpShockSent(); } catch (e) {}   // "⚡ ZAP" feedback on your deck
          try { _spawnZapBolt(); } catch (e) {}   // v257: a lightning bolt streaks from your deck toward the rival's
        }
      }
      // versus split-screen: additive high-rate render stream for the opponent ghost deck (~13/s).
      // getRenderFrame() DRAINS the hits buffer → call it ONCE here, cache as _myRf, reuse for YOUR HUD.
      // build102t: SHOW runs always stream (solo + mobile included) so watchers can render the dual decks.
      // Gate is room.show ONLY (judge mandate: a normal room with spec seats must NOT start streaming state).
      // DEGRADE RULE (judge): >8 watchers → stretch the interval 72ms → ~180ms; tick above stays 160ms.
      if ((_vsActive || (room.show && matchLive)) && matchCh && now - _lastStateSend > ((room.show && _specNCache > 8) ? 180 : 72)) {
        _lastStateSend = now;
        var rf = window.RhythmGame.getRenderFrame ? window.RhythmGame.getRenderFrame() : null;
        if (rf) { _myRf = rf; try { matchCh.send({ type: 'broadcast', event: 'state', payload: Object.assign({ id: ME.id }, rf) }); } catch (e) {} }   // build102t: id-tagged copy (shallow — additive field, old receivers unaffected)
      }
      if (_vsMode) { renderVsHud(stt, _myRf); renderGhost(); }
      else if (oppPanel && oppPanel.parentNode) renderOpp(stt);
    }
    oppRaf = requestAnimationFrame(frame);
  }
  function stopTick() { if (oppRaf) cancelAnimationFrame(oppRaf); oppRaf = 0; }
  function onTick(p) { if (p) lastOppTick = p; }
  function onState(p) { if (p) lastOppState = p; }   // versus P2: store; the ghost deck (P4) reads/eases this
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
    // build102s (security judge BLOCKER): a SOLO show run has nothing to pair — never the normal settle (no 8s
    // safety wait, no hollow YOU-WIN, no recordMpResult forfeit-W, no mpSettle round row). The run itself was already
    // recorded as a scored single by the engine (recordLocal + /score — the Phase-1 path). Keyed on the beginMatch
    // SNAPSHOT so a challenger who seated mid-run can't flip this into a versus settle; they play the NEXT run.
    if (_soloRun) { settleSoloShow(); return; }
    // build100i: report THIS player's result to the server MP ledger (anti-cheat + global ladder). FIRE-AND-FORGET —
    // the on-screen verdict below stays peer-broadcast + client-trusted, so a missing/slow endpoint never blocks the
    // duel. Human matches only: CPU warm-ups (oppMeta.bot) + spectators never record. Both peers POST the same
    // round_id (matchId[:trackId]) so the server can pair + re-judge them.
    try {
      if (!spectating && !(oppMeta && oppMeta.bot) && window.RhythmCatalog && RhythmCatalog.mpSettle) {
        RhythmCatalog.mpSettle({
          round_id: _serverRoundId || (matchId + (sel && sel.trackId ? (':' + sel.trackId) : '')),   // build100i: the host's server round uuid when we have it; else a client id (server fail-open)
          track_id: (sel && sel.trackId) || null,
          difficulty: (sel && sel.difficulty) || null,
          client_score: results ? results.score : s.score,
          client_accuracy: results ? results.accuracy : (s.acc / 100),
          client_max_combo: results ? results.max_combo : s.combo,
          notes_hit: results ? results.notes_hit : null,
          notes_total: results ? results.notes_total : null,
          player_id: ME.id, player_name: ME.name,
        });
      }
    } catch (e) {}
    settleIfReady();
    _settleSafetyT = setTimeout(function () { _settleSafetyT = 0; settleIfReady(true); }, 8000);   // safety if opponent never reports (v258: handle stored so teardown/rematch can cancel it)
  }
  function onFinal(p) {
    if (p) {
      // build100d (bug-swarm): coerce the inbound numerics so a junk/NaN/string score from a peer can't flip the duel
      // verdict or the local MP rank ladder. Inline (not sanitizeFinal) to preserve name + any display fields.
      var sc = +p.score; if (!isFinite(sc) || sc < 0) sc = 0;
      var ac = +p.acc; if (!isFinite(ac) || ac < 0) ac = 0; if (ac > 100) ac = 100;
      var cb = +p.combo; if (!isFinite(cb) || cb < 0) cb = 0;
      oppFinal = Object.assign({}, p, { score: sc, acc: ac, combo: cb });
    }
    settleIfReady();
  }
  function settleIfReady(force) {
    if (!matchLive || !finishedLocal) return;
    if (!oppFinal && !force && !oppLeft) return;
    matchLive = false;
    if (_settleSafetyT) { clearTimeout(_settleSafetyT); _settleSafetyT = 0; }   // v258: settling now — cancel the stale 8s safety fire so it can't re-render an already-settled match
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
    // v254: record the RANKED result (1v1 HUMAN matches only — CPU warm-ups never count). A forfeit (rival left) is a W with 0 pts.
    if (!_rankRecorded && !spectating && !(oppMeta && oppMeta.bot)) {   // v258: a SPECTATOR's myFinal defaults to {score:0} → would record a phantom LOSS on their own ladder; gate it out
      _rankRecorded = true;
      var _res = draw ? 'draw' : win ? 'win' : 'loss', _ff = !op || oppLeft;
      try { recordMpResult(_res, { op: (op && op.name) || (oppMeta && oppMeta.name) || 'Rival', song: (sel && sel.title) || '', my: (me && me.score) || 0, ops: (op && op.score) || 0, forfeit: (_res === 'win' && _ff) }); } catch (e) {}
      try { paintRankChip(); } catch (e) {}
    }
    step('winner');
    screen.classList.add('active');   // re-raise over the engine's results screen (showScreen stripped us)
    activeNow = true;
  }
  function set(id, txt) { var el = $(id); if (el) el.textContent = txt; }

  function resetForRematch() {
    myFinal = null; oppFinal = null; lastOppTick = null; meReady = false; oppReady = false;
    finishedLocal = false; matchLive = false; setReadyBtn(); setLobbyInMatch(true);
    _rankRecorded = false; _serverRoundId = null; _roundStartFired = false;   // build100i: a rematch is a NEW round — clear the prior server round + re-arm the host's /mp/round/start

    // FULLY tear down the prior split-screen so the rematch's beginMatch→mountVsHud re-seeds clean.
    // Without this, .vs-mode + #vs-seam linger → mountVsHud's idempotent guard skips the re-init and
    // round 2 lerps score plates from the PRIOR final, carries stale delta-sign + leftover ghost sparkles.
    if (_mountT) { clearTimeout(_mountT); _mountT = 0; }
    if (_settleSafetyT) { clearTimeout(_settleSafetyT); _settleSafetyT = 0; }   // v258: kill the prior round's settle safety-timer before a rematch
    var g = $('game'); if (g) g.classList.remove('vs-mode', 'you-od-fire', 'vs-intro');
    _vsActive = false; _vsMode = false; unmountVsHud();
    step('setup'); paintSelection(); refreshReadyEnabled();
    var rs = $('mpx-readystate'); if (rs) rs.textContent = 'Rematch — READY when set.';
    screen.classList.add('active'); activeNow = true;
  }

  function teardownMatch() {
    stopTick(); stopCountdown(); unmountOppPanel();
    try { if (window.RhythmLevels) window.RhythmLevels.clearEnvironment(); } catch (e) {}   // v262: drop the room's stage env so it can't leak into the next match / solo
    if (_mountT) { clearTimeout(_mountT); _mountT = 0; }           // kill any pending deferred split-mount (abort mid-lead-in)
    if (_settleSafetyT) { clearTimeout(_settleSafetyT); _settleSafetyT = 0; }   // v258: cancel the 8s settle safety-timer on teardown
    if (_npcRaf) { cancelAnimationFrame(_npcRaf); _npcRaf = 0; }   // stop the NPC ghost-drive loop
    var g = $('game'); if (g) g.classList.remove('vs-mode', 'you-od-fire', 'vs-intro');
    _vsActive = false; _vsMode = false; unmountVsHud();
    matchLive = false; finishedLocal = false; meReady = false; oppReady = false;
    try { if (matchSP) matchSP.stop(); if (matchCh) supa.removeChannel(matchCh); } catch (e) {}
    matchCh = null; matchSP = null; matchId = null; matchRole = null; oppMeta = null; oppPresent = false; oppLeft = false;
    _serverRoundId = null; _roundStartFired = false;   // build100i: drop the server round so the next match opens a fresh one
    _showAtMs = 0; _specShowSolo = false; _soloRun = false;   // build102s: show-run flags die with the match (review fix 8: a torn-down show start must never leave _soloRun armed for a later unrelated song end)
    try { if (window.RhythmGame.setAutoPauseSuppressed) window.RhythmGame.setAutoPauseSuppressed(false); } catch (e) {}   // build102u: auto-pause back to normal for everything after a show run (no-op if never suppressed)
    try { _unmountSpecStage(); } catch (e) {}                 // build102t: leak-proof — the leaveAll/mp-back paths tear the stage + spectator audio down too (no-op when never mounted)
    setLobbyInMatch(false);
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}   // refit the engine canvas back to full width
  }
  function backToLobby() {
    _cancelShowOpen();   // review fix 7: backing out kills a pending GO LIVE watchdog too (inert for normal MP)
    // build102s (judge-mandated reroute): backing out of a SHOW must fully close the room — the verified
    // backToLobby zombie leaves room.id/roomSP advertising a dead LIVE room to the site-notified artist.
    if (room.id && room.show) { teardownMatch(); QM.looking = false; paintQuickBtn(); closeRoom(); return; }
    teardownMatch();
    QM.looking = false; paintQuickBtn();   // build8
    step('lobby'); banner('mpx-lobby-msg', ''); onLobbySync();
  }

  // ===================== BUILD8: QUICK-MATCH =====================
  function toggleQuickMatch() {
    if (!supa || !lobbyCh) { banner('mpx-lobby-msg', 'Sign in to play online — quick-match needs a connection.'); return; }
    QM.looking = !QM.looking; QM.t = Date.now();
    paintQuickBtn(); reannounce();
    if (QM._timer) { clearTimeout(QM._timer); QM._timer = null; }
    if (!QM.looking) { banner('mpx-lobby-msg', ''); return; }
    banner('mpx-lobby-msg', 'Looking for a player… we\'ll pair you the moment someone\'s free.');
    QM.t = Date.now(); QM._t0 = QM.t; paintQuickBtn();
    tryQuickPair();
    // build60: never dead-end an empty lobby (the realistic beta state). After ~9s of no humans, auto-fall-back to a
    // real CPU duel — friendly copy, and the user is in a playable split-screen match instead of bounced to an empty roster.
    // (The 25s silent-timeout-to-nothing is gone; a lone first-timer always gets a match fast.)
    QM._timer = setTimeout(function () {
      if (!QM.looking || matchCh || matchLive) return;
      QM.looking = false; QM._timer = null; paintQuickBtn(); reannounce();
      if (typeof devVsNpc === 'function') {
        banner('mpx-lobby-msg', 'No one around yet — here\'s a warm-up vs CPU. We\'ll pair you with a human the moment one appears.');
        try { devVsNpc(); } catch (e) { banner('mpx-lobby-msg', 'No rivals online right now — open a room and invite a friend, or try Practice vs CPU.'); }
      } else {
        banner('mpx-lobby-msg', 'No rivals online right now — open a room and invite a friend, or try Practice vs CPU.');
      }
    }, 9000);
  }
  function paintQuickBtn() {
    var b = $('mpx-act-quick'); if (!b) return;
    b.setAttribute('aria-busy', QM.looking ? 'true' : 'false');
    // build99h: hero CTA now uses .mpx-hero-title / .mpx-hero-sub (fall back to legacy .a-t/.a-d if present)
    var t = b.querySelector('.mpx-hero-title') || b.querySelector('.a-t');
    var d = b.querySelector('.mpx-hero-sub') || b.querySelector('.a-d');
    if (t) t.textContent = QM.looking ? 'LOOKING…' : 'PLAY NOW';
    if (d) d.textContent = QM.looking ? 'Tap to cancel · CPU warm-up in a few seconds' : 'Instant 1-on-1 · CPU if no one\'s around';
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
      var ttl = $('mpx-create-title'); if (ttl) ttl.textContent = isTour ? 'OPEN A TOURNAMENT' : 'OPEN A ROOM';
      var go = $('mpx-room-create-go'); if (go) go.textContent = isTour ? 'OPEN TOURNAMENT' : 'OPEN ROOM';
      var msg = $('mpx-room-create-msg'); if (msg) msg.textContent = isTour ? 'Single-elimination bracket · 3–10 players · winners advance until one remains.' : "Public rooms appear in everyone's browser.";
      var pv = $('mpx-room-priv'); if (pv) pv.style.display = isTour ? 'none' : '';
      var cc = $('mpx-room-combat'); if (cc) { cc.style.display = isTour ? 'none' : ''; [].forEach.call(cc.children, function (b) { b.classList.toggle('active', (b.getAttribute('data-combat') === 'on') === !!combatOn); }); }   // build69: room-only combat row (tournaments use their own); seed the host's default
      var cch = $('mpx-room-combat-hint'); if (cch) cch.style.display = isTour ? 'none' : '';
      var nm = $('mpx-room-name'); if (nm) { nm.value = ''; nm.placeholder = isTour ? 'Bracket name (e.g. Friday Showdown)' : 'Room name (e.g. Friday Shred)'; setTimeout(function () { nm.focus(); }, 30); }
    }
    else { try { if (lobbyCh) lobbyCh.send({ type: 'broadcast', event: 'room-ping', payload: { from: ME.id } }); } catch (e) {} renderRooms(); }
  }

  // ---- host: open / advertise / close ----
  function openRoom() {
    if (!supa || !lobbyCh) { banner('mpx-rooms-msg', 'Sign in to play online — rooms need a connection.'); return; }
    var nm = ($('mpx-room-name') && $('mpx-room-name').value || '').trim().slice(0, 28) || (ME.name + "'s Room");
    var priv = !!(screen.querySelector('#mpx-room-priv button.active') && screen.querySelector('#mpx-room-priv button.active').getAttribute('data-priv') === 'private');
    var rcb = screen.querySelector('#mpx-room-combat button.active'); var combat = !!(rcb && rcb.getAttribute('data-combat') === 'on');   // build69: the host's per-room combat choice (the source of truth for every match in this room)
    room = { id: newRoomId(), name: nm, priv: priv, combat: combat, isHost: true, ch: null, seat: 'p1', members: {}, p1: ME.id, p2: null };
    try { delete sel.audioUrl; } catch (e) {}   // review fix 1: a fresh NON-show room must never inherit a prior show's review audio
    joinRoomChannel(room.id, 'p1');
    reannounce();
    enterRoomWaiting();
    advertiseRoom();
  }
  function advertiseRoom() {
    if (!lobbyCh || !room.id || !room.isHost) return;
    var count = 1 + (room.p2 ? 1 : 0);
    lobbyCh.send({ type: 'broadcast', event: 'room-meta', payload: {
      rid: room.id, name: room.name, priv: room.priv, combat: !!room.combat, hostId: ME.id, hostName: ME.name, count: count, max: 2, at: Date.now(),
      show: room.show ? 1 : 0, live: matchLive ? 1 : 0 } });   // build102s: additive show/live flags (old clients ignore unknown fields; joiners adopt `show` for the seat policy)
  }
  function closeRoom(silent) {
    _cancelShowOpen();   // review fix 7: a pending GO LIVE (and its 8s watchdog) dies with ANY room close — inert var writes for normal MP
    if (room.id && room.show) {   // build102s: a closing SHOW room says goodbye — final live:false snap (spectator recovery, judge mandate) + heartbeat/persist teardown
      if (room.isHost) { matchId = null; matchLive = false; try { sendShowSnap(); } catch (e) {} }
      stopShowHeartbeat(); clearShowRoom();
      try { delete sel.audioUrl; } catch (e) {}   // review fix 1: the review audio dies with the show — it must never leak into a later normal match
      var _wy = screen.querySelector('.mpx-sc.you .mpx-sc-who'); if (_wy) _wy.textContent = 'YOU';   // undo the spectator-verdict relabel
    }
    if (room.id && room.isHost && lobbyCh) { try { lobbyCh.send({ type: 'broadcast', event: 'room-gone', payload: { rid: room.id } }); } catch (e) {} }
    leaveRoomChannel();
    room = { id: null, name: null, priv: false, combat: false, isHost: false, ch: null, seat: null, members: {}, p1: null, p2: null,
      show: false, submitterId: null, submitterName: '', revToken: null, invited: false, pendingChal: null, declined: {} };
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
    ch.on('broadcast', { event: 'song' }, function (m) { onSong(m.payload); });   // build64: the room host's live track/stage/difficulty picks reach the joiner in the waiting room
    ch.on('broadcast', { event: 'show-snap' }, function (m) { onShowSnap(m.payload); });   // build102s: live-show heartbeat (inert for normal rooms — only a show host ever emits it)
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        roomSP.start();
        if (room.show && room.isHost) {   // build102s: show room is live — cancel the solo-fallback watchdog, seed the locked song + the first snap
          if (_showOpenT) { clearTimeout(_showOpenT); _showOpenT = 0; }
          try { broadcastSong(); } catch (e) {}
          sendShowSnap();
        }
      }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        banner('mpx-rooms-msg', 'Could not reach that room. Back out and retry.');
        if (room.show && room.isHost) _showRoomFail();   // build102s (judge mandate): solo-always-works — bail back to the review card
      }
    });
  }
  function leaveRoomChannel() { try { if (roomSP) roomSP.stop(); if (room.ch) supa.removeChannel(room.ch); } catch (e) {} room.ch = null; roomSP = null; }
  function onRoomPeers(all) {
    if (!room.ch) return;
    room.members = all;
    // build102t: cache the watcher count for the state-interval degrade rule (host + streaming challenger read it)
    if (room.show) { try { _specNCache = Object.keys(all).filter(function (id) { return all[id].seat === 'spec'; }).length; } catch (e) {} }
    // seat assignment is host-authoritative: host = p1; first non-spec joiner = p2.
    if (room.isHost && room.show) {
      // build102s SEAT POLICY (both judges' blocker): in a SHOW room NOBODY is auto-seated — ids are spoofable and
      // the rid is public, so the challenger seat is HOST-GRANTED. A non-spec joiner becomes a PENDING challenger
      // (ACCEPT/DECLINE card); the submitter jumps the pending queue but STILL needs the host's accept.
      room.declined = room.declined || {};
      if (room.p2 && room.members[room.p2]) room._graceUntil = 0;   // review fix 4b: challenger's presence re-synced → drop the reconnect grace
      if (room.p2 && !room.members[room.p2] && !(room._graceUntil && Date.now() < room._graceUntil)) { room.p2 = null; advertiseRoom(); sendShowSnap(); }   // seated challenger left → seat reopens (grace shields the just-restored seat until presence warms up)
      var pend = null;
      if (!room.p2) {
        var joiners = Object.keys(room.members).filter(function (id) { return id !== ME.id && room.members[id].seat !== 'spec' && !room.declined[id]; });
        for (var ji = 0; ji < joiners.length; ji++) { if (joiners[ji] === room.submitterId) { pend = joiners[ji]; break; } }   // the artist first
        if (!pend) pend = joiners[0] || null;
      }
      if (pend !== room.pendingChal) { room.pendingChal = pend; sendShowSnap(); }
    } else if (room.isHost) {
      var others = Object.keys(room.members).filter(function (id) { return id !== ME.id && room.members[id].seat !== 'spec'; });
      var p2 = others[0] || null;
      if (p2 !== room.p2) { room.p2 = p2; advertiseRoom(); }
    }
    paintRoomWaiting();
  }
  // host launches: tells both seats to spin up the SAME match channel; spectators get the mid too.
  function startRoomMatch() {
    if (!room.isHost || (!room.p2 && !room.show)) return;   // build102s: a SHOW host may start with an EMPTY challenger seat (solo run); normal rooms keep the p2 guard
    var mid = 'm' + room.id.slice(1) + Date.now().toString(36).slice(-3);
    room.ch.send({ type: 'broadcast', event: 'room-start', payload: { mid: mid, p1Id: room.p1, p2Id: room.p2 || null } });
    onRoomStart({ mid: mid, p1Id: room.p1, p2Id: room.p2 || null });
  }
  function onRoomStart(p) {
    if (!p || !p.mid) return;
    var oppId = (ME.id === p.p1Id) ? p.p2Id : p.p1Id;
    var oppMetaLocal = room.members[oppId] || lobby[oppId] || null;
    if (room.seat === 'spec' || (ME.id !== p.p1Id && ME.id !== p.p2Id)) {
      _specShowSolo = !!(room.show && !p.p2Id);   // build102s: watching a SOLO show run → no verdict card at song end
      if (room.show) { _specIds = { p1: p.p1Id, p2: p.p2Id || null }; }   // build102t: deck seat assignment for the dual-deck stage
      spectateMatch(p.mid, room.members[p.p1Id], room.members[p.p2Id]); return;
    }
    var role = (ME.id === p.p1Id) ? 'host' : 'guest';
    if (room.show) spectating = false;   // build102s: a seated show player may have WATCHED the prior run (spectateMatch flips the flag) — they're a player now, so the rank/settle gates must see them as one
    // build102s: fr.solo → the host starts the match channel with no guest handshake (empty seat)
    _fromRoom = { sel: (sel.trackId ? Object.assign({}, sel) : null), solo: !!(room.show && !p.p2Id && ME.id === p.p1Id) };   // carry host's locked track
    startMatchChannel(p.mid, role, oppMetaLocal);
  }

  // ---- guest: join a listed room (as duelist or spectator) ----
  function joinRoom(rid, asSpec) {
    if (!supa || !lobbyCh) return;
    var meta = roomsDir[rid]; if (!meta) { banner('mpx-rooms-msg', 'That room just closed.'); return; }
    if (!asSpec && meta.count >= meta.max) { banner('mpx-rooms-msg', 'Room is full — spectate instead.'); return; }
    room = { id: rid, name: meta.name, priv: meta.priv, combat: !!meta.combat, isHost: false, ch: null, seat: asSpec ? 'spec' : 'p2', members: {}, p1: meta.hostId, p2: asSpec ? null : ME.id,
      show: !!meta.show, submitterId: null, submitterName: '', revToken: null, invited: false, pendingChal: null, declined: {} };   // build69: adopt the host's advertised room combat. build102s: adopt `show` (the show-snap heartbeat also late-adopts it for stale metas)
    spectating = !!asSpec;
    joinRoomChannel(rid, room.seat);
    reannounce();
    enterRoomWaiting();
  }

  // ---- build60: short, memorable ROOM CODE derived deterministically from the room id (no backend needed) ----
  function roomCode(rid) {
    var s = String(rid || ''); var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    h = Math.abs(h); var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';   // no ambiguous 0/O/1/I
    for (var k = 0; k < 4; k++) { out += A.charAt(h % A.length); h = Math.floor(h / A.length); }
    return out;
  }
  function roomInviteLink(rid) { return location.origin + location.pathname + '?mproom=' + encodeURIComponent(rid); }

  // ---- waiting-room view (reuses the setup step shell) ----
  function enterRoomWaiting() {
    enterSetup();   // reuse the existing setup UI (track pick disabled for non-host as usual)
    var ctx = $('mpx-roomctx'); if (ctx) ctx.hidden = false;
    var nmEl = $('mpx-roomctx-name'); if (nmEl) nmEl.textContent = room.name || 'Room';
    var pv = $('mpx-roomctx-priv'); if (pv) pv.textContent = room.priv ? '· PRIVATE' : '· PUBLIC';
    var closeBtn = $('mpx-room-close');
    if (closeBtn) closeBtn.textContent = room.isHost ? 'CLOSE ROOM' : 'LEAVE ROOM';
    // build60: surface the invite bar + room code so a host can pull a friend in; the host also gets "Add a CPU".
    var bar = $('mpx-invitebar'), codeRow = $('mpx-invite-code-row'), codeEl = $('mpx-invite-code'), addCpu = $('mpx-add-cpu');
    // build102s: in a SHOW room the generic opponent bar is hidden — the challenger seat is host-granted (seat
    // policy) and VS-CPU would closeRoom() and kill every watcher. The show seat card replaces it.
    if (bar) bar.hidden = !!room.show;
    if (room.isHost && room.id) {
      if (codeRow) codeRow.hidden = false;
      if (codeEl) codeEl.textContent = roomCode(room.id);
      if (addCpu) addCpu.hidden = false;
    } else {
      if (codeRow) codeRow.hidden = true;
      if (addCpu) addCpu.hidden = true;
    }
    paintRoomWaiting();
  }
  function paintRoomWaiting() {
    var specCount = Object.keys(room.members).filter(function (id) { return room.members[id].seat === 'spec'; }).length;
    // build102t: past the softPresence ≤10-peer design the roster is no longer authoritative — a show paints '10+'
    var sc = $('mpx-roomctx-spec'); if (sc) sc.textContent = specCount ? (((room.show && specCount > 10) ? '10+' : specCount) + ' watching') : '';
    var opp = room.isHost ? (room.p2 && room.members[room.p2]) : (room.members[room.p1]);
    var dot = $('mpx-dot-opp');
    if (dot) {
      if (opp) { dot.setAttribute('data-state', 'here'); dot.textContent = (opp.name || 'OPPONENT').slice(0, 12); }
      else { dot.setAttribute('data-state', 'waiting'); dot.textContent = spectating ? 'WATCHING' : 'WAITING…'; }
    }
    // build60: explicit, updating waiting status (announces arrivals so the wait never reads as frozen).
    var ws = $('mpx-waitstatus');
    if (ws) {
      ws.hidden = false; ws.classList.remove('ready');
      if (opp) { ws.textContent = (opp.name || 'Your opponent') + ' joined — pick a track and you\'re both set.'; }
      else if (spectating) { ws.textContent = 'Watching this room — the match starts when the host begins.'; }
      else if (room.isHost) { ws.textContent = 'You\'re hosting — waiting for 1 player. Share the code, or add a CPU to start now.'; }
      else { ws.textContent = 'Waiting for the host to start…'; }
      // build100f (relatability): remind both players combat is on while they wait, so the mid-song freeze is expected.
      if (room.combat) ws.textContent += ' ⚡ Combat ON — a combo streak shocks the rival ~2s.';
      if (room.show) {   // build102s: show-room copy replaces the stock strings (song locked, host never blocked)
        var seatedId = room.isHost ? room.p2 : (room._snapP2 || null);
        if (room.isHost) ws.textContent = room.p2 ? '⚔ Challenger seated — START runs the head-to-head.' : 'LIVE SHOW — START plays it solo; the artist can join between runs.';
        else if (spectating) ws.textContent = room._snapLive ? 'LIVE — watching the run…' : 'LIVE SHOW — you\'re watching. The run starts when the host begins.';
        else if (seatedId === ME.id) ws.textContent = room._snapLive ? 'Match in progress — you\'re seated for the NEXT run.' : 'You\'re seated — the host starts the match.';
        else ws.textContent = room._snapLive ? 'Match in progress — you\'re in line for the NEXT run.' : 'LIVE SHOW — hang tight, the host will wave you in.';
      }
    }
    try { paintShowRoom(); } catch (e) {}   // build102s: show chrome (banner/seat/invite) — self-hides for normal rooms
  }

  // ---- room directory (browser) ----
  function onRoomMeta(p) {
    if (!p || !p.rid) return;
    if (p.hostId === ME.id) return;
    // build60: an invite deep-link (?mproom=) auto-joins its target the moment the host's meta arrives — even private rooms.
    if (_pendingRoomJoin && p.rid === _pendingRoomJoin && !room.id) {
      var _asSpec = _pendingRoomSpec;   // build102: spectate deep-links must never take a player seat
      _pendingRoomJoin = null; roomsDir[p.rid] = p; roomsDir[p.rid].at = Date.now();
      banner('mpx-lobby-msg', ''); joinRoom(p.rid, _asSpec); return;
    }
    if (p.priv) return;   // private rooms are not listed in the browser (invite/qm only)
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
    renderLiveNow();   // build61: keep the lobby LIVE NOW surface in sync with the directory (single update point)
  }

  // ===================== BUILD61: LIVE NOW (open-bracket discovery at the top of the lobby) =====================
  // Surfaces OPEN tournaments + rooms from the EXISTING toursDir/roomsDir (softPresence-fed — no new channel).
  // Each entry one-taps into the SAME join path as ?mpjoin=/?mproom= and the room-code input. Auto-promoted
  // whenever openRoomCount() > 0; otherwise a tasteful "host one" CTA. Only painted while the lobby step is up.
  // visual-overhaul: small inline SVG glyphs for the LIVE-NOW list sparks (replace off-brand emoji 🏆/🎸 —
  // the controller/robot emoji rendered PURPLE/BLUE, violating the brand rule). Crimson/gold/chrome only.
  var SVG_TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v4a5 5 0 0 1-10 0V4z"></path><path d="M5 5H3v2a3 3 0 0 0 3 3"></path><path d="M19 5h2v2a3 3 0 0 1-3 3"></path></svg>';
  var SVG_PICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-4 0-7 2.4-7 6 0 5.4 5.2 11.4 6.4 12.6a.8.8 0 0 0 1.2 0C13.8 20.4 19 14.4 19 9c0-3.6-3-6-7-6z"></path></svg>';

  function renderLiveNow() {
    var wrap = $('mpx-livenow'); if (!wrap) return;
    // only meaningful on the lobby step (the directory is irrelevant inside a match/room/bracket)
    var card = screen.querySelector('.mp-card'), stepName = card && card.getAttribute('data-mp-step');
    if (stepName && stepName !== 'lobby') { wrap.hidden = true; return; }
    var list = $('mpx-livenow-list'), empty = $('mpx-livenow-empty'), nEl = $('mpx-livenow-n');
    // OPEN tournaments lead (joinable only while still filling), then OPEN public rooms with a seat free.
    var tids = Object.keys(toursDir).filter(function (tid) { var r = toursDir[tid]; return r && r.state !== 'live' && r.state !== 'done'; });
    var rids = Object.keys(roomsDir).filter(function (rid) { var r = roomsDir[rid]; return r && (r.count || 1) < (r.max || 2); });
    wrap.hidden = false;
    // visual-overhaul (owner ask): a LIVE / hostable tournament gets promoted to a FRONT-AND-CENTER hero card.
    var heroShown = renderTourHero(tids);
    var total = tids.length + rids.length;
    if (nEl) nEl.textContent = total ? (total + ' open') : '';
    if (!total) {
      if (list) { list.innerHTML = ''; list.hidden = true; }
      // when the hero is up there's already a prominent tournament surface — keep the quiet "host one" strip only when nothing is live
      if (empty) empty.hidden = heroShown;
      return;
    }
    if (empty) empty.hidden = true;
    if (!list) return;
    list.hidden = false;
    // the bracket featured in the hero shouldn't also repeat as a row below it
    var heroTid = _tourHeroTid;
    var tourHtml = tids.filter(function (tid) { return tid !== heroTid; }).map(function (tid) {
      var r = toursDir[tid], cnt = r.count || 1, max = r.max || TOUR_MAX, full = cnt >= max;
      return '<div class="mpx-roomcard' + (full ? ' full' : '') + '">' +
        '<span class="mpx-rc-spark tour">' + SVG_TROPHY + '</span>' +
        '<span class="mpx-rc-meta"><span class="mpx-rc-name">' + esc(r.name || 'Bracket') + '</span>' +
        '<span class="mpx-rc-sub"><span class="mpx-rc-tag tour">BRACKET</span> host ' + esc(r.hostName || 'host') +
        ' · <span class="mpx-rc-count">' + cnt + '/' + max + '</span></span></span>' +
        '<span class="mpx-rc-act"><button class="mpx-rc-join" data-ln-jt="' + esc(tid) + '"' + (full ? ' disabled' : '') + '>' + (full ? 'FULL' : 'JOIN') + '</button></span></div>';
    }).join('');
    var roomHtml = rids.map(function (rid) {
      var r = roomsDir[rid], cnt = r.count || 1, max = r.max || 2;
      if (r.show) {   // build102t: LIVE NOW mirrors the browser — show rooms are WATCH-first (seat is host-granted)
        return '<div class="mpx-roomcard">' +
          '<span class="mpx-rc-spark">' + SVG_PICK + '</span>' +
          '<span class="mpx-rc-meta"><span class="mpx-rc-name">' + esc(r.name || 'Live Show') + '</span>' +
          '<span class="mpx-rc-sub"><span class="mpx-rc-tag live">🔴 LIVE SHOW</span> host ' + esc(r.hostName || 'host') + '</span></span>' +
          '<span class="mpx-rc-act"><button class="mpx-rc-join" data-ln-watch="' + esc(rid) + '">WATCH</button></span></div>';
      }
      return '<div class="mpx-roomcard">' +
        '<span class="mpx-rc-spark">' + SVG_PICK + '</span>' +
        '<span class="mpx-rc-meta"><span class="mpx-rc-name">' + esc(r.name || 'Room') + '</span>' +
        '<span class="mpx-rc-sub"><span class="mpx-rc-tag pub">PUBLIC</span> host ' + esc(r.hostName || 'host') +
        ' · <span class="mpx-rc-count">' + cnt + '/' + max + '</span></span></span>' +
        '<span class="mpx-rc-act"><button class="mpx-rc-join" data-ln-join="' + esc(rid) + '">JOIN</button></span></div>';
    }).join('');
    list.innerHTML = tourHtml + roomHtml;
    [].forEach.call(list.querySelectorAll('[data-ln-jt]'), function (b) { b.addEventListener('click', function () { joinTour(b.getAttribute('data-ln-jt')); }); });
    [].forEach.call(list.querySelectorAll('[data-ln-join]'), function (b) { b.addEventListener('click', function () { joinRoom(b.getAttribute('data-ln-join'), false); }); });
    [].forEach.call(list.querySelectorAll('[data-ln-watch]'), function (b) { b.addEventListener('click', function () { joinRoom(b.getAttribute('data-ln-watch'), true); }); });   // build102t: show rooms join as WATCHER
  }

  // visual-overhaul: pick the single most prominent active tournament and paint the gold hero card at the top of
  // the LIVE NOW surface. Priority: (1) a bracket I'm hosting/in → MANAGE, (2) an OPEN joinable bracket → JOIN,
  // (3) a remote LIVE bracket in the directory → WATCH (routes to the rooms browser where spectating lives).
  // No active tournament → hero hidden, return false (caller keeps the quiet "host one" strip).
  var _tourHeroTid = null;
  function renderTourHero(openTids) {
    var hero = $('mpx-tour-hero'); if (!hero) return false;
    _tourHeroTid = null;
    var mode = null, data = null;
    // (1) my own active bracket — I'm hosting or seated in a live/filling tournament
    if (tour && tour.id && (tour.isHost || tour.meIn) && tour.state !== 'done') {
      mode = 'mine';
      data = { name: tour.name || 'Your Bracket', host: ME.name,
        count: (tour.members ? Object.keys(tour.members).length : 1) || 1,
        max: tour.size || TOUR_MAX, live: tour.state === 'live' };
    } else {
      // (2) an OPEN joinable bracket I'm not in (filling, has a seat); fall back to (3) a remote LIVE bracket
      var openId = (openTids || []).filter(function (tid) { var r = toursDir[tid]; return r && (r.count || 1) < (Math.min(TOUR_MAX, r.size || r.max || TOUR_MAX)); })[0];
      if (openId) {
        var ro = toursDir[openId]; mode = 'join'; _tourHeroTid = openId;
        data = { name: ro.name || 'Bracket', host: ro.hostName || 'host', count: ro.count || 1, max: ro.max || TOUR_MAX, live: false };
      } else {
        var liveId = Object.keys(toursDir).filter(function (tid) { return toursDir[tid] && toursDir[tid].state === 'live'; })[0];
        if (liveId) { var rl = toursDir[liveId]; mode = 'watch'; data = { name: rl.name || 'Bracket', host: rl.hostName || 'host', count: rl.count || 1, max: rl.max || TOUR_MAX, live: true }; }
      }
    }
    if (!mode) { hero.hidden = true; return false; }
    var stateEl = $('mpx-tour-hero-state'), nameEl = $('mpx-tour-hero-name'), subEl = $('mpx-tour-hero-sub'),
        cntEl = $('mpx-tour-hero-count'), ctaLbl = $('mpx-tour-hero-cta-label');
    if (nameEl) nameEl.textContent = data.name;
    if (cntEl) cntEl.textContent = data.count + '/' + data.max + ' players';
    var stateTxt, ctaTxt, subTxt;
    if (mode === 'mine') {
      stateTxt = data.live ? 'YOUR BRACKET · LIVE' : 'YOUR BRACKET';
      ctaTxt = data.live ? 'RESUME' : 'MANAGE'; subTxt = 'host ' + data.host + ' · single-elim, last one standing';
    } else if (mode === 'join') {
      stateTxt = 'OPEN BRACKET'; ctaTxt = 'JOIN'; subTxt = 'host ' + data.host + ' · grab a seat before it fills';
    } else {
      stateTxt = 'LIVE NOW'; ctaTxt = 'WATCH'; subTxt = 'host ' + data.host + ' · bracket underway';
    }
    if (stateEl) stateEl.textContent = stateTxt;
    if (ctaLbl) ctaLbl.textContent = ctaTxt;
    if (subEl) subEl.textContent = subTxt;
    var cta = $('mpx-tour-hero-cta');
    if (cta) {
      cta.onclick = function () {
        if (mode === 'mine') { try { enterTourRoom(); } catch (e) {} }
        else if (mode === 'join') { try { joinTour(_tourHeroTid); } catch (e) {} }
        else { try { gotoRooms('browse'); } catch (e) {} }
      };
    }
    hero.hidden = false;
    return true;
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
        '<span class="mpx-rc-spark tour">' + SVG_TROPHY + '</span>' +
        '<span class="mpx-rc-meta"><span class="mpx-rc-name">' + esc(r.name || 'Bracket') + '</span>' +
        '<span class="mpx-rc-sub"><span class="mpx-rc-tag ' + (live ? 'live">LIVE' : 'tour">BRACKET') + '</span> host ' + esc(r.hostName || 'host') + ' · <span class="mpx-rc-count">' + (r.count || 1) + '/' + (r.max || 10) + '</span></span></span>' +
        '<span class="mpx-rc-act">' +
          // build100q (#spectate): a LIVE bracket is no longer a dead "LIVE" button — it's a WATCH door into the live
          // spectator view. Open/joinable brackets still JOIN; a full-but-not-live bracket is FULL.
          (live
            ? '<button class="mpx-rc-spec" data-wt="' + esc(tid) + '">WATCH</button>'
            : '<button class="mpx-rc-join" data-jt="' + esc(tid) + '"' + (full ? ' disabled' : '') + '>' + (full ? 'FULL' : 'JOIN') + '</button>') +
        '</span></div>';
    }).join('');
    host.innerHTML = tourCards + ids.map(function (rid) {
      var r = roomsDir[rid], full = (r.count || 1) >= (r.max || 2);
      if (r.show) {
        // build102t (deferred C1 judge item): a LIVE SHOW room is a WATCH destination — the challenger seat is
        // host-granted (C1 seat policy), so never paint a JOIN that invites randoms to a seat they can't take.
        return '<div class="mpx-roomcard">' +
          '<span class="mpx-rc-spark">' + SVG_PICK + '</span>' +
          '<span class="mpx-rc-meta"><span class="mpx-rc-name">' + esc(r.name || 'Live Show') + '</span>' +
          '<span class="mpx-rc-sub"><span class="mpx-rc-tag live">🔴 LIVE SHOW</span> host ' + esc(r.hostName || 'host') + (r.live ? ' · <span class="mpx-rc-count">on air</span>' : '') + '</span></span>' +
          '<span class="mpx-rc-act"><button class="mpx-rc-spec" data-spec="' + esc(rid) + '">WATCH</button></span></div>';
      }
      return '<div class="mpx-roomcard' + (full ? ' full' : '') + '">' +
        '<span class="mpx-rc-spark">' + SVG_PICK + '</span>' +
        '<span class="mpx-rc-meta"><span class="mpx-rc-name">' + esc(r.name || 'Room') + '</span>' +
        '<span class="mpx-rc-sub"><span class="mpx-rc-tag pub">PUBLIC</span>' +
          // build100f (relatability): disclose COMBAT on the room card so a joiner knows BEFORE joining that a combo can
          // freeze them ~2s mid-song (previously the only cue was the post-hoc "RIVAL SHOCKED YOU" veil — read as a bug).
          (r.combat ? '<span class="mpx-rc-tag" style="background:rgba(255,31,46,0.18);color:#ff6b78;margin-left:4px;" title="Combat ON — a combo streak shocks the rival for ~2s">⚡ COMBAT</span>' : '') +
          ' host ' + esc((r.hostName || 'host')) + ' · <span class="mpx-rc-count">' + (r.count || 1) + '/' + (r.max || 2) + '</span></span></span>' +
        '<span class="mpx-rc-act">' +
          '<button class="mpx-rc-join" data-join="' + esc(rid) + '"' + (full ? ' disabled' : '') + '>' + (full ? 'FULL' : 'JOIN') + '</button>' +
          '<button class="mpx-rc-spec" data-spec="' + esc(rid) + '">WATCH</button>' +
        '</span></div>';
    }).join('');
    [].forEach.call(host.querySelectorAll('[data-join]'), function (b) { b.addEventListener('click', function () { joinRoom(b.getAttribute('data-join'), false); }); });
    [].forEach.call(host.querySelectorAll('[data-spec]'), function (b) { b.addEventListener('click', function () { joinRoom(b.getAttribute('data-spec'), true); }); });
    [].forEach.call(host.querySelectorAll('[data-jt]'), function (b) { b.addEventListener('click', function () { joinTour(b.getAttribute('data-jt')); }); });   // build9
    [].forEach.call(host.querySelectorAll('[data-wt]'), function (b) { b.addEventListener('click', function () { watchTour(b.getAttribute('data-wt')); }); });   // build100q: WATCH a live bracket
  }

  // ===================== BUILD8: SPECTATE =====================
  function spectateMatch(mid, p1meta, p2meta) {
    spectating = true; matchLive = true; finishedLocal = true;   // finishedLocal=true → never wait on "my" result
    // build102s: snapshot show-spectate mode at ENTRY — only a show room gets the neutral dual-final verdict;
    // a normal-room spectate renders the exact pre-diff card (owner's byte-identity decree).
    _specShow = !!room.show; _specFinals = {};
    // build102u (review BLOCKER 1): every watch starts with a CLEAN run clock + feeds — a stale _specAtMs from the
    // previous run made _syncSpecAudio clamp to buffer-end and the ghost advance eat the whole chart on run #2
    // (empty decks, no audio, unrecoverable). onShowSnap's late-join sets its atMs AFTER this call by design.
    if (_specShow) { _specAtMs = 0; _specTicks = {}; _specStates = {}; _specFedReal = false; }
    if (_specVerdictT) { clearTimeout(_specVerdictT); _specVerdictT = 0; }
    oppMeta = p1meta || p2meta || null;
    step('go'); var gn = $('mpx-go-num'); if (gn) gn.textContent = 'SPECTATING';
    var watchCh = supa.channel('rr-match-' + mid, { config: { broadcast: { self: false } } });
    matchCh = watchCh;
    watchCh.on('broadcast', { event: 'tick' }, function (m) {
      lastOppTick = m.payload;
      if (_specShow && m.payload) {
        _specTicks[String(m.payload.id || m.payload.name || 'p1')] = m.payload; _specLastFeedAt = Date.now(); _specFedReal = true;   // build102t: keyed per player for the dual decks + liveness
        // build102u (review MAJOR 2c): DRIFT CORRECTION — the players' clock can shift off wall-time (host pause,
        // engine hiccup). The HOST's streamed progress is the authority: >2.5s apart → re-seat our clock + audio +
        // ghost index (the advance loop tolerates _specIdx rewinding to 0; it re-seeks forward in one pass).
        try {
          var _tp = m.payload;
          if (_specDp && _specChart && _specChart.duration && _tp.prog != null && (_specShowSolo || String(_tp.id || '') === String(_specIds.p1 || ''))) {
            var _want = _tp.prog * _specChart.duration, _cur = _specTime();
            if (_want > 0.5 && Math.abs(_want - _cur) > 2.5) {
              _specAtMs = Date.now() - _want * 1000;
              try { _specDp.stop(); } catch (e0) {} _specDp = null;
              _specIdx = 0;
              _syncSpecAudio();
            }
          }
        } catch (e1) {}
      }
    });
    if (_specShow) {   // build102t: show watchers also consume the id-tagged state stream + the one-shot 'start' (sel/atMs)
      watchCh.on('broadcast', { event: 'state' }, function (m) {
        var p = m.payload; if (!p) return;
        _specStates[String(p.id || 'p1')] = p; _specLastFeedAt = Date.now(); _specFedReal = true;
      });
      watchCh.on('broadcast', { event: 'start' }, function (m) {
        var p = m.payload; if (!p || !p.atMs) return;
        _specAtMs = p.atMs; if (p.sel) { sel = p.sel; }
        _specLastFeedAt = Math.max(_specLastFeedAt || 0, p.atMs);   // liveness counts from the ACTUAL run start, not the mount (the 10s lead-in is silent by design)
        _syncSpecAudio();   // a pre-start watcher locks audio to the shared clock the moment the run schedules
      });
    }
    watchCh.on('broadcast', { event: 'final' }, function (m) {
      var _fp = m.payload || {};
      if (_specShowSolo) {   // build102s: a SOLO show run has no verdict for watchers — back to the waiting room (the host returns there for the next run)
        endSpectate('✓ ' + ((_fp.name || 'The host') + ' finished — ' + Number(_fp.score || 0).toLocaleString() + '. Waiting for the next run…'));
        return;
      }
      if (_specShow) {   // show versus: collect BOTH finals (each player broadcasts one) — verdict names the HIGHER score
        _specFinals[String(_fp.id || _fp.name || ('p' + Object.keys(_specFinals).length))] = _fp;
        if (Object.keys(_specFinals).length >= 2) _renderSpecVerdict();
        else if (!_specVerdictT) _specVerdictT = setTimeout(function () { _specVerdictT = 0; _renderSpecVerdict(); }, 8000);   // one final never arrived → render what we have
        return;
      }
      oppFinal = m.payload; myFinal = myFinal || { score: 0 }; showWinner();   // pre-diff normal-spectate card, untouched
    });
    watchCh.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        // mount a read-only panel over whatever screen is up; spectators don't run the engine.
        screen.classList.add('active'); activeNow = true;
        mountOppPanel();
        var panel = $('mp-opp'); if (panel) panel.classList.add('spectate');
        var sp = panel && panel.querySelector('.mo-spec'); if (!sp && panel) { var s = document.createElement('div'); s.className = 'mo-spec'; s.textContent = 'SPECTATING'; panel.insertBefore(s, panel.firstChild); }
        startSpectatorTick();
        // build102t: SHOW spectate gets the real dual-deck stage (compact panel stays beneath as the fallback)
        if (_specShow && sel && sel.audioUrl) { try { _mountSpecStage(); } catch (e) { console.error('[mp] spec stage mount failed', e); } }
      }
    });
  }
  function startSpectatorTick() {
    stopTick();
    function frame() { oppRaf = requestAnimationFrame(frame); if (oppPanel && oppPanel.parentNode) renderOpp(null); }
    oppRaf = requestAnimationFrame(frame);
  }

  // ===================== BUILD102s: LIVE SHOW (Phase-2 C1) =====================
  // The host review flow (/game?review=<token> → #review-launch) gains GO LIVE: a public room flagged
  // room.show=true with the review song pre-locked (sel.audioUrl = the decodable analysis_url — the SAME
  // visibility class as catalog audio_url, so it may ride Realtime; the review TOKEN never does). The host
  // plays even if nobody joins (solo run), the artist is invited via POST /show/invite, everyone else watches.
  // Every function here is dead code unless room.show — normal MP stays byte-identical (owner decree).
  function openShowRoom(opts) {
    opts = opts || {};
    if (!supa) {
      try { window.RhythmGame.showToast && window.RhythmGame.showToast('Live rooms need a connection — solo PLAY still works.', 'error'); } catch (e) {}
      _reshowReviewCard(opts);
      return false;
    }
    _pendingShowRoom = opts; _lastShowSpec = opts;
    open();   // raise the MP screen → onActivated() → joinLobby(); the lobby SUBSCRIBED handler consumes the spec
    // SOLO-ALWAYS-WORKS (security judge mandate): if the lobby never comes up in ~8s, banner and put the review
    // card back so the Phase-1 solo PLAY stays one click away (owner's non-negotiable). GUARDED: only fires while
    // the GO LIVE attempt is still pending — a host who backed out (teardown cleared the pending spec) is left alone.
    if (_showOpenT) clearTimeout(_showOpenT);
    _showOpenT = setTimeout(function () { _showOpenT = 0; if (!_pendingShowRoom) return; _pendingShowRoom = null; _showRoomFail(); }, 8000);
    // fast-path poll: the lobby may already be up (SUBSCRIBED won't re-fire) or the MP screen may take a
    // moment to activate — consume the spec as soon as the lobby channel exists (the 8s fallback still rules).
    var _sopIv = setInterval(function () {
      if (!_pendingShowRoom) { clearInterval(_sopIv); return; }
      if (lobbyCh) { clearInterval(_sopIv); _consumeShowRoom(); }
    }, 500);
    return true;
  }
  function _consumeShowRoom() {
    var spec = _pendingShowRoom; if (!spec) return;
    _pendingShowRoom = null;
    try { closeTour(true); } catch (e) {}
    try { if (room.id) closeRoom(true); } catch (e) {}
    teardownMatch();   // never inherit stale match state into the show
    room = { id: newRoomId(), name: ((spec.title || 'Review') + ' — LIVE').slice(0, 28), priv: false, combat: false, isHost: true, ch: null, seat: 'p1', members: {}, p1: ME.id, p2: null,
      show: true, submitterId: spec.submitterId || null, submitterName: spec.submitterName || '', revToken: spec.revToken || null, invited: false, pendingChal: null, declined: {} };
    // the review song is PRE-LOCKED; audioUrl is the NEW sel field resolveShowStart routes on (never the demo)
    sel = { trackId: spec.trackId || null, title: spec.title || null, artist: spec.artist || null, art: spec.art || null,
      difficulty: spec.difficulty || 'medium', demo: false, env: null, audioUrl: spec.audioUrl || null };
    _soloRun = false; _showAtMs = 0; _inviteBusy = false; _inviteAt = 0; _inviteRenotified = false;
    // fresh watchdog for the ROOM-channel subscribe stage (the internal closeRoom above cancels any prior one);
    // guarded so it can only ever fail THIS show room — never one the host opened later.
    if (_showOpenT) clearTimeout(_showOpenT);
    var _wdRid = room.id;
    _showOpenT = setTimeout(function () { _showOpenT = 0; if (room.id === _wdRid && room.show && room.isHost) _showRoomFail(); }, 8000);
    joinRoomChannel(room.id, 'p1');   // SUBSCRIBED → cancels _showOpenT + broadcasts song + first snap
    reannounce();
    enterRoomWaiting();
    advertiseRoom();
    startShowHeartbeat();
    persistShowRoom();
    banner('mpx-setup-msg', '🔴 LIVE SHOW room open — START plays it solo; call in the artist any time.');
  }
  // re-surface the Phase-1 review launch card (solo fallback). __rrReview is the catalog's card driver; if it's
  // been stripped, just un-hide the element — the card still holds its last wired state.
  function _reshowReviewCard(spec) {
    try {
      if (window.__rrReview && window.__rrReview.open && spec && spec.trackId) {
        window.__rrReview.open({ id: spec.trackId, title: spec.title, artist_name: spec.artist, artist_credit_name: spec.artist,
          artwork_url: spec.art, audio_url: spec.audioUrl, analysis_url: spec.audioUrl, chart_status: 'pending', _review: true,
          _role: 'host', _submitterId: spec.submitterId || null, _submitterName: spec.submitterName || '' });
        return;
      }
    } catch (e) {}
    try { var ov = document.getElementById('review-launch'); if (ov) ov.classList.add('on'); } catch (e) {}
  }
  function _showRoomFail() {
    if (_showOpenT) { clearTimeout(_showOpenT); _showOpenT = 0; }
    stopShowHeartbeat(); clearShowRoom();
    var spec = _lastShowSpec;
    try { if (room.id && room.show) closeRoom(true); } catch (e) {}   // only ever closes a SHOW room — never a normal room the host opened since
    step('lobby');
    banner('mpx-lobby-msg', '⚠ Couldn\'t open the live room — you can still play the review solo.');
    // the review card must be SEEN and CLICKABLE: drop the MP screen (it sits above the card) before re-showing
    try { screen.classList.remove('active'); activeNow = false; } catch (e) {}
    _reshowReviewCard(spec);
  }
  // ---- the 4s show heartbeat (host → room channel). Small cousin of the t-snapshot: late arrivals learn
  // sel/mid/atMs, a mis-seated client self-demotes, watchers recover when a run dies. sel carries audioUrl
  // (accepted visibility class) — NEVER any token.
  function sendShowSnap() {
    if (!room.ch || !room.id || !room.isHost || !room.show) return;
    var specN = 0;
    try { specN = Object.keys(room.members).filter(function (id) { return room.members[id].seat === 'spec'; }).length; } catch (e) {}
    try {
      room.ch.send({ type: 'broadcast', event: 'show-snap', payload: {
        rid: room.id, mid: matchId || null, live: !!matchLive, sel: sel, atMs: _showAtMs || 0,
        p2Id: room.p2 || null, pend: room.pendingChal || null, specN: specN, invited: !!room.invited, at: Date.now() } });
    } catch (e) {}
  }
  function startShowHeartbeat() {
    stopShowHeartbeat();
    if (!room.show || !room.isHost) return;
    _showHbT = setInterval(function () {
      if (!room.id || !room.isHost || !room.show) { stopShowHeartbeat(); return; }
      sendShowSnap(); persistShowRoom();
      try { paintShowRoom(); } catch (e) {}   // keeps the 60s NUDGE re-arm honest without extra timers
    }, 4000);
    sendShowSnap();
  }
  function stopShowHeartbeat() { if (_showHbT) { clearInterval(_showHbT); _showHbT = 0; } }
  function onShowSnap(p) {
    // SECURITY (review fix 6): a snap only means anything inside a room ALREADY known to be a show room
    // (room.show is adopted from the host's room-meta at join time). Without the room.show gate a forged
    // snap on a normal room could flip show mode, swap sel to an attacker audioUrl, or unseat a real p2.
    if (!p || !p.rid || !room.id || p.rid !== room.id || !room.show || room.isHost) return;
    room.invited = !!p.invited;
    room._snapP2 = p.p2Id || null; room._snapLive = !!p.live;
    if (p.sel && !matchLive && !matchCh) { sel = p.sel; paintSelection(); }   // adopt the host's locked song (incl. audioUrl)
    // SEAT-RACE SELF-HEAL (judge mandate): demote ONLY when the seat is OCCUPIED BY SOMEONE ELSE — an empty
    // p2Id (e.g. the first snap after a host refresh, before presence re-syncs) must never demote a legit
    // challenger (review fix 4). A host ACCEPT later re-promotes (p2Id === me).
    if (room.seat === 'p2' && p.p2Id && p.p2Id !== ME.id && p.pend !== ME.id) {
      room.seat = 'spec'; room.p2 = null; spectating = true; room._demoted = true;
      try { if (roomSP) roomSP.refresh(); } catch (e) {}
      banner('mpx-setup-msg', 'The challenger seat is taken — you\'re watching. The host can wave you in next run.');
    } else if (room._demoted && p.p2Id === ME.id) {
      room.seat = 'p2'; room.p2 = ME.id; spectating = false; room._demoted = false;
      try { if (roomSP) roomSP.refresh(); } catch (e) {}
      banner('mpx-setup-msg', 'You\'re seated — the host starts the match.');
    }
    room._snapSpecN = (typeof p.specN === 'number') ? p.specN : null;   // build102t: watching-count for the stage chip (10+ rule)
    if (p.atMs && !_specAtMs) { _specAtMs = p.atMs; try { _syncSpecAudio(); } catch (e) {} }   // build102t: late catch-up — the snap carries the shared start the one-shot 'start' already spent
    if (p.live && _specStage && !_specFedReal) _specLastFeedAt = Date.now();   // build102t/102u: the heartbeat vouches ONLY until the first real tick/state — after that a frozen host (paused tab, wedged engine) must trip the 12s recovery, not be kept alive by its own 4s snap (review fix 2b)
    if (p.live && p.mid && room.seat === 'spec' && !matchCh && !matchLive) {
      // late arrival while a run is live → drop into the existing spectate view (mid was the only missing key)
      _specShowSolo = !p.p2Id;
      _specIds = { p1: room.p1, p2: p.p2Id || null };   // build102t: deck seat assignment
      spectateMatch(p.mid, room.members[room.p1] || null, (p.p2Id && room.members[p.p2Id]) || null);
      if (p.atMs) { _specAtMs = p.atMs; try { _syncSpecAudio(); } catch (e) {} }   // build102u (review fix 1): AFTER spectateMatch — its entry reset would wipe a pre-set atMs
    } else if (!p.live && !p.mid && matchCh && spectating) {
      // the run died without a 'final' (host abort/refresh/close) → recover to the waiting room
      endSpectate('Run over — hang tight, the host may run it again.');
    }
    paintRoomWaiting();
  }
  // review fix 7: kill a pending GO LIVE attempt + its 8s watchdog (called from every room/screen teardown —
  // pure var writes, inert for normal MP; _consumeShowRoom re-arms its own room-stage watchdog after this).
  function _cancelShowOpen() {
    _pendingShowRoom = null;
    if (_showOpenT) { clearTimeout(_showOpenT); _showOpenT = 0; }
  }
  // show-spectate NEUTRAL verdict (review fix 2): render only once BOTH finals are in (or one + 8s), name the
  // HIGHER score — never YOU WIN/LOSE for a watcher, never the last-arrival-wins bug. Show rooms only.
  function _renderSpecVerdict() {
    if (_specVerdictT) { clearTimeout(_specVerdictT); _specVerdictT = 0; }
    var ks = Object.keys(_specFinals); if (!ks.length) return;
    var a = _specFinals[ks[0]], b = ks[1] ? _specFinals[ks[1]] : null;
    var sa = +((a && a.score) || 0), sb = +((b && b.score) || 0);
    var w = (b && sb > sa) ? b : a, draw = !!(b && sb === sa);
    matchLive = false;
    var v = $('mpx-verdict');
    if (v) { v.className = 'mpx-verdict draw'; v.textContent = draw ? 'DRAW' : 'MATCH OVER — ' + String((w && w.name) || 'winner').slice(0, 14) + ' takes it'; }
    // scorecard shows BOTH players (no YOU framing); the relabel is restored by endSpectate/closeRoom
    var wy = screen.querySelector('.mpx-sc.you .mpx-sc-who'); if (wy) wy.textContent = String((a && a.name) || 'P1').slice(0, 14);
    set('mpx-sc-you', Number(sa).toLocaleString());
    set('mpx-sc-you-meta', ((a && a.acc != null) ? a.acc + '% · ' : '') + ((a && a.combo) || 0) + 'x' + ((a && a.grade) ? ' · ' + a.grade : ''));
    set('mpx-sc-opp-who', b ? String(b.name || 'P2').slice(0, 14) : '…');
    set('mpx-sc-opp', b ? Number(sb).toLocaleString() : '…');
    set('mpx-sc-opp-meta', b ? (((b.acc != null) ? b.acc + '% · ' : '') + (b.combo || 0) + 'x' + (b.grade ? ' · ' + b.grade : '')) : 'no result received');
    step('winner');
    screen.classList.add('active'); activeNow = true;
    if (_specStage) {   // build102t (judge): don't yank the dual-deck view mid-verdict — banner it on the stage ~4s, then reveal the winner card beneath
      var mv = $('mss-verdict'); if (mv) { mv.hidden = false; mv.textContent = (v && v.textContent) || 'MATCH OVER'; }
      var _vg = _specGen;   // build102u (review fix 3): if the host rematches inside the 4s, this timer must not kill the NEW run's stage
      setTimeout(function () { if (_vg !== _specGen) return; try { _unmountSpecStage(); } catch (e) {} }, 4000);
    }
  }
  // unwind a spectator's watch channel back to the room-waiting screen (room channel stays joined)
  function endSpectate(msg) {
    stopTick();
    try { _unmountSpecStage(); } catch (e) {}   // build102t: decks + audio die with the watch channel
    try { if (matchCh) supa.removeChannel(matchCh); } catch (e) {}
    matchCh = null; matchLive = false; finishedLocal = false; myFinal = null; oppFinal = null; lastOppTick = null;
    _specShowSolo = false; _specShow = false; _specFinals = {};
    if (_specVerdictT) { clearTimeout(_specVerdictT); _specVerdictT = 0; }
    var _wyr = screen.querySelector('.mpx-sc.you .mpx-sc-who'); if (_wyr) _wyr.textContent = 'YOU';   // undo the spec-verdict relabel
    unmountOppPanel();
    spectating = (room.seat === 'spec');   // a pending challenger who watched goes back to non-spec
    if (room.id && room.ch) {
      step('setup'); enterRoomWaiting();
      screen.classList.add('active'); activeNow = true;
      if (msg) banner('mpx-setup-msg', msg);
    } else { step('lobby'); }
  }

  // ===================== BUILD102t: SPECTATOR DUAL-DECK STAGE =====================
  // The real in-game show view: the watcher rebuilds the players' chart locally (RhythmGame.chartUrl on the
  // SAME sel.audioUrl + difficulty), plays the decoded audio locked to the shared atMs, and renders one deck
  // per player driven by their id-tagged tick/state streams. Nothing in this block runs unless a SHOW
  // spectate mounts it — normal MP and normal-room spectating never reach it.
  var _SPEC_APPROACH = 1.6;   // visual fall window (seconds) — display-only, independent of the players' scroll setting
  function _mountSpecStage() {
    if (_specStage) return;
    _specSolo = !!_specShowSolo;
    var st = document.createElement('div');
    st.id = 'mpx-spec-stage';
    if (_specSolo) st.className = 'solo';
    st.innerHTML =
      '<div class="mss-head">' +
        '<span class="mss-plate p1"><span class="mss-av" id="mss-av1">?</span><span class="mss-name" id="mss-name1">HOST</span><b class="mss-sc" id="mss-sc1">0</b><span class="mss-cb" id="mss-cb1">0x</span></span>' +
        '<span class="mss-live">● LIVE SHOW</span>' +
        '<span class="mss-plate p2" id="mss-plate2"><span class="mss-av" id="mss-av2">?</span><span class="mss-name" id="mss-name2">CHALLENGER</span><b class="mss-sc" id="mss-sc2">0</b><span class="mss-cb" id="mss-cb2">0x</span></span>' +
      '</div>' +
      '<div class="mss-decks"><canvas id="mss-deck1"></canvas><canvas id="mss-deck2"></canvas></div>' +
      '<div class="mss-sync" id="mss-sync"><span class="mss-sync-dot"></span>&nbsp;SYNCING — locking to the live run…</div>' +
      '<div class="mss-verdict" id="mss-verdict" hidden></div>' +
      '<div class="mss-foot"><span id="mss-watchn"></span><span class="mss-note">You\'re invisible to the players</span><button class="ghost-btn" id="mss-leave" type="button">LEAVE</button></div>';
    document.body.appendChild(st);
    _specStage = st;
    _specPlate('1', (_specIds.p1 && room.members[_specIds.p1]) || null, 'HOST');
    _specPlate('2', (_specIds.p2 && room.members[_specIds.p2]) || null, 'CHALLENGER');
    var lv = $('mss-leave'); if (lv) lv.addEventListener('click', function () { endSpectate('You left the live view — still in the room.'); });
    // per-deck render pools — INDEPENDENT per deck (a shared pool bleeds one player's FX onto the other's board)
    function pool() { var spk = []; for (var i = 0; i < 40; i++) spk.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, cr: false }); return { ctx: null, flash: [0, 0, 0, 0, 0, 0], flashCr: [false, false, false, false, false, false], spk: spk }; }
    _specDecks = { d1: pool(), d2: pool() };
    _specChart = null; _specIdx = 0; _specStates = {}; _specTicks = {};
    _specLastFeedAt = Date.now();
    // resolve the players' chart — same url + difficulty. Decode failure → the C1 compact panel, never a dead screen.
    // build102u (review fix 3): BOTH callbacks are generation-guarded — a stale resolve from an abandoned mount must
    // never poison a newer stage's chart/audio, and a stale network failure must never unmount a healthy one.
    var _gen = ++_specGen;
    try {
      window.RhythmGame.chartUrl(sel.audioUrl, (sel && sel.difficulty) || 'medium').then(function (res) {
        if (!_specStage || _gen !== _specGen) return;   // unmounted / remounted while decoding
        _specChart = res; _specIdx = 0;
        var sy = $('mss-sync'); if (sy) sy.hidden = true;
        st.classList.add('ready');                  // decks fade in
        _syncSpecAudio();
      }, function (err) {
        if (!_specStage || _gen !== _specGen) return;
        console.error('[mp] spectator chart failed — falling back to the score panel', err);
        _specDeckFallback();
      });
    } catch (e) { _specDeckFallback(); }
    if (_specGainT) clearInterval(_specGainT);
    _specGainT = setInterval(_specApplyGain, 1200);  // keep obeying global mute / music volume mid-watch
    if (_specRaf) cancelAnimationFrame(_specRaf);
    _specRaf = requestAnimationFrame(_specLoop);
  }
  function _specPlate(n, meta, fallback) {
    var av = $('mss-av' + n), nm = $('mss-name' + n);
    if (nm) nm.textContent = String((meta && meta.name) || fallback).slice(0, 12);
    if (av) {
      if (meta && meta.avatar) { av.style.backgroundImage = 'url("' + safeUrl(meta.avatar) + '")'; av.textContent = ''; }
      else { av.style.backgroundImage = ''; av.textContent = initial((meta && meta.name) || fallback); }
    }
  }
  function _specDeckFallback() {
    // dead URL / HLS-only / decode fail → the C1 compact score panel is already mounted beneath the stage
    _unmountSpecStage();
    try { window.RhythmGame.showToast && window.RhythmGame.showToast('Live decks unavailable — score view only.', 'neutral'); } catch (e) {}
  }
  function _unmountSpecStage() {
    _specGen++;   // build102u (review fix 3): orphan every in-flight async callback tied to the old mount
    if (_specRaf) { cancelAnimationFrame(_specRaf); _specRaf = 0; }
    if (_specGainT) { clearInterval(_specGainT); _specGainT = 0; }
    try { if (_specDp) _specDp.stop(); } catch (e) {}
    _specDp = null;
    if (_specStage && _specStage.parentNode) { try { _specStage.parentNode.removeChild(_specStage); } catch (e) {} }
    _specStage = null; _specChart = null; _specDecks = null; _specIdx = 0; _specLastFeedAt = 0;
    _specAtMs = 0; _specFedReal = false;   // build102u (review BLOCKER 1): the run clock dies with the stage — run #2 must sync fresh, never off run #1's atMs
  }
  // spectator audio: the SAME decoded buffer, offset-started onto the shared clock (DemoPlayer build102t seam);
  // volume follows the global mute + music setting so a streamer can silence it like any other music.
  function _syncSpecAudio() {
    try {
      if (!_specStage || !_specChart || !_specChart.buffer || _specDp || !_specAtMs) return;
      var DP = window.RhythmGame.DemoPlayer; if (!DP) return;
      var lead = _specAtMs - Date.now();
      if (lead > 250) { setTimeout(_syncSpecAudio, Math.min(lead, 4000)); return; }   // joined during the lead-in → start at 0 on the shared clock
      _specDp = new DP(_specChart.buffer);
      _specDp.play(Math.max(0, (Date.now() - _specAtMs) / 1000));
      _specApplyGain();
    } catch (e) {}
  }
  function _specApplyGain() {
    try {
      if (!_specDp) return;
      var st = (window.RhythmGame.getSettings && window.RhythmGame.getSettings()) || {};
      var v = (typeof st.music === 'number') ? st.music : 1;
      _specDp.setGain((window.RhythmGame.isMuted && window.RhythmGame.isMuted()) ? 0 : v);
    } catch (e) {}
  }
  function _specTime() {
    if (_specDp) { var t = _specDp.getTime(); if (t > -2) return t; }
    return _specAtMs ? (Date.now() - _specAtMs) / 1000 : 0;
  }
  function _specFeedFor(pid) {
    if (pid && _specTicks[pid]) return _specTicks[pid];
    if (pid && _specStates[pid]) return _specStates[pid];
    var ks = Object.keys(_specTicks);   // old-build fallback: an untagged stream keys by name — surface SOMETHING
    return ks.length === 1 ? _specTicks[ks[0]] : null;
  }
  function _specStrip(n, pid) {
    var feed = _specFeedFor(pid);
    var sc = $('mss-sc' + n), cb = $('mss-cb' + n);
    if (sc && feed) sc.textContent = Number(feed.score != null ? feed.score : (feed.sc || 0)).toLocaleString();
    if (cb && feed) cb.textContent = (feed.combo != null ? feed.combo : (feed.cb || 0)) + 'x';
  }
  function _specLoop() {
    _specRaf = requestAnimationFrame(_specLoop);
    if (!_specStage) return;
    // LIVENESS (judge): ~12s of total silence while decks are mounted ⇒ the run died without a signal — recover
    if (_specLastFeedAt && Date.now() - _specLastFeedAt > 12000) { endSpectate('The feed went quiet — back to the room.'); return; }
    _specStrip('1', _specIds.p1);
    if (!_specSolo) _specStrip('2', _specIds.p2);
    var wn = $('mss-watchn');
    if (wn) { var n = (room._snapSpecN != null) ? room._snapSpecN : _specNCache; wn.textContent = (n > 10 ? '10+' : (n || 1)) + ' watching'; }   // never authoritative past the ≤10-peer design
    if (!_specChart || !_specChart.notes || !_specChart.notes.length) return;   // still syncing (shimmer up)
    var t = _specTime();
    var ns = _specChart.notes;
    while (_specIdx < ns.length && ns[_specIdx].time < t - 0.35) _specIdx++;   // both decks scroll the SAME chart (both players play the same notes)
    _renderSpecDeck(_specDecks.d1, 'mss-deck1', _specIds.p1, ns, t);
    if (!_specSolo) _renderSpecDeck(_specDecks.d2, 'mss-deck2', _specIds.p2, ns, t);
  }
  // ---- one spectator deck: a synthetic 5-lane trapezoid fan. The spectator's engine is NOT running, so
  // getLaneFrame (live canvas geometry) is unavailable — this fan mirrors the board's 1/z projection instead.
  function _renderSpecDeck(D, cvId, pid, ns, t) {
    var cv = document.getElementById(cvId); if (!cv || !D) return;
    var cwc = cv.clientWidth, chc = cv.clientHeight; if (!cwc || !chc) return;
    if (cv.width !== cwc || cv.height !== chc) { cv.width = cwc; cv.height = chc; D.ctx = null; }
    if (!D.ctx) { D.ctx = cv.getContext('2d'); if (!D.ctx) return; }
    var g = D.ctx, w = cv.width, h = cv.height;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    var N = 5, nearY = h * 0.87, farY = h * 0.08, nearSpan = w * 0.74, farSpan = w * 0.28, cx = w / 2;
    var lw = nearSpan / N, zf = 3.2, i;
    var cols = (window.RhythmGame.getLaneColors && window.RhythmGame.getLaneColors()) || null;
    // dim guitar-art ambiance — decorative only (gems ride the synthetic fan, not the painted strings)
    var art = window.RhythmGame.getGuitarArt && window.RhythmGame.getGuitarArt();
    if (art && art.img && art.img.width) {
      try { g.save(); g.globalAlpha = 0.18; var ar = art.img.width / art.img.height, dh = h, dw = dh * ar; g.drawImage(art.img, cx - dw / 2, h - dh, dw, dh); g.restore(); } catch (e) {}
    }
    function laneX(l, u) { var nx = cx - nearSpan / 2 + (l + 0.5) * (nearSpan / N), fx = cx - farSpan / 2 + (l + 0.5) * (farSpan / N); return nx + (fx - nx) * u; }
    function proj(d) { var dd = d < 0 ? 0 : d; var z = 1 + dd * (zf - 1); return (1 - 1 / z) / (1 - 1 / zf); }
    // strings (far → near)
    g.lineWidth = Math.max(1, lw * 0.05);
    g.strokeStyle = 'rgba(220,217,212,0.4)';
    g.beginPath();
    for (i = 0; i < N; i++) { g.moveTo(laneX(i, 1), farY); g.lineTo(laneX(i, 0), nearY); }
    g.stroke();
    // GHOST GEMS — the locally rebuilt chart scrolling on the shared clock.
    // CHART-TOLERANCE MANDATE (judge): hit/miss paint comes ONLY from the streamed ev events below.
    // Cross-device decode drift means a player may never judge a note we drew (or judge one we didn't) —
    // NEVER infer or paint a miss for a note their stream never judged; unjudged local ghosts just scroll by.
    for (var k = _specIdx; k < ns.length; k++) {
      var nn = ns[k], d = (nn.time - t) / _SPEC_APPROACH;
      if (d > 1.02) break;                        // notes are time-sorted — safe early exit
      if (d < -0.12 || nn.open) continue;
      var u = proj(d), gy = nearY + (farY - nearY) * u, gx = laneX(nn.lane, u);
      var ds = 1 / (1 + (d < -0.2 ? -0.2 : d) * (zf - 1));
      var rad = Math.max(1, lw * 0.2 * ds);
      if (nn.type === 'bomb') {                   // bomb → hollow dim ring (never reads as a hit)
        g.strokeStyle = 'rgba(180,178,174,' + (0.35 * (1 - u * 0.5)).toFixed(3) + ')';
        g.lineWidth = Math.max(1, rad * 0.4);
        g.beginPath(); g.arc(gx, gy, rad, 0, 6.283); g.stroke();
        continue;
      }
      var lcol = (cols && cols[nn.lane]) ? cols[nn.lane] : '255,60,60';
      var aGem = 0.6 + 0.4 * (1 - u);
      if (nn.type === 'hold' && nn.hold > 0) {    // hold → lane-colored beam toward the nut
        var d2 = (nn.time + nn.hold - t) / _SPEC_APPROACH; if (d2 > 1.02) d2 = 1.02;
        var u2 = proj(d2);
        g.strokeStyle = 'rgba(' + lcol + ',' + (aGem * 0.5).toFixed(3) + ')';
        g.lineWidth = Math.max(1.5, rad * 0.8);
        g.beginPath(); g.moveTo(gx, gy); g.lineTo(laneX(nn.lane, u2), nearY + (farY - nearY) * u2); g.stroke();
      }
      g.fillStyle = 'rgba(' + lcol + ',' + aGem.toFixed(3) + ')';
      g.beginPath(); g.arc(gx, gy, rad, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(255,255,255,' + (aGem * 0.55).toFixed(3) + ')';
      g.beginPath(); g.arc(gx - rad * 0.3, gy - rad * 0.3, rad * 0.34, 0, 6.283); g.fill();
      if (nn.chord) {                             // chord → white double-rim
        g.strokeStyle = 'rgba(255,255,255,' + (aGem * 0.7).toFixed(3) + ')';
        g.lineWidth = Math.max(1, rad * 0.3);
        g.beginPath(); g.arc(gx, gy, rad * 1.3, 0, 6.283); g.stroke();
      }
    }
    // THIS player's hit/miss events → authoritative lane flashes + sparkles (drained once per packet)
    var stFeed = (pid && _specStates[pid]) || null;
    if (!stFeed) { var sk = Object.keys(_specStates); if (sk.length === 1 && cvId === 'mss-deck1') stFeed = _specStates[sk[0]]; }   // untagged old-build stream → left deck only
    var ev = stFeed && stFeed.ev;
    if (ev && ev.length) {
      for (var e2 = 0; e2 < ev.length; e2++) {
        var L = ev[e2].l | 0; if (L < 0 || L >= N) continue;
        var crimson = (ev[e2].j === 'm');
        D.flash[L] = 1; D.flashCr[L] = crimson;
        var cxp = laneX(L, 0), cyp = nearY;
        for (var sp = 0; sp < D.spk.length; sp++) {
          var Pk = D.spk[sp]; if (Pk.on) continue;
          Pk.on = true; Pk.x = cxp; Pk.y = cyp; Pk.cr = crimson;
          Pk.vx = (Math.random() - 0.5) * 1.6; Pk.vy = -(0.8 + Math.random() * 1.4);
          Pk.life = 0; Pk.max = crimson ? 0.30 : 0.42; break;
        }
      }
      stFeed.ev = null;   // consume — the next state packet replaces the object wholesale
    }
    // per-lane catcher buttons — press down + light white-hot (crimson on a miss) when the player strikes
    for (i = 0; i < N; i++) {
      var fl = D.flash[i];
      var bcol = (cols && cols[i]) ? cols[i] : '255,60,60';
      var press = fl * lw * 0.10, bx = laneX(i, 0), by = nearY + press, brad = lw * 0.26;
      g.save();
      g.lineWidth = Math.max(1.4, lw * 0.055);
      g.strokeStyle = 'rgba(' + bcol + ',' + (0.5 + fl * 0.5).toFixed(3) + ')';
      if (fl > 0.02) { g.shadowColor = D.flashCr[i] ? '#ff2834' : 'rgba(255,250,235,1)'; g.shadowBlur = 16 * fl; }
      g.beginPath(); g.arc(bx, by, brad, 0, 6.283); g.stroke();
      if (fl > 0.04) { g.globalAlpha = fl; g.fillStyle = D.flashCr[i] ? 'rgba(255,40,52,0.85)' : 'rgba(255,250,238,0.95)'; g.beginPath(); g.arc(bx, by, brad * (0.5 + fl * 0.35), 0, 6.283); g.fill(); }
      g.restore();
      D.flash[i] *= 0.84; if (D.flash[i] <= 0.02) D.flash[i] = 0;
    }
    // sparkles
    for (var q = 0; q < D.spk.length; q++) {
      var Q = D.spk[q]; if (!Q.on) continue;
      Q.life += 0.016; if (Q.life >= Q.max) { Q.on = false; continue; }
      Q.x += Q.vx; Q.y += Q.vy; Q.vy += 0.06;
      var qa = 1 - Q.life / Q.max;
      g.fillStyle = Q.cr ? 'rgba(255,60,70,' + qa.toFixed(3) + ')' : 'rgba(255,240,210,' + qa.toFixed(3) + ')';
      g.beginPath(); g.arc(Q.x, Q.y, 2.2 * qa + 0.6, 0, 6.283); g.fill();
    }
  }
  // ---- show-room chrome: locked-song banner, artist seat card (pending ACCEPT/DECLINE), CALL IN THE ARTIST ----
  function paintShowRoom() {
    var bn = $('mpx-show-banner'), seatEl = $('mpx-show-seat'), ls = $('mpx-leave-setup');
    var isShow = !!(room.id && room.show);
    if (bn) bn.hidden = !isShow;
    if (seatEl) seatEl.hidden = !isShow;
    if (!isShow) { return; }
    if (ls) ls.textContent = room.isHost ? '⏹ END THE SHOW' : 'LEAVE THE SHOW';   // restored by closeRoom
    var art = $('msb-art'); if (art && sel.art) art.src = safeUrl(sel.art);
    var ti = $('msb-title'); if (ti) ti.textContent = sel.title || 'Review track';
    var ar = $('msb-artist'); if (ar) ar.textContent = sel.artist || '';
    var df = $('msb-diff'); if (df) df.textContent = ({ easy: 'DRIFT', medium: 'PULSE', hard: 'FRACTURE' })[sel.difficulty] || 'PULSE';
    // the song is locked to the review — visibly present, never re-pickable
    var pick = $('mpx-pick'); if (pick) pick.disabled = true;
    var chev = $('mpx-pick-chev'); if (chev) chev.style.visibility = 'hidden';
    // artist seat states: open / pending (host-only ACCEPT/DECLINE) / seated
    var emp = $('mpx-show-seat-empty'), pend = $('mpx-show-pend'), pendTxt = $('mpx-show-pend-txt');
    var seatedId = room.isHost ? room.p2 : (room._snapP2 || null);
    var p2m = seatedId && room.members[seatedId];
    if (emp) {
      if (seatedId) emp.innerHTML = '🎸 <b>' + esc((p2m && p2m.name) || room._p2Name || 'Challenger') + '</b> is seated' + (seatedId === room.submitterId ? ' — the artist is in!' : '');
      else if (room.isHost && room.submitterName) emp.innerHTML = '🎸 ARTIST SEAT — <b>waiting for ' + esc(room.submitterName) + '…</b>';
      else emp.innerHTML = '🎸 ARTIST SEAT — <b>open</b>';
      emp.hidden = false;
    }
    if (pend) {
      var showPend = !!(room.isHost && room.pendingChal && !room.p2);
      pend.hidden = !showPend;
      if (showPend && pendTxt) {
        var pm = room.members[room.pendingChal], nm = esc((pm && pm.name) || 'Someone');
        var isArtist = room.pendingChal === room.submitterId;   // prefill only — ids are spoofable, host accept is the gate
        pendTxt.innerHTML = isArtist ? '🎤 <b>' + nm + '</b> (the artist) wants in!' : '<b>' + nm + '</b> wants the challenger seat';
        pendTxt.classList.toggle('artist', isArtist);
      }
    }
    // CALL IN THE ARTIST (host-only; needs a known submitter from /review/resolve)
    var invRow = $('mpx-show-invite-row'), invBtn = $('mpx-show-invite'), nudge = $('mpx-show-nudge');
    var canInvite = !!(room.isHost && room.submitterId);
    if (invRow) invRow.hidden = !canInvite;
    if (canInvite) {
      if (invBtn) {
        invBtn.hidden = !!room.invited;
        invBtn.disabled = !!_inviteBusy;
        invBtn.textContent = _inviteBusy ? '📣 CALLING…' : ('📣 CALL IN THE ARTIST' + (room.submitterName ? ' — ' + String(room.submitterName).slice(0, 14) : ''));
      }
      if (nudge) nudge.hidden = !(room.invited && _inviteAt && (Date.now() - _inviteAt > 60000) && !room.p2 && !_inviteRenotified);
    }
    setReadyBtn();   // START (SOLO) / START VERSUS relabel
  }
  function acceptChallenger() {
    if (!room.isHost || !room.show || !room.pendingChal || room.p2) return;
    room.p2 = room.pendingChal; room.pendingChal = null;
    advertiseRoom(); sendShowSnap(); persistShowRoom(); paintRoomWaiting();
    banner('mpx-setup-msg', ((room.members[room.p2] || {}).name || 'Challenger') + ' is seated — START runs the versus.');
  }
  function declineChallenger() {
    if (!room.isHost || !room.show || !room.pendingChal) return;
    room.declined = room.declined || {};
    room.declined[room.pendingChal] = 1; room.pendingChal = null;   // the snap's p2Id/pend mismatch self-demotes them to spectator
    sendShowSnap(); paintRoomWaiting();
  }
  // ---- CALL IN THE ARTIST → RhythmCatalog.showInvite → POST /show/invite (token stays in catalog.js; never on the wire here)
  function callInArtist(renotify) {
    if (!room.id || !room.show || !room.isHost || _inviteBusy) return;
    var RC = window.RhythmCatalog, st = $('mpx-show-invite-state');
    function say(txt) { if (st) { st.hidden = false; st.textContent = txt; } }
    if (!RC || !RC.showInvite) { say('invites unavailable — relaunch from a fresh review link'); return; }
    _inviteBusy = true; try { paintShowRoom(); } catch (e) {}
    RC.showInvite(room.id, !!renotify).then(function (r) {
      _inviteBusy = false;
      var oc = (r && r.outcome) || ((r && r.invited) ? 'sent' : 'error');
      if (oc === 'sent') { _markInvited(); say(renotify ? '✓ nudged — they\'ve been notified again' : '✓ invited — they\'ve been notified'); if (renotify) _inviteRenotified = true; }
      else if (oc === 'skipped_duplicate') { _markInvited(); say('already invited — they\'ve been notified'); }
      else if (oc === 'renotify_already_used') { _inviteRenotified = true; say('nudge already sent'); }
      else say('couldn\'t send the invite');
      try { paintShowRoom(); } catch (e) {}
    }).catch(function (e) {
      _inviteBusy = false;
      var msg = String((e && e.message) || '');
      say(/\b429\b/.test(msg) ? 'slow down — try again later' : 'couldn\'t send the invite');
      try { paintShowRoom(); } catch (e2) {}
    });
  }
  function _markInvited() {
    if (!room.invited) { room.invited = true; _inviteAt = Date.now(); persistShowRoom(); sendShowSnap(); }
    else if (!_inviteAt) _inviteAt = Date.now();
  }
  // ---- solo-run settle: back to the waiting room, never the versus machinery ----
  function settleSoloShow() {
    // (security judge BLOCKER) cancels BOTH timers the normal settle leans on, skips showWinner's !op→YOU-WIN +
    // recordMpResult forfeit-W (a farmable ranked win), and returns the host to the open room for a rematch or
    // the artist joining. NOTE: engine RESTART affordances fire no song-end — a restarted run just streams on.
    // review fix 8: mirror settleIfReady's guard — a stale queued song-end callback (e.g. a failed show start
    // followed by an unrelated solo song) must never hijack that run's results with the show-room UI.
    if (!matchLive || !finishedLocal) return;
    matchLive = false;
    if (_settleSafetyT) { clearTimeout(_settleSafetyT); _settleSafetyT = 0; }
    if (_startWatchdog) { clearTimeout(_startWatchdog); _startWatchdog = 0; }
    var sc = (myFinal && myFinal.score) || 0;
    var pendId = room.pendingChal, pendM = pendId && room.members[pendId];
    teardownMatch();                       // closes rr-match-<mid>; the ROOM channel + heartbeat survive
    sendShowSnap();                        // instant live:false / mid:null — watchers snap back to the waiting room
    step('setup'); enterRoomWaiting();
    screen.classList.add('active'); activeNow = true;   // re-raise over the engine's results screen (showScreen stripped us)
    // the engine's post-song routing (results/menu) runs AFTER our callbacks and strips .active again —
    // re-raise once more a beat later so the host actually lands back in the show room (mirrors showWinner's re-add).
    setTimeout(function () { if (room.id && room.show && !matchLive) { screen.classList.add('active'); activeNow = true; } }, 450);
    advertiseRoom(); persistShowRoom();
    banner('mpx-setup-msg', '✓ Run complete — ' + Number(sc).toLocaleString() + ' banked.' +
      (room.p2 ? ' Your challenger is seated — START runs the versus.'
        : (pendId ? ' ' + (((pendM && pendM.name) || 'A challenger') + ' is waiting — ACCEPT them for the next run.')
          : ' The room stays open — run it again or call in the artist.')));
  }
  // ---- host-refresh persistence: rr_showroom (<90s). LIGHT port of the rr_tour pattern — persist + rejoin +
  // heartbeat only; no host migration (a show without its host is meaningless). revToken is NEVER persisted;
  // catalog.js re-resolves ?review= on reload, so the invite call still works after a refresh.
  function persistShowRoom() {
    try {
      if (!room.id || !room.show || !room.isHost) return;
      sessionStorage.setItem('rr_showroom', JSON.stringify({ rid: room.id, name: room.name, sel: sel,
        submitterId: room.submitterId || null, submitterName: room.submitterName || '', invited: !!room.invited,
        // review fix 4b: the SEAT survives a host refresh — the reconnect snap must carry the true p2Id or the
        // accepted challenger would read an empty seat (and a mis-demote). Name kept for the paint fallback.
        p2: room.p2 || null, p2Name: (room.p2 && room.members[room.p2] && room.members[room.p2].name) || '',
        pend: room.pendingChal || null, at: Date.now() }));
    } catch (e) {}
  }
  function clearShowRoom() { try { sessionStorage.removeItem('rr_showroom'); } catch (e) {} }
  function maybeReconnectShowRoom() {
    try {
      if (room.id || !supa) return;
      var raw = sessionStorage.getItem('rr_showroom'); if (!raw) return;
      var P = JSON.parse(raw); if (!P || !P.rid) return;
      if (Date.now() - (P.at || 0) > 90000) { clearShowRoom(); return; }
      teardownMatch();   // clear stale match state — the orphaned pre-refresh run is gone
      room = { id: P.rid, name: P.name || 'LIVE SHOW', priv: false, combat: false, isHost: true, ch: null, seat: 'p1', members: {}, p1: ME.id,
        p2: P.p2 || null,   // review fix 4b: restore the accepted challenger's seat across the refresh
        show: true, submitterId: P.submitterId || null, submitterName: P.submitterName || '', revToken: null, invited: !!P.invited,
        pendingChal: P.pend || null, declined: {} };
      room._p2Name = P.p2Name || '';                       // paint fallback until their presence re-syncs
      room._graceUntil = Date.now() + 15000;               // presence warm-up: don't clear the restored seat before their heartbeat lands
      if (P.sel) sel = P.sel;
      _soloRun = false; _showAtMs = 0; _inviteBusy = false; _inviteRenotified = false;
      if (P.invited) _inviteAt = P.at || Date.now();   // approximate — re-arms the NUDGE ~60s after the persist
      joinRoomChannel(P.rid, 'p1');   // channels are unregistered strings — rejoining + re-advertising revives the room; the SUBSCRIBED snap (mid:null) also recovers stranded watchers
      reannounce(); enterRoomWaiting(); advertiseRoom(); startShowHeartbeat(); persistShowRoom();
      banner('mpx-setup-msg', 'Reconnected — your show room is back.');
    } catch (e) {}
  }
  // ---- sel.audioUrl launcher: the buffered decoder or a LOUD abort — NEVER the demo (stability judge blocker)
  function resolveShowStart(s, atMs) {
    var url = String(s.audioUrl || '');
    if (!url || /\.m3u8(\?|$)/i.test(url) || !window.RhythmGame.__buffered || !window.RhythmGame.startAt) {
      console.error('[mp] show/review track unresolvable (HLS-only or no buffered seam) — refusing the demo fallback');
      _showStartFail(); return;
    }
    try {
      window.RhythmGame.startAt(function () {
        return window.RhythmGame.__buffered(url, { title: s.title, artist: s.artist, artwork: s.art });
      }, { atMs: atMs, difficulty: sel.difficulty });
    } catch (e) { console.error('[mp] show buffered start failed', e); _showStartFail(); return; }
    // same start-watchdog contract as the normal path: #loading/#game count as progressing; a dead start aborts loud
    if (_startWatchdog) clearTimeout(_startWatchdog);
    var _wdT0 = Date.now();
    function _wdCheck() {
      _startWatchdog = 0;
      if (!matchLive && !tour.id) return;
      var g = document.getElementById('game'), ld = document.getElementById('loading');
      if (g && g.classList.contains('active')) return;
      if (ld && ld.classList.contains('active')) {
        if (Date.now() - _wdT0 < 30000) _startWatchdog = setTimeout(_wdCheck, 3000);
        return;
      }
      console.error('[mp] show round did not start (no loading/game screen past the synced start) — aborting loud');
      _showStartFail();
    }
    _startWatchdog = setTimeout(_wdCheck, Math.max(0, atMs - Date.now()) + 4000);
  }
  function _showStartFail() {
    var g = $('game'), ld = $('loading');
    if ((g && g.classList.contains('active')) || (ld && ld.classList.contains('active'))) return;   // playing/decoding — never yank a live run
    if (_startWatchdog) { clearTimeout(_startWatchdog); _startWatchdog = 0; }
    stopCountdown();
    teardownMatch();   // clears the dead matchCh so the host's next START mints a fresh mid
    screen.classList.add('active'); activeNow = true;
    if (room.id && room.show) {
      step('setup'); enterRoomWaiting(); sendShowSnap();   // final live:false — watchers recover
      banner('mpx-setup-msg', '⚠ Couldn\'t load the review track — the room is still open. Hit START to try again.');
    } else {
      step('setup');
      banner('mpx-setup-msg', '⚠ Couldn\'t load the track — back out and retry.');
    }
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
    var _cap = Math.min(TOUR_MAX, meta.size || TOUR_MAX);   // build58: honor the host's chosen bracket size (was cosmetic — always capped at 10)
    if ((meta.count || 1) >= _cap) { banner('mpx-rooms-msg', 'Bracket is full (' + _cap + ' max).'); return; }
    tour = nullTour(); tour.id = tid; tour.name = meta.name; tour.isHost = false; tour.hostId = meta.hostId;
    joinTourChannel(tid);
    reannounce(); enterTourRoom();
  }
  // build100q (#spectate): WATCH a LIVE bracket you're not in — joinTour blocks live brackets, so this is the spectator
  // door. Joins the tour channel as a pure watcher; the host's snapshot populates tour.alive, t-tick/t-state stream the
  // focused player's real deck, and setSpectating mounts the same tested live panel + WATCH NEXT switcher eliminated
  // players already use. Non-member → never settles a phantom result (spectating gates recordMpResult/mpSettle).
  function watchTour(tid) {
    if (!supa || !lobbyCh) return;
    var meta = toursDir[tid]; if (!meta) { banner('mpx-rooms-msg', 'That bracket just closed.'); return; }
    tour = nullTour(); tour.id = tid; tour.name = meta.name; tour.isHost = false; tour.hostId = meta.hostId; tour.meIn = false;
    spectating = true;
    joinTourChannel(tid);
    reannounce(); enterTourRoom();
    try { setSpectating(true); } catch (e) {}
    banner('mpx-tour-msg', '👁 Spectating ' + (meta.name || 'the bracket') + ' — use WATCH NEXT to switch players.');
  }
  function advertiseTour() {
    if (!lobbyCh || !tour.id || !tour.isHost) return;
    lobbyCh.send({ type: 'broadcast', event: 'tour-meta', payload: {
      tid: tour.id, name: tour.name, hostId: ME.id, hostName: ME.name,
      count: Object.keys(tour.members).length || 1, max: (tour.size || TOUR_MAX), size: tour.size, state: tour.state, at: Date.now() } });
  }
  function closeTour(silent) {
    try { if (tour.stakes && tour.stakes !== 'free' && tour.state === 'open') _wagerRefundMine(); } catch (e) {}   // build71: WAGER — only refund a buy-in when a STAKED bracket dissolves BEFORE it goes live (state still 'open'). Once 'live'/'done' the only legit credit is settlement (champ payout / side-bet win) — a leaver must NOT reclaim their stake. (The old unconditional refund was an exploit: losers never settle, so refundPool's settled/refunded state guard never blocked them → guaranteed stake-back that deflated the champion pot.)
    if (tour.id && tour.isHost && lobbyCh) { try { lobbyCh.send({ type: 'broadcast', event: 'tour-gone', payload: { tid: tour.id } }); } catch (e) {} }
    try { if (tour.id && window.RhythmLevels) window.RhythmLevels.clearEnvironment(); } catch (e) {}   // build11: drop the bracket's stage theme
    stopTourHeartbeat(); clearPersistedTour();   // build42: stop the snapshot heartbeat + drop the reconnect pointer
    stopTourTick();
    stopTourCountdown(); if (_verdictT) { clearTimeout(_verdictT); _verdictT = 0; } hideTourCd();   // drop any cinematic veil
    if (_mountT) { clearTimeout(_mountT); _mountT = 0; }           // kill any pending deferred split-mount (left mid-lead-in)
    if (_botRampT) { clearInterval(_botRampT); _botRampT = 0; }    // stop the dev bot score-ramp
    setSpectating(false);
    if (_npcRaf) { cancelAnimationFrame(_npcRaf); _npcRaf = 0; }
    var _g = $('game'); if (_g) _g.classList.remove('vs-mode', 'vs-tour', 'you-od-fire', 'vs-intro');
    _vsActive = false; _vsMode = false; unmountVsHud();
    Object.keys(tour._settleT).forEach(function (k) { clearTimeout(tour._settleT[k]); });
    try { if (tourSP) tourSP.stop(); if (tour.ch) supa.removeChannel(tour.ch); } catch (e) {}
    tourSP = null; tour = nullTour(); reannounce();
    if (!silent) { step('lobby'); banner('mpx-lobby-msg', ''); onLobbySync(); }
  }

  // ---- the tournament channel ----
  function joinTourChannel(tid) {
    var ch = supa.channel('rr-tour-' + tid, { config: { broadcast: { self: true } } });
    tour.ch = ch;
    if (!tour._joinAt) tour._joinAt = Date.now();   // build42: STABLE join time → deterministic host election (migration)
    tourSP = softPresence(ch, function () { return { id: ME.id, name: ME.name, avatar: ME.avatar, at: tour._joinAt }; }, onTourPeers);
    ch.on('broadcast', { event: 't-snapshot' }, function (m) { applyTourSnapshot(m.payload); });   // build42: host state-heartbeat
    ch.on('broadcast', { event: 't-track' },  function (m) { onTourTrack(m.payload); });
    ch.on('broadcast', { event: 't-round' },  function (m) { onTourRound(m.payload); });
    ch.on('broadcast', { event: 't-tick' },   function (m) { onTourTick(m.payload); });
    ch.on('broadcast', { event: 't-state' },  function (m) { onTourState(m.payload); });   // build44: rival's full render frame → real hits/misses on the ghost deck
    ch.on('broadcast', { event: 't-shock' },  function (m) { onTourShock(m.payload); });   // build100q #172: combat shock over the tour channel (matchCh is null mid-bracket)
    ch.on('broadcast', { event: 't-final' },  function (m) { onTourFinal(m.payload); });
    ch.on('broadcast', { event: 't-result' }, function (m) { onTourResult(m.payload); });
    ch.on('broadcast', { event: 't-finalverdict' }, function (m) { onTourFinalVerdict(m.payload); });
    ch.on('broadcast', { event: 't-champ' },  function (m) { onTourChamp(m.payload); });
    ch.on('broadcast', { event: 't-paid' },   function (m) { onTourPaid(m.payload); });   // build66: WAGER — an entrant paid their buy-in (HOST fans it into the authoritative paid roster + pot)
    ch.on('broadcast', { event: 't-await' },  function (m) { onTourAwait(m.payload); });
    ch.on('broadcast', { event: 't-kick' },   function (m) { onTourKick(m.payload); });
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') { tourSP.start(); if (tour.isHost) { startTourHeartbeat(); broadcastSnapshot(); } }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { banner('mpx-tour-msg', 'Could not reach the bracket. Back out and retry.'); }
    });
  }
  function onTourPeers(all) {
    if (!tour.ch) return;
    var was = Object.keys(tour.members).length;
    tour.members = all;
    mergeBots();   // dev NPCs are local-only; re-fold them in after every presence overwrite
    var n = Object.keys(tour.members).length;
    // host vanished mid-bracket → ELECT a successor (snapshot-driven failover) instead of dissolving (build42)
    if (tour.hostId && !tour.members[tour.hostId] && tour.state !== 'done' && !tour.isHost && n > 0) {
      if (!maybePromoteHost()) {
        banner('mpx-tour-msg', 'The host disconnected — tournament dissolved.');
        setTimeout(function () { if (tour.id) closeTour(); }, 1800);
      }
      return;
    }
    if (tour.isHost && n !== was) { advertiseTour(); broadcastSnapshot(); }
    // host: a live duelist vanishing forfeits their unsettled pair — UNLESS they're provably still playing (build42:
    // streaming t-tick within 6s) → defer + re-check, so a transient presence blip never forfeits a live player.
    if (tour.isHost && tour.state === 'live') {
      tour.pairs.forEach(function (pr, i) {
        if (tour.settled[i] != null) return;
        pr.forEach(function (id) {
          if (id && !tour.members[id] && !tour.finals[id]) {
            if (isRecentlyAlive(id)) { scheduleForfeitRecheck(i, id); return; }
            tour.finals[id] = { id: id, score: -1, acc: 0, combo: 0, gone: true };
            trySettlePair(i);
          }
        });
      });
    }
    paintTourRoom();
  }

  // ============ BEFORE-PUBLIC HARDENING (build42): t-snapshot heartbeat · reconnection · host migration ·
  //              proof-of-life forfeit guard · score sanitation. All ADDITIVE — the working bracket flow is
  //              untouched; these add self-healing + failover on top. Server-authoritative re-judge (the real
  //              MP_PUBLIC=true gate) is a backend job — see MP_SERVER_SCORING_BRIEF.md. ============
  var _tourHbT = 0;   // build58: the snapshot-version floor moved onto the tour object (tour._lastSnapV) — see nullTour()
  var MAX_PLAUSIBLE_SCORE = 20000000;   // client sanity clamp only — NOT anti-cheat (a client owns its number; real validation is server-side)

  function bumpTour() { tour.version = (tour.version || 0) + 1; }
  function isRecentlyAlive(id) { return !!(tour._alive && tour._alive[id] && (Date.now() - tour._alive[id] < 6000)); }   // streaming t-tick ⇒ provably playing

  // a compact, idempotent mirror of the host's referee state (clients apply the newest version)
  function snapshotTour() {
    var fl = {};
    Object.keys(tour.finals || {}).forEach(function (k) { var f = tour.finals[k]; fl[k] = { id: f.id, score: f.score, acc: f.acc, combo: f.combo, grade: f.grade, gone: !!f.gone }; });
    return { tid: tour.id, v: tour.version || 0, state: tour.state, round: tour.round, alive: tour.alive,
      pairs: tour.pairs, byes: tour.byes, settled: tour.settled, finals: fl, sel: tour.sel, env: tour.env || null,
      envName: tour.envName, size: tour.size, atMs: tour.atMs || 0, awaiting: !!tour.awaiting,
      combat: !!tour.combat, songPool: tour.songPool || [],   // build100q: #172 per-tournament combat + #173 host-curated song list → entrants + a promoted heir inherit both
      awaitWinners: tour._awaitWinners || null, champ: tour.champ || null, hostId: tour.hostId, hostAt: tour._joinAt || 0,
      stakes: tour.stakes, buyIn: tour.buyIn, currency: tour.currency, potId: tour.potId, paid: tour.paid, bets: tour.bets, pot: tour.pot };   // build66: WAGER — replicate the buy-in + the HOST-verified paid roster to every entrant (and to a promoted heir on host migration)
  }
  function broadcastSnapshot() {
    if (!tour.ch || !tour.isHost || !tour.id) return;
    bumpTour();
    try { tour.ch.send({ type: 'broadcast', event: 't-snapshot', payload: snapshotTour() }); } catch (e) {}
    persistTour();
  }
  function startTourHeartbeat() {
    stopTourHeartbeat();
    if (!tour.isHost) return;
    _tourHbT = setInterval(function () {
      if (!tour.id || !tour.isHost) { stopTourHeartbeat(); return; }
      broadcastSnapshot();
    }, 4000);
  }
  function stopTourHeartbeat() { if (_tourHbT) { clearInterval(_tourHbT); _tourHbT = 0; } }

  // CLIENT: reconcile to the host's snapshot WITHOUT yanking a player mid-cinematic/mid-song.
  function applyTourSnapshot(s, isRestore) {
    if (!s || !tour.id || s.tid !== tour.id) return;
    if (tour.isHost && !isRestore) {
      // double-host race (two clients both promoted) → defer to the earliest-joined host and step down; else stay authoritative
      if (s.hostId && s.hostId !== ME.id && (s.hostAt || 0) > 0 && s.hostAt < (tour._joinAt || 0)) {
        tour.isHost = false; tour.hostId = s.hostId; stopTourHeartbeat();
        banner('mpx-tour-msg', tourName(s.hostId) + ' is hosting the bracket.');
      } else { return; }
    }
    if (s.hostId && s.hostId !== tour._snapHost) { tour._snapHost = s.hostId; tour._lastSnapV = -1; }   // build58: host changed (migration) → accept the new host's stream from its low start
    if (!isRestore && s.v != null && s.v <= tour._lastSnapV) return;   // older/equal → idempotent no-op
    if (!isRestore && s.v != null) tour._lastSnapV = s.v;
    tour.hostId = s.hostId || tour.hostId;
    if (s.sel) tour.sel = s.sel;
    if (s.envName != null) tour.envName = s.envName;
    if (s.size) tour.size = s.size;
    if (s.combat != null) tour.combat = !!s.combat;   // build100q #172: adopt the host's combat choice
    if (s.songPool) tour.songPool = s.songPool;        // build100q #173: adopt the host's per-round song list
    // build66: WAGER fields — buy-in/mode/currency + the HOST-verified paid roster + the live pot. Merge paid{} (never
    // shrink an entrant's view of who's in). A promoted heir inherits potId + paid, so settlement survives host migration.
    if (s.stakes) tour.stakes = s.stakes;
    if (s.buyIn != null) tour.buyIn = s.buyIn;
    if (s.currency) tour.currency = s.currency;
    if (s.potId) tour.potId = s.potId;
    if (s.paid) tour.paid = Object.assign({}, tour.paid || {}, s.paid);
    if (s.bets) tour.bets = Object.assign({}, tour.bets || {}, s.bets);   // build66: side-bet picks (bettorId -> outcomeId) replicate so every client can settle parimutuel + a promoted heir inherits them
    if (s.pot != null) tour.pot = s.pot;
    if (s.champ) tour.champ = s.champ;
    if (s.awaitWinners) tour._awaitWinners = s.awaitWinners;
    if (s.finals) tour.finals = Object.assign({}, tour.finals, s.finals);     // host-computed truth → a promoted host can resume
    if (s.settled) tour.settled = Object.assign({}, tour.settled, s.settled);
    // adopt the bracket SHELL only for a reconnector / late-joiner who is behind — round LAUNCH stays t-round-driven,
    // so an active player mid-round is never disrupted (their round===s.round, state===live → this branch is skipped).
    if (isRestore || tour.round < s.round || (tour.state === 'open' && s.state && s.state !== 'open')) {
      tour.round = s.round; tour.alive = s.alive || []; tour.pairs = s.pairs || []; tour.byes = s.byes || [];
      tour.state = s.state || tour.state; tour.atMs = s.atMs || 0; tour.env = s.env || null;
      var mp = null; (tour.pairs || []).forEach(function (pr) { if (pr.indexOf(ME.id) >= 0) mp = pr; });
      tour.meIn = !!mp; tour.rival = mp ? mp[(mp.indexOf(ME.id) + 1) % 2] : null;
    }
    if (s.awaiting) tour.awaiting = true;
    if (s.state === 'done' && tour.state !== 'done') { tour.state = 'done'; clearPersistedTour(); }
    try { paintTourRoom(); renderTourBoard(); renderTourBracket(); buildTourSongRow(); } catch (e) {}   // build100q #173: repaint the setlist chips when the host's snapshot lands
    if (!tour.isHost) persistTour();
    try { setTimeout(_wagerMaybePay, 350); } catch (e) {}   // build66: WAGER — once the staked snapshot lands, prompt the entrant to pay their buy-in (deferred out of the render path; self-guards against re-prompting)
  }

  // RECONNECTION: persist a small pointer + the latest snapshot; rejoin in place on reload (< 90s).
  function persistTour() {
    try {
      if (!tour.id || String(tour.id).indexOf('dev') === 0) return;   // never persist a dev/solo bracket
      if (tour.state === 'done') { clearPersistedTour(); return; }
      sessionStorage.setItem('rr_tour', JSON.stringify({ tid: tour.id, name: tour.name, hostId: tour.hostId,
        isHost: tour.isHost, ts: Date.now(), snap: snapshotTour() }));
    } catch (e) {}
  }
  function clearPersistedTour() { try { sessionStorage.removeItem('rr_tour'); } catch (e) {} }
  function maybeReconnectTour() {
    try {
      if (tour.id || !supa || !lobbyCh) return;
      var raw = sessionStorage.getItem('rr_tour'); if (!raw) return;
      var P = JSON.parse(raw); if (!P || !P.tid) return;
      if (Date.now() - (P.ts || 0) > 90000) { clearPersistedTour(); return; }   // stale → drop
      tour = nullTour(); tour.id = P.tid; tour.name = P.name || 'BRACKET'; tour.isHost = false; tour.hostId = P.hostId || null;
      tour._joinAt = Date.now();
      joinTourChannel(P.tid);
      if (P.snap) applyTourSnapshot(P.snap, true);   // seed the UI from the persisted snapshot; live t-snapshot refines it
      reannounce(); enterTourRoom();
      banner('mpx-tour-msg', 'Reconnecting to the bracket…');
    } catch (e) {}
  }

  // HOST MIGRATION: on host loss, the earliest-joined human still present promotes (deterministic → one winner).
  function maybePromoteHost() {
    var cands = Object.keys(tour.members).filter(function (id) { return id && id !== tour.hostId && !(tour.members[id] || {}).bot; });
    if (!cands.length) return false;   // nobody left to host (e.g. all-bots dev path) → caller dissolves
    cands.sort(function (a, b) { var aa = (tour.members[a] || {}).at || 0, bb = (tour.members[b] || {}).at || 0; return aa !== bb ? aa - bb : (a < b ? -1 : 1); });
    var heir = cands[0];
    if (heir !== ME.id) { tour.hostId = heir; banner('mpx-tour-msg', 'Host left — ' + tourName(heir) + ' is taking over…'); return true; }
    tour.isHost = true; tour.hostId = ME.id; if (!tour._joinAt) tour._joinAt = Date.now();
    banner('mpx-tour-msg', 'Host left — you are now running the bracket.');
    try { advertiseTour(); } catch (e) {}
    if (tourSP) tourSP.refresh();   // re-announce with hostTourn set
    startTourHeartbeat(); broadcastSnapshot(); resumeHostDuties();
    return true;
  }
  function resumeHostDuties() {
    if (!tour.isHost) return;
    // build58 FIX: handle the BETWEEN-ROUNDS (await) window FIRST. During await, tour.state is still 'live' (it's cleared only
    // at the next round / champ), so the old `else if (tour.awaiting)` branch was SHADOWED by the live branch → a promoted heir
    // never rebuilt _next or revealed START NEXT ROUND, hanging the whole bracket. Now the heir re-arms the await: rebuild the
    // next round + repaint the advance control via onTourAwait, plus a generous AFK auto-advance so it can never deadlock.
    if (tour.awaiting && tour._awaitWinners) {
      if (!tour._next) tour._next = { n: (tour.round + 1), winners: tour._awaitWinners, sel: hostNextTrack() };
      try { onTourAwait({ n: (tour.round + 1), winners: tour._awaitWinners }); } catch (e) {}
      if (_devAuto) setTimeout(hostStartNextRound, 1200);
      // build61: a promoted heir auto-advances after 25s UNLESS it has HOLD on — same streamer-pause semantics as the AFK timer.
      else setTimeout(function () { if (tour.isHost && tour.awaiting && !tour._hostHold && tour._next) hostStartNextRound(); }, 25000);
      return;
    }
    if (tour.state === 'live') {
      // re-arm settlement from accumulated finals (every client stores finals before the host-gate, so a promoted host has them)
      tour.pairs.forEach(function (pr, i) {
        if (tour.settled[i] != null) return;
        if (!tour._settleT[i]) tour._settleT[i] = setTimeout(function () { forceSettleGuarded(i); }, 30000);
        trySettlePair(i);
      });
    }
  }

  // FORFEIT GUARD: never punish a provably-live player. Re-check liveness before stubbing a -1 forfeit.
  function scheduleForfeitRecheck(i, id) {
    if (tour._settleT['ff' + i]) return;
    banner('mpx-tour-msg', 'Waiting on ' + tourName(id) + '…');
    tour._settleT['ff' + i] = setTimeout(function () {
      delete tour._settleT['ff' + i];
      if (!tour.isHost || tour.settled[i] != null) return;
      if (tour.members[id] || tour.finals[id]) return;          // returned or finished → no forfeit
      if (isRecentlyAlive(id)) { scheduleForfeitRecheck(i, id); return; }   // still streaming ticks → keep waiting
      tour.finals[id] = { id: id, score: -1, acc: 0, combo: 0, gone: true };
      trySettlePair(i, true);
    }, 7000);
  }
  function forceSettleGuarded(i) {
    if (!tour.isHost || tour.settled[i] != null) return;
    var pr = tour.pairs[i]; if (!pr) return;
    var liveStill = pr.filter(function (id) { return !tour.finals[id] && isRecentlyAlive(id); });
    if (liveStill.length) { banner('mpx-tour-msg', 'Waiting on ' + liveStill.map(tourName).join(', ') + '…'); tour._settleT[i] = setTimeout(function () { forceSettleGuarded(i); }, 8000); return; }
    trySettlePair(i, true);
  }

  // SCORE SANITATION: clamp/repair an inbound final so junk/NaN/overflow can't win a bracket (server re-judge is the real gate).
  function sanitizeFinal(p) {
    if (!p || !p.id) return null;
    var sc = +p.score; if (!isFinite(sc)) sc = -1; sc = sc < -1 ? -1 : Math.min(sc, MAX_PLAUSIBLE_SCORE);
    var acc = +p.acc; if (!isFinite(acc) || acc < 0) acc = 0; if (acc > 100) acc = 100;
    var cb = +p.combo; if (!isFinite(cb) || cb < 0) cb = 0; cb = Math.min(cb, 100000);
    return { id: p.id, score: sc, acc: acc, combo: cb, grade: p.grade || '', gone: !!p.gone,
      trackId: p.trackId || null, diff: p.diff || null, notes: (+p.notes || 0), fc: !!p.fc, ranked: !!p.ranked };
  }

  // ---- track roll (host) ----
  function rollTrack() {
    if (!tour.isHost || tour.state !== 'open') return;
    var RC = window.RhythmCatalog, all = (RC && RC.allTracks) ? RC.allTracks() : [];
    if (RC && RC.trackReady) all = all.filter(function (t) { return RC.trackReady(t) && !(RC.isVideo && RC.isVideo(t)); });
    var sel = null;
    if (all.length) {
      var t = all[Math.floor(Math.random() * all.length)];
      sel = { trackId: t.id, title: t.title, artist: t.artist_credit_name || t.artist_name, art: t.artwork_url, difficulty: tourDiff(), demo: (t.id === 'demo') };
    }
    if (!sel) sel = { trackId: 'demo', title: 'Lunar Waves', artist: 'ReactivVibe', art: null, difficulty: tourDiff(), demo: true };
    tour.sel = sel; broadcastTourTrack();
  }
  function tourDiff() {
    var d = screen.querySelector('#mpx-tdiff button.active');
    return (d && d.getAttribute('data-diff')) || 'medium';
  }
  function broadcastTourTrack() {
    if (!tour.ch) return;
    try { tour.ch.send({ type: 'broadcast', event: 't-track', payload: { sel: tour.sel, envName: tour.envName, size: tour.size, songPool: tour.songPool || [] } }); } catch (e) {}   // build100q #173: carry the setlist so the filling room shows it live
  }
  function onTourTrack(p) {
    if (!p) return;
    if (p.sel) tour.sel = p.sel;
    if (p.envName != null) tour.envName = p.envName;
    if (p.size) tour.size = p.size;
    if (p.songPool) tour.songPool = p.songPool;   // build100q #173: entrants adopt the host's setlist
    buildTourEnvRow(); buildTourSongRow(); paintTourRoom();
  }

  // ---- build11: full-library SEARCH picker for the bracket (host) ----
  function tourRenderPicker(q) {
    var box = $('mpx-tour-results'); if (!box) return;
    var RC = window.RhythmCatalog;
    var all = (RC && RC.allTracks) ? RC.allTracks() : [];
    if (RC && RC.trackReady) all = all.filter(function (t) { return RC.trackReady(t) && !(RC.isVideo && RC.isVideo(t)); });
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
        addSongToPool(t);   // build100q #173: APPEND to the setlist (rounds rotate through it) instead of replacing the single pick — keep the picker open to add more
      });
    });
  }

  // ---- build11: STAGE (environment) chips for the bracket (host picks; everyone sees) ----
  function tourEnvList() {
    try { if (window.RhythmLevels && window.RhythmLevels.environments) return window.RhythmLevels.environments(); } catch (e) {}
    return null;
  }
  // BETA gate: only FINISHED levels are playable as tournament stages (keep in sync with LVL_FINISHED in the
  // Levels screen + the Environment Picker). Unfinished envs are Coming Soon: not pickable AND excluded from Random.
  // single source of truth (window.RR_FINISHED_LEVELS, defined with RHYTHM_CONFIG before this script loads); fail-closed to {}
  function _finished() { return (typeof window !== 'undefined' && window.RR_FINISHED_LEVELS) || {}; }
  function _envComingSoon(e) { return !!(e && !e.isDefault && !e.isRandom && !_finished()[e.id]); }
  function poolHas(id) { return (tour.envPool || []).indexOf(id) >= 0; }
  // host's stage pool → a short human summary for the room display
  function envPoolSummary() {
    var pool = tour.envPool || [];
    if (!pool.length || pool.indexOf('__random') >= 0) return 'Random';
    var list = tourEnvList() || [];
    var names = pool.map(function (id) { var hit = null; list.forEach(function (e) { if (e.id === id) hit = e; }); return hit ? hit.name : null; }).filter(Boolean);
    if (!names.length) return 'Random';
    if (names.length === 1) return names[0];
    return names[0] + ' +' + (names.length - 1);
  }
  // toggle a stage in/out of the host's pool (Random is exclusive: picking it clears the rest)
  function toggleEnvPool(id, isRandom) {
    var pool = (tour.envPool || []).slice();
    if (isRandom) { pool = ['__random']; }
    else {
      pool = pool.filter(function (x) { return x !== '__random'; });
      var at = pool.indexOf(id);
      if (at >= 0) pool.splice(at, 1); else pool.push(id);
      if (!pool.length) pool = ['__random'];   // never empty
    }
    tour.envPool = pool; tour.envName = envPoolSummary();
    broadcastTourTrack(); buildTourEnvRow(); paintTourRoom();
  }
  function buildTourEnvRow() {
    var rowEl = $('mpx-tour-env'), head = $('mpx-tour-envhead'); if (!rowEl) return;
    var list = tourEnvList();
    // build64: hide unfinished "COMING SOON" stages entirely (match the song env-picker / room STAGE picker — only real
    // RR_FINISHED_LEVELS belong in the pool). Keep Random + Arena (_envComingSoon excludes them); drop unowned-paid stages
    // too (peers may not own them, and hostResolveEnv refuses to roll a paid stage anyway).
    if (list) list = list.filter(function (e) {
      if (_envComingSoon(e)) return false;
      if (e.paid) { try { var rc = window.RhythmCatalog; return !!(rc && rc.ownsItem && rc.ownsItem('level', e.entId || e.id)); } catch (x) { return false; } }   // build100q: query the ENTITLEMENT id (entId, underscore) — admin/owner/purchaser owns it
      return true;
    });
    var show = !!list && tour.isHost && tour.state === 'open';
    if (head) head.hidden = !list;
    rowEl.hidden = !list;
    if (!list) return;
    rowEl.innerHTML = '';
    list.forEach(function (e) {
      var comingSoon = _envComingSoon(e);
      // build100q (#175): a paid stage is LOCKED only if the player does NOT own it — was gated on the purged rr_dev flag
      // (`e.paid && !dev`), so it locked premium stages even for the ADMIN/owner ("I own everything but it says unlock").
      // ownsItem returns true for admin/owner/dev + real purchasers (entId = the underscore entitlement id, per #166).
      var _ownsPaid = true; if (e.paid) { try { var _rcL = window.RhythmCatalog; _ownsPaid = !!(_rcL && _rcL.ownsItem && _rcL.ownsItem('level', e.entId || e.id)); } catch (x) { _ownsPaid = false; } }
      var locked = !!((e.paid && !_ownsPaid) || comingSoon);
      var on = poolHas(e.id) || (e.isRandom && (!tour.envPool || !tour.envPool.length));
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'env-chip' + (on ? ' sel' : '') + (locked ? ' locked' : '') + (comingSoon ? ' soon' : '');
      b.setAttribute('role', 'checkbox');
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      if (e.accent) b.style.setProperty('--ec', e.accent);
      var ini = (e.name || '?').trim().charAt(0).toUpperCase();
      var artBg = e.cover ? ("background-image:url('" + safeUrl(e.cover) + "');") : '';
      var tag = e.isRandom ? 'ALL STAGES' : e.isDefault ? 'ARENA' : comingSoon ? 'COMING SOON' : ((e.boss ? 'BOSS · ' : '') + (e.theme || '').toUpperCase());
      b.innerHTML = '<div class="ec-art" style="' + artBg + '">' + (e.cover ? '' : '<span class="ec-ini">' + esc(ini) + '</span>') + (locked ? '<span class="ec-lock">🔒</span>' : '') + '</div>' +
        '<div class="ec-body"><div class="ec-name">' + esc(e.name) + '</div><div class="ec-tag">' + esc(tag) + '</div></div>';
      if (show && !locked) b.addEventListener('click', function () { toggleEnvPool(e.id, !!e.isRandom); });
      else b.disabled = true;
      rowEl.appendChild(b);
    });
  }
  // build100q #173: host's per-round SONG pool (mirrors envPool). Search results APPEND here; rounds cycle through it.
  function addSongToPool(t) {
    if (!tour.isHost || tour.state !== 'open' || !t) return;
    var pool = (tour.songPool || []).slice();
    if (pool.some(function (s) { return s.trackId === t.id; })) { banner('mpx-tour-msg', '“' + (t.title || 'Track') + '” is already in the setlist.'); return; }   // dedup
    if (pool.length >= 12) { banner('mpx-tour-msg', 'Setlist is full (12 songs).'); return; }
    pool.push({ trackId: t.id, title: t.title, artist: t.artist_credit_name || t.artist_name, art: t.artwork_url, demo: (t.id === 'demo') });
    tour.songPool = pool;
    tour.sel = Object.assign({}, pool[0], { difficulty: tourDiff() });   // round-1/display song stays valid (paintTourRoom/snapshot rely on tour.sel)
    broadcastTourTrack(); buildTourSongRow(); paintTourRoom();
  }
  function removeSongFromPool(id) {
    if (!tour.isHost || tour.state !== 'open') return;
    tour.songPool = (tour.songPool || []).filter(function (s) { return s.trackId !== id; });
    if (tour.songPool.length) tour.sel = Object.assign({}, tour.songPool[0], { difficulty: tourDiff() });
    broadcastTourTrack(); buildTourSongRow(); paintTourRoom();
  }
  function buildTourSongRow() {
    var rowEl = $('mpx-tour-songrow'), head = $('mpx-tour-songhead'); if (!rowEl) return;
    var pool = tour.songPool || [];
    var show = tour.isHost && tour.state === 'open';
    if (head) head.hidden = !(pool.length || show);   // entrants see the setlist read-only; host gets ✕ remove
    rowEl.hidden = !(pool.length || show);
    rowEl.innerHTML = '';
    if (!pool.length) {
      if (show) { var hint = document.createElement('span'); hint.style.cssText = 'font-size:11px;color:var(--ink-dim);padding:4px 2px'; hint.textContent = 'No songs added — each round rolls a random track. Tap SEARCH to build a setlist.'; rowEl.appendChild(hint); }
      return;
    }
    pool.forEach(function (s, i) {
      var chip = document.createElement('span');
      chip.className = 'env-chip sel';
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:7px;padding:6px 10px';
      chip.innerHTML = '<span style="opacity:.55;font-weight:700">' + (i + 1) + '</span><span>' + esc(s.title || 'Untitled') + '</span>';
      if (show) {
        var x = document.createElement('button');
        x.type = 'button';
        x.setAttribute('aria-label', 'Remove ' + (s.title || 'song') + ' from setlist');
        x.style.cssText = 'background:none;border:0;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0 1px;opacity:.7';
        x.textContent = '✕';
        x.addEventListener('click', function (e) { e.stopPropagation(); removeSongFromPool(s.trackId); });
        chip.appendChild(x);
      }
      rowEl.appendChild(chip);
    });
  }
  // host resolves the concrete stage for round n — cycles the pool so each round rotates stage (Random → fresh roll)
  function hostResolveEnv(n) {
    var pool = tour.envPool || [];
    var list = tourEnvList(); if (!list) return null;
    if (!pool.length || pool.indexOf('__random') >= 0) {
      var all = list.filter(function (e) { return !e.isDefault && !e.isRandom && !e.paid && !_envComingSoon(e); });   // build60: never ROLL a paid stage in a tournament (peers may not own it → free premium content)
      if (!all.length) return null;
      var r = all[Math.floor(Math.random() * all.length)];
      return { id: r.id, name: r.name };
    }
    var pick = pool[((n || 1) - 1) % pool.length];
    if (!pick || pick === '__default') return null;
    var hit = null; list.forEach(function (e) { if (e.id === pick) hit = e; });
    return hit ? { id: hit.id, name: hit.name } : null;
  }

  // ---- host: start + run rounds ----
  function buildPairs(alive) {
    var pairs = [], byes = [];
    for (var i = 0; i + 1 < alive.length; i += 2) pairs.push([alive[i], alive[i + 1]]);
    if (alive.length % 2 === 1) byes.push(alive[alive.length - 1]);
    return { pairs: pairs, byes: byes };
  }
  function startTour() {
    if (!tour.isHost || tour.state !== 'open') return;
    if (!tour.sel) { banner('mpx-tour-msg', 'Pick a track first — tap REROLL or SEARCH, then START.'); return; }   // was a silent no-op
    var _staked = tour.stakes && tour.stakes !== 'free';
    if (_staked) { var _n = Object.keys(tour.members).length, _paidN = Object.keys(tour.paid || {}).length; if (_paidN < _n) { banner('mpx-tour-msg', 'Waiting on buy-ins — ' + _paidN + '/' + _n + ' paid in.'); return; } }   // build71: re-assert the everyone-paid gate IN CODE — the disabled START button alone could be clicked through a state-sync race
    var ids = Object.keys(tour.members);
    if (ids.length < TOUR_MIN) { banner('mpx-tour-msg', 'Need at least ' + TOUR_MIN + ' players to start (add NPCs in the dev bar to solo-test).'); return; }
    try { if (window.RhythmGame.getAC) window.RhythmGame.getAC().resume(); } catch (e) {}   // unlock the AudioContext on the START gesture — the deferred play() fires ~5s later, outside any gesture
    for (var i = ids.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
    hostBeginRound(1, ids, hostResolveSong(1));   // build100q #173: round 1 = first curated song (falls back to tour.sel/random when the pool is empty)
  }
  function hostBeginRound(n, alive, sel) {
    var pb = buildPairs(alive);
    tour.ch.send({ type: 'broadcast', event: 't-round', payload: {
      n: n, alive: alive, pairs: pb.pairs, byes: pb.byes, sel: sel,
      env: hostResolveEnv(n),                       // the STAGE this round is fought on (cycles the host's pool; null = arena)
      combat: !!tour.combat,                         // build100q #172: carry the host's combat choice into every round (onTourRound sets matchCombat)
      atMs: Date.now() + TOUR_LEADIN_MS } });        // longer lead-in for the 3-beat cinematic (ROUND → VS → 3·2·1)
  }
  function hostNextTrack() {
    var RC = window.RhythmCatalog, all = (RC && RC.allTracks) ? RC.allTracks() : [];
    // build100q (#174): require DECODABLE audio (trackAudioUrl skips HLS), not just trackReady — else a random round-N
    // pick could land on an .m3u8-only track that can't chart in-browser → the round never starts → watchdog aborts.
    if (RC) all = all.filter(function (t) { return (!RC.trackReady || RC.trackReady(t)) && !(RC.isVideo && RC.isVideo(t)) && (!RC.trackAudioUrl || !!RC.trackAudioUrl(t)); });
    if (!all.length) return tour.sel;
    var t = all[Math.floor(Math.random() * all.length)];
    return { trackId: t.id, title: t.title, artist: t.artist_credit_name || t.artist_name, art: t.artwork_url, difficulty: (tour.sel && tour.sel.difficulty) || 'medium', demo: (t.id === 'demo') };
  }
  // build100q #173: host resolves the concrete SONG for round n — cycles the host-curated songPool (mirrors hostResolveEnv).
  // Empty pool = legacy random roll (back-compat with in-flight brackets + the dev solo harness). Preserves difficulty/demo.
  function hostResolveSong(n) {
    var pool = tour.songPool || [];
    if (!pool.length) return hostNextTrack();
    var pick = pool[((n || 1) - 1) % pool.length];     // cycle if rounds > songs
    if (!pick || !pick.trackId) return hostNextTrack();
    // build100q (#174): re-validate the pool pick is PLAYABLE + DECODABLE right now — if it drifted out of the catalog
    // or is HLS-only, round N would fail to start and the watchdog would abort everyone to the room. Fall back to a
    // guaranteed-decodable random roll. (demo always plays.)
    if (!pick.demo) {
      try {
        var RC = window.RhythmCatalog, all = (RC && RC.allTracks) ? RC.allTracks() : [];
        var ft = all.filter(function (x) { return x.id === pick.trackId; })[0];
        if (!ft || (RC.isVideo && RC.isVideo(ft)) || (RC.trackAudioUrl && !RC.trackAudioUrl(ft))) return hostNextTrack();
      } catch (e) { return hostNextTrack(); }
    }
    return Object.assign({}, pick, { difficulty: (tour.sel && tour.sel.difficulty) || tourDiff() });
  }

  // ---- uniform round handler (host included via self:true) ----
  function onTourRound(p) {
    if (!p || !p.n) return;
    // build58: dedup on a per-EMISSION token (atMs is unique per hostBeginRound call), not the round NUMBER alone. The old
    // number-only guard double-purposed: it blocked our own self:true echo (good) BUT also permanently swallowed a LEGITIMATE
    // re-issue of the same round (a promoted host restarting round n after an abort). Token dedup kills only true echoes.
    var _tok = p.atMs || p.n;
    if (tour._roundTok === _tok) return;                                                  // exact echo (incl. self-broadcast) → never double-launch
    if (tour.state === 'live' && tour.round === p.n && p.atMs && tour.atMs && p.atMs < tour.atMs) return;   // a stale OLDER emission of the round we're already running
    tour._roundTok = _tok;
    tour.awaiting = false;
    closeTransientOverlays();   // belt-and-suspenders: no overlay (How-To/store/levels/profile/settings) can occlude the starting round
    var _nw = $('mpx-tour-nextwrap'); if (_nw) _nw.hidden = true;
    var _nb = $('mpx-tour-next'); if (_nb) _nb.classList.remove('hot');
    tour.state = 'live'; tour.round = p.n; tour.alive = p.alive || []; tour.pairs = p.pairs || [];
    tour.byes = p.byes || []; tour.sel = p.sel; tour.finals = {}; tour.settled = {};
    tour.env = p.env || null; tour.atMs = p.atMs || 0; tour._alive = {};   // build42: per-round liveness reset + round env/atMs for snapshots
    if (p.combat != null) { matchCombat = !!p.combat; tour.combat = !!p.combat; }   // build100q #172: this round's combat mode (parallels the 1v1 onStart) — drives shock send/receive gates
    _lastShockCombo = 0; _lastOdActive = false; _lastStunAt = 0;   // build100q #172: re-arm combat-shock state for the new round
    if (p.songPool) tour.songPool = p.songPool;   // build100q #173: keep entrants' songPool current as the bracket advances
    Object.keys(tour._settleT).forEach(function (k) { clearTimeout(tour._settleT[k]); }); tour._settleT = {};
    if (tour.isHost) { advertiseTour(); startTourHeartbeat(); broadcastSnapshot(); }
    var myPair = null;
    tour.pairs.forEach(function (pr) { if (pr.indexOf(ME.id) >= 0) myPair = pr; });
    tour.meIn = !!myPair; tour.rival = myPair ? myPair[(myPair.indexOf(ME.id) + 1) % 2] : null;
    if (_awaitAutoT) { clearTimeout(_awaitAutoT); _awaitAutoT = 0; }   // build61: round launched → drop any pending AFK auto-advance
    paintTourRoom(); renderTourBoard(); renderTourBracket(); paintHostPaceControls();   // build61: hide the pace row, reveal the ready indicator
    var rchip = $('mpx-tour-chip'); if (rchip) { rchip.setAttribute('data-state', 'live'); rchip.textContent = tour.alive.length === 2 ? 'THE FINAL' : 'ROUND ' + p.n; }
    screen.classList.add('active'); activeNow = true; step('tour');   // pull everyone back from results/winner views
    // cinematic build over the live room (never blanks the bracket): ROUND card → VS reveal → 3·2·1·GO
    if (p.atMs && p.atMs > Date.now()) {
      var _rl = tour.alive.length <= 2 ? 'THE FINAL' : tour.alive.length <= 4 ? 'SEMI-FINAL' : 'ROUND ' + p.n;
      var _sub = (p.env && p.env.name) ? p.env.name : ((tour.sel && tour.sel.title) ? tour.sel.title : '');
      var _vs = myPair ? ('<span class="me">YOU</span><span class="vsv">VS</span><span>' + esc(tourName(tour.rival)) + '</span>')
        : (tour.byes.indexOf(ME.id) >= 0 ? '<span class="me">YOU</span><span class="vsv">·</span><span>BYE — AUTO-ADVANCE</span>' : 'SPECTATING');
      startTourCountdown(p.atMs, { label: _rl, sub: _sub, vsHtml: _vs });
    }
    if (myPair) {
      setSpectating(false);   // you're competing this round, not watching
      oppMeta = tourSeat(tour.rival);
      if (_devSpectate) {
        // dev: hands-free — bank a synthetic final instead of playing (devDriveBots does it)
        banner('mpx-tour-msg', 'ROUND ' + p.n + ' — auto-resolving (dev) · you vs ' + tourName(tour.rival));
      } else {
        banner('mpx-tour-msg', 'ROUND ' + p.n + ' — you vs ' + tourName(tour.rival) + (p.env ? ' · stage: ' + p.env.name : '') + '. Launching…');
        // build11: fight on the host-broadcast STAGE (same level theme for every duelist)
        try {
          var RL = window.RhythmLevels;
          if (RL) { if (p.env && p.env.id) RL.applyEnvironment(p.env.id); else RL.clearEnvironment(); }
        } catch (e) {}
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
        _mountT = setTimeout(function () {
          _mountT = 0; stopTourCountdown(); hideTourCd();   // the cinematic veil tears down exactly as the decks reveal
          if (!tour.id || tour.round !== p.n || !tour.meIn) return;   // round aborted / changed / left during the lead-in → don't mount a zombie split
          if (!vsIsMobile()) {                       // tournaments get the split-screen too (desktop/PC)
            var g = $('game'); if (g) g.classList.add('vs-mode', 'vs-tour');   // vs-tour: hides the dead opp-OD (t-tick has no OD data)
            _vsActive = true; _vsMode = true;
            oppMeta = tourSeat(tour.rival);          // opponent label on the ghost deck
            mountVsHud();
            try { window.dispatchEvent(new Event('resize')); } catch (e) {}
            startTourTick();
            runVsIntro();
            if (tour.rival && (tour.members[tour.rival] || {}).bot) devDriveRival(p.n);   // show the bot rival PLAYING on the ghost deck whenever it's a bot (not only in auto-run)
          } else { mountOppPanel(); startTourTick(); }
        }, delay + 80);
      }
    } else if (tour.byes.indexOf(ME.id) >= 0) {
      banner('mpx-tour-msg', '👁 BYE this round — you auto-advance. Spectating the live matches…');
      setTimeout(function () { stopTourCountdown(); hideTourCd(); setSpectating(true, p.n); step('tour'); }, Math.max(0, p.atMs - Date.now()) + 140);   // drop the veil, reveal the LIVE board
    } else if (tour.alive.indexOf(ME.id) < 0 && tour.round > 1) {
      banner('mpx-tour-msg', '👁 Eliminated — spectating the bracket LIVE. Watch it play out to the champion.');
      setTimeout(function () { stopTourCountdown(); hideTourCd(); setSpectating(true, p.n); step('tour'); }, Math.max(0, p.atMs - Date.now()) + 140);
    } else {
      banner('mpx-tour-msg', '👁 Spectating Round ' + p.n + ' — live.');
      setTimeout(function () { stopTourCountdown(); hideTourCd(); setSpectating(true, p.n); step('tour'); }, Math.max(0, p.atMs - Date.now()) + 140);   // spectator
    }
    if (tour.isHost && Object.keys(_devBots).length) devDriveBots(p);   // bots bank finals whenever they exist (NOT only in auto-run) so a manual solo tournament actually completes each round
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
      // build100q #172: TOURNAMENT combat — shock the rival on each combo milestone + on Overdrive activation (mirrors the
      // 1v1 send, but over tour.ch and targeted at tour.rival). Humans only; the milestone/OD guards self-throttle so this
      // doesn't need the 350ms gate. _lastShockCombo/_lastOdActive are re-armed per round in onTourRound.
      if (matchCombat && stt && tour.ch && tour.meIn && tour.rival && !((tour.members[tour.rival] || {}).bot)) {
        var _tc = stt.combo || 0;
        if (_tc < _lastShockCombo) _lastShockCombo = 0;                          // combo broke → re-arm
        var _tms = Math.floor(_tc / SHOCK_COMBO_STEP) * SHOCK_COMBO_STEP;
        var _tod = (!!stt.odActive && !_lastOdActive); _lastOdActive = !!stt.odActive;
        var _thit = (_tms >= SHOCK_COMBO_STEP && _tms > _lastShockCombo);
        if (_thit || _tod) {
          if (_thit) _lastShockCombo = _tms;
          try { tour.ch.send({ type: 'broadcast', event: 't-shock', payload: { fromId: ME.id, from: ME.name, to: tour.rival, combo: _tc, od: _tod } }); } catch (e) {}
          try { window.RhythmGame.mpShockSent && window.RhythmGame.mpShockSent(); } catch (e) {}
          try { _spawnZapBolt(); } catch (e) {}
        }
      }
      if (_vsMode) {
        if (window.RhythmGame.getRenderFrame && now - _lastStateSend > 72) {
          _lastStateSend = now; _myRf = window.RhythmGame.getRenderFrame();
          // build44: stream the FULL render frame to your rival (the pair you're watching) so a REAL opponent's ghost
          // deck shows their ACTUAL hits/misses, not just score — matches 1v1. Bounded: only paired players in small
          // rounds (≤6) stream this; the board always rides the cheap t-tick. Big rounds → the future live leaderboard.
          if (tour.ch && tour.meIn && tour.rival && _myRf && (!tour.alive || tour.alive.length <= 6)) {
            _myRf.id = ME.id; try { tour.ch.send({ type: 'broadcast', event: 't-state', payload: _myRf }); } catch (e) {}
          }
        }
        renderVsHud(stt, _myRf); renderGhost();
      } else if (oppPanel && oppPanel.parentNode) renderOpp(stt);
    }
    _tourRaf = requestAnimationFrame(frame);
  }
  function stopTourTick() { if (_tourRaf) cancelAnimationFrame(_tourRaf); _tourRaf = 0; }
  function onTourTick(p) {
    if (!p || !p.id) return;
    if (tour._alive) tour._alive[p.id] = Date.now();   // build42: proof-of-life — a streaming tick means this player is actively playing
    paintTourReady();   // build61: refresh the "X / N loaded" indicator as proof-of-life arrives (cheap DOM text)
    // build96 (playtest): a SPECTATOR follows a FOCUSED player so the watch deck shows a real match. Default to whoever
    // streams first (then WATCH NEXT cycles). Feeds the SAME lastOppState the opponent deck renders for a duelist.
    if (spectating && p.id !== ME.id) {
      if (!_specFocus) { _specFocus = p.id; _paintSpecLabel(); }
      if (p.id === _specFocus) { lastOppTick = p; lastOppState = { sc: p.score || 0, cb: p.combo || 0, pr: p.prog || 0, od: 0, oda: false, mu: 1, st: 1, ev: [] }; }
    }
    if (p.id === tour.rival) {
      lastOppTick = p;
      // feed the ghost deck + compact HUD from the rival's tick (tournaments stream t-tick, not t-state)
      lastOppState = { sc: p.score || 0, cb: p.combo || 0, pr: p.prog || 0, od: 0, oda: false, mu: 1, st: 1, ev: [] };
    }
    updateBoardScore(p.id, p.score);
  }
  // build44: the rival's FULL render frame (paired tournament players stream it like 1v1) → the ghost deck shows
  // their real hits/misses, combo + OD — it reads as them actually playing, not just a climbing score.
  function onTourState(p) { if (p && (p.id === tour.rival || (spectating && p.id === _specFocus))) lastOppState = p; }   // build96: a spectator renders the FOCUSED player's full render frame (real hits/misses/notes), not just score
  // dev: in a solo bot tournament, drive the rival bot's live "play" so the split-screen ghost looks alive
  function devDriveRival(roundN) {
    if (_npcRaf) cancelAnimationFrame(_npcRaf);
    var t0 = performance.now(); _npcLastEv = 0;
    // build44: make the bot read as a REAL player — strike a note ~9/s and HIT or MISS by its difficulty; a miss
    // RESETS the combo (so the ghost deck flashes a crimson miss + the multiplier dips), not a flawless auto-run.
    var missRate = _devBotDiff === 'easy' ? 0.22 : (_devBotDiff === 'hard' ? 0.06 : 0.13), _npcCombo = 0;
    (function ghost() {
      if (!tour.id || tour.round !== roundN || !tour.meIn) { _npcRaf = 0; return; }
      var stt = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;
      var el = (performance.now() - t0) / 1000, ev = [];
      if (el - _npcLastEv > 0.11) {
        _npcLastEv = el;
        var miss = Math.random() < missRate;
        if (miss) _npcCombo = 0; else _npcCombo++;
        ev.push({ l: Math.floor(Math.random() * 5), j: miss ? 'm' : 'g' });
      }
      lastOppState = { sc: Math.round((stt ? stt.score : 0) * 0.9 + el * _botPace()), cb: _npcCombo,
        mu: 1 + Math.min(3, Math.floor(_npcCombo / 10)), od: Math.min(1, el / 16), oda: (el % 20) > 16, st: 1,
        pr: stt ? stt.progress : Math.min(1, el / 120), ev: ev };
      lastOppTick = { id: tour.rival, score: lastOppState.sc, combo: lastOppState.cb, prog: lastOppState.pr };
      updateBoardScore(tour.rival, lastOppState.sc);
      _npcRaf = requestAnimationFrame(ghost);
    })();
  }

  // ---- finals + host settlement ----
  function onTourSongEnd(reason, results) {
    stopTourTick(); unmountOppPanel();
    if (_npcRaf) { cancelAnimationFrame(_npcRaf); _npcRaf = 0; }   // stop the bot-rival drive
    var g = $('game'); if (g) g.classList.remove('vs-mode', 'vs-tour', 'you-od-fire', 'vs-intro');   // drop the split before the bracket room
    _vsActive = false; _vsMode = false; unmountVsHud();
    var s = results
      ? { score: results.score, acc: Math.round((results.accuracy || 0) * 1000) / 10, combo: results.max_combo, grade: results.grade }
      : (window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : { score: 0, acc: 0, combo: 0 });
    try { tour.ch.send({ type: 'broadcast', event: 't-final', payload: { id: ME.id, score: s.score, acc: s.acc, combo: s.combo, grade: s.grade,
      trackId: (tour.sel && tour.sel.trackId) || null, diff: (tour.sel && tour.sel.difficulty) || null,
      notes: (results && results.notes_total) || 0, fc: !!(results && results.full_combo), ranked: MP_PUBLIC } }); } catch (e) {}   // build42: chart context + ranked flag for a future server re-judge
    // dev: the rival BOT "finished the same song" — bank its final NOW (at the human's song-end), so the human's
    // pair settles only when the human actually finishes (never a mid-song forfeit). Score = the running ghost
    // score the user just watched (believable), else a difficulty-scaled value.
    if (tour.isHost && tour.rival && (tour.members[tour.rival] || {}).bot && !tour.finals[tour.rival]) {
      var _rs = (lastOppState && lastOppState.sc) ? Math.round(lastOppState.sc) : devBotScore();
      onTourFinal({ id: tour.rival, score: _rs, acc: Math.round((76 + Math.random() * 22) * 10) / 10, combo: 40 + Math.floor(Math.random() * 300), grade: 'A' });
    }
    // come straight back to the bracket board. endGame() calls showScreen('results') SYNCHRONOUSLY right
    // after _fireSongEnd (this callback), which strips .active off this overlay — so defer the re-raise one
    // tick (after that strip), mirroring the 1v1 showWinner() path. Otherwise the solo results screen wins.
    setTimeout(function () {
      screen.classList.add('active'); activeNow = true; step('tour');
      _bracketWaitBanner();   // build58: live "X / Y duels resolved" instead of static dead-time
    }, 0);
  }
  function onTourFinal(p) {
    p = sanitizeFinal(p);   // build42: clamp/repair junk (NaN/overflow/out-of-range) before it can win a bracket
    if (!p) return;
    if (tour.finals[p.id]) return;   // first report wins; a forfeit stub or settled pair never flips late
    tour.finals[p.id] = p;
    updateBoardScore(p.id, p.score, true);
    if (!tour.isHost) { persistTour(); return; }
    tour.pairs.forEach(function (pr, i) {
      if (pr.indexOf(p.id) >= 0 && tour.settled[i] == null) {
        // absent-window after the FIRST final of a pair: same track ends near-simultaneously, but a slow decode
        // can stretch the gap. build42: shortened 45s→30s + the timeout is liveness-guarded (forceSettleGuarded
        // never forfeits a player still streaming ticks).
        if (!tour._settleT[i]) tour._settleT[i] = setTimeout(function () { forceSettleGuarded(i); }, 30000);
        trySettlePair(i);
      }
    });
    broadcastSnapshot();
  }
  // build58: turn the between-rounds dead-time into a live race readout — how many duels are resolved + who's still playing.
  function _bracketWaitBanner() {
    if (!tour || !tour.pairs || !tour.pairs.length) return;
    var done = Object.keys(tour.settled || {}).length, total = tour.pairs.length;
    if (done >= total) return;   // round's settling → onTourAwait takes over the banner
    var playing = [];
    tour.pairs.forEach(function (pr, i) { if (tour.settled[i] == null) playing.push(tourName(pr[0]) + ' vs ' + tourName(pr[1])); });
    banner('mpx-tour-msg', 'Run banked — ' + done + ' / ' + total + ' duels resolved · still playing: ' + playing.slice(0, 3).join(' · ') + (playing.length > 3 ? ' …' : ''));
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
    if (tour._settleT['ff' + i]) { clearTimeout(tour._settleT['ff' + i]); delete tour._settleT['ff' + i]; }
    broadcastSnapshot();   // build42: publish the settled pair so clients self-heal + a promoted host can resume
    if (Object.keys(tour.settled).length === tour.pairs.length) hostFinishRound(); else _bracketWaitBanner();   // build58: live "X / Y resolved"
  }
  function hostFinishRound() {
    var winners = tour.pairs.map(function (pr, i) { return tour.settled[i]; }).concat(tour.byes);
    var detail = tour.pairs.map(function (pr, i) {
      var fa = tour.finals[pr[0]] || { score: -1 }, fb = tour.finals[pr[1]] || { score: -1 };
      return { a: pr[0], b: pr[1], as: fa.score, bs: fb.score, win: tour.settled[i] };
    });
    tour.ch.send({ type: 'broadcast', event: 't-result', payload: { n: tour.round, winners: winners, detail: detail, byes: tour.byes } });
    if (winners.length === 1) {
      // FINAL settled → build to the champion: a shared "CHAMPION DECIDED" beat first, THEN the reveal (gives the clip a runway)
      try { tour.ch.send({ type: 'broadcast', event: 't-finalverdict', payload: { id: winners[0] } }); } catch (e) {}
      setTimeout(function () { try { tour.ch.send({ type: 'broadcast', event: 't-champ', payload: { id: winners[0], name: tourName(winners[0]) } }); } catch (e) {} }, 2600);
    } else {
      // host-controlled: stash the next round + put everyone in a "between rounds" state; the host clicks START
      var nextN = tour.round + 1, nextSel = hostResolveSong(nextN);   // build100q #173: next round = next curated song (cycles the pool; empty = random, unchanged)
      tour._next = { n: nextN, winners: winners, sel: nextSel };
      try { tour.ch.send({ type: 'broadcast', event: 't-await', payload: { n: nextN, winners: winners } }); } catch (e) {}
    }
    broadcastSnapshot();   // build42: publish round result + (between-rounds) the stashed next pairings
  }
  function hostStartNextRound() {
    if (!tour.isHost || !tour._next) return;
    var nx = tour._next; tour._next = null; tour.awaiting = false;
    hostBeginRound(nx.n, nx.winners, nx.sel);   // sets atMs = now + VS_LEADIN_MS → the synced 3·2·1 runs
  }
  function onTourAwait(p) {
    if (!p) return;
    tour.awaiting = true;
    tour._awaitWinners = p.winners || null;   // build42: every client stores the next-round winners so a promoted host can rebuild _next
    var survived = (p.winners || []).indexOf(ME.id) >= 0;
    var box = $('mpx-tour-nextwrap');
    if (box) {
      box.hidden = false;
      var btn = $('mpx-tour-next'); if (btn) { btn.hidden = !tour.isHost; btn.classList.toggle('hot', tour.isHost); }   // pulse the host's advance button — the bracket's hot
      var msg = $('mpx-tour-nextmsg');
      if (tour.isHost) {
        // surface the EXACT next matchups (buildPairs is deterministic + order-preserving) so the host advances into a known card
        var np = buildPairs(p.winners || []);
        var prev = np.pairs.map(function (pr) { return tourName(pr[0]) + ' vs ' + tourName(pr[1]); }).join('  ·  ');
        if (np.byes.length) prev += (prev ? '  ·  ' : '') + tourName(np.byes[0]) + ' (bye)';
        if (msg) msg.textContent = (p.winners.length === 2 ? 'THE FINAL is set' : 'Round ' + p.n + ' is set') + (prev ? ' — ' + prev : '') + '. Start when ready.';
      } else if (msg) {
        msg.textContent = survived ? 'You advance! Waiting for the host to start round ' + p.n + '…' : 'Waiting for the host to start the next round…';
      }
    }
    screen.classList.add('active'); activeNow = true; step('tour');
    paintHostPaceControls();   // build61: surface HOLD + the pace note (host-only) alongside START NEXT ROUND
    if (tour.isHost) {
      if (_devAuto) setTimeout(hostStartNextRound, 1600);   // dev solo-run keeps flowing
      // build58: AFK-host failsafe — if the host never taps START NEXT ROUND, auto-advance after 45s so the bracket can't stall on one idle player.
      // build61: a streamer HOLD suppresses this auto-advance entirely (re-armed cleanly on release via paintHostPaceControls).
      else { armAwaitAutoAdvance(); }
    }
  }
  // build61: arm (or skip, while held) the AFK auto-advance. Single place so HOLD/release re-arms identically.
  function armAwaitAutoAdvance() {
    if (_awaitAutoT) { clearTimeout(_awaitAutoT); _awaitAutoT = 0; }
    if (!tour.isHost || !tour.awaiting || tour._hostHold) return;   // held → the bracket waits for the host's GO
    _awaitAutoT = setTimeout(function () {
      if (tour.isHost && tour.awaiting && !tour._hostHold && (tour._next || tour._awaitWinners)) hostStartNextRound();
    }, 45000);
  }

  // ===================== BUILD61: STREAMER HOST-PACING (HOLD + ready indicator) =====================
  // HOLD is host-only: while held it suppresses BOTH auto-advance timers (the 45s AFK + the 25s promoted-host) so a
  // host narrating a bracket live keeps the next round on THEIR cue (START NEXT ROUND). Stored on tour._hostHold so a
  // promoted heir inherits the controls but starts un-held (sensible default — the new host's flow is never stuck).
  function toggleHostHold() {
    if (!tour.isHost) return;                      // no-op for non-hosts (and after migration the heir owns this)
    tour._hostHold = !tour._hostHold;
    if (tour._hostHold) { if (_awaitAutoT) { clearTimeout(_awaitAutoT); _awaitAutoT = 0; } }   // freeze the AFK timer
    else if (tour.awaiting) { armAwaitAutoAdvance(); }   // release → cleanly re-arm the normal AFK failsafe (no dangling timer)
    paintHostPaceControls();
  }
  // paint the HOLD button + pace note + ready indicator. Host-only row; hidden + inert for everyone else and on migration.
  function paintHostPaceControls() {
    var row = $('mpx-tour-pacerow');
    if (row) row.hidden = !(tour.isHost && tour.awaiting);
    var hold = $('mpx-tour-hold');
    if (hold) {
      hold.classList.toggle('on', !!tour._hostHold);
      hold.setAttribute('aria-pressed', tour._hostHold ? 'true' : 'false');
      hold.textContent = tour._hostHold ? '▶ RESUME AUTO' : '⏸ HOLD BRACKET';
    }
    var note = $('mpx-tour-pacenote');
    if (note) note.textContent = tour._hostHold ? 'Held — only YOU start the next round.' : 'Auto-advances if you don\'t start it.';
    paintTourReady();
  }
  // per-round "players loaded / N ready" — reuses tour._alive proof-of-life (a streaming t-tick = loaded & playing).
  // Informational only (never blocks a round start); helps a host HOLD when a slow decode hasn't loaded someone yet.
  function paintTourReady() {
    var el = $('mpx-tour-ready'); if (!el) return;
    // expected = everyone still alive in this round who isn't a bye (byes don't play). Hidden unless a live round is up.
    if (!tour.id || tour.state !== 'live' || !tour.alive || !tour.alive.length || tour.awaiting) { el.hidden = true; return; }
    var expected = tour.alive.filter(function (id) { return (tour.byes || []).indexOf(id) < 0; });
    if (!expected.length) { el.hidden = true; return; }
    var now = Date.now();
    var loaded = expected.filter(function (id) {
      if (tour.finals && tour.finals[id]) return true;                       // already finished = was loaded
      return !!(tour._alive && tour._alive[id] && (now - tour._alive[id] < 6000));   // streaming ticks = loaded
    }).length;
    el.hidden = false;
    el.classList.toggle('allset', loaded >= expected.length);
    var txt = $('mpx-tour-ready-txt');
    if (txt) txt.textContent = loaded + ' / ' + expected.length + ' loaded' + (loaded >= expected.length ? ' ✓' : '');
  }
  // build66 (launch-audit P2): when the host removes a member who already STAKED during open registration, drop them from the
  // authoritative paid roster + bets AND decrement the pot once — else the champion is over-credited and `paidN` can exceed the
  // member count so the everyone-paid START gate passes trivially. The leaver self-refunds on their own client (closeTour →
  // _wagerRefundMine); the host must NOT also broadcast a refund (that would double-credit).
  function _wagerDropMember(id) {
    if (!tour.isHost || !id || tour.stakes === 'free') return;
    if (tour.paid && tour.paid[id]) { delete tour.paid[id]; tour.pot = Math.max(0, (tour.pot || 0) - (tour.buyIn || 0)); }
    if (tour.bets && tour.bets[id]) delete tour.bets[id];
  }
  function hostKick(id) {
    if (!tour.isHost || tour.state !== 'open' || !id || id === ME.id || id === tour.hostId) return;
    if (tour.members[id] && tour.members[id].bot) { delete _devBots[id]; delete tour.members[id]; advertiseTour(); paintTourRoom(); return; }   // dev bot = local only
    try { tour.ch.send({ type: 'broadcast', event: 't-kick', payload: { id: id, by: ME.id } }); } catch (e) {}
    _wagerDropMember(id);   // build66: also drop their stake from the pot/roster (host-authoritative) before removing them
    delete tour.members[id]; advertiseTour(); paintTourRoom(); broadcastSnapshot();   // optimistic; softPresence bye confirms; snapshot replicates the corrected pot/roster
  }
  function onTourKick(p) {
    if (!p || !p.id) return;
    if (p.id === ME.id && !tour.isHost) {
      banner('mpx-tour-msg', 'You were removed from the tournament by the host.');
      setTimeout(function () { if (tour.id) closeTour(); }, 1400);
      return;
    }
    if (tour.members[p.id]) { delete tour.members[p.id]; paintTourRoom(); }
  }

  // ---- uniform result / champion handlers ----
  function onTourResult(p) {
    if (!p) return;
    tour.history.push(p);
    renderTourBoard(p); renderTourBracket();
    screen.classList.add('active'); activeNow = true; step('tour');
    var survived = p.winners.indexOf(ME.id) >= 0;
    // the "who advanced" payoff — a WON/OUT flash for the player (skip the FINAL; its champion sequence is the payoff)
    if (tour.meIn && p.detail && (p.winners || []).length > 1) {
      var mine = p.detail.filter(function (d) { return d.a === ME.id || d.b === ME.id; })[0];
      if (mine && mine.win != null) showTourVerdict(mine.win === ME.id ? 'YOU ADVANCE' : 'ELIMINATED', mine.win === ME.id);
    }
    // build100q (#169): record THIS player's bracket round (ANY round, incl. the FINAL) into the MP ladder so the
    // Leaderboard's MULTIPLAYER tab shows real W/L after a tournament. Previously ONLY the 1v1 path (showWinner) called
    // recordMpResult, so every bracket game wrote nothing → "No matches yet" even after playing. Detail rows carry
    // { a, b, as, bs, win } (built in settlePairs). Humans only — skip bot-fill opponents (matches the 1v1 oppMeta.bot
    // exclusion); per-round guard (tour._recordedRounds[p.n]) so a re-broadcast/snapshot t-result can't double-count.
    try {
      if (tour.meIn && !spectating && p.detail) {
        var myd = p.detail.filter(function (d) { return d.a === ME.id || d.b === ME.id; })[0];
        tour._recordedRounds = tour._recordedRounds || {};
        if (myd && myd.win != null && !tour._recordedRounds[p.n]) {
          var _oppId = (myd.a === ME.id) ? myd.b : myd.a;
          if (!((tour.members[_oppId] || {}).bot)) {
            tour._recordedRounds[p.n] = true;
            var _myS = (myd.a === ME.id) ? (myd.as || 0) : (myd.bs || 0);
            var _opS = (myd.a === ME.id) ? (myd.bs || 0) : (myd.as || 0);
            recordMpResult(myd.win === ME.id ? 'win' : (_myS === _opS ? 'draw' : 'loss'),
              { op: tourName(_oppId), song: (tour.sel && tour.sel.title) || '', my: _myS, ops: _opS });
            try { paintRankChip(); } catch (e) {}
          }
        }
      }
    } catch (e) {}
    if (tour.meIn && !survived) banner('mpx-tour-msg', 'Eliminated in round ' + p.n + '. Stick around — the bracket rolls on.');
    else if (survived && p.winners.length > 1) banner('mpx-tour-msg', 'You advance! Next round starts in a moment…');
    var chip = $('mpx-tour-chip'); if (chip) { chip.setAttribute('data-state', 'live'); chip.textContent = 'ROUND ' + p.n + ' DONE'; }
  }
  // the build-up beat before the champion reveal — a shared "CHAMPION DECIDED" flash (host fires t-finalverdict)
  function onTourFinalVerdict(p) {
    if (!p) return;
    stopTourTick();
    screen.classList.add('active'); activeNow = true; step('tour');
    showTourVerdict('CHAMPION DECIDED', true);
  }
  function onTourChamp(p) {
    if (!p) return;
    tour.state = 'done'; tour.champ = p.id;
    var _wagerWon = (tour.stakes && tour.stakes !== 'free') ? _wagerSettle() : 0;   // build66: WAGER — settle (pool: champ credited; side-bet: every correct picker splits the pot)
    if (tour.isHost) broadcastSnapshot();
    stopTourHeartbeat(); clearPersistedTour();   // build42: bracket over → stop the heartbeat + drop the reconnect pointer
    setSpectating(false);
    if (_botRampT) { clearInterval(_botRampT); _botRampT = 0; }
    stopTourTick(); unmountOppPanel();
    if (_verdictT) { clearTimeout(_verdictT); _verdictT = 0; } stopTourCountdown(); hideTourCd();   // drop the "CHAMPION DECIDED" veil — the reveal takes over
    if (tour.isHost) advertiseTour();
    screen.classList.add('active'); activeNow = true; step('tour');
    var live = $('mpx-tour-live'); if (live) live.hidden = false;
    var box = $('mpx-tour-champ'); if (box) { box.hidden = false; box.classList.toggle('you', p.id === ME.id); box.classList.remove('reveal'); void box.offsetWidth; box.classList.add('reveal'); }   // re-trigger the entrance
    set('mpx-tour-champ-name', p.id === ME.id ? 'YOU' : tourName(p.id));
    // build66: WAGER — surface winnings on the champion card. POOL: the champion won the pot. SIDE-BET: the champion only wins
    // if they backed themselves; OTHER players who backed the winner also win → toast them (they aren't on this card).
    var _csub;
    if (p.id === ME.id) _csub = (_wagerWon > 0) ? ('CHAMPION · WON ' + _wagerWon + ' ◆ BONUS SPARKS') : 'YOU ARE THE BRACKET CHAMPION';
    else if (tour.stakes === 'pool' && tour.pot) _csub = 'BRACKET CHAMPION · WON ' + tour.pot + ' ◆';
    else _csub = 'BRACKET CHAMPION';
    set('mpx-tour-champ-sub', _csub);
    if (tour.stakes === 'sidebet' && p.id !== ME.id && _wagerWon > 0) {
      try { (window.RhythmGame && window.RhythmGame.showToast) ? window.RhythmGame.showToast('🎲 You backed the winner — won ' + _wagerWon + ' ◆ Bonus Sparks!', 'good') : banner('mpx-tour-msg', '🎲 You backed the winner — won ' + _wagerWon + ' ◆ Bonus Sparks!'); } catch (e) {}
    }
    // award-clip backdrop (muted ambient loop) + the champ's banked final
    var clip = $('mpx-tour-champ-clip');
    if (clip) {
      if (!clip.getAttribute('src')) clip.setAttribute('src', 'assets/mp/champion-celebration.mp4');
      try { clip.currentTime = 0; var pp = clip.play(); if (pp && pp.catch) pp.catch(function () {}); } catch (e) {}
    }
    var scEl = $('mpx-tour-champ-score');
    if (scEl) {
      var fin = tour.finals && tour.finals[p.id];
      if (fin && fin.score >= 0) { scEl.hidden = false; scEl.textContent = Number(fin.score).toLocaleString() + ' PTS'; }
      else { scEl.hidden = true; scEl.textContent = ''; }
    }
    var chip = $('mpx-tour-chip'); if (chip) { chip.setAttribute('data-state', 'done'); chip.textContent = 'CHAMPION'; }
    banner('mpx-tour-msg', '');
    if (_awaitAutoT) { clearTimeout(_awaitAutoT); _awaitAutoT = 0; }   // build61: bracket over → drop any AFK timer
    var prow = $('mpx-tour-pacerow'); if (prow) prow.hidden = true;    // build61: hide host-pacing controls at the champion reveal
    var prdy = $('mpx-tour-ready'); if (prdy) prdy.hidden = true;
    renderTourBracket();
    paintTourRoom();
  }

  // ---- tournament UI ----
  function enterTourRoom() {
    step('tour');
    set('mpx-tour-name', (tour.name || 'TOURNAMENT').toUpperCase());
    var chip = $('mpx-tour-chip'); if (chip) { chip.setAttribute('data-state', 'open'); chip.textContent = 'FILLING'; }
    var live = $('mpx-tour-live'); if (live) live.hidden = true;
    var champ = $('mpx-tour-champ'); if (champ) { champ.hidden = true; champ.classList.remove('reveal', 'you'); }
    var champClip = $('mpx-tour-champ-clip'); if (champClip) { try { champClip.pause(); } catch (e) {} }
    stopTourCountdown(); hideTourCd();   // clean any stale cinematic veil on (re-)entry
    var setup = $('mpx-tour-setup'); if (setup) setup.hidden = false;
    var roll = $('mpx-tour-roll'); if (roll) roll.hidden = !tour.isHost;
    var sch = $('mpx-tour-search-toggle'); if (sch) sch.hidden = !tour.isHost;   // build11
    var pk = $('mpx-tour-picker'); if (pk) pk.hidden = true;
    var st = $('mpx-tour-start'); if (st) st.hidden = !tour.isHost;
    var diff = $('mpx-tdiff'); if (diff) [].forEach.call(diff.children, function (b) { b.disabled = !tour.isHost; });
    var devbar = $('mpx-tour-dev'); if (devbar) devbar.hidden = !(MP_DEV && tour.isHost);
    var sizeseg = $('mpx-tour-size');
    if (sizeseg) [].forEach.call(sizeseg.children, function (b) { b.disabled = !tour.isHost; b.classList.toggle('active', +b.getAttribute('data-size') === (tour.size || 8)); });
    var sizerow = $('mpx-tour-sizerow'); if (sizerow) sizerow.hidden = !tour.isHost;
    // build61: round lead-in picker — host-only (entrants honor the host's broadcast atMs); reflect the current TOUR_LEADIN_MS
    var leadrow = $('mpx-tour-leadinrow'); if (leadrow) leadrow.hidden = !tour.isHost;
    var leadseg = $('mpx-tour-leadin');
    if (leadseg) [].forEach.call(leadseg.children, function (b) { b.disabled = !tour.isHost; b.classList.toggle('active', +b.getAttribute('data-lead') === TOUR_LEADIN_MS); });
    // build100q #172: per-tournament COMBAT control — host-only; reflect tour.combat (locks once live, like stakes)
    var combatrow = $('mpx-tour-combatrow'); if (combatrow) combatrow.hidden = !tour.isHost;
    var combatseg = $('mpx-tour-combat');
    if (combatseg) [].forEach.call(combatseg.children, function (b) { b.disabled = !tour.isHost; b.classList.toggle('active', (b.getAttribute('data-combat') === 'on') === !!tour.combat); });
    var stakerow = $('mpx-tour-stakerow'); if (stakerow) stakerow.hidden = !tour.isHost;   // build66: STAKES control is host-only; the pot banner + buy-in confirm are shown to everyone
    paintStakeRow();
    buildTourEnvRow();   // stage POOL chips (host multi-select; guests see the pick)
    buildTourSongRow();  // build100q #173: SONG setlist chips (host adds via SEARCH; rounds rotate; guests see read-only)
    banner('mpx-tour-msg', '');
    paintHostPaceControls();   // build61: reset host-pacing controls on (re-)entry (hidden until a live round/await)
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
        var canKick = tour.isHost && tour.state === 'open' && id !== ME.id && id !== tour.hostId;
        var kx = canKick ? '<button class="ts-kick" type="button" data-kick="' + esc(id) + '" title="Remove player" aria-label="Remove player">✕</button>' : '';
        return '<div class="mpx-tour-seat' + (id === ME.id ? ' me' : '') + (out ? ' out' : '') + '">' + kx + av +
          '<span class="ts-n">' + esc((m.name || 'Player').slice(0, 12)) + '</span></div>';
      });
      var cap = Math.min(TOUR_MAX, Math.max(tour.size || TOUR_MAX, ids.length));
      for (var k = ids.length; k < cap; k++) html.push('<div class="mpx-tour-seat empty"><span class="ts-av">·</span><span class="ts-n">open</span></div>');
      grid.innerHTML = html.join('');
      [].forEach.call(grid.querySelectorAll('.ts-kick'), function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); hostKick(b.getAttribute('data-kick')); }); });
    }
    var t = $('mpx-tour-t'), a = $('mpx-tour-a'), art = $('mpx-tour-art');
    if (t) t.textContent = tour.sel ? tour.sel.title : 'Rolling a track…';
    if (a) a.textContent = (tour.sel ? (tour.sel.artist || '—') : '—') + (tour.envName ? '  ·  stage: ' + tour.envName : '');
    if (art) {
      if (tour.sel && tour.sel.art) { art.style.backgroundImage = 'url("' + safeUrl(tour.sel.art) + '")'; art.textContent = ''; }
      else { art.style.backgroundImage = ''; art.textContent = '♪'; }
    }
    var n = Object.keys(tour.members).length;
    // build66: WAGER — gate START until every entrant has paid the buy-in; show the live pot to everyone.
    var staked = tour.stakes && tour.stakes !== 'free';
    var paidN = Object.keys(tour.paid || {}).length;
    var allPaid = !staked || paidN >= n;
    var st = $('mpx-tour-start');
    if (st && tour.isHost) {
      var ok = tour.state === 'open' && n >= TOUR_MIN && !!tour.sel && allPaid;
      st.disabled = !ok;
      st.textContent = 'START BRACKET (' + n + '/' + (tour.size || TOUR_MAX) + ')';
    }
    var msg = $('mpx-tour-state');
    if (msg) {
      if (tour.state !== 'open') msg.textContent = '';
      else if (n < TOUR_MIN) msg.textContent = 'Need ' + (TOUR_MIN - n) + ' more to start — best with 5–10. Share the lobby!';
      else if (staked && !allPaid) msg.textContent = 'Waiting on buy-ins — ' + paidN + '/' + n + ' paid in…';
      else msg.textContent = tour.isHost ? (n + ' in. Start when the table feels full (5–10 is the sweet spot).') : 'Waiting for the host to start the bracket…';
    }
    var potEl = $('mpx-tour-pot');
    if (potEl) {
      if (!staked) potEl.hidden = true;
      else { potEl.hidden = false; var picon = tour.stakes === 'sidebet' ? '🎲' : '💰';
        potEl.innerHTML = picon + ' POT <b>' + (tour.pot || 0) + ' &#9670;</b> &nbsp;·&nbsp; ' + (tour.buyIn || 0) + ' &#9670; ' + (tour.stakes === 'sidebet' ? 'bet' : 'buy-in') + ' &nbsp;·&nbsp; ' + paidN + '/' + n + ' in'; }
    }
    // build66: side-bet — every entrant (host included) places ONE bet via the picker before round 1; show the prompt until they have.
    var betBtn = $('mpx-tour-bet');
    if (betBtn) {
      var showBet = (tour.stakes === 'sidebet') && tour.state === 'open' && !_betPlaced();
      betBtn.hidden = !showBet;
      if (showBet) betBtn.textContent = '🎲 PLACE YOUR BET — ' + (tour.buyIn || 0) + ' ◆';
    }
    try { paintStakeRow(); } catch (e) {}
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
  // mark the bracket board as a LIVE spectator view (eliminated / bye / not-in-pair) — a "● LIVE" badge + the
  // duel rows animating from t-tick let an out-of-it player watch the race instead of seeing an instant result.
  function setSpectating(on) {
    var lv = $('mpx-tour-live'); if (lv) lv.classList.toggle('mpx-watching', !!on);
    if (on) {
      _specFocus = null;
      // build96 (playtest): mount the live opponent deck for a tournament spectator — the SAME tested panel room
      // spectators use — + a WATCH NEXT switcher, so eliminated/BYE players WATCH a real match, not just a scoreboard.
      try { mountOppPanel(); var pnl = $('mp-opp'); if (pnl) { pnl.classList.add('spectate'); _ensureSpecControls(pnl); } } catch (e) {}
    } else { var pnl2 = $('mp-opp'); if (pnl2) pnl2.classList.remove('spectate'); }
  }
  // ---- build96: tournament spectator focus ("watch one of the matches") ----
  function _specCandidates() { return (tour.alive || []).filter(function (id) { return id && id !== ME.id; }); }   // everyone still alive in the bracket except me
  function _paintSpecLabel() {
    var el = $('mpx-spec-name'); if (!el) return;
    var m = _specFocus ? tourSeat(_specFocus) : null;
    el.textContent = m ? ('WATCHING ' + (m.name || 'Player').slice(0, 14)) : 'PICK A MATCH';
  }
  function _specNext() {
    var c = _specCandidates(); if (!c.length) return;
    var i = _specFocus ? c.indexOf(_specFocus) : -1;
    _specFocus = c[(i + 1) % c.length];
    lastOppState = null; lastOppTick = null;   // clear so the newly-focused player's stream repopulates the deck cleanly
    _paintSpecLabel();
  }
  function _ensureSpecControls(panel) {
    if (!panel || panel.querySelector('.mo-spec')) return;
    var bar = document.createElement('div'); bar.className = 'mo-spec';
    bar.innerHTML = '<span class="mo-spec-eye">👁</span><span id="mpx-spec-name">SPECTATING</span><button type="button" id="mpx-spec-next" class="mo-spec-next">WATCH NEXT ▶</button>';
    panel.insertBefore(bar, panel.firstChild);
    var nx = bar.querySelector('#mpx-spec-next'); if (nx) nx.onclick = _specNext;
    _paintSpecLabel();
  }
  function updateBoardScore(id, score, isFinal) {
    var el = screen.querySelector('[data-sc="' + id + '"]');
    if (!el) return;
    el.textContent = (score < 0 ? 'FORFEIT' : Number(score || 0).toLocaleString()) + (isFinal ? ' ✓' : '');
    // live LEAD highlight — in this duel, mark the higher score so a spectator can read the race at a glance
    var duel = el.parentNode; while (duel && !(duel.className && duel.className.indexOf('mpx-tour-duel') >= 0)) duel = duel.parentNode;
    if (duel) {
      var ss = duel.querySelectorAll('.td-s');
      if (ss.length === 2) {
        var n0 = parseInt((ss[0].textContent || '').replace(/[^0-9]/g, '') || '0', 10);
        var n1 = parseInt((ss[1].textContent || '').replace(/[^0-9]/g, '') || '0', 10);
        ss[0].classList.toggle('lead', n0 > n1); ss[1].classList.toggle('lead', n1 > n0);
      }
    }
  }
  // a single avatar chip for the climbing bracket
  function brkAvatar(id, o) {
    o = o || {};
    var m = tourSeat(id);
    var faceStyle = '', faceTxt = '';
    if (m.avatar) faceStyle = ' style="background-image:url(&quot;' + esc(safeUrl(m.avatar)) + '&quot;)"';
    else faceTxt = esc(initial(m.name));
    var cls = 'brk-av';
    if (o.throne) cls += ' throne';
    if (id === ME.id) cls += ' me';
    if (o.adv) cls += ' adv';
    if (o.out) cls += ' out';
    if (o.live) cls += ' live';
    if (o.fresh) cls += ' fresh';
    return '<div class="' + cls + '" data-bid="' + esc(id) + '">' +
      '<span class="ba-face"' + faceStyle + '>' + faceTxt + (o.crown ? '<span class="ba-crown">♛</span>' : '') + '</span>' +
      '<span class="ba-n">' + esc((m.name || 'Player').slice(0, 9)) + '</span></div>';
  }
  // the climbing bracket — avatars rise round-by-round to the throne, painted over bracket-arena.png
  function renderTourBracket() {
    var box = $('mpx-tour-bracket'); if (!box) return;
    // round-1 field
    var entrants = [];
    if (tour.history[0]) {
      tour.history[0].detail.forEach(function (d) { entrants.push(d.a); entrants.push(d.b); });
      (tour.history[0].byes || []).forEach(function (id) { entrants.push(id); });
    } else if (tour.pairs.length || tour.byes.length) {
      tour.pairs.forEach(function (pr) { entrants.push(pr[0]); entrants.push(pr[1]); });
      (tour.byes || []).forEach(function (id) { entrants.push(id); });
    } else { entrants = Object.keys(tour.members); }
    // winner tiers (resolved rounds with >1 survivor), most-advanced first
    var winnerTiers = tour.history.filter(function (h) { return (h.winners || []).length > 1; })
      .map(function (h) { return { n: h.n, ids: h.winners }; })
      .sort(function (a, b) { return b.n - a.n; });
    // lone survivor → champion (live or resolved)
    var champId = tour.champ || (function () { var f = tour.history.filter(function (h) { return (h.winners || []).length === 1; })[0]; return f ? f.winners[0] : null; })();
    // who's still in it (dim the eliminated)
    var alive = {}; if (tour.state === 'live') (tour.alive || []).forEach(function (id) { alive[id] = 1; });
    else if (champId) alive[champId] = 1;
    var aliveKnown = Object.keys(alive).length && tour.state !== 'open';
    function isOut(id) { return aliveKnown ? !alive[id] : false; }
    // current contenders (this round's active duels) → live pulse
    var inDuel = {}; tour.pairs.forEach(function (pr) { inDuel[pr[0]] = 1; inDuel[pr[1]] = 1; });
    var liveR1 = tour.state === 'live' && tour.round === 1;

    var rows = [];
    rows.push('<div class="brk-tier"><div class="bt-lbl">CHAMPION</div>' +
      (champId ? brkAvatar(champId, { throne: true, crown: true, adv: true, fresh: !!tour.champ })
               : '<div class="brk-av throne empty"><span class="ba-face">?</span><span class="ba-n">—</span></div>') +
      '</div>');
    winnerTiers.forEach(function (t, i) {
      var lbl = t.ids.length === 2 ? 'FINALISTS' : ('ROUND ' + t.n + ' WINNERS');
      rows.push('<div class="brk-tier"><div class="bt-lbl">' + lbl + '</div>' +
        t.ids.map(function (id) { return brkAvatar(id, { adv: true, crown: id === tour.hostId, out: isOut(id), live: !liveR1 && i === 0 && tour.state === 'live' && inDuel[id] }); }).join('') + '</div>');
    });
    rows.push('<div class="brk-tier"><div class="bt-lbl">THE FIELD · ' + entrants.length + '</div>' +
      entrants.map(function (id) { return brkAvatar(id, { crown: id === tour.hostId, out: isOut(id), live: liveR1 && inDuel[id] }); }).join('') + '</div>');

    box.innerHTML = '<div class="brk-bg"></div><div class="brk-scrim"></div><div class="brk-tiers">' + rows.join('') + '</div>';
    // who-vs-who connector lines: map each DOM tier → the round whose WINNERS populate it, then draw
    // gold (advanced) / dim-chrome (defeated) curves from each round's feeders up to the winner above.
    var roundForTier = [];
    var champRound = (function () { var f = tour.history.filter(function (h) { return (h.winners || []).length === 1; })[0]; return f ? f.n : null; })();
    roundForTier[0] = champRound;
    winnerTiers.forEach(function (t, i) { roundForTier[1 + i] = t.n; });
    drawBracketLines(box, roundForTier);
  }
  function drawBracketLines(box, roundForTier) {
    var tiers = box.querySelectorAll('.brk-tier');
    if (tiers.length < 2 || !tour.history.length) return;
    var brect = box.getBoundingClientRect(); if (!brect.width) return;   // hidden / unlaid-out → skip
    function center(el) { var f = el.querySelector('.ba-face') || el, r = f.getBoundingClientRect(); return { x: r.left - brect.left + r.width / 2, top: r.top - brect.top, bot: r.bottom - brect.top }; }
    function findIn(tierEl, id) { var nodes = tierEl.querySelectorAll('.brk-av[data-bid]'); for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute('data-bid') === id) return nodes[i]; return null; }
    var d = '';
    for (var T = 0; T < tiers.length - 1; T++) {
      var rn = roundForTier[T]; if (rn == null) continue;
      var h = null; for (var hi = 0; hi < tour.history.length; hi++) if (tour.history[hi].n === rn) h = tour.history[hi];
      if (!h || !h.detail) continue;
      var upper = tiers[T], lower = tiers[T + 1];
      for (var di = 0; di < h.detail.length; di++) {
        var duel = h.detail[di], winEl = findIn(upper, duel.win); if (!winEl) continue;
        var wc = center(winEl), feeders = [duel.a, duel.b];
        for (var fj = 0; fj < feeders.length; fj++) {
          var fEl = findIn(lower, feeders[fj]); if (!fEl) continue;
          var fc = center(fEl), ymid = (wc.bot + fc.top) / 2, won = feeders[fj] === duel.win;
          d += '<path d="M' + fc.x.toFixed(1) + ' ' + fc.top.toFixed(1) + ' C' + fc.x.toFixed(1) + ' ' + ymid.toFixed(1) + ' ' + wc.x.toFixed(1) + ' ' + ymid.toFixed(1) + ' ' + wc.x.toFixed(1) + ' ' + wc.bot.toFixed(1) + '" stroke="' + (won ? '#e0a93f' : 'rgba(218,215,210,0.22)') + '"/>';
        }
      }
    }
    if (!d) return;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'brk-lines');
    svg.innerHTML = d;
    box.appendChild(svg);
  }

  // ============ DEV NPC HARNESS — fill a bracket solo + auto-run for stress testing ============
  function mergeBots() { for (var k in _devBots) tour.members[k] = _devBots[k]; }
  function devAddBots(n) {
    if (!tour.id) { try { console.warn('[mpDev] open a tournament first (Multiplayer → Create Tournament).'); } catch (e) {} return 0; }
    n = Math.max(1, n | 0);
    var room = TOUR_MAX - Object.keys(tour.members).length;
    n = Math.min(n, Math.max(0, room));
    for (var i = 0; i < n; i++) {
      var id = 'bot_' + (++_devN) + Math.random().toString(36).slice(2, 5);
      _devBots[id] = { id: id, name: BOT_NAMES[(_devN - 1) % BOT_NAMES.length], avatar: null, bot: true };
    }
    mergeBots();
    if (tour.isHost) advertiseTour();
    paintTourRoom();
    return Object.keys(_devBots).length;
  }
  function devClearBots() { _devBots = {}; if (tour.id) { Object.keys(tour.members).forEach(function (k) { if (k.indexOf('bot_') === 0) delete tour.members[k]; }); paintTourRoom(); } return 0; }
  function devSetAuto(v) { _devAuto = (v !== false); return _devAuto; }
  function devSetSpectate(v) { _devSpectate = (v !== false); _devAuto = _devSpectate; return _devSpectate; }   // AUTO-RUN on = spectate+auto-advance; off = manual play + manual "START NEXT ROUND" (bots still bank, so rounds complete)
  var _devBotDiff = 'medium';   // NPC difficulty: scales their score + ghost pace so solo testing is meaningful
  function devSetBotDiff(d) { _devBotDiff = (d === 'easy' || d === 'hard') ? d : 'medium'; return _devBotDiff; }
  function _botRange() { return _devBotDiff === 'easy' ? [110000, 360000] : _devBotDiff === 'hard' ? [620000, 1150000] : [320000, 680000]; }
  function _botPace() { return _devBotDiff === 'easy' ? 430 : _devBotDiff === 'hard' ? 1050 : 720; }   // ghost score / sec
  function devBotScore() { var r = _botRange(); return r[0] + Math.floor(Math.random() * (r[1] - r[0])); }
  // host-only: drive every bot in this round's pairs (+ ME when spectating) so their scores RAMP UP over the round
  // and stream t-tick — a spectator (eliminated / all-NPC) watches a real race climb on the board, not an instant jump.
  function devDriveBots(p) {
    if (!tour.isHost) return;
    if (_botRampT) { clearInterval(_botRampT); _botRampT = 0; }
    var actors = [];
    tour.pairs.forEach(function (pr) {
      pr.forEach(function (id) {
        if (!_devBots[id]) return;
        // the human's RIVAL bot banks at the human's SONG-END (onTourSongEnd) — never here — so the human's pair
        // can't settle mid-song. Only skip while the human is actually PLAYING this round (not spectating).
        if (id === tour.rival && tour.meIn && !_devSpectate) return;
        actors.push({ id: id, target: devBotScore(), done: false });
      });
    });
    // ME's synthetic run when spectating/auto (so the human's pair settles too) — ramps alongside the bots
    var meActor = (_devSpectate && tour.meIn) ? { id: ME.id, target: devBotScore(), done: false, me: true } : null;
    if (meActor) actors.push(meActor);
    if (!actors.length) return;
    var dur = 18000 + Math.random() * 8000;   // ~18–26s: watchable race, not an instant resolve
    var t0 = performance.now();
    _botRampT = setInterval(function () {
      if (!tour.id || tour.round !== p.n) { clearInterval(_botRampT); _botRampT = 0; return; }
      var k = Math.min(1, (performance.now() - t0) / dur), ease = k * k * (3 - 2 * k);   // smoothstep
      actors.forEach(function (a) {
        if (a.done) return;
        var sc = Math.round(a.target * ease * (0.92 + Math.random() * 0.05));
        if (k >= 1) {
          a.done = true;
          if (a.me) { try { tour.ch.send({ type: 'broadcast', event: 't-final', payload: { id: ME.id, score: a.target, acc: 88, combo: 160, grade: 'A' } }); } catch (e) {} }
          else if (!tour.finals[a.id]) onTourFinal({ id: a.id, score: a.target, acc: Math.round((78 + Math.random() * 20) * 10) / 10, combo: 40 + Math.floor(Math.random() * 320), grade: 'A' });
        } else {
          updateBoardScore(a.id, sc);
          try { tour.ch.send({ type: 'broadcast', event: 't-tick', payload: { id: a.id, score: sc, combo: Math.round(sc / 2400), prog: k } }); } catch (e) {}
        }
      });
      if (actors.every(function (a) { return a.done; })) { clearInterval(_botRampT); _botRampT = 0; }
    }, 850);
  }
  function devStatus() { return { dev: MP_DEV, bots: Object.keys(_devBots).length, auto: _devAuto, spectate: _devSpectate, tour: tour.id, members: Object.keys(tour.members).length, state: tour.state }; }
  // offline stub channel — broadcasts loop straight back to our own handlers (self:true, no network/auth)
  function fakeTourChannel() {
    var H = {};
    return {
      on: function (t, o, cb) { if (t === 'broadcast' && o && o.event) { (H[o.event] = H[o.event] || []).push(cb); } return this; },
      send: function (m) { if (m && m.type === 'broadcast' && H[m.event]) { var hs = H[m.event].slice(); setTimeout(function () { hs.forEach(function (cb) { try { cb({ payload: m.payload }); } catch (e) {} }); }, 0); } return Promise.resolve('ok'); },
      subscribe: function (cb) { if (cb) setTimeout(function () { cb('SUBSCRIBED'); }, 0); return this; },
      track: function () { return Promise.resolve('ok'); }, untrack: function () { return Promise.resolve('ok'); }
    };
  }
  // spin up a fully offline solo bracket (no sign-in needed) — fills with NPCs, hands-free auto-run
  function devSoloTour(n) {
    try { if (tour.id) closeTour(true); } catch (e) {}
    tour = nullTour();
    tour.id = 'dev' + (++_devN); tour.name = 'NPC Test Bracket'; tour.isHost = true; tour.hostId = ME.id; tour._joinAt = Date.now();
    tour.ch = fakeTourChannel();
    tour.ch.on('broadcast', { event: 't-snapshot' }, function (m) { applyTourSnapshot(m.payload); });   // build42: loopback (host ignores its own)
    tour.ch.on('broadcast', { event: 't-track' }, function (m) { onTourTrack(m.payload); });
    tour.ch.on('broadcast', { event: 't-round' }, function (m) { onTourRound(m.payload); });
    tour.ch.on('broadcast', { event: 't-tick' }, function (m) { onTourTick(m.payload); });
    tour.ch.on('broadcast', { event: 't-state' }, function (m) { onTourState(m.payload); });
    tour.ch.on('broadcast', { event: 't-shock' }, function (m) { onTourShock(m.payload); });   // build100q #172: combat shock over the tour channel
    tour.ch.on('broadcast', { event: 't-final' }, function (m) { onTourFinal(m.payload); });
    tour.ch.on('broadcast', { event: 't-result' }, function (m) { onTourResult(m.payload); });
    tour.ch.on('broadcast', { event: 't-finalverdict' }, function (m) { onTourFinalVerdict(m.payload); });
    tour.ch.on('broadcast', { event: 't-champ' }, function (m) { onTourChamp(m.payload); });
    tour.ch.on('broadcast', { event: 't-await' }, function (m) { onTourAwait(m.payload); });
    tour.ch.on('broadcast', { event: 't-kick' }, function (m) { onTourKick(m.payload); });
    tour.members[ME.id] = { id: ME.id, name: ME.name || 'You', avatar: ME.avatar };
    tour.sel = hostNextTrack() || { trackId: 'demo', title: 'Demo Track', artist: 'ReactivVibe', difficulty: 'medium', demo: true };
    _devBots = {};   // fresh field each solo run (don't accumulate across calls)
    _devAuto = true; _devSpectate = true;   // hands-free: bots AND your own duels auto-resolve
    devAddBots(n || 7);
    try { screen.classList.add('active'); activeNow = true; } catch (e) {}
    enterTourRoom(); paintTourRoom();
    return tour.id;
  }
  // a real OFFLINE 1v1 vs a local bot (no 2nd client, no auth) — mounts the split-screen via beginMatch,
  // drives the opponent deck off your own progress, and settles a real WIN/LOSE at song end.
  function devVsNpc(o) {
    o = o || {};
    try { teardownMatch(); } catch (e) {}
    matchId = 'npc' + (++_devN); matchRole = 'host';
    matchCombat = false;   // build69: CPU/Practice is no-remote + combat-inert (bot guards) — set explicitly so it never inherits a stale prior human-match value
    oppMeta = { id: 'npc', name: o.name || 'NIGHT-OWL (CPU)', avatar: null, bot: true };
    matchCh = fakeTourChannel();                 // inert: matchCh.send guards pass; self-broadcasts drop (no handlers)
    sel = o.sel || hostNextTrack() || { trackId: 'demo', title: 'Demo Track', artist: 'ReactivVibe', difficulty: (sel && sel.difficulty) || 'medium', demo: true };
    setLobbyInMatch(true);
    var atMs = Date.now() + VS_LEADIN_MS;
    beginMatch(atMs, sel);                        // mounts vs-mode + HUD + 3·2·1 + startTick (desktop), launches the song
    // synthesize the NPC's final at YOUR song end → a real verdict (additive onSongEnd; onLocalSongEnd already registered)
    window.RhythmGame.onSongEnd(function () {
      var os = lastOppState || {};
      oppFinal = oppFinal || { name: oppMeta.name, score: os.sc || 0, combo: os.cb || 0, acc: 90, grade: 'A' };
      settleIfReady();
    });
    // DRIVE the ghost: the NPC "plays" by tracking your run at ~skill, with occasional hit/miss sparkles
    var skill = (o.skill != null) ? o.skill : 0.92, t0 = performance.now();
    _npcLastEv = 0;
    if (_npcRaf) cancelAnimationFrame(_npcRaf);
    (function ghost() {
      if (!matchLive) { _npcRaf = 0; return; }
      var stt = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;
      var el = (performance.now() - t0) / 1000, ev = [];
      if (el - _npcLastEv > 0.14) { _npcLastEv = el; ev.push({ l: Math.floor(Math.random() * 5), j: Math.random() < 0.85 ? 'g' : 'm' }); }
      lastOppState = { sc: Math.round((stt ? stt.score : 0) * skill + el * 600), cb: stt ? Math.round(stt.combo * skill) : 0,
        mu: 1, od: Math.min(1, el / 16), oda: (el % 20) > 16, st: 1, pr: stt ? stt.progress : Math.min(1, el / 120), ev: ev };
      lastOppTick = { score: lastOppState.sc, combo: lastOppState.cb, prog: lastOppState.pr, name: oppMeta.name };
      _npcRaf = requestAnimationFrame(ghost);
    })();
    return 'NPC 1v1: ' + sel.title;
  }

  // ---- tournament directory (lobby cards) ----
  function onTourMeta(p) {
    if (!p || !p.tid) return;
    if (p.hostId === ME.id) return;
    toursDir[p.tid] = p; toursDir[p.tid].at = Date.now();
    // build11: invite deep-link target found → join it
    if (_pendingTourJoin && p.tid === _pendingTourJoin && !tour.id) { _pendingTourJoin = null; joinTour(p.tid); }
    // late meta for a direct-joined bracket → learn the real name/host
    if (tour.id === p.tid && !tour.isHost) { tour.name = p.name || tour.name; tour.hostId = p.hostId || tour.hostId; if (p.size) tour.size = p.size; paintTourRoom(); var nm = $('mpx-tour-name'); if (nm) nm.textContent = (tour.name || 'TOURNAMENT').toUpperCase(); }
    renderRooms(); updateBrowseCount();
  }
  function joinTourDirect(tid) {   // build11: join by id only (invite link; no directory meta yet)
    if (!supa || !lobbyCh || tour.id) return;
    tour = nullTour(); tour.id = tid; tour.name = 'BRACKET'; tour.isHost = false; tour.hostId = null;
    joinTourChannel(tid);
    reannounce(); enterTourRoom();
    banner('mpx-tour-msg', 'Joined via invite — waiting for the bracket…');
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
    if (RC && RC.trackReady) all = all.filter(function (t) { return RC.trackReady(t) && !(RC.isVideo && RC.isVideo(t)); });
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
        try { delete sel.audioUrl; } catch (e) {}   // review fix 1: picking a NEW track invalidates any show/review audio riding the old sel (it would play the wrong song)
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

  // ---- build60: "Play with friends ▸" disclosure (demotes Open / Browse / Tournament under one tap) ----
  function toggleFriends(force) {
    var tg = $('mpx-friends-toggle'), panel = $('mpx-friends-panel'); if (!tg || !panel) return;
    var open = (force != null) ? !!force : panel.hidden;
    panel.hidden = !open; tg.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  wire('mpx-friends-toggle', 'click', function () { toggleFriends(); });

  // ---- build60: first-run coach card (one-time; re-openable via the header "?") ----
  function mpSeen() { try { return localStorage.getItem('rr_mp_seen') === '1'; } catch (e) { return false; } }
  function showCoach() { var c = $('mpx-coach'); if (c) c.hidden = false; }
  function dismissCoach() { var c = $('mpx-coach'); if (c) c.hidden = true; try { localStorage.setItem('rr_mp_seen', '1'); } catch (e) {} }
  wire('mpx-coach-go', 'click', dismissCoach);
  wire('mpx-help', 'click', showCoach);

  // ---- build60: gentle up-front sign-in note (shown on lobby entry only when signed-out actions would fail) ----
  function refreshSigninNote() {
    var note = $('mpx-signin-note'); if (!note) return;
    // Only nudge when there's a live connection but no identity — i.e. actions would bounce with a "sign in" banner.
    // The dev-open path still works without sign-in (guest), so keep it informational, never blocking.
    var show = !!supa && !ME.signedIn;
    note.hidden = !show;
  }
  wire('mpx-signin-btn', 'click', function () {
    // Route to the existing rr-id sign-in control (lives outside the MP screen); fall back to a friendly nudge.
    var done = false;
    try { var rid = document.getElementById('rr-id'); if (rid) { rid.click(); done = true; } } catch (e) {}
    if (!done) { try { if (window.RhythmCatalog && window.RhythmCatalog.signIn) { window.RhythmCatalog.signIn(); done = true; } } catch (e) {} }
    if (!done) banner('mpx-lobby-msg', 'Open the account menu (top bar) to sign in — or just hit PLAY NOW to practice vs CPU as a guest.');
  });

  // build8: lobby action bar
  wire('mpx-act-quick', 'click', toggleQuickMatch);
  wire('mpx-combat-toggle', 'click', toggleCombat);   // v254: P-vs-P / P-vs-E combat toggle (now lives in the "More" drawer)
  wire('mpx-act-open', 'click', function () { gotoRooms('create'); });   // legacy id (harmless no-op if absent)
  // build99h: TIER-2 "Play a friend" → same open-a-room flow as the old #mpx-act-open
  wire('mpx-act-friend', 'click', function () { gotoRooms('create'); });
  // build99h: TIER-2 "Local versus" → hand off to the parallel couch-coop engine (RhythmCouch)
  wire('mpx-act-local', 'click', function () { try { if (window.RhythmCouch && window.RhythmCouch.open) window.RhythmCouch.open(); } catch (e) {} });
  wire('mpx-act-browse', 'click', function () { gotoRooms('browse'); });
  // build61: LIVE NOW empty-state CTA → straight into the host-a-tournament form (also un-collapses friends so the path is visible)
  wire('mpx-livenow-host', 'click', function () { try { toggleFriends(true); } catch (e) {} gotoRooms('tour-create'); });
  // build8: rooms step
  wire('mpx-rooms-refresh', 'click', function () { try { if (lobbyCh) lobbyCh.send({ type: 'broadcast', event: 'room-ping', payload: { from: ME.id } }); } catch (e) {} renderRooms(); });
  wire('mpx-rooms-back', 'click', function () { step('lobby'); onLobbySync(); });
  wire('mpx-room-create-go', 'click', function () {
    var cr = $('mpx-rooms-create');
    if (cr && cr.getAttribute('data-mode') === 'tour') openTour(); else openRoom();   // build9
  });
  wire('mpx-room-create-cancel', 'click', function () { step('lobby'); onLobbySync(); });
  wire('mpx-room-priv', 'click', function (e) { var b = e.target.closest('button'); if (!b) return; [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); }); });
  wire('mpx-room-combat', 'click', function (e) { var b = e.target.closest('button'); if (!b) return; [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); }); });   // build69: segmented combat select for the room (read at openRoom into room.combat)
  // build8: room context (inside setup) — host closes / guest leaves
  wire('mpx-room-close', 'click', function () { if (room.isHost) closeRoom(); else { var _wasShow = !!room.show; leaveRoomChannel(); room = { id: null, name: null, priv: false, combat: false, isHost: false, ch: null, seat: null, members: {}, p1: null, p2: null }; spectating = false; if (_wasShow) { try { delete sel.audioUrl; } catch (e) {} } reannounce(); backToLobby(); } });   // review fix 1/5: a guest leaving a SHOW drops the review audio; the stale back-label restores at the next enterSetup
  // build60: invite a friend to a basic room (share link + short room code — reuses the tournament copy-link pattern)
  wire('mpx-invite-friend', 'click', function () {
    if (!room.id) return;
    var code = roomCode(room.id), link = roomInviteLink(room.id);
    var share = 'Join my Reactive Rhythm room — code ' + code + ': ' + link;
    var btn = $('mpx-invite-friend');
    function flash(ok) { if (!btn) return; btn.classList.toggle('copied', ok); btn.textContent = ok ? '✓ COPIED — SEND IT' : '👤 VS PLAYER — INVITE'; if (ok) setTimeout(function () { btn.classList.remove('copied'); btn.textContent = '👤 VS PLAYER — INVITE'; }, 2600); }
    try { navigator.clipboard.writeText(share).then(function () { flash(true); }, function () { window.prompt('Copy this — send it to a friend:', share); }); }
    catch (e) { window.prompt('Copy this — send it to a friend:', share); }
  });
  // build60: a solo host is never stuck — drop a CPU opponent into the duel and start a real split-screen match.
  wire('mpx-add-cpu', 'click', function () {
    if (!room.isHost) return;
    var carry = (sel && sel.trackId) ? Object.assign({}, sel) : null;
    try { closeRoom(true); } catch (e) {}        // tear down the empty room channel cleanly
    step('setup');
    try { devVsNpc(carry ? { sel: carry } : {}); } catch (e) { banner('mpx-lobby-msg', 'Could not start a CPU duel — try PLAY NOW.'); }
  });
  wire('mpx-leave-win', 'click', leaveAll);
  wire('mpx-backlobby', 'click', backToLobby);
  // build102s: live-show room controls (elements only ever visible while room.show)
  wire('mpx-show-invite', 'click', function (ev) { if (ev && ev.isTrusted === false) return; callInArtist(false); });
  wire('mpx-show-nudge', 'click', function (ev) { if (ev && ev.isTrusted === false) return; callInArtist(true); });
  wire('mpx-show-accept', 'click', acceptChallenger);
  wire('mpx-show-decline', 'click', declineChallenger);
  wire('mpx-rematch', 'click', function () { if (matchCh) matchCh.send({ type: 'broadcast', event: 'rematch', payload: {} }); resetForRematch(); });
  wire('mpx-ready', 'click', toggleReady);
  wire('mpx-diff', 'click', function (e) {
    var b = e.target.closest('button'); if (!b || !amPicker()) return;
    sel.difficulty = b.getAttribute('data-diff');
    [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
    broadcastSong();
  });
  wire('mpx-pick', 'click', function () {
    if (!amPicker()) return;
    var p = $('mpx-picker'); if (!p) return;
    p.hidden = !p.hidden; if (!p.hidden) { renderPicker(''); var s = $('mpx-search'); if (s) s.focus(); }
  });
  wire('mpx-search', 'input', function () { renderPicker(this.value); });
  // build9: tournament controls
  wire('mpx-act-tour', 'click', function () { gotoRooms('tour-create'); });
  // build60: "Practice vs CPU" is now a FIRST-CLASS lobby action (no longer a hidden dev-only reveal) — a lone first-timer
  // always has a real, instantly-playable split-screen match. The MP screen only opens when MP is reachable (the public
  // gate lives in index.html toMultiplayer); inside it, everyone who's here gets the CPU on-ramp.
  wire('mpx-act-npc', 'click', function () { banner('mpx-lobby-msg', ''); devVsNpc({}); });
  wire('mpx-tour-roll', 'click', rollTrack);
  wire('mpx-tour-start', 'click', startTour);
  wire('mpx-tour-next', 'click', hostStartNextRound);   // host: manual round advance
  wire('mpx-tour-hold', 'click', toggleHostHold);       // build61: streamer HOLD — suppress both auto-advance timers until GO
  wire('mpx-tour-leave', 'click', leaveTourBtn);
  wire('mpx-tour-size', 'click', function (e) {
    var b = e.target.closest('button[data-size]'); if (!b || !tour.isHost || tour.state !== 'open') return;
    tour.size = +b.getAttribute('data-size') || 8;
    [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
    broadcastTourTrack(); paintTourRoom();
  });
  // build61: host-selectable round LEAD-IN (the 3·2·1·GO cinematic length). Local to the host's clock — used by
  // hostBeginRound's atMs; entrants just honor whatever atMs the host broadcasts, so no sync change. Default 5200 (unchanged).
  wire('mpx-tour-leadin', 'click', function (e) {
    var b = e.target.closest('button[data-lead]'); if (!b || !tour.isHost) return;
    TOUR_LEADIN_MS = +b.getAttribute('data-lead') || 10000;   // build100t: default ~10s
    [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
  });
  // build100q #172: host sets per-tournament COMBAT (locks once live, like stakes). Rides the t-snapshot to entrants.
  wire('mpx-tour-combat', 'click', function (e) {
    var b = e.target.closest('button[data-combat]'); if (!b || !tour.isHost || tour.state !== 'open') return;
    tour.combat = b.getAttribute('data-combat') === 'on';
    [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
    broadcastSnapshot();
  });
  // build66: WAGER — host sets the bracket STAKES (free | prize pool | side-bet) + the buy-in. BONUS SPARKS ONLY
  // (cashable Sparks gated off behind RhythmWager WAGER_SERVER_MODE='local'). Stakes/buyIn/pot/paid ride the t-snapshot to entrants.
  var DEFAULT_BUYIN = 50;   // build100q: single source for the default staked buy-in (was an inline `|| 50` in two spots that diverged from tour.buyIn)
  function paintStakeRow() {
    var seg = $('mpx-tour-stakes');
    if (seg) [].forEach.call(seg.children, function (b) { b.classList.toggle('active', b.getAttribute('data-stakes') === (tour.stakes || 'free')); b.disabled = !tour.isHost || tour.state !== 'open'; });
    var staked = tour.stakes && tour.stakes !== 'free', anyPaid = Object.keys(tour.paid || {}).length > 0;
    // build100q (wager fix): the HOST seeds a real buy-in when a staked mode has none, so the field DISPLAY can never
    // diverge from the replicated tour.buyIn. The old `bi.value = tour.buyIn || 50` showed "50" in the field while
    // tour.buyIn was still 0 → entrants (and the host) got charged a phantom 50 even when the host meant a smaller
    // amount. Entrants NEVER seed — they only ever show the host's snapshot value; a free bracket carries buyIn 0.
    if (tour.isHost && staked && !tour.buyIn) { tour.buyIn = DEFAULT_BUYIN; }
    var bir = $('mpx-tour-buyinrow'); if (bir) bir.hidden = !(staked && tour.isHost);
    var bl = $('mpx-tour-buyinlbl'); if (bl) bl.textContent = (tour.stakes === 'sidebet') ? 'BET' : 'BUY-IN';
    var bi = $('mpx-tour-buyin');
    if (bi) { bi.disabled = !tour.isHost || tour.state !== 'open' || anyPaid; if (document.activeElement !== bi) bi.value = staked ? (tour.buyIn || DEFAULT_BUYIN) : ''; }
    var hint = $('mpx-tour-stakehint');
    if (hint) {
      if (!staked) hint.hidden = true;
      else { hint.hidden = false; var amt = '<b>' + (tour.buyIn || 0) + ' ◆ Bonus Sparks</b>';
        hint.innerHTML = (tour.stakes === 'pool')
          ? '💰 Each entrant pays ' + amt + ' into the pot — the <b>champion takes the whole pool</b>. (Bonus Sparks are earned by playing, not real money.)'
          : '🎲 Players bet ' + amt + ' on who wins — <b>correct pickers split the pot</b> (parimutuel). Bets lock when round 1 starts.'; }
    }
  }
  function _wagerMax() { try { return window.RhythmWager ? window.RhythmWager.maxBuyIn() : 5000; } catch (e) { return 5000; } }
  function _wagerEnsurePool() {
    if (!tour.isHost || !tour.id || tour.stakes === 'free' || !window.RhythmWager) return;
    try { var pr = window.RhythmWager.openPool(tour.id, tour.buyIn, 'bonus', { mode: tour.stakes }); tour.potId = pr.potId; tour.currency = 'bonus'; if (!tour.pot) tour.pot = pr.pot || 0; } catch (e) {}
  }
  wire('mpx-tour-stakes', 'click', function (e) {
    var b = e.target.closest('button[data-stakes]'); if (!b || !tour.isHost || tour.state !== 'open') return;
    if (Object.keys(tour.paid || {}).length > 0) { banner('mpx-tour-msg', 'Can’t change stakes after a buy-in has been paid.'); return; }
    tour.stakes = b.getAttribute('data-stakes') || 'free'; tour.currency = 'bonus';
    if (tour.stakes === 'free') { tour.potId = null; tour.pot = 0; tour.buyIn = 0; }   // build100q: Free clears the buy-in too, so no stale bet amount lingers (was: pot zeroed but buyIn kept → "Free" + a phantom 50 bet)
    else { tour.buyIn = Math.max(1, Math.min(_wagerMax(), parseInt(($('mpx-tour-buyin') || {}).value, 10) || DEFAULT_BUYIN)); _wagerEnsurePool(); _wagerDeclined[tour.id] = false; try { setTimeout(_wagerMaybePay, 400); } catch (e) {} }   // host commits to its own buy-in too; re-selecting a mode re-prompts
    paintStakeRow(); paintTourRoom(); broadcastSnapshot(); advertiseTour();
  });
  wire('mpx-tour-buyin', 'input', function () {
    if (!tour.isHost || tour.state !== 'open' || Object.keys(tour.paid || {}).length > 0) return;
    tour.buyIn = Math.max(1, Math.min(_wagerMax(), parseInt(this.value, 10) || 1));
    if (tour.stakes !== 'free') _wagerEnsurePool();
    paintStakeRow(); paintTourRoom(); broadcastSnapshot(); advertiseTour();
  });
  // build66: side-bet — open the WHO-WINS picker + close it (cancel button or backdrop click)
  wire('mpx-tour-bet', 'click', function () { _openBetPicker(); });
  wire('mpx-bet-cancel', 'click', function () { _closeBetPicker(); });
  wire('mpx-bet-overlay', 'click', function (e) { if (e.target === this) _closeBetPicker(); });
  // build66: WAGER — entrant buy-in confirm + the HOST-verified paid fan-in + champion payout + refunds (all Bonus Sparks).
  var _wagerDeclined = {};
  function _wagerPaidLocal() { try { var pp = window.RhythmWager.getPool(tour.potId); return !!(pp && pp.paid && pp.paid[ME.id]); } catch (e) { return false; } }
  function _wagerMaybePay() {
    if (!tour.id || tour.stakes === 'free' || !tour.potId || tour.state !== 'open' || !window.RhythmWager) return;
    if (tour.stakes === 'sidebet') return;              // build66: side-bet is placed via the explicit PLACE-YOUR-BET picker (you choose WHO wins), not the pool auto-prompt
    if (tour.paid && tour.paid[ME.id]) return;          // the host already counts me as paid
    if (_wagerPaidLocal()) return;                      // I paid locally, awaiting the host's fan-in
    if (_wagerDeclined[tour.id]) return;                // I already passed on this bracket
    var amt = tour.buyIn || 0, isBet = tour.stakes === 'sidebet';
    if (!window.RhythmWager.canStake(amt, 'bonus')) { banner('mpx-tour-msg', 'Not enough Bonus Sparks for the ' + amt + ' ◆ ' + (isBet ? 'bet' : 'buy-in') + ' — earn more by playing, or leave the bracket.'); return; }
    var ok = true;
    try { ok = window.confirm('Enter this ' + (isBet ? 'side-bet' : 'prize-pool') + ' tournament?\n\nStake: ' + amt + ' ◆ Bonus Sparks.\n' + (isBet ? 'Correct pickers split the pot.' : 'The champion takes the whole pot.') + '\n\n(Bonus Sparks are earned by playing — NOT real money.)'); } catch (e) { ok = true; }
    if (!ok) { _wagerDeclined[tour.id] = true; banner('mpx-tour-msg', 'You passed on the buy-in — leave the bracket to exit.'); return; }
    try {
      window.RhythmWager.openPool(tour.id, amt, 'bonus', { mode: tour.stakes });   // local mirror so joinPool can debit my Bonus
      var key = tour.id + ':' + ME.id;
      var res = window.RhythmWager.joinPool(tour.potId, ME.id, key);
      if (res && res.ok) {
        if (tour.ch) { try { tour.ch.send({ type: 'broadcast', event: 't-paid', payload: { id: ME.id, idemKey: key } }); } catch (e) {} }
        if (tour.isHost) onTourPaid({ id: ME.id, idemKey: key });   // host counts itself immediately
        try { window.__rrSparksRefresh && window.__rrSparksRefresh(); } catch (e) {}
        banner('mpx-tour-msg', 'Paid ' + amt + ' ◆ in — waiting for the bracket to fill.');
      } else { banner('mpx-tour-msg', (res && res.error === 'insufficient') ? 'Not enough Bonus Sparks.' : 'Could not pay in — try again.'); }
    } catch (e) {}
    paintTourRoom();
  }
  // build66: SIDE-BET (parimutuel) — entrants pick WHO they think wins from the live roster + stake the buy-in on that pick.
  // Correct pickers split the pot at the crown. Placement is an explicit picker (not the pool auto-prompt) so you can wait for
  // the roster to fill before betting. The HOST fans each pick into tour.bets (host-verified), exactly like the pool roster.
  function _wagerBetLocal() { try { var pp = window.RhythmWager.getPool(tour.potId); return !!(pp && pp.bets && pp.bets[ME.id]); } catch (e) { return false; } }
  function _betPlaced() { return !!(tour.paid && tour.paid[ME.id]) || _wagerBetLocal(); }
  function _closeBetPicker() { var ov = $('mpx-bet-overlay'); if (ov) ov.hidden = true; }
  function _openBetPicker() {
    if (!tour.id || tour.stakes !== 'sidebet' || tour.state !== 'open' || !window.RhythmWager || _betPlaced()) return;
    var amt = tour.buyIn || 0;
    if (!window.RhythmWager.canStake(amt, 'bonus')) { banner('mpx-tour-msg', 'Not enough Bonus Sparks for the ' + amt + ' ◆ bet — earn more by playing.'); return; }
    var ov = $('mpx-bet-overlay'), list = $('mpx-bet-list'); if (!ov || !list) return;
    var amtEl = $('mpx-bet-amt'); if (amtEl) amtEl.textContent = amt + ' ◆ Bonus Sparks';
    list.innerHTML = '';
    Object.keys(tour.members || {}).forEach(function (id) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'mpx-bet-pick'; b.setAttribute('data-pick', id);
      b.textContent = (id === ME.id) ? (tourName(id) + ' (you)') : tourName(id);   // textContent → a peer display name can't inject markup
      b.addEventListener('click', function () { _placeBet(id); });
      list.appendChild(b);
    });
    ov.hidden = false;
  }
  function _placeBet(pick) {
    if (!pick || _betPlaced()) { _closeBetPicker(); return; }
    var amt = tour.buyIn || 0, key = tour.id + ':' + ME.id;
    try {
      window.RhythmWager.openPool(tour.id, amt, 'bonus', { mode: 'sidebet' });   // local mirror so placeBet can debit my Bonus
      var res = window.RhythmWager.placeBet(tour.potId, pick, amt, ME.id, key);
      if (res && res.ok) {
        if (tour.ch) { try { tour.ch.send({ type: 'broadcast', event: 't-paid', payload: { id: ME.id, idemKey: key, pick: String(pick) } }); } catch (e) {} }
        if (tour.isHost) onTourPaid({ id: ME.id, idemKey: key, pick: String(pick) });   // host counts its own bet immediately
        try { window.__rrSparksRefresh && window.__rrSparksRefresh(); } catch (e) {}
        banner('mpx-tour-msg', 'Bet ' + amt + ' ◆ on ' + (pick === ME.id ? 'yourself' : tourName(pick)) + ' — locks at round 1.');
      } else { banner('mpx-tour-msg', (res && res.error === 'insufficient') ? 'Not enough Bonus Sparks.' : 'Could not place the bet — try again.'); }
    } catch (e) {}
    _closeBetPicker(); paintTourRoom();
  }
  // HOST records each unique payer ONCE into the authoritative roster + pot (the integrity point — payment is host-verified,
  // not self-asserted; a modded client can broadcast t-paid but can't fabricate a real Bonus debit, and the host counts it once).
  function onTourPaid(p) {
    if (!tour.id || !p || !p.id || !tour.isHost || tour.stakes === 'free') return;
    if (tour.paid[p.id]) return;   // idempotent — never add the same payer's buy-in/bet twice
    tour.paid[p.id] = { at: Date.now(), idemKey: p.idemKey || null };
    if (tour.stakes === 'sidebet' && p.pick) tour.bets[p.id] = String(p.pick);   // build66: side-bet — record the host-verified pick (who this entrant backed)
    tour.pot = (tour.pot || 0) + (tour.buyIn || 0);
    paintTourRoom(); broadcastSnapshot();
  }
  // every client settles its own view when the champion is crowned. POOL: only the CHAMPION's client credits (winner-takes-pot).
  // SIDE-BET: EVERY client settles its own bet — those who backed the champion split the pot (parimutuel); the authoritative
  // pool-wide totals (WT, Wk) come from the replicated tour.bets/tour.pot. Returns MY winnings (0 if I didn't win).
  function _wagerSettle() {
    if (!tour.potId || tour.stakes === 'free' || !window.RhythmWager) return 0;
    var won = 0;
    try {
      if (tour.stakes === 'sidebet') {
        var WT = tour.pot || 0, Wk = 0, bs = tour.bets || {};
        Object.keys(bs).forEach(function (k) { if (String(bs[k]) === String(tour.champ)) Wk += (tour.buyIn || 0); });   // total staked on the actual champion
        var res = window.RhythmWager.settleBets(tour.potId, tour.champ, ME.id, tour.id + ':settle', { WT: WT, Wk: Wk });
        if (res && res.ok) { won = res.payout || 0; if (won > 0) { try { window.__rrSparksRefresh && window.__rrSparksRefresh(); } catch (e) {} } }
      } else {
        var r2 = window.RhythmWager.settlePool(tour.potId, tour.champ, ME.id, tour.id + ':settle', tour.pot);
        if (r2 && r2.ok && tour.champ === ME.id) { won = r2.payout || 0; if (won > 0) { try { window.__rrSparksRefresh && window.__rrSparksRefresh(); } catch (e) {} } }
      }
    } catch (e) {}
    return won;
  }
  function _wagerRefundMine() {
    if (!tour.potId || tour.stakes === 'free' || !window.RhythmWager) return;
    try { var res = window.RhythmWager.refundPool(tour.potId, ME.id, tour.id + ':refund'); if (res && res.ok) { try { window.__rrSparksRefresh && window.__rrSparksRefresh(); } catch (e) {} } } catch (e) {}
  }
  // dev NPC harness controls (visible only in dev mode)
  wire('mpx-dev-bot1', 'click', function () { devAddBots(1); });
  wire('mpx-dev-bot3', 'click', function () { devAddBots(3); });
  wire('mpx-dev-bot7', 'click', function () { devAddBots(7); });
  wire('mpx-dev-spectate', 'click', function () { var on = devSetSpectate(!_devSpectate); this.setAttribute('aria-pressed', on ? 'true' : 'false'); this.textContent = 'AUTO-RUN: ' + (on ? 'ON' : 'OFF'); this.classList.toggle('on', on); });
  wire('mpx-dev-diff', 'click', function () { var order = { easy: 'medium', medium: 'hard', hard: 'easy' }; var d = devSetBotDiff(order[_devBotDiff] || 'medium'); this.textContent = 'NPC: ' + d.toUpperCase(); });
  // build11: library search picker + invite link
  wire('mpx-tour-search-toggle', 'click', function () {
    if (!tour.isHost || tour.state !== 'open') return;
    var p = $('mpx-tour-picker'); if (!p) return;
    p.hidden = !p.hidden;
    if (!p.hidden) { tourRenderPicker(''); var q = $('mpx-tour-q'); if (q) { q.value = ''; q.focus(); } }
  });
  wire('mpx-tour-q', 'input', function () { tourRenderPicker(this.value); });
  wire('mpx-tour-invite', 'click', function () {
    if (!tour.id) return;
    var link = location.origin + location.pathname + '?mpjoin=' + tour.id;
    var btn = $('mpx-tour-invite');
    function flash(ok) { if (!btn) return; btn.classList.toggle('copied', ok); btn.textContent = ok ? '✓ LINK COPIED — SEND IT' : 'COPY INVITE LINK'; if (ok) setTimeout(function () { btn.classList.remove('copied'); btn.textContent = 'COPY INVITE LINK'; }, 2600); }
    try { navigator.clipboard.writeText(link).then(function () { flash(true); }, function () { window.prompt('Copy the invite link:', link); }); }
    catch (e) { window.prompt('Copy the invite link:', link); }
  });
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
  wire('mp-back', 'click', function () { try { _cancelShowOpen(); if (room.id && room.show) closeRoom(true); } catch (e) {} try { closeTour(true); teardownMatch(); if (lobbySP) lobbySP.stop(); if (lobbyCh) supa.removeChannel(lobbyCh); } catch (e) {} lobbyCh = null; lobbySP = null; lobby = {}; });   // build102s: leaving the MP screen ends an open show + any pending GO LIVE watchdog (never a zombie LIVE room advertised to the artist)

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
  // build11: invite deep-link — surface the multiplayer screen shortly after boot so the join flows
  if (_pendingTourJoin) setTimeout(function () { try { open(); } catch (e) {} }, 1800);
  // build102 (Phase-2 judge blocker): ?mproom= links must ALSO auto-open MP at boot — the room join only fires inside
  // the lobby's SUBSCRIBED handler, so without this a "JOIN THE MATCH" invite dead-ends on the main menu until the
  // player manually finds MULTIPLAYER. Mirrors the ?mpjoin= line above.
  else if (_pendingRoomJoin) setTimeout(function () { try { open(); } catch (e) {} }, 1800);
  // build42: reconnect to a bracket I was in if the tab reloaded (persisted < 90s ago) — surface MP, rejoin the channel, pull the snapshot
  else { try {
    if (sessionStorage.getItem('rr_tour')) setTimeout(function () { try { open(); setTimeout(maybeReconnectTour, 800); } catch (e) {} }, 1500);
    // build102s: host refresh ≤90s revives the SHOW room (rr_showroom mirrors the rr_tour pattern — no other pending deep-link wins)
    else if (sessionStorage.getItem('rr_showroom')) setTimeout(function () { try { open(); setTimeout(maybeReconnectShowRoom, 800); } catch (e) {} }, 1500);
  } catch (e) {} }

  // public hook
  window.RhythmMP = { open: open, close: leaveAll, isLive: function () { return matchLive || tour.state === 'live'; },
    getRank: getRank,                                                  // v254: the leaderboard MULTIPLAYER tab reads this
    getCombat: function () { return combatOn; },
    setCombat: function (on) { combatOn = !!on; try { localStorage.setItem('rr_mp_combat', combatOn ? '1' : '0'); } catch (e) {} paintCombatToggle(); return combatOn; },
    openShowRoom: openShowRoom,                                        // build102s: GO LIVE entry from the review launch card
    isShowOpen: function () { return !!(room && room.show && room.id); } };   // build102s: catalog.js return-pill guard reads this
  // build102s DEV HOOK (strip before launch with __rrDebug/__mpDev/__rrReview — it's on the CLAUDE.md strip list):
  // headless driver for the live-show flow — the real path otherwise needs an HMAC token + three browsers.
  window.__rrShow = {
    open: function (fakeSel) { return openShowRoom(fakeSel || {}); },
    state: function () { return { show: !!(room && room.show), rid: room && room.id, p2: (room && room.p2) || null,
      pending: (room && room.pendingChal) || null, invited: !!(room && room.invited), solo: _soloRun }; },
    // build102t: headless probe for the spectator stage (decks/chart/streams) — strip with the rest
    spec: function () { return { mounted: !!_specStage, decks: _specStage ? (_specSolo ? 1 : 2) : 0,
      lastTickIds: Object.keys(_specTicks), chartNotes: (_specChart && _specChart.notes && _specChart.notes.length) || 0,
      audio: !!_specDp, atMs: _specAtMs, specN: _specNCache }; }
  };
  // dev NPC harness (console) — LOCALHOST-ONLY (build66 launch-audit P1: __tour.send can forge live-bracket events /
  // self-credit the pot with no sender auth; MP_DEV gates it out of production while keeping it for the localhost builder).
  if (MP_DEV) {
  window.__mpDev = { bots: devAddBots, clear: devClearBots, auto: devSetAuto, spectate: devSetSpectate, diff: devSetBotDiff, status: devStatus,
    solo: devSoloTour, start: startTour, run: function (n) { devSoloTour(n); setTimeout(startTour, 700); return tour.id; },
    npc: devVsNpc,
    vs: function (v) { _vsActive = v !== false; return _vsActive; }, oppState: function () { return lastOppState; },
    // preview the split-screen HUD over a running demo with a synthetic opponent (no 2nd player needed)
    vsPreview: function () {
      var g = $('game'); if (!g) return 'no #game';
      oppMeta = { name: 'RIVAL' };
      g.classList.add('vs-mode'); _vsActive = true; _vsMode = true;
      mountVsHud(); try { window.dispatchEvent(new Event('resize')); } catch (e) {}
      runVsIntro();
      var t0 = performance.now();
      (function loop() {
        if (!_vsMode) return;
        var stt = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;
        var rf = window.RhythmGame.getRenderFrame ? window.RhythmGame.getRenderFrame() : null;
        if (rf) _myRf = rf;
        var el = (performance.now() - t0) / 1000;
        lastOppState = { sc: Math.round((stt ? stt.score : 0) * 0.9 + el * 900), cb: stt ? Math.round(stt.combo * 0.8) : 0, od: Math.min(1, el / 18), oda: el % 20 > 16, st: 1, pr: stt ? stt.progress : 0, ev: [] };
        if (stt) renderVsHud(stt, _myRf);
        requestAnimationFrame(loop);
      })();
      return 'vs preview on';
    },
    vsOff: function () { _vsMode = false; _vsActive = false; var g = $('game'); if (g) g.classList.remove('vs-mode', 'you-od-fire', 'vs-intro'); unmountVsHud(); try { window.dispatchEvent(new Event('resize')); } catch (e) {} return 'off'; } };
  // DEV HOOK (strip at content-freeze with the other __rr hooks): drive/inspect the bracket headlessly
  window.RhythmMP.__tour = {
    state: function () { return tour; },
    dir: function () { return toursDir; },
    send: function (event, payload) { if (tour.ch) tour.ch.send({ type: 'broadcast', event: event, payload: payload }); },
    open: openTour, join: joinTour, start: startTour, roll: rollTrack,
    snap: snapshotTour, promote: maybePromoteHost, sanitize: sanitizeFinal,
    persisted: function () { try { return JSON.parse(sessionStorage.getItem('rr_tour') || 'null'); } catch (e) { return null; } }
  };
  }   // end if (MP_DEV) — dev harness is localhost-only
})();
