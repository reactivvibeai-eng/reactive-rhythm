# Reactive Rhythm — Evolution Study & Roadmap
*Compiled 2026-06-14 from a 5-agent research workflow (designer critique · 5 user personas · competitive research · Guitar Hero history · evolution synthesis). Raw study archived in the session workflow output.*

---

## Executive summary
The game's **strongest surfaces** (in-game neck/HUD, the menu hub, the tournament cinematic flow) prove the team can hit a premium bar. The weakness is **consistency** — the rest of the app doesn't rise to that bar, and three things actively read as "broken/amateur":

1. **The split-screen versus HUD** — built from photoreal chrome "gauge" PNGs bolted onto the flat-neon solo HUD. Scores overflow their plates, multiplier dials float disconnected, a lone combo pill sits on a near-black deck.
2. **You can't feel the opponent play** — the data path exists, but the rival deck renders at ~18% dim-grey with no lane glow / colored gems / hit-flash, so it reads as a dead panel instead of a living rival.
3. **The browse page "hanging image"** — actually a *composition* bug: a 720px-capped column floats one album cover high in a tall, near-empty frame over a hazy red glow. (The video bg is fine.)

The biggest **single taste-uplift** (per the Hi-Fi Rush lesson) is to make the **whole frame breathe on the beat** — pure CSS/canvas, no new assets. The biggest **structural advantage** over Guitar Hero is our **owned, infinite, zero-licensing AI catalog** — lean into it as a seasonal, always-fresh feed.

---

## 1. Designer critique — per-screen grades

| Screen | Grade | Headline issue |
|---|---|---|
| Start / title | C+ | Nosifer "blood-horror" font (illegible, off-brand) + ~7 competing motions; weak text-only CTA |
| Atom loading | B | Infinite spinner, no progress signal → reads as "hung" during chart decode |
| **Menu hub** | **B+** | Strongest screen — but tiles lean generic-SaaS; no crimson heat on the primary action |
| Song browse | C | The "hanging image" — 720px cap + one floating cover + hazy glow stack |
| Gameplay HUD (solo) | B+ | Mature & on-brand; but `--cyan`/`--green` var-aliasing is a palette landmine |
| **MP split-screen** | **D** | **Priority.** Chrome gauge PNGs clash; score overflow; floating dials; dead rival deck |
| Results | B- | The 220px grade letter is grey (`var(--cyan)`) — the dopamine climax has no color |
| Tournament/champion | B | Ambitious & cohesive — the "taste ceiling" the rest should rise to |

**Top weaknesses (ranked):**
1. *(critical)* MP HUD = photoreal chrome PNGs clashing with the flat-neon solo HUD.
2. *(critical)* Score plates overflow + multiplier dials float + lone combo pill.
3. *(critical)* Rival deck is a faint grey ghost, not a living deck.
4. *(major)* Browse coverflow "hangs" over wasted desktop space.
5. *(major)* No display-type cohesion (Nosifer / Oxanium / Unbounded across 3 sequential screens).
6. *(major)* Results grade is grey — no payoff color.
7. *(minor)* `--cyan→silver` / `--green→gold` aliasing can regress the banned blue/green.

---

## 2. Five user personas (playtest)

- **Maya, 24 — casual, never played rhythm games:** loved the AAA title screen + fire juice; **bounced in the first song** with no forced tutorial (didn't know keys→lanes), confused by bombs & latency. *Ask: a forced 30-sec first-run tutorial.*
- **Devon, 33 — ex-Guitar-Hero Expert:** respected the string-accurate neck + chug + Overdrive; but **auto-onset charts "follow a beat-detector, not the riff"** and Medium/Hard are identical — no real Expert. *Ask: better charts + a real Expert tier.*
- **Priya, 27 — AI-radio music-discovery listener:** the coverflow is the star; wants **AI-radio badges (Golden Buzzer/judge grades) on the cards** + a **listen-first/preview mode**. Confirms browse "feels like a clip behind glass, not art-directed."
- **Marcus, 21 — competitive/leaderboard:** scoring depth is real; but **versus didn't reliably show the opponent** (degraded to a stats card), the HUD "looks placeholder," and **local scoring kills competitive trust**. *Ask: always-live rival deck + server-authoritative scoring + global ladder.*
- **Helen, 52 — non-gamer music fan:** charmed by the art; **the 5-lane interaction is a wall** — needs a **no-skill Listen/Watch mode** + plain-language feedback (not "S grade"/jargon).

**Unanimous threads:** (a) no on-ramp for first-timers, (b) the rival deck must always be visibly alive, (c) surface the AI-radio context, (d) a no-fail/watch lane for non-gamers.

---

## 3. Competitive research (2024–2026)

| Game | Lesson for us |
|---|---|
| **Fortnite Festival** | Split a tight **competitive lane** from a loose **no-fail JAM/party lane**; run **seasons + a featured artist** (we can do this from our own catalog at zero licensing cost). |
| **Beat Saber** | The **UGC/map ecosystem is the product**; near-term, **hit-feedback purity** — every note reads as a clean, weighty, on-beat event. |
| **Hi-Fi Rush** | **Make the WHOLE screen breathe on the beat** (HUD, world, mascot, menus). Highest perceived-quality uplift per unit of effort; pure CSS/canvas. |
| **osu! / osu!lazer** | The direct answer to "can't see the opponent": **render the opponent's actual note stream + live spectating + live leaderboard.** Proves a free, in-browser, no-peripheral competitive scene works. |
| **Arcaea / Phigros / Cytus** | **Touch-first legibility** (big tap targets at phone width) + **a-la-carte song/pack monetization** + light meta-progression. |
| **Clone Hero / YARG / RedOctane "Stage Tour" (2026)** | The note-highway is **alive**; the winning model is **live platform + community content + customization** (echoes our Ryo identity lever). |

**Market:** rhythm games ~$2.5B (2025) → ~$7B by 2033 (~12% CAGR), led by the accessible/mobile segment we sit in.

---

## 4. Guitar Hero — why it won, why it died, what transfers

**Why it won:** (1) the **note highway made music legible as skill** (pure software — we have it); (2) **embodiment via theater**, not the plastic — a committed, dramatic input the screen rewards with spectacle; (3) a **flawless difficulty on-ramp** (same song, Easy→Expert, infinite ceiling); (4) **social/party play** as the growth engine (watching the other player was half the fun); (5) **licensed songs = instant emotional buy-in**; (6) **juice** — every input got a disproportionate, escalating reaction, and Star Power was a risk/reward meta-rhythm on top.

**Why it died:** oversaturation/sequel fatigue · peripheral cost + setup friction · physical/novelty fatigue · mobile & free games ate the casual audience · **licensing economics collapsed**.

**What transfers to us (web, no peripheral):**
- **Over-invest in the highway's juice** (louder positive feedback, instantly-legible misses) before building more levels.
- **Reinvent embodiment as theater:** Overdrive (Space) = our "tilt the guitar" Star-Power moment — make it a committed, screen-flooding beat.
- **Fix versus = make the opponent visibly playable** (the party-play growth engine, rebuilt as software).
- **Difficulty on-ramp as a first-class feature** + a visible infinite ceiling (5★ → Full Combo → 100%).
- **Exploit our one structural edge GH never had:** zero licensing tax + an infinite fresh catalog → abundance where GH sold scarcity.
- **Never reintroduce activation energy** — "click a song, playing in 3 seconds" is the moat; a polished song-browse is the storefront that manufactures "I want to play THIS."
- **Recreate the spectator layer** (live rival deck, live verdicts "THEY CHOKED THE SOLO," shareable score cards, per-track leaderboards).
- **Add the risk/reward meta-rhythm** (when you fire Overdrive becomes a real decision).

---

## 5. Evolution plan — themes

1. **IDENTITY / Taste (M):** one display face (reuse `title-wordmark.png`; kill Nosifer), one motion language, single hero motion + real CTA on start; **de-risk the palette** (`--cyan→--silver`, `--green→--gold`, purge cyan/green tokens).
2. **FEEL & JUICE (M):** global **beat-pulse** on HUD/world/Ryo/menus; **color + celebrate the results grade** (S=gold bloom); Overdrive = theatrical full-screen beat; bind every meter to its value.
3. **SOCIAL / MULTIPLAYER (L):** rebuild the split HUD in one flat-neon language; **bring the rival deck to life** (~60–70% intensity, real glow/gems/catcher/hit-flash); harden the vs grid invariant; pull lobby inline styles into brand.
4. **DISCOVERY / Browse (M):** fix the coverflow composition (center it, flanking covers at width, widen to ~1100–1200px desktop, tame the glow); surface AI-radio badges; add a listen/preview mode.
5. **PROGRESSION / Retention (L):** forced first-run tutorial; **no-fail JAM/Watch mode**; visible skill ceiling; real Expert density; seasonal catalog engine; accessibility depth; trim the library header.
6. **3D-ASSET FORECAST (L):** cost-gated Higgsfield+Meshy pipeline — **rigged beat-reactive Ryo first**, then hero 3D guitar skins, then parallax world props; capability-gated with 2D fallback. **No spend until the taste + MP/browse fixes ship.**

---

## 6. Top-10 priorities (sequenced)

1. **Rebuild the MP split-screen HUD** in the flat-neon language (delete chrome gauge PNGs, auto-size score pills, value-bound chips, one mirrored cluster per deck). *Removes most of the "looks broken" read.*
2. **Bring the rival deck to life** (render at 60–70%: lane glow, colored gems, catcher, hit/miss flash). *Restores co-op feel.*
3. **Harden the vs layout** (grid on `.vs-mode` alone; assert non-zero deck widths before paint).
4. **De-risk the palette** (`--cyan→--silver`, `--green→--gold`, purge tokens) — cheap, do it while touching these files.
5. **Color + celebrate the results grade** (S=gold bloom + ember burst).
6. **Fix the browse coverflow** (center, flanking covers, widen desktop, letterboxed video band, tame glow).
7. **Unify display type** (wordmark PNG on start+hub+results; delete Nosifer; single hero start motion + crimson CTA pill).
8. **Global beat-pulse** (everything breathes on tempo).
9. **First-run tutorial + no-fail JAM/Watch mode** + visible skill ceiling; surface AI-radio badges on cards.
10. **This roadmap** + plan server-authoritative scoring + global leaderboard; cost-gated 3D pipeline (no spend yet).

---

## 7. Roadmap — current vs forecast

### 🔧 Current (this evolution pass — gets it test-ready)
- Rebuild MP split HUD in one flat-neon language; delete chrome gauge PNGs; auto-sizing score pills; value-bound chips/fill-arcs; one mirrored cluster per deck *(task #37)*
- Light the rival ghost deck to 60–70% — crimson glow + colored gems + catcher + hit/miss flash *(task #36)*
- Harden the vs grid (apply on `.vs-mode` alone; non-zero deck widths)
- Palette de-risk: rename `--cyan→--silver` / `--green→--gold`; purge cyan/green tokens
- Tier-color + celebrate the results grade
- Fix browse coverflow composition; widen desktop; letterboxed video band; tame glow *(task #38)*
- Unify display type to the wordmark PNG; delete Nosifer; single hero start motion + CTA pill
- Pull lobby/setup `mpx-*` inline styles (ember-orange + JetBrains Mono) into crimson/Chakra-Petch
- Global beat-pulse on HUD/backdrop/Ryo/menu chrome
- Forced first-run tutorial + no-fail JAM/Watch mode + visible skill ceiling; plain-language beginner results
- Surface AI-radio badges (Golden Buzzer / judge grade / Hot) + a listen-first preview on cards *(task #39 — needs the Lovable backend field)*
- Trim the overloaded library header for first-timers
- Audit hit-vs-miss legibility on the dark Bone Daddy world; reserve gold strictly for win/OD
- Accessibility: calibration depth, input remap + controller profiles, colorblind-safe note redundancy, low-FX toggle
- ✅ **DONE (v160):** Bone Daddy reactive fate-cards hidden in vs-mode (were rendering as broken dark boxes on the half-deck); purged a purple from the card fill

### 🔭 Forecast (after the taste pass + MP/browse fixes land)
- **Server-authoritative scoring + a real global per-track leaderboard** (competitive trust — Marcus's blocker)
- **Real Expert tier** with authored density separation + chart curation so notes follow the riff (Devon's blocker); note-scroll-speed + Classic/Musical toggle
- **Seasonal content engine:** monthly featured artist + fresh sets from the owned 852-track catalog (zero licensing tax — the moat)
- **3D pipeline (Higgsfield+Meshy, cost-gated, high-quality only):** rigged beat-reactive Ryo → 1–2 hero 3D guitar skins (cosmetic/identity unlocks) → parallax 3D world props; capability-gated with 2D fallback. **No spend until taste + MP/browse fixes ship; every batch budget-capped + cost-quoted first.**
- **Live social presence in tournaments:** on-screen live leaderboard + live spectating (on the softPresence layer — never native Supabase presence)
- **Generous identity-first monetization later:** seasonal pass (free+premium tracks), a-la-carte song/world unlocks, Ryo/guitar cosmetics — no pay-to-win/gacha
- **Shareable post-run grade/star cards** + live verdict broadcasts ("THEY CHOKED THE SOLO")
- **Controller / real-guitar (Clone Hero-style) input** as a stretch for the GH-lifer segment
- **Track A ship:** deployable set → `/play` + beta-code gate (per the handoff)
