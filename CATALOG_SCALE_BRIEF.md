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

---

## STATUS UPDATE — 2026-06-19 (the gate is lifted; one small gap remains)

**Good news:** the opt-in gate above is **DONE.** A live query of `game-catalog/tracks` now returns
**1127 tracks**, and the game already loads **1111** of them (it pages the whole library and shows
everything with decodable audio). If a player's GAME still shows only ~600, that's a **stale/older
deployed build** — the current code (`catalog.js` `loadCatalog`, paging 200×up-to-60) pulls all
1127. Action: just make sure the deployed `/play` build is current; no backend change needed for that.

### The ONE remaining gap: 16 HLS-only tracks are hidden
Of the 1127, **16 tracks are filtered out** because their ONLY audio is a **Mux HLS `.m3u8`**
stream. The game charts notes by **decoding the audio in-browser** (Web Audio `decodeAudioData`),
and **HLS `.m3u8` is a manifest of segments — it can't be `decodeAudioData`'d**, so those tracks
can't be charted client-side. Example row (hidden): title "Back to the Deep You Go" — both
`audio_url` and `stream_url` point at `https://stream.mux.com/<id>` (HLS), no progressive file.

(The game's `trackReady()` accepts any of `audio_url / wav_url / analysis_url / stream_url` **as long
as it is NOT a `.m3u8`** — so the moment any ONE of those is a direct file, the track lights up.)

**Pick EITHER fix (only for the affected tracks):**

1. **Expose a progressive/direct audio URL** (preferred, zero game-side work). Mux can emit a static
   rendition — e.g. `https://stream.mux.com/<PLAYBACK_ID>/audio.m4a` (Mux "static renditions" /
   `audio.m4a` or a low-res `.mp4`), OR surface the original uploaded file from storage. Put that
   **CORS-readable** URL in `audio_url` for those rows. The file must send `Access-Control-Allow-Origin`
   (the game fetches it with `mode:'cors'` to decode it). That's it — the 16 tracks become playable.

2. **Pre-bake a server chart** for them (`chart_status:'ready'` + the chart payload the game's
   `liveProvider` already consumes). Then the game plays them via the server chart and never needs to
   decode the audio. More work, but it ALSO makes them leaderboard-safe (competitive), which the
   in-browser path is not.

Either way it's only ~16 rows today; option 1 is the quick win. Tell me when an affected row has a
decodable `audio_url` and I'll confirm it appears + plays.
