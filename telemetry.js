/* =============================================================================
   telemetry.js — Reactive Rhythm client telemetry + EU consent gate
   -----------------------------------------------------------------------------
   PRODUCTION module (NOT a dev hook — survives content-freeze, unlike __rrDebug).
   Implements the game side of TELEMETRY_BACKEND_BRIEF.md:
     • POST /clientlog  — error / crash reports   (error())
     • POST /events     — funnel analytics         (event())

   HARD GUARANTEES (read these before touching anything):
     • NEVER throws, NEVER blocks gameplay. Every public method is try/caught and
       fire-and-forget. A telemetry failure must be invisible to the player.
     • DEGRADES GRACEFULLY. If the endpoint base is absent or the network is down,
       it NO-OPs (buffers locally, swallows send errors). The backend may not be
       live yet — that's expected; the beta is never blocked on it.
     • CONSENT-GATED. Nothing leaves the device until consent === 'accepted'.
       Pre-consent events/errors BUFFER locally (capped). On accept → flush + go
       live. On decline → local-only forever (the existing rr_errlog still works).

   SWAP-SEAM: the endpoint base is read from window.RHYTHM_CONFIG (no code edits to
   repoint). Order: TELEMETRY_BASE → CLIENTLOG_URL/EVENTS_URL → API_BASE → const.
   ============================================================================= */
(function () {
  'use strict';

  // ---- config / swap-seam -------------------------------------------------
  // Point the client at the backend by setting window.RHYTHM_CONFIG once the
  // Lovable backend exposes the endpoints. Any of these wins (most specific first):
  //   RHYTHM_CONFIG.CLIENTLOG_URL / EVENTS_URL  — exact endpoint URLs
  //   RHYTHM_CONFIG.TELEMETRY_BASE              — base; endpoints = base + '/clientlog' | '/events'
  //   RHYTHM_CONFIG.API_BASE                    — fallback base (today's game-catalog edge fn)
  // Leave everything empty to fully disable network (events still buffer locally).
  var CFG = (function () { try { return window.RHYTHM_CONFIG || {}; } catch (e) { return {}; } })();

  // Hard fallback const if RHYTHM_CONFIG is somehow absent. Empty string = no
  // network (graceful no-op). Set a real base here only as a last resort.
  var FALLBACK_BASE = '';

  function stripSlash(s) { return String(s || '').replace(/\/+$/, ''); }

  function resolveUrls() {
    var c = CFG || {};
    var clientlog = c.CLIENTLOG_URL || '';
    var events = c.EVENTS_URL || '';
    if (!clientlog || !events) {
      var base = stripSlash(c.TELEMETRY_BASE || c.API_BASE || FALLBACK_BASE);
      if (base) {
        if (!clientlog) clientlog = base + '/clientlog';
        if (!events) events = base + '/events';
      }
    }
    return { clientlog: clientlog || '', events: events || '' };
  }
  var URLS = resolveUrls();
  function netEnabled() { return !!(URLS.clientlog || URLS.events); }

  // anon key (for Supabase edge functions — same key the catalog layer uses).
  var ANON_KEY = (function () { try { return CFG.SUPABASE_KEY || ''; } catch (e) { return ''; } })();

  // ---- app_version: read the live ?v=NN off game.js, else a const ---------
  var APP_VERSION = (function () {
    try {
      var s = document.querySelector('script[src*="game.js"]');
      if (s) {
        var m = (s.getAttribute('src') || '').match(/[?&]v=([^&]+)/);
        if (m) return 'v' + m[1];
      }
    } catch (e) {}
    return 'v308'; // fallback build tag — keep roughly in step with the ?v in index.html (bump with ?v; build72)
  })();

  // ---- stable session id (per device, persisted) --------------------------
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    try {
      if (window.crypto && crypto.getRandomValues) {
        var b = new Uint8Array(16); crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        var h = []; for (var i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
        return h[0] + h[1] + h[2] + h[3] + '-' + h[4] + h[5] + '-' + h[6] + h[7] + '-' + h[8] + h[9] + '-' + h[10] + h[11] + h[12] + h[13] + h[14] + h[15];
      }
    } catch (e) {}
    // last-ditch (non-crypto) fallback
    return 'sid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  var SID_KEY = 'rr_sid';
  var SESSION_ID = (function () {
    try {
      var v = localStorage.getItem(SID_KEY);
      if (v) return v;
      v = uuid();
      try { localStorage.setItem(SID_KEY, v); } catch (e) {}
      return v;
    } catch (e) { return uuid(); }
  })();

  // ---- best-effort user_id (non-blocking) ---------------------------------
  // We never await getUser() in the hot path; we cache it opportunistically.
  var _userId = null;
  function refreshUser() {
    try {
      var rc = window.RhythmCatalog;
      if (rc && typeof rc.getUser === 'function') {
        var p = rc.getUser();
        if (p && typeof p.then === 'function') {
          p.then(function (u) { _userId = (u && u.id) || null; }, function () {});
        } else if (p && p.id) { _userId = p.id; }
      }
    } catch (e) {}
  }
  // refresh once shortly after load, and whenever auth changes (if the hook exists)
  try { setTimeout(refreshUser, 1500); } catch (e) {}
  try {
    var rc0 = window.RhythmCatalog;
    if (rc0 && typeof rc0.onAuthChange === 'function') { rc0.onAuthChange(function () { refreshUser(); }); }
  } catch (e) {}

  // ---- consent ------------------------------------------------------------
  var CONSENT_KEY = 'rr_consent';
  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY) || 'unset'; } catch (e) { return 'unset'; }
  }

  // ---- local buffers (capped) --------------------------------------------
  // Pre-consent + offline buffering. Capped so a long offline session can't grow
  // unbounded. Kept in-memory; we don't persist the funnel buffer (privacy: nothing
  // touches storage pre-consent beyond the existing rr_errlog written elsewhere).
  var EVT_CAP = 200;     // max buffered events
  var ERR_CAP = 50;      // max buffered errors
  var evtBuffer = [];    // pending /events rows (also the live batch queue)
  var errBuffer = [];    // pending /clientlog rows

  // build180 (D5, Fable-directed): LEGITIMATE-INTEREST allow-list. These are ANONYMOUS OPERATIONAL events —
  // pure gameplay-funnel signals with NO identity (track id, difficulty, score %, an anonymous rating) — the
  // textbook legitimate-interest case. They flush even when consent is 'unset' (the default), STRIPPED of user_id,
  // so we can finally SEE the play funnel (start → decode_error → fail → complete) + track enjoyment without gating
  // the whole fleet on an explicit accept. 'declined' still sends NOTHING; 'accepted' still sends everything
  // (incl. user_id + errors). This is the ONLY loosening — errors/identifying events keep the strict accept-gate.
  var LEGIT_EVENTS = { song_start: 1, song_complete: 1, run_fail: 1, decode_error: 1, rating: 1 };

  function pushCapped(arr, row, cap) {
    arr.push(row);
    while (arr.length > cap) arr.shift();   // drop oldest on overflow
  }

  // ---- low-level send (fire-and-forget, never throws) ---------------------
  function postJSON(url, payload) {
    if (!url) return;
    var body;
    try { body = JSON.stringify(payload); } catch (e) { return; }
    // build181 (audit P1): FETCH KEEPALIVE ONLY — sendBeacon is fully retired. A harness probe proved beacon-sent
    // rows silently do NOT land (the beacon can't carry the apikey header and its content-type trips the insert),
    // and build180 only fixed the LIVE path — the unload flush (pagehide/visibilitychange) still drained the
    // accepted-consent buffers into the dead beacon, permanently losing the highest-value rows (errors, the final
    // song_complete of a session). fetch({keepalive:true}) is designed to survive unload and is the transport that
    // provably lands; callers' extra args are ignored (signature kept lean, flush() no longer branches).
    try {
      if (typeof fetch === 'function') {
        var headers = { 'Content-Type': 'application/json' };
        if (ANON_KEY) { headers['apikey'] = ANON_KEY; headers['Authorization'] = 'Bearer ' + ANON_KEY; }
        fetch(url, { method: 'POST', headers: headers, body: body, keepalive: true, mode: 'cors' })
          .catch(function () {});   // swallow — degrade silently
      }
    } catch (e) {}
  }

  // ---- flush: three consent states (build180) -----------------------------
  //   'declined'  → send NOTHING (full opt-out honored).
  //   'accepted'  → send EVERYTHING (errors + all events, incl. user_id).  [unchanged behavior]
  //   'unset'     → LEGITIMATE INTEREST: send only the anonymous operational allow-list (LEGIT_EVENTS),
  //                 stripped of user_id; NON-legit events + all errors stay buffered until an explicit accept.
  function flush(useBeaconOnly) {
    try {
      var consent = getConsent();
      if (consent === 'declined') return;        // full opt-out — nothing leaves the device
      if (!netEnabled()) { return; }             // no endpoint → keep buffering (don't drop)
      var full = (consent === 'accepted');
      // Errors can carry stack/url → potentially identifying → strict accept-gate only.
      if (full && errBuffer.length && URLS.clientlog) {
        while (errBuffer.length) {
          var ebatch = errBuffer.splice(0, 20);
          postJSON(URLS.clientlog, ebatch.length === 1 ? ebatch[0] : ebatch, useBeaconOnly);
        }
      }
      if (evtBuffer.length && URLS.events) {
        if (full) {
          // accepted → send everything (batched ~50)
          while (evtBuffer.length) {
            var vbatch = evtBuffer.splice(0, 50);
            postJSON(URLS.events, vbatch.length === 1 ? vbatch[0] : vbatch, useBeaconOnly);
          }
        } else {
          // unset → send only anonymized operational events; leave the rest buffered.
          var legit = [], keep = [];
          for (var i = 0; i < evtBuffer.length; i++) {
            var r = evtBuffer[i];
            if (r && LEGIT_EVENTS[r.event_name]) {
              var a = {};
              for (var k in r) { if (k !== 'user_id' && Object.prototype.hasOwnProperty.call(r, k)) a[k] = r[k]; }
              legit.push(a);   // anonymized copy (user_id stripped)
            } else { keep.push(r); }
          }
          evtBuffer = keep;    // module-scoped var — event()/pushCapped pick up the new array
          while (legit.length) {
            var lbatch = legit.splice(0, 50);
            postJSON(URLS.events, lbatch.length === 1 ? lbatch[0] : lbatch);
          }
        }
      }
    } catch (e) { /* never throw */ }
  }

  // periodic flush (every few seconds) — cheap no-op until consent + a backend
  var _timer = null;
  function startTimer() {
    if (_timer) return;
    try { _timer = setInterval(function () { try { flush(); } catch (e) {} }, 4000); } catch (e) {}
  }

  // ---- consent transitions ------------------------------------------------
  function setConsent(choice) {
    try {
      var c = (choice === 'accepted') ? 'accepted' : 'declined';
      try { localStorage.setItem(CONSENT_KEY, c); } catch (e) {}
      if (c === 'accepted') {
        startTimer();
        flush();          // drain anything buffered pre-consent
      } else {
        // declined → drop the in-memory buffers; nothing leaves the device.
        evtBuffer.length = 0;
        errBuffer.length = 0;
      }
      return c;
    } catch (e) { return 'declined'; }
  }

  // ---- public: event(name, props) -----------------------------------------
  function event(name, props) {
    try {
      if (!name) return;
      // build180: normalize props so the edge fn's snake_case extractor captures the per-track dimension. The game
      // fires trackId (camelCase); the DB column + extractor want track_id. Mirror it on a COPY (never mutate the
      // caller's object) so a decode_error / song_start actually records WHICH track — the signal Fable wants most.
      var _p = (props && typeof props === 'object') ? props : {};
      if (_p.trackId != null && _p.track_id == null) {
        var _pc = {};
        for (var _pk in _p) { if (Object.prototype.hasOwnProperty.call(_p, _pk)) _pc[_pk] = _p[_pk]; }
        _pc.track_id = _p.trackId;
        _p = _pc;
      }
      var row = {
        client_ts: new Date().toISOString(),
        session_id: SESSION_ID,
        event_name: String(name),
        props: _p,
        app_version: APP_VERSION
      };
      if (_userId) row.user_id = _userId;
      pushCapped(evtBuffer, row, EVT_CAP);
      // live path: flush promptly on a decisive event so song_complete/decode_error land fast. build180: also
      // prompt-flush a legitimate-interest event under 'unset' (flush() self-gates: it only sends the anon
      // allow-list there); 'declined' is a no-op inside flush().
      if (getConsent() === 'accepted' || LEGIT_EVENTS[String(name)]) flush();
    } catch (e) { /* never throw */ }
  }

  // ---- public: error(errObj) ----------------------------------------------
  // errObj may be an Error, or a plain { message, stack, url } bag from the global
  // error handler. We're lenient — store what's present.
  // build102 (security, Phase-2 judge mandate): NEVER ship auth-bearing query params in telemetry rows — the
  // ?review= HMAC token (and the Phase-2 share token) would otherwise leak into the error table via location.href
  // on every captured client error, letting anyone who can read telemetry replay a live review link.
  function _redactUrl(u) { try { return String(u || '').replace(/([?&](?:review|token|share)=)[^&#]+/gi, '$1[redacted]'); } catch (e) { return ''; } }
  function error(errObj) {
    try {
      var msg = '', stack = '', url = '';
      if (errObj) {
        if (typeof errObj === 'string') { msg = errObj; }
        else {
          msg = errObj.message != null ? errObj.message : (errObj.msg != null ? errObj.msg : '');
          stack = errObj.stack || '';
          url = errObj.url || errObj.where || '';
        }
      }
      var row = {
        client_ts: new Date().toISOString(),
        session_id: SESSION_ID,
        ua: (function () { try { return navigator.userAgent; } catch (e) { return ''; } })(),
        url: _redactUrl(url || (function () { try { return location.href; } catch (e) { return ''; } })()),
        message: String(msg == null ? '' : msg).slice(0, 4000),     // cap so a log bomb can't bloat the table
        stack: String(stack || '').slice(0, 8000),
        app_version: APP_VERSION
      };
      if (_userId) row.user_id = _userId;
      pushCapped(errBuffer, row, ERR_CAP);
      if (getConsent() === 'accepted') flush();
    } catch (e) { /* never throw */ }
  }

  // ---- flush on the way out (survives unload via sendBeacon) ---------------
  try {
    window.addEventListener('pagehide', function () { try { flush(true); } catch (e) {} });
    document.addEventListener('visibilitychange', function () {
      try { if (document.visibilityState === 'hidden') flush(true); } catch (e) {}
    });
  } catch (e) {}

  // Start the periodic flush unless the user opted OUT. Under 'accepted' it drains everything; under 'unset' it
  // drains only the anonymous legitimate-interest allow-list (flush() self-gates). 'declined' → timer still ticks
  // but flush() returns immediately, so nothing leaves. build180: was accept-only, which kept the fleet dark.
  try { if (getConsent() !== 'declined') { startTimer(); } } catch (e) {}

  // ---- export -------------------------------------------------------------
  window.RhythmTelemetry = {
    error: error,
    event: event,
    setConsent: setConsent,
    getConsent: getConsent,
    flush: flush,
    sessionId: SESSION_ID,
    appVersion: APP_VERSION,
    // diagnostics (safe to keep — read-only views of the swap-seam + buffers)
    _urls: function () { return { clientlog: URLS.clientlog, events: URLS.events, net: netEnabled() }; },
    _buffers: function () { return { events: evtBuffer.slice(), errors: errBuffer.slice() }; }
  };
})();
