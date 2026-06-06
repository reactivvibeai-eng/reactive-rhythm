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
    ['#414b59', '#0e1116'], // chrome slate
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
    pos = 0; target = 0;
    [...$('jb-tabs').children].forEach(b => b.classList.toggle('active', b.dataset.sec === key));
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
      if (e.key === 'ArrowLeft') { goTo(Math.round(pos) - 1); }
      else if (e.key === 'ArrowRight') { goTo(Math.round(pos) + 1); }
      else if (e.key === 'Enter') { const t = jbList[Math.round(pos)]; if (t) RC().openSheet(t); }
    });
  }

  // =========================================================================
  // BROWSE (genre + artist tiles)
  // =========================================================================
  function renderBrowse() {
    const gg = $('genre-grid'); gg.innerHTML = '';
    RC().genreList().forEach(g => {
      const t = document.createElement('button');
      t.className = 'genre-tile'; setPal(t, g.name);
      t.innerHTML = '<span class="gt-name">' + RC().escapeHtml(g.name) + '</span><span class="gt-count">' + g.count + ' track' + (g.count !== 1 ? 's' : '') + '</span>';
      t.addEventListener('click', () => openSongs(RC().byGenre(g.name), g.name, 'browse'));
      gg.appendChild(t);
    });
    const ag = $('artist-grid'); ag.innerHTML = '';
    RC().artistList().forEach(a => {
      const t = document.createElement('button');
      t.className = 'artist-tile';
      const av = document.createElement('span'); av.className = 'at-avatar'; setPal(av, a.name); av.textContent = initial(a.name);
      const tx = document.createElement('span'); tx.className = 'at-text';
      tx.innerHTML = '<span class="at-name">' + RC().escapeHtml(a.name) + '</span><span class="at-count">' + a.count + ' song' + (a.count !== 1 ? 's' : '') + '</span>';
      t.appendChild(av); t.appendChild(tx);
      t.addEventListener('click', () => openSongs(RC().byArtist(a.name), a.name, 'browse'));
      ag.appendChild(t);
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
  const PAGE = 40;

  function openSongs(list, title, ret, q) {
    songsBase = list || [];
    songsReturn = ret || 'jukebox';
    $('songs-title').textContent = title || 'All Songs';
    $('songs-search').value = q || '';
    $('songs-sort').value = 'new';
    showView('songs');
    refreshSongs();
  }

  function currentSongs() {
    let list = songsBase;
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
    card.appendChild(text);
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

  function refreshSongs() {
    const host = $('song-list');
    host.innerHTML = '';
    songsRendered = 0;
    songsList = currentSongs();
    $('songs-count').textContent = songsList.length + '';
    if (!songsList.length) { host.innerHTML = '<div class="lib-empty">No songs match.</div>'; return; }
    host.scrollTop = 0;
    appendSongs();
    fillViewport();
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
    for (let i = songsRendered; i < end; i++) frag.appendChild(songCard(songsList[i]));
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
      $('lib-search-btn').addEventListener('click', () => { const i = $('lib-search-input'); if (i) i.focus(); openSongs(RC().allTracks(), 'All Songs', 'jukebox'); });
      // prominent header search — type to find any song/artist across the whole library
      { const lsi = $('lib-search-input'), lsx = $('lib-search-clear'); let lsdt = 0;
        const run = () => {
          const q = (lsi.value || '').trim();
          if (lsx) lsx.hidden = !q;
          if (q) openSongs(RC().allTracks(), 'Search · “' + q + '”', 'jukebox', q);
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
      $('songs-search').addEventListener('input', () => { clearTimeout(dbt); dbt = setTimeout(refreshSongs, 160); });
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
  // reactive now-playing EQ visualizer under the focused cover
  (function eqLoop() {
    const eq = $('jb-eq');
    if (eq) {
      const bars = eq.children, active = $('view-jukebox') && $('view-jukebox').classList.contains('active') && $('menu') && $('menu').classList.contains('active');
      for (let i = 0; i < bars.length; i++) {
        const h = active ? (18 + Math.abs(Math.sin(Date.now() / 380 + i * 0.6)) * 64 + Math.random() * 14) : 8;
        bars[i].style.height = Math.min(100, h) + '%';
      }
    }
    setTimeout(eqLoop, 110);
  })();
  window.RhythmLibrary = { render, showView, relayout };
})();
