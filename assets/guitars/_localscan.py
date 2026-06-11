# For each predicted string x at given rows: scan +-30px for the actual local luminance max.
# Reports offset (actual-predicted) and peak value -> distinguishes "line drifted" (bright peak
# at an offset) from "string invisible here" (no bright peak at all).
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
    y = int(fy * H)
    line = []
    for fx in m['bridgeXF']:
        x0 = int(fx * W)
        best, bx = -1, 0
        for dx in range(-30, 31):
            v = lum(x0 + dx, y)
            if v > best: best, bx = v, dx
        line.append('%+d@%.0f' % (bx, best))
    print('row %.2f offsets(px)@peak: %s' % (fy, '  '.join(line)))
