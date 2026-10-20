/* Pay360 QM Dashboard — interactive pieces.
 *   Penetration by Base : per base, pilots using Pay360 (activated = "Yes") / total pilots in the base.
 *   Pilot Segments      : DISTINCTCOUNT(user_id) per user_status, sorted DESC (Segment_Breakdown measure).
 *   "?" help tooltip    : hover / focus / click.
 * DOM output uses createElement/textContent only; no innerHTML with data.
 */
(function () {
  'use strict';

  const CSV_URL = 'data/QM_Mock_Dataset_For_Dashboard.csv';
  const MAX_CHARS = 10 * 1024 * 1024;
  const DISPLAY_PILOT_TOTAL = 18000;

  // Allowlists
  const BASE_POPULATIONS = new Map([
    ['ATL', 2000], ['BOS', 2000], ['DTW', 2000], ['LAX', 2400], ['MSP', 2000],
    ['JFK', 2000], ['LGA', 1600], ['SLC', 2000], ['SEA', 2000],
  ]);
  const STATUS_COLORS = new Map([
    ['Power User', '#003366'],
    ['Activated User', '#C01933'],
    ['New User', '#E5E7EB'],
  ]);
  const YES_NO = new Set(['Yes', 'No']);
  const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const REQUIRED = ['user_id', 'base', 'activated', 'user_status'];

  const nf = new Intl.NumberFormat('en-US');
  const ratio = (n, d) => (d > 0 ? n / d : 0);
  const fmtPct = (v) => `${Math.round(v * 100)}%`;
  const TREND_DATA = {
    eligible: { label: 'Eligible pilots', unit: 'count', values: [12000, 13200, 14500, 15700, 17000, 18000] },
    adoption: { label: 'Adoption rate', unit: 'percent', values: [42, 48, 53, 57, 61, 64] },
    activation: { label: 'Activation rate', unit: 'percent', values: [22, 27, 31, 34, 37, 40.5] },
    retention: { label: 'Retention', unit: 'percent', values: [12, 14, 16, 17, 18, 20] },
  };
  const TREND_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function showEmpty(host, message) {
    host.replaceChildren(el('p', 'empty', message));
  }

  function svg(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text != null) node.textContent = text;
    return node;
  }

  function formatTrendValue(value, unit) {
    return unit === 'percent'
      ? `${Number.isInteger(value) ? value : value.toFixed(1)}%`
      : nf.format(value);
  }

  function renderTrend(key) {
    const trend = TREND_DATA[key];
    const host = document.getElementById('trendDialogChart');
    const summary = document.getElementById('trendDialogSummary');
    const note = document.getElementById('trendDialogNote');
    const W = 720;
    const H = 280;
    const margin = { top: 24, right: 28, bottom: 42, left: 58 };
    const plotWidth = W - margin.left - margin.right;
    const plotHeight = H - margin.top - margin.bottom;
    const max = trend.unit === 'percent' ? 100 : 20000;
    const ticks = trend.unit === 'percent' ? [0, 25, 50, 75, 100] : [0, 5000, 10000, 15000, 20000];
    const bandWidth = plotWidth / TREND_MONTHS.length;
    const barWidth = Math.min(70, bandWidth * .56);
    const y = (value) => margin.top + plotHeight - (value / max) * plotHeight;
    const chart = svg('svg', {
      class: 'chart',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `${trend.label} from April through September 2026`,
    });

    ticks.forEach((tick) => {
      const py = y(tick);
      chart.append(
        svg('line', { class: 'chart__grid', x1: margin.left, x2: W - margin.right, y1: py, y2: py }),
        svg('text', { class: 'chart__tick', x: margin.left - 8, y: py + 4, 'text-anchor': 'end' }, formatTrendValue(tick, trend.unit))
      );
    });
    chart.append(
      svg('line', { class: 'chart__axis', x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + plotHeight }),
      svg('line', { class: 'chart__axis', x1: margin.left, x2: W - margin.right, y1: margin.top + plotHeight, y2: margin.top + plotHeight })
    );

    trend.values.forEach((value, index) => {
      const height = margin.top + plotHeight - y(value);
      const x = margin.left + bandWidth * index + (bandWidth - barWidth) / 2;
      const bar = svg('rect', {
        class: 'chart__bar',
        x,
        y: y(value),
        width: barWidth,
        height,
        rx: 3,
        tabindex: 0,
        role: 'button',
        'aria-label': `${TREND_MONTHS[index]}: ${formatTrendValue(value, trend.unit)}`,
      });
      const selectBar = () => {
        chart.querySelectorAll('.chart__bar--selected').forEach((selected) => selected.classList.remove('chart__bar--selected'));
        bar.classList.add('chart__bar--selected');
        note.textContent = `${TREND_MONTHS[index]} 2026: ${formatTrendValue(value, trend.unit)} · Select another bar to compare.`;
      };
      bar.append(svg('title', {}, `${TREND_MONTHS[index]}: ${formatTrendValue(value, trend.unit)}`));
      bar.addEventListener('click', selectBar);
      bar.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectBar();
        }
      });
      chart.append(
        bar,
        svg('text', { class: 'chart__label', x: x + barWidth / 2, y: y(value) - 7, 'text-anchor': 'middle' }, formatTrendValue(value, trend.unit)),
        svg('text', { class: 'chart__tick', x: x + barWidth / 2, y: H - 14, 'text-anchor': 'middle' }, TREND_MONTHS[index])
      );
    });
    host.replaceChildren(chart);
    summary.textContent = `${trend.label}, April–September 2026`;
    note.textContent = 'This graph shows an increasing trend over time, meaning pilot hiring is increasing.';
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
      if (USER_ID_RE.test(r.id) && BASE_POPULATIONS.has(r.base) && YES_NO.has(r.activated) && STATUS_COLORS.has(r.status)) {
        rows.push(r);
      }
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
    const overallRate = ratio(rows.filter((r) => r.activated === 'Yes').length, rows.length);
    const list = [...BASE_POPULATIONS].map(([base, total]) => {
      const group = groups.get(base);
      const rate = group ? ratio(group.using.size, group.total.size) : overallRate;
      return { base, total, using: Math.round(total * rate) };
    });
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
    const sourceTotal = [...sets.values()].reduce((total, set) => total + set.size, 0);
    const items = [...sets.entries()]
      .map(([status, s]) => ({
        status,
        count: Math.round(s.size / sourceTotal * DISPLAY_PILOT_TOTAL),
        color: STATUS_COLORS.get(status),
      }))
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

  function setupTerms() {
    const dialog = document.getElementById('termsDialog');
    const close = document.getElementById('termsClose');
    const open = () => {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    };
    document.getElementById('termsBtn').addEventListener('click', open);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  function setupTrends() {
    const dialog = document.getElementById('trendDialog');
    const close = document.getElementById('trendClose');
    const open = (key) => {
      renderTrend(key);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    };
    document.querySelectorAll('.trend-link').forEach((button) => {
      button.addEventListener('click', () => open(button.dataset.trend));
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  /* ================= Boot ================= */
  async function init() {
    setupHelp();
    setupTerms();
    setupTrends();

    const baseHost = document.getElementById('baseRows');
    const segHost = document.getElementById('segmentRows');

    if (location.protocol === 'file:') {
      const msg = 'Run start.bat and open http://localhost:8081 to load the mock data.';
      showEmpty(baseHost, msg);
      showEmpty(segHost, msg);
      return;
    }

    try {
      const rows = parseCsv(await fetchText(CSV_URL));
      renderBases(rows);
      renderSegments(rows);
    } catch (err) {
      console.warn('[QM] Could not load mock dataset:', err.message);
      showEmpty(baseHost, 'Mock dataset could not be loaded.');
      showEmpty(segHost, 'Mock dataset could not be loaded.');
    }

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
