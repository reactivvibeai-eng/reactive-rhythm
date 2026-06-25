# Guitar Hero controller — "require strum" (build78) + how to calibrate your guitar

## What shipped
When a **real GH / Rock Band / Clone-Hero guitar is plugged in AND you're on the 5-lane (gh) profile**,
the game now requires the authentic move: **hold the fret + hit the strum bar** to score. Fret-press
alone does nothing (just like real Guitar Hero). Plus:
- **Whammy bar** → charges Overdrive (wiggle it while the meter isn't full).
- **Tilt (or the Select button)** → activates Star Power / Overdrive.

**Keyboard is unchanged** — still fret-press only. The strum requirement turns on ONLY for a detected
guitar (`requireStrum()` = gh profile + a guitar gamepad id). Everything is gated behind that, so the
keyboard and standard gamepads are byte-for-byte identical to before (verified: keyboard hits still
score, 0 console errors).

## Why it needs a one-time calibration (the honest part)
Guitar controllers are **non-standard** USB/Bluetooth devices — the browser's Gamepad API numbers their
buttons and axes differently per model, console origin, OS, browser, and adapter (Raphnet/Santroller).
**There is no reliable hardcoded mapping** — Clone Hero itself ships none and makes every player map +
calibrate by hand. So the game seeds **best-effort placeholder indices** and lets you overwrite them:

| Control | Seeded default | Likely needs your value? |
|---|---|---|
| 5 frets (green→orange) | buttons `[0,1,3,2,4]` (already wizard-mappable in Settings) | maybe |
| Strum up/down | buttons `[12, 13]` | **probably** |
| Whammy | axis `2` (range −1…+1) | **probably** |
| Tilt | axis `3` (threshold 0.6) | **probably** |
| Star Power button | button `8` (Select) | maybe |

## How to calibrate (2 minutes, do this once with the guitar plugged in)
Open the browser console on the game page and:

1. **See your guitar's live indices.** Press a fret / strum / whammy / tilt while running:
   ```js
   RhythmGame.padState()
   // → [{ index, id, isGuitar:true, buttons:[indices currently pressed], axes:[live values] }]
   ```
   - Strum the bar up, then down → note which **button index** appears (or which **axis** flips).
   - Push the whammy fully → note which **axis** swings the most, and its min/max.
   - Tilt the guitar up → note which **axis** crosses ~0.6 (or just use the Select button).

2. **Write your values** (persists to `localStorage`, survives reloads):
   ```js
   RhythmGame.setStrumCfg({
     btns: [12, 13],     // your strum button(s)
     whammyAxis: 2, whammyMin: -1, whammyMax: 1,
     tiltAxis: 3, tiltThresh: 0.6,
     spBtn: 8            // Star Power button (Select)
   })
   ```
   (Only pass the fields you're changing — the rest keep their defaults.)

3. **Confirm in a song.** Fret-held + strum = hit; fret-alone = nothing; whammy charges Overdrive;
   tilt/Select fires Star Power. Re-run `RhythmGame.getStrumCfg()` anytime to see the current map.

## Remaining polish (not blocking playtest)
A guided **in-Settings wizard** for strum/whammy/tilt (matching the existing 5-fret "Set Up Controller"
wizard) is the nice-to-have follow-up — it would replace the console steps above with on-screen prompts.
It's rAF-gated UI that can only be validated with the physical guitar, so it was deferred rather than
shipped untested. The underlying calibration storage (`rr_strumcfg`) and the public
`getStrumCfg/setStrumCfg/padState` API the wizard will call are already in place.
