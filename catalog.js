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
      // build50: ONE shared client across catalog.js + multiplayer.js — avoids the "Multiple GoTrueClient
      // instances" warning (+ the undefined concurrent behavior it warns about under the same storage key).
      supa = window.__rrSupa || (window.__rrSupa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
        auth: { storage: window.localStorage, persistSession: true, autoRefreshToken: true },
      }));
    } catch (e) { console.warn('supabase init failed', e); }
  }

  // build115 p1 (playtest-4 auth-handshake fix): the SITE (reactivvibeai.com) and the GAME are served same-origin
  // from the SAME Supabase project (confirmed: site's src/integrations/supabase/client.ts uses plain localStorage,
  // default storageKey, project ref bxiejoktoknybpraxebm — byte-identical to CFG.SUPABASE_URL). So a signed-in site
  // session is ALREADY sitting in localStorage under 'sb-bxiejoktoknybpraxebm-auth-token' when /game loads — but
  // supabase-js does NOT auto-adopt an externally-written localStorage blob into its in-memory client on its own
  // in every load order/timing; this helper explicitly reads it and calls setSession() so getUser()/getToken()/
  // onAuthChange all agree with what the site already knows. Runs ONCE at boot, before refreshAdmin()/first getUser().
  // Idempotent: setSession() on an already-current session just re-confirms it (onAuthStateChange fires but our
  // listeners are no-ops/idempotent themselves — no loop). Guarded end-to-end: a malformed/missing token must
  // never throw and never block boot.
  var _adoptedSiteSession = false;
  async function _adoptSiteSession() {
    if (_adoptedSiteSession) return false;   // idempotent — only try once per page load
    _adoptedSiteSession = true;
    if (!supa) return false;
    try {
      // already has a live in-memory session? nothing to adopt.
      try {
        var cur = await supa.auth.getSession();
        if (cur && cur.data && cur.data.session && cur.data.session.access_token) return false;
      } catch (e) {}

      var raw = null;
      // (a) exact key derived from CFG.SUPABASE_URL's project ref
      try {
        var m = (CFG.SUPABASE_URL || '').match(/https?:\/\/([a-z0-9]+)\.supabase/i);
        if (m) raw = window.localStorage.getItem('sb-' + m[1] + '-auth-token');
      } catch (e) {}
      // (a-robust) fall back: scan for ANY sb-*-auth-token key (covers a ref mismatch/legacy key)
      if (!raw) {
        try {
          for (var i = 0; i < window.localStorage.length; i++) {
            var k = window.localStorage.key(i);
            if (k && /^sb-.*-auth-token$/.test(k)) { var v = window.localStorage.getItem(k); if (v) { raw = v; break; } }
          }
        } catch (e) {}
      }
      if (!raw) return false;

      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { return false; }   // malformed JSON — bail quietly
      if (!parsed) return false;
      var access_token = parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token);
      var refresh_token = parsed.refresh_token || (parsed.currentSession && parsed.currentSession.refresh_token);
      if (!access_token || !refresh_token) return false;   // need both for setSession

      try {
        var _r = await supa.auth.setSession({ access_token: access_token, refresh_token: refresh_token });
        // build115 review diagnostic: supabase-js SHOULD auto-recover a same-origin/default-storageKey session, so
        // this manual adopt is belt-and-suspenders — but the live "shows guest" symptom means the boot-time session
        // read is somehow missing it. Log ONE line so a real signed-in-on-site playtest reveals whether adopt actually
        // ran + whether setSession accepted the token (a rejected refresh_token resolves with .error, not a throw).
        console.info('[rr-auth] adopted site session from localStorage', (_r && _r.error) ? ('(rejected: ' + _r.error.message + ')') : '(ok)');
        return !(_r && _r.error);
      } catch (e) { console.warn('rr: site-session adopt failed', e); return false; }
    } catch (e) { return false; }   // never let a bad token block boot
  }

  async function getToken() {
    if (!supa) return null;
    try { await _adoptSiteSession(); } catch (e) {}   // build115 p1: adopt the site's localStorage session before the first real read
    try {
      const { data } = await supa.auth.getSession();
      return data && data.session ? data.session.access_token : null;
    } catch (e) { return null; }
  }

  // ---------- identity + Sparks shell seams (read-only; real /sparks API later) ----------
  // ONE source of truth for "who is signed in" — reads the SHARED website supabase-js session
  // (same client `supa` used by getToken). Stays null/guest when supabase-js or config absent.
  async function getUser() {
    // build100m (auth-hardening): the LOCAL Supabase session is the SOURCE OF TRUTH for "is someone signed in" — a local
    // read (getSession), NO network + NO CORS dependency. /me only ENRICHES with the site profile (display_name + avatar);
    // it must NEVER demote a valid local session to "logged out". The OLD code returned null on /me {user:null} or any
    // /me hiccup → a logged-in owner showed as a GUEST when /me had a CORS issue or didn't recognize the token. No local
    // session → genuinely logged out. (The server still validates the JWT on every authed call — this is just identity.)
    if (!supa) return null;
    try { await _adoptSiteSession(); } catch (e) {}   // build115 p1: adopt the site's localStorage session before the first real read
    let su = null;
    try { const { data } = await supa.auth.getSession(); su = data && data.session && data.session.user; } catch (e) {}
    if (!su) return null;   // no local session → logged out
    if (API_BASE) {         // enrich from the site profile when reachable (best display name + avatar)
      try {
        const out = await api('/me', { auth: true });
        if (out && out.user && out.user.id) return { id: out.user.id, name: out.user.display_name || 'Player', email: out.user.email || null, avatar_url: out.user.avatar_url || null };
      } catch (e) { /* CORS/backend hiccup → fall through to the local session's own user (still signed in) */ }
    }
    const m = su.user_metadata || {};
    const name = m.display_name || m.full_name || m.name
      || (su.email ? su.email.split('@')[0] : null) || 'Player';
    return { id: su.id, name: name, email: su.email || null, avatar_url: m.avatar_url || null };
  }

  // ---------- ADMIN identity (full access for the owner; everyone else stays gated) ----------
  // Keyed on the AUTHENTICATED session email (a signed Supabase JWT via getUser) — NOT a query param or a localStorage
  // flag — so a normal user can't spoof it without actually logging in as one of these accounts. Admin ⇒ owns everything
  // (all paid levels/skins), every campaign tier unlocked, multiplayer open: for pre-ship testing on the live site.
  // Normal users keep the real gating (log in, earn ranks, purchase). This is NOT the dev (?dev=1/localhost) path.
  const ADMIN_EMAILS = ['reactivvibeai@gmail.com'];   // owner/tester accounts — add more here as needed
  let _isAdmin = false;
  function isAdmin() { return _isAdmin; }
  async function refreshAdmin() {
    try {
      const u = await getUser();
      const em = (u && u.email ? String(u.email) : '').trim().toLowerCase();
      _isAdmin = !!em && ADMIN_EMAILS.indexOf(em) >= 0;
      // build119 p1: opportunistic drain of any queued reports (offline/failed submitReport calls) — only
      // worth trying once we know someone is actually signed in (the POST is authed either way). Fire-and-forget:
      // flushReportsQueue is itself fully guarded and never throws, so this can't affect admin resolution above.
      if (u) { try { flushReportsQueue(); } catch (e) {} try { flushRatingsQueue(); } catch (e) {} }   // D1: same opportunistic drain for the rr_ratings_queue (mirror of the reports drain)
    } catch (e) { _isAdmin = false; }
    return _isAdmin;
  }
  refreshAdmin();   // populate ASAP; index.html re-drives it on auth change for live login/logout
  // build184: prime the ENTITLEMENTS cache at boot + keep it fresh on login/logout. ownsItem() reads a cache
  // that was only ever filled inside the Store IIFE — so until the player happened to open the Store, every
  // server-purchased item read UNOWNED, and the locked-item click paths (campaign paid cards, profile loadout
  // tiles) routed clicks to the Store ("anything I click sends me to the shop" — live user report 2026-07-11).
  // Delay lets the shared site session hydrate; the auth-change re-prime covers slow restores + real logins.
  try { setTimeout(function () { try { getEntitlements(); } catch (e) {} }, 1200); } catch (e) {}
  try { onAuthChange(function () { try { getEntitlements(); } catch (e) {} }); } catch (e) {}
  // build59: localhost is a full-access DEV context (the builder testing locally). Treat it as owning everything so the STORE
  // + every ownsItem-based gate (equip, launch checks) match the campaign grid, which already unlocks paid levels via ||DEV.
  // WITHOUT this, on localhost a paid level shows OWNED in the campaign but "Buy" in the store (ownsItem=false).
  // build66 SECURITY (launch-audit P1): LOCALHOST-ONLY. The old `?dev=1 OR localhost` let /play?dev=1 unlock every paid level
  // + premium skin in PRODUCTION — a regression: index.html's DEV was hardened localhost-only in build65, this copy was missed.
  // Owner testing in prod uses the AUTHENTICATED ADMIN path, not a URL flag. Keep in sync with index.html's DEV + MP_DEV.
  function _isDevUnlock() {
    try {
      if (/[?&]asplayer=1/.test(location.search)) return false;   // build60: "Simulate fresh player" — no dev unlock, even on localhost
      return /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
    } catch (e) { return false; }
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

  // ===========================================================================
  // BONUS SPARKS — platform-only SOFT currency (the ONLY thing gameplay awards).
  // ---------------------------------------------------------------------------
  // CRITICAL: this is NOT the cashable Sparks balance above. Cashable Sparks
  // (getSparks / spendSparks / 'rr_sparks' / the /sparks/* API) is REAL MONEY and
  // gameplay must NEVER mint it — that would be an abuse/fraud vector. Bonus Sparks
  // are earned by play and spent ONLY on cosmetics; they can never be cashed out.
  // They live in a SEPARATE localStorage key ('rr_bonus_sparks') and have their own
  // function family below. Keep them clearly separate from the cashable family.
  //
  // ▼▼▼ SWAP-SEAM ▼▼▼ — when the Lovable platform exposes a real Bonus-Sparks balance
  // endpoint, replace these localStorage reads/writes with the API calls (e.g.
  // GET /bonus-sparks/balance, POST /bonus-sparks/award, POST /bonus-sparks/spend).
  // The function signatures (getBonusSparks / awardBonusSparks / spendBonusSparks)
  // STAY THE SAME so callers (the earn loop + future cosmetic spend) don't change.
  // Until then this is purely client-side and never hits the network.
  // ▲▲▲ SWAP-SEAM ▲▲▲
  // ===========================================================================
  const BONUS_SPARKS_KEY = 'rr_bonus_sparks';
  const BONUS_AWARD_CAP = 5000;   // sanity cap on a SINGLE award, guards against a runaway grant
  function loadBonusSparks() {
    try { const v = parseInt(localStorage.getItem(BONUS_SPARKS_KEY) || '0', 10); return isNaN(v) || v < 0 ? 0 : v; }
    catch (e) { return 0; }
  }
  function saveBonusSparks(n) { try { localStorage.setItem(BONUS_SPARKS_KEY, String(Math.max(0, n | 0))); } catch (e) {} }
  // current integer balance.
  function getBonusSparks() { return (bonusServerReady() && _bonusSrvBal != null) ? _bonusSrvBal : loadBonusSparks(); }   // build100h: server cache when authoritative, else local
  // add max(0, floor(n)) (clamped to BONUS_AWARD_CAP) to the balance; persists; returns the new balance.
  // No-op for n<=0. `reason` is for future telemetry / the swap-seam API body — unused locally.
  function awardBonusSparks(n, reason) {
    const add = Math.min(BONUS_AWARD_CAP, Math.max(0, Math.floor(Number(n) || 0)));
    if (add <= 0) return loadBonusSparks();
    const bal = loadBonusSparks() + add;
    saveBonusSparks(bal);
    return bal;
  }
  // ── Bonus Sparks WEEKLY EARN CAP (build73 — owner economy rebalance) ─────────────────────────────
  // Bonus Sparks are spendable on the WEBSITE (song skips / boosts — the real revenue), so gameplay must NOT
  // flood them. The faucet is now tiny (a small per-run grade reward) AND hard-capped per ISO week, so even the
  // best grinder tops out near BONUS_WEEKLY_CAP/week. Client-side for the beta (same trust model as the rest of
  // Bonus — a modded client can still mint); move this server-side with the balance via the swap-seam before
  // Bonus has real economic weight. Tune the ceiling here.
  var BONUS_WEEKLY_CAP = 50;
  function _isoWeekKey() {
    var d = new Date(); var day = (d.getUTCDay() + 6) % 7;
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
    var w1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    var wk = 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7);
    return t.getUTCFullYear() + '-W' + wk;
  }
  function _bonusWeek() { try { var o = JSON.parse(localStorage.getItem('rr_bonus_week') || '{}'); if (o.wk !== _isoWeekKey()) o = { wk: _isoWeekKey(), earned: 0 }; return o; } catch (e) { return { wk: _isoWeekKey(), earned: 0 }; } }
  function bonusWeekRemaining() { return Math.max(0, BONUS_WEEKLY_CAP - (_bonusWeek().earned || 0)); }
  function _bonusWeekAdd(n) { try { var o = _bonusWeek(); o.earned = (o.earned || 0) + Math.max(0, Math.floor(n)); localStorage.setItem('rr_bonus_week', JSON.stringify(o)); } catch (e) {} }
  // cosmetic spend. Deducts only if affordable.
  function spendBonusSparks(n) {
    const cost = Math.max(0, Math.floor(Number(n) || 0));
    const bal = loadBonusSparks();
    if (bal >= cost) { const next = bal - cost; saveBonusSparks(next); return { ok: true, balance: next }; }
    return { ok: false, balance: bal };
  }
  // Local BONUS-purchased entitlements. Cashable-Sparks buys grant a SERVER entitlement via
  // spendSparks; Bonus buys are client-side (the swap-seam backend isn't live), so their
  // FREE community unlocks — owned by EVERYONE, no purchase / no backend (the store renders "Equip", the loadout lists it). Key = "item_type:item_id".
  var FREE_ITEMS = { 'skin:celines_razor': 1 };   // CelinesRazor × Dion guitar — gifted to the community
  // ownership lives here and ownsItem() checks it too. Key 'rr_bonus_owns' = ["skin:deadkin", …].
  function loadBonusOwns() {
    try { const a = JSON.parse(localStorage.getItem('rr_bonus_owns') || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveBonusOwns(a) { try { localStorage.setItem('rr_bonus_owns', JSON.stringify(a)); } catch (e) {} }
  function getBonusOwns() { return loadBonusOwns().slice(); }
  // buy a cosmetic with EARNED Bonus Sparks. ASYNC (build100i): when BONUS_SERVER + signed in, the debit is
  // SERVER-authoritative (POST /bonus-sparks/spend) so it matches the server-authoritative balance — otherwise a
  // signed-in user's balance (read from the server) would never drop. Signed-out / flag-off → the local debit. Grants
  // local ownership on success either way (the game's Bonus cosmetics list reads rr_bonus_owns).
  async function bonusBuy(item_type, item_id, price) {
    const cost = Math.max(0, Math.floor(Number(price) || 0));
    const key = String(item_type) + ':' + String(item_id);
    const owns = loadBonusOwns();
    // launch-hardening: dedup slug-insensitively (hyphen==underscore) — matches ownsItem()'s normalization so an id-form
    // drift ('deadkin' vs a hyphenated variant) can't slip past the owned-check and DOUBLE-CHARGE Bonus Sparks for an
    // item the player already has. Exact indexOf would miss the alternate form and debit a second time.
    const _nmk = String(item_type) + ':' + String(item_id).replace(/-/g, '_');
    if (owns.some(function (k) { return k === key || String(k).replace(/-/g, '_') === _nmk; })) return { ok: true, deduped: true, balance: getBonusSparks() };
    if (bonusServerReady()) {
      const sr = await _bonusSrvSpend(item_type, item_id, cost);
      if (!sr || !sr.ok) return { ok: false, error: (sr && sr.error) || 'spend_failed', balance: getBonusSparks() };
      owns.push(key); saveBonusOwns(owns);
      return { ok: true, deduped: !!sr.deduped, balance: (sr.balance != null ? sr.balance : getBonusSparks()) };
    }
    const res = spendBonusSparks(cost);
    if (!res.ok) return { ok: false, error: 'insufficient_bonus', balance: res.balance };
    owns.push(key); saveBonusOwns(owns);
    return { ok: true, balance: res.balance };
  }

  // ── build100h — SERVER Bonus-Sparks seam (Lovable /bonus-sparks/{balance,earn,spend} on game-catalog) ───────────
  // Authed via the SAME Supabase-session pattern as spendSparks (api(path,{auth:true}) → Bearer <jwt>). GATED by
  // RHYTHM_CONFIG.BONUS_SERVER === true — DEFAULT OFF until the route contracts are confirmed. When ON + signed in the
  // SERVER is authoritative (computes the award + 50/ISO-week cap + holds the balance); logged-out / OFF falls back to
  // the client-side rr_bonus_sparks path above (the live game today). CONTRACT shapes below are best-effort — confirm
  // with Lovable, then set BONUS_SERVER:true to flip it on (one edit; no other code change needed).
  var _bonusSrvBal = null;   // cached authoritative balance for synchronous getBonusSparks() reads
  function bonusServerOn() { try { return !!(window.RHYTHM_CONFIG && window.RHYTHM_CONFIG.BONUS_SERVER) && !!API_BASE; } catch (e) { return false; } }
  function bonusServerReady() { return bonusServerOn() && !!(_entitlements && _entitlements.signed_in); }
  async function _bonusSrvBalance() {
    if (!bonusServerOn()) return null;
    try { var out = await api('/bonus-sparks/balance', { auth: true }); if (out && typeof out.balance === 'number') _bonusSrvBal = out.balance; } catch (e) {}
    return _bonusSrvBal;
  }
  async function _bonusSrvEarn(payload) {
    // CONTRACT (Lovable, build100i — LIVE): POST /bonus-sparks/earn { play_id, daily_rift } → the server fetches the
    // game_plays row BY play_id (no play_token needed), computes the grade reward (S=4 A=3 B=2 C=1 D=0, +1 full-combo),
    // TRIPLES it on a server-VALIDATED daily_rift, clamps to the 50/ISO-week cap, idempotent per run →
    // { balance, earned, capped, grade, full_combo, reason }. Server-authoritative — the game sends NO amount.
    try { var out = await api('/bonus-sparks/earn', { method: 'POST', body: payload, auth: true });
      if (out && typeof out.balance === 'number') _bonusSrvBal = out.balance;
      return { earned: (out && +out.earned) || 0, balance: out && out.balance, capped: !!(out && out.capped), reason: out && out.reason };
    } catch (e) { return null; }
  }
  async function _bonusSrvSpend(item_type, item_id, amount) {
    // CONTRACT (confirm): POST /bonus-sparks/spend { item_type, item_id, amount } → { ok, balance, deduped } (server
    // enforces the cosmetics-only whitelist + debit). Wiring bonusBuy() to this needs the store's buyBonus caller made
    // async — deferred until the contract lands (the helper is ready).
    try { var out = await api('/bonus-sparks/spend', { method: 'POST', body: { item_type: item_type, item_id: item_id, amount: amount }, auth: true });
      if (out && typeof out.balance === 'number') _bonusSrvBal = out.balance;
      return { ok: !!(out && out.ok), balance: out && out.balance, deduped: !!(out && out.deduped) };
    } catch (e) { var m = String((e && e.message) || ''); return { ok: false, error: /\b402\b|insufficient/i.test(m) ? 'insufficient_bonus' : 'spend_failed' }; }
  }

  // build100i: server-authoritative Bonus EARN for a completed, SUBMITTED run. Called by the /score + /plays success
  // handlers once the canonical play_id is known (Lovable: both return { id, play_id }). Threads play_id + the client's
  // daily_rift intent into POST /bonus-sparks/earn; the SERVER validates the daily claim + computes the award. Gated on
  // BONUS_SERVER + signed-in; otherwise the local capped mint in recordLocal handles it. Renders the "+N BONUS SPARKS"
  // results line async and stamps the Daily Rift done ONLY when the SERVER actually granted the ×3 (reason==='daily_rift').
  function _bonusEarnForRun(playId, results, dailyRift) {
    try {
      if (!bonusServerReady() || !playId) return;
      _bonusSrvEarn({ play_id: playId, daily_rift: !!dailyRift }).then(function (r) {
        if (!r) return;
        if (r.earned > 0) {
          if (results) { try { results._bonusAwarded = r.earned; results._bonusBalance = r.balance; results._dailyRiftX3 = (r.reason === 'daily_rift'); } catch (e) {} }
          try { renderBonusSparksLine(r.earned, r.balance); } catch (e) {}
        }
        if (r.reason === 'daily_rift') { try { localStorage.setItem('rr_dailyrift', JSON.stringify({ date: dailyRiftToday(), done: true })); } catch (e) {} }
      });
    } catch (e) {}
  }

  // ===========================================================================
  // RHYTHM WAGER (build66) — host-run tournament PRIZE POOLS: an entry-fee pool (winner takes
  // the pot) and a parimutuel SIDE-BET (pickers split the pot). The host picks the mode + buy-in.
  // ---------------------------------------------------------------------------
  // ▓▓▓ OWNER DECISION — 2026-06-22: BONUS SPARKS ONLY. CASHABLE WAGERING IS OFF THE TABLE. ▓▓▓
  // The owner decided wager tournaments run PERMANENTLY on BONUS Sparks (platform-only, NON-CASHABLE
  // in-game points earned by play). There is NO real-money path and we are not building one. Why this
  // is clean: gambling needs prize-of-value + chance + consideration TOGETHER. Bonus Sparks can never
  // be converted to cash, so there is NO money prize — this is a skill points-competition (like XP /
  // leaderboard points), not gambling. Keep it that way: NEVER let Bonus Sparks become cashable, and
  // NEVER route a wager through cashable Sparks. (A quick attorney sign-off on the Bonus-only model is
  // still worth getting for total comfort — see WAGER_BACKEND_BRIEF.md.)
  //
  // This runs ENTIRELY on a LOCAL Bonus stand-in so the full UI + pool LOGIC works + is testable TODAY.
  // The function SIGNATURES double as a backend swap-seam: if the platform ever wants the pot escrowed
  // SERVER-SIDE (still Bonus, just authoritative across clients), the backend can expose join/settle/
  // refund and we read balances back — we never compute a cashable delta locally. Re-enabling a CASHABLE
  // currency is deliberately NOT a flag flip — it would be a full regulated-operator buildout (server
  // escrow + server-authoritative scoring + KYC/geo + legal + a high-risk processor) and is OUT OF SCOPE.
  //
  // ▓▓ HARD RULES (load-bearing) ▓▓
  //  1. The client NEVER moves CASHABLE Sparks. A currency:'sparks' call is ALWAYS REFUSED, period.
  //  2. Bonus Sparks are non-cashable and must STAY non-cashable — that is the entire legal basis.
  //  3. LOCAL MODEL: each client moves ONLY ITS OWN Bonus balance — it debits its own buy-in on join,
  //     and only the CHAMPION's client credits the pot on settle (each non-winner simply loses its
  //     stake). This mirrors exactly how a server-side Bonus escrow would net out per-account.
  // ===========================================================================
  var WAGER_SERVER_MODE = 'local';   // 'local' (Bonus stand-in) | 'server' (Bonus escrow API, optional). Cashable is NOT a mode.
  var WAGER_MAX_BUYIN = 100000;      // sanity clamp on a single buy-in/bet (Bonus). Raised from 5000 (build66) — Bonus is non-cashable AND wagerCanStake already clamps to the player's actual balance, so a big pot is harmless + fun.
  function _wagerPools() { try { return JSON.parse(localStorage.getItem('rr_wager_pools') || '{}'); } catch (e) { return {}; } }
  function _saveWagerPools(p) { try { localStorage.setItem('rr_wager_pools', JSON.stringify(p)); } catch (e) {} }
  // credit the FULL amount to the local Bonus balance (a pot can exceed the per-award cap; this is
  // entrant-funded REDISTRIBUTION of already-debited stakes, not a free grant — so chunk past the cap).
  function _wagerCredit(n, reason) {
    var left = Math.max(0, Math.floor(Number(n) || 0));
    while (left > 0) { awardBonusSparks(Math.min(left, BONUS_AWARD_CAP), reason); left -= BONUS_AWARD_CAP; }
    return getBonusSparks();
  }
  // EVERY pool is forced to BONUS — cashable wagering is off the table by owner decision, so 'sparks' is
  // never honored regardless of WAGER_SERVER_MODE. (Even a future server mode is a Bonus escrow, not cash.)
  function _wagerForceBonus(currency) { return 'bonus'; }
  // can the local player stake `amount` of `currency`? Bonus only — a cashable 'sparks' stake is never allowed.
  function wagerCanStake(amount, currency) {
    amount = Math.max(0, Math.floor(Number(amount) || 0));
    if (currency === 'sparks') return false;   // cashable wagering not supported — Bonus Sparks only
    return getBonusSparks() >= amount;
  }
  // host opens an escrow pool for a tournament. Returns {potId,...}. Local: a record in rr_wager_pools.
  function wagerOpenPool(tournamentId, buyIn, currency, opts) {
    currency = _wagerForceBonus(currency);
    buyIn = Math.max(1, Math.min(WAGER_MAX_BUYIN, Math.floor(Number(buyIn) || 0)));
    var potId = 'pool_' + String(tournamentId || rrUuid());
    var pools = _wagerPools(), rake = Math.max(0, Math.min(0.4, (opts && +opts.rake) || 0)), mode = (opts && opts.mode) || 'pool';
    var p = pools[potId];
    if (!p) {
      p = pools[potId] = { potId: potId, tournamentId: tournamentId, mode: mode, buyIn: buyIn, currency: currency, rake: rake, paid: {}, bets: {}, pot: 0, state: 'open' };
      _saveWagerPools(pools);
    } else if (p.state === 'open' && !Object.keys(p.paid).length && !Object.keys(p.bets).length) {
      // host is still configuring + nobody has staked yet → safe to update the buy-in/mode (locks the moment the first entry lands)
      p.buyIn = buyIn; p.mode = mode; p.currency = currency; p.rake = rake; _saveWagerPools(pools);
    }
    return { potId: potId, buyIn: p.buyIn, currency: p.currency, pot: p.pot, state: p.state };
  }
  // ENTRY-FEE POOL: an entrant pays the buy-in IN. idemKey makes a refresh/replay a no-op. Local: debits Bonus.
  function wagerJoinPool(potId, playerId, idemKey) {
    var pools = _wagerPools(), p = pools[potId];
    if (!p) return { ok: false, error: 'no_pool' };
    if (p.currency === 'sparks') return { ok: false, error: 'sparks_requires_backend' };
    if (p.paid[playerId]) return { ok: true, deduped: true, balance: getBonusSparks(), escrowed: p.buyIn, pot: p.pot };   // already paid → never double-charge (covers refresh + idemKey replay)
    // build100i: under server-authoritative Bonus the wager economy (a LOCAL escrow/payout stand-in with no backend) can't
    // debit/credit the SERVER balance — a buy-in would hit a shadowed local balance with no way to refund. Gate signed-in
    // Bonus wagers until Lovable ships a wager escrow + credit endpoint. Signed-out (local economy) keeps working.
    if (bonusServerReady()) return { ok: false, error: 'bonus_wager_server_pending' };
    var res = spendBonusSparks(p.buyIn);
    if (!res.ok) return { ok: false, error: 'insufficient', balance: res.balance };
    p.paid[playerId] = { at: Date.now(), idemKey: idemKey || rrUuid() }; p.pot += p.buyIn; _saveWagerPools(pools);
    return { ok: true, balance: res.balance, escrowed: p.buyIn, pot: p.pot };
  }
  // SETTLE: pay the champion the whole pot (minus rake), ONCE. Local: only the champion's OWN client credits.
  // `myId` = the local player's id (so each client settles its own view; the host result is authoritative).
  function wagerSettlePool(potId, championId, myId, idemKey, potOverride) {
    var pools = _wagerPools(), p = pools[potId];
    if (!p) return { ok: false, error: 'no_pool' };
    if (p.state === 'settled' || p.state === 'refunded') return { ok: true, deduped: true, balance: getBonusSparks(), pot: p.pot };
    if (p.currency === 'sparks') return { ok: false, error: 'sparks_requires_backend' };
    // grossPot: the HOST-authoritative total (potOverride) — in the multi-client stand-in the champion's own record only holds
    // their own buy-in, so the full pot is passed in from the replicated tour.pot. Falls back to the local record (unit tests).
    var gross = (potOverride != null) ? Math.max(0, Math.floor(potOverride)) : p.pot;
    var rake = Math.floor(gross * (p.rake || 0)), payout = gross - rake;
    if (championId && myId && championId === myId && payout > 0) _wagerCredit(payout, 'wager_win');
    p.state = 'settled'; p.settledTo = championId; p.pot = 0; _saveWagerPools(pools);
    return { ok: true, balance: getBonusSparks(), payout: payout, rake: rake, grossPot: gross, champion: championId };
  }
  // REFUND: every entrant gets their buy-in back (pool dissolved pre-champion). Same drain primitive as settle.
  // Each client refunds ITS OWN entry (its own debit).
  function wagerRefundPool(potId, myId, idemKey) {
    var pools = _wagerPools(), p = pools[potId];
    if (!p) return { ok: false, error: 'no_pool' };
    if (p.state === 'settled' || p.state === 'refunded') return { ok: true, deduped: true, balance: getBonusSparks() };
    if (p.currency === 'sparks') return { ok: false, error: 'sparks_requires_backend' };
    if (myId && p.paid[myId]) _wagerCredit(p.buyIn, 'wager_refund');
    if (myId && p.bets && p.bets[myId]) _wagerCredit(p.bets[myId].stake, 'sidebet_refund');   // build66: a side-bet stake also refunds on cancel
    p.state = 'refunded'; p.pot = 0; _saveWagerPools(pools);
    return { ok: true, balance: getBonusSparks() };
  }
  // SIDE-BET (parimutuel, Bonus-only): a bettor stakes on WHO will win. idemKey-safe. Local: debits Bonus.
  function wagerPlaceBet(potId, outcomeId, stake, bettorId, idemKey) {
    var pools = _wagerPools(), p = pools[potId];
    if (!p) return { ok: false, error: 'no_pool' };
    if (p.currency === 'sparks') return { ok: false, error: 'sparks_requires_backend' };   // cashable side-bets are a hard no-go (bookmaking) — never
    if (p.state !== 'open') return { ok: false, error: 'locked' };
    if (p.bets[bettorId]) return { ok: true, deduped: true, balance: getBonusSparks() };    // one bet per player; replay is a no-op
    if (bonusServerReady()) return { ok: false, error: 'bonus_wager_server_pending' };       // build100i: see wagerJoinPool — no server escrow/credit yet, so gate signed-in Bonus side-bets
    stake = Math.max(1, Math.min(WAGER_MAX_BUYIN, Math.floor(Number(stake) || 0)));
    var res = spendBonusSparks(stake);
    if (!res.ok) return { ok: false, error: 'insufficient', balance: res.balance };
    p.bets[bettorId] = { outcome: String(outcomeId), stake: stake, at: Date.now(), idemKey: idemKey || rrUuid() };
    p.pot += stake; _saveWagerPools(pools);
    return { ok: true, balance: res.balance, pot: p.pot };
  }
  // live indicative parimutuel odds per outcome: {outcomeId: {staked, oddsX}} (final odds set at lock).
  function wagerBetOdds(potId) {
    var pools = _wagerPools(), p = pools[potId]; if (!p) return {};
    var WT = 0, byO = {}; for (var b in p.bets) { var e = p.bets[b]; byO[e.outcome] = (byO[e.outcome] || 0) + e.stake; WT += e.stake; }
    var WR = Math.floor(WT * (1 - (p.rake || 0))), out = {};
    for (var o in byO) out[o] = { staked: byO[o], oddsX: byO[o] > 0 ? +(WR / byO[o]).toFixed(2) : 0 };
    return out;
  }
  // settle the side-bet: pickers of `winningId` split WR proportionally (floor; breakage discarded). Each
  // client credits ITS OWN winnings. If nobody picked the winner → everyone is refunded their stake.
  function wagerSettleBets(potId, winningId, myId, idemKey, totals) {
    var pools = _wagerPools(), p = pools[potId];
    if (!p) return { ok: false, error: 'no_pool' };
    if (p.state === 'settled' || p.state === 'refunded') return { ok: true, deduped: true, balance: getBonusSparks() };
    if (p.currency === 'sparks') return { ok: false, error: 'sparks_requires_backend' };
    winningId = String(winningId);
    // Authoritative pool-wide totals (WT = total staked, Wk = staked on the winner) come from the replicated tour state — in
    // the multi-client stand-in each client's local p.bets holds only ITS OWN bet, so the totals must be passed in. Falls back
    // to the local record for single-process unit tests.
    var WT, Wk;
    if (totals && totals.WT != null) { WT = Math.max(0, Math.floor(totals.WT)); Wk = Math.max(0, Math.floor(totals.Wk || 0)); }
    else { WT = 0; Wk = 0; for (var b in p.bets) { WT += p.bets[b].stake; if (p.bets[b].outcome === winningId) Wk += p.bets[b].stake; } }
    var mine = p.bets[myId];
    if (Wk <= 0) {            // nobody picked the winner → refund my own stake (everyone is made whole)
      if (mine) _wagerCredit(mine.stake, 'sidebet_refund');
      p.state = 'refunded'; p.pot = 0; _saveWagerPools(pools);
      return { ok: true, refunded: true, balance: getBonusSparks() };
    }
    var WR = Math.floor(WT * (1 - (p.rake || 0)));   // distributable pool after rake
    var won = (mine && mine.outcome === winningId) ? Math.floor(mine.stake * WR / Wk) : 0;   // my proportional share if I backed the winner
    if (won > 0) _wagerCredit(won, 'sidebet_win');
    p.state = 'settled'; p.settledTo = winningId; p.pot = 0; _saveWagerPools(pools);
    return { ok: true, balance: getBonusSparks(), payout: won, distributable: WR, winnerPool: Wk };
  }
  function wagerGetPool(potId) { return _wagerPools()[potId] || null; }
  function wagerServerMode() { return WAGER_SERVER_MODE; }

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
    // build58: normalize varied backend shapes — {item_type,item_id} | {type,id} | "level:high_seas" — so a purchased item
    // reliably reads as OWNED (a shape mismatch otherwise hides ownership → the user gets charged twice).
    _entitlements.owns = Array.isArray(list) ? list.map(function (o) {
      if (typeof o === 'string') { var p = o.split(':'); return { item_type: String(p[0] || ''), item_id: String(p[1] || p[0] || '') }; }
      var t = (o && (o.item_type != null ? o.item_type : o.type)) || '';
      var i = (o && (o.item_id != null ? o.item_id : o.id)) || '';
      return { item_type: String(t), item_id: String(i) };
    }).filter(function (o) { return o.item_id; }) : [];
    _entitlements.signed_in = !!signed;
  }
  // synchronous ownership check (reads the last-fetched cache). Returns false until getEntitlements()/getStore() has run.
  function ownsItem(item_type, item_id) {
    var t = String(item_type), i = String(item_id);
    // build100q: normalize hyphen/underscore on BOTH sides — authored level ids are hyphen ('high-seas') while the
    // store/campaign entitlement ids are underscore ('high_seas'). Exact compare made the env-pick/launch gate query an
    // id never in the cache → a real purchaser (and the admin during the async _isAdmin resolve window) saw paid levels
    // as locked. Compare slug-insensitively so the two id forms agree.
    var _nm = function (s) { return String(s).replace(/-/g, '_'); };
    var _ni = _nm(i), _key = t + ':' + _ni;
    // launch-hardening: apply the SAME slug-normalization to the FREE + Bonus-owns lookups as the server-entitlement
    // branch below. build100q only normalized the entitlements path, so a FREE gift or an earned-Bonus purchase stored
    // under one id form (e.g. 'high-seas') read as UNOWNED when the gate queried the other form ('high_seas', the entId)
    // → the exact "owned but can't play" mismatch. Key both maps on the normalized id so all three ownership sources agree.
    if (FREE_ITEMS[t + ':' + i] || FREE_ITEMS[_key]) return true;   // FREE community unlock (e.g. CelinesRazor's guitar) — owned by everyone, no purchase, even for a fresh player
    var _asPlayer = false; try { _asPlayer = /[?&]asplayer=1/.test(location.search); } catch (e) {}
    if (!_asPlayer && (_isAdmin || _isDevUnlock())) return true;   // admin/dev owns everything; a fresh-player sim owns ONLY real entitlements
    try { if (loadBonusOwns().some(function (k) { return _nm(k) === _key; })) return true; } catch (e) {}   // earned-Bonus-Sparks purchase (local, legit even for a fresh player)
    return _entitlements.owns.some(function (o) { return o.item_type === t && _nm(o.item_id) === _ni; });
  }
  async function getEntitlements() {
    if (!API_BASE) { _setEntCache([], false); return { signed_in: false, owns: [] }; }
    try {
      const out = await api('/entitlements', { auth: true });
      // build50: tolerate BOTH shapes — the live backend returns { entitlements:[…] } but the brief asks for { owns:[…] }.
      const owns = Array.isArray(out && out.owns) ? out.owns : (Array.isArray(out && out.entitlements) ? out.entitlements : []);
      // build184: an UNAUTHENTICATED 200-with-empty (token missing/expired mid-session — api() silently omits the
      // Bearer when getToken() is null) must not clobber a previously-signed cache: that blackout made every paid
      // item read LOCKED, and locked-item clicks route to the Store ("anything I click sends me to the shop").
      // Thrown fetches already preserve the cache (below); treat unauthed-empty the same and keep what we know.
      if (!(out && out.signed_in) && _entitlements.signed_in && _entitlements.owns.length && !owns.length) {
        return { signed_in: _entitlements.signed_in, owns: _entitlements.owns.slice() };
      }
      _setEntCache(owns, !!(out && out.signed_in));
      if (bonusServerOn() && out && out.signed_in) { try { _bonusSrvBalance(); } catch (e) {} }   // build100h: prime the authoritative Bonus balance cache once we know who's signed in
      // return the NORMALIZED cache (not the raw backend list): store consumers key on {item_type,item_id},
      // so handing back raw {type,id}/string rows would make a purchased item read as unowned → double charge.
      return { signed_in: !!(out && out.signed_in), owns: _entitlements.owns.slice() };
    } catch (e) { return { signed_in: _entitlements.signed_in, owns: _entitlements.owns.slice() }; }
  }
  // POST /sparks/spend { item_type, item_id, idempotency_key } -> {ok,balance,granted,deduped}
  // 402 insufficient_sparks · 409 price_mismatch. Returns a normalized result the UI branches on.
  async function spendSparks(item_type, item_id, idem) {
    if (!API_BASE) return { ok: false, error: 'no-api' };
    const tk = await getToken();
    if (!tk) return { ok: false, error: 'not-authed' };
    // build66 (launch-audit P1): reuse ONE idempotency_key per purchase intent (passed in by the caller) so a retry after a
    // lost response dedupes server-side instead of double-charging real Sparks. Mint a fresh one only if the caller omits it.
    const body = { item_type, item_id, idempotency_key: idem || rrUuid() };
    try {
      const out = await api('/sparks/spend', { method: 'POST', body, auth: true });
      if (out && typeof out.balance === 'number') saveSparksCache(out.balance);
      return { ok: !!(out && out.ok), balance: out && out.balance, granted: out && out.granted, deduped: !!(out && out.deduped) };
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (/\b402\b|insufficient/i.test(msg)) return { ok: false, error: 'insufficient_sparks' };
      if (/\b409\b|price_mismatch/i.test(msg)) return { ok: false, error: 'price_mismatch' };
      if (/\b404\b|item_not_found|not_found/i.test(msg)) return { ok: false, error: 'item_not_found' };   // build100q: the backend's spend registry doesn't know this item_id yet — surface it instead of a generic fail
      return { ok: false, error: 'spend_failed', detail: msg };
    }
  }

  // ---------- API client ----------
  // onRes: optional hook called with the raw fetch Response BEFORE the body is parsed —
  // lets a caller read response headers (e.g. X-Total-Count for paged crawls) without
  // changing the return shape. Guarded: an onRes that throws must never fail the request.
  async function api(path, { method = 'GET', body = null, auth = false, authWaitMs = 0, onRes = null } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (auth) {
      let tk = await getToken();
      // build101: optional wait for the SHARED site session to hydrate — early-boot callers (review deep-launch)
      // can run before supabase-js finishes restoring the localStorage session; don't 401 a signed-in host.
      // (The site previously patched this in via patch-game-handoff.mjs — now native.)
      if (!tk && authWaitMs > 0) { const t0 = Date.now(); while (!tk && Date.now() - t0 < authWaitMs) { await new Promise(r => setTimeout(r, 250)); tk = await getToken(); } }
      if (tk) headers.authorization = 'Bearer ' + tk;
    }
    const res = await fetch(API_BASE + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let detail = ''; try { detail = (await res.json()).error || ''; } catch (e) {}
      throw new Error('API ' + res.status + (detail ? ' · ' + detail : '') + ' (' + path + ')');
    }
    if (onRes) { try { onRes(res); } catch (e) {} }
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
          // build65 (cycle-4): {once} listeners only self-remove when they FIRE — on this SHARED, reused <audio> element the
          // two that DON'T fire persist and accumulate play-over-play. Remove ALL THREE on the first resolve OR reject.
          var _onReady = function () { _cleanup(); ok(); };
          var _onErr = function () { _cleanup(); fail('audio error code=' + (audio.error && audio.error.code)); };
          var _cleanup = function () { audio.removeEventListener('canplay', _onReady); audio.removeEventListener('loadeddata', _onReady); audio.removeEventListener('error', _onErr); };
          audio.addEventListener('canplay', _onReady);
          audio.addEventListener('loadeddata', _onReady);
          audio.addEventListener('error', _onErr);
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
          // build100i: Lovable returns { id, play_id, rank_global }. Capture the canonical play_id, then earn server
          // Bonus against it (POST /bonus-sparks/earn { play_id, daily_rift }). _runDailyRift carries this run's daily
          // intent (set in recordLocal); the server validates it. No-op unless BONUS_SERVER + signed-in.
          var _pid = out && (out.play_id || out.id);
          try { if (_pid && currentTrack) currentTrack.play_id = _pid; } catch (e) {}
          _bonusEarnForRun(_pid, null, !!_runDailyRift);
          try { _capturePlayStats(out, trackId, results && results.difficulty); } catch (e) {}   // Wave-3: TOP N% TODAY (display-only, read off the /plays response)
          let board = [];
          try { board = lbRows(await api('/leaderboard/' + trackId + '?difficulty=' + results.difficulty + '&limit=10')); }
          catch (e) { /* leaderboard optional */ }
          return { rank_global: out.rank_global, play_id: _pid, leaderboard: board };
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
  let catalogVideos = [];        // music videos / films — split OUT of the music lists (their own category)
  let catalogRawCount = 0;       // total returned (incl. not-yet-ready), for display

  async function loadCatalog() {
    _sectionsCache = null;   // build58: a fresh/grown catalog must recompute the rails (incl. a new Surprise + newest-first New)
    _releasePartiesTried = false;   // a fresh/reload crawl may add tracks that light up a party → re-attempt the one-shot fetch
    const forceMock = /[?&]mock=1/.test(location.search);
    if (API_BASE && !forceMock) {
      // build127: the paged crawl is NO LONGER one big try/catch. A single flaky page mid-crawl
      // (transient 500 / network blip / timeout — likelier as the library grows) must NOT discard the
      // hundreds of REAL tracks already fetched. Each page fetch is guarded on its own; a partial crawl
      // is treated as SUCCESS (catalogLive true, real tracks) as long as ≥1 real track came back. We only
      // fall through to the mock catalog when ZERO real tracks were fetched (the true "unreachable" case).
      // FIX 2: page 0 reads X-Total-Count, then the remaining pages fire in PARALLEL (Promise.allSettled)
      // and are assembled IN OFFSET ORDER; a single failed page among the batch still yields the others.
      const LIMIT = 200, MAX_PAGES = 60;
      const all = [];
      let crawlErrored = false;   // a page threw / was dropped → the set may be partial
      let crawlComplete = false;  // reached a short/empty page → we have the WHOLE library

      const pushPage = (list) => {
        if (list && list.length) for (let i = 0; i < list.length; i++) all.push(list[i]);
      };

      try {
        // --- page 0 (sequential): learn the total from X-Total-Count if the server sends it ---
        let total = NaN;
        const first = await api('/tracks?limit=' + LIMIT + '&offset=0', {
          onRes: (res) => {
            try {
              const h = res.headers && res.headers.get && res.headers.get('X-Total-Count');
              if (h != null && h !== '') { const n = parseInt(h, 10); if (isFinite(n) && n >= 0) total = n; }
            } catch (e) {}
          },
        });
        pushPage(first);
        const firstLen = (first && first.length) || 0;
        if (firstLen < LIMIT) {
          // whole library fit in one page (or it's empty) — nothing more to fetch
          crawlComplete = true;
        } else if (isFinite(total) && total > 0) {
          // --- FIX 2: parallel path — we know the total, so fire every remaining page at once ---
          const pageCount = Math.min(Math.ceil(total / LIMIT), MAX_PAGES);
          const jobs = [];
          for (let p = 1; p < pageCount; p++) {
            const offset = p * LIMIT;
            jobs.push(api('/tracks?limit=' + LIMIT + '&offset=' + offset).then(
              (list) => ({ p: p, list: list }),
              (err) => ({ p: p, err: err })
            ));
          }
          // Promise.allSettled semantics via the resolve-both mapping above — no page can reject the batch.
          const results = await Promise.all(jobs);
          results.sort((a, b) => a.p - b.p);   // ASSEMBLE IN OFFSET ORDER (fresh-first sort downstream relies on order)
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.err) { crawlErrored = true; console.warn('catalog page ' + r.p + ' failed — keeping the rest', r.err); continue; }
            pushPage(r.list);
          }
          crawlComplete = !crawlErrored;   // every page that we asked for came back
        } else {
          // --- sequential fallback: X-Total-Count absent/unparseable → crawl page-by-page ---
          // Each page is guarded independently: on a page error, STOP but keep everything already fetched.
          for (let page = 1; page < MAX_PAGES; page++) {
            let list;
            try {
              list = await api('/tracks?limit=' + LIMIT + '&offset=' + (page * LIMIT));
            } catch (e) {
              crawlErrored = true;
              console.warn('catalog page ' + page + ' failed — proceeding with the pages fetched so far', e);
              break;
            }
            if (!list || !list.length) { crawlComplete = true; break; }
            pushPage(list);
            if (list.length < LIMIT) { crawlComplete = true; break; }
          }
        }
      } catch (e) {
        // page 0 itself failed → we have nothing; fall through to the mock branch below.
        crawlErrored = true;
        console.warn('catalog fetch failed → preview catalog', e);
      }

      if (all.length) {
        // --- SUCCESS path (runs on a PARTIAL `all` too — every side effect preserved) ---
        all.forEach(t => {
          if (!t) return;
          // some rows pack the description into the title field — keep just the first line
          if (t.title) t.title = String(t.title).split('\n')[0].trim().slice(0, 80);
          // created_at arrives as an ISO string (live) or ms number (mock) — unify to ms
          // so "New"/fresh-upload sorting works and a just-uploaded track surfaces first
          t.created_at = (+new Date(t.created_at)) || 0;
        });
        catalogRawCount = all.length;
        // ONLY show songs that actually play — no dead taps, ever. THE chokepoint:
        // split videos OUT of the music catalog here, so every music surface (rails,
        // browse, search, pickers) is music-only for free; videos go to their own bucket.
        // content-cleanup: drop dev/test junk rows (see isJunkTrack) BEFORE splitting into music/video, so they
        // never reach the playable catalog, the rails, browse, or search. Game-side only — no DB writes.
        var clean = all.filter(function (t) { return !isJunkTrack(t); });
        var ready = clean.filter(trackReady);
        catalogTracks = ready.filter(function (t) { return !isVideo(t); });
        // build99N: videos gate on WATCHABILITY, not the music chartability gate (trackReady). A film can
        // always be watched even with no decodable audio to chart — recovers ~30 of 142 films that were hidden.
        catalogVideos = clean.filter(function (t) { return isVideo(t) && videoReady(t); });
        catalogLive = true;   // server-charted launches unblocked, even on a partial library
        // build127: a partial crawl is still LIVE — just quietly note more is loading, don't cry "samples".
        if (crawlErrored && !crawlComplete) {
          try { if (window.RhythmGame && window.RhythmGame.showToast) window.RhythmGame.showToast('Some of the library is still loading…', 'neutral'); } catch (e2) {}
        }
        // Album release parties — fire the one-shot /release-parties fetch (fire-and-forget so it never
        // blocks the crawl). It 404s until Lovable builds the route → graceful empty shelf. If it DOES return
        // parties, repaint Browse so the "Album Releases" shelf appears without a manual refresh.
        fetchReleaseParties().then(function () {
          try { if (_releaseParties.length && typeof renderHome === 'function') renderHome(); } catch (e2) {}
        });
        // finding #8: the async crawl resolves AFTER boot already painted the library, and NOTHING repaints the hub —
        // so the Daily/Weekly Rift tiles + status strip strand on "Loading…" until the hub is manually re-entered.
        // Emit a completion signal so a hub listener (in index.html — we ONLY emit here) can repaint. One per crawl.
        try { window.dispatchEvent(new CustomEvent('rr:catalog-ready')); } catch (e2) {}
        return;
      } else if (!crawlErrored) {
        // build72: a 200-but-EMPTY library would silently fall through to the 1000 mock songs with no signal — mirror the catch-branch toast so the player knows these are samples (the refresh icon retries)
        try { if (window.RhythmGame && window.RhythmGame.showToast) window.RhythmGame.showToast('Library is empty right now — showing samples', 'error'); } catch (e2) {}
      } else {
        // build58: don't silently swap in fake sample songs — tell the player the live library didn't load (the refresh icon retries).
        try { if (window.RhythmGame && window.RhythmGame.showToast) window.RhythmGame.showToast("Couldn't reach the library — showing samples", 'error'); } catch (e2) {}
      }
    }
    catalogLive = false;
    const mock = buildMockCatalog(1000);
    catalogRawCount = mock.length;
    var cleanM = mock.filter(function (t) { return !isJunkTrack(t); });   // content-cleanup: same junk gate as the live path (mock has none, but keep the surfaces identical)
    var readyM = cleanM.filter(trackReady);   // preview also shows only playable
    catalogTracks = readyM.filter(function (t) { return !isVideo(t); });
    catalogVideos = cleanM.filter(function (t) { return isVideo(t) && videoReady(t); });
    // finding #8: the mock/fallback resolution also readies a usable catalog — emit so the hub repaints off "Loading…"
    // instead of stranding when the live crawl was empty/unreachable. (Mutually exclusive with the live-path emit
    // above — the live branch returns early — so still exactly one rr:catalog-ready per loadCatalog() resolution.)
    try { window.dispatchEvent(new CustomEvent('rr:catalog-ready')); } catch (e2) {}
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
  // best-effort playable VIDEO source for the interim Watch preview (NOT a rhythm chart).
  // SWAP-SEAM: a dedicated t.video_url lands with the backend video bucket; until then
  // stream_url (.mp4/.m3u8) is the fallback. .m3u8 → Chrome can't decode → openWatch new-tab fallback.
  function videoWatchUrl(t) { return (t && (t.video_url || t.stream_url || t.media_url)) || ''; }
  // build99N: a film is "ready to LIST in AI Flixs" if it has ANY watchable source. Films can always be
  // WATCHED; charting them as a playable level (playFlix) is a bonus that needs DECODABLE audio and
  // gracefully degrades to the Watch preview when absent. This must NOT use trackReady (the MUSIC gate,
  // which requires a decodable non-HLS audio file) — doing so silently hid 30 of 142 films that have no
  // decodable audio rendition (e.g. After Eve's "Straitjacket MV"), dropping them from the grid/count/search.
  function videoReady(t) { return !!t && (!!videoWatchUrl(t) || !!trackAudioUrl(t)); }
  // build188 — THE PLAY-TRIANGLE PROMISE (Fable 5 ruling, live-show incident 2026-07-19): ONE synchronous
  // discriminator for "is this film a PLAYABLE LEVEL?" — used by the Flixs card, the grid sort, and the sheet
  // so the grid can never again promise a level it can't launch. A film is playable iff it carries DECODABLE
  // (non-HLS) audio to chart in-browser. Verified against the live catalog 2026-07-19: 143 of 170 films pass;
  // 27 are HLS-only Mux assets whose /audio.m4a rendition returns 404 (probed all 27 — see
  // LOVABLE_FLIX_AUDIO_BRIEF.md). This AUTO-UPGRADES: the moment Lovable backfills a film's audio rendition,
  // audio_url stops being an .m3u8 and the card flips to playable with no code change and no flag list.
  function flixPlayable(t) { return isVideo(t) && !!trackAudioUrl(t); }
  function hasServerChart(t) { return !!t && (t.chart_status === 'ready' || t.has_chart); }
  // build126: true when the track carries its OWN decodable (non-HLS) audio_url to chart in-browser — the exact
  // discriminator the audio launch branch needs, INDEPENDENT of whether the paged live-catalog crawl has finished.
  // A REVIEW deep-launch (?review=<token>) resolves its own track (with audio_url) in PARALLEL with loadCatalog(), so
  // the host can hit PLAY while catalogLive is still false — the old `catalogLive &&` gate then dropped that fully-
  // resolvable track straight to the LUNAR WAVES demo. Mock-catalog rows carry NO audio_url (their has_chart is a
  // synthetic preview flag), so they fail this and correctly fall to the preview demo; id:'demo' / demo:true are
  // excluded so the demo track itself still routes to playDemo. Server-charted tracks take the separate chart branch.
  function isLaunchable(t) { return !!t && t.id && t.id !== 'demo' && !t.demo && !!trackAudioUrl(t); }
  // ▼▼▼ SWAP-SEAM ▼▼▼ — media type (music vs video). Prefer an AUTHORITATIVE backend
  // field (media_type / is_video). This is now the PRIMARY signal: game-catalog SHIPS the
  // field (CONFIRMED LIVE 2026-07 — every /tracks row carries media_type ∈ {'audio','video'}
  // PLUS an is_video boolean; tally over the full library = 1255 audio / 158 video). The
  // genre/title heuristic below is now a DORMANT fallback, kept only for any legacy/edge row
  // that somehow lacks the field. isVideo/musicTracks/videoTracks + every caller stay put.
  // Mirrors the BONUS-SPARKS seam. See VIDEO_SEPARATION_BRIEF.md.
  // NOTE: the backend match is deliberately FUZZY (/video|film|^mv$/i) so a plausible value
  // like 'music_video' / 'mv' / 'video/mp4' still classifies as video — an exact === 'video'
  // would let such a value read as music (field present → heuristic skipped → silent re-leak).
  // 'audio' (the DB's music value) contains none of those tokens → correctly reads as music.
  function mediaType(t) {
    if (!t) return 'music';
    if (typeof t.media_type === 'string' && t.media_type) {        // backend field #1 (preferred)
      return /video|film|^mv$/i.test(t.media_type) ? 'video' : 'music';
    }
    if (typeof t.is_video === 'boolean') return t.is_video ? 'video' : 'music';   // backend field #2
    var g = String(t.genre || '').toLowerCase();                  // heuristic fallback (today)
    if (g === 'music video' || g === 'ai film') return 'video';
    if (/\bMV\b|music\s*video|official\s*video|visualizer|lyric\s*video/i.test(String(t.title || ''))) return 'video';
    return 'music';
  }
  // ▲▲▲ SWAP-SEAM ▲▲▲
  function isVideo(t) { return mediaType(t) === 'video'; }
  // ▼▼▼ SWAP-SEAM ▼▼▼ — Golden Buzzer winner flag. AUTHORITATIVE backend field ONLY —
  // NO curated client list, NO title/genre heuristic. Stays DARK (returns false) until
  // Lovable sets the column. Mirrors mediaType()/isVideo(). Two accepted shapes so the
  // backend can pick either a boolean or a string/timestamp marker. See GOLDEN_BUZZER_BRIEF.md.
  function goldenBuzzer(t) {
    if (!t) return false;
    if (typeof t.golden_buzzer === 'boolean') return t.golden_buzzer;        // preferred: boolean column
    if (typeof t.is_golden_buzzer === 'boolean') return t.is_golden_buzzer;  // alt name
    // tolerate a truthy string/timestamp marker (e.g. an award date) — but NOT the literal
    // strings "false"/"0"/"" which a loose DB cast can produce.
    var v = t.golden_buzzer != null ? t.golden_buzzer : t.is_golden_buzzer;
    if (typeof v === 'string') return !!v && !/^(false|0|no|null)$/i.test(v.trim());
    return false;   // absent → not a winner. DEFAULT OFF.
  }
  // ▲▲▲ SWAP-SEAM ▲▲▲
  function musicTracks() { return catalogTracks; }   // catalogTracks is already music-only post-split
  // Golden Buzzer WINNERS — the flagged subset of music (never videos). Cheap linear filter over the
  // already-music-only list; returns [] until the backend sets golden_buzzer (graceful-empty). Powers the
  // dedicated Browse hero + coverflow rail in jukebox.js. Recomputed on demand (small N, ~32 winners).
  function goldenBuzzerTracks() { return musicTracks().filter(function (t) { return goldenBuzzer(t); }); }

  // ===========================================================================
  // ALBUM RELEASE PARTIES (Browse "Album Releases" shelf) — the platform runs a
  // week-long RELEASE PARTY when an artist's album goes live; the game surfaces
  // the current/recent ones so players can play the album's tracks.
  //
  // Data comes from a NEW backend route: GET /release-parties → an array of
  //   { id, album_id, album_title, artist_display_name, cover_url, status,
  //     live:boolean, live_until:iso,
  //     playable_track_ids:[<catalog track ids on this album, in order>],
  //     total_track_count:int }
  // playable_track_ids are the SAME ids the engine keys tracks on (track.id).
  //
  // RESILIENT BY DESIGN: this endpoint does NOT exist yet → the fetch 404s. We
  // fire ONE attempt at catalog boot, swallow ANY failure (404 / network / parse)
  // into an empty cache, and NEVER retry in a loop — a missing route just yields
  // an empty shelf (hidden), exactly like goldenBuzzer() stays dark until lit up.
  // Mirrors the goldenBuzzer swap-seam philosophy. See GOLDEN_BUZZER_ALBUM_RELEASES_BRIEF.md.
  // ===========================================================================
  let _releaseParties = [];        // raw party metadata from the backend (cached; [] until the route exists)
  let _releasePartiesTried = false; // one-shot guard: never spam the 404 in a tight loop
  async function fetchReleaseParties() {
    if (_releasePartiesTried) return _releaseParties;   // one attempt only (per boot / reload)
    _releasePartiesTried = true;
    // Mock/preview has no backend route to hit → nothing to show. Skip the doomed fetch entirely.
    if (!API_BASE || /[?&]mock=1/.test(location.search)) { _releaseParties = []; return _releaseParties; }
    try {
      const rows = await api('/release-parties');
      _releaseParties = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.parties) ? rows.parties : []);
    } catch (e) {
      // 404 (route not built yet) / network blip / bad JSON → graceful empty, NO console spam.
      _releaseParties = [];
    }
    return _releaseParties;
  }
  // Map a party's playable_track_ids → the loaded catalog track objects (music only, IN ORDER).
  // Ids the crawl hasn't loaded (or non-playable) are simply skipped — the shelf shows the
  // consented∩decodable subset that's actually launchable today.
  function albumTracks(partyId) {
    const p = _releaseParties.find(function (x) { return x && String(x.id) === String(partyId); });
    if (!p || !Array.isArray(p.playable_track_ids)) return [];
    const byId = {};
    for (let i = 0; i < catalogTracks.length; i++) { const t = catalogTracks[i]; if (t && t.id != null) byId[String(t.id)] = t; }
    const out = [];
    for (let i = 0; i < p.playable_track_ids.length; i++) {
      const t = byId[String(p.playable_track_ids[i])];
      if (t) out.push(t);   // only ids that map to a loaded, launchable music track
    }
    return out;
  }
  // Public getter → parties that currently have >=1 launchable track loaded (else there's nothing
  // to play, so hide them). Each returned party carries its raw metadata PLUS a resolved
  // `tracks` array + `playableLoaded` count so jukebox.js can render "N of M playable" without
  // re-mapping. Recomputed on demand (tiny N — a handful of parties).
  function releaseParties() {
    if (!_releaseParties.length) return [];
    const out = [];
    for (let i = 0; i < _releaseParties.length; i++) {
      const p = _releaseParties[i]; if (!p) continue;
      const tracks = albumTracks(p.id);
      if (!tracks.length) continue;   // no loaded/launchable track on this album → nothing to play → hide
      out.push(Object.assign({}, p, { tracks: tracks, playableLoaded: tracks.length }));
    }
    return out;
  }

  function videoTracks() { return catalogVideos; }
  function videoCount() { return catalogVideos.length; }
  // ▼▼▼ SWAP-SEAM ▼▼▼ — 16:9 cinema poster for AI Flixs. Lovable should add a LANDSCAPE
  // poster_url on video rows; until then thumbnail → first-frame → square artwork (cover-cropped).
  // Mirrors mediaType()/goldenBuzzer(). See VIDEO_SEPARATION_BRIEF.md / LOVABLE_BACKEND_ASKS.md.
  function posterFor(t) {
    if (!t) return '';
    return t.poster_url || t.thumbnail_url || t.first_frame_url || t.artwork_url || '';
  }
  // ▲▲▲ SWAP-SEAM ▲▲▲
  // ---------- dev/test junk exclusion (content cleanup) ----------
  // The owner's account seeds a few pure DEV TEST rows into the LIVE catalog (real analytics-confirmed
  // titles: "test" / "test00" / "E2E Test Song - My new track about summer vibes" / "ReactivVibeAI.com").
  // These must NEVER reach the playable catalog OR any discovery rail (Featured/Hot/New/Surprise/Browse/
  // search) — a dead/junk pick burns a first impression. Game-side filter ONLY: no DB writes, nothing here
  // touches prod data. Applied at the ONE chokepoint in loadCatalog(), so every downstream surface (rails,
  // browse, search, daily rift, release parties) inherits the exclusion for free.
  //
  // TIGHT title patterns ONLY — match on TITLE SHAPE, never artist_name. (The owner's REAL songs share the
  // 'Reactivvibeai' artist — "Blood Moon", "Backroom Bop", "Uplifting Summer Rain" — so an artist filter
  // would nuke real content; and the live "ReactivVibeAI.com" junk row is actually filed under a DIFFERENT
  // artist ('County Cold'), so artist matching would miss it anyway.) The $-anchors keep real songs safe:
  // "Test Drive"/"Testament" do NOT match /^test\s*\d*$/. Add new junk shapes to _JUNK_TITLE to extend.
  const _JUNK_TITLE = [
    /^test\s*\d*$/i,          // exactly "test", "test00", "test 5" — trailing digits/space only, $-anchored
    /^e2e\s+test\b/i,         // "E2E Test Song - …" (any E2E-test placeholder)
    /^reactivvibeai\.com$/i,  // the literal site-URL placeholder row
  ];
  function isJunkTrack(t) {
    if (!t) return false;
    var title = String(t.title || '').split('\n')[0].trim();   // loadCatalog already single-lines/trims; belt-and-suspenders
    if (!title) return false;
    for (var i = 0; i < _JUNK_TITLE.length; i++) if (_JUNK_TITLE[i].test(title)) return true;
    return false;
  }

  // ---------- discovery confidence (bias, not a gate) ----------
  // A track we're CONFIDENT will actually chart + play well — used ONLY to BIAS the random/curated rails
  // (Surprise / Featured / Hot) so a first impression isn't burned on a likely-dead pick (per prod analytics:
  // chart_status='failed' + un-decodable rows complete poorly). Prefers a real decodable in-browser audio_url
  // OR a pre-baked server chart, and avoids chart_status='failed'. This only REORDERS rails (floats confident
  // tracks to the head / front-loads the Surprise pool) — it NEVER removes anything, so no rail can be emptied.
  // Videos are already excluded from these music rails upstream (catalogTracks is music-only), so flix levels
  // are untouched.
  function _discoverConfident(t) {
    if (!t) return false;
    if (t.chart_status === 'failed') return false;        // server charting gave up → historically low completion
    return !!(hasServerChart(t) || isLaunchable(t) || t.demo);   // pre-baked chart, decodable audio_url, or the demo
  }

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
  let _scoresCache = null;   // build58: parse rr_scores ONCE — getBest() runs per song card (1100+), the per-call JSON.parse was the list-render hot path
  function loadScores() { if (_scoresCache) return _scoresCache; try { _scoresCache = JSON.parse(localStorage.getItem('rr_scores') || '{}'); } catch (e) { _scoresCache = {}; } return _scoresCache; }
  function gradeFor(acc) { return acc >= 0.95 ? 'S' : acc >= 0.88 ? 'A' : acc >= 0.75 ? 'B' : acc >= 0.60 ? 'C' : 'D'; }   // build71: align this fallback grader to the ENGINE scale (game.js endGame: S>=95/A>=88/B>=75/C>=60). Runs carry res.grade so this only affects the latent fallback (legacy rr_scores / external callers) — but a cover card and the results screen must never disagree.
  function getBest(trackId) {
    const s = loadScores(); let best = null;
    // build147: include 'rift' — saveBest already writes trackId+'|rift' for Daily-Rift clears, but the read path never
    // scanned it, so those bests (often a player's highest) were saved and never surfaced on covers / the sheet BEST line.
    ['easy', 'medium', 'hard', 'rift'].forEach(d => { const r = s[trackId + '|' + d]; if (r && (!best || r.score > best.score)) best = Object.assign({ difficulty: d }, r); });
    if (best) return best;
    if (catalogLive) return null;   // build58: skip the O(n) catalog scan on LIVE data — _mockBest only exists in mock/preview (this scan ran per card → ~n² on a full-list render)
    const t = catalogTracks.find(x => x.id === trackId);
    // build35 (audit P1): never surface a FABRICATED mock grade/score on LIVE data — only in mock/preview.
    return ((t && t._mockBest) || null);
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

  // ===========================================================================
  // DAILY RIFT (build100) — a once-a-day hardcore challenge: the SAME deterministic
  // song all day (rotates daily), launched on HARD, paying ×3 Bonus Sparks on the
  // first clear of the day. The pick formula is shared/global (date-hashed), so every
  // player sees the same song today. State lives in localStorage 'rr_dailyrift'.
  // ===========================================================================
  // build100d (bug-swarm P1 fix): the ×3 is armed for a SPECIFIC track id, NOT a bare boolean. A boolean leaked the ×3
  // onto the NEXT completed run if the player quit the rift before song-end (endGame→recordLocal never fired, so the flag
  // stayed armed and the next song banked unearned Bonus + falsely stamped the day done). Binding to the daily track id
  // means ONLY completing the daily song can honor the ×3 — a non-matching run never gets it, so a quit can't leak it.
  let _dailyRiftArmedId = null;   // the daily track id the ×3 is armed for (null = not armed)
  let _dailyRiftTriple = false;   // whether the ×3 is still owed today (false → rift replay pays normal)
  let _runDailyRift = false;      // build100i: was the just-COMPLETED run the day's armed Daily Rift? — read by /score + /plays so the server can apply the ×3 Bonus server-side (reset each run in recordLocal)
  // local YYYY-MM-DD (date-only key; the player's local day). Same string → same pick + same gate all day.
  function dailyRiftToday() {
    const d = new Date();
    const mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
  // deterministic pick: hash the date string (reuse hashStr) → index over the DECODABLE MUSIC pool (never a video).
  // Same formula + same catalog ⇒ same song for everyone today. Returns null until the catalog has music loaded.
  function dailyRiftTrack(dateKey) {
    const pool = musicTracks();
    if (!pool || !pool.length) return null;
    const key = dateKey || dailyRiftToday();
    const h = (typeof hashStr === 'function') ? (hashStr('rift|' + key) >>> 0) : 0;
    return pool[h % pool.length] || null;
  }
  function dailyRiftState() {
    let s = {}; try { s = JSON.parse(localStorage.getItem('rr_dailyrift') || '{}'); } catch (e) {}
    const today = dailyRiftToday();
    return { date: today, done: !!(s && s.date === today && s.done) };   // a stale (yesterday) record reads as NOT done today
  }
  // the menu controller calls this right before launching the rift. tripleReward=true only on the day's first clear
  // (the controller checks dailyRiftState().done). The flag is consumed by recordLocal so it can't leak to later runs.
  function setDailyRift(active, tripleReward) {
    if (active) { var _t = dailyRiftTrack(); _dailyRiftArmedId = _t ? _t.id : '__rift'; _dailyRiftTriple = !!tripleReward; }
    else { _dailyRiftArmedId = null; _dailyRiftTriple = false; }
  }

  // ===========================================================================
  // WAVE-5 SPOTLIGHT (B3) — one deterministic-by-date "Spotlight" track per day that pays
  // DOUBLE XP on its first clear of the day. STATUS ONLY: the ×2 is pure XP / level progress
  // (goals.js), NEVER Sparks / Bonus Sparks / score / leaderboard / multiplier — the locked
  // currency model stands. The pick reuses the dailyPicks date-stable seed (hashStr + dailyRiftToday),
  // so it's the SAME song for every player today, stable across reloads, and rotates tomorrow.
  // The ×2 grant lifecycle lives in recordLocal (block 3), downstream of the preview/practice/failed gates.
  // ===========================================================================
  // In-memory once-per-session guard for the ×2 XP grant (holds the dailyRiftToday() string it was granted
  // for). Mirrors the Daily-Rift ×3 belt-and-suspenders: this survives a stamp-WRITE failure (so a second run
  // THIS session can't re-grant), while the persisted rr_spotlight_xp stamp survives reloads / new sessions.
  let _spotlightXpDay = null;   // null = the ×2 has not been granted yet this session
  // Persisted anti-farm stamp, mirrors dailyRiftState(): { date, done }. A stale (yesterday) record reads NOT done today.
  function spotlightXpState() {
    let s = {}; try { s = JSON.parse(localStorage.getItem('rr_spotlight_xp') || '{}'); } catch (e) {}
    const today = dailyRiftToday();
    return { date: today, done: !!(s && s.date === today && s.done) };
  }
  // The day's Spotlight track (SYNC). Reuses dailyPicks' date-stable seed + playable pool (ready, non-video,
  // decode-confident), then salts a single stable index into it so the Spotlight is a distinct pick from the
  // daily-picks head yet still identical for everyone today and stable across reloads. null until music loads.
  // MEMOIZED, and it must be: isSpotlight() is called once per rendered song row / shelf card / coverflow cover, and
  // dailyPicks() filters the whole ~852-track music catalog and then sorts it with two hashStr() calls per comparison.
  // Unmemoized that is a full O(N log N) catalog sort per CARD — filling the All-Songs list (40 rows/page + scroll
  // appends) re-sorted the catalog 100+ times and hitched the render. (build58 memoized the rr_scores JSON.parse for
  // exactly this reason: getBest() is the list-render hot path.) Cache on the day-key AND the catalog length, so the
  // pick still rotates at midnight and still resolves once the catalog finishes loading (it is null before that).
  var _spotCache = { day: null, len: -1, track: null };
  function spotlightTrack() {
    try {
      var today = dailyRiftToday();
      var len = (typeof musicTracks === 'function' ? (musicTracks() || []).length : 0);
      if (_spotCache.day === today && _spotCache.len === len) return _spotCache.track;
      var t = null;
      var picks = dailyPicks(8);
      if (picks && picks.length) {
        var idx = ((typeof hashStr === 'function' ? hashStr('spotlight|' + today) : 0) >>> 0) % picks.length;
        t = picks[idx] || null;
        if (!t || isVideo(t) || !trackReady(t)) t = null;   // defense-in-depth: never a video, must be playable
      }
      _spotCache = { day: today, len: len, track: t };
      return t;
    } catch (e) { return null; }
  }
  // SYNC boolean: is this track id today's Spotlight? (consumed by the library UI + the ×2 grant gate in recordLocal)
  function isSpotlight(trackId) {
    if (trackId == null) return false;
    try { var t = spotlightTrack(); return !!(t && String(t.id) === String(trackId)); } catch (e) { return false; }
  }

  // ---------- catalog query helpers (consumed by the library UI) --------------
  function allTracks() { return catalogTracks; }
  function allMedia() { return catalogTracks.concat(catalogVideos); }   // music + videos, for cross-search (Phase 5)
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
    else if (mode === 'featured') a.sort((x, y) => ((y.featured ? 1 : 0) - (x.featured ? 1 : 0)) || ((y.play_count || 0) - (x.play_count || 0)));   // build58: was a no-op (no branch) → Featured option did nothing
    return a;
  }
  let _sectionsCache = null;   // build58: sections() recomputed 4 full sorts + a reshuffle on EVERY coverflow tab tap. Memoize per
  function sections() {        // catalog version (invalidated in loadCatalog) so tabbing is free and Surprise stays STABLE (no re-roll on tab-back).
    if (_sectionsCache) return _sectionsCache;
    return (_sectionsCache = _computeSections());
  }
  function _computeSections() {
    // ready tracks lead every rail so the jukebox always opens on something playable. Only lightly float
    // a couple of ready leads (stable) so each rail keeps its OWN distinct order instead of collapsing to
    // the same playable few — the 4 rails must show DIFFERENT songs even when metadata is sparse.
    const readyFirst = (arr) => arr.slice().sort((x, y) => (trackReady(y) ? 1 : 0) - (trackReady(x) ? 1 : 0));
    // content-cleanup: like readyFirst, but floats the highest-CONFIDENCE tracks to the head (see _discoverConfident)
    // — biases Featured/Hot away from likely-dead picks. Stable + non-destructive: it only REORDERS, never drops.
    const confidentFirst = (arr) => arr.slice().sort((x, y) => (_discoverConfident(y) ? 1 : 0) - (_discoverConfident(x) ? 1 : 0));
    // SALTED per-track hash (stable across reloads) → each rail gets an INDEPENDENT permutation, so the
    // rails stay distinct even when created_at/play_count are all empty (different salt = different order).
    const hsh = (t, salt) => { var s = salt + String(t.id || t.title || ''), h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; };
    const dateOf = (t) => (typeof t.created_at === 'number' ? t.created_at : Date.parse(t.created_at)) || 0;   // build58: created_at is already normalized to ms (loadCatalog/mock) — Date.parse(number) was NaN→0, collapsing "New" to the hash order (a fresh upload never surfaced first)
    const feat = catalogTracks.filter(t => t.featured);
    // FEATURED: real featured flags first; fallback = a curated slice on the 'F' permutation. confidence-first
    // so a curated card isn't a likely-dead pick.
    const featured = confidentFirst((feat.length ? feat : catalogTracks.slice()).sort((a, b) => hsh(a, 'F') - hsh(b, 'F'))).slice(0, 24);
    // HOT: play_count desc, then the 'H' permutation (distinct from Featured/New). confidence-first.
    const hot = confidentFirst(catalogTracks.slice().sort((a, b) => ((b.play_count || 0) - (a.play_count || 0)) || (hsh(a, 'H') - hsh(b, 'H')))).slice(0, 24);
    // NEW: newest-first by created_at, then the 'N' permutation when dates tie. Intentionally keeps readyFirst
    // (NOT confidence-first) — "New" must stay chronological; a fresh upload is usually chart_status:'pending',
    // not 'failed', so confidence-biasing would only fight its whole purpose.
    const fresh = readyFirst(catalogTracks.slice().sort((a, b) => (dateOf(b) - dateOf(a)) || (hsh(a, 'N') - hsh(b, 'N')))).slice(0, 24);
    // SURPRISE: front-load CONFIDENT picks (a dead Surprise burns first impressions) WITHOUT thinning the rail —
    // shuffle confident + the rest independently (unbiased Fisher-Yates), then confident-first. Falls back to the
    // full pool when nothing is confident, so the rail is never emptied. Memoized in _sectionsCache so Surprise
    // stays STABLE per load (no re-roll on tab-back).
    const readyPool = catalogTracks.filter(trackReady);
    const basePool = (readyPool.length ? readyPool : catalogTracks).slice();
    const _shuf = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    const pool = _shuf(basePool.filter(_discoverConfident)).concat(_shuf(basePool.filter(function (t) { return !_discoverConfident(t); })));
    // GOLDEN BUZZER rail: the flagged winners (ready-first, capped like the others). Empty until the backend
    // flags any → the 'golden' tab stays hidden (jukebox.js gates the tab on this being non-empty).
    const golden = readyFirst(catalogTracks.filter(goldenBuzzer)).slice(0, 24);
    return { featured, hot, new: fresh, surprise: pool.slice(0, 24), golden };
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
    let src = 'assets/lunar-waves.mp3'; // demo-card / mock-catalog fallback ONLY (never substituted for a real track — see below)
    if (catalogLive && track && track.id && track.id !== 'demo') {
      // build181 (audit P1): resolve the preview through the SAME HLS-skipping, audio_url-first resolver the
      // launch path uses (trackAudioUrl). The old inline list (analysis||wav||stream||demo) could hand a bare
      // <audio> an HLS .m3u8 (silent dead preview) or — worse — fall back to the lunar-waves DEMO track and play
      // it as if it were the artist's song: a trust-destroying first impression feeding the preview→play cliff.
      // No playable source → NO preview at all (honest silence beats the wrong song).
      try {
        const t = await api('/track/' + track.id, { auth: true });
        const u = trackAudioUrl(t);
        if (!u) return;
        src = u;
      } catch (e) { return; }
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
    // D1 (ratings): community rating line under the meta — DEFENSIVE (renders nothing until the backend ships
    // the aggregate). ★★★★☆ 4.2 (18) · FEEL: <chip> for the selected difficulty tier (falls back to overall).
    _renderSheetRating(track);
    if (catalogLive && track.id && track.id !== 'demo') logUse(track.id, 'loaded');

    const liveTrack = catalogLive && track.id && track.id !== 'demo';
    const ready = trackReady(track);
    const status = trackStatus(track);

    const playBtn = $('play-btn');
    const playLabel = playBtn ? playBtn.querySelector('span') : null;
    const vid = isVideo(track);   // a music video / film \u2014 never launchable into the rhythm engine (deferred)
    // build99T: the DIFFICULTY + ENVIRONMENT pickers are for MUSIC tracks only. A film (AI Flix) is its OWN level \u2014
    // the video IS the stage \u2014 so a film shows NEITHER picker (owner: "videos just play in the video level, no level
    // picker"). Reset both visible each open (for music), then hide BOTH for any film below.
    { const _envSec = $('env-section'); if (_envSec) _envSec.style.display = ''; }
    { const _diffSec = $('diff-grid'); if (_diffSec) _diffSec.style.display = ''; }
    if (vid) {
      { const _es = $('env-section'); if (_es) _es.style.display = 'none'; }     // film = the video is the stage, no env picker
      { const _dg = $('diff-grid'); if (_dg) _dg.style.display = ''; }           // build100q (owner): flix levels DO get the Easy/Med/Hard picker — videos chart from audio, so difficulty is meaningful
      // build98: AI FLIXS PLAYABLE LEVEL. If the film has DECODABLE audio, PLAY launches the rhythm level with the music
      // video full-screen behind the highway (notes charted to the song). HLS-only films (no decodable audio rendition \u2014
      // 31 of 143 today, pending a Lovable audio.m4a rendition) can't be charted client-side \u2192 a CLEAN Watch preview
      // (never a fake level picker). build99N already lists all 143 films; this build98 path decides play-vs-watch.
      const aurl = trackAudioUrl(track);
      const wsrc = videoWatchUrl(track);
      if (aurl) {
        // build188 (Fable ruling \u00a73): the hint SELLS the format instead of just instructing a tap.
        $('sheet-hint').textContent = 'The film is the level \u2014 it plays full-screen behind your highway, charted live from its soundtrack.';
        if (playBtn) { playBtn.disabled = false; playBtn.classList.remove('not-ready'); }
        if (playLabel) playLabel.textContent = '\u25b6 PLAY AI FLIX';
        const _flixFn = () => { playFlix(track); };
        _flixFn._preview = true;   // bypass the env-picker wrapper \u2014 the flix manages its OWN #bg-video backdrop
        window.RhythmGame.setMenuPlayHandler(_flixFn);
        sheet.classList.add('open');
        return;
      }
      // no decodable audio \u2192 CINEMA (watch-only). build188 (Fable ruling \u00a73): the old copy buried "coming soon"
      // mid-sentence where a skimming thumb never read it, and "preview" undersold what is actually the FULL film.
      // Lead with the limitation, then give the watch its own dignity \u2014 this is real creator work, not a broken card.
      $('sheet-hint').textContent = wsrc
        ? 'Watch-only for now \u2014 this film\u2019s playable level is in the works. Enjoy the full film in cinema view.'
        : 'This film is still being prepared for cinema view.';
      if (playBtn) { playBtn.disabled = !wsrc; playBtn.classList.toggle('not-ready', !wsrc); }
      // build100e (relatability) / build188: the \u25b6 play triangle is a PROMISE \u2014 it appears ONLY on the chartable
      // "PLAY AI FLIX" case. Watch-only uses the eye + "WATCH FILM" so playable-level vs cinema reads instantly.
      if (playLabel) playLabel.textContent = wsrc ? '\ud83d\udc41 WATCH FILM' : 'Coming soon';
      if (wsrc) {
        const _watchFn = () => { closeSheet(); openWatch(track, wsrc); };
        _watchFn._preview = true;
        window.RhythmGame.setMenuPlayHandler(_watchFn);
        sheet.classList.add('open');
        return;
      }
    } else if (!ready) {
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
      if (!trackReady(track) || isVideo(track)) return;   // hard guard: never start a dead song or a video
      closeSheet();
      stopPreview();
      currentTrack = track;
      // Golden Buzzer launch flourish — one-time crowd cheer (mute/SFX-gated inside playCheer; procedural, no asset).
      try {
        if (goldenBuzzer(track) && window.RhythmGame && window.RhythmGame.playCheer) {
          setTimeout(function () { try { window.RhythmGame.playCheer(); } catch (e) {} }, 600);
        }
      } catch (e) {}
      // build58: a plain free-play must NOT bank stars onto a previously-played campaign level (stale _activeLevel).
      // build59 FIX: but the sheet's env-picker wrapper (index.html setMenuPlayHandler) STAGES the chosen environment
      // (_isEnv) right BEFORE this fires — clearing it here is what made "Play this song in the X environment" load the
      // DEFAULT. So only scrub when the active level is NOT a deliberately-staged env.
      try {
        var _stagedEnv = window.RhythmLibrary && window.RhythmLibrary.activeLevel && window.RhythmLibrary.activeLevel();
        if (!(_stagedEnv && _stagedEnv._isEnv) && window.RhythmLevels && window.RhythmLevels.clearEnvironment) window.RhythmLevels.clearEnvironment();
      } catch (e) {}
      // build126: route by the track's own playability (isLaunchable), not `catalogLive` — same fix/rationale as
      // launchTrack(). A track that carries a server chart or a decodable audio_url must play THAT track, never the
      // demo, even if the catalog crawl hasn't flipped catalogLive yet. Mock rows (no audio_url) still hit playDemo.
      if (hasServerChart(track) && track.id && track.id !== 'demo' && !track.demo && (catalogLive || track._review)) {
        window.RhythmGame.play(liveProvider(track.id));               // server chart → scored + leaderboard
      } else if (isLaunchable(track)) {
        window.RhythmGame.playUrl(trackAudioUrl(track), {            // fast path → chart in-browser
          id: track.id,                                             // carry the track id for telemetry (song_start/complete)
          title: track.title,
          artist: track.artist_credit_name || track.artist_name,
          genre: track.genre,
          artwork: track.artwork_url,
        });
      } else {
        window.RhythmGame.playDemo();
      }
    });

    // ---- PRACTICE panel wiring (chartable MUSIC tracks only). A film / unplayable / demo row hides it entirely.
    setupPracticePanel(track, (vid || !ready || !isLaunchable(track)));

    sheet.classList.add('open');
  }

  // D1 (ratings): render/refresh the community rating line inside the track sheet. DEFENSIVE end-to-end —
  // reads track.rating_avg / .rating_count / .felt_median off the track object (all ABSENT until Lovable ships
  // the aggregate → renders nothing, never throws, never shows "0 ratings"). n>=3 display threshold (owner-locked).
  // Creates a #sheet-rating sibling of #sheet-meta once (JS-only, no index.html markup change) and reuses it.
  function _renderSheetRating(track) {
    try {
      var host = $('sheet-meta'); if (!host || !host.parentNode) return;
      var line = document.getElementById('sheet-rating');
      if (!line) {
        line = document.createElement('div');
        line.id = 'sheet-rating';
        line.style.cssText = 'font-family:\'Chakra Petch\',sans-serif;font-size:11px;letter-spacing:0.06em;margin-top:6px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;';
        host.parentNode.insertBefore(line, host.nextSibling);
      }
      while (line.firstChild) line.removeChild(line.firstChild);
      var avg = Number(track && track.rating_avg), cnt = Number(track && track.rating_count);
      var hasAgg = isFinite(avg) && isFinite(cnt) && cnt >= 3;
      // felt_median chip uses the tier the player has selected in the sheet, falling back to overall (_feltMedian).
      var tier = null;
      try { var ab = document.querySelector('#diff-grid .diff-btn.active'); tier = ab && ab.getAttribute('data-diff'); } catch (e) {}
      var feelTxt = _feelLabel(_feltMedian(track && track.felt_median, tier));
      if (!hasAgg && !feelTxt) { line.style.display = 'none'; return; }
      line.style.display = 'flex';
      if (hasAgg) {
        var full = Math.max(0, Math.min(5, Math.round(avg)));
        var stars = document.createElement('span');
        stars.style.cssText = 'color:#e0a93f;letter-spacing:1px;';
        var s = ''; for (var i = 1; i <= 5; i++) s += (i <= full ? '★' : '☆');
        stars.textContent = s;
        line.appendChild(stars);
        var num = document.createElement('span');
        num.style.cssText = 'font-family:Oxanium,sans-serif;color:#e0a93f;font-weight:600;';
        num.textContent = avg.toFixed(1) + ' (' + cnt + ')';
        line.appendChild(num);
      }
      if (feelTxt) {
        if (hasAgg) { var sep = document.createElement('span'); sep.style.cssText = 'color:var(--ink-dim,#8a807a);'; sep.textContent = '·'; line.appendChild(sep); }
        var lab = document.createElement('span'); lab.style.cssText = 'color:var(--ink-dim,#8a807a);'; lab.textContent = 'FEEL:'; line.appendChild(lab);
        var chip = document.createElement('span');
        chip.style.cssText = 'font-family:Oxanium,sans-serif;font-weight:700;color:#ece7e3;background:rgba(60,54,50,0.55);border:1px solid rgba(224,169,63,0.4);border-radius:6px;padding:1px 7px;letter-spacing:0.08em;';
        chip.textContent = feelTxt;
        line.appendChild(chip);
      }
    } catch (e) {}
  }

  // ===== PRACTICE MODE — song-sheet panel =====
  // Parses/validates a section + speed, then launches a NEVER-SCORED drill run via RhythmGame.playPractice.
  const PP_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];
  function ppLoadSpeed() { try { const v = parseFloat(localStorage.getItem('rr_practice_speed')); return PP_SPEEDS.indexOf(v) >= 0 ? v : 1; } catch (e) { return 1; } }
  function ppSaveSpeed(v) { try { localStorage.setItem('rr_practice_speed', String(v)); } catch (e) {} }
  function ppParseTime(str) {
    // accept "m:ss", "mm:ss", or a bare seconds count; returns seconds (NaN if unparseable)
    if (str == null) return NaN;
    str = String(str).trim();
    if (!str) return NaN;
    if (str.indexOf(':') >= 0) {
      const parts = str.split(':');
      const m = parseInt(parts[0], 10), s = parseInt(parts[1], 10);
      if (!isFinite(m) || !isFinite(s)) return NaN;
      return m * 60 + Math.min(59, Math.max(0, s));
    }
    const n = parseFloat(str);
    return isFinite(n) ? n : NaN;
  }
  function ppFmt(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  let _ppWired = false;
  function setupPracticePanel(track, hide) {
    const openBtn = document.getElementById('practice-open-btn');
    const panel = document.getElementById('practice-panel');
    if (!openBtn || !panel) return;
    if (hide) { openBtn.hidden = true; panel.hidden = true; openBtn.setAttribute('aria-expanded', 'false'); return; }
    openBtn.hidden = false;

    // duration for clamping (track metadata; the decoded buffer is authoritative but not known until launch)
    const dur = Math.max(1, Math.floor(track.duration_seconds || 0)) || 0;
    const startEl = document.getElementById('pp-start');
    const endEl = document.getElementById('pp-end');
    // default full song each open
    if (startEl) startEl.value = '0:00';
    if (endEl) endEl.value = dur ? ppFmt(dur) : '0:00';
    // restore last-used speed
    let curSpeed = ppLoadSpeed();
    const spdBtns = Array.prototype.slice.call(panel.querySelectorAll('.pp-spd'));
    spdBtns.forEach(b => { const on = (parseFloat(b.dataset.spd) === curSpeed); b.classList.toggle('active', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    // collapse panel on every (re)open
    panel.hidden = true; openBtn.setAttribute('aria-expanded', 'false');

    // wire the interactive controls ONCE (idempotent — these read the LIVE closured currentTrack/dur via the DOM).
    if (!_ppWired) {
      _ppWired = true;
      openBtn.addEventListener('click', () => {
        const show = panel.hidden;
        panel.hidden = !show;
        openBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
      });
      panel.querySelectorAll('.pp-spd').forEach(b => {
        b.addEventListener('click', () => {
          const v = parseFloat(b.dataset.spd);
          ppSaveSpeed(v);
          panel.querySelectorAll('.pp-spd').forEach(x => { const on = (x === b); x.classList.toggle('active', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
        });
      });
      const fullBtn = document.getElementById('pp-full');
      if (fullBtn) fullBtn.addEventListener('click', () => {
        const d = _ppDur || 0;
        if (startEl) startEl.value = '0:00';
        if (endEl) endEl.value = d ? ppFmt(d) : '0:00';
      });
      const startPBtn = document.getElementById('pp-start-btn');
      if (startPBtn) startPBtn.addEventListener('click', () => launchPractice());
    }
    _ppDur = dur;
  }
  let _ppDur = 0;
  function launchPractice() {
    const track = currentTrack;
    if (!track || !isLaunchable(track)) { window.RhythmGame && window.RhythmGame.showToast && window.RhythmGame.showToast('This track can’t be practiced', 'error'); return; }
    const startEl = document.getElementById('pp-start');
    const endEl = document.getElementById('pp-end');
    const panel = document.getElementById('practice-panel');
    const dur = _ppDur || Math.floor(track.duration_seconds || 0) || 0;
    let start = ppParseTime(startEl ? startEl.value : '0');
    let end = ppParseTime(endEl ? endEl.value : '');
    if (!isFinite(start)) start = 0;
    // if end unparseable / <= start / beyond song → treat as full-song-from-start.
    let section = null;
    if (dur > 0) {
      start = Math.max(0, Math.min(start, dur - 1));
      if (!isFinite(end) || end <= start || end > dur) end = dur;
    } else {
      // no known duration → let end stand if valid & > start, else full song (null section)
      if (!isFinite(end) || end <= start) end = null;
    }
    if (end != null && end > start) section = { start: start, end: end };
    // if start==0 and end==dur, section covers the whole song — still launch as practice (loops the full track).
    let speed = ppLoadSpeed();

    // reflect the clamped values back to the inputs so the user sees what will run
    if (startEl) startEl.value = ppFmt(start);
    if (endEl && section) endEl.value = ppFmt(section.end);

    closeSheet(); stopPreview();
    currentTrack = track;
    // Route to the in-browser chart path (the ONLY practice-capable path — needs a decodable audio_url).
    window.RhythmGame.playPractice(trackAudioUrl(track), {
      id: track.id, title: track.title,
      artist: track.artist_credit_name || track.artist_name, genre: track.genre, artwork: track.artwork_url,
    }, section, speed);
    if (panel) panel.hidden = true;
  }
  function closeSheet() { sheet.classList.remove('open'); }

  // AI Flixs interim WATCH overlay — muted inline <video> preview ONLY (never the rhythm engine). Phase 5.
  function openWatch(track, src) {
    let ov = document.getElementById('flix-watch');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'flix-watch'; ov.className = 'flix-watch';
      // build188 (Fable director's flag): a bare browser-chrome <video> popup inside our black/crimson world read
      // as a BUG on stage even when it was the correct fallback. It's now a branded CINEMA frame: chrome tag,
      // title in Oxanium, letterboxed film, and an end-of-film CTA back into the playable loop.
      ov.innerHTML = '<div class="fw-scrim"></div>' +
        '<div class="fw-box"><button class="fw-close" type="button" aria-label="Close">✕</button>' +
        '<div class="fw-head"><span class="fw-tag">CINEMA</span><span class="fw-title"></span></div>' +
        '<video class="fw-video" playsinline muted controls preload="metadata"></video>' +
        '<div class="fw-cap"></div>' +
        '<div class="fw-end" hidden><span class="fw-end-t">Want one you can PLAY?</span>' +
        '<button class="fw-end-cta" type="button">▶ PLAY A LIVE FLIX</button></div></div>';
      document.body.appendChild(ov);
      ov.querySelector('.fw-scrim').addEventListener('click', closeWatch);
      ov.querySelector('.fw-close').addEventListener('click', closeWatch);
      // build93 (playtest): Esc closes the Watch overlay — the owner plays keyboard, and this was the lone
      // modal without a keyboard dismiss. Capture-phase + open-gated so it only fires while the overlay is up.
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('open')) { e.stopImmediatePropagation(); closeWatch(); } }, true);
      // build188: end-of-film CTA → close the cinema and drop the player into the PLAYABLE films (the fallback
      // now converts instead of dead-ending). Guarded: if the jukebox isn't reachable, it just closes.
      const _endV = ov.querySelector('.fw-video');
      if (_endV) _endV.addEventListener('ended', function () { const e2 = ov.querySelector('.fw-end'); if (e2) e2.hidden = false; });
      const _cta = ov.querySelector('.fw-end-cta');
      if (_cta) _cta.addEventListener('click', function () {
        closeWatch();
        try {
          const playables = videoTracks().filter(flixPlayable);
          if (playables.length && window.RhythmLibrary && window.RhythmLibrary.openSongs) {
            window.RhythmLibrary.openSongs(playables, 'AI Flixs', 'browse', '', true, true);
          }
        } catch (e) {}
      });
    }
    const v = ov.querySelector('.fw-video');
    v.poster = posterFor(track); v.src = src;
    { const _t = ov.querySelector('.fw-title'); if (_t) _t.textContent = track.title || ''; }
    { const _e = ov.querySelector('.fw-end'); if (_e) _e.hidden = true; }   // reset the end CTA for each open
    ov.querySelector('.fw-cap').textContent = (track.artist_name || '');
    ov.classList.add('open');
    const p = v.play && v.play();
    if (p && p.catch) p.catch(() => { try { window.open(src, '_blank', 'noopener'); closeWatch(); } catch (e) {} });   // HLS / autoplay-blocked → new tab
    if (catalogLive && track.id) logUse(track.id, 'preview', { kind: 'watch' });
  }
  function closeWatch() {
    const ov = document.getElementById('flix-watch'); if (!ov) return;
    const v = ov.querySelector('.fw-video'); try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    ov.classList.remove('open');
  }

  // ============================================================================
  // build98: AI FLIXS PLAYABLE LEVEL — the music VIDEO plays FULL-SCREEN behind the guitar highway while you
  // play Guitar Hero to the song. The notes are charted from the track's DECODABLE audio (the normal in-browser
  // chart path — decode audio_url → analyzeBeats → DemoPlayer), and the muted video is slaved to the audio clock
  // (#bg-video, the same backdrop element journey levels use). audio_url and video_url share the same source, so
  // they stay in sync. Falls back to the Watch preview only when the film has no decodable audio.
  // ============================================================================
  let _flixRaf = 0, _flixPrevSrc = null, _flixActive = false, _flixVideoUrl = '', _flixSawActive = false;
  let _flixFailT = 0;   // finding #2: stopwatch (ms) since a launched flix left the loading screen WITHOUT ever activating #game → a failed decode/chart; 0 = not counting
  // build99f (playtest P0): ~7% of the Mux-hosted films are missing their audio.m4a rendition, so a deterministic
  // featured film (or a tapped card) could 404 and dead-end on the loading screen — the worst first-impression bug
  // on the flagship feature. Probe audio reachability once per film (session-cached) so the premiere hero can
  // self-heal to a PLAYABLE film and known-bad films fall back to the trailer instead of dead-ending.
  const _flixAudioCache = new Map();   // trackId → true (reachable) | false (404/err)
  function probeFlixAudio(track) {
    const id = track && track.id; if (!id) return Promise.resolve(false);
    if (_flixAudioCache.has(id)) return Promise.resolve(_flixAudioCache.get(id));
    const url = trackAudioUrl(track);
    if (!url) { _flixAudioCache.set(id, false); return Promise.resolve(false); }
    return fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1' } })   // 1-byte range = cheap reachability check
      .then(function (r) { const ok = !!(r && (r.ok || r.status === 206)); _flixAudioCache.set(id, ok); return ok; })
      .catch(function () { _flixAudioCache.set(id, false); return false; });
  }
  async function firstPlayableFlix(films, max) {
    const list = (films || []).filter(Boolean);
    const n = Math.min(list.length, max || 8);
    for (let i = 0; i < n; i++) { try { if (await probeFlixAudio(list[i])) return list[i]; } catch (e) {} }
    return list[0] || null;   // none verified quickly → fall back to the first (it may still work; play-path handles failure)
  }
  function playFlix(track) {
    const aurl = trackAudioUrl(track);            // decodable music → the chart + the audio + the clock
    const vurl = videoWatchUrl(track);            // the music video → the full-screen backdrop
    if (!aurl) { if (vurl) openWatch(track, vurl); return; }   // no chartable audio → fall back to the Watch preview
    // known-bad audio (already probed 404) → don't dead-end on the loading screen; show the trailer instead.
    // build100d (bug-swarm): ALWAYS return on a known-bad probe — if there's also no watch url, bail with a toast
    // rather than falling through to playUrl with the dead audio (which 404s on the loading screen, no Watch fallback).
    if (track && _flixAudioCache.get(track.id) === false) {
      if (vurl) { openWatch(track, vurl); }
      else { try { window.RhythmGame.showToast && window.RhythmGame.showToast('This film isn’t playable yet', 'neutral'); } catch (e) {} }
      return;
    }
    closeSheet(); stopPreview(); currentTrack = track;
    // build99e (owner): a flix uses the player's EQUIPPED guitar — the clean default crimson for anyone who hasn't
    // equipped a skin (so the music video reads), and their own skin if they chose one. Drop any leftover per-level
    // skin/environment first so a film can never inherit a campaign level's guitar. (clearEnvironment sets
    // _levelSkinActive=false → the play-setup re-applies the equipped/default skin.) The flix video backdrop is set
    // right after + re-asserted each frame, so clearing the env's backdrop here is harmless.
    try { if (window.RhythmLevels && window.RhythmLevels.clearEnvironment) window.RhythmLevels.clearEnvironment(); } catch (e) {}
    _startFlixBackdrop(vurl || aurl);
    window.RhythmGame.playUrl(aurl, {              // chart + play exactly like a live track
      id: track.id, title: track.title, artist: track.artist_credit_name || track.artist_name,
      genre: track.genre, artwork: track.artwork_url, flix: true,
    });
    try { window.RhythmGame.onSongEnd && window.RhythmGame.onSongEnd(function () { _stopFlixBackdrop(); }); } catch (e) {}
    if (catalogLive && track.id) logUse(track.id, 'play', { kind: 'flix' });
  }
  function _startFlixBackdrop(videoUrl) {
    const bv = document.getElementById('bg-video'); if (!bv || !videoUrl) return;
    _flixActive = true; _flixVideoUrl = videoUrl; _flixSawActive = false; _flixFailT = 0;   // reset the failed-launch stopwatch for this fresh flix
    _flixPrevSrc = bv.getAttribute('src') || '';
    const g = document.getElementById('game'); if (g) g.classList.add('flix-mode');
    try { bv.pause(); } catch (e) {}
    bv.muted = true; bv.loop = false; bv.setAttribute('src', videoUrl); try { bv.load(); } catch (e) {}
    const p0 = bv.play && bv.play(); if (p0 && p0.catch) p0.catch(function () {});
    if (_flixRaf) cancelAnimationFrame(_flixRaf);
    (function frame() {
      _flixRaf = requestAnimationFrame(frame);
      if (!_flixActive) return;
      const g2 = document.getElementById('game');
      const active = !!(g2 && g2.classList.contains('active'));
      if (active) _flixSawActive = true;
      // tear down ONLY after a real run actually started then ended (was-active → not-active). Do NOT tear down during
      // the ~4s decode/lead-in BEFORE the game first activates (that bug restored moon-loop before play even began).
      if (_flixSawActive && !active) { _stopFlixBackdrop(); return; }
      // finding #2 — FAILED-LAUNCH LEAK GUARD. A flix whose audio can't decode/chart NEVER reaches showScreen('game'),
      // so #game never goes .active, _flixSawActive stays false, and the was-active→not-active teardown above never
      // fires. Without this, the loop re-asserts the dead flix video as the backdrop for the REST OF THE SESSION —
      // wrong video on the menu and every later song, burning CPU/battery. A HEALTHY launch spends its whole (up-to-
      // several-second) decode on the LOADING screen and then flips #game .active; the failure path bails to #menu.
      // So: once we've LEFT loading and the engine reports no live run yet #game never activated, start a grace
      // stopwatch (a timestamp, NOT a single frame — absorbs the between-screen swap) and tear down if it holds ~2s.
      // Gating on !loading is what protects a slow-but-healthy decode from being mistaken for a failure.
      if (!_flixSawActive) {
        var ld = document.getElementById('loading');
        var stillLoading = !!(ld && ld.classList.contains('active'));
        var lst = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;
        var noRun = !lst || (!lst.playing && !(lst.progress > 0));   // engine has no live run going
        if (!stillLoading && noRun) {
          if (!_flixFailT) _flixFailT = performance.now();
          else if (performance.now() - _flixFailT > 2000) { _stopFlixBackdrop(); return; }
        } else {
          _flixFailT = 0;   // still loading (healthy decode) or a run appeared → not a failed launch; reset the stopwatch
        }
      }
      // re-assert the flix video + class if the engine's play-setup reset #bg-video to the default backdrop.
      if (bv.getAttribute('src') !== _flixVideoUrl) {
        bv.muted = true; bv.loop = false; bv.setAttribute('src', _flixVideoUrl); try { bv.load(); } catch (e) {}
        const pr = bv.play && bv.play(); if (pr && pr.catch) pr.catch(function () {});
      }
      if (g2 && !g2.classList.contains('flix-mode')) g2.classList.add('flix-mode');
      // slave the muted video to the audio clock. progress (0→1) is 0 through the 3·2·1 lead-in, then climbs once the
      // music plays — and the video shares the song's Mux source, so progress*duration ≈ the audio position. (There is
      // no public song-time getter on RhythmGame, so progress is the sync source.)
      const st = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;
      if (st && bv.readyState >= 2 && bv.duration) {
        if (st.progress <= 0) {
          // lead-in / countdown: hold the very first frame, don't let it run ahead (avoids a rewind when music starts)
          try { if (!bv.paused) bv.pause(); if (bv.currentTime > 0.05) bv.currentTime = 0; } catch (e) {}
        } else {
          if (bv.paused) { const pp = bv.play && bv.play(); if (pp && pp.catch) pp.catch(function () {}); }
          const target = st.progress * bv.duration;
          if (Math.abs(bv.currentTime - target) > 0.40) { try { bv.currentTime = target; } catch (e) {} }   // soft re-sync only on real drift
        }
      }
    })();
  }
  function _stopFlixBackdrop() {
    if (!_flixActive) return;
    _flixActive = false;
    if (_flixRaf) { cancelAnimationFrame(_flixRaf); _flixRaf = 0; }
    const bv = document.getElementById('bg-video');
    if (bv) { try { bv.pause(); } catch (e) {} try { if (_flixPrevSrc) bv.setAttribute('src', _flixPrevSrc); else bv.removeAttribute('src'); bv.load(); } catch (e) {} }
    const g = document.getElementById('game'); if (g) g.classList.remove('flix-mode');
  }

  // launch a track directly at the engine's current difficulty (used by the Levels picker — no sheet)
  function launchTrack(track, opts) {
    if (!track || !trackReady(track) || isVideo(track)) return false;   // never launch a video into the rhythm engine
    stopPreview();
    currentTrack = track;
    // Golden Buzzer launch flourish — one-time crowd cheer (mute/SFX-gated inside playCheer; procedural, no asset).
    try {
      if (goldenBuzzer(track) && window.RhythmGame && window.RhythmGame.playCheer) {
        setTimeout(function () { try { window.RhythmGame.playCheer(); } catch (e) {} }, 600);
      }
    } catch (e) {}
    // build59 FIX: a plain-track launch clears any stale campaign _activeLevel so its results can't false-credit a level.
    // But launchLevel passes {keepEnvironment:true} — it has JUST set up the level's journey/skin/theme + _activeLevel, and
    // clearing here was wiping it so EVERY authored level loaded as the default (moon-loop, no journey). Only clear for a
    // genuine plain-track launch. (The jukebox free-play path doesn't even reach here — it clears in its own handler.)
    if (!(opts && opts.keepEnvironment)) {
      try { if (window.RhythmLevels && window.RhythmLevels.clearEnvironment) window.RhythmLevels.clearEnvironment(); } catch (e) {}
    }
    // build102y step6: BEAT THAT ghost target — display-only HUD hook (gold pill + BEAT IT! flash in game.js).
    // Set on ghost-duel launches, NULLED on every plain launch so a stale target can't leak into the next run.
    try { if (window.RhythmGame.setGhostTarget) window.RhythmGame.setGhostTarget((opts && opts.targetScore) ? { score: opts.targetScore, name: opts.targetName } : null); } catch (e) {}
    // build126 FIX: route by the TRACK's own playability, NOT `catalogLive`. A review deep-launch resolves its track
    // (with a decodable audio_url) in parallel with the catalog crawl, so the host can press PLAY before catalogLive
    // flips true — the old `catalogLive &&` gate then sent that resolvable track to the LUNAR WAVES demo (the P0 the
    // owner watched live). The audio_url branch (isLaunchable) is now catalog-INDEPENDENT — it plays the track's OWN
    // decodable url, so a real track (review OR catalog) always wins over the demo. The server-chart branch still
    // gates on catalogLive||_review: liveProvider() re-fetches /track/:id, meaningless for a fake MOCK-preview row
    // (id 'm5' with a synthetic has_chart) — so a mock row (catalogLive false, no _review) skips it, finds no
    // audio_url, and correctly falls to the preview demo, byte-identical to before.
    if ((opts && opts.bridgeRun) && isLaunchable(track)) {
      // FIRST PULSE bridge run: force the in-browser MEDIUM chart (the REAL Medium density/speed, deterministic
      // client-side) — deliberately BEFORE the server-chart branch so a bridge NEVER routes a scored liveProvider.
      // game.js (seeing the bridgeRun opt) forces difficulty=medium, eases judging to Easy's 0.20 window, and stamps
      // results.preview=true → UNRANKED (recordLocal + every submit path early-return).
      window.RhythmGame.playUrl(trackAudioUrl(track), {
        id: track.id,
        title: track.title, artist: track.artist_credit_name || track.artist_name, genre: track.genre, artwork: track.artwork_url,
      }, { bridgeRun: true });
    } else if (hasServerChart(track) && track.id && track.id !== 'demo' && !track.demo && (catalogLive || track._review)) {
      window.RhythmGame.play(liveProvider(track.id));               // pre-baked chart → scored + leaderboard
    } else if (isLaunchable(track)) {
      window.RhythmGame.playUrl(trackAudioUrl(track), {             // decodable audio_url → chart in-browser
        id: track.id,   // carry the track id for telemetry (song_start/complete)
        title: track.title, artist: track.artist_credit_name || track.artist_name, genre: track.genre, artwork: track.artwork_url,
      });
    } else {
      window.RhythmGame.playDemo();                                  // genuinely unplayable (mock preview / demo) → demo
    }
    return true;
  }

  // FIRST PULSE (Wave-4 onboarding bridge) — re-launch the CURRENT track as an UNRANKED bridge run: the REAL Medium
  // chart judged at Easy's forgiving window. game.js owns the window override, the difficulty force, and the unranked
  // (results.preview) stamping; catalog just re-routes the current track through launchTrack with the bridge opt.
  // Requires a decodable audio_url (isLaunchable) so the Medium chart is built in-browser — a bridge NEVER submits.
  function launchBridgeRun() {
    var t = currentTrack;
    if (!t || !isLaunchable(t)) {
      try { if (window.RhythmGame && window.RhythmGame.showToast) window.RhythmGame.showToast('Bridge run needs the full track — pick another song', 'neutral'); } catch (e) {}
      return false;
    }
    return launchTrack(t, { bridgeRun: true });
  }
  // Can the current track launch a FIRST PULSE bridge run? Drives whether game.js shows the "READY FOR PULSE?" offer.
  function bridgeReady() { return !!(currentTrack && isLaunchable(currentTrack)); }

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
      attempts: c.attempts || ((c.runs || 0) + (c.fails || 0)), fails: c.fails || 0,
      notesHit: c.notesHit || 0, notesTotal: c.notesTotal || 0,
      bestCombo: c.bestCombo || 0, fullCombos: c.fullCombos || 0,
      grades: Object.assign({ S: 0, A: 0, B: 0, C: 0, D: 0 }, c.grades || {}),
      songs: c.songs || {}, firstPlay: c.firstPlay || 0, lastPlay: c.lastPlay || 0,
    };
  }
  const GRADE_ORDER = { D: 0, C: 1, B: 2, A: 3, S: 4 };

  // small inline spark glyph (matches the store's SPARK_SVG path) so the results reward line is self-contained.
  const BONUS_SPARK_GLYPH = '<svg class="bonus-spk-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 13.2a.7.7 0 0 0 .56 1.12H11l-1.4 8L19.5 10.8a.7.7 0 0 0-.56-1.12H13l0-7.68z"/></svg>';
  // Paint the "+N BONUS SPARKS" reward line on the results screen. Idempotent per run — the element
  // is filled fresh each render. Only ever called for completed (non-failed) runs.
  function renderBonusSparksLine(earned, balance) {
    const el = document.getElementById('results-bonus');
    if (!el) return;
    el.innerHTML =
      '<span class="rbonus-amt">+' + Number(earned).toLocaleString() + '</span>' +
      BONUS_SPARK_GLYPH +
      '<span class="rbonus-label">BONUS SPARKS</span>' +
      '<span class="rbonus-total">balance ' + Number(balance).toLocaleString() + '</span>' +
      // build100e (relatability): tell a newcomer what the reward is FOR — connect earning to spending in one line.
      '<span class="rbonus-hint" style="flex-basis:100%;font-size:10px;letter-spacing:0.08em;color:#b9b2ac;margin-top:2px;">Spend in the Store on guitars &amp; levels</span>';
    el.style.display = '';
  }
  // build110: Paint the "+N XP" reward line on the results screen — same idempotent-per-run pattern as
  // renderBonusSparksLine, but visually/physically SEPARATE (own element, own gold-pill styling) so XP
  // (pure status) never blurs with Bonus Sparks (currency-adjacent platform spend) — spec §2.4 decree.
  function renderXpLine(earned) {
    const el = document.getElementById('results-xp');
    if (!el) return;
    var lvl = 1; try { if (window.RhythmGoals) lvl = window.RhythmGoals.xpState().level; } catch (e) {}
    el.innerHTML =
      '<span class="rxp-amt">+' + Number(earned).toLocaleString() + '</span>' +
      '<span class="rxp-label">XP</span>' +
      '<span class="rxp-total">LV ' + lvl + '</span>';
    el.style.display = '';
  }

  // ---------- ALWAYS-on local recorder — called by the engine on EVERY completed run,
  // including in-browser-charted tracks that have no server submit (i.e. all live tracks
  // today). This is what makes the cover-art grade chips + the Career profile reflect your
  // real play instead of only the mock seed. Leaderboard submit (below) stays separate.
  // ---- Wave-3 "TOP N% TODAY" social proof (display-only side-channel off the play response) --------------------
  // The POST /plays (and its /score alias) response now carries today_count (distinct users who played this
  // track×difficulty today UTC, caller included) and today_percentile (integer 1..100 — the caller's rank among
  // today's players, LOWER is better). We stash the LAST real run's stats so the results screen can READ them via
  // getLastPlayStats(); nothing else in the game changes. Fully graceful: the stash resets to null at every run
  // start (below) AND at the top of each capture, and is only populated on a VALID numeric percentile — so an older
  // server (fields absent), an offline / non-2xx POST (capture never runs), or a failed run (no submit) each leave
  // getLastPlayStats() === null. This never touches the request, the score payload, or any scoring — it only reads
  // two extra numbers already present on the response.
  var _lastPlayStats = null;
  function getLastPlayStats() { return _lastPlayStats; }
  function _capturePlayStats(out, trackId, diff) {
    _lastPlayStats = null;   // this response is the sole source of truth; a missing/invalid field leaves it null
    try {
      if (!out || typeof out !== 'object') return;
      var p = out.today_percentile;
      if (typeof p !== 'number' || !isFinite(p)) return;
      var pct = Math.round(p);
      if (pct < 1 || pct > 100) return;
      var c = out.today_count;
      var cnt = (typeof c === 'number' && isFinite(c) && c > 0) ? Math.round(c) : null;
      _lastPlayStats = { percentile: pct, count: cnt, trackId: trackId || null, difficulty: diff || null };
      // The play submit is async — it resolves AFTER the results screen's synchronous render — so nudge the UI to repaint the pill.
      try { window.dispatchEvent(new CustomEvent('rr:playstats')); } catch (e) {}
    } catch (e) { _lastPlayStats = null; }
  }

  function recordLocal(results) {
    if (!results) return;
    _lastPlayStats = null;   // Wave-3: each completed run resets the social-proof stash so a prior run's number can't linger
    // PRACTICE MODE hard exclusion — a drill run has ZERO competitive/economy side effects. This single early
    // return gates EVERYTHING downstream in one place: the lifetime career aggregate (block 1), the per-song best
    // + NEW BEST/GRADE UP badges (block 2), the Bonus Sparks earn loop + Daily-Rift ×3 (block 3), the RhythmGoals
    // XP/Level/Streak grant (block 3), AND the account /score leaderboard submit (block 4) all live below this line.
    if (results && (results.practice || results.isPractice)) return;
    if ((currentTrack && currentTrack._preview) || (results && results.preview)) return;   // build100h+: host review preview — NO career/best/bonus/plays/score submit (scoring:'preview_only')
    const grade = results.grade || gradeFor(results.accuracy || 0);
    const failed = !!results.failed;
    // build110: captured by block 2 below (per-song best) for the RhythmGoals hook in block 3 — a
    // trackless/zero-score run (e.g. practice demo) never sets these, so they default to "not a first clear".
    let _rrIsFirstClear = false, _rrIsGradeUp = false;
    // build100 DAILY RIFT: CONSUME the rift flag exactly once per recordLocal (pass OR fail) so a failed/bailed rift
    // run can never leak the ×3 onto a later normal run. The ×3 is applied below only for a NON-failed run; a failed
    // rift earns nothing and does NOT stamp the day done, so the player can retry today for the bonus.
    let _rift3x = false;
    _runDailyRift = false;   // build100i: reset the server-Bonus daily flag each run so a prior rift can't leak ×3 onto this run's /score|/plays
    // build100d: honor the DAILY RIFT ×3 ONLY when THIS run IS the armed daily track AND it completed (not failed).
    // Track-bound (not a boolean) so a quit/abandoned rift can't leak the ×3 onto a later non-matching run. A FAILED
    // daily run leaves the flag armed so a retry can still claim it; a non-matching run leaves it armed (waiting).
    try {
      if (_dailyRiftArmedId && currentTrack && currentTrack.id === _dailyRiftArmedId && !failed) {
        _rift3x = !!_dailyRiftTriple; _dailyRiftArmedId = null; _dailyRiftTriple = false;
      }
    } catch (e) {}
    _runDailyRift = _rift3x;   // build100i: surface to liveProvider.submit (/plays) for the rare server-charted daily track
    // 1) lifetime career aggregate — a FAILED run is an attempt, not a performance. Count it under
    // attempts/fails + timestamps only, and keep it OUT of runs/score/accuracy/grade-distribution so a
    // bailed run can't drag your lifetime accuracy down or stuff the grade chart with phantom low grades.
    try {
      const c = loadCareer();
      c.attempts = (c.attempts != null ? c.attempts : ((c.runs || 0) + (c.fails || 0))) + 1;   // build72: back-fill legacy saves (no attempts field) from runs+fails so the lifetime attempt count isn't reset to 1 on the first post-upgrade run
      const now = Date.now();
      if (!c.firstPlay) c.firstPlay = now;
      c.lastPlay = now;
      if (failed) {
        c.fails = (c.fails || 0) + 1;
      } else {
        c.runs = (c.runs || 0) + 1;
        c.score = (c.score || 0) + (results.score || 0);
        c.notesHit = (c.notesHit || 0) + (results.notes_hit || 0);
        c.notesTotal = (c.notesTotal || 0) + (results.notes_total || 0);
        c.bestCombo = Math.max(c.bestCombo || 0, results.max_combo || 0);
        if (results.full_combo) c.fullCombos = (c.fullCombos || 0) + 1;
        c.grades = c.grades || {}; c.grades[grade] = (c.grades[grade] || 0) + 1;
        // build99j (playtest P2): a completed run with no track id (e.g. the practice demo) used to credit runs/grade/
        // combo but NOT c.songs, so the profile read "Runs 1 / Full Combos 1 / Grade B" with "Songs Played 0".
        // Always record the run under a stable key (id → title → '_practice') so "songs played" can't lag the run count.
        { const songKey = (currentTrack && currentTrack.id) || (currentTrack && currentTrack.title) || (results.title) || '_practice'; c.songs = c.songs || {}; c.songs[songKey] = (c.songs[songKey] || 0) + 1; }
      }
      localStorage.setItem('rr_career', JSON.stringify(c));
    } catch (e) {}
    // 2) per-song best + NEW BEST / GRADE UP badges (compare vs REAL saved scores, not the mock seed).
    // A failed run isn't a best — don't let a bail overwrite your saved score or fire a NEW BEST badge.
    if (!failed && currentTrack && currentTrack.id && results.score > 0) {
      let prevReal = null;
      try {
        const s = loadScores();
        // build147: include 'rift' so a Daily-Rift best counts as prior best for the NEW BEST / GRADE UP compare.
        ['easy', 'medium', 'hard', 'rift'].forEach(d => { const r = s[currentTrack.id + '|' + d]; if (r && (!prevReal || r.score > prevReal.score)) prevReal = r; });
      } catch (e) {}
      const isNewBest = !prevReal || results.score > (prevReal.score || 0);
      const isGradeUp = !!prevReal && (GRADE_ORDER[grade] || 0) > (GRADE_ORDER[prevReal.grade] || 0);
      // thread these onto the results object so the Share Card (game.js share handler) can flag
      // a NEW BEST / GRADE UP run without recomputing — recordLocal runs once, right after render.
      try { results._newBest = isNewBest; results._gradeUp = isGradeUp; } catch (e) {}
      _rrIsFirstClear = (prevReal === null); _rrIsGradeUp = isGradeUp;   // build110: for the RhythmGoals XP hook below
      saveBest(currentTrack.id, results);
      const badges = document.getElementById('results-badges');
      if (badges) {
        if (isNewBest) {
          // build85 (Phase 3.1): gold "NEW BEST +X" — X = how much you beat your own prior best by.
          // build89: on a first-ever best there is no prior to beat → plain "NEW BEST" (not a confusing +<entire score>).
          const _delta = results.score - ((prevReal && prevReal.score) || 0);
          const _bestLabel = prevReal ? '★ NEW BEST +' + _delta.toLocaleString() : '★ NEW BEST';
          if (!/new best/i.test(badges.textContent)) badges.insertAdjacentHTML('afterbegin', '<span class="rbadge best">' + _bestLabel + '</span>');
        }
        if (isGradeUp && !/grade up/i.test(badges.textContent)) badges.insertAdjacentHTML('afterbegin', '<span class="rbadge gradeup">Grade Up · ' + grade + '</span>');
      }
      // build85 (Phase 3.1): next-chase CTA — only when this run did NOT beat the best (a beaten best already celebrates)
      try {
        const _blurb = document.getElementById('results-blurb');
        const _ex = document.getElementById('results-chase'); if (_ex) _ex.remove();
        if (!isNewBest && prevReal && prevReal.score > 0 && _blurb) {
          const _by = (prevReal.score - results.score);
          const _anchor = document.getElementById('results-timing') || _blurb;   // build86 (QA B85-2): land the chase BELOW the timing histogram, not between blurb+timing
          _anchor.insertAdjacentHTML('afterend',
            '<div id="results-chase" style="margin:8px auto 0;max-width:340px;font-family:\'Chakra Petch\',sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#b9b2ac;">'
            + 'Best <b style="color:#e0a93f;font-family:\'Oxanium\',sans-serif;">' + prevReal.score.toLocaleString() + '</b>'
            + (_by > 0 ? ' — beat it by <b style="color:var(--crimson);font-family:\'Oxanium\',sans-serif;">' + _by.toLocaleString() + '</b>' : ' — match it again')
            + '</div>');
        }
      } catch (e) {}
    }
    // 3) BONUS SPARKS earn loop — award the platform-only SOFT currency for a COMPLETED run.
    // Fires exactly once per completed run: recordLocal is called once from endGame(), and the
    // `failed` guard excludes bailed/fail-out runs the same way the career aggregate above does
    // (a failed run earns nothing). NEVER touches the cashable Sparks balance. The amount is
    // stashed on results._bonusAwarded so the results screen can show "+N BONUS SPARKS".
    if (!failed) {
      // build110: RETENTION SYSTEM hook — XP/Level/Streak/Daily+Weekly Goals (goals.js, window.RhythmGoals).
      // Fires once per completed (non-failed) run, mirroring the Bonus Sparks earn loop right below it.
      // Never throws into the reward/submit paths; stashes the XP total onto results._xpEarned the same
      // way results._bonusAwarded is stashed, so the results screen can render "+N XP" (see game.js/catalog.js).
      try {
        if (window.RhythmGoals) {
          const _rrGoalsOut = window.RhythmGoals.recordLevelComplete({
            grade: grade,
            isNewBest: !!(results && results._newBest),
            isGradeUp: _rrIsGradeUp,
            isFirstClear: _rrIsFirstClear,
            fullCombo: !!results.full_combo,
            songId: (currentTrack && currentTrack.id) || null
          });
          if (_rrGoalsOut && _rrGoalsOut.xpEarned) { results._xpEarned = _rrGoalsOut.xpEarned; try { renderXpLine(_rrGoalsOut.xpEarned); } catch (e) {} }
        }
      } catch (e) {}
      // WAVE-5 SPOTLIGHT (B3) ×2 XP — the day's Spotlight track grants DOUBLE XP, ONCE per day. The bonus is granted via
      // goals.js's XP-ONLY primitive `grantBonusXp`, matching the base XP the run just earned. It deliberately does NOT
      // call recordLevelComplete a second time: that increments g.levels and re-runs claimDaily/claimWeekly, so a Spotlight
      // clear would count as TWO levels — reaching the 3-level daily goal (and BUMPING THE STREAK via updateStreakOnDailyClaim)
      // one real play early, and banking up to 7 phantom levels a week against the 15-level weekly goal. Streak is the
      // retention ledger and gates the freeze economy; only real plays may move it.
      // STATUS ONLY: never touches Sparks / Bonus Sparks / score / leaderboard / multiplier. Sits DOWNSTREAM of every
      // exclusion the base XP uses — the preview/practice/_preview early-returns at the top of recordLocal and this block's
      // `!failed` gate already dropped preview / practice / bridge / MP / failed runs before we get here.
      // Anti-farm mirrors the Daily-Rift ×3 lifecycle: consume-once -> grant -> stamp-done. The consume flips an in-memory
      // day-guard BEFORE granting (so a stamp-write failure can't double-grant this session); the persisted rr_spotlight_xp
      // stamp blocks re-grant across reloads. Base XP is granted independently above, so a stamp failure can neither
      // double-grant nor drop it. An older goals.js without grantBonusXp simply skips the bonus (never falls back to a
      // second recordLevelComplete).
      try {
        var _spotToday = dailyRiftToday();
        var _spotBase = results._xpEarned || 0;   // exactly the base XP this run just earned → granting it again = ×2
        if (_spotlightXpDay !== _spotToday && !spotlightXpState().done && _spotBase > 0
            && currentTrack && currentTrack.id && isSpotlight(currentTrack.id)
            && window.RhythmGoals && typeof window.RhythmGoals.grantBonusXp === 'function') {
          _spotlightXpDay = _spotToday;   // CONSUME first — a later run this session can't re-grant even if the stamp write below throws
          var _spotOut = window.RhythmGoals.grantBonusXp(_spotBase, 'Spotlight ×2 XP');
          if (_spotOut && _spotOut.xpEarned) {
            results._spotlightXpBonus = _spotOut.xpEarned;                       // the bonus half (results / share card can flag "Spotlight ×2 XP")
            results._xpEarned = (results._xpEarned || 0) + _spotOut.xpEarned;    // run total = base + bonus
            try { renderXpLine(results._xpEarned); } catch (e) {}
          }
          try { localStorage.setItem('rr_spotlight_xp', JSON.stringify({ date: _spotToday, done: true })); } catch (e) {}   // stamp LAST
        }
      } catch (e) {}
      if (bonusServerReady()) {
        // build100i: SERVER-authoritative Bonus. The earn does NOT happen here — it fires from the /score|/plays success
        // handler below, once the canonical play_id is known (POST /bonus-sparks/earn { play_id, daily_rift } → server
        // validates the daily claim + computes the award; see _bonusEarnForRun). Nothing is minted locally. A run that
        // never submits (tight/practice, demo, score 0, signed-out) earns no SERVER Bonus — that's by design.
      } else {
      // build73 ECONOMY REBALANCE (owner): Bonus Sparks spend on the WEBSITE (skips/boosts — the real revenue),
      // so the gameplay faucet is now TINY + weekly-capped. Dropped the runaway score/2000 term entirely; a run
      // earns a small grade reward (+full-combo kicker), and the ISO-week cap (BONUS_WEEKLY_CAP=50) means even
      // the best grinder tops out near ~50/week — while the per-run "+N BONUS SPARKS" still gives the dopamine hit.
      const base = ({ S: 6, A: 4, B: 2, C: 1, D: 1 })[grade] || 1;
      let want = base + (results.full_combo ? 2 : 0);     // 1–8 per run (S + full combo = 8)
      // build100 DAILY RIFT ×3: the once-a-day challenge pays TRIPLE Bonus Sparks on the day's FIRST clear (the flag
      // is captured + consumed at the top of recordLocal). This is the ONLY place the 3x applies; normal runs untouched.
      // The ISO-week ceiling still clamps the granted amount (below), so the economy guardrail holds. On a granted ×3
      // we stamp rr_dailyrift done=true so the gate can't be farmed even if a surface forgets to mark it.
      if (_rift3x) want = want * 3;
      const earned = Math.min(want, bonusWeekRemaining());  // hard weekly ceiling (applies AFTER the ×3 so the cap still holds)
      if (earned > 0) {
        _bonusWeekAdd(earned);
        const newBal = awardBonusSparks(earned, _rift3x ? 'daily_rift_x3' : 'run_complete');
        results._bonusAwarded = earned;
        results._bonusBalance = newBal;
        results._dailyRiftX3 = _rift3x;   // results screen / share card can flag the triple run
        try { renderBonusSparksLine(earned, newBal); } catch (e) {}
        // build100d: stamp the day done ONLY when the ×3 actually PAID (inside earned>0). Stamping it outside this guard
        // marked the day done with ZERO reward when the ISO-week Bonus cap was already exhausted (earned=0) — silently
        // forfeiting the ×3. Now: if the cap blocked the payout, the day stays un-done so the tile re-arms next week.
        if (_rift3x) { try { localStorage.setItem('rr_dailyrift', JSON.stringify({ date: dailyRiftToday(), done: true })); } catch (e) {} }
      }
      }   // build100h: close the BONUS_SERVER `else` (client-side local-bonus path)
    }
    // --- account leaderboard: in-browser runs also submit to your ReactivVibe account (beta-grade).
    // Feeds the existing game_plays / game_leaderboard. Logged out -> sign-in nudge; backend absent -> silent.
    // Tight (GH) timing feel raises the multiplier ceiling above the server's score bound, so
    // Tight runs are LOCAL PRACTICE ONLY — recorded locally (above) but never submitted to /score.
    var _tightRun = false; try { _tightRun = !!(window.RhythmGame && window.RhythmGame.getTimingFeel && window.RhythmGame.getTimingFeel() === 'tight'); } catch (e) {}
    if (failed) { /* a failed run never submits to the account leaderboard — it isn't a completed score */ }
    else if (_tightRun && API_BASE && currentTrack && currentTrack.id !== 'demo' && results.score > 0 && !hasServerChart(currentTrack)) {
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
            // build104 s11: stamp the chart epoch — the buildNotes + scoring rewrite moved achievable score, so a v2
            // score must not rank against a v1 score. The backend can segment/label by this; an absent field = era 1.
            chart_version: (window.RhythmGame && window.RhythmGame.CHART_VERSION) || 1,
          } });
          // build100i: Lovable returns { id, play_id, rank_global } from /score (a /plays alias). Capture the canonical
          // play_id, then earn server Bonus against it (POST /bonus-sparks/earn { play_id, daily_rift }). _rift3x carries
          // the day's-first-clear intent; the server validates it. No-op unless BONUS_SERVER + signed-in.
          var _pid = out && (out.play_id || out.id);
          try { if (_pid && currentTrack) currentTrack.play_id = _pid; } catch (e) {}
          _bonusEarnForRun(_pid, results, _rift3x);
          try { _capturePlayStats(out, currentTrack && currentTrack.id, results.difficulty); } catch (e) {}   // Wave-3: TOP N% TODAY (display-only, read off the /score response)
          let board = [];
          try { board = lbRows(await api('/leaderboard/' + currentTrack.id + '?difficulty=' + results.difficulty + '&limit=10')); } catch (e) {}
          onSubmitResult({ rank_global: out && out.rank_global, leaderboard: board }, results);
        } catch (e) { /* backend not live yet -> stay local-only (no regression) */ }
      })();
    }
  }

  // build72: catalog-side mirror of index.html's cleanName (it lives in a separate IIFE we can't reach) — scrub
  // slur display names on the RESULTS leaderboard panel the same way the overlay board already does.
  // build111 s1: LB_BADWORDS + the matcher now live in shared chat.js (window.RhythmChat) so multiplayer.js's
  // new chat/report surfaces can reach the same wordlist. scrubName delegates to RhythmChat.filterDisplayName
  // when chat.js has loaded (it's included before catalog.js in index.html); falls back to this file's OWN
  // copy of the list/logic if chat.js is ever absent (older cached HTML, load-order regression, etc.) — so
  // this extraction is zero-behavior-change even in a partial-load edge case.
  var LB_BADWORDS = ['nigger','nigga','faggot','retard','cunt','rape','kike','spic','chink','fuck','shit','bitch','whore','slut','dick','cock','pussy','asshole','bastard','nazi','wank','twat','jizz','coon','tranny'];
  // build121b — TWO-TIER split (union == LB_BADWORDS; no word added/removed). Mirrors chat.js HARD_SLURS/SOFT_SLURS.
  // HARD = strong slurs with no innocent-substring collisions → leet-fold CONTAINS (catches 'nigger123'/'xnigger').
  // SOFT = collision-prone milder words (grape/Scunthorpe/Dickinson/Cockburn/raccoon/suspicious/shiitake/retardant)
  // → WHOLE-WORD only (per-token leet-EQUALITY) + a digit-adjacency catch ('rape1' censors; 'grape'/'gr4pe' pass).
  var LB_HARD = ['nigger','nigga','faggot','kike','chink','tranny','fuck','bitch','whore','slut','pussy','asshole','bastard','nazi','wank','twat','jizz'];
  var LB_SOFT = ['retard','cunt','rape','spic','shit','dick','cock','coon'];
  function scrubName(s) {
    try { if (window.RhythmChat && window.RhythmChat.filterDisplayName) return window.RhythmChat.filterDisplayName(s); } catch (e) {}
    var raw = String(s == null ? '' : s).trim();
    if (!raw) return 'anon';
    // build121b — TWO-TIER fallback (when chat.js hasn't loaded), byte-for-byte semantics of RhythmChat.filterDisplayName.
    // Fixes the substring false positives ('grape'⊃'rape', 'Dickinson'⊃'dick') AND the digit-append evasion hole
    // ('nigger123', 'faggot1') the single-tier whole-word version let slip. Word list unchanged — only match semantics.
    var _leet = function (x) { return String(x).toLowerCase().replace(/[\s_\-.]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's').replace(/!/g, 'i'); };
    // (0) separator-spread catch: whole-name leet-fold matched by EQUALITY ('n-i-g-g-e-r'→'nigger'; 'grape'→'grape' ≠ any).
    if (LB_BADWORDS.indexOf(_leet(raw)) >= 0) return 'player';
    var toks = raw.split(/[^A-Za-z0-9]+/);
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i]; if (!tok) continue;
      var ftok = _leet(tok);
      // (1) HARD slurs → leet-fold CONTAINS (safe: no innocent collisions) — 'xnigger'/'nigger123'/'faggot1'.
      for (var h = 0; h < LB_HARD.length; h++) { if (ftok.indexOf(LB_HARD[h]) >= 0) return 'player'; }
      // (2) SOFT (collision-prone) → WHOLE-WORD equality + digit-adjacency (boundary digits stripped BEFORE folding).
      var fcore = _leet(tok.replace(/^[0-9]+/, '').replace(/[0-9]+$/, ''));
      for (var k = 0; k < LB_SOFT.length; k++) { if (ftok === LB_SOFT[k] || fcore === LB_SOFT[k]) return 'player'; }
    }
    return raw;
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
    if (!(out.leaderboard && out.leaderboard.length)) {
      // build72: a valid-but-empty board rendered a bare header over zero rows — show a "first to score" note instead
      wrap.innerHTML = '<div class="lb-note">You’re the first to set a score here.' + (out.rank_global ? ' · ranked #' + out.rank_global : '') + '</div>';
      wrap.style.display = '';
      return;
    }
    const rows = (out.leaderboard || []).map((r) =>
      '<div class="lb-row">' +
        '<span class="lb-rank">#' + (r.rank != null ? r.rank : '–') + '</span>' +   // build72: en-dash on a missing rank (was "#undefined")
        '<span class="lb-name">' + escapeHtml(scrubName(r.display_name)) + '</span>' +   // build72: profanity-scrub these public names (overlay board already did)
        '<span class="lb-score">' + (isFinite(r.score) ? Number(r.score) : 0).toLocaleString() + '</span>' +   // build72: coerce a missing/non-numeric score → 0 (was NaN)
        '<span class="lb-acc">' + (isFinite(r.accuracy) ? (Math.max(0, Math.min(1, r.accuracy)) * 100).toFixed(1) : '0.0') + '%</span>' +   // build66 (launch-audit P3): coerce a missing/non-numeric backend accuracy → 0.0% (was NaN%)
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
      // build115 p2: thread an optional difficulty filter through to the global board — mirrors fetchLeaderboard's
      // querystring pattern. Backward-compatible: omitted/empty difficulty = '' (server should treat as "all").
      const qs = '?limit=' + (opts.limit || 20) + '&difficulty=' + encodeURIComponent(opts.difficulty || '');
      const rows = lbRows(await api('/leaderboard/global' + qs));
      return { rows, youName: await _myName() };
    } catch (e) { return { rows: [] }; }
  }

  // build66: RHYTHM WAGER — host-run tournament prize pools / parimutuel side-bets (Bonus-Sparks stand-in +
  // server swap-seam). Separate global so multiplayer.js drives it; the cashable-Sparks path is gated OFF
  // (WAGER_SERVER_MODE='local' refuses 'sparks') until the backend escrow + server scoring + legal land.
  window.RhythmWager = {
    canStake: wagerCanStake, openPool: wagerOpenPool, joinPool: wagerJoinPool,
    settlePool: wagerSettlePool, refundPool: wagerRefundPool,
    placeBet: wagerPlaceBet, betOdds: wagerBetOdds, settleBets: wagerSettleBets,
    getPool: wagerGetPool, serverMode: wagerServerMode, maxBuyIn: function () { return WAGER_MAX_BUYIN; }
  };
  // build100i: server-authoritative MULTIPLAYER result recorder (anti-cheat ledger + global MP ladder). Each peer
  // POSTs its OWN claimed result keyed by the shared round_id (matchId[:trackId]); the server re-judges + pairs the two
  // submissions by round_id. FIRE-AND-FORGET on purpose — the in-match verdict stays peer-broadcast + client-trusted
  // (multiplayer.js settleIfReady), so a missing/slow/erroring endpoint never blocks or regresses the live duel.
  async function mpSettle(payload) {
    try {
      if (!API_BASE || !payload) return null;
      var tk = await getToken(); if (!tk) return null;   // only signed-in results count toward the server ladder
      return await api('/mp/round/settle', { method: 'POST', body: payload, auth: true });
    } catch (e) { return null; }
  }
  // build100i: HOST opens a server round at match start (Lovable: idempotent on (room_id, round_id); host JWT, host must
  // be in player_ids). Returns the server round_id (uuid) that BOTH peers then pass to /mp/round/settle. Fail-open.
  async function mpRoundStart(payload) {
    try {
      if (!API_BASE || !payload) return null;
      var tk = await getToken(); if (!tk) return null;
      var out = await api('/mp/round/start', { method: 'POST', body: payload, auth: true });
      return (out && out.round_id) || null;
    } catch (e) { return null; }
  }

  // build119 p1: USER REPORTING, client half. LIVE — POSTs to the deployed `game-catalog` moderation
  // backend (POST /reports, authed bearer, same getToken()-bearer pattern as every other authed call in this
  // file — see /plays and mpSettle above). The backend accepts `evidence` OR `context`, clamps note<=140,
  // soft-validates reason, and overwrites reporter_id from the JWT server-side — so the client-built
  // reporterId/reporterName below are best-effort local context only, not trusted identity.
  //
  // The localStorage queue (rr_reports_queue) is KEPT as an offline/failure fallback: a failed/offline POST
  // still queues locally exactly as before, and flushReportsQueue() (called opportunistically after a
  // successful getUser()/boot) drains it — POSTing each entry and dropping it on success, leaving anything
  // that still fails queued for the next opportunity. The queue entry shape IS the POST body already (no
  // reshaping needed at flush time — same payload submitReport would have POSTed live).
  var REPORTS_QUEUE_KEY = 'rr_reports_queue';
  var REPORTS_QUEUE_MAX = 50;   // local safety cap — an unbounded queue on a device that never flushes would grow forever
  function _loadReportsQueue() {
    try { var a = JSON.parse(localStorage.getItem(REPORTS_QUEUE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function _saveReportsQueue(a) {
    try { localStorage.setItem(REPORTS_QUEUE_KEY, JSON.stringify(a.slice(-REPORTS_QUEUE_MAX))); } catch (e) {}
  }
  async function submitReport(payload) {
    try {
      if (!payload || !payload.targetId) return { queued: false, error: 'missing-target' };
      var entry = {
        targetId: String(payload.targetId).slice(0, 128),
        targetName: String(payload.targetName || 'Player').slice(0, 60),
        roomId: payload.roomId || null,
        matchId: payload.matchId || null,
        reason: String(payload.reason || 'Other').slice(0, 40),
        note: payload.note ? String(payload.note).slice(0, 140) : '',
        evidence: Array.isArray(payload.evidence) ? payload.evidence.slice(-30) : [],   // last ~30 buffered chat lines, if the caller has any
        reporterId: null, reporterName: null,
        at: Date.now()
      };
      try { var u = await getUser(); if (u) { entry.reporterId = u.id; entry.reporterName = u.name; } } catch (e) {}
      // LIVE path first: try the real endpoint. Only fall back to the local queue if the POST itself fails
      // (offline, backend hiccup, not signed in, etc.) — matches the resilience pattern used throughout this
      // file (mpSettle/mpRoundStart), where a backend hiccup must never throw into the caller.
      try {
        var out = await api('/reports', { method: 'POST', body: entry, auth: true });
        return { queued: false, ok: true, id: out && out.id };
      } catch (postErr) {
        var q = _loadReportsQueue(); q.push(entry); _saveReportsQueue(q);
        return { queued: true };
      }
    } catch (e) { return { queued: false, error: 'exception' }; }
  }
  // Drains rr_reports_queue by POSTing each entry to /reports; a queue entry is dropped only on a confirmed
  // success. Anything that still fails (offline / backend down) stays queued for the next opportunity. Safe to
  // call opportunistically and often — no-ops instantly when the queue is empty or the backend is unreachable.
  var _flushingReports = false;
  async function flushReportsQueue() {
    if (_flushingReports) return { flushed: 0, remaining: 0 };
    _flushingReports = true;
    try {
      var q = _loadReportsQueue();
      if (!q.length) return { flushed: 0, remaining: 0 };
      var remaining = [];
      var flushed = 0;
      for (var i = 0; i < q.length; i++) {
        try {
          await api('/reports', { method: 'POST', body: q[i], auth: true });
          flushed++;
        } catch (e) {
          remaining.push(q[i]);   // still failing (offline/backend down) — keep it queued
        }
      }
      _saveReportsQueue(remaining);
      return { flushed: flushed, remaining: remaining.length };
    } catch (e) { return { flushed: 0, remaining: 0 }; }
    finally { _flushingReports = false; }
  }

  // ===========================================================================
  // TRACK RATINGS (MECHANICS_DIRECTION_v2 §D1) — local-first, offline/signed-out safe.
  // ---------------------------------------------------------------------------
  // Store: localStorage 'rr_ratings' = { [track_id]: {stars, felt, difficulty, acc, ts} }.
  // LAST-WRITE-WINS, MERGE-writes (a player may set stars OR felt independently — never clobber
  // the other). This holds only THIS device's own rating (results pre-fill + optimistic display).
  // The COMMUNITY aggregates (rating_avg / rating_count / felt_median) do NOT live here — they ride
  // the catalog payload (GET /tracks, GET /track/:id) and are read DEFENSIVELY at the render sites
  // (absent until the backend ships → render nothing; never throw; never show "0 ratings").
  //
  // The offline queue (rr_ratings_queue) + drain MIRROR submitReport / rr_reports_queue EXACTLY: a
  // failed/offline POST queues locally; flushRatingsQueue() drains it on the next opportunity (called
  // beside flushReportsQueue in refreshAdmin after a real sign-in). Held-safe: pure additive UI + a new
  // localStorage key — NO score / economy / launch path touched.
  // ===========================================================================
  var RATINGS_KEY = 'rr_ratings';
  function _loadRatings() {
    try { var o = JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
    catch (e) { return {}; }
  }
  function _saveRatings(o) { try { localStorage.setItem(RATINGS_KEY, JSON.stringify(o || {})); } catch (e) {} }
  // { stars, felt } for pre-filling the results widget; null if this device never rated the track.
  function ratingFor(trackId) {
    if (!trackId) return null;
    try {
      var r = _loadRatings()[trackId];
      if (!r) return null;
      return { stars: (r.stars != null ? r.stars : null), felt: (r.felt != null ? r.felt : null) };
    } catch (e) { return null; }
  }
  // felt_difficulty 1..5 → semantic FEEL label (owner wording). Out-of-range → '' (render nothing).
  var FEEL_LABELS = ['', 'CHILL', 'FAIR', 'TESTED ME', 'BRUTAL', 'UNFAIR'];
  function _feelLabel(n) { n = Math.round(Number(n)); return (n >= 1 && n <= 5) ? FEEL_LABELS[n] : ''; }
  // felt_median may be a bare number OR a per-tier map ({easy,medium,hard,rift,overall}). Pick the selected
  // tier, falling back to overall/all, then any numeric value. null when absent/unusable.
  function _feltMedian(fm, tier) {
    if (fm == null) return null;
    if (typeof fm === 'number') return isFinite(fm) ? fm : null;
    if (typeof fm === 'object') {
      if (tier && fm[tier] != null && isFinite(fm[tier])) return Number(fm[tier]);
      if (fm.overall != null && isFinite(fm.overall)) return Number(fm.overall);
      if (fm.all != null && isFinite(fm.all)) return Number(fm.all);
      for (var k in fm) { if (fm[k] != null && isFinite(fm[k])) return Number(fm[k]); }
    }
    return null;
  }
  var RATINGS_QUEUE_KEY = 'rr_ratings_queue';
  var RATINGS_QUEUE_MAX = 50;   // local safety cap — mirrors REPORTS_QUEUE_MAX
  function _loadRatingsQueue() {
    try { var a = JSON.parse(localStorage.getItem(RATINGS_QUEUE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function _saveRatingsQueue(a) {
    try { localStorage.setItem(RATINGS_QUEUE_KEY, JSON.stringify(a.slice(-RATINGS_QUEUE_MAX))); } catch (e) {}
  }
  // Merge-write the local store, then POST to game-catalog /ratings when the API is reachable AND the user is
  // signed in; on network failure QUEUE the payload (rr_ratings_queue) — same live-first-then-queue shape as
  // submitReport. Returns { ok, queued, rating_avg?, rating_count?, felt_median? } — the fresh aggregate the
  // backend echoes is surfaced AND stashed on the track object so the UI can update instantly.
  async function rateTrack(trackId, opts) {
    opts = opts || {};
    if (!trackId) return { ok: false, error: 'missing-track' };
    // 1) LOCAL-FIRST merge (last write wins per field — stars and felt independent, never clobber the other).
    var o = _loadRatings();
    var prev = o[trackId] || {};
    var rec = {
      stars: (opts.stars != null ? (opts.stars | 0) : (prev.stars != null ? prev.stars : null)),
      felt:  (opts.felt  != null ? (opts.felt  | 0) : (prev.felt  != null ? prev.felt  : null)),
      difficulty: (opts.difficulty != null ? opts.difficulty : (prev.difficulty != null ? prev.difficulty : null)),
      acc:   (opts.acc   != null ? opts.acc   : (prev.acc   != null ? prev.acc   : null)),
      ts: Date.now()
    };
    o[trackId] = rec;
    _saveRatings(o);
    // build180 (D5, Fable-directed): also emit an ANONYMOUS rating funnel event so ENJOYMENT lands in
    // game_funnel_events even for GUESTS. The authed /ratings POST below is signed-in-only "by design" (anti-abuse),
    // so guests' ratings never reached the DB — which is exactly why rr_track_ratings read 0 rows in prod. This
    // rides the legitimate-interest allow-list (no identity; just track + stars/felt/difficulty).
    try {
      if (window.RhythmTelemetry && window.RhythmTelemetry.event) {
        var _rp = { trackId: trackId };
        if (rec.stars != null) _rp.stars = rec.stars;
        if (rec.felt != null) _rp.felt = rec.felt;
        if (rec.difficulty != null) _rp.difficulty = rec.difficulty;
        window.RhythmTelemetry.event('rating', _rp);
      }
    } catch (e) {}
    // POST body — matches the D2 contract { track_id, stars?, felt?, difficulty, accuracy? }. We queue/POST the
    // MERGED state (not just this delta) so a drain is idempotent regardless of the server's upsert-merge semantics.
    var body = { track_id: trackId, difficulty: rec.difficulty || null };
    if (rec.stars != null) body.stars = rec.stars;
    if (rec.felt  != null) body.felt  = rec.felt;
    if (rec.acc   != null) body.accuracy = rec.acc;
    // 2) Guests / no API → local-only (no anon endpoint by design — anti-abuse for free).
    if (!API_BASE) return { ok: true, queued: false, local: true };
    var tk = null;
    try { tk = await getToken(); } catch (e) { tk = null; }
    if (!tk) return { ok: true, queued: false, local: true };
    try {
      var out = await api('/ratings', { method: 'POST', body: body, auth: true });   // { ok, rating_avg, rating_count, felt_median? }
      if (out) {
        try {
          var t = catalogTracks.find(function (x) { return x.id === trackId; });
          if (t) {
            if (out.rating_avg   != null) t.rating_avg = out.rating_avg;
            if (out.rating_count != null) t.rating_count = out.rating_count;
            if (out.felt_median  != null) t.felt_median = out.felt_median;
          }
        } catch (e) {}
      }
      return { ok: true, queued: false, rating_avg: out && out.rating_avg, rating_count: out && out.rating_count, felt_median: out && out.felt_median };
    } catch (postErr) {
      var q = _loadRatingsQueue(); q.push(body); _saveRatingsQueue(q);
      return { ok: true, queued: true };
    }
  }
  // Drains rr_ratings_queue by POSTing each entry to /ratings; an entry is dropped only on a confirmed success,
  // anything still failing stays queued for the next opportunity. Safe to call often — no-ops when empty/offline.
  // MIRRORS flushReportsQueue exactly.
  var _flushingRatings = false;
  async function flushRatingsQueue() {
    if (_flushingRatings) return { flushed: 0, remaining: 0 };
    _flushingRatings = true;
    try {
      var q = _loadRatingsQueue();
      if (!q.length) return { flushed: 0, remaining: 0 };
      var remaining = [];
      var flushed = 0;
      for (var i = 0; i < q.length; i++) {
        try { await api('/ratings', { method: 'POST', body: q[i], auth: true }); flushed++; }
        catch (e) { remaining.push(q[i]); }
      }
      _saveRatingsQueue(remaining);
      return { flushed: flushed, remaining: remaining.length };
    } catch (e) { return { flushed: 0, remaining: 0 }; }
    finally { _flushingRatings = false; }
  }

  // build119 p1: SANCTIONS client — GET /game-catalog/sanctions/me (authed, derives user from the JWT, no
  // params). Returns the sanction/mute/pending_notices object described in the backend contract, or null when
  // signed out / unreachable / anything hiccups — this must NEVER throw, and a null/empty result must be
  // indistinguishable from "no sanction" to every caller (safe-default: no gate, no mute, no modal).
  async function getSanctions() {
    try {
      if (!API_BASE) return null;
      var tk = await getToken(); if (!tk) return null;   // signed-out → nothing to enforce
      var out = await api('/sanctions/me', { auth: true });
      return out || null;
    } catch (e) { return null; }
  }
  // Fire-and-forget ack — marks a pending notice acknowledged server-side so it stops re-showing on next launch.
  // Guarded end-to-end: a failed ack just means the notice may re-show next time, never breaks the caller.
  async function ackNotice(id) {
    try {
      if (!API_BASE || !id) return false;
      var tk = await getToken(); if (!tk) return false;
      await api('/notifications/' + encodeURIComponent(id) + '/ack', { method: 'POST', auth: true });
      return true;
    } catch (e) { return false; }
  }

  // ===========================================================================
  // RETENTION / DISCOVERY DATA LAYER (derived, read-only — the UI that renders these
  // rails/cards is a LATER wave; these getters just expose the model). A brand-new player
  // with NO history must never throw: every getter graceful-empties ([] / {} / null). The
  // ONLY write in this whole block is the single rr_lastVisit stamp (_stampLastVisit, once at boot).
  // ===========================================================================

  // ---- rr_lastVisit: read the PREVIOUS visit, THEN stamp now (the one permitted write) ----
  var _prevLastVisit = null;       // ms of the previous visit (null = first-ever visit / unreadable)
  var _lastVisitStamped = false;
  function _stampLastVisit() {
    if (_lastVisitStamped) return;   // once per page load
    _lastVisitStamped = true;
    try {
      var raw = localStorage.getItem('rr_lastVisit');
      var prev = raw != null ? parseInt(raw, 10) : NaN;
      _prevLastVisit = (isFinite(prev) && prev > 0) ? prev : null;
    } catch (e) { _prevLastVisit = null; }
    try { localStorage.setItem('rr_lastVisit', String(Date.now())); } catch (e) {}   // <-- the single stamp
  }
  // hours since the previous visit (null on a first-ever visit — graceful).
  function lastVisitAgeHours() {
    if (!_prevLastVisit) return null;
    return Math.max(0, (Date.now() - _prevLastVisit) / 3600000);
  }
  // MUSIC tracks added since the previous visit (reuses the New-rail created_at logic), newest-first.
  // [] on a first-ever visit (nothing is "new since last time") — graceful.
  function freshSince() {
    if (!_prevLastVisit) return [];
    var cutoff = _prevLastVisit;
    var dateOf = function (t) { return (typeof t.created_at === 'number' ? t.created_at : Date.parse(t.created_at)) || 0; };
    return musicTracks().filter(function (t) { return t && !isVideo(t) && dateOf(t) > cutoff; })
      .sort(function (a, b) { return dateOf(b) - dateOf(a); });
  }

  // ---- play-history AFFINITY (per-genre + per-artist) for a future "For You" rail ----
  // set of track ids the player has actually played (career.songs keys ∪ rr_scores keys).
  function _playedIds() {
    var set = {};
    try { var c = loadCareer(); var sg = (c && c.songs) || {}; for (var k in sg) if (Object.prototype.hasOwnProperty.call(sg, k)) set[String(k)] = true; } catch (e) {}
    try { var sc = loadScores(); for (var k2 in sc) if (Object.prototype.hasOwnProperty.call(sc, k2)) { var id = String(k2).split('|')[0]; if (id) set[id] = true; } } catch (e) {}
    return set;
  }
  // ranked affinity: { genres:[{name,weight}], artists:[{name,weight}], plays } — weights are play counts,
  // highest-first. {genres:[],artists:[],plays:0} for a player with no mapped history (graceful).
  function getAffinity() {
    var empty = { genres: [], artists: [], plays: 0 };
    var songs; try { songs = (getCareer().songs) || {}; } catch (e) { return empty; }
    var ids = Object.keys(songs);
    if (!ids.length) return empty;
    var byId = {}, pool = musicTracks();
    for (var i = 0; i < pool.length; i++) { var t = pool[i]; if (t && t.id != null) byId[String(t.id)] = t; }
    var gW = {}, aW = {}, total = 0;
    for (var j = 0; j < ids.length; j++) {
      var tk = byId[ids[j]]; if (!tk) continue;   // title-keyed / practice / unloaded id → not a catalog track, skip
      var w = Math.max(1, songs[ids[j]] | 0); total += w;
      var g = cleanGenre(tk.genre); if (g) gW[g] = (gW[g] || 0) + w;
      var a = tk.artist_name; if (a) aW[a] = (aW[a] || 0) + w;
    }
    var rank = function (m) { return Object.keys(m).map(function (k) { return { name: k, weight: m[k] }; }).sort(function (x, y) { return y.weight - x.weight; }); };
    return { genres: rank(gW), artists: rank(aW), plays: total };
  }
  // up to n playable MUSIC tracks biased toward affinity (unplayed-first, decode-confident, NEVER videos).
  // [] for a new player with no affinity — graceful.
  function forYouTracks(n) {
    n = Math.max(1, Math.floor(Number(n) || 0) || 12);
    var aff = getAffinity();
    if (aff.plays === 0) return [];
    var gRank = {}, aRank = {};
    aff.genres.forEach(function (g) { gRank[g.name] = g.weight; });
    aff.artists.forEach(function (a) { aRank[a.name] = a.weight; });
    var played = _playedIds();
    var pool = musicTracks().filter(function (t) { return t && trackReady(t) && !isVideo(t); });
    var scored = [];
    for (var i = 0; i < pool.length; i++) {
      var t = pool[i];
      var g = cleanGenre(t.genre), a = t.artist_name, s = 0;
      if (g && gRank[g]) s += gRank[g] * 2;        // genre affinity
      if (a && aRank[a]) s += aRank[a] * 3;        // artist affinity (stronger signal)
      if (s <= 0) continue;                        // not in any affinity bucket → not "for you"
      if (_discoverConfident(t)) s += 0.5;         // nudge decode-confident picks up
      var isPlayed = !!played[String(t.id)];
      if (!isPlayed) s += 5;                       // unplayed-first within the affinity set
      scored.push({ t: t, s: s, played: isPlayed, tie: hashStr('foryou|' + (t.id || t.title || '')) });
    }
    scored.sort(function (x, y) { return (y.s - x.s) || ((x.played === y.played) ? (x.tie - y.tie) : (x.played ? 1 : -1)); });
    return scored.slice(0, n).map(function (o) { return o.t; });
  }

  // ---- COLLECTION / completion model (from saved bests via getBest) ----
  // per-genre { total, sCount, fcCount }. total = music tracks in the genre; sCount = tracks whose best grade
  // is S; fcCount = tracks fully CLEARED (a saved best exists). NOTE: per-track full-combo isn't persisted
  // (rr_scores stores grade/score/accuracy only), so fcCount is the "cleared" count. {} on empty catalog.
  function getCollectionStats() {
    var out = {}, pool = musicTracks();
    if (!pool || !pool.length) return out;
    for (var i = 0; i < pool.length; i++) {
      var t = pool[i]; if (!t) continue;
      var g = cleanGenre(t.genre) || 'Other';
      var b = out[g] || (out[g] = { total: 0, sCount: 0, fcCount: 0 });
      b.total++;
      var best = null; try { best = getBest(t.id); } catch (e) {}
      if (best) { b.fcCount++; if (best.grade === 'S') b.sCount++; }
    }
    return out;
  }
  // up to n tracks the player has PLAYED but not yet S-ranked, nearest-to-S first (best grade, then accuracy).
  // [] for a new player — graceful.
  function chaseTheS(n) {
    n = Math.max(1, Math.floor(Number(n) || 0) || 12);
    var pool = musicTracks(), out = [];
    for (var i = 0; i < pool.length; i++) {
      var t = pool[i]; if (!t) continue;
      var best = null; try { best = getBest(t.id); } catch (e) {}
      if (!best || best.grade === 'S') continue;   // unplayed, or already maxed → not a chase target
      out.push({ t: t, go: (GRADE_ORDER[best.grade] || 0), acc: (typeof best.accuracy === 'number' ? best.accuracy : 0) });
    }
    out.sort(function (x, y) { return (y.go - x.go) || (y.acc - x.acc); });
    return out.slice(0, n).map(function (o) { return o.t; });
  }

  // ---- DAILY PICKS: date-hashed deterministic approachable set (stable per calendar day) ----
  // reuses the Daily Rift date-hash (hashStr + dailyRiftToday) so it's the SAME set all day for a player,
  // rotating tomorrow — unlike Surprise (per-load random). Prefers decode-confident, ready, music-only
  // tracks; widens to any ready music track if too few confident ones. [] on empty catalog — graceful.
  function dailyPicks(n) {
    n = Math.max(1, Math.floor(Number(n) || 0) || 8);
    var today = dailyRiftToday();
    var pool = musicTracks().filter(function (t) { return t && trackReady(t) && !isVideo(t) && _discoverConfident(t); });
    if (pool.length < n) pool = musicTracks().filter(function (t) { return t && trackReady(t) && !isVideo(t); });
    if (!pool.length) return [];
    return pool.slice().sort(function (a, b) {
      return hashStr('daily|' + today + '|' + (a.id || a.title || '')) - hashStr('daily|' + today + '|' + (b.id || b.title || ''));
    }).slice(0, n);
  }

  // ===========================================================================
  // WAVE-4b DATA LAYER (derived, read-only) — two curated getters the results /
  // library UIs consume SYNCHRONOUSLY. The reclaim list is backed by an async fetch
  // that's event-driven (mirrors _capturePlayStats / rr:playstats exactly); the
  // encore pick is a cheap deterministic scan. Neither touches scoring or any write
  // path — both fail-soft to []/null and never throw.
  // ===========================================================================

  // ---- RECLAIM TARGETS (Wave-4b): boards where a rival passed YOUR score since last visit ----
  // Backing fetch: GET /leaderboard/deltas?since=<unix_ms> (authed, reuses getToken()/api()).
  // The endpoint is NOT DEPLOYED YET → it 404s today. EVERY failure path (404/401/network/
  // non-JSON) leaves the cache [] and is SILENT (api() throws on !ok before json-parse; a 200
  // with non-JSON throws inside api() too — both are swallowed here). Because the fetch is async
  // but consumers render synchronously, we kick it ONCE (lazily, on the first getReclaimTargets()
  // call = first library/results view) and, on the FIRST resolve with >=1 sanitized row, dispatch
  // a window CustomEvent 'rr:reclaim' so the renderer can repaint — the identical pattern to
  // _capturePlayStats + 'rr:playstats'. Sanitize: whole-number/clamp scores, cap 10 rows, scrub the
  // passer name (scrubName), drop any row where passerScore<=myScore or the track can't resolve to a
  // playable (non-video, trackReady) catalog track.
  var _reclaimCache = [];        // never null — [] until a fetch yields >=1 valid row
  var _reclaimInflight = false;  // a fetch attempt is currently running — SYNC guard against concurrent bursts (render loops)
  var _reclaimDone = false;      // a fetch actually SUCCEEDED (or hit a terminal 4xx) — don't repeat; a transient 5xx/offline leaves this FALSE so a later call retries
  var _reclaimTries = 0;         // finding #7: transient-failure attempts spent — cap retries so a persistent outage can't storm the render-driven call sites
  function getReclaimTargets() {
    if (!_reclaimDone && !_reclaimInflight) { try { _fetchReclaimTargets(); } catch (e) {} }
    return _reclaimCache.slice();   // defensive copy — always an Array, never null
  }
  function _reclaimSince() {
    // the player's PREVIOUS-visit stamp (ms), via _prevLastVisit (set by _stampLastVisit at boot,
    // the same stamp lastVisitAgeHours() reads); 7-day fallback on a first-ever visit / unreadable.
    try { if (_prevLastVisit && isFinite(_prevLastVisit) && _prevLastVisit > 0) return Math.floor(_prevLastVisit); } catch (e) {}
    return Date.now() - 7 * 24 * 3600 * 1000;
  }
  function _resolveReclaimTrack(id) {
    // resolve an id to a PLAYABLE MUSIC track (catalogTracks is already trackReady + video-stripped);
    // null → the row gets dropped (can't reclaim a board for a dead / video / unknown track).
    if (id == null) return null;
    var sid = String(id), pool = allTracks();
    for (var i = 0; i < pool.length; i++) { if (pool[i] && String(pool[i].id) === sid) return pool[i]; }
    return null;
  }
  function _sanitizeReclaimRows(rows) {
    if (!Array.isArray(rows)) return [];
    var out = [];
    for (var i = 0; i < rows.length && out.length < 10; i++) {   // cap ~10
      var r = rows[i]; if (!r || typeof r !== 'object') continue;
      var tk = _resolveReclaimTrack(r.track_id != null ? r.track_id : r.trackId);
      if (!tk) continue;                                          // unresolvable / video / dead → drop
      var myScore = Math.max(0, Math.round(Number(r.my_score != null ? r.my_score : r.myScore) || 0));
      var passerScore = Math.max(0, Math.round(Number(r.passer_score != null ? r.passer_score : r.passerScore) || 0));
      if (!(passerScore > myScore)) continue;                    // only genuine overtakes
      var passer = scrubName(r.passer_name != null ? r.passer_name : (r.passerName != null ? r.passerName : r.display_name));
      var pAt = Number(r.passed_at != null ? r.passed_at : r.passedAt);
      if (!isFinite(pAt) || pAt <= 0) pAt = Date.now();
      out.push({
        trackId: String(tk.id),
        trackTitle: String(tk.title || 'Unknown'),
        myScore: myScore,
        passerName: passer,
        passerScore: passerScore,
        margin: passerScore - myScore,
        passedAt: pAt,
      });
    }
    return out;
  }
  function _fetchReclaimTargets() {
    if (_reclaimDone || _reclaimInflight) return;   // one real attempt; no concurrent bursts
    if (!API_BASE) return;                          // no backend → cache stays []
    _reclaimInflight = true;
    (async function () {
      try {
        var tk = await getToken();
        if (!tk) return;             // unauthed → cache stays []; leave _reclaimDone FALSE so a later sign-in retries
        var out = await api('/leaderboard/deltas?since=' + _reclaimSince(), { auth: true });
        // finding #7: flag DONE only AFTER the endpoint actually resolved. The old code set _reclaimDone=true BEFORE
        // this await and the catch never reset it, so ONE transient 5xx / offline blip on the first fetch permanently
        // killed the PASSED-YOU reclaim card for the whole session (no retry short of a full page reload).
        _reclaimDone = true;
        var rows = Array.isArray(out) ? out : (out && (out.deltas || out.rows || out.reclaim));   // bare array (real shape) OR a wrapped body — both tolerated
        var clean = _sanitizeReclaimRows(rows);
        if (clean.length) {
          _reclaimCache = clean;
          // async resolve lands AFTER the synchronous first render — nudge the UI to repaint (mirror of rr:playstats).
          try { window.dispatchEvent(new CustomEvent('rr:reclaim')); } catch (e) {}
        }
      } catch (e) {
        // finding #7: a 403/404 is a DEFINITIVE "no reclaim data for you" — terminal, so flag DONE and stop. A 5xx /
        // network / non-JSON is TRANSIENT: leave _reclaimDone FALSE so the next natural call (next hub entry) retries,
        // but cap the transient retries so a persistent outage can't turn the render-driven call sites into a storm.
        // (api() throws 'API <status> …', so the status parses out of the message; a network error carries none → transient.)
        var _st = 0; try { var _m = /API (\d{3})/.exec(e && e.message); if (_m) _st = +_m[1]; } catch (_e) {}
        if (_st === 403 || _st === 404) { _reclaimDone = true; }
        else if (++_reclaimTries >= 3) { _reclaimDone = true; }
      }
      finally { _reclaimInflight = false; }
    })();
  }

  // ---- ENCORE (Wave-4b): ONE curated "play this next" track for the results screen ----
  // Curation over allTracks() (music-only, already trackReady-filtered), priority order:
  //   same genre  →  BPM within ±10% (bonus filter — applied ONLY when BOTH tracks carry a finite
  //   numeric bpm; many live rows have none, so it never GATES) → prefer UNPLAYED (no saved best via
  //   getBest) → prefer decode-confident/playable (_discoverConfident / trackReady). Never a video,
  //   never the current track. Relax path when strict yields nothing: same-genre-playable, then
  //   any-playable(-unplayed-first); null if still nothing. Cheap + deterministic (stable hash tiebreak),
  //   so calling it twice for the same track returns the SAME pick.
  function encoreNextTrack(currentTrackOrId) {
    try {
      var cur = null;
      if (currentTrackOrId && typeof currentTrackOrId === 'object') cur = currentTrackOrId;
      else if (currentTrackOrId != null) cur = _resolveReclaimTrack(currentTrackOrId);
      var curId = cur ? String(cur.id) : (currentTrackOrId != null && typeof currentTrackOrId !== 'object' ? String(currentTrackOrId) : null);
      var curGenre = cur ? cleanGenre(cur.genre) : '';
      var curBpm = (cur && typeof cur.bpm === 'number' && isFinite(cur.bpm) && cur.bpm > 0) ? cur.bpm : null;

      var pool = allTracks();
      if (!pool || !pool.length) return null;

      // playable, non-video, not the current track
      var base = [];
      for (var j = 0; j < pool.length; j++) {
        var t = pool[j];
        if (!t || t.id == null) continue;
        if (curId != null && String(t.id) === curId) continue;
        if (isVideo(t) || !trackReady(t)) continue;
        base.push(t);
      }
      if (!base.length) return null;

      var isUnplayed = function (t) { try { return !getBest(t.id); } catch (e) { return true; } };
      var confident = function (t) { try { return _discoverConfident(t); } catch (e) { return false; } };
      var stable = function (t) { return hashStr('encore|' + (curId || '') + '|' + (t.id || t.title || '')); };
      var pick = function (arr) {
        if (!arr.length) return null;
        // decorate once (cheap), then sort deterministically: unplayed-first, then decode-confident, then stable hash.
        var dec = arr.map(function (t) { return { t: t, u: isUnplayed(t) ? 0 : 1, c: confident(t) ? 0 : 1, h: stable(t) }; });
        dec.sort(function (a, b) { return (a.u - b.u) || (a.c - b.c) || (a.h - b.h); });
        return dec[0].t;
      };

      if (curGenre) {
        // STRICT: same genre + (bpm within ±10% when both carry a numeric bpm)
        var strict = base.filter(function (t) {
          if (cleanGenre(t.genre) !== curGenre) return false;
          if (curBpm != null && typeof t.bpm === 'number' && isFinite(t.bpm) && t.bpm > 0) {
            if (Math.abs(t.bpm - curBpm) > curBpm * 0.10) return false;
          }
          return true;
        });
        var s = pick(strict);
        if (s) return s;
        // RELAX 1: same-genre-playable (drop the bpm window)
        var g = pick(base.filter(function (t) { return cleanGenre(t.genre) === curGenre; }));
        if (g) return g;
      }
      // RELAX 2: any-playable (unplayed-first via pick())
      return pick(base) || null;
    } catch (e) { return null; }
  }

  window.RhythmCatalog = {
    onSubmitResult, recordLocal, getCareer, liveProvider, openSheet, launchTrack, mpSettle, mpRoundStart,
    launchBridgeRun, bridgeReady,   // FIRST PULSE (Wave-4): re-launch the current track as an UNRANKED Medium-at-Easy-window bridge run + the offer-card readiness gate
    getLastPlayStats,  // Wave-3: last real run's {percentile,count,trackId,difficulty} off the /plays|/score response (null when absent/offline/older-server) — read-only, results-screen social proof
    getReclaimTargets, encoreNextTrack,   // Wave-4b: reclaim boards a rival passed since last visit (async fetch → 'rr:reclaim' event; [] unauthed/offline) + one curated "play next" pick (sync, null when nothing) — derived read-only

    submitReport,      // build119 p1: LIVE POST /reports (authed), localStorage rr_reports_queue as offline/failure fallback
    flushReportsQueue, // build119 p1: drains rr_reports_queue against the live endpoint — call opportunistically (e.g. after boot/getUser)
    rateTrack, ratingFor, flushRatingsQueue,   // D1 (ratings): rateTrack({stars?,felt?}) local-first + POST /ratings (rr_ratings_queue drain mirrors reports); ratingFor = pre-fill; flush drains the queue

    getSanctions, ackNotice,   // build119 p1: moderation — GET /sanctions/me + POST /notifications/:id/ack (both authed, fail-soft to null/false)
    // identity + Sparks shell (UI reads these; real /sparks API later)
    getUser, onAuthChange, getSparks, isAdmin, refreshAdmin,
    adoptSiteSession: _adoptSiteSession,   // build115 p1: single source of truth for "adopt the site's shared localStorage session" — the sign-in gate (index.html) routes through this instead of duplicating key-matching logic
    // BONUS SPARKS — platform-only soft currency (gameplay earn loop; NOT cashable). SWAP-SEAM in catalog.js.
    getBonusSparks, awardBonusSparks, spendBonusSparks, bonusBuy, getBonusOwns,
    // store / entitlements (LIVE: GET /store, GET /entitlements, POST /sparks/spend)
    getStore, getEntitlements, spendSparks, ownsItem, _entitlements,
    fetchLeaderboard, fetchGlobalLeaderboard,
    // data layer for the library UI (jukebox.js)
    allTracks, allMedia, isLive: () => catalogLive, genreList, artistList, byGenre, byArtist,
    // media-type split: videos live in their own bucket, OUT of the music lists/rails/search
    isVideo, mediaType, flixPlayable, musicTracks, videoTracks, videoCount, posterFor, goldenBuzzer, goldenBuzzerTracks,
    // Album release parties (Browse "Album Releases" shelf) — []/empty until the /release-parties route exists (graceful).
    releaseParties, albumTracks,
    playFlix, firstPlayableFlix,   // build99: launch a film as a playable level (video backdrop + charted from its audio); firstPlayableFlix = audio-reachability self-heal for the premiere hero
    flixBackdrop: _startFlixBackdrop, flixBackdropStop: _stopFlixBackdrop,   // build102z p1.5: multiplayer stages a VIDEO-review backdrop on host+challenger (gated on sel.flixVideo — normal MP never calls these)
    // DAILY RIFT (build100): deterministic-by-date song pick + once/day ×3 Bonus flag (consumed in recordLocal). Menu controller in index.html paints + launches.
    dailyRiftTrack, dailyRiftState, dailyRiftToday, setDailyRift,
    // WAVE-5 SPOTLIGHT (B3): date-stable daily double-XP track pick + membership test (×2 grant lifecycle in recordLocal).
    spotlightTrack, isSpotlight, spotlightXpState,
    search, sortTracks, sections, getBest,
    // retention / discovery data layer (derived, read-only; UI rails/cards wired in a later wave)
    getAffinity, forYouTracks, getCollectionStats, chaseTheS, freshSince, lastVisitAgeHours, dailyPicks,
    currentTrackId: () => (currentTrack && currentTrack.id) || null,   // build85 (Phase 3): HUD reads the live track for the BEST chip
    preview, stopPreview,
    // live waveform feed (real FFT off the preview audio) — consumed by jukebox.js
    previewSpectrum, previewBinCount, previewPlaying,
    fmtDur, cleanGenre, escapeHtml, hashStr,
    // readiness (no dead songs)
    trackReady, trackStatus, statusLabel, readyCount, reloadCatalog, trackAudioUrl,   // build100q: expose the HLS-skipping audio resolver so MP resolveAndStart never feeds an .m3u8 to the in-browser decoder (→ round never starts → watchdog aborts everyone to the room)
    totalCount: () => catalogTracks.length, rawCount,
    // revenue attribution
    getPackId, logUse,
    showInvite,   // build102s (Phase-2 C1): live-show artist call-in — POST /show/invite (token stays module-local here)
    livematchAnnounce, livematchEnd,   // build102x: site Navbar LIVE MATCH chip (review token stays module-local; fire-and-forget)
    matchQueue, matchStatus,           // build102x: server matchmaking queue (authed REST; throws on !ok)
    presenceOnline, challenge,         // build105: ONLINE NOW roster + direct battle-calls (authed REST; 403/409 distinguishable via the error message)
    challengeAccept, challengeDecline, roomStatus, roomReady,   // v416: battle-call ACCEPT/DECLINE + room preflight ({alive,host_online}); build179: roomReady host heartbeat — join-reliability
    notifRecent,                       // build105 stretch: own-rows battle-call notification probe (null = none/unavailable; self-disables on first RLS failure)
  };

  // ===========================================================================
  // BOOT
  // ===========================================================================
  // build101 — "Play in Reactive Rhythm" HOST REVIEW deep-launch. The host's button on the site opens
  // /game/index.html?review=<signed token>[&return=/admin]. The token is OPAQUE to the game; we forward it to
  // /review/resolve (keeps audio URLs off the wire, lets the backend revoke). Landing with a token SKIPS the
  // start menu/jukebox entirely (the index.html start-intro IIFE early-exits on ?review/?skipIntro) and shows
  // the dedicated LAUNCH CARD (#review-launch: art + title + difficulty + PLAY — the host picks, then plays).
  // OWNER DECREE 2026-07-01: review runs are ALWAYS SCORED + leaderboard-eligible — the synthetic track no
  // longer carries _preview, so recordLocal's gate (~1480) lets the run flow through career/best/bonus +
  // POST /score + the results leaderboard. After results, an auto-return pill sends the host back to the show.
  var _reviewMode = false;
  var _reviewReturnPath = '/admin';                    // host panel — Live Control is /admin's default tab
  // build102s (Phase-2 C1): the RAW review token, kept module-local for POST /show/invite (the live-match
  // artist call-in). It never rides Realtime, sessionStorage, or any log line — only the auth'd invite POST.
  var _revRawToken = null;
  function _reviewReturnUrl() {
    var base = (window.RHYTHM_CONFIG && window.RHYTHM_CONFIG.SITE_BASE) || 'https://reactivvibeai.com';
    return base + _reviewReturnPath;
  }
  function _rvEl(id) { return document.getElementById(id); }
  function _rvState(msg) {   // error/notice state on the card: message replaces the interactive zone
    var st = _rvEl('rvl-state'); if (st) { st.textContent = msg; st.style.display = 'block'; }
    var p = _rvEl('rvl-play'); if (p) p.style.display = 'none';
    var d = _rvEl('rvl-diff'); if (d) d.style.display = 'none';
    var n = _rvEl('rvl-note'); if (n) n.style.display = 'none';
    // build102y step4 (edge case 3): the stage picker hides with the diff row — an HLS-only "watch instead"
    // card has nothing to launch, so a stage strip there is noise.
    var sr = _rvEl('rvl-stage-row'); if (sr) sr.hidden = true;
    var sn = _rvEl('rvl-stage-name'); if (sn) sn.hidden = true;
    var ti = _rvEl('rvl-title'); if (ti && ti.textContent === 'Resolving track…') { ti.textContent = 'Review'; var ar = _rvEl('rvl-artist'); if (ar) ar.textContent = ''; }
  }
  function _openReviewLoading() {   // paint the card INSTANTLY (loading state) while /review/resolve runs
    var ov = _rvEl('review-launch'); if (!ov) return;
    ov.classList.add('on');
    var b = _rvEl('rvl-back');
    if (b && !b._wired) { b._wired = true; b.addEventListener('click', function (ev) { if (ev && ev.isTrusted === false) return; location.href = _reviewReturnUrl(); }); }
  }
  // build102y step4 (owner-mandated): STAGE PICKER on the review launch card. _rvEnvSel = the picked env id
  // (null = ARENA / no chip touched → every flow byte-identical to before). Chip list replicates multiplayer.js
  // _stageList: ARENA first, then every FINISHED level the host OWNS — ownsItem gets e.entId || e.id (the
  // underscore entitlement slug gotcha). When GO LIVE is armed, PAID chips HIDE (judge-endorsed: a live guest
  // may not own the stage — applyEnvironment's ownership backstop would silently split the two players'
  // cosmetics); solo-only cards keep them.
  var _rvEnvSel = null;
  // build102y step5: challenger SEAT POLICY under GO LIVE — 'auto' (DEFAULT: OPEN, FIRST COME — the first real
  // non-host joiner auto-seats as p2 → a real versus without a manual accept), 'confirm' (open seat, host still
  // ACCEPTs), 'artist' (artist-call-in only, host must accept). P0 fix (owner playtest): hosting from the panel now
  // means an OPEN VERSUS anyone can join — 'artist' being the silent default was blocking every non-artist joiner and
  // leaving the host on a solo start. The 'auto' chip is un-gated (was dark behind ?dev=1). The artist path is NOT
  // removed — it's a subset now: an OPEN seat still lets the original artist take it (via CALL IN THE ARTIST + the
  // submitter-priority queue in multiplayer.js), the host can still pick 'artist'/'confirm' on the card.
  var _rvSeatPol = 'auto';
  function _wireSeatPol() {
    var row = _rvEl('rvl-seatpol'); if (!row) return;
    row.querySelectorAll('button').forEach(function (b) {
      var pol = b.getAttribute('data-seat');
      // P0 fix: all three policies render (was `if (pol==='auto') b.hidden = !devOn` — FIRST COME stayed dark).
      b.classList.toggle('active', pol === _rvSeatPol);
      if (!b._wired) {
        b._wired = true;
        b.addEventListener('click', function () {
          _rvSeatPol = pol;
          row.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
        });
      }
    });
  }
  function _rvStageList(hidePaid) {
    try {
      var L = window.RhythmLevels; if (!L || !L.environments) return [];
      var fin = window.RR_FINISHED_LEVELS || {};
      return L.environments().filter(function (e) {
        if (e.isRandom) return false;      // no Random on a launch card — the host picks a concrete stage
        if (e.isDefault) return true;
        if (!fin[e.id]) return false;
        if (e.paid) { if (hidePaid) return false; try { return !!(ownsItem && ownsItem('level', e.entId || e.id)); } catch (x) { return false; } }
        return true;
      });
    } catch (e) { return []; }
  }
  function _renderRvStages(canLive) {
    var row = _rvEl('rvl-stage-row'), nameEl = _rvEl('rvl-stage-name');
    if (!row) return;
    var list = _rvStageList(!!canLive);
    if (list.length <= 1) { row.hidden = true; if (nameEl) nameEl.hidden = true; _rvEnvSel = null; return; }   // only ARENA → nothing to pick
    var i;
    var still = false; for (i = 0; i < list.length; i++) if (list[i].id === _rvEnvSel) still = true;
    if (_rvEnvSel && !still) _rvEnvSel = null;   // the picked chip got filtered away (e.g. GO LIVE hid paid) → back to ARENA
    row.hidden = false;
    row.innerHTML = '';
    list.forEach(function (e) {
      var b = document.createElement('button'); b.type = 'button';
      var seld = e.isDefault ? !_rvEnvSel : (_rvEnvSel === e.id);
      b.className = 'rvl-stage-chip' + (seld ? ' sel' : '');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', seld ? 'true' : 'false');
      if (e.accent) b.style.setProperty('--ec', e.accent);
      b.textContent = e.isDefault ? 'ARENA' : (e.name || 'Stage');   // authored-level names are LOCAL strings (not peer-supplied)
      if (e.paid) { var t = document.createElement('span'); t.className = 'paid-tick'; t.textContent = '✦'; b.appendChild(t); }
      b.addEventListener('click', function () { _rvEnvSel = e.isDefault ? null : e.id; _renderRvStages(canLive); });
      row.appendChild(b);
    });
    if (nameEl) {
      var pick = null; for (i = 0; i < list.length; i++) if (list[i].id === _rvEnvSel) pick = list[i];
      nameEl.hidden = !pick;
      nameEl.textContent = pick ? ('on ' + String(pick.name || '').toUpperCase()) : '';
    }
  }
  function _openReviewLaunch(track) {
    var ov = _rvEl('review-launch'); if (!ov) { try { launchTrack(track); } catch (e) {} return; }
    ov.classList.add('on');
    // build102y step4 (edge case 2): fresh card = fresh stage — no chip carries over run-to-run, and any env a
    // prior run applied is dropped NOW (mirror of the review-fix-1 "never inherit" pattern).
    _rvEnvSel = null;
    _rvSeatPol = 'auto';   // P0 fix: a fresh card defaults to OPEN/FIRST-COME (was 'artist') — host-from-panel = open versus; host can still switch to 'confirm'/'artist' on the card
    try { if (window.RhythmLevels && window.RhythmLevels.clearEnvironment) window.RhythmLevels.clearEnvironment(); } catch (e) {}
    var art = _rvEl('rvl-art'); if (art && track.artwork_url) art.src = track.artwork_url;
    var ti = _rvEl('rvl-title'); if (ti) ti.textContent = track.title || 'Untitled';
    var ar = _rvEl('rvl-artist'); if (ar) ar.textContent = track.artist_name || '';
    // difficulty: drive the ENGINE directly — setDifficulty validates, persists rr_diff and syncs #diff-grid,
    // and buildNotes reads the global at chart time, so setting it on click is all a launch needs.
    var diff = _rvEl('rvl-diff');
    if (diff) {
      var cur = 'medium'; try { cur = (window.RhythmGame.getDifficulty && window.RhythmGame.getDifficulty()) || 'medium'; } catch (e) {}
      diff.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-d') === cur);
        if (!b._wired) {
          b._wired = true;
          b.addEventListener('click', function () {
            try { window.RhythmGame.setDifficulty(b.getAttribute('data-d')); } catch (e) {}
            diff.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
          });
        }
      });
    }
    var play = _rvEl('rvl-play');
    if (play) {
      play.disabled = false;
      if (!play._wired) {
        play._wired = true;
        play.addEventListener('click', function (ev) {
          if (ev && ev.isTrusted === false) return;   // the site's old splash patch fires SYNTHETIC pointerdowns — never auto-start off one
          ov.classList.remove('on');
          // build102y step4: solo PLAY on the picked stage — applyEnvironment backstops unfinished/unowned-paid
          // to Arena; keepEnvironment stops launchTrack's clearEnvironment (the launchLevel/couch.js contract).
          // No chip (_rvEnvSel null) = the exact pre-102y launch line.
          try {
            // build102z p1.5: VIDEO submission → flix-style launch (the video plays behind the highway;
            // playFlix manages its own #bg-video backdrop, clears any leftover env, sets currentTrack, and
            // charts the same media's decoded audio — scoring identical to a normal review run). No stage
            // chip exists for a flix review (_rvEnvSel stays null), so the audio branches below are untouched.
            if (track._flixReview) { playFlix(track); }
            else if (_rvEnvSel && window.RhythmLevels && window.RhythmLevels.applyEnvironment) {
              window.RhythmLevels.applyEnvironment(_rvEnvSel);
              launchTrack(track, { keepEnvironment: true });
            } else launchTrack(track);
          }
          catch (e) { try { window.RhythmGame.playUrl(trackAudioUrl(track), { id: track.id, title: track.title, artist: track.artist_name, artwork: track.artwork_url, genre: track.genre }); } catch (e2) {} }
        });
      }
    }
    // build102s (Phase-2 C1) GO LIVE — HOST-ONLY (role from the extended resolver; a missing role field means the
    // deployed resolver still only accepts host-locked tokens → 'host'). Hidden unless RhythmMP.openShowRoom exists:
    // never a dead button, and solo PLAY above stays the untouched primary (owner's non-negotiable).
    var gl = _rvEl('rvl-golive'), glh = _rvEl('rvl-golive-hint');
    var _canLive = ((track._role || 'host') === 'host') && !!(window.RhythmMP && window.RhythmMP.openShowRoom);
    // build102y step5: the seat-policy selector rides with GO LIVE (hidden when live isn't available)
    { var sp = _rvEl('rvl-seatpol'); if (sp) { sp.hidden = !_canLive; if (_canLive) _wireSeatPol(); } }
    if (gl) {
      gl.hidden = !_canLive; if (glh) glh.hidden = !_canLive;
      if (_canLive && !gl._wired) {
        gl._wired = true;
        gl.addEventListener('click', function (ev) {
          if (ev && ev.isTrusted === false) return;   // same synthetic-event guard as rvl-play
          ov.classList.remove('on');
          var ok = false;
          try {
            if (window.RhythmMP && window.RhythmMP.openShowRoom) {
              window.RhythmMP.openShowRoom({
                trackId: track.id, title: track.title, artist: track.artist_name, art: track.artwork_url,
                audioUrl: track.analysis_url || track.audio_url,   // the decodable .m4a — same visibility class as catalog audio_url
                difficulty: (window.RhythmGame.getDifficulty && window.RhythmGame.getDifficulty()) || 'medium',
                submitterId: track._submitterId || null, submitterName: track._submitterName || '',
                env: _rvEnvSel || null,   // build102y step4: the picked stage rides sel.env — beginMatch applies it on BOTH seats, the show snap carries it to late joiners
                openSeat: _rvSeatPol,     // build102y step5: challenger seat policy ('artist'|'confirm'|'auto') — multiplayer routes it onto the room
                // build102z p1.5: VIDEO review → the flix backdrop URL rides sel to any seat that RUNS the
                // engine (host + seated challenger). Spectator decks stay video-less v1: #bg-video only
                // renders inside an ACTIVE #game (index.html gates it) and spectators never activate it.
                // Same visibility class as audioUrl (may ride Realtime; the token never does). null for
                // audio reviews → multiplayer stays byte-identical.
                flixVideo: (track._flixReview && track.video_url) || null,
                revToken: _revRawToken
              });
              ok = true;
            }
          } catch (e) { console.error('[review] GO LIVE failed', e); }
          if (!ok) {   // solo must always remain reachable — put the card straight back
            ov.classList.add('on');
            try { window.RhythmGame.showToast && window.RhythmGame.showToast('Live rooms aren\'t available right now — solo PLAY still works.', 'error'); } catch (e2) {}
          }
        });
      }
    }
    // build102y step4: render the stage chips LAST — _canLive decides whether paid chips hide (edge case 1).
    // build102z p1.5: a VIDEO review hides the whole stage strip — the video IS the stage (owner spec).
    // _rvEnvSel stays null (reset at card open) so nothing env-shaped rides the launch.
    if (track._flixReview) {
      var _sr0 = _rvEl('rvl-stage-row'); if (_sr0) _sr0.hidden = true;
      var _sn0 = _rvEl('rvl-stage-name'); if (_sn0) _sn0.hidden = true;
    }
    else { try { _renderRvStages(_canLive); } catch (e) {} }
  }
  // build102s: CALL IN THE ARTIST — multiplayer.js passes only the room id; the token stays module-local here.
  // Backend contract: POST /show/invite { token, room, renotify } → { invited, outcome } | 401/403 | 429.
  async function showInvite(roomId, renotify) {
    if (!_revRawToken) throw new Error('no review token in this session');
    return api('/show/invite', { method: 'POST', auth: true, body: { token: _revRawToken, room: String(roomId || ''), renotify: !!renotify } });
  }
  // build102x: LIVE MATCH SITE CHIP — announce/clear the host's live show room on the site Navbar chip.
  // Token = the ORIGINAL review token (module-local, exactly like showInvite; /livematch/end accepts expired
  // tokens + is idempotent). FIRE-AND-FORGET with swallowed errors on purpose: the show must never block on
  // the chip. No-ops without a token (a non-review host has no chip to drive).
  function livematchAnnounce(roomId, extra) {
    try {
      if (!_revRawToken || !roomId) return;
      var body = { token: _revRawToken, room: String(roomId) };
      // build102y step5: additive chip fields (backend accepts {title, open} as of tonight) — title is the plain-
      // text 'Song — Artist' (clamped), open = the seat policy is not artist-only. Still fire-and-forget: a
      // backend that ignores them changes nothing game-side.
      if (extra && typeof extra === 'object') {
        if (extra.title) body.title = String(extra.title).slice(0, 80);
        if (extra.open != null) body.open = extra.open ? 1 : 0;
      }
      api('/livematch/announce', { method: 'POST', auth: true, body: body }).catch(() => {});
    } catch (e) {}
  }
  function livematchEnd(roomId) {
    try {
      if (!_revRawToken || !roomId) return;
      api('/livematch/end', { method: 'POST', auth: true, body: { token: _revRawToken, room: String(roomId) } }).catch(() => {});
    } catch (e) {}
  }
  // build102x: MATCHMAKING queue wrappers (PHASE3_MATCHMAKING_DESIGN.md — server pairs the two oldest waiting).
  // Authed REST, THROW on !ok so multiplayer.js can distinguish 401 (signed-out banner) from transient errors.
  async function matchQueue(on) { return api('/match/queue', { method: 'POST', body: { on: !!on }, auth: true }); }
  async function matchStatus(authWaitMs) { return api('/match/status', { auth: true, authWaitMs: authWaitMs || 0 }); }   // v405: optional auth-hydration grace for the ?mpqm=resume boot path
  // build105 PHASE-3 game-side: ONLINE NOW roster + direct battle-calls (backend live).
  // GET /presence/online → {users:[{id,name,avatar}]} — signed-in site+game users (<90s heartbeat), caller excluded. Throws on !ok.
  async function presenceOnline() { return api('/presence/online', { auth: true }); }
  // POST /challenge — rings the target's SITE (BattleCallAlert; ACCEPT deep-links them into ?mproom=<room_id>).
  // Errors carry the status in the message (api() format 'API <status> …') so callers can distinguish:
  // 403 = target's Battle-calls toggle is OFF · 409 = rate-limited (1/20s per caller, 3/min, 60s same-pair dedupe).
  async function challenge(targetUserId, roomId) { return api('/challenge', { method: 'POST', auth: true, body: { target_user_id: String(targetUserId || ''), room_id: String(roomId || '') } }); }
  // v416 (join-reliability): the SITE deployed a battle-call ACCEPT/DECLINE + a room preflight. These let the GAME
  // confirm a pairing server-side instead of relying purely on the flaky realtime room-meta convergence.
  //   POST /challenge/accept  { notification_id?, room_id? } → the server records the accept (so the caller's
  //     room-ready/room-status flips) — call it the instant the callee taps ACCEPT, BEFORE the realtime join races.
  //   POST /challenge/decline { notification_id?, room_id? }
  //   GET  /room-status?room=<rid> → { alive, host_online } — a cheap preflight the join loop uses to tell "host is
  //     just late" (alive:true) from "room is truly gone" (alive:false), so it never gives up early on a live room.
  // All fail-soft: they THROW on !ok (so callers can distinguish 401/404), and every game-side caller wraps them so
  // a missing/!live endpoint degrades to the pure-realtime path (byte-identical to today).
  async function challengeAccept(opts) { opts = opts || {}; var b = {}; if (opts.notificationId) b.notification_id = String(opts.notificationId); if (opts.roomId) b.room_id = String(opts.roomId); return api('/challenge/accept', { method: 'POST', auth: true, body: b }); }
  async function challengeDecline(opts) { opts = opts || {}; var b = {}; if (opts.notificationId) b.notification_id = String(opts.notificationId); if (opts.roomId) b.room_id = String(opts.roomId); return api('/challenge/decline', { method: 'POST', auth: true, body: b }); }
  async function roomStatus(roomId) { return api('/room-status?room=' + encodeURIComponent(String(roomId || '')), { auth: true }); }
  // build179 (attach-hardening): HOST heartbeat — POST /challenge/room-ready { room } upserts rr_active_rooms
  // (host_id = auth.uid, last_seen = now). The server seeds this row on /challenge + /match/queue (F1), but the
  // read-side freshness window is 90s; without a heartbeat the seed decays and a slow-to-accept callee's roomStatus
  // preflight flips alive:false while the host is right there. multiplayer.js calls this every ~30s while I host a
  // room awaiting a guest. Fire-and-forget: a missing/!live route or a 409 (room owned by another host) is a no-op
  // and the pure-realtime convergence path is unaffected (byte-identical to today when the endpoint is down).
  async function roomReady(roomId) { return api('/challenge/room-ready', { method: 'POST', auth: true, body: { room: String(roomId || '') } }); }
  // build105: GAME-SIDE presence heartbeat — puts in-game players on the ONLINE NOW roster too. Mirrors the site
  // hook semantics: POST /presence/ping every 60s while signed in AND the tab is visible; paused on document.hidden,
  // an immediate ping on return to visibility. Fire-and-forget, errors swallowed, no-op signed out (getToken null).
  var _presT = 0;
  async function _presPing() {
    try {
      if (document.hidden || !API_BASE) return;
      var tk = await getToken(); if (!tk) return;
      api('/presence/ping', { method: 'POST', auth: true, body: {} }).catch(function () {});
    } catch (e) {}
  }
  function _presStart() {
    if (_presT) return;
    _presT = setInterval(_presPing, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) _presPing(); });
    _presPing();
  }
  try { _presStart(); } catch (e) {}
  // build105 STRETCH: own-rows notifications probe (the in-game battle-call ring). A REST select with the USER's
  // JWT (RLS scopes rows to the caller); the FIRST failure of any kind (RLS block, missing table/columns) marks it
  // unavailable for the whole session — the SITE ring already covers every call, so this degrades to silence.
  // v418 (A3 — un-brick the poll rail): the FIRST failure of any kind used to set a SESSION-PERMANENT `_notifOK=false`,
  // so one boot-time auth race or one RLS hiccup killed the in-game battle-call ring for the WHOLE session (a real
  // "call won't go through" contributor). Replace it with a 5-MINUTE cooldown timestamp: a transient failure quiets
  // the probe briefly, then it recovers on its own. A getToken()==null (signed out) is NOT a failure (no cooldown —
  // it retries later), and the first onAuthChange clears the cooldown so a just-hydrated session re-probes immediately.
  var _notifCooldownUntil = 0;
  async function notifRecent() {
    try {
      if (_notifCooldownUntil && Date.now() < _notifCooldownUntil) return null;
      var base = (window.RHYTHM_CONFIG && window.RHYTHM_CONFIG.SUPABASE_URL) || '';
      var key = (window.RHYTHM_CONFIG && window.RHYTHM_CONFIG.SUPABASE_KEY) || '';
      if (!base || !key) { _notifCooldownUntil = Date.now() + 300000; return null; }
      var tk = await getToken(); if (!tk) return null;                    // signed out → try again later (NOT a hard fail, no cooldown)
      var since = new Date(Date.now() - 180000).toISOString();           // build113 fix: widened 2min->3min so a call sent while the receiver was mid-song (missed by the 30s poll cadence) still surfaces on return to menus
      var r = await fetch(base.replace(/\/$/, '') + '/rest/v1/notifications?select=*&type=eq.live_match_invite&created_at=gte.' + encodeURIComponent(since) + '&order=created_at.desc&limit=3',
        { headers: { apikey: key, Authorization: 'Bearer ' + tk } });
      if (!r.ok) { _notifCooldownUntil = Date.now() + 300000; return null; }   // transient — 5-min cooldown, NOT a session-permanent brick
      _notifCooldownUntil = 0;                                            // success clears any cooldown
      return await r.json();
    } catch (e) { _notifCooldownUntil = Date.now() + 300000; return null; }
  }
  // v418 (A3c): the first auth-state change (guest → hydrated signed-in session) drops any cooldown so the very next
  // ring poll re-probes immediately instead of waiting out a 5-min window set by a pre-auth 401.
  var _notifAuthRetried = false;
  try { onAuthChange(function () { if (!_notifAuthRetried) { _notifAuthRetried = true; _notifCooldownUntil = 0; } }); } catch (e) {}
  // ---- results auto-return ("Returning to the show in Ns") — armed only while the review track is current ----
  var _rvTimer = 0, _rvPill = null;
  function _cancelReturnCountdown() { if (_rvTimer) { clearInterval(_rvTimer); _rvTimer = 0; } if (_rvPill) { try { _rvPill.remove(); } catch (e) {} _rvPill = null; } }
  function _startReturnCountdown() {
    // build102s RETURN-PILL GUARD (Phase-2 C1): never arm the auto-return while a live show is open or a match is
    // live — the pill would drag the host to /admin mid-show (probed at FIRE time, so load order can't break it).
    if (window.RhythmMP && ((window.RhythmMP.isShowOpen && window.RhythmMP.isShowOpen()) || (window.RhythmMP.isLive && window.RhythmMP.isLive()))) return;
    _cancelReturnCountdown();
    var n = 10;
    var pill = document.createElement('div'); pill.id = 'rvl-return';
    pill.innerHTML = 'Returning to the show in <b id="rvl-return-n">' + n + '</b>s';
    var stay = document.createElement('button'); stay.type = 'button'; stay.textContent = 'STAY';
    var go = document.createElement('button'); go.type = 'button'; go.textContent = 'GO NOW'; go.className = 'go';
    pill.appendChild(stay); pill.appendChild(go);
    document.body.appendChild(pill); _rvPill = pill;
    stay.addEventListener('click', function (ev) { ev.stopPropagation(); _cancelReturnCountdown(); });
    go.addEventListener('click', function (ev) { ev.stopPropagation(); if (ev && ev.isTrusted === false) return; _cancelReturnCountdown(); location.href = _reviewReturnUrl(); });
    _rvTimer = setInterval(function () {
      n--;
      var el = document.getElementById('rvl-return-n'); if (el) el.textContent = n;
      if (n <= 0) { _cancelReturnCountdown(); location.href = _reviewReturnUrl(); }
    }, 1000);
  }
  function _setupReviewReturn() {
    var res = document.getElementById('results'); if (!res || res._rvObs) return; res._rvObs = true;
    new MutationObserver(function () {
      if (window.RhythmMP && window.RhythmMP.isShowOpen && window.RhythmMP.isShowOpen()) return;   // build102s: a show is open — never arm the return pill between runs
      var on = res.classList.contains('active') && currentTrack && currentTrack._review;
      if (on) _startReturnCountdown(); else if (!res.classList.contains('active')) _cancelReturnCountdown();
    }).observe(res, { attributes: true, attributeFilter: ['class'] });
    // any interaction WITH the results screen = "I'm not done here" → cancel (PLAY AGAIN / leaderboard reading)
    res.addEventListener('pointerdown', function () { _cancelReturnCountdown(); }, true);
    window.addEventListener('keydown', function () { if (_rvTimer) _cancelReturnCountdown(); }, true);
  }
  // build102z p1.5 (owner mandate): a VIDEO submission ("Play in Reactive Rhythm" on a film/MV) still plays —
  // FLIX-STYLE, the video full-bleed behind the highway while the chart runs off the same media's decoded
  // audio (WebAudio decodes an mp4/mov/webm's audio track — the exact AI-Flix contract). Detection is the
  // same FUZZY class as mediaType(): the resolve payload has no media_type field either, so we sniff the
  // chosen playable URL's container extension + the payload's own genre/title hints (isVideo(r)).
  function _rvIsVideoUrl(u) { return !!u && /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(String(u)); }
  async function _resolveReview(token) {
    if (!token || !API_BASE) { _rvState('Missing review link — head back to the show and press Play in Reactive Rhythm again.'); return; }
    _revRawToken = token;   // build102s: kept for POST /show/invite (GO LIVE artist call-in)
    try {
      var r = await api('/review/resolve?token=' + encodeURIComponent(token), { auth: true, authWaitMs: 4000 });
      if (!r || !r.track_id) { _rvState('Couldn’t open this review track.'); return; }
      // build102t (LIVE playtest fix): pick the FIRST decodable audio the resolver offers. analysis_url is only
      // populated for Mux-backed sources — a DIRECT-upload submission (e.g. "Backroom Bop", a plain mp3) carries its
      // decodable audio in audio_url/stream_url instead, and reading analysis_url alone dumped the host into the bare
      // watch player instead of the launch card. Any non-HLS URL decodes (WebAudio handles mp3/m4a/wav/mp4-aac).
      var _dec = function (u) { return (u && !/\.m3u8(\?|$)/i.test(String(u))) ? u : null; };
      var aurl = _dec(r.analysis_url) || _dec(r.audio_url) || _dec(r.stream_url) || '';
      if (!aurl) {                                           // truly nothing decodable (HLS-only) → offer WATCH on the CARD, never a naked player
        if (r.stream_url) {
          var ti0 = _rvEl('rvl-title'); if (ti0) ti0.textContent = r.title || 'Review';
          var ar0 = _rvEl('rvl-artist'); if (ar0) ar0.textContent = r.artist_name || '';
          var art0 = _rvEl('rvl-art'); if (art0 && r.artwork_url) art0.src = r.artwork_url;
          _rvState('This song’s game audio isn’t ready yet — watch the submission now, or retry in a few minutes.');
          var st0 = _rvEl('rvl-state');
          if (st0 && !st0._watchBtn) {
            st0._watchBtn = true;
            var wb = document.createElement('button'); wb.type = 'button'; wb.className = 'rvl-back'; wb.style.display = 'block'; wb.style.margin = '10px auto 0';
            wb.textContent = '▶ Watch it instead';
            wb.addEventListener('click', function (ev) { if (ev && ev.isTrusted === false) return; var ovx = _rvEl('review-launch'); if (ovx) ovx.classList.remove('on'); try { openWatch(Object.assign({ id: r.track_id }, r), r.stream_url); } catch (e) {} });   // review fix 4: same synthetic-click guard as every sibling card button
            st0.parentNode.insertBefore(wb, st0.nextSibling);
          }
        }
        else _rvState('This track isn’t playable yet — the audio is still processing. Try again in a minute.');
        return;
      }
      var _revTrack = {
        id: r.track_id, title: r.title, artist_name: r.artist_name, artist_credit_name: r.artist_name,
        artwork_url: r.artwork_url, genre: r.genre, duration_seconds: r.duration_seconds || 0,
        audio_url: aurl, analysis_url: aurl, chart_status: 'pending',
        _review: true,                                       // SCORED (owner decree) — no _preview flag, recordLocal runs in full
        // build102s: role/submitter from the extended resolver. A MISSING role = the currently-deployed
        // resolver (host tokens only, host-locked) → treat as 'host' for back-compat; GO LIVE keys on this.
        _role: r.role || 'host', _submitterId: r.submitter_id || null, _submitterName: r.submitter_name || ''
      };
      // build102z p1.5 + v415 review fix: VIDEO submission → flix-style launch, but ONLY when a REAL, playable
      // (non-HLS) video backdrop actually exists. Find that source first — the charted media itself when it's a
      // video container (same file → chart timing IS video timing), else a video-looking payload field (the
      // same-source Mux rendition pair). The title/genre heuristic (isVideo) must NEVER flip flix mode on its
      // own: an AUDIO track merely TITLED "... Official Video" / "Lyric Video" would otherwise get a permanent
      // BLACK flix backdrop. When no playable video is found we force the synthetic track audio-shaped
      // (media_type is mediaType()'s #1 signal → overrides the title heuristic → launchTrack accepts it as a
      // normal review with a normal backdrop, never a dead button). Audio submissions are byte-identical below.
      var _vcands = [aurl, r.video_url, r.stream_url, r.media_url], _vurl = null;
      for (var _vi = 0; _vi < _vcands.length; _vi++) { var _vu = _dec(_vcands[_vi]); if (_vu && _rvIsVideoUrl(_vu)) { _vurl = _vu; break; } }
      if (_vurl) { _revTrack._flixReview = true; _revTrack.video_url = _vurl; }   // real backdrop → flix (videoWatchUrl() reads video_url)
      else { _revTrack.media_type = 'audio'; }                                    // no playable video → normal audio review (immune to a title false-positive)
      _setupReviewReturn();
      _openReviewLaunch(_revTrack);
      try { window.RhythmGame.showToast && window.RhythmGame.showToast('Review track — pick a difficulty and PLAY. This run is scored.', 'neutral'); } catch (e) {}
      // fire-and-forget use log (event_type stays 'preview' — the only game_track_uses values the backend knows; review rides the meta)
      try { if (r.track_id) logUse(r.track_id, 'preview', { review: true }); } catch (e) {}
    } catch (e) {
      var msg = String((e && e.message) || '');
      var t = /\b401\b|expired/i.test(msg) ? 'This review link expired — head back to the show and press Play in Reactive Rhythm again.'
            : (/\b403\b/.test(msg) ? 'This review link belongs to the host who created it — sign in on ReactivVibe as that host, then retry.'
            : 'Couldn’t open the review track. Check you’re signed in on ReactivVibe, then retry from the show panel.');
      _rvState(t);
      try { window.RhythmGame.showToast && window.RhythmGame.showToast(t, 'error'); } catch (e2) {}
    }
  }
  // dev hook (strip at launch with __rrDebug & co) — lets a headless preview drive the card without a real token
  try { window.__rrReview = { open: _openReviewLaunch, loading: _openReviewLoading, state: _rvState, arm: _startReturnCountdown, cancel: _cancelReturnCountdown, setup: _setupReviewReturn, vid: _rvIsVideoUrl }; } catch (e) {}   // build102z p1.5: .vid = the video-URL sniffer (headless verify)

  async function boot() {
    if (!window.RhythmGame) { console.error('engine not loaded'); return; }
    try { _stampLastVisit(); } catch (e) {}   // retention: read the previous rr_lastVisit, then stamp now (the ONE permitted write; feeds freshSince/lastVisitAgeHours)
    // build101: the review deep-launch boots FIRST and IN PARALLEL with the catalog fetch — the card needs no
    // library, and the old serial order painted the review seconds late behind the full paged /tracks crawl.
    var _q = new URLSearchParams(location.search);
    var _rev = _q.get('review'), _revP = null;
    if (_rev && _q.get('mproom')) {
      // build102 (Phase-2 judge blocker): an INVITE/SPECTATE link carries BOTH ?mproom= and ?review= (share token).
      // The MP room join owns that boot — never raise the Phase-1 launch card on top of it (a submitter would see
      // host-only controls). Stash the token for the live-show module (audio resolve at match time) and stand down.
      try { window.__rrShareTok = _rev; } catch (e) {}
    } else if (_rev) {
      _reviewMode = true;
      var _ret = _q.get('return');                           // optional same-origin return path (default /admin)
      if (_ret && /^\/[A-Za-z0-9._~\-\/]*$/.test(_ret) && _ret.indexOf('//') !== 0) _reviewReturnPath = _ret;
      _openReviewLoading();
      _revP = _resolveReview(_rev);
    }
    await loadCatalog();
    renderHome();

    // deep link: /play?trackId=<uuid> → open that song's sheet directly
    const trackId = _q.get('trackId');
    if (trackId && API_BASE) {
      try {
        const t = await api('/track/' + trackId, { auth: true });
        // build35 (audit P0): pass the FULL /track/:id object. The old cherry-pick dropped
        // chart_status/has_chart/audio_url/wav_url/stream_url, so trackReady() failed and every shared
        // /play?trackId=<uuid> link dead-ended (Play disabled, or fell back to the demo track).
        openSheet(Object.assign({}, t));
      } catch (e) { console.warn('deep-link track load failed', e); }
    }

    if (_revP) { try { await _revP; } catch (e) {} }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
