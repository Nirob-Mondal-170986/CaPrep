"""Reads the chapter HTML and produces what the app needs, using only the Python standard library:
  - the topic list (id and title) for every chapter
  - plain text of each topic, for search
  - flashcards: practice questions, key points and exam traps
Used by build.py."""
import re
from html.parser import HTMLParser

VOID = {"br", "img", "hr", "input", "meta", "link", "col", "wbr", "source"}


def _cls(attrs):
    return (dict(attrs).get("class") or "").split()


class _Reader(HTMLParser):
    def __init__(self, src):
        super().__init__(convert_charrefs=True)
        self.src = src
        self.lines = [0]
        for m in re.finditer("\n", src):
            self.lines.append(m.end())
        self.stack = []            # open elements: dict(tag, kind, start)
        self.topics = []           # {id, title, text, cards}
        self.cur = None
        self.title_buf = None
        self.text = []
        self.pending_q = None
        self.skip = 0

    def _abs(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        c, d = _cls(attrs), dict(attrs)
        kind = None
        if tag == "section" and "topic" in c and d.get("id"):
            kind = "topic"
        elif "ex-q" in c:
            kind = "exq"
        elif "ex-a" in c:
            kind = "exa"
        elif tag == "div" and "box" in c and "remember" in c:
            kind = "remember"
        elif tag == "div" and "box" in c and "trap" in c:
            kind = "trap"
        elif tag == "h2" and self.cur is not None and self.cur["title"] is None:
            kind = "title"
        inner_start = self._abs() + len(self.get_starttag_text())
        el = {"tag": tag, "kind": kind, "start": inner_start, "skip": "data-top" in d}
        self.stack.append(el)
        if el["skip"]:
            self.skip += 1
        if kind == "topic":
            self.cur = {"id": d["id"], "title": None, "text": [], "cards": []}
            self.pending_q = None
        elif kind == "title":
            self.title_buf = []

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]["tag"] == tag:
                break
        else:
            return
        end_at = self._abs()
        while len(self.stack) > i:
            el = self.stack.pop()
            if el["skip"]:
                self.skip -= 1
            self._close(el, end_at)

    def _close(self, el, end_at):
        kind = el["kind"]
        if not kind or self.cur is None:
            return
        inner = self.src[el["start"]:end_at].strip()
        if kind == "title":
            self.cur["title"] = re.sub(r"\s+", " ", "".join(self.title_buf)).strip()
            self.title_buf = None
        elif kind == "exq":
            self.pending_q = inner
        elif kind == "exa":
            if self.pending_q is not None:
                self.cur["cards"].append(("q", self.pending_q, inner))
                self.pending_q = None
        elif kind in ("remember", "trap"):
            body = re.sub(r'<span class="lbl">.*?</span>', "", inner, count=1, flags=re.S).strip()
            if body:
                self.cur["cards"].append((kind, None, body))
        elif kind == "topic":
            text = " ".join(self.cur["text"])
            text = re.sub(r"\s+", " ", text)
            text = re.sub(r" ([,.;:)])", r"\1", text).strip()
            self.cur["text"] = text
            if self.cur["title"] is None:
                self.cur["title"] = self.cur["id"]
            self.topics.append(self.cur)
            self.cur = None

    def handle_data(self, data):
        if self.cur is None:
            return
        if self.title_buf is not None:
            self.title_buf.append(data)
        if not self.skip:
            self.cur["text"].append(data)


def read_chapter(html):
    """Returns a list of topics: {id, title, text, cards:[(kind, front_html_or_None, back_html)]}"""
    r = _Reader(html)
    r.feed(html)
    r.close()
    return r.topics
