/* Pay360 QM Dashboard — interactive pieces.
 *   Penetration by Base : per base, pilots using Pay360 (activated = "Yes") / total pilots in the base.
 *   Pilot Segments      : DISTINCTCOUNT(user_id) per user_status, sorted DESC (Segment_Breakdown measure).
 *   KPI trend charts    : caret on each KPI card expands an SVG line chart from data/kpi_trends.json.
 *   "?" help tooltip    : hover / focus / click.
 * DOM output uses createElement/textContent only; no innerHTML with data.
 */
(function () {
  'use strict';

  const CSV_URL = 'data/QM_Mock_Dataset_For_Dashboard.csv';
  const TRENDS_URL = 'data/kpi_trends.json';
  const MAX_CHARS = 10 * 1024 * 1024;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Allowlists
  const BASES = new Set(['LAX', 'SEA', 'SLC']);
  const STATUS_COLORS = new Map([
    ['Power User', '#003366'],
    ['Activated User', '#C01933'],
    ['New User', '#E5E7EB'],
  ]);
  const YES_NO = new Set(['Yes', 'No']);
  const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const REQUIRED = ['user_id', 'base', 'activated', 'user_status'];
  const SERIES_KEYS = new Set(['eligiblePilots', 'adoption', 'activation', 'retention']);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const nf = new Intl.NumberFormat('en-US');
  const ratio = (n, d) => (d > 0 ? n / d : 0);
  const fmtPct = (v) => `${Math.round(v * 100)}%`;

  let trends = null;          // validated trend data, or null
  let trendsError = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svg(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
    if (text != null) node.textContent = text;
    return node;
  }

  function showEmpty(host, message) {
    host.replaceChildren(el('p', 'empty', message));
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    if (text.length > MAX_CHARS) throw new Error(`${url} is too large.`);
    return text;
  }

  /* ================= CSV ================= */
  function splitCsvLine(line) {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) throw new Error('Dataset is empty.');
    const header = splitCsvLine(lines[0].replace(/^\uFEFF/, ''));
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const missing = REQUIRED.filter((c) => !(c in idx));
    if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);

    const rows = [];
    let rejected = 0;
    for (let i = 1; i < lines.length; i++) {
      const c = splitCsvLine(lines[i]);
      const r = { id: c[idx.user_id], base: c[idx.base], activated: c[idx.activated], status: c[idx.user_status] };
      if (USER_ID_RE.test(r.id) && BASES.has(r.base) && YES_NO.has(r.activated) && STATUS_COLORS.has(r.status)) rows.push(r);
      else rejected++;
    }
    if (rejected) console.warn(`[QM] ${rejected} row(s) failed validation and were excluded.`);
    return rows;
  }

  /* ================= Penetration by Base ================= */
  function renderBases(rows) {
    const host = document.getElementById('baseRows');
    const groups = new Map();
    rows.forEach((r) => {
      if (!groups.has(r.base)) groups.set(r.base, { total: new Set(), using: new Set() });
      const g = groups.get(r.base);
      g.total.add(r.id);
      if (r.activated === 'Yes') g.using.add(r.id);
    });
    const list = [...groups.entries()]
      .map(([base, g]) => ({ base, total: g.total.size, using: g.using.size }))
      .sort((a, b) => ratio(b.using, b.total) - ratio(a.using, a.total));
    if (!list.length) { showEmpty(host, 'No base data available.'); return; }

    host.replaceChildren(...list.map((b) => {
      const p = ratio(b.using, b.total);
      const row = el('div', 'base-row');
      const head = el('div', 'base-row__head');
      head.append(
        el('span', 'base-row__name', b.base),
        el('span', 'base-row__value', `${nf.format(b.using)} / ${nf.format(b.total)} pilots  (${fmtPct(p)})`)
      );
      const track = el('div', 'track');
      track.setAttribute('role', 'img');
      track.setAttribute('aria-label', `${b.base}: ${fmtPct(p)} of pilots using Pay360`);
      track.style.width = '100%';
      const fill = el('div', 'track__fill');
      fill.style.width = `${p * 100}%`;
      track.append(fill);
      row.append(head, track);
      return row;
    }));
  }

  /* ================= Pilot Segments ================= */
  function renderSegments(rows) {
    const stack = document.getElementById('segmentStack');
    const list = document.getElementById('segmentRows');
    const sets = new Map();
    rows.forEach((r) => {
      if (!sets.has(r.status)) sets.set(r.status, new Set());
      sets.get(r.status).add(r.id);
    });
    const items = [...sets.entries()]
      .map(([status, s]) => ({ status, count: s.size, color: STATUS_COLORS.get(status) }))
      .sort((a, b) => b.count - a.count);
    const total = items.reduce((s, i) => s + i.count, 0);
    if (!total) { stack.replaceChildren(); showEmpty(list, 'No segment data available.'); return; }

    stack.replaceChildren(...items.map((i) => {
      const seg = el('span', 'seg');
      seg.style.width = `${ratio(i.count, total) * 100}%`;
      seg.style.background = i.color;
      return seg;
    }));
    list.replaceChildren(...items.map((i) => {
      const li = el('li', 'seg-row');
      const name = el('span', 'seg-row__name');
      const sw = el('span', 'swatch');
      sw.setAttribute('aria-hidden', 'true');
      sw.style.background = i.color;
      name.append(sw, i.status);
      li.append(name, el('span', 'seg-row__value', `${nf.format(i.count)}  (${fmtPct(ratio(i.count, total))})`));
      return li;
    }));
  }

  /* ================= Trend data ================= */
  function validateTrends(raw) {
    if (!raw || typeof raw !== 'object' || !raw.series || typeof raw.series !== 'object') throw new Error('Invalid trend file.');
    const out = { note: typeof raw.note === 'string' ? raw.note.slice(0, 300) : '', series: {} };
    for (const key of SERIES_KEYS) {
      const s = raw.series[key];
      if (!s || !Array.isArray(s.points) || s.points.length < 2 || s.points.length > 366) throw new Error(`Series ${key} is invalid.`);
      const granularity = s.granularity === 'day' ? 'day' : s.granularity === 'month' ? 'month' : null;
      const unit = s.unit === 'percent' ? 'percent' : s.unit === 'count' ? 'count' : null;
      if (!granularity || !unit) throw new Error(`Series ${key} has an invalid granularity/unit.`);
      const points = s.points.map((p) => {
        const y = Number(p && p.y);
        if (!Number.isFinite(y) || y < 0 || (unit === 'percent' && y > 100) || y > 1e7) throw new Error(`Series ${key} has an invalid value.`);
        if (granularity === 'day') {
          if (!Number.isInteger(p.x) || p.x < 1 || p.x > 31) throw new Error(`Series ${key} has an invalid day.`);
        } else if (!MONTHS.includes(p.x)) throw new Error(`Series ${key} has an invalid month.`);
        return { x: p.x, y };
      });
      out.series[key] = {
        granularity, unit, points,
        xTitle: typeof s.xTitle === 'string' ? s.xTitle.slice(0, 60) : '',
        yTitle: typeof s.yTitle === 'string' ? s.yTitle.slice(0, 60) : '',
      };
    }
    return out;
  }

  /* ================= Line chart ================= */
  function niceStep(range, targetTicks) {
    const raw = range / Math.max(1, targetTicks);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return nice * mag;
  }

  function yScale(values, unit) {
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (unit === 'percent') lo = 0;                 // percentages start at 0
    if (hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo, 4);
    let min = Math.floor(lo / step) * step;
    let max = Math.ceil(hi / step) * step;
    if (max - hi < step * 0.2) max += step;         // headroom for the end-value label
    if (unit === 'count' && lo - min < step * 0.2 && min - step >= 0) min -= step;
    const ticks = [];
    for (let v = min; v <= max + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { min, max, ticks };
  }

  function fmtValue(v, unit) {
    return unit === 'percent' ? `${Number.isInteger(v) ? v : v.toFixed(1)}%` : nf.format(Math.round(v));
  }

  function xLabel(p, s) {
    return s.granularity === 'day' ? `Sep ${p.x}` : `${p.x} 2026`;
  }

  function buildChart(key, s) {
    const W = 260, H = 180;
    const m = { t: 16, r: 16, b: 38, l: 48 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const pts = s.points;
    const ys = yScale(pts.map((p) => p.y), s.unit);

    // X positions: days are linear 1..30, months are evenly spaced categories.
    let xPos, xTicks;
    if (s.granularity === 'day') {
      const first = pts[0].x, last = pts[pts.length - 1].x;
      xPos = (p) => m.l + ratio(p.x - first, last - first) * iw;
      const days = [first, 5, 10, 15, 20, 25, last].filter((d, i, a) => d >= first && d <= last && a.indexOf(d) === i);
      xTicks = days.map((d) => ({ x: xPos({ x: d }), label: String(d) }));
    } else {
      xPos = (p) => m.l + ratio(pts.indexOf(p), pts.length - 1) * iw;
      xTicks = pts.map((p) => ({ x: xPos(p), label: p.x }));
    }
    const yPos = (v) => m.t + ih - ratio(v - ys.min, ys.max - ys.min) * ih;

    const first = pts[0], last = pts[pts.length - 1];
    const summary = `${s.yTitle} by ${s.granularity === 'day' ? 'day' : 'month'}, ${xLabel(first, s)} to ${xLabel(last, s)}: ` +
      `from ${fmtValue(first.y, s.unit)} to ${fmtValue(last.y, s.unit)}.`;

    const root = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-labelledby': `chart-title-${key}` });
    root.append(svg('title', { id: `chart-title-${key}` }, summary));

    // Gridlines + Y ticks
    ys.ticks.forEach((t) => {
      const y = yPos(t);
      root.append(svg('line', { class: 'chart__grid', x1: m.l, x2: m.l + iw, y1: y, y2: y }));
      root.append(svg('text', { class: 'chart__tick', x: m.l - 6, y: y + 3, 'text-anchor': 'end' }, fmtValue(t, s.unit)));
    });

    // Axes
    root.append(svg('line', { class: 'chart__axis', x1: m.l, x2: m.l, y1: m.t, y2: m.t + ih }));
    root.append(svg('line', { class: 'chart__axis', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }));

    // X ticks
    xTicks.forEach((t) => {
      root.append(svg('line', { class: 'chart__axis', x1: t.x, x2: t.x, y1: m.t + ih, y2: m.t + ih + 4 }));
      root.append(svg('text', { class: 'chart__tick', x: t.x, y: m.t + ih + 14, 'text-anchor': 'middle' }, t.label));
    });

    // Axis titles
    root.append(svg('text', { class: 'chart__title', x: m.l + iw / 2, y: H - 4, 'text-anchor': 'middle' }, s.xTitle));
    const yTitleY = m.t + ih / 2;
    root.append(svg('text', { class: 'chart__title', x: 10, y: yTitleY, 'text-anchor': 'middle', transform: `rotate(-90 10 ${yTitleY})` }, s.yTitle));

    // Area + line
    const coords = pts.map((p) => [xPos(p), yPos(p.y)]);
    const linePath = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const base = (m.t + ih).toFixed(2);
    root.append(svg('path', { class: 'chart__area', d: `${linePath} L${coords[coords.length - 1][0].toFixed(2)},${base} L${coords[0][0].toFixed(2)},${base} Z` }));
    root.append(svg('path', { class: 'chart__line', d: linePath }));

    // Points (with native hover tooltips)
    pts.forEach((p, i) => {
      const isLast = i === pts.length - 1;
      const showDot = s.granularity === 'month' || isLast;
      const dot = svg('circle', {
        class: isLast ? 'chart__dot chart__dot--last' : 'chart__dot',
        cx: coords[i][0].toFixed(2), cy: coords[i][1].toFixed(2), r: showDot ? 3 : 4,
      });
      if (!showDot) { dot.setAttribute('fill-opacity', '0'); dot.setAttribute('stroke-opacity', '0'); }
      dot.append(svg('title', {}, `${xLabel(p, s)}: ${fmtValue(p.y, s.unit)}`));
      root.append(dot);
    });

    // End-value label
    const [lx, ly] = coords[coords.length - 1];
    root.append(svg('text', { class: 'chart__label', x: lx, y: ly - 8, 'text-anchor': 'end' }, fmtValue(last.y, s.unit)));

    return root;
  }

  function renderChart(host) {
    const key = host.closest('[data-series]').dataset.series;
    if (!SERIES_KEYS.has(key)) return;
    if (!trends) {
      let msg = 'Loading trend data…';
      if (trendsError) msg = 'Trend data could not be loaded.';
      else if (location.protocol === 'file:') msg = 'Run start.bat and open http://localhost:8081 to load trend data.';
      showEmpty(host, msg);
      return;
    }
    const s = trends.series[key];
    const note = el('p', 'kpi__chart-note', s.granularity === 'day'
      ? 'Cumulative, Sep 1–30, 2026 · illustrative data'
      : 'Month over month, Apr–Sep 2026 · illustrative data');
    host.replaceChildren(buildChart(key, s), note);
  }

  function setupKpiToggles() {
    document.querySelectorAll('.kpi__toggle').forEach((btn) => {
      const host = document.getElementById(btn.getAttribute('aria-controls'));
      if (!host) return;
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        host.hidden = !open;
        if (open && !host.hasChildNodes()) renderChart(host);
      });
    });
  }

  /* ================= "?" help tooltip ================= */
  function setupHelp() {
    const wrap = document.getElementById('help');
    const btn = document.getElementById('helpBtn');
    const setOpen = (open) => {
      wrap.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!wrap.classList.contains('is-open')); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }

  /* ================= Boot ================= */
  async function init() {
    setupHelp();
    setupKpiToggles();

    const baseHost = document.getElementById('baseRows');
    const segHost = document.getElementById('segmentRows');

    if (location.protocol === 'file:') {
      const msg = 'Run start.bat and open http://localhost:8081 to load the mock data.';
      showEmpty(baseHost, msg);
      showEmpty(segHost, msg);
      return;
    }

    const [csv, json] = await Promise.allSettled([fetchText(CSV_URL), fetchText(TRENDS_URL)]);

    try {
      if (csv.status === 'rejected') throw csv.reason;
      const rows = parseCsv(csv.value);
      renderBases(rows);
      renderSegments(rows);
    } catch (err) {
      console.warn('[QM] Could not load mock dataset:', err.message);
      showEmpty(baseHost, 'Mock dataset could not be loaded.');
      showEmpty(segHost, 'Mock dataset could not be loaded.');
    }

    try {
      if (json.status === 'rejected') throw json.reason;
      trends = validateTrends(JSON.parse(json.value));
    } catch (err) {
      trendsError = true;
      console.warn('[QM] Could not load trend data:', err.message);
    }
    // Re-render any chart opened before data arrived.
    document.querySelectorAll('.kpi__chart:not([hidden])').forEach(renderChart);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
