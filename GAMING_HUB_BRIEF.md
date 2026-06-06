# GAMING_HUB_BRIEF.md — "Gaming" nav tab + Games Hub page (hand to the Lovable agent)

## Goal
Add a **Gaming** section to the site: a new top-nav tab + a marketing-grade hub page at
**`/gaming`** that showcases playable games built on the ReactivVibe catalog. Game #1 is
**Reactive Rhythm**, already deployed as a self-contained static app at **`/games/reactive-rhythm/`**.
Design the hub to **scale** — it should list multiple games as they launch, not hardcode one.

## Stack / brand (match the existing app — don't invent a new look)
Vite + React + react-router-dom + shadcn-ui + Tailwind + framer-motion (all already in the repo).
Brand: dark theme, **primary = crimson** (`text-primary`, `gradient-red` / `gradient-red-hover`),
`glass-card` surfaces, lucide-react icons, the `Layout` wrapper (Navbar + Footer), and `SEO`/Helmet
for meta. Reuse `GlassCard`, existing button styles, and the visual language of `Index` / `AIflix`.

## 1) Nav tab — `src/components/Navbar.tsx`
Add one entry to the `navLinks` array (it renders in both desktop + mobile menus automatically):
```ts
{ to: "/gaming", label: "Gaming" }
```
Suggested placement: alongside the content verticals (e.g. right after `AIflix` or `AI Radio`).
Optionally give the mobile row a `Gamepad2` lucide icon, matching the Podcast/Admin icon treatment.

## 2) Route — `src/App.tsx`
```ts
const Gaming = lazy(() => import("./pages/Gaming"));
// ...
<Route path="/gaming" element={<Gaming />} />
```

## 3) The hub page — `src/pages/Gaming.tsx` (wrap in `Layout` + `SEO`)
Sections, top to bottom:

**A. Hero (the cinematic centerpiece)**
- Headline: **"Your music. Now a game you can actually play."**
- Subhead: "Every track on ReactivVibe can become a playable rhythm experience. Pick a song, we
  chart it live, and you perform it on a six-string neon neck."
- Primary CTA: **"Play Reactive Rhythm"** → `/games/reactive-rhythm/` (see ⚠️ link rule below).
  Secondary: "How it works" (smooth-scrolls down).
- Visual: black + crimson, energetic; bold gradient or a looping video backdrop + a guitar/moon
  motif. Subtle framer-motion entrance. This is the page's wow moment — make it premium.

**B. Featured game — Reactive Rhythm (premium GlassCard)**
- Cover image, title **Reactive Rhythm**, a **"Private Beta"** badge.
- Tagline: "Guitar-Hero-style rhythm on a neon guitar neck — charted to your catalog."
- Feature chips: `850+ tracks` · `In-browser charting` · `Combos & Overdrive` · `Career & grades`
  · `Keyboard / touch / MIDI`.
- **"Play Now"** button → `/games/reactive-rhythm/`.

**C. How it works (3 steps)**
1. **Pick any track** — your songs, or the whole ReactivVibe library.
2. **We chart it live** — the game analyzes the music in your browser and builds the note chart on
   the fly (no manual charting).
3. **Perform it** — hit the notes, build combos, trigger Overdrive, climb your career rank.

**D. Why it matters (the big idea)**
Punchy: "For the first time, fans don't just *listen* to your music — they *play* it. Every release
becomes an arcade." Frame it for both artists (a new way fans engage) and fans (play your favorites).

**E. More games coming (scalability showcase)**
A grid of 2–4 **"Coming soon"** teaser cards (locked styling) so it reads as a growing platform, not
a one-game page. Render all cards from a data array (below) so adding a real game later is one entry.

**F. Final CTA**
"Jump in →" Play button → `/games/reactive-rhythm/`. Optional line: "In private beta — enter your
access code to play."

**Scalability — drive cards from a data array:**
```ts
const GAMES = [
  { slug: "reactive-rhythm", title: "Reactive Rhythm", status: "beta",
    href: "/games/reactive-rhythm/", tagline: "...", cover: "/...", features: ["850+ tracks", "..."] },
  { slug: "coming-soon-1", title: "???", status: "soon" },
];
```
`status: "beta" | "live"` → playable card with a Play button; `status: "soon"` → locked teaser.

## ⚠️ CRITICAL — how to link to the game
Reactive Rhythm is a **static app at `/games/reactive-rhythm/`, OUTSIDE the React router.** Link with
a **plain anchor** (full navigation), NEVER react-router `<Link>` (which client-side-routes → SPA 404):
```tsx
<a href="/games/reactive-rhythm/">Play</a>            // ✅ correct
<Link to="/games/reactive-rhythm/">Play</Link>        // ❌ wrong — will 404
```
Same-tab is fine; `target="_blank" rel="noopener"` also fine.

## SEO
Helmet: title "Gaming — Play Your Music | ReactivVibe", a description about playable games from your
catalog, and an OG image. (The hub is indexable; the game itself stays `noindex`.)

## Don't
- Don't rebuild the game — just link to `/games/reactive-rhythm/`.
- Don't touch `public/games/**` (that's the deployed game; managed separately).
- The deeper in-app, auth-gated, leaderboard version (the existing `src/pages/Play.tsx` scaffold) is a
  planned **v2**; the hub does not depend on it.
