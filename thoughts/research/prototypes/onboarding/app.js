/* global URL, URLSearchParams, document, history, location, requestAnimationFrame, window */

import { actualVariant } from "./variants/actual.js";
import { focusVariant } from "./variants/focus.js";
import { contextVariant } from "./variants/context.js";

const variants = [actualVariant, focusVariant, contextVariant];
const stage = document.getElementById("stage");
const picker = document.querySelector(".proto-picker");
const highlight = picker.querySelector(".proto-picker-highlight");
const items = [...picker.querySelectorAll(".proto-picker-item:not(.proto-picker-replay)")];
const replay = picker.querySelector(".proto-picker-replay");
let current = 0;
let cleanup = () => {};

function updatePickerPosition() {
  if (window.innerWidth <= 820) picker.setAttribute("data-position", "top");
  else picker.removeAttribute("data-position");
}

function moveHighlight() {
  const el = items[current];
  highlight.style.width = `${el.offsetWidth}px`;
  highlight.style.transform = `translateX(${el.offsetLeft}px)`;
}

function mount(i) {
  cleanup();
  stage.innerHTML = "";
  requestAnimationFrame(() => {
    stage.innerHTML = variants[i].render();
    cleanup = variants[i].setup(stage) || (() => {});
  });
}

function setActive(i) {
  if (i < 0 || i >= variants.length) return;
  current = i;
  items.forEach((el, j) => {
    el.toggleAttribute("data-active", j === i);
    if (j === i) el.setAttribute("aria-current", "true");
    else el.removeAttribute("aria-current");
  });
  moveHighlight();
  const url = new URL(location);
  url.searchParams.set("v", i + 1);
  history.replaceState(null, "", url);
  mount(i);
}

items.forEach((el, i) => el.addEventListener("click", () => setActive(i)));
replay?.addEventListener("click", () => mount(current));
window.addEventListener("resize", () => {
  moveHighlight();
  updatePickerPosition();
});

document.addEventListener("keydown", (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const num = Number.parseInt(e.key, 10);
  if (num >= 1 && num <= variants.length) setActive(num - 1);
  else if (e.key === "ArrowRight") setActive((current + 1) % variants.length);
  else if (e.key === "ArrowLeft") setActive((current - 1 + variants.length) % variants.length);
  else if (e.key === "r" || e.key === "R") mount(current);
});

updatePickerPosition();
setActive((Number.parseInt(new URLSearchParams(location.search).get("v"), 10) || 1) - 1);
requestAnimationFrame(() => requestAnimationFrame(() => picker.setAttribute("data-ready", "")));
