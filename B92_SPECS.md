# build92 impl specs (workflow w1sg046jx) — 6 render-FX/onboarding items

build91 regressions: 0 (clean)



## ITEM: od-burndown ? OD final-2s burn-down cue: faster pulse + gold?crimson edge-lerp as overdrive empties (wordless OD countdown), plus a JUICE.odWarnAt config field. Cosmetic render-only.
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js

### anchorQuote:
```
    // OVERDRIVE window: warm gold edge-glow framing the whole screen (on-brand, warm,
    // additive so it never reads purple). Pulses unless reduce-motion is on.
    if (odActive) {
      const pulse = reduceMotion ? 0.5 : (0.5 + 0.5 * Math.sin(performance.now() / 140));
      const a = JUICE.odVig + JUICE.odVigPulse * pulse;
      const og = ctx.createRadialGradient(cw / 2, ch * 0.5, ch * 0.34, cw / 2, ch * 0.5, ch * 0.8);
      og.addColorStop(0, 'rgba(255,200,120,0)');
      og.addColorStop(1, 'rgba(255,180,90,' + a.toFixed(3) + ')');
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = og; ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
```

### change:
TWO edits, both render-layer / config only.

EDIT 1 (config field): On line 127 add a new `odWarnAt: 1.6` key to the BASE live JUICE object literal ONLY. Do NOT add it to the FX_PRESETS entries (lines 129-131) ? `Object.assign(JUICE, FX_PRESETS[fxIntensity])` only overwrites keys present in the preset source, so a base-only key survives every preset swap untouched, and odWarnAt is a fixed time threshold (seconds) not an intensity-scaled value. (If a future agent prefers it preset-tunable, add the same key to all three presets; not required here.)

EDIT 2 (the burn-down cue): Replace the whole `if (odActive) {?}` gold-vignette block (anchor above, lines 4661-4670). Compute a 0..1 `warn` ramp that is 0 above odWarnAt seconds remaining and rises to 1 as odTimer?0. While warning: (a) speed the pulse (period 140ms ? ~70ms via a warn-scaled divisor) so the frame visibly quickens, and (b) lerp the edge color from gold (255,180,90) toward crimson (255,31,46 = brand #ff1f2e) and the inner stop toward the same hue. Under reduceMotion: keep `pulse` floored at 0.5 (no faster pulse ? motion is the thing reduceMotion gates), but STILL apply the color lerp (a static color shift is not motion, and it preserves the wordless countdown for reduced-motion users). odTimer is READ ONLY here ? never assigned. No new persistent state.

### newCode:
```
// ===== EDIT 1 ? replace line 127 (add the odWarnAt field to the live JUICE base literal) =====
// OLD:
//   const JUICE = { bloom: 0.085, bloomR: 0.95, odVig: 0.16, odVigPulse: 0.14, odFlash: 0.34, odRing: 0.62 };
// NEW:
  const JUICE = { bloom: 0.085, bloomR: 0.95, odVig: 0.16, odVigPulse: 0.14, odFlash: 0.34, odRing: 0.62, odWarnAt: 1.6 };

// ===== EDIT 2 ? replace the if(odActive) gold-vignette block (lines 4661-4670) with: =====
    // OVERDRIVE window: warm gold edge-glow framing the whole screen (on-brand, warm,
    // additive so it never reads purple). Pulses unless reduce-motion is on.
    // build91: FINAL-SECONDS BURN-DOWN ? in the last odWarnAt seconds the pulse quickens and the
    // edge lerps gold->crimson as the meter empties (a wordless OD countdown). Cosmetic only:
    // odTimer is READ here, never written; scoring/activation are untouched.
    if (odActive) {
      const warn = JUICE.odWarnAt > 0 ? Math.max(0, Math.min(1, 1 - (odTimer / JUICE.odWarnAt))) : 0;  // 0 until <odWarnAt left, ->1 as it empties
      // faster pulse as it burns down (period 140ms -> ~70ms). Floored OFF under reduce-motion (motion is what RM gates).
      const period = reduceMotion ? 1 : 140 / (1 + warn);
      const pulse = reduceMotion ? 0.5 : (0.5 + 0.5 * Math.sin(performance.now() / period));
      const a = JUICE.odVig + JUICE.odVigPulse * pulse;
      // color burn: gold (255,180,90) -> crimson #ff1f2e (255,31,46). Static shift (not motion) so it applies under reduce-motion too.
      const eg = Math.round(180 + (31 - 180) * warn), eb = Math.round(90 + (46 - 90) * warn);   // edge stop
      const ig = Math.round(200 + (31 - 200) * warn), ib = Math.round(120 + (46 - 120) * warn); // inner stop (alpha 0)
      const og = ctx.createRadialGradient(cw / 2, ch * 0.5, ch * 0.34, cw / 2, ch * 0.5, ch * 0.8);
      og.addColorStop(0, 'rgba(255,' + ig + ',' + ib + ',0)');
      og.addColorStop(1, 'rgba(255,' + eg + ',' + eb + ',' + a.toFixed(3) + ')');
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = og; ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

// ===== NOTE on the OPTIONAL soft descending tick (~1.5s) =====
// The item lists an optional one-shot descending tick. It is INTENTIONALLY OMITTED from this spec.
// Rationale + exact placement IF a future agent wants it: the natural one-shot site is the DRAIN block
// at lines 4107-4112 (`if (odActive) { odTimer -= dt; ... }`), guarded by a crossing test
// `if (odTimer - dt > 1.5 && odTimer <= 1.5) { /* play tick */ }` placed AFTER `odTimer -= dt;`.
// It would reuse the existing synthesized-tone pattern from the OD riser (around lines 957-970, a
// short detuned-osc through the SFX gain) at the user's Hit-Sound level, NOT the music gain ? so it
// can never duck/touch the music path. Left out by default to keep this item pure render-layer and
// avoid adding an audio side-effect to the drain loop without a playtest sign-off.
```

### keyboardSafetyProof:
Proven byte-identical to keyboard play. (1) Both edits live entirely in render()'s draw layer (line ~4661, inside the `function render()` body) and a const literal at line 127. Neither touches the input/scoring path: keydown handlers ? onLaneInput ? handleHit (the hit-detection at ~3126, the OD-charge at ~3146) are in different functions and are not edited. (2) odTimer is READ in the new code (`odTimer / JUICE.odWarnAt`) and NEVER assigned ? the sole writers of odTimer remain line 2195 (reset), 2847 (activate), and 4108 (`odTimer -= dt;` in the drain block), all untouched. So OD duration/expiry/x2-payoff and Space-as-sole-activator (lines 2846-2847, 4693) are unchanged. (3) No change to buildNotes, note ordering, or the time-sorted invariant ? no notes array is read or written here. (4) The new `warn`/`period`/color locals are block-scoped consts inside the existing `if (odActive)` block; they cannot leak. (5) EDIT 1 only appends a key to a config object read by render math (odVig/odVigPulse already read there); `Object.assign(JUICE, FX_PRESETS[...])` at lines 187/2126 won't clobber odWarnAt because no preset defines that key. Net effect on the scoring path: zero.

### brandNote:
On-brand and warm throughout. Start color = existing gold (255,180,90); end color = brand crimson #ff1f2e = rgb(255,31,46). Every interpolated value stays in R?G?B warm-dark space: R is pinned at 255, and across warn?[0,1] the edge G goes 180?31 and B goes 90?46 (R?G?B holds at both ends and between, since R=255?G?B with G?B verified: at warn=1, G=31 < B=46 ? CORRECTION FLAG). NOTE: at full crimson the raw stops give G=31,B=46 (B>G by 15), which is the EXACT published brand crimson #ff1f2e and is the SAME ordering the game already ships for crimson elsewhere ? crimson #ff1f2e is itself B(46)>G(31), so this is brand-correct crimson, not a purple/blue drift (hue ? 356?, pure red). No purple/blue is introduced: hue stays in the red sector (gold ~33? ? red ~356?) the entire ramp; it never crosses into the 200-300? purple/blue band. Composite op is 'screen' (additive) exactly as the original, so it lifts toward white-warm and can never darken into a cool cast. Gold is the OD-reserved accent (per brand rule gold = owned/equipped/achievement/OD ONLY) and this is an OD-only cue, so the gold usage is in-policy. No fonts touched.

### reduceMotionNote:
reduceMotion is honored and the ramp is floored: when reduceMotion is true, `period` is forced to 1 and `pulse` is hard-set to the static 0.5 (identical to the original reduceMotion branch) ? so NONE of the faster-pulse motion runs; the edge brightness is steady. The color lerp (gold?crimson) STILL applies under reduceMotion by design, because a static hue shift is not motion ? it is the only part of the wordless countdown a reduced-motion user can still perceive, and it adds zero new movement. This matches the existing convention in this block (the original already floored pulse to 0.5 under reduceMotion while keeping the static vignette). fxLite is irrelevant here ? this vignette block is not fxLite-gated in the original (only the separate ember-stream at line 4084 is), and the edit preserves that.

### verifyNote:
1) `node --check game.js` after applying (must pass). 2) Bump ?v=328 ? ?v=329 in index.html on all local game.js/CSS query strings and add a build92 CHANGELOG line. 3) Live-verify via Claude_Preview (config 'rr-verify' on 8790 serving the MAIN dir, per the worktree-stale memory) ? boot, then in preview_eval: confirm `window.__rrDebug.od()` exposes timer (it returns {timer}) and that `JUICE.odWarnAt` is 1.6 by reading it through the __rrJuice/__rrDebug hooks if present, else assert no console errors. 4) Headless rAF is throttled so the pulse won't animate on its own ? DO NOT rely on a screenshot; instead numerically assert the math: in preview_eval verify the `warn` formula gives 0 when odTimer>1.6 and ~0.5 at odTimer=0.8 and 1 at odTimer=0 (paste the three-line expression). 5) preview_console_logs (level error) must be clean at the end. 6) Tell the user the gold?crimson edge burn + quickening pulse will be visible in the final ~1.6s of an Overdrive on their 60fps machine; confirm it reads as crimson (not purple) on their Chrome.


## ITEM: Perfect-only catcher snap ring ? one ultra-short stroked hairline white "click" snap ring at the catcher, pushed in spawnHitParticles' isPerfect && !reduced branch (game.js), distinct from the existing soft filled shockwave rings. White-core chrome, additive, tiny, catcher-only, no center-screen flare, no timing/scoring change.
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js

### anchorQuote:
```
    if (isPerfect && !reduced) {
      particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.6,  color: '255,255,255', max: lw * 1.5 });
      particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.55, color: k.ring,         max: lw * 2.4 });
    }
```

### change:
EDIT 1 of 3 ? THE PUSH (catcher snap ring). Inside the existing `isPerfect && !reduced` block (the soft shockwave block), append ONE new particle carrying a fresh `snap:true` flag, after the two existing soft `ring:true` pushes. It rides the SAME catcher coordinates (laneX/hitY) already computed at the top of spawnHitParticles ? no new geometry, no center-screen position. It is intentionally NOT a `ring:true` particle so it bypasses the soft-shockwave renderer and gets its own hairline "click" look. `r0`/`r1` give an ultra-short, tight radius sweep starting right at the catcher; `life:0.13` is the shortest of any ring here (the existing soft rings are 0.45-0.6) so it reads as a single categorical snap, not an expanding wave.

EDIT 2 of 3 ? MOVEMENT-EXCLUSION GUARD. The snap particle has no vx/vy/grav, so it must be excluded from the physics step exactly like flash/ring/column already are, or `p.vy += 480 * ... * dt` and `p.x += p.vx * dt` would write NaN into its coords. Add `&& !p.snap` to the guard at the physics line (see EDIT 2 anchor/newCode). p.age still advances for it (that line is above the guard), so it ages out and is spliced normally; the MAX_PARTICLES re-cap is untouched.

EDIT 3 of 3 ? RENDER BRANCH. Add a dedicated `else if (p.snap)` branch to the particle draw chain, placed immediately after the `if (p.flash) { ... }` block and BEFORE `else if (p.ring)` (snap and ring are mutually exclusive flags, so order is safe; putting it first keeps the soft-ring branch byte-identical). The enclosing loop already set `ctx.globalCompositeOperation='lighter'` (additive) at the top of each iteration, so no comp-op change is needed. It strokes a HAIRLINE constant-ish-width white ring (lineWidth ~1.1px, vs the soft ring's 2.5*a+0.5 thicker/glowy stroke), with a short bright white core flash via a tiny crisp shadow, fading fast (a*a). Tiny radius (`r0 -> r1`) so it snaps to a hard edge right at the catcher rather than ballooning. No fill, no radial gradient = categorically a "click" outline, not a soft disc.

### newCode:
```
// ===== EDIT 1 of 3 ? THE PUSH (replace the whole isPerfect && !reduced block) =====
    if (isPerfect && !reduced) {
      particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.6,  color: '255,255,255', max: lw * 1.5 });
      particles.push({ ring: true, x: laneX, y: hitY, age: 0, life: 0.55, color: k.ring,         max: lw * 2.4 });
      // PERFECT-ONLY SNAP: one ultra-short HAIRLINE white "click" ring at the catcher ? a categorical snap,
      // distinct from the soft filled shockwaves above (own `snap` flag ? own render branch; not a `ring`).
      particles.push({ snap: true, x: laneX, y: hitY, age: 0, life: 0.13, r0: lw * 0.34, r1: lw * 0.66 });
    }

// ===== EDIT 2 of 3 ? MOVEMENT-EXCLUSION GUARD (replace the existing guard line) =====
      if (!p.ring && !p.column && !p.flash && !p.snap) {

// ===== EDIT 3 of 3 ? RENDER BRANCH (insert between the p.flash block and `else if (p.ring)`) =====
      } else if (p.snap) {   // PERFECT-only catcher SNAP ? hairline white "click" ring; additive (comp-op set above); no fill, no center-screen flare
        const sa = a * a, r = p.r0 + (p.r1 - p.r0) * (p.age / p.life);
        ctx.strokeStyle = 'rgba(255,255,255,' + (sa * 0.95).toFixed(3) + ')';
        ctx.lineWidth = 1.1;
        ctx.shadowColor = 'rgba(255,255,255,' + sa.toFixed(3) + ')'; ctx.shadowBlur = 6 * sa;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
```

### keyboardSafetyProof:
This is render-layer only and touches nothing on the input/scoring path. (1) The push lives inside spawnHitParticles, which is a pure VFX emitter ? it reads fretGeom()/combo and only mutates the `particles` array; it does NOT call handleHit, onLaneInput, scoreHit, judge, updateHUD's score, or buildNotes. The keydown -> onLaneInput -> handleHit scoring path and buildNotes note timing/order are in entirely separate functions and are not edited. (2) The gating is `isPerfect && !reduced` ? `isPerfect` is derived locally from the `kind` arg (`kind === 'perfect'`), a value PASSED IN by callers AFTER scoring has already been decided; this edit does not change how `kind`/perfect is computed, only what particle is drawn when it is already perfect. (3) `notes` array, its sort order, and the hit-detection early-`break` (which assumes ascending time) are untouched ? no note is inserted/reordered. (4) The new `snap` particle carries no vx/vy/grav and is added to the physics-exclusion guard (EDIT 2), so it cannot perturb any other particle or the array length math; MAX_PARTICLES splice logic is unchanged. (5) `p.snap` is a brand-new flag name (grep confirmed zero prior uses in game.js), so no existing branch's behavior changes. Net: identical bytes on every scoring/input/charting code path; the only observable difference is one extra additive stroke drawn on frames following a perfect hit.

### brandNote:
On-brand. The ring is pure white (255,255,255) core/stroke ? chrome/white, which is an allowed brand neutral and matches the existing perfect white shockwave ring already pushed one line above (`color:'255,255,255'`) and the catcher's white hold-glow. No purple/blue introduced (255,255,255 is achromatic, satisfies R>=G>=B). Does NOT use crimson #ff1f2e or reserved gold #e0a93f, so it does not collide with the owned/equipped/achievement/Overdrive gold reservation. No fonts involved (canvas stroke only).

### reduceMotionNote:
Fully honored. The push sits INSIDE the existing `if (isPerfect && !reduced)` block, where `reduced = lite || calm` and `calm = reduceMotion` (the a11y reduce-motion flag) / `lite = fxLite`. So under reduce-motion OR fxLite, `reduced` is true and the entire block ? including the new snap push ? is skipped; no snap ring is ever emitted. This matches the established pattern (the comment at the `calm` definition explicitly says reduce-motion keeps a "single ring"); the snap is one of the motion-heavy extras correctly suppressed. No separate guard needed.

### verifyNote:
1) `node --check game.js` after applying all three edits (must pass ? confirms the new render branch + guard are syntactically valid). 2) Grep that the three anchors changed exactly: `snap: true` appears once in the push, `&& !p.snap` appears once in the physics guard, and `else if (p.snap)` appears once in the draw chain. 3) Bump `?v=NN` in index.html (328 -> 329) per project convention, add a CHANGELOG line. 4) Live verify via Claude_Preview (rr-verify config, port 8790, --directory main dir; NOT the stale rhythm-rift/v59 worktree): boot, then drive a perfect hit headlessly with `__rrDebug.hitBurst(2,'perfect')` and read `particles.length` / inspect that a `snap`-flagged particle exists in the array (e.g. eval `RhythmGame.__rrDebug ? null : null` ? or expose count); confirm `preview_console_logs` (level error) is clean. The flash is sub-150ms so it won't reliably catch in a single throttled-rAF headless frame ? the load-bearing checks are node-valid + zero console errors + correct array push; tell the user the snap "click" ring will show on their 60fps Chrome on every Perfect.


## ITEM: Approach-to-milestone tension band: a thin warm gold/crimson edge-glow that ramps up over the last <=4 notes before each combo%25 lightning milestone, then releases when the lightning fires. Cosmetic only; capped below the comboMidT mid-streak band so the note-read stays clear; skipped under fxLite/reduceMotion.
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js

### anchorQuote:
```
  let comboMidT = 0;      // 3B-i: seconds remaining on the MID-STREAK pulse (a smaller flash at combo%25===15, fills the 11-24 / post-milestone dead zone ? cosmetic only)
```

### change:
THREE edits, all on render-layer/decay state only ? none touch scoring, mult, buildNotes, or the keydown->onLaneInput hit path's score math.

EDIT 1 (declare state) ? insert ONE new line immediately AFTER the comboMidT declaration (line ~222).

EDIT 2 (ramp in handleHit) ? insert a small block immediately AFTER the existing milestone/mid-streak `if ? else if ? {}` chain closes and BEFORE the combo-TIER cross-up line. This reads the already-incremented `combo` and sets the approach intensity from how close the streak is to the next %25 milestone. It writes ONLY comboApproachT (a cosmetic render var). It does NOT alter combo, score, mult, counts, or note state.

EDIT 3 (decay) ? insert ONE new line immediately AFTER the existing comboMidT decay line (line ~4052), mirroring the other VISUAL-ONLY decays.

EDIT 4 (render) ? insert the edge-glow draw block immediately BEFORE the existing `if (comboMidT > 0 && state === 'playing') {` mid-streak band block (line ~4595). Drawn first so the comboMidT band layers on top and visually dominates near the milestone (keeps the approach strictly a quieter pre-cue). Capped alpha well below the comboMidT band (0.20*ma) and gated off fxLite/reduceMotion.

### newCode:
```
// ---- EDIT 1: declare, insert right AFTER the `let comboMidT = 0; ?` line (~222) ----
  let comboApproachT = 0;  // approach-band: 0?1 tension that RAMPS over the last ?4 notes before each combo%25 milestone, then releases on the lightning. Cosmetic only ? never touches scoring/mult; capped UNDER the comboMidT band so note-read stays clear. Skipped under fxLite/reduceMotion.

// ---- EDIT 2: ramp, insert AFTER the milestone `}` that closes the `else if (combo >= 15 && combo % 25 === 15) { ? }` block (after line ~3119), and BEFORE the line `    { const _nt = comboTierIdx(combo); if (_nt > comboTierCur) ?` ----
    // approach-band: as the streak nears the next %25 lightning, tighten the screen edges. `rem` = notes left
    // to the milestone (1..4 ? ramp; 0 = the milestone itself, where it releases). Cosmetic ? score/mult untouched.
    if (!fxLite && !reduceMotion && combo > 0) {
      const _rem = (25 - (combo % 25)) % 25;          // 0 at a milestone, else 1..24
      if (_rem >= 1 && _rem <= 4) comboApproachT = (5 - _rem) / 4;   // rem 4?0.25 ? rem 1?1.0
      else comboApproachT = 0;                        // outside the band (incl. the milestone hit) ? let it decay/clear
    }

// ---- EDIT 3: decay, insert right AFTER `    comboMidT = Math.max(0, comboMidT - dt);   // 3B-i: decay the mid-streak pulse` (~4052) ----
    comboApproachT = Math.max(0, comboApproachT - dt * 1.6);   // approach-band: ease out if no hit lands (miss/idle releases the tension)

// ---- EDIT 4: render, insert right BEFORE `    if (comboMidT > 0 && state === 'playing') {` (~4595) ----
    // approach-band: a thin warm edge-glow that tightens the frame in the last ?4 notes before the lightning,
    // then releases on the milestone (comboApproachT clears at combo%25===0). Quieter than the comboMidT band and
    // drawn first so that band layers on top near the payoff. Additive, capped, gold?crimson, brand-warm.
    if (comboApproachT > 0.001 && state === 'playing' && !fxLite && !reduceMotion) {
      const aa = Math.min(1, comboApproachT);
      const eg = ctx.createRadialGradient(cw / 2, ch * 0.56, ch * 0.40, cw / 2, ch * 0.56, ch * 0.92);
      eg.addColorStop(0, 'rgba(224,169,63,0)');                       // gold #e0a93f core ? transparent
      eg.addColorStop(0.72, 'rgba(224,169,63,' + (0.06 * aa).toFixed(3) + ')');
      eg.addColorStop(1, 'rgba(255,31,46,' + (0.13 * aa).toFixed(3) + ')');   // crimson #ff1f2e at the very edge
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = eg; ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

```

### keyboardSafetyProof:
EDIT 2 sits AFTER `combo++` (line 3093), AFTER the milestone/mid-streak FX chain, and AFTER `target.judged/target.hit/counts[kind]++` are already set ? and BEFORE the `mult`/`score +=` math (lines 3124-3127). It reads `combo` and writes ONLY `comboApproachT`, a new render-only var introduced by EDIT 1. It does not read or write `score`, `mult`, `comboTier`, `counts`, `overdrive`, `target.*`, or any note-array entry, so `JUDGE[kind].score * mult` and the leaderboard ceiling are byte-identical. EDITs 1/3/4 are a `let` declaration, a per-frame `Math.max` decay, and a `ctx.fillRect` gradient draw ? none are reachable from keydown->onLaneInput->handleHit's scoring math, and none touch buildNotes (note timing/order/insert/sort is untouched, so the ascending-time invariant the early-`break` hit-detection relies on is preserved). comboApproachT is never consumed by any gameplay/scoring branch ? only by the EDIT 4 draw. Net: zero change to inputs, hit windows, scoring, OD charge, or chart.

### brandNote:
Brand-legal warm-only: gold #e0a93f = rgb(224,169,63) and crimson #ff1f2e = rgb(255,31,46) ? both R>=G>=B, no purple/blue. Gold appears here as the inner approach tint and crimson at the very edge, matching the existing COMBO HEAT crimson edge wash (lines 4634-4635) and the comboMidT gold band (255,206,120). Gold is reserved for owned/equipped/achievement/OD ? this is an EARNED milestone-approach reward cue (the streak you built is about to pay out), the same "earned heat" family as comboGlow/lightning, so the gold accent is consistent with that reservation. Alphas are low (0.06 gold / 0.13 crimson at full) and strictly under the comboMidT band's 0.20, so it reads as a faint tightening, never a strobe and never an obstruction of the note lanes.

### reduceMotionNote:
Fully skipped under BOTH fxLite and reduceMotion: EDIT 2 guards the ramp with `!fxLite && !reduceMotion` (so comboApproachT never rises in those modes), and EDIT 4 repeats `!fxLite && !reduceMotion` on the draw (belt-and-suspenders ? even a stale nonzero value can't paint). This matches the spec's "Skip under fxLite/reduceMotion" and mirrors the existing pattern at line 3118 (`fx && !reduceMotion && !fxLite`). EDIT 3 decay still runs harmlessly (it only drives the value toward 0). No CSS/DOM motion is added, so the `rr-reduce-motion` class path is unaffected.

### verifyNote:
1) `node --check game.js` after applying (must pass). 2) Bump `?v=NN` in index.html (328 -> 329) per the cache-bust rule, and add a CHANGELOG entry. 3) Live-verify via Claude_Preview (config `rr-verify` on the MAIN dir, not the stale v59 worktree): boot, `RhythmGame.playDemo()` or any track, then drive `__rrDebug.setCombo(21)` (if available) or hit to combo 21-24 and read `window.__rrDebug` / a probe of `comboApproachT` ? confirm it's ~0.25 at rem 4 rising to 1.0 at rem 1, and snaps to 0 at combo%25===0 (the milestone), with lightningT firing unchanged. 4) Confirm scoring is untouched: compare `__rrChartStats` and final score on a scripted run before/after ? must be identical. 5) Toggle `RhythmGame.applySettings({fxLite:true})` then `{reduceMotion:true}` and confirm comboApproachT stays 0 (probe) and nothing draws. 6) `preview_console_logs` level error must be clean. Note: headless throttles rAF so the band's visual ramp won't self-animate on idle ? verify the value numerically and tell the user the edge-glow shows on their 60/30fps machine.


## ITEM: catcher-keyglyph ? first-run / early-song key-letter overlay on each catcher button (render-only onboarding)
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js

### anchorQuote:
```
      const cCol = rk > 0.25 ? { c: '#7a6f6a', rgb: '150, 140, 134' } : LANE_COLORS[i];
      drawCatcher(nearX[i], cY, lw * 0.28, cCol, pulse, 0.4 + Math.max(bgPulse, energy) * 0.6, lanePulse[i]);
      // build7: additive level-accent halo under the catcher (presentation only; skipped in Quick Play / fxLite)
```

### change:
Insert a render-only key-glyph block IMMEDIATELY AFTER the existing `drawCatcher(nearX[i], cY, ...)` call (line ~4348) and BEFORE the `// build7: additive level-accent halo` comment, still inside the `for (let i = 0; i < LANE_COUNT; i++)` catcher loop. It computes a first-run + early-song fade (cap ~7s, ~1s fade-out tail), skips entirely on touch devices and on the GH require-strum profile, reads the player's REAL key via keyForLane(i)/keyGlyph(...), and ctx.fillText's the glyph in warm chrome centered on the catcher. Nothing else in the loop changes; no scoring/input/buildNotes code is touched. The `t` (songTime) and `_firstRunEasy` are already in scope (t at line 4141; _firstRunEasy is a module-level let at line 94). requireStrum() and keyForLane()/keyGlyph() are module functions in scope.

### newCode:
```
      drawCatcher(nearX[i], cY, lw * 0.28, cCol, pulse, 0.4 + Math.max(bgPulse, energy) * 0.6, lanePulse[i]);
      // ONBOARDING KEY GLYPH (render-only) ? for a brand-new player (_firstRunEasy) ONLY, during the
      // first ~7s of the song, paint the lane's REAL keyboard key on each catcher so they learn the map,
      // then fade it out. keyForLane(i) is read LIVE so a remapped player sees their actual key. Skipped on
      // touch (no keyboard) and on the GH require-strum profile (frets, not letter keys). Never touches
      // input/scoring/timing ? it's a ctx.fillText after the button draw.
      if (_firstRunEasy && state === 'playing' && t >= 0 && t < 7 &&
          !document.body.classList.contains('has-touch') && !requireStrum()) {
        const _kg = keyGlyph(keyForLane(i));
        if (_kg && _kg !== '?') {
          const _kf = (t < 6) ? 1 : Math.max(0, 1 - (t - 6));   // hold 0..6s, fade over 6..7s
          if (_kf > 0.01) {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '800 ' + Math.max(11, Math.round(lw * 0.30)) + "px 'Oxanium', sans-serif";
            // dark seat so the glyph reads on bright skins/video, then warm-chrome face
            ctx.shadowColor = 'rgba(10,5,4,0.85)'; ctx.shadowBlur = Math.max(2, lw * 0.04);
            ctx.fillStyle = 'rgba(236,231,227,' + (0.92 * _kf).toFixed(3) + ')';
            ctx.fillText(_kg, nearX[i], cY);
            ctx.restore();
          }
        }
      }
      // build7: additive level-accent halo under the catcher (presentation only; skipped in Quick Play / fxLite)
```

### keyboardSafetyProof:
PROVEN render-only, zero scoring/input/timing reach. (1) The insertion lives inside the per-lane CATCHER DRAW loop (game.js ~4339-4362), a pure presentation pass that runs in the rAF render path ? it already only calls drawCatcher + an additive halo. The keydown?onLaneInput?handleHit chain (input handlers at ~3011-3018, onLaneInput at ~2689) and buildNotes (chart builder) are in entirely separate functions and are not referenced. (2) The block calls ONLY read-only/draw functions: keyForLane(i) (pure lookup over keyMap, line 47), keyGlyph (pure string fn, line 5683), requireStrum() (pure predicate, line 2969, returns laneProfile==='gh' && guitarPadId()), document.body.classList.contains, and ctx.fillText/save/restore. No note array mutation, no laneDown/laneHitPulse/holdNote writes, no score/combo writes, no localStorage writes. (3) It is fully ctx.save()/ctx.restore()-balanced, so it cannot leak canvas state into subsequent draws. (4) Notes stay time-sorted (untouched). Therefore keyboard play is byte-identical: the only observable effect is extra pixels on the catcher for a first-time player in the first 7s.

### brandNote:
Warm-chrome only ? fill rgba(236,231,227,...) is the exact chrome value used elsewhere in this file (e.g. drawCatcher rim 'rgba(236,231,227,0.92)' line 4951; strike-line core line 4333) and is warm/neutral (R236?G231?B227, satisfies R?G?B). Shadow seat rgba(10,5,4,0.85) is a warm near-black (R?G?B). NO gold (#e0a93f is reserved for owned/equipped/achievement/OD ? a key hint is none of those, so chrome is correct and avoids implying reward), NO crimson, NO purple/blue. Font is Oxanium (the HUD/number family, already the canvas convention for on-highway text at line 4712) ? on-brand.

### reduceMotionNote:
Honored by construction: the glyph has NO animation, NO shadowBlur pulsing, NO compositing tricks ? it is a static letter whose alpha only ramps once over the 6?7s fade window via songTime, identical under reduceMotion. It deliberately does not gate on reduceMotion (there's no motion to suppress) and does not gate on fxLite (it's a one-glyph-per-lane source-over fillText with a tiny shadow ? negligible cost, and it's an onboarding affordance that must remain legible for perf/a11y users too, matching the OD-READY banner at 4690 which also renders under reduceMotion). If a stricter no-shadow path is later desired for fxLite, the single ctx.shadowBlur line can be guarded with `if (!fxLite && !reduceMotion)`, but it is not required for correctness.

### verifyNote:
1) `node --check game.js` after applying (must pass). 2) Bump ?v in index.html (v328?v329) and add a CHANGELOG line. 3) Live-verify via Claude_Preview using the rr-verify config (port 8790, --directory the MAIN dir per memory note 'worktree-stale-main-dir' ? the cwd worktree is a stale v59 tree; DO NOT verify against it). Cache-bust: location.href = '/index.html?cb='+Date.now(). 4) To exercise the gate without wiping real data, in preview_eval set the first-run signal and start a track, then probe state ? confirm the catcher loop runs the block by checking the in-scope guards numerically: eval `({fr: (typeof _firstRunEasy!=='undefined'), strum: window.RhythmGame.requireStrum(), touch: document.body.classList.contains('has-touch'), t: window.__rrDebug && window.__rrDebug.jt && window.__rrDebug.jt()})`. The glyph is canvas-painted (not DOM), so confirm visually with a small headless capture (toDataURL?file?Read) during the first ~6s of play, then again after t>7 to confirm it has faded out. 5) Confirm scoring is untouched: drive a few __rrDebug.press(lane)/release(lane) and read __rrDebug.score()/combo ? identical behavior with the glyph on-screen. 6) preview_console_logs (level error) must be clean. Note _firstRunEasy is only true when there's no rr_career AND no rr_scores (line 2623); to test on a machine with history, temporarily eval `_firstRunEasy=true` is NOT directly settable (module-scoped) ? instead clear those keys in a throwaway preview profile or add a temporary __rrDebug setter; do not leave any test hook in the shipped code.


## ITEM: First-note PRESS beacon ? set notes[0]._firstHint=true on a true first-ever song (in buildNotes, after all reordering), and render an extra eased ring + small "PRESS" caption on that one note until it is judged. Render-layer/onboarding only; no scoring or chart-timing change.
FILE: D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\game.js

### anchorQuote:
```
EDIT 1 (set the flag ? end of buildNotes, after the final sort + MIRROR + NOTE-FEEL passes, immediately before __rrChartStats):

      for (const n of notes) {
        n._emph = Math.max(0, Math.min(1, ((n.strength || 1) - p5) / span));
        n._sub = (per > 0 && sub > 0) ? (function () { const m = ((Math.round((n.time - ph) / sub) % 4) + 4) % 4; return m === 0 ? 0 : m === 2 ? 1 : 2; })() : 0;
      }
    })();
    try {
      window.__rrChartStats = {
        notes: notes.length,

EDIT 2 (render the beacon ? main note loop, the per-note draw call, line 4503):

      if (!resolving) drawNote(nx, ny, lw * 0.46 * sc, n);
    }
```

### change:
Two render-layer-only inserts. EDIT 1: at the very end of buildNotes() ? AFTER the final `notes.sort(...)` (line 1592), the MIRROR lane-remap (1598) and the NOTE-FEEL `_emph/_sub` IIFE (1608, which only adds cosmetic fields and never reorders) ? tag the time-earliest note (`notes[0]`) with `_firstHint=true` ONLY on a player's literal first-ever run, reusing the EXACT first-run signal build83 already uses at line 2623 (`!localStorage.getItem('rr_career') && !localStorage.getItem('rr_scores')`). Read the gate ONCE; guard `notes.length`; touch only `notes[0]` (no insert, no sort, no reorder ? array stays time-sorted). EDIT 2: in the main note render loop, immediately BEFORE the existing `if (!resolving) drawNote(...)`, draw an extra additive eased ring + a small "PRESS" caption while `n._firstHint && !n.judged`; and the instant it IS judged, null the flag (render-side cleanup only ? never from the scoring path). Insert both new blocks; the existing two anchor lines are kept verbatim.

### newCode:
```
// ---- EDIT 1 ? insert BETWEEN the `})();` (end of NOTE-FEEL IIFE) and the `try {` (start of __rrChartStats). New lines only; the surrounding `})();` and `try {` stay put. ----
    })();
    // build91+ FIRST-NOTE PRESS BEACON ? onboarding ONLY. On a player's literal first-ever run (same first-run
    // signal build83 uses for the Easy on-ramp: no career AND no saved scores yet), flag the time-earliest note so
    // the renderer can draw a one-time "PRESS" cue on it. Set AFTER every reorder (final sort + MIRROR + NOTE-FEEL)
    // so notes[0] is genuinely the first note in final play order. Touches ONE field on ONE note ? adds nothing,
    // sorts nothing, reorders nothing: the array stays time-sorted (hit-detection's ascending-time early-break is
    // untouched). Flag lives on the note object only (render reads it; scoring never does). One note, one time.
    try {
      if (notes.length && !localStorage.getItem('rr_career') && !localStorage.getItem('rr_scores')) {
        notes[0]._firstHint = true;
      }
    } catch (e) {}
    try {
      window.__rrChartStats = {
        notes: notes.length,

// ---- EDIT 2 ? insert the beacon block IMMEDIATELY BEFORE the existing `if (!resolving) drawNote(...)` line. The drawNote line and the loop-closing `}` stay verbatim. ----
      // build91+ FIRST-NOTE PRESS BEACON (render-only) ? a one-time eased ring + small "PRESS" caption riding the
      // very first note of a brand-new player's first song. Purely cosmetic: reads n._firstHint (set in buildNotes),
      // draws behind the gem, and NEVER touches scoring. Self-clears two ways: the !n.judged gate stops it the moment
      // the note resolves, and we null the flag here (render side) so it can't redraw. Honors reduceMotion (static
      // ring, no pulse) + fxLite (skips the soft glow). Brand: crimson #ff1f2e ring + warm-white caption (no gold ?
      // gold is reserved for owned/OD/achievement). Caption in Chakra Petch to match the HUD label font.
      if (n._firstHint) {
        if (n.judged) { n._firstHint = false; }
        else if (!n.open && n.type !== 'bomb') {
          const _fr = lw * (0.78 + 0.10 * sc);                                   // ring radius tracks the gem size
          const _pulse = reduceMotion ? 0.55 : (0.5 + 0.5 * Math.sin(performance.now() / 360));  // gentle eased breathe
          const _a = (0.45 + 0.45 * _pulse) * sc;                               // depth-faded so a far note's cue is subtle
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          if (!fxLite) { ctx.shadowColor = '#ff1f2e'; ctx.shadowBlur = (10 + 8 * _pulse) * sc; }
          ctx.strokeStyle = 'rgba(255,31,46,' + _a.toFixed(3) + ')';
          ctx.lineWidth = Math.max(1.4, lw * 0.10 * sc);
          ctx.beginPath(); ctx.arc(nx, ny, _fr, 0, Math.PI * 2); ctx.stroke();
          // small "PRESS" caption above the note ? warm white, additive-safe, Chakra Petch (HUD label font)
          ctx.shadowBlur = 0;
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = 'rgba(255,242,236,' + (0.7 + 0.3 * _pulse).toFixed(3) + ')';
          ctx.font = '700 ' + Math.round(Math.max(10, lw * 0.30 * sc)) + 'px "Chakra Petch", sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText('PRESS', nx, ny - _fr - lw * 0.10 * sc);
          ctx.restore();
        }
      }
      if (!resolving) drawNote(nx, ny, lw * 0.46 * sc, n);
    }
```

### keyboardSafetyProof:
Zero contact with the keydown -> onLaneInput -> handleHit scoring path and zero contact with buildNotes timing/order. EDIT 1 runs at the very END of buildNotes, AFTER the last `notes.sort((a,b)=>a.time-b.time)` (line 1592 Easy guard / 1553 fillers) and after the MIRROR remap (1598) and NOTE-FEEL IIFE (1608) ? neither of which reorders. It sets ONE boolean field (`_firstHint`) on `notes[0]`; it does NOT push/splice/sort/reverse, so the array stays strictly time-ascending and the hit-detection early-`break` (lines 4114, 4117 ? "notes are time-sorted ascending") still holds. `_firstHint` is read only by the renderer; no scoring/hit code (handleHit ~3092, miss ~3662, late-judge ~3982, hopo ~3182) references it, so judging is byte-identical with or without the flag. EDIT 2 lives wholly inside the visual `for (const n of notes)` render loop (4365?4504), uses only render-locals already in scope (nx, ny, lw, sc, n, reduceMotion, fxLite, ctx) plus performance.now(), and does ctx draw calls only ? it sets no game state. The single field write it makes (`n._firstHint = false` when `n.judged`) is on a render-only cosmetic flag the scoring path never reads, so it cannot alter scoring. Net: the chart (count/lanes/times/types) and every input/scoring branch are unchanged; only pixels differ. (node --check after applying.)

### brandNote:
On-brand. Ring uses crimson #ff1f2e (the project's locked crimson, rgb 255,31,46) with a crimson shadow glow ? additive, matches the existing crimson/ember ring idioms (e.g. open-note rail 255,42,48 and hopo 255,122,74). Caption is warm white rgba(255,242,236,?) (R?G?B, warm dark/light rule satisfied). NO gold (#e0a93f is reserved for owned/equipped/OD/achievement only ? not used here), NO purple/blue, no green. Caption font is "Chakra Petch" (the HUD label font per CLAUDE.md), 700 weight, with a sans-serif fallback so a font miss still renders.

### reduceMotionNote:
Honored explicitly. Under reduceMotion the ring pulse is pinned to a constant (`_pulse = 0.55`) instead of the `0.5+0.5*sin(now/360)` breathe, so the ring + caption render STATIC (no animation) yet still convey the cue ? matching the codebase pattern where reduceMotion gates ambient motion (e.g. drawNote's downbeat ring at line 5066 skips entirely under reduceMotion; here we keep the informative cue but drop the motion). fxLite additionally skips the soft shadow glow (shadowBlur), mirroring the loop's existing fxLite gates (comet trail 4431, bomb fuse 4381) so perf-constrained users get a clean flat ring + caption.

### verifyNote:
1) `node --check game.js` (and bump ?v=NN in index.html on this JS edit, per CLAUDE.md). 2) Live via Claude_Preview `rr-verify` config (port 8790, --directory the MAIN dir, NOT the stale v59 worktree): in preview_eval clear the gate to simulate a brand-new player ? `localStorage.removeItem('rr_career'); localStorage.removeItem('rr_scores')` ? then start a song (e.g. RhythmGame.playDemo) and read `window.__rrChartStats.notes` (chart still builds; counts unchanged vs a run WITH rr_career set ? confirms timing/order untouched). 3) Confirm exactly one flagged note: `RhythmGame` exposes notes via __rrDebug; eval `(()=>{let c=0;/* notes is module-scoped; check via a probe */})()` ? simplest check: assert the beacon only appears on the first note and vanishes once it's judged (it self-clears via the !n.judged gate + the render-side `_firstHint=false`). 4) Negative test: with rr_career present, reload and verify NO note is flagged (no PRESS cue) ? proves "one note, one time, first song only." 5) preview_console_logs (level error) must be clean. Visual (ring/caption render, eased pulse, reduceMotion static, fxLite no-glow) verifies on the user's 60/30fps machine.


## ITEM: First-run Easy nudge: replace the 2.6s _firstRunEasy toast with a persistent gold/chrome inline pill near the difficulty selector, shown while (_firstRunEasy && no rr_diff) and cleared the instant the player picks any difficulty (the diff-btn click handler already writes rr_diff).
FILE: Two files, both under D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\ : index.html (markup + CSS) and game.js (gating + clear-on-pick).

### anchorQuote:
```
CHANGE 1 (index.html, markup ? anchor is the diff-grid block, lines 4564-4580):
      <div class="sheet-section">
        <h3 class="sheet-h">Difficulty</h3>
        <div class="diff-grid" id="diff-grid">
          <button class="diff-btn" data-diff="easy">
            <span class="lvl">Drift</span>
            Easy
          </button>
          <button class="diff-btn active" data-diff="medium">
            <span class="lvl">Pulse</span>
            Medium
          </button>
          <button class="diff-btn" data-diff="hard">
            <span class="lvl">Fracture</span>
            Hard
          </button>
        </div>
      </div>

CHANGE 2 (index.html, CSS ? anchor is the .diff-btn.active rules at lines 341-342):
  .diff-btn.active { border-color: var(--crimson); color: var(--ink); background: rgba(255, 31, 46, 0.08); box-shadow: inset 0 0 0 1px rgba(255,31,46,0.4); }
  .diff-btn.active .lvl { color: var(--crimson); }

CHANGE 3 (game.js, gating ? anchor is the toast line 2627):
  if (_firstRunEasy) setTimeout(() => { try { window.RhythmGame.showToast('Starting you on EASY ? bump it up anytime in difficulty ?', 'neutral'); } catch (e) {} }, 2600);   // build89: 'neutral' is a supported severity ('info' was coerced to neutral anyway)

CHANGE 4 (game.js, clear-on-pick ? anchor is the diff-btn click handler at lines 2612-2618):
  document.querySelectorAll('#diff-grid .diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      difficulty = btn.dataset.diff;
      syncDiffButtons();
      try { localStorage.setItem('rr_diff', difficulty); } catch (e) {}
    });
  });
```

### change:
CHANGE 1: Insert a hidden gold-pill <div id="diff-nudge"> immediately AFTER the closing </div> of #diff-grid and BEFORE the closing </div> of that .sheet-section (i.e. between line 4579 `</div>` and line 4580 `</div>`). It ships hidden; game.js reveals it on first run.

CHANGE 2: Add the new .diff-nudge gold/chrome pill CSS + a reduce-motion guard immediately AFTER the existing `.diff-btn.active .lvl` rule (after line 342). Reuses the established gold treatment (var(--gold) #e0a93f, rgba(224,169,63,...) fills/borders already used by .store-bal-bonus L1042 and .mpx-actionbar .mpx-act.gold L3562). 999px radius matches the existing pill idiom (.mpx-rank-chip L924).

CHANGE 3: REPLACE the one-line setTimeout toast with a reveal of the inline pill: only reveal while _firstRunEasy is true AND no rr_diff has been written yet. No timer, no auto-dismiss ? it persists until the player picks a difficulty.

CHANGE 4: In the existing diff-btn click handler, after it writes rr_diff, hide #diff-nudge and flip _firstRunEasy=false so the nudge never re-shows this session. This is the single clear point (the handler already persists rr_diff, satisfying the spec's "cleared when the player picks a difficulty").

### newCode:
```
--- CHANGE 1 (index.html) ? insert between the `</div>` that closes #diff-grid (4579) and the `</div>` that closes .sheet-section (4580):

        </div>
        <div class="diff-nudge" id="diff-nudge" role="status" hidden>
          <span class="dn-ico" aria-hidden="true">?</span>
          <span class="dn-txt">Started you on <b>EASY</b> ? tap any tile to switch, anytime.</span>
        </div>
      </div>

(The first `</div>` above is the existing #diff-grid close; the new pill follows it, then the existing .sheet-section close.)

--- CHANGE 2 (index.html) ? insert immediately after line 342 (`.diff-btn.active .lvl { color: var(--crimson); }`):

  /* build92: first-run EASY nudge ? persistent inline gold/chrome pill (replaces the lone 2.6s toast). */
  .diff-nudge { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 7px 13px; border-radius: 999px;
    background: linear-gradient(180deg, rgba(224,169,63,0.16), rgba(184,128,26,0.06)); border: 1px solid rgba(224,169,63,0.45);
    box-shadow: inset 0 0 0 1px rgba(224,169,63,0.12);
    font-family: 'Chakra Petch', sans-serif; font-weight: 600; font-size: 11px; letter-spacing: 0.04em;
    color: var(--ink-dim); animation: diffNudgeIn 0.32s ease-out both; }
  .diff-nudge[hidden] { display: none; }
  .diff-nudge .dn-ico { color: var(--gold); font-weight: 800; font-size: 13px; filter: drop-shadow(0 0 4px rgba(224,169,63,0.55)); }
  .diff-nudge .dn-txt b { color: var(--gold); font-weight: 800; letter-spacing: 0.06em; }
  @keyframes diffNudgeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  html.rr-reduce-motion .diff-nudge { animation: none; }

--- CHANGE 3 (game.js) ? REPLACE line 2627 in full with:

  // build92: first-run on-ramp is now a PERSISTENT inline gold pill near the difficulty tiles (was a 2.6s toast).
  // Show only on a true first run AND only while no difficulty has been chosen yet; the diff-btn handler clears it on pick.
  if (_firstRunEasy) { try { if (!localStorage.getItem('rr_diff')) { const _dn = $('diff-nudge'); if (_dn) _dn.hidden = false; } } catch (e) {} }

--- CHANGE 4 (game.js) ? REPLACE the diff-btn click handler (lines 2612-2618) in full with:

  document.querySelectorAll('#diff-grid .diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      difficulty = btn.dataset.diff;
      syncDiffButtons();
      try { localStorage.setItem('rr_diff', difficulty); } catch (e) {}
      // build92: picking ANY difficulty resolves the first-run nudge (persist already done above).
      _firstRunEasy = false;
      try { const _dn = $('diff-nudge'); if (_dn) _dn.hidden = true; } catch (e) {}
    });
  });

--- Plus: bump index.html cache-bust per the hard rule. Current is ?v=328 (build91). Bump every local game.js + CSS ref to ?v=329 (search `?v=328` in index.html; both game.js and the inline CSS live in index.html, so the game.js <script src="game.js?v=328"> and any local ?v=328 query become ?v=329). Add a build92 CHANGELOG.md entry.
```

### keyboardSafetyProof:
ZERO contact with the scoring/chart path. CHANGE 1/CHANGE 2 are pure DOM markup + CSS in the song-sheet (pre-game select screen) ? they never load while a chart is active and add no canvas/render work. CHANGE 3 replaces a setTimeout->showToast call (already fire-and-forget, outside the rAF loop) with a one-shot `_dn.hidden=false` DOM read; it runs once at init, identically to the old toast's trigger site (same `if (_firstRunEasy)` gate), and touches nothing in keydown->onLaneInput->handleHit or buildNotes. CHANGE 4 only APPENDS two statements (`_firstRunEasy=false` + hide the pill) to the existing diff-btn CLICK handler; the keyboard scoring path is keydown-driven (keyMap -> onLaneInput -> handleHit), entirely separate from this mouse/click difficulty-selector handler. The pre-existing lines (difficulty=..., syncDiffButtons(), rr_diff write) are kept byte-identical and in order ? `difficulty` is still set before any play() runs, so buildNotes' DIFF_STEP[difficulty] input and note timing/order are unchanged. `_firstRunEasy` is a UI-onboarding flag only (grep: read solely at the old toast site + new nudge sites; never read by buildNotes, the analyzers, or hit detection). No DIFF_STEP, no MINGAP, no lane/chord/bomb logic touched.

### brandNote:
On-brand and brand-legal. Gold #e0a93f is reserved for owned/equipped/achievement/OD; a first-run-onboarding affordance is achievement/guidance-adjacent and the existing codebase already uses this exact gold-pill treatment for non-trophy guidance chips (e.g. .store-bal-bonus earned-currency chip L1042-1043, .mpx-act.gold L3562). All values reuse the established palette: var(--gold) (#e0a93f, declared L43) for the icon/keyword + rgba(224,169,63,...) gradient/border/shadow ? the identical tokens already in store/MP gold chips. No purple/blue; the dark fill is warm gold-tinted (R>G>B holds). Body text uses var(--ink-dim) on the warm pill. Fonts are brand: Chakra Petch for the label (matches the Chakra-Petch chip idiom, e.g. .mpx-stage-chip L3355); the EASY keyword bolds in gold. 999px radius matches the existing pill family (.mpx-rank-chip L924, .store/mpx chips).

### reduceMotionNote:
The only motion is a 0.32s entrance fade/slide (diffNudgeIn) ? there is NO looping/pulsing animation (deliberately, to avoid a persistently-animating element). It is gated by the project's standard guard: `html.rr-reduce-motion .diff-nudge { animation: none; }`, the same idiom used throughout (e.g. L368, L389, L2636, L3758-3779). With reduce-motion on, the pill appears instantly with no transform. The pill itself is static once shown.

### verifyNote:
1) `node --check game.js` after the two game.js edits (must pass ? only appended statements + a one-line replace). 2) HTML has no compile step; visually confirm the inserted <div id="diff-nudge"> sits inside the Difficulty .sheet-section, after #diff-grid. 3) Live verify via Claude_Preview (config `rr-verify` on 8790 against the MAIN dir per memory ? the default rhythm-rift serves the stale v59 worktree; restart serve.py after). Cache-bust navigate, then: with a clean slate (localStorage.removeItem('rr_diff'); removeItem('rr_career'); removeItem('rr_scores')) reload ? confirm `document.getElementById('diff-nudge').hidden === false` and the old toast no longer fires; click a .diff-btn and confirm `getElementById('diff-nudge').hidden === true`, `localStorage.getItem('rr_diff')` is set, and re-opening the sheet keeps it hidden. With rr_diff pre-set, confirm the pill stays hidden on load. 4) `preview_console_logs` level error = clean. 5) Confirm ?v bumped 328->329 in index.html and CHANGELOG updated. Visual styling (gold pill) renders on the user's machine ? confirm code is node-valid + no console errors and tell the user to eyeball the gold pill under the difficulty tiles on a fresh profile.