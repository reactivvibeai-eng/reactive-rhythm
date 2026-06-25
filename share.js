/* =====================================================================================
   share.js — Reactive Rhythm "Signal Card" social share system  (window.RhythmShare)
   -------------------------------------------------------------------------------------
   Renders a premium, brand-locked score card (offscreen Canvas 2D @2x) -> PNG Blob,
   then shares it: native Web-Share-with-files when available (mobile / desktop Safari),
   else a brand-styled fallback panel (Download / Copy caption / Copy image / X / FB).

   Brand: BLACK · CRIMSON · CHROME · GOLD. Warm darks. NO blue/purple/green.
   Pure vanilla, no deps, no build step. game.js calls RhythmShare.shareScore(payload).
   ===================================================================================== */
(function () {
  'use strict';

  // ---- brand tokens (mirror index.html :root so the card reads as "from this game") ----
  var C = {
    bg:      '#0a0706',
    bgDeep:  '#050303',
    ink:     '#f4eef0',
    inkDim:  '#8a7f7c',
    chrome:  '#dad7d2',
    silver:  '#cbc7c2',
    crimson: '#ff1f2e',
    crimsonDeep: '#a3060f',
    gold:    '#e0a93f',
    goldHot: '#ffd27a'
  };
  var PLAY_URL = 'https://reactivvibe.com/play';

  // COMBO_TIERS mirror (game.js:187-194) — name + hue so the tier cell looks "hotter".
  var COMBO_TIERS = [
    { min: 0,   name: 'COMBO',     rgb: [255, 244, 238] },
    { min: 25,  name: 'HOT',       rgb: [255, 214, 150] },
    { min: 75,  name: 'BLAZE',     rgb: [255, 196, 96]  },
    { min: 150, name: 'GOLDEN',    rgb: [255, 226, 140] },
    { min: 300, name: 'INFERNO',   rgb: [255, 246, 236] },
    { min: 500, name: 'ASCENDANT', rgb: [255, 255, 252] }
  ];
  function comboTierIdx(c) { var i = 0; for (var k = 0; k < COMBO_TIERS.length; k++) { if (c >= COMBO_TIERS[k].min) i = k; } return i; }
  function comboTierByName(name) { for (var k = 0; k < COMBO_TIERS.length; k++) { if (COMBO_TIERS[k].name === name) return COMBO_TIERS[k]; } return COMBO_TIERS[0]; }

  // ----- small helpers --------------------------------------------------------------
  function fmt(n) { try { return (Math.round(+n || 0)).toLocaleString('en-US'); } catch (e) { return String(n || 0); } }
  function rgbStr(arr, a) { return 'rgba(' + arr[0] + ',' + arr[1] + ',' + arr[2] + ',' + (a == null ? 1 : a) + ')'; }
  function slug(s) { return String(s || 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'run'; }
  // strip control + markup chars (built from a string so NO literal control bytes live in
  // this source). A public image can't carry raw garbage.
  var CTRL_RE = new RegExp('[' + '\\u0000-\\u001f' + '<>]', 'g');
  function stripCtrl(s) { return String(s == null ? '' : s).replace(CTRL_RE, '').trim(); }
  // Mild profanity scrub (the leaderboard's cleanName isn't reachable on window; this guards
  // any name we draw onto a shareable, public image).
  var BADWORDS = ['fuck', 'shit', 'cunt', 'nigger', 'faggot', 'bitch', 'asshole', 'dick', 'pussy', 'whore', 'slut', 'rape'];
  function guardName(s) {
    var raw = stripCtrl(s);
    if (!raw) return 'PLAYER';
    var norm = raw.toLowerCase().replace(/[\s_\-.]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's').replace(/!/g, 'i');
    for (var i = 0; i < BADWORDS.length; i++) { if (norm.indexOf(BADWORDS[i]) >= 0) return 'PLAYER'; }
    return raw.slice(0, 24);
  }
  function clean(s) { return stripCtrl(s); }

  function gradeColor(g) {
    g = (g || 'D').toUpperCase();
    if (g === 'S') return C.gold;
    if (g === 'A') return C.crimson;
    if (g === 'B') return C.chrome;
    return C.inkDim; // C / D / fail
  }

  // canvas roundRect helper (avoid relying on the native one — Safari shipped it late)
  function roundRect(ctx, x, y, w, h, r) {
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + w - r.tr, y);
    ctx.arcTo(x + w, y, x + w, y + r.tr, r.tr);
    ctx.lineTo(x + w, y + h - r.br);
    ctx.arcTo(x + w, y + h, x + w - r.br, y + h, r.br);
    ctx.lineTo(x + r.bl, y + h);
    ctx.arcTo(x, y + h, x, y + h - r.bl, r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.arcTo(x, y, x + r.tl, y, r.tl);
    ctx.closePath();
  }

  // auto-fit a single line of text into maxW by shrinking the font size
  function fitFont(ctx, text, font, size, minSize, maxW) {
    var s = size;
    ctx.font = size + 'px ' + font;
    while (ctx.measureText(text).width > maxW && s > minSize) { s -= 1; ctx.font = s + 'px ' + font; }
    return s;
  }
  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  // Load an image CORS-clean with a hard timeout. Resolves null on any failure so a
  // single bad remote asset can NEVER block or taint the card.
  function loadImage(src, timeoutMs) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var img = new Image();
      var done = false;
      var finish = function (val) { if (done) return; done = true; resolve(val); };
      // same-origin assets/ never taint; remote (album art) needs the CORS attr
      if (!/^assets\//.test(src) && !/^\.\//.test(src)) img.crossOrigin = 'anonymous';
      var t = setTimeout(function () { finish(null); }, timeoutMs || 1500);
      img.onload = function () { clearTimeout(t); finish(img); };
      img.onerror = function () { clearTimeout(t); finish(null); };
      img.src = src;
    });
  }

  // =================================================================================
  // BUILD THE CARD
  // data: { score, grade, accuracy(0..100|0..1), maxCombo, notesHit, notesTotal,
  //         comboTierName, full_combo, newBest, gradeUp, song, artist, cover, diff,
  //         counts:{perfect,great,good,miss}, guitarSrc, guitarName,
  //         kind:'score'|'leaderboard'|'career'|'badge'|'tournament', rank, name, ... }
  // CAREER card (kind:'career') extra fields:
  //   { name, rankTitle, lifetimeScore, runs, bestCombo, accuracy(0..1|0..100),
  //     songs, fullCombos, badges(int), guitarSrc, guitarName }
  // 'badge'/'tournament' currently fall through to the score render (graceful default —
  // full variants are out of scope; they never throw).
  // opts: { format:'square'|'story' }
  // returns Promise<Blob> (PNG). NEVER rejects on a tainted/failed remote image — it
  // re-renders without the remote album art instead.
  // =================================================================================
  function buildShareCard(data, opts) {
    data = data || {};
    opts = opts || {};
    var format = opts.format === 'story' ? 'story' : 'square';
    var W = 1080, H = format === 'story' ? 1920 : 1080;
    var SS = 2;

    // normalize numbers (accuracy may arrive 0..1 or 0..100)
    var acc = +data.accuracy || 0; if (acc > 0 && acc <= 1.0001) acc = acc * 100;
    var nd = {
      score: Math.round(+data.score || 0),
      grade: (data.grade || 'D').toUpperCase(),
      acc: acc,
      maxCombo: Math.round(+data.maxCombo || 0),
      notesHit: Math.round(+data.notesHit || 0),
      notesTotal: Math.round(+data.notesTotal || 0),
      full_combo: !!data.full_combo,
      newBest: !!data.newBest,
      gradeUp: !!data.gradeUp,
      // a song-less leaderboard share (global rank) shows "GLOBAL RANKING" instead of a fake song
      song: clean(data.song) || (data.kind === 'leaderboard' ? 'GLOBAL RANKING' : 'LUNAR WAVES'),
      artist: clean(data.artist),
      diff: (clean(data.diff) || 'PULSE').toUpperCase(),
      counts: data.counts || null,
      guitarName: clean(data.guitarName),
      kind: data.kind || 'score',
      rank: data.rank ? Math.round(+data.rank) : 0,
      name: data.name ? guardName(data.name) : ''
    };
    // ---- CAREER snapshot fields (only used when kind:'career') — default everything sanely ----
    if (nd.kind === 'career') {
      nd.rankTitle = (clean(data.rankTitle) || 'SIGNAL INITIATE').toUpperCase();
      nd.lifetimeScore = Math.round(+data.lifetimeScore || 0);
      nd.runs = Math.round(+data.runs || 0);
      nd.bestCombo = Math.round(+data.bestCombo || 0);
      nd.songs = Math.round(+data.songs || 0);
      nd.fullCombos = Math.round(+data.fullCombos || 0);
      nd.badges = Math.round(+data.badges || 0);
      if (!nd.name) nd.name = 'PLAYER';
    }
    // ---- RANKINGS card (kind:'rankings') — hero = the player's BEST run; a gold MY-TOP-RUNS podium replaces the guitar badge ----
    if (nd.kind === 'rankings') {
      nd.topRuns = (data.runs && data.runs.length) ? data.runs.slice(0, 3).map(function (r) {
        return { score: Math.round(+r.score || 0), grade: (r.grade || 'D').toUpperCase() };
      }) : [];
      nd.totalRuns = Math.round(+data.totalRuns || 0);
      nd.songs = Math.round(+data.songs || 0);
      if (!nd.name) nd.name = 'PLAYER';
    }
    // combo tier — prefer explicit name, else derive from maxCombo
    nd.tier = data.comboTierName ? comboTierByName(String(data.comboTierName).toUpperCase()) : COMBO_TIERS[comboTierIdx(nd.maxCombo)];
    // star pips: S/A=3, B=2, C/D=1, fail=0 (matches game.js results scale)
    nd.stars = nd.grade === 'S' || nd.grade === 'A' ? 3 : (nd.grade === 'B' ? 2 : (nd.grade === 'C' || nd.grade === 'D' ? 1 : 0));

    // render with the supplied images; if export taints, retry with coverImg omitted.
    return Promise.resolve()
      .then(function () { return (document.fonts && document.fonts.ready) ? document.fonts.ready : null; })
      .then(function () {
        return Promise.all([
          loadImage(data.cover, 1500),                 // remote album art (may be null)
          loadImage(data.guitarSrc || 'assets/guitar.png', 1800) // same-origin guitar
        ]);
      })
      .then(function (imgs) {
        var coverImg = imgs[0], guitarImg = imgs[1];
        return drawToBlob(coverImg, guitarImg)
          .catch(function () {
            // tainted/failed export -> re-render WITHOUT the remote album art (placeholder).
            return drawToBlob(null, guitarImg);
          });
      });

    function drawToBlob(coverImg, guitarImg) {
      return new Promise(function (resolve, reject) {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = W * SS; canvas.height = H * SS;
          var ctx = canvas.getContext('2d');
          ctx.scale(SS, SS);
          ctx.textBaseline = 'alphabetic';
          drawCard(ctx, W, H, nd, coverImg, guitarImg);
          // a tainted canvas surfaces as a SecurityError here (sync) or a null blob in the cb
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob); else reject(new Error('toBlob null (tainted?)'));
          }, 'image/png');
        } catch (e) { reject(e); }
      });
    }
  }

  // ---------------- the actual draw routine (CSS px space) --------------------------
  function drawCard(ctx, W, H, nd, coverImg, guitarImg) {
    var story = H > 1400;
    var PAD = 64;

    // ---- BACKGROUND: warm-black + radial crimson bloom ----
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    var bloomY = H * 0.36;
    var bloom = ctx.createRadialGradient(W * 0.5, bloomY, 40, W * 0.5, bloomY, W * 0.72);
    bloom.addColorStop(0, 'rgba(120,12,20,0.55)');
    bloom.addColorStop(0.64, 'rgba(120,12,20,0.0)');
    ctx.fillStyle = bloom; ctx.fillRect(0, 0, W, H);
    // warm vignette to darken corners
    var vig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.32, W * 0.5, H * 0.5, H * 0.74);
    vig.addColorStop(0, 'rgba(5,3,3,0)');
    vig.addColorStop(1, 'rgba(5,3,3,0.85)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

    // ---- faint chrome fret-rake (5 lines, bottom-left -> top-right) ----
    ctx.save();
    ctx.strokeStyle = 'rgba(218,215,210,0.06)';
    ctx.lineWidth = 2;
    for (var i = 0; i < 5; i++) {
      var off = i * (W * 0.085);
      ctx.beginPath();
      ctx.moveTo(-W * 0.1 + off, H + 40);
      ctx.lineTo(W * 0.55 + off, -40);
      ctx.stroke();
    }
    ctx.restore();

    // ---- film grain (~3%) ----
    drawGrain(ctx, W, H, 0.03);

    // ---- FRAME: chrome inner stroke + crimson corner brackets ----
    var fx = 28, fy = 28, fw = W - 56, fh = H - 56;
    ctx.strokeStyle = 'rgba(218,215,210,0.5)';
    ctx.lineWidth = 2;
    roundRect(ctx, fx, fy, fw, fh, 18); ctx.stroke();
    drawBrackets(ctx, fx, fy, fw, fh);

    // ====================== HEADER ======================
    var hy = story ? 150 : 96;
    drawBolt(ctx, PAD, hy - 30, 34, C.crimson);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.chrome;
    ctx.font = '800 34px Unbounded';
    // letter-spaced wordmark
    drawTracked(ctx, 'REACTIVE RHYTHM', PAD + 48, hy, 3);
    ctx.fillStyle = C.silver;
    ctx.font = '600 16px "Chakra Petch"';
    drawTracked(ctx, 'REACTIVVIBE.AI', PAD + 50, hy + 26, 4);
    // right chip — BETA
    ctx.textAlign = 'right';
    var chipW = 86, chipH = 34, chipX = W - PAD - chipW, chipY = hy - 26;
    ctx.fillStyle = 'rgba(255,31,46,0.14)';
    roundRect(ctx, chipX, chipY, chipW, chipH, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,31,46,0.5)'; ctx.lineWidth = 1.5;
    roundRect(ctx, chipX, chipY, chipW, chipH, 8); ctx.stroke();
    ctx.fillStyle = C.crimson; ctx.font = '700 16px "Chakra Petch"';
    ctx.fillText('BETA', chipX + chipW - 14, chipY + 23);
    ctx.textAlign = 'left';
    // header rule
    ctx.strokeStyle = 'rgba(160,40,46,0.32)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, hy + 50); ctx.lineTo(W - PAD, hy + 50); ctx.stroke();

    // ====================== HERO ROW ======================
    var heroTop = hy + (story ? 120 : 92);
    var ringR = story ? 128 : 116;
    var ringCx = PAD + ringR + 6;
    var ringCy = heroTop + ringR;
    var career = nd.kind === 'career';
    if (career) { drawRankBadge(ctx, ringCx, ringCy, ringR, nd); }
    else { drawGradeRing(ctx, ringCx, ringCy, ringR, nd); }

    // FULL COMBO ribbon across the ring's lower third (per-run only)
    if (!career && nd.full_combo) drawRibbon(ctx, ringCx, ringCy + ringR * 0.52, ringR * 1.7, 'FULL COMBO', C.gold);
    // NEW BEST flag tab (top-right of ring) (per-run only)
    if (!career && nd.newBest) drawFlag(ctx, ringCx + ringR * 0.62, ringCy - ringR * 0.92, 'NEW BEST');

    // SCORE block to the right of the ring (label swaps to LIFETIME SCORE for a career card)
    var sx = ringCx + ringR + 56;
    var sw = W - PAD - sx;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.inkDim;
    ctx.font = '700 20px "Chakra Petch"';
    drawTracked(ctx, career ? 'LIFETIME SCORE' : (nd.kind === 'rankings' ? 'MY BEST SCORE' : 'SCORE'), sx, ringCy - ringR * 0.52, career ? 3 : 4);
    // big score number — chrome with crimson drop-glow, auto-fit to width
    var scoreStr = fmt(career ? nd.lifetimeScore : nd.score);
    var ssize = fitFont(ctx, scoreStr, 'Oxanium', story ? 110 : 100, 52, sw);
    ctx.font = '800 ' + ssize + 'px Oxanium';
    ctx.save();
    ctx.shadowColor = 'rgba(255,31,46,0.55)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 3;
    var sgrad = ctx.createLinearGradient(sx, ringCy - 60, sx, ringCy + 30);
    sgrad.addColorStop(0, '#ffffff'); sgrad.addColorStop(1, C.silver);
    ctx.fillStyle = sgrad;
    ctx.fillText(scoreStr, sx, ringCy + ssize * 0.18);
    ctx.restore();
    if (career) {
      // gold "LIFETIME" sub-tag in place of the stars/grade
      ctx.fillStyle = C.gold; ctx.font = '700 22px "Chakra Petch"';
      drawTracked(ctx, nd.runs + ' RUNS LOGGED', sx + 2, ringCy + ssize * 0.18 + 46, 2);
    } else {
      // 3 star pips under the score
      drawStars(ctx, sx, ringCy + ssize * 0.18 + 40, nd.stars, 3, 26);
      // small grade label beside stars
      ctx.fillStyle = gradeColor(nd.grade); ctx.font = '700 22px "Chakra Petch"';
      drawTracked(ctx, 'GRADE ' + nd.grade, sx + 3 * 38 + 18, ringCy + ssize * 0.18 + 49, 2);
    }

    // ====================== STAT STRIP ======================
    var stripY = heroTop + ringR * 2 + (story ? 86 : 58);
    if (career) drawCareerStrip(ctx, PAD, stripY, W - PAD * 2, nd);
    else drawStatStrip(ctx, PAD, stripY, W - PAD * 2, nd);

    // judgment proportion bar (per-run only; career + rankings cards have no per-note data → skip)
    var jbY = stripY + 116;
    if (!career && nd.kind !== 'rankings') drawJudgmentBar(ctx, PAD, jbY, W - PAD * 2, nd);

    // ====================== SONG IDENTITY + GUITAR  (career → CAREER SNAPSHOT) ====
    var lowerY = jbY + (story ? 150 : 96);
    if (story) lowerY = jbY + 200;

    if (career) {
      drawCareerSnapshot(ctx, PAD, lowerY, W, story, nd, guitarImg);
    } else {

    // album art thumb (left)
    var thumb = story ? 132 : 116;
    var tx = PAD, ty = lowerY;
    ctx.save();
    roundRect(ctx, tx, ty, thumb, thumb, 16); ctx.clip();
    if (coverImg) {
      // cover-fit
      var ir = coverImg.width / coverImg.height, dr = 1;
      var dw, dh, dx, dy;
      if (ir > dr) { dh = thumb; dw = thumb * ir; dx = tx - (dw - thumb) / 2; dy = ty; }
      else { dw = thumb; dh = thumb / ir; dx = tx; dy = ty - (dh - thumb) / 2; }
      try { ctx.drawImage(coverImg, dx, dy, dw, dh); } catch (e) { drawCoverPlaceholder(ctx, tx, ty, thumb); }
    } else {
      drawCoverPlaceholder(ctx, tx, ty, thumb);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(218,215,210,0.4)'; ctx.lineWidth = 1.5;
    roundRect(ctx, tx, ty, thumb, thumb, 16); ctx.stroke();

    // title + artist + diff chip (beside thumb)
    var infoX = tx + thumb + 26;
    var infoMaxW = (W - PAD) - infoX - (story ? 0 : 270);
    if (infoMaxW < 240) infoMaxW = 240;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.chrome;
    var titleSize = fitFont(ctx, nd.song, 'Unbounded', 34, 20, infoMaxW);
    ctx.font = '600 ' + titleSize + 'px Unbounded';
    ctx.fillText(ellipsize(ctx, nd.song, infoMaxW), infoX, ty + 36);
    if (nd.artist) {
      ctx.fillStyle = C.silver; ctx.font = '600 20px "Chakra Petch"';
      ctx.fillText(ellipsize(ctx, nd.artist, infoMaxW), infoX, ty + 64);
    }
    // difficulty chip
    var diffTxt = nd.diff.split(' — ')[0].split('—')[0].trim();
    ctx.font = '700 16px "Chakra Petch"';
    var dcW = ctx.measureText(diffTxt).width + 28;
    var dcY = ty + 84;
    ctx.fillStyle = 'rgba(255,31,46,0.12)';
    roundRect(ctx, infoX, dcY, dcW, 30, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,31,46,0.45)'; ctx.lineWidth = 1.2;
    roundRect(ctx, infoX, dcY, dcW, 30, 7); ctx.stroke();
    ctx.fillStyle = C.crimson;
    ctx.fillText(diffTxt, infoX + 14, dcY + 21);

    // ---- equipped guitar loadout (right) — OR rank plate for a leaderboard share ----
    if (nd.kind === 'leaderboard' && nd.rank) {
      drawRankPlate(ctx, W - PAD - 250, ty - 4, 250, thumb + 8, nd);
    } else if (nd.kind === 'rankings') {
      drawRankingsList(ctx, W - PAD - 268, ty - 6, 268, thumb + 12, nd.topRuns || []);
    } else {
      drawGuitarBadge(ctx, W - PAD - 200, ty - 6, 200, thumb + 12, guitarImg, nd.guitarName);
    }

    } // end per-run / leaderboard lower row (career drew its own snapshot above)

    // ====================== FOOTER CTA ======================
    var fyy = H - (story ? 150 : 86);
    ctx.textAlign = 'center';
    ctx.fillStyle = C.chrome; ctx.font = '700 26px "Chakra Petch"';
    var cta = 'PLAY FREE  →  reactivvibe.com/play';
    ctx.fillText(cta, W / 2, fyy);
    // crimson underline rule
    var ulw = ctx.measureText(cta).width;
    ctx.strokeStyle = C.crimson; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - ulw / 2, fyy + 14); ctx.lineTo(W / 2 + ulw / 2, fyy + 14); ctx.stroke();
    ctx.textAlign = 'left';
  }

  // ---- grain: cheap procedural noise rectangle ----
  function drawGrain(ctx, W, H, alpha) {
    try {
      var g = document.createElement('canvas');
      var gs = 220; g.width = gs; g.height = gs;
      var gc = g.getContext('2d');
      var id = gc.createImageData(gs, gs);
      for (var p = 0; p < id.data.length; p += 4) {
        var v = (Math.random() * 255) | 0;
        id.data[p] = id.data[p + 1] = id.data[p + 2] = v;
        id.data[p + 3] = 255;
      }
      gc.putImageData(id, 0, 0);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'overlay';
      var pat = ctx.createPattern(g, 'repeat');
      ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } catch (e) { /* grain is decorative — never fatal */ }
  }

  // ---- crimson corner brackets (HUD language) top-left + bottom-right ----
  function drawBrackets(ctx, x, y, w, h) {
    var L = 46, o = 12;
    ctx.strokeStyle = C.crimson; ctx.lineWidth = 4; ctx.lineCap = 'round';
    // top-left
    ctx.beginPath(); ctx.moveTo(x + o, y + o + L); ctx.lineTo(x + o, y + o); ctx.lineTo(x + o + L, y + o); ctx.stroke();
    // bottom-right
    ctx.beginPath(); ctx.moveTo(x + w - o, y + h - o - L); ctx.lineTo(x + w - o, y + h - o); ctx.lineTo(x + w - o - L, y + h - o); ctx.stroke();
  }

  // ---- the lightning-bolt glyph (favicon path scaled into a box) ----
  function drawBolt(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 32, size / 32);
    ctx.fillStyle = color;
    try {
      var p = new Path2D('M18 4 8 18h6l-2 10 12-16h-7l1-8z');
      ctx.shadowColor = 'rgba(255,31,46,0.6)'; ctx.shadowBlur = 14;
      ctx.fill(p);
    } catch (e) { /* Path2D unsupported — skip the glyph, never fatal */ }
    ctx.restore();
  }

  // ---- letter-spaced text helper ----
  function drawTracked(ctx, text, x, y, tracking) {
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + tracking;
    }
  }

  // ---- GRADE RING: chrome ring + scanline arc + big letter ----
  function drawGradeRing(ctx, cx, cy, r, nd) {
    var col = gradeColor(nd.grade);
    var glow = nd.grade === 'S' ? 'rgba(224,169,63,0.55)' : (nd.grade === 'A' ? 'rgba(255,31,46,0.5)' : 'rgba(218,215,210,0.3)');
    // base track
    ctx.save();
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(218,215,210,0.18)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // colored progress-ish arc (mostly full, with a gap — reads as a "scanline")
    ctx.strokeStyle = col;
    ctx.shadowColor = glow; ctx.shadowBlur = 28;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI * 0.5, Math.PI * 1.28); ctx.stroke();
    // thin inner scanline tick arc
    ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.strokeStyle = rgbStr([255, 255, 255], 0.18);
    ctx.beginPath(); ctx.arc(cx, cy, r - 14, -Math.PI * 0.5, Math.PI * 1.05); ctx.stroke();
    ctx.restore();
    // the letter
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    ctx.shadowColor = glow; ctx.shadowBlur = 24;
    ctx.font = '800 ' + Math.round(r * 1.3) + 'px Oxanium';
    ctx.fillText(nd.grade, cx, cy + r * 0.06);
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // ---- gold ribbon banner ----
  function drawRibbon(ctx, cx, cy, w, text, col) {
    var h = 40;
    ctx.save();
    ctx.fillStyle = 'rgba(224,169,63,0.16)';
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 6); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 6); ctx.stroke();
    ctx.fillStyle = col; ctx.font = '700 20px "Chakra Petch"';
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, cy + 7);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ---- NEW BEST flag tab ----
  function drawFlag(ctx, x, y, text) {
    ctx.save();
    ctx.font = '700 16px "Chakra Petch"';
    var w = ctx.measureText(text).width + 26, h = 30;
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w / 2, y + h - 9); ctx.lineTo(x, y + h); ctx.closePath();
    ctx.shadowColor = 'rgba(224,169,63,0.5)'; ctx.shadowBlur = 16; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a0d04'; ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, y + 20);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ---- star pips row ----
  function drawStars(ctx, x, y, on, total, size) {
    var gap = size + 12;
    for (var i = 0; i < total; i++) {
      var sx = x + i * gap + size / 2;
      drawStar(ctx, sx, y, size / 2, i < on);
    }
  }
  function drawStar(ctx, cx, cy, r, filled) {
    ctx.save();
    ctx.beginPath();
    for (var i = 0; i < 5; i++) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / 5;
      var ax = cx + Math.cos(a) * r, ay = cy + Math.sin(a) * r;
      var ib = a + Math.PI / 5;
      var bx = cx + Math.cos(ib) * r * 0.45, by = cy + Math.sin(ib) * r * 0.45;
      if (i === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = C.gold; ctx.shadowColor = 'rgba(224,169,63,0.6)'; ctx.shadowBlur = 12; ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(218,215,210,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 4-cell stat strip ----
  function drawStatStrip(ctx, x, y, w, nd) {
    var cells;
    if (nd.kind === 'leaderboard') {
      // build65 FIX: a WORLD-RANK card has no per-run maxCombo/notes data (rr_scores stores grade/score/accuracy only) —
      // show the player's STANDING instead of the old all-zero "MAX COMBO 0x / NOTES 0/0" strip.
      cells = [
        { label: 'WORLD RANK', val: nd.rank ? '#' + nd.rank : '—', tint: null },
        { label: 'SCORE', val: nd.score.toLocaleString(), tint: null },
        { label: 'ACCURACY', val: nd.acc > 0 ? nd.acc.toFixed(1) + '%' : '—', tint: null },
        { label: 'TOP GRADE', val: nd.grade, tint: null, valColor: gradeColor(nd.grade) }
      ];
    } else if (nd.kind === 'rankings') {
      // a MY-RANKINGS card has no per-note combo/notes data — surface the player's standing instead
      cells = [
        { label: 'ACCURACY', val: nd.acc.toFixed(1) + '%', tint: null },
        { label: 'TOP GRADE', val: nd.grade, tint: null, valColor: gradeColor(nd.grade) },
        { label: 'TOTAL RUNS', val: '' + nd.totalRuns, tint: null },
        { label: 'SONGS', val: '' + nd.songs, tint: null }
      ];
    } else {
      cells = [
        { label: 'ACCURACY', val: nd.acc.toFixed(1) + '%', tint: null },
        { label: 'MAX COMBO', val: nd.maxCombo + 'x', tint: null },
        { label: 'NOTES', val: nd.notesHit + '/' + nd.notesTotal, tint: null },
        { label: 'COMBO TIER', val: nd.tier.name, tint: nd.tier.rgb }
      ];
    }
    var n = cells.length, gap = 14, cw = (w - gap * (n - 1)) / n, ch = 88;
    for (var i = 0; i < n; i++) {
      var cxx = x + i * (cw + gap);
      // cell bg — tinted for the combo-tier cell
      if (cells[i].tint) {
        ctx.fillStyle = rgbStr(cells[i].tint, 0.1);
        roundRect(ctx, cxx, y, cw, ch, 12); ctx.fill();
        ctx.strokeStyle = rgbStr(cells[i].tint, 0.5);
      } else {
        ctx.fillStyle = 'rgba(20,12,11,0.5)';
        roundRect(ctx, cxx, y, cw, ch, 12); ctx.fill();
        ctx.strokeStyle = 'rgba(218,215,210,0.22)';
      }
      ctx.lineWidth = 1.2;
      roundRect(ctx, cxx, y, cw, ch, 12); ctx.stroke();
      // label
      ctx.fillStyle = C.inkDim; ctx.font = '600 14px "Chakra Petch"'; ctx.textAlign = 'center';
      drawTrackedCenter(ctx, cells[i].label, cxx + cw / 2, y + 28, 2);
      // value
      ctx.fillStyle = cells[i].valColor || (cells[i].tint ? rgbStr(cells[i].tint, 1) : C.chrome);
      var vsize = fitFont(ctx, cells[i].val, 'Oxanium', 34, 18, cw - 24);
      ctx.font = '700 ' + vsize + 'px Oxanium';
      ctx.fillText(cells[i].val, cxx + cw / 2, y + 68);
    }
    ctx.textAlign = 'left';
  }
  function drawTrackedCenter(ctx, text, cx, y, tracking) {
    var total = 0, i;
    for (i = 0; i < text.length; i++) total += ctx.measureText(text[i]).width + tracking;
    total -= tracking;
    var start = cx - total / 2;
    var prevAlign = ctx.textAlign; ctx.textAlign = 'left';
    for (i = 0; i < text.length; i++) { ctx.fillText(text[i], start, y); start += ctx.measureText(text[i]).width + tracking; }
    ctx.textAlign = prevAlign;
  }

  // ---- judgment proportion bar ----
  function drawJudgmentBar(ctx, x, y, w, nd) {
    var c = nd.counts;
    var segs;
    if (c) {
      segs = [
        { v: c.perfect || 0, col: '#ffffff' },
        { v: c.great || 0, col: C.gold },
        { v: c.good || 0, col: '#ff8a3c' },
        { v: c.miss || 0, col: C.crimson }
      ];
    } else {
      // derive from hit/total if per-judgment counts aren't available
      var hit = nd.notesHit, miss = Math.max(0, nd.notesTotal - nd.notesHit);
      segs = [{ v: hit, col: '#ffffff' }, { v: 0, col: C.gold }, { v: 0, col: '#ff8a3c' }, { v: miss, col: C.crimson }];
    }
    var total = 0, i;
    for (i = 0; i < segs.length; i++) total += segs[i].v;
    total = Math.max(1, total);
    var bh = 12, cur = x;
    ctx.save();
    roundRect(ctx, x, y, w, bh, 6); ctx.clip();
    ctx.fillStyle = 'rgba(20,12,11,0.7)'; ctx.fillRect(x, y, w, bh);
    for (i = 0; i < segs.length; i++) {
      var sgw = (segs[i].v / total) * w;
      ctx.fillStyle = segs[i].col;
      ctx.fillRect(cur, y, sgw, bh);
      cur += sgw;
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(218,215,210,0.18)'; ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, bh, 6); ctx.stroke();
  }

  // ---- album-art placeholder: crimson diamond motif ----
  function drawCoverPlaceholder(ctx, x, y, s) {
    ctx.fillStyle = C.bgDeep; ctx.fillRect(x, y, s, s);
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);
    ctx.rotate(Math.PI / 4);
    var d = s * 0.34;
    ctx.fillStyle = 'rgba(255,31,46,0.18)';
    ctx.fillRect(-d, -d, d * 2, d * 2);
    ctx.strokeStyle = C.crimson; ctx.lineWidth = 3;
    ctx.strokeRect(-d, -d, d * 2, d * 2);
    ctx.restore();
  }

  // ---- equipped-guitar loadout badge (angled) ----
  function drawGuitarBadge(ctx, x, y, w, h, guitarImg, name) {
    // panel
    ctx.fillStyle = 'rgba(20,12,11,0.5)';
    roundRect(ctx, x, y, w, h, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(218,215,210,0.22)'; ctx.lineWidth = 1.2;
    roundRect(ctx, x, y, w, h, 14); ctx.stroke();
    // "LOADOUT" label
    ctx.fillStyle = C.inkDim; ctx.font = '600 13px "Chakra Petch"'; ctx.textAlign = 'left';
    drawTracked(ctx, 'LOADOUT', x + 16, y + 24, 2);
    // guitar art, angled
    if (guitarImg) {
      ctx.save();
      roundRect(ctx, x, y, w, h, 14); ctx.clip();
      ctx.translate(x + w * 0.62, y + h * 0.46);
      ctx.rotate(-0.42);
      var gh = h * 1.15, gw = gh * (guitarImg.width / guitarImg.height);
      if (gw > w * 1.6) { gw = w * 1.6; gh = gw / (guitarImg.width / guitarImg.height); }
      try { ctx.drawImage(guitarImg, -gw * 0.3, -gh / 2, gw, gh); } catch (e) {}
      ctx.restore();
    }
    // name (bottom, on a scrim)
    var nm = (name || 'DEFAULT').toUpperCase();
    ctx.save();
    var grd = ctx.createLinearGradient(0, y + h - 38, 0, y + h);
    grd.addColorStop(0, 'rgba(10,7,6,0)'); grd.addColorStop(1, 'rgba(10,7,6,0.92)');
    ctx.fillStyle = grd;
    roundRect(ctx, x, y + h - 38, w, 38, { tl: 0, tr: 0, br: 14, bl: 14 }); ctx.fill();
    ctx.restore();
    ctx.fillStyle = C.gold; ctx.font = '700 15px "Chakra Petch"'; ctx.textAlign = 'left';
    ctx.fillText(ellipsize(ctx, nm, w - 24), x + 14, y + h - 14);
  }

  // ---- gold WORLD RANK plate (leaderboard share) ----
  function drawRankPlate(ctx, x, y, w, h, nd) {
    ctx.save();
    ctx.fillStyle = 'rgba(224,169,63,0.1)';
    roundRect(ctx, x, y, w, h, 14); ctx.fill();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 14); ctx.stroke();
    ctx.fillStyle = C.inkDim; ctx.font = '600 13px "Chakra Petch"'; ctx.textAlign = 'center';
    drawTrackedCenter(ctx, 'WORLD RANK', x + w / 2, y + 28, 3);
    ctx.fillStyle = C.gold; ctx.font = '800 ' + (h > 110 ? 64 : 48) + 'px Oxanium';
    ctx.shadowColor = 'rgba(224,169,63,0.5)'; ctx.shadowBlur = 18;
    ctx.fillText('#' + nd.rank, x + w / 2, y + h * 0.62);
    ctx.shadowBlur = 0;
    if (nd.name) { ctx.fillStyle = C.silver; ctx.font = '700 17px "Chakra Petch"'; ctx.fillText(ellipsize(ctx, nd.name, w - 24), x + w / 2, y + h - 16); }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ---- MY TOP RUNS podium (leaderboard 'rankings' share) — a gold-framed top-3 of the player's best scores ----
  function drawRankingsList(ctx, x, y, w, h, runs) {
    ctx.save();
    ctx.fillStyle = 'rgba(224,169,63,0.08)'; roundRect(ctx, x, y, w, h, 14); ctx.fill();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2; roundRect(ctx, x, y, w, h, 14); ctx.stroke();
    ctx.fillStyle = C.inkDim; ctx.font = '600 13px "Chakra Petch"'; ctx.textAlign = 'left';
    drawTracked(ctx, 'MY TOP RUNS', x + 16, y + 28, 3);
    var cols = [C.gold, C.silver, '#c8854f'], n = Math.min(3, runs.length), rowH = (h - 46) / 3;
    for (var i = 0; i < n; i++) {
      var r = runs[i], ry = y + 46 + i * rowH + rowH * 0.5;
      ctx.textAlign = 'left'; ctx.font = '800 18px Oxanium'; ctx.fillStyle = cols[i];
      ctx.fillText('#' + (i + 1), x + 16, ry + 6);
      ctx.font = '800 25px Oxanium'; ctx.fillStyle = C.chrome;
      ctx.fillText(fmt(r.score), x + 60, ry + 6);
      ctx.textAlign = 'right'; ctx.font = '700 17px "Chakra Petch"'; ctx.fillStyle = cols[i];
      ctx.fillText(r.grade || '', x + w - 16, ry + 5);
    }
    if (!n) { ctx.fillStyle = C.inkDim; ctx.font = '600 15px "Chakra Petch"'; ctx.textAlign = 'left'; ctx.fillText('No runs yet', x + 16, y + h / 2 + 6); }
    ctx.textAlign = 'left'; ctx.restore();
  }

  // =================================================================================
  // CAREER variant helpers (kind:'career') — reuse the same ring/strip/snapshot language
  // =================================================================================

  // ---- RANK BADGE: gold ring + a chevron crest + the rank TITLE wrapped inside it ----
  function drawRankBadge(ctx, cx, cy, r, nd) {
    var glow = 'rgba(224,169,63,0.5)';
    ctx.save();
    // base track
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(218,215,210,0.18)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // gold ring (full sweep — a "career complete" feel, not a progress arc)
    ctx.strokeStyle = C.gold;
    ctx.shadowColor = glow; ctx.shadowBlur = 28;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    // thin inner scanline tick arc
    ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.strokeStyle = rgbStr([255, 255, 255], 0.18);
    ctx.beginPath(); ctx.arc(cx, cy, r - 14, -Math.PI * 0.5, Math.PI * 1.05); ctx.stroke();
    ctx.restore();
    // gold laurel chevron above the title
    ctx.save();
    ctx.fillStyle = C.gold; ctx.shadowColor = glow; ctx.shadowBlur = 14;
    ctx.font = '800 ' + Math.round(r * 0.42) + 'px Oxanium';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', cx, cy - r * 0.42);
    ctx.restore();
    // "RANK" eyebrow + the title, auto-fit + wrapped to up to two lines inside the ring
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.inkDim; ctx.font = '600 14px "Chakra Petch"';
    drawTrackedCenter(ctx, 'RANK', cx, cy - r * 0.06, 3);
    ctx.fillStyle = C.goldHot; ctx.shadowColor = glow; ctx.shadowBlur = 16;
    var lines = wrapWords(ctx, nd.rankTitle, '800 ', 'Oxanium', r * 1.45, 18, 34, 2);
    var ly = cy + (lines.length > 1 ? r * 0.12 : r * 0.18);
    for (var i = 0; i < lines.length; i++) {
      ctx.font = '800 ' + lines.size + 'px Oxanium';
      ctx.fillText(lines[i], cx, ly + i * (lines.size + 4));
    }
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // greedily wrap up to `maxLines` lines, shrinking the font so they fit `maxW`. returns
  // the array of lines with a `.size` property (the chosen px size).
  function wrapWords(ctx, text, weight, font, maxW, minSize, startSize, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) words = [' '];
    for (var size = startSize; size >= minSize; size--) {
      ctx.font = weight + size + 'px ' + font;
      var lines = [], cur = '';
      for (var i = 0; i < words.length; i++) {
        var test = cur ? cur + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width <= maxW || !cur) cur = test;
        else { lines.push(cur); cur = words[i]; }
      }
      if (cur) lines.push(cur);
      // all words individually fit AND line count is in budget → accept
      var ok = lines.length <= maxLines;
      for (var j = 0; j < lines.length; j++) if (ctx.measureText(lines[j]).width > maxW) ok = false;
      if (ok) { lines.size = size; return lines; }
    }
    // last resort: single ellipsized line at minSize
    ctx.font = weight + minSize + 'px ' + font;
    var one = [ellipsize(ctx, String(text || ''), maxW)]; one.size = minSize; return one;
  }

  // ---- 4-cell CAREER stat strip: RUNS · BEST COMBO · ACCURACY · SONGS ----
  function drawCareerStrip(ctx, x, y, w, nd) {
    var fourth = nd.songs ? { label: 'SONGS', val: fmt(nd.songs) }
      : { label: 'FULL COMBOS', val: fmt(nd.fullCombos) };
    var cells = [
      { label: 'RUNS', val: fmt(nd.runs), tint: null },
      { label: 'BEST COMBO', val: nd.bestCombo + 'x', tint: null },
      { label: 'ACCURACY', val: nd.acc.toFixed(1) + '%', tint: null },
      { label: fourth.label, val: fourth.val, tint: COMBO_TIERS[comboTierIdx(nd.bestCombo)].rgb }
    ];
    var n = cells.length, gap = 14, cw = (w - gap * (n - 1)) / n, ch = 88;
    for (var i = 0; i < n; i++) {
      var cxx = x + i * (cw + gap);
      if (cells[i].tint) {
        ctx.fillStyle = rgbStr(cells[i].tint, 0.1);
        roundRect(ctx, cxx, y, cw, ch, 12); ctx.fill();
        ctx.strokeStyle = rgbStr(cells[i].tint, 0.5);
      } else {
        ctx.fillStyle = 'rgba(20,12,11,0.5)';
        roundRect(ctx, cxx, y, cw, ch, 12); ctx.fill();
        ctx.strokeStyle = 'rgba(218,215,210,0.22)';
      }
      ctx.lineWidth = 1.2;
      roundRect(ctx, cxx, y, cw, ch, 12); ctx.stroke();
      ctx.fillStyle = C.inkDim; ctx.font = '600 14px "Chakra Petch"'; ctx.textAlign = 'center';
      drawTrackedCenter(ctx, cells[i].label, cxx + cw / 2, y + 28, 2);
      ctx.fillStyle = cells[i].tint ? rgbStr(cells[i].tint, 1) : C.chrome;
      var vsize = fitFont(ctx, cells[i].val, 'Oxanium', 34, 18, cw - 24);
      ctx.font = '700 ' + vsize + 'px Oxanium';
      ctx.fillText(cells[i].val, cxx + cw / 2, y + 68);
    }
    ctx.textAlign = 'left';
  }

  // ---- CAREER SNAPSHOT row: name + "🏅 N badges" (left) · equipped-guitar loadout (right) ----
  function drawCareerSnapshot(ctx, PAD, lowerY, W, story, nd, guitarImg) {
    var ty = lowerY, h = story ? 132 : 116;
    var infoX = PAD;
    var infoMaxW = (W - PAD) - infoX - 230;
    if (infoMaxW < 260) infoMaxW = 260;
    ctx.textAlign = 'left';
    // eyebrow
    ctx.fillStyle = C.inkDim; ctx.font = '600 15px "Chakra Petch"';
    drawTracked(ctx, 'CAREER SNAPSHOT', infoX, ty + 14, 3);
    // player name (chrome, auto-fit)
    ctx.fillStyle = C.chrome;
    var nm = nd.name || 'PLAYER';
    var nmSize = fitFont(ctx, nm, 'Unbounded', 36, 22, infoMaxW);
    ctx.font = '600 ' + nmSize + 'px Unbounded';
    ctx.fillText(ellipsize(ctx, nm, infoMaxW), infoX, ty + 54);
    // gold "🏅 N badges" pill
    var badgeTxt = '🏅 ' + nd.badges + ' badge' + (nd.badges === 1 ? '' : 's');
    ctx.font = '700 16px "Chakra Petch"';
    var bcW = ctx.measureText(badgeTxt).width + 28;
    var bcY = ty + 74;
    ctx.fillStyle = 'rgba(224,169,63,0.12)';
    roundRect(ctx, infoX, bcY, bcW, 30, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(224,169,63,0.5)'; ctx.lineWidth = 1.2;
    roundRect(ctx, infoX, bcY, bcW, 30, 7); ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.fillText(badgeTxt, infoX + 14, bcY + 21);
    // equipped guitar loadout chip (right) — same badge as the per-run card
    drawGuitarBadge(ctx, W - PAD - 200, ty - 6, 200, h + 12, guitarImg, nd.guitarName);
  }

  // =================================================================================
  // CAPTION
  // =================================================================================
  function buildCaption(data) {
    var d = data || {};
    var acc = +d.accuracy || 0; if (acc > 0 && acc <= 1.0001) acc = acc * 100;
    var grade = (d.grade || 'D').toUpperCase();
    var song = clean(d.song) || 'a track';
    var artist = clean(d.artist);
    var score = fmt(d.score);
    var combo = Math.round(+d.maxCombo || 0);
    var fc = d.full_combo ? ' FULL COMBO 🔥' : '';
    var byline = artist ? (song + ' by ' + artist) : song;
    return 'I scored ' + score + ' (Grade ' + grade + ', ' + acc.toFixed(1) + '%, ' + combo + 'x combo' + fc + ') on ' +
      byline + ' in Reactive Rhythm 🎸 play free → ' + PLAY_URL + ' #ReactiveRhythm #ReactivVibe';
  }

  // =================================================================================
  // SHARE FLOW
  // =================================================================================
  function shareScore(data) {
    var caption = buildCaption(data);
    // Build the blob INSIDE the user gesture. navigator.share needs transient activation,
    // so we keep the promise chain tight (no extra awaits before the share() call) and call
    // share() directly off the build promise — the activation survives a microtask chain.
    return buildShareCard(data, { format: 'square' })
      .then(function (blob) {
        var file = null;
        try { file = new File([blob], 'reactive-rhythm-' + slug(data && (data.song)) + '.png', { type: 'image/png' }); } catch (e) { file = null; }
        // PRIMARY: native share sheet WITH the image
        if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          return navigator.share({ files: [file], text: caption, title: 'Reactive Rhythm' })
            .then(function () { return 'shared'; })
            .catch(function (e) {
              if (e && e.name === 'AbortError') return 'cancelled';
              openPanel(blob, caption, data);
              return 'panel';
            });
        }
        // FALLBACK: brand-styled panel
        openPanel(blob, caption, data);
        return 'panel';
      })
      .catch(function (e) {
        try { console.warn('[share] build failed', e); } catch (_) {}
        return 'error';
      });
  }

  // =================================================================================
  // FALLBACK PANEL (built dynamically, self-contained)
  // =================================================================================
  var _panelEl = null, _lastUrl = null, _escHandler = null;

  function injectPanelStyles() {
    if (document.getElementById('rr-share-style')) return;
    var css = [
      '#rr-share-panel{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;',
      'background:rgba(5,3,3,0.86);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .2s ease;font-family:"Chakra Petch",sans-serif;}',
      '#rr-share-panel.show{opacity:1;}',
      '#rr-share-card{width:min(92vw,440px);max-height:92vh;overflow-y:auto;background:linear-gradient(180deg,#160c0b,#0a0706);',
      'border:1px solid rgba(218,215,210,0.28);border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,0.7),0 0 0 1px rgba(255,31,46,0.18);',
      'padding:22px 22px 26px;transform:translateY(12px) scale(.98);transition:transform .2s ease;}',
      '#rr-share-panel.show #rr-share-card{transform:none;}',
      '#rr-share-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}',
      '#rr-share-head h3{font-family:"Unbounded",sans-serif;font-weight:800;font-size:16px;letter-spacing:.12em;color:#dad7d2;margin:0;}',
      '#rr-share-close{background:none;border:none;color:#8a7f7c;font-size:26px;line-height:1;cursor:pointer;padding:0 4px;}',
      '#rr-share-close:hover{color:#ff1f2e;}',
      '#rr-share-img{width:100%;border-radius:12px;display:block;border:1px solid rgba(218,215,210,0.2);background:#0a0706;}',
      '#rr-share-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;}',
      '.rr-sb{padding:13px 10px;border-radius:11px;border:1px solid rgba(255,42,48,0.4);background:rgba(20,6,10,0.55);',
      'color:#f4eef0;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;',
      'transition:all .15s ease;text-align:center;}',
      '.rr-sb:hover{border-color:#ff1f2e;box-shadow:0 0 16px rgba(255,42,48,0.35);}',
      '.rr-sb.gold{border-color:rgba(224,169,63,0.55);color:#e0a93f;grid-column:1 / -1;}',
      '.rr-sb.gold:hover{box-shadow:0 0 16px rgba(224,169,63,0.4);}',
      '.rr-sb.x{border-color:rgba(218,215,210,0.4);}',
      '#rr-share-cap{margin-top:14px;font-size:11px;line-height:1.5;color:#8a7f7c;text-align:center;}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'rr-share-style'; st.textContent = css;
    document.head.appendChild(st);
  }

  function closePanel() {
    if (!_panelEl) return;
    _panelEl.classList.remove('show');
    var el = _panelEl;
    setTimeout(function () { try { el.remove(); } catch (e) {} }, 220);
    _panelEl = null;
    if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
    if (_lastUrl) { try { URL.revokeObjectURL(_lastUrl); } catch (e) {} _lastUrl = null; }
  }

  function openPanel(blob, caption, data) {
    injectPanelStyles();
    if (_panelEl) closePanel();
    caption = caption || buildCaption(data);
    var url = URL.createObjectURL(blob);
    _lastUrl = url;

    var ov = document.createElement('div');
    ov.id = 'rr-share-panel';
    ov.innerHTML =
      '<div id="rr-share-card" role="dialog" aria-label="Share your score">' +
        '<div id="rr-share-head"><h3>SHARE SCORE</h3><button id="rr-share-close" aria-label="Close">×</button></div>' +
        '<img id="rr-share-img" alt="Your Reactive Rhythm score card" />' +
        '<div id="rr-share-btns">' +
          '<button class="rr-sb gold" data-act="download">⬇ DOWNLOAD PNG</button>' +
          '<button class="rr-sb" data-act="copyimg">COPY IMAGE</button>' +
          '<button class="rr-sb" data-act="copycap">COPY CAPTION</button>' +
          '<button class="rr-sb x" data-act="x">SHARE TO X</button>' +
          '<button class="rr-sb x" data-act="fb">FACEBOOK</button>' +
        '</div>' +
        '<div id="rr-share-cap">Drag the image into any post, or use a button above.</div>' +
      '</div>';
    document.body.appendChild(ov);
    _panelEl = ov;
    ov.querySelector('#rr-share-img').src = url;
    // force reflow then animate in
    void ov.offsetWidth; ov.classList.add('show');

    // backdrop + ESC close
    ov.addEventListener('click', function (e) { if (e.target === ov) closePanel(); });
    ov.querySelector('#rr-share-close').addEventListener('click', closePanel);
    _escHandler = function (e) { if (e.key === 'Escape') { e.stopPropagation(); closePanel(); } };
    document.addEventListener('keydown', _escHandler);

    var capEl = ov.querySelector('#rr-share-cap');
    function flash(msg) { var prev = capEl.textContent; capEl.textContent = msg; setTimeout(function () { if (capEl) capEl.textContent = prev; }, 1600); }

    ov.querySelector('#rr-share-btns').addEventListener('click', function (e) {
      var btn = e.target.closest('.rr-sb'); if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'download') {
        var a = document.createElement('a');
        a.href = url; a.download = 'reactive-rhythm-' + slug(data && data.song) + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        flash('Saved ✓ — attach it to your post');
      } else if (act === 'copycap') {
        copyText(caption).then(function (ok) { flash(ok ? 'Caption copied ✓' : 'Copy failed'); });
      } else if (act === 'copyimg') {
        copyImage(blob).then(function (ok) { flash(ok ? 'Image copied ✓ — paste it anywhere' : 'Copy image not supported here'); });
      } else if (act === 'x') {
        window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(caption) + '&url=' + encodeURIComponent(PLAY_URL), '_blank', 'noopener');
        flash('Your card is below — attach it on X');
      } else if (act === 'fb') {
        window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(PLAY_URL), '_blank', 'noopener');
        flash('Download the card to attach on FB');
      }
    });
  }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(function () { return true; }).catch(function () { return false; });
    }
    try {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return Promise.resolve(ok);
    } catch (e) { return Promise.resolve(false); }
  }
  function copyImage(blob) {
    try {
      if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
        var item = new ClipboardItem({ 'image/png': blob });
        return navigator.clipboard.write([item]).then(function () { return true; }).catch(function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  }

  // =================================================================================
  // EXPORTS + dev preview hook
  // =================================================================================
  window.RhythmShare = { buildShareCard: buildShareCard, shareScore: shareScore, openPanel: openPanel, buildCaption: buildCaption };

  // dev hook — build a card from mock data + drop it on the page for visual QA.
  // STRIP at content-freeze (alongside __rrDebug / __rrChartStats).
  window.__rrShare = {
    preview: function (fmt) {
      var mock = {
        score: 1284590, grade: 'S', accuracy: 98.4, maxCombo: 742,
        notesHit: 611, notesTotal: 620, comboTierName: 'ASCENDANT', full_combo: true,
        newBest: true, gradeUp: true, song: 'Lunar Waves', artist: 'ReactivVibe',
        cover: null, diff: 'FRACTURE', counts: { perfect: 540, great: 60, good: 11, miss: 0 },
        guitarSrc: 'assets/guitar.png', guitarName: 'Alarm Clock Hero', kind: 'score'
      };
      return buildShareCard(mock, { format: fmt === 'story' ? 'story' : 'square' }).then(function (blob) {
        var img = new Image();
        img.src = URL.createObjectURL(blob);
        img.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;width:300px;border:2px solid #ff1f2e;box-shadow:0 0 40px #000;';
        img.id = '__rrSharePreview';
        var old = document.getElementById('__rrSharePreview'); if (old) old.remove();
        document.body.appendChild(img);
        return { ok: true, size: blob.size, format: fmt || 'square' };
      });
    },
    panel: function () { return shareScore({ score: 998877, grade: 'A', accuracy: 91.2, maxCombo: 318, notesHit: 410, notesTotal: 440, comboTierName: 'INFERNO', full_combo: false, newBest: false, song: 'Test Track', artist: 'Demo', diff: 'PULSE', guitarSrc: 'assets/guitar.png', guitarName: 'Default' }); },
    // career-recap variant preview
    career: function (fmt) {
      var mock = {
        kind: 'career', name: 'RyoMain', rankTitle: 'RIFT WALKER', lifetimeScore: 4820000,
        runs: 142, bestCombo: 880, accuracy: 0.94, songs: 73, fullCombos: 18, badges: 9,
        guitarSrc: 'assets/guitar.png', guitarName: 'Deadkin'
      };
      return buildShareCard(mock, { format: fmt === 'story' ? 'story' : 'square' }).then(function (blob) {
        var img = new Image();
        img.src = URL.createObjectURL(blob);
        img.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;width:300px;border:2px solid #e0a93f;box-shadow:0 0 40px #000;';
        img.id = '__rrSharePreview';
        var old = document.getElementById('__rrSharePreview'); if (old) old.remove();
        document.body.appendChild(img);
        return { ok: true, size: blob.size, format: fmt || 'square' };
      });
    }
  };
})();
