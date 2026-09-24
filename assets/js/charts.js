// Interactive figures. Each figure[data-bar-chart] names, in data-chart-src, a JSON exported
// from the paper figure's own data (dare/project-page/export_chart_data.py): worlds, error
// channels, rollout lengths, each cell's error, no-motion error and ratio, the methods'
// night colours and the chart's views. The chart is built when it scrolls into view;
// controls switch world / error / methods with an animated transition; hovering shows each
// method's real numbers; the legend toggles methods; a table view carries the same numbers.
// Every rounded shape follows Apple's continuous corner: Chart.js draws the axes and hit
// areas only, the bars are drawn here with continuousRectPath (site.js), and the tooltip
// and legend are HTML that site.js's corner pass converts. Needs Chart.js (assets/js/vendor).
"use strict";

const chartReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const BAR_RADIUS = 4;           // the data end's corner radius, px
const TIP_GAP = 14;             // px between the pointer and the tooltip
const TIP_SWATCH = [10, 3];     // the tooltip swatch's side and corner radius, px (as in site.css)

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

function unitOf(data, state) {
  return data.channels.find((c) => c.key === state.channel).unit;
}

// A row of toggle buttons, one pressed; calls onSelect(key) when another is chosen.
function segmentedControl(label, options, current, onSelect) {
  const group = document.createElement("div");
  group.className = "segmented";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  const name = document.createElement("span");
  name.className = "segmented__label";
  name.textContent = label;
  group.appendChild(name);
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segmented__option";
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(option.key === current));
    button.addEventListener("click", () => {
      group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      onSelect(option.key);
    });
    group.appendChild(button);
  });
  return group;
}

// The Chart.js datasets of one state: the view's methods that have a value in this panel.
// Chart.js keeps the bars invisible (it lays them out and hit-tests them); continuousBars
// paints them.
function barDatasets(data, state) {
  const panel = data.panels[`${state.world}|${state.channel}`];
  const view = data.views.find((v) => v.key === state.view);
  return view.tags.filter((tag) => panel.cells && panel.cells[tag]).map((tag) => ({
    label: data.methods[tag].label,
    color: data.methods[tag].color,
    starred: data.methods[tag].starred,
    cells: data.depths.map((depth) => panel.cells[tag][String(depth)] ?? null),
    data: data.depths.map((depth) => panel.cells[tag][String(depth)]?.ratio ?? null),
    backgroundColor: "transparent",
    hoverBackgroundColor: "transparent",
    borderWidth: 0,
    categoryPercentage: 0.8,
    barPercentage: 0.92,
  }));
}

// The same numbers as an HTML table (the chart's accessible twin).
function barTable(data, state) {
  const panel = data.panels[`${state.world}|${state.channel}`];
  const world = data.worlds.find((w) => w.key === state.world).label;
  const channel = data.channels.find((c) => c.key === state.channel).label;
  const table = document.createElement("table");
  const caption = table.createCaption();
  caption.textContent = `${world}, ${channel.toLowerCase()} error at each rollout length (in brackets: ratio to the no-motion error)`;
  if (panel.message) {
    caption.textContent += `. ${panel.message}`;
    return table;
  }
  const unit = unitOf(data, state);
  const head = table.createTHead().insertRow();
  ["Method", ...data.depths.map((d) => `${d} steps`)].forEach((text) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    head.appendChild(th);
  });
  const body = table.createTBody();
  barDatasets(data, state).forEach((set) => {
    const row = body.insertRow();
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = set.starred ? `${set.label} ★` : set.label;
    row.appendChild(th);
    set.cells.forEach((cell) => {
      row.insertCell().textContent = cell === null ? "–" : `${withUnit(cell.value, unit)} (${cell.ratio.toFixed(2)}×)`;
    });
  });
  return table;
}

// The bars, each a continuous-corner rectangle whose rounded end is the data end: the
// path runs past the baseline and is clipped there, so only the top corners show; a
// bar above the axis is clipped at the axis top like any other.
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

// Values above the axis are clipped at its top; their number is written over the bar.
const overflowLabels = {
  id: "overflowLabels",
  afterDatasetsDraw(chart, _args, options) {
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

// The paper's white star on the starred method's bars (Ours), at the middle of the drawn bar.
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

const starredBars = {
  id: "starredBars",
  afterDatasetsDraw(chart, _args, options) {
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.fillStyle = options.color;
    chart.data.datasets.forEach((set, i) => {
      if (!set.starred || !chart.isDatasetVisible(i)) return;
      chart.getDatasetMeta(i).data.forEach((bar, j) => {
        if (set.data[j] === null) return;
        const top = Math.max(bar.y, chartArea.top);
        const outer = Math.min(6, Math.max(3, (bar.base - top) / 3));
        drawStar(ctx, bar.x, (top + bar.base) / 2, outer);
      });
    });
    ctx.restore();
  },
};

// The HTML tooltip: the rollout length, then per method its error, the no-motion error it
// is divided by and the ratio; placed beside the pointer, inside the chart frame.
function renderTooltip(tip, chart, tooltip, unit) {
  if (tooltip.opacity === 0 || !tooltip.dataPoints || !tooltip.dataPoints.length) {
    tip.hidden = true;
    return;
  }
  const body = tip.querySelector("[data-chart-tip-body]");
  const title = document.createElement("p");
  title.className = "chart-tip__title";
  title.textContent = `${tooltip.dataPoints[0].label} steps`;
  const rows = tooltip.dataPoints.map((point) => {
    const set = point.dataset, cell = set.cells[point.dataIndex];
    const row = document.createElement("div");
    row.className = "chart-tip__row";
    row.style.setProperty("--swatch", set.color);
    const swatch = document.createElement("span");
    swatch.className = "chart-tip__swatch";
    // a fixed-size square: its continuous corner is set once, no resize observer per hover
    swatch.style.borderRadius = "0";
    swatch.style.clipPath = `path("${continuousRectPath(TIP_SWATCH[0], TIP_SWATCH[0], TIP_SWATCH[1])}")`;
    const name = document.createElement("span");
    name.className = "chart-tip__name";
    name.textContent = set.starred ? `${set.label} ★` : set.label;
    const value = document.createElement("strong");
    value.className = "chart-tip__value";
    value.textContent = withUnit(cell.value, unit);
    const detail = document.createElement("span");
    detail.className = "chart-tip__detail";
    detail.textContent = `no-motion ${withUnit(cell.floor, unit)} · ${cell.ratio.toFixed(2)}×`
      + (cell.unreliable ? " · ratio unreliable" : "");     // the paper's flag: no-motion error near zero
    row.append(swatch, name, value, detail);
    return row;
  });
  body.replaceChildren(title, ...rows);
  tip.hidden = false;
  const frame = chart.canvas.parentElement;
  const x = tooltip.caretX, y = tooltip.caretY;
  const fitsRight = x + TIP_GAP + tip.offsetWidth <= frame.clientWidth;
  tip.style.left = `${fitsRight ? x + TIP_GAP : Math.max(0, x - TIP_GAP - tip.offsetWidth)}px`;
  tip.style.top = `${Math.min(Math.max(0, y - tip.offsetHeight / 2), frame.clientHeight - tip.offsetHeight)}px`;
}

// The HTML legend: one toggle button per method, pressed while its bars show.
function renderLegend(legend, chart, datasets) {
  const items = datasets.map((set, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "legend-item";
    button.style.setProperty("--swatch", set.color);
    const visible = chart ? chart.isDatasetVisible(i) : true;
    button.setAttribute("aria-pressed", String(visible));
    const swatch = document.createElement("span");
    swatch.className = "legend-item__swatch";
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

function barChartConfig(data, state, tip) {
  const text = cssToken("--lavender");
  const grid = withAlpha(cssToken("--cream"), 0.16);
  const axisTitle = (label) => ({ display: true, text: label, color: text });
  return {
    type: "bar",
    data: { labels: data.depths.map(String), datasets: barDatasets(data, state) },
    plugins: [continuousBars, overflowLabels, starredBars],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartReducedMotion.matches ? false : { duration: 700, easing: "easeOutQuart" },
      layout: { padding: { top: 20 } },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: text }, title: axisTitle(data.x_label) },
        y: { min: 0, max: data.ratio_ymax, ticks: { color: text, stepSize: 0.25, callback: (value) => value.toFixed(2) },
             grid: { color: grid }, border: { display: false }, title: axisTitle(data.y_label) },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false, external: ({ chart, tooltip }) => renderTooltip(tip, chart, tooltip, unitOf(data, state)) },
        continuousBars: { edge: withAlpha(cssToken("--cream"), 0.55) },
        overflowLabels: { color: cssToken("--cream") },
        starredBars: { color: "#ffffff" },
      },
    },
  };
}

async function initBarChart(root) {
  const response = await fetch(root.dataset.chartSrc);
  if (!response.ok) throw new Error(`chart data ${root.dataset.chartSrc}: HTTP ${response.status}`);
  const data = await response.json();
  const state = { world: data.worlds[0].key, channel: data.channels[0].key, view: data.views[0].key };
  const canvas = root.querySelector("[data-chart-canvas]");
  const message = root.querySelector("[data-chart-message]");
  const tableSlot = root.querySelector("[data-chart-table]");
  const legend = root.querySelector("[data-chart-legend]");
  const tip = root.querySelector("[data-chart-tip]");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  let chart = null;

  const render = () => {
    const panel = data.panels[`${state.world}|${state.channel}`];
    message.hidden = !panel.message;
    message.textContent = panel.message || "";
    canvas.style.visibility = panel.message ? "hidden" : "visible";
    tip.hidden = true;
    tableSlot.replaceChildren(barTable(data, state));
    const datasets = barDatasets(data, state);
    if (chart) {
      chart.data.datasets = datasets;
      chart.update();
    }
    renderLegend(legend, chart, panel.message ? [] : datasets);
  };
  const choose = (key) => (value) => { state[key] = value; render(); };

  const controls = root.querySelector("[data-chart-controls]");
  controls.append(
    segmentedControl("World", data.worlds, state.world, choose("world")),
    segmentedControl("Error", data.channels, state.channel, choose("channel")),
    segmentedControl("Methods", data.views, state.view, choose("view")),
  );
  applyContinuousCorners(controls);
  applyContinuousCorners(tip.parentElement);
  render();

  // Built on first sight, so the bars grow in where the reader is looking.
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    chart = new Chart(canvas, barChartConfig(data, state, tip));
    render();
  }, { threshold: 0.3 });
  observer.observe(canvas);
}

document.querySelectorAll("[data-bar-chart]").forEach((root) => {
  initBarChart(root).catch((error) => {
    const message = root.querySelector("[data-chart-message]");
    message.hidden = false;
    message.textContent = "The chart's data could not load.";
    console.error("Bar chart failed", root.dataset.chartSrc, error);
  });
});
