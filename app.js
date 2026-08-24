import { createDiceStage, formatFace } from "./dice3d.js?v=faces512";
import { pickHortQuote } from "./quotes.js?v=faces512";
import { composeShareStill } from "./share-card.js?v=faces512";

const envFilm = document.querySelector("#env-film");
const form = document.querySelector("#war-table");
const envSelect = document.querySelector("#environment");
const dieSelect = document.querySelector("#die");
const rollBtn = document.querySelector("#roll");
const shareBtn = document.querySelector("#share");
const hortBox = document.querySelector("#hort");
const hortRoll = document.querySelector(".hort-roll");
const hortLine = document.querySelector(".hort-line");
const hortContext = document.querySelector(".hort-context");
const muteBtn = document.querySelector("#mute");
const dice = createDiceStage(document.querySelector("#die-stage"), envFilm);
window.__dice = dice;

let lastResult = null;
let actionId = 0;
let envWait = null;
let userMuted = localStorage.getItem("rollerator-mute") === "1";

function mediaUrl(id) {
  return `public/env/${id}.mp4?v=2`;
}

function tap() {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* ignore */
  }
}

function playEnv(id, { loop, muted }) {
  if (envWait) envWait();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      envFilm.removeEventListener("ended", finish);
      envFilm.removeEventListener("error", finish);
      envFilm.removeEventListener("abort", finish);
      clearTimeout(timer);
      if (envWait === finish) envWait = null;
      resolve();
    };
    envWait = finish;
    const timer = setTimeout(finish, 12000);
    envFilm.addEventListener("ended", finish, { once: true });
    envFilm.addEventListener("error", finish, { once: true });
    envFilm.addEventListener("abort", finish, { once: true });
    envFilm.poster = `public/posters/${id}.jpg?v=2`;
    envFilm.loop = loop;
    envFilm.muted = userMuted || muted;
    if (envFilm.src.includes(`/${id}.mp4`) && envFilm.readyState >= 2) {
      envFilm.currentTime = 0;
    } else {
      envFilm.src = mediaUrl(id);
    }
    const play = envFilm.play();
    if (play && typeof play.catch === "function") play.catch(() => {
      if (!loop) finish();
    });
    if (loop) finish();
  });
}

function syncMuteButton() {
  muteBtn.setAttribute("aria-pressed", userMuted ? "true" : "false");
  muteBtn.setAttribute("aria-label", userMuted ? "Unmute sound" : "Mute sound");
  envFilm.muted = userMuted || envFilm.loop;
}

async function shareStill(file) {
  const filesOnly = { files: [file] };
  if (navigator.canShare?.(filesOnly)) {
    await navigator.share(filesOnly);
    return;
  }
  const blank = { files: [file], text: "\u200b" };
  if (navigator.canShare?.(blank)) {
    await navigator.share(blank);
    return;
  }
  if (navigator.clipboard?.write && typeof ClipboardItem === "function") {
    await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]);
    return "copied";
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return "saved";
}

// Share is an icon now, so its feedback cannot be a label swap: writing
// textContent would delete the inline SVG and resize the stud. The word goes
// on a data attribute that styles.css floats above the button, which costs no
// layout. The accessible name still changes and changes back, exactly as the
// old text swap did.
let shareFlashTimer = null;

function flashShare(word) {
  shareBtn.dataset.flash = word;
  shareBtn.setAttribute("aria-label", word);
  clearTimeout(shareFlashTimer);
  shareFlashTimer = setTimeout(() => {
    delete shareBtn.dataset.flash;
    shareBtn.setAttribute("aria-label", "Share");
  }, 1400);
}

function setIdle() {
  actionId += 1;
  lastResult = null;
  shareBtn.hidden = true;
  hortBox.hidden = true;
  rollBtn.disabled = false;
  dice.abortRoll();
  dice.setKind(dieSelect.value, envSelect.value);
  dice.resetCamera();
  playEnv(envSelect.value, { loop: true, muted: true });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  tap();
  const env = envSelect.value;
  const kind = dieSelect.value;
  const id = ++actionId;

  lastResult = null;
  shareBtn.hidden = true;
  hortBox.hidden = true;
  rollBtn.disabled = true;
  try {
    dice.setKind(kind, env);
    const envPlay = playEnv(env, { loop: false, muted: false });
    const diePlay = dice.roll();
    // The number is what the click was for, so it lands when the THROW is
    // done -- dice.roll() resolves at crane start, so the quote arrives as the
    // camera does. These used to be one `await Promise.all([envPlay, diePlay])`,
    // which meant the result also waited on the environment film's `ended`:
    // the films are 5-7s long, so a ~1s throw put the number on screen after
    // six. The film now returns to its idle loop on its own clock.
    envPlay.then(() => {
      if (id !== actionId) return;
      envFilm.loop = true;
      envFilm.muted = true;
      envFilm.play().catch(() => playEnv(env, { loop: true, muted: true }));
      syncMuteButton();
    });
    const value = await diePlay;
    if (id !== actionId) return;
    if (value == null) return;
    const hort = pickHortQuote(kind, value);
    hortRoll.textContent = `${kind}  ·  ${formatFace(kind, value)}`;
    hortLine.textContent = `“${hort.line}”`;
    hortContext.textContent = hort.context;
    hortBox.hidden = false;
    lastResult = { env, kind, value, quote: hort.line, context: hort.context };
    shareBtn.hidden = false;
  } finally {
    if (id === actionId) rollBtn.disabled = false;
  }
});

shareBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  tap();
  shareBtn.disabled = true;
  try {
    const scene = await dice.snapshot();
    const still = await composeShareStill(scene);
    const file = new File([still], `rollerator-${lastResult.kind}-${lastResult.value}.png`, {
      type: "image/png",
    });
    const mode = await shareStill(file);
    if (mode === "copied" || mode === "saved") {
      flashShare(mode === "copied" ? "Copied" : "Saved");
    }
  } catch (err) {
    if (err?.name !== "AbortError") {
      flashShare("Failed");
    }
  } finally {
    shareBtn.disabled = false;
  }
});

muteBtn.addEventListener("click", () => {
  tap();
  userMuted = !userMuted;
  localStorage.setItem("rollerator-mute", userMuted ? "1" : "0");
  syncMuteButton();
});

envSelect.addEventListener("change", setIdle);
dieSelect.addEventListener("change", setIdle);
setIdle();
syncMuteButton();
