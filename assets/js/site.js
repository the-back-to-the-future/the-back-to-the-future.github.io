// Page behaviour. Each feature is one init function bound to data- attributes,
// so the content it acts on lives in index.html, not here.
"use strict";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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
      button.textContent = "Copied";
    } catch (error) {
      button.textContent = "Copy failed";
      console.error("BibTeX copy failed", error);
    }
    setTimeout(() => { button.textContent = "Copy"; }, 2000);
  });
}

// Hero video: it starts itself (muted, looping) unless the reader prefers
// reduced motion, who gets the poster until pressing Play; each chapter card
// seeks to its run's start (data-time, seconds) and the card of the run on
// screen is marked; the toggle pauses and resumes.
function initHeroVideo(root) {
  const video = root.querySelector("video");
  const toggle = root.querySelector("[data-video-toggle]");
  const chapters = Array.from(root.querySelectorAll("[data-time]"));
  const starts = chapters.map((chapter) => Number(chapter.dataset.time));
  const showState = () => { toggle.textContent = video.paused ? "Play" : "Pause"; };
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

document.querySelectorAll("[data-hero-video]").forEach(initHeroVideo);
document.querySelectorAll("[data-strip]").forEach(initStrip);
initSteps(Array.from(document.querySelectorAll(".step")));
document.querySelectorAll("[data-copy]").forEach(initCopy);
