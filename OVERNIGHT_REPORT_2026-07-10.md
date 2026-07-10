# Overnight report — 2026-07-10 (autonomous run)

**TL;DR:** Shipped **build166 → build169**. Every one of your playtest notes is now either fixed or
answered. Two adversarial swarms ran; 27 claims were refuted down to 13 real defects, all fixed.
The multiplayer invite-link bug you hit is **found, fixed, and proven** with a live two-peer test I
ran myself. Nothing was published — that's still yours.

**The one thing that matters most: you still have to press Publish.** The code is all the way through
the pipeline — the Lovable deploy repo now carries `?v=467`, and the `?v=468` sync is in flight — but a
Lovable repo is not a published site. Until you Publish, the live game keeps serving the old bundle, and
you keep not hearing the audio package. **Publishing is the single highest-value action available and it
takes you about a minute.**

*(Precision, because it matters: earlier in this session I measured the live site at `?v=451`. I cannot
re-verify that number now — this sandbox has no DNS for `reactivvibe.com`, so every request returns
nothing. I'm reporting the deploy-repo version, which I did verify, and flagging the live version as
last-known-not-currently-checkable rather than restating a number I can't stand behind.)*

---

## Your playtest notes, one by one

| You said | Status |
|---|---|
| "Golden Buzzer thumbnails in Browse are completely broken" | **Fixed** (build166). One CSS property — `position: relative` — was overriding `.cover-card { position:absolute; inset:0 }`, which stopped `inset` from stretching the box. Every winner card collapsed to ~17px tall. Measured before/after on the same page: 2–19px → 273px, identical to a Featured card. The data was never at fault; all 35 artwork URLs return `200 image/png`. |
| "I didn't hear the new sound effects" | **Not a bug — you couldn't have.** The audio (`anthem`, `crimson-circuit`, the four hero SFX) exists locally and is **absent from production**. Publish and you'll hear it. |
| "I wish the UI was improved through solo gameplay… make our brand stand out" | **Done** (build168). Fable directed it; I implemented. See below. |
| "A couple rows of bombs but it wasn't very diverse" | **You were describing the emitter, not an impression.** The wall's anchor was a hard-coded constant, so every bomb wall in every song on every run spanned the identical centre lanes. Fixed in build169. |
| "The notes weren't tricky to hit… it was balanced" | Left alone deliberately. No difficulty value changed in either build. |
| "Is [Golden Buzzer + Album Release Parties] done? I want both done." | **Golden Buzzer: done** — it was never actually blocked on Lovable; the flag join had already landed (35 winners). **Album Release Parties: the client is correct and the endpoint works.** `/release-parties` returns 200, but both parties come back with `playable_track_ids: []` and both `live_until` windows have closed, so the shelf correctly renders nothing. I've asked Lovable whether that's a broken join or correct out-of-window behavior, and **I did not change the client** while the answer is unknown. |
| "Swarm it for vulnerabilities, performance, stability, usability" | **Done.** Six lenses, 27 claims, adversarially refuted to 13 real. Written up in `PRELAUNCH_HARDENING_v1.md`. |

---

## What shipped (branch `visual-overhaul`, synced to Lovable staging)

- **build166** — the Golden Buzzer cover collapse.
- **build167** — pre-launch hardening: 9 confirmed defects + a multiplayer session latch.
- **build168** — Fable's in-game UI polish: the frame joins the game.
- **build169** — hazard-shapes v1: the bomb wall finally moves.

### build167 — the two that actually mattered

**`ME.signedIn` was write-once-true.** One line set it to `true`; nothing in 622KB ever set it back.
So when your session expired in another tab, the game kept believing you were logged in: the online
roster silently emptied (its 401 swallowed), the sign-in prompt stayed hidden *because it reads that
stale flag*, and Battle Call offered a "Try again" that could never succeed — it had branches for 403
and 409 but **no 401 branch at all**. Now a 401 demotes you to guest and repaints. This was
auth-independent and would have hit real beta users silently.

**The loading screen was a one-way door.** No exit, a progress ring that lies, and up to a 30-second
hang on a dead track that reads exactly like a crash. There's now a Cancel at 2s and an honest
"taking longer than usual" line at 6s. Proven against a fetch that never settles.

Plus: two runaway `requestAnimationFrame` loops (one leaked a failed video as the backdrop for the
rest of the session), pinch-zoom restored (a hard WCAG fail), mute button now announces its state to
screen readers, three touch targets raised to 44px, and a transient network blip no longer permanently
disables the reclaim card.

### build168 — the frame joins the game

Fable's read of the solo screen: *the game is in the middle and a dashboard is bolted to the sides.*
The centre escalates all run long — strings ignite, catchers catch fire, the neck climbs the combo
ladder — while the two side panels sit at room temperature from first note to last.

Now the **frame heats with your combo**: panel borders, corner brackets, label diamonds and the brand
dot climb the same crimson → ember → gold → chrome ladder. It costs one style write per tier change,
zero per-frame work, and at combo 0 it renders exactly as before.

Also: **FEVER** — the tier ladder that keeps climbing after the ×4 badge caps — was rendering at
**9px**, the smallest text on screen; now 12px, and the vertical gauge label speaks the tier name. One
**gold brand pulse at Overdrive ignition** (the brand was previously a permanent 10px URL — a
watermark, not a brand). The keyboard legend now retires 8 seconds in and returns on pause. And an
*infinite* animation was deleted that had been repainting **three** progress meters, all run long, to
convey nothing.

**What I did NOT do:** Fable's R6 proposed reworking the right panel (Judgment Log, Vibe Channel).
That amends the HUD decree **you** locked in playtest-2. Fable flagged it `OWNER DECISION REQUIRED`
rather than doing it quietly. So did I. It's waiting for you.

### build169 — the bomb wall

`startLane = floor((LANE_COUNT − rowLanes) / 2)` was a **constant**. Every wall, every song, every run:
identical lanes, identical open gap. And on Medium — the difficulty you played — walls are the *only*
hazard that exists. The anchor now walks left/centre/right, seeded off the row's time so a chart
rebuilds identically for replays and for both peers of a match.

**I found a trap in Fable's own spec while doing it.** §6 said this was "ceiling-safe by construction:
bombs add no scored notes." True but incomplete. Gap-fill runs *after* the bomb pass and the notes it
invents **are** scored. A bomb sitting in a long rest splits that rest, suppressing fillers — so a
bomb's **time** silently controls how many scored notes exist, hence the score ceiling, hence
`CHART_VERSION`, hence whether every live leaderboard gets segmented. So build169 moves bomb **lanes
only**, and Fable's proposed "diagonal" wall is deliberately **not built**. Verified two ways: a
300-chart differential (4405 walls, zero row-time changes) and charting a real track on both builds
(`notes = 413` identically, ceiling `619,500` identically).

---

## Multiplayer: the invite link

You were right that it was broken, and wrong about one thing — I had **not** anticipated it. What I
knew was that multiplayer had never been proven, not that this path was broken.

I had also been telling you multiplayer couldn't be tested headlessly and making you do my testing.
**That was wrong.** Two dev-server configs already existed in this repo. Different ports are different
origins, so they get different browser identities, and both talk to the real production Supabase. Room
create / invite / join / convergence is pure networking — no game loop. I can test it. I now do.

**The bug:** a guest opening `?mproom=<dead-room>` was placed in a **fabricated room** with a ghost
"Opponent — WAITING", forever, in silence. Three independent mechanisms each destroyed the rescue
clock that was supposed to eject them. It was not an auth problem — a signed-in player hit it too.

**Proof:** a room ID that never existed → ejected at 45s with `NO HOST IN THIS ROOM`. Positive control
— a real live host → both players converge, still in the room at 76 seconds, not ejected. Zero console
errors on both peers.

Also fixed: the Invite button was copying a *sentence* to your clipboard, not a URL. Paste that into an
address bar and Chrome runs a web search. That alone explains a lot.

---

## The thing you cannot see

**364 completed plays have produced zero `song_start` / `song_complete` / `run_fail` rows.** Every
tuning decision on the roadmap is being made blind.

I chased it to the end and **stopped short of the fix on purpose.** `POST /events` returns
`200 {"ok":true,"accepted":1}` anonymously — the route works. The consent banner works. There is no geo
check anywhere. The funnel is empty because telemetry is **strict opt-in for everyone**, and across 364
plays essentially nobody clicked Accept.

Auto-accepting telemetry is a privacy decision with legal weight. **It is yours, not mine.** I've asked
Lovable to confirm the table has no RLS policy that would silently drop those rows, so that if you say
yes, we don't flip the switch and still get nothing.

---

## Waiting on you

1. **Publish.** Ships builds 152→169 and delivers the audio you never heard. It should also close the
   `?open=1` scoring hole — that hole was confirmed live in production earlier in this session; I could
   not re-confirm it tonight (no network to the live host from here), so treat it as "almost certainly
   still open" rather than as re-measured fact.
2. **Telemetry consent** — flip the default, or accept flying blind. Privacy call, yours.
3. **R6** — do you want the right HUD panel reworked? It amends your own decree.
4. **A playtest of the frame heat and the Overdrive brand pulse.** Both are verified to *work*; whether
   they *feel* right is a question no headless test can answer.

Waiting on Lovable: (a) does `game_funnel_events` have an RLS policy that would drop those inserts?
(b) is `/release-parties`' empty `playable_track_ids` a broken join or correct out-of-window behavior?

---

## Self-critique — where I was wrong tonight

You asked me to critique myself. Not a formality; here is the honest list.

- **I made you do my testing.** I told you multiplayer couldn't be verified without you, then found two
  dev servers already configured in this repo. The 2-account ceremony I put you through was mostly
  unnecessary. Written to memory so I don't repeat it.
- **`node --check` passed a `ReferenceError` I wrote.** I called `_demoteOn401(err)` inside a `catch (e)`.
  Syntax-valid, runtime-fatal, and only reachable on a real 401 — i.e. it would have shipped and broken
  exactly the thing it was meant to fix. I caught it by grepping every call site against its enclosing
  catch parameter. A syntax check is not a correctness check.
- **I ran five vacuous tests and nearly believed them.** A reduce-motion "control" where the videos were
  already hidden by two other rules; a loading-trap test against a port that fails in 1ms so the loading
  screen never appeared; a bomb-row probe reading a debug hook that doesn't expose bombs; a `curl` that
  "proved" a production security hole was still open when in fact the sandbox has no DNS for that host
  and every response was empty; and a grep for a `game.js` symbol run against `index.html`. Each one
  *passed*. The last two I ran **minutes after writing this very bullet** about the first three — which
  is the most useful thing in this report. An assertion that passes trivially proves nothing, and
  knowing that is clearly not the same as doing it. The countermeasure is mechanical, not attitudinal:
  every check needs a control that is *known to fail*.
- **I doubted Fable and was wrong.** I said `meterSheen` animated one layer, not three. There are three
  `.song-progress` elements. Measured: the census drops by exactly 3.
- **I trusted Fable and was wrong.** §6's "ceiling-safe by construction" would have moved the score
  ceiling on Medium and segmented your live leaderboards. Both directions of that failure are the same
  failure: not checking.
- **I chased a wrong hypothesis three times on one CSS rule** — blaming transitions, then specificity,
  then an `!important` that didn't exist — before running the experiment that settled it in one call.
  Headless freezes CSS transitions; my probe was reading pre-transition colors. I should have reached
  for the experiment two rounds earlier.
- **What I still can't tell you:** whether any of build168 *feels* good. Frame heat over a bright level
  video at 60fps, and whether the Overdrive brand pulse reads as signature or as noise — those need
  your eyes. I've said so rather than implying the verification covers it.

---

*Builds 166–169 · `?v` 464 → 468 · `score +=` count 17 throughout · `CHART_VERSION` 2 · `MAX_MULT` 4 ·
no scoring site added · brand linter 0 · zero console errors on a clean instrument.
HEAD = `ab926c7`. Nothing published.*
