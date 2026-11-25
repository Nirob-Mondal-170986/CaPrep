"""Build the website into dist/. Run:  python3 build.py
Copies the app files and puts all chapter templates into index.html.
config.js is created only once, so your Supabase keys are never overwritten."""
import pathlib, shutil

root = pathlib.Path(__file__).parent
src, dist = root / "src", root / "dist"
dist.mkdir(exist_ok=True)

for name in ("app.css", "app.js", "store.js", "data.js"):
    shutil.copy(src / name, dist / name)

cfg = dist / "config.js"
if not cfg.exists():
    cfg.write_text(
        "// Paste your Supabase details here (see README.md). Leave empty for demo mode.\n"
        "window.APP_CONFIG = {\n"
        "  SUPABASE_URL: \"\",        // e.g. https://abcd1234.supabase.co\n"
        "  SUPABASE_ANON_KEY: \"\",   // the long 'anon public' key\n"
        "  USERNAME_DOMAIN: \"users.ha-ca-prep.app\" // do not change after students register\n"
        "};\n")

content = (src / "content.html").read_text()
# Extra papers kept as one file per chapter: src/<paper>/<paper>-NN.html
for d in ("cr", "sbm", "cs"):
    for f in sorted((src / d).glob(d + "-*.html")):
        n = int(f.stem.split("-")[1])
        content += f'\n<template id="tpl-{d}-{n}">\n' + f.read_text() + "\n</template>\n"
html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>H&amp;A CA Prep</title>
<meta name="description" content="Plain-English ICAB exam notes with progress tracking, confidence marks and revision lists.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;0,900;1,400&display=swap">
<link rel="stylesheet" href="app.css">
<script>try{{var t=localStorage.getItem("haprep-theme");document.documentElement.setAttribute("data-theme",t||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"))}}catch(e){{}}</script>
</head>
<body>
<div id="root"><div class="loading">Loading…</div></div>
{content}
<script src="config.js"></script>
<script src="data.js"></script>
<script src="store.js"></script>
<script>
(function () {{
  var c = window.APP_CONFIG || {{}};
  function go() {{ var s = document.createElement("script"); s.src = "app.js"; document.body.appendChild(s); }}
  if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY) {{
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
    s.onload = go; s.onerror = go;
    document.head.appendChild(s);
  }} else go();
}})();
</script>
</body>
</html>
"""
(dist / "index.html").write_text(html)
print("built", round(len(html) / 1e6, 2), "MB")
