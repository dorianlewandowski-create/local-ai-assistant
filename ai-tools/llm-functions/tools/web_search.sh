#!/usr/bin/env bash
set -euo pipefail

query="${1:-}"
limit="${2:-5}"
source_filter="${3:-}"
output_format="${WEB_SEARCH_FORMAT:-text}"

if [[ -z "$query" ]]; then
    echo "Missing query" >&2
    exit 1
fi

encoded_query="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$query")"
tmp_html="$(mktemp)"
trap 'rm -f "$tmp_html"' EXIT

curl -fsSL -A "Lynx/2.8.9rel.1 libwww-FM/2.14 SSL-MM/1.4.1" "https://lite.duckduckgo.com/lite/?q=${encoded_query}" > "$tmp_html"

python3 - "$query" "$limit" "$tmp_html" "$source_filter" "$output_format" <<'PY'
import html
import json
import re
import sys
import urllib.parse

query = sys.argv[1]
limit = int(sys.argv[2])
path = sys.argv[3]
source_filter = sys.argv[4].strip().lower()
output_format = sys.argv[5].strip().lower() or "text"

with open(path, "r", encoding="utf-8", errors="ignore") as f:
    page = f.read()

pattern = re.compile(
    r"<a(?P<tag>[^>]*class=['\"]result-link['\"][^>]*)>(?P<title>.*?)</a>",
    re.S,
)

def clean_text(value: str) -> str:
    value = re.sub(r"<.*?>", "", value)
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()

def matches_filter(domain: str, title: str, snippet: str) -> bool:
    if not source_filter:
        return True
    haystack = f"{domain} {title} {snippet}".lower()
    presets = {
        "docs": ["docs.", "/docs", "documentation", "readthedocs", "developer", "manual"],
        "github": ["github.com"],
        "news": ["news", "blog", "techcrunch", "theverge", "wired", "arstechnica"],
        "blogs": ["blog", "medium.com", "substack.com", "dev.to", "hashnode"],
    }
    values = presets.get(source_filter, [source_filter])
    return any(value in haystack for value in values)

results = []
seen = set()
for match in pattern.finditer(page):
    tag = match.group("tag")
    href_match = re.search(r"href=['\"](?P<href>[^'\"]+)['\"]", tag)
    if not href_match:
        continue
    href = html.unescape(re.sub(r"\s+", " ", href_match.group("href"))).strip()
    if href.startswith("//"):
        href = "https:" + href
    parsed = urllib.parse.urlparse(href)
    if "duckduckgo.com" in parsed.netloc:
        redirect = urllib.parse.parse_qs(parsed.query).get("uddg")
        if redirect:
            href = urllib.parse.unquote(redirect[0])
    title = clean_text(match.group("title"))
    rest = page[match.end():match.end() + 2000]
    snippet_match = re.search(r"<td[^>]+class=['\"]result-snippet['\"][^>]*>(?P<snippet>.*?)</td>", rest, re.S)
    if not snippet_match:
        snippet_match = re.search(r"<a[^>]+class=['\"]result-snippet['\"][^>]*>(?P<snippet>.*?)</a>", rest, re.S)
    snippet = clean_text(snippet_match.group("snippet")) if snippet_match else ""
    domain = urllib.parse.urlparse(href).netloc.lower() or href.lower()
    key = (title.lower(), href)
    if not title or not href or key in seen:
        continue
    if not matches_filter(domain, title, snippet):
        continue
    seen.add(key)
    if title and href:
        results.append({"title": title, "url": href, "source": domain, "snippet": snippet})
    if len(results) >= limit:
        break

if not results:
    if output_format == "json":
        print(json.dumps({"query": query, "source_filter": source_filter, "results": []}))
    else:
        print("No parsed results found. The page format may have changed.")
    sys.exit(0)

if output_format == "json":
    print(json.dumps({"query": query, "source_filter": source_filter, "results": results}, ensure_ascii=True))
else:
    print(f"DuckDuckGo search results for: {query}")
    if source_filter:
        print(f"Filter: {source_filter}")
    for idx, item in enumerate(results, start=1):
        print(f"{idx}. {item['title']}")
        print(f"   Source: {item['source']}")
        print(f"   URL: {item['url']}")
        if item['snippet']:
            print(f"   Snippet: {item['snippet']}")
PY
