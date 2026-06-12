# Trim a keyed (alpha) guitar render to its content bbox and REMAP the full-frame
# calibration fractions into the trimmed frame (the engine's SKIN_GEOM convention is a
# tight cutout, like the original assets). Upscales the trimmed cutout 2x for shipping.
# Usage: python _trim_remap.py <keyed.png> <out.png> <nutFY> <bridgeFY> <nutXF csv> <bridgeXF csv>
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
nf, bf = float(sys.argv[3]), float(sys.argv[4])
nut = [float(v) for v in sys.argv[5].split(',')]
brg = [float(v) for v in sys.argv[6].split(',')]

im = Image.open(src).convert('RGBA')
W, H = im.size
alpha = im.getchannel('A')
bbox = alpha.point(lambda a: 255 if a > 12 else 0).getbbox()
pad = 6
x0, y0 = max(0, bbox[0] - pad), max(0, bbox[1] - pad)
x1, y1 = min(W, bbox[2] + pad), min(H, bbox[3] + pad)
c = im.crop((x0, y0, x1, y1))
cw, ch = c.size
c = c.resize((cw * 2, ch * 2), Image.LANCZOS)
c.save(dst, optimize=True)

def rx(v): return round((v * W - x0) / cw, 4)
def ry(v): return round((v * H - y0) / ch, 4)
name = dst.split('\\')[-1]
print('trimmed %dx%d -> ship %dx%d (bbox %s)' % (W, H, c.width, c.height, (x0, y0, x1, y1)))
print("'assets/guitars/%s': { aspect: %d / %d, nutFY: %.3f, bridgeFY: %.3f," % (name, c.width, c.height, ry(nf), ry(bf)))
print('  nutXF:    [%s],' % ', '.join('%.4f' % rx(v) for v in nut))
print('  bridgeXF: [%s] },' % ', '.join('%.4f' % rx(v) for v in brg))
