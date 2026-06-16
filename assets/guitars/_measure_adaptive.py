# Adaptive string measurer for darker/themed skins (neck-band focus + per-row adaptive threshold).
# Strings are detected on the NECK only; the fitted lines are extrapolated to nutFY/bridgeFY.
# Draws a cyan overlay (<file>_ovl.png) so the fit can be visually verified.
# Usage: python _measure_adaptive.py <file.png> [nutFY] [bridgeFY] [ytop] [ybot]
import sys, math
from PIL import Image, ImageDraw

def row_peaks(sm, W, k):
    vals = [v for v in sm if v > 0]
    if len(vals) < W * 0.15:
        return []
    mean = sum(vals) / len(vals)
    std = math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals))
    thr = mean + k * std
    peaks = []
    x = 1
    while x < W - 1:
        if sm[x] > thr:
            x0 = x; wsum = 0.0; wx = 0.0; pk = 0.0
            while x < W - 1 and sm[x] > thr:
                wsum += sm[x]; wx += sm[x] * x; pk = max(pk, sm[x]); x += 1
            if x - x0 <= max(10, W * 0.012):
                peaks.append((wx / wsum, pk))
        x += 1
    merged = []
    for c, p in sorted(peaks):
        if merged and c - merged[-1][0] < W * 0.008:
            if p > merged[-1][1]:
                merged[-1] = (c, p)
        else:
            merged.append((c, p))
    return [c for c, p in merged]

def is_clean(cs, W):
    if len(cs) != 5:
        return False
    span = cs[-1] - cs[0]; mid = (cs[0] + cs[-1]) / 2.0
    if span < W * 0.04 or span > W * 0.55 or mid < W * 0.30 or mid > W * 0.70:
        return False
    gaps = [cs[i + 1] - cs[i] for i in range(4)]; gm = sum(gaps) / 4.0
    if gm <= 0 or max(abs(g - gm) for g in gaps) > gm * 0.60:
        return False
    return True

def measure(path, nutFY=0.16, bridgeFY=0.81, ytop=0.10, ybot=0.52):
    im = Image.open(path).convert('RGBA'); W, H = im.size; px = im.load()
    clean = []
    for y in range(int(H * ytop), int(H * ybot), 3):
        lum = [0.0] * W
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 200:
                lum[x] = (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255.0)
        sm = [0.0] * W
        for x in range(1, W - 1):
            sm[x] = (lum[x - 1] + lum[x] + lum[x + 1]) / 3.0
        for k in (1.35, 1.1, 0.9, 0.75, 0.6, 0.5):
            cs = row_peaks(sm, W, k)
            if is_clean(cs, W):
                clean.append((y, cs)); break
    if len(clean) < 8:
        return {'file': path, 'cleanRows': len(clean), 'error': 'too few clean rows'}
    fits = []
    for i in range(5):
        pts = [(y, cs[i]) for y, cs in clean]; n = len(pts)
        sy = sum(p[0] for p in pts); sx = sum(p[1] for p in pts)
        syy = sum(p[0] * p[0] for p in pts); sxy = sum(p[0] * p[1] for p in pts)
        den = n * syy - sy * sy
        a = (n * sxy - sy * sx) / den; b = (sx - a * sy) / n
        res = math.sqrt(sum((p[1] - (a * p[0] + b)) ** 2 for p in pts) / n)
        fits.append((a, b, res))
    nut = [round((a * (nutFY * H) + b) / W, 4) for a, b, r in fits]
    brg = [round((a * (bridgeFY * H) + b) / W, 4) for a, b, r in fits]
    d = ImageDraw.Draw(im)
    for i in range(5):
        d.line([(nut[i] * W, nutFY * H), (brg[i] * W, bridgeFY * H)], fill=(0, 255, 255, 255), width=2)
    out = path.rsplit('.', 1)[0] + '_ovl.png'; im.save(out)
    return {'file': path.split('/')[-1], 'W': W, 'H': H, 'aspect': round(W / H, 4),
            'cleanRows': len(clean), 'cleanTopF': round(min(y for y, _ in clean) / H, 3),
            'cleanBotF': round(max(y for y, _ in clean) / H, 3),
            'nutFY': nutFY, 'bridgeFY': bridgeFY, 'nutXF': nut, 'bridgeXF': brg,
            'nutSpan': round(nut[-1] - nut[0], 4), 'bridgeSpan': round(brg[-1] - brg[0], 4),
            'maxResidualPx': round(max(r for a, b, r in fits), 2), 'overlay': out}

if __name__ == '__main__':
    path = sys.argv[1]
    nf = float(sys.argv[2]) if len(sys.argv) > 2 else 0.16
    bf = float(sys.argv[3]) if len(sys.argv) > 3 else 0.81
    yt = float(sys.argv[4]) if len(sys.argv) > 4 else 0.10
    yb = float(sys.argv[5]) if len(sys.argv) > 5 else 0.52
    r = measure(path, nf, bf, yt, yb)
    for k, v in r.items():
        print('%s: %s' % (k, v))
