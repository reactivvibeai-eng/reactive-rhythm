# Safe ?v=NN cache-bust bump (the ONLY sanctioned way — PowerShell rewrites corrupt UTF-8).
# Usage: python assets/_bump_v.py 121 122
import sys

old, new = sys.argv[1], sys.argv[2]
p = r'D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\index.html'
data = open(p, 'rb').read()
needle, repl = ('?v=%s' % old).encode(), ('?v=%s' % new).encode()
n = data.count(needle)
open(p, 'wb').write(data.replace(needle, repl))
print('bumped %d tags %s -> %s' % (n, old, new))
