# CAPrep website: setup guide

This folder has your new study website. Students can sign up with just a **username and password**. Their progress and confidence marks (High / Medium / Low) are saved to their account, and you get an **admin panel** that shows every student's progress and activity.

```
ca-prep-site/
  dist/            ← the finished website (upload this folder)
    index.html, app.css, app.js, store.js, data.js
    config.js      ← paste your two Supabase keys here
  supabase/
    schema.sql     ← database setup (run once in Supabase)
  src/             ← source files (content, design, code)
  build.py         ← rebuilds dist/ from src/
  make_preview.py  ← makes the one-file demo preview
```

## How it works

- **Without keys (demo mode):** the site works straight away, but accounts are saved only in that one browser. Use this only to try the design.
- **With Supabase keys (real mode):** accounts and progress are saved online, so students can log in from any device. You see everyone in the admin panel.

Supabase is a free online database. The free plan is enough for hundreds of students.

## Step 1: Create the database (about 5 minutes)

1. Go to **supabase.com** and sign up (free).
2. Click **New project**. Give it a name (for example `ca-prep`), choose a strong database password, pick the region closest to Bangladesh (for example **Singapore**), then click **Create**.
3. When the project is ready, open **SQL Editor** → **New query**. Open `supabase/schema.sql` from this folder, copy everything, paste it into the editor and click **Run**. You should see "Success".
4. Open **Authentication** → **Sign In / Providers** → **Email**. Switch **off** "Confirm email" and click **Save**.
   (Students sign up with a username only, so there is no real email to confirm.)
5. Open **Project Settings** → **API** (or **Data API**). Copy:
   - the **Project URL** (looks like `https://abcd1234.supabase.co`)
   - the **anon public** key (a long text starting with `eyJ...`)

## Step 2: Add the keys to the website

Open `dist/config.js` in any text editor and paste the two values:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://abcd1234.supabase.co",
  SUPABASE_ANON_KEY: "eyJ....",
  USERNAME_DOMAIN: "users.ha-ca-prep.app"
};
```

The anon key is meant to be public; the security rules in `schema.sql` protect each student's data. **Never** put the `service_role` key in this file.

Do not change `USERNAME_DOMAIN` after students have registered, or their logins will stop working.

## Step 3: Put the website online (free)

The easiest option is **Netlify**:

1. Go to **app.netlify.com** and sign up (free).
2. Choose **Add new site** → **Deploy manually**.
3. Drag the whole **`dist`** folder onto the page.
4. Netlify gives you a link like `https://your-name.netlify.app`. You can change the name in **Site settings**, or connect your own domain.

Other free options that work the same way: **Cloudflare Pages** (upload the `dist` folder) or **GitHub Pages**.

## Step 4: Make yourself the admin

1. Open your website and click **Create account**. Choose your own username and password.
2. In Supabase, open **SQL Editor** and run (use your username):

   ```sql
   update public.profiles set is_admin = true where username = 'your_username';
   ```

3. Sign out and sign in again. **Admin panel** now appears in the left menu.

You can make other people admins the same way.

## Admin tasks

**See students:** Admin panel → table of all students. Click a student to see:

- progress by paper
- confidence counts
- their Low topics
- their full activity history

**Download a report:** Admin panel → **Download CSV**.

**Reset a student's password** (when they forget it): in Supabase **SQL Editor**, run:

```sql
update auth.users
set encrypted_password = extensions.crypt('NewPass123', extensions.gen_salt('bf'))
where email = 'their_username@users.ha-ca-prep.app';
```

Then tell the student their new password.

**Remove a student:** Supabase → **Authentication** → **Users** → find `their_username@users.ha-ca-prep.app` → **Delete user**. Their progress is deleted too.

## Good to know

- **Free projects pause** if nobody uses the site for 7 days. Open the Supabase dashboard and click **Restore** if that happens.
- **Updating notes or design:** edit the files in `src/`, run `python3 build.py`, then upload `dist/` again. Your `config.js` is never overwritten by the build.
- **Advance Level papers:** each chapter is its own file, for example `src/cr/cr-04.html` for Corporate Reporting Chapter 4. The build adds every file in `src/cr`, `src/sbm` and `src/cs` automatically. Chapters without a file show as "Notes coming soon".
- **Single-file preview:** after `python3 build.py`, run `python3 make_preview.py` to remake `preview-demo.html` (demo mode, opens straight from your computer).

---

## Publishing with GitHub Pages

The repository includes `.github/workflows/deploy.yml`. Every time you push to the
`main` branch, GitHub runs `build.py` and publishes the `dist/` folder.

**One-time setup**
1. Create a new repository on github.com (for example `ca-prep`). Public is simplest
   (GitHub Pages on a private repository needs a paid plan).
2. Upload this whole folder to it (GitHub Desktop, or the commands below).
3. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy to GitHub Pages" to show a green tick.
   Your site is then live at `https://<your-username>.github.io/<repo-name>/`.

```
cd ca-prep-site
git init
git add .
git commit -m "First version of the site"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

**Supabase keys:** put them in `dist/config.js` and push. This is the only file in `dist/`
that is kept in git; the rest is rebuilt by GitHub. The anon key is meant to be public
(your data is protected by the database rules in `schema.sql`). Never put the
`service_role` key in this file.

**Updating the site**
1. Edit files in `src/` (notes, `data.js`, `app.css`, etc.).
2. Optional check on your computer: `python3 build.py`, then open `dist/index.html`
   or run `python3 -m http.server --directory dist` and visit http://localhost:8000.
3. Commit and push (`git add . && git commit -m "what changed" && git push`).
4. The Actions tab shows the deploy; the live site updates within a minute or two.
   Students may need to refresh the page to see changes.

If a deploy fails, open the failed run in the **Actions** tab to see the error.


## Publishing with GitHub and Vercel (automatic updates)

1. Put this folder in a GitHub repository (see the guide given with the project).
2. On vercel.com choose **Add New → Project**, import the repository and press **Deploy**. `vercel.json` already tells Vercel to run `python3 build.py` and publish the `dist` folder.
3. After that, every push to the `main` branch updates the live site by itself. Other branches get a private preview link.
4. `dist/config.js` must stay in the repository (it is empty by default, which is fine for the open, no-login version).


## Login, admin and sync across devices (Supabase)

`dist/config.js` has `LOGIN: true`, so students create an account (username and password) and their progress and chosen subjects follow them to every device.

1. Create a free project at supabase.com. In **SQL Editor**, paste all of `supabase/schema.sql` and press **Run**. (If you ran an older version, run it again: it is safe and adds the new `subjects` column.)
2. In Supabase: **Authentication → Sign In / Providers → Email**: switch **Confirm email** OFF (students sign up with a username only).
3. In Supabase: **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `dist/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and commit. Vercel redeploys by itself.
4. Open the live site, press **Create account**, and register the username you want for the admin (for example `admin`).
5. Back in Supabase **SQL Editor** run: `update public.profiles set is_admin = true where username = 'admin';`
6. Sign out and in again. The **Admin panel** appears in the side menu and shows every student's progress and activity.

Until Supabase is connected the site still works, but accounts exist only in that one browser ("demo mode"). Never put the `service_role` key anywhere in this project.

## Installing as an app

The site is a Progressive Web App. In Chrome (computer or Android) open the live link and use the install icon in the address bar (or menu → **Install CAPrep**). On iPhone use Safari → Share → **Add to Home Screen**. The installed app opens in its own window and the notes open even without internet; progress syncs when the connection returns.
