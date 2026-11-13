/* Print Archive PWA — vanilla JS, no build step. Demo mode (bundled example data) or Live mode (LAN helper). */
(() => {
  'use strict';
  const VERSION = self.PA_VERSION || 'dev';
  const LS = { helper: 'pa.helperUrl', token: 'pa.token', cache: 'pa.cache', demoNotes: 'pa.demoNotes', demoCfg: 'pa.demoCapture' };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { mode: 'demo', base: '', online: true, status: null, prints: [], swCache: null, filters: { q: '', date: 'all', fil: '', status: '', label: '' }, scroll: {}, test: null };

  if (new URLSearchParams(location.search).has('sim')) document.documentElement.classList.add('sim-iphone');

  // ---------- formatting ----------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = iso => (iso ? new Date(iso) : null);
  const fmtDate = iso => { const x = d(iso); return x ? `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}` : '—'; };
  const fmtShort = iso => { const x = d(iso); return x ? `${x.getDate()} ${MONTHS[x.getMonth()]}` : '—'; };
  const fmtTime = iso => { const x = d(iso); if (!x) return ''; let h = x.getHours(); const m = String(x.getMinutes()).padStart(2, '0'); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}:${m} ${ap}`; };
  const fmtDur = s => { if (s == null || isNaN(s)) return '—'; const m = Math.round(s / 60); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`; };
  const fmtDurShort = s => { if (s == null) return ''; const m = Math.round(s / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const fmtSize = b => (b == null ? '—' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
  const fmtAgo = iso => { const x = d(iso); if (!x) return '—'; const s = (Date.now() - x) / 1000; if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; const dd = Math.round(s / 86400); return dd < 30 ? `${dd} day${dd > 1 ? 's' : ''} ago` : fmtShort(iso); };
  const g = n => (n == null ? '—' : `${(+n).toFixed(1)} g`);
  const LABEL = { mesh: ['mesh', 'Mesh included'], sliced: ['sliced', 'Sliced only'], stl: ['stl', 'STL attached'] };
  const badge = l => { const [c, t] = LABEL[l] || LABEL.sliced; return `<span class="badge ${c}">${t}</span>`; };
  const sw = c => `<span class="swatch" style="background:${esc(c || '#555')}"></span>`;
  const STATE = { IDLE: 'Idle', FINISH: 'Idle', FAILED: 'Idle', RUNNING: 'Printing', PREPARE: 'Preparing', PAUSE: 'Paused', SLICING: 'Preparing', OFFLINE: 'Offline', UNKNOWN: 'Connecting' };
  const colourName = hex => { const m = /^#?([0-9a-f]{6})/i.exec(hex || ''); if (!m) return ''; const n = parseInt(m[1], 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255];
    const P = [['Black', [20, 20, 20]], ['White', [245, 245, 245]], ['Grey', [128, 128, 128]], ['Green', [0, 174, 66]], ['Orange', [255, 122, 26]], ['Red', [220, 40, 40]], ['Blue', [30, 90, 220]], ['Yellow', [245, 210, 30]], ['Purple', [130, 60, 200]], ['Pink', [240, 120, 170]]];
    let b = '', bd = 1e9; for (const [k, r] of P) { const dd = (c[0] - r[0]) ** 2 + (c[1] - r[1]) ** 2 + (c[2] - r[2]) ** 2; if (dd < bd) { bd = dd; b = k; } } return b; };

  // ---------- data layer ----------
  const url = p => (p && /^(https?:|data:|blob:)/.test(p) ? p : S.base + p);
  const headers = () => { const h = { 'Content-Type': 'application/json' }; const t = localStorage.getItem(LS.token); if (t) h['X-Archive-Token'] = t; return h; };
  async function fetchJSON(path, opts = {}, timeout = 8000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url(path), { ...opts, headers: { ...headers(), ...(opts.headers || {}) }, signal: ctl.signal, cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
      return j;
    } finally { clearTimeout(t); }
  }
  const demoNotes = () => JSON.parse(localStorage.getItem(LS.demoNotes) || '{}');

  async function detectMode() {
    const saved = localStorage.getItem(LS.helper);
    if (saved === 'demo') return { mode: 'demo', base: '' };
    if (saved) return { mode: 'live', base: saved.replace(/\/?$/, '/') };
    try { const s = await fetchJSON('api/status', {}, 2500); if (s && s.app === 'print-archive') return { mode: 'live', base: '' }; } catch { /* not served by a helper */ }
    return { mode: 'demo', base: '' };
  }

  async function load() {
    if (S.mode === 'demo') {
      const j = await (await fetch('demo/prints.json')).json();
      const notes = demoNotes();
      const cap = JSON.parse(localStorage.getItem(LS.demoCfg) || 'null');
      S.status = { ...j.status, capture: cap || j.status.capture };
      S.prints = j.prints.map(p => (p.id in notes ? { ...p, notes: notes[p.id] } : p));
      S.online = true; return;
    }
    try {
      const [st, pr] = await Promise.all([fetchJSON('api/status'), fetchJSON('api/prints')]);
      S.status = st; S.prints = pr.prints; S.online = true;
      try { localStorage.setItem(LS.cache, JSON.stringify({ base: S.base, status: st, prints: pr.prints, at: Date.now() })); } catch {}
    } catch (e) {
      S.online = false;
      const c = JSON.parse(localStorage.getItem(LS.cache) || 'null');
      if (c && c.base === S.base) { S.status = c.status; S.prints = c.prints; S.cachedAt = c.at; }
      else { S.status = null; S.prints = []; }
      S.loadError = e.message;
    }
  }

  const api = {
    async saveNotes(id, notes) {
      if (S.mode === 'demo') { const n = demoNotes(); n[id] = notes; localStorage.setItem(LS.demoNotes, JSON.stringify(n)); }
      else await fetchJSON(`api/prints/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ notes }) });
      const p = S.prints.find(x => x.id === id); if (p) p.notes = notes;
    },
    async reprint(id, body) {
      if (S.mode === 'demo') { await new Promise(r => setTimeout(r, 900)); return { ok: true, demo: true, plate: body.plate || 1 }; }
      return fetchJSON(`api/prints/${encodeURIComponent(id)}/reprint`, { method: 'POST', body: JSON.stringify(body) }, 120000);
    },
    async test() {
      if (S.mode === 'demo') { await new Promise(r => setTimeout(r, 600)); return { mqtt: true, ftps: true, firmware: S.status.printer.firmware, demo: true }; }
      return fetchJSON('api/printer/test', { method: 'POST', body: '{}' }, 40000);
    },
    async config(patch) {
      if (S.mode === 'demo') {
        if (patch.capture) { S.status.capture = { ...S.status.capture, ...patch.capture }; localStorage.setItem(LS.demoCfg, JSON.stringify(S.status.capture)); }
        if (patch.printer) Object.assign(S.status.printer, patch.printer.ip ? { ip: patch.printer.ip } : {}, patch.printer.serial ? { serial: patch.printer.serial } : {});
        return;
      }
      const r = await fetchJSON('api/config', { method: 'PATCH', body: JSON.stringify(patch) }); S.status = r.status;
    },
  };

  // ---------- chrome ----------
  function pill() {
    const st = S.status && S.status.printer;
    if (!S.online) return `<div class="pill"><span class="dot off"></span>Helper offline</div>`;
    if (!st || !st.configured) return `<div class="pill"><span class="dot off"></span>No printer</div>`;
    const name = st.model || st.name || 'Printer';
    if (!st.connected) return `<div class="pill"><span class="dot off"></span>${esc(name)} · Offline</div>`;
    const active = ['RUNNING', 'PREPARE', 'PAUSE'].includes(st.state);
    const label = STATE[st.state] || 'Idle';
    return `<div class="pill"><span class="dot${active ? ' busy' : ''}"></span>${esc(name)} · ${esc(label)}${st.state === 'RUNNING' && st.percent != null ? ` ${st.percent}%` : ''} · LAN</div>`;
  }
  function header(title, back) {
    $('#top').innerHTML = back
      ? `<div class="nav-left"><button class="back-btn" data-act="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h1 class="small">${esc(title)}</h1></div>${pill()}`
      : `<h1>${esc(title)}</h1>${pill()}`;
  }
  function banner() {
    const b = $('#banner');
    if (S.mode === 'demo') { b.className = 'demo-banner'; b.innerHTML = `<span><b>Demo data</b> · example prints, nothing is sent</span><a href="#/settings">Connect helper</a>`; b.hidden = false; }
    else if (!S.online) { b.className = 'demo-banner offline'; b.innerHTML = `<span><b>Helper offline</b>${S.cachedAt ? ` · showing saved copy from ${fmtAgo(new Date(S.cachedAt).toISOString())}` : ''}</span><a href="#" data-act="retry">Retry</a>`; b.hidden = false; }
    else b.hidden = true;
  }
  function tabs(active) { document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === active)); }
  function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }
  const img = (p, cls = '') => (p.thumbUrl ? `<img class="${cls}" src="${esc(url(p.thumbUrl))}" alt="" loading="lazy">` : `<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#444" stroke-width="1.5"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>`);

  // ---------- screens ----------
  function dashboard() {
    header('Dashboard'); tabs('dashboard');
    const P = S.prints, now = new Date();
    const month = P.filter(p => { const x = d(p.finishedAt); return x && x.getMonth() === now.getMonth() && x.getFullYear() === now.getFullYear(); });
    const grams = P.reduce((a, p) => a + (p.filamentGrams || 0), 0);
    const hours = P.reduce((a, p) => a + (p.actualSeconds || 0), 0) / 3600;
    const byFil = {};
    for (const p of P) for (const f of (p.filaments && p.filaments.length ? p.filaments : [])) {
      const k = f.label || f.type || 'Unknown'; byFil[k] = byFil[k] || { name: k, color: f.color, g: 0 }; byFil[k].g += f.grams || 0;
    }
    const fils = Object.values(byFil).sort((a, b) => b.g - a.g).slice(0, 5);
    const max = fils[0] ? fils[0].g : 1;
    const kg = grams >= 1000 ? `${(grams / 1000).toFixed(1)}<span> kg</span>` : `${Math.round(grams)}<span> g</span>`;
    $('#main').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="stat-label">Total prints</div><div class="stat-value">${P.length}</div><div class="stat-hint">All archived jobs</div></div>
        <div class="stat"><div class="stat-label">This month</div><div class="stat-value">${month.length}</div><div class="stat-hint">${now.toLocaleString('en-AU', { month: 'long' })} ${now.getFullYear()}</div></div>
        <div class="stat"><div class="stat-label">Filament</div><div class="stat-value">${kg}</div><div class="stat-hint">Running total</div></div>
        <div class="stat"><div class="stat-label">Print hours</div><div class="stat-value">${hours < 10 ? hours.toFixed(1) : Math.round(hours)}</div><div class="stat-hint">Actual time</div></div>
      </div>
      <div class="dash-split">
        <section class="card"><div class="panel-h"><h2>Filaments</h2><small>By mass</small></div><div class="fil-list">
          ${fils.length ? fils.map(f => `<div class="fil-row"><div class="fil-top">${sw(f.color)}<span class="nm">${esc(f.name)}</span><span class="kg">${f.g >= 1000 ? (f.g / 1000).toFixed(2) + ' kg' : Math.round(f.g) + ' g'}</span></div><div class="bar"><i style="width:${Math.max(4, (f.g / max) * 100)}%;background:${esc(f.color || '#555')};${/^#(0|1)[0-9a-f]{5}$/i.test(f.color || '') ? 'background:#555' : ''}"></i></div></div>`).join('') : '<div class="empty">No filament data yet</div>'}
        </div></section>
        <section class="card"><div class="panel-h"><h2>Recent</h2><small>Last 5</small></div>
          ${P.slice(0, 5).map(p => `<a class="recent-row" href="#/print/${encodeURIComponent(p.id)}"><div class="thumb">${img(p)}</div><div><div class="item-name">${esc(p.name)}</div><div class="item-sub">${sw(p.filamentColor)}${fmtShort(p.finishedAt)} · ${p.status === 'failed' ? 'Failed' : fmtDurShort(p.actualSeconds)}</div></div></a>`).join('') || '<div class="empty">No prints archived yet.<br>Finished jobs appear here automatically.</div>'}
        </section>
      </div>`;
  }

  function filtered() {
    const f = S.filters, q = f.q.trim().toLowerCase(), now = Date.now();
    return S.prints.filter(p => {
      if (q && !`${p.name} ${p.fileName} ${p.filamentLabel} ${p.notes || ''}`.toLowerCase().includes(q)) return false;
      if (f.date !== 'all') { const t = d(p.finishedAt); if (!t) return false; if (f.date === 'year') { if (t.getFullYear() !== new Date().getFullYear()) return false; } else if (now - t > +f.date * 86400000) return false; }
      if (f.fil && !(p.filaments || []).some(x => x.label === f.fil) && p.filamentLabel !== f.fil) return false;
      if (f.status && p.status !== f.status) return false;
      if (f.label && p.label !== f.label) return false;
      return true;
    });
  }
  const CHEV = '<svg viewBox="0 0 12 12"><path d="M3 4.5 L6 7.5 L9 4.5"/></svg>';
  function chip(key, title, opts) {
    const v = S.filters[key]; const cur = opts.find(o => o[0] === v);
    const active = key === 'date' ? v !== 'all' : !!v;
    return `<label class="chip${active ? ' active' : ''}">${esc(active ? cur[1] : title)} ${CHEV}<select data-filter="${key}" aria-label="${esc(title)}">${opts.map(o => `<option value="${esc(o[0])}"${o[0] === v ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
  }
  function library() {
    header('Library'); tabs('library');
    const fils = [...new Set(S.prints.flatMap(p => (p.filaments || []).map(x => x.label)).filter(Boolean))].sort();
    const anyActive = S.filters.date !== 'all' || S.filters.fil || S.filters.status || S.filters.label;
    $('#main').innerHTML = `
      <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="q" type="search" placeholder="Search models" value="${esc(S.filters.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="filters">
        ${chip('date', 'Date', [['all', 'All time'], ['30', 'Last 30 days'], ['60', 'Last 60 days'], ['90', 'Last 90 days'], ['year', 'This year']])}
        ${chip('fil', 'Filament', [['', 'All filaments'], ...fils.map(x => [x, x])])}
        ${chip('status', 'Status', [['', 'All statuses'], ['finished', 'Finished'], ['failed', 'Failed']])}
        ${chip('label', 'File type', [['', 'All file types'], ['mesh', 'Mesh included'], ['sliced', 'Sliced only'], ['stl', 'STL attached']])}
        ${anyActive ? '<button class="chip clear" data-act="clear-filters">Clear</button>' : ''}
      </div>
      <div id="grid-wrap"></div>`;
    renderGrid();
  }
  function renderGrid() {
    const list = filtered();
    const wrap = $('#grid-wrap'); if (!wrap) return;
    wrap.innerHTML = `<div style="display:flex;justify-content:flex-end;margin:-4px 2px 8px"><span class="lib-count">${list.length} of ${S.prints.length}</span></div>` + (list.length ? `<div class="grid">${list.map(p => `
      <a class="print-card" href="#/print/${encodeURIComponent(p.id)}">
        <div class="art">${img(p)}${p.status === 'failed' ? '<span class="badge failed">Failed</span>' : ''}${badge(p.label)}</div>
        <div class="meta"><div class="title">${esc(p.name)}</div><div class="date">${fmtDate(p.finishedAt)}</div>
          <div class="foot"><span class="f">${sw(p.filamentColor)}${esc(p.filamentShort || p.filamentType || '—')}</span><span class="grams">${g(p.filamentGrams)}</span></div></div>
      </a>`).join('')}</div>` : `<div class="empty">${S.prints.length ? 'No prints match these filters.' : 'No prints archived yet.'}</div>`);
  }

  function detail(id) {
    const p = S.prints.find(x => x.id === id);
    tabs('library');
    if (!p) { header('Not found', true); $('#main').innerHTML = '<div class="empty">This print is not in the archive.</div>'; return; }
    header(p.name, true);
    const s = p.settings || {};
    const sp = s.speeds || {};
    const est = p.predictionSeconds, act = p.actualSeconds;
    let actCls = '', actSub = '';
    if (p.status === 'failed') { actCls = 'fail'; actSub = 'Stopped early'; }
    else if (est && act != null) { const diff = Math.round((act - est) / 60); actCls = diff <= 0 ? 'good' : 'bad'; actSub = diff === 0 ? 'On estimate' : `${Math.abs(diff)} min ${diff < 0 ? 'under' : 'over'}`; }
    const mesh = p.stl ? esc(p.stl.name) : p.hasMesh ? 'In the 3MF' : 'Not available';
    const printed = p.startedAt ? `${fmtTime(p.startedAt).replace(/ (am|pm)$/, '')}–${fmtTime(p.finishedAt)}` : fmtTime(p.finishedAt);
    const supports = !s.supports || s.supports === 'none' ? 'None' : s.supports.replace(/\(auto\)/, ' (auto)').replace(/^./, c => c.toUpperCase());
    const f0 = (p.filaments || [])[0];
    const share = navigator.share ? `<button class="btn btn-ghost" data-act="share" data-id="${esc(p.id)}">Share</button>` : '';
    $('#main').innerHTML = `
      <div class="hero">
        <div class="hero-art">${img(p)}<div class="badges">${badge(p.label)}${p.status === 'failed' ? '<span class="badge failed">Failed</span>' : ''}</div></div>
        <div class="hero-file">
          <div class="file-name">${esc(p.fileName || p.name)}</div>
          <div class="file-path">~/Print Archive/${esc((p.archivePath || '').replace(/[^/]+$/, ''))}</div>
          <div class="kv-grid">
            <div class="kv"><div class="k">File size</div><div class="v">${fmtSize(p.fileSize)}</div></div>
            <div class="kv"><div class="k">Original mesh</div><div class="v">${mesh}</div></div>
            <div class="kv"><div class="k">Created</div><div class="v">${p.fileCreated ? `${fmtShort(p.fileCreated)}, ${fmtTime(p.fileCreated)}` : '—'}</div></div>
            <div class="kv"><div class="k">Printed</div><div class="v">${fmtShort(p.finishedAt)} · ${printed}</div></div>
          </div>
          ${p.copyError ? `<div class="err-line">3MF could not be copied from the printer: ${esc(p.copyError)}</div>` : ''}
        </div>
      </div>
      <div class="section"><h3>Print settings</h3>
        ${p.settings ? `<div class="kv-grid three">
          <div class="kv"><div class="k">Layer</div><div class="v">${s.layerHeight != null ? s.layerHeight.toFixed(2) + ' mm' : '—'}</div></div>
          <div class="kv"><div class="k">Infill</div><div class="v">${esc([s.infillDensity, s.infillPattern].filter(Boolean).join(' ') || '—')}</div></div>
          <div class="kv"><div class="k">Supports</div><div class="v">${esc(supports)}</div></div>
          <div class="kv"><div class="k">Speed</div><div class="v">${sp.outerWall ? sp.outerWall + ' mm/s' : '—'}</div></div>
          <div class="kv"><div class="k">Nozzle</div><div class="v">${s.nozzleTemp ? s.nozzleTemp + ' °C' : '—'}</div></div>
          <div class="kv"><div class="k">Bed</div><div class="v">${s.bedTemp ? s.bedTemp + ' °C' : '—'}</div></div>
        </div><div class="note-line">Speed is the outer-wall speed. Values come from the 3MF's project settings.</div>` : '<div class="note-line">The printer did not expose print settings for this job.</div>'}
      </div>
      <div class="section"><h3>Filament &amp; time</h3>
        <div class="time-row">
          <div class="time-box"><div class="k">Used</div><div class="v">${g(p.filamentGrams)}</div><div class="s">${p.filamentMeters != null ? p.filamentMeters.toFixed(2) + ' m' : ''}${f0 ? ' · ' + esc(f0.type) : ''}</div></div>
          <div class="time-box"><div class="k">Estimated</div><div class="v">${fmtDur(est)}</div><div class="s">From the 3MF</div></div>
          <div class="time-box"><div class="k">Actual</div><div class="v ${actCls}">${fmtDur(act)}</div><div class="s">${actSub}</div></div>
        </div>
      </div>
      <div class="section"><h3>Notes <span class="saved" id="saved"></span></h3>
        <textarea class="notes" id="notes" rows="3" placeholder="Add a note about this print…" data-id="${esc(p.id)}">${esc(p.notes || '')}</textarea>
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-block" data-act="reprint" data-id="${esc(p.id)}" ${p.fileUrl ? '' : 'disabled'}><svg viewBox="0 0 24 24"><rect x="5" y="9" width="14" height="8" rx="1.5"/><path d="M7 9V5.5h10V9"/><path d="M8 17v3h8v-3"/></svg>Reprint</button>
        <div class="row">
          ${p.fileUrl ? `<a class="btn btn-secondary" href="${esc(url(p.fileUrl))}" download="${esc(p.fileName || p.name + '.3mf')}">Download 3MF</a>` : '<button class="btn btn-secondary" disabled>No 3MF</button>'}
          ${p.stlUrl ? `<a class="btn btn-ghost" href="${esc(url(p.stlUrl))}" download="${esc(p.stl ? p.stl.name : p.name + '.stl')}">Download STL</a>` : share || `<a class="btn btn-ghost" href="${esc(url(p.fileUrl || '#'))}" target="_blank" rel="noopener">Open file</a>`}
        </div>
      </div>`;
    const ta = $('#notes');
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.max(76, ta.scrollHeight + 2) + 'px'; };
    autosize();
    let timer;
    const save = async () => { clearTimeout(timer); const v = ta.value; if (v === (p.notes || '')) return; try { await api.saveNotes(p.id, v); const el = $('#saved'); if (el) { el.textContent = 'Saved'; setTimeout(() => { if (el) el.textContent = ''; }, 1600); } } catch (e) { toast(`Couldn't save note: ${e.message}`); } };
    ta.addEventListener('input', () => { autosize(); clearTimeout(timer); timer = setTimeout(save, 900); });
    ta.addEventListener('blur', save);
  }

  // ---------- reprint sheet ----------
  function openReprint(id) {
    const p = S.prints.find(x => x.id === id); if (!p) return;
    const st = (S.status && S.status.printer) || {};
    const need = (p.filaments || [])[0] || { type: p.filamentType, color: p.filamentColor, label: p.filamentLabel, grams: p.filamentGrams };
    const loaded = st.loaded;
    const mismatch = loaded && need && need.type && (loaded.type !== need.type || colourName(loaded.color) !== colourName(need.color));
    const busy = ['RUNNING', 'PREPARE', 'PAUSE'].includes(st.state);
    const blocked = !S.online ? 'The helper is offline, so nothing can be sent right now.' : !st.connected ? 'The printer is not connected to the helper. Check it is on and in LAN mode.' : busy ? `The printer is busy (${STATE[st.state]}). Wait for the current job to finish.` : !p.fileUrl ? 'No 3MF was archived for this print.' : p.sliced === false ? 'This 3MF has no sliced G-code. Reslice it in Bambu Studio first.' : '';
    const ams = (st.ams || []).length > 0;
    const loadedLabel = loaded ? `${loaded.name && loaded.name !== loaded.type ? loaded.name : loaded.type} ${colourName(loaded.color)}`.trim() : 'Unknown';
    $('#sheet-root').innerHTML = `
      <div class="scrim" data-act="close-sheet"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Reprint">
        <div class="handle"></div>
        <h2>Reprint ${esc(p.name)}</h2>
        <div class="sub">Send the archived 3MF to the printer over your local network.</div>
        <div class="mrow"><div class="lk">Printer</div><div class="lv"><span class="l1">${esc(st.name || st.model || 'Printer')} · ${esc(st.connected ? STATE[st.state] || 'Idle' : 'Offline')}</span><small>${st.connected ? `Connected via LAN · ${esc(st.ip || '')}` : 'Not connected'}</small></div></div>
        <div class="mrow"><div class="lk">Plate</div><div class="lv"><span class="l1">Plate ${p.plate || 1}</span><small>Make sure the build plate is clear</small></div></div>
        <div class="mrow"><div class="lk">Loaded</div><div class="lv"><span class="l1">${loaded ? sw(loaded.color) : ''}${esc(loadedLabel)}</span><small>${esc(loaded ? loaded.source : 'Printer did not report filament')}</small></div></div>
        <div class="mrow"><div class="lk">Job needs</div><div class="lv"><span class="l1">${sw(need.color)}${esc(need.label || need.type || '—')}</span><small>${g(need.grams ?? p.filamentGrams)} required</small></div></div>
        ${ams ? `<div class="toggle-row" style="padding-left:0;padding-right:0"><div class="toggle-text"><div class="t">Use AMS</div><div class="d">Map the job's filament to a matching AMS slot</div></div><label class="switch"><input type="checkbox" id="use-ams" checked><span></span></label></div>` : ''}
        ${blocked ? `<div class="warn red"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="16.5" r=".8"/></svg><div><strong>Can't send yet</strong><p>${esc(blocked)}</p></div></div>`
        : mismatch ? `<div class="warn"><svg viewBox="0 0 24 24"><path d="M12 8v5"/><circle cx="12" cy="16.2" r=".8"/><path d="M10.2 4.8h3.6L21 19H3L10.2 4.8z"/></svg><div><strong>Filament doesn't match</strong><p>The printer has ${esc(loadedLabel)} loaded, but this job was sliced for ${esc(need.label || need.type)}. Load the matching filament before sending, or continue anyway.</p></div></div>` : ''}
        <div id="sheet-result"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" data-act="confirm-reprint" data-id="${esc(p.id)}" ${blocked ? 'disabled' : ''}>Confirm &amp; send</button>
          <button class="btn btn-ghost btn-block" data-act="close-sheet">Cancel</button>
        </div>
      </div>`;
  }
  async function confirmReprint(btn) {
    const id = btn.dataset.id; const p = S.prints.find(x => x.id === id);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Sending…';
    const useAms = !!($('#use-ams') && $('#use-ams').checked);
    try {
      const r = await api.reprint(id, { plate: p.plate || 1, useAms });
      $('#sheet-result').innerHTML = `<div class="ok-box"><strong>${r.demo ? 'Demo: nothing was sent' : 'Sent to the printer'}</strong>${r.demo ? 'In live mode the helper uploads the 3MF over FTPS and starts plate ' + r.plate + ' over MQTT.' : `Uploaded to ${esc(r.remotePath)} and started plate ${r.plate}${r.useAms ? ' using the AMS' : ''}. The printer will level the bed first.`}</div>`;
      btn.innerHTML = 'Done'; btn.disabled = false; btn.dataset.act = 'close-sheet';
      if (!r.demo) setTimeout(refresh, 1500);
    } catch (e) {
      $('#sheet-result').innerHTML = `<div class="warn red"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/></svg><div><strong>Reprint failed</strong><p>${esc(e.message)}</p></div></div>`;
      btn.disabled = false; btn.innerHTML = 'Try again';
    }
  }
  const closeSheet = () => { $('#sheet-root').innerHTML = ''; };

  // ---------- settings ----------
  function settings() {
    header('Settings'); tabs('settings');
    const st = S.status || { helper: {}, printer: {}, capture: {} };
    const h = st.helper || {}, pr = st.printer || {}, cap = st.capture || {};
    const helperUrl = localStorage.getItem(LS.helper);
    const addr = S.mode === 'demo' ? 'Demo data' : S.base ? S.base.replace(/\/$/, '') : `This address (${location.host})`;
    const statusText = S.mode === 'demo' ? `Demo · watching ${pr.model || 'X1C'}` : !S.online ? 'Offline' : pr.connected ? `Online · watching ${pr.model || pr.name || 'printer'}` : 'Online · printer not connected';
    const mixed = location.protocol === 'https:' && helperUrl && /^http:/.test(helperUrl);
    const T = (key, t, desc) => `<div class="toggle-row"><div class="toggle-text"><div class="t">${t}</div><div class="d">${desc}</div></div><label class="switch"><input type="checkbox" data-cap="${key}" ${cap[key] !== false ? 'checked' : ''}><span></span></label></div>`;
    const test = S.test;
    $('#main').innerHTML = `
      <div class="group"><div class="group-title">Archive helper</div><div class="group-body">
        <div class="srow"><span class="lk">Helper</span><span class="lv">${esc(h.name || '—')}</span></div>
        <div class="srow"><span class="lk">Status</span><span class="lv" style="color:${S.mode !== 'demo' && !S.online ? 'var(--red)' : '#fff'}">${esc(statusText)}</span></div>
        <div class="srow"><span class="lk">Last capture</span><span class="lv">${h.lastCapture ? `${esc(h.lastCapture.name)} · ${fmtAgo(h.lastCapture.at)}` : 'None yet'}</span></div>
        <button class="srow tap" data-act="set-helper"><span class="lk">Helper address</span><span class="lv dim">${esc(addr)}<span class="chev">›</span></span></button>
        ${h.tokenRequired || localStorage.getItem(LS.token) ? `<button class="srow tap" data-act="set-token"><span class="lk">Helper token</span><span class="lv dim">${localStorage.getItem(LS.token) ? '••••••' : 'Not set'}<span class="chev">›</span></span></button>` : ''}
      </div>
      <div class="group-foot">iPhone can't listen in the background. Capture runs on an always-on helper on your home network (LAN MQTT + local file copy); this app browses and reprints.</div>
      ${mixed ? `<div class="group-foot warn-text">This copy is loaded over https, so Safari blocks calls to an http:// helper. For live use open ${esc(helperUrl)} on your iPhone and add that page to your Home Screen.</div>` : ''}
      ${S.mode === 'demo' ? `<div class="group-foot">For live use, run the helper on your Mac, then open <b>http://&lt;your-mac&gt;.local:8787</b> in Safari on your iPhone and choose Share → Add to Home Screen. This GitHub Pages copy is a demo preview.</div>` : ''}
      </div>
      <div class="group"><div class="group-title">Printer connection</div><div class="group-body">
        <button class="srow tap" data-act="edit" data-key="ip"><span class="lk">IP address</span><span class="lv">${esc(pr.ip || 'Not set')}</span></button>
        <button class="srow tap" data-act="edit" data-key="serial"><span class="lk">Serial</span><span class="lv">${esc(pr.serial || 'Not set')}</span></button>
        <button class="srow tap" data-act="edit" data-key="accessCode"><span class="lk">LAN code</span><span class="lv">${pr.accessCodeSet ? '••••••••' : 'Not set'}</span></button>
        <button class="row-btn" data-act="test" ${S.mode !== 'demo' && !S.online ? 'disabled' : ''}>${test === 'running' ? 'Testing…' : 'Test connection'}</button>
        ${test && test !== 'running' ? `<div class="conn-line${test.ok ? '' : ' bad'}"><span class="dot${test.ok ? '' : ' off'}"></span>${esc(test.text)}</div>` : pr.connected ? `<div class="conn-line"><span class="dot"></span>Connected · ${esc(pr.model || '')} firmware ${esc(pr.firmware || '—')}</div>` : ''}
      </div>
      <div class="group-foot">On the printer: Settings → Network → turn on LAN Only (or Developer mode) and copy the access code.</div></div>
      <div class="group"><div class="group-title">Storage</div><div class="group-body">
        <div class="srow"><span class="lk">Archive</span><span class="lv dim">${esc(h.archiveDir || '—')}</span></div>
        <div class="srow"><span class="lk">STL watch</span><span class="lv dim">${esc(h.stlWatchDir || 'Off')}</span></div>
      </div></div>
      <div class="group"><div class="group-title">Capture</div><div class="group-body">
        ${T('autoArchive', 'Auto-archive on finish', 'Copy the 3MF, thumbnail and settings')}
        ${T('archiveFailed', 'Archive failed prints', 'Keep cancelled or failed jobs')}
        ${T('keepThumbnails', 'Keep thumbnails', 'Store the preview from the 3MF')}
      </div></div>
      <div class="local-note"><div class="ico"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div><div><h4>Local only, no Bambu cloud</h4><p>The helper captures prints over your LAN. This app browses and reprints — it never uses Bambu Lab's cloud.</p></div></div>
      <div class="about">Print Archive v${esc(VERSION)} · ${S.mode === 'demo' ? 'Demo mode' : 'Live mode'}${st.version && S.mode !== 'demo' ? ` · helper v${esc(st.version)}` : ''}<br>Offline cache: ${esc(S.swCache || 'not active')}<br>Not affiliated with Bambu Lab.</div>`;
  }

  async function setHelper() {
    const cur = localStorage.getItem(LS.helper) || '';
    const v = prompt('Helper address (for example http://your-mac.local:8787).\nLeave empty to use this page\'s own helper, or type "demo" for demo data.', cur === 'demo' ? 'demo' : cur);
    if (v === null) return;
    const t = v.trim();
    if (!t) localStorage.removeItem(LS.helper); else if (t.toLowerCase() === 'demo') localStorage.setItem(LS.helper, 'demo');
    else { if (!/^https?:\/\//.test(t)) return toast('Start the address with http://'); localStorage.setItem(LS.helper, t.replace(/\/+$/, '')); }
    await boot();
  }

  async function editPrinter(key) {
    if (S.mode !== 'demo' && !S.online) return toast('Helper is offline');
    const labels = { ip: 'Printer IP address', serial: 'Printer serial number', accessCode: 'LAN access code (from the printer screen)' };
    const st = S.status.printer || {};
    const v = prompt(labels[key], key === 'accessCode' ? '' : st[key] || '');
    if (v === null || (key === 'accessCode' && !v.trim())) return;
    try { await api.config({ printer: { [key]: v.trim() } }); S.test = null; toast(S.mode === 'demo' ? 'Demo: saved on this phone only' : 'Saved to the helper'); render(); } catch (e) { toast(`Couldn't save: ${e.message}`); }
  }

  // ---------- routing ----------
  function render() {
    const h = location.hash || '#/dashboard';
    const main = $('#main');
    banner();
    const m = /^#\/print\/(.+)$/.exec(h);
    if (m) detail(decodeURIComponent(m[1]));
    else if (h.startsWith('#/library')) library();
    else if (h.startsWith('#/settings')) settings();
    else dashboard();
    main.scrollTop = S.scroll[h] || 0;
  }
  let lastHash = location.hash;
  window.addEventListener('hashchange', () => { closeSheet(); render(); lastHash = location.hash; });
  $('#main').addEventListener('scroll', e => { S.scroll[location.hash || '#/dashboard'] = e.target.scrollTop; }, { passive: true });

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act;
    if (act === 'back') { history.length > 1 ? history.back() : (location.hash = '#/library'); }
    else if (act === 'reprint') openReprint(el.dataset.id);
    else if (act === 'close-sheet') closeSheet();
    else if (act === 'confirm-reprint') confirmReprint(el);
    else if (act === 'clear-filters') { Object.assign(S.filters, { date: 'all', fil: '', status: '', label: '' }); library(); }
    else if (act === 'set-helper') setHelper();
    else if (act === 'set-token') { const v = prompt('Helper token (from apiToken in the helper config.json). Leave empty to clear.', ''); if (v !== null) { v.trim() ? localStorage.setItem(LS.token, v.trim()) : localStorage.removeItem(LS.token); settings(); } }
    else if (act === 'edit') editPrinter(el.dataset.key);
    else if (act === 'retry') { e.preventDefault(); refresh(); }
    else if (act === 'share') { const p = S.prints.find(x => x.id === el.dataset.id); try { await navigator.share({ title: p.name, url: new URL(url(p.fileUrl), location.href).href }); } catch {} }
    else if (act === 'test') {
      S.test = 'running'; settings();
      try { const r = await api.test(); const ok = r.mqtt && r.ftps; S.test = { ok, text: ok ? `${r.demo ? 'Demo · ' : ''}Connected · MQTT and FTPS OK${r.firmware ? ' · firmware ' + r.firmware : ''}` : r.error || 'Connection failed' }; }
      catch (err) { S.test = { ok: false, text: err.message }; }
      settings();
    }
  });
  document.addEventListener('change', async e => {
    const f = e.target.closest('[data-filter]');
    if (f) { S.filters[f.dataset.filter] = f.value; library(); return; }
    const c = e.target.closest('[data-cap]');
    if (c) { try { await api.config({ capture: { [c.dataset.cap]: c.checked } }); } catch (err) { c.checked = !c.checked; toast(`Couldn't save: ${err.message}`); } }
  });
  document.addEventListener('input', e => { if (e.target.id === 'q') { S.filters.q = e.target.value; renderGrid(); } });

  async function refresh() {
    await load();
    const active = document.activeElement;
    if (active && (active.id === 'notes' || active.id === 'q')) { banner(); header(document.querySelector('.top h1') ? document.querySelector('.top h1').textContent : '', !!document.querySelector('.back-btn')); return; }
    if (!$('#sheet-root').innerHTML) render();
  }

  // ---------- service worker ----------
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', ev => { if (ev.data && ev.data.type === 'version') { S.swCache = ev.data.cache; if ((location.hash || '').startsWith('#/settings')) settings(); } });
    navigator.serviceWorker.ready.then(reg => { (navigator.serviceWorker.controller || reg.active)?.postMessage({ type: 'version' }); });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !refresh.reloaded) { refresh.reloaded = true; location.reload(); } });
  }

  let poll;
  async function boot() {
    const m = await detectMode(); S.mode = m.mode; S.base = m.base;
    await load(); render();
    clearInterval(poll);
    if (S.mode === 'live') poll = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.mode === 'live') refresh(); });
  window.PA = { S, refresh, version: VERSION };
  boot();
})();
