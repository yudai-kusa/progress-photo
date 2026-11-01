// 体重・体脂肪率・筋肉量の記録とグラフ
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { confirmDialog, alertDialog, toast } from '../ui.js';
import { state, BODY_METRICS, sortedBody, getBody, saveBody, deleteBody } from '../store.js';
import { ymd, isYmd, formatDate, daysBetween, loadPref, savePref } from '../util.js';
import { topbar } from './common.js';

const PERIODS = [
  { key: '1w', label: '1週間', days: 7 },
  { key: '1m', label: '1ヶ月', days: 31 },
  { key: '3m', label: '3ヶ月', days: 92 },
  { key: '1y', label: '1年', days: 366 },
  { key: 'all', label: '全期間', days: Infinity },
];

const metricOf = (key) => BODY_METRICS.find((m) => m.key === key) ?? BODY_METRICS[0];
const fmt = (v) => (v == null ? '-' : v.toFixed(1));
const AVG_DAYS = 7;

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
  let showAvg = loadPref('bodyShowAvg', false);

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
  const periodChips = h('div', { class: 'tabs tabs-5', role: 'tablist', 'aria-label': '期間' });
  const avgToggle = h('label', { class: 'switch' });
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
      class: 'tab' + (p.key === period ? ' on' : ''),
      role: 'tab',
      'aria-selected': String(p.key === period),
      onclick: () => { period = p.key; savePref('bodyPeriod', period); drawAll(); },
    }, p.label)));
    avgToggle.replaceChildren(
      h('input', {
        type: 'checkbox',
        checked: showAvg,
        onchange: (e) => { showAvg = e.target.checked; savePref('bodyShowAvg', showAvg); drawChart(); },
      }),
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
      `${AVG_DAYS}日平均を重ねる`);
  };

  // 選んだ項目の全記録(古い順)。avg はその日を含む直近7日間(暦日)の記録の平均
  const series = () => {
    const all = sortedBody().filter((r) => r[metric] != null);
    let from = 0;
    let sum = 0;
    return all.map((r, i) => {
      sum += r[metric];
      while (daysBetween(all[from].date, r.date) >= AVG_DAYS) sum -= all[from++][metric];
      return { date: r.date, day: dayNum(r.date), value: r[metric], avg: Math.round((sum / (i - from + 1)) * 100) / 100 };
    });
  };
  const periodDays = () => PERIODS.find((p) => p.key === period).days;

  // 表示する範囲(日の通し番号)。endDay が null なら最新の記録まで。
  // 期間の長さは固定で、スワイプや矢印で end を動かして過去を見る
  let endDay = null;
  const windowOf = (all) => {
    const first = all[0].day;
    const last = all[all.length - 1].day;
    const days = periodDays();
    if (!Number.isFinite(days)) return { start: first, end: last, minEnd: last, maxEnd: last, days: last - first + 1 };
    const minEnd = Math.min(last, first + days - 1);
    const end = endDay == null ? last : Math.min(last, Math.max(minEnd, endDay));
    return { start: end - days + 1, end, minEnd, maxEnd: last, days };
  };

  const shortRange = (a, b) => {
    const fa = formatDate(fromDayNum(a));
    const fb = formatDate(fromDayNum(b));
    return `${fa} 〜 ${fa.slice(0, 4) === fb.slice(0, 4) ? fb.slice(5) : fb}`;
  };

  const drawSummary = (pts, win) => {
    const m = metricOf(metric);
    if (!pts.length) {
      summary.replaceChildren(h('div', { class: 'muted small' }, 'この期間の記録はありません'));
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

  const nav = h('div', { class: 'chart-nav' });
  const drawNav = (win) => {
    const movable = win.minEnd < win.maxEnd;
    if (!movable) {
      nav.replaceChildren();
      return;
    }
    const go = (end) => { endDay = end; drawChart(); };
    nav.replaceChildren(
      h('button', {
        class: 'icon-btn small', 'aria-label': '前の期間', disabled: win.end <= win.minEnd,
        onclick: () => go(win.end - win.days),
      }, icon('back')),
      h('div', { class: 'chart-nav-label' },
        h('span', {}, shortRange(win.start, win.end)),
        h('span', { class: 'muted' }, '左右にスワイプで移動')),
      win.end < win.maxEnd
        ? h('button', { class: 'link-btn', onclick: () => go(null) }, '最新')
        : null,
      h('button', {
        class: 'icon-btn small chart-next', 'aria-label': '次の期間', disabled: win.end >= win.maxEnd,
        onclick: () => go(win.end + win.days),
      }, icon('back')));
  };

  let chart = null; // 描いたグラフ { showAt, hide, innerW, win }
  const drawChart = () => {
    const all = series();
    if (!all.length) {
      chart = null;
      summary.replaceChildren();
      nav.replaceChildren();
      chartBox.replaceChildren(h('div', { class: 'chart-empty muted small' },
        state.body.length ? `${metricOf(metric).label}の記録はまだありません` : 'まだ記録がありません。上のフォームから記録するとグラフが表示されます。'));
      return;
    }
    const win = windowOf(all);
    // 範囲外に出た値は戻しておく。最新まで戻したら、新しい記録にも追従する
    endDay = win.end >= win.maxEnd ? null : win.end;
    const inWin = all.filter((p) => p.day >= win.start && p.day <= win.end);
    drawSummary(inWin, win);
    drawNav(win);
    chart = lineChart(all, inWin, win, metricOf(metric), chartBox.clientWidth || 320, { showAvg });
    chartBox.replaceChildren(chart.el);
  };

  // グラフの操作: 横にドラッグ(スワイプ)で期間を移動、タップで値を表示
  let drag = null;
  let raf = 0;
  chartBox.addEventListener('pointerdown', (e) => {
    if (!chart) return;
    drag = { id: e.pointerId, x: e.clientX, end: chart.win.end, panning: false };
  });
  chartBox.addEventListener('pointermove', (e) => {
    if (!chart) return;
    if (!drag || drag.id !== e.pointerId) {
      if (e.pointerType === 'mouse' && !e.buttons) chart.showAt(e.clientX);
      return;
    }
    const { win } = chart;
    const pannable = win.minEnd < win.maxEnd;
    if (!pannable) {
      chart.showAt(e.clientX); // 動かせないときは、なぞって値を見る
      return;
    }
    const dx = e.clientX - drag.x;
    if (!drag.panning) {
      if (Math.abs(dx) < 8) return;
      drag.panning = true;
      chartBox.setPointerCapture?.(e.pointerId);
      chartBox.classList.add('dragging');
      chart.hide();
    }
    const next = Math.round(drag.end - (dx * win.days) / chart.innerW);
    if (next === (endDay ?? win.maxEnd)) return;
    endDay = next;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawChart);
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.panning && e.type === 'pointerup') chart?.showAt(e.clientX);
    drag = null;
    chartBox.classList.remove('dragging');
  };
  chartBox.addEventListener('pointerup', endDrag);
  chartBox.addEventListener('pointercancel', endDrag);
  chartBox.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) chart?.hide(); });

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
        nav,
        periodChips,
        avgToggle),
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
  return () => {
    ro.disconnect();
    cancelAnimationFrame(raf);
  };
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
    const step = span <= 7 ? 1 : span <= 14 ? 2 : 7;
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

// all: その項目の全記録 / inWin: 表示範囲内の記録 / win: 表示範囲
function lineChart(all, inWin, win, metric, width, { showAvg = false } = {}) {
  const height = 220;
  const pad = { top: 14, right: 14, bottom: 26, left: 40 };
  const innerW = Math.max(40, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;

  // 線が端まで続くよう、範囲のすぐ外の記録も1つずつ含めて描く(はみ出しは切り取る)
  const i0 = all.findIndex((p) => p.day >= win.start);
  let i1 = all.length - 1;
  while (i1 >= 0 && all[i1].day > win.end) i1--;
  const from = Math.max(0, (i0 < 0 ? all.length : i0) - 1);
  const ext = all.slice(from, Math.min(all.length, i1 + 2));
  const base = inWin.length ? inWin : ext;

  const values = base.map((p) => p.value).concat(showAvg ? base.map((p) => p.avg) : []);
  const { ticks, lo, hi } = niceTicks(Math.min(...values), Math.max(...values));
  let x0 = win.start;
  let x1 = win.end;
  if (x0 === x1) {
    x0 -= 3;
    x1 += 3;
  }
  const xn = (n) => pad.left + ((n - x0) / (x1 - x0)) * innerW;
  const y = (v) => pad.top + (1 - (v - lo) / (hi - lo)) * innerH;

  const svg = s('svg', {
    class: 'chart-svg' + (showAvg ? ' with-avg' : ''),
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
    const tx = xn(t.at);
    // 右端の日付が切れないよう、少し内側に寄せる
    svg.append(s('text', { class: 'chart-axis', x: Math.min(tx, width - 17), y: height - 6, 'text-anchor': 'middle' }, document.createTextNode(t.label)));
  }

  // 線と点(描画範囲の外は切り取る)
  const clipId = 'clip-' + Math.random().toString(36).slice(2);
  svg.append(s('defs', {}, s('clipPath', { id: clipId },
    s('rect', { x: pad.left - 6, y: 0, width: innerW + 12, height: pad.top + innerH + 6 }))));
  const plot = s('g', { 'clip-path': `url(#${clipId})` });
  svg.append(plot);
  const path = (key) => ext.map((p, i) => `${i ? 'L' : 'M'}${xn(p.day).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  if (ext.length) plot.append(s('path', { class: 'chart-line', d: path('value') }));
  const showDots = inWin.length <= 60;
  inWin.forEach((p, i) => {
    if (showDots || i === inWin.length - 1) plot.append(s('circle', { class: 'chart-dot', cx: xn(p.day), cy: y(p.value), r: 4 }));
  });
  if (showAvg && ext.length) plot.append(s('path', { class: 'chart-avg', d: path('avg') }));
  if (!inWin.length) {
    svg.append(s('text', { class: 'chart-axis chart-none', x: pad.left + innerW / 2, y: pad.top + innerH / 2, 'text-anchor': 'middle' },
      document.createTextNode('この期間の記録はありません')));
  }

  // タップ・なぞると値を表示(十字線 + ツールチップ)
  const cross = s('line', { class: 'chart-cross', y1: pad.top, y2: pad.top + innerH, visibility: 'hidden' });
  const focus = s('circle', { class: 'chart-focus', r: 5.5, visibility: 'hidden' });
  svg.append(cross, focus);
  const tip = h('div', { class: 'chart-tip', hidden: true });

  const showAt = (clientX) => {
    if (!inWin.length) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * width;
    let best = inWin[0];
    for (const p of inWin) if (Math.abs(xn(p.day) - px) < Math.abs(xn(best.day) - px)) best = p;
    const cx = xn(best.day);
    const cy = y(best.value);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', cx);
    focus.setAttribute('cy', cy);
    focus.setAttribute('visibility', 'visible');
    tip.replaceChildren(
      h('span', { class: 'muted' }, formatDate(best.date)),
      h('strong', {}, `${fmt(best.value)}${metric.unit}`),
      showAvg ? h('span', { class: 'chart-tip-avg' }, `${AVG_DAYS}日平均 ${fmt(best.avg)}${metric.unit}`) : null);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(0, cx - tw / 2), width - tw)}px`;
    // 点の上に出す。上に入らなければ点の下に出す
    const th = tip.offsetHeight;
    tip.style.top = `${cy - th - 12 >= 0 ? cy - th - 12 : cy + 12}px`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    focus.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };

  // 2本のときは凡例を出す(色だけに頼らない)
  const legend = showAvg
    ? h('div', { class: 'chart-legend' },
      h('span', {}, h('i', { class: 'lg-raw' }), '記録'),
      h('span', {}, h('i', { class: 'lg-avg' }), `${AVG_DAYS}日平均`))
    : null;
  return { el: h('div', {}, legend, h('div', { class: 'chart-wrap' }, svg, tip)), showAt, hide, innerW, win };
}
