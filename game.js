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
  const STRUM_DEBOUNCE_MS = 55;        // anti-double-strum (strum-up + strum-down funnel through here)
  let strumCfg = { btns: [12, 13], strumAxis: null, strumAxisDir: 0,
                   whammyAxis: 2, whammyMin: -1, whammyMax: 1,
                   tiltAxis: 3, tiltThresh: 0.6, spBtn: 8 };
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
  const DIFF_STEP = { easy: 4, medium: 2, hard: 1 };
  const DIFFICULTY = {
    easy:   { approach: 1.30, hitWindow: 0.20, name: 'DRIFT — Easy'      },
    medium: { approach: 0.95, hitWindow: 0.16, name: 'PULSE — Medium'    },
    hard:   { approach: 0.68, hitWindow: 0.12, name: 'FRACTURE — Hard'   },
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

  // Scoring: base per-hit is LOW; the combo multiplier + Overdrive scale it up, HARD-CAPPED at MAX_MULT (=4) total
  // (v258: clamped at all 3 mult sites — the 'tight' profile's comboCap:5 + overdrive could otherwise reach 6×). Max per
  // NON-HOLD note = 375*4 = 1500. HOLD notes ALSO pay a sustain bonus up to HOLD_TOTAL*4 (=880) ON TOP of the head, so the
  // real ceiling is notes_total*1500 + (#holds)*HOLD_TOTAL*4 — any future server enforcement must budget the hold bonus,
  // NOT a flat 1500/note. (The bonus is identical for every player on the same chart, so it stays fair/leaderboard-safe.)
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
  let _timingSamples = [];     // build83: per-hit signed timing error (sec) for the results early/late summary
  let provider = null;       // async () => session
  let session = null;        // { beats, duration, player, meta, live, submit }
  let player = null;         // current Player instance
  let beats = [];            // raw chart [{t, strength}]
  let notes = [];            // derived [{time, lane, strength, judged, hit}]
  let songDuration = 0;
  let rafId = null;
  let state = 'menu';
  let muted = false;

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
  const HOLD_TOTAL = 220;                       // total sustain payout for a fully-held note (× live multiplier)
  let overdrive = 0;                            // 0..1 meter
  let odActive = false;                         // overdrive mode engaged (x2 payoff)
  let odTimer = 0;                              // seconds of overdrive remaining
  let odBurst = 0;                              // one-shot OD-ignition shockwave (1→0 over ~0.6s, render-only)
  let odReadyAnnounced = false;                // one-shot "OVERDRIVE READY" cue per fill
  let lastMult = 1;                             // last applied score multiplier (HUD)
  const OD_DURATION = 8;                        // how long an activation lasts
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
  try { openNotes = /[?&]open=1/.test(location.search) || localStorage.getItem('rr_open') === '1'; } catch (e) {}
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
  let scoreDisplay = 0;   // animated count-up value chasing `score` (game-feel juice)
  let lightningT = 0;     // seconds remaining on a combo-milestone lightning strike
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
    flashJudgment(ti.name + (idx >= 4 ? ' MODE!!' : ' MODE'), 'rgb(' + ti.rgb.join(',') + ')');
    try { playStingSfx(idx >= 4 ? 'big' : ''); } catch (e) {}   // v257: a rising sting on each combo-tier cross-up
    scanT = scanDur = 0.55; scanTier = idx + 2;                 // a fuller sweep than a plain milestone
    bgPulse = 1; cameraShake = Math.max(cameraShake, 9 + idx * 2);
    try { const cd = $('combo-display'); if (cd) { cd.classList.remove('tierpop'); void cd.offsetWidth; cd.classList.add('tierpop'); } } catch (e) {}
    if (navigator.vibrate) { try { navigator.vibrate(idx >= 4 ? [16, 26, 16, 26, 16] : [14, 22, 14]); } catch (e) {} }
    try { if (window.RhythmLevelFx && window.RhythmLevelFx.onCombo) window.RhythmLevelFx.onCombo(combo, idx >= 3); } catch (e) {}
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
  let stability = 1.0;
  let runFailed = false;   // true when the current run ended via the (optional) fail-out
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
  function fretGeom() {
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
    return { gx: r.gx, gy: r.gy, gw: r.gw, gh: r.gh, nearX: nearX, farX: farX, nearY: nearY, farY: farY, lw: lw };
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
    holdSparkT = Array(LANE_COUNT).fill(0);
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
  const GH_ID_RE = /guitar|gh\b|guitar\s*hero|red\s*octane|harmonix|rock\s*band|rockband|wii.*guitar|santroller|raphnet|clone\s*hero|world\s*tour|les\s*paul|stratocaster/i;
  const GH_PRESET_BTN = [0, 1, 3, 2, 4];   // green, red, yellow, blue, orange  ->  lane 0..4 (gh profile)
  function isGuitarPad(id) { return GH_ID_RE.test(String(id || '')); }
  function guitarPadId() { for (const id of gamepadList()) if (isGuitarPad(id)) return id; return null; }
  function applyGhPreset() {
    // map the 5 GH frets to the active profile's lanes (clamped to LANE_COUNT so it's safe on standard too)
    const m = {}; const n = Math.min(GH_PRESET_BTN.length, LANE_COUNT);
    for (let lane = 0; lane < n; lane++) m[GH_PRESET_BTN[lane]] = lane;
    padMap = m; savePadMap();
    try { renderPadcaps(); } catch (e) {}
    try { renderDeviceStatus(); } catch (e) {}
    try { window.RhythmGame.showToast('Guitar Hero 5-fret preset applied — Test Input or run the wizard to fine-tune', 'success'); } catch (e) {}
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
      bridgeXF: [0.3866, 0.4403, 0.4980, 0.5612, 0.6203] },
    'assets/guitars/crimson-chrome.png':{ aspect: 904 / 2194, nutFY: 0.085, bridgeFY: 0.800,
      nutXF:    [0.4483, 0.4752, 0.4860, 0.4960, 0.5152],
      bridgeXF: [0.3571, 0.4043, 0.4557, 0.5124, 0.5603] },
    'assets/guitars/ember-bone.png':    { aspect: 904 / 1759, nutFY: 0.100, bridgeFY: 0.810,
      nutXF:    [0.4339, 0.4494, 0.4878, 0.5132, 0.5314],
      bridgeXF: [0.3182, 0.3848, 0.4708, 0.5609, 0.6209] },
    'assets/guitars/gold-relic.png':    { aspect: 904 / 2160, nutFY: 0.085, bridgeFY: 0.800,
      nutXF:    [0.4332, 0.4480, 0.4644, 0.4782, 0.4921],
      bridgeXF: [0.3341, 0.3743, 0.4160, 0.4582, 0.5008] },
    // ---- PREMIUM STORE GUITARS (i2i from crimson-chaos-ryo: theme painted on the BODY, neck + 5 strings kept clean).
    // Each gate-PASSED via adaptive neck-band measure on the transparent cutout; fit overlay-verified riding the strings.
    'assets/guitars/crimson-fox.png':   { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // Ryo "Crimson Moon Fox" — 100 rows, res 4.36px
      nutXF:    [0.4565, 0.4787, 0.5030, 0.5298, 0.5561],
      bridgeXF: [0.3427, 0.4169, 0.4889, 0.5600, 0.6344] },
    'assets/guitars/crimson-tarot.png': { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // "Crimson Fortune" tarot — 32 rows, res 5.56px
      nutXF:    [0.4552, 0.4775, 0.4985, 0.5215, 0.5425],
      bridgeXF: [0.3956, 0.4453, 0.5016, 0.5484, 0.5952] },
    'assets/guitars/clockwork.png':     { verified: true, aspect: 752 / 1344, nutFY: 0.160, bridgeFY: 0.810,  // "Tourbillon" clockwork — 58 rows, res 2.84px
      nutXF:    [0.4386, 0.4594, 0.4891, 0.5134, 0.5387],
      bridgeXF: [0.4080, 0.4613, 0.5058, 0.5615, 0.6130] },
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
      bridgeXF: [0.3514, 0.4251, 0.4989, 0.5740, 0.6464] },
    'assets/guitars/shorty-x.png':      { verified: true, aspect: 1520 / 2688, nutFY: 0.160, bridgeFY: 0.810,  // "Shorty X" vampire-fang bass — i2i reskin of crimson-chaos-ryo, 17 rows, res 16.65px
      nutXF:    [0.4633, 0.4844, 0.5087, 0.5336, 0.5577],
      bridgeXF: [0.3518, 0.4227, 0.4852, 0.5539, 0.6247] },
    'assets/guitars/celines-razor.png': { verified: true, aspect: 1140 / 2016, nutFY: 0.160, bridgeFY: 0.810,  // "Celine's Razor" — CelinesRazor × Dion community guitar (i2i reskin of crimson-chaos-ryo), 55 rows, res 1.67px
      nutXF:    [0.4649, 0.4867, 0.5098, 0.5335, 0.5566],
      bridgeXF: [0.3487, 0.4214, 0.4950, 0.5723, 0.6502] },
    // build64: three NEW store guitars — i2i reskins of crimson-chaos-ryo (strings/neck kept, body re-skinned), keyed + adaptive-measured + overlay-verified riding the strings nut→bridge.
    'assets/guitars/razor.png':         { verified: true, aspect: 1518 / 2647, nutFY: 0.152, bridgeFY: 0.812,  // "Razor" emo-punk dark-purple bass — 164 clean rows, res 7.09px
      nutXF:    [0.4635, 0.4842, 0.5068, 0.5301, 0.5521],
      bridgeXF: [0.3473, 0.4198, 0.4926, 0.5677, 0.6431] },
    'assets/guitars/wormfeast.png':     { verified: true, aspect: 1519 / 2655, nutFY: 0.156, bridgeFY: 0.814,  // "Wormfeast" skull-&-eyeball-&-worm horror bass — 109 clean rows, res 5.75px
      nutXF:    [0.4633, 0.4843, 0.5074, 0.5323, 0.5547],
      bridgeXF: [0.3527, 0.4227, 0.4931, 0.5648, 0.6380] },
    'assets/guitars/kitsune.png':       { verified: true, aspect: 1514 / 2677, nutFY: 0.160, bridgeFY: 0.813,  // "Kitsune" ivory fox-fur bass (fox-ear horns + fox-skull crown) — 112 clean rows, res 14.33px
      nutXF:    [0.4472, 0.4736, 0.5037, 0.5359, 0.5646],
      bridgeXF: [0.3974, 0.4604, 0.5156, 0.5634, 0.6183] },
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
  let _lastPct = -1, _lastSec = -1;   // build71: per-frame HUD-write change-gate (progress bar / time) — only touch the DOM when the whole-percent or whole-second changes (self-heals on restart since pct/sec differ from the prior song)
  // SFX_LEVEL is declared near the top (settings block) so persisted prefs can set it before this point.
  function loadHitSfx() {
    if (hitSfxTried) return;
    hitSfxTried = true;
    const load = (url, set) => fetch(url).then(r => { if (!r.ok) throw new Error('sfx ' + r.status); return r.arrayBuffer(); })   // build71: a 404 would otherwise feed an HTML error page to decodeAudioData; the throw lands in the existing .catch (buffer stays null, playback already guarded)
      .then(buf => getAC().decodeAudioData(buf, set, () => {})).catch(() => {});
    load('assets/hit-chug.mp3', d => { hitBuffer = d; });
    load('assets/miss-squelch.mp3', d => { missBuffer = d; });   // GH-style "clam" on a miss
  }
  // miss "squelch" — like GarageBand/Guitar Hero clamming a note. Music stays at full level.
  function playMissSfx() {
    if (muted || !missBuffer) return;
    try {
      const ac = getAC();
      // build35 (audit P1): scale the miss squelch by the Hit-Sound mixer (was a hardcoded 0.5 ≈ 10×
      // a hit at the default level, and it ignored the Settings slider). ~1.6× a perfect hit, capped.
      const g = ac.createGain(); g.gain.value = Math.min(0.5, SFX_LEVEL * 1.6);
      const s = ac.createBufferSource(); s.buffer = missBuffer;
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
    }
    async prepare() {}
    play() {
      this.ctx = getAC(); // shared, already unlocked by a user gesture
      this.src = this.ctx.createBufferSource();
      this.src.buffer = this.buffer;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = muted ? 0 : musicVol;
      this.src.connect(this.gain); this.gain.connect(this.ctx.destination);
      // audio-reactive tap — additive, does NOT change the audio reaching the speakers
      try { musicAnalyser = this.ctx.createAnalyser(); musicAnalyser.fftSize = 256; musicAnalyser.smoothingTimeConstant = 0.78; this.src.connect(musicAnalyser); musicFreq = new Uint8Array(musicAnalyser.frequencyBinCount); } catch (e) { musicAnalyser = null; musicFreq = null; }
      const when = this.ctx.currentTime + 0.12;
      this.src.start(when);
      this._start = when;
      this.src.onended = () => { if (this.onended) this.onended(); };
    }
    getTime() {
      if (!this.ctx) return -3;
      if (this._pausedAt != null) return this._pausedAt - this._start - this._pauseAccum;
      return this.ctx.currentTime - this._start - this._pauseAccum;
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
    // Guitar-Hero-style difficulty ramp: Easy uses fewer, CENTERED strings; Medium/Hard use all 5
    // (span clamps to LANE_COUNT=5 → inSpan is the identity, so Medium/Hard charts are unchanged). Defined up
    // front so the downstream chord/bomb passes (which reference span/laneBase/inSpan) work in BOTH chart modes.
    // build70 (launch-audit P3): Easy was span 4 → laneBase floor((5-4)/2)=0 → lanes 0..3, i.e. BOTTOM-biased with
    // the top string dead (the "centered" comment was a lie on a 5-lane neck). span 3 → laneBase 1 → lanes 1,2,3:
    // a genuinely centered, symmetric 3-string on-ramp. Note count is gap-driven (MINGAP), not lane-driven, so this
    // doesn't make Easy "blanker" — it just stops scattering a beginner across an off-centre 4-wide span.
    const LANE_SPAN = { easy: 3, medium: 6, hard: 6 };
    const span = Math.min(LANE_SPAN[difficulty] || LANE_COUNT, LANE_COUNT);   // never exceed lane count (5-string safe)
    const laneBase = Math.floor((LANE_COUNT - span) / 2);                          // centered active window
    const inSpan = (l) => laneBase + ((((l - laneBase) % span) + span) % span);    // wrap any index into the active set
    // MUSICAL mode (build57) needs centroid-tagged onsets from analyzeMusical; if a fallback produced
    // plain (centroid-less) onsets, degrade to the classic placer so a track is never left unplayable.
    const musical = (chartMode === 'musical') && beats.length && (typeof beats[0].centroid === 'number');
    let last = -1, last2 = -1;
    if (musical) {
      // DYNAMIC DENSITY: keep onsets on a difficulty-scaled min-gap, but let a clearly stronger / on-beat
      // onset BUMP a weaker recent pick — so busy passages stay busy, quiet ones breathe, and emphasis
      // lands on the beat. Bounded by the min-gap so it never becomes unplayable.
      // build59: Medium dialed back from 0.235 (≈4.3 notes/sec) — playtesters found Medium too rapid/scattered.
      // CHANGE 3a — raise every floor (was {0.45,0.33,0.155}) so the baseline chart is sparser and more readable
      // across the board; the "barrage" complaint was largely Hard packing ~6.4 nps. Now ≈ 2 / 2.5 / 4.5 nps.
      const MINGAP = { easy: 0.50, medium: 0.38, hard: 0.22 };   // v253 (research): Medium 0.34→0.38 — 0.34 allowed ~2.9 onsets/s (real-GH HARD territory); ease toward real-GH Medium ~2.4/s. Easy/Hard unchanged.
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
      const tightenFloor = difficulty === 'hard' ? 0.8 : difficulty === 'medium' ? 0.97 : 1.0;   // v253: Medium 0.95→0.97 — loud choruses tighten less (kills the chorus density spike that read as "too challenging")
      const gapFor = (b) => { const e = eMax > 0 ? (b.energy || 0) / eMax : 0.5; return baseGap * Math.max(tightenFloor, Math.min(2.0, 1.4 - 0.6 * e)); };
      // CHANGE 5 — privilege STRONG beats: when deciding whether a new onset should bump the recent pick out of its
      // gap-window, compare EFFECTIVE strength (downbeats ×1.6, on-grid ×1.3) — so emphasis lands on the beat, not on
      // whatever transient happened to be loudest. Also used to pick the weakest onset to drop under the NPS cap below.
      const effOf = (b) => (b.strength || 1) * (b.downbeat ? 1.6 : b.onGrid ? 1.3 : 1.0);
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
      if (per > 0 && sub > 0) {
        for (let i = 0; i < filtered.length; i++) {
          const t = filtered[i].t;
          const g = ph + Math.round((t - ph) / sub) * sub;
          if (Math.abs(t - g) < per * 0.18) {
            // clone so we never mutate the shared source onset (it may be reused if buildNotes re-runs)
            filtered[i] = Object.assign({}, filtered[i], { t: Math.round(g * 1000) / 1000 });
          }
        }
        filtered.sort((a, b) => a.t - b.t);
      }
      // CHANGE 3c — SLIDING-WINDOW NPS CAP: even after the min-gap, a busy bar can spike past readability. In any 1.0 s
      // window exceeding the per-difficulty cap, drop the weakest onsets (off-grid first, then lowest effective strength)
      // until the window is within budget. This is what actually flattens the "barrage" peaks.
      const _npsBase = { hard: 5, medium: 3, easy: 2 }[difficulty] || 3;
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
          const maxJump = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3;
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
        if (idx > 4 && idx % 31 === 0) type = 'star';                              // rare gold "surge" note
        else if ((b.downbeat && b.strength >= 1.4) || b.strength >= 1.9) type = 'accent';  // on-beat / strong → accented gem
        return { time: b.t, strength: b.strength, lane: lane, type: type, hold: 0, spin: (Math.floor(b.t * 97 + idx * 7) % 360) * Math.PI / 180, judged: false, hit: null, _pulsed: false, _centroid: b.centroid, _sustain: b.sustain || 0, _hotBands: b.hotBands || null, _onGrid: !!b.onGrid, _downbeat: !!b.downbeat };
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
        if (idx > 4 && idx % 31 === 0) type = 'star';        // rare gold "surge" note
        else if (b.strength >= 1.75) type = 'accent';        // strong beat → accented gem
        return { time: b.t, strength: b.strength, lane: lane, type: type, hold: 0, spin: (seed % 360) * Math.PI / 180, judged: false, hit: null, _pulsed: false };
      });
    }
    // derive HOLD notes from gaps: a beat followed by a long-enough pause becomes a
    // sustain. Be generous and SPACE them out so they actually show up regularly
    // (still ONE scored note — the head is the hit — so notes_total / anti-cheat
    // is unchanged). Tail is capped to the gap so it never reaches the next note.
    let lastHold = -99;
    for (let i = 0; i < notes.length; i++) {
      const nx = notes[i + 1];
      const gap = nx ? (nx.time - notes[i].time) : 99;
      const sus = notes[i]._sustain || 0;   // build58 charter-v2: measured audio sustain (the dominant band actually rang on)
      // prefer a REAL sustained note (the song actually held there) when there's room; else the classic gap heuristic.
      const isSustain = sus > 0.35 ? (gap > sus * 0.7) : (gap > 0.5);
      if (notes[i].type !== 'star' && isSustain && (i - lastHold) >= 5) {
        const want = sus > 0.35 ? sus : gap * 0.62;
        // build66 (launch-audit P1): keep the sustain tail clear of the next onset by one hit-window so a held key can still
        // re-press the next same-lane note. If there isn't room for a minimum playable hold, leave it a tap (no overrun).
        const clear = (DIFFICULTY[difficulty].hitWindow || 0.16) + 0.03;
        const tail = Math.min(want, gap - clear, 1.6);
        if (tail >= 0.30) { notes[i].type = 'hold'; notes[i].hold = tail; lastHold = i; }
      }
    }
    // ---- CHORDS: a second simultaneous note in another lane (press two keys at once) ----
    const base = notes.slice();           // snapshot before we add to it
    const allowChord = difficulty !== 'easy';
    if (allowChord) {
      // noteVariety packs chords tighter + adds more 3-note "double-stops"; defaults byte-identical.
      // build59: Medium gets noticeably FEWER chords than Hard — simultaneous two-key presses were a big part of why
      // Medium felt overwhelming. Hard unchanged (8 / every-4th); Medium ≈ half as many, more spaced (14 / every-6th).
      // v253: even with noteVariety ON, MEDIUM gets fewer/looser chords than Hard — simultaneous two-key presses were a big
      // part of why Medium felt "too challenging". Hard keeps the tight 5/every-3rd; Medium eases to 9/every-4th.
      const chordGapMin = noteVariety ? (difficulty === 'medium' ? 9 : difficulty === 'hard' ? 5 : 7) : (difficulty === 'medium' ? 14 : 8);
      const chordMod = noteVariety ? (difficulty === 'medium' ? 4 : 3) : (difficulty === 'medium' ? 6 : 4);
      let lastChord = -99, chordId = 0;
      for (let i = 0; i < base.length; i++) {
        const n = base[i];
        if ((n.type === 'tap' || n.type === 'accent') && (i - lastChord) >= chordGapMin && i % chordMod === 0) {
          chordId++;
          let lanes;
          // build58 charter-v2: when the AUDIO actually stacked frequencies here (≥2 bands co-fired), play THOSE bands as the
          // chord lanes — a real "two strings at once" that matches the song — instead of the mechanical +2/+4 fan.
          if (n._hotBands && n._hotBands.length >= 2) {
            const set = {}; set[n.lane] = 1;
            n._hotBands.forEach(function (bnd) { set[inSpan(laneBase + Math.max(0, Math.min(span - 1, bnd)))] = 1; });
            const cap = difficulty === 'hard' ? 3 : 2; const partners = Object.keys(set).map(Number).filter(l => l !== n.lane).sort((a, b) => a - b).slice(0, cap - 1); lanes = [n.lane].concat(partners).sort((a, b) => a - b);   // build71: keep the STRUCK lead lane in the chord — the old lowest-N slice could drop n.lane when it was the highest hot-band member (→ a phantom lane got no note + the lead was excluded from the chord-bar centroid/connector)
            if (lanes.length < 2) { let pl = inSpan(n.lane + 2); if (pl === n.lane) pl = inSpan(pl + 1); lanes.push(pl); }
          } else {
            lanes = [n.lane];
            let pl = inSpan(n.lane + 2); if (pl === n.lane) pl = inSpan(pl + 1); lanes.push(pl);
            // a beefier 3-note chord now and then (more often on Hard) — "hit the bar"
            if ((difficulty === 'hard' && i % 12 === 0) || (difficulty === 'medium' && i % 28 === 0) || (noteVariety && i % 9 === 0)) {
              let p2 = inSpan(n.lane + 4); if (lanes.indexOf(p2) < 0) lanes.push(p2);
            }
          }
          n.chord = true; n.chordId = chordId; n.chordLanes = lanes; n.chordLead = true;
          for (let k = 1; k < lanes.length; k++) {
            notes.push({ time: n.time, strength: n.strength, lane: lanes[k], type: 'tap', hold: 0, spin: 0, judged: false, hit: null, _pulsed: false, chord: true, chordId: chordId, chordLanes: lanes });
          }
          lastChord = i;
        }
      }
    }
    // ---- BOMBS: hazards in the gaps — DON'T hit this lane while one is at the bridge ----
    // CHANGE 4 — scattered single bombs are now HARD-ONLY (Infinity on Medium too, was 15). Random mid-gap bombs were
    // non-musical clutter on Medium; the telegraphed bomb-ROWS path (noteVariety) is the intended "dodge this" moment.
    const bombGap = difficulty === 'hard' ? 11 : Infinity;   // Hard only — Medium/Easy stay clean
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
      const rowEveryT = difficulty === 'hard' ? 14 : 22;   // min seconds between rows
      const leadIn = 0.85, restAfter = 0.85;
      const rowLanes = Math.min(LANE_COUNT, difficulty === 'hard' ? 4 : 3);
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
    if (noteVariety && difficulty !== 'easy') {
      const trillMaxGap = difficulty === 'hard' ? 0.26 : 0.30;   // build62: medium 0.55→0.30 — trills stay a FLOURISH on medium (the loose gate over-trilled it, re-laning melody notes into mechanical alternation → tanked its centroid/melody-following 0.87→0.68)
      const minLen = 3;                                          // notes needed to call it a trill (L-R-L)
      let lastTrillT = -999, i = 0;
      const single = (x) => x && (x.type === 'tap' || x.type === 'accent') && !x.chord;
      while (i < notes.length - 1) {
        if (!single(notes[i])) { i++; continue; }
        let j = i;                                               // grow a run of fast consecutive singles
        while (j + 1 < notes.length && single(notes[j + 1]) && (notes[j + 1].time - notes[j].time) <= trillMaxGap) j++;
        if ((j - i + 1) >= minLen && (notes[i].time - lastTrillT) >= 6) {
          let l1 = notes[i].lane, l2 = inSpan(l1 + 1); if (l2 === l1) l2 = inSpan(l1 + 2);
          for (let k = i; k <= j; k++) { notes[k].lane = ((k - i) % 2) ? l2 : l1; notes[k]._trill = true; }
          lastTrillT = notes[j].time;
          i = j + 1;
        } else { i++; }
      }
    }
    // ---- STAIR RUNS + ZIPPERS (noteVariety only): walk a fast run the trill pass did NOT claim as a
    // STAIR (lane sweep) or ZIPPER (bounce). DENSITY-NEUTRAL re-laning (adds none; plain tap scoring;
    // times untouched so every note stays on its onset). Spaced out. Default off → skip. ----
    if (noteVariety && difficulty !== 'easy') {
      const patMaxGap = difficulty === 'hard' ? 0.30 : 0.36;   // build62: medium 0.60→0.36 (same reason as trills — keep stair-runs a flourish on medium, not a melody override)
      const minLen = 4;
      const single = (x) => x && (x.type === 'tap' || x.type === 'accent') && !x.chord && !x._trill;
      let lastPatT = -999, i = 0, patSeed = 7;
      while (i < notes.length - 1) {
        if (!single(notes[i])) { i++; continue; }
        let j = i;
        while (j + 1 < notes.length && single(notes[j + 1]) && (notes[j + 1].time - notes[j].time) <= patMaxGap) j++;
        const runLen = j - i + 1;
        if (runLen >= minLen && (notes[i].time - lastPatT) >= 5) {
          patSeed = (patSeed * 1103515245 + 12345) & 0x7fffffff;
          const shape = patSeed % 3;                           // 0=stair up, 1=stair down, 2=zipper
          for (let k = i; k <= j; k++) {
            const r = k - i;
            let lane;
            if (shape === 0)      lane = inSpan(notes[i].lane + r);
            else if (shape === 1) lane = inSpan(notes[i].lane - r);
            else                  lane = inSpan(notes[i].lane + (r % 2 ? r : -r));
            notes[k].lane = lane;
            notes[k]._pat = shape;
          }
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
      const openMinGap = difficulty === 'hard' ? 0.55 : 0.8;
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
        const fastFromPrev = single(prev) && single(n) && (n.time - prev.time) <= (difficulty === 'hard' ? 0.18 : 0.30);
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
    // build36: per-level MIRROR mod — flip every note onto the opposite lane. Done LAST (after all
    // inserts + the final sort); a lane remap doesn't change time order. Input/render lane mapping is
    // untouched, so the chart simply plays mirrored. .map() reassigns each note's chordLanes to a fresh
    // mirrored array (never mutates the shared source), so chord partners can't double-flip.
    if (_levelMirror()) {
      const mir = (l) => (LANE_COUNT - 1) - l;
      for (const n of notes) {
        if (typeof n.lane === 'number') n.lane = mir(n.lane);
        if (n.chordLanes) n.chordLanes = n.chordLanes.map(mir);
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
    try {
      window.__rrChartStats = {
        notes: notes.length,
        emphSpread: (function () { const e = notes.filter(n => typeof n._emph === 'number').map(n => n._emph); return e.length ? +(Math.max.apply(null, e) - Math.min.apply(null, e)).toFixed(3) : 0; })(),
        holds: notes.filter(n => n.type === 'hold').length,
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
        durationSec: (notes.length ? Math.round(notes[notes.length - 1].time) : 0)
      };
    } catch (e) {}
  }

  // ===========================================================================
  // DEMO PROVIDER (local mp3 + in-browser analyzer)
  // ===========================================================================
  let cachedBuffer = null;
  function setLoading(msg, pct) {
    $('loading-msg').textContent = msg; $('loading-pct').textContent = Math.floor(pct) + '%';
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
    $('loading-stage').textContent = 'DECODING SIGNAL';
    if (!cachedBuffer) {
      setLoading('Awakening ECH0', 5);
      const audioEl = $('audio-el');
      const src = audioEl ? audioEl.src : 'assets/lunar-waves.mp3';
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
    $('loading-stage').textContent = 'DECODING SIGNAL';
    let buf = (lastDecoded.url === url) ? lastDecoded.buf : null;
    if (!buf) {
      setLoading('Fetching track', 8);
      const arr = await fetchAudio(url, { mode: 'cors' });
      setLoading('Decoding waveform', 25);
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      try { buf = await ac.decodeAudioData(arr); } finally { try { ac.close(); } catch (e) {} }   // build65 (cycle-4): ALWAYS release the throwaway decode context, even when decodeAudioData REJECTS (a corrupt/retried track would otherwise leak a context every attempt → Chromium's ~6-context cap silently kills all audio)
      lastDecoded = { url: url, buf: buf };
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
          let sus = 0; const sthr = domV * 0.5, smax = f + Math.round(1.8 / secPerF);
          for (let g = f + 1; g < nF && g < smax; g++) { if (env[domB][g] >= sthr) sus = (g - f) * secPerF; else break; }
          let eTot = 0; for (let b = 0; b < NB; b++) eTot += env[b][f];                                                          // local energy → section-aware density
          res.push({ t: Math.round((f * hop / sr) * 1000) / 1000, strength: Math.round(Math.min(3, nov[f] / (mean + 1e-4)) * 100) / 100, centroid: centroid, hotBands: hotBands, sustain: Math.round(sus * 100) / 100, energy: eTot });
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
        const period = bestLag * secPerF;
        // phase = beat offset that best lines up with detected onsets
        let bestPhase = 0, bestHits = -1;
        for (let p = 0; p < 12; p++) {
          const ph = (p / 12) * period; let hits = 0;
          for (const o of out) { const r = ((o.t - ph) % period + period) % period; if (r < 0.06 || r > period - 0.06) hits++; }
          if (hits > bestHits) { bestHits = hits; bestPhase = ph; }
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
    // re-assert the equipped skin at start UNLESS a per-level override is active (launchLevel sets it via applyLevelTheme before play())
    try { if (!_levelSkinActive && typeof applyEquippedSkin === 'function') applyEquippedSkin(); } catch (e) {}
    $('play-btn').disabled = true;
    try {
      await beginPlay();
    } catch (e) {
      console.error(e);
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
  window.RhythmGame.applySettings = (s) => {
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
    try { localStorage.setItem('rr_settings', JSON.stringify({ scroll: userScroll, fxLite: fxLite, reduceMotion: reduceMotion, bgMode: bgMode, music: musicVol, sfx: SFX_LEVEL, failMode: failMode, chartMode: chartMode, levelGuitar: levelGuitarPref, fxIntensity: fxIntensity })); } catch (e) {}
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
    // THE GAME IS 5-LANE (user decree 2026-06-09): `gh` is the DEFAULT profile. The legacy 6-string
    // `standard` stays available as a dormant toggle (?gh=0 / Settings) — byte-identical when chosen.
    let mode = 'gh';
    try {
      const m = location.search.match(/[?&]gh=([01])/);
      if (m) mode = (m[1] === '1') ? 'gh' : 'standard';      // ?gh=1 → 5-string; ?gh=0 → legacy 6-string
      else if (localStorage.getItem('rr_lanemode') === 'standard') {
        // ONE-TIME MIGRATION (build10c — the user's playtest): a stored 'standard' that PREDATES the
        // 5-lane decree is exactly the "huge flat 6-string default" they reported. Migrate it to gh
        // once; choosing standard in Settings AFTER this sticks (the marker records the migration).
        if (localStorage.getItem('rr_lane_migrated5') === '1') mode = 'standard';   // deliberate post-decree choice
        else { try { localStorage.setItem('rr_lane_migrated5', '1'); localStorage.setItem('rr_lanemode', 'gh'); } catch (e2) {} }
      }
    } catch (e) {}
    applyLaneProfile(mode);
    try { const pm = location.search.match(/[?&]persp=([0-9.]+)/); if (pm) perspOverride = parseFloat(pm[1]) || 0; } catch (e) {}
    try { const wm = location.search.match(/[?&]warp=([0-9.]+)/); if (wm) warpOverride = parseFloat(wm[1]); } catch (e) {}
    try { if (/[?&]align=1/.test(location.search)) window.__rrAlign = true; } catch (e) {}   // dev: draw lane guides (strip at freeze)
  })();

  function resetScoring() {
    score = 0; combo = 0; maxCombo = 0; comboTierCur = 0; scoreDisplay = 0; runFailed = false;
    counts = { perfect: 0, great: 0, good: 0, miss: 0 }; _timingSamples = [];
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
    holdScored = Array(LANE_COUNT).fill(0); holdSparkT = Array(LANE_COUNT).fill(0);
    odActive = false; odTimer = 0; lastMult = 1; odReadyAnnounced = false;
    { const odf = $('od-flame'); if (odf) odf.classList.remove('ready', 'active'); }
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
    if (!beats.length) throw new Error('This track could not be charted — try another');   // build72: player-facing (was the dev string "No beats in chart" shown verbatim in the launch-fail toast)

    buildNotes();
    resetScoring();

    // update HUD meta
    $('hud-diff').textContent = DIFFICULTY[difficulty].name;
    if (session.meta) {
      $('hud-track').textContent = session.meta.title + ' — ' + session.meta.artist;
    }

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
    if (!reduceMotion && !(window.RhythmMP && window.RhythmMP.isLive && window.RhythmMP.isLive())) {
      await new Promise(r => setTimeout(r, 2000));
      if (myGen !== _playGen || !player) return;
    }
    await runCountdown();
    if (myGen !== _playGen || !player) return;   // superseded during the 3·2·1 countdown (the common case)

    player.onended = () => { if (state === 'playing') endGame(); };
    // re-arm audio: the countdown delay can let mobile browsers re-suspend the
    // context that the tap gesture unlocked, which would start the song silent.
    try { const ac = getAC(); if (ac.state === 'suspended') await ac.resume(); } catch (e) {}
    if (myGen !== _playGen || !player) return;   // build57: the resume() above can await (suspended ctx, mobile) — re-check before play()/loop() so a superseded launch can't orphan a second self-re-arming loop / double-play audio
    muteUntil = -1; curGain = 1; applyGate();
    // build65 (cycle-4 FIX): the actual run-start, as a thunk. If a pause landed DURING the lead-in / 3·2·1 pre-roll (Esc /
    // mobile pause / window-blur / tab-hide all set state='paused' while we were awaiting the 2s buffer + countdown), do NOT
    // force the song to start behind the now-stuck PAUSED overlay — stash the start and let resumeGame() run it on resume.
    const _go = () => {
      player.play();
      state = 'playing';
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
      for (let i = 3; i >= 1; i--) {
        el.textContent = i;
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
    try { window.RhythmProcBg && window.RhythmProcBg.stop(); } catch (e) {}   // build66: idle the reactive backdrop on quit / song-end
    _deferredStart = null;   // build65 (cycle-4): drop any pre-roll deferred-start so a quit during a paused pre-roll can't fire it later
    if (player) { try { player.onended = null; player.stop(); } catch (e) {} player = null; }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    // v258: clear any pending MP-combat stun so a veil + dangling hide-timer can't linger past teardown (resetScoring
    // also zeroes _mpStunUntil before the next play; this is the exit-mid-stun belt-and-suspenders).
    clearTimeout(_stunHideT); _stunHideT = 0; _mpStunUntil = 0;
    try { const _se = document.getElementById('mp-stun'); if (_se) { _se.classList.remove('show'); _se.setAttribute('aria-hidden', 'true'); } } catch (e) {}
  }

  function restartGame() { stopGame(); beginPlay(); }

  // Boss Stage drains the meter harder — and harder still once ENRAGED (phase 2).
  function bossDrain(base) { return bossMode ? base * (bossPhase === 2 ? 2.4 : 1.8) : base; }

  // optional fail-out (Settings → Fail Mode): the stability meter emptied → the run collapses
  function failRun() {
    if (runFailed || state !== 'playing') return;
    runFailed = true;
    cameraShake = Math.max(cameraShake, 14); glitchAmount = 1;
    flashJudgment('SIGNAL LOST', '#ff1f2e');
    endGame();
  }

  async function endGame() {
    stopGame();
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
    };
    _lastResults = results;   // expose for the Levels results-loop (NEXT/RETRY + per-level stars)
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
    if (timingFeel === 'tight') {
      try { if (window.RhythmCatalog && window.RhythmCatalog.onSubmitResult) window.RhythmCatalog.onSubmitResult({ error: 'practice' }, results); } catch (e) {}
    } else if (session && session.submit) {
      try {
        const out = await session.submit(results);
        if (window.RhythmCatalog && window.RhythmCatalog.onSubmitResult) {
          window.RhythmCatalog.onSubmitResult(out, results);
        }
      } catch (e) { console.warn('submit failed', e); }
    }
  }

  function renderResults(results, accPct, grade) {
    { const ge = $('results-grade'); ge.textContent = grade; ge.className = 'results-grade gr-' + (grade || 'D'); }   // tier class → color-coded grade (S=gold, A=crimson, …)
    // star rating — ONE shared 3-star scale across the results screen AND the campaign cards (build58: was a 5-star accuracy
    // curve that disagreed with the 3-star level cards, e.g. an A read 4/5 here but 3/3 on the card). S/A=3, B=2, C/D=1; a
    // FAILED run = 0. The letter grade above carries the finer nuance.
    { const starN = runFailed ? 0 : ((grade === 'S' || grade === 'A') ? 3 : (grade === 'B') ? 2 : 1);
      const sh = $('results-stars');
      if (sh) {
        sh.innerHTML = '';
        for (let i = 0; i < 3; i++) {
          const st = document.createElement('span');
          st.className = 'rstar' + (i < starN ? ' on' : '');
          st.textContent = '★';
          if (i < starN) st.style.animationDelay = (0.5 + i * 0.12) + 's';
          sh.appendChild(st);
        }
      } }
    // count-up the score & accuracy for a satisfying results reveal
    const scoreEl = $('rs-score'), accEl = $('rs-acc');
    const startT = performance.now(), dur = 900;
    (function tick(now) {
      const p = Math.min(1, (now - startT) / dur);
      const e = 1 - Math.pow(1 - p, 3);            // ease-out cubic
      scoreEl.textContent = Math.floor(results.score * e).toLocaleString();
      accEl.textContent = (accPct * e).toFixed(1) + '%';
      if (p < 1) requestAnimationFrame(tick);
      else { scoreEl.textContent = results.score.toLocaleString(); accEl.textContent = accPct.toFixed(1) + '%'; }
    })(startT);
    $('rs-maxcombo').textContent = results.max_combo;
    $('rs-hit').textContent = results.notes_hit + ' / ' + results.notes_total;
    const tname = session && session.meta ? session.meta.title : 'Lunar Waves';
    const tartist = session && session.meta && session.meta.artist ? session.meta.artist : '';
    $('results-track').textContent = (tartist ? tname + ' — ' + tartist : tname).toUpperCase() + ' // ' + DIFFICULTY[difficulty].name.split(' — ')[0];
    const blurbs = {
      S: 'The cathedral is humming. Echoes have folded inward. The rift accepts you.',
      A: 'Signal locked. The crowd is screaming your frequency back at you.',
      B: 'Stable resonance. A few cracks in the architecture — survivable.',
      C: 'The static won. The rift bent but did not break. Try again, controller.',
      D: 'The song collapsed. ECH0 has logged your failure as a remix prompt.',
    };
    $('results-blurb').textContent = blurbs[grade];
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

    // judgment composition bar — proportional inline-block segments (fills from 0)
    const rbTotal = Math.max(1, counts.perfect + counts.great + counts.good + counts.miss);
    ['perfect', 'great', 'good', 'miss'].forEach(j => { const s = $('rb-seg-' + j); if (s) s.style.width = '0'; const c = $('rb-' + j); if (c) c.textContent = counts[j]; });
    setTimeout(() => { ['perfect', 'great', 'good', 'miss'].forEach(j => { const el = $('rb-seg-' + j); if (el) el.style.width = (counts[j] / rbTotal * 100) + '%'; }); }, 90);

    // FULL COMBO badge (NEW BEST is added by the catalog layer after the save)
    const badges = $('results-badges'); if (badges) badges.innerHTML = results.full_combo ? '<span class="rbadge fc">Full Combo</span>' : '';
    // reset the Bonus-Sparks line each render — the catalog layer (recordLocal) re-paints it for a COMPLETED
    // run; a failed run leaves it cleared so a prior run's "+N BONUS SPARKS" can't linger on this screen.
    { const rb = $('results-bonus'); if (rb) { rb.innerHTML = ''; rb.style.display = 'none'; } }

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
      // v255: the crowd cheers on an encore — play the optional cheer SFX (gated by mute + the SFX level; absent file = silent).
      if (encore && !muted) {
        // v259: prefer a real crowd-cheer.mp3 if it actually loaded; otherwise the procedural applause synth (no asset). + the sting.
        try {
          const _ch = $('encore-cheer');
          if (_ch && _ch.readyState >= 2 && isFinite(_ch.duration) && _ch.duration > 0) { _ch.volume = Math.min(0.85, Math.max(0.35, SFX_LEVEL * 6)); _ch.currentTime = 0; _ch.play().catch(() => {}); }
          else { playCheerSfx(); }
        } catch (e) { try { playCheerSfx(); } catch (e2) {} }
        try { playStingSfx('big'); } catch (e) {}
      }
    } catch (e) {}
    // build8c: celebratory burst over the card — confetti/fireworks (+ gradeup-flare when the badge lands)
    if (!results.failed) celebrateResults(accPct, grade);
  }

  // ---------- PAUSE ----------
  let _deferredStart = null;   // build65 (cycle-4): a stashed run-start thunk, set when a pause lands during the lead-in/countdown pre-roll (before the song began); consumed by resumeGame() so we never force-start audio behind a stuck PAUSED overlay.
  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused'; player.pause(); $('pause-overlay').classList.add('show');
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
    try { window.RhythmProcBg && window.RhythmProcBg.resume(); } catch (e) {}   // build66: resume the reactive backdrop
    $('pause-overlay').classList.remove('show');
    lastFrame = performance.now();
  }
  function hidePause() { _disarmRestart(); $('pause-overlay').classList.remove('show'); }

  // ---------- INPUT ----------
  function syncDiffButtons() {
    document.querySelectorAll('#diff-grid .diff-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.diff === difficulty));
  }
  document.querySelectorAll('#diff-grid .diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
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
  $('exit-btn').addEventListener('click', () => { _disarmRestart(); hidePause(); stopGame(); try { _fireSongEnd('exit'); } catch (e) {} showScreen('menu'); });
  let lastResults = null;
  $('results-replay').addEventListener('click', () => { restartGame(); });
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
    if (state === 'playing') handleHit(lane, evTime);
  }
  // lane physically released (key-up / pointer-up) — ends any active sustain in that lane
  function onLaneRelease(lane) {
    if (lane == null || lane < 0 || lane >= LANE_COUNT) return;
    laneDown[lane] = false;
  }
  // current score multiplier (combo tier + overdrive), shared by taps and sustains
  function curMult() {
    const _tp = timingProf();
    const ct = Math.min(_tp.comboCap, 1 + Math.floor(combo / _tp.comboStep));
    const cap = _tp.comboCap + 1;                       // overdrive adds one tier above the base cap
    return Math.min(MAX_MULT, Math.min(odActive ? cap : _tp.comboCap, odActive ? ct + 1 : ct));   // v258: hard-clamp to MAX_MULT (=4) — the 'tight' profile's comboCap:5 + overdrive could reach 6× and bust the notes_total*1500 ceiling
  }
  // sustain reached its tail end while held — pay any remaining fraction + a release pop
  function completeHold(lane) {
    const hn = holdNote[lane]; if (!hn) return;
    const rem = Math.max(0, 1 - holdScored[lane]);
    if (rem > 0.001) score += rem * HOLD_TOTAL * curMult();
    holdScored[lane] = 1; holdNote[lane] = null;
    laneHitPulse[lane] = 1.0; lanePluckT[lane] = 0;
    spawnHitParticles(lane, 'great');
    emitFx('holdend', 'hold', lane);   // build8c: sustain banked — column pulse up the lane
    flashJudgment('HOLD!', '#e0a93f');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    updateHUD();
  }
  // let go before the tail — TIGHT now: holding the home stretch (>= GRACE) still completes it,
  // but dropping earlier is a real miss of the sustain (combo break + a dead, dimming beam) so
  // you genuinely have to hold it down, not just tap the head.
  function endHoldEarly(lane) {
    const hn = holdNote[lane]; if (!hn) return;
    const GRACE = 0.75;                 // held at least this far → the release is forgiven (tail grace)
    holdNote[lane] = null;
    if (holdScored[lane] >= GRACE) {    // home stretch → count it as a clean hold
      const rem = Math.max(0, 1 - holdScored[lane]);
      if (rem > 0.001) score += rem * HOLD_TOTAL * curMult();
      holdScored[lane] = 1;
      laneHitPulse[lane] = 1.0; lanePluckT[lane] = 0;
      spawnHitParticles(lane, 'great');
      flashJudgment('HOLD!', '#e0a93f');
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    } else {                            // genuine drop → you let go too early
      hn.dropped = true;
      combo = 0; comboTierCur = 0;
      stability = Math.max(0, stability - 0.03);
      lanePluckT[lane] = 9;             // the string goes dead in this lane
      registerMissFx(lane);
      flashJudgment('DROPPED', '#ff6b78');
      playMissSfx();
    }
    updateHUD();
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
      press: (lane) => { if (state === 'playing') { laneDown[lane] = true; onLaneInput(lane, 'key', performance.now()); } },
      release: (lane) => onLaneRelease(lane),
      // GH require-strum dev hooks (strip at content-freeze): verify the gate + live config + held frets
      requireStrum: () => requireStrum(),
      strumState: () => ({ require: requireStrum(), profile: laneProfile, guitar: guitarPadId(), cfg: Object.assign({}, strumCfg), heldFrets: Array.from(_frets) }),
      // combo-tier dev hooks (stripped at content-freeze) — drive the ladder without a 500-streak run
      setCombo: (n) => { combo = Math.max(0, n | 0); if (combo > maxCombo) maxCombo = combo; const nt = comboTierIdx(combo); if (nt > comboTierCur) { comboTierCur = nt; onComboTierUp(nt, 2); } else { comboTierCur = nt; } updateHUD(); const cd = document.getElementById('combo-display'); return { combo, tier: comboTierCur, name: COMBO_TIERS[comboTierCur].name, dataTier: cd && cd.getAttribute('data-tier'), numColor: cd && cd.style.getPropertyValue('--ct-num') }; },
      comboTier: () => ({ combo, idx: comboTierIdx(combo), name: COMBO_TIERS[comboTierIdx(combo)].name, cur: comboTierCur, ladder: COMBO_TIERS.map(t => t.name + '@' + t.min) }),
      chargeOd: () => { overdrive = 1; updateHUD(); return overdrive; },
      od: () => ({ overdrive: +overdrive.toFixed(2), active: odActive, timer: +odTimer.toFixed(2), ready: overdrive >= 1 && !odActive }),
      audio: () => ({ musicVol: +musicVol.toFixed(2), curGain: +curGain.toFixed(3), nodeGain: (player && player.gain) ? +player.gain.gain.value.toFixed(3) : null, muted, sfx: +SFX_LEVEL.toFixed(3) }),
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
  function startProbePoll() { if (probeRaf) return; const tick = () => { if (!laneProbe && padRebindLane == null) { probeRaf = 0; return; } pollGamepad(); probeRaf = requestAnimationFrame(tick); }; probeRaf = requestAnimationFrame(tick); }
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
    };
    const release = () => { onLaneRelease(lane); zone.classList.remove('lit'); };
    // unified Pointer Events: one path for touch, mouse, AND pen — fires on press,
    // no touch/mouse double-fire, multi-finger chords work (one pointer per zone).
    zone.addEventListener('pointerdown', press, { passive: false });
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
    // build65 (cycle-3): pointerleave REMOVED — a finger drifting off a small lane button mid-sustain is NOT a lift, and
    // touch pointers have implicit capture so pointerup still fires on this zone. The leave-release was dropping holds on
    // thumb drift (worst on the narrow portrait lanes). pointerup + pointercancel still end the press on a real lift.
  });

  const odFlame = $('od-flame');
  function activateOverdrive() {
    if (state !== 'playing' || overdrive < 1 || odActive) return;
    odActive = true; odTimer = OD_DURATION; overdrive = 1;
    scanT = scanDur = 0.62; scanTier = 3;   // big activation scan sweep up the whole guitar
    try {
      const _g = fretGeom();
      for (let _i = 0; _i < LANE_COUNT; _i++) emitFx('overdrive', 'od', _i, _g.nearX[_i], _g.nearY - _g.lw * 0.30);
      // build13: star power LAUNCHES — comets race up every string as it ignites
      if (!fxLite && !reduceMotion) { const _k = (_g.lw / 128) * FX_GLOBAL; for (let _i = 0; _i < LANE_COUNT; _i++) emitStringSurge(_i, 'note-comet', 60 + _i * 24, _k, _g); }
    } catch (e) {}
    // build20 (the user circled it twice — "that flame effect doesn't fit"): the sustained
    // overdrive-aura loop sat as a SPINNING FIREBALL at the center of the catcher row for the
    // whole OD — a causeless centered blob, the exact doctrine violation. REMOVED. Star power
    // is carried by the activation comets, the burning strings/wash, the catcher fire at high
    // mult, the HUD flame, and note-comet trails — all anchored to play elements.
    try { if (_odAura) { _odAura.stop(); _odAura = null; } } catch (e) {}
    bgPulse = 1; odBurst = 1; cameraShake = 10;   // odBurst → screen-flooding ignition flash + shockwave (render)
    flashJudgment('OVERDRIVE', '#ffd98a');
    _scorePop(true);   // build51: big gold score punch when Overdrive engages
    if (odFlame) odFlame.classList.add('active');
    // build8: tell a level its big moment landed (Skully kicks the intense backdrop). No-op when unset.
    try { if (window.RhythmLevelFx && window.RhythmLevelFx.onCombo) window.RhythmLevelFx.onCombo(combo, true); } catch (e) {}
    playOverdriveSfx();
    if (navigator.vibrate) { try { navigator.vibrate([20, 30, 40]); } catch (e) {} }
    updateHUD();
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
  // safety: if the window loses focus mid-hold, a keyup may never arrive — release all
  window.addEventListener('blur', () => { for (let i = 0; i < LANE_COUNT; i++) onLaneRelease(i); if (state === 'playing') { try { pauseGame(); } catch (e) {} } });
  // build35 (audit): some embedded / WebView Chromium builds don't emit window 'blur' on tab-switch or
  // minimize — mirror the release+auto-pause on document visibilitychange so a backgrounded song never
  // keeps playing. (Same older-engine reality that the :has → :not fix addressed.)
  document.addEventListener('visibilitychange', () => { if (document.hidden) { for (let i = 0; i < LANE_COUNT; i++) onLaneRelease(i); if (state === 'playing') { try { pauseGame(); } catch (e) {} } } });

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
  function requireStrum() { return laneProfile === 'gh' && !!guitarPadId(); }
  function tryStrum(now) {
    if (now - _lastStrumT < STRUM_DEBOUNCE_MS) return;     // debounce: strum-up + strum-down both land here
    _lastStrumT = now;
    if (_frets.size === 0) return;                         // strum with no fret held = no-op (no phantom hit)
    for (const lane of _frets) onLaneInput(lane, 'guitar', now);   // chord-safe: one hit per held fret, judged at the strum instant
  }
  function pollGuitarAxes(gp) {
    const ax = gp.axes || [];
    // strum-as-axis (some clones expose strum on a hat/axis): a sign-flip in the configured dir = an edge
    if (strumCfg.strumAxis != null && ax.length > strumCfg.strumAxis) {
      const v = ax[strumCfg.strumAxis] || 0;
      if (Math.abs(v) > 0.5 && Math.sign(v) !== Math.sign(_strumAxisPrev) && (!strumCfg.strumAxisDir || Math.sign(v) === strumCfg.strumAxisDir)) tryStrum(performance.now());
      _strumAxisPrev = v;
    }
    // whammy -> Overdrive charge: wiggling the whammy (while OD not active) builds the meter; clamp at 1
    if (strumCfg.whammyAxis != null && ax.length > strumCfg.whammyAxis) {
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
  function pollGamepad() {
    if ((state !== 'playing' && !laneProbe && padRebindLane == null) || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const gp of pads) {
      if (!gp) continue;
      for (let b = 0; b < gp.buttons.length; b++) {
        const pressed = gp.buttons[b].pressed; const key = gp.index + ':' + b; const was = _padPrev[key];
        _padPrev[key] = pressed;
        if (pressed && !was) {
          if (padRebindLane != null) { const ln = padRebindLane; padRebindLane = null; bindLaneButton(ln, b); continue; }
          const lane = padMap[b];
          if (lane != null && lane >= 0 && lane < LANE_COUNT) {
            if (requireStrum()) { _frets.add(lane); if (state === 'playing') laneDown[lane] = true; }   // GH: fret HELD, no hit until a strum
            else { if (state === 'playing') laneDown[lane] = true; onLaneInput(lane, 'gamepad', performance.now()); }   // legacy: fret-press = hit (keyboard/standard pad)
          }
          if (requireStrum() && strumCfg.btns.indexOf(b) >= 0) tryStrum(performance.now());   // strum bar -> fire the held frets
          if (requireStrum() && b === strumCfg.spBtn) activateOverdrive();                    // Select (tilt fallback) -> Star Power
        } else if (!pressed && was) {
          const lane = padMap[b];
          if (lane != null && lane >= 0 && lane < LANE_COUNT) { if (requireStrum()) _frets.delete(lane); onLaneRelease(lane); }
        }
      }
      if (requireStrum()) pollGuitarAxes(gp);   // strum-axis / whammy->OD / tilt->SP (guitars only)
    }
  }
  function gamepadList() { if (!navigator.getGamepads) return []; const out = []; for (const gp of navigator.getGamepads()) if (gp) out.push(gp.id); return out; }

  // ---------- HIT LOGIC ----------
  function songTime() { return player ? player.getTime() : -3; }

  // music gate: silence the track briefly on a miss, restore otherwise
  function applyGate() {
    const target = muted ? 0 : (songTime() < muteUntil ? DIP_LEVEL * musicVol : musicVol);
    if (Math.abs(target - curGain) > 0.001) { curGain = target; if (player && player.setGain) player.setGain(target); }
  }

  function handleHit(lane, evTime) {
    lanePulse[lane] = 1.0;        // press feedback: button pushes down + lights
    lanePluckT[lane] = 0;         // pluck/vibrate this lane's string on EVERY press
    // Judge at the instant the player ACTUALLY pressed, not when this handler ran.
    // evTime is the event's DOMHighResTimeStamp; subtracting the elapsed lag recovers
    // timing lost to event-queue / frame-block latency (clamped so a bad value can't hurt).
    const inputLag = evTime ? Math.min(0.05, Math.max(0, (performance.now() - evTime) / 1000)) : 0;
    const t = songTime() - audioOffset - inputLag;
    const diff = DIFFICULTY[difficulty];
    let target = null, targetDiff = Infinity;
    for (const n of notes) {
      // OPEN note (openNotes flag) matches a press in ANY lane; all others stay lane-locked
      // (n.open is false unless the flag built it → default behavior byte-identical).
      if (!n.open && n.lane !== lane) continue;
      if (n.judged) continue;
      if (n.time < t - diff.hitWindow) continue;
      if (n.time > t + diff.hitWindow) break;
      const d = Math.abs(n.time - t);
      if (d < targetDiff) { targetDiff = d; target = n; }
    }
    if (!target) {   // empty press — no note in window. build85: whiff cue (does NOT break combo or drain stability — keyboard-feel guardrail)
      // build89: warm-grey dash (#8a807c, R>=G>=B — brand law); skip the flash if a real judgment fired this frame so the dash can't clobber it
      if (performance.now() - _lastRealJudgeMs > 30) flashJudgment('—', '#8a807c', true);
      playWhiffSfx();
      catcherRecoil[lane] = Math.max(catcherRecoil[lane] || 0, 0.5);   // half-kick (a real miss = 1.0)
      return;
    }

    // HAZARD: pressing a lane while a BOMB sits in its window penalizes — these are "don't hit".
    if (target.type === 'bomb') {
      target.judged = true; target.hit = 'bomb';
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
    if (ad < diff.hitWindow * _tp.perfFrac) kind = 'perfect';
    else if (ad < diff.hitWindow * _tp.greatFrac) kind = 'great';
    else kind = 'good';
    // signed timing error (sec): >0 = pressed LATE, <0 = pressed EARLY. Drives the early/late tick.
    const _signed = t - target.time;
    if (_timingSamples.length < 4000) _timingSamples.push(_signed);   // build83: collect for the results early/late summary

    target.judged = true; target.hit = kind;
    counts[kind]++; combo++; if (combo > maxCombo) maxCombo = combo;
    // combo milestone → LIGHTNING STRIKE (Guitar-Hero-style streak reward)
    if (combo > 0 && combo % 25 === 0) {
      const tier = combo / 25;                                  // 1, 2, 3, … — escalates with the streak
      emitComboWave(lane, tier, combo % 100 === 0);             // build13: board-wide wave, not a bottom blob
      lightningT = Math.min(0.55, 0.3 + tier * 0.05);
      comboGlow = 1;   // build64: flare the strings gold → white-hot on the milestone (cosmetic)
      scanT = scanDur = 0.42; scanTier = tier;   // combo-milestone scan sweep, brighter with the streak
      cameraShake = Math.max(cameraShake, 11 + Math.min(9, tier * 2));
      bgPulse = 1;
      const big = combo % 100 === 0;                            // every 100 is a bigger moment
      flashJudgment(combo + (big ? ' STREAK!!' : ' STREAK'), big ? '#fff2cd' : '#ffe08a');
      _scorePop(big);   // build51: the score punches on each streak milestone (big gold pop every 100)
      if (navigator.vibrate) { try { navigator.vibrate(big ? [12, 18, 12, 18, 12] : [10, 20, 10]); } catch (e) {} }
      // build8: level-fx combo milestone hook (Skully swaps to the intense backdrop). No-op when unset.
      try { if (window.RhythmLevelFx && window.RhythmLevelFx.onCombo) window.RhythmLevelFx.onCombo(combo, big); } catch (e) {}
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
    const comboTier = Math.min(_tpM.comboCap, 1 + Math.floor(combo / _tpM.comboStep));
    const _capM = _tpM.comboCap + 1;                                  // overdrive = +1 tier
    const mult = Math.min(MAX_MULT, Math.min(odActive ? _capM : _tpM.comboCap, odActive ? comboTier + 1 : comboTier));   // v258: hard-clamp to MAX_MULT (=4) — keep score within the per-note ceiling on every timing profile
    score += JUDGE[kind].score * mult;
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
    if (!odActive) overdrive = Math.min(1, overdrive + (target.type === 'star' ? 0.14 : 0.022)); // charge the meter (no top-up while OD is live — the render loop force-drains it anyway; build58 makes the no-extend rule explicit)
    lanePluckT[lane] = 0;                 // pluck the string in this lane
    if (muteUntil > 0) { muteUntil = -1; applyGate(); }  // a clean hit recovers the music
    stability = Math.min(1.0, stability + 0.01);
    spawnHitParticles(lane, kind);
    emitFx(kind === 'perfect' ? 'perfect' : 'hit', kind, lane);
    if (target.type === 'star') emitFx('star', kind, lane);   // build8b: star-pickup pop on a surge note
    // build8c: chord-bar strike — a strum ripple centered between the chord's lanes (lead note only)
    if (target.chordLead && target.chordLanes && target.chordLanes.length > 1) {
      try { const _cg = fretGeom(); let _cx = 0; for (let _ci = 0; _ci < target.chordLanes.length; _ci++) _cx += _cg.nearX[target.chordLanes[_ci]] || 0;
        emitFx('chord', 'chord', lane, _cx / target.chordLanes.length, _cg.nearY); } catch (e) {}
    }
    // v253 (#92, GH feel): a judgment WORD on EVERY note spammed at speed (Hard ≈5/s). PERFECT is the common case and its
    // white burst + crimson shockwave already read as "perfect", so the word is suppressed — the climbing combo counter +
    // streak/tier headlines carry a clean run (true Guitar-Hero feel). GREAT/GOOD (you're slightly off — worth seeing) and
    // MISS still flash. Streak/tier/Overdrive/HOLD/BOMB callouts call flashJudgment directly and are unaffected.
    if (kind !== 'perfect') flashJudgment(JUDGE[kind].name, JUDGE[kind].color);
    flashTiming(kind, _signed);   // tiny EARLY/LATE hint (cosmetic; off via Settings → Timing Hint)
    hitFeel(kind, lane);
    // a struck hold note becomes an active sustain — it keeps paying out (and the
    // string keeps ringing) for as long as this lane stays pressed (see loop()).
    if (target.type === 'hold' && target.hold > 0) {
      holdNote[lane] = target; holdScored[lane] = 0; holdSparkT[lane] = 0;
    }
    // HOPO CHAIN (openNotes flag): a clean hit while in combo auto-resolves the next `hopo` note
    // already inside its window in ANY lane — no fresh strum ("flow"). No-op when the flag is off.
    if (openNotes && combo >= 8 && kind !== 'good') chainHopos(t);
    // LEVEL FX hook (optional; set by a level overlay e.g. the Skully reactive tarot cards). No-op otherwise.
    try { if (window.RhythmLevelFx && window.RhythmLevelFx.onHit) window.RhythmLevelFx.onHit(kind, lane); } catch (e) {}
    updateHUD();
  }

  // resolve consecutive HOPO ("flow") notes off a clean hit without a re-strum.
  function chainHopos(t) {
    const diff = DIFFICULTY[difficulty];
    let resolved = 0;
    for (const n of notes) {
      if (n.judged || !n.hopo) continue;
      if (n.time < t - diff.hitWindow * 0.5) continue;
      if (n.time > t + diff.hitWindow) break;
      n.judged = true; n.hit = 'great';
      counts.great++; combo++; if (combo > maxCombo) maxCombo = combo;
      { const _nt = comboTierIdx(combo); if (_nt > comboTierCur) { comboTierCur = _nt; onComboTierUp(_nt, n.lane); } }
      score += JUDGE.great.score * curMult();
      laneHitPulse[n.lane] = 1.0; lanePluckT[n.lane] = 0;
      spawnHitParticles(n.lane, 'great');
      emitFx('hit', 'great', n.lane);
      resolved++;
      if (resolved >= 3) break;
    }
    if (resolved) { flashJudgment('FLOW x' + resolved, '#ff7a4a'); }
  }

  // per-judgment tactile feedback: world reaction + guitar chug + haptics
  function hitFeel(kind, lane) {
    if (kind === 'perfect') { cameraShake = Math.max(cameraShake, 6); bgPulse = Math.min(1, bgPulse + 0.4); }
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
          g.gain.value = (kind === 'perfect' ? 0.95 : kind === 'great' ? 0.8 : 0.62) * SFX_LEVEL;
          src.connect(g); g.connect(ac.destination); src.start(now);
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
  function missNote(note) {
    note.judged = true; note.hit = 'miss';
    counts.miss++; combo = 0; comboTierCur = 0;
    _rfPush(note.lane, 'm');   // versus stream
    // music stays at FULL level (no ducking) — the miss is signalled by the squelch SFX +
    // a dull "dud" spatter on the missed string (Guitar-Hero "clam" feel).
    stability = Math.max(0, stability - bossDrain(0.04));
    glitchAmount = Math.min(1, glitchAmount + 0.10);
    cameraShake = Math.max(cameraShake, 4);
    registerMissFx(note.lane);
    playMissSfx();
    spawnMissDud(note.lane);
    emitFx('miss', 'miss', note.lane);
    flashJudgment('MISS', '#ff1f2e');
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
  function flashJudgment(text, color, isWhiff) {
    if (!isWhiff) _lastRealJudgeMs = performance.now();
    const el = $('judge-flash');
    el.textContent = text; el.style.color = color;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
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
  window.RhythmGame.mpStun = (sec, fromName) => {
    if (state !== 'playing') return;
    const ms = Math.max(800, Math.min(3500, (sec || 2.2) * 1000));
    _mpStunUntil = performance.now() + ms;
    cameraShake = Math.max(cameraShake, 16);
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
  function updateHUD() {
    // build70 (launch-audit P3): null-guard the early HUD dereferences (its second half already does) so a
    // missing id after the /play markup move can't throw inside the rAF loop and kill the frame.
    const _hs = $('hud-score'); if (_hs) _hs.textContent = Math.floor(scoreDisplay).toLocaleString();   // animated value (loop rolls it up)
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
    const comboTier = Math.min(_tpH.comboCap, 1 + Math.floor(combo / _tpH.comboStep));
    const tier = Math.min(MAX_MULT, Math.min(odActive ? _tpH.comboCap + 1 : _tpH.comboCap, odActive ? comboTier + 1 : comboTier));   // v258: clamp the HUD multiplier to MAX_MULT so the displayed tier matches the clamped score
    _rfMult = tier;   // versus stream: cache the displayed multiplier tier for getRenderFrame()
    const _atCap = combo >= _tpH.comboStep * _tpH.comboCap;
    const within = odActive ? overdrive : (_atCap ? 1 : (combo % _tpH.comboStep) / _tpH.comboStep);
    const mb = $('mult-badge'); if (mb) { mb.textContent = tier + 'x'; if (mb.parentElement) mb.parentElement.classList.toggle('boosted', tier >= 3); }
    const mf = $('mult-fill'); if (mf) mf.style.height = (within * 100) + '%';
    // overdrive gauge
    const of = $('od-fill'); if (of) of.style.height = (overdrive * 100) + '%';
    const odReady = overdrive >= 1 && !odActive;
    const odf = $('od-flame'); if (odf) odf.classList.toggle('ready', odReady);
    // HUD Overdrive readout (the desktop-visible "hype bar") — combo-driven fill + clear CHARGING/READY/ACTIVE states
    { const odb = $('hud-od-block'); if (odb) { odb.classList.toggle('ready', odReady); odb.classList.toggle('active', odActive); }
      const odhf = $('hud-od-fill'); if (odhf) odhf.style.width = (overdrive * 100) + '%';
      const odht = $('hud-od-text'); if (odht) odht.textContent = odActive ? 'OVERDRIVE ACTIVE!' : (odReady ? '▸ READY — PRESS SPACE' : 'CHARGING · ' + Math.round(overdrive * 100) + '%'); }
    // announce once when the meter first fills, so players know Space is armed
    if (odReady && !odReadyAnnounced) { odReadyAnnounced = true; flashJudgment('OVERDRIVE READY', '#ffd98a'); }
    else if (!odReady) odReadyAnnounced = false;
    $('jc-perfect').textContent = counts.perfect;
    $('jc-great').textContent = counts.great;
    $('jc-good').textContent = counts.good;
    $('jc-miss').textContent = counts.miss;
    // judgment composition bar — proportion of each judgment so far, at a glance
    { const jt = counts.perfect + counts.great + counts.good + counts.miss || 1;
      const setSeg = (id, c) => { const e = $(id); if (e) e.style.width = (c / jt * 100) + '%'; };
      setSeg('jb-perfect', counts.perfect); setSeg('jb-great', counts.great);
      setSeg('jb-good', counts.good); setSeg('jb-miss', counts.miss); }
    const cd = $('combo-display');
    // Always write the number — vs-mode forces the capsule opaque, so a value left stale below the
    // single-player reveal threshold would read as a frozen combo. .show still gates the SP reveal at >=10.
    $('combo-num').textContent = combo;
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
    if (combo >= 10) cd.classList.add('show');
    else cd.classList.remove('show');
    $('hud-stability').style.width = (stability * 100) + '%';
    let stxt = 'STABLE';
    if (stability < 0.3) stxt = 'COLLAPSING'; else if (stability < 0.6) stxt = 'UNSTABLE';
    else if (stability < 0.85) stxt = 'FLUCTUATING';
    $('stability-text').textContent = stxt + ' · ' + Math.floor(stability * 100) + '%';
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
    rafId = requestAnimationFrame(loop);
    const now = performance.now();
    const _rawMs = now - lastFrame;
    const dt = Math.min(0.05, _rawMs / 1000);
    lastFrame = now;

    if (state === 'paused') { render(dt, true); return; }
    if (state !== 'playing') return;
    if (!fxLite && !_qAutoDone) _qSample(_rawMs);   // build66: adaptive-quality sampler (only while actually playing)

    pollGamepad();              // poll at frame-top so a controller/guitar press is judged this frame
    const t = songTime();
    const jt = t - audioOffset;
    const diff = DIFFICULTY[difficulty];
    for (const n of notes) {
      if (n.judged || jt <= n.time + diff.hitWindow) continue;
      if (n.type === 'bomb') { n.judged = true; n.hit = 'avoided'; if (n._fuseFx) { try { n._fuseFx.stop(); } catch (e) {} n._fuseFx = null; } if (n._warnFx) { try { n._warnFx.stop(); } catch (e) {} n._warnFx = null; } }   // dodged the hazard — safe, no penalty
      else missNote(n);
    }

    // ---- sustain (hold) scoring: a struck hold pays out continuously while held ----
    let sustaining = false;
    for (let i = 0; i < LANE_COUNT; i++) {
      const hn = holdNote[i]; if (!hn) continue;
      const end = hn.time + hn.hold;
      if (jt >= end) { completeHold(i); continue; }       // reached the tail end → full payout + pop
      if (!laneDown[i]) { endHoldEarly(i); continue; }    // let go early → endHoldEarly (combo break unless past the tail grace)
      const frac = Math.max(0, Math.min(1, (jt - hn.time) / hn.hold));
      if (performance.now() < _mpStunUntil) { holdScored[i] = frac; continue; }   // v258: MP combat stun — advance the sustain marker WITHOUT paying out (no score banked while shocked, and no refund-lump when the stun ends)
      const gain = frac - holdScored[i];
      if (gain > 0) { score += gain * HOLD_TOTAL * curMult(); holdScored[i] = frac; sustaining = true; }
      // keep the lane alive: string keeps ringing, catcher glows, sparks trickle up
      lanePluckT[i] = Math.min(lanePluckT[i], 0.06);
      laneHitPulse[i] = Math.max(laneHitPulse[i], 0.35);
      holdSparkT[i] += dt;
      if (holdSparkT[i] >= 0.09) { holdSparkT[i] = 0; spawnSustainSpark(i); }
    }
    if (sustaining) updateHUD();

    if (t > songDuration + 0.6) { for (let i = 0; i < LANE_COUNT; i++) if (holdNote[i]) completeHold(i); endGame(); return; }   // build58: bank any sustain still correctly held when the clock crosses the end

    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);   // build64 PERF: cap runaway particle growth (oldest first)
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      if (!p.ring && !p.column && !p.flash) {
        p.vy += 480 * (p.grav != null ? p.grav : 1) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.kit) { p.vx *= (1 - 0.85 * dt); if (p.vz) p.z = (p.z || 0) + p.vz * dt; }   // build65: ease + advance toward-camera depth
      }
      if (p.frag || (p.kit && p.vrot)) p.rot += p.vrot * dt;
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
    if (odActive && !reduceMotion && !fxLite) {
      const fgo = fretGeom(), _mid = (LANE_COUNT - 1) / 2;
      for (let i = 0; i < LANE_COUNT; i++) {
        if (Math.random() > 0.32) continue;   // build65 (cycle-3): lower emit rate so the ambient stream doesn't crowd the read-path
        // edge-bias: embers drift OUTWARD from the playfield center (rise along the rails, not straight up the gem columns)
        const side = i < _mid ? -1 : i > _mid ? 1 : (Math.random() < 0.5 ? -1 : 1);
        particles.push({ kit: true, shape: 'ember', x: fgo.nearX[i] + side * fgo.lw * 0.34, y: fgo.nearY,
          vx: side * (18 + Math.random() * 30), vy: -120 - Math.random() * 120, grav: 0.18, z: 0, vz: 0.12,
          rot: 0, vrot: 0, size: 1.8 + Math.random() * 2.4, life: 0.6 + Math.random() * 0.5, age: 0,
          color: Math.random() < 0.5 ? '255,210,110' : '255,176,70', add: true, glow: '255,214,130' });
      }
    }
    // build65 PERF: re-cap AFTER this frame's spawn loops (streak flames + OD stream + the per-hit burst all push above)
    // so the render pass can't iterate an oversized array at peak load (Hard + high combo + OD). Oldest-first trim.
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    // animated score count-up — the displayed number rolls toward the real score (game juice)
    if (scoreDisplay !== score) {
      if (Math.abs(score - scoreDisplay) < 0.6) scoreDisplay = score;
      else scoreDisplay += (score - scoreDisplay) * Math.min(1, dt * 14);
      const el = $('hud-score'); if (el) el.textContent = Math.floor(scoreDisplay).toLocaleString();
    }
    // (gamepad now polled at frame-top — see loop start)
    // drain overdrive while active; meter empties over the duration, then ends
    if (odActive) {
      odTimer -= dt;
      overdrive = Math.max(0, odTimer / OD_DURATION);
      bgPulse = Math.max(bgPulse, 0.35);
      if (odTimer <= 0) { odActive = false; overdrive = 0; if (odFlame) odFlame.classList.remove('active', 'ready'); if (_odAura) { try { _odAura.stop(); } catch (e) {} _odAura = null; } emitFx('odend', 'od'); }
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
    const approach = DIFFICULTY[difficulty].approach / (userScroll * _levelSpeedMul());   // build36: per-level SPEED mod
    const sx = (Math.random() - 0.5) * cameraShake, sy = (Math.random() - 0.5) * cameraShake;
    ctx.save(); ctx.translate(sx, sy);
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
        else { for (let i = 0; i < _readyRings.length && i < LANE_COUNT; i++) { const h = _readyRings[i]; if (h && h.alive()) h.move(nearX[i], nearY); } }
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
      const pth = new Path2D();
      const undu = Math.max(pl, heat * 0.5);                  // hot strings shimmer even un-plucked
      if (undu < 0.05 && warp <= 0) { pth.moveTo(nearX[i], nearY); pth.lineTo(farX[i], farY); }
      else {
        const segs = 16, amp = undu * 11;
        for (let s = 0; s <= segs; s++) {
          const u = s / segs;
          const bx = nearX[i] + (farX[i] - nearX[i]) * u, by = nearY + (farY - nearY) * u;
          const wob = Math.sin(u * Math.PI) * Math.sin(ph0 + u * 13 + i) * amp;
          const wx = warpX(bx, u) + wob;                       // follow the neck warp so strings ride the art
          s === 0 ? pth.moveTo(wx, by) : pth.lineTo(wx, by);
        }
      }
      if (_skinArtOn) {   // dark SEAT under the neon line — contrast against busy skin art
        ctx.globalCompositeOperation = 'source-over';
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(12,7,6,' + (0.40 + live * 0.18).toFixed(3) + ')';
        ctx.lineWidth = sWidth + 2.6;
        ctx.stroke(pth);
        ctx.globalCompositeOperation = 'lighter';
      }
      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + sAlpha.toFixed(3) + ')';
      ctx.lineWidth = sWidth;
      ctx.shadowColor = _tintRGB ? ('rgb(' + _tintRGB + ')') : (dz > 0.3 ? '#6b6360' : (hI > 0.5 ? '#ff7a2a' : '#ff2a30'));
      ctx.shadowBlur = (fxLite || reduceMotion) ? 0 : (7 + live * 18 + hI * 14) * (1 - 0.4 * cold);   // build66 (launch-audit P2): gate the per-lane string glow blur for perf/a11y users — it was the one ungated FX in this loop (5 shadowBlur strokes/frame)
      ctx.stroke(pth); ctx.restore();
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
      const held = (n.type === 'hold' && holdNote[n.lane] === n);   // struck & actively sustaining
      // a struck-then-dropped hold keeps showing its (shrinking) beam until the tail passes —
      // it goes dim and dies in place, so a let-go reads clearly instead of vanishing instantly
      const resolving = (n.type === 'hold' && n.dropped && t < n.time + n.hold);
      if (n.judged && n.hit !== 'miss' && !held && !resolving) continue;
      let d = (n.time - t) / approach;
      if (!held && !resolving && (d > 1.02 || d < -0.12)) continue;
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
      // CHORD BAR — a glowing rail connecting the simultaneous notes ("hit the bar together")
      if (n.chordLead && n.chordLanes && n.chordLanes.length > 1 && !n.judged) {
        let x0 = Infinity, x1 = -Infinity;
        for (let c = 0; c < n.chordLanes.length; c++) { const xx = noteX(n.chordLanes[c], d); if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; }
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,150,70,' + (0.28 * sc) + ')'; ctx.lineWidth = lw * 0.42 * sc; ctx.shadowColor = '#ff2a30'; ctx.shadowBlur = 12 * sc;
        ctx.beginPath(); ctx.moveTo(x0, ny); ctx.lineTo(x1, ny); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,235,210,' + (0.6 * sc) + ')'; ctx.lineWidth = Math.max(1.2, lw * 0.1 * sc); ctx.shadowBlur = 6 * sc;
        ctx.beginPath(); ctx.moveTo(x0, ny); ctx.lineTo(x1, ny); ctx.stroke();
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
      if (n.type === 'hold' && n.hold > 0) {
        const struck = held || resolving;
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
      if (!resolving) drawNote(nx, ny, lw * 0.46 * sc, n);
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
        const r = (p.age / p.life) * p.max;
        ctx.strokeStyle = 'rgba(' + p.color + ',' + (a * 0.8) + ')'; ctx.lineWidth = 2.5 * a + 0.5;
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

    // soft vignette to seat the playfield (image already has its own)
    const vg = ctx.createRadialGradient(cw / 2, ch * 0.56, ch * 0.3, cw / 2, ch * 0.56, ch * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch);

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
    const base = Math.round(Math.min(lw * 0.92, 82));
    // build28: cache the BRIGHT per-lane faceted gems (GH-style: lane color + white core + dark ring + glow)
    // and the gold surge star. These are the high-contrast notes that pop on ANY guitar (replacing the dark
    // obsidian sphere + the blend-into-guitar theme tint). Rebuilt on resize/profile change; LANE_COLORS is
    // live by here (buildGameSprites runs from the draw loop, after applyLaneProfile set the gh palette).
    const gems = []; for (let l = 0; l < LANE_COUNT; l++) gems.push(buildMarble(base, l));   // build29: 3D marbles (was flat buildGem hexagons)
    gfx = { lw: lw, base: base, gems: gems, star: buildStar(base) };
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
    x.save(); x.shadowColor = 'rgb(' + rgb + ')'; x.shadowBlur = base * 0.7;
    const g = x.createRadialGradient(cx - r * 0.34, cy - r * 0.40, r * 0.06, cx, cy, r * 1.02);
    g.addColorStop(0.00, 'rgb(' + litCap + ')'); g.addColorStop(0.30, 'rgb(' + litMid + ')');
    g.addColorStop(0.62, 'rgb(' + rgb + ')'); g.addColorStop(0.86, 'rgb(' + shadowCore + ')'); g.addColorStop(1.00, 'rgb(' + reflRim + ')');
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
    // (4) warm near-black OUTER RING — pops on BRIGHT guitars
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.lineWidth = Math.max(2.4, base * 0.11); x.strokeStyle = 'rgba(18,7,7,0.85)'; x.stroke();
    // (5) thin white top rim
    x.beginPath(); x.arc(cx, cy, r * 0.93, Math.PI * 1.04, Math.PI * 1.96); x.lineWidth = Math.max(1, base * 0.03); x.strokeStyle = 'rgba(255,255,255,0.55)'; x.stroke();
    // (6) two-stage specular hotspot (upper-left) — the #1 "this is a 3D ball" cue
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.ellipse(cx - r * 0.30, cy - r * 0.36, r * 0.30, r * 0.20, -0.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.98)'; x.beginPath(); x.ellipse(cx - r * 0.32, cy - r * 0.38, r * 0.13, r * 0.085, -0.5, 0, Math.PI * 2); x.fill();
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

  function drawNote(cx, y, w, note) {
    // build28 (playtest: notes were invisible — pink-on-pink / bone-on-bone / dark-on-dark): notes are now the
    // BRIGHT per-lane faceted gem (lane color + white core + dark ring + glow) so they pop on ANY guitar; the
    // gold star for surge notes. The level theme NO LONGER recolors the note body (that was the blend bug).
    const gem = gfx && (note.type === 'star' ? gfx.star : (gfx.gems && gfx.gems[note.lane]));
    // target on-screen gem diameter ≈ 1.55× the lane note width (clearly readable); the cached canvas holds the
    // gem within S=base*~2.7 of padding/glow, so scale the whole canvas by (S/base) to land the gem at that size.
    let GEM_K = 1.55;
    if (note.type === 'accent') GEM_K *= 1.12;
    const _emph = (typeof note._emph === 'number') ? note._emph : 0.5;   // build75: music-driven emphasis (0..1)
    GEM_K *= (0.88 + 0.34 * _emph);   // strong onsets render BIGGER (~0.88x weak → ~1.22x strong) so the chart looks like the song
    if (gem && gfx.base) {
      const Sd = w * GEM_K * (gem.S / gfx.base);
      ctx.drawImage(gem.c, cx - Sd / 2, y - Sd / 2, Sd, Sd);
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
  }
  // hazard "bomb": a dark orb with a pulsing red warning halo + a bright ✕ — clearly DON'T hit
  function drawBomb(cx, y, r) {
    const tt = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(tt * 9);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // build9: bombs adopt the level accent (Skully violet etc.) so hazards read as part of the world;
    // default (no accent) is byte-identical crimson-ember.
    ctx.fillStyle = 'rgba(' + (levelAccentRGB || '255,46,24') + ',' + (0.10 + 0.14 * pulse) + ')';
    ctx.beginPath(); ctx.arc(cx, y, r * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createRadialGradient(cx - r * 0.3, y - r * 0.32, r * 0.1, cx, y, r);
    g.addColorStop(0, '#3a1216'); g.addColorStop(1, '#080304');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.strokeStyle = 'rgba(' + (levelAccentRGB || '255,64,40') + ',' + (0.55 + 0.45 * pulse) + ')';
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.stroke();
    // the ✕ (do-not-hit)
    ctx.strokeStyle = 'rgba(255,216,190,0.95)'; ctx.lineWidth = Math.max(1.6, r * 0.16); ctx.lineCap = 'round';
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
    $('calib-count').textContent = '0 / ' + CALIB_TARGET;
    $('calib-measured').textContent = '— ms';
    const startMs = Math.round(audioOffset * 1000);
    $('calib-slider').value = startMs;
    $('calib-slider-val').textContent = (startMs > 0 ? '+' : '') + startMs + ' ms';
    calibScreen.classList.add('active');
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
  function bindLaneButton(lane, b) {
    for (const k in padMap) if (padMap[k] === lane) delete padMap[k];   // each lane keeps one button
    delete padMap[b];                                                   // each button maps to one lane
    padMap[b] = lane;
    savePadMap(); renderPadcaps(); renderDeviceStatus();
    if (onPadBound) { try { onPadBound(lane, b); } catch (e) {} }
  }
  function resetPad() { padMap = identityPad(LANE_COUNT); savePadMap(); renderPadcaps(); }
  function startPadRebind(lane) {
    padRebindLane = lane;
    const host = $('set-pad'); if (!host) return;
    [...host.children].forEach(c => c.classList.toggle('listening', +c.dataset.lane === lane));
    const cap = host.children[lane]; if (cap) cap.textContent = '…';
    startProbePoll();   // poll so the next controller button press is captured
  }
  function cancelPadRebind() { padRebindLane = null; renderPadcaps(); }
  function renderPadcaps() {
    const host = $('set-pad'); if (!host) return;
    host.innerHTML = '';
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const cap = document.createElement('button');
      cap.className = 'keycap'; cap.dataset.lane = lane;
      cap.textContent = padGlyph(padForLane(lane));
      cap.addEventListener('click', () => startPadRebind(lane));
      host.appendChild(cap);
    }
  }
  try { window.__rrPadMap = () => JSON.parse(JSON.stringify(padMap)); } catch (e) {}

  // ---- GUIDED "SET UP CONTROLLER" WIZARD (the headline controller affordance) -----------------------
  // Walks the user lane-by-lane: highlight a lane, prompt big + clear, capture the NEXT gamepad button
  // press (reusing startProbePoll -> bindLaneButton via the onPadBound hook), confirm, advance. Works for
  // ANY controller including GH guitars (whose fret layout we can't assume). Cancel restores the prior map.
  let _wizActive = false, _wizLane = 0, _wizPrevMap = null;
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
        ? 'Listening for a button press…  (controller: ' + String(seen).slice(0, 28) + ')'
        : 'No controller detected yet — plug it in and press any button to wake it.';
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
    startProbePoll();
    _wizRender();
  }
  function startPadWizard() {
    _wizActive = true;
    _wizPrevMap = JSON.parse(JSON.stringify(padMap));   // for Cancel restore
    padMap = {};                                         // fresh map — every lane gets reassigned in order
    _wizLane = 0;
    onPadBound = (lane) => {
      if (!_wizActive) return;
      if (lane === _wizLane) {
        _wizLane++;
        if (_wizLane >= LANE_COUNT) {
          if (laneProfile === 'gh') { savePadMap(); startCalibration(); }   // guitar: continue into strum/whammy/tilt calibration
          else { finishPadWizard(); }                                       // standard pad: frets are enough
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
    _wizActive = false; onPadBound = null; padRebindLane = null;
    _stopCalRaf(); _calStep = -1;   // stop any in-flight strum/whammy/tilt sampler
    _wizSetVisible(false);
    try { renderPadcaps(); renderDeviceStatus(); } catch (e) {}
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
    { title: 'STRUM',      prompt: 'Hit the <b>STRUM BAR</b>',                          sub: 'Strum up or down — we’ll capture it.' },
    { title: 'WHAMMY',     prompt: 'Wiggle the <b>WHAMMY BAR</b> through its full range', sub: 'Push it all the way and release, for ~1.5s.' },
    { title: 'STAR POWER', prompt: 'Tilt the guitar <b>UP</b> — or press <b>Select</b>',  sub: 'This becomes your Star Power / Overdrive trigger.' },
  ];
  function _stopCalRaf() { if (_calRaf) { try { cancelAnimationFrame(_calRaf); } catch (e) {} _calRaf = 0; } if (_calTimer) { clearTimeout(_calTimer); _calTimer = 0; } }
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
  function _armCalStep() {
    _calRender(null);
    if (_calStep === 0) _captureNextButton(15000, (b) => { if (b != null) { strumCfg.btns = [b]; saveStrumCfg(); _calRender('Strum = button ' + b); } _calNext(800); });
    else if (_calStep === 1) _sampleAxes(1600, 0.4, (axis, lo, hi) => { if (axis != null) { strumCfg.whammyAxis = axis; strumCfg.whammyMin = +(+lo).toFixed(2); strumCfg.whammyMax = +(+hi).toFixed(2); saveStrumCfg(); _calRender('Whammy = axis ' + axis); } else _calRender('Whammy = default (none found)'); _calNext(800); });
    else if (_calStep === 2) _captureTilt(2200, (res) => { if (res && res.spBtn != null) { strumCfg.spBtn = res.spBtn; saveStrumCfg(); _calRender('Star Power = button ' + res.spBtn); } else if (res && res.tiltAxis != null) { strumCfg.tiltAxis = res.tiltAxis; strumCfg.tiltThresh = res.tiltThresh; saveStrumCfg(); _calRender('Star Power = tilt axis ' + res.tiltAxis); } else _calRender('Star Power = Select (default)'); _calNext(900); });
  }
  function _calNext(delayMs) { clearTimeout(_calTimer); _calTimer = setTimeout(() => { _calTimer = 0; if (_calStep < 0) return; _calStep++; if (_calStep > 2) finishCalibration(); else _armCalStep(); }, delayMs || 600); }
  function _calSkip() { if (_calStep < 0) return; clearTimeout(_calTimer); _calTimer = 0; _stopCalRaf(); _calStep++; if (_calStep > 2) finishCalibration(); else _armCalStep(); }
  function finishCalibration() {
    _stopCalRaf(); _calStep = -1; _wizActive = false; saveStrumCfg();
    const big = wizEl('pad-wizard-prompt'); if (big) big.innerHTML = '✅ Guitar ready — <b>fret + strum</b> to play.';
    const sub = wizEl('pad-wizard-sub'); if (sub) sub.textContent = 'Whammy charges Overdrive · tilt / Select fires Star Power. Re-run anytime to remap.';
    const stepEl = wizEl('pad-wizard-step'); if (stepEl) stepEl.textContent = 'Done';
    const skip = wizEl('pad-wizard-skip'); if (skip) skip.style.display = 'none';
    const dots = wizEl('pad-wizard-dots'); if (dots) dots.querySelectorAll('.wiz-dot').forEach(d => { d.className = 'wiz-dot done'; });
    const dn = wizEl('pad-wizard-done'); if (dn) dn.textContent = 'DONE';
    try { renderDeviceStatus(); } catch (e) {}
    try { window.RhythmGame.showToast('Guitar calibrated — fret + strum!', 'success'); } catch (e) {}
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
  function renderDeviceStatus() {
    const el = $('set-devices');
    const pads = gamepadList();
    const ghId = guitarPadId();
    if (el) {
      const rows = [['Keyboard', 'Ready', true]];
      if (!navigator.requestMIDIAccess) rows.push(['MIDI', 'Unsupported browser', false]);
      else rows.push(['MIDI', midiInputs.length ? midiInputs.join(', ') : 'No device detected', midiInputs.length > 0]);
      rows.push(['Controller', pads.length ? pads[0].slice(0, 26) : 'No device detected', pads.length > 0]);
      if (ghId) {   // GH-3: surface the calibrated strum/whammy/tilt mapping so a guitar player can confirm setup
        rows.push(['Strum', (strumCfg.btns && strumCfg.btns.length) ? ('Button ' + strumCfg.btns.join('/')) : 'Not set', !!(strumCfg.btns && strumCfg.btns.length)]);
        rows.push(['Whammy', strumCfg.whammyAxis != null ? ('Axis ' + strumCfg.whammyAxis) : 'Not set', strumCfg.whammyAxis != null]);
        rows.push(['Tilt / Star Power', strumCfg.tiltAxis != null ? ('Tilt axis ' + strumCfg.tiltAxis) : ('Button ' + strumCfg.spBtn), true]);
      }
      el.innerHTML = rows.map(r => '<div class="dev-row"><span class="dev-n">' + r[0] + '</span><span class="dev-v' + (r[2] ? ' ok' : '') + '">' + escDev(r[1]) + '</span></div>').join('');
    }
    // Guitar-Hero auto-detect badge + "set up my guitar" affordance
    const badge = $('gh-badge');
    if (badge) {
      badge.style.display = ghId ? 'flex' : 'none';
      const nm = $('gh-badge-name'); if (nm) nm.textContent = String(ghId || '').slice(0, 30);
      // GH-1: surface that REQUIRE STRUM is active so a new guitar player doesn't think the controller is broken
      const ss = $('gh-strum-status'); if (ss) { const on = requireStrum(); ss.textContent = on ? 'REQUIRE STRUM: ON — hold a fret + strum' : 'REQUIRE STRUM: OFF'; ss.style.color = on ? '#e0a93f' : 'var(--ink-dim)'; }
    }
    // pad-status hint near the wizard button
    const padHint = $('pad-status-hint');
    if (padHint) {
      padHint.textContent = pads.length
        ? (ghId ? '🎸 Guitar Hero controller ready' : '🎮 Controller detected: ' + String(pads[0]).slice(0, 24))
        : 'No controller yet — plug one in and press any button.';
      padHint.classList.toggle('ok', pads.length > 0);
    }
  }
  function escDev(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function setTest(on) {
    const pips = $('set-test-pips'), btn = $('set-test-btn');
    if (btn) { btn.textContent = on ? 'STOP TEST' : 'TEST INPUT'; btn.classList.toggle('active', on); }
    if (pips) {
      // build pips to match the ACTIVE profile's lane count (gh=5, standard=6) — the static markup is 6,
      // so on the default 5-lane profile the 6th pip was dead. Rebuild when the count diverges (also on a
      // mid-session profile switch) and drive the grid columns off LANE_COUNT.
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
    { const lm = $('set-lanemode'); if (lm) [...lm.children].forEach(b => b.classList.toggle('active', b.dataset.lanemode === laneProfile)); }
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
      try { ['rr_settings', 'rr_keymap', 'rr_keymap_gh', 'rr_padmap', 'rr_padmap_gh', 'rr_timinghint', 'rr_juice', 'rr_notes', 'rr_offset_ms', 'rr_open'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
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
  { const lm = $('set-lanemode'); if (lm) [...lm.children].forEach(b => b.addEventListener('click', () => {
    if (state === 'playing' || state === 'paused') { try { window.RhythmGame.showToast('Finish the run first to switch lane mode'); } catch (e) {} return; }
    [...lm.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    applyLaneProfile(b.dataset.lanemode);
    try { window.RhythmGame.showToast(b.dataset.lanemode === 'gh' ? '5-String Guitar mode — plug in a guitar controller & set it up in Settings' : '6-Lane Keyboard mode'); } catch (e) {}
  })); }
  { const rk = $('set-keys-reset'); if (rk) rk.addEventListener('click', resetKeys); }
  { const rp = $('set-pad-reset'); if (rp) rp.addEventListener('click', resetPad); }
  { const tb = $('set-test-btn'); if (tb) tb.addEventListener('click', () => setTest(!laneProbe)); }
  // --- guided controller wizard + GH preset wiring ---
  { const w = $('set-pad-wizard'); if (w) w.addEventListener('click', startPadWizard); }
  { const gw = $('gh-setup'); if (gw) gw.addEventListener('click', startPadWizard); }
  { const gp = $('set-pad-ghpreset'); if (gp) gp.addEventListener('click', applyGhPreset); }
  { const wc = $('pad-wizard-cancel'); if (wc) wc.addEventListener('click', cancelPadWizard); }
  { const ws = $('pad-wizard-skip'); if (ws) ws.addEventListener('click', () => { if (_calStep >= 0) _calSkip(); }); }   // skip the current strum/whammy/tilt step (keep its default)
  { const wd = $('pad-wizard-done'); if (wd) wd.addEventListener('click', () => { if (_wizActive) cancelPadWizard(); else _wizSetVisible(false); }); }
  // advanced (manual per-lane caps) disclosure toggle
  { const adv = $('set-pad-advanced-toggle'); if (adv) adv.addEventListener('click', () => {
      const body = $('set-pad-advanced'); if (!body) return;
      const open = body.style.display !== 'none' && body.style.display !== '';
      body.style.display = open ? 'none' : 'block';
      adv.classList.toggle('open', !open);
    }); }
  window.addEventListener('gamepadconnected', () => { if (settingsScreen.classList.contains('active')) renderDeviceStatus(); });
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
    audioOffset = ms / 1000;
    try { localStorage.setItem('rr_offset_ms', String(ms)); } catch (e) {}
    updateCalibMenuVal();
    closeCalib();
  });

  // ---------- EXPOSE ENGINE API ----------
  Object.assign(window.RhythmGame, {
    play,                              // play(provider)
    playDemo: () => play(demoProvider),
    playUrl: (url, meta) => play(() => bufferedProvider(url, meta)),   // in-browser chart a live track
    setDifficulty: (d) => { if (DIFF_STEP[d]) { difficulty = d; syncDiffButtons(); try { localStorage.setItem('rr_diff', d); } catch (e) {} } },
    getDifficulty: () => difficulty,
    setMenuPlayHandler: (fn) => { _menuPlayHandler = fn; },
    // input config (consumed by Settings UI; exposed for tooling/tests)
    getKeyMap: () => Object.assign({}, keyMap),
    setKeyBinding: (lane, key) => bindLaneKey(lane, String(key).toLowerCase()),
    resetKeys: () => resetKeys(),
    getInputStatus: () => ({ midi: midiInputs.slice(), gamepads: gamepadList(), midiSupported: !!navigator.requestMIDIAccess }),
    __buffered: (url, meta) => bufferedProvider(url, meta),   // MP tight-sync seam (deferred provider)
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
      if (nn.judged && nn.hit !== 'miss') continue;     // already struck/cleared
      if (nn.open) continue;                             // open strum bar, not a lane gem
      var d = (nn.time - t) / approach;
      if (d < -0.12 || d > dMax) continue;               // matches the render cull
      var p = _ghostPool[n++];
      p.lane = nn.lane; p.d = d;
      p.type = nn.type === 'hold' ? 1 : (nn.chord ? 2 : (nn.type === 'bomb' ? 3 : 0));
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
    setTimeout(function () { try { getAC().resume(); } catch (e) {} try { play(prov); } catch (e) {} }, delay);
  };
  if (!window.RhythmGame.getAC) window.RhythmGame.getAC = function () { return getAC(); };
  if (!window.RhythmGame.getMusicAnalyser) window.RhythmGame.getMusicAnalyser = function () { return musicAnalyser; };   // build66: live FFT tap (frequency + waveform) for procbg.js reactive backdrops

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
