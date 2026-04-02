#!/usr/bin/env bash
set -euo pipefail

# @describe Fetch and simplify the contents of a URL.
# @option --url! The URL to fetch.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local url="$argc_url"

    if [[ -z "$url" ]]; then
        echo "Missing URL" >&2
        exit 1
    fi

    python3 - "$url" <<'PY' >> "$LLM_OUTPUT"
import html
import re
import sys
import urllib.request
from html.parser import HTMLParser

url = sys.argv[1]


class ContentExtractor(HTMLParser):
    SKIP_TAGS = {
        "script", "style", "svg", "noscript", "iframe", "canvas", "form", "button"
    }
    BLOCK_TAGS = {
        "p", "div", "section", "article", "main", "aside", "li", "ul", "ol",
        "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "br",
        "tr", "td"
    }
    NOISE_HINTS = {
        "nav", "menu", "footer", "header", "sidebar", "breadcrumb", "pagination",
        "toolbar", "cookie", "banner", "modal", "popup", "search", "toc"
    }
    PRIORITY_TAGS = {"main", "article"}

    def __init__(self):
        super().__init__()
        self.skip_depth = 0
        self.noise_depth = 0
        self.priority_depth = 0
        self.title = ""
        self.in_title = False
        self.parts = []

    def _attrs_text(self, attrs):
        values = []
        for key, value in attrs:
            if key in {"class", "id", "role", "aria-label", "data-testid"} and value:
                values.append(str(value).lower())
        return " ".join(values)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attrs_text = self._attrs_text(attrs)
        if tag == "title":
            self.in_title = True
        if tag in self.SKIP_TAGS:
            self.skip_depth += 1
        if tag in self.PRIORITY_TAGS:
            self.priority_depth += 1
        if tag in {"nav", "footer", "header", "aside"} or any(hint in attrs_text for hint in self.NOISE_HINTS):
            self.noise_depth += 1
        if tag == "br":
            self.parts.append(("", self.priority_depth))

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == "title":
            self.in_title = False
        if tag in self.SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1
        if tag in self.PRIORITY_TAGS and self.priority_depth:
            self.priority_depth -= 1
        if tag in self.BLOCK_TAGS:
            self.parts.append(("", self.priority_depth))
        if tag in {"nav", "footer", "header", "aside"} and self.noise_depth:
            self.noise_depth -= 1

    def handle_data(self, data):
        text = html.unescape(data)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return
        if self.in_title and not self.title:
            self.title = text
        if self.skip_depth or self.noise_depth:
            return
        self.parts.append((text, self.priority_depth))


def fetch(url_value: str) -> str:
    req = urllib.request.Request(url_value, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()
        charset = resp.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="ignore")


def post_process(parts):
    lines = []
    current = []
    current_priority = 0
    for text, priority in parts:
        if text == "":
            if current:
                joined = " ".join(current).strip()
                if joined:
                    lines.append((joined, current_priority))
                current = []
                current_priority = 0
            continue
        current.append(text)
        current_priority = max(current_priority, priority)
    if current:
        joined = " ".join(current).strip()
        if joined:
            lines.append((joined, current_priority))

    cleaned = []
    seen = set()
    for text, priority in lines:
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) < 30:
            continue
        lower = text.lower()
        if lower in seen:
            continue
        seen.add(lower)
        cleaned.append((text, priority))

    prioritized = [text for text, priority in cleaned if priority > 0]
    fallback = [text for text, priority in cleaned if priority == 0]
    selected = prioritized if prioritized else fallback
    return selected[:40]


html_text = fetch(url)
parser = ContentExtractor()
parser.feed(html_text)
text_blocks = post_process(parser.parts)

print(f"URL: {url}")
if parser.title:
    print(f"Title: {parser.title}")
print()

if not text_blocks:
    print("No useful text extracted.")
    raise SystemExit(0)

output = "\n\n".join(text_blocks)
output = re.sub(r"\n{3,}", "\n\n", output)
print(output[:12000])
PY
}
eval "$(argc --argc-eval "$0" "$@")"
