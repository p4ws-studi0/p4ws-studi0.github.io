import os
import json
import re
from html.parser import HTMLParser

KB_ROOT = "kb"
OUTPUT_FILE = "search/index.json"

REMOVE_EXACT = "- Paws Help Site"

# -----------------------------
# SIMPLE HTML TEXT EXTRACTOR
# -----------------------------

class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.skip = False

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "nav", "aside", "header", "footer"}:
            self.skip = True

    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav", "aside", "header", "footer"}:
            self.skip = False

    def handle_data(self, data):
        if not self.skip:
            self.text.append(data)

    def get_text(self):
        return " ".join(self.text)

# -----------------------------
# CLEANING HELPERS
# -----------------------------

def clean_text(text: str) -> str:
    text = text.replace(REMOVE_EXACT, "")
    text = text.replace("_", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()

def extract_title(html: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    return clean_text(match.group(1)) if match else ""

def extract_content(html: str) -> str:
    parser = TextExtractor()
    parser.feed(html)
    return clean_text(parser.get_text())

# -----------------------------
# WALK /kb & BUILD INDEX
# -----------------------------

index = []

for root, _, files in os.walk(KB_ROOT):
    for file in files:
        if not file.endswith(".html"):
            continue

        path = os.path.join(root, file)

        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            html = f.read()

        title = extract_title(html)
        if not title:
            title = clean_text(os.path.splitext(file)[0])

        content = extract_content(html)

        if not content:
            continue

        index.append({
            "title": title,
            "url": "/" + path.replace("\\", "/"),
            "content": content
        })

# -----------------------------
# WRITE INDEX (FULL REBUILD)
# -----------------------------

os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(index, f, indent=2, ensure_ascii=False)

print(f"✅ KB search index rebuilt → {OUTPUT_FILE} ({len(index)} pages)")
