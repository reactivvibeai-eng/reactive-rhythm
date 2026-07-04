// ===========================================================================
// goals.js — build110: Retention system ledger (XP / Level / Streak / Daily+Weekly Goals).
// Pure module: owns exactly THREE localStorage keys (rr_goals, rr_streak, rr_xp), no DOM,
// no network. Exposes window.RhythmGoals. See retention-build-spec.md for the full design —
// this file implements it verbatim (do not invent parallel schemas).
//
// Status, not currency: XP/levels/streak unlock COSMETICS ONLY (via the existing
// rr_bonus_owns array + new item_type prefixes: notecolor:/namecolor:/flair:/noteskin:).
// No Bonus Sparks or cashable Sparks are ever minted here.
// ===========================================================================
(function () {
  'use strict';

  var KEY_GOALS = 'rr_goals';
  var KEY_STREAK = 'rr_streak';
  var KEY_XP = 'rr_xp';

  // ---- date helpers (duplicated, not imported — see spec Phase 0 note: don't refactor
  // catalog.js's internal helpers mid-build; a later cleanup pass can hoist a shared util) ----
  function dayKey() {
    try { if (window.RhythmCatalog && window.RhythmCatalog.dailyRiftToday) return window.RhythmCatalog.dailyRiftToday(); } catch (e) {}
    var d = new Date();
    var mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
  // ISO week key — same ALGORITHM as catalog.js _isoWeekKey() but computed in LOCAL time (not UTC),
  // ON PURPOSE (build110 review): dayKey() above is local, and pairing a UTC week-key with a local
  // day-key made checkRollover() flip the week EARLY for US timezones — a player in UTC-7 who plays
  // Sunday after ~5pm local (= Mon 00:00 UTC) had this return next week's key while their local week
  // was still going, zeroing their weekly-goal progress hours before their week actually ended. Local
  // fields keep the weekly boundary on the player's own Monday. (This is rr_goals.weekKey, independent
  // of catalog.js's UTC rr_bonus_week — they don't need to match.)
  function isoWeekKey() {
    var d = new Date(); var day = (d.getDay() + 6) % 7;
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 3);
    var w1 = new Date(t.getFullYear(), 0, 4);
    var wk = 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
    return t.getFullYear() + '-W' + wk;
  }
  // yesterday's day-key relative to a given day-key (used for streak continuity check).
  function prevDayKey(fromKey) {
    try {
      var p = String(fromKey || '').split('-');
      var d = new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
      d.setDate(d.getDate() - 1);
      var mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2);
      return d.getFullYear() + '-' + mm + '-' + dd;
    } catch (e) { return null; }
  }

  // ---- storage plumbing ----
  function load(key, def) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : def(); }   // build110 review: !Array.isArray — typeof []==='object', so a bare JSON array would be accepted then stringify back to "[]", silently dropping all named state on the next save
    catch (e) { return def(); }
  }
  function save(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {} }

  function defGoals() {
    return { date: dayKey(), levels: 0, mp: 0, claimedDaily: false, weekKey: isoWeekKey(), weekLevels: 0, weekMp: 0, claimedWeekly: false };
  }
  function defStreak() {
    // build122 p3: freezeJustUsed — see updateStreakOnDailyClaim's freeze-consumed branch + consumeFreezeJustUsed below.
    return { count: 0, lastCompleteDate: null, freezeBanked: false, freezeEarnedAtCount: 0, milestonesSeen: [], freezeJustUsed: false };
  }
  function defXp() {
    return { xp: 0, level: 1, log: [] };
  }

  function loadGoals() { return load(KEY_GOALS, defGoals); }
  function saveGoals(g) { save(KEY_GOALS, g); }
  function loadStreak() { return load(KEY_STREAK, defStreak); }
  function saveStreak(s) { save(KEY_STREAK, s); }
  function loadXp() { return load(KEY_XP, defXp); }
  function saveXp(x) { save(KEY_XP, x); }

  // ---- goal thresholds (spec §1.1 / §1.2) ----
  var DAILY_LEVELS = 3, DAILY_MP = 3;
  var WEEKLY_LEVELS = 15, WEEKLY_MP = 10;

  // ---- XP curve (spec §1.4): Level N requires floor(80 * N^1.35) cumulative XP, for N>=2 —
  // per the spec's worked examples (L2=80, L5≈640, L10≈1950, L20≈5500, L30≈9900). Level 1 is the
  // free starting level (0 XP required) — there is no "L1 requirement" in the design.
  function xpForLevel(n) { return n <= 1 ? 0 : Math.floor(80 * Math.pow(n, 1.35)); }
  function levelForXp(xp) {
    var lvl = 1;
    while (xpForLevel(lvl + 1) <= xp) lvl++;
    return lvl;
  }

  // ---- XP log ring buffer (last 5) ----
  function pushLog(x, label, amt) {
    x.log = x.log || [];
    x.log.unshift({ label: String(label || ''), amt: Math.round(amt) || 0, ts: Date.now() });
    if (x.log.length > 5) x.log.length = 5;
  }

  // grant XP, never zero on a completed action (spec §1.4), update level, dispatch level-up event(s)
  // for every level threshold crossed (in case a big grant skips multiple levels at once).
  function grantXp(amt, label) {
    amt = Math.max(0, Math.round(amt || 0));
    if (amt <= 0) return loadXp();
    var x = loadXp();
    var beforeLevel = x.level || 1;
    x.xp = (x.xp || 0) + amt;
    var newLevel = levelForXp(x.xp);
    pushLog(x, label, amt);
    x.level = newLevel;
    saveXp(x);
    if (newLevel > beforeLevel) {
      try {
        document.dispatchEvent(new CustomEvent('rr-levelup', { detail: { level: newLevel, from: beforeLevel, xp: x.xp } }));
      } catch (e) {}
      // fire cosmetic unlocks for every level threshold crossed (spec §1.5 map)
      for (var lv = beforeLevel + 1; lv <= newLevel; lv++) unlockForXpLevel(lv);
    }
    return x;
  }

  // ---- cosmetic unlocks — write into the EXISTING rr_bonus_owns array (plain "type:id" strings,
  // per catalog.js loadBonusOwns/saveBonusOwns/ownsItem, catalog.js ~189-194 / ~469). Never touches
  // any purchase/spend path — structurally free, per spec §5. ----
  function grantCosmetic(itemKey) {
    try {
      var arr;
      try { arr = JSON.parse(localStorage.getItem('rr_bonus_owns') || '[]'); if (!Array.isArray(arr)) arr = []; } catch (e) { arr = []; }
      if (arr.indexOf(itemKey) < 0) {
        arr.push(itemKey);
        localStorage.setItem('rr_bonus_owns', JSON.stringify(arr));
        return true;
      }
    } catch (e) {}
    return false;
  }

  // XP-level milestone -> unlock map (spec §1.5). build118 p2: added namefont:*/frame:* alongside the
  // existing namecolor/noteskin/flair prefixes — same grant plumbing, just new item-type prefixes.
  var XP_UNLOCKS = {
    3: 'namecolor:bronze',
    5: 'noteskin:embertrail',
    8: 'flair:badgeframe_anim',
    10: 'namefont:rajdhani',
    12: 'namecolor:rare_crimson',
    15: 'noteskin:exclusive_15',
    18: 'frame:badgeframe',
    20: 'flair:animated_badge'
  };
  // streak-day milestone -> unlock map (spec §1.5). build118 p2: added namefont:*/frame:* milestones.
  var STREAK_UNLOCKS = {
    7: 'namecolor:ember',
    14: 'notecolor:embertrail_perm',
    21: 'namefont:orbitron',
    30: 'flair:accent_decal',
    45: 'frame:undying_ring',
    60: 'namecolor:whitehot',
    100: 'flair:undying_ring'
  };
  // build118 p2 (spec item 4 — prestige recognition): a 5th tier beyond flair — a name PREFIX/TITLE tag,
  // unlocked only when BOTH XP Level 20 AND a 100-day streak are reached (checked from either trigger
  // site below; grantCosmetic's own arr.indexOf dedup makes this idempotent no matter which fires last).
  var PRESTIGE_ITEM = 'title:rift_legend';
  function maybeGrantPrestige() {
    var lvl = (loadXp().level || 1), days = (loadStreak().count || 0);
    if (lvl < 20 || days < 100) return;
    var granted = grantCosmetic(PRESTIGE_ITEM);
    if (granted) {
      try { document.dispatchEvent(new CustomEvent('rr-cosmetic-unlock', { detail: { item: PRESTIGE_ITEM, source: 'prestige' } })); } catch (e) {}
    }
  }

  function unlockForXpLevel(level) {
    var item = XP_UNLOCKS[level];
    if (item) {
      var granted = grantCosmetic(item);
      if (granted) {
        try { document.dispatchEvent(new CustomEvent('rr-cosmetic-unlock', { detail: { item: item, source: 'xp', level: level } })); } catch (e) {}
      }
    }
    if (level >= 20) maybeGrantPrestige();
  }

  // streak milestone days that grant a cosmetic (subset of STREAK_UNLOCKS) plus 3 which is
  // toast-only per spec table (no unlock listed at day 3, but it IS a milestone-seen entry).
  // build118 p2: added 21/45 for the new namefont:orbitron/frame:undying_ring streak unlocks (STREAK_UNLOCKS
  // below) — every original day (7/14/30/60/100) already carried an item, so new milestones needed new days
  // rather than overloading an existing one (fireStreakMilestones only grants ONE item per day).
  var STREAK_MILESTONE_DAYS = [3, 7, 14, 21, 30, 45, 60, 100];

  function fireStreakMilestones(streak) {
    streak.milestonesSeen = streak.milestonesSeen || [];
    STREAK_MILESTONE_DAYS.forEach(function (d) {
      if (streak.count >= d && streak.milestonesSeen.indexOf(d) < 0) {
        streak.milestonesSeen.push(d);
        var item = STREAK_UNLOCKS[d];
        if (item) {
          var granted = grantCosmetic(item);
          if (granted) { try { document.dispatchEvent(new CustomEvent('rr-cosmetic-unlock', { detail: { item: item, source: 'streak', days: d } })); } catch (e) {} }
        }
        try { document.dispatchEvent(new CustomEvent('rr-streak-milestone', { detail: { days: d, item: item || null } })); } catch (e) {}
        // day-30 milestone also resets the freeze re-earn cadence per spec table ("streak freeze re-earn reset")
        if (d === 30) { streak.freezeEarnedAtCount = streak.count; }
        if (d >= 100) maybeGrantPrestige();   // build118 p2: prestige tag needs BOTH L20 + 100-day streak — check here too (order-independent with the XP-side check)
      }
    });
  }

  // auto-earn a streak freeze at day 7 and every +7 after, capped at 1 banked at a time (spec §1.3).
  function maybeEarnFreeze(streak) {
    if (streak.freezeBanked) return;
    if (streak.count < 7) return;
    var sinceLast = streak.count - (streak.freezeEarnedAtCount || 0);
    if (streak.count >= 7 && sinceLast >= 7) {
      streak.freezeBanked = true;
      streak.freezeEarnedAtCount = streak.count;
    }
  }

  // ---- rollover: runs once per session boot AND once per completed run (spec §1.6) ----
  var _rolling = false;
  function checkRollover() {
    // build112 review: reentrancy guard. checkRollover is now also called from the render path (paintGoalsCard/
    // renderGoalsTrack). The weekly grace-payout below calls grantXp(200), which synchronously dispatches
    // 'rr-levelup'; a listener repaints the goals card → calls checkRollover AGAIN before this call's saveGoals()
    // has landed → it re-reads the not-yet-saved disk state, re-crosses the same weekly threshold, and double-grants
    // +200 XP (and a second level-up). Serialize: a reentrant call is a no-op read; the outer call owns the write.
    if (_rolling) return loadGoals();
    _rolling = true;
    try {
    var g = loadGoals();
    var today = dayKey();
    var changed = false;
    if (g.date !== today) {
      // roll today's (yesterday-relative) counts into the week buckets before zeroing
      g.weekLevels = (g.weekLevels || 0) + (g.levels || 0);
      g.weekMp = (g.weekMp || 0) + (g.mp || 0);
      g.levels = 0; g.mp = 0; g.claimedDaily = false;
      g.date = today;
      changed = true;
    }
    var curWeek = isoWeekKey();
    if (g.weekKey !== curWeek) {
      // grace payout: if the weekly goal had already been crossed before rollover but never claimed, grant it now
      // so an earned-but-unclaimed reward is never silently lost (spec §1.6 step 2).
      if (!g.claimedWeekly && (g.weekLevels || 0) >= WEEKLY_LEVELS && (g.weekMp || 0) >= WEEKLY_MP) {
        grantXp(200, 'Weekly Goal');
        g.claimedWeekly = true;
      }
      g.weekKey = curWeek;
      g.weekLevels = 0; g.weekMp = 0; g.claimedWeekly = false;
      changed = true;
    }
    if (changed) saveGoals(g);
    return g;
    } finally { _rolling = false; }
  }

  // ---- streak update: only called when today's Daily Goal is FIRST claimed today (spec §1.6 step 3) ----
  function updateStreakOnDailyClaim() {
    var s = loadStreak();
    var today = dayKey();
    var yesterday = prevDayKey(today);
    if (s.lastCompleteDate === today) return s;   // already counted today (defensive; caller guards too)
    if (s.lastCompleteDate === yesterday) {
      s.count = (s.count || 0) + 1;
    } else if (!s.lastCompleteDate) {
      s.count = 1;   // brand-new streak
    } else {
      // a day (or more) was missed
      if (s.freezeBanked) {
        // freeze auto-consumed silently — flame fully preserved, then this day's play still increments it
        s.freezeBanked = false;
        s.count = (s.count || 0) + 1;
        // build122 p3 — COME BACK TOMORROW (delighter #3): persist a "just used" marker (survives past this
        // live event — a reload, or simply not having the toast register in the moment) so the hub can show
        // a dedicated one-time STREAK SAVED reveal on the player's NEXT return. Cleared by the UI right after
        // it shows (see index.html maybeShowStreakSaved / RhythmGoals.consumeFreezeJustUsed below).
        s.freezeJustUsed = true;
        try { document.dispatchEvent(new CustomEvent('rr-streak-freeze-used', { detail: { count: s.count } })); } catch (e) {}
      } else {
        s.count = 1;   // reset to 1, not 0 — today's play still counts (spec §1.3)
      }
    }
    s.lastCompleteDate = today;
    maybeEarnFreeze(s);
    fireStreakMilestones(s);
    saveStreak(s);
    return s;
  }

  // grant the streak-day XP bonus (+5 × current streak count, capped at +50 — spec §1.4 table)
  function streakDayBonusXp(streak) {
    var amt = Math.min(50, 5 * (streak.count || 0));
    if (amt > 0) grantXp(amt, 'Streak Day ' + streak.count);
  }

  function claimDailyIfEligible() {
    var g = loadGoals();
    if (g.claimedDaily) return g;
    if ((g.levels || 0) >= DAILY_LEVELS && (g.mp || 0) >= DAILY_MP) {
      g.claimedDaily = true;
      saveGoals(g);
      grantXp(50, 'Daily Goal');
      var s = updateStreakOnDailyClaim();
      streakDayBonusXp(s);
      try { document.dispatchEvent(new CustomEvent('rr-daily-goal-complete', { detail: { streak: s.count } })); } catch (e) {}
    }
    return g;
  }

  function claimWeeklyIfEligible() {
    var g = loadGoals();
    if (g.claimedWeekly) return g;
    // build110 review: weekLevels/weekMp only receive a day's total at the NEXT day's rollover, so TODAY's
    // live g.levels/g.mp must be added in — else a player who hits 15/10 in a single session gets no +200 XP
    // that day (it'd wait until tomorrow's first play, or the week-rollover grace payout). Once claimed here,
    // claimedWeekly gates any re-claim when tomorrow's rollover folds g.levels into weekLevels (sum stays consistent).
    if (((g.weekLevels || 0) + (g.levels || 0)) >= WEEKLY_LEVELS && ((g.weekMp || 0) + (g.mp || 0)) >= WEEKLY_MP) {
      g.claimedWeekly = true;
      saveGoals(g);
      grantXp(200, 'Weekly Goal');
      try { document.dispatchEvent(new CustomEvent('rr-weekly-goal-complete', { detail: {} })); } catch (e) {}
    }
    return g;
  }

  // ---- public API: record a completed LEVEL (recordLocal hook, catalog.js) ----
  // results: { grade, isNewBest, isGradeUp, isFirstClear, fullCombo, songId } — grade/isGradeUp are
  // already computed by recordLocal right where the hook is called (spec Phase 1); isFirstClear is
  // `prevReal === null` at that same call site (spec §1.4: "First-ever clear of this song").
  function recordLevelComplete(results) {
    results = results || {};
    checkRollover();
    var g = loadGoals();
    g.levels = (g.levels || 0) + 1;
    saveGoals(g);

    // XP award (spec §1.4 table) — never zero on a completed action.
    var grade = results.grade;
    var xpTotal = (grade === 'S') ? 25 : 15;
    if (results.fullCombo) xpTotal += 10;
    if (results.isFirstClear) xpTotal += 15;
    if (results.isGradeUp) xpTotal += 10;
    grantXp(xpTotal, 'Cleared ' + (results.songId || 'a level'));

    // re-check goal eligibility after incrementing (may claim right now)
    claimDailyIfEligible();
    claimWeeklyIfEligible();

    return { xpEarned: xpTotal, xpState: loadXp(), goalsState: loadGoals(), streakState: loadStreak() };
  }

  // ---- public API: record a completed MP MATCH (recordMpResult hook, multiplayer.js) ----
  // result: 'win' | 'loss' | 'draw'; info: whatever multiplayer.js passes (not required here).
  function recordMpComplete(result, info) {
    checkRollover();
    var g = loadGoals();
    g.mp = (g.mp || 0) + 1;
    saveGoals(g);

    var xpTotal = 20 + (result === 'win' ? 10 : 0);   // spec §1.4: 20 base, +10 (30 total) on win
    grantXp(xpTotal, result === 'win' ? 'MP Win' : (result === 'draw' ? 'MP Draw' : 'MP Match'));

    claimDailyIfEligible();
    claimWeeklyIfEligible();

    return { xpEarned: xpTotal, xpState: loadXp(), goalsState: loadGoals(), streakState: loadStreak() };
  }

  // ---- public state getters ----
  function state() { return { goals: loadGoals(), streak: loadStreak(), xp: loadXp() }; }
  function xpState() { return loadXp(); }
  function streakState() { return loadStreak(); }
  function goalsState() { return loadGoals(); }

  function claimDaily() { return claimDailyIfEligible(); }
  function claimWeekly() { return claimWeeklyIfEligible(); }

  // build122 p3 — COME BACK TOMORROW: read + one-time-consume the "a freeze was just used" marker.
  // consumeFreezeJustUsed() returns true exactly once per freeze-consumption event (the UI calls it on
  // hub-return; if it returns true, show the STREAK SAVED reveal, then it's cleared so it won't show again
  // on a later visit/reload). Read-only peek (freezeJustUsedPending) is exposed too in case a caller wants
  // to check without consuming.
  function freezeJustUsedPending() { return !!loadStreak().freezeJustUsed; }
  function consumeFreezeJustUsed() {
    var s = loadStreak();
    if (!s.freezeJustUsed) return false;
    s.freezeJustUsed = false;
    saveStreak(s);
    return true;
  }

  // XP-to-next-level helper for UI (profile bar, hero card)
  function xpProgress() {
    var x = loadXp();
    var lvl = x.level || 1;
    var floor = xpForLevel(lvl), next = xpForLevel(lvl + 1);
    return { level: lvl, xp: x.xp || 0, floor: floor, next: next, span: Math.max(1, next - floor), into: Math.max(0, (x.xp || 0) - floor) };
  }

  window.RhythmGoals = {
    state: state,
    xpState: xpState,
    streakState: streakState,
    goalsState: goalsState,
    checkRollover: checkRollover,
    recordLevelComplete: recordLevelComplete,
    recordMpComplete: recordMpComplete,
    claimDaily: claimDaily,
    claimWeekly: claimWeekly,
    freezeJustUsedPending: freezeJustUsedPending,   // build122 p3
    consumeFreezeJustUsed: consumeFreezeJustUsed,   // build122 p3
    xpProgress: xpProgress,
    xpForLevel: xpForLevel,
    levelForXp: levelForXp,
    DAILY_LEVELS: DAILY_LEVELS, DAILY_MP: DAILY_MP,
    WEEKLY_LEVELS: WEEKLY_LEVELS, WEEKLY_MP: WEEKLY_MP,
    XP_UNLOCKS: XP_UNLOCKS, STREAK_UNLOCKS: STREAK_UNLOCKS,
    PRESTIGE_ITEM: PRESTIGE_ITEM   // build118 p2: 'title:rift_legend' — L20 + 100-day streak (both required)
  };

  // run once at boot (rollover only — never claims/grants on load)
  try { checkRollover(); } catch (e) {}
})();

// ===========================================================================
// build125 — WEEKLY RIFT LADDER (delighter: the Sunday-night ritual).
// A SEPARATE, self-contained module (own IIFE, own single localStorage key
// 'rr_weekly_rift') so it can be lifted out cleanly without touching the
// retention ledger above. It owns NOTHING in rr_goals/rr_streak/rr_xp and never
// mutates scoring/chart/hit-detection. Exposes window.RhythmWeeklyRift.
//
// What it does: one deterministically-picked track per ISO-week (the same for
// everyone, rotating each Monday), a LOCAL best-of-week that rolls over when the
// week key changes (rollover-guarded exactly like goals.js checkRollover so it
// can't double-reset or leak across weeks), and the plumbing the hub + results
// screen read to render the card / detect a new weekly best.
//
// Cross-player ranking is intentionally LOCAL-ONLY for now (personal best). A true
// shared weekly board is a later backend add (GET /leaderboard/:id?period=weekly);
// see submitBestToLeaderboard() below for the optional signed-in submit seam.
// ===========================================================================
(function () {
  'use strict';

  var KEY_WEEKLY = 'rr_weekly_rift';

  // ISO week key — LOCAL time, byte-identical to goals.js isoWeekKey() above (same
  // deliberate local-boundary reasoning: the player's own Monday, not UTC). Duplicated
  // (not imported) to keep this module independently removable, matching the file's
  // existing "duplicated helpers" convention.
  function isoWeekKey() {
    var d = new Date(); var day = (d.getDay() + 6) % 7;
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 3);
    var w1 = new Date(t.getFullYear(), 0, 4);
    var wk = 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
    return t.getFullYear() + '-W' + wk;
  }

  // ms until next Monday 00:00 LOCAL (the reset boundary). Used by the hub countdown.
  // Always > 0 (if it's exactly Monday 00:00, the next reset is 7 days out).
  function msToNextReset() {
    var now = new Date();
    var day = now.getDay();                 // 0=Sun..6=Sat
    var daysUntilMon = (8 - day) % 7;        // Mon→7, Tue→6, ... Sun→1
    if (daysUntilMon === 0) daysUntilMon = 7;
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMon, 0, 0, 0, 0);
    return Math.max(0, next.getTime() - now.getTime());
  }

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY_WEEKLY) || 'null');
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;   // guard: a bare array typeof==='object' but would drop named state on next save (mirrors goals.js load())
    } catch (e) {}
    return { weekKey: isoWeekKey(), bestScore: 0, bestGrade: '', playedAt: 0 };
  }
  function save(o) { try { localStorage.setItem(KEY_WEEKLY, JSON.stringify(o)); } catch (e) {} }

  // The weekly Rift track — deterministic date-hashed pick over the decodable music
  // pool, REUSING RhythmCatalog.dailyRiftTrack but keyed on the WEEK (not the day) so
  // every player gets the same song all week and it rotates each Monday. Returns null
  // until the catalog has music loaded. The 'rift|<key>' hash formula lives in catalog.js;
  // passing a week key ('YYYY-Www') instead of a day key ('YYYY-MM-DD') gives a stable
  // weekly pick from the exact same code path.
  function weeklyTrack() {
    try {
      var RC = window.RhythmCatalog;
      if (RC && RC.dailyRiftTrack) return RC.dailyRiftTrack(isoWeekKey());
    } catch (e) {}
    return null;
  }

  // rollover guard (mirrors goals.js checkRollover's reentrancy + write-once pattern):
  // if the stored week key differs from the current week, reset the best to zero for the
  // fresh week. Idempotent — a reentrant call is a no-op read; the outer call owns the write.
  var _rolling = false;
  function checkRollover() {
    if (_rolling) return load();
    _rolling = true;
    try {
      var o = load();
      var cur = isoWeekKey();
      if (o.weekKey !== cur) {
        o = { weekKey: cur, bestScore: 0, bestGrade: '', playedAt: 0 };
        save(o);
      }
      return o;
    } finally { _rolling = false; }
  }

  // Current week's state (rollover-checked). { weekKey, bestScore, bestGrade, playedAt, played:bool }.
  function state() {
    var o = checkRollover();
    return {
      weekKey: o.weekKey,
      bestScore: o.bestScore || 0,
      bestGrade: o.bestGrade || '',
      playedAt: o.playedAt || 0,
      played: !!(o.playedAt && (o.bestScore || 0) > 0),
      msToReset: msToNextReset()
    };
  }

  // GRADE ordering so a higher grade at an (equal-or-)higher score is recorded. We record a
  // new best strictly on a higher SCORE (the ladder metric); bestGrade tracks that best run's grade.
  var GRADE_ORDER = { D: 0, C: 1, B: 2, A: 3, S: 4 };

  // Record a completed Weekly-Rift run's score. Call ONLY when the run was on this week's
  // Rift track and did NOT fail. Returns { isNewBest, bestScore, bestGrade } so the caller
  // can fire a "NEW WEEKLY BEST" flourish. Never throws into the run/scoring path.
  function recordRun(score, grade) {
    score = Math.round(+score || 0);
    grade = String(grade || '').toUpperCase();
    var o = checkRollover();
    var prev = o.bestScore || 0;
    var isNewBest = score > prev;
    if (isNewBest) {
      o.bestScore = score;
      o.bestGrade = grade || o.bestGrade || '';
      o.playedAt = Date.now();
      save(o);
      // optional signed-in submit to a future shared weekly board (no-op today; see seam)
      try { submitBestToLeaderboard(score, grade); } catch (e) {}
    } else if (!o.playedAt) {
      // record that they've played this week even if it wasn't a best, so "not played yet"
      // flips to a real (lower) best/played state. Only stamps playedAt; never lowers bestScore.
      o.playedAt = Date.now();
      if (!o.bestScore) { o.bestScore = score; o.bestGrade = grade; }
      save(o);
    }
    return { isNewBest: isNewBest, bestScore: o.bestScore || 0, bestGrade: o.bestGrade || '' };
  }

  // ---- OPTIONAL backend seam (does NOT block anything) ----
  // When a real cross-player weekly board exists, submit the player's weekly-Rift best here.
  // Today this is a best-effort no-op: it only fires if a clean, already-present signed-in
  // submit path exists on RhythmCatalog, and it swallows every failure. There is NO shared
  // weekly rank surfaced anywhere until this lands — the hub/results only ever show a LOCAL
  // "personal best", never a fabricated cross-player rank.
  function submitBestToLeaderboard(score, grade) {
    try {
      var RC = window.RhythmCatalog;
      if (!RC || typeof RC.submitWeeklyRift !== 'function') return;   // seam absent → nothing to do (the norm today)
      var t = weeklyTrack();
      RC.submitWeeklyRift({ trackId: t && t.id, weekKey: isoWeekKey(), score: score, grade: grade });
    } catch (e) {}
  }

  window.RhythmWeeklyRift = {
    isoWeekKey: isoWeekKey,
    msToNextReset: msToNextReset,
    weeklyTrack: weeklyTrack,
    checkRollover: checkRollover,
    state: state,
    recordRun: recordRun
  };

  // run once at boot (rollover only — never records/awards on load)
  try { checkRollover(); } catch (e) {}
})();
