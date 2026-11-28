"""Build the website into dist/. Run:  python3 build.py
Copies the app files and puts all chapter templates into index.html.
config.js is created only once, so your Supabase keys are never overwritten."""
import pathlib, shutil, hashlib

root = pathlib.Path(__file__).parent
src, dist = root / "src", root / "dist"
dist.mkdir(exist_ok=True)

for name in ("app.css", "app.js", "store.js", "data.js"):
    shutil.copy(src / name, dist / name)

for f in (src / "pwa").glob("*"):
    if f.name != "sw.js":
        shutil.copy(f, dist / f.name)

cfg = dist / "config.js"
if not cfg.exists():
    cfg.write_text(
        "// Paste your Supabase details here (see README.md). Leave empty for demo mode.\n"
        "window.APP_CONFIG = {\n"
        "  LOGIN: true,               // true = students sign in; false = open site, progress kept in this browser only\n"
        "  SUPABASE_URL: \"\",        // e.g. https://abcd1234.supabase.co\n"
        "  SUPABASE_ANON_KEY: \"\",   // the long 'anon public' key\n"
        "  USERNAME_DOMAIN: \"users.ha-ca-prep.app\" // do not change after students register\n"
        "};\n")

# ---- Chapters: one small file each, loaded only when a student opens it ----
import json, re, sys
sys.path.insert(0, str(root))
import notes

chapters = {}   # (paper, number) -> html
for m in re.finditer(r'<template id="tpl-([a-z]+)-(\d+)">(.*?)</template>', (src / "content.html").read_text(), re.S):
    chapters[(m.group(1), int(m.group(2)))] = m.group(3).strip()
# Extra papers kept as one file per chapter: src/<paper>/<paper>-NN.html
for d in ("fm", "cr", "sbm", "cs"):
    for f in sorted((src / d).glob(d + "-*.html")):
        chapters[(d, int(f.stem.split("-")[1]))] = f.read_text().strip()

def fresh(folder):
    folder.mkdir(exist_ok=True)
    for old in folder.glob("*"):
        old.unlink()
    return folder
ch_dir, cards_dir = fresh(dist / "ch"), fresh(dist / "cards")

index, search, cards = {}, {}, {}
for (p, n), html_ in sorted(chapters.items()):
    (ch_dir / f"{p}-{n}.html").write_text(html_)
    topics = notes.read_chapter(html_)
    index.setdefault(p, {})[n] = [[t["id"], t["title"]] for t in topics]
    for t in topics:
        search[t["id"]] = t["text"]
        for i, (kind, front, back) in enumerate(t["cards"]):
            cards.setdefault(p, []).append({"i": f'{t["id"]}:{kind[0]}{i}', "t": t["id"], "k": kind[0], "f": front, "b": back})
(dist / "topics.js").write_text("window.TOPIC_INDEX=" + json.dumps(index, separators=(",", ":")) + ";\n")
(dist / "search.json").write_text(json.dumps(search, separators=(",", ":")))
for p, lst in cards.items():
    (cards_dir / f"{p}.json").write_text(json.dumps(lst, separators=(",", ":")))
content = ""
html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>CAPrep</title>
<meta name="description" content="Plain-English ICAB exam notes with progress tracking, confidence marks and revision lists.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;0,900;1,400&display=swap">
<link rel="stylesheet" href="app.css">
<meta name="theme-color" content="#F37021">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="logo.svg">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<script>try{{var t=localStorage.getItem("haprep-theme");document.documentElement.setAttribute("data-theme",t||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"))}}catch(e){{}}</script>
</head>
<body>
<div id="root"><div class="loading">Loading…</div></div>
{content}
<script src="config.js"></script>
<script src="data.js"></script>
<script src="topics.js"></script>
<script src="store.js"></script>
<script>
(function () {{
  var c = window.APP_CONFIG || {{}};
  function go() {{ var s = document.createElement("script"); s.src = "app.js"; document.body.appendChild(s); }}
  if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY) {{
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js";
    s.onload = go; s.onerror = go;
    document.head.appendChild(s);
  }} else go();
  if ("serviceWorker" in navigator && /^https?:/.test(location.protocol)) {{
    window.addEventListener("load", function () {{ navigator.serviceWorker.register("sw.js").catch(function () {{}}); }});
  }}
}})();
</script>
</body>
</html>
"""
(dist / "index.html").write_text(html)
h = hashlib.sha1(html.encode())
for name in ("app.js", "app.css", "store.js", "data.js", "topics.js"):
    h.update((dist / name).read_bytes())
version = h.hexdigest()[:10]
(dist / "sw.js").write_text((src / "pwa" / "sw.js").read_text().replace("__VERSION__", version))
print("built: index.html", round(len(html) / 1e3), "KB,", len(chapters), "chapters,", sum(len(v) for v in cards.values()), "flashcards")
