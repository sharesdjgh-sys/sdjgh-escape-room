(() => {
  "use strict";
  const frame = document.querySelector("#registration-frame");
  const note = document.querySelector("#registration-connection");
  const webAppUrl = window.ESCAPE_REGISTRATION?.webAppUrl?.trim() || "";
  const channel = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const validDeployment = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(webAppUrl);
  const source = new URL(validDeployment ? webAppUrl : "./registration/index.html", location.href);
  source.searchParams.set("channel", channel);
  let ready = false;
  let started = false;
  let timer;
  let formWindow;
  let formOrigin;
  let completed = false;
  const successDialog = document.querySelector("#registration-success");

  function revealReceipt() {
    const trigger = document.querySelector('[aria-controls="file-application"]');
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    const destination = document.querySelector("#registration");
    destination.scrollIntoView({ behavior: "instant", block: "start" });
    destination.focus({ preventScroll: true });
  }

  successDialog.addEventListener("close", () => {
    document.documentElement.classList.remove("registration-confirming");
    revealReceipt();
    formWindow?.postMessage({ type: "escape-registration:focus-receipt", channel }, formOrigin === "null" ? "*" : formOrigin);
  });

  window.addEventListener("message", (event) => {
    const sameSite = event.origin === location.origin && event.source === frame.contentWindow;
    const googleHost = /^https:\/\/(?:script\.google\.com|script\.googleusercontent\.com|[a-z0-9-]+-script\.googleusercontent\.com)$/.test(event.origin);
    if (!event.source || event.data?.channel !== channel ||
        !(validDeployment ? googleHost : sameSite) || (formWindow && event.source !== formWindow)) return;
    if (event.data.type === "escape-registration:ready") {
      if (completed) return;
      formWindow = event.source;
      formOrigin = event.origin;
      ready = true;
      clearTimeout(timer);
      note.textContent = validDeployment
        ? "작성한 신청서는 저장 확인 후 접수번호를 안내합니다."
        : "온라인 신청서 준비 중입니다. 아래에서 입력 항목을 미리 확인할 수 있습니다.";
      event.source.postMessage({ type: "escape-registration:parent", channel }, event.origin === "null" ? "*" : event.origin);
    }
    if (event.data.type === "escape-registration:resize" && Number.isFinite(event.data.height)) {
      frame.style.height = Math.max(340, Math.min(3500, event.data.height)) + "px";
    }
    if (event.data.type === "escape-registration:complete" && ready && !completed) {
      completed = true;
      note.textContent = "신청이 정상적으로 접수되었습니다. 아래 접수번호를 보관해 주세요.";
      revealReceipt();
      successDialog.showModal();
      document.documentElement.classList.add("registration-confirming");
    }
  });
  function startLoading() {
    if (started) return;
    started = true;
    observer.disconnect();
    // Assign src only when needed, then load even while the accordion is hidden.
    frame.src = source.href;
    timer = setTimeout(() => {
      if (!ready) note.textContent = "신청서 연결이 지연되고 있습니다. 잠시만 기다려 주세요. 계속 열리지 않으면 페이지를 새로고침해 주세요.";
    }, 20000);
  }

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) startLoading();
  }, { rootMargin: "160px 0px" });
  // This heading stays observable even when the form itself is hidden.
  observer.observe(document.querySelector(".application-card .file-trigger"));

  document.querySelector("#mission-files").addEventListener("briefing:open", startLoading);
  document.querySelectorAll('#start-mission, a[href="#mission-files"], #application-shortcut').forEach((link) => {
    link.addEventListener("click", startLoading);
  });

  function preloadWhenIdle() {
    const connection = navigator.connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return;
    // Keep the initial images ahead of the external Google application.
    if ("requestIdleCallback" in window) requestIdleCallback(startLoading, { timeout: 1500 });
    else setTimeout(startLoading, 500);
  }
  if (document.readyState === "complete") preloadWhenIdle();
  else window.addEventListener("load", preloadWhenIdle, { once: true });

  document.querySelectorAll(".registration-open").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      startLoading();
      const trigger = document.querySelector('[aria-controls="file-application"]');
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
      const destination = document.querySelector("#registration");
      destination.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      destination.focus({ preventScroll: true });
    });
  });
})();
