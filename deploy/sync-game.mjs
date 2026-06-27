// deploy/sync-game.mjs — pull the Reactive Rhythm game CODE from this public source repo
// into the Lovable site repo's static route. RUNS IN THE LOVABLE REPO (not here) as a prebuild step:
//
//   package.json:  "scripts": { "prebuild": "node scripts/sync-game.mjs" }
//
// Node 18+ (uses global fetch). Verified 2026-06-27: every URL below returns HTTP 200, main@HEAD = 9241c72.
//
// WHY: the game's churning surface is 10 code/CSS files — they update on every game push (e.g. the wager-escrow
// wiring + the pre-public dev-hook strip still landing). Syncing them from `main` means a fast-follow push here
// auto-rolls out on Lovable's next build, no re-coordination. ASSETS are a ONE-TIME import (they rarely change):
//   • light assets (guitar art, note PNGs, rings, atom/mascot, *.mp3 SFX, moon-loop.mp4, fx/, ui/, guitars/)
//     → drop into public/game/assets/  (grab them from the repo tarball once:
//        https://codeload.github.com/reactivvibeai-eng/reactive-rhythm/tar.gz/refs/heads/main )
//   • heavy level videos (assets/levels/*.mp4, ~1GB) → Supabase Storage. The game references them by the
//     RELATIVE path "assets/levels/<name>.mp4" (55 refs, all in index.html), so map /game/assets/levels/* →
//     the Storage bucket (rewrite / redirect / proxy) and the game resolves them with ZERO code change.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const REF  = process.env.RR_REF || 'main';   // pin to a commit sha for a reproducible build if you prefer
const BASE = `https://raw.githubusercontent.com/reactivvibeai-eng/reactive-rhythm/${REF}/`;
const OUT  = process.env.RR_OUT || 'public/game';
const FILES = [
  'index.html', 'game.js', 'catalog.js', 'jukebox.js', 'jukebox.css',
  'multiplayer.js', 'couch.js', 'procbg.js', 'share.js', 'telemetry.js',
];

await mkdir(OUT, { recursive: true });
for (const f of FILES) {
  const res = await fetch(BASE + f, { cache: 'no-store' });
  if (!res.ok) throw new Error(`sync-game: ${f} -> HTTP ${res.status} (ref ${REF})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = join(OUT, f);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`  synced ${f}  (${buf.length.toLocaleString()} bytes)`);
}
console.log(`Reactive Rhythm code synced to ${OUT}/ from ${REF}. Serve it as a STATIC route at /game and /game/* (no React shell, no iframe). Assets: light → ${OUT}/assets, level videos → Storage (map /game/assets/levels/).`);
