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
  let timer;

  window.addEventListener("message", (event) => {
    const sameSite = event.origin === location.origin && event.source === frame.contentWindow;
    const googleHost = /^https:\/\/(?:script\.google\.com|script\.googleusercontent\.com|[a-z0-9-]+-script\.googleusercontent\.com)$/.test(event.origin);
    if (!event.source || event.data?.channel !== channel ||
        !(validDeployment ? googleHost : sameSite)) return;
    if (event.data.type === "escape-registration:ready") {
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
  });
  frame.src = source.href;
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      observer.disconnect();
      if (!ready) timer = setTimeout(() => {
        if (!ready) note.textContent = "신청서를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.";
      }, 20000);
    }
  });
  observer.observe(frame);

  document.querySelectorAll(".registration-open").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const trigger = document.querySelector('[aria-controls="file-application"]');
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
      const destination = document.querySelector("#registration");
      destination.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      destination.focus({ preventScroll: true });
    });
  });
})();
