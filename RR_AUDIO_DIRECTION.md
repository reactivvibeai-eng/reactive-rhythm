# RR_AUDIO_DIRECTION.md — Reactive Rhythm audio direction (v1)

> Creative direction: Fable 5. Production brief — every prompt below is paste-ready.
> Brand sound DNA: **black · crimson · chrome** = warm, molten, high-voltage. Saturated analog
> heat, electric guitar + gritty synth, hard transients, stadium confidence. NEVER icy, glassy,
> pastel, new-age, or bell-choir (the sonic "purple"). All original — no copyrighted melodies,
> lyrics, or artist names in prompts.

---

## 1) Signature demo track — "Crimson Circuit" (SUNO)

**Rationale.** The first thing anyone hears must *instantly* read as "rhythm game": a relentless
transient grid the onset charter locks onto, with the lead line deliberately trading LOW chug
sections against HIGH hook sections — our musical charter maps spectral centroid → lanes, so this
register ping-pong literally makes the auto-chart travel the neck. Hybrid rock (guitar-forward but
synth-laced) is the one flavor that sits next to a metal track AND a pop track without clashing.

**Title:** `Crimson Circuit` (alternates: `Overdrive Heart`, `Molten Chrome`)

**(a) Suno Style/genre prompt — PRIMARY (paste into the Style box):**

```
High-voltage hybrid rock anthem, 128 BPM, E minor. Tight palm-muted electric guitar chugs locked to a punchy four-on-the-floor kick, cracking snare on 2 and 4, driving eighth-note analog synth bass. Verses ride low chugging riffs; choruses jump to a soaring high lead-guitar hook trading licks with gritty synth stabs. Stadium tom fills and short risers launch each section; one half-length breakdown builds into a double-time final chorus. Modern hybrid-rock production: hard transients, tight controlled low end, dry punchy drums, minimal reverb, wide rhythm guitars, no ambient wash. Confident, molten, triumphant arena energy. Mostly instrumental with sparse gang-vocal "hey!" shouts. Starts hot within two seconds, no long intro.
```

**Alternate style line (backup flavor — more electronic):**

```
Aggressive big-beat electro-rock, 140 BPM, E minor: distorted breakbeat drums, fuzz bass-guitar riff, screaming analog synth lead answering low guitar chugs, stutter edits, crowd-hype arena energy, hard dry transients, punchy mastering, instrumental with gang-vocal shouts, hot start, no ambient intro.
```

**(c) Structure / lyrics.** RECOMMEND: **instrumental-forward with gang-vocal shouts only.** The
demo loops on the start screen — full lyrics grate on repeat, and sparse shouts give the charter
clean accent onsets instead of smearing the mids. If Suno under-delivers energy without a vocal
anchor, run this minimal chant version (Lyrics box):

```
[Intro — riff]
[Verse — low palm-muted riff, instrumental]
[Pre-Chorus — riser, drum build]
[Chorus — gang vocals]
Red line! Overdrive!
Chrome and fire — come alive!
[Verse 2 — low riff, instrumental]
[Pre-Chorus — bigger riser]
[Chorus — gang vocals]
[Breakdown — half energy, building]
[Final Chorus — double-time, gang vocals]
[Outro — riff, clean ending]
```

**OWNER PICK:** instrumental+shouts (my rec) vs the full chant-chorus version — generate both,
keep whichever loops better on the start screen.

**Charter-friendliness checklist (reject a take that violates these):** steady tempo throughout,
no long reverb washes, no >4s ambient lulls (gap-fill will paper over it but the demo should not
need it), drums audible in every section, hot start ≤2s.

---

## 2) Hero-moment SFX (ELEVENLABS sound effects)

**Rationale.** These are clean isolated transients — ElevenLabs territory, not Suno. All three
share one timbre family (hot metal + electricity + warm brass-metal resonance) so they read as one
game. No sub-bass in the short cues — they must cut over full-level music (we never duck). Generate
4 takes each, pick, trim silence, peak-normalize to −1 dBFS; set in-engine gain like the existing
`hit-chug`/`miss-squelch` buffers.

### 2a. Overdrive activation — the "STAR POWER engaged" moment
- **Prompt:** `Molten electric guitar feedback swell rising fast into a metallic jet whoosh, slamming into a deep resonant power-chord impact with a crackling electricity tail.`
- **Duration:** 1.6 s. **Trigger:** Space pressed with Overdrive ready (the meter dump).
- Shape: rise → SLAM → sizzle tail. The slam lands ON the press, so ask for the impact ~1.1 s in, or trim the take so it does.

### 2b. Flow-Shield "SAVED" — THE critical one: must read as a WIN, never a fail
- **Prompt:** `Quick ascending electric shimmer whoosh that snaps into a single warm bright metallic chime catch, upward and triumphant, like snatching a coin out of the air.`
- **Duration:** 0.65 s. **Trigger:** Overdrive eats a missed note (mercy save).
- **Non-negotiables:** entire pitch gesture moves UP (down = punishment); fast attack, bright 2–6 kHz energy so it cuts without ducking; ends on a warm *resolved* single hit — no minor color, no thud, no low rumble, nothing shared with `miss-squelch`. If a take sounds even slightly like an error tone, kill it. This cue is pure dopamine: "the game caught you."

### 2c. Star-power / milestone cue — combo milestone arrival
- **Prompt:** `Hot metallic power chime burst with a fast harmonic bloom and a short electric spark sizzle tail, bright, punchy, celebratory.`
- **Duration:** 0.5 s. **Trigger:** combo milestones (%25 lightning) / combo-tier-ups.
- Keep it smaller than 2a/2b in perceived size — it fires often; it's a spark, not a slam.

---

## 3) Level-clear fanfare (RECOMMEND: ELEVENLABS)

**Rationale.** The results screen already has its own drama (animated score count-up, star rating,
GRADE UP badge) — it needs a 3-second musical *arrival*, then silence for the count-up to own.
ElevenLabs wins here: an isolated, no-edit, exact-length sting; Suno's minimum lengths would force
downloading a 30s+ piece and hand-trimming a loopable bed we don't need yet. Resolve to MAJOR — the
game lives in E minor, so a major-chord win physically reads as triumph.

- **Prompt:** `Triumphant arena rock victory sting: three quick rising distorted power chords ending on one huge sustained major chord slam with a crash cymbal and a warm crowd roar swelling underneath, stadium-sized, molten and celebratory.`
- **Duration:** 3.0 s. **Trigger:** results screen entrance on a cleared run (not on fail-out).
- **OWNER PICK:** with vs without the crowd roar — generate one take of each; roar sells the arena
  fantasy but the dry version may sit better if crowd ambience ever ships elsewhere.
- (If a full "encore bed" is ever wanted under the whole results screen, that becomes a Suno ask —
  separate asset, later.)

---

## 4) Menu / hub music bed (SUNO)

**Rationale.** The hub bed's whole job is to make silence feel intentional and *not compete*: no
melody, no chord changes (a static E drone can't clash with a preview in any key), energy parked
low. It lives at the spectrum's edges — sub pulse below, air and faint metal ticks above — leaving
the mids empty for coverflow previews. Warm and molten, never icy: an idling amplifier before the
show.

**Suno Style prompt:**

```
Dark warm ambient underscore, 84 BPM, static drone rooted on low E, no chord changes. Slow-breathing saturated analog pad, deep soft sub pulse on each downbeat, distant clean electric-guitar harmonics with long decay, faint warm tape crackle, sparse metallic tick percussion far back in the mix. Hypnotic, minimal, patient — no melody, no builds, no drops, no vocals. Warm molten analog tone, never icy or glassy. Feels like a huge amplifier idling in a dark arena before the show. Instrumental.
```

**Loop/structure note:** ask Suno for 2–3 min; because there are no chord changes or builds, almost
any 60–90 s span loops — cut at two matching low-energy points and crossfade 1–2 s (or just pick a
span where frame A ≈ frame B). Ship it mixed LOW in-engine (~20–25% of music volume) and pause/duck
it the moment a track preview or a run starts.

---

## Save-as manifest (`assets/`, lowercase-hyphen, matching `hit-chug.mp3` / `miss-squelch.mp3`)

| Asset | Tool | Save as |
|---|---|---|
| Signature demo anthem ("Crimson Circuit") | Suno | `assets/crimson-circuit.mp3` |
| Overdrive activation sting | ElevenLabs SFX | `assets/overdrive-ignite.mp3` |
| Flow-Shield "SAVED" catch | ElevenLabs SFX | `assets/shield-save.mp3` |
| Combo-milestone chime | ElevenLabs SFX | `assets/combo-flare.mp3` |
| Level-clear fanfare | ElevenLabs SFX | `assets/clear-fanfare.mp3` |
| Menu / hub bed | Suno | `assets/hub-embers.mp3` |

*(Six files across the four deliverables; deliverable 2 is three stingers.)*

**Integration footnote (for the engine agent, later — no code touched now):** anthem replaces
`lunar-waves.mp3` as the demo source; the three stingers + fanfare decode once alongside the
existing SFX buffers in `loadHitSfx()`-style preload; hub bed is a new low-gain loop on the
jukebox/lobby screens only.
