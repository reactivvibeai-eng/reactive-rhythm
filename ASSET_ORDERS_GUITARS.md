# GUITAR ASSET ORDERS (v111) — relay to the asset session

> **STANDING RULE (user decree 2026-06-11): EVERY guitar asset paints EXACTLY 5 STRINGS.**
> The game is 5-lane; 6-string art "kills it" (the user's words after the Skully playtest).
> Any future guitar with 6 strings will be rejected.

## Framing spec (applies to BOTH orders below — matches assets/guitar5.png)
- Vertical player-POV shot looking DOWN the neck: **neck dominates (~70% of the height)**,
  headstock at top (can crop), **body only a sliver at the bottom**.
- Aspect ratio **≈ 0.56 (w:h)** — e.g. 1080×1920. NOT taller/thinner (crimson-chrome/gold-relic
  at ~0.41 put the spawn row off-screen — that mistake is documented).
- **Exactly 5 strings**, clearly visible, evenly spaced, fanning slightly wider at the bridge
  than at the nut (real perspective). Strings must CONTRAST against the fretboard (light
  metal over dark wood) — the engine measures them by pixel contrast.
- Front-on or near-front-on render; warm darks only (R≥G≥B); no blue/purple cast outside the
  Skully order's violet identity.

## ORDER 1 — Skully guitar RE-RENDER (5 strings)
**File: `assets/guitars/violet-gothic-5.png`**
Prompt: Gothic electric guitar for the Skully "The World" level, photoreal render, vertical
player-POV down the neck (neck ~70% of frame, body sliver at bottom, aspect 0.56). Carved
bone-grey skull inlays on the fretboard, black thorned-rose vines and deep violet accents on a
near-black body, chrome hardware, **EXACTLY 5 metal strings** evenly spaced and clearly visible
against the dark fretboard. Moody violet rim light. Identity: violet #a64dff · bone · black.
(The current `violet-gothic.png` paints 6 strings — that is why it is being recreated.)

## ORDER 2 — DEFAULT level guitar: "CRIMSON CHAOS" (RYO style)
**File: `assets/guitars/crimson-chaos-ryo.png`**
Prompt: RYO's signature electric guitar — "Crimson Chaos" — photoreal render, vertical
player-POV down the neck (neck ~70% of frame, body sliver at bottom, aspect 0.56). Jet-black
body with aggressive spiky silhouette, **crimson #ff1f2e chaos energy** — cracked-magma glow
lines / lightning veins across the body, ember sparks — chrome hardware, RYO's **black atom
logo** on the body, **EXACTLY 5 metal strings** evenly spaced and clearly visible against the
dark fretboard. Brand: black · crimson · ember #ff7a4a · chrome. NO blue/purple.
This replaces the plain default guitar for Quick Play — it should feel like the game's
flagship instrument (match guitar5.png's anatomy so it drops into the same fit).

## After delivery (engine side — I do this, automatically on the next pass)
1. Pixel string-tracking measurement → SKIN_GEOM entry (nutXF/bridgeXF at nutFY/bridgeFY).
2. Skully level swaps `guitarSkin` to the new file; Crimson Chaos wired as the default-level art.
3. Old files stay until the new ones verify in-game; do NOT delete anything.
