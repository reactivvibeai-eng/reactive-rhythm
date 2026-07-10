// ===========================================================================
// RHYTHM RIFT — Game Engine (catalog-ready)
// - Difficulty = index-modulo filter (matches server: {easy:4,medium:2,hard:1})
// - Scoring ceiling = notes_total * 1500 (PERFECT = 1500 flat, no multiplier)
// - Audio via a Player abstraction: DemoPlayer (WebAudio buffer) or HlsPlayer.
// - Engine is driven by "session providers" supplied by catalog.js (live) or
//   the built-in demo provider (local mp3 + in-browser analyzer).
// ===========================================================================

(() => {
  // -------- CONFIG ----------
  let LANE_COUNT = 6;   // mutable — the active lane profile ('standard'=6, 'gh'=5) sets this
  const DEFAULT_KEY_MAP = { a: 0, s: 1, d: 2, j: 3, k: 4, l: 5 };
  // keyMap is { key -> lane }, user-remappable + persisted. Defaults match the
  // original A S D · J K L layout so existing muscle memory is unchanged.
  let keyMap = Object.assign({}, DEFAULT_KEY_MAP);
  let keyMapStore = 'rr_keymap';   // active lane profile's keymap storage key (set by applyLaneProfile)
  try { const sv = JSON.parse(localStorage.getItem('rr_keymap') || 'null'); if (sv && typeof sv === 'object') keyMap = sv; } catch (e) {}
  function saveKeyMap() { try { localStorage.setItem(keyMapStore, JSON.stringify(keyMap)); } catch (e) {} }
  // gamepad button -> lane map (remappable in Settings, persisted per lane profile). Default = identity
  // (button 0..N-1 -> lane 0..N-1) so existing controller behaviour is unchanged until a user remaps.
  let padMap = {};
  let padStore = 'rr_padmap';
  function identityPad(n) { const m = {}; for (let i = 0; i < n; i++) m[i] = i; return m; }
  function loadPadMapFor(store, n) {
    try { const sv = JSON.parse(localStorage.getItem(store) || 'null'); if (sv && typeof sv === 'object' && Object.keys(sv).length) return sv; } catch (e) {}
    return identityPad(n);
  }
  function savePadMap() { try { localStorage.setItem(padStore, JSON.stringify(padMap)); } catch (e) {} }
  function padForLane(lane) { for (const k in padMap) if (padMap[k] === lane) return +k; return null; }
  padMap = loadPadMapFor('rr_padmap', 6);
  // ---- GH guitar: strum / whammy / tilt calibration (sibling of the pad map) ----------------
  // DEFAULTS are best-effort PLACEHOLDERS — GH/RB/Clone-Hero button+axis numbering is NOT
  // standardized (varies by model/console/OS/browser/adapter; Clone Hero itself ships no fixed
  // indices and tells users to calibrate). So these seed values are a convenience layer; the
  // calibration wizard / live tester is the load-bearing path that overwrites them. See CHANGELOG.
  const STRUMCFG_KEY = 'rr_strumcfg';
  let STRUM_DEBOUNCE_MS = 35;          // anti-double-strum (strum-up + strum-down funnel through here). build102w: 55→35 — real GH supports rapid up/down alternation and 55ms ate the second stroke; `let` so __rrStrumFeel can dial it live (owner hardware pass)
  let strumCfg = { btns: [12, 13], strumAxis: null, strumAxisDir: 0, strumRest: 0,
                   whammyAxis: 2, whammyMin: -1, whammyMax: 1,
                   tiltAxis: 3, tiltThresh: 0.6, spBtn: 8,
                   odBtn: 5 };   // build100q: STANDARD-pad Overdrive/Star-Power button (default RB=5, a free button) — guitars still use spBtn under requireStrum. The wizard's OD step overrides this.
  let _frets = new Set();              // fret LANES currently held (GH require-strum mode)
  let _strumAxisPrev = 0, _lastStrumT = 0, _whammyPrev = 0, _tiltPrev = 0;
  function loadStrumCfg() { try { const sv = JSON.parse(localStorage.getItem(STRUMCFG_KEY) || 'null'); if (sv && typeof sv === 'object') strumCfg = Object.assign(strumCfg, sv); } catch (e) {} }
  function saveStrumCfg() { try { localStorage.setItem(STRUMCFG_KEY, JSON.stringify(strumCfg)); } catch (e) {} }
  loadStrumCfg();
  function keyForLane(lane) { for (const k in keyMap) if (keyMap[k] === lane) return k; return null; }
  const LANE_COLORS = [
    { c: '#ff3c3c', rgb: '255, 60, 60'   },
    { c: '#ece7e3', rgb: '236, 231, 227' },
    { c: '#ff3c3c', rgb: '255, 60, 60'   },
    { c: '#ece7e3', rgb: '236, 231, 227' },
    { c: '#ff3c3c', rgb: '255, 60, 60'   },
    { c: '#ece7e3', rgb: '236, 231, 227' },
  ];

  // server-matched difficulty filter step
  const DIFF_STEP = { easy: 4, medium: 2, hard: 1, rift: 1 };   // build148 T8: RIFT (Expert) shares Hard's finest beat-filter step; its brutality comes from buildNotes NOT softening (see _rift below)
  const DIFFICULTY = {
    easy:   { approach: 1.30, hitWindow: 0.20, name: 'DRIFT — Easy'      },
    medium: { approach: 0.95, hitWindow: 0.16, name: 'PULSE — Medium'    },
    hard:   { approach: 0.68, hitWindow: 0.12, name: 'FRACTURE — Hard'   },
    // build148 T8 (Fable RIFT tier): Expert = the pre-build141 brutal Hard, opt-in, unlocked by clearing FRACTURE ≥85%.
    // Faster approach (0.62) + tighter window (0.11) than Hard; buildNotes restores every pre-softening constant for it.
    rift:   { approach: 0.62, hitWindow: 0.11, name: 'RIFT — Expert'     },
  };
  // ---- TIMING FEEL (flag-gated, default-OFF → judging byte-identical to v73) ----
  // 'classic' = today's wide, forgiving windows (the feel the user likes).
  // 'tight'   = GH/Clone-Hero precision (tighter perfect/great split + richer 1→5× combo).
  // Enable via ?tune=1 or Settings → Timing Feel. classic numbers reduce EXACTLY to the originals.
  let timingFeel = 'classic';
  try {
    if (/[?&]tune=1/.test(location.search)) timingFeel = 'tight';
    else { const tf = localStorage.getItem('rr_timing'); if (tf === 'tight' || tf === 'classic') timingFeel = tf; }
  } catch (e) {}
  const TIMING_PROFILES = {
    classic: { winScale: 1.00, perfFrac: 0.30, greatFrac: 0.60, comboStep: 12, comboCap: 3 },
    tight:   { winScale: 1.00, perfFrac: 0.22, greatFrac: 0.47, comboStep: 10, comboCap: 5 },
  };
  function timingProf() { return TIMING_PROFILES[timingFeel] || TIMING_PROFILES.classic; }

  // ---- FIRST PULSE (Wave-4 onboarding bridge) --------------------------------------------------------------
  // A "bridge run" lets a graduating Easy player rehearse MEDIUM's density + speed at EASY's forgiving 0.20 hit
  // window — UNRANKED (endGame stamps results.preview=true → recordLocal AND every submit path early-return). The
  // run's chart is a REAL Medium chart (difficulty === 'medium' at build time), so only the RUN-TIME judging window
  // is eased. effHitWindow() is that single seam: it returns Easy's window ONLY while _bridgeRun is armed; otherwise
  // it returns diff.hitWindow verbatim → a normal Easy/Medium run judges byte-identically. Chart-BUILD clearances
  // keep reading DIFFICULTY[difficulty].hitWindow directly, so the Medium chart layout is untouched by the bridge.
  function effHitWindow(diff) { return _bridgeRun ? DIFFICULTY.easy.hitWindow : (diff && diff.hitWindow); }

  // Scoring: base per-hit is LOW; the combo multiplier + Overdrive scale it up, HARD-CAPPED at MAX_MULT (=4) total
  // (v258: clamped at all 3 mult sites — the 'tight' profile's comboCap:5 + overdrive could otherwise reach 6×).
  // ---- SCORE CEILING (build104 / CHART_VERSION 2 scoring epoch — any server enforcement must budget ALL of these;
  // every term is chart-fixed, identical for all players on the same chart → leaderboard-safe):
  //   base:       notes_total × 375 × 4 (=1500/note; chord partners are notes in notes_total)
  //   holds:      + Σ over holds of holdTotalFor(hold) × 4, where holdTotalFor = 140 + 110·min(1, tail/1.2)
  //               (i.e. 560..1000 per hold ON TOP of its head — duration-scaled, no longer flat 220×4)
  //   accents:    + accents × 0.5 × 375 × 4 (=750/accent; PERFECT-judged accents pay 1.5× base — s8)
  //   full chord: + Σ over chords of 0.3 × (chord_lanes × 375 × 4) (all-lanes-down bonus, 1.3× the chord — s7)
  // The old flat "notes_total*1500 + holds*880" formula is CHART_VERSION 1 era — do not enforce it against v2 scores.
  // build104 s11 (close the batch): the ACTUAL stamped chart epoch. buildNotes (grid-refine + snap + sanitizer + hold
  // overhaul + chord/accent/star + pattern vocab) AND the scoring above all moved this run — a v2 score is not
  // comparable to a v1 score. Every leaderboard submission carries this (catalog /score body) so the backend can
  // segment eras; bump ONLY when a change again alters achievable score for a fixed (track,difficulty).
  const CHART_VERSION = 2;
  try { window.RhythmGame = window.RhythmGame || {}; window.RhythmGame.CHART_VERSION = CHART_VERSION; } catch (e) {}
  const JUDGE = {
    perfect: { name: 'PERFECT', color: '#dad7d2', score: 375, accW: 1.00 },
    great:   { name: 'GREAT',   color: '#e0a93f', score: 250, accW: 0.85 },
    good:    { name: 'GOOD',    color: '#ff6b78', score: 125, accW: 0.50 },
    miss:    { name: 'MISS',    color: '#ff1f2e', score: 0,   accW: 0.00 },
  };
  const MAX_MULT = 4;

  // ---------- STATE ----------
  let difficulty = 'medium';
  let _firstRunEasy = false;   // build83: set when a brand-new player (no saved diff + no history) is auto-started on Easy
  // FIRST PULSE bridge run (Wave-4 onboarding): the CURRENT run is a MEDIUM-chart rehearsal judged at EASY's window,
  // UNRANKED. Armed by play(opts.bridgeRun); cleared on every run end/abort → normal runs stay byte-identical.
  let _bridgeRun = false;
  let _bridgePrevDiff = null;  // the tier to restore if a bridge run is abandoned without clearing (typically 'easy')
  let _timingSamples = [];     // build83: per-hit signed timing error (sec) for the results early/late summary
  let provider = null;       // async () => session
  let session = null;        // { beats, duration, player, meta, live, submit }
  let player = null;         // current Player instance
  let beats = [];            // raw chart [{t, strength}]
  let notes = [];            // derived [{time, lane, strength, judged, hit}]
  let _missCursor = 0;       // build60 PERF: monotonic miss-sweep cursor — notes[<cursor] are all definitively judged.
                              // Only advances (never rewinds) past leading judged notes; the miss loop starts here + breaks
                              // at the first note whose miss window is still future. Reset to 0 at every run start (resetScoring).
  let _injectedNotes = null; // build114: AUTHORITATIVE MP CHART — when set, beginPlay() skips buildNotes() and
                              // uses this array verbatim (rehydrated full note objects, not the stripped spectator
                              // shape). ALWAYS consumed + cleared by beginPlay() so it can never leak into the next
                              // run (solo, MP, or otherwise) — see startAt()/beginPlay() below.
  let _lastInjectedNotes = null; // build114 review: NON-consumed cache of the last-launched injected chart, so a
                              // RESTART/REPLAY during a live MP match can re-arm the SAME authoritative chart instead
                              // of bare beginPlay() re-running a fresh local buildNotes() (which re-introduces the
                              // cross-device drift gap). Reset every launch (to the launch's notes, or null for solo).
  let songDuration = 0;
  let rafId = null;
  let state = 'menu';
  let muted = false;

  // ---- PRACTICE MODE (additive; default OFF → single-player / MP / campaign paths byte-identical) ----
  // A practice run drills a SECTION at a chosen SPEED and NEVER touches the leaderboard, per-song best,
  // career aggregate, Daily-Rift ×3, or XP/streak (all gated on `isPractice` — see endGame + catalog.recordLocal).
  let _practiceOn = false;        // is the CURRENT run a practice run
  let _practiceSection = null;    // { start, end } in song-buffer seconds (clamped to the song), or null = full song
  let _practiceRate = 1;          // playback speed multiplier applied to BOTH note approach and audio (0.5..1.5)
  let _practicePreroll = 0;       // build141: seconds of musical count-in seeked BEFORE a section's start so the first section note approaches from the TOP of the highway (else it spawns already at the strike line — unplayable). Computed once per launch in beginPlay's lead-in pass; reused verbatim by every re-arm.
  let _practiceArming = false;    // re-arm guard so the section-loop / wipeout auto-retry can't stack beginPlay()s
  function _practiceSpeedMul() { return _practiceOn ? (_practiceRate || 1) : 1; }   // note-approach divisor factor (mirrors _levelSpeedMul)
  // build141: the effective top-of-highway travel time (seconds) for the CURRENT run — the exact `approach` the
  // render loop uses. A note at song-time T first appears at the top of the highway at real-time (T − approach);
  // used to guarantee the FIRST note has a full runway instead of spawning already at the strike line.
  function _runApproach() { return DIFFICULTY[difficulty].approach / (userScroll * _levelSpeedMul() * _practiceSpeedMul()); }
  function _fmtT(s) { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  // PRACTICE HUD tag: an unmistakable "this run isn't scored" badge + the active section/speed. Toggled on the
  // #practice-tag element (built in index.html); pure DOM, no per-frame cost (called once per (re)arm from beginPlay).
  function _updatePracticeHud() {
    try {
      const el = document.getElementById('practice-tag'); if (!el) return;
      if (_practiceOn) {
        const sec = _practiceSection;
        const secTxt = sec ? (_fmtT(sec.start) + '–' + _fmtT(sec.end)) : 'FULL SONG';
        const spd = (_practiceRate === 1) ? '1×' : ((+_practiceRate).toString().replace(/\.0+$/, '') + '×');
        const rd = document.getElementById('practice-tag-read');
        if (rd) rd.textContent = secTxt + ' · ' + spd;
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    } catch (e) {}
  }

  // visuals
  let lanePulse = Array(LANE_COUNT).fill(0);
  let laneHitPulse = Array(LANE_COUNT).fill(0);
  let lanePluckT = Array(LANE_COUNT).fill(9);   // seconds since last pluck (large = idle)
  // sustain (hold) state — a struck hold note keeps paying out while its lane stays pressed
  let laneDown = Array(LANE_COUNT).fill(false); // is this lane physically held right now
  let _mpStunUntil = 0, _stunHideT = 0;          // v254: MP-combat input stun (a rival's combo shock) — deadline + overlay-hide timer
  let holdNote = Array(LANE_COUNT).fill(null);  // the sustain note currently being held in this lane
  let holdScored = Array(LANE_COUNT).fill(0);   // fraction [0..1] of the active sustain already paid out
  let holdSparkT = Array(LANE_COUNT).fill(0);   // spark-emit throttle while sustaining
  let holdRailSeg = Array(LANE_COUNT).fill(0);  // SLIDE RAILS: index of the NEXT waypoint the active rail in this lane is heading to (0 = none/hold)
  // ---- TASK4: ?playtest=1 MASTER SWITCH for the DARK mechanics -------------------------------------------------------
  // ONE in-memory switch so the owner can feel every dark gameplay flag (slide rails / STARSTRUCK star-phrases / open
  // notes) in a single sitting, while real users keep the safe defaults. It is an ADDITIONAL OR-term on each flag's
  // existing gate — every individual gate (?rails=1 / rr_rails, ?odphrase=1 / rr_odphrase, ?open=1 / rr_open) keeps
  // working exactly as today. It NEVER writes localStorage: this page load only, zero persistence, no leak into a later
  // normal session. With ?playtest=1 ABSENT, `PLAYTEST_ALL` is false → `x || false === x` at every site → byte-identical.
  // Because open-notes + slide-rails MODIFY the note array (STARSTRUCK only adds props → array-identical), a playtest
  // run rides the EXISTING preview/practice scoring gate (endGame stamps results.preview) → UNRANKED. See SCORING_RULINGS_v2.
  const PLAYTEST_ALL = (function () { try { return /[?&]playtest=1\b/.test(location.search); } catch (e) { return false; } })();
  if (PLAYTEST_ALL) {   // dev-only chrome: an unmistakable corner chip. Guarded so it can NEVER appear without the flag.
    try {
      var _mkPlaytestChip = function () {
        if (document.getElementById('rr-playtest-chip')) return;
        var c = document.createElement('div');
        c.id = 'rr-playtest-chip';
        c.textContent = 'PLAYTEST BUILD — dark flags ON · UNRANKED';
        c.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;pointer-events:none;'
          + "font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;"
          + 'color:#ffe08a;background:rgba(28,10,10,0.88);border:1px solid rgba(255,31,46,0.7);'
          + 'border-radius:6px;padding:4px 9px;box-shadow:0 0 10px rgba(255,31,46,0.35);';
        (document.body || document.documentElement).appendChild(c);
      };
      if (document.body) _mkPlaytestChip(); else document.addEventListener('DOMContentLoaded', _mkPlaytestChip, { once: true });
    } catch (e) {}
  }
  // ---- SLIDE RAILS (Fable v2 flagship, MECHANICS_DIRECTION_v2 §A) — DARK behind RAILS_ON. Default OFF → the
  // charter emits EXACTLY today's chart (the EMISSION is gated, not the render). A rail is a hold whose lane MOVES:
  // strike the head like a hold, then FOLLOW the ribbon as it bends to the next string. SCORE-IDENTICAL to the hold
  // it replaces — transfers award ZERO score (no new score sites; the notes_total*1500 ceiling never learns rails
  // exist). Transfer failure resolves through the EXISTING endHoldEarly GRACE/SLIP/DROP bands (one mercy model).
  function RAILS_ON() { if (PLAYTEST_ALL) return true; try { if (/[?&]rails=1/.test(location.search)) return true; } catch (e) {} try { return localStorage.getItem('rr_rails') === '1'; } catch (e) {} return false; }
  // ---- A2 STARSTRUCK star-phrases (Wave-4b) — DARK behind STARPHRASE_ON. Default OFF → the chart post-pass never
  // runs, no note carries a phraseId, and the runtime hooks (guarded on phraseId != null) are byte-identical no-ops.
  // When ON it's PURE LEGIBILITY: clearing a whole star-phrase fires a STARSTRUCK callout + gold burst. It NEVER adds
  // score, Overdrive charge, or multiplier — OD charge stays EXACTLY per-note (the star charge line is untouched). The
  // notes_total*1500 ceiling never learns phrases exist. The ceremony IS the reward.
  function STARPHRASE_ON() { if (PLAYTEST_ALL) return true; try { if (/[?&]odphrase=1/.test(location.search)) return true; } catch (e) {} try { return localStorage.getItem('rr_odphrase') === '1'; } catch (e) {} return false; }
  // ---- CHART-SHAPE GUARD-RAIL (Fable, SCORING_RULINGS_v2) — is THIS run being played on a chart whose note ARRAY was
  // altered by a dark mechanic? open-notes (hittable from ANY lane → strictly easier; also bakes `.hopo` auto-chain
  // tags) and slide-rails (holds re-typed to 'rail') both change the array. STARSTRUCK does NOT (it only adds
  // phraseId/phraseLen — array-identical, proven by phraseV2Proof), so those runs stay ranked.
  //
  // ASK THE CHART, NOT THE FLAG. An earlier version of this read the live `openNotes` / RAILS_ON() at endGame and was
  // BYPASSABLE: buildNotes bakes the mechanic into per-note properties once (n.open at 2109, n.hopo at 2127), and hit
  // detection keys on those baked properties — NOT on the flag. So loading `?open=1`, then calling the ungated,
  // production-reachable `__rrOpenNotes(false)` mid-run, flipped the flag false while the easy chart stayed baked, and
  // the inflated score posted to the real leaderboard. The mirror bug voided a legitimately clean run. Reading the
  // finalized `notes` array is ground truth: it is immune to flag toggles, and it also covers the MULTIPLAYER path,
  // where `notes` is the host's injected chart (the broadcast serializer at 2763 carries `open`/`hopo`), so a guest
  // inherits the host's modified-chart verdict instead of consulting its own local flags.
  // O(n) once at endGame, short-circuiting. All flags default OFF → no note carries these props → false on every
  // normal load, so the ranked path is byte-identical. Fallback to the flags only if `notes` is somehow unreadable.
  function _chartShapeModified() {
    try { return Array.isArray(notes) && notes.some(function (n) { return n && (n.open === true || n.hopo === true || n.type === 'rail'); }); }
    catch (e) { return !!openNotes || !!RAILS_ON(); }
  }
  // A2 STARSTRUCK grouping — Fable's ANCHORED rule (SCORING_RULINGS_v2). A STARSTRUCK phrase is the APPROACH RUN that
  // ENDS at an existing star: from each star, walk BACKWARD collecting eligible preceding notes within PHRASE_WIN, up
  // to PHRASE_CAP-1 of them, with the star itself the LAST member (so the existing _phraseCredit fires exactly on the
  // star hit). Runs of >= PHRASE_MIN members become a phrase (each member tagged phraseId + phraseLen). This moves NO
  // note — it only ADDS the two tags — so the array (count/time/lane/type) is byte-identical to flag-off and the chart
  // rides at CHART_VERSION 2 (no star is re-placed → no accent forfeits its PERFECT bonus → no ceiling term moves).
  // ELIGIBLE = plain tap/accent only (holds, rails, chords, bombs, fillers, and other stars are excluded). Stars are
  // processed LATEST-first and a member already owned by a later phrase is skipped, so phrases never overlap. Operates
  // on an ASCENDING-by-time array and READS times only — never reorders. Cosmetic tags ONLY: never touches score/OD/mult.
  const PHRASE_MIN = 3;
  const PHRASE_WIN = { easy: 6.0, medium: 5.0, hard: 4.0, rift: 4.0 };   // s — approach window before the star
  const PHRASE_CAP = { easy: 4,   medium: 6,   hard: 8,   rift: 8   };   // max members INCLUDING the star
  function _tagStarPhrases(arr, diff) {
    let pid = 0;
    try {
      const win = (PHRASE_WIN[diff] != null) ? PHRASE_WIN[diff] : PHRASE_WIN.hard;
      const cap = (PHRASE_CAP[diff] != null) ? PHRASE_CAP[diff] : PHRASE_CAP.hard;
      const eligible = (n) => n && (n.type === 'tap' || n.type === 'accent') && !n._fill && !n.chord;
      const starIdx = [];
      for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].type === 'star') starIdx.push(i);
      for (let s = starIdx.length - 1; s >= 0; s--) {   // latest star first → its approach claims shared notes
        const si = starIdx[s], star = arr[si], t = star.time;
        const members = [];                              // preceding eligible notes, nearest→furthest
        for (let k = si - 1; k >= 0 && members.length < cap - 1; k--) {
          const n = arr[k];
          if (!n) continue;
          if (t - n.time > win) break;                   // outside the approach window (ascending array) → stop
          if (n.type === 'star') break;                  // the previous star bounds this phrase — don't reach past it
          if (n.phraseId != null) continue;              // already owned by a later phrase → skip, keep looking back
          if (!eligible(n)) continue;                    // holds/rails/chords/bombs/fillers are not phrase members
          members.push(n);
        }
        const total = members.length + 1;                // + the star itself (LAST member in time)
        if (total >= PHRASE_MIN) {
          pid++;
          star.phraseId = pid; star.phraseLen = total;
          for (const m of members) { m.phraseId = pid; m.phraseLen = total; }
        }
      }
    } catch (e) {}
    return pid;
  }
  const RAIL_MIN_LEN = 1.0;                                     // s — a rail needs room to read a transfer (spec A1.2)
  const RAIL_DRIFT_MIN = 0.18;                                  // min |centroid drift| for a sustain to qualify as a slide
  const RAIL_MAX_XFER = { easy: 1, medium: 2, hard: 3, rift: 4 };          // max transfers per rail, per difficulty
  const RAIL_MIN_SEG  = { easy: 0.45, medium: 0.35, hard: 0.28, rift: 0.24 };  // min time per rail segment (incl. last→tail)
  const RAIL_TW       = { easy: 0.25, medium: 0.18, hard: 0.14, rift: 0.12 };  // transfer WINDOW late side (early side = 0.6×)
  const _railScratch = []; for (let _i = 0; _i < 16; _i++) _railScratch.push({ x: 0, y: 0, sc: 1, lane: 0 });   // ribbon point buffer (alloc-free per frame)
  let _railTouchId = null, _railTouchLanes = null;   // SLIDE RAILS: pointer that struck a rail head (touch drag) + the lanes it synthesized down
  let _railTestDrift = null, _railTestMinLen = null;   // SLIDE RAILS dev-test overrides (null = shipped RAIL_DRIFT_MIN/RAIL_MIN_LEN); strip at freeze
  // build104 s6c: duration-scaled sustain payout — the flat 220 made LONG sustains the worst points-per-second
  // in the game. A hold's total sustain pool now scales with its tail: 140 + 110·min(1, tail/1.2) = 140..250
  // (× live multiplier, like all score). Chart-fixed per note → identical for every player → leaderboard-safe.
  function holdTotalFor(hn) { return 140 + 110 * Math.min(1, ((hn && hn.hold) || 0) / 1.2); }
  let overdrive = 0;                            // 0..1 meter
  let odActive = false;                         // overdrive mode engaged (x2 payoff)
  let odTimer = 0;                              // seconds of overdrive remaining
  let odIgniteT = 0;                            // build109 s3: seconds remaining on the activation wind-up pre-charge (0=idle, counts down from ODIGNITE_MS/1000)
  const ODIGNITE_MS = 140;                      // build109 s3: anticipation beat before the OD payoff fires
  let odBurst = 0;                              // one-shot OD-ignition shockwave (1→0 over ~0.6s, render-only)
  let odReadyAnnounced = false;                // one-shot "OVERDRIVE READY" cue per fill
  let lastMult = 1;                             // last applied score multiplier (HUD)
  // ---- Wave-3 (Fable SCORING_RULINGS_v1) render/FX/stats-only state. NONE of these is ever read by any
  // `score +=`, curMult/mult, OD-charge, OD-timer, or accuracy path — they are pure DISPLAY/derived-read (verified
  // in the ruling's proof obligation). See findings 1-4. Reset with the run boundary in resetScoring().
  let odOvercharge = 0;          // finding 3: cosmetic reservoir of full-meter charge the clamp discards (0..1). NEVER re-banked into `overdrive`.
  let _odScoreAtFire = 0;        // finding 2: Math.round(score) snapshot when OD fires — the end-tally DIFFS this (derived read).
  let _odHitsAtFire = 0;         // finding 2: notes-hit snapshot at OD fire (for the "notes covered" results stat).
  let _odLastGain = 0;           // finding 2: last OD window's banked total (display).
  let _odTotalGain = 0;          // finding 2: Σ score banked across all OD windows this run (results stat).
  let _odBestGain = 0;           // finding 2: best single OD window banked (results stat).
  let _odNotesTotal = 0;         // finding 2: notes covered across OD windows (results stat).
  let _holdCleanN = 0;           // finding 4: clean hold completions this run (stat/FX only).
  let _holdAttemptM = 0;         // finding 4: hold/rail heads struck this run (stat denominator).
  let _cleanHoldStreak = 0;      // finding 4: consecutive clean holds — drives the escalating HOLD!→CLEAN!→RIDE MASTER callout.
  let _feverEl = null;           // finding 1: lazily-injected FEVER readout node inside #mult-gauge (index.html untouched).
  const OD_DURATION = 8;                        // how long an activation lasts
  // build148 T1 (Fable FLOW SHIELD): while Overdrive is LIVE a missed note keeps your combo — it burns this
  // fraction of the OD meter (≈2s of OD time) instead. Bombs are never shielded; a shielded note still scores 0
  // and still counts as a miss for accuracy, so a perfect FC (no misses) never triggers it → the notes_total*1500
  // ceiling is untouched (leaderboard-safe). PLAYTEST-GATED: tune the drain here.
  const FLOW_SHIELD_COST = 0.25;
  let _flowShieldCount = 0;                     // shields spent this run (telemetry / __rrDebug; reset in resetScoring)
  let bgPulse = 0;
  // ---- JUICE: FX intensities. The user-facing "FX Intensity" setting picks a preset; "balanced" = the defaults
  // below. The `window.__rrJuice` dev hook (strip at content-freeze) fine-tunes individual values live. ----
  const JUICE = { bloom: 0.085, bloomR: 0.95, odVig: 0.16, odVigPulse: 0.14, odFlash: 0.34, odRing: 0.62, odWarnAt: 1.6 };   // build92: odWarnAt = seconds-left at which the OD burn-down cue begins (base-only key, survives preset swaps)
  const FX_PRESETS = {
    subtle:   { bloom: 0.05,  bloomR: 0.90, odVig: 0.12, odVigPulse: 0.10, odFlash: 0.22, odRing: 0.50 },
    balanced: { bloom: 0.085, bloomR: 0.95, odVig: 0.16, odVigPulse: 0.14, odFlash: 0.34, odRing: 0.62 },
    intense:  { bloom: 0.14,  bloomR: 1.00, odVig: 0.22, odVigPulse: 0.18, odFlash: 0.50, odRing: 0.82 }
  };
  let fxIntensity = 'balanced';   // Settings -> FX Intensity (subtle | balanced | intense)
  // ---- PER-LEVEL VISUAL IDENTITY (build7) ----
  // Set by RhythmGame.setLevelAccent('r,g,b') from the level-theme code; null = Quick Play (no tint).
  // Used ONLY for ADDITIVE glow + ambient FX — LANE_COLORS / scoring / timing are untouched.
  let levelAccentRGB = null;     // e.g. '166,77,255' for violet, or null
  let levelAmbient = 0;          // 0..1 strength of the ambient FX layer (0 = off)
  // audio-reactive: an AnalyserNode tap on the music gain drives a beat pulse into bgPulse
  let musicAnalyser = null, musicFreq = null, beatLevel = 0;
  let energy = 0;            // smoothed musical intensity (0..1) from chart density
  let energyTarget = 0;
  // user settings (persisted)
  let userScroll = 1;        // note-speed multiplier (higher = faster approach)
  let fxLite = false;        // lite visual mode (perf): gates god-rays/embers
  let reduceMotion = false;  // accessibility: gate heavy ambient motion (CSS + canvas)
  let bgMode = 'cinematic';  // 'cinematic' = moon video backdrop | 'performance' = no video (higher FPS)
  let musicVol = 1;          // master music level (0..1), self-serve in Settings
  let SFX_LEVEL = 0.05;      // hit-chug accent level (0..0.5); self-serve in Settings (default barely-there)
  let failMode = false;      // Settings → Fail Mode: an empty stability meter ends the run (default off = no-fail)
  // Boss Stage: forces the meter lethal, drains it harder, ENRAGES at ~60%, and pays off win/lose.
  let bossMode = false, bossPhase = 1, bossPhaseShown = false;
  let bossFlag = false; try { bossFlag = /[?&]boss=1/.test(location.search); } catch (e) {}
  // NOTE-TYPE VARIETY (flag-gated, OFF by default → charts byte-identical until enabled): adds
  // GH-style trills (rapid alternating tap bursts) + richer/more-frequent chords & double-stops.
  // Reuses existing tap/chord scoring (no hit-detection changes). Enable: ?notes=1 or rr_notes=1.
  // build62: GH flavor (trills / stair-runs / telegraphed bomb-rows / tighter chords) is now ON BY DEFAULT —
  // it's DENSITY-NEUTRAL (re-lanes existing notes; bomb-rows are a deliberate dodge moment), so it adds the
  // "alive" Guitar-Hero texture without adding spam. Disable to A/B with ?notes=0 or rr_notes='0'.
  let noteVariety = true;
  try {
    const _nv = localStorage.getItem('rr_notes');
    if (_nv === '0') noteVariety = false; else if (_nv === '1') noteVariety = true;
    if (/[?&]notes=0/.test(location.search)) noteVariety = false; else if (/[?&]notes=1/.test(location.search)) noteVariety = true;
  } catch (e) {}
  try { window.__rrNoteVariety = function (on) { if (on === undefined) return noteVariety; noteVariety = !!on; try { localStorage.setItem('rr_notes', on ? '1' : '0'); } catch (e) {} return noteVariety; }; } catch (e) {}
  // OPEN NOTES + HOPOs (flag-gated, OFF by default → charts byte-identical until enabled). Separate from
  // noteVariety so they A/B independently. OPEN = "strum the whole neck" (any lane clears it). HOPO =
  // a fast-run note that auto-chains off a clean hit (no fresh strum). Enable: ?open=1 / rr_open / __rrOpenNotes(true).
  let openNotes = false;
  try { openNotes = PLAYTEST_ALL || /[?&]open=1/.test(location.search) || localStorage.getItem('rr_open') === '1'; } catch (e) {}   // TASK4: PLAYTEST_ALL is an extra OR-term (no persistence — never written back to rr_open)
  try { window.__rrOpenNotes = function (on) { if (on === undefined) return openNotes; openNotes = !!on; try { localStorage.setItem('rr_open', on ? '1' : '0'); } catch (e) {} return openNotes; }; } catch (e) {}
  let chartMode = 'musical'; // Settings → Chart Feel: 'musical' (build57 DEFAULT — multi-band detection + centroid/pitch-contour lanes + dynamic density) | 'classic' (every Nth bass-only onset, hashed lanes — fallback)
  let levelGuitarPref = 'mine';   // build60: Settings → "Guitar on Levels" — 'mine' (the equipped guitar wins on any level) | 'level' (use the level's own themed guitar)
  try {
    const s = JSON.parse(localStorage.getItem('rr_settings') || '{}');
    if (typeof s.scroll === 'number') userScroll = Math.max(0.5, Math.min(2, s.scroll));   // typed + clamped, matching applySettings (a corrupt rr_settings can't set an out-of-range scroll)
    if (typeof s.fxLite === 'boolean') fxLite = s.fxLite;
    if (s.bgMode === 'performance' || s.bgMode === 'cinematic') bgMode = s.bgMode;
    if (typeof s.reduceMotion === 'boolean') reduceMotion = s.reduceMotion;
    else if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) reduceMotion = true;
    if (typeof s.music === 'number') musicVol = Math.max(0, Math.min(1, s.music));
    if (typeof s.sfx === 'number') SFX_LEVEL = Math.max(0, Math.min(0.5, s.sfx));
    if (typeof s.failMode === 'boolean') failMode = s.failMode;
    if (s.chartMode === 'classic' || s.chartMode === 'musical') chartMode = s.chartMode;
    if (s.levelGuitar === 'mine' || s.levelGuitar === 'level') levelGuitarPref = s.levelGuitar;
    if (s.fxIntensity && FX_PRESETS[s.fxIntensity]) { fxIntensity = s.fxIntensity; Object.assign(JUICE, FX_PRESETS[fxIntensity]); }   // user FX-intensity preset
  } catch (e) {}
  // dev __rrJuice fine-tune (rr_juice) layers on top of the chosen preset; absent for normal users
  try { const _sj = JSON.parse(localStorage.getItem('rr_juice') || 'null'); if (_sj) for (const k in JUICE) if (typeof _sj[k] === 'number') JUICE[k] = _sj[k]; } catch (e) {}
  // ?novideo=1 forces performance mode (FPS diagnostic / quick override)
  try { if (/[?&]novideo=1/.test(location.search)) bgMode = 'performance'; } catch (e) {}
  // build66.10 migration: the build66.5 auto-quality used to auto-force bgMode='performance' (which hides ALL background videos
  // site-wide). It no longer does — un-stick anyone it already flipped: if auto-lite ran AND bgMode is performance, restore
  // cinematic once + re-save, so the video backdrops come back. Runs a single time (rr_bgfix1).
  try {
    if (!localStorage.getItem('rr_bgfix1')) {
      if (localStorage.getItem('rr_autolite') === '1' && bgMode === 'performance' && !/[?&]novideo=1/.test(location.search)) {
        bgMode = 'cinematic';
        try { var _sm = JSON.parse(localStorage.getItem('rr_settings') || '{}'); _sm.bgMode = 'cinematic'; localStorage.setItem('rr_settings', JSON.stringify(_sm)); } catch (e2) {}
      }
      localStorage.setItem('rr_bgfix1', '1');
    }
  } catch (e) {}
  let glitchAmount = 0;
  let particles = [];
  const MAX_PARTICLES = 280;   // build64 PERF: hard cap — at high multiplier the flame/streak loops can balloon the array; trim the OLDEST (most-faded, about-to-die) so it can't run away. Invisible at normal play.
  let comboGlow = 0;   // build64: 0→1 flash on each combo milestone — flares the strings gold → white-hot, then decays. Cosmetic only (never touches scoring).
  const RAINBOW_COMBO = 150;   // build65: the SINGLE "earned rainbow" combo threshold — shared by the string tint AND the hit-burst spray so they agree (Overdrive also triggers it). A large-but-reachable streak; tune here.

  // music gate — a miss DIPS the volume briefly (ducks, doesn't cut) then recovers.
  let muteUntil = -1;
  let curGain = 1;
  const DROPOUT = 0.5;     // seconds the dip lasts per missed note
  const DIP_LEVEL = 0.28;  // volume during a miss (0 = silent, 1 = full)
  let cameraShake = 0;

  // scoring
  let score = 0, combo = 0, maxCombo = 0;
  // build122 p1 — CLUTCH (delighter #1): celebrate rebuilding a broken combo back PAST where it snapped.
  // PURELY OBSERVATIONAL/COSMETIC — reads combo, never writes score/mult/judging. `_peakCombo` tracks the
  // highest combo seen on the CURRENT streak (mirrors maxCombo but is a per-streak high, not a per-run high);
  // when the streak breaks (miss/bomb), that peak is snapshotted into `_lastBreakPeak` before combo zeroes.
  // If the NEXT streak climbs back past `_lastBreakPeak` (and that break-peak was >=25, so a trivial 5-note
  // recovery doesn't trigger), fire the CLUTCH callout once, then null the gate so it can't refire on the
  // same recovery. `_clutchCount` is a per-run tally surfaced on the results screen.
  let _peakCombo = 0, _lastBreakPeak = 0, _clutchCount = 0, _clutchArmed = false;
  const CLUTCH_MIN_BREAK_PEAK = 25;
  // build104 s7 (#26b): FULL CHORD bonus state — per-lane last-press timestamps + the pending re-check queue
  // (a chord judged before the second finger landed re-checks for ~35ms so a 5ms-late finger still earns it).
  const _lanePressMs = {};
  let _pendFullChord = [];
  let scoreDisplay = 0;   // animated count-up value chasing `score` (game-feel juice)
  let lightningT = 0;     // seconds remaining on a combo-milestone lightning strike
  let lightningHitT = 0;  // build116 p1: seconds remaining on an INCOMING MP-combat shock lightning strike (crimson tint, distinct from the gold combo-milestone bolt above)
  let comboMidT = 0;      // 3B-i: seconds remaining on the MID-STREAK pulse (a smaller flash at combo%25===15, fills the 11-24 / post-milestone dead zone — cosmetic only)
  // ── COMBO TIER LADDER ───────────────────────────────────────────────────────
  // Named streak "modes" that escalate PAST the golden glow (the #1 ask). Purely
  // COSMETIC + feel — they recolor the combo readout, the board energy hue, and
  // announce themselves on each cross-up. They grant NO extra score: the scoring
  // ceiling (≈notes_total*1500 + per-hold sustain bonus; mult hard-capped at MAX_MULT=4) is identical for every player → leaderboard-safe.
  // Brand-locked warm palette ONLY — crimson → orange → gold → white-hot → chrome.
  // NO purple/blue. rgb = number ink, glow = its halo, board = the neck-energy hue.
  const COMBO_TIERS = [
    { min: 0,   name: 'COMBO',     rgb: [255, 244, 238], glow: [255, 31, 46],   board: [255, 110, 70] },
    { min: 25,  name: 'HOT',       rgb: [255, 214, 150], glow: [255, 120, 40],  board: [255, 140, 60] },
    { min: 75,  name: 'BLAZE',     rgb: [255, 196, 96],  glow: [255, 96, 30],   board: [255, 124, 44] },
    { min: 150, name: 'GOLDEN',    rgb: [255, 226, 140], glow: [255, 182, 44],  board: [255, 184, 74] },
    { min: 300, name: 'INFERNO',   rgb: [255, 246, 236], glow: [255, 70, 44],   board: [255, 96, 54] },
    { min: 500, name: 'ASCENDANT', rgb: [255, 255, 252], glow: [226, 206, 184], board: [232, 214, 192] },
  ];
  function comboTierIdx(c) { let i = 0; for (let k = 0; k < COMBO_TIERS.length; k++) { if (c >= COMBO_TIERS[k].min) i = k; } return i; }
  let comboTierCur = 0;   // highest tier reached on the CURRENT streak (resets on break) — gates the cross-up beat
  // The "you entered a new MODE" beat — fired once when the streak crosses up a tier.
  function onComboTierUp(idx, lane) {
    const ti = COMBO_TIERS[idx]; if (!ti) return;
    _armJudgePriority(550);   // build60: a MODE cross-up headlines — protect it from the next note's plain GREAT
    flashJudgment(ti.name + (idx >= 4 ? ' MODE!!' : ' MODE'), 'rgb(' + ti.rgb.join(',') + ')');
    try { playStingSfx(idx >= 4 ? 'big' : ''); } catch (e) {}   // v257: a rising sting on each combo-tier cross-up
    scanT = scanDur = 0.55; scanTier = idx + 2;                 // a fuller sweep than a plain milestone
    bgPulse = 1; cameraShake = Math.max(cameraShake, 9 + idx * 2);
    try { const cd = $('combo-display'); if (cd) { cd.classList.remove('tierpop'); void cd.offsetWidth; cd.classList.add('tierpop'); } } catch (e) {}
    if (navigator.vibrate) { try { navigator.vibrate(idx >= 4 ? [16, 26, 16, 26, 16] : [14, 22, 14]); } catch (e) {} }
    try { if (window.RhythmLevelFx && window.RhythmLevelFx.onCombo) window.RhythmLevelFx.onCombo(combo, idx >= 3); } catch (e) {}
  }
  // build122 p1 — CLUTCH: called right after `combo` increments (main hit + hopo chain). Purely reads
  // combo/_peakCombo/_lastBreakPeak — never mutates score/mult/judging. Fires the celebration ONCE per
  // recovery via `_clutchArmed` (armed when a qualifying break happens, disarmed the instant it fires or
  // the moment a NEW break happens before recovery — see the two combo-reset sites).
  function checkClutch(lane) {
    if (combo > _peakCombo) _peakCombo = combo;   // track the current streak's own high (separate from maxCombo, the run's all-time high)
    if (!_clutchArmed) return;
    if (combo <= _lastBreakPeak) return;
    _clutchArmed = false;
    _clutchCount++;
    _armJudgePriority(500);   // build60: CLUTCH recovery is a big earned moment — protect it
    flashJudgment('CLUTCH ×' + _clutchCount, '#ff1f2e');
    try { emitComboWave(typeof lane === 'number' ? lane : 2, 3, false); } catch (e) {}   // reuse the combo-milestone board-wide wave for the crimson pop
    cameraShake = Math.max(cameraShake, 14);
    bgPulse = 1;
    scanT = scanDur = 0.5; scanTier = 3;
    if (navigator.vibrate) { try { navigator.vibrate([14, 22, 14, 22, 20]); } catch (e) {} }
    try { const cd = $('combo-display'); if (cd) { cd.classList.remove('tierpop'); void cd.offsetWidth; cd.classList.add('tierpop'); } } catch (e) {}
  }
  let scanT = 0, scanDur = 0.5, scanTier = 1;   // overdrive/combo "scan" — an additive band that sweeps up the guitar
  // --- VISUAL-ONLY feedback timers (no scoring/timing impact) ---
  let missFlash = 0;                 // crimson edge-vignette pulse on any miss/break (decays)
  let laneDesat = Array(LANE_COUNT).fill(0);     // per-lane string desaturation on a missed/dropped note (0..1)
  let catcherRecoil = Array(LANE_COUNT).fill(0); // per-lane catcher "kick back" on a miss (0..1)
  let wipeoutT = 0;                  // MASS-FAIL one-shot intensity (0..1) — big surge/shake
  let stringsCold = 0;               // strings go dark/cold for a beat after a wipeout (0..1)
  let missTimes = [];                // timestamps (performance.now ms) of recent misses → mass-fail detector
  let lastWipeout = -9;              // last wipeout time (s) — rate-limit so it can't spam
  let perspOverride = 0;   // ?persp=N URL override to A/B the highway depth (gh only); 0 = use the profile default
  let warpOverride = -1;   // ?warp=N URL override for the gh neck-recede warp (-1 = use the profile default)
  let counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  // build108 s4 (owner decision: keep empty presses free — no score/combo/miss penalty — but a masher's rank
  // should still read as sloppy): count of presses that landed on NO real note in the hit window. DISPLAY-ONLY —
  // never read by scoring/accFrac/grade/leaderboard-submit; a pure informational signal surfaced in the results
  // sub-line so spamming every lane can't pass as clean play even though it costs nothing to try.
  let wastedInputs = 0;
  // RESULTS-ONLY feedback trackers (G-1 trouble-section detector · G-3 vs-your-best pace). Both are alloc-light,
  // per-run, and NEVER read by scoring/accFrac/grade/leaderboard-submit — they only surface on the results screen
  // (real solo runs; the _ratingsTidFor gate excludes practice/preview/MP/demo). Reset each run in resetScoring().
  let _g1MissTimes = [];    // G-1: song-time (sec) of every miss/dropped-hold this run → cluster into the worst window
  let _paceSamples = [];    // G-3: cumulative score sampled at 10 evenly-spaced progress points (0..9)
  let _paceBucket = 0;      // G-3: next pace bucket to fill (advances as progress crosses each 10%)
  // ---- A2 STARSTRUCK star-phrases (Wave-4b, DARK behind rr_odphrase) run-state — reset every run in resetScoring().
  // Cosmetic ONLY: never read by scoring/OD-charge/mult/accuracy/grade. Off-flag charts carry no phraseId, so both maps
  // stay empty and the runtime hooks (guarded on phraseId != null) are byte-identical no-ops.
  let _phraseHit = {};      // phraseId -> count of member STAR notes hit so far this run
  let _phraseDone = {};     // phraseId -> true once fired (all hit) OR voided (a member missed) — locks the phrase either way
  // ---- B2 ENCORE CHAIN (Wave-4b) — SESSION-ONLY chain depth (module var; never persisted to career/localStorage). A run
  // reached via the ENCORE button extends the chain; ANY other launch or a failed run resets it to 0 (see resetScoring +
  // endGame). The one-time SETLIST badge is the only thing that persists (its own key rr_setlist, never rr_career).
  let _encoreChain = 0;         // consecutive encores accepted this session → shown as "ENCORE ×n" on the next results
  let _encoreArmed = false;     // this results screen offered an encore (S/A/FC) with a curated next available
  let _encoreNext = null;       // the curated next track from RhythmCatalog.encoreNextTrack (null → same-song replay fallback)
  let _encoreAccepting = false; // set by the ENCORE button so the NEXT run's resetScoring KEEPS (not resets) the chain
  let stability = 1.0;
  let runFailed = false;   // true when the current run ended via the (optional) fail-out
  // build108 (fail-out freeze-frame fix): true for the ~550ms "wipeout beat" between failRun() declaring the run
  // over and endGame() actually tearing down. Freezes input/scoring/note-judging (no more hits, misses, or score
  // changes can land after the run is already lost) while leaving `state==='playing'` so loop()'s existing
  // per-frame decay (cameraShake/glitchAmount/particles/bgPulse/odBurst) keeps animating — the shake/glitch slam
  // failRun() applies now visibly DECAYS instead of freezing at max intensity for the whole results crossfade.
  let _endingLock = false;
  // versus split-screen (P2): a drained hit/miss event buffer + cached mult tier for getRenderFrame()
  let _rfHits = [];        // [{l:lane, j:'p'|'g'|'m'} …] drained each getRenderFrame() call
  let _rfMult = 1;         // last displayed multiplier tier (set by updateHUD)
  function _rfPush(lane, j) { _rfHits.push({ l: lane, j: j }); if (_rfHits.length > 12) _rfHits.shift(); }

  // audio/input latency offset (seconds). Positive = player hits late -> shift
  // the judgment clock earlier to compensate. Set via tap calibration.
  let audioOffset = 0;
  try { audioOffset = (parseInt(localStorage.getItem('rr_offset_ms'), 10) || 0) / 1000; } catch (e) {}

  // DOM
  const $ = (id) => document.getElementById(id);
  const screens = {
    menu: $('menu'), loading: $('loading'), game: $('game'),
    countdown: $('countdown-screen'), results: $('results'),
  };
  function showScreen(name) {
    // D1 RATINGS: leaving the results screen re-hides + resets the ratings widget so the next run starts clean
    // (also cancels any pending ~1.2s show timer). Guarded — a no-op before the widget/state exist.
    if (name !== 'results') { try { _resetRatingsWidget(); } catch (e) {} }
    // clear any per-level visual theme ONLY when truly leaving gameplay (back to library or results).
    // NOT on 'loading' — loading happens AFTER launchLevel() applies the theme/backdrop/reactive cards,
    // so clearing here wiped the level's whole identity mid-launch (it played plain). Bug fixed.
    if (name === 'menu' || name === 'results') { try { window.RhythmLibrary && window.RhythmLibrary.clearLevelTheme && window.RhythmLibrary.clearLevelTheme(); } catch (e) {} }
    Object.entries(screens).forEach(([k, el]) => el.classList.toggle('active', k === name));
    // EXCLUSIVITY: the target must be the ONLY active .screen. showScreen() only manages its 5-screen
    // map, so a lingering OVERLAY (how-to / levels / leaderboard / store / profile / settings / start)
    // would otherwise stay active ON TOP of the game — the "playing kicks me back" bug. Close them all.
    try { var tgt = screens[name]; document.querySelectorAll('.screen.active').forEach(function (el) { if (el !== tgt) el.classList.remove('active'); }); } catch (e) {}
    state = name === 'game' ? 'playing' : name;
  }

  // ---------- CANVAS ----------
  const canvas = $('hwy');
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
  let _vigGrad = null, _vigCw = -1, _vigCh = -1;   // build121 PERF: cached static vignette radial gradient (see resize()/render())
  // ---------- FLIPBOOK FX (additive sprite-sheet particle layer; assets/fx via fx-player.js) ----------
  // Fully optional: every call site guards on `fx`, so a missing player / manifest / sheet means no
  // flipbook FX and BYTE-IDENTICAL gameplay. Loaded once here; composited over the scene in render().
  let fx = null;
  // build12 BLACK-BOX FIX (the user's "black box with a small video"): the sheets are RGB-on-black
  // for ADDITIVE drawing — additive is invisible ONLY over an opaque backdrop. The game canvas is
  // TRANSPARENT wherever a level video shows through (and the UI canvases always are), so every
  // black texel rendered as solid black = a literal black rectangle. Bake a LUMINANCE KEY into each
  // sheet once at load (alpha = boosted max(r,g,b)) → black is genuinely transparent everywhere,
  // while 'lighter' still glows over opaque art. Shared with the UI/results layers.
  // Keyed canvases are CACHED + SHARED across the three FxPlayer instances (game / UI / results) —
  // the pixel pass runs once per sheet ever, not 3× (review find: boot jank + 3× canvas memory).
  const _keyedCache = {};
  function alphaKeySheets(player) {
    try {
      for (const nm in player.images) {
        const img = player.images[nm]; if (!img || img.__keyed) continue;
        const ck = (player.manifest && player.manifest[nm] && player.manifest[nm].src) || nm;
        if (_keyedCache[ck]) { player.images[nm] = _keyedCache[ck]; continue; }
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g2 = c.getContext('2d', { willReadFrequently: true });
        g2.drawImage(img, 0, 0);
        const id = g2.getImageData(0, 0, c.width, c.height); const d2 = id.data;
        // build18 (user: a combo effect showed as a RECTANGLE "cropped on both sides"): clip
        // content that reaches a frame cell's border survives the key as a hard crop. FEATHER
        // every cell's borders (~7% smoothstep ramp) so no sheet can ever show frame bounds.
        const meta2 = player.manifest && player.manifest[nm];
        const fw2 = (meta2 && meta2.frameW) || c.width, fh2 = (meta2 && meta2.frameH) || c.height;
        const fpx = Math.max(4, Math.round(Math.min(fw2, fh2) * 0.07));
        let p2 = 0;
        for (let y2 = 0; y2 < c.height; y2++) {
          const cy2 = y2 % fh2; const ey = Math.min(cy2, fh2 - 1 - cy2);
          for (let x2 = 0; x2 < c.width; x2++, p2 += 4) {
            const m = Math.max(d2[p2], d2[p2 + 1], d2[p2 + 2]);
            let a2 = m >= 170 ? 255 : ((m * 3) >> 1);    // boosted luminance key (×1.5, capped)
            const cx2 = x2 % fw2;
            const ed = Math.min(cx2, fw2 - 1 - cx2, ey);
            if (ed < fpx) { const f = ed / fpx; a2 = (a2 * f * f * (3 - 2 * f)) | 0; }
            d2[p2 + 3] = a2;
          }
        }
        g2.putImageData(id, 0, 0);
        c.__keyed = true;
        _keyedCache[ck] = c;
        player.images[nm] = c;
      }
    } catch (e) {}
  }
  // PRODUCTION export (NOT a __rr dev hook — the strip pass must never remove it; review find):
  // the UI/results layers key their independently-loaded sheets through this.
  try { window.RhythmFxKey = alphaKeySheets; } catch (e) {}
  function _bootFx() {
    try {
      if (fx || !window.FxPlayer) return;
      window.FxPlayer.load('assets/fx/manifest.json').then(function (p) { alphaKeySheets(p); fx = p; }).catch(function () {});
    } catch (e) {}
  }
  _bootFx();
  if (!window.FxPlayer) { try { window.addEventListener('load', _bootFx); } catch (e) {} }
  // layered art assets (transparent PNGs keyed from the generated sheets)
  function loadImg(src){ const im=new Image(); im._ready=false; im.onload=()=>{im._ready=true;}; im.src=src; return im; }
  const neckImg = loadImg('assets/neck-cut.png');
  const bodyImg = loadImg('assets/body-cut.png');
  const guitarImg = loadImg('assets/guitar.png');
  // build16: the DEFAULT guitar is now "CRIMSON CHAOS" (RYO flagship, user order v111 — asset
  // commit 0698670, 5 strings, guitar5 anatomy). Revert path: loadImg('assets/guitar5.png') +
  // restore the gh profile's guitar5 fractions (in git history).
  const guitarImg5 = loadImg('assets/guitars/crimson-chaos-ryo.png');   // 5-string neck for the Guitar-Hero controller mode
  let activeGuitarImg = guitarImg;                     // swapped by the active lane profile
  const noteImg = loadImg('assets/note-normal.png');
  const noteStarImg = loadImg('assets/note-star.png');
  // build28: ring-red/white/gold.png loads removed — drawCatcher is now fully canvas-drawn (no dark-box sprite).
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    cw = Math.floor(rect.width); ch = Math.floor(rect.height);
    canvas.width = Math.floor(cw * dpr); canvas.height = Math.floor(ch * dpr);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _vigGrad = null;   // build121 PERF: cw/ch changed — force the cached vignette gradient to rebuild
  }
  window.addEventListener('resize', resize);

  // align the 6 touch zones to the actual lane (string/catcher) positions so a tap
  // lands on the lane under your finger — not an evenly-split column.
  function layoutTapZones() {
    const zones = document.querySelectorAll('#tap-zones .tap-zone');
    if (!zones.length) return;
    // only active lanes get a tap-zone — hide extras (e.g. the 6th button in 5-string GH mode)
    for (let z = 0; z < zones.length; z++) zones[z].style.display = (z < LANE_COUNT) ? '' : 'none';
    // Touch lanes TRACK THE VISIBLE BUTTONS: each lane's column is centered on its
    // string-button, with boundaries at the midpoints between adjacent buttons and the
    // two outer lanes stretched to the playfield edges. Result: full-width coverage
    // (no dead gaps, no slivers) AND a tap always lands on the button you pressed —
    // on any screen, because the boundaries come from the live on-screen geometry.
    if (cw > 0) {
      const fg = fretGeom();
      const cx = fg.nearX.map(x => Math.max(0, Math.min(1, x / cw)));   // button centers (canvas-width fractions)
      const bound = [0];
      for (let i = 0; i < LANE_COUNT - 1; i++) bound.push((cx[i] + cx[i + 1]) / 2);
      bound.push(1);
      // build65 (cycle-3): THUMB FLOOR. On portrait phones the cover-fit bunches the string fan toward the center, so the
      // midpoint columns can collapse to ~33px (below the 44px touch target — 3 of 5 lanes barely tappable). If the narrowest
      // midpoint lane would drop below 60% of an even column, fall back to EVEN columns so every lane stays thumbable.
      // (Keeps the nicer string-tracking whenever the fan is spread enough — i.e. desktop / landscape.)
      let minW = 1; for (let i = 0; i < LANE_COUNT; i++) minW = Math.min(minW, bound[i + 1] - bound[i]);
      if (minW < 0.6 / LANE_COUNT) {
        const w = 1 / LANE_COUNT;
        for (let i = 0; i < LANE_COUNT; i++) { zones[i].style.left = (i * w * 100) + '%'; zones[i].style.width = (w * 100) + '%'; }
      } else {
        for (let i = 0; i < LANE_COUNT; i++) {
          zones[i].style.left = (bound[i] * 100) + '%';
          zones[i].style.width = ((bound[i + 1] - bound[i]) * 100) + '%';
        }
      }
    } else {
      // canvas not sized yet (e.g. still on the menu) — even columns as a safe default
      const w = 100 / LANE_COUNT;
      for (let i = 0; i < LANE_COUNT; i++) { zones[i].style.left = (i * w) + '%'; zones[i].style.width = w + '%'; }
    }
  }
  window.addEventListener('resize', layoutTapZones);
  setTimeout(layoutTapZones, 80); setTimeout(layoutTapZones, 500);
  // Touch input must work on ANY touch-capable device — including touchscreen
  // laptops/desktops (>900px), where the mobile media query alone would hide the
  // tap-zones. Mark the body so CSS can reveal the touch controls regardless of width.
  try { if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) document.body.classList.add('has-touch'); } catch (e) {}

  // ---------- MOBILE / GEOMETRY ----------
  function isMobile() {
    return window.matchMedia('(max-width: 900px)').matches;
  }
  // unified highway geometry so canvas lanes line up with the DOM tap-zones
  function geom() {
    const mobile = isMobile();
    const margin = mobile ? 0 : cw * 0.08;
    const usable = cw - margin * 2;
    const lw = usable / LANE_COUNT;
    // receptor sits higher on phones so a thumb has room below it
    const hitY = mobile ? ch * 0.74 : ch - 140;
    return { mobile, margin, usable, lw, hitY };
  }

  // ---- GUITAR-LOCKED FRET GEOMETRY -------------------------------------------
  // The playable strings / catchers / notes are derived from the guitar IMAGE's
  // drawn rectangle plus where its 6 strings actually sit inside the art (measured
  // from the PNG), so the marbles always travel down the painted strings into the
  // bridge — perfectly aligned at any canvas size, desktop or mobile.
  const ART = {
    fillFY: 0.92,                        // guitar fills up to this fraction of canvas HEIGHT…
    fillFX: 0.995,                       // …but never wider than this fraction of WIDTH (never crop the body sides)
    bridgeScreenY: 0.78,                 // the catcher row always sits here on screen (fraction of height)
    aspect: 904 / 1268,                  // guitar image w/h (refined from the loaded image)
    nutFY: 0.05, bridgeFY: 0.75,         // string top (nut) / bottom (bridge) — image-height fractions
    // EXACT per-string x positions MEASURED from guitar.png (image-width fractions).
    // The 6 painted strings fan from a tight cluster at the nut out to the saddles at
    // the bridge — and not perfectly evenly — so each string is pinned individually
    // rather than interpolated between two endpoints. Catchers/notes ride these.
    nutXF:    [0.450, 0.470, 0.490, 0.510, 0.530, 0.550],   // at the nut/spawn (y≈0.05): tight, centered — strings span only 0.448–0.552 here
    bridgeXF: [0.247, 0.358, 0.469, 0.570, 0.659, 0.750],   // at the bridge/catcher row (y≈0.75): wide saddle fan (confirmed good)
  };
  let _vsFit = false;   // split-screen versus: fit the guitar to deck HEIGHT (full runway), not cover-fill width
  function guitarRect() {
    const aspect = (activeGuitarImg && activeGuitarImg.width && activeGuitarImg.height) ? activeGuitarImg.width / activeGuitarImg.height : ART.aspect;
    let gw, gh, gx, gy;
    if (_vsFit) {
      // SPLIT-SCREEN: the half-deck is WIDER than the guitar, so cover-fit-fill-width over-zooms and crops the
      // far (note-spawn) end off the top → no runway. Fit to HEIGHT instead so the whole neck + a full note
      // runway is visible; centre it (the level world shows on the sides); anchor the CATCHER at ~86% so there's
      // strike space below. Lanes still ride the painted strings (derived from this same rect → alignment holds).
      // vsFitFY = guitar height as a fraction of deck height; vsCatcherFY pins the CATCHER (bridge) at that
      // fraction of deck height REGARDLESS of vsFitFY (gy+bridgeFY*gh resolves to ch*vsCatcherFY), so lowering
      // vsFitFY only drops the far/spawn end — shortening the on-screen neck (less "zoomed/too close") and
      // opening top headroom + wider side gaps for the HUD, without moving the strike row or changing note timing.
      // 0.9 leaves the spawn end below the top score-plate row so the side-gap HUD never overlaps the playfield.
      // (Optional per-skin hooks; no profile defines them today. If a skin sets them, re-check the index.html
      // vs-mode HUD anchors — combo top:50%, OD bottom inset — against the new catcher band.)
      const vh = ch * (ART.vsFitFY || 0.9);
      const vw = vh * aspect;
      return { gx: (cw - vw) / 2, gy: ch * (ART.vsCatcherFY || 0.86) - ART.bridgeFY * vh, gw: vw, gh: vh };
    }
    // (build12: the v99 "invariant-lane skin fit" branch is GONE — the user's playtest verdict: a
    // custom guitar must look like THE GUITAR at the default's framing, lanes on its own strings.
    // Skins set ART.fit='cover' + their measured fractions and take the same paths as the default.)
    if (ART.fit === 'cover') {
      // COVER-FIT (5-string gh): FILL the playfield so there's no dead space left/right/under the
      // guitar. The playfield is portrait, so this fills the WIDTH (body reaches the side edges) and
      // the non-playable headstock crops off the TOP. Anchor the body's bottom at the screen bottom.
      if (cw / ch > aspect) { gw = cw; gh = gw / aspect; }   // panel wider than guitar → fill width
      else { gh = ch; gw = gh * aspect; }                    // panel narrower → fill height
      // build13 (user playtest): a CUSTOM skin draws SMALLER than full-bleed — crisper art (less
      // upscale past its native px) and the level's world stays visible at the sides (play space).
      // The default guitar is untouched (skinWF only set while a skin is active).
      if (_skinArtOn && ART.skinWF > 0 && ART.skinWF < 1) {
        const wf = Math.min(0.95, Math.max(0.46, ART.skinWF));
        const gw2 = Math.min(gw, cw * wf);
        gh = gh * (gw2 / gw); gw = gw2;
      }
      gx = (cw - gw) / 2;
      gy = ch - (ART.bottomAnchor || 0.95) * gh;             // body bottom ≈ screen bottom
    } else {
      // CONTAIN-FIT (standard 6-string): whole guitar visible, bridge anchored at a fixed screen height.
      gh = ch * ART.fillFY;
      gw = gh * aspect;
      if (gw > cw * ART.fillFX) { gw = cw * ART.fillFX; gh = gw / aspect; }
      gx = (cw - gw) / 2;
      gy = ch * ART.bridgeScreenY - ART.bridgeFY * gh;
    }
    return { gx: gx, gy: gy, gw: gw, gh: gh };
  }
  // build121 PERF: fretGeom() is pure (a function of cw/ch/ART/activeGuitarImg/_vsFit/_skinArtOn)
  // but is called several times within the SAME synchronous rAF tick (loop() then render()), each
  // call reallocating a rect + nearX[]/farX[] arrays for byte-identical output. _fgFrameCache holds
  // that one tick's result; it is nulled at the very top of loop() (so a fresh geometry is computed
  // the first time it's needed each tick) and nulled again at the end of render() (so any call site
  // OUTSIDE the loop/render pass — dev hooks, click handlers, hit-FX helpers — is completely
  // unaffected and always computes fresh, exactly as before). Nothing can mutate cw/ch/ART/skin
  // between these calls (no await/yield in loop()/render()), so reuse is provably identical.
  let _fgFrameCache = null;
  function fretGeom() {
    if (_fgFrameCache) return _fgFrameCache;
    const r = guitarRect();
    const nearY = r.gy + ART.bridgeFY * r.gh;   // catcher / bridge row
    const farY = r.gy + ART.nutFY * r.gh;       // far (nut) where notes spawn
    const nearX = [], farX = [];
    const nutA = ART.nutXF, brgA = ART.bridgeXF;
    for (let i = 0; i < LANE_COUNT; i++) {
      const f = LANE_COUNT > 1 ? i / (LANE_COUNT - 1) : 0;
      // use the measured per-string position when available; fall back to an even
      // fan between the array endpoints if LANE_COUNT ever differs from the data.
      const bx = (brgA && brgA[i] != null) ? brgA[i] : (brgA[0] + (brgA[brgA.length - 1] - brgA[0]) * f);
      const nx = (nutA && nutA[i] != null) ? nutA[i] : (nutA[0] + (nutA[nutA.length - 1] - nutA[0]) * f);
      nearX[i] = r.gx + bx * r.gw;
      farX[i] = r.gx + nx * r.gw;
    }
    // Far-end convergence DISABLED (cv=0). Pulling the far end toward a vanishing point made the note
    // lanes drift OFF the painted strings near the nut (broke the illusion — user feedback). The painted
    // strings already fan nut→bridge and depth comes from the persp 1/z Y-map, so with cv=0 the lanes
    // ride the painted strings EXACTLY (verified by offline string-detection + overlay). Re-enable only
    // with a re-measured cv if ever needed.
    const cv = 0;
    if (cv > 0) {
      const vanishX = r.gx + 0.5 * r.gw;
      for (let i = 0; i < LANE_COUNT; i++) farX[i] += (vanishX - farX[i]) * cv;
    }
    // build26 (playtest: the v125 COMFORT FLOOR is DELETED). It widened a skin's lane fan to a fixed
    // "comfortable" span, which DETACHED the lanes/catchers from the painted strings (Bone Daddy k≈1.43
    // → catchers flung ±63px onto the body). The correct contract is restored: lanes ride the active
    // surface's MEASURED strings EXACTLY, and a skin is only allowed to drive the surface if its art
    // actually passes string-measurement (the gate in _applySkinGeom) — otherwise it falls back to the
    // canonical crimson geometry. So alignment is guaranteed and note size stays the proven default.
    // lane width = median-ish bridge string spacing (sizes notes/catchers, kept uniform) — ONE formula
    // for every level (default + skin), so note/catcher size is identical to the working Crimson highway.
    const lw = Math.abs(nearX[3] - nearX[2]) || Math.abs(nearX[1] - nearX[0]) || (r.gw * 0.072);
    _fgFrameCache = { gx: r.gx, gy: r.gy, gw: r.gw, gh: r.gh, nearX: nearX, farX: farX, nearY: nearY, farY: farY, lw: lw };
    return _fgFrameCache;
  }

  // ---- LANE PROFILES — 'standard' (6-string keyboard game) + 'gh' (5-string Guitar-Hero controller).
  //      Additive & reversible: 'standard' reproduces the original engine exactly; only ?gh=1 / the
  //      toggle switches to 5 lanes. Everything downstream reads LANE_COUNT / ART / LANE_COLORS live,
  //      so swapping a profile re-shapes geometry, colours, keymap and per-lane state with no logic change.
  const LANE_PROFILES = {
    standard: {
      count: 6, img: guitarImg, store: 'rr_keymap', padStore: 'rr_padmap',
      aspect: 904 / 1268, nutFY: 0.05, bridgeFY: 0.75,
      nutXF:    [0.450, 0.470, 0.490, 0.510, 0.530, 0.550],
      bridgeXF: [0.247, 0.358, 0.469, 0.570, 0.659, 0.750],
      colors: [
        { c: '#ff3c3c', rgb: '255, 60, 60' }, { c: '#ece7e3', rgb: '236, 231, 227' },
        { c: '#ff3c3c', rgb: '255, 60, 60' }, { c: '#ece7e3', rgb: '236, 231, 227' },
        { c: '#ff3c3c', rgb: '255, 60, 60' }, { c: '#ece7e3', rgb: '236, 231, 227' },
      ],
      keyDefault: { a: 0, s: 1, d: 2, j: 3, k: 4, l: 5 },
    },
    gh: {
      count: 5, img: guitarImg5, store: 'rr_keymap_gh', padStore: 'rr_padmap_gh',
      // measured from assets/guitars/crimson-chaos-ryo.png (string-tracking + peak snap at the
      // eval rows, _calibrate.py — do NOT even-space). guitar5.png's old fractions are in git.
      aspect: 0.5625, nutFY: 0.16, bridgeFY: 0.81, fit: 'cover', bottomAnchor: 0.93, persp: 4, warp: 0.2,
      nutXF:    [0.4620, 0.4833, 0.5065, 0.5296, 0.5528],
      bridgeXF: [0.3444, 0.4176, 0.4917, 0.5648, 0.6380],
      // Guitar-Hero fret colours (green/red/yellow/ORANGE) with the BLUE fret chrome-swapped (brand: no blue)
      colors: [
        { c: '#3ad15a', rgb: '58, 209, 90'  }, { c: '#ff3c3c', rgb: '255, 60, 60'  },
        { c: '#ffd23c', rgb: '255, 210, 60' }, { c: '#ece7e3', rgb: '236, 231, 227' },
        { c: '#ff8a2b', rgb: '255, 138, 43' },
      ],
      keyDefault: { a: 0, s: 1, d: 2, j: 3, k: 4 },
    },
  };
  let laneProfile = 'standard';
  function allocLaneArrays() {
    lanePulse = Array(LANE_COUNT).fill(0); laneHitPulse = Array(LANE_COUNT).fill(0);
    lanePluckT = Array(LANE_COUNT).fill(9); laneDown = Array(LANE_COUNT).fill(false);
    holdNote = Array(LANE_COUNT).fill(null); holdScored = Array(LANE_COUNT).fill(0);
    holdSparkT = Array(LANE_COUNT).fill(0); holdRailSeg = Array(LANE_COUNT).fill(0);
  }
  function loadKeyMapFor(p) {
    try { const sv = JSON.parse(localStorage.getItem(p.store) || 'null'); if (sv && typeof sv === 'object') return sv; } catch (e) {}
    return Object.assign({}, p.keyDefault);
  }
  function applyLaneProfile(name) {
    const p = LANE_PROFILES[name]; if (!p) return;
    laneProfile = name;
    LANE_COUNT = p.count;
    activeGuitarImg = p.img;
    ART.aspect = p.aspect; ART.nutFY = p.nutFY; ART.bridgeFY = p.bridgeFY;
    ART.nutXF = p.nutXF.slice(); ART.bridgeXF = p.bridgeXF.slice();
    ART.fit = p.fit || null; ART.bottomAnchor = p.bottomAnchor || 0.95; ART.persp = p.persp || 0; ART.warp = p.warp || 0;
    ART.skinWF = 0;   // build13: profiles are full-bleed; only an active skin sets a width cap
    LANE_COLORS.length = 0; for (const c of p.colors) LANE_COLORS.push(c);
    keyMapStore = p.store; keyMap = loadKeyMapFor(p);
    padStore = p.padStore; padMap = loadPadMapFor(p.padStore, p.count);
    loadStrumCfg();   // GH strum/whammy/tilt calibration (device-level; reloaded on profile switch)
    allocLaneArrays();
    try { localStorage.setItem('rr_lanemode', name); } catch (e) {}
    try { if (typeof updateFooterHint === 'function') updateFooterHint(); } catch (e) {}
    try { if (typeof renderKeycaps === 'function') renderKeycaps(); } catch (e) {}
    try { if (typeof renderPadcaps === 'function') renderPadcaps(); } catch (e) {}
    try { if (typeof layoutTapZones === 'function') layoutTapZones(); } catch (e) {}
    // keep the active skin after a profile swap: per-level override wins, else equipped, else this profile's default (already set above)
    try { if (typeof _applySkinImg === 'function') { if (_levelSkinActive) {} else if (equippedSkinSrc) _applySkinImg(equippedSkinSrc); } } catch (e) {}
  }
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}

  // ---- GUITAR-HERO CONTROLLER SUPPORT --------------------------------------------------------
  // Detect a GH/Rock-Band/Clone-Hero style guitar by gamepad id, and a "5-fret preset" that maps
  // the common fret button indices to lanes as a starting point. The Set-Up-Controller WIZARD is the
  // reliable path for ANY controller (it captures whatever button you press); the preset/detection are
  // convenience on top. NOTE on button indices: the standard HTML Gamepad mapping for the popular
  // Xbox-360 / PS3 GH & Rock Band guitars exposes the 5 frets as the face/shoulder buttons —
  // GREEN=0, RED=1, YELLOW=3, BLUE=2, ORANGE=4 (a common layout for these as seen by the browser).
  // Cheap clones (Santroller / Raphnet adapters / Wii) vary, so this is BEST-EFFORT — tune freely;
  // the wizard always rescues a mismatch. Order below is fret-1(green)..fret-5(orange) -> lane 0..4.
  const GH_ID_RE = /guitar|gh\b|guitar\s*hero|red\s*octane|harmonix|rock\s*band|rockband|wii.*guitar|santroller|raphnet|clone\s*hero|world\s*tour|les\s*paul|stratocaster|riffmaster/i;   // build99h: + Riffmaster (the recommended PDP guitar). NOTE: Chrome may report it as a generic XInput pad with no "guitar" token — then the wizard is the fallback.
  const GH_PRESET_BTN = [0, 1, 3, 2, 4];   // green, red, yellow, blue, orange  ->  lane 0..4 (gh profile)
  function isGuitarPad(id) { return GH_ID_RE.test(String(id || '')); }
  function guitarPadId() { for (const id of gamepadList()) if (isGuitarPad(id)) return id; return null; }
  function applyGhPreset() {
    // build100q: the GH preset implies a guitar → switch to the 5-string 'gh' profile FIRST so note design adapts
    // (fret colors + 5-string art) and strum-gating can engage. Was: only wrote padMap → a guitar clicked off the
    // 'standard' profile stayed in 6-lane, no-strum, standard-color mode (the "GH controller in standard mode" bug).
    if (laneProfile !== 'gh') { try { applyLaneProfile('gh'); } catch (e) {} }
    // map the 5 GH frets to the active profile's lanes (clamped to LANE_COUNT so it's safe on standard too)
    const m = {}; const n = Math.min(GH_PRESET_BTN.length, LANE_COUNT);
    for (let lane = 0; lane < n; lane++) m[GH_PRESET_BTN[lane]] = lane;
    padMap = m; savePadMap();
    // build102v: applying the GH preset IS an explicit "I have a guitar" declaration → strum-to-hit. With identity
    // detection gone from requireStrum() (build102u), the setup flow is the declaration point — a preset click is
    // the strongest signal we get. (setStrumRequired dispatches 'rr-strummode' so the Settings HIT MODE seg re-syncs.)
    try { window.RhythmGame.setStrumRequired(true); } catch (e) {}
    try { renderPadcaps(); } catch (e) {}
    try { renderDeviceStatus(); } catch (e) {}
    try { window.RhythmGame.showToast('Guitar Hero 5-fret preset applied — HIT MODE: Strum to hit', 'success'); } catch (e) {}
  }
  // Friendly per-lane label for the active profile: GH frets get colour names, standard uses ordinals.
  const GH_FRET_NAMES = ['GREEN', 'RED', 'YELLOW', 'BLUE', 'ORANGE'];
  function laneFretLabel(lane) {
    if (laneProfile === 'gh' && GH_FRET_NAMES[lane]) return GH_FRET_NAMES[lane] + ' fret';
    return 'Lane ' + (lane + 1);
  }
  function laneSwatch(lane) { const c = LANE_COLORS[lane]; return (c && c.c) || '#ff3c3c'; }

  // ---- GUITAR SKIN LAYER (image-only swap) -------------------------------------
  // Swaps activeGuitarImg to a re-skinned guitar PNG WITHOUT touching geometry
  // (LANE_COUNT / ART.nutXF / ART.bridgeXF / aspect / fit all stay from the lane
  // profile), so notes & strings stay aligned. The skin art MUST share the active
  // profile's silhouette + string positions (skins target the standard 6-string;
  // assets/guitars/* are recolors of assets/guitar.png). A 404 self-heals back to
  // the lane-profile default image. Equipped skin persists in rr_skin; a per-level
  // guitarSkin is a temporary override that does NOT touch rr_skin.
  const SKIN_STORE = 'rr_skin';
  let equippedSkinSrc = null;       // persisted (rr_skin) — the global equip
  let _levelSkinActive = false;     // true while a per-level override is showing
  function _profileDefaultImg() { const p = LANE_PROFILES[laneProfile]; return (p && p.img) || guitarImg; }
  // build8.1: PER-SKIN note-lane geometry. AI-made guitars have their OWN string positions, so without
  // this the catchers ride the lane-profile defaults and miss the painted strings. Endpoints [left,right]
  // measured by the asset agent (fine-tune with __rrDebug); evenly interpolated across LANE_COUNT. The
  // skin fractions are full-PNG (contain-fit). Falsy/unknown src → restore the lane-profile default geom.
  // SKIN_GEOM v2 (5-lane decree, 2026-06-09): per-skin PIXEL-MEASURED string data.
  //  nutXF/bridgeXF — per-string x fractions of the PNG (any count; resampled/subset to LANE_COUNT).
  //  nutFY/bridgeFY — the rows those were measured at (image-height fractions).
  //  Legacy `nut`/`bridge` [left,right] endpoints still accepted (lerped) until a skin is measured.
  // PRESENTATION CONTRACT: lanes are INVARIANT (see guitarRect's skin-fit branch) — these fractions
  // only tell the fitter where the painted strings live inside the art.
  // Values below are PIXEL-MEASURED (string-tracking: contrast peaks across 16–26 neck rows →
  // least-squares line per string → evaluated at nutFY/bridgeFY; method validated against
  // guitar5.png's hand calibration to ≤0.003). 6-entry arrays = the art paints 6 strings; the
  // resampler subsets the most centered 5 for the gh profile.
  // build26 STANDARDIZATION DECREE (playtest): a guitar may only become the play SURFACE if it is
  // VERIFIED to ride the 5 lanes — exactly-5 measured strings, framed to the receding-neck template
  // (aspect ≈0.5625), with a comfortable bridge fan (string-measurement passes _measure_strings.py
  // with ≥8 clean exactly-5 rows). `verified: true` marks the known-good set. ANY skin without it
  // (incl. the old flat bass-photo guitars melody-pink/bone-daddy — 0 and 5 clean rows, unfixable)
  // is REJECTED at _applySkinImg and the level falls back to the canonical crimson surface, so the
  // lanes/catchers can never again detach from the painted strings. This is the single contract for
  // ALL current + future levels.
  const SKIN_GEOM = {
    // build16: TRUE-5-STRING deliveries (asset commit 0698670; string-tracking + peak snap via
    // assets/guitars/_calibrate.py) — exactly-5 arrays ride the painted strings (no fan).
    'assets/guitars/violet-gothic-5.png': { verified: true, aspect: 1080 / 1920, nutFY: 0.105, bridgeFY: 0.795,
      nutXF:    [0.4565, 0.4742, 0.4981, 0.5222, 0.5398],
      bridgeXF: [0.3380, 0.4093, 0.4843, 0.5565, 0.6333] },   // 57 clean 5-string rows — Skully; proven themed surface
    'assets/guitars/crimson-chaos-ryo.png': { verified: true, aspect: 1080 / 1920, nutFY: 0.160, bridgeFY: 0.810,
      nutXF:    [0.4620, 0.4833, 0.5065, 0.5296, 0.5528],
      bridgeXF: [0.3444, 0.4176, 0.4917, 0.5648, 0.6380] },   // 64 clean rows — canonical default + the "Crimson Chaos" store skin
    'assets/guitars/violet-gothic.png': { verified: true, aspect: 904 / 1664, nutFY: 0.105, bridgeFY: 0.795,
      nutXF:    [0.4569, 0.4769, 0.4924, 0.5097, 0.5269],
      bridgeXF: [0.3558, 0.4115, 0.4661, 0.5216, 0.5764] },
    // build27: BESPOKE re-renders to the receding-neck TEMPLATE (i2i from crimson-chaos-ryo, body
    // restyled per theme, strings kept clean). Measurement gate PASSED: melody = 56 clean exactly-5
    // rows (res 1.78px), bone = 111 (res 5.08px) — vs the old bass photos' 5 and 0. Bridge spans
    // 0.289/0.283 ≈ crimson's 0.294 → comfortable + aligned, no widening. Overlay-proof confirms
    // catchers ride the painted strings nut→bridge.
    'assets/guitars/melody-pink.png':   { verified: true, aspect: 1504 / 2668, nutFY: 0.160, bridgeFY: 0.810,
      nutXF:    [0.4601, 0.4834, 0.5073, 0.5326, 0.5565],
      bridgeXF: [0.3477, 0.4182, 0.4934, 0.5672, 0.6363] },
    'assets/guitars/bone-daddy.png':    { verified: true, aspect: 1504 / 2650, nutFY: 0.160, bridgeFY: 0.810,
      nutXF:    [0.4608, 0.4820, 0.5066, 0.5326, 0.5572],
      bridgeXF: [0.3544, 0.4249, 0.4953, 0.5672, 0.6370] },
    // Carnival of Souls — wolf-pelt SHAMAN bass (i2i restyle from crimson-chaos-ryo, body→wolf fur+skull+runes,
    // neck/strings kept clean). Gate PASSED via adaptive neck-band measure: 66 clean exactly-5 rows (res 3.36px),
    // fit overlay-verified riding the painted strings nut→bridge. Transparent cutout, aspect ≈0.560.
    'assets/guitars/shaman-wolf.png':   { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,
      nutXF:    [0.4583, 0.4779, 0.4990, 0.5197, 0.5375],
      bridgeXF: [0.3800, 0.4339, 0.4926, 0.5525, 0.6096] },   // build99 alignment swarm: stored bridge fanned too wide (outer lanes 4-8px off the strings) → re-measured on-string
    // build99 alignment swarm: 6-STRING art driving 5 lanes — the stored FY rows landed on HARDWARE (nut on the headstock
    // between the pegs; bridge on the saddle posts), so catchers floated off the strings. Re-measured the clean painted-string
    // band: nutFY 0.085→0.128, bridgeFY 0.800→0.550, and a 5-lane fan across the 6 strings. Overlay-verified on-string.
    'assets/guitars/crimson-chrome.png':{ verified: true, aspect: 904 / 2194, nutFY: 0.128, bridgeFY: 0.550,
      nutXF:    [0.4505, 0.4737, 0.4923, 0.5116, 0.5349],
      bridgeXF: [0.3899, 0.4384, 0.4851, 0.5347, 0.5872] },
    // build99 alignment swarm: 6-string art (6→5 even resample); stored was already well-centered (≤11px),
    // refined to better hit the outer strings at both rows — FY rows 0.10/0.81 kept (both on painted strings).
    'assets/guitars/ember-bone.png':    { verified: true, aspect: 904 / 1759, nutFY: 0.100, bridgeFY: 0.810,
      nutXF:    [0.4375, 0.4615, 0.4861, 0.5101, 0.5314],
      bridgeXF: [0.3141, 0.3948, 0.4731, 0.5519, 0.6311] },
    // build99 alignment swarm: 6-STRING art — stored FY rows landed on the gold headstock/body ornament (no strings there),
    // so catchers floated off. The painted strings read cleanly only on the dark fretboard (y≈0.16→0.475). Re-measured there:
    // nutFY 0.085→0.175, bridgeFY 0.800→0.475, 5-lane fan across the 6 strings. Overlay-verified on-string nut→bridge.
    'assets/guitars/gold-relic.png':    { verified: true, aspect: 904 / 2160, nutFY: 0.175, bridgeFY: 0.475,
      nutXF:    [0.4170, 0.4448, 0.4726, 0.5004, 0.5282],
      bridgeXF: [0.3817, 0.4254, 0.4690, 0.5127, 0.5563] },
    // ---- PREMIUM STORE GUITARS (i2i from crimson-chaos-ryo: theme painted on the BODY, neck + 5 strings kept clean).
    // Each gate-PASSED via adaptive neck-band measure on the transparent cutout; fit overlay-verified riding the strings.
    'assets/guitars/crimson-fox.png':   { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // Ryo "Crimson Moon Fox" — 100 rows, res 4.36px
      nutXF:    [0.4565, 0.4787, 0.5030, 0.5298, 0.5561],
      bridgeXF: [0.3427, 0.4169, 0.4889, 0.5600, 0.6344] },
    'assets/guitars/crimson-tarot.png': { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // "Crimson Fortune" tarot — 32 rows, res 5.56px
      nutXF:    [0.4552, 0.4775, 0.4985, 0.5215, 0.5425],
      bridgeXF: [0.4062, 0.4540, 0.5003, 0.5470, 0.5926] },   // build99 swarm: two leftmost catchers drifted off-string at the bridge → re-measured
    'assets/guitars/clockwork.png':     { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // "Tourbillon" clockwork — 58 rows, res 2.84px
      nutXF:    [0.4508, 0.4728, 0.4971, 0.5221, 0.5443],   // build99 swarm: stored nut sat ~6-10px left of the strings → re-measured
      bridgeXF: [0.4008, 0.4470, 0.4955, 0.5436, 0.5923] },   // build99 swarm: stored bridge fanned right (5th string ~15px off) → re-measured (gear ornaments excluded)
    // Alarm Clock Hero — ivory-and-gold clock-face bass (i2i from crimson-chaos-ryo: clean dark fretboard + bright strings
    // kept, ivory body / gold clock face / Roman numerals / brass gears painted on the BODY below the strings). Gate PASSED
    // via adaptive neck-band measure: 108 clean exactly-5 rows, res 5.89px; fit overlay-verified riding the painted strings
    // nut→bridge. bridge span 0.275 ≈ crimson's 0.294 (aligned). Transparent cutout, aspect ≈0.560.
    'assets/guitars/alarm-clock.png':   { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // "Clocked In" alarm-clock bass — 108 rows, res 5.89px
      nutXF:    [0.4468, 0.4695, 0.4977, 0.5275, 0.5565],
      bridgeXF: [0.3539, 0.4261, 0.4906, 0.5607, 0.6287] },
    // Sasoka — bayou wolf-priestess bass (i2i from crimson-chaos-ryo: clean dark driftwood fretboard + bright strings kept;
    // gnarled cypress-wood / wolf-skull / bone / feathers / violet Loa runes on the BODY). RE-MEASURED 2026-06-19 on the SHIPPED
    // file (the first pass recorded a high-TH measure → ~3px drift vs the visual cutout that's actually drawn): 32 clean exactly-5
    // rows, res 6.69px, overlay-verified riding the strings nut→bridge. bridge span 0.265 ≈ crimson's 0.294.
    'assets/guitars/sasoka.png':        { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // "Sasoka" wolf-priestess bass — 32 rows, res 6.69px
      nutXF:    [0.4546, 0.4768, 0.5009, 0.5239, 0.5460],
      bridgeXF: [0.3556, 0.4234, 0.4878, 0.5554, 0.6207] },
    // Pirate-Fox — Ryo's black-chrome pirate bass (i2i from crimson-chaos-ryo: clean dark fretboard + bright strings kept;
    // glossy black-chrome body, fox head w/ glowing red eyes, pirate skulls + crossbones, crimson chaos energy seeping through
    // cracks underneath, chrome chain flair). Gate PASSED: 34 clean exactly-5 rows, res 6.95px; fit overlay-verified riding the
    // strings nut→bridge. bridge span 0.258 ≈ crimson's 0.294. For the paid High-Seas Showdown level + store.
    'assets/guitars/pirate-fox.png':    { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // "Pirate Fox" black-chrome bass — 34 rows, res 6.95px
      nutXF:    [0.4488, 0.4735, 0.4995, 0.5229, 0.5464],
      bridgeXF: [0.3685, 0.4310, 0.4910, 0.5589, 0.6267] },
    // Deadkin — macabre marble-ivory bass (i2i from crimson-chaos-ryo: clean dark fretboard + bright strings kept; polished
    // marble-ivory body carved with skulls, sharp silver edges, a cut-glass crystal panel revealing a still-beating red HEART
    // wired in, crimson circus pinstripe). RE-MEASURED 2026-06-19 after playtest flagged lanes "slightly off": 68 clean exactly-5
    // rows, res 4.91px (was 29 rows / 6.31px — the looser first pass drifted the bridge fan ~2% of width). Overlay-verified riding
    // the strings nut→bridge (incl. the bridge/catcher zone where you hit). Visual cutout preserves the light marble body (TH=22).
    'assets/guitars/deadkin.png':       { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // "Deadkin" marble-ivory bass — 68 rows, res 4.91px
      nutXF:    [0.4453, 0.4716, 0.4995, 0.5251, 0.5503],
      bridgeXF: [0.3528, 0.4242, 0.4956, 0.5653, 0.6341] },   // build99 swarm: stored bridge drifted right on the two outer lanes (~9px) → re-measured
    'assets/guitars/shorty-x.png':      { verified: true, aspect: 1520 / 2688, nutFY: 0.160, bridgeFY: 0.810,  // "Shorty X" vampire-fang bass — i2i reskin of crimson-chaos-ryo, 17 rows, res 16.65px
      nutXF:    [0.4633, 0.4844, 0.5087, 0.5336, 0.5577],
      bridgeXF: [0.3469, 0.4181, 0.4931, 0.5655, 0.6372] },   // build99 swarm: stored bridge fan was narrower than the strings (outer lanes ~19px off) → re-measured
    'assets/guitars/celines-razor.png': { verified: true, aspect: 1140 / 2016, nutFY: 0.160, bridgeFY: 0.810,  // "Celine's Razor" — CelinesRazor × Dion community guitar (i2i reskin of crimson-chaos-ryo), 55 rows, res 1.67px
      nutXF:    [0.4649, 0.4867, 0.5098, 0.5335, 0.5566],
      bridgeXF: [0.3395, 0.4132, 0.4877, 0.5623, 0.6342] },   // build99 swarm: stored bridge rode right of the strings (growing toward lane 5) → re-measured
    // build64: three NEW store guitars — i2i reskins of crimson-chaos-ryo (strings/neck kept, body re-skinned), keyed + adaptive-measured + overlay-verified riding the strings nut→bridge.
    'assets/guitars/razor.png':         { verified: true, aspect: 1518 / 2647, nutFY: 0.152, bridgeFY: 0.812,  // "Razor" emo-punk dark-purple bass — 164 clean rows, res 7.09px
      nutXF:    [0.4635, 0.4842, 0.5068, 0.5301, 0.5521],
      bridgeXF: [0.3473, 0.4198, 0.4926, 0.5677, 0.6431] },
    'assets/guitars/wormfeast.png':     { verified: true, aspect: 1519 / 2655, nutFY: 0.156, bridgeFY: 0.814,  // "Wormfeast" skull-&-eyeball-&-worm horror bass — 109 clean rows, res 5.75px
      nutXF:    [0.4633, 0.4843, 0.5074, 0.5323, 0.5547],
      bridgeXF: [0.3527, 0.4227, 0.4931, 0.5648, 0.6380] },
    'assets/guitars/kitsune.png':       { verified: true, aspect: 1514 / 2677, nutFY: 0.160, bridgeFY: 0.813,  // "Kitsune" ivory fox-fur bass (fox-ear horns + fox-skull crown) — 112 clean rows, res 14.33px
      nutXF:    [0.4512, 0.4791, 0.5078, 0.5367, 0.5625],   // build99 swarm: stored nut 7-9px left of the strings → re-measured on-string
      bridgeXF: [0.3675, 0.4295, 0.4949, 0.5584, 0.6219] },   // build99 swarm: stored bridge badly off (up to ~45px left, lines in the fur/ornament) → re-measured (atom + edge ornaments excluded)
    'assets/guitars/triemrys.png':      { verified: true, aspect: 1517 / 2646, nutFY: 0.149, bridgeFY: 0.810,  // "Triemrys" scarecrow bass — charred black, demon-crow wings, burlap+bone, axe-blade — 110 clean rows, res 7.25px
      nutXF:    [0.4616, 0.4845, 0.5075, 0.5316, 0.5535],
      bridgeXF: [0.3548, 0.4211, 0.4919, 0.5661, 0.6422] },
  };
  function _lerpLane(a, b, n, i) { return n > 1 ? a + (b - a) * (i / (n - 1)) : (a + b) / 2; }
  // resample a measured per-string array to the active LANE_COUNT: exact when counts match; the most
  // CENTERED contiguous subset when the art paints more strings than lanes (e.g. 6-string art, 5 lanes);
  // an even fan across the span when it paints fewer (dormant 6-lane mode on 5-string art).
  function _resampleStrings(arr, L) {
    const N = arr.length;
    if (N === L) return arr.slice();
    if (N > L) {
      let best = 0, bestD = Infinity;
      const mid = (arr[0] + arr[N - 1]) / 2;
      for (let s = 0; s + L <= N; s++) {
        const c = (arr[s] + arr[s + L - 1]) / 2, d = Math.abs(c - mid);
        if (d < bestD) { bestD = d; best = s; }
      }
      return arr.slice(best, best + L);
    }
    const out = []; for (let i = 0; i < L; i++) out.push(_lerpLane(arr[0], arr[N - 1], L, i));
    return out;
  }
  // build12 (the user's decree after playtest): a custom guitar draws EXACTLY like the default one —
  // the WHOLE art, cover-fit with the body anchored at the bottom, neck receding up the screen, and
  // the LANES ON ITS OWN PAINTED STRINGS (art-defines-lanes at natural framing). No texture warping,
  // no invariant-lane scaling — those read as "warped/blown up". Flat front-on renders get a stronger
  // neck-recede taper (warp) so the neck points down into the level like the default's painted
  // perspective. `_skinArtOn` flags an active skin (drives the materialize cinematic).
  let _skinArtOn = false;
  function _applySkinGeom(src) {
    const g = src && SKIN_GEOM[src];
    const p = LANE_PROFILES[laneProfile];
    if (!g) {   // restore the active lane-profile's default geometry (incl. fit + warp)
      _skinArtOn = false;
      ART.skinWF = 0;   // build13: full-bleed again (the default guitar never shrinks)
      if (p) {
        ART.aspect = p.aspect; ART.nutFY = p.nutFY; ART.bridgeFY = p.bridgeFY;
        ART.nutXF = p.nutXF.slice(); ART.bridgeXF = p.bridgeXF.slice();
        ART.fit = p.fit || null; ART.bottomAnchor = p.bottomAnchor || 0.95;
        ART.warp = p.warp || 0; ART.persp = p.persp || 0;
      }
      return;
    }
    // per-string arrays (measured preferred; legacy [left,right] endpoints fan via the resampler)
    const nut = _resampleStrings(g.nutXF || [g.nut[0], g.nut[1]], LANE_COUNT);
    const brg = _resampleStrings(g.bridgeXF || [g.bridge[0], g.bridge[1]], LANE_COUNT);
    ART.aspect = g.aspect; ART.nutFY = g.nutFY; ART.bridgeFY = g.bridgeFY;
    // build16 (5-STRING ASSET DECREE, first true-5 deliveries): when the art paints EXACTLY
    // LANE_COUNT strings, the lanes ride the MEASURED painted strings — the guitar5 ideal; the
    // engine's drawn strings land ON the art's. The build13 EVEN FAN (×laneSpread) survives ONLY
    // for count-mismatch art (legacy 6-string renders), where painted matching is impossible and
    // alignment-to-ARM is the contract.
    const exact = !!(g.nutXF && g.nutXF.length === LANE_COUNT && g.bridgeXF && g.bridgeXF.length === LANE_COUNT);
    if (exact) {
      ART.nutXF = nut; ART.bridgeXF = brg;
    } else {
      const spread = g.laneSpread != null ? g.laneSpread : 1.16;
      const fan = (arr) => {
        const a0 = arr[0], aN = arr[arr.length - 1];
        const mid = (a0 + aN) / 2, half = Math.abs(aN - a0) / 2 * spread;
        const out = [];
        for (let i = 0; i < LANE_COUNT; i++) out.push(mid - half + 2 * half * (LANE_COUNT > 1 ? i / (LANE_COUNT - 1) : 0.5));
        return out;
      };
      ART.nutXF = fan(nut); ART.bridgeXF = fan(brg);
    }
    ART.fit = 'cover'; ART.bottomAnchor = g.bottomAnchor || 0.93;
    // build25 (PLAYTEST: themed levels played cramped + hard to read vs the default Crimson level):
    // a skin draws FULL-BLEED like the default — the build13 skinWF shrink (0.78/0.92) was making
    // the guitar (and therefore the lanes + notes) ~40% smaller, the root of "items too small / hard
    // to hit". The playable fan is floored to the default's comfortable span in fretGeom(), so every
    // level now feels like Crimson regardless of how tightly the skin's painted strings cluster.
    ART.skinWF = 0;
    ART.warp = (p && p.warp) || 0.2;   // match the default highway's neck-recede (was 0.34 → far notes bunched, hurt readability)
    // ART.persp stays the profile's — the note depth/vertigo feel is identical on every guitar.
    _skinArtOn = true;
  }
  // build26: a skin is only allowed to drive the play surface if it is VERIFIED (see SKIN_GEOM).
  function _skinVerified(src) { return !!(src && SKIN_GEOM[src] && SKIN_GEOM[src].verified); }
  function _applySkinImg(src) {
    // STANDARD GATE: falsy OR unverified art → canonical crimson surface (image + lanes). This is what
    // guarantees the strings-on-guitar illusion on EVERY level: only template-framed, measurement-passing
    // guitars are ever drawn as the playable neck; flat/narrow art can never detach the lanes again.
    if (!src || !_skinVerified(src)) {
      if (src && !_skinVerified(src)) { try { console.warn('[rr] guitar skin not verified for play surface, using canonical:', src); } catch (e) {} }
      activeGuitarImg = _profileDefaultImg(); _applySkinGeom(null); return;
    }
    const im = new Image(); im._ready = false;
    im.onload = () => { im._ready = true; };
    im.onerror = () => { if (activeGuitarImg === im) { activeGuitarImg = _profileDefaultImg(); _applySkinGeom(null); } };  // self-heal: missing skin → profile default img + geom
    im.src = src;
    activeGuitarImg = im;            // draw site guards on _ready, so a not-yet-loaded image just skips a frame
    _applySkinGeom(src);            // build8.1: align catchers/notes to THIS skin's painted strings
  }
  // Per-level override (temporary). Pass falsy to drop the override → back to equipped/default.
  function setGuitarSkin(src) {
    // build60 (user): Settings "Guitar on Levels" — 'mine' (default) = the player's EQUIPPED guitar wins on ANY level
    // (a level's guitarSkin is only its default); 'level' = use the level's own themed guitar. Takes effect on next launch.
    if (src) { _levelSkinActive = true; _applySkinImg((levelGuitarPref === 'level') ? src : (equippedSkinSrc || src)); }
    else { _levelSkinActive = false; _applySkinImg(equippedSkinSrc); }
  }
  // Equip a skin globally (persisted). Pass falsy to clear the equip (back to default).
  function equipGuitarSkin(src) {
    equippedSkinSrc = src || null;
    try { if (equippedSkinSrc) localStorage.setItem(SKIN_STORE, equippedSkinSrc); else localStorage.removeItem(SKIN_STORE); } catch (e) {}
    if (!_levelSkinActive) _applySkinImg(equippedSkinSrc);   // don't stomp an active per-level skin
  }
  // Re-assert the equipped skin (used on game start + after a level clears its override).
  function applyEquippedSkin() {
    _levelSkinActive = false;
    try { equippedSkinSrc = localStorage.getItem(SKIN_STORE) || null; } catch (e) { equippedSkinSrc = null; }
    _applySkinImg(equippedSkinSrc);
  }
  // boot the equipped skin (bootLaneProfile runs applyLaneProfile later, so reading storage now is safe)
  try { equippedSkinSrc = localStorage.getItem(SKIN_STORE) || null; } catch (e) { equippedSkinSrc = null; }
  window.RhythmGame = window.RhythmGame || {};
  window.RhythmGame.setGuitarSkin = setGuitarSkin;       // per-level temporary override
  window.RhythmGame.equipGuitarSkin = equipGuitarSkin;   // global persisted equip
  window.RhythmGame.applyEquippedSkin = applyEquippedSkin;
  window.RhythmGame.getEquippedSkin = () => equippedSkinSrc;
  // P0 store guard: is this guitar a usable PLAY SURFACE? no-src/default + skins the engine doesn't know = ok; a
  // KNOWN-unverified skin is NOT (it would fall back to crimson). The store uses this to never sell a broken skin.
  window.RhythmGame.isSkinPlayable = (src) => (!src || !SKIN_GEOM[src] || !!SKIN_GEOM[src].verified);
  // Carnival high-striker mechanic: ringing the bell banks a chunk of Overdrive (clamped 0..1).
  window.RhythmGame.chargeOverdrive = (amt) => { try { overdrive = Math.min(1, overdrive + (typeof amt === 'number' ? amt : 0.2)); if (typeof updateHUD === 'function') updateHUD(); } catch (e) {} return (typeof overdrive === 'number' ? overdrive : 0); };
  // ---- GH guitar calibration (PUBLIC — survives content-freeze; the future in-Settings wizard reuses these) ----
  // padState() = live raw button/axis snapshot so you can SEE which index your guitar uses (watch which
  // button flips when you strum, which axis moves when you whammy/tilt). Then setStrumCfg({...}) writes it.
  window.RhythmGame.padState = () => { try { const out = []; const pads = navigator.getGamepads ? navigator.getGamepads() : []; for (const gp of pads) { if (!gp) continue; out.push({ index: gp.index, id: gp.id, isGuitar: isGuitarPad(gp.id), buttons: Array.from(gp.buttons).map((b, i) => b.pressed ? i : null).filter(v => v !== null), axes: Array.from(gp.axes).map(v => +(+v).toFixed(2)) }); } return out; } catch (e) { return 'ERR ' + e.message; } };
  window.RhythmGame.getStrumCfg = () => Object.assign({}, strumCfg);
  window.RhythmGame.setStrumCfg = (partial) => { try { strumCfg = Object.assign(strumCfg, partial || {}); saveStrumCfg(); } catch (e) {} return Object.assign({}, strumCfg); };
  window.RhythmGame.requireStrum = () => { try { return requireStrum(); } catch (e) { return false; } };

  // ---------- SHARED, UNLOCKABLE AUDIO CONTEXT (mobile autoplay) ----------
  let sharedAC = null;
  function getAC() {
    if (!sharedAC) sharedAC = new (window.AudioContext || window.webkitAudioContext)();
    if (sharedAC.state === 'suspended') { try { sharedAC.resume(); } catch (e) {} }
    return sharedAC;
  }
  function unlockAudio() {
    try {
      const ac = getAC();
      const b = ac.createBuffer(1, 1, 22050);
      const s = ac.createBufferSource();
      s.buffer = b; s.connect(ac.destination); s.start(0);
    } catch (e) {}
    loadHitSfx();
  }
  // ---- hit SFX: a real palm-mute guitar chug, decoded once into a buffer for zero-latency,
  // overlapping playback. Replaces the old synth beep. (Falls back to the beep if it can't load.)
  let hitBuffer = null, missBuffer = null, hitSfxTried = false;
  // build157: real sampled hero SFX (Suno one-shots per RR_AUDIO_DIRECTION.md), decoded once in loadHitSfx below.
  let odIgniteBuffer = null, shieldSaveBuffer = null, comboFlareBuffer = null, clearFanfareBuffer = null;
  let _lastPct = -1, _lastSec = -1;   // build71: per-frame HUD-write change-gate (progress bar / time) — only touch the DOM when the whole-percent or whole-second changes (self-heals on restart since pct/sec differ from the prior song)
  // SFX_LEVEL is declared near the top (settings block) so persisted prefs can set it before this point.
  function loadHitSfx() {
    if (hitSfxTried) return;
    hitSfxTried = true;
    const load = (url, set) => fetch(url).then(r => { if (!r.ok) throw new Error('sfx ' + r.status); return r.arrayBuffer(); })   // build71: a 404 would otherwise feed an HTML error page to decodeAudioData; the throw lands in the existing .catch (buffer stays null, playback already guarded)
      .then(buf => getAC().decodeAudioData(buf, set, () => {})).catch(() => {});
    load('assets/hit-chug.mp3', d => { hitBuffer = d; });
    load('assets/miss-squelch.mp3', d => { missBuffer = d; });   // GH-style "clam" on a miss
    // build157: the four Suno-made hero stingers — each falls back to its procedural cue if it can't load (see playBufferSfx)
    load('assets/overdrive-ignite.mp3', d => { odIgniteBuffer = d; });    // Star-Power activation slam
    load('assets/shield-save.mp3',      d => { shieldSaveBuffer = d; });   // Flow-Shield SAVED "coin-catch"
    load('assets/combo-flare.mp3',      d => { comboFlareBuffer = d; });   // combo-milestone chime
    load('assets/clear-fanfare.mp3',    d => { clearFanfareBuffer = d; }); // level-clear victory sting
  }
  // miss "squelch" — like GarageBand/Guitar Hero clamming a note. Music stays at full level.
  function playMissSfx(heavy) {
    if (muted || !missBuffer) return;
    try {
      const ac = getAC();
      // build35 (audit P1): scale the miss squelch by the Hit-Sound mixer (was a hardcoded 0.5 ≈ 10×
      // a hit at the default level, and it ignored the Settings slider). ~1.6× a perfect hit, capped.
      // build60 FEEL: `heavy` (a high streak just broke) → louder + pitched-down for a gut-punch squelch. Still mixer/mute-gated.
      const g = ac.createGain(); g.gain.value = Math.min(heavy ? 0.62 : 0.5, SFX_LEVEL * (heavy ? 2.1 : 1.6));
      const s = ac.createBufferSource(); s.buffer = missBuffer;
      if (heavy) { try { s.playbackRate.value = 0.85; } catch (e) {} }   // drop the pitch → heavier "clam"
      s.connect(g); g.connect(ac.destination); s.start(ac.currentTime);
    } catch (e) {}
  }
  // build85 (Phase 3.3): a short dry "tick" for an EMPTY press — distinct from the miss squelch, mute + SFX-mixer gated.
  function playWhiffSfx() {
    if (muted) return;
    try {
      const ac = getAC(); const now = ac.currentTime;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(150, now);
      o.frequency.exponentialRampToValueAtTime(70, now + 0.05);
      g.gain.setValueAtTime(Math.min(0.12, SFX_LEVEL * 0.6), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      o.connect(g); g.connect(ac.destination); o.start(now); o.stop(now + 0.08);
    } catch (e) {}
  }
  // Overdrive activation: a short synthesized power-up riser (no asset needed).
  // Gated by mute; rides at a Hit-Sound-mixer-scaled level so it accents over the music (build71: was a fixed 0.22).
  function playOverdriveSfx() {
    if (muted) return;
    try {
      const ac = getAC(); const now = ac.currentTime;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, Math.min(0.3, SFX_LEVEL * 2.6)), now + 0.05);   // build71: scale by the Hit-Sound mixer (was fixed 0.22 → blasted even at SFX 0%; ~0.13 at default 0.05, silent at 0)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      g.connect(ac.destination);
      // two detuned saws sweeping up = a bright riser
      [0, 7].forEach((semi, i) => {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        const base = 220 * Math.pow(2, semi / 12);
        o.frequency.setValueAtTime(base, now);
        o.frequency.exponentialRampToValueAtTime(base * 4, now + 0.45);
        const og = ac.createGain(); og.gain.value = i ? 0.5 : 0.7;
        o.connect(og); og.connect(g);
        o.start(now); o.stop(now + 0.55);
      });
    } catch (e) {}
  }
  // build109 s3: OD activation WIND-UP pre-charge tone — a short, quiet rising pitch stinger that plays
  // the instant the player commits (Space/tilt/pad), BEFORE the full payoff riser (playOverdriveSfx)
  // fires ~140ms later. Single sine ramp, low gain — reads as anticipation, not a duplicate activation.
  function playOdIgniteSfx() {
    if (muted) return;
    try {
      const ac = getAC(); const now = ac.currentTime, dur = ODIGNITE_MS / 1000;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, Math.min(0.16, SFX_LEVEL * 1.4)), now + dur * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      g.connect(ac.destination);
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(520, now);
      o.frequency.exponentialRampToValueAtTime(1180, now + dur);
      o.connect(g); o.start(now); o.stop(now + dur);
    } catch (e) {}
  }
  // build157: play a decoded sampled SFX buffer through a mute + Hit-Sound-mixer-gated gain node (the exact pattern
  // playMissSfx uses). `mult`/`cap` mirror the other cues (gain = min(cap, SFX_LEVEL*mult)); returns false if it
  // couldn't play (muted or buffer not yet decoded) so callers can fall back to the procedural cue.
  function playBufferSfx(buf, mult, cap, rate) {
    if (muted || !buf) return false;
    try {
      const ac = getAC();
      const g = ac.createGain(); g.gain.value = Math.max(0.0001, Math.min(cap, SFX_LEVEL * mult));
      const s = ac.createBufferSource(); s.buffer = buf;
      if (rate && rate !== 1) { try { s.playbackRate.value = rate; } catch (e) {} }
      s.connect(g); g.connect(ac.destination); s.start(ac.currentTime);
      return true;
    } catch (e) { return false; }
  }
  function playShieldSaveSfx() { if (!playBufferSfx(shieldSaveBuffer, 2.4, 0.36)) playOdIgniteSfx(); }   // Flow-Shield SAVED → real "coin-catch", else the procedural ignite
  function playOverdriveHitSfx() { if (!playBufferSfx(odIgniteBuffer, 2.8, 0.42)) playOverdriveSfx(); }  // Star-Power engage → real slam, else the procedural riser
  function playComboFlareSfx() { return playBufferSfx(comboFlareBuffer, 1.7, 0.28); }                    // combo milestone — small, fires often; silent if not loaded (additive; no prior sound here)
  function playClearFanfareSfx() { return playBufferSfx(clearFanfareBuffer, 3.2, 0.5); }                 // level clear — big; caller falls back to the procedural sting if this returns false
  // v257 SOUND DESIGN: procedural ZAP (P-vs-P combat shock) — a noise crackle through a sweeping bandpass + a pitch-dropping
  // square = an electric "you got shocked" hit. `incoming` (you were zapped) is harsher/longer than the sender's crackle.
  function playZapSfx(incoming) {
    if (muted) return;
    try {
      const ac = getAC(), now = ac.currentTime, dur = incoming ? 0.5 : 0.26;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, Math.min(0.4, (incoming ? 6.8 : 4) * SFX_LEVEL)), now + 0.02);   // build71: pure mixer-scaled (was +floor 0.05 → audible at SFX 0%; identical to before at the default 0.05)
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      g.connect(ac.destination);
      const nb = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * dur)), ac.sampleRate), nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
      const ns = ac.createBufferSource(); ns.buffer = nb;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
      bp.frequency.setValueAtTime(incoming ? 2600 : 3200, now);
      bp.frequency.exponentialRampToValueAtTime(incoming ? 220 : 640, now + dur);
      ns.connect(bp); bp.connect(g); ns.start(now); ns.stop(now + dur);
      const o = ac.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(incoming ? 900 : 1300, now);
      o.frequency.exponentialRampToValueAtTime(incoming ? 90 : 280, now + dur * 0.9);
      const og = ac.createGain(); og.gain.value = 0.22; o.connect(og); og.connect(g); o.start(now); o.stop(now + dur);
    } catch (e) {}
  }
  // v257 SOUND DESIGN: a bright ascending major-arpeggio STING for tier-up / rank-up / encore moments. 'big' = a longer run.
  function playStingSfx(kind) {
    if (muted) return;
    try {
      const ac = getAC(), now = ac.currentTime;
      const notes = kind === 'big' ? [0, 4, 7, 12, 16, 19] : [0, 4, 7, 12], root = 392;   // G major-ish
      const master = ac.createGain(); master.gain.value = Math.min(0.3, 3.6 * SFX_LEVEL); master.connect(ac.destination);   // build71: pure mixer-scaled (was +floor 0.08; ~0.18 at default, silent at 0)
      notes.forEach((semi, i) => {
        const t = now + i * 0.052;
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = root * Math.pow(2, semi / 12);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.32, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.44);
      });
    } catch (e) {}
  }
  // v259 SOUND DESIGN: procedural CROWD CHEER / applause for the encore (no asset file needed) — dense band-passed noise with
  // sparse clap transients swelling up + a couple of rising "whoo" formants. Used when no real crowd-cheer.mp3 is loaded.
  function playCheerSfx() {
    if (muted) return;
    try {
      const ac = getAC(), now = ac.currentTime, dur = 1.9;
      const nb = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * dur)), ac.sampleRate), nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) { let v = Math.random() * 2 - 1; if (Math.random() < 0.0045) v *= 4; nd[i] = v; }   // applause = noise + sparse clap spikes
      const ns = ac.createBufferSource(); ns.buffer = nb;
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
      const g = ac.createGain(), lvl = Math.max(0.0001, Math.min(0.4, 3.2 * SFX_LEVEL));   // build71: mixer-scaled (was +floor 0.16; ~0.16 at default, silent at 0; 0.0001 floor for the exponential ramp below)
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(lvl, now + 0.28);            // the crowd rises
      g.gain.setValueAtTime(lvl, now + 1.15);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);          // ...and fades
      ns.connect(hp); hp.connect(bp); bp.connect(g); g.connect(ac.destination);
      ns.start(now); ns.stop(now + dur);
      [520, 660].forEach((f) => {
        const o = ac.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.8, now + 0.1); o.frequency.linearRampToValueAtTime(f, now + 0.55);
        const og = ac.createGain(); og.gain.setValueAtTime(0.0001, now + 0.1);
        og.gain.exponentialRampToValueAtTime(Math.max(0.0001, Math.min(0.05, SFX_LEVEL)), now + 0.45); og.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);   // build71: the "whoo" formants bypass the master gain → scale them by the mixer too (silent at SFX 0%)
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
        o.connect(og); og.connect(lp); lp.connect(ac.destination); o.start(now + 0.1); o.stop(now + 1.05);
      });
    } catch (e) {}
  }
  window.RhythmGame.playZap = (incoming) => { try { playZapSfx(!!incoming); } catch (e) {} };
  window.RhythmGame.playSting = (kind) => { try { playStingSfx(kind); } catch (e) {} };
  window.RhythmGame.playCheer = () => { try { playCheerSfx(); } catch (e) {} };
  // build109 s1: MP winner celebration reuse hook — fires the same confetti/firework burst as solo
  // results (celebrateResults) but targeting an arbitrary DOM element (the MP winner card).
  window.RhythmGame.fireCelebration = (targetEl, opts) => { try { fireCelebrationOn(targetEl, opts); } catch (e) {} };
  window.RhythmGame.stopCelebration = () => { try { stopCelebrationOn(); } catch (e) {} };
  window.RhythmGame.shakeScreen = (amt) => { try { cameraShake = Math.max(cameraShake, (typeof amt === 'number' ? amt : 10)); } catch (e) {} };
  // first user gesture anywhere unlocks audio for the session
  ['pointerdown', 'touchstart', 'keydown'].forEach(ev =>
    window.addEventListener(ev, unlockAudio, { once: true, passive: true }));

  // ===========================================================================
  // PLAYER ABSTRACTION
  // ===========================================================================
  // DemoPlayer: precise WebAudio buffer playback for the local/offline track.
  class DemoPlayer {
    constructor(buffer) {
      this.buffer = buffer;
      this.duration = buffer.duration;
      this.ctx = null; this.src = null; this.gain = null;
      this._start = 0; this._pausedAt = null; this._pauseAccum = 0;
      this.onended = null;
      // PRACTICE MODE (additive; default 1 = byte-identical). Playback rate speeds/slows the AudioBufferSourceNode.
      // getTime() must return SONG-BUFFER time (the position within the decoded track), so real-elapsed seconds
      // are multiplied by _rate. Pitch shifts with rate — accepted for practice drilling (no time-stretch lib).
      this._rate = 1;
    }
    // call BEFORE play() — a live source node's playbackRate could be ramped, but practice sets the rate once per arm.
    setRate(r) { this._rate = (typeof r === 'number' && r > 0) ? Math.max(0.25, Math.min(4, r)) : 1; if (this.src) { try { this.src.playbackRate.value = this._rate; } catch (e) {} } }
    async prepare() {}
    play(offset) {
      // PRACTICE: a (re)play is a FRESH timeline — clear any pause bookkeeping from a prior play on this SAME instance
      // (the practice fast re-arm reuses one DemoPlayer via stop()→play(); a stale _pauseAccum/_pausedAt would corrupt
      // getTime() → the section-end clock never matches). A first-launch instance has these at 0 already, so this is a
      // no-op on every existing (non-practice) path — byte-identical.
      this._pausedAt = null; this._pauseAccum = 0;
      this.ctx = getAC(); // shared, already unlocked by a user gesture
      this.src = this.ctx.createBufferSource();
      this.src.buffer = this.buffer;
      try { this.src.playbackRate.value = this._rate; } catch (e) {}   // PRACTICE: apply the chosen speed to the buffer
      this.gain = this.ctx.createGain();
      this.gain.gain.value = muted ? 0 : musicVol;
      this.src.connect(this.gain); this.gain.connect(this.ctx.destination);
      // audio-reactive tap — additive, does NOT change the audio reaching the speakers
      try { musicAnalyser = this.ctx.createAnalyser(); musicAnalyser.fftSize = 256; musicAnalyser.smoothingTimeConstant = 0.78; this.src.connect(musicAnalyser); musicFreq = new Uint8Array(musicAnalyser.frequencyBinCount); } catch (e) { musicAnalyser = null; musicFreq = null; }
      const when = this.ctx.currentTime + 0.12;
      // build102t (additive; default 0 = byte-identical): optional mid-buffer start offset so a live-show
      // SPECTATOR joining mid-run can lock onto the shared clock. getTime() stays absolute song time because
      // _start is back-dated by the offset. PRACTICE reuses this SAME offset primitive to seek to a section start.
      const off = (typeof offset === 'number' && offset > 0) ? Math.min(offset, Math.max(0, this.duration - 0.05)) : 0;
      this.src.start(when, off);
      // _start is the real-clock instant that maps to song-buffer position 0. With a non-unit rate, song-buffer
      // time = (realElapsed) * rate + off; we fold `off` in by back-dating _start by off/rate real-seconds.
      this._start = when - off / this._rate;
      this.src.onended = () => { if (this.onended) this.onended(); };
    }
    getTime() {
      if (!this.ctx) return -3;
      const real = (this._pausedAt != null ? this._pausedAt : this.ctx.currentTime) - this._start - this._pauseAccum;
      return real * this._rate;   // PRACTICE: real seconds → song-buffer seconds at the current rate (rate 1 = identity)
    }
    getDuration() { return this.duration; }
    pause() { if (!this.ctx) return; this._pausedAt = this.ctx.currentTime; try { this.ctx.suspend(); } catch (e) {} }
    resume() { if (this._pausedAt == null) return; this._pauseAccum += this.ctx.currentTime - this._pausedAt; this._pausedAt = null; try { this.ctx.resume(); } catch (e) {} }
    setMuted(m) { if (this.gain) this.gain.gain.value = m ? 0 : musicVol; }
    setGain(v) { if (this.gain && this.ctx) { try { this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.012); } catch (e) { this.gain.gain.value = v; } } }
    stop() {
      if (this.src) { try { this.src.onended = null; this.src.stop(); } catch (e) {} }
      // build65 (cycle-4): explicitly DISCONNECT the per-play subgraph from the shared ctx.destination (hygiene — the nodes
      // are GC-eligible once dropped, but detach them so a stale subgraph can't linger attached). Do NOT close the shared ctx.
      try { this.src && this.src.disconnect(); } catch (e) {}
      try { this.gain && this.gain.disconnect(); } catch (e) {}
      try { musicAnalyser && musicAnalyser.disconnect(); } catch (e) {}
      if (this.ctx && this.ctx.state === 'running') { try { this.ctx.resume(); } catch (e) {} }
      musicAnalyser = null; musicFreq = null;
      this.ctx = null; this.src = null; this.gain = null;
    }
  }
  // expose so catalog.js HlsPlayer can share the muted flag + interface contract
  window.RhythmGame = window.RhythmGame || {};
  window.RhythmGame.DemoPlayer = DemoPlayer;
  window.RhythmGame.isMuted = () => muted;
  window.RhythmGame.__render = (n) => { for (let i = 0; i < (n || 1); i++) render(0.016, false); };

  // Quantize an arbitrary time to the nearest STRONG onset in `beats` within ±win seconds, so
  // variety inserts land ON THE BEAT instead of floating. Returns the input unchanged if no onset
  // is near. Pure + side-effect-free; beats = [{t,strength}] ascending.
  function snapToOnset(t, win) {
    win = win || 0.14;
    let bestT = t, bestScore = -1;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const dt = b.t - t;
      if (dt < -win) continue;
      if (dt > win) break;                       // beats ascending → safe early-break
      const sc = (b.strength || 1) - Math.abs(dt) * 6;
      if (sc > bestScore) { bestScore = sc; bestT = b.t; }
    }
    return bestT;
  }

  // ===========================================================================
  // CHART -> NOTES (server-matched difficulty filter + deterministic lanes)
  // ===========================================================================
  function buildNotes() {
    const step = DIFF_STEP[difficulty];
    // build148 T8 (Fable RIFT/Expert tier): RIFT reproduces the pre-build141 BRUTAL Hard chart. Every lever below
    // that build141 softened is restored for RIFT only via `_rift ? <brutal> : <existing>` (so easy/medium/hard stay
    // byte-identical). `_hardLike` = the two dense tiers that share Hard's FEATURE set (bombs, note rows, chords,
    // fast pairs, tight trill/pattern gates). RIFT falls into the plain else of any `easy?…:medium?…:…` chain, which
    // already gives it Hard's value — so only the explicitly-softened `=== 'hard'` sites need a rift branch.
    const _rift = (difficulty === 'rift');
    const _hardLike = (difficulty === 'hard' || _rift);
    // Guitar-Hero-style difficulty ramp: Easy uses fewer, CENTERED strings; Medium/Hard use all 5
    // (span clamps to LANE_COUNT=5 → inSpan is the identity, so Medium/Hard charts are unchanged). Defined up
    // front so the downstream chord/bomb passes (which reference span/laneBase/inSpan) work in BOTH chart modes.
    // build70 (launch-audit P3): Easy was span 4 → laneBase floor((5-4)/2)=0 → lanes 0..3, i.e. BOTTOM-biased with
    // the top string dead (the "centered" comment was a lie on a 5-lane neck). span 3 → laneBase 1 → lanes 1,2,3:
    // a genuinely centered, symmetric 3-string on-ramp. Note count is gap-driven (MINGAP), not lane-driven, so this
    // doesn't make Easy "blanker" — it just stops scattering a beginner across an off-centre 4-wide span.
    const LANE_SPAN = { easy: 3, medium: 6, hard: 6, rift: 6 };
    const span = Math.min(LANE_SPAN[difficulty] || LANE_COUNT, LANE_COUNT);   // never exceed lane count (5-string safe)
    const laneBase = Math.floor((LANE_COUNT - span) / 2);                          // centered active window
    const inSpan = (l) => laneBase + ((((l - laneBase) % span) + span) % span);    // wrap any index into the active set
    // build104 s5: PING-PONG reflection — walk an out-of-span index back the way it came (…2,3,4,3,2…) instead of
    // the modulo wrap's 4→0 leap. Used by the stair/zipper shapes so a sweep off the top string DESCENDS like a
    // real run instead of teleporting across the neck.
    const reflect = (l) => {
      const s1 = span - 1;
      if (s1 <= 0) return laneBase;
      const m = (((l - laneBase) % (2 * s1)) + 2 * s1) % (2 * s1);
      return laneBase + (m <= s1 ? m : 2 * s1 - m);
    };
    // MINGAP hoist (Fable v2): the canonical per-difficulty onset gap table lives here now (was inline in the musical
    // density pass) so the trill + stair/zipper gates below read the SAME source. Those two sites hardcoded a stale
    // hard:0.22 that build141's hard:0.30 softening missed — hoisting fixes them (behavior change for hard's trill/
    // stair gates is INTENDED; medium/easy/rift are unchanged since their table values already matched).
    const MINGAP = { easy: 0.50, medium: 0.38, hard: 0.30, rift: 0.22 };
    const MINGAP_D = MINGAP[difficulty] || 0.22;
    // MUSICAL mode (build57) needs centroid-tagged onsets from analyzeMusical; if a fallback produced
    // plain (centroid-less) onsets, degrade to the classic placer so a track is never left unplayable.
    const musical = (chartMode === 'musical') && beats.length && (typeof beats[0].centroid === 'number');
    let last = -1, last2 = -1;
    // build104 s4: GRID TRUST — before the tempo grid is allowed to MOVE notes (snap) or privilege on-grid onsets
    // (effOf weighting / downbeat bonuses), measure whether the song's STRONG onsets actually CONCENTRATE on that
    // grid. Statistic = the circular resultant R of the onset residuals on the half-beat grid (0 = uniform/no
    // beat relation, 1 = metronome) — tolerance-free, so ±30ms onset-detector jitter doesn't drown the signal the
    // way a fixed ±48ms count did (measured: tolerance-counting scored a locked 130bpm track at random-chance).
    // Trust needs R ≥ 0.25 AND the two song HALVES to agree (a mid-song tempo change/drift passes a whole-song
    // average while wrecking one half — the #7 stopgap). VERIFIED against this catalog: AI-generated tracks
    // genuinely wobble (R ≤ 0.17 across genres, no candidate period fits their raw onsets), so most of the
    // library correctly fails OPEN — notes chart on the audio's real transients instead of being dragged onto a
    // fictional lattice. A metronome-true track (R ≥ 0.25) still earns snapping + grid privilege.
    let _gridFit = null, _gridFitA = null, _gridFitB = null, _gridTrust = false;
    {
      const perG = beats._period || 0, phG = beats._phase || 0;
      if (perG > 0 && beats.length) {
        const halfB = perG / 2;
        let strong = beats.filter(b => (b.strength || 1) >= 1.2);
        if (strong.length < 20) strong = beats.slice();
        const rOf = (arr) => {
          if (arr.length < 10) return null;
          let sx = 0, sy = 0, sw = 0;
          for (const b of arr) {
            const r = (((b.t - phG) % halfB) + halfB) % halfB;
            const a = (r / halfB) * 2 * Math.PI, w = b.strength || 1;
            sx += Math.cos(a) * w; sy += Math.sin(a) * w; sw += w;
          }
          return sw > 0 ? Math.sqrt(sx * sx + sy * sy) / sw : null;
        };
        const durG = beats[beats.length - 1].t || 0;
        const fA = rOf(strong.filter(b => b.t < durG / 2));
        const fB = rOf(strong.filter(b => b.t >= durG / 2));
        const fAll = rOf(strong);
        _gridFit = fAll == null ? null : Math.round(fAll * 1000) / 1000;
        _gridFitA = fA == null ? null : Math.round(fA * 1000) / 1000;
        _gridFitB = fB == null ? null : Math.round(fB * 1000) / 1000;
        const agree = !((fA != null && fB != null) && ((fA >= 0.25) !== (fB >= 0.25)));
        _gridTrust = (fAll != null && fAll >= 0.25 && agree);
      }
    }
    if (musical) {
      // DYNAMIC DENSITY: keep onsets on a difficulty-scaled min-gap, but let a clearly stronger / on-beat
      // onset BUMP a weaker recent pick — so busy passages stay busy, quiet ones breathe, and emphasis
      // lands on the beat. Bounded by the min-gap so it never becomes unplayable.
      // build59: Medium dialed back from 0.235 (≈4.3 notes/sec) — playtesters found Medium too rapid/scattered.
      // CHANGE 3a — raise every floor (was {0.45,0.33,0.155}) so the baseline chart is sparser and more readable
      // across the board; the "barrage" complaint was largely Hard packing ~6.4 nps. Now ≈ 2 / 2.5 / 4.5 nps.
      // MINGAP hoisted to buildNotes scope (Fable v2).   // build148 T8: RIFT restores the pre-build141 brutal 0.22 (~4.5 onsets/s wall) · v253 (research): Medium 0.34→0.38 — 0.34 allowed ~2.9 onsets/s (real-GH HARD territory); ease toward real-GH Medium ~2.4/s. build141 (beta data): Hard 0.22→0.30 — 0 of 22 Hard runs cleared 90%, max-combo only ~6% of chart; 0.22 packed ~4.5 onsets/s = an unsustainable wall. 0.30 caps ~3.3/s so a competent player can actually hold a streak. Easy/Medium unchanged.
      // v253 (research): a CAMPAIGN BOSS stage is "Hard-MINUS", not raw Hard — the boss complaint ("I shouldn't be crying at
      // the end of the level") is no-release + density, not speed (we're already ~5× below GH-boss NPS). When the LAUNCHED
      // level is a boss (_levelCtx.boss, set by launchLevel→setLevelContext), widen the Hard min-gap and lower the sustained
      // NPS ceiling so the chart breathes. Free-play Hard (no level ctx) and boss-as-free-play-environment (synthetic
      // ctx → boss:false) are deliberately NOT eased — only the ranked campaign run.
      let _bossStage = false; try { _bossStage = !!(_levelCtx && _levelCtx.boss); } catch (e) { _bossStage = false; }
      const baseGap = (MINGAP[difficulty] || 0.22) * (_bossStage ? 1.18 : 1);   // v258: ANY campaign boss gets the gap ease (Hard 0.22→0.26, the medium Shorty-X 0.38→0.45) — not just Hard
      // SECTION-AWARE density — tighten the gap in loud passages, open it in quiet breakdowns. The *tightening* floor is
      // difficulty-scaled: Hard can pack a loud chorus (0.8×), but Medium/Easy barely tighten (0.95×/1.0×) so a loud
      // passage can't spike a casual chart past its comfortable ceiling. Opening (quiet → sparser) is shared.
      // CHANGE 3b — let QUIET passages open further (cap 1.5→2.0×) so breakdowns genuinely breathe instead of
      // staying as dense as the verses; the loud-section tighten floor is unchanged.
      let eMax = 0; for (let i = 0; i < beats.length; i++) { const e = beats[i].energy || 0; if (e > eMax) eMax = e; }
      const tightenFloor = _hardLike ? 0.8 : difficulty === 'medium' ? 0.97 : 1.0;   // v253: Medium 0.95→0.97 — loud choruses tighten less (kills the chorus density spike that read as "too challenging")
      const gapFor = (b) => { const e = eMax > 0 ? (b.energy || 0) / eMax : 0.5; return baseGap * Math.max(tightenFloor, Math.min(2.0, 1.4 - 0.6 * e)); };
      // CHANGE 5 — privilege STRONG beats: when deciding whether a new onset should bump the recent pick out of its
      // gap-window, compare EFFECTIVE strength (downbeats ×1.6, on-grid ×1.3) — so emphasis lands on the beat, not on
      // whatever transient happened to be loudest. Also used to pick the weakest onset to drop under the NPS cap below.
      const effOf = (b) => (b.strength || 1) * (_gridTrust ? (b.downbeat ? 1.6 : b.onGrid ? 1.3 : 1.0) : 1.0);   // build104 s4: grid privilege only when the grid is TRUSTED (see gridTrust above)
      let filtered = [];
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        if (!filtered.length) { filtered.push(b); continue; }
        const prev = filtered[filtered.length - 1];
        const gap = gapFor(b);
        if (b.t - prev.t >= gap) filtered.push(b);
        // build58: the strongest onset in each gap-window wins the slot. CHANGE 5: by EFFECTIVE strength (on-beat
        // onsets are privileged), or always for a downbeat.
        else if (effOf(b) > effOf(prev) * 1.35 || b.downbeat) filtered[filtered.length - 1] = b;
      }
      // CHANGE 1 — BEAT QUANTIZATION (the key readability fix). The analyzer tagged onGrid/downbeat but never MOVED a
      // note, so each sat ±10–40 ms off the pulse → the chart never locked to the song. Snap each onset to the tempo
      // sub-grid when it's already close (within 18% of a beat — a real onset, not a syncopation we'd be inventing).
      // Easy snaps to 1/2-beats (eighths feel), Medium/Hard to 1/4-beats (sixteenths) so fast runs still resolve.
      const per = beats._period || 0, ph = beats._phase || 0;
      const sub = per / (difficulty === 'easy' ? 2 : 4);
      // build104 s4: BOUNDED snapping — the old 0.18·period gate could move a note ±139ms at 78bpm, i.e. past the
      // Medium PERFECT half-window (0.16·0.30 = ±48ms): the snap itself could carry a note across a judgment
      // boundary the player then got graded against. The gate is now min(0.10·period, 48ms), so a snapped note can
      // never be displaced past the tightest half-window in play. Skipped entirely when the grid isn't trusted.
      if (_gridTrust && per > 0 && sub > 0) {
        const snapTol = Math.min(0.10 * per, 0.048);
        for (let i = 0; i < filtered.length; i++) {
          const t = filtered[i].t;
          const g = ph + Math.round((t - ph) / sub) * sub;
          if (Math.abs(t - g) < snapTol) {
            // clone so we never mutate the shared source onset (it may be reused if buildNotes re-runs)
            filtered[i] = Object.assign({}, filtered[i], { t: Math.round(g * 1000) / 1000 });
          }
        }
        filtered.sort((a, b) => a.t - b.t);
      }
      // CHANGE 3c — SLIDING-WINDOW NPS CAP: even after the min-gap, a busy bar can spike past readability. In any 1.0 s
      // window exceeding the per-difficulty cap, drop the weakest onsets (off-grid first, then lowest effective strength)
      // until the window is within budget. This is what actually flattens the "barrage" peaks.
      const _npsBase = { hard: 4, medium: 3, easy: 2, rift: 5 }[difficulty] || 3;   // build141 (beta data): Hard 5→4 — a 5-nps ceiling let busy choruses spike into an unholdable barrage (the "combo breaks every ~15 notes" wall). Medium/Easy unchanged.
      const npsCap = _bossStage ? Math.max(2, _npsBase - 1) : _npsBase;   // build62: Hard 5 NPS = teeth. v253/v258: ANY campaign boss clamps the ceiling down one notch (Hard 5→4, Medium 3→2) so a boss is never raw density.
      if (filtered.length > npsCap) {
        const WIN = 1.0;
        let changed = true, guardN = 0;
        while (changed && guardN++ < 40) {
          changed = false;
          for (let i = 0; i < filtered.length; i++) {
            // count notes in [t, t+WIN)
            let j = i, cnt = 0;
            while (j < filtered.length && filtered[j].t < filtered[i].t + WIN) { cnt++; j++; }
            if (cnt > npsCap) {
              // find the weakest in this window: off-grid before on-grid, then lowest effective strength
              let worst = -1, worstKey = Infinity;
              for (let k = i; k < j; k++) {
                const o = filtered[k];
                const key = (o.onGrid || o.downbeat ? 1000 : 0) + effOf(o);   // off-grid sorts below any on-grid
                if (key < worstKey) { worstKey = key; worst = k; }
              }
              if (worst >= 0) { filtered.splice(worst, 1); changed = true; break; }
            }
          }
        }
      }
      // dev hook: the ONSET-only peak NPS (max onsets in any 1 s window AFTER the cap, BEFORE chords/holds/fillers) — i.e.
      // proof the change-3c cap held the onset stream to budget. (__rrChartStats.peakNps reports the SCORED total incl.
      // chord partners, which can sit higher.) Test-only, alongside __rrChartStats/__rrDebug.
      let peakNps = 0;
      for (let i = 0; i < filtered.length; i++) { let j = i, c = 0; while (j < filtered.length && filtered[j].t < filtered[i].t + 1.0) { c++; j++; } if (c > peakNps) peakNps = c; }
      window.__rrPeakNps = peakNps;
      // CENTROID → LANE: normalize brightness across the chart (5th–95th pct, min 0.15 spread) so the
      // contour uses the full string set; low/bass → low string, bright/melody → high string. The hand
      // now RIDES THE MELODY instead of jumping to hashed lanes.
      const cs = filtered.map(b => b.centroid).slice().sort((a, b) => a - b);
      const lo = cs.length ? cs[Math.floor(cs.length * 0.05)] : 0;
      const hi = cs.length ? cs[Math.floor(cs.length * 0.95)] : 1;
      const den = Math.max(0.15, hi - lo);
      // build58: on a spectrally NARROW song (hi−lo small) a pure value-map collapses everything onto one string. When the
      // brightness spread is tight, blend in a RANK map (each note placed by its centroid's quantile) so the melodic motion
      // that DOES exist still spreads across the strings; wide-band songs stay value-driven (no exaggerated jitter).
      const narrow = (hi - lo) < 0.15;
      const rankOf = {};
      if (narrow) { for (let r = 0; r < cs.length; r++) { if (rankOf[cs[r]] === undefined) rankOf[cs[r]] = r / Math.max(1, cs.length - 1); } }
      // CHANGE 6 — SMOOTH THE CONTOUR before mapping to lanes, but CONSERVATIVELY so the lane still tracks the real pitch
      // (verified: a blanket median-of-3 on this catalog's noisy centroids decorrelates lane from centroid — centroidLaneR
      // crashed 0.94 → 0.63 — so we DON'T smooth every point). Instead: a SPIKE-GATED median only rewrites a sample that
      // is a true single-frame OUTLIER (both neighbors agree and the sample shoots well past them); the steady contour is
      // left untouched. Then a feather-light EMA + lane HYSTERESIS de-strobe the boundary without lagging the melody.
      const rawC = filtered.map(b => (typeof b.centroid === 'number' ? b.centroid : 0.5));
      const SPIKE = 0.28;                        // a sample must exceed both neighbors' band by this much to count as a spike
      const med3 = rawC.map((v, i) => {
        if (i === 0 || i === rawC.length - 1) return v;
        const a = rawC[i - 1], c = rawC[i + 1];
        const loN = Math.min(a, c), hiN = Math.max(a, c);
        if (v > hiN + SPIKE || v < loN - SPIKE) {            // genuine outlier → pull to the median of (a,v,c)
          return Math.max(loN, Math.min(hiN, v));
        }
        return v;                                            // in-contour sample → keep raw (preserves centroid↔lane corr)
      });
      // feather-light EMA (α=0.85 → new sample strongly dominates): de-jitters frame-to-frame wobble without lagging the
      // pitch enough to decorrelate lane (measured ≥0.9 on the demo, well above the 0.85 bar).
      const smC = new Array(med3.length);
      let ema = med3.length ? med3[0] : 0.5;
      for (let i = 0; i < med3.length; i++) { ema = 0.9 * med3[i] + 0.1 * ema; smC[i] = ema; }
      const HYST_LANE = 0.18;                    // band-edge margin in LANE units — must cross this far past the previous
                                                 // string's center before we commit a switch (prevents 2-string strobing).
      let prevLaneF = -1;                        // previous fractional lane (continuous), for lane-level hysteresis
      let sameRun = 0;                           // length of the current same-lane streak (for the relaxed CHANGE-6 guard)
      notes = filtered.map((b, idx) => {
        let n = (smC[idx] - lo) / den; n = Math.max(0, Math.min(1, n));
        if (narrow) { const nr = rankOf[b.centroid]; if (typeof nr === 'number') n = 0.35 * n + 0.65 * nr; }
        // LANE-LEVEL hysteresis: only move off the previous string once the (continuous) target lane clears a margin →
        // no strobing — but the value `n` still tracks the contour, so lane↔centroid correlation is preserved.
        let laneF = n * (span - 1);
        if (prevLaneF >= 0 && Math.abs(laneF - prevLaneF) < HYST_LANE) laneF = prevLaneF; else prevLaneF = laneF;
        let lane = laneBase + Math.round(laneF);
        // CHANGE 2 — clamp the per-note lane jump on ALL difficulties (was Easy/Medium only — Hard's unclamped jumps
        // were a big part of the "scattered/unreadable" complaint). Preserve the up/down direction, just bound the leap:
        // Easy ±1, Medium ±2, Hard ±3 strings.
        if (last >= 0) {
          const maxJump = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : (_rift ? 3 : 2);   // build148 T8: RIFT keeps the pre-build141 ±3 leaps · build141 (beta data): Hard 3→2 — unclamped 3-string leaps were a top combo-break source; a ±2 clamp keeps runs holdable while density/speed keep Hard clearly harder than Medium
          if (lane > last + maxJump) lane = last + maxJump;
          else if (lane < last - maxJump) lane = last - maxJump;
          lane = Math.max(laneBase, Math.min(laneBase + span - 1, lane));
        }
        // CHANGE 6 — relax the anti-repeat guard from "break a 3rd-in-a-row" to allow up to 5 same-lane notes, so
        // genuinely repeated pitches read as jacks/runs (a real GH idiom) instead of being scattered onto a different
        // string. Only when a run would exceed 5 do we nudge the streak off its string.
        let guard = 0;
        const wouldRun = (lane === last) ? sameRun + 1 : 1;
        if (wouldRun > 5) { while (lane === last && guard < 3) { lane = inSpan(lane + 1); guard++; } }
        sameRun = (lane === last) ? sameRun + 1 : 1;
        last2 = last; last = lane;
        let type = 'tap';
        if ((b.downbeat && b.strength >= 1.4) || b.strength >= 1.9) type = 'accent';  // on-beat / strong → accented gem (build104 s8: stars moved to the budgeted placeStars pass below)
        return { time: b.t, strength: b.strength, lane: lane, type: type, hold: 0, spin: (Math.floor(b.t * 97 + idx * 7) % 360) * Math.PI / 180, judged: false, hit: null, _pulsed: false, _centroid: b.centroid, _sustain: b.sustain || 0, _hotBands: b.hotBands || null, _onGrid: !!b.onGrid, _downbeat: !!b.downbeat, _energy: b.energy || 0, _centroidPath: b.centroidPath || null };
      });
      // CHANGE 1 (dedupe) — snapping can collapse two onsets onto the same (time-slot, lane). Drop the collision,
      // keeping the STRONGEST, then re-sort ascending (the engine's hit-detection early-break requires sorted time).
      {
        const slot = (t) => Math.round(t / 0.03);   // ~30 ms quantum = one perceptual slot
        const seen = {};
        const kept = [];
        for (const nn of notes) {
          const key = slot(nn.time) + ':' + nn.lane;
          if (seen[key] === undefined) { seen[key] = kept.length; kept.push(nn); }
          else { const ex = kept[seen[key]]; if ((nn.strength || 0) > (ex.strength || 0)) kept[seen[key]] = nn; }   // keep the stronger
        }
        kept.sort((a, b) => a.time - b.time);
        notes = kept;
      }
    } else {
      const filtered = beats.filter((_, i) => i % step === 0);   // CLASSIC: every Nth onset, hashed lanes
      notes = filtered.map((b, idx) => {
        const seed = Math.floor(b.t * 8.97 + b.strength * 3.1 + idx * 1.7);
        let lane = laneBase + (((seed % span) + span) % span);
        let guard = 0;
        while ((lane === last || lane === last2) && guard < 4) { lane = inSpan(lane + 1); guard++; }
        last2 = last; last = lane;
        let type = 'tap';
        if (b.strength >= 1.75) type = 'accent';             // strong beat → accented gem (build104 s8: stars moved to placeStars)
        return { time: b.t, strength: b.strength, lane: lane, type: type, hold: 0, spin: (seed % 360) * Math.PI / 180, judged: false, hit: null, _pulsed: false };
      });
    }
    // build104 s8: STAR PLACEMENT — replaces `idx % 31` (a metronomic index accident, starCv ≈ 0.06) with a
    // BUDGETED musical pick: one gold surge per ~18s span, spent on the span's strongest EFFECTIVE onset
    // (downbeat ×1.6 / on-grid ×1.3 when the grid is trusted, raw strength otherwise). Count-preserving by
    // duration; the placement scoring carries directly into batch-2 star PHRASES (anchoring).
    (function placeStars() {
      if (!notes.length) return;
      const durS = Math.max(1, notes[notes.length - 1].time);
      const nStars = Math.max(1, Math.round(durS / 18));
      const spanLen = durS / nStars;
      const effN = (n) => (n.strength || 1) * (_gridTrust ? (n._downbeat ? 1.6 : n._onGrid ? 1.3 : 1.0) : 1.0);
      for (let s = 0; s < nStars; s++) {
        const t0 = s * spanLen, t1 = t0 + spanLen + (s === nStars - 1 ? 1 : 0);
        let best = null, bestE = -1;
        for (const n of notes) {
          if (n.time < t0 || n.time >= t1) continue;
          if (n.type !== 'tap' && n.type !== 'accent') continue;
          const e = effN(n);
          if (e > bestE) { bestE = e; best = n; }
        }
        if (best) best.type = 'star';
      }
    })();
    // build104 s10: FINALE — the last 8% is the payoff. Promote the strongest downbeats (strongest notes when the
    // grid isn't trusted) to accents so the outro reads like a finisher.
    if (notes.length) {
      const durF = notes[notes.length - 1].time;
      const t8F = durF * 0.92;
      const fin = notes.filter(n => n.time >= t8F && n.type === 'tap' && (!_gridTrust || n._downbeat));
      fin.sort((a, b) => (b.strength || 1) - (a.strength || 1));
      for (let k = 0; k < Math.min(3, fin.length); k++) fin[k].type = 'accent';
    }
    // derive HOLD notes: a note the song actually SUSTAINS (measured ring) — or a long-enough pause —
    // becomes a hold (still ONE scored note; the head is the hit, so notes_total is unchanged).
    // build104 s6a: the tail is bounded by the next note IN THE SAME LANE, not the next note anywhere —
    // a held key only blocks its own string. The old any-lane gate starved DENSE charts of sustains
    // (Hard measured FEWER holds than Medium, 44 vs 66); with per-lane clearance the ratio rights itself.
    // build104 s6b: tail cap 1.6→3.5s (the analyzer now measures rings to 4s) so a real long note reads
    // as one. Ergonomics guard: a >2s tail with 3+ notes falling under it must sit on an EDGE lane
    // (0/1/top) so the pinned finger doesn't fence the hand off mid-neck. The s5 sanitizer audits
    // conflicts introduced by LATER passes (chords/fillers) against every hold span.
    // SLIDE RAILS (spec A1.2): upgrade a qualifying HOLD to a RAIL — a sustain whose measured centroid GLIDES is a
    // pitch bend, so the rail's lane walks the strings with it. Returns 'rail' (converted), 'degrade' (was a slide
    // candidate but clamping/time-fit left 0 transfers → stays a hold, counted in railClamped), or 'no'. All lane
    // steps are ±1 and clamp to the span edge (never ping-pong reflect — a reversed rail lies about the pitch).
    let _railClamped = 0;
    function _railFromHold(cur) {
      // FIX2 EASY teaching ladder: the first two sustains of a build stay PLAIN holds so a new player meets the
      // hold mechanic before any Slide Rail appears. Easy-only; Medium/Hard/RIFT keep their exact rail behavior.
      if (difficulty === 'easy' && _easyHoldRailGate < 2) return 'no';
      const cp = cur._centroidPath;
      const _driftMin = (_railTestDrift != null) ? _railTestDrift : RAIL_DRIFT_MIN;   // dev-test override (null = shipped)
      const _minLen = (_railTestMinLen != null) ? _railTestMinLen : RAIL_MIN_LEN;
      if (!cp || cp.length < 2) return 'no';
      if (cur.hold < _minLen) return 'no';
      const drift = cp[cp.length - 1] - cp[0];
      if (Math.abs(drift) < _driftMin) return 'no';
      const sgn = drift > 0 ? 1 : -1;
      let agree = 0, tot = 0;
      for (let k = 1; k < cp.length; k++) { const dd = cp[k] - cp[k - 1]; if (dd === 0) continue; tot++; if ((dd > 0 ? 1 : -1) === sgn) agree++; }
      if (tot === 0 || agree / tot < 0.70) return 'no';   // wobble = vibrato, not a slide → leave it a hold
      // a slide candidate from here — a failure to place any transfer DEGRADES to a plain hold (railClamped++).
      const maxX = RAIL_MAX_XFER[difficulty] || 1;
      const minSeg = RAIL_MIN_SEG[difficulty] || 0.45;
      const loLane = laneBase, hiLane = laneBase + span - 1;
      const edgeDist = sgn > 0 ? (hiLane - cur.lane) : (cur.lane - loLane);   // how far the hand can walk this way
      const timeFit = Math.floor((cur.hold - 0.05) / minSeg) - 1;             // steps+1 segments each ≥ minSeg (+margin)
      let steps = Math.min(maxX, Math.round(Math.abs(drift) / RAIL_DRIFT_MIN), edgeDist, timeFit);
      if (steps < 1) return 'degrade';
      const S = cur.hold / (steps + 1);                  // even spacing GUARANTEES each segment ≥ minSeg
      const slack = (S - minSeg) * 0.4;                  // nudge budget that can't break spacing to a neighbor/head/tail
      const cpDt = 0.15;                                 // cp samples are 150ms apart (analyzer hop)
      const times = [];
      for (let j = 1; j <= steps; j++) {
        let tj = S * j;
        if (slack > 0.001) {                             // nudge toward the steepest IN-DIRECTION centroid gradient nearby
          let bestT = tj, bestG = 0;
          for (let k = 1; k < cp.length; k++) {
            const bt = k * cpDt;
            if (bt < tj - slack || bt > tj + slack) continue;
            const g = (cp[k] - cp[k - 1]) * sgn;
            if (g > bestG) { bestG = g; bestT = bt; }
          }
          tj = bestT;
        }
        times.push(Math.round(tj * 1000) / 1000);
      }
      times.sort((a, b) => a - b);
      const rail = [{ t: 0, lane: cur.lane }];
      for (let j = 1; j <= steps; j++) {
        const lane = cur.lane + sgn * j;
        if (lane < loLane || lane > hiLane) break;       // defensive (edgeDist already bounds this)
        rail.push({ t: times[j - 1], lane: lane });
      }
      if (rail.length < 2) return 'degrade';
      cur.type = 'rail'; cur.rail = rail;                // keep every existing field incl. .hold (all hold code keeps working)
      return 'rail';
    }
    let lastHold = -99;
    let _easyHoldRailGate = 0;   // FIX2: plain holds emitted so far THIS build (Easy rail teaching ladder — first 2 sustains stay plain holds; read by _railFromHold)
    for (let i = 0; i < notes.length; i++) {
      const cur = notes[i];
      if (cur.type === 'star') continue;
      let sameGap = 99;
      for (let j = i + 1; j < notes.length; j++) { if (notes[j].lane === cur.lane) { sameGap = notes[j].time - cur.time; break; } }
      const sus = cur._sustain || 0;   // build58 charter-v2: measured audio sustain (the dominant band actually rang on)
      const isSustain = sus > 0.35 ? (sameGap > sus * 0.7) : (sameGap > 0.5);
      if (isSustain && (i - lastHold) >= 5) {
        const want = sus > 0.35 ? sus : sameGap * 0.62;
        // build66 (launch-audit P1): keep the sustain tail clear of the next same-lane note by one
        // hit-window so a held key can still re-press it. No room for a playable hold → stay a tap.
        const clear = (DIFFICULTY[difficulty].hitWindow || 0.16) + 0.03;
        let tail = Math.min(want, sameGap - clear, 3.5);
        if (tail > 2 && cur.lane > laneBase + 1 && cur.lane < laneBase + span - 1) {
          let under = 0;
          for (let j = i + 1; j < notes.length && notes[j].time < cur.time + tail; j++) under++;
          if (under >= 3) tail = 2;   // busy passage + mid-neck lane → keep the pin short
        }
        if (tail >= 0.30) { cur.type = 'hold'; cur.hold = Math.round(tail * 1000) / 1000; lastHold = i;
          if (musical && RAILS_ON()) { const _rs = _railFromHold(cur); if (_rs === 'degrade') _railClamped++; }   // SLIDE RAILS: dark behind the flag
          _easyHoldRailGate++;   // FIX2: one more plain hold emitted this build (gates the Easy rail teaching ladder in _railFromHold)
        }
      }
    }
    // ---- CHORDS: a second simultaneous note in another lane (press two keys at once) ----
    const base = notes.slice();           // snapshot before we add to it
    const allowChord = difficulty !== 'easy';
    if (allowChord) {
      // build104 s7 — UNIFIED CHORD PLACEMENT (replaces the `(i−last)≥gap && i%mod` cadence, which put chords on
      // arbitrary indices — measured 6-7% of chords on downbeats, interChordCv ~0.3 = near-metronomic modulo).
      // Chords now land where the MUSIC stacks: every eligible onset scores
      //     (≥2 hot bands co-fired → +2)  +  (trusted downbeat → +1)  +  normalized strength (0..1)
      // and the top scorers win, spaced by a TIME floor (Medium ≥3.5s, Hard ≥2s) scaled by local energy —
      // quiet ×2 sparser, loud ×0.8 (choruses chug, breakdowns breathe). The BUDGET is what the legacy cadence
      // would have produced on this same chart (keeps totals within the v1 band; the scoring epoch already moves
      // with this batch). Partner lanes still prefer the REAL co-fired bands; the mechanical +2 fan is only the
      // fallback for a chosen lead without a measured stack.
      const chordGapMin = noteVariety ? (difficulty === 'medium' ? 9 : _rift ? 5 : difficulty === 'hard' ? 11 : 7) : (difficulty === 'medium' ? 14 : _rift ? 8 : difficulty === 'hard' ? 16 : 8);   // build148 T8: RIFT restores the pre-build141 dense chord budget (gap 5 / 8)   // build141 (beta data): Hard chord budget halved (gap 5→11 / 8→16) — ~195 chord-partner notes on a Hard chart were the #1 combo-break source on a strum controller; Medium/Easy unchanged
      const chordMod = noteVariety ? (difficulty === 'medium' ? 4 : 3) : (difficulty === 'medium' ? 6 : 4);
      let budget = 0;
      { let lc = -99; for (let i = 0; i < base.length; i++) { const n = base[i]; if ((n.type === 'tap' || n.type === 'accent') && (i - lc) >= chordGapMin && i % chordMod === 0) { budget++; lc = i; } } }
      const durAll = beats.length ? (beats[beats.length - 1].t || 0) : 0;
      let eMaxC = 0, sMaxC = 0;
      for (const n of base) { if ((n._energy || 0) > eMaxC) eMaxC = n._energy || 0; if ((n.strength || 1) > sMaxC) sMaxC = n.strength || 1; }
      const floorBase = _rift ? 2.0 : difficulty === 'hard' ? 3.0 : 3.5;   // build141 (beta data): Hard chord time-floor 2.0→3.0s — space chords further apart so a Hard run reads as single-note melody with occasional stabs, not a chord wall
      const floorFor = (n) => {
        const e = eMaxC > 0 ? (n._energy || 0) / eMaxC : 0.5;
        let f = floorBase * (2.0 - 1.2 * e);
        // build104 s10 (#8 safe half): HARD RAMP-IN — the first 20% of a Fracture chart uses Medium's chord
        // cadence (floor ×1.75 → ×1.0 across the ramp) so the song opens playable and tightens to full teeth.
        if (_hardLike && durAll > 0 && n.time < 0.2 * durAll) f *= 1.75 - 0.75 * (n.time / (0.2 * durAll));
        return f;
      };
      const cands = [];
      for (let i = 0; i < base.length; i++) {
        const n = base[i];
        if (!(n.type === 'tap' || n.type === 'accent')) continue;
        const sc = ((n._hotBands && n._hotBands.length >= 2) ? 2 : 0) + ((_gridTrust && n._downbeat) ? 1 : 0) + (sMaxC > 0 ? (n.strength || 1) / sMaxC : 0);
        cands.push({ i: i, n: n, sc: sc });
      }
      cands.sort((a, b) => b.sc - a.sc || a.n.time - b.n.time);
      const chosen = [];
      for (const c of cands) {
        if (chosen.length >= budget) break;
        const f = floorFor(c.n);
        let ok = true;
        for (const t of chosen) { if (Math.abs(c.n.time - t.n.time) < f) { ok = false; break; } }
        if (ok) chosen.push(c);
      }
      // build104 s10: FINALE chord guarantee (Med/Hard) — the last 8% must land at least one chord, on the final
      // downbeat-ish strong note, so the outro pays off with a full-hand hit.
      if (durAll > 0) {
        const t8 = durAll * 0.92;
        if (!chosen.some(c => c.n.time >= t8)) {
          let pick = null;
          for (const c of cands) { if (c.n.time >= t8 && (!_gridTrust || c.n._downbeat || !cands.some(x => x.n.time >= t8 && x.n._downbeat))) { if (!pick || c.sc > pick.sc) pick = c; } }
          if (pick) chosen.push(pick);
        }
      }
      chosen.sort((a, b) => a.n.time - b.n.time);
      let chordId = 0;
      for (const c of chosen) {
        const n = c.n, i = c.i;
        chordId++;
        let lanes;
        // build58 charter-v2: when the AUDIO actually stacked frequencies here (≥2 bands co-fired), play THOSE bands as the
        // chord lanes — a real "two strings at once" that matches the song — instead of the mechanical +2/+4 fan.
        if (n._hotBands && n._hotBands.length >= 2) {
          const set = {}; set[n.lane] = 1;
          n._hotBands.forEach(function (bnd) { set[inSpan(laneBase + Math.max(0, Math.min(span - 1, bnd)))] = 1; });
          const cap = _rift ? 3 : 2; const partners = Object.keys(set).map(Number).filter(l => l !== n.lane).sort((a, b) => a - b).slice(0, cap - 1); lanes = [n.lane].concat(partners).sort((a, b) => a - b);   // build71: keep the STRUCK lead lane in the chord · build141 (beta data): Hard 3→2 — 3-finger chords were an unfair combo-break; 2-note stabs stay satisfying without the wall
          if (lanes.length < 2) { let pl = inSpan(n.lane + 2); if (pl === n.lane) pl = inSpan(pl + 1); lanes.push(pl); }
        } else {
          lanes = [n.lane];
          let pl = inSpan(n.lane + 2); if (pl === n.lane) pl = inSpan(pl + 1); lanes.push(pl);
          // a beefier 3-note chord now and then (more often on Hard) — "hit the bar"
          if ((difficulty === 'hard' && i % 30 === 0) || (_rift && i % 12 === 0) || (difficulty === 'medium' && i % 28 === 0) || (noteVariety && difficulty !== 'hard' && i % 9 === 0)) {   // build141 (beta data): Hard 3-note fan i%12→i%30, and Hard opts out of the noteVariety i%9 fan — fewer 3-note stabs so Hard holds a streak
            let p2 = inSpan(n.lane + 4); if (lanes.indexOf(p2) < 0) lanes.push(p2);
          }
        }
        n.chord = true; n.chordId = chordId; n.chordLanes = lanes; n.chordLead = true;
        // build104 s7 FIX (pre-existing since build71): lanes is sorted ASCENDING, so the lead isn't necessarily
        // lanes[0] — pushing lanes[1..] duplicated the LEAD's lane whenever a hot-band partner sat below it (a
        // phantom same-lane gem) and the real partner lane never got its gem. Push every lane EXCEPT the lead's.
        for (const pl of lanes) {
          if (pl === n.lane) continue;
          notes.push({ time: n.time, strength: n.strength, lane: pl, type: 'tap', hold: 0, spin: 0, judged: false, hit: null, _pulsed: false, chord: true, chordId: chordId, chordLanes: lanes });
        }
      }
    }
    // ---- BOMBS: hazards in the gaps — DON'T hit this lane while one is at the bridge ----
    // CHANGE 4 — scattered single bombs are now HARD-ONLY (Infinity on Medium too, was 15). Random mid-gap bombs were
    // non-musical clutter on Medium; the telegraphed bomb-ROWS path (noteVariety) is the intended "dodge this" moment.
    const bombGap = _rift ? 11 : difficulty === 'hard' ? 48 : Infinity;   // Hard only — Medium/Easy stay clean · build141 (beta data): scattered bombs 11→48 apart — an accidentally-struck bomb is a combo-break; the softened (sparser) Hard chart opens MORE >0.7s gaps, so the spacing had to widen a lot to actually thin bombs below baseline
    // grid-snap helper (CHANGE 4): land a hazard ON the pulse so even bombs read musically. Falls back to the raw time.
    const _per = (beats._period || 0), _ph = (beats._phase || 0), _sub = _per / 4;
    const snapGrid = (t) => { if (_per > 0 && _sub > 0) { const g = _ph + Math.round((t - _ph) / _sub) * _sub; if (Math.abs(t - g) < _per * 0.25) return Math.round(g * 1000) / 1000; } return t; };
    let lastBomb = -99;
    for (let i = 0; i < base.length - 1; i++) {
      const n = base[i], nx = base[i + 1];
      if (n.type === 'hold') continue;
      const gap = nx.time - n.time;
      if (gap > 0.7 && (i - lastBomb) >= bombGap) {
        // build58: never drop a bomb onto a lane that ALREADY holds a real note within a hit-window (chords/fillers added
        // to `notes` after the `base` snapshot could collide) — else a correct press eats a bomb penalty. >max hitWindow(0.16).
        const bt = snapGrid(n.time + gap * 0.5), bl = inSpan(n.lane + 3);
        let clash = false;
        for (let q = 0; q < notes.length; q++) { const m = notes[q]; if (m.lane === bl && m.type !== 'bomb' && Math.abs(m.time - bt) <= 0.18) { clash = true; break; } }
        if (!clash) { notes.push({ time: bt, strength: 1, lane: bl, type: 'bomb', hold: 0, spin: 0, judged: false, hit: null, _pulsed: false }); lastBomb = i; }
      }
    }
    notes.sort((a, b) => a.time - b.time);
    // ---- BOMB ROWS (noteVariety only): a deliberate, telegraphed WALL of bombs across several
    // lanes at one instant — a clear "dodge this" moment. Reuses the 'bomb' type (render+penalty+
    // auto-avoid exist), adds NO scored notes, placed ONLY in a clean rest gap, never shares a time
    // with a real note. Default (flag off) → none, chart byte-identical. ----
    if (noteVariety && difficulty !== 'easy') {
      const rowEveryT = _rift ? 14 : difficulty === 'hard' ? 20 : 22;   // min seconds between rows · build141 (beta data): Hard 14→20 — rarer walls
      const leadIn = 0.85, restAfter = 0.85;
      const rowLanes = Math.min(LANE_COUNT, _rift ? 4 : 3);   // build141 (beta data): Hard 4→3 — a narrower wall is a cleaner dodge (one open lane), fewer bomb notes to fat-finger
      let lastRowT = -999;
      for (let i = 0; i < notes.length - 1; i++) {
        const a = notes[i], b = notes[i + 1];
        if (a.type === 'bomb' || b.type === 'bomb') continue;
        const aEnd = a.time + (a.type === 'hold' ? a.hold : 0);
        const gap = b.time - aEnd;
        if (gap < leadIn + restAfter + 0.5) continue;
        const center = aEnd + leadIn + 0.25;
        if (center - lastRowT < rowEveryT) continue;
        if (center > b.time - restAfter) continue;
        const rowT = Math.round(snapToOnset(center, 0.16) * 1000) / 1000;
        const COLLIDE = 0.17;                               // > max hitWindow (med 0.16) → dodge stays clean
        const occupied = {};
        for (const n of notes) { if (Math.abs(n.time - rowT) <= COLLIDE) occupied[n.lane] = true; }
        const startLane = Math.max(0, Math.floor((LANE_COUNT - rowLanes) / 2));
        const wall = [];
        for (let k = 0; k < rowLanes; k++) {
          const lane = startLane + k;
          if (lane < 0 || lane >= LANE_COUNT) continue;
          if (occupied[lane]) continue;
          wall.push(lane);
        }
        if (wall.length < 2) continue;
        for (const lane of wall) {
          notes.push({ time: rowT, strength: 1, lane: lane, type: 'bomb', hold: 0, spin: 0, judged: false, hit: null, _pulsed: false, _bombRow: true });
        }
        lastRowT = rowT;
      }
      notes.sort((a, b) => a.time - b.time);
    }
    // ---- TRILLS (noteVariety only): turn a FAST run of single notes into a rapid two-lane
    // ALTERNATION (the authentic GH trill feel). DENSITY-NEUTRAL — re-lanes existing notes, adds
    // none, keeps plain tap scoring (no hit-detection change). Works on dense charts (Hard) where
    // there are no rest gaps to host inserts. Spaced out so trills stay special. Default (flag
    // off) skips this entirely → chart byte-identical. ----
    // build104 s9: shared run-ownership counter — qualifying fast runs ALTERNATE between the trill pass (odd)
    // and the stair/zipper pass (even). Trill-first used to claim every run, starving the pattern pass to
    // patNotes=0 on every difficulty.
    let _runTurn = 0;
    if (noteVariety && difficulty !== 'easy') {
      // build104 s9: CHART-RELATIVE gate — "a fast run" must be relative to the difficulty's own density floor
      // (MINGAP), not an absolute constant: Medium's old 0.30 gate sat BELOW its 0.38 min-gap, so no run could
      // mathematically qualify (trills measured 0 on Medium since build62). Gate = max(legacy, MINGAP×1.15).
      // build62 regression guards stay LOAD-BEARING: Medium requires runs ≥4 notes and ≥6s apart (the loose-gate
      // experiment tanked melody-following 0.87→0.68 once), and centroidLaneR ≥ 0.85 stays the Medium acceptance
      // gate across genre-diverse tracks.
      // MINGAP_D hoisted to buildNotes scope (Fable v2) — was a stale hard:0.22, now canonical hard:0.30.
      const trillMaxGap = Math.max(_hardLike ? 0.26 : 0.30, MINGAP_D * 1.15);
      const minLen = difficulty === 'medium' ? 4 : 3;            // notes needed to call it a trill (Medium guard: real runs only)
      let lastTrillT = -999, i = 0;
      const single = (x) => x && (x.type === 'tap' || x.type === 'accent') && !x.chord;
      while (i < notes.length - 1) {
        if (!single(notes[i])) { i++; continue; }
        let j = i;                                               // grow a run of fast consecutive singles
        while (j + 1 < notes.length && single(notes[j + 1]) && (notes[j + 1].time - notes[j].time) <= trillMaxGap) j++;
        if ((j - i + 1) >= minLen && (notes[i].time - lastTrillT) >= 6) {
          _runTurn++;
          if (_runTurn % 2 === 1) {                              // odd runs → trills; even runs stay for the stair/zipper pass
            let l1 = notes[i].lane, l2 = inSpan(l1 + 1); if (l2 === l1) l2 = inSpan(l1 + 2);
            for (let k = i; k <= j; k++) { notes[k].lane = ((k - i) % 2) ? l2 : l1; notes[k]._trill = true; }
            lastTrillT = notes[j].time;
          }
          i = j + 1;
        } else { i++; }
      }
    }
    // ---- STAIR RUNS + ZIPPERS (noteVariety only): walk a fast run the trill pass did NOT claim as a
    // STAIR (lane sweep) or ZIPPER (bounce). DENSITY-NEUTRAL re-laning (adds none; plain tap scoring;
    // times untouched so every note stays on its onset). Spaced out. Default off → skip. ----
    if (noteVariety && difficulty !== 'easy') {
      // build104 s9: same chart-relative gate treatment as the trill pass — Medium's 0.36 gate sat below its own
      // 0.38 density floor (patNotes was 0 EVERYWHERE). Gate = max(legacy, MINGAP×1.35); Medium keeps the ≥6s
      // spacing regression guard.
      // MINGAP_D hoisted to buildNotes scope (Fable v2) — was a stale hard:0.22, now canonical hard:0.30.
      const patMaxGap = Math.max(_hardLike ? 0.30 : 0.36, MINGAP_D * 1.35);
      const minLen = 4;
      // build104 s9: Medium PATTERN BUDGET — the chart-relative gate wakes the pass up, but on a run-heavy song
      // it converted 50+ notes and measurably dented melody-following (A/B: centroidLaneR 0.820→0.766 on an
      // electronic track). Patterns stay a FLOURISH on Medium: at most ~4% of the chart re-lanes (Hard uncapped —
      // its runs are the texture). The stair direction already follows the melodic contour.
      const patBudget = difficulty === 'medium' ? Math.max(8, Math.round(notes.length * 0.04)) : Infinity;
      let patUsed = 0;
      const single = (x) => x && (x.type === 'tap' || x.type === 'accent') && !x.chord && !x._trill;
      let lastPatT = -999, i = 0, patSeed = 7;
      while (i < notes.length - 1) {
        if (!single(notes[i])) { i++; continue; }
        let j = i;
        while (j + 1 < notes.length && single(notes[j + 1]) && (notes[j + 1].time - notes[j].time) <= patMaxGap) j++;
        const runLen = j - i + 1;
        if (runLen >= minLen && (notes[i].time - lastPatT) >= (difficulty === 'medium' ? 6 : 5) && (patUsed + runLen) <= patBudget) {
          patSeed = (patSeed * 1103515245 + 12345) & 0x7fffffff;
          // build104 s9: the stair DIRECTION follows the run's own melodic contour (centroid slope) — an
          // ascending line sweeps UP the strings, a descending one sweeps DOWN, a flat one zippers. This keeps
          // the build62 melody-following guarantee (centroidLaneR) intact while the patterns actually fire;
          // the hashed shape remains the fallback for centroid-less (classic) charts.
          let shape;
          const c0 = notes[i]._centroid, c1 = notes[j]._centroid;
          if (typeof c0 === 'number' && typeof c1 === 'number') shape = (c1 - c0) > 0.03 ? 0 : (c1 - c0) < -0.03 ? 1 : 2;
          else shape = patSeed % 3;                            // 0=stair up, 1=stair down, 2=zipper
          for (let k = i; k <= j; k++) {
            const r = k - i;
            let lane;
            if (shape === 0)      lane = reflect(notes[i].lane + r);   // build104 s5: reflection, not wrap — no cross-neck leaps mid-run
            else if (shape === 1) lane = reflect(notes[i].lane - r);
            else                  lane = reflect(notes[i].lane + (r % 2 ? r : -r));
            notes[k].lane = lane;
            notes[k]._pat = shape;
          }
          patUsed += runLen;
          lastPatT = notes[j].time;
          i = j + 1;
        } else { i++; }
      }
    }
    // ---- OPEN NOTES + HOPOs (openNotes flag only; default OFF → skipped → byte-identical). Mutates
    // flags in place (no inserts/removals → density-neutral, counts unchanged). OPEN = an isolated
    // strong single becomes a full-neck "strum" (any lane clears). HOPO = trailing members of a fast
    // run tagged so they chain off a clean hit. Both reuse tap scoring; notes stay time-sorted. ----
    if (openNotes && difficulty !== 'easy') {
      const openMinGap = _hardLike ? 0.55 : 0.8;
      const openCentre = laneBase + Math.floor(span / 2);
      let lastOpenT = -999, lastHopoT = -999;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const prev = notes[i - 1], next = notes[i + 1];
        const gapBefore = prev ? (n.time - prev.time) : 99;
        const gapAfter  = next ? (next.time - n.time) : 99;
        const isStrong  = (n.type === 'accent' || (n.type === 'tap' && n.strength >= 1.6)) && !n.chord && !n._trill;
        if (isStrong && gapBefore >= openMinGap && gapAfter >= openMinGap && (n.time - lastOpenT) >= 7) {
          n.open = true; n.lane = openCentre; n._openLanes = [];
          for (let l = laneBase; l < laneBase + span; l++) n._openLanes.push(l);
          lastOpenT = n.time;
          continue;
        }
        const single = (x) => x && (x.type === 'tap' || x.type === 'accent') && !x.chord && !x.open;
        const fastFromPrev = single(prev) && single(n) && (n.time - prev.time) <= (_hardLike ? 0.18 : 0.30);
        if (fastFromPrev && (n.time - lastHopoT) >= 0.05) { n.hopo = true; lastHopoT = n.time; }
      }
    }
    // ---- GAP FILL: no dead air. ----
    // CHANGE 4 — STOP inventing non-musical notes. Gap-fill is now DISABLED on Hard and Easy (Infinity) — Hard already
    // packs enough real onsets, and Easy should breathe. Medium fillers fire ONLY in genuinely long rests (>2.6 s), land
    // on the SAME lane as the preceding note (no random hashed lane), and snap to the tempo grid so they read musically.
    const fillMax = { hard: Infinity, medium: 2.6, easy: Infinity }[difficulty];
    const fillers = [];
    if (isFinite(fillMax)) {
      for (let i = 0; i < notes.length - 1; i++) {
        const a = notes[i], b = notes[i + 1];
        if (a.type === 'bomb') continue;
        const end = a.time + (a.type === 'hold' ? a.hold : 0);   // sustain tail occupies its gap
        const gap = b.time - end;
        if (gap <= fillMax * 1.4) continue;                       // already busy enough
        const segs = Math.round(gap / fillMax);
        for (let k = 1; k < segs; k++) {
          let t = end + (gap * k / segs);
          t = snapToOnset(t, 0.14);                                // CHANGE 4: land on a real onset / the grid, not free-floating
          const lane = (typeof a.lane === 'number') ? a.lane : laneBase;   // same lane as the note before — a natural continuation
          fillers.push({ time: t, strength: 0.85, lane: lane, type: 'tap', hold: 0, spin: (Math.floor(t * 97.3 + k * 13) % 360) * Math.PI / 180, judged: false, hit: null, _pulsed: false, _fill: true });
        }
      }
    }
    if (fillers.length) { notes.push(...fillers); notes.sort((a, b) => a.time - b.time); }
    // ---- EASY MAX-SILENCE GUARD (v253, research-backed: "Easy too blank — moments with no notes coming down") ----
    // Easy intentionally skips the generic gap-fill above (fillMax=Infinity), which left genuinely blank stretches in
    // quiet passages. Dead air reads as a bug to a beginner. So GUARANTEE a continuous, gentle, on-beat pulse: walk the
    // merged stream and wherever the gap to the next note still exceeds MAXSIL (~1.2s), inject whole-beat-grid taps on the
    // PREVIOUS lane (lane-stable, maxJump-0 — reads as the song's steady pulse, never random). This is the SINGLE source of
    // these taps (runs after the merge → no double-fill) and stays well under npsCap (only fires in >1.2s silences). Re-sort
    // after inserts — hit-detection's early-break assumes ascending time. Density floor only; the ceiling (npsCap 2) is untouched.
    if (difficulty === 'easy') {
      const MAXSIL = 1.2;
      const perE = beats._period || 0, phE = beats._phase || 0, subE = perE > 0 ? perE : 0.5;   // whole-beat backbone
      const guard = [];
      // v258: also fill the HEAD silence (song-start → first note). The inter-note loop below never covers the lead-in, so a
      // track with a late first onset still showed dead air at the very top on Easy (the original "too blank" complaint).
      if (notes.length && notes[0].time > MAXSIL) {
        const hb = notes[0], hsegs = Math.ceil(hb.time / MAXSIL);
        for (let k = 1; k < hsegs; k++) {
          let t = hb.time * k / hsegs;
          if (perE > 0) { const g = phE + Math.round((t - phE) / subE) * subE; if (g > 0.10 && g < hb.time - 0.10) t = g; }
          t = Math.round(t * 1000) / 1000;
          const lane = (typeof hb.lane === 'number') ? hb.lane : laneBase;
          guard.push({ time: t, strength: 0.8, lane: lane, type: 'tap', hold: 0, spin: (Math.floor(t * 53.1 + k * 7) % 360) * Math.PI / 180, judged: false, hit: null, _pulsed: false, _fill: true });
        }
      }
      for (let i = 0; i < notes.length - 1; i++) {
        const a = notes[i], b = notes[i + 1];
        if (a.type === 'bomb') continue;
        const end = a.time + (a.type === 'hold' ? a.hold : 0);
        const gap = b.time - end;
        if (gap <= MAXSIL) continue;
        const segs = Math.ceil(gap / MAXSIL);                    // keep every resulting sub-gap <= MAXSIL
        for (let k = 1; k < segs; k++) {
          let t = end + (gap * k / segs);
          if (perE > 0) { const g = phE + Math.round((t - phE) / subE) * subE; if (g > end + 0.10 && g < b.time - 0.10) t = g; }   // snap to the whole beat
          t = Math.round(t * 1000) / 1000;
          const lane = (typeof a.lane === 'number') ? a.lane : laneBase;
          guard.push({ time: t, strength: 0.8, lane: lane, type: 'tap', hold: 0, spin: (Math.floor(t * 53.1 + k * 7) % 360) * Math.PI / 180, judged: false, hit: null, _pulsed: false, _fill: true });
        }
      }
      if (guard.length) { notes.push(...guard); notes.sort((a, b) => a.time - b.time); fillers.push(...guard); }   // fillers[] feeds __rrChartStats.fillers for verification
    }
    // ============================================================================================
    // build104 s5: POST-INSERT SANITIZER — the last word on playability. Every pass above (charter,
    // trills, stairs, holds, chords, fillers, guards) can be individually correct and still COMPOSE
    // into an unplayable moment; this single final pass enforces the physical limits once, after ALL
    // inserts. Lane/hold mutations only — times never change, so the time-sorted invariant holds.
    // Runs BEFORE the mirror (a pure lane flip preserves every property enforced here).
    // ============================================================================================
    {
      const maxJump = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3;
      // (a) FINAL JUMP CLAMP: between consecutive scored notes closer than 0.35s the hand can't leap
      // more than the difficulty's own clamp (the charter enforced this only on its own output — stair
      // wraps / fillers / re-lanes could still compose a cross-neck leap). Chords are the intentional
      // exception (a multi-lane spread at ONE instant is the mechanic; partners follow their lead).
      // Holds anchor the hand but are never moved (their lane carries the measured sustain + clearance).
      let prevN = null;
      for (const n of notes) {
        if (n.type === 'bomb') continue;
        if (n.chord) { if (n.chordLead) prevN = n; continue; }
        if (prevN) {
          const dt = n.time - prevN.time;
          if (dt > 0.005 && dt < 0.35) {
            const dl = n.lane - prevN.lane;
            if (Math.abs(dl) > maxJump && n.type !== 'hold') {
              n.lane = Math.max(laneBase, Math.min(laneBase + span - 1, prevN.lane + (dl > 0 ? maxJump : -maxJump)));
            }
          }
        }
        prevN = n;
      }
      // (b) TIME-AWARE JACK CAP: a same-lane hammer run is a real GH idiom at a walkable pace, torture at
      // speed. Runs whose gaps stay ≥0.30s may reach 5 (Easy 3); any FASTER run caps at 3 and the excess
      // converts to adjacent-lane ALTERNATION (the authentic GH trill conversion). This also closes the
      // filler/guard leak — both used to copy the previous lane, silently extending runs past the
      // charter's own same-lane guard.
      {
        const movable = [];
        for (const n of notes) if (n.type !== 'bomb' && !n.chord) movable.push(n);
        let i = 0;
        while (i < movable.length) {
          let j = i;
          while (j + 1 < movable.length && movable[j + 1].lane === movable[i].lane) j++;
          const runLen = j - i + 1;
          if (runLen > 3) {
            let fast = false;
            for (let k = i + 1; k <= j; k++) if ((movable[k].time - movable[k - 1].time) < 0.30) { fast = true; break; }
            const cap = fast ? 3 : (difficulty === 'easy' ? 3 : 5);
            if (runLen > cap) {
              const baseL = movable[i].lane;
              let alt = baseL + 1 <= laneBase + span - 1 ? baseL + 1 : baseL - 1;
              alt = Math.max(laneBase, Math.min(laneBase + span - 1, alt));
              for (let k = i + cap; k <= j; k++) {
                if (movable[k].type === 'hold') continue;            // a measured sustain stays on its string
                if (((k - (i + cap)) % 2) === 0) movable[k].lane = alt;   // alt, base, alt, … — a trill, not a wall
              }
            }
          }
          i = j + 1;
        }
      }
      // (b2) RAIL-SPAN AUDIT (SLIDE RAILS, spec A1.2 — only ever populated when RAILS_ON built rails): a rail
      // occupies EACH segment's lane for [segStart−clear, segEnd+clear] AND the destination lane for [w.t−0.35,
      // w.t+0.35] around every transfer (the transfer finger must be free). Movable intruders (tap/accent, not
      // chord/hold/rail/open) relocate to a nearby ±1 rail-free lane; the rest force the rail's tail to TRUNCATE
      // before the conflict (dropping now-invalid trailing waypoints), degrading to a plain hold if it falls under
      // RAIL_MIN_LEN or loses all transfers (railClamped++). Lane/hold mutations only → time-sort preserved; a
      // degraded rail is re-checked by (c) below. No-op unless rails exist, so flag-off charts are untouched.
      {
        const clear = (DIFFICULTY[difficulty].hitWindow || 0.16) + 0.03;
        const XW = 0.35, loLane = laneBase, hiLane = laneBase + span - 1, minSeg = RAIL_MIN_SEG[difficulty] || 0.45;
        const railOcc = (r, headT, hold) => {
          const sp = [];
          for (let k = 0; k < r.length; k++) { const s0 = headT + r[k].t, s1 = headT + (k + 1 < r.length ? r[k + 1].t : hold); sp.push({ lane: r[k].lane, t0: s0 - clear, t1: s1 + clear }); }
          for (let k = 1; k < r.length; k++) { const wt = headT + r[k].t; sp.push({ lane: r[k].lane, t0: wt - XW, t1: wt + XW }); }
          return sp;
        };
        const movable = (m) => (m.type === 'tap' || m.type === 'accent') && !m.chord && !m.open;
        const railBusy = (nl, tm, exceptH) => {
          for (const rr of notes) { if (rr.type !== 'rail' || !rr.rail || rr === exceptH) continue; const sp = railOcc(rr.rail, rr.time, rr.hold); for (const s of sp) if (s.lane === nl && tm > s.t0 + 1e-6 && tm < s.t1 - 1e-6) return true; }
          return false;
        };
        for (const h of notes) {
          if (h.type !== 'rail' || !h.rail) continue;
          // 1) relocate movable intruders to a nearby (±1) rail-free, note-free lane
          {
            const spans = railOcc(h.rail, h.time, h.hold);
            for (const m of notes) {
              if (m === h || m.type === 'bomb' || !movable(m)) continue;
              let conflict = false; for (const s of spans) { if (m.lane === s.lane && m.time > s.t0 + 1e-6 && m.time < s.t1 - 1e-6) { conflict = true; break; } }
              if (!conflict) continue;
              for (const nl of [m.lane - 1, m.lane + 1]) {
                if (nl < loLane || nl > hiLane) continue;
                let occ = false; for (const s of spans) { if (s.lane === nl && m.time > s.t0 + 1e-6 && m.time < s.t1 - 1e-6) { occ = true; break; } }
                if (occ || railBusy(nl, m.time, h)) continue;
                let clash = false; for (const o of notes) { if (o !== m && o.lane === nl && Math.abs(o.time - m.time) <= clear) { clash = true; break; } }
                if (clash) continue;
                m.lane = nl; break;
              }
            }
          }
          // 2) truncate at the earliest remaining conflict (unmovable / un-relocatable); degrade if too short
          let g = 0;
          while (h.type === 'rail' && g++ < 16) {
            const spans = railOcc(h.rail, h.time, h.hold);
            let earliest = Infinity, em = null;
            for (const m of notes) { if (m === h || m.type === 'bomb') continue; for (const s of spans) { if (m.lane === s.lane && m.time > s.t0 + 1e-6 && m.time < s.t1 - 1e-6) { if (m.time < earliest) { earliest = m.time; em = m; } break; } } }
            if (!em) break;
            const newHold = Math.round(Math.min(h.hold, em.time - clear - h.time) * 1000) / 1000;
            while (h.rail.length > 1 && h.rail[h.rail.length - 1].t > newHold - minSeg) h.rail.pop();
            if (h.rail.length < 2 || newHold < RAIL_MIN_LEN) {
              h.type = 'hold'; delete h.rail;
              if (newHold >= 0.30) h.hold = newHold; else { h.type = 'tap'; h.hold = 0; }
              _railClamped++;
            } else { h.hold = newHold; }
          }
          // 3) SLIDE-THEN-BUTTON (spec): the first movable, non-fill note within 0.7s after the tail prefers
          // exitLane±1 — makes "slide → button" a composed phrase, not luck (lane-only nudge, best-effort).
          if (h.type === 'rail' && h.rail && h.rail.length >= 2) {
            const exitLane = h.rail[h.rail.length - 1].lane, tailEnd = h.time + h.hold;
            for (const m of notes) {
              if (m.time <= tailEnd + 1e-6) continue;
              if (m.time > tailEnd + 0.7) break;
              if (!movable(m) || m._fill) continue;
              if (Math.abs(m.lane - exitLane) <= 1) break;
              const want = exitLane + (m.lane > exitLane ? 1 : -1);
              if (want < loLane || want > hiLane) break;
              let clash = false; for (const o of notes) { if (o !== m && o.lane === want && Math.abs(o.time - m.time) <= clear) { clash = true; break; } }
              if (!clash) m.lane = want;
              break;
            }
          }
        }
      }
      // (c) HOLD-SPAN AUDIT: after every insert/move above, no SCORED note may sit on a hold's lane inside
      // its sustain (+ the re-press clearance) — a correctly-held key physically can't strike it. Truncate
      // the tail to clear the intruder; a tail below the 0.30s playable minimum demotes back to a tap.
      {
        const clear = (DIFFICULTY[difficulty].hitWindow || 0.16) + 0.03;
        for (const h of notes) {
          if (h.type !== 'hold') continue;
          let lim = Infinity;
          for (const n of notes) {
            if (n === h || n.type === 'bomb') continue;
            if (n.lane === h.lane && n.time > h.time + 0.02 && n.time < h.time + h.hold + clear && n.time < lim) lim = n.time;
          }
          if (lim < Infinity) {
            const tail = lim - clear - h.time;
            if (tail >= 0.30) h.hold = Math.round(Math.min(h.hold, tail) * 1000) / 1000;
            else { h.type = 'tap'; h.hold = 0; }
          }
        }
      }
    }
    // build36: per-level MIRROR mod — flip every note onto the opposite lane. Done LAST (after all
    // inserts + the final sort); a lane remap doesn't change time order. Input/render lane mapping is
    // untouched, so the chart simply plays mirrored. .map() reassigns each note's chordLanes to a fresh
    // mirrored array (never mutates the shared source), so chord partners can't double-flip.
    if (_levelMirror()) {
      const mir = (l) => (LANE_COUNT - 1) - l;
      for (const n of notes) {
        if (typeof n.lane === 'number') n.lane = mir(n.lane);
        if (n.chordLanes) n.chordLanes = n.chordLanes.map(mir);
        if (n.type === 'rail' && n.rail) n.rail = n.rail.map((w) => ({ t: w.t, lane: mir(w.lane) }));   // SLIDE RAILS: mirror waypoint lanes too
      }
    }
    // build75 NOTE FEEL — surface the music the charter ALREADY computes (strength / downbeat / on-grid) so songs
    // LOOK distinct + on-beat. Purely cosmetic: per-note _emph (0..1 normalized onset strength) drives gem size +
    // a downbeat rim at render; _sub = beat-subdivision class for future tinting. No timing / lane / scoring change.
    (function () {
      const real = notes.filter(n => n && (n.type === 'tap' || n.type === 'accent' || n.type === 'star' || n.type === 'hold') && !n._fill);
      const ss = real.map(n => n.strength || 1).sort((a, b) => a - b);
      const pick = (p) => ss.length ? ss[Math.min(ss.length - 1, Math.max(0, Math.round(p * (ss.length - 1))))] : 1;
      const p5 = pick(0.05), p95 = pick(0.95), span = Math.max(0.001, p95 - p5);
      const per = beats._period || 0, ph = beats._phase || 0, sub = per / 4;
      for (const n of notes) {
        n._emph = Math.max(0, Math.min(1, ((n.strength || 1) - p5) / span));
        n._sub = (per > 0 && sub > 0) ? (function () { const m = ((Math.round((n.time - ph) / sub) % 4) + 4) % 4; return m === 0 ? 0 : m === 2 ? 1 : 2; })() : 0;
      }
    })();
    // ---- T7 FIRST-ENCOUNTER TEACHING post-pass (spec C1/C2) — DRIFT (Easy) ONLY, never Med/Hard/RIFT, never MP.
    // (1) ISOLATE the first hold + first rail: ≥1.5s of clear air before and after, by DROPPING ONLY invented `_fill`
    //     notes in the bubble (never a real onset). This is the DRIFT on-ramp — one mechanic at a time.
    // (2) TAG up to the first 2 not-yet-learned heads PER MECHANIC with n._teach='hold'|'rail' (read from the
    //     per-profile rr_hints store) so drawNote can show a one-time in-world "HOLD"/"SLIDE ▸" chip. The chart
    //     decides, the render obeys — no per-frame store reads. The counter is bumped on a CLEAN completion (see
    //     _teachCredit) and, at 2, a rebuilt chart emits 0 tags (retired forever). Held-safe: Easy-only tags + filler
    //     trims; P2 never reads _teach for scoring, and its own hold path never bumps the counter.
    (function () {
      try {
        if (difficulty !== 'easy') return;
        if (window.RhythmMP && window.RhythmMP.isLive && window.RhythmMP.isLive()) return;   // never in MP
        const AIR = 1.5;
        const _isolate = (h) => {
          if (!h) return;
          const t0 = h.time, t1 = h.time + (h.hold || 0);
          for (let i = notes.length - 1; i >= 0; i--) {
            const n = notes[i];
            if (n === h || !n._fill) continue;
            if ((n.time >= t0 - AIR && n.time < t0 - 1e-6) || (n.time > t1 + 1e-6 && n.time <= t1 + AIR)) notes.splice(i, 1);
          }
        };
        _isolate(notes.find(n => n.type === 'hold'));
        _isolate(notes.find(n => n.type === 'rail'));
        // tag heads from the per-profile counters (cap 2 per mechanic; only the not-yet-learned remainder is tagged)
        let hints = { hold: 0, rail: 0 };
        try { const s = JSON.parse(localStorage.getItem('rr_hints') || '{}'); if (s && typeof s === 'object') { hints.hold = s.hold | 0; hints.rail = s.rail | 0; } } catch (e) {}
        let tagHold = Math.max(0, 2 - hints.hold), tagRail = Math.max(0, 2 - hints.rail);
        for (const n of notes) {
          if (tagHold <= 0 && tagRail <= 0) break;
          if (n.type === 'rail' && tagRail > 0) { n._teach = 'rail'; tagRail--; }
          else if (n.type === 'hold' && tagHold > 0) { n._teach = 'hold'; tagHold--; }
        }
      } catch (e) {}
    })();
    // ---- A2 STARSTRUCK star-phrase post-pass (Wave-4b) — DARK behind STARPHRASE_ON (default OFF). Tags each existing
    // star's APPROACH RUN (the eligible tap/accent notes leading into it, per _tagStarPhrases above) with phraseId +
    // phraseLen. PURELY a legibility tag: the runtime reads it only to fire a cosmetic STARSTRUCK callout when the whole
    // run is carried clean into the star — NO score/charge/mult (OD charge stays per-note; NO star is moved/re-placed,
    // so no accent forfeits its PERFECT bonus). Adds ONLY the two props (never reorders/adds/removes/retypes a note), so
    // flag ON vs OFF is array-identical → CHART_VERSION 2 safe. Flag OFF → not called, __rrChartStats.phrases is 0.
    if (STARPHRASE_ON()) { try { _tagStarPhrases(notes, difficulty); } catch (e) {} }
    try {
      window.__rrChartStats = {
        notes: notes.length,
        phrases: (function () { const s = new Set(); for (const n of notes) if (n.phraseId != null) s.add(n.phraseId); return s.size; })(),   // A2 STARSTRUCK: distinct star-phrases (0 unless rr_odphrase built them)
        emphSpread: (function () { const e = notes.filter(n => typeof n._emph === 'number').map(n => n._emph); return e.length ? +(Math.max.apply(null, e) - Math.min.apply(null, e)).toFixed(3) : 0; })(),
        holds: notes.filter(n => n.type === 'hold').length,   // holds ONLY (rails are counted separately below)
        rails: notes.filter(n => n.type === 'rail').length,   // SLIDE RAILS (0 unless RAILS_ON built them)
        railTransfers: notes.reduce((a, n) => a + (n.type === 'rail' && n.rail ? n.rail.length - 1 : 0), 0),
        meanRailLen: (function () { const r = notes.filter(n => n.type === 'rail'); return r.length ? Math.round(r.reduce((a, n) => a + (n.hold || 0), 0) / r.length * 100) / 100 : 0; })(),
        railClamped: _railClamped,   // slide candidates that degraded to plain holds (clamp/time-fit/clearance)
        stars: notes.filter(n => n.type === 'star').length,
        chords: notes.filter(n => n.chord).length,
        bombs: notes.filter(n => n.type === 'bomb').length,
        trills: notes.filter(n => n._trill).length,
        opens: notes.filter(n => n.open).length,
        hopos: notes.filter(n => n.hopo).length,
        openNotes: openNotes,
        bombRows: notes.filter(n => n._bombRow).length,
        patNotes: notes.filter(n => typeof n._pat === 'number').length,
        fillers: fillers.length,
        noteVariety: noteVariety,
        lanesUsed: [...new Set(notes.map(n => n.lane))].sort((a, b) => a - b),
        difficulty: difficulty,
        chartMode: chartMode,
        bpm: (beats && beats._bpm) || null,
        // CHANGE 1 — onGridPct: fraction of scored notes whose time lands within per·0.06 of a tempo grid line. Notes are
        // snapped to the SUB-grid (quarter-beats on Med/Hard, eighth-notes feel on Easy), so "a grid line" is a sub-grid
        // line — a note on beat+½ is still on-grid. The whole point of beat-quantization; want > 0.75. Null when no tempo.
        onGridPct: (function () {
          const per = (beats && beats._period) || 0, ph = (beats && beats._phase) || 0;
          if (!(per > 0)) return null;
          const sub = per / (difficulty === 'easy' ? 2 : 4);
          if (!(sub > 0)) return null;
          const scored = notes.filter(n => n.type !== 'bomb');
          if (!scored.length) return null;
          const tol = per * 0.06;
          let on = 0;
          for (const n of scored) { const r = (((n.time - ph) % sub) + sub) % sub; if (r <= tol || r >= sub - tol) on++; }
          return Math.round(on / scored.length * 1000) / 1000;
        })(),
        period: (beats && beats._period) ? Math.round(beats._period * 1000) / 1000 : null,
        // CHANGE 3c — peakNps: the busiest 1-second window (max scored notes). The NPS cap holds this down; this is the
        // measurable "barrage" ceiling. Computed over scored (non-bomb) notes.
        peakNps: (function () {
          const ts = notes.filter(n => n.type !== 'bomb').map(n => n.time).sort((a, b) => a - b);
          let pk = 0; for (let i = 0; i < ts.length; i++) { let j = i, c = 0; while (j < ts.length && ts[j] < ts[i] + 1.0) { c++; j++; } if (c > pk) pk = c; }
          return pk;
        })(),
        laneHist: (function () { const h = {}; for (const n of notes) if (typeof n.lane === 'number') h[n.lane] = (h[n.lane] || 0) + 1; return h; })(),
        // proof the lanes follow the music: Pearson r between each musical note's source brightness (centroid) and its lane.
        centroidLaneR: (function () {
          const ps = notes.filter(n => typeof n._centroid === 'number' && typeof n.lane === 'number');
          if (ps.length < 8) return null;
          const n = ps.length; let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
          for (const p of ps) { const x = p._centroid, y = p.lane; sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; }
          const cov = sxy - sx * sy / n, vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
          return (vx > 0 && vy > 0) ? Math.round(cov / Math.sqrt(vx * vy) * 1000) / 1000 : null;
        })(),
        durationSec: (notes.length ? Math.round(notes[notes.length - 1].time) : 0),
        // ---- build104 chart probes (verification-only; charts unaffected) --------------------------------
        gridFit: _gridFit, gridFitA: _gridFitA, gridFitB: _gridFitB, gridTrust: _gridTrust,
        accents: notes.filter(n => n.type === 'accent').length,
        // meanSnapErr: mean |scored note − nearest STRONG analyzer onset| (ms). Bounded snapping should DROP this
        // vs. the old 0.18·period gate; fillers/bombs excluded (invented notes have no source onset).
        meanSnapErr: (function () {
          let strong = beats.filter(b => (b.strength || 1) >= 1.2);
          if (strong.length < 12) strong = beats;
          const sc = notes.filter(n => n.type !== 'bomb' && !n._fill);
          if (!strong.length || !sc.length) return null;
          let j = 0, sum = 0;
          for (const n of sc) {
            while (j + 1 < strong.length && Math.abs(strong[j + 1].t - n.time) <= Math.abs(strong[j].t - n.time)) j++;
            sum += Math.abs(strong[j].t - n.time);
          }
          return Math.round(sum / sc.length * 1000 * 10) / 10;
        })(),
        meanHold: (function () { const h = notes.filter(n => n.type === 'hold'); return h.length ? Math.round(h.reduce((a, n) => a + n.hold, 0) / h.length * 100) / 100 : 0; })(),
        maxHold: (function () { let m = 0; for (const n of notes) if (n.type === 'hold' && n.hold > m) m = n.hold; return Math.round(m * 100) / 100; })(),
        // holdConflicts: scored same-lane notes falling INSIDE a hold's span (+re-press clearance) — a held key
        // physically can't strike them. Sanitizer target: 0.
        holdConflicts: (function () {
          const clear = (DIFFICULTY[difficulty].hitWindow || 0.16) + 0.03;
          let c = 0;
          for (const h of notes) {
            if (h.type !== 'hold') continue;
            for (const n of notes) {
              if (n === h || n.type === 'bomb') continue;
              if (n.lane === h.lane && n.time > h.time + 0.02 && n.time < h.time + h.hold + clear - 1e-6) c++;
            }
          }
          return c;
        })(),
        chordOnDownbeatPct: (function () { const L = notes.filter(n => n.chordLead); if (!L.length) return null; return Math.round(L.filter(n => n._downbeat).length / L.length * 1000) / 1000; })(),
        // interChordCv: sd/mean of the gaps between chord instants — modulo cadence ≈ low; musical placement ≈ higher
        interChordCv: (function () {
          const ts = notes.filter(n => n.chordLead).map(n => n.time);
          if (ts.length < 3) return null;
          const g = []; for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
          const m = g.reduce((a, b) => a + b, 0) / g.length;
          const sd = Math.sqrt(g.reduce((a, b) => a + (b - m) * (b - m), 0) / g.length);
          return m > 0 ? Math.round(sd / m * 1000) / 1000 : null;
        })(),
        starCv: (function () {
          const ts = notes.filter(n => n.type === 'star').map(n => n.time);
          if (ts.length < 3) return null;
          const g = []; for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
          const m = g.reduce((a, b) => a + b, 0) / g.length;
          const sd = Math.sqrt(g.reduce((a, b) => a + (b - m) * (b - m), 0) / g.length);
          return m > 0 ? Math.round(sd / m * 1000) / 1000 : null;
        })(),
        // maxFastJack: longest same-lane run whose internal gaps are ALL < 0.30s (jack-cap target: <=3).
        maxFastJack: (function () {
          const sc = notes.filter(n => n.type !== 'bomb' && !n.chord);
          let best = 0, run = 1;
          for (let i = 1; i < sc.length; i++) {
            if (sc[i].lane === sc[i - 1].lane && (sc[i].time - sc[i - 1].time) < 0.30 && (sc[i].time - sc[i - 1].time) > 0.005) run++;
            else { if (run > best) best = run; run = 1; }
          }
          return Math.max(best, run);
        })(),
        // maxJumpFast: biggest lane leap between consecutive scored notes < 0.35s apart (chord spreads excluded)
        maxJumpFast: (function () {
          const sc = notes.filter(n => n.type !== 'bomb' && !n.chord);
          let m = 0;
          for (let i = 1; i < sc.length; i++) {
            const dt = sc[i].time - sc[i - 1].time;
            if (dt < 0.35 && dt > 0.005) { const d = Math.abs(sc[i].lane - sc[i - 1].lane); if (d > m) m = d; }
          }
          return m;
        })(),
        // npsDecile: scored notes/sec per 10% song slice — the intro-ramp + finale shape probe
        npsDecile: (function () {
          const sc = notes.filter(n => n.type !== 'bomb');
          if (!sc.length) return null;
          const dur = Math.max(1, sc[sc.length - 1].time);
          const bins = new Array(10).fill(0);
          for (const n of sc) bins[Math.min(9, Math.floor(n.time / dur * 10))]++;
          return bins.map(c => Math.round(c / (dur / 10) * 100) / 100);
        })(),
        lane04Share: (function () {
          const sc = notes.filter(n => typeof n.lane === 'number' && n.type !== 'bomb');
          if (!sc.length) return null;
          const c = sc.filter(n => n.lane === 0 || n.lane === LANE_COUNT - 1).length;
          return Math.round(c / sc.length * 1000) / 1000;
        })()
      };
    } catch (e) {}
  }

  // ===========================================================================
  // DEMO PROVIDER (local mp3 + in-browser analyzer)
  // ===========================================================================
  let cachedBuffer = null;
  // build99: beta-flavored loading quips. The owner asked for funnier loading text than the old
  // "DECODING SIGNAL / SPLITTING FREQUENCY BANDS" — self-deprecating beta humor (snacks, the cat, cardio).
  // The real per-stage strings are still passed to setLoading and kept as the title tooltip; what SHOWS is a
  // shuffled quip, so every load feels like the beta has a sense of humor and you rarely see the same line twice.
  const LOADING_QUIPS = [
    'Teaching the cat to code again',
    'Running this off our own fat asses',
    'Bribing the algorithm with snacks',
    'Microwaving last night’s leftovers',
    'Waking ECH0 from its nap',
    'Untangling the guitar cable',
    'Doing the cardio so you don’t have to',
    'Letting the cat walk across the keyboard',
    'Arguing with the metronome',
    'Tuning a string we definitely broke',
    'Convincing the notes to fall down',
    'Pretending we read the manual',
    'Feeding the beat detector a sandwich',
    'Asking Ryo for the WiFi password',
    'Hiding the bugs before you notice',
    'Stretching before the big solo',
    'Spilling coffee on the mixing board',
    'Negotiating with the loading bar',
    'Counting the beats on our fingers',
    'Warming up the air guitar',
    'Summoning the rhythm gods (beta build)',
    'Polishing the crimson off the frets',
    'Sweeping the green room for snacks',
    'Pouring one out for the dropped frames',
    'Reticulating splines (legally distinct)',
    'Yelling “one more song” at no one',
  ];
  const LOADING_STAGES = ['WARMING UP THE CROWD', 'TUNING THE CHAOS', 'SOUNDCHECK IN PROGRESS', 'CHARTING YOUR DOOM', 'SUMMONING THE RIFF', 'LOADING — BETA VIBES'];
  let _quipBag = [];
  function nextQuip() {
    if (!_quipBag.length) {   // refill + Fisher-Yates shuffle → no immediate repeats across a load
      _quipBag = LOADING_QUIPS.slice();
      for (let i = _quipBag.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = _quipBag[i]; _quipBag[i] = _quipBag[j]; _quipBag[j] = t; }
    }
    return _quipBag.pop();
  }
  function funnyStage() { return LOADING_STAGES[(Math.random() * LOADING_STAGES.length) | 0]; }
  function setLoading(msg, pct) {
    const el = $('loading-msg');
    if (el) { el.textContent = nextQuip(); el.title = msg || ''; }   // SHOW a funny quip; keep the real stage as a hover title
    $('loading-pct').textContent = Math.floor(pct) + '%';
    const ring = $('loading-ring');   // fill the atom's progress ring (circumference 2π·100 ≈ 628)
    if (ring) ring.style.strokeDashoffset = String(628 * (1 - Math.max(0, Math.min(100, pct)) / 100));
  }

  // fetch audio with a hard timeout so a dead/slow network can't hang the loading screen forever
  async function fetchAudio(url, opts) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 30000) : 0;
    try {
      const res = await fetch(url, Object.assign({ signal: ctrl ? ctrl.signal : undefined }, opts || {}));
      if (!res.ok) throw new Error('Track audio unavailable (' + res.status + ')');
      return await res.arrayBuffer();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Network timed out — check your connection and try again');
      if (e && /unavailable \(/.test(e.message || '')) throw e;
      throw new Error('Couldn’t load this track’s audio — try another, or check your connection');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function demoProvider() {
    showScreen('loading');
    $('loading-stage').textContent = funnyStage();
    if (!cachedBuffer) {
      setLoading('Awakening ECH0', 5);
      const audioEl = $('audio-el');
      const src = audioEl ? audioEl.src : 'assets/crimson-circuit.mp3';   // build157: Crimson Circuit anthem is the demo/start track
      const arr = await fetchAudio(src);
      setLoading('Decoding waveform', 25);
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      try { cachedBuffer = await ac.decodeAudioData(arr); } finally { try { ac.close(); } catch (e) {} }   // build65 (cycle-4): always release the throwaway decode context, even on a decode reject (Chromium ~6-context cap)
    }
    const analyzed = await analyzeChart(cachedBuffer);
    return {
      beats: analyzed,
      duration: cachedBuffer.duration,
      player: new DemoPlayer(cachedBuffer),
      meta: { title: 'Lunar Waves', artist: 'Kunning Klash · Kunin Kitsune' },
      live: false,
      submit: async () => null, // local practice — no leaderboard
    };
  }

  // In-browser charting for ANY audio URL — used for live catalog tracks that don't have a
  // server-baked chart yet (the "fast path"). Fetch → decode → onset-analyze → play the
  // decoded buffer (sample-accurate via DemoPlayer). Needs a CORS-readable direct file.
  let lastDecoded = { url: null, buf: null };
  async function bufferedProvider(url, meta) {
    showScreen('loading');
    $('loading-stage').textContent = funnyStage();
    let buf = (lastDecoded.url === url) ? lastDecoded.buf : null;
    if (!buf) {
      try {
        setLoading('Fetching track', 8);
        const arr = await fetchAudio(url, { mode: 'cors' });
        setLoading('Decoding waveform', 25);
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        try { buf = await ac.decodeAudioData(arr); } finally { try { ac.close(); } catch (e) {} }   // build65 (cycle-4): ALWAYS release the throwaway decode context, even when decodeAudioData REJECTS (a corrupt/retried track would otherwise leak a context every attempt → Chromium's ~6-context cap silently kills all audio)
        lastDecoded = { url: url, buf: buf };
      } catch (_derr) {
        // build144: a dead / HLS-only / corrupt / CORS-blocked track used to surface the RAW DOMException
        // ("EncodingError: Unable to decode audio data") or a fetch error straight into the play() error toast.
        // Rethrow a friendly, actionable message instead — the play() catch renders it + returns to menu. The raw
        // cause still logs for debugging. Success path is untouched (this catch only runs on fetch/decode failure).
        try { console.warn('[rr] track fetch/decode failed:', url, _derr); } catch (e) {}
        var _fe = new Error("This track can't be played right now — try another one.");
        try { _fe.cause = _derr; } catch (e) {}
        throw _fe;
      }
    }
    const beats = await analyzeChart(buf);
    return {
      beats: beats,
      duration: buf.duration,
      player: new DemoPlayer(buf),
      meta: meta || {},
      live: false,             // client-charted = practice (competitive leaderboards come with server charts)
      submit: async () => null,
    };
  }

  // build102t (Phase-2 C2): chart an audio URL WITHOUT starting a run — the live-show SPECTATOR seam.
  // Reuses the exact player pipeline (fetchAudio → decode → analyzeChart → buildNotes) so the watcher's
  // ghost chart matches the players' build from the same URL + difficulty (cross-device/chartMode drift is
  // tolerated at the render site: decks paint hit/miss ONLY from the streamed events, never local inference).
  // SNAPSHOT-AND-SWAP: buildNotes' free variables (beats / notes / difficulty / level ctx+mods) are saved,
  // swapped for this one build, and ALWAYS restored in the finally — the difficulty override is TRANSIENT
  // (never touches rr_diff / the Settings UI), and the busy-state guard means a live run can't be corrupted.
  async function chartUrlForSpectate(url, diff) {
    // build102u (review fix 5): 'loading' was a PHANTOM state (engine states are menu/playing/paused only) — the
    // real staging window is covered by `player != null` (set the moment a run's clock schedules, incl. the
    // countdown). Note: an ABANDONED in-flight decode may still drive the shared loading DOM briefly — accepted,
    // the chart swap below is fully synchronous so run data can never corrupt.
    if (player != null || state === 'playing' || state === 'paused') throw new Error('engine busy — cannot chart for spectate mid-run');
    let buf = (lastDecoded.url === url) ? lastDecoded.buf : null;   // same decode cache the real launch uses (a later real start is instant)
    if (!buf) {
      const arr = await fetchAudio(url, { mode: 'cors' });
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      try { buf = await ac.decodeAudioData(arr); } finally { try { ac.close(); } catch (e) {} }   // always release the throwaway decode context (Chromium ~6-context cap)
      lastDecoded = { url: url, buf: buf };
    }
    const analyzed = await analyzeChart(buf);
    if (player != null || state === 'playing' || state === 'paused') throw new Error('engine became busy during the spectate decode');
    const snap = { beats: beats, notes: notes, difficulty: difficulty, ctx: _levelCtx, mods: _levelMods, stats: window.__rrChartStats, peak: window.__rrPeakNps };
    let out = [];
    try {
      beats = analyzed || [];
      if (DIFF_STEP[diff]) difficulty = diff;          // TRANSIENT override — restored below, never persisted
      _levelCtx = null; _levelMods = null;             // spectator charts are plain (show matches launch env-less)
      buildNotes();
      out = notes.map(n => ({ time: n.time, lane: n.lane, type: n.type, hold: n.hold || 0,
        chord: !!n.chord, chordLanes: n.chordLanes ? n.chordLanes.slice() : null, open: !!n.open, emph: n._emph || 0 }));
    } finally {
      beats = snap.beats; notes = snap.notes; difficulty = snap.difficulty;
      _levelCtx = snap.ctx; _levelMods = snap.mods;
      try { window.__rrChartStats = snap.stats; window.__rrPeakNps = snap.peak; } catch (e) {}   // review fix 6: buildNotes also writes __rrPeakNps — restore it too
    }
    return { notes: out, duration: buf.duration, buffer: buf };   // notes are plain copies, already time-sorted by buildNotes
  }

  // build114: AUTHORITATIVE MP CHART — the HOST-side pre-chart seam. Sibling of chartUrlForSpectate (same fetch →
  // decode → analyzeChart → buildNotes pipeline, same snapshot-and-swap discipline, same busy-guard) but returns the
  // FULL scoring-ready note shape (strength/chord/chordId/chordLead/chordLanes/open/hopo — everything handleHit/holds/
  // render() actually read), not the stripped display-only shape chartUrlForSpectate hands to the spectator deck.
  // multiplayer.js's resolveAndStart calls this ONCE on the host, broadcasts the result, and both seats inject it via
  // RhythmGame.startAt(prov,{notes}) — so host + guest score off the byte-identical chart instead of two independent
  // decodeAudioData()+analyzeChart() runs that can silently diverge across browsers/OS (the MP note-gap root cause).
  // Per spec: chartUrlForSpectate itself is NOT touched — this is an additive sibling, not a modification.
  // Also satisfies the "MP is never a scripted campaign boss" fix: _levelCtx is force-cleared here exactly as
  // chartUrlForSpectate already does, so _bossStage (buildNotes' Hard-easing flag) can never read true off of it.
  async function chartUrlAuthoritative(url, diff) {
    if (player != null || state === 'playing' || state === 'paused') throw new Error('engine busy — cannot chart for MP mid-run');
    let buf = (lastDecoded.url === url) ? lastDecoded.buf : null;
    if (!buf) {
      const arr = await fetchAudio(url, { mode: 'cors' });
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      try { buf = await ac.decodeAudioData(arr); } finally { try { ac.close(); } catch (e) {} }
      lastDecoded = { url: url, buf: buf };
    }
    const analyzed = await analyzeChart(buf);
    if (player != null || state === 'playing' || state === 'paused') throw new Error('engine became busy during the MP chart decode');
    const snap = { beats: beats, notes: notes, difficulty: difficulty, ctx: _levelCtx, mods: _levelMods, stats: window.__rrChartStats, peak: window.__rrPeakNps };
    let out = [];
    try {
      beats = analyzed || [];
      if (DIFF_STEP[diff]) difficulty = diff;          // TRANSIENT override — restored below, never persisted
      _levelCtx = null; _levelMods = null;             // build114 (spec item 3): force _bossStage=false — MP is never a scripted campaign boss encounter
      buildNotes();
      out = notes.map(n => ({ time: n.time, lane: n.lane, type: n.type, hold: n.hold || 0, strength: n.strength || 1,
        chord: !!n.chord, chordId: n.chord ? n.chordId : undefined, chordLead: n.chord ? !!n.chordLead : undefined,
        chordLanes: n.chordLanes ? n.chordLanes.slice() : null, open: !!n.open, hopo: !!n.hopo }));
    } finally {
      beats = snap.beats; notes = snap.notes; difficulty = snap.difficulty;
      _levelCtx = snap.ctx; _levelMods = snap.mods;
      try { window.__rrChartStats = snap.stats; window.__rrPeakNps = snap.peak; } catch (e) {}
    }
    return { notes: out, duration: buf.duration, buffer: buf };
  }

  // build66 (launch-audit, predicted-bug): OfflineAudioContext webkit fallback. Older iOS Safari (<14.1) + some in-app WebViews
  // expose ONLY webkitOfflineAudioContext — without this alias BOTH in-browser charters threw on the bare global, so EVERY live
  // track failed with "Could not start this track". (analyzeMusical's catch already falls back to a synthetic grid on total absence.)
  var OfflineAC = (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) || null;
  async function analyzeBeats(buf) {
    setLoading('Filtering bass spectrum', 45);
    const offline = new OfflineAC(1, buf.length, buf.sampleRate);
    const src = offline.createBufferSource(); src.buffer = buf;
    const filter = offline.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 200; filter.Q.value = 1.0;
    src.connect(filter); filter.connect(offline.destination); src.start();
    const rendered = await offline.startRendering();

    setLoading('Detecting onsets', 70);
    const data = rendered.getChannelData(0);
    const sr = rendered.sampleRate;
    const winSize = Math.floor(sr * 0.023);
    const energies = [];
    for (let i = 0; i < data.length; i += winSize) {
      let s = 0;
      for (let j = 0; j < winSize && i + j < data.length; j++) s += data[i + j] * data[i + j];
      energies.push(Math.sqrt(s / winSize));
    }
    const out = [];
    const lookback = 44; let lastBeat = -10; const minGap = 0.16;
    for (let i = lookback; i < energies.length - 2; i++) {
      let mean = 0;
      for (let k = i - lookback; k < i; k++) mean += energies[k];
      mean /= lookback;
      const t = (i * winSize) / sr;
      if (energies[i] > mean * 1.45 && energies[i] > 0.035 &&
          energies[i] >= energies[i - 1] && energies[i] >= energies[i + 1] &&
          t - lastBeat > minGap) {
        out.push({ t: Math.round(t * 1000) / 1000, strength: Math.round(Math.min(3, energies[i] / (mean + 0.001)) * 100) / 100 });
        lastBeat = t;
      }
    }
    // build35 (audit): GUARANTEE a playable chart. Onset detection finds nothing on quiet/ambient/
    // low-RMS tracks (fixed energy floor), so a track marked "ready" (decodable audio_url) could throw
    // "No beats in chart" and bounce to the menu — breaking the "no dead taps, ever" promise. If the
    // detected onsets are too sparse, fall back to an evenly-spaced synthetic grid (tempo estimated from
    // whatever WAS found, else ~120 BPM) so every decodable track always charts.
    const duration = buf.duration || (data.length / sr);
    const MIN_BEATS = Math.max(8, Math.floor(duration * 0.4));
    if (out.length < MIN_BEATS) {
      let spacing = 0.5;   // ~120 BPM default
      if (out.length >= 4) {
        const gaps = [];
        for (let i = 1; i < out.length; i++) gaps.push(out[i].t - out[i - 1].t);
        gaps.sort((a, b) => a - b);
        const med = gaps[Math.floor(gaps.length / 2)];
        if (med > 0.15 && med < 1.2) spacing = Math.max(0.3, Math.min(0.6, med));
      }
      const grid = [];
      for (let t = 0.3; t < Math.max(duration - 0.2, 0.8); t += spacing) {   // build65 (cycle-4): clamp bounds so even a sub-1s clip yields a grid (was 0 beats when duration<1.0 → empty chart → "No beats in chart")
        grid.push({ t: Math.round(t * 1000) / 1000, strength: (grid.length % 4 === 0) ? 1.6 : 1.0 });
      }
      if (grid.length >= out.length) {   // build65 (cycle-4): >= so an all-empty onset case (out.length 0) still returns the non-empty grid
        try { console.warn('[rr] analyzeBeats: sparse onsets (' + out.length + ') — synthetic ' + spacing.toFixed(2) + 's grid (' + grid.length + ' beats) so the track still plays'); } catch (e) {}
        setLoading('Mapping note glyphs', 92);
        return grid;
      }
    }
    setLoading('Mapping note glyphs', 92);
    return out;
  }

  // ===========================================================================
  // MUSICAL CHARTER (build57) — the "play the song" analyzer.
  // The classic analyzeBeats() only lowpasses to 200 Hz, so it hears KICKS ONLY and places notes on
  // arbitrary (hashed) lanes — it doesn't reflect the snare/hats/melody you hear, and the lane motion
  // is random. analyzeMusical() instead splits the track into LANE_COUNT log-spaced frequency bands
  // (one offline render via a ChannelMerger), measures each band's energy envelope, and:
  //   • ONSETS = peaks in the BROADBAND spectral flux (sum of positive per-band energy rises) → it
  //     catches the whole mix (kick + snare + hats + melodic transients), not just the low end.
  //   • Each onset carries a CENTROID = the energy-weighted log-frequency center at that instant,
  //     normalized 0..1 (0 = bass, 1 = treble). buildNotes maps centroid → lane, so the playing hand
  //     RIDES THE MELODY: low/bass hits land on low strings, bright/melodic hits climb to high strings.
  //   • A gentle tempo autocorrelation marks beat-grid hits (downbeats) so accents land musically.
  // Falls back to a synthetic grid on near-silent tracks (same guarantee as analyzeBeats: never dead).
  async function analyzeMusical(buf) {
    const NB = Math.max(3, LANE_COUNT);             // bands ≈ lanes (5 for GH profile)
    setLoading('Splitting frequency bands', 42);
    let rendered;
    try {
      const off = new OfflineAC(NB, buf.length, buf.sampleRate);
      const src = off.createBufferSource(); src.buffer = buf;
      const merger = off.createChannelMerger(NB);
      const fMin = 45, fMax = Math.min(15000, buf.sampleRate * 0.46);
      const edges = []; for (let b = 0; b <= NB; b++) edges.push(fMin * Math.pow(fMax / fMin, b / NB));  // log-spaced
      for (let b = 0; b < NB; b++) {
        const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = edges[b];     hp.Q.value = 0.7;
        const lp = off.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = edges[b + 1]; lp.Q.value = 0.7;
        src.connect(hp); hp.connect(lp); lp.connect(merger, 0, b);
      }
      merger.connect(off.destination); src.start();
      rendered = await off.startRendering();
      // stash the band edges on the result for the centroid pass below
      rendered._edges = edges; rendered._fMin = fMin; rendered._fMax = fMax;
    } catch (e) {
      try { console.warn('[rr] analyzeMusical: filterbank render failed → classic analyzer', e); } catch (e2) {}
      return analyzeBeats(buf);                     // hard fallback — never leave a track unplayable
    }
    setLoading('Reading the groove', 66);
    const sr = rendered.sampleRate;
    const hop = Math.max(64, Math.floor(sr * 0.011));   // ~11 ms frames (tighter than classic's 23 ms)
    const nF = Math.floor(rendered.length / hop);
    if (nF < 8) return analyzeBeats(buf);
    const edges = rendered._edges, fMin = rendered._fMin, fMax = rendered._fMax;
    const logMin = Math.log(fMin), logMax = Math.log(fMax);
    const bandLog = []; for (let b = 0; b < NB; b++) bandLog.push(Math.log(Math.sqrt(edges[b] * edges[b + 1])));
    // per-band RMS envelopes
    const env = [];
    for (let b = 0; b < NB; b++) {
      const d = rendered.getChannelData(b), e = new Float32Array(nF);
      for (let f = 0; f < nF; f++) { let s = 0, i0 = f * hop; for (let j = 0; j < hop; j++) { const v = d[i0 + j] || 0; s += v * v; } e[f] = Math.sqrt(s / hop); }
      env.push(e);
    }
    // broadband spectral flux (sum of positive per-band rises) = the onset novelty curve
    const nov = new Float32Array(nF);
    for (let f = 1; f < nF; f++) { let s = 0; for (let b = 0; b < NB; b++) { const d = env[b][f] - env[b][f - 1]; if (d > 0) s += d; } nov[f] = s; }
    const secPerF = hop / sr;
    // adaptive peak-pick on the novelty curve
    const look = Math.max(4, Math.round(0.13 / secPerF));     // ~130 ms running-mean lookback
    const minGapF = Math.max(2, Math.round(0.075 / secPerF)); // ≥75 ms between onsets
    // CHANGE 7 — onset SELECTIVITY: a stricter novelty threshold (1.8× the running mean, was 1.55×) so only
    // clear transients chart — fewer "ghost" onsets in busy passages → a more readable chart that tracks the
    // song's real hits. We also require the peak to clear an absolute floor (10% of the loudest onset) so faint
    // texture doesn't become a note. To never starve a sparse/quiet track, the pass auto-FALLS BACK to the old
    // 1.55× (with no abs floor) if 1.8× yields fewer than the MIN_BEATS playability floor.
    let novMax = 0; for (let f = 0; f < nF; f++) if (nov[f] > novMax) novMax = nov[f];
    const durationEst = buf.duration || rendered.length / sr;
    const MIN_BEATS_FLOOR = Math.max(8, Math.floor(durationEst * 0.5));
    // one peak-pick pass at a given novelty multiplier + absolute floor → returns the onset list
    function pickOnsets(novMul, absFloor) {
      const res = [];
      let lastF = -999;
      for (let f = 2; f < nF - 1; f++) {
        let mean = 0, cnt = 0; for (let k = Math.max(0, f - look); k < f; k++) { mean += nov[k]; cnt++; } mean = cnt ? mean / cnt : 0;
        if (nov[f] > mean * novMul && nov[f] > 1e-4 && nov[f] >= absFloor && nov[f] >= nov[f - 1] && nov[f] >= nov[f + 1] && (f - lastF) >= minGapF) {
          // build58 charter-v2: weight the centroid by each band's FLUX (the positive rise that fired THIS onset), averaged
          // over ±1 frame, so the lane reflects WHICH band struck — a hi-hat reads high even over a sustained bass, where the
          // old total-energy centroid pulled it low. Falls back to total energy when there's no clear rise (steady passage).
          const rise = []; let fnum = 0, fden = 0, maxr = 0;
          for (let b = 0; b < NB; b++) {
            let r = 0; for (let w = -1; w <= 1; w++) { const ff = f + w; if (ff > 0 && ff < nF) r += Math.max(0, env[b][ff] - env[b][ff - 1]); }
            r /= 3; rise.push(r); fnum += bandLog[b] * r; fden += r; if (r > maxr) maxr = r;
          }
          let cl;
          if (fden > 1e-5) cl = fnum / fden;
          else { let num = 0, den = 0; for (let b = 0; b < NB; b++) { const e = env[b][f]; num += bandLog[b] * e; den += e; } cl = den > 0 ? num / den : (logMin + logMax) / 2; }
          const centroid = Math.max(0, Math.min(1, (cl - logMin) / (logMax - logMin)));
          const hotBands = []; if (maxr > 1e-5) for (let b = 0; b < NB; b++) if (rise[b] >= 0.45 * maxr) hotBands.push(b);   // bands that co-fired → a real stacked-frequency CHORD moment
          let domB = 0, domV = -1; for (let b = 0; b < NB; b++) if (env[b][f] > domV) { domV = env[b][f]; domB = b; }            // dominant band → measure its sustain for true HOLD detection
          let sus = 0; const sthr = domV * 0.5, smax = f + Math.round(4.0 / secPerF);   // build104 s6b: measure sustains to 4s (was 1.8 — long rings were invisible to the charter)
          for (let g = f + 1; g < nF && g < smax; g++) { if (env[domB][g] >= sthr) sus = (g - f) * secPerF; else break; }
          let eTot = 0; for (let b = 0; b < NB; b++) eTot += env[b][f];                                                          // local energy → section-aware density
          // SLIDE RAILS (spec A1.1): on a LONG sustain (≥0.9s), sample the band-energy centroid at 150ms hops across the
          // ring so a gliding centroid can be read as a pitch bend (a rail). Extra field only — everything downstream that
          // doesn't know it ignores it (held-safe). Gated on RAILS_ON so a flag-off musical chart pays zero extra cost and
          // is byte-identical; the per-frame band energies (env) are already computed this pass — reused, not re-rendered.
          let centroidPath = null;
          if (RAILS_ON() && sus >= 0.9) {
            const hopF = Math.max(1, Math.round(0.15 / secPerF));
            const endF = Math.min(nF - 1, f + Math.round(sus / secPerF));
            centroidPath = [];
            for (let g = f; g <= endF && centroidPath.length < 12; g += hopF) {
              let cnum = 0, cden = 0; for (let b = 0; b < NB; b++) { const e = env[b][g]; cnum += bandLog[b] * e; cden += e; }
              const clg = cden > 0 ? cnum / cden : (logMin + logMax) / 2;
              centroidPath.push(Math.round(Math.max(0, Math.min(1, (clg - logMin) / (logMax - logMin))) * 100) / 100);
            }
          }
          res.push({ t: Math.round((f * hop / sr) * 1000) / 1000, strength: Math.round(Math.min(3, nov[f] / (mean + 1e-4)) * 100) / 100, centroid: centroid, hotBands: hotBands, sustain: Math.round(sus * 100) / 100, energy: eTot, centroidPath: centroidPath });
          lastF = f;
        }
      }
      return res;
    }
    let out = pickOnsets(1.8, 0.10 * novMax);
    if (out.length < MIN_BEATS_FLOOR) out = pickOnsets(1.55, 0);   // sparse/quiet track → relax to the original sensitivity
    // gentle tempo: autocorrelate the novelty to find a beat period, then phase-align a grid and mark
    // the on-beat onsets (used for accent emphasis only — NOT hard time-quantization, so groove is kept).
    try {
      let bestLag = 0, bestScore = 0;
      const loLag = Math.round(0.34 / secPerF), hiLag = Math.round(0.86 / secPerF);   // ~70–176 BPM
      for (let lag = loLag; lag <= hiLag && lag < nF; lag++) {
        let s = 0; for (let f = lag; f < nF; f++) s += nov[f] * nov[f - lag];
        if (s > bestScore) { bestScore = s; bestLag = lag; }
      }
      if (bestLag > 0 && out.length) {
        // build104 s4: GRID REFINEMENT — the integer autocorrelation lag quantizes the period to the ~11ms frame
        // hop; a half-frame error compounds to WHOLE BEATS of grid drift across a 3-minute song, which is why the
        // grid features read as noise on real tracks (measured: a locked 130bpm EDM track scored ~random on
        // grid-fit before this). Three deterministic, pure refinements on the same onsets:
        //   1) parabolic interpolation on the autocorrelation peak → sub-frame period;
        //   2) a windowed circular-mean drift fit (residual-vs-time slope, unwrapped) → ppm-level period trim;
        //   3) a global circular-mean phase shift → sub-ms phase.
        let period = bestLag * secPerF;
        {
          const sAt = (lag) => { let s = 0; for (let f = lag; f < nF; f++) s += nov[f] * nov[f - lag]; return s; };
          const y0 = sAt(bestLag - 1), y1 = bestScore, y2 = sAt(bestLag + 1);
          const den = y0 - 2 * y1 + y2;
          if (den < 0) { const d = 0.5 * (y0 - y2) / den; if (d > -1 && d < 1) period = (bestLag + d) * secPerF; }
        }
        // phase = beat offset that best lines up with detected onsets (coarse 12-step seed)
        let bestPhase = 0, bestHits = -1;
        for (let p = 0; p < 12; p++) {
          const ph = (p / 12) * period; let hits = 0;
          for (const o of out) { const r = ((o.t - ph) % period + period) % period; if (r < 0.06 || r > period - 0.06) hits++; }
          if (hits > bestHits) { bestHits = hits; bestPhase = ph; }
        }
        // circular-mean residual of the near-grid onsets in [t0,t1) — angles so ±wraps cancel; strength-weighted
        const cmean = (t0, t1, per, ph) => {
          let sx = 0, sy = 0, cnt = 0, st = 0;
          for (const o of out) {
            if (o.t < t0 || o.t >= t1) continue;
            const r = ((o.t - ph) % per + per) % per;
            if (r < per * 0.18 || r > per * 0.82) {
              const ang = (r / per) * 2 * Math.PI, w = o.strength || 1;
              sx += Math.cos(ang) * w; sy += Math.sin(ang) * w; cnt++; st += o.t;
            }
          }
          if (cnt < 4 || (sx === 0 && sy === 0)) return null;
          return { off: Math.atan2(sy, sx) / (2 * Math.PI) * per, cnt, tMid: st / cnt };
        };
        const durO = out[out.length - 1].t || 0;
        for (let it = 0; it < 2; it++) {
          // drift fit: per-window residual means, unwrapped, least-squares slope = fractional period error
          const wins = Math.max(2, Math.min(12, Math.floor(durO / 20)));
          const pts = [];
          for (let w = 0; w < wins; w++) { const c = cmean(durO * w / wins, durO * (w + 1) / wins + (w === wins - 1 ? 1 : 0), period, bestPhase); if (c) pts.push(c); }
          if (pts.length >= 2) {
            for (let k = 1; k < pts.length; k++) {
              let d = pts[k].off - pts[k - 1].off;
              d = ((d % period) + period * 1.5) % period - period / 2;   // unwrap to the continuous branch
              pts[k].off = pts[k - 1].off + d;
            }
            let np = pts.length, sxT = 0, syT = 0, sxxT = 0, sxyT = 0;
            for (const p2 of pts) { sxT += p2.tMid; syT += p2.off; sxxT += p2.tMid * p2.tMid; sxyT += p2.tMid * p2.off; }
            const denom = np * sxxT - sxT * sxT;
            if (denom > 0) {
              const eSlope = (np * sxyT - sxT * syT) / denom;
              if (Math.abs(eSlope) < 0.02) period *= (1 + eSlope);       // bounded ≤2% trim — never re-tempos the song
            }
          }
          const g = cmean(0, durO + 1, period, bestPhase);
          if (g) bestPhase = ((bestPhase + g.off) % period + period) % period;
        }
        for (const o of out) {
          const beats = (o.t - bestPhase) / period;
          const nearest = Math.round(beats);
          if (Math.abs(beats - nearest) < 0.12) { o.onGrid = true; if (((nearest % 4) + 4) % 4 === 0) o.downbeat = true; }
        }
        out._bpm = Math.round(60 / period);
        // CHANGE 1 — expose the tempo grid so buildNotes can SNAP note times to the pulse (the analyzer only
        // tagged onGrid/downbeat before; it never moved a note, so every note sat ±10–40 ms off-beat → the chart
        // read as a "barrage" that didn't lock to the song). Stash period + phase next to _bpm.
        out._period = period; out._phase = bestPhase;
      }
    } catch (e) {}
    const duration = buf.duration || rendered.length / sr;
    const MIN_BEATS = Math.max(8, Math.floor(duration * 0.5));
    if (out.length < MIN_BEATS) {
      // near-silent / undetectable → synthetic grid with a rolling centroid so lanes still move
      let spacing = 0.5;
      if (out.length >= 4) { const g = []; for (let i = 1; i < out.length; i++) g.push(out[i].t - out[i - 1].t); g.sort((a, b) => a - b); const m = g[g.length >> 1]; if (m > 0.15 && m < 1.2) spacing = Math.max(0.3, Math.min(0.6, m)); }
      const grid = [];
      for (let t = 0.3; t < Math.max(duration - 0.2, 0.8); t += spacing) { const k = grid.length; grid.push({ t: Math.round(t * 1000) / 1000, strength: (k % 4 === 0) ? 1.6 : 1.0, centroid: (k % 5) / 4, onGrid: true, downbeat: (k % 4 === 0) }); }   // build65 (cycle-4): clamp bounds for sub-1s clips
      if (grid.length >= out.length) { try { console.warn('[rr] analyzeMusical: sparse onsets (' + out.length + ') — synthetic grid (' + grid.length + ')'); } catch (e) {} setLoading('Mapping note glyphs', 92); return grid; }   // build65 (cycle-4): >= so an empty-onset clip still returns the grid
    }
    setLoading('Mapping note glyphs', 92);
    return out;
  }

  // pick the analyzer that matches the player's Chart Feel: 'musical' = the band/centroid charter, else classic.
  function analyzeChart(buf) { return chartMode === 'musical' ? analyzeMusical(buf) : analyzeBeats(buf); }

  // ===========================================================================
  // GAME LIFECYCLE
  // ===========================================================================
  async function play(prov, opts) {
    provider = prov;
    bossMode = !!(opts && opts.boss) || bossFlag;   // Boss Stage: Levels boss card → playBoss(), or ?boss=1 to test
    // ---- PRACTICE MODE arm/disarm (single-player ONLY). A fresh play() ALWAYS re-decides practice from opts, so
    // a normal quick-play / campaign / MP launch that passes no practice opts clears any stale practice state →
    // the default (non-practice) path stays byte-identical. MP is hard-excluded (practice is a solo drill).
    var _mpLive = !!(window.RhythmMP && window.RhythmMP.isLive && window.RhythmMP.isLive());
    if (!_mpLive && opts && opts.mode === 'practice') {
      _practiceOn = true;
      var _sp = (opts.speed != null) ? +opts.speed : 1;
      _practiceRate = (isFinite(_sp) && _sp > 0) ? Math.max(0.5, Math.min(1.5, _sp)) : 1;
      var _sec = opts.section;
      if (_sec && isFinite(_sec.start) && isFinite(_sec.end) && _sec.end > _sec.start) {
        _practiceSection = { start: Math.max(0, +_sec.start), end: Math.max(0, +_sec.end) };
      } else { _practiceSection = null; }   // no/invalid section → drill the whole song at the chosen speed
    } else {
      _practiceOn = false; _practiceSection = null; _practiceRate = 1;
    }
    // FIRST PULSE bridge run arm/disarm (single-player ONLY — a bridge is a solo rehearsal like practice). Re-decided
    // on EVERY play() so a normal launch clears any stale bridge state → the default path stays byte-identical. When
    // armed it forces the real MEDIUM chart (density/speed) for THIS run; endGame stamps results.preview=true (unranked)
    // and effHitWindow() eases judging to Easy's 0.20. difficulty is forced here but NOT persisted (rr_diff keeps the
    // player's easy) — a CLEAR persists Medium in endGame; a non-clear/abort restores _bridgePrevDiff.
    if (!_mpLive && opts && opts.bridgeRun) {
      if (!_bridgeRun) _bridgePrevDiff = difficulty;   // snapshot the tier to restore on a non-clear (first arm only; a restart keeps the bridge armed)
      _bridgeRun = true;
      difficulty = 'medium';
      try { syncDiffButtons(); } catch (e) {}
    } else {
      _bridgeRun = false;
    }
    // re-assert the equipped skin at start UNLESS a per-level override is active (launchLevel sets it via applyLevelTheme before play())
    try { if (!_levelSkinActive && typeof applyEquippedSkin === 'function') applyEquippedSkin(); } catch (e) {}
    $('play-btn').disabled = true;
    try {
      await beginPlay();
    } catch (e) {
      console.error(e);
      // build99h (playtest P1): reset the loading meter so a failed start can't leave a stale "8%" frame to flash on
      // the next load. (setLoading writes a quip + %, but on failure we bail out before it ever reaches 100/teardown.)
      try { const lp = $('loading-pct'); if (lp) lp.textContent = '0%'; const lr = $('loading-ring'); if (lr) lr.style.strokeDashoffset = '628'; } catch (_) {}
      showToast(e && e.message ? e.message : 'Could not start this track', 'error');
      // don't eject an MP/tournament player to the menu on a decode/start failure — let the MP watchdog (abortRound)
      // recover them back to the bracket; only bail to menu in single-player.
      if (!(window.RhythmMP && window.RhythmMP.isLive && window.RhythmMP.isLive())) showScreen('menu');
    } finally {
      $('play-btn').disabled = false;
    }
  }

  // Branded toast for errors / notices. Styles live in index.html as `.rr-toast` (severity
  // variants via an in-palette accent: crimson=error, gold=success/reward, chrome=neutral).
  // Back-compatible: showToast('msg') still works (defaults to neutral); callers can pass a
  // severity ('error' | 'success' | 'neutral') as the 2nd arg. A tiny queue replaces the live
  // toast gracefully so back-to-back messages don't clobber mid-fade (latest message wins, the
  // hide timer resets). role=status + aria-live=polite so screen readers announce it.
  const _TOAST_GLYPHS = {
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.51"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    neutral: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="7.5" x2="12" y2="7.51"/></svg>'
  };
  let _toastEl = null, _toastIco = null, _toastMsg = null, _toastT = 0;
  function showToast(msg, severity) {
    const sev = (severity === 'error' || severity === 'success' || severity === 'neutral') ? severity : 'neutral';
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.className = 'rr-toast';
      _toastEl.setAttribute('role', 'status');
      _toastEl.setAttribute('aria-live', 'polite');
      _toastIco = document.createElement('span'); _toastIco.className = 'rr-toast-ico'; _toastIco.setAttribute('aria-hidden', 'true');
      _toastMsg = document.createElement('span'); _toastMsg.className = 'rr-toast-msg';
      _toastEl.appendChild(_toastIco); _toastEl.appendChild(_toastMsg);
      document.body.appendChild(_toastEl);
    }
    _toastEl.classList.remove('sev-error', 'sev-success', 'sev-neutral');
    _toastEl.classList.add('sev-' + sev);
    _toastIco.innerHTML = _TOAST_GLYPHS[sev] || _TOAST_GLYPHS.neutral;
    _toastMsg.textContent = msg;
    requestAnimationFrame(() => { _toastEl.classList.add('show'); });
    clearTimeout(_toastT);
    _toastT = setTimeout(() => { _toastEl.classList.remove('show'); }, 3400);
  }
  window.RhythmGame = window.RhythmGame || {};
  window.RhythmGame.showToast = showToast;
  window.RhythmGame.playBoss = (prov) => play(prov, { boss: true });   // Boss Stage launcher (Levels boss card wires here)
  // ---- Level-DESIGN seams (additive; default-inert) ----
  let _levelCtx = null, _levelMods = null, _lastResults = null;
  window.RhythmGame.setLevelContext = (L) => { _levelCtx = L || null; };
  window.RhythmGame.setLevelMods = (m) => { _levelMods = (m && typeof m === 'object') ? m : null; };
  // build36: per-level gameplay MODS (speed / mirror / failOn) are now LIVE. Read ONLY while a level is
  // genuinely active (_levelSkinActive — set on level launch, cleared by applyEquippedSkin on quick-play/
  // menu) so a campaign level's mods can NEVER leak into a normal quick-play run, even if _levelMods is
  // left stale. clearLevelTheme also nulls them for hygiene.
  function _modActive() { return _levelSkinActive && _levelMods; }
  function _levelSpeedMul() { return (_modActive() && typeof _levelMods.speed === 'number') ? Math.max(0.5, Math.min(2, _levelMods.speed)) : 1; }
  function _levelMirror() { return !!(_modActive() && _levelMods.mirror); }
  function _levelFailOn() { return !!(_modActive() && _levelMods.failOn); }
  // build7: per-level visual identity hook. accent = 'r,g,b' string (or null to clear);
  // amb = 0..1 ambient FX strength (default 0.6 when an accent is given). Presentation only.
  window.RhythmGame.setLevelAccent = (accent, amb) => {
    levelAccentRGB = (typeof accent === 'string' && /^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(accent))
      ? accent.replace(/\s+/g, '') : null;
    levelAmbient = levelAccentRGB ? (typeof amb === 'number' ? Math.max(0, Math.min(1, amb)) : 0.6) : 0;
  };
  // build8: per-level GEM TINT — recolor the note marbles to the level identity (e.g. Skully violet).
  // Crisp cached recolor (NOT an additive wash). Built once per hex, swapped in drawNote. Falsy clears.
  let levelGemHex = null;
  const _gemTintCache = {};
  function _buildTintedGem(srcImg, hex) {
    if (!srcImg || !srcImg._ready || !srcImg.width) return null;
    const c = document.createElement('canvas'); c.width = srcImg.width; c.height = srcImg.height;
    const x = c.getContext('2d');
    x.drawImage(srcImg, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = hex; x.fillRect(0, 0, c.width, c.height);
    // CRITICAL (the user's "square marbles" report): canvas 'multiply' COMPOSITES source-over, so an
    // opaque full-canvas fill makes the ENTIRE canvas opaque — the marble became a colored SQUARE on
    // every gem-tinted level. Restore the sprite's alpha mask before the overlay passes.
    x.globalCompositeOperation = 'destination-in'; x.globalAlpha = 1; x.drawImage(srcImg, 0, 0);
    x.globalCompositeOperation = 'source-atop'; x.globalAlpha = 0.42; x.fillStyle = hex; x.fillRect(0, 0, c.width, c.height);
    // build9: the multiply tint crushes the marble's glossy core → notes sink into same-hue backdrops
    // (the Skully "hard to see" issue). Re-light a specular core so tinted gems still POP.
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-atop';
    const hg = x.createRadialGradient(c.width * 0.40, c.height * 0.36, 0, c.width * 0.46, c.height * 0.44, c.width * 0.52);
    hg.addColorStop(0, 'rgba(255,255,255,0.62)'); hg.addColorStop(0.38, 'rgba(255,255,255,0.16)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = hg; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'source-over';
    return c;
  }
  function _gemTintFor(kind) {
    // build28: theme gem-tint DISABLED — recoloring the note to the level theme made notes blend into the
    // guitar (pink-on-pink etc.). Notes are now the fixed bright per-lane gem (drawNote uses gfx.gems). Kept
    // the function + setter so the levels API stays intact, but it never tints now (the contract is locked).
    return null;
    if (!levelGemHex) return null;   // eslint-disable-line no-unreachable
    let entry = _gemTintCache[levelGemHex];
    if (!entry) entry = _gemTintCache[levelGemHex] = { normal: undefined, star: undefined };
    const slot = (kind === 'star') ? 'star' : 'normal';
    if (entry[slot] === undefined) entry[slot] = _buildTintedGem(kind === 'star' ? noteStarImg : noteImg, levelGemHex);
    return entry[slot] || null;
  }
  window.RhythmGame.setLevelGemTint = (hex) => {
    let h = null;
    if (typeof hex === 'string') {
      const s = hex.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(s)) h = s[0] === '#' ? s : '#' + s;
      else { const m = s.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
        if (m) h = '#' + [m[1], m[2], m[3]].map(n => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, '0')).join(''); }
    }
    levelGemHex = h;
  };
  // PUBLIC UI-layer API (build9): the live lane frame in PAGE coordinates (the canvas draws in CSS px,
  // so canvasRect + lane coords compose directly). Lets DOM layers — the per-level reactive cards,
  // future level UI — anchor to the playfield instead of the screen edges. Null until the canvas sizes.
  window.RhythmGame.getLaneFrame = () => {
    try {
      if (!cw || !ch) return null;
      const g = fretGeom(); const r = canvas.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height,
        nearX: g.nearX.slice(), farX: g.farX.slice(), nearY: g.nearY, farY: g.farY, lw: g.lw,
        persp: (ART.persp > 1) ? (perspOverride || ART.persp) : 0,   // versus ghost deck: match the real board's projection
        colors: LANE_COLORS.map(c => c.rgb),   // versus ghost deck: per-lane note colors so the rival deck mirrors YOUR colored notes
        warp: (warpOverride >= 0 ? warpOverride : (ART.warp || 0)) };
    } catch (e) { return null; }
  };
  // split-screen versus: when true, the guitar fits to deck HEIGHT (full runway) instead of cover-filling width.
  window.RhythmGame.setVsMode = (b) => { _vsFit = !!b; try { resize(); } catch (e) {} };
  // versus ghost deck: the current guitar image + its draw rect (canvas coords) so the opponent deck can blit
  // a dim guitar behind its strings/gems (reads as a real second board). Returns null until art + canvas are ready.
  window.RhythmGame.getGuitarArt = () => {
    try {
      if (!activeGuitarImg || !activeGuitarImg.width || !cw || !ch) return null;
      const r = guitarRect();
      return { img: activeGuitarImg, gx: r.gx, gy: r.gy, gw: r.gw, gh: r.gh, cw: cw, ch: ch,
        nutFY: ART.nutFY, bridgeFY: ART.bridgeFY, warp: (warpOverride >= 0 ? warpOverride : (ART.warp || 0)) };   // versus ghost: warp the rival guitar to match your neck-recede
    } catch (e) { return null; }
  };
  window.RhythmGame.lastResults = () => _lastResults;
  window.RhythmGame.__demoProvider = () => demoProvider;
  // build116 p3: opts.transient — apply the values in-memory (so gameplay reads them immediately) but SKIP the
  // localStorage write. Used by the MP "matched settings" fairness override so a forced-fair scroll/failMode/
  // chartMode for one ranked match never overwrites the player's own saved preference. Callers restore the real
  // settings after the match by calling applySettings() again (no opts) with the pre-match snapshot.
  window.RhythmGame.applySettings = (s, opts) => {
    var transient = !!(opts && opts.transient);
    if (s && typeof s.scroll === 'number') userScroll = Math.max(0.5, Math.min(2, s.scroll));
    if (s && typeof s.fxLite === 'boolean') fxLite = s.fxLite;
    if (s && typeof s.reduceMotion === 'boolean') { reduceMotion = s.reduceMotion; applyReduceMotion(); }
    if (s && (s.bgMode === 'performance' || s.bgMode === 'cinematic')) { bgMode = s.bgMode; applyBgMode(); }
    if (s && typeof s.music === 'number') { musicVol = Math.max(0, Math.min(1, s.music)); applyGate(); }
    if (s && typeof s.sfx === 'number') { SFX_LEVEL = Math.max(0, Math.min(0.5, s.sfx)); }
    if (s && typeof s.failMode === 'boolean') failMode = s.failMode;
    if (s && (s.chartMode === 'classic' || s.chartMode === 'musical')) chartMode = s.chartMode;
    if (s && (s.levelGuitar === 'mine' || s.levelGuitar === 'level')) levelGuitarPref = s.levelGuitar;   // "Guitar on Levels" — takes effect on next level launch
    if (s && FX_PRESETS[s.fxIntensity]) { fxIntensity = s.fxIntensity; Object.assign(JUICE, FX_PRESETS[fxIntensity]); try { localStorage.removeItem('rr_juice'); } catch (e) {} }   // picking a preset = clean reset to it
    if (!transient) { try { localStorage.setItem('rr_settings', JSON.stringify({ scroll: userScroll, fxLite: fxLite, reduceMotion: reduceMotion, bgMode: bgMode, music: musicVol, sfx: SFX_LEVEL, failMode: failMode, chartMode: chartMode, levelGuitar: levelGuitarPref, fxIntensity: fxIntensity })); } catch (e) {} }
  };
  window.RhythmGame.getSettings = () => ({ scroll: userScroll, fxLite: fxLite, reduceMotion: reduceMotion, bgMode: bgMode, music: musicVol, sfx: SFX_LEVEL, failMode: failMode, chartMode: chartMode, levelGuitar: levelGuitarPref, fxIntensity: fxIntensity });
  function applyReduceMotion() { try { document.documentElement.classList.toggle('rr-reduce-motion', reduceMotion); } catch (e) {} }
  applyReduceMotion();
  // performance background: hide + pause the moon video (kills its compositing cost so the
  // frame-rate isn't capped by video decode/compositing); the canvas atmosphere still renders.
  function applyBgMode() {
    try {
      const perf = bgMode === 'performance';
      document.documentElement.classList.toggle('rr-perf-bg', perf);
      ['bg-video', 'bg-video-fill', 'start-video'].forEach((id) => {
        const v = document.getElementById(id);
        if (!v) return;
        if (perf) { try { v.pause(); } catch (e) {} }
        else { try { v.play(); } catch (e) {} }
      });
    } catch (e) {}
  }
  applyBgMode();
  // keep the in-game footer hint AND the How-to-Play key legend in sync with the (remappable) lane keys.
  // build70 (launch-audit P3): #howto-keys was hardcoded A S D J K and never reflected a remap — route it
  // through the same source of truth so both update on boot, lane-profile change, every rebind, and reset.
  function updateFooterHint() {
    let h = ''; for (let l = 0; l < LANE_COUNT; l++) { const k = keyForLane(l); h += '<kbd>' + (k ? (k === ' ' ? '␣' : k.toUpperCase()) : '—') + '</kbd>'; }
    const fe = document.getElementById('footer-keys'); if (fe) fe.innerHTML = h;
    const he = document.getElementById('howto-keys'); if (he) he.innerHTML = h;
  }
  updateFooterHint();

  // Boot the lane profile: ?gh=1 forces 5-string Guitar-Hero mode; otherwise restore the saved choice.
  // Standard (6-lane keyboard) users hit NO new code path — applyLaneProfile only runs for gh.
  (function bootLaneProfile() {
    // THE GAME IS 5-LANE, PERIOD (owner decree 2026-06-09, hardened 2026-07-02): the legacy 6-string 'standard'
    // profile is fully RETIRED from the UI — the Settings "Lane Mode" toggle is gone (owner: "we don't do six
    // strings") and every stored/URL escape hatch is force-migrated to gh. LANE_PROFILES.standard stays as inert
    // engine plumbing only (dev hook __rrLaneMode can still reach it for archaeology).
    try { if (localStorage.getItem('rr_lanemode') === 'standard') localStorage.setItem('rr_lanemode', 'gh'); } catch (e) {}
    applyLaneProfile('gh');
    try { const pm = location.search.match(/[?&]persp=([0-9.]+)/); if (pm) perspOverride = parseFloat(pm[1]) || 0; } catch (e) {}
    try { const wm = location.search.match(/[?&]warp=([0-9.]+)/); if (wm) warpOverride = parseFloat(wm[1]); } catch (e) {}
    try { if (/[?&]align=1/.test(location.search)) window.__rrAlign = true; } catch (e) {}   // dev: draw lane guides (strip at freeze)
  })();

  function resetScoring() {
    score = 0; combo = 0; maxCombo = 0; comboTierCur = 0; scoreDisplay = 0; runFailed = false;
    _peakCombo = 0; _lastBreakPeak = 0; _clutchCount = 0; _clutchArmed = false;   // build122 p1: CLUTCH per-run state
    _missCursor = 0;   // build60 PERF: fresh run → miss-sweep cursor points at the first (unjudged) note
    counts = { perfect: 0, great: 0, good: 0, miss: 0 }; _timingSamples = []; _pendFullChord = [];
    wastedInputs = 0;   // build108 s4: reset the display-only sloppiness counter each run
    _g1MissTimes = []; _paceSamples = []; _paceBucket = 0;   // G-1/G-3 results-only trackers → fresh per run
    _phraseHit = {}; _phraseDone = {};   // A2 STARSTRUCK: phrase completion tracking is per-run (cosmetic; never scoring)
    // B2 ENCORE CHAIN: a run launched via the ENCORE button (accepting) KEEPS the chain; every other launch resets it to 0.
    if (_encoreAccepting) { _encoreAccepting = false; } else { _encoreChain = 0; }
    _endingLock = false;   // build108: a fresh run always starts unlocked
    stability = 1.0; particles = []; cameraShake = 0; glitchAmount = 0;
    if (fx) { try { fx.clear(); } catch (e) {} }
    _auraFx = null; _odAura = null; _readyRings = null; _holdFxL = [];   // build8b/c: instances cleared with fx.clear() → drop refs so they respawn
    _multFireL = []; _fxGen++;   // build13: drop fire refs + kill any queued wave spawns from the old run
    bossPhase = 1; bossPhaseShown = false;
    bgPulse = 0; lanePulse = Array(LANE_COUNT).fill(0); laneHitPulse = Array(LANE_COUNT).fill(0);
    missFlash = 0; wipeoutT = 0; stringsCold = 0; missTimes = []; lastWipeout = -9;
    laneDesat = Array(LANE_COUNT).fill(0); catcherRecoil = Array(LANE_COUNT).fill(0);
    lanePluckT = Array(LANE_COUNT).fill(9); muteUntil = -1; curGain = 1; overdrive = 0;
    laneDown = Array(LANE_COUNT).fill(false); holdNote = Array(LANE_COUNT).fill(null); _mpStunUntil = 0;
    _frets.clear();   // GH require-strum: clear held-fret state at every run boundary so a stale fret can't carry into the next run (B78-1)
    holdScored = Array(LANE_COUNT).fill(0); holdSparkT = Array(LANE_COUNT).fill(0); holdRailSeg = Array(LANE_COUNT).fill(0);
    odActive = false; odTimer = 0; odIgniteT = 0; lastMult = 1; odReadyAnnounced = false; _flowShieldCount = 0;   // build109 s3: a run boundary must not leave the OD wind-up armed to fire into the next run · build148: reset Flow-Shield tally
    odOvercharge = 0; _odScoreAtFire = 0; _odHitsAtFire = 0; _odLastGain = 0; _odTotalGain = 0; _odBestGain = 0; _odNotesTotal = 0;   // Wave-3 finding 2/3: render+stats trackers fresh per run
    _holdCleanN = 0; _holdAttemptM = 0; _cleanHoldStreak = 0;   // Wave-3 finding 4: clean-hold trackers fresh per run
    { const odf = $('od-flame'); if (odf) { odf.classList.remove('ready', 'active'); odf.style.boxShadow = ''; } }
    updateHUD();
    // build85 (Phase 3.1): light the BEST chip from the stored per-song best (the thing to chase)
    try {
      const _be = $('hud-best');
      const _id = window.RhythmCatalog && window.RhythmCatalog.currentTrackId && window.RhythmCatalog.currentTrackId();
      const _bb = (_id && window.RhythmCatalog.getBest) ? window.RhythmCatalog.getBest(_id) : null;
      if (_be) {
        if (_bb && _bb.score > 0) { _be.textContent = 'BEST ' + _bb.score.toLocaleString(); _be.hidden = false; _be.classList.remove('beaten'); _be._best = _bb.score; }
        else { _be.hidden = true; _be._best = 0; }
      }
    } catch (e) {}
    // RIFT REPLAY: clear the replay ring at every run boundary so a clip only covers the current run (additive, guarded).
    try { if (window.RhythmReplay) window.RhythmReplay.reset(); } catch (e) {}
  }

  let _playGen = 0;   // build57: launch-generation token — a newer beginPlay() invalidates older ones (see guards below)
  async function beginPlay() {
    // build35 (audit P1): make (re)launch idempotent — stop any in-flight run FIRST so a second
    // play() / double-tap / future MP click can't spawn a SECOND self-perpetuating rAF + scoring loop
    // (double scoring + overlapping audio). stopGame() cancels the live rafId and stops the player.
    stopGame();
    // build57: tag THIS launch. The session build + prepare + countdown below are all awaited, and a
    // second launch during any of them tears down `player`/state — a stale beginPlay resuming would then
    // crash on `player.onended` (null) or, worse, arm onended + start a SECOND loop on the new player.
    // Bail at each await boundary if a newer launch superseded us.
    const myGen = ++_playGen;
    // (re)build session — fresh play_token + player each attempt (live anti-cheat)
    session = await provider();
    if (myGen !== _playGen) return;        // superseded while fetching/decoding/charting
    beats = session.beats || [];
    songDuration = session.duration || 0;
    player = session.player;
    // build114: AUTHORITATIVE MP CHART — if startAt() staged an injected note array (host-broadcast chart),
    // consume it INSTEAD of buildNotes()/beats so host + guest play the identical chart (was: each seat's own
    // decodeAudioData/analyzeChart, which can silently diverge across browsers/OS — the MP note-gap root cause).
    // beats-emptiness is only a hard failure on the LOCAL-CHART path — an injected chart stands on its own.
    if (!_injectedNotes && !beats.length) throw new Error('This track could not be charted — try another');   // build72: player-facing (was the dev string "No beats in chart" shown verbatim in the launch-fail toast)

    // SNAPSHOT-AND-SWAP (mirrors chartUrlForSpectate's try/finally pattern): consuming _injectedNotes must NEVER
    // leak into a later run that bypasses this seam. _injectedNotes itself is cleared unconditionally right here
    // (single-use per launch) so a stale value can't survive into the NEXT beginPlay() no matter how this one ends.
    const _useInjected = !!(_injectedNotes && _injectedNotes.length);
    const _injSnapshot = _injectedNotes;
    _injectedNotes = null;   // one-shot: consumed now, cleared immediately — can't leak forward even on throw
    if (_useInjected) {
      notes = _injSnapshot;   // already fully-rehydrated note objects (time/lane/type/hold/chord/.../judged/hit) — see multiplayer.js resolveAndStart
    } else {
      buildNotes();
    }
    // ---- PRACTICE section filter (AFTER buildNotes so the chart is unchanged; only WHICH notes are live differs).
    // Never runs on a normal launch (_practiceOn false) → default path byte-identical.
    // build141 P0 (tester: a ~10s section "failed to start the match"): CLAMP the requested section to the ACTUAL
    // decoded buffer (songDuration) FIRST. The practice panel clamps to track.duration_seconds METADATA, which can
    // exceed the real decoded length (a truncated / preview audio_url). A start past the buffer made DemoPlayer.play()
    // clamp the seek offset to the tail 50ms → the source ended instantly → practiceRearm() → a rapid re-arm STORM
    // that never visibly starts. Clamp end into the buffer, keep the start ≥1s inside it, and if the window collapses
    // (section was essentially past the song) fall back to whole-song practice — never storm, never throw.
    if (_practiceOn && _practiceSection && songDuration > 0) {
      const _pEnd = Math.min(_practiceSection.end, songDuration);
      const _pStart = Math.max(0, Math.min(_practiceSection.start, _pEnd - 1.0));
      _practiceSection = (_pEnd - _pStart >= 1.0) ? { start: _pStart, end: _pEnd } : null;
    }
    if (_practiceOn && _practiceSection) _applyPracticeSection();
    // build141 (tester: "first notes already down at the start"): LEAD-IN RUNWAY — guarantee the first note APPROACHES
    // from the top of the highway instead of spawning mid-screen at the strike line. The note clock is welded to audio
    // time, so a note at song-time T can't get runway unless the clock is already ~`approach` seconds ahead of it.
    //  • SECTIONED practice: PRE-ROLL the audio a hair before the section start (a musical count-in) so the section's
    //    first note falls the full highway. No section note is dropped. (_practicePreroll consumed by _go/practiceRearm.)
    //  • NORMAL local runs (+ whole-song practice) start the clock at 0 and CAN'T seek before it — so drop any note inside
    //    the opening runway window; the intro then plays while the first surviving note travels the full runway. Most charts
    //    already open later than this, so the common path is untouched. Never empties a <runway-length clip.
    // MP SAFETY: the drop is SKIPPED for an injected (host-authoritative) chart and any live MP run — the runway depends on
    // the LOCAL userScroll, which can differ per peer, so dropping would desync the two seats' charts (the note-gap bug).
    // MP first-note runway is the host's problem to bake; here we only guard peer byte-identity.
    _practicePreroll = 0;
    const _mpLiveNow = !!(window.RhythmMP && window.RhythmMP.isLive && window.RhythmMP.isLive());
    if (notes.length) {
      const _runway = _runApproach() + 0.35;   // full top-of-highway travel + a hair so the first gem eases in from the very top
      if (_practiceOn && _practiceSection) {
        _practicePreroll = Math.min(_runway, _practiceSection.start);   // seek back this far (clamped so it never goes below buffer 0)
      } else if (!_useInjected && !_mpLiveNow && notes[0].time < _runway) {
        let _i = 0; while (_i < notes.length && notes[_i].time < _runway) _i++;
        if (_i > 0 && _i < notes.length) notes = notes.slice(_i);   // keep everything from the first runway-clear note on (chords share a time → never split)
      }
    }
    resetScoring();

    // update HUD meta
    $('hud-diff').textContent = DIFFICULTY[difficulty].name;
    if (session.meta) {
      // guard a null/empty artist exactly like the results label (game.js ~3225): only append ' — artist'
      // when it's truthy, else show just the title (a null artist was printing the literal "Title — null").
      $('hud-track').textContent = session.meta.artist ? (session.meta.title + ' — ' + session.meta.artist) : session.meta.title;
    }
    _updatePracticeHud();   // PRACTICE: show/hide the unmistakable "not scored" tag + section/speed readout

    showScreen('game');
    // build10b/18: LEVEL-START CINEMATIC — the backdrop opens slightly zoomed and eases out
    // (CSS .rr-cine) while the guitar MATERIALIZES along the highway during the countdown.
    // build18 (user polish order): EVERY level gets the entrance now — the default included —
    // and the catcher row IGNITES L→R the moment the print completes (see render's crossing).
    if (!reduceMotion) {
      _skinBuildT = 0;
      try { const _gc = $('game'); _gc.classList.add('rr-cine'); setTimeout(() => { try { _gc.classList.remove('rr-cine'); } catch (e) {} }, 2900); } catch (e) {}
    } else { _skinBuildT = 1; }
    resize();
    layoutTapZones();   // canvas is now visible & sized — pin touch lanes under the buttons
    // belt-and-suspenders: the grid/flex layout may not have its final width on this very
    // frame, so re-pin once it settles (rAF) and again shortly after, when cw is reliable.
    requestAnimationFrame(() => { resize(); layoutTapZones(); });
    setTimeout(() => { resize(); layoutTapZones(); }, 60);

    await player.prepare();
    if (myGen !== _playGen || !player) return;   // superseded during prepare
    // build64 (user request): let the level backdrop / journey ANIMATE IN before anything starts. The .rr-cine entrance zoom
    // (~2.7s, armed above) + the journey loop are easing in right here; hold ~2s so the player is never hit with notes over a
    // still-animating screen. SYNC-SAFE: audio AND the note-spawn clock both anchor on player.play() below, so delaying the
    // countdown + play shifts BOTH together with zero drift (no offset math). Single-player only — skipped in MP so the
    // cross-peer round start isn't thrown off. The gen-guard after it is mandatory (a level exit/relaunch during the 2s
    // buffer would otherwise orphan a second loop / double audio).
    // build108 s1 (owner playtest-3: "guitar not fully animated in, notes come down before you're ready"): the digit
    // countdown itself is short again (3·2·1, see runCountdown), so THIS wait is now what guarantees the guitar/neck
    // GUITAR-IN phase (_skinBuildT 0→1 over 2.0s, driven in render()) actually finishes before the 3·2·1 starts —
    // sequence is guitar-in → count → notes, never overlapping. 2100ms covers the 2.0s materialize + margin.
    if (!reduceMotion && !(window.RhythmMP && window.RhythmMP.isLive && window.RhythmMP.isLive())) {
      await new Promise(r => setTimeout(r, 2100));
      if (myGen !== _playGen || !player) return;
    }
    await runCountdown();
    if (myGen !== _playGen || !player) return;   // superseded during the 3·2·1 countdown (the common case)

    // PRACTICE: a natural buffer-end (section == full song, or drilling the whole song at a speed) LOOPS back to
    // the section start instead of ending the run — practice is a repeating drill, not a scored playthrough.
    player.onended = () => { if (state === 'playing') { if (_practiceOn) practiceRearm(); else endGame(); } };
    // PRACTICE: apply the chosen playback SPEED to the audio buffer BEFORE it starts (rate-scaled getTime keeps
    // note-time ↔ audio-time in sync). A normal run leaves rate at 1 → byte-identical.
    try { if (player.setRate) player.setRate(_practiceOn ? _practiceRate : 1); } catch (e) {}
    // re-arm audio: the countdown delay can let mobile browsers re-suspend the
    // context that the tap gesture unlocked, which would start the song silent.
    try { const ac = getAC(); if (ac.state === 'suspended') await ac.resume(); } catch (e) {}
    if (myGen !== _playGen || !player) return;   // build57: the resume() above can await (suspended ctx, mobile) — re-check before play()/loop() so a superseded launch can't orphan a second self-re-arming loop / double-play audio
    muteUntil = -1; curGain = 1; applyGate();
    // build65 (cycle-4 FIX): the actual run-start, as a thunk. If a pause landed DURING the lead-in / 3·2·1 pre-roll (Esc /
    // mobile pause / window-blur / tab-hide all set state='paused' while we were awaiting the 2s buffer + countdown), do NOT
    // force the song to start behind the now-stuck PAUSED overlay — stash the start and let resumeGame() run it on resume.
    const _go = () => {
      // PRACTICE: seek the audio to the section start (DemoPlayer.play(offset) is the existing spectator seek
      // primitive; getTime() stays absolute song-buffer time because _start is back-dated by the offset). A normal
      // run passes no offset (undefined) → play() starts at 0, byte-identical.
      const _pOff = (_practiceOn && _practiceSection) ? Math.max(0, _practiceSection.start - _practicePreroll) : undefined;   // build141: seek to a hair BEFORE the section (musical count-in) so the first note approaches from the top
      player.play(_pOff);
      state = 'playing';
      // build104 s1b: SEED audio-latency compensation for devices that never calibrated. Chrome reports the real
      // hardware output latency only once the context is LIVE (0/jittery at construction — hence here, not at boot).
      // A saved manual calibration (rr_offset_ms) ALWAYS wins; the seed is session-only (never persisted) and clamped
      // to [0, 120ms] so a bogus report can't skew judging. Leaderboard-neutral: it corrects a device artifact,
      // exactly like the existing calibration slider.
      try {
        if (localStorage.getItem('rr_offset_ms') == null) {
          const _lac = (player && player.ctx) || getAC();
          audioOffset = Math.min(0.12, Math.max(0, _lac.outputLatency || _lac.baseLatency || 0));
        }
      } catch (e) {}
      try { if (anyPadConnected()) _ensureFastPoll(); } catch (e) {}   // build102w/104 s3: run begin = arm the ~4ms input poller HERE for any connected pad (not only in loop() — a throttled rAF must not delay first-press latency)
      try { window.RhythmProcBg && window.RhythmProcBg.play(); } catch (e) {}   // build66: drive the procedural reactive backdrop in lockstep (covers the deferred pre-roll resume too)
      // telemetry: song_start — the run actually begins (audio + chart playing). NON-PII (track id + difficulty only).
      try {
        if (window.RhythmTelemetry && window.RhythmTelemetry.event) {
          var _tid = (session && (session.trackId || (session.meta && session.meta.id))) || null;
          window.RhythmTelemetry.event('song_start', { trackId: _tid, difficulty: difficulty, boss: !!bossMode });
        }
      } catch (e) {}
      lastFrame = performance.now();
      loop();
    };
    if (state === 'paused') { _deferredStart = _go; return; }
    _go();
  }

  async function runCountdown() {
    const el = $('countdown');
    screens.countdown.classList.add('active');
    // build84 (3B-ii): ONE-TIME tap-zone coachmark. On a touch device, the FIRST time a player ever
    // reaches a 3·2·1, pulse the lane outlines + a "TAP THE LANES" caption so they learn where to
    // press. localStorage-gated → shown exactly once, ever. layoutTapZones() has already pinned the
    // buttons to the live lane x-positions, so the coach glow rides the real columns. The finally
    // strips it so a superseded/aborted countdown can never leave the pulse stuck on.
    const _tz = $('tap-zones');
    // build89: tag this countdown with the launch generation. A rapid re-launch (++_playGen) supersedes it;
    // bail after each await BEFORE touching the shared #countdown node so two countdowns can't race / flicker
    // / hide the newer overlay mid-count. (Scoring was already gen-safe; this fixes only the visual race.)
    const myGen = _playGen;
    try {
      if (_tz && document.body.classList.contains('has-touch') && !localStorage.getItem('rr_tapcoach_seen')) {
        layoutTapZones();                 // ensure outlines sit on the current lane geometry
        _tz.classList.add('coach');
        try { localStorage.setItem('rr_tapcoach_seen', '1'); } catch (e) {}
      }
    } catch (e) {}
    try {
      // build83: a "GET READY" beat + a "GO!" punch bracket the 3·2·1 (single-player previously had only digits;
      // MP already cued GET READY). Words render smaller than the big digits so they fit the slot.
      el.textContent = 'GET READY';
      el.style.fontSize = 'clamp(26px, 7vw, 64px)';
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      await new Promise(r => setTimeout(r, 650));
      if (myGen !== _playGen) return;   // superseded — leave the new countdown's node untouched
      el.style.fontSize = '';   // digits revert to the big CSS default size
      for (let i = 3; i >= 1; i--) {   // build108 s1 (owner playtest-3: "counts down from 10, too long"): 3·2·1·GO — the guitar-in
        // phase (below, before runCountdown is called) now owns getting the player oriented, so the digit count itself
        // can be short and punchy again. ~2.5-3s total pre-song (GET READY 650ms + 3·2·1 @ 700ms + GO 320ms).
        el.textContent = i;
        el.style.fontSize = '';
        el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
        await new Promise(r => setTimeout(r, 700));
        if (myGen !== _playGen) return;
      }
      el.textContent = 'GO!';
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      await new Promise(r => setTimeout(r, 320));
      if (myGen !== _playGen) return;
      el.style.fontSize = '';
      screens.countdown.classList.remove('active');
    } finally {
      if (_tz) _tz.classList.remove('coach');
    }
  }

  function stopGame() {
    state = 'menu';
    _endingLock = false;   // build108: a quit/exit DURING the fail-out wipeout beat must not leave input/scoring stuck locked for the next run
    try { window.RhythmProcBg && window.RhythmProcBg.stop(); } catch (e) {}   // build66: idle the reactive backdrop on quit / song-end
    _deferredStart = null;   // build65 (cycle-4): drop any pre-roll deferred-start so a quit during a paused pre-roll can't fire it later
    if (player) { try { player.onended = null; player.stop(); } catch (e) {} player = null; }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    // build108 (owner-flagged, hit live twice): "broken UI before the multiplayer results screen" — the rAF loop
    // stopped here, but the screen-space JUICE state (particles/shake/glitch/wipeout/etc.) only zeroed in
    // resetScoring() at the NEXT run's start, so the abandoned canvas stayed frozen on whatever mid-effect frame
    // was live (a hit burst, maxed shake, glitch tears) — that garbled frame bled through the results crossfade.
    // failRun() made it worse by slamming shake/glitch to MAX the same tick it calls endGame()→stopGame(). Mirrors
    // resetScoring()'s clear-list (same var names) — a hard reset here + one calm final paint below settles the
    // canvas before showScreen('results') crossfades over it. Covers song-end, fail-out, AND every quit/abort path
    // that routes through stopGame() (this function is the single funnel).
    particles = []; cameraShake = 0; glitchAmount = 0; bgPulse = 0;
    missFlash = 0; wipeoutT = 0; stringsCold = 0; odBurst = 0;
    if (fx) { try { fx.clear(); } catch (e) {} }
    _auraFx = null; _odAura = null; _readyRings = null; _holdFxL = []; _multFireL = [];
    try { render(0, false); } catch (e) {}   // one calm final paint so the abandoned canvas isn't a stale garbled bitmap
    // v258: clear any pending MP-combat stun so a veil + dangling hide-timer can't linger past teardown (resetScoring
    // also zeroes _mpStunUntil before the next play; this is the exit-mid-stun belt-and-suspenders).
    clearTimeout(_stunHideT); _stunHideT = 0; _mpStunUntil = 0;
    try { const _se = document.getElementById('mp-stun'); if (_se) { _se.classList.remove('show'); _se.setAttribute('aria-hidden', 'true'); } } catch (e) {}
    // build102y review fix D: the BEAT THAT ghost target dies with the RUN, whatever ended it. It was cleared only
    // in endGame(), but the pause-menu EXIT path calls stopGame() directly — the stale target (+ #ghost-target pill)
    // then leaked into any later run that bypasses launchTrack (MP startAt, playDemo, show runs) with a spurious
    // BEAT IT! flash mid-versus. endGame calls stopGame first, so this ONE clear covers song-end, fail-out, and
    // every quit/abort path. (A mid-run RESTART also lands here — restart = a fresh run, one-run contract holds.)
    try { if (_ghostTarget) { _ghostTarget = null; _ghostBeat = false; const _ge = $('ghost-target'); if (_ge) _ge.remove(); } } catch (e) {}
    // PRACTICE: hide the "not scored" tag on any teardown. A practice RE-ARM re-shows it immediately (beginPlay →
    // _updatePracticeHud), so a section-loop won't flicker it off; only a genuine exit-to-menu leaves it hidden.
    try { if (!_practiceArming) { const _pt = document.getElementById('practice-tag'); if (_pt) _pt.hidden = true; } } catch (e) {}
  }

  // ---- PRACTICE: keep only the notes whose HEAD lands in [start, end); preserve time-sort + chord/hold integrity.
  // Called from beginPlay() AFTER buildNotes(), so `notes` is already ascending-by-time. A pure inclusive-lower /
  // exclusive-upper filter keeps that order (we never reorder), so the miss-sweep's ascending-time assumption holds.
  // • CHORD integrity: every member of a chord shares n.time, so a per-note head test passes/fails the WHOLE chord
  //   together automatically. We still do an explicit chordId union pass (belt-and-suspenders) so a chord is
  //   all-in-or-all-out even if a future chart ever desyncs partner times.
  // • HOLD integrity: a hold whose HEAD is in range but whose TAIL (time+hold) exceeds `end` is CLAMPED to end so
  //   the sustain can't run past the loop boundary.
  function _applyPracticeSection() {
    const sec = _practiceSection; if (!sec) return;
    const start = sec.start, end = sec.end;
    // 1) collect chordIds that have ANY member head in range → those chords are fully included.
    const keepChord = Object.create(null);
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.chord && n.chordId != null && n.time >= start && n.time < end) keepChord[n.chordId] = 1;
    }
    // 2) single forward pass (input already sorted → output stays sorted; no re-sort needed).
    const out = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const inRange = (n.time >= start && n.time < end);
      const keep = inRange || (n.chord && n.chordId != null && keepChord[n.chordId]);
      if (!keep) continue;
      if ((n.type === 'hold' || n.type === 'rail') && n.hold > 0 && (n.time + n.hold) > end) {
        n.hold = Math.max(0.05, end - n.time);   // clamp the sustain tail to the section boundary (min a hair so it stays a hold)
        // SLIDE RAILS: drop any waypoint at/after the clamped tail (keep invariant 1); a truncated rail below
        // RAIL_MIN_LEN degrades to a plain hold so a clipped section never leaves a half-rail.
        if (n.type === 'rail' && n.rail) {
          while (n.rail.length > 1 && n.rail[n.rail.length - 1].t >= n.hold) n.rail.pop();
          if (n.rail.length < 2 || n.hold < RAIL_MIN_LEN) { n.type = 'hold'; delete n.rail; }
        }
      }
      out.push(n);
    }
    notes = out;
    try { if (window.__rrChartStats) window.__rrChartStats.practiceCharted = notes.length; } catch (e) {}
  }

  // ---- PRACTICE: reset the per-NOTE runtime flags on the current (already section-filtered) chart so a re-arm
  // starts each rep with every note un-judged, without re-running buildNotes()/_applyPracticeSection(). The section
  // + speed never change across a loop, so the current `notes` array IS the correct subset (hold tails already
  // clamped, idempotently). Clears exactly the fields play() writes: judged/hit/_pulsed/dropped + any live bomb FX.
  function _practiceResetNotes() {
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      n.judged = false; n.hit = null; n._pulsed = false;
      if (n.dropped) n.dropped = false;
      if (n._fuseFx) { try { n._fuseFx.stop(); } catch (e) {} n._fuseFx = null; }
      if (n._warnFx) { try { n._warnFx.stop(); } catch (e) {} n._warnFx = null; }
    }
  }

  // ---- PRACTICE: SHORT re-arm lead-in (used ONLY on re-arms, NOT the first Start-Practice launch). A brief "GO"
  // beat reorients the player without the full ~2.1s guitar-in wait + 3·2·1. Gen-guarded so a superseded re-arm
  // leaves the newer countdown node untouched. ~650ms total — snappy loop feel.
  async function runCountdownShort(myGen) {
    const el = $('countdown');
    if (!el) return;
    screens.countdown.classList.add('active');
    try {
      el.textContent = 'GO!';
      el.style.fontSize = '';
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      await new Promise(r => setTimeout(r, 650));
      if (myGen !== _playGen) return;   // superseded mid-lead-in → don't touch the newer countdown
      screens.countdown.classList.remove('active');
    } catch (e) { try { screens.countdown.classList.remove('active'); } catch (_) {} }
  }

  // ---- PRACTICE: FAST re-arm — auto-retry on section-end / natural-end / wipeout, plus the pause "Restart Section"
  // button. Keeps the live provider + player + DECODED BUFFER + session (NO re-decode, NO showScreen('loading'), NO
  // ~2.1s guitar-in wait, NO 3·2·1) — only a short "GO" lead-in. Explicitly replicates the per-run state reset that
  // beginPlay() would otherwise do (resetScoring() clears combo/score/multiplier/holdNote/_missCursor/particles/FX/
  // clutch+streak; _practiceResetNotes() clears the per-note judged/hit flags) so a rep starts truly fresh.
  //
  // DOUBLE-REARM RACE GUARD: the loop() t>=end path and the player.onended path can BOTH fire near a section end.
  // Both funnel through this ONE function; the _practiceArming latch makes a concurrent 2nd call a no-op, and the
  // ++_playGen bump immediately supersedes the OLD run — so a stale onended/loop from the prior rep that fires after
  // we've begun re-arming sees myGen !== _playGen (in the async lead-in) OR bails on the _practiceArming latch, and
  // can never spawn a 2nd AudioBufferSourceNode or a 2nd loop. The latch clears only after the new run has started
  // (or on any bail), and the source is stopped BEFORE we create the next one, so there is never double audio.
  function practiceRearm() {
    if (!_practiceOn) return;
    if (_practiceArming) return;               // a concurrent re-arm (loop vs onended) already owns this rep
    // Fast path requires a live player + decoded buffer + session. If any is missing (hard teardown happened), fall
    // back to the full launch so a re-arm is never left dead — correctness over speed in that rare edge.
    if (!player || !session || !(player.play && player.stop)) {
      _practiceArming = true;
      try { stopGame(); } catch (e) {}
      Promise.resolve().then(() => beginPlay()).finally(() => { _practiceArming = false; });
      return;
    }
    _practiceArming = true;
    const myGen = ++_playGen;                  // supersede the OLD rep immediately (stale loop()/onended now no-ops)
    try {
      state = 'paused';                        // freeze the loop instantly (loop() returns on non-'playing')
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      _deferredStart = null;
      // stop the current source WITHOUT the full stopGame() teardown (keep player/session/provider/buffer/skin/theme).
      try { player.onended = null; player.stop(); } catch (e) {}
      try { window.RhythmProcBg && window.RhythmProcBg.stop(); } catch (e) {}
      // fresh per-run + per-note state (the reason the first version used a full teardown — replicated here).
      resetScoring();
      _practiceResetNotes();
      _missCursor = 0;
      updateHUD();
      _updatePracticeHud();
    } catch (e) { _practiceArming = false; state = 'menu'; return; }
    // short lead-in, then start — mirrors _go()'s audio-start + loop kickoff. Gen-guarded end-to-end.
    (async () => {
      try {
        try { const ac = getAC(); if (ac.state === 'suspended') await ac.resume(); } catch (e) {}
        if (myGen !== _playGen) return;        // a newer re-arm/launch superseded us during resume()
        await runCountdownShort(myGen);
        if (myGen !== _playGen) return;        // superseded during the lead-in → do not start a stale source/loop
        muteUntil = -1; curGain = 1; applyGate();
        const off = (_practiceSection ? Math.max(0, _practiceSection.start - _practicePreroll) : undefined);   // build141: same count-in seek on every re-arm so each rep's opening note has full runway
        try { if (player.setRate) player.setRate(_practiceRate); } catch (e) {}
        // re-arm onended → loop again on the next natural end (fresh closure over this player instance).
        player.onended = () => { if (state === 'playing') { if (_practiceOn) practiceRearm(); else endGame(); } };
        player.play(off);
        state = 'playing';
        try { if (anyPadConnected()) _ensureFastPoll(); } catch (e) {}
        try { window.RhythmProcBg && window.RhythmProcBg.play(); } catch (e) {}
        lastFrame = performance.now();
        loop();
      } catch (e) { try { console.error(e); } catch (_) {} }
      finally { _practiceArming = false; }     // clear the latch only after the new rep is live (or bailed)
    })();
  }

  function restartGame() {
    // PRACTICE: a restart during a practice run re-arms the SAME section+speed (never a scored full run).
    if (_practiceOn) { practiceRearm(); return; }
    // build114 review: if THIS run used a host-broadcast authoritative chart (a live 1v1/room MP match), re-arm it
    // so a RESTART/REPLAY replays the IDENTICAL chart. Without this, the one-shot _injectedNotes is already consumed,
    // so bare beginPlay() would run a FRESH local buildNotes() that can diverge from the opponent's decoder output —
    // the exact drift bug the authoritative broadcast fixes. No-op for solo/tournament/guest-local-fallback (the
    // cache is null there, so the restart re-charts locally exactly as before — no regression).
    if (_lastInjectedNotes && _lastInjectedNotes.length) { _injectedNotes = _lastInjectedNotes; }
    stopGame(); beginPlay();
  }

  // Boss Stage drains the meter harder — and harder still once ENRAGED (phase 2).
  function bossDrain(base) { return bossMode ? base * (bossPhase === 2 ? 2.4 : 1.8) : base; }

  // optional fail-out (Settings → Fail Mode): the stability meter emptied → the run collapses
  // build108 (owner-flagged freeze-frame bug): this used to slam cameraShake/glitchAmount to MAX and call
  // endGame() the SAME synchronous tick — loop() never got another frame to decay them, so the abandoned canvas
  // froze at peak shake/glitch for the entire results crossfade. Now: freeze scoring/input immediately
  // (_endingLock, checked by onLaneInput + loop's note-judging block) so the run can't keep changing after it's
  // already lost, but let the wipeout beat actually ANIMATE for ~550ms (loop()'s FX-decay code stays outside the
  // _endingLock guard, so cameraShake/glitchAmount visibly settle) before tearing down into results.
  function failRun() {
    if (runFailed || state !== 'playing') return;
    // PRACTICE: a practice run NEVER fails out — a wipeout just LOOPS the section (auto-retry). Fail Mode is a
    // scored-run mechanic; drilling shouldn't eject you. Re-arm the section instead of running the fail teardown.
    if (_practiceOn) { practiceRearm(); return; }
    runFailed = true; _endingLock = true;
    cameraShake = Math.max(cameraShake, 14); glitchAmount = 1;
    flashJudgment('SIGNAL LOST', '#ff1f2e');
    // build108 review fix (critical): only end THIS still-live failed run. A restart/quit during the beat resets
    // runFailed (resetScoring) or state, so a stale timer can't end a fresh run; and pause is now blocked during the
    // beat (see pauseGame) so state stays 'playing' and endGame's re-entry guard passes.
    setTimeout(() => { if (!runFailed || state !== 'playing') return; _endingLock = false; endGame(); }, 550);
  }

  // ---------- RATINGS show-hook (Fable v2 D1) ------------------------------------------------------------------
  // The #results-rate widget (markup + CSS live in index.html) is un-hidden ~1.2s AFTER the grade ceremony lands,
  // on a REAL run ONLY — the SAME real-run gate catalog.recordLocal uses: NOT practice, NOT preview, NOT an MP round,
  // and a real catalog trackId (the demo / no-track runs return null). Practice/preview/MP/demo keep it hidden.
  // Held-safe: pure additive UI — persistence is delegated to RhythmCatalog.rateTrack (local-first, POSTs when signed
  // in). It NEVER touches score/grade/leaderboard. Handlers are bound ONCE (delegated on the two radiogroups).
  var _ratingsBound = false, _ratingsShowT = 0;
  var _rateTid = null, _rateDiff = null, _rateAcc = null;
  // eligibility → the trackId to rate, or null to SUPPRESS (mirrors recordLocal's real-run gate).
  function _ratingsTidFor(results) {
    try {
      if (!results) return null;
      if (results.practice || results.isPractice) return null;                                   // practice drill
      if (results.preview || results._preview) return null;                                       // host-review PREVIEW (recordLocal early-returns on it)
      if (window.RhythmMP && window.RhythmMP.isLive && window.RhythmMP.isLive()) return null;      // MP round
      var tid = (window.RhythmCatalog && window.RhythmCatalog.currentTrackId && window.RhythmCatalog.currentTrackId()) || null;
      return tid || null;                                                                          // demo / no real track → null
    } catch (e) { return null; }
  }
  function _rrRateEl(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function _paintStars(v) {
    var wrap = _rrRateEl('rr-rate-stars'); if (!wrap) return;
    wrap.querySelectorAll('.rr-star').forEach(function (b) {
      var on = (parseInt(b.getAttribute('data-v'), 10) || 0) <= v;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  function _paintFeel(v) {
    var wrap = _rrRateEl('rr-rate-feel'); if (!wrap) return;
    wrap.querySelectorAll('.rr-chip').forEach(function (b) {
      var on = (parseInt(b.getAttribute('data-v'), 10) || 0) === v;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  // one small gold pulse on the just-selected control (Web Animations API — no CSS dependency; self-cleaning; guarded).
  function _goldPulse(el) {
    try {
      if (!el || !el.animate) return;
      el.animate(
        [ { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.28)', filter: 'brightness(1.55) drop-shadow(0 0 6px rgba(224,169,63,0.9))', offset: 0.4 },
          { transform: 'scale(1)', filter: 'brightness(1)' } ],
        { duration: 340, easing: 'cubic-bezier(.2,.7,.2,1)' }
      );
    } catch (e) {}
  }
  function _submitRating(opts, el) {
    var out = null;
    try {
      if (_rateTid && window.RhythmCatalog && window.RhythmCatalog.rateTrack) {
        out = window.RhythmCatalog.rateTrack(_rateTid, Object.assign({ difficulty: _rateDiff, acc: _rateAcc }, opts));
      }
    } catch (e) {}
    _goldPulse(el);
    try { _tlog('rating_submit', { stars: (opts && opts.stars) || null, felt: (opts && opts.felt) || null, acc: _rateAcc }); } catch (e) {}   // T9
    return out;
  }
  function _wireRatingsOnce() {
    if (_ratingsBound) return;
    var starWrap = _rrRateEl('rr-rate-stars'), feelWrap = _rrRateEl('rr-rate-feel');
    if (!starWrap || !feelWrap) return;   // markup absent (shouldn't happen) — retry on the next results show
    _ratingsBound = true;
    starWrap.addEventListener('click', function (e) {
      var b = (e.target && e.target.closest) ? e.target.closest('.rr-star') : null; if (!b) return;
      var v = parseInt(b.getAttribute('data-v'), 10) || 0; if (!v) return;
      _paintStars(v); _submitRating({ stars: v }, b);
    });
    feelWrap.addEventListener('click', function (e) {
      var b = (e.target && e.target.closest) ? e.target.closest('.rr-chip') : null; if (!b) return;
      var v = parseInt(b.getAttribute('data-v'), 10) || 0; if (!v) return;
      _paintFeel(v); _submitRating({ felt: v }, b);
    });
    // keyboard: arrow keys ROVE focus within each radiogroup (Enter/Space activate natively on the <button>). Scoped
    // to the group's own buttons — never a global key, so the existing results Enter/Esc flow is untouched.
    function _rove(wrap, sel) {
      wrap.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'ArrowUp' && k !== 'ArrowDown') return;
        var btns = Array.prototype.slice.call(wrap.querySelectorAll(sel));
        var i = btns.indexOf(document.activeElement); if (i < 0) i = 0;
        var dir = (k === 'ArrowRight' || k === 'ArrowDown') ? 1 : -1;
        var ni = Math.max(0, Math.min(btns.length - 1, i + dir));
        if (btns[ni]) { btns[ni].focus(); e.preventDefault(); }
      });
    }
    _rove(starWrap, '.rr-star'); _rove(feelWrap, '.rr-chip');
  }
  function _resetRatingsWidget() {
    try { if (_ratingsShowT) { clearTimeout(_ratingsShowT); _ratingsShowT = 0; } } catch (e) {}
    var panel = _rrRateEl('results-rate');
    if (panel) panel.setAttribute('hidden', '');
    try { _paintStars(0); _paintFeel(0); } catch (e) {}
  }
  function _maybeShowRatings(results, accFrac) {
    _resetRatingsWidget();                                   // always start clean (cancels any pending show + clears selections)
    var tid = _ratingsTidFor(results);
    if (!tid) return;                                        // suppressed — the panel stays hidden
    _rateTid = tid; _rateDiff = difficulty; _rateAcc = (typeof accFrac === 'number' ? accFrac : null);
    _wireRatingsOnce();
    _ratingsShowT = setTimeout(function () {
      _ratingsShowT = 0;
      if (state !== 'results') return;                       // left the screen during the delay — don't pop it in
      try {
        var prev = (window.RhythmCatalog && window.RhythmCatalog.ratingFor) ? window.RhythmCatalog.ratingFor(tid) : null;
        if (prev) { if (prev.stars) _paintStars(prev.stars | 0); if (prev.felt) _paintFeel(prev.felt | 0); }   // pre-lit: tap to change
      } catch (e) {}
      var panel = _rrRateEl('results-rate');
      if (panel) panel.removeAttribute('hidden');            // the CSS :not([hidden]) entrance animation plays
    }, 1200);
  }

  async function endGame() {
    // build108: re-entry guard — failRun()'s deferred endGame() (550ms wipeout beat) plus any other caller
    // (player.onended, the song-duration check, the __rrDebug.endRun dev hook) must never run the results/
    // submit pipeline twice for the same run. state flips to 'menu' inside stopGame() below, so a second call
    // arriving after the first already tore down is caught here before it touches anything.
    if (state !== 'playing') return;
    stopGame();   // build102y review fix D: the ghost-target clear moved INTO stopGame (covers the EXIT path too)
    // build35 (audit P0): EXCLUDE bombs from the scored-note total. Bombs are dodged (hit='avoided'),
    // never counted in perfect/great/good — counting them in `total` deflated accuracy/grade (a clean
    // Medium/Hard dodge-all run read ~96%, suppressing S / 100% / full-combo) AND over-reported
    // notes_total to the server. One honest count drives accFrac, notes_total, and full_combo.
    const total = notes.filter(n => n.type !== 'bomb').length;
    const hit = counts.perfect + counts.great + counts.good;
    const accFrac = total > 0
      ? (counts.perfect * 1.0 + counts.great * 0.85 + counts.good * 0.5) / total : 0;
    const accPct = accFrac * 100;
    const accShown = Math.round(accPct * 10) / 10;   // build71: grade off the DISPLAYED (1-dp) accuracy so a 94.97% run can't print "95.0%" next to an A — the screen shows accShown, so the grade must derive from it too
    let grade = 'D';
    if (accShown >= 95) grade = 'S'; else if (accShown >= 88) grade = 'A';
    else if (accShown >= 75) grade = 'B'; else if (accShown >= 60) grade = 'C';
    // build85 (Phase 3.2): FC grade FLOOR — a clean full-combo run never prints below B. Floors only, never caps.
    const _isFC = !runFailed && counts.miss === 0 && total > 0;   // build86 (QA B85-1): a FAILED run (bombs drain stability w/o a miss) must NOT claim FC or a floored grade
    if (_isFC && (grade === 'C' || grade === 'D')) grade = 'B';

    const results = {
      difficulty,
      score: Math.round(score),
      accuracy: Math.round(accFrac * 10000) / 10000, // 0..1
      max_combo: maxCombo,
      notes_hit: hit,
      notes_total: total,
      grade,
      full_combo: _isFC,
      failed: runFailed,
      boss: bossMode,
      clutch_count: _clutchCount,   // build122 p1: display-only — never read by scoring/grade/leaderboard-submit
      // PRACTICE: the HARD safety flag. recordLocal() early-returns on it (no career / per-song best / Bonus Sparks /
      // Daily-Rift ×3 / XP / streak / account-leaderboard submit), and the live server submit below is skipped. A
      // practice run has ZERO competitive/economy side effects. Default false → normal runs record exactly as before.
      practice: _practiceOn,
      isPractice: _practiceOn,   // alias — the requested __rrDebug.practiceState() surface + any future reader
      // FIRST PULSE bridge run = UNRANKED. This single flag drives every exclusion: recordLocal early-returns on
      // `results.preview` (no career / per-song best / Bonus Sparks / Daily-Rift ×3 / XP / streak / account submit),
      // _ratingsTidFor returns null (no ranked results-extras, no ratings widget), and the live-submit block below
      // short-circuits it. Default false → a normal run records + submits exactly as before.
      // CHART-SHAPE GUARD-RAIL (Fable, SCORING_RULINGS_v2): "never submit v2-stamped scores off a modified chart."
      // open-notes and slide-rails MODIFY the note array (open notes are hittable from ANY lane — strictly easier;
      // rails re-type holds), so a run with either ON is NOT comparable to the ranked CHART_VERSION-2 chart and must be
      // UNRANKED — no matter HOW the flag was enabled. It is not enough to gate only ?playtest=1: `?open=1`, `?rails=1`,
      // `rr_open`, `rr_rails` and `__rrOpenNotes(true)` are all reachable in PRODUCTION (no localhost gate — cf. the
      // build66 launch-audit finding where `?dev=1` unlocked paid content in prod), so before this, any player could
      // append `?open=1` to the live game and post an inflated score to the real leaderboards.
      // STARSTRUCK is deliberately NOT here: it only ADDS phraseId/phraseLen props, the array is byte-identical, so
      // those runs stay ranked (proven by phraseV2Proof).
      // When a dark mechanic eventually ships ON by default, it becomes part of a NEW chart epoch — bump CHART_VERSION
      // and drop it from this list; until then, playing it means playing unranked.
      // All flags default OFF → this stays exactly `_bridgeRun` on every normal load, byte-identical.
      preview: _bridgeRun || PLAYTEST_ALL || _chartShapeModified(),
    };
    _lastResults = results;   // expose for the Levels results-loop (NEXT/RETRY + per-level stars)
    // build148 T8: clearing FRACTURE (Hard) at ≥85% on a real (non-practice, non-failed) run UNLOCKS the RIFT
    // (Expert) tier — the opt-in wall. One-way localStorage latch; the difficulty picker reads _riftUnlocked().
    try {
      if (difficulty === 'hard' && !runFailed && !_practiceOn && accShown >= 85 && !_riftUnlocked()) {
        localStorage.setItem('rr_rift_unlocked', '1');
        setTimeout(function () { try { window.RhythmGame.showToast('◆ RIFT UNLOCKED — the Expert wall is open in difficulty ▸', 'good'); } catch (e) {} }, 2400);   // FIX3: de-collide from the ratings panel (~1.2s) — grade → ratings(1.2s) → rift-unlock(2.4s)
      }
    } catch (e) {}
    try { _fireSongEnd('end'); } catch (e) {}   // MP: report final AFTER results object is ready

    renderResults(results, accShown, grade);   // build71: show the same rounded accuracy the grade was computed from
    showScreen('results');
    if (runFailed) {
      const bl = $('results-blurb'); if (bl) bl.textContent = 'Signal lost — the stability meter collapsed. Recalibrate and run it back.';
      const bd = $('results-badges'); if (bd && !/signal lost/i.test(bd.textContent)) bd.insertAdjacentHTML('afterbegin', '<span class="rbadge fail">⚠ Signal Lost</span>');
    }
    if (bossMode) {
      const bl = $('results-blurb');
      if (runFailed) { if (bl) bl.textContent = 'The boss broke your signal. Steady your hands and run it back.'; }
      else {
        if (bl) bl.textContent = "BOSS DEFEATED — you held the line through the enrage. That's a finisher.";
        const bd = $('results-badges'); if (bd) bd.insertAdjacentHTML('afterbegin', '<span class="rbadge gradeup">★ BOSS DEFEATED</span>');
      }
    }

    // ALWAYS record locally (per-song best + lifetime career stats) — works even for the
    // in-browser-charted tracks that have no server submit, so the grade chips + Career are real.
    if (window.RhythmCatalog && window.RhythmCatalog.recordLocal) {
      try { window.RhythmCatalog.recordLocal(results); } catch (e) {}
    }
    // recordLocal just set results._newBest/_gradeUp — pulse the SHARE button if this run is a brag.
    try { if (!results.failed) pulseShareIfBrag(results, grade); } catch (e) {}
    // D1 RATINGS: un-hide #results-rate ~1.2s after the grade, on a REAL run only (practice/preview/MP/demo keep it
    // hidden). Same eligibility gate as recordLocal's real-run path; pre-fills a prior rating. Held-safe (UI only).
    try { _maybeShowRatings(results, accFrac); } catch (e) {}
    // RESULTS-ONLY delighters (R-1 near-goal + RETRY · G-1 trouble-section drill · G-3 vs-your-best pace). Same
    // real-run gate as the ratings/recordLocal path (practice/preview/MP/demo suppressed). Additive DOM only — never
    // touches score/grade/leaderboard; fully guarded so a failure here can't break the record/submit pipeline below.
    try { _renderResultsExtras(results, accShown, grade, accFrac); } catch (e) {}

    // telemetry: song_complete (finished) vs run_fail (Fail Mode ended early). NON-PII — ids/numbers only.
    try {
      if (window.RhythmTelemetry && window.RhythmTelemetry.event) {
        var _tid2 = (session && (session.trackId || (session.meta && session.meta.id))) || null;
        // build65: ENRICH for the "most-enjoyed song" + Six-Sigma backend views. song_start (the play count) already fires
        // above; pairing it with these completion props yields completion-rate, accuracy/combo/grade distributions, FC-rate,
        // and a per-mode cut — the core enjoyment signal. NON-PII (ids/enums/numbers only), fire-and-forget.
        var _mpLive = !!(window.RhythmMP && window.RhythmMP.isLive && window.RhythmMP.isLive());
        var _mode = _mpLive ? 'mp' : (bossMode ? 'boss' : 'solo');
        if (results.failed) {
          window.RhythmTelemetry.event('run_fail', { trackId: _tid2, difficulty: results.difficulty, atPct: Math.round(accPct), maxCombo: results.max_combo, mode: _mode });
        } else {
          window.RhythmTelemetry.event('song_complete', {
            trackId: _tid2, difficulty: results.difficulty, score: results.score,
            accuracy: results.accuracy, fullCombo: !!results.full_combo,
            maxCombo: results.max_combo, grade: results.grade,
            notesHit: results.notes_hit, notesTotal: results.notes_total,
            boss: !!results.boss, mode: _mode
          });
        }
      }
    } catch (e) {}

    // live submit (play_token round-trip) — handled by catalog layer (leaderboard only)
    // build65 (cycle-4): TIGHT (GH) timing feel uses tighter judgment windows than the leaderboard's bound (TIMING_PROFILES:
    // perfFrac/greatFrac/comboStep differ), so its scores aren't comparable — route tight runs to LOCAL PRACTICE. The
    // in-browser path already gated this; gating HERE also closes the SERVER-CHART (liveProvider) submit, which bypassed it.
    // (recordLocal — per-song best + career — already ran above, so practice runs still count locally.)
    if (_practiceOn) {
      // PRACTICE: NEVER submit to the leaderboard (server chart OR account). Show the local-practice note only.
      try { if (window.RhythmCatalog && window.RhythmCatalog.onSubmitResult) window.RhythmCatalog.onSubmitResult({ error: 'practice' }, results); } catch (e) {}
    } else if (_bridgeRun) {
      // FIRST PULSE bridge run — UNRANKED: no leaderboard submit at all (server chart OR account). No practice note
      // either; _renderBridgeResults paints the dedicated "BRIDGE RUN — unranked" chip instead. This closes the last
      // submit surface (session.submit) on top of recordLocal's results.preview early-return.
    } else if (PLAYTEST_ALL || _chartShapeModified()) {
      // CHART-SHAPE GUARD-RAIL (SCORING_RULINGS_v2): open-notes / slide-rails are baked into the chart shape, so a run
      // with either ON must NEVER submit a ranked score — and this must hold however the flag was set, not just via
      // ?playtest=1. `results.preview` above suppresses recordLocal/ratings/results-extras (the LOCAL surfaces), but
      // it does NOT reach `session.submit` below — that is the SERVER leaderboard, and it is closed only by landing in
      // one of these branches (this is why the bridge run needed its own branch too). Before this, a bare `?open=1` —
      // reachable in production, no localhost gate — fell straight through to session.submit and posted an inflated
      // score (open notes are hittable from ANY lane) to the live boards. Same close-out as practice/tight: local note
      // only. All flags default OFF → unreachable on a normal load.
      try { if (window.RhythmCatalog && window.RhythmCatalog.onSubmitResult) window.RhythmCatalog.onSubmitResult({ error: 'practice' }, results); } catch (e) {}
    } else if (timingFeel === 'tight') {
      try { if (window.RhythmCatalog && window.RhythmCatalog.onSubmitResult) window.RhythmCatalog.onSubmitResult({ error: 'practice' }, results); } catch (e) {}
    } else if (session && session.submit) {
      try {
        const out = await session.submit(results);
        if (window.RhythmCatalog && window.RhythmCatalog.onSubmitResult) {
          window.RhythmCatalog.onSubmitResult(out, results);
        }
      } catch (e) { console.warn('submit failed', e); }
    }
    // FIRST PULSE — the bridge run's OWN results (chip + difficulty handoff). Called LAST so _bridgeRun was still
    // armed through the results object build, recordLocal, and the submit gate above; this disarms it.
    try { _renderBridgeResults(results, grade); } catch (e) {}
  }

  // FIRST PULSE — paints the bridge run's UNRANKED results and hands off the difficulty. UNRANKED: it only touches
  // DOM (a "BRIDGE RUN — unranked" chip + blurb) and the rr_diff UI preference — never score/career/best/leaderboard.
  // On a strong clear (grade A/S, not failed) it fires a PULSE-READY toast and PRE-SELECTS Medium for this track's
  // next NORMAL launch (persists rr_diff='medium'); on a non-clear it restores the pre-bridge tier. Always disarms the
  // bridge state so it can never leak into the next run.
  function _renderBridgeResults(results, grade) {
    if (!results || !results.preview || !_bridgeRun) return;   // only a genuine bridge run reaches here
    var cleared = (grade === 'A' || grade === 'S') && !results.failed;
    try {
      var badges = document.getElementById('results-badges');
      if (badges) {
        var old = document.getElementById('rr-bridge-chip'); if (old && old.parentNode) old.parentNode.removeChild(old);
        badges.insertAdjacentHTML('afterbegin',
          '<span id="rr-bridge-chip" class="rbadge" style="background:linear-gradient(180deg,rgba(255,31,46,0.22),rgba(224,169,63,0.16));border:1px solid rgba(224,169,63,0.55);color:#ffe08a;">◇ BRIDGE RUN — UNRANKED</span>');
      }
      var bl = document.getElementById('results-blurb');
      if (bl) bl.textContent = cleared
        ? 'PULSE cleared on the bridge — that was Medium density at the Easy window. Take it ranked.'
        : 'Bridge run — a Medium rehearsal at the Easy window. Nothing counted here; run it back or take Easy ranked.';
    } catch (e) {}
    // difficulty handoff — rr_diff is a UI preference, NOT a ranked surface, so it is untouched by the unranked law.
    var prev = _bridgePrevDiff;
    _bridgeRun = false; _bridgePrevDiff = null;   // disarm FIRST so nothing below can re-enter as a bridge run
    if (cleared) {
      difficulty = 'medium';
      try { localStorage.setItem('rr_diff', 'medium'); } catch (e) {}
      try { syncDiffButtons(); } catch (e) {}
      setTimeout(function () { try { window.RhythmGame.showToast('◆ PULSE-READY — Medium is queued for your next run', 'success'); } catch (e) {} }, 1400);
    } else {
      if (prev != null) difficulty = prev;   // restore the pre-bridge tier (Easy); rr_diff on disk was never changed
      try { syncDiffButtons(); } catch (e) {}
    }
  }

  function renderResults(results, accPct, grade) {
    { const ge = $('results-grade'); ge.textContent = grade; ge.className = 'results-grade gr-' + (grade || 'D'); }   // tier class → color-coded grade (S=gold, A=crimson, …)
    // build100e (relatability): a tiny S→F ladder under the grade so a newcomer can locate where their grade sits (best is S).
    try { const gs = $('results-grade-scale'); if (gs) { const _g = grade || 'D'; gs.innerHTML = ['S', 'A', 'B', 'C', 'D', 'F'].map(function (L) { return L === _g ? '<b style="color:#f4efe9">' + L + '</b>' : L; }).join('&nbsp;·&nbsp;'); } } catch (e) {}
    // star rating — ONE shared 3-star scale across the results screen AND the campaign cards (build58: was a 5-star accuracy
    // curve that disagreed with the 3-star level cards, e.g. an A read 4/5 here but 3/3 on the card). S/A=3, B=2, C/D=1; a
    // FAILED run = 0. The letter grade above carries the finer nuance.
    { const starN = runFailed ? 0 : ((grade === 'S' || grade === 'A') ? 3 : (grade === 'B') ? 2 : 1);
      const sh = $('results-stars');
      if (sh) {
        sh.innerHTML = '';
        sh.setAttribute('role', 'img'); sh.setAttribute('aria-label', starN + ' of 3 stars');   // build99k: the star reward was aria-hidden — announce it
        try { const gEl = $('results-grade'); if (gEl) gEl.setAttribute('aria-label', 'Grade ' + grade); } catch (e) {}
        for (let i = 0; i < 3; i++) {
          const st = document.createElement('span');
          st.className = 'rstar' + (i < starN ? ' on' : '');
          st.textContent = '★';
          if (i < starN) st.style.animationDelay = (0.5 + i * 0.12) + 's';
          sh.appendChild(st);
        }
      } }
    // count-up the score & accuracy for a satisfying results reveal — but honor reduce-motion (build99k: this was the
    // only results reveal that ignored it; a reduced-motion player should land on the final numbers instantly)
    // v[polish]: RESULTS CASCADE — the count-up now DELAYS its start (~420ms) so the number climb is its own beat
    // AFTER the grade bloom + star pops, instead of rolling up while they punch in and stealing the eye. Duration
    // and final values are unchanged; only the START is gated behind a timeout. Reduce-motion still lands instantly
    // (no delay, no climb). The CSS sub-element stagger (.results-summary / breakdown / badges) rides alongside this.
    const scoreEl = $('rs-score'), accEl = $('rs-acc');
    if (document.documentElement.classList.contains('rr-reduce-motion')) {
      scoreEl.textContent = results.score.toLocaleString(); accEl.textContent = accPct.toFixed(1) + '%';
    } else {
      const dur = 900, COUNT_DELAY = 420;   // ms after the grade punches in (gradeReveal settles ~700ms) before the tally begins
      scoreEl.textContent = '0'; accEl.textContent = '0.0%';   // hold at zero through the pre-count beat (no stale prior value flashes)
      setTimeout(function () {
        const startT = performance.now();
        (function tick(now) {
          const p = Math.min(1, (now - startT) / dur);
          const e = 1 - Math.pow(1 - p, 3);            // ease-out cubic
          scoreEl.textContent = Math.floor(results.score * e).toLocaleString();
          accEl.textContent = (accPct * e).toFixed(1) + '%';
          if (p < 1) requestAnimationFrame(tick);
          else { scoreEl.textContent = results.score.toLocaleString(); accEl.textContent = accPct.toFixed(1) + '%'; }
        })(performance.now());
      }, COUNT_DELAY);
    }
    $('rs-maxcombo').textContent = results.max_combo;
    $('rs-hit').textContent = results.notes_hit + ' / ' + results.notes_total;
    const tname = session && session.meta ? session.meta.title : 'Lunar Waves';
    const tartist = session && session.meta && session.meta.artist ? session.meta.artist : '';
    $('results-track').textContent = (tartist ? tname + ' — ' + tartist : tname).toUpperCase() + ' // ' + DIFFICULTY[difficulty].name.split(' — ')[0];
    const blurbs = {
      S: 'The cathedral is humming. Echoes have folded inward. The rift accepts you.',
      A: 'Signal locked. The crowd is screaming your frequency back at you.',
      B: 'Stable resonance. A few cracks in the architecture — survivable.',
      C: 'You held the line. The rift wobbled but you stayed on it — tighten up and climb.',   // a C is a PASS, not a failure
      D: 'Rough run, but you finished it. The rift remembers persistence — run it back.',
      F: 'The song got away from you this time. Shake it off and dive back in.',
    };
    $('results-blurb').textContent = blurbs[grade] || blurbs.D;   // build99k: guard — an unmapped grade used to render the literal string "undefined"
    // build83: EARLY/LATE timing summary — avg signed bias + a mini histogram (the keyboard grinder's feedback loop)
    try {
      const _old = document.getElementById('results-timing'); if (_old) _old.remove();
      // build89: also clear the stale next-chase CTA each render — recordLocal only re-adds it for a
      // qualifying (non-failed, scored, real-track) run, so a failed/zero/demo run can't show the prior song's "beat it by N".
      const _oc = document.getElementById('results-chase'); if (_oc) _oc.remove();
      if (_timingSamples.length >= 4) {
        const _ms = _timingSamples.map(s => s * 1000);
        const _avg = Math.round(_ms.reduce((a, b) => a + b, 0) / _ms.length);
        const _ad = Math.abs(_avg);
        const _dir = _ad < 6 ? 'DEAD ON' : (_avg > 0 ? _avg + 'ms LATE' : (-_avg) + 'ms EARLY');
        const _col = _ad < 6 ? '#e0a93f' : (_avg > 0 ? '#ff7a4a' : '#dad7d2');
        const _bins = new Array(9).fill(0);
        _ms.forEach(v => { let b = Math.round(v / 20) + 4; b = Math.max(0, Math.min(8, b)); _bins[b]++; });
        const _mx = Math.max(1, ..._bins);
        const _bars = _bins.map((c, i) => '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;"><div style="width:60%;height:' + Math.round(3 + c / _mx * 30) + 'px;background:' + (i === 4 ? '#e0a93f' : 'rgba(236,231,227,0.45)') + ';border-radius:2px 2px 0 0;"></div></div>').join('');
        const _html = '<div id="results-timing" style="margin:10px auto 0;max-width:340px;">'
          + '<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#b9b2ac;font-family:\'Chakra Petch\',sans-serif;"><span>Timing</span><span style="color:' + _col + ';font-weight:800;font-family:\'Oxanium\',sans-serif;">' + _dir + '</span></div>'
          + '<div style="display:flex;gap:3px;align-items:flex-end;height:36px;margin-top:5px;">' + _bars + '</div>'
          + '<div style="display:flex;justify-content:space-between;font-size:9px;color:#8a847d;margin-top:2px;font-family:\'JetBrains Mono\',monospace;"><span>EARLY</span><span>on-beat</span><span>LATE</span></div>'
          + '</div>';
        const _rb = $('results-blurb'); if (_rb && _rb.insertAdjacentHTML) _rb.insertAdjacentHTML('afterend', _html);
      }
    } catch (e) {}
    // build108 s4 — SLOPPINESS reflection (owner decision: mashing must earn ZERO score/combo — already true, see
    // handleHit's empty-press branch — but a masher's RESULTS should still read as sloppy). DISPLAY-ONLY: never
    // touches score/accFrac/grade/leaderboard-submit (those are computed above from `counts`/`notes.length` alone,
    // never from wastedInputs). Only shows when the waste rate is meaningfully high relative to real hits, so a
    // normal player who whiffs a couple of notes never sees a nag.
    try {
      const _old2 = document.getElementById('results-sloppy'); if (_old2) _old2.remove();
      const _realHits = results.notes_hit || 0;
      if (wastedInputs >= 8 && wastedInputs > _realHits * 0.5) {
        const _sloppyHtml = '<div id="results-sloppy" style="margin:8px auto 0;max-width:340px;font-size:10.5px;letter-spacing:0.05em;color:#8a847d;font-family:\'JetBrains Mono\',monospace;text-align:center;">'
          + wastedInputs + ' presses missed every note nearby — button-mashing doesn’t pay off here.</div>';
        const _anchor2 = document.getElementById('results-timing') || $('results-blurb');
        if (_anchor2 && _anchor2.insertAdjacentHTML) _anchor2.insertAdjacentHTML('afterend', _sloppyHtml);
      }
    } catch (e) {}
    // build104 s2 — AUTO-CALIBRATION from real play: a whole run's hits already measured the player's device bias
    // (_timingSamples). When the run shows a CONSISTENT lean (|median| > 25ms over ≥40 hits), offer a one-tap fix:
    // apply HALF the median (converges over runs without overshoot), clamped ±150ms, through the exact calib-save
    // path (rr_offset_ms + live audioOffset + the Settings chip). rr_autocal='0' = "don't ask again" so it never
    // nags. Post-run only — zero per-frame cost, zero determinism impact, leaderboard-neutral (device artifact).
    try {
      const _oac = document.getElementById('results-autocal'); if (_oac) _oac.remove();
      if (localStorage.getItem('rr_autocal') !== '0' && _timingSamples.length >= 40) {
        const _sv = _timingSamples.map(s => s * 1000).sort((a, b) => a - b);
        const _med = Math.round(_sv.length % 2 ? _sv[(_sv.length - 1) / 2] : (_sv[_sv.length / 2 - 1] + _sv[_sv.length / 2]) / 2);
        const _curMs = Math.round(audioOffset * 1000);
        const _newMs = Math.max(-150, Math.min(150, _curMs + Math.round(_med / 2)));
        if (Math.abs(_med) > 25 && _newMs !== _curMs) {
          // NAME THE CONSEQUENCE, not a bare number: a larger offset makes each note reach the strike line LATER
          // relative to the music (jt = songTime - audioOffset), so the sign of the applied DELTA is what the player
          // will actually feel. (deltaMs is never 0 here — the `_newMs !== _curMs` guard above rules that out.)
          const _later = (_newMs - _curMs) > 0;
          const _feel = _later ? 'later' : 'earlier';
          const _btn = 'padding:5px 12px;border-radius:8px;border:1px solid rgba(236,231,227,0.25);background:rgba(20,12,10,0.6);color:#ece7e3;font-family:\'Chakra Petch\',sans-serif;font-size:11px;letter-spacing:0.08em;cursor:pointer;';
          const _achtml = '<div id="results-autocal" style="margin:10px auto 0;max-width:340px;padding:9px 12px;border:1px solid rgba(224,169,63,0.35);border-radius:10px;background:rgba(28,16,10,0.55);">'
            + '<div style="font-size:11.5px;letter-spacing:0.06em;color:#e0a93f;font-family:\'Chakra Petch\',sans-serif;">Your hits ran ~' + Math.abs(_med) + 'ms ' + (_med > 0 ? 'LATE' : 'EARLY') + ' — nudge notes ' + _feel + ' to match?</div>'
            + '<div style="display:flex;gap:8px;justify-content:center;margin-top:7px;">'
            + '<button id="autocal-apply" style="' + _btn + 'border-color:rgba(224,169,63,0.6);color:#ffe08a;">APPLY ' + (_newMs > 0 ? '+' : '') + _newMs + 'ms</button>'
            + '<button id="autocal-later" style="' + _btn + '">NOT NOW</button>'
            + '<button id="autocal-never" style="' + _btn + 'opacity:0.7;">DON’T ASK</button>'
            + '</div></div>';
          // build108 review fix (minor): anchor AFTER the sloppiness note when it's present so the two inserts don't
          // both 'afterend' the same node and land in reverse order — order is now timing → sloppy → autocal.
          const _anchor = document.getElementById('results-sloppy') || document.getElementById('results-timing') || $('results-blurb');
          if (_anchor && _anchor.insertAdjacentHTML) {
            _anchor.insertAdjacentHTML('afterend', _achtml);
            const _chip = document.getElementById('results-autocal');
            const _ap = document.getElementById('autocal-apply');
            if (_ap) _ap.addEventListener('click', () => {
              audioOffset = _newMs / 1000;
              try { localStorage.setItem('rr_offset_ms', String(_newMs)); } catch (e2) {}
              try { updateCalibMenuVal(); } catch (e2) {}
              // A3 telemetry — one consent-gated event through the existing RhythmTelemetry sink (_tlog is the sink
              // wrapper; RhythmTelemetry.event is itself consent-gated — we don't bypass that).
              try { _tlog('calibrate_apply', { source: 'autocal', offsetMs: _newMs, prevMs: _curMs, deltaMs: _newMs - _curMs, medianMs: _med }); } catch (e2) {}
              if (_chip) _chip.innerHTML = '<div style="font-size:11.5px;letter-spacing:0.06em;color:#ffe08a;font-family:\'Chakra Petch\',sans-serif;text-align:center;">✓ Applied ' + (_newMs > 0 ? '+' : '') + _newMs + 'ms — notes will feel ' + _feel + '. Fine-tune in Settings ▸ Calibration</div>';
            });
            const _la = document.getElementById('autocal-later');
            if (_la) _la.addEventListener('click', () => { if (_chip) _chip.remove(); });
            const _nv = document.getElementById('autocal-never');
            if (_nv) _nv.addEventListener('click', () => { try { localStorage.setItem('rr_autocal', '0'); } catch (e2) {} if (_chip) _chip.remove(); });
          }
        }
      }
    } catch (e) {}

    // judgment composition bar — proportional inline-block segments (fills from 0)
    // v[polish]: fill the bar as the breakdown section RISES IN (~0.72s in the cascade) rather than at 90ms, so the
    // segment grow reads inside the newly-visible container instead of completing while it's still faded out. Under
    // reduce-motion the section appears instantly, so fill immediately (no cascade to sync to).
    const rbTotal = Math.max(1, counts.perfect + counts.great + counts.good + counts.miss);
    ['perfect', 'great', 'good', 'miss'].forEach(j => { const s = $('rb-seg-' + j); if (s) s.style.width = '0'; const c = $('rb-' + j); if (c) c.textContent = counts[j]; });
    const _rbFill = () => { ['perfect', 'great', 'good', 'miss'].forEach(j => { const el = $('rb-seg-' + j); if (el) el.style.width = (counts[j] / rbTotal * 100) + '%'; }); };
    if (document.documentElement.classList.contains('rr-reduce-motion')) _rbFill();
    else setTimeout(_rbFill, 760);

    // FULL COMBO badge (NEW BEST is added by the catalog layer after the save)
    // build122 p1: CLUTCH badge — only if this run had at least one recovery. Reuses the existing .rbadge
    // pill (crimson variant, no new visual language). Display-only; clutch_count never touches scoring.
    const badges = $('results-badges');
    if (badges) {
      badges.innerHTML = (results.full_combo ? '<span class="rbadge fc">Full Combo</span>' : '')
        + ((results.clutch_count > 0) ? '<span class="rbadge clutch">⚡ CLUTCH ×' + results.clutch_count + '</span>' : '');
    }
    // ---- B2 ENCORE CHAIN chips ------------------------------------------------------------------------------------
    // A FAILED run breaks the chain (spec: any fail resets to 0) → no chip. Otherwise, if this run was reached by
    // accepting an encore (chain >= 1), stamp an "ENCORE ×n" chip; at a chain of 3 also stamp the one-time SETLIST
    // career badge, reusing the EXISTING .rbadge chip mechanism (like Full Combo / CLUTCH above). The SETLIST badge is
    // cosmetic status — it persists in its OWN key (rr_setlist), never rr_career, and never touches score. Appended
    // (not innerHTML-set) so it coexists with FC/CLUTCH here and the NEW BEST / GRADE UP the catalog layer prepends.
    try {
      if (results.failed) { _encoreChain = 0; }
      else if (badges && _encoreChain >= 1) {
        badges.insertAdjacentHTML('beforeend', '<span class="rbadge clutch" id="rr-encore-chip">🎸 ENCORE ×' + _encoreChain + '</span>');
        if (_encoreChain >= 3) {
          let _hadSetlist = false; try { _hadSetlist = localStorage.getItem('rr_setlist') === '1'; } catch (e) {}
          if (!_hadSetlist) { try { localStorage.setItem('rr_setlist', '1'); } catch (e) {} }
          badges.insertAdjacentHTML('beforeend', '<span class="rbadge gradeup" id="rr-setlist-badge">★ SETLIST' + (_hadSetlist ? '' : ' — NEW') + '</span>');
        }
      }
    } catch (e) {}
    // build122 p2 — ONE NOTE FROM GLORY (delighter #2): a dedicated near-miss stamp when the run barely
    // missed Full Combo OR barely missed crossing into the next grade. Render-only — reads counts/accPct/
    // grade that are already computed above; never touches scoring/grade itself. Mirrors the existing
    // "remove stale element, re-add if it qualifies THIS render" idiom used by results-timing/-sloppy/-autocal.
    try {
      const _oldAlmost = document.getElementById('results-almost'); if (_oldAlmost) _oldAlmost.remove();
      const _rep = $('results-replay'); if (_rep) _rep.classList.remove('brag');
      if (!results.failed) {
        const _missCount = counts.miss || 0;
        let _almostText = null;
        // near-FC: not already a full combo, but only 1-2 misses stood between this run and one.
        if (!results.full_combo && _missCount > 0 && _missCount <= 2) {
          _almostText = (_missCount === 1 ? '1 NOTE' : _missCount + ' NOTES') + ' FROM FULL COMBO';
        } else {
          // near grade-up: how far (in accuracy points) from the NEXT grade up FROM THE CURRENT GRADE.
          // Uses the same thresholds/ladder endGame() just graded against (95/88/75/60/floor D) — grade is
          // accuracy-based here, not score-based, so the honest "how close" unit is accuracy points, not a
          // fabricated score delta. Ladder walked low->high so we can find "one step above wherever `grade`
          // (the FLOORED grade already computed by endGame, e.g. an FC-floored B) actually landed."
          const _GRADE_LADDER = [['D', -Infinity], ['C', 60], ['B', 75], ['A', 88], ['S', 95]];
          const _curIdx = _GRADE_LADDER.findIndex(g => g[0] === grade);
          const _next = (_curIdx >= 0 && _curIdx < _GRADE_LADDER.length - 1) ? _GRADE_LADDER[_curIdx + 1] : null;
          if (_next) {
            const _gap = _next[1] - accPct;
            if (_gap > 0 && _gap <= 1.5) { const _gTxt = _gap < 0.05 ? '<0.1' : _gap.toFixed(1); _almostText = _gTxt + '% FROM A' + ((_next[0] === 'S' || _next[0] === 'A') ? 'N ' : ' ') + _next[0]; }   // build122 review: a gap under 0.05 rounded to a nonsense "0.0% FROM ..." — show "<0.1%" instead
          }
        }
        if (_almostText) {
          const _html = '<div id="results-almost">' + _almostText + '</div>';
          if (badges && badges.insertAdjacentHTML) badges.insertAdjacentHTML('afterend', _html);
          if (_rep) _rep.classList.add('brag');   // the replay button visually beckons
        }
      }
    } catch (e) {}
    // reset the Bonus-Sparks line each render — the catalog layer (recordLocal) re-paints it for a COMPLETED
    // run; a failed run leaves it cleared so a prior run's "+N BONUS SPARKS" can't linger on this screen.
    { const rb = $('results-bonus'); if (rb) { rb.innerHTML = ''; rb.style.display = 'none'; } }
    // build110: same reset for the XP earn line — the catalog layer (recordLocal → RhythmGoals.recordLevelComplete)
    // re-paints it for a COMPLETED run via renderXpLine(); a failed run leaves it cleared so a prior run's
    // "+N XP" can't linger on this screen.
    { const rx = $('results-xp'); if (rx) { rx.innerHTML = ''; rx.style.display = 'none'; } }

    // remember for the Share Score action — extend with everything the Share Card needs.
    // (newBest/gradeUp are set on `results` by catalog.recordLocal, which runs AFTER this in
    // endGame; since the share payload references the same `results` object, the share handler
    // reads them live at click time.)
    var _comboTierName = 'COMBO';
    try { _comboTierName = COMBO_TIERS[comboTierIdx(results.max_combo || 0)].name; } catch (e) {}
    var _guitar = { src: 'assets/guitar.png', name: 'Default' };
    try {
      if (window.RhythmGame && window.RhythmGame.getEquippedLoadout) _guitar = window.RhythmGame.getEquippedLoadout();
      else if (window.RhythmGame && window.RhythmGame.getEquippedSkin) { var _s = window.RhythmGame.getEquippedSkin(); if (_s) _guitar = { src: _s, name: 'Custom' }; }
    } catch (e) {}
    var _cover = (session && session.meta && session.meta.artwork) ? session.meta.artwork : null;
    lastResults = {
      results, accPct, grade, track: tname, artist: tartist, diff: DIFFICULTY[difficulty].name,
      cover: _cover, comboTierName: _comboTierName,
      counts: { perfect: counts.perfect, great: counts.great, good: counts.good, miss: counts.miss },
      guitarSrc: _guitar.src, guitarName: _guitar.name
    };
    // v253 (#84): ENCORE moment — a strong finish (S/A grade or a Full Combo) makes the crowd "want more". Sweep in the
    // chant banner and turn PLAY AGAIN into the ENCORE call-to-action (pulsing) so the win begs for another performance.
    // Reset to the plain state on a normal or failed run so it stays special.
    try {
      const encore = !results.failed && (grade === 'S' || grade === 'A' || !!results.full_combo);
      const encEl = $('results-encore'), rep = $('results-replay');
      if (encEl) { encEl.hidden = !encore; encEl.classList.toggle('show', encore); }
      if (rep) { rep.textContent = encore ? '🎸 ENCORE' : 'PLAY AGAIN'; rep.classList.toggle('encore-armed', encore); }
      // B2 ENCORE CHAIN: on a REAL solo strong finish, ask the catalog for ONE curated next track (peak-end: feed the
      // catalog while the player is euphoric). Gated to real solo runs via _ratingsTidFor (practice/preview/MP/demo →
      // null → no curated next → the button stays a same-song replay). Defensive against the getter being absent or
      // returning null → EXACT fallback to today's same-song replay (no regression, no dead button). No score surface.
      _encoreArmed = false; _encoreNext = null;
      try {
        let _realTid = null; try { _realTid = _ratingsTidFor(results); } catch (e) { _realTid = null; }
        if (encore && _realTid && window.RhythmCatalog && typeof window.RhythmCatalog.encoreNextTrack === 'function') {
          let _curId = null; try { _curId = (window.RhythmCatalog.currentTrackId && window.RhythmCatalog.currentTrackId()) || null; } catch (e) { _curId = null; }
          _encoreNext = window.RhythmCatalog.encoreNextTrack(_curId) || null;
          _encoreArmed = !!_encoreNext;
        }
      } catch (e) { _encoreArmed = false; _encoreNext = null; }
      // build60 FEEL: EVERY non-failed finish now lands a grade-scaled STING under the count-up (a B/C/D used to
      // finish silently — only the encore/S-A branch played one). S/A → the big 6-note run; B/C/D → the softer
      // 4-note arpeggio. A FAILED run stays silent (no reward for a fail-out). playStingSfx is mute/mixer-gated.
      if (!results.failed) { try { if (!playClearFanfareSfx()) playStingSfx(grade === 'S' || grade === 'A' ? 'big' : ''); } catch (e) {} }   // build157: real victory fanfare on a clear; falls back to the procedural grade-sting if the sample hasn't loaded
      // v255: the crowd cheers on an encore — play the optional cheer SFX (gated by mute + the SFX level; absent file = silent).
      // The cheer LAYERS on top of the sting above; only high grades earn it.
      if (encore && !muted) {
        // v259: prefer a real crowd-cheer.mp3 if it actually loaded; otherwise the procedural applause synth (no asset).
        try {
          const _ch = $('encore-cheer');
          if (_ch && _ch.readyState >= 2 && isFinite(_ch.duration) && _ch.duration > 0) { _ch.volume = Math.min(0.85, Math.max(0.35, SFX_LEVEL * 6)); _ch.currentTime = 0; _ch.play().catch(() => {}); }
          else { playCheerSfx(); }
        } catch (e) { try { playCheerSfx(); } catch (e2) {} }
      }
    } catch (e) {}
    // build8c: celebratory burst over the card — confetti/fireworks (+ gradeup-flare when the badge lands)
    if (!results.failed) celebrateResults(accPct, grade);
    // RIFT REPLAY: inject the branded "SHARE YOUR RIFT" button into the results screen (dedupes itself). It builds
    // the shareable peak-combo clip from frames the tick sampled this run. Guarded + additive; a null ring degrades
    // to a branded PNG still inside the module. Uses the in-scope run vars (tname/tartist/results/grade).
    try {
      if (window.RhythmReplay) {
        var _rrHost = $('results');
        if (_rrHost) window.RhythmReplay.offerOnResults(_rrHost, {
          capture: {
            song: tname || '',
            artist: tartist || '',
            endStats: { score: (results && results.score), combo: (results && results.max_combo), grade: grade }
          }
        });
      }
    } catch (e) {}
  }

  // ============================================================================================================
  // RESULTS-ONLY DELIGHTERS — injected DYNAMICALLY into the EXISTING results DOM (no index.html markup added). All
  // three are additive, headless-safe, and gated to REAL SOLO runs via _ratingsTidFor (practice/preview/MP/demo
  // return null → nothing shows). They only READ results/counts/notes/score — NO new score site, notes untouched,
  // and every branch is guarded so a failure here can never break the endGame record/submit pipeline.
  //   R-1  near-goal + RETRY  — the single closest meaningful gap (from Full Combo / next grade / next star)
  //   G-1  trouble-section    — the worst ~15s miss cluster → DRILL IT (opens the existing Practice mode @0.75×)
  //   G-3  vs-your-best pace  — a 10-seg strip comparing this run's pace to your stored best for this track+diff
  // ============================================================================================================
  function _starsForGrade(g) { return (g === 'S' || g === 'A') ? 3 : (g === 'B') ? 2 : (g === 'C' || g === 'D') ? 1 : 0; }

  function _renderResultsExtras(results, accShown, grade, accFrac) {
    // Always clear any prior run's injected lines FIRST — endGame is the sole results path, so a later SUPPRESSED
    // run (practice/MP/demo) must not leave an earlier real run's delighter on screen.
    ['rr-neargoal', 'rr-trouble', 'rr-pace', 'rr-odstat', 'rr-today-pct', 'rr-firstpulse'].forEach(function (id) { var e = document.getElementById(id); if (e && e.parentNode) e.parentNode.removeChild(e); });
    if (!results) return;

    var tid = null; try { tid = _ratingsTidFor(results); } catch (e) { tid = null; }
    if (!tid) return;   // SUPPRESSED — practice/preview/MP/demo/no-real-track (same gate as recordLocal + ratings)

    var dur = songDuration || 0;
    var badges = document.getElementById('results-badges');
    var lb = document.getElementById('results-leaderboard');

    // ---- FIRST PULSE : the graduating-Easy INVITATION (Wave-4). On an EASY run cleared strong (grade A/S, real solo
    // — this whole function is already tid-gated), offer ONE inviting card to rehearse Medium's density+speed at the
    // FORGIVING window, UNRANKED. It reads as a next-step invite, not a remedial class. Clicking launches the same
    // track's Medium chart as a bridge run (RhythmCatalog.launchBridgeRun). Never appears on a bridge run's own
    // results (those are preview → this function early-returned above), on Medium/Hard, or on a failed run.
    try {
      var _bridgeOk = true; try { if (window.RhythmCatalog && window.RhythmCatalog.bridgeReady) _bridgeOk = !!window.RhythmCatalog.bridgeReady(); } catch (e) { _bridgeOk = true; }
      if (!results.failed && (results.difficulty || difficulty) === 'easy' && (grade === 'A' || grade === 'S') && _bridgeOk && badges) {
        var fphtml = '<div id="rr-firstpulse" style="margin:12px auto 0;max-width:360px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;'
          + 'padding:11px 15px;border-radius:12px;border:1px solid rgba(224,169,63,0.5);border-left:3px solid #ff1f2e;'
          + 'background:linear-gradient(100deg,rgba(255,31,46,0.16),rgba(224,169,63,0.12));box-shadow:0 0 18px rgba(224,169,63,0.16);">'
          + '<div style="text-align:left;min-width:180px;flex:1;">'
          + '<div style="font-family:\'Oxanium\',sans-serif;font-weight:800;font-size:14px;letter-spacing:0.05em;color:#ffe08a;text-shadow:0 0 10px rgba(224,169,63,0.35);">READY FOR PULSE?</div>'
          + '<div style="font-family:\'Chakra Petch\',sans-serif;font-size:11px;letter-spacing:0.03em;color:#cfc8c1;margin-top:3px;">Feel Medium’s pace at the Easy window — a no-pressure bridge run. Unranked.</div>'
          + '</div>'
          + '<button id="rr-firstpulse-go" type="button" style="flex:0 0 auto;padding:7px 16px;border-radius:9px;cursor:pointer;font-family:\'Chakra Petch\',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:#0d0605;background:linear-gradient(180deg,#f4c65a,#e0a93f);border:1px solid rgba(255,224,138,0.85);">Take the bridge</button>'
          + '</div>';
        badges.insertAdjacentHTML('afterend', fphtml);
        var fpbtn = document.getElementById('rr-firstpulse-go');
        if (fpbtn) fpbtn.addEventListener('click', function (ev) {
          if (ev && ev.isTrusted === false) return;
          try { if (window.RhythmCatalog && window.RhythmCatalog.launchBridgeRun) window.RhythmCatalog.launchBridgeRun(); } catch (e) {}
        });
      }
    } catch (e) {}

    // ---- R-1 : NEAR-MISS + NEXT-GOAL (forward-framed) + RETRY -------------------------------------------------
    // Supersede the build122 "results-almost" stamp on real runs (it covers the same near-FC/near-grade idea at a
    // TIGHTER bound and without a retry, so R-1's bounds are a strict superset) — the two never double up. On a
    // suppressed run R-1 never fires, so that stamp still shows exactly as before.
    try {
      if (!results.failed) {
        var _almost = document.getElementById('results-almost'); if (_almost && _almost.parentNode) _almost.parentNode.removeChild(_almost);
        var miss = counts.miss | 0;
        var fcGap = (!results.full_combo && miss >= 1 && miss <= 5) ? miss : null;   // notes from a Full Combo
        var LAD = [['D', -Infinity], ['C', 60], ['B', 75], ['A', 88], ['S', 95]];    // accuracy grade ladder (endGame's)
        var ci = -1; for (var _i = 0; _i < LAD.length; _i++) { if (LAD[_i][0] === grade) { ci = _i; break; } }
        var next = (ci >= 0 && ci < LAD.length - 1) ? LAD[ci + 1] : null;
        var GRADE_NEAR = 4.0;   // accuracy points — "one more clean section" from the next grade up
        var gradeGap = (next && typeof accShown === 'number') ? (next[1] - accShown) : null;
        var gradeOk = (gradeGap != null && gradeGap > 0 && gradeGap <= GRADE_NEAR);
        // pick the SINGLE nearest gap (each normalized to its own threshold window); ties -> the more visceral FC.
        var fcClose = (fcGap != null) ? (fcGap / 5) : Infinity;
        var gradeClose = gradeOk ? (gradeGap / GRADE_NEAR) : Infinity;
        var text = null;
        if (fcClose === Infinity && gradeClose === Infinity) { text = null; }   // nothing genuinely near → show NOTHING
        else if (fcClose <= gradeClose) { text = (fcGap === 1 ? '1 NOTE' : fcGap + ' NOTES') + ' FROM FULL COMBO'; }
        else {
          var gTxt = gradeGap < 0.05 ? '<0.1' : gradeGap.toFixed(1);
          var curStars = _starsForGrade(grade), nextStars = _starsForGrade(next[0]);
          if (nextStars > curStars) text = 'ONE STAR AWAY — ' + gTxt + '% FROM ' + nextStars + '★';
          else text = gTxt + '% FROM GRADE ' + next[0];
        }
        if (text && badges) {
          var html = '<div id="rr-neargoal" style="margin:10px auto 0;max-width:360px;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;'
            + 'padding:8px 14px;border-radius:11px;border:1px solid rgba(224,169,63,0.42);border-left:3px solid #ff1f2e;'
            + 'background:linear-gradient(90deg,rgba(255,31,46,0.14),rgba(224,169,63,0.10));">'
            + '<span style="font-family:\'Oxanium\',sans-serif;font-weight:800;font-size:13px;letter-spacing:0.06em;color:#ffe08a;text-shadow:0 0 10px rgba(224,169,63,0.35);">' + text + '</span>'
            + '<button id="rr-neargoal-retry" type="button" style="flex:0 0 auto;padding:5px 13px;border-radius:8px;cursor:pointer;font-family:\'Chakra Petch\',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:#0d0605;background:linear-gradient(180deg,#f4c65a,#e0a93f);border:1px solid rgba(255,224,138,0.8);">Retry</button>'
            + '</div>';
          badges.insertAdjacentHTML('afterend', html);
          var rbtn = document.getElementById('rr-neargoal-retry');
          if (rbtn) rbtn.addEventListener('click', function () { try { restartGame(); } catch (e) {} });
          var _rep = document.getElementById('results-replay'); if (_rep) _rep.classList.add('brag');
        }
      }
    } catch (e) {}

    // ---- G-3 : vs YOUR BEST pace strip (rendered before the trouble line so results read: pace → where → actions)
    try {
      if (!results.failed && dur > 0 && lb) {
        var key = 'rr_pace_' + tid + '_' + (results.difficulty || difficulty);
        var finalScore = Math.max(0, Math.round(results.score || 0));
        var thisPace = [];
        for (var bkt = 0; bkt < 10; bkt++) thisPace[bkt] = (typeof _paceSamples[bkt] === 'number') ? _paceSamples[bkt] : finalScore;
        thisPace[9] = finalScore;   // last bucket always reflects the true final (the loop can end before p hits 1.0)
        var best = null;
        try { var raw = localStorage.getItem(key); if (raw) { var arr = JSON.parse(raw); if (arr && arr.length === 10) best = arr; } } catch (e) {}
        if (best) {
          var segs = '', firstBehind = -1, lastAhead = -1;
          for (var s = 0; s < 10; s++) {
            var ahead = thisPace[s] >= best[s];
            if (ahead) lastAhead = s; else if (firstBehind < 0) firstBehind = s;
            segs += '<i style="flex:1;height:14px;border-radius:2px;background:' + (ahead ? '#e0a93f' : '#ff6b4a') + ';box-shadow:0 0 6px ' + (ahead ? 'rgba(224,169,63,0.45)' : 'rgba(255,107,74,0.4)') + ';"></i>';
          }
          var line;
          if (thisPace[9] > best[9]) {
            line = (firstBehind < 0) ? 'Ahead of your best the whole way — new peak.'
              : 'Behind at ' + fmtTime((firstBehind / 10) * dur) + ' — then you took it back. New best.';
          } else {
            var gap = best[9] - thisPace[9];
            if (gap === 0) line = 'Dead even with your best at the line.';
            else if (lastAhead >= 0 && lastAhead < 9) line = 'Ahead until ' + fmtTime(((lastAhead + 1) / 10) * dur) + ' — then your best pulled away.';
            else if (lastAhead < 0) line = 'Your best led the whole run — ' + gap.toLocaleString() + ' to close.';
            else line = gap.toLocaleString() + ' shy of your best at the finish.';
          }
          var phtml = '<div id="rr-pace" style="margin:14px auto 0;max-width:360px;">'
            + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;">'
            + '<span style="font-family:\'Chakra Petch\',sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#b9b2ac;">vs Your Best</span>'
            + '<span style="font-family:\'Oxanium\',sans-serif;font-size:10px;letter-spacing:0.05em;color:#8a847d;">start → finish</span></div>'
            + '<div style="display:flex;gap:3px;">' + segs + '</div>'
            + '<div style="font-family:\'Oxanium\',sans-serif;font-size:11.5px;color:#dad7d2;margin-top:6px;text-align:center;">' + line + '</div></div>';
          lb.insertAdjacentHTML('beforebegin', phtml);
        }
        // Update the stored best-pace when this run's final beats the stored final (or none stored yet). Entirely
        // game.js-side (rr_pace_* key) — catalog.recordLocal + the canonical per-song best are untouched.
        if (!best || finalScore > best[9]) { try { localStorage.setItem(key, JSON.stringify(thisPace)); } catch (e) {} }
      }
    } catch (e) {}

    // ---- G-1 : TROUBLE-SECTION detector → DRILL THIS SECTION (opens the existing Practice mode pre-filled @0.75×)
    try {
      if (lb && _g1MissTimes.length >= 4) {
        var msArr = _g1MissTimes.filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (a, b) { return a - b; });
        var WIN = 15, bestCount = 0, bestStart = 0;
        for (var kk = 0; kk < msArr.length; kk++) {
          var e0 = msArr[kk] + WIN, cnt = 0;
          for (var jj = kk; jj < msArr.length && msArr[jj] <= e0; jj++) cnt++;
          if (cnt > bestCount) { bestCount = cnt; bestStart = msArr[kk]; }
        }
        if (bestCount >= 4) {
          var wStart = Math.max(0, bestStart), wEnd = (dur > 0) ? Math.min(bestStart + WIN, dur) : (bestStart + WIN);
          var totalIn = 0;
          try { for (var n2 = 0; n2 < notes.length; n2++) { var nn = notes[n2]; if (nn.type === 'bomb') continue; if (nn.time >= wStart - 0.001 && nn.time <= wEnd + 0.001) totalIn++; } } catch (e) {}
          var dropped = (totalIn > 0) ? Math.min(bestCount, totalIn) : bestCount;
          var denom = Math.max(totalIn, dropped);
          var thtml = '<div id="rr-trouble" style="margin:12px auto 0;max-width:360px;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;'
            + 'padding:8px 14px;border-radius:11px;border:1px solid rgba(255,31,46,0.34);background:rgba(28,14,12,0.55);">'
            + '<span style="font-family:\'Oxanium\',sans-serif;font-size:12px;color:#ff9a6a;letter-spacing:0.03em;">You dropped ' + dropped + ' of ' + denom + ' in ' + fmtTime(wStart) + '–' + fmtTime(wEnd) + '</span>'
            + '<button id="rr-trouble-drill" type="button" style="flex:0 0 auto;padding:5px 13px;border-radius:8px;cursor:pointer;font-family:\'Chakra Petch\',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:#ffe0d6;background:rgba(255,31,46,0.16);border:1px solid rgba(255,31,46,0.6);">Drill it</button></div>';
          lb.insertAdjacentHTML('beforebegin', thtml);
          var dbtn = document.getElementById('rr-trouble-drill');
          if (dbtn) {
            var _ds = Math.max(0, wStart - 0.5), _de = (dur > 0) ? Math.min(dur, wEnd + 0.5) : (wEnd + 0.5);
            dbtn.addEventListener('click', function () { try { play(provider, { mode: 'practice', section: { start: _ds, end: _de }, speed: 0.75 }); } catch (e) {} });
          }
        }
      }
    } catch (e) {}

    // ---- Wave-3 : OVERDRIVE banked + CLEAN HOLDS end-tally (DERIVED reads only — diffs numbers existing sites already
    // paid / counts already tracked; never touches score, grade, accuracy, or leaderboard submit) ------------------
    try {
      var _odRows = '';
      if (_odTotalGain > 0) {
        _odRows += '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;font-family:\'Oxanium\',sans-serif;font-size:12px;color:#ffd98a;">'
          + '<span style="letter-spacing:0.06em;">◆ OVERDRIVE BANKED</span><span style="font-weight:800;">+' + Math.round(_odTotalGain).toLocaleString() + '</span></div>';
        if (_odBestGain > 0) _odRows += '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;font-family:\'Oxanium\',sans-serif;font-size:10.5px;color:#b9b2ac;margin-top:2px;"><span>best window · ' + (_odNotesTotal | 0) + ' notes covered</span><span>+' + Math.round(_odBestGain).toLocaleString() + '</span></div>';
      }
      if (_holdAttemptM > 0) {
        _odRows += '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;font-family:\'Oxanium\',sans-serif;font-size:12px;color:#e0a93f;margin-top:' + (_odTotalGain > 0 ? '7px' : '0') + ';"><span style="letter-spacing:0.06em;">CLEAN HOLDS</span><span style="font-weight:800;">' + (_holdCleanN | 0) + ' / ' + (_holdAttemptM | 0) + '</span></div>';
      }
      if (_odRows && lb) {
        lb.insertAdjacentHTML('beforebegin', '<div id="rr-odstat" style="margin:12px auto 0;max-width:360px;padding:9px 14px;border-radius:11px;border:1px solid rgba(224,169,63,0.30);background:rgba(26,16,10,0.5);">' + _odRows + '</div>');
      }
    } catch (e) {}

    // ---- Wave-3 : "TOP N% TODAY" social proof — first (usually null) synchronous pass. The real paint happens when
    // the async play submit resolves and catalog.js fires 'rr:playstats' (wired below). Fully guarded, display-only.
    try { _renderTodayPct(); } catch (e) {}
  }

  // ---- Wave-3 : "TOP N% TODAY" social-proof pill (REAL backend data, DISPLAY-ONLY) -----------------------------
  // Reads RhythmCatalog.getLastPlayStats() (populated by catalog.js off the /plays|/score response: today_percentile
  // 1..100 LOWER=better, plus today_count). The play submit is ASYNC — it resolves AFTER _renderResultsExtras's
  // synchronous pass — so catalog.js dispatches 'rr:playstats' when the stats land and we repaint here. Same real-solo
  // gate as the rest of results-extras (practice/preview/MP/demo → _ratingsTidFor null → nothing). Idempotent: it
  // removes any prior pill first, so the sync pass + the late event can both call it. Never touches score/grade/board.
  function _renderTodayPct() {
    var old = document.getElementById('rr-today-pct'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var res = _lastResults; if (!res || res.failed) return;
    var tid = null; try { tid = _ratingsTidFor(res); } catch (e) { tid = null; }
    if (!tid) return;   // SUPPRESSED — practice/preview/MP/demo/no-real-track (same gate as recordLocal + ratings)
    var st = null;
    try { st = (window.RhythmCatalog && window.RhythmCatalog.getLastPlayStats && window.RhythmCatalog.getLastPlayStats()) || null; } catch (e) { st = null; }
    if (!st || typeof st.percentile !== 'number' || !isFinite(st.percentile)) return;   // null / offline / older server → render NOTHING (no empty pill)
    var pct = Math.max(1, Math.min(100, Math.round(st.percentile)));
    var cnt = (typeof st.count === 'number' && isFinite(st.count) && st.count > 0) ? Math.round(st.count) : null;
    var cntTxt = cnt ? cnt.toLocaleString() : null;
    var anchor = document.getElementById('results-leaderboard');
    var badges = document.getElementById('results-badges');
    if (!anchor && !badges) return;
    var html;
    if (pct <= 60) {
      // strong social proof — "TOP 8% TODAY" (+ "of 214 today" when the count is known)
      html = '<div id="rr-today-pct" style="margin:12px auto 0;max-width:360px;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;'
        + 'padding:8px 14px;border-radius:11px;border:1px solid rgba(224,169,63,0.42);border-left:3px solid #ff1f2e;'
        + 'background:linear-gradient(90deg,rgba(255,31,46,0.14),rgba(224,169,63,0.10));">'
        + '<span style="font-family:\'Oxanium\',sans-serif;font-weight:800;font-size:13px;letter-spacing:0.07em;color:#ffe08a;text-shadow:0 0 10px rgba(224,169,63,0.35);">TOP ' + pct + '% TODAY</span>'
        + (cntTxt ? '<span style="font-family:\'Chakra Petch\',sans-serif;font-size:10.5px;letter-spacing:0.08em;text-transform:uppercase;color:#b9b2ac;">of ' + cntTxt + ' today</span>' : '')
        + '</div>';
    } else {
      // worse than ~60th percentile → friendlier climb framing (never a discouraging "bottom X%")
      html = '<div id="rr-today-pct" style="margin:12px auto 0;max-width:360px;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;'
        + 'padding:8px 14px;border-radius:11px;border:1px solid rgba(224,169,63,0.30);background:rgba(26,16,10,0.5);">'
        + '<span style="font-family:\'Oxanium\',sans-serif;font-weight:800;font-size:12.5px;letter-spacing:0.05em;color:#e0a93f;">' + (cntTxt ? cntTxt + ' PLAYERS TODAY' : 'IN TODAY’S MIX') + '</span>'
        + '<span style="font-family:\'Chakra Petch\',sans-serif;font-size:10.5px;letter-spacing:0.10em;text-transform:uppercase;color:#b9b2ac;">climb the board</span>'
        + '</div>';
    }
    try {
      if (anchor) anchor.insertAdjacentHTML('beforebegin', html);   // sit just above the leaderboard (thematic: "you beat N% today" → the board)
      else badges.insertAdjacentHTML('afterend', html);
    } catch (e) {}
  }
  // Repaint the pill when the async play submit resolves with today's stats (registered once at module load).
  try { window.addEventListener('rr:playstats', function () { try { _renderTodayPct(); } catch (e) {} }); } catch (e) {}

  // ---------- PAUSE ----------
  let _deferredStart = null;   // build65 (cycle-4): a stashed run-start thunk, set when a pause lands during the lead-in/countdown pre-roll (before the song began); consumed by resumeGame() so we never force-start audio behind a stuck PAUSED overlay.
  function pauseGame() {
    if (state !== 'playing' || _endingLock) return;   // build108 review fix (critical): NEVER pause during the fail-out wipeout beat — a pause (Escape/gamepad/blur/visibilitychange all route here) would flip state off 'playing', so the deferred endGame() re-entry guard would silently swallow the only teardown call and strand the failed run (resume then continues it as if it never failed).
    state = 'paused'; player.pause(); $('pause-overlay').classList.add('show');
    // A3: surface this run's timing bias + a one-tap RE-CALIBRATE (deduped every pause; renders nothing below the floor).
    try { _renderPauseCalibration(); } catch (e) {}
    // PRACTICE: the RESTART SECTION action is only meaningful in a practice run — show it there, hide it otherwise.
    try { const _rs = document.getElementById('restart-section-btn'); if (_rs) _rs.hidden = !_practiceOn; } catch (e) {}
    try { window.RhythmProcBg && window.RhythmProcBg.pause(); } catch (e) {}   // build66: freeze the reactive backdrop while paused
  }
  // two-tap RESTART confirm state (wired on #restart-btn below) — declared here so resumeGame can disarm it
  let _restartArmed = false;
  let _disarmRestart = function () {};
  function resumeGame() {
    if (state !== 'paused') return;
    _disarmRestart();
    // build65 (cycle-4): a pause that landed during the pre-roll never started the song → START it now (player.resume()
    // would be a no-op on a player that never played) instead of resuming.
    if (_deferredStart) { var _f = _deferredStart; _deferredStart = null; $('pause-overlay').classList.remove('show'); _f(); return; }
    player.resume(); state = 'playing';
    try { if (anyPadConnected()) _ensureFastPoll(); } catch (e) {}   // build102w/104 s3: resume = re-arm the pad input poller (it self-disarmed on pause)
    try { window.RhythmProcBg && window.RhythmProcBg.resume(); } catch (e) {}   // build66: resume the reactive backdrop
    $('pause-overlay').classList.remove('show');
    lastFrame = performance.now();
  }
  function hidePause() { _disarmRestart(); $('pause-overlay').classList.remove('show'); }

  // ---------- A3 (Wave-5): CALIBRATION SURFACING ----------
  // The offset machinery (audioOffset / rr_offset_ms / the calib wizard) shipped in build104; the only gap was
  // DISCOVERABILITY — a new player on a laggy device never found it. On pause we read the run's own per-hit timing
  // errors (_timingSamples: signed sec, >0 = pressed LATE) and, once there's a meaningful sample, surface a plain-
  // language read of the MEDIAN bias (median, not mean — one stray whiff shouldn't swing it) plus a one-tap
  // RE-CALIBRATE into the EXISTING wizard. DISPLAY / derived-read only — never touches score/judging (see HARD LAW).
  const PAUSE_CAL_FLOOR = 12;   // below a meaningful sample, show NOTHING rather than editorialize on noise
  function _pauseCalInfo() {
    const n = _timingSamples.length;
    if (n < PAUSE_CAL_FLOOR) return { n: n, medianMs: null, text: null };
    const sv = _timingSamples.map(s => s * 1000).sort((a, b) => a - b);
    const med = Math.round(sv.length % 2 ? sv[(sv.length - 1) / 2] : (sv[sv.length / 2 - 1] + sv[sv.length / 2]) / 2);
    const ad = Math.abs(med);
    const text = ad <= 8 ? 'Your timing looks dialed in'
      : ('Your hits are landing ~' + ad + 'ms ' + (med > 0 ? 'late' : 'early'));
    return { n: n, medianMs: med, text: text };
  }
  // Build the pause block by INJECTING DOM from game.js (index.html is owned by a parallel agent) — the same pattern
  // _renderResultsExtras uses for the results pills. Always removes the prior node FIRST so re-pausing can't stack it.
  function _renderPauseCalibration() {
    let ov = null; try { ov = $('pause-overlay'); } catch (e) {}
    if (!ov) return;
    const old = document.getElementById('rr-pause-cal'); if (old) old.remove();   // dedupe — never two
    const info = _pauseCalInfo();
    if (!info.text) return;   // below the sample floor → surface nothing rather than noise
    const dialed = Math.abs(info.medianMs) <= 8;
    const col = dialed ? '#e0a93f' : (info.medianMs > 0 ? '#ff7a4a' : '#dad7d2');   // brand: gold on-beat, warm-orange late, chrome early (no blue/green)
    const node = document.createElement('div');
    node.id = 'rr-pause-cal';
    node.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:9px;margin-top:-4px;max-width:340px;';
    const line = document.createElement('div');
    line.style.cssText = 'font-family:\'Chakra Petch\',sans-serif;font-size:12.5px;letter-spacing:0.05em;color:' + col + ';text-align:center;';
    line.textContent = info.text;
    const btn = document.createElement('button');
    btn.id = 'rr-pause-recal'; btn.className = 'ghost-btn'; btn.textContent = 'RE-CALIBRATE';
    btn.style.cssText = 'padding:9px 18px;font-size:12px;';
    // straight into the build104 wizard; the game stays paused underneath (calib-screen z-250 > pause-overlay z-100),
    // so closing the wizard returns to the pause menu with the run intact.
    btn.addEventListener('click', () => { try { openCalib(); } catch (e) {} });
    node.appendChild(line); node.appendChild(btn);
    const keys = ov.querySelector('.results-keys');
    if (keys && keys.parentNode === ov) ov.insertBefore(node, keys); else ov.appendChild(node);
  }

  // ---------- INPUT ----------
  // build148 T8: is the RIFT (Expert) tier available? Earned by clearing FRACTURE ≥85% (see endGame), or admin.
  // The ENGINE always accepts setDifficulty('rift') (levels/launch/tests) — this gate only controls the UI button.
  function _riftUnlocked() {
    try {
      if (localStorage.getItem('rr_rift_unlocked') === '1') return true;
      if (window.RhythmCatalog && typeof window.RhythmCatalog.isAdmin === 'function' && window.RhythmCatalog.isAdmin()) return true;
    } catch (e) {}
    return false;
  }
  function syncDiffButtons() {
    const _rl = _riftUnlocked();
    document.querySelectorAll('#diff-grid .diff-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.diff === difficulty);
      if (b.dataset.diff === 'rift') { b.classList.toggle('locked', !_rl); b.title = _rl ? 'Expert' : 'Clear FRACTURE at 85%+ to unlock'; }
    });
  }
  document.querySelectorAll('#diff-grid .diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // gate the Expert tier: a locked RIFT button nudges instead of switching
      if (btn.dataset.diff === 'rift' && !_riftUnlocked()) {
        try { window.RhythmGame.showToast('RIFT is Expert — clear FRACTURE (Hard) at 85%+ to unlock it', 'neutral'); } catch (e) {}
        return;
      }
      difficulty = btn.dataset.diff;
      syncDiffButtons();
      try { localStorage.setItem('rr_diff', difficulty); } catch (e) {}
    });
  });
  // restore the last-chosen difficulty so it sticks across sessions
  try {
    const d = localStorage.getItem('rr_diff');
    if (d && DIFF_STEP[d]) { difficulty = d; syncDiffButtons(); }
    else if (!localStorage.getItem('rr_career') && !localStorage.getItem('rr_scores')) {   // build83: a TRUE first run (no saved difficulty AND no play history) → start on EASY (real on-ramp; was defaulting to Medium)
      difficulty = 'easy'; syncDiffButtons(); _firstRunEasy = true;
    }
  } catch (e) {}
  try { syncDiffButtons(); } catch (e) {}   // build148 T8: always reconcile the RIFT lock state on load (covers the no-saved-diff-but-has-history case)
  if (_firstRunEasy) setTimeout(() => { try { window.RhythmGame.showToast('Starting you on EASY — bump it up anytime in difficulty ▸', 'neutral'); } catch (e) {} }, 2600);   // build89: 'neutral' is a supported severity ('info' was coerced to neutral anyway)
  $('resume-btn').addEventListener('click', resumeGame);
  // RESTART is gated behind a two-tap "tap again to restart" confirm so a stray click can't nuke a
  // good run. Same arm idiom as RESET CAREER / RESET ALL SETTINGS. Disarms on resume/exit/timeout.
  { const rsb = $('restart-btn'); if (rsb) {
    const RESTART_LABEL = rsb.textContent || 'RESTART';
    let restartArmT = 0;
    _disarmRestart = () => { _restartArmed = false; rsb.textContent = RESTART_LABEL; rsb.classList.remove('arm'); clearTimeout(restartArmT); };
    rsb.addEventListener('click', () => {
      if (!_restartArmed) { _restartArmed = true; rsb.textContent = 'TAP AGAIN TO RESTART'; rsb.classList.add('arm'); clearTimeout(restartArmT); restartArmT = setTimeout(_disarmRestart, 3000); return; }
      _disarmRestart(); hidePause(); restartGame();
    });
  } }
  // PRACTICE: RESTART SECTION — single tap re-seeks to the section start + re-arms WITHOUT a full teardown of the
  // practice context (same section + speed). No confirm gate: it's a low-stakes drill reset, not a run-nuking action.
  { const rsec = document.getElementById('restart-section-btn'); if (rsec) {
    rsec.addEventListener('click', () => { _disarmRestart(); hidePause(); if (_practiceOn) practiceRearm(); });
  } }
  $('exit-btn').addEventListener('click', () => { _disarmRestart(); hidePause(); _abortBridge(); stopGame(); try { _fireSongEnd('exit'); } catch (e) {} showScreen('menu'); });
  // FIRST PULSE: quitting a bridge run mid-song never reaches endGame's handoff, so disarm here — restore the
  // pre-bridge tier (rr_diff on disk was never changed) so the player returns to menu on their Easy tier, and clear
  // the bridge state so it can't leak into the next run. No-op when no bridge run is active.
  function _abortBridge() { if (!_bridgeRun && _bridgePrevDiff == null) return; var prev = _bridgePrevDiff; _bridgeRun = false; _bridgePrevDiff = null; if (prev != null) difficulty = prev; try { syncDiffButtons(); } catch (e) {} }
  let lastResults = null;
  // B2 ENCORE CHAIN: the shared PLAY AGAIN / ENCORE button. When a strong finish armed an encore AND the catalog gave a
  // curated next track, accepting LAUNCHES that track and extends the ENCORE ×n chain (peak-end: feed the catalog). Any
  // other case — no armed encore, no curated next, or a failed launch — falls back to the EXACT same-song replay
  // (restartGame), so there's never a regression or a dead button. Pure launch + counter; no score surface.
  function _onReplayClick() {
    if (_encoreArmed && _encoreNext && window.RhythmCatalog && typeof window.RhythmCatalog.launchTrack === 'function') {
      const _t = _encoreNext;
      _encoreArmed = false; _encoreNext = null;              // consume the offer (a second click can't double-launch)
      _encoreAccepting = true;                                // tell the next run's resetScoring to KEEP the chain
      _encoreChain = Math.min(_encoreChain + 1, 999);         // extend BEFORE launch so this run's results read the new depth
      let ok = false; try { ok = !!window.RhythmCatalog.launchTrack(_t); } catch (e) { ok = false; }
      if (ok) return;
      // launch failed (unlaunchable track): undo the extend + accept flag, fall back to a same-song replay (no dead button)
      _encoreChain = Math.max(0, _encoreChain - 1); _encoreAccepting = false;
    }
    restartGame();
  }
  $('results-replay').addEventListener('click', () => { _onReplayClick(); });
  $('results-menu').addEventListener('click', () => { stopGame(); showScreen('menu'); });
  // SHARE SCORE — the #1 marketing surface. Builds the branded "Signal Card" PNG and shares it
  // (native share sheet WITH the image on mobile/Safari; a brand-styled fallback panel elsewhere).
  // The blob is pre-baked synchronously enough to keep the click's transient activation alive.
  { const sb = $('results-share'); if (sb) sb.addEventListener('click', () => {
    if (!lastResults) return;
    const r = lastResults, res = r.results || {};
    // map the engine's results object → the Share Card payload (newBest/gradeUp read live).
    const payload = {
      score: res.score, grade: r.grade, accuracy: res.accuracy, maxCombo: res.max_combo,   /* build65 (cycle-5): pass the raw 0..1 fraction (share.js normalizes once); r.accPct (0..100) made a sub-1% run read 100x inflated */
      notesHit: res.notes_hit, notesTotal: res.notes_total, comboTierName: r.comboTierName,
      full_combo: res.full_combo, newBest: !!res._newBest, gradeUp: !!res._gradeUp,
      song: r.track, artist: r.artist, cover: r.cover, diff: r.diff, counts: r.counts,
      guitarSrc: r.guitarSrc, guitarName: r.guitarName, kind: 'score'
    };
    if (!(window.RhythmShare && window.RhythmShare.shareScore)) {
      // graceful fallback to the old clipboard line if share.js somehow didn't load
      const line = '♪ ' + r.track + (r.artist ? ' — ' + r.artist : '') + '\nReactive Rhythm · ' + r.diff +
        '\nGrade ' + r.grade + ' · ' + (res.score || 0).toLocaleString() + ' pts · ' + r.accPct.toFixed(1) + '% · ' + (res.max_combo || 0) + 'x' + (res.full_combo ? ' · FULL COMBO' : '');
      try { navigator.clipboard.writeText(line); sb.textContent = 'COPIED ✓'; } catch (e) { sb.textContent = 'COPY FAILED'; }
      setTimeout(() => { sb.innerHTML = '<span class="rs-share-glyph" aria-hidden="true">⤴</span> SHARE SCORE'; }, 1600);
      return;
    }
    sb.classList.remove('share-pulse');
    const reset = () => { sb.innerHTML = '<span class="rs-share-glyph" aria-hidden="true">⤴</span> SHARE SCORE'; };
    sb.textContent = 'BUILDING…';
    window.RhythmShare.shareScore(payload).then((outcome) => {
      if (outcome === 'shared') sb.textContent = 'SHARED ✓';
      else if (outcome === 'panel') sb.textContent = 'PICK A PLATFORM';
      else if (outcome === 'error') sb.textContent = 'TRY AGAIN';
      else reset();   // cancelled → straight back
      if (outcome === 'shared' || outcome === 'panel' || outcome === 'error') setTimeout(reset, 1600);
    }).catch(() => { sb.textContent = 'TRY AGAIN'; setTimeout(reset, 1600); });
  }); }
  // celebratory nudge: a NEW BEST / FULL COMBO / grade-S run is worth showing off — pulse the
  // SHARE button so the eye lands on it right after the grade reveal. (exposed for renderResults.)
  function pulseShareIfBrag(results, grade) {
    try {
      const sb = $('results-share'); if (!sb || !results) return;
      const brag = !!results.full_combo || grade === 'S' || !!results._newBest;
      if (brag) { sb.classList.remove('share-pulse'); void sb.offsetWidth; sb.classList.add('share-pulse'); }
      else sb.classList.remove('share-pulse');
      // build99L (render-only): flag a NEW BEST on the results screen so the Final Score KPI gets the gold accent (reserve gold for achievement)
      const rs = $('results'); if (rs) rs.classList.toggle('is-newbest', !!results._newBest);
    } catch (e) {}
  }

  // ---------- UNIFIED LANE INPUT (gameplay + Settings input-test probe) ----------
  // Every input source (touch / key / MIDI / gamepad) funnels through here, so the
  // Settings "Test Input" panel can light a lane from any device while gameplay only
  // reacts when actually playing. laneProbe is non-null only during the test.
  let laneProbe = null;
  function setLaneProbe(fn) { laneProbe = fn || null; if (laneProbe) startProbePoll(); else stopProbePoll(); }
  function onLaneInput(lane, source, evTime) {
    if (lane == null || lane < 0 || lane >= LANE_COUNT) return;
    if (laneProbe) { try { laneProbe(lane, source); } catch (e) {} }
    if (performance.now() < _mpStunUntil) return;   // v254: MP combat — your inputs are shocked/dead for the stun window
    if (_endingLock) return;   // build108: the run is already lost (fail-out wipeout beat) — no more hits can land
    if (state === 'playing') handleHit(lane, evTime, source);   // build102w: source rides along so guitar-strum empties can be free
  }
  // lane physically released (key-up / pointer-up) — ends any active sustain in that lane
  function onLaneRelease(lane) {
    if (lane == null || lane < 0 || lane >= LANE_COUNT) return;
    laneDown[lane] = false;
  }
  // build148 T5 (Fable multiplier-ramp retune): combo needed per multiplier TIER. Loop-reachability (Law 1) — a
  // dense chart still has to reach its first reward. Hard/RIFT chains broke every ~15 notes at step 12, stranding
  // players at 1× (never seeing 2×@12 / HOT@25); step 8 puts 2× at combo 8, 3× at 16. comboCap / MAX_MULT / the
  // notes_total*1500 ceiling are ALL untouched — a perfect FC still reaches 4× on every tier (leaderboard-safe);
  // only how FAST you ramp changes. Easy/Medium keep the classic feel; the 'tight' timing profile stays as-tuned.
  function _comboStepFor() {
    const base = timingProf().comboStep;
    if (timingFeel !== 'classic') return base;            // 'tight' profile (step 10) already tuned — leave it
    return (difficulty === 'hard' || difficulty === 'rift') ? 8 : base;
  }
  // current score multiplier (combo tier + overdrive), shared by taps and sustains
  function curMult() {
    const _tp = timingProf();
    const ct = Math.min(_tp.comboCap, 1 + Math.floor(combo / _comboStepFor()));
    const cap = _tp.comboCap + 1;                       // overdrive adds one tier above the base cap
    return Math.min(MAX_MULT, Math.min(odActive ? cap : _tp.comboCap, odActive ? ct + 1 : ct));   // v258: hard-clamp to MAX_MULT (=4) — the 'tight' profile's comboCap:5 + overdrive could reach 6× and bust the notes_total*1500 ceiling
  }
  // T9 telemetry — generic swap-seam-safe sink (consent-gated + fire-and-forget inside RhythmTelemetry). Adds the
  // live trackId + difficulty to every mechanic event. Never throws; a missing/absent telemetry module is a no-op.
  function _tlog(name, props) {
    try {
      if (!(window.RhythmTelemetry && window.RhythmTelemetry.event)) return;
      var tid = null;
      try { tid = (session && (session.trackId || (session.meta && session.meta.id))) || null; } catch (e) { tid = null; }
      var row = { trackId: tid, difficulty: difficulty };
      if (props) for (var k in props) row[k] = props[k];
      window.RhythmTelemetry.event(name, row);
    } catch (e) {}
  }
  // T7 teaching counter — per-profile rr_hints {hold, rail}, capped at 2. Read by buildNotes to decide tags; bumped
  // here on a CLEAN completion so the glyph retires forever once the mechanic is learned. Never throws.
  function _bumpHint(kind) {
    try {
      const s = JSON.parse(localStorage.getItem('rr_hints') || '{}');
      const o = { hold: (s && s.hold | 0) || 0, rail: (s && s.rail | 0) || 0 };
      if ((kind === 'hold' || kind === 'rail') && o[kind] < 2) o[kind]++;
      localStorage.setItem('rr_hints', JSON.stringify(o));
    } catch (e) {}
  }
  // Credit a taught head's clean completion exactly once. A rail counts only when ALL transfers were made (the captured
  // segment index reached the waypoint count). P2 never calls this (it uses its own P.holdNote path) → never-for-P2.
  function _teachCredit(hn, seg) {
    if (!hn || !hn._teach || hn._teachDone) return;
    if (hn._teach === 'rail') { const need = hn.rail ? hn.rail.length : 1; if ((seg || 0) < need) return; }
    hn._teachDone = true;
    _bumpHint(hn._teach);
  }
  // Wave-3 finding 4 (render/SFX/stats ONLY — no score touched; completion already banked its sustain above): a
  // cleanly-completed sustain earns CEREMONY, not money. Consecutive clean holds escalate the callout
  // (HOLD! → CLEAN! → RIDE MASTER) and the burn-off up the string. Called from completeHold + the GRACE band of
  // endHoldEarly. `_holdCleanN`/`_cleanHoldStreak` are never read by any scoring/grade path.
  function _cleanHoldCeremony(lane) {
    _holdCleanN++; _cleanHoldStreak++;
    const s = _cleanHoldStreak;
    const label = s >= 5 ? 'RIDE MASTER' : (s >= 3 ? 'CLEAN!' : 'HOLD!');
    const color = s >= 5 ? '#fff6ec' : (s >= 3 ? '#ffd98a' : '#e0a93f');
    if (s >= 3) { try { _armJudgePriority(s >= 5 ? 520 : 460); } catch (e) {} }   // a milestone clean-ride headlines over the next plain GREAT
    flashJudgment(label, color);
    // burn-off beam up the completed string + a fuller sweep as the streak climbs (house FX; motion-gated)
    try {
      if (fx && !reduceMotion && !fxLite) {
        const g = fretGeom(), k = (g.lw / 128) * FX_GLOBAL;
        emitStringSurge(lane, 'note-comet', 0, k, g);
        if (s >= 3) { scanT = scanDur = Math.min(0.5, 0.34 + s * 0.02); scanTier = Math.min(4, 2 + Math.floor(s / 3)); }
      }
    } catch (e) {}
    if (navigator.vibrate) { try { navigator.vibrate(s >= 5 ? [14, 20, 22] : (s >= 3 ? [12, 16] : 12)); } catch (e) {} }
  }
  // sustain reached its tail end while held — pay any remaining fraction + a release pop
  function completeHold(lane) {
    const hn = holdNote[lane]; if (!hn) return;
    const _seg = holdRailSeg[lane] || 0;   // T7: capture the rail segment BEFORE the reset below (all-transfers check)
    const rem = Math.max(0, 1 - holdScored[lane]);
    if (rem > 0.001) score += rem * holdTotalFor(hn) * curMult();
    holdScored[lane] = 1; holdNote[lane] = null; holdRailSeg[lane] = 0;
    laneHitPulse[lane] = 1.0; lanePluckT[lane] = 0;
    spawnHitParticles(lane, 'great');
    emitFx('holdend', 'hold', lane);   // build8c: sustain banked — column pulse up the lane
    _cleanHoldCeremony(lane);          // Wave-3 finding 4: escalating clean-hold ceremony (render/SFX only)
    try { _teachCredit(hn, _seg); } catch (e) {}                                                    // T7: clean completion → learn
    _tlog('hold_banked', { lane: lane, type: hn.type, banked: 1, via: 'complete' });                // T9
    updateHUD();
  }
  // let go before the tail — build104 s6d: THREE release bands (a binary cliff at 0.75 made a 74% hold feel
  // identical to a 5% head-tap; the middle band keeps the streak alive without paying the completion):
  //   ≥0.75 (GRACE)  → forgiven: completes like a clean hold (unchanged).
  //   0.45–0.75      → SLIP: you clearly rode most of it — banked sustain stays (monotone with hold time),
  //                    combo/stability survive, but no completion payout; soft cue (dim beam, no squelch).
  //   <0.45          → genuine drop: combo break + dead beam + squelch (unchanged).
  function endHoldEarly(lane) {
    const hn = holdNote[lane]; if (!hn) return;
    const GRACE = 0.75;                 // held at least this far → the release is forgiven (tail grace)
    const SLIP = 0.45;                  // held most of it → keep the streak, forfeit the rest of the payout
    const _seg0 = holdRailSeg[lane] || 0, _bankAt = holdScored[lane] || 0;   // T7/T9: capture before the reset below
    holdNote[lane] = null; holdRailSeg[lane] = 0;   // SLIDE RAILS: a rail resolves through these SAME bands (banked fraction is path-global)
    if (holdScored[lane] >= GRACE) {    // home stretch → count it as a clean hold
      const rem = Math.max(0, 1 - holdScored[lane]);
      if (rem > 0.001) score += rem * holdTotalFor(hn) * curMult();
      holdScored[lane] = 1;
      laneHitPulse[lane] = 1.0; lanePluckT[lane] = 0;
      spawnHitParticles(lane, 'great');
      _cleanHoldCeremony(lane);          // Wave-3 finding 4: GRACE band is a clean bank → same escalating ceremony
      try { _teachCredit(hn, _seg0); } catch (e) {}                                                 // T7: GRACE band is a clean bank → learn
      _tlog('hold_banked', { lane: lane, type: hn.type, banked: +_bankAt.toFixed(3), via: 'grace' });   // T9
    } else if (holdScored[lane] >= SLIP) {   // SLIP band — soft landing, no combo break, no squelch, no stability hit
      hn.dropped = true;                // the remaining beam dims (render's 'resolving' state)
      lanePluckT[lane] = 9;             // the string settles
      _cleanHoldStreak = 0;             // Wave-3 finding 4: a slip is NOT a clean ride — reset the clean-hold streak
      flashJudgment('SLIP', '#9a938c');   // Wave-3 finding 4: warm-smoke, off PERFECT-white (#dad7d2) so SLIP reads distinct from a PERFECT
      _tlog('hold_slipped', { lane: lane, type: hn.type, banked: +_bankAt.toFixed(3) });            // T9
    } else {                            // genuine drop → you let go too early
      hn.dropped = true;
      _cleanHoldStreak = 0;             // Wave-3 finding 4: a dropped hold breaks the clean-hold streak
      _g1Miss(hn.time);                 // G-1: a dropped hold is a trouble spot too
      _tlog('hold_dropped', { lane: lane, type: hn.type, banked: +_bankAt.toFixed(3) });            // T9
      // build122 review: this is the THIRD combo-break site — the miss/bomb sites snapshot the CLUTCH state
      // but this one omitted it, so a dropped-hold peak could leak stale-high across the broken streak and
      // spuriously arm a CLUTCH the player never earned. Mirror the miss/bomb reset (observational only).
      if (_peakCombo >= CLUTCH_MIN_BREAK_PEAK) { _lastBreakPeak = _peakCombo; _clutchArmed = true; } else { _clutchArmed = false; }
      _peakCombo = 0;
      combo = 0; comboTierCur = 0;
      stability = Math.max(0, stability - 0.03);
      lanePluckT[lane] = 9;             // the string goes dead in this lane
      registerMissFx(lane);
      flashJudgment('DROPPED', '#ff6b78');
      playMissSfx();
    }
    updateHUD();
  }
  // ---- SLIDE RAILS input/judging (spec A2) — one mental model = the hold's, plus a migrating slot -----------
  // Is `lane` the pending transfer DESTINATION of an active rail, inside its window? Used to (a) suppress the empty-
  // press whiff when a keyboard/touch destination press services a transfer, and (b) let a GH fret-change migrate.
  function _activeRailForDest(lane, jt) {
    for (let l = 0; l < LANE_COUNT; l++) {
      const hn = holdNote[l]; if (!hn || hn.type !== 'rail' || !hn.rail) continue;
      const seg = holdRailSeg[l] || 0; if (seg < 1 || seg >= hn.rail.length) continue;
      if (hn.rail[seg].lane !== lane) continue;
      const wt = hn.time + hn.rail[seg].t, TW = RAIL_TW[difficulty] || 0.18;
      if (jt >= wt - 0.6 * TW && jt <= wt + TW) return l;
    }
    return -1;
  }
  // migrate the active rail slot from `fromLane` to `toLane` — the banked fraction is path-global (carries over), the
  // transfer awards ZERO score (juice only). A made transfer flashes "SLIDE ▸" (warm gold) + a spark on the dest catcher.
  function _railMigrate(fromLane, toLane, note, nextSeg) {
    holdNote[toLane] = note; holdScored[toLane] = holdScored[fromLane]; holdSparkT[toLane] = holdSparkT[fromLane] || 0; holdRailSeg[toLane] = nextSeg;
    holdNote[fromLane] = null; holdScored[fromLane] = 0; holdRailSeg[fromLane] = 0;
    laneHitPulse[toLane] = 1.0; lanePluckT[toLane] = 0;
    flashJudgment('SLIDE ▸', '#e0a93f');
    try { spawnHitParticles(toLane, 'great'); emitFx('hit', 'great', toLane); } catch (e) {}
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
    _tlog('rail_transfer', { from: fromLane, to: toLane, seg: nextSeg, made: true });   // T9: transfer MADE (juice only, no score)
  }
  // per-frame liveness + transfer for the active rail in lane `lane`. Returns 'pay' (fall through to the shared sustain
  // payout on this lane), 'migrated' (slot moved this frame → skip payout here), or 'drop' (resolved via endHoldEarly's
  // GRACE/SLIP/DROP bands). No new score sites; no new punishment vocabulary.
  function _railSustainStep(lane, note, jt) {
    if (performance.now() < _mpStunUntil) return 'pay';   // MP stun: coast (the payout branch advances the marker w/o pay)
    const rail = note.rail; if (!rail) { if (!laneDown[lane]) { endHoldEarly(lane); return 'drop'; } return 'pay'; }
    const seg = holdRailSeg[lane] || 0, TW = RAIL_TW[difficulty] || 0.18;
    if (seg >= 1 && seg < rail.length) {
      const wt = note.time + rail[seg].t, newLane = rail[seg].lane, w0 = wt - 0.6 * TW, w1 = wt + TW;
      if (jt < w0) { if (!laneDown[lane]) { endHoldEarly(lane); return 'drop'; } return 'pay'; }   // before window: current segment lane must be down
      if (jt <= w1) {                                                                               // inside window: dest down → transfer; else either-down keeps alive
        if (laneDown[newLane]) { _railMigrate(lane, newLane, note, seg + 1); return 'migrated'; }
        if (laneDown[lane]) return 'pay';
        _tlog('rail_transfer', { from: lane, to: newLane, seg: seg, made: false, banked: +(holdScored[lane] || 0).toFixed(3) });   // T9: transfer MISSED (neither lane down in-window)
        endHoldEarly(lane); return 'drop';                                                          // neither down inside the window
      }
      _tlog('rail_transfer', { from: lane, to: newLane, seg: seg, made: false, banked: +(holdScored[lane] || 0).toFixed(3) });     // T9: transfer MISSED (window closed)
      endHoldEarly(lane); return 'drop';                                                            // window closed, transfer missed → bands
    }
    if (!laneDown[lane]) { endHoldEarly(lane); return 'drop'; }                                     // past all transfers → hold-like on the last segment
    return 'pay';
  }
  // dev-only harness for deterministic input/sustain testing (no effect on real play)
  try {
    // JUICE live-tuning (dev hook, strip at content-freeze): tune FX intensities to taste while a song plays —
    // __rrJuice.preset('subtle'|'balanced'|'intense'), or .set({ bloom: 0.12, odRing: 0.8 }); persists to localStorage.
    window.__rrJuice = {
      get: () => Object.assign({}, JUICE),
      set: (o) => { if (o) for (const k in JUICE) if (typeof o[k] === 'number') JUICE[k] = o[k]; try { localStorage.setItem('rr_juice', JSON.stringify(JUICE)); } catch (e) {} return Object.assign({}, JUICE); },
      preset: (n) => { if (FX_PRESETS[n]) window.RhythmGame.applySettings({ fxIntensity: n }); return Object.assign({}, JUICE); },
      reset: () => { window.RhythmGame.applySettings({ fxIntensity: 'balanced' }); return Object.assign({}, JUICE); }
    };
    window.__rrDebug = {
      state: () => state,
      jt: () => (state === 'playing' ? +(songTime() - audioOffset).toFixed(3) : null),
      score: () => Math.floor(score),
      nextHold: () => { const j = songTime() - audioOffset; const h = notes.find(n => n.type === 'hold' && !n.judged && n.time > j - 0.05); return h ? { lane: h.lane, time: +h.time.toFixed(3), inSec: +(h.time - j).toFixed(3), hold: +h.hold.toFixed(2) } : null; },
      holding: () => holdNote.map((h, i) => h ? { lane: i, scored: +holdScored[i].toFixed(2) } : null).filter(Boolean),
      press: (lane, lagMs) => { if (state === 'playing') { laneDown[lane] = true; onLaneInput(lane, 'key', performance.now() - (lagMs || 0)); } },   // build104 s1a: optional lagMs simulates a delayed input event (late-edge race probe)
      release: (lane) => onLaneRelease(lane),
      // build122 p1 CLUTCH dev hook (strip at content-freeze): inspect the recovery-tracking state headlessly
      // without a real 25+ combo break/rebuild. Read-only — does not itself mutate combo/score.
      clutch: () => ({ peakCombo: _peakCombo, lastBreakPeak: _lastBreakPeak, armed: _clutchArmed, count: _clutchCount, combo }),
      // GH require-strum dev hooks (strip at content-freeze): verify the gate + live config + held frets
      requireStrum: () => requireStrum(),
      strumState: () => ({ require: requireStrum(), profile: laneProfile, guitar: guitarPadId(), cfg: Object.assign({}, strumCfg), heldFrets: Array.from(_frets) }),
      // combo-tier dev hooks (stripped at content-freeze) — drive the ladder without a 500-streak run
      setCombo: (n) => { combo = Math.max(0, n | 0); if (combo > maxCombo) maxCombo = combo; const nt = comboTierIdx(combo); if (nt > comboTierCur) { comboTierCur = nt; onComboTierUp(nt, 2); } else { comboTierCur = nt; } updateHUD(); const cd = document.getElementById('combo-display'); return { combo, tier: comboTierCur, name: COMBO_TIERS[comboTierCur].name, dataTier: cd && cd.getAttribute('data-tier'), numColor: cd && cd.style.getPropertyValue('--ct-num') }; },
      comboTier: () => ({ combo, idx: comboTierIdx(combo), name: COMBO_TIERS[comboTierIdx(combo)].name, cur: comboTierCur, ladder: COMBO_TIERS.map(t => t.name + '@' + t.min) }),
      chargeOd: () => { overdrive = 1; updateHUD(); return overdrive; },
      od: () => ({ overdrive: +overdrive.toFixed(2), active: odActive, timer: +odTimer.toFixed(2), ready: overdrive >= 1 && !odActive, igniteT: +odIgniteT.toFixed(3) }),   // build109 s3: igniteT exposed for the wind-up verification pass
      // Wave-3 verification hooks (strip at content-freeze) — READ-only, never mutate score/OD/combo:
      odOver: () => +odOvercharge.toFixed(3),                                                            // finding 3: cosmetic overcharge reservoir level
      odBank: () => ({ last: _odLastGain, total: _odTotalGain, best: _odBestGain, notes: _odNotesTotal }),   // finding 2: derived OD end-tally readouts
      cleanHolds: () => ({ clean: _holdCleanN, attempts: _holdAttemptM, streak: _cleanHoldStreak }),     // finding 4: clean-hold counters
      fever: () => { const i = comboTierIdx(combo), t = COMBO_TIERS[i], n = COMBO_TIERS[i + 1]; return { tier: t.name, next: n ? n.name : null, toNext: n ? Math.max(0, n.min - combo) : 0 }; },   // finding 1: FEVER ladder read
      // build148 T1/T5/T8 dev hooks (strip at content-freeze): Flow-Shield tally, effective comboStep, RIFT tier state.
      flowShields: () => _flowShieldCount,   // T1: shields spent this run (verifies OD-active misses kept combo)
      comboStep: () => _comboStepFor(),       // T5: effective combo-per-tier for the current difficulty (Hard/RIFT=8)
      rift: () => ({ difficulty, unlocked: _riftUnlocked(), step: DIFF_STEP.rift, approach: DIFFICULTY.rift.approach, hitWindow: DIFFICULTY.rift.hitWindow }),
      setDiff: (d) => { if (DIFF_STEP[d]) { difficulty = d; try { syncDiffButtons(); } catch (e) {} } return difficulty; },   // T8: force any tier (incl. rift) for a headless chart-build probe
      unlockRift: () => { try { localStorage.setItem('rr_rift_unlocked', '1'); } catch (e) {} return _riftUnlocked(); },
      audio: () => ({ musicVol: +musicVol.toFixed(2), curGain: +curGain.toFixed(3), nodeGain: (player && player.gain) ? +player.gain.gain.value.toFixed(3) : null, muted, sfx: +SFX_LEVEL.toFixed(3), offsetMs: Math.round(audioOffset * 1000) }),
      // build104 s2 dev probes (strip at content-freeze): seed the timing-sample buffer with a fixed bias so the
      // results auto-calibration chip is verifiable headless, + end the live run on demand (a real 4-min playthrough
      // is not viable in a throttled tab).
      seedTiming: (ms, n) => { _timingSamples = new Array(Math.max(4, n || 60)).fill((ms || 0) / 1000); return _timingSamples.length; },
      // A3 pause-calibration probes (strip at content-freeze): rAF is throttled headless so pauseGame() can't be driven
      // normally — pauseCal() force-renders the injected pause-overlay block and returns the line it rendered (or null
      // below the floor); pauseCalInfo() returns the pure {n, medianMs, text} read used to build it.
      pauseCalInfo: () => _pauseCalInfo(),
      pauseCal: () => { _renderPauseCalibration(); const el = document.getElementById('rr-pause-cal'); const l = el && el.firstChild; return l ? l.textContent : null; },
      beatsRaw: () => ({ period: beats._period || 0, phase: beats._phase || 0, on: beats.map(b => [Math.round(b.t * 1000) / 1000, Math.round((b.strength || 1) * 100) / 100]) }),   // build104 s4 diag (strip at freeze)
      notesRaw: () => notes.map(n => ({ t: Math.round(n.time * 1000) / 1000, l: n.lane, ty: n.type, h: n.hold ? Math.round(n.hold * 1000) / 1000 : 0, ch: n.chord ? 1 : 0, lead: n.chordLead ? 1 : 0, f: n._fill ? 1 : 0, tr: n._trill ? 1 : 0, pat: (typeof n._pat === 'number') ? n._pat : -1, db: n._downbeat ? 1 : 0, teach: n._teach || 0, rail: (n.type === 'rail' && n.rail) ? n.rail.map(w => [Math.round(w.t * 1000) / 1000, w.lane]) : 0 })),   // build104 s5/6 diag (strip at freeze); teach = T7 head glyph tag
      // T7 teaching (strip at freeze): the per-profile learn counters (capped at 2 each). buildNotes tags heads only while a counter is < 2.
      hints: () => { try { const s = JSON.parse(localStorage.getItem('rr_hints') || '{}'); return { hold: (s.hold | 0) || 0, rail: (s.rail | 0) || 0 }; } catch (e) { return { hold: 0, rail: 0 }; } },
      setHints: (h, r) => { try { localStorage.setItem('rr_hints', JSON.stringify({ hold: h | 0, rail: r | 0 })); } catch (e) {} return window.__rrDebug.hints(); },   // T7 test lever: seed/clear the learn counters
      // ---- SLIDE RAILS dev hooks (spec A2.5 / A1.3 / A3.3; strip at content-freeze) --------------------------------
      railsOn: (v) => { if (v === undefined) return RAILS_ON(); try { localStorage.setItem('rr_rails', v ? '1' : '0'); } catch (e) {} return RAILS_ON(); },
      // A2 STARSTRUCK dev hooks (strip at content-freeze): toggle the dark flag + read the live phrase state.
      odPhraseOn: (v) => { if (v === undefined) return STARPHRASE_ON(); try { localStorage.setItem('rr_odphrase', v ? '1' : '0'); } catch (e) {} return STARPHRASE_ON(); },
      phrases: () => { const s = new Set(); for (const n of notes) if (n.phraseId != null) s.add(n.phraseId); return { on: STARPHRASE_ON(), count: s.size, tagged: notes.filter(n => n.phraseId != null).length, hit: Object.assign({}, _phraseHit), done: Object.assign({}, _phraseDone) }; },
      // exercise the SHIPPED ANCHORED _tagStarPhrases on a synthetic approach-run: two taps + an accent leading into a
      // star (within hard's 4s window) → one phrase of 4, the star LAST; a lone star with no eligible approach → none.
      starPhraseTest: () => {
        const mk = (t, ty) => ({ type: ty, time: t });
        const a = [mk(1.0, 'tap'), mk(1.9, 'tap'), mk(2.7, 'accent'), mk(3.3, 'star'),   // approach run → phrase len 4
                   mk(9.0, 'hold'), mk(9.5, 'star'),                                       // only a hold precedes → 1 member < min → none
                   mk(20.0, 'tap'), mk(20.8, 'tap'), mk(21.6, 'star')];                    // approach run → phrase len 3
        const count = _tagStarPhrases(a, 'hard');
        return { phrases: count, tags: a.map(n => ({ t: n.time, ty: n.type, pid: n.phraseId == null ? null : n.phraseId, len: n.phraseLen == null ? null : n.phraseLen })) };
      },
      // V2-SAFETY PROOF (deterministic): buildNotes has NO Math.random, so rebuilding on the FIXED live `beats` (analyzeBeats
      // NOT re-run) with the flag OFF then ON yields note arrays that must be IDENTICAL in {time,lane,type} — the only
      // difference is the added phraseId/phraseLen. Reports the flag-on real-chart phrase count + the array-identity result.
      phraseV2Proof: (diff) => {
        const prevDiff = difficulty, hadFlag = STARPHRASE_ON();
        try {
          if (diff && DIFF_STEP[diff]) difficulty = diff;
          const proj = () => notes.map(n => (Math.round(n.time * 1e4) / 1e4) + '|' + n.lane + '|' + n.type);
          try { localStorage.setItem('rr_odphrase', '0'); } catch (e) {}
          buildNotes(); const off = proj(); const offPhrases = window.__rrChartStats.phrases; const offTagged = notes.filter(n => n.phraseId != null).length;
          try { localStorage.setItem('rr_odphrase', '1'); } catch (e) {}
          buildNotes(); const on = proj(); const onPhrases = window.__rrChartStats.phrases; const onTagged = notes.filter(n => n.phraseId != null).length;
          let firstDiff = -1; const identical = (off.length === on.length) && off.every((v, i) => { if (v === on[i]) return true; if (firstDiff < 0) firstDiff = i; return false; });
          const lens = {}; for (const n of notes) if (n.phraseId != null) lens[n.phraseId] = (lens[n.phraseId] || 0) + 1;
          const lenHist = {}; for (const k in lens) { lenHist[lens[k]] = (lenHist[lens[k]] || 0) + 1; }
          return { difficulty: difficulty, songSec: window.__rrChartStats.durationSec, count: { off: off.length, on: on.length }, arraysIdentical: identical, firstDiffIndex: firstDiff, offPhrases, offTagged, onPhrases, onTagged, phraseLenHistogram: lenHist };
        } finally {
          difficulty = prevDiff;
          try { localStorage.setItem('rr_odphrase', hadFlag ? '1' : '0'); } catch (e) {}
          try { buildNotes(); } catch (e) {}   // leave the live chart consistent with the restored flag
        }
      },
      // B2 ENCORE CHAIN dev hooks (strip at content-freeze): read the session-only chain + armed offer, and exercise
      // the REAL accept path (_onReplayClick) to prove the chain increments + the keep flag arms. encoreTest LAUNCHES a
      // real run as a side effect (the accepted track) — resetScoring then KEEPS the incremented chain.
      encore: () => ({ chain: _encoreChain, armed: _encoreArmed, accepting: _encoreAccepting, nextId: (_encoreNext && _encoreNext.id) || null, setlist: (function () { try { return localStorage.getItem('rr_setlist') === '1'; } catch (e) { return false; } })() }),
      encoreSetChain: (n) => { _encoreChain = Math.max(0, n | 0); return _encoreChain; },   // seed the chain to test the SETLIST-at-3 stamp without 3 real runs
      encoreTest: () => {
        var before = _encoreChain;
        var t = null; try { t = (window.RhythmCatalog && window.RhythmCatalog.encoreNextTrack) ? window.RhythmCatalog.encoreNextTrack(null) : null; } catch (e) {}
        if (!t) return { skipped: 'no curated next track available' };
        _encoreArmed = true; _encoreNext = t;
        _onReplayClick();   // the real handler: extend chain + set keep flag, then launchTrack(next)
        return { chainBefore: before, chainAfterAccept: _encoreChain, keepFlag: _encoreAccepting, armedConsumed: !_encoreArmed, nextConsumed: !_encoreNext, launchedId: t.id };
      },
      rail: () => {   // live state of the active rail (the migrating slot)
        for (let l = 0; l < LANE_COUNT; l++) {
          const hn = holdNote[l]; if (!hn || hn.type !== 'rail') continue;
          const seg = holdRailSeg[l] || 0, jt = songTime() - audioOffset, TW = RAIL_TW[difficulty] || 0.18;
          let nextIn = null, win = false, dest = null;
          if (seg >= 1 && seg < hn.rail.length) { const wt = hn.time + hn.rail[seg].t; nextIn = Math.round((wt - jt) * 1000) / 1000; win = (jt >= wt - 0.6 * TW && jt <= wt + TW); dest = hn.rail[seg].lane; }
          return { lane: l, seg: seg, nextTransferIn: nextIn, window: win, banked: Math.round(holdScored[l] * 1000) / 1000, destLane: dest, transfers: hn.rail.length - 1 };
        }
        return null;
      },
      holdGlides: () => notes.filter(n => (n.type === 'hold' || n.type === 'rail') && n._centroidPath && n._centroidPath.length >= 2).map(n => { const cp = n._centroidPath; return { t: Math.round(n.time * 100) / 100, type: n.type, hold: n.hold, sus: n._sustain, cpLen: cp.length, drift: Math.round((cp[cp.length - 1] - cp[0]) * 1000) / 1000, cp: cp }; }),   // SLIDE RAILS diag (strip at freeze): which sustains carry a centroid path + its drift
      railTest: (drift, minLen) => { _railTestDrift = (drift == null ? null : +drift); _railTestMinLen = (minLen == null ? null : +minLen); return { drift: _railTestDrift, minLen: _railTestMinLen }; },   // SLIDE RAILS dev lever (strip at freeze): relax the qualify thresholds so a low-glide test track emits rails
      railList: () => notes.filter(n => n.type === 'rail').map(n => ({ t: Math.round(n.time * 1000) / 1000, lane: n.lane, hold: n.hold, transfers: n.rail.length - 1, rail: n.rail.map(w => [Math.round(w.t * 1000) / 1000, w.lane]) })),   // SLIDE RAILS diag (strip at freeze)
      // SLIDE RAILS derivation test (strip at freeze): inject a CLEAN monotonic glide into the real onset stream and
      // rebuild through the REAL buildNotes() charter at SHIPPED thresholds — proves emission + clearance + audit +
      // geom on a genuine slide the ambient demo track lacks. dir<0 descends the strings, dir>0 climbs.
      railBuildTest: (dir) => {
        try {
          if (!beats || !beats.length) return 'no-beats';
          _railTestDrift = null; _railTestMinLen = null;   // use the shipped RAIL_DRIFT_MIN / RAIL_MIN_LEN
          dir = (dir < 0) ? -1 : 1;
          const tEnd = beats[beats.length - 1].t, t0 = Math.max(4, tEnd - 8);
          const cleaned = beats.filter(b => b.t < t0 - 0.15 || b.t > t0 + 5.5);
          const cp = dir < 0 ? [0.88, 0.78, 0.66, 0.54, 0.42, 0.30, 0.16] : [0.12, 0.26, 0.40, 0.52, 0.66, 0.78, 0.90];
          cleaned.push({ t: Math.round(t0 * 1000) / 1000, strength: 2.2, centroid: cp[0], hotBands: [], sustain: 2.6, energy: 1, centroidPath: cp.slice(), onGrid: true, downbeat: true });
          cleaned.sort((a, b) => a.t - b.t);
          cleaned._period = beats._period; cleaned._phase = beats._phase; cleaned._bpm = beats._bpm;
          beats = cleaned; buildNotes();
          const s = window.__rrChartStats, audit = window.__rrDebug.railAudit(), geom = window.__rrDebug.railGeom();
          return { rails: s.rails, railTransfers: s.railTransfers, railClamped: s.railClamped, meanRailLen: s.meanRailLen, notes: s.notes, holds: s.holds, violations: audit.violations, geomMaxPx: geom.rail ? geom.maxDeltaPx : null, geomWaypoints: geom.rail ? geom.waypoints : null, list: window.__rrDebug.railList() };
        } catch (e) { return 'ERR ' + e.message; }
      },
      // SLIDE RAILS transfer/judging test (strip at freeze): drives the PRODUCTION _railSustainStep/_railMigrate/
      // endHoldEarly deterministically (jt is a param → no clock dependence). Proves: made transfer migrates the slot +
      // keeps combo + awards ZERO score; missed transfer resolves through the EXISTING GRACE/SLIP/DROP bands.
      railTransferTest: () => {
        try {
          const TW = RAIL_TW[difficulty] || 0.18, wt = 100 + 0.9;   // first transfer at head+0.9
          const mkRail = () => ({ type: 'rail', time: 100, hold: 2.0, lane: 2, rail: [{ t: 0, lane: 2 }, { t: 0.9, lane: 1 }, { t: 1.8, lane: 0 }], judged: true, hit: 'perfect' });
          const clearSlots = () => { for (let l = 0; l < LANE_COUNT; l++) { holdNote[l] = null; holdScored[l] = 0; holdRailSeg[l] = 0; laneDown[l] = false; } };
          _mpStunUntil = 0; const out = {};
          // MADE: dest pressed inside window → migrate, combo intact, zero score from the transfer
          clearSlots(); let R = mkRail(); holdNote[2] = R; holdScored[2] = 0.5; holdRailSeg[2] = 1; laneDown[2] = true; laneDown[1] = true; combo = 10; { const s0 = score; const r = _railSustainStep(2, R, wt); out.made = { ret: r, migratedToDest: holdNote[1] === R, newSeg: holdRailSeg[1], oldCleared: holdNote[2] === null, bankedCarried: holdScored[1], comboIntact: combo === 10, transferScoreDelta: Math.round((score - s0) * 1000) / 1000 }; }
          // MISS→DROP: banked 0.30 (<0.45), window closed, dest not down → combo breaks
          clearSlots(); R = mkRail(); holdNote[2] = R; holdScored[2] = 0.30; holdRailSeg[2] = 1; laneDown[2] = true; combo = 10; { const r = _railSustainStep(2, R, wt + TW + 0.05); out.missDrop = { ret: r, comboAfter: combo, dropped: !!R.dropped, cleared: holdNote[2] === null }; }
          // MISS→SLIP: banked 0.55 (0.45..0.75) → NO combo break, beam dims
          clearSlots(); R = mkRail(); holdNote[2] = R; holdScored[2] = 0.55; holdRailSeg[2] = 1; laneDown[2] = true; combo = 10; { const r = _railSustainStep(2, R, wt + TW + 0.05); out.missSlip = { ret: r, comboAfter: combo, dropped: !!R.dropped }; }
          // MISS→GRACE: banked 0.80 (>=0.75) → clean, combo intact, remainder paid
          clearSlots(); R = mkRail(); holdNote[2] = R; holdScored[2] = 0.80; holdRailSeg[2] = 1; laneDown[2] = true; combo = 10; { const s0 = score; const r = _railSustainStep(2, R, wt + TW + 0.05); out.missGrace = { ret: r, comboAfter: combo, cleared: holdNote[2] === null, remainderPaid: (score - s0) > 0 }; }
          clearSlots();
          return out;
        } catch (e) { return 'ERR ' + e.message; }
      },
      // SLIDE RAILS render probe (strip at freeze): inject a rail into the LIVE notes + force render frames (approaching
      // then struck/retracting) so the ribbon + chevron draw path is exercised headlessly; returns any thrown error.
      railRenderProbe: () => {
        try {
          if (state !== 'playing' && state !== 'paused') return 'not-running';   // render() runs in both (loop() draws when paused too)
          const jt = songTime() - audioOffset;
          const R = { type: 'rail', time: jt + 1.0, hold: 2.0, lane: 2, rail: [{ t: 0, lane: 2 }, { t: 0.9, lane: 1 }, { t: 1.8, lane: 0 }], judged: false, hit: null, _pulsed: false, strength: 1.5, spin: 0 };
          notes.push(R); notes.sort((a, b) => a.time - b.time);
          let frames = 0, err = null;
          for (let i = 0; i < 6; i++) { try { loop(); frames++; } catch (e) { err = e.message; break; } }
          holdNote[2] = R; holdScored[2] = 0.3; holdRailSeg[2] = 1; R.judged = true; R.hit = 'perfect';   // now render it struck (retracting ribbon)
          for (let i = 0; i < 6 && !err; i++) { try { loop(); frames++; } catch (e) { err = e.message; break; } }
          R.dropped = true;   // and the resolving/dim path
          for (let i = 0; i < 4 && !err; i++) { try { loop(); frames++; } catch (e) { err = e.message; break; } }
          holdNote[2] = null; holdScored[2] = 0; holdRailSeg[2] = 0;
          return { frames: frames, err: err };
        } catch (e) { return 'ERR ' + e.message; }
      },
      railAudit: () => {   // scans notes → checks EVERY waypoint invariant (A1.2); MUST be 0 violations on all difficulties
        const rails = notes.filter(n => n.type === 'rail');
        const violations = [];
        for (let i = 1; i < notes.length; i++) { if (notes[i].time < notes[i - 1].time - 1e-9) { violations.push('unsorted@' + i); break; } }
        const LANE_SPAN = { easy: 3, medium: 6, hard: 6, rift: 6 };
        const span = Math.min(LANE_SPAN[difficulty] || LANE_COUNT, LANE_COUNT), laneBase = Math.floor((LANE_COUNT - span) / 2);
        const minSeg = RAIL_MIN_SEG[difficulty] || 0.45, maxX = RAIL_MAX_XFER[difficulty] || 1;
        const clear = (DIFFICULTY[difficulty].hitWindow || 0.16) + 0.03, XW = 0.35;
        for (const n of rails) {
          const r = n.rail, tag = '@' + n.time.toFixed(2);
          if (!r || r.length < 2) { violations.push('degenerate' + tag); continue; }
          if (r[0].t !== 0 || r[0].lane !== n.lane) violations.push('inv1-head' + tag);
          for (let k = 1; k < r.length; k++) if (!(r[k].t > r[k - 1].t)) violations.push('inv1-asc' + tag + ':' + k);
          if (!(r[r.length - 1].t < n.hold)) violations.push('inv1-lasttail' + tag);
          for (let k = 1; k < r.length; k++) if (Math.abs(r[k].lane - r[k - 1].lane) !== 1) violations.push('inv2-step' + tag + ':' + k);
          for (let k = 1; k < r.length; k++) if (r[k].t - r[k - 1].t < minSeg - 1e-6) violations.push('inv3-seg' + tag + ':' + k);
          if (n.hold - r[r.length - 1].t < minSeg - 1e-6) violations.push('inv3-tailseg' + tag);
          if (r.length - 1 > maxX) violations.push('inv4-maxX' + tag);
          for (const w of r) if (w.lane < laneBase || w.lane > laneBase + span - 1) violations.push('inv5-span' + tag + ':' + w.lane);
          const spans = [];
          for (let k = 0; k < r.length; k++) { const s0 = n.time + r[k].t, s1 = n.time + (k + 1 < r.length ? r[k + 1].t : n.hold); spans.push({ lane: r[k].lane, t0: s0 - clear, t1: s1 + clear }); }
          for (let k = 1; k < r.length; k++) { const wt = n.time + r[k].t; spans.push({ lane: r[k].lane, t0: wt - XW, t1: wt + XW }); }
          for (const m of notes) { if (m === n || m.type === 'bomb') continue; for (const s of spans) { if (m.lane === s.lane && m.time > s.t0 + 1e-6 && m.time < s.t1 - 1e-6) { violations.push('clr' + tag + ':L' + s.lane + '@' + m.time.toFixed(2)); break; } } }
        }
        return { rails: rails.length, violations: violations };
      },
      railGeom: () => {   // railX(w.lane,d) vs noteX(w.lane,d) at each waypoint (A3.1 must reduce exactly) — report max |Δ|px
        const fg = fretGeom(); const nX = fg.nearX, fX = fg.farX;
        const zFar = (ART.persp > 1) ? (perspOverride || ART.persp) : 0;
        const Pp = (zFar > 1) ? (d) => { const z = 1 + d * (zFar - 1); return (1 - 1 / z) / (1 - 1 / zFar); } : (d) => d;
        const warp = (warpOverride >= 0 ? warpOverride : (ART.warp || 0)), cxw = fg.gx + 0.5 * fg.gw;
        const wX = (warp > 0) ? (x, u) => cxw + (x - cxw) * (1 - warp * Math.max(0, u)) : (x) => x;
        const noteXp = (i, d) => { const u = Pp(d); return wX(nX[i] + (fX[i] - nX[i]) * u, u); };
        const railXp = (laneF, d) => { const i0 = Math.max(0, Math.min(LANE_COUNT - 2, Math.floor(laneF))), f = laneF - i0, u = Pp(d); const nx = nX[i0] + (nX[i0 + 1] - nX[i0]) * f, fx = fX[i0] + (fX[i0 + 1] - fX[i0]) * f; return wX(nx + (fx - nx) * u, u); };
        const rail = notes.find(n => n.type === 'rail'); if (!rail) return { rail: false };
        let maxD = 0;
        for (const w of rail.rail) for (const d of [0, 0.25, 0.5, 0.75, 1.0]) { const dd = Math.abs(railXp(w.lane, d) - noteXp(w.lane, d)); if (dd > maxD) maxD = dd; }
        return { rail: true, waypoints: rail.rail.length, maxDeltaPx: Math.round(maxD * 1e6) / 1e6, canvas: canvas.width + 'x' + canvas.height, head: { time: Math.round(rail.time * 1000) / 1000, lane: rail.lane, hold: rail.hold } };
      },
      endRun: () => { if (state === 'playing') { endGame(); return true; } return state; },
      // PRACTICE MODE dev hook (strip at content-freeze): confirm the section filter + speed + no-score gating headlessly.
      practiceState: () => ({
        enabled: _practiceOn,
        section: _practiceSection ? { start: +(+_practiceSection.start).toFixed(3), end: +(+_practiceSection.end).toFixed(3) } : null,
        speed: _practiceRate,
        chartedNotes: notes.length,
        currentTime: (state === 'playing') ? +songTime().toFixed(3) : null,
        isPractice: _practiceOn,   // the exact leaderboard/career exclusion flag stamped onto results
      }),
      lanes: () => ({ down: laneDown.slice(), pulse: lanePulse.map(v => +v.toFixed(2)), pluck: lanePluckT.map(v => +v.toFixed(2)) }),
      // FLIPBOOK FX dev hooks (stripped at content-freeze): inspect/emit/draw the additive layer
      fx: () => fx ? { loaded: true, sheets: Object.keys(fx.manifest || {}).length, imgs: Object.keys(fx.images || {}).length, active: (fx.active || []).length, theme: _fxTheme(), names: (fx.active || []).map(function (i) { return (i.meta && i.meta.src ? i.meta.src.split('/').pop() : '?') + (i.loop ? '*' : ''); }), pts: (fx.active || []).map(function (i) { return { n: (i.meta && i.meta.src ? i.meta.src.split('/').pop().replace('.png', '') : '?'), x: Math.round(i.x), y: Math.round(i.y), s: +(+i.scale).toFixed(2) }; }) } : { loaded: false },
      fxEmit: (type, lane, kind) => { emitFx(type || 'overdrive', kind || 'dev', lane == null ? 2 : lane); return fx ? (fx.active || []).length : -1; },
      fxWave: (lane, tier, century) => { emitComboWave(lane == null ? 2 : lane, tier == null ? 2 : tier, !!century); return fx ? (fx.active || []).length : -1; },
      fxPt: (lane, d) => { try { return _lanePtPx(fretGeom(), lane == null ? 2 : lane, d == null ? 0.5 : d); } catch (e) { return 'ERR ' + e.message; } },
      fxDraw: () => { if (fx) { fx.draw(ctx, performance.now()); return (fx.active || []).length; } return -1; },
      tick: () => { try { loop(); return true; } catch (e) { return 'ERR ' + e.message; } },   // manual frame for frozen-rAF headless testing
      hitBurst: (lane, kind) => { try { if (state !== 'playing') return 'not-playing'; spawnHitParticles(lane == null ? 2 : lane, kind || 'perfect'); return particles.length; } catch (e) { return 'ERR ' + e.message; } },   // build65: directly exercise the VFX-2.0 kit burst (headless verify; strip at freeze)
      pcount: () => particles.length,
      // SKIN geometry dev hook (stripped at content-freeze): inspect the live note-lane fractions so a
      // per-skin SKIN_GEOM entry can be fine-tuned until the lanes sit on the painted strings.
      geom: () => { try { return { nutXF: ART.nutXF.slice(), bridgeXF: ART.bridgeXF.slice(), aspect: +(+ART.aspect).toFixed(4), nutFY: ART.nutFY, bridgeFY: ART.bridgeFY, equipped: equippedSkinSrc || null, levelSkin: _levelSkinActive }; } catch (e) { return 'ERR ' + e.message; } },
      // ALIGNMENT dev hooks (stripped at content-freeze): screen-space lanes + the art draw rect
      lanesPx: () => { try { const g = fretGeom(); return { nearX: g.nearX.map(v => +v.toFixed(2)), nearY: +g.nearY.toFixed(2), lw: +g.lw.toFixed(2), farX: g.farX.map(v => +v.toFixed(2)), farY: +g.farY.toFixed(2) }; } catch (e) { return 'ERR ' + e.message; } },
      rect: () => { try { const r = guitarRect(); return { gx: +r.gx.toFixed(1), gy: +r.gy.toFixed(1), gw: +r.gw.toFixed(1), gh: +r.gh.toFixed(1), skinFit: _skinArtOn }; } catch (e) { return 'ERR ' + e.message; } },
      buildT: () => +_skinBuildT.toFixed(3),   // level-start materialize progress (dev; strip at freeze)
      // GAMEPLAY probes (dev; strip at freeze): the next strikeable note + live judgment counters,
      // so a timed in-page press can assert the input→judgment loop end-to-end.
      nextNote: () => { try { const j = songTime() - audioOffset; const n = notes.find(nn => !nn.judged && nn.type !== 'bomb' && nn.type !== 'hold' && nn.time > j + 0.05); if (!n) return null; const sim = notes.filter(x => !x.judged && x.type !== 'bomb' && Math.abs(x.time - n.time) < 0.012); return { lane: n.lane, time: +n.time.toFixed(3), inSec: +(n.time - j).toFixed(3), type: n.type, open: !!n.open, lanes: sim.map(x => x.lane), holdDur: Math.max(0, ...sim.map(x => x.type === 'hold' ? (x.hold || 0) : 0)) }; } catch (e) { return null; } },
      counts: () => ({ perfect: counts.perfect, great: counts.great, good: counts.good, miss: counts.miss, combo: combo, score: Math.floor(score) }),
      // GEM-TINT regression probe (dev; strip at freeze): the tinted marble canvas must keep the
      // sprite's alpha — corners ~0 (transparent), center opaque. Catches the "square marble" class.
      gemTint: (kind) => { try {
        if (!levelGemHex) return { tint: null };
        const cv2 = _gemTintFor(kind === 'star' ? 'star' : 'normal');
        if (!cv2) return { tint: levelGemHex, canvas: false };
        const g2 = cv2.getContext('2d'); const W2 = cv2.width, H2 = cv2.height;
        const pa = (px, py) => g2.getImageData(px, py, 1, 1).data[3];
        return { tint: levelGemHex, size: W2 + 'x' + H2,
          corners: [pa(2, 2), pa(W2 - 3, 2), pa(2, H2 - 3), pa(W2 - 3, H2 - 3)],
          center: pa(W2 >> 1, H2 >> 1) };
      } catch (e) { return 'ERR ' + e.message; } },
      // RESULTS celebration dev hooks (stripped at content-freeze)
      celebrate: () => { celebrateResults(96, 'S'); return true; },
      celebrateState: () => ({ ui: !!fxUi, canvas: !!_celCanvas, live: fxUi ? (fxUi.active || []).length : -1 }),
      celebrateDraw: () => { if (fxUi && _celCanvas) { const c2 = _celCanvas.getContext('2d'); return fxUi.draw(c2, performance.now()); } return -1; }
    };
  } catch (e) {}
  // while the test panel is open, poll gamepads (gameplay polls in its own loop)
  let probeRaf = 0;
  function startProbePoll() { if (probeRaf) return; try { _seedPadPrev(); } catch (e) {}   // build100q: seed current button states so a held/stuck button can't phantom-bind on the first frame
    const tick = () => { if (!laneProbe && padRebindLane == null) { probeRaf = 0; return; } pollGamepad(); if (_wizActive) { try { _wizRender(); } catch (e) {} }   // build100q: live-refresh the wizard's "controller detected" sub-text the instant the pad wakes (Xbox pads stay hidden until pressed)
      probeRaf = requestAnimationFrame(tick); }; probeRaf = requestAnimationFrame(tick); }
  function stopProbePoll() { if (probeRaf) cancelAnimationFrame(probeRaf); probeRaf = 0; }

  // ---------- TOUCH INPUT (tap-zones + mobile pause) ----------
  // Each lane is its own button so simultaneous multi-finger taps fire
  // independent touchstart events (chords work).
  document.querySelectorAll('#tap-zones .tap-zone').forEach(zone => {
    const lane = parseInt(zone.dataset.lane, 10);
    const press = (e) => {
      e.preventDefault();
      if (state === 'playing') laneDown[lane] = true;   // hold-to-sustain
      onLaneInput(lane, 'touch', e.timeStamp);
      if (state === 'playing') zone.classList.add('lit');
      // SLIDE RAILS: if this press struck a rail head, remember the pointer so a DRAG across strings can migrate it.
      if (state === 'playing' && holdNote[lane] && holdNote[lane].type === 'rail') { _railTouchId = e.pointerId; _railTouchLanes = null; }
    };
    const release = (e) => {
      onLaneRelease(lane); zone.classList.remove('lit');
      // SLIDE RAILS: lifting the rail-drag pointer clears every lane the drag synthesized down.
      if (e && _railTouchId != null && e.pointerId === _railTouchId) { _railTouchId = null; if (_railTouchLanes) { _railTouchLanes.forEach(l => { laneDown[l] = false; }); _railTouchLanes = null; } }
    };
    // SLIDE RAILS: while the SAME pointer that struck the rail head is down, map its x → lane and synthesize a press on
    // the entered string so the sustain loop can migrate (the window is the only judge; a wrong-lane wander does nothing).
    const railDrag = (e) => {
      if (_railTouchId == null || e.pointerId !== _railTouchId || state !== 'playing') return;
      let best = -1, bestDx = Infinity;
      try { const g = fretGeom(); const r = canvas.getBoundingClientRect(); const px = (e.clientX - r.left) * (canvas.width / r.width);
        for (let l = 0; l < LANE_COUNT; l++) { const dx = Math.abs(px - g.nearX[l]); if (dx < bestDx) { bestDx = dx; best = l; } } } catch (err) { return; }
      if (best < 0) return;
      if (!_railTouchLanes) _railTouchLanes = new Set();
      if (!laneDown[best]) { laneDown[best] = true; _railTouchLanes.add(best); }
    };
    // unified Pointer Events: one path for touch, mouse, AND pen — fires on press,
    // no touch/mouse double-fire, multi-finger chords work (one pointer per zone).
    zone.addEventListener('pointerdown', press, { passive: false });
    zone.addEventListener('pointermove', railDrag, { passive: true });
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
    // build65 (cycle-3): pointerleave REMOVED — a finger drifting off a small lane button mid-sustain is NOT a lift, and
    // touch pointers have implicit capture so pointerup still fires on this zone. The leave-release was dropping holds on
    // thumb drift (worst on the narrow portrait lanes). pointerup + pointercancel still end the press on a real lift.
  });

  const odFlame = $('od-flame');
  // build109 s3: OVERDRIVE ACTIVATION WIND-UP — activateOverdrive() used to fire shake/burst/comets/
  // flash/SFX all on the same synchronous tick, no anticipation beat. It's now a short pre-charge
  // (ODIGNITE_MS): during the window the existing OD-READY chrome-pulse rings (_readyRings, already
  // rendered whenever overdrive>=1 && !odActive) ramp sharply in alpha/scale + a rising pitch stinger
  // plays; the payoff below fires exactly as before once the window elapses. Self-contained state-machine
  // addition — doesn't touch the payoff code that already worked. Reduce-motion/fxLite: the ramp read is
  // driven by the same _readyRings the ready-cue already shows under those gates (a scale/alpha tween on
  // an existing element, not new motion), so it's left ungated like the ring cue it rides; the SFX has its
  // own `muted` guard as always.
  function activateOverdrive() {
    if (state !== 'playing' || overdrive < 1 || odActive || odIgniteT > 0) return;
    odIgniteT = ODIGNITE_MS / 1000;
    try { playOdIgniteSfx(); } catch (e) {}
  }
  function _fireOverdrivePayoff() {
    odActive = true; odTimer = OD_DURATION; overdrive = 1;
    _odScoreAtFire = Math.round(score); _odHitsAtFire = counts.perfect + counts.great + counts.good;   // Wave-3 finding 2: snapshot for the end-tally (derived read; touches no score)
    const _oc = odOvercharge; odOvercharge = 0;   // Wave-3 finding 3: spend the cosmetic reservoir on THIS activation's spectacle, then clear it (never affects duration/multiplier)
    scanT = scanDur = 0.62 + _oc * 0.25; scanTier = 3;   // big activation scan sweep up the whole guitar (overcharge widens the sweep — presentation only)
    try {
      const _g = fretGeom();
      for (let _i = 0; _i < LANE_COUNT; _i++) emitFx('overdrive', 'od', _i, _g.nearX[_i], _g.nearY - _g.lw * 0.30);
      // build13: star power LAUNCHES — comets race up every string as it ignites (overcharge = extra comet waves, spectacle only)
      if (!fxLite && !reduceMotion) { const _k = (_g.lw / 128) * FX_GLOBAL; const _extra = Math.round(_oc * 3); for (let _r = 0; _r <= _extra; _r++) for (let _i = 0; _i < LANE_COUNT; _i++) emitStringSurge(_i, 'note-comet', 60 + _i * 24 + _r * 40, _k, _g); }
    } catch (e) {}
    // build20 (the user circled it twice — "that flame effect doesn't fit"): the sustained
    // overdrive-aura loop sat as a SPINNING FIREBALL at the center of the catcher row for the
    // whole OD — a causeless centered blob, the exact doctrine violation. REMOVED. Star power
    // is carried by the activation comets, the burning strings/wash, the catcher fire at high
    // mult, the HUD flame, and note-comet trails — all anchored to play elements.
    try { if (_odAura) { _odAura.stop(); _odAura = null; } } catch (e) {}
    bgPulse = 1; odBurst = 1; cameraShake = 10;   // odBurst → screen-flooding ignition flash + shockwave (render)
    _armJudgePriority(550);   // build60: OVERDRIVE ignition is the biggest moment — protect its callout
    flashJudgment('OVERDRIVE', '#ffd98a');
    _scorePop(true);   // build51: big gold score punch when Overdrive engages
    if (odFlame) odFlame.classList.add('active');
    // build8: tell a level its big moment landed (Skully kicks the intense backdrop). No-op when unset.
    try { if (window.RhythmLevelFx && window.RhythmLevelFx.onCombo) window.RhythmLevelFx.onCombo(combo, true); } catch (e) {}
    playOverdriveHitSfx();   // build157: real Star-Power slam sample (falls back to the procedural riser if unloaded)
    if (navigator.vibrate) { try { navigator.vibrate([20, 30, 40]); } catch (e) {} }
    updateHUD();
  }
  // Wave-3 finding 2 (render/stats ONLY — adds ZERO score): the just-ended OD window banked `score - _odScoreAtFire`,
  // every point of it already paid by an existing `score +=` site DURING the window. This DIFFS that already-paid
  // total and flashes it, and books the results stats. Called at BOTH OD-end sites (natural drain-out + Flow-Shield burn-out).
  function _odTally() {
    const g = Math.max(0, Math.round(score) - _odScoreAtFire);
    _odLastGain = g; _odTotalGain += g; if (g > _odBestGain) _odBestGain = g;
    _odNotesTotal += Math.max(0, (counts.perfect + counts.great + counts.good) - _odHitsAtFire);
    try { if (g > 0) { _armJudgePriority(480); flashJudgment('OVERDRIVE +' + g.toLocaleString(), '#ffd98a'); } } catch (e) {}
  }
  if (odFlame) {
    odFlame.addEventListener('click', (e) => { e.preventDefault(); activateOverdrive(); });
  }

  const mpauseBtn = $('mpause');
  if (mpauseBtn) {
    mpauseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (calibActive) {
      if (e.code === 'Space') { e.preventDefault(); calibTap(); }
      else if (e.key === 'Escape') { closeCalib(); }
      return;
    }
    const k = e.key.toLowerCase();
    // Settings "Test Input": a bound lane key lights its pip regardless of state
    if (laneProbe && (k in keyMap) && !e.repeat) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      e.preventDefault(); laneProbe(keyMap[k], 'key'); return;
    }
    if (state === 'menu') {
      // build10b (beta-test find): the menu-state Enter shortcut belongs to the LIBRARY only — it
      // used to fire on the HUB too (Enter there silently launched whatever song the library had
      // focused, underneath the hub). Now it requires #menu to be the ACTIVE screen, which also
      // excludes the title screen and the RYO intro.
      if (e.key === 'Enter') {
        try { const lib = $('menu'); if (!lib || !lib.classList.contains('active')) return; } catch (e2) {}
        e.preventDefault(); $('play-btn').click();
      }
      return;
    }
    // results screen: keyboard flow so you can chain runs without the mouse
    if (state === 'results') {
      // build65 FIX: a Career/Leaderboard/Settings/How-To overlay can open ON TOP of results WITHOUT changing `state`
      // (it just adds .active) — don't let Enter (replay) / Escape fall through to the results buttons underneath it.
      if (document.querySelector('#profile-screen.active, #leaderboard-screen.active, #settings-screen.active, #howto-screen.active')) return;
      if (e.key === 'Enter') { e.preventDefault(); const b = $('results-replay'); if (b) b.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); const b = $('results-menu'); if (b) b.click(); }
      return;
    }
    if (state === 'playing' || state === 'paused') {
      if (e.key === 'Escape') { if (state === 'playing') pauseGame(); else resumeGame(); return; }
      // Space = activate Overdrive / Star Power (when charged). Restart lives in the pause menu now
      // (Space-to-restart was an accidental run-killer mid-song).
      // Space = Overdrive — UNLESS the player has rebound Space to a lane (then fall through to the lane hit below). build58
      if (e.code === 'Space' && !(' ' in keyMap)) { e.preventDefault(); if (!e.repeat && state === 'playing') activateOverdrive(); return; }
    }
    if (state !== 'playing') return;
    // ignore OS key-repeat: only the first press judges; the key staying down drives the sustain
    if (k in keyMap) { e.preventDefault(); if (!e.repeat) { laneDown[keyMap[k]] = true; onLaneInput(keyMap[k], 'key', e.timeStamp); } }
  });

  // key release ends an active sustain in that lane
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in keyMap) onLaneRelease(keyMap[k]);
  });
  // build102u (Phase-2 review MAJOR): a LIVE SHOW performer alt-tabbing must NOT freeze the show — every watcher's
  // clock is wall-time-locked to the shared atMs, so an auto-pause permanently desyncs their decks/audio. The MP
  // layer flips this ON around a show run only (beginMatch/teardownMatch); solo + normal MP keep auto-pause as-is.
  let _autoPauseSuppressed = false;
  window.RhythmGame.setAutoPauseSuppressed = function (on) { _autoPauseSuppressed = !!on; };
  // safety: if the window loses focus mid-hold, a keyup may never arrive — release all
  window.addEventListener('blur', () => { for (let i = 0; i < LANE_COUNT; i++) onLaneRelease(i); if (state === 'playing' && !_autoPauseSuppressed) { try { pauseGame(); } catch (e) {} } });
  // build35 (audit): some embedded / WebView Chromium builds don't emit window 'blur' on tab-switch or
  // minimize — mirror the release+auto-pause on document visibilitychange so a backgrounded song never
  // keeps playing. (Same older-engine reality that the :has → :not fix addressed.)
  document.addEventListener('visibilitychange', () => { if (document.hidden) { for (let i = 0; i < LANE_COUNT; i++) onLaneRelease(i); if (state === 'playing' && !_autoPauseSuppressed) { try { pauseGame(); } catch (e) {} } } });

  // ---------- MIDI + GAMEPAD INPUT (desktop instruments & controllers) ----------
  // One responsive codebase: phones use touch tap-zones; desktop adds keyboard,
  // MIDI devices (keyboards / MIDI guitars / e-drums), and USB game controllers.
  function laneFromMidi(note) { return ((note % LANE_COUNT) + LANE_COUNT) % LANE_COUNT; }
  let midiInputs = [];                                 // connected device names (for Settings)
  function initMidi() {
    if (!navigator.requestMIDIAccess) return;          // Chrome/Edge desktop only
    navigator.requestMIDIAccess().then((access) => {
      const refresh = () => { midiInputs = []; access.inputs.forEach(i => midiInputs.push(i.name || 'MIDI device')); };
      const bind = (input) => { input.onmidimessage = (msg) => {
        const d = msg.data || []; const cmd = d[0] & 0xf0, vel = d[2] || 0;
        // msg.timeStamp is DOMHighResTimeStamp (same clock as performance.now) — feed the real lag.
        if (cmd === 0x90 && vel > 0) onLaneInput(laneFromMidi(d[1]), 'midi', (msg.timeStamp || performance.now()));
      }; };
      access.inputs.forEach(bind); refresh();
      access.onstatechange = (e) => { if (e.port && e.port.type === 'input' && e.port.state === 'connected') bind(e.port); refresh(); };
      window.__midiReady = true;
    }).catch(() => {});
  }
  initMidi();

  // gamepad (DualSense / Xbox / Guitar-Hero controllers): edge-detected button → MAPPED lane.
  // Buttons route through the remappable padMap (configurable in Settings), and presses now drive
  // laneDown/onLaneRelease too, so a controller can hold sustain notes (it couldn't before).
  const _padPrev = {};
  let padRebindLane = null;            // lane awaiting a controller-button assignment (Settings remap)
  // ---- GH require-strum core ---------------------------------------------------------------
  // Only a DETECTED guitar on the 5-lane gh profile must fret + STRUM to score (authentic GH).
  // Keyboard + standard gamepads are byte-identical — everything below gates on requireStrum().
  // build100q: a guitar Chrome reports as a generic XInput pad (NO "guitar" token — common for the recommended PDP
  // Riffmaster) still has the tell of a POV-hat instrument: >=10 axes. Match the same heuristic the gamepadconnected
  // auto-adopt (~6288) and pollGuitarAxes (~3056) already use, so strum reliably engages instead of silently never firing.
  function guitarShapedPad() { try { for (const gp of (navigator.getGamepads ? navigator.getGamepads() : [])) if (gp && (isGuitarPad(gp.id) || ((gp.axes || []).length >= 10))) return true; } catch (e) {} return false; }
  // build100q: HIT MODE override. Default = strum (authentic GH, owner decree). But if a player's strum bar can't be
  // detected by the driver (POV-hat quirks), require-strum leaves them holding frets that never fire → every note misses.
  // The Settings "Hit mode" toggle flips this to PRESS-to-hit so a GH controller is always playable. Persisted.
  let _strumRequired = true; try { _strumRequired = localStorage.getItem('rr_strum_off') !== '1'; } catch (e) {}
  // build102u (owner playtest): DROP the guitarShapedPad() gate from requireStrum — many real GH controllers
  // (wireless receivers/clones) enumerate as a plain "Xbox 360 Controller (XInput)" with 4 standard axes, so the
  // shape check silently disabled strum mode even with HIT MODE=Strum set: a fret press alone scored, which is
  // exactly what the owner reported. The player declares a guitar TWICE (applies the GH preset → laneProfile 'gh',
  // AND leaves HIT MODE on Strum) — trust that over the pad's self-reported identity. anyPadConnected() keeps the
  // keyboard decree intact (keyboard = fret-press, always). Note: pollGuitarAxes now also runs for standard-shaped
  // pads in this mode — its axis-9 hat fallback stays internally guarded on ax.length>=10, and whammy/tilt defaults
  // reading a right-stick are acceptable (the player opted into the guitar profile; Press-to-hit is one tap away).
  function anyPadConnected() { try { for (const gp of (navigator.getGamepads ? navigator.getGamepads() : [])) if (gp) return true; } catch (e) {} return false; }
  function requireStrum() { return _strumRequired && laneProfile === 'gh' && anyPadConnected(); }
  window.RhythmGame.getStrumRequired = function () { return _strumRequired; };
  // build102v: dispatch 'rr-strummode' so UI (the Settings HIT MODE seg, device status) re-syncs no matter WHO flips
  // it — the seg's old sync only fired on settings-screen open, so a wizard/preset flip mid-session showed stale state.
  window.RhythmGame.setStrumRequired = function (on) { _strumRequired = !!on; try { localStorage.setItem('rr_strum_off', on ? '0' : '1'); } catch (e) {} try { _frets.clear(); } catch (e2) {} try { window.dispatchEvent(new CustomEvent('rr-strummode', { detail: { on: _strumRequired } })); } catch (e3) {} try { renderDeviceStatus(); } catch (e4) {} return _strumRequired; };
  // build102w: STRUM FEEL PACK (owner hardware playtest: "really had to push hard on the strum", holds "weird and
  // tiring"). Everything here gates on requireStrum() — keyboard and press-mode stay byte-identical.
  let _strumBufT = 0, _strumBufMs = 70;   // STRUM BUFFER: a strum landing a hair BEFORE the fret press is banked for _strumBufMs; the fret press consumes it (classic GH order forgiveness). Single-shot.
  function tryStrum(now) {
    if (now - _lastStrumT < STRUM_DEBOUNCE_MS) return;     // debounce: strum-up + strum-down both land here
    _lastStrumT = now;
    if (_frets.size === 0) { _strumBufT = now; return; }   // build102w: no fret YET — bank this strum (was a hard no-op, so strum-then-fret ate the stroke and players compensated by slamming the bar)
    let _fired = false;
    for (const lane of _frets) {
      // build102w: a lane mid-SUSTAIN is INERT to strum edges — the old path fired onLaneInput for EVERY held fret,
      // so strumming other lanes while banking a hold re-judged the sustaining lane: early-ate its next note (or a
      // BOMB → combo break), REPLACED the live sustain if that note was another hold (payout silently abandoned),
      // or whiff-flashed/plucked it on every stroke. That spam was the "weird and tiring" hold feel.
      if (holdNote[lane]) continue;
      _fired = true;
      onLaneInput(lane, 'guitar', now);   // chord-safe: one hit per held fret, judged at the strum instant
    }
    // v405 review fix: a stroke that FIRED spends any banked stroke (one strum never pays twice). But a stroke where
    // every held fret was hold-inert used to be swallowed AND un-banked — so strum-then-fret-B while sustaining lane A
    // still ate the stroke (the exact holds complaint build102w targeted). No live lane fired → treat it like an
    // empty strum and BANK it; the fret press ≤ _strumBufMs later consumes it (single-shot, zeroed there).
    _strumBufT = _fired ? 0 : now;
  }
  function pollGuitarAxes(gp, liteAxes) {
    const ax = gp.axes || [];
    // strum: a STANDARD-mapped guitar fires strum on the D-pad buttons 12/13 (handled in pollGamepad). But most
    // instrument controllers (incl. the Riffmaster under many drivers) get a NON-standard mapping, where the D-pad
    // collapses into a POV HAT on axis 9 and buttons 12/13 never fire — so strum would do nothing. build99h fix #1:
    // when the user hasn't configured a strumAxis and the pad is non-standard with a hat, auto-use axis 9. A sign-flip
    // in the configured dir = a strum edge. (The Settings wizard's strum sampler still overrides this precisely.)
    let sAxis = strumCfg.strumAxis;
    let sRest = (typeof strumCfg.strumRest === 'number') ? strumCfg.strumRest : 0;
    // build99R/build100r (controller P0-1): the POV-hat strum fallback was gated on gp.mapping !== 'standard'. On
    // Windows/Chrome the Riffmaster often enumerates as a "standard" XInput pad even though its strum is a hat on axis 9
    // — so strum died out of the box (the single biggest plug-and-play risk). Drop the mapping gate; the ax.length >= 10
    // guard already excludes normal gamepads (4 axes), so only guitar-shaped pads ever read axis 9.
    if (sAxis == null && ax.length >= 10) { sAxis = 9; sRest = 0; }   // last-ditch default; the in-Settings "Test strum" learns the real one
    if (sAxis != null && ax.length > sAxis) {
      const v = ax[sAxis] || 0;
      // build100r: DEVIATION-FROM-REST detection — robust to POV hats whose unpressed value is a driver-specific
      // NON-zero (e.g. 3.28), where the old sign-flip heuristic silently failed (this was the reported all-miss-on-strum
      // bug). A strum = the axis leaving its learned rest (rising edge of |v-rest| crossing 0.5) → one hit per stroke,
      // no double-fire on the return-to-rest. PLUS, for a clean bipolar analog strum (rest 0) where back-to-back
      // down/up strokes never settle at 0, a zero-crossing past 0.5 is still a fresh stroke.
      const dev = Math.abs(v - sRest), prevDev = Math.abs(_strumAxisPrev - sRest);
      if (dev > 0.5 && prevDev <= 0.5) tryStrum(performance.now());
      else if (sRest === 0 && Math.abs(v) > 0.5 && Math.abs(_strumAxisPrev) > 0.5 && Math.sign(v) !== Math.sign(_strumAxisPrev) && (!strumCfg.strumAxisDir || Math.sign(v) === strumCfg.strumAxisDir)) tryStrum(performance.now());
      _strumAxisPrev = v;
    }
    // whammy -> Overdrive charge: wiggling the whammy (while OD not active) builds the meter; clamp at 1
    // v405 review fix: the whammy charge is a per-sample DELTA gate (|w − prev| > 0.03), so its behavior depends on
    // the sampling rate — the build102w ~4ms fast poll shrank per-sample deltas ~4-8x, which made a casual wiggle
    // charge NOTHING (delta never crossed 0.03) and a fast wiggle charge ~4x + spam updateHUD at 250Hz. The fast-poll
    // path passes liteAxes=true and SKIPS this block (doesn't touch _whammyPrev), so whammy keeps its rAF-rate deltas.
    // Strum + tilt below are threshold-CROSSING edges — rate-robust, and fast sampling only improves their latency.
    if (!liteAxes && strumCfg.whammyAxis != null && ax.length > strumCfg.whammyAxis) {
      const raw = ax[strumCfg.whammyAxis] || 0;
      const span = (strumCfg.whammyMax - strumCfg.whammyMin) || 1;
      const w = Math.max(0, Math.min(1, (raw - strumCfg.whammyMin) / span));
      if (!odActive && w > 0.5 && Math.abs(w - _whammyPrev) > 0.03) { overdrive = Math.min(1, overdrive + 0.012); try { updateHUD(); } catch (e) {} }
      _whammyPrev = w;
    }
    // tilt -> Star Power activate (axis crosses the threshold upward) — Select button is the fallback (handled in the button loop)
    if (strumCfg.tiltAxis != null && ax.length > strumCfg.tiltAxis) {
      const tv = Math.abs(ax[strumCfg.tiltAxis] || 0);
      if (tv > strumCfg.tiltThresh && _tiltPrev <= strumCfg.tiltThresh) activateOverdrive();
      _tiltPrev = tv;
    }
  }
  // build100q+: the analog-partial reject is for WIZARD CAPTURE ONLY (an Xbox trigger floating near rest must not
  // auto-bind a lane). It must NEVER gate GAMEPLAY — some GH/clone drivers report a fret or the strum bar at an
  // intermediate value, and rejecting those broke the BLUE fret + STRUM for a real player. Gameplay uses raw .pressed.
  function _isPartialAnalog(btn) { return typeof btn.value === 'number' && btn.value > 0 && btn.value < 0.55; }
  // Seed _padPrev for every connected pad's CURRENT (raw) state — call when the wizard/probe arms so a button already
  // held (or a trigger stuck pressed at rest) is recorded as "was" and cannot register a phantom rising edge on frame 1.
  function _seedPadPrev() { try { for (const gp of (navigator.getGamepads ? navigator.getGamepads() : [])) { if (!gp) continue; for (let b = 0; b < gp.buttons.length; b++) _padPrev[gp.index + ':' + b] = gp.buttons[b].pressed; } } catch (e) {} }
  let _lastWizBindMs = 0;
  function _anyPadBtnDown() { try { for (const gp of (navigator.getGamepads ? navigator.getGamepads() : [])) { if (!gp) continue; for (let b = 0; b < gp.buttons.length; b++) if (gp.buttons[b].pressed) return true; } } catch (e) {} return false; }
  // build138: LOCAL COUCH input split — when a P2 shadow engine is live (couch versus ONLY; online MP never
  // spawns _p2), P1 must NOT consume P2's controller. pollGamepad iterated EVERY connected pad into P1, so a 2nd
  // controller drove P1's highway too (owner playtest: "keyboard AND controller both hit the RIGHT deck, LEFT deck
  // inert"). P2 owns exactly one gamepad index (createEngine's gpIndex, exposed on the api); P1 skips that pad here
  // so it plays only the keyboard + every OTHER pad (index 0 in the standard 2-controller setup). Returns -1 when no
  // couch match is live → single-player + online MP poll every pad, byte-identical.
  function _couchP2PadIndex() { return (_p2 && _p2._p2state && _p2._p2state.alive && typeof _p2.gamepadIndex === 'number') ? _p2.gamepadIndex : -1; }
  function pollGamepad(liteAxes) {
    if ((state !== 'playing' && !laneProbe && padRebindLane == null) || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const _p2Pad = _couchP2PadIndex();   // build138: P2's claimed controller (or -1 when not in couch versus) — P1 skips it
    // build100q FIX: RELEASE GATE — after a wizard fret binds, the next fret can't capture until EVERY button is
    // released. This kills the "press blue → it auto-jumps to the next step" bug: a fret still held (or a noisy
    // GH/clone button/strum reporting pressed) used to fire a fresh edge that auto-bound the next lane.
    if (_wizActive && _wizNeedRelease && !_anyPadBtnDown()) _wizNeedRelease = false;
    for (const gp of pads) {
      if (!gp) continue;
      if (_p2Pad >= 0 && gp.index === _p2Pad) continue;   // build138: this pad belongs to P2 in couch versus — never route it into P1

      for (let b = 0; b < gp.buttons.length; b++) {
        const pressed = gp.buttons[b].pressed; const key = gp.index + ':' + b; const was = _padPrev[key];   // RAW press → a real fret/strum always registers in gameplay
        _padPrev[key] = pressed;
        if (pressed && !was) {
          if (padRebindLane != null) {
            if (_wizActive && _wizNeedRelease) continue;   // build100q: wait for a clean release before capturing the next fret
            // build100q: CAPTURE-ONLY guard — reject a partial-analog press (resting Xbox trigger) from auto-binding.
            if (_isPartialAnalog(gp.buttons[b])) continue;
            // build100q: debounce binds so chatter / a bouncing analog button can't chew through multiple wizard lanes
            // from one physical press. A second edge within 280ms is ignored (the lane stays armed for the right press).
            if (_wizActive && performance.now() - _lastWizBindMs < 280) continue;
            _lastWizBindMs = performance.now();
            const ln = padRebindLane; padRebindLane = null;
            if (_padRebindOD) { _padRebindOD = false; _bindOdButton(b); }          // build100q: armed the Overdrive cap → set the OD/Star-Power button
            else { bindLaneButton(ln, b, _padRebindAdd); _padRebindAdd = false; }   // build100q: ADD mode keeps the string's existing button(s)
            continue;
          }
          const lane = padMap[b];
          if (lane != null && lane >= 0 && lane < LANE_COUNT) {
            if (requireStrum()) {
              _frets.add(lane); if (state === 'playing') laneDown[lane] = true;   // GH: fret HELD, no hit until a strum
              // build102w: STRUM BUFFER consume — a strum fired ≤ _strumBufMs ago with no fret down; THIS fret press
              // completes the pair → hit now (judged at the fret instant). Zeroed on consume (single-shot) so the same
              // stroke can't also pay a later fret; a real follow-up strum is a NEW stroke and fires normally (the
              // note is judged by then, and guitar-source empties are inert — no double anything).
              const _bnw = performance.now();
              // SLIDE RAILS: on the rail BODY, a fret change ALONE migrates the transfer (native hammer-on/pull-off) —
              // laneDown is now set, so the sustain loop migrates; bypass the strum buffer so it can't fire a phantom hit.
              const _railXfer = (state === 'playing') && _activeRailForDest(lane, songTime() - audioOffset) >= 0;
              if (!_railXfer && _strumBufT && (_bnw - _strumBufT) <= _strumBufMs && !holdNote[lane]) { _strumBufT = 0; onLaneInput(lane, 'guitar', _bnw); }
            }
            else { if (state === 'playing') laneDown[lane] = true; onLaneInput(lane, 'gamepad', performance.now()); }   // legacy: fret-press = hit (keyboard/standard pad)
          }
          // build100q: fire the strum on the configured button(s) OR the standard D-pad up/down (12/13) — the calibration
          // can mis-capture a fret as the strum button, and most GH strum bars enumerate as the D-pad. Belt-and-suspenders
          // alongside the POV-hat axis strum in pollGuitarAxes; tryStrum self-debounces so a double-trigger is harmless.
          if (requireStrum() && (strumCfg.btns.indexOf(b) >= 0 || b === 12 || b === 13)) tryStrum(performance.now());   // strum bar -> fire the held frets
          if (requireStrum() && b === strumCfg.spBtn) activateOverdrive();                    // Select (tilt fallback) -> Star Power
          // build100q: STANDARD (non-guitar) pad — Overdrive on the configured odBtn (default RB=5). A controller-only
          // player had NO way to fire Overdrive before (the only pad OD path was requireStrum-gated → guitars only).
          // Skip if that button is also a lane (the lane wins). activateOverdrive() self-guards on state/od.
          // build102v: + spBtn — the profile is pinned 'gh', so the wizard's STAR POWER step and the manual OD cap both
          // write strumCfg.spBtn now; a PRESS-mode pad player's captured OD button must fire too (odBtn stays the RB=5
          // seed / legacy stores). Same padMap[b]==null lane-wins guard.
          if (!requireStrum() && ((strumCfg.odBtn != null && b === strumCfg.odBtn) || (strumCfg.spBtn != null && b === strumCfg.spBtn)) && padMap[b] == null && state === 'playing') activateOverdrive();
          // build100q: PAUSE/BACK on the Start button (9) for BOTH profiles — a controller-only player couldn't pause
          // from the pad (only mouse #mpause / Escape / blur did). Skip if 9 is mapped to a lane.
          if (b === 9 && padMap[b] == null && (state === 'playing' || state === 'paused')) { try { if (state === 'playing') pauseGame(); else resumeGame(); } catch (e) {} }
        } else if (!pressed && was) {
          const lane = padMap[b];
          if (lane != null && lane >= 0 && lane < LANE_COUNT) { if (requireStrum()) _frets.delete(lane); onLaneRelease(lane); }
        }
      }
      if (requireStrum()) pollGuitarAxes(gp, liteAxes);   // strum-axis / whammy->OD / tilt->SP (guitars only; liteAxes skips the rate-sensitive whammy block on fast-poll calls)
    }
  }
  // build102w: LOW-LATENCY INPUT POLL — pollGamepad rode the rAF loop only (16-33ms worst case; worse on a 30fps
  // machine), and that queue delay reads as "the strum needs a hard push". While a run is live with ANY pad
  // connected, a dedicated ~4ms interval polls too. Edge detection (_padPrev) is stateful + synchronous, so extra
  // calls are safe — the rAF frame-top call stays and whoever runs first simply wins the edge. The interval
  // self-disarms the moment the run ends / pauses or the pad unplugs; loop() re-arms it next playing frame. One
  // interval max (_fastPollId guard). build104 s3: gate widened from requireStrum() to anyPadConnected() — a
  // PRESS-mode controller/guitar player was still stuck on rAF cadence (16-33ms of avoidable input latency);
  // the shared _padPrev edge map means the fast poll + frame-top poll can never double-fire one press.
  let _fastPollId = 0, _strumPollMs = 4;
  function _ensureFastPoll() {
    if (_fastPollId) return;
    _fastPollId = setInterval(() => {
      if (state !== 'playing' || !anyPadConnected()) { clearInterval(_fastPollId); _fastPollId = 0; return; }
      try { pollGamepad(true); } catch (e) {}   // liteAxes: buttons + strum/tilt edges only — whammy stays rAF-sampled (delta-gated, rate-sensitive)
    }, _strumPollMs);
  }
  // dev hook (strip at content-freeze): live strum-feel dials for the owner's hardware pass —
  // __rrStrumFeel.get() / .set({ bufMs: 90, debounceMs: 30, pollMs: 2 })
  try { window.__rrStrumFeel = {
    get: () => ({ bufMs: _strumBufMs, debounceMs: STRUM_DEBOUNCE_MS, pollMs: _strumPollMs, fastPollLive: !!_fastPollId }),
    set: (o) => { o = o || {};
      if (o.bufMs != null) _strumBufMs = Math.max(0, +o.bufMs || 0);
      if (o.debounceMs != null) STRUM_DEBOUNCE_MS = Math.max(0, +o.debounceMs || 0);
      if (o.pollMs != null) { _strumPollMs = Math.max(1, Math.round(+o.pollMs) || 4); if (_fastPollId) { clearInterval(_fastPollId); _fastPollId = 0; _ensureFastPoll(); } }
      return window.__rrStrumFeel.get(); }
  }; } catch (e) {}
  // dev hook (strip at content-freeze): synchronous pollGamepad driver — headless verification mocks
  // navigator.getGamepads and steps button edges deterministically (rAF + timers are throttled there).
  try { window.__rrPollPad = () => { try { pollGamepad(); } catch (e) {} }; } catch (e) {}
  function gamepadList() { if (!navigator.getGamepads) return []; const out = []; for (const gp of navigator.getGamepads()) if (gp) out.push(gp.id); return out; }

  // ---------- HIT LOGIC ----------
  function songTime() { return player ? player.getTime() : -3; }

  // music gate: silence the track briefly on a miss, restore otherwise
  function applyGate() {
    const target = muted ? 0 : (songTime() < muteUntil ? DIP_LEVEL * musicVol : musicVol);
    if (Math.abs(target - curGain) > 0.001) { curGain = target; if (player && player.setGain) player.setGain(target); }
  }

  function handleHit(lane, evTime, src) {   // build102w: src ('guitar' = strum-driven) — only the empty-press branch reads it
    lanePulse[lane] = 1.0;        // press feedback: button pushes down + lights
    lanePluckT[lane] = 0;         // pluck/vibrate this lane's string on EVERY press
    _lanePressMs[lane] = performance.now();   // build104 s7: FULL-CHORD sampling — remember when each lane was last struck
    // Judge at the instant the player ACTUALLY pressed, not when this handler ran.
    // evTime is the event's DOMHighResTimeStamp; subtracting the elapsed lag recovers
    // timing lost to event-queue / frame-block latency (clamped so a bad value can't hurt).
    const inputLag = evTime ? Math.min(0.05, Math.max(0, (performance.now() - evTime) / 1000)) : 0;
    const t = songTime() - audioOffset - inputLag;
    const diff = DIFFICULTY[difficulty];
    const _hw = effHitWindow(diff);   // FIRST PULSE: eased (Easy 0.20) window while a bridge run is armed; otherwise === diff.hitWindow (byte-identical)
    let target = null, targetDiff = Infinity;
    for (const n of notes) {
      // OPEN note (openNotes flag) matches a press in ANY lane; all others stay lane-locked
      // (n.open is false unless the flag built it → default behavior byte-identical).
      if (!n.open && n.lane !== lane) continue;
      if (n.judged) continue;
      if (n.time < t - _hw) continue;
      if (n.time > t + _hw) break;
      const d = Math.abs(n.time - t);
      // build100d (bug-swarm): on an EXACT distance tie, prefer a non-bomb over a bomb. A gap-fill tap can land on a
      // bomb-row's exact lane+time (the bomb-collision guard runs before gap-fill), and the bomb sorts first in `notes`,
      // so a strict `<` let the bomb win the tie → a CORRECT press ate a bomb penalty. The tie-break only fires on an
      // exact tie where the current pick is a bomb and this one isn't, so normal charts are byte-identical.
      if (d < targetDiff || (d === targetDiff && target && target.type === 'bomb' && n.type !== 'bomb')) { targetDiff = d; target = n; }
    }
    if (!target) {   // empty press — no note in window. build85: whiff cue (does NOT break combo or drain stability — keyboard-feel guardrail)
      // SLIDE RAILS: a destination press that services an active rail transfer (finger-roll onto the next string) is
      // NOT a whiff — laneDown was already set by the input path, so the sustain loop migrates on the next frame.
      if (_activeRailForDest(lane, t) >= 0) return;
      // build102w: an EMPTY STRUM is FREE. In strum mode, alternate-strumming between notes is normal technique —
      // the whiff dash + whiff SFX + catcher recoil on every stroke read as constant complaints (part of the "weird
      // and tiring" report). Guitar-source empties do NOTHING; keyboard/touch/press-mode keep the build85 cue.
      if (src === 'guitar') return;   // NOT counted as sloppiness — a strum-mode alternate-strum miss is normal technique, not a mash
      wastedInputs++;   // build108 s4: anti-mash — display-only tally (see the declaration comment). Never touches score/combo/miss/grade.
      // build89: warm-grey dash (#8a807c, R>=G>=B — brand law); skip the flash if a real judgment fired this frame so the dash can't clobber it
      if (performance.now() - _lastRealJudgeMs > 30) flashJudgment('—', '#8a807c', true);
      playWhiffSfx();
      catcherRecoil[lane] = Math.max(catcherRecoil[lane] || 0, 0.5);   // half-kick (a real miss = 1.0)
      return;
    }

    // HAZARD: pressing a lane while a BOMB sits in its window penalizes — these are "don't hit".
    if (target.type === 'bomb') {
      target.judged = true; target.hit = 'bomb';
      // build122 p1 CLUTCH: snapshot the streak's peak before it zeroes, arm the recovery gate if it
      // qualifies (>=25). Observational only — does not affect scoring.
      if (_peakCombo >= CLUTCH_MIN_BREAK_PEAK) { _lastBreakPeak = _peakCombo; _clutchArmed = true; } else { _clutchArmed = false; }
      _peakCombo = 0;
      combo = 0; comboTierCur = 0; lastMult = 1;
      stability = Math.max(0, stability - bossDrain(0.06));
      glitchAmount = Math.min(1, glitchAmount + 0.25);
      cameraShake = Math.max(cameraShake, 9);
      registerMissFx(lane);
      playMissSfx();   // squelch (music level stays full — no ducking)
      emitFx('bomb', 'bomb', lane);
      if (target._fuseFx) { try { target._fuseFx.stop(); } catch (e) {} target._fuseFx = null; }
      if (target._warnFx) { try { target._warnFx.stop(); } catch (e) {} target._warnFx = null; }
      flashJudgment('✕ BOMB', '#ff1f2e');
      spawnHitParticles(lane, 'good');
      if (navigator.vibrate) { try { navigator.vibrate([16, 28, 16]); } catch (e) {} }
      updateHUD();
      return;
    }

    const ad = targetDiff;
    const _tp = timingProf();
    let kind;
    if (ad < _hw * _tp.perfFrac) kind = 'perfect';
    else if (ad < _hw * _tp.greatFrac) kind = 'great';
    else kind = 'good';
    // signed timing error (sec): >0 = pressed LATE, <0 = pressed EARLY. Drives the early/late tick.
    const _signed = t - target.time;
    if (_timingSamples.length < 4000) _timingSamples.push(_signed);   // build83: collect for the results early/late summary

    target.judged = true; target.hit = kind;
    counts[kind]++; combo++; if (combo > maxCombo) maxCombo = combo;
    checkClutch(lane);   // build122 p1: observational-only CLUTCH recovery check (see checkClutch/_peakCombo)
    // combo milestone → LIGHTNING STRIKE (Guitar-Hero-style streak reward)
    if (combo > 0 && combo % 25 === 0) {
      const tier = combo / 25;                                  // 1, 2, 3, … — escalates with the streak
      emitComboWave(lane, tier, combo % 100 === 0);             // build13: board-wide wave, not a bottom blob
      playComboFlareSfx();   // build157: bright metallic chime on each streak milestone (small, mixer-gated; silent if unloaded)
      lightningT = Math.min(0.55, 0.3 + tier * 0.05);
      comboGlow = 1;   // build64: flare the strings gold → white-hot on the milestone (cosmetic)
      scanT = scanDur = 0.42; scanTier = tier;   // combo-milestone scan sweep, brighter with the streak
      cameraShake = Math.max(cameraShake, 11 + Math.min(9, tier * 2));
      bgPulse = 1;
      const big = combo % 100 === 0;                            // every 100 is a bigger moment
      _armJudgePriority(big ? 550 : 450);   // build60: a STREAK milestone headlines — protect it from the next plain GREAT
      flashJudgment(combo + (big ? ' STREAK!!' : ' STREAK'), big ? '#fff2cd' : '#ffe08a');
      _scorePop(big);   // build51: the score punches on each streak milestone (big gold pop every 100)
      if (navigator.vibrate) { try { navigator.vibrate(big ? [12, 18, 12, 18, 12] : [10, 20, 10]); } catch (e) {} }
      // build8: level-fx combo milestone hook (Skully swaps to the intense backdrop). No-op when unset.
      try { if (window.RhythmLevelFx && window.RhythmLevelFx.onCombo) window.RhythmLevelFx.onCombo(combo, big); } catch (e) {}
      // build109 s3: reuse comboMidT as the "just had a combo-tier burst" gate for the additive-brightness
      // budget below — no new state. This IS the tier burst (not the halfway pulse further down), so it
      // arms the same timer; whichever fires last within a ~0.34s window wins, which is fine (both mean
      // "something bright just happened here, mute the ambient stream so it doesn't stack toward white").
      comboMidT = Math.max(comboMidT, 0.34);
    }
    // 3B-i: MID-STREAK PULSE — a smaller cue at the HALFWAY point of each 25-combo interval (15, 40, 65, …)
    // so the 11-24 (and every post-milestone) dead zone feels alive between the full lightning payoffs.
    // Cosmetic only — no score/mult change. A brief gold flash band + a single-lane string surge + light shake.
    else if (combo >= 15 && combo % 25 === 15) {
      comboMidT = 0.34;
      comboGlow = Math.max(comboGlow, 0.55);
      cameraShake = Math.max(cameraShake, 5);
      bgPulse = Math.max(bgPulse, 0.5);
      try { if (fx && !reduceMotion && !fxLite) { const g = fretGeom(); emitStringSurge(lane, 'lane-pulse', 0, (g.lw / 128) * FX_GLOBAL, g); } } catch (e) {}
    }
    // combo TIER cross-up (HOT→BLAZE→GOLDEN→INFERNO→ASCENDANT) — fires after the
    // milestone block so the named-mode flash headlines at 25/75/150/300/500.
    { const _nt = comboTierIdx(combo); if (_nt > comboTierCur) { comboTierCur = _nt; onComboTierUp(_nt, lane); } }
    const _tpM = timingProf();
    const comboTier = Math.min(_tpM.comboCap, 1 + Math.floor(combo / _comboStepFor()));
    const _capM = _tpM.comboCap + 1;                                  // overdrive = +1 tier
    const mult = Math.min(MAX_MULT, Math.min(odActive ? _capM : _tpM.comboCap, odActive ? comboTier + 1 : comboTier));   // v258: hard-clamp to MAX_MULT (=4) — keep score within the per-note ceiling on every timing profile
    // build104 s8: ACCENTS ARE MONEY NOTES — a PERFECT on a chart-authored accent pays 1.5× base, charges the OD
    // meter deeper (0.04 vs 0.022), and kicks harder (hitFeel). Precision on the notes the song itself stressed is
    // now worth aiming for. Accent counts are chart-fixed → ceiling extends by accents×750 (see ceiling comment);
    // mirrored in the P2 scorer. GREAT/GOOD accents pay the normal rate — the bonus IS the precision reward.
    const accPerf = (target.type === 'accent' && kind === 'perfect');
    score += JUDGE[kind].score * mult * (accPerf ? 1.5 : 1);
    if (mult > lastMult) {
      // build19 (user screenshot: a big flame ring floating on the body "just looks out of place"):
      // the centered multiplier flare is GONE. A tier climb now reads at the play site — a quick
      // small RIPPLE across the catcher row spreading from the lane you hit + a comet up that
      // string. (Sustained heat is already the fire-loop state; big moments belong to centuries.)
      try {
        if (!reduceMotion && fx) {
          const _gM = fretGeom(), _kM = (_gM.lw / 128) * FX_GLOBAL;
          for (let _i = 0; _i < LANE_COUNT; _i++) {
            const _x = _gM.nearX[_i], _y = _gM.nearY - _gM.lw * 0.36;
            _fxLater(Math.abs(_i - lane) * 40, () => _spawnAt('string-ripple', _x, _y, 0.55 + 0.08 * mult, _kM));
          }
          if (!fxLite) emitStringSurge(lane, 'note-comet', 40, _kM, _gM);
        }
      } catch (e) {}
    }
    lastMult = mult;
    laneHitPulse[lane] = 1.0;
    const _odWasFull = overdrive >= 1;   // Wave-3 finding 3: was the meter already full BEFORE this hit? (gate for the cosmetic overflow; does not touch `overdrive`)
    if (!odActive) overdrive = Math.min(1, overdrive + (target.type === 'star' ? 0.14 : accPerf ? 0.04 : 0.022)); // charge the meter (no top-up while OD is live — the render loop force-drains it anyway; build58 makes the no-extend rule explicit). build104 s8: accent PERFECTs charge deeper.
    if (!odActive && _odWasFull) odOvercharge = Math.min(1, odOvercharge + (target.type === 'star' ? 0.14 : accPerf ? 0.04 : 0.022) * 0.5);   // Wave-3 finding 3: the charge the line above CLAMPED away → visualized in a cosmetic reservoir ONLY, never re-banked into `overdrive` (OD budget byte-identical)
    lanePluckT[lane] = 0;                 // pluck the string in this lane
    if (muteUntil > 0) { muteUntil = -1; applyGate(); }  // a clean hit recovers the music
    stability = Math.min(1.0, stability + 0.01);
    spawnHitParticles(lane, kind);
    emitFx(kind === 'perfect' ? 'perfect' : 'hit', kind, lane);
    if (target.type === 'star') emitFx('star', kind, lane);   // build8b: star-pickup pop on a surge note
    _phraseCredit(target);   // A2 STARSTRUCK (dark unless rr_odphrase tagged phrases): count this hit toward its star-phrase — NO-OP when untagged; never scores/charges
    // build8c: chord-bar strike — a strum ripple centered between the chord's lanes (lead note only)
    if (target.chordLead && target.chordLanes && target.chordLanes.length > 1) {
      try { const _cg = fretGeom(); let _cx = 0; for (let _ci = 0; _ci < target.chordLanes.length; _ci++) _cx += _cg.nearX[target.chordLanes[_ci]] || 0;
        emitFx('chord', 'chord', lane, _cx / target.chordLanes.length, _cg.nearY); } catch (e) {}
    }
    // build100t: GROUPED CHORD RESOLVE — pressing ANY ONE chord key clears the whole chord on keyboard (two-finger
    // optional). Without this the partner gem ~2 lanes over (the "bar/sidebar" the player tried to push) sails past
    // unjudged → forced MISS + combo break. build100q FIX: match chord members by the STABLE chordId scalar, NOT by the
    // chordLanes array REFERENCE — the per-level MIRROR mod (~1615) reassigns each note's chordLanes to a fresh mapped
    // array, so the lead and partner no longer share a reference and the old `!==` test skipped the partner on mirrored
    // levels → the bar never cleared. chordId survives the mirror (it remaps lanes only). Lead's judgment + mult; no combo bump.
    if (target.chordId != null && target.chordLanes && target.chordLanes.length > 1) {
      let _chordPaid = JUDGE[kind].score * mult;   // the lead's own payment (build104 s7: feeds the FULL CHORD bonus base)
      for (const cn of notes) {
        if (cn === target || cn.judged || cn.chordId !== target.chordId) continue;
        cn.judged = true; cn.hit = kind;
        counts[kind]++;
        score += JUDGE[kind].score * mult;
        _chordPaid += JUDGE[kind].score * mult;
        lanePluckT[cn.lane] = 0;
        try { spawnHitParticles(cn.lane, kind); emitFx('hit', kind, cn.lane); } catch (e) {}
      }
      // build104 s7 (#26b): FULL CHORD — the one-press assist stays the base case (a beginner clears the bar with
      // one finger), but a player who PHYSICALLY has every chord lane down at the judge instant earns 1.3× on the
      // whole chord. Sampling forgives a slightly-late second finger: a lane counts as down if it's held NOW or
      // was struck within the last 30ms; if the shape isn't complete yet, the check re-arms in loop() until the
      // ±35ms window closes. Chord count is chart-fixed → ceiling extends by 0.3×(chord total) per chord (see
      // ceiling comment); mirrored in the P2 scorer.
      const _nowFC = performance.now();
      const _laneIn = (l) => laneDown[l] || (_nowFC - (_lanePressMs[l] || -1e9)) <= 30;
      if (target.chordLanes.every(_laneIn)) {
        score += _chordPaid * 0.3;
        flashJudgment('FULL CHORD', '#ffe08a');
      } else {
        _pendFullChord.push({ lanes: target.chordLanes.slice(), bonus: _chordPaid * 0.3, until: _nowFC + 35 });
      }
    }
    // v253 (#92, GH feel): a judgment WORD on EVERY note spammed at speed (Hard ≈5/s). PERFECT is the common case and its
    // white burst + crimson shockwave already read as "perfect", so the word is suppressed — the climbing combo counter +
    // streak/tier headlines carry a clean run (true Guitar-Hero feel). GREAT/GOOD (you're slightly off — worth seeing) and
    // MISS still flash. Streak/tier/Overdrive/HOLD/BOMB callouts call flashJudgment directly and are unaffected.
    if (kind !== 'perfect') flashJudgment(JUDGE[kind].name, JUDGE[kind].color, false, true);   // build60: plain=true → won't stomp a live ceremony callout
    flashTiming(kind, _signed);   // tiny EARLY/LATE hint (cosmetic; off via Settings → Timing Hint)
    hitFeel(kind, lane, accPerf);   // build104 s8: an accent PERFECT kicks harder
    // a struck hold note becomes an active sustain — it keeps paying out (and the
    // string keeps ringing) for as long as this lane stays pressed (see loop()).
    // SLIDE RAILS: a rail head is struck EXACTLY like a hold head; its slot then migrates across lanes (holdRailSeg
    // tracks the NEXT transfer). Score-identical to a hold — no new score path here.
    if ((target.type === 'hold' || target.type === 'rail') && target.hold > 0) {
      holdNote[lane] = target; holdScored[lane] = 0; holdSparkT[lane] = 0;
      holdRailSeg[lane] = (target.type === 'rail') ? 1 : 0;   // heading to the first waypoint transfer
      _holdAttemptM++;   // Wave-3 finding 4: a sustain head struck → denominator for the "Clean holds N/M" stat (count only)
    }
    // HOPO CHAIN (openNotes flag): a clean hit while in combo auto-resolves the next `hopo` note
    // already inside its window in ANY lane — no fresh strum ("flow"). No-op when the flag is off.
    if (openNotes && combo >= 8 && kind !== 'good') chainHopos(t);
    // LEVEL FX hook (optional; set by a level overlay e.g. the Skully reactive tarot cards). No-op otherwise.
    try { if (window.RhythmLevelFx && window.RhythmLevelFx.onHit) window.RhythmLevelFx.onHit(kind, lane); } catch (e) {}
    updateHUD();
    _comboTick();   // build60 FEEL: subtle per-hit combo-number pulse (reduce-motion no-op; never on a miss)
  }

  // resolve consecutive HOPO ("flow") notes off a clean hit without a re-strum.
  function chainHopos(t) {
    const diff = DIFFICULTY[difficulty];
    const _hw = effHitWindow(diff);   // FIRST PULSE: eased window during a bridge run; else === diff.hitWindow
    let resolved = 0;
    for (const n of notes) {
      if (n.judged || !n.hopo || n.type === 'rail') continue;   // SLIDE RAILS: a rail head is a commitment, not a flow tap — never hopo-resolved
      if (n.time < t - _hw * 0.5) continue;
      if (n.time > t + _hw) break;
      n.judged = true; n.hit = 'great';
      counts.great++; combo++; if (combo > maxCombo) maxCombo = combo;
      checkClutch(n.lane);   // build122 p1: observational-only CLUTCH recovery check
      { const _nt = comboTierIdx(combo); if (_nt > comboTierCur) { comboTierCur = _nt; onComboTierUp(_nt, n.lane); } }
      score += JUDGE.great.score * curMult();
      laneHitPulse[n.lane] = 1.0; lanePluckT[n.lane] = 0;
      spawnHitParticles(n.lane, 'great');
      emitFx('hit', 'great', n.lane);
      // A2 STARSTRUCK: a hopo-resolved note is still a HIT, so it must credit its star-phrase. Without this the note is
      // judged here and therefore skipped by the miss sweep too — so it is neither credited nor voided, and any phrase
      // whose approach run gets flow-chained can never reach phraseLen (ceremony silently never fires). NO-OP when the
      // note carries no phraseId (the only state a flag-OFF chart has) → flag-OFF play stays byte-identical.
      _phraseCredit(n);
      resolved++;
      if (resolved >= 3) break;
    }
    if (resolved) { flashJudgment('FLOW x' + resolved, '#ff7a4a'); }
  }

  // per-judgment tactile feedback: world reaction + guitar chug + haptics
  // build104 s8: `heavy` (accent PERFECT) = a deeper kick — more shake/pulse + a hotter chug, so money notes FEEL paid.
  function hitFeel(kind, lane, heavy) {
    if (heavy) { cameraShake = Math.max(cameraShake, 9); bgPulse = Math.min(1, bgPulse + 0.55); }
    else if (kind === 'perfect') { cameraShake = Math.max(cameraShake, 6); bgPulse = Math.min(1, bgPulse + 0.4); }
    else if (kind === 'great') { cameraShake = Math.max(cameraShake, 3); bgPulse = Math.min(1, bgPulse + 0.25); }
    else { bgPulse = Math.min(1, bgPulse + 0.12); }
    if (!muted) {
      try {
        const ac = getAC(); const now = ac.currentTime;
        if (hitBuffer) {
          // REAL palm-mute guitar chug — per-lane pitch so each string rings differently
          // (and simultaneous chord hits sound like an actual chord).
          const src = ac.createBufferSource(); src.buffer = hitBuffer;
          const L = (lane == null) ? 2.5 : lane;
          src.playbackRate.value = 0.92 + L * 0.032;          // lanes 0..5 → ~0.92..1.08
          const g = ac.createGain();
          g.gain.value = (heavy ? 1.1 : kind === 'perfect' ? 0.95 : kind === 'great' ? 0.8 : 0.62) * SFX_LEVEL;   // build104 s8: accent PERFECT chugs hotter
          src.connect(g); g.connect(ac.destination); src.start(now);
          // build60 FEEL: PERFECT signature — a tiny top-end "tick" layered UNDER the chug so a dead-on hit
          // sounds crisper than a GREAT (non-verbal, on-brand). Very short + quiet + mixer-scaled; never on great/good.
          // FIX 11 (P2): build129's tick (2100→1400Hz triangle) read too PIERCING/odd to the owner. Warm + soften it:
          // a soft SINE (no bright harmonics) at a much lower ~820→560Hz, and cut the gain to ~40% of before. The
          // crisper white-hot VISUAL flash for PERFECT is unchanged (that part's good). Still mute/mixer-gated.
          if (kind === 'perfect') {
            try {
              const to = ac.createOscillator(), tg = ac.createGain();
              to.type = 'sine'; to.frequency.setValueAtTime(820, now); to.frequency.exponentialRampToValueAtTime(560, now + 0.045);
              tg.gain.setValueAtTime(0.0001, now);
              tg.gain.exponentialRampToValueAtTime(Math.min(0.04, SFX_LEVEL * 0.42), now + 0.005);
              tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
              to.connect(tg); tg.connect(ac.destination); to.start(now); to.stop(now + 0.07);
            } catch (e) {}
          }
        } else {
          // fallback synth blip if the chug sample hasn't decoded yet
          const o = ac.createOscillator(), g = ac.createGain();
          const f = kind === 'perfect' ? 900 : kind === 'great' ? 620 : 440;
          o.type = 'triangle';
          o.frequency.setValueAtTime(f, now); o.frequency.exponentialRampToValueAtTime(f * 0.55, now + 0.08);
          g.gain.setValueAtTime(0.0001, now);
          g.gain.exponentialRampToValueAtTime(kind === 'perfect' ? 0.16 : kind === 'great' ? 0.11 : 0.07, now + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
          o.connect(g); g.connect(ac.destination); o.start(now); o.stop(now + 0.15);
        }
      } catch (e) {}
    }
    if (navigator.vibrate) { try { navigator.vibrate(kind === 'perfect' ? 16 : kind === 'great' ? 9 : 4); } catch (e) {} }
  }

  // ---------- FLIPBOOK FX dispatch (VISUAL-ONLY; never touches gameplay/scoring/timing) ----------
  const FX_GLOBAL = 1.15;           // overall flipbook size (× lane width / 128 native frame)
  // build11 GAME-FEEL (user playtest: "they look like little videos, not impacts"): the Seedance
  // clips ignite over their first ~5-12 frames — on a hit you watched a video START instead of an
  // impact POP. One-shots now spawn AT their pre-measured PEAK frame (luminance argmax per sheet)
  // and CUT before the lingering smoke tail. Loops are untouched.
  const FX_TIM = {
    'hit-burst':        { pk: 5,  cut: 12 }, 'perfect-flare':   { pk: 8,  cut: 15 },
    'explosion':        { pk: 7,  cut: 17 }, 'shockwave':       { pk: 12, cut: 14 },
    'miss-shatter':     { pk: 4,  cut: 14 }, 'bomb-explode':    { pk: 1,  cut: 23 },
    'combo-burst':      { pk: 8,  cut: 15 }, 'multiplier-up':   { pk: 9,  cut: 13 },
    'note-comet':       { pk: 1,  cut: 8  }, 'star-pickup':     { pk: 2,  cut: 12 },
    'gradeup-flare':    { pk: 4,  cut: 19 }, 'lane-pulse':      { pk: 8,  cut: 13 },
    'string-ripple':    { pk: 7,  cut: 14 }, 'shard-burst':     { pk: 7,  cut: 15 },
    'soul-burst-violet':{ pk: 7,  cut: 17 }, 'bone-shatter':    { pk: 4,  cut: 14 },
    'note-sparkle-pink':{ pk: 8,  cut: 15 }, 'heart-pop-pink':  { pk: 5,  cut: 13 },
    'paw-poof':         { pk: 11, cut: 15 }, 'confetti-pop':    { pk: 3,  cut: 15 },
    'firework-gold':    { pk: 11, cut: 19 },
  };
  try { window.RhythmFxTim = FX_TIM; } catch (e) {}   // PRODUCTION export (not a __rr dev hook) — UI buttons snap at peak too
  // impact-tuned spawn: jump the instance's clock to (peak-1) so the POP lands on the next paint;
  // stop at the cut frame so tails don't smear. Falls back to a plain play for loops/unknown names.
  function _playTuned(name, x, y, scale) {
    const meta = fx.manifest[name];
    const h = fx.play(name, x, y, { scale: scale });
    const tim = FX_TIM[name];
    if (tim && meta && !meta.loop) {
      try {
        const inst = fx.active[fx.active.length - 1];
        const frameMs = 1000 / (meta.fps || 30);
        if (inst && inst.start === null && tim.pk > 1) inst.start = performance.now() - (tim.pk - 1) * frameMs;
        if (tim.cut < meta.count - 1) setTimeout(() => { try { h.stop(); } catch (e) {} }, Math.max(40, (tim.cut - (tim.pk - 1)) * frameMs + 20));
      } catch (e) {}
    }
    return h;
  }
  // per-level themed hit/perfect variants, keyed by #game[data-rrtheme]; else the brand-default set
  const THEME_FX = {
    violet: { hit: 'soul-burst-violet', perfect: 'soul-burst-violet' },   // Skully "The World"
    bone:   { hit: 'bone-shatter',      perfect: 'bone-shatter' },        // Bone Daddy
    pink:   { hit: 'paw-poof',          perfect: 'heart-pop-pink', perfect2: 'note-sparkle-pink' },  // Melody (paw bat + heart, sparkle on perfects)
  };
  // build8b: per-level ambient AURA loop — drifts behind the upper neck while a themed level plays
  // (the "living world" cue). Subtle + localized (NOT a full-screen wash). null/absent → no aura.
  const THEME_AURA = { violet: 'skull-flame-violet', bone: 'ember-skull-loop', ember: 'ember-rise', crimson: 'ember-rise' };
  function _fxTheme() {
    try { const g = document.getElementById('game'); return (g && g.dataset && g.dataset.rrtheme) || ''; } catch (e) { return ''; }
  }
  // ═══ build65 — VFX 2.0: per-level HIT KITS ═══════════════════════════════════════════════════════════
  // The OLD palette only swapped COLOR — blood / paw / spark all rendered as the same little dab, so every
  // level's hit looked identical in motion (the user's "I see no difference between levels"). A KIT is a full
  // IDENTITY: a distinct particle SHAPE, its own motion (rise / float / fall), gravity, additive-vs-solid blend,
  // a fine sparkle DUST, and a lingering SETTLE element that gives the level its signature afterglow. Bursts also
  // carry z/vz so a share of particles ERUPT TOWARD THE CAMERA (grow + fly down the neck) — the fake-3D "pop"
  // that reads as depth on the perspective fretboard (the "2D → 3D / Paper-Mario→modern" leap the user asked for).
  // shapes: ember | glint | wisp | shard | paw | glob      settle: ember | mote | wisp | smoke | heart | drip
  // dir: -1 = burst fans UPWARD and rises; +1 = arcs then falls hard (blood). add: additive 'lighter' glow.
  const _HIT_KITS = {
    '':      { core:'255,238,208', prim:['255,72,60','255,150,84'],   ring:'255,84,86',  glow:'255,96,64',  shape:'ember', grav:0.50, dir:-1, add:true,  dust:'255,186,128', settle:'ember' },
    crimson: { core:'255,238,208', prim:['255,72,60','255,150,84'],   ring:'255,84,86',  glow:'255,96,64',  shape:'ember', grav:0.50, dir:-1, add:true,  dust:'255,186,128', settle:'ember' },
    ember:   { core:'255,226,172', prim:['255,142,52','255,92,30'],   ring:'255,152,72', glow:'255,124,52', shape:'ember', grav:0.45, dir:-1, add:true,  dust:'255,202,142', settle:'ember' },
    gold:    { core:'255,247,216', prim:['255,212,112','255,172,62'], ring:'255,216,132',glow:'255,202,92', shape:'glint', grav:0.60, dir:-1, add:true,  dust:'255,238,182', settle:'mote'  },
    violet:  { core:'245,233,255', prim:['184,104,255','222,184,255'],ring:'192,122,255',glow:'172,92,255', shape:'wisp',  grav:0.40, dir:-1, add:true,  dust:'226,206,255', settle:'wisp'  },
    bone:    { core:'255,251,245', prim:['238,233,229','212,202,192'],ring:'238,233,229',glow:'255,172,92', shape:'shard', grav:1.05, dir:-1, add:false, dust:'246,241,235', settle:'smoke' },
    pink:    { core:'255,238,246', prim:['255,98,164','255,152,202'], ring:'255,122,186',glow:'255,112,172', shape:'paw',   grav:0.32, dir:-1, add:true,  dust:'255,202,226', settle:'heart' },
    chrome:  { core:'255,255,255', prim:['226,231,241','255,92,98'],  ring:'222,227,237',glow:'202,212,232', shape:'shard', grav:0.92, dir:-1, add:true,  dust:'236,241,251', settle:'smoke' },
    // build66 (launch-audit): bespoke kits so the paid showcase levels stop sharing the plain ember kit (chosen via a level's fxKit field, decoupled from color theme)
    seafoam: { core:'255,247,224', prim:['255,206,84','64,224,208'],  ring:'255,216,140',glow:'120,220,205', shape:'glint', grav:0.55, dir:-1, add:true,  dust:'235,245,238', settle:'mote'  },   // High Seas — gold coin-glint + aqua sea-spark
    soul:    { core:'232,255,236', prim:['120,230,140','150,90,220'], ring:'140,235,160',glow:'110,210,150', shape:'wisp',  grav:0.40, dir:-1, add:true,  dust:'200,245,210', settle:'wisp'  },   // Deadkin — spectral carnival souls
    neon:    { core:'255,236,250', prim:['255,40,170','190,60,255'],  ring:'255,80,190', glow:'235,70,200', shape:'shard', grav:0.70, dir:-1, add:true,  dust:'255,190,230', settle:'smoke' }    // Shorty-X — hot neon-magenta shards
  };
  const _BLOOD_KIT = { core:'255,126,124', prim:['154,22,26','98,10,14'], ring:'150,24,28', glow:'122,18,22', shape:'glob', grav:2.0, dir:1, add:false, dust:'124,20,24', settle:'drip' };
  function _hitKit() {
    try { if (document.body.classList.contains('rr-lens-horror')) return _BLOOD_KIT; } catch (e) {}
    // build66 (launch-audit): a level can pick a bespoke hit kit (fxKit), decoupled from its color theme, so two ember-themed
    // showcase levels don't share the plain ember kit. The level's fxKit wins; otherwise fall back to the theme kit.
    try { if (_levelCtx && _levelCtx.fxKit && _HIT_KITS[_levelCtx.fxKit]) return _HIT_KITS[_levelCtx.fxKit]; } catch (e) {}
    return _HIT_KITS[_fxTheme()] || _HIT_KITS[''];
  }
  // gameplay event 'type' -> additive layers [{name, mult}]; mult scales the manifest's per-effect scale
  function _fxLayers(type, kind) {
    const th = THEME_FX[_fxTheme()] || null;
    switch (type) {
      case 'hit': {
        const L = [{ name: (th && th.hit) || 'hit-burst', mult: 0.85 }];   // tight to the note
        if (odActive) L.push({ name: 'note-comet', mult: 0.9 });           // star power: every hit streaks
        return L;
      }
      case 'perfect': {
        const L = [{ name: (th && th.perfect) || 'perfect-flare', mult: 0.95 }];
        if (th && th.perfect2) L.push({ name: th.perfect2, mult: 0.85 });  // themed 2nd layer (Melody sparkle)
        if (odActive) L.push({ name: 'note-comet', mult: 0.9 });
        return L;
      }
      case 'miss':      return [{ name: 'miss-shatter', mult: 0.9 }];
      case 'star':      return [{ name: 'star-pickup', mult: 1.05 }];
      case 'multup': {  // multiplier tier climbed — escalates with the tier (kind = 'x2'|'x3'|'x4')
        const mt = parseInt(String(kind || '').replace(/\D/g, ''), 10) || 2;
        const L = [{ name: 'multiplier-up', mult: mt >= 4 ? 1.3 : mt === 3 ? 1.05 : 0.85 }];
        if (mt >= 4) L.push({ name: 'gradeup-flare', mult: 0.9 });         // max multiplier = a real moment
        return L;
      }
      case 'chord':     return [{ name: 'string-ripple', mult: 1.2 }];      // chord bar struck (centered)
      case 'holdend':   return [{ name: 'lane-pulse', mult: 1.0 }];         // sustain banked to the tail
      case 'wipeout':   return [{ name: 'shard-burst', mult: 1.05 }];       // mass-fail shatter
      case 'combo': {   // STREAK ESCALATION — every 25 grows; CENTURIES are the big stage moment
        const tier = Math.max(1, Math.round(combo / 25));
        const century = combo > 0 && combo % 100 === 0;
        if (century)    return [{ name: 'firework-gold', mult: 1.25 }, { name: 'explosion', mult: 1.1 }, { name: 'shockwave', mult: 1.25 }];
        if (tier >= 3)  return [{ name: 'explosion', mult: 1.0 }, { name: 'shockwave', mult: 1.0 }];
        if (tier === 2) return [{ name: 'combo-burst', mult: 1.0 }, { name: 'shockwave', mult: 0.8 }];
        return [{ name: 'combo-burst', mult: 0.85 }];
      }
      case 'overdrive': return [{ name: 'shockwave', mult: 1.15 }, { name: 'explosion', mult: 0.95 }];
      case 'odend':     return [{ name: 'shockwave', mult: 0.85 }];         // star power dissipates
      case 'bomb':      return [{ name: 'bomb-explode', mult: 1.0 }, { name: 'shockwave', mult: 0.8 }];
      default: return [];
    }
  }
  function _fxHas(name) { return !!(fx && fx.manifest && fx.manifest[name] && fx.images && fx.images[name]); }
  // one-shot FX at the catcher for `lane` (or explicit x,y). No-op without fx / under reduce-motion.
  function emitFx(type, kind, lane, x, y) {
    try {
      if (!fx || reduceMotion) return;
      if (fx.active && fx.active.length > (fxLite ? 14 : 96)) return;     // soft concurrency guard
      let layers = _fxLayers(type, kind);
      if (!layers.length) return;
      if (fxLite) layers = layers.slice(0, 1);                           // lite: primary layer only
      const _g = fretGeom();
      if (x == null || y == null) {
        if (typeof lane === 'number' && lane >= 0 && lane < _g.nearX.length) { x = _g.nearX[lane]; y = _g.nearY; }
        else { x = _g.nearX[(_g.nearX.length / 2) | 0]; y = _g.nearY; }
      }
      const k = (_g.lw / 128) * FX_GLOBAL;
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        if (!_fxHas(L.name)) continue;                                   // sheet absent/failed → skip (no warn spam)
        const meta = fx.manifest[L.name];
        _playTuned(L.name, x, y, (meta.scale != null ? meta.scale : 1) * (L.mult || 1) * k);
      }
    } catch (e) {}
  }
  // spawn a LOOP handle at an explicit final `scale` (+ optional alpha) — fuse, theme aura, overdrive
  // glow. Caller manages/stops it.
  function _fxRide(name, x, y, scale, alpha) {
    try {
      if (!fx || reduceMotion || fxLite || !_fxHas(name)) return null;
      return fx.play(name, x, y, { loop: true, scale: scale, alpha: (alpha != null ? alpha : 1) });
    } catch (e) { return null; }
  }
  // ---------- build13: FX ARE PARTICLES ON THE BOARD (user playtest: "the effects just float at
  // the bottom — it doesn't make sense"). Guitar-Hero's rule applied: every effect anchors to
  // gameplay geometry and energy flows UP the strings. Streak milestones are now WAVES — a
  // catcher-row ripple spreading from the hit lane + pulses traveling up the lanes with
  // perspective shrink; centuries fire fireworks into the BACKDROP SKY above the nut (the venue
  // celebrates); multiplier tiers set the catcher buttons themselves on FIRE (fire-loop). ----------
  let _fxGen = 0;                      // generation guard — bumped on reset so queued spawns die with the run
  function _fxLater(ms, fn) {
    if (ms <= 0) { try { fn(); } catch (e) {} return; }
    const g = _fxGen;
    setTimeout(() => { if (g === _fxGen && state === 'playing') { try { fn(); } catch (e) {} } }, ms);
  }
  // absolute-position spawn under emitFx's scale law (manifest scale × mult × lane-width norm)
  function _spawnAt(name, x, y, mult, kk) {
    if (!_fxHas(name)) return;
    const meta = fx.manifest[name];
    _playTuned(name, x, y, (meta.scale != null ? meta.scale : 1) * (mult || 1) * kk);
  }
  // point on lane `i` at depth d (0 = catcher .. 1 = nut) in SCREEN px — mirrors render()'s
  // noteX/noteY (1/z persp + neck-recede warp) so traveling FX ride the exact note path.
  function _lanePtPx(g, i, d) {
    const zFar = (ART.persp > 1) ? ART.persp : 0;
    const u = (zFar > 1) ? ((1 - 1 / (1 + d * (zFar - 1))) / (1 - 1 / zFar)) : d;
    let x = g.nearX[i] + (g.farX[i] - g.nearX[i]) * u;
    const w = ART.warp || 0;
    if (w > 0) { const cx0 = g.gx + 0.5 * g.gw; x = cx0 + (x - cx0) * (1 - w * Math.max(0, u)); }
    const y = g.nearY + (g.farY - g.nearY) * u;
    const k = (zFar > 1) ? (1 / (1 + Math.max(0, d) * (zFar - 1))) : (1 - 0.7 * d);
    return { x: x, y: y, k: Math.max(0.30, k) };
  }
  // a pulse SURGES up one lane — catcher → nut, shrinking with depth (the energy you fed the string)
  function emitStringSurge(lane, name, baseMs, kk, g) {
    const steps = fxLite ? [0.30, 0.72] : [0.14, 0.36, 0.58, 0.80];
    for (let s = 0; s < steps.length; s++) {
      const pt = _lanePtPx(g, lane, steps[s]);
      _fxLater(baseMs + s * 64, () => _spawnAt(name, pt.x, pt.y, 0.92 * pt.k, kk));
    }
  }
  // build18: the board "comes online" — a quick L→R catcher ignition the moment the level-start
  // print completes (response to the entrance finishing, anchored where play happens)
  function _igniteCatchers() {
    try {
      if (!fx || reduceMotion || state !== 'playing') return;
      const g = fretGeom();
      const kk = (g.lw / 128) * FX_GLOBAL;
      for (let i = 0; i < LANE_COUNT; i++) {
        const x = g.nearX[i], y = g.nearY - g.lw * 0.32;
        _fxLater(i * 55, () => _spawnAt('lane-pulse', x, y, 0.6, kk));
      }
    } catch (e) {}
  }
  // streak milestone (every 25 / century) — the BOARD celebrates, radiating from the lane you hit
  function emitComboWave(originLane, tier, century) {
    try {
      if (!fx || reduceMotion) return;
      const g = fretGeom();
      const kk = (g.lw / 128) * FX_GLOBAL;
      const th = THEME_FX[_fxTheme()] || null;
      const burst = (th && th.hit) || 'combo-burst';
      const oL = (typeof originLane === 'number' && originLane >= 0 && originLane < LANE_COUNT)
        ? originLane : ((LANE_COUNT / 2) | 0);
      // (a) catcher-row RIPPLE — every button pops, spreading outward from the origin
      for (let i = 0; i < LANE_COUNT; i++) {
        const x = g.nearX[i], y = g.nearY - g.lw * 0.40;
        _fxLater(Math.abs(i - oL) * 46, () => _spawnAt(burst, x, y, 0.62 + 0.10 * Math.min(4, tier), kk));
      }
      if (fxLite) return;                                  // lite: the ripple IS the celebration
      // (b) STRING SURGE — the first milestone rides the hit lane; deeper streaks light every string
      if (tier >= 2) { for (let i = 0; i < LANE_COUNT; i++) emitStringSurge(i, 'lane-pulse', 120 + Math.abs(i - oL) * 40, kk, g); }
      else emitStringSurge(oL, 'lane-pulse', 110, kk, g);
      // (build18 — user: "fire spinning in the center of the guitar didn't make sense": the
      // mid-board detonations are GONE. Celebration energy lives only where it has a cause —
      // the catcher row the player plays on, the strings it travels up, and the sky for centuries.)
      // (c) CENTURY — gold fireworks in the SKY above the nut + an ECHO ripple across the row
      if (century) {
        const skyY = Math.max(ch * 0.05, g.farY - (g.nearY - g.farY) * 0.10);
        const xs = [0.34, 0.5, 0.66];
        for (let i = 0; i < xs.length; i++) {
          const sx = g.gx + g.gw * xs[i], sy = skyY + (i === 1 ? -ch * 0.03 : ch * 0.015);
          _fxLater(140 + i * 170, () => _spawnAt('firework-gold', sx, sy, 1.15 + (i === 1 ? 0.25 : 0), kk));
        }
        for (let i = 0; i < LANE_COUNT; i++) {
          const x = g.nearX[i], y = g.nearY - g.lw * 0.40;
          _fxLater(260 + Math.abs(i - oL) * 46, () => _spawnAt(burst, x, y, 1.05, kk));
        }
      }
    } catch (e) {}
  }
  // build8b/c: managed ambient loop handles (theme aura, overdrive aura, OD-ready catcher rings,
  // per-lane hold charge loops) — spawned/repositioned in render(), stopped on clear / resetScoring.
  // Pure visual; never affect gameplay.
  let _auraFx = null, _odAura = null, _readyRings = null, _holdFxL = [];
  // build13: per-lane MULTIPLIER FIRE loop handles (fire-loop riding the catcher buttons at x3+)
  let _multFireL = [];
  function _stopMultFire() {
    for (let i = 0; i < _multFireL.length; i++) { const h = _multFireL[i]; if (h) { try { h.stop(); } catch (e) {} } }
    _multFireL = [];
  }
  // build10b: level-start cinematic progress — 0→1 while a custom guitar MATERIALIZES along the
  // highway (advanced in render; 1 = fully built; default guitar never builds).
  let _skinBuildT = 1;
  // build22 (Melody): a tiny canvas paw print — pad ellipse + three toes pointing DOWN the
  // highway (the cat walked toward the catchers). Cheap fills; used by the pink fret rows.
  function _drawPaw(x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.62, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(x + i * r * 0.5, y + r * 0.62 + Math.abs(i) * r * 0.10, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // build65 (VFX 2.0): a soft heart glyph (Melody / pink "settle") — pairs with _drawPaw.
  function _drawHeart(x, y, r, col) {
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(x, y + r * 0.62);
    ctx.bezierCurveTo(x + r, y - r * 0.2, x + r * 0.5, y - r, x, y - r * 0.32);
    ctx.bezierCurveTo(x - r * 0.5, y - r, x - r, y - r * 0.2, x, y + r * 0.62);
    ctx.closePath(); ctx.fill();
  }
  // build65 (VFX 2.0): cached additive GLOW sprite per color — drawImage a pre-rendered radial instead of
  // building createRadialGradient every frame per particle. This is the big particle-perf win (FPS-safe at
  // scale): the most common burst particle (embers/motes) becomes one cheap blit, not a fresh gradient.
  const _glowCache = {};
  function _glowSprite(rgb) {
    if (_glowCache[rgb]) return _glowCache[rgb];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(0.42, 'rgba(' + rgb + ',0.5)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
    _glowCache[rgb] = c; return c;
  }
  // build65: HSV→RGB (0..1 hue) for the earned rainbow string shimmer at elite combo / Overdrive.
  function _hsv(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), u = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (((i % 6) + 6) % 6) { case 0: r = v; g = u; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = u; break; case 3: r = p; g = q; b = v; break; case 4: r = u; g = p; b = v; break; default: r = v; g = p; b = q; }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  // build65: COMBO-TIER string hue LADDER. The user found the steady yellow/crimson strings boring and wanted
  // the strings to REWARD a streak (rainbow at a big combo). So the strings now visibly ESCALATE color as the
  // streak climbs — crimson → orange → amber → white-gold → white-hot — and at a big combo (RAINBOW_COMBO, =150) OR Overdrive
  // they bloom into a flowing per-lane SPECTRAL RAINBOW (the earned payoff). Brand stays crimson at baseline;
  // the rainbow is gated to elite play so it reads as "you earned this," not as off-brand chrome. Cosmetic only.
  function _comboTierTint(i, tNow) {
    const c = combo;
    if (odActive || c >= RAINBOW_COMBO) { var _ph = (((reduceMotion ? 0 : tNow * 0.16)) + i / Math.max(1, LANE_COUNT)) % 1; var rgb = _hsv((0.90 + _ph * 0.25) % 1, 0.85, 1); return { r: rgb[0], g: rgb[1], b: rgb[2], k: 0.82 }; }   // build65: WARM-BIASED rainbow (pink→red→orange→gold→yellow) — vibrant + multicolor but skips blue/green/purple per the hard brand rule. Shared RAINBOW_COMBO gate (=150) so strings + hit-burst agree. reduceMotion → freeze the hue cycle to a STATIC across-lane gradient (a11y: no continuous color motion).
    if (c >= 100) return { r: 255, g: 236, b: 168, k: 0.62 };   // GOLDEN — white-gold (last solid tier before the rainbow)
    if (c >= 50)  return { r: 255, g: 198, b: 88,  k: 0.50 };   // BLAZE — amber
    if (c >= 25)  return { r: 255, g: 138, b: 58,  k: 0.42 };   // HOT — orange
    return null;                                                // COMBO — brand crimson (default)
  }
  // build13 DEPTH: the guitar grounds against the (now brighter) backdrop via a CONTACT SHADOW —
  // its own blurred silhouette drawn behind it. Cached per image (rebuilt on skin swap); warm
  // near-black (#070403), never grey/blue. Skipped under fxLite.
  let _shadowCv = null, _shadowKey = '';
  function _guitarShadow() {
    const img = activeGuitarImg;
    if (!img || !img._ready || !img.width) return null;
    const key = (img.src || 'def') + '|' + img.width;
    if (_shadowCv && _shadowKey === key) return _shadowCv;
    try {
      const pad = Math.max(24, Math.round(img.width * 0.085));
      const c = document.createElement('canvas');
      c.width = img.width + pad * 2; c.height = img.height + pad * 2;
      const x2 = c.getContext('2d');
      x2.filter = 'blur(' + Math.max(10, Math.round(img.width * 0.03)) + 'px)';
      x2.drawImage(img, pad, pad);
      x2.filter = 'none';
      x2.globalCompositeOperation = 'source-in';
      x2.fillStyle = '#070403';
      x2.fillRect(0, 0, c.width, c.height);
      c._pad = pad;
      _shadowCv = c; _shadowKey = key;
      return c;
    } catch (e) { return null; }
  }
  function _stopReadyRings() { if (_readyRings) { for (let i = 0; i < _readyRings.length; i++) { const h = _readyRings[i]; if (h) { try { h.stop(); } catch (e) {} } } _readyRings = null; } }
  function _stopHoldFx(i) { const h = _holdFxL[i]; if (h) { try { h.stop(); } catch (e) {} _holdFxL[i] = null; } }

  // ---------- RESULTS CELEBRATION (build8c) — a DOM-side FX surface over #results ----------
  // The in-game layer draws on #hwy, which the results screen covers — so celebrations get their own
  // FxPlayer instance + a transparent canvas over the results card. Spawns ride setTimeout (not rAF)
  // so the schedule holds even when rAF is throttled; the rAF loop only draws + self-terminates.
  // reduceMotion → skipped; fxLite → fewer bursts. Pure visual.
  let fxUi = null, _celCanvas = null, _celRaf = 0, _celGen = 0;
  function _bootFxUi() {
    try {
      if (fxUi || !window.FxPlayer) return;
      window.FxPlayer.load('assets/fx/manifest.json').then(function (p) { alphaKeySheets(p); fxUi = p; }).catch(function () {});
    } catch (e) {}
  }
  function celebrateResults(accPct, grade) {
    try {
      if (reduceMotion) return;
      _bootFxUi();
      const scr = $('results'); if (!scr) return;
      if (!_celCanvas) {
        _celCanvas = document.createElement('canvas');
        _celCanvas.id = 'results-fx';
        _celCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;';
        scr.appendChild(_celCanvas);
      }
      const dpr2 = Math.min(2, window.devicePixelRatio || 1);
      const W = scr.clientWidth || window.innerWidth, H = scr.clientHeight || window.innerHeight;
      _celCanvas.width = Math.max(1, Math.floor(W * dpr2)); _celCanvas.height = Math.max(1, Math.floor(H * dpr2));
      const cx2 = _celCanvas.getContext('2d'); cx2.setTransform(dpr2, 0, 0, dpr2, 0, 0);
      const gen = ++_celGen;
      const k = Math.min(W, H) / 560;                      // size bursts to the card (128px native cells)
      const big = grade === 'S' || grade === 'A';
      const n = fxLite ? 3 : (big ? 7 : 5);
      let lastT = 0;
      for (let i = 0; i < n; i++) {
        const p = { t: 150 + i * 260, name: (i % 2) ? 'firework-gold' : 'confetti-pop',
          x: W * (0.2 + Math.random() * 0.6), y: H * (0.14 + Math.random() * 0.3), s: (1.2 + Math.random() * 0.6) * k };
        lastT = p.t;
        setTimeout(function () { if (gen === _celGen && fxUi) { try { fxUi.play(p.name, p.x, p.y, { scale: p.s }); } catch (e) {} } }, p.t);
      }
      // grade-up / new-best flare: the badge is inserted async (catalog layer) — check for it at ~1s
      setTimeout(function () {
        try {
          if (gen !== _celGen || !fxUi) return;
          const b = scr.querySelector('#results-badges .rbadge.gradeup, #results-badges .rbadge.newbest');
          if (!b) return;
          const r = b.getBoundingClientRect(), sr = scr.getBoundingClientRect();
          fxUi.play('gradeup-flare', (r.left - sr.left) + r.width / 2, (r.top - sr.top) + r.height / 2, { scale: 1.5 * k });
        } catch (e) {}
      }, 1000);
      const t0 = performance.now();
      if (_celRaf) cancelAnimationFrame(_celRaf);
      (function frame(now) {
        if (gen !== _celGen) return;                       // superseded by a newer celebration
        const el = now - t0;
        cx2.clearRect(0, 0, W, H);
        const live = fxUi ? fxUi.draw(cx2, now) : 0;
        if ((live > 0 || el < lastT + 1400) && el < 9000) { _celRaf = requestAnimationFrame(frame); }
        else { cx2.clearRect(0, 0, W, H); _celRaf = 0; }
      })(t0);
    } catch (e) {}
  }

  // build109 s1: generic celebration burst over an ARBITRARY element (not just #results) — same fxUi/
  // FxPlayer machinery as celebrateResults, own canvas + generation counter so it can run independently
  // (e.g. the MP winner card, which lives on a different screen than solo results). reuse, not rebuild.
  let _cel2Canvas = null, _cel2Raf = 0, _cel2Gen = 0;
  function fireCelebrationOn(targetEl, opts) {
    try {
      if (reduceMotion) return;
      _bootFxUi();
      const scr = targetEl; if (!scr) return;
      const host = scr;
      const gen = ++_cel2Gen;   // claim the generation up front so a stopCelebration / newer burst supersedes us even during the deferral below
      const _go = function () {
        if (gen !== _cel2Gen) return;   // superseded before we ran
        if (!_cel2Canvas || _cel2Canvas.parentNode !== host) {
          if (_cel2Canvas && _cel2Canvas.parentNode) { try { _cel2Canvas.parentNode.removeChild(_cel2Canvas); } catch (e) {} }
          _cel2Canvas = document.createElement('canvas');
          _cel2Canvas.id = 'mp-cel-fx';
          _cel2Canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:9;';
          const cs = window.getComputedStyle(host);
          if (cs && cs.position === 'static') host.style.position = 'relative';
          host.appendChild(_cel2Canvas);
        }
        const dpr2 = Math.min(2, window.devicePixelRatio || 1);
        const _r = scr.getBoundingClientRect();
        const W = Math.round(_r.width) || scr.clientWidth || window.innerWidth, H = Math.round(_r.height) || scr.clientHeight || window.innerHeight;
        _cel2Canvas.width = Math.max(1, Math.floor(W * dpr2)); _cel2Canvas.height = Math.max(1, Math.floor(H * dpr2));
        const cx2 = _cel2Canvas.getContext('2d'); cx2.setTransform(dpr2, 0, 0, dpr2, 0, 0);
        const k = Math.min(W, H) / 560;
        const n = fxLite ? 3 : Math.max(1, (opts && opts.count) || 5);
        const stagger = (opts && opts.stagger) || [150, 260];
        let lastT = 0;
        for (let i = 0; i < n; i++) {
          const p = { t: stagger[0] + i * stagger[1], name: (i % 2) ? 'firework-gold' : 'confetti-pop',
            x: W * (0.2 + Math.random() * 0.6), y: H * (0.14 + Math.random() * 0.3), s: (1.2 + Math.random() * 0.6) * k };
          lastT = p.t;
          setTimeout(function () { if (gen === _cel2Gen && fxUi) { try { fxUi.play(p.name, p.x, p.y, { scale: p.s }); } catch (e) {} } }, p.t);
        }
        const t0 = performance.now();
        if (_cel2Raf) cancelAnimationFrame(_cel2Raf);
        (function frame(now) {
          if (gen !== _cel2Gen) return;
          const el = now - t0;
          cx2.clearRect(0, 0, W, H);
          const live = fxUi ? fxUi.draw(cx2, now) : 0;
          if ((live > 0 || el < lastT + 1400) && el < 9000) { _cel2Raf = requestAnimationFrame(frame); }
          else { cx2.clearRect(0, 0, W, H); _cel2Raf = 0; }
        })(t0);
      };
      // build109 s4 review: the MP winner card is unhidden a few lines AFTER this call in the SAME synchronous
      // showWinner() pass, so at call time it's still display:none → clientWidth/Height are 0 → the old code fell
      // back to window.innerWidth/Height and sized the burst to the FULL WINDOW, which then rendered squeezed and
      // off-center inside the small ~200px card. Measure via getBoundingClientRect; if the target isn't laid out
      // yet, defer one frame (by then step('winner') has run and the card has a real box). Immediate when visible.
      const _r0 = scr.getBoundingClientRect();
      if ((_r0.width | 0) > 0 && (_r0.height | 0) > 0) _go();
      else requestAnimationFrame(_go);
    } catch (e) {}
  }
  function stopCelebrationOn() {
    _cel2Gen++;
    if (_cel2Raf) { cancelAnimationFrame(_cel2Raf); _cel2Raf = 0; }
    if (_cel2Canvas) { try { const cx2 = _cel2Canvas.getContext('2d'); cx2.clearRect(0, 0, _cel2Canvas.width, _cel2Canvas.height); } catch (e) {} }
  }

  // VISUAL-ONLY: register a miss/break for the feedback FX (vignette + lane desat + recoil + mass-fail).
  // Does NOT touch combo/score/stability — call it ALONGSIDE the existing miss logic.
  function registerMissFx(lane) {
    // LEVEL FX hook (optional; e.g. the Skully Death card). Fires regardless of motion settings. No-op otherwise.
    try { if (window.RhythmLevelFx && window.RhythmLevelFx.onMiss) window.RhythmLevelFx.onMiss(lane); } catch (e) {}
    if (reduceMotion && fxLite) return;                 // both off → no juice at all
    missFlash = Math.min(1, missFlash + 0.85);
    if (typeof lane === 'number' && lane >= 0 && lane < laneDesat.length) {
      laneDesat[lane] = 1;
      catcherRecoil[lane] = 1;
    }
    const nowMs = performance.now();
    missTimes.push(nowMs);
    if (missTimes.length > 8) missTimes.shift();
    const recent = missTimes.filter((m) => nowMs - m < 1200).length;
    const tSec = nowMs / 1000;
    const trigger = (recent >= 3) || (stability > 0 && stability < 0.28);
    if (trigger && tSec - lastWipeout > 2.2) { lastWipeout = tSec; fireWipeout(); }
  }
  // VISUAL-ONLY: the "wipeout" surge — strong shake, crimson surge, strings go cold, combo-break burst.
  function fireWipeout() {
    if (reduceMotion) { wipeoutT = Math.max(wipeoutT, 0.5); missFlash = Math.min(1, missFlash + 0.4); return; }
    wipeoutT = 1; stringsCold = 1;
    missFlash = Math.min(1.4, missFlash + 0.6);
    cameraShake = Math.max(cameraShake, 18);
    glitchAmount = Math.min(1, glitchAmount + 0.35);
    if (!fxLite) {
      try {
        const _fg = fretGeom();
        for (let i = 0; i < LANE_COUNT; i++) {
          particles.push({ ring: true, x: _fg.nearX[i], y: _fg.nearY, age: 0, life: 0.5, color: '150,28,32', max: 120 });
          emitFx('wipeout', 'wipe', i, _fg.nearX[i], _fg.nearY);   // build8c: glass-shatter across the board
        }
      } catch (e) {}
    }
    if (navigator.vibrate) { try { navigator.vibrate([22, 40, 22]); } catch (e) {} }
  }
  // G-1: record a miss/drop at its SONG-TIME (sec) so results can cluster the worst window. Alloc-light (one number
  // pushed), fully guarded, and never read by scoring — a pure results-screen signal. Capped so a pathological
  // all-miss run can't grow this unbounded.
  function _g1Miss(tSec) { try { if (typeof tSec === 'number' && isFinite(tSec) && _g1MissTimes.length < 2000) _g1MissTimes.push(tSec); } catch (e) {} }

  function missNote(note) {
    note.judged = true; note.hit = 'miss';
    _phraseVoid(note);   // A2 STARSTRUCK (dark unless rr_odphrase tagged phrases): a missed member voids its star-phrase — NO-OP when untagged; never scores

    // build148 T1 FLOW SHIELD: while Overdrive is LIVE, a missed note does NOT break your combo — it burns ~25%
    // of the OD meter (≈2s of OD time) instead. Bombs are never shielded (they resolve on the bomb path, which keeps
    // its own combo reset). The note still scores 0 and still counts as a miss for accuracy (accW 0), so momentum
    // survives but the run isn't free — and a perfect FC never triggers it, so the score ceiling is untouched.
    if (odActive && odTimer > 0) {
      counts.miss++;                                       // accuracy still takes the hit (no combo reset below runs — we return)
      _g1Miss(note.time);                                  // G-1: a shielded miss still marks a trouble spot
      _flowShieldCount++;
      odTimer = Math.max(0, odTimer - OD_DURATION * FLOW_SHIELD_COST);
      overdrive = odTimer / OD_DURATION;                   // keep the OD meter render in sync this frame
      if (odTimer <= 0) { odActive = false; overdrive = 0; try { _odTally(); } catch (e) {} }   // the shield drained the last of Overdrive · Wave-3 finding 2: tally this window too (render/stats only)
      _rfPush(note.lane, 'm');                             // opponent still sees the missed note in the versus stream
      registerMissFx(note.lane);                           // the missed string still flashes...
      if (note.lane >= 0 && note.lane < laneDesat.length) laneDesat[note.lane] = Math.min(laneDesat[note.lane], 0.5);   // FIX1: shielded string only HALF-dims (a SAVE, not a dead string); Math.min avoids adding desat when a11y already suppressed registerMissFx
      playShieldSaveSfx();                                 // build157: SAVED plays the real "coin-catch" sample (falls back to the OD ignite spark if unloaded); NOT the miss squelch; spawnMissDud dropped
      _armJudgePriority(420);
      flashJudgment('◆ SAVED', '#e0a93f');                 // ...but the combo LIVES — a crimson-gold dopamine beat, not a mercy
      _tlog('flow_shield', { lane: note.lane, combo: combo, odLeft: +overdrive.toFixed(3), shields: _flowShieldCount });   // T9
      updateHUD();
      return;                                              // combo / comboTierCur deliberately NOT reset
    }
    // build60 FEEL: how big was the streak that just died? (peak of the streak, tracked pre-zero.) A high break
    // hurts more, so the feedback escalates. `combo` is the count still live at entry; _peakCombo is its high.
    const _brokePeak = Math.max(combo, _peakCombo);
    const _bigBreak = _brokePeak >= 50;   // escalate only when a real streak was lost — low-combo misses stay identical
    // build122 p1 CLUTCH: snapshot the streak's peak before it zeroes, arm the recovery gate if it
    // qualifies (>=25). Observational only — does not affect scoring.
    if (_peakCombo >= CLUTCH_MIN_BREAK_PEAK) { _lastBreakPeak = _peakCombo; _clutchArmed = true; } else { _clutchArmed = false; }
    _peakCombo = 0;
    counts.miss++; combo = 0; comboTierCur = 0;
    _g1Miss(note.time);        // G-1: mark this miss's song-time for the trouble-section detector
    _rfPush(note.lane, 'm');   // versus stream
    // music stays at FULL level (no ducking) — the miss is signalled by the squelch SFX +
    // a dull "dud" spatter on the missed string (Guitar-Hero "clam" feel).
    stability = Math.max(0, stability - bossDrain(0.04));
    glitchAmount = Math.min(1, glitchAmount + (_bigBreak && !reduceMotion ? 0.20 : 0.10));   // build60: a big break glitches harder (motion-gated)
    cameraShake = Math.max(cameraShake, _bigBreak && !reduceMotion ? 9 : 4);                 // build60: and shakes harder
    registerMissFx(note.lane);
    // build60: a heavier crimson screen flash on a big break (motion; matches registerMissFx's reduce-motion gate — it's off when both a11y flags are set)
    if (_bigBreak && !(reduceMotion && fxLite)) missFlash = Math.min(1.5, missFlash + 0.5);
    playMissSfx(_bigBreak);   // heavier squelch on a big break (audio — mute/mixer-gated inside)
    spawnMissDud(note.lane);
    emitFx('miss', 'miss', note.lane);
    if (_bigBreak) {
      // a distinct, EARNED-loss callout + protect it from the next note's plain GREAT (see finding-4 ceremony guard)
      _armJudgePriority(450);
      flashJudgment('STREAK BROKEN', '#ff1f2e');
    } else {
      flashJudgment('MISS', '#ff1f2e');
    }
    updateHUD();
  }
  // a dull downward spatter + dead-string snap where a note was missed (no bright burst)
  function spawnMissDud(lane) {
    const _fg = fretGeom(); const x = _fg.nearX[lane], y = _fg.nearY;
    for (let i = 0; i < 9; i++) {
      const ang = Math.PI / 2 + (Math.random() - 0.5) * 1.1;   // downward fan
      const spd = 80 + Math.random() * 150;
      particles.push({ x: x + (Math.random() - 0.5) * 14, y: y,
        vx: Math.cos(ang) * spd, vy: Math.abs(Math.sin(ang)) * spd * 0.7 + 40,
        life: 0.32 + Math.random() * 0.24, age: 0, size: 1.4 + Math.random() * 2,
        color: Math.random() < 0.5 ? '120,22,26' : '64,14,18', spark: true });
    }
    particles.push({ ring: true, x: x, y: y, age: 0, life: 0.28, color: '150,30,34', max: 58 });
    lanePluckT[lane] = 9;   // the string goes dead (kills its glow/vibration)
  }

  // build65 (VFX 2.0): a layered, SHAPED, perspective hit burst driven by the level's KIT. Five layers stack so
  // the hit reads as a real event (not one dab): core flash → shockwave ring(s) → vertical lane lift → the kit's
  // signature SHAPED burst (with a toward-camera "3D pop" share) → fine sparkle dust → a lingering SETTLE trail.
  function spawnHitParticles(lane, kind) {
    _rfPush(lane, kind === 'perfect' ? 'p' : 'g');   // versus stream (every hit routes here)
    const _fg = fretGeom(); const laneX = _fg.nearX[lane]; const hitY = _fg.nearY; const lw = _fg.lw;
    const isPerfect = kind === 'perfect', isGreat = kind === 'great';
    const I = isPerfect ? 1 : isGreat ? 0.7 : 0.45;     // intensity 0..1
    const k = _hitKit();
    const lite = fxLite;
    const calm = reduceMotion;                          // build65 (cycle-3) a11y: reduce-motion tames the motion-heavy extras like lite does (no 3D fly-at-camera pop, no rainbow spray, no dust, single ring)
    const reduced = lite || calm;
    const cb = Math.min(1, combo / 60);                 // build65: COMBO ramp (reachable 0..60 range) — every hit ESCALATES as your streak climbs (the "hitting a combo feels the same" fix)
    const rainbow = (combo >= RAINBOW_COMBO || odActive) && !reduced;  // earned RAINBOW burst on a big streak / in Overdrive (shared gate with the strings); off under reduce-motion/lite
    // ── L1 CORE FLASH — the sharpest, brightest single beat of impact (crisp additive disc)
    particles.push({ flash: true, x: laneX, y: hitY, age: 0, life: isPerfect ? 0.12 : 0.09, color: k.core, max: lw * (isPerfect ? 0.7 : isGreat ? 0.55 : 0.42) });
    // build60 FEEL: PERFECT keeps its word suppressed, but earns a distinct NON-VERBAL signature — a tighter,
    // WHITE-HOT core spike layered over the (possibly kit-tinted) core disc, so a PERFECT reads crisper than a
    // GREAT at a glance. On-brand white-hot; a single short additive flash (like L1 itself → drawn even under
    // reduce-motion, since it's a crisp beat, not ambient motion).
    if (isPerfect) particles.push({ flash: true, x: laneX, y: hitY, age: 0, life: 0.10, color: '255,252,240', max: lw * 0.5 });
    // ── L2 SHOCKWAVE ring(s) — perfects double up to "crack"
    particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.45, color: k.ring, max: lw * (0.85 + 0.55 * I) });
    if (isPerfect && !reduced) {
      particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.6,  color: '255,255,255', max: lw * 1.5 });
      particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.55, color: k.ring,         max: lw * 2.4 });
    }
    // ── L2b vertical ENERGY LIFT up the lane
    particles.push({ column: true, x: laneX, y: hitY, age: 0, life: 0.32, color: k.prim[0], w: lw });
    // ── L3 primary SHAPED burst — a share erupt TOWARD THE CAMERA (grow + fall down the neck = fake-3D pop)
    const n = reduced ? Math.round(4 + 6 * I) : Math.round((9 + 15 * I) * (1 + 0.45 * cb));   // more particles as the streak grows; reduce-motion/lite → small
    for (let i = 0; i < n; i++) {
      const toward = !reduced && Math.random() < (0.42 + 0.22 * cb);   // more 3D-pops at high combo; none under reduce-motion/lite
      // build65 (cycle-3): NARROWER upward cone + extra horizontal spread so the per-hit spray clears the central gem
      // READ-PATH fast (don't occlude incoming notes). The toward-camera pops fall down-and-out; the rest fan out sideways.
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (0.82 + 0.45 * I);
      const spd = (120 + Math.random() * 300) * (0.8 + 0.55 * I);
      const big = k.shape === 'glob' ? 5.5 + Math.random() * 7 : k.shape === 'paw' ? 5 + Math.random() * 5 : 2.6 + Math.random() * 4.2;
      particles.push({
        kit: true, shape: k.shape, x: laneX + (Math.random() - 0.5) * lw * 0.5, y: hitY,
        vx: Math.cos(ang) * spd * (toward ? 0.6 : 1.4),
        vy: toward ? (70 + Math.random() * 150) : (k.dir > 0 ? -Math.abs(Math.sin(ang)) * spd * 0.6 : Math.sin(ang) * spd),
        grav: k.dir > 0 ? k.grav : k.grav * (toward ? 1.1 : 0.7),
        z: 0, vz: toward ? (1.5 + Math.random() * 1.8) : (0.15 + Math.random() * 0.4), grow: toward,
        rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 9,
        size: big * (0.85 + 0.5 * I) * (1 + 0.22 * cb), life: 0.5 + Math.random() * 0.55, age: 0,
        color: Math.random() < 0.55 ? k.prim[0] : k.prim[1], add: k.add, glow: k.glow
      });
    }
    // ── L4 fine sparkle DUST — bright fast sizzle (always additive)
    if (!reduced) {
      const nd = Math.round(4 + 7 * I);
      for (let i = 0; i < nd; i++) {
        const a2 = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25, s2 = 170 + Math.random() * 360;   // build65 (cycle-3): tighter cone — dust clears the read-path faster
        particles.push({ x: laneX + (Math.random() - 0.5) * lw * 0.4, y: hitY, vx: Math.cos(a2) * s2, vy: Math.sin(a2) * s2,
          grav: 0.7, life: 0.28 + Math.random() * 0.3, age: 0, size: 0.8 + Math.random() * 1.6, color: k.dust, spark: true });
      }
    }
    // ── L4b earned RAINBOW spray — fires only at a big combo / in Overdrive (the streak payoff: hits go technicolor)
    if (rainbow) {
      const base = performance.now() / 1000, nr = isPerfect ? 6 : 4;
      for (let i = 0; i < nr; i++) {
        const phq = Math.round(((base * 0.5 + i / nr) % 1) * 12) / 12;   // build65 (cycle-3): QUANTIZE the warm-rainbow hue to 12 buckets so the cached _glowSprite keys stay BOUNDED (was a unique color per particle → unbounded offscreen-canvas leak across a session)
        const rgb = _hsv((0.90 + phq * 0.25) % 1, 0.85, 1), ra = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1, rs = 150 + Math.random() * 320;   // build65: warm-biased rainbow spray (on-brand, no blue/purple)
        const rc = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
        particles.push({ kit: true, shape: 'glint', x: laneX + (Math.random() - 0.5) * lw * 0.5, y: hitY,
          vx: Math.cos(ra) * rs, vy: Math.sin(ra) * rs, grav: 0.4, z: 0, vz: 0.3, grow: false, rot: 0, vrot: 0,
          size: 2.4 + Math.random() * 3, life: 0.5 + Math.random() * 0.45, age: 0, color: rc, add: true, glow: rc });
      }
    }
    // ── L5 SETTLE — the kit's lingering afterglow (its signature)
    if (!reduced) _emitSettle(k, laneX, hitY, I, lw);
    if (isPerfect) bgPulse = Math.max(bgPulse, 0.42);   // gentle frame breath on a perfect (never a strobe)
  }

  // L5 — the slow, low-count "afterlife" of a hit. This is what makes a level FEEL like itself between hits:
  // crimson/ember rise as embers, horror oozes blood DRIPS, Melody floats a HEART, Skully trails violet WISPS.
  function _emitSettle(k, x, y, I, lw) {
    const s = k.settle;
    if (s === 'ember') {
      for (let i = 0; i < 2 + (I > 0.8 ? 1 : 0); i++)
        particles.push({ kit: true, shape: 'ember', x: x + (Math.random() - 0.5) * 18, y: y - Math.random() * 6,
          vx: (Math.random() - 0.5) * 26, vy: -28 - Math.random() * 40, grav: 0.12, z: 0, vz: 0.1, glow: k.glow,
          rot: 0, vrot: 0, size: 1.6 + Math.random() * 2, life: 0.9 + Math.random() * 0.7, age: 0, color: k.prim[Math.random() < 0.5 ? 0 : 1], add: true });
    } else if (s === 'drip') {
      for (let i = 0; i < 3; i++)
        particles.push({ kit: true, shape: 'glob', x: x + (Math.random() - 0.5) * lw * 0.4, y: y, vx: (Math.random() - 0.5) * 14,
          vy: 18 + Math.random() * 26, grav: 2.4, z: 0, vz: 0, rot: 0, vrot: 0, size: 3 + Math.random() * 3.5,
          life: 0.8 + Math.random() * 0.6, age: 0, color: k.prim[Math.random() < 0.5 ? 0 : 1], add: false, glow: k.glow });
    } else if (s === 'heart') {
      particles.push({ kit: true, shape: 'heart', x: x + (Math.random() - 0.5) * 14, y: y - 4, vx: (Math.random() - 0.5) * 16,
        vy: -42 - Math.random() * 28, grav: 0.18, z: 0, vz: 0.2, grow: true, rot: 0, vrot: 0, size: 5 + Math.random() * 3,
        life: 0.95, age: 0, color: '255,110,170', add: true, glow: '255,120,180' });
    } else if (s === 'wisp') {
      for (let i = 0; i < 2; i++)
        particles.push({ kit: true, shape: 'wisp', x: x + (Math.random() - 0.5) * 16, y: y, vx: (Math.random() - 0.5) * 20,
          vy: -36 - Math.random() * 36, grav: 0.1, z: 0, vz: 0.12, rot: 0, vrot: (Math.random() - 0.5) * 3, size: 3 + Math.random() * 2.4,
          life: 0.9 + Math.random() * 0.6, age: 0, color: k.prim[0], add: true, glow: k.glow });
    } else {   // 'mote' / 'smoke'
      for (let i = 0; i < 2; i++)
        particles.push({ kit: true, shape: s === 'smoke' ? 'smoke' : 'mote', x: x + (Math.random() - 0.5) * 20, y: y - Math.random() * 6,
          vx: (Math.random() - 0.5) * 24, vy: -22 - Math.random() * 30, grav: s === 'smoke' ? -0.05 : 0.12, z: 0, vz: 0.08,
          rot: 0, vrot: 0, size: s === 'smoke' ? 6 + Math.random() * 6 : 1.6 + Math.random() * 1.8, life: 0.9 + Math.random() * 0.7, age: 0,
          color: s === 'smoke' ? '150,140,136' : k.dust, add: true, glow: k.glow });
    }
  }

  // light sparks streaming off the catcher while a sustain is held
  function spawnSustainSpark(lane) {
    const _fg = fretGeom(); const x = _fg.nearX[lane], y = _fg.nearY; const color = LANE_COLORS[lane];
    for (let i = 0; i < 3; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
      const spd = 120 + Math.random() * 180;
      particles.push({ x: x + (Math.random() - 0.5) * _fg.lw * 0.5, y: y,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: 0.3 + Math.random() * 0.25, age: 0, size: 1 + Math.random() * 2,
        color: color.rgb, spark: true });
    }
  }

  let _lastRealJudgeMs = -1e9;   // build89: timestamp of the last NON-whiff judgment, so a whiff dash can't clobber a real hit's callout
  // build60 FEEL: CEREMONY PROTECTION. Every callout funnels through the one #judge-flash element, so on a dense
  // chart a big EARNED callout (GOLDEN MODE!!, OVERDRIVE READY, CLUTCH ×N, N STREAK) was overwritten by the very
  // next note's GREAT within a frame. Ceremonial call sites arm _judgePriorityUntil; while it's in the future,
  // flashJudgment refuses to overwrite with a PLAIN per-note judgment (GREAT/GOOD/whiff dash). A MISS still
  // interrupts (losing your combo must show). Pure display gate — no scoring/timing effect.
  let _judgePriorityUntil = 0;
  function _armJudgePriority(ms) { try { _judgePriorityUntil = performance.now() + (ms || 450); } catch (e) {} }
  function flashJudgment(text, color, isWhiff, plain) {
    // plain = a low-priority per-note judgment (GREAT/GOOD) or the whiff dash — must not stomp a live ceremony
    if ((plain || isWhiff) && performance.now() < _judgePriorityUntil) return;
    if (!isWhiff) _lastRealJudgeMs = performance.now();
    const el = $('judge-flash');
    el.textContent = text; el.style.color = color;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  // ---- A2 STARSTRUCK runtime (Wave-4b) — DARK behind rr_odphrase. All three are byte-identical NO-OPS when the note
  // carries no phraseId (the only state a flag-OFF chart ever has), so flag-OFF play is unchanged. A completed phrase
  // fires a callout + gold burst through the EXISTING flashJudgment / spawnHitParticles / emitFx helpers — no new FX
  // path, and CRUCIALLY no score / Overdrive charge / multiplier (the ceremony IS the reward; OD stays per-note).
  function _phraseCredit(note) {
    if (!note || note.phraseId == null) return;                 // no phrase tag → nothing to do (flag-OFF path)
    const id = note.phraseId;
    if (_phraseDone[id]) return;                                // already fired or already voided
    _phraseHit[id] = (_phraseHit[id] || 0) + 1;
    if (_phraseHit[id] >= (note.phraseLen || Infinity)) { _phraseDone[id] = true; _fireStarstruck(note.lane); }
  }
  function _phraseVoid(note) {
    if (!note || note.phraseId == null) return;                 // no phrase tag → nothing to void (flag-OFF path)
    const id = note.phraseId;
    if (_phraseDone[id]) return;
    _phraseDone[id] = true;                                     // missing ANY member silently voids it — no callout, no punishment
  }
  function _fireStarstruck(lane) {
    try {
      _armJudgePriority(520);                                   // protect the ceremony from the next plain GREAT
      flashJudgment('★ STARSTRUCK', '#ffd98a');                 // brand gold, existing callout system
      if (typeof lane === 'number' && lane >= 0) { try { spawnHitParticles(lane, 'perfect'); emitFx('star', 'perfect', lane); } catch (e) {} }   // gold burst via existing helpers
      try { comboGlow = 1; } catch (e) {}                       // flare the strings gold (cosmetic; existing var)
    } catch (e) {}
  }
  // tiny EARLY / LATE hint under the judgment popup. _signed > 0 = LATE, < 0 = EARLY (seconds).
  // Perfects are dead-on → no tick. Suppressed when the hint setting is off. NEVER affects scoring.
  let timingHint = true;
  try { const th = localStorage.getItem('rr_timinghint'); if (th === '0') timingHint = false; } catch (e) {}
  function flashTiming(kind, signed) {
    const el = $('timing-tick'); if (!el) return;
    if (!timingHint || kind === 'perfect') { el.classList.remove('show'); return; }
    const late = signed > 0;
    const ms = Math.round(Math.abs(signed) * 1000);
    el.textContent = late ? ('LATE ◂ ' + ms + 'ms') : ('▸ EARLY ' + ms + 'ms');
    el.style.color = late ? '#dad7d2' : '#ff7a4a';   // chrome = late, ember = early (brand)
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  // ---------- v254: MP COMBAT — a rival's combo shock stuns your inputs ~2s (P-vs-P mode) ----------
  // multiplayer.js calls mpStun() on an incoming 'shock' and mpShockSent() when YOUR combo fires one. Stun gates
  // onLaneInput (notes pass → you bleed combo/score = the "damage"). reduceMotion still stuns (it's gameplay, not chrome).
  // build116 p1: canvas payoff for TAKING a combat shock — the same jagged-bolt strike the combo-milestone uses
  // (lightningT), but its own timer (lightningHitT) + a crimson tint so it reads as "incoming damage," not "your
  // streak." Gated by reduce-motion same as the sender-side _spawnZapBolt in multiplayer.js.
  window.RhythmGame.mpZapHit = () => {
    if (reduceMotion) return;
    lightningHitT = 0.55;
  };
  window.RhythmGame.mpStun = (sec, fromName) => {
    if (state !== 'playing') return;
    const ms = Math.max(800, Math.min(3500, (sec || 2.2) * 1000));
    _mpStunUntil = performance.now() + ms;
    cameraShake = Math.max(cameraShake, 16);
    try { window.RhythmGame.mpZapHit(); } catch (e) {}   // build116 p1: the victim sees the jagged-bolt canvas strike too, not just the input freeze
    try { playZapSfx(true); } catch (e) {}   // v257: an electric ZAP when a rival shocks you
    try { if (navigator.vibrate) navigator.vibrate([30, 50, 30, 50, 80]); } catch (e) {}
    try {
      const el = document.getElementById('mp-stun');
      if (el) {
        el.setAttribute('aria-hidden', 'false');   // v258 a11y: expose the veil so its role=alert .stun-who announces the input freeze
        const who = el.querySelector('.stun-who'); if (who) who.textContent = (fromName ? String(fromName).slice(0, 14) + ' ' : 'RIVAL ') + 'SHOCKED YOU';
        el.style.setProperty('--stun-dur', (ms / 1000) + 's');
        el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
        clearTimeout(_stunHideT); _stunHideT = setTimeout(() => { el.classList.remove('show'); el.setAttribute('aria-hidden', 'true'); }, ms);
      }
    } catch (e) {}
  };
  window.RhythmGame.mpShockSent = () => { try { flashJudgment('⚡ ZAPPED RIVAL', '#ffe08a'); playZapSfx(false); } catch (e) {} };
  window.RhythmGame.setTimingHint = (on) => { timingHint = !!on; try { localStorage.setItem('rr_timinghint', on ? '1' : '0'); } catch (e) {} return timingHint; };
  window.RhythmGame.setTimingFeel = (f) => { if (f === 'tight' || f === 'classic') { timingFeel = f; try { localStorage.setItem('rr_timing', f); } catch (e) {} } return timingFeel; };
  window.RhythmGame.getTimingFeel = () => timingFeel;
  // Variety system on/off mirrors the existing ?notes flag (one source of truth).
  window.RhythmGame.getNoteVariety = () => noteVariety;
  window.RhythmGame.setNoteVariety = (on) => (typeof window.__rrNoteVariety === 'function') ? window.__rrNoteVariety(on) : noteVariety;

  // ---------- HUD ----------
  // build51: SCORE JUICE — pop the HUD score on scoring milestones (combo streaks, overdrive). The number
  // already rolls up (scoreDisplay); this adds a scale+glow punch so big moments READ. big=true → bigger gold pop.
  function _scorePop(big) {
    try {
      const el = $('hud-score'); if (!el) return;
      el.classList.remove('pop', 'pop-big'); void el.offsetWidth;   // restart the CSS animation
      el.classList.add(big ? 'pop-big' : 'pop');
    } catch (e) {}
  }
  // build60 FEEL: SUBTLE per-hit combo tick. On every successful hit the combo number gives a small 1→1.08→1
  // scale pop (~120ms) so the count reads as ALIVE, without stealing thunder from the rare tier milestone
  // (that's the much bigger `tierpop` on #combo-display). Fully self-contained (inline transform + a self-driven
  // transition → no index.html CSS needed, works in the older desktop engine). reduce-motion → no-op. Never
  // fires on a miss (only the hit path calls it). Wrapped so it can never throw into the scoring/render loop.
  let _comboTickTok = 0;
  function _comboTick() {
    if (reduceMotion) return;
    try {
      const el = $('combo-num'); if (!el) return;
      const tok = ++_comboTickTok;
      el.style.transition = 'none';
      el.style.transform = 'scale(1.08)';
      void el.offsetWidth;                                   // commit the jump before the ease-back
      requestAnimationFrame(() => {
        if (tok !== _comboTickTok) return;                   // a newer tick superseded this one — let it drive
        el.style.transition = 'transform 120ms cubic-bezier(0.2,0.7,0.3,1)';
        el.style.transform = 'scale(1)';
      });
    } catch (e) {}
  }
  // build102y step6: BEAT THAT ghost target — DISPLAY-ONLY (a gold HUD pill + one BEAT IT! flash). Zero scoring
  // interaction: nothing but updateHUD ever reads it. catalog.launchTrack sets it on ghost-duel launches and
  // NULLS it on every plain launch (so a stale target can never leak into an unrelated run); endGame clears it
  // too — the target lives for exactly one run.
  let _ghostTarget = null, _ghostBeat = false;
  window.RhythmGame.setGhostTarget = function (t) {
    // build102y review fix H: the score originates from PEER final broadcasts — require a FINITE positive integer
    // and clamp (a hostile {score:1e999} → Infinity passed the old >0 guard → '∞' on the pill and an unwinnable
    // ghost whose BEAT IT! could never fire). Display-only either way; junk collapses to null (no target).
    var _gs = t ? Math.floor(+t.score) : 0;
    _ghostTarget = (Number.isFinite(_gs) && _gs > 0) ? { score: Math.min(_gs, 99999999), name: String((t && t.name) || 'RIVAL').slice(0, 14) } : null;
    _ghostBeat = false;
    if (!_ghostTarget) { try { const _ge = $('ghost-target'); if (_ge) _ge.remove(); } catch (e) {} }
  };
  function updateHUD() {
    // build70 (launch-audit P3): null-guard the early HUD dereferences (its second half already does) so a
    // missing id after the /play markup move can't throw inside the rAF loop and kill the frame.
    const _hs = $('hud-score'); if (_hs) _hs.textContent = Math.floor(scoreDisplay).toLocaleString();   // animated value (loop rolls it up)
    // build102y step6: the ghost-duel target line (lazy DOM — only ghost runs pay for it)
    if (_ghostTarget) {
      let _gt = $('ghost-target');
      if (!_gt) {
        _gt = document.createElement('div'); _gt.id = 'ghost-target';
        _gt.style.cssText = "position:absolute;top:64px;left:50%;transform:translateX(-50%);z-index:60;font-family:'Chakra Petch',monospace;font-size:12px;letter-spacing:0.08em;color:#e0a93f;background:rgba(20,12,6,0.55);border:1px solid rgba(224,169,63,0.5);border-radius:999px;padding:4px 12px;pointer-events:none;white-space:nowrap;";
        const _gh = $('game'); if (_gh) _gh.appendChild(_gt); else document.body.appendChild(_gt);
      }
      if (!_ghostBeat && score >= _ghostTarget.score) { _ghostBeat = true; flashJudgment('BEAT IT! 🏆', '#ffd98a'); }
      _gt.textContent = _ghostBeat ? ('✓ BEAT ' + _ghostTarget.name + ' — ' + _ghostTarget.score.toLocaleString())
                                   : ('🎯 BEAT ' + _ghostTarget.name + ' — ' + Math.floor(score).toLocaleString() + ' / ' + _ghostTarget.score.toLocaleString());
    }
    // build85 (Phase 3.1): the instant the live run passes the stored best, flip the chip to "★ BEAT BEST"
    const _be2 = $('hud-best');
    if (_be2 && !_be2.hidden && _be2._best && score > _be2._best && !_be2.classList.contains('beaten')) { _be2.classList.add('beaten'); _be2.textContent = '★ BEAT BEST'; }
    const _hc = $('hud-combo'); if (_hc) _hc.textContent = combo;
    const _hm = $('hud-maxcombo'); if (_hm) _hm.textContent = maxCombo;
    const total = counts.perfect + counts.great + counts.good + counts.miss;
    const acc = total > 0 ? ((counts.perfect * 1.0 + counts.great * 0.85 + counts.good * 0.5) / total) * 100 : 100;
    const _ha = $('hud-acc'); if (_ha) _ha.textContent = acc.toFixed(1) + '%';
    // mobile compact HUD
    const _ms = $('m-score'); if (_ms) _ms.textContent = Math.floor(score).toLocaleString();
    const _mc = $('m-combo'); if (_mc) _mc.textContent = combo;
    const _ma = $('m-acc'); if (_ma) _ma.textContent = acc.toFixed(0) + '%';
    // live multiplier gauge — reflects the actual score multiplier (combo + overdrive)
    const _tpH = timingProf();
    const comboTier = Math.min(_tpH.comboCap, 1 + Math.floor(combo / _comboStepFor()));
    const tier = Math.min(MAX_MULT, Math.min(odActive ? _tpH.comboCap + 1 : _tpH.comboCap, odActive ? comboTier + 1 : comboTier));   // v258: clamp the HUD multiplier to MAX_MULT so the displayed tier matches the clamped score
    _rfMult = tier;   // versus stream: cache the displayed multiplier tier for getRenderFrame()
    const _cStep = _comboStepFor();
    const _atCap = combo >= _cStep * _tpH.comboCap;
    // Wave-3 finding 1 — FEVER ladder (cosmetic, driven by `combo` ONLY; NEVER a payment claim). The true xN badge
    // below still shows the honest clamped tier; this is a SEPARATE named-tier layer (COMBO/HOT/BLAZE/GOLDEN/INFERNO/
    // ASCENDANT) + progress to the next, so SOMETHING always visibly climbs past the mult cap (combo 24) → combo 500.
    const _fi = comboTierIdx(combo), _fT = COMBO_TIERS[_fi], _fNext = COMBO_TIERS[_fi + 1];
    let _feverPct, _feverTxt;
    if (_fNext) { const _span = _fNext.min - _fT.min; _feverPct = _span > 0 ? Math.max(0, Math.min(1, (combo - _fT.min) / _span)) : 1; _feverTxt = (_fi === 0 ? 'COMBO' : _fT.name) + ' · ' + _fNext.name + ' in ' + Math.max(0, _fNext.min - combo); }
    else { _feverPct = 1; _feverTxt = _fT.name + ' · MAX'; }
    // the mult-fill was PINNED at 1 once _atCap (dead past combo 24). Repoint that pinned state at next-combo-tier
    // progress so the bar keeps climbing (display math only — this bar is not a payment number).
    const within = odActive ? overdrive : (_atCap ? _feverPct : (combo % _cStep) / _cStep);
    const mb = $('mult-badge'); if (mb) { mb.textContent = tier + 'x'; if (mb.parentElement) mb.parentElement.classList.toggle('boosted', tier >= 3); }
    const mf = $('mult-fill'); if (mf) mf.style.height = (within * 100) + '%';
    // FEVER readout — lazily injected INTO the existing #mult-gauge (index.html untouched; enriches the multiplier block only).
    if (!_feverEl) { const _mg = $('mult-gauge'); if (_mg) { const w = document.createElement('div'); w.id = 'mult-fever'; w.style.cssText = "margin-top:5px;text-align:center;line-height:1.1;pointer-events:none;"; w.innerHTML = '<div id="mult-fever-txt" style="font-family:\'Chakra Petch\',sans-serif;font-size:9px;font-weight:700;letter-spacing:0.07em;white-space:nowrap;text-shadow:0 0 6px rgba(255,120,40,0.45);"></div><div style="height:3px;margin:3px auto 0;max-width:52px;border-radius:2px;background:rgba(255,255,255,0.10);overflow:hidden;"><i id="mult-fever-bar" style="display:block;height:100%;width:0%;border-radius:2px;background:linear-gradient(90deg,#ff6e46,#ffd98a);box-shadow:0 0 6px rgba(255,150,60,0.6);"></i></div>'; _mg.appendChild(w); _feverEl = w; } }
    if (_feverEl) {
      let _inVs = false; try { const _gEl = document.getElementById('game'); _inVs = !!(_gEl && _gEl.classList.contains('vs-mode')); } catch (e) {}
      _feverEl.style.display = (_inVs || combo < 1) ? 'none' : 'block';
      const _ft = $('mult-fever-txt'); if (_ft) { _ft.textContent = _feverTxt; _ft.style.color = 'rgb(' + _fT.rgb.join(',') + ')'; }
      const _fb = $('mult-fever-bar'); if (_fb) _fb.style.width = (_feverPct * 100) + '%';
    }
    // overdrive gauge
    const of = $('od-fill'); if (of) of.style.height = (overdrive * 100) + '%';
    const odReady = overdrive >= 1 && !odActive;
    // Wave-3 finding 3 — OVERCHARGE shimmer: full-meter hits that the clamp discards gild the flame past 100% (cosmetic only).
    const odf = $('od-flame'); if (odf) { odf.classList.toggle('ready', odReady); odf.style.boxShadow = (odReady && odOvercharge > 0.01) ? ('0 0 ' + Math.round(8 + odOvercharge * 22) + 'px rgba(255,' + (150 + Math.round(odOvercharge * 80)) + ',60,' + (0.4 + odOvercharge * 0.5).toFixed(2) + ')') : ''; }
    // Wave-3 finding 2 — OD READY density cue: is a dense cluster incoming? (read the sorted notes ahead of now — render only)
    let _odDense = false;
    if (odReady) { try { const _tn = songTime(); let _cnt = 0; for (let _z = 0; _z < notes.length; _z++) { const _d = notes[_z].time - _tn; if (_d < 0) continue; if (_d > 2.2) break; if (notes[_z].type !== 'bomb') _cnt++; } _odDense = _cnt >= 10; } catch (e) {} }
    // HUD Overdrive readout (the desktop-visible "hype bar") — combo-driven fill + clear CHARGING/READY/ACTIVE states
    { const odb = $('hud-od-block'); if (odb) { odb.classList.toggle('ready', odReady); odb.classList.toggle('active', odActive); }
      const odhf = $('hud-od-fill'); if (odhf) { odhf.style.width = (overdrive * 100) + '%'; odhf.style.filter = (odReady && odOvercharge > 0.01) ? ('brightness(' + (1 + odOvercharge * 0.6).toFixed(2) + ') saturate(' + (1 + odOvercharge * 0.5).toFixed(2) + ')') : ''; }
      const odht = $('hud-od-text'); if (odht) odht.textContent = odActive ? 'OVERDRIVE ACTIVE!' : (odReady ? (_odDense ? '▸ READY — FIRE NOW · DENSE AHEAD' : '▸ READY — PRESS SPACE') : 'CHARGING · ' + Math.round(overdrive * 100) + '%'); }
    // announce once when the meter first fills, so players know Space is armed
    if (odReady && !odReadyAnnounced) { odReadyAnnounced = true; _armJudgePriority(500); flashJudgment('OVERDRIVE READY', '#ffd98a'); }   // build60: protect the arming cue from the next plain GREAT
    else if (!odReady) odReadyAnnounced = false;
    // build99N (P-06): null-guard these 4 like the rest of updateHUD — a missing id must not throw inside the rAF loop.
    { const _jp = $('jc-perfect'); if (_jp) _jp.textContent = counts.perfect;
      const _jg = $('jc-great'); if (_jg) _jg.textContent = counts.great;
      const _jo = $('jc-good'); if (_jo) _jo.textContent = counts.good;
      const _jm = $('jc-miss'); if (_jm) _jm.textContent = counts.miss; }
    // judgment composition bar — proportion of each judgment so far, at a glance
    { const jt = counts.perfect + counts.great + counts.good + counts.miss || 1;
      const setSeg = (id, c) => { const e = $(id); if (e) e.style.width = (c / jt * 100) + '%'; };
      setSeg('jb-perfect', counts.perfect); setSeg('jb-great', counts.great);
      setSeg('jb-good', counts.good); setSeg('jb-miss', counts.miss); }
    const cd = $('combo-display');
    // Always write the number — vs-mode forces the capsule opaque, so a value left stale below the
    // single-player reveal threshold would read as a frozen combo. .show still gates the SP reveal at >=10.
    { const _cn = $('combo-num'); if (_cn) _cn.textContent = combo; }
    // combo TIER styling — recolor the readout + swap the label to the tier NAME past T0.
    // Only touch the DOM when the tier actually changes (per-frame cheap).
    if (cd) {
      const _ti = comboTierIdx(combo), _tin = COMBO_TIERS[_ti];
      if (cd._tier !== _ti) {
        cd._tier = _ti;
        cd.setAttribute('data-tier', String(_ti));
        cd.style.setProperty('--ct-num', 'rgb(' + _tin.rgb.join(',') + ')');
        cd.style.setProperty('--ct-glow', 'rgb(' + _tin.glow.join(',') + ')');
        const _lab = cd.querySelector('.lab');
        if (_lab) _lab.textContent = _ti === 0 ? 'COMBO' : _tin.name;
      }
    }
    if (cd) { if (combo >= 10) cd.classList.add('show'); else cd.classList.remove('show'); }
    { const _hsb = $('hud-stability'); if (_hsb) _hsb.style.width = (stability * 100) + '%'; }
    let stxt = 'STABLE';
    if (stability < 0.3) stxt = 'COLLAPSING'; else if (stability < 0.6) stxt = 'UNSTABLE';
    else if (stability < 0.85) stxt = 'FLUCTUATING';
    { const _stx = $('stability-text'); if (_stx) _stx.textContent = stxt + ' · ' + Math.floor(stability * 100) + '%'; }
  }

  // ---------- RENDER HELPERS ----------
  function laneCenterX(lane) {
    const g = geom();
    return g.margin + g.lw * lane + g.lw / 2;
  }

  // build66 (launch-audit P2): ADAPTIVE AUTO-QUALITY. On a device that can't hold frame-rate, auto-enable fxLite + the
  // performance backdrop ONCE (with a one-time toast) so a non-savvy player on a weak laptop/phone isn't stuck stuttering and
  // never finds Settings. Decided once per device (rr_autolite); the user always wins afterward (Settings → applySettings).
  let _qSamples = 0, _qSlow = 0, _qAutoDone = false;
  try { _qAutoDone = localStorage.getItem('rr_autolite') === '1'; } catch (e) {}
  // build99M (launch): pre-emptive lite on a CLEARLY weak device (<=2GB deviceMemory) so it doesn't stutter through the
  // first ~2.5s before the adaptive sampler decides. fxLite ONLY (lighter canvas FX) — NEVER bgMode (that hides the AI Flix
  // + journey videos, the build66.10 footgun). Skipped if the player already saved an fxLite preference; they always win in
  // Settings. Quiet (no toast / no persist) — the adaptive sampler still confirms + persists if the device truly can't hold up.
  try {
    if (!_qAutoDone) {
      var _dm = navigator.deviceMemory;
      var _savedLite = null; try { var _ss = JSON.parse(localStorage.getItem('rr_settings') || '{}'); _savedLite = (typeof _ss.fxLite === 'boolean') ? _ss.fxLite : null; } catch (e) {}
      if (_savedLite === null && _dm && _dm <= 2) fxLite = true;
    }
  } catch (e) {}
  function _autoLite() {
    _qAutoDone = true;
    try { localStorage.setItem('rr_autolite', '1'); } catch (e) {}
    // build66.10 FIX: auto-degrade ONLY the canvas FX (fxLite). It used to ALSO force bgMode='performance', which hides EVERY
    // background video site-wide + persists it — a confusing "my videos vanished" regression. Videos stay; only heavy FX lighten.
    try { window.RhythmGame.applySettings({ fxLite: true }); } catch (e) { fxLite = true; }
    try { showToast('Lite visuals on — smoother on this device. Change it anytime in Settings.', 'neutral'); } catch (e) {}
  }
  function _qSample(ms) {
    if (ms > 200) return;            // ignore a tab hiccup / decode spike
    _qSamples++;
    if (ms > 22) _qSlow++;           // >22ms ≈ sub-45fps
    if (_qSamples >= 150) {          // ~2.5s of real play sampled before deciding
      if (_qSlow / _qSamples > 0.5) _autoLite();   // majority of frames slow → degrade once
      else _qAutoDone = true;        // device holds up → stop sampling (never auto-degrade this device)
      _qSamples = 0; _qSlow = 0;
    }
  }
  let lastFrame = performance.now();
  function loop() {
    _fgFrameCache = null;   // build121 PERF: fresh fretGeom() memo window starts this tick
    rafId = requestAnimationFrame(loop);
    const now = performance.now();
    const _rawMs = now - lastFrame;
    const dt = Math.min(0.05, _rawMs / 1000);
    lastFrame = now;

    if (state === 'paused') { render(dt, true); return; }
    if (state !== 'playing') return;
    // RIFT REPLAY: sample the prior frame's gameplay canvas into the replay ring (fps-gated + cheap inside the
    // module). One-frame-stale is imperceptible for a 12fps clip. try/catch-wrapped so a replay failure can NEVER
    // break the hot loop; additive only — does not touch scoring/notes/timing/hit-detection.
    if (window.RhythmReplay) { try { window.RhythmReplay.tick(); } catch (e) {} }
    if (!fxLite && !_qAutoDone) _qSample(_rawMs);   // build66: adaptive-quality sampler (only while actually playing)

    pollGamepad();              // poll at frame-top so a controller/guitar press is judged this frame
    if (anyPadConnected()) _ensureFastPoll();   // build102w/104 s3: arm the ~4ms low-latency poller whenever a pad is connected mid-run — press mode AND strum mode (self-disarms on run end / pause / unplug)
    const t = songTime();
    const jt = t - audioOffset;
    const diff = DIFFICULTY[difficulty];
    const _hw = effHitWindow(diff);   // FIRST PULSE: eased miss window during a bridge run; else === diff.hitWindow (byte-identical)
    // build108: the fail-out wipeout beat (_endingLock) freezes note-judging/scoring for its ~550ms window — the
    // run is already lost, endGame() is already scheduled (see failRun), so nothing here should keep mutating
    // score/combo/notes or call endGame() a second time. The FX-decay code below (particles/lane pulses/
    // cameraShake/glitchAmount/bgPulse/odBurst) is OUTSIDE this guard and keeps running every frame regardless.
    if (!_endingLock) {
    // build104 s1a (timing fairness — the late-edge race): handleHit back-dates a press by up to 50ms of event/queue
    // lag (inputLag), so a LEGAL hit at n.time + hitWindow − ε whose event arrived a frame late was losing the race to
    // this sweep — declared MISS before the press could be judged. Miss *declaration* now waits one lag budget (50ms)
    // + ~a frame (10ms) past the window for scored taps. Hit LEGALITY (handleHit's own `n.time < t − hitWindow` bound)
    // is unchanged → scoring windows stay deterministic; only the miss call moves 60ms later. BOMBS still resolve
    // 'avoided' at the exact window edge (their press-penalty window must not stretch), and HOLD heads keep the exact
    // edge too (sustain-start bookkeeping assumes the head resolves at the old boundary). Mirrored in the P2 scorer.
    const MISS_GRACE = 0.06;
    // build60 PERF: monotonic miss-sweep cursor. notes are time-sorted ascending; a note is only ever judged
    // (hit via handleHit, or missed/avoided here) — .judged is terminal and never reverts. So (a) leading notes
    // that are already judged can never need judging again → advance _missCursor past them (it never rewinds,
    // since judging only moves forward in time); (b) the EARLIEST miss boundary is n.time+hitWindow (bombs/holds;
    // taps get +MISS_GRACE on top), so once jt <= n.time+hitWindow for a note, every LATER note is future too →
    // break. The cursor stops at the first UNJUDGED note (an out-of-order late hit past an earlier still-pending
    // note leaves that earlier note unjudged, which blocks the cursor there), so it can NEVER skip a miss-able note.
    while (_missCursor < notes.length && notes[_missCursor].judged) _missCursor++;
    for (let _i = _missCursor; _i < notes.length; _i++) {
      const n = notes[_i];
      if (jt <= n.time + _hw) break;   // this note (and all later) still inside their miss window → done
      if (n.judged) continue;
      if (n.type === 'bomb') { n.judged = true; n.hit = 'avoided'; if (n._fuseFx) { try { n._fuseFx.stop(); } catch (e) {} n._fuseFx = null; } if (n._warnFx) { try { n._warnFx.stop(); } catch (e) {} n._warnFx = null; } continue; }   // dodged the hazard — safe, no penalty
      if (n.type === 'hold' || n.type === 'rail') { missNote(n); continue; }   // SLIDE RAILS: an unstruck rail head misses like a hold head
      if (jt <= n.time + _hw + MISS_GRACE) continue;
      missNote(n);
    }

    // build104 s7: FULL-CHORD late-finger window — a chord judged with the shape incomplete re-checks here until
    // its ±35ms sample window closes (a 5ms-late second finger still earns the 1.3×). Expired entries drop silently.
    if (_pendFullChord.length) {
      const nowFC = performance.now();
      for (let i = _pendFullChord.length - 1; i >= 0; i--) {
        const pc = _pendFullChord[i];
        if (pc.lanes.every(l => laneDown[l] || (nowFC - (_lanePressMs[l] || -1e9)) <= 30)) {
          score += pc.bonus;
          flashJudgment('FULL CHORD', '#ffe08a');
          updateHUD();
          _pendFullChord.splice(i, 1);
        } else if (nowFC > pc.until) _pendFullChord.splice(i, 1);
      }
    }

    // ---- sustain (hold) scoring: a struck hold pays out continuously while held ----
    let sustaining = false;
    for (let i = 0; i < LANE_COUNT; i++) {
      const hn = holdNote[i]; if (!hn) continue;
      const end = hn.time + hn.hold;
      if (jt >= end) { completeHold(i); continue; }       // reached the tail end → full payout + pop
      if (hn.type === 'rail') {                            // SLIDE RAILS: rail-aware liveness + transfer migration
        const _rr = _railSustainStep(i, hn, jt);
        if (_rr !== 'pay') continue;                       // 'migrated' / 'drop' handled inside → skip payout on lane i this frame
      } else if (!laneDown[i]) { endHoldEarly(i); continue; }   // let go early → endHoldEarly (combo break unless past the tail grace)
      const frac = Math.max(0, Math.min(1, (jt - hn.time) / hn.hold));
      if (performance.now() < _mpStunUntil) { holdScored[i] = frac; continue; }   // v258: MP combat stun — advance the sustain marker WITHOUT paying out (no score banked while shocked, and no refund-lump when the stun ends)
      const gain = frac - holdScored[i];
      if (gain > 0) { score += gain * holdTotalFor(hn) * curMult(); holdScored[i] = frac; sustaining = true; }
      // keep the lane alive: string keeps ringing, catcher glows, sparks trickle up
      lanePluckT[i] = Math.min(lanePluckT[i], 0.06);
      laneHitPulse[i] = Math.max(laneHitPulse[i], 0.35);
      holdSparkT[i] += dt;
      if (holdSparkT[i] >= 0.09) { holdSparkT[i] = 0; spawnSustainSpark(i); }
    }
    if (sustaining) updateHUD();

    // PRACTICE section-end → LOOP back to the section start (auto-retry). Alloc-free: bare number compare on the
    // clock we already read this frame. Only ever true inside a practice run with a section (default path untouched).
    if (_practiceOn && _practiceSection && t >= _practiceSection.end) {
      for (let i = 0; i < LANE_COUNT; i++) if (holdNote[i]) completeHold(i);
      practiceRearm(); return;
    }
    if (t > songDuration + 0.6) { for (let i = 0; i < LANE_COUNT; i++) if (holdNote[i]) completeHold(i); if (_practiceOn) { practiceRearm(); return; } endGame(); return; }   // build58: bank any sustain still correctly held when the clock crosses the end · PRACTICE loops instead of ending
    }   // end !_endingLock (build108)

    // build64 PERF (build121 revision): oldest-first cap-trim via copyWithin — same resulting elements
    // in the same relative order as splice(0, dropCount), no internal array-shift allocation.
    if (particles.length > MAX_PARTICLES) {
      const _drop = particles.length - MAX_PARTICLES;
      particles.copyWithin(0, _drop);
      particles.length = MAX_PARTICLES;
    }
    // build121 PERF: was a backward loop calling particles.splice(i,1) per dead particle (O(n) shift
    // EACH time, on top of the update work). Each particle's update only reads/writes its OWN fields
    // (age/vy/x/y/vx/z/rot) from dt — a loop-invariant — so update order across particles is irrelevant
    // and switching backward→forward changes nothing about the math. Two-pointer forward compaction:
    // update in place, and only survivors get written to the write cursor `w`, in the SAME relative
    // order they already had (we visit 0..N-1 in order and append survivors in that order — draw-order
    // preserving, unlike a swap-and-pop). Then truncate. Zero splice calls, one O(n) pass.
    {
      let w = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]; p.age += dt;
        if (p.age >= p.life) continue;   // dead — drop (don't advance write cursor)
        if (!p.ring && !p.column && !p.flash) {
          p.vy += 480 * (p.grav != null ? p.grav : 1) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.kit) { p.vx *= (1 - 0.85 * dt); if (p.vz) p.z = (p.z || 0) + p.vz * dt; }   // build65: ease + advance toward-camera depth
        }
        if (p.frag || (p.kit && p.vrot)) p.rot += p.vrot * dt;
        if (w !== i) particles[w] = p;
        w++;
      }
      particles.length = w;
    }
    for (let i = 0; i < LANE_COUNT; i++) {
      lanePulse[i] = Math.max(0, lanePulse[i] - dt * 4);
      laneHitPulse[i] = Math.max(0, laneHitPulse[i] - dt * 2.5);
      lanePluckT[i] += dt;
      // HELD KEY/FINGER: keep the button pressed DOWN, the catcher glowing WHITE
      // (drawCatcher's glow uses ringWhite), and the string ringing the whole time the
      // lane is held — so a long press genuinely feels held, not a fleeting tap.
      if (laneDown[i]) {
        lanePulse[i] = Math.max(lanePulse[i], 0.9);     // stays squashed + lit white
        laneHitPulse[i] = Math.max(laneHitPulse[i], 0.55);
        lanePluckT[i] = Math.min(lanePluckT[i], 0.035); // string keeps vibrating
      }
    }
    bgPulse = Math.max(0, bgPulse - dt * 1.8);
    comboGlow = Math.max(0, comboGlow - dt * 1.4);   // build64: combo string-glow flash decay (~0.7s)
    odBurst = Math.max(0, odBurst - dt * 1.7);    // decay the OD-ignition one-shot (~0.6s)
    // expose the live beat (0..1) as a CSS var so the DOM HUD chrome can BREATHE on the beat (Hi-Fi Rush "everything
    // on the beat"). Only #game elements read it, so a stale value off the gameplay screen is harmless.
    if (state === 'playing') { try { document.documentElement.style.setProperty('--rr-beat', bgPulse.toFixed(2)); } catch (e) {} }
    // AUDIO-REACTIVE: pulse the whole scene on the music's bass onsets (kick/beat) via the analyser tap
    if (musicAnalyser && musicFreq && state === 'playing') {
      try {
        musicAnalyser.getByteFrequencyData(musicFreq);
        let bass = 0; for (let i = 0; i < 6; i++) bass += musicFreq[i];
        bass /= (6 * 255);
        if (!reduceMotion && bass > 0.22 && bass > beatLevel * 1.25) bgPulse = Math.max(bgPulse, Math.min(0.7, bass * 0.8));
        beatLevel += (bass - beatLevel) * 0.25;
      } catch (e) {}
    } else { beatLevel *= 0.9; }
    glitchAmount = Math.max(0, glitchAmount - dt * 0.4);
    cameraShake = Math.max(0, cameraShake - dt * 30);
    scanT = Math.max(0, scanT - dt);
    lightningT = Math.max(0, lightningT - dt);
    lightningHitT = Math.max(0, lightningHitT - dt);   // build116 p1: decay the incoming-shock bolt
    comboMidT = Math.max(0, comboMidT - dt);   // 3B-i: decay the mid-streak pulse
    // VISUAL-ONLY miss/fail FX decays
    missFlash = Math.max(0, missFlash - dt * 2.2);
    wipeoutT = Math.max(0, wipeoutT - dt * 1.6);
    stringsCold = Math.max(0, stringsCold - dt * 1.4);
    for (let i = 0; i < laneDesat.length; i++) {
      laneDesat[i] = Math.max(0, laneDesat[i] - dt * 2.0);
      catcherRecoil[i] = Math.max(0, catcherRecoil[i] - dt * 4.0);
    }
    // Boss Stage: flip to the ENRAGE phase ~60% through, and the meter is always lethal.
    if (bossMode && state === 'playing' && !bossPhaseShown && songDuration > 0 && songTime() >= songDuration * 0.6) {
      bossPhase = 2; bossPhaseShown = true;
      cameraShake = Math.max(cameraShake, 16); glitchAmount = Math.min(1, glitchAmount + 0.5); bgPulse = 1;
      flashJudgment('⚠ ENRAGED — HOLD THE LINE', '#ff1f2e');
    }
    if ((failMode || bossMode || _levelFailOn()) && state === 'playing' && stability <= 0 && !runFailed) failRun();   // build36: per-level failOn mod
    // STREAK FLAMES — the catchers catch fire as your multiplier climbs (Guitar-Hero feel)
    const _mlt = curMult();
    if (_mlt >= 2 && !reduceMotion && !fxLite) {
      const fgm = fretGeom();
      for (let i = 0; i < LANE_COUNT; i++) {
        for (let s = 0; s < (_mlt - 1); s++) {
          if (Math.random() > 0.45) continue;
          particles.push({ x: fgm.nearX[i] + (Math.random() - 0.5) * fgm.lw * 0.5, y: fgm.nearY,
            vx: (Math.random() - 0.5) * 50, vy: -130 - Math.random() * 150 - _mlt * 30,
            life: 0.32 + Math.random() * 0.34, age: 0, size: 1.4 + Math.random() * 2.6,
            color: Math.random() < 0.5 ? '255,165,60' : '255,72,46', spark: true });
        }
      }
    }
    // build65: OVERDRIVE sustained gold ENERGY STREAM — a steady rise off the catcher row so OD reads as a real MODE
    // takeover (paired with the rainbow strings + gold edge-glow), not just a faint vignette. Cheap + capped.
    // build109 s3: ADDITIVE BRIGHTNESS BUDGET (cheap version, per the polish plan — not the full per-frame
    // tracker). At 150+ combo with OD active, this ember stream + the multiplier fire-loop (curMult()>=3)
    // + the per-hit burst + rainbow spray can all be 'lighter'-composite on the same frame with no shared
    // ceiling, clipping to white exactly when the game should read as "amazing." Two cheap levers, both
    // reusing existing state (no new coordination timer): (1) mute the ember spawn entirely for ~300ms
    // after a combo-tier burst (comboMidT, already armed at every 25-combo tier-up above) since that
    // burst is already the brightest moment on screen; (2) when fire-loop is ALSO concurrently active
    // (high mult), cap this stream's own additive alpha instead of letting both stack unbounded.
    if (odActive && !reduceMotion && !fxLite && comboMidT <= 0) {
      const fgo = fretGeom(), _mid = (LANE_COUNT - 1) / 2;
      const _emberCap = curMult() >= 3 ? 0.55 : 1;   // combined-budget cap only kicks in once fire-loop is also live
      for (let i = 0; i < LANE_COUNT; i++) {
        if (Math.random() > 0.32) continue;   // build65 (cycle-3): lower emit rate so the ambient stream doesn't crowd the read-path
        // edge-bias: embers drift OUTWARD from the playfield center (rise along the rails, not straight up the gem columns)
        const side = i < _mid ? -1 : i > _mid ? 1 : (Math.random() < 0.5 ? -1 : 1);
        particles.push({ kit: true, shape: 'ember', x: fgo.nearX[i] + side * fgo.lw * 0.34, y: fgo.nearY,
          vx: side * (18 + Math.random() * 30), vy: -120 - Math.random() * 120, grav: 0.18, z: 0, vz: 0.12,
          rot: 0, vrot: 0, size: 1.8 + Math.random() * 2.4, life: 0.6 + Math.random() * 0.5, age: 0,
          color: Math.random() < 0.5 ? '255,210,110' : '255,176,70', add: true, glow: '255,214,130', capMul: _emberCap });
      }
    }
    // build65 PERF: re-cap AFTER this frame's spawn loops (streak flames + OD stream + the per-hit burst all push above)
    // so the render pass can't iterate an oversized array at peak load (Hard + high combo + OD). Oldest-first trim.
    // build121 PERF: copyWithin instead of splice(0,drop) — identical resulting order, no shift-array alloc.
    if (particles.length > MAX_PARTICLES) {
      const _drop2 = particles.length - MAX_PARTICLES;
      particles.copyWithin(0, _drop2);
      particles.length = MAX_PARTICLES;
    }
    // animated score count-up — the displayed number rolls toward the real score (game juice)
    if (scoreDisplay !== score) {
      if (Math.abs(score - scoreDisplay) < 0.6) scoreDisplay = score;
      else scoreDisplay += (score - scoreDisplay) * Math.min(1, dt * 14);
      const el = $('hud-score'); if (el) el.textContent = Math.floor(scoreDisplay).toLocaleString();
    }
    // (gamepad now polled at frame-top — see loop start)
    // build109 s3: OD activation wind-up — count down the pre-charge (the ready-ring visual ramp itself
    // lives in render(), where lw/_readyRings are in scope); fire the payoff (unchanged code, moved to
    // _fireOverdrivePayoff) the instant the window elapses.
    if (odIgniteT > 0) {
      odIgniteT = Math.max(0, odIgniteT - dt);
      if (odIgniteT <= 0) _fireOverdrivePayoff();
    }
    // drain overdrive while active; meter empties over the duration, then ends
    if (odActive) {
      odTimer -= dt;
      overdrive = Math.max(0, odTimer / OD_DURATION);
      bgPulse = Math.max(bgPulse, 0.35);
      if (odTimer <= 0) { odActive = false; overdrive = 0; try { _odTally(); } catch (e) {} if (odFlame) { odFlame.classList.remove('active', 'ready'); odFlame.style.boxShadow = ''; } if (_odAura) { try { _odAura.stop(); } catch (e) {} _odAura = null; } emitFx('odend', 'od'); }   // Wave-3 finding 2: OD end-tally (render/stats only)
    }
    applyGate(); // expire miss-dropouts so the music returns
    for (const n of notes) { if (n.time - t > dt) break; if (!n._pulsed && Math.abs(n.time - t) < dt) { n._pulsed = true; bgPulse = Math.min(1, bgPulse + 0.5); } }   // build71: notes are time-sorted ascending → stop once past the dt window (no behavior change)
    // reactive intensity: density of beats around "now" (the music builds the world)
    let dens = 0;
    for (const n of notes) { const d = n.time - t; if (d > 1.4) break; if (d > -0.6) dens += (0.5 + Math.min(1, n.strength * 0.4)); }   // build71: early-break past the +1.4s window (sorted notes)
    energyTarget = Math.min(1, dens / 9);
    energy += (energyTarget - energy) * Math.min(1, dt * 3);
    if (odActive) energy = Math.min(1, energy + 0.3);

    const p = Math.max(0, Math.min(1, t / songDuration));
    // G-3: sample cumulative score at 10 evenly-spaced progress points (results-only "vs your best" pace strip).
    // Alloc-light — a bounded while that advances at most once per ~10% of the song; reads score, never writes it.
    while (_paceBucket < 10 && p >= (_paceBucket + 1) / 10) { _paceSamples[_paceBucket] = Math.round(score); _paceBucket++; }
    const pct = Math.round(p * 100);
    if (pct !== _lastPct) { _lastPct = pct; const hp = $('hud-progress'); if (hp) hp.style.width = pct + '%'; const mp = $('m-progress'); if (mp) mp.style.width = pct + '%'; }   // build71: gate the per-frame layout writes on whole-percent change (also null-safe now)
    const sec = Math.floor(t);
    if (sec !== _lastSec) { _lastSec = sec; const ht = $('hud-time'); if (ht) ht.textContent = fmtTime(Math.max(0, t)) + ' / ' + fmtTime(songDuration); }

    render(dt, false);
  }

  function fmtTime(s) { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return m + ':' + (sec < 10 ? '0' : '') + sec; }

  function render(dt, isPaused) {
    if (cw === 0) return;
    // build10b: advance the materialize cinematic (≈2s, finishes with the countdown)
    // build18: the instant the print completes, the catcher row IGNITES L→R (the board comes online)
    if (!isPaused && _skinBuildT < 1) {
      _skinBuildT = Math.min(1, _skinBuildT + dt / 2.0);
      if (_skinBuildT >= 1) _igniteCatchers();
    }
    const t = songTime();
    const approach = DIFFICULTY[difficulty].approach / (userScroll * _levelSpeedMul() * _practiceSpeedMul());   // build36: per-level SPEED mod · PRACTICE: speed spreads notes so real-time travel matches the faster/slower audio (crossing still lands at t==n.time → strike-line sync preserved)
    // build121 PERF: skip the Math.random()-based translate when shake has decayed to ~0 — at that
    // point sx/sy are ~0 anyway (cameraShake decays to exactly 0 between hits), so translate(0,0) was
    // a no-op transform every idle frame. save()/restore() stay unconditional (transform stack balance
    // untouched); only the translate call itself is skipped.
    const sx = cameraShake > 0.01 ? (Math.random() - 0.5) * cameraShake : 0;
    const sy = cameraShake > 0.01 ? (Math.random() - 0.5) * cameraShake : 0;
    ctx.save();
    if (sx !== 0 || sy !== 0) ctx.translate(sx, sy);
    ctx.clearRect(0, 0, cw, ch);
    drawCathedralBg(t);

    // ---- fret-board geometry: strings / catchers / notes are LOCKED to the
    // guitar art (derived from its drawn rect + measured string positions) ----
    const fg = fretGeom();
    const nearX = fg.nearX, farX = fg.farX, nearY = fg.nearY, farY = fg.farY;
    const lw = fg.lw;
    // (build12: the themed neck scrim is gone — skins draw the full opaque guitar under the lanes
    // like the default, and the alpha-keyed FX fix removed the readability problem at its source.)
    // build8b: themed ambient AURA — one subtle drifting loop behind the upper neck while a themed level
    // plays (Skully skull-flame / Bone Daddy ember-skull). Localized + low-alpha (not a full-screen wash).
    if (!isPaused && fx && !reduceMotion && !fxLite && state === 'playing') {
      // build14: THEME AURA DISABLED (user, Skully playtest: "random floating particle effects
      // which I don't understand") — a causeless looping flame drifting mid-air breaks the
      // world-reacts-to-GAMEPLAY rule. It was invisible pre-v108 (black-box era); the luminance
      // key exposed it. THEME_FX hit/perfect variants + gameplay-anchored FX are untouched.
      // To re-enable for a future level: restore _fxRide(THEME_AURA[_fxTheme()], …) here.
      if (_auraFx) { _auraFx.stop(); _auraFx = null; }
      // build8c: OD-READY cue — a chrome pulse ring on every catcher while star power is armed
      if (overdrive >= 1 && !odActive) {
        if (!_readyRings) { _readyRings = []; for (let i = 0; i < LANE_COUNT; i++) _readyRings.push(_fxRide('chrome-pulse-ring', nearX[i], nearY, (lw * 1.7 / 128), 0.5)); }
        else {
          // build109 s3: during the activation wind-up (odIgniteT>0), ramp the SAME ready-ring sharply in
          // scale so the ignition reads as a building charge instead of an instant cut to the full payoff.
          // Idle (not igniting) keeps the exact prior behavior (move-only, base scale) — byte-identical then.
          const _ig = odIgniteT > 0 ? (1 - (odIgniteT / (ODIGNITE_MS / 1000))) : 0;
          const _rs = 1 + _ig * 0.9;
          for (let i = 0; i < _readyRings.length && i < LANE_COUNT; i++) {
            const h = _readyRings[i]; if (!h || !h.alive()) continue;
            h.move(nearX[i], nearY);
            if (_ig > 0 && h.setScale) { try { h.setScale((lw * 1.7 / 128) * _rs); } catch (e) {} }
          }
        }
      } else { _stopReadyRings(); }
      // build8c: SUSTAIN charge loop — rides the catcher while a hold is actively banking
      for (let i = 0; i < LANE_COUNT; i++) {
        if (holdNote[i]) {
          const h = _holdFxL[i];
          if (!h || !h.alive()) _holdFxL[i] = _fxRide('charge-loop', nearX[i], nearY, (lw * 2.0 / 128), 0.55);
          else h.move(nearX[i], nearY);
        } else { _stopHoldFx(i); }
      }
      // build13: MULTIPLIER FIRE — at x3 the catcher buttons themselves catch fire; max tier RAGES
      // (the user's ask: "fire coming out of where the buttons are"). Pure visual, theme-agnostic
      // (fire = the universal heat language; themed auras already own the neck).
      const _mNow = curMult();
      if (_mNow >= 3 && _fxHas('fire-loop')) {
        const _fs = (lw * (_mNow >= 4 ? 1.30 : 0.92)) / 128, _fa = _mNow >= 4 ? 0.92 : 0.78;
        for (let i = 0; i < LANE_COUNT; i++) {
          const _fy = nearY - lw * 0.34;
          const h = _multFireL[i];
          if (!h || !h.alive()) _multFireL[i] = _fxRide('fire-loop', nearX[i], _fy, _fs, _fa);
          else { h.move(nearX[i], _fy); h.setScale(_fs); }
        }
      } else if (_multFireL.length) { _stopMultFire(); }
    } else {
      if (_auraFx) { _auraFx.stop(); _auraFx = null; }
      _stopReadyRings();
      for (let i = 0; i < _holdFxL.length; i++) _stopHoldFx(i);
      _stopMultFire();
    }
    // PERSPECTIVE depth warp (gh Highway): map the linear timeline d (0=catcher, 1=nut) through a 1/z
    // camera so far notes bunch up + crawl and near notes spread + ACCELERATE — the depth/vertigo cue.
    // Hit timing is unaffected (it uses note TIME, not screen position); only the visual gains depth.
    // Standard 6-string: zFar=0 → linear → unchanged.
    const zFar = (ART.persp > 1) ? (perspOverride || ART.persp) : 0;
    const P = (zFar > 1) ? (d) => { const z = 1 + d * (zFar - 1); return (1 - 1 / z) / (1 - 1 / zFar); } : (d) => d;
    const depthScale = (d) => (zFar > 1) ? (1 / (1 + Math.max(-0.2, d) * (zFar - 1))) : (1 - 0.7 * d);
    // gh NECK-RECEDE WARP: narrow the board toward the FAR (nut) end about the centerline so the neck
    // tilts away. The guitar IMAGE is sliced + narrowed by the SAME factor (see the draw block), so the
    // lanes stay ON the painted strings. u = lane param (0 = catcher/near .. 1 = nut/far); near (u=0) is
    // untouched → catcher alignment locked. warp=0 (standard) → identity → byte-identical.
    const warp = (warpOverride >= 0 ? warpOverride : (ART.warp || 0));
    const cxw = fg.gx + 0.5 * fg.gw;
    const warpX = (warp > 0) ? (x, u) => cxw + (x - cxw) * (1 - warp * Math.max(0, u)) : (x) => x;
    const noteX = (i, d) => { const u = P(d); return warpX(nearX[i] + (farX[i] - nearX[i]) * u, u); };
    // SLIDE RAILS (spec A3.1): fractional-lane x. Interpolates the MEASURED per-string nearX/farX through the SAME
    // P(d) persp + warpX neck-recede, so at an INTEGER laneF this reduces ALGEBRAICALLY to noteX(i,d) — a rail's
    // endpoints sit on the painted strings BY CONSTRUCTION (the catcher-alignment class; verified by __rrDebug.railGeom).
    const railX = (laneF, d) => {
      const i0 = Math.max(0, Math.min(LANE_COUNT - 2, Math.floor(laneF))), f = laneF - i0;
      const u = P(d);
      const nx = nearX[i0] + (nearX[i0 + 1] - nearX[i0]) * f;
      const fx = farX[i0] + (farX[i0 + 1] - farX[i0]) * f;
      return warpX(nx + (fx - nx) * u, u);
    };
    const noteY = (d) => nearY + (farY - nearY) * P(d);
    // scrolling fret lines — the highway itself rushes toward you (the #1 speed/depth cue, GH-style)
    // build22 (Melody): on the 'pink' theme the SAME moving rows render as PAW PRINTS stepping
    // down the highway — her identity rides an element that already moves (doctrine: never add a
    // new floater; re-theme what exists). Depth/speed cue preserved exactly.
    if (zFar > 1 && !reduceMotion && !fxLite) {
      const NF = 9, fretSpeed = 0.5;
      const pawTheme = _fxTheme() === 'pink';
      for (let k = 0; k < NF; k++) {
        const dk = ((k / NF - t * fretSpeed) % 1 + 1) % 1;
        const yy = noteY(dk);
        if (pawTheme) {
          const sD = depthScale(dk), aP = 0.06 + 0.20 * (1 - P(dk));
          const xm = (noteX(1, dk) + noteX(LANE_COUNT - 2, dk)) / 2;
          const spread = (noteX(LANE_COUNT - 2, dk) - noteX(1, dk)) * 0.30;
          const side = (k % 2) ? 1 : -1;
          _drawPaw(xm + side * spread, yy, 6.5 * sD + 1.6, 'rgba(255,95,162,' + aP.toFixed(3) + ')');
          _drawPaw(xm - side * spread, yy + 7 * sD, 5.5 * sD + 1.4, 'rgba(255,95,162,' + (aP * 0.75).toFixed(3) + ')');
        } else {
          ctx.strokeStyle = 'rgba(255,96,72,' + (0.04 + 0.18 * (1 - P(dk))).toFixed(3) + ')';
          ctx.lineWidth = 0.5 + 2 * depthScale(dk);
          ctx.beginPath(); ctx.moveTo(noteX(0, dk), yy); ctx.lineTo(noteX(LANE_COUNT - 1, dk), yy); ctx.stroke();
        }
      }
    }

    if (!gfx || Math.round(gfx.lw) !== Math.round(lw)) buildGameSprites(lw);

    // glowing neon strings — they CATCH FIRE as your multiplier climbs (Guitar-Hero energy):
    // crimson at x1 → hot orange + shimmer + flame licks by x4.
    const heat = (state === 'playing') ? Math.min(1, Math.max(0, (curMult() - 1) / 3)) : 0;
    const ph0 = performance.now() / 1000 * 46;
    for (let i = 0; i < LANE_COUNT; i++) {
      const pl = lanePluckT[i] != null ? Math.exp(-7 * lanePluckT[i]) : 0;
      // wipeout: strings momentarily go dark/cold (kill the heat glow this frame)
      const cold = stringsCold;
      const hI = heat * (1 - cold);
      const live = Math.max(pl, hI * 0.85);                   // hot strings stay lit + alive
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      // per-lane miss desaturation: blend the warm string toward dead chrome-grey
      const dz = (laneDesat[i] || 0);
      const baseR = 255, baseG = Math.round(42 + hI * 130), baseB = Math.round(48 - hI * 22);
      let r = Math.round(baseR + (150 - baseR) * dz);
      let g = Math.round(baseG + (150 - baseG) * dz);
      let b = Math.round(baseB + (150 - baseB) * dz);
      // build65: COMBO-TIER hue ladder — strings escalate color as the streak climbs (→ earned rainbow at elite combo / OD).
      let _tintRGB = null;
      if (state === 'playing' && dz < 0.6) {
        const tint = _comboTierTint(i, ph0 / 46);   // ph0/46 == seconds (ph0 = now/1000*46)
        if (tint) { const tk = tint.k * (1 - dz); r = Math.round(r + (tint.r - r) * tk); g = Math.round(g + (tint.g - g) * tk); b = Math.round(b + (tint.b - b) * tk); _tintRGB = tint.r + ',' + tint.g + ',' + tint.b; }
      }
      // build64: COMBO-MILESTONE flare — on each 25-streak the strings ignite toward white. Cosmetic only.
      if (comboGlow > 0) {
        const tg = combo >= 100 ? 255 : 226, tb = combo >= 100 ? 255 : 160, m = comboGlow;
        r = Math.round(r + (255 - r) * m); g = Math.round(g + (tg - g) * m); b = Math.round(b + (tb - b) * m);
      }
      // build13: on a custom skin OUR strings ARE the lanes (they no longer ride painted strings)
      // — floor the alpha so they always read over ornate art.
      const sAlpha0 = (0.24 + live * 0.6) * (1 - 0.55 * dz) * (1 - 0.5 * cold);
      const sAlpha = _skinArtOn ? Math.max(0.50, sAlpha0) : sAlpha0;
      const sWidth = (1.6 + live * 2.6 + hI * 1.6) + (_skinArtOn ? 0.8 : 0);
      // build121 PERF: was `new Path2D()` per lane per frame (5 heap allocs/frame just for this loop).
      // The path is stroked up to twice (dark seat, then the neon line) but nothing between those two
      // strokes touches the current path (only fillStyle/compositeOp/shadow change), so building it
      // directly on ctx and calling ctx.stroke() twice reproduces the exact same two strokes with zero
      // Path2D allocation. Same points, same order, same winding — byte-identical geometry.
      const undu = Math.max(pl, heat * 0.5);                  // hot strings shimmer even un-plucked
      ctx.beginPath();
      if (undu < 0.05 && warp <= 0) { ctx.moveTo(nearX[i], nearY); ctx.lineTo(farX[i], farY); }
      else {
        const segs = 16, amp = undu * 11;
        for (let s = 0; s <= segs; s++) {
          const u = s / segs;
          const bx = nearX[i] + (farX[i] - nearX[i]) * u, by = nearY + (farY - nearY) * u;
          const wob = Math.sin(u * Math.PI) * Math.sin(ph0 + u * 13 + i) * amp;
          const wx = warpX(bx, u) + wob;                       // follow the neck warp so strings ride the art
          s === 0 ? ctx.moveTo(wx, by) : ctx.lineTo(wx, by);
        }
      }
      if (_skinArtOn) {   // dark SEAT under the neon line — contrast against busy skin art
        ctx.globalCompositeOperation = 'source-over';
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(12,7,6,' + (0.40 + live * 0.18).toFixed(3) + ')';
        ctx.lineWidth = sWidth + 2.6;
        ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
      }
      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + sAlpha.toFixed(3) + ')';
      ctx.lineWidth = sWidth;
      ctx.shadowColor = _tintRGB ? ('rgb(' + _tintRGB + ')') : (dz > 0.3 ? '#6b6360' : (hI > 0.5 ? '#ff7a2a' : '#ff2a30'));
      ctx.shadowBlur = (fxLite || reduceMotion) ? 0 : (7 + live * 18 + hI * 14) * (1 - 0.4 * cold);   // build66 (launch-audit P2): gate the per-lane string glow blur for perf/a11y users — it was the one ungated FX in this loop (5 shadowBlur strokes/frame)
      ctx.stroke(); ctx.restore();
    }
    // COMBO-REACTIVE neck energy — the board visibly "charges up" as the multiplier tier climbs.
    drawComboEnergy(t, fg);
    // flame licks rising off the burning strings at high multiplier
    if (heat > 0.45 && !reduceMotion && !fxLite) {
      for (let i = 0; i < LANE_COUNT; i++) {
        if (Math.random() > heat * 0.5) continue;
        const u = 0.12 + Math.random() * 0.74;
        const bx = warpX(nearX[i] + (farX[i] - nearX[i]) * u, u), by = nearY + (farY - nearY) * u;
        particles.push({ x: bx + (Math.random() - 0.5) * 6, y: by, vx: (Math.random() - 0.5) * 30, vy: -70 - Math.random() * 90,
          life: 0.3 + Math.random() * 0.25, age: 0, size: 1.2 + Math.random() * 1.8,
          color: Math.random() < 0.5 ? '255,150,60' : '255,90,46', spark: true });
      }
    }

    // STRIKE-LINE — the GH "hit here" rail across the catcher row. Spans the MEASURED string
    // x-extents at nearY (NOT full canvas width); catchers + their halos draw on top of it so
    // it reads as the rail the buttons sit on. Reuses laneHitPulse (the hit flash) — no new hook.
    {
      const slX0 = nearX[0] - lw * 0.5, slX1 = nearX[LANE_COUNT - 1] + lw * 0.5;
      const slPulse = reduceMotion ? 0 : Math.max.apply(null, laneHitPulse);   // 0..1
      ctx.save();
      ctx.lineCap = 'round';
      // dark "seat" UNDER the additive strokes so the rail keeps contrast on bright video/level backdrops (STRIKE-CONTRAST)
      ctx.strokeStyle = 'rgba(8,5,4,0.45)'; ctx.lineWidth = Math.max(2, lw * 0.16);
      ctx.beginPath(); ctx.moveTo(slX0, nearY); ctx.lineTo(slX1, nearY); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      // crimson underglow (soft, wide)
      ctx.strokeStyle = 'rgba(255,42,48,' + (0.20 + slPulse * 0.30).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2, lw * 0.16);
      if (!fxLite && !reduceMotion) { ctx.shadowColor = '#ff2a30'; ctx.shadowBlur = 8 + slPulse * 14; }
      ctx.beginPath(); ctx.moveTo(slX0, nearY); ctx.lineTo(slX1, nearY); ctx.stroke();
      // chrome core (thin, crisp) — lerps to hot-white on a hit
      ctx.shadowBlur = (!fxLite && !reduceMotion) ? (4 + slPulse * 6) : 0;
      const coreA = (0.40 + slPulse * 0.40).toFixed(3);
      ctx.strokeStyle = slPulse > 0.4 ? 'rgba(255,238,224,' + coreA + ')' : 'rgba(236,231,227,' + coreA + ')';
      ctx.lineWidth = Math.max(1.2, lw * 0.05);
      ctx.beginPath(); ctx.moveTo(slX0, nearY); ctx.lineTo(slX1, nearY); ctx.stroke();
      ctx.restore();
    }

    // glowing fret-catcher rings at the bottom (flare on hit)
    for (let i = 0; i < LANE_COUNT; i++) {
      const pulse = Math.max(lanePulse[i] * 0.5, laneHitPulse[i]);
      // held key glows white THROUGH drawCatcher (its ringWhite glow + press-down move
      // together, so nothing floats above the button); see the held-state clamp in loop().
      // VISUAL-ONLY: recoil kicks the catcher down + briefly desaturates it on a miss in this lane.
      const rk = (catcherRecoil[i] || 0);
      const cY = nearY + rk * (lw * 0.10);                       // small downward kick (away from notes)
      const cCol = rk > 0.25 ? { c: '#7a6f6a', rgb: '150, 140, 134' } : LANE_COLORS[i];
      drawCatcher(nearX[i], cY, lw * 0.28, cCol, pulse, 0.4 + Math.max(bgPulse, energy) * 0.6, lanePulse[i]);
      // build94 ONBOARDING KEY GLYPH (render-only) — for a brand-new player (_firstRunEasy) ONLY, during the first
      // ~7s, paint the lane's REAL keyboard key on each catcher so they learn the map, then fade it out. keyForLane(i)
      // is read LIVE so a remapped player sees their actual key. DIM by default, BRIGHTER on press (laneHitPulse[i]).
      // Skipped on touch (tap-zone glyphs cover it) + on the GH strum profile (frets, not letters). Never touches
      // input/scoring/timing — a ctx.fillText AFTER the button draw. keyGlyph returns '—' (U+2014) for unmapped → skip it.
      if (_firstRunEasy && state === 'playing' && t >= 0 && t < 7 &&
          !document.body.classList.contains('has-touch') && !requireStrum()) {
        const _kg = keyGlyph(keyForLane(i));
        if (_kg && _kg !== '—') {
          const _kf = (t < 6) ? 1 : Math.max(0, 1 - (t - 6));                       // hold 0..6s, linear fade 6..7s
          if (_kf > 0.01) {
            const _ka = (0.42 + 0.53 * Math.min(1, (laneHitPulse[i] || 0))) * _kf;  // DIM default → BRIGHT on press
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '800 ' + Math.max(11, Math.round(lw * 0.30)) + "px 'Oxanium', sans-serif";
            ctx.shadowColor = 'rgba(10,5,4,0.85)'; ctx.shadowBlur = Math.max(2, lw * 0.04);   // warm-dark seat so it reads on any skin
            ctx.fillStyle = 'rgba(236,231,227,' + _ka.toFixed(3) + ')';                       // warm chrome (NOT gold — a key hint isn't a reward)
            ctx.fillText(_kg, nearX[i], cY);
            ctx.restore();
          }
        }
      }
      // build7: additive level-accent halo under the catcher (presentation only; skipped in Quick Play / fxLite)
      if (levelAccentRGB && !fxLite) {
        const ag = (0.10 + Math.max(pulse, Math.max(bgPulse, energy)) * 0.22);
        if (ag > 0.02) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const r2 = lw * 0.5;
          const grd = ctx.createRadialGradient(nearX[i], cY, 0, nearX[i], cY, r2);
          grd.addColorStop(0, 'rgba(' + levelAccentRGB + ',' + ag.toFixed(3) + ')');
          grd.addColorStop(1, 'rgba(' + levelAccentRGB + ',0)');
          ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(nearX[i], cY, r2, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }

    // notes — glossy spheres sliding down the strings toward the catchers
    for (const n of notes) {
      // SLIDE RAILS: a rail's active slot MIGRATES across lanes, so "held" is any lane whose holdNote is this note.
      let _railLane = -1;
      if (n.type === 'rail') { for (let _l = 0; _l < LANE_COUNT; _l++) if (holdNote[_l] === n) { _railLane = _l; break; } }
      const held = (n.type === 'hold' && holdNote[n.lane] === n) || (n.type === 'rail' && _railLane >= 0);   // struck & actively sustaining
      // a struck-then-dropped hold/rail keeps showing its (shrinking) beam until the tail passes —
      // it goes dim and dies in place, so a let-go reads clearly instead of vanishing instantly
      const resolving = ((n.type === 'hold' || n.type === 'rail') && n.dropped && t < n.time + n.hold);
      if (n.judged && n.hit !== 'miss' && !held && !resolving) continue;
      let d = (n.time - t) / approach;
      // build60 PERF: notes are time-sorted ascending and d is monotonic-decreasing across the array,
      // so once a note is off-screen-future (d>1.02) EVERY later note is future too → break, don't scan on.
      // A held/resolving hold sustains NOW (small/negative d) but its sort-key n.time is already PAST t,
      // so it sorts BEFORE any d>1.02 note and can never be skipped by the break; the guard is belt-and-suspenders.
      // (Byte-identical to the old combined `continue` — only stops visiting notes that were already skipped.)
      if (!held && !resolving) {
        if (d > 1.02) break;
        if (d < -0.12) continue;
      }
      if (held || resolving) d = Math.max(0, d);    // pin the struck head on the catcher line
      const sc = depthScale(d);
      const nx = noteX(n.lane, d), ny = noteY(d);
      // BOMB hazard — a dark "✕, do not hit" orb; skips the normal marble + trail.
      // A wall bomb (_bombRow) gets a faint ember warning ring as it approaches (visual only; gated).
      if (n.type === 'bomb') {
        // ride a lit-fuse flipbook on the bomb (animated hazard). Self-heals to the ember ring below
        // if no sheet / reduced motion; the handle is stopped when the bomb is struck or dodged.
        if (fx && !reduceMotion && !fxLite) {
          const _fs = (lw * sc) / 128 * 1.15;
          if (!n._fuseFx || !n._fuseFx.alive()) { n._fuseFx = _fxRide('bomb-fuse', nx, ny, _fs); }
          else { n._fuseFx.move(nx, ny); n._fuseFx.setScale(_fs); }
          // build10: WALL-BOMB telegraph — the bomb-warn pulse loop rides ahead of a bomb row
          // (the "do NOT strum" warning), on top of the hand-drawn ember ring below.
          if (n._bombRow && d > 0.12) {
            const _ws = (lw * sc) / 128 * 1.9;
            if (!n._warnFx || !n._warnFx.alive()) { n._warnFx = _fxRide('bomb-warn', nx, ny, _ws, 0.65); }
            else { n._warnFx.move(nx, ny); n._warnFx.setScale(_ws); }
          } else if (n._warnFx) { try { n._warnFx.stop(); } catch (e) {} n._warnFx = null; }
        }
        if (n._bombRow && d > 0.12 && !reduceMotion && !fxLite) {
          const warn = 0.25 + 0.25 * Math.sin(performance.now() / 90);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = 'rgba(255,122,74,' + (warn * sc) + ')';
          ctx.lineWidth = Math.max(1, lw * 0.06 * sc);
          ctx.beginPath(); ctx.arc(nx, ny, lw * 0.66 * sc, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        drawBomb(nx, ny, lw * 0.48 * sc); continue;
      }
      // OPEN note (openNotes flag) — a full-neck STRUM BAR spanning every lane ("hit anything").
      // Crimson→ember rail with a hot chrome core, depth-scaled, riding the warp like the strings.
      if (n.open) {
        const x0 = noteX(0, d), x1 = noteX(LANE_COUNT - 1, d);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,42,48,' + (0.30 * sc) + ')'; ctx.lineWidth = lw * 0.62 * sc;
        ctx.shadowColor = '#ff2a30'; ctx.shadowBlur = 16 * sc;
        ctx.beginPath(); ctx.moveTo(x0, ny); ctx.lineTo(x1, ny); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,122,74,' + (0.55 * sc) + ')'; ctx.lineWidth = lw * 0.30 * sc; ctx.shadowBlur = 9 * sc;
        ctx.beginPath(); ctx.moveTo(x0, ny); ctx.lineTo(x1, ny); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,238,224,' + (0.85 * sc) + ')'; ctx.lineWidth = Math.max(1.4, lw * 0.09 * sc); ctx.shadowBlur = 5 * sc;
        ctx.beginPath(); ctx.moveTo(x0, ny); ctx.lineTo(x1, ny); ctx.stroke();
        ctx.restore();
        continue;
      }
      // CHORD CROSSBAR (T6 grammar, spec B1) — a CHROME CAPSULE joining the simultaneous gems so the silhouette
      // reads as ONE object (a dumbbell: bar + two gem heads), "hit together". Rebuilt from the old additive glow
      // into a solid source-over metal bar: a near-black under-rim (the object edge), a brushed-chrome body
      // (vertical light→dark gradient), and a warm-white top sheen. Round caps land UNDER each gem centre so the
      // bar flares into the gem rims. Drawn under the gems (this block precedes drawNote). Renders under fxLite/
      // reduceMotion (readability, not juice). Visual-only — judging/tap-zones/sizes untouched.
      if (n.chordLead && n.chordLanes && n.chordLanes.length > 1 && !n.judged) {
        let x0 = Infinity, x1 = -Infinity;
        for (let c = 0; c < n.chordLanes.length; c++) { const xx = noteX(n.chordLanes[c], d); if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; }
        const capW = lw * 0.30 * sc;                                   // capsule thickness (the crossbar height)
        ctx.save(); ctx.lineCap = 'round';
        // 1) dark under-rim — a near-black stroke slightly wider than the body = the object's silhouette edge
        ctx.strokeStyle = 'rgba(8,5,4,0.92)'; ctx.lineWidth = capW + Math.max(2, lw * 0.16 * sc);
        ctx.beginPath(); ctx.moveTo(x0, ny); ctx.lineTo(x1, ny); ctx.stroke();
        // 2) brushed-chrome body — a vertical light→dark gradient across the thickness = metal, not glow
        const cg = ctx.createLinearGradient(0, ny - capW * 0.5, 0, ny + capW * 0.5);
        cg.addColorStop(0, '#f3efe9'); cg.addColorStop(0.4, '#d8d2cb'); cg.addColorStop(0.5, '#ece7e3'); cg.addColorStop(0.62, '#b7b0a8'); cg.addColorStop(1, '#6f6862');
        ctx.strokeStyle = cg; ctx.lineWidth = capW;
        ctx.beginPath(); ctx.moveTo(x0, ny); ctx.lineTo(x1, ny); ctx.stroke();
        // 3) warm-white sheen along the top edge
        ctx.strokeStyle = 'rgba(255,250,244,0.75)'; ctx.lineWidth = Math.max(1, capW * 0.18);
        ctx.beginPath(); ctx.moveTo(x0, ny - capW * 0.28); ctx.lineTo(x1, ny - capW * 0.28); ctx.stroke();
        ctx.restore();
      }
      // build29: lane-colored comet trail streaming up the string behind the MARBLE (approaching only) — matches
      // the ball's lane color so the streak reads as that ball's motion, with a hot-white core speed-line on top.
      if (!held && !fxLite && !reduceMotion) {   // build71: gate the comet trail (2 gradients + shadowBlur strokes per note per frame) for perf/a11y users — matches the sibling string-glow & accent-aura gates
        const dTail = Math.min(1.10, d + 0.24);
        const tx = noteX(n.lane, dTail), ty = noteY(dTail);
        const rgb = n.type === 'star' ? '255,150,60' : LANE_COLORS[n.lane].rgb;
        const grad = ctx.createLinearGradient(nx, ny, tx, ty);
        grad.addColorStop(0, 'rgba(' + rgb + ',' + (0.42 * sc).toFixed(3) + ')');
        grad.addColorStop(0.5, 'rgba(' + rgb + ',' + (0.15 * sc).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        // wide lane-colored glow tapering up the lane
        ctx.strokeStyle = grad; ctx.lineWidth = lw * 0.46 * sc * 0.78;
        ctx.shadowColor = 'rgba(' + rgb + ',0.7)'; ctx.shadowBlur = 8 * sc;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(tx, ty); ctx.stroke();
        // thin hot-white core — the speed-line that reinforces the ball rushing the player
        const wgrad = ctx.createLinearGradient(nx, ny, tx, ty);
        wgrad.addColorStop(0, 'rgba(255,255,255,' + (0.38 * sc).toFixed(3) + ')'); wgrad.addColorStop(0.6, 'rgba(255,255,255,0)');
        ctx.strokeStyle = wgrad; ctx.lineWidth = Math.max(1, lw * 0.11 * sc); ctx.shadowBlur = 5 * sc;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.restore();
      }
      // HOLD sustain — a glowing MOLTEN ENERGY BEAM up the lane: soft feathered crimson
      // edges, a hot white core, and lava pulses flowing down toward the catcher. While
      // held it retracts into the catcher as it pays out; brightens once struck.
      if ((n.type === 'hold' || n.type === 'rail') && n.hold > 0) {
       const struck = held || resolving;
       if (n.type === 'rail' && n.rail && n.rail.length >= 2) {
        // ---- RAIL RIBBON (SLIDE RAILS, spec A3.2): the hold-beam layer stack bent along the moving path. Time→laneF
        // is piecewise-constant per segment, smoothstepped across each transfer's bend window [wt−0.6·TW, wt+TW] — the
        // visual bend width IS the input slack, so the ribbon teaches the transfer timing with zero UI. Per-sub-segment
        // lane tint cross-fades across the bend (your finger is now on THIS string). railX keeps every endpoint on the
        // measured strings. Struck → retracts from the catcher (relStart advances); dropped → the resolving dim.
        const rail = n.rail, railTW = RAIL_TW[difficulty] || 0.18;
        const railLaneAt = (rel) => {
          let laneF = rail[0].lane;
          for (let k = 0; k < rail.length; k++) { if (rail[k].t <= rel) laneF = rail[k].lane; else break; }
          for (let k = 1; k < rail.length; k++) { const w0 = rail[k].t - 0.6 * railTW, w1 = rail[k].t + railTW; if (rel >= w0 && rel <= w1) { const s = (rel - w0) / (w1 - w0); laneF = rail[k - 1].lane + (rail[k].lane - rail[k - 1].lane) * (s * s * (3 - 2 * s)); break; } }
          return laneF;
        };
        const relStart = struck ? Math.max(0, t - n.time) : 0, NP = 14;
        const pts = _railScratch; let np = 0;
        for (let s = 0; s <= NP; s++) {
          const rel = relStart + (n.hold - relStart) * (s / NP);
          let dPt = (n.time + rel - t) / approach; if (struck) dPt = Math.max(0, dPt);
          const lf = railLaneAt(rel), p = pts[np++];
          p.x = railX(lf, dPt); p.y = noteY(dPt); p.sc = depthScale(dPt); p.lane = Math.max(0, Math.min(LANE_COUNT - 1, Math.round(lf)));
        }
        const aM = resolving ? 0.30 : ((held || (n.hit && n.hit !== 'miss')) ? 1 : 0.78);
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalCompositeOperation = 'lighter';
        const strokePoly = (wf, af, blur) => {
          for (let s = 1; s < np; s++) {
            const a = pts[s - 1], b = pts[s], lc = resolving ? '150,58,58' : LANE_COLORS[a.lane].rgb;
            ctx.strokeStyle = 'rgba(' + lc + ',' + (af * aM).toFixed(3) + ')'; ctx.lineWidth = lw * wf * (0.7 + 0.3 * a.sc);
            ctx.shadowColor = 'rgb(' + lc + ')'; ctx.shadowBlur = blur;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        };
        strokePoly(0.348, 0.11, 12);   // soft outer feather (0.24*1.45)
        strokePoly(0.204, 0.30, 6);    // tighter inner feather (0.24*0.85)
        if (!resolving) {
          ctx.shadowBlur = 6; ctx.strokeStyle = 'rgba(255,236,214,' + (held ? 0.85 : 0.45) + ')'; ctx.lineWidth = lw * 0.12;
          ctx.setLineDash([lw * 0.19, lw * 0.62]); ctx.lineDashOffset = -((performance.now() * 0.22) % 100000);
          ctx.beginPath(); for (let s = np - 1; s >= 0; s--) { const p = pts[s]; if (s === np - 1) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.shadowBlur = 3; ctx.strokeStyle = 'rgba(255,248,244,' + (resolving ? 0.24 : (held ? 0.9 : 0.58)) + ')'; ctx.lineWidth = Math.max(1, lw * 0.041);
        ctx.beginPath(); for (let s = 0; s < np; s++) { const p = pts[s]; if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } ctx.stroke();
        ctx.restore();
        // BEND CHEVRONS at upcoming transfers — the in-world "slide ▸" cue; renders under fxLite/reduceMotion too.
        for (let k = 1; k < rail.length; k++) {
          if (rail[k].t <= relStart + 0.01) continue;
          let dPt = (n.time + rail[k].t - t) / approach; if (struck) dPt = Math.max(0, dPt);
          if (dPt > 1.04 || dPt < -0.05) continue;
          const scc = depthScale(dPt), bx = railX((rail[k - 1].lane + rail[k].lane) / 2, dPt), by = noteY(dPt);
          const dir = (railX(rail[k].lane, dPt) >= railX(rail[k - 1].lane, dPt)) ? 1 : -1, L = lw * 0.34 * scc;
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,244,224,0.9)'; ctx.lineWidth = Math.max(1.2, lw * 0.09 * scc); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(bx - dir * L * 0.6, by - L * 0.55); ctx.lineTo(bx + dir * L * 0.5, by); ctx.lineTo(bx - dir * L * 0.6, by + L * 0.55); ctx.stroke();
          ctx.restore();
        }
       } else {
        const dEnd = struck
          ? Math.max(0, (n.time + n.hold - t) / approach)   // remaining length, retracting into the catcher
          : Math.min(1.04, d + n.hold / approach);          // full tail ahead of the head
        const hx = noteX(n.lane, dEnd), hy = noteY(dEnd);
        const lit = held || (!resolving && n.hit && n.hit !== 'miss');  // brighten while held; NOT when dropped
        // build36 (polish): SLIMMER beam — fewer, narrower glow layers + less blur than the old fat
        // 3-layer crimson slab, and LANE-TINTED so a held sustain matches its marble (yellow note →
        // yellow beam, etc.) instead of always reading crimson. Keeps the hot white core + molten pulses.
        const wB = lw * 0.24 * (0.7 + 0.3 * sc);             // slimmer base (was 0.30)
        const aM = resolving ? 0.30 : (lit ? 1 : 0.78);      // dropped beam = dim & dying
        const lc = resolving ? '150,58,58' : LANE_COLORS[n.lane].rgb;   // match the note's lane (was hardcoded crimson)
        ctx.save(); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
        ctx.shadowColor = 'rgb(' + lc + ')';
        const beam = (w, col, blur) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.shadowBlur = blur; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(hx, hy); ctx.stroke(); };
        // two feathered lane-color layers (soft outer → tighter inner) — additive = soft edges, no slab
        beam(wB * 1.45, 'rgba(' + lc + ',' + (0.11 * aM).toFixed(3) + ')', 12);
        beam(wB * 0.85, 'rgba(' + lc + ',' + (0.30 * aM).toFixed(3) + ')', 6);
        if (!resolving) {
          // molten pulses flowing DOWN the beam toward the catcher (animated dashes) — slimmer, warm-white
          ctx.shadowBlur = 6;
          ctx.strokeStyle = 'rgba(255,236,214,' + (lit ? 0.85 : 0.45) + ')';
          ctx.lineWidth = wB * 0.5;
          ctx.setLineDash([wB * 0.8, wB * 2.6]);
          ctx.lineDashOffset = -((performance.now() * 0.22) % 100000);  // scroll toward the head
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(nx, ny); ctx.stroke();
          ctx.setLineDash([]);
        }
        // thin hot-white core thread (cool & faint when dropped)
        beam(Math.max(1, wB * 0.17), 'rgba(255,248,244,' + (resolving ? 0.24 : (lit ? 0.9 : 0.58)) + ')', 3);
        ctx.restore();
       }
      }
      // build7: soft accent aura behind a note as it nears the catcher (additive; Quick Play / fxLite skip).
      // Radius uses the SAME note size as drawNote (lw*0.46*sc), so the halo tracks the sphere exactly.
      if (!resolving && levelAccentRGB && !fxLite && d < 0.55) {
        const aa = (0.55 - d) / 0.55 * 0.16;
        if (aa > 0.01) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const rr = lw * 0.46 * sc * 2.0;
          const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, rr);
          ng.addColorStop(0, 'rgba(' + levelAccentRGB + ',' + aa.toFixed(3) + ')');
          ng.addColorStop(1, 'rgba(' + levelAccentRGB + ',0)');
          ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(nx, ny, rr, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
      if (!resolving && !(n.type === 'rail' && held)) {   // SLIDE RAILS: a struck rail's head has retracted — the ribbon + catcher glow carry it (no gem at the old lane)
        // T6 grammar: stash the head's live hold state so drawNote can render the grip-ring + draining arc (banked
        // fraction = holdScored on the head lane; 0 while still approaching). Render-only; judging never reads these.
        if (n.type === 'hold' || n.type === 'rail') { n._hheld = held; n._hres = resolving; n._hbank = (held || resolving) ? (holdScored[n.lane] || 0) : 0; }
        // build109 s2 Step D: travel-axis angle for the approach squash/stretch (visual only — drawNote
        // reads d/angle purely for the transform; hit-judgment geometry stays keyed to nx/ny/note.time
        // elsewhere and is untouched by this). Cheap: one extra noteY sample already using cached fn refs.
        const _travelAng = Math.atan2(noteY(Math.max(0, d - 0.05)) - ny, noteX(n.lane, Math.max(0, d - 0.05)) - nx);
        drawNote(nx, ny, lw * 0.46 * sc, n, d, _travelAng);
      }
    }

    for (const p of particles) {
      const a = 1 - p.age / p.life;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (p.flash) {   // build64: crisp additive CORE FLASH disc — the brightest, sharpest moment of the hit
        const fa = a * a, fr = p.max * (0.5 + 0.5 * (p.age / p.life));
        const fgr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, fr);
        fgr.addColorStop(0, 'rgba(' + p.color + ',' + fa.toFixed(3) + ')');
        fgr.addColorStop(0.45, 'rgba(' + p.color + ',' + (fa * 0.55).toFixed(3) + ')');
        fgr.addColorStop(1, 'rgba(' + p.color + ',0)');
        ctx.fillStyle = fgr; ctx.beginPath(); ctx.arc(p.x, p.y, fr, 0, Math.PI * 2); ctx.fill();
      } else if (p.ring) {
        // build109 s3: cubic ease-out expansion (was linear r=(age/life)*max) — a SINGLE shared change
        // that upgrades every ring particle at once (perfect-hit double-crack, every 25-combo ripple, the
        // OD shockwave — they all route through this one primitive). Linear read mechanical; cubic-out
        // reads like an impact: fast initial expansion that decelerates, same curve already used at the
        // wipeout/mass-fail site. Alpha now peaks early (sin ramp) and decays instead of a flat a*0.8, so
        // the ring's brightness arcs with its motion instead of just fading on a timer.
        const _t = p.age / p.life;
        const _e = 1 - Math.pow(1 - _t, 3);
        const r = _e * p.max;
        const _ringA = Math.sin(Math.PI * Math.pow(_t, 0.7)) * 0.8;   // build109 s4 review: was Math.min(1,_t*1.4) which clamped the sine arg at PI from _t≈0.71 on, pinning alpha to 0 for the last ~29% of life (invisible wasted strokes + an abrupt snap-out). pow(_t,0.7) peaks early (~38% of life) and reaches 0 EXACTLY at end-of-life — same "arc up then fade" intent, no dead tail.
        ctx.strokeStyle = 'rgba(' + p.color + ',' + _ringA.toFixed(3) + ')'; ctx.lineWidth = 2.5 * a + 0.5;
        ctx.shadowColor = 'rgb(' + p.color + ')'; ctx.shadowBlur = 14 * a;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.column) {
        const h = ch * 0.5;
        const grd = ctx.createLinearGradient(0, p.y, 0, p.y - h);
        grd.addColorStop(0, 'rgba(' + p.color + ',' + (a * 0.5) + ')'); grd.addColorStop(1, 'rgba(' + p.color + ',0)');
        ctx.fillStyle = grd; ctx.fillRect(p.x - p.w * 0.4, p.y - h, p.w * 0.8, h);
      } else if (p.frag) {
        // tumbling rock fragment with a hot rim
        ctx.globalCompositeOperation = 'source-over';
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        const s = p.size;
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.85, s * 0.5); ctx.lineTo(-s * 0.7, s * 0.7); ctx.closePath();
        ctx.fillStyle = 'rgba(' + rgbScale(p.color, 0.4) + ',' + a + ')'; ctx.fill();
        ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(' + rgbScale(p.color, 1.7) + ',' + a + ')'; ctx.stroke();
      } else if (p.kit) {   // build65 (VFX 2.0): a SHAPED kit particle with perspective depth
        const s3 = 1 + (p.z || 0);                                   // toward-camera particles GROW (fake-3D)
        const sz = p.size * s3 * (p.grow ? (0.55 + (1 - a) * 1.1) : (0.45 + 0.55 * a));
        let pa = a; if (p.grow) pa = a * Math.max(0, 1 - (p.z || 0) * 0.45);   // fade as it flies past the lens
        if (p.capMul != null && p.capMul < 1) pa *= p.capMul;   // build109 s3: additive-brightness budget cap (cheap version) — only the OD ember stream opts in via capMul
        ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
        const sh = p.shape;
        if (sh === 'ember' || sh === 'mote') {
          const gs = _glowSprite(p.glow || p.color), R = sz * 2.4;
          ctx.globalAlpha = pa * 0.92; ctx.drawImage(gs, p.x - R, p.y - R, R * 2, R * 2); ctx.globalAlpha = 1;
          const sp = Math.hypot(p.vx, p.vy) || 1, len = Math.min(20, sp * 0.022);
          ctx.strokeStyle = 'rgba(' + p.color + ',' + (pa * 0.8).toFixed(3) + ')'; ctx.lineWidth = Math.max(0.7, sz * 0.7); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx / sp * len, p.y - p.vy / sp * len); ctx.stroke();
        } else if (sh === 'glint') {
          ctx.strokeStyle = 'rgba(' + p.color + ',' + pa.toFixed(3) + ')'; ctx.lineWidth = Math.max(0.7, sz * 0.34); ctx.lineCap = 'round';
          const L = sz * 2.1;
          ctx.beginPath(); ctx.moveTo(p.x - L, p.y); ctx.lineTo(p.x + L, p.y); ctx.moveTo(p.x, p.y - L); ctx.lineTo(p.x, p.y + L); ctx.stroke();
          const gs = _glowSprite(p.glow || p.color), R = sz * 1.1; ctx.globalAlpha = pa; ctx.drawImage(gs, p.x - R, p.y - R, R * 2, R * 2); ctx.globalAlpha = 1;
        } else if (sh === 'wisp') {
          // build65 PERF: reuse the CACHED glow sprite stretched into a vertical flame-lick (was a per-particle
          // per-frame createLinearGradient — the violet/Skully kit's whole burst is wisps, so that was the one
          // un-cached gradient the _glowSprite cache was meant to kill). Curl via rotate.
          ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.age * 6 + p.rot) * 0.5);
          const gw = _glowSprite(p.glow || p.color), ww = sz * 1.7, wh = sz * 3.8;
          ctx.globalAlpha = pa * 0.85; ctx.drawImage(gw, -ww / 2, -wh * 0.72, ww, wh); ctx.globalAlpha = 1;
        } else if (sh === 'shard') {
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.beginPath(); ctx.moveTo(0, -sz * 1.3); ctx.lineTo(sz * 0.7, sz * 0.5); ctx.lineTo(-sz * 0.55, sz * 0.8); ctx.closePath();
          ctx.fillStyle = 'rgba(' + rgbScale(p.color, 0.7) + ',' + pa.toFixed(3) + ')'; ctx.fill();
          ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(' + (p.glow || rgbScale(p.color, 1.6)) + ',' + pa.toFixed(3) + ')'; ctx.stroke();
        } else if (sh === 'paw') {
          _drawPaw(p.x, p.y, sz * 1.5, 'rgba(' + p.color + ',' + pa.toFixed(3) + ')');
        } else if (sh === 'heart') {
          _drawHeart(p.x, p.y, sz, 'rgba(' + p.color + ',' + pa.toFixed(3) + ')');
        } else if (sh === 'smoke') {
          const gs = _glowSprite(p.color), R = sz * 2.6; ctx.globalAlpha = pa * 0.16; ctx.drawImage(gs, p.x - R, p.y - R, R * 2, R * 2); ctx.globalAlpha = 1;
        } else {   // 'glob' — blood drop: filled body + darker depth + a tiny wet highlight
          ctx.fillStyle = 'rgba(' + p.color + ',' + pa.toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(' + (p.glow || p.color) + ',' + (pa * 0.5).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(p.x - sz * 0.3, p.y - sz * 0.3, sz * 0.34, 0, Math.PI * 2); ctx.fill();
        }
      } else {   // build64: crisp SPARK — a velocity-stretched streak (default) or a round dab (drop=blood / paw=cat themes)
        const ae = a * a, sz = p.size * (0.35 + 0.65 * a);
        if (p.shape === 'drop' || p.shape === 'paw') {
          ctx.fillStyle = 'rgba(' + p.color + ',' + ae.toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, sz * (p.shape === 'paw' ? 1.5 : 1.15), 0, Math.PI * 2); ctx.fill();
        } else {
          const sp = Math.hypot(p.vx, p.vy) || 1, len = Math.min(26, sp * 0.02), ux = p.vx / sp, uy = p.vy / sp;
          ctx.strokeStyle = 'rgba(' + p.color + ',' + ae.toFixed(3) + ')'; ctx.lineWidth = Math.max(0.6, sz); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - ux * len, p.y - uy * len); ctx.stroke();
        }
      }
      ctx.restore();
    }

    // ambient dust drifting toward the player (depth + speed)
    // (ambient embers come from the background image now)

    // 3B-i: MID-STREAK PULSE — a SMALLER cue than the milestone lightning (no bolts), keeping the 11-24
    // (and every post-milestone) dead zone alive. A brief warm gold band rising off the catcher row + a
    // light edge glow. Additive, capped, decays fast (~0.34s). Cosmetic only — never touches scoring.
    if (comboMidT > 0 && state === 'playing') {
      const ma = comboMidT / 0.34;            // 1 → 0
      const cy = fretGeom().nearY;
      const bg = ctx.createLinearGradient(0, cy + ch * 0.04, 0, cy - ch * 0.34);
      bg.addColorStop(0, 'rgba(255,206,120,' + (0.20 * ma).toFixed(3) + ')');
      bg.addColorStop(1, 'rgba(255,210,130,0)');
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    // LIGHTNING STRIKE on a combo milestone — jagged bolts + a hot flash down the playfield
    if (lightningT > 0) {
      const la = lightningT / 0.3;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,220,150,' + (la * 0.13) + ')'; ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = 'rgba(255,242,205,' + (la * 0.9) + ')'; ctx.lineWidth = 2 + la * 2.5;
      ctx.shadowColor = '#ffd98a'; ctx.shadowBlur = 20 * la; ctx.lineCap = 'round';
      for (let b = 0; b < 2; b++) {
        let x = cw * 0.5 + (b ? -1 : 1) * cw * 0.13;
        ctx.beginPath(); ctx.moveTo(x, 0);
        for (let y = 36; y <= ch; y += 38) { x += (Math.random() - 0.5) * 46; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.restore();
    }

    // build116 p1: INCOMING MP-COMBAT SHOCK — same jagged-bolt renderer as the combo-milestone strike above, but
    // tinted crimson (not gold) + a touch wider so it reads as "you got hit" rather than "you earned this."
    if (lightningHitT > 0) {
      const lb = lightningHitT / 0.55;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,42,48,' + (lb * 0.16) + ')'; ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = 'rgba(255,120,110,' + (lb * 0.95) + ')'; ctx.lineWidth = 3 + lb * 3.2;
      ctx.shadowColor = '#ff1f2e'; ctx.shadowBlur = 26 * lb; ctx.lineCap = 'round';
      for (let b = 0; b < 3; b++) {
        let x = cw * (0.22 + b * 0.28) + (Math.random() - 0.5) * 30;
        ctx.beginPath(); ctx.moveTo(x, 0);
        for (let y = 30; y <= ch; y += 34) { x += (Math.random() - 0.5) * 52; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.restore();
    }

    // soft vignette to seat the playfield (image already has its own). build121 PERF: this radial
    // gradient depends only on cw/ch (both fixed for the run except on resize()), so cache the
    // gradient OBJECT and only rebuild when cw/ch actually change (resize() also nulls it directly).
    // Same fillRect every frame — identical pixels, one fewer gradient allocation/frame.
    if (!_vigGrad || _vigCw !== cw || _vigCh !== ch) {
      _vigGrad = ctx.createRadialGradient(cw / 2, ch * 0.56, ch * 0.3, cw / 2, ch * 0.56, ch * 0.82);
      _vigGrad.addColorStop(0, 'rgba(0,0,0,0)'); _vigGrad.addColorStop(1, 'rgba(0,0,0,0.32)');
      _vigCw = cw; _vigCh = ch;
    }
    ctx.fillStyle = _vigGrad; ctx.fillRect(0, 0, cw, ch);

    // COMBO HEAT — the screen edges glow hotter (crimson) as your multiplier climbs (x1→x4).
    // Additive + crimson so it reads as brand energy, never purple; reduce-motion dials it back.
    if (state === 'playing') {
      const heat = Math.min(1, Math.max(0, (curMult() - 1) / 3));
      if (heat > 0.01) {
        const pulse = reduceMotion ? 1 : (0.85 + 0.15 * Math.sin(performance.now() / 130));
        const hg = ctx.createRadialGradient(cw / 2, ch * 0.56, ch * 0.34, cw / 2, ch * 0.56, ch * 0.85);
        hg.addColorStop(0, 'rgba(255,40,46,0)');
        hg.addColorStop(1, 'rgba(205,22,30,' + (0.32 * heat * pulse).toFixed(3) + ')');
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = hg; ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
      }
    }

    // BEAT BLOOM — the whole frame breathes on the beat (Hi-Fi Rush "everything on the beat"): a gentle
    // full-screen additive wash keyed to the live bgPulse, using the level accent (crimson default), so it
    // works on EVERY stage (themed video included) and even at 1x multiplier. Subtle cap + reduce-motion
    // floor so it can never read as a strobe; skipped in fx-lite (perf) mode.
    if (state === 'playing' && !fxLite) {
      const bb = reduceMotion ? Math.min(0.18, bgPulse) * 0.4 : bgPulse;
      if (bb > 0.02) {
        const _ac = levelAccentRGB || '255,31,46';
        const bbg = ctx.createRadialGradient(cw / 2, ch * 0.52, ch * 0.30, cw / 2, ch * 0.52, ch * JUICE.bloomR);
        bbg.addColorStop(0, 'rgba(' + _ac + ',0)');
        bbg.addColorStop(1, 'rgba(' + _ac + ',' + (JUICE.bloom * Math.min(1, bb)).toFixed(3) + ')');
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = bbg; ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
      }
    }

    // OVERDRIVE window: warm gold edge-glow framing the whole screen (on-brand, warm,
    // additive so it never reads purple). Pulses unless reduce-motion is on.
    // build92: FINAL-SECONDS BURN-DOWN — in the last odWarnAt seconds the pulse quickens and the
    // edge lerps gold→crimson (#ff1f2e, pure-red hue ~356°, never purple) as the meter empties — a
    // wordless OD countdown. Cosmetic only: odTimer is READ here, never written; scoring/activation untouched.
    if (odActive) {
      const warn = JUICE.odWarnAt > 0 ? Math.max(0, Math.min(1, 1 - (odTimer / JUICE.odWarnAt))) : 0;   // 0 until <odWarnAt left, →1 as it empties
      const period = reduceMotion ? 1 : 140 / (1 + warn);   // faster pulse as it burns down; motion floored under reduce-motion
      const pulse = reduceMotion ? 0.5 : (0.5 + 0.5 * Math.sin(performance.now() / period));
      const a = JUICE.odVig + JUICE.odVigPulse * pulse;
      // color burn gold(255,180,90)→crimson(255,31,46). A static color shift (not motion) → applies under reduce-motion too.
      const eg = Math.round(180 + (31 - 180) * warn), eb = Math.round(90 + (46 - 90) * warn);    // edge stop
      const ig = Math.round(200 + (31 - 200) * warn), ib = Math.round(120 + (46 - 120) * warn);  // inner stop (alpha 0)
      const og = ctx.createRadialGradient(cw / 2, ch * 0.5, ch * 0.34, cw / 2, ch * 0.5, ch * 0.8);
      og.addColorStop(0, 'rgba(255,' + ig + ',' + ib + ',0)');
      og.addColorStop(1, 'rgba(255,' + eg + ',' + eb + ',' + a.toFixed(3) + ')');
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = og; ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    // OVERDRIVE IGNITION — a one-shot screen-flooding beat the instant Star Power fires: a fast white-gold
    // flash + (full-motion only) an expanding gold shockwave ring racing out from the catcher row. odBurst 1→0.
    if (odBurst > 0.01) {
      const ob = odBurst;
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(255,226,160,' + (JUICE.odFlash * ob * ob).toFixed(3) + ')';
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
      if (!reduceMotion) {
        const rw = (1 - ob) * Math.hypot(cw, ch) * JUICE.odRing;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,206,120,' + (0.55 * ob).toFixed(3) + ')';
        ctx.lineWidth = 2 + 10 * ob;
        ctx.beginPath(); ctx.arc(cw / 2, ch * 0.56, Math.max(1, rw), 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }

    // 3B-i: OVERDRIVE READY — a stronger ON-HIGHWAY banner the moment the meter fills, so the player
    // knows Space is armed without hunting the HUD chip. Brand gold/crimson, pulsing, sits just above the
    // catcher row (over the playfield, not full-screen). Cosmetic gate only — Space already fires OD.
    if (state === 'playing' && overdrive >= 1 && !odActive) {
      const fgr = fretGeom();
      const cx = fgr.gx + fgr.gw * 0.5;
      const by = fgr.nearY - fgr.lw * 2.6;                       // ride above the catcher buttons
      const pulse = reduceMotion ? 0.85 : (0.72 + 0.28 * Math.sin(performance.now() / 150));
      const w = Math.min(cw * 0.82, fgr.gw * 1.04), h = Math.max(34, fgr.lw * 1.3);
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // pill backdrop (warm dark, gold-rimmed) so the text reads on any backdrop
      const rr = h * 0.5, x0 = cx - w / 2, y0 = by - h / 2;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.moveTo(x0 + rr, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, rr);
      ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, rr); ctx.arcTo(x0, y0 + h, x0, y0, rr);
      ctx.arcTo(x0, y0, x0 + w, y0, rr); ctx.closePath();
      ctx.fillStyle = 'rgba(26,10,6,' + (0.62 * pulse).toFixed(3) + ')'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,206,120,' + (0.55 + 0.4 * pulse).toFixed(3) + ')'; ctx.stroke();
      // headline
      const fs = Math.max(15, Math.round(h * 0.46));
      ctx.font = '800 ' + fs + "px 'Oxanium', sans-serif";
      ctx.shadowColor = 'rgba(255,180,80,0.9)'; ctx.shadowBlur = 16 * pulse;
      ctx.fillStyle = 'rgba(255,224,150,' + (0.9 + 0.1 * pulse).toFixed(3) + ')';
      ctx.fillText('▸ OVERDRIVE READY', cx, by - h * 0.06);
      // key-cue sub-line (brand crimson)
      ctx.shadowBlur = 0;
      ctx.font = '700 ' + Math.max(10, Math.round(fs * 0.6)) + "px 'Chakra Petch', sans-serif";
      ctx.fillStyle = 'rgba(255,80,70,' + (0.78 + 0.22 * pulse).toFixed(3) + ')';
      // build89: touch players activate OD by tapping the flame (there is no Space key) — adapt the cue
      ctx.fillText(document.body.classList.contains('has-touch') ? 'TAP THE FLAME' : 'PRESS  SPACE', cx, by + h * 0.34);
      ctx.restore();
    }

    // MISS edge-vignette — a brief crimson frame pulse on a missed note / combo break (brand crimson).
    if (missFlash > 0.01) {
      const mv = Math.min(1, missFlash);
      const vg = ctx.createRadialGradient(cw / 2, ch / 2, ch * 0.32, cw / 2, ch / 2, ch * 0.86);
      vg.addColorStop(0, 'rgba(255,31,46,0)');
      vg.addColorStop(1, 'rgba(255,31,46,' + (0.30 * mv).toFixed(3) + ')');
      ctx.save(); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
    // MASS-FAIL "wipeout" surge — a stronger full-screen crimson flash that snaps to cold.
    if (wipeoutT > 0.01) {
      const wv = Math.min(1, wipeoutT);
      ctx.save(); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(120,10,16,' + (0.34 * wv).toFixed(3) + ')';
      ctx.fillRect(0, 0, cw, ch);
      const wg = ctx.createRadialGradient(cw / 2, ch * 0.62, 0, cw / 2, ch * 0.62, cw * (0.3 + 0.5 * wv));
      wg.addColorStop(0, 'rgba(255,40,46,' + (0.22 * wv).toFixed(3) + ')');
      wg.addColorStop(1, 'rgba(255,40,46,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = wg; ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
    if (glitchAmount > 0.05) {
      const tears = 3 + Math.floor(glitchAmount * 6);
      for (let i = 0; i < tears; i++) {
        const ty = Math.random() * ch; const th = 2 + Math.random() * 10; const dx = (Math.random() - 0.5) * 20 * glitchAmount;
        ctx.fillStyle = 'rgba(255, 31, 46, ' + (glitchAmount * 0.15) + ')'; ctx.fillRect(0, ty, cw, th);
        ctx.fillStyle = 'rgba(224, 218, 214, ' + (glitchAmount * 0.10) + ')'; ctx.fillRect(dx, ty + th * 0.5, cw, 1);
      }
    }
    // DEV (?align=1, strip at freeze): lane guides over the art — dashed lane lines, the catcher row,
    // and a dot on each catcher, so skin/string alignment can be eyeballed instantly.
    if (window.__rrAlign) {
      ctx.save(); ctx.setLineDash([6, 5]); ctx.lineWidth = 1.25; ctx.strokeStyle = '#3affc3';
      for (let i = 0; i < LANE_COUNT; i++) { ctx.beginPath(); ctx.moveTo(noteX(i, 0), noteY(0)); ctx.lineTo(noteX(i, 1), noteY(1)); ctx.stroke(); }
      ctx.setLineDash([]); ctx.strokeStyle = '#ffd23c';
      ctx.beginPath(); ctx.moveTo(nearX[0] - 30, nearY); ctx.lineTo(nearX[LANE_COUNT - 1] + 30, nearY); ctx.stroke();
      ctx.fillStyle = '#3affc3';
      for (let i = 0; i < LANE_COUNT; i++) { ctx.beginPath(); ctx.arc(nearX[i], nearY, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    // FLIPBOOK FX — additive sprite layer composited over the scene, inside the camera-shake
    // transform so bursts ride the shake. No-op until fx-player.js settles its sheets.
    if (fx) { try { fx.draw(ctx, performance.now()); } catch (e) {} }
    ctx.restore();
    if (isPaused) { ctx.fillStyle = 'rgba(7,6,10,0.6)'; ctx.fillRect(0, 0, cw, ch); }
    _fgFrameCache = null;   // build121 PERF: end of this tick's memo window — every other call site (dev hooks, click/hit handlers) keeps computing fresh
  }

  // Per-lane vibrating "guitar string" running from the top down to the receptor.
  // Idle = faint shimmer; on a hit the lane's string is plucked (standing wave that
  // decays), so hitting a note literally vibrates the string in that lane.
  function drawStrings(margin, lw, hitY, pX, pY, pn) {
    const gt = performance.now() / 1000;
    const omega = 2 * Math.PI * 7; // ~7 Hz pluck vibration
    const segs = 22;
    for (let i = 0; i < LANE_COUNT; i++) {
      const nearC = margin + i * lw + lw / 2;
      const tp = lanePluckT[i];
      const env = Math.exp(-6 * tp);            // pluck envelope (~0.4s)
      const pluckA = env * lw * 0.34;
      const idleA = 1.3;
      ctx.save();
      ctx.strokeStyle = 'rgba(' + LANE_COLORS[i].rgb + ',' + (0.16 + env * 0.7) + ')';
      ctx.lineWidth = 1.3 + env * 1.8;
      ctx.shadowColor = LANE_COLORS[i].c;
      ctx.shadowBlur = 4 + env * 26;
      ctx.beginPath();
      for (let s = 0; s <= segs; s++) {
        const d = s / segs;                     // 0 near (hit line) → 1 far (vanish)
        const v = pn(d);                        // 1 near → 0 far
        const shape = Math.sin(Math.PI * v);    // zero at both ends, antinode mid
        const disp = (pluckA * Math.cos(omega * tp) + idleA * Math.sin(gt * 2.2 + i + v * 3)) * shape;
        const bx = pX(nearC, d) + disp;
        const by = pY(d);
        if (s === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- pre-baked note sprites (faceted gems + gold surge star) ----------
  let gfx = null;
  function rgbScale(rgb, f) { return rgb.split(',').map(v => { let n = Math.round(parseInt(v, 10) * f); return n < 0 ? 0 : n > 255 ? 255 : n; }).join(','); }
  function hexPathOn(x, cx, cy, rr, sq) { x.beginPath(); for (let a = 0; a < 6; a++) { const ang = Math.PI / 3 * a - Math.PI / 2; const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr * sq; a === 0 ? x.moveTo(px, py) : x.lineTo(px, py); } x.closePath(); }

  function buildGem(base, lane) {
    const rgb = LANE_COLORS[lane].rgb;
    const light = rgbScale(rgb, 1.65), dark = rgbScale(rgb, 0.36);
    const r = base / 2, pad = Math.ceil(base * 0.85), S = base + pad * 2, cx = S / 2, cy = S / 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    x.save(); x.shadowColor = 'rgb(' + rgb + ')'; x.shadowBlur = base * 0.7;
    hexPathOn(x, cx, cy, r, 0.94);
    const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, 'rgb(' + light + ')'); g.addColorStop(0.5, 'rgb(' + rgb + ')'); g.addColorStop(1, 'rgb(' + dark + ')');
    x.fillStyle = g; x.fill(); x.restore();
    // facet lines from center
    x.strokeStyle = 'rgba(255,255,255,0.20)'; x.lineWidth = Math.max(1, base * 0.016);
    for (let a = 0; a < 6; a++) { const ang = Math.PI / 3 * a - Math.PI / 2; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.94); x.stroke(); }
    // upper facet highlight
    x.fillStyle = 'rgba(255,255,255,0.14)'; hexPathOn(x, cx, cy, r * 0.6, 0.94); x.fill();
    // inner core glow
    const cg = x.createRadialGradient(cx, cy - r * 0.18, 0, cx, cy, r * 0.9);
    cg.addColorStop(0, 'rgba(255,255,255,0.6)'); cg.addColorStop(0.5, 'rgba(' + light + ',0.16)'); cg.addColorStop(1, 'rgba(' + light + ',0)');
    x.fillStyle = cg; hexPathOn(x, cx, cy, r, 0.94); x.fill();
    // build28 (playtest readability): DARK OUTER RING (GH contrast cue). The white core + lane glow make the
    // gem pop on DARK guitars (Skully); this warm near-black ring makes it pop on BRIGHT guitars (Melody pink /
    // Bone bone). Drawn thick UNDER the white rim so it peeks out as a dark outline on both sides → background-proof.
    hexPathOn(x, cx, cy, r, 0.94); x.lineWidth = Math.max(2.4, base * 0.11); x.strokeStyle = 'rgba(18,7,7,0.88)'; x.stroke();
    // crisp white rim (on top of the dark ring)
    hexPathOn(x, cx, cy, r, 0.94); x.lineWidth = Math.max(1.4, base * 0.045); x.strokeStyle = 'rgba(255,255,255,0.95)'; x.stroke();
    // specular dot
    x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.ellipse(cx - r * 0.28, cy - r * 0.36, r * 0.16, r * 0.09, -0.5, 0, Math.PI * 2); x.fill();
    return { c: c, S: S };
  }

  function buildStar(base) {
    const R = base * 0.66, pad = Math.ceil(base * 0.95), S = base + pad * 2, cx = S / 2, cy = S / 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    function star(rOut, rIn) { x.beginPath(); for (let i = 0; i < 10; i++) { const ang = Math.PI / 5 * i - Math.PI / 2; const rr = i % 2 ? rIn : rOut; const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr; i === 0 ? x.moveTo(px, py) : x.lineTo(px, py); } x.closePath(); }
    x.save(); x.shadowColor = 'rgb(224,169,63)'; x.shadowBlur = base * 0.95;
    star(R, R * 0.44);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, 'rgb(255,231,160)'); g.addColorStop(0.55, 'rgb(224,169,63)'); g.addColorStop(1, 'rgb(150,90,20)');
    x.fillStyle = g; x.fill(); x.restore();
    star(R, R * 0.44); x.lineWidth = Math.max(1.4, base * 0.045); x.strokeStyle = 'rgba(255,240,200,0.95)'; x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.arc(cx, cy, R * 0.17, 0, Math.PI * 2); x.fill();
    return { c: c, S: S };
  }

  function buildGameSprites(lw) {
    const base = Math.round(Math.min(lw * 1.15, 108));   // build141: bake at a higher resolution (was lw*0.92, cap 82) so the larger GEM_K (1.8) draws crisp, not upscaled/soft. One-time bake on resize — no per-frame cost.
    // build28: cache the BRIGHT per-lane faceted gems (GH-style: lane color + white core + dark ring + glow)
    // and the gold surge star. These are the high-contrast notes that pop on ANY guitar (replacing the dark
    // obsidian sphere + the blend-into-guitar theme tint). Rebuilt on resize/profile change; LANE_COLORS is
    // live by here (buildGameSprites runs from the draw loop, after applyLaneProfile set the gh palette).
    const gems = []; for (let l = 0; l < LANE_COUNT; l++) gems.push(buildMarble(base, l));   // build29: 3D marbles (was flat buildGem hexagons)
    // build109 s2 Step C: baked per-TYPE overlay canvases (transparent, same S/pad as the marble) — one
    // extra cached drawImage composited at draw time, keyed by lane so the overlay color always matches
    // the ball beneath it. Built once per resize/profile change, zero runtime cost. accent=faceted diamond
    // ring (sharper/harder read), hold=directional ticked ring toward the catcher (grab-and-hold cue before
    // the beam becomes visible), chord=chrome bridge notch (pair reads as linked before the bar renders).
    const accentOv = [], holdOv = [], chordOv = [];
    for (let l = 0; l < LANE_COUNT; l++) {
      accentOv.push(buildAccentOverlay(base, l));
      holdOv.push(buildHoldOverlay(base, l));
      chordOv.push(buildChordOverlay(base, l));
    }
    gfx = { lw: lw, base: base, gems: gems, star: buildStar(base), accentOv: accentOv, holdOv: holdOv, chordOv: chordOv };
  }

  // build109 s2 Step C: thin faceted diamond-cut ring — 5 straight chords across the face at low white
  // alpha, baked onto a transparent canvas matching buildMarble's S/pad so it drops in at the same size.
  function buildAccentOverlay(base, lane) {
    const r = base / 2, pad = Math.ceil(base * 0.85), S = base + pad * 2, cx = S / 2, cy = S / 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    x.save(); x.globalCompositeOperation = 'lighter';
    x.strokeStyle = 'rgba(255,255,255,0.15)'; x.lineWidth = Math.max(0.8, base * 0.02);
    const N = 5;
    for (let i = 0; i < N; i++) {
      const a0 = (Math.PI * 2 * i) / N - Math.PI / 2, a1 = a0 + Math.PI * 0.62;
      x.beginPath();
      x.moveTo(cx + Math.cos(a0) * r * 0.82, cy + Math.sin(a0) * r * 0.82);
      x.lineTo(cx + Math.cos(a1) * r * 0.82, cy + Math.sin(a1) * r * 0.82);
      x.stroke();
    }
    x.restore();
    return { c: c, S: S };
  }
  // build109 s2 Step C: 7 short radial ticks alternating with gaps around the rim — reads as "grab and
  // hold" from the note head alone, before the sustain beam (drawn separately) becomes visible.
  function buildHoldOverlay(base, lane) {
    const r = base / 2, pad = Math.ceil(base * 0.85), S = base + pad * 2, cx = S / 2, cy = S / 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    x.save(); x.globalCompositeOperation = 'lighter';
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = Math.max(1, base * 0.045); x.lineCap = 'round';
    const N = 7;
    for (let i = 0; i < N; i++) {
      const a = (Math.PI * 2 * i) / N;
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * r * 1.06, cy + Math.sin(a) * r * 1.06);
      x.lineTo(cx + Math.cos(a) * r * 1.18, cy + Math.sin(a) * r * 1.18);
      x.stroke();
    }
    x.restore();
    return { c: c, S: S };
  }
  // build109 s2 Step C: a small chrome bridge/notch glyph at the inner edge — the linked pair reads as
  // connected even before the chord-bar glow (drawn separately, only once both gems are on-screen) renders.
  function buildChordOverlay(base, lane) {
    const r = base / 2, pad = Math.ceil(base * 0.85), S = base + pad * 2, cx = S / 2, cy = S / 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    x.save(); x.globalCompositeOperation = 'lighter';
    x.fillStyle = 'rgba(236,231,227,0.55)';
    x.beginPath(); x.ellipse(cx, cy + r * 0.98, r * 0.22, r * 0.09, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(236,231,227,0.8)'; x.lineWidth = Math.max(0.8, base * 0.025);
    x.beginPath(); x.ellipse(cx, cy + r * 0.98, r * 0.22, r * 0.09, 0, 0, Math.PI * 2); x.stroke();
    x.restore();
    return { c: c, S: S };
  }

  // glossy obsidian note-sphere (black, crimson rim-light + bright specular) like the photo
  function buildSphere(base, hot) {
    const r = base / 2, pad = Math.ceil(base * 0.55), S = base + pad * 2, cx = S / 2, cy = S / 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    x.save(); x.shadowColor = hot ? 'rgba(255,90,60,1)' : 'rgba(255,40,40,0.85)'; x.shadowBlur = base * 0.42;
    const g = x.createRadialGradient(cx - r * 0.34, cy - r * 0.38, r * 0.08, cx, cy, r);
    if (hot) { g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, '#ff7a4a'); g.addColorStop(0.7, '#7c0c12'); g.addColorStop(1, '#190204'); }
    else { g.addColorStop(0, '#646874'); g.addColorStop(0.36, '#23252c'); g.addColorStop(0.82, '#0a0a0e'); g.addColorStop(1, '#050506'); }
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); x.restore();
    // crimson rim-light along the lower-right
    x.save(); x.globalCompositeOperation = 'lighter';
    x.lineWidth = Math.max(1.4, base * 0.05); x.strokeStyle = 'rgba(255,52,46,0.85)';
    x.shadowColor = 'rgba(255,40,40,0.9)'; x.shadowBlur = base * 0.18;
    x.beginPath(); x.arc(cx, cy, r * 0.95, Math.PI * 0.08, Math.PI * 0.92); x.stroke(); x.restore();
    // soft + sharp specular highlight (upper-left)
    x.fillStyle = 'rgba(255,255,255,0.3)'; x.beginPath(); x.ellipse(cx - r * 0.3, cy - r * 0.36, r * 0.34, r * 0.22, -0.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.ellipse(cx - r * 0.34, cy - r * 0.4, r * 0.16, r * 0.1, -0.5, 0, Math.PI * 2); x.fill();
    return { c: c, S: S };
  }

  // build29 (playtest: "make them look like 3D MARBLES rolling down at us"): a glossy lane-colored MARBLE.
  // The flat faceted hexagon (buildGem) is replaced by a shaded SPHERE — the layers that sell "3D ball" are
  // the off-center specular hotspot (key light upper-left), the dark terminator + reflected-light rim, and a
  // contact shadow; the warm near-black outer ring keeps it readable on BRIGHT guitars and the white core/rim
  // on DARK guitars (background-proof). Per-lane color from LANE_COLORS. pad matches buildGem so drawNote's
  // sizing lands it identically; it grows on approach via the existing depthScale. (researched, GH-grade.)
  function buildMarble(base, lane) {
    const rgb = LANE_COLORS[lane].rgb;
    const litCap = rgbScale(rgb, 2.1), litMid = rgbScale(rgb, 1.5), shadowCore = rgbScale(rgb, 0.30),
          reflRim = rgbScale(rgb, 0.48), light = rgbScale(rgb, 1.65);
    const r = base / 2, pad = Math.ceil(base * 0.85), S = base + pad * 2, cx = S / 2, cy = S / 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    // (0) soft contact shadow beneath the ball — grounds it as a real object
    x.save(); x.fillStyle = 'rgba(0,0,0,0.38)'; x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = base * 0.25;
    x.beginPath(); x.ellipse(cx, cy + r * 0.82, r * 1.05, r * 0.32, 0, 0, Math.PI * 2); x.fill(); x.restore();
    // (1) spherical body — offset radial gradient (lit cap upper-left → true color → shadow core → reflected rim) + lane glow
    // build109 s2 Step A: lit-cap stop widened 0.30→0.42 so the highlight reads at small (~20-40px)
    // gameplay size instead of collapsing into a pinpoint (tuned for 1:1 inspection originally).
    x.save(); x.shadowColor = 'rgb(' + rgb + ')'; x.shadowBlur = base * 0.7;
    const g = x.createRadialGradient(cx - r * 0.34, cy - r * 0.40, r * 0.06, cx, cy, r * 1.02);
    g.addColorStop(0.00, 'rgb(' + litCap + ')'); g.addColorStop(0.42, 'rgb(' + litMid + ')');
    g.addColorStop(0.68, 'rgb(' + rgb + ')'); g.addColorStop(0.88, 'rgb(' + shadowCore + ')'); g.addColorStop(1.00, 'rgb(' + reflRim + ')');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); x.restore();
    // (2) deepen the terminator (bottom-right falls into shadow) — clipped to the ball
    x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
    const tg = x.createRadialGradient(cx + r * 0.42, cy + r * 0.48, r * 0.08, cx + r * 0.28, cy + r * 0.34, r * 1.25);
    tg.addColorStop(0, 'rgba(0,0,0,0.45)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = tg; x.fillRect(0, 0, S, S); x.restore();
    // (3) fresnel reflected-light rim along the lower-right (additive)
    x.save(); x.globalCompositeOperation = 'lighter'; x.lineWidth = Math.max(1.3, base * 0.05);
    x.strokeStyle = 'rgba(' + light + ',0.7)'; x.shadowColor = 'rgb(' + rgb + ')'; x.shadowBlur = base * 0.12;
    x.beginPath(); x.arc(cx, cy, r * 0.94, Math.PI * 0.06, Math.PI * 0.94); x.stroke(); x.restore();
    // (4) warm near-black OUTER RING — pops on BRIGHT guitars. build109 s2 Step A: widened + darkened for
    // silhouette crispness at small size (was base*0.11 @ rgba(18,7,7,0.85)).
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.lineWidth = Math.max(2.6, base * 0.14); x.strokeStyle = 'rgba(10,4,4,0.92)'; x.stroke();
    // (5) thin white top rim
    x.beginPath(); x.arc(cx, cy, r * 0.93, Math.PI * 1.04, Math.PI * 1.96); x.lineWidth = Math.max(1, base * 0.03); x.strokeStyle = 'rgba(255,255,255,0.55)'; x.stroke();
    // (6) two-stage specular hotspot (upper-left) — the #1 "this is a 3D ball" cue. build109 s2 Step A:
    // hotter core alpha + tighter falloff radius = a crisper point-light hit at gameplay size.
    x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.ellipse(cx - r * 0.30, cy - r * 0.36, r * 0.30, r * 0.20, -0.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,1.0)'; x.beginPath(); x.ellipse(cx - r * 0.32, cy - r * 0.38, r * 0.10, r * 0.065, -0.5, 0, Math.PI * 2); x.fill();
    // (7) one thin pure-white micro-rim arc at the very top edge — the classic "billiard ball" cue that
    // survives downscaling because it's edge-anchored (a crisp stroke), not gradient-anchored like (6).
    x.beginPath(); x.arc(cx, cy, r * 0.99, -0.95 * Math.PI, -0.05 * Math.PI);
    x.lineWidth = Math.max(1, base * 0.018); x.strokeStyle = 'rgba(255,255,255,0.7)'; x.stroke();
    return { c: c, S: S };
  }

  // glowing fret-catcher ring (the "button") at the bottom of a string.
  // `press` (0..1) pushes the button DOWN into the bridge and squashes it, like a
  // real fret button being struck; `pulse` lights it up.
  // build28 (playtest: the old ring-red.png catcher read as a "black box" on bright guitars): the catcher is
  // now drawn ENTIRELY in canvas as a clean, lane-colored component that pops on ANY guitar — a TRANSLUCENT
  // lane-tinted well (the guitar shows through, no opaque box), a thin dark inner ring for separation on bright
  // art, a crisp chrome rim (the clean game-component edge), an additive lane glow, and a white-cored hit flash
  // on press. Keeps the squash + push-down press feel. No ring sprites.
  function drawCatcher(x, y, r, color, pulse, breathe, press) {
    press = press || 0;
    const sc = 1 - press * 0.16;              // squash on press
    const rw = r * 1.3 * sc, rh = rw * 0.6;   // ellipse radii (perspective-squashed)
    const dy = press * r * 0.75;              // push down into the bridge
    const glow = Math.max(pulse, press);
    const rgb = color.rgb, hex = color.c;
    ctx.save(); ctx.translate(x, y + dy);
    // translucent lane-tinted body — guitar shows THROUGH (never an opaque dark box)
    const bg = ctx.createRadialGradient(0, -rh * 0.2, 0, 0, 0, rw);
    bg.addColorStop(0, 'rgba(' + rgb + ',0.34)'); bg.addColorStop(0.7, 'rgba(' + rgb + ',0.15)'); bg.addColorStop(1, 'rgba(' + rgb + ',0.05)');
    ctx.beginPath(); ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.fill();
    // thin dark inner ring — separation on BRIGHT guitars
    ctx.beginPath(); ctx.ellipse(0, 0, rw * 0.86, rh * 0.86, 0, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, r * 0.05); ctx.strokeStyle = 'rgba(18,7,7,0.7)'; ctx.stroke();
    // crisp chrome rim — the clean edge that reads on ANY background
    ctx.beginPath(); ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, r * 0.14); ctx.strokeStyle = 'rgba(236,231,227,0.92)'; ctx.stroke();
    // additive lane-color glow ring (grows with pulse/press)
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath(); ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, r * 0.16); ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.42 + 0.5 * glow).toFixed(2) + ')';
    ctx.shadowColor = hex; ctx.shadowBlur = r * (0.5 + 1.4 * glow); ctx.stroke();
    ctx.restore();
    // white-cored hit flash on press/pulse
    if (glow > 0.04) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, glow);
      const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, rw * 0.95);
      fg.addColorStop(0, 'rgba(255,255,255,0.9)'); fg.addColorStop(0.45, 'rgba(' + rgb + ',0.5)'); fg.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.beginPath(); ctx.ellipse(0, 0, rw * 0.95, rh * 0.95, 0, 0, Math.PI * 2); ctx.fillStyle = fg; ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // a jagged chunk of molten moon-rock: dark crimson stone, glowing lava veins, hot rim
  function buildShard(base, lane, seed) {
    const rgb = LANE_COLORS[lane].rgb;
    const hot = rgbScale(rgb, 1.8), mid = rgbScale(rgb, 0.72), rock = rgbScale(rgb, 0.3), dark = rgbScale(rgb, 0.13);
    const r = base / 2, pad = Math.ceil(base * 0.95), S = base + pad * 2, cx = S / 2, cy = S / 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    const rnd = mulberry(seed * 131 + lane * 17 + 3);
    const N = 8; const verts = [];
    for (let i = 0; i < N; i++) { const ang = Math.PI * 2 * i / N - Math.PI / 2 + (rnd() - 0.5) * 0.34; const rr = r * (0.62 + rnd() * 0.46); verts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]); }
    const poly = () => { x.beginPath(); verts.forEach((v, i) => i ? x.lineTo(v[0], v[1]) : x.moveTo(v[0], v[1])); x.closePath(); };
    // body + outer glow
    x.save(); x.shadowColor = 'rgb(' + rgb + ')'; x.shadowBlur = base * 0.55;
    poly();
    const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, 'rgb(' + mid + ')'); g.addColorStop(0.5, 'rgb(' + rock + ')'); g.addColorStop(1, 'rgb(' + dark + ')');
    x.fillStyle = g; x.fill(); x.restore();
    // faceted bevel — lit upper faces, shaded lower
    x.save(); poly(); x.clip();
    for (let i = 0; i < N; i++) {
      const v = verts[i], v2 = verts[(i + 1) % N];
      x.beginPath(); x.moveTo(cx, cy); x.lineTo(v[0], v[1]); x.lineTo(v2[0], v2[1]); x.closePath();
      const lit = (v[1] + v2[1]) / 2 < cy;
      x.fillStyle = lit ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.22)'; x.fill();
    }
    // molten lava veins
    x.shadowColor = 'rgb(' + hot + ')'; x.shadowBlur = base * 0.28; x.strokeStyle = 'rgba(' + hot + ',0.95)'; x.lineWidth = Math.max(1, base * 0.032); x.lineCap = 'round';
    for (let k = 0; k < 3; k++) { let a0 = rnd() * Math.PI * 2, px = cx, py = cy; x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 3; s++) { const ang = a0 + (rnd() - 0.5) * 1.3; const len = r * (0.26 + rnd() * 0.4); px += Math.cos(ang) * len; py += Math.sin(ang) * len; x.lineTo(px, py); } x.stroke(); }
    x.restore();
    // hot rim
    poly(); x.lineWidth = Math.max(1.4, base * 0.045); x.strokeStyle = 'rgba(' + hot + ',0.95)'; x.shadowColor = 'rgb(' + rgb + ')'; x.shadowBlur = base * 0.3; x.stroke();
    return { c: c, S: S };
  }

  // chaos-energy core (rare surge note): white-hot plasma orb with jagged spikes
  function buildChaos(base) {
    const r = base * 0.5, pad = Math.ceil(base * 1.05), S = base + pad * 2, cx = S / 2, cy = S / 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    x.save(); x.shadowColor = 'rgb(255,90,60)'; x.shadowBlur = base * 0.95;
    x.strokeStyle = 'rgba(255,190,130,0.92)'; x.lineWidth = Math.max(1.5, base * 0.05); x.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const ang = Math.PI * 2 * i / 12; const r2 = r * (1.0 + (i % 2 ? 0.55 : 0.22)); x.beginPath(); x.moveTo(cx + Math.cos(ang) * r * 0.5, cy + Math.sin(ang) * r * 0.5); x.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2); x.stroke(); }
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r * 0.8);
    g.addColorStop(0, 'rgb(255,255,244)'); g.addColorStop(0.4, 'rgb(255,150,80)'); g.addColorStop(1, 'rgb(190,30,28)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r * 0.72, 0, Math.PI * 2); x.fill(); x.restore();
    x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.arc(cx, cy, r * 0.3, 0, Math.PI * 2); x.fill();
    return { c: c, S: S };
  }

  // 3D beveled obsidian catcher pad with metallic rim + recessed well (squashed for perspective)
  function buildPad(size, lane) {
    const rgb = LANE_COLORS[lane].rgb;
    const r = size, pad = Math.ceil(size * 0.8), S = size * 2 + pad * 2, cx = S / 2, cy = S / 2, sq = 0.52;
    const c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    const hex = (rr) => { x.beginPath(); for (let a = 0; a < 6; a++) { const ang = Math.PI / 3 * a - Math.PI / 2; const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr * sq; a ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); };
    // outer beveled metallic ring
    const bevel = x.createLinearGradient(cx, cy - r * sq, cx, cy + r * sq);
    bevel.addColorStop(0, 'rgba(120,126,142,0.95)'); bevel.addColorStop(0.5, 'rgba(42,44,54,0.96)'); bevel.addColorStop(1, 'rgba(14,15,21,0.96)');
    hex(r); x.fillStyle = bevel; x.fill();
    // recessed dark well
    hex(r * 0.72); x.fillStyle = 'rgba(7,5,9,0.96)'; x.fill();
    // lane rim glow
    hex(r); x.lineWidth = Math.max(1.5, size * 0.07); x.strokeStyle = 'rgba(' + rgb + ',0.75)'; x.shadowColor = 'rgb(' + rgb + ')'; x.shadowBlur = size * 0.45; x.stroke();
    // inner chrome highlight (neutral silver — no blue cast)
    hex(r * 0.72); x.lineWidth = Math.max(1, size * 0.03); x.strokeStyle = 'rgba(224,218,214,0.3)'; x.shadowBlur = 0; x.stroke();
    return { c: c, S: S, r: r };
  }

  // soft motion streak trailing behind a note up the lane
  function drawNoteTrail(n, d, pX, pY, pn, laneNearC) {
    const d2 = Math.min(1.0, d + 0.16);
    const x1 = pX(laneNearC(n.lane), d), y1 = pY(d);
    const x2 = pX(laneNearC(n.lane), d2), y2 = pY(d2);
    const rgb = n.type === 'star' ? '224,169,63' : LANE_COLORS[n.lane].rgb;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, 'rgba(' + rgb + ',0.45)'); grad.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = grad; ctx.lineWidth = (gfx.lw * (0.34 + 0.66 * pn(d))) * 0.42; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function drawNote(cx, y, w, note, _d, _travelAng) {
    // build28 (playtest: notes were invisible — pink-on-pink / bone-on-bone / dark-on-dark): notes are now the
    // BRIGHT per-lane faceted gem (lane color + white core + dark ring + glow) so they pop on ANY guitar; the
    // gold star for surge notes. The level theme NO LONGER recolors the note body (that was the blend bug).
    const gem = gfx && (note.type === 'star' ? gfx.star : (gfx.gems && gfx.gems[note.lane]));
    // target on-screen gem diameter ≈ 1.55× the lane note width (clearly readable); the cached canvas holds the
    // gem within S=base*~2.7 of padding/glow, so scale the whole canvas by (S/base) to land the gem at that size.
    let GEM_K = 1.8;   // build141 (tester: "notes are too small to track"): base gem scale 1.55→1.8 (~+16% diameter, +35% area) so gems read across the room
    if (note.type === 'accent') GEM_K *= 1.12;
    const _emph = (typeof note._emph === 'number') ? note._emph : 0.5;   // build75: music-driven emphasis (0..1)
    GEM_K *= (0.9 + 0.26 * _emph);   // build141: tighter emphasis span (was 0.88..1.22) — RAISE the smallest/weakest gems (the hardest to see: 0.9 floor vs 0.88) while keeping the strong-note peak under lane-overlap; chart still "looks like the song"
    if (gem && gfx.base) {
      const Sd = w * GEM_K * (gem.S / gfx.base);
      // build109 s2 Step B: a live specular rotation so the highlight visibly sweeps as the note falls —
      // near-zero cost (one extra ctx.rotate per note/frame), highest-ROI item in the marble pass: turns
      // a static stamped disc into a "rolling ball" for free. Per-lane phase offset so lanes don't sync.
      ctx.save();
      ctx.translate(cx, y);
      // build141 (tester: "red notes get lost on red levels + at the corners"): a DARK RIM + soft dark HALO drawn
      // UNDER the gem so its silhouette separates from ANY backdrop — regardless of lane color or level theme. The
      // gem keeps its lane color (green-on-fret-1 is an intentional brand keep); this is a CONTRAST fix, not a hue
      // change. Drawn on a clean (un-stretched) transform so it stays a true circle. Alloc-free (bare ctx ops, no
      // gradients) → hot-loop safe. Always on (a readability floor, not a motion/perf frill).
      const _gr = w * GEM_K * 0.5;   // on-screen gem body radius
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = Math.max(3, _gr * 0.85);   // subtle dark outer glow = the halo that lifts a matching-color gem off the backdrop
      ctx.fillStyle = 'rgba(6,3,3,0.9)';                                               // near-black matte; only the thin annulus outside the gem body shows = a crisp dark outline
      ctx.beginPath(); ctx.arc(0, 0, _gr * 1.05, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // build109 s2 Step D (optional, last): mild anisotropic stretch along the travel axis for the
      // closest ~25% of travel (d < 0.25 — small d IS near the catcher in this engine's convention:
      // depthScale(d)=1-0.7d peaks at d=0, so "closest" is the LOW end of d, not d>0.75 as a naive literal
      // reading might suggest), easing back to 1.0 at contact. Sells "rushing toward camera" instead of
      // isotropic pop-in. Reduce-motion + fxLite gated (motion + perf, per the plan's step-4 gate table).
      // VISUAL TRANSFORM ONLY — applied after translate, before the rotate/drawImage; hit-judgment reads
      // nx/ny/note.time from the untransformed loop above and never sees this scale.
      if (!reduceMotion && !fxLite && typeof _d === 'number' && _d < 0.25 && _d >= 0) {
        const _st = 1 - (_d / 0.25);            // 0 at d=0.25 → 1 at contact (d=0)
        const _amt = 1 + 0.12 * _st;             // up to 1.12x stretch along travel axis
        const _amtInv = 1 - 0.06 * _st;          // mild inverse squash on the perpendicular axis
        ctx.rotate(_travelAng || 0);
        ctx.scale(_amtInv, _amt);
        ctx.rotate(-(_travelAng || 0));
      }
      if (!reduceMotion) ctx.rotate((performance.now() / 1000) * 1.6 + note.lane);   // build109 s4 review: gate the continuous specular spin behind reduce-motion — it was applied unconditionally, so every falling note spun even with the a11y setting on (the exact ambient motion the setting exists to suppress)
      ctx.drawImage(gem.c, -Sd / 2, -Sd / 2, Sd, Sd);
      // build109 s2 Step C: per-type baked overlay composite (accent/hold/chord distinct + premium) —
      // skipped under fxLite (weak-device perf gate per the polish plan; the base marble + rotation stay
      // on). Rides the SAME rotation transform as the body — cheap (already-open ctx.save), and a ring/
      // notch spinning WITH the ball reads fine (only the accent facets are orientation-sensitive-ish and
      // even those read as "faceted," not wrong, while rotating).
      if (!fxLite && gfx.base) {
        const ov = note.type === 'accent' ? (gfx.accentOv && gfx.accentOv[note.lane])
                 : note.type === 'hold' ? (gfx.holdOv && gfx.holdOv[note.lane])
                 : null;
        if (ov) { const Sdo = w * GEM_K * (ov.S / gfx.base); ctx.drawImage(ov.c, -Sdo / 2, -Sdo / 2, Sdo, Sdo); }
        if (note.chord) {
          const cv = gfx.chordOv && gfx.chordOv[note.lane];
          if (cv) { const Sdc = w * GEM_K * (cv.S / gfx.base); ctx.drawImage(cv.c, -Sdc / 2, -Sdc / 2, Sdc, Sdc); }
        }
      }
      ctx.restore();
    } else { ctx.fillStyle = '#141016'; ctx.beginPath(); ctx.arc(cx, y, w * 0.5, 0, Math.PI * 2); ctx.fill(); }
    // build75: DOWNBEAT emphasis ring — a thin lane-colored additive halo on the strong on-beat notes so the song's
    // PULSE reads in the falling notes (louder half only; skipped under reduce-motion + once judged).
    if ((note._downbeat || note._onGrid) && !note.judged && !reduceMotion && _emph > 0.45) {
      const _rc = (LANE_COLORS[note.lane] && LANE_COLORS[note.lane].rgb) || '255,90,60';
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(' + _rc + ',' + (0.32 + 0.4 * _emph) + ')'; ctx.lineWidth = Math.max(1, w * 0.10);
      ctx.beginPath(); ctx.arc(cx, y, w * (0.66 + 0.12 * _emph), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // HOPO "flow" cue — a thin ember ring (openNotes flag only; .hopo is never set unless the flag built it).
    if (note.hopo && !note.judged) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,122,74,0.85)'; ctx.lineWidth = Math.max(1.2, w * 0.12);
      ctx.shadowColor = '#ff7a4a'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(cx, y, w * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // A2 STARSTRUCK phrase-member cue (Fable: "an invisible phrase is a slot machine") — a subtle warm-GOLD rim marks
    // the approach-run notes that feed a star, so carrying the run clean into the gold gem reads as a deliberate gamble.
    // Flag-gated BY CONSTRUCTION: only a flag-on chart carries phraseId. Cosmetic; drops once judged; on-brand gold.
    if (note.phraseId != null && note.type !== 'star' && !note.judged) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(224,169,63,0.6)'; ctx.lineWidth = Math.max(1, w * 0.08);
      ctx.shadowColor = 'rgba(224,169,63,0.85)'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(cx, y, w * GEM_K * 0.56, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // ---- T6 GRAMMAR: ACCENT SPIKE-RING (spec B3) — 8 short dark-outlined, lane-colored triangular spikes on the
    // rim = a gear/sunburst silhouette vs the tap's smooth circle. The IDENTITY read (the soft accent aura stays as
    // juice under its own gate). Tips sit ~1.12× the gem-body radius (well within the existing glow footprint —
    // silhouette growth stays ≤ +10%). Renders under fxLite/reduceMotion (readability). Visual-only.
    if (note.type === 'accent' && !note.judged) {
      const _arc = (LANE_COLORS[note.lane] && LANE_COLORS[note.lane].rgb) || '255,90,60';
      const rr0 = w * GEM_K * 0.42, rr1 = w * GEM_K * 0.56;   // inner base → outer tip
      ctx.save(); ctx.translate(cx, y); ctx.lineJoin = 'round';
      ctx.fillStyle = 'rgba(' + _arc + ',0.95)'; ctx.strokeStyle = 'rgba(8,5,4,0.9)'; ctx.lineWidth = Math.max(1, w * 0.05);
      for (let s = 0; s < 8; s++) {
        const a = s / 8 * Math.PI * 2 + Math.PI / 8, bx = Math.cos(a), by = Math.sin(a), px = -by, py = bx, bw = rr0 * 0.34;
        ctx.beginPath();
        ctx.moveTo(bx * rr0 + px * bw, by * rr0 + py * bw);
        ctx.lineTo(bx * rr1, by * rr1);
        ctx.lineTo(bx * rr0 - px * bw, by * rr0 - py * bw);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    // ---- T6 GRAMMAR: HOLD GRIP-RING + DRAIN ARC + 75% GRACE NOTCH (spec B2) — the head gem gains a concentric ring
    // (dark rim + lane-color inner edge). While sustaining, the lane-color arc DRAINS from full → empty as the core
    // banks (tracks holdScored, stashed as note._hbank in the render loop). A gold NOTCH marks the 0.75 GRACE point:
    // once the draining edge reaches it you've banked enough to release clean — the grace made wordless. The ring
    // hugs the gem (r ≈ 1.16× gem-body radius, a thin stroke within the existing glow → silhouette growth ≤ +10%).
    // Renders under fxLite/reduceMotion (readability). Visual-only — judging/holdScored are read, never written.
    if ((note.type === 'hold' || note.type === 'rail') && !note.judged) {
      const banked = (note._hheld || note._hres) ? Math.max(0, Math.min(1, note._hbank || 0)) : 0;
      const remaining = 1 - banked, rr = w * GEM_K * 0.58, a0 = -Math.PI / 2;
      const _hrc = (LANE_COLORS[note.lane] && LANE_COLORS[note.lane].rgb) || '255,90,60';
      ctx.save(); ctx.translate(cx, y); ctx.lineCap = 'round';
      // dark rim (the ring's outer silhouette edge)
      ctx.lineWidth = Math.max(2, w * 0.14); ctx.strokeStyle = 'rgba(8,5,4,0.85)';
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
      // lane-color DRAIN arc — the un-banked remainder, clockwise from 12 o'clock
      ctx.lineWidth = Math.max(1.4, w * 0.09); ctx.strokeStyle = 'rgba(' + _hrc + ',0.95)';
      ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + Math.PI * 2 * remaining); ctx.stroke();
      // 0.75 GRACE notch — a gold tick where the draining edge lands at banked=0.75 (i.e. remaining=0.25)
      const gA = a0 + Math.PI * 2 * 0.25;
      ctx.strokeStyle = 'rgba(224,169,63,0.95)'; ctx.lineWidth = Math.max(1.4, w * 0.06);
      ctx.beginPath(); ctx.moveTo(Math.cos(gA) * (rr - w * 0.10), Math.sin(gA) * (rr - w * 0.10)); ctx.lineTo(Math.cos(gA) * (rr + w * 0.10), Math.sin(gA) * (rr + w * 0.10)); ctx.stroke();
      ctx.restore();
    }
    // ---- T7 FIRST-ENCOUNTER TEACHING (spec C2) — a one-time in-world head chip ("HOLD" / "SLIDE ▸") riding the
    // gem on approach, tagged by buildNotes on Easy only (never Med/Hard/RIFT, never MP; the tag is absent otherwise).
    // Chakra Petch ~10px warm-white on a near-black rounded chip; fades in as the head nears (d < 0.6). Retired for
    // good once the mechanic is learned (the tag stops being emitted at 2 successes). Renders under fxLite/reduceMotion.
    if (note._teach && !note.judged && typeof _d === 'number' && _d < 0.6 && _d >= -0.05) {
      const _ta = Math.max(0, Math.min(1, (0.6 - _d) / 0.5));
      let _tlabel = 'HOLD';
      if (note._teach === 'rail') { let dir = 1; try { if (note.rail && note.rail.length >= 2) dir = (note.rail[1].lane >= note.rail[0].lane) ? 1 : -1; } catch (e) {} _tlabel = dir >= 0 ? 'SLIDE ▸' : '◂ SLIDE'; }
      ctx.save();
      ctx.font = '600 10px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const _tw = Math.max(28, ctx.measureText(_tlabel).width + 12), _th = 15, _tcy = y - w * GEM_K * 0.5 - 12;
      ctx.globalAlpha = _ta;
      ctx.fillStyle = 'rgba(10,7,6,0.82)'; roundRect(ctx, cx - _tw / 2, _tcy - _th / 2, _tw, _th, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(224,169,63,0.45)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(244,239,233,0.9)'; ctx.fillText(_tlabel, cx, _tcy + 0.5);
      ctx.restore();
    }
  }
  // hazard "bomb" (T6 grammar, spec B5): the ONLY DIM / DESATURATED object on the board — it must RECEDE, not pop, so
  // its "don't hit" silhouette is unmistakable. Matte near-greyscale warm fill (R≥G≥B, brand-safe), a THIN ember
  // outline, hazard chevrons framing the ✕. The old bright accent halo is replaced by a faint ember breath. Bombs are
  // already EXCLUDED from the note dark-halo/rim lift by construction (they never route through drawNote — the render
  // loop draws them here and `continue`s). Fuse/warn flipbook FX are untouched (drawn separately in the render loop).
  function drawBomb(cx, y, r) {
    const tt = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(tt * 9);
    ctx.save();
    // faint ember BREATH (much dimmer than the old accent halo — the bomb recedes into the board)
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(120,60,40,' + (0.05 + 0.06 * pulse) + ')';
    ctx.beginPath(); ctx.arc(cx, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // matte, DESATURATED warm-grey orb (the dead / dim object)
    const g = ctx.createRadialGradient(cx - r * 0.3, y - r * 0.32, r * 0.1, cx, y, r);
    g.addColorStop(0, '#33302c'); g.addColorStop(1, '#0b0a09');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.fill();
    // THIN ember outline
    ctx.lineWidth = Math.max(1, r * 0.07); ctx.strokeStyle = 'rgba(200,90,60,' + (0.5 + 0.35 * pulse) + ')';
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.stroke();
    // HAZARD CHEVRONS framing the ✕ — four inward-pointing warning ticks at N/E/S/W, just inside the rim
    ctx.strokeStyle = 'rgba(210,120,80,' + (0.5 + 0.3 * pulse) + ')'; ctx.lineWidth = Math.max(1, r * 0.09); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let q = 0; q < 4; q++) {
      const a = q * Math.PI / 2, ox = cx + Math.cos(a) * r * 0.82, oy = y + Math.sin(a) * r * 0.82;
      const pa = a + Math.PI, wx = Math.cos(pa + 0.55), wy = Math.sin(pa + 0.55), vx = Math.cos(pa - 0.55), vy = Math.sin(pa - 0.55);
      ctx.beginPath();
      ctx.moveTo(ox + wx * r * 0.2, oy + wy * r * 0.2); ctx.lineTo(ox, oy); ctx.lineTo(ox + vx * r * 0.2, oy + vy * r * 0.2);
      ctx.stroke();
    }
    // the ✕ (do-not-hit) — a dimmer warm-white than before so the whole object stays recessive
    ctx.strokeStyle = 'rgba(210,190,175,0.8)'; ctx.lineWidth = Math.max(1.5, r * 0.15); ctx.lineCap = 'round';
    const s = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - s, y - s); ctx.lineTo(cx + s, y + s);
    ctx.moveTo(cx + s, y - s); ctx.lineTo(cx - s, y + s);
    ctx.stroke();
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- procedural Crimson Moon + parallax cloud scene ----------
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // sphere with limb darkening, dark maria, seeded craters + a soft glow halo
  function buildMoonSprite(R) {
    const pad = Math.floor(R * 0.45);
    const S = R * 2 + pad * 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    // tight outer halo (doesn't wash the sky)
    const halo = x.createRadialGradient(cx, cy, R * 0.92, cx, cy, R + pad);
    halo.addColorStop(0, 'rgba(255,64,52,0.5)');
    halo.addColorStop(0.5, 'rgba(185,20,26,0.13)');
    halo.addColorStop(1, 'rgba(120,8,14,0)');
    x.fillStyle = halo; x.fillRect(0, 0, S, S);
    // disc
    x.save(); x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.clip();
    // base sphere — hot bright core upper-left → very dark limb (strong value range)
    const lx = cx - R * 0.3, ly = cy - R * 0.32;
    const g = x.createRadialGradient(lx, ly, R * 0.04, cx, cy, R * 1.18);
    g.addColorStop(0, '#ffe2b0');
    g.addColorStop(0.16, '#ff8048');
    g.addColorStop(0.48, '#e22a1e');
    g.addColorStop(0.8, '#860a12');
    g.addColorStop(1, '#160205');
    x.fillStyle = g; x.fillRect(cx - R, cy - R, R * 2, R * 2);
    // a few large soft maria (no fine noise)
    const rnd = mulberry(1337);
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2, rad = R * (0.2 + rnd() * 0.5);
      const mx = cx + Math.cos(a) * rad, my = cy + Math.sin(a) * rad, mr = R * (0.22 + rnd() * 0.2);
      const mg = x.createRadialGradient(mx, my, 0, mx, my, mr);
      mg.addColorStop(0, 'rgba(70,4,12,0.38)'); mg.addColorStop(1, 'rgba(70,4,12,0)');
      x.fillStyle = mg; x.beginPath(); x.arc(mx, my, mr, 0, Math.PI * 2); x.fill();
    }
    // soft craters (smooth, lit upper rim from upper-left light)
    const cr = mulberry(99);
    for (let i = 0; i < 12; i++) {
      const a = cr() * Math.PI * 2, rad = R * Math.sqrt(cr()) * 0.9;
      const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad, r = R * (0.03 + cr() * 0.07);
      const bowl = x.createRadialGradient(px + r * 0.2, py + r * 0.2, 0, px, py, r);
      bowl.addColorStop(0, 'rgba(36,0,4,0.4)'); bowl.addColorStop(0.6, 'rgba(120,12,16,0.1)'); bowl.addColorStop(1, 'rgba(120,12,16,0)');
      x.fillStyle = bowl; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(255,175,125,0.22)'; x.lineWidth = Math.max(0.6, r * 0.1);
      x.beginPath(); x.arc(px - r * 0.14, py - r * 0.14, r * 0.85, Math.PI * 0.85, Math.PI * 1.95); x.stroke();
    }
    // bright crescent rim-light (upper-left) — instantly reads as a 3D sphere
    x.save(); x.globalCompositeOperation = 'lighter';
    x.lineWidth = R * 0.045; x.strokeStyle = 'rgba(255,205,155,0.7)'; x.shadowColor = 'rgba(255,120,80,0.9)'; x.shadowBlur = R * 0.12;
    x.beginPath(); x.arc(cx, cy, R * 0.965, Math.PI * 0.76, Math.PI * 1.46); x.stroke();
    x.restore();
    // terminator shading — darken lower-right limb for roundness
    const term = x.createRadialGradient(cx + R * 0.55, cy + R * 0.6, R * 0.1, cx + R * 0.15, cy + R * 0.15, R * 1.25);
    term.addColorStop(0, 'rgba(8,0,2,0.6)'); term.addColorStop(0.6, 'rgba(8,0,2,0.15)'); term.addColorStop(1, 'rgba(8,0,2,0)');
    x.fillStyle = term; x.fillRect(cx - R, cy - R, R * 2, R * 2);
    x.restore();
    return { c: c, R: R, pad: pad, S: S };
  }

  // fluffy cloud sprite — overlapping soft puffs in a given rgb, on transparent
  function buildCloud(w, h, rgb, seed, alpha) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const rnd = mulberry(seed);
    const n = 8 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const px = w * (0.1 + 0.8 * rnd()), py = h * (0.5 + 0.35 * (rnd() - 0.5) + 0.2);
      const rr = h * (0.28 + 0.42 * rnd());
      const g = x.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, 'rgba(' + rgb + ',' + (alpha * (0.7 + rnd() * 0.3)) + ')');
      g.addColorStop(0.55, 'rgba(' + rgb + ',' + (alpha * 0.3) + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(px, py, rr, rr * 0.72, 0, 0, Math.PI * 2); x.fill();
    }
    return c;
  }

  let scene = null;
  function buildScene() {
    const R = Math.round(cw * 0.55);
    const moon = buildMoonSprite(R);
    const cw2 = Math.round(cw * 0.62), ch2 = Math.round(cw * 0.34);
    // three depth layers: lit (behind moon), mid + near silhouettes (in front)
    const lit = [buildCloud(cw2, ch2, '255,46,40', 11, 0.34), buildCloud(cw2, ch2, '210,24,30', 22, 0.32)];
    const dark = [buildCloud(cw2, ch2, '12,2,5', 33, 0.72), buildCloud(cw2, ch2, '7,1,3', 44, 0.76)];
    const litEdge = [buildCloud(cw2, ch2, '255,70,50', 33, 0.38), buildCloud(cw2, ch2, '255,60,45', 44, 0.4)];
    scene = {
      w: cw, h: ch, moon,
      layers: [
        // behind the moon — glowing crimson, slow, wide (few tiles → no repeat pattern)
        { sprites: lit, kind: 'lit', y: ch * 0.14, scale: 1.5, speed: 5, gap: 0.95, front: false },
        // crossing the moon's lower third — dark with a lit underglow, medium
        { sprites: dark, edge: litEdge, kind: 'dark', y: ch * 0.235, scale: 1.3, speed: 11, gap: 0.85, front: true },
        // foreground horizon band — bigger dark, faster (parallax = closer)
        { sprites: dark, edge: litEdge, kind: 'dark', y: ch * 0.31, scale: 1.75, speed: 19, gap: 0.8, front: true },
      ],
    };
  }

  function drawClouds(t, front) {
    for (const L of scene.layers) {
      if (!!L.front !== front) continue;
      const sp = L.sprites[0];
      const tileW = sp.width * L.scale * L.gap;
      const off = ((t * L.speed) % tileW + tileW) % tileW;
      const count = Math.ceil(cw / tileW) + 2;
      for (let i = -1; i < count; i++) {
        const idx = ((i % L.sprites.length) + L.sprites.length) % L.sprites.length;
        const s = L.sprites[idx];
        const dw = s.width * L.scale, dh = s.height * L.scale;
        const dx = i * tileW - off;
        const dy = L.y - dh * 0.5 + Math.sin(t * 0.25 + i) * 4;
        if (L.kind === 'lit') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(s, dx, dy, dw, dh);
          ctx.globalCompositeOperation = 'source-over';
        } else {
          // crimson underglow then dark silhouette on top → 3D rim-lit clouds
          const e = L.edge[idx];
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(e, dx, dy - dh * 0.06, dw, dh);
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(s, dx, dy, dw, dh);
        }
      }
    }
  }

  // VISUAL-ONLY: the lively combo-reactive energy layer. Drawn from render() AFTER the strings (so it's
  // visible over the guitar image) but under the catchers/notes. Brightness/speed/warmth scale with the
  // REAL multiplier tier (curMult), 1x → cap. Profile-aware (guitarRect/fretGeom → standard AND gh).
  // build20 (the user marked the v116 clip's SEAMS along the neck edges): a clip is a hard
  // boundary — LIGHT NEEDS FALLOFF, never edges. ALL board energy (combo heat, the milestone/OD
  // scan sweep, the OD-active wash) now paints into a small OFFSCREEN, gets FEATHERED toward the
  // trapezoid edges + both ends (destination-out is safe there — only energy pixels exist), and
  // composites additively. Alphas are toned DOWN too: the column was outshouting the world.
  function _neckGeom(fg) {
    const warp = (warpOverride >= 0 ? warpOverride : (ART.warp || 0));
    const cx0 = fg.gx + 0.5 * fg.gw;
    const wxp = (x, u) => warp > 0 ? cx0 + (x - cx0) * (1 - warp * Math.max(0, u)) : x;
    const padN = fg.lw * 1.05, padF = fg.lw * 0.45;
    return {
      yN: Math.min(ch, fg.nearY + fg.lw * 1.6), yF: fg.farY,
      xLN: wxp(fg.nearX[0], 0) - padN, xLF: wxp(fg.farX[0], 1) - padF,
      xRN: wxp(fg.nearX[LANE_COUNT - 1], 0) + padN, xRF: wxp(fg.farX[LANE_COUNT - 1], 1) + padF,
    };
  }
  let _enCv = null, _enCx = null;
  function drawComboEnergy(t, fg) {
    if (state !== 'playing') return;
    if (reduceMotion || fxLite) return;
    if (!activeGuitarImg || !activeGuitarImg._ready) return;
    const mult = curMult();
    const capN = (timingProf().comboCap || 3) + 1;
    const tierF = Math.max(0, Math.min(1, (mult - 1) / Math.max(1, capN - 1)));
    const comboOn = !(mult < 2 && combo < 8);
    const scanOn = scanT > 0;
    if (!comboOn && !scanOn && !odActive) return;
    const gr = guitarRect();
    const ng = _neckGeom(fg);
    const x0 = Math.floor(Math.min(ng.xLN, ng.xLF)) - 2, x1 = Math.ceil(Math.max(ng.xRN, ng.xRF)) + 2;
    const y0 = Math.floor(ng.yF) - 2, y1 = Math.ceil(ng.yN) + 2;
    const W2 = Math.max(8, x1 - x0), H2 = Math.max(8, y1 - y0);
    if (!_enCv || _enCv.width !== W2 || _enCv.height !== H2) {
      _enCv = document.createElement('canvas'); _enCv.width = W2; _enCv.height = H2;
      _enCx = _enCv.getContext('2d');
    }
    const ox = _enCx;
    ox.setTransform(1, 0, 0, 1, -x0, -y0);
    ox.clearRect(x0, y0, W2, H2);
    const inten = Math.max(tierF, Math.min(1, combo / 60));
    const warm = Math.round(110 + tierF * 90);
    // board-energy HUE rides the combo TIER — neck shifts crimson→orange→gold→
    // white-hot→chrome as the streak climbs (matches the named combo-mode readout).
    const _bt = COMBO_TIERS[comboTierIdx(combo)].board, _brgb = _bt[0] + ',' + _bt[1] + ',' + _bt[2];
    // 1) combo heat — moving bands + a low nut→catcher wash (toned down)
    if (comboOn) {
      const bands = 2 + Math.round(tierF * 2);
      for (let b = 0; b < bands; b++) {
        const ph = (t * (0.16 + tierF * 0.34) + b / bands) % 1;
        const by = gr.gy + gr.gh * (0.14 + ph * 0.84), bh = gr.gh * (0.12 + tierF * 0.05);
        const a = (0.08 + 0.22 * inten) * Math.sin(ph * Math.PI);
        if (a > 0.003) {
          const eg = ox.createLinearGradient(0, by - bh, 0, by + bh);
          eg.addColorStop(0, 'rgba(' + _brgb + ',0)');
          eg.addColorStop(0.5, 'rgba(' + _brgb + ',' + a.toFixed(3) + ')');
          eg.addColorStop(1, 'rgba(255,90,60,0)');
          ox.fillStyle = eg; ox.fillRect(x0, by - bh, W2, bh * 2);
        }
      }
      if (inten > 0.02) {
        const wash = ox.createLinearGradient(0, ng.yF, 0, fg.nearY);
        const wa = (0.028 + 0.085 * inten).toFixed(3);
        wash.addColorStop(0, 'rgba(' + _brgb + ',0)');
        wash.addColorStop(0.55, 'rgba(' + _brgb + ',' + wa + ')');
        wash.addColorStop(1, 'rgba(255,120,80,0)');
        ox.fillStyle = wash; ox.fillRect(x0, ng.yF, W2, fg.nearY - ng.yF);
      }
    }
    // 2) the milestone/OD SCAN sweep (moved here from the guitar draw — same soft shape)
    if (scanOn) {
      const prog = Math.max(0, Math.min(1, 1 - scanT / scanDur));
      const sweepY = fg.nearY + (ng.yF - fg.nearY) * prog;
      const bandH = gr.gh * 0.14;
      const a = Math.sin(prog * Math.PI) * (0.26 + 0.09 * Math.min(3, scanTier));
      const sg = ox.createLinearGradient(0, sweepY - bandH, 0, sweepY + bandH);
      sg.addColorStop(0, 'rgba(255,138,43,0)');
      sg.addColorStop(0.5, 'rgba(255,180,90,' + a.toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(255,60,60,0)');
      ox.fillStyle = sg; ox.fillRect(x0, sweepY - bandH, W2, bandH * 2);
      ox.globalAlpha = Math.min(1, a * 1.5); ox.fillStyle = 'rgba(255,224,150,0.9)';
      ox.fillRect(x0, sweepY - 1.5, W2, 3);
      ox.globalAlpha = 1;
    }
    // 3) OD ACTIVE — the color-cycling wash (moved here; toned down)
    if (odActive) {
      const ph = t * 1.4, beat = 0.5 + 0.5 * Math.sin(t * 8);
      const cg = Math.round(110 + 70 * Math.sin(ph)), cb = Math.round(50 + 30 * Math.sin(ph + 1.2));
      const owash = ox.createLinearGradient(0, gr.gy + gr.gh * 0.3, 0, gr.gy + gr.gh);
      const aa = (0.035 + 0.045 * beat).toFixed(3);
      owash.addColorStop(0, 'rgba(255,' + cg + ',' + cb + ',0)');
      owash.addColorStop(0.7, 'rgba(255,' + cg + ',' + cb + ',' + aa + ')');
      owash.addColorStop(1, 'rgba(255,' + cg + ',' + cb + ',0)');
      ox.fillStyle = owash; ox.fillRect(x0, y0, W2, H2);
    }
    // FEATHER: erase everything outside the trapezoid + a smooth lw·1.35 falloff inward along
    // both edges, then melt both ENDS — the glow breathes out of existence, no boundary anywhere.
    ox.globalCompositeOperation = 'destination-out';
    // HORIZONTAL center-weighting (the fix for the "two side columns"): the energy was uniformly bright
    // edge-to-edge, so the neck-edge cutoffs read as standing crimson columns. Erase progressively toward
    // BOTH sides so the glow concentrates on the neck center and is gone well before the trapezoid edges.
    const hmask = ox.createLinearGradient(x0, 0, x1, 0);
    hmask.addColorStop(0, 'rgba(0,0,0,1)'); hmask.addColorStop(0.30, 'rgba(0,0,0,0)');
    hmask.addColorStop(0.70, 'rgba(0,0,0,0)'); hmask.addColorStop(1, 'rgba(0,0,0,1)');
    ox.fillStyle = hmask; ox.fillRect(x0, ng.yF, W2, ng.yN - ng.yF);
    const f = fg.lw * 2.0, S = 14;
    for (let s = 0; s < S; s++) {
      const ya = ng.yF + (ng.yN - ng.yF) * (s / S), yb = ng.yF + (ng.yN - ng.yF) * ((s + 1) / S);
      const sm = (s + 0.5) / S;                            // 0 at the nut end → 1 at the skirt end
      const exL = ng.xLF + (ng.xLN - ng.xLF) * sm, exR = ng.xRF + (ng.xRN - ng.xRF) * sm;
      if (exL - f > x0) ox.fillRect(x0, ya, (exL - f) - x0, yb - ya + 0.5);
      const gl = ox.createLinearGradient(exL - f, 0, exL, 0);
      gl.addColorStop(0, 'rgba(0,0,0,1)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      ox.fillStyle = gl; ox.fillRect(exL - f, ya, f, yb - ya + 0.5);
      if (x1 > exR + f) ox.fillRect(exR + f, ya, x1 - (exR + f), yb - ya + 0.5);
      const gr2 = ox.createLinearGradient(exR, 0, exR + f, 0);
      gr2.addColorStop(0, 'rgba(0,0,0,0)'); gr2.addColorStop(1, 'rgba(0,0,0,1)');
      ox.fillStyle = gr2; ox.fillRect(exR, ya, f, yb - ya + 0.5);
    }
    const capT = ox.createLinearGradient(0, ng.yF, 0, ng.yF + fg.lw * 1.2);
    capT.addColorStop(0, 'rgba(0,0,0,1)'); capT.addColorStop(1, 'rgba(0,0,0,0)');
    ox.fillStyle = capT; ox.fillRect(x0, ng.yF, W2, fg.lw * 1.2);
    const capB = ox.createLinearGradient(0, ng.yN - fg.lw * 0.9, 0, ng.yN);
    capB.addColorStop(0, 'rgba(0,0,0,0)'); capB.addColorStop(1, 'rgba(0,0,0,1)');
    ox.fillStyle = capB; ox.fillRect(x0, ng.yN - fg.lw * 0.9, W2, fg.lw * 0.9);
    ox.globalCompositeOperation = 'source-over';
    // composite the finished, edge-less energy onto the scene
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(_enCv, x0, y0);
    ctx.restore();
  }
  function drawCathedralBg(t) {
    // ---- VS3: reactive atmosphere behind the guitar (god-rays, haze, embers) ----
    // build17 (user, Skully playtest: "a weird line towards the top of the guitar"): this painted
    // atmosphere is the DEFAULT (moon) world's — hardcoded crimson rays + a dark horizon BAND at
    // ch 0.16–0.40 + embers. On a THEMED level it stripes the level's own video with the wrong
    // world's light. Themed levels (levelAccentRGB set) now show their video PURE — only
    // gameplay-reactive layers draw over it.
    const intensity0 = Math.max(bgPulse, energy * 0.85);
    if (!fxLite && !reduceMotion && !levelAccentRGB) {
    // volumetric crimson god-rays radiating from the moon, slow rotation + energy pulse
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cw / 2, ch * 0.06);
    const rays = 9, rot = t * 0.06;
    for (let i = 0; i < rays; i++) {
      const a = rot + (Math.PI * 2 * i / rays);
      const len = ch * (0.5 + 0.18 * Math.sin(t * 1.3 + i) + energy * 0.3);
      if (!isFinite(len)) continue;   // build114 review: a non-finite energy/ch (e.g. audio analyser not yet feeding) would make the gradient endpoint non-finite → createLinearGradient throws EVERY frame in the hot render loop. Skip the degenerate ray instead.
      const grd = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      grd.addColorStop(0, 'rgba(255,46,46,' + (0.05 + intensity0 * 0.11) + ')');
      grd.addColorStop(1, 'rgba(255,46,46,0)');
      ctx.strokeStyle = grd; ctx.lineWidth = 2 + energy * 5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke();
    }
    ctx.restore();
    // horizon depth haze behind the neck
    {
      const hz = ctx.createLinearGradient(0, ch * 0.16, 0, ch * 0.4);
      hz.addColorStop(0, 'rgba(40,4,10,' + (0.18 + energy * 0.22) + ')');
      hz.addColorStop(1, 'rgba(40,4,10,0)');
      ctx.fillStyle = hz; ctx.fillRect(0, ch * 0.16, cw, ch * 0.26);
    }
    // rising embers — count & glow scale with intensity (the air ignites on drops)
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const emberN = 10 + Math.floor(energy * 22);
    for (let i = 0; i < emberN; i++) {
      const seed = i * 127.3;
      const x = (Math.sin(seed) * 0.5 + 0.5) * cw;
      const yProg = ((t * (0.04 + (i % 5) * 0.012) + (seed % 1)) % 1);
      const y = ch * (0.95 - yProg * 0.8);
      const sz = (0.8 + (i % 3) * 0.9) * (1 + energy);
      const a = (0.12 + energy * 0.35) * (1 - yProg);
      ctx.fillStyle = (i % 4 === 0) ? 'rgba(255,150,80,' + a + ')' : 'rgba(255,42,46,' + a + ')';
      ctx.beginPath(); ctx.arc(x + Math.sin(t + i) * 8, y, sz, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    } // end !fxLite atmosphere

    // moon video is the backdrop (DOM, behind the transparent canvas).
    // draw the single coherent guitar (it already has neck, body, strings).
    if (activeGuitarImg._ready) {
      const gr = guitarRect();
      const gwarp = (warpOverride >= 0 ? warpOverride : (ART.warp || 0));
      // (build12: the texture-projection experiment is GONE — the user's verdict: a custom guitar
      // must look like THE ACTUAL GUITAR. Skins now draw through this same slicer as the default,
      // with their own cover-fit + measured strings; only the MATERIALIZE gate below is new.)
      if (gwarp > 0) {
        // NECK-RECEDE WARP: slice the guitar into horizontal bands and narrow each toward the centerline
        // by the SAME (1 - warp*u) factor the lanes use, so the painted strings recede WITH the note lanes
        // (they stay aligned). u: 0 at the bridge row → 1 at the nut row (matches warpX). Body below the
        // bridge (u<0) is left full-width. gh-only; standard takes the plain single drawImage below.
        const nY = gr.gy + ART.bridgeFY * gr.gh, fY = gr.gy + ART.nutFY * gr.gh;
        const cX = gr.gx + 0.5 * gr.gw, NS = 64, iw = activeGuitarImg.width, ih = activeGuitarImg.height;
        // build12/18 MATERIALIZE (every level start): the guitar prints nut→bridge behind an
        // accent frontier while the backdrop zoom settles. bp eases 0→1 over ~2s; 1 = built.
        const bpX = (_skinBuildT < 1) ? (1 - Math.pow(1 - _skinBuildT, 3)) : 1;
        const uGate2 = 1 - bpX;
        // build13 DEPTH: contact-shadow pass FIRST (the guitar's blurred silhouette, slightly wider,
        // sliced with the same warp/gates) — then the art pass paints over its core, leaving the halo.
        const sh = fxLite ? null : _guitarShadow();
        if (sh) {
          const swRatio = sh.width / iw;
          ctx.save();
          for (let s = 0; s < NS; s++) {
            const v0 = s / NS, v1 = (s + 1) / NS;
            const dy0 = gr.gy + v0 * gr.gh, dy1 = gr.gy + v1 * gr.gh;
            const u = ((dy0 + dy1) / 2 - nY) / (fY - nY);
            if (bpX < 1 && u >= 0 && u < uGate2) continue;
            const bodyA = (bpX < 1 && u < 0) ? Math.max(0, (bpX - 0.72) / 0.28) : 1;
            if (bodyA <= 0.01) continue;
            const dwSh = gr.gw * (1 - gwarp * Math.max(0, u)) * swRatio;
            ctx.globalAlpha = 0.5 * bodyA;
            ctx.drawImage(sh, 0, sh._pad + v0 * ih, sh.width, (v1 - v0) * ih, cX - dwSh / 2, dy0, dwSh, (dy1 - dy0) + 0.8);
          }
          ctx.restore();
        }
        for (let s = 0; s < NS; s++) {
          const v0 = s / NS, v1 = (s + 1) / NS;
          const dy0 = gr.gy + v0 * gr.gh, dy1 = gr.gy + v1 * gr.gh;
          const u = ((dy0 + dy1) / 2 - nY) / (fY - nY);          // 0 bridge .. 1 nut
          if (bpX < 1 && u >= 0 && u < uGate2) continue;         // not printed yet (cinematic)
          // body slices (u<0) FADE IN over the print's last stretch instead of popping at t=0
          const bodyA = (bpX < 1 && u < 0) ? Math.max(0, (bpX - 0.72) / 0.28) : 1;
          if (bodyA <= 0.01) continue;
          const sx = 1 - gwarp * Math.max(0, u);
          const dw = gr.gw * sx;
          if (bodyA < 1) { ctx.save(); ctx.globalAlpha = bodyA; }
          ctx.drawImage(activeGuitarImg, 0, v0 * ih, iw, (v1 - v0) * ih, cX - dw / 2, dy0, dw, (dy1 - dy0) + 0.8);
          if (bodyA < 1) { ctx.restore(); }
        }
        // the print FRONTIER — a hot accent line + bloom sweeping down the neck
        if (bpX < 1) {
          const yF = nY + (fY - nY) * uGate2;
          const sxF = 1 - gwarp * Math.max(0, uGate2);
          const fx0 = ART.bridgeXF[0] + (ART.nutXF[0] - ART.bridgeXF[0]) * uGate2;
          const fxL = ART.bridgeXF[LANE_COUNT - 1] + (ART.nutXF[LANE_COUNT - 1] - ART.bridgeXF[LANE_COUNT - 1]) * uGate2;
          const x0 = cX + ((gr.gx + fx0 * gr.gw) - cX) * sxF;
          const x1 = cX + ((gr.gx + fxL * gr.gw) - cX) * sxF;
          const pad = Math.max(18, (x1 - x0) * 0.45);
          const acc = levelAccentRGB || '255,31,46';   // brand crimson fallback (review find: was violet)
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const lg = ctx.createLinearGradient(x0 - pad, 0, x1 + pad, 0);
          lg.addColorStop(0, 'rgba(' + acc + ',0)'); lg.addColorStop(0.5, 'rgba(255,246,255,0.85)'); lg.addColorStop(1, 'rgba(' + acc + ',0)');
          ctx.fillStyle = lg; ctx.fillRect(x0 - pad, yF - 2.5, (x1 - x0) + pad * 2, 5);
          const bl = ctx.createLinearGradient(0, yF - 30, 0, yF + 4);
          bl.addColorStop(0, 'rgba(' + acc + ',0)'); bl.addColorStop(1, 'rgba(' + acc + ',0.32)');
          ctx.fillStyle = bl; ctx.fillRect(x0 - pad, yF - 30, (x1 - x0) + pad * 2, 34);
          ctx.restore();
        }
      } else {
        // build13 DEPTH: contact shadow behind the plain (un-warped) draw too
        const sh0 = fxLite ? null : _guitarShadow();
        if (sh0) {
          const px = sh0._pad * (gr.gw / activeGuitarImg.width), py = sh0._pad * (gr.gh / activeGuitarImg.height);
          ctx.save(); ctx.globalAlpha = 0.5;
          ctx.drawImage(sh0, gr.gx - px, gr.gy - py, gr.gw + px * 2, gr.gh + py * 2);
          ctx.restore();
        }
        ctx.drawImage(activeGuitarImg, gr.gx, gr.gy, gr.gw, gr.gh);
      }
      // fade the headstock (top of the guitar) into the backdrop so the neck top doesn't hard-cut.
      // build19 (user: "shouldn't the top of the guitar fade out toward the background?"): the fade
      // was SCREEN-anchored (top 22% of the viewport) — on tall windows the SHRUNK skin starts
      // hundreds of px below it and the headstock floated unfaded on the video. Now GUITAR-anchored:
      // dissolve from the art's top edge to just past the NUT, at every fit and window shape.
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      const fadeTop = Math.max(-4, gr.gy - 6);
      const fadeBot = Math.max(fadeTop + 48, gr.gy + (ART.nutFY + 0.05) * gr.gh);
      const nf = ctx.createLinearGradient(0, fadeTop, 0, fadeBot);
      nf.addColorStop(0, 'rgba(0,0,0,1)'); nf.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = nf; ctx.fillRect(0, fadeTop - 4, cw, (fadeBot - fadeTop) + 8); ctx.restore();
      // build17: the static "spawn band" glow is GONE (user: "a weird line towards the top of the
      // guitar" — a hardcoded-crimson full-width stripe at ch 0.16–0.34 over every level's video).
      // The headstock fade + the notes themselves already communicate where notes emerge.
      // build20: the SCAN sweep + OD-active wash moved into drawComboEnergy() — ALL board energy
      // now shares one soft-edged offscreen layer (feathered falloff, no clip seams).
      // COMBO-REACTIVE energy texture moved to render() (drawn over the neck, above the guitar image
      // but under the bright catchers/notes) so it's actually visible — see drawComboEnergy().
    }
    // top mask so the LIVE hud reads cleanly
    {
      const tb = ctx.createLinearGradient(0, 0, 0, ch * 0.12);
      tb.addColorStop(0, 'rgba(6,3,6,0.92)'); tb.addColorStop(1, 'rgba(6,3,6,0)');
      ctx.fillStyle = tb; ctx.fillRect(0, 0, cw, ch * 0.12);
    }
    // beat-reactive crimson bloom over the blood-moon — driven by live intensity
    const intensity = Math.max(bgPulse, energy * 0.85);
    if (intensity > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(cw / 2, ch * 0.24, 0, cw / 2, ch * 0.24, cw * (0.55 + energy * 0.25));
      gl.addColorStop(0, 'rgba(255,40,40,' + (intensity * 0.16) + ')'); gl.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = gl; ctx.fillRect(0, 0, cw, ch * 0.6);
      ctx.restore();
    }
    drawLevelAmbient(t);   // build7: per-level accent ambient (gated, no-op in Quick Play)
  }

  // ---- PER-LEVEL AMBIENT (build7) ----
  // Drifting accent-colored embers + a soft accent fog band, painted on the transparent canvas so it
  // reads ACROSS the whole highway (not just the DOM backdrop hidden behind the guitar). Intensity is
  // tied to energy/bgPulse. Fully gated: no accent / no ambient / reduceMotion / fxLite → returns at once.
  function drawLevelAmbient(t) {
    if (!levelAccentRGB || !levelAmbient || reduceMotion || fxLite) return;
    const A = levelAccentRGB;
    const inten = Math.max(bgPulse, energy * 0.85) * levelAmbient;
    // 1) low accent fog rising off the bottom third (cheap, big-read color)
    //    build8: greatly reduced — was washing the board purple. Floor lowered, ceiling halved.
    //    build19: now a bottom-center RADIAL — the old full-width rect ended in straight vertical
    //    seams at the canvas bounds, visible over the full-bleed video ("cropped on the sides").
    {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fr = Math.max(cw * 0.62, ch * 0.5);
      const fg = ctx.createRadialGradient(cw / 2, ch * 1.04, 0, cw / 2, ch * 1.04, fr);
      fg.addColorStop(0, 'rgba(' + A + ',' + (0.022 + inten * 0.05).toFixed(3) + ')');
      fg.addColorStop(1, 'rgba(' + A + ',0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(cw / 2, ch * 1.04, fr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // 2) drifting accent embers — build14: REMOVED (user, Skully playtest: "random floating
    // particle effects" — causeless drift reads as noise; the static fog band above stays).
  }

  // EQ bars on menu
  const trackBars = document.querySelectorAll('#track-bars span');
  setInterval(() => {
    if (state !== 'menu') return;
    trackBars.forEach((b, i) => {
      const h = 20 + Math.abs(Math.sin(Date.now() / 400 + i * 0.7)) * 70 + Math.random() * 15;
      b.style.height = Math.min(100, h) + '%';
    });
  }, 100);

  // ---------- MUTE ----------
  const muteBtn = $('mute-btn'), iconOn = $('mute-icon-on'), iconOff = $('mute-icon-off'), muteLab = $('mute-lab');
  try { muted = localStorage.getItem('rr_muted') === '1'; } catch (e) {}
  function applyMute() {
    applyGate();
    muteBtn.classList.toggle('muted', muted);
    iconOn.style.display = muted ? 'none' : 'block';
    iconOff.style.display = muted ? 'block' : 'none';
    muteLab.textContent = muted ? 'UNMUTE · M' : 'MUTE · M';
    muteBtn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
    try { localStorage.setItem('rr_muted', muted ? '1' : '0'); } catch (e) {}
  }
  function toggleMute() { muted = !muted; applyMute(); }
  applyMute();
  muteBtn.addEventListener('click', toggleMute);
  window.addEventListener('keydown', (e) => {
    if (calibActive) return;
    if (e.key && e.key.toLowerCase() === 'm' && !e.repeat) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if ((state === 'playing' || state === 'paused') && ('m' in keyMap)) return;   // build71: if a player rebound a lane to 'm', an in-lane hit must NOT also silently toggle music mute (the lane press is handled by the gameplay keydown handler)
      e.preventDefault(); toggleMute();
    }
  });

  // ---------- CALIBRATION ----------
  const calibScreen = $('calib-screen');
  let calibActive = false, calibCtx = null, calibRaf = null;
  let calibClicks = [], calibDeltas = [], calibNext = 0;
  const CALIB_BEAT = 0.5, CALIB_TARGET = 12;

  function updateCalibMenuVal() {
    const ms = Math.round(audioOffset * 1000);
    const el = $('calib-val');
    if (el) el.textContent = (ms > 0 ? '+' : '') + ms + ' ms';
  }
  updateCalibMenuVal();

  function openCalib() {
    calibActive = true;
    calibDeltas = []; calibClicks = [];
    const startMs = Math.round(audioOffset * 1000);
    // A3 polish: null-guard the DOM writes (matches updateCalibMenuVal's guarded style). openCalib is now also reached
    // from the pause-overlay RE-CALIBRATE shortcut, so a partial/stripped DOM should degrade gracefully, not throw.
    { const c = $('calib-count'); if (c) c.textContent = '0 / ' + CALIB_TARGET; }
    { const m = $('calib-measured'); if (m) m.textContent = '— ms'; }
    { const sl = $('calib-slider'); if (sl) sl.value = startMs; }
    { const sv = $('calib-slider-val'); if (sv) sv.textContent = (startMs > 0 ? '+' : '') + startMs + ' ms'; }
    if (calibScreen) calibScreen.classList.add('active');
    calibCtx = new (window.AudioContext || window.webkitAudioContext)();
    calibNext = calibCtx.currentTime + 0.4;
    calibScheduler();
  }

  function closeCalib() {
    calibActive = false;
    if (calibRaf) cancelAnimationFrame(calibRaf); calibRaf = null;
    if (calibCtx) { try { calibCtx.close(); } catch (e) {} calibCtx = null; }
    calibScreen.classList.remove('active');
  }

  function calibScheduler() {
    if (!calibActive || !calibCtx) return;
    while (calibNext < calibCtx.currentTime + 0.2) {
      playClick(calibNext);
      calibClicks.push(calibNext);
      if (calibClicks.length > 32) calibClicks.shift();
      const delayMs = (calibNext - calibCtx.currentTime) * 1000;
      setTimeout(() => { const r = $('calib-ring'); r.classList.remove('beat'); void r.offsetWidth; r.classList.add('beat'); }, Math.max(0, delayMs));
      calibNext += CALIB_BEAT;
    }
    calibRaf = requestAnimationFrame(calibScheduler);
  }

  function playClick(t) {
    if (muted) return;   // build71: respect the global mute flag (M / mute button / persisted rr_muted) — the ring still pulses and taps still register, only the click audio is suppressed
    const o = calibCtx.createOscillator(), g = calibCtx.createGain();
    o.type = 'square'; o.frequency.value = 1100;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(calibCtx.destination);
    o.start(t); o.stop(t + 0.06);
  }

  function calibTap() {
    if (!calibActive || !calibCtx) return;
    const now = calibCtx.currentTime;
    let bd = Infinity;
    for (const ct of calibClicks) { const d = now - ct; if (Math.abs(d) < Math.abs(bd)) bd = d; }
    if (Math.abs(bd) < CALIB_BEAT / 2) calibDeltas.push(bd);
    $('calib-count').textContent = Math.min(CALIB_TARGET, calibDeltas.length) + ' / ' + CALIB_TARGET;
    const pad = $('calib-pad'); pad.style.background = 'radial-gradient(circle, rgba(224,218,214,0.22), transparent 70%)';
    setTimeout(() => { pad.style.background = ''; }, 90);
    if (calibDeltas.length >= CALIB_TARGET) {
      const sorted = calibDeltas.slice().sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const ms = Math.max(-200, Math.min(200, Math.round(med * 1000)));
      $('calib-measured').textContent = (ms > 0 ? '+' : '') + ms + ' ms';
      $('calib-slider').value = ms;
      $('calib-slider-val').textContent = (ms > 0 ? '+' : '') + ms + ' ms';
      calibDeltas = []; // allow re-measure
      $('calib-count').textContent = '0 / ' + CALIB_TARGET;
    }
  }

  // ---- Settings screen ----
  const settingsScreen = $('settings-screen');

  // ---- custom keybinds (one key per lane, one lane per key) ----
  function keyGlyph(k) { return !k ? '—' : (k === ' ' ? '␣' : k.toUpperCase()); }
  function bindLaneKey(lane, key) {
    for (const k in keyMap) if (keyMap[k] === lane) delete keyMap[k];  // lane keeps one key
    delete keyMap[key];                                                // key maps to one lane
    keyMap[key] = lane;
    saveKeyMap(); renderKeycaps(); updateInputsStatus(); updateFooterHint();
  }
  function resetKeys() { const p = LANE_PROFILES[laneProfile]; keyMap = Object.assign({}, (p && p.keyDefault) || DEFAULT_KEY_MAP); saveKeyMap(); renderKeycaps(); updateInputsStatus(); updateFooterHint(); }   // build58: profile-aware (GH=5 keys, not the 6-key DEFAULT) so reset can't pollute rr_keymap_gh with a phantom lane 5
  let rebindLane = null;
  function startRebind(lane) {
    rebindLane = lane;
    const host = $('set-keys'); if (!host) return;
    [...host.children].forEach(c => c.classList.toggle('listening', +c.dataset.lane === lane));
    const cap = host.children[lane]; if (cap) cap.textContent = '…';
  }
  function cancelRebind() { rebindLane = null; renderKeycaps(); }
  function renderKeycaps() {
    const host = $('set-keys'); if (!host) return;
    host.innerHTML = '';
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const cap = document.createElement('button');
      cap.className = 'keycap'; cap.dataset.lane = lane;
      cap.textContent = keyGlyph(keyForLane(lane));
      cap.addEventListener('click', () => startRebind(lane));
      host.appendChild(cap);
    }
  }
  // capture phase — a rebind grabs the next key before gameplay / mute handlers see it
  window.addEventListener('keydown', (e) => {
    if (_wizActive && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelPadWizard(); return; }
    if (padRebindLane != null && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelPadRebind(); return; }
    if (rebindLane == null) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === 'Escape') { cancelRebind(); return; }
    const k = (e.code === 'Space') ? ' ' : e.key.toLowerCase();
    if (k.length === 1 || k === ' ') { const lane = rebindLane; rebindLane = null; bindLaneKey(lane, k); }
    else cancelRebind();   // ignore pure modifiers / fn keys
  }, true);

  // ---- custom controller buttons (mirrors the keyboard remap: one button per lane) ----
  function padGlyph(b) { return b == null ? '—' : ('B' + b); }
  let onPadBound = null;   // wizard hook: fired (lane,button) after a successful bind so it can advance
  // build100q: `keepExisting` (ADD mode) lets MULTIPLE buttons drive the SAME string — runtime already supports it
  // (padMap is button→lane; pollGamepad maps each pressed button independently). Default (replace) evicts the lane's
  // prior button; ADD keeps it. A button still maps to exactly ONE lane (pressing it always hits the same string).
  let _padRebindAdd = false;   // the current rebind is ADD-mode (don't evict the lane's existing button)
  let _padRebindOD = false;    // the current rebind targets the OVERDRIVE/Star-Power button, not a lane
  function bindLaneButton(lane, b, keepExisting) {
    if (!keepExisting) { for (const k in padMap) if (padMap[k] === lane) delete padMap[k]; }   // replace: one button per string
    delete padMap[b];                                                   // each button maps to one lane
    padMap[b] = lane;
    savePadMap(); renderPadcaps(); renderDeviceStatus();
    if (onPadBound) { try { onPadBound(lane, b); } catch (e) {} }
  }
  // build100q: bind the OVERDRIVE button — gh profile uses strumCfg.spBtn (Star Power), standard pads use strumCfg.odBtn.
  // build102v: profile is pinned 'gh' → this always writes spBtn; gameplay's press-mode OD path now accepts spBtn too
  // (pollGamepad ~3198), so the cap works in BOTH hit modes. The odBtn arm is inert plumbing kept with LANE_PROFILES.standard.
  function _bindOdButton(b) {
    if (laneProfile === 'gh') strumCfg.spBtn = b; else strumCfg.odBtn = b;
    saveStrumCfg();
    try { renderPadcaps(); renderDeviceStatus(); } catch (e) {}
    try { window.RhythmGame.showToast && window.RhythmGame.showToast('Overdrive button set to ' + padGlyph(b), 'success'); } catch (e) {}
  }
  function _padGlyphsForLane(lane) {   // ALL buttons mapped to this string (multi-button aware)
    const bs = []; for (const k in padMap) if (padMap[k] === lane) bs.push(+k);
    if (!bs.length) return '—';
    return bs.sort((a, b) => a - b).map(padGlyph).join(' ');
  }
  function resetPad() { padMap = identityPad(LANE_COUNT); savePadMap(); renderPadcaps(); }
  function startPadRebind(lane, opts) {
    opts = opts || {};
    _padRebindAdd = !!opts.add; _padRebindOD = !!opts.od;
    padRebindLane = opts.od ? -1 : lane;   // -1 = armed, but the next press sets the OD button (not a string)
    const host = $('set-pad'); if (!host) return;
    [...host.querySelectorAll('.keycap')].forEach(c => c.classList.remove('listening'));
    const target = opts.od ? host.querySelector('.keycap[data-od]') : host.querySelector('.keycap[data-lane="' + lane + '"]:not(.padadd)');
    if (target) { target.classList.add('listening'); target.textContent = '…'; }
    startProbePoll();   // poll so the next controller button press is captured
  }
  function cancelPadRebind() { padRebindLane = null; _padRebindAdd = false; _padRebindOD = false; renderPadcaps(); }
  function renderPadcaps() {
    const host = $('set-pad'); if (!host) return;
    host.innerHTML = '';
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const cap = document.createElement('button');
      cap.className = 'keycap'; cap.dataset.lane = lane;
      cap.textContent = _padGlyphsForLane(lane);   // build100q: show ALL buttons mapped to this string (multi-button)
      cap.title = laneFretLabel(lane) + ' — click, then press a button to SET it (replaces)';
      cap.addEventListener('click', () => startPadRebind(lane, {}));
      host.appendChild(cap);
      // build100q: "+" adds ANOTHER button to the same string (multiple buttons → one string)
      const add = document.createElement('button');
      add.className = 'keycap padadd'; add.dataset.lane = lane; add.textContent = '+';
      add.title = 'Add another button to ' + laneFretLabel(lane);
      add.addEventListener('click', () => startPadRebind(lane, { add: true }));
      host.appendChild(add);
    }
    // build100q: OVERDRIVE / Star-Power button cap — surfaced here so a controller player can SEE + rebind it (was only
    // reachable via the wizard). gh profile shows strumCfg.spBtn; standard pads show strumCfg.odBtn.
    const odBtn = (laneProfile === 'gh') ? strumCfg.spBtn : strumCfg.odBtn;
    const od = document.createElement('button');
    od.className = 'keycap od-cap'; od.dataset.od = '1';
    od.innerHTML = '<span class="od-lbl">OD</span>' + (odBtn != null ? padGlyph(odBtn) : '—');
    od.title = 'Overdrive / Star Power button — click, then press a button';
    od.addEventListener('click', () => startPadRebind(-1, { od: true }));
    host.appendChild(od);
  }
  try { window.__rrPadMap = () => JSON.parse(JSON.stringify(padMap)); } catch (e) {}

  // ---- GUIDED "SET UP CONTROLLER" WIZARD (the headline controller affordance) -----------------------
  // Walks the user lane-by-lane: highlight a lane, prompt big + clear, capture the NEXT gamepad button
  // press (reusing startProbePoll -> bindLaneButton via the onPadBound hook), confirm, advance. Works for
  // ANY controller including GH guitars (whose fret layout we can't assume). Cancel restores the prior map.
  let _wizActive = false, _wizLane = 0, _wizPrevMap = null, _wizNeedRelease = false;
  function wizEl(id) { return $(id); }
  function _wizSetVisible(on) {
    const ov = wizEl('pad-wizard'); if (ov) ov.style.display = on ? 'flex' : 'none';
  }
  function _wizRender() {
    const total = LANE_COUNT;
    const stepEl = wizEl('pad-wizard-step'); if (stepEl) stepEl.textContent = 'Step ' + (_wizLane + 1) + ' of ' + total;
    const sw = wizEl('pad-wizard-swatch'); if (sw) sw.style.background = laneSwatch(_wizLane);
    const big = wizEl('pad-wizard-prompt');
    if (big) {
      const lbl = laneFretLabel(_wizLane);
      big.innerHTML = 'Press the button for <b>' + lbl + '</b>';
    }
    const sub = wizEl('pad-wizard-sub');
    if (sub) {
      const seen = guitarPadId() || (gamepadList()[0] || null);
      sub.textContent = seen
        ? 'Listening for a button press…  (controller: ' + _padIdShort(seen, 28) + ')'   // build102v: clean trim (was a raw mid-word slice)
        : 'No controller detected yet — plug it in and press any button to wake it.';
      sub.title = seen ? String(seen) : '';
    }
    // progress dots
    const dots = wizEl('pad-wizard-dots');
    if (dots) {
      dots.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const d = document.createElement('span');
        d.className = 'wiz-dot' + (i < _wizLane ? ' done' : (i === _wizLane ? ' now' : ''));
        d.style.setProperty('--wd', laneSwatch(i));
        dots.appendChild(d);
      }
    }
  }
  function _wizListen() {
    // arm the existing pad-capture path for this lane (no #set-pad highlight needed — the wizard is modal)
    padRebindLane = _wizLane;
    try { _seedPadPrev(); } catch (e) {}   // build100q: re-seed so a button still held from the previous lane (or a resting trigger) can't auto-bind THIS lane
    startProbePoll();
    _wizRender();
  }
  function startPadWizard() {
    _wizActive = true;
    _wizPrevMap = JSON.parse(JSON.stringify(padMap));   // for Cancel restore
    padMap = {};                                         // fresh map — every lane gets reassigned in order
    _wizLane = 0;
    _wizNeedRelease = false;
    onPadBound = (lane) => {
      if (!_wizActive) return;
      if (lane === _wizLane) {
        _wizNeedRelease = true;   // build100q FIX: require a CLEAN RELEASE of all buttons before the next fret can capture
        _wizLane++;
        if (_wizLane >= LANE_COUNT) {
          // build102v: standard-pad fork RETIRED — the profile is pinned 'gh' (bootLaneProfile, build102u), so EVERY
          // controller flows into the strum/whammy/star-power calibration. That's on purpose: the STRUM step is now the
          // HIT-MODE declaration point (strum learned → Strum-to-hit; nothing/Skip → Press-to-hit), and its STAR POWER
          // step covers the OD-button capture the old _startStdOdCapture branch existed for.
          savePadMap(); startCalibration();
          return;
        }
        _wizListen();
      }
    };
    _wizSetVisible(true);
    _wizListen();
    renderDeviceStatus();
  }
  function _wizCleanup() {
    _wizActive = false; onPadBound = null; padRebindLane = null; _wizStdOdActive = false; _wizNeedRelease = false;
    _stopCalRaf(); _calStep = -1;   // stop any in-flight strum/whammy/tilt sampler
    _wizSetVisible(false);
    try { renderPadcaps(); renderDeviceStatus(); } catch (e) {}
  }
  // build102v: RETIRED — profile pinned 'gh' (bootLaneProfile), so the standard-pad wizard tail below (_startStdOdCapture
  // → _finishStdOd → finishPadWizard) is unreachable: every wizard run ends in startCalibration() instead. Kept as
  // archaeology (harmless dead code; _wizStdOdActive can never go true) in case a non-guitar profile ever returns.
  // build100q: STANDARD-pad Overdrive capture — after the 5 lanes, the standard-pad wizard captures ONE more button for
  // Overdrive/Star Power (it had no way to bind it before). Reuses the calibration sampler (which seeds its own baseline,
  // so a still-held lane button can't bind OD). Skip keeps the default odBtn (RB=5). Then finishPadWizard.
  let _wizStdOdActive = false;
  function _startStdOdCapture() {
    _wizStdOdActive = true; onPadBound = null; padRebindLane = null;
    const stepEl = wizEl('pad-wizard-step'); if (stepEl) stepEl.textContent = 'Overdrive button';
    const sw = wizEl('pad-wizard-swatch'); if (sw) sw.style.background = 'var(--gold, #e0a93f)';
    const big = wizEl('pad-wizard-prompt'); if (big) big.innerHTML = 'Press the button for <b>OVERDRIVE</b> (Star Power)';
    const sub = wizEl('pad-wizard-sub'); if (sub) sub.textContent = 'Pick a free button — a shoulder works well. Or Skip to keep the default.';
    const dots = wizEl('pad-wizard-dots'); if (dots) dots.innerHTML = '';
    const skip = wizEl('pad-wizard-skip'); if (skip) skip.style.display = 'inline-block';
    _captureNextButton(15000, (b) => { if (b != null) { strumCfg.odBtn = b; saveStrumCfg(); } _finishStdOd(); });
  }
  function _finishStdOd() {
    _wizStdOdActive = false; _stopCalRaf();
    const skip = wizEl('pad-wizard-skip'); if (skip) skip.style.display = 'none';
    finishPadWizard();
  }
  function cancelPadWizard() {
    if (!_wizActive) { _wizSetVisible(false); return; }
    if (_wizPrevMap) { padMap = _wizPrevMap; savePadMap(); }   // restore the map we had before
    _wizPrevMap = null;
    _wizCleanup();
  }
  function finishPadWizard() {
    savePadMap();
    _wizPrevMap = null;
    const big = wizEl('pad-wizard-prompt'); if (big) big.innerHTML = '✅ All set! Your controller is mapped.';
    const sub = wizEl('pad-wizard-sub'); if (sub) sub.textContent = 'Close this and try Input Test to confirm each fret.';
    const stepEl = wizEl('pad-wizard-step'); if (stepEl) stepEl.textContent = 'Done';
    _wizLane = LANE_COUNT;
    onPadBound = null; padRebindLane = null;
    _wizRender();
    const dn = wizEl('pad-wizard-done'); if (dn) dn.textContent = 'DONE';
    try { renderPadcaps(); renderDeviceStatus(); } catch (e) {}
    try { window.RhythmGame.showToast('Controller mapped!', 'success'); } catch (e) {}
  }
  // ---- GH STRUM / WHAMMY / TILT CALIBRATION (extends the wizard for guitars) -------------------
  // After the 5 frets, the gh (5-lane guitar) profile flows into 3 capture steps that write the
  // strum bar / whammy axis / tilt(or Select) into rr_strumcfg. Self-contained rAF samplers read
  // navigator.getGamepads() DIRECTLY — they never touch the hot pollGamepad path. Each step has a
  // timeout → keep-default + a Skip button, so a missing control can't strand the wizard.
  let _calStep = -1, _calRaf = 0, _calTimer = 0;
  const CAL_STEPS = [
    { title: 'STRUM',      prompt: 'Strum the <b>STRUM BAR</b> a few times',             sub: 'Keep strumming up/down for ~2s — we’ll learn it (button or bar).' },
    { title: 'WHAMMY',     prompt: 'Wiggle the <b>WHAMMY BAR</b> through its full range', sub: 'Push it all the way and release, for ~1.5s.' },
    { title: 'STAR POWER', prompt: 'Tilt the guitar <b>UP</b> — or press <b>Select</b>',  sub: 'This becomes your Star Power / Overdrive trigger.' },
  ];
  function _stopCalRaf() { if (_calRaf) { try { cancelAnimationFrame(_calRaf); } catch (e) {} _calRaf = 0; } if (_calTimer) { clearTimeout(_calTimer); _calTimer = 0; } if (_strumDetectRaf) { try { cancelAnimationFrame(_strumDetectRaf); } catch (e) {} _strumDetectRaf = 0; } }   // build100r-fix: the STRUM step now runs detectStrum on its OWN raf — kill it too so wizard Skip can't leave a dangling capture that double-advances
  function _padsNow() { try { return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []; } catch (e) { return []; } }
  function _captureNextButton(timeoutMs, cb) {
    _stopCalRaf(); const t0 = performance.now(); let base = null;
    const tick = () => {
      const pads = _padsNow();
      if (!base) { base = {}; pads.forEach(g => base[g.index] = g.buttons.map(b => b.pressed)); }
      for (const g of pads) { const bs = base[g.index] || []; for (let b = 0; b < g.buttons.length; b++) { if (g.buttons[b].pressed && !bs[b]) { _calRaf = 0; cb(b, g.index); return; } } base[g.index] = g.buttons.map(b => b.pressed); }
      if (performance.now() - t0 > timeoutMs) { _calRaf = 0; cb(null); return; }
      _calRaf = requestAnimationFrame(tick);
    };
    _calRaf = requestAnimationFrame(tick);
  }
  function _sampleAxes(durationMs, thresh, cb) {
    _stopCalRaf(); const t0 = performance.now(); const mn = {}, mx = {};
    const tick = () => {
      for (const g of _padsNow()) for (let a = 0; a < g.axes.length; a++) { const v = g.axes[a]; if (mn[a] == null || v < mn[a]) mn[a] = v; if (mx[a] == null || v > mx[a]) mx[a] = v; }
      if (performance.now() - t0 > durationMs) { _calRaf = 0; let best = null, bestR = thresh; for (const k in mn) { const r = mx[k] - mn[k]; if (r > bestR) { bestR = r; best = +k; } } cb(best, best == null ? 0 : mn[best], best == null ? 0 : mx[best]); return; }
      _calRaf = requestAnimationFrame(tick);
    };
    _calRaf = requestAnimationFrame(tick);
  }
  // build100r: STRUM AUTO-DETECT — learns whatever the strum input IS on THIS controller (a button OR an axis/POV-hat),
  // including the axis's RESTING value, so gameplay can fire one strum per stroke without the player ever touching the
  // browser console. Drives the in-Settings "Test strum" button (and the wizard's STRUM step). Tell the player to move
  // ONLY the strum bar for ~2.5s; whatever moves the most wins. onProgress({remaining,moving}) fires each frame for the
  // live UI flash; onDone({type:'button'|'axis'|'none', index, rest?, range?}) fires once at the end. Writes strumCfg.
  let _strumDetectRaf = 0;
  function detectStrum(durationMs, onProgress, onDone) {
    if (_strumDetectRaf) { try { cancelAnimationFrame(_strumDetectRaf); } catch (e) {} _strumDetectRaf = 0; }
    const t0 = performance.now();
    const fretBtns = new Set(); try { for (const k in padMap) fretBtns.add(+k); } catch (e) {}   // exclude mapped frets from the button candidate
    let baseBtn = null; const axMin = {}, axMax = {}, axBase = {}, axHist = {}, btnHits = {};
    const tick = () => {
      const pads = _padsNow();
      if (!baseBtn) { baseBtn = {}; pads.forEach(g => { baseBtn[g.index] = g.buttons.map(b => b.pressed); for (let a = 0; a < g.axes.length; a++) axBase[g.index + ':' + a] = g.axes[a]; }); }
      let moving = false;
      for (const g of pads) {
        const bs = baseBtn[g.index] || [];
        for (let b = 0; b < g.buttons.length; b++) {
          const p = g.buttons[b].pressed;
          if (p && !bs[b] && !fretBtns.has(b) && b !== 8 && b !== 9) { btnHits[b] = (btnHits[b] || 0) + 1; moving = true; }   // new non-fret, non-system press
          bs[b] = p;
        }
        baseBtn[g.index] = bs;
        for (let a = 0; a < g.axes.length; a++) {
          const v = g.axes[a], k = g.index + ':' + a;
          if (axMin[k] == null || v < axMin[k]) axMin[k] = v;
          if (axMax[k] == null || v > axMax[k]) axMax[k] = v;
          // build100r-fix: histogram per axis (0.2 buckets) so REST = the value the bar sits at MOST (its spring-home),
          // NOT the t0 sample — an eager player is often mid-stroke on frame 1, which would poison strumRest.
          const bk = Math.round(v / 0.2); const h = axHist[k] || (axHist[k] = {}); const hb = h[bk] || (h[bk] = { n: 0, s: 0 }); hb.n++; hb.s += v;
          if (Math.abs(v - (axBase[k] || 0)) > 0.4) moving = true;
        }
      }
      if (onProgress) { try { onProgress({ remaining: Math.max(0, durationMs - (performance.now() - t0)), moving: moving }); } catch (e) {} }
      if (performance.now() - t0 > durationMs) {
        _strumDetectRaf = 0;
        // ALL non-fret strum buttons that fired, strongest first — capture BOTH directions (up AND down), not just one.
        const btnList = Object.keys(btnHits).map(k => +k).sort((a, b) => btnHits[b] - btnHits[a]);
        // REST = the centroid of the most-occupied 0.2 bucket of an axis (its spring-home), robust to a mid-stroke t0.
        const restOf = (key) => { const h = axHist[key]; if (!h) return axBase[key] || 0; let best = null, bestN = -1; for (const bk in h) { if (h[bk].n > bestN) { bestN = h[bk].n; best = h[bk]; } } return best ? best.s / best.n : (axBase[key] || 0); };
        // best AXIS by range, EXCLUDING the already-mapped whammy/tilt so the strum can't accidentally land on them.
        let bestAx = null, bestRange = 0.8, bestRest = 0;
        for (const k in axMin) {
          const a = +k.split(':')[1];
          if (a === strumCfg.whammyAxis || a === strumCfg.tiltAxis) continue;
          const range = axMax[k] - axMin[k];
          if (range > bestRange) { bestRange = range; bestAx = a; bestRest = restOf(k); }
        }
        let result;
        // build100r-fix: PREFER an AXIS over a button — a single axis (strum bar / POV-hat) covers BOTH the up AND the
        // down stroke, whereas a captured button is ONE direction only. This is the reported "strum only fires when I
        // do up AND down together" bug: detection had grabbed a single one-way button. The gameplay deviation detector
        // already fires each direction independently; STRUM_DEBOUNCE_MS dedupes a hat that reports as both axis + button.
        if (bestAx != null) {
          strumCfg.strumAxis = bestAx; strumCfg.strumRest = +(+bestRest).toFixed(2); strumCfg.strumAxisDir = 0;
          if (btnList.length) strumCfg.btns = btnList.slice(0, 3);   // keep any strum buttons too (both directions)
          saveStrumCfg();
          result = { type: 'axis', index: bestAx, rest: strumCfg.strumRest, range: +bestRange.toFixed(2), btns: strumCfg.btns };
        } else if (btnList.length) {
          strumCfg.btns = btnList.slice(0, 3); strumCfg.strumAxis = null; saveStrumCfg();   // both up + down strum buttons
          result = { type: 'button', index: btnList[0], btns: strumCfg.btns };
        } else { result = { type: 'none' }; }
        if (onDone) { try { onDone(result); } catch (e) {} }
        return;
      }
      _strumDetectRaf = requestAnimationFrame(tick);
    };
    _strumDetectRaf = requestAnimationFrame(tick);
  }
  try { window.RhythmGame.detectStrum = detectStrum; } catch (e) {}

  function _captureTilt(durationMs, cb) {
    _stopCalRaf(); const t0 = performance.now(); let base = null; const mn = {}, mx = {};
    const tick = () => {
      const pads = _padsNow();
      if (!base) { base = {}; pads.forEach(g => base[g.index] = g.buttons.map(b => b.pressed)); }
      for (const g of pads) { const bs = base[g.index] || []; for (let b = 0; b < g.buttons.length; b++) { if (g.buttons[b].pressed && !bs[b]) { _calRaf = 0; cb({ spBtn: b }); return; } } base[g.index] = g.buttons.map(b => b.pressed); for (let a = 0; a < g.axes.length; a++) { const v = g.axes[a]; if (mn[a] == null || v < mn[a]) mn[a] = v; if (mx[a] == null || v > mx[a]) mx[a] = v; } }
      if (performance.now() - t0 > durationMs) { _calRaf = 0; let best = null, bestR = 0.5; for (const k in mn) { const r = mx[k] - mn[k]; if (r > bestR) { bestR = r; best = +k; } } cb(best == null ? {} : { tiltAxis: best, tiltThresh: +Math.max(0.4, mn[best] + (mx[best] - mn[best]) * 0.6).toFixed(2) }); return; }
      _calRaf = requestAnimationFrame(tick);
    };
    _calRaf = requestAnimationFrame(tick);
  }
  function _calRender(captured) {
    const s = CAL_STEPS[_calStep]; if (!s) return;
    const stepEl = wizEl('pad-wizard-step'); if (stepEl) stepEl.textContent = 'Guitar setup — ' + s.title + ' (' + (_calStep + 1) + ' of 3)';
    const sw = wizEl('pad-wizard-swatch'); if (sw) sw.style.background = 'var(--crimson, #ff2a30)';
    const big = wizEl('pad-wizard-prompt'); if (big) big.innerHTML = captured ? ('✅ ' + s.title + ' set') : s.prompt;
    const sub = wizEl('pad-wizard-sub'); if (sub) sub.textContent = captured || s.sub;
    const dots = wizEl('pad-wizard-dots'); if (dots) { dots.innerHTML = ''; for (let i = 0; i < 3; i++) { const d = document.createElement('span'); d.className = 'wiz-dot' + (i < _calStep ? ' done' : (i === _calStep ? ' now' : '')); d.style.setProperty('--wd', '#ff3c3c'); dots.appendChild(d); } }
    const skip = wizEl('pad-wizard-skip'); if (skip) skip.style.display = 'inline-block';
  }
  function startCalibration() {
    onPadBound = null; padRebindLane = null; _wizPrevMap = null;   // frets are committed; cal can't be cancelled back to a fret remap
    _calStep = 0; _armCalStep();
  }
  // build102v: HIT-MODE SELF-CONFIGURATION — the wizard's STRUM step is now the declaration point. build102u dropped
  // the guitarShapedPad() identity check from requireStrum() (real GH guitars enumerate as plain "Xbox 360 Controller
  // (XInput)"), so a REGULAR pad player landed in strum mode by default: frets held, notes needed a D-pad strum,
  // total confusion. Now: strum LEARNED (button or axis) → Strum-to-hit; nothing detected / step SKIPPED →
  // Press-to-hit. Either way the player is told, and the Settings HIT MODE seg stays one tap away to override.
  function _declareHitMode(strumFound) {
    try { window.RhythmGame.setStrumRequired(!!strumFound); } catch (e) {}
    try { window.RhythmGame.showToast(strumFound ? 'Strum bar set — HIT MODE: Strum to hit' : 'No strum bar — HIT MODE: Press to hit (change anytime in Settings)', strumFound ? 'success' : 'neutral'); } catch (e) {}
  }
  function _armCalStep() {
    _calRender(null);
    if (_calStep === 0) detectStrum(2600, null, (r) => { if (_calStep !== 0) return; const found = (r.type === 'button' || r.type === 'axis'); if (r.type === 'button') _calRender('Strum = button ' + r.index); else if (r.type === 'axis') _calRender('Strum = axis ' + r.index); else _calRender('No strum bar — press frets to hit'); _declareHitMode(found); _calNext(900); });   // build100r: capture a BUTTON or an AXIS/POV-hat strum (was button-only → axis strums silently un-mapped); _calStep guard so a Skip mid-capture can't double-advance. build102v: result now DECLARES the hit mode (see _declareHitMode)
    else if (_calStep === 1) _sampleAxes(1600, 0.4, (axis, lo, hi) => { if (axis != null) { strumCfg.whammyAxis = axis; strumCfg.whammyMin = +(+lo).toFixed(2); strumCfg.whammyMax = +(+hi).toFixed(2); saveStrumCfg(); _calRender('Whammy = axis ' + axis); } else _calRender('Whammy = default (none found)'); _calNext(800); });
    else if (_calStep === 2) _captureTilt(2200, (res) => { if (res && res.spBtn != null) { strumCfg.spBtn = res.spBtn; saveStrumCfg(); _calRender('Star Power = button ' + res.spBtn); } else if (res && res.tiltAxis != null) { strumCfg.tiltAxis = res.tiltAxis; strumCfg.tiltThresh = res.tiltThresh; saveStrumCfg(); _calRender('Star Power = tilt axis ' + res.tiltAxis); } else _calRender('Star Power = Select (default)'); _calNext(900); });
  }
  function _calNext(delayMs) { clearTimeout(_calTimer); _calTimer = setTimeout(() => { _calTimer = 0; if (_calStep < 0) return; _calStep++; if (_calStep > 2) finishCalibration(); else _armCalStep(); }, delayMs || 600); }
  function _calSkip() {
    if (_calStep < 0) return;
    // build102v: skipping the STRUM step mid-capture = "I have no strum bar" → declare Press-to-hit. _calTimer set
    // means the capture already FINISHED (we're in the 900ms confirm pause, hit mode already declared) — a Skip there
    // just advances early and must NOT overwrite a successful strum declaration.
    const _midCapture = !_calTimer;
    clearTimeout(_calTimer); _calTimer = 0; _stopCalRaf();
    if (_calStep === 0 && _midCapture) _declareHitMode(false);
    _calStep++; if (_calStep > 2) finishCalibration(); else _armCalStep();
  }
  function finishCalibration() {
    _stopCalRaf(); _calStep = -1; _wizActive = false; saveStrumCfg();
    // build102v: the finish copy follows the DECLARED hit mode — telling a press-to-hit pad player "fret + strum to
    // play" was exactly the confusion this wizard exists to kill.
    let _strumOn = true; try { _strumOn = window.RhythmGame.getStrumRequired(); } catch (e) {}
    const big = wizEl('pad-wizard-prompt'); if (big) big.innerHTML = _strumOn ? '✅ Guitar ready — <b>fret + strum</b> to play.' : '✅ Controller ready — <b>press a fret button</b> to hit.';
    const sub = wizEl('pad-wizard-sub'); if (sub) sub.textContent = _strumOn ? 'Whammy charges Overdrive · tilt / Select fires Star Power. Re-run anytime to remap.' : 'Your Star Power button fires Overdrive. Re-run anytime to remap — HIT MODE lives in Settings.';
    const stepEl = wizEl('pad-wizard-step'); if (stepEl) stepEl.textContent = 'Done';
    const skip = wizEl('pad-wizard-skip'); if (skip) skip.style.display = 'none';
    const dots = wizEl('pad-wizard-dots'); if (dots) dots.querySelectorAll('.wiz-dot').forEach(d => { d.className = 'wiz-dot done'; });
    const dn = wizEl('pad-wizard-done'); if (dn) dn.textContent = 'DONE';
    try { renderDeviceStatus(); } catch (e) {}
    try { window.RhythmGame.showToast(_strumOn ? 'Guitar calibrated — fret + strum!' : 'Controller ready — press to hit!', 'success'); } catch (e) {}
  }
  try { window.__rrPadWizard = () => ({ active: _wizActive, lane: _wizLane, total: LANE_COUNT, calStep: _calStep }); } catch (e) {}
  // dev hook (strip at content-freeze): drive the strum-cal flow headless (samplers need real hardware; skip advances)
  try { window.__rrCal = { start: () => { _wizActive = true; _wizSetVisible(true); startCalibration(); return _calStep; }, skip: () => { _calSkip(); return _calStep; }, step: () => _calStep, cfg: () => Object.assign({}, strumCfg) }; } catch (e) {}

  // ---- controllers & MIDI: live status + input test ----
  function updateInputsStatus() {
    const el = $('set-inputs'); if (!el) return;
    const keys = []; for (let l = 0; l < LANE_COUNT; l++) keys.push(keyGlyph(keyForLane(l)));
    el.textContent = 'Touch · Keys ' + keys.join(' ');
  }
  // build102v: clean display-trim for controller ids — the old raw slice() cut mid-parenthesis ("Xbox 360 Controller
  // (XIn"). Cut at max chars, drop an unclosed "(…" tail, back off trailing separators, then a single ellipsis. The
  // FULL id always rides a title attribute at the call sites so hover reveals it.
  function _padIdShort(id, max) {
    id = String(id || ''); max = max || 28;
    if (id.length <= max) return id;
    let s = id.slice(0, max);
    const op = s.lastIndexOf('('); if (op >= 0 && s.indexOf(')', op) < 0) s = s.slice(0, op);   // never end inside "(…"
    s = s.replace(/[\s\-·:,(]+$/, '');
    return s + '…';
  }
  function renderDeviceStatus() {
    const el = $('set-devices');
    const pads = gamepadList();
    const ghId = guitarPadId();
    if (el) {
      const rows = [['Keyboard', 'Ready', true]];
      if (!navigator.requestMIDIAccess) rows.push(['MIDI', 'Unsupported browser', false]);
      else rows.push(['MIDI', midiInputs.length ? midiInputs.join(', ') : 'No device detected', midiInputs.length > 0]);
      rows.push(['Controller', pads.length ? _padIdShort(pads[0], 26) : 'No device detected', pads.length > 0, pads.length ? pads[0] : null]);   // build102v: clean trim + full id on hover (r[3] → title)
      if (ghId) {   // GH-3: surface the calibrated strum/whammy/tilt mapping so a guitar player can confirm setup
        // build100r-fix: reflect an AXIS/POV-hat strum too — detectStrum can bind strumCfg.strumAxis (not just btns), so a
        // learned strum bar must read as "set" here, not "Not set".
        { const _hasAx = (strumCfg.strumAxis != null); const _hasBtn = !!(strumCfg.btns && strumCfg.btns.length);
          const _sv = _hasAx ? ('Strum bar (axis ' + strumCfg.strumAxis + ')') : (_hasBtn ? ('Button ' + strumCfg.btns.join('/')) : 'Not set');
          rows.push(['Strum', _sv, _hasAx || _hasBtn]); }
        rows.push(['Whammy', strumCfg.whammyAxis != null ? ('Axis ' + strumCfg.whammyAxis) : 'Not set', strumCfg.whammyAxis != null]);
        rows.push(['Tilt / Star Power', strumCfg.tiltAxis != null ? ('Tilt axis ' + strumCfg.tiltAxis) : ('Button ' + strumCfg.spBtn), true]);
      }
      el.innerHTML = rows.map(r => '<div class="dev-row"><span class="dev-n">' + r[0] + '</span><span class="dev-v' + (r[2] ? ' ok' : '') + '"' + (r[3] ? ' title="' + escDev(r[3]) + '"' : '') + '>' + escDev(r[1]) + '</span></div>').join('');
    }
    // Guitar-Hero auto-detect badge + "set up my guitar" affordance
    const badge = $('gh-badge');
    if (badge) {
      badge.style.display = ghId ? 'flex' : 'none';
      const nm = $('gh-badge-name'); if (nm) { nm.textContent = _padIdShort(ghId, 30); nm.title = String(ghId || ''); }   // build102v: clean trim + full id on hover
      // GH-1: surface that REQUIRE STRUM is active so a new guitar player doesn't think the controller is broken
      const ss = $('gh-strum-status'); if (ss) { const on = requireStrum(); ss.textContent = on ? 'REQUIRE STRUM: ON — hold a fret + strum' : 'REQUIRE STRUM: OFF'; ss.style.color = on ? '#e0a93f' : 'var(--ink-dim)'; }
    }
    // pad-status hint near the wizard button
    const padHint = $('pad-status-hint');
    if (padHint) {
      // build102v: clean trim (no more "Xbox 360 Controller (XIn") + full id on hover + a "· strum mode" tell when
      // HIT MODE=Strum is live for this pad — the one line a confused press-vs-strum player actually reads.
      const strumTag = (pads.length && requireStrum()) ? ' · strum mode' : '';
      padHint.title = pads.length ? String(pads[0]) : '';
      padHint.textContent = pads.length
        ? ((ghId ? '🎸 Guitar Hero controller ready' : '🎮 Controller detected: ' + _padIdShort(pads[0], 28)) + strumTag)
        : 'No controller yet — plug one in and press any button.';
      padHint.classList.toggle('ok', pads.length > 0);
    }
  }
  function escDev(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }   // build102v: + double-quote (ids now ride title="" attributes)
  function setTest(on) {
    const pips = $('set-test-pips'), btn = $('set-test-btn');
    if (btn) { btn.textContent = on ? 'STOP TEST' : 'TEST INPUT'; btn.classList.toggle('active', on); }
    if (pips) {
      // build pips to match the ACTIVE profile's lane count — build102v: the static markup is now 5 (the game is
      // 5-lane only), so this rebuild is normally a no-op; it stays as the guard for any future count divergence
      // and drives the grid columns off LANE_COUNT.
      if (on && pips.children.length !== LANE_COUNT) {
        pips.innerHTML = '';
        for (let i = 0; i < LANE_COUNT; i++) pips.appendChild(document.createElement('span'));
      }
      pips.style.gridTemplateColumns = 'repeat(' + LANE_COUNT + ', 1fr)';
      pips.style.display = on ? 'grid' : 'none';
    }
    setLaneProbe(on ? (lane) => {
      const pip = pips && pips.children[lane];
      if (pip) { pip.classList.add('lit'); clearTimeout(pip._t); pip._t = setTimeout(() => pip.classList.remove('lit'), 200); }
    } : null);
    if (on) renderDeviceStatus();
  }

  function openSettings() {
    const s = window.RhythmGame.getSettings();
    $('set-scroll').value = s.scroll; $('set-scroll-v').textContent = s.scroll.toFixed(1) + '×';
    { const m = $('set-music'); if (m) { m.value = s.music; const mv = $('set-music-v'); if (mv) mv.textContent = Math.round(s.music * 100) + '%'; } }
    { const x = $('set-sfx'); if (x) { x.value = s.sfx; const xv = $('set-sfx-v'); if (xv) xv.textContent = Math.round((s.sfx / 0.5) * 100) + '%'; } }
    [...$('set-fx').children].forEach(b => b.classList.toggle('active', (b.dataset.fx === 'lite') === s.fxLite));
    { const fi = $('set-fxi'); if (fi) [...fi.children].forEach(b => b.classList.toggle('active', b.dataset.fxi === (s.fxIntensity || 'balanced'))); }
    { const rm = $('set-rm'); if (rm) [...rm.children].forEach(b => b.classList.toggle('active', (b.dataset.rm === 'on') === s.reduceMotion)); }
    { const ff = $('set-fail'); if (ff) [...ff.children].forEach(b => b.classList.toggle('active', (b.dataset.fail === 'on') === !!s.failMode)); }
    { const cf = $('set-chart'); if (cf) [...cf.children].forEach(b => b.classList.toggle('active', b.dataset.chart === (s.chartMode || 'musical'))); }
    { const lg = $('set-levelguitar'); if (lg) [...lg.children].forEach(b => b.classList.toggle('active', b.dataset.levelguitar === (s.levelGuitar || 'mine'))); }
    { const tg = $('set-timing'); if (tg) [...tg.children].forEach(b => b.classList.toggle('active', b.dataset.timing === window.RhythmGame.getTimingFeel())); }
    { const nv = $('set-notes'); if (nv) { const on = window.RhythmGame.getNoteVariety(); [...nv.children].forEach(b => b.classList.toggle('active', (b.dataset.notes === 'on') === on)); } }
    { const th = $('set-timinghint'); if (th) { const on = (localStorage.getItem('rr_timinghint') !== '0'); [...th.children].forEach(b => b.classList.toggle('active', (b.dataset.thint === 'on') === on)); } }
    { const bg = $('set-bg'); if (bg) [...bg.children].forEach(b => b.classList.toggle('active', (b.dataset.bg === 'performance') === (s.bgMode === 'performance'))); }
    // build102v: #set-lanemode paint removed — the Lane Mode toggle left the markup in build102u (5-lane only).
    renderKeycaps(); renderPadcaps(); updateInputsStatus(); renderDeviceStatus();
    settingsScreen.classList.add('active');
  }
  function closeSettings() { setTest(false); cancelRebind(); cancelPadRebind(); cancelPadWizard(); settingsScreen.classList.remove('active'); }
  $('calib-open').addEventListener('click', openSettings);
  // ---------- How to Play (note-type legend) ----------
  { const ho = $('howto-open'), hs = $('howto-screen'), hc = $('howto-close');
    if (ho && hs) ho.addEventListener('click', () => hs.classList.add('active'));
    // build84 (3B-ii): UNMISSABLE first run. closeHowto() now takes an `ack` flag — only an EXPLICIT
    // acknowledgement (GOT IT, or CALIBRATE) marks rr_howto_seen. A backdrop click just hides the
    // overlay this once; the first-run auto-pop returns on the next menu visit until the player
    // actually taps a CTA, so session one can never silently swallow the tutorial on a stray tap.
    // first-time players get it once, automatically — but AFTER the title screen + RYO intro have
    // finished (it used to pop on a boot timer underneath them = broken first impression), and never
    // over gameplay/loading if they raced straight into a song. Hoisted so a NON-acked backdrop
    // dismissal can re-arm it: until rr_howto_seen is set it re-pops once the player settles on a
    // safe (non-live) screen.
    let _howtoSeen = false; try { _howtoSeen = !!localStorage.getItem('rr_howto_seen'); } catch (e) {}
    const tryShowHowto = () => {
      try {
        if (_howtoSeen || !hs) return;
        if (document.querySelector('#start.active, #ryo-intro.active, #menu-hub.active, #game.active, #loading.active, #countdown-screen.active, #multiplayer-screen.active, #results.active')) { setTimeout(tryShowHowto, 900); return; }   // never pop the first-run How-To over a live MP/tournament round, results, the guided hub, or a live 3·2·1 countdown (build72: + #menu-hub/#countdown-screen — howto z-260 was occluding the hub z-240)
        hs.classList.add('active');
      } catch (e) {}
    };
    const closeHowto = (ack) => {
      if (hs) hs.classList.remove('active');
      if (ack) { _howtoSeen = true; try { localStorage.setItem('rr_howto_seen', '1'); } catch (e) {} }
      else if (!_howtoSeen) { setTimeout(tryShowHowto, 1200); }   // backdrop dismissal: NOT acknowledged → bring it back once they're back on the menu
    };
    if (hc) hc.addEventListener('click', () => closeHowto(true));
    { const hcal = $('howto-calibrate'); if (hcal) hcal.addEventListener('click', () => { closeHowto(true); openCalib(); }); }
    if (hs) hs.addEventListener('click', (e) => { if (e.target === hs) closeHowto(false); });   // backdrop = hide only, NOT acknowledged
    try { if (!_howtoSeen) setTimeout(tryShowHowto, 800); } catch (e) {}
  }
  $('set-close').addEventListener('click', closeSettings);
  $('set-calibrate').addEventListener('click', () => { closeSettings(); openCalib(); });
  // RESET ALL SETTINGS — two-tap "tap again to confirm" arm (mirrors the Career reset), so a stray
  // click can't wipe a player's tuning. Clears rr_settings + every key/pad map back to defaults,
  // re-applies the default settings live, then repaints the panel.
  { const ra = $('set-reset-all'); if (ra) {
    const RESET_LABEL = 'RESET ALL SETTINGS';
    let resetArmed = false, resetArmT = 0;
    const disarmReset = () => { resetArmed = false; ra.textContent = RESET_LABEL; ra.classList.remove('arm'); };
    ra.addEventListener('click', () => {
      if (!resetArmed) { resetArmed = true; ra.textContent = 'TAP AGAIN TO RESET'; ra.classList.add('arm'); clearTimeout(resetArmT); resetArmT = setTimeout(disarmReset, 3000); return; }
      clearTimeout(resetArmT); disarmReset();
      // build65 (cycle-5): added rr_notes / rr_offset_ms / rr_open — they were SURVIVING a "reset all" that claimed to wipe everything.
      try { ['rr_settings', 'rr_keymap', 'rr_keymap_gh', 'rr_padmap', 'rr_padmap_gh', 'rr_timinghint', 'rr_juice', 'rr_notes', 'rr_offset_ms', 'rr_open', 'rr_autocal'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
      // canonical defaults (match getSettings/applySettings defaults)
      try { window.RhythmGame.applySettings({ scroll: 1, fxLite: false, reduceMotion: false, bgMode: 'cinematic', music: 1, sfx: 0.05, failMode: false, chartMode: 'musical', levelGuitar: 'mine', fxIntensity: 'balanced' }); } catch (e) {}
      try { window.RhythmGame.setTimingFeel && window.RhythmGame.setTimingFeel('classic'); } catch (e) {}
      try { window.RhythmGame.setTimingHint && window.RhythmGame.setTimingHint(true); } catch (e) {}
      try { window.RhythmGame.setNoteVariety && window.RhythmGame.setNoteVariety(true); } catch (e) {}   // build65 (cycle-5): default ON
      try { audioOffset = 0; var _cs = $('calib-slider'), _cv = $('calib-slider-val'); if (_cs) _cs.value = 0; if (_cv) _cv.textContent = '0 ms'; } catch (e) {}   // build65 (cycle-5): clear the calibration offset live too
      try { resetKeys(); } catch (e) {}     // profile-aware lane-key reset (defined below in this module)
      try { padMap = loadPadMapFor(padStore, LANE_COUNT); renderPadcaps(); } catch (e) {}
      try { openSettings(); } catch (e) {}  // repaint the panel against the fresh defaults
      try { window.RhythmGame.showToast && window.RhythmGame.showToast('All settings reset to defaults', 'success'); } catch (e) {}
    });
    // disarm if the panel closes mid-arm
    const _origCloseSettings = closeSettings;
    closeSettings = function () { disarmReset(); return _origCloseSettings.apply(this, arguments); };
  } }
  $('set-scroll').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value); $('set-scroll-v').textContent = v.toFixed(1) + '×';
    window.RhythmGame.applySettings({ scroll: v });
  });
  { const m = $('set-music'); if (m) m.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value); const fmt = Math.round(v * 100) + '%'; const mv = $('set-music-v'); if (mv) mv.textContent = fmt;
    e.target.setAttribute('aria-valuetext', fmt);   // build65 a11y: announce the formatted % not the raw 0..1 value
    window.RhythmGame.applySettings({ music: v });
  }); }
  { const x = $('set-sfx'); if (x) x.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value); const fmt = Math.round((v / 0.5) * 100) + '%'; const xv = $('set-sfx-v'); if (xv) xv.textContent = fmt;
    e.target.setAttribute('aria-valuetext', fmt);   // build65 a11y
    window.RhythmGame.applySettings({ sfx: v });
  }); }
  [...$('set-fx').children].forEach(b => b.addEventListener('click', () => {
    [...$('set-fx').children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.applySettings({ fxLite: b.dataset.fx === 'lite' });
  }));
  { const fi = $('set-fxi'); if (fi) [...fi.children].forEach(b => b.addEventListener('click', () => {
    [...fi.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.applySettings({ fxIntensity: b.dataset.fxi });
  })); }
  { const rm = $('set-rm'); if (rm) [...rm.children].forEach(b => b.addEventListener('click', () => {
    [...rm.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.applySettings({ reduceMotion: b.dataset.rm === 'on' });
  })); }
  { const ff = $('set-fail'); if (ff) [...ff.children].forEach(b => b.addEventListener('click', () => {
    [...ff.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.applySettings({ failMode: b.dataset.fail === 'on' });
  })); }
  { const cf = $('set-chart'); if (cf) [...cf.children].forEach(b => b.addEventListener('click', () => {
    [...cf.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.applySettings({ chartMode: b.dataset.chart });
  })); }
  { const lg = $('set-levelguitar'); if (lg) [...lg.children].forEach(b => b.addEventListener('click', () => {
    [...lg.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.applySettings({ levelGuitar: b.dataset.levelguitar });
  })); }
  { const tg = $('set-timing'); if (tg) [...tg.children].forEach(b => b.addEventListener('click', () => {
    [...tg.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.setTimingFeel(b.dataset.timing);
  })); }
  { const th = $('set-timinghint'); if (th) [...th.children].forEach(b => b.addEventListener('click', () => {
    [...th.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.setTimingHint(b.dataset.thint === 'on');
  })); }
  { const nv = $('set-notes'); if (nv) [...nv.children].forEach(b => b.addEventListener('click', () => {
    [...nv.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.setNoteVariety(b.dataset.notes === 'on');
  })); }
  { const bg = $('set-bg'); if (bg) [...bg.children].forEach(b => b.addEventListener('click', () => {
    [...bg.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.applySettings({ bgMode: b.dataset.bg });
  })); }
  // build102v: #set-lanemode click wiring removed — the Lane Mode toggle left the markup in build102u ("we don't do
  // six strings"); bootLaneProfile pins 'gh', so the block could never find its element again.
  { const rk = $('set-keys-reset'); if (rk) rk.addEventListener('click', resetKeys); }
  { const rp = $('set-pad-reset'); if (rp) rp.addEventListener('click', resetPad); }
  { const tb = $('set-test-btn'); if (tb) tb.addEventListener('click', () => setTest(!laneProbe)); }
  // --- guided controller wizard + GH preset wiring ---
  { const w = $('set-pad-wizard'); if (w) w.addEventListener('click', startPadWizard); }
  { const gw = $('gh-setup'); if (gw) gw.addEventListener('click', startPadWizard); }
  { const gp = $('set-pad-ghpreset'); if (gp) gp.addEventListener('click', applyGhPreset); }
  { const wc = $('pad-wizard-cancel'); if (wc) wc.addEventListener('click', cancelPadWizard); }
  { const ws = $('pad-wizard-skip'); if (ws) ws.addEventListener('click', () => { if (_wizStdOdActive) _finishStdOd(); else if (_calStep >= 0) _calSkip(); }); }   // build100q: skip the standard-pad Overdrive step (keep default RB) OR the current GH strum/whammy/tilt step
  { const wd = $('pad-wizard-done'); if (wd) wd.addEventListener('click', () => { if (_wizActive) cancelPadWizard(); else _wizSetVisible(false); }); }
  // advanced (manual per-lane caps) disclosure toggle
  { const adv = $('set-pad-advanced-toggle'); if (adv) adv.addEventListener('click', () => {
      const body = $('set-pad-advanced'); if (!body) return;
      const open = body.style.display !== 'none' && body.style.display !== '';
      body.style.display = open ? 'none' : 'block';
      adv.classList.toggle('open', !open);
    }); }
  window.addEventListener('gamepadconnected', (e) => {
    // build99h GH-readiness #2/#3: a freshly-plugged guitar should "just work" without opening Settings. If the user
    // has NEVER customized their pad map, switch to the 5-lane gh profile + apply the GH fret preset (default identity
    // crosses yellow/blue vs the painted strings). One-time — applyGhPreset saves rr_padmap so this won't re-fire. The
    // wizard still fine-tunes. Gated to not disrupt a song in progress.
    try {
      // build99R (controller P0-3): also auto-adopt the guitar profile for a guitar-SHAPED pad (>=10 axes → a POV-hat
      // instrument) even when Chrome reports a generic XInput id with no "guitar"/"riffmaster" token. Normal gamepads
      // have 4 axes, so this never misfires on a standard pad; a flightstick edge case is recoverable in Settings.
      var _gp = e && e.gamepad, _looksGuitar = _gp && (isGuitarPad(_gp.id) || ((_gp.axes || []).length >= 10));
      // build100q: gate on a DEDICATED one-time flag, not rr_padmap. The default profile is 'gh', whose pad map saves to
      // rr_padmap_gh (NOT rr_padmap) — so the old guard never latched and every reconnect re-ran applyGhPreset(),
      // clobbering a user's customized gh map. The flag latches once; a re-plug never overwrites their mapping.
      if (_looksGuitar && !localStorage.getItem('rr_gh_autoadopted') && state !== 'playing') {
        if (laneProfile !== 'gh') applyLaneProfile('gh');
        applyGhPreset();
        try { localStorage.setItem('rr_gh_autoadopted', '1'); } catch (e2) {}
      }
    } catch (err) {}
    try { if (state === 'playing') _ensureFastPoll(); } catch (err2) {}   // build102w/104 s3: pad plugged in MID-RUN → arm the low-latency poller now (don't wait on a possibly-throttled rAF frame)
    if (settingsScreen.classList.contains('active')) renderDeviceStatus();
  });
  window.addEventListener('gamepaddisconnected', (e) => { for (let i = 0; i < LANE_COUNT; i++) onLaneRelease(i); _frets.clear(); if (e && e.gamepad) { const pre = e.gamepad.index + ':'; for (const k in _padPrev) if (k.indexOf(pre) === 0) delete _padPrev[k]; } if (settingsScreen.classList.contains('active')) renderDeviceStatus(); });   // build71: a pad unplugged mid-hold can't send its release → free every lane + clear the dead pad's stale edge-state so a fret can't stay stuck-down/sustaining. build79-fix(B78-2): also clear GH held-fret Set so an unplugged-mid-hold guitar can't leave phantom frets that the next strum fires.

  $('calib-cancel').addEventListener('click', closeCalib);
  $('calib-pad').addEventListener('click', calibTap);
  $('calib-slider').addEventListener('input', (e) => {
    const ms = parseInt(e.target.value, 10) || 0;
    $('calib-slider-val').textContent = (ms > 0 ? '+' : '') + ms + ' ms';
  });
  $('calib-reset').addEventListener('click', () => {
    $('calib-slider').value = 0; $('calib-slider-val').textContent = '0 ms';
    $('calib-measured').textContent = '— ms';
  });
  $('calib-save').addEventListener('click', () => {
    const ms = parseInt($('calib-slider').value, 10) || 0;
    const _prevMs = Math.round(audioOffset * 1000);
    audioOffset = ms / 1000;
    try { localStorage.setItem('rr_offset_ms', String(ms)); } catch (e) {}
    updateCalibMenuVal();
    // A3 telemetry — same consent-gated event as the post-run auto-cal chip, so a manual re-calibrate (incl. the new
    // pause-overlay RE-CALIBRATE shortcut, which lands here) is measured too.
    try { _tlog('calibrate_apply', { source: 'wizard', offsetMs: ms, prevMs: _prevMs, deltaMs: ms - _prevMs }); } catch (e) {}
    closeCalib();
  });

  // ---------- EXPOSE ENGINE API ----------
  Object.assign(window.RhythmGame, {
    play,                              // play(provider)
    playDemo: (opts) => play(demoProvider, opts),
    playUrl: (url, meta, opts) => play(() => bufferedProvider(url, meta), opts),   // in-browser chart a live track (opts forwards practice/boss)
    // PRACTICE launcher: chart a live track in-browser and drill a SECTION at a SPEED. section = {start,end} in
    // song seconds (omit/null = full song); speed ∈ 0.5..1.5. Never scores (see play()→beginPlay()→endGame gates).
    playPractice: (url, meta, section, speed) => play(() => bufferedProvider(url, meta), { mode: 'practice', section: section || null, speed: (speed != null ? speed : 1) }),
    playDemoPractice: (section, speed) => play(demoProvider, { mode: 'practice', section: section || null, speed: (speed != null ? speed : 1) }),
    // read the decoded track duration (for the practice Start/End range max) once a provider has resolved the buffer.
    getSongDuration: () => songDuration || 0,
    setDifficulty: (d) => { if (DIFF_STEP[d]) { difficulty = d; syncDiffButtons(); try { localStorage.setItem('rr_diff', d); } catch (e) {} } },
    getDifficulty: () => difficulty,
    setMenuPlayHandler: (fn) => { _menuPlayHandler = fn; },
    // input config (consumed by Settings UI; exposed for tooling/tests)
    getKeyMap: () => Object.assign({}, keyMap),
    setKeyBinding: (lane, key) => bindLaneKey(lane, String(key).toLowerCase()),
    resetKeys: () => resetKeys(),
    getInputStatus: () => ({ midi: midiInputs.slice(), gamepads: gamepadList(), midiSupported: !!navigator.requestMIDIAccess }),
    __buffered: (url, meta) => bufferedProvider(url, meta),   // MP tight-sync seam (deferred provider)
    chartUrl: (url, diff) => chartUrlForSpectate(url, diff),  // build102t: live-show spectator chart seam (no run started; transient difficulty)
    chartUrlFull: (url, diff) => chartUrlAuthoritative(url, diff),  // build114: MP host-side authoritative-chart seam (full scoring-ready note shape) — see multiplayer.js resolveAndStart
    getLaneColors: () => LANE_COLORS.map(c => c.rgb),         // build102t: per-lane note colors for engine-less deck renderers (spectator decks)
  });

  // ===========================================================================
  // MULTIPLAYER ENGINE SEAMS (additive; default-inert if multiplayer.js absent).
  // ===========================================================================
  window.RhythmGame.getLiveStats = function () {
    var hit = counts.perfect + counts.great + counts.good;
    var done = hit + counts.miss;
    var accFrac = done > 0
      ? (counts.perfect * 1.0 + counts.great * 0.85 + counts.good * 0.5) / done : 1;
    var prog = (songDuration > 0 && player) ? Math.max(0, Math.min(1, songTime() / songDuration)) : 0;
    return {
      score: Math.round(score), combo: combo, maxCombo: maxCombo,
      acc: Math.round(accFrac * 1000) / 10,
      progress: Math.round(prog * 1000) / 1000,
      playing: state === 'playing',
      overdrive: (typeof overdrive === 'number' ? overdrive : 0), odActive: !!odActive,   // build66.12: expose OD so procbg's crescendo can fire (it read undefined → od stuck at 0)
      grade: (function (p) { return p >= 95 ? 'S' : p >= 88 ? 'A' : p >= 75 ? 'B' : p >= 60 ? 'C' : 'D'; })(accFrac * 100)
    };
  };
  // RIFT REPLAY wiring (additive, fully guarded — never touches scoring/chart/timing). getFrame hands the
  // module the live gameplay canvas; getStats hands it the same live snapshot the HUD reads. Degrades to no-op
  // if replay.js is absent or a callback throws. See replay.js (window.RhythmReplay) + CLAUDE.md.
  // LOAD-ORDER: replay.js is included AFTER game.js in index.html, so window.RhythmReplay may not exist yet at
  // parse time — init once now if it's ready, else retry on window.load (all scripts parsed by then). Both paths
  // stay in this closure so `canvas` / getLiveStats remain reachable; idempotent (init() safe to call again).
  var _rrReplayInit = function () {
    try { if (window.RhythmReplay) window.RhythmReplay.init({ getFrame: function () { return canvas; }, getStats: function () { return window.RhythmGame.getLiveStats(); } }); } catch (e) {}
  };
  if (window.RhythmReplay) _rrReplayInit();
  else { try { window.addEventListener('load', _rrReplayInit, { once: true }); } catch (e) {} }
  // versus split-screen (P2): a compact per-frame render snapshot + drained hit/miss events for the
  // opponent ghost deck. Additive + side-effect-free except it drains the hits buffer.
  window.RhythmGame.getRenderFrame = function () {
    var prog = (songDuration > 0 && player) ? Math.max(0, Math.min(1, songTime() / songDuration)) : 0;
    var ev = _rfHits; _rfHits = [];   // drain
    return { sc: Math.round(score), cb: combo, mu: _rfMult, od: +overdrive.toFixed(3), oda: odActive,
      st: +stability.toFixed(3), pr: Math.round(prog * 1000) / 1000, ev: ev };
  };
  // versus ghost deck: a read-only POOLED snapshot of the on-screen notes so the opponent's deck can scroll
  // the SAME chart (both clients share the chart + atMs). d = the engine's own timeline param (0=catcher,
  // 1=nut) so the ghost reuses the board's projection verbatim. type: 0 tap · 1 hold · 2 chord · 3 bomb. No alloc.
  var _ghostPool = []; for (var _gp = 0; _gp < 96; _gp++) _ghostPool.push({ lane: 0, d: 0, type: 0 });
  window.RhythmGame.getGhostNotes = function (aheadSec) {
    var t = songTime();
    var approach = DIFFICULTY[difficulty].approach / (userScroll * _levelSpeedMul());
    var dMax = (typeof aheadSec === 'number' && aheadSec > 0) ? Math.min(1.02, aheadSec / approach) : 1.02;
    var n = 0, L = notes.length;
    for (var k = 0; k < L && n < _ghostPool.length; k++) {
      var nn = notes[k];
      // build96 (playtest): do NOT cull notes YOU already hit. The rival/opponent highway must show a FULL,
      // INDEPENDENT note-fall — the same chart falling on THEIR board no matter what you hit — so it reads as a
      // live game being played beside you, not a sparse mirror that loses a note every time you strike one.
      // (The time-window cull below still keeps it to the visible approach lane.) This is display-only — the
      // ghost pool feeds ONLY the opponent deck + the NPC shadow-sim; your scoring path never reads it.
      if (nn.open) continue;                             // open strum bar, not a lane gem
      var d = (nn.time - t) / approach;
      if (d < -0.12 || d > dMax) continue;               // matches the render cull
      var p = _ghostPool[n++];
      p.lane = nn.lane; p.d = d;
      p.type = (nn.type === 'hold' || nn.type === 'rail') ? 1 : (nn.chord ? 2 : (nn.type === 'bomb' ? 3 : 0));
    }
    return { n: n, items: _ghostPool };
  };
  var _songEndCbs = [];
  window.RhythmGame.onSongEnd = function (cb) { if (typeof cb === 'function') _songEndCbs.push(cb); };
  function _fireSongEnd(reason) {
    var cbs = _songEndCbs.slice(); _songEndCbs.length = 0;
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](reason, (window.RhythmGame.lastResults && window.RhythmGame.lastResults()) || null); } catch (e) {}
    }
  }
  window.RhythmGame.startAt = function (prov, opts) {
    opts = opts || {};
    if (opts.difficulty) { try { window.RhythmGame.setDifficulty(opts.difficulty); } catch (e) {} }
    var delay = Math.max(0, (opts.atMs || Date.now()) - Date.now());
    // build114: AUTHORITATIVE MP CHART seam. If the caller supplies opts.notes (a pre-built, rehydrated note
    // array — see multiplayer.js resolveAndStart), beginPlay() skips its own analyzeChart/buildNotes and uses
    // this array verbatim so host + guest play the IDENTICAL chart (kills cross-device decoder-drift gaps).
    // Absent (every existing caller) → _injectedNotes stays null → byte-identical to the pre-existing path.
    var _notes = (opts.notes && opts.notes.length) ? opts.notes : null;
    _lastInjectedNotes = _notes;   // build114 review: cache (or clear, for a no-notes solo launch) so a live-MP restart re-arms this exact chart
    setTimeout(function () {
      try { getAC().resume(); } catch (e) {}
      try { _injectedNotes = _notes; play(prov); } catch (e) { _injectedNotes = null; }
    }, delay);
  };
  if (!window.RhythmGame.getAC) window.RhythmGame.getAC = function () { return getAC(); };
  if (!window.RhythmGame.getMusicAnalyser) window.RhythmGame.getMusicAnalyser = function () { return musicAnalyser; };   // build66: live FFT tap (frequency + waveform) for procbg.js reactive backdrops

  // ===========================================================================
  // LOCAL COUCH VERSUS — P2 SHADOW SCORER (build99j; additive, default-INERT).
  // ---------------------------------------------------------------------------
  // createEngine() does NOT clone the ~440KB engine. It spins up a SECOND, PARALLEL
  // scoring layer that READS the shared, authoritative game state (notes[], songTime(),
  // the active DIFFICULTY hit window, JUDGE, the mult formula) and keeps its OWN P2
  // state in a fully separate namespace (_p2*). It NEVER touches P1's _frets / _padPrev /
  // score / combo / counts or the shared notes[].judged|hit fields — P1 (single-player +
  // online MP) stays byte-identical. The whole thing only runs while a couch match is live,
  // and tears down cleanly. couch.js drives the P2 deck render + the verdict; this layer
  // owns P2's input, scoring, and miss-detection and exposes a render frame + ghost notes.
  // ===========================================================================
  let _p2 = null;   // the single live P2 layer (null when no couch match) — only one local versus at a time
  window.RhythmGame.createEngine = function (opts) {
    opts = opts || {};
    // tear down any prior P2 layer first (a rematch re-creates it)
    if (_p2 && _p2.teardown) { try { _p2.teardown(); } catch (e) {} }

    const gpIndex = (typeof opts.gamepadIndex === 'number') ? opts.gamepadIndex : null;
    const onEnd = (typeof opts.onSongEnd === 'function') ? opts.onSongEnd : null;
    // build99R: keyboard-P2 — lets two people share ONE keyboard (couch co-op without a 2nd controller, and
    // makes Local Versus testable before a controller arrives). opts.keyMap = { key -> lane }. Set up below.
    const _p2KeyMap = (opts.keyMap && typeof opts.keyMap === 'object' && Object.keys(opts.keyMap).length) ? opts.keyMap : null;
    let _p2KeyDown = null, _p2KeyUp = null;

    // ---- P2 STATE (entirely separate from P1; nothing here aliases P1's variables) -------
    const P = {
      score: 0, combo: 0, maxCombo: 0,
      counts: { perfect: 0, great: 0, good: 0, miss: 0 },
      wastedInputs: 0,                 // build108 s4 mirror: P1's display-only sloppiness tally, P2 namespace — never read by scoring
      overdrive: 0, odActive: false,
      judged: new Set(),               // note indices P2 has resolved (hit OR missed) — parallel to P1's notes[].judged
      hitKind: Object.create(null),    // index -> 'perfect'|'great'|'good'|'bomb' (for P2 deck gem fade; display-only)
      frets: new Set(),                // P2's held fret LANES (GH require-strum) — SEPARATE from P1's _frets
      padPrev: Object.create(null),    // P2's per-button edge state — SEPARATE from P1's _padPrev
      strumAxisPrev: 0, lastStrumT: 0,
      holdNote: new Array(LANE_COUNT).fill(null),  // P2's active sustains (keyed by lane), separate from P1's holdNote
      holdScored: new Array(LANE_COUNT).fill(0),
      laneDown: new Array(LANE_COUNT).fill(false), // P2's physically-held lanes (for sustain)
      ev: [],                          // drained event buffer for the P2 deck: [{l:lane, j:'p'|'g'|'m'}]
      lastJudgeT: 0,
      raf: 0, alive: true
    };
    function _p2push(lane, j) { P.ev.push({ l: lane, j: j }); if (P.ev.length > 12) P.ev.shift(); }
    function _p2Mult() {
      const tp = timingProf();
      const ct = Math.min(tp.comboCap, 1 + Math.floor(P.combo / _comboStepFor()));
      const cap = tp.comboCap + 1;
      return Math.min(MAX_MULT, Math.min(P.odActive ? cap : tp.comboCap, P.odActive ? ct + 1 : ct));   // identical to curMult(), P2 namespace
    }

    // ---- P2 hit-detection (mirrors handleHit, but in the P2 namespace) -------------------
    function p2LaneInput(lane, now) {
      const inputLag = now ? Math.min(0.05, Math.max(0, (performance.now() - now) / 1000)) : 0;
      const t = songTime() - audioOffset - inputLag;
      const diff = DIFFICULTY[difficulty];
      let target = null, targetIdx = -1, targetDiff = Infinity;
      // notes[] is kept time-sorted ascending (engine invariant) → same early-break scan as P1
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (!n.open && n.lane !== lane) continue;
        if (P.judged.has(i)) continue;              // P2's OWN judged set — independent of P1's n.judged
        if (n.time < t - diff.hitWindow) continue;
        if (n.time > t + diff.hitWindow) break;
        const d = Math.abs(n.time - t);
        if (d < targetDiff) { targetDiff = d; target = n; targetIdx = i; }
      }
      if (!target) { P.wastedInputs++; return; }   // empty press: no combo break, no penalty (matches P1's keyboard-feel whiff guardrail); build108 s4: tally mirrored, display-only

      // BOMB: P2 striking a bomb takes the same penalty the main engine applies (combo reset).
      if (target.type === 'bomb') {
        P.judged.add(targetIdx);
        P.combo = 0;
        _p2push(lane, 'm');
        P.lastJudgeT = performance.now();
        return;
      }
      const ad = targetDiff, tp = timingProf();
      let kind;
      if (ad < diff.hitWindow * tp.perfFrac) kind = 'perfect';
      else if (ad < diff.hitWindow * tp.greatFrac) kind = 'great';
      else kind = 'good';
      P.judged.add(targetIdx); P.hitKind[targetIdx] = kind;
      P.counts[kind]++; P.combo++; if (P.combo > P.maxCombo) P.maxCombo = P.combo;
      const mult = _p2Mult();
      const accPerf2 = (target.type === 'accent' && kind === 'perfect');   // build104 s8 mirror: accent PERFECT pays 1.5× + deeper OD
      P.score += JUDGE[kind].score * mult * (accPerf2 ? 1.5 : 1);
      // build104 s7 mirror: FULL CHORD — P2 has no one-press assist (each member is struck individually), so the
      // "all lanes down" case IS P2's natural chord clear: pay the same 0.3× bonus per member when the whole
      // shape is held at this member's judge instant (same ceiling as P1's 0.3×chord-total).
      if (target.chord && target.chordLanes && target.chordLanes.length > 1 && target.chordLanes.every(l => P.laneDown[l])) P.score += JUDGE[kind].score * mult * 0.3;
      if (!P.odActive) P.overdrive = Math.min(1, P.overdrive + (target.type === 'star' ? 0.14 : accPerf2 ? 0.04 : 0.022));
      _p2push(lane, kind === 'perfect' ? 'p' : 'g');
      P.lastJudgeT = performance.now();
      // a struck hold → P2 sustain (scored continuously in p2Frame while the fret stays held)
      // SLIDE RAILS mirror: a rail head is a struck sustain for P2 too; `seg` (P2-owned) tracks the next transfer.
      if ((target.type === 'hold' || target.type === 'rail') && target.hold > 0) { P.holdNote[lane] = { note: target, idx: targetIdx, seg: (target.type === 'rail' ? 1 : 0) }; P.holdScored[lane] = 0; }
    }
    // P2 strum (GH guitars): fire every held fret at the strum instant (chord-safe), debounced like tryStrum
    function p2Strum(now) {
      if (now - P.lastStrumT < (typeof STRUM_DEBOUNCE_MS === 'number' ? STRUM_DEBOUNCE_MS : 60)) return;
      P.lastStrumT = now;
      if (P.frets.size === 0) return;
      P.frets.forEach(function (lane) { p2LaneInput(lane, now); });
    }

    // ---- P2 gamepad poll (reuses padMap + strumCfg + requireStrum, P2's OWN edge state) --
    function p2PollPad() {
      if (gpIndex == null || !navigator.getGamepads) return;
      const pads = navigator.getGamepads();
      const gp = pads[gpIndex]; if (!gp) return;
      const strum = requireStrum();     // same global rule: a detected GH guitar on the gh profile must strum
      for (let b = 0; b < gp.buttons.length; b++) {
        const pressed = gp.buttons[b].pressed; const was = P.padPrev[b]; P.padPrev[b] = pressed;
        if (pressed && !was) {
          const lane = padMap[b];
          if (lane != null && lane >= 0 && lane < LANE_COUNT) {
            if (strum) { P.frets.add(lane); P.laneDown[lane] = true; }      // GH: fret held, no hit until strum
            else { P.laneDown[lane] = true; p2LaneInput(lane, performance.now()); }   // standard pad: press = hit
          }
          if (strum && strumCfg.btns.indexOf(b) >= 0) p2Strum(performance.now());     // strum bar → fire held frets
          if (strum && b === strumCfg.spBtn) { if (P.overdrive >= 1 && !P.odActive) { P.odActive = true; P._odUntil = songTime() + 6; } }   // Select → P2 Star Power
          if (!strum && strumCfg.odBtn != null && b === strumCfg.odBtn && padMap[b] == null) { if (P.overdrive >= 1 && !P.odActive) { P.odActive = true; P._odUntil = songTime() + 6; } }   // build100q: standard-pad P2 Overdrive (mirror of P1)
        } else if (!pressed && was) {
          const lane = padMap[b];
          if (lane != null && lane >= 0 && lane < LANE_COUNT) { if (strum) P.frets.delete(lane); P.laneDown[lane] = false; }
        }
      }
      // P2 strum AXIS (non-standard guitars whose D-pad collapses to a hat) — mirror pollGuitarAxes' strum edge
      if (strum) {
        const ax = gp.axes || [];
        let sAxis = strumCfg.strumAxis;
        if (sAxis == null && ax.length >= 10) sAxis = 9;   // build99R (controller P0-1): mirror P1 — read the hat strum even on a 'standard'-mapped guitar
        if (sAxis != null && ax.length > sAxis) {
          const v = ax[sAxis] || 0;
          if (Math.abs(v) > 0.5 && Math.sign(v) !== Math.sign(P.strumAxisPrev) && (!strumCfg.strumAxisDir || Math.sign(v) === strumCfg.strumAxisDir)) p2Strum(performance.now());
          P.strumAxisPrev = v;
        }
      }
    }

    // ---- P2 per-frame tick: poll input, score sustains, run the miss pass ----------------
    function p2Tick() {
      if (!P.alive) return;
      P.raf = requestAnimationFrame(p2Tick);
      if (state !== 'playing') return;           // only score while the shared clock is live
      p2PollPad();
      const t = songTime();
      const jt = t - audioOffset;
      const diff = DIFFICULTY[difficulty];
      // OD auto-drain (P2 Star Power is time-boxed, like P1's)
      if (P.odActive) { if (t >= (P._odUntil || 0)) { P.odActive = false; P.overdrive = 0; } else { P.overdrive = Math.max(0, (P._odUntil - t) / 6); } }
      // P2 sustain payout: a struck hold keeps paying while THIS player's fret stays held
      for (let i = 0; i < LANE_COUNT; i++) {
        const h = P.holdNote[i]; if (!h) continue;
        const hn = h.note, end = hn.time + hn.hold;
        if (jt >= end) { const rem = 1 - P.holdScored[i]; if (rem > 0) P.score += rem * holdTotalFor(hn) * _p2Mult(); P.holdNote[i] = null; P.holdScored[i] = 0; continue; }
        // SLIDE RAILS mirror (simplified): same TW table + same GRACE/SLIP bands; transfer = P2's destination input in
        // the window (migrates P2's OWN slot; zero score). P2 tracks its own `seg` on the wrapper + its own dropped
        // resolution — never touches P1's holdNote/holdScored/holdRailSeg or the shared n.dropped.
        if (hn.type === 'rail' && hn.rail) {
          const rail = hn.rail, seg = h.seg || 0, TW = RAIL_TW[difficulty] || 0.18;
          let drop = false;
          if (seg >= 1 && seg < rail.length) {
            const wt = hn.time + rail[seg].t, newLane = rail[seg].lane, w0 = wt - 0.6 * TW, w1 = wt + TW;
            if (jt < w0) { if (!P.laneDown[i]) drop = true; }
            else if (jt <= w1) {
              if (P.laneDown[newLane]) { P.holdNote[newLane] = { note: hn, idx: h.idx, seg: seg + 1 }; P.holdScored[newLane] = P.holdScored[i]; P.holdNote[i] = null; P.holdScored[i] = 0; continue; }   // transfer made — zero score
              if (!P.laneDown[i]) drop = true;   // neither old nor new down inside the window
            } else { drop = true; }              // window closed, transfer missed
          } else if (!P.laneDown[i]) { drop = true; }   // past all transfers → hold-like on lane i
          if (drop) {
            const f = P.holdScored[i];
            if (f >= 0.75) { const rem = 1 - f; if (rem > 0) P.score += rem * holdTotalFor(hn) * _p2Mult(); }
            else if (f < 0.45) { P.combo = 0; }
            P.holdNote[i] = null; P.holdScored[i] = 0; continue;
          }
          const frac = Math.max(0, Math.min(1, (jt - hn.time) / hn.hold));
          const gain = frac - P.holdScored[i];
          if (gain > 0) { P.score += gain * holdTotalFor(hn) * _p2Mult(); P.holdScored[i] = frac; }
          continue;
        }
        if (!P.laneDown[i]) {   // build104 s6c/d mirror: duration-scaled payout + graded release — ≥0.75 completes, 0.45–0.75 keeps combo + banked, <0.45 breaks P2's combo (matches P1's bands)
          const f = P.holdScored[i];
          if (f >= 0.75) { const rem = 1 - f; if (rem > 0) P.score += rem * holdTotalFor(hn) * _p2Mult(); }
          else if (f < 0.45) { P.combo = 0; }
          P.holdNote[i] = null; P.holdScored[i] = 0; continue;
        }
        const frac = Math.max(0, Math.min(1, (jt - hn.time) / hn.hold));
        const gain = frac - P.holdScored[i];
        if (gain > 0) { P.score += gain * holdTotalFor(hn) * _p2Mult(); P.holdScored[i] = frac; }
      }
      // P2 MISS pass: a note that passed P2's window unjudged-for-P2 breaks P2's combo (bombs dodged = safe).
      // build104 s1a mirror: scored taps get the same +60ms miss-DECLARATION grace as P1's sweep (bombs + hold
      // heads resolve at the exact window edge, matching P1) — the late-edge input race is fixed for both players.
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (P.judged.has(i)) continue;
        const edge = n.time + diff.hitWindow + ((n.type === 'bomb' || n.type === 'hold' || n.type === 'rail') ? 0 : 0.06);
        if (jt <= edge) continue;
        P.judged.add(i);
        if (n.type === 'bomb') continue;          // dodged hazard — no penalty (matches P1)
        P.counts.miss++;
        // build148 T1 mirror: P2 Flow Shield — an Overdrive-active miss keeps P2's combo and burns ~25% of P2's
        // remaining OD time (6s window) instead of breaking the streak. Accuracy still takes the hit above.
        if (P.odActive && t < (P._odUntil || 0)) {
          P._odUntil = Math.max(t, (P._odUntil || 0) - 6 * FLOW_SHIELD_COST);
          if (P._odUntil <= t) { P.odActive = false; P.overdrive = 0; }
        } else {
          P.combo = 0;
        }
        _p2push(n.lane, 'm');
      }
    }

    // ---- P2 ghost notes: the SAME falling chart, but marked with P2's OWN judged state ----
    // Mirrors getGhostNotes' projection param (d: 0=catcher, 1=nut) so couch.js reuses the board's
    // perspective verbatim. `hit` reflects P2's real play (the gem fades once P2 resolves it).
    const _p2GhostPool = []; for (let _g = 0; _g < 96; _g++) _p2GhostPool.push({ lane: 0, d: 0, type: 0, hit: false });
    function p2Ghost(aheadSec) {
      const t = songTime();
      const approach = DIFFICULTY[difficulty].approach / (userScroll * _levelSpeedMul());
      const dMax = (typeof aheadSec === 'number' && aheadSec > 0) ? Math.min(1.02, aheadSec / approach) : 1.02;
      let n = 0; const L = notes.length;
      for (let k = 0; k < L && n < _p2GhostPool.length; k++) {
        const nn = notes[k];
        if (nn.open) continue;
        const d = (nn.time - t) / approach;
        if (d < -0.12 || d > dMax) continue;
        const p = _p2GhostPool[n++];
        p.lane = nn.lane; p.d = d;
        p.type = (nn.type === 'hold' || nn.type === 'rail') ? 1 : (nn.chord ? 2 : (nn.type === 'bomb' ? 3 : 0));
        p.hit = P.judged.has(k) && P.hitKind[k] != null;   // P2 hit this one → fade it on P2's deck
      }
      return { n: n, items: _p2GhostPool };
    }

    // ---- P2 render frame (lastOppState-shaped → couch.js feeds it to the deck renderer) ---
    function p2Frame() {
      const prog = (songDuration > 0 && player) ? Math.max(0, Math.min(1, songTime() / songDuration)) : 0;
      const ev = P.ev; P.ev = [];   // drain
      return { sc: Math.round(P.score), cb: P.combo, mu: _p2Mult(), od: +P.overdrive.toFixed(3), oda: P.odActive,
        st: 1, pr: Math.round(prog * 1000) / 1000, ev: ev };
    }

    // ---- song-end hook: report P2's final score so couch.js can show the verdict ---------
    if (onEnd) { try { window.RhythmGame.onSongEnd(function (reason, res) { if (P.alive) { try { onEnd(P.score, { reason: reason, maxCombo: P.maxCombo, counts: P.counts }); } catch (e) {} } }); } catch (e) {} }

    function teardown() {
      P.alive = false;
      if (P.raf) { cancelAnimationFrame(P.raf); P.raf = 0; }
      if (_p2KeyDown) { try { window.removeEventListener('keydown', _p2KeyDown, true); } catch (e) {} }   // build99R: drop keyboard-P2 listeners
      if (_p2KeyUp) { try { window.removeEventListener('keyup', _p2KeyUp, true); } catch (e) {} }
      try { window.RhythmGame.setVsMode(false); } catch (e) {}
      if (_p2 === api) _p2 = null;
    }

    // start the parallel loop + enter split-screen fit
    try { window.RhythmGame.setVsMode(true); } catch (e) {}
    P.raf = requestAnimationFrame(p2Tick);

    // build99R: keyboard-P2 input (shared-keyboard couch co-op). Press = hit (NO strum, like P1's keyboard);
    // P2's keys (1..5) never overlap P1's letter keys. Capture-phase listeners, removed on teardown; e.repeat
    // guarded so a held key can't auto-fire a stream of hits. Holds: keydown arms laneDown, keyup drops it.
    if (_p2KeyMap) {
      _p2KeyDown = function (e) {
        if (e.repeat) return;
        const lane = _p2KeyMap[e.key]; if (lane == null) return;
        e.preventDefault();
        if (state === 'playing' && !P.laneDown[lane]) { P.laneDown[lane] = true; p2LaneInput(lane, performance.now()); }
      };
      _p2KeyUp = function (e) {
        const lane = _p2KeyMap[e.key]; if (lane == null) return;
        if (lane >= 0 && lane < LANE_COUNT) P.laneDown[lane] = false;
      };
      window.addEventListener('keydown', _p2KeyDown, true);
      window.addEventListener('keyup', _p2KeyUp, true);
    }

    const api = {
      isP2: true,
      gamepadIndex: gpIndex,   // build138: P2's claimed controller index — pollGamepad reads this to EXCLUDE it from P1 (couch input split)
      getP2Frame: p2Frame,
      getP2Ghost: p2Ghost,
      getP2Score: function () { return P.score; },
      getP2Stats: function () { return { score: Math.round(P.score), combo: P.combo, maxCombo: P.maxCombo, counts: P.counts }; },
      setVsMode: function (b) { try { window.RhythmGame.setVsMode(b); } catch (e) {} },
      teardown: teardown,
      // ---- dev/test hooks (strip at content-freeze with __rrDebug) ----
      // Drive the P2 scorer SYNCHRONOUSLY so its logic is verifiable when rAF is throttled (headless tab).
      // Mirrors __rrDebug.press() for P1: _press judges a P2 lane input now; _tick runs one scoring frame
      // (sustains + the miss pass); _setPad lets a test inject P2 button edges through the real pad path.
      _p2state: P,
      _press: function (lane) { p2LaneInput(lane, performance.now()); return P.score; },
      _release: function (lane) { if (lane >= 0 && lane < LANE_COUNT) { if (requireStrum()) P.frets.delete(lane); P.laneDown[lane] = false; } },
      _strum: function () { p2Strum(performance.now()); return P.score; },
      _tick: function () { p2PollPad(); },                    // one input poll (reads navigator.getGamepads)
      _scoreTick: function () {                               // one scoring frame WITHOUT rAF (sustains + miss pass)
        const t = songTime(), jt = t - audioOffset, diff = DIFFICULTY[difficulty];
        for (let i = 0; i < notes.length; i++) { const n = notes[i]; if (P.judged.has(i)) continue; if (jt <= n.time + diff.hitWindow + ((n.type === 'bomb' || n.type === 'hold' || n.type === 'rail') ? 0 : 0.06)) continue; P.judged.add(i); if (n.type === 'bomb') continue; P.counts.miss++; P.combo = 0; _p2push(n.lane, 'm'); }
      }
    };
    _p2 = api;
    // honor opts.expose so couch's contract call (expose:'RhythmGameP2') lands a global handle
    try { if (opts.expose) window[opts.expose] = api; } catch (e) {}
    return api;
  };
  // couch.js convenience: is a P2 layer live right now?
  window.RhythmGame.hasP2 = function () { return !!(_p2 && _p2._p2state && _p2._p2state.alive); };
  window.RhythmGame.getP2 = function () { return _p2; };

  // play button → defers to catalog handler if set, else demo
  let _menuPlayHandler = null;
  $('play-btn').addEventListener('click', () => {
    // resume the audio context SYNCHRONOUSLY inside the tap gesture — iOS will
    // have re-suspended it since the last touch, and resuming after the 3s
    // countdown (outside any gesture) is too late → silent track.
    try { getAC().resume(); } catch (e) {}
    if (_menuPlayHandler) _menuPlayHandler();
    else play(demoProvider);
  });

  setTimeout(resize, 50);
  window.addEventListener('load', () => setTimeout(resize, 50));
})();
