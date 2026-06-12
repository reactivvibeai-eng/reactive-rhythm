# Wordmark installer: remove the connected near-black BACKGROUND (flood from the borders, so
# dark pixels INSIDE letterforms stay solid), feather the cut 1px, crop to content + pad,
# downscale, save as the live title asset.
import sys
from PIL import Image, ImageDraw, ImageFilter

src, dst, outw = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGBA')
W, H = im.size
px = im.load()

# binarize: near-black -> 0, else 255
mask = Image.new('L', (W, H), 0)
mp = mask.load()
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if max(r, g, b) >= 18:
            mp[x, y] = 255

# flood the connected dark region from the borders (value 0 -> 128 = background)
seeds = [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1), (W // 2, 0), (W // 2, H - 1), (0, H // 2), (W - 1, H // 2)]
for s in seeds:
    if mp[s[0], s[1]] == 0:
        ImageDraw.floodfill(mask, s, 128)

# alpha: background (128) -> 0; everything else opaque
alpha = Image.new('L', (W, H), 255)
ap = alpha.load()
bg = 0
for y in range(H):
    for x in range(W):
        if mp[x, y] == 128:
            ap[x, y] = 0
            bg += 1
alpha = alpha.filter(ImageFilter.GaussianBlur(1.1))   # soften the cut edge
im.putalpha(alpha)

# crop to content + 2% pad
bbox = im.getbbox()
padx, pady = int(W * 0.015), int(H * 0.03)
bbox = (max(0, bbox[0] - padx), max(0, bbox[1] - pady), min(W, bbox[2] + padx), min(H, bbox[3] + pady))
im = im.crop(bbox)

# downscale to target width
scale = outw / im.width
im = im.resize((outw, max(1, round(im.height * scale))), Image.LANCZOS)
im.save(dst)
print('saved', dst, im.size, 'bg px removed:', bg, '(%.0f%%)' % (100.0 * bg / (W * H)))
