# Loop pipeline for level background videos (user law: frame A must match frame B).
#   qa <video>                 -> first/last frame RGB distance (loop seam score)
#   loop <in> <out> [fadeSec]  -> crossfade-loop: body starts at t=F, its tail xfades into the
#                                 original head, so last frame ~= first frame (perfect wrap)
#   stitch <a> <b> <out>       -> concat two clips (use when clip2 was generated FROM clip1's
#                                 last frame; the pair then loops as a unit)
# Requires ffmpeg/ffprobe on PATH + PIL.
import sys, subprocess, tempfile, os, json
from PIL import Image

def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('ffmpeg failed: ' + ' '.join(args) + '\n' + r.stderr[-800:])
    return r

def duration(path):
    r = subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', path],
                       capture_output=True, text=True)
    return float(json.loads(r.stdout)['format']['duration'])

def grab(path, when, out):
    run(['ffmpeg', '-y', '-ss', str(when), '-i', path, '-frames:v', '1', '-update', '1', out])

def grab_last(path, out):
    # -sseof seeks from EOF (reliable; a plain -ss near the end can land past the last frame)
    run(['ffmpeg', '-y', '-sseof', '-0.25', '-i', path, '-frames:v', '1', '-update', '1', out])

def qa(path):
    d = duration(path)
    t = tempfile.mkdtemp()
    a, b = os.path.join(t, 'a.png'), os.path.join(t, 'b.png')
    grab(path, 0, a)
    grab_last(path, b)
    ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    ia = ia.resize((160, 90)); ib = ib.resize((160, 90))
    pa, pb = ia.load(), ib.load()
    s = 0
    for y in range(90):
        for x in range(160):
            ra, ga, ba = pa[x, y]; rb, gb, bb = pb[x, y]
            s += abs(ra - rb) + abs(ga - gb) + abs(ba - bb)
    mean = s / (160 * 90)
    verdict = 'PASS (loops clean)' if mean < 18 else ('SOFT (crossfade recommended)' if mean < 60 else 'FAIL (needs loop/stitch)')
    print('duration %.2fs  seam distance %.1f/px  -> %s' % (d, mean, verdict))
    return mean

def loop(src, dst, fade=0.6):
    d = duration(src)
    f = min(fade, d / 4)
    body_len = d - f                       # body = src[f..d], length d-f
    off = body_len - f                     # xfade starts so the tail blends into the head
    flt = ('[0:v]trim=start=%f,setpts=PTS-STARTPTS[body];'
           '[0:v]trim=start=0:end=%f,setpts=PTS-STARTPTS[head];'
           '[body][head]xfade=transition=fade:duration=%f:offset=%f[v]') % (f, f, f, off)
    run(['ffmpeg', '-y', '-i', src, '-filter_complex', flt, '-map', '[v]',
         '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-an', dst])
    print('looped ->', dst)
    qa(dst)

def stitch(a, b, dst):
    t = tempfile.mkdtemp()
    lst = os.path.join(t, 'l.txt')
    open(lst, 'w').write("file '%s'\nfile '%s'\n" % (a.replace('\\', '/'), b.replace('\\', '/')))
    run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', lst,
         '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-an', dst])
    print('stitched ->', dst)
    qa(dst)

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'qa': qa(sys.argv[2])
    elif cmd == 'loop': loop(sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else 0.6)
    elif cmd == 'stitch': stitch(sys.argv[2], sys.argv[3], sys.argv[4])
    else: sys.exit('unknown command')
