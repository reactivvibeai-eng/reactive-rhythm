# Bone Daddy skull rig builder: magenta-key the bust, split into FULL-FRAME cranium + jaw
# layers (feathered overlap at the cut so the hinge never shows), crop to shared bbox, downscale.
# Usage: python _skull_rig.py <src.png> <outdir> <cutY_frac> <outW>
import sys, os
from PIL import Image, ImageFilter

src, outdir, cut_frac, outw = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert('RGBA')
W, H = im.size
px = im.load()

# global chroma key: near-magenta -> transparent (subject has no magenta; despill the fringe)
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if r > 165 and b > 165 and g < 120 and abs(r - b) < 70:
            px[x, y] = (r, g, b, 0)
        elif r > 140 and b > 140 and g < 110:   # fringe: half-key + desaturate the magenta cast
            m = (r + g + b) // 3
            px[x, y] = (m, m, m, a // 3)

# shared content bbox + small pad (both layers keep IDENTICAL framing for CSS alignment)
bbox = im.getbbox()
pad = int(W * 0.02)
bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(W, bbox[2] + pad), min(H, bbox[3] + pad))
im = im.crop(bbox)
W, H = im.size
cutY = int(H * cut_frac)
feather = max(8, H // 60)

def band_erase(img, keep_top):
    out = img.copy()
    alpha = out.getchannel('A').point(lambda v: v)
    ap = alpha.load()
    for y in range(out.height):
        if keep_top:
            f = 1.0 if y < cutY - feather else (0.0 if y > cutY + feather else (cutY + feather - y) / (2 * feather))
        else:
            f = 1.0 if y > cutY + feather else (0.0 if y < cutY - feather else (y - (cutY - feather)) / (2 * feather))
        if f < 1.0:
            for x in range(out.width):
                ap[x, y] = int(ap[x, y] * f)
    out.putalpha(alpha)
    return out

cranium = band_erase(im, True)
jaw = band_erase(im, False)
scale = outw / W
size = (outw, max(1, round(H * scale)))
cranium.resize(size, Image.LANCZOS).save(os.path.join(outdir, 'bonedaddy-skull.png'))
jaw.resize(size, Image.LANCZOS).save(os.path.join(outdir, 'bonedaddy-skull-jaw.png'))
print('rig saved', size, 'cut at', cut_frac, '->', outdir)
