import { round, signed, validateRows, filterRows, summarize, monthlyAverages, chartDomain } from './data-utils.mjs';

const $ = id => document.getElementById(id);
const state = { rows: [], rawDates: [], range: 'ytd', view: 'spread', visible: [], chart: null, selectedDate: null };
const labels = { ytd: '今年以来', '1m': '近 1 月', '3m': '近 3 月' };
const money = value => `${value.toFixed(2)}<small>美元 / 桶</small>`;
const shortDate = date => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`;
const displayDate = date => date.replaceAll('-', '.');
const priceClass = value => value < 0 ? 'negative' : value > 0 ? 'positive' : '';
const ns = 'http://www.w3.org/2000/svg';

function svgElement(tag, attributes = {}, content) {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (content !== undefined) element.textContent = content;
  return element;
}

function fillMetrics() {
  const { first, latest } = summarize(state.rows);
  const previous = state.rows.at(-2);
  const change = previous ? round(latest.spread - previous.spread) : 0;
  $('latest-spread').innerHTML = money(latest.spread);
  $('latest-brent').innerHTML = money(latest.brent);
  $('latest-wti').innerHTML = money(latest.wti);
  $('spread-change').innerHTML = previous ? `<strong class="${priceClass(change)}">${change < 0 ? '↘' : change > 0 ? '↗' : '—'} ${signed(change)}</strong>较 ${shortDate(previous.date)} ${change < 0 ? '收窄' : change > 0 ? '扩大' : '持平'}` : '暂无前一共同报价日';
  const yearChange = round(latest.spread - first.spread);
  $('ytd-change').innerHTML = `${signed(yearChange)}<small>美元 / 桶</small>`;
  $('ytd-change').classList.toggle('negative', yearChange < 0);
  $('ytd-change').classList.toggle('positive', yearChange > 0);
  $('ytd-reference').textContent = `较 ${shortDate(first.date)}价差 ${first.spread.toFixed(2)} ${yearChange < 0 ? '收窄' : yearChange > 0 ? '扩大' : '持平'}`;
}

function renderSummary(summary) {
  $('summary-range').textContent = labels[state.range];
  $('average-spread').textContent = summary.average.toFixed(2);
  $('max-spread').textContent = summary.max.spread.toFixed(2);
  $('min-spread').textContent = summary.min.spread.toFixed(2);
  $('max-date').textContent = displayDate(summary.max.date);
  $('min-date').textContent = displayDate(summary.min.date);
  const span = summary.max.spread - summary.min.spread;
  const percentile = span === 0 ? 50 : (summary.latest.spread - summary.min.spread) / span * 100;
  $('range-marker').style.left = `clamp(0px, ${percentile.toFixed(2)}%, calc(100% - 3px))`;
  $('range-description').textContent = `最新价差位于区间${percentile < 33 ? '下部' : percentile > 66 ? '上部' : '中部'} · ${summary.latest.spread.toFixed(2)} 美元 / 桶`;
}

function renderMonthly() {
  const months = monthlyAverages(state.visible);
  const high = Math.max(...months.map(month => month.average), 0.1);
  const low = Math.min(...months.map(month => month.average), 0);
  const span = high - low;
  const zero = -low / span * 80;
  $('monthly-chart').replaceChildren();
  for (const month of months) {
    const item = document.createElement('div');
    item.className = 'month-item';
    item.setAttribute('role', 'listitem');
    item.tabIndex = 0;
    const description = `${Number(month.month.slice(5))}月：平均价差 ${month.average.toFixed(2)} 美元/桶，${month.count} 个有效报价日`;
    item.setAttribute('aria-label', description);
    item.title = description;
    const height = Math.abs(month.average) / span * 80;
    const bottom = month.average >= 0 ? zero : zero - height;
    item.innerHTML = `<div class="month-bar-area"><div class="month-zero" style="bottom:${zero}%"></div><div class="month-bar" style="height:${height}%;bottom:${bottom}%"></div><span class="month-value" style="bottom:calc(${month.average >= 0 ? zero + height : zero}% + 6px)">${month.average.toFixed(2)}</span></div><span class="month-label">${Number(month.month.slice(5))} 月</span>`;
    $('monthly-chart').append(item);
  }
  $('monthly-note').textContent = `${labels[state.range]} · 按所选区间内的有效报价日计算；首尾月份可能不完整。`;
}

function renderTable() {
  const tbody = $('data-table');
  tbody.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const row of [...state.visible].reverse()) {
    const index = state.rows.indexOf(row);
    const previous = state.rows[index - 1];
    const change = previous ? round(row.spread - previous.spread) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.date}</td><td>${row.brent.toFixed(2)}</td><td>${row.wti.toFixed(2)}</td><td>${row.spread.toFixed(2)}</td><td class="${change === null ? '' : priceClass(change)}">${change === null ? '—' : signed(change)}</td>`;
    fragment.append(tr);
  }
  tbody.append(fragment);
  $('table-count').textContent = `${state.visible.length} 条记录`;
}

function renderChart() {
  const rows = state.visible;
  if (!rows.length) return;
  const svg = $('main-chart');
  const width = Math.max(Math.round(svg.clientWidth), 270);
  const height = Math.max(Math.round(svg.clientHeight), 250);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const padding = { left: 43, right: 18, top: 20, bottom: 33 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const isSpread = state.view === 'spread';
  const summary = summarize(rows);
  const domain = chartDomain(isSpread ? rows.map(row => row.spread) : rows.flatMap(row => [row.wti, row.brent]));
  const start = Date.parse(rows[0].date), end = Date.parse(rows.at(-1).date);
  const x = date => padding.left + (start === end ? 0.5 : (Date.parse(date) - start) / (end - start)) * plotWidth;
  const y = value => padding.top + (domain.max - value) / (domain.max - domain.min) * plotHeight;
  const baseline = y(Math.max(domain.min, Math.min(domain.max, 0)));
  const defs = svgElement('defs');
  const gradient = svgElement('linearGradient', { id: 'spread-fill', x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(svgElement('stop', { offset: '0%', 'stop-color': '#cbf49a', 'stop-opacity': '.20' }), svgElement('stop', { offset: '100%', 'stop-color': '#cbf49a', 'stop-opacity': '.015' }));
  defs.append(gradient); svg.append(defs);
  svg.append(svgElement('title', {}, `${isSpread ? '布伦特减WTI价差' : '布伦特与WTI现货价格'}，${rows[0].date}至${rows.at(-1).date}`));
  svg.append(svgElement('desc', {}, `共${rows.length}个共同报价日。价差均值${summary.average.toFixed(2)}，最低${summary.min.spread.toFixed(2)}，最高${summary.max.spread.toFixed(2)}美元每桶。完整数值见页面下方日度数据明细。`));
  for (let i = 0; i <= 4; i++) {
    const value = domain.min + (domain.max - domain.min) * i / 4;
    const py = y(value);
    svg.append(svgElement('line', { x1: padding.left, y1: py, x2: width - padding.right, y2: py, stroke: '#2b352c', 'stroke-dasharray': '3 5' }));
    svg.append(svgElement('text', { x: padding.left - 11, y: py + 4, 'text-anchor': 'end' }, value.toFixed(Math.abs(value) >= 100 ? 0 : 1)));
  }
  if (isSpread && domain.min < 0 && domain.max > 0) {
    svg.append(svgElement('line', { x1: padding.left, y1: y(0), x2: width - padding.right, y2: y(0), stroke: '#66725e', 'stroke-width': 1 }));
  }
  const tickCount = width < 500 ? 4 : 7;
  const tickIndices = [...new Set(Array.from({ length: Math.min(tickCount, rows.length) }, (_, i) => Math.round(i * (rows.length - 1) / (Math.min(tickCount, rows.length) - 1 || 1))))];
  for (let i = 0; i < tickIndices.length; i++) {
    const row = rows[tickIndices[i]];
    svg.append(svgElement('text', { x: x(row.date), y: height - 7, 'text-anchor': i === 0 ? 'start' : i === tickIndices.length - 1 ? 'end' : 'middle' }, `${Number(row.date.slice(5, 7))}/${Number(row.date.slice(8))}`));
  }
  if (isSpread) svg.append(svgElement('line', { x1: padding.left, y1: y(summary.average), x2: width - padding.right, y2: y(summary.average), stroke: '#81936a', 'stroke-dasharray': '5 5', opacity: '.75' }));
  const series = isSpread ? [{ field: 'spread', color: '#cbf49a' }] : [{ field: 'brent', color: '#cbf49a' }, { field: 'wti', color: '#99bdf2' }];
  for (const { field, color } of series) {
    const segments = [];
    for (const row of rows) {
      const last = segments.at(-1)?.at(-1);
      if (!last || state.rawDates.indexOf(row.date) - state.rawDates.indexOf(last.date) > 1) segments.push([]);
      segments.at(-1).push(row);
    }
    for (const segment of segments) {
      const path = segment.map((row, i) => `${i === 0 ? 'M' : 'L'}${x(row.date).toFixed(2)},${y(row[field]).toFixed(2)}`).join(' ');
      if (isSpread && segment.length > 1) svg.append(svgElement('path', { d: `${path} L${x(segment.at(-1).date)},${baseline} L${x(segment[0].date)},${baseline} Z`, fill: 'url(#spread-fill)' }));
      svg.append(svgElement('path', { d: path, fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      if (segment.length === 1) svg.append(svgElement('circle', { cx: x(segment[0].date), cy: y(segment[0][field]), r: 2.5, fill: color }));
    }
    svg.append(svgElement('circle', { cx: x(rows.at(-1).date), cy: y(rows.at(-1)[field]), r: 4, fill: color, stroke: '#181e1b', 'stroke-width': 2 }));
  }
  const crosshair = svgElement('g', { visibility: 'hidden', 'aria-hidden': 'true' });
  const guide = svgElement('line', { y1: padding.top, y2: height - padding.bottom, stroke: '#65765c', 'stroke-dasharray': '3 4' });
  crosshair.append(guide);
  const dots = series.map(item => { const dot = svgElement('circle', { r: 4, fill: item.color, stroke: '#181e1b', 'stroke-width': 2 }); crosshair.append(dot); return { field: item.field, node: dot }; });
  svg.append(crosshair);
  state.chart = { width, height, x, y, crosshair, guide, dots, padding, start, end, plotWidth };
  svg.setAttribute('aria-label', isSpread ? '布伦特减WTI日度价差走势，单位美元每桶' : '布伦特和WTI日度现货价格走势，单位美元每桶');
  const previousIndex = rows.findIndex(row => row.date === state.selectedDate);
  const cursorIndex = previousIndex >= 0 ? previousIndex : rows.length - 1;
  const selected = rows[cursorIndex];
  state.selectedDate = selected.date;
  $('chart-cursor').max = rows.length - 1;
  $('chart-cursor').value = cursorIndex;
  $('chart-cursor').setAttribute('aria-valuetext', cursorDescription(selected));
  hideTooltip();
  if (document.activeElement === $('chart-cursor')) showTooltip(cursorIndex);
}

function cursorDescription(row) {
  return `${row.date}，布伦特 ${row.brent.toFixed(2)}，WTI ${row.wti.toFixed(2)}，价差 ${row.spread.toFixed(2)} 美元每桶`;
}

function showTooltip(index) {
  const row = state.visible[index], chart = state.chart;
  if (!row || !chart) return;
  state.selectedDate = row.date;
  const px = chart.x(row.date);
  chart.crosshair.setAttribute('visibility', 'visible');
  chart.guide.setAttribute('x1', px); chart.guide.setAttribute('x2', px);
  for (const dot of chart.dots) { dot.node.setAttribute('cx', px); dot.node.setAttribute('cy', chart.y(row[dot.field])); }
  const tooltip = $('chart-tooltip');
  tooltip.innerHTML = `<div class="tooltip-date">${displayDate(row.date)}</div><div class="tooltip-row"><span>布伦特</span><strong>${row.brent.toFixed(2)}</strong></div><div class="tooltip-row"><span>WTI</span><strong>${row.wti.toFixed(2)}</strong></div><div class="tooltip-row accent-text"><span>价差</span><strong>${signed(row.spread)}</strong></div>`;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.max(0, Math.min(px + 14, chart.width - tooltip.offsetWidth))}px`;
  tooltip.style.top = '38px';
  $('chart-cursor').setAttribute('aria-valuetext', cursorDescription(row));
}

function hideTooltip() {
  $('chart-tooltip').hidden = true;
  state.chart?.crosshair.setAttribute('visibility', 'hidden');
}

function render() {
  state.visible = filterRows(state.rows, state.range);
  const summary = summarize(state.visible);
  $('range-caption').textContent = `${displayDate(summary.first.date)} — ${displayDate(summary.latest.date)}`;
  $('observation-count').textContent = `${summary.count} 个有效报价日`;
  $('chart-title').textContent = state.view === 'spread' ? '布伦特 − WTI' : '两种基准原油的价格';
  $('chart-legend').innerHTML = state.view === 'spread' ? '<span><i class="legend-line brent"></i>日度价差</span><span><i class="legend-line average"></i>区间均值</span>' : '<span><i class="legend-line brent"></i>布伦特</span><span><i class="legend-line wti"></i>WTI</span>';
  document.querySelectorAll('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === state.range)));
  document.querySelectorAll('[data-view]').forEach(button => { const active = button.dataset.view === state.view; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  $('chart-content').setAttribute('aria-labelledby', `${state.view}-tab`);
  renderSummary(summary); renderMonthly(); renderTable(); renderChart();
}

async function loadData() {
  $('loading').hidden = false; $('error').hidden = true;
  try {
    const response = await fetch('./data/oil-prices-2026.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    state.rawDates = snapshot.data.map(row => row.date);
    state.rows = validateRows(snapshot.data.filter(row => row.brent !== null && row.wti !== null));
    const latest = state.rows.at(-1), metadata = snapshot.metadata;
    if (latest.date !== metadata.lastCommonObservation) throw new Error('Observation metadata mismatch');
    $('data-through').textContent = `截至 ${displayDate(latest.date)}`;
    $('data-notice').textContent = `数据截至 ${latest.date}，核验于 ${metadata.verifiedOn}。这是历史数据快照；近 1 月和近 3 月均从最新报价日向前计算。`;
    $('data-notice').hidden = false;
    const missing = snapshot.data.length - state.rows.length;
    $('source-note').textContent = `仅使用同日共同报价；${missing} 个单边缺失日期已排除，折线在这些日期断开。周末与节假日不补值。核验日期：${metadata.verifiedOn}。`;
    $('loading').hidden = true; $('dashboard').hidden = false;
    fillMetrics(); render();
  } catch (error) {
    console.error('Unable to load oil observations:', error);
    $('loading').hidden = true; $('dashboard').hidden = true; $('error').hidden = false;
    $('data-through').textContent = '数据暂不可用';
  }
}

document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => { state.range = button.dataset.range; render(); }));
const tabs = [...document.querySelectorAll('[data-view]')];
for (const button of tabs) {
  button.addEventListener('click', () => { state.view = button.dataset.view; render(); });
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(button) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    state.view = next.dataset.view; render(); next.focus();
  });
}
$('main-chart').addEventListener('pointermove', event => {
  if (!state.chart) return;
  const rect = $('main-chart').getBoundingClientRect();
  const px = (event.clientX - rect.left) * state.chart.width / rect.width;
  const target = state.chart.start + (px - state.chart.padding.left) / state.chart.plotWidth * (state.chart.end - state.chart.start);
  let index = 0;
  state.visible.forEach((row, i) => { if (Math.abs(Date.parse(row.date) - target) < Math.abs(Date.parse(state.visible[index].date) - target)) index = i; });
  $('chart-cursor').value = index; showTooltip(index);
});
$('main-chart').addEventListener('pointerleave', hideTooltip);
$('main-chart').addEventListener('pointerdown', event => { if (event.pointerType === 'touch') $('main-chart').dispatchEvent(new PointerEvent('pointermove', { clientX: event.clientX, clientY: event.clientY })); });
$('chart-cursor').addEventListener('input', event => showTooltip(Number(event.target.value)));
$('chart-cursor').addEventListener('focus', event => showTooltip(Number(event.target.value)));
$('chart-cursor').addEventListener('blur', hideTooltip);
$('chart-cursor').addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
$('retry').addEventListener('click', loadData);
let resizeFrame;
new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (state.visible.length) renderChart(); }); }).observe($('chart-area'));

// Optional imperative interface for browsers with WebMCP support.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'set_oil_chart_view',
      title: '查看原油价格或价差',
      description: '切换原油图表的时间范围与价格/价差视图，并返回当前区间统计。时间范围以数据快照的最新共同报价日为终点。',
      inputSchema: { type: 'object', properties: { range: { type: 'string', enum: ['1m', '3m', 'ytd'] }, view: { type: 'string', enum: ['spread', 'prices'] } }, required: ['range', 'view'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !['1m', '3m', 'ytd'].includes(input.range) || !['spread', 'prices'].includes(input.view) || Object.keys(input).some(key => !['range', 'view'].includes(key))) throw new Error('Invalid chart range or view');
        if (!state.rows.length) throw new Error('Oil observations are not available');
        state.range = input.range; state.view = input.view; render();
        const stats = summarize(state.visible);
        return { range: state.range, view: state.view, startDate: stats.first.date, endDate: stats.latest.date, observations: stats.count, averageSpread: round(stats.average), minSpread: stats.min.spread, maxSpread: stats.max.spread, unit: 'USD/barrel', latest: stats.latest };
      }
    }, { signal: lifecycle.signal })).catch(error => console.warn('Chart tool unavailable:', error));
  } catch (error) { console.warn('Chart tool unavailable:', error); }
  window.addEventListener('pagehide', event => { if (!event.persisted) lifecycle.abort(); });
}
loadData();
