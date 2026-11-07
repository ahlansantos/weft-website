(function () {
  "use strict";

  const REPO = "Weft-Rust/Weft";
  const root = document.documentElement;
  const text = JSON.parse(document.getElementById("i18n").textContent);
  const say = (key, args) => (text[key] || key).replace(/\{(\w+)\}/g, (_, k) => args[k]);
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const field = window.WeftField;

  // Who the page is for
  const radios = [...document.querySelectorAll('input[name="audience"]')];
  const sections = () => [...document.querySelectorAll("main > section")].filter(s => s.offsetParent !== null || s.getClientRects().length);

  function setAudience(who, fromUser) {
    const here = fromUser && list.find(s => s.getBoundingClientRect().bottom > innerHeight / 2);
    const shared = here && !here.dataset.for;
    const seenAt = shared ? here.getBoundingClientRect().top : 0;
    root.dataset.audience = who;
    radios.forEach(r => { r.checked = r.value === who; });
    if (!fromUser) return;
    try { localStorage.setItem("weft.audience", who); } catch (e) {}
    const url = new URL(location.href);
    url.searchParams.set("for", who === "modder" ? "modders" : "players");
    measure();
    // A section both pages have stays where it is on screen. Any other is gone, so back to the top.
    if (shared) {
      scrollTo({ top: scrollY + here.getBoundingClientRect().top - seenAt, behavior: "instant" });
    } else {
      scrollTo({ top: 0, behavior: "instant" });
      url.hash = "";
    }
    history.replaceState(null, "", url);
    if (!still.matches) {
      const box = document.querySelector(".toggle").getBoundingClientRect();
      field.wave(box.left + box.width / 2, box.bottom, clock());
    }
    wake();
  }
  radios.forEach(r => r.addEventListener("change", () => { if (r.checked) setAudience(r.value, true); }));

  // The field, driven by what's on screen
  let clear = [], list = [], shown = null;
  setAudience(root.dataset.audience, false);
  function measure() {
    clear = [...document.querySelectorAll(".clear")].filter(e => e.getClientRects().length);
    list = sections();
    hintPanels();
  }

  const arrow = document.querySelector(".scroll-arrow");
  arrow?.addEventListener("click", e => {
    e.preventDefault();
    const hero = document.querySelector(".hero");
    const next = list.find(s => s !== hero && s.getBoundingClientRect().top > 50) || document.querySelector(".sec");
    next?.scrollIntoView({ behavior: "smooth" });
  });

  // A panel that scrolls looks like cut off text on a phone unless something says so.
  function hintPanels() {
    for (const panel of document.querySelectorAll(".panel")) {
      let hint = panel.nextElementSibling;
      if (!hint || !hint.classList.contains("scroll-hint")) {
        hint = document.createElement("p");
        hint.className = "scroll-hint";
        hint.textContent = say("js.scroll");
        panel.after(hint);
      }
      hint.hidden = panel.scrollWidth <= panel.clientWidth;
    }
  }

  const sceneOf = s => (root.dataset.audience === "modder" && s.dataset.modderScene) || s.dataset.scene;

  function anchorOf(s) {
    const box = s.getBoundingClientRect();
    const copy = s.querySelector(".copy");
    return { y: scrollY + box.top + box.height / 2 - innerHeight / 2, right: copy ? copy.getBoundingClientRect().right : 0 };
  }

  function pickScene() {
    const middle = innerHeight / 2;
    let i = list.findIndex(s => s.getBoundingClientRect().bottom > middle);
    if (i < 0) i = list.length - 1;
    const box = list[i].getBoundingClientRect();
    const p = (middle - box.top) / box.height;
    const next = list[i + 1];
    const mix = next ? Math.max(0, Math.min(1, (p - .68) / .32)) : 0;
    field.scene(sceneOf(list[i]), next ? sceneOf(next) : null, mix, anchorOf(list[i]), next ? anchorOf(next) : null);
    const showing = sceneOf(mix > .5 ? next : list[i]);
    if (showing !== shown) {
      shown = showing;
      if (showing === "ripple" && !still.matches) field.wave(innerWidth * .6, innerHeight * .5, clock());
    }
  }

  function pickRects() {
    const out = [];
    for (const e of clear) {
      const b = e.getBoundingClientRect();
      if (b.bottom > -200 && b.top < innerHeight + 200) out.push(b);
    }
    field.setRects(out);
  }

  const start = performance.now();
  const clock = () => (performance.now() - start) / 1000;
  const frozenAt = 40;
  let last = 0, gap = 0, queued = false, lastY = -1;

  // Runs only while something is moving: every event that can change the picture calls wake.
  function frame(now) {
    queued = false;
    if (document.hidden) return;
    const moving = !still.matches;
    if (moving && now - last < gap) { wake(); return; }
    last = now;
    pickScene();
    pickRects();
    const begun = performance.now();
    const state = field.render(moving ? clock() : frozenAt);
    const spent = performance.now() - begun;
    const scrolled = scrollY !== lastY;
    lastY = scrollY;
    // Slow machines get fewer frames rather than a stuck page: at most about a third of the time.
    gap = Math.max(state.busy || scrolled ? 14 : 33, spent * 3);
    if (moving && (state.busy || state.living)) wake();
  }
  function wake() {
    if (!queued) { queued = true; requestAnimationFrame(frame); }
  }

  field.resize();
  measure();
  addEventListener("resize", () => {
    field.resize();
    measure();
    wake();
  });
  addEventListener("scroll", wake, { passive: true });
  document.addEventListener("visibilitychange", wake);
  addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse") return;
    field.pointer(e.clientX, e.clientY);
    wake();
  }, { passive: true });
  root.addEventListener("pointerleave", () => { field.pointerGone(); wake(); });
  document.fonts && document.fonts.ready.then(() => { measure(); wake(); });
  wake();

  // Downloads: the release asset for this system, looked up live, /releases/latest if that fails
  function detectOS() {
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod/i.test(ua)) return "mobile";
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ua;
    if (/Win/i.test(platform)) return "windows";
    if (/Mac/i.test(platform)) return "macos";
    if (/Linux|X11/i.test(platform)) return "linux";
    return null;
  }
  const mine = detectOS();
  const label = document.querySelector("[data-download-label]");
  const meta = document.querySelector("[data-download-meta]");
  const heroButton = document.querySelector("[data-download]");

  if (mine === "mobile") {
    heroButton.hidden = true;
    document.querySelector("[data-mobile-note]").hidden = false;
  } else if (mine) {
    label.textContent = say("js.download_for", { os: say("js.os." + mine) });
    const row = document.querySelector(`.system[data-os="${mine}"]`);
    if (row) row.classList.add("mine");
  }

  const sizeMB = bytes => Math.max(1, Math.round(bytes / 1048576));

  let latest = null;
  function applyRelease(release) {
    latest = release;
    const version = release.tag_name.replace(/^v/, "");
    document.querySelector("[data-version]").textContent = say("js.latest", { version });
    for (const link of document.querySelectorAll("[data-asset]")) {
      const asset = release.assets.find(a => a.name.includes(link.dataset.asset));
      if (!asset) continue;
      link.href = asset.browser_download_url;
      link.querySelector("small").textContent = say("js.size", { size: sizeMB(asset.size) });
      if (link.closest(".system").dataset.os === mine) {
        heroButton.href = asset.browser_download_url;
        meta.textContent = say("js.version", { version, size: sizeMB(asset.size) });
      }
    }
    wake();
  }

  // A system's package switch: its steps, and what its button downloads.
  for (const input of document.querySelectorAll(".variants input")) {
    input.addEventListener("change", () => {
      const row = input.closest(".system");
      for (const v of row.querySelectorAll("[data-variant]")) v.hidden = v.dataset.variant !== input.value;
      const link = row.querySelector("[data-asset]");
      link.dataset.asset = input.value;
      link.href = "https://github.com/Weft-Rust/Weft/releases/latest";
      link.querySelector("small").textContent = "";
      if (latest) applyRelease(latest);
    });
  }

  (async function () {
    const KEY = "weft.release", HOUR = 3600000;
    try {
      // Anonymous GitHub API calls are limited per address, so one per visitor per hour.
      const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (saved && Date.now() - saved.at < HOUR) return applyRelease(saved.release);
    } catch (e) {}
    try {
      const reply = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
      if (!reply.ok) return;
      const d = await reply.json();
      const release = { tag_name: d.tag_name, assets: d.assets.map(a => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url })) };
      applyRelease(release);
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), release })); } catch (e) {}
    } catch (e) {}
  })();
})();
