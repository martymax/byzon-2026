/* BYZON 2026 — interactions (vanilla JS, no dependencies) */
(function () {
  "use strict";
  var doc = document;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Header scroll state ---------------------------------------------- */
  var header = doc.querySelector(".site-header");
  if (header && !header.classList.contains("is-solid")) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 12);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Mobile drawer ---------------------------------------------------- */
  var drawer = doc.getElementById("drawer");
  var openBtn = doc.querySelector(".nav-toggle");
  var closeEls = doc.querySelectorAll("[data-drawer-close]");
  function setDrawer(open) {
    if (!drawer) return;
    drawer.classList.toggle("is-open", open);
    doc.body.style.overflow = open ? "hidden" : "";
    if (openBtn) openBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  if (openBtn) openBtn.addEventListener("click", function () { setDrawer(true); });
  closeEls.forEach(function (el) { el.addEventListener("click", function () { setDrawer(false); }); });
  doc.addEventListener("keydown", function (e) { if (e.key === "Escape") { setDrawer(false); closeLightbox(); } });

  /* ---- Tabs (program / generic) ----------------------------------------- */
  doc.querySelectorAll("[data-tabs]").forEach(function (group) {
    var tabs = group.querySelectorAll("[role=tab]");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) {
          var sel = t === tab;
          t.setAttribute("aria-selected", sel ? "true" : "false");
          var panel = doc.getElementById(t.getAttribute("aria-controls"));
          if (panel) panel.hidden = !sel;
        });
      });
    });
  });

  /* ---- Image fallback for hotlinked media ------------------------------- */
  doc.querySelectorAll("img[data-fallback]").forEach(function (img) {
    img.addEventListener("error", function () {
      var span = doc.createElement("span");
      span.className = "partner-fallback";
      span.textContent = img.getAttribute("alt") || img.getAttribute("data-fallback") || "";
      if (img.parentNode) img.parentNode.replaceChild(span, img);
    });
  });

  /* ---- Lightbox (galleries) --------------------------------------------- */
  var lb = doc.getElementById("lightbox");
  var lbImg = lb ? lb.querySelector("img") : null;
  var group = [];
  var idx = 0;
  function openLightbox(items, start) {
    if (!lb) return;
    group = items; idx = start;
    showLightbox();
    lb.classList.add("is-open");
    doc.body.style.overflow = "hidden";
  }
  function showLightbox() { if (lbImg && group[idx]) lbImg.src = group[idx]; }
  function closeLightbox() { if (lb) { lb.classList.remove("is-open"); doc.body.style.overflow = ""; } }
  function step(n) { if (!group.length) return; idx = (idx + n + group.length) % group.length; showLightbox(); }
  if (lb) {
    lb.querySelector(".lightbox__close").addEventListener("click", closeLightbox);
    lb.querySelector(".lightbox__nav.prev").addEventListener("click", function (e) { e.stopPropagation(); step(-1); });
    lb.querySelector(".lightbox__nav.next").addEventListener("click", function (e) { e.stopPropagation(); step(1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) closeLightbox(); });
    doc.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("is-open")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    });
  }
  doc.querySelectorAll("[data-gallery]").forEach(function (galEl) {
    var items = [].map.call(galEl.querySelectorAll("[data-full]"), function (el) { return el.getAttribute("data-full"); });
    galEl.querySelectorAll("[data-full]").forEach(function (el, i) {
      el.addEventListener("click", function () { openLightbox(items, i); });
    });
  });

  /* ---- Scroll reveal ---------------------------------------------------- */
  var reveals = doc.querySelectorAll(".reveal");
  if (reveals.length && !reduceMotion && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("in"); io.unobserve(entry.target); }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---- Time-limited ticket tiers: grey out + disable past the deadline -- */
  doc.querySelectorAll(".price-card[data-deadline]").forEach(function (card) {
    var end = new Date(card.getAttribute("data-deadline") + "T23:59:59");
    if (isNaN(end.getTime()) || Date.now() <= end.getTime()) return;
    card.classList.add("is-expired");
    card.classList.remove("is-featured");
    var btn = card.querySelector(".btn");
    if (btn) {
      btn.removeAttribute("href");
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("tabindex", "-1");
      btn.textContent = "Prodej ukončen";
    }
    var note = card.querySelector(".expired-note");
    if (note) note.hidden = false;
  });

  /* ---- Year (current) in footer ---------------------------------------- */
  var y = doc.getElementById("js-year");
  if (y) y.textContent = new Date().getFullYear();
})();
