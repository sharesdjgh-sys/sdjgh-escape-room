const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const startButton = document.querySelector("#start-mission");
const transition = document.querySelector(".door-transition");
const missionFiles = document.querySelector("#mission-files");
const cards = [...document.querySelectorAll(".file-card")];
const openedCount = document.querySelector("#opened-count");
const progressBar = document.querySelector("#progress-bar");

const visitedFiles = new Set();

document.querySelector("#application-shortcut").addEventListener("click", (event) => {
  event.preventDefault();
  const applicationTrigger = document.querySelector('[aria-controls="file-application"]');
  if (applicationTrigger.getAttribute("aria-expanded") !== "true") applicationTrigger.click();
  applicationTrigger.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
  applicationTrigger.focus({ preventScroll: true });
});

startButton.addEventListener("click", () => {
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
let pendingBriefing = null;
let briefingDelay;
let automaticBriefingOpening = false;
const briefingAnimations = new WeakMap();

function setCardOpen(card, willOpen) {
  const trigger = card.querySelector(".file-trigger");
  const content = card.querySelector(".file-content");
  const state = card.querySelector(".file-state em");
  briefingAnimations.get(card)?.cancel();
  trigger.setAttribute("aria-expanded", String(willOpen));
  card.classList.toggle("is-open", willOpen);
  content.hidden = !willOpen;
  let opening;
  if (willOpen) {
    // Set the final height once; only opacity changes during the reveal.
    // Animating height forced layout on every frame and shifted the following cards.
    if (!reducedMotion) {
      opening = content.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 500, easing: "ease-out"
      });
      briefingAnimations.set(card, opening);
    }
    card.dispatchEvent(new CustomEvent("briefing:open", { bubbles: true }));
    visitedFiles.add(card.dataset.file);
    card.classList.add("is-visited");
    state.textContent = "확인 완료";
    openedCount.textContent = visitedFiles.size;
    progressBar.style.width = `${(visitedFiles.size / cards.length) * 100}%`;
  }
  return opening ? opening.finished.catch(() => {}).finally(() => {
    if (briefingAnimations.get(card) === opening) briefingAnimations.delete(card);
  }) : Promise.resolve();
}

cards.forEach((card) => {
  const trigger = card.querySelector(".file-trigger");
  trigger.addEventListener("click", () => {
    handledBriefings.add(card);
    setCardOpen(card, trigger.getAttribute("aria-expanded") !== "true");
    scheduleBriefings();
  });
});

function cancelPendingBriefing() {
  clearTimeout(briefingDelay);
  pendingBriefing = null;
}

function briefingInReadingZone(card) {
  const bounds = card.querySelector(".file-trigger").getBoundingClientRect();
  // Wait until the whole heading is visible and its center reaches the reading area.
  return bounds.top >= 0 && bounds.bottom <= window.innerHeight &&
    bounds.top + bounds.height / 2 <= window.innerHeight * 0.58;
}

function scheduleBriefings() {
  if (!mobileBriefings.matches) {
    cancelPendingBriefing();
    return;
  }
  if (briefingFramePending) return;
  briefingFramePending = true;
  requestAnimationFrame(() => {
    briefingFramePending = false;
    if (!mobileBriefings.matches || automaticBriefingOpening) return;
    const card = cards.find((candidate) => !handledBriefings.has(candidate) && briefingInReadingZone(candidate));
    if (card === pendingBriefing) return;
    cancelPendingBriefing();
    if (!card) return;
    pendingBriefing = card;
    briefingDelay = window.setTimeout(() => {
      pendingBriefing = null;
      if (!mobileBriefings.matches || handledBriefings.has(card) || !briefingInReadingZone(card)) return;
      handledBriefings.add(card);
      automaticBriefingOpening = true;
      setCardOpen(card, true).finally(() => {
        automaticBriefingOpening = false;
        // Let each card finish opening before considering the next one.
        scheduleBriefings();
      });
    }, 160);
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
