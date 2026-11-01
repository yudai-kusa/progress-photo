// 体重・体脂肪率・筋肉量の記録とグラフ
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { confirmDialog, alertDialog, toast } from '../ui.js';
import { state, BODY_METRICS, sortedBody, getBody, saveBody, deleteBody } from '../store.js';
import { ymd, isYmd, formatDate, daysBetween, loadPref, savePref } from '../util.js';
import { topbar } from './common.js';

const PERIODS = [
  { key: '1m', label: '1ヶ月', days: 31 },
  { key: '3m', label: '3ヶ月', days: 92 },
  { key: '1y', label: '1年', days: 366 },
  { key: 'all', label: '全期間', days: Infinity },
];

const metricOf = (key) => BODY_METRICS.find((m) => m.key === key) ?? BODY_METRICS[0];
const fmt = (v) => (v == null ? '-' : v.toFixed(1));

// 全角数字・全角ピリオド・カンマも受け付ける。空欄は null、不正なら NaN
function parseValue(s) {
  const t = s.trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。,，]/g, '.');
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t) * 10) / 10;
}

export function render(root) {
  let metric = metricOf(loadPref('bodyMetric', 'weight')).key;
  let period = loadPref('bodyPeriod', '3m');
  if (!PERIODS.some((p) => p.key === period)) period = '3m';

  /* ---------- 入力フォーム ---------- */
  const dateInput = h('input', { class: 'input', type: 'date', value: ymd(), max: ymd(), required: true });
  const inputs = Object.fromEntries(BODY_METRICS.map((m) => [m.key, h('input', {
    class: 'input',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: '-',
    'aria-label': `${m.label}(${m.unit})`,
  })]));
  const formNote = h('p', { class: 'muted small' });
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '記録する');

  const fillForm = () => {
    const r = getBody(dateInput.value);
    for (const m of BODY_METRICS) inputs[m.key].value = r?.[m.key] != null ? fmt(r[m.key]) : '';
    formNote.textContent = r ? 'この日の記録があります。保存すると上書きされます。' : '入力した項目だけ記録されます(空欄でもOK)。';
    saveBtn.textContent = r ? '更新する' : '記録する';
  };
  dateInput.addEventListener('change', fillForm);

  const submit = async (e) => {
    e.preventDefault();
    const date = dateInput.value;
    if (!isYmd(date)) {
      await alertDialog('日付を選んでください。');
      return;
    }
    const record = { date };
    for (const m of BODY_METRICS) {
      const v = parseValue(inputs[m.key].value);
      if (Number.isNaN(v) || (v != null && (v < m.min || v > m.max))) {
        await alertDialog(`${m.label}は ${m.min}〜${m.max}${m.unit} の数値で入力してください。`);
        inputs[m.key].focus();
        return;
      }
      record[m.key] = v;
    }
    if (BODY_METRICS.every((m) => record[m.key] == null)) {
      await alertDialog('体重・体脂肪率・筋肉量のどれか1つは入力してください。');
      return;
    }
    try {
      await saveBody(record);
    } catch (err) {
      await alertDialog(err.message);
      return;
    }
    toast(`${formatDate(date)} の記録を保存しました`);
    // 保存した項目のグラフが空なら、入力のある項目に切り替える
    if (record[metric] == null) metric = BODY_METRICS.find((m) => record[m.key] != null).key;
    document.activeElement?.blur?.();
    fillForm();
    drawAll();
  };

  const form = h('form', { class: 'card body-form', onsubmit: submit },
    h('h2', {}, '記録する'),
    h('label', { class: 'field' }, '日付', dateInput),
    h('div', { class: 'body-inputs' }, BODY_METRICS.map((m) => h('label', { class: 'field' },
      m.label,
      h('span', { class: 'input-unit' }, inputs[m.key], h('span', { class: 'unit' }, m.unit))))),
    formNote,
    saveBtn);

  /* ---------- グラフ ---------- */
  const tabs = h('div', { class: 'tabs tabs-3', role: 'tablist' });
  const summary = h('div', { class: 'body-summary' });
  const periodChips = h('div', { class: 'chips' });
  const chartBox = h('div', { class: 'chart' });
  const historyList = h('ul', { class: 'tag-list body-history' });

  const drawTabs = () => {
    tabs.replaceChildren(...BODY_METRICS.map((m) => h('button', {
      class: 'tab' + (m.key === metric ? ' on' : ''),
      role: 'tab',
      'aria-selected': String(m.key === metric),
      onclick: () => { metric = m.key; savePref('bodyMetric', metric); drawAll(); },
    }, m.label)));
    periodChips.replaceChildren(...PERIODS.map((p) => h('button', {
      type: 'button',
      class: 'chip small' + (p.key === period ? ' on' : ''),
      'aria-pressed': String(p.key === period),
      onclick: () => { period = p.key; savePref('bodyPeriod', period); drawAll(); },
    }, p.label)));
  };

  // 選んだ項目・期間の点(古い順)
  const points = () => {
    const all = sortedBody().filter((r) => r[metric] != null);
    if (!all.length) return [];
    const days = PERIODS.find((p) => p.key === period).days;
    const end = all[all.length - 1].date;
    return all
      .filter((r) => daysBetween(r.date, end) < days)
      .map((r) => ({ date: r.date, value: r[metric] }));
  };

  const drawSummary = (pts) => {
    const m = metricOf(metric);
    if (!pts.length) {
      summary.replaceChildren();
      return;
    }
    const last = pts[pts.length - 1];
    const first = pts[0];
    const diff = Math.round((last.value - first.value) * 10) / 10;
    summary.replaceChildren(
      h('div', {},
        h('span', { class: 'body-latest' }, fmt(last.value)),
        h('span', { class: 'body-unit' }, m.unit),
        h('span', { class: 'muted small' }, ` ${formatDate(last.date)}`)),
      pts.length > 1
        ? h('div', { class: 'muted small' }, `${formatDate(first.date)} から `,
          h('strong', { class: 'body-diff' }, `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff).toFixed(1)}${m.unit}`))
        : null);
  };

  const drawChart = () => {
    const pts = points();
    drawSummary(pts);
    if (!pts.length) {
      chartBox.replaceChildren(h('div', { class: 'chart-empty muted small' },
        state.body.length ? `${metricOf(metric).label}の記録はまだありません` : 'まだ記録がありません。上のフォームから記録するとグラフが表示されます。'));
      return;
    }
    chartBox.replaceChildren(lineChart(pts, metricOf(metric), chartBox.clientWidth || 320));
  };

  let historyLimit = 20;
  const drawHistory = () => {
    const all = sortedBody().reverse();
    const rows = all.slice(0, historyLimit);
    if (!rows.length) {
      historyList.replaceChildren(h('li', { class: 'empty-row muted small' }, '記録がありません'));
      return;
    }
    historyList.replaceChildren(...rows.map((r) => h('li', { class: 'tag-row' },
      h('button', {
        class: 'tag-name body-row',
        'aria-label': `${formatDate(r.date)} の記録を編集`,
        onclick: () => {
          dateInput.value = r.date;
          fillForm();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
      },
      h('span', { class: 'body-row-date' }, formatDate(r.date)),
      h('span', { class: 'body-row-vals' }, BODY_METRICS.map((m) => h('span', { class: r[m.key] == null ? 'muted' : '' },
        r[m.key] == null ? '-' : `${fmt(r[m.key])}${m.unit}`))),
      icon('edit')),
      h('button', {
        class: 'icon-btn small danger',
        'aria-label': '削除',
        onclick: async () => {
          if (!(await confirmDialog(`${formatDate(r.date)} の記録を削除しますか?`, { ok: '削除', danger: true }))) return;
          await deleteBody(r.date);
          toast('削除しました');
          fillForm();
          drawAll();
        },
      }, icon('trash')))));
    if (all.length > rows.length) {
      historyList.append(h('li', { class: 'empty-row' }, h('button', {
        class: 'link-btn',
        onclick: () => { historyLimit += 50; drawHistory(); },
      }, `もっと見る(残り${all.length - rows.length}件)`)));
    }
  };

  const drawAll = () => {
    drawTabs();
    drawChart();
    drawHistory();
  };

  root.append(
    topbar('体重・体組成', { backTo: '#/' }),
    h('div', { class: 'page' },
      form,
      h('section', { class: 'card' },
        tabs,
        summary,
        chartBox,
        periodChips),
      h('section', { class: 'stack' },
        h('div', { class: 'section-head' }, h('h2', {}, '記録一覧'), h('span', { class: 'muted small' }, 'タップで編集')),
        historyList)),
  );

  fillForm();
  drawTabs();
  drawHistory();
  // 幅が決まってから描く。画面の回転などで幅が変わったら描き直す
  let lastWidth = 0;
  const ro = new ResizeObserver(() => {
    const w = chartBox.clientWidth;
    if (w && w !== lastWidth) {
      lastWidth = w;
      drawChart();
    }
  });
  ro.observe(chartBox);
  return () => ro.disconnect();
}

/* ---------- 折れ線グラフ(SVG) ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

const dayNum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const fromDayNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

// 見やすい目盛り(0.1 / 0.2 / 0.5 / 1 / 2 / 5 …刻み)
function niceTicks(min, max, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((n) => n * mag).find((n) => n >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { ticks, lo, hi, step };
}

function xTicks(start, end) {
  const span = end - start;
  const out = [];
  if (span <= 45) {
    // 1週間ごと(またはそれより細かく)
    const step = span <= 10 ? 2 : 7;
    for (let d = start; d <= end; d += step) out.push({ at: d, label: fromDayNum(d).slice(5).replace('-', '/').replace(/^0/, '') });
    return out;
  }
  // 月初ごと。多すぎるときは間引く
  const s0 = fromDayNum(start);
  let y = +s0.slice(0, 4);
  let m = +s0.slice(5, 7);
  const months = [];
  for (;;) {
    m++;
    if (m > 12) { m = 1; y++; }
    const d = dayNum(`${y}-${String(m).padStart(2, '0')}-01`);
    if (d > end) break;
    months.push({ at: d, y, m });
  }
  const every = Math.max(1, Math.ceil(months.length / 6));
  months.forEach((mo, i) => {
    if (i % every) return;
    out.push({ at: mo.at, label: mo.m === 1 || i === 0 ? `${mo.y}/${mo.m}` : `${mo.m}月` });
  });
  return out;
}

function lineChart(pts, metric, width) {
  const height = 220;
  const pad = { top: 14, right: 14, bottom: 26, left: 40 };
  const innerW = Math.max(40, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;

  const values = pts.map((p) => p.value);
  const { ticks, lo, hi } = niceTicks(Math.min(...values), Math.max(...values));
  let x0 = dayNum(pts[0].date);
  let x1 = dayNum(pts[pts.length - 1].date);
  if (x0 === x1) {
    x0 -= 3;
    x1 += 3;
  }
  const x = (d) => pad.left + ((dayNum(d) - x0) / (x1 - x0)) * innerW;
  const xn = (n) => pad.left + ((n - x0) / (x1 - x0)) * innerW;
  const y = (v) => pad.top + (1 - (v - lo) / (hi - lo)) * innerH;

  const svg = s('svg', {
    class: 'chart-svg',
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'img',
    'aria-label': `${metric.label}の推移`,
  });

  // 目盛りと補助線
  for (const t of ticks) {
    svg.append(
      s('line', { class: 'chart-grid', x1: pad.left, x2: pad.left + innerW, y1: y(t), y2: y(t) }),
      s('text', { class: 'chart-axis', x: pad.left - 6, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' },
        document.createTextNode(Number.isInteger(t) ? String(t) : t.toFixed(1))));
  }
  for (const t of xTicks(x0, x1)) {
    svg.append(s('text', { class: 'chart-axis', x: xn(t.at), y: height - 6, 'text-anchor': 'middle' }, document.createTextNode(t.label)));
  }

  // 線と点
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  svg.append(s('path', { class: 'chart-line', d }));
  const showDots = pts.length <= 60;
  pts.forEach((p, i) => {
    if (showDots || i === pts.length - 1) svg.append(s('circle', { class: 'chart-dot', cx: x(p.date), cy: y(p.value), r: 4 }));
  });

  // なぞると値を表示(十字線 + ツールチップ)
  const cross = s('line', { class: 'chart-cross', y1: pad.top, y2: pad.top + innerH, visibility: 'hidden' });
  const focus = s('circle', { class: 'chart-focus', r: 5.5, visibility: 'hidden' });
  svg.append(cross, focus);
  const tip = h('div', { class: 'chart-tip', hidden: true });

  const show = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * width;
    let best = pts[0];
    for (const p of pts) if (Math.abs(x(p.date) - px) < Math.abs(x(best.date) - px)) best = p;
    const cx = x(best.date);
    const cy = y(best.value);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', cx);
    focus.setAttribute('cy', cy);
    focus.setAttribute('visibility', 'visible');
    tip.replaceChildren(h('span', { class: 'muted' }, formatDate(best.date)), h('strong', {}, `${fmt(best.value)}${metric.unit}`));
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(0, cx - tw / 2), width - tw)}px`;
    tip.style.top = `${Math.max(0, cy - 44)}px`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    focus.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture?.(e.pointerId); show(e.clientX); });
  svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) show(e.clientX); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });

  return h('div', { class: 'chart-wrap' }, svg, tip);
}
