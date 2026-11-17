"""Make preview-demo.html: one self-contained file (demo mode, no database).
Run after build.py:  python3 make_preview.py"""
import pathlib

root = pathlib.Path(__file__).parent
d = root / "dist"
html = (d / "index.html").read_text()
html = html.replace('<link rel="stylesheet" href="app.css">',
                    "<style>\n" + (d / "app.css").read_text() + "\n</style>")
html = html.replace('<script src="config.js"></script>',
                    '<script>window.APP_CONFIG={SUPABASE_URL:"",SUPABASE_ANON_KEY:"",USERNAME_DOMAIN:"users.ha-ca-prep.app"};</script>')
for name in ("data.js", "store.js"):
    html = html.replace(f'<script src="{name}"></script>',
                        "<script>\n" + (d / name).read_text().replace("</script", "<\\/script") + "\n</script>")
# Demo mode only: load app.js inline instead of through the loader
app = (d / "app.js").read_text().replace("</script", "<\\/script")
start = html.index("<script>\n(function () {\n  var c = window.APP_CONFIG")
end = html.index("</script>", start) + len("</script>")
html = html[:start] + "<script>\n" + app + "\n</script>" + html[end:]
(root / "preview-demo.html").write_text(html)
print("preview", round(len(html) / 1e6, 2), "MB")
