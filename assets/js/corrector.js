// Interactive Fig. 3, the retrospective corrector. A figure[data-corrector] names its JSON in
// data-corrector-src (dare/project-page/export_corrector_data.py writes it from the paper
// figure's per-cycle dump): per episode the recorded frames, the deployment that corrects at
// every observation, each correction cycle's no-corrector continuation (its first frames the
// blind window the corrector read), the mismatches, every puck's translation error and each
// frame's translation RMSE, the scene box and the diameters; the paper's episode, cycle and
// late step; and the reveal order of the supplementary video's animation. The figure's card
// holds the static PNG as the no-script fallback: this script builds the controls above the
// card (episode, correction window, step, Play), replaces the card's contents with the figure
// drawn as inline SVG in the paper figure's layout and colours on its white canvas (the row
// titles in the logo gradient, text in the page's font), writes the translation RMSE under it,
// and shows the site's tooltip over any frame. The step moves both rows' late frames and marks
// the frames that show it; Play reveals the figure in the animation's order, and a reader who
// prefers reduced motion gets the finished figure at once.
"use strict";

const correctorReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const CORRECTOR_SVG_NS = "http://www.w3.org/2000/svg";
const CORRECTOR_TIP_GAP = 14;              // px between the pointer and the tooltip
const CORRECTOR_UNITS = "cm";
// White margin around the drawing inside the card, pt: the card clips its content to rounded
// corners (18 px, about 12 pt at a phone's width), which the paper's 0.02 in edge would reach.
const CORRECTOR_PAD = 8;

// The paper figure's layout (prototypes/self-correction/joint-training/corrector_figure.py) in
// points: one 3.15 in column, seven tiles and seven gaps per rollout row plus the ellipsis
// slot, vertical positions in tile sides from the top edge.
const CORRECTOR_LAYOUT = (() => {
  const width = 3.15 * 72, sidePad = 0.02 * 72, gap = 0.085 * 72, ellipsis = 0.13 * 72;
  const tile = (width - 2 * sidePad - 7 * gap - ellipsis) / 7;
  return {
    width, sidePad, gap, ellipsis, tile, height: 5.45 * tile,
    topLabel: 0.17 * tile, topRow: 0.74 * tile, bus: 2.06 * tile, sideTiles: 2.24 * tile,
    pillHeight: 0.74 * tile, greenJog: 3.40 * tile, bottomRow: 4.00 * tile,
    bottomLabel: 5.25 * tile, greenEntry: 0.78, rounding: 0.12 * tile, corner: 0.03 * 72,
    head: [0.045 * 72, 0.042 * 72], greenHead: [0.055 * 72, 0.052 * 72],
    smallHead: [0.028 * 72, 0.026 * 72], frameLabelGap: 0.018 * 72, sideLabelGap: 0.02 * 72,
    minMismatchArrow: 0.012,
  };
})();
// Line widths (pt), font sizes (pt), dash patterns (pt, the paper's pattern times its width).
const CORRECTOR_STROKE = { tile: 0.4, arrow: 0.8, green: 1.2, puck: 0.35, truth: 0.45, observed: 0.75,
                           mismatch: 0.6, highlight: 1.4 };
const CORRECTOR_FONT = { title: 7, pill: 7, frame: 7, side: 6.5, ellipsis: 8, sub: 5 };
const CORRECTOR_DASH = { bus: "1.76 1.28", truth: "0.675 0.45" };
// The paper figure's colours (corrector_figure.py's PAPER_STYLE, from its draw.io sketch).
const CORRECTOR_COLORS = {
  frameFill: "#ffffff", frameStroke: "#000000", startFill: "#eeeeee", startStroke: "#36393d",
  arrivalFill: "#fad9d5", arrivalStroke: "#ae4132", observationFill: "#fad7ac",
  observationStroke: "#b46504", mismatchFill: "#ffff88", mismatchStroke: "#36393d",
  correctedFill: "#cdeb8b", correctedStroke: "#36393d", afterFill: "#cce5ff", afterStroke: "#36393d",
  pillFill: "#647687", pillStroke: "#314354", pillText: "#ffffff", arrow: "#000000", green: "#37a959",
  pusher: "#36393d", puckFace: "#ffffff", puckEdge: "#36393d", truthEdge: "#000000", text: "#000000",
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function correctorEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function correctorSvg(tag, attributes) {
  const node = document.createElementNS(CORRECTOR_SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
  return node;
}

function correctorToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// A segmented control in the charts' markup: its name above one track of options, the chosen
// one filled; onSelect(key) when another is chosen.
function correctorSegmented(label, options, current, onSelect) {
  const group = correctorEl("div", "segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  group.appendChild(correctorEl("span", "segmented__label", label));
  const track = correctorEl("div", "segmented__track");
  options.forEach((option) => {
    const button = correctorEl("button", "segmented__option", option.label);
    button.type = "button";
    button.setAttribute("aria-label", option.name);
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

// ---------------------------------------------------------------------------
// What each frame holds: the episode's positions (m), per-puck errors and RMSE (cm) at a step,
// for the row without the corrector (continued from the cycle's carried state) or with it.
// Before the cycle's start both rows are the deployment's shared history; step 0 is the record.
// ---------------------------------------------------------------------------
function correctorStart(data, state) {
  return state.cycle * data.window;
}

function correctorPucks(data, episode, state, row, step) {
  const start = correctorStart(data, state);
  if (step === 0) return episode.truth_m[0].slice(1);
  if (row === "blind" && step > start) return episode.cycles[state.cycle].no_corrector_m[step - start - 1];
  return episode.corrected_m[step - 1];
}

function correctorErrors(data, episode, state, row, step) {
  const start = correctorStart(data, state);
  if (step === 0) return episode.truth_m[0].slice(1).map(() => 0);
  if (row === "blind" && step > start) return episode.cycles[state.cycle].no_corrector_error_cm[step - start - 1];
  return episode.corrected_error_cm[step - 1];
}

function correctorRmse(data, episode, state, row, step) {
  const start = correctorStart(data, state);
  if (step === 0) return 0;
  if (row === "blind" && step > start) return episode.cycles[state.cycle].no_corrector_rmse_cm[step - start - 1];
  return episode.corrected_rmse_cm[step - 1];
}

// ---------------------------------------------------------------------------
// Drawing primitives (points; the SVG's y runs down)
// ---------------------------------------------------------------------------
function correctorColumnX(index) {
  return CORRECTOR_LAYOUT.sidePad + index * (CORRECTOR_LAYOUT.tile + CORRECTOR_LAYOUT.gap);
}

function correctorLateX() {
  return correctorColumnX(6) + CORRECTOR_LAYOUT.ellipsis + CORRECTOR_LAYOUT.gap;
}

// A polyline whose interior corners are quadratic curves of the paper's radius.
function correctorLinePath(points) {
  const unit = (dx, dy) => { const n = Math.hypot(dx, dy); return [dx / n, dy / n]; };
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1], [cx, cy] = points[i], [nx, ny] = points[i + 1];
    const r = Math.min(CORRECTOR_LAYOUT.corner, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    const [ix, iy] = unit(cx - px, cy - py), [ox, oy] = unit(nx - cx, ny - cy);
    d += ` L${cx - ix * r} ${cy - iy * r} Q${cx} ${cy} ${cx + ox * r} ${cy + oy * r}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

function correctorLine(points, color, width, dash) {
  const attributes = { d: correctorLinePath(points), fill: "none", stroke: color, "stroke-width": width,
                       "stroke-linejoin": "round" };
  if (dash) attributes["stroke-dasharray"] = dash;
  return correctorSvg("path", attributes);
}

// An arrow as the paper draws it: the line stops inside a notched filled head.
function correctorArrow(points, color, width, head, dash) {
  const [tipX, tipY] = points[points.length - 1], [prevX, prevY] = points[points.length - 2];
  const n = Math.hypot(tipX - prevX, tipY - prevY), ux = (tipX - prevX) / n, uy = (tipY - prevY) / n;
  const [length, spread] = head;
  const shaft = points.slice(0, -1).concat([[tipX - ux * length * 0.6, tipY - uy * length * 0.6]]);
  const baseX = tipX - ux * length, baseY = tipY - uy * length, px = -uy * spread / 2, py = ux * spread / 2;
  const group = correctorSvg("g", {});
  group.appendChild(correctorLine(shaft, color, width, dash));
  group.appendChild(correctorSvg("polygon", {
    points: `${tipX},${tipY} ${baseX + px},${baseY + py} ${tipX - ux * length * 0.75},${tipY - uy * length * 0.75} ${baseX - px},${baseY - py}`,
    fill: color, stroke: color, "stroke-width": 0.1 }));
  return group;
}

function correctorText(x, y, text, size, anchor, attributes) {
  const node = correctorSvg("text", { x, y, "font-size": size, "text-anchor": anchor, fill: CORRECTOR_COLORS.text,
                                      ...attributes });
  node.textContent = text;
  return node;
}

// A frame label: an italic t (with a tilde on the corrected row) over the step as subscript.
function correctorFrameLabel(x, y, step, tilde) {
  const label = correctorSvg("text", { x, y, "font-size": CORRECTOR_FONT.frame, "text-anchor": "middle",
                                       fill: CORRECTOR_COLORS.text });
  const t = correctorSvg("tspan", { "font-style": "italic" });
  t.textContent = tilde ? "t̃" : "t";
  const sub = correctorSvg("tspan", { "font-size": CORRECTOR_FONT.sub, dy: 1.6 });
  sub.textContent = String(step);
  label.append(t, sub);
  return label;
}

// ---------------------------------------------------------------------------
// The figure: every group carries the animation stage that reveals it
// ---------------------------------------------------------------------------
function correctorFigure(data, episode, state) {
  const L = CORRECTOR_LAYOUT, C = CORRECTOR_COLORS, W = data.window, T = L.tile;
  const start = correctorStart(data, state), observed = start + W, step = state.step;
  const pad = CORRECTOR_PAD;
  const svg = correctorSvg("svg", { viewBox: `${-pad} ${-pad} ${L.width + 2 * pad} ${L.height + 2 * pad}`, role: "img",
                                    focusable: "false" });
  svg.style.display = "block";
  svg.style.width = "100%";
  svg.style.height = "auto";
  const defs = correctorSvg("defs", {});
  const gradient = correctorSvg("linearGradient", { id: "corrector-logo", x1: 0, y1: 0, x2: 1, y2: 0 });
  [[0, "--btf-red"], [0.17, "--btf-red"], [0.66, "--btf-yellow"], [1, "--btf-yellow"]].forEach(([offset, token]) => {
    gradient.appendChild(correctorSvg("stop", { offset, "stop-color": correctorToken(token) }));
  });
  defs.appendChild(gradient);
  svg.appendChild(defs);
  let clips = 0;
  const box = episode.box_m, radii = episode.diameters_m.map((d) => (d / 2 / box.side) * T);
  const toTile = (x, top, [px, py]) => [x + ((px - box.origin[0]) / box.side) * T,
                                         top + (1 - (py - box.origin[1]) / box.side) * T];
  const stage = (name) => { const g = correctorSvg("g", { "data-stage": name }); svg.appendChild(g); return g; };

  // One rounded tile with its scene clipped to it; tip names what the hover shows.
  const tile = (group, x, top, fill, stroke, tip) => {
    const holder = correctorSvg("g", { "data-tip": tip.kind, "data-row": tip.row, "data-step": tip.step,
                                       "data-late": tip.late ? "true" : "false" });
    holder.appendChild(correctorSvg("rect", { x, y: top, width: T, height: T, rx: L.rounding, fill, stroke,
                                              "stroke-width": CORRECTOR_STROKE.tile }));
    clips += 1;
    const clip = correctorSvg("clipPath", { id: `corrector-clip-${clips}` });
    clip.appendChild(correctorSvg("rect", { x, y: top, width: T, height: T, rx: L.rounding }));
    defs.appendChild(clip);
    const scene = correctorSvg("g", { "clip-path": `url(#corrector-clip-${clips})` });
    holder.appendChild(scene);
    const current = tip.late ? step < start || step > observed : tip.kind === "frame" && tip.step === step;
    if (current) {
      const pad = CORRECTOR_STROKE.highlight;
      holder.appendChild(correctorSvg("rect", { x: x - pad, y: top - pad, width: T + 2 * pad, height: T + 2 * pad,
                                                rx: L.rounding + pad, fill: "none", stroke: correctorToken("--accent"),
                                                "stroke-width": CORRECTOR_STROKE.highlight, "data-current": "true" }));
    }
    group.appendChild(holder);
    return scene;
  };
  const disc = (scene, x, top, xy, radius, face, edge, width, dash) => {
    const [cx, cy] = toTile(x, top, xy);
    const attributes = { cx, cy, r: radius, fill: face, stroke: edge, "stroke-width": width };
    if (dash) attributes["stroke-dasharray"] = dash;
    scene.appendChild(correctorSvg("circle", attributes));
  };
  const scene = (target, x, top, step, pucks, edge) => {
    disc(target, x, top, episode.truth_m[step][0], radii[0], C.pusher, C.pusher, CORRECTOR_STROKE.puck, null);
    pucks.forEach((xy, i) => disc(target, x, top, xy, radii[i + 1], C.puckFace, edge, CORRECTOR_STROKE.puck, null));
  };
  const truthOutlines = (target, x, top, step) => {
    episode.truth_m[step].slice(1).forEach((xy, i) => disc(target, x, top, xy, radii[i + 1], "none", C.truthEdge,
                                                            CORRECTOR_STROKE.truth, CORRECTOR_DASH.truth));
  };
  const rowArrow = (group, k, centre) => group.appendChild(correctorArrow(
    [[correctorColumnX(k) + T, centre], [correctorColumnX(k + 1), centre]], C.arrow, CORRECTOR_STROKE.arrow, L.head, null));
  const lateArrows = (group, centre) => {
    group.appendChild(correctorArrow([[correctorColumnX(5) + T, centre], [correctorColumnX(6) + 0.012 * 72, centre]],
                                     C.arrow, CORRECTOR_STROKE.arrow, L.head, null));
    group.appendChild(correctorText(correctorColumnX(6) + L.ellipsis / 2, centre + 0.3 * CORRECTOR_FONT.ellipsis, "···",
                                    CORRECTOR_FONT.ellipsis,
                                    "middle", { "font-weight": 700 }));
    group.appendChild(correctorArrow([[correctorColumnX(6) + L.ellipsis - 0.012 * 72, centre], [correctorLateX(), centre]],
                                     C.arrow, CORRECTOR_STROKE.arrow, L.head, null));
  };
  const frameLabel = (group, x, top, labelStep, tilde) => group.appendChild(
    correctorFrameLabel(x + T / 2, top - L.frameLabelGap - 2.2, labelStep, tilde));
  const title = (group, y, text) => group.appendChild(correctorText(correctorLateX() + T, y + 0.35 * CORRECTOR_FONT.title,
    text, CORRECTOR_FONT.title, "end", { "font-weight": 700, fill: "url(#corrector-logo)" }));

  const topTop = L.topRow, topCentre = topTop + T / 2, sideTop = L.sideTiles, sideCentre = sideTop + T / 2;
  const bottomTop = L.bottomRow, bottomCentre = bottomTop + T / 2;
  const pillLeft = correctorColumnX(1), pillWidth = correctorColumnX(4) + T - pillLeft;
  const pillTop = sideCentre - L.pillHeight / 2, pillMid = pillLeft + pillWidth / 2;

  // The top row: the shared start frame, the blind window, the late frame without the corrector.
  let group = stage("start");
  scene(tile(group, correctorColumnX(0), topTop, C.startFill, C.startStroke,
             { kind: "frame", row: "start", step: start, late: false }),
        correctorColumnX(0), topTop, start, correctorPucks(data, episode, state, "blind", start), C.puckEdge);
  frameLabel(group, correctorColumnX(0), topTop, start, false);
  for (let i = 1; i <= W; i += 1) {
    group = stage(`blind_${i}`);
    rowArrow(group, i - 1, topCentre);
    const arrival = i === W;
    scene(tile(group, correctorColumnX(i), topTop, arrival ? C.arrivalFill : C.frameFill,
               arrival ? C.arrivalStroke : C.frameStroke, { kind: "frame", row: "blind", step: start + i, late: false }),
          correctorColumnX(i), topTop, start + i, correctorPucks(data, episode, state, "blind", start + i), C.puckEdge);
    frameLabel(group, correctorColumnX(i), topTop, start + i, false);
  }
  group = stage("no_corrector_late");
  lateArrows(group, topCentre);
  let late = tile(group, correctorLateX(), topTop, C.frameFill, C.frameStroke,
                  { kind: "frame", row: "blind", step, late: true });
  scene(late, correctorLateX(), topTop, step, correctorPucks(data, episode, state, "blind", step), C.puckEdge);
  if (step > observed) truthOutlines(late, correctorLateX(), topTop, step);
  frameLabel(group, correctorLateX(), topTop, step, false);
  title(group, L.topLabel, "No Corrector");

  // The corrector (its group placed before the arrows that end on it, so they draw over it).
  group = stage("corrector");
  group.appendChild(correctorSvg("rect", { x: pillLeft, y: pillTop, width: pillWidth, height: L.pillHeight,
                                           rx: L.pillHeight / 2, fill: C.pillFill, stroke: C.pillStroke,
                                           "stroke-width": CORRECTOR_STROKE.tile }));
  group.appendChild(correctorText(pillMid, sideCentre + 0.35 * CORRECTOR_FONT.pill, "Retrospective Corrector",
                                  CORRECTOR_FONT.pill, "middle", { "font-weight": 700, fill: C.pillText }));

  // The corrector's inputs: the start frame solid, the blind frames dashed along one bus.
  const x0 = correctorColumnX(0) + T / 2;
  stage("record_start_line").appendChild(correctorArrow([[x0, topTop + T], [x0, sideCentre], [pillLeft, sideCentre]],
                                                        C.arrow, CORRECTOR_STROKE.arrow, L.head, null));
  for (let k = 1; k < W; k += 1) {
    const xk = correctorColumnX(k) + T / 2;
    stage(`record_drop_${k}`).appendChild(correctorLine([[xk, topTop + T], [xk, L.bus]], C.arrow,
                                                        CORRECTOR_STROKE.arrow, CORRECTOR_DASH.bus));
  }
  const xFirst = correctorColumnX(1) + T / 2, xWindow = correctorColumnX(W) + T / 2;
  group = stage("record_bus");
  group.appendChild(correctorLine([[xFirst, L.bus], [xWindow, L.bus]], C.arrow, CORRECTOR_STROKE.arrow, CORRECTOR_DASH.bus));
  group.appendChild(correctorArrow([[pillMid, L.bus], [pillMid, pillTop]], C.arrow, CORRECTOR_STROKE.arrow, L.head,
                                   CORRECTOR_DASH.bus));

  // The observation at the window's end and the mismatch against the blind frame.
  const obsX = correctorColumnX(6), misX = correctorColumnX(W);
  group = stage("observation");
  scene(tile(group, obsX, sideTop, C.observationFill, C.observationStroke,
             { kind: "observation", row: "record", step: observed, late: false }),
        obsX, sideTop, observed, episode.truth_m[observed].slice(1), C.observationStroke);
  group.appendChild(correctorText(obsX + T / 2, sideTop - L.sideLabelGap - 1.4, "Observation", CORRECTOR_FONT.side,
                                  "middle", { "font-weight": 700 }));
  group = stage("mismatch");
  group.appendChild(correctorArrow([[obsX, sideCentre], [misX + T, sideCentre]], C.arrow, CORRECTOR_STROKE.arrow, L.head, null));
  group.appendChild(correctorArrow([[xWindow, topTop + T], [xWindow, sideTop]], C.arrow, CORRECTOR_STROKE.arrow, L.head, null));
  const mismatch = tile(group, misX, sideTop, C.mismatchFill, C.mismatchStroke,
                        { kind: "mismatch", row: "blind", step: observed, late: false });
  disc(mismatch, misX, sideTop, episode.truth_m[observed][0], radii[0], C.pusher, C.pusher, CORRECTOR_STROKE.puck, null);
  const predicted = correctorPucks(data, episode, state, "blind", observed);
  episode.truth_m[observed].slice(1).forEach((xy, i) => {
    disc(mismatch, misX, sideTop, predicted[i], radii[i + 1], C.puckFace, C.arrivalStroke, CORRECTOR_STROKE.puck, null);
    disc(mismatch, misX, sideTop, xy, radii[i + 1], "none", C.observationStroke, CORRECTOR_STROKE.observed, null);
    const from = toTile(misX, sideTop, predicted[i]), to = toTile(misX, sideTop, xy);
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) / T > L.minMismatchArrow) {
      mismatch.appendChild(correctorArrow([from, to], C.mismatchStroke, CORRECTOR_STROKE.mismatch, L.smallHead, null));
    }
  });
  group.appendChild(correctorText(misX + T / 2, sideTop + T + L.sideLabelGap + 0.75 * CORRECTOR_FONT.side, "Mismatch",
                                  CORRECTOR_FONT.side, "middle", { "font-weight": 700 }));
  stage("mismatch_arrow").appendChild(correctorArrow([[misX, sideCentre], [pillLeft + pillWidth, sideCentre]], C.arrow,
                                                     CORRECTOR_STROKE.arrow, L.head, null));

  // The corrector's one applied output, landing on the corrected row's first frame.
  const xGreen = pillLeft + 0.25 * pillWidth, xEntry = correctorColumnX(1) + L.greenEntry * T;
  stage("green_arrow").appendChild(correctorArrow([[xGreen, pillTop + L.pillHeight], [xGreen, L.greenJog],
                                                   [xEntry, L.greenJog], [xEntry, bottomTop]],
                                                  C.green, CORRECTOR_STROKE.green, L.greenHead, null));

  // The bottom row: the amended frame, the re-roll, the late frame with the corrector.
  for (let i = 1; i <= W; i += 1) {
    group = stage(`corrected_${i}`);
    if (i >= 2) rowArrow(group, i - 1, bottomCentre);
    scene(tile(group, correctorColumnX(i), bottomTop, C.correctedFill, C.correctedStroke,
               { kind: "frame", row: "corrected", step: start + i, late: false }),
          correctorColumnX(i), bottomTop, start + i, correctorPucks(data, episode, state, "corrected", start + i), C.puckEdge);
    frameLabel(group, correctorColumnX(i), bottomTop, start + i, true);
  }
  group = stage("corrected_late");
  lateArrows(group, bottomCentre);
  late = tile(group, correctorLateX(), bottomTop, C.afterFill, C.afterStroke,
              { kind: "frame", row: "corrected", step, late: true });
  scene(late, correctorLateX(), bottomTop, step, correctorPucks(data, episode, state, "corrected", step), C.puckEdge);
  if (step > observed) truthOutlines(late, correctorLateX(), bottomTop, step);
  frameLabel(group, correctorLateX(), bottomTop, step, true);
  title(group, L.bottomLabel, "Corrector");
  return svg;
}

// ---------------------------------------------------------------------------
// Tooltip (the charts' HTML tooltip, so its corners are continuous)
// ---------------------------------------------------------------------------
function correctorTipRow(name, value, strong) {
  const row = correctorEl("div", "chart-tip__row");
  row.append(correctorEl("span"), correctorEl("span", "chart-tip__name", name),
             correctorEl(strong ? "strong" : "span", "chart-tip__value", value));
  return row;
}

function correctorTipContent(data, episode, state, target) {
  const kind = target.dataset.tip, row = target.dataset.row, step = Number(target.dataset.step);
  const cm = (value) => `${value.toFixed(2)} ${CORRECTOR_UNITS}`;
  if (kind === "observation") {
    return [correctorEl("p", "chart-tip__title", `Observation at step ${step}`),
            correctorEl("p", "chart-tip__detail", "The recorded frame the blind rollout is compared with.")];
  }
  if (kind === "mismatch") {
    const mismatch = episode.cycles[state.cycle].mismatch_cm;
    return [correctorEl("p", "chart-tip__title", `Mismatch at step ${step}: the record minus the blind frame`),
            ...mismatch.map(([dx, dy], i) => correctorTipRow(`Puck ${i + 1}`, cm(Math.hypot(dx, dy)), false))];
  }
  const which = row === "corrected" ? "with the corrector" : row === "start" ? "the carried state" : "without the corrector";
  const errors = correctorErrors(data, episode, state, row === "start" ? "blind" : row, step);
  const rows = errors.map((error, i) => correctorTipRow(`Puck ${i + 1}`, cm(error), false));
  if (target.dataset.late === "true") {
    rows.push(correctorTipRow("Translation RMSE", cm(correctorRmse(data, episode, state, row, step)), true));
  }
  return [correctorEl("p", "chart-tip__title", `Step ${step}, ${which}: translation error`), ...rows];
}

function correctorPlaceTip(root, tip, clientX, clientY) {
  const box = root.getBoundingClientRect(), x = clientX - box.left, y = clientY - box.top;
  const fitsRight = x + CORRECTOR_TIP_GAP + tip.offsetWidth <= root.clientWidth;
  tip.style.left = `${fitsRight ? x + CORRECTOR_TIP_GAP : Math.max(0, x - CORRECTOR_TIP_GAP - tip.offsetWidth)}px`;
  tip.style.top = `${Math.min(Math.max(0, y - tip.offsetHeight / 2), root.clientHeight - tip.offsetHeight)}px`;
}

// ---------------------------------------------------------------------------
// The note under the card: the translation RMSE of both late frames
// ---------------------------------------------------------------------------
function correctorNote(data, episode, state, which) {
  const blind = correctorRmse(data, episode, state, "blind", state.step).toFixed(2);
  const corrected = correctorRmse(data, episode, state, "corrected", state.step).toFixed(2);
  const start = correctorStart(data, state);
  if (which === "accumulation") {
    return `Without the corrector the error accumulates: ${blind} ${CORRECTOR_UNITS} translation RMSE at step ${state.step}.`;
  }
  if (which === "correction") {
    return `Translation RMSE at step ${state.step}: ${blind} ${CORRECTOR_UNITS} without the corrector, ${corrected} ${CORRECTOR_UNITS} with it.`;
  }
  if (state.step <= start) return `Step ${state.step} comes before this window; both rows show the corrected deployment.`;
  return `Translation RMSE at step ${state.step}: ${blind} ${CORRECTOR_UNITS} without the corrector from step ${start}, `
    + `${corrected} ${CORRECTOR_UNITS} with it.`;
}

// ---------------------------------------------------------------------------
// One figure
// ---------------------------------------------------------------------------
async function initCorrector(root) {
  const response = await fetch(root.dataset.correctorSrc);
  if (!response.ok) throw new Error(`corrector data ${root.dataset.correctorSrc}: HTTP ${response.status}`);
  const data = await response.json();
  const card = root.querySelector(".fig-card");
  const fallback = card ? card.querySelector("img") : null;
  if (!fallback) throw new Error("figure[data-corrector] holds no .fig-card with the fallback image");
  const label = fallback.alt;
  // the figure on screen, swapped in place so the card keeps the corner pass's own children
  let figureNode = fallback;
  const episodes = new Map(data.episodes.map((episode) => [episode.id, episode]));
  const state = { episode: data.paper.episode, cycle: data.paper.cycle, step: data.paper.late_step,
                  playing: null };
  const stages = data.reveal.stages, holdMs = 1000 * data.reveal.hold_s;
  const drawn = correctorFigure(data, episodes.get(state.episode), state).querySelectorAll("[data-stage]");
  const unrevealed = Array.from(drawn, (group) => group.dataset.stage).filter((name) => !stages.includes(name));
  if (unrevealed.length) throw new Error(`the reveal order lacks the figure's stages ${unrevealed.join(", ")}`);

  const controls = correctorEl("div", "chart__controls");
  const note = correctorEl("p", "caption");
  note.setAttribute("aria-live", "polite");
  const tip = correctorEl("div", "chart-tip");
  tip.hidden = true;
  const stepGroup = correctorEl("div", "segmented");
  stepGroup.style.flex = "1 1 220px";
  const scrubber = correctorEl("input");
  scrubber.type = "range";
  scrubber.id = "corrector-step";
  scrubber.min = "0";
  scrubber.max = String(data.steps);
  scrubber.step = "1";
  scrubber.value = String(state.step);
  scrubber.style.width = "100%";
  scrubber.style.accentColor = correctorToken("--btf-yellow");
  const stepLabel = correctorEl("label", "segmented__label");
  stepLabel.htmlFor = scrubber.id;
  stepGroup.append(stepLabel, scrubber);
  const play = correctorEl("button", "hero-video__toggle", "Play");
  play.type = "button";

  const draw = () => {
    const episode = episodes.get(state.episode);
    const svg = correctorFigure(data, episode, state);
    svg.setAttribute("aria-label", `${label} Episode ${state.episode}, window steps ${correctorStart(data, state)} to `
      + `${correctorStart(data, state) + data.window}, late frames at step ${state.step}.`);
    figureNode.replaceWith(svg);
    figureNode = svg;
    stepLabel.textContent = `Step ${state.step}`;
    scrubber.value = String(state.step);
    note.textContent = correctorNote(data, episode, state, "rest");
    tip.hidden = true;
  };
  // Show the first `count` stages of the reveal and the note it has reached.
  const reveal = (count) => {
    const shown = new Set(stages.slice(0, count));
    card.querySelectorAll("[data-stage]").forEach((group) => {
      group.style.display = shown.has(group.dataset.stage) ? "" : "none";
    });
    const episode = episodes.get(state.episode);
    const reached = shown.has("correction_note") ? "correction" : shown.has("accumulation_note") ? "accumulation" : null;
    note.textContent = reached ? correctorNote(data, episode, state, reached) : " ";
  };
  const stop = () => {
    if (state.playing === null) return;
    clearTimeout(state.playing);
    state.playing = null;
    setLabel(play, "Play");
    draw();
  };
  const start = () => {
    stop();
    state.step = data.paper.late_step;
    draw();
    if (correctorReducedMotion.matches) {
      note.textContent = correctorNote(data, episodes.get(state.episode), state, "correction");
      return;
    }
    setLabel(play, "Stop");
    let count = 1;
    reveal(count);
    const tick = () => {
      count += 1;
      reveal(count);
      if (count >= stages.length) {
        state.playing = null;
        setLabel(play, "Play");
        return;
      }
      state.playing = setTimeout(tick, holdMs);
    };
    state.playing = setTimeout(tick, holdMs);
  };
  const choose = (key, parse) => (value) => { stop(); state[key] = parse(value); draw(); };

  const episodeOptions = data.episodes.map((episode) => ({
    key: episode.id, label: episode.id === data.paper.episode ? `${episode.id} (paper)` : String(episode.id),
    name: episode.id === data.paper.episode ? `Episode ${episode.id}, the paper's` : `Episode ${episode.id}` }));
  controls.appendChild(correctorSegmented("Episode", episodeOptions, state.episode, choose("episode", Number)));
  if (data.cycles > 1) {
    const windows = Array.from({ length: data.cycles }, (_, c) => ({
      key: c, label: `${c * data.window}–${(c + 1) * data.window}`,
      name: `Correction window, steps ${c * data.window} to ${(c + 1) * data.window}` }));
    controls.appendChild(correctorSegmented("Correction window", windows, state.cycle, choose("cycle", Number)));
  }
  controls.append(stepGroup, play);
  scrubber.addEventListener("input", () => { stop(); state.step = Number(scrubber.value); draw(); });
  play.addEventListener("click", () => { if (state.playing === null) start(); else stop(); });

  // Hover (or a tap) on a frame shows its numbers.
  const showTip = (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
    if (!target || target.closest("[data-stage]").style.display === "none") { tip.hidden = true; return; }
    tip.replaceChildren(...correctorTipContent(data, episodes.get(state.episode), state, target));
    tip.hidden = false;
    correctorPlaceTip(root, tip, event.clientX, event.clientY);
  };
  card.addEventListener("pointermove", showTip);
  card.addEventListener("pointerdown", showTip);
  card.addEventListener("pointerleave", (event) => { if (event.pointerType !== "touch") tip.hidden = true; });
  document.addEventListener("pointerdown", (event) => { if (!card.contains(event.target)) tip.hidden = true; });

  root.style.position = "relative";
  root.insertBefore(controls, card);
  card.after(note);
  root.appendChild(tip);
  draw();
  applyContinuousCorners(root);
}

document.querySelectorAll("figure[data-corrector]").forEach((root) => {
  initCorrector(root).catch((error) => {
    root.prepend(correctorEl("p", "chart__message chart__message--error", "The interactive figure's data could not load."));
    console.error("Corrector figure failed", root.dataset.correctorSrc, error);
  });
});
