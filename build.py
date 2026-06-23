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
    "linkedin": '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3.4a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM3 9h4v12H3V9zm7 0h3.8v1.6h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6.1V21h-4v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9V21h-4V9z"/></svg>',
    "web": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>',
    "instagram": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
    "youtube": '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12c0 2 .2 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.3-1.9.5-3.8.5-5.8s-.2-3.9-.5-5.8zM9.8 15.5v-7l6.2 3.5-6.2 3.5z"/></svg>',
    "mail": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>',
}


SPEAKER_LINKS = (
    ("linkedin", "LinkedIn"),
    ("web", "Web"),
    ("instagram", "Instagram"),
    ("youtube", "YouTube"),
)

SPEAKER_SLUGS = {
    sp["name"]: sp["slug"]
    for sp in C.get("speakers", {}).get("list", [])
    if sp.get("name") and sp.get("slug")
}
SPEAKER_NAME_RE = re.compile(
    "|".join(re.escape(n) for n in sorted(SPEAKER_SLUGS, key=len, reverse=True))
) if SPEAKER_SLUGS else None


def stage_icon(name):
    n = name.lower()
    if "byzon stage" in n: return ICONS["mic"]
    if "leadership stage" in n: return ICONS["users"]
    if "loco" in n or "workshop" in n: return ICONS["tool"]
    if "předsálí" in n or "predsali" in n: return ICONS["users"]
    if "koučovací" in n or "koucovaci" in n: return ICONS["coffee"]
    if "networking" in n or "afterparty" in n: return ICONS["sparkles"]
    if "workshop" in n: return ICONS["tool"]
    if "galakoktejl" in n or "solnice" in n: return ICONS["award"]
    return ICONS["mic"]


def program_kind_class(kind):
    kind = re.sub(r"[^a-z0-9]+", "-", str(kind or "").lower()).strip("-")
    return f" program-event--{kind}" if kind else ""


def link_speaker_names(text):
    text = str(text)
    if not SPEAKER_NAME_RE:
        return esc(text)
    out = []
    pos = 0
    for match in SPEAKER_NAME_RE.finditer(text):
        out.append(esc(text[pos:match.start()]))
        name = match.group(0)
        out.append(
            f'<a class="program-speaker-link" href="/speaker/{att(SPEAKER_SLUGS[name])}/">'
            f'{esc(name)}</a>'
        )
        pos = match.end()
    out.append(esc(text[pos:]))
    return "".join(out)


def program_event(ev):
    title = ev.get("title", "")
    time = ev.get("time", "")
    meta = ev.get("meta")
    desc = ev.get("description")
    slug = SPEAKER_SLUGS.get(title)
    extra_class = " program-event--has-link" if slug else ""
    meta_html = f'<span class="program-event__meta">{link_speaker_names(meta)}</span>' if meta else ""
    desc_html = f'<p>{esc(desc)}</p>' if desc else ""
    title_text = esc(title) if slug else link_speaker_names(title)
    title_html = f'<strong class="program-event__title">{title_text}</strong>'
    if slug:
        body = (
            f'<a class="program-event__body program-event__body--link" '
            f'href="/speaker/{att(slug)}/" aria-label="Profil řečníka: {att(title)}">'
            f'{title_html}{meta_html}{desc_html}</a>'
        )
    else:
        body = f'<div class="program-event__body">{title_html}{meta_html}{desc_html}</div>'
    return (
        f'<li class="program-event{program_kind_class(ev.get("type"))}{extra_class}">'
        f'<span class="program-event__time">{esc(time)}</span>{body}</li>'
    )


def program_stage(stage):
    if isinstance(stage, str):
        name = stage
        events = []
        note = ""
    else:
        name = stage["name"]
        events = stage.get("events", [])
        note = stage.get("note", "")
    note_html = f'<p class="stage-card__note">{esc(note)}</p>' if note else ""
    if events:
        content = f'<ol class="program-timeline">{"".join(program_event(ev) for ev in events)}</ol>'
    else:
        content = '<p class="soon">Detailní program připravujeme.</p>'
    return f"""<article class="stage-card stage-card--schedule">
          <div class="stage-card__head">
            <div class="stage-card__head-top">
              <div class="stage-ico">{stage_icon(name)}</div>
              <h3>{esc(name)}</h3>
            </div>
            {note_html}
          </div>
          {content}
        </article>"""


SLOT_MINUTES = 15


def _clock_to_minutes(value):
    match = re.match(r"^\s*(\d{1,2}):(\d{2})", str(value or ""))
    if not match:
        return None
    h, m = int(match.group(1)), int(match.group(2))
    return h * 60 + m


def _minutes_to_clock(value):
    h, m = divmod(int(value), 60)
    return f"{h}:{m:02d}"


def _floor_slot(value):
    return (value // SLOT_MINUTES) * SLOT_MINUTES


def _ceil_slot(value):
    return ((value + SLOT_MINUTES - 1) // SLOT_MINUTES) * SLOT_MINUTES


def program_event_range(ev):
    time = str(ev.get("time", ""))
    match = re.search(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})?", time)
    if not match:
        return None
    start = _clock_to_minutes(match.group(1))
    end = _clock_to_minutes(match.group(2)) if match.group(2) else None
    if start is None:
        return None
    if end is None or end <= start:
        end = start + 60
    return start, end


def _event_start(ev):
    rng = program_event_range(ev)
    return rng[0] if rng else 0


def calendar_kind_class(kind):
    kind = re.sub(r"[^a-z0-9]+", "-", str(kind or "").lower()).strip("-")
    return f" program-cal-event--{kind}" if kind else ""


def mobile_kind_class(kind):
    kind = re.sub(r"[^a-z0-9]+", "-", str(kind or "").lower()).strip("-")
    return f" program-mobile-event--{kind}" if kind else ""


def is_registration_event(ev):
    return str(ev.get("title", "")).strip().lower() == "registrace"


def is_condensed_calendar_event(ev):
    return str(ev.get("type", "")).lower() in {"break", "meal"} or is_registration_event(ev)


def _slot_overlaps(stage_items, slot_start):
    slot_end = slot_start + SLOT_MINUTES
    overlaps = []
    for stage in stage_items:
        for ev in stage["events"]:
            rng = program_event_range(ev)
            if not rng:
                continue
            start, end = rng
            if start < slot_end and end > slot_start:
                overlaps.append(ev)
    return overlaps


def program_calendar_slot_rows(stage_items, cal_start, slot_count):
    rows = []
    row_by_slot = {}
    row_number = 2
    i = 0
    while i < slot_count:
        slot_start = cal_start + i * SLOT_MINUTES
        overlaps = _slot_overlaps(stage_items, slot_start)
        if not overlaps:
            while i < slot_count and not _slot_overlaps(stage_items, cal_start + i * SLOT_MINUTES):
                row_by_slot[cal_start + i * SLOT_MINUTES] = row_number
                i += 1
            rows.append("var(--slot-gap-h)")
            row_number += 1
        elif all(is_condensed_calendar_event(ev) for ev in overlaps):
            while i < slot_count:
                current = cal_start + i * SLOT_MINUTES
                current_overlaps = _slot_overlaps(stage_items, current)
                if not current_overlaps or not all(is_condensed_calendar_event(ev) for ev in current_overlaps):
                    break
                row_by_slot[current] = row_number
                i += 1
            rows.append("var(--slot-compact-short-h)")
            row_number += 1
        else:
            row_by_slot[slot_start] = row_number
            rows.append("var(--slot-h)")
            row_number += 1
            i += 1
    return " ".join(rows), row_by_slot, len(rows)


def program_calendar_event(ev, col, row_by_slot):
    rng = program_event_range(ev)
    if not rng:
        return ""
    start, end = rng
    event_slots = range(_floor_slot(start), _ceil_slot(end), SLOT_MINUTES)
    event_rows = [row_by_slot[slot] for slot in event_slots if slot in row_by_slot]
    if not event_rows:
        return ""
    row = event_rows[0]
    span = 1 if is_condensed_calendar_event(ev) else max(1, max(event_rows) - row + 1)
    title = ev.get("title", "")
    time = ev.get("time", "")
    meta = ev.get("meta")
    desc = ev.get("description")
    slug = SPEAKER_SLUGS.get(title)
    extra_class = " program-cal-event--has-link" if slug else ""
    grid_col = "2 / -1" if ev.get("span") == "all" else str(col)
    if ev.get("span") == "all":
        extra_class += " program-cal-event--span-all"
    if span == 1 or is_condensed_calendar_event(ev):
        extra_class += " program-cal-event--short"
    meta_html = f'<span class="program-cal-event__meta">{link_speaker_names(meta)}</span>' if meta else ""
    desc_html = f'<p>{esc(desc)}</p>' if desc else ""
    title_text = esc(title) if slug else link_speaker_names(title)
    title_html = f'<strong class="program-cal-event__title">{title_text}</strong>'
    inner = (
        f'<span class="program-cal-event__time">{esc(time)}</span>'
        f'{title_html}{meta_html}{desc_html}'
    )
    if slug:
        body = (
            f'<a class="program-cal-event__inner program-cal-event__inner--link" '
            f'href="/speaker/{att(slug)}/" aria-label="Profil řečníka: {att(title)}">{inner}</a>'
        )
    else:
        body = f'<div class="program-cal-event__inner">{inner}</div>'
    return (
        f'<article class="program-cal-event{calendar_kind_class(ev.get("type"))}{extra_class}" '
        f'style="grid-column:{grid_col};grid-row:{row} / span {span}">{body}</article>'
    )


def _mobile_stage_id(index):
    return f"stage-{index}"


def _mobile_stage_label(names, total_count):
    unique = list(dict.fromkeys(names))
    if total_count > 1 and len(unique) == total_count:
        return "Všechny stage"
    if len(unique) > 2:
        return f"{len(unique)} stage"
    return ", ".join(unique)


def program_mobile_event(item, total_count):
    ev = item["event"]
    title = ev.get("title", "")
    time = ev.get("time", "")
    meta = ev.get("meta")
    desc = ev.get("description")
    slug = SPEAKER_SLUGS.get(title)
    stage_label = _mobile_stage_label(item["stage_names"], total_count)
    stage_ids = " ".join(item["stage_ids"])
    meta_html = f'<span class="program-mobile-event__meta">{link_speaker_names(meta)}</span>' if meta else ""
    desc_html = f'<p>{esc(desc)}</p>' if desc else ""
    title_text = esc(title) if slug else link_speaker_names(title)
    if slug:
        title_html = (
            f'<a class="program-mobile-event__title program-mobile-event__title--link" '
            f'href="/speaker/{att(slug)}/" aria-label="Profil řečníka: {att(title)}">'
            f'{title_text}</a>'
        )
    else:
        title_html = f'<strong class="program-mobile-event__title">{title_text}</strong>'
    return f"""<article class="program-mobile-event{mobile_kind_class(ev.get("type"))}" data-stage-ids="{att(stage_ids)}">
              <div class="program-mobile-event__top">
                <span class="program-mobile-event__stage">{esc(stage_label)}</span>
                <span class="program-mobile-event__time">{esc(time)}</span>
              </div>
              {title_html}{meta_html}{desc_html}
            </article>"""


def program_mobile_agenda(stages, label=None):
    stage_items = []
    for index, stage in enumerate(stages):
        if isinstance(stage, str):
            stage = {"name": stage, "events": []}
        events = [ev for ev in stage.get("events", []) if program_event_range(ev)]
        if events:
            stage_items.append({
                **stage,
                "events": events,
                "mobile_id": _mobile_stage_id(index),
            })
    if not stage_items:
        return ""

    all_stage_ids = [stage["mobile_id"] for stage in stage_items]
    all_stage_names = [stage["name"] for stage in stage_items]
    merged = {}
    order = 0
    for stage_index, stage in enumerate(stage_items):
        for ev in stage["events"]:
            rng = program_event_range(ev)
            if not rng:
                continue
            start, end = rng
            shared_all = ev.get("span") == "all"
            if shared_all:
                stage_ids = all_stage_ids
                stage_names = all_stage_names
                key = ("all", start, end, ev.get("time", ""), ev.get("title", ""), ev.get("meta", ""), ev.get("description", ""), ev.get("type", ""))
            elif is_condensed_calendar_event(ev):
                stage_ids = [stage["mobile_id"]]
                stage_names = [stage["name"]]
                key = ("condensed", start, end, ev.get("time", ""), ev.get("title", ""), ev.get("meta", ""), ev.get("description", ""), ev.get("type", ""))
            else:
                stage_ids = [stage["mobile_id"]]
                stage_names = [stage["name"]]
                key = ("event", start, end, stage_index, order)
            if key not in merged:
                merged[key] = {
                    "event": ev,
                    "start": start,
                    "end": end,
                    "order": order,
                    "stage_ids": [],
                    "stage_names": [],
                }
            merged[key]["stage_ids"].extend(stage_ids)
            merged[key]["stage_names"].extend(stage_names)
            order += 1

    items = []
    for item in merged.values():
        item["stage_ids"] = list(dict.fromkeys(item["stage_ids"]))
        item["stage_names"] = list(dict.fromkeys(item["stage_names"]))
        items.append(item)
    items.sort(key=lambda item: (item["start"], item["end"], item["order"]))

    filters = ""
    if len(stage_items) > 1:
        buttons = ['<button class="program-mobile-filter is-active" type="button" data-stage-filter="all" aria-pressed="true">Vše</button>']
        buttons.extend(
            f'<button class="program-mobile-filter" type="button" data-stage-filter="{att(stage["mobile_id"])}" aria-pressed="false">{esc(stage["name"])}</button>'
            for stage in stage_items
        )
        filters = f'<div class="program-mobile-filters" role="group" aria-label="Filtrovat program podle místa">{"".join(buttons)}</div>'

    groups = []
    for start in dict.fromkeys(item["start"] for item in items):
        group_items = [item for item in items if item["start"] == start]
        groups.append(
            f"""<section class="program-mobile-time-group" data-mobile-time-group>
              <div class="program-mobile-time">{_minutes_to_clock(start)}</div>
              <div class="program-mobile-time-events">{"".join(program_mobile_event(item, len(stage_items)) for item in group_items)}</div>
            </section>"""
        )

    title_html = f'<h2 class="program-mobile-title">{esc(label)}</h2>' if label else ""
    filter_html = f"\n          {filters}" if filters else ""
    return f"""{title_html}<div class="program-mobile-agenda" data-mobile-agenda>{filter_html}
          <div class="program-mobile-list">{"".join(groups)}</div>
        </div>"""


def program_calendar(stages, label=None, modifier=None):
    stage_items = []
    for stage in stages:
        if isinstance(stage, str):
            stage = {"name": stage, "events": []}
        events = [ev for ev in stage.get("events", []) if program_event_range(ev)]
        if events:
            stage_items.append({**stage, "events": events})
    if not stage_items:
        return ""
    modifier_class = f" program-calendar--{att(modifier)}" if modifier else ""
    starts = [program_event_range(ev)[0] for stg in stage_items for ev in stg["events"]]
    ends = [program_event_range(ev)[1] for stg in stage_items for ev in stg["events"]]
    cal_start = _floor_slot(min(starts))
    cal_end = _ceil_slot(max(ends))
    slot_count = max(1, (cal_end - cal_start) // SLOT_MINUTES)
    slot_rows, row_by_slot, display_row_count = program_calendar_slot_rows(stage_items, cal_start, slot_count)
    label_html = f'<h2 class="program-calendar-title">{esc(label)}</h2>' if label else ""
    gridlines = (
        f'<div class="program-calendar__gridlines" '
        f'style="grid-column:1 / -1;grid-row:2 / span {display_row_count}"></div>'
    )
    headers = ['<div class="program-calendar__time-head" style="grid-column:1;grid-row:1"></div>']
    events_html = []
    for idx, stage in enumerate(stage_items, start=2):
        note = stage.get("note", "")
        note_html = f'<p>{esc(note)}</p>' if note else ""
        headers.append(
            f"""<div class="program-calendar__stage-head" style="grid-column:{idx};grid-row:1">
              <div class="stage-ico">{stage_icon(stage['name'])}</div>
              <div><h3>{esc(stage['name'])}</h3>{note_html}</div>
            </div>"""
        )
        events_html.extend(program_calendar_event(ev, idx, row_by_slot) for ev in stage["events"])
    labels = []
    first_hour = ((cal_start + 59) // 60) * 60
    label_points = [cal_start] if cal_start % 60 else []
    label_points.extend(range(first_hour, cal_end, 60))
    used_label_rows = set()
    for value in dict.fromkeys(label_points):
        row = row_by_slot.get(value)
        if not row or row in used_label_rows:
            continue
        used_label_rows.add(row)
        labels.append(
            f'<div class="program-calendar__time-label" style="grid-column:1;grid-row:{row}">{_minutes_to_clock(value)}</div>'
        )
    return f"""{label_html}<div class="program-calendar-wrap">
      <div class="program-calendar program-calendar--cols-{len(stage_items)}{modifier_class}" style="--stage-count:{len(stage_items)};--slot-count:{display_row_count};--slot-rows:{att(slot_rows)}">
        {gridlines}
        {"".join(headers)}
        {"".join(labels)}
        {"".join(events_html)}
      </div>
    </div>"""


def program_day_schedule(day):
    stages = day.get("stages", [])
    networking = []
    main = []
    has_networking = any(
        "networking" in (stage["name"] if isinstance(stage, dict) else str(stage)).lower()
        or "afterparty" in (stage["name"] if isinstance(stage, dict) else str(stage)).lower()
        for stage in stages
    )
    for stage in stages:
        name = stage["name"] if isinstance(stage, dict) else str(stage)
        if "networking" in name.lower() or "afterparty" in name.lower():
            networking.append(stage)
            continue
        if isinstance(stage, dict) and has_networking:
            filtered = [ev for ev in stage.get("events", []) if _event_start(ev) < 18 * 60 + 15]
            if filtered:
                main.append({**stage, "events": filtered})
        else:
            main.append(stage)
    main_modifier = "dense" if not has_networking else None
    calendars = [program_calendar(main, modifier=main_modifier), program_mobile_agenda(main)]
    if networking:
        calendars.append(program_calendar(networking, "Večerní program", "compact"))
        calendars.append(program_mobile_agenda(networking, "Večerní program"))
    return "".join(cal for cal in calendars if cal)


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
<link href="https://fonts.googleapis.com/css2?family=Khand:wght@300;400;500;600;700&display=swap" rel="stylesheet">
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
        f'<li><a href="{att(l["href"])}"'
        + (' target="_blank" rel="noopener"' if l["href"].startswith("http") else "")
        + f'>{esc(l["label"])}</a></li>'
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
    <div class="feature-cta reveal">
      <a class="btn btn--ghost" href="/program/">Zobrazit celý program {ICONS['arrow']}</a>
    </div>
  </div>
</section>"""


def sec_vstupenky():
    d = C["vstupenky"]; cta = C["cta"]
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
    <div class="pricing-grid">{tiers}</div>
  </div>
</section>"""


def speaker_card(sp):
    return f"""<a class="speaker-card reveal" href="/speaker/{att(sp['slug'])}/" aria-label="Profil řečníka: {att(sp['name'])}">
      <img src="{att(sp['photo'])}" alt="{att(sp['name'])}" loading="lazy" data-fallback="{att(sp['name'])}">
    </a>"""


def speaker_socials(sp):
    links = sp.get("links") or {}
    items = []
    for key, label in SPEAKER_LINKS:
        href = links.get(key)
        if href:
            items.append(
                f'<a href="{att(href)}" target="_blank" rel="noopener" '
                f'title="{att(label)}" aria-label="{att(label + " – " + sp["name"])}">{ICONS[key]}</a>'
            )
    if not items:
        return ""
    return f'<nav class="speaker-socials" aria-label="{att("Odkazy řečníka " + sp["name"])}">{"".join(items)}</nav>'


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


def year_block(y, show_inline_gallery=True):
    btn = y.get("button")
    btn_html = ""
    if btn:
        btn_html = f'<a class="btn btn--ghost btn--sm" href="{att(btn["href"])}" target="_blank" rel="noopener">{esc(btn["label"])} {ICONS["arrow"]}</a>'
    media = ""
    if y.get("local_video"):
        poster = f' poster="{att(y["local_video_poster"])}"' if y.get("local_video_poster") else ""
        media += f"""<div class="video-embed">
        <video controls preload="metadata" playsinline{poster}>
          <source src="{att(y['local_video'])}" type="video/mp4">
          Váš prohlížeč nepodporuje přehrávání tohoto videa.
        </video>
      </div>"""
    if show_inline_gallery and y["kind"] == "gallery":
        items = ""
        for img in y["images"]:
            items += f'<div class="g-item" data-full="{att(img)}"><img src="{att(img)}" alt="BYZON {esc(y["year"])}" loading="lazy"></div>'
        media += f'<div class="gallery" data-gallery>{items}</div>'
    elif y.get("video"):
        media += f"""<div class="video-embed">
        <iframe loading="lazy" title="{att(y.get('video_title',''))}" src="https://www.youtube.com/embed/{att(y['video'])}"
          frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
      </div>"""
    return f"""<div class="year-block reveal">
      <div class="year-tag">{esc(y['year'])}</div>
      <div class="year-body">{media}{btn_html}</div>
    </div>"""


def sec_rocniky(soft=True, show_inline_gallery=True):
    d = C["rocniky"]
    blocks = "".join(year_block(y, show_inline_gallery) for y in d["years"])
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
    <div class="partners-cta reveal">
      <a class="btn btn--ghost" href="/stante-se-partnerem/">Staňte se partnerem {ICONS['arrow']}</a>
    </div>
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
    title_html = esc(h["title"])
    if h.get("title_accent"):
        title_html = title_html.replace(esc(h["title_accent"]),
                                        f'<span class="accent">{esc(h["title_accent"])}</span>', 1)
    hero = f"""<section class="hero hero--brand">
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
        + sec_rocniky(soft=True, show_inline_gallery=False)
        + sec_partners()
        + "</main>"
    )
    return head(s["title"], s["description"], "/", s["skull"]) + body + footer()


def page_program():
    d = C["program"]
    tabs = ""; panels = ""
    for i, day in enumerate(d["days"]):
        sel = "true" if i == 0 else "false"
        tabs += f'<button class="tab" role="tab" id="tab-{i}" aria-controls="panel-{i}" aria-selected="{sel}">{esc(day["name"])}</button>'
        day_meta = f'<p class="program-day-meta">{esc(day["date"])}</p>' if day.get("date") else ""
        panels += f'<div class="tabpanel program-day" role="tabpanel" id="panel-{i}" aria-labelledby="tab-{i}"{"" if i==0 else " hidden"}>{day_meta}{program_day_schedule(day)}</div>'
    body = (
        header("/program/", solid=False)
        + '<main id="main">'
        + page_hero(d["title"], crumb_label="Program")
        + f"""<section class="section program-section">
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
    socials = speaker_socials(sp)
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
        {socials}
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


def page_legal(lp):
    frag = open(os.path.join(ROOT, lp["file"]), encoding="utf-8").read()
    body = (
        header("/", solid=True)
        + '<main id="main">'
        + f"""<section class="section" style="padding-top:calc(var(--header-h) + 48px)">
  <div class="container">
    <article class="legal">
      <nav class="breadcrumb" style="justify-content:flex-start;margin-bottom:18px"><a href="/">‹ Zpět na hlavní stranu</a></nav>
      <h1 class="legal-title">{esc(lp['title'])}</h1>
      <div class="legal-body">{frag}</div>
    </article>
  </div>
</section>"""
        + "</main>"
    )
    return head(f"{lp['title']} – Byzon", lp["description"], f"/{lp['slug']}/") + body + footer()


def page_404():
    body = (
        header("/", solid=True)
        + '<main id="main">'
        + f"""<section class="section" style="padding-top:calc(var(--header-h) + 60px);text-align:center">
  <div class="container">
    <span class="eyebrow">404</span>
    <h1>Stránka nenalezena</h1>
    <p style="max-width:540px;margin:14px auto 30px">Omlouváme se, tahle stránka neexistuje nebo byla přesunuta.</p>
    <a class="btn" href="/">Zpět na hlavní stranu {ICONS['arrow']}</a>
  </div>
</section>"""
        + "</main>"
    )
    return head("Stránka nenalezena – Byzon", "Stránka nenalezena.", "/404.html") + body + footer()


# --------------------------------------------------------------- write ------
def write(path, content):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full) or ".", exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def url_for(page_path):
    if page_path == "index.html":
        return "/"
    return "/" + page_path[: -len("index.html")]


def write_sitemap(pages):
    base = C["site"]["url"].rstrip("/")
    urls = "".join(f"  <url><loc>{base}{url_for(p)}</loc></url>\n" for p in pages)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           f"{urls}</urlset>\n")
    return write("sitemap.xml", xml)


def write_robots():
    base = C["site"]["url"].rstrip("/")
    return write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {base}/sitemap.xml\n")


def main():
    written = []
    written.append(write("index.html", page_home()))
    written.append(write("program/index.html", page_program()))
    written.append(write("byznys-konference/index.html", page_rocniky()))
    written.append(write("simpleshop/index.html", page_simpleshop()))
    written.append(write("stante-se-partnerem/index.html", page_partner()))
    for sp in C["speakers"]["list"]:
        written.append(write(f"speaker/{sp['slug']}/index.html", page_speaker(sp)))
    for lp in C.get("legal_pages", []):
        written.append(write(f"{lp['slug']}/index.html", page_legal(lp)))
    # production extras
    extras = [
        write("404.html", page_404()),
        write_sitemap(written),
        write_robots(),
    ]
    print(f"Generated {len(written)} pages + {len(extras)} extra files:")
    for p in written + extras:
        print("  -", p)


if __name__ == "__main__":
    main()
