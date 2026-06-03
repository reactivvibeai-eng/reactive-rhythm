# Reactive Rhythm — Production Roadmap v2
### A benchmark-setting audio game for the ReactivVibe platform

> This is a production plan, not a feature list. Every item has a **quality bar** it
> must clear before it's "done." The goal is not "it works" — it's "it feels like a
> game a studio shipped."

Status: ✅ done · 🟡 partial / needs rework · ⬜ not started

---

## 0. The Vision & Benchmark

**What we're competing with** (and what they do that we don't yet):
- **Beat Saber / Guitar Hero** — every hit has weight: sound, light, haptics, screen reaction. Input feels *physical*.
- **DJMAX / Cytus II** — gorgeous, identity-rich UI; song select is an *experience*, not a list.
- **Muse Dash / ADOFAI** — character, theme, and music are one; the world reacts to the song.
- **Thumper** — "rhythm violence": menace, speed, and escalating intensity.

**Our edge:** real artists' music from a living catalog + an anime/blood-moon horror identity nobody else has. We win by making *the music the world* and the hits feel *brutal and satisfying*.

**The bar we're holding every screen to:**
1. **Motion** — nothing appears/disappears instantly; everything eases, springs, or fades with intent.
2. **Feedback** — every input produces sound + light + motion within 1 frame.
3. **Hierarchy** — one clear focal point per screen; type scale and spacing are deliberate.
4. **Depth** — layered parallax, light, shadow; never flat.
5. **Brand** — crimson/black/chrome + blood-moon + anime menace, consistently, everywhere.
6. **Performance** — 60fps on a mid phone; no jank.

---

## 1. CRITIQUE — what's not meeting the bar today (your notes, owned)
- 🟡 **Song browsing looks weak** → needs a full redesign (see Pillar A). Currently reads like a dev placeholder, not DJMAX-grade song select.
- 🟡 **Gameplay too simple vs market** → needs note-type variety + mechanics depth (Pillar C).
- 🟡 **Background feels weak for the brand** → the world must be richer, reactive, layered (Pillar D).
- ⬜ **No level system / level picker** → core structure missing (Pillar B).
- ⬜ **No settings** (controller hookup, resolution, gameplay, custom keys) (Pillar E).
- 🟡 **UI lacks pro taste/polish** → apply the quality bar above to every screen (cross-cutting).
- 🟡 **Desktop layout** unfinished.

---

## PILLAR A — Song Select, redesigned (DJMAX-grade)
Make choosing a song an *experience*.
- ⬜ Rebuild the browser as a **cohesive "deck"**: large reactive now-focused art, animated metadata, the moon/world reacting behind it
- ⬜ **Art direction pass** — real type hierarchy, motion on every transition, depth & lighting
- ⬜ **Preview that sells it** — focused song previews with a visualizer reacting to the audio
- ⬜ **Smooth, momentum-based** navigation (touch + wheel + arrows + keyboard) that feels weighted
- ⬜ **Filters with taste** — genre/mood/BPM/difficulty as designed controls, not dropdowns
- ⬜ Per-song **mastery surfaced** (your grade, rank, % cleared)

## PILLAR B — Level / progression system
The structure you called out.
- ⬜ **Level select screen** — a designed map/grid of levels (Level 1, 2, …), each a curated song + difficulty + goal
- ⬜ **Per-level definition** — a level = song + difficulty + modifiers + clear conditions + reward
- ⬜ **Unlock flow** — clear Level 1 → unlock 2, with a satisfying unlock moment
- ⬜ **"Ready to deploy" per level** — each level ships independently; a content pipeline so new levels = data, not code
- ⬜ **Star/grade goals per level** (e.g. clear / full-combo / S-rank) driving replay

## PILLAR C — Gameplay depth (beat the "too simple")
What makes hits feel great and charts feel rich — *all within the server scoring ceiling*.
- ⬜ **Note-type variety** — taps, **hold/sustain** notes, **double/chord** hits, **slides**, rare **surge** notes (visual + input depth)
- ⬜ **Hit feel overhaul** — distinct Perfect vs Great vs Good feedback (sound, light, particle, shake); a *crunch* on perfect
- ⬜ **Lane/string physicality** — strings that bend, snap, and ring; receptors that slam
- ⬜ **Escalation** — intensity ramps with combo & song sections (calmer verse → brutal chorus)
- ⬜ **Modifiers** — speed, hidden, mirror, no-fail (practice) — depth for skilled players
- ⬜ **Fail/health state** (optional mode) — tension without punishing casual players
- ⬜ **Audio-reactive everything** — the chart and world breathe with the actual waveform

## PILLAR D — The world / background (brand-grade)
The backdrop must feel like a place, not a texture.
- ⬜ **Layered reactive environment** — blood moon + parallax clouds + embers + distant skyline, all reacting to the music
- ⬜ **Section-aware staging** — the world shifts with song sections (drop = the moon erupts)
- ⬜ **Lighting & atmosphere** — volumetric crimson light, fog, depth haze, lens bloom
- ⬜ **The mascot in-world** — a presence during play (reacts to your combo/fails)
- ⬜ **Decide:** richer canvas/WebGL layer vs commissioned art frames (quality vs effort call)

## PILLAR E — Settings & input (pro control)
- ⬜ **Settings menu** — proper screen, organized sections
- ⬜ **Controller/MIDI setup** — detect devices, show status, **remap** buttons/notes → lanes, test input
- ⬜ **Custom keybinds** — rebind keyboard lanes
- ⬜ **Resolution / quality** — performance modes (effects high/low), reduce-motion, FPS cap
- ⬜ **Gameplay mechanics** — scroll speed, audio/visual offset calibration, lane count, hit-window feel
- ⬜ **Audio** — music/SFX volume, mute, latency calibration wizard

## PILLAR F — Identity, retention & platform fit
- ⬜ **Player profile** — name, avatar, stats, mastery (Supabase auth/profiles)
- ⬜ **Leaderboards** — global + friends, per-track + per-pack + per-level
- ⬜ **Progression** — XP, unlockable note skins / lane themes / titles
- ⬜ **Artist spotlight + deep-links** from ReactivVibe song pages
- ⬜ **Share cards / challenges** — score cards, "beat me" links

## PILLAR G — Deploy & ops (already scaffolded)
- ✅ `public/play/` build + same-origin `/play` + hosted moon video
- ⬜ **GitHub auto-deploy** connected (then we iterate freely; no manual updates)
- ⬜ **Cursor pagination** when catalog nears 1000
- ⬜ **Analytics** — funnel (browse → play → finish), per-pack play tracking (revenue already wired)

---

## Suggested production order
1. **Quality-bar polish pass** on what exists (song select redesign A + hit-feel C + world D) — make the *core loop* benchmark-quality before adding breadth.
2. **Level system (B)** + **Settings (E)** — the structural gaps you named.
3. **Identity & retention (F)** — turn it into a game people return to.
4. **Deploy (G)** when the core feels finished — soft test, then launch.

## Decisions that steer everything (let's lock these)
1. **Level-based** (curated Level 1→N campaign) **or catalog-based** (pick any song) — or both (campaign + free play)?
2. **Difficulty/health:** casual-friendly (no-fail) or skill-gated (can fail)? Both via modes?
3. **World tech:** push the canvas renderer further, or invest in a **WebGL/3D** layer for the benchmark look?
4. **First milestone:** a single *perfect* level (vertical slice) to set the bar — then scale? (Strongly recommend yes.)
