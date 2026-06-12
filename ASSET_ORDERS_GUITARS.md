# ASSET ORDERS + THE STYLE CONTRACT — relay to the asset session

## §0 — THE STYLE FORMULA (USER-APPROVED 2026-06-12 — BYTE-IDENTICAL LAW)
Every asset generation prompt for this game — any model, any session, any agent — embeds this
paragraph VERBATIM (no paraphrasing, no shortening, single-asset regens included):

> high-gloss cinematic anime-metal concept art with photoreal materials — polished chrome,
> lacquered black wood, molten magma glow; aggressive angular silhouettes with sharp spikes and
> horns, fully rendered, no cartoon outlines; world in warm blacks and deep crimson with
> ember-orange glow, play elements in bright chrome and hot crimson that pop against the dark,
> rewards in warm gold; moody blood-moon concert atmosphere lit by hot crimson rim light; high
> contrast, clean readable silhouettes, consistent front-facing stage-view perspective

**STYLE TOKEN** (for length-limited fields only; same source of truth):
`cinematic anime-metal, warm black + crimson + chrome palette, ember glow, blood-moon rim light`

Rules riding the formula (from the Higgsfield stylization contract, .agents/skills + game bundle):
- **Per-level accents OVERRIDE only the accent hue** (Skully violet #a64dff, Bone Daddy bone,
  Melody pink) in the per-asset description — the formula itself never changes.
- **Transparency = KEY COLOR, never black**: generate on solid bright magenta #FF00FF (green
  #00FF00 if the asset is pink/magenta-ish; blue #0000FF if both clash), then key out —
  including ENCLOSED key-colored regions (the donut-hole rule).
- **Model routing — USER DECREE 2026-06-12: ALL images are generated with `gpt_image_2`. ONLY
  gpt_image_2.** The user explicitly disapproves of nano-banana output; the Higgsfield playbook's
  nano-banana routing is OVERRIDDEN for this project. (gpt_image_2: low ~0.5cr drafts, high 4cr
  finals.) Nano-banana may be used only if the user explicitly asks for it.
- **Regen budget: 2 attempts per asset**, then take the best and compensate in code.
- **Contact-sheet check before approval**: paste new assets side-by-side at relative scale and
  EYEBALL coherence vs the existing pack.
- **Cost discipline**: preflight get_cost before paid calls; batches >5cr get quoted to the user
  first.

## GUITAR ASSET ORDERS (v111) — relay to the asset session

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

## ORDER 3 — TITLE WORDMARK: "REACTIVE RHYTHM" (delivered slot is already wired)
**File: `assets/title-wordmark.png`** — transparent PNG, horizontal lockup, ~1600×440
(displayed at ≤620px wide — keep it legible when small).
Prompt: "REACTIVE RHYTHM" video-game TITLE LOGO / wordmark, anime metal aesthetic, bold angular
letterforms with chrome edges, **crimson #ff1f2e blood-moon rising behind the text**, chaotic
crimson energy — cracked magma veins, lightning arcs, ember sparks bleeding off the letters —
subtle music identity woven in (a waveform pulse or tremolo strings forming an underline),
black-transparent background, warm darks only, NO blue/purple. It must read instantly at
600px wide; the moon + chaos energy frame the words, never bury them.
The game's menu has a SELF-HEALING slot: drop the file in and the plain text title is replaced
automatically (nothing else needed).

## After delivery (engine side — I do this, automatically on the next pass)
1. Pixel string-tracking measurement → SKIN_GEOM entry (nutXF/bridgeXF at nutFY/bridgeFY).
2. Skully level swaps `guitarSkin` to the new file; Crimson Chaos wired as the default-level art.
3. Old files stay until the new ones verify in-game; do NOT delete anything.
