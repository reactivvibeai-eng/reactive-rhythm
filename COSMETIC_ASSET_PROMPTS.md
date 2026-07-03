# Cosmetic emblem assets — Higgsfield generation brief (for the owner)

These 5 images power the **cosmetics evolution** (name-fonts, emblems, prestige frames) from the
playtest-4 feedback. Everything else in that system — name COLORS, name FONTS, the animated
spinning frame, the pulsing prestige glow — is **pure CSS and needs no asset**. So your 34
Higgsfield credits only go toward these 5 emblem/frame PNGs.

## Where they go
Drop each finished PNG into this exact folder with this exact filename:
```
D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\assets\cosmetics\
```
(The folder is already created and waiting.)

## Hard style rules (so they match the game)
- **Transparent background** (PNG with alpha) — these sit inside tiles/rings, not on a card.
- **Palette: black / crimson / chrome / gold ONLY. No purple, no blue.** (Green is reserved for note gems — don't use it here either.)
- Flat, clean **vector-icon / game-badge** look — not photoreal, not painted, no heavy 3D.
- They render small (~48–64px in a tile), so keep them **bold and readable at thumbnail size** — one clear shape, no fine detail that mud-blurs when shrunk.

## The 5 prompts

**1. `emblem_ember.png`** — 256×256
> minimalist flat icon emblem, a small ember flame inside a hexagon outline, crimson and gold on a transparent background, game badge icon style, no gradients, clean bold vector look, readable at small size

**2. `emblem_accent_decal.png`** — 256×256
> minimalist flat icon emblem, a lightning bolt crossed with a guitar pick, chrome and crimson on a transparent background, game badge icon, clean bold vector look, readable at small size

**3. `emblem_undying_ring.png`** — 256×256
> flat icon emblem, an ouroboros ring circling a small flame, gold and black on a transparent background, prestige game badge, clean bold vector look, readable at small size

**4. `frame_badgeframe.png`** — 512×512 (this one is a RING/BORDER — the center must be empty)
> circular ornate frame border only, center fully transparent, crimson and gold metallic engraved ring, game avatar frame asset, flat clean vector, symmetric, no content in the middle

**5. `emblem_rift_legend.png`** — 256×256 (the top prestige emblem)
> flat icon emblem, a crown wrapped in lightning, gold and chrome on a transparent background, top-tier prestige game badge, clean bold vector look, readable at small size

## After you generate them
Just drop the 5 files into the folder above with those exact names. The game auto-wires them —
no code change needed on your side. If Higgsfield adds a background you can't avoid, tell me and
I'll knock it out to transparent on this end.
