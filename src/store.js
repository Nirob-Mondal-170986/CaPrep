/* Data layer. Two interchangeable stores with the same methods:
   - SupabaseStore: real accounts (username + password) and shared data, used when config.js has keys.
   - LocalStore: demo mode, everything kept in this browser only. */
(function () {
  const CFG = window.APP_CONFIG || {};
  const DOMAIN = CFG.USERNAME_DOMAIN || "users.ha-ca-prep.app";
  const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

  function friendly(err) {
    const m = (err && (err.message || err.error_description || String(err))) || "Something went wrong";
    if (/invalid login credentials/i.test(m)) return new Error("Wrong username or password.");
    if (/already registered|already exists|duplicate key/i.test(m)) return new Error("That username is already taken. Try another.");
    if (/password should be at least/i.test(m)) return new Error("Password must be at least 6 characters.");
    if (/rate limit|too many/i.test(m)) return new Error("Too many attempts. Please wait a minute and try again.");
    if (/failed to fetch|network/i.test(m)) return new Error("Cannot reach the server. Check your internet connection.");
    if (/email not confirmed/i.test(m)) return new Error("This account is waiting for email confirmation. The site owner must switch off \"Confirm email\" in Supabase.");
    return new Error(m);
  }

  class SupabaseStore {
    constructor() {
      this.mode = "online";
      this.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: "haprep-auth" }
      });
    }
    email(u) { return u + "@" + DOMAIN; }
    async profile(id) {
      const { data, error } = await this.sb.from("profiles").select("*").eq("id", id).single();
      if (error) throw friendly(error);
      return data;
    }
    async current() {
      const { data } = await this.sb.auth.getSession();
      const s = data && data.session;
      if (!s) return null;
      try { return await this.profile(s.user.id); } catch (e) { return null; }
    }
    async available(u) {
      const { data, error } = await this.sb.rpc("username_available", { name: u });
      return error ? true : !!data;
    }
    async signUp(u, p) {
      if (!(await this.available(u))) throw new Error("That username is already taken. Try another.");
      const { data, error } = await this.sb.auth.signUp({ email: this.email(u), password: p, options: { data: { username: u } } });
      if (error) throw friendly(error);
      if (!data.session) throw new Error("Account created, but \"Confirm email\" is switched on in Supabase. The site owner must switch it off (see the setup guide), then you can sign in.");
      return this.profile(data.user.id);
    }
    async signIn(u, p) {
      const { data, error } = await this.sb.auth.signInWithPassword({ email: this.email(u), password: p });
      if (error) throw friendly(error);
      return this.profile(data.user.id);
    }
    async signOut() { await this.sb.auth.signOut(); }
    async saveSubjects(uid, list) {
      const { error } = await this.sb.from("profiles").update({ subjects: list }).eq("id", uid);
      if (error) throw friendly(error);
    }
    async saveExamDates(uid, obj) {
      const { error } = await this.sb.from("profiles").update({ exam_dates: obj }).eq("id", uid);
      if (error) throw friendly(error);
    }
    async pageAll(build) {
      const out = [], size = 1000;
      for (let from = 0; ; from += size) {
        const { data, error } = await build().range(from, from + size - 1);
        if (error) throw friendly(error);
        out.push(...data);
        if (data.length < size) break;
      }
      return out;
    }
    async myProgress(uid) {
      return this.pageAll(() => this.sb.from("progress").select("topic_id,is_read,confidence,updated_at").eq("user_id", uid).order("topic_id"));
    }
    async saveTopics(uid, rows) {
      const now = new Date().toISOString();
      const { error } = await this.sb.from("progress").upsert(rows.map(r => ({ user_id: uid, topic_id: r.t, paper: r.p, chapter: r.n, is_read: r.r, confidence: r.c, updated_at: now })));
      if (error) throw friendly(error);
    }
    async log(uid, kind, detail) {
      await this.sb.from("activity").insert({ user_id: uid, kind, detail: detail || null });
    }
    async touch(uid) {
      await this.sb.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", uid);
    }
    async allProfiles() {
      return this.pageAll(() => this.sb.from("profiles").select("*").order("created_at"));
    }
    async allProgress() {
      return this.pageAll(() => this.sb.from("progress").select("user_id,topic_id,paper,is_read,confidence,updated_at").order("user_id").order("topic_id"));
    }
    async activity(uid, limit) {
      let q = this.sb.from("activity").select("*").order("created_at", { ascending: false }).limit(limit || 200);
      if (uid) q = q.eq("user_id", uid);
      const { data, error } = await q;
      if (error) throw friendly(error);
      return data;
    }
  }

  const LKEY = "haprep-local-v1";
  class LocalStore {
    constructor() { this.mode = "demo"; }
    db() {
      try { return JSON.parse(localStorage.getItem(LKEY)) || { users: {}, progress: {}, activity: {}, session: null }; }
      catch (e) { return { users: {}, progress: {}, activity: {}, session: null }; }
    }
    put(d) { try { localStorage.setItem(LKEY, JSON.stringify(d)); } catch (e) {} }
    async hash(pw, salt) {
      const txt = salt + ":" + pw;
      if (window.crypto && crypto.subtle) {
        const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
        return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
      }
      let h = 0; for (const ch of txt) h = (h * 31 + ch.charCodeAt(0)) | 0; return "x" + h;
    }
    pub(u) { return u && { id: u.id, username: u.username, is_admin: u.is_admin, created_at: u.created_at, last_seen: u.last_seen, subjects: u.subjects || [], exam_dates: u.exam_dates || {} }; }
    async current() {
      const d = this.db();
      return d.session && d.users[d.session] ? this.pub(d.users[d.session]) : null;
    }
    async signUp(u, p) {
      const d = this.db();
      if (d.users[u]) throw new Error("That username is already taken. Try another.");
      const salt = Math.random().toString(36).slice(2);
      const first = !Object.values(d.users).some(x => x.id !== "local-guest");
      const id = "local-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      d.users[u] = { id, username: u, salt, hash: await this.hash(p, salt), is_admin: first, created_at: new Date().toISOString(), last_seen: null };
      d.progress[id] = {};
      if (first) { // bring over ticks from the old single-page site, if any
        try {
          const old = JSON.parse(localStorage.getItem("ha-ca-prep-read-v2") || "{}");
          Object.keys(old).forEach(t => { d.progress[id][t] = { r: true, c: null, at: new Date().toISOString() }; });
        } catch (e) {}
      }
      d.session = u; this.put(d);
      return this.pub(d.users[u]);
    }
    /* Open mode: one anonymous local profile, no password. */
    async guest() {
      const d = this.db(), name = "student";
      if (!d.users[name]) {
        const id = "local-guest";
        d.users[name] = { id, username: name, salt: "", hash: "", is_admin: false, created_at: new Date().toISOString(), last_seen: null };
        d.progress[id] = d.progress[id] || {};
        try { // bring over ticks from the old single-page site, if any
          const old = JSON.parse(localStorage.getItem("ha-ca-prep-read-v2") || "{}");
          Object.keys(old).forEach(t => { if (!d.progress[id][t]) d.progress[id][t] = { r: true, c: null, at: new Date().toISOString() }; });
        } catch (e) {}
      }
      d.session = name; this.put(d);
      return this.pub(d.users[name]);
    }
    async saveSubjects(uid, list) { const d = this.db(); const u = Object.values(d.users).find(x => x.id === uid); if (u) { u.subjects = list; this.put(d); } }
    async saveExamDates(uid, obj) { const d = this.db(); const u = Object.values(d.users).find(x => x.id === uid); if (u) { u.exam_dates = obj; this.put(d); } }
    async resetMine(uid) { const d = this.db(); d.progress[uid] = {}; d.activity[uid] = []; this.put(d); }
    async signIn(u, p) {
      const d = this.db(), rec = d.users[u];
      if (!rec || rec.hash !== (await this.hash(p, rec.salt))) throw new Error("Wrong username or password.");
      d.session = u; this.put(d);
      return this.pub(rec);
    }
    async signOut() { const d = this.db(); d.session = null; this.put(d); }
    async myProgress(uid) {
      const m = this.db().progress[uid] || {};
      return Object.keys(m).map(t => ({ topic_id: t, is_read: !!m[t].r, confidence: m[t].c || null, updated_at: m[t].at }));
    }
    async saveTopics(uid, rows) {
      const d = this.db(); const m = d.progress[uid] = d.progress[uid] || {};
      const now = new Date().toISOString();
      rows.forEach(r => { m[r.t] = { r: r.r, c: r.c, p: r.p, n: r.n, at: now }; });
      this.put(d);
    }
    async log(uid, kind, detail) {
      const d = this.db(); const a = d.activity[uid] = d.activity[uid] || [];
      a.unshift({ id: Date.now() + Math.random(), user_id: uid, kind, detail: detail || null, created_at: new Date().toISOString() });
      if (a.length > 500) a.length = 500;
      this.put(d);
    }
    async touch(uid) {
      const d = this.db(); const u = Object.values(d.users).find(x => x.id === uid);
      if (u) { u.last_seen = new Date().toISOString(); this.put(d); }
    }
    async allProfiles() { return Object.values(this.db().users).map(u => this.pub(u)); }
    async allProgress() {
      const d = this.db(), out = [];
      Object.keys(d.progress).forEach(uid => Object.keys(d.progress[uid]).forEach(t => {
        const r = d.progress[uid][t]; out.push({ user_id: uid, topic_id: t, paper: r.p, is_read: !!r.r, confidence: r.c || null, updated_at: r.at });
      }));
      return out;
    }
    async activity(uid, limit) {
      const d = this.db();
      let all = uid ? (d.activity[uid] || []) : Object.values(d.activity).flat();
      all = all.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return all.slice(0, limit || 200);
    }
  }

  window.Stores = { SupabaseStore, LocalStore, USERNAME_RE, online: !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) };
})();
