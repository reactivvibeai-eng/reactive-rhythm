# Lovable brief — "Commission a Custom Level" ($59.95 UGC purchase)

**For:** the Lovable backend/web agent, to build on the platform (reactivvibeai.com) + link from the game.
**Goal (owner):** let a user pay **$59.95** to commission a bespoke Reactive Rhythm level — they upload up to **10
reference images** + a **description** — with **fully transparent information on exactly what they're purchasing**, and
the submission lands in the **owner's admin controls** so the owner can build the level and reuse the inputs for future
designs.

---

## 1. The flow (web)
A **"Commission a Custom Level"** page/modal on the platform. Sign-in gated (we need to know who to deliver to + notify).
1. **Reference images** — upload **up to 10** (drag/drop, jpg/png/webp, e.g. ≤10 MB each). Show thumbnails; let them
   remove/reorder. These are mood/character/scene references the owner builds from.
2. **Level description** — a structured form (not just a blank box) so the owner gets usable build inputs:
   - Title idea · the **song/artist** it should be charted to (or "surprise me") · mood/genre · the **character(s) or
     theme** (the references support this) · setting/world · any specific moments/"drops" they want · difficulty vibe ·
     anything off-limits. Free-text "extra notes" at the end.
3. **Transparent "what you get"** (see §2) shown clearly BEFORE the Buy button.
4. **Buy — $59.95** via **Stripe Checkout** (one-time). On success → §3 (deliver to admin) + a confirmation to the buyer
   with an ETA and a note that they'll be notified when their level goes live.

## 2. Transparent deliverables — show this on the page so the buyer knows what $59.95 builds
*(Owner: confirm/finalize this list + the cost-breakdown wording you want shown. Draft based on how our levels are made.)*
A commissioned **Custom Level** is a fully-produced, playable Reactive Rhythm level, including:
- A **charted playable level** of your chosen song (notes synced to the music — the core rhythm gameplay).
- A **cinematic level world** built from your references — a themed backdrop / journey (animated video backdrops + scene
  art) so the level has its own look, not a generic stage.
- **Reactive moments** — combo/Overdrive cutaways + hit/miss reactions themed to your level.
- **Branding** — a level cover + title card.
- *(Optional add-ons the owner may offer:)* a matching **custom guitar skin**, multiple difficulty charts, a featured
  slot/spotlight. ← owner decides whether these are included at $59.95 or upsells.
- **Turnaround:** state a realistic ETA (e.g. "delivered within N days; you're notified when it's live").
- **What it is NOT** / fair-use + content rules (no infringing references, etc.) — a short terms line.
> The point (owner): make the **value + the work behind a level obvious** — that transparency is what justifies and
> converts a premium $59.95 purchase. Itemize it; don't hide it behind a single price.

## 3. Deliver to the owner's ADMIN controls (the actual payload)
On a **successful, verified** payment, write a **submission record** to an admin-only queue the owner can see:
`{ submission_id, buyer_user_id, buyer_email, created_at, amount_paid, stripe_payment_id, status: 'paid',
   title_idea, song_or_artist, mood, theme, setting, requested_moments, difficulty, off_limits, extra_notes,
   reference_images: [signed URLs ×≤10] }`
- Surface it in **admin controls** (a "Custom Level Requests" list: newest first, with the images, the description fields,
  payment confirmation, and a status the owner can advance: paid → in-progress → delivered).
- Notify the owner (email/dashboard) on each new paid submission.
- Keep the reference images in private storage with signed URLs (owner-only access).

## 4. Integrity (don't skip)
- **Charge first, deliver-to-admin on the webhook** — gate the admin record on Stripe's **signed, deduped webhook**
  (not the client redirect), so only genuinely-paid requests appear. Idempotent (a retry can't create duplicates).
- Validate uploads (type/size/count ≤10) server-side; strip EXIF; virus/format check.
- A user can have multiple requests; each is its own paid record.

## 5. Game-side hook (tiny — I wire this when you're ready)
The GAME just needs an entry point that deep-links to this page (like the Sparks top-up): e.g. a **"Commission a Custom
Level"** card in the Store or a "Create" entry → opens `reactivvibeai.com/commission` (sign-in gated). On return, nothing
to sync (it's a fulfillment flow, not an in-game unlock). ~10 lines of game-side work once the URL exists — tell me the
URL + whether it's a new tab or an in-app link.

**One-line for Lovable:** *Build a sign-in-gated "Commission a Custom Level" page — ≤10 reference image uploads + a
structured description form, a transparent deliverables breakdown, $59.95 Stripe Checkout, and on the signed webhook write
the full submission (fields + image URLs + payment ref) to an admin-only "Custom Level Requests" queue with owner
notification. The game will deep-link to it.*
