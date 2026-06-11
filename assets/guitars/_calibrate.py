# FINAL SKIN_GEOM calibration: least-squares string lines + LOCAL-PEAK SNAP at the eval rows
# (the leftmost string curves outward toward the body in these renders — linear extrapolation
# drifts up to 14px; snapping to the row's actual luminance peak nails it).
# Usage: python _calibrate.py <file.png> <nutFY> <bridgeFY>
import sys
from PIL import Image
from _measure_strings import measure

path, nf, bf = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
im = Image.open(path).convert('RGBA'); W, H = im.size; px = im.load()

def lum(x, y):
    r, g, b, a = px[max(0, min(W - 1, x)), max(0, min(H - 1, y))]
    return (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255.0)

def snap(fracs, fy, win_frac):
    y = int(fy * H); out = []
    for fx in fracs:
        x0 = int(fx * W); best, bx = -1, x0
        for dx in range(-int(W * win_frac), int(W * win_frac) + 1):
            v = lum(x0 + dx, y)
            if v > best: best, bx = v, x0 + dx
        out.append(round(bx / W, 4) if best >= 200 else round(fx, 4))
    return out

m = measure(path, nf, bf)
nut = snap(m['nutXF'], nf, 0.008)
brg = snap(m['bridgeXF'], bf, 0.018)
name = path.split('\\')[-1]
print("'assets/guitars/%s': { aspect: %d / %d, nutFY: %.3f, bridgeFY: %.3f," % (name, W, H, nf, bf))
print('  nutXF:    [%s],' % ', '.join('%.4f' % v for v in nut))
print('  bridgeXF: [%s] },' % ', '.join('%.4f' % v for v in brg))
gaps_n = [nut[i+1]-nut[i] for i in range(4)]; gaps_b = [brg[i+1]-brg[i] for i in range(4)]
print('# nut gaps %s | bridge gaps %s | fan %.2f' % (
  ['%.4f'%g for g in gaps_n], ['%.4f'%g for g in gaps_b],
  (brg[-1]-brg[0]) / max(1e-6, nut[-1]-nut[0])))
