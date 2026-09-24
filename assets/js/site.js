// Page behaviour. Each feature is one init function bound to data- attributes,
// so the content it acts on lives in index.html, not here.
"use strict";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Continuous corners: Apple's rounded-rectangle curve, the path SwiftUI draws for
// RoundedRectangle(style: .continuous) (three cubic Beziers a corner, constants in
// units of the radius, measured on macOS 26.5; CALayer's continuous expansion factor
// is the same 1.528665). Short sides shrink only their own edge-adjacent segment.
const CORNER_EXTENT = 0.528665;
function cornerAxisPoints(half, r) {
  const t = Math.max(0, Math.min(1, (half / r - 1) / CORNER_EXTENT));
  return [(1 + CORNER_EXTENT * t) * r, (0.96 + 0.12849 * t) * r, (0.82 + 0.048407 * t) * r];
}

function continuousRectPath(w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  const [ex, bx, cx] = cornerAxisPoints(w / 2, r);
  const [ey, by, cy] = cornerAxisPoints(h / 2, r);
  const d = 0.631494 * r, e = 0.074911 * r, f = 0.372824 * r, g = 0.169060 * r;
  return [
    `M${ex} 0 L${w - ex} 0`,
    `C${w - bx} 0 ${w - cx} 0 ${w - d} ${e}`,
    `C${w - f} ${g} ${w - g} ${f} ${w - e} ${d}`,
    `C${w} ${cy} ${w} ${by} ${w} ${ey} L${w} ${h - ey}`,
    `C${w} ${h - by} ${w} ${h - cy} ${w - e} ${h - d}`,
    `C${w - g} ${h - f} ${w - f} ${h - g} ${w - d} ${h - e}`,
    `C${w - cx} ${h} ${w - bx} ${h} ${w - ex} ${h} L${ex} ${h}`,
    `C${bx} ${h} ${cx} ${h} ${d} ${h - e}`,
    `C${f} ${h - g} ${g} ${h - f} ${e} ${h - d}`,
    `C0 ${h - cy} 0 ${h - by} 0 ${h - ey} L0 ${ey}`,
    `C0 ${by} 0 ${cy} ${e} ${d}`,
    `C${g} ${f} ${f} ${g} ${d} ${e}`,
    `C${cx} 0 ${bx} 0 ${ex} 0Z`,
  ].join(" ");
}

// The radius the stylesheet gives an element, in pixels (a percentage is of the shorter side).
function cornerRadiusPx(style, w, h) {
  const raw = style.borderTopLeftRadius;
  return raw.endsWith("%") ? (parseFloat(raw) / 100) * Math.min(w, h) : parseFloat(raw);
}

// Clip one rounded element to the continuous curve and redraw its border as a
// stroke of the same curve (an element that cannot hold children, such as a
// video, is clipped only); the path follows the element's size.
function initContinuousCorners(el) {
  const style = getComputedStyle(el);
  const radius = cornerRadiusPx(style, el.offsetWidth, el.offsetHeight);
  const border = parseFloat(style.borderTopWidth);
  const holdsChildren = !(el instanceof HTMLVideoElement || el instanceof HTMLImageElement);
  el.dataset.corners = "";
  el.style.borderRadius = "0";
  let edge = null;
  if (holdsChildren) {
    if (style.position === "static") el.style.position = "relative";
    el.style.borderColor = "transparent";
    edge = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    edge.setAttribute("class", "corner-edge");
    edge.setAttribute("aria-hidden", "true");
    edge.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path"));
    el.appendChild(edge);
  }
  const update = () => {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const path = continuousRectPath(w, h, radius);
    el.style.clipPath = `path("${path}")`;
    if (!edge) return;
    edge.setAttribute("viewBox", `0 0 ${w} ${h}`);
    edge.setAttribute("width", w);
    edge.setAttribute("height", h);
    edge.style.left = `${-parseFloat(style.borderLeftWidth)}px`;
    edge.style.top = `${-border}px`;
    const line = edge.firstChild;
    line.setAttribute("d", path);
    line.setAttribute("stroke-width", 2 * border);   // the outer half is clipped away
  };
  new ResizeObserver(update).observe(el);
  update();
}

// A control's visible label: its first text node only, so a child such as the
// continuous-corner edge survives a label change (textContent would drop it).
function setLabel(el, text) {
  const node = Array.from(el.childNodes).find((child) => child.nodeType === Node.TEXT_NODE);
  if (node) node.nodeValue = text;
  else el.prepend(document.createTextNode(text));
}

// Highlight strip: arrow buttons step one tile and disable at either end.
function initStrip(root) {
  const track = root.querySelector(".strip");
  const prev = root.querySelector("[data-strip-prev]");
  const next = root.querySelector("[data-strip-next]");
  const update = () => {
    prev.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1;
  };
  const step = (direction) => {
    const tile = track.querySelector(".tile");
    const gap = parseFloat(getComputedStyle(track).columnGap);
    track.scrollBy({
      left: direction * (tile.getBoundingClientRect().width + gap),
      behavior: reduceMotion.matches ? "auto" : "smooth",
    });
  };
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  track.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}

// Method steps: mark the step crossing the middle of the viewport.
function initSteps(steps) {
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        steps.forEach((s) => s.classList.toggle("is-active", s === entry.target));
      }
    });
  }, { rootMargin: "-45% 0px -45% 0px" });
  steps.forEach((s) => observer.observe(s));
}

// BibTeX copy button reports failure instead of failing silently.
function initCopy(button) {
  button.addEventListener("click", async () => {
    const source = document.getElementById(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(source.textContent);
      setLabel(button, "Copied");
    } catch (error) {
      setLabel(button, "Copy failed");
      console.error("BibTeX copy failed", error);
    }
    setTimeout(() => { setLabel(button, "Copy"); }, 2000);
  });
}

// Hero video: it starts itself (muted, looping) unless the reader prefers
// reduced motion, who gets the poster until pressing Play; on a phone
// (data-phone-media, the same query as the phone <source>) the poster is the
// phone cut's (data-phone-poster); each chapter card
// seeks to its run's start (data-time, seconds) and the card of the run on
// screen is marked; the toggle pauses and resumes.
function initHeroVideo(root) {
  const video = root.querySelector("video");
  const toggle = root.querySelector("[data-video-toggle]");
  const chapters = Array.from(root.querySelectorAll("[data-time]"));
  const starts = chapters.map((chapter) => Number(chapter.dataset.time));
  if (window.matchMedia(video.dataset.phoneMedia).matches) video.poster = video.dataset.phonePoster;
  const showState = () => { setLabel(toggle, video.paused ? "Play" : "Pause"); };
  const markCurrent = () => {
    const current = starts.reduce((found, start, index) => (video.currentTime >= start ? index : found), 0);
    chapters.forEach((chapter, index) => chapter.setAttribute("aria-current", String(index === current)));
  };
  const play = () => video.play().catch((error) => {
    showState();
    console.error("Hero video could not play", error);
  });
  chapters.forEach((chapter, index) => {
    chapter.addEventListener("click", () => {
      video.currentTime = starts[index];
      markCurrent();
      play();
    });
  });
  toggle.addEventListener("click", () => { if (video.paused) play(); else video.pause(); });
  video.addEventListener("play", showState);
  video.addEventListener("pause", showState);
  video.addEventListener("timeupdate", markCurrent);
  showState();
  if (!reduceMotion.matches) play();
  markCurrent();
}

// Every element the stylesheet rounds inside root, not yet converted; the corner rule has
// no exceptions, so content built later (the charts' controls) is passed through it too.
function applyContinuousCorners(root) {
  Array.from(root.querySelectorAll("*"))
    .filter((el) => !("corners" in el.dataset) && parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0)
    .forEach(initContinuousCorners);
}

applyContinuousCorners(document.body);

// Keyboard focus on an element the corner pass leaves alone (a link, a summary) is shown
// by one ring with the same continuous curve, drawn over the element; an outline cannot
// take the curve. The CSS outline stands for readers without JavaScript.
const FOCUS_RING_GAP = 3;        // px between the element and the ring
const FOCUS_RING_RADIUS = 4;     // the element's own corner radius the ring grows from, px
function initFocusRing() {
  const ns = "http://www.w3.org/2000/svg";
  const ring = document.createElementNS(ns, "svg");
  ring.setAttribute("class", "focus-ring");
  ring.setAttribute("aria-hidden", "true");
  ring.appendChild(document.createElementNS(ns, "path"));
  ring.style.display = "none";
  document.body.appendChild(ring);
  document.documentElement.dataset.focusRing = "";
  let target = null;
  const place = () => {
    if (!target) return;
    const box = target.getBoundingClientRect();
    const w = box.width + 2 * FOCUS_RING_GAP, h = box.height + 2 * FOCUS_RING_GAP;
    ring.setAttribute("width", w + 2);
    ring.setAttribute("height", h + 2);
    ring.style.left = `${box.left + window.scrollX - FOCUS_RING_GAP - 1}px`;
    ring.style.top = `${box.top + window.scrollY - FOCUS_RING_GAP - 1}px`;
    const path = ring.firstChild;
    path.setAttribute("d", continuousRectPath(w, h, FOCUS_RING_RADIUS + FOCUS_RING_GAP));
    path.setAttribute("transform", "translate(1 1)");
  };
  document.addEventListener("focusin", (event) => {
    const el = event.target;
    const takesRing = el instanceof Element && !("corners" in el.dataset) && el.matches(":focus-visible");
    target = takesRing ? el : null;
    ring.style.display = takesRing ? "" : "none";
    place();
  });
  document.addEventListener("focusout", () => { target = null; ring.style.display = "none"; });
  window.addEventListener("resize", place);
}

initFocusRing();

// Carousel: one slide shown at a time, the arrow buttons (and the arrow keys while focus
// is inside) step through them, and the status line names the slide and its position.
function initCarousel(root) {
  const slides = Array.from(root.querySelectorAll("[data-carousel-slide]"));
  const status = root.querySelector("[data-carousel-status]");
  const prev = root.querySelector("[data-carousel-prev]");
  const next = root.querySelector("[data-carousel-next]");
  let current = 0;
  const show = (index) => {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.hidden = i !== current;
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.setAttribute("aria-label", `${i + 1} of ${slides.length}`);
    });
    status.textContent = `${current + 1} / ${slides.length} · ${slides[current].dataset.slideTitle}`;
  };
  prev.addEventListener("click", () => show(current - 1));
  next.addEventListener("click", () => show(current + 1));
  root.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea, select")) return;
    if (event.key === "ArrowLeft") { show(current - 1); event.preventDefault(); }
    if (event.key === "ArrowRight") { show(current + 1); event.preventDefault(); }
  });
  show(0);
}

document.querySelectorAll("[data-carousel]").forEach(initCarousel);
document.querySelectorAll("[data-hero-video]").forEach(initHeroVideo);
document.querySelectorAll("[data-strip]").forEach(initStrip);
initSteps(Array.from(document.querySelectorAll(".step")));
document.querySelectorAll("[data-copy]").forEach(initCopy);
