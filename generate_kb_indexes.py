import os
import re

KB_ROOT = "kb"
PARTIALS_DIR = "partials"
SIDEBAR_FILE = os.path.join(PARTIALS_DIR, "sidebar.html")
TEMPLATE_FILE = "template.html"

with open(TEMPLATE_FILE, "r", encoding="utf-8") as f:
    TEMPLATE = f.read()

def titleize(name: str) -> str:
    name = name.replace("_", " ").replace("-", " ")
    return re.sub(r"\s+", " ", name).strip().title()

def list_html_files(folder):
    return sorted(
        f for f in os.listdir(folder)
        if f.endswith(".html") and f != "index.html"
    )

def generate_index(folder_path):
    folder_name = os.path.basename(folder_path)
    display_name = titleize(folder_name)

    files = list_html_files(folder_path)

    cards = []
    for file in files:
        title = titleize(file.replace(".html", ""))
        cards.append(f"""
        <a href="{file}"
           class="
             p-5 rounded-2xl
             bg-white/40 dark:bg-white/10
             glass
             border border-black/5 dark:border-white/15
             hover:bg-white/50 dark:hover:bg-white/15
             transition
           ">
          <h3 class="font-semibold text-xl">{title}</h3>
        </a>
        """)

    content = f"""
    <section class="mb-12">
      <h1 class="text-5xl font-extrabold mb-2">{display_name}</h1>
      <p class="opacity-70 text-base">Browse documents in this category.</p>
    </section>

    <section class="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {''.join(cards)}
    </section>
    """

    html = (
        TEMPLATE
        .replace("{{TITLE}}", display_name)
        .replace("{{CONTENT}}", content)
    )

    with open(os.path.join(folder_path, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

def generate_sidebar():
    categories = sorted(
        d for d in os.listdir(KB_ROOT)
        if os.path.isdir(os.path.join(KB_ROOT, d))
    )

    category_blocks = []

    for cat in categories:
        cat_title = titleize(cat)
        files = list_html_files(os.path.join(KB_ROOT, cat))

        file_links = []
        for file in files:
            title = titleize(file.replace(".html", ""))
            file_links.append(f"""
            <a href="/kb/{cat}/{file}"
               class="block px-4 py-2 rounded-md
                      text-base
                      hover:bg-black/5 dark:hover:bg-white/10 transition">
              {title}
            </a>
            """)

        category_blocks.append(f"""
        <details class="group/cat">
          <summary
            class="
              list-none cursor-pointer
              flex items-center justify-between
              px-4 py-2.5 rounded-lg
              font-semibold text-base
              hover:bg-black/5 dark:hover:bg-white/10
              transition
            ">
            <span>{cat_title}</span>
            <span class="opacity-40 transition group-open/cat:rotate-90">›</span>
          </summary>

          <div
            class="
              ml-3 pl-3 mt-1 space-y-1
              border-l border-black/10 dark:border-white/20
              grid grid-rows-[0fr] group-open/cat:grid-rows-[1fr]
              transition-[grid-template-rows] duration-300 ease-in-out
            "
          >
            <div class="overflow-hidden">
              <a href="/kb/{cat}/index.html"
                 class="block px-4 py-1.5 text-sm opacity-60 hover:opacity-100 transition">
                View all
              </a>
              {''.join(file_links)}
            </div>
          </div>
        </details>
        """)

    sidebar_html = f"""
<nav class="space-y-2 text-base">

  <a href="/"
     class="block px-4 py-2.5 rounded-lg font-semibold
            hover:bg-black/5 dark:hover:bg-white/10 transition">
    🏠 Home
  </a>

  <details class="group/kb">
    <summary
      class="
        list-none cursor-pointer
        px-4 py-2.5 rounded-lg
        font-semibold text-base
        hover:bg-black/5 dark:hover:bg-white/10
        transition
      ">
      📚 Knowledge Base
    </summary>

    <div
      class="
        ml-2 mt-1 space-y-2 pl-2
        border-l border-black/10 dark:border-white/20
        grid grid-rows-[0fr] group-open/kb:grid-rows-[1fr]
        transition-[grid-template-rows] duration-300 ease-in-out
      "
    >
      <div class="overflow-hidden">
        {''.join(category_blocks)}
      </div>
    </div>
  </details>



    <a href="/occupied-runs.html"
     class="block px-4 py-2.5 rounded-lg font-semibold
            hover:bg-black/5 dark:hover:bg-white/10 transition">
    🏘 Occupied Runs
  </a>
  
  <a href="/settings.html"
     class="block px-4 py-2.5 rounded-lg font-semibold
            hover:bg-black/5 dark:hover:bg-white/10 transition">
    ⚙️ Settings
  </a>


</nav>
"""

    os.makedirs(PARTIALS_DIR, exist_ok=True)
    with open(SIDEBAR_FILE, "w", encoding="utf-8") as f:
        f.write(sidebar_html)

for folder in os.listdir(KB_ROOT):
    full_path = os.path.join(KB_ROOT, folder)
    if os.path.isdir(full_path):
        generate_index(full_path)

generate_sidebar()

print("✅ Sidebar + index pages regenerated.")