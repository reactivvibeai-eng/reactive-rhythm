# Browse: Golden Buzzer Winners + Album Release Parties — design brief & backend ask

Two owner wishlist features that make the game a live window into the platform. Both are **backend-
feasible with real content today** — the data model already exists; the work is exposing the groupings
through the `game-catalog` API and wiring two Browse shelves in the game.

## Verified data reality (prod Supabase, 2026-07-04)
- Join key across ALL systems = **`submission_id`**. `rr_consented_tracks` (1,401 rows) is the PLAYABILITY
  gate — a near-mirror of `radio_tracks` + `submission_id`, `creator_user_id`, `rr_game_consent_at`.
- **Golden Buzzer:** `golden_buzzer_awards` (41 rows: submission_id, awarded_by_name, submission_title,
  artist_name, awarded_at, award_day). **32 of 41 winners are already consented → playable in-game today.**
- **Albums:** `merch_albums` (21: id, title, cover_url, artist via user_id) + `merch_album_tracks`
  (album_id, submission_id, track_id, position, title, audio_url). **8 albums have playable tracks; 73
  album tracks are consented/playable.**
- **Release parties:** `public_release_parties` (clean public view: album_id, album_title,
  artist_display_name, cover_url, confirmed_week_start(date), total_weeks, status, live_started_at/ended_at)
  + `release_party_tracks` + `release_party_rsvps`. **1 party is live THIS week; 5 total.** A party is
  "current" when `CURRENT_DATE ∈ [confirmed_week_start, confirmed_week_start + total_weeks*7)`.

## The one hard constraint (the "do it correctly" part)
A winner/album track is only **playable** if it's in `rr_consented_tracks` AND has a decodable, non-HLS
`audio_url` (the in-browser charter's `isLaunchable`). So the shelves must show the CONSENTED ∩ DECODABLE
subset as playable, and treat the rest as "not yet available in the game." This is also a **platform
growth loop**: an artist seeing "your album is featured but only 3/8 tracks are playable" is a nudge to
consent the rest for the game.

## Backend ask (Lovable) — minimal, mostly joins on existing data
1. **Enrich `game-catalog /tracks` with a Golden Buzzer flag** (the game already reads it —
   `catalog.js goldenBuzzer()` checks `golden_buzzer`/`is_golden_buzzer`; today it's dark because the API
   doesn't return it). Add `golden_buzzer: boolean` (true when the track's `submission_id` has a row in
   `golden_buzzer_awards`), plus optional `gb_awarded_by_name`, `gb_awarded_at` for the badge tooltip.
   One LEFT JOIN on the existing query. This lights up the ring/crown/tag treatment already in `jukebox.js`.
2. **New endpoint `GET /release-parties`** → the CURRENT/recent parties for the game shelf. For each:
   `{ id, album_id, album_title, artist_display_name, cover_url, live, live_until (iso), status,
   playable_track_ids: [<catalog track ids that are consented+decodable, in album order>],
   total_track_count }`. `live` = now in the confirmed window. Only include parties with ≥1 playable track
   (or return `total_track_count` so the game can show "3 of 8 playable"). The game already has the track
   objects loaded — it just needs the id list + album metadata to build the shelf and the tracklist.
   (Alternative if a new route is heavy: enrich each track with `album_id`/`album_title`/`album_cover_url`/
   `album_position`/`release_live` and let the game group client-side — but the per-party metadata + live
   window is cleaner as its own small endpoint.)
3. CORS: expose these fields/route to anon read (same as the rest of `game-catalog`).

## Game-side plan (catalog.js + jukebox.js + index.html + CSS)
- **catalog.js:** `goldenBuzzerTracks()` = `musicTracks().filter(goldenBuzzer)`; `releaseParties()` =
  fetch/cache `/release-parties`, map `playable_track_ids` → loaded catalog track objects; `albumTracks(partyId)`.
- **jukebox.js Browse (`renderBrowse`)** — mirror the AI Flixs `.flixs-hero-card` pattern:
  - **Golden Buzzer Winners** — a full-width GOLD hero card at the TOP of Browse (crown/♔ motif), count =
    `goldenBuzzerTracks().length`, opens `openSongs(goldenBuzzerTracks(), 'Golden Buzzer Winners', 'browse')`.
    Also add a **coverflow rail** "Golden Buzzer" alongside Featured/Hot/New/Surprise. The per-track ring/
    crown/tag already renders.
  - **Album Releases** — a shelf of cards, one per current/recent release party: album `cover_url` as art,
    `album_title` + `artist_display_name`, a **"LIVE THIS WEEK" pulse** for parties in-window, "N of M
    playable" if partial. Click → `openSongs(albumTracks(id), album_title, 'browse')` with the album cover
    as the list header art.
- **Brand:** Golden Buzzer = gold/crown (fits the existing GB treatment); album cards use the album's own
  cover art inside a warm frame. No purple/blue/green.

## Platform loop (phase 2 — the "smart integration")
- Playing a Golden Buzzer winner → a small Bonus-Sparks nod ("you played a Golden Buzzer winner") + the
  existing `POST /plays` already credits the creator's view/click counts (exposure for the artist).
- Release party LIVE this week → an "RSVP / attend" deep-link back to the site (domain-split:
  reactivvibe.com), tying game discovery to `release_party_rsvps`; "attended N release parties" badge;
  playing the album during its release week = the game participating in the launch moment.
- Non-consented winner/album tracks → a soft "not yet playable — consent it for the game" state (drives consent).

## Phasing
- **P0 (game scaffold, ships now):** build both Browse shelves + the GB rail reading the existing helpers;
  they render empty/hidden until the API returns the flag/route (graceful, like the GB badge is today).
- **P1 (backend + light-up):** Lovable adds the GB join + `/release-parties`; 32 winners + 8 albums appear.
- **P2 (platform loop):** bonus sparks, RSVP deep-links, consent nudges, badges.

## Open confirmations for Lovable
- Confirm the game track `.id` returned by `game-catalog` (is it `rr_consented_tracks.id` or `submission_id`?)
  so `playable_track_ids` uses the SAME id the game keys on.
- Confirm which release-party statuses count as "current/showable" (`status` values + the live window).
- Golden Buzzer: 1 award per submission or can a submission win multiple times (dedupe by submission_id).
