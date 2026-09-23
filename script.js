const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const startButton = document.querySelector("#start-mission");
const transition = document.querySelector(".door-transition");
const missionFiles = document.querySelector("#mission-files");
const soundToggle = document.querySelector(".sound-toggle");
const soundLabel = document.querySelector(".sound-label");
const cards = [...document.querySelectorAll(".file-card")];
const openedCount = document.querySelector("#opened-count");
const progressBar = document.querySelector("#progress-bar");

let soundEnabled = false;
let audioContext;
const visitedFiles = new Set();

document.querySelector("#application-shortcut").addEventListener("click", (event) => {
  event.preventDefault();
  const applicationTrigger = document.querySelector('[aria-controls="file-application"]');
  if (applicationTrigger.getAttribute("aria-expanded") !== "true") applicationTrigger.click();
  applicationTrigger.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
  applicationTrigger.focus({ preventScroll: true });
});

function playTone(frequency = 330, duration = 0.07, volume = 0.035) {
  if (!soundEnabled) return;
  audioContext ??= new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggle.setAttribute("aria-label", soundEnabled ? "작전음 끄기" : "작전음 켜기");
  soundLabel.textContent = soundEnabled ? "SOUND ON" : "SOUND OFF";
  if (soundEnabled) playTone(540, 0.12, 0.04);
});

startButton.addEventListener("click", () => {
  playTone(220, 0.18, 0.045);
  if (reducedMotion) {
    missionFiles.scrollIntoView();
    return;
  }
  transition.classList.add("is-active");
  window.setTimeout(() => transition.classList.add("is-opening"), 650);
  window.setTimeout(() => missionFiles.scrollIntoView(), 800);
  window.setTimeout(() => transition.classList.remove("is-active", "is-opening"), 1650);
});

const mobileBriefings = window.matchMedia("(max-width: 640px)");
const handledBriefings = new Set();
let briefingFramePending = false;

function setCardOpen(card, willOpen, withSound = false) {
  const trigger = card.querySelector(".file-trigger");
  const content = card.querySelector(".file-content");
  const state = card.querySelector(".file-state em");
  trigger.setAttribute("aria-expanded", String(willOpen));
  card.classList.toggle("is-open", willOpen);
  content.hidden = !willOpen;
  if (willOpen) {
    content.classList.remove("is-entering");
    requestAnimationFrame(() => content.classList.add("is-entering"));
    visitedFiles.add(card.dataset.file);
    card.classList.add("is-visited");
    state.textContent = "확인 완료";
    if (withSound) playTone(420 + visitedFiles.size * 35);
    openedCount.textContent = visitedFiles.size;
    progressBar.style.width = `${(visitedFiles.size / cards.length) * 100}%`;
  } else if (withSound) {
    playTone(280, 0.05, 0.02);
  }
}

cards.forEach((card) => {
  const trigger = card.querySelector(".file-trigger");
  trigger.addEventListener("click", () => {
    handledBriefings.add(card);
    setCardOpen(card, trigger.getAttribute("aria-expanded") !== "true", true);
    scheduleBriefings();
  });
});

function scheduleBriefings() {
  if (!mobileBriefings.matches || briefingFramePending) return;
  briefingFramePending = true;
  requestAnimationFrame(() => {
    briefingFramePending = false;
    if (!mobileBriefings.matches) return;
    for (const card of cards) {
      if (handledBriefings.has(card)) continue;
      const bounds = card.querySelector(".file-trigger").getBoundingClientRect();
      if (bounds.top >= window.innerHeight * 0.8 || bounds.bottom <= 0) continue;
      handledBriefings.add(card);
      setCardOpen(card, true);
      // Recheck layout next frame: opening one card moves the following cards.
      scheduleBriefings();
      break;
    }
  });
}

window.addEventListener("scroll", scheduleBriefings, { passive: true });
window.addEventListener("resize", scheduleBriefings, { passive: true });
mobileBriefings.addEventListener("change", scheduleBriefings);
scheduleBriefings();

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll(".reveal").forEach((element, index) => {
  element.style.transitionDelay = `${Math.min(index % 5, 3) * 70}ms`;
  revealObserver.observe(element);
});
