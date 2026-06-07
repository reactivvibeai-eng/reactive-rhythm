// ===========================================================================
// RHYTHM RIFT — Catalog / Live layer
// Wires the engine (window.RhythmGame) to the ReactivVibe game-catalog API.
//
// Modes (auto-detected on load):
//   • ?trackId=<uuid>  -> LIVE single track (fetch chart, stream HLS, submit score)
//   • ?picker=1        -> LIVE picker (GET /tracks, choose one)
//   • (default)        -> DEMO  (local mp3 + in-browser analyzer; no score submit)
//
// Config comes from window.RHYTHM_CONFIG (set in the HTML <head>). When embedded
// same-origin at /play, supabase-js reads the shared session from localStorage.
// ===========================================================================

(() => {
  const CFG = window.RHYTHM_CONFIG || {};
  const API_BASE = (CFG.API_BASE || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);

  // ---------- Supabase auth (optional) ----------
  let supa = null;
  if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_KEY) {
    try {
      // Match the parent site's client config exactly so the iframe inherits the
      // session from shared localStorage (default storageKey, no override).
      supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
        auth: { storage: window.localStorage, persistSession: true, autoRefreshToken: true },
      });
    } catch (e) { console.warn('supabase init failed', e); }
  }
  async function getToken() {
    if (!supa) return null;
    try {
      const { data } = await supa.auth.getSession();
      return data && data.session ? data.session.access_token : null;
    } catch (e) { return null; }
  }

  // ---------- identity + Sparks shell seams (read-only; real /sparks API later) ----------
  // ONE source of truth for "who is signed in" — reads the SHARED website supabase-js session
  // (same client `supa` used by getToken). Stays null/guest when supabase-js or config absent.
  async function getUser() {
    // LIVE: prefer GET /me (the site profile — display_name + avatar). It returns 200 {user:null}
    // when logged out, and we fall back to the raw supabase session if the endpoint ever hiccups.
    if (API_BASE) {
      try {
        const out = await api('/me', { auth: true });
        if (out && 'user' in out) {
          const u = out.user;
          if (u && u.id) return { id: u.id, name: u.display_name || 'Player', email: u.email || null, avatar_url: u.avatar_url || null };
          return null;   // explicit logged-out
        }
      } catch (e) { /* backend hiccup → fall back to the session below */ }
    }
    if (!supa) return null;
    try {
      const { data } = await supa.auth.getUser();
      const u = data && data.user;
      if (!u) return null;
      const m = u.user_metadata || {};
      const name = m.display_name || m.full_name || m.name
        || (u.email ? u.email.split('@')[0] : null) || 'Player';
      return { id: u.id, name: name, email: u.email || null, avatar_url: m.avatar_url || null };
    } catch (e) { return null; }
  }

  // Subscribe to login/logout so the header chip updates live. Returns an unsubscribe fn (or noop).
  function onAuthChange(cb) {
    if (!supa || typeof cb !== 'function') return function () {};
    try {
      const { data } = supa.auth.onAuthStateChange(function () { try { cb(); } catch (e) {} });
      return function () { try { data.subscription.unsubscribe(); } catch (e) {} };
    } catch (e) { return function () {}; }
  }

  // SPARKS balance. STUB today: returns a locally-cached number (default 0) so the chip renders.
  // LIVE: backend `GET /sparks/balance` (auth'd) is shipped; USE_SPARKS_API=true calls it + caches.
  // Set USE_SPARKS_API=false to fall back to the local cache (e.g. if the endpoint is taken down).
  const USE_SPARKS_API = true;   // LIVE: backend GET /sparks/balance shipped (Lovable)
  function loadSparksCache() { try { const v = parseInt(localStorage.getItem('rr_sparks') || '0', 10); return isNaN(v) ? 0 : v; } catch (e) { return 0; } }
  function saveSparksCache(n) { try { localStorage.setItem('rr_sparks', String(n | 0)); } catch (e) {} }
  async function getSparks() {
    if (USE_SPARKS_API && API_BASE) {
      try {
        const tk = await getToken();
        if (tk) {
          const out = await api('/sparks/balance', { auth: true });   // { balance, signed_in, currency }
          const bal = (out && typeof out.balance === 'number') ? out.balance : loadSparksCache();
          saveSparksCache(bal);
          return bal;
        }
      } catch (e) { /* fall through to cache */ }
    }
    return loadSparksCache();   // logged-out / backend hiccup → last cached value
  }

  // ---------- STORE / entitlements seams (LIVE: Lovable GET /store, GET /entitlements,
  // POST /sparks/spend). All graceful when logged-out / backend dormant — never throw. ----------
  function rrUuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      if (window.crypto && window.crypto.getRandomValues) {
        const b = new Uint8Array(16); window.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        const h = []; for (let i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
        return h[0]+h[1]+h[2]+h[3]+'-'+h[4]+h[5]+'-'+h[6]+h[7]+'-'+h[8]+h[9]+'-'+h[10]+h[11]+h[12]+h[13]+h[14]+h[15];
      }
    } catch (e) {}
    return 'rr-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 10);
  }
  // GET /store -> { items:[…], balance, signed_in }. Logged-out → prices still visible. Safe empty on error.
  async function getStore() {
    if (!API_BASE) return { items: [], balance: loadSparksCache(), signed_in: false };
    try {
      const out = await api('/store', { auth: true });
      if (out && typeof out.balance === 'number') saveSparksCache(out.balance);
      return {
        items: Array.isArray(out && out.items) ? out.items : [],
        balance: (out && typeof out.balance === 'number') ? out.balance : loadSparksCache(),
        signed_in: !!(out && out.signed_in),
      };
    } catch (e) { return { items: [], balance: loadSparksCache(), signed_in: false }; }
  }
  // GET /entitlements -> { signed_in, owns:[{item_type,item_id}] }. Safe empty when dormant.
  // entitlements cache so synchronous callers (Levels picker gating, Store equip state) can read ownership without awaiting.
  const _entitlements = { signed_in: false, owns: [] };
  function _setEntCache(list, signed) {
    _entitlements.owns = Array.isArray(list) ? list.map(function (o) { return { item_type: String(o.item_type), item_id: String(o.item_id) }; }) : [];
    _entitlements.signed_in = !!signed;
  }
  // synchronous ownership check (reads the last-fetched cache). Returns false until getEntitlements()/getStore() has run.
  function ownsItem(item_type, item_id) {
    var t = String(item_type), i = String(item_id);
    return _entitlements.owns.some(function (o) { return o.item_type === t && o.item_id === i; });
  }
  async function getEntitlements() {
    if (!API_BASE) { _setEntCache([], false); return { signed_in: false, owns: [] }; }
    try {
      const out = await api('/entitlements', { auth: true });
      const owns = Array.isArray(out && out.owns) ? out.owns : [];
      _setEntCache(owns, !!(out && out.signed_in));
      return { signed_in: !!(out && out.signed_in), owns: owns };
    } catch (e) { return { signed_in: _entitlements.signed_in, owns: _entitlements.owns.slice() }; }
  }
  // POST /sparks/spend { item_type, item_id, idempotency_key } -> {ok,balance,granted,deduped}
  // 402 insufficient_sparks · 409 price_mismatch. Returns a normalized result the UI branches on.
  async function spendSparks(item_type, item_id) {
    if (!API_BASE) return { ok: false, error: 'no-api' };
    const tk = await getToken();
    if (!tk) return { ok: false, error: 'not-authed' };
    const body = { item_type, item_id, idempotency_key: rrUuid() };
    try {
      const out = await api('/sparks/spend', { method: 'POST', body, auth: true });
      if (out && typeof out.balance === 'number') saveSparksCache(out.balance);
      return { ok: !!(out && out.ok), balance: out && out.balance, granted: out && out.granted, deduped: !!(out && out.deduped) };
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (/\b402\b|insufficient/i.test(msg)) return { ok: false, error: 'insufficient_sparks' };
      if (/\b409\b|price_mismatch/i.test(msg)) return { ok: false, error: 'price_mismatch' };
      return { ok: false, error: 'spend_failed', detail: msg };
    }
  }

  // ---------- API client ----------
  async function api(path, { method = 'GET', body = null, auth = false } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (auth) { const tk = await getToken(); if (tk) headers.authorization = 'Bearer ' + tk; }
    const res = await fetch(API_BASE + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let detail = ''; try { detail = (await res.json()).error || ''; } catch (e) {}
      throw new Error('API ' + res.status + (detail ? ' · ' + detail : '') + ' (' + path + ')');
    }
    return res.json();
  }

  // ---------- shared, gesture-unlocked <audio> element (mobile autoplay) ----------
  // iOS only allows programmatic play() on an element previously started inside a
  // user gesture. We bless ONE persistent element on first touch and reuse it for
  // every live track, so play() works after the countdown.
  let liveAudioEl = null;
  function getLiveAudio() {
    if (!liveAudioEl) { liveAudioEl = new Audio(); liveAudioEl.preload = 'auto'; }
    return liveAudioEl;
  }
  function unlockLiveAudio() {
    const a = getLiveAudio();
    // tiny silent wav
    if (!a.src) a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    const p = a.play();
    if (p && p.then) p.then(() => { a.pause(); try { a.currentTime = 0; } catch (e) {} }).catch(() => {});
  }
  ['pointerdown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, unlockLiveAudio, { once: true, passive: true }));

  // ===========================================================================
  // LivePlayer — Mux HLS via hls.js OR a direct file, with a smoothed clock.
  // currentTime updates coarsely on <audio>, so we interpolate with perf time
  // between updates for jitter-free note motion.
  // ===========================================================================
  // ===========================================================================
  // LivePlayer — plays either an HLS manifest (Mux .m3u8) OR a direct audio file
  // (WAV / mp3 / m4a). Uses an <audio> element with a smoothed clock so note
  // motion stays jitter-free between coarse currentTime updates.
  //
  // For direct files we DO NOT set crossOrigin: media elements play cross-origin
  // without CORS (we never read PCM, so WebAudio/CORS isn't needed). Setting
  // crossOrigin would needlessly gate playback on CORS headers the storage
  // bucket may not send.
  // ===========================================================================
  class LivePlayer {
    constructor(url, duration, isHls) {
      this.url = url; this.duration = duration;
      this.isHls = isHls != null ? isHls : /\.m3u8(\?|$)/i.test(url || '');
      this.audio = null; this.hls = null;
      this._lastA = 0; this._lastWall = 0; this._paused = true; this._ended = false;
      this.onended = null;
    }
    async prepare() {
      if (!this.url) throw new Error('No playable audio source for this track');
      const audio = getLiveAudio(); // reuse the gesture-blessed element
      audio.preload = 'auto';
      audio.muted = window.RhythmGame.isMuted();
      this.audio = audio;
      this._endedHandler = () => { this._ended = true; if (this.onended) this.onended(); };
      audio.addEventListener('ended', this._endedHandler);

      const nativeHls = audio.canPlayType('application/vnd.apple.mpegurl');
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('Audio load timeout — source unreachable')), 20000);
        const ok = () => { clearTimeout(to); resolve(); };
        const fail = (msg) => { clearTimeout(to); reject(new Error(msg)); };

        if (this.isHls && !nativeHls && window.Hls && window.Hls.isSupported()) {
          // HLS via hls.js (non-Safari)
          const hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
          this.hls = hls;
          hls.loadSource(this.url); hls.attachMedia(audio);
          hls.on(window.Hls.Events.MANIFEST_PARSED, ok);
          hls.on(window.Hls.Events.ERROR, (_e, data) => { if (data && data.fatal) fail('hls fatal: ' + data.type); });
        } else {
          // Native HLS (Safari) OR a direct file (wav/mp3/m4a)
          audio.src = this.url;
          audio.addEventListener('canplay', ok, { once: true });
          audio.addEventListener('loadeddata', ok, { once: true });
          audio.addEventListener('error', () => fail('audio error code=' + (audio.error && audio.error.code)), { once: true });
          audio.load();
        }
      });
    }
    play() {
      this._paused = false; this._lastA = 0; this._lastWall = performance.now();
      try { this.audio.currentTime = 0; } catch (e) {}
      const pr = this.audio.play();
      if (pr && pr.catch) pr.catch(err => console.warn('play() blocked', err));
    }
    getTime() {
      if (!this.audio) return -3;
      const a = this.audio.currentTime; const now = performance.now();
      if (a !== this._lastA) { this._lastA = a; this._lastWall = now; }
      if (this._paused) return this._lastA;
      return this._lastA + (now - this._lastWall) / 1000;
    }
    getDuration() { return this.duration || this.audio.duration || 0; }
    pause() { this._paused = true; this._lastA = this.audio.currentTime; try { this.audio.pause(); } catch (e) {} }
    resume() { this._paused = false; this._lastWall = performance.now(); this._lastA = this.audio.currentTime; try { this.audio.play(); } catch (e) {} }
    setMuted(m) { if (this.audio) this.audio.muted = m; }
    setGain(v) { if (this.audio) { try { this.audio.volume = Math.max(0, Math.min(1, v)); } catch (e) {} } }
    stop() {
      try {
        if (this.audio) {
          this.audio.pause();
          if (this._endedHandler) this.audio.removeEventListener('ended', this._endedHandler);
          this.audio.removeAttribute('src');
          this.audio.load();
        }
      } catch (e) {}
      if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
      this.audio = null;
    }
  }

  // ===========================================================================
  // LIVE provider factory — returns an async provider for a given trackId.
  // Re-fetches /track/:id on every call so each play gets a FRESH play_token
  // (single-use, 10-min TTL).
  // ===========================================================================
  // ---- pack context + play/use tracking (revenue attribution) ---------------
  // The player enters a level "from Pack X" — passed as ?pack=<uuid> when the game
  // is embedded. null = freeplay. The catalog also returns pack_ids[] per track.
  let packId = null;
  try { const m = location.search.match(/[?&]pack=([^&]+)/); if (m) packId = decodeURIComponent(m[1]); } catch (e) {}
  function getPackId() { return packId; }

  // Non-scored events (preview / loaded / skipped / auto_play / menu_demo).
  // Fire-and-forget; auth optional (anon previews fine, user_id added when JWT present).
  function logUse(trackId, eventType, opts) {
    if (!API_BASE || !trackId) return;
    opts = opts || {};
    const body = {
      track_id: trackId, event_type: eventType,
      pack_id: opts.pack_id !== undefined ? opts.pack_id : packId,
      duration_ms: opts.duration_ms || 0,
      client_info: { ua: navigator.userAgent, ts: Date.now() },
    };
    try { api('/uses', { method: 'POST', body, auth: true }).catch(() => {}); } catch (e) {}
  }

  function liveProvider(trackId) {
    return async () => {
      const t = await api('/track/' + trackId, { auth: true });
      if (!t.chart || t.chart_status !== 'ready') {
        throw new Error('This track isn\u2019t ready to play yet.');
      }
      // Source priority: prefer a real HLS manifest, else any direct audio file.
      // CRITICAL: stream_url is NOT always HLS — your ready tracks ship a direct
      // .wav in stream_url. Detect HLS by the .m3u8 extension, otherwise play the
      // file directly through <audio> (no hls.js, which would fail on a wav).
      const srcUrl = t.stream_url || t.wav_url || t.analysis_url || null;
      if (!srcUrl) throw new Error('No playable audio source for this track');
      const isHls = /\.m3u8(\?|$)/i.test(srcUrl);
      const dur = t.duration_seconds || t.chart.duration;
      const player = new LivePlayer(srcUrl, dur, isHls);
      const meta = { title: t.title, artist: t.artist_credit_name || t.artist_name, genre: t.genre, artwork: t.artwork_url };
      const playToken = t.play_token || null;

      return {
        beats: t.chart.beats,
        duration: t.duration_seconds || t.chart.duration,
        player, meta, live: true, trackId, playToken,
        submit: async (results) => {
          if (!playToken) return { error: 'not-authed' }; // unscored (no session / not ready)
          const payload = {
            track_id: trackId,
            difficulty: results.difficulty,
            score: results.score,
            accuracy: results.accuracy,      // 0..1
            max_combo: results.max_combo,
            notes_hit: results.notes_hit,
            notes_total: results.notes_total,
            play_token: playToken,
            pack_id: packId,                 // 50/50 payout reconciliation (null = freeplay)
          };
          const out = await api('/plays', { method: 'POST', body: payload, auth: true });
          let board = [];
          try { board = lbRows(await api('/leaderboard/' + trackId + '?difficulty=' + results.difficulty + '&limit=10')); }
          catch (e) { /* leaderboard optional */ }
          return { rank_global: out.rank_global, leaderboard: board };
        },
      };
    };
  }

  // ===========================================================================
  // Catalog data
  // ===========================================================================
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function cleanGenre(g) { return (!g || String(g).toLowerCase() === 'none') ? '' : g; }
  function fmtDur(s) {
    if (!s) return '';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // ---------- deterministic hash (stable per id, for covers + seeded grades) ----
  function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }

  // ---------- 1000-song MOCK catalog (preview / when live catalog is small) -----
  // Mirrors the real API shape so the design is fully stress-tested at scale; the
  // moment the backend backfill lands, live data takes over with zero UI changes.
  const GENRES = ['Lo-Fi', 'Synthwave', 'Phonk', 'Trap', 'Hyperpop', 'Drum & Bass', 'Ambient', 'House', 'Future Bass', 'Metal', 'R&B', 'Drill', 'Vaporwave', 'Techno', 'Cinematic', 'Pop'];
  const ARTISTS = [
    'Kunin Kitsune', 'Neon Oracle', 'VØID Signal', 'Crimson Halo', 'Aria Vale', 'Ghost Frequency', 'Lunar Kid', 'Static Saint', 'Phantom Bloom', 'Wired Wolf',
    'Echo Mortis', 'Velvet Circuit', 'Astral Drift', 'Kohl', 'Saber Tooth', 'Midnight Tape', 'Hollow Sun', 'Feral Synth', 'Golden Reaper', 'Liquid Mirage',
    'Zephyr', 'Cyber Geisha', 'Molten Choir', 'Frostbyte', 'Sacred Noise', 'Burning Doll', 'Glass Wren', 'Iron Lotus', 'Neon Temple', 'Pale Engine',
    'Dusk Protocol', 'Ruby Static', 'Hex Moon', 'Vapor Saint', 'Onyx Pulse', 'Silk Reactor', 'Ash Maiden', 'Chrome Coyote', 'Blood Orange Sky', 'Tidal Ghost',
    'Quartz Rebel', 'Seraph Bit', 'Nova Husk', 'Riot Lullaby',
  ];
  const TW_A = ['Crimson', 'Lunar', 'Velvet', 'Phantom', 'Neon', 'Hollow', 'Astral', 'Broken', 'Midnight', 'Static', 'Golden', 'Frozen', 'Savage', 'Electric', 'Sacred', 'Liquid', 'Wired', 'Crystal', 'Burning', 'Silent', 'Cyber', 'Feral', 'Ghost', 'Molten', 'Scarlet', 'Hyper', 'Endless', 'Violet'];
  const TW_B = ['Waves', 'Moon', 'Pulse', 'Dreams', 'Echo', 'Bloom', 'Circuit', 'Requiem', 'Mirage', 'Anthem', 'Voltage', 'Horizon', 'Ritual', 'Halo', 'Rift', 'Tides', 'Engine', 'Reverie', 'Fang', 'Sky', 'Drift', 'Oath', 'Bass', 'Heart', 'Ghost', 'Fire', 'Signal', 'Bones'];
  const GRADES = ['S', 'A', 'B', 'C', 'D'];

  function buildMockCatalog(n) {
    const now = Date.now();
    const out = [];
    // demo track first — real audio, always playable in preview
    out.push({ id: 'demo', title: 'Lunar Waves', artist_name: 'Kunin Kitsune', genre: 'Synthwave', bpm: 120, duration_seconds: 184, demo: true, created_at: now, play_count: 9999, featured: true, has_chart: true, chart_status: 'ready' });
    for (let i = 0; i < n; i++) {
      const h = hashStr('rrtrk' + i);
      const a = TW_A[h % TW_A.length];
      const b = TW_B[(h >>> 5) % TW_B.length];
      const title = (h % 7 === 0) ? a : (a + ' ' + b);
      const artist = ARTISTS[(h >>> 3) % ARTISTS.length];
      const genre = GENRES[(h >>> 7) % GENRES.length];
      const bpm = 80 + (h % 96);
      const dur = 120 + ((h >>> 4) % 165);
      const ageDays = (h >>> 9) % 400;
      const t = {
        id: 'm' + i, title, artist_name: artist, genre, bpm,
        duration_seconds: dur,
        created_at: now - ageDays * 86400000,
        play_count: Math.floor(((h >>> 11) % 1000) * (1 + ((h >>> 2) % 9))),
        featured: (h % 53 === 0),
      };
      // simulate the live backfill: most ready, some still processing, a few failed
      const r = h % 100;
      t.chart_status = r < 66 ? 'ready' : r < 85 ? 'analyzing' : r < 97 ? 'pending' : 'failed';
      t.has_chart = t.chart_status === 'ready';
      // seed a best-grade on ~30% of READY tracks so the mastery UI shows variety
      if (t.has_chart && h % 10 < 4) {
        const g = GRADES[(h >>> 13) % GRADES.length];
        t._mockBest = { grade: g, score: 40000 + (h % 600000), accuracy: 0.6 + ((h >>> 6) % 40) / 100, difficulty: ['easy', 'medium', 'hard'][(h >>> 8) % 3] };
      }
      out.push(t);
    }
    return out;
  }

  let catalogLive = false;
  let catalogTracks = [];
  let catalogRawCount = 0;       // total returned (incl. not-yet-ready), for display

  async function loadCatalog() {
    const forceMock = /[?&]mock=1/.test(location.search);
    if (API_BASE && !forceMock) {
      try {
        // pull the whole library in pages (scale-ready — up to ~12k tracks)
        let all = [], page = 0, LIMIT = 200;
        for (; page < 60; page++) {
          const list = await api('/tracks?limit=' + LIMIT + '&offset=' + (page * LIMIT));
          if (!list || !list.length) break;
          all = all.concat(list);
          if (list.length < LIMIT) break;
        }
        if (all.length) {
          all.forEach(t => {
            if (!t) return;
            // some rows pack the description into the title field — keep just the first line
            if (t.title) t.title = String(t.title).split('\n')[0].trim().slice(0, 80);
            // created_at arrives as an ISO string (live) or ms number (mock) — unify to ms
            // so "New"/fresh-upload sorting works and a just-uploaded track surfaces first
            t.created_at = (+new Date(t.created_at)) || 0;
          });
          catalogRawCount = all.length;
          // ONLY show songs that actually play — no dead taps, ever.
          catalogTracks = all.filter(trackReady);
          catalogLive = true;
          return;
        }
      } catch (e) { console.warn('catalog fetch failed → preview catalog', e); }
    }
    catalogLive = false;
    const mock = buildMockCatalog(1000);
    catalogRawCount = mock.length;
    catalogTracks = mock.filter(trackReady);   // preview also shows only playable
  }

  // re-fetch the catalog (the library grows constantly on the platform)
  let reloading = false;
  async function reloadCatalog() {
    if (reloading) return;
    reloading = true;
    try { await loadCatalog(); renderHome(); }
    finally { reloading = false; }
  }

  // ---------- track readiness (no dead songs) ----------
  // A DIRECT, decodable audio file (NOT an HLS manifest) the browser can analyze + play.
  function trackAudioUrl(t) {
    if (!t) return null;
    const cands = [t.audio_url, t.wav_url, t.analysis_url, t.stream_url];
    for (let i = 0; i < cands.length; i++) {
      const u = cands[i];
      if (u && !/\.m3u8(\?|$)/i.test(u)) return u;   // skip HLS — can't decode it for charting
    }
    return null;
  }
  function hasServerChart(t) { return !!t && (t.chart_status === 'ready' || t.has_chart); }
  function trackReady(t) {
    if (!t) return false;
    if (t.demo) return true;
    if (hasServerChart(t)) return true;        // pre-baked chart → scored + leaderboard
    return !!trackAudioUrl(t);                 // else playable via in-browser charting (fast path)
  }
  function trackStatus(t) {
    if (!t) return 'pending';
    if (trackReady(t)) return 'ready';
    const s = t.chart_status;
    if (s === 'analyzing') return 'analyzing';
    if (s === 'failed') return 'failed';
    if (s === 'needs_wav') return 'needs_audio';
    return 'pending';
  }
  const STATUS_LABEL = { ready: 'Ready', analyzing: 'Analyzing…', pending: 'In queue', needs_audio: 'Needs audio', failed: 'Unavailable' };
  function statusLabel(s) { return STATUS_LABEL[s] || 'In queue'; }
  function readyCount() { return catalogTracks.length; }
  function rawCount() { return catalogRawCount; }

  // ---------- per-user best scores (localStorage now; API-backed later) --------
  function loadScores() { try { return JSON.parse(localStorage.getItem('rr_scores') || '{}'); } catch (e) { return {}; } }
  function gradeFor(acc) { return acc >= 0.97 ? 'S' : acc >= 0.9 ? 'A' : acc >= 0.8 ? 'B' : acc >= 0.65 ? 'C' : 'D'; }
  function getBest(trackId) {
    const s = loadScores(); let best = null;
    ['easy', 'medium', 'hard'].forEach(d => { const r = s[trackId + '|' + d]; if (r && (!best || r.score > best.score)) best = Object.assign({ difficulty: d }, r); });
    if (best) return best;
    const t = catalogTracks.find(x => x.id === trackId);
    return (t && t._mockBest) || null;
  }
  function saveBest(trackId, res) {
    if (!trackId || !res) return;
    try {
      const s = loadScores(); const key = trackId + '|' + res.difficulty;
      const grade = res.grade || gradeFor(res.accuracy || 0);
      const prev = s[key];
      if (!prev || res.score > prev.score) { s[key] = { grade, score: res.score, accuracy: res.accuracy }; localStorage.setItem('rr_scores', JSON.stringify(s)); }
    } catch (e) {}
  }
  let currentTrack = null;

  // ---------- catalog query helpers (consumed by the library UI) --------------
  function allTracks() { return catalogTracks; }
  function genreList() {
    const m = {};
    catalogTracks.forEach(t => { const g = cleanGenre(t.genre); if (g) m[g] = (m[g] || 0) + 1; });
    return Object.keys(m).sort().map(g => ({ name: g, count: m[g] }));
  }
  function artistList() {
    const m = {};
    catalogTracks.forEach(t => { const a = t.artist_name; if (a) m[a] = (m[a] || 0) + 1; });
    return Object.keys(m).sort().map(a => ({ name: a, count: m[a] }));
  }
  function byGenre(g) { return catalogTracks.filter(t => cleanGenre(t.genre) === g); }
  function byArtist(a) { return catalogTracks.filter(t => t.artist_name === a); }
  function search(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return catalogTracks;
    return catalogTracks.filter(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.artist_name || '').toLowerCase().includes(q) ||
      (cleanGenre(t.genre) || '').toLowerCase().includes(q));
  }
  function sortTracks(list, mode) {
    const a = list.slice();
    if (mode === 'az') a.sort((x, y) => (x.title || '').localeCompare(y.title || ''));
    else if (mode === 'new') a.sort((x, y) => (y.created_at || 0) - (x.created_at || 0));
    else if (mode === 'hot') a.sort((x, y) => (y.play_count || 0) - (x.play_count || 0));
    else if (mode === 'bpm') a.sort((x, y) => (x.bpm || 0) - (y.bpm || 0));
    return a;
  }
  function sections() {
    // ready tracks lead every rail so the jukebox always opens on something playable
    const readyFirst = (arr) => arr.slice().sort((x, y) => (trackReady(y) ? 1 : 0) - (trackReady(x) ? 1 : 0));
    const feat = catalogTracks.filter(t => t.featured && trackReady(t));
    const featured = readyFirst(feat.length ? feat : catalogTracks).slice(0, 24);
    const hot = readyFirst(sortTracks(catalogTracks, 'hot')).slice(0, 24);
    const fresh = readyFirst(sortTracks(catalogTracks, 'new')).slice(0, 24);
    const readyPool = catalogTracks.filter(trackReady);
    const shuffled = (readyPool.length ? readyPool : catalogTracks).slice().sort(() => Math.random() - 0.5).slice(0, 24);
    return { featured, hot, new: fresh, surprise: shuffled };
  }

  // ---------- preview player (short clip when a song is focused) ---------------
  let previewEl = null, previewToken = 0, previewTrackId = null, previewStart = 0;
  // ---------- preview spectrum tap (drives the live browse waveform) -----------
  // Route the preview <audio> through WebAudio so the song-select waveform reacts to
  // the ACTUAL audio (real FFT), not a faux animation. The AnalyserNode taps the
  // FULL-amplitude source (punchy visuals); a GainNode carries the audible signal at
  // a gentle level (so the fade works even on browsers that ignore element.volume once
  // an element is routed through WebAudio). Cross-origin FFT needs crossOrigin +
  // CORS — the same Supabase storage already serves CORS fetch+decode for charting,
  // and the demo asset is same-origin, so the tap is safe. Escape hatch:
  // ?notap=1 (or localStorage rr_notap=1) disables the tap → audio plays via element
  // volume and the waveform falls back to a gentle procedural idle.
  let previewAC = null, previewAnalyser = null, previewFreq = null, previewSrcNode = null, previewGain = null;
  const PREVIEW_TAP = (function () {
    try { if (/[?&]notap=1/.test(location.search)) return false; } catch (e) {}
    try { if (localStorage.getItem('rr_notap') === '1') return false; } catch (e) {}
    return true;
  })();
  function ensurePreviewTap() {
    if (!PREVIEW_TAP || previewSrcNode || !previewEl) return;
    try {
      previewAC = previewAC || new (window.AudioContext || window.webkitAudioContext)();
      previewAnalyser = previewAC.createAnalyser();
      previewAnalyser.fftSize = 256;                 // 128 frequency bins
      previewAnalyser.smoothingTimeConstant = 0.72;
      previewFreq = new Uint8Array(previewAnalyser.frequencyBinCount);
      previewSrcNode = previewAC.createMediaElementSource(previewEl);
      previewSrcNode.connect(previewAnalyser);       // tap (an analyser needs no output)
      previewGain = previewAC.createGain();
      previewGain.gain.value = 0;                     // audible level — faded in by preview()
      previewSrcNode.connect(previewGain);
      previewGain.connect(previewAC.destination);
    } catch (e) { previewAnalyser = null; previewFreq = null; previewSrcNode = null; previewGain = null; }
  }
  function previewTapped() { return !!(previewSrcNode && previewGain); }
  function setPreviewLevel(v) {
    if (previewTapped()) { try { previewGain.gain.value = v; } catch (e) {} }
    else if (previewEl) { try { previewEl.volume = v; } catch (e) {} }
  }
  // Copy the current frequency spectrum into `out` (Uint8Array). Returns true when
  // real audio is flowing (non-zero data) so the renderer reacts vs. idles.
  function previewSpectrum(out) {
    if (!previewAnalyser || !previewFreq) return false;
    previewAnalyser.getByteFrequencyData(previewFreq);
    let sum = 0; const n = out ? Math.min(out.length, previewFreq.length) : previewFreq.length;
    for (let i = 0; i < n; i++) { if (out) out[i] = previewFreq[i]; sum += previewFreq[i]; }
    return sum > 4;
  }
  function previewBinCount() { return previewAnalyser ? previewAnalyser.frequencyBinCount : 0; }
  function previewPlaying() { return !!(previewEl && !previewEl.paused && previewTrackId != null); }
  function stopPreview() {
    previewToken++;
    if (previewEl) { try { previewEl.pause(); } catch (e) {} }
    if (previewTrackId) { logUse(previewTrackId, 'preview', { duration_ms: Date.now() - previewStart }); previewTrackId = null; }
  }
  async function preview(track) {
    if (window.RhythmGame && window.RhythmGame.isMuted && window.RhythmGame.isMuted()) return;
    const tok = ++previewToken;
    if (!previewEl) {
      previewEl = new Audio(); previewEl.preload = 'none';
      if (PREVIEW_TAP) previewEl.crossOrigin = 'anonymous';   // required for FFT on cross-origin audio
      ensurePreviewTap();
    }
    try { previewEl.pause(); } catch (e) {}
    let src = 'assets/lunar-waves.mp3'; // mock/demo fallback
    if (catalogLive && track && track.id && track.id !== 'demo') {
      try { const t = await api('/track/' + track.id, { auth: true }); src = t.analysis_url || t.wav_url || t.stream_url || src; } catch (e) { return; }
    }
    if (tok !== previewToken) return;
    try {
      if (previewAC && previewAC.state === 'suspended') { try { await previewAC.resume(); } catch (e) {} }
      previewEl.src = src; previewEl.currentTime = 0;
      previewEl.volume = previewTapped() ? 1 : 0;     // tapped: in-graph gain controls level
      setPreviewLevel(0);
      await previewEl.play();
      previewTrackId = (track && track.id) || null; previewStart = Date.now();
      // gentle fade-in, auto-stop after ~10s
      let v = 0; const fade = setInterval(() => { if (tok !== previewToken) { clearInterval(fade); return; } v = Math.min(0.45, v + 0.05); setPreviewLevel(v); if (v >= 0.45) clearInterval(fade); }, 40);
      setTimeout(() => { if (tok === previewToken) stopPreview(); }, 10000);
    } catch (e) { /* autoplay may be blocked until a gesture — fine */ }
  }

  // delegate home rendering to the library module (jukebox.js)
  function renderHome() {
    if (window.RhythmLibrary) window.RhythmLibrary.render();
  }

  // ===========================================================================
  // SONG SHEET
  // ===========================================================================
  const sheet = $('song-sheet');

  function openSheet(track) {
    const artEl = $('sheet-art');
    if (track.artwork_url) {
      artEl.innerHTML = '<img src="' + escapeHtml(track.artwork_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" onerror="this.parentNode.textContent=\'♪\'" />';
    } else {
      artEl.textContent = '♪';
    }
    $('sheet-title').textContent = track.title;
    $('sheet-artist').textContent = track.artist_name || '';
    const moodOrGenre = track.mood || cleanGenre(track.genre);   // mood falls back to genre until populated
    const metaBits = [moodOrGenre, track.bpm ? track.bpm + ' BPM' : '', fmtDur(track.duration_seconds)].filter(Boolean).join('  ·  ');
    $('sheet-meta').textContent = metaBits;
    if (catalogLive && track.id && track.id !== 'demo') logUse(track.id, 'loaded');

    const liveTrack = catalogLive && track.id && track.id !== 'demo';
    const ready = trackReady(track);
    const status = trackStatus(track);

    const playBtn = $('play-btn');
    const playLabel = playBtn ? playBtn.querySelector('span') : null;
    if (!ready) {
      $('sheet-hint').textContent = status === 'failed'
        ? 'This track couldn\u2019t be processed for the game.'
        : 'This track is still being prepared for play \u2014 check back soon.';
      if (playBtn) { playBtn.disabled = true; playBtn.classList.add('not-ready'); }
      if (playLabel) playLabel.textContent = statusLabel(status);
    } else {
      $('sheet-hint').textContent = liveTrack
        ? 'Tap the lanes as the notes reach the bridge'
        : 'Preview audio \u2014 your real track streams on ReactivVibe';
      if (playBtn) { playBtn.disabled = false; playBtn.classList.remove('not-ready'); }
      if (playLabel) playLabel.textContent = 'Initiate the Signal';
    }

    // wire the play button (game.js #play-btn → _menuPlayHandler)
    window.RhythmGame.setMenuPlayHandler(() => {
      if (!trackReady(track)) return;          // hard guard: never start a dead song
      closeSheet();
      stopPreview();
      currentTrack = track;
      if (liveTrack && hasServerChart(track)) {
        window.RhythmGame.play(liveProvider(track.id));               // server chart → scored + leaderboard
      } else if (liveTrack && trackAudioUrl(track)) {
        window.RhythmGame.playUrl(trackAudioUrl(track), {            // fast path → chart in-browser
          title: track.title,
          artist: track.artist_credit_name || track.artist_name,
          genre: track.genre,
          artwork: track.artwork_url,
        });
      } else {
        window.RhythmGame.playDemo();
      }
    });

    sheet.classList.add('open');
  }
  function closeSheet() { sheet.classList.remove('open'); }

  // launch a track directly at the engine's current difficulty (used by the Levels picker — no sheet)
  function launchTrack(track) {
    if (!track || !trackReady(track)) return false;
    stopPreview();
    currentTrack = track;
    const liveTrack = catalogLive && track.id && track.id !== 'demo';
    if (liveTrack && hasServerChart(track)) {
      window.RhythmGame.play(liveProvider(track.id));
    } else if (liveTrack && trackAudioUrl(track)) {
      window.RhythmGame.playUrl(trackAudioUrl(track), {
        title: track.title, artist: track.artist_credit_name || track.artist_name, genre: track.genre, artwork: track.artwork_url,
      });
    } else {
      window.RhythmGame.playDemo();
    }
    return true;
  }

  if (sheet) {
    $('sheet-scrim').addEventListener('click', closeSheet);
    $('sheet-back').addEventListener('click', closeSheet);
  }

  // ---------- per-user career (lifetime aggregate stats; localStorage) ----------
  function loadCareer() { try { return JSON.parse(localStorage.getItem('rr_career') || '{}'); } catch (e) { return {}; } }
  function getCareer() {
    const c = loadCareer();
    return {
      runs: c.runs || 0, score: c.score || 0,
      notesHit: c.notesHit || 0, notesTotal: c.notesTotal || 0,
      bestCombo: c.bestCombo || 0, fullCombos: c.fullCombos || 0,
      grades: Object.assign({ S: 0, A: 0, B: 0, C: 0, D: 0 }, c.grades || {}),
      songs: c.songs || {}, firstPlay: c.firstPlay || 0, lastPlay: c.lastPlay || 0,
    };
  }
  const GRADE_ORDER = { D: 0, C: 1, B: 2, A: 3, S: 4 };

  // ---------- ALWAYS-on local recorder — called by the engine on EVERY completed run,
  // including in-browser-charted tracks that have no server submit (i.e. all live tracks
  // today). This is what makes the cover-art grade chips + the Career profile reflect your
  // real play instead of only the mock seed. Leaderboard submit (below) stays separate.
  function recordLocal(results) {
    if (!results) return;
    const grade = results.grade || gradeFor(results.accuracy || 0);
    // 1) lifetime career aggregate
    try {
      const c = loadCareer();
      c.runs = (c.runs || 0) + 1;
      c.score = (c.score || 0) + (results.score || 0);
      c.notesHit = (c.notesHit || 0) + (results.notes_hit || 0);
      c.notesTotal = (c.notesTotal || 0) + (results.notes_total || 0);
      c.bestCombo = Math.max(c.bestCombo || 0, results.max_combo || 0);
      if (results.full_combo) c.fullCombos = (c.fullCombos || 0) + 1;
      c.grades = c.grades || {}; c.grades[grade] = (c.grades[grade] || 0) + 1;
      if (currentTrack && currentTrack.id) { c.songs = c.songs || {}; c.songs[currentTrack.id] = (c.songs[currentTrack.id] || 0) + 1; }
      const now = Date.now();
      if (!c.firstPlay) c.firstPlay = now;
      c.lastPlay = now;
      localStorage.setItem('rr_career', JSON.stringify(c));
    } catch (e) {}
    // 2) per-song best + NEW BEST / GRADE UP badges (compare vs REAL saved scores, not the mock seed)
    if (currentTrack && currentTrack.id && results.score > 0) {
      let prevReal = null;
      try {
        const s = loadScores();
        ['easy', 'medium', 'hard'].forEach(d => { const r = s[currentTrack.id + '|' + d]; if (r && (!prevReal || r.score > prevReal.score)) prevReal = r; });
      } catch (e) {}
      const isNewBest = !prevReal || results.score > (prevReal.score || 0);
      const isGradeUp = !!prevReal && (GRADE_ORDER[grade] || 0) > (GRADE_ORDER[prevReal.grade] || 0);
      saveBest(currentTrack.id, results);
      const badges = document.getElementById('results-badges');
      if (badges) {
        if (isNewBest && !/new best/i.test(badges.textContent)) badges.insertAdjacentHTML('afterbegin', '<span class="rbadge best">New Best</span>');
        if (isGradeUp && !/grade up/i.test(badges.textContent)) badges.insertAdjacentHTML('afterbegin', '<span class="rbadge gradeup">Grade Up · ' + grade + '</span>');
      }
    }
    // --- account leaderboard: in-browser runs also submit to your ReactivVibe account (beta-grade).
    // Feeds the existing game_plays / game_leaderboard. Logged out -> sign-in nudge; backend absent -> silent.
    // Tight (GH) timing feel raises the multiplier ceiling above the server's score bound, so
    // Tight runs are LOCAL PRACTICE ONLY — recorded locally (above) but never submitted to /score.
    var _tightRun = false; try { _tightRun = !!(window.RhythmGame && window.RhythmGame.getTimingFeel && window.RhythmGame.getTimingFeel() === 'tight'); } catch (e) {}
    if (_tightRun && API_BASE && currentTrack && currentTrack.id !== 'demo' && results.score > 0 && !hasServerChart(currentTrack)) {
      onSubmitResult({ error: 'practice' }, results);
    } else if (API_BASE && currentTrack && currentTrack.id && currentTrack.id !== 'demo'
        && results.score > 0 && !hasServerChart(currentTrack)) {
      (async () => {
        const tk = await getToken();
        if (!tk) { onSubmitResult({ error: 'not-authed' }, results); return; }
        try {
          const out = await api('/score', { method: 'POST', auth: true, body: {
            track_id: currentTrack.id, difficulty: results.difficulty,
            score: results.score, accuracy: results.accuracy, max_combo: results.max_combo,
            notes_hit: results.notes_hit, notes_total: results.notes_total,
          } });
          let board = [];
          try { board = lbRows(await api('/leaderboard/' + currentTrack.id + '?difficulty=' + results.difficulty + '&limit=10')); } catch (e) {}
          onSubmitResult({ rank_global: out && out.rank_global, leaderboard: board }, results);
        } catch (e) { /* backend not live yet -> stay local-only (no regression) */ }
      })();
    }
  }

  // ---------- Leaderboard render (called by engine after a live server submit) ----------
  function onSubmitResult(out, results) {
    const wrap = $('results-leaderboard');
    if (!wrap) return;
    if (!out || out.error) {
      wrap.innerHTML = '<div class="lb-note">' +
        (out && out.error === 'not-authed'
          ? 'Sign in on ReactivVibe to save your score & climb the leaderboard.'
          : 'Local practice — scores aren\u2019t saved.') + '</div>';
      wrap.style.display = '';
      return;
    }
    const rows = (out.leaderboard || []).map((r) =>
      '<div class="lb-row">' +
        '<span class="lb-rank">#' + r.rank + '</span>' +
        '<span class="lb-name">' + escapeHtml(r.display_name || 'anon') + '</span>' +
        '<span class="lb-score">' + Number(r.score).toLocaleString() + '</span>' +
        '<span class="lb-acc">' + (r.accuracy * 100).toFixed(1) + '%</span>' +
      '</div>').join('');
    wrap.innerHTML =
      '<div class="lb-head"><span>Leaderboard' +
        (out.rank_global ? ' · you ranked #' + out.rank_global : '') +
      '</span></div>' + rows;
    wrap.style.display = '';
  }

  // Normalize a /leaderboard/:id response to a plain rows ARRAY. Backend returns { leaderboard:[…] };
  // tolerate a bare array or { rows:[…] } too, so a shape change never breaks the boards.
  function lbRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.leaderboard)) return resp.leaderboard;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
  }

  // ---------- read-only leaderboard fetchers (consumed by the Leaderboard overlay) ----------
  // Normalize to { rows:[{rank,display_name,score,accuracy}], youName }. Never throws — resolves
  // to { rows: [] } when the backend leaderboard isn't live yet, so the UI falls back to local.
  async function _myName() {
    try {
      if (!supa) return null;
      const { data } = await supa.auth.getUser();
      const u = data && data.user;
      if (!u) return null;
      return (u.user_metadata && (u.user_metadata.display_name || u.user_metadata.name)) || u.email || null;
    } catch (e) { return null; }
  }
  async function fetchLeaderboard(trackId, opts) {
    opts = opts || {};
    if (!API_BASE || !trackId) return { rows: [] };
    const qs = '?difficulty=' + encodeURIComponent(opts.difficulty || '') + '&limit=' + (opts.limit || 20);
    try {
      const rows = lbRows(await api('/leaderboard/' + trackId + qs));
      return { rows, youName: await _myName() };
    } catch (e) { return { rows: [] }; }   // backend dormant → caller shows local fallback
  }
  // Optional global board — only used if/when the backend exposes it. Degrades silently
  // (returns { rows: [] }) so the UI shows the local "you" card until the route exists.
  async function fetchGlobalLeaderboard(opts) {
    opts = opts || {};
    if (!API_BASE) return { rows: [] };
    try {
      const rows = lbRows(await api('/leaderboard/global?limit=' + (opts.limit || 20)));
      return { rows, youName: await _myName() };
    } catch (e) { return { rows: [] }; }
  }

  window.RhythmCatalog = {
    onSubmitResult, recordLocal, getCareer, liveProvider, openSheet, launchTrack,
    // identity + Sparks shell (UI reads these; real /sparks API later)
    getUser, onAuthChange, getSparks,
    // store / entitlements (LIVE: GET /store, GET /entitlements, POST /sparks/spend)
    getStore, getEntitlements, spendSparks, ownsItem, _entitlements,
    fetchLeaderboard, fetchGlobalLeaderboard,
    // data layer for the library UI (jukebox.js)
    allTracks, isLive: () => catalogLive, genreList, artistList, byGenre, byArtist,
    search, sortTracks, sections, getBest,
    preview, stopPreview,
    // live waveform feed (real FFT off the preview audio) — consumed by jukebox.js
    previewSpectrum, previewBinCount, previewPlaying,
    fmtDur, cleanGenre, escapeHtml, hashStr,
    // readiness (no dead songs)
    trackReady, trackStatus, statusLabel, readyCount, reloadCatalog,
    totalCount: () => catalogTracks.length, rawCount,
    // revenue attribution
    getPackId, logUse,
  };

  // ===========================================================================
  // BOOT
  // ===========================================================================
  async function boot() {
    if (!window.RhythmGame) { console.error('engine not loaded'); return; }
    await loadCatalog();
    renderHome();

    // deep link: /play?trackId=<uuid> → open that song's sheet directly
    const trackId = new URLSearchParams(location.search).get('trackId');
    if (trackId && API_BASE) {
      try {
        const t = await api('/track/' + trackId, { auth: true });
        openSheet({
          id: t.id, title: t.title, artist_name: t.artist_name, genre: t.genre,
          bpm: t.chart && t.chart.bpm, duration_seconds: t.duration_seconds, artwork_url: t.artwork_url,
        });
      } catch (e) { console.warn('deep-link track load failed', e); }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
