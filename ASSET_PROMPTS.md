# ASSET_PROMPTS — Reactive Rhythm (detailed, filename-matched)

These are the EXACT files the game looks for. **Copy ONE prompt block per image, paste it whole into
your generator, and save the result with the exact filename into the open folder.** Each prompt is
self-contained (house style + palette + composition + negatives all baked in) — you don't need to add
anything. Generate **square 1:1, 1024×1024, JPG** for all covers (backdrops are 1920×1080, noted).

> Filenames here MATCH the code (the `AUTHORED[]` level `cover:` paths + the Store `STORE_ART` map).
> Drop a file in and it appears automatically — no code change. Cards self-heal to the level initial
> until the file exists, so you can do these in any order.

---

## HOUSE STYLE (already baked into every prompt below — here for reference)

All 9 level covers must read as ONE cohesive set, so every prompt shares this DNA:
- **Medium:** premium AAA music-game key art; cinematic stylized 3D render with painterly highlights,
  Octane/Redshift-quality lighting; think Guitar Hero / Hi-Fi Rush poster art, not a photo.
- **Composition:** a single centered HERO subject with a clean, bold silhouette; generous dark
  negative space toward the edges and a slightly brighter focal core (so it reads cropped to a square
  card AND tiny at ~180px on the intro splash); strong figure-ground separation; shallow depth of
  field with soft bokeh behind.
- **Recurring motif:** an electric-guitar neck / fretboard / strings somewhere in frame (ties the set
  together) — but it is the STAGE for the subject, never the whole picture.
- **Finish:** high dynamic range, deep WARM blacks (`#0a0706`), crisp specular rim-light, fine ember/
  spark/dust particles, faint volumetric haze, subtle film grain, 8k micro-detail, no banding.
- **Tech (every cover):** 1:1 square, 1024×1024, sharp focus, NO text, NO lettering, NO logos, NO
  watermark, NO UI elements, NO frame/border.
- **Negative (every image):** `blue, navy, indigo, teal, cyan, magenta, pink, pastel, cool color cast,
  daylight, green foliage, low contrast, washed out, flat lighting, watermark, text, letters, numbers,
  logo, signature, UI, frame, border, cluttered, deformed hands, extra fingers, jpeg artifacts`.
- **Palette per tier:** WARM-UP = gold/amber dawn (calm). PULSE = crimson `#ff1f2e` + ember `#ff7a4a`
  (energy). FRACTURE = gothic violet `#7b2ff7`/`#b06bff` over `#2a0a3a` WITH crimson `#ff1f2e` accents
  (dark-fantasy). Core UI stays crimson-chrome; only FRACTURE levels + the boss go violet.

---

# 📁 assets\levels\  — level card covers (1:1, 1024×1024, JPG)

## TIER I · WARM-UP  (gold/amber, calm, inviting — the on-ramp)

### `warmup-cover.jpg`  — "First Light"
```
Premium music-game key art, 1:1 square, 1024x1024. A lone electric-guitar neck lies across the lower
third of the frame, its single top string catching the very first ray of a warm-gold sunrise that
cracks the horizon behind it; one bright bead of golden light travels along that string like the first
note of a song. Cinematic stylized 3D render, painterly highlights, dramatic rim lighting from the
sunrise. Color palette: warm gold and amber (#e0a93f, #f3c970) glow, soft ember orange (#ff7a4a)
accents, brushed-chrome (#dad7d2) string highlights, on a deep warm near-black background (#0a0706)
with a soft amber radial bloom top-center and dark edges. Floating golden dust motes, gentle
volumetric haze, shallow depth of field, soft bokeh. Calm, hopeful, premium, high dynamic range,
fine grain, 8k detail. Centered hero composition, dark negative space at the edges, reads at small
size. No blue, no purple, no daylight sky, no text, no logos, no UI, no frame.
```

### `steadyhands-cover.jpg`  — "Steady Hands"
```
Premium AAA music-game key art, 1:1 square, 1024x1024, cinematic STYLIZED 3D render (NOT a
photograph, not photoreal skin), painterly highlights, Octane/Redshift quality lighting, Guitar Hero
/ Hi-Fi Rush poster style. A single bold hero hand rendered as a sleek dark sculptural SILHOUETTE
rim-lit in warm gold, poised mid-chord on the glowing strings of an electric-guitar neck; brilliant
amber string-light streams between the fingers and warm ember light-trails arc off the fingertips,
suggesting controlled, confident precision. Generous dark negative space toward the edges, a slightly
brighter golden focal core, strong figure-ground separation. Color palette: gold and amber (#e0a93f,
#f3c970) string glow, ember-orange (#ff7a4a) light trails, brushed-chrome (#dad7d2) fret-wire glints,
deep warm near-black background (#0a0706), soft golden radial bloom center, dark vignette edges. Fine
sparks, faint volumetric haze, shallow depth of field, soft bokeh, fine film grain, 8k micro-detail,
high dynamic range. Composed, precise, premium, clean bold silhouette that reads clearly at small
size. No photoreal skin, no realistic face, no blue, no navy, no purple, no teal, no cyan, no magenta,
no pink, no pastel, no cool color cast, no daylight, no low contrast, no text, no letters, no numbers,
no logo, no signature, no watermark, no UI, no frame, no border, no deformed hands, no extra fingers,
no jpeg artifacts.
```

### `emberdrift-cover.jpg`  — "Ember Drift"  (bridges into PULSE)
```
Premium music-game key art, 1:1 square, 1024x1024. A dark electric-guitar fretboard angled through
warm darkness as a slow river of orange embers and sparks drifts upward off the strings, each ember
trailing a soft glowing tail; the warmth is just starting to build toward fire. Cinematic stylized 3D
render, painterly highlights, dramatic rim lighting. Color palette: ember-orange (#ff7a4a) and warm
amber (#e0a93f) glow with the first hints of crimson (#ff1f2e), brushed-chrome (#dad7d2) string
glints, deep warm near-black atmosphere (#0a0706), soft red-amber bloom center, dark edges. Dense
floating embers, volumetric smoke haze, shallow depth of field, soft bokeh. Atmospheric, warm,
premium, high dynamic range, fine grain, 8k detail. Centered, clean silhouette, dark edges, reads
small. No blue, no purple, no text, no logos, no UI, no frame.
```

## TIER II · PULSE  (crimson + ember, the beat is on — energy)

### `heartbeat-cover.jpg`  — "Heartbeat"
```
Premium music-game key art, 1:1 square, 1024x1024. A crimson heartbeat / EKG waveform ignites and
races across the strings of a dark electric-guitar neck, the glowing red pulse line spiking exactly
on the frets like a living rhythm; where the spike peaks, sparks burst off the string. Cinematic
stylized 3D render, painterly, dramatic rim lighting, high energy. Color palette: vivid crimson
(#ff1f2e) pulse glow into ember-orange (#ff7a4a), gold (#e0a93f) spark flares, brushed-chrome
(#dad7d2) string and fret highlights, deep warm near-black background (#0a0706) with a red radial
bloom center and dark edges. Streaming sparks, volumetric haze, shallow depth of field, soft bokeh.
Punchy, alive, premium, high dynamic range, fine grain, 8k detail. Centered hero, strong silhouette,
dark edges, legible small. No blue, no purple, no text, no logos, no UI, no frame.
```

### `overdrive-cover.jpg`  — "Overdrive"
```
Premium music-game key art, 1:1 square, 1024x1024. An overdriven tube amplifier glows white-hot
behind an electric-guitar neck while ember and crimson flames lick up the strings and a fork of
lightning crackles across the fretboard; the whole frame feels about to explode with sound. Cinematic
stylized 3D render, painterly highlights, dramatic rim lighting, explosive energy. Color palette: hot
ember-orange (#ff7a4a) and crimson (#ff1f2e) fire, white-hot core, gold (#e0a93f) flares, brushed-
chrome (#dad7d2) amp grille and metal edges, deep warm near-black background (#0a0706), red bloom
center, dark edges. Flying sparks, smoke, heat-shimmer, shallow depth of field, soft bokeh. Loud,
aggressive, premium, high dynamic range, fine grain, 8k detail. Centered, bold silhouette, dark
edges, reads small. No blue, no purple, no text, no logos, no UI, no frame.
```

### `chromeveins-cover.jpg`  — "Chrome Veins"
```
Premium music-game key art, 1:1 square, 1024x1024. Veins of molten liquid chrome thread through a
dark electric-guitar fretboard like circuitry, glowing silver-hot with a faint crimson under-glow
pulsing beneath the metal; the strings are polished mirror-chrome catching sharp highlights.
Cinematic stylized 3D render, painterly, dramatic rim lighting, sleek and metallic. Color palette:
brushed and molten chrome / warm silver (#dad7d2, #f0eeea) kept NEUTRAL-WARM (never blue), faint
crimson (#ff1f2e) under-glow, ember (#ff7a4a) and gold (#e0a93f) micro-sparks, deep warm near-black
background (#0a0706), soft silver bloom center, dark edges. Fine sparks, subtle haze, shallow depth
of field, soft bokeh. Sleek, premium, high-tech, high dynamic range, fine grain, 8k micro-detail.
Centered, clean silhouette, dark edges, reads small. No blue tint on the chrome, no purple, no text,
no logos, no UI, no frame.
```

## TIER III · FRACTURE  (gothic violet + crimson — dark fantasy)

### `tarot.jpg`  — "The World"   ⚠️ YOU ALREADY HAVE A CONCEPT — save it here. (Regen prompt below if you want it to match the set.)
```
Premium AAA music-game key art, 1:1 square, 1024x1024, gothic dark-fantasy, cinematic STYLIZED 3D
render with painterly highlights and gilt detail, dramatic chiaroscuro rim lighting, Octane/Redshift
quality. A single glowing occult relic fills the entire frame: a radiant gold-and-violet eight-pointed
star sigil burning at the center, encircled by an ornate laurel wreath woven from luminous
electric-guitar strings, with floating alchemical sigils and gold filigree orbiting it, lit by violet
flame and warm candle glow. The relic IS the whole hero subject, bold and centered and large in frame.
It is NOT a small tarot card on a table, NO card-within-a-card, no tabletop, no surrounding props or
clutter. Generous dark negative space toward the edges, a brighter violet-gold focal core, strong
figure-ground separation. Color palette: deep gothic violet (#2a0a3a base, #7b2ff7 and #b06bff glow)
WITH crimson (#ff1f2e) accents and rich warm gold (#e0a93f) filigree, on a warm near-black background
(#0a0706), violet-gold radial bloom center, dark vignette edges. Drifting candle smoke, embers, faint
volumetric haze, shallow depth of field, soft bokeh, fine film grain, 8k micro-detail, high dynamic
range. Mysterious, ornate, premium, reads clearly at small size. No magenta, no pink, no blue, no navy,
no teal, no cyan, no pastel, no cool color cast, no daylight, no low contrast, no modern text, no
letters, no numbers, no logo, no signature, no watermark, no UI, no frame, no border, no deformed
hands, no jpeg artifacts.
```

### `hollowchoir-cover.jpg`  — "Hollow Choir"
```
Premium music-game key art, 1:1 square, 1024x1024, gothic dark-fantasy. A ghostly cathedral choir of
hooded faceless silhouettes stands in rows beneath a towering stained-glass window whose panes are
shaped from glowing guitar strings; violet light pours through, candle smoke drifts, a faint crimson
glow rises from below. Cinematic stylized 3D render, painterly, dramatic chiaroscuro rim lighting,
eerie and grand. Color palette: deep gothic violet (#2a0a3a base, #7b2ff7 / #b06bff glow) with gold
(#e0a93f) candle accents and crimson (#ff1f2e) under-glow, on a warm near-black background (#0a0706),
violet bloom upper-center, dark edges. Drifting smoke, dust, volumetric god-rays, shallow depth of
field, soft bokeh. Haunting, ornate, premium, high dynamic range, fine grain, 8k detail. Centered,
strong silhouette, dark edges, reads small. No realistic faces, no blue, no text, no logos, no UI,
no frame.
```

### `necromancer.jpg`  — "THE BREAKER" (BOSS)   ⚠️ YOU ALREADY HAVE A CONCEPT — save it here. (Regen prompt below if you want it to match the set.)
```
Premium music-game BOSS key art, 1:1 square, 1024x1024, gothic dark-fantasy. A towering necromancer
boss wreathed in violet flame stands center-frame, conducting a swirling storm of glowing guitar
strings like a sorcerer's spell; crimson lightning forks from his hands, gold sigils orbit him, and a
cracked stage floor glows beneath. Cinematic stylized 3D render, painterly, dramatic low-angle hero
shot, heavy rim lighting, menacing and epic. Color palette: deep gothic violet (#2a0a3a base, #7b2ff7
and #b06bff neon flame) WITH crimson (#ff1f2e) lightning and gold (#e0a93f) sigils, on a warm
near-black background (#0a0706), violet-crimson bloom center, dark edges. Storm of embers and sparks,
volumetric smoke, lightning glow, shallow depth of field, soft bokeh. Intimidating, climactic,
premium, high dynamic range, fine grain, 8k detail. Centered colossus silhouette, dark edges, reads
small. No readable human face detail, no blue, no text, no logos, no UI, no frame.
```

---

# 📁 assets\store\  — store item covers (1:1, 1024×1024, JPG)

### `starter_pack.jpg`  — Starter Pack (song bundle, 500 Sparks)
```
Premium game-store key art, 1:1 square, 1024x1024. A loot-crate song bundle: three or four glossy
black vinyl-style song discs fan out of an open chrome-edged crate at a dramatic low angle, molten
ember light spilling from inside the crate, a few gold star-sparks rising. Cinematic stylized 3D
product render, painterly highlights, dramatic studio rim lighting. Color palette: crimson (#ff1f2e)
and ember-orange (#ff7a4a) glow, gold (#e0a93f) rim-light and sparks, brushed-chrome (#dad7d2) crate
edges, deep warm near-black background (#0a0706) with a red radial bloom top-right and dark edges.
Drifting embers, faint haze, shallow depth of field, soft bokeh. Premium, desirable, high dynamic
range, fine grain, 8k detail. Centered hero, strong silhouette, dark edges, reads small. No blue, no
purple, no text, no logos, no UI, no frame.
```

### `boss_neon.jpg`  — Boss level unlock (200 Sparks)   (violet OK — it's a boss)
```
Premium game-store BOSS key art, 1:1 square, 1024x1024, gothic. A menacing final-boss icon: an
electric guitar fused with a demonic crowned cathedral silhouette looming head-on over a tiny stage,
strings arcing with violet and crimson lightning, ember cracks glowing through black metal. Cinematic
stylized 3D render, painterly, dramatic low-angle hero shot, heavy rim lighting, ominous. Color
palette: deep gothic violet (#2a0a3a base, #7b2ff7 / #b06bff neon) with crimson (#ff1f2e) accent
lightning, gold (#e0a93f) crown flare, brushed-chrome (#dad7d2) metal edges, deep warm near-black
background (#0a0706), violet bloom center, dark edges. Storm, ground fog, god-rays, sparks, shallow
depth of field, soft bokeh. Elite, intimidating, premium, high dynamic range, fine grain, 8k detail.
Centered, bold silhouette, dark edges, reads small. No readable face, no blue, no text, no logos, no
UI, no frame.
```

### `theme_neon.jpg`  — Cosmetic theme/skin (100 Sparks)
```
Premium game-store cosmetic key art, 1:1 square, 1024x1024. An abstract "neon skin" swatch for a
rhythm game: a sleek fragment of an electric-guitar neck with glowing strings and two catcher rings,
treated as a glossy product material chip, flowing ribbons of crimson and ember neon energy across
the surface. Cinematic stylized 3D product render, painterly highlights, soft bloom, clean and
iconographic so it reads clearly at small size. Color palette: crimson (#ff1f2e) and ember-orange
(#ff7a4a) neon, gold (#e0a93f) filament sparkles, brushed-chrome (#dad7d2) frets, deep warm near-
black background (#0a0706) with a centered ember core and dark edges, subtle scanline/grid texture.
Shallow depth of field, soft bokeh. Slick, premium, high dynamic range, fine grain, 8k detail.
Centered radial composition, dark edges, reads small. No blue, no purple, no text, no logos, no UI,
no frame.
```

---

# 📁 assets\levels\  — OPTIONAL in-game backdrops (16:9, 1920×1080, JPG)

These sit BEHIND the playfield, so they must be dark and low-contrast with the **center third kept
clear** (the guitar/notes draw there). Levels work without these (they fall back to the moon video),
so do them last.

### `warmup-bg.jpg`
```
Wide cinematic game backdrop, 16:9, 1920x1080, dark and low-contrast for UI to sit on top. A dim
electric-guitar fretboard receding into warm-black haze, gentle gold-amber dawn glow low on the
horizon, soft floating embers. Color palette: warm gold/amber (#e0a93f) and ember (#ff7a4a) on deep
warm near-black (#0a0706). The CENTER THIRD is kept empty and darker (reserved for gameplay); energy
lives at the left/right edges. Volumetric haze, fine grain, cinematic. No subject in the center, no
blue, no purple, no text, no logos, no UI.
```

### `pulse-bg.jpg`
```
Wide cinematic game backdrop, 16:9, 1920x1080, dark and low-contrast. A guitar neck angled through
warm darkness with concentric crimson-ember shockwave rings rippling from off-center like a kick
drum, streaming sparks at the edges. Color palette: crimson (#ff1f2e) + ember (#ff7a4a) + gold
(#e0a93f) on deep warm near-black (#0a0706). CENTER THIRD kept empty and darker for gameplay; energy
at the edges. Volumetric haze, fine grain, cinematic. No center subject, no blue, no purple, no text,
no logos, no UI.
```

### `fracture-bg.jpg`   (violet gothic)
```
Wide cinematic game backdrop, 16:9, 1920x1080, dark and low-contrast, gothic. A cracked black guitar
fretboard with violet flame and crimson lightning glowing through the fractures at the edges, drifting
smoke. Color palette: deep gothic violet (#2a0a3a, #7b2ff7) with crimson (#ff1f2e) accents on warm
near-black (#0a0706). CENTER THIRD kept empty and darker for gameplay; drama at the edges.
Volumetric fog, fine grain, cinematic. No center subject, no blue, no text, no logos, no UI.
```

### `boss-bg.jpg`   (violet gothic, most intense)
```
Wide cinematic game backdrop, 16:9, 1920x1080, dark and low-contrast, gothic. A violet storm raging
over a distant cathedral-stage silhouette, crimson lightning forking across the sky, embers and ash
blowing at the edges. Color palette: deep gothic violet (#2a0a3a, #7b2ff7, #b06bff) with crimson
(#ff1f2e) lightning and gold (#e0a93f) sigil sparks on warm near-black (#0a0706). CENTER THIRD kept
empty and darker for gameplay; chaos at the edges. Volumetric fog, god-rays, fine grain, cinematic.
No center subject, no blue, no text, no logos, no UI.
```

---

## RECAP — exact filenames (drop into the matching open folder)

**assets\levels\** (1024² jpg): `warmup-cover.jpg`, `steadyhands-cover.jpg`, `emberdrift-cover.jpg`,
`heartbeat-cover.jpg`, `overdrive-cover.jpg`, `chromeveins-cover.jpg`, `tarot.jpg` (have it),
`hollowchoir-cover.jpg`, `necromancer.jpg` (have it). Optional 1920×1080: `warmup-bg.jpg`,
`pulse-bg.jpg`, `fracture-bg.jpg`, `boss-bg.jpg`.

**assets\store\** (1024² jpg): `starter_pack.jpg`, `boss_neon.jpg`, `theme_neon.jpg`.

If a file won't save with the exact name, paste me its path and I'll rename/copy it into place.
