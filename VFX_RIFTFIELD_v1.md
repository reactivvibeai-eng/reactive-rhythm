# RIFTFIELD v1 — the shared Tier-I reactive particle core (build187)

> Owner spec (2026-07-12): "an extremely large complex particle system … reacts to the sound … intensifies
> through the music … cause vertigo … react to the waveform … something of beauty and impressiveness with code."
> Aligned via 4 owner decisions: **ONE engine/three skins · Z-TUNNEL warp vertigo · music+player BLENDED
> intensity · VISIBLE waveform ribbon.**

## What it is
A fake-3D field of ~1,900 particles (700 lite) living in `procbg.js`, streaming **toward the camera**
behind all three Tier-I level scenes. One engine, themed per level:

| Level | Skin | Field character | Ribbon |
|---|---|---|---|
| First Light (`dawn`) | light motes, pale gold | streams through the SKY, clipped at the horizon | **helix rising out of the sun** (its signature) |
| Steady Hands (`weave`) | thread-sparks, molten gold | drifts through the loom lattice | **horizontal WEFT thread woven across the frame** |
| Ember Drift (`ember`) | embers, red→orange | turbulent, strong updraft | off-axis fire serpent (left lane, center stays clear) |

## Reactivity map (who drives what)
- **bass/mid envelopes** → warp speed + field density (moment-to-moment life)
- **treble** → twinkle (strided draw-skip, zero alpha churn)
- **beatPunch** → transient speed surge + near-particle bloom
- **COMBO TIER** → caps the intensity ceiling (0.55 → 1.15): the player EARNS the top of the show
- **comboGlow/OD** → camera FOV *pull* (the vertigo ladder's top rung) + a third ribbon echo pass
- **waveform (`_wave`, time-domain)** → the ribbon's literal shape; ~25% of particle respawns seed ON the
  ribbon, so the field visibly condenses around the song's fingerprint
- **miss** → 0.25s calm/desaturate dip (shared `missK` grammar)

## Contracts kept (procbg law)
- All pools/sprites/color ramps allocated ONLY at the `_state.dirty` reseed (Float32Array; alloc-free frames)
- Far field = `fillRect` in 4 depth-band passes (4 fillStyle sets/frame, NO path ops); near field ≤ ~260
  pre-rendered sprite stamps under `lighter`; the only path ops are the ribbon's ≤3 polylines (~300 ops)
- `_soft` shed order: density ×0.55 → ribbon glow pass off → near cap halved
- reduce-motion: z-motion + camera pull frozen (ribbon still shows the wave — it is data, not motion)
- Warm hues only (0..58); headless `_feed` gets a synthetic serpent so captures exercise the ribbon path

## Tuning knobs (`_RF_THEMES` in procbg.js)
`count · speed · curl · up(draft) · ribY/ribX (ribbon lane) · ribAmp · ribMode ('depth'|'weft') · flat
(Y-perspective softener) · spread · nearL`. Pool sizes in `_rfSeed` (1900/620); energy blend + tier cap in
`_rfDraw`.

## Verified (capture review, build187)
Rest + peak frames captured for all three via the `_feed` harness and reviewed as images: dawn helix ignites
from the sun crest at peak / stays a faint filament at rest; weave's weft thread spans the loom; ember's storm
+ off-axis serpent leave the note corridor readable. Zero console errors; node --check clean.
