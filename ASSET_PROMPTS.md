# ASSET_PROMPTS — image/video generation prompts for the visual-overhaul pass

Ready-to-paste prompts for every new piece of art this build pass needs: in-game **Store**
item covers, per-tier **Levels** backgrounds (+ optional looping video backdrops), **Boss**
level art, and **UI** textures. Grouped by feature. Each entry has a **title**, the exact
**prompt** to paste into an image/video model, the **aspect / size**, and **where it's used**.

> Tip: paste the prompt as-is. The negative-prompt and the global style block below already
> enforce brand; you don't need to re-explain colors per item.

---

## BRAND LOCK (read once — applies to every prompt)

- **Palette (HARD):** black background, **crimson `#ff1f2e`**, **ember/orange `#ff7a4a`**,
  **chrome/silver `#dad7d2`**, **gold `#e0a93f`**. Warm darks only (near-black `#0a0706`,
  red-black `#160c0b`; R ≥ G ≥ B). **NO blue, NO purple, NO teal, NO cyan, NO magenta, NO pink.**
- **Mood:** dark crimson rhythm-game / Guitar-Hero energy — molten metal, embers, sparks,
  guitar-neck / fretboard motifs, lightning-on-the-strings, chrome bevels, gold trophy accents.
- **Finish:** high-contrast, glowing rim-light, cinematic; clean enough to read at small sizes.
- **Negative prompt (append to every image prompt):**
  `blue, navy, purple, violet, indigo, teal, cyan, magenta, pink, pastel, cool color cast,
  green grass, daylight, low contrast, washed out, watermark, text, lettering, logo, signature,
  UI chrome, frame, border, busy clutter, photorealistic human face, jpeg artifacts`
- **Where covers display:** Store tiles and Level cards render art in a **1:1 square**,
  `object-fit: cover` (so keep the subject centered, safe-area away from edges). Generate square
  unless noted. Match the existing covers in `assets/` (warm crimson gradients, ember radial
  top-right highlight, like `--lv-art-a/--lv-art-b` tones `#2a0a10 → #120407`).

---

## 1) STORE — item covers (3 seeded items)

Backend store items (item_id / item_type / price_sparks): `starter_pack`/pack/**500**,
`boss_neon`/level/**200**, `theme_neon`/addon/**100**. These render in the in-game Store grid
and as the "owned/locked" tiles. Square, read well at ~140–220px.

### 1a. Store · Starter Pack — song-bundle cover
- **Use:** Store tile for `starter_pack` (item_type `pack`, 500 Sparks). The first thing a new
  player is sold — should feel like "a crate of songs."
- **Aspect / size:** 1:1 — generate **1024×1024** (displays in a square tile, cover-fit).
- **Prompt:**
  > A premium loot-crate album bundle for a rhythm game, square cover art. A stack of three
  > glossy black vinyl-style song discs fanning out of an open chrome-edged crate, molten ember
  > light `#ff7a4a` spilling from inside, crimson `#ff1f2e` rim-glow, a few gold `#e0a93f`
  > star sparks rising. Warm near-black background `#0a0706` with a soft red radial vignette,
  > brushed-chrome highlights `#dad7d2`. Centered subject, dramatic top-right ember highlight,
  > high contrast, cinematic product-shot lighting. No text, no logos.

### 1b. Store · Boss Neon — level cover
- **Use:** Store tile for `boss_neon` (item_type `level`, 200 Sparks). Sells a single premium
  boss stage. Should read "elite challenge."
- **Aspect / size:** 1:1 — generate **1024×1024**.
- **Prompt:**
  > Square cover art for a premium boss-battle rhythm level. A menacing chrome-and-obsidian guitar
  > headstock looming head-on like a monster's skull, strings arcing with crimson `#ff1f2e`
  > lightning, molten ember cracks `#ff7a4a` glowing through black metal, a single gold `#e0a93f`
  > crown-like flare at the top. Warm black background `#0a0706`, heavy red rim-light, sparks and
  > floating embers, ominous and powerful. Centered, high contrast, cinematic. No text, no faces.

### 1c. Store · Theme Neon — theme tile
- **Use:** Store tile for `theme_neon` (item_type `addon`, 100 Sparks). A cosmetic skin/theme
  preview swatch. Should look like a "theme chip," more abstract/material than the others.
- **Aspect / size:** 1:1 — generate **1024×1024** (also crops fine to a smaller chip).
- **Prompt:**
  > Square abstract cosmetic-theme swatch for a rhythm game, "molten neon" skin. Flowing ribbons
  > of crimson `#ff1f2e` and ember-orange `#ff7a4a` neon energy over a warm black surface
  > `#0a0706`, brushed-chrome `#dad7d2` accent strokes, fine gold `#e0a93f` filament sparkles,
  > glossy reflective material, smooth gradient from deep red-black corners to a bright ember core.
  > Centered radial composition, premium, clean, high contrast. No text, no objects, no faces.

---

## 2) LEVELS — per-tier backgrounds (WARM-UP / PULSE / FRACTURE)

Three campaign tiers (`#levels-screen`). Tier accents in code: WARM-UP = warm-crimson/green-gold
"easy", PULSE = ember/gold "medium", FRACTURE = hard crimson. These are **wide background
panels** behind each tier's row of level cards (and/or the `#levels-screen` backdrop). Keep the
center calm and the energy at the edges so cards stay legible on top. They escalate in intensity
WARM-UP → PULSE → FRACTURE.

### 2a. Tier I · WARM-UP — background
- **Use:** Backdrop band for the WARM-UP tier (entry difficulty — calmer, inviting).
- **Aspect / size:** **16:9 — 1920×1080** (CSS-tiled/cover; safe to crop).
- **Prompt:**
  > Wide cinematic background for the opening tier of a rhythm game, calm and warm. A dark guitar
  > fretboard receding into warm-black haze `#0a0706`, gentle floating embers drifting upward,
  > soft crimson `#ff1f2e` glow low on the horizon fading to ember `#ff7a4a`, faint gold `#e0a93f`
  > dust motes, subtle brushed-chrome string highlights `#dad7d2`. Low intensity, lots of negative
  > space in the center, moody and inviting. No blue, no purple. No text, no characters.

### 2b. Tier II · PULSE — background
- **Use:** Backdrop band for the PULSE tier (mid difficulty — the beat is "on").
- **Aspect / size:** **16:9 — 1920×1080**.
- **Prompt:**
  > Wide cinematic background for the mid tier of a rhythm game, energized and pulsing. A guitar
  > neck angled through warm darkness with glowing crimson `#ff1f2e` fret markers, concentric ember
  > `#ff7a4a` shockwave rings rippling outward from the center like a kick-drum pulse, streaming
  > sparks, gold `#e0a93f` accent flares, chrome `#dad7d2` rim-light on the strings, warm black base
  > `#0a0706`. Rhythmic, punchy, medium intensity, center kept clear for cards. No blue/purple,
  > no text, no people.

### 2c. Tier III · FRACTURE — background
- **Use:** Backdrop band for the FRACTURE tier (hard difficulty — everything's breaking apart).
- **Aspect / size:** **16:9 — 1920×1080**.
- **Prompt:**
  > Wide cinematic background for the hardest tier of a rhythm game, intense and shattering. A black
  > guitar fretboard cracking apart with molten ember `#ff7a4a` lava glowing through the fractures,
  > violent crimson `#ff1f2e` lightning forking across the strings, exploding sparks and flying
  > debris, a hot gold `#e0a93f` core flash, brushed-chrome shards `#dad7d2`, warm near-black
  > atmosphere `#0a0706` thick with smoke. Maximum drama, high contrast, edges blazing, center
  > slightly calmer for legibility. No blue, no purple. No text, no faces.

### 2d–2f. (OPTIONAL) Per-tier looping video backdrops
- **Use:** Drop-in animated backdrops behind each tier (mirrors the existing `assets/moon-loop.mp4`
  cinematic backdrop pattern — DOM `<video autoplay loop muted playsinline>` behind the transparent
  canvas; gated off by `?novideo`/performance mode). Only do these if you want motion on the Levels
  screen; the static 16:9 stills above are the required deliverable.
- **Aspect / size:** **16:9, 1920×1080, ~6–10s seamless loop, no audio** (match moon-loop.mp4).
- **Prompt (WARM-UP loop):**
  > Seamless looping background video, warm and slow. Embers drifting gently upward through warm-black
  > haze over a dim guitar fretboard, a soft crimson-to-ember glow `#ff1f2e → #ff7a4a` breathing
  > slowly, faint gold dust. Calm, low motion, perfectly loopable, no camera cuts. No blue/purple,
  > no text.
- **Prompt (PULSE loop):**
  > Seamless looping background video, rhythmic. Ember shockwave rings `#ff7a4a` pulsing outward in
  > a steady beat from the center over a glowing crimson fretboard `#ff1f2e`, sparks streaming,
  > chrome string glints. Medium motion, hypnotic pulse, perfect loop. No blue/purple, no text.
- **Prompt (FRACTURE loop):**
  > Seamless looping background video, intense. Crimson lightning `#ff1f2e` forking across guitar
  > strings while molten ember cracks `#ff7a4a` flare and pulse through a black fractured fretboard,
  > flying sparks and embers, gold core flashes. High energy, fast flicker, seamless loop. No
  > blue/purple, no text.

---

## 3) BOSS — boss-level art

The `boss_neon` store item is one boss; this section gives the supporting art so a boss stage
feels distinct from a normal level (a hero/banner + a square card cover). Reuse 1b for the Store
tile; use these for the in-game boss intro/stage.

### 3a. Boss — stage hero banner (intro splash)
- **Use:** Boss-level intro / "VS" splash banner shown before the boss track starts (wide hero).
- **Aspect / size:** **21:9 ultrawide — 2560×1080** (or 16:9 1920×1080 if your splash is 16:9).
- **Prompt:**
  > Ultrawide cinematic boss-intro splash for a rhythm game. A colossal demonic guitar-amplifier
  > monster emerging from molten darkness — speaker-cones like glowing eyes radiating crimson
  > `#ff1f2e`, ember `#ff7a4a` flames pouring from its grille, chrome `#dad7d2` armor plating,
  > a gold `#e0a93f` crown of sparks above it, electricity arcing off guitar strings stretched
  > across the frame. Warm black void `#0a0706`, towering and intimidating, dramatic low-angle hero
  > shot, heavy rim-light, sparks everywhere. No blue, no purple. No text, no readable human face.

### 3b. Boss — level card cover (square)
- **Use:** The boss stage's square card in the Levels grid (distinct from the Store tile 1b).
- **Aspect / size:** 1:1 — **1024×1024** (cover-fit in card).
- **Prompt:**
  > Square level-card art for a boss stage in a rhythm game. A single glowing red skull fused into a
  > chrome guitar headstock, crimson `#ff1f2e` lightning crackling across the tuning pegs, ember
  > `#ff7a4a` flames licking up from the base, a gold `#e0a93f` star-power flare behind it, warm
  > black background `#0a0706` with a red radial vignette. Centered, ominous, high contrast,
  > cinematic. No text, no logos, no faces.

### 3c. (OPTIONAL) Boss — looping intro video
- **Use:** Animated boss reveal before the fight (same DOM-video pattern as moon-loop.mp4).
- **Aspect / size:** **16:9, 1920×1080, ~5–8s loop, no audio.**
- **Prompt:**
  > Seamless looping boss-reveal video for a rhythm game. A monstrous amp-creature breathing ember
  > fire `#ff7a4a`, crimson `#ff1f2e` lightning arcing off guitar strings, chrome plating catching
  > red rim-light, gold sparks raining, slow menacing pulse. Warm black void, high contrast, loops
  > seamlessly, no cuts. No blue/purple, no text.

---

## 4) UI — textures & accents (overhaul polish)

Small reusable surfaces that elevate the existing dark-crimson UI. Match the existing chrome HUD
art in `assets/` (`hud-badge.png`, `hud-bar.png`, `ring-*.png`, `atom.png`). Most of these want
**transparent PNG** so they composite over the warm-black UI.

### 4a. Sparks coin / glyph (currency icon upgrade)
- **Use:** The Sparks balance chip (`#rr-sparks` / `.spk-glyph`) and Store price tags. Replaces/
  upgrades the current inline glyph — a crisp branded "Spark" token.
- **Aspect / size:** 1:1 — **512×512, transparent PNG.**
- **Prompt:**
  > A single game-currency token icon on a transparent background: a glowing four-point ember spark
  > / star fused with a chrome ring, molten ember-orange core `#ff7a4a` blazing into crimson
  > `#ff1f2e` edges, brushed-chrome `#dad7d2` bezel, tiny gold `#e0a93f` sparkles. Centered, clean,
  > high contrast, app-icon clarity, soft outer glow. Transparent background. No text, no number.

### 4b. Store panel background texture (dark crimson)
- **Use:** Background fill behind the Store grid / modal panel — a subtle non-distracting texture.
- **Aspect / size:** **16:9 — 1920×1080** (or seamless tile; keep it low-contrast).
- **Prompt:**
  > Subtle dark background texture for a game store panel. Warm near-black `#0a0706` brushed metal
  > with very faint crimson `#ff1f2e` diagonal energy streaks and a soft ember `#ff7a4a` glow in one
  > corner, sparse gold `#e0a93f` micro-sparkles, fine chrome grain. Low contrast, mostly dark, NOT
  > busy — meant to sit behind UI cards. No blue/purple, no text, no objects.

### 4c. "Owned / Unlocked" seal badge
- **Use:** Overlay stamp on Store/Level tiles the player already owns (entitlement state).
- **Aspect / size:** 1:1 — **512×512, transparent PNG.**
- **Prompt:**
  > A circular "unlocked" achievement seal on a transparent background: a chrome `#dad7d2` ring with
  > a glowing gold `#e0a93f` checkmark/star center, crimson `#ff1f2e` inner rim-glow, ember `#ff7a4a`
  > sparks at the edge. Premium, embossed, high contrast, centered. Transparent background. No text.

### 4d. "Locked" / buy-to-unlock overlay glyph
- **Use:** Overlay on locked tiles (not yet owned) — pairs with the price tag.
- **Aspect / size:** 1:1 — **512×512, transparent PNG.**
- **Prompt:**
  > A padlock icon on a transparent background, rhythm-game style: dark chrome `#dad7d2` padlock body
  > with a glowing crimson `#ff1f2e` keyhole and a faint ember `#ff7a4a` glow, subtle gold `#e0a93f`
  > edge highlight. Clean, bold, centered, high contrast, soft outer shadow. Transparent background.
  > No text, no blue/purple.

### 4e. Level-card divider / tier ribbon flourish (optional)
- **Use:** Decorative accent on the tier headers (`.lv-tier-head`) — a thin energy flourish.
- **Aspect / size:** **Wide thin strip — 1600×200, transparent PNG.**
- **Prompt:**
  > A thin horizontal decorative energy flourish on a transparent background: a streak of crimson
  > `#ff1f2e` to ember `#ff7a4a` lightning with chrome `#dad7d2` glints and tiny gold `#e0a93f`
  > sparks, fading to nothing at both ends. Sleek, minimal, high contrast. Transparent background.
  > No text, no blue/purple.

---

## INTEGRATION NOTES (for whoever wires these in)

- Save new images under `assets/` (e.g. `store-starter.png`, `store-boss.png`, `theme-neon.png`,
  `tier-warmup.png`, `tier-pulse.png`, `tier-fracture.png`, `boss-hero.png`, `boss-card.png`,
  `spark-token.png`, etc.). Videos as `.mp4` (H.264, muted, loop-clean) like `moon-loop.mp4`.
- **Any new local asset referenced from CSS/HTML/JS needs the `?v=NN` cache-bust bumped** in
  `index.html` (currently **v72**) on integration, or the user's browser serves stale.
- Store/Level covers render in a **1:1 cover-fit** box — square art with a centered subject is
  safest. Tier backgrounds are **16:9 cover** behind cards, so keep the center low-contrast.
- Optional videos must respect the existing perf path: they live as DOM `<video autoplay loop muted
  playsinline>` behind the transparent canvas and are hidden under `?novideo`/performance bg-mode
  (see `#bg-video` / `html.rr-perf-bg`). Don't make them load-bearing.
- Brand check before shipping any asset: **no blue/purple anywhere, warm darks only (R ≥ G ≥ B).**
