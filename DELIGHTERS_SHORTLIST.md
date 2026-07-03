# "Outside-the-box" delighters — prioritized shortlist (for the owner)

You asked me to think about *what else is missing* and take it outside the box. I ran a 4-lens
design swarm (retention/virality, first-session, competitive-social, moment-feel) against the full
feature set so nothing here duplicates what's already built or already on the PT4 roadmap. Below is
the curated, prioritized menu — pick what excites you and I'll build it.

## If you only greenlight three, make it these
They're cheap, they hit *every* session, and they close the two loops that actually drive a rhythm
game: **retry** ("one more try") and **return** ("open it tomorrow").

### 1. CLUTCH — the in-run comeback moment  ·  effort M  ·  every session  ⭐ my #1
When you rebuild a broken combo back **past where it snapped**, the neck erupts crimson and the HUD
screams **"CLUTCH ×2"** — turning your worst moment of a run into its most triumphant.
- **Why it's missing:** the combo-tier ladder and Overdrive only celebrate going *up*. Nothing today
  rewards *recovering* — a drop is pure punishment. This is the loss-aversion flip, the single biggest
  "one more try" hook in the genre, and it doesn't exist.
- **Build:** track `_peakCombo`/`_lastBreakPeak` in game.js; when combo climbs back past the break
  point, fire `flashJudgment('CLUTCH')` + reuse the combo-cutaway FX + a shake. Gate on a real prior
  peak (≥25) so it stays special. No scoring change.

### 2. ONE NOTE FROM GLORY — near-miss "almost" dopamine  ·  effort S  ·  frequent
A run that misses Full Combo or a grade-up *by a hair* gets a dedicated results stamp
(**"1 NOTE FROM FULL COMBO"**) + a pulsing **INSTANT REPLAY** button.
- **Why it's missing:** results celebrate wins (FC badge, GRADE UP) but say nothing on a heartbreaker
  near-miss — the exact ache that makes you re-tap Play. ~15 render-only lines in `renderResults`.

### 3. COME BACK TOMORROW — surface the streak you already save  ·  effort S  ·  every session
On exit, if your streak is alive: a slim gold ribbon — *"Streak: 6 days — play 1 song tomorrow to keep
it"* with an add-to-calendar tap. Miss a day and the freeze-save gets a dramatic **"STREAK SAVED"**
reveal on return.
- **Why it's missing:** the streak-*freeze* mechanic already exists in goals.js but is **completely
  silent** — the player never feels the save and there's no forward "don't break it" nudge. Cheapest
  retention win on the board; render-only against existing getters.

## The viral swing (bigger, higher ceiling)

### 4. RIFT REPLAY — the 6-second clip people actually share  ·  effort L  ·  frequent
Every run silently records its **hottest 6 seconds** (the peak-combo window). On results, one tap
gives you a **branded vertical MP4/GIF of that exact gameplay** — crimson neck, chrome brackets, gold
score end-card.
- **Why it matters:** `share.js` today makes a *static PNG of numbers*. Nobody shares a screenshot of a
  score — they share a **clip of a sick run**. This is the highest-ceiling virality lever we have, and
  it's the shareable artifact the roast copy has been begging for.
- **Build:** ring-buffer the last ~360 lane-frames (the frame getter is already public), replay the
  peak window into an offscreen canvas via `captureStream()` + `MediaRecorder`, composite the HUD +
  gold end-card, hand the blob to native share. GIF fallback where unsupported. New `replay.js`.

## Return-ritual & rivalry (medium)

### 5. NEMESIS — race a friend's real ghost, no servers  ·  effort M  ·  occasional
Share a song → your run becomes a **ghost link**. Your friend plays the same chart with your fading
gems + a live catch-up bar; results declare a head-to-head winner. **Every share is a challenge**, and
they challenge you back — viral *and* a return hook. Reuses the existing MP ghost deck + VS seam.
- Distinct from today's `setGhostTarget` (races a static *number*) and from live MP (needs both online).
  This serializes your actual per-note timeline into a URL and feeds the existing ghost renderer.

### 6. WEEKLY RIFT LADDER — the Sunday-night ritual  ·  effort M  ·  frequent
One curated track is **The Weekly Rift**; your best clear ranks on a fresh 7-day leaderboard that resets
Sunday midnight — countdown, podium reveal, "I placed #N this week" share card. Reuses `isoWeekKey()`,
the leaderboard podium/crown chrome, and the share-card builder. (Daily Rift is a per-day *multiplier* —
this is the recurring *competitive* ritual, which is absent.)

## First-session conversion

### 7. THE 20-SECOND RIFF — a guaranteed-glory first run  ·  effort M  ·  every first session
A brand-new player's very first run is a hand-authored ~20s mini-chart on a hype track that **cannot be
failed** and ends on a screen-filling combo — so their first 20 seconds are the *best* 20 seconds and
they've "won" before they even pick a song. (Distinct from the existing first-run-Easy toast, which just
sets difficulty on a real full song — this is a designed *opening moment*.) New `buildOnboardingRiff()`
with generous windows + gap-fill so the can't-fail is invisible, never a visible god-mode.

---

**Two more lenses** (competitive-social depth, moment-to-moment feel — crowd/audience reactions,
dynamic flow, signature per-song "holy cow" beats) were also explored; say the word and I'll surface
and expand those too. **My recommendation:** ship CLUTCH + ONE NOTE FROM GLORY + COME BACK TOMORROW as
a cheap "retry/return loop" pack first (all every-session, all low-effort), then invest in RIFT REPLAY
as the viral swing. I can start on any of these tonight while you sleep — just not without your nod,
since they're net-new features, not fixes.
