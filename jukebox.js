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
      im.src = t.artwork_url; art.style.display = ''; mark.textContent = '';
      let ri = refl.querySelector('img'); if (!ri) { ri = document.createElement('img'); refl.appendChild(ri); } ri.src = t.artwork_url;
    } else { art.innerHTML = ''; mark.textContent = initial(t.title); refl.innerHTML = ''; }
    // grade chip
    const best = RC().getBest(t.id);
    const gc = el.querySelector('.cover-grade');
    if (best) { gc.style.display = 'flex'; gc.textContent = best.grade; gc.className = 'cover-grade ' + gradeClass(best.grade); }
    else gc.style.display = 'none';
    // AI-radio badges (Golden Buzzer / judge grade / hot) — from the backend `badges` field (BADGES_BACKEND_BRIEF.md).
    // Renders nothing until the backend ships the field; chips are built as DOM nodes (textContent → injection-safe).
    const bc = el.querySelector('.cover-badges');
    if (bc) {
      bc.innerHTML = '';
      const badges = Array.isArray(t.badges) ? t.badges : [];
      badges.slice(0, 3).forEach(b => {
        if (!b || !b.type) return;
        const chip = document.createElement('span');
        let cls = 'cbadge', txt = '';
        if (b.type === 'golden_buzzer') { return; }   /* Golden Buzzer now has its OWN dedicated treatment (ring/crown/tag below) driven by the golden_buzzer field — skip the badges-array chip so there's one source of truth, no double-mark */
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
    if (best) bits.push('BEST ' + best.grade + ' · ' + Number(best.score).toLocaleString());
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
    try { var _ac = $('jb-allcount'); if (_ac) { var _n = (RC().allTracks() || []).length; _ac.textContent = _n ? ' · ' + _n : ''; } } catch (e) {}
    // build96 (playtest): surface AI FLIXS as a first-class jukebox button (was only buried inside Browse → owner couldn't find it)
    try { var _fx = $('jb-flixs'), _fc = $('jb-flixscount'), _nv = (RC().videoCount ? RC().videoCount() : 0); if (_fx) _fx.hidden = !_nv; if (_fc) _fc.textContent = _nv ? ' · ' + _nv : ''; } catch (e) {}
    pos = 0; target = 0;
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
    // ---- genres: count desc, Uncategorized pinned LAST ----
    const all = RC().genreList().slice();
    const uncat = [], named = [];
    all.forEach(g => { (g.name === UNCAT_GENRE ? uncat : named).push(g); });
    named.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const genres = named.concat(uncat);   // Uncategorized always at the end

    // ---- top-genres quick-pick strip (top 5 by count, skip Uncategorized) ----
    renderTopGenreStrip(named.slice(0, 5));

    const gg = $('genre-grid'); gg.innerHTML = '';
    // ---- AI FLIXS — cinematic hero entry (full-width), grouped OUT of the music genres ----
    const nVid = RC().videoCount ? RC().videoCount() : 0;
    if (nVid > 0) {
      const vt = document.createElement('button');
      vt.className = 'flixs-hero-card';
      vt.innerHTML = '<span class="fh-badge">AI FLIXS</span>' +
        '<span class="fh-sub">Music videos &amp; AI films</span>' +
        '<span class="fh-count">' + nVid + ' film' + (nVid !== 1 ? 's' : '') + ' ▶</span>';
      // 6th arg = posterMode (poster grid); scope defaults to 'flixs' (videos-only) from isVid
      vt.addEventListener('click', () => openSongs(RC().videoTracks(), 'AI Flixs', 'browse', '', true, true));
      gg.appendChild(vt);
    }
    genres.forEach(g => {
      const isUncat = g.name === UNCAT_GENRE;
      const label = isUncat ? UNCAT_LABEL : g.name;
      const t = document.createElement('button');
      t.className = 'genre-tile'; setPal(t, label);
      t.innerHTML = '<span class="gt-name">' + RC().escapeHtml(label) + '</span><span class="gt-count">' + g.count + ' track' + (g.count !== 1 ? 's' : '') + '</span>';
      t.addEventListener('click', () => openSongs(RC().byGenre(g.name), label, 'browse'));
      gg.appendChild(t);
    });

    // ---- artists: multi-track keep their own tile, 1-track folded into Various Artists ----
    const ag = $('artist-grid'); ag.innerHTML = '';
    const artists = RC().artistList();
    const solo = [];   // {name} of artists with exactly one track
    artists.forEach(a => {
      if (a.count <= 1) { solo.push(a); return; }
      const t = document.createElement('button');
      t.className = 'artist-tile';
      const av = document.createElement('span'); av.className = 'at-avatar'; setPal(av, a.name); av.textContent = initial(a.name);
      const tx = document.createElement('span'); tx.className = 'at-text';
      tx.innerHTML = '<span class="at-name">' + RC().escapeHtml(a.name) + '</span><span class="at-count">' + a.count + ' song' + (a.count !== 1 ? 's' : '') + '</span>';
      t.appendChild(av); t.appendChild(tx);
      t.addEventListener('click', () => openSongs(RC().byArtist(a.name), a.name, 'browse'));
      ag.appendChild(t);
    });
    if (solo.length) {
      const label = 'Various Artists';
      const t = document.createElement('button');
      t.className = 'artist-tile';
      const av = document.createElement('span'); av.className = 'at-avatar'; setPal(av, label); av.textContent = '♪';
      const tx = document.createElement('span'); tx.className = 'at-text';
      tx.innerHTML = '<span class="at-name">' + label + '</span><span class="at-count">' + solo.length + ' artist' + (solo.length !== 1 ? 's' : '') + '</span>';
      t.appendChild(av); t.appendChild(tx);
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
      artEl.className = 'sc-art'; artEl.loading = 'lazy'; artEl.src = t.artwork_url;
      artEl.onerror = () => artEl.replaceWith(procArt(t));
    } else {
      artEl = procArt(t);
    }
    card.appendChild(artEl);
    // text
    const text = document.createElement('span'); text.className = 'sc-text';
    const sub = [t.artist_name, RC().cleanGenre(t.genre), t.bpm ? t.bpm + ' BPM' : '', RC().fmtDur(t.duration_seconds)].filter(Boolean).join(' · ');
    text.innerHTML = '<span class="sc-title">' + RC().escapeHtml(t.title) + '</span><span class="sc-sub">' + RC().escapeHtml(sub) + '</span>';
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
  function flixsHero(t) {
    if (!t) return null;
    const hero = document.createElement('div');
    hero.className = 'flixs-marquee';
    const poster = RC().posterFor(t) || '';
    const runtime = RC().fmtDur(t.duration_seconds) || '';
    const genre = RC().cleanGenre(t.genre) || '';
    const artist = t.artist_name || '';
    const statsParts = ['★ AI FILM', runtime, genre].filter(Boolean);
    // build99c: data-gap films (no runtime/genre) showed a lone star-AI-FILM row + a separate by-line (two stunted
    // lines). Fold the artist INTO the stat row in that case and drop the by-line.
    let byLine = artist ? 'by ' + artist : '';
    if (statsParts.length === 1 && artist) { statsParts.push(artist); byLine = ''; }
    const stats = statsParts.join(' · ');
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
    if (poster) { const bg = hero.querySelector('.fm-bg'); if (bg) bg.style.backgroundImage = 'url("' + poster.replace(/"/g, '%22') + '")'; }
    const pb = hero.querySelector('.fm-play'); if (pb) pb.addEventListener('click', (e) => { e.stopPropagation(); RC().playFlix(t); });
    const ib = hero.querySelector('.fm-info'); if (ib) ib.addEventListener('click', (e) => { e.stopPropagation(); RC().openSheet(t); });
    return hero;
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
      img.onerror = () => { img.remove(); fr.classList.add('vc-noart'); };
      fr.appendChild(img);
    } else { fr.classList.add('vc-noart'); }
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
      const hero = flixsHero(songsList[0]);
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
    }
    computeCv();
    setSection(sectionKey);
    showView('jukebox');
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
  window.RhythmLibrary = { render, showView, relayout };
})();
