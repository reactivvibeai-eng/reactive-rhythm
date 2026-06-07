# CONTINUATION HANDOFF — Reactive Rhythm @ v91 (read with HANDOFF_NEXT_AGENT.md + CLAUDE.md + memories)

Branch `visual-overhaul`, **currently v91**, tree committed, serve.py running (http 200). DO NOT deploy. Test via the
Claude_Preview headless browser (recipe in memory `rhythm-game-local-verify`): kill all 8787 procs → preview_start
`rhythm-rift` → `location.href='http://127.0.0.1:8787/index.html?dev=1&cb='+Date.now()` → wait 8s → preview_resize 1366x768
(the headless viewport collapses to 0x0 otherwise) → drive via RhythmCatalog/RhythmLibrary/RhythmEnvPicker/__rrDebug →
preview_console_logs(error) → preview_stop → restart serve.py. node --check after JS edits; bump ?v=NN once per change.

## DONE + VERIFIED (this whole stretch, v82→v91)
Screen-exclusivity + clearLevelTheme fixes; ENV PICKER (pick any level for any song); MENU HUB; reactive fate-meter cards;
browse video; MULTIPLAYER open-lobby (lobby/host-badge/side-by-side — single lobby only, NOT the room system yet); STORE
sells real items (guitar skins + custom level, client catalog authoritative); SKULLY LEVEL overhaul (v88-89): guitar shows
on the env path, purple wash + scanline KILLED (crisp), cards up at top:13vh, per-skin geometry (SKIN_GEOM in game.js so
catchers ride each guitar's strings), violet gem tint, combo→intense-video; LIBRARY RAILS (v91): Featured/Hot/New/Surprise
now distinct (salted-hash permutations in catalog.js sections()).

## REMAINING QUEUE (patch docs + assets ALL ready; integrate one at a time, preview-test each)
1. **Flipbook FX hookup** — USE the asset agent's `assets/fx/fx-player.js` (drop-in: `FxPlayer.load('assets/fx/manifest.json')`
   → `fx.draw(ctx, performance.now())` each frame → `fx.play(name,x,y,{scale})`; manifest now has per-effect `scale`,
   31 effects). Apply `_build8_flipbook.md`'s game.js EVENT-DISPATCH hooks (hit/perfect/miss/bomb/combo/overdrive at the real
   sites w/ catcher coords) BUT point them at fx-player.js (NOT a new flipbook.js — that doc built a duplicate engine; prefer
   fx-player.js). Add `<script src="assets/fx/fx-player.js?v=NN">`. Themed FX to map: Skully→skull-flame-violet/soul-burst-violet,
   bombs→bomb-warn(telegraph)/bomb-fuse(riding)/bomb-explode(hit). node --check.
2. **6 premium guitars** — add the 3 NEW ones to `SKIN_GEOM` (game.js ~424) + the store catalog: ids violet_gothic, bone_daddy,
   melody_pink (3 already in SKIN_GEOM) + crimson_chrome, ember_bone, gold_relic. Per-skin nutXF/bridgeXF/nutYF/bridgeYF are
   tabulated in **ASSET_PROMPTS.md** (read it). Files exist: assets/guitars/*.png + assets/store/skin-*.jpg. Fine-tune with __rrDebug.
3. **Two new levels** (AUTHORED[] in index.html) — Bone Daddy: song trackId `30acfdb4-8c85-4e1a-b43d-c91587dcba16` ("Get Busy"),
   cover bonedaddy-cover.jpg, bg bonedaddy-bg.jpg, guitarSkin bone-daddy.png, theme (pick), mechanic: booty-shake + notes spawn
   from the booty. Melody: trackId `7424b4a5-27e5-4b78-aad2-ac5ded73c20b` ("Highway Lover"), melody-cover.jpg/melody-bg.jpg,
   guitarSkin melody-pink.png, BOSS/purchasable (unlock.entitlement), mechanic: cat-paw (assets/levels/melody-paw.png) bats each
   note on hit (or use the paw-poof FX). Add random-stage chip icon assets/ui/random-stage.png (Default→random-stage, per design memory).
4. **Multiplayer room system** — apply `_build8_multiplayer.md` (open/close room, find-game, quick-match, public/private, ready/
   rematch/spectate; mostly multiplayer.js + #multiplayer-screen).
5. **RYO start/menu/loading visuals** — apply `_build8_menuvisuals.md` (menu-loop.mp4 bg, RYO hero, atom-loading.png loader,
   per-tile treatment). Assets: assets/ryo/*, assets/atom-loading.png, assets/levels/menu-loop.mp4.

## COORDINATION (asset agent works in parallel, assets/ only)
- **Union-merge** shared files `assets/fx/manifest.json` / `preview.html` / `INTEGRATION.md` — never overwrite (the agent does the same).
- The bomb set (bomb-fuse/bomb-explode/bomb-warn) is the ENGINE-side authoritative set.
- NEVER run `git clean` / `rm` the agent's untracked temp files in the main folder.
- Store-guitar quality bar: unique crafted guitars (done — 6 premium), NOT recolors.

## DESIGN BAR (memory: reactive-rhythm-design-philosophy) — don't rush, self-critique each creative call; design for DOPAMINE +
VERTIGO + juice; match THEN exceed Guitar Hero. Verify VISUALLY (canvas screenshots time out — use structural reads + the user's eye).
