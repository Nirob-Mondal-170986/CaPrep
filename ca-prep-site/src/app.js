/* H&A CA Prep — app logic (no framework). Routes live in the URL hash:
   #/  dashboard · #/paper/<p> · #/ch/<p>/<n>[/<topic>] · #/revise · #/search · #/admin · #/admin/user/<id> */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const PAPERS = window.PAPERS, LEVELS = window.LEVELS, QUOTES = window.QUOTES;
  const CONF = ["low", "medium", "high"];
  const CONF_LABEL = { low: "Low", medium: "Medium", high: "High" };

  /* ---------- Topic index built from the chapter templates ---------- */
  const TOPICS = [], BY_ID = {}, CH = {};
  Object.keys(PAPERS).forEach(p => {
    CH[p] = {};
    PAPERS[p].chapters.forEach(c => {
      const tpl = document.getElementById("tpl-" + p + "-" + c.n);
      if (!tpl) return;
      const ids = [];
      $$("section.topic", tpl.content).forEach((s, i) => {
        const t = { id: s.id, p, n: c.n, i: i + 1, title: s.querySelector("h2").textContent.trim() };
        TOPICS.push(t); BY_ID[t.id] = t; ids.push(t.id);
      });
      CH[p][c.n] = { title: c.title, note: c.note, ids };
    });
  });
  const live = p => PAPERS[p].chapters.some(c => CH[p][c.n]);
  const tplOf = (p, n) => document.getElementById("tpl-" + p + "-" + n);

  /* ---------- State ---------- */
  let store = null, me = null, prog = {};
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

  /* ---------- Saving ---------- */
  function setTopic(id, patch) {
    const t = BY_ID[id]; if (!t) return;
    const before = snapshotCounts(id);
    const cur = prog[id] || { r: false, c: null };
    const next = Object.assign({}, cur, patch);
    prog[id] = next;
    pending.set(id, { t: id, p: t.p, n: t.n, r: !!next.r, c: next.c || null });
    scheduleFlush();
    if (patch.c !== undefined && patch.c !== cur.c && patch.c) log("confidence", { t: id, c: patch.c });
    else if (patch.r !== undefined && patch.r !== cur.r) log(patch.r ? "read" : "unread", { t: id });
    afterChange(id, before);
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
    return { all: stats(allIds()), paper: stats(paperIds(t.p)), ch: stats(CH[t.p][t.n].ids) };
  }
  function afterChange(id, before) {
    const t = BY_ID[id], all = stats(allIds()), paper = stats(paperIds(t.p)), ch = stats(CH[t.p][t.n].ids);
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

  /* ---------- Auth screen ---------- */
  function renderAuth(mode) {
    mode = mode || "in";
    document.title = "Sign in · H&A CA Prep";
    $("#root").innerHTML = `
    <div class="auth">
      <div class="auth-art">
        <div style="position:relative;z-index:1">
          <a class="brand" href="#/"><span class="mark">H&amp;A</span><span><b>H&amp;A CA Prep</b><small>ICAB exam notes</small></span></a>
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
    prog = {};
    try {
      const rows = await store.myProgress(me.id);
      rows.forEach(r => { prog[r.topic_id] = { r: !!r.is_read, c: r.confidence || null, at: r.updated_at }; });
    } catch (e) { toast("Could not load your progress. " + e.message); }
    if (evt) log(evt, null);
    store.touch(me.id).catch(() => {});
    setInterval(() => store.touch(me.id).catch(() => {}), 5 * 60 * 1000);
    renderShell();
    if (!location.hash || location.hash === "#") location.hash = "#/";
    route();
  }
  function renderShell() {
    $("#root").innerHTML = `
    <div class="app" id="app">
      <div class="topbar"><a class="brand" href="#/"><span class="mark">H&amp;A</span><span><b>CA Prep</b></span></a><button class="menu-btn" id="menu" aria-expanded="false" aria-controls="side">Menu</button></div>
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
    const low = stats(allIds()).low;
    $("#side").innerHTML = `
      <a class="brand" href="#/"><span class="mark">H&amp;A</span><span><b>H&amp;A CA Prep</b><small>ICAB exam notes</small></span></a>
      <nav class="nav">
        ${a("#/", "home", ICON.home, "Dashboard")}
        ${a("#/revise", "revise", ICON.rev, "Revise", low ? `<span class="meta" title="Low-confidence topics">${low} low</span>` : "")}
        ${a("#/search", "search", ICON.search, "Search notes")}
        ${me.is_admin ? a("#/admin", "admin", ICON.admin, "Admin panel") : ""}
      </nav>
      ${LEVELS.map(L => `<nav class="nav" aria-label="${esc(L.name)}"><div class="nav-h">${esc(L.name)}</div>
        ${L.papers.map(p => {
          const P = PAPERS[p];
          if (!live(p)) return `<a href="#/paper/${p}" ${cur === "p-" + p ? 'aria-current="page"' : ""}><span class="ico">${ICON.book}</span><span>${esc(P.short)}</span><span class="soon">Soon</span></a>`;
          const s = stats(paperIds(p));
          return `<a href="#/paper/${p}" ${cur === "p-" + p ? 'aria-current="page"' : ""}><span class="ico">${ICON.book}</span><span>${esc(P.short)}</span><span class="meta">${s.pct}%</span><span class="mini"><i style="width:${s.pct}%"></i></span></a>`;
        }).join("")}</nav>`).join("")}
      <div class="side-foot">
        <div class="me"><span class="avatar">${esc(me.username.slice(0, 2))}</span><span><b>${esc(me.username)}</b><small>${me.is_admin ? "Admin" : "Student"}${store.mode === "demo" ? " · demo" : ""}</small></span></div>
        <div class="sync" id="sync">${store.mode === "demo" ? "Saved on this device" : "All changes saved"}</div>
        <div class="side-actions"><button id="theme">${document.documentElement.dataset.theme === "dark" ? "Light mode" : "Dark mode"}</button><button id="out">Sign out</button></div>
      </div>`;
    $("#theme").onclick = () => { applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); renderSide(cur); };
    $("#out").onclick = async () => { await flush(); await store.signOut(); me = null; location.hash = "#/"; renderAuth("in"); };
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
    if (!parts.length) { current = "home"; renderSide("home"); return viewHome(); }
    if (parts[0] === "paper" && PAPERS[parts[1]]) { current = "p-" + parts[1]; renderSide(current); return viewPaper(parts[1]); }
    if (parts[0] === "ch" && PAPERS[parts[1]] && CH[parts[1]][+parts[2]]) { current = "p-" + parts[1]; renderSide(current); return viewChapter(parts[1], +parts[2], parts[3]); }
    if (parts[0] === "revise") { current = "revise"; renderSide("revise"); return viewRevise(params); }
    if (parts[0] === "search") { current = "search"; renderSide("search"); return viewSearch(params.get("q") || ""); }
    if (parts[0] === "admin" && me.is_admin) { current = "admin"; renderSide("admin"); return parts[1] === "user" ? viewAdminUser(parts[2]) : viewAdmin(); }
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
    document.title = "Dashboard · H&A CA Prep";
    const s = stats(allIds()), hr = new Date().getHours();
    const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const last = getLast(); const lastOk = last && CH[last.p] && CH[last.p][last.n];
    const stepIdx = TOTAL_STEPS.filter(x => s.read >= x).length;
    const q = quoteFor(stepIdx * 7 + new Date().getDate());
    const R = 78, C = 2 * Math.PI * R;
    const next = TOTAL_STEPS.find(x => x > s.read);
    $("#view").innerHTML = `
      <div class="hello"><div class="page-head"><span class="eyebrow">${new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</span>
        <h1>${greet}, ${esc(me.username)}</h1><p>${s.read ? `You have read ${s.read} of ${s.total} topics. ${next ? `${next - s.read} more to your next milestone.` : ""}` : "Pick a paper below and read your first topic to get started."}</p></div>
        <a class="btn" href="#/revise?c=low">Revise weak topics</a></div>
      <div class="stats">
        <a class="stat" href="#/revise?c=all"><span class="v">${s.read}<span class="muted" style="font-size:1rem"> / ${s.total}</span></span><span class="k">Topics read</span></a>
        <a class="stat hi" href="#/revise?c=high"><span class="v">${s.high}</span><span class="k">High confidence</span></a>
        <a class="stat md" href="#/revise?c=medium"><span class="v">${s.medium}</span><span class="k">Medium confidence</span></a>
        <a class="stat lo" href="#/revise?c=low"><span class="v">${s.low}</span><span class="k">Low confidence</span></a>
      </div>
      <div class="panel overview">
        <div class="ring" aria-label="${s.pct}% of all topics read"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="${R}" fill="none" stroke="var(--slate-soft)" stroke-width="16"/><circle cx="90" cy="90" r="${R}" fill="none" stroke="var(--brand)" stroke-width="16" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - s.pct / 100)}"/></svg><div class="c"><div><b>${s.pct}%</b><span>of all notes</span></div></div></div>
        <div style="display:grid;gap:14px;min-width:0">
          <h3>Your confidence across all topics</h3>${confbar(s)}${legend(s)}
          ${lastOk ? `<div class="resume" style="border-top:1px solid var(--line);padding-top:14px"><div><b>Continue reading</b><br><span>${esc(PAPERS[last.p].short)} · Chapter ${last.n}: ${esc(CH[last.p][last.n].title)}</span></div><a class="btn ghost" href="#/ch/${last.p}/${last.n}">Open chapter →</a></div>` : ""}
        </div>
      </div>
      <div class="quote"><span class="eyebrow">${stepIdx ? "Milestone " + stepIdx + " reached" : "Today's thought"}</span><q>${esc(q.q)}</q><cite>— ${esc(q.a)}</cite></div>
      <form class="search" id="qs" role="search"><label for="q" class="muted" style="font-weight:700;display:block;margin-bottom:6px">Search all notes</label><input id="q" type="search" placeholder="Try: deferred tax, IFRS 16, ISA 570, VAT rebate, s.85" autocomplete="off"></form>
      <div class="levels">${LEVELS.map(L => `
        <div class="level-h"><h2>${esc(L.name)}</h2><span class="muted">${esc(L.blurb)}</span></div>
        <div class="papers">${L.papers.map(paperCard).join("")}</div>`).join("")}</div>`;
    $("#qs").onsubmit = e => { e.preventDefault(); location.hash = "#/search?q=" + encodeURIComponent($("#q").value); };
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
    document.title = P.short + " · H&A CA Prep";
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
  function viewChapter(p, n, topicId) {
    const P = PAPERS[p], c = CH[p][n];
    document.title = "Ch " + n + ": " + c.title + " · H&A CA Prep";
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
    art.appendChild(tplOf(p, n).content.cloneNode(true));
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
  function viewRevise(params) {
    document.title = "Revise · H&A CA Prep";
    const c = params.get("c") || "low", p = params.get("p") || "all", order = params.get("o") || "paper";
    const pool = TOPICS.filter(t => p === "all" || t.p === p);
    const count = k => pool.filter(t => match(t.id, k)).length;
    function match(id, k) { const r = prog[id] || {}; return k === "all" ? !!r.r : k === "none" ? !r.c : r.c === k; }
    let items = pool.filter(t => match(t.id, c));
    if (order === "shuffle") { let s = shuffleSeed; items = items.map(t => ({ t, k: (s = (s * 9301 + 49297) % 233280) })).sort((a, b) => a.k - b.k).map(x => x.t); }
    log("revise", { c, p }, "rv-" + c + p);
    const chipBtn = (k, label, color) => `<button class="fchip" data-c="${k}" aria-pressed="${c === k}">${color ? `<i style="background:${color}"></i>` : ""}${label}<span class="n">${count(k)}</span></button>`;
    const livePapers = Object.keys(PAPERS).filter(live);
    const qs = o => "#/revise?" + new URLSearchParams(Object.assign({ c, p, o: order }, o)).toString();
    $("#view").innerHTML = `
      <div class="page-head"><span class="eyebrow">Revision</span><h1>Revise by confidence</h1><p>Pick a confidence level to see only those topics. Open a topic here, read it again, and update your confidence as you go.</p></div>
      <div class="panel" style="display:grid;gap:14px">
        <div class="filters" role="group" aria-label="Confidence filter">${chipBtn("low", "Low", "var(--lo)")}${chipBtn("medium", "Medium", "var(--md)")}${chipBtn("high", "High", "var(--hi)")}${chipBtn("none", "Not rated", "var(--line-strong)")}${chipBtn("all", "All read")}</div>
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
      const msg = { low: "No Low-confidence topics here. Great work, or start rating topics as you read.", medium: "No Medium-confidence topics here yet.", high: "No High-confidence topics here yet. Rate topics in each chapter as you finish them.", none: "Every topic here has a confidence rating.", all: "You have not marked any topics as read here yet." }[c];
      listEl.innerHTML = `<div class="panel empty"><b>Nothing to show</b><span>${msg}</span><a class="btn ghost sm" href="#/">Go to dashboard</a></div>`;
      return;
    }
    let shown = 0;
    const more = () => {
      const chunk = items.slice(shown, shown + 30); shown += chunk.length;
      listEl.insertAdjacentHTML("beforeend", chunk.map(t => `
        <div class="rev-item" data-id="${t.id}"><div class="rev-row"><div class="t"><small><span class="code" style="font-size:.7rem">${esc(PAPERS[t.p].code)}</span> ${esc(PAPERS[t.p].short)} · Ch ${t.n}: ${esc(CH[t.p][t.n].title)}</small><b>${t.i}. ${esc(t.title)}</b></div>
          <div class="a">${pill(t.id, true)}<button class="btn sm" data-open>Review here</button><a class="btn ghost sm" href="#/ch/${t.p}/${t.n}/${t.id}">Open in chapter</a></div></div>
          <div class="rev-body" hidden></div></div>`).join(""));
      $("#rev-more").innerHTML = shown < items.length ? `<button class="btn ghost block" id="more">Show more (${items.length - shown} left)</button>` : `<p class="muted" style="text-align:center">${items.length} topic${items.length > 1 ? "s" : ""}</p>`;
      const m = $("#more"); if (m) m.onclick = more;
    };
    more();
    listEl.onclick = e => {
      const b = e.target.closest("[data-open]"); if (!b) return;
      const item = b.closest(".rev-item"), body = $(".rev-body", item), id = item.dataset.id, t = BY_ID[id];
      if (!body.hidden) { body.hidden = true; body.innerHTML = ""; b.textContent = "Review here"; return; }
      const src = tplOf(t.p, t.n).content.getElementById(id);
      body.appendChild(src.cloneNode(true)); decorateTopic($("section.topic", body));
      body.hidden = false; b.textContent = "Close";
      log("review", { t: id });
    };
  }

  /* ---------- Search ---------- */
  let INDEX = null;
  function buildIndex() {
    INDEX = TOPICS.map(t => {
      const s = tplOf(t.p, t.n).content.getElementById(t.id);
      const parts = [], w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) if (!w.currentNode.parentElement.closest("[data-top]")) parts.push(w.currentNode.nodeValue);
      const text = parts.join(" ").replace(/\s+/g, " ").replace(/ ([,.;:)])/g, "$1").trim();
      return Object.assign({ text, low: text.toLowerCase(), tlow: t.title.toLowerCase() }, t);
    });
  }
  function searchHTML(raw) {
    const words = raw.toLowerCase().trim().split(/\s+/).filter(w => w.length > 1);
    if (!words.length) return "";
    if (!INDEX) buildIndex();
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
  function viewSearch(q) {
    document.title = "Search · H&A CA Prep";
    $("#view").innerHTML = `<div class="page-head"><span class="eyebrow">Search</span><h1>Search all notes</h1><p>Search every topic in every paper. Results show your confidence for each topic.</p></div>
      <div class="search"><input id="q" type="search" placeholder="Try: deferred tax, IFRS 16, ISA 570, VAT rebate, s.85" autocomplete="off" aria-label="Search notes" value="${esc(q)}"><div class="results" id="results" aria-live="polite"></div></div>`;
    const inp = $("#q"), res = $("#results");
    let t = null;
    inp.oninput = () => { clearTimeout(t); t = setTimeout(() => { res.innerHTML = searchHTML(inp.value); history.replaceState(null, "", "#/search?q=" + encodeURIComponent(inp.value)); }, 160); };
    res.innerHTML = searchHTML(q); inp.focus();
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
    document.title = "Admin panel · H&A CA Prep";
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
    document.title = x.u.username + " · Admin · H&A CA Prep";
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
    const S = window.Stores;
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
