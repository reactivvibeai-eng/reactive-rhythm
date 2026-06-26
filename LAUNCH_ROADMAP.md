# Reactive Rhythm — Launch Roadmap

**Build:** `?v=352` · branch `visual-overhaul` · ~17 focused commits this session (build99e → build99L) · **all local, nothing deployed.**
**Date:** 2026-06-26. This doc supersedes the stale `RELEASE_ROADMAP.md` / `PRELAUNCH_AUDIT.md` (those are dated build58–65; most of their P0s are already closed — see §6).

---

## 0. TL;DR — the critical path to launch

Three gates stand between "done building" and "live at reactivvibe.com/play". In order:

1. **YOU: one-time GitHub auth** → unblocks ALL deployment. ~2 min. (§4)
2. **YOU + LOVABLE: 3 backend/decision items** → telemetry endpoints, the deploy allowlist, beta-gate posture. (§3A/§3B)
3. **YOU: a legal/ToS surface** → only required *before taking real money*; NOT a blocker for a free beta. (§3A)

Everything else (the game itself) is built, verified, and playtest-ready. If you want a **free beta** (no paid SKUs), you can skip the payment + legal work and go live after gates 1–2.

---

## 1. Build state — what's DONE (committed + verified, 0 console errors)

- **AI Flixs**: playable level (video behind highway, charted from audio); flagship premiere self-heals past 404 films; uses the default guitar; gold "AI FLIXS" flagship entry; "rectangle box" fixed.
- **Multiplayer page**: rebuilt from a wall-of-text into a 3-tier journey (status strip / PLAY NOW hero / Play-a-friend + **Local versus** / "More" drawer).
- **Local split-screen co-op**: built end-to-end (additive P2 shadow-scorer + split-screen deck + gold verdict). Single-player byte-identical when off. **Needs your hardware test** (§5).
- **Controller**: PDP Riffmaster readiness fixes (mapping-aware strum, auto gh-profile + preset on connect) + an in-app buy card in Settings.
- **Bugs killed**: results "undefined" blurb crash, "You/You/You" leaderboard, store badge overlap, career "Songs Played 0", reduce-motion + a11y on results.
- **Polish (6 surfaces tonight)**: start CTA timing + Campaign hero tile + hub status strip; career stat count-ups + rank-progress bar + grade bars; seeded aspirational leaderboard + fixed empty state + podium crown; Settings AUDIO/GAMEPLAY/VISUALS/CONTROLS sectioning; results one-primary-CTA hierarchy + max-height scroll; store USD price anchor + hero-merchandise sort.
- **Misc**: catcher↔string alignment re-measured across all skins; funnier beta loading quips.

---

## 2. PLAYTEST checklist — what to test (tomorrow, on your machine)

Run `python serve.py` → open `http://localhost:8787`. (serve.py sends no-cache, so a normal refresh always loads the latest.)

### Core loop
- [ ] Boot → consent → PRESS START → Ryo intro → menu hub (Campaign now a hero banner).
- [ ] Quick Play a few live tracks: notes fall, scoring/combo/Overdrive feel right, hit SFX, miss squelch.
- [ ] Results screen: count-ups, star rating, grade, NEXT LEVEL vs PLAY AGAIN hierarchy, no clipping on your screen.
- [ ] Career/Profile: stats count up, rank progress bar fills, grade bars, the equipped-guitar trophy case.
- [ ] Leaderboard: Global tab shows a seeded ladder (not empty), per-song + by-level tabs.

### AI Flixs (the new flagship — you said this felt good)
- [ ] Open AI FLIXS → the premiere marquee features a **playable** film (PLAY PREMIERE shouldn't 404).
- [ ] Play a film → the music video plays full-screen behind the highway, notes charted to the song.
- [ ] Confirm note **readability** over the video, and that the default guitar reads clean (equip a skin to check that path too).

### Controller (once the Riffmaster arrives — §5)
- [ ] Plug in → it auto-detects + maps the 5 frets without opening Settings; strum fires held frets; whammy → Overdrive.
- [ ] If anything's off, the Settings "Set Up Controller" wizard maps every fret + strum/whammy/tilt manually.

### Local split-screen co-op (needs 2 controllers — the one thing I couldn't verify)
- [ ] Multiplayer → **Local versus** → claim P1 (keyboard or controller 1) + P2 (controller 2) → Start.
- [ ] Two highways, same song, **independent** scores; the gold WIN/LOSE/DRAW verdict shows both real scores.
- [ ] Watch for: P2 input latency/feel, strum-vs-fret parity, the verdict matching what actually happened.
- [ ] Note: configure each pad (controller setup / GH preset) first so P2's buttons map to lanes.

### Multiplayer page (online MP stays gated off until server scoring lands — §3B)
- [ ] The page reads as a clear journey now (PLAY NOW in the upper third, not a wall of text).
- [ ] Practice vs CPU launches a split-screen duel.

**Report anything that feels off** — note-feel, readability, a screen that clips, a flow that dead-ends. That's the next polish round.

---

## 3. What's LEFT for launch

### 3A. YOU (owner) — decisions + actions only you can make

| Item | What | Effort | When |
|---|---|---|---|
| **GitHub auth** | Run the one-time auth so anything can deploy (§4) | 2 min | **Now — gate #1** |
| **Beta-gate posture** | Public free beta, or invite-only? Today the gate **fails open** (anyone on a non-localhost host gets in). Decide so I can wire it correctly. | decision | Tonight |
| **Money model** | Confirmed: platform-hosted top-up, Sparks = cash, Bonus = earned (per `LOVABLE_PAYMENT_BRIEF.md`). Only blocks **paid** SKUs. | decided | — |
| **Legal surface** | ToS + refund/cancellation + age-gate, linked from `/play`. **Required before any paid SKU**; NOT needed for a free beta. | owner/legal | Before money |
| **Order the controller** | PDP Riffmaster — **Xbox / Windows model (049-034-BK)**, ~$100–130. NOT the PS5 model, NOT GH Live. | — | Anytime |
| **Generate `assets/share-card.png`** | 1200×630 branded card so a `/play` link unfurls with an image (you generate assets). | asset gen | Pre-launch |

### 3B. LOVABLE (backend) — hand these to your backend agent

| Item | What | Brief |
|---|---|---|
| **Telemetry endpoints** | `POST /clientlog` + `/events` + set `TELEMETRY_BASE` in `RHYTHM_CONFIG`. The client (consent-gated error/event capture) is DONE; without the endpoints the beta runs **blind** (no crash rate, no load→pick→first-note→finish funnel). | `TELEMETRY_BACKEND_BRIEF.md` |
| **Payment top-up** | A sign-in-gated top-up page on reactivvibeai.com → Stripe Checkout → signed, deduped webhook → credit the server-authoritative Sparks balance. The game already deep-links out + re-reads the balance on return. | `LOVABLE_PAYMENT_BRIEF.md` |
| **Server score re-judge** | `/score` carries a single-use `play_token` but isn't recomputed/clamped server-side. Gates the **public leaderboard** GA (a modded client could top it). | `MP_SERVER_SCORING_BRIEF.md` |
| **Protect anon endpoints** | Rate-limit / guard `POST /plays`, `/score`, `/uses` before `/play` is public (anon key is reachable). | — |

### 3C. ME (code) — I can still do these tonight, just say go

| Item | What | Effort |
|---|---|---|
| **Beta-gate wiring** | Once you pick public-vs-invite: either remove the cosmetic gate (public) or fail-closed + a 6s safety-reveal (invite, needs Lovable `/beta/status`). | S |
| **Backdrop auto-downgrade** | Auto-flip the moon-video backdrop to performance mode on low-end / coarse-pointer devices (FPS safety for weak machines). | M |
| **Support / "report a chart" link** | A mailto/report button so a tester can flag a broken chart or failed purchase. | S |
| **Remaining P3 polish** | How-To keys read from the live keymap (not hardcoded A/S/D/J/K), How-To mechanics divider, a few cosmetic nits. | M |
| **Content-freeze strip** (LAST) | Remove the 12 `__rr*` dev hooks, the FPS-meter `<script>`, and `?fps/?novideo/?mock/?align` flags. **Do NOT do this until you finish playtesting** — they power the test tooling. | S |

---

## 4. Deploy path (the one real blocker)

**The blocker:** a sandboxed agent can't complete a *fresh* GitHub sign-in. **You** run this once in your own PowerShell:

```
git ls-remote https://github.com/reactiv435/reactivvibeailive.git
```

→ a browser opens → click **Authorize** as **reactiv435** → the token caches in Windows Credential Manager → after that, local git (and any agent on this machine) can clone/push `reactivvibeailive`.

**Repos (there's an account split — important):**
- This folder's `origin` = `github.com/reactivvibeai-eng/reactive-rhythm` (private; local git can push here).
- **Lovable deploys from a *different* repo:** `github.com/reactiv435/reactivvibeailive`. You own both.
- **Goal:** get the deployable set into `reactiv435/reactivvibeailive` at a `/play` path, on a **branch → PR → you merge**. Never push straight to its live `main`.

**Deployable file set** (what goes to `/play`):
`index.html, game.js, jukebox.js, catalog.js, jukebox.css, multiplayer.js, couch.js, procbg.js, share.js, telemetry.js, assets/`.
**NOT:** `serve.py`, the `*.md` docs/briefs, `launch-game.bat`, `design-source/`, or the `_cap_*.jpg` capture frames.

**⚠ Deploy-leak guard (do this on the FIRST push):** 99 tracked `.md` briefs (incl. `MONETIZATION*`, `*_BACKEND_BRIEF`, `LOVABLE_*`) + 36 `_cap_*.jpg` are committed. A naive folder-sync publishes your monetization/backend strategy at `/play/*.md`. Enforce an **explicit allowlist** of the deployable set on the first PR. (Details in `DEPLOY_OPS.md`.)

---

## 5. Hardware

- **Order:** PDP Riffmaster, **Xbox / Windows model (049-034-BK)**, ~$100–130. Ships with its own USB dongle (no adapter). NOT the PS5 model; NOT the 6-button GH Live.
- **Why it matters now:** local co-op P2 + the controller readiness fixes both want a real 5-fret guitar to validate. The in-game support is tuned for it.

---

## 6. Already fixed since the old audits — do NOT re-do

`?dev=1` paywall bypass (now localhost-only) · MP `__mpDev`/`__tour` harness (localhost-only) · leaderboard profanity filter · og/twitter share card 404 (clean summary card) · real `<title>`/description/favicon · campaign Easy on-ramp · `/score` play_token · journey-clip mobile preload windowing. The `procbg.js`/`share.js`/`telemetry.js` modules all exist + are in the deploy allowlist.

---

## 7. The "finish tonight" sequence

1. **You:** run the GitHub auth (§4). → tell me.
2. **You:** decide beta posture (public free beta is the fastest path). → tell me, I wire it (§3C).
3. **You:** hand the 4 backend items to Lovable (§3B) with the named briefs.
4. **Me (if you want):** backdrop auto-downgrade + support link + the remaining P3 polish, then — **only after you've playtested** — the content-freeze dev-hook strip.
5. **Deploy:** branch → push to `reactiv435/reactivvibeailive` at `/play` with the allowlist → PR → you merge → Lovable ships it.

For a **free beta**, that's the whole list. Paid SKUs add the payment top-up (Lovable) + legal surface (you) on top.
