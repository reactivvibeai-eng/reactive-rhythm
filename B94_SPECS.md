# build94+ impl specs (workflow w30momg4z) — top playtest majors



## ITEM: catcher-keyglyph ? first-run / early-song key-letter glyph on each catcher (render-only onboarding). Paints the lane's REAL keyboard key on 
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js

### anchorQuote:
```
      drawCatcher(nearX[i], cY, lw * 0.28, cCol, pulse, 0.4 + Math.max(bgPulse, energy) * 0.6, lanePulse[i]);
      // build7: additive level-accent halo under the catcher (presentation only; skipped in Quick Play / fxLite)
```

### change:
Insert a render-only key-glyph block IMMEDIATELY AFTER the existing `drawCatcher(nearX[i], cY, ...)` call (line 4348) and BEFORE the `// build7: additive level-accent halo` comment (line 4349), still inside the `for (let i = 0; i < LANE_COUNT; i++)` catcher loop (opens line 4340). The Edit keeps both anchor lines verbatim and inserts the new block between them.

Behavior: gate on `_firstRunEasy && state === 'playing'` (brand-new player only ? _firstRunEasy is set ONLY when there is no rr_career AND no rr_scores, line 2624), during songTime `t` in [0,7); skip on `document.body.classList.contains('has-touch')` (touch shows tap-zone glyphs already) and on `requireStrum()` (GH strum profile uses frets, not letter keys). Read the lane's REAL key via `keyGlyph(keyForLane(i))` so a remapped player sees their actual key. Compute a hold-then-fade alpha (full 0?6s, linear fade 6?7s). Paint the glyph DIM by default and BRIGHTER on press by lerping the alpha up with `laneHitPulse[i]` (already computed for this lane in the loop at line 4341 as part of `pulse`; read laneHitPulse[i] directly so the press-brighten is independent of the per-beat lanePulse component). ctx.fillText in warm chrome centered on the catcher at (nearX[i], cY) so it rides the recoil kick. Fully ctx.save()/ctx.restore()-balanced.

CRITICAL CORRECTION vs B92_SPECS item #4: keyGlyph (now at line 5691, was 5683 ? shifted +8 in v330) returns the EM DASH `'?'` for an empty/unmapped key, NOT `'?'`. B92's draft guard `_kg !== '?'` is a BUG ? it would never catch the sentinel and an unmapped lane would paint a literal `?`. The guard MUST be `_kg && _kg !== '?'`. Verbatim from current code: `function keyGlyph(k) { return !k ? '?' : (k === ' ' ? '?' : k.toUpperCase()); }`. Two-byte note: `'?'` is U+2014 EM DASH; copy it exactly from the function so the comparison matches.

### newCode:
```
      drawCatcher(nearX[i], cY, lw * 0.28, cCol, pulse, 0.4 + Math.max(bgPulse, energy) * 0.6, lanePulse[i]);
      // build93 ONBOARDING KEY GLYPH (render-only) ? for a brand-new player (_firstRunEasy) ONLY, during the
      // first ~7s of the song, paint the lane's REAL keyboard key on each catcher so they learn the map, then
      // fade it out. keyForLane(i) is read LIVE so a remapped player sees their actual key. DIM by default,
      // BRIGHTER on press (laneHitPulse[i]). Skipped on touch (no keyboard ? tap-zone glyphs cover it) and on
      // the GH require-strum profile (frets, not letter keys). Never touches input/scoring/timing ? it's a
      // ctx.fillText AFTER the button draw. NOTE: keyGlyph returns '?' (U+2014) for an unmapped key, so we
      // skip on that sentinel (B92 draft's '?' guard was wrong ? it never fired).
      if (_firstRunEasy && state === 'playing' && t >= 0 && t < 7 &&
          !document.body.classList.contains('has-touch') && !requireStrum()) {
        const _kg = keyGlyph(keyForLane(i));
        if (_kg && _kg !== '?') {
          const _kf = (t < 6) ? 1 : Math.max(0, 1 - (t - 6));            // hold 0..6s, linear fade 6..7s
          if (_kf > 0.01) {
            // DIM by default, BRIGHTER on press: lerp base 0.42 -> 0.95 by this lane's hit pulse.
            const _ka = (0.42 + 0.53 * Math.min(1, (laneHitPulse[i] || 0))) * _kf;
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '800 ' + Math.max(11, Math.round(lw * 0.30)) + "px 'Oxanium', sans-serif";
            // dark warm seat so the glyph reads on bright skins/video, then warm-chrome face
            ctx.shadowColor = 'rgba(10,5,4,0.85)'; ctx.shadowBlur = Math.max(2, lw * 0.04);
            ctx.fillStyle = 'rgba(236,231,227,' + _ka.toFixed(3) + ')';
            ctx.fillText(_kg, nearX[i], cY);
            ctx.restore();
          }
        }
      }
      // build7: additive level-accent halo under the catcher (presentation only; skipped in Quick Play / fxLite)
```

### keyboardSafetyProof:
PROVEN render-only, zero reach into the keyboard scoring path ? the owner plays keyboard and it stays byte-identical. (1) The insertion lives inside the per-lane CATCHER DRAW loop (line 4340, `for (let i = 0; i < LANE_COUNT; i++)`), a pure presentation pass in the rAF render body that today only calls drawCatcher + an additive level halo. The scoring path is entirely separate functions and is NOT referenced or edited: keydown handler ? onLaneInput (line 2698 `handleHit(lane, evTime)`) ? handleHit; the gamepad path at 3011?3018; and buildNotes (the chart builder). (2) The block calls ONLY read-only/draw functions: keyForLane(i) (pure lookup over keyMap, line 47), keyGlyph (pure string fn, line 5691), requireStrum() (pure predicate, line 2969 ? `laneProfile === 'gh' && !!guitarPadId()`), document.body.classList.contains, performance-free ctx.save/restore/fillText. It READS laneHitPulse[i] and t (songTime, line 4141) but writes NEITHER ? no assignment to laneHitPulse, laneDown, _frets, notes, score, combo, mult, overdrive, counts, or any localStorage key. (3) It is fully ctx.save()/ctx.restore()-balanced and sets globalCompositeOperation='source-over' INSIDE the save, so it cannot leak canvas state into the subsequent level-accent halo or note draws. (4) buildNotes is untouched: no note is inserted, reordered, or sorted, so the ascending-time invariant the hit-detection early-break relies on is preserved. (5) _firstRunEasy is a UI-onboarding flag (set at 2624, read at the old toast site + this glyph) never consumed by buildNotes, the analyzers, or hit detection. Net effect on the scoring/input/charting path: zero ? the only observable difference is extra pixels on the catcher for a first-time player during the first 7s.

### brandNote:
Warm-chrome only and brand-legal. Fill rgba(236,231,227,?) is the exact warm-chrome value already used in this file (drawCatcher rim, strike-line core) ? R236?G231?B227, satisfies the R?G?B warm-dark rule. Shadow seat rgba(10,5,4,0.85) is a warm near-black (R10?G5?B4). NO gold: #e0a93f is reserved for owned/equipped/achievement/Overdrive ONLY, and a key hint is none of those ? chrome is the correct choice and avoids falsely implying a reward. NO crimson #ff1f2e, NO purple/blue, NO green. Font is Oxanium (the HUD/number family, the canvas convention for on-highway HUD text in this file, e.g. the OD-READY banner) at 800 weight with a sans-serif fallback so a font miss still renders. Brightness is data, not chroma: the DIM?BRIGHT press response only scales alpha on the single chrome color, never shifts hue, so it can never drift off-palette.

### reduceMotionNote / verifyNote:
Honored by construction ? there is no motion to suppress. The glyph is a static letter: no shadowBlur pulsing, no per-frame oscillation, no compositing tricks. Its alpha changes only via (a) the one-time linear songTime fade over the 6?7s window and (b) the player's own press (laneHitPulse[i], which is the lane's existing hit-feedback envelope, not an ambient animation) ? both are direct responses to time/input, identical under reduceMotion. It deliberately does NOT gate on reduceMotion (matching the OD-READY banner, which also renders under reduceMotion because it is an informative affordance, not decorative motion) and does NOT gate on fxLite (one source-over fillText per lane with a tiny shadow is negligible cost, and the onboarding hint must stay legible for perf/a11y users ? they need the key map most). If a stricter no-shadow fxLite path is later wanted, the single `ctx.shadowBlur` line can be wrapped in `if (!fxLite && !reduceMotion)`, but it is not required for correctness or brand compliance.
1) `node --check game.js` after applying (must pass). 2) Bump `?v=330 ? ?v=331` in index.html (line 5644 `game.js?v=330`, plus any other local ?v=330 query strings) per the cache-bust hard rule, and add a build93 CHANGELOG line. 3) Live-verify via Claude_Preview using the `rr-verify` config (port 8790, `--directory` the MAIN dir per memory note 'worktree-stale-main-dir' ? the session cwd is a stale v59 worktree; do NOT verify against it). Cache-bust navigate: `location.href = '/index.html?cb=' + Date.now()`. 4) Confirm the corrected sentinel: in preview_eval assert `window.RhythmGame && true` then check `keyGlyph` behavior indirectly ? eval that an unmapped lane is skipped by confirming no stray '?' paints; the load-bearing correctness check is that the guard reads `'?'` (U+2014) not `'?'`. 5) Exercise the gate on a throwaway profile: `localStorage.removeItem('rr_career'); localStorage.removeItem('rr_scores')` then reload and start a track ? note _firstRunEasy is module-scoped and set during the first-run auto-Easy path (line 2624), so it is true on a genuinely clean profile; probe the in-scope guards numerically: eval `({strum: window.RhythmGame.requireStrum(), touch: document.body.classList.contains('has-touch'), t: window.__rrDebug && window.__rrDebug.jt && window.__rrDebug.jt()})`. 6) The glyph is canvas-painted (not DOM), so confirm visually with a small headless capture (canvas.toDataURL ? file ? Read) during the first ~6s of play, then again after t>7 to confirm it has faded out. 7) Confirm scoring untouched: drive `__rrDebug.press(lane)`/`release(lane)` and read `__rrDebug.score()`/combo ? identical with the glyph on screen, AND visually confirm the pressed lane's glyph brightens (laneHitPulse). 8) Negative test: with rr_career or rr_scores present, reload and confirm NO glyph paints (veterans never see it). 9) `preview_console_logs` (level error) must be clean. Do NOT leave any test hook (e.g. a __rrDebug _firstRunEasy setter) in shipped code.


## ITEM: kb-coachmark ? keyboard countdown coachmark (one-time "YOUR KEYS" lane-key pulse during the first 3?2?1 for keyboard players), parallel to t
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js  (logic) and  D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\index.html  (CSS only). No other files.

### anchorQuote:
```
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
```

### change:
GAME.JS ? EDIT 1 (logic): Inside runCountdown(), add a KEYBOARD-mode coach branch right after the existing touch tap-coach branch, BEFORE its closing `} catch (e) {}`. It is the mirror image of the tap-coach: gated on the SEPARATE flag `rr_keycoach_seen` (shown once ever, independent of the touch flag) and on the player being a NON-touch (keyboard) player ? i.e. `!document.body.classList.contains('has-touch')`. It also requires a real keyboard map (skip the GH require-strum/fret-controller profile, exactly as B92 item #4's catcher-keyglyph does, since that profile plays frets not letter keys). It calls layoutTapZones() to pin the (otherwise-invisible-for-keyboard) lane buttons onto the live string x-positions, writes each lane's REAL key letter onto its tap-zone button via a `data-key` attribute (read LIVE through keyForLane(i)/keyGlyph so a remapped player sees their own keys), adds the `keycoach` class to `#tap-zones`, and sets the seen flag. Because requireStrum() is referenced, see the note: it is the module predicate at game.js ~2969 ("requireStrum() is a pure predicate" per B92 item #4) and is in scope here.

GAME.JS ? EDIT 2 (strip): In the same runCountdown() `finally`, extend the existing strip so the keyboard coach is ALSO removed on every exit (normal end, supersede-return, or throw) and the per-button `data-key` attributes are cleared ? the finally already strips the touch coach, so this guarantees a superseded/aborted countdown can never leave the keyboard pulse or stale letters stuck on.

INDEX.HTML ? EDIT 3 (CSS only): Add a `.keycoach` rule-set immediately AFTER the existing tap-coach CSS block (which ends at line 1927, the `html.rr-reduce-motion #tap-zones.coach ... { animation: none; }` rule). Unlike the touch `.tap-zone::after` outline (which is gated `body.has-touch #game.active` and therefore invisible to keyboard players), the new `#tap-zones.keycoach .tap-zone::after` renders the lane outline AND the key letter (`content: attr(data-key)`) with NO has-touch gate, so keyboard players see it; a `#tap-zones.keycoach::before { content: "YOUR KEYS"; }` caption rides above, mirroring the tap-coach caption. Both pulse via the EXISTING `rrTapCoach`/`rrTapCoachLbl` keyframes (no new keyframes needed) and are silenced by both the `prefers-reduced-motion` query and the in-app `html.rr-reduce-motion` class, exactly like the tap-coach.

### newCode:
```
// ============================================================================
// EDIT 1 ? game.js, runCountdown(): add the KEYBOARD coach branch.
// Replace the existing touch-coach try-block (the unique anchorQuote above) with
// the SAME block plus the new keyboard branch appended before `} catch (e) {}`.
// ============================================================================
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
      // build93 (kb-coachmark): KEYBOARD analogue of the touch tap-coach above. The FIRST time a
      // keyboard (non-has-touch) player ever reaches a 3?2?1, pulse the lane outlines + print each
      // lane's REAL key letter on its column with a "YOUR KEYS" caption, so a first-timer learns the
      // map before a single note falls. Separate localStorage flag (rr_keycoach_seen) ? shown exactly
      // once, ever, independent of the touch flag. Skipped on touch (no keyboard) and on the GH
      // require-strum profile (frets, not letter keys ? same gate B92's catcher-keyglyph uses).
      // Reuses the same #tap-zones DOM + the .keycoach CSS twin of .coach; the finally below strips it.
      // PRE-PLAY VISUAL ONLY ? sets a data-key attribute + a class; never touches input/scoring/timing.
      if (_tz && !document.body.classList.contains('has-touch') && !requireStrum() &&
          !localStorage.getItem('rr_keycoach_seen')) {
        layoutTapZones();                 // pin the (keyboard-invisible) lane buttons onto live string x-positions
        const _zones = _tz.querySelectorAll('.tap-zone');
        for (let i = 0; i < _zones.length; i++) {
          if (i < LANE_COUNT) _zones[i].setAttribute('data-key', keyGlyph(keyForLane(i)));  // LIVE key ? respects remaps
          else _zones[i].removeAttribute('data-key');
        }
        _tz.classList.add('keycoach');
        try { localStorage.setItem('rr_keycoach_seen', '1'); } catch (e) {}
      }
    } catch (e) {}

// ============================================================================
// EDIT 2 ? game.js, runCountdown(): extend the existing finally strip.
// OLD finally (lines ~2337-2339):
//     } finally {
//       if (_tz) _tz.classList.remove('coach');
//     }
// NEW:
    } finally {
      if (_tz) {
        _tz.classList.remove('coach');
        _tz.classList.remove('keycoach');                                            // build93: strip the keyboard coach on every exit (end / supersede / throw)
        try { _tz.querySelectorAll('.tap-zone').forEach(z => z.removeAttribute('data-key')); } catch (e) {}  // clear the printed letters so they never linger
      }
    }

/* ============================================================================
   EDIT 3 ? index.html: insert IMMEDIATELY AFTER line 1927 (the existing
   `html.rr-reduce-motion #tap-zones.coach ... { animation: none; }` rule that
   closes the tap-coach block) and BEFORE the blank line / next CSS block.
   CSS only ? no markup change (the 5 .tap-zone buttons already exist).
   ============================================================================ */
  /* build93 (kb-coachmark): KEYBOARD-mode one-time coachmark. The touch tap-coach outline
     (.tap-zone::after) is gated `body.has-touch #game.active` so keyboard players never see it.
     While #tap-zones.keycoach is set (the very first 3?2?1 for a keyboard player, rr_keycoach_seen-
     gated), draw a pulsing crimson capsule on each lane column WITH that lane's real key letter
     centered in it (data-key set in JS), plus a "YOUR KEYS" caption above. No has-touch gate here ?
     this is the keyboard twin. Reuses the existing rrTapCoach / rrTapCoachLbl keyframes. Stripped
     the instant the countdown ends ? never seen again. */
  #tap-zones.keycoach .tap-zone::after {
    content: attr(data-key); position: absolute; left: 50%; top: 14px; transform: translateX(-50%);
    width: min(54%, 40px); height: calc(100% - 28px); border-radius: 999px;
    display: flex; align-items: center; justify-content: center;
    border: 1.5px solid rgba(255,42,48,0.9);
    box-shadow: inset 0 0 16px rgba(255,42,48,0.45), 0 0 16px rgba(255,42,48,0.55);
    font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 22px; letter-spacing: 0.02em;
    color: var(--ink); text-shadow: 0 0 12px rgba(255,42,48,0.8);
    opacity: 1; pointer-events: none; animation: rrTapCoach 0.95s ease-in-out infinite;
  }
  #tap-zones.keycoach::before {
    content: "YOUR KEYS"; position: absolute; left: 0; right: 0; top: -34px; text-align: center;
    font-family: 'Chakra Petch', monospace; font-weight: 700; font-size: 13px; letter-spacing: 0.18em;
    color: var(--ink); text-shadow: 0 0 12px rgba(255,42,48,0.7); pointer-events: none;
    animation: rrTapCoachLbl 0.95s ease-in-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    #tap-zones.keycoach .tap-zone::after, #tap-zones.keycoach::before { animation: none; }
  }
  html.rr-reduce-motion #tap-zones.keycoach .tap-zone::after,
  html.rr-reduce-motion #tap-zones.keycoach::before { animation: none; }
```

### keyboardSafetyProof:
PROVEN byte-identical to the keyboard scoring path. (1) Both game.js edits live wholly inside runCountdown() ? a PRE-PLAY async function that runs entirely BEFORE `_go()` calls player.play()/loop() (line 2278-2293, after the `await runCountdown()` at 2266). It does no input/scoring work: the keydown handlers ? onLaneInput (~2689) ? handleHit (~3092) chain and buildNotes (the chart builder + its final time-sort, the invariant the hit-detection early-break depends on) are in entirely separate functions and are NOT referenced or edited. (2) The new branch only READS: keyForLane(i) (pure lookup over keyMap, line 47), keyGlyph (pure string fn, line 5691), requireStrum() (pure predicate, ~2969 ? B92 item #4 confirms it is pure), document.body.classList.contains, layoutTapZones() (pure DOM-position pass, already invoked unconditionally at 2248/2251 during launch, so calling it again is idempotent and not new behavior). It only WRITES: a `data-key` attribute on the (cosmetic, touch-only) .tap-zone buttons, the `keycoach` CSS class on #tap-zones, and the `rr_keycoach_seen` localStorage flag ? none of which is ever read by onLaneInput/handleHit/buildNotes/scoring. (3) No notes array is read or written; note timing/order/sort is untouched, so the ascending-time early-break invariant holds. (4) The tap-zone buttons' own click/touch handlers (lines 2825+) are unaffected ? I add an attribute, not a listener, and the buttons stay transparent hitboxes; on a keyboard player they are visually inert except for this one-time countdown pulse and capture no input that the keyboard path uses. (5) EDIT 2 only EXTENDS the existing finally strip (which already removes 'coach') with a class removal + attribute clear ? same teardown idiom, guaranteeing a superseded countdown (myGen !== _playGen returns) can't leave state stuck. (6) The CSS (EDIT 3) is render-layer only and cannot reach JS at all. Net effect on every input/scoring/charting code path: zero. The owner's keyboard play is unchanged; the only observable difference is one-time extra pixels during the very first 3?2?1.

### brandNote:
On-brand and brand-legal (warm darks, R?G?B; crimson #ff1f2e; no purple/blue/green; gold reserved). The outline/glow uses rgba(255,42,48,...) ? the SAME crimson the existing tap-coach and open-note rail already ship (index.html lines 1893/1907-1908), keeping the two coachmarks visually a matched pair; it is the project's established gameplay crimson (hue ?356?, pure red, never drifts toward purple/blue). The key letter and "YOUR KEYS" caption use var(--ink) warm chrome (the same token the tap-coach caption uses at line 1918). NO gold #e0a93f is used ? correct, since a key hint is not owned/equipped/achievement/OD (matches B92 item #4's catcher-keyglyph reasoning, which also deliberately avoided gold for the same reason). Fonts are on-brand: the key glyph is Oxanium (the HUD/number family ? the catcher-keyglyph in B92 item #4 also renders the key in Oxanium, so the two key affordances match), and the caption is Chakra Petch (the label family, identical to the tap-coach caption). No new colors, tokens, or fonts introduced.

### reduceMotionNote / verifyNote:
Fully honored, via the exact idiom the tap-coach uses. The pulse animations (rrTapCoach on the outline, rrTapCoachLbl on the caption) are reused unchanged, and both are silenced by (a) the `@media (prefers-reduced-motion: reduce)` query and (b) the in-app `html.rr-reduce-motion` class override ? I added the `.keycoach` selectors to BOTH guards, mirroring lines 1922-1927 for `.coach`. Under reduce-motion the coachmark still renders fully (static crimson capsule + key letter + caption ? the informative onboarding content is preserved) but does NOT pulse/breathe, which is the correct treatment (motion is gated, information is kept). No JS-driven animation is added, so there is no rAF/transform motion to suppress beyond the two CSS keyframes already covered.
1) `node --check game.js` after EDIT 1+2 (must pass ? only an added branch + an extended finally). 2) index.html has no compile step; visually confirm the `.keycoach` rules sit right after line 1927 and before the next block. 3) Bump the cache-bust: index.html is currently ?v=330 (build93) ? bump every local game.js + inline-CSS ?v=330 ref to ?v=331 (the CSS lives inline in index.html, so the game.js <script src> query string is the one to bump) and add a build93/kb-coachmark CHANGELOG line. 4) Live-verify via Claude_Preview config `rr-verify` (port 8790, --directory the MAIN dir per the worktree-stale memory ? NOT the default rhythm-rift/v59 worktree); cache-bust navigate `location.href='/index.html?cb='+Date.now()`. To exercise the gate on a machine that may have seen it: in preview_eval `localStorage.removeItem('rr_keycoach_seen')`, ensure NOT touch (the harness reports `document.body.classList.contains('has-touch')===false` on the headless desktop browser), start a track (RhythmGame.playDemo), and during the 3?2?1 assert `document.getElementById('tap-zones').classList.contains('keycoach')===true` and that each active `.tap-zone[data-key]` equals its expected key (e.g. eval keyGlyph(keyForLane(i)) parity); also confirm `localStorage.getItem('rr_keycoach_seen')==='1'` after. 5) Confirm strip: after the countdown ends (or relaunch to supersede), assert `classList.contains('keycoach')===false` and no `.tap-zone` retains a `data-key`. 6) Negative: with `rr_keycoach_seen` pre-set, reload ? confirm `keycoach` is NEVER added. 7) Remap a key (bindLaneKey) then re-trigger on a fresh flag ? confirm the printed letter follows the remap. 8) preview_console_logs (level error) must be clean. The pulse won't self-animate under headless throttled rAF ? that's CSS, not rAF, but tell the user to eyeball the crimson key-letter pulse + "YOUR KEYS" caption during their very first 3?2?1 on their 60fps Chrome. Note: rr_keycoach_seen and the keycoach DOM hook are pre-play onboarding (not a __rrDebug dev hook), so they stay in the shipped build; nothing new to strip at content-freeze.


## ITEM: Header-search film cue: a video found via global header search renders in songCard(t) as a plain music ROW (status pill / grade / chevron) w
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\jukebox.js  (plus one CSS rule in D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\jukebox.css)

### anchorQuote:
```
    card.appendChild(text);
    // right ? status pill (not ready) ? grade badge ? or chevron
    const right = document.createElement('span'); right.className = 'sc-right';
    const ready = RC().trackReady(t);
```

### change:
In jukebox.js songCard(t), insert a single early VIDEO branch immediately after `card.appendChild(text);` and BEFORE the existing music right-cluster (`const right = ... ; const ready = RC().trackReady(t); ...`). The branch: when RC() exposes isVideo and RC().isVideo(t) is true, mark the row `.is-video`, build the `.sc-right` cluster with one `.sc-film` pill reading "FILM ? SOON", append it + the click handler (same RC().openSheet(t) used by the music path), and `return card` ? short-circuiting so the music status/grade/chevron block never runs for a video. Music rows are byte-identical (the branch is a no-op for them: isVideo is false). The new branch reuses the SAME click target (RC().openSheet(t)) the function already wires at its end, so behavior on tap is unchanged (the sheet already owns the Watch/Soon affordance ? Item 6). Also add the `.sc-film` CSS rule to jukebox.css (see newCode CSS block) so the pill matches the warm-chrome `.sc-status` / `.vc-badge` idiom (no gold, no crimson fill). Guard RC().isVideo with a typeof check so an older catalog build without isVideo simply renders the legacy music row (no throw).

### newCode:
```
// ===== jukebox.js ? insert this block on the line BETWEEN `card.appendChild(text);`
// and `// right ? status pill (not ready) ? grade badge ? or chevron`. Keep the
// existing music right-cluster lines exactly as-is BELOW this insertion. =====

    // VIDEO (AI Flixs found via global header search 'all' scope): render-only film cue.
    // A film must read as distinct from a song in mixed results ? show a "FILM ? SOON"
    // pill and suppress the music-only status/grade/chevron. Tap still opens the sheet
    // (which owns the Watch/Soon affordance), identical to the music path below.
    if (RC() && typeof RC().isVideo === 'function' && RC().isVideo(t)) {
      card.classList.add('is-video');
      const vright = document.createElement('span'); vright.className = 'sc-right';
      const fp = document.createElement('span'); fp.className = 'sc-film';
      fp.textContent = 'FILM ? SOON';   // ?  (warm-chrome pill ? not gold, not a playable cue)
      vright.appendChild(fp);
      card.appendChild(vright);
      card.addEventListener('click', () => RC().openSheet(t));
      return card;
    }
    // right ? status pill (not ready) ? grade badge ? or chevron
    // (music path continues unchanged from here)


/* ===== jukebox.css ? add this rule next to the existing `.sc-status` block
   (after line `.sc-status.s-failed { color: #ff6b78; }`). Mirrors the warm-chrome
   `.vc-badge` / `.sc-status` pill idiom; uses --chrome, NOT gold/crimson. ===== */

.sc-film {
  padding: 5px 10px; border-radius: 999px; white-space: nowrap;
  font-family: 'Chakra Petch', monospace; font-weight: 700; font-size: 9px;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--chrome, #dad7d2);
  background: rgba(10,7,5,0.55);
  border: 1px solid rgba(218,215,210,0.3);
}
```

### keyboardSafetyProof:
ZERO contact with the play path. The edit lives entirely in jukebox.js songCard(t) ? a DOM row BUILDER for the song-select list ? and one passive CSS rule. It does not import, reference, or alter game.js, the keydown?onLaneInput?handleHit scoring chain, buildNotes timing/order, the analyzer, or any provider. The branch only (a) adds a CSS class, (b) creates/append a non-interactive <span> pill, (c) reuses the SAME `card.addEventListener('click', () => RC().openSheet(t))` the function already attaches at its end ? no new key/pointer handler, no preventDefault, no focus trap. It is gated on RC().isVideo(t): for a music track isVideo is false, the branch is skipped, and the function falls through to the byte-identical legacy status/grade/chevron path ? music songCards (the only thing the keyboard owner ever launches into the engine) render and behave exactly as before. Videos are already hard-guarded out of every play entry (catalog.js line 1082 `if (!trackReady(track) || isVideo(track)) return;` and line 1151 launchTrack `if (!track || !trackReady(track) || isVideo(track)) return false;`), so this cue is purely cosmetic discovery labeling and cannot route a video into gameplay. node --check jukebox.js after applying.

### brandNote:
Brand-legal warm/chrome, no gold/purple/blue. Pill text color is var(--chrome, #dad7d2) (steel/chrome) ? deliberately NOT gold #e0a93f, which is reserved for owned/equipped/achievement/OD only; a film cue is neutral status, not a reward. Background rgba(10,7,5,0.55) is a warm near-black (R?G?B). Border rgba(218,215,210,0.3) is the same chrome hairline used by `.vc-badge` (jukebox.css:493) and `.sc-status` (border:1px solid currentColor), so the pill visually rhymes with the existing Flixs "Soon" badge and the music status pills. Font Chakra Petch matches `.vc-badge`. No crimson fill (crimson #ff1f2e stays a hover/focus accent, not a label background). The "?" separator matches the dot-join idiom already used in sc-sub (line 460). Result: a film row is instantly distinguishable from a song row, on-brand, and never reads as an earned/owned state.

### reduceMotionNote / verifyNote:
No animation, transition, or transform is introduced ? `.sc-film` is a static pill (only padding/color/border/background). Nothing to gate under prefers-reduced-motion; the cue is fully visible and stable for reduced-motion users. It also adds no new hover/scale motion to the row (unlike `.video-card`, which translates on hover ? intentionally NOT replicated here since this is a list row, not a poster). So it is inert for motion-sensitivity and for the headless rAF-throttled verify harness alike.
1) `node --check jukebox.js` (must pass). 2) Bump ?v=NN in index.html (currently v330 ? v331) for jukebox.js AND jukebox.css since both change. 3) Live verify via Claude_Preview (preview_start 'rhythm-rift' ? location.href + '?cb='+Date.now()): in console run a render probe without touching gameplay, e.g. evaluate that for a known video track id, the built row has class 'is-video' and querySelector('.sc-film') textContent === 'FILM ? SOON', and for a music track row .sc-film is null and the legacy .sc-status/.sc-grade/.sc-chev still appears. To exercise the real mixed path, type a query in the header search that matches both a song and a film and confirm the film row shows the pill while song rows are unchanged. 4) preview_console_logs (level error) must be clean. 5) Confirm music songCard markup is unchanged (the right-cluster for a ready music track still yields .sc-grade or .sc-chev), proving keyboard launch flow is untouched. CHANGELOG: note build94/v331 "songCard film cue (FILM ? SOON pill) for videos in mixed header-search results ? render-only, music rows byte-identical".


## ITEM: BEST-pass celebration: one-shot gold flash/pop + "NEW BEST!" pulse when #hud-best flips to BEAT BEST mid-song (cosmetic HUD only, fires once
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js (one line) + D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\index.html (CSS block)

### anchorQuote:
```
    if (_be2 && !_be2.hidden && _be2._best && score > _be2._best && !_be2.classList.contains('beaten')) { _be2.classList.add('beaten'); _be2.textContent = '? BEAT BEST'; }
```

### change:
EDIT 1 (game.js, line 3872 ? the existing one-shot flip site): inside the same already-once-gated branch, after the class+text swap, (a) set an explicit `_beatBestFired` flag (belt-and-suspenders alongside the existing `.beaten` gate so the dopamine beat can never re-fire within a run), (b) add a `.bestflash` cosmetic class that re-triggers the keyframe (remove-then-add via a forced reflow so a re-add would restart cleanly, though it only runs once), and (c) inject a one-shot floating "NEW BEST!" pulse label next to the chip that self-removes after the animation. NO read/write of score/combo/counts; no call into any scoring or input function ? this is the exact same branch that already does the silent text swap, we only append cosmetic DOM/class work. Keep the branch a single statement-block so the anchor stays unique.

EDIT 2 (index.html, CSS ? insert the keyframes + reduce-motion override immediately after the existing `html.rr-reduce-motion #hud-score.pop` rule at line 2044): define `@keyframes rrBestFlash` (gold pop: scale punch + brand-gold #e0a93f glow that settles to the existing crimson `.beaten` color), `#hud-best.bestflash { animation: rrBestFlash ... }`, the `.rr-best-pulse` floating "NEW BEST!" label (brand gold, Unbounded display, `@keyframes rrBestPulse` rise+fade), and a `html.rr-reduce-motion` override that disables BOTH animations and instantly hides the pulse label (mirrors the line-2044 pattern + the OS-level `*` reset at line 55).

### newCode:
```
// ============================================================================
// EDIT 1 ? game.js  (replace the single line at 3872 with the block below)
// ============================================================================
    if (_be2 && !_be2.hidden && _be2._best && score > _be2._best && !_be2.classList.contains('beaten')) {
      _be2.classList.add('beaten'); _be2.textContent = '? BEAT BEST';
      // build93 (best-pass juice): one-shot dopamine beat when you pass your own BEST mid-song.
      // Cosmetic HUD ONLY ? does NOT touch score/combo/counts or any scoring/input path; this is the
      // same already-once-gated branch (the .beaten class makes it unreachable a 2nd time). The explicit
      // _beatBestFired flag is belt-and-suspenders so the pop can never double-fire within a run.
      if (!_be2._beatBestFired) {
        _be2._beatBestFired = true;
        try {
          // gold flash/pop on the chip ? remove+reflow+add so the keyframe restarts cleanly
          _be2.classList.remove('bestflash'); void _be2.offsetWidth; _be2.classList.add('bestflash');
          // brief "NEW BEST!" pulse floated above the chip; self-removes after the rise+fade
          var _np = document.createElement('span');
          _np.className = 'rr-best-pulse'; _np.textContent = 'NEW BEST!';
          (_be2.parentNode || _be2).appendChild(_np);
          setTimeout(function () { try { _np.remove(); } catch (e) {} }, 1200);
        } catch (e) {}
      }
    }

/* ============================================================================
   EDIT 2 ? index.html  (insert this block right AFTER line 2044:
   `html.rr-reduce-motion #hud-score.pop, html.rr-reduce-motion #hud-score.pop-big { animation: none; }`)
   ============================================================================ */
  /* build93 (best-pass juice): a one-shot gold celebration when the live run passes the stored BEST.
     The chip pops + flashes brand-gold, then settles into the existing crimson `.beaten` color (rule above).
     #e0a93f gold is law-correct here ? passing your best is an ACHIEVEMENT (the gated gold use). */
  #hud-best.bestflash { animation: rrBestFlash 0.62s cubic-bezier(.2,1.45,.35,1); }
  @keyframes rrBestFlash {
    0%   { transform: scale(1);    color: #e0a93f; text-shadow: 0 0 12px rgba(255,31,46,0.4); }
    26%  { transform: scale(1.32); color: #f6c65a; text-shadow: 0 0 22px rgba(224,169,63,0.95), 0 0 9px rgba(255,210,90,0.85); }
    100% { transform: scale(1);    color: var(--crimson); text-shadow: 0 0 12px rgba(255,31,46,0.4); }
  }
  /* the floating "NEW BEST!" pulse ? brand gold, rises + fades once, pointer-inert, self-removed by JS */
  .rr-best-pulse {
    position: absolute; left: 0; top: -18px;
    font-family: 'Unbounded', sans-serif; font-weight: 800; font-size: 12px; letter-spacing: 0.06em;
    color: #e0a93f; text-shadow: 0 0 14px rgba(224,169,63,0.9), 0 1px 6px rgba(0,0,0,0.6);
    pointer-events: none; white-space: nowrap; z-index: 22; opacity: 0;
    animation: rrBestPulse 1.1s cubic-bezier(.2,1.2,.3,1) forwards;
  }
  @keyframes rrBestPulse {
    0%   { opacity: 0;   transform: translateY(6px)  scale(0.9); }
    20%  { opacity: 1;   transform: translateY(0)    scale(1.05); }
    72%  { opacity: 1;   transform: translateY(-10px) scale(1); }
    100% { opacity: 0;   transform: translateY(-22px) scale(1); }
  }
  /* honor reduced motion (in-app toggle): no pop, no pulse ? the chip still flips to its crimson `.beaten` state */
  html.rr-reduce-motion #hud-best.bestflash { animation: none; }
  html.rr-reduce-motion .rr-best-pulse { animation: none; opacity: 0; display: none; }

/* NOTE for the implementer: the chip's parent `.hud-block` (index.html ~5248) is a normal flow box; if the
   `.rr-best-pulse` absolute label does not anchor to it, add `position: relative;` to the chip's `.hud-block`
   (or set `#hud-best{position:relative}`). The label uses `top:-18px` to float just above the chip ? verify it
   isn't clipped by a panel `overflow`; if clipped, drop to `top:0` / increase z-index. Cosmetic-only either way. */
```

### keyboardSafetyProof:
BYTE-IDENTICAL gameplay. The owner's keyboard scoring path is keydown -> onLaneInput -> handleHit, plus buildNotes for chart timing/order ? NONE of those files/functions are touched. The only JS edit is INSIDE the existing `if (... score > _be2._best && !classList.contains('beaten'))` branch in updateHUD() at game.js:3872, which already performed the silent text swap; updateHUD is a render-only readout (it reads score/combo/counts to display them, never mutates them). The appended code only: reads `_be2._beatBestFired` (a private flag on the DOM node, not a game variable), adds/removes CSS classes on `#hud-best`, creates one `<span>` and schedules its removal. It calls no scoring/input function, does not read or write `score`, `combo`, `maxCombo`, `counts`, `stability`, `overdrive`, or any note/chart state, and does not alter buildNotes order/timing. The score-compare expression itself (`score > _be2._best`) is unchanged verbatim. The new `_beatBestFired` flag is redundant with the pre-existing `.beaten` class gate (once `.beaten` is set the branch is unreachable for the rest of the run), so the celebration provably fires at most once per run regardless. `node --check game.js` after applying.

### brandNote:
Brand-law compliant. Gold `#e0a93f` (and its highlight tint `#f6c65a`) is the achievement/owned/equipped/OD-gated color ? passing your own BEST is exactly an achievement, so gold is the correct (not exceptional) use here. The flash RESOLVES into the existing crimson `--crimson` `.beaten` end-state, so the steady-state chip stays on-brand (gold target -> crimson beaten, as already documented in QA2_FINDINGS line 231). No purple/blue anywhere; glows are warm (gold + crimson). The "NEW BEST!" label uses Unbounded (the display face reserved for big celebratory headers) at HUD scale. All darks/shadows are warm rgba over black. Reconciled with B92_SPECS item #4 (catcher key-glyph): that item is render-layer catcher iconography and shares no selector/keyframe with this ? no collision; this adds only `rrBestFlash`/`rrBestPulse`/`.rr-best-pulse`/`.bestflash`, none of which exist elsewhere (grep-verified).

### reduceMotionNote / verifyNote:
Two explicit overrides added, mirroring the existing line-2044 pattern: `html.rr-reduce-motion #hud-best.bestflash { animation: none; }` and `html.rr-reduce-motion .rr-best-pulse { animation: none; opacity: 0; display: none; }`. With reduce-motion on, the chip still performs its informational flip to the crimson `.beaten` state and text (the achievement is still communicated), but with NO scale-pop, NO flash, and the floating pulse is fully hidden (display:none, not just invisible). This also composes with the global `html.rr-reduce-motion *` reset at index.html line 55. The in-app toggle drives `<html>.rr-reduce-motion`, so the override fires for the owner's actual setting, not only the OS query.
1) `node --check game.js` (must pass ? single appended block, still one statement after the anchor branch). 2) Bump ?v=330 -> ?v=331 in index.html on this JS+CSS edit (CLAUDE.md hard rule). 3) Live, via Claude_Preview `rr-verify` config (8790, --directory main dir; the default rhythm-rift serves the stale v59 worktree per memory): load with cache-bust, start a track whose stored best is beatable, and in updateHUD confirm score-cross adds `.beaten` + `.bestflash` once and injects exactly one `.rr-best-pulse` that auto-removes (re-crossing must NOT re-add ? `_beatBestFired`/`.beaten` gate). Probe headlessly: `const c=$('hud-best'); c._best=10; ... ` then drive score past it via the live run; assert `c.classList.contains('bestflash')` true and `document.querySelectorAll('.rr-best-pulse').length<=1`. 4) Toggle in-app reduce-motion ON and confirm computed `animation` on `#hud-best.bestflash` is `none` and the pulse is `display:none`. 5) Score-safety regression: before/after the flip, `__rrDebug.score()` delta from the celebration alone must be 0 (the flip is render-only). 6) Check `preview_console_logs` (level error) clean. KEYBOARD: owner-feel unchanged ? handleHit/onLaneInput/buildNotes untouched.