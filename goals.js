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
    return { count: 0, lastCompleteDate: null, freezeBanked: false, freezeEarnedAtCount: 0, milestonesSeen: [] };
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

  // XP-level milestone -> unlock map (spec §1.5)
  var XP_UNLOCKS = {
    3: 'namecolor:bronze',
    5: 'noteskin:embertrail',
    8: 'flair:badgeframe_anim',
    12: 'namecolor:rare_crimson',
    15: 'noteskin:exclusive_15',
    20: 'flair:animated_badge'
  };
  // streak-day milestone -> unlock map (spec §1.5)
  var STREAK_UNLOCKS = {
    7: 'namecolor:ember',
    14: 'notecolor:embertrail_perm',
    30: 'flair:accent_decal',
    60: 'namecolor:whitehot',
    100: 'flair:undying_ring'
  };

  function unlockForXpLevel(level) {
    var item = XP_UNLOCKS[level];
    if (!item) return;
    var granted = grantCosmetic(item);
    if (granted) {
      try { document.dispatchEvent(new CustomEvent('rr-cosmetic-unlock', { detail: { item: item, source: 'xp', level: level } })); } catch (e) {}
    }
  }

  // streak milestone days that grant a cosmetic (subset of STREAK_UNLOCKS) plus 3 which is
  // toast-only per spec table (no unlock listed at day 3, but it IS a milestone-seen entry).
  var STREAK_MILESTONE_DAYS = [3, 7, 14, 30, 60, 100];

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
    xpProgress: xpProgress,
    xpForLevel: xpForLevel,
    levelForXp: levelForXp,
    DAILY_LEVELS: DAILY_LEVELS, DAILY_MP: DAILY_MP,
    WEEKLY_LEVELS: WEEKLY_LEVELS, WEEKLY_MP: WEEKLY_MP,
    XP_UNLOCKS: XP_UNLOCKS, STREAK_UNLOCKS: STREAK_UNLOCKS
  };

  // run once at boot (rollover only — never claims/grants on load)
  try { checkRollover(); } catch (e) {}
})();
