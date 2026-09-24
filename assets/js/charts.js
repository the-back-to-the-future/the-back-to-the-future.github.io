// Interactive figures. A figure[data-chart] names its JSON in data-chart-src (exported from
// the committed E1 data by dare/project-page/export_chart_data.py), its kind in data-chart
// ("bars": terminal error at the rollout lengths; "lines": error at every self-fed step)
// and its value in data-chart-y ("ratio": error / predict-no-motion error; "value": the
// error itself on a log axis). The figure's markup is only its caption: controls, plot,
// tooltip, legend and table view are built here. The chart is drawn when it comes into
// view; controls switch world / error / methods with an animated transition; hovering
// shows each method's real numbers; the legend toggles methods; the table view carries the
// same numbers. Every rounded shape follows Apple's continuous corner: the bars are drawn
// with continuousRectPath (site.js), the tooltip and legend are HTML that site.js's corner
// pass converts. Needs Chart.js (assets/js/vendor).
"use strict";

const chartReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const BAR_RADIUS = 4;             // the data end's corner radius, px
const TIP_GAP = 14;               // px between the pointer and the tooltip
const TIP_SWATCH = [10, 3];       // the tooltip swatch's side and corner radius, px (as in site.css)
const STAR_EVERY = 8;             // a line chart's starred method carries a star every this many steps

// A colour token of the stylesheet, so the charts share the page's palette.
function cssToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// A raw error with its unit, to three significant figures (the puck's early errors are
// thousandths of a centimetre).
function withUnit(value, unit) {
  const shown = Number(value.toPrecision(3));
  return unit === "°" ? `${shown}°` : `${shown} ${unit}`;
}

function channelOf(data, state) {
  return data.channels.find((c) => c.key === state.channel);
}

function panelOf(data, state) {
  return data.panels[`${state.world}|${state.channel}`];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// The scaffold every chart shares
// ---------------------------------------------------------------------------
function buildScaffold(root) {
  const controls = el("div", "chart__controls");
  const frame = el("div", "chart__frame");
  const canvas = el("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Chart of the numbers in the table view below.");
  const message = el("p", "chart__message");
  message.hidden = true;
  const tip = el("div", "chart-tip");
  tip.hidden = true;
  const tipBody = el("div");
  tip.appendChild(tipBody);
  frame.append(canvas, message, tip);
  const legend = el("div", "chart__legend");
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", "Methods shown");
  const table = el("details", "chart__table");
  table.appendChild(el("summary", null, "Table view"));
  const tableSlot = el("div");
  table.appendChild(tableSlot);
  root.prepend(controls, frame, legend, table);
  return { controls, frame, canvas, message, tip, tipBody, legend, tableSlot };
}

// A segmented control: its name above one track of options, the chosen one filled; calls
// onSelect(key) when another is chosen. An option shows its short name when it has one
// (the full name stays its accessible name).
function segmentedControl(label, options, current, onSelect) {
  const group = el("div", "segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  group.appendChild(el("span", "segmented__label", label));
  const track = el("div", "segmented__track");
  options.forEach((option) => {
    const button = el("button", "segmented__option", option.short ?? option.label);
    button.type = "button";
    if (option.short) button.setAttribute("aria-label", option.label);
    button.setAttribute("aria-pressed", String(option.key === current));
    button.addEventListener("click", () => {
      track.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      onSelect(option.key);
    });
    track.appendChild(button);
  });
  group.appendChild(track);
  return group;
}

// The view's methods present in this panel, in view order.
function viewTags(data, state, present) {
  return data.views.find((v) => v.key === state.view).tags.filter((tag) => present.includes(tag));
}

// ---------------------------------------------------------------------------
// Datasets: one per method, each point carrying its cell (value, floor, ratio) for the
// tooltip and the table; Chart.js lays out and hit-tests, the plugins below paint.
// ---------------------------------------------------------------------------
function barDatasets(data, state, yMode) {
  const panel = panelOf(data, state);
  if (!panel.cells) return [];
  return viewTags(data, state, Object.keys(panel.cells)).map((tag) => {
    const cells = data.depths.map((depth) => panel.cells[tag][String(depth)] ?? null);
    return {
      tag, label: data.methods[tag].label, color: data.methods[tag].color, starred: data.methods[tag].starred,
      cells,
      data: cells.map((cell) => (cell === null ? null : cell[yMode])),
      backgroundColor: "transparent", hoverBackgroundColor: "transparent", borderWidth: 0,
      categoryPercentage: 0.8, barPercentage: 0.92,
    };
  });
}

// A figure-2 step's ratio: the paper's rule leaves out a translation step whose
// no-motion error is under ratio_floor_min_cm.
function stepRatio(value, floor, channel, floorMin) {
  if (floor <= 0 || (channel === "translation" && floor < floorMin)) return null;
  return value / floor;
}

function lineDatasets(data, state, yMode) {
  const panel = panelOf(data, state);
  if (!panel.series) return [];
  return viewTags(data, state, Object.keys(panel.series)).map((tag) => {
    const row = panel.series[tag];
    const cells = row.depth.map((depth, i) => {
      const ratio = stepRatio(row.value[i], row.floor[i], state.channel, data.ratio_floor_min_cm);
      return { depth, value: row.value[i], floor: row.floor[i], ratio, unreliable: false };
    });
    return {
      tag, label: data.methods[tag].label, color: data.methods[tag].color, starred: data.methods[tag].starred,
      cells,
      data: cells.map((cell) => ({ x: cell.depth, y: yMode === "ratio" ? cell.ratio : cell.value })),
      borderColor: data.methods[tag].color, backgroundColor: data.methods[tag].color,
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, spanGaps: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Tables (each chart's accessible twin)
// ---------------------------------------------------------------------------
function cellText(cell, unit) {
  if (cell === null) return "–";
  const ratio = cell.ratio === null ? "ratio left out" : `${cell.ratio.toFixed(2)}×`;
  return `${withUnit(cell.value, unit)} (${ratio})`;
}

function tableShell(data, state, columns) {
  const channel = channelOf(data, state);
  const world = data.worlds.find((w) => w.key === state.world).label;
  const table = el("table");
  table.createCaption().textContent =
    `${world}, ${channel.label.toLowerCase()} error (in brackets: ratio to the no-motion error)`;
  const head = table.createTHead().insertRow();
  columns.forEach((text) => {
    const th = el("th", null, text);
    th.scope = "col";
    head.appendChild(th);
  });
  return table;
}

function rowHeader(row, text) {
  const th = el("th", null, text);
  th.scope = "row";
  row.appendChild(th);
}

function barTable(data, state, datasets) {
  const panel = panelOf(data, state);
  const table = tableShell(data, state, ["Method", ...data.depths.map((d) => `${d} steps`)]);
  if (panel.message) { table.caption.textContent += `. ${panel.message}`; return table; }
  const unit = channelOf(data, state).unit;
  const body = table.createTBody();
  datasets.forEach((set) => {
    const row = body.insertRow();
    rowHeader(row, set.starred ? `${set.label} ★` : set.label);
    set.cells.forEach((cell) => { row.insertCell().textContent = cellText(cell, unit); });
  });
  return table;
}

function lineTable(data, state, datasets) {
  const panel = panelOf(data, state);
  const table = tableShell(data, state, ["Step", ...datasets.map((s) => (s.starred ? `${s.label} ★` : s.label))]);
  if (panel.message) { table.caption.textContent += `. ${panel.message}`; return table; }
  const unit = channelOf(data, state).unit;
  const body = table.createTBody();
  const steps = datasets.length ? datasets[0].cells.map((cell) => cell.depth) : [];
  steps.forEach((step, i) => {
    const row = body.insertRow();
    rowHeader(row, String(step));
    datasets.forEach((set) => { row.insertCell().textContent = cellText(set.cells[i] ?? null, unit); });
  });
  return table;
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------
// The bars, each a continuous-corner rectangle whose rounded end is the data end: the path
// runs past the baseline and is clipped there, so only the top corners show; a bar above
// the axis is clipped at the axis top like any other.
const continuousBars = {
  id: "continuousBars",
  afterDatasetsDraw(chart, _args, options) {
    const { ctx, chartArea } = chart;
    chart.data.datasets.forEach((set, i) => {
      if (!chart.isDatasetVisible(i)) return;
      chart.getDatasetMeta(i).data.forEach((bar, j) => {
        if (set.data[j] === null) return;
        const width = bar.width, left = bar.x - width / 2;
        const top = bar.y, height = bar.base - top;
        if (height <= 0.5 || width <= 0) return;
        const shape = new Path2D(continuousRectPath(width, height + 4 * BAR_RADIUS, BAR_RADIUS));
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, bar.base - chartArea.top);
        ctx.clip();
        ctx.translate(left, top);
        ctx.fillStyle = set.color;
        ctx.fill(shape);
        ctx.strokeStyle = options.edge;     // a faint edge: the darkest colours sit under 3:1 on night
        ctx.lineWidth = 1;
        ctx.stroke(shape);
        ctx.restore();
      });
    });
  },
};

// Ratio bars above the axis are clipped at its top; their number is written over the bar.
const overflowLabels = {
  id: "overflowLabels",
  afterDatasetsDraw(chart, _args, options) {
    if (!options.enabled) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.fillStyle = options.color;
    ctx.font = `600 11px ${Chart.defaults.font.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    chart.data.datasets.forEach((set, i) => {
      if (!chart.isDatasetVisible(i)) return;
      chart.getDatasetMeta(i).data.forEach((bar, j) => {
        const value = set.data[j];
        if (value !== null && value > scales.y.max) ctx.fillText(`${value.toFixed(1)}×`, bar.x, chartArea.top - 4);
      });
    });
    ctx.restore();
  },
};

// The paper's white star on the starred method (Ours): at the middle of each bar, or on
// the line every STAR_EVERY steps.
function drawStar(ctx, x, y, outer) {
  const inner = outer * 0.45;
  ctx.beginPath();
  for (let k = 0; k < 10; k += 1) {
    const r = k % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
}

const starredMarks = {
  id: "starredMarks",
  afterDatasetsDraw(chart, _args, options) {
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.fillStyle = options.color;
    chart.data.datasets.forEach((set, i) => {
      if (!set.starred || !chart.isDatasetVisible(i)) return;
      chart.getDatasetMeta(i).data.forEach((mark, j) => {
        const raw = set.data[j];
        if (raw === null || (typeof raw === "object" && raw.y === null)) return;
        if (options.kind === "bars") {
          const top = Math.max(mark.y, chartArea.top);
          drawStar(ctx, mark.x, (top + mark.base) / 2, Math.min(6, Math.max(3, (mark.base - top) / 3)));
        } else if (set.cells[j].depth % STAR_EVERY === 0 && mark.y >= chartArea.top && mark.y <= chartArea.bottom) {
          drawStar(ctx, mark.x, mark.y, 6);
        }
      });
    });
    ctx.restore();
  },
};

// A line chart's crosshair: a vertical rule at the step under the pointer.
const crosshair = {
  id: "crosshair",
  afterDatasetsDraw(chart, _args, options) {
    const active = chart.tooltip.getActiveElements();
    if (!active.length) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = options.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(active[0].element.x, chartArea.top);
    ctx.lineTo(active[0].element.x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

// ---------------------------------------------------------------------------
// Tooltip and legend (HTML, so their corners are continuous)
// ---------------------------------------------------------------------------
function renderTooltip(parts, tooltip, unit, title) {
  const { tip, tipBody, frame } = parts;
  if (tooltip.opacity === 0 || !tooltip.dataPoints || !tooltip.dataPoints.length) {
    tip.hidden = true;
    return;
  }
  const rows = tooltip.dataPoints.map((point) => {
    const set = point.dataset, cell = set.cells[point.dataIndex];
    const row = el("div", "chart-tip__row");
    row.style.setProperty("--swatch", set.color);
    const swatch = el("span", "chart-tip__swatch");
    // a fixed-size square: its continuous corner is set once, no resize observer per hover
    swatch.style.borderRadius = "0";
    swatch.style.clipPath = `path("${continuousRectPath(TIP_SWATCH[0], TIP_SWATCH[0], TIP_SWATCH[1])}")`;
    const ratio = cell.ratio === null ? "ratio left out (no-motion error near zero)"
      : `${cell.ratio.toFixed(2)}×` + (cell.unreliable ? " · ratio unreliable" : "");
    row.append(swatch, el("span", "chart-tip__name", set.starred ? `${set.label} ★` : set.label),
      el("strong", "chart-tip__value", withUnit(cell.value, unit)),
      el("span", "chart-tip__detail", `no-motion ${withUnit(cell.floor, unit)} · ${ratio}`));
    return row;
  });
  tipBody.replaceChildren(el("p", "chart-tip__title", title(tooltip.dataPoints[0])), ...rows);
  tip.hidden = false;
  const x = tooltip.caretX, y = tooltip.caretY;
  const fitsRight = x + TIP_GAP + tip.offsetWidth <= frame.clientWidth;
  tip.style.left = `${fitsRight ? x + TIP_GAP : Math.max(0, x - TIP_GAP - tip.offsetWidth)}px`;
  tip.style.top = `${Math.min(Math.max(0, y - tip.offsetHeight / 2), frame.clientHeight - tip.offsetHeight)}px`;
}

function renderLegend(legend, chart, datasets) {
  const items = datasets.map((set, i) => {
    const button = el("button", "legend-item");
    button.type = "button";
    button.style.setProperty("--swatch", set.color);
    button.setAttribute("aria-pressed", String(chart ? chart.isDatasetVisible(i) : true));
    const swatch = el("span", "legend-item__swatch");
    swatch.setAttribute("aria-hidden", "true");
    button.append(swatch, document.createTextNode(set.starred ? `${set.label} ★` : set.label));
    button.addEventListener("click", () => {
      if (!chart) return;
      const show = !chart.isDatasetVisible(i);
      chart.setDatasetVisibility(i, show);
      button.setAttribute("aria-pressed", String(show));
      chart.update();
    });
    return button;
  });
  legend.replaceChildren(...items);
  applyContinuousCorners(legend);
}

// ---------------------------------------------------------------------------
// Axes and configs
// ---------------------------------------------------------------------------
// A log axis labelled only at 1, 2 and 5 times a power of ten.
function logTick(value) {
  const lead = Number((value / 10 ** Math.floor(Math.log10(value))).toPrecision(2));
  return [1, 2, 5].includes(lead) ? String(Number(value.toPrecision(2))) : "";
}

function yAxis(data, state, yMode) {
  const text = cssToken("--lavender");
  const grid = { color: withAlpha(cssToken("--cream"), 0.16) };
  const unit = channelOf(data, state).unit;
  const title = { display: true, color: text,
                  text: yMode === "ratio" ? "Error / predict-no-motion error" : `Error (${unit}, log axis)` };
  if (yMode === "ratio") {
    return { min: 0, max: data.ratio_ymax, title, grid, border: { display: false },
             ticks: { color: text, stepSize: 0.25, callback: (value) => value.toFixed(2) } };
  }
  return { type: "logarithmic", title, grid, border: { display: false }, ticks: { color: text, callback: logTick } };
}

function chartConfig(kind, data, state, yMode, datasets, parts) {
  const text = cssToken("--lavender");
  const bars = kind === "bars";
  return {
    type: bars ? "bar" : "line",
    data: bars ? { labels: data.depths.map(String), datasets } : { datasets },
    plugins: bars ? [continuousBars, overflowLabels, starredMarks] : [crosshair, starredMarks],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartReducedMotion.matches ? false : { duration: 700, easing: "easeOutQuart" },
      layout: { padding: { top: 20 } },
      interaction: bars ? { mode: "index", intersect: false } : { mode: "index", axis: "x", intersect: false },
      scales: {
        x: bars
          ? { grid: { display: false }, ticks: { color: text }, title: { display: true, text: "Rollout length (steps)", color: text } }
          : { type: "linear", min: 1, grid: { display: false }, ticks: { color: text, stepSize: 5 },
              title: { display: true, text: "Self-fed step", color: text } },
        y: yAxis(data, state, yMode),
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false, external: ({ tooltip }) => renderTooltip(parts, tooltip, channelOf(data, state).unit,
          (point) => (bars ? `${point.label} steps` : `Step ${point.raw.x}`)) },
        continuousBars: { edge: withAlpha(cssToken("--cream"), 0.55) },
        overflowLabels: { enabled: yMode === "ratio", color: cssToken("--cream") },
        starredMarks: { kind, color: "#ffffff" },
        crosshair: { color: withAlpha(cssToken("--cream"), 0.35) },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// One chart
// ---------------------------------------------------------------------------
async function initChart(root) {
  const kind = root.dataset.chart, yMode = root.dataset.chartY;
  if (!["bars", "lines"].includes(kind) || !["ratio", "value"].includes(yMode)) {
    throw new Error(`figure data-chart="${kind}" data-chart-y="${yMode}": expected bars|lines and ratio|value`);
  }
  const response = await fetch(root.dataset.chartSrc);
  if (!response.ok) throw new Error(`chart data ${root.dataset.chartSrc}: HTTP ${response.status}`);
  const data = await response.json();
  const parts = buildScaffold(root);
  const state = { world: data.worlds[0].key, channel: data.channels[0].key, view: data.views[0].key };
  const makeDatasets = () => (kind === "bars" ? barDatasets : lineDatasets)(data, state, yMode);
  const makeTable = (datasets) => (kind === "bars" ? barTable : lineTable)(data, state, datasets);
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  let chart = null;

  const render = () => {
    const panel = panelOf(data, state);
    parts.message.hidden = !panel.message;
    parts.message.textContent = panel.message || "";
    parts.canvas.style.visibility = panel.message ? "hidden" : "visible";
    parts.tip.hidden = true;
    const datasets = makeDatasets();
    parts.tableSlot.replaceChildren(makeTable(datasets));
    if (chart) {
      chart.data.datasets = datasets;
      chart.options.scales.y = yAxis(data, state, yMode);
      chart.update();
    }
    renderLegend(parts.legend, chart, datasets);
  };
  const choose = (key) => (value) => { state[key] = value; render(); };

  parts.controls.append(
    segmentedControl("World", data.worlds, state.world, choose("world")),
    segmentedControl("Error", data.channels, state.channel, choose("channel")),
    segmentedControl("Methods", data.views, state.view, choose("view")),
  );
  applyContinuousCorners(parts.controls);
  applyContinuousCorners(parts.frame);
  render();

  // Drawn on first sight (a carousel's hidden slide waits until it is shown), so the
  // marks grow in where the reader is looking.
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    chart = new Chart(parts.canvas, chartConfig(kind, data, state, yMode, makeDatasets(), parts));
    render();
  }, { threshold: 0.3 });
  observer.observe(parts.canvas);
}

document.querySelectorAll("figure[data-chart]").forEach((root) => {
  initChart(root).catch((error) => {
    root.prepend(el("p", "chart__message chart__message--error", "The chart's data could not load."));
    console.error("Chart failed", root.dataset.chartSrc, error);
  });
});
