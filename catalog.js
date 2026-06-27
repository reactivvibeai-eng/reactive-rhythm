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
    // build100m (auth-hardening): the LOCAL Supabase session is the SOURCE OF TRUTH for "is someone signed in" — a local
    // read (getSession), NO network + NO CORS dependency. /me only ENRICHES with the site profile (display_name + avatar);
    // it must NEVER demote a valid local session to "logged out". The OLD code returned null on /me {user:null} or any
    // /me hiccup → a logged-in owner showed as a GUEST when /me had a CORS issue or didn't recognize the token. No local
    // session → genuinely logged out. (The server still validates the JWT on every authed call — this is just identity.)
    if (!supa) return null;
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
    } catch (e) { _isAdmin = false; }
    return _isAdmin;
  }
  refreshAdmin();   // populate ASAP; index.html re-drives it on auth change for live login/logout
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
    if (owns.indexOf(key) >= 0) return { ok: true, deduped: true, balance: getBonusSparks() };
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
    if (FREE_ITEMS[t + ':' + i]) return true;   // FREE community unlock (e.g. CelinesRazor's guitar) — owned by everyone, no purchase, even for a fresh player
    var _asPlayer = false; try { _asPlayer = /[?&]asplayer=1/.test(location.search); } catch (e) {}
    if (!_asPlayer && (_isAdmin || _isDevUnlock())) return true;   // admin/dev owns everything; a fresh-player sim owns ONLY real entitlements
    try { if (loadBonusOwns().indexOf(t + ':' + i) >= 0) return true; } catch (e) {}   // earned-Bonus-Sparks purchase (local, legit even for a fresh player)
    // build100q: normalize hyphen/underscore on BOTH sides — authored level ids are hyphen ('high-seas') while the
    // store/campaign entitlement ids are underscore ('high_seas'). Exact compare made the env-pick/launch gate query an
    // id never in the cache → a real purchaser (and the admin during the async _isAdmin resolve window) saw paid levels
    // as locked. Compare slug-insensitively so the two id forms agree.
    var _nm = function (s) { return String(s).replace(/-/g, '_'); };
    var _ni = _nm(i);
    return _entitlements.owns.some(function (o) { return o.item_type === t && _nm(o.item_id) === _ni; });
  }
  async function getEntitlements() {
    if (!API_BASE) { _setEntCache([], false); return { signed_in: false, owns: [] }; }
    try {
      const out = await api('/entitlements', { auth: true });
      // build50: tolerate BOTH shapes — the live backend returns { entitlements:[…] } but the brief asks for { owns:[…] }.
      const owns = Array.isArray(out && out.owns) ? out.owns : (Array.isArray(out && out.entitlements) ? out.entitlements : []);
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
          // ONLY show songs that actually play — no dead taps, ever. THE chokepoint:
          // split videos OUT of the music catalog here, so every music surface (rails,
          // browse, search, pickers) is music-only for free; videos go to their own bucket.
          var ready = all.filter(trackReady);
          catalogTracks = ready.filter(function (t) { return !isVideo(t); });
          // build99N: videos gate on WATCHABILITY, not the music chartability gate (trackReady). A film can
          // always be watched even with no decodable audio to chart — recovers ~30 of 142 films that were hidden.
          catalogVideos = all.filter(function (t) { return isVideo(t) && videoReady(t); });
          catalogLive = true;
          return;
        } else {
          // build72: a 200-but-EMPTY library would silently fall through to the 1000 mock songs with no signal — mirror the catch-branch toast so the player knows these are samples (the refresh icon retries)
          try { if (window.RhythmGame && window.RhythmGame.showToast) window.RhythmGame.showToast('Library is empty right now — showing samples', 'error'); } catch (e2) {}
        }
      } catch (e) {
        console.warn('catalog fetch failed → preview catalog', e);
        // build58: don't silently swap in fake sample songs — tell the player the live library didn't load (the refresh icon retries).
        try { if (window.RhythmGame && window.RhythmGame.showToast) window.RhythmGame.showToast("Couldn't reach the library — showing samples", 'error'); } catch (e2) {}
      }
    }
    catalogLive = false;
    const mock = buildMockCatalog(1000);
    catalogRawCount = mock.length;
    var readyM = mock.filter(trackReady);   // preview also shows only playable
    catalogTracks = readyM.filter(function (t) { return !isVideo(t); });
    catalogVideos = mock.filter(function (t) { return isVideo(t) && videoReady(t); });
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
  function hasServerChart(t) { return !!t && (t.chart_status === 'ready' || t.has_chart); }
  // ▼▼▼ SWAP-SEAM ▼▼▼ — media type (music vs video). Prefer an AUTHORITATIVE backend
  // field (media_type / is_video). When Lovable ships it, ONLY mediaType() changes —
  // isVideo/musicTracks/videoTracks and every caller stay put. Until then, fall back to
  // a genre/title heuristic. Mirrors the BONUS-SPARKS seam. See VIDEO_SEPARATION_BRIEF.md.
  // NOTE: the backend match is deliberately FUZZY (/video|film|^mv$/i) so a plausible value
  // like 'music_video' / 'mv' / 'video/mp4' still classifies as video — an exact === 'video'
  // would let such a value read as music (field present → heuristic skipped → silent re-leak).
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
    ['easy', 'medium', 'hard'].forEach(d => { const r = s[trackId + '|' + d]; if (r && (!best || r.score > best.score)) best = Object.assign({ difficulty: d }, r); });
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
    // SALTED per-track hash (stable across reloads) → each rail gets an INDEPENDENT permutation, so the
    // rails stay distinct even when created_at/play_count are all empty (different salt = different order).
    const hsh = (t, salt) => { var s = salt + String(t.id || t.title || ''), h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; };
    const dateOf = (t) => (typeof t.created_at === 'number' ? t.created_at : Date.parse(t.created_at)) || 0;   // build58: created_at is already normalized to ms (loadCatalog/mock) — Date.parse(number) was NaN→0, collapsing "New" to the hash order (a fresh upload never surfaced first)
    const feat = catalogTracks.filter(t => t.featured);
    // FEATURED: real featured flags first; fallback = a curated slice on the 'F' permutation.
    const featured = readyFirst((feat.length ? feat : catalogTracks.slice()).sort((a, b) => hsh(a, 'F') - hsh(b, 'F'))).slice(0, 24);
    // HOT: play_count desc, then the 'H' permutation (distinct from Featured/New).
    const hot = readyFirst(catalogTracks.slice().sort((a, b) => ((b.play_count || 0) - (a.play_count || 0)) || (hsh(a, 'H') - hsh(b, 'H')))).slice(0, 24);
    // NEW: newest-first by created_at, then the 'N' permutation when dates tie.
    const fresh = readyFirst(catalogTracks.slice().sort((a, b) => (dateOf(b) - dateOf(a)) || (hsh(a, 'N') - hsh(b, 'N')))).slice(0, 24);
    const readyPool = catalogTracks.filter(trackReady);
    const pool = (readyPool.length ? readyPool : catalogTracks).slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }   // build58: unbiased Fisher-Yates (the old comparator shuffle was non-uniform); memoized so Surprise is a STABLE pick per load
    return { featured, hot, new: fresh, surprise: pool.slice(0, 24) };
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
        $('sheet-hint').textContent = 'AI Flix \u2014 the music video plays behind the highway. Tap PLAY.';
        if (playBtn) { playBtn.disabled = false; playBtn.classList.remove('not-ready'); }
        if (playLabel) playLabel.textContent = '\u25b6 Play AI Flix';
        const _flixFn = () => { playFlix(track); };
        _flixFn._preview = true;   // bypass the env-picker wrapper \u2014 the flix manages its OWN #bg-video backdrop
        window.RhythmGame.setMenuPlayHandler(_flixFn);
        sheet.classList.add('open');
        return;
      }
      // no decodable audio \u2192 Watch-only preview (the playable level needs a chartable audio track)
      $('sheet-hint').textContent = wsrc
        ? 'AI Flixs film \u2014 a playable level is coming soon. Tap Watch for a preview.'
        : 'AI Flixs film \u2014 coming to the game soon.';
      if (playBtn) { playBtn.disabled = !wsrc; playBtn.classList.toggle('not-ready', !wsrc); }
      // build100e (relatability): reserve the \u25b6 play arrow for the CHARTABLE "Play AI Flix" case. A watch-only film uses an
      // eye + "Watch preview" so a newcomer reads playable-level vs video-preview as clearly different outcomes.
      if (playLabel) playLabel.textContent = wsrc ? '\ud83d\udc41 Watch preview' : 'Coming soon';
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
      if (liveTrack && hasServerChart(track)) {
        window.RhythmGame.play(liveProvider(track.id));               // server chart → scored + leaderboard
      } else if (liveTrack && trackAudioUrl(track)) {
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

    sheet.classList.add('open');
  }
  function closeSheet() { sheet.classList.remove('open'); }

  // AI Flixs interim WATCH overlay — muted inline <video> preview ONLY (never the rhythm engine). Phase 5.
  function openWatch(track, src) {
    let ov = document.getElementById('flix-watch');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'flix-watch'; ov.className = 'flix-watch';
      ov.innerHTML = '<div class="fw-scrim"></div>' +
        '<div class="fw-box"><button class="fw-close" type="button" aria-label="Close">✕</button>' +
        '<video class="fw-video" playsinline muted controls preload="metadata"></video>' +
        '<div class="fw-cap"></div></div>';
      document.body.appendChild(ov);
      ov.querySelector('.fw-scrim').addEventListener('click', closeWatch);
      ov.querySelector('.fw-close').addEventListener('click', closeWatch);
      // build93 (playtest): Esc closes the Watch overlay — the owner plays keyboard, and this was the lone
      // modal without a keyboard dismiss. Capture-phase + open-gated so it only fires while the overlay is up.
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('open')) { e.stopImmediatePropagation(); closeWatch(); } }, true);
    }
    const v = ov.querySelector('.fw-video');
    v.poster = posterFor(track); v.src = src;
    ov.querySelector('.fw-cap').textContent = (track.title || '') + ' — ' + (track.artist_name || '');
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
    _flixActive = true; _flixVideoUrl = videoUrl; _flixSawActive = false;
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
    const liveTrack = catalogLive && track.id && track.id !== 'demo';
    if (liveTrack && hasServerChart(track)) {
      window.RhythmGame.play(liveProvider(track.id));
    } else if (liveTrack && trackAudioUrl(track)) {
      window.RhythmGame.playUrl(trackAudioUrl(track), {
        id: track.id,   // carry the track id for telemetry (song_start/complete)
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

  // ---------- ALWAYS-on local recorder — called by the engine on EVERY completed run,
  // including in-browser-charted tracks that have no server submit (i.e. all live tracks
  // today). This is what makes the cover-art grade chips + the Career profile reflect your
  // real play instead of only the mock seed. Leaderboard submit (below) stays separate.
  function recordLocal(results) {
    if (!results) return;
    if ((currentTrack && currentTrack._preview) || (results && results.preview)) return;   // build100h+: host review preview — NO career/best/bonus/plays/score submit (scoring:'preview_only')
    const grade = results.grade || gradeFor(results.accuracy || 0);
    const failed = !!results.failed;
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
        ['easy', 'medium', 'hard'].forEach(d => { const r = s[currentTrack.id + '|' + d]; if (r && (!prevReal || r.score > prevReal.score)) prevReal = r; });
      } catch (e) {}
      const isNewBest = !prevReal || results.score > (prevReal.score || 0);
      const isGradeUp = !!prevReal && (GRADE_ORDER[grade] || 0) > (GRADE_ORDER[prevReal.grade] || 0);
      // thread these onto the results object so the Share Card (game.js share handler) can flag
      // a NEW BEST / GRADE UP run without recomputing — recordLocal runs once, right after render.
      try { results._newBest = isNewBest; results._gradeUp = isGradeUp; } catch (e) {}
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
          } });
          // build100i: Lovable returns { id, play_id, rank_global } from /score (a /plays alias). Capture the canonical
          // play_id, then earn server Bonus against it (POST /bonus-sparks/earn { play_id, daily_rift }). _rift3x carries
          // the day's-first-clear intent; the server validates it. No-op unless BONUS_SERVER + signed-in.
          var _pid = out && (out.play_id || out.id);
          try { if (_pid && currentTrack) currentTrack.play_id = _pid; } catch (e) {}
          _bonusEarnForRun(_pid, results, _rift3x);
          let board = [];
          try { board = lbRows(await api('/leaderboard/' + currentTrack.id + '?difficulty=' + results.difficulty + '&limit=10')); } catch (e) {}
          onSubmitResult({ rank_global: out && out.rank_global, leaderboard: board }, results);
        } catch (e) { /* backend not live yet -> stay local-only (no regression) */ }
      })();
    }
  }

  // build72: catalog-side mirror of index.html's cleanName (it lives in a separate IIFE we can't reach) — scrub
  // slur display names on the RESULTS leaderboard panel the same way the overlay board already does.
  var LB_BADWORDS = ['nigger','nigga','faggot','retard','cunt','rape','kike','spic','chink','fuck','shit','bitch','whore','slut','dick','cock','pussy','asshole','bastard','nazi','wank','twat','jizz','coon','tranny'];
  function scrubName(s) {
    var raw = String(s == null ? '' : s).trim();
    if (!raw) return 'anon';
    var norm = raw.toLowerCase().replace(/[\s_\-.]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's').replace(/!/g, 'i');
    for (var i = 0; i < LB_BADWORDS.length; i++) { if (norm.indexOf(LB_BADWORDS[i]) >= 0) return 'player'; }
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
      const rows = lbRows(await api('/leaderboard/global?limit=' + (opts.limit || 20)));
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

  window.RhythmCatalog = {
    onSubmitResult, recordLocal, getCareer, liveProvider, openSheet, launchTrack, mpSettle, mpRoundStart,
    // identity + Sparks shell (UI reads these; real /sparks API later)
    getUser, onAuthChange, getSparks, isAdmin, refreshAdmin,
    // BONUS SPARKS — platform-only soft currency (gameplay earn loop; NOT cashable). SWAP-SEAM in catalog.js.
    getBonusSparks, awardBonusSparks, spendBonusSparks, bonusBuy, getBonusOwns,
    // store / entitlements (LIVE: GET /store, GET /entitlements, POST /sparks/spend)
    getStore, getEntitlements, spendSparks, ownsItem, _entitlements,
    fetchLeaderboard, fetchGlobalLeaderboard,
    // data layer for the library UI (jukebox.js)
    allTracks, allMedia, isLive: () => catalogLive, genreList, artistList, byGenre, byArtist,
    // media-type split: videos live in their own bucket, OUT of the music lists/rails/search
    isVideo, mediaType, musicTracks, videoTracks, videoCount, posterFor, goldenBuzzer,
    playFlix, firstPlayableFlix,   // build99: launch a film as a playable level (video backdrop + charted from its audio); firstPlayableFlix = audio-reachability self-heal for the premiere hero
    // DAILY RIFT (build100): deterministic-by-date song pick + once/day ×3 Bonus flag (consumed in recordLocal). Menu controller in index.html paints + launches.
    dailyRiftTrack, dailyRiftState, dailyRiftToday, setDailyRift,
    search, sortTracks, sections, getBest,
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
  };

  // ===========================================================================
  // BOOT
  // ===========================================================================
  // build100h+ — "Play in Reactive Rhythm" HOST REVIEW handoff. A host clicks a button on the site that opens
  // reactivvibeai.com/game?review=<signed token>. The token is OPAQUE to the game; we forward it to the catalog to
  // resolve (keeps the audio URL + approval off the wire, lets the backend revoke). The resolved track plays in
  // PREVIEW mode (scoring:'preview_only') — chart + audio + local HUD, but NO play_token / NO /plays / NO bonus mint.
  async function _resolveReview(token) {
    if (!token || !API_BASE) return;
    try {
      var r = await api('/review/resolve?token=' + encodeURIComponent(token), { auth: true });
      if (!r || !r.track_id) return;
      var aurl = r.analysis_url || '';                       // the decodable .m4a (chartable) — NOT the .m3u8 stream
      if (!aurl || /\.m3u8(\?|$)/i.test(aurl)) {             // no decodable audio → can only WATCH the stream
        if (r.stream_url) { try { openWatch(Object.assign({ id: r.track_id }, r), r.stream_url); } catch (e) {} }
        else { try { window.RhythmGame.showToast && window.RhythmGame.showToast('This review track isn’t playable yet', 'neutral'); } catch (e) {} }
        return;
      }
      // build100q (#review): OPEN THE SONG SHEET (difficulty grid + environment/level picker) instead of playing
      // immediately — the host asked to SEE the song, pick how hard + which level, THEN play. A synthetic track carries
      // the decodable audio in analysis_url (→ trackReady + trackAudioUrl) + chart_status:'pending' (in-browser chart)
      // + _preview:true so the sheet's Play path charts it but recordLocal/onSubmitResult skip ALL persistence
      // (career/best/bonus + /plays + /score) via the currentTrack._preview gate (~1474). The run is NOT scored.
      var _revTrack = {
        id: r.track_id, title: r.title, artist_name: r.artist_name, artist_credit_name: r.artist_name,
        artwork_url: r.artwork_url, genre: r.genre, duration_seconds: r.duration_seconds || 0,
        audio_url: aurl, analysis_url: aurl, chart_status: 'pending',
        _preview: true, _review: true
      };
      try { openSheet(_revTrack); } catch (e2) { window.RhythmGame.playUrl(aurl, { id: r.track_id, title: r.title, artist: r.artist_name, artwork: r.artwork_url, genre: r.genre, preview: true }); }
      try { window.RhythmGame.showToast && window.RhythmGame.showToast('Review track — pick difficulty + level, then Play (not scored)', 'neutral'); } catch (e) {}
      // optional, fire-and-forget: log a preview use (auth optional, endpoint already live).
      try { if (r.track_id) logUse(r.track_id, 'preview', { review: true }); } catch (e) {}
    } catch (e) {
      var msg = String((e && e.message) || '');
      var t = /\b401\b|expired/i.test(msg) ? 'This review link expired — ask for a fresh one'
            : (/\b403\b/.test(msg) ? 'This account isn’t a review host' : 'Couldn’t open the review track');
      try { window.RhythmGame.showToast && window.RhythmGame.showToast(t, 'error'); } catch (e2) {}
    }
  }
  async function boot() {
    if (!window.RhythmGame) { console.error('engine not loaded'); return; }
    await loadCatalog();
    renderHome();

    // deep link: /play?trackId=<uuid> → open that song's sheet directly
    const trackId = new URLSearchParams(location.search).get('trackId');
    if (trackId && API_BASE) {
      try {
        const t = await api('/track/' + trackId, { auth: true });
        // build35 (audit P0): pass the FULL /track/:id object. The old cherry-pick dropped
        // chart_status/has_chart/audio_url/wav_url/stream_url, so trackReady() failed and every shared
        // /play?trackId=<uuid> link dead-ended (Play disabled, or fell back to the demo track).
        openSheet(Object.assign({}, t));
      } catch (e) { console.warn('deep-link track load failed', e); }
    }

    // deep link: /game?review=<signed token> → host review preview (resolve + play, not scored)
    try { var _rev = new URLSearchParams(location.search).get('review'); if (_rev) await _resolveReview(_rev); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
