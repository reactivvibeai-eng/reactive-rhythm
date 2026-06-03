# Analyzer Parameters — verbatim, for bit-identical server port

These are the exact constants the browser game uses. Port them as-is into
`generate-chart`. Source of truth: `game.js` → `analyzeBeats()`.

## Signal chain
```
mono mixdown  →  RBJ biquad low-pass  →  non-overlapping RMS windows  →  adaptive peak pick
```

## Constants
| Param | Value | Notes |
|---|---|---|
| Channel | mono | average of all channels (`(L+R)/2`) |
| Filter type | low-pass | RBJ "cookbook" biquad — identical coefficients to WebAudio `BiquadFilterNode` type `"lowpass"` |
| Filter cutoff `f0` | **200 Hz** | isolates kick/bass |
| Filter `Q` | **1.0** | |
| RMS window | **0.023 s** (`floor(sampleRate * 0.023)` samples) | 23 ms |
| Hop | **= window size** | **non-overlapping** (hop == window, not 50%) |
| Energy metric | `sqrt(mean(sample²))` per window | RMS |
| Lookback | **44 windows** (~1.012 s) | local-mean baseline |
| Peak ratio | **1.45×** local mean | `energy[i] > mean * 1.45` |
| Absolute floor | **0.035** | `energy[i] > 0.035` — kills near-silence false peaks |
| Local-max test | `energy[i] >= energy[i-1] && energy[i] >= energy[i+1]` | |
| Min spacing | **0.16 s** | reject onsets closer than this |
| Strength | `clamp(energy[i] / (mean + 0.001), 0, 3)` | stored as `beats[].strength`, 2-decimal round |
| Time round | 3 decimals (ms) | `beats[].t` |

## RBJ low-pass coefficients (exact)
```
w0    = 2π · f0 / sampleRate
cos   = cos(w0);  sin = sin(w0)
alpha = sin / (2Q)
b0 = (1 - cos)/2 ;  b1 = 1 - cos ;  b2 = (1 - cos)/2
a0 = 1 + alpha  ;  a1 = -2·cos   ;  a2 = 1 - alpha
// normalize by a0, then standard Direct-Form-I difference equation
y[n] = (b0/a0)x[n] + (b1/a0)x[n-1] + (b2/a0)x[n-2] − (a1/a0)y[n-1] − (a2/a0)y[n-2]
```

## "Bit-identical" caveat — sample rate
The browser path runs inside `OfflineAudioContext`, whose biquad operates at the
**context sample rate** (the buffer's native rate after `decodeAudioData`). To match
exactly, run the server filter at the **track's native sample rate** — do not resample
to 44.1k first unless the source already is. Different sample rate → slightly different
filter response → a handful of borderline onsets may differ. The full-quality WAV
(`download_wav_url`) gives the cleanest, most reproducible result; lossy m4a will drift
a little regardless of math because the codec already altered the low end.

## What stays client-side (do NOT port)
- **Lane assignment:** `floor(t*8.97 + strength*3.1 + i*1.7) % 4`, collision-nudged
  against previous two lanes.
- **Difficulty density filter:** easy ≈ strongest 55% of beats, medium ≈ 85%, hard = 100%,
  plus per-difficulty approach speed + hit window.
These are deterministic in the game so every player gets the same chart; the DB only
ever stores the raw `beats`.
