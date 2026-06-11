# String-tracking measurement for guitar skin PNGs (SKIN_GEOM calibration).
# Method (validated vs guitar5 hand-calibration <=0.003): per-row luminance contrast peaks
# (bright metal strings over near-black fretboard) -> exactly-5-peak "clean" rows -> per-string
# least-squares line x(y) -> evaluated at chosen nutFY/bridgeFY rows -> width fractions.
# Usage: python _measure_strings.py <file.png> [nutFY] [bridgeFY]
import sys, math
from PIL import Image

def measure(path, nut_fy=None, bridge_fy=None):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    px = im.load()
    clean = []  # (y, [5 peak x centers])
    for y in range(int(H * 0.04), int(H * 0.88), 4):
        lum = [0.0] * W
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 200:
                lum[x] = (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255.0)
        # smooth (3px)
        sm = [0.0] * W
        for x in range(1, W - 1):
            sm[x] = (lum[x - 1] + lum[x] + lum[x + 1]) / 3.0
        vals = [v for v in sm if v > 0]
        if len(vals) < W * 0.15:
            continue
        mean = sum(vals) / len(vals)
        var = sum((v - mean) ** 2 for v in vals) / len(vals)
        std = math.sqrt(var)
        thr = mean + 1.35 * std
        # collect threshold-crossing clusters -> weighted centers
        peaks = []
        x = 1
        while x < W - 1:
            if sm[x] > thr:
                x0 = x
                wsum = 0.0; wx = 0.0; pk = 0.0
                while x < W - 1 and sm[x] > thr:
                    wsum += sm[x]; wx += sm[x] * x; pk = max(pk, sm[x]); x += 1
                if x - x0 <= max(10, W * 0.012):   # strings are THIN; reject wide bright areas
                    peaks.append((wx / wsum, pk))
            x += 1
        # merge peaks closer than 0.8% of width
        merged = []
        for c, p in sorted(peaks):
            if merged and c - merged[-1][0] < W * 0.008:
                if p > merged[-1][1]:
                    merged[-1] = (c, p)
            else:
                merged.append((c, p))
        cs = [c for c, p in merged]
        if len(cs) != 5:
            continue
        span = cs[-1] - cs[0]
        mid = (cs[0] + cs[-1]) / 2.0
        # plausibility: strings live in a centered band, span sane for a neck/body
        if span < W * 0.04 or span > W * 0.55 or mid < W * 0.32 or mid > W * 0.68:
            continue
        # near-even spacing (strings are evenly spaced; rejects rogue rows)
        gaps = [cs[i + 1] - cs[i] for i in range(4)]
        gm = sum(gaps) / 4.0
        if max(abs(g - gm) for g in gaps) > gm * 0.55:
            continue
        clean.append((y, cs))
    if len(clean) < 8:
        return {'file': path, 'error': 'only %d clean rows' % len(clean)}
    ys = [y for y, _ in clean]
    top, bot = min(ys), max(ys)
    # least-squares x(y) per string over the clean rows
    fits = []
    for i in range(5):
        pts = [(y, cs[i]) for y, cs in clean]
        n = len(pts)
        sy = sum(p[0] for p in pts); sx = sum(p[1] for p in pts)
        syy = sum(p[0] * p[0] for p in pts); sxy = sum(p[0] * p[1] for p in pts)
        den = n * syy - sy * sy
        a = (n * sxy - sy * sx) / den
        b = (sx - a * sy) / n
        res = math.sqrt(sum((p[1] - (a * p[0] + b)) ** 2 for p in pts) / n)
        fits.append((a, b, res))
    nut_fy = nut_fy if nut_fy is not None else max(0.06, top / H + 0.015)
    bridge_fy = bridge_fy if bridge_fy is not None else min(0.82, bot / H)
    nut = [round((a * (nut_fy * H) + b) / W, 4) for a, b, r in fits]
    brg = [round((a * (bridge_fy * H) + b) / W, 4) for a, b, r in fits]
    return {
        'file': path.split('\\')[-1], 'W': W, 'H': H, 'aspect': round(W / H, 4),
        'cleanRows': len(clean), 'cleanTopF': round(top / H, 3), 'cleanBotF': round(bot / H, 3),
        'nutFY': round(nut_fy, 3), 'bridgeFY': round(bridge_fy, 3),
        'nutXF': nut, 'bridgeXF': brg,
        'nutSpan': round(nut[-1] - nut[0], 4), 'bridgeSpan': round(brg[-1] - brg[0], 4),
        'fanRatio': round((brg[-1] - brg[0]) / max(1e-6, nut[-1] - nut[0]), 2),
        'maxResidualPx': round(max(r for a, b, r in fits), 2),
    }

if __name__ == '__main__':
    path = sys.argv[1]
    nf = float(sys.argv[2]) if len(sys.argv) > 2 else None
    bf = float(sys.argv[3]) if len(sys.argv) > 3 else None
    r = measure(path, nf, bf)
    for k, v in r.items():
        print('%s: %s' % (k, v))
