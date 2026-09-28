// The paper's results table. A figure[data-table] names its JSON in data-table-src
// (dare/project-page/export_table_data.py writes it from the paper's LaTeX table: every
// printed number, the paper's bold cells and shaded rows, the panel titles, caption and
// protocol note). The figure's markup is empty; each panel becomes one table with a
// three-tier header (metric, object count, placement difficulty) and the three label
// columns the paper prints, the starred method carries the charts' star, bold cells and
// shaded rows follow the paper, and the caption and note are written under the panels.
// The stat tiles ([data-stat]) read one cell each from the same JSON so the big numbers
// and the table never disagree; the markup's own text is the no-script fallback.
"use strict";

const STAT_ARROW = " → ";

function tableEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function headerCell(text, scope, span) {
  const th = tableEl("th", null, text);
  th.scope = scope;
  if (span > 1) th.colSpan = span;
  return th;
}

function formatValue(value, metric) {
  return metric.key === "success" ? value.toFixed(2) : value.toFixed(1);
}

function metricHeading(metric) {
  const arrow = metric.better === "up" ? "↑" : "↓";
  const unit = metric.unit ? ` (${metric.unit})` : "";
  return `${metric.label}${unit} ${arrow}`;
}

// The three header rows: metric names over their six columns, the object counts over
// Easy / Hard pairs, then the difficulties; the three label columns span all three rows.
function panelHead(table, data, panel) {
  const head = table.createTHead();
  const labels = ["Method", "Obs.", "Corr."];
  const top = head.insertRow();
  labels.forEach((text) => {
    const th = headerCell(text, "col", 1);
    th.rowSpan = 3;
    th.className = "results__label";
    top.appendChild(th);
  });
  panel.metrics.forEach((metric) => top.appendChild(headerCell(metricHeading(metric), "colgroup", data.columns.length)));
  const middle = head.insertRow();
  panel.metrics.forEach(() => data.counts.forEach((count) => middle.appendChild(headerCell(`${count} objects`, "colgroup", data.difficulties.length))));
  const bottom = head.insertRow();
  panel.metrics.forEach(() => data.columns.forEach((column) => bottom.appendChild(headerCell(column.difficulty, "col", 1))));
}

function panelBody(table, data, panel) {
  const body = table.createTBody();
  panel.rows.forEach((row) => {
    const tr = body.insertRow();
    if (row.shaded) tr.className = "results__row--ours";
    const method = headerCell(row.starred ? `${row.method} ★` : row.method, "row", 1);
    method.className = "results__label";
    tr.appendChild(method);
    tr.appendChild(tableEl("td", "results__label", row.observation));
    tr.appendChild(tableEl("td", "results__label", row.correction));
    panel.metrics.forEach((metric) => {
      row.values[metric.key].forEach((value, index) => {
        const td = tr.insertCell();
        td.textContent = formatValue(value, metric);
        if (row.bold[metric.key][index]) td.className = "results__best";
      });
    });
  });
}

function buildPanel(data, panel) {
  const wrap = tableEl("div", "results__panel");
  wrap.appendChild(tableEl("h3", "results__title", panel.title));
  const scroller = tableEl("div", "results__scroll");
  const table = tableEl("table", "results__table");
  panelHead(table, data, panel);
  panelBody(table, data, panel);
  scroller.appendChild(table);
  wrap.appendChild(scroller);
  return wrap;
}

function findRow(data, spec) {
  for (const panel of data.panels) {
    const metric = panel.metrics.find((m) => m.key === spec.metric);
    if (!metric) continue;
    const row = panel.rows.find((r) => r.method === spec.method && r.observation === spec.observation && r.correction === spec.correction);
    if (!row) throw new Error(`stat: no row ${spec.method} / ${spec.observation} / ${spec.correction}`);
    return { row, metric };
  }
  throw new Error(`stat: no metric ${spec.metric}`);
}

function columnIndex(data, spec) {
  const index = data.columns.findIndex((c) => c.count === Number(spec.count) && c.difficulty === spec.difficulty);
  if (index < 0) throw new Error(`stat: no column ${spec.count} ${spec.difficulty}`);
  return index;
}

// data-stat is "method|observation|correction|metric|count|difficulty"; a second spec after
// " > " prints both values with an arrow (a before-and-after pair).
function parseStat(text) {
  const [method, observation, correction, metric, count, difficulty] = text.split("|");
  return { method, observation, correction, metric, count, difficulty };
}

function statText(data, spec) {
  const { row, metric } = findRow(data, spec);
  return formatValue(row.values[metric.key][columnIndex(data, spec)], metric);
}

function fillStat(data, node) {
  const specs = node.dataset.stat.split(" > ").map(parseStat);
  node.textContent = specs.map((spec) => statText(data, spec)).join(STAT_ARROW);
}

async function initResultsTable(root) {
  const response = await fetch(root.dataset.tableSrc);
  if (!response.ok) throw new Error(`table data ${root.dataset.tableSrc}: HTTP ${response.status}`);
  const data = await response.json();
  const panels = tableEl("div", "results");
  data.panels.forEach((panel) => panels.appendChild(buildPanel(data, panel)));
  const caption = tableEl("figcaption", "caption results__caption");
  caption.appendChild(tableEl("strong", null, "Table I: "));
  caption.appendChild(document.createTextNode(data.caption));
  caption.appendChild(tableEl("span", "results__note", ` ${data.note}`));
  root.replaceChildren(panels, caption);
  document.querySelectorAll("[data-stat]").forEach((node) => fillStat(data, node));
  applyContinuousCorners(root);
}

document.querySelectorAll("figure[data-table]").forEach((root) => {
  initResultsTable(root).catch((error) => {
    root.prepend(tableEl("p", "chart__message chart__message--error", "The table's data could not load."));
    console.error("Table failed", root.dataset.tableSrc, error);
  });
});
