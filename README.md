# CAPrep

Plain-English ICAB exam notes with progress tracking. Students sign up with a **username and password**. Their progress, confidence marks (High / Medium / Low) and chosen subjects are saved to their account and follow them to every device. An **admin panel** shows every student's progress and activity.

```
CaPrep/
  dist/            ← the finished website (Vercel builds this; only config.js is kept in git)
    config.js      ← your Supabase keys live here
  src/             ← the source: notes, design, code
    content.html   ← notes for Corporate Laws, Taxation, Financial Reporting, Audit
    fm/ cr/ sbm/ cs/   ← one file per chapter for FM and the Advance Level papers
    papers.json    ← paper and chapter list
    app.js, app.css, store.js, data.js
    pwa/           ← logo, app icons, manifest, service worker
  supabase/
    schema.sql     ← database setup (run once in Supabase)
  build.py         ← builds dist/ from src/
  make_preview.py  ← makes a one-file demo preview
  vercel.json      ← tells Vercel how to build and publish
```

## How it works

- **Without Supabase keys (demo mode):** the site works straight away, but accounts and progress stay in that one browser. Use this only to try the design.
- **With Supabase keys (real mode):** accounts and progress are saved online and you see everyone in the admin panel.

Supabase is a free online database. The free plan is enough for hundreds of students.

## Step 1: Create the database (about 5 minutes)

1. Go to **supabase.com** and sign up (free).
2. Click **New project**. Give it a name (for example `caprep`), choose a strong database password, pick the region closest to Bangladesh (for example **Singapore**), then click **Create**.
3. When the project is ready, open **SQL Editor** → **New query**. Copy everything from `supabase/schema.sql`, paste it in and click **Run**. You should see "Success". It is safe to run again if the file changes later.
4. Open **Authentication** → **Sign In / Providers** → **Email** and switch **off** "Confirm email". Click **Save**. (Students sign up with a username only, so there is no real email to confirm.)
5. Open **Project Settings** → **API** and copy the **Project URL** and the **anon / publishable** key.

## Step 2: Add the keys to the website

Open `dist/config.js` and paste the two values:

```js
window.APP_CONFIG = {
  LOGIN: true,
  SUPABASE_URL: "https://abcd1234.supabase.co",
  SUPABASE_ANON_KEY: "your-publishable-key",
  USERNAME_DOMAIN: "users.ha-ca-prep.app"
};
```

The publishable key is meant to be public. The security rules in `schema.sql` protect each student's data. **Never** put the `service_role` / secret key anywhere in this project.

Do not change `USERNAME_DOMAIN` after students have registered, or their logins will stop working.

## Step 3: Put the website online with Vercel (free, updates by itself)

1. Put this repository on GitHub.
2. On **vercel.com** choose **Add New → Project**, import the repository and press **Deploy**. `vercel.json` already tells Vercel to run `python3 build.py` and publish the `dist` folder.
3. After that, every push to the `main` branch updates the live site. Other branches and pull requests get a private preview link.

`dist/config.js` must stay in the repository. Students may need to refresh the page to see changes.

## Step 4: Make yourself the admin

1. Open your website, click **Create account** and register the username you want for the admin.
2. In Supabase **SQL Editor** run (use your username):

   ```sql
   update public.profiles set is_admin = true where username = 'your_username';
   ```

3. Sign out and sign in again. **Admin panel** now appears in the side menu.

You can make other people admins the same way.

**Already set up an older version?** Run all of `supabase/schema.sql` again (it is safe). The newest version adds one column, `exam_dates`, which saves each student's exam countdown dates to their account. Until you run it, exam dates are saved on that device only.

## Admin tasks

**See students:** Admin panel → table of all students. Click a student to see their progress by paper, confidence counts, Low topics and full activity history.

**Download a report:** Admin panel → **Download CSV**.

**Reset a student's password** (when they forget it): in Supabase **SQL Editor** run:

```sql
update auth.users
set encrypted_password = extensions.crypt('NewPass123', extensions.gen_salt('bf'))
where email = 'their_username@users.ha-ca-prep.app';
```

Then tell the student their new password.

**Remove a student:** Supabase → **Authentication** → **Users** → find `their_username@users.ha-ca-prep.app` → **Delete user**. Their progress is deleted too.

## Updating the site

1. Edit files in `src/` (notes, `data.js`, `app.css`, the logo in `src/pwa/`, and so on).
2. Optional check on your computer: run `python3 build.py`, then `python3 -m http.server --directory dist` and visit http://localhost:8000. (Opening `dist/index.html` straight from the folder will not work, because chapters load on demand. Use the single-file preview below for that.)
3. Commit and push. Vercel redeploys within a minute or two.

**Advance Level papers:** each chapter is its own file, for example `src/cr/cr-04.html` for Corporate Reporting Chapter 4. The build adds every file in `src/fm`, `src/cr`, `src/sbm` and `src/cs` automatically. Chapters without a file show as "Notes coming soon".

**Single-file preview:** after `python3 build.py`, run `python3 make_preview.py` to make `preview-demo.html` (demo mode, opens straight from your computer).

**Logo:** the CAPrep logo is `src/pwa/logo.svg`. The app icons in `src/pwa/` are PNG versions of it. The sidebar copy is inside `src/app.js` (`LOGO`).

## What the app does

- **Exam countdown:** each student sets an exam date per subject. The dashboard shows days left and how many topics to read each day, keeping the last 20% of the time for revision.
- **Smart revision:** the Revise page opens on a plan of topics that are due. Low topics come back after 2 days, Medium after 7 and High after 21, weakest first. Students press "I have reviewed this topic" to reset the timer.
- **Flashcards:** made automatically at build time from the notes: worked examples become practice questions, "Remember" boxes become key points, and "trap" boxes become exam traps. Cards a student gets right come back after 1, 3, 7, 14 and 30 days. Their card progress is kept in their browser.
- **Fast loading:** the build splits the notes into one small file per chapter (`dist/ch/`), plus `search.json` and `cards/`. A chapter downloads only when opened, and the student's own subjects are quietly saved in the background for offline reading. Nothing to maintain: just edit the notes in `src/` and rebuild.

## Good to know

- **Free Supabase projects pause** if nobody uses the site for 7 days. Open the Supabase dashboard and click **Restore** if that happens.
- Until Supabase is connected the site still works, but accounts exist only in one browser (demo mode).

## Installing as an app

CAPrep is a Progressive Web App. In Chrome (computer or Android) open the live link and use the install icon in the address bar (or menu → **Install CAPrep**). On iPhone use Safari → Share → **Add to Home Screen**. The installed app opens in its own window and the notes open even without internet. Progress syncs when the connection returns.
