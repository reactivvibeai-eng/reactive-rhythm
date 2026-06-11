# Visual alignment proof: composite the SKIN_GEOM lane chords (nut point -> bridge point per
# string, exactly what the engine draws between) onto the guitar art + zoomed crops at the nut
# row, a mid row, and the bridge row. Output PNGs are for EYEBALL review before the user plays.
# Usage: python _overlay_proof.py <file.png> <nutFY> <bridgeFY> <nutXF csv> <bridgeXF csv> <outprefix>
import sys
from PIL import Image, ImageDraw

path, nf, bf = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
nut = [float(v) for v in sys.argv[4].split(',')]
brg = [float(v) for v in sys.argv[5].split(',')]
out = sys.argv[6]

im = Image.open(path).convert('RGBA')
W, H = im.size
base = Image.new('RGBA', (W, H), (10, 7, 6, 255))
base.alpha_composite(im)
dr = ImageDraw.Draw(base)
yN, yB = nf * H, bf * H
for i in range(5):
    xN, xB = nut[i] * W, brg[i] * W
    # extend the chord a touch beyond both rows so the rows themselves stay inspectable
    dr.line([(xN, yN), (xB, yB)], fill=(255, 40, 60, 230), width=3)
    dr.ellipse([xN - 7, yN - 7, xN + 7, yN + 7], outline=(80, 255, 120, 255), width=3)
    dr.ellipse([xB - 9, yB - 9, xB + 9, yB + 9], outline=(80, 255, 120, 255), width=3)
dr.line([(0, yN), (W, yN)], fill=(80, 255, 120, 120), width=1)
dr.line([(0, yB), (W, yB)], fill=(80, 255, 120, 120), width=1)

full = base.resize((W // 2, H // 2), Image.LANCZOS)
full.convert('RGB').save(out + '_full.png')

def crop(cy, tag, zoom=2):
    x0 = int(min(nut[0], brg[0]) * W) - 90
    x1 = int(max(nut[-1], brg[-1]) * W) + 90
    y0, y1 = int(cy - 110), int(cy + 110)
    c = base.crop((max(0, x0), max(0, y0), min(W, x1), min(H, y1)))
    c = c.resize((c.width * zoom // 2, c.height * zoom // 2), Image.LANCZOS)
    c.convert('RGB').save(out + '_' + tag + '.png')

crop(yN, 'nut')
crop((yN + yB) / 2, 'mid')
crop(yB, 'bridge')
print('wrote', out + '_full/_nut/_mid/_bridge.png')
