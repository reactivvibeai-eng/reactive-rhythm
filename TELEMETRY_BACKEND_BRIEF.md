# TELEMETRY_BACKEND_BRIEF.md — error reporting, funnel events, public-endpoint hardening (hand to the Lovable agent)

## Goal
The gated beta has to **learn** — but right now the game flies blind. Errors are written ONLY to
`localStorage rr_errlog` (invisible to us), there is **zero** event/funnel instrumentation anywhere,
and the public anon-key endpoints (`POST /plays`, `/score`, `/uses`) can be spammed the moment
`/play` goes public. Build the three things below. The game already **captures** the errors and will
emit the events — it just needs **somewhere to send them**, plus basic protection so day-one data
isn't garbage.

These are **roadmap blockers OP.1 + OP.2 (P0 for beta)** and **OP.10 (P1)** — a beta without this
sink can't be graded (see the go/no-go bar in `DEPLOY_OPS.md` §B).

API base today: `https://bxiejoktoknybpraxebm.supabase.co/functions/v1/game-catalog`
(put these on that edge function, or a sibling — tell me the final paths and I'll wire the client.)

---

## Part 1 — `POST /clientlog` (error / crash reports)

The game has a global error capture already; today it only writes `rr_errlog` in the browser. Give it
a remote endpoint + a table so a tester's JS/AudioContext crash leaves a signal we can see.

### Table: `client_logs`
| column | type | notes |
|---|---|---|
| `id` | uuid / bigserial | pk |
| `ts` | timestamptz, default now() | server receipt time |
| `client_ts` | timestamptz, null | when it happened on the client (we send it) |
| `session_id` | text | anonymous per-load id the game generates |
| `user_id` | uuid → auth.users, null | present only if signed in |
| `ua` | text | `navigator.userAgent` |
| `url` | text | `location.href` at error time |
| `message` | text | error message |
| `stack` | text, null | stack trace (may be long — `text`, not `varchar`) |
| `app_version` | text | the `?v=NN` build tag the game sends |

### Endpoint
**`POST /clientlog`** — body is the row above (minus `id`/`ts`), `Content-Type: application/json`.
Anon key allowed (errors happen before/without login).
- Insert one row. Return `{ "ok": true }` (fire-and-forget; the game won't block on it).
- **Accept a small batch too:** body MAY be an array of up to ~20 rows (the game buffers `rr_errlog`
  and flushes on next load). Insert all; same `{ "ok": true }`.
- Be lenient on shape: store what's present, null the rest. Never 500 on a malformed field — a logging
  endpoint must not itself error.

---

## Part 2 — `POST /events` (funnel analytics)

A single generic events table the game writes to across the player journey. One flexible endpoint, not
one-per-event.

### Table: `events`
| column | type | notes |
|---|---|---|
| `id` | bigserial | pk |
| `ts` | timestamptz, default now() | server receipt time |
| `client_ts` | timestamptz, null | client event time (we send it) |
| `session_id` | text | same anon per-load id as `/clientlog` (joins a session together) |
| `user_id` | uuid → auth.users, null | present only if signed in |
| `event_name` | text | from the list below (index this column) |
| `props` | jsonb, default '{}' | event-specific payload (trackId, difficulty, score, sku, etc.) |
| `app_version` | text | the `?v=NN` build tag |

Index `event_name` and `ts` (we'll query funnels by event over time windows).

### Endpoint
**`POST /events`** — body = one event row, OR an array of up to ~50 (the game batches to save
requests). Anon key allowed (a load/song-pick happens before login). Insert all; return
`{ "ok": true }`. Same leniency as `/clientlog` — never 500 on a bad `props` blob; just store `{}`.

### The key events the game will emit (the funnel)
This is the contract — these names + the shape of `props` are what the client sends:

| `event_name` | When | `props` (example) |
|---|---|---|
| `load` | `/play` boots | `{ ref, returning }` |
| `song_pick` | player selects a track | `{ trackId, source }` |
| `song_start` | the run actually begins (audio + chart playing) | `{ trackId, difficulty }` |
| `first_note` | first note reaches the catcher (charting succeeded) | `{ trackId, msToFirstNote }` |
| `song_complete` | player finishes the song | `{ trackId, difficulty, score, accuracy, fullCombo, maxCombo, grade, notesHit, notesTotal, boss, mode }` |
| `run_fail` | run ended early (Fail Mode) | `{ trackId, difficulty, atPct, maxCombo, mode }` |
| `chart_stall` | the in-browser charter never produced a playable chart | `{ trackId, reason }` |
| `store_open` | the store/cosmetics screen is opened | `{ }` |
| `purchase_attempt` | a buy is initiated | `{ sku, currency, price }` |
| `purchase_success` | the buy + entitlement grant confirmed | `{ sku, currency, price }` |

> These map 1:1 to the go/no-go metrics in `DEPLOY_OPS.md` §B: `load` = reach, `song_start →
> song_complete` = completion, `song_pick`-without-`first_note` (or `chart_stall`) = stall rate,
> `purchase_attempt → purchase_success` = purchase integrity. Don't rename them without telling me.

---

## Part 3 — Rate-limiting + sanity validation on the public anon-key endpoints

`POST /plays`, `/score`, `/uses` — and the new `/events`, `/clientlog` — are all reachable with the
**anon key** the instant `/play` is public. With no protection, a script can inflate play counts, spam
the **solo leaderboard**, and pollute the fresh analytics from day one. Add basic abuse resistance
(this does NOT need to be full anti-cheat — that's the separate server-authoritative-scoring project;
this is just "stop trivial spam").

### Rate-limiting (per source, sliding window)
- [ ] Key a limiter on **IP + `session_id`** (and `user_id` when present). Suggested ceilings (tune):
  - `/events`, `/clientlog`: generous (these are high-volume by design) — e.g. **≤ 600/min** per
    session; drop (silently `{ok:true}`) over the cap rather than erroring.
  - `/plays`, `/uses`: **≤ ~30/min** per session — nobody legitimately records 30 plays a minute.
  - `/score`: **≤ ~20/min** per session, AND **one accepted score per (user/session, trackId, run)**
    if a run id is present — kills replay spam.
- [ ] Over the cap → **429** (or silent no-op for the logging endpoints). Never let one source flood a
      table.

### Sanity validation (reject obviously bogus rows server-side)
- [ ] **`/score`:** reject scores above a sane ceiling for the track (e.g. `notes × per-note-max`;
      holds can push legit score over a naive `notes×1500`, so derive the ceiling from the chart, not a
      flat constant). Reject `NaN`/negative/non-numeric. **This is the leaderboard's first line of
      defense** until server-authoritative re-judging exists.
- [ ] **`/plays`, `/uses`:** require a real `trackId` that exists in the catalog; reject unknown ids.
      De-dupe obvious floods (same session hammering the same trackId).
- [ ] **`/events`:** `event_name` must be in a known allowlist (the 10 above) — drop unknown names so
      a script can't invent events and pollute funnels. Cap `props` size (e.g. ≤ 4KB).
- [ ] **`/clientlog`:** cap `message`/`stack` length (e.g. truncate at a few KB) so a log bomb can't
      bloat the table.
- [ ] Across all: **validate, don't trust** — the anon key is public; treat every field as hostile.

> Note for context: the solo leaderboard ships in the beta as a **public UGC surface** (names render
> via `esc()` — XSS-safe but content-unsafe). Name **profanity filtering** is a related game-side/
> backend item (Roadmap OP.3) — out of scope for this brief, but if you can reject obvious slurs in
> the name field on `/score` ingest, that's a welcome bonus.

---

## What the game side will build against this (the contract)

I'll build a small **telemetry client** with a **swap-seam**: a single `RhythmTelemetry` module with
`.event(name, props)` and the existing error capture flushing to `.log(err)`. It points at a config'd
base URL (defaults to these endpoints) so we can repoint or disable it without touching call sites.
Specifically the game guarantees:
- One stable anonymous **`session_id`** per page load, sent on every `/events` + `/clientlog` call so
  rows from one session join up.
- The **`app_version`** field = the live `?v=NN` build tag on every call.
- **Batching + fire-and-forget:** events buffer and flush (on a timer + on `song_complete`/unload);
  the game never blocks gameplay on a telemetry response, and tolerates the endpoints being down
  (degrades to local-only, exactly like today) so the beta is never blocked if these aren't live yet.
- It sends **only** the fields in the tables above — no PII beyond the optional `user_id` (which is
  just the existing auth uuid) and `ua`/`url`/`ip` (standard web-request data). Worth a line in the
  privacy policy (Roadmap 1.1 / OP.7).

---

## Definition of done
1. **`POST /clientlog`** accepts a single row or a small batch, writes `client_logs`, returns
   `{ ok:true }`, never 500s on a malformed field, works with the anon key.
2. **`POST /events`** accepts a single row or a batch, writes `events` (with `event_name` + `ts`
   indexed), enforces the **event-name allowlist** (the 10 names above), returns `{ ok:true }`, works
   with the anon key.
3. **Rate-limiting** is live on `/plays`, `/score`, `/uses`, `/events`, `/clientlog` (per IP +
   session), and **`/score` does server-side sanity validation** (chart-derived ceiling, no
   NaN/negative, one-per-run if a run id is sent).
4. **RLS:** `events` + `client_logs` are **insert-only for anon** and **not anon-readable** (only the
   owner / service role can read them — they're our analytics, not public).
5. You tell me the **final endpoint paths** (and any field-name tweaks) so I can point the telemetry
   client's swap-seam at them; I confirm a live `load` event + a forced test error land in the tables.

---

## Part 4 — the website "Six-Sigma" analytics views (what the data is FOR)

The owner wants the website to answer two questions from this `events` table: **what gets played**, and
**what's most enjoyed** — with enough rigor to spot outliers (a song everyone quits, a song everyone
replays). Build these as **materialized views** on `events`, refreshed on a schedule. (The client now
emits `song_start` per attempt + the **enriched `song_complete`** above — that pair is the whole engine.)

### `mv_song_enjoyment` — one row per `(trackId)` (and a `_by_diff` variant keyed on `(trackId, difficulty)`)
Derived purely from `events` over a rolling window (e.g. last 30d):
| metric | formula (per trackId) |
|---|---|
| `plays` | count(`song_start`) — the **play count / popularity** |
| `unique_players` | distinct `coalesce(user_id, session_id)` with a `song_start` |
| `completions` | count(`song_complete`) |
| `completion_rate` | `completions / nullif(plays,0)` — **the #1 enjoyment proxy** |
| `quit_rate` | `count(run_fail or song_start-without-complete) / plays` |
| `replays_per_player` | `plays / nullif(unique_players,0)` — voluntary repeat = strong enjoyment |
| `avg_accuracy` | avg(`props.accuracy`) over completions |
| `avg_maxcombo` | avg(`props.maxCombo`) |
| `fc_rate` | `count(fullCombo=true) / completions` |
| `grade_mix` | jsonb tally of `props.grade` (S/A/B/C/D) |
| `enjoyment_index` | a single 0–100 blend, e.g. `100 * (0.5*completion_rate + 0.3*min(replays_per_player/2,1) + 0.2*(1-quit_rate))` (tune the weights) |

### The "Six-Sigma" layer (outlier detection across the catalog)
On top of `mv_song_enjoyment`, compute the **catalog-wide mean + stddev** of `enjoyment_index` (and of
`completion_rate`), then per song a **z-score = (song − mean) / stddev**. The dashboard bands:
- **z ≥ +2** → "fan favorite" (statistically over-performing — promote / feature / make more like it).
- **z ≤ −2** → "problem track" (over-performing on quits — re-chart, re-difficulty, or retire).
- within ±1σ → the normal mass.
This is the literal control-chart / Six-Sigma view: songs are points, ±2σ are the control limits, and
anything outside is a signal worth acting on. Expose it as a sortable table + a scatter (popularity ×
enjoyment_index, colored by z-band).

### `mv_funnel_daily` — the go/no-go funnel by day
`load → song_pick → song_start → first_note → song_complete → purchase_*`, counted per day, so the team
watches **completion rate, chart-stall rate, and purchase integrity** trend over the beta.

### Refresh
`REFRESH MATERIALIZED VIEW CONCURRENTLY` on a **pg_cron** schedule (e.g. every 15 min for funnel,
hourly for enjoyment). Views are **owner/service-role readable only** (same RLS posture as the base
tables). The website reads the MVs through an authed/service path — never the raw `events` table.

### Allowlist delta (add to Part 2's validation)
The enriched `song_complete`/`run_fail` props above are the same event names (no new names needed for
this) — just **don't drop the new keys** (`maxCombo, grade, notesHit, notesTotal, boss, mode`). If/when
the client adds `level_unlock`, `share`, `settings_change`, `run_quit` they'll be announced here first so
you can extend the allowlist (Part 2 drops unknown `event_name`s by design).
