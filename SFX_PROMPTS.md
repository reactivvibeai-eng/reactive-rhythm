# Custom SFX — Suno prompts (owner makes these; drop into assets/)

Owner offered to generate SFX in Suno. Here are exact prompts for the sounds worth upgrading, ranked by
impact. Each: the in-game moment, the Suno prompt, the target filename, length, and delivery notes. Keep
them **dry (no reverb tail), mono, punchy, short** — game SFX must be tight and instant. Brand = heavy,
dark, metal energy (black · crimson · chrome · gold). Trim silence at the head so they fire on the frame.

Delivery: 44.1kHz, MP3 (or WAV → I'll transcode), normalized to ~-3 dB peak. Drop each into `assets/` with
the exact filename below and I'll wire it (some auto-wire by filename).

---

## 1. ⚡ DAMAGE ZAP — the MP combat lightning (TOP PRIORITY)
**When:** in a versus match with combat ON, you cross a combo threshold and a lightning bolt streaks across
to the opponent, staggering them. This is the money moment now that combat actually fires — it needs to feel
like you just hit them with a weapon.
**Suno prompt:** *"A short aggressive electric lightning strike sound effect — a high-voltage zap with a
crackling arc, a sharp snapping transient on the front, and a fast crunchy low-thunder tail. Metallic,
punchy, menacing, heavy-metal energy. Very short, dry, no reverb, no music. About half a second."*
**File:** `assets/damage-zap.mp3` · ~0.4–0.6s · give me **2 variants** (a "you dealt it" brighter zap + a
"you got hit" darker/heavier thud) if easy — else one is fine.

## 2. ★ PERFECT cue — the precision reward
**When:** a perfectly-timed hit. Right now it's a soft synthesized tone (I just toned down a piercing one).
A real crisp accent would make nailing the timing *feel* elite. Sits ON TOP of the palm-mute chug, so it
must be bright but not harsh.
**Suno prompt:** *"A crisp bright satisfying 'perfect hit' accent — a clean bell-like or glass ping transient
with a fast decay and a subtle warm gold shimmer, rewarding and precise, not piercing or shrill. Very short,
dry, no reverb, no music. About a sixth of a second."*
**File:** `assets/perfect-cue.mp3` · ~0.12–0.18s · one is fine.

## 3. HIT CHUG — the core note-hit (per-lane, the sound you hear most)
**When:** every successful note. Today = `hit-chug.mp3`, pitched per lane. If you want to beef it up: a
tighter, punchier palm-mute.
**Suno prompt:** *"A tight palm-muted electric guitar chug — one single low percussive downstroke, dry and
punchy with a fast mute, aggressive metal tone, no ring-out. Very short, dry, no reverb, no music."*
**File:** `assets/hit-chug.mp3` (replaces existing) · ~0.15–0.22s · if you can give **5 pitches** (a low-to-high
climb, one per lane) that's ideal — else one and I pitch-shift it in-engine like today.

## 4. MISS / WHIFF — the drop
**When:** a missed note or a bomb hit. Today = `miss-squelch.mp3`. A deader, more disappointing whiff sells
the loss.
**Suno prompt:** *"A dead muted electric-guitar whiff — a short downward pitch-bent 'thunk' with fret buzz
and a choked string scrape, flat and disappointing, dry. Very short, no reverb, no music."*
**File:** `assets/miss-squelch.mp3` (replaces existing) · ~0.25–0.35s.

## 5. (Optional) OVERDRIVE ACTIVATE — the power surge
**When:** you pop Overdrive/Star Power (Space). A rising riser/whoosh into a hit would make it theatrical.
**Suno prompt:** *"A rising power-surge riser into a hard hit — a fast electric whoosh building in pitch and
intensity, then a crunchy metal slam at the peak. Dramatic, heavy, ~1 second, dry, no reverb, no music."*
**File:** `assets/overdrive-activate.mp3` · ~0.8–1.2s.

---

**Priority order:** #1 (damage zap) → #2 (PERFECT) → #4 (miss) → #3 (hit chug) → #5 (overdrive). Even just
the damage zap is a big win for the combat feel. Send me whatever you make and I'll wire + level-match them.
