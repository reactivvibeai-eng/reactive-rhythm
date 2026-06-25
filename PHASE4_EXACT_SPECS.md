# Phase 4 exact specs (workflow w7okwc2e4) — CPU rival + strict-strum + winner-card



## FEATURE: Phase 4a ? Independent shadow-chart CPU rival (decouple NPC score from player score so a real WIN or LOSS is possible)
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\multiplayer.js  (primary)  +  D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js  (1 read-only export line)  +  D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\index.html  (?v bumps only)

### summary:
CONFIRMED BUG (verbatim, multiplayer.js:2869, inside the ghost() rAF in devVsNpc): `lastOppState = { sc: Math.round((stt ? stt.score : 0) * skill + el * 600), cb: stt ? Math.round(stt.combo * skill) : 0, ...}` where `stt = window.RhythmGame.getLiveStats()` (2866) and `skill` defaults to 0.92 (2861). The NPC score is literally the PLAYER's own score x 0.92 plus a tiny time term, so op.sc is always < me.score. showWinner's compare `else if (me.score > op.score) win = true;` (multiplayer.js:1233) therefore ALWAYS resolves WIN. The "final" mirrors the same value: onSongEnd builds `oppFinal = ... score: os.sc || 0` from `lastOppState` (2856-2857). You cannot lose.

FIX (shadow-chart, the Phase4 winner): give the NPC its OWN scoring state object `_npcSim` that never reads the player's score. Drive it off the shared chart via the existing read-only `window.RhythmGame.getGhostNotes()` (game.js:6239) ? each note that crosses the strike line gets an independent `Math.random() < rating` hit/miss roll (rating from difficulty), accumulating `score/combo/hits/misses` on its own. Populate `lastOppState`/`lastOppTick` (deck source) and the final `oppFinal` from `_npcSim`. The winner compare at 1233 is UNCHANGED ? it now yields a genuine win OR loss. oppMeta.bot stays true so a CPU loss never tanks the ranked ladder (the `!(oppMeta && oppMeta.bot)` guard at 1238 already skips recordMpResult for bots).

SCOPE: this lives entirely in multiplayer.js's devVsNpc/ghost()/showWinner-feeding path + ONE additive read-only line in game.js's getGhostNotes pool. It does NOT touch the keyboard scoring path. devVsNpc only runs when explicitly invoked (NPC 1v1 match); solo keyboard play never calls it.

DEDUPE / RISK NOTES grounded in real code: getGhostNotes returns a REUSED 96-entry pool `{lane,d,type}` (game.js:6238-6254) with NO stable per-note key and it culls behind-catcher notes at `d < -0.12` (6249) and skips already-struck notes (6246) ? so keying the seen-Set on `d` alone double-judges. We add ONE additive field `p.t = nn.time` to the pool item (read-only; the render-layer deck consumer at multiplayer.js:933-967 only reads it.lane/it.d/it.type, so the extra field is inert there) and key the seen-Set on `lane + ':' + round(t*1000)`, scoring ONLY on the d-crosses-from->0-to-<=0 transition. Bombs (type===3) = correct play is never-hit ? no combo change. npcMult is clamped to MAX_MULT(=4) so the ghost stays under the notes_total*1500 ceiling.

### EDIT 1 anchorQuote:
```
  var _npcRaf = 0, _npcLastEv = 0;   // dev NPC 1v1: the synthetic-opponent drive loop
```
change: Declare the independent shadow-sim state object + a tiny grade helper right after the existing _npcRaf declaration (module-closure scope, reachable by devVsNpc/teardownMatch/resetForRematch).
newCode:
```
  var _npcRaf = 0, _npcLastEv = 0;   // dev NPC 1v1: the synthetic-opponent drive loop
  // PHASE 4a: the CPU rival's OWN scoring state. NEVER reads the player's score ? it is driven
  // entirely off the shared chart (getGhostNotes) via per-note probabilistic hit/miss rolls, so a
  // genuine WIN or LOSS is possible. Reset at every devVsNpc run start; torn down on match end/rematch.
  var _npcSim = null;
  // per-note hit probability by NPC difficulty. // TUNABLE ? believability dial; raise/lower per playtest.
  function _npcRating(diff) {
    var base = diff === 'easy' ? 0.78 : diff === 'hard' ? 0.965 : 0.90;   // medium default
    return Math.max(0.5, Math.min(0.995, base + (Math.random() - 0.5) * 0.04));   // +-2% per-run jitter so two runs differ
  }
  // local grade ladder ? matches game.js getLiveStats thresholds (no shared helper exists in this file)
  function _npcGrade(accPct) { return accPct >= 95 ? 'S' : accPct >= 88 ? 'A' : accPct >= 75 ? 'B' : accPct >= 60 ? 'C' : 'D'; }
```

### EDIT 2 anchorQuote:
```
    window.RhythmGame.onSongEnd(function () {
      var os = lastOppState || {};
      oppFinal = oppFinal || { name: oppMeta.name, score: os.sc || 0, combo: os.cb || 0, acc: 90, grade: 'A' };
      settleIfReady();
    });
```
change: Build the NPC's final verdict from _npcSim (its independently accumulated score/combo/accuracy), NOT from the mirrored lastOppState. Keep the lastOppState fallback only for the impossible case where _npcSim is null.
newCode:
```
    window.RhythmGame.onSongEnd(function () {
      // PHASE 4a: final verdict from the INDEPENDENT sim (real win OR loss). Fallback to the deck
      // state only if the sim somehow never initialized.
      if (_npcSim) {
        var _acc = _npcSim.total > 0 ? Math.round(_npcSim.hits / _npcSim.total * 1000) / 10 : 0;
        oppFinal = oppFinal || { name: oppMeta.name, score: Math.round(_npcSim.score), combo: _npcSim.maxCombo, acc: _acc, grade: _npcGrade(_acc) };
      } else {
        var os = lastOppState || {};
        oppFinal = oppFinal || { name: oppMeta.name, score: os.sc || 0, combo: os.cb || 0, acc: 90, grade: 'A' };
      }
      settleIfReady();
    });
```

### EDIT 3 anchorQuote:
```
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
```
change: Replace the player-mirroring ghost() loop with the independent shadow-chart sim. It reads ONLY getGhostNotes (the shared chart) + getLiveStats().progress (purely for the rival's progress bar, NEVER its score). Each note that crosses the strike line is dedupe-keyed on lane+rounded-time and rolled against _npcSim.rating. ev sparkles come from the ACTUAL simulated judgments. lastOppState/lastOppTick keep the exact shape the deck consumes (sc/cb/mu/od/oda/st/pr/ev).
newCode:
```
    // PHASE 4a: independent shadow-chart sim. seen-Set dedupes notes by lane+rounded-time; we score on the
    // d-crosses-the-strike-line transition (d goes from >0 to <=0). NO read of the player's score, ever.
    var t0 = performance.now();
    _npcLastEv = 0;
    _npcSim = { rating: _npcRating(_devBotDiff), score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, total: 0, seen: Object.create(null), prevD: Object.create(null), od: 0 };
    if (_npcRaf) cancelAnimationFrame(_npcRaf);
    (function ghost() {
      if (!matchLive || !_npcSim) { _npcRaf = 0; return; }
      var stt = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;   // used ONLY for the rival progress bar
      var el = (performance.now() - t0) / 1000, ev = [];
      var gn = window.RhythmGame.getGhostNotes ? window.RhythmGame.getGhostNotes() : null;
      if (gn && gn.n) {
        for (var gi = 0; gi < gn.n; gi++) {
          var it = gn.items[gi];
          // stable per-note key (lane + rounded chart-time) ? survives the reused 96-entry pool
          var key = it.lane + ':' + Math.round((it.t || 0) * 1000);
          var prev = _npcSim.prevD[key];
          _npcSim.prevD[key] = it.d;
          // a note is JUDGED the frame its d transitions from >0 (above strike line) to <=0 (at/past it)
          if (prev != null && prev > 0 && it.d <= 0 && !_npcSim.seen[key]) {
            _npcSim.seen[key] = 1;
            if (it.type === 3) { continue; }   // bomb: correct play = never hit, no combo change
            _npcSim.total++;
            if (Math.random() < _npcSim.rating) {   // HIT
              _npcSim.combo++;
              if (_npcSim.combo > _npcSim.maxCombo) _npcSim.maxCombo = _npcSim.combo;
              // npcMult: same combo-tier shape as the engine (1 tier / 12 combo), HARD-CLAMPED to MAX_MULT=4
              var npcMult = Math.min(4, 1 + Math.floor(_npcSim.combo / 12));   // TUNABLE: 12 = combo-per-tier
              _npcSim.score += 1500 * npcMult;   // 1500 = engine per-note base (see game.js notes_total*1500 ceiling)
              _npcSim.hits++;
              ev.push({ l: it.lane, j: 'g' });
            } else {   // MISS
              _npcSim.combo = 0; _npcSim.misses++;
              ev.push({ l: it.lane, j: 'm' });
            }
          }
        }
      }
      _npcSim.od = Math.min(1, el / 16);
      // write the deck source in the EXACT shape it consumes (multiplayer.js:932/991/924) ? now from the sim
      lastOppState = { sc: Math.round(_npcSim.score), cb: _npcSim.combo,
        mu: 1, od: _npcSim.od, oda: (el % 20) > 16, st: 1, pr: stt ? stt.progress : Math.min(1, el / 120), ev: ev };
      lastOppTick = { score: lastOppState.sc, combo: lastOppState.cb, prog: lastOppState.pr, name: oppMeta.name };
      _npcRaf = requestAnimationFrame(ghost);
    })();
```

### EDIT 4 anchorQuote:
```
    if (_npcRaf) { cancelAnimationFrame(_npcRaf); _npcRaf = 0; }   // stop the NPC ghost-drive loop
```
change: In teardownMatch, also clear the shadow-sim so a stale CPU score can't leak into the next match. (This exact line appears once in teardownMatch at 1270; the identical-looking line at 1672 is in a different function ? match the trailing comment to target teardownMatch.)
newCode:
```
    if (_npcRaf) { cancelAnimationFrame(_npcRaf); _npcRaf = 0; }   // stop the NPC ghost-drive loop
    _npcSim = null;   // PHASE 4a: drop the CPU rival's independent scoring state on teardown
```

### EDIT 5 anchorQuote:
```
    myFinal = null; oppFinal = null; lastOppTick = null; meReady = false; oppReady = false;
    finishedLocal = false; matchLive = false; setReadyBtn(); setLobbyInMatch(true);
```
change: In resetForRematch, also null the shadow-sim so a rematch's devVsNpc re-seeds a fresh independent run instead of carrying the prior CPU score.
newCode:
```
    myFinal = null; oppFinal = null; lastOppTick = null; meReady = false; oppReady = false;
    _npcSim = null;   // PHASE 4a: fresh CPU rival sim on rematch (no carryover score)
    finishedLocal = false; matchLive = false; setReadyBtn(); setLobbyInMatch(true);
```

### EDIT 6 anchorQuote:
```
  var _ghostPool = []; for (var _gp = 0; _gp < 96; _gp++) _ghostPool.push({ lane: 0, d: 0, type: 0 });
```
change: game.js: add a stable per-note time field to the reused ghost pool item literal. Read-only/additive ? consumers that ignore `t` are unaffected.
newCode:
```
  var _ghostPool = []; for (var _gp = 0; _gp < 96; _gp++) _ghostPool.push({ lane: 0, d: 0, type: 0, t: 0 });   // PHASE 4a: t = note chart-time, a stable dedupe key for the shadow-chart CPU sim
```

### EDIT 7 anchorQuote:
```
      var p = _ghostPool[n++];
      p.lane = nn.lane; p.d = d;
      p.type = nn.type === 'hold' ? 1 : (nn.chord ? 2 : (nn.type === 'bomb' ? 3 : 0));
```
change: game.js getGhostNotes: populate the new stable time field on each emitted pool item. Pure read ? touches no input/scoring/timing path; the render-layer deck never reads `t`.
newCode:
```
      var p = _ghostPool[n++];
      p.lane = nn.lane; p.d = d;
      p.t = nn.time;   // PHASE 4a: stable per-note key for the CPU rival's independent dedupe (read-only)
      p.type = nn.type === 'hold' ? 1 : (nn.chord ? 2 : (nn.type === 'bomb' ? 3 : 0));
```

### EDIT 8 anchorQuote:
```
<script src="game.js?v=332"></script>
```
change: Bump the game.js cache-bust (the read-only getGhostNotes export changed). Per project law, bump on every game.js edit.
newCode:
```
<script src="game.js?v=333"></script>
```

### EDIT 9 anchorQuote:
```
<script src="multiplayer.js?v=324"></script>
```
change: Bump the multiplayer.js cache-bust (devVsNpc rewritten). Per project law, bump on every multiplayer.js edit.
newCode:
```
<script src="multiplayer.js?v=325"></script>
```

### keyboardSafetyProof:
THE OWNER'S KEYBOARD PATH IS BYTE-IDENTICAL ? proven against the real current code:

1. ZERO edits to the keyboard scoring path. Every edit is in multiplayer.js's devVsNpc/ghost()/onSongEnd-feed/teardown/resetForRematch, plus ONE additive read-only line in game.js getGhostNotes, plus two ?v bumps. The keyboard chain ? keydown listener (game.js:2884-2926, the load-bearing line 2925 `if (k in keyMap) { e.preventDefault(); if (!e.repeat) { laneDown[keyMap[k]] = true; onLaneInput(keyMap[k], 'key', e.timeStamp); } }`), keyup (2929-2932 ? onLaneRelease), onLaneInput (game.js:2694-2699 ? handleHit), handleHit judge/scoring, and buildNotes (timing/order) ? is not touched by a single edit in this spec. node --check confirmable after apply.

2. THE CPU SIM DOES NOT RUN DURING SOLO KEYBOARD PLAY. The entire shadow-sim lives inside devVsNpc's ghost() rAF, and ghost() self-terminates the first frame `!matchLive || !_npcSim` is true. devVsNpc is reachable only via an explicit NPC-1v1 launch (it sets matchId='npc'+n, oppMeta.bot=true, calls beginMatch). A normal solo run from the menu never calls devVsNpc, so _npcSim stays null and the loop never spawns. Verified: matchLive is the match-only gate (set true in beginMatch's match start, false in teardownMatch/settleIfReady); in a solo keyboard session matchLive is false, so even a stray ghost() frame returns immediately.

3. THE getGhostNotes EDIT CANNOT AFFECT KEYBOARD TIMING. getGhostNotes (game.js:6239) is a read-only snapshot function: it reads songTime()/notes[] and writes only into a pre-allocated pool, returning {n, items}. It mutates no note, no score, no combo, no judged flag. Adding `p.t = nn.time` writes one extra number onto a throwaway pool object ? it is read by nothing in the keyboard path (which never calls getGhostNotes at all; only the MP ghost deck + the new CPU sim do). handleHit's own hit-detection (which early-breaks on time-sorted notes) is in a separate code path and is untouched.

4. NO NEW FLAG IS READ BY THE KEYBOARD PATH. This feature adds no settings flag and no strumCfg field (those belong to 4b/4c). It introduces only multiplayer.js-internal state (_npcSim, _npcRating, _npcGrade). The keyboard-reachable Settings surface (applySettings/getSettings) is not modified.

5. THE WINNER COMPARE IS UNCHANGED. showWinner's `me.score > op.score` (multiplayer.js:1233) is not edited ? we only change what feeds op (now _npcSim-derived), so the same compare now yields a real win OR loss. The ranked-record guard `!(oppMeta && oppMeta.bot)` (1238) is unchanged, so a CPU loss still never touches rr_mp_rank.

Regression check after apply: `node --check game.js && node --check multiplayer.js`; grep that no keyMap/keydown line references _npcSim/getGhostNotes; drive __rrDebug.press(lane) in a solo run and confirm score is identical to baseline (the CPU sim is dormant ? matchLive false).

### openQuestions:
1. NPC difficulty ratings (_npcRating: easy 0.78 / medium 0.90 / hard 0.965, +-2% jitter) are playtest dials, not hardware. They set how beatable the CPU feels ? owner should confirm "NIGHT-OWL (CPU)" should be a genuine threat on hard (0.965 ? ~96.5% accuracy, near-S) vs a warm-up on easy. These are TUNABLE constants flagged in-code.

2. npcMult combo-per-tier = 12. The engine's real curMult (game.js:2706-2710) uses a per-timing-profile comboStep (not a flat 12) plus an overdrive tier; I deliberately used a SIMPLE flat 1-tier-per-12-combo clamped to MAX_MULT=4 so the sim is self-contained and cannot reference engine internals. Result: the CPU's score *shape* is plausible but not a byte-for-byte mirror of the player's multiplier curve. If the owner wants the CPU to feel exactly like a human on the same chart, expose the real comboStep via a tiny read-only getter ? otherwise 12 is a reasonable believable default. Owner decision: keep self-contained (recommended) or wire to the real curve.

3. Should the CPU model overdrive scoring? Currently _npcSim.od is cosmetic (drives the rival deck's OD meter only) and never multiplies score. A human in OD gets a bonus tier; the CPU here does not. This keeps the CPU slightly conservative (favors the player), which is arguably the right bias for "CPU warm-ups." Flag for owner: leave CPU OD cosmetic-only (recommended) or add an OD score window.

4. Fast-follow (NOT in this 4a edit, called out in the design plan): the TOURNAMENT bot drives devDriveRival (multiplayer.js:2211-2232) and devDriveBots (multiplayer.js:2767-2795) STILL mirror player score x 0.9 / ramp to a random target ? same class of bug, different surface. They are out of 4a's critical path; migrate to the same shadow-sim in a second pass. Not a blocker for the 1v1 CPU fix.

### verifyNote:
See keyboardSafetyProof + the verify steps above; node --check both files, prove solo keyboard score is byte-identical (CPU sim dormant), then prove a real loss is reachable in an NPC 1v1.


## FEATURE: Phase 4b/4c ? GH STRICT-STRUM (opt-in, default OFF): overstrum penalty + ~35ms chord fret-settle grace, gated to a CONNECTED GH controller via requireStrum() and a strumCfg.strict flag with a Settings toggle. Keyboard path stays byte-identical.
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js (engine/strum/config/UI-wiring) + D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\index.html (Settings toggle markup inside the gh-badge block + ?v bump)

### summary:
All edits live ONLY in game.js sites reachable from pollGamepad()/tryStrum() (gated by requireStrum() = `laneProfile === 'gh' && !!guitarPadId()`, false in any keyboard session) plus a Settings toggle housed inside the GH-only `gh-badge` block. The keyboard scoring path (keydown game.js:2925 -> onLaneInput:2694 -> handleHit:3035, whiff branch :3055) and buildNotes are NOT touched. The new strict flag rides strumCfg (literal at game.js:39-41) via the existing loadStrumCfg/saveStrumCfg (44-45) + the public setStrumCfg setter (game.js:900) -> persisted in rr_strumcfg. It is deliberately NOT added to getSettings (game.js:2129) / applySettings (game.js:2116), so the keyboard-reachable Settings surface stays blind to it. Default strict:false => tryStrum (game.js:2970-2975) is byte-identical to today. CONFIRMED current code: tryStrum's no-fret no-op is `if (_frets.size === 0) return;` (line 2973); the overstrum penalty hooks THERE. The ~35ms fret-settle is a TUNABLE magic number (FRET_SETTLE_MS) ? owner-locked hardware-tune-later (no guitar yet). NOTE: the design plan's claimed strumCfg shape `{ strict:false }` at 39-41 is stale ? the REAL literal is `{ btns:[12,13], strumAxis:null, ... }`; anchors below quote the REAL lines. ?v is 332 today (NOT v327/build90 per the plan) -> bump to 333. SCOPE NOTE: this sub-feature is game.js + index.html only; multiplayer.js is unaffected (strum work never runs in MP solo or CPU-rival paths).

### EDIT 1 anchorQuote:
```
  const STRUM_DEBOUNCE_MS = 55;        // anti-double-strum (strum-up + strum-down both funnel through here)
  let strumCfg = { btns: [12, 13], strumAxis: null, strumAxisDir: 0,
                   whammyAxis: 2, whammyMin: -1, whammyMax: 1,
                   tiltAxis: 3, tiltThresh: 0.6, spBtn: 8 };
```
change: Add the FRET_SETTLE_MS tunable constant (hardware-tune-later) next to STRUM_DEBOUNCE_MS, and add `strict:false` to the strumCfg default literal so it persists via the existing loadStrumCfg/saveStrumCfg in rr_strumcfg. NOTE the plan's anchor (`const STRUM_DEBOUNCE_MS = 55;` // anti-double-strum (strum-up + strum-down funnel through here)) had slightly different comment wording ? this anchor is the REAL current text (verified line 38-41).
newCode:
```
  const STRUM_DEBOUNCE_MS = 55;        // anti-double-strum (strum-up + strum-down both funnel through here)
  // 4b/4c GH STRICT-STRUM (opt-in): chord fret-settle window. ~35ms is a PLACEHOLDER magic number ? owner-locked
  // hardware-tune-later (no guitar in hand yet). Ship default-OFF; dial on a real controller. Live-readable via __rrDebug.strumState().
  const FRET_SETTLE_MS = 35;           // chord grace: frets pressed within this of a strum judge together (TUNABLE)
  let strumCfg = { btns: [12, 13], strumAxis: null, strumAxisDir: 0,
                   whammyAxis: 2, whammyMin: -1, whammyMax: 1,
                   tiltAxis: 3, tiltThresh: 0.6, spBtn: 8,
                   strict: false };   // 4c: GH STRICT mode (default OFF). When ON + requireStrum(): overstrum costs combo + a fret-settle grace runs. Read ONLY inside requireStrum()-gated sites ? never by the keyboard path.
```

### EDIT 2 anchorQuote:
```
  function tryStrum(now) {
    if (now - _lastStrumT < STRUM_DEBOUNCE_MS) return;     // debounce: strum-up + strum-down both land here
    _lastStrumT = now;
    if (_frets.size === 0) return;                         // strum with no fret held = no-op (no phantom hit)
    for (const lane of _frets) onLaneInput(lane, 'guitar', now);   // chord-safe: one hit per held fret, judged at the strum instant
  }
```
change: Rewrite tryStrum so (a) an overstrum (strum with no fret held) under strict mode while playing applies a combo-breaking penalty via the new applyOverstrum() helper; (b) under strict mode a chord fret-settle grace (FRET_SETTLE_MS) snapshots the strum timestamp, waits the grace, then judges the UNION of frets held at strum-time and frets pressed during the window ? all judged at the captured strum instant `now` (not the fire time) so timing never skews. Default (strict:false) reduces EXACTLY to today's two lines: instant no-op on empty frets, instant per-fret judge otherwise. tryStrum is reachable ONLY from pollGamepad/pollGuitarAxes, both requireStrum()-gated => dead code in any keyboard session.
newCode:
```
  let _settleTimer = 0;                 // pending chord fret-settle timer id (strict mode only; cleared at run boundary)
  function tryStrum(now) {
    if (now - _lastStrumT < STRUM_DEBOUNCE_MS) return;     // debounce: strum-up + strum-down both land here
    _lastStrumT = now;
    if (_frets.size === 0) {                               // strum with no fret held
      if (strumCfg.strict && state === 'playing') applyOverstrum();   // 4b-i: STRICT ? a true overstrum costs combo (GH-authentic). Default OFF => today's silent no-op.
      return;
    }
    if (strumCfg.strict) {
      // 4b-ii: chord fret-settle grace. Snapshot the frets held AT the strum (state-stream graft: a fret RELEASED during
      // the window can't drop a chord member), defer ~FRET_SETTLE_MS to absorb near-simultaneous extra frets, then judge
      // the union ALL at the captured strum instant `now` so the whole chord shares one timestamp (no settle-window skew).
      const snapshot = Array.from(_frets);
      if (_settleTimer) { clearTimeout(_settleTimer); _settleTimer = 0; }
      _settleTimer = setTimeout(function () {
        _settleTimer = 0;
        if (state !== 'playing') return;                  // run ended during the grace ? drop it
        const chord = new Set(snapshot);
        for (const lane of _frets) chord.add(lane);        // fold in any frets pressed during the settle window
        for (const lane of chord) onLaneInput(lane, 'guitar', now);   // judge the whole chord at the ORIGINAL strum instant
      }, FRET_SETTLE_MS);
      return;
    }
    for (const lane of _frets) onLaneInput(lane, 'guitar', now);   // chord-safe: one hit per held fret, judged at the strum instant
  }
  // 4b-i overstrum penalty (STRICT + requireStrum() only, fires ONLY off the gamepad strum bar). Deliberately stricter than
  // the keyboard whiff (game.js:3055, which never breaks combo): a phantom strum kills the streak the GH way. No score bleed.
  function applyOverstrum() {
    combo = 0; comboTierCur = 0;        // same combo-break lines the bomb/drop paths use (game.js:2742 / 3066)
    registerMissFx(2);                  // light center-lane miss flash so the penalty reads (lane 2 = middle of 5)
    playMissSfx();                      // squelch (music level stays full ? no ducking)
    flashJudgment('OVERSTRUM', '#ff6b78');
    updateHUD();
  }
```

### EDIT 3 anchorQuote:
```
    _frets.clear();   // GH require-strum: clear held-fret state at every run boundary so a stale fret can't carry into the next run (B78-1)
```
change: At the run-boundary reset (resetScoring, game.js:2193) also cancel any pending chord-settle timer so a deferred strict-mode chord can't fire into the next run (Risk #3 teardown). This line only runs at run boundaries; _settleTimer is 0 in any keyboard/non-strict session so this is a no-op there.
newCode:
```
    _frets.clear();   // GH require-strum: clear held-fret state at every run boundary so a stale fret can't carry into the next run (B78-1)
    if (_settleTimer) { clearTimeout(_settleTimer); _settleTimer = 0; }   // 4b-ii: cancel any pending strict-mode chord-settle so it can't fire into the next run (no-op off strict)
```

### EDIT 4 anchorQuote:
```
      strumState: () => ({ require: requireStrum(), profile: laneProfile, guitar: guitarPadId(), cfg: Object.assign({}, strumCfg), heldFrets: Array.from(_frets) }),
```
change: Extend the existing __rrDebug.strumState dev hook to surface `strict` + `settleMs` so the toggle + grace are inspectable headless (dev hook, stripped at content-freeze). cfg already includes strict via the Object.assign copy; add explicit fields for clarity.
newCode:
```
      strumState: () => ({ require: requireStrum(), profile: laneProfile, guitar: guitarPadId(), strict: !!strumCfg.strict, settleMs: FRET_SETTLE_MS, cfg: Object.assign({}, strumCfg), heldFrets: Array.from(_frets) }),
```

### EDIT 5 anchorQuote:
```
          <span class="gh-badge-name" id="gh-strum-status" style="white-space:normal;max-width:none;"></span>
          </div>
          <button class="ctrl-cta sm" id="gh-setup">Set up my guitar</button>
```
change: Add the STRICT mode segmented toggle INSIDE the #gh-badge block (state-stream graft) so it ONLY renders when a guitar is detected (badge is display:none for keyboard-only players => they never see the control). Mirrors the existing set-fail/set-chart .set-seg markup pattern (index.html:5029-5040). Copy marked hardware-tune-later. NOTE the anchor includes the closing </div> of .gh-badge-txt and the gh-setup button so the new row inserts after the text column and before the CTA, staying within .gh-badge.
newCode:
```
          <span class="gh-badge-name" id="gh-strum-status" style="white-space:normal;max-width:none;"></span>
          </div>
          <button class="ctrl-cta sm" id="gh-setup">Set up my guitar</button>
          <!-- 4c GH STRICT-STRUM toggle (default OFF). Inside #gh-badge => only shown when a guitar is detected; keyboard players never see it. Magnitudes are hardware-tune-later. -->
          <div class="set-row" style="flex-basis:100%;margin-top:8px;">
            <span class="set-l">Strict Strum <span style="color:var(--ink-dim);font-weight:400;">(beta ? tune on a guitar)</span></span>
            <div class="set-seg" id="set-strict">
              <button data-strict="off" class="active">Forgiving</button>
              <button data-strict="on">Strict (GH)</button>
            </div>
          </div>
```

### EDIT 6 anchorQuote:
```
  { const gp = $('set-pad-ghpreset'); if (gp) gp.addEventListener('click', applyGhPreset); }
```
change: Wire the #set-strict segmented toggle, mirroring the set-fail handler pattern (game.js:6121-6124). It writes ONLY through window.RhythmGame.setStrumCfg({strict}) (game.js:900) ? NOT applySettings ? so the keyboard-reachable settings surface never carries the flag. Placed right after the GH preset wiring so it sits with the other controller controls.
newCode:
```
  { const gp = $('set-pad-ghpreset'); if (gp) gp.addEventListener('click', applyGhPreset); }
  // 4c: STRICT-STRUM toggle ? writes via setStrumCfg (rr_strumcfg), NOT applySettings, so the keyboard path never reads it.
  { const st = $('set-strict'); if (st) [...st.children].forEach(b => b.addEventListener('click', () => {
    [...st.children].forEach(x => x.classList.remove('active')); b.classList.add('active');
    window.RhythmGame.setStrumCfg({ strict: b.dataset.strict === 'on' });
  })); }
```

### EDIT 7 anchorQuote:
```
      const ss = $('gh-strum-status'); if (ss) { const on = requireStrum(); ss.textContent = on ? 'REQUIRE STRUM: ON ? hold a fret + strum' : 'REQUIRE STRUM: OFF'; ss.style.color = on ? '#e0a93f' : 'var(--ink-dim)'; }
```
change: When the GH badge renders (renderDeviceStatus, game.js:5982), sync the #set-strict toggle's active button from the persisted strumCfg.strict so re-opening Settings reflects the saved state. Mirrors how openSettings paints set-fail/set-chart (game.js:6023-6024) but reads strumCfg (not getSettings) since strict lives only in strumCfg.
newCode:
```
      const ss = $('gh-strum-status'); if (ss) { const on = requireStrum(); ss.textContent = on ? 'REQUIRE STRUM: ON ? hold a fret + strum' : 'REQUIRE STRUM: OFF'; ss.style.color = on ? '#e0a93f' : 'var(--ink-dim)'; }
      const st = $('set-strict'); if (st) { const strict = !!strumCfg.strict; [...st.children].forEach(b => b.classList.toggle('active', (b.dataset.strict === 'on') === strict)); }   // 4c: reflect persisted strict state
```

### EDIT 8 anchorQuote:
```
<script src="game.js?v=332"></script>
```
change: Bump the game.js cache-bust from v332 to v333 (required on any game.js edit per project law). Do the same swap for jukebox.js?v=332, catalog.js?v=332, and jukebox.css?v=332 in the same file so the whole bundle stays in lockstep (the project bumps all ?v together).
newCode:
```
<script src="game.js?v=333"></script>
```

### keyboardSafetyProof:
PROVEN byte-identical. (1) The keyboard scoring path is keydown listener (game.js:2925 `if (k in keyMap) { e.preventDefault(); if (!e.repeat) { laneDown[keyMap[k]] = true; onLaneInput(keyMap[k], 'key', e.timeStamp); } }`) -> onLaneInput (game.js:2694) -> handleHit (game.js:3035, incl. the whiff branch :3055) -> keyup (game.js:2931 onLaneRelease). NONE of these lines are edited by this spec ? every edit is in tryStrum/applyOverstrum/resetScoring-teardown/strumCfg-literal/__rrDebug/Settings-UI, none of which the keydown path enters. (2) All new behavior is double-gated: it runs only inside tryStrum(), which is reachable ONLY from pollGamepad (game.js:3014) and pollGuitarAxes (game.js:2981), both under `requireStrum()` (game.js:2969 = `laneProfile === 'gh' && !!guitarPadId()`). A keyboard session has no guitar pad => requireStrum() is false => _frets stays empty (the `_frets.add` at game.js:3011 is itself requireStrum()-gated) => tryStrum is never called. navigator.getGamepads() (pollGamepad's source) is disjoint from the keydown/keyup listeners. (3) Even if tryStrum somehow ran, the new branches are gated a SECOND time on `strumCfg.strict`, which defaults false => the function reduces to the two original lines verbatim (`if (_frets.size === 0) return;` then `for (const lane of _frets) onLaneInput(...)`). (4) The flag is intentionally NOT added to getSettings (game.js:2129) or applySettings (game.js:2116) ? it rides ONLY setStrumCfg (game.js:900) + loadStrumCfg/saveStrumCfg (44-45) in rr_strumcfg ? so the keyboard-reachable Settings surface can neither read nor write it. (5) The #set-strict toggle lives INSIDE #gh-badge (index.html:5102, display:none unless a guitar is detected), so a keyboard-only player never even sees the control; its click handler writes via setStrumCfg, never touching keyMap/handleHit. (6) applyOverstrum() mutates combo/comboTierCur/FX/SFX/HUD only ? same fields the existing bomb path (game.js:3066) writes ? and is callable ONLY from tryStrum's strict+empty-frets branch, never from onLaneInput/handleHit. (7) The resetScoring teardown line only clears a timer that is 0 in any non-strict/keyboard session => no-op. (8) buildNotes is untouched; note time-sort/order is preserved (no chart edits). Per-edit gate: `node --check game.js` after each batch; grep proves no keyMap/keydown path references `strict`, `_frets`, `requireStrum`, `tryStrum`, or `FRET_SETTLE_MS`.

### openQuestions:
1) STRUM MAGIC NUMBERS ? owner/hardware decision needed (no guitar yet, owner-locked hardware-tune-later): (a) FRET_SETTLE_MS = 35ms chord grace ? needs dial-in on a real GH/Clone-Hero controller; too low drops chord members, too high lets a deliberate two-strum register as one chord. (b) Overstrum penalty severity ? spec'd as a FULL combo break (combo=0, GH-authentic) with NO score loss. The owner may prefer a softer penalty (e.g. only break combo above some threshold, or a small stability ding instead of a hard reset). Confirm: hard combo-break vs. soft? 2) ALL-WHIFF OVERSTRUM (plan step 8 sub-bullet 'zero judged + strict => applyOverstrum once'): the minimal-risk spec above fires the penalty ONLY on the clean overstrum case (`_frets.size === 0` ? no fret held + strum). Detecting 'frets held but every one whiffed' cleanly would require handleHit/onLaneInput to RETURN a hit/whiff signal ? but handleHit is on the keyboard path and must stay byte-identical, so I did NOT add a return value. RECOMMENDATION: ship the empty-frets penalty now; defer the all-whiff refinement until/unless a real guitar shows it's needed (it would require a strum-local, requireStrum()-gated judged-count probe that reads notes[].judged deltas without touching handleHit's signature). Needs an owner call on whether the empty-frets case is sufficient for beta. 3) DEBOUNCE vs SETTLE interaction: STRUM_DEBOUNCE_MS=55 > FRET_SETTLE_MS=35, so a second strum can't arrive before a settle resolves under the default ? but if the owner tunes settle ABOVE debounce later, the `if (_settleTimer) clearTimeout` guard makes a fast second strum REPLACE the pending chord (last-strum-wins). Confirm that's the desired behavior at tune-time.

### verifyNote:
After applying: (1) `node --check game.js` (must pass ? template-literal/Set/setTimeout syntax). (2) Bump confirmed: index.html now references game.js?v=333 (and bump jukebox.js/catalog.js/jukebox.css to 333 in the same pass). (3) Claude_Preview (config `rr-verify`, port 8790, --directory = main dir; the session cwd is a STALE v59 worktree so the default `rhythm-rift` preview serves stale files ? use rr-verify): location.replace-free nav via `location.href = '/index.html?cb='+Date.now()`, then probe headless: `__rrDebug.strumState()` must report `{ require:false, strict:false, settleMs:35 }` on a keyboard boot (no guitar) => confirms default OFF + flag plumbed. (4) KEYBOARD REGRESSION: with state 'playing', `__rrDebug.press(2)` must still score identically to baseline (the press hook -> onLaneInput -> handleHit path is unchanged); `__rrDebug.score()`/`counts()` must climb exactly as before. (5) `window.RhythmGame.setStrumCfg({strict:true})` then `getStrumCfg()` must echo `strict:true` and persist to localStorage rr_strumcfg (reload -> loadStrumCfg restores it). (6) Confirm getSettings() output does NOT contain a `strict` key (proves the keyboard settings surface stays blind). (7) Grep the final game.js: the only references to `strict`, `FRET_SETTLE_MS`, `applyOverstrum`, `_settleTimer` must be inside tryStrum/applyOverstrum/resetScoring/strumCfg/__rrDebug/Settings-wiring ? none in the keydown/keyup/onLaneInput/handleHit/buildNotes bodies. (8) `preview_console_logs` (level error) clean at the end. Strum/overstrum/chord-grace behavior itself can only be fully verified on a physical GH controller (requireStrum() is false headless) ? verify the GATE + persistence headless, and tell the user the strict-mode feel (overstrum sting, chord settle) shows on their real guitar.


## FEATURE: Phase 4d ? Winner-card RP delta + rank-up cue + combat line
FILE: multiplayer.js + index.html (both under D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\). NO game.js edit (no scoring/keyboard/strum touch).

### summary:
On the versus/tournament WINNER CARD (#mpx-step-winner, rendered by showWinner() in multiplayer.js), surface the rank-point (RP) delta the match just produced (+25 win / +8 draw / -12 loss, floored at 0), a "RANK UP -> TIER!" cue when the tier name changes, and a short combat-flavor line (e.g. "Forfeit secured." / "Held the line." / "Knocked down a peg.").

THE DATA ALREADY EXISTS ? nothing new is computed in the scoring layer:
- recordMpResult(result, info) at multiplayer.js:225 mutates the local ladder (rr_ladder localStorage key rr_mp_rank) and RETURNS the mutated record `r` (return r at multiplayer.js:237) with r.points being the post-match total.
- The per-result deltas are fixed in recordMpResult: win +25 (line 227, skipped on forfeit), draw +8 (228), loss -12 floored at 0 (229).
- getRank() (multiplayer.js:218) exposes .points and .tier from the SAME store, so reading getRank().points BEFORE the record call gives the "before" total; r.points after gives "after"; delta = after - before.
- mpRankTier(points) (216) maps points->tier; recordMpResult already pre-captures _beforeTier (226) and already fires the rank-up sting at 231 ? the card just needs the VISUAL counterpart.

THE GAP (confirmed live): showWinner() at multiplayer.js:1218 calls recordMpResult at line 1241 but DISCARDS its return value (`try { recordMpResult(...); } catch(e){}`) and never reads the delta. So the points change silently; the card shows verdict + scores only. This feature captures that already-computed delta and paints it.

This is a pure render-layer add: one hidden <div> in the winner markup, one CSS rule, and capture+paint logic added INSIDE the existing ranked-result guard in showWinner(). It runs only in multiplayer.js (never during solo keyboard play) and touches no scoring/input/strum code.

### EDIT 1 anchorQuote:
```
        <div class="mpx-verdict" id="mpx-verdict">YOU WIN</div>
        <div class="mpx-scorecard">
```
change: index.html ? add the RP-delta slot directly under the verdict line, inside .mpx-step-winner (currently around index.html:4365). The element ships hidden; showWinner() unhides + fills it only for ranked human matches. innerHTML (set in JS) will hold up to 3 spans: the RP delta, an optional RANK-UP cue, and the combat line.
newCode:
```
        <div class="mpx-verdict" id="mpx-verdict">YOU WIN</div>
        <!-- Phase 4d: ranked RP delta + rank-up cue + combat line. Hidden by default; showWinner() fills + unhides only for ranked HUMAN matches (CPU/spectator stay hidden). innerHTML written via the set/innerHTML path in showWinner. -->
        <div class="mpx-rp-delta" id="mpx-rp-delta" hidden></div>
        <div class="mpx-scorecard">
```

### EDIT 2 anchorQuote:
```
  .mpx-verdict.draw { color: var(--chrome, #dad7d2); }
```
change: index.html ? add the .mpx-rp-delta CSS immediately after the existing .mpx-verdict.draw rule (index.html:3379, inside the one big inline <style>). Brand law: GOLD #e0a93f is the reserved owned/rank color used for a GAIN; warm-grey #8a807c (R>=G>=B, never crimson/blue) for a LOSS so a -RP doesn't read as a 'you failed' slap. The .up rank-up line gets a soft gold glow mirroring the verdict.win treatment.
newCode:
```
  .mpx-verdict.draw { color: var(--chrome, #dad7d2); }
  /* Phase 4d: winner-card RP delta. Gold = RP gain (reserved owned/rank color); warm-grey = RP loss (R>=G>=B, NOT crimson ? a -RP is not a failure). */
  .mpx-rp-delta { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: clamp(15px, 3.4vw, 19px); letter-spacing: 0.04em; margin: -10px 0 16px; line-height: 1.5; }
  .mpx-rp-delta .rp-amt.gain { color: var(--gold, #e0a93f); text-shadow: 0 0 16px rgba(224,169,63,0.4); }
  .mpx-rp-delta .rp-amt.loss { color: #8a807c; }
  .mpx-rp-delta .rp-up { display: block; font-family: 'Chakra Petch', sans-serif; font-weight: 700; font-size: 0.82em; letter-spacing: 0.12em; color: var(--gold, #e0a93f); text-shadow: 0 0 18px rgba(224,169,63,0.5); margin-top: 3px; }
  .mpx-rp-delta .rp-line { display: block; font-family: 'Chakra Petch', sans-serif; font-weight: 400; font-size: 0.74em; letter-spacing: 0.04em; color: #9c918e; margin-top: 4px; }
```

### EDIT 3 anchorQuote:
```
    if (!_rankRecorded && !spectating && !(oppMeta && oppMeta.bot)) {   // v258: a SPECTATOR's myFinal defaults to {score:0} ? would record a phantom LOSS on their own ladder; gate it out
      _rankRecorded = true;
      var _res = draw ? 'draw' : win ? 'win' : 'loss', _ff = !op || oppLeft;
      try { recordMpResult(_res, { op: (op && op.name) || (oppMeta && oppMeta.name) || 'Rival', song: (sel && sel.title) || '', my: (me && me.score) || 0, ops: (op && op.score) || 0, forfeit: (_res === 'win' && _ff) }); } catch (e) {}
      try { paintRankChip(); } catch (e) {}
    }
```
change: multiplayer.js ? inside the EXISTING ranked-result guard in showWinner() (currently multiplayer.js:1238-1243), capture the before-points/before-tier, capture recordMpResult's returned record, compute the delta + rank-up, and paint #mpx-rp-delta. The guard itself is UNCHANGED (same condition, same recordMpResult call args, same paintRankChip) ? we only (a) read getRank() once before the call, (b) keep the call's return value instead of discarding it, and (c) call a new paintRpDelta() helper. The else-branch hides the slot so CPU/spectator/draw-of-no-data never shows a stale delta. All wrapped in try/catch so a paint failure can never break match settle.
newCode:
```
    if (!_rankRecorded && !spectating && !(oppMeta && oppMeta.bot)) {   // v258: a SPECTATOR's myFinal defaults to {score:0} ? would record a phantom LOSS on their own ladder; gate it out
      _rankRecorded = true;
      var _res = draw ? 'draw' : win ? 'win' : 'loss', _ff = !op || oppLeft;
      // Phase 4d: snapshot the ladder BEFORE recording ? recordMpResult pre-captures only the tier NAME, not points, so read points here.
      var _rpBefore = 0, _tierBefore = '';
      try { var _gr = getRank(); _rpBefore = _gr.points; _tierBefore = _gr.tier; } catch (e) {}
      var _rec = null;
      try { _rec = recordMpResult(_res, { op: (op && op.name) || (oppMeta && oppMeta.name) || 'Rival', song: (sel && sel.title) || '', my: (me && me.score) || 0, ops: (op && op.score) || 0, forfeit: (_res === 'win' && _ff) }); } catch (e) {}
      try { paintRankChip(); } catch (e) {}
      // Phase 4d: paint the RP delta + rank-up cue + combat line from the data recordMpResult already returned.
      try { paintRpDelta(_res, _rec, _rpBefore, _tierBefore, !!(_res === 'win' && _ff)); } catch (e) {}
    } else {
      // CPU warm-up / spectator / no-op: never show a ranked RP delta.
      try { var _rd = $('mpx-rp-delta'); if (_rd) { _rd.hidden = true; _rd.innerHTML = ''; } } catch (e) {}
    }
```

### EDIT 4 anchorQuote:
```
  function set(id, txt) { var el = $(id); if (el) el.textContent = txt; }
```
change: multiplayer.js ? add the paintRpDelta() helper immediately after the set() helper (currently multiplayer.js:1248), so it sits beside showWinner in the same closure (it uses the in-scope $ and getRank/mpRankTier). It builds the up-to-3-span innerHTML: the RP amount (gold gain / grey loss), an optional RANK UP line when the tier name changed, and a short combat-flavor line. A forfeit win awards 0 RP (recordMpResult skips +25 on forfeit) so the amount shows '+0 RP' with a 'Forfeit secured.' line rather than implying points were earned.
newCode:
```
  function set(id, txt) { var el = $(id); if (el) el.textContent = txt; }
  // Phase 4d: paint the winner-card RP delta + rank-up cue + combat line. Reads ONLY data recordMpResult already returned
  // (rec.points = post-match total) plus the pre-snapshot. Cosmetic ? never re-records, never touches scoring/keyboard.
  function paintRpDelta(res, rec, rpBefore, tierBefore, forfeit) {
    var el = $('mpx-rp-delta'); if (!el) return;
    if (!rec || typeof rec.points !== 'number') { el.hidden = true; el.innerHTML = ''; return; }
    var after = rec.points, delta = after - (rpBefore || 0);
    var gain = delta >= 0;
    var sign = (delta > 0 ? '+' : '');   // negative numbers carry their own '-'; floor-at-0 losses show '+0'
    var amt = '<span class="rp-amt ' + (gain ? 'gain' : 'loss') + '">' + sign + delta + ' RP</span>';
    // rank-up: compare the tier NAME before vs after (mpRankTier already defined above in this closure).
    var tierAfter = '';
    try { tierAfter = mpRankTier(after).n; } catch (e) {}
    var up = (tierAfter && tierBefore && tierAfter !== tierBefore && after > (rpBefore || 0))
      ? '<span class="rp-up">RANK UP ? ' + tierAfter + '!</span>' : '';
    // short combat-flavor line (Chakra Petch, warm-grey). Forfeit win is its own case (0 RP, W column only).
    var line;
    if (res === 'win') line = forfeit ? 'Forfeit secured ? the W stands, no RP farmed.' : 'Crushed it. RP banked.';
    else if (res === 'draw') line = 'Dead heat ? you both hold the line.';
    else line = 'Knocked down a peg ? run it back.';
    el.innerHTML = amt + up + '<span class="rp-line">' + line + '</span>';
    el.hidden = false;
  }
```

### EDIT 5 anchorQuote:
```
    step('setup'); paintSelection(); refreshReadyEnabled();
    var rs = $('mpx-readystate'); if (rs) rs.textContent = 'Rematch ? READY when set.';
```
change: multiplayer.js ? in resetForRematch() (currently multiplayer.js:1250-1262), clear/hide the RP-delta slot so a stale delta from round 1 can't linger into the rematch's winner card. Added right where the rematch already re-seeds the setup step.
newCode:
```
    step('setup'); paintSelection(); refreshReadyEnabled();
    try { var _rd = $('mpx-rp-delta'); if (_rd) { _rd.hidden = true; _rd.innerHTML = ''; } } catch (e) {}   // Phase 4d: don't carry a prior round's RP delta into the rematch card
    var rs = $('mpx-readystate'); if (rs) rs.textContent = 'Rematch ? READY when set.';
```

### EDIT 6 anchorQuote:
```
<script src="multiplayer.js?v=324"></script>
```
change: index.html ? bump the multiplayer.js cache-bust (currently ?v=324) so the user's browser loads the edited file. Per project law, bump on every JS/CSS edit. The inline <style> RP CSS rides the no-cache HTML, so no separate CSS tag is needed. (Also bump game.js?v=332 -> ?v=333 on line 5644 so the start-screen version stamp, which reads game.js?v=NN, advances to the new build number ? game.js itself is NOT edited.)
newCode:
```
<script src="multiplayer.js?v=333"></script>
```

### keyboardSafetyProof:
BYTE-IDENTICAL keyboard scoring is guaranteed. Proof:

1) ZERO game.js logic edits. This feature edits only multiplayer.js (render-layer paint inside showWinner/resetForRematch) and index.html (markup + inline CSS + cache-bust). The one game.js touch is the ?v=332->333 cache-bust query on its <script> tag in index.html (start-screen version stamp), which does not alter a single byte of game.js source. The keyboard scoring path ? keydown (game.js:2925 `if (k in keyMap){...onLaneInput(keyMap[k],'key',e.timeStamp)}`), keyup (game.js:2929 onLaneRelease), onLaneInput (game.js:2694), handleHit (game.js:3035), whiff branch (game.js:3055), and buildNotes timing/order ? is not in any edited file and is not referenced by any new code.

2) NO strum/GH machinery touched. The new code never references _frets, requireStrum(), tryStrum(), pollGamepad, pollGuitarAxes, strumCfg, or the new strict flag. There is no new flag read by any keyboard path ? the feature adds no flag at all (it reads only the already-existing ladder data via getRank()/recordMpResult's return). The strum opt-in toggle and requireStrum() gating from 4b/4c are a separate sub-feature; nothing here reads them.

3) multiplayer.js does NOT run during solo keyboard play. showWinner()/resetForRematch()/paintRpDelta() fire only from the MP match-settle flow (settleIfReady -> showWinner). Solo play never enters this closure. Confirmed by the design contract in PHASE4_DESIGN_PLAN.md: "4a/4d live entirely in multiplayer.js, which does not run during solo keyboard play."

4) NO scoring re-entry / NO double-record. paintRpDelta() only READS rec.points (the value recordMpResult already returned) and getRank()'s pre-snapshot; it never calls recordMpResult, never writes localStorage, never mutates the ladder. The existing recordMpResult call is UNCHANGED (identical args, identical guard condition `!_rankRecorded && !spectating && !(oppMeta && oppMeta.bot)`, _rankRecorded still flips once) ? we only stopped discarding its return value. So RP is still recorded exactly once, with the exact same +25/+8/-12 math.

5) Gating preserved. The paint sits INSIDE the unchanged ranked-human guard, so CPU matches (oppMeta.bot), spectators, and the safety/forfeit paths never show a ranked delta (the added else-branch hard-hides the slot). A CPU loss (now possible via 4a) leaves #mpx-rp-delta hidden ? CPU never touches the ladder, consistent with "CPU warm-ups never count" (multiplayer.js:198-200).

6) Fail-soft. Every new block is wrapped in try/catch, mirroring the existing showWinner pattern, so a DOM/paint error can never break match settle, the verdict, or any gameplay path.

Per-edit gate for the implementer: `node --check multiplayer.js` after the JS edits (must pass), and grep to confirm no keyMap/keydown/handleHit/buildNotes path references mpx-rp-delta or paintRpDelta (it won't ? they live only in showWinner/resetForRematch).

### openQuestions:
No strum magic numbers in THIS sub-feature ? 4d is cosmetic card-render only; the strum hardware-tuning numbers (FRET_SETTLE_MS=35, overstrum penalty size) belong to 4b/4c, not here. Two minor copy/owner decisions, neither blocking:

1) COMBAT-LINE COPY is a flavor call. I drafted: win='Crushed it. RP banked.', forfeit-win='Forfeit secured ? the W stands, no RP farmed.', draw='Dead heat ? you both hold the line.', loss='Knocked down a peg ? run it back.'. Owner may want punchier/branded lines (e.g. a Ryo-voice taunt). Trivial string swap in paintRpDelta(); no structural impact. The forfeit-win line is deliberately distinct because a forfeit awards 0 RP (recordMpResult skips +25 when info.forfeit) ? so the card honestly shows '+0 RP' rather than implying earned points.

2) RANK-DOWN cue: the spec shows a RANK UP line when the tier name rises, but is silent on a tier DROP (a loss can cross a tier floor downward, e.g. SILVER 150 -> below). Current paintRpDelta() only renders the 'up' line (rises only); a downward tier change just shows the grey '-12 RP' with no demotion banner. That's the gentler/on-brand choice (don't rub a demotion in), matching that recordMpResult only fires the rank-up sting on a win (line 231). If the owner wants an explicit 'RANK DOWN' cue, add a symmetric warm-grey '.rp-down' span ? flagged, not assumed.

UTF-8 HAZARD NOTE: the newCode uses JS unicode escapes (\\u2192 for the arrow, \\u2014 for the em-dash) in the multiplayer.js strings rather than literal special characters, specifically to avoid the documented Windows cp1252/BOM-less-UTF-8 mojibake hazard. The implementer MUST apply these via the Edit tool / python (NEVER a PowerShell rewrite) per the project's windows-utf8-file-hazard rule. The em-dash characters that appear LITERALLY in the existing anchorQuotes (e.g. 'Rematch ? READY', 'Crucial ?') are pre-existing in the file and are matched verbatim, not introduced by me.

### verifyNote:
Per-edit: `node --check multiplayer.js` (must pass; index.html is not node-checkable). Grep `mpx-rp-delta` across multiplayer.js + index.html ? expect exactly: 1 markup div + 4 CSS selectors (.mpx-rp-delta and its .rp-amt/.rp-up/.rp-line children) + the showWinner paint call + the else-hide + the resetForRematch hide. Confirm `?v=` bumped on multiplayer.js (324->333) and game.js (332->333) script tags, and add a CHANGELOG.md entry (build96/v333).

Live verify via Claude_Preview ? IMPORTANT: per the worktree-stale memory, the default 'rhythm-rift' preview serves the STALE v59 worktree; use the rr-verify preview config (port 8790, --directory the MAIN dir) or the rhythm-game-local-verify recipe. Steps: preview_start -> navigate with location.href + '?cb='+Date.now() -> drive the MP winner card. Because a real 2-peer match isn't headless-drivable, verify the PAINT in isolation: in preview_eval, manually exercise the render path, e.g. seed `localStorage.rr_mp_rank` to a known points total, then call (via the multiplayer closure if exposed, or by temporarily forcing the branch) and assert: document.getElementById('mpx-rp-delta').hidden === false, its innerHTML contains '+25 RP' for a simulated win, the .rp-amt has class 'gain' (gold) for a gain / 'loss' (grey) for a loss, the 'RANK UP ->' span appears only when the seeded before-points and the post-points straddle a MP_RANK_TIERS floor (e.g. before=145 + win 25 -> 170 crosses SILVER min 150), and the .rp-line combat text matches the result. Confirm a CPU match (oppMeta.bot) and the rematch reset both leave #mpx-rp-delta hidden with empty innerHTML. End by reading preview_console_logs (level error) ? expect none.

Visual/brand check the user can confirm on their machine: gain reads GOLD #e0a93f, loss reads warm-grey #8a807c (no crimson/blue), the RANK UP line glows gold, fonts are Oxanium (amount) + Chakra Petch (rank-up + combat line) per HUD convention. Confirm the delta sits between the verdict and the scorecard without crowding (the -10px top margin tucks it under YOU WIN).

---

# ⚠ PHASE 4 SPEC REVIEW CORRECTIONS (workflow w5yqyar9a) — APPLY THESE BEFORE IMPLEMENTING 4a

Verdicts: [{'feature': 'cpu-rival', 'verdict': 'apply-with-corrections'}, {'feature': 'strum-toggle', 'verdict': 'safe-to-apply'}, {'feature': 'winner-card', 'verdict': 'safe-to-apply'}]

(strum-toggle + winner-card = safe-to-apply as written; CPU-rival = apply-with-corrections below.)


## [CRITICAL] F1 — EDIT 3 scores 1500*npcMult per note ? 4x the engine's per-note ceiling; NPC is unbeatable, claim (d)'s ceiling math and claim (b)'s 'player can win' are both broken
EVIDENCE: game.js:85 JUDGE.perfect.score = 375 and game.js:90 MAX_MULT = 4, so the engine's MAX per note is 375*4 = 1500 (game.js:4 'Scoring ceiling = notes_total * 1500 (PERFECT = 1500 flat')). EDIT 3 awards `_npcSim.score += 1500 * npcMult` with npcMult clamped 1..4 (PHASE4_EXACT_SPECS.md:110-111), i.e. up to 1500*4 = 6000 per note = 4x the human per-note ceiling. The spec's claim 'npcMult clamped to MAX_MULT(=4) so the ghost stays under the notes_total*1500 ceiling' (line 15) is mathematically false: 1500 is already the post-mult max, not the base. Combo reaches the mult cap fast, so on the default _devBotDiff='medium' (rating 0.90) the NPC scores ~0.9 * notes_total * ~6000 ? 3.6x a PERFECT human's notes_total*1500. A human literally cannot win on medium/hard ? the always-WIN bug is merely replaced by an always-LOSE one. Note: this is NOT a ranked-ladder integrity bug (the oppMeta.bot guard at multiplayer.js:1238 still skips recordMpResult, and recordMpResult points are fixed +25/+8/-12 independent of score magnitude), so claim (d)'s LADDER protection holds ? but the NPC card score and the win/lose verdict are wrong.
CORRECTION: In EDIT 3 change the per-hit award from `_npcSim.score += 1500 * npcMult;` to `_npcSim.score += 375 * npcMult;` (375 = engine per-note base JUDGE.perfect.score, so npcMult=4 yields 1500 = the human per-note max). This makes the NPC's ceiling equal to a PERFECT human's on the same chart, so a genuine win AND loss are both reachable and the displayed NPC score is plausible. Update the in-code comment that says '1500 = engine per-note base' ? the base is 375, 1500 is the ceiling.

## [MAJOR] F2 — Dedupe under-counts: a note the player hits EARLY (d>0) is culled from the pool before the sim ever sees a d<=0 frame, so the sim never judges it ? the NPC's note total is coupled to player input, contradicting 'never reads the player'
EVIDENCE: getGhostNotes culls struck notes at game.js:6246 `if (nn.judged && nn.hit !== 'miss') continue;`. handleHit (game.js:3050-3051) accepts a press when `n.time >= t - hitWindow && n.time <= t + hitWindow`; for medium hitWindow=0.16 / approach=0.95 (game.js:61) a note is hittable while d = (n.time-t)/approach is up to +0.168 (still ABOVE the strike line). When the player hits such a note early, the engine sets judged=true/hit=kind (game.js:3092) and the NEXT getGhostNotes frame drops it. The sim's last recorded _npcSim.prevD[key] for that note is >0 and it never observes the prev>0 && d<=0 transition (PHASE4_EXACT_SPECS.md:102), so that note is silently excluded from _npcSim.total/score. Roughly half of a skilled player's hits land in the early sub-window, so the NPC's total swings with the player's timing. The spec sells the sim as independent ('NEVER reads the player's score', line 26) ? true for score, but the chart it rolls on is the chart-minus-player-early-hits, so the NPC's accuracy denominator is player-dependent. (Player MISSES keep the note ? hit='miss' survives line 6246 ? and LATE hits already crossed d<=0, so those are counted; only early hits are dropped.)
CORRECTION: Decouple the sim from the player-struck pool. Simplest robust fix: judge a note key the first frame its prevD>0 transitions to a small negative threshold OR the first frame it DISAPPEARS from the pool after having been seen with prevD>0 (treat 'seen with d>0 then gone' as a judged note). Cleanest: have getGhostNotes (or a sibling read-only export) expose ALL upcoming notes regardless of nn.judged for the sim's consumption, OR add a tiny 'judge on first observation with prevD>0 once d <= +epsilon' so an early-cull still counts. At minimum, document that the NPC total tracks notes the player did NOT early-hit, and gate the judgment on the LAST-seen prevD rather than requiring an explicit d<=0 frame (e.g. on key vanish from the pool, if prevD[key] was >0 and not seen, judge it then).

## [MINOR] F3 — Cross-spec ?v conflict: EDIT 9 bumps multiplayer.js to 325 but the co-shipping Phase 4d (build96/v333) bumps it to 333
EVIDENCE: Phase 4a EDIT 9 (PHASE4_EXACT_SPECS.md:189-197) bumps `multiplayer.js?v=324` -> `?v=325`, while Phase 4d EDIT 6 (line 510-518) bumps the SAME tag `?v=324` -> `?v=333`, and the 4d verifyNote (line 547) calls the combined build 'build96/v333'. If 4a is applied alone with v325 and 4d later expects to edit v324->333, the second anchor (?v=324) will already be gone (now 325) and the bump will mismatch the changelog/build stamp.
CORRECTION: Apply ALL Phase 4 sub-features in one build and bump every ?v (game.js, multiplayer.js, jukebox.js, catalog.js, jukebox.css) in lockstep to the SAME number (333 per the 4d/build96 plan). If 4a ships standalone, pick the final intended build number now (not 325) so a later 4d edit doesn't re-anchor a stale ?v=324.

## [MINOR] F4 — Rival deck multiplier always renders 1x: EDIT 3 writes mu:1 even though the sim computes npcMult internally
EVIDENCE: EDIT 3's lastOppState literal (PHASE4_EXACT_SPECS.md:123-124) sets `mu: 1` constant; the deck consumer renders it at multiplayer.js:835 `om.textContent = Math.round(_oppEase.mu) + 'x'`. The sim builds combo and computes npcMult (1..4) per hit but never surfaces it, so the rival's on-screen multiplier is frozen at 1x while its score visibly climbs ? a believability seam (and the old player-mirror loop had the same mu:1, so it is not a regression, just a missed upgrade).
CORRECTION: Surface the live tier: set `mu: Math.min(4, 1 + Math.floor(_npcSim.combo / 12))` (the same npcMult expression already computed) in the lastOppState literal so the rival deck's multiplier tracks its combo. Cosmetic only; no scoring/shape impact (mu is already a consumed key).

## [NIT] F5 — EDIT 3 silently drops o.skill in favor of the global _devBotDiff toggle (behavior change, but no caller relies on o.skill)
EVIDENCE: The old loop used `var skill = (o.skill != null) ? o.skill : 0.92` (multiplayer.js:2861); EDIT 3 replaces it with `_npcRating(_devBotDiff)` and never reads o.skill. All call sites pass devVsNpc() / devVsNpc({}) / devVsNpc({sel:carry}) (multiplayer.js:1303, 3008, 3031, 3265) ? none pass skill ? so nothing breaks. _devBotDiff is clamped to easy|medium|hard (multiplayer.js:2761) which _npcRating handles, and is hoisted module-closure scope so the call at run start reads the current toggle value correctly.
CORRECTION: No fix required; optionally honor an explicit o.skill override (`_npcSim.rating = (o.skill != null) ? o.skill : _npcRating(_devBotDiff)`) so the dev hook can still force a rating for testing. Otherwise leave as-is and note the difficulty now comes from the NPC-diff toggle, not the call arg.

## [NIT] F6 — Sim can miss a note that first appears already at d<=0 (no prev>0 reading ever recorded)
EVIDENCE: The transition guard requires `prev != null && prev > 0` (PHASE4_EXACT_SPECS.md:102). If a note's first observation in the pool is already d<=0 (e.g. the ghost rAF's first frame after a pause/resume or a journey songTime jump lands a note in [-0.12, 0]), prevD[key] is set to that <=0 value and the prev>0 guard never fires for it ? never judged. At a clean song start no notes are past the line, and at 60fps d steps are small (~0.016 medium / ~0.024 hard per frame) so a normal in-flight note always gets a d>0 reading first; the gap is limited to pause/seek boundaries.
CORRECTION: Acceptable for beta. If pause/seek paths are exercised in CPU matches, also judge a key on its FIRST observation when d<=0 by treating a fresh key with d in (-0.12, 0] as 'just crossed' (judge once, set seen). Low priority.

## [MINOR] F1 — EDIT 1 / EDIT 2 anchorQuote comment text does not byte-match the real file ? Edit will fail unless corrected
EVIDENCE: The spec's EDIT 1 and EDIT 2 anchorQuotes quote the debounce comment as `// anti-double-strum (strum-up + strum-down both funnel through here)` (note the word 'both'). The REAL game.js:38 is `const STRUM_DEBOUNCE_MS = 55;        // anti-double-strum (strum-up + strum-down funnel through here)` ? NO 'both'. Likewise EDIT 2's anchor line `if (now - _lastStrumT < STRUM_DEBOUNCE_MS) return;     // debounce: strum-up + strum-down both land here` matches real game.js:2971 exactly (that one DOES have 'both'), but the EDIT 1 anchor's first line is the STRUM_DEBOUNCE_MS comment, which differs. The spec's own EDIT 1 'change' note acknowledges this ('the plan's anchor had slightly different comment wording ? this anchor is the REAL current text'), and the newCode block in EDIT 1 actually reproduces the correct no-'both' wording. So the spec is internally consistent; the risk is only that a careless implementer copies the 'both' variant from the design-plan prose.
CORRECTION: Use the EXACT real line for the STRUM_DEBOUNCE_MS anchor: `  const STRUM_DEBOUNCE_MS = 55;        // anti-double-strum (strum-up + strum-down funnel through here)` (no 'both'). The EDIT 1 newCode already has it right; just ensure the Edit old_string is taken from game.js:38 verbatim, not from PHASE4_DESIGN_PLAN.md.

## [MINOR] F2 — Chord fret-settle relies on handleHit's inputLag back-dating, which silently breaks if FRET_SETTLE_MS is later tuned above ~50ms
EVIDENCE: The settle defers `onLaneInput(lane,'guitar', now)` by FRET_SETTLE_MS (35) but passes the ORIGINAL strum `now` as evTime. handleHit (game.js:3041) computes `inputLag = Math.min(0.05, Math.max(0,(performance.now()-evTime)/1000))` then judges at `t = songTime()-audioOffset-inputLag`. With a 35ms defer, performance.now()-evTime ? 0.035s < the 0.05 clamp, so the judgment is correctly back-dated to the strum instant ? the spec's 'judged at the ORIGINAL strum instant' claim HOLDS at the default. BUT openQuestion #3 notes the owner may tune settle ABOVE debounce later; if FRET_SETTLE_MS is ever set >50ms, the 0.05s inputLag clamp truncates the back-date and the whole chord judges LATE by (settle-50)ms ? a silent timing skew, not a crash.
CORRECTION: Add a one-line caveat in the FRET_SETTLE_MS comment (or openQuestions) that the value must stay <= 50ms or the handleHit inputLag clamp (game.js:3041) will truncate the strum-instant back-dating. This is a hardware-tune-later guardrail, not a blocker for the default-OFF / 35ms ship.

## [NIT] F3 — applyOverstrum calls flashJudgment with 2 args (isWhiff undefined) so it stamps _lastRealJudgeMs ? intended, but worth a confirming note
EVIDENCE: Spec EDIT 2 newCode: `flashJudgment('OVERSTRUM', '#ff6b78');`. flashJudgment signature is `(text, color, isWhiff)` (game.js:3808-3809): when isWhiff is falsy it sets `_lastRealJudgeMs = performance.now()`. So an overstrum DOES stamp _lastRealJudgeMs, meaning the keyboard whiff-dash clobber-guard (game.js:3057, `performance.now() - _lastRealJudgeMs > 30`) would treat the overstrum as a real judgment. This is correct/desired (an overstrum IS a real penalty event, and it only fires in a GH session where the keyboard whiff branch is irrelevant), but the spec does not explicitly call it out.
CORRECTION: No code change needed. Optionally note in the applyOverstrum comment that passing isWhiff=false is intentional (an overstrum is a real judgment, unlike the keyboard whiff). The overstrum can never collide with the keyboard whiff path because it only fires under requireStrum().

## [NIT] F4 — Cross-spec ?v collision: strict-strum (4b/4c) and 4a both bump game.js to v333; 4a and 4d both bump multiplayer.js to v333 ? fine only if applied as ONE build
EVIDENCE: The strict-strum sub-feature (EDIT 8) bumps game.js?v=332->333. Phase 4a (EDIT 8) also bumps game.js?v=332->333. Phase 4a (EDIT 9) bumps multiplayer.js?v=324->325, but Phase 4d (EDIT 6) bumps multiplayer.js?v=324->333. Real current tags: game.js?v=332 (index.html:5644), multiplayer.js?v=324 (5648), jukebox.js/catalog.js/jukebox.css all ?v=332. The four sub-features disagree on the multiplayer.js target number (325 vs 333).
CORRECTION: Apply all of Phase 4a/4b/4c/4d as a single build and bump EVERY local asset (game.js, multiplayer.js, jukebox.js, catalog.js, jukebox.css) to the SAME number (the specs' verifyNotes say build96/v333 ? use 333 uniformly). Do not take 4a's interim multiplayer.js?v=325; the final must be 333 to match the start-screen version stamp.

## [NIT] F5 — Strict toggle markup uses class="active" but the existing seg pattern is driven by data-* + .active toggled in JS ? confirm initial-active is harmless before first renderDeviceStatus
EVIDENCE: EDIT 5 ships `<button data-strict="off" class="active">Forgiving</button>`. The re-sync (EDIT 7) re-derives `.active` from persisted strumCfg.strict on every renderDeviceStatus()/openSettings(). The sibling set-fail/set-chart segs (index.html:5029/5036, synced at game.js:6023-6024) follow the same idiom. Since the toggle lives inside #gh-badge (display:none until a guitar is detected) and renderDeviceStatus runs on openSettings (game.js:6031), the hardcoded initial 'active' is corrected before the control is ever visible. No regression to other settings: the wiring only touches #set-strict children and setStrumCfg.
CORRECTION: None required ? anchor and pattern are correct. Just verify after apply that openSettings->renderDeviceStatus repaints #set-strict from strumCfg.strict (it will, via EDIT 7) so a persisted strict:true shows the 'Strict (GH)' button active on reopen.

## [NIT] 4d-data-exists — VERIFIED: RP/rank delta data all exists and is non-undefined at the paint point
EVIDENCE: Confirmed against real multiplayer.js: recordMpResult (line 225) does `return r` (line 237) with r.points being the post-match total; deltas are win +25 (227, skipped on forfeit), draw +8 (228), loss -12 floored at 0 (229). getRank() (218-224) returns BOTH `.points` (number) and `.tier` (the tier NAME string, via `tier: t.n` at 222), so the `_rpBefore`/`_tierBefore` pre-snapshot reads defined values. mpRankTier(after) (216) loops from MP_RANK_TIERS[0] and always returns a tier object, so `.n` is never undefined (no crash in paintRpDelta's `mpRankTier(after).n`). The spec's claim that the data is already-computed and merely discarded is correct: the live showWinner (1241) calls recordMpResult inside `try{...}catch(e){}` and throws away the return value.
CORRECTION: None. The data-existence claim is sound; the only change is capturing the already-returned record instead of discarding it.

## [NIT] 4d-anchors-correct — VERIFIED: all render anchors match the real code and do not break the existing winner card
EVIDENCE: index.html markup anchor (EDIT 1) matches lines 4365-4366 verbatim (`<div class="mpx-verdict" id="mpx-verdict">YOU WIN</div>` then `<div class="mpx-scorecard">`); the new hidden div inserts cleanly between the verdict and scorecard. CSS anchor (EDIT 2) `.mpx-verdict.draw { color: var(--chrome, #dad7d2); }` matches line 3379. multiplayer.js EDIT 3 anchor matches the ranked guard at 1238-1243 exactly (the real block has NO else branch, so the spec's added else is genuinely new and syntactically valid). EDIT 4 anchor (set() helper) matches line 1248; paintRpDelta placed after it is in the same module closure with $ (29), getRank, mpRankTier, recordMpResult all in scope. EDIT 5 anchor matches resetForRematch 1260-1261. No pre-existing references to mpx-rp-delta or paintRpDelta anywhere (grep clean in both files) ? zero collision. CSS vars --gold(#e0a93f), --ink-dim, --chrome all defined (index.html 38/39/43).
CORRECTION: None. Anchors are accurate and the insert is additive (one hidden div + one CSS block + capture-and-paint inside the existing guard).

## [NIT] 4d-cosmetic-no-scoring — VERIFIED: cosmetic only ? no scoring/keyboard/strum touch, no double-record
EVIDENCE: paintRpDelta only READS rec.points + the pre-snapshot; it never calls recordMpResult, never writes localStorage, never mutates the ladder. The existing recordMpResult call keeps identical args and the identical guard (`!_rankRecorded && !spectating && !(oppMeta && oppMeta.bot)`); _rankRecorded still flips once (1239), reset only per-match in beginMatch (1020). So RP records exactly once with the same +25/+8/-12 math. No game.js source edit. The keyboard chain (keydown/keyup/onLaneInput/handleHit/buildNotes) is not in any edited file and is not referenced by the new code. showWinner/resetForRematch fire only from the MP settle flow (settleIfReady?showWinner), never in solo keyboard play. devVsNpc/strumCfg.strict are untouched by 4d. All new blocks wrapped in try/catch so a paint failure can't break match settle.
CORRECTION: None.

## [NIT] 4d-brand-legal — VERIFIED: brand-legal ? gold for gain, warm-grey for loss, no purple/blue
EVIDENCE: CSS uses var(--gold,#e0a93f) for .rp-amt.gain (the reserved owned/rank color), #8a807c (R=138,G=128,B=124 ? R>=G>=B, warm) for .rp-amt.loss, and #9c918e/--gold for the rank-up + combat lines ? all warm, no crimson/blue/purple. Gold gain matches the existing .mpx-verdict.win gold treatment (3377) and the lobby rank chip. Fonts are Oxanium (amount) + Chakra Petch (rank-up/combat line) per HUD convention. A loss deliberately avoids crimson so -RP doesn't read as 'you failed'. Consistent with project brand law.
CORRECTION: None.

## [NIT] 4d-rankup-loss-guard — Rank-up cue correctly suppressed on losses via the `after > rpBefore` guard
EVIDENCE: paintRpDelta's rank-up condition is `tierAfter && tierBefore && tierAfter !== tierBefore && after > (rpBefore||0)`. Both tierBefore (from getRank().tier) and tierAfter (from mpRankTier(after).n) are tier-NAME strings, so the !== compare is valid. The trailing `after > rpBefore` prevents a false 'RANK UP' on a loss that drops a tier downward (a demotion shows only the grey -RP with no banner, matching the spec's intentional 'don't rub a demotion in' choice and the fact recordMpResult only fires the rank-up sting on a win at 231).
CORRECTION: None ? behaves as designed. (Open question #2 in the spec already flags the absence of a RANK DOWN cue as an owner choice, not a bug.)

## [NIT] 4d-forfeit-zero-rp-copy — Minor: comment says forfeit shows '+0 RP' but the code renders '0 RP' (no plus)
EVIDENCE: A forfeit win awards 0 RP (recordMpResult skips +25 when info.forfeit, line 227) ? delta = 0. In paintRpDelta, `sign = (delta > 0 ? '+' : '')`, so delta===0 yields sign='' and the amount renders as '0 RP', not '+0 RP'. The spec's prose comment in EDIT 4 ('the amount shows +0 RP') and openQuestion #1 ('honestly shows +0 RP') mismatch the actual rendered string. This is cosmetic only and arguably MORE honest ('0 RP' for a forfeit that earned nothing), but the implementer should not 'fix' it to add a '+' thinking the code is wrong.
CORRECTION: No code change required. If the owner wants a literal '+0 RP' for forfeits, change the sign rule to `delta >= 0 ? '+' : ''`; otherwise leave as-is (recommended ? '0 RP' is accurate). Just align the comment if touched.

## [NIT] 4d-version-stamp-cross-phase — Cross-phase ?v coordination: 4d alone does not edit game.js but its EDIT 6 bumps game.js?v
EVIDENCE: 4d EDIT 6 instructs bumping multiplayer.js?v 324?333 (matches the live tag at index.html:5648) AND game.js?v 332?333 (live tag at 5644) for the start-screen version stamp, while explicitly NOT editing game.js source. That is harmless/correct ONLY because 4a (a sibling sub-feature) DOES edit game.js and also targets v333. The live bundle is currently game.js/jukebox.js/catalog.js=332, jukebox.css=332, multiplayer.js=324 ? the project bumps all ?v in lockstep. If 4d is applied in isolation without 4a, bumping game.js?v with no game.js change is cosmetically odd but breaks nothing (no-cache server). Note the 4d spec's EDIT 6 only updates multiplayer.js's tag in its newCode and references the game.js tag in prose ? the implementer must remember to also advance jukebox/catalog/jukebox.css to keep the bundle in lockstep per project law.
CORRECTION: When applying the full Phase 4, bump all of game.js/jukebox.js/catalog.js/multiplayer.js/jukebox.css ?v together to the new build number (333). No correction to the 4d logic itself.