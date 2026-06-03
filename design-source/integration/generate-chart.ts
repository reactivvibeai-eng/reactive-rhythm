// supabase/functions/generate-chart/index.ts
// =============================================================================
// RHYTHM RIFT — server-side beat-chart generator (Deno / Supabase Edge Function)
//
// Ports the in-browser analyzer to the server so charts are baked ONCE on
// upload/promote instead of every play. Output matches chart_v1.schema.json.
//
// IMPORTANT CONSTRAINT — read before deploying:
//   Deno Deploy (where Supabase Edge Functions run) has NO Web Audio API and
//   NO subprocess, so we cannot use OfflineAudioContext or shell out to ffmpeg.
//   We therefore decode PCM ourselves:
//     • WAV  -> parsed directly in pure JS  (EXACT, lossless — strongly preferred)
//     • mp3  -> decoded via the `audio-decode` wasm lib
//     • m4a/aac -> decode support is spotty in pure JS. If wav_url is null AND
//                  the Mux rendition is m4a, prefer asking Mux for an mp3 static
//                  rendition, OR run this analyzer in a Node/Playwright worker
//                  that has the real Web Audio API. See README note at bottom.
//
//   For best onset detection, ALWAYS use download_wav_url when present.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- DSP config (identical to the browser analyzer) ------------------------
const LOWPASS_HZ = 200;
const LOWPASS_Q = 1.0;
const WIN_SEC = 0.023; // 23ms RMS window
const LOOKBACK = 44; // ~1s of windows
const PEAK_RATIO = 1.45; // must exceed 1.45x local mean
const PEAK_FLOOR = 0.035; // absolute energy floor
const MIN_GAP = 0.16; // min seconds between onsets

// ---- RBJ biquad low-pass (same cookbook coefficients WebAudio uses) --------
function lowpass(samples: Float32Array, sr: number, f0: number, Q: number): Float32Array {
  const w0 = (2 * Math.PI * f0) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Q);
  const b1 = 1 - cos;
  const b0 = b1 / 2;
  const b2 = b0;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0, na1 = a1 / a0, na2 = a2 / a0;
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

// ---- onset detection (identical algorithm to the browser version) ----------
function detectOnsets(mono: Float32Array, sr: number) {
  const filtered = lowpass(mono, sr, LOWPASS_HZ, LOWPASS_Q);
  const winSize = Math.floor(sr * WIN_SEC);
  const energies: number[] = [];
  for (let i = 0; i < filtered.length; i += winSize) {
    let s = 0;
    for (let j = 0; j < winSize && i + j < filtered.length; j++) {
      s += filtered[i + j] * filtered[i + j];
    }
    energies.push(Math.sqrt(s / winSize));
  }

  const beats: { t: number; strength: number }[] = [];
  let lastBeat = -10;
  for (let i = LOOKBACK; i < energies.length - 2; i++) {
    let mean = 0;
    for (let k = i - LOOKBACK; k < i; k++) mean += energies[k];
    mean /= LOOKBACK;
    const t = (i * winSize) / sr;
    if (
      energies[i] > mean * PEAK_RATIO &&
      energies[i] > PEAK_FLOOR &&
      energies[i] >= energies[i - 1] &&
      energies[i] >= energies[i + 1] &&
      t - lastBeat > MIN_GAP
    ) {
      beats.push({
        t: Math.round(t * 1000) / 1000,
        strength: Math.round(Math.min(3, energies[i] / (mean + 0.001)) * 100) / 100,
      });
      lastBeat = t;
    }
  }
  return beats;
}

// ---- BPM estimate via inter-onset-interval histogram -----------------------
function estimateBpm(onsets: { t: number }[]): number {
  if (onsets.length < 4) return 0;
  const buckets = new Map<number, number>();
  for (let i = 1; i < onsets.length; i++) {
    const dt = onsets[i].t - onsets[i - 1].t;
    if (dt < 0.2 || dt > 1.5) continue;
    let bpm = 60 / dt;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    const key = Math.round(bpm);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let best = 0, bestN = 0;
  for (const [k, n] of buckets) if (n > bestN) { bestN = n; best = k; }
  return best;
}

// ---- WAV decoder (pure JS, exact — preferred path) -------------------------
function decodeWav(buf: ArrayBuffer): { mono: Float32Array; sr: number } {
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x52494646) throw new Error("Not RIFF/WAV");
  let offset = 12;
  let fmt: any = null;
  let dataOffset = -1, dataLen = 0;
  while (offset < dv.byteLength - 8) {
    const id = dv.getUint32(offset, false);
    const size = dv.getUint32(offset + 4, true);
    if (id === 0x666d7420) {
      fmt = {
        format: dv.getUint16(offset + 8, true),
        channels: dv.getUint16(offset + 10, true),
        sampleRate: dv.getUint32(offset + 12, true),
        bits: dv.getUint16(offset + 22, true),
      };
    } else if (id === 0x64617461) {
      dataOffset = offset + 8;
      dataLen = size;
    }
    offset += 8 + size + (size & 1);
  }
  if (!fmt || dataOffset < 0) throw new Error("WAV missing fmt/data chunk");
  const { channels, sampleRate, bits } = fmt;
  const bytesPer = bits / 8;
  const frames = Math.floor(dataLen / (bytesPer * channels));
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataOffset + (f * channels + c) * bytesPer;
      let v = 0;
      if (bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (bits === 32 && fmt.format === 3) v = dv.getFloat32(p, true);
      else if (bits === 32) v = dv.getInt32(p, true) / 2147483648;
      else if (bits === 24) {
        const b0 = dv.getUint8(p), b1 = dv.getUint8(p + 1), b2 = dv.getInt8(p + 2);
        v = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
      }
      acc += v;
    }
    mono[f] = acc / channels;
  }
  return { mono, sr: sampleRate };
}

// ---- mp3/other decode fallback (wasm) --------------------------------------
async function decodeCompressed(buf: ArrayBuffer): Promise<{ mono: Float32Array; sr: number }> {
  // audio-decode handles mp3/ogg/flac in pure wasm. m4a/aac may fail — see header note.
  const decode = (await import("https://esm.sh/audio-decode@2.2.2")).default;
  const audioBuf: any = await decode(new Uint8Array(buf));
  const sr = audioBuf.sampleRate;
  const ch0 = audioBuf.getChannelData(0);
  if (audioBuf.numberOfChannels === 1) return { mono: ch0, sr };
  const ch1 = audioBuf.getChannelData(1);
  const mono = new Float32Array(ch0.length);
  for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
  return { mono, sr };
}

async function loadPcm(wavUrl: string | null, analysisUrl: string) {
  if (wavUrl) {
    const r = await fetch(wavUrl);
    if (r.ok) {
      try { return decodeWav(await r.arrayBuffer()); }
      catch (_) { /* fall through to compressed */ }
    }
  }
  const r = await fetch(analysisUrl);
  if (!r.ok) throw new Error("Could not fetch audio: " + r.status);
  return await decodeCompressed(await r.arrayBuffer());
}

// ---- HTTP handler ----------------------------------------------------------
Deno.serve(async (req) => {
  try {
    const { track_id } = await req.json();
    if (!track_id) return json({ error: "track_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: track, error } = await supabase
      .from("radio_tracks")
      .select("id, mux_playback_id, download_wav_url")
      .eq("id", track_id)
      .single();
    if (error || !track) return json({ error: "track not found" }, 404);

    await supabase.from("radio_tracks")
      .update({ chart_status: "pending" }).eq("id", track_id);

    const analysisUrl = `https://stream.mux.com/${track.mux_playback_id}/audio.m4a`;
    const { mono, sr } = await loadPcm(track.download_wav_url ?? null, analysisUrl);

    const beats = detectOnsets(mono, sr);
    if (beats.length === 0) {
      await supabase.from("radio_tracks")
        .update({ chart_status: "failed" }).eq("id", track_id);
      return json({ error: "no beats detected" }, 422);
    }

    const duration = mono.length / sr;
    let gapSum = 0;
    for (let i = 1; i < beats.length; i++) gapSum += beats[i].t - beats[i - 1].t;

    const chart = {
      version: 1,
      analyzer: "lowpass-200hz-rms-23ms-peak1.45",
      bpm: estimateBpm(beats),
      duration: Math.round(duration * 100) / 100,
      beats,
      stats: {
        beatCount: beats.length,
        meanGap: Math.round((gapSum / Math.max(1, beats.length - 1)) * 1000) / 1000,
        peakStrength: beats.reduce((m, o) => Math.max(m, o.strength), 0),
      },
    };

    await supabase.from("radio_tracks").update({
      chart_v1: chart,
      chart_status: "ready",
      chart_analyzed_at: new Date().toISOString(),
      duration_seconds: chart.duration,
    }).eq("id", track_id);

    return json({ ok: true, track_id, beatCount: beats.length, bpm: chart.bpm });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

// =============================================================================
// BACKFILL: loop existing radio_tracks where chart_status is null, POST each id
// to this function with small concurrency (e.g. 3 at a time) overnight.
//
// IF m4a DECODE FAILS for tracks without a WAV:
//   Cleanest "identical math" fallback is a tiny Node + Playwright worker that
//   loads a headless page using the REAL Web Audio API (OfflineAudioContext) —
//   byte-for-byte the same as the browser game. Keep this edge function for the
//   WAV/mp3 majority; route m4a-only stragglers to the Playwright worker.
// =============================================================================
