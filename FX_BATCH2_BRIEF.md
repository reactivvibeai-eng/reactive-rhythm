# FX BATCH 2 — commissioning brief (for the ASSET/FX agent)

Batch 1 (31 effects) is fully wired into the engine (v104). This brief lists the **next ~25 effects**
— every game moment that still falls back to a generic effect or has none. Same contract as batch 1:
your proven Seedance pipeline → 128px-cell sheets via `build_sheet.py` → **UNION-merge
`assets/fx/manifest.json`** (never overwrite; `bomb-*` names are engine-owned) → assets only, no game
code. Pull `visual-overhaul` first. Names below are the exact manifest keys the engine will wire.

Brand: black · crimson #ff1f2e · ember #ff7a4a · gold #e0a93f · chrome #dad7d2. Violet only for
Skully-tier, bone/ember for Bone Daddy, pink for Melody. RGB on pure black, additive.

## A — per-theme hit & perfect variants (the other levels deserve what Skully has)
| name | type | look | fires |
|---|---|---|---|
| gold-burst | one-shot | warm gold spark bloom, dawn-light motes | hit on GOLD (warm-up) levels |
| gold-flare | one-shot | brighter gold starburst w/ lens streak | perfect on gold levels |
| chrome-shatter | one-shot | mirror-shard glints, neutral-warm silver | hit on CHROME levels |
| chrome-flash | one-shot | hot white-chrome specular pop | perfect on chrome levels |
| crimson-slash | one-shot | a fast crimson blade-arc slash | hit on CRIMSON levels |
| crimson-nova | one-shot | crimson ring-nova w/ white core | perfect on crimson levels |
| ember-pop | one-shot | ember crackle burst, rising sparks | hit on EMBER levels |
| ember-flarewave | one-shot | ember fan-wave w/ heat shimmer | perfect on ember levels |

## B — gameplay moments still on generic FX
| name | type | look | fires |
|---|---|---|---|
| hold-bank | one-shot | energy column SURGES up the string and pops | sustain completed (banked) |
| hold-snap | one-shot | the beam snaps/frays, sparks die downward | sustain dropped early |
| go-flash | one-shot | stage-lights slam on: radial white-gold flare | the GO! after the countdown |
| lightning-strike | one-shot | a real forked lightning bolt, crimson-white | combo milestone (replaces canvas bolt) |
| streak-rain | loop | thin sparks raining upward, escalating | combo ≥ 50 ambient (stopped on break) |
| fail-static | one-shot | signal-lost implosion: static ring collapses | run failed / wipeout climax |
| od-ignition | one-shot | a fuse-line ignites ACROSS all five catchers | overdrive activation sweep |

## C — Skully tier (her level should drip identity)
| name | type | look | fires |
|---|---|---|---|
| skull-bomb-pop-violet | one-shot | violet skull-shaped detonation w/ soul wisps | bomb struck on Skully |
| death-flare-violet | one-shot | the DEATH card's crimson-violet flame lick | DEATH card flash (miss) |
| world-radiance-gold | one-shot | THE WORLD's gold star-wreath radiance | WORLD card flash (hit) |
| raven-swarm-violet | one-shot | a burst of black-violet wings scattering | Skully combo milestone |

## D — Bone Daddy / Melody mechanics
| name | type | look | fires |
|---|---|---|---|
| bone-dust-stomp | one-shot | bone-white dust + rib shards kick up | Bone Daddy booty bounce (combo) |
| paw-trail-pink | one-shot | a pink claw-swipe motion trail | Melody paw swipe |

## E — UI / transitions
| name | type | look | fires |
|---|---|---|---|
| menu-sweep | one-shot | a horizontal chrome-crimson light sweep | screen transitions (hub→library etc.) |
| buy-mint | one-shot | gold coin-mint stamp w/ spark ring | store purchase success |
| equip-lock | one-shot | chrome clamps lock in w/ accent glint | skin equipped |

## Specs (same as batch 1)
- 1:1, 4s, 480p Seedance; centered subject on pure solid black; one-shots fully ignite+fade in-clip;
  loops steady intensity, seamless. Tile to 128px cells, honor `count < cols*rows` if trimmed.
- Manifest entries need `cols/rows/count/fps/loop/scale`. Kebab-case names exactly as above.
- Commit clips to `assets/fx/_src/`, sheets + manifest union to `assets/fx/`, on `visual-overhaul`,
  small batches. Ping the engine agent when landed — wiring is theirs.
