# Finance Tracker — Setup Guide (phone + PC sync)

This app runs in two modes:

- **Local mode** (default): data is stored only in the browser you use. No setup needed.
- **Cloud sync mode**: data is saved to Supabase (free) and shared across all your
  devices after you sign in. This guide sets that up.

The hosting (the public URL you open on your phone) is **Netlify Drop**.
The data sync is **Supabase**. You need both.

---

## Part 1 — Create the free database (Supabase)

1. Go to https://supabase.com and sign up (free).
2. Click **New project**. Give it a name and a database password, pick a region
   near you, and create it. Wait ~1 minute for it to provision.
3. In the left sidebar open **SQL Editor** → **New query**, paste the SQL below,
   and click **Run**:

   ```sql
   create table public.transactions (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users(id) on delete cascade,
     type text not null,
     date date not null,
     category text not null,
     amount numeric not null,
     memo text default '',
     created_at timestamptz default now()
   );

   alter table public.transactions enable row level security;

   create policy "own rows"
     on public.transactions
     for all
     using (auth.uid() = user_id)
     with check (auth.uid() = user_id);
   ```

   This creates the table and locks it down so each signed-in user can only ever
   see and edit **their own** records.

4. (Optional, for personal use) To skip the email-confirmation step when creating
   your account: left sidebar → **Authentication** → **Sign In / Providers** (or
   **Settings**) → turn **Confirm email** off. If you leave it on, you'll get a
   confirmation email after signing up and must click the link before signing in.

5. Get your keys: left sidebar → **Project Settings** → **API**. Copy:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string — the *public* one, not `service_role`)

   > The `anon` key is safe to put in front-end code. Your data is protected by
   > the Row Level Security policy above + your login, not by hiding the key.

---

## Part 2 — Put your keys into the app

Open `config.js` in this folder and fill in the two values:

```js
window.SUPABASE_URL = "https://abcd1234.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOi...your-anon-key...";
```

Save the file. That's it — the app will now show a **Sign In** screen and sync.

> Leaving these empty keeps the app in local-only mode.

---

## Part 3 — Publish so your phone can open it (Netlify Drop)

1. Go to https://app.netlify.com/drop
2. Drag this **entire `finance-app` folder** onto the page.
   (Make sure `config.js` already has your keys before dropping, so sync works
   from the start.)
3. Netlify gives you a URL like `https://random-name-123.netlify.app`.
   You can rename it under **Site settings → Change site name**.
4. Open that URL on your phone (bookmark it / add to Home Screen), sign in with
   the same email + password on every device, and your records sync everywhere.

### Updating later
If you change any files, just drag the folder onto https://app.netlify.com/drop
again (or, on your site's **Deploys** page, drag it to redeploy). Your data lives
in Supabase, so redeploying never affects your records.

---

## Notes

- **Same account = same data.** Sign in with the same email/password on phone and
  PC to see the same records.
- Data refreshes when you open/return to the tab, or tap **↻ Refresh**.
- **CSV Export/Import** still works in both modes — a good periodic backup.
- Free tiers: Supabase and Netlify both have generous free plans that are far more
  than enough for a personal finance tracker.
