#!/usr/bin/env python3
"""Regression smoke test for the existing BYZON static website."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
STATIC_ROOT = ROOT / "static-site"
PUBLIC_ROOT = STATIC_ROOT / "public"
FIXED_PAGES = {
    "index.html",
    "program/index.html",
    "byznys-konference/index.html",
    "simpleshop/index.html",
    "stante-se-partnerem/index.html",
}
EXTRAS = {"404.html", "sitemap.xml", "robots.txt"}
SERVER_CONFIG = {".htaccess"}
FORBIDDEN_DEPLOY_NAMES = {".DS_Store", "Thumbs.db"}
LOCAL_ATTRIBUTE_RE = re.compile(
    r'(?:href|src|poster|data-full)=["\']([^"\']+)["\']', re.IGNORECASE
)


def fail(message: str) -> None:
    raise AssertionError(message)


def expected_outputs(content: dict[str, object]) -> set[str]:
    speaker_pages = {
        f"speaker/{speaker['slug']}/index.html"
        for speaker in content["speakers"]["list"]  # type: ignore[index]
    }
    legal_pages = {
        f"{page['slug']}/index.html"
        for page in content.get("legal_pages", [])  # type: ignore[union-attr]
    }
    return FIXED_PAGES | speaker_pages | legal_pages | EXTRAS


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local_target(value: str) -> Path | None:
    if not value.startswith("/") or value.startswith("//"):
        return None
    parsed = urlsplit(value)
    route = parsed.path
    if not route:
        return None
    relative = route.lstrip("/")
    if not relative:
        return PUBLIC_ROOT / "index.html"
    target = PUBLIC_ROOT / relative
    if route.endswith("/"):
        target /= "index.html"
    return target


def validate_local_references(html_files: list[Path]) -> None:
    missing: set[str] = set()
    for html_file in html_files:
        text = html_file.read_text(encoding="utf-8")
        for value in LOCAL_ATTRIBUTE_RE.findall(text):
            target = local_target(value)
            if target is not None and not target.exists():
                missing.add(f"{html_file.relative_to(PUBLIC_ROOT)} -> {value}")
    if missing:
        fail("Missing local references:\n  " + "\n  ".join(sorted(missing)))


def validate_critical_contract(content: dict[str, object]) -> None:
    home = (PUBLIC_ROOT / "index.html").read_text(encoding="utf-8")
    program = (PUBLIC_ROOT / "program/index.html").read_text(encoding="utf-8")
    checkout = (PUBLIC_ROOT / "simpleshop/index.html").read_text(encoding="utf-8")

    required_markers = {
        "homepage skip link": (home, 'href="#main"'),
        "homepage Czech language": (home, '<html lang="cs">'),
        "program heading": (program, content["program"]["title"]),  # type: ignore[index]
        "SimpleShop form id": (
            checkout,
            f'data-simpleshopform="{content["simpleshop"]["form_id"]}"',  # type: ignore[index]
        ),
        "SimpleShop loader": (checkout, "form.simpleshop.cz"),
        "GTM container": (home, "GTM-MSBB9L9"),
    }
    absent = [name for name, (document, marker) in required_markers.items() if marker not in document]
    if absent:
        fail("Missing critical output markers: " + ", ".join(absent))


def main() -> int:
    content = json.loads((STATIC_ROOT / "data/content.json").read_text(encoding="utf-8"))
    outputs = expected_outputs(content)

    with tempfile.TemporaryDirectory(prefix="byzon-static-smoke-") as temp_dir:
        isolated_root = Path(temp_dir)
        shutil.copy2(STATIC_ROOT / "build.py", isolated_root / "build.py")
        shutil.copytree(STATIC_ROOT / "data", isolated_root / "data")
        shutil.copytree(PUBLIC_ROOT / "assets", isolated_root / "public/assets")
        completed = subprocess.run(
            [sys.executable, "build.py"],
            cwd=isolated_root,
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            fail(
                "Isolated static build failed:\n"
                + completed.stdout
                + completed.stderr
            )

        mismatches: list[str] = []
        actual_outputs = {
            path.relative_to(isolated_root / "public").as_posix()
            for path in (isolated_root / "public").rglob("*")
            if path.is_file()
            and path.parts[len((isolated_root / "public").parts)] != "assets"
        }
        unexpected = actual_outputs - outputs
        absent = outputs - actual_outputs
        mismatches.extend(f"unexpected generated output: {path}" for path in sorted(unexpected))
        mismatches.extend(f"missing generated output: {path}" for path in sorted(absent))
        for relative in sorted(outputs):
            committed = PUBLIC_ROOT / relative
            generated = isolated_root / "public" / relative
            if not committed.is_file():
                mismatches.append(f"missing committed output: {relative}")
            elif generated.is_file() and sha256(committed) != sha256(generated):
                mismatches.append(f"generated output differs: {relative}")
        if mismatches:
            fail("Static build regression:\n  " + "\n  ".join(mismatches))

    deploy_files = {
        path.relative_to(PUBLIC_ROOT).as_posix()
        for path in PUBLIC_ROOT.rglob("*")
        if path.is_file()
    }
    forbidden_deploy_files = {
        path.relative_to(PUBLIC_ROOT).as_posix()
        for path in PUBLIC_ROOT.rglob("*")
        if path.is_file() and path.name in FORBIDDEN_DEPLOY_NAMES
    }
    if forbidden_deploy_files:
        fail(
            "Forbidden junk files in FTP-ready public directory:\n  "
            + "\n  ".join(sorted(forbidden_deploy_files))
        )
    missing_server_config = SERVER_CONFIG - deploy_files
    if missing_server_config:
        fail(
            "Missing server config from FTP-ready public directory:\n  "
            + "\n  ".join(sorted(missing_server_config))
        )
    unexpected_deploy_files = {
        path
        for path in deploy_files
        if not path.startswith("assets/")
        and path not in outputs
        and path not in SERVER_CONFIG
    }
    if unexpected_deploy_files:
        fail(
            "Unexpected files in FTP-ready public directory:\n  "
            + "\n  ".join(sorted(unexpected_deploy_files))
        )

    html_files = sorted(PUBLIC_ROOT / relative for relative in outputs if relative.endswith(".html"))
    validate_local_references(html_files)
    validate_critical_contract(content)

    html_bytes = sum(path.stat().st_size for path in html_files)
    asset_files = [
        path
        for path in (PUBLIC_ROOT / "assets").rglob("*")
        if path.is_file() and path.name != ".DS_Store"
    ]
    asset_bytes = sum(path.stat().st_size for path in asset_files)
    print(
        "Static site smoke passed: "
        f"{len(html_files)} HTML pages, {html_bytes} HTML bytes, "
        f"{len(asset_files)} asset files, {asset_bytes} asset bytes."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
