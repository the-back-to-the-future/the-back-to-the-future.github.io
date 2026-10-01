// The Highlights strip. section[data-highlights] names its JSON in data-highlights-src and the
// clips' folder in data-media-dir (dare/project-page/export_highlights_data.py writes both: E3
// cabinet scenes rendered with the arm in the control loop, each with its story group, setting,
// target and tile video, the four methods side by side, one column each, and each method's
// verdict, the paper's for that scene). The strip's markup is empty; each scene becomes one tile:
// its group, the video (poster, muted, looping, the 1280 px file under 734 px), the setting with
// a Pause/Play toggle, and each method's verdict under its own column of the video. A tile's video
// plays only while most of it is on screen, never by itself under reduced motion, and stays
// paused once the reader pauses it.
"use strict";

const CLIP_PHONE_MEDIA = "(max-width: 734px)";
const CLIP_VISIBLE_RATIO = 0.6;

function clipEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function settingText(scene) {
  return `${scene.cell.objects} objects, ${scene.cell.difficulty} placement. Target: ${scene.target.name}.`;
}

function buildClipVideo(scene, mediaDir) {
  const video = clipEl("video", "clip__video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "none";
  video.width = scene.video.frame_px[0];
  video.height = scene.video.frame_px[1];
  video.poster = mediaDir + scene.video.files.poster;
  const small = clipEl("source");
  small.src = mediaDir + scene.video.files.video_small;
  small.type = "video/mp4";
  small.media = CLIP_PHONE_MEDIA;
  const full = clipEl("source");
  full.src = mediaDir + scene.video.files.video_full;
  full.type = "video/mp4";
  video.append(small, full);
  return video;
}

function buildVerdict(method, entry) {
  const item = clipEl("li", "clip__result");
  const verdict = clipEl("span", `clip__verdict${entry.success ? " clip__verdict--success" : ""}`, entry.verdict);
  item.append(clipEl("span", "clip__method", method.label), verdict);
  return item;
}

function buildTile(data, scene, mediaDir) {
  const groups = Object.fromEntries(data.groups.map((group) => [group.group, group.label]));
  const entries = Object.fromEntries(scene.rows.map((entry) => [entry.row, entry]));
  const tile = clipEl("figure", "tile clip");
  const video = buildClipVideo(scene, mediaDir);
  const caption = clipEl("figcaption", "clip__bar");
  const toggle = clipEl("button", "clip__toggle", "Play");
  toggle.type = "button";
  toggle.dataset.videoToggle = "";
  caption.append(clipEl("p", "clip__setting", settingText(scene)), toggle);
  const results = clipEl("ul", "clip__results");
  results.setAttribute("aria-label", "Each method's result");
  data.methods.forEach((method) => results.append(buildVerdict(method, entries[method.row])));
  tile.append(clipEl("p", "clip__group", groups[scene.group]), video, results, caption);
  return tile;
}

// One tile's control: the Pause/Play toggle.
function initClip(tile) {
  const video = tile.querySelector("video");
  const toggle = tile.querySelector("[data-video-toggle]");
  const showState = () => { setLabel(toggle, video.paused ? "Play" : "Pause"); };
  const play = () => video.play().catch((error) => {
    showState();
    console.error("Highlight clip could not play", video.currentSrc, error);
  });
  toggle.addEventListener("click", () => {
    if (video.paused) {
      delete tile.dataset.readerPaused;
      play();
    } else {
      tile.dataset.readerPaused = "";
      video.pause();
    }
  });
  video.addEventListener("play", showState);
  video.addEventListener("pause", showState);
  showState();
}

// Plays a tile's clip while most of it is on screen and pauses it when it leaves.
function initClipVisibility(tiles) {
  const observer = new IntersectionObserver((records) => {
    records.forEach((record) => {
      const video = record.target.querySelector("video");
      if (record.intersectionRatio < CLIP_VISIBLE_RATIO) {
        video.pause();
      } else if (!reduceMotion.matches && !("readerPaused" in record.target.dataset)) {
        video.play().catch((error) => console.error("Highlight clip could not play", video.currentSrc, error));
      }
    });
  }, { threshold: [0, CLIP_VISIBLE_RATIO] });
  tiles.forEach((tile) => observer.observe(tile));
}

async function initHighlights(root) {
  const response = await fetch(root.dataset.highlightsSrc);
  if (!response.ok) throw new Error(`highlights data ${root.dataset.highlightsSrc}: HTTP ${response.status}`);
  const data = await response.json();
  const track = root.querySelector(".strip");
  const tiles = data.scenes.map((scene) => buildTile(data, scene, root.dataset.mediaDir));
  track.replaceChildren(...tiles);
  tiles.forEach(initClip);
  initClipVisibility(tiles);
  initStrip(root);
  applyContinuousCorners(root);
}

document.querySelectorAll("section[data-highlights]").forEach((root) => {
  initHighlights(root).catch((error) => {
    root.querySelector(".strip").replaceChildren(clipEl("p", "clip__message", "The highlight clips could not load."));
    console.error("Highlights failed", root.dataset.highlightsSrc, error);
  });
});
