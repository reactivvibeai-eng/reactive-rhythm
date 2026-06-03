# Catalog at scale — backend change (for the Lovable agent)

The game now plays real tracks, but the `game-catalog/tracks` endpoint only returns the ~100
tracks in the `game_dev_opt_ins` gate. Per our ToS, **uploading already opts a track in**, so
we want the **whole library** playable + searchable. Paste the block below to the agent.

---

```
Our rhythm game pulls from GET /functions/v1/game-catalog/tracks. Right now it only returns
tracks present in game_dev_opt_ins (~100). Per our Terms of Service, uploading already grants
the rights we need, so EVERY uploaded track should be eligible. Make these changes:

1) REMOVE the game_dev_opt_ins gate. Return ALL tracks from radio_tracks that have playable
   audio (a Mux playback id OR a storage audio file). Drop the opt-in join entirely.

2) Exclude only truly unplayable rows: a track must have audio (stream_url or audio_url
   resolvable). No dead entries.

3) Keep the existing pagination and response shape (the game already consumes it):
   limit & offset query params; each row:
   { id, title, artist_name, artist_credit_name, genre, bpm, duration_seconds, artwork_url,
     created_at (ISO ok), play_count, featured, chart_status, has_chart,
     stream_url (Mux HLS .m3u8 or direct file), audio_url (CORS-readable mp3/m4a/wav) }

4) SCALE — add server-side search + sort so we don't have to download the whole library to
   search it (important once this is thousands of tracks):
     GET /game-catalog/tracks?q=<text>&sort=<new|hot|az>&limit=&offset=
   - q: case-insensitive match on title OR artist_name (ilike '%q%').
   - sort: new = created_at desc (newest uploads first), hot = play_count desc, az = title.
   - Default (no q, no sort): newest first is fine.
   Keep limit/offset working alongside q/sort.

5) (Optional, nice-to-have) so a signed-in artist can find THEIR uploads: either include an
   owner user_id per row, or add GET /game-catalog/my-tracks (auth'd) returning that user's
   tracks. Lets the game show a "Your Tracks" shelf.

Auth stays the same (anon read is fine; user JWT optional). Confirm the endpoint returns the
full count and that ?q= / ?sort= work.
```

---

## What the game already does (so you know it'll "just work")
- It **pages the whole library** (now up to ~12k) and shows everything with audio.
- **Search** (title/artist/genre) + **sort** (New / Hot / A–Z) already run client-side over
  what's loaded; the moment the gate is lifted, players can search the whole catalog.
- A **"New" rail** sorts by `created_at`, so a **just-uploaded track surfaces at the top**
  automatically (the game re-fetches the catalog on demand / on open).
- Every track is playable instantly via in-browser charting — no per-track pipeline needed.

## When the library gets big (tens of thousands)
Once `?q=`/`?sort=` exist server-side, I'll switch the search box to query the server (so we
fetch only matches, not the whole library) — tell me when those params are live and I'll wire
it. Until then the client-side search over the loaded set is fine for low thousands.
