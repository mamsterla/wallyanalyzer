#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

import requests

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def parse_pages(spec: str | None) -> list[int] | None:
    if not spec:
        return None
    pages: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            a, b = int(start), int(end)
            lo, hi = min(a, b), max(a, b)
            pages.update(range(lo, hi + 1))
        else:
            pages.add(int(part))
    return sorted(pages)


def fetch_url(url: str, referer: str | None = None) -> bytes:
    headers = {"User-Agent": USER_AGENT}
    if referer:
        headers["Referer"] = referer
    resp = requests.get(url, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.content


def strip_html_text(raw_html: str) -> str:
    text = re.sub(r"<script.*?</script>", " ", raw_html, flags=re.S | re.I)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    lines = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def ocr_image_bytes(image_bytes: bytes, suffix: str = ".png") -> str:
    with tempfile.TemporaryDirectory() as td:
        image_path = Path(td) / f"page{suffix}"
        image_path.write_bytes(image_bytes)
        proc = subprocess.run(
            ["tesseract", str(image_path), "stdout", "--psm", "6"],
            check=False,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "tesseract failed")
        return proc.stdout


def render_pdf_page(pdf_path: Path, page_number: int, dpi: int = 200) -> bytes:
    import fitz  # type: ignore

    doc = fitz.open(pdf_path)
    try:
        page = doc[page_number - 1]
        scale = dpi / 72.0
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


def manualslib_page_url(base_url: str, page_number: int) -> str:
    parsed = urlparse(base_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["page"] = str(page_number)
    return urlunparse(parsed._replace(query=urlencode(query), fragment="manual"))


def discover_manualslib_pages(base_url: str) -> list[int]:
    raw = fetch_url(base_url).decode("utf-8", errors="ignore")
    pages = {int(n) for n in re.findall(r"page=(\d+)#manual", raw)}
    if not pages:
        pages = {1}
    pages.add(1)
    return sorted(pages)


def discover_manualmachine_images(base_url: str) -> list[str]:
    raw = fetch_url(base_url, referer=base_url).decode("utf-8", errors="ignore")
    urls = re.findall(r"https://manualmachine\.com/html/[^\"']+/img-\d+-[^\"']+\.png", raw)
    if not urls:
        rels = re.findall(r"(/html/[^\"']+/img-\d+-[^\"']+\.png)", raw)
        urls = ["https://manualmachine.com" + rel for rel in rels]
    seen: list[str] = []
    for url in urls:
        if url not in seen:
            seen.append(url)
    return seen


def local_or_remote_pdf(source: str) -> Path:
    path = Path(source)
    if path.exists():
        return path
    data = fetch_url(source)
    tmpdir = Path(tempfile.mkdtemp(prefix="manual-ocr-pdf-"))
    pdf_path = tmpdir / "source.pdf"
    pdf_path.write_bytes(data)
    return pdf_path


def search_hit(text: str, pattern: re.Pattern[str] | None) -> bool:
    return True if pattern is None else bool(pattern.search(text))


def emit_page(page_number: int, text: str, pattern: re.Pattern[str] | None, context: int) -> None:
    if pattern is None:
        print(f"===== page {page_number} =====")
        print(text.strip())
        return
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    hits = [i for i, line in enumerate(lines) if pattern.search(line)]
    if not hits:
        return
    print(f"===== page {page_number} =====")
    shown = set()
    for idx in hits:
        lo = max(0, idx - context)
        hi = min(len(lines), idx + context + 1)
        for j in range(lo, hi):
            if j not in shown:
                print(lines[j])
                shown.add(j)
        print("---")


def handle_manualslib(args: argparse.Namespace) -> int:
    pages = parse_pages(args.pages) or discover_manualslib_pages(args.source)
    pattern = re.compile(args.search, re.I) if args.search else None
    for page in pages:
        url = manualslib_page_url(args.source, page)
        raw = fetch_url(url).decode("utf-8", errors="ignore")
        text = strip_html_text(raw)
        if search_hit(text, pattern):
            emit_page(page, text, pattern, args.context)
    return 0


def handle_manualmachine(args: argparse.Namespace) -> int:
    image_urls = discover_manualmachine_images(args.source)
    if not image_urls:
        raise SystemExit("No page images found.")
    pages = parse_pages(args.pages) or list(range(1, len(image_urls) + 1))
    pattern = re.compile(args.search, re.I) if args.search else None
    for page in pages:
        if page < 1 or page > len(image_urls):
            continue
        data = fetch_url(image_urls[page - 1], referer=args.source)
        text = ocr_image_bytes(data)
        if search_hit(text, pattern):
            emit_page(page, text, pattern, args.context)
    return 0


def handle_pdf(args: argparse.Namespace) -> int:
    pdf_path = local_or_remote_pdf(args.source)
    import fitz  # type: ignore

    doc = fitz.open(pdf_path)
    try:
        total_pages = len(doc)
    finally:
        doc.close()
    pages = parse_pages(args.pages) or list(range(1, total_pages + 1))
    pattern = re.compile(args.search, re.I) if args.search else None
    for page in pages:
        if page < 1 or page > total_pages:
            continue
        image_bytes = render_pdf_page(pdf_path, page, dpi=args.dpi)
        text = ocr_image_bytes(image_bytes)
        if search_hit(text, pattern):
            emit_page(page, text, pattern, args.context)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch manual pages and OCR/search them.")
    parser.add_argument("source", help="ManualsLib URL, ManualMachine URL, local PDF path, or PDF URL")
    parser.add_argument("--pages", help="Page list/range, e.g. 1-3,12")
    parser.add_argument("--search", help="Regex filter")
    parser.add_argument("--context", type=int, default=2, help="Context lines around matches")
    parser.add_argument("--dpi", type=int, default=200, help="PDF render DPI")
    args = parser.parse_args()

    source = args.source.lower()
    if source.endswith(".pdf") or Path(args.source).suffix.lower() == ".pdf":
        return handle_pdf(args)
    if "manualslib." in source:
        return handle_manualslib(args)
    if "manualmachine.com" in source:
        return handle_manualmachine(args)
    raise SystemExit("Unsupported source. Use a ManualsLib URL, ManualMachine URL, or PDF path/URL.")


if __name__ == "__main__":
    raise SystemExit(main())
