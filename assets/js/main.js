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

  /* ---- Mobile program stage filters ------------------------------------ */
  doc.querySelectorAll("[data-mobile-agenda]").forEach(function (agenda) {
    var buttons = agenda.querySelectorAll("[data-stage-filter]");
    if (!buttons.length) return;
    var events = agenda.querySelectorAll(".program-mobile-event");
    var groups = agenda.querySelectorAll("[data-mobile-time-group]");
    function applyFilter(value) {
      events.forEach(function (event) {
        var ids = (event.getAttribute("data-stage-ids") || "").split(/\s+/);
        var visible = value === "all" || ids.indexOf(value) !== -1;
        event.classList.toggle("is-hidden", !visible);
      });
      groups.forEach(function (group) {
        var visibleEvents = group.querySelectorAll(".program-mobile-event:not(.is-hidden)");
        group.classList.toggle("is-hidden", visibleEvents.length === 0);
      });
    }
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        var value = button.getAttribute("data-stage-filter") || "all";
        buttons.forEach(function (btn) {
          var selected = btn === button;
          btn.classList.toggle("is-active", selected);
          btn.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        applyFilter(value);
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

  /* ---- Ticket tiers by date window: exactly one active (clickable) ------ */
  var now = Date.now();
  doc.querySelectorAll(".price-card[data-active-from], .price-card[data-active-to]").forEach(function (card) {
    var from = card.getAttribute("data-active-from");
    var to = card.getAttribute("data-active-to");
    var f = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
    var t = to ? new Date(to + "T23:59:59").getTime() : Infinity;
    if (now >= f && now <= t) {
      card.classList.add("is-active");
      return;
    }
    card.classList.add("is-inactive");
    var btn = card.querySelector(".btn");
    if (btn) {
      btn.removeAttribute("href");
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("tabindex", "-1");
      btn.textContent = (now < f) ? "Již brzy" : "Prodej ukončen";
    }
  });

  /* ---- Year (current) in footer ---------------------------------------- */
  var y = doc.getElementById("js-year");
  if (y) y.textContent = new Date().getFullYear();
})();
