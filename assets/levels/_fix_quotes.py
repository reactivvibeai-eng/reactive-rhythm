# One-shot repair: my ftfy pass (default uncurl_quotes=True) flattened curly quotes to ASCII
# inside JS strings -> SyntaxError killed the levels inline script. Restore every line that
# differs from the clean v119 blob (80a0765) ONLY by curly->straight quotes, then node-check
# every inline <script> block so this class of bug can never ship silently again.
import subprocess, re, tempfile, sys

proj = r'D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2'
p = proj + r'\index.html'
blob = subprocess.run(['git', '-C', proj, 'show', '80a0765:index.html'], capture_output=True).stdout.decode('utf-8')
cur = open(p, 'rb').read().decode('utf-8')

CURLY = {'’': "'", '‘': "'", '“': '"', '”': '"'}
fixed = 0
for line in blob.split('\n'):
    if not any(c in line for c in CURLY):
        continue
    bad = line
    for c, a in CURLY.items():
        bad = bad.replace(c, a)
    if bad != line and bad in cur:
        cur = cur.replace(bad, line)
        fixed += 1
open(p, 'wb').write(cur.encode('utf-8'))
print('lines restored:', fixed)

blocks = re.findall(r'<script>(.*?)</script>', cur, re.S)
bad_blocks = []
for i, b in enumerate(blocks):
    fn = tempfile.gettempdir() + r'\rr_blk%d.js' % i
    open(fn, 'w', encoding='utf-8').write(b)
    r = subprocess.run(['node', '--check', fn], capture_output=True)
    if r.returncode != 0:
        bad_blocks.append((i, r.stderr.decode()[:240]))
print('script blocks:', len(blocks), 'failing:', bad_blocks if bad_blocks else 'NONE')
sys.exit(1 if bad_blocks else 0)
