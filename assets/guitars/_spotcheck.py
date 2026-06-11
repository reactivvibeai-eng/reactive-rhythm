# Spot-check: do the fitted string lines, EVALUATED at given rows, land on bright (string)
# pixels vs their local neighborhood? Validates extrapolation beyond the clean-fit range.
import sys
from PIL import Image
from _measure_strings import measure

path, rows = sys.argv[1], [float(v) for v in sys.argv[2].split(',')]
im = Image.open(path).convert('RGBA'); W, H = im.size; px = im.load()

def lum(x, y):
    r, g, b, a = px[max(0, min(W - 1, x)), max(0, min(H - 1, y))]
    return (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255.0)

for fy in rows:
    m = measure(path, 0.10, fy)
    xs = m['bridgeXF']
    y = int(fy * H)
    out = []
    for fx in xs:
        x = int(fx * W)
        on = max(lum(x + dx, y) for dx in (-2, -1, 0, 1, 2))
        off = (sum(lum(x + dx, y) for dx in (-14, -11, 11, 14)) / 4.0)
        out.append('%.0f/%.0f' % (on, off))
    print('row %.2f: on/off per string: %s' % (fy, '  '.join(out)))
