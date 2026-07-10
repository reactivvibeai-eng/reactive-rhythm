// ===========================================================================
// Reactive Rhythm — Library UI (jukebox coverflow + browse + songs)
// Renders on top of the catalog data layer (window.RhythmCatalog). Mobile-first,
// swipe-driven, virtualized so it stays smooth at 1000+ songs.
// ===========================================================================
(() => {
  const $ = (id) => document.getElementById(id);
  const RC = () => window.RhythmCatalog;

  // ---- on-brand cover palettes (crimson / oxblood / ember / chrome) ----
  const COVER_PAL = [
    ['#c2182a', '#1e0407'], // crimson
    ['#8e0f1c', '#150305'], // oxblood
    ['#5f1122', '#11040a'], // wine
    ['#b5701a', '#1d1205'], // ember gold
    ['#4a463f', '#16120e'], // chrome slate — build65: warmed (was #414b59/#0e1116, cool blue-grey = brand "reads-purple" violation; now R>=G>=B)
    ['#9a1530', '#14040c'], // crimson-violet
    ['#7a0d16', '#170306'], // deep blood
  ];
  function pal(seed) { return COVER_PAL[RC().hashStr(seed) % COVER_PAL.length]; }
  function setPal(el, seed) { const p = pal(seed); el.style.setProperty('--c1', p[0]); el.style.setProperty('--c2', p[1]); }
  function gradeClass(g) { return 'g-' + (g || 'D'); }
  function initial(s) { return (s || '?').trim().charAt(0).toUpperCase(); }
  // D1 (ratings): compact community-rating chip (★ 4.2, gold) for song rows. DEFENSIVE — reads
  // t.rating_avg / t.rating_count off the track (absent until the backend ships → returns null). Shows ONLY
  // at rating_count >= 3 (below threshold: nothing — no "no ratings" noise, no cold-start shame).
  function ratingChip(t) {
    try {
      var avg = Number(t && t.rating_avg), cnt = Number(t && t.rating_count);
      if (!isFinite(avg) || !isFinite(cnt) || cnt < 3) return null;
      var el = document.createElement('span');
      el.className = 'sc-rating';
      el.style.cssText = 'display:inline-flex;align-items:center;gap:2px;font-family:Oxanium,sans-serif;font-size:11px;font-weight:600;color:#e0a93f;letter-spacing:0.02em;';
      el.textContent = '★ ' + avg.toFixed(1);
      return el;
    } catch (e) { return null; }
  }
  // Backend-supplied image URLs (album cover_url is user-authored) → only allow http(s)/protocol-relative,
  // strip control chars, and escapeHtml for safe interpolation into an src="..." attribute. Blocks
  // javascript:/data: scheme injection. Empty → '' (caller renders a fallback tile). Mirrors multiplayer.js safeUrl.
  function safeUrl(u) {
    var s = String(u == null ? '' : u).replace(/[\s"'<>\`]/g, '').trim();
    if (!s) return '';
    if (/^(https?:)?\/\//i.test(s) || s.charAt(0) === '/') return RC().escapeHtml(s);
    return '';   // reject javascript:, data:, and any other non-http scheme
  }

  // =========================================================================
  // RETENTION / DISCOVERY RENDERING (Wave 2) — renders the derived read-only
  // getters Wave 1 added to RhythmCatalog (forYouTracks / freshSince / dailyPicks /
  // getCollectionStats / chaseTheS + getBest). HARD RULE: every shelf/card here
  // HIDES when its getter is empty, and every read is guarded, so a brand-new
  // player (no history) sees nothing extra. Gold ♔ is the one sanctioned
  // non-crimson accent (owner-ratified via the Golden-Buzzer / green-fret precedent).
  // =========================================================================
  // day-key helpers — MATCH goals.js/catalog.js exactly (YYYY-MM-DD, prefers RC().dailyRiftToday()).
  function _todayKey() {
    try { if (RC().dailyRiftToday) return RC().dailyRiftToday(); } catch (e) {}
    var d = new Date(), mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
  function _prevKey(k) {
    try { var p = String(k || '').split('-'); var d = new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); d.setDate(d.getDate() - 1);
      var mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2); return d.getFullYear() + '-' + mm + '-' + dd; }
    catch (e) { return null; }
  }
  // "away N days / hours" phrasing from lastVisitAgeHours() (null → '').
  function _agoPhrase(h) {
    if (h == null || !isFinite(h)) return '';
    if (h < 1) return 'Just now';
    if (h < 24) { var n = Math.round(h); return 'Away ' + n + (n === 1 ? ' hour' : ' hours'); }
    var d = Math.round(h / 24); return 'Away ' + d + (d === 1 ? ' day' : ' days');
  }

  // ---- Near-miss micro-tags (#17): candidate SET from chaseTheS (played-but-not-S),
  // LABEL/threshold from getBest. Rebuilt per songs/shelf render; empty for a new player. ----
  var nearMiss = {};   // trackId(str) -> 'SO CLOSE' | '1 TO S'
  function _nearMissTag(best) {
    if (!best || best.grade === 'S') return '';
    var acc = (typeof best.accuracy === 'number') ? best.accuracy : 0;   // 0..1
    if (acc >= 0.97) return 'SO CLOSE';       // a handful of notes from a clean run
    if (best.grade === 'A') return '1 TO S';  // one grade below S
    return '';
  }
  function rebuildNearMiss() {
    nearMiss = {};
    try {
      var list = RC().chaseTheS ? (RC().chaseTheS(80) || []) : [];
      for (var i = 0; i < list.length; i++) {
        var t = list[i]; if (!t || t.id == null) continue;
        var tag = _nearMissTag(RC().getBest(t.id)); if (tag) nearMiss[String(t.id)] = tag;
      }
    } catch (e) {}
  }

  // =========================================================================
  // VIEW NAVIGATION
  // =========================================================================
  let songsReturn = 'jukebox';
  function showView(name) {
    ['jukebox', 'browse', 'songs', 'credits'].forEach(v => {
      const el = $('view-' + v);
      if (!el) return;
      el.classList.toggle('active', v === name);
      el.classList.toggle('behind', v !== name && v === 'jukebox');
    });
    if (name === 'jukebox') { startLoop(); RC().stopPreview && RC().stopPreview(); settlePreview(); }
  }

  // =========================================================================
  // JUKEBOX COVERFLOW
  // =========================================================================
  const POOL = 13, HALF = 6;
  // build100o: covers are full-res ~1MB+ PNGs on Supabase Storage → too heavy for a coverflow/grid (they load slowly,
  // leaving the green palette placeholder showing). Rewrite the Storage object URL to the image-TRANSFORM endpoint with a
  // width cap so each cover is a fast thumbnail. Non-Supabase / non-storage URLs pass through untouched; an onerror at the
  // call site falls back to the original full URL, then to branded art. (Backend should ship a real thumbnail_url too.)
  // build146 FIX (Golden Buzzer "broken thumbnails"): passing ONLY `width` to Supabase's render endpoint does NOT scale
  // proportionally — it returns width×ORIGINAL-height, i.e. the art horizontally SQUISHED (a 1254² cover → 400×1254, a
  // 3500² submission → 400×3500). object-fit:cover can't undo a squish, so every cover rendered as a narrow, zoomed,
  // "broken"-looking slice — worst on the large / non-square user-submission art that dominates the GB winners shelf.
  // Pin BOTH dims + resize=cover so the endpoint returns a proper SQUARE, center-cropped thumbnail (the art boxes are
  // all square) — and, as a bonus, a cheap fixed-size render (a huge 3500² source no longer transcodes to 400×3500).
  function thumb(url, w) {
    try {
      if (!url || typeof url !== 'string') return url || '';
      if (/supabase\.co\/storage\/v1\/object\/public\//.test(url)) {
        var s = (w || 360);
        return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + (url.indexOf('?') >= 0 ? '&' : '?') + 'width=' + s + '&height=' + s + '&resize=cover&quality=72';
      }
    } catch (e) {}
    return url;
  }
  let stage, jukebox, covers = [];
  let jbList = [], sectionKey = 'new';   // open on the freshest (most recently added) music
  let pos = 0, target = 0, raf = 0, dragging = false, down = false, startX = 0, startPos = 0, justDragged = 0;
  let cv = 240; // cover size px

  function computeCv() {
    const r = jukebox.getBoundingClientRect();
    cv = Math.max(140, Math.min(330, Math.min(r.width * 0.62, r.height * 0.46)));
    stage.style.setProperty('--cv', cv + 'px');
    covers.forEach(c => c.el.style.setProperty('--cv', cv + 'px'));
  }

  function buildPool() {
    stage.innerHTML = '';
    covers = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'jb-cover';
      el.style.setProperty('--cv', cv + 'px');
      el.innerHTML =
        '<div class="cover-grade"></div>' +
        '<div class="cover-badges"></div>' +
        '<div class="cover-card"><div class="cover-art"></div><span class="cover-mark"></span></div>' +
        '<div class="cover-reflect"></div>';
      el.addEventListener('click', () => {
        if (Date.now() - justDragged < 220) return;
        const idx = +el.dataset.idx;
        if (isNaN(idx) || idx < 0 || idx >= jbList.length) return;
        if (idx === Math.round(pos)) RC().openSheet(jbList[idx]);
        else { goTo(idx); }
      });
      stage.appendChild(el);
      covers.push({ el, idx: -999 });
    }
  }

  function fillCover(c, idx) {
    if (c.idx === idx) return;
    c.idx = idx;
    const el = c.el;
    const t = jbList[idx];
    if (!t) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.dataset.idx = idx;
    el.classList.toggle('not-ready', !RC().trackReady(t));   // build58: dim covers that can't play yet (the status CSS existed but was never wired)
    const card = el.querySelector('.cover-card');
    const refl = el.querySelector('.cover-reflect');
    setPal(card, t.id);
    setPal(refl, t.id);
    const art = el.querySelector('.cover-art');
    const mark = el.querySelector('.cover-mark');
    if (t.artwork_url) {
      let im = art.querySelector('img');
      if (!im) { im = document.createElement('img'); art.appendChild(im); }
      art.style.display = ''; mark.textContent = '';
      // build100o: load a fast thumbnail; on failure fall back to the original full URL, then to the branded initial
      // (never leave the bare green palette showing). Tracks the failed URL on the element so we only retry once.
      // build147: compute the thumb URL ONCE and only attempt the "retry full URL" step when it actually DIFFERS from the
      // original. A non-Supabase cover passes through thumb() unchanged, so the old retry re-assigned the SAME already-
      // failed URL — Chrome never re-fires onerror on an identical failed src → a stranded broken-image ghost (the owner's
      // report). When the thumb can't differ, fall straight through to the branded initial tile. Supabase covers (thumb
      // always rewrites → _tu differs) keep the exact prior thumbnail→full→initial behavior.
      const _tu = thumb(t.artwork_url, 400);
      im.onerror = function () { if (im.dataset.full !== '1' && _tu !== t.artwork_url) { im.dataset.full = '1'; im.src = t.artwork_url; } else { im.onerror = null; im.remove(); mark.textContent = initial(t.title); } };
      im.dataset.full = ''; im.src = _tu;
      let ri = refl.querySelector('img'); if (!ri) { ri = document.createElement('img'); refl.appendChild(ri); }
      ri.onerror = function () { if (ri.dataset.full !== '1' && _tu !== t.artwork_url) { ri.dataset.full = '1'; ri.src = t.artwork_url; } else { ri.onerror = null; ri.remove(); } };   // reflection: same guard; on total failure drop it (the .cover-reflect palette shows through — no branded tile needed)
      ri.dataset.full = ''; ri.src = _tu;
    } else { art.innerHTML = ''; mark.textContent = initial(t.title); refl.innerHTML = ''; }
    // grade chip
    const best = RC().getBest(t.id);
    const gc = el.querySelector('.cover-grade');
    if (best) { gc.style.display = 'flex'; gc.textContent = best.grade; gc.className = 'cover-grade ' + gradeClass(best.grade); }
    else gc.style.display = 'none';
    // R-3 mastery crown: an S-grade best earns a gold ♔ over the grade chip. Pooled/recycled covers →
    // toggle a class (the crown is a pure-CSS ::after, so it add/removes with the class — no stray node).
    el.classList.toggle('mastered', !!(best && best.grade === 'S'));
    // AI-radio badges (Golden Buzzer / judge grade / hot) — from the backend `badges` field (BADGES_BACKEND_BRIEF.md).
    // Renders nothing until the backend ships the field; chips are built as DOM nodes (textContent → injection-safe).
    const bc = el.querySelector('.cover-badges');
    if (bc) {
      bc.innerHTML = '';
      const badges = Array.isArray(t.badges) ? t.badges.slice() : [];
      // D1 (ratings): the community rating rides the EXISTING badges pipeline as {type:'rating',avg,count} (n>=3),
      // reusing the chip layout — no new system. Prepend onto a COPY (never mutate t.badges — covers are pooled/re-filled).
      { const _ra = Number(t.rating_avg), _rn = Number(t.rating_count);
        if (isFinite(_ra) && isFinite(_rn) && _rn >= 3) badges.unshift({ type: 'rating', avg: _ra, count: _rn }); }
      badges.slice(0, 3).forEach(b => {
        if (!b || !b.type) return;
        const chip = document.createElement('span');
        let cls = 'cbadge', txt = '';
        if (b.type === 'golden_buzzer') { return; }   /* Golden Buzzer now has its OWN dedicated treatment (ring/crown/tag below) driven by the golden_buzzer field — skip the badges-array chip so there's one source of truth, no double-mark */
        else if (b.type === 'rating') { cls += ' rating'; txt = '★ ' + (isFinite(Number(b.avg)) ? Number(b.avg).toFixed(1) : ''); chip.style.color = '#e0a93f'; chip.style.fontWeight = '600'; }
        else if (b.type === 'judge_grade') { cls += ' jg ' + gradeClass(b.tier); txt = b.tier || b.label || ''; }
        else if (b.type === 'hot') { cls += ' hot'; txt = b.label || 'HOT'; }
        else { cls += ' pick'; txt = b.label || ''; }
        chip.className = cls; chip.textContent = txt;
        bc.appendChild(chip);
      });
      bc.style.display = bc.children.length ? 'flex' : 'none';
    }
    // GOLDEN BUZZER winner treatment — driven by the dedicated golden_buzzer backend flag (NOT the badges array).
    // Idempotent + reversible: covers are pooled/recycled, so both add AND remove branches are required.
    const gbWin = !!RC().goldenBuzzer(t);
    el.classList.toggle('gb-winner', gbWin);
    let crown = card.querySelector('.gb-crown');
    if (gbWin && !crown) {
      crown = document.createElement('span'); crown.className = 'gb-crown'; crown.textContent = '♔'; crown.setAttribute('aria-hidden', 'true');   // ♔ decorative (the gb-tag carries the readable label)
      const tag = document.createElement('span'); tag.className = 'gb-tag'; tag.textContent = 'Golden Buzzer Winner';
      card.appendChild(crown); card.appendChild(tag);
    } else if (!gbWin && crown) {
      crown.remove(); const tg = card.querySelector('.gb-tag'); if (tg) tg.remove();   // recycled onto a non-winner → strip stale crown/tag
    }
  }

  function layout() {
    // true cylindrical carousel — covers arc around a vertical axis (a track wheel)
    const R = cv * 2.35;                          // cylinder radius
    const ANG = 33 * Math.PI / 180;               // angular spacing per cover
    const base = Math.round(pos) - HALF;
    for (let i = 0; i < POOL; i++) {
      const idx = base + i;
      const c = covers[i];
      if (idx < 0 || idx >= jbList.length) { c.el.style.display = 'none'; c.idx = -999; continue; }
      fillCover(c, idx);
      const a = idx - pos;                         // signed offset from center
      const theta = a * ANG;
      const aa = Math.abs(a);
      const x = Math.sin(theta) * R;
      const z = Math.cos(theta) * R - R;           // center at z=0, sides recede
      const rotY = -theta * 180 / Math.PI;         // each cover faces out from the wheel
      const scale = 1 - Math.min(aa, 3) * 0.04;    // gentle near-far size cue
      const el = c.el;
      el.style.transform = 'translateX(' + x.toFixed(1) + 'px) translateZ(' + z.toFixed(1) + 'px) rotateY(' + rotY.toFixed(1) + 'deg) scale(' + scale.toFixed(3) + ')';
      el.style.zIndex = String(300 - Math.round(aa * 10));
      // depth fade + darken toward the rim of the wheel
      const fade = aa > 4.2 ? 0 : aa > 3.2 ? (4.2 - aa) : 1;
      el.style.opacity = fade.toFixed(2);
      el.style.filter = aa > 0.5 ? 'brightness(' + Math.max(0.42, 1 - (aa - 0.5) * 0.2).toFixed(2) + ')' : 'brightness(1)';
      el.classList.toggle('is-center', Math.round(pos) === idx);
    }
    updateMeta();
  }

  function updateMeta() {
    const t = jbList[Math.round(pos)];
    if (!t) return;
    const meta = document.querySelector('.jb-meta');
    if (meta) { meta.style.animation = 'none'; void meta.offsetWidth; meta.style.animation = 'metaFade 0.4s ease'; }
    $('jb-title').textContent = t.title || '';
    $('jb-artist').textContent = t.artist_name || '';
    const bits = [RC().cleanGenre(t.genre), t.bpm ? t.bpm + ' BPM' : '', RC().fmtDur(t.duration_seconds)].filter(Boolean);
    const best = RC().getBest(t.id);
    // build147: a Daily-Rift best names its tier (e.g. "BEST S · 812,400 · RIFT") so it reads as the brag it is.
    if (best) bits.push('BEST ' + best.grade + ' · ' + Number(best.score).toLocaleString() + (best.difficulty === 'rift' ? ' · RIFT' : ''));
    $('jb-tags').textContent = bits.join('   ·   ');
    $('jb-pos').textContent = (Math.round(pos) + 1) + ' / ' + jbList.length;
    // Play button reflects whether the centered track is game-ready
    const playBtn = $('jb-play');
    if (playBtn) {
      const ready = RC().trackReady(t);
      playBtn.classList.toggle('disabled', !ready);
      playBtn.innerHTML = ready
        ? 'Play <span style="font-size:13px;">▸</span>'
        : RC().statusLabel(RC().trackStatus(t));
    }
  }

  let settleTimer = 0;
  function settlePreview() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const t = jbList[Math.round(pos)];
      if (t && $('view-jukebox').classList.contains('active') && $('menu').classList.contains('active')) RC().preview(t);
    }, 650);
  }

  // build158: HUB BED — a low warm ambient loop under the library so the lobby isn't silent. It NEVER competes
  // with audio: audible only while a library view (jukebox/browse/songs) is the active screen; ducks to ZERO the
  // instant a cover preview plays (RC().previewPlaying) or a run starts (the #menu shell loses .active); silent when
  // muted. A light 400ms poll drives it off live DOM state so it can't miss a screen transition; the volume eases.
  var _hubEl = null, _hubTimer = 0, HUB_VOL = 0.16;
  function _hubAudio() {
    if (_hubEl === null) {
      try { _hubEl = new Audio('assets/hub-embers.mp3'); _hubEl.loop = true; _hubEl.preload = 'auto'; _hubEl.volume = 0; }
      catch (e) { _hubEl = false; }   // false = no <audio> support → give up permanently
    }
    return _hubEl || null;
  }
  function _hubInLibrary() {
    var menu = $('menu');
    if (!(menu && menu.classList.contains('active'))) return false;   // a run / other shell is live, not the library
    return ['view-jukebox', 'view-browse', 'view-songs'].some(function (id) { var el = $(id); return el && el.classList.contains('active'); });
  }
  function _hubTarget() {
    if (!_hubInLibrary()) return 0;
    try { if (window.RhythmGame && RhythmGame.isMuted && RhythmGame.isMuted()) return 0; } catch (e) {}
    try { if (RC().previewPlaying && RC().previewPlaying()) return 0; } catch (e) {}   // a cover preview owns the audio → duck fully
    return HUB_VOL;
  }
  function _hubTick() {
    var el = _hubAudio(); if (!el) return;
    var tgt = _hubTarget();
    var v = el.volume, nv = v + (tgt - v) * 0.16; if (Math.abs(nv - tgt) < 0.004) nv = tgt;
    try { el.volume = Math.max(0, Math.min(1, nv)); } catch (e) {}
    if (tgt > 0 && el.paused) { el.play().catch(function () {}); }               // resume when it should be audible (autoplay unlocks after the first menu gesture)
    else if (tgt === 0 && !el.paused && el.volume <= 0.006) { try { el.pause(); } catch (e) {} }   // fully faded → stop the element
  }
  function startHubBed() { if (!_hubTimer) { try { _hubTimer = setInterval(_hubTick, 400); } catch (e) {} } }

  // Direct positioning — pos is ALWAYS an exact integer when idle (no drift,
  // always locked). CSS transitions on .jb-cover animate the movement. No RAF.
  function goTo(idx) {
    idx = Math.max(0, Math.min(jbList.length - 1, idx));
    const prev = Math.round(pos);
    if (idx !== prev) {
      // strong directional swipe: blur the neighbours + "whip" the whole wheel
      const dir = idx > prev ? 1 : -1;
      stage.classList.add('moving');
      stage.classList.toggle('whip-left', dir < 0);
      stage.classList.toggle('whip-right', dir > 0);
      clearTimeout(_moveT);
      _moveT = setTimeout(() => stage.classList.remove('moving', 'whip-left', 'whip-right'), 480);
    }
    pos = idx; target = idx;
    layout();
    settlePreview();
  }
  let _moveT = 0;
  function startLoop() { layout(); }   // kept for existing callers

  function setSection(key) {
    sectionKey = key;
    jbList = RC().sections()[key] || [];
    try { console.warn('[jb] section', key, '→', jbList.length, 'songs; first:', jbList.slice(0, 3).map(function (t) { return t && t.title; })); } catch (e) {}   // build100o: live diagnostic — confirms tab switching changes the rail (vs slow covers masking it)
    try { var _ac = $('jb-allcount'); if (_ac) { var _n = (RC().allTracks() || []).length; _ac.textContent = _n ? ' · ' + _n : ''; } } catch (e) {}
    // build96 (playtest): surface AI FLIXS as a first-class jukebox button (was only buried inside Browse → owner couldn't find it)
    try { var _fx = $('jb-flixs'), _fc = $('jb-flixscount'), _nv = (RC().videoCount ? RC().videoCount() : 0); if (_fx) _fx.hidden = !_nv; if (_fc) _fc.textContent = _nv ? ' · ' + _nv : ''; } catch (e) {}
    pos = 0; target = 0;
    // build100q FIX: invalidate the cover cache so the new section's songs actually paint. fillCover early-returns when
    // c.idx === idx; switching a tab resets pos→0, so the center cover keeps idx 0 and fillCover SKIPS it → the rail
    // showed the OLD section's covers until you dragged left/right (which forced a different idx). Force a full re-fill.
    covers.forEach(function (c) { c.idx = -999; });
    [...$('jb-tabs').children].forEach(b => { var on = b.dataset.sec === key; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });   // build71: keep ARIA tab state in sync (role=tablist/tab markup in index.html)
    layout(); settlePreview();
  }

  function bindJukebox() {
    jukebox.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.jb-nav')) return;   // let the arrow buttons get their click
      down = true; dragging = false; startX = e.clientX; startPos = pos;
      stage.classList.add('dragging');
      RC().stopPreview && RC().stopPreview();
      try { jukebox.setPointerCapture(e.pointerId); } catch (err) {}
    });
    jukebox.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 6) dragging = true;
      if (dragging) { pos = Math.max(-0.5, Math.min(jbList.length - 0.5, startPos - dx / (cv * 1.1))); layout(); }
    });
    const end = () => {
      if (!down) return; down = false;
      stage.classList.remove('dragging');
      if (dragging) { justDragged = Date.now(); goTo(Math.round(pos)); }
    };
    jukebox.addEventListener('pointerup', end);
    jukebox.addEventListener('pointercancel', end);
    jukebox.addEventListener('pointerleave', end);
    window.addEventListener('keydown', (e) => {
      if (!$('view-jukebox').classList.contains('active') || !$('menu').classList.contains('active')) return;
      // build65 (cycle-5): the header SEARCH input lives in the always-visible lib-bar, so view-jukebox stays .active while
      // you type — without this guard, ArrowLeft/Right rotated the coverflow and Enter opened the centered song's sheet
      // mid-search. Skip the rail keys whenever a text field is focused (the same exemption the rest of the app uses).
      const ae = document.activeElement;
      if (ae && /^(input|textarea|select)$/i.test(ae.tagName)) return;
      if (e.key === 'ArrowLeft') { goTo(Math.round(pos) - 1); }
      else if (e.key === 'ArrowRight') { goTo(Math.round(pos) + 1); }
      else if (e.key === 'Enter') { const t = jbList[Math.round(pos)]; if (t) RC().openSheet(t); }
    });
  }

  // =========================================================================
  // BROWSE (genre + artist tiles)
  // =========================================================================
  // The data layer stores the catch-all genre literally as "Other"; we DISPLAY
  // it as "Uncategorized" and pin it last, but still query byGenre('Other').
  const UNCAT_GENRE = 'Other';       // real genre string in the track data
  const UNCAT_LABEL = 'Uncategorized'; // friendlier display label

  function renderBrowse() {
    renderRetentionShelves();   // Wave 2: For You / Fresh / Daily shelves at the top (each hides when its getter is empty)
    // ---- genres: count desc, Uncategorized pinned LAST ----
    const all = RC().genreList().slice();
    const uncat = [], named = [];
    all.forEach(g => { (g.name === UNCAT_GENRE ? uncat : named).push(g); });
    named.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const genres = named.concat(uncat);   // Uncategorized always at the end

    // ---- top-genres quick-pick strip (top 5 by count, skip Uncategorized) ----
    renderTopGenreStrip(named.slice(0, 5));

    const gg = $('genre-grid'); gg.innerHTML = '';
    // ---- GOLDEN BUZZER WINNERS — flagship gold hero (full-width), pinned ABOVE Flixs + the genres.
    // Shown ONLY when the backend has flagged winners (goldenBuzzerTracks() → [] stays hidden → Browse renders
    // normally). Mirrors the .flixs-hero-card structure but gold-dominant + a crown motif (distinct from Flixs). ----
    const gbWinners = RC().goldenBuzzerTracks ? RC().goldenBuzzerTracks() : [];
    const nGb = gbWinners.length;
    if (nGb > 0) {
      const gt = document.createElement('button');
      gt.className = 'gb-hero-card';
      gt.innerHTML =
        '<span class="fh-grain" aria-hidden="true"></span>' +
        '<span class="gbh-bloom" aria-hidden="true"></span>' +
        '<span class="fh-ic gbh-ic" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M4 8l4 3 4-6 4 6 4-3-1.6 10.5H5.6L4 8z"></path>' +
            '<path d="M5.6 18.5h12.8"></path>' +
          '</svg>' +
        '</span>' +
        '<span class="fh-txt">' +
          '<span class="fh-kicker gbh-kicker"><b>♔</b> CHAMPIONS · GOLDEN BUZZER</span>' +
          '<span class="fh-badge gbh-badge">GOLDEN BUZZER WINNERS</span>' +
          '<span class="fh-sub">The tracks that earned the golden buzzer</span>' +
        '</span>' +
        '<span class="fh-cta" aria-hidden="true">' +
          '<span class="fh-count">' + nGb + ' winner' + (nGb !== 1 ? 's' : '') + '</span>' +
          '<span class="fh-go gbh-go">▶</span>' +
        '</span>';
      gt.addEventListener('click', () => openSongs(RC().goldenBuzzerTracks(), 'Golden Buzzer Winners', 'browse'));
      gg.appendChild(gt);
    }
    // ---- AI FLIXS — cinematic hero entry (full-width), grouped OUT of the music genres ----
    const nVid = RC().videoCount ? RC().videoCount() : 0;
    if (nVid > 0) {
      const vt = document.createElement('button');
      vt.className = 'flixs-hero-card';
      vt.innerHTML =
        '<span class="fh-grain" aria-hidden="true"></span>' +
        '<span class="fh-bloom" aria-hidden="true"></span>' +
        '<span class="fh-ic" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="2.5" y="6.5" width="19" height="13" rx="2"></rect>' +
            '<path d="M2.5 6.5l3.4-3.2 3.1 3.2M9 6.5l3.4-3.2 3.1 3.2M15.5 6.5l3.4-3.2 3.1 3.2"></path>' +
          '</svg>' +
        '</span>' +
        '<span class="fh-txt">' +
          '<span class="fh-kicker"><b>●</b> FLAGSHIP · NOW SHOWING</span>' +
          '<span class="fh-badge">AI FLIXS</span>' +
          '<span class="fh-sub">Play Guitar Hero to real music videos &amp; AI films</span>' +
        '</span>' +
        '<span class="fh-cta" aria-hidden="true">' +
          '<span class="fh-count">' + nVid + ' film' + (nVid !== 1 ? 's' : '') + '</span>' +
          '<span class="fh-go">▶</span>' +
        '</span>';
      // 6th arg = posterMode (poster grid); scope defaults to 'flixs' (videos-only) from isVid
      vt.addEventListener('click', () => openSongs(RC().videoTracks(), 'AI Flixs', 'browse', '', true, true));
      gg.appendChild(vt);
    }
    // ---- ALBUM RELEASES — the platform's weekly release parties, below the two heroes + above the genres.
    // Shown ONLY when the backend returns >=1 party with a loaded/launchable track (releaseParties() → [] stays
    // hidden until the /release-parties route exists → Browse renders normally). A full-width labeled row of album
    // cards that scrolls HORIZONTALLY (its own overflow-x container — the page never scrolls sideways). Every
    // backend string (album_title, artist_display_name) is escaped and every cover_url is safeUrl'd — they are
    // user-authored. Click → openSongs(albumTracks(id), album_title, 'browse'). ----
    const parties = RC().releaseParties ? RC().releaseParties() : [];
    if (parties.length) {
      const sec = document.createElement('div');
      sec.className = 'album-shelf';
      const head = document.createElement('div');
      head.className = 'album-shelf-head';
      head.innerHTML =
        '<span class="ash-kicker"><b>●</b> RELEASE PARTIES</span>' +
        '<span class="ash-title">Album Releases</span>';
      sec.appendChild(head);
      const row = document.createElement('div');
      row.className = 'album-row';
      parties.forEach(p => {
        const total = (typeof p.total_track_count === 'number' && p.total_track_count > 0)
          ? p.total_track_count : (Array.isArray(p.playable_track_ids) ? p.playable_track_ids.length : p.playableLoaded);
        const nPlay = p.playableLoaded;
        const cover = safeUrl(p.cover_url);
        const title = RC().escapeHtml(p.album_title || 'Untitled Album');
        const artist = RC().escapeHtml(p.artist_display_name || '');
        // LIVE badge for in-window parties; else a "NEW ALBUM" tag. p.live is a backend boolean.
        const badge = p.live
          ? '<span class="album-badge album-live"><i></i>LIVE THIS WEEK</span>'
          : '<span class="album-badge album-new">NEW ALBUM</span>';
        // "N of M playable" only when the album is partially playable in-game (consent/decodable gap).
        const partial = (typeof total === 'number' && nPlay < total)
          ? '<span class="album-partial">' + nPlay + ' of ' + total + ' playable</span>' : '';
        const artInner = cover
          ? '<img class="album-art-img" src="' + cover + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'album-art-fallback\');" />'
          : '';
        const card = document.createElement('button');
        card.className = 'album-card' + (p.live ? ' is-live' : '');
        card.innerHTML =
          '<span class="album-art' + (cover ? '' : ' album-art-fallback') + '" aria-hidden="true">' +
            artInner +
            '<span class="album-art-glyph">' + RC().escapeHtml(initial(p.album_title)) + '</span>' +
          '</span>' +
          '<span class="album-meta">' +
            badge +
            '<span class="album-title">' + title + '</span>' +
            (artist ? '<span class="album-artist">' + artist + '</span>' : '') +
            partial +
          '</span>';
        card.addEventListener('click', () => {
          const list = RC().albumTracks(p.id);
          if (list && list.length) openSongs(list, p.album_title || 'Album', 'browse');
        });
        row.appendChild(card);
      });
      sec.appendChild(row);
      gg.appendChild(sec);
    }
    const maxCount = named.length ? named[0].count : 1;   // the biggest genre (sorted desc) → "energy bar" scale
    // R-3 collection meters: per-genre S-mastery from getCollectionStats() (built off saved bests). {} for a
    // new player → no meter shows anywhere (quiet). Keyed by cleanGenre(t.genre), same key genreList() uses.
    let colStats = {}; try { colStats = (RC().getCollectionStats && RC().getCollectionStats()) || {}; } catch (e) { colStats = {}; }
    genres.forEach(g => {
      const isUncat = g.name === UNCAT_GENRE;
      const label = isUncat ? UNCAT_LABEL : g.name;
      const t = document.createElement('button');
      t.className = 'genre-tile'; setPal(t, label);
      // hue variety WITHIN the warm palette: a deterministic accent slot per genre so the eye can scan/differentiate
      // (purely cosmetic — class drives a CSS accent var; the data wiring below is untouched).
      t.classList.add('gt-a' + (RC().hashStr(label) % 6));
      if (isUncat) t.classList.add('gt-uncat');
      // a fill fraction (0..1) for the relative-size "energy" rail under the count — bigger genre = fuller bar.
      const frac = Math.max(0.16, Math.min(1, g.count / (maxCount || 1)));
      t.style.setProperty('--gt-fill', (frac * 100).toFixed(0) + '%');
      // quiet S-mastery meter — "12/40 S". Shown ONLY once you've S-ranked a track in this genre (else nothing).
      const cs = colStats[g.name];
      const sN = cs ? (cs.sCount | 0) : 0;
      const meterHtml = sN > 0
        ? '<span class="gt-collect"><b aria-hidden="true">♔</b>' + sN + '/' + (cs.total | 0 || g.count) + ' S</span>'
        : '';
      t.innerHTML =
        '<span class="gt-watermark" aria-hidden="true">' + RC().escapeHtml(initial(label)) + '</span>' +
        '<span class="gt-glow" aria-hidden="true"></span>' +
        '<span class="gt-body">' +
          '<span class="gt-name">' + RC().escapeHtml(label) + '</span>' +
          '<span class="gt-meta">' +
            '<span class="gt-count">' + g.count + '</span>' +
            '<span class="gt-unit">track' + (g.count !== 1 ? 's' : '') + '</span>' +
          '</span>' +
          '<span class="gt-rail" aria-hidden="true"><i></i></span>' +
          meterHtml +
        '</span>';
      t.addEventListener('click', () => openSongs(RC().byGenre(g.name), label, 'browse'));
      gg.appendChild(t);
    });

    // ---- artists: multi-track keep their own tile, 1-track folded into Various Artists ----
    const ag = $('artist-grid'); ag.innerHTML = '';
    const artists = RC().artistList();
    const solo = [];   // {name} of artists with exactly one track
    const mkArtist = (cls, seed, glyph, name, countText) => {
      const t = document.createElement('button');
      t.className = 'artist-tile' + (cls ? ' ' + cls : '');
      const av = document.createElement('span'); av.className = 'at-avatar'; setPal(av, seed);
      av.innerHTML = '<span class="at-init">' + RC().escapeHtml(glyph) + '</span>';
      const tx = document.createElement('span'); tx.className = 'at-text';
      tx.innerHTML = '<span class="at-name">' + RC().escapeHtml(name) + '</span><span class="at-count">' + countText + '</span>';
      const chev = document.createElement('span'); chev.className = 'at-chev'; chev.setAttribute('aria-hidden', 'true'); chev.textContent = '›';
      t.appendChild(av); t.appendChild(tx); t.appendChild(chev);
      return t;
    };
    artists.forEach(a => {
      if (a.count <= 1) { solo.push(a); return; }
      const t = mkArtist('', a.name, initial(a.name), a.name, a.count + ' song' + (a.count !== 1 ? 's' : ''));
      t.addEventListener('click', () => openSongs(RC().byArtist(a.name), a.name, 'browse'));
      ag.appendChild(t);
    });
    if (solo.length) {
      const label = 'Various Artists';
      const t = mkArtist('at-various', label, '♪', label, solo.length + ' artist' + (solo.length !== 1 ? 's' : ''));
      t.addEventListener('click', () => {
        // gather every 1-track artist's tracks into one list
        const list = [];
        solo.forEach(a => { RC().byArtist(a.name).forEach(tr => list.push(tr)); });
        openSongs(list, label + ' (' + solo.length + ')', 'browse');
      });
      ag.appendChild(t);
    }
  }

  // Top-genres strip: a compact horizontal chip row above the genre grid.
  // Reuses the .genre-chips / .genre-chip styling already defined in index.html.
  // Idempotent — rebuilt each render, never duplicated.
  function renderTopGenreStrip(top) {
    const gg = $('genre-grid'); if (!gg) return;
    let strip = $('genre-top-strip');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'genre-top-strip';
      strip.className = 'genre-chips';
      // .genre-chips ships a 0 20px 16px gutter for a full-bleed container; inside
      // the already-padded .browse-scroll that double-indents the row, so flatten the
      // side padding and align it to the grid below.
      strip.style.padding = '0 0 12px';
      gg.parentNode.insertBefore(strip, gg);   // sits directly above the genre grid
    }
    strip.innerHTML = '';
    if (!top || !top.length) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    top.forEach(g => {
      const c = document.createElement('button');
      c.className = 'genre-chip';
      c.textContent = g.name + ' · ' + g.count;
      c.addEventListener('click', () => openSongs(RC().byGenre(g.name), g.name, 'browse'));
      strip.appendChild(c);
    });
  }

  // =========================================================================
  // CREDITS (artists → tracks + packs) — licensing attribution
  // =========================================================================
  function renderCredits() {
    const host = $('credits-list'); if (!host) return;
    host.innerHTML = '';
    const tracks = RC().allTracks();
    // group by credit name (falls back to artist_name)
    const groups = {};
    tracks.forEach(t => {
      const name = t.artist_credit_name || t.artist_name || 'Unknown Artist';
      (groups[name] = groups[name] || []).push(t);
    });
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    const cc = $('credits-count'); if (cc) cc.textContent = names.length + ' artists';
    const frag = document.createDocumentFragment();
    names.forEach(name => {
      const block = document.createElement('div'); block.className = 'credit-block';
      const head = document.createElement('div'); head.className = 'credit-artist';
      const av = document.createElement('span'); av.className = 'credit-av'; setPal(av, name); av.textContent = initial(name);
      const nm = document.createElement('span'); nm.className = 'credit-name'; nm.textContent = name;
      head.appendChild(av); head.appendChild(nm); block.appendChild(head);
      groups[name].forEach(t => {
        const row = document.createElement('div'); row.className = 'credit-track';
        const packs = (t.pack_names || t.packs || []);
        const packStr = Array.isArray(packs) && packs.length ? packs.join(' · ') : '';
        row.innerHTML = '<span class="ct-title">' + RC().escapeHtml(t.title || '') + '</span>' +
          (packStr ? '<span class="ct-pack">' + RC().escapeHtml(packStr) + '</span>' : '');
        block.appendChild(row);
      });
      frag.appendChild(block);
    });
    host.appendChild(frag);
    host.scrollTop = 0;
  }

  // =========================================================================
  // SONGS (searchable, sortable, lazy list)
  // =========================================================================
  let songsBase = [], songsList = [], songsRendered = 0;
  let songsIsVideo = false;   // true ONLY for the dedicated Videos view, so currentSongs doesn't filter it empty
  let songsPoster = false;    // poster-grid (AI Flixs) vs row list (music) — Phase 5
  let songsScope = 'music';   // 'music' | 'flixs' | 'all' — which media currentSongs() keeps — Phase 5
  const PAGE = 40;

  function openSongs(list, title, ret, q, isVid, poster, scope) {
    songsBase = list || [];
    songsIsVideo = !!isVid;
    songsPoster = !!poster;
    songsScope = scope || (isVid ? 'flixs' : 'music');
    songsReturn = ret || 'jukebox';
    $('songs-title').textContent = title || 'All Songs';
    $('songs-search').value = q || '';
    $('songs-sort').value = 'new';
    const lv = $('view-songs'); if (lv) { lv.classList.toggle('poster-grid', songsPoster); lv.classList.toggle('flixs-mode', songsScope === 'flixs'); }   // build99: flixs-mode → premiere header treatment
    showView('songs');
    refreshSongs();
  }

  function currentSongs() {
    let list = songsBase;
    if (songsScope === 'music')      list = list.filter(t => !RC().isVideo(t));   // keep videos out of music lists
    else if (songsScope === 'flixs') list = list.filter(t =>  RC().isVideo(t));   // dedicated Flixs list stays music-free
    // 'all' → no media filter (used by the global header search)
    const q = $('songs-search').value.trim().toLowerCase();
    if (q) list = list.filter(t => (t.title || '').toLowerCase().includes(q) || (t.artist_name || '').toLowerCase().includes(q) || (RC().cleanGenre(t.genre) || '').toLowerCase().includes(q));
    return RC().sortTracks(list, $('songs-sort').value);
  }

  function procArt(t) {
    const a = document.createElement('span');
    a.className = 'sc-art';
    const p = pal(t.id);
    a.style.cssText = 'display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);font-family:Unbounded,sans-serif;font-weight:700;font-size:20px;background:linear-gradient(150deg,' + p[0] + ',' + p[1] + ')';
    a.textContent = initial(t.title);
    return a;
  }

  function songCard(t) {
    const card = document.createElement('button');
    card.className = 'song-card';
    // art
    let artEl;
    if (t.artwork_url) {
      artEl = document.createElement('img');
      artEl.className = 'sc-art'; artEl.loading = 'lazy';
      // build147: only attempt the full-URL retry when the thumb URL actually differs — re-assigning the same already-
      // failed non-Supabase URL never re-fires onerror in Chrome (stranded broken-image ghost); then branded procArt.
      const _tu = thumb(t.artwork_url, 160);
      artEl.onerror = () => { if (artEl.dataset.full !== '1' && _tu !== t.artwork_url) { artEl.dataset.full = '1'; artEl.src = t.artwork_url; } else { artEl.replaceWith(procArt(t)); } };   // build100o: thumbnail → original → procedural art
      artEl.dataset.full = ''; artEl.src = _tu;
    } else {
      artEl = procArt(t);
    }
    card.appendChild(artEl);
    // text
    const text = document.createElement('span'); text.className = 'sc-text';
    const sub = [t.artist_name, RC().cleanGenre(t.genre), t.bpm ? t.bpm + ' BPM' : '', RC().fmtDur(t.duration_seconds)].filter(Boolean).join(' · ');
    text.innerHTML = '<span class="sc-title">' + RC().escapeHtml(t.title || 'Untitled') + '</span><span class="sc-sub">' + RC().escapeHtml(sub) + '</span>';   // build100d: default title so a null/empty live row never renders the literal 'undefined'
    // GOLDEN BUZZER winner — dedicated backend flag (golden_buzzer); dark until the backend sets it.
    if (RC().goldenBuzzer(t)) {
      card.classList.add('gb-winner');
      const gt = document.createElement('span'); gt.className = 'sc-gb-tag'; gt.textContent = '♔ Golden Buzzer Winner';   // ♔
      text.appendChild(gt);
    }
    card.appendChild(text);
    // build95 (playtest): AI Flixs film cue — a video found via global 'all'-scope search renders here as a plain
    // music ROW with no film indicator. Show a "FILM · SOON" pill + suppress the music status/grade/chevron so a
    // film reads distinct from a song. Tap still opens the sheet (which owns the Watch/Soon affordance). Render-only.
    if (RC() && typeof RC().isVideo === 'function' && RC().isVideo(t)) {
      card.classList.add('is-video');
      const vright = document.createElement('span'); vright.className = 'sc-right';
      const fp = document.createElement('span'); fp.className = 'sc-film'; fp.textContent = 'FILM · SOON';   // warm-chrome pill, NOT gold (not a playable cue)
      vright.appendChild(fp);
      card.appendChild(vright);
      card.addEventListener('click', () => RC().openSheet(t));
      return card;
    }
    // right — status pill (not ready) · grade badge · or chevron
    const right = document.createElement('span'); right.className = 'sc-right';
    // D1 (ratings): community rating (★ 4.2) leads the right cluster, before the sc-grade chip. Defensive (n>=3 or nothing).
    { const _rc = ratingChip(t); if (_rc) right.appendChild(_rc); }
    const ready = RC().trackReady(t);
    if (!ready) {
      card.classList.add('not-ready');
      const st = document.createElement('span');
      const s = RC().trackStatus(t);
      st.className = 'sc-status s-' + s; st.textContent = RC().statusLabel(s);
      right.appendChild(st);
    } else {
      const best = RC().getBest(t.id);
      if (best) {
        // #17 near-miss micro-tag — leads the cluster so the nudge reads before the grade
        const nm = nearMiss[String(t.id)];
        if (nm) { const chip = document.createElement('span'); chip.className = 'sc-nearmiss' + (nm === 'SO CLOSE' ? ' soclose' : ''); chip.textContent = nm; right.appendChild(chip); }
        // R-3 mastery crown — S-grade earns a gold ♔ alongside the grade chip
        if (best.grade === 'S') { card.classList.add('mastered'); const cr = document.createElement('span'); cr.className = 'sc-crown'; cr.textContent = '♔'; cr.setAttribute('aria-hidden', 'true'); right.appendChild(cr); }
        const g = document.createElement('span'); g.className = 'sc-grade ' + gradeClass(best.grade); g.textContent = best.grade;
        right.appendChild(g);
      } else {
        const chev = document.createElement('span'); chev.className = 'sc-chev'; chev.textContent = '›'; chev.style.color = 'var(--ink-dim)'; chev.style.fontSize = '20px';
        right.appendChild(chev);
      }
    }
    card.appendChild(right);
    card.addEventListener('click', () => RC().openSheet(t));
    return card;
  }

  // build99: AI FLIXS PREMIERE marquee. The owner wanted the films to feel like a "big film premiere section,"
  // not a plain poster grid. This cinematic NOW-SHOWING hero tops the Flixs list: the featured film's poster as a
  // letterboxed backdrop, a premiere kicker, the title + meta, and a PLAY PREMIERE button that launches the film as a
  // playable level (the music video plays full-screen behind the highway, charted from its audio). One-click play.
  // build99f: takes the FILM LIST (not one film) so the hero can self-heal — it renders the first film immediately,
  // then async-probes audio reachability and swaps to the first PLAYABLE film, so PLAY PREMIERE never 404s on the
  // flagship CTA (~7% of Mux films are missing their audio rendition).
  function flixsHero(list) {
    const films = (list || []).filter(Boolean);
    if (!films.length) return null;
    const hero = document.createElement('div');
    hero.className = 'flixs-marquee';
    function render(t) {
      // posterFor() returns a raw user-authored URL (poster_url/thumbnail_url/artwork_url) — run it
      // through the scheme-allowlist before it reaches the CSS background-image (blocks javascript:/data:,
      // strips quotes so it can't break out of the url("...") value). safeUrl('') → '' → branded fallback.
      const poster = safeUrl(RC().posterFor(t));
      const runtime = RC().fmtDur(t.duration_seconds) || '';
      const genre = RC().cleanGenre(t.genre) || '';
      const artist = t.artist_name || '';
      const statsParts = ['★ AI FILM', runtime, genre].filter(Boolean);
      // data-gap films (no runtime/genre): fold the artist INTO the stat row (else two stunted lines), drop the by-line.
      let byLine = artist ? 'by ' + artist : '';
      if (statsParts.length === 1 && artist) { statsParts.push(artist); byLine = ''; }
      const stats = statsParts.join(' · ');
      hero.innerHTML =
        '<span class="fm-bg"></span>' +
        '<span class="fm-grain"></span>' +
        '<span class="fm-scrim"></span>' +
        '<span class="fm-vig"></span>' +
        '<span class="fm-letterbox"></span>' +
        '<span class="fm-tag">✦ FEATURED PREMIERE' + (runtime ? ' · ' + RC().escapeHtml(runtime) : '') + '</span>' +
        '<span class="fm-body">' +
          '<span class="fm-kicker"><b>●</b> NOW SHOWING · AI PREMIERE</span>' +
          '<span class="fm-title">' + RC().escapeHtml(t.title || 'Untitled') + '</span>' +
          '<span class="fm-stats">' + RC().escapeHtml(stats) + '</span>' +
          (byLine ? '<span class="fm-by">' + RC().escapeHtml(byLine) + '</span>' : '') +
          '<span class="fm-actions">' +
            '<button class="fm-play" type="button">▶ PLAY PREMIERE</button>' +
            '<button class="fm-info" type="button">Details</button>' +
          '</span>' +
          '<span class="fm-note">The music video plays behind the highway — hit the notes to the song.</span>' +
        '</span>';
      const bg = hero.querySelector('.fm-bg');
      if (bg) {
        if (poster) { bg.style.backgroundImage = 'url("' + poster.replace(/"/g, '%22') + '")'; }
        else {
          // build100b: a featured film with no catalog poster_url no longer renders a flat dark panel — paint the same
          // branded clapperboard backdrop the cards use (fillNoArt) so the hero is never blank ("everything should have thumbnails").
          bg.style.background = 'radial-gradient(120% 100% at 50% 0%, #2a0d12 0%, #140709 62%, #0a0707 100%)';
          bg.innerHTML = '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,42,48,0.15)">' +
            '<svg width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">' +
              '<rect x="2.5" y="6.5" width="19" height="13" rx="2"></rect>' +
              '<path d="M2.5 6.5l3.4-3.2 3.1 3.2M9 6.5l3.4-3.2 3.1 3.2M15.5 6.5l3.4-3.2 3.1 3.2"></path>' +
            '</svg></span>';
        }
      }
      const pb = hero.querySelector('.fm-play'); if (pb) pb.addEventListener('click', (e) => { e.stopPropagation(); RC().openSheet(t); });   // build100q: open the sheet (Easy/Med/Hard picker) instead of launching the flix directly
      const ib = hero.querySelector('.fm-info'); if (ib) ib.addEventListener('click', (e) => { e.stopPropagation(); RC().openSheet(t); });
    }
    render(films[0]);
    // self-heal: if the featured film's audio is unreachable, re-render with the first PLAYABLE one (keeps the hero's
    // prominent PLAY PREMIERE from 404-ing). Cheap session-cached probes; re-render only if the pick actually changed.
    try {
      if (RC().firstPlayableFlix) RC().firstPlayableFlix(films, 8).then(function (good) {
        if (good && good.id !== films[0].id) render(good);
      }).catch(function () {});
    } catch (e) {}
    return hero;
  }
  // Branded film-card placeholder — used when a film has no poster (or its poster 404s). NEVER a blank/broken card.
  // The film video_url's are HLS .m3u8 (Mux), which Chrome can't paint as a <video> first-frame — so this is a pure
  // CSS/SVG placeholder: a warm-dark gradient frame + a clapperboard glyph + the film's title initial. The gold
  // "AI FILM" cue (.vc-badge) is added by the caller and reads on top, so even a poster-less film looks intentional.
  function fillNoArt(fr, t) {
    fr.classList.add('vc-noart');
    const ph = document.createElement('span'); ph.className = 'vc-ph';
    ph.innerHTML =
      '<span class="vc-ph-glyph" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="2.5" y="6.5" width="19" height="13" rx="2"></rect>' +
          '<path d="M2.5 6.5l3.4-3.2 3.1 3.2M9 6.5l3.4-3.2 3.1 3.2M15.5 6.5l3.4-3.2 3.1 3.2"></path>' +
        '</svg>' +
      '</span>' +
      '<span class="vc-ph-init">' + RC().escapeHtml(initial(t.title)) + '</span>';
    fr.appendChild(ph);
  }

  // 16:9 cinematic poster card for AI Flixs (vs the music songCard row). Phase 5 discovery surface.
  function videoCard(t) {
    const card = document.createElement('button');
    card.className = 'video-card';
    const fr = document.createElement('span'); fr.className = 'vc-frame';
    const src = RC().posterFor(t);
    if (src) {
      const img = document.createElement('img');
      img.className = 'vc-poster'; img.loading = 'lazy'; img.src = src; img.alt = '';
      img.onerror = () => { img.remove(); fillNoArt(fr, t); };   // poster 404 → branded fallback (never a bare play button)
      fr.appendChild(img);
    } else { fillNoArt(fr, t); }
    const grad = document.createElement('span'); grad.className = 'vc-grad'; fr.appendChild(grad);
    if (t.duration_seconds) { const d = document.createElement('span'); d.className = 'vc-dur'; d.textContent = RC().fmtDur(t.duration_seconds); fr.appendChild(d); }
    // build99: films are PLAYABLE now (playFlix → the music video plays full-screen behind the highway while you
    // play the chart from its audio). Gold "AI FILM" premiere ribbon + hover ▶; the card opens the sheet, which
    // launches "▶ Play AI Flix". (Was a stale "Soon" discovery-only chip.)
    const badge = document.createElement('span'); badge.className = 'vc-badge'; badge.textContent = '★ AI FILM'; fr.appendChild(badge);
    const play = document.createElement('span'); play.className = 'vc-play'; play.textContent = '▶'; fr.appendChild(play);
    card.appendChild(fr);
    const cap = document.createElement('span'); cap.className = 'vc-cap';
    cap.innerHTML = '<span class="vc-title">' + RC().escapeHtml(t.title || '') + '</span>' +
                    '<span class="vc-sub">' + RC().escapeHtml([t.artist_name, RC().cleanGenre(t.genre)].filter(Boolean).join(' · ')) + '</span>';
    card.appendChild(cap);
    card.addEventListener('click', () => RC().openSheet(t));   // sheet handles the Watch affordance (Item 6)
    return card;
  }

  function refreshSongs() {
    const host = $('song-list');
    host.innerHTML = '';
    songsRendered = 0;
    rebuildNearMiss();   // #17: refresh the near-miss (1-TO-S / SO-CLOSE) lookup for this list render
    songsList = currentSongs();
    $('songs-count').textContent = songsList.length + '';
    // keep the in-field clear-× in sync with the current query (also covers openSongs seeding a query)
    { const q0 = ($('songs-search').value || '').trim(); const sx = $('songs-search-clear'); if (sx) sx.hidden = !q0; }
    if (!songsList.length) { renderSongsEmpty(host); return; }
    host.scrollTop = 0;
    // build99: AI FLIXS premiere marquee — feature the top film in a NOW-SHOWING hero, then start the grid at the 2nd
    // film so it isn't duplicated. Only on the un-searched Flixs list (a query collapses back to the plain grid).
    const showHero = songsScope === 'flixs' && songsPoster && !($('songs-search').value || '').trim();
    if (showHero) {
      const hero = flixsHero(songsList);   // build99f: pass the LIST so the hero self-heals to a playable film
      if (hero) { host.appendChild(hero); songsRendered = 1; }
    }
    appendSongs();
    fillViewport();
    // build99: keep the premiere marquee at the top on entry — an async focus/layout pass was snapping the
    // scroller ~300px down (past the hero), so the premiere never got its moment. Re-pin to top over 2 frames.
    if (showHero) { host.scrollTop = 0; requestAnimationFrame(() => { host.scrollTop = 0; requestAnimationFrame(() => { host.scrollTop = 0; }); }); }
  }

  // branded empty state — echoes the query + offers a one-tap Clear (mirrors the .lib-empty box idiom)
  function renderSongsEmpty(host) {
    const q = ($('songs-search').value || '').trim();
    const box = document.createElement('div');
    box.className = 'lib-empty';
    const glyph = '<svg class="le-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>';
    if (q) {
      box.innerHTML = glyph + '<div class="le-text">No songs match “' + RC().escapeHtml(q) + '”</div>' +
        '<button class="ghost-btn le-clear" id="songs-empty-clear" type="button">Clear search</button>';
    } else {
      box.innerHTML = glyph + '<div class="le-text">No songs here yet.</div>';
    }
    host.appendChild(box);
    const ec = $('songs-empty-clear');
    if (ec) ec.addEventListener('click', clearSongsSearch);
  }

  function clearSongsSearch() {
    const si = $('songs-search'); if (si) si.value = '';
    const sx = $('songs-search-clear'); if (sx) sx.hidden = true;
    refreshSongs();
    if (si) si.focus();
  }

  // keep appending until the list overflows the viewport (so short genres look full
  // and there's always something to scroll into)
  function fillViewport() {
    const host = $('song-list');
    let guard = 0;
    while (songsRendered < songsList.length && host.scrollHeight <= host.clientHeight + 40 && guard++ < 30) appendSongs();
  }

  function onSongsScroll() {
    const host = $('song-list');
    if (songsRendered >= songsList.length) return;
    if (host.scrollTop + host.clientHeight > host.scrollHeight - 600) appendSongs();
  }

  function appendSongs() {
    const host = $('song-list');
    const end = Math.min(songsList.length, songsRendered + PAGE);
    const frag = document.createDocumentFragment();
    for (let i = songsRendered; i < end; i++) frag.appendChild(songsPoster ? videoCard(songsList[i]) : songCard(songsList[i]));
    host.appendChild(frag);
    songsRendered = end;
  }

  // =========================================================================
  // RETENTION SHELVES (For You / Fresh Since / Daily Picks) — quiet horizontal
  // rails at the top of Browse. Every shelf HIDES when its getter returns []; the
  // whole block hides if all three are empty. Cards reuse the getBest grade / #17
  // near-miss / R-3 mastery-crown pipeline.
  // =========================================================================
  function shelfCard(t) {
    const card = document.createElement('button');
    card.className = 'rr-shelf-card'; card.type = 'button';
    // art (thumbnail → full → branded initial; mirrors songCard/fillCover fallback chain)
    const art = document.createElement('span'); art.className = 'rsc-art';
    if (t.artwork_url) {
      const im = document.createElement('img'); im.loading = 'lazy'; im.alt = '';
      const _tu = thumb(t.artwork_url, 240);
      im.onerror = function () { if (im.dataset.full !== '1' && _tu !== t.artwork_url) { im.dataset.full = '1'; im.src = t.artwork_url; } else { im.remove(); art.classList.add('rsc-noart'); setPal(art, t.id); art.textContent = initial(t.title); } };
      im.dataset.full = ''; im.src = _tu; art.appendChild(im);
    } else { art.classList.add('rsc-noart'); setPal(art, t.id); art.textContent = initial(t.title); }
    card.appendChild(art);
    // R-3 mastery crown (S) or grade chip; #17 near-miss chip — all off the SAME getBest/chaseTheS data
    const best = RC().getBest(t.id);
    if (best && best.grade === 'S') { card.classList.add('mastered'); const cr = document.createElement('span'); cr.className = 'rsc-crown'; cr.textContent = '♔'; cr.setAttribute('aria-hidden', 'true'); card.appendChild(cr); }
    else if (best) { const g = document.createElement('span'); g.className = 'rsc-grade ' + gradeClass(best.grade); g.textContent = best.grade; card.appendChild(g); }
    const nm = nearMiss[String(t.id)];
    if (nm) { const chip = document.createElement('span'); chip.className = 'rsc-nm' + (nm === 'SO CLOSE' ? ' soclose' : ''); chip.textContent = nm; card.appendChild(chip); }
    // caption
    const cap = document.createElement('span'); cap.className = 'rsc-cap';
    cap.innerHTML = '<span class="rsc-title">' + RC().escapeHtml(t.title || 'Untitled') + '</span>' +
                    '<span class="rsc-sub">' + RC().escapeHtml(t.artist_name || '') + '</span>';
    card.appendChild(cap);
    card.addEventListener('click', () => RC().openSheet(t));
    return card;
  }
  function buildShelf(key, label, sub, tracks) {
    if (!tracks || !tracks.length) return null;   // EMPTY-GUARD → this shelf never renders
    const sec = document.createElement('section');
    sec.className = 'rr-shelf'; sec.dataset.shelf = key;
    const head = document.createElement('div'); head.className = 'rr-shelf-head';
    head.innerHTML = '<span class="rsh-title">' + RC().escapeHtml(label) + '</span>' +
                     (sub ? '<span class="rsh-sub">' + RC().escapeHtml(sub) + '</span>' : '') +
                     '<span class="rsh-count">' + tracks.length + '</span>';
    sec.appendChild(head);
    const row = document.createElement('div'); row.className = 'rr-shelf-row';
    tracks.forEach(t => { if (t) row.appendChild(shelfCard(t)); });
    sec.appendChild(row);
    return sec;
  }
  function renderRetentionShelves() {
    const scroll = document.querySelector('#view-browse .browse-scroll');
    if (!scroll) return;
    let host = $('rr-shelves');
    if (!host) { host = document.createElement('div'); host.id = 'rr-shelves'; host.className = 'rr-shelves'; scroll.insertBefore(host, scroll.firstChild); }
    host.innerHTML = '';
    rebuildNearMiss();
    let foryou = [], fresh = [], daily = [];
    try { foryou = (RC().forYouTracks ? RC().forYouTracks(24) : []) || []; } catch (e) {}
    try { fresh = (RC().freshSince ? RC().freshSince() : []) || []; } catch (e) {}
    try { daily = (RC().dailyPicks ? RC().dailyPicks(12) : []) || []; } catch (e) {}
    let ageH = null; try { ageH = RC().lastVisitAgeHours ? RC().lastVisitAgeHours() : null; } catch (e) {}
    const freshSub = fresh.length ? _agoPhrase(ageH) : '';
    const shelves = [
      buildShelf('fresh', 'Fresh since you were here', freshSub, fresh.slice(0, 18)),
      buildShelf('foryou', 'For you', 'From what you play', foryou.slice(0, 18)),
      buildShelf('daily', 'Daily picks', "Today's rotation", daily),
    ];
    let any = false;
    shelves.forEach(s => { if (s) { host.appendChild(s); any = true; } });
    host.style.display = any ? '' : 'none';   // no shelves → the whole block collapses (no empty header/gap)
  }

  // =========================================================================
  // WELCOME-BACK CARD (R-2) — ONE proactive warm-dark hub card on library open,
  // by priority: streak-at-risk → fresh-since count. Dismiss = gone for the day.
  // At most ONE per session; YIELDS if a first-run/calibration coach is showing.
  // =========================================================================
  function _streakAtRisk() {
    try {
      const G = window.RhythmGoals;
      if (!G || !G.streakState) return 0;      // no streak source → skip this branch (per spec)
      const s = G.streakState() || {};
      const count = s.count | 0;
      if (count < 1) return 0;
      const today = _todayKey();
      if (s.lastCompleteDate === today) return 0;          // already safe today
      if (s.lastCompleteDate === _prevKey(today)) return count;   // alive (done yesterday), not yet today → at risk
      return 0;                                            // older / broken → not "at risk" (already lost)
    } catch (e) { return 0; }
  }
  function _coachVisible() {
    // YIELD to a first-run / calibration surface so we never stack a second proactive card
    try {
      const ids = ['calib-screen', 'howto-screen', 'ryo-intro-screen', 'ryo-intro'];
      for (let i = 0; i < ids.length; i++) { const el = $(ids[i]); if (el && (el.classList.contains('active') || el.classList.contains('show'))) return true; }
      if (document.querySelector('.first-run-coach, .coach-card.show, #tap-zones.coach, [data-first-run].show')) return true;
    } catch (e) {}
    return false;
  }
  function _dismissWelcome(card, today) {
    try { localStorage.setItem('rr_welcome_dismiss', today); } catch (e) {}
    if (card && card.parentNode) card.parentNode.removeChild(card);
  }
  // ---- Wave-4b (B1) RECLAIM helpers — read the parallel-agent contract DEFENSIVELY ----
  // RhythmCatalog.getReclaimTargets() is SYNC → Array<{trackId,trackTitle,myScore,passerName,
  // passerScore,margin,passedAt}>, [] when nothing/unauthed/offline. It may not exist yet while
  // that agent works, so guard on typeof; anything unexpected collapses to [] (silent).
  function _reclaimRows() {
    try {
      const C = RC();
      if (C && typeof C.getReclaimTargets === 'function') {
        const a = C.getReclaimTargets();
        return Array.isArray(a) ? a : [];
      }
    } catch (e) {}
    return [];
  }
  function _resolveTrackById(id) {
    try {
      const pool = RC().allTracks(); const sid = String(id);
      for (let i = 0; i < pool.length; i++) { if (pool[i] && String(pool[i].id) === sid) return pool[i]; }
    } catch (e) {}
    return null;
  }
  // D1 ATTENTION CAP — enforce "at most ONE pulsing accent" by precedence
  // reclaim > streak-at-risk > everything else. The welcome card carries at most one
  // pulse (its reclaim mode); here we HUSH the always-on streak chip whenever the reclaim
  // card owns the pulse, so the chip and card never shout at the same time.
  function applyAttentionCap() {
    try {
      const card = $('rr-welcome');
      const mode = card ? (card.getAttribute('data-mode') || '') : '';
      const chip = $('rr-streak-chip');
      if (chip) chip.classList.toggle('rr-hush', mode === 'reclaim');
    } catch (e) {}
  }
  function maybeWelcomeCard(opts) {
    try {
      const menu = $('menu');
      if (!(menu && menu.classList.contains('active'))) return;   // library not on screen yet (observer re-fires on activation)
      if (_coachVisible()) return;                                // YIELD — don't stack on a first-run nudge
      const today = _todayKey();
      let dismissed = ''; try { dismissed = localStorage.getItem('rr_welcome_dismiss') || ''; } catch (e) {}
      if (dismissed === today) return;                            // dismissed today → stay gone for the day
      // B1: a reclaim UPGRADE (fired by the async 'rr:reclaim' event when the deltas land) may PROMOTE
      // an already-shown lower-priority card to the top-priority reclaim branch. It reuses the SAME
      // one-per-session slot (still one card), so it alone bypasses the rr_welcome_shown gate here.
      const isUpgrade = !!(opts && opts.reclaimUpgrade);
      if (!isUpgrade && sessionStorage.getItem('rr_welcome_shown')) return;   // one proactive card per session

      const risk = _streakAtRisk();
      let fresh = []; try { fresh = (RC().freshSince ? RC().freshSince() : []) || []; } catch (e) {}
      let mode, title, titleHtml, sub, cta, onCta;
      // ---- TOP PRIORITY (B1): a rival passed your score → reclaim it (ghost chase). Positive
      // framing ALWAYS — "passed you / reclaim it", never "you lost". Silent when the array is empty. ----
      const reclaim = _reclaimRows();
      if (reclaim.length) {
        let row = null, track = null;
        for (let i = 0; i < reclaim.length; i++) {                 // resolve to a playable track; skip rows we can't resolve
          const t = _resolveTrackById(reclaim[i] && reclaim[i].trackId);
          if (t) { row = reclaim[i]; track = t; break; }
        }
        if (row && track) {
          mode = 'reclaim';
          const who = RC().escapeHtml(String(row.passerName || 'A rival'));
          const song = String(row.trackTitle || track.title || 'this track');
          title = row.passerName + ' passed you on ' + song;      // plain aria/fallback string
          titleHtml = '<b>' + who + '</b> passed you on ' + RC().escapeHtml(song);
          sub = 'Reclaim it — chase their ' + Number(row.passerScore || 0).toLocaleString();
          cta = 'RECLAIM IT';
          onCta = () => { try { RC().launchTrack(track, { targetScore: row.passerScore, targetName: row.passerName }); } catch (e) {} };
        }
      }
      // an upgrade exists ONLY to promote to reclaim — if there's no reclaimable row, leave the current card alone
      if (!mode && isUpgrade) return;
      if (!mode && risk > 0) {
        mode = 'streak';
        title = 'Keep your ' + risk + '-day streak alive';
        sub = 'Play a track today so it doesn’t reset.';
        cta = 'Play now';
        onCta = () => { try { const d = RC().dailyPicks(1); if (d && d[0]) RC().openSheet(d[0]); } catch (e) {} };
      } else if (!mode && fresh.length > 0) {
        mode = 'fresh';
        let ageH = null; try { ageH = RC().lastVisitAgeHours(); } catch (e) {}
        const ago = _agoPhrase(ageH);
        title = fresh.length + ' new since you were here';
        sub = (ago ? ago + ' · ' : '') + 'Fresh drops in your library.';
        cta = 'See what’s new';
        onCta = () => { try { openSongs(RC().freshSince(), 'Fresh since your last visit', 'jukebox'); } catch (e) {} };
      } else if (!mode) {
        return;   // nothing worth saying → no card (empty-guard)
      }
      try { sessionStorage.setItem('rr_welcome_shown', '1'); } catch (e) {}
      const view = $('view-jukebox'); if (!view) return;
      const old = $('rr-welcome'); if (old) old.remove();
      const card = document.createElement('div');
      card.id = 'rr-welcome'; card.className = 'rr-welcome rr-welcome-' + mode; card.setAttribute('role', 'status');
      card.setAttribute('data-mode', mode);   // D1: the attention-cap governor reads this to decide who pulses
      const icon = mode === 'streak'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1.5 3 4 4.2 4 7a4 4 0 0 1-8 0c0-1 .4-1.8 1-2.5C9.6 9 10 10 11 10.4 10.2 8 12 6 12 3z"></path><path d="M8.5 15a3.5 3.5 0 0 0 7 0"></path></svg>'
        : mode === 'reclaim'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 1v3M12 20v3M1 12h3M20 12h3"></path></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-3.6 3 1.1 4.8L12 14.5 8 16.8l1.1-4.8L5.5 9l4.6-1.4L12 3z"></path></svg>';
      card.innerHTML =
        '<span class="rw-ic" aria-hidden="true">' + icon + '</span>' +
        '<span class="rw-txt"><span class="rw-title">' + (titleHtml || RC().escapeHtml(title)) + '</span><span class="rw-sub">' + RC().escapeHtml(sub) + '</span></span>' +
        '<button class="rw-cta" type="button">' + RC().escapeHtml(cta) + '</button>' +
        '<button class="rw-x" type="button" aria-label="Dismiss">✕</button>';
      card.querySelector('.rw-cta').addEventListener('click', () => { _dismissWelcome(card, today); if (onCta) onCta(); });
      card.querySelector('.rw-x').addEventListener('click', () => { _dismissWelcome(card, today); applyAttentionCap(); });
      view.insertBefore(card, view.firstChild);
      applyAttentionCap();   // D1: re-run the one-pulse cap now the card's mode is on screen
    } catch (e) {}
  }

  // =========================================================================
  // DAILY-STREAK CHIP (R-4) — an always-on flame + day count pinned in the library
  // header. The persistent complement to the once-per-session welcome card: the
  // streak stays visible every time you open the library, not only on return.
  // READ-ONLY consumer of window.RhythmGoals.streakState() — which returns
  // { count, lastCompleteDate, freezeBanked, freezeEarnedAtCount, milestonesSeen, freezeJustUsed }
  // (no alive/atRisk fields), so the visual state is DERIVED here from count +
  // lastCompleteDate, exactly like _streakAtRisk() does for the welcome card.
  //   • count ≥ 1, played today (lastCompleteDate === today)      → steady GOLD flame + count
  //   • count ≥ 1, played yesterday but not today (at risk)       → urgent EMBER pulse + count
  //   • count 0 / older-so-lost / no RhythmGoals                  → render NOTHING (empty-guarded)
  // =========================================================================
  const _STREAK_FLAME = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c3.2 3.6 5.4 6.4 5.4 10.2A5.4 5.4 0 0 1 6.6 12.4c0-2 1-3.6 2.3-5-.3 1.6.5 2.7 1.7 3C9.7 7.7 10.6 4.7 12 2z"></path></svg>';
  function _streakChipState() {
    // → { count, mode: 'alive' | 'risk' } when there's a live streak worth showing, else null.
    try {
      const G = window.RhythmGoals;
      if (!G || !G.streakState) return null;                 // no streak source → nothing to show
      const s = G.streakState() || {};
      const count = s.count | 0;
      if (count < 1) return null;                            // no streak → empty-guard
      const today = _todayKey();
      if (s.lastCompleteDate === today) return { count: count, mode: 'alive' };   // banked today → steady gold
      if (s.lastCompleteDate === _prevKey(today)) return { count: count, mode: 'risk' };   // alive yesterday, not today → at risk
      return null;                                           // older / broken → already lost → show nothing
    } catch (e) { return null; }
  }
  function renderStreakChip() {
    try {
      const bar = document.querySelector('.lib-bar');
      if (!bar) return;
      const st = _streakChipState();
      let chip = $('rr-streak-chip');
      if (!st) { if (chip && chip.parentNode) chip.parentNode.removeChild(chip); return; }   // empty-guard: no live streak → no chip
      if (!chip) {
        chip = document.createElement('button');
        chip.id = 'rr-streak-chip';
        chip.className = 'rr-streak-chip';
        chip.type = 'button';
        // mount into the existing action cluster, next to the profile/career icon (falls back gracefully)
        const actions = bar.querySelector('.lib-actions');
        const anchor = actions && actions.querySelector('#profile-open');
        if (actions && anchor) actions.insertBefore(chip, anchor);
        else if (actions) actions.insertBefore(chip, actions.firstChild);
        else bar.appendChild(chip);
        // tap surfaces the streak detail via the career/profile overlay (no-op if that icon is absent)
        chip.addEventListener('click', () => { try { const p = $('profile-open'); if (p) p.click(); } catch (e) {} });
      }
      const risk = st.mode === 'risk';
      chip.classList.toggle('at-risk', risk);
      const label = risk ? st.count + '-day streak — play today to keep it alive' : st.count + '-day streak';
      chip.setAttribute('aria-label', label);
      chip.setAttribute('title', label);
      chip.innerHTML = '<span class="rsc-flame" aria-hidden="true">' + _STREAK_FLAME + '</span><span class="rsc-n">' + st.count + '</span>';
      applyAttentionCap();   // D1: a repaint of the chip re-asserts the one-pulse cap (reclaim owns the pulse → chip hushed)
    } catch (e) {}
  }

  // =========================================================================
  // BOOT / RENDER
  // =========================================================================
  let built = false;
  function render() {
    stage = $('jb-stage'); jukebox = $('jukebox');
    if (!stage || !jukebox) return;
    if (!built) {
      built = true;
      buildPool();
      bindJukebox();
      // section tabs
      [...$('jb-tabs').children].forEach(b => b.addEventListener('click', () => setSection(b.dataset.sec)));
      // play button → open sheet for centered track
      $('jb-play').addEventListener('click', () => { const t = jbList[Math.round(pos)]; if (t) RC().openSheet(t); });
      // desktop nav: arrow buttons + scroll wheel
      const step = (dir) => { goTo(Math.round(pos) + dir); };
      const pv = $('jb-prev'), nx = $('jb-next');
      if (pv) pv.addEventListener('click', () => step(-1));
      if (nx) nx.addEventListener('click', () => step(1));
      let wheelLock = 0;
      jukebox.addEventListener('wheel', (e) => {
        e.preventDefault();
        const now = Date.now(); if (now - wheelLock < 220) return; wheelLock = now;
        step((e.deltaY || e.deltaX) > 0 ? 1 : -1);
      }, { passive: false });
      // browse entry
      $('jb-browse').addEventListener('click', () => { renderBrowse(); showView('browse'); });
      { const asb = $('jb-allsongs'); if (asb) asb.addEventListener('click', () => openSongs(RC().allTracks(), 'All Songs', 'jukebox')); }
      { const fxb = $('jb-flixs'); if (fxb) fxb.addEventListener('click', () => openSongs(RC().videoTracks(), 'AI Flixs', 'jukebox', '', true, true)); }   // build96 (playtest): AI Flixs as a first-class entry → opens the poster grid directly
      $('lib-search-btn').addEventListener('click', () => { const i = $('lib-search-input'); if (i) i.focus(); openSongs(RC().allTracks(), 'All Songs', 'jukebox'); });
      // prominent header search — type to find any song/artist across the whole library
      { const lsi = $('lib-search-input'), lsx = $('lib-search-clear'); let lsdt = 0;
        const run = () => {
          const q = (lsi.value || '').trim();
          if (lsx) lsx.hidden = !q;
          if (q) openSongs(RC().allMedia(), 'Search · “' + q + '”', 'jukebox', q, null, false, 'all');   // search music + AI Flixs
          else showView('jukebox');
        };
        if (lsi) lsi.addEventListener('input', () => { clearTimeout(lsdt); lsdt = setTimeout(run, 140); });
        if (lsi) lsi.addEventListener('keydown', (e) => { if (e.key === 'Escape') { lsi.value = ''; run(); lsi.blur(); } });
        if (lsx) lsx.addEventListener('click', () => { lsi.value = ''; lsx.hidden = true; showView('jukebox'); lsi.focus(); });
      }
      const rb = $('lib-refresh-btn');
      if (rb) rb.addEventListener('click', () => {
        rb.classList.add('spinning');
        Promise.resolve(RC().reloadCatalog()).finally(() => setTimeout(() => rb.classList.remove('spinning'), 500));
      });
      // backs
      $('browse-back').addEventListener('click', () => showView('jukebox'));
      $('songs-back').addEventListener('click', () => showView(songsReturn));
      const oc = $('open-credits'); if (oc) oc.addEventListener('click', () => { renderCredits(); showView('credits'); });
      const cb = $('credits-back'); if (cb) cb.addEventListener('click', () => showView('browse'));
      // songs controls
      let dbt = 0;
      $('songs-search').addEventListener('input', () => {
        const sx = $('songs-search-clear'); if (sx) sx.hidden = !($('songs-search').value || '').trim();
        clearTimeout(dbt); dbt = setTimeout(refreshSongs, 160);
      });
      $('songs-search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { clearSongsSearch(); } });
      { const ssx = $('songs-search-clear'); if (ssx) ssx.addEventListener('click', clearSongsSearch); }
      $('songs-sort').addEventListener('change', refreshSongs);
      $('song-list').addEventListener('scroll', onSongsScroll, { passive: true });
      window.addEventListener('resize', () => { computeCv(); layout(); });
      // the menu is hidden behind the start screen at boot, so the jukebox has no
      // size yet — relayout the instant it gets real dimensions (start dismissed,
      // orientation change, etc.)
      if (window.ResizeObserver) {
        let lastW = 0;
        const ro = new ResizeObserver(() => {
          const w = jukebox.getBoundingClientRect().width;
          if (w > 0 && Math.abs(w - lastW) > 1) { lastW = w; computeCv(); layout(); }
        });
        ro.observe(jukebox);
      }
      // R-2 welcome-back card: fire when the library screen (#menu) becomes active — robust to the
      // hub→library nav path where render() ran on catalog-boot (before #menu was on screen).
      try {
        const menuEl = $('menu');
        if (menuEl && window.MutationObserver) {
          const mo = new MutationObserver(() => { if (menuEl.classList.contains('active')) { maybeWelcomeCard(); renderStreakChip(); } });
          mo.observe(menuEl, { attributes: true, attributeFilter: ['class'] });
        }
      } catch (e) {}
      // B1: the reclaim deltas land ASYNC (endpoint 404s today → usually never). When they DO arrive,
      // RhythmCatalog dispatches 'rr:reclaim' once — promote the (already-shown) welcome card to the
      // top-priority reclaim branch a single time. Listen ONCE; the upgrade reuses the one-per-session slot.
      try { window.addEventListener('rr:reclaim', () => { try { maybeWelcomeCard({ reclaimUpgrade: true }); } catch (e) {} }, { once: true }); } catch (e) {}
    }
    computeCv();
    // GOLDEN BUZZER coverflow rail: reveal its tab ONLY when the backend has flagged winners (else stays hidden →
    // no empty rail). Runs on every render (outside the build-once guard) so it lights up if winners arrive post-boot.
    { const gbTab = $('jb-tabs') && $('jb-tabs').querySelector('[data-sec="golden"]');
      if (gbTab) {
        const hasGb = !!(RC().goldenBuzzerTracks && RC().goldenBuzzerTracks().length);
        gbTab.hidden = !hasGb;
        // if the hidden golden rail was somehow the active section (winners cleared), fall back to a real one
        if (!hasGb && sectionKey === 'golden') sectionKey = 'new';
      }
    }
    setSection(sectionKey);
    showView('jukebox');
    startHubBed();   // build158: begin the ambient hub-bed poll (idempotent; audible only on the library surfaces, ducked under previews/runs)
    maybeWelcomeCard();   // R-2: try once now (covers the case where #menu is already active); the observer catches later activation
    renderStreakChip();   // R-4: always-on daily-streak chip (self-guards to nothing when there's no live streak)
    // catalog count indicator (playable songs; refreshes as the library grows)
    const lr = $('lib-ready');
    if (lr) {
      const n = RC().totalCount();
      lr.style.display = ''; lr.innerHTML = '<i></i>' + n + ' song' + (n === 1 ? '' : 's');
    }
  }

  function relayout() { if (stage && jukebox) { computeCv(); layout(); } }

  // append a rounded-rect subpath (caller batches a single fill for one glow pass)
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
  }

  // =========================================================================
  // LIVE WAVEFORM — a canvas spectrum driven by the ACTUAL song-preview audio
  // (real FFT via RhythmCatalog.previewSpectrum). Symmetric "butterfly" bars:
  // bass in the center, treble at the edges, extending up + down from a center
  // seam. Falls back to a gentle procedural idle when no audio is flowing
  // (autoplay-blocked / CORS-tainted / nothing playing). Replaces the faux EQ.
  // =========================================================================
  (function waveLoop() {
    const cv = $('jb-wave');
    if (!cv || !cv.getContext) { setTimeout(waveLoop, 400); return; }  // markup not ready yet
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    const freq = new Uint8Array(256);
    let bars = [];          // eased per-bar amplitudes (0..1)
    let pulse = 0;          // smoothed bass pulse → global "breathing" scale
    let phase = 0;          // idle animation phase
    function resize() {
      const r = cv.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      const d = Math.min(2, window.devicePixelRatio || 1);
      if (w === W && h === H && d === dpr) return;
      W = w; H = h; dpr = d;
      cv.width = Math.round(w * d); cv.height = Math.round(h * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    function draw() {
      requestAnimationFrame(draw);
      const active = $('view-jukebox') && $('view-jukebox').classList.contains('active') &&
                     $('menu') && $('menu').classList.contains('active');
      if (!active) { if (W) ctx.clearRect(0, 0, W, H); return; }
      resize();
      ctx.clearRect(0, 0, W, H);

      let N = Math.max(24, Math.min(96, Math.floor(W / 9))); if (N % 2) N--;   // even → symmetric
      if (bars.length !== N) bars = new Array(N).fill(0);
      const half = N / 2;

      const C = RC();
      const playing = !!(C && C.previewPlaying && C.previewPlaying());
      const got = !!(C && C.previewSpectrum && C.previewSpectrum(freq));
      const usable = (C && C.previewBinCount && C.previewBinCount()) ? Math.min(96, C.previewBinCount()) : 96;

      let bass = 0;
      if (got) { for (let i = 1; i < 6; i++) bass += freq[i]; bass = (bass / 5) / 255; }
      pulse += ((got ? bass : 0) - pulse) * 0.18;
      phase += 0.045;

      for (let h = 0; h < half; h++) {
        let amp;
        if (playing && got) {
          const f = h / half; const bin = Math.min(usable - 1, Math.floor(f * f * usable));
          amp = (freq[bin] / 255) * 1.35;                      // boost the gentle preview level
        } else {
          const base = playing ? 0.30 : 0.12;                  // livelier when audio is on but untapped
          amp = base + Math.abs(Math.sin(phase + h * 0.5)) * (playing ? 0.34 : 0.14)
                     + Math.sin(phase * 1.7 - h * 0.3) * 0.05;
        }
        amp = Math.max(0, Math.min(1, amp));
        const li = half - 1 - h;                                // mirror outward from the center
        bars[li] += (amp - bars[li]) * 0.35;
        bars[half + h] = bars[li];
      }

      const slot = W / N, bw = Math.max(2, slot * 0.62), cy = H / 2;
      const maxH = (H / 2) * (0.9 + pulse * 0.22);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0.0, '#ff7a4a');
      grad.addColorStop(0.5, '#ff1f2e');
      grad.addColorStop(1.0, '#ff7a4a');
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const bh = Math.max(1.5, bars[i] * maxH);
        rrect(ctx, i * slot + (slot - bw) / 2, cy - bh, bw, bh * 2, 3);
      }
      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(255,42,48,0.55)';
      ctx.shadowBlur = 8 + pulse * 14;
      ctx.fill();
      ctx.shadowBlur = 0;
      // bright center seam for that game-HUD readout feel
      ctx.fillStyle = 'rgba(255,224,205,0.45)';
      ctx.fillRect(0, cy - 0.5, W, 1);
    }
    requestAnimationFrame(draw);
  })();

  // =========================================================================
  // "RUN THIS DOWN" (Wave 4) — ghost chase from the per-song leaderboard. Turns
  // the leaderboard from a reading room into a race: each rival row (and the
  // "X pts to pass …" chase card) gets a compact gold target button that
  // relaunches THIS board's track carrying the engine's DISPLAY-ONLY ghost
  // target — RhythmCatalog.launchTrack({targetScore,targetName}) → the existing
  // setGhostTarget seam → game.js's gold "🎯 BEAT <name>" HUD pill + one-time
  // "BEAT IT! 🏆" flash. CEILING-SAFE: the target is cosmetic; no scoring path
  // is touched. The board itself is rendered by index.html's inline leaderboard
  // script (not this file), so this is pure PROGRESSIVE ENHANCEMENT — a
  // MutationObserver augments the rendered rows + a delegated click launches —
  // and it FAILS SOFT (simply omits the button) whenever a single real track or
  // a positive numeric score can't be resolved.
  // =========================================================================
  (function ghostChase() {
    const screen = $('leaderboard-screen');
    const board = $('lbd-board');
    if (!screen || !board) { setTimeout(ghostChase, 500); return; }   // markup not parsed yet — retry (mirrors waveLoop's defensive boot)

    const chase = $('lbd-chase');
    const songbar = $('lbd-songbar');   // visible ONLY on the By-Song tab → the one board that maps to a single track
    const pickT = $('lbd-pick-t');      // the picked track's title (header)
    const pickA = $('lbd-pick-a');      // the picked track's artist (header)
    const pickArt = $('lbd-pick-art');  // header artwork (an <img src> when set) — tie-breaker

    let lastPickId = '';   // exact track id captured from an explicit picker click (most reliable resolver)

    function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
    function playable(t) {
      try { const C = RC(); return !!(t && C && (!C.trackReady || C.trackReady(t)) && !(C.isVideo && C.isVideo(t))); }
      catch (e) { return !!t; }
    }
    // Resolve the ONE track this By-Song board is showing. Prefer the exact id captured from a
    // picker click (validated against the current header title, so a later defaultPick reseed
    // can't leave a stale id); else match the header title (+ artist / artwork) against the
    // catalog, accepting ONLY an unambiguous, playable hit. null → caller omits every button.
    function resolveTrack() {
      let C; try { C = RC(); } catch (e) { C = null; }
      if (!C || !C.allTracks) return null;
      const headTitle = pickT ? norm(pickT.textContent) : '';
      if (!headTitle || headTitle === 'choose a track') return null;
      let all; try { all = C.allTracks() || []; } catch (e) { return null; }
      if (lastPickId) {
        const byId = all.filter((t) => t && t.id === lastPickId)[0];
        if (byId && norm(byId.title) === headTitle && playable(byId)) return byId;   // exact + fresh
      }
      const headArtist = pickA ? norm(pickA.textContent) : '';
      let matches = all.filter((t) => t && norm(t.title) === headTitle);
      if (headArtist && headArtist !== 'tap to pick') {
        const withArtist = matches.filter((t) => norm(t.artist_name || t.artist_credit_name || '') === headArtist);
        if (withArtist.length) matches = withArtist;
      }
      matches = matches.filter(playable);
      if (matches.length > 1 && pickArt) {   // disambiguate a title/artist tie by the header artwork
        const img = pickArt.querySelector('img');
        const src = img ? norm(img.getAttribute('src')) : '';
        if (src) { const byArt = matches.filter((t) => norm(t.artwork_url || '') === src); if (byArt.length === 1) return byArt[0]; }
      }
      return matches.length === 1 ? matches[0] : null;   // ambiguous / none → fail soft
    }

    function digits(s) { const n = parseInt(String(s == null ? '' : s).replace(/[^\d]/g, ''), 10); return isFinite(n) ? n : 0; }
    function rowName(el) {
      try {
        const nameEl = el.querySelector('.lb-name, .lb-pod-name');
        if (!nameEl) return '';
        const clone = nameEl.cloneNode(true);
        const sub = clone.querySelector('.lb-sub'); if (sub) sub.remove();   // drop the " · SUB" chip the render appends
        return (clone.textContent || '').replace(/\s+/g, ' ').trim();
      } catch (e) { return ''; }
    }
    const PLACEHOLDER = { 'your best': 1, 'you': 1, 'unclaimed': 1 };   // local/self rows — never a rival to race
    function isRival(el, name) {
      if (!el || el.classList.contains('you')) return false;   // GATE: can't race yourself
      const n = norm(name);
      if (!n || PLACEHOLDER[n]) return false;                  // placeholder / your-own local rows
      return true;
    }
    function mkBtn(score, name) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rr-rtd';
      b.setAttribute('data-score', String(score));
      b.setAttribute('data-name', name);
      b.setAttribute('aria-label', 'Run this down — race ' + name + ' at ' + Number(score).toLocaleString() + ' points');
      b.innerHTML = '<span class="rr-rtd-ico" aria-hidden="true">🎯</span><span class="rr-rtd-t">RUN THIS DOWN</span>';
      return b;
    }

    let pending = 0;
    // coalesce a burst of render mutations, then augment once the DOM settles. setTimeout (not rAF)
    // so it still fires when the tab is backgrounded / idle — rAF is throttled there and would strand the buttons.
    const obs = new MutationObserver(() => { if (pending) return; pending = setTimeout(() => { pending = 0; augment(); }, 16); });
    function augment() {
      const onSong = !!(songbar && !songbar.hidden);
      obs.disconnect();   // our own DOM writes below must not re-trigger the observer (no feedback loop)
      try {
        // wipe any prior buttons first so a tab / track / difficulty change never leaves a stale target
        screen.querySelectorAll('.rr-rtd').forEach((n) => { if (n.parentNode) n.parentNode.removeChild(n); });
        screen.querySelectorAll('.rr-rtd-host').forEach((n) => n.classList.remove('rr-rtd-host'));
        if (!onSong) return;                       // GATE: only the By-Song board maps to a single track
        const track = resolveTrack();
        if (!track) return;                        // GATE: no resolvable real track → no buttons (fail soft)
        board.querySelectorAll('.lb-row, .lb-pod').forEach((el) => {
          const name = rowName(el);
          if (!isRival(el, name)) return;
          const scoreEl = el.querySelector('.lb-score, .lb-pod-score');
          const score = scoreEl ? digits(scoreEl.textContent) : 0;
          if (!(score > 0)) return;                // GATE: zero / invalid score → no button
          el.classList.add('rr-rtd-host');
          el.appendChild(mkBtn(score, name));
        });
        // chase card "X pts to pass <name>" → race the player directly above you (read their row score)
        if (chase && !chase.hidden && chase.textContent) {
          let above = '';
          try { const bEl = chase.querySelector('b'); above = bEl ? (bEl.textContent || '').replace(/\s+/g, ' ').trim() : ''; } catch (e) {}
          if (above) {
            let aScore = 0;
            board.querySelectorAll('.lb-row, .lb-pod').forEach((el) => {
              if (aScore || el.classList.contains('you')) return;
              if (norm(rowName(el)) === norm(above)) { const sEl = el.querySelector('.lb-score, .lb-pod-score'); aScore = sEl ? digits(sEl.textContent) : 0; }
            });
            if (aScore > 0) chase.appendChild(mkBtn(aScore, above));
          }
        }
      } catch (e) {} finally {
        obs.observe(board, { childList: true, subtree: true });
        if (chase) obs.observe(chase, { childList: true, subtree: true });
      }
    }

    // capture an explicit pick (picker rows carry data-id) — capture phase so we see it before the inline handler
    screen.addEventListener('click', (e) => {
      try { const row = e.target && e.target.closest && e.target.closest('.lbd-res-row[data-id]'); if (row) lastPickId = row.getAttribute('data-id') || ''; } catch (err) {}
    }, true);

    // click a RUN THIS DOWN button → launch the ghost duel on this board's track
    screen.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('.rr-rtd');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      let score = 0; try { score = parseInt(btn.getAttribute('data-score'), 10) || 0; } catch (err) {}
      if (!(score > 0)) return;
      const name = (btn.getAttribute('data-name') || '').slice(0, 22);   // truncate sanely for the HUD pill
      const track = resolveTrack();
      let C; try { C = RC(); } catch (err) { C = null; }
      if (!track || !C || !C.launchTrack) return;   // fail soft — nothing launchable
      let ok = false;
      try { ok = !!C.launchTrack(track, { targetScore: score, targetName: name }); } catch (err) { ok = false; }
      if (ok) {   // close the overlay so the run is visible (mirrors launchLevel's close())
        try { const p = $('lbd-picker'); if (p) p.hidden = true; } catch (err) {}
        try { screen.classList.remove('active'); } catch (err) {}
      }
    });

    obs.observe(board, { childList: true, subtree: true });
    if (chase) obs.observe(chase, { childList: true, subtree: true });
    augment();
  })();

  window.RhythmLibrary = { render, showView, relayout };
})();
