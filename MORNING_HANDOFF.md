# Morning handoff — overnight playtest-4 pass

Everything from your live-playtest dump got addressed. Five builds shipped to the branch, each through
a multi-lens adversarial review before it hit `main`. Nothing shipped unreviewed; every review finding
was fixed pre-ship. Here's what to do first, what to test, and what's waiting on you.

## 1. Publish the game (1 action)
All builds are synced to `public/game/` on the Lovable preview but **NOT published** — that's your
call. Before you click Publish, confirm the preview shows **`?v=432`** (build121, the latest). Builds
117–119 confirmed synced clean (`?v=431`); the build121 sync for SHA `08f9c85` was dispatched last and
should have advanced it to `?v=432`. If it shows an older version, re-run the sync for `08f9c85`. Then Publish.

## 2. What shipped tonight (newest first)
- **build121 — performance** (`?v=432`, shipped + reviewed): zero-behavior-change hot-loop opts (fretGeom
  memoized per frame, vignette gradient cached, Path2D→direct, camera-shake translate skipped at rest,
  ember pow hoisted, O(1) particle removal). No pixel changes — pure CPU/GC reduction. See
  [PERF_FINDINGS.md](PERF_FINDINGS.md) for the bigger wins I held for your FPS meter.
- **build119 — moderation ENFORCEMENT**: reports now POST live; the game reads `/sanctions/me` and
  enforces a suspend gate / MP-block / chat-mute / warning modals. **No-op until you actually sanction
  someone** — safe default verified byte-identical for everyone else.
- **build118 — VS-bar clash sparks + cosmetics + leaderboard**: sparks at the head-to-head meeting line;
  cosmetics (name fonts, emblems, prestige title) now **visible to other players in MP**; leaderboard
  rank ▲/▼ deltas + "X pts to pass" chase card + the "unknown track" share fix + NPC names removed.
- **build117 — visual front door + VFX density**: premium daily-goal card, per-day **roast** copy, refined
  start embers; reactive backdrops now scale density to the audio + real slow-machine perf relief.
- **(earlier this session) build115/116** — sign-in handshake, leaderboard difficulty, MP PvP/PvE + damage
  + lightning, room clarity, chat everywhere, matched settings.
- **Moderation backend + admin console** — built & deployed on the *website* (Lovable): `/admin/moderation`
  with per-target report counts + Warn/Notify/Mute/Suspend/Ban. This is the "admin controls on the website"
  you asked for.

## 3. What to TEST — especially the 2-account flows I can't verify solo
I verified everything I could headless (boot, DOM, state, no console errors, node-check). These need a
real second human/account:
- **Moderation end-to-end:** sanction a test user via `/admin/moderation` → confirm their client shows
  the suspend gate / mute hint / warning modal, and that acking a notice stops it re-showing.
- **Cosmetics in MP:** equip a name color/font/emblem → a second player should see it on your roster/chat/
  VS-bar row.
- **VS-bar sparks + PvP damage lightning:** on a real 1v1, confirm the clash sparks + the damage bolt on
  the victim's screen.
- **Sign-in handshake** on the live site (should now show your name, not "guest").
- **Roast copy / daily card:** log in on different days → the roast line should rotate but be stable within
  a day; the flame should escalate with your streak.
- **Backdrop density + perf:** eyeball the level backdrops (should feel fuller/more reactive now) and watch
  the FPS meter under a dense Hard chart.

## 4. Waiting on YOUR decision
- **Delighters** ([DELIGHTERS_SHORTLIST.md](DELIGHTERS_SHORTLIST.md)) — net-new features (CLUTCH comeback
  moment, near-miss "1 note from glory" stamp, streak-save nudge, the shareable RIFT REPLAY clip, async
  NEMESIS ghost race, Weekly Rift ladder, a scripted first-run). **Tap any and I'll build them.** My pick:
  ship the cheap CLUTCH + near-miss + streak-nudge "retry/return loop" pack first, then RIFT REPLAY as the
  viral swing.
- **Cosmetic emblems** ([COSMETIC_ASSET_PROMPTS.md](COSMETIC_ASSET_PROMPTS.md)) — 5 Higgsfield prompts +
  exact filenames; drop the PNGs into `assets/cosmetics/` and they auto-wire (the game already handles them
  missing gracefully).
- **Bigger perf wins** ([PERF_FINDINGS.md](PERF_FINDINGS.md)) — the warped-guitar offscreen cache (likely
  the biggest heavy-load win) + the note-loop cursor; I'll build on your nod + you validate the FPS delta.
- **Optional backend follow-up:** 4 nullable cosmetic columns on the leaderboard row (so equips show on the
  *leaderboard* too, not just live MP) — low priority, small Lovable ask; say the word.

## 5. Notes
- Dev hooks (`__rrDebug`, `__rrChartStats`, FPS meter, `?novideo/?fps/?mock`) are still in — strip before a
  public `/play` launch (tracked in CLAUDE.md).
- Lovable credits spent tonight: ~7 (moderation build + 3 game syncs). Everything else was game-side.
