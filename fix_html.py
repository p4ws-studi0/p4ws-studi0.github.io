import os
import re

ROOT_DIR = "./kb"

NEW_ASIDE = """<aside
  id="sideMenu"
  class="fixed z-30 w-64 h-screen
         bg-white/10 dark:bg-white/10 glass
         border-r border-white/10
         -translate-x-full
         pt-6 px-5"
></aside>"""

INTER_FONT_BLOCK = """<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">

<style>
  html, body {
    font-family: Inter, sans-serif;
  }
</style>
"""

STYLES_CSS_LINK = '<link rel="stylesheet" href="/styles.css">'

PATTERNS = {
    # Any Google Fonts junk
    "google_fonts": re.compile(
        r'<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>',
        re.IGNORECASE
    ),

    # Inline font-family styles
    "inline_font_family": re.compile(
        r'font-family\s*:\s*[^;"\']+',
        re.IGNORECASE
    ),

    # <font face="...">
    "font_face_attr": re.compile(
        r'\sface="[^"]+"',
        re.IGNORECASE
    ),

    # <font> tags
    "font_open": re.compile(r'<font[^>]*>', re.IGNORECASE),
    "font_close": re.compile(r'</font>', re.IGNORECASE),

    # aside block
    "aside": re.compile(
        r'<aside[^>]*id=["\']sideMenu["\'][\s\S]*?</aside>',
        re.IGNORECASE
    ),

    # styles.css link
    "styles_css": re.compile(
        r'<link[^>]+href=["\']/styles\.css["\'][^>]*>',
        re.IGNORECASE
    ),
}


def process_file(path):
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    original = html

    # Remove Google Fonts junk
    html = PATTERNS["google_fonts"].sub("", html)

    # Normalize inline font-family
    html = PATTERNS["inline_font_family"].sub(
        "font-family: Inter, sans-serif", html
    )

    # Kill <font> tags
    html = PATTERNS["font_face_attr"].sub("", html)
    html = PATTERNS["font_open"].sub("", html)
    html = PATTERNS["font_close"].sub("", html)

    # Replace aside
    html = PATTERNS["aside"].sub(NEW_ASIDE, html)

    # Inject styles.css if missing
    if not PATTERNS["styles_css"].search(html):
        html = html.replace("</head>", STYLES_CSS_LINK + "\n</head>")

    # Inject Inter font once
    if "family=Inter" not in html:
        html = html.replace("</head>", INTER_FONT_BLOCK + "\n</head>")

    if html != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"✔ Fixed: {path}")


def walk():
    for root, _, files in os.walk(ROOT_DIR):
        for file in files:
            if file.lower().endswith(".html"):
                process_file(os.path.join(root, file))


if __name__ == "__main__":
    walk()
    print("✅ All files processed.")
