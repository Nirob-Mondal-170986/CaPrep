/* CAPrep — app logic (no framework). Routes live in the URL hash:
   #/  dashboard · #/paper/<p> · #/ch/<p>/<n>[/<topic>] · #/revise · #/search · #/admin · #/admin/user/<id> */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const PAPERS = window.PAPERS, LEVELS = window.LEVELS, QUOTES = window.QUOTES;
  const CONF = ["low", "medium", "high"];
  const CONF_LABEL = { low: "Low", medium: "Medium", high: "High" };

  /* ---------- Topic index (from topics.js). Chapter text loads only when opened. ---------- */
  const TOPICS = [], BY_ID = {}, CH = {};
  Object.keys(PAPERS).forEach(p => {
    CH[p] = {};
    const tp = (window.TOPIC_INDEX || {})[p] || {};
    PAPERS[p].chapters.forEach(c => {
      const list = tp[c.n];
      if (!list) return;
      const ids = [];
      list.forEach((x, i) => {
        const t = { id: x[0], p, n: c.n, i: i + 1, title: x[1] };
        TOPICS.push(t); BY_ID[t.id] = t; ids.push(t.id);
      });
      CH[p][c.n] = { title: c.title, note: c.note, ids };
    });
  });
  const live = p => PAPERS[p].chapters.some(c => CH[p][c.n]);

  /* ---------- Loading files on demand ---------- */
  const fileCache = new Map(), fragCache = new Map();
  let viewTok = 0;   // changes on every page change, so a slow download never paints over a newer page
  function getFile(path, json) {
    if (!fileCache.has(path)) {
      const inline = window.INLINE && window.INLINE[path];
      const job = inline != null ? Promise.resolve(inline)
        : fetch(path).then(r => { if (!r.ok) throw new Error("Could not load " + path); return r.text(); });
      fileCache.set(path, job.then(t => json ? JSON.parse(t) : t).catch(e => { fileCache.delete(path); throw e; }));
    }
    return fileCache.get(path);
  }
  function chapterFrag(p, n) {
    const k = p + "-" + n;
    if (!fragCache.has(k)) {
      fragCache.set(k, getFile("ch/" + k + ".html").then(html => { const t = document.createElement("template"); t.innerHTML = html; return t.content; }).catch(e => { fragCache.delete(k); throw e; }));
    }
    return fragCache.get(k);
  }
  const loadErr = (what, retry) => `<div class="panel empty"><b>Could not load ${what}</b><span>Check your internet connection and try again.</span><button class="btn ghost sm" id="${retry}">Try again</button></div>`;

  /* ---------- State ---------- */
  let store = null, me = null, prog = {}, OPEN = true;
  const pending = new Map();
  let flushTimer = null, saving = false;

  function stats(ids) {
    const s = { total: ids.length, read: 0, high: 0, medium: 0, low: 0, none: 0 };
    ids.forEach(id => { const r = prog[id]; if (r && r.r) s.read++; const c = r && r.c; if (c) s[c]++; else s.none++; });
    s.pct = s.total ? Math.round(s.read / s.total * 100) : 0;
    return s;
  }
  const paperIds = p => TOPICS.filter(t => t.p === p).map(t => t.id);
  const allIds = () => TOPICS.map(t => t.id);

  /* ---------- My subjects (the dashboard shows only these) ---------- */
  const SUBJ_KEY = "haprep-subjects-v1";
  let MY = [];
  const subjKey = () => SUBJ_KEY + (!OPEN && me ? ":" + me.id : "");
  /* Subjects come from the account (so they follow the student to every device), with this browser as a backup. */
  function loadMy() {
    if (me && Array.isArray(me.subjects) && me.subjects.length) { MY = me.subjects.slice(); return; }
    try { MY = JSON.parse(localStorage.getItem(subjKey()) || "[]"); if (!Array.isArray(MY)) MY = []; } catch (e) { MY = []; }
    if (MY.length && store && store.saveSubjects && me) store.saveSubjects(me.id, MY).catch(() => {});
  }
  const saveMy = () => {
    try { localStorage.setItem(subjKey(), JSON.stringify(MY)); } catch (e) {}
    if (me) me.subjects = MY.slice();
    if (store && store.saveSubjects && me) store.saveSubjects(me.id, MY).catch(() => toast("Subjects saved on this device only. Update the database (see the setup guide) to sync them."));
  };
  const myPapers = () => MY.filter(p => PAPERS[p] && live(p));
  const myIds = () => myPapers().flatMap(paperIds);

  /* ---------- Exam dates (one per subject) ---------- */
  const DAY = 864e5, EXAM_KEY = "haprep-exams-v1";
  let EXAMS = {};
  const examKey = () => EXAM_KEY + (!OPEN && me ? ":" + me.id : "");
  function loadExams() {
    if (me && me.exam_dates && Object.keys(me.exam_dates).length) { EXAMS = Object.assign({}, me.exam_dates); return; }
    try { EXAMS = JSON.parse(localStorage.getItem(examKey()) || "{}") || {}; } catch (e) { EXAMS = {}; }
    if (Object.keys(EXAMS).length && store && store.saveExamDates && me) store.saveExamDates(me.id, EXAMS).catch(() => {});
  }
  function saveExams() {
    try { localStorage.setItem(examKey(), JSON.stringify(EXAMS)); } catch (e) {}
    if (me) me.exam_dates = Object.assign({}, EXAMS);
    if (store && store.saveExamDates && me) store.saveExamDates(me.id, EXAMS).catch(() => toast("Exam dates saved on this device only. Update the database (see the setup guide) to sync them."));
  }
  const daysTo = str => { const [y, m, d] = str.split("-").map(Number), t = new Date(); return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / DAY); };
  function nextExam() {
    let best = null;
    myPapers().forEach(p => { if (!EXAMS[p]) return; const d = daysTo(EXAMS[p]); if (d >= 0 && (!best || d < best.d)) best = { p, d }; });
    return best;
  }
  function nextExamChip() {
    const ne = nextExam();
    return ne ? `<span class="chip next-exam">⏳ ${esc(PAPERS[ne.p].short)} exam ${ne.d === 0 ? "is today" : "in " + plural(ne.d, "day")}</span>` : "";
  }
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  function examRowsHTML() {
    return myPapers().map(p => {
      const v = EXAMS[p] || "", dl = v ? daysTo(v) : null, s = stats(paperIds(p)), left = s.total - s.read;
      let info = "Pick your exam date to get a daily reading target.", badge = "";
      if (dl !== null) {
        if (dl < 0) { badge = `<span class="days past">Passed</span>`; info = "This exam date has passed. Pick a new date or clear it."; }
        else if (dl === 0) { badge = `<span class="days hot"><b>Today</b></span>`; info = "Exam day. You have prepared well. Good luck!"; }
        else {
          const study = Math.max(1, Math.floor(dl * 0.8)), per = Math.ceil(left / study), rev = dl - study;
          badge = `<span class="days ${dl <= 14 ? "hot" : ""}"><b>${dl}</b> day${dl === 1 ? "" : "s"} left</span>`;
          info = left ? `Read about <b>${plural(per, "topic")}</b> a day (${left} left to read)${rev > 0 ? " and keep the last " + plural(rev, "day") + " for revision" : ""}.` : "Every topic is read. Spend your time on the Low and Medium ones.";
        }
      }
      return `<div class="exam-row"><div class="exam-name"><b>${esc(PAPERS[p].short)}</b><span>${info}</span></div>
        <div class="exam-ctl">${badge}<input type="date" class="input" data-exam="${p}" value="${esc(v)}" aria-label="Exam date for ${esc(PAPERS[p].short)}">${v ? `<button class="btn ghost sm" data-clear="${p}">Clear</button>` : ""}</div></div>`;
    }).join("");
  }

  /* ---------- Saving ---------- */
  function setTopic(id, patch) {
    const t = BY_ID[id]; if (!t) return;
    const before = snapshotCounts(id);
    const cur = prog[id] || { r: false, c: null };
    const next = Object.assign({}, cur, patch, { at: new Date().toISOString() });
    prog[id] = next;
    pending.set(id, { t: id, p: t.p, n: t.n, r: !!next.r, c: next.c || null });
    scheduleFlush();
    if (patch.c !== undefined && patch.c !== cur.c && patch.c) log("confidence", { t: id, c: patch.c });
    else if (patch.r !== undefined && patch.r !== cur.r) log(patch.r ? "read" : "unread", { t: id });
    afterChange(id, before);
  }
  /* Student looked at a topic again: remember when, so the smart plan knows when it is due next. */
  function touchTopic(id) {
    const t = BY_ID[id]; if (!t) return;
    const cur = prog[id] || { r: false, c: null };
    prog[id] = Object.assign({}, cur, { r: true, at: new Date().toISOString() });
    pending.set(id, { t: id, p: t.p, n: t.n, r: true, c: prog[id].c || null });
    scheduleFlush(); log("reviewed", { t: id }); refreshProgressUI(id);
  }
  function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 700); syncState("saving"); }
  async function flush() {
    if (saving || !pending.size) return;
    saving = true;
    const rows = [...pending.values()]; pending.clear();
    try { await store.saveTopics(me.id, rows); syncState("ok"); }
    catch (e) { rows.forEach(r => { if (!pending.has(r.t)) pending.set(r.t, r); }); syncState("err"); setTimeout(scheduleFlush, 5000); }
    saving = false;
    if (pending.size) scheduleFlush();
  }
  window.addEventListener("beforeunload", e => { if (pending.size) { flush(); e.preventDefault(); e.returnValue = ""; } });
  function syncState(s) {
    const el = $("#sync"); if (!el) return;
    el.textContent = s === "saving" ? "Saving…" : s === "err" ? "Not saved yet: will retry" : (store.mode === "demo" ? "Saved on this device" : "All changes saved");
  }
  const logged = new Set();
  function log(kind, detail, onceKey) {
    if (onceKey) { if (logged.has(onceKey)) return; logged.add(onceKey); }
    store.log(me.id, kind, detail).catch(() => {});
  }

  /* ---------- Milestones and quotes ---------- */
  const TOTAL_STEPS = [1, 10, 25, 50, 100, 150, 200, 300, 400, 500, 600, 700];
  const HIGH_STEPS = [10, 50, 100, 250, 500];
  function snapshotCounts(id) {
    const t = BY_ID[id];
    return { all: stats(myIds()), paper: stats(paperIds(t.p)), ch: stats(CH[t.p][t.n].ids) };
  }
  function afterChange(id, before) {
    const t = BY_ID[id], all = stats(myIds()), paper = stats(paperIds(t.p)), ch = stats(CH[t.p][t.n].ids);
    let ms = null;
    const crossed = (steps, a, b) => steps.filter(s => a < s && b >= s).pop();
    const tot = crossed(TOTAL_STEPS.concat([all.total]), before.all.read, all.read);
    if (tot) ms = { icon: tot >= all.total ? "🏆" : "⭐", title: tot >= all.total ? "Every topic read!" : (tot === 1 ? "Your first topic is done!" : tot + " topics read!"), text: tot === 1 ? "Every expert started with one page. Keep going." : "You have now read " + all.read + " of " + all.total + " topics across all papers." };
    const pp = crossed([25, 50, 75, 100], before.paper.pct, paper.pct);
    if (!ms && pp) ms = { icon: pp === 100 ? "🎓" : "📈", title: pp === 100 ? PAPERS[t.p].short + " complete!" : pp + "% of " + PAPERS[t.p].short, text: pp === 100 ? "You have read every topic in this paper. Now revise your Low and Medium topics." : "You are " + pp + "% through " + PAPERS[t.p].name + "." };
    const hi = crossed(HIGH_STEPS, before.all.high, all.high);
    if (!ms && hi) ms = { icon: "💪", title: hi + " topics at High confidence", text: "Your strong topics are growing. Spend your next session on the Low ones." };
    if (ms) { celebrate(ms); log("milestone", { text: ms.title }); }
    else if (before.ch.read < ch.total && ch.read === ch.total) toast("Chapter " + t.n + " finished. Well done!");
    refreshProgressUI(id);
  }
  function quoteFor(seed) { return QUOTES[Math.abs(seed) % QUOTES.length]; }
  function celebrate(ms) {
    const q = quoteFor(Date.now() / 1000 | 0);
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="ms-t">
      <div class="medal" aria-hidden="true">${ms.icon}</div>
      <h2 id="ms-t">${esc(ms.title)}</h2><p class="muted">${esc(ms.text)}</p>
      <q>${esc(q.q)}</q><cite>— ${esc(q.a)}</cite>
      <button class="btn" id="ms-ok">Keep going</button></div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    $("#ms-ok", bg).onclick = close; $("#ms-ok", bg).focus();
    bg.onclick = e => { if (e.target === bg) close(); };
    bg.onkeydown = e => { if (e.key === "Escape") close(); };
  }
  let toastT = null;
  function toast(msg) {
    let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------- Helpers for UI ---------- */
  const ICON = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    rev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M5 15a8 8 0 0 0 14 2M19 9A8 8 0 0 0 5 7"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/></svg>'
  };
  function confbar(s) {
    if (!s.total) return `<div class="confbar"></div>`;
    const w = k => (s[k] / s.total * 100).toFixed(2) + "%";
    return `<div class="confbar" role="img" aria-label="High ${s.high}, Medium ${s.medium}, Low ${s.low}, not rated ${s.none}"><i class="h" style="width:${w("high")}"></i><i class="m" style="width:${w("medium")}"></i><i class="l" style="width:${w("low")}"></i><i class="u" style="width:${w("none")}"></i></div>`;
  }
  const legend = s => `<div class="legend"><span><i style="background:var(--hi)"></i>High ${s.high}</span><span><i style="background:var(--md)"></i>Medium ${s.medium}</span><span><i style="background:var(--lo)"></i>Low ${s.low}</span><span><i style="background:var(--line-strong)"></i>Not rated ${s.none}</span></div>`;
  const bar = pct => `<span class="bar-prog" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
  function ago(iso) {
    if (!iso) return "never";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
    return new Date(iso).toLocaleDateString();
  }
  const fmtDate = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
  const lastKey = () => "haprep-last-" + me.id;
  const getLast = () => { try { return JSON.parse(localStorage.getItem(lastKey())); } catch (e) { return null; } };
  const setLast = v => { try { localStorage.setItem(lastKey(), JSON.stringify(v)); } catch (e) {} };

  /* ---------- Theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("haprep-theme", t); } catch (e) {}
  }
  (function () {
    let t = null; try { t = localStorage.getItem("haprep-theme"); } catch (e) {}
    applyTheme(t || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  })();

  const LOGO = '<img class="mark" alt="" width="42" height="42" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop offset=%220%22 stop-color=%22%23FF9A4D%22/%3E%3Cstop offset=%221%22 stop-color=%22%23E4570C%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%2264%22 height=%2264%22 rx=%2216%22 fill=%22url(%23g)%22/%3E%3Cpath d=%22M40.5 20.2A15.5 15.5 0 1 0 40.5 43.8%22 fill=%22none%22 stroke=%22%23fff%22 stroke-width=%227%22 stroke-linecap=%22round%22/%3E%3Cpath d=%22M27 33l6.5 6.5L48.5 24%22 fill=%22none%22 stroke=%22%23121A23%22 stroke-width=%226%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E">';
  const WORD = '<span class="word"><b>CA<em>Prep</em></b><small>ICAB exam notes</small></span>';

  /* ---------- Auth screen ---------- */
  function renderAuth(mode) {
    mode = mode || "in";
    document.title = "Sign in · CAPrep";
    $("#root").innerHTML = `
    <div class="auth">
      <div class="auth-art">
        <div style="position:relative;z-index:1">
          <a class="brand" href="#/">${LOGO}${WORD}</a>
          <h1 style="margin-top:44px">Study smarter for every ICAB paper.</h1>
          <p class="lead">Plain-English notes for the Professional and Advance Levels, with your progress and confidence saved to your account.</p>
        </div>
        <div class="auth-feats">
          <div><i>✓</i><p><b>Track every topic</b><span>Mark topics as read and see your progress by paper and chapter.</span></p></div>
          <div><i>◆</i><p><b>Rate your confidence</b><span>Mark each section High, Medium or Low, then revise only the weak ones.</span></p></div>
          <div><i>★</i><p><b>Stay motivated</b><span>Milestones and quotes as you move through the syllabus.</span></p></div>
        </div>
      </div>
      <div class="auth-main">
        <form class="auth-card" id="auth-form" novalidate>
          <div class="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected="${mode === "in"}" data-mode="in">Sign in</button>
            <button type="button" role="tab" aria-selected="${mode === "up"}" data-mode="up">Create account</button>
          </div>
          <div style="display:grid;gap:6px"><h2>${mode === "in" ? "Welcome back" : "Create your account"}</h2>
            <p class="muted">${mode === "in" ? "Sign in with your username and password." : "Just a username and a password. No email needed."}</p></div>
          <div class="field"><label for="u">Username</label>
            <input id="u" name="u" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="20" placeholder="e.g. rahim_ca">
            ${mode === "up" ? `<small>3–20 characters: lowercase letters, numbers or _</small>` : ""}</div>
          <div class="field"><label for="pw">Password</label>
            <input id="pw" name="pw" type="password" autocomplete="${mode === "in" ? "current-password" : "new-password"}" required minlength="6">
            ${mode === "up" ? `<small>At least 6 characters</small>` : ""}</div>
          ${mode === "up" ? `<div class="field"><label for="pw2">Confirm password</label><input id="pw2" type="password" autocomplete="new-password" required></div>` : ""}
          <div class="form-err" id="err" role="alert" hidden></div>
          <button class="btn block" id="go" type="submit">${mode === "in" ? "Sign in" : "Create account"}</button>
          ${store.mode === "demo" ? `<div class="demo-note"><b>Demo mode.</b> Accounts and progress are saved only in this browser until the site owner connects the database. The first account created here becomes the admin.</div>` : `<p class="muted" style="font-size:.86rem">Forgot your password? Ask the site admin to reset it.</p>`}
        </form>
      </div>
    </div>`;
    $$(".auth-tabs button").forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
    $("#u").focus();
    $("#u").addEventListener("input", e => { e.target.value = e.target.value.toLowerCase().replace(/\s/g, ""); });
    $("#auth-form").onsubmit = async e => {
      e.preventDefault();
      const u = $("#u").value.trim().toLowerCase(), p = $("#pw").value, err = $("#err"), go = $("#go");
      const fail = m => { err.textContent = m; err.hidden = false; };
      err.hidden = true;
      if (!window.Stores.USERNAME_RE.test(u)) return fail("Username must be 3–20 characters: lowercase letters, numbers or _.");
      if (p.length < 6) return fail("Password must be at least 6 characters.");
      if (mode === "up" && p !== $("#pw2").value) return fail("The two passwords do not match.");
      go.disabled = true; go.textContent = mode === "in" ? "Signing in…" : "Creating account…";
      try {
        me = mode === "in" ? await store.signIn(u, p) : await store.signUp(u, p);
        await enterApp(mode === "in" ? "login" : "signup");
      } catch (x) { fail(x.message); go.disabled = false; go.textContent = mode === "in" ? "Sign in" : "Create account"; }
    };
  }

  /* ---------- App shell ---------- */
  async function enterApp(evt) {
    $("#root").innerHTML = `<div class="loading">Loading your progress…</div>`;
    prog = {}; cardState = null; loadMy(); loadExams();
    try {
      const rows = await store.myProgress(me.id);
      rows.forEach(r => { prog[r.topic_id] = { r: !!r.is_read, c: r.confidence || null, at: r.updated_at }; });
    } catch (e) { toast("Could not load your progress. " + e.message); }
    if (evt) log(evt, null);
    store.touch(me.id).catch(() => {});
    setInterval(() => store.touch(me.id).catch(() => {}), 5 * 60 * 1000);
    renderShell();
    setTimeout(prefetchNotes, 5000);
    if (!location.hash || location.hash === "#") location.hash = "#/";
    route();
  }
  /* Quietly saves the chapters of the student's subjects, so they open without internet. */
  function prefetchNotes() {
    if (window.INLINE || !navigator.onLine || (navigator.connection && navigator.connection.saveData)) return;
    const jobs = []; myPapers().forEach(p => Object.keys(CH[p]).forEach(n => jobs.push("ch/" + p + "-" + n + ".html")));
    let i = 0;
    const next = () => { if (i >= jobs.length) return; fetch(jobs[i++]).catch(() => {}).then(() => setTimeout(next, 200)); };
    next(); next();
  }
  function renderShell() {
    $("#root").innerHTML = `
    <div class="app" id="app">
      <div class="topbar"><a class="brand" href="#/">${LOGO}<span class="word"><b>CA<em>Prep</em></b></span></a><button class="menu-btn" id="menu" aria-expanded="false" aria-controls="side">Menu</button></div>
      <aside class="side" id="side" aria-label="Main navigation"></aside>
      <main class="main" id="main"><div class="page" id="view"></div></main>
    </div>`;
    $("#menu").onclick = () => toggleNav();
    $("#side").addEventListener("click", e => { if (e.target.closest("a")) toggleNav(false); });
  }
  function toggleNav(force) {
    const app = $("#app"), open = force === undefined ? !app.classList.contains("nav-open") : force;
    app.classList.toggle("nav-open", open); $("#menu").setAttribute("aria-expanded", String(open));
  }
  function renderSide(cur) {
    const a = (href, key, ico, label, meta) => `<a href="${href}" ${cur === key ? 'aria-current="page"' : ""}><span class="ico">${ico}</span><span>${label}</span>${meta || ""}</a>`;
    const low = stats(myIds()).low, mine = myPapers();
    $("#side").innerHTML = `
      <a class="brand" href="#/">${LOGO}${WORD}</a>
      <nav class="nav">
        ${a("#/", "home", ICON.home, "Dashboard")}
        ${a("#/revise", "revise", ICON.rev, "Revise", low ? `<span class="meta" title="Low-confidence topics">${low} low</span>` : "")}
        ${a("#/cards", "cards", ICON.cards, "Flashcards")}
        ${a("#/search", "search", ICON.search, "Search notes")}
        ${!OPEN && me.is_admin ? a("#/admin", "admin", ICON.admin, "Admin panel") : ""}
      </nav>
      ${mine.length ? `<nav class="nav" aria-label="My subjects"><div class="nav-h">My subjects</div>
        ${mine.map(p => { const P = PAPERS[p], st = stats(paperIds(p)); return `<a href="#/paper/${p}" ${cur === "p-" + p ? 'aria-current="page"' : ""}><span class="ico">${ICON.book}</span><span>${esc(P.short)}</span><span class="meta">${st.pct}%</span><span class="mini"><i style="width:${st.pct}%"></i></span></a>`; }).join("")}
        <a href="#/subjects" ${cur === "subjects" ? 'aria-current="page"' : ""}><span class="ico">${ICON.rev}</span><span>Change my subjects</span></a></nav>` : ""}
      ${LEVELS.map(L => { const rest = L.papers.filter(p => !mine.includes(p)); if (!rest.length) return ""; return `<nav class="nav" aria-label="${esc(L.name)}"><div class="nav-h">${esc(mine.length ? "Other " : "")}${esc(L.name)}</div>
        ${rest.map(p => { const P = PAPERS[p]; return `<a href="#/paper/${p}" ${cur === "p-" + p ? 'aria-current="page"' : ""}><span class="ico">${ICON.book}</span><span>${esc(P.short)}</span>${live(p) ? "" : '<span class="soon">Soon</span>'}</a>`; }).join("")}</nav>`; }).join("")}
      <div class="side-foot">
        ${OPEN ? "" : `<div class="me"><span class="avatar">${esc(me.username.slice(0, 2))}</span><span><b>${esc(me.username)}</b><small>${me.is_admin ? "Admin" : "Student"}${store.mode === "demo" ? " · demo" : ""}</small></span></div>`}
        <div class="sync" id="sync">${OPEN ? "Progress is saved in this browser" : store.mode === "demo" ? "Saved on this device" : "All changes saved"}</div>
        <div class="side-actions"><button id="theme">${document.documentElement.dataset.theme === "dark" ? "Light mode" : "Dark mode"}</button><button id="out">${OPEN ? "Reset progress" : "Sign out"}</button></div>
      </div>`;
    $("#theme").onclick = () => { applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); renderSide(cur); };
    $("#out").onclick = async () => {
      if (OPEN) {
        if (!confirm("Erase all your read ticks and confidence marks in this browser? This cannot be undone.")) return;
        await flush(); await store.resetMine(me.id); prog = {}; location.hash = "#/"; renderSide("home"); route(); return;
      }
      await flush(); await store.signOut(); me = null; location.hash = "#/"; renderAuth("in");
    };
  }

  /* ---------- Router ---------- */
  let current = "";
  function route() {
    if (!me) return;
    let h = location.hash.slice(1) || "/";
    const legacy = h.match(/^(law|tax|fm|far|aa)(?:-(\d+)(?:\/([\w-]+))?)?$/);
    if (legacy) { location.replace(legacy[2] ? `#/ch/${legacy[1]}/${legacy[2]}${legacy[3] ? "/" + legacy[3] : ""}` : `#/paper/${legacy[1]}`); return; }
    const [path, qs] = h.split("?");
    const parts = path.split("/").filter(Boolean);
    const params = new URLSearchParams(qs || "");
    window.scrollTo(0, 0);
    if (spy) { spy.disconnect(); spy = null; }
    viewTok++;
    if (cardKeys) { document.removeEventListener("keydown", cardKeys); cardKeys = null; }
    if (!parts.length) { current = "home"; renderSide("home"); return viewHome(); }
    if (parts[0] === "paper" && PAPERS[parts[1]]) { current = "p-" + parts[1]; renderSide(current); return viewPaper(parts[1]); }
    if (parts[0] === "ch" && PAPERS[parts[1]] && CH[parts[1]][+parts[2]]) { current = "p-" + parts[1]; renderSide(current); return viewChapter(parts[1], +parts[2], parts[3]); }
    if (parts[0] === "subjects") { current = "subjects"; renderSide("subjects"); return viewSubjects(); }
    if (parts[0] === "revise") { current = "revise"; renderSide("revise"); return viewRevise(params); }
    if (parts[0] === "cards") { current = "cards"; renderSide("cards"); return viewCards(params); }
    if (parts[0] === "search") { current = "search"; renderSide("search"); return viewSearch(params.get("q") || ""); }
    if (parts[0] === "admin" && !OPEN && me.is_admin) { current = "admin"; renderSide("admin"); return parts[1] === "user" ? viewAdminUser(parts[2]) : viewAdmin(); }
    location.replace("#/");
  }
  window.addEventListener("hashchange", route);
  function refreshProgressUI(id) {
    if (current) renderSide(current);
    const t = BY_ID[id];
    $$(`.toc-item[data-id="${id}"]`).forEach(el => paintToc(el, id));
    $$(`[data-foot="${id}"]`).forEach(f => paintFoot(f, id));
    $$(`[data-pill="${id}"]`).forEach(el => { el.outerHTML = pill(id, true); });
    const pr = $("#ch-prog");
    if (pr && t) { const s = stats(CH[t.p][t.n].ids); pr.textContent = s.read + "/" + s.total + " read"; }
    const sum = $("#ch-sum"); if (sum && t) sum.innerHTML = chSummary(t.p, t.n);
  }
  const pill = (id, tagged) => { const c = prog[id] && prog[id].c; return `<span class="pill ${c || "none"}" ${tagged ? `data-pill="${id}"` : ""}>${c ? CONF_LABEL[c] : "Not rated"}</span>`; };

  /* ---------- Dashboard ---------- */
  function viewHome() {
    document.title = "Dashboard · CAPrep";
    if (!myPapers().length) return viewSubjects(true);
    const s = stats(myIds()), hr = new Date().getHours();
    const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const last = getLast(); const lastOk = last && CH[last.p] && CH[last.p][last.n];
    const stepIdx = TOTAL_STEPS.filter(x => s.read >= x).length;
    const q = quoteFor(stepIdx * 7 + new Date().getDate());
    const R = 78, C = 2 * Math.PI * R;
    const next = TOTAL_STEPS.find(x => x > s.read);
    const dueNow = smartList(smartPool("all")).length;
    $("#view").innerHTML = `
      <div class="hello"><div class="page-head"><span class="eyebrow">${new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</span>
        <h1>${OPEN ? greet : `${greet}, ${esc(me.username)}`}</h1><p>${s.read ? `You have read ${s.read} of ${s.total} topics in your ${myPapers().length === 1 ? "subject" : myPapers().length + " subjects"}. ${next ? `${next - s.read} more to your next milestone.` : ""}` : "Open one of your subjects below and read your first topic to get started."}</p><span id="ne-slot" style="justify-self:start">${nextExamChip()}</span></div>
        <div class="hello-btns"><a class="btn" href="#/revise">Today's revision${dueNow ? " (" + dueNow + ")" : ""}</a><a class="btn ghost" href="#/cards">Flashcards</a></div></div>
      <div class="stats">
        <a class="stat" href="#/revise?c=all"><span class="v">${s.read}<span class="muted" style="font-size:1rem"> / ${s.total}</span></span><span class="k">Topics read</span></a>
        <a class="stat hi" href="#/revise?c=high"><span class="v">${s.high}</span><span class="k">High confidence</span></a>
        <a class="stat md" href="#/revise?c=medium"><span class="v">${s.medium}</span><span class="k">Medium confidence</span></a>
        <a class="stat lo" href="#/revise?c=low"><span class="v">${s.low}</span><span class="k">Low confidence</span></a>
      </div>
      <div class="panel" id="exam-panel"><div class="panel-h"><h3>Exam countdown</h3><span class="muted">Set a date for each subject</span></div><div id="exam-rows">${examRowsHTML()}</div></div>
      <div class="panel overview">
        <div class="ring" aria-label="${s.pct}% of your topics read"><svg viewBox="0 0 180 180"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFA35E"/><stop offset="1" stop-color="#E4570C"/></linearGradient></defs><circle cx="90" cy="90" r="${R}" fill="none" stroke="var(--slate-soft)" stroke-width="16"/><circle cx="90" cy="90" r="${R}" fill="none" stroke="url(#rg)" stroke-width="16" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - s.pct / 100)}"/></svg><div class="c"><div><b>${s.pct}%</b><span>of your notes</span></div></div></div>
        <div style="display:grid;gap:14px;min-width:0">
          <h3>Your confidence in your subjects</h3>${confbar(s)}${legend(s)}
          ${lastOk ? `<div class="resume" style="border-top:1px solid var(--line);padding-top:14px"><div><b>Continue reading</b><br><span>${esc(PAPERS[last.p].short)} · Chapter ${last.n}: ${esc(CH[last.p][last.n].title)}</span></div><a class="btn ghost" href="#/ch/${last.p}/${last.n}">Open chapter →</a></div>` : ""}
        </div>
      </div>
      <div class="quote"><span class="eyebrow">${stepIdx ? "Milestone " + stepIdx + " reached" : "Today's thought"}</span><q>${esc(q.q)}</q><cite>— ${esc(q.a)}</cite></div>
      <form class="search" id="qs" role="search"><label for="q" class="muted" style="font-weight:700;display:block;margin-bottom:6px">Search notes</label><input id="q" type="search" placeholder="Try: deferred tax, IFRS 16, ISA 570, VAT rebate, s.85" autocomplete="off"></form>
      <div class="levels"><div class="level-h"><h2>My subjects</h2><a class="btn ghost sm" href="#/subjects">Change my subjects</a></div>
        <div class="papers">${myPapers().map(paperCard).join("")}</div></div>`;
    const ep = $("#exam-panel");
    const redo = () => { $("#exam-rows").innerHTML = examRowsHTML(); $("#ne-slot").innerHTML = nextExamChip(); };
    ep.onchange = e => { const i = e.target.closest("[data-exam]"); if (!i) return; if (i.value) EXAMS[i.dataset.exam] = i.value; else delete EXAMS[i.dataset.exam]; saveExams(); redo(); };
    ep.onclick = e => { const b = e.target.closest("[data-clear]"); if (!b) return; delete EXAMS[b.dataset.clear]; saveExams(); redo(); };
    $("#qs").onsubmit = e => { e.preventDefault(); location.hash = "#/search?q=" + encodeURIComponent($("#q").value); };
  }
  function viewSubjects(first) {
    document.title = "My subjects · CAPrep";
    const chosen = new Set(myPapers());
    $("#view").innerHTML = `
      <div class="page-head"><span class="eyebrow">${first ? "Welcome" : "Settings"}</span><h1>${first ? "Choose your subjects" : "My subjects"}</h1>
        <p>Tick the subjects you are studying. Your dashboard will show progress for these subjects only. You can change this at any time.</p></div>
      ${LEVELS.map(L => `<div class="panel" style="display:grid;gap:10px"><div class="level-h"><h2>${esc(L.name)}</h2></div>
        ${L.papers.map(p => { const P = PAPERS[p], ok = live(p);
          return `<label class="subj" style="display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:10px;${ok ? "cursor:pointer" : "opacity:.55"}">
            <input type="checkbox" value="${p}" ${chosen.has(p) ? "checked" : ""} ${ok ? "" : "disabled"} style="width:20px;height:20px;accent-color:var(--brand)">
            <span style="flex:1;min-width:0"><b>${esc(P.name)}</b><br><span class="muted" style="font-size:.88rem">${ok ? P.chapters.length + " chapters" : "Coming soon"}</span></span></label>`; }).join("")}</div>`).join("")}
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="savesub">Save and open dashboard</button>${first ? "" : '<a class="btn ghost" href="#/">Cancel</a>'}</div>
      <p class="muted" id="subnote"></p>`;
    $("#savesub").onclick = () => {
      const pick = Array.from(document.querySelectorAll("#view input[type=checkbox]:checked")).map(i => i.value);
      if (!pick.length) { $("#subnote").textContent = "Please tick at least one subject."; return; }
      MY = pick; saveMy(); location.hash = "#/"; renderSide("home"); route();
    };
  }
  function paperCard(p) {
    const P = PAPERS[p];
    if (!live(p)) return `<a class="paper soon" href="#/paper/${p}"><div class="top"><span class="code">${esc(P.code)}</span><span class="chip plain">Coming soon</span></div><h3>${esc(P.name)}</h3><span class="meta">${esc(P.blurb || "")}</span></a>`;
    const s = stats(paperIds(p));
    return `<a class="paper" href="#/paper/${p}"><div class="top"><span class="code">${esc(P.code)}</span><span class="chip">${s.pct}%</span></div><h3>${esc(P.name)}</h3>
      <span class="meta">${P.chapters.length} chapters · ${s.read}/${s.total} topics read</span>${bar(s.pct)}${confbar(s)}</a>`;
  }

  /* ---------- Paper ---------- */
  function viewPaper(p) {
    const P = PAPERS[p];
    document.title = P.short + " · CAPrep";
    if (!live(p)) {
      $("#view").innerHTML = `<div class="crumbs"><a href="#/">Dashboard</a><span>/</span><span>${esc(P.short)}</span></div>
        <div class="page-head"><span class="eyebrow">${esc(P.code)} · ${esc(P.level)}</span><h1>${esc(P.name)}</h1><p>${esc(P.blurb || "")}</p></div>
        <div class="soon-box"><h3>Notes are on the way</h3><p class="muted">This paper is being prepared from the ICAB study manual and past papers. It will appear here, with progress tracking and confidence marks, as soon as it is ready.</p></div>`;
      return;
    }
    const s = stats(paperIds(p));
    $("#view").innerHTML = `
      <div class="crumbs"><a href="#/">Dashboard</a><span>/</span><span>${esc(P.short)}</span></div>
      <div class="page-head"><span class="eyebrow">${esc(P.code)} · ${esc(P.source || P.level)}</span><h1>${esc(P.name)}</h1></div>
      <div class="panel" style="display:grid;gap:12px"><div class="panel-h" style="margin:0"><b>${s.read} of ${s.total} topics read · ${s.pct}%</b><a class="btn ghost sm" href="#/revise?c=low&p=${p}">Revise Low topics in this paper</a></div>${bar(s.pct)}${confbar(s)}${legend(s)}</div>
      <div class="ch-list">${P.chapters.map(c => {
        const ok = CH[p][c.n];
        if (!ok) return `<div class="ch-row soon"><span class="n">${c.n}</span><span class="t"><b>${esc(c.title)}</b><span>Notes coming soon</span></span><span class="r"><span class="chip plain">Soon</span></span></div>`;
        const cs = stats(ok.ids);
        return `<a class="ch-row" href="#/ch/${p}/${c.n}"><span class="n">${c.n}</span><span class="t"><b>${esc(c.title)}</b><span>${c.note ? esc(c.note) + " · " : ""}${cs.total} topics</span></span><span class="r">${cs.read}/${cs.total} read${confbar(cs)}</span></a>`;
      }).join("")}</div>`;
  }

  /* ---------- Chapter reader ---------- */
  let spy = null;
  function footHTML(id) {
    return `<div class="topic-foot" data-foot="${id}">
      <button class="read-btn" data-act="read" aria-pressed="false">Mark as read</button>
      <div class="conf"><span>Confidence:</span><div class="seg" role="group" aria-label="Confidence for this topic">${CONF.map(c => `<button data-c="${c}" aria-pressed="false">${CONF_LABEL[c]}</button>`).join("")}</div></div>
    </div>`;
  }
  function paintFoot(f, id) {
    const r = prog[id] || {};
    const rb = $(".read-btn", f); rb.setAttribute("aria-pressed", String(!!r.r)); rb.textContent = r.r ? "Read" : "Mark as read";
    $$(".seg button", f).forEach(b => b.setAttribute("aria-pressed", String(r.c === b.dataset.c)));
  }
  function wireFoot(f, id) {
    $(".read-btn", f).onclick = () => setTopic(id, { r: !(prog[id] && prog[id].r) });
    $$(".seg button", f).forEach(b => b.onclick = () => {
      const cur = prog[id] && prog[id].c;
      setTopic(id, cur === b.dataset.c ? { c: null } : { c: b.dataset.c, r: true });
    });
    paintFoot(f, id);
  }
  function paintToc(el, id) {
    const r = prog[id] || {};
    el.classList.toggle("read", !!r.r);
    CONF.forEach(c => el.classList.toggle("c-" + c, r.c === c));
  }
  function decorateTopic(sec) {
    const id = sec.id;
    $$("[data-top]", sec).forEach(b => b.remove());
    sec.insertAdjacentHTML("beforeend", footHTML(id));
    wireFoot($(`[data-foot="${id}"]`, sec), id);
  }
  function chSummary(p, n) {
    const s = stats(CH[p][n].ids);
    return `<div style="display:grid;gap:10px"><b>${s.read} of ${s.total} topics read in this chapter</b>${confbar(s)}${legend(s)}</div>`;
  }
  async function viewChapter(p, n, topicId) {
    const tok = viewTok, P = PAPERS[p], c = CH[p][n];
    document.title = "Ch " + n + ": " + c.title + " · CAPrep";
    setLast({ p, n });
    log("open_chapter", { p, n }, "oc-" + p + n);
    $("#view").innerHTML = `
      <div class="crumbs"><a href="#/">Dashboard</a><span>/</span><a href="#/paper/${p}">${esc(P.short)}</a><span>/</span><span>Chapter ${n}</span></div>
      <div class="reader">
        <aside class="toc" aria-label="Topics in this chapter">
          <div class="toc-head"><b>Topics</b><span class="prog" id="ch-prog"></span></div>
          <button class="btn ghost sm toc-toggle" id="toc-toggle" aria-expanded="false">Show topic list</button>
          <div id="toc-list"></div>
        </aside>
        <article class="chapter" id="chapter"></article>
      </div>`;
    const art = $("#chapter");
    art.innerHTML = `<div class="panel empty"><span>Loading chapter…</span></div>`;
    let frag;
    try { frag = await chapterFrag(p, n); }
    catch (e) { if (tok !== viewTok) return; art.innerHTML = loadErr("this chapter", "retry"); $("#retry").onclick = () => viewChapter(p, n, topicId); return; }
    if (tok !== viewTok) return;
    art.innerHTML = "";
    art.appendChild(frag.cloneNode(true));
    const secs = $$("section.topic", art);
    secs.forEach(decorateTopic);
    const list = $("#toc-list");
    list.innerHTML = secs.map((s, i) => `<button class="toc-item" data-id="${s.id}"><span class="dot" aria-hidden="true"></span><span>${i + 1}. ${esc(BY_ID[s.id].title)}</span></button>`).join("");
    $$(".toc-item", list).forEach(el => { paintToc(el, el.dataset.id); el.onclick = () => { document.getElementById(el.dataset.id).scrollIntoView(); if (narrow()) setToc(false); }; });
    const narrow = () => matchMedia("(max-width: 1000px)").matches;
    const setToc = open => { list.hidden = !open; $("#toc-toggle").setAttribute("aria-expanded", String(open)); $("#toc-toggle").textContent = open ? "Hide topic list" : "Show topic list"; };
    if (narrow()) setToc(false);
    $("#toc-toggle").onclick = () => setToc(list.hidden);
    const st = stats(c.ids); $("#ch-prog").textContent = st.read + "/" + st.total + " read";
    const ready = P.chapters.filter(x => CH[p][x.n]);
    const idx = ready.findIndex(x => x.n === n), prev = ready[idx - 1], nxt = ready[idx + 1];
    const end = document.createElement("div");
    end.className = "ch-end";
    end.innerHTML = `<div class="panel" id="ch-sum-wrap"><div id="ch-sum">${chSummary(p, n)}</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button class="btn ghost sm" id="mark-all">Mark all topics as read</button><button class="btn ghost sm" id="to-top">Back to top ↑</button></div></div>
      <nav class="ch-nav" aria-label="Chapter navigation">
        ${prev ? `<a href="#/ch/${p}/${prev.n}"><small>← Previous chapter</small><b>${prev.n}. ${esc(prev.title)}</b></a>` : ""}
        ${nxt ? `<a class="next" href="#/ch/${p}/${nxt.n}"><small>Next chapter →</small><b>${nxt.n}. ${esc(nxt.title)}</b></a>` : `<a class="next" href="#/paper/${p}"><small>End of ${esc(P.short)} →</small><b>Back to all chapters</b></a>`}
      </nav>`;
    art.appendChild(end);
    $("#mark-all").onclick = () => c.ids.forEach(id => { if (!(prog[id] && prog[id].r)) setTopic(id, { r: true }); });
    $("#to-top").onclick = () => window.scrollTo(0, 0);
    if ("IntersectionObserver" in window) {
      spy = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) $$(".toc-item", list).forEach(t => t.classList.toggle("active", t.dataset.id === e.target.id)); }), { rootMargin: "-20% 0px -70% 0px" });
      secs.forEach(s => spy.observe(s));
    }
    if (topicId) { const t = document.getElementById(topicId); if (t) { setTimeout(() => { t.scrollIntoView(); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1600); }, 30); } }
  }

  /* ---------- Revise ---------- */
  let shuffleSeed = 1;
  /* Smart plan: a topic comes back when it is due. Low after 2 days, Medium after a week, High after 3 weeks.
     Topics that are read but not rated come back after a day, so the student rates them. */
  const DUE_DAYS = { low: 2, medium: 7, high: 21 };
  const daysSince = iso => iso ? Math.max(0, (Date.now() - new Date(iso).getTime()) / DAY) : 30;
  function smartList(pool) {
    const out = [];
    pool.forEach(t => {
      const r = prog[t.id]; if (!r || !r.r) return;
      const d = daysSince(r.at), c = r.c, ago = d >= 1 ? plural(Math.floor(d), "day") + " ago" : "today";
      if (!c) { if (d < 1) return; out.push({ t, score: 80 + d, why: "Read but not rated yet. Rate your confidence." }); return; }
      if (d < DUE_DAYS[c]) return;
      out.push({ t, score: { low: 100, medium: 60, high: 20 }[c] + d, why: CONF_LABEL[c] + " confidence. Last looked at " + ago + "." });
    });
    return out.sort((a, b) => b.score - a.score);
  }
  const smartPool = p => TOPICS.filter(t => p === "all" ? (myPapers().length ? myPapers().includes(t.p) : true) : t.p === p);
  function viewRevise(params) {
    document.title = "Revise · CAPrep";
    const c = params.get("c") || "smart", p = params.get("p") || "all", order = params.get("o") || "paper";
    const pool = TOPICS.filter(t => p === "all" || t.p === p);
    const count = k => k === "smart" ? smartList(smartPool(p)).length : pool.filter(t => match(t.id, k)).length;
    function match(id, k) { const r = prog[id] || {}; return k === "all" ? !!r.r : k === "none" ? !r.c : r.c === k; }
    const smart = c === "smart" ? smartList(smartPool(p)) : [], why = {};
    smart.forEach(x => { why[x.t.id] = x.why; });
    let items = c === "smart" ? smart.slice(0, 30).map(x => x.t) : pool.filter(t => match(t.id, c));
    if (order === "shuffle") { let s = shuffleSeed; items = items.map(t => ({ t, k: (s = (s * 9301 + 49297) % 233280) })).sort((a, b) => a.k - b.k).map(x => x.t); }
    log("revise", { c, p }, "rv-" + c + p);
    const chipBtn = (k, label, color) => `<button class="fchip" data-c="${k}" aria-pressed="${c === k}">${color ? `<i style="background:${color}"></i>` : ""}${label}<span class="n">${count(k)}</span></button>`;
    const livePapers = Object.keys(PAPERS).filter(live);
    const qs = o => "#/revise?" + new URLSearchParams(Object.assign({ c, p, o: order }, o)).toString();
    $("#view").innerHTML = `
      <div class="page-head"><span class="eyebrow">Revision</span><h1>${c === "smart" ? "Today's smart revision" : "Revise by confidence"}</h1><p>${c === "smart" ? "Topics that are due for another look, the weakest first. Low topics come back after 2 days, Medium after a week and High after 3 weeks, so nothing fades away. Press <b>I have reviewed this topic</b> when you finish one." : "Pick a confidence level to see only those topics. Open a topic here, read it again, and update your confidence as you go."}</p></div>
      <div class="panel" style="display:grid;gap:14px">
        <div class="filters" role="group" aria-label="Confidence filter">${chipBtn("smart", "Smart plan", "var(--brand)")}${chipBtn("low", "Low", "var(--lo)")}${chipBtn("medium", "Medium", "var(--md)")}${chipBtn("high", "High", "var(--hi)")}${chipBtn("none", "Not rated", "var(--line-strong)")}${chipBtn("all", "All read")}</div>
        <div class="filters"><label class="muted" for="fp" style="font-weight:700">Paper</label><select id="fp"><option value="all">All papers</option>${livePapers.map(k => `<option value="${k}" ${p === k ? "selected" : ""}>${esc(PAPERS[k].short)}</option>`).join("")}</select>
          <label class="muted" for="fo" style="font-weight:700">Order</label><select id="fo"><option value="paper" ${order === "paper" ? "selected" : ""}>Paper and chapter</option><option value="shuffle" ${order === "shuffle" ? "selected" : ""}>Shuffle</option></select></div>
      </div>
      <div class="rev-list" id="rev-list"></div>
      <div id="rev-more"></div>`;
    $$(".fchip").forEach(b => b.onclick = () => { location.hash = qs({ c: b.dataset.c }); });
    $("#fp").onchange = e => { location.hash = qs({ p: e.target.value }); };
    $("#fo").onchange = e => { shuffleSeed = Date.now() % 233280; location.hash = qs({ o: e.target.value }); };
    const listEl = $("#rev-list");
    if (!items.length) {
      const msg = { smart: "You are all caught up. Nothing is due for revision right now. Read more topics, or come back tomorrow.", low: "No Low-confidence topics here. Great work, or start rating topics as you read.", medium: "No Medium-confidence topics here yet.", high: "No High-confidence topics here yet. Rate topics in each chapter as you finish them.", none: "Every topic here has a confidence rating.", all: "You have not marked any topics as read here yet." }[c];
      listEl.innerHTML = `<div class="panel empty"><b>Nothing to show</b><span>${msg}</span><a class="btn ghost sm" href="#/">Go to dashboard</a></div>`;
      return;
    }
    let shown = 0;
    const more = () => {
      const chunk = items.slice(shown, shown + 30); shown += chunk.length;
      listEl.insertAdjacentHTML("beforeend", chunk.map(t => `
        <div class="rev-item" data-id="${t.id}"><div class="rev-row"><div class="t"><small><span class="code" style="font-size:.7rem">${esc(PAPERS[t.p].code)}</span> ${esc(PAPERS[t.p].short)} · Ch ${t.n}: ${esc(CH[t.p][t.n].title)}</small><b>${t.i}. ${esc(t.title)}</b>${why[t.id] ? `<span class="why">${esc(why[t.id])}</span>` : ""}</div>
          <div class="a">${pill(t.id, true)}<button class="btn sm" data-open>Review here</button><a class="btn ghost sm" href="#/ch/${t.p}/${t.n}/${t.id}">Open in chapter</a></div></div>
          <div class="rev-body" hidden></div></div>`).join(""));
      $("#rev-more").innerHTML = shown < items.length ? `<button class="btn ghost block" id="more">Show more (${items.length - shown} left)</button>` : `<p class="muted" style="text-align:center">${items.length} topic${items.length > 1 ? "s" : ""}</p>`;
      const m = $("#more"); if (m) m.onclick = more;
    };
    more();
    listEl.onclick = async e => {
      const done = e.target.closest("[data-reviewed]");
      if (done) {
        const item = done.closest(".rev-item"), id = item.dataset.id;
        touchTopic(id);
        item.classList.add("done"); $(".rev-body", item).hidden = true; $(".rev-body", item).innerHTML = ""; $("[data-open]", item).textContent = "Review again";
        const c = prog[id] && prog[id].c;
        toast("Reviewed. " + (c ? "It will come back in " + plural(DUE_DAYS[c], "day") + "." : "Rate your confidence so it comes back at the right time."));
        return;
      }
      const b = e.target.closest("[data-open]"); if (!b) return;
      const item = b.closest(".rev-item"), body = $(".rev-body", item), id = item.dataset.id, t = BY_ID[id], tok = viewTok;
      if (!body.hidden) { body.hidden = true; body.innerHTML = ""; b.textContent = "Review here"; return; }
      b.disabled = true; b.textContent = "Loading…";
      let frag;
      try { frag = await chapterFrag(t.p, t.n); } catch (err) { b.disabled = false; b.textContent = "Review here"; toast("Could not load this topic. Check your internet connection."); return; }
      b.disabled = false;
      if (tok !== viewTok) return;
      body.appendChild(frag.getElementById(id).cloneNode(true)); decorateTopic($("section.topic", body));
      body.insertAdjacentHTML("beforeend", `<div class="rev-done"><button class="btn sm" data-reviewed>I have reviewed this topic</button><span class="muted">This tells the smart plan when to bring it back.</span></div>`);
      body.hidden = false; b.textContent = "Close";
      log("review", { t: id });
    };
  }

  /* ---------- Flashcards ---------- */
  /* Cards are made from the notes: practice questions with their answers, "Remember" boxes (key points)
     and exam traps. A card the student gets right comes back later (1, 3, 7, 14, then 30 days). A missed card comes back in the same session. */
  const BOX_DAYS = [0, 1, 3, 7, 14, 30], SESSION = 20;
  const KIND = { q: "Practice question", r: "Key point", t: "Exam trap" };
  let cardState = null, cardKeys = null;
  const cardStore = () => {
    if (!cardState) { try { cardState = JSON.parse(localStorage.getItem("haprep-cards-v1:" + me.id) || "{}") || {}; } catch (e) { cardState = {}; } }
    return cardState;
  };
  const saveCards = () => { try { localStorage.setItem("haprep-cards-v1:" + me.id, JSON.stringify(cardState)); } catch (e) {} };
  const shuffled = a => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

  async function viewCards(params) {
    document.title = "Flashcards · CAPrep";
    const tok = viewTok, mine = myPapers(), livePapers = Object.keys(PAPERS).filter(live);
    const p = params.get("p") || (mine.length ? "mine" : "all"), k = params.get("k") || "all", f = params.get("f") || "due";
    const papers = p === "mine" ? mine : p === "all" ? livePapers : [p];
    const qs = o => "#/cards?" + new URLSearchParams(Object.assign({ p, k, f }, o)).toString();
    $("#view").innerHTML = `
      <div class="page-head"><span class="eyebrow">Practice</span><h1>Flashcards</h1><p>Practice questions, key points and exam traps taken from your notes. Cards you know come back later. Cards you miss come back today.</p></div>
      <div class="panel" style="display:grid;gap:12px"><div class="filters">
        <label class="muted" for="cp" style="font-weight:700">Subjects</label><select id="cp">${mine.length ? `<option value="mine" ${p === "mine" ? "selected" : ""}>My subjects</option>` : ""}<option value="all" ${p === "all" ? "selected" : ""}>All papers</option>${livePapers.map(x => `<option value="${x}" ${p === x ? "selected" : ""}>${esc(PAPERS[x].short)}</option>`).join("")}</select>
        <label class="muted" for="ck" style="font-weight:700">Type</label><select id="ck"><option value="all">All types</option>${Object.keys(KIND).map(x => `<option value="${x}" ${k === x ? "selected" : ""}>${KIND[x]}s</option>`).join("")}</select>
        <label class="muted" for="cf" style="font-weight:700">Show</label><select id="cf"><option value="due" ${f === "due" ? "selected" : ""}>Cards due today</option><option value="weak" ${f === "weak" ? "selected" : ""}>My Low and Medium topics</option><option value="all" ${f === "all" ? "selected" : ""}>Every card</option></select></div>
        <div class="muted" id="deck-info">Loading cards…</div></div>
      <div id="deck"></div>`;
    $("#cp").onchange = e => { location.hash = qs({ p: e.target.value }); };
    $("#ck").onchange = e => { location.hash = qs({ k: e.target.value }); };
    $("#cf").onchange = e => { location.hash = qs({ f: e.target.value }); };
    let all;
    try { all = (await Promise.all(papers.map(x => getFile("cards/" + x + ".json", true).catch(() => []))))
      .flat().filter(c => BY_ID[c.t] && (k === "all" || c.k === k)); }
    catch (e) { all = []; }
    if (tok !== viewTok) return;
    const st = cardStore(), now = Date.now();
    const isDue = c => !st[c.i] || st[c.i].d <= now;
    const conf = c => (prog[c.t] && prog[c.t].c) || null;
    const due = all.filter(isDue).length, known = all.filter(c => st[c.i] && st[c.i].b >= 4).length;
    $("#deck-info").innerHTML = all.length ? `<b>${all.length}</b> cards · <b>${due}</b> due today · <b>${known}</b> well known` : "";
    let pool = f === "due" ? all.filter(isDue) : f === "weak" ? all.filter(c => conf(c) === "low" || conf(c) === "medium") : all;
    const rank = { low: 0, medium: 1, null: 2, high: 3 };
    pool = shuffled(pool).sort((a, b) => rank[conf(a)] - rank[conf(b)]).slice(0, SESSION);
    const deck = $("#deck");
    if (!all.length) { deck.innerHTML = `<div class="panel empty"><b>No cards here</b><span>There are no flashcards for this choice yet. Try another subject or type.</span></div>`; return; }
    if (!pool.length) {
      deck.innerHTML = `<div class="panel empty"><b>${f === "weak" ? "No cards from Low or Medium topics" : "All caught up"}</b><span>${f === "weak" ? "Rate topics as you read and their cards will show up here." : "No cards are due right now. Come back tomorrow, or study every card."}</span><a class="btn ghost sm" href="${qs({ f: "all" })}">Study every card</a></div>`;
      return;
    }
    const queue = pool.slice(); let idx = 0, got = 0, missed = 0, shown = false;
    const total = () => queue.length;
    function front(c) {
      const t = BY_ID[c.t];
      if (c.k === "q") return `<div class="ex"><div class="ex-q">${c.f}</div><div class="ex-a" id="fc-ans" hidden>${c.b}</div></div>`;
      const ask = c.k === "r" ? "What is the key point to remember about" : "What is the common exam trap in";
      return `<p class="fc-ask">${ask} <b>${esc(t.title)}</b>?</p><div class="box ${c.k === "r" ? "remember" : "trap"}" id="fc-ans" hidden><span class="lbl">${KIND[c.k]}</span>${c.b}</div>`;
    }
    function draw() {
      if (idx >= queue.length) return finish();
      const c = queue[idx], t = BY_ID[c.t]; shown = false;
      deck.innerHTML = `
        <div class="deck-top"><span><b>Card ${idx + 1}</b> of ${total()}</span><span class="bar-prog" style="width:160px"><i style="width:${Math.round(idx / total() * 100)}%"></i></span></div>
        <div class="fcard"><div class="fc-meta"><span class="chip">${KIND[c.k]}</span><span class="muted">${esc(PAPERS[t.p].short)} · Ch ${t.n} · ${esc(t.title)}</span></div>
          <div class="fc-body">${front(c)}</div></div>
        <div class="fc-actions" id="fc-actions"><button class="btn" id="fc-show">Show answer <small>(Space)</small></button></div>
        <div class="fc-links"><a href="#/ch/${t.p}/${t.n}/${t.id}">Open this topic in the notes</a></div>`;
      $("#fc-show").onclick = reveal; $("#fc-show").focus();
    }
    function reveal() {
      if (shown) return; shown = true;
      $("#fc-ans").hidden = false;
      $("#fc-actions").innerHTML = `<button class="btn ghost miss" id="fc-miss">Missed it <small>(1)</small></button><button class="btn" id="fc-got">Got it <small>(2)</small></button>`;
      $("#fc-miss").onclick = () => answer(false); $("#fc-got").onclick = () => answer(true);
      $("#fc-got").focus();
    }
    function answer(ok) {
      if (!shown) return;
      const c = queue[idx], cur = st[c.i] || { b: 0 };
      if (ok) { const b = Math.min(5, cur.b + 1); st[c.i] = { b, d: Date.now() + BOX_DAYS[b] * DAY }; got++; }
      else { st[c.i] = { b: 0, d: Date.now() }; missed++; if (queue.filter(x => x.i === c.i).length < 2) queue.push(c); }
      saveCards(); idx++; draw();
    }
    function finish() {
      if (cardKeys) { document.removeEventListener("keydown", cardKeys); cardKeys = null; }
      log("cards", { n: got + missed });
      deck.innerHTML = `<div class="panel empty done-card"><div class="medal" aria-hidden="true">🎯</div><b>Session finished</b><span>You got <b>${got}</b> right and missed <b>${missed}</b>. ${missed ? "Missed cards come back today." : "Well done!"}</span>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><a class="btn" href="${qs({})}" id="again">Study more</a><a class="btn ghost" href="#/">Back to dashboard</a></div></div>`;
      $("#again").onclick = e => { e.preventDefault(); viewTok++; viewCards(params); };
    }
    cardKeys = e => {
      if (e.target.closest && e.target.closest("input,select,textarea")) return;
      if (e.key === " " || e.key === "Enter") { if (!shown) { e.preventDefault(); reveal(); } }
      else if (shown && (e.key === "1" || e.key === "ArrowLeft")) answer(false);
      else if (shown && (e.key === "2" || e.key === "ArrowRight")) answer(true);
    };
    document.addEventListener("keydown", cardKeys);
    draw();
  }

  /* ---------- Search ---------- */
  let INDEX = null;
  async function ensureIndex() {
    if (INDEX) return;
    const text = await getFile("search.json", true);
    INDEX = TOPICS.map(t => { const x = text[t.id] || ""; return Object.assign({ text: x, low: x.toLowerCase(), tlow: t.title.toLowerCase() }, t); });
  }
  function searchHTML(raw) {
    const words = raw.toLowerCase().trim().split(/\s+/).filter(w => w.length > 1);
    if (!words.length) return "";
    if (!INDEX) return "";
    const phrase = words.join(" ");
    const hits = INDEX.filter(t => words.every(w => t.low.includes(w)))
      .map(t => ({ t, score: (t.tlow.includes(phrase) ? 40 : 0) + (t.low.split(phrase).length - 1) * 5 + words.reduce((a, w) => a + (t.tlow.includes(w) ? 3 : 0) + t.low.split(w).length - 1, 0) }))
      .sort((a, b) => b.score - a.score);
    if (!hits.length) return `<p class="muted">No topic contains all of these words. Try fewer or shorter words.</p>`;
    const re = new RegExp("(" + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    return `<p class="muted">${hits.length} topic${hits.length > 1 ? "s" : ""} found${hits.length > 40 ? ", showing the best 40" : ""}</p>` + hits.slice(0, 40).map(({ t }) => {
      const at = t.low.indexOf(phrase), i = Math.max(0, (at >= 0 ? at : t.low.indexOf(words[0])) - 60);
      const st = i ? t.text.indexOf(" ", i) + 1 : 0;
      const snip = (st ? "… " : "") + t.text.slice(st, st + 170) + "…";
      return `<a href="#/ch/${t.p}/${t.n}/${t.id}"><b>${esc(t.title).replace(re, "<mark>$1</mark>")}</b><small>${esc(PAPERS[t.p].short)} · Ch ${t.n}: ${esc(CH[t.p][t.n].title)} · ${pill(t.id)}</small><small>${esc(snip).replace(re, "<mark>$1</mark>")}</small></a>`;
    }).join("");
  }
  async function viewSearch(q) {
    const tok = viewTok;
    document.title = "Search · CAPrep";
    $("#view").innerHTML = `<div class="page-head"><span class="eyebrow">Search</span><h1>Search all notes</h1><p>Search every topic in every paper. Results show your confidence for each topic.</p></div>
      <div class="search"><input id="q" type="search" placeholder="Try: deferred tax, IFRS 16, ISA 570, VAT rebate, s.85" autocomplete="off" aria-label="Search notes" value="${esc(q)}"><div class="results" id="results" aria-live="polite"></div></div>`;
    const inp = $("#q"), res = $("#results");
    let t = null;
    inp.oninput = () => { clearTimeout(t); t = setTimeout(() => { res.innerHTML = searchHTML(inp.value); history.replaceState(null, "", "#/search?q=" + encodeURIComponent(inp.value)); }, 160); };
    inp.focus();
    if (!INDEX) {
      res.innerHTML = `<p class="muted">Loading search…</p>`;
      try { await ensureIndex(); } catch (e) { if (tok === viewTok) res.innerHTML = loadErr("search", "retry"); if ($("#retry")) $("#retry").onclick = () => viewSearch(inp.value); return; }
      if (tok !== viewTok) return;
    }
    res.innerHTML = searchHTML(inp.value);
  }

  /* ---------- Admin ---------- */
  let adminCache = null, adminSort = { k: "last", d: -1 };
  async function loadAdmin(force) {
    if (adminCache && !force && Date.now() - adminCache.at < 60000) return adminCache;
    const [profiles, rows, recent] = await Promise.all([store.allProfiles(), store.allProgress(), store.activity(null, 150)]);
    const users = profiles.map(u => ({ u, read: 0, high: 0, medium: 0, low: 0, papers: {}, last: u.last_seen }));
    const byId = {}; users.forEach(x => { byId[x.u.id] = x; });
    rows.forEach(r => {
      const x = byId[r.user_id]; if (!x || !BY_ID[r.topic_id]) return;
      const p = BY_ID[r.topic_id].p;
      if (r.is_read) { x.read++; x.papers[p] = (x.papers[p] || 0) + 1; }
      if (r.confidence) x[r.confidence]++;
      if (r.updated_at && (!x.last || r.updated_at > x.last)) x.last = r.updated_at;
    });
    adminCache = { at: Date.now(), users, byId, recent, rows };
    return adminCache;
  }
  const userName = (d, id) => (d.byId[id] ? d.byId[id].u.username : "unknown");
  function evText(ev) {
    const d = ev.detail || {}, t = d.t && BY_ID[d.t];
    const tl = t ? `“${esc(t.title)}” <span class="muted">(${esc(PAPERS[t.p].short)} Ch ${t.n})</span>` : "";
    switch (ev.kind) {
      case "signup": return ["✚", "Created an account"];
      case "login": return ["→", "Signed in"];
      case "open_chapter": return ["📖", d.p && PAPERS[d.p] ? `Opened ${esc(PAPERS[d.p].short)} Chapter ${d.n}${CH[d.p] && CH[d.p][d.n] ? ": " + esc(CH[d.p][d.n].title) : ""}` : "Opened a chapter"];
      case "read": return ["✓", "Read " + tl];
      case "unread": return ["↺", "Marked as unread " + tl];
      case "confidence": return ["◆", `Rated <b>${esc(CONF_LABEL[d.c] || d.c)}</b> confidence on ` + tl];
      case "revise": return ["⟳", `Revision list: ${esc({ low: "Low", medium: "Medium", high: "High", none: "Not rated", all: "All read" }[d.c] || d.c)} · ${d.p && PAPERS[d.p] ? esc(PAPERS[d.p].short) : "All papers"}`];
      case "reviewed": return ["✔", "Finished reviewing " + tl];
      case "cards": return ["🃏", `Studied ${plural(d.n || 0, "flashcard")}`];
      case "review": return ["🔁", "Reviewed " + tl];
      case "milestone": return ["★", "Milestone: " + esc(d.text || "")];
      default: return ["•", esc(ev.kind)];
    }
  }
  function feedHTML(events, d) {
    if (!events.length) return `<div class="empty"><span>No activity yet.</span></div>`;
    return `<div class="feed">${events.map(ev => { const [i, txt] = evText(ev); return `<div class="ev"><i aria-hidden="true">${i}</i><span>${d ? `<b>${esc(userName(d, ev.user_id))}</b> · ` : ""}${txt}</span><small title="${esc(fmtDate(ev.created_at))}">${ago(ev.created_at)}</small></div>`; }).join("")}</div>`;
  }
  async function viewAdmin() {
    document.title = "Admin panel · CAPrep";
    $("#view").innerHTML = `<div class="page-head"><span class="eyebrow">Admin</span><h1>Admin panel</h1><p>Progress and activity of every registered student.</p></div><div class="panel"><p class="muted">Loading students…</p></div>`;
    let d;
    try { d = await loadAdmin(); } catch (e) { $("#view").innerHTML += `<div class="form-err">Could not load admin data: ${esc(e.message)}</div>`; return; }
    const total = TOPICS.length, now = Date.now();
    const active = days => d.users.filter(x => x.last && now - new Date(x.last).getTime() < days * 86400000).length;
    const totRead = d.users.reduce((a, x) => a + x.read, 0);
    const avg = d.users.length ? Math.round(d.users.reduce((a, x) => a + x.read / total, 0) / d.users.length * 100) : 0;
    const livePapers = Object.keys(PAPERS).filter(live);
    $("#view").innerHTML = `
      <div class="hello"><div class="page-head"><span class="eyebrow">Admin</span><h1>Admin panel</h1><p>Progress and activity of every registered student${store.mode === "demo" ? " on this device (demo mode)" : ""}.</p></div>
        <div class="admin-tools"><button class="btn ghost sm" id="refresh">Refresh</button><button class="btn ghost sm" id="csv">Download CSV</button></div></div>
      <div class="stats">
        <div class="stat"><span class="v">${d.users.length}</span><span class="k">Registered students</span></div>
        <div class="stat"><span class="v">${active(1)}</span><span class="k">Active in last 24 hours</span></div>
        <div class="stat"><span class="v">${active(7)}</span><span class="k">Active in last 7 days</span></div>
        <div class="stat"><span class="v">${avg}%</span><span class="k">Average completion · ${totRead} topics read</span></div>
      </div>
      <div class="panel" style="padding:16px">
        <div class="panel-h"><h3>Students</h3><input class="input" id="uf" type="search" placeholder="Filter by username" aria-label="Filter students"></div>
        <div class="table"><table><thead><tr>
          ${[["name", "Student"], ["joined", "Joined"], ["last", "Last active"], ["read", "Progress"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]].map(([k, l]) => `<th><button data-k="${k}">${l}${adminSort.k === k ? (adminSort.d < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("")}
          ${livePapers.map(p => `<th title="${esc(PAPERS[p].name)}">${esc(p.toUpperCase())}</th>`).join("")}
        </tr></thead><tbody id="ubody"></tbody></table></div>
      </div>
      <div class="panel"><div class="panel-h"><h3>Latest activity, all students</h3></div>${feedHTML(d.recent, d)}</div>`;
    const body = $("#ubody");
    const draw = () => {
      const f = ($("#uf").value || "").toLowerCase();
      const val = (x, k) => k === "name" ? x.u.username : k === "joined" ? x.u.created_at || "" : k === "last" ? x.last || "" : x[k];
      const list = d.users.filter(x => x.u.username.includes(f)).sort((a, b) => { const A = val(a, adminSort.k), B = val(b, adminSort.k); return (A > B ? 1 : A < B ? -1 : 0) * adminSort.d; });
      body.innerHTML = list.map(x => {
        const pct = Math.round(x.read / total * 100);
        const on = x.last && now - new Date(x.last).getTime() < 86400000;
        return `<tr data-id="${esc(x.u.id)}" tabindex="0"><td><span class="user"><span class="avatar">${esc(x.u.username.slice(0, 2))}</span>${esc(x.u.username)}${x.u.is_admin ? ' <span class="badge-admin">Admin</span>' : ""}</span></td>
          <td>${x.u.created_at ? new Date(x.u.created_at).toLocaleDateString() : "—"}</td>
          <td title="${esc(fmtDate(x.last))}"><span class="dotlive ${on ? "" : "off"}"></span>${ago(x.last)}</td>
          <td><div class="pct"><span>${x.read} · ${pct}%</span>${bar(pct)}</div></td>
          <td style="color:var(--hi);font-weight:900">${x.high}</td><td style="color:var(--md);font-weight:900">${x.medium}</td><td style="color:var(--lo);font-weight:900">${x.low}</td>
          ${livePapers.map(p => `<td>${Math.round((x.papers[p] || 0) / paperIds(p).length * 100)}%</td>`).join("")}</tr>`;
      }).join("") || `<tr><td colspan="${7 + livePapers.length}" class="muted">No students match.</td></tr>`;
    };
    draw();
    $("#uf").oninput = draw;
    $$("th button").forEach(b => b.onclick = () => { adminSort = { k: b.dataset.k, d: adminSort.k === b.dataset.k ? -adminSort.d : (b.dataset.k === "name" ? 1 : -1) }; viewAdmin(); });
    body.onclick = e => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "#/admin/user/" + encodeURIComponent(tr.dataset.id); };
    body.onkeydown = e => { if (e.key === "Enter") { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "#/admin/user/" + encodeURIComponent(tr.dataset.id); } };
    $("#refresh").onclick = async () => { adminCache = null; viewAdmin(); };
    $("#csv").onclick = () => {
      const head = ["username", "joined", "last_active", "topics_read", "percent", "high", "medium", "low"].concat(livePapers.map(p => p + "_percent"));
      const lines = [head.join(",")].concat(d.users.map(x => [x.u.username, x.u.created_at || "", x.last || "", x.read, Math.round(x.read / total * 100), x.high, x.medium, x.low].concat(livePapers.map(p => Math.round((x.papers[p] || 0) / paperIds(p).length * 100))).join(",")));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
      a.download = "student-progress-" + new Date().toISOString().slice(0, 10) + ".csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }
  async function viewAdminUser(rawId) {
    const id = decodeURIComponent(rawId || "");
    $("#view").innerHTML = `<div class="panel"><p class="muted">Loading student…</p></div>`;
    let d, events;
    try { d = await loadAdmin(); events = await store.activity(id, 300); } catch (e) { $("#view").innerHTML = `<div class="form-err">Could not load: ${esc(e.message)}</div>`; return; }
    const x = d.byId[id];
    if (!x) { $("#view").innerHTML = `<div class="crumbs"><a href="#/admin">Admin panel</a></div><div class="panel empty"><b>Student not found</b></div>`; return; }
    document.title = x.u.username + " · Admin · CAPrep";
    const theirs = {}; d.rows.filter(r => r.user_id === id).forEach(r => { theirs[r.topic_id] = { r: r.is_read, c: r.confidence }; });
    const st = ids => { const s = { total: ids.length, read: 0, high: 0, medium: 0, low: 0, none: 0 }; ids.forEach(t => { const r = theirs[t]; if (r && r.r) s.read++; if (r && r.c) s[r.c]++; else s.none++; }); s.pct = s.total ? Math.round(s.read / s.total * 100) : 0; return s; };
    const all = st(allIds()), livePapers = Object.keys(PAPERS).filter(live);
    const lows = TOPICS.filter(t => theirs[t.id] && theirs[t.id].c === "low").slice(0, 40);
    $("#view").innerHTML = `
      <div class="crumbs"><a href="#/admin">Admin panel</a><span>/</span><span>${esc(x.u.username)}</span></div>
      <div class="hello"><div style="display:flex;gap:14px;align-items:center"><span class="avatar" style="width:56px;height:56px;font-size:1.2rem;background:var(--side);color:#fff">${esc(x.u.username.slice(0, 2))}</span>
        <div class="page-head"><h1>${esc(x.u.username)}${x.u.is_admin ? ' <span class="badge-admin">Admin</span>' : ""}</h1><p>Joined ${esc(fmtDate(x.u.created_at))} · Last active ${ago(x.last)}</p></div></div></div>
      <div class="stats">
        <div class="stat"><span class="v">${all.read}<span class="muted" style="font-size:1rem"> / ${all.total}</span></span><span class="k">Topics read · ${all.pct}%</span></div>
        <div class="stat hi"><span class="v">${all.high}</span><span class="k">High confidence</span></div>
        <div class="stat md"><span class="v">${all.medium}</span><span class="k">Medium confidence</span></div>
        <div class="stat lo"><span class="v">${all.low}</span><span class="k">Low confidence</span></div>
      </div>
      <div class="grid2">
        <div class="panel"><div class="panel-h"><h3>Progress by paper</h3></div><div class="paper-bars">${livePapers.map(p => { const s = st(paperIds(p)); return `<div class="row"><b>${esc(PAPERS[p].short)}</b><div style="display:grid;gap:5px">${bar(s.pct)}${confbar(s)}</div><span class="muted">${s.pct}%</span></div>`; }).join("")}</div>
          <div style="margin-top:16px;display:grid;gap:8px"><b>Overall confidence</b>${confbar(all)}${legend(all)}</div></div>
        <div class="panel"><div class="panel-h"><h3>Recent activity</h3><span class="muted">${events.length} events</span></div>${feedHTML(events)}</div>
      </div>
      <div class="panel"><div class="panel-h"><h3>Low-confidence topics</h3><span class="muted">${all.low} total</span></div>
        ${lows.length ? `<div class="rev-list">${lows.map(t => `<a class="results" style="margin:0" href="#/ch/${t.p}/${t.n}/${t.id}"><span style="display:grid;gap:2px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 14px"><b>${esc(t.title)}</b><small class="muted">${esc(PAPERS[t.p].short)} · Ch ${t.n}: ${esc(CH[t.p][t.n].title)}</small></span></a>`).join("")}</div>` : `<p class="muted">No Low-confidence topics.</p>`}</div>`;
  }

  /* ---------- Start ---------- */
  async function start() {
    const S = window.Stores, cfg = window.APP_CONFIG || {};
    OPEN = cfg.LOGIN !== true;           // default: open site, no login, progress kept in this browser
    if (OPEN) {
      store = new S.LocalStore();
      try { me = await store.guest(); } catch (e) { me = { id: "local-guest", username: "student", is_admin: false }; }
      enterApp(null);
      return;
    }
    if (S.online && !window.supabase) {
      $("#root").innerHTML = `<div class="loading"><div class="panel" style="max-width:420px;text-align:center;display:grid;gap:10px"><h2>Cannot reach the login service</h2><p class="muted">Check your internet connection and reload the page.</p><button class="btn" onclick="location.reload()">Reload</button></div></div>`;
      return;
    }
    store = S.online ? new S.SupabaseStore() : new S.LocalStore();
    try { me = await store.current(); } catch (e) { me = null; }
    if (me) enterApp(null); else renderAuth("in");
  }
  start();
})();
