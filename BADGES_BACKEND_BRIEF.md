# Badges on Catalog Tracks — Backend Handoff Brief

**For:** the ReactivVibe backend (Lovable) agent.
**Owner of this API:** the user / Lovable. We (the game) only consume it.
**Endpoint to change:** the `game-catalog` Supabase Edge Function
`https://bxiejoktoknybpraxebm.supabase.co/functions/v1/game-catalog`

---

## 1. What we need (one sentence)

Add a **`badges` array** to every track object returned by the catalog API so the
game can render award/curation chips (Golden Buzzer, judge letter-grades, Hot, etc.)
on the song-browse cover cards — **with zero client-side guessing.**

The catalog API does not currently expose any badge/award/acclaim field. This brief
asks you to add exactly one new field and (optionally) two convenience query params.

---

## 2. The new field: `track.badges`

Add a `badges` array to **each track object** in **both** of these responses:

- `GET /tracks?limit=&offset=&q=&sort=` — every item in the returned list
- `GET /track/:id` — the single track object

### Schema — one badge object

| key     | type     | required | notes |
|---------|----------|----------|-------|
| `type`  | string   | **yes**  | machine key. Known values: `golden_buzzer`, `judge_grade`, `hot`, `staff_pick`. **Open-ended** — the client must tolerate unknown strings (forward-compat). Use `snake_case`. |
| `label` | string   | **yes**  | human-readable display text, e.g. `"Golden Buzzer"`, `"Judges' Pick"`, `"HOT"`. The client shows this verbatim as a fallback / tooltip. |
| `tier`  | string   | no       | **only for `judge_grade`.** The letter grade: `"S" \| "A" \| "B" \| "C" \| "D"` (extend if your scale differs). Omit for non-grade badges. |
| `rank`  | number   | no       | optional ordinal for ordering/curation (e.g. `1` = #1 acclaimed). Lower = more prominent. Omit if not meaningful. |

### Hard rules (so the client can rely on it)

- **Always present, always an array.** When a track has no badges, return `"badges": []`
  — **never `null`, never omit the key.** This lets the client treat the field as
  guaranteed and skip defensive null-checks.
- **A track may carry several badges.** It's an array on purpose (e.g. Golden Buzzer +
  an S grade + Hot all at once).
- **Order matters for display.** Return them in the order you want them shown
  (most prestigious first is ideal). The client renders left-to-right as received.
- **Additive only.** Don't rename or change any existing field. This is a pure add.

---

## 3. Concrete JSON examples

> Showing only the relevant keys plus a couple existing ones for context. All current
> fields (`id`, `title`, `artist_credit_name`/`artist_name`, `artwork_url`, `audio_url`,
> `stream_url`, `play_count`, `genre`, `chart_status`, …) stay exactly as they are.

**A) Track with a Golden Buzzer + an S judge-grade (+ Hot):**

```json
{
  "id": "trk_8f3a21",
  "title": "Lunar Override",
  "artist_credit_name": "NØVA",
  "artwork_url": "https://cdn.reactivvibe.com/art/trk_8f3a21.jpg",
  "play_count": 18422,
  "genre": "synthwave",
  "chart_status": "pending",
  "badges": [
    { "type": "golden_buzzer", "label": "Golden Buzzer", "rank": 1 },
    { "type": "judge_grade",   "label": "Grade S",       "tier": "S" },
    { "type": "hot",           "label": "HOT" }
  ]
}
```

**B) Track with just "hot":**

```json
{
  "id": "trk_1c9d04",
  "title": "Backstreet Static",
  "artist_credit_name": "Mira Kade",
  "artwork_url": "https://cdn.reactivvibe.com/art/trk_1c9d04.jpg",
  "play_count": 9310,
  "genre": "pop",
  "chart_status": "ready",
  "badges": [
    { "type": "hot", "label": "HOT" }
  ]
}
```

**C) Track with no badges (the common case):**

```json
{
  "id": "trk_77be10",
  "title": "Slow Tide",
  "artist_credit_name": "Halden",
  "artwork_url": "https://cdn.reactivvibe.com/art/trk_77be10.jpg",
  "play_count": 142,
  "genre": "ambient",
  "chart_status": "pending",
  "badges": []
}
```

---

## 4. Where the data comes from (server-side, not client-side)

Badges are **derived from the AI Radio judging records** — the same source that powers
the "Golden Buzzer," judge letter-grades, and "Hot" status elsewhere on ReactivVibe.

- The catalog function should **join/derive** `badges` server-side from those judging
  tables (e.g. a `track_awards` / `radio_judgments` table, or whatever already holds the
  Golden Buzzer flag + per-judge grades + the Hot signal).
- **The client must not compute badges.** It will not have access to judging data, and we
  don't want every client reimplementing the curation logic. The server owns the mapping
  from "judging records" → the small, display-ready `badges` array described above.
- Suggested derivation:
  - Golden Buzzer flag set on the track → push `{ "type": "golden_buzzer", "label": "Golden Buzzer" }`.
  - An overall/consensus judge grade → push `{ "type": "judge_grade", "label": "Grade <X>", "tier": "<X>" }`.
  - The existing "Hot" signal (however you currently define it — recent play velocity,
    editorial flag, etc.) → push `{ "type": "hot", "label": "HOT" }`.
  - Editorial/staff curation → `{ "type": "staff_pick", "label": "Staff Pick" }`.

Keep the payload **display-ready and minimal** — don't dump raw per-judge scorecards into
the list response; collapse them to the badge summary above.

---

## 5. Optional but recommended (build the "Judges' Picks" shelf later)

These aren't required for v1 rendering, but they let the game build curated shelves
without extra round-trips:

1. **Include badges in the list endpoint (`GET /tracks`).** This is the important one —
   it lets the coverflow show badges immediately, with **no N extra `GET /track/:id`
   calls.** (Already covered in §2, restated here because it's the high-value piece.)

2. **`?sort=acclaimed`** — a new sort value alongside the existing `new|hot|az`. Orders
   tracks by curation strength (Golden Buzzer first, then judge grade S→A→…, then Hot).
   Lets the game build a "Judges' Picks" / "Acclaimed" shelf with one call.

3. **`?badge=<type>` filter** — e.g. `GET /tracks?badge=golden_buzzer` returns only tracks
   carrying that badge type. Supports a dedicated "Golden Buzzer" rail. Should still honor
   `limit`/`offset` and emit the `X-Total-Count` header like the other list queries.

If you ship these, keep the existing query params and the `X-Total-Count` header behaving
exactly as they do today.

---

## 6. Backward-compatibility & rollout

- **Purely additive.** Adding `badges` (and the optional params) does not change or remove
  any existing field, so it **won't break the current client.**
- **No flag, no versioning needed.** Just add the field. The game renders **nothing** for
  badges until the field appears, and renders only what's in the array once it does —
  so you can ship the catalog change and the game change in either order.
- **Anon read stays allowed.** Badges ride along on the same anon-readable responses; no
  new auth.
- **Safe partial rollout.** If judging data is missing for a track, return `"badges": []`
  for it (per §2) rather than failing the row.

---

## 7. Game-side contract (exactly what the client will do)

So you know precisely how the field is consumed:

- The client reads **`track.badges`** off each track object (list response preferred; falls
  back to `[]` if absent during rollout).
- For each badge it renders **one small chip on the cover card**, in array order:
  - `golden_buzzer` → **gold star chip** (gold accent), text = `label`.
  - `judge_grade` → **the `tier` letter** in a **tier-colored chip** (S = brightest/gold-ish
    down through the scale). Uses `tier`; falls back to `label` text if `tier` is missing.
  - `hot` → **crimson "HOT" chip**.
  - `staff_pick` / **any unknown `type`** → a **neutral chrome chip** showing `label`
    (this is why `label` is required — unknown types still render gracefully).
- `rank`, if present, may be used to order shelves / pick a "featured" track; it does not
  change chip appearance.
- **Brand palette is fixed:** warm-black, crimson, chrome, and gold only.
  **No blue, no green, no purple.** Chip colors will be chosen from that palette; the
  backend only supplies `type` / `label` / `tier` / `rank` — no colors or styling in the
  payload.

---

**TL;DR for the backend:** add `"badges": [ { type, label, tier?, rank? } ]` (always an
array, `[]` when empty) to every track in `GET /tracks` and `GET /track/:id`, derived
server-side from the AI Radio judging records. Optionally add `sort=acclaimed` and
`?badge=<type>`. Everything is additive and safe to ship now.
