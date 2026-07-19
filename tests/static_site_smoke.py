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
FIXED_PAGES = {
    "index.html",
    "program/index.html",
    "byznys-konference/index.html",
    "simpleshop/index.html",
    "stante-se-partnerem/index.html",
}
EXTRAS = {"404.html", "sitemap.xml", "robots.txt"}
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
        return ROOT / "index.html"
    target = ROOT / relative
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
                missing.add(f"{html_file.relative_to(ROOT)} -> {value}")
    if missing:
        fail("Missing local references:\n  " + "\n  ".join(sorted(missing)))


def validate_critical_contract(content: dict[str, object]) -> None:
    home = (ROOT / "index.html").read_text(encoding="utf-8")
    program = (ROOT / "program/index.html").read_text(encoding="utf-8")
    checkout = (ROOT / "simpleshop/index.html").read_text(encoding="utf-8")

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
    content = json.loads((ROOT / "data/content.json").read_text(encoding="utf-8"))
    outputs = expected_outputs(content)

    with tempfile.TemporaryDirectory(prefix="byzon-static-smoke-") as temp_dir:
        isolated_root = Path(temp_dir)
        shutil.copy2(ROOT / "build.py", isolated_root / "build.py")
        shutil.copytree(ROOT / "data", isolated_root / "data")
        shutil.copytree(ROOT / "assets", isolated_root / "assets")
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
            path.relative_to(isolated_root).as_posix()
            for path in isolated_root.rglob("*")
            if path.is_file()
            and path.name != "build.py"
            and path.parts[len(isolated_root.parts)] not in {"assets", "data", "__pycache__"}
        }
        unexpected = actual_outputs - outputs
        absent = outputs - actual_outputs
        mismatches.extend(f"unexpected generated output: {path}" for path in sorted(unexpected))
        mismatches.extend(f"missing generated output: {path}" for path in sorted(absent))
        for relative in sorted(outputs):
            committed = ROOT / relative
            generated = isolated_root / relative
            if not committed.is_file():
                mismatches.append(f"missing committed output: {relative}")
            elif generated.is_file() and sha256(committed) != sha256(generated):
                mismatches.append(f"generated output differs: {relative}")
        if mismatches:
            fail("Static build regression:\n  " + "\n  ".join(mismatches))

    html_files = sorted(ROOT / relative for relative in outputs if relative.endswith(".html"))
    validate_local_references(html_files)
    validate_critical_contract(content)

    html_bytes = sum(path.stat().st_size for path in html_files)
    asset_files = [
        path
        for path in (ROOT / "assets").rglob("*")
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
