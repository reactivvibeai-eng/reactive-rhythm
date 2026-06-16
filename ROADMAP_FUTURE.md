# Reactive Rhythm — Master Forward Roadmap & Systems Guide
*Compiled at v175. The single forward-planning source: what's done, how the systems work, and everything left to ship.
Supersedes nothing — it folds in `RR_EVOLUTION.md` (taste/UX study), `MP_GAMEPLAN.md` (netcode), and `MP_SERVER_SCORING_BRIEF.md` (the backend gate).*

---

## 0. Where the game is RIGHT NOW (v175)

A feature-complete single-player rhythm game + a working friends/solo multiplayer tournament, all client-side
(vanilla JS + Canvas, no build). Live on `localhost:8787` via `serve.py`; ships to `reactivvibe.com/play`.

**Working & verified:** 852-track live catalog (search/sort, all in-browser-charted) · the string-accurate 5-lane
neck · hold/chord/bomb notes · palm-mute hit SFX · Overdrive/Star-Power · per-song + lifetime progression (Career)
· **levels** (Warm-Up/Pulse/Fracture tiers; themed worlds: Bone Daddy, Melody, Skully; boss mode) · a Store +
Sparks economy (scaffold) · **multiplayer**: 1v1 + 5–10p single-elim tournaments with a cinematic flow,
split-screen versus, live spectate, NPC bots, and (this work) self-healing netcode. The whole frame now **breathes
on the beat** with a **user-facing FX Intensity setting** (Subtle/Balanced/Intense).

**Gated OFF for now:** Campaign progression (`CAMPAIGN_PUBLIC=false`), ranked Multiplayer (`MP_PUBLIC=false`).
Both open when their backing work lands (below).

**Not yet done:** deploy to `/play` + the beta-code gate · server-authoritative MP scoring (the ranked blocker) ·
a forced first-run tutorial + no-fail mode · real Expert charts · seasonal content · the 3D-asset pipeline ·
stripping dev hooks. Detail below.

---

## 1. HOW THE SYSTEMS WORK (so the next decision is informed)

### 1a. The engine & charts
`game.js` is the engine: a `requestAnimationFrame` loop drives input → judgment → scoring → Canvas render. Every
song needs note-timings ("a chart"). Two paths:
- **In-browser (today, all live tracks):** `bufferedProvider` fetches a track's `audio_url`, decodes it (WebAudio),
  runs `analyzeBeats` (onset detection) to build the chart, and plays the decoded buffer. Works with zero backend.
- **Server pre-baked (`liveProvider`, when `chart_status:"ready"`):** instant + identical for everyone + leaderboard-
  safe. The engine prefers it when present. **No tracks are server-charted yet** — this is the path that unlocks
  fair competition (see §3 MP-public).

Note types (`buildNotes`): tap · accent · star · **hold** (real sustain) · **chord** (2 lanes) · **bomb** (don't-hit)
· gap-fill filler. Difficulty (easy/medium/hard) + Chart Feel (Classic/Musical) + Note Variety + Timing Feel are all
user settings. **Today Medium and Hard are nearly identical density** — there is no real Expert (Devon-persona blocker).

### 1b. Levels
Levels are defined inline in `index.html` (`RhythmLevels` / `RhythmLevelFx`). Each level carries a theme (palette +
guitar skin + gem tint), an ambient backdrop video (`bgVideo`), an optional **intense combo gag** (`intenseVideo` —
e.g. Melody's cat tumbling, fired on combo milestones; v175 fixed it to play through to its natural end instead of
being chopped at 5.2s), reactive fate-cards, a per-level mechanic (Bone Daddy booty-shake, Melody cat-paw), and
optional gameplay mods (speed/mirror/fail-on) + boss mode. Tiers: Warm-Up → Pulse → Fracture, star-gated.

### 1c. Progression & economy
Every run records locally (`RhythmCatalog.recordLocal`) → per-song best + a lifetime **Career** (score/runs/accuracy/
full-combos/rank title). A **Store** spends **Sparks** on guitar skins + levels (the catalog/pricing is scaffolded;
real purchase/grant needs the backend). Cover grades + the Career are real and persistent.

### 1d. MULTIPLAYER / TOURNAMENTS — the larger logic (you asked)
All MP is **peer-to-peer over Supabase Realtime broadcast** — there is NO game server. One important project fact:
native Supabase **presence never syncs** here, so every "who's in the room" surface rides a custom **softPresence**
broadcast-heartbeat layer (10s beat / 75s expiry), never `channel.track()`.

**The tournament journey:**
1. **Create** (host) → `openTour` makes a real `rr-tour-<id>` channel; the host advertises it on the lobby. Host sets
   the **settings**: bracket **size** (5–10), the **stage pool** (which level-worlds the rounds rotate through; default
   Random), and the chart **difficulty**. Everyone in the room sees these (broadcast via `t-track`).
2. **Fill** → players join from the lobby list or an `?mpjoin=<id>` invite link; softPresence keeps the roster live.
3. **Start** (host, needs ≥3) → `hostBeginRound` shuffles players into pairs, broadcasts `t-round` with a synced
   start timestamp; every client runs the **ROUND → VS → 3·2·1 cinematic**, then the song on the round's stage.
4. **Play & settle** → each duelist streams `t-tick` (~3/s, live scores) + a final `t-final` at song-end; the host is
   the **referee**: it decides each pair's winner (score > accuracy > id tiebreak), survivors advance.
5. **Advance** → between rounds the host clicks START NEXT ROUND (or auto in dev); repeat until one player remains →
   `t-finalverdict` → `t-champ` → the champion reveal. Eliminated/bye players drop into **live spectate** and watch
   the bracket climb to the champion.

**The host is the single source of truth.** This session hardened that so a live bracket survives drops (all ADDITIVE
— the FSM above is unchanged):
- **`t-snapshot` heartbeat** — the host rebroadcasts a versioned mirror of the whole referee state every 4s + on every
  transition; clients apply the newest idempotently → dropped events self-heal.
- **Reconnection** — state persists to `sessionStorage`; reload mid-bracket → you rejoin in place from the snapshot.
- **Host migration** — if the host drops, the earliest-joined survivor is deterministically elected and resumes
  refereeing from the snapshot (replaces the old "tournament dissolved").
- **Proof-of-life forfeit guard** — a player still streaming `t-tick` is never forfeited by a transient presence blip.
- **Score sanitation** — junk/overflow finals are clamped on receipt (a sanity guard — NOT anti-cheat).

**Verified:** the bracket FSM end-to-end (R1 full lifecycle + advance, headless), AND over the **real Supabase
transport** with a genuine 2nd peer (presence + snapshot + sanitation round-tripped). The full UI reconnect/migration
*handoff* across two real game instances is the one thing that needs a manual 2-device pass — see `MP_SMOKE_TEST.md`.

**The catch:** results are still **peer-computed**, so MP is **casual-only** until server-authoritative scoring lands.
That's the single thing standing between today and ranked/public MP (§3).

---

## 2. SHIP TRACK — get it in front of users (highest priority)
*None of this needs new features; it's the path to a live beta.*
- **[L · blocked on user git auth] Deploy the game to `reactivvibe.com/play`** — move the deployable set
  (`index.html`, `game.js`, `jukebox.js`, `catalog.js`, `jukebox.css`, `assets/`) into the Lovable repo
  (`reactiv435/reactivvibeailive`) at `/play` on a branch → PR. Blocked on a one-time user GitHub auth (see the v43
  handoff in CLAUDE.md "Auth blocker"). Fix asset paths if `/play` is a subpath.
- **[M] Beta-code gate** — the game-side gate per `BETA_GATE_BRIEF.md` / `BETA_BACKEND_LOVABLE_PROMPT.md`.
- **[S — do LAST] Strip dev hooks** — `__rrDebug`, `__rrChartStats`, `__rrJuice`, `__mpDev`, `RhythmMP.__tour`,
  `fakeTourChannel`, the FPS meter, `?dev/?novideo/?fps/?mock` flags. **Only after content-freeze.** (The FX Intensity
  *setting* stays — it's user-facing; only `__rrJuice` the console hook goes.)
- **[S] Decide the beta defaults** — Classic vs Musical chart, Fail-Mode on/off, **FX Intensity default** (you'll pick
  after playtesting Subtle/Balanced/Intense — tell me which to bake in).

## 3. MULTIPLAYER → PUBLIC (the ranked blocker, then the social layer)
- **[L · needs Lovable backend] Server-authoritative scoring** — the ONE blocker for `MP_PUBLIC=true`. An Edge Function
  re-judges/validates submitted results so a peer can't fake a win; `winnerId` comes from the server, not a peer. Full
  spec in `MP_SERVER_SCORING_BRIEF.md` (the client already tags finals with chart context + a `ranked` flag, ready for
  it). Requires server-baked charts (so "same song" = same chart) — overlaps with Expert charts (§4).
- **[M] Real 2-device QA pass** — run `MP_SMOKE_TEST.md` (reconnect + host-migration handoff) on two machines before
  any public MP.
- **[M, after public] The social layer** (from MP_GAMEPLAN "LATER"): a single animated **live leaderboard** for 5–10p
  rounds (cheaper + more tense than 10 ghost decks; reserve split-screen for 1v1 + the final) · host-selectable **win
  condition** (Score/Accuracy/Combo) · **async ghost** challenges (race a friend's PB — beats cold-start matchmaking) ·
  vote-on-next-song · one-tap rematch · an unscored **Jam/Party** room.

## 4. CONTENT — the structural moat (owned, infinite, zero-licensing catalog)
- **[M] Real Expert tier** — authored density separation so Medium ≠ Hard ≠ Expert, and charts that follow the *riff*,
  not just the beat-detector (Devon-persona blocker). Pairs with note-scroll-speed + the Classic/Musical toggle.
- **[M] More levels + a level picker** — grow the level scaffold into more distinct playable worlds with a proper
  picker (the campaign tiers exist but are thin).
- **[M] Seasonal content engine** — a monthly featured artist + fresh sets pulled from the 852-track catalog at zero
  licensing cost. This is the single biggest structural advantage over Guitar Hero — lean into abundance.

## 5. PROGRESSION / RETENTION (the funnel — 3 of 5 playtesters bounced)
- **[M] Forced first-run tutorial** — a 30-sec "keys → lanes" teach (Maya/Helen bounced with no on-ramp).
- **[M] No-fail JAM / WATCH mode** — a no-skill lane for non-gamers + plain-language results (not "S grade" jargon).
- **[S] Visible skill ceiling** — surface 5★ → Full Combo → 100% as the climb.
- **[M] Achievements + daily challenge + practice-with-section-loop** (GH-grade add-ons).
- **[S] Surface AI-radio badges** on cards (Golden Buzzer / judge grade / Hot) — needs the backend `badges` field
  (`BADGES_BACKEND_BRIEF.md`).

## 6. JUICE / TASTE polish backlog (mostly pure CSS/canvas, no assets)
- ✅ **Done this session:** whole-frame beat-bloom (every stage) · Overdrive ignition flash + shockwave · results S/A
  ember burst · menu atom-breathe + crimson primary-CTA heartbeat · **user FX Intensity setting** · Melody combo-gag
  plays through · fixed 2 stray-green brand violations + added keyboard focus rings + a reduce-motion guard.
- **[S] Remaining from the polish sweep (P2/P3):** focus-visible on the last few jukebox buttons (jb-play/jb-browse/
  view-back are now covered; double-check tabs) · raise empty-Career stats opacity (0.32 → ~0.5, reads "broken") ·
  the "owned" store button contrast · misc nitpicks (logged, low-risk).
- **[M] Browse coverflow composition** — center it, flanking covers at width, widen desktop to ~1100–1200px, tame the
  glow (RR_EVOLUTION's "hanging image" critique).
- **[S] Unify display type** — wordmark everywhere; ensure no Nosifer/clashing faces survive.
- **[S] Tune the FX Intensity default** to taste once you've playtested.

## 7. 3D ASSETS (cost-gated — NO spend until taste + MP/browse fixes ship)
Higgsfield + Meshy pipeline, every batch budget-capped + cost-quoted first, capability-gated with a 2D fallback:
**rigged beat-reactive Ryo first** → 1–2 hero 3D guitar skins (cosmetic unlocks) → parallax 3D world props.

## 8. MONETIZATION (identity-first, generous — later)
Seasonal pass (free + premium tracks) · a-la-carte song/world unlocks · Ryo/guitar cosmetics. **No pay-to-win, no
gacha.** The Sparks economy + Store scaffold already exist; wire real grants when the backend's ready.

## 9. ACCESSIBILITY & TECH HEALTH (ongoing)
- Calibration depth, input remap + controller profiles, **colorblind-safe note redundancy**, a low-FX toggle (the FX
  Intensity setting is a start; Reduce Motion + Performance mode exist).
- Keep the **no-`:has()`/no-modern-CSS** rule (the desktop app runs an older Chromium).
- Watch the catalog scale (server-side `?q=` search when the library hits thousands).

---

## 10. RECOMMENDED SEQUENCE (what I'd do next, in order)
1. **Playtest v175** on your machine — confirm the juice feel (pick an FX Intensity default), Melody's gag, and run
   `MP_SMOKE_TEST.md` on two devices. Tell me what to tune.
2. **First-run tutorial + no-fail Jam mode** (§5) — biggest retention win, no backend needed, unblocks a wider beta.
3. **Ship track** (§2) — unblock the GitHub auth, move to `/play`, beta gate, decide defaults. (Can run in parallel.)
4. **Real Expert charts + a few more levels** (§4) — depth for the players who stick.
5. **Server-authoritative scoring** (§3) — the moment you want *ranked* MP + a global ladder. Backend-gated.
6. **3D Ryo + cosmetics** (§7) — once taste + MP are locked and you greenlight the spend.

## 11. OPEN DECISIONS FOR YOU
- **FX Intensity default** — Subtle / Balanced / Intense? (Playtest, then tell me.)
- **Beta defaults** — Classic vs Musical chart; Fail-Mode on/off.
- **MP for the beta** — ship casual MP now (peer-scored, clearly "for fun"), or hold all MP until server scoring?
- **Content vs ship first** — polish/tutorial first, or push to `/play` immediately and iterate live?
- **3D spend** — when (if) to greenlight the cost-gated Higgsfield/Meshy pipeline.
