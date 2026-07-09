#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Reactive Rhythm — BRAND LINTER
================================
Scans CSS colors in index.html + jukebox.css and flags anything that breaks
the brand law:

    BLACK · CRIMSON · CHROME.  Warm darks only (R >= G >= B).
    NO blue / purple / green in UI chrome.

It reports two classes of violation:

  1. COOL DARK   — a dark color (max channel < DARK_MAX) whose blue or green
                   channel is meaningfully above red (B > R + TOL or G > R + TOL).
                   These read as "cool"/blue-grey and, under the crimson bg glow,
                   blend to purple. Darks must be warm (R >= G >= B).

  2. OFF-PALETTE — a saturated hue landing in the blue / purple / green wedge of
                   the color wheel. Reds, crimsons, ambers, golds and near-greys
                   pass; blues, purples and greens are flagged.

Whitelisted (intentional, do NOT retune):
  * GH-green fret-1 gem color(s)      — the sanctioned Guitar-Hero green gem.
  * JetBrains status-chip greys       — neutral chip text greys.
  * Documented functional state chips — e.g. the "daily done" success green,
    which conveys semantic state (not chrome). Each carries an in-file comment.

Pure standard-library Python. No third-party deps.

Usage:
    python tools/brand-linter.py                 # lint the default file set
    python tools/brand-linter.py a.css b.html    # lint an explicit set
    python tools/brand-linter.py --strict        # exit 1 if any violation
"""

import os
import re
import sys
import colorsys

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------
DARK_MAX   = 90     # a color is "dark" when its brightest channel is below this
TOL        = 8      # channels within +/-TOL of each other count as "neutral"
SAT_MIN    = 0.22   # below this saturation a hue is treated as a near-grey (ignored)
# Hue wedges (degrees, 0=red) that are off-brand when saturated enough:
GREEN_LO, GREEN_HI   = 75, 165
BLUEPUR_LO, BLUEPUR_HI = 175, 320   # cyan -> blue -> purple -> magenta edge

# Exact colors that are intentional and must never be flagged (lowercase, no '#').
WHITELIST = {
    # --- GH-green fret-1 gem (sanctioned Guitar-Hero green; see memory
    #     'green-fret-brand-exception'). Lives in game.js today, listed here so
    #     it stays clean if it ever migrates into a linted file. ---
    "3ad15a", "35c94f", "3ad150",
    # --- documented functional STATE chips (semantic, not chrome) ---
    "8fd39a",   # index.html: ".mh-daily-done" - "green is allowed on functional state chips"
    # --- JetBrains status-chip / neutral chip greys (warm neutrals) ---
    "9c918e", "a8a29c", "8d8380", "cdc4c1", "b3a8a5", "9b9490",
    # --- sanctioned per-LEVEL theme accents (NOT UI chrome; "UI chrome stays
    #     crimson"). The violet accent themes gothic/necro/tarot levels only,
    #     via --rr-lvl-accent / SPLASH_THEME / ENV_ACCENT_HEX. ---
    "a64dff",
    # --- horror-lens chromatic-aberration FX (a red<->blue lens fringe is what
    #     the effect IS; the blue side of .hl-aberr cannot be warmed away). ---
    "2882ff",
}


def strip_block_comments(text):
    """Blank CSS /* */ and HTML <!-- --> comment spans (preserving newlines &
    offsets) so we never lint colors that a comment merely *documents* or an
    issue-ref like (#172) that isn't a color at all."""
    out = list(text)

    def blank(a, b):
        for k in range(a, b):
            if out[k] != "\n":
                out[k] = " "

    for m in re.finditer(r"/\*.*?\*/", text, re.S):
        blank(m.start(), m.end())
    for m in re.finditer(r"<!--.*?-->", text, re.S):
        blank(m.start(), m.end())
    return "".join(out)

DEFAULTS = ["index.html", "jukebox.css"]

HEX_RE = re.compile(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
RGB_RE = re.compile(r"rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})", re.I)


# ---------------------------------------------------------------------------
def hex_to_rgb(h):
    h = h.lower()
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgb_to_hue_sat(r, g, b):
    """Return (hue_degrees, saturation 0..1, lightness 0..1)."""
    hh, ll, ss = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
    return hh * 360.0, ss, ll


def norm_hex(r, g, b):
    return "{:02x}{:02x}{:02x}".format(r, g, b)


def classify(r, g, b):
    """Return a violation tag or None. None == on-brand / neutral / whitelisted."""
    key = norm_hex(r, g, b)
    if key in WHITELIST:
        return None

    mx = max(r, g, b)
    hue, sat, light = rgb_to_hue_sat(r, g, b)

    # DARK colors: only the "cool cast" test is meaningful. Hue is perceptually
    # unstable near black (a warm near-black red-black can land at hue 320), so
    # we do NOT run the hue-wedge test on darks — warm darks require R >= B.
    if mx < DARK_MAX:
        if b > r + TOL:
            return ("COOL DARK", "blue channel above red (cool/purple cast)")
        if g > r + TOL and g > b + TOL:
            return ("COOL DARK", "green channel above red (cool cast)")
        return None
    # NON-DARK colors: flag saturated hues landing in the green / blue-purple wedge.
    if sat >= SAT_MIN:
        if GREEN_LO <= hue <= GREEN_HI:
            return ("OFF-PALETTE", "green hue {:.0f} deg".format(hue))
        if BLUEPUR_LO <= hue <= BLUEPUR_HI:
            return ("OFF-PALETTE", "blue/purple hue {:.0f} deg".format(hue))
    return None


def scan_file(path):
    """Yield (lineno, raw_token, (r,g,b), (tag, why))."""
    findings = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError as e:
        print("  ! cannot read {}: {}".format(path, e))
        return findings
    lines = strip_block_comments(text).splitlines()
    for i, line in enumerate(lines, 1):
        for m in HEX_RE.finditer(line):
            r, g, b = hex_to_rgb(m.group(1))
            v = classify(r, g, b)
            if v:
                findings.append((i, m.group(0), (r, g, b), v))
        for m in RGB_RE.finditer(line):
            r, g, b = (min(255, int(m.group(k))) for k in (1, 2, 3))
            v = classify(r, g, b)
            if v:
                findings.append((i, m.group(0), (r, g, b), v))
    return findings


def main(argv):
    strict = "--strict" in argv
    files = [a for a in argv if not a.startswith("--")]
    if not files:
        here = os.path.dirname(os.path.abspath(__file__))
        root = os.path.dirname(here)
        files = [os.path.join(root, f) for f in DEFAULTS]

    print("=" * 68)
    print(" REACTIVE RHYTHM - BRAND LINTER")
    print(" law: black / crimson / chrome | warm darks R>=G>=B | no blue/purple/green")
    print("=" * 68)

    total = 0
    for path in files:
        rel = os.path.basename(path)
        findings = scan_file(path)
        if not findings:
            print("\n[{}]  clean - 0 violations".format(rel))
            continue
        print("\n[{}]  {} violation(s):".format(rel, len(findings)))
        for lineno, tok, (r, g, b), (tag, why) in findings:
            print("  L{:<6} {:<10} rgb({:>3},{:>3},{:>3})  {:<11} {}".format(
                lineno, tok, r, g, b, tag, why))
        total += len(findings)

    print("\n" + "-" * 68)
    print(" TOTAL: {} violation(s)".format(total))
    print("-" * 68)
    if strict and total:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
