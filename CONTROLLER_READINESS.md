# Guitar-Hero controller readiness — PDP Riffmaster (verify on the real unit)

**Context:** owner ordered a **PDP Riffmaster** (Xbox/Windows, 5-fret). The game's GH path is architecturally
sound (fret-hold + strum, chord-safe, judged at the strum instant). But two plug-and-play assumptions are
**likely false** for a stock XInput Riffmaster on Windows/Chrome, and the input fixes below **must be tested
against the real hardware** — that's why only the safe defensive ones shipped now (build99R).

## ✅ Shipped now (build99R, safe even without hardware)
- **P0-1 — strum POV-hat fallback no longer gated on a non-`standard` mapping.** Chrome often reports the
  Riffmaster as a `standard` XInput pad even though its strum is a hat on **axis 9**; the old gate killed strum
  in that case. Now axis 9 is read whenever `ax.length >= 10` (normal gamepads have 4 axes, so they're unaffected).
  `game.js` pollGuitarAxes (~3049) + p2PollPad (~6491).
- **P0-3 — auto-adopt the guitar profile for a guitar-SHAPED pad.** `gamepadconnected` now applies the gh profile
  when the pad has `axes.length >= 10` even if Chrome's id has no "guitar"/"riffmaster" token. `game.js` (~6260).

## ⚠️ DO THE MOMENT THE RIFFMASTER ARRIVES (need the real unit to verify)
Plug it in on Windows/Chrome, open the browser console, and run `navigator.getGamepads()[0]` — record `.id`,
`.mapping`, `.axes.length`, and which button/axis the **strum**, **whammy**, and **tilt/Select** map to. Then:

1. **P0-2 — the Settings STRUM calibration step can't capture an AXIS strum** (only buttons). If the Riffmaster's
   strum is a hat/axis, the wizard times out capturing nothing. Fix: make the STRUM step sample **button OR axis**
   (reuse the tilt sampler at `game.js` ~5989, which already watches both). On an axis hit, set `strumCfg.strumAxis`
   + `strumAxisDir` and clear `strumCfg.btns`. `game.js` ~6015.
2. **P1-1 — no controller-only MENU NAVIGATION.** `pollGamepad` only runs while `state==='playing'`, so you can't
   pick a song / press Play / pause / leave results with just the guitar — fatal for a couch/TV setup. Add a small
   always-on gamepad menu poller (strum/D-pad = move selection, green fret/Start = confirm, Select = pause/back)
   wired to the jukebox selection + `RhythmCatalog.launchTrack` + pause/resume. `game.js` + `jukebox.js`.
3. **P1-2/P1-3 — whammy & Star Power feel.** Whammy only charges Overdrive while *wiggling* (delta>0.03) — change to
   charge on magnitude (held). Star Power activates via tilt-axis 3 (likely flat on the Riffmaster) or the Select
   button; confirm the real Select index and tell the player SP = the **Select/Menu** button (not tilt) on this guitar.
   Optionally bind an all-frets-held + strum chord as a no-calibration SP trigger. `game.js` ~3056-3068, ~6017.
4. **P2 polish** — seed `_strumAxisPrev` from the first observed axis value (avoid a ghost strum at song start);
   consider lowering `STRUM_DEBOUNCE_MS` (38) from 55 so fast tremolo strums aren't merged; let the one-shot
   auto-map re-fire when a guitar reconnects and the current padmap isn't the GH preset.

The **in-Settings "Set Up Controller" wizard** already maps every fret + strum/whammy/tilt manually, so even if a
P0 path misses, the player has a recovery — but P0-1/P0-3 (shipped) + P0-2 (wizard axis capture) are what make it
**plug-and-play**. Full analysis (with exact line numbers + the standard-mapping edge case) was produced by the
controller-readiness audit on 2026-06-26.
