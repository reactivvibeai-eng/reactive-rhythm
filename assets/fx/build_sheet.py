#!/usr/bin/env python3
"""Build a flipbook sprite sheet from a Seedance source clip.

Pipeline:
  1. ffmpeg extracts EVERY native frame, square-cropped + scaled to the cell size.
  2. Near-black lead/tail frames are trimmed (one-shot) so the N frames span the
     actual ignite->fade lifecycle instead of wasting cells on dead black.
  3. Exactly N evenly-spaced frames are picked and tiled into a COLS x ROWS grid.
  4. Sheet is written RGB on pure black (blend mode is additive "lighter", so black
     contributes nothing and no alpha channel is needed).

Usage:
  python build_sheet.py <name> --count N --cols C --rows R [--cell 128] [--loop]

  <name>  basename; reads _src/<name>.mp4, writes <name>.png next to this script.
  --loop  pick frames as a cycle (no duplicated start/end frame) and skip lead/tail
          trim, so a continuous loop tiles cleanly.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / "_src"


def extract_frames(mp4: Path, cell: int, work: Path):
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    vf = (
        f"scale={cell}:{cell}:force_original_aspect_ratio=increase,"
        f"crop={cell}:{cell}"
    )
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(mp4),
        "-vf", vf, "-fps_mode", "passthrough",
        str(work / "f_%04d.png"),
    ]
    subprocess.run(cmd, check=True)
    return sorted(work.glob("f_*.png"))


def is_active(img: Image.Image, thresh: int = 24) -> bool:
    """A frame is active if its brightest pixel exceeds a small threshold."""
    return img.convert("L").getextrema()[1] > thresh


def pick_indices(n_avail: int, count: int, loop: bool):
    if count > n_avail:
        count = n_avail
    if loop:
        # cycle: step across the whole range, do NOT repeat the first frame
        return [round(i * n_avail / count) % n_avail for i in range(count)]
    if count == 1:
        return [0]
    # span endpoints inclusive: first = ignition, last = full fade
    return [round(i * (n_avail - 1) / (count - 1)) for i in range(count)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--count", type=int, required=True)
    ap.add_argument("--cols", type=int, required=True)
    ap.add_argument("--rows", type=int, required=True)
    ap.add_argument("--cell", type=int, default=128)
    ap.add_argument("--loop", action="store_true")
    args = ap.parse_args()

    if args.cols * args.rows < args.count:
        sys.exit(f"grid {args.cols}x{args.rows} too small for {args.count} frames")

    mp4 = SRC / f"{args.name}.mp4"
    if not mp4.exists():
        sys.exit(f"missing source clip: {mp4}")

    work = SRC / "frames" / args.name
    files = extract_frames(mp4, args.cell, work)
    imgs = [Image.open(f).convert("RGB") for f in files]
    print(f"extracted {len(imgs)} native frames")

    if not args.loop:
        active = [i for i, im in enumerate(imgs) if is_active(im)]
        if active:
            a, b = active[0], active[-1]
            imgs = imgs[a:b + 1]
            print(f"trimmed to active span [{a}..{b}] -> {len(imgs)} frames")

    idx = pick_indices(len(imgs), args.count, args.loop)
    picked = [imgs[i] for i in idx]
    print(f"picked {len(picked)} frames at native indices {idx}")

    sheet_w = args.cols * args.cell
    sheet_h = args.rows * args.cell
    sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))
    for n, im in enumerate(picked):
        r, c = divmod(n, args.cols)
        sheet.paste(im, (c * args.cell, r * args.cell))

    out = HERE / f"{args.name}.png"
    sheet.save(out)
    print(f"wrote {out}  ({sheet_w}x{sheet_h}, {len(picked)} frames, "
          f"{args.cols}x{args.rows})")


if __name__ == "__main__":
    main()
