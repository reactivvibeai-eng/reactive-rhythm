# Backend brief — Moderation reports + admin console + sanctions (Lovable)

**Owner ask (playtest-4):** "When someone gets reported, there should be admin controls on the
website — I want to be able to suspend them, send them a warning or a notification, with levels of
severity." This is the backend half. The game already ships the *reporting* UI (report modal, reason
chips, evidence buffer) and queues reports client-side; it just needs a real table + endpoint to POST
to, plus a place for you (admin) to act on them, plus a way for the game to *enforce* whatever you
decide. Three pieces below: (1) capture reports, (2) admin console to review/act, (3) sanctions the
game reads and enforces.

Same Supabase project as everything else: `bxiejoktoknybpraxebm`.

---

## 1. Capture reports — `rr_reports` table + `POST /reports`

The game already builds the exact row shape (catalog.js `submitReport`). It currently queues to
`localStorage rr_reports_queue`; the moment `POST /reports` exists it flips to a live POST (the queue
entry IS the POST body — no reshaping). **Match these field names exactly** so the flip is a one-liner:

```
rr_reports
  id            uuid pk default gen_random_uuid()
  target_id     text        -- reported player's auth uid (or guest id) — index this
  target_name   text
  room_id       text null
  match_id      text null
  reason        text        -- one of: Harassment, Cheating, Spam, Hate speech, Other
  note          text null   -- reporter's optional note (already profanity-filtered client-side, <=140 chars)
  evidence      jsonb null  -- array of last ~30 chat lines [{name,text,at}] for context
  reporter_id   text null   -- authed reporter uid (null if guest)
  reporter_name text null
  at            bigint      -- client epoch ms (keep; also add created_at)
  created_at    timestamptz default now()
  status        text default 'open'   -- open | reviewed | actioned | dismissed  (admin sets)
```

**Edge function `POST /reports`** (authed bearer, same pattern as `/plays`): validate `target_id`
present, clamp string lengths (target_name 60, reason 40, note 140, evidence ≤30 items), stamp
`reporter_id`/`reporter_name` from the verified JWT (do NOT trust the client's copy — overwrite it
server-side), insert. Return `{ ok: true, id }`. Rate-limit: max ~10 reports / reporter / hour
(abuse guard). Idempotency isn't critical (dupes are fine — the console dedupes by target).

**RLS:** authenticated users can INSERT (their own reporter_id only); only admins can SELECT/UPDATE.
Nobody can read others' reports. Guests: allow insert with reporter_id null if guest reporting is
desired, else require auth — your call, game handles both.

---

## 2. Admin console (website page, admin-only)

A `/admin/moderation` page (or a tab in the existing `/admin` surface). Admin identity = the same
`ADMIN_EMAILS` check the game uses (authenticated session email, not a query flag). Show:

- **Reports queue**, newest first, grouped/sortable by `target_id` with a **report count per target**
  (3+ reports on one player = auto-highlight — a real pile-on signal). Columns: target name, reason,
  reporter, when, note, and an expandable **evidence** view (the buffered chat lines).
- Per target, an **action bar** that writes a sanction (section 3): **Warn**, **Notify** (custom
  message, no penalty), **Mute** (duration), **Suspend** (duration or permanent), **Dismiss report(s)**.
  Each action sets the related reports' `status` and writes the sanction row + optional notification.
- A **history** view per player (past sanctions + past reports) so repeat offenders are obvious and
  you can escalate severity.

---

## 3. Sanctions the game enforces — `rr_sanctions` + `GET /me/sanctions`

The enforcement contract. The game calls one endpoint on session start (and on entering MP) and
respects whatever it returns. **Keep it dead simple for the game side:**

```
rr_sanctions
  id          uuid pk
  user_id     text        -- sanctioned player (index)
  type        text        -- warn | notify | mute | suspend
  severity    int default 1   -- 1..3 (your escalation levels; game shows sterner copy at higher)
  message     text null   -- shown to the player (e.g. "Warning: keep chat civil")
  expires_at  timestamptz null  -- null = permanent (for suspend) / not-applicable (warn/notify)
  active      bool default true -- admin can lift early
  created_by  text        -- admin uid
  created_at  timestamptz default now()
```

**`GET /me/sanctions`** (authed): returns the caller's currently-active sanctions
(`active = true AND (expires_at IS NULL OR expires_at > now())`), most-severe first:
```json
{ "suspend": { "message": "...", "expires_at": "..." } | null,
  "mute":    { "expires_at": "..." } | null,
  "pending_notices": [ { "id": "...", "type": "warn|notify", "severity": 2, "message": "..." } ] }
```

**Game-side enforcement (I build this — you just provide the endpoint):**
- `suspend` → block MP entry + a full-screen "account suspended until X / permanently" gate, brand-styled.
- `mute` → the player can play but their chat sends are dropped server-and-client-side until expiry.
- `warn` / `notify` (`pending_notices`) → shown once as a dismissible in-game modal (severity drives
  tone: gentle → firm → final-warning). Game POSTs `POST /me/sanctions/:id/ack` to mark a notice seen
  so it doesn't nag every launch. (Tiny endpoint: set a `acked_at` — add that column if easy.)

**RLS:** users SELECT only their own sanctions; only admins INSERT/UPDATE. `GET /me/sanctions`
derives user from JWT — never accepts a user_id param (no enumerating others' punishments).

---

## Priority / sequencing
1. **`rr_reports` + `POST /reports` first** — unblocks the live report flow already shipped in the game
   (right now every report just sits in the reporter's localStorage; nothing reaches you).
2. **Admin console** second — so you can actually see them.
3. **`rr_sanctions` + `GET /me/sanctions` + ack** third — the enforcement loop; game side is ready to
   consume it the moment it exists.

None of this blocks the game builds — reporting degrades gracefully (queues locally) until (1) lands,
and the game simply finds no sanctions until (3) lands. Ping me the final endpoint paths + the
`GET /me/sanctions` JSON shape if you change any field names and I'll wire the game to match.
