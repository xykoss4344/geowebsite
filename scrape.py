"""Scrape geogjon.weebly.com into content.json + assets/.

Rerunnable. Needs `requests` and `bs4` (already installed on this machine).
    py -3 scrape.py           # scrape
    py -3 scrape.py --test    # just run the parser self-check
"""

import json
import os
import re
import sys
import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString

SITE = "https://geogjon.weebly.com"
OUT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(OUT, "assets")

# Weebly wraps each editor element in one of these; treat as a leaf and don't descend.
LEAF = ("paragraph", "wsite-youtube", "wsite-image", "wsite-video", "wsite-button")


def slug_of(url):
    name = os.path.basename(urlparse(url).path) or "index.html"
    name = re.sub(r"\.html?$", "", name)
    return "home" if name in ("", "index") else name


def clean(text):
    return text.replace("\xa0", " ").replace("​", "")


def extract_runs(node):
    """Flatten an element into inline runs, keeping link + bold context.

    Returns [{"t": str, "href": str|None, "b": bool}]. A run of "\n" marks a <br>.
    """
    runs = []

    # ponytail: list items become newline-separated lines, not real <ul> markup.
    # Honest and readable; swap in a "list" block type if semantic lists are wanted.
    BREAK_BEFORE = ("li", "p", "tr", "div", "h1", "h2", "h3", "h4")

    def walk(n, href, bold):
        for c in n.children:
            if isinstance(c, NavigableString):
                t = clean(str(c))
                if t:
                    runs.append({"t": t, "href": href, "b": bold})
            elif c.name == "br":
                runs.append({"t": "\n", "href": None, "b": False})
            elif c.name in ("script", "style"):
                continue
            else:
                if c.name in BREAK_BEFORE:
                    runs.append({"t": "\n", "href": None, "b": False})
                h = c.get("href") or href if c.name == "a" else href
                walk(c, h, bold or c.name in ("strong", "b"))

    walk(node, None, False)
    return runs


def split_blocks(runs):
    """Merge adjacent like-styled runs and split into paragraphs on blank lines."""
    merged = []
    for r in runs:
        if merged and merged[-1]["href"] == r["href"] and merged[-1]["b"] == r["b"]:
            merged[-1]["t"] += r["t"]
        else:
            merged.append(dict(r))

    blocks, cur = [], []
    for r in merged:
        # A run containing a blank line ends the current block.
        parts = re.split(r"\n\s*\n", r["t"])
        for i, part in enumerate(parts):
            if i:
                blocks.append(cur)
                cur = []
            if part:
                cur.append({**r, "t": part})
    blocks.append(cur)

    out = []
    for b in blocks:
        b = [r for r in b if r["t"].strip() or r["href"]]
        if b and "".join(r["t"] for r in b).strip():
            b[0]["t"] = b[0]["t"].lstrip()
            b[-1]["t"] = b[-1]["t"].rstrip()
            out.append({"type": "text", "runs": [
                {k: v for k, v in r.items() if v not in (None, False)} for r in b
            ]})
    return out


def parse_body(root, page_url, want_asset):
    blocks = []
    seen_files = set()

    def visit(n):
        if not getattr(n, "name", None):
            return
        cls = n.get("class") or []
        # Weebly file-download element: an <a title="Download file: x.pdf">, rendered
        # twice (icon + text link) inside an unclassed wrapper. Emit once.
        if n.name == "a" and (n.get("title") or "").startswith("Download file:"):
            href = urljoin(page_url, n.get("href") or "")
            if href not in seen_files:
                seen_files.add(href)
                blocks.append({"type": "file", "href": want_asset(href),
                               "name": n["title"].split(":", 1)[1].strip()})
            return
        if n.name in ("h1", "h2", "h3", "h4"):
            t = clean(n.get_text(" ", strip=True))
            if t:
                blocks.append({"type": "heading", "text": t})
            return
        if any(c in LEAF for c in cls):
            if "wsite-youtube" in cls or "wsite-video" in cls:
                f = n.find("iframe")
                if f and f.get("src"):
                    src = f["src"]
                    blocks.append({"type": "embed", "src": "https:" + src
                                   if src.startswith("//") else src})
                return
            img = n.find("img")
            if img and img.get("src") and "paragraph" not in cls:
                blocks.append({"type": "image",
                               "src": want_asset(urljoin(page_url, img["src"])),
                               "alt": img.get("alt", "")})
                return
            for b in split_blocks(extract_runs(n)):
                for r in b["runs"]:
                    if r.get("href"):
                        r["href"] = want_asset(urljoin(page_url, r["href"])) \
                            if "/uploads/" in r["href"] else urljoin(page_url, r["href"])
                blocks.append(b)
            return
        for c in n.children:
            visit(c)

    visit(root)
    return blocks


def parse_nav(soup):
    """Build the unit tree from <ul> nesting depth. Weebly renders the menu twice."""
    tree, stack, seen = [], [], set()
    for li in soup.select("li.wsite-menu-item-wrap, li.wsite-menu-subitem-wrap"):
        a = li.find("a", class_=("wsite-menu-item" if "wsite-menu-item-wrap"
                                 in (li.get("class") or []) else "wsite-menu-subitem"))
        if not a:
            continue
        title = a.select_one(".wsite-menu-title")
        title = clean((title or a).get_text(" ", strip=True))
        href = a.get("href") or ""
        depth = len(li.find_parents("ul"))
        if not title:
            continue
        node = {"title": title,
                "slug": slug_of(href) if href.endswith(".html") or href == "/" else None,
                "children": []}
        if depth == 1:
            if title in seen:  # second (mobile) copy of the menu
                break
            seen.add(title)
            tree.append(node)
            stack = [node]
        else:
            while len(stack) >= depth:
                stack.pop()
            if not stack:
                continue
            stack[-1]["children"].append(node)
            stack.append(node)
    return tree


def main():
    os.makedirs(ASSETS, exist_ok=True)
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0 (site-rebuild)"

    def get(url):
        for attempt in range(2):
            try:
                r = s.get(url, timeout=30)
                if r.ok:
                    r.encoding = "utf-8"
                    return r
            except requests.RequestException:
                pass
            time.sleep(1)
        return None

    assets = {}

    def want_asset(url):
        """Download an /uploads/ file once; return its relative path."""
        if "/uploads/" not in url:
            return url
        if url in assets:
            return assets[url]
        name = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(urlparse(url).path))
        path = os.path.join(ASSETS, name)
        if not os.path.exists(path):
            r = get(url)
            if not r:
                assets[url] = url
                return url
            with open(path, "wb") as f:
                f.write(r.content)
        assets[url] = "assets/" + name
        return assets[url]

    sm = get(SITE + "/sitemap.xml")
    urls = sorted(set(re.findall(r"<loc>(.*?)</loc>", sm.text)))
    print(f"{len(urls)} urls in sitemap")

    pages, nav, failed = {}, None, []
    for i, url in enumerate(urls, 1):
        r = get(url)
        if not r:
            failed.append(url)
            print(f"  [{i}/{len(urls)}] FAILED {url}")
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        if nav is None:
            nav = parse_nav(soup)
        body = next((e for e in soup.select(".wsite-elements")
                     if "wsite-header-elements" not in (e.get("class") or [])), None)
        title = clean(soup.title.get_text(strip=True)) if soup.title else slug_of(url)
        pages[slug_of(url)] = {
            "title": title,
            "source": url,
            "blocks": parse_body(body, url, want_asset) if body else [],
        }
        print(f"  [{i}/{len(urls)}] {slug_of(url)} ({len(pages[slug_of(url)]['blocks'])} blocks)")
        time.sleep(0.3)

    with open(os.path.join(OUT, "content.json"), "w", encoding="utf-8") as f:
        json.dump({"site": "GeogJon IBDP", "nav": nav, "pages": pages},
                  f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, "failed.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(failed))
    print(f"\n{len(pages)} pages, {len(assets)} assets, {len(failed)} failed")


def test():
    """Self-check: inline links and blank-line splitting must survive."""
    html = """<div class="wsite-section-elements">
      <div class="paragraph">Read <strong><a href="/a.html">this article</a></strong>
      (WWF 2021) to answer:<br>What is meant by &ldquo;overshoot&rdquo;?<br><br>
      Second para here.</div>
      <div class="wsite-youtube"><iframe src="//www.youtube.com/embed/XYZ"></iframe></div>
      <div class="paragraph">Countries:<ol><li>Java</li><li>Tibet</li></ol></div>
      <div><div>
        <a href="/uploads/g.pdf" title="Download file: g.pdf"><img src="/i.png"></a>
        <a href="/uploads/g.pdf" title="Download file: g.pdf">Download File</a>
      </div></div>
    </div>"""
    root = BeautifulSoup(html, "html.parser")
    blocks = parse_body(root, SITE + "/p.html", lambda u: u)

    assert [b["type"] for b in blocks] == ["text", "text", "embed", "text", "file"], \
        [b["type"] for b in blocks]

    # list items must not run together ("JavaTibet")
    listed = "".join(r["t"] for r in blocks[3]["runs"])
    assert "Java\nTibet" in listed, repr(listed)

    # the doubly-rendered download link collapses to one file block
    assert blocks[4]["name"] == "g.pdf" and blocks[4]["href"].endswith("/uploads/g.pdf"), blocks[4]

    flat = "".join(r["t"] for r in blocks[0]["runs"])
    assert "Read this article (WWF 2021)" in " ".join(flat.split()), flat
    assert "“overshoot”" in flat, flat
    linked = [r for r in blocks[0]["runs"] if r.get("href")]
    assert len(linked) == 1 and linked[0]["t"] == "this article", linked
    assert linked[0]["href"] == SITE + "/a.html", linked
    assert linked[0]["b"] is True, "bold context lost"
    assert "Second para" in "".join(r["t"] for r in blocks[1]["runs"])
    assert blocks[2]["src"] == "https://www.youtube.com/embed/XYZ", blocks[2]
    print("parser self-check OK")


if __name__ == "__main__":
    test()
    if "--test" not in sys.argv:
        main()
