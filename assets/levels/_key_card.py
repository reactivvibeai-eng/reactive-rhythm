# Card/sprite keyer: remove the KEY-COLOR background (auto-detected from the corners: magenta,
# green, or blue; global chroma key + fringe despill), crop to content + pad, downscale.
# Usage: python _key_card.py <src> <dst> <outW>
import sys
from PIL import Image

src, dst, outw = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGBA')
W, H = im.size
px = im.load()

# detect the key color from the 4 corners
cr = [px[2, 2], px[W - 3, 2], px[2, H - 3], px[W - 3, H - 3]]
ar, ag, ab = (sum(c[i] for c in cr) // 4 for i in range(3))
if ag > 150 and ar < 120 and ab < 120:
    key = 'green'
elif ab > 150 and ar < 120 and ag < 150:
    key = 'blue'
else:
    key = 'magenta'

def is_key(r, g, b, hard):
    t1, t2 = (165, 120) if hard else (140, 110)
    if key == 'magenta': return r > t1 and b > t1 and g < t2 and (not hard or abs(r - b) < 70)
    if key == 'green':   return g > t1 and r < t2 and b < t2
    return b > t1 and r < t2 and g < t2

for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if is_key(r, g, b, True):
            px[x, y] = (r, g, b, 0)
        elif is_key(r, g, b, False):
            m = (r + g + b) // 3
            px[x, y] = (m, m, m, a // 3)
print('key color:', key)
bbox = im.getbbox()
pad = int(W * 0.012)
bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(W, bbox[2] + pad), min(H, bbox[3] + pad))
im = im.crop(bbox)
scale = outw / im.width
im = im.resize((outw, max(1, round(im.height * scale))), Image.LANCZOS)
im.save(dst)
print('keyed ->', dst, im.size)
