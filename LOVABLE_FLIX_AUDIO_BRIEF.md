# LOVABLE BRIEF — AI Flix audio renditions (27 films can't become playable levels)

**Priority: HIGH.** Owner hit this live on stage 2026-07-19: tapped an AI Flix expecting a playable level,
got a video preview. Game-side UX is fixed (build188 marks watch-only films honestly), but the REAL fix is
here: these 27 films need decodable audio so they can be charted as playable levels like the other 143.

## The problem, precisely
A film becomes a PLAYABLE LEVEL when the browser can fetch + `decodeAudioData` its audio (video plays
full-screen behind the note highway, chart generated from the soundtrack).

- **143 of 170 films work.** Their `audio_url` is a real file — almost all
  `https://stream.mux.com/<PLAYBACK_ID>/audio.m4a` (Mux static/audio rendition). Verified 206 OK.
- **27 films fail.** Their `audio_url` is the *video* HLS playlist (`https://stream.mux.com/<ID>.m3u8`).
  Browsers cannot `decodeAudioData` an HLS manifest, so these can only be watched, never played.
- **I probed `https://stream.mux.com/<PLAYBACK_ID>/audio.m4a` for all 27 → 404 on every one**
  (control film returns 206). So the Mux assets themselves were ingested WITHOUT static/audio renditions.
  This cannot be fixed client-side.

## The ask
1. For each Mux asset below, enable a downloadable audio rendition — i.e. set `mp4_support`
   (`"standard"` or `"capped-1080p"`) on the asset, or run whatever job produced `/audio.m4a` for the
   other 135 films (there's a `mux_audio_backfill_log` table — this looks like a re-run of that job on the
   stragglers). Mux may require re-processing assets created before static renditions were enabled.
2. When the rendition exists, update the track row's `audio_url` to the decodable file
   (`https://stream.mux.com/<PLAYBACK_ID>/audio.m4a`), leaving `video_url`/`stream_url` as the `.m3u8`.
3. **No game deploy needed after that.** The game re-checks per film at render time: the moment `audio_url`
   stops being an `.m3u8`, that card auto-upgrades from "CINEMA / watch-only" to a playable "★ AI FILM"
   and moves above the divider. No flag list, no code change.

## Also please (ingest gate, prevents recurrence)
Make a decodable audio rendition part of the video ingest contract, so no future film can enter the
catalog watch-only. This is the third time an ingest gap has surfaced as a game-side "bug".

## The 27 films
| # | Artist | Title | track id |
|---|--------|-------|----------|
| 1 | After Eve | Under The Weather MV | `1db23620-2d25-4c9f-932e-c1a730aec042` |
| 2 | After Eve | Out Of Tune MV | `a2f0af55-44fd-4d69-a6ae-8e193f1a5329` |
| 3 | After Eve | Down The Rabbit Hole MV | `eec97377-2967-4722-988e-dd63c60f18a3` |
| 4 | Aiden Collins | Stew | `60cb9061-5db8-40ec-b04c-65e741dba89e` |
| 5 | Aiden Collins | Thrupple | `1adc7dab-7909-43cb-a08e-89d29d052e7d` |
| 6 | Alarm Clock Hero | Preheat the Void 🍪🕯️ \| Cookies for the Hungry Beyond (Motion Comic) | `d7ee36c4-d1f0-4efd-9348-25f38290871e` |
| 7 | Alarm Clock Hero | Two Bigger Buns — Music Video (The Rising Crumb Bakery) | `e4876788-8d13-4539-b522-c82d40c1778f` |
| 8 | Alarm Clock Hero | Cookies for the Hungry Beyond | `b98378c7-5065-4281-b2ab-33e079ebb3d8` |
| 9 | Alarm Clock Hero | Twilight's Ember - Chapter 1: Filed at Sunrise (Narrated Motion Comic) | `eb0688db-eee1-4540-aa02-251d4fc6deb8` |
| 10 | Bone Daddy | Shots with My Demons | `6c717292-2265-41f8-ba6f-d1f9bce3b62c` |
| 11 | CelinesRazor | OBIAM (OFFICIAL MUSIC VIDEO) | `df64e62e-4ea9-4e0c-b0f2-1437c143ac12` |
| 12 | EpicSessionTracks | "Wild, Wicked and Free!" -  By The Velvet Vixens | `5ca8d35f-7159-4cca-982e-bd4232201226` |
| 13 | Mind Over Images | Part of It | `4b603e04-7717-4014-b154-7e8836ed4aec` |
| 14 | Mind Over Images | Fucking Metal Man | `a896dcf1-d8f8-49f9-9320-5544c055de3a` |
| 15 | Mind Over Images | Fungi Business (Ft. SkullyRae) | `33501040-4012-45af-bac4-46d1d01c9535` |
| 16 | Mind Over Images | Happy 4th | `164e2b9d-8b7d-4f09-9f25-eca1f2f65e1b` |
| 17 | Mind Over Images | Under the Skin | `be3d3b25-3a01-49fb-9a58-ecd5de94895e` |
| 18 | Mind Over Images | Brittle | `2c7c66e1-5118-46da-990d-58ec88186c89` |
| 19 | Nora Echo | If You Were Here - Music Video | `d42d254e-7cd3-4d7d-8919-10f75141c831` |
| 20 | Nora Echo | If I Were Real - Music Video | `7f16a305-d104-4929-816b-b87fc0bd3845` |
| 21 | Samur.Ai | The Dark Raven Quest | `c03a7f7e-902c-48c5-9a48-80ca231cdb39` |
| 22 | Sofia's Soul | Mushroom Troop collab with TriEmrys | `f8e24200-0a65-48bd-8976-9d87c3c2ac54` |
| 23 | Sofia's Soul | Mourning Tide | `8f0686b8-29cd-48f4-8309-ef4eb2f0b37c` |
| 24 | Sofia's Soul | Sleeping Storm | `da4fe6b7-d117-4eaa-890a-881007802e27` |
| 25 | Sofia's Soul | Shattered Will | `115b3bf8-6492-4a88-8f43-7be79e6f67d1` |
| 26 | Sofia's Soul | The Instagators | `a37ca82b-4828-4de9-a716-6e5c0ca24ccc` |
| 27 | Sofia's Soul | Moon Hollow | `e2b1b7ab-11d1-4318-8983-527ccc69ae5d` |

_All 27 verified against the live `game-catalog` API on 2026-07-19; each one's `audio_url`, `stream_url`
and `video_url` are the SAME `.m3u8`, and each one's `/audio.m4a` probe returned 404._
