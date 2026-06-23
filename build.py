#!/usr/bin/env python3
"""
BYZON 2026 — static site generator.

Reads the content model from data/content.json and renders the redesigned
static site (pure HTML/CSS/JS, no runtime dependencies) into the repo root.

Usage:  python3 build.py
Then preview with:  python3 -m http.server  (open http://localhost:8000/)
"""
import hashlib
import html
import json
import os
import re
from urllib.parse import quote

ROOT = os.path.dirname(os.path.abspath(__file__))


def _asset_ver():
    """Hash CSS+JS so the ?v= query busts caches automatically on every change."""
    h = hashlib.md5()
    for f in ("assets/css/styles.css", "assets/js/main.js"):
        try:
            h.update(open(os.path.join(ROOT, f), "rb").read())
        except OSError:
            pass
    return h.hexdigest()[:8]


ASSET_VER = _asset_ver()

with open(os.path.join(ROOT, "data", "content.json"), encoding="utf-8") as f:
    C = json.load(f)


def esc(s):           # escape text content
    return html.escape(str(s), quote=False)


def att(s):           # escape attribute value
    return html.escape(str(s), quote=True)


# ---------------------------------------------------------------- icons -----
ICONS = {
    "arrow": '<svg class="arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    "calendar": '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    "pin": '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    "info": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    "clock": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    "mic": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    "users": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    "coffee": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    "sparkles": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/></svg>',
    "tool": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-2.1 2.6-2.4z"/></svg>',
    "award": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>',
    "facebook": '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z"/></svg>',
    "instagram": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
    "mail": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>',
}


def stage_icon(name):
    n = name.lower()
    if "byzon stage" in n: return ICONS["mic"]
    if "leadership stage" in n: return ICONS["users"]
    if "koučovací" in n or "koucovaci" in n: return ICONS["coffee"]
    if "networking" in n or "afterparty" in n: return ICONS["sparkles"]
    if "workshop" in n: return ICONS["tool"]
    if "galakoktejl" in n or "solnice" in n: return ICONS["award"]
    return ICONS["mic"]


# ----------------------------------------------------------- components ------
def head(title, description, page_path, og_image=None):
    s = C["site"]
    base = s["url"].rstrip("/")
    url = base + page_path
    ogi = og_image or s["og_image"]
    if not ogi.startswith("http"):
        ogi = base + ogi  # social images must be absolute
    return f"""<!doctype html>
<html lang="{s['lang']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>document.documentElement.classList.add('js');</script>
<title>{esc(title)}</title>
<meta name="description" content="{att(description)}">
<link rel="canonical" href="{att(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{att(title)}">
<meta property="og:description" content="{att(description)}">
<meta property="og:image" content="{att(ogi)}">
<meta property="og:url" content="{att(url)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="{att(s['favicon'])}" sizes="32x32">
<link rel="apple-touch-icon" href="{att(s['logo'])}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Khand:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/styles.css?v={ASSET_VER}">
</head>
<body>
<a class="skip-link" href="#main">Přeskočit na obsah</a>
"""


def header(active, solid=False):
    s = C["site"]
    cls = "site-header" + (" is-solid" if solid else "")
    nav_links = ""
    for item in C["nav"]:
        cur = ' aria-current="page"' if item["href"] == active else ""
        nav_links += f'<a href="{att(item["href"])}"{cur}>{esc(item["label"])}</a>'
    cta = C["cta"]
    return f"""<header class="{cls}">
  <div class="container">
    <a class="brand" href="/" aria-label="BYZON – domů">
      <img class="logo-on-dark" src="{att(s['logo_wordmark_light'])}" alt="Byzon" width="190" height="30" data-fallback="BYZON">
      <img class="logo-on-light" src="{att(s['logo_wordmark'])}" alt="Byzon" width="190" height="30" data-fallback="BYZON">
    </a>
    <nav class="nav" aria-label="Hlavní navigace">{nav_links}</nav>
    <div class="header-cta">
      <a class="btn btn--sm" href="{att(cta['href'])}">{esc(cta['label'])} {ICONS['arrow']}</a>
      <button class="nav-toggle" aria-label="Otevřít menu" aria-expanded="false" aria-controls="drawer"><span></span></button>
    </div>
  </div>
</header>
{drawer(active)}"""


def drawer(active):
    s = C["site"]
    links = ""
    for item in C["nav"]:
        cur = ' aria-current="page"' if item["href"] == active else ""
        links += f'<a class="nav-link" href="{att(item["href"])}"{cur} data-drawer-close>{esc(item["label"])}</a>'
    cta = C["cta"]
    return f"""<div class="drawer" id="drawer">
  <div class="drawer__scrim" data-drawer-close></div>
  <div class="drawer__panel" role="dialog" aria-modal="true" aria-label="Menu">
    <div class="drawer__head">
      <img src="{att(s['logo_wordmark_light'])}" alt="Byzon" data-fallback="BYZON">
      <button class="drawer__close" aria-label="Zavřít menu" data-drawer-close>&times;</button>
    </div>
    {links}
    <a class="btn btn--block" href="{att(cta['href'])}" data-drawer-close>{esc(cta['label'])} {ICONS['arrow']}</a>
  </div>
</div>"""


def footer():
    s = C["site"]; f = C["footer"]; org = C["partners"]["organizer"]
    legal = "".join(
        f'<li><a href="{att(l["href"])}" target="_blank" rel="noopener">{esc(l["label"])}</a></li>'
        for l in f["legal"]
    )
    # Auto-updating year: wrap the year in #js-year (main.js sets the current year;
    # the static value is the no-JS fallback).
    copyright_html = re.sub(r"\b(?:19|20)\d{2}\b",
                            '<span id="js-year">\\g<0></span>',
                            esc(f["copyright"]), count=1)
    return f"""<footer class="site-footer">
  <div class="container">
    <div class="footer-top">
      <div class="footer-brand">
        <img class="footer-logo" src="{att(s['logo_wordmark_light'])}" alt="Byzon" data-fallback="BYZON">
        <p>Byznysová konference, která staví na lidskosti. 18.–19. září 2026, Clarion Congress Hotel, České Budějovice.</p>
        <div class="socials">
          <a href="{att(s['social']['facebook'])}" target="_blank" rel="noopener" aria-label="Facebook">{ICONS['facebook']}</a>
          <a href="{att(s['social']['instagram'])}" target="_blank" rel="noopener" aria-label="Instagram">{ICONS['instagram']}</a>
          <a href="mailto:{att(s['email'])}" aria-label="E-mail">{ICONS['mail']}</a>
        </div>
      </div>
      <div class="footer-col">
        <h5>Konference</h5>
        <ul>
          <li><a href="/program/">Program</a></li>
          <li><a href="/byznys-konference/">Minulé ročníky</a></li>
          <li><a href="/stante-se-partnerem/">Staňte se partnerem</a></li>
          <li><a href="/simpleshop/">Ulovte si vstupenku</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h5>{esc(org['label'])}</h5>
        <ul>
          <li><strong style="color:#fff">{esc(org['name'])}</strong></li>
          <li>{esc(org['ic'])}</li>
          <li><a href="mailto:{att(s['email'])}">{esc(org['email'])}</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <p>{copyright_html}</p>
      <ul style="display:flex;gap:18px;flex-wrap:wrap">{legal}</ul>
    </div>
  </div>
</footer>
{lightbox()}
<script src="/assets/js/main.js?v={ASSET_VER}" defer></script>
</body>
</html>"""


def lightbox():
    return """<div class="lightbox" id="lightbox" aria-hidden="true">
  <button class="lightbox__close" aria-label="Zavřít">&times;</button>
  <button class="lightbox__nav prev" aria-label="Předchozí">&#8249;</button>
  <img src="" alt="Fotografie z konference BYZON">
  <button class="lightbox__nav next" aria-label="Další">&#8250;</button>
</div>"""


def page_hero(title, subtitle=None, crumb_label=None):
    crumb = ""
    if crumb_label:
        crumb = f'<nav class="breadcrumb" aria-label="Drobečková navigace"><a href="/">Hlavní strana</a> <span>›</span> {esc(crumb_label)}</nav>'
    sub = f"<p>{esc(subtitle)}</p>" if subtitle else ""
    return f"""<section class="page-hero">
  <div class="container">
    {crumb}
    <h1>{esc(title)}</h1>
    {sub}
  </div>
</section>"""


# ------------------------------------------------------------- sections -----
def sec_co_vas_ceka():
    d = C["co_vas_ceka"]
    cards = ""
    for c in d["cards"]:
        points = "".join(f"<li>{esc(p)}</li>" for p in c["points"])
        cards += f"""<article class="feature-card reveal">
        <span class="chip">{esc(c['label'])}</span>
        <h3>{esc(c['title'])}</h3>
        <ul>{points}</ul>
      </article>"""
    return f"""<section class="section" id="co-vas-ceka">
  <div class="container">
    <div class="section-head section-head--center reveal">
      <span class="eyebrow">Program ve zkratce</span>
      <h2>{esc(d['title'])}</h2>
    </div>
    <div class="feature-grid">{cards}</div>
  </div>
</section>"""


def sec_vstupenky():
    d = C["vstupenky"]; cta = C["cta"]
    deadlines = "".join(f"<li>{ICONS['clock']} {esc(x)}</li>" for x in d["deadlines"])
    tiers = ""
    for t in d["tiers"]:
        win = ""
        if t.get("active_from"):
            win += f' data-active-from="{att(t["active_from"])}"'
        if t.get("active_to"):
            win += f' data-active-to="{att(t["active_to"])}"'
        tiers += f"""<article class="price-card reveal"{win}>
        <h3>{esc(t['name'])}</h3>
        <div class="price">{esc(t['price'])}</div>
        <p class="until">Platí {esc(t['note'])}</p>
        <a class="btn btn--block" href="{att(cta['href'])}">{esc(cta['label'])} {ICONS['arrow']}</a>
      </article>"""
    return f"""<section class="section section--soft" id="vstupenky">
  <div class="container">
    <div class="section-head section-head--center reveal">
      <span class="eyebrow">Vstupenky</span>
      <h2>{esc(d['title'])}</h2>
    </div>
    <ul class="pricing-deadlines reveal" style="justify-content:center">{deadlines}</ul>
    <div class="pricing-grid">{tiers}</div>
  </div>
</section>"""


def speaker_card(sp):
    return f"""<a class="speaker-card reveal" href="/speaker/{att(sp['slug'])}/" aria-label="Profil řečníka: {att(sp['name'])}">
      <img src="{att(sp['photo'])}" alt="{att(sp['name'])}" loading="lazy" data-fallback="{att(sp['name'])}">
    </a>"""


def sec_speakers():
    d = C["speakers"]
    cards = "".join(speaker_card(sp) for sp in d["list"])
    return f"""<section class="section section--pink" id="speakers">
  <div class="container">
    <div class="section-head section-head--center reveal">
      <span class="eyebrow">Řečníci 2026</span>
      <h2>{esc(d['title'])}</h2>
    </div>
    <div class="speakers-grid">{cards}</div>
    <p class="speakers-note reveal">{esc(d['note'].replace('Stay tuned!', ''))}<span>Stay tuned!</span></p>
  </div>
</section>"""


def sec_location():
    d = C["location"]
    mapq = quote(d["map_query"])
    feats = [("calendar", "18.–19. září 2026"), ("pin", "Centrum Českých Budějovic"),
             ("users", "Zastávka Družba – IGY")]
    feat_html = "".join(f'<li>{ICONS[i]} {esc(t)}</li>' for i, t in feats)
    return f"""<section class="section" id="lokace">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow">Místo konání</span>
      <h2>{esc(d['title'])}</h2>
    </div>
    <div class="location-grid">
      <div class="location-media reveal"><img src="{att(d['image'])}" alt="{att(d['name'])}" loading="lazy" data-fallback="Clarion Congress Hotel"></div>
      <div class="location-info reveal">
        <h3>{esc(d['name'])}</h3>
        <ul class="location-feats">{feat_html}</ul>
        <p>{esc(d['text'])}</p>
        <a class="textlink" href="https://www.google.com/maps/search/?api=1&query={mapq}" target="_blank" rel="noopener">Zobrazit na mapě {ICONS['arrow']}</a>
        <div class="location-map">
          <iframe title="Mapa – {att(d['name'])}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
            src="https://www.google.com/maps?q={mapq}&output=embed"></iframe>
        </div>
      </div>
    </div>
  </div>
</section>"""


def year_block(y):
    btn = y["button"]
    btn_html = f'<a class="btn btn--ghost btn--sm" href="{att(btn["href"])}" target="_blank" rel="noopener">{esc(btn["label"])} {ICONS["arrow"]}</a>'
    if y["kind"] == "gallery":
        items = ""
        for img in y["images"]:
            items += f'<div class="g-item" data-full="{att(img)}"><img src="{att(img)}" alt="BYZON {esc(y["year"])}" loading="lazy"></div>'
        body = f'<div class="gallery" data-gallery>{items}</div>{btn_html}'
    else:
        body = f"""<div class="video-embed">
        <iframe loading="lazy" title="{att(y.get('video_title',''))}" src="https://www.youtube.com/embed/{att(y['video'])}"
          frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
      </div>{btn_html}"""
    return f"""<div class="year-block reveal">
      <div class="year-tag">{esc(y['year'])}</div>
      <div class="year-body">{body}</div>
    </div>"""


def sec_rocniky(soft=True):
    d = C["rocniky"]
    blocks = "".join(year_block(y) for y in d["years"])
    cls = "section section--soft" if soft else "section"
    return f"""<section class="{cls}" id="rocniky">
  <div class="container">
    <div class="section-head section-head--center reveal">
      <span class="eyebrow">Atmosféra</span>
      <h2>{esc(d['title'])}</h2>
      <p>{esc(d['intro'])}</p>
    </div>
    {blocks}
  </div>
</section>"""


def sec_partners():
    d = C["partners"]; org = d["organizer"]; s = C["site"]
    logos = ""
    for lg in d["logos"]:
        dark = " on-dark" if lg.get("on_dark") else ""
        logos += f'<div class="partner-logo{dark}"><img src="{att(lg["src"])}" alt="{att(lg["name"])}" loading="lazy" data-fallback="{att(lg["name"])}"></div>'
    return f"""<section class="section" id="partneri">
  <div class="container">
    <div class="section-head section-head--center reveal">
      <span class="eyebrow">Spolupracujeme</span>
      <h2>{esc(d['title'])}</h2>
    </div>
    <div class="partners-grid reveal">{logos}</div>
    <div class="organizer reveal">
      <span class="lbl">{esc(org['label'])}</span>
      <span class="org-name">{esc(org['name'])}</span>
      <span>{esc(org['ic'])}</span>
      <a href="mailto:{att(s['email'])}">{esc(org['email'])}</a>
    </div>
  </div>
</section>"""


# --------------------------------------------------------------- pages ------
def page_home():
    s = C["site"]; h = C["hero"]; cta = C["cta"]
    badges = "".join(f'<span class="badge">{esc(b)}</span>' for b in h["badges"])
    imgs = h["images"]
    title_html = esc(h["title"])
    if h.get("title_accent"):
        title_html = title_html.replace(esc(h["title_accent"]),
                                        f'<span class="accent">{esc(h["title_accent"])}</span>', 1)
    hero = f"""<section class="hero">
  <img class="hero__skull" src="{att(s['skull'])}" alt="" aria-hidden="true" loading="eager">
  <div class="container">
    <div class="hero__text">
      <span class="eyebrow hero__eyebrow">{esc(h['eyebrow'])}</span>
      <h1>{title_html}</h1>
      <div class="hero__meta">
        <span>{ICONS['calendar']} {esc(h['date'])}</span>
        <span>{ICONS['pin']} {esc(h['venue'])}</span>
      </div>
      <p class="hero__lead">{esc(h['lead'])}</p>
      <div class="hero__badges">{badges}</div>
      <div class="hero__actions">
        <a class="btn" href="{att(cta['href'])}">{esc(cta['label'])} {ICONS['arrow']}</a>
        <a class="textlink" href="#program-prehled" style="color:#fff">Co vás čeká {ICONS['arrow']}</a>
      </div>
    </div>
    <div class="hero__media">
      <div class="collage">
        <figure class="c1"><img src="{att(imgs[0])}" alt="" loading="eager"></figure>
        <figure class="c2"><img src="{att(imgs[1])}" alt="" loading="eager"></figure>
        <figure class="c3"><img src="{att(imgs[2])}" alt="" loading="eager"></figure>
        <div class="float-badge"><b>18.–19.</b><span>září 2026</span></div>
      </div>
    </div>
  </div>
</section>
<span id="program-prehled"></span>"""
    body = (
        header("/", solid=False)
        + '<main id="main">'
        + hero
        + sec_co_vas_ceka()
        + sec_vstupenky()
        + sec_speakers()
        + sec_location()
        + sec_rocniky(soft=True)
        + sec_partners()
        + "</main>"
    )
    return head(s["title"], s["description"], "/", s["og_image"]) + body + footer()


def page_program():
    d = C["program"]
    tabs = ""; panels = ""
    for i, day in enumerate(d["days"]):
        sel = "true" if i == 0 else "false"
        tabs += f'<button class="tab" role="tab" id="tab-{i}" aria-controls="panel-{i}" aria-selected="{sel}">{esc(day["name"])}</button>'
        cards = ""
        for stg in day["stages"]:
            cards += f"""<div class="stage-card">
          <div class="stage-ico">{stage_icon(stg)}</div>
          <h3>{esc(stg)}</h3>
          <p class="soon">Detailní program připravujeme.</p>
        </div>"""
        panels += f'<div class="tabpanel" role="tabpanel" id="panel-{i}" aria-labelledby="tab-{i}"{"" if i==0 else " hidden"}><div class="stage-grid">{cards}</div></div>'
    body = (
        header("/program/", solid=False)
        + '<main id="main">'
        + page_hero(d["title"], crumb_label="Program")
        + f"""<section class="section">
  <div class="container">
    <div class="program-notice reveal">{ICONS['info']}<span>{esc(d['notice'])}</span></div>
    <div data-tabs>
      <div class="tabs" role="tablist" aria-label="Dny konference">{tabs}</div>
      {panels}
    </div>
  </div>
</section>"""
        + "</main>"
    )
    return head("Program – Byzon", "Program konference BYZON 2026 – " + d["notice"], "/program/") + body + footer()


def page_rocniky():
    d = C["rocniky"]
    body = (
        header("/byznys-konference/", solid=False)
        + '<main id="main">'
        + page_hero("Minulé ročníky", d["intro"], crumb_label="Minulé ročníky")
        + sec_rocniky(soft=False)
        + "</main>"
    )
    return head("Minulé ročníky – Byzon", "Jak probíhaly minulé ročníky konference BYZON – fotky a videa z let 2023, 2024 a 2025.", "/byznys-konference/") + body + footer()


def page_simpleshop():
    d = C["simpleshop"]
    embed = f"""<div data-simpleshopform="{att(d['form_id'])}" id="simpleshop-form">
        <div>{d['fallback']}</div>
      </div>
      <script>
      (function(i, s, o, g, r, a, m){{
          i[r] = i[r] || function(){{
              (i[r].q = i[r].q || []).push(arguments)
          }}, i[r].l = 1 * new Date();
          a = s.createElement(o),
          m = s.getElementsByTagName(o)[0];
          a.async = 1;
          a.src = g;
          m.parentNode.insertBefore(a, m)
      }})(window, document, "script", "https://form.simpleshop.cz/prj/js/SimpleShopService.js", "sss");
      sss("createForm", "{d['form_id']}");
      </script>"""
    body = (
        header("/simpleshop/", solid=False)
        + '<main id="main">'
        + page_hero(d["title"], d["subtitle"], crumb_label="Vstupenky")
        + f"""<section class="section">
  <div class="container">
    <div class="shop-wrap">
      <div class="shop-card reveal">
        {embed}
      </div>
    </div>
  </div>
</section>"""
        + "</main>"
    )
    return head("Ulovte si vstupenku – Byzon", "Objednejte si vstupenku na konferenci BYZON 2026. " + d["subtitle"], "/simpleshop/") + body + footer()


def page_partner():
    d = C["partner_page"]; s = C["site"]; cta = C["cta"]
    items = ""
    for img in d["brochure"]:
        items += f'<div class="g-item" data-full="{att(img)}"><img src="{att(img)}" alt="BYZON – brožura pro partnery" loading="lazy"></div>'
    body = (
        header("/stante-se-partnerem/", solid=False)
        + '<main id="main">'
        + page_hero(d["title"], d["lead"], crumb_label="Staňte se partnerem")
        + f"""<section class="section">
  <div class="container">
    <div class="brochure-grid reveal" data-gallery>{items}</div>
    <div class="partner-cta reveal">
      <h2>Staňte se partnerem konference BYZON</h2>
      <p>Máte zájem o spolupráci? Ozvěte se nám na {esc(s['email'])}.</p>
      <div class="hero__actions" style="justify-content:center">
        <a class="btn" href="mailto:{att(s['email'])}">Napište nám {ICONS['arrow']}</a>
        <a class="btn btn--ghost btn--on-dark" href="{att(cta['href'])}">{esc(cta['label'])}</a>
      </div>
    </div>
  </div>
</section>"""
        + "</main>"
    )
    return head("Staňte se partnerem – Byzon", d["lead"], "/stante-se-partnerem/") + body + footer()


def page_speaker(sp):
    cta = C["cta"]
    role = f'<p class="role">{esc(sp["role"])}</p>' if sp.get("role") else ""
    bio = "".join(f"<p>{esc(p)}</p>" for p in sp["bio"])
    body = (
        header("/", solid=True)
        + '<main id="main">'
        + f"""<section class="section" style="padding-top:calc(var(--header-h) + 48px)">
  <div class="container">
    <nav class="breadcrumb speaker-back" style="justify-content:flex-start"><a href="/#speakers">‹ Zpět na řečníky</a></nav>
    <div class="speaker-detail">
      <div class="portrait"><img src="{att(sp['photo'])}" alt="{att(sp['name'])}" data-fallback="{att(sp['name'])}"></div>
      <div>
        <span class="eyebrow">Řečník BYZON 2026</span>
        <h1>{esc(sp['name'])}</h1>
        {role}
        <div class="bio">{bio}</div>
        <div class="hero__actions" style="margin-top:30px">
          <a class="btn" href="{att(cta['href'])}">{esc(cta['label'])} {ICONS['arrow']}</a>
        </div>
      </div>
    </div>
  </div>
</section>"""
        + "</main>"
    )
    desc = (sp.get("role") or "Řečník konference BYZON 2026") + " – " + sp["name"]
    return head(f"{sp['name']} – Byzon", desc, f"/speaker/{sp['slug']}/", sp["photo"]) + body + footer()


# --------------------------------------------------------------- write ------
def write(path, content):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full) or ".", exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def main():
    written = []
    written.append(write("index.html", page_home()))
    written.append(write("program/index.html", page_program()))
    written.append(write("byznys-konference/index.html", page_rocniky()))
    written.append(write("simpleshop/index.html", page_simpleshop()))
    written.append(write("stante-se-partnerem/index.html", page_partner()))
    for sp in C["speakers"]["list"]:
        written.append(write(f"speaker/{sp['slug']}/index.html", page_speaker(sp)))
    print(f"Generated {len(written)} pages:")
    for p in written:
        print("  -", p)


if __name__ == "__main__":
    main()
