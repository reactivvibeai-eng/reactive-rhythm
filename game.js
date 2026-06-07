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

  // Scoring: base per-hit is LOW; the combo multiplier (1x–3x) and Overdrive (x2,
  // capped at 4x total) scale it up. Max per note = 375 * 4 = 1500, so the total
  // can never exceed the server ceiling of notes_total * 1500.
  const JUDGE = {
    perfect: { name: 'PERFECT', color: '#dad7d2', score: 375, accW: 1.00 },
    great:   { name: 'GREAT',   color: '#e0a93f', score: 250, accW: 0.85 },
    good:    { name: 'GOOD',    color: '#ff6b78', score: 125, accW: 0.50 },
    miss:    { name: 'MISS',    color: '#ff1f2e', score: 0,   accW: 0.00 },
  };
  const MAX_MULT = 4;

  // ---------- STATE ----------
  let difficulty = 'medium';
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
  let holdNote = Array(LANE_COUNT).fill(null);  // the sustain note currently being held in this lane
  let holdScored = Array(LANE_COUNT).fill(0);   // fraction [0..1] of the active sustain already paid out
  let holdSparkT = Array(LANE_COUNT).fill(0);   // spark-emit throttle while sustaining
  const HOLD_TOTAL = 220;                       // total sustain payout for a fully-held note (× live multiplier)
  let overdrive = 0;                            // 0..1 meter
  let odActive = false;                         // overdrive mode engaged (x2 payoff)
  let odTimer = 0;                              // seconds of overdrive remaining
  let odReadyAnnounced = false;                // one-shot "OVERDRIVE READY" cue per fill
  let lastMult = 1;                             // last applied score multiplier (HUD)
  const OD_DURATION = 8;                        // how long an activation lasts
  let bgPulse = 0;
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
  let noteVariety = false;
  try { noteVariety = /[?&]notes=1/.test(location.search) || localStorage.getItem('rr_notes') === '1'; } catch (e) {}
  try { window.__rrNoteVariety = function (on) { if (on === undefined) return noteVariety; noteVariety = !!on; try { localStorage.setItem('rr_notes', on ? '1' : '0'); } catch (e) {} return noteVariety; }; } catch (e) {}
  // OPEN NOTES + HOPOs (flag-gated, OFF by default → charts byte-identical until enabled). Separate from
  // noteVariety so they A/B independently. OPEN = "strum the whole neck" (any lane clears it). HOPO =
  // a fast-run note that auto-chains off a clean hit (no fresh strum). Enable: ?open=1 / rr_open / __rrOpenNotes(true).
  let openNotes = false;
  try { openNotes = /[?&]open=1/.test(location.search) || localStorage.getItem('rr_open') === '1'; } catch (e) {}
  try { window.__rrOpenNotes = function (on) { if (on === undefined) return openNotes; openNotes = !!on; try { localStorage.setItem('rr_open', on ? '1' : '0'); } catch (e) {} return openNotes; }; } catch (e) {}
  let chartMode = 'classic'; // Settings → Chart Feel: 'classic' (every Nth onset) | 'musical' (snap each note to the strongest onset in its window)
  try {
    const s = JSON.parse(localStorage.getItem('rr_settings') || '{}');
    if (s.scroll) userScroll = s.scroll;
    if (s.fxLite) fxLite = !!s.fxLite;
    if (s.bgMode === 'performance' || s.bgMode === 'cinematic') bgMode = s.bgMode;
    if (typeof s.reduceMotion === 'boolean') reduceMotion = s.reduceMotion;
    else if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) reduceMotion = true;
    if (typeof s.music === 'number') musicVol = Math.max(0, Math.min(1, s.music));
    if (typeof s.sfx === 'number') SFX_LEVEL = Math.max(0, Math.min(0.5, s.sfx));
    if (typeof s.failMode === 'boolean') failMode = s.failMode;
    if (s.chartMode === 'classic' || s.chartMode === 'musical') chartMode = s.chartMode;
  } catch (e) {}
  // ?novideo=1 forces performance mode (FPS diagnostic / quick override)
  try { if (/[?&]novideo=1/.test(location.search)) bgMode = 'performance'; } catch (e) {}
  let glitchAmount = 0;
  let particles = [];

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
  // layered art assets (transparent PNGs keyed from the generated sheets)
  function loadImg(src){ const im=new Image(); im._ready=false; im.onload=()=>{im._ready=true;}; im.src=src; return im; }
  const neckImg = loadImg('assets/neck-cut.png');
  const bodyImg = loadImg('assets/body-cut.png');
  const guitarImg = loadImg('assets/guitar.png');
  const guitarImg5 = loadImg('assets/guitar5.png');   // 5-string neck for the Guitar-Hero controller mode
  let activeGuitarImg = guitarImg;                     // swapped by the active lane profile
  const noteImg = loadImg('assets/note-normal.png');
  const noteStarImg = loadImg('assets/note-star.png');
  const ringRed = loadImg('assets/ring-red.png');
  const ringWhite = loadImg('assets/ring-white.png');
  const ringGold = loadImg('assets/ring-gold.png');
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
      for (let i = 0; i < LANE_COUNT; i++) {
        zones[i].style.left = (bound[i] * 100) + '%';
        zones[i].style.width = ((bound[i + 1] - bound[i]) * 100) + '%';
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
  function guitarRect() {
    const aspect = (activeGuitarImg && activeGuitarImg.width && activeGuitarImg.height) ? activeGuitarImg.width / activeGuitarImg.height : ART.aspect;
    let gw, gh, gx, gy;
    if (ART.fit === 'cover') {
      // COVER-FIT (5-string gh): FILL the playfield so there's no dead space left/right/under the
      // guitar. The playfield is portrait, so this fills the WIDTH (body reaches the side edges) and
      // the non-playable headstock crops off the TOP. Anchor the body's bottom at the screen bottom.
      if (cw / ch > aspect) { gw = cw; gh = gw / aspect; }   // panel wider than guitar → fill width
      else { gh = ch; gw = gh * aspect; }                    // panel narrower → fill height
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
    // lane width = median-ish bridge string spacing (sizes notes/catchers, kept uniform)
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
      // measured from assets/guitar5.png (pixel-calibrated via measure.html — do NOT even-space)
      aspect: 0.5625, nutFY: 0.16, bridgeFY: 0.81, fit: 'cover', bottomAnchor: 0.93, persp: 4, warp: 0.2,
      nutXF:    [0.4599, 0.4825, 0.5024, 0.5275, 0.5504],
      bridgeXF: [0.3321, 0.4112, 0.4945, 0.5747, 0.6572],
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
    LANE_COLORS.length = 0; for (const c of p.colors) LANE_COLORS.push(c);
    keyMapStore = p.store; keyMap = loadKeyMapFor(p);
    padStore = p.padStore; padMap = loadPadMapFor(p.padStore, p.count);
    allocLaneArrays();
    try { localStorage.setItem('rr_lanemode', name); } catch (e) {}
    try { if (typeof updateFooterHint === 'function') updateFooterHint(); } catch (e) {}
    try { if (typeof renderKeycaps === 'function') renderKeycaps(); } catch (e) {}
    try { if (typeof renderPadcaps === 'function') renderPadcaps(); } catch (e) {}
    try { if (typeof layoutTapZones === 'function') layoutTapZones(); } catch (e) {}
  }
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}

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
  // SFX_LEVEL is declared near the top (settings block) so persisted prefs can set it before this point.
  function loadHitSfx() {
    if (hitSfxTried) return;
    hitSfxTried = true;
    const load = (url, set) => fetch(url).then(r => r.arrayBuffer())
      .then(buf => getAC().decodeAudioData(buf, set, () => {})).catch(() => {});
    load('assets/hit-chug.mp3', d => { hitBuffer = d; });
    load('assets/miss-squelch.mp3', d => { missBuffer = d; });   // GH-style "clam" on a miss
  }
  // miss "squelch" — like GarageBand/Guitar Hero clamming a note. Music stays at full level.
  function playMissSfx() {
    if (muted || !missBuffer) return;
    try {
      const ac = getAC();
      const g = ac.createGain(); g.gain.value = 0.5;
      const s = ac.createBufferSource(); s.buffer = missBuffer;
      s.connect(g); g.connect(ac.destination); s.start(ac.currentTime);
    } catch (e) {}
  }
  // Overdrive activation: a short synthesized power-up riser (no asset needed).
  // Gated by mute; rides at a modest fixed level so it accents over the music.
  function playOverdriveSfx() {
    if (muted) return;
    try {
      const ac = getAC(); const now = ac.currentTime;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.22, now + 0.05);
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
      // do NOT close the shared context — it's reused across plays
      if (this.ctx && this.ctx.state === 'running') { try { this.ctx.resume(); } catch (e) {} }
      musicAnalyser = null; musicFreq = null;
      this.ctx = null; this.src = null;
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
    let filtered;
    if (chartMode === 'musical') {
      // MUSICAL: land each note on the STRONGEST onset within its step-window, so notes hit the
      // song's actual emphasis (kicks/snares) instead of an arbitrary every-Nth onset. Same density.
      filtered = [];
      for (let i = 0; i < beats.length; i += step) {
        let best = beats[i];
        for (let j = i + 1; j < Math.min(beats.length, i + step); j++) { if (beats[j].strength > best.strength) best = beats[j]; }
        filtered.push(best);
      }
    } else {
      filtered = beats.filter((_, i) => i % step === 0);   // CLASSIC: every Nth onset (default)
    }
    // Guitar-Hero-style difficulty ramp: Easy uses fewer, centered strings; Medium/Hard use all 6
    // (span 6 → inSpan is the identity, so Medium/Hard charts are unchanged).
    const LANE_SPAN = { easy: 4, medium: 6, hard: 6 };
    const span = Math.min(LANE_SPAN[difficulty] || LANE_COUNT, LANE_COUNT);   // never exceed lane count (5-string safe)
    const laneBase = Math.floor((LANE_COUNT - span) / 2);                          // centered active window
    const inSpan = (l) => laneBase + ((((l - laneBase) % span) + span) % span);    // wrap any index into the active set
    let last = -1, last2 = -1;
    notes = filtered.map((b, idx) => {
      const seed = Math.floor(b.t * 8.97 + b.strength * 3.1 + idx * 1.7);
      let lane = laneBase + (((seed % span) + span) % span);
      let guard = 0;
      while ((lane === last || lane === last2) && guard < 4) { lane = inSpan(lane + 1); guard++; }
      last2 = last; last = lane;
      let type = 'tap';
      if (idx > 4 && idx % 31 === 0) type = 'star';        // rare gold "surge" note
      else if (b.strength >= 1.75) type = 'accent';        // strong beat → accented gem
      return { time: b.t, strength: b.strength, lane, type, hold: 0, spin: (seed % 360) * Math.PI / 180, judged: false, hit: null, _pulsed: false };
    });
    // derive HOLD notes from gaps: a beat followed by a long-enough pause becomes a
    // sustain. Be generous and SPACE them out so they actually show up regularly
    // (still ONE scored note — the head is the hit — so notes_total / anti-cheat
    // is unchanged). Tail is capped to the gap so it never reaches the next note.
    let lastHold = -99;
    for (let i = 0; i < notes.length; i++) {
      const nx = notes[i + 1];
      const gap = nx ? (nx.time - notes[i].time) : 99;
      if (notes[i].type !== 'star' && gap > 0.5 && (i - lastHold) >= 5) {
        notes[i].type = 'hold';
        notes[i].hold = Math.max(0.45, Math.min(gap * 0.62, 1.6));   // clearly long, but never overlaps the next note
        lastHold = i;
      }
    }
    // ---- CHORDS: a second simultaneous note in another lane (press two keys at once) ----
    const base = notes.slice();           // snapshot before we add to it
    const allowChord = difficulty !== 'easy';
    if (allowChord) {
      // noteVariety packs chords tighter + adds more 3-note "double-stops"; defaults byte-identical
      const chordGapMin = noteVariety ? 5 : 8;
      const chordMod = noteVariety ? 3 : 4;
      let lastChord = -99, chordId = 0;
      for (let i = 0; i < base.length; i++) {
        const n = base[i];
        if ((n.type === 'tap' || n.type === 'accent') && (i - lastChord) >= chordGapMin && i % chordMod === 0) {
          chordId++;
          const lanes = [n.lane];
          let pl = inSpan(n.lane + 2); if (pl === n.lane) pl = inSpan(pl + 1); lanes.push(pl);
          // a beefier 3-note chord now and then (more often on Hard) — "hit the bar"
          if ((difficulty === 'hard' && i % 12 === 0) || (difficulty === 'medium' && i % 28 === 0) || (noteVariety && i % 9 === 0)) {
            let p2 = inSpan(n.lane + 4); if (lanes.indexOf(p2) < 0) lanes.push(p2);
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
    const bombGap = difficulty === 'hard' ? 11 : difficulty === 'medium' ? 15 : Infinity;   // no bombs on Easy — a clean on-ramp
    let lastBomb = -99;
    for (let i = 0; i < base.length - 1; i++) {
      const n = base[i], nx = base[i + 1];
      if (n.type === 'hold') continue;
      const gap = nx.time - n.time;
      if (gap > 0.7 && (i - lastBomb) >= bombGap) {
        notes.push({ time: n.time + gap * 0.5, strength: 1, lane: inSpan(n.lane + 3), type: 'bomb', hold: 0, spin: 0, judged: false, hit: null, _pulsed: false });
        lastBomb = i;
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
      const trillMaxGap = difficulty === 'hard' ? 0.26 : 0.55;   // "fast enough to read as a trill" (per pace)
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
      const patMaxGap = difficulty === 'hard' ? 0.30 : 0.60;
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
    // ---- GAP FILL: no dead air. Insert spaced filler taps into long EMPTY stretches so a
    // section never feels empty (esp. Pulse/medium). A hold's tail already fills its own gap,
    // so we measure from the hold's END; bombs are skipped (left a clean lead-in). ----
    const fillMax = difficulty === 'hard' ? 0.62 : difficulty === 'medium' ? 0.74 : 1.05;
    const fillers = [];
    for (let i = 0; i < notes.length - 1; i++) {
      const a = notes[i], b = notes[i + 1];
      if (a.type === 'bomb') continue;
      const end = a.time + (a.type === 'hold' ? a.hold : 0);   // sustain tail occupies its gap
      const gap = b.time - end;
      if (gap <= fillMax * 1.4) continue;                       // already busy enough
      const segs = Math.round(gap / fillMax);
      for (let k = 1; k < segs; k++) {
        const t = end + (gap * k / segs);
        const seed = Math.floor(t * 97.3 + k * 13);
        let lane = laneBase + (((seed % span) + span) % span);
        if (lane === a.lane) lane = inSpan(lane + 1);
        fillers.push({ time: t, strength: 0.85, lane: lane, type: 'tap', hold: 0, spin: (seed % 360) * Math.PI / 180, judged: false, hit: null, _pulsed: false, _fill: true });
      }
    }
    if (fillers.length) { notes.push(...fillers); notes.sort((a, b) => a.time - b.time); }
    try {
      window.__rrChartStats = {
        notes: notes.length,
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
        difficulty: difficulty
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
      cachedBuffer = await ac.decodeAudioData(arr);
      ac.close();
    }
    const analyzed = await analyzeBeats(cachedBuffer);
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
      buf = await ac.decodeAudioData(arr);
      try { ac.close(); } catch (e) {}
      lastDecoded = { url: url, buf: buf };
    }
    const beats = await analyzeBeats(buf);
    return {
      beats: beats,
      duration: buf.duration,
      player: new DemoPlayer(buf),
      meta: meta || {},
      live: false,             // client-charted = practice (competitive leaderboards come with server charts)
      submit: async () => null,
    };
  }

  async function analyzeBeats(buf) {
    setLoading('Filtering bass spectrum', 45);
    const offline = new OfflineAudioContext(1, buf.length, buf.sampleRate);
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
    setLoading('Mapping note glyphs', 92);
    return out;
  }

  // ===========================================================================
  // GAME LIFECYCLE
  // ===========================================================================
  async function play(prov, opts) {
    provider = prov;
    bossMode = !!(opts && opts.boss) || bossFlag;   // Boss Stage: Levels boss card → playBoss(), or ?boss=1 to test
    $('play-btn').disabled = true;
    try {
      await beginPlay();
    } catch (e) {
      console.error(e);
      showToast(e && e.message ? e.message : 'Could not start this track');
      showScreen('menu');
    } finally {
      $('play-btn').disabled = false;
    }
  }

  // lightweight branded toast for errors / notices
  let _toastEl = null, _toastT = 0;
  function showToast(msg) {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 28px);transform:translateX(-50%) translateY(20px);z-index:400;max-width:80%;padding:13px 20px;background:rgba(20,6,10,0.94);border:1px solid rgba(255,42,48,0.5);border-radius:14px;color:#f6eef0;font-family:\'JetBrains Mono\',monospace;font-size:12px;letter-spacing:0.04em;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.6),0 0 24px rgba(255,31,46,0.25);opacity:0;transition:opacity .2s ease,transform .2s ease;pointer-events:none;';
      document.body.appendChild(_toastEl);
    }
    _toastEl.textContent = msg;
    requestAnimationFrame(() => { _toastEl.style.opacity = '1'; _toastEl.style.transform = 'translateX(-50%) translateY(0)'; });
    clearTimeout(_toastT);
    _toastT = setTimeout(() => { _toastEl.style.opacity = '0'; _toastEl.style.transform = 'translateX(-50%) translateY(20px)'; }, 3400);
  }
  window.RhythmGame = window.RhythmGame || {};
  window.RhythmGame.showToast = showToast;
  window.RhythmGame.playBoss = (prov) => play(prov, { boss: true });   // Boss Stage launcher (Levels boss card wires here)
  // ---- Level-DESIGN seams (additive; default-inert) ----
  let _levelCtx = null, _levelMods = null, _lastResults = null;
  window.RhythmGame.setLevelContext = (L) => { _levelCtx = L || null; };
  window.RhythmGame.setLevelMods = (m) => { _levelMods = (m && typeof m === 'object') ? m : null; };
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
    try { localStorage.setItem('rr_settings', JSON.stringify({ scroll: userScroll, fxLite: fxLite, reduceMotion: reduceMotion, bgMode: bgMode, music: musicVol, sfx: SFX_LEVEL, failMode: failMode, chartMode: chartMode })); } catch (e) {}
  };
  window.RhythmGame.getSettings = () => ({ scroll: userScroll, fxLite: fxLite, reduceMotion: reduceMotion, bgMode: bgMode, music: musicVol, sfx: SFX_LEVEL, failMode: failMode, chartMode: chartMode });
  function applyReduceMotion() { try { document.documentElement.classList.toggle('rr-reduce-motion', reduceMotion); } catch (e) {} }
  applyReduceMotion();
  // performance background: hide + pause the moon video (kills its compositing cost so the
  // frame-rate isn't capped by video decode/compositing); the canvas atmosphere still renders.
  function applyBgMode() {
    try {
      const perf = bgMode === 'performance';
      document.documentElement.classList.toggle('rr-perf-bg', perf);
      ['bg-video', 'start-video'].forEach((id) => {
        const v = document.getElementById(id);
        if (!v) return;
        if (perf) { try { v.pause(); } catch (e) {} }
        else { try { v.play(); } catch (e) {} }
      });
    } catch (e) {}
  }
  applyBgMode();
  // keep the in-game footer hint in sync with the (remappable) lane keys
  function updateFooterHint() {
    const el = document.getElementById('footer-keys'); if (!el) return;
    let h = ''; for (let l = 0; l < LANE_COUNT; l++) { const k = keyForLane(l); h += '<kbd>' + (k ? (k === ' ' ? '␣' : k.toUpperCase()) : '—') + '</kbd>'; }
    el.innerHTML = h;
  }
  updateFooterHint();

  // Boot the lane profile: ?gh=1 forces 5-string Guitar-Hero mode; otherwise restore the saved choice.
  // Standard (6-lane keyboard) users hit NO new code path — applyLaneProfile only runs for gh.
  (function bootLaneProfile() {
    let mode = null;
    try {
      const m = location.search.match(/[?&]gh=([01])/);
      if (m) mode = (m[1] === '1') ? 'gh' : 'standard';      // ?gh=1 → 5-string; ?gh=0 → reset to 6-string
      else if (localStorage.getItem('rr_lanemode') === 'gh') mode = 'gh';   // else restore saved choice
    } catch (e) {}
    if (mode) applyLaneProfile(mode);
    try { const pm = location.search.match(/[?&]persp=([0-9.]+)/); if (pm) perspOverride = parseFloat(pm[1]) || 0; } catch (e) {}
    try { const wm = location.search.match(/[?&]warp=([0-9.]+)/); if (wm) warpOverride = parseFloat(wm[1]); } catch (e) {}
  })();

  function resetScoring() {
    score = 0; combo = 0; maxCombo = 0; scoreDisplay = 0; runFailed = false;
    counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    stability = 1.0; particles = []; cameraShake = 0; glitchAmount = 0;
    bossPhase = 1; bossPhaseShown = false;
    bgPulse = 0; lanePulse = Array(LANE_COUNT).fill(0); laneHitPulse = Array(LANE_COUNT).fill(0);
    missFlash = 0; wipeoutT = 0; stringsCold = 0; missTimes = []; lastWipeout = -9;
    laneDesat = Array(LANE_COUNT).fill(0); catcherRecoil = Array(LANE_COUNT).fill(0);
    lanePluckT = Array(LANE_COUNT).fill(9); muteUntil = -1; curGain = 1; overdrive = 0;
    laneDown = Array(LANE_COUNT).fill(false); holdNote = Array(LANE_COUNT).fill(null);
    holdScored = Array(LANE_COUNT).fill(0); holdSparkT = Array(LANE_COUNT).fill(0);
    odActive = false; odTimer = 0; lastMult = 1; odReadyAnnounced = false;
    { const odf = $('od-flame'); if (odf) odf.classList.remove('ready', 'active'); }
    updateHUD();
  }

  async function beginPlay() {
    // (re)build session — fresh play_token + player each attempt (live anti-cheat)
    session = await provider();
    beats = session.beats || [];
    songDuration = session.duration || 0;
    player = session.player;
    if (!beats.length) throw new Error('No beats in chart');

    buildNotes();
    resetScoring();

    // update HUD meta
    $('hud-diff').textContent = DIFFICULTY[difficulty].name;
    if (session.meta) {
      $('hud-track').textContent = session.meta.title + ' — ' + session.meta.artist;
    }

    showScreen('game');
    resize();
    layoutTapZones();   // canvas is now visible & sized — pin touch lanes under the buttons
    // belt-and-suspenders: the grid/flex layout may not have its final width on this very
    // frame, so re-pin once it settles (rAF) and again shortly after, when cw is reliable.
    requestAnimationFrame(() => { resize(); layoutTapZones(); });
    setTimeout(() => { resize(); layoutTapZones(); }, 60);

    await player.prepare();
    await runCountdown();

    player.onended = () => { if (state === 'playing') endGame(); };
    // re-arm audio: the countdown delay can let mobile browsers re-suspend the
    // context that the tap gesture unlocked, which would start the song silent.
    try { const ac = getAC(); if (ac.state === 'suspended') await ac.resume(); } catch (e) {}
    muteUntil = -1; curGain = 1; applyGate();
    player.play();
    state = 'playing';
    lastFrame = performance.now();
    loop();
  }

  async function runCountdown() {
    const el = $('countdown');
    screens.countdown.classList.add('active');
    for (let i = 3; i >= 1; i--) {
      el.textContent = i;
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      await new Promise(r => setTimeout(r, 700));
    }
    screens.countdown.classList.remove('active');
  }

  function stopGame() {
    state = 'menu';
    if (player) { try { player.onended = null; player.stop(); } catch (e) {} player = null; }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
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
    const total = notes.length;
    const hit = counts.perfect + counts.great + counts.good;
    const accFrac = total > 0
      ? (counts.perfect * 1.0 + counts.great * 0.85 + counts.good * 0.5) / total : 0;
    const accPct = accFrac * 100;
    let grade = 'D';
    if (accPct >= 95) grade = 'S'; else if (accPct >= 88) grade = 'A';
    else if (accPct >= 75) grade = 'B'; else if (accPct >= 60) grade = 'C';

    const results = {
      difficulty,
      score: Math.round(score),
      accuracy: Math.round(accFrac * 10000) / 10000, // 0..1
      max_combo: maxCombo,
      notes_hit: hit,
      notes_total: total,
      grade,
      full_combo: counts.miss === 0 && total > 0,
      failed: runFailed,
      boss: bossMode,
    };
    _lastResults = results;   // expose for the Levels results-loop (NEXT/RETRY + per-level stars)

    renderResults(results, accPct, grade);
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

    // live submit (play_token round-trip) — handled by catalog layer (leaderboard only)
    if (session && session.submit) {
      try {
        const out = await session.submit(results);
        if (window.RhythmCatalog && window.RhythmCatalog.onSubmitResult) {
          window.RhythmCatalog.onSubmitResult(out, results);
        }
      } catch (e) { console.warn('submit failed', e); }
    }
  }

  function renderResults(results, accPct, grade) {
    $('results-grade').textContent = grade;
    // star rating from accuracy — a quick visual read layered on the letter grade
    { const starN = accPct >= 95 ? 5 : accPct >= 85 ? 4 : accPct >= 72 ? 3 : accPct >= 55 ? 2 : accPct >= 30 ? 1 : 0;
      const sh = $('results-stars');
      if (sh) {
        sh.innerHTML = '';
        for (let i = 0; i < 5; i++) {
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

    // judgment composition bar — proportional inline-block segments (fills from 0)
    const rbTotal = Math.max(1, counts.perfect + counts.great + counts.good + counts.miss);
    ['perfect', 'great', 'good', 'miss'].forEach(j => { const s = $('rb-seg-' + j); if (s) s.style.width = '0'; const c = $('rb-' + j); if (c) c.textContent = counts[j]; });
    setTimeout(() => { ['perfect', 'great', 'good', 'miss'].forEach(j => { const el = $('rb-seg-' + j); if (el) el.style.width = (counts[j] / rbTotal * 100) + '%'; }); }, 90);

    // FULL COMBO badge (NEW BEST is added by the catalog layer after the save)
    const badges = $('results-badges'); if (badges) badges.innerHTML = results.full_combo ? '<span class="rbadge fc">Full Combo</span>' : '';

    // remember for the Copy Score action
    lastResults = { results, accPct, grade, track: tname, artist: tartist, diff: DIFFICULTY[difficulty].name };
  }

  // ---------- PAUSE ----------
  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused'; player.pause(); $('pause-overlay').classList.add('show');
  }
  function resumeGame() {
    if (state !== 'paused') return;
    player.resume(); state = 'playing';
    $('pause-overlay').classList.remove('show');
    lastFrame = performance.now();
  }
  function hidePause() { $('pause-overlay').classList.remove('show'); }

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
  try { const d = localStorage.getItem('rr_diff'); if (d && DIFF_STEP[d]) { difficulty = d; syncDiffButtons(); } } catch (e) {}
  $('resume-btn').addEventListener('click', resumeGame);
  $('restart-btn').addEventListener('click', () => { hidePause(); restartGame(); });
  $('exit-btn').addEventListener('click', () => { hidePause(); stopGame(); showScreen('menu'); });
  let lastResults = null;
  $('results-replay').addEventListener('click', () => { restartGame(); });
  $('results-menu').addEventListener('click', () => { stopGame(); showScreen('menu'); });
  { const sb = $('results-share'); if (sb) sb.addEventListener('click', async () => {
    if (!lastResults) return;
    const r = lastResults;
    const line = '♪ ' + r.track + (r.artist ? ' — ' + r.artist : '') +
      '\nReactive Rhythm · ' + r.diff +
      '\nGrade ' + r.grade + ' · ' + r.results.score.toLocaleString() + ' pts · ' + r.accPct.toFixed(1) + '% · ' + r.results.max_combo + 'x' + (r.results.full_combo ? ' · FULL COMBO' : '');
    try { await navigator.clipboard.writeText(line); sb.textContent = 'COPIED ✓'; }
    catch (e) { sb.textContent = 'COPY FAILED'; }
    setTimeout(() => { sb.textContent = 'COPY SCORE'; }, 1600);
  }); }

  // ---------- UNIFIED LANE INPUT (gameplay + Settings input-test probe) ----------
  // Every input source (touch / key / MIDI / gamepad) funnels through here, so the
  // Settings "Test Input" panel can light a lane from any device while gameplay only
  // reacts when actually playing. laneProbe is non-null only during the test.
  let laneProbe = null;
  function setLaneProbe(fn) { laneProbe = fn || null; if (laneProbe) startProbePoll(); else stopProbePoll(); }
  function onLaneInput(lane, source, evTime) {
    if (lane == null || lane < 0 || lane >= LANE_COUNT) return;
    if (laneProbe) { try { laneProbe(lane, source); } catch (e) {} }
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
    return Math.min(odActive ? cap : _tp.comboCap, odActive ? ct + 1 : ct);
  }
  // sustain reached its tail end while held — pay any remaining fraction + a release pop
  function completeHold(lane) {
    const hn = holdNote[lane]; if (!hn) return;
    const rem = Math.max(0, 1 - holdScored[lane]);
    if (rem > 0.001) score += rem * HOLD_TOTAL * curMult();
    holdScored[lane] = 1; holdNote[lane] = null;
    laneHitPulse[lane] = 1.0; lanePluckT[lane] = 0;
    spawnHitParticles(lane, 'great');
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
      combo = 0;
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
    window.__rrDebug = {
      state: () => state,
      jt: () => (state === 'playing' ? +(songTime() - audioOffset).toFixed(3) : null),
      score: () => Math.floor(score),
      nextHold: () => { const j = songTime() - audioOffset; const h = notes.find(n => n.type === 'hold' && !n.judged && n.time > j - 0.05); return h ? { lane: h.lane, time: +h.time.toFixed(3), inSec: +(h.time - j).toFixed(3), hold: +h.hold.toFixed(2) } : null; },
      holding: () => holdNote.map((h, i) => h ? { lane: i, scored: +holdScored[i].toFixed(2) } : null).filter(Boolean),
      press: (lane) => { if (state === 'playing') { laneDown[lane] = true; onLaneInput(lane, 'key', performance.now()); } },
      release: (lane) => onLaneRelease(lane),
      chargeOd: () => { overdrive = 1; updateHUD(); return overdrive; },
      od: () => ({ overdrive: +overdrive.toFixed(2), active: odActive, timer: +odTimer.toFixed(2), ready: overdrive >= 1 && !odActive }),
      audio: () => ({ musicVol: +musicVol.toFixed(2), curGain: +curGain.toFixed(3), nodeGain: (player && player.gain) ? +player.gain.gain.value.toFixed(3) : null, muted, sfx: +SFX_LEVEL.toFixed(3) }),
      lanes: () => ({ down: laneDown.slice(), pulse: lanePulse.map(v => +v.toFixed(2)), pluck: lanePluckT.map(v => +v.toFixed(2)) })
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
    zone.addEventListener('pointerleave', release);
  });

  const odFlame = $('od-flame');
  function activateOverdrive() {
    if (state !== 'playing' || overdrive < 1 || odActive) return;
    odActive = true; odTimer = OD_DURATION; overdrive = 1;
    scanT = scanDur = 0.62; scanTier = 3;   // big activation scan sweep up the whole guitar
    bgPulse = 1; cameraShake = 10;
    flashJudgment('OVERDRIVE', '#ffd98a');
    if (odFlame) odFlame.classList.add('active');
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
      if (e.key === 'Enter') { e.preventDefault(); $('play-btn').click(); }
      return;
    }
    // results screen: keyboard flow so you can chain runs without the mouse
    if (state === 'results') {
      if (e.key === 'Enter') { e.preventDefault(); const b = $('results-replay'); if (b) b.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); const b = $('results-menu'); if (b) b.click(); }
      return;
    }
    if (state === 'playing' || state === 'paused') {
      if (e.key === 'Escape') { if (state === 'playing') pauseGame(); else resumeGame(); return; }
      // Space = activate Overdrive / Star Power (when charged). Restart lives in the pause menu now
      // (Space-to-restart was an accidental run-killer mid-song).
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat && state === 'playing') activateOverdrive(); return; }
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
          if (lane != null && lane >= 0 && lane < LANE_COUNT) { if (state === 'playing') laneDown[lane] = true; onLaneInput(lane, 'gamepad', performance.now()); }
        } else if (!pressed && was) {
          const lane = padMap[b];
          if (lane != null && lane >= 0 && lane < LANE_COUNT) onLaneRelease(lane);
        }
      }
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
    if (!target) { flashJudgment('—', '#8a7f86'); return; }

    // HAZARD: pressing a lane while a BOMB sits in its window penalizes — these are "don't hit".
    if (target.type === 'bomb') {
      target.judged = true; target.hit = 'bomb';
      combo = 0; lastMult = 1;
      stability = Math.max(0, stability - bossDrain(0.06));
      glitchAmount = Math.min(1, glitchAmount + 0.25);
      cameraShake = Math.max(cameraShake, 9);
      registerMissFx(lane);
      playMissSfx();   // squelch (music level stays full — no ducking)
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

    target.judged = true; target.hit = kind;
    counts[kind]++; combo++; if (combo > maxCombo) maxCombo = combo;
    // combo milestone → LIGHTNING STRIKE (Guitar-Hero-style streak reward)
    if (combo > 0 && combo % 25 === 0) {
      const tier = combo / 25;                                  // 1, 2, 3, … — escalates with the streak
      lightningT = Math.min(0.55, 0.3 + tier * 0.05);
      scanT = scanDur = 0.42; scanTier = tier;   // combo-milestone scan sweep, brighter with the streak
      cameraShake = Math.max(cameraShake, 11 + Math.min(9, tier * 2));
      bgPulse = 1;
      const big = combo % 100 === 0;                            // every 100 is a bigger moment
      flashJudgment(combo + (big ? ' STREAK!!' : ' STREAK'), big ? '#fff2cd' : '#ffe08a');
      if (navigator.vibrate) { try { navigator.vibrate(big ? [12, 18, 12, 18, 12] : [10, 20, 10]); } catch (e) {} }
    }
    const _tpM = timingProf();
    const comboTier = Math.min(_tpM.comboCap, 1 + Math.floor(combo / _tpM.comboStep));
    const _capM = _tpM.comboCap + 1;                                  // overdrive = +1 tier
    const mult = Math.min(odActive ? _capM : _tpM.comboCap, odActive ? comboTier + 1 : comboTier);
    score += JUDGE[kind].score * mult;
    lastMult = mult;
    laneHitPulse[lane] = 1.0;
    overdrive = Math.min(1, overdrive + (target.type === 'star' ? 0.14 : 0.022)); // charge the meter
    lanePluckT[lane] = 0;                 // pluck the string in this lane
    if (muteUntil > 0) { muteUntil = -1; applyGate(); }  // a clean hit recovers the music
    stability = Math.min(1.0, stability + 0.01);
    spawnHitParticles(lane, kind);
    flashJudgment(JUDGE[kind].name, JUDGE[kind].color);
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
      score += JUDGE.great.score * curMult();
      laneHitPulse[n.lane] = 1.0; lanePluckT[n.lane] = 0;
      spawnHitParticles(n.lane, 'great');
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
        }
      } catch (e) {}
    }
    if (navigator.vibrate) { try { navigator.vibrate([22, 40, 22]); } catch (e) {} }
  }
  function missNote(note) {
    note.judged = true; note.hit = 'miss';
    counts.miss++; combo = 0;
    // music stays at FULL level (no ducking) — the miss is signalled by the squelch SFX +
    // a dull "dud" spatter on the missed string (Guitar-Hero "clam" feel).
    stability = Math.max(0, stability - bossDrain(0.04));
    glitchAmount = Math.min(1, glitchAmount + 0.10);
    cameraShake = Math.max(cameraShake, 4);
    registerMissFx(note.lane);
    playMissSfx();
    spawnMissDud(note.lane);
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

  function spawnHitParticles(lane, kind) {
    const _fg = fretGeom(); const laneX = _fg.nearX[lane]; const hitY = _fg.nearY; const color = LANE_COLORS[lane];
    const isPerfect = kind === 'perfect';
    const burst = isPerfect ? '255,255,255' : color.rgb;
    const n = kind === 'perfect' ? 22 : kind === 'great' ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
      const spd = 130 + Math.random() * 340 * (isPerfect ? 1.3 : 1);
      particles.push({ x: laneX + (Math.random() - 0.5) * 22, y: hitY,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: 0.5 + Math.random() * 0.5, age: 0, size: 1.5 + Math.random() * 3,
        color: Math.random() < 0.5 ? burst : color.rgb, spark: true });
    }
    particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.45, color: color.rgb, max: 90 });
    if (isPerfect) {
      particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.6, color: '255,255,255', max: 130 });
      particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.55, color: '255,72,78', max: 210 });  // crimson shockwave — perfects "crack"
    }
    particles.push({ column: true, x: laneX, y: hitY, age: 0, life: 0.34, color: color.rgb, w: _fg.lw });
    // shard fragments — the rock breaks apart on impact
    for (let i = 0; i < 7; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const spd = 140 + Math.random() * 300 * (isPerfect ? 1.25 : 1);
      particles.push({ frag: true, x: laneX + (Math.random() - 0.5) * 16, y: hitY, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 18, size: 4 + Math.random() * 7, life: 0.45 + Math.random() * 0.4, age: 0, color: color.rgb });
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

  function flashJudgment(text, color) {
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
  window.RhythmGame.setTimingHint = (on) => { timingHint = !!on; try { localStorage.setItem('rr_timinghint', on ? '1' : '0'); } catch (e) {} return timingHint; };
  window.RhythmGame.setTimingFeel = (f) => { if (f === 'tight' || f === 'classic') { timingFeel = f; try { localStorage.setItem('rr_timing', f); } catch (e) {} } return timingFeel; };
  window.RhythmGame.getTimingFeel = () => timingFeel;
  // Variety system on/off mirrors the existing ?notes flag (one source of truth).
  window.RhythmGame.getNoteVariety = () => noteVariety;
  window.RhythmGame.setNoteVariety = (on) => (typeof window.__rrNoteVariety === 'function') ? window.__rrNoteVariety(on) : noteVariety;

  // ---------- HUD ----------
  function updateHUD() {
    $('hud-score').textContent = Math.floor(scoreDisplay).toLocaleString();   // animated value (loop rolls it up)
    $('hud-combo').textContent = combo;
    $('hud-maxcombo').textContent = maxCombo;
    const total = counts.perfect + counts.great + counts.good + counts.miss;
    const acc = total > 0 ? ((counts.perfect * 1.0 + counts.great * 0.85 + counts.good * 0.5) / total) * 100 : 100;
    $('hud-acc').textContent = acc.toFixed(1) + '%';
    // mobile compact HUD
    $('m-score').textContent = Math.floor(score).toLocaleString();
    $('m-combo').textContent = combo;
    $('m-acc').textContent = acc.toFixed(0) + '%';
    // live multiplier gauge — reflects the actual score multiplier (combo + overdrive)
    const _tpH = timingProf();
    const comboTier = Math.min(_tpH.comboCap, 1 + Math.floor(combo / _tpH.comboStep));
    const tier = Math.min(odActive ? _tpH.comboCap + 1 : _tpH.comboCap, odActive ? comboTier + 1 : comboTier);
    const _atCap = combo >= _tpH.comboStep * _tpH.comboCap;
    const within = odActive ? overdrive : (_atCap ? 1 : (combo % _tpH.comboStep) / _tpH.comboStep);
    const mb = $('mult-badge'); if (mb) mb.textContent = tier + 'x';
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
    if (combo >= 10) { cd.classList.add('show'); $('combo-num').textContent = combo; }
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

  let lastFrame = performance.now();
  function loop() {
    rafId = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (state === 'paused') { render(dt, true); return; }
    if (state !== 'playing') return;

    pollGamepad();              // poll at frame-top so a controller/guitar press is judged this frame
    const t = songTime();
    const jt = t - audioOffset;
    const diff = DIFFICULTY[difficulty];
    for (const n of notes) {
      if (n.judged || jt <= n.time + diff.hitWindow) continue;
      if (n.type === 'bomb') { n.judged = true; n.hit = 'avoided'; }   // dodged the hazard — safe, no penalty
      else missNote(n);
    }

    // ---- sustain (hold) scoring: a struck hold pays out continuously while held ----
    let sustaining = false;
    for (let i = 0; i < LANE_COUNT; i++) {
      const hn = holdNote[i]; if (!hn) continue;
      const end = hn.time + hn.hold;
      if (jt >= end) { completeHold(i); continue; }       // reached the tail end → full payout + pop
      if (!laneDown[i]) { endHoldEarly(i); continue; }    // let go early → stop paying (no combo break)
      const frac = Math.max(0, Math.min(1, (jt - hn.time) / hn.hold));
      const gain = frac - holdScored[i];
      if (gain > 0) { score += gain * HOLD_TOTAL * curMult(); holdScored[i] = frac; sustaining = true; }
      // keep the lane alive: string keeps ringing, catcher glows, sparks trickle up
      lanePluckT[i] = Math.min(lanePluckT[i], 0.06);
      laneHitPulse[i] = Math.max(laneHitPulse[i], 0.35);
      holdSparkT[i] += dt;
      if (holdSparkT[i] >= 0.09) { holdSparkT[i] = 0; spawnSustainSpark(i); }
    }
    if (sustaining) updateHUD();

    if (t > songDuration + 0.6) { endGame(); return; }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      if (!p.ring && !p.column) { p.vy += 480 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      if (p.frag) p.rot += p.vrot * dt;
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
    if ((failMode || bossMode) && state === 'playing' && stability <= 0 && !runFailed) failRun();
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
      if (odTimer <= 0) { odActive = false; overdrive = 0; if (odFlame) odFlame.classList.remove('active', 'ready'); }
    }
    applyGate(); // expire miss-dropouts so the music returns
    for (const n of notes) { if (!n._pulsed && Math.abs(n.time - t) < dt) { n._pulsed = true; bgPulse = Math.min(1, bgPulse + 0.5); } }
    // reactive intensity: density of beats around "now" (the music builds the world)
    let dens = 0;
    for (const n of notes) { const d = n.time - t; if (d > -0.6 && d < 1.4) dens += (0.5 + Math.min(1, n.strength * 0.4)); }
    energyTarget = Math.min(1, dens / 9);
    energy += (energyTarget - energy) * Math.min(1, dt * 3);
    if (odActive) energy = Math.min(1, energy + 0.3);

    const p = Math.max(0, Math.min(1, t / songDuration));
    $('hud-progress').style.width = (p * 100) + '%';
    $('m-progress').style.width = (p * 100) + '%';
    $('hud-time').textContent = fmtTime(Math.max(0, t)) + ' / ' + fmtTime(songDuration);

    render(dt, false);
  }

  function fmtTime(s) { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return m + ':' + (sec < 10 ? '0' : '') + sec; }

  function render(dt, isPaused) {
    if (cw === 0) return;
    const t = songTime();
    const approach = DIFFICULTY[difficulty].approach / userScroll;
    const sx = (Math.random() - 0.5) * cameraShake, sy = (Math.random() - 0.5) * cameraShake;
    ctx.save(); ctx.translate(sx, sy);
    ctx.clearRect(0, 0, cw, ch);
    drawCathedralBg(t);

    // ---- fret-board geometry: strings / catchers / notes are LOCKED to the
    // guitar art (derived from its drawn rect + measured string positions) ----
    const fg = fretGeom();
    const nearX = fg.nearX, farX = fg.farX, nearY = fg.nearY, farY = fg.farY;
    const lw = fg.lw;
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
    if (zFar > 1 && !reduceMotion && !fxLite) {
      const NF = 9, fretSpeed = 0.5;
      for (let k = 0; k < NF; k++) {
        const dk = ((k / NF - t * fretSpeed) % 1 + 1) % 1;
        const yy = noteY(dk);
        ctx.strokeStyle = 'rgba(255,96,72,' + (0.04 + 0.18 * (1 - P(dk))).toFixed(3) + ')';
        ctx.lineWidth = 0.5 + 2 * depthScale(dk);
        ctx.beginPath(); ctx.moveTo(noteX(0, dk), yy); ctx.lineTo(noteX(LANE_COUNT - 1, dk), yy); ctx.stroke();
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
      const r = Math.round(baseR + (150 - baseR) * dz);
      const g = Math.round(baseG + (150 - baseG) * dz);
      const b = Math.round(baseB + (150 - baseB) * dz);
      const sAlpha = (0.24 + live * 0.6) * (1 - 0.55 * dz) * (1 - 0.5 * cold);
      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + sAlpha.toFixed(3) + ')';
      ctx.lineWidth = 1.6 + live * 2.6 + hI * 1.6;
      ctx.shadowColor = dz > 0.3 ? '#6b6360' : (hI > 0.5 ? '#ff7a2a' : '#ff2a30');
      ctx.shadowBlur = (7 + live * 18 + hI * 14) * (1 - 0.4 * cold);
      ctx.beginPath();
      const undu = Math.max(pl, heat * 0.5);                  // hot strings shimmer even un-plucked
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
      // crimson comet trail streaming up the string behind the sphere (approaching only)
      if (!held) {
        const dTail = Math.min(1.04, d + 0.2);
        const tx = noteX(n.lane, dTail), ty = noteY(dTail);
        const rgb = n.type === 'star' ? '255,150,60' : '255,40,46';
        const grad = ctx.createLinearGradient(nx, ny, tx, ty);
        grad.addColorStop(0, 'rgba(' + rgb + ',' + (0.5 * sc) + ')');
        grad.addColorStop(0.5, 'rgba(' + rgb + ',' + (0.18 * sc) + ')');
        grad.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = grad;
        ctx.lineWidth = lw * 0.46 * sc * 0.7;
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(' + rgb + ',0.7)'; ctx.shadowBlur = 8 * sc;
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
        const wB = lw * 0.30 * (0.7 + 0.3 * sc);             // slim beam (no fat slab)
        const aM = resolving ? 0.32 : (lit ? 1 : 0.8);       // dropped beam = dim & dying
        ctx.save(); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
        ctx.shadowColor = resolving ? '#6e0f15' : '#ff2a30';
        const beam = (w, col, blur) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.shadowBlur = blur; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(hx, hy); ctx.stroke(); };
        // feathered crimson glow — wide & soft → tighter & brighter (additive = soft edges)
        beam(wB * 2.1, 'rgba(255,38,46,' + (0.14 * aM) + ')', 20);
        beam(wB * 1.3,  'rgba(255,52,54,' + (0.30 * aM) + ')', 11);
        beam(wB * 0.78, 'rgba(255,104,84,' + (0.52 * aM) + ')', 6);
        if (!resolving) {
          // molten pulses flowing DOWN the beam toward the catcher (animated dashes) — alive only while playable
          ctx.shadowBlur = 8;
          ctx.strokeStyle = 'rgba(255,184,120,' + (lit ? 0.9 : 0.5) + ')';
          ctx.lineWidth = wB * 0.62;
          ctx.setLineDash([wB * 0.85, wB * 2.4]);
          ctx.lineDashOffset = -((performance.now() * 0.22) % 100000);  // scroll toward the head
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(nx, ny); ctx.stroke();
          ctx.setLineDash([]);
        }
        // hot white core thread (cool & faint when dropped)
        beam(Math.max(1.1, wB * 0.2), 'rgba(255,242,236,' + (resolving ? 0.26 : (lit ? 0.95 : 0.62)) + ')', 4);
        ctx.restore();
      }
      if (!resolving) drawNote(nx, ny, lw * 0.46 * sc, n);
    }

    for (const p of particles) {
      const a = 1 - p.age / p.life;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (p.ring) {
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
      } else {
        ctx.fillStyle = 'rgba(' + p.color + ',' + a + ')';
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }

    // ambient dust drifting toward the player (depth + speed)
    // (ambient embers come from the background image now)

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

    // OVERDRIVE window: warm gold edge-glow framing the whole screen (on-brand, warm,
    // additive so it never reads purple). Pulses unless reduce-motion is on.
    if (odActive) {
      const pulse = reduceMotion ? 0.5 : (0.5 + 0.5 * Math.sin(performance.now() / 140));
      const a = 0.14 + 0.13 * pulse;
      const og = ctx.createRadialGradient(cw / 2, ch * 0.5, ch * 0.34, cw / 2, ch * 0.5, ch * 0.8);
      og.addColorStop(0, 'rgba(255,200,120,0)');
      og.addColorStop(1, 'rgba(255,180,90,' + a.toFixed(3) + ')');
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = og; ctx.fillRect(0, 0, cw, ch);
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
    // crisp rim
    hexPathOn(x, cx, cy, r, 0.94); x.lineWidth = Math.max(1.4, base * 0.04); x.strokeStyle = 'rgba(255,255,255,0.92)'; x.stroke();
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
    gfx = { lw: lw, base: base, sphere: buildSphere(base, false), sphereHot: buildSphere(base, true) };
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

  // glowing fret-catcher ring (the "button") at the bottom of a string.
  // `press` (0..1) pushes the button DOWN into the bridge and squashes it, like a
  // real fret button being struck; `pulse` lights it up.
  function drawCatcher(x, y, r, color, pulse, breathe, press) {
    press = press || 0;
    const sc = 1 - press * 0.16;              // squash on press
    const w = r * 2.6 * sc, h = w * 0.6;
    const dy = press * r * 0.75;              // push down into the bridge
    const lit = (color.c === '#e0a93f') ? ringGold : ringWhite;
    const glow = Math.max(pulse, press);
    ctx.save(); ctx.translate(x, y + dy);
    if (ringRed._ready) ctx.drawImage(ringRed, -w / 2, -h / 2, w, h);
    if (glow > 0.02 && lit._ready) {
      ctx.save(); ctx.globalAlpha = Math.min(1, glow * 1.25); ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(lit, -w / 2, -h / 2, w, h); ctx.restore();
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
    const img = note.type === 'star' ? noteStarImg : noteImg;
    let S = w * 1.3;
    if (note.type === 'accent') S *= 1.12;
    if (img && img._ready) ctx.drawImage(img, cx - S / 2, y - S / 2, S, S);
    else { ctx.fillStyle = '#141016'; ctx.beginPath(); ctx.arc(cx, y, w * 0.5, 0, Math.PI * 2); ctx.fill(); }
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
    ctx.fillStyle = 'rgba(255,46,24,' + (0.10 + 0.14 * pulse) + ')';
    ctx.beginPath(); ctx.arc(cx, y, r * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createRadialGradient(cx - r * 0.3, y - r * 0.32, r * 0.1, cx, y, r);
    g.addColorStop(0, '#3a1216'); g.addColorStop(1, '#080304');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.strokeStyle = 'rgba(255,64,40,' + (0.55 + 0.45 * pulse) + ')';
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
  function drawComboEnergy(t, fg) {
    if (state !== 'playing') return;
    if (reduceMotion || fxLite) return;
    if (!activeGuitarImg || !activeGuitarImg._ready) return;
    const gr = guitarRect();
    const mult = curMult();
    const capN = (timingProf().comboCap || 3) + 1;
    const tierF = Math.max(0, Math.min(1, (mult - 1) / Math.max(1, capN - 1)));
    if (mult < 2 && combo < 8) return;
    const inten = Math.max(tierF, Math.min(1, combo / 60));
    const warm = Math.round(110 + tierF * 90);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bands = 2 + Math.round(tierF * 2);
    for (let b = 0; b < bands; b++) {
      const ph = (t * (0.16 + tierF * 0.34) + b / bands) % 1;
      const by = gr.gy + gr.gh * (0.14 + ph * 0.84), bh = gr.gh * (0.12 + tierF * 0.05);
      const a = (0.10 + 0.30 * inten) * Math.sin(ph * Math.PI);
      if (a <= 0.003) continue;
      const eg = ctx.createLinearGradient(0, by - bh, 0, by + bh);
      eg.addColorStop(0, 'rgba(255,' + warm + ',70,0)');
      eg.addColorStop(0.5, 'rgba(255,' + warm + ',72,' + a.toFixed(3) + ')');
      eg.addColorStop(1, 'rgba(255,90,60,0)');
      ctx.fillStyle = eg; ctx.fillRect(gr.gx, by - bh, gr.gw, bh * 2);
    }
    if (inten > 0.02) {
      const wash = ctx.createLinearGradient(0, fg.farY, 0, fg.nearY);
      const wa = (0.04 + 0.12 * inten).toFixed(3);
      wash.addColorStop(0, 'rgba(255,' + warm + ',70,0)');
      wash.addColorStop(0.55, 'rgba(255,' + warm + ',72,' + wa + ')');
      wash.addColorStop(1, 'rgba(255,120,80,0)');
      ctx.fillStyle = wash; ctx.fillRect(gr.gx, fg.farY, gr.gw, fg.nearY - fg.farY);
    }
    if (inten > 0.15) {
      const rimA = (0.05 + 0.25 * inten).toFixed(3);
      const rw = Math.max(6, gr.gw * 0.06);
      const lg = ctx.createLinearGradient(gr.gx, 0, gr.gx + rw, 0);
      lg.addColorStop(0, 'rgba(255,40,46,' + rimA + ')'); lg.addColorStop(1, 'rgba(255,40,46,0)');
      ctx.fillStyle = lg; ctx.fillRect(gr.gx, gr.gy, rw, gr.gh);
      const rg = ctx.createLinearGradient(gr.gx + gr.gw, 0, gr.gx + gr.gw - rw, 0);
      rg.addColorStop(0, 'rgba(255,40,46,' + rimA + ')'); rg.addColorStop(1, 'rgba(255,40,46,0)');
      ctx.fillStyle = rg; ctx.fillRect(gr.gx + gr.gw - rw, gr.gy, rw, gr.gh);
    }
    ctx.restore();
  }
  function drawCathedralBg(t) {
    // ---- VS3: reactive atmosphere behind the guitar (god-rays, haze, embers) ----
    const intensity0 = Math.max(bgPulse, energy * 0.85);
    if (!fxLite && !reduceMotion) {
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
      if (gwarp > 0) {
        // NECK-RECEDE WARP: slice the guitar into horizontal bands and narrow each toward the centerline
        // by the SAME (1 - warp*u) factor the lanes use, so the painted strings recede WITH the note lanes
        // (they stay aligned). u: 0 at the bridge row → 1 at the nut row (matches warpX). Body below the
        // bridge (u<0) is left full-width. gh-only; standard takes the plain single drawImage below.
        const nY = gr.gy + ART.bridgeFY * gr.gh, fY = gr.gy + ART.nutFY * gr.gh;
        const cX = gr.gx + 0.5 * gr.gw, NS = 64, iw = activeGuitarImg.width, ih = activeGuitarImg.height;
        for (let s = 0; s < NS; s++) {
          const v0 = s / NS, v1 = (s + 1) / NS;
          const dy0 = gr.gy + v0 * gr.gh, dy1 = gr.gy + v1 * gr.gh;
          const u = ((dy0 + dy1) / 2 - nY) / (fY - nY);          // 0 bridge .. 1 nut
          const sx = 1 - gwarp * Math.max(0, u);
          const dw = gr.gw * sx;
          ctx.drawImage(activeGuitarImg, 0, v0 * ih, iw, (v1 - v0) * ih, cX - dw / 2, dy0, dw, (dy1 - dy0) + 0.8);
        }
      } else {
        ctx.drawImage(activeGuitarImg, gr.gx, gr.gy, gr.gw, gr.gh);
      }
      // fade the headstock (top of the guitar) into the moon so the neck top doesn't hard-cut
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      // gh cover-fit crops the headstock off-screen → fade the top of the SCREEN into the moon (neck dissolves at the top edge)
      const coverFit = (ART.fit === 'cover');
      const fadeTop = coverFit ? -4 : gr.gy, fadeBot = coverFit ? ch * 0.22 : (gr.gy + gr.gh * 0.20);
      const nf = ctx.createLinearGradient(0, fadeTop, 0, fadeBot);
      nf.addColorStop(0, 'rgba(0,0,0,1)'); nf.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = nf; ctx.fillRect(0, fadeTop - 4, cw, (fadeBot - fadeTop) + 8); ctx.restore();
      // gh: a soft glowing spawn band where notes emerge from the fade (the strings "light up" at the far end)
      if (coverFit) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const sg2 = ctx.createLinearGradient(0, ch * 0.16, 0, ch * 0.34);
        sg2.addColorStop(0, 'rgba(255,70,60,0)'); sg2.addColorStop(0.45, 'rgba(255,95,72,0.13)'); sg2.addColorStop(1, 'rgba(255,70,60,0)');
        ctx.fillStyle = sg2; ctx.fillRect(0, ch * 0.16, cw, ch * 0.18); ctx.restore();
      }
      // OVERDRIVE / combo SCAN — an additive amber→crimson band sweeps up the guitar (GH Star-Power wash)
      if (scanT > 0) {
        const fg = fretGeom();
        const prog = Math.max(0, Math.min(1, 1 - scanT / scanDur));   // 0 (catcher) → 1 (nut)
        const sweepY = fg.nearY + (fg.farY - fg.nearY) * prog;
        const bandH = gr.gh * 0.14;
        const a = Math.sin(prog * Math.PI) * (0.30 + 0.10 * Math.min(3, scanTier));
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const sg = ctx.createLinearGradient(0, sweepY - bandH, 0, sweepY + bandH);
        sg.addColorStop(0, 'rgba(255,138,43,0)');
        sg.addColorStop(0.5, 'rgba(255,180,90,' + a.toFixed(3) + ')');
        sg.addColorStop(1, 'rgba(255,60,60,0)');
        ctx.fillStyle = sg; ctx.fillRect(gr.gx, sweepY - bandH, gr.gw, bandH * 2);
        ctx.globalAlpha = Math.min(1, a * 1.5); ctx.fillStyle = 'rgba(255,224,150,0.9)';
        ctx.fillRect(gr.gx, sweepY - 1.5, gr.gw, 3);
        ctx.restore();
      }
      // OVERDRIVE ACTIVE: a living, COLOR-CYCLING energy wash over the board (amber↔crimson, beat-pulsed)
      // so boost feels alive and varied — not a static yellow line. Additive; brand-warm (no blue).
      if (odActive) {
        const ph = t * 1.4, beat = 0.5 + 0.5 * Math.sin(t * 8);
        const cg = Math.round(110 + 70 * Math.sin(ph)), cb = Math.round(50 + 30 * Math.sin(ph + 1.2));
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const owash = ctx.createLinearGradient(0, gr.gy + gr.gh * 0.3, 0, gr.gy + gr.gh);
        const aa = (0.05 + 0.06 * beat).toFixed(3);
        owash.addColorStop(0, 'rgba(255,' + cg + ',' + cb + ',0)');
        owash.addColorStop(0.7, 'rgba(255,' + cg + ',' + cb + ',' + aa + ')');
        owash.addColorStop(1, 'rgba(255,' + cg + ',' + cb + ',0)');
        ctx.fillStyle = owash; ctx.fillRect(gr.gx, gr.gy + gr.gh * 0.3, gr.gw, gr.gh * 0.7);
        ctx.restore();
      }
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
  function resetKeys() { keyMap = Object.assign({}, DEFAULT_KEY_MAP); saveKeyMap(); renderKeycaps(); updateInputsStatus(); updateFooterHint(); }
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
  function bindLaneButton(lane, b) {
    for (const k in padMap) if (padMap[k] === lane) delete padMap[k];   // each lane keeps one button
    delete padMap[b];                                                   // each button maps to one lane
    padMap[b] = lane;
    savePadMap(); renderPadcaps(); renderDeviceStatus();
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

  // ---- controllers & MIDI: live status + input test ----
  function updateInputsStatus() {
    const el = $('set-inputs'); if (!el) return;
    const keys = []; for (let l = 0; l < LANE_COUNT; l++) keys.push(keyGlyph(keyForLane(l)));
    el.textContent = 'Touch · Keys ' + keys.join(' ');
  }
  function renderDeviceStatus() {
    const el = $('set-devices'); if (!el) return;
    const rows = [['Keyboard', 'Ready', true]];
    if (!navigator.requestMIDIAccess) rows.push(['MIDI', 'Unsupported browser', false]);
    else rows.push(['MIDI', midiInputs.length ? midiInputs.join(', ') : 'No device detected', midiInputs.length > 0]);
    const pads = gamepadList();
    rows.push(['Controller', pads.length ? pads[0].slice(0, 26) : 'No device detected', pads.length > 0]);
    el.innerHTML = rows.map(r => '<div class="dev-row"><span class="dev-n">' + r[0] + '</span><span class="dev-v' + (r[2] ? ' ok' : '') + '">' + escDev(r[1]) + '</span></div>').join('');
  }
  function escDev(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function setTest(on) {
    const pips = $('set-test-pips'), btn = $('set-test-btn');
    if (btn) { btn.textContent = on ? 'STOP TEST' : 'TEST INPUT'; btn.classList.toggle('active', on); }
    if (pips) pips.style.display = on ? 'grid' : 'none';
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
    { const rm = $('set-rm'); if (rm) [...rm.children].forEach(b => b.classList.toggle('active', (b.dataset.rm === 'on') === s.reduceMotion)); }
    { const ff = $('set-fail'); if (ff) [...ff.children].forEach(b => b.classList.toggle('active', (b.dataset.fail === 'on') === !!s.failMode)); }
    { const cf = $('set-chart'); if (cf) [...cf.children].forEach(b => b.classList.toggle('active', b.dataset.chart === (s.chartMode || 'classic'))); }
    { const tg = $('set-timing'); if (tg) [...tg.children].forEach(b => b.classList.toggle('active', b.dataset.timing === window.RhythmGame.getTimingFeel())); }
    { const nv = $('set-notes'); if (nv) { const on = window.RhythmGame.getNoteVariety(); [...nv.children].forEach(b => b.classList.toggle('active', (b.dataset.notes === 'on') === on)); } }
    { const th = $('set-timinghint'); if (th) { const on = (localStorage.getItem('rr_timinghint') !== '0'); [...th.children].forEach(b => b.classList.toggle('active', (b.dataset.thint === 'on') === on)); } }
    { const bg = $('set-bg'); if (bg) [...bg.children].forEach(b => b.classList.toggle('active', (b.dataset.bg === 'performance') === (s.bgMode === 'performance'))); }
    { const lm = $('set-lanemode'); if (lm) [...lm.children].forEach(b => b.classList.toggle('active', b.dataset.lanemode === laneProfile)); }
    renderKeycaps(); renderPadcaps(); updateInputsStatus(); renderDeviceStatus();
    settingsScreen.classList.add('active');
  }
  function closeSettings() { setTest(false); cancelRebind(); cancelPadRebind(); settingsScreen.classList.remove('active'); }
  $('calib-open').addEventListener('click', openSettings);
  // ---------- How to Play (note-type legend) ----------
  { const ho = $('howto-open'), hs = $('howto-screen'), hc = $('howto-close');
    if (ho && hs) ho.addEventListener('click', () => hs.classList.add('active'));
    const closeHowto = () => { if (hs) hs.classList.remove('active'); try { localStorage.setItem('rr_howto_seen', '1'); } catch (e) {} };
    if (hc) hc.addEventListener('click', closeHowto);
    { const hcal = $('howto-calibrate'); if (hcal) hcal.addEventListener('click', () => { closeHowto(); openCalib(); }); }
    if (hs) hs.addEventListener('click', (e) => { if (e.target === hs) closeHowto(); });   // click backdrop to dismiss
    // first-time players get it once, automatically
    try { if (hs && !localStorage.getItem('rr_howto_seen')) setTimeout(() => hs.classList.add('active'), 800); } catch (e) {}
  }
  $('set-close').addEventListener('click', closeSettings);
  $('set-calibrate').addEventListener('click', () => { closeSettings(); openCalib(); });
  $('set-scroll').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value); $('set-scroll-v').textContent = v.toFixed(1) + '×';
    window.RhythmGame.applySettings({ scroll: v });
  });
  { const m = $('set-music'); if (m) m.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value); const mv = $('set-music-v'); if (mv) mv.textContent = Math.round(v * 100) + '%';
    window.RhythmGame.applySettings({ music: v });
  }); }
  { const x = $('set-sfx'); if (x) x.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value); const xv = $('set-sfx-v'); if (xv) xv.textContent = Math.round((v / 0.5) * 100) + '%';
    window.RhythmGame.applySettings({ sfx: v });
  }); }
  [...$('set-fx').children].forEach(b => b.addEventListener('click', () => {
    [...$('set-fx').children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.applySettings({ fxLite: b.dataset.fx === 'lite' });
  }));
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
  window.addEventListener('gamepadconnected', () => { if (settingsScreen.classList.contains('active')) renderDeviceStatus(); });
  window.addEventListener('gamepaddisconnected', () => { if (settingsScreen.classList.contains('active')) renderDeviceStatus(); });

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
  });

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
