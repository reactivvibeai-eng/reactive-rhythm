# Reactive Rhythm — ROADMAP (living doc, as of v139)

> **Phase: DESIGN / internal only.** This build is NOT for playtesters yet — too rough. We do NOT loop in
> Lovable until the USER decides to publish; at that point we hand L the full backend handoff. For now
> everything is local on `visual-overhaul`. Pairs with `CHANGELOG.md` + `CLAUDE.md`.
>
> **Ownership (corrected):**
> - **Assets = C (me)** generate via Higgsfield (gpt_image_2 — I know the exact dimensions + the templates
>   that fit the engine). **U** reloads credits + feeds reference images + art direction; **I build the
>   functioning level/asset from that.**
> - **C** = code + assets + in-engine verification. **U** = direction, references, taste, decisions.
> - **L (Lovable)** = backend — engaged ONLY at publish time.
>
> **Prime directive:** a FIRM understanding of the current platform before every change — small mistakes
> here are costly. Verify in-engine, eyeball before approving any generation, budget credits.
> **Hard constraint:** the user's app runs an OLDER browser engine than my test preview — no `:has()`/
> modern-only CSS for load-bearing logic (it silently no-ops).

---

## 0. My firm understanding of the platform (the foundation we build on)

- **Engine** (`game.js`): one rAF loop renders a single highway (`#hwy` canvas) with 1/z perspective; notes
  ride pixel-measured per-guitar string positions (`SKIN_GEOM`, `verified:true` gate). Notes = 3D marbles;
  holds = slim lane-tinted beams; chords/bombs/gap-fill. Charts come from `analyzeBeats` (onset detection,
  now with a synthetic-grid fallback). Per-level **mods** (speed/mirror/failOn) are wired + gated.
- **Levels** (`index.html` AUTHORED table): a level = guitar skin + backdrop (bgArt+bgVideo) + reactive
  cards + cover + song binding + theme/accent + mechanic + mods. Themed via `applyLevelTheme`/`clearLevelTheme`.
- **Multiplayer** (`multiplayer.js`): real `softPresence` broadcast-heartbeat (native Supabase presence
  never syncs here). Today: lobby + rooms (public/private) + tournament setup + a basic "GET READY" step +
  an **opponent stats panel** (`renderOpp` shows the opponent's broadcast score/combo — NOT their gameplay)
  + a basic winner scorecard + a static champion crown. Scores are peer-broadcast (spoofable — fine for
  design/casual; server-auth deferred to `MP_SERVER_SCORING_BRIEF.md`).
- **Assets/Higgsfield**: gpt_image_2 only (user decree), THE STYLE FORMULA prompt block, key-color (#FF00FF)
  transparency, guitars built i2i to the receding-neck template so string-tracking can measure them.

---

## TRACK A — LEVEL DESIGN (collaborative; C generates + builds, U directs)

### Pipeline (corrected — I generate the assets)
1. **U:** level concept (theme/vibe + which song or stride) + reference images + the details you want.
2. **C:** translate your refs into formula-locked Higgsfield prompts at the **exact engine dimensions** for
   each asset; **generate them** (gpt_image_2), eyeball a contact sheet, regen within budget.
3. **C:** measure the guitar's strings → `SKIN_GEOM`; wire the level row (theme/accent/cards/cover/mods/song);
   **verify in-engine** (strings ride the catchers, theme applies + clears, marble/beam read well, 0 errors).
4. **Iterate** on your eye until it's a real, functioning, beautiful level.

### Assets per level (I generate each)
- **Guitar skin** (hardest bar) — 5-string, receding-neck template, theme body, clean strings → measurable.
- **Backdrop** — `bgArt` (static) + `bgVideo` (loop), full-bleed, themed; (opt) `intenseVideo` combo-spike.
- **Reactive cards** (the two flanking tarot/fate cards), **cover art**, (opt) a **mechanic** asset.

### Backlog
- [ ] Finalize Melody / Bone Daddy / Skully to the "best level we've got" bar (refs from U).
- [ ] New levels from your reference images (we list each as we go).
- [ ] Fill the 3 missing backdrop mp4s (`pulse-loop`, `skully-intense`, `boss-loop`).
- [ ] (when U wants Campaign live, later) validate pinned `trackId`s + define `bossProviderFor`, then flip.

---

## TRACK B — MULTIPLAYER OVERHAUL (to the user's standard) 🎮

The big build. Current MP works mechanically but is visually flat (stats panel, "GET READY" text, static
bracket). The target experience: **lobby → synced countdown → SPLIT-SCREEN live versus → animated bracket
advance → winner celebration (animation + video).** Broken into shippable phases:

### B1 — Lobby/room polish + a real synced COUNTDOWN
- Tighten the lobby/room feel (presence, ready states, "opponent joined" beats).
- Replace "GET READY" with a real **3·2·1·GO** countdown animation, **synced to a shared start timestamp**
  over the channel so both decks begin the chart on the SAME beat (today the start is a loose handoff).
- *Encompasses:* clock-sync handshake, a branded countdown FX, both-ready gating, abort/disconnect handling.

### B2 — SPLIT-SCREEN live versus (the centerpiece)
The user wants to SEE both players: **you on the right, your online opponent on the left.**
- **Opponent state streaming:** broadcast the opponent's live play over the channel at a sane rate
  (~10–15/s): score, combo, multiplier, overdrive, stability, and lane hit/miss events (and ideally enough
  to draw their notes). Rate-limited + interpolated so it's smooth, not chatty.
- **Render a second highway** (the opponent's) on the left from their stream — a "ghost deck": their
  catcher flashes, hit/miss pops, combo, score, a slimmer/dimmer treatment so YOUR deck stays primary.
- **Layout:** split the play screen — your full deck right, opponent deck left (or a tasteful main+rail),
  with a center **VS / lead meter** showing who's ahead in real time.
- *Encompasses:* the streaming protocol, interpolation, the 2nd-highway renderer, the split layout +
  responsive sizing, the live VS/lead HUD, perf (two decks must hold frame-rate), and a graceful fallback
  to the stats panel if the opponent's stream drops.
- *Note:* spectator mode already mounts a read-only panel — the split-screen renderer reuses that path.

### B3 — Animated TOURNAMENT BRACKET (icons advance to the winner)
- A real bracket data model (rounds, seeds, pairings, advancement) feeding a clean bracket viz with
  **player avatars/icons**.
- Between rounds: the **winner's icon animates UP into the next bracket slot** (the moment the user wants),
  lines light as pairs resolve, all the way up to the final.
- Flow: round ends → show bracket → animate advances → next-match countdown (B1) → repeat → champion.
- *Encompasses:* bracket model + sync across clients, the avatar-advance animation, byes/odd counts,
  drop/forfeit handling in the bracket.

### B4 — WINNER CELEBRATION (animation + video clip)
- A real champion moment: winner avatar spotlighted, crown, confetti/FX burst, the loser(s) acknowledged.
- A **celebration video clip** — generated (Higgsfield video) and/or a procedural canvas FX sequence —
  to crown the tournament winner. (Decide generated-video vs in-engine FX with U; likely both: FX always,
  a short generated hero clip for the tournament champion.)
- *Encompasses:* the win/lose animation states, the champion screen redesign, the video asset(s) +
  self-heal, rematch/next flow.

### B5 — Robustness + trust (runs throughout)
- Disconnect/forfeit clean-up, **host migration** (elect a new referee — today the bracket dissolves if the
  host drops), fix the fixed-timeout handoffs (state-driven instead), the softPresence reliability.
- Scoring: peer-broadcast is fine for our private design testing; **server-authoritative** scoring
  (`MP_SERVER_SCORING_BRIEF.md`) is the Lovable item we hand off at publish for ranked/prizes.

---

## TRACK C — Standards (ongoing, NOT a "beta" gate while we're internal)
- Leaderboards: verify the client submit/display loop; the live `/score` is a publish-time Lovable item.
- Score-ceiling decision (hold sustain vs `notes_total*1500`) — settle the rule (also unblocks ranked MP).
- Browser-compat grep (`:has(`/`@container`) before each change; mobile pass; dev-hook strip is the LAST
  step and only at content-freeze.

---

## Sequencing — how I propose we start
Two big tracks (Level Design, MP Overhaul). They're independent; we can interleave, but I suggest:
1. **Pick ONE track to lead** (your call — see questions). Both start with you sending me material/decisions.
2. **MP overhaul order if we lead with it:** B1 countdown → B2 split-screen → B3 bracket → B4 winner → B5
   robustness. (B2 is the heavy lift; I'll deep-design it before building so we don't make costly mistakes.)
3. **Level design** runs whenever you send refs — I generate + wire + verify per level.

## Decisions to align on
- **Q1 — Lead track:** start with **MP overhaul** or **level design** first (or interleave)?
- **Q2 — Split-screen layout:** true 50/50 split (both full decks), or YOUR deck big + opponent as a
  smaller side rail? (Affects readability + perf.)
- **Q3 — Winner video:** generated Higgsfield hero clip for the champion, in-engine FX celebration, or both?
- **Q4 — First level:** which level do we build first, and do you have its references ready?
- **Q5 — Credits:** roughly what Higgsfield budget should I plan generations against per level / per MP asset?
