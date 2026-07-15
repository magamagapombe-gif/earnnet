# auto-mode-runner

Completes tasks on behalf of users whose investment plans have
`mode = "auto"`. Nothing did this before — the old "Auto-mode" toggle
only flipped a database flag via `enable_auto_mode_for_plan`; nothing
ever acted on that flag. This function is what acts on it.

It does not reimplement daily quotas or reward math — it just calls the
existing `complete_task` RPC (the same one your manual task buttons call)
for every available, non-proof-required task, for every auto-mode user,
until that RPC says no more.

## 1. Deploy

```bash
supabase functions deploy auto-mode-runner --no-verify-jwt
```

`--no-verify-jwt` is needed because this is called by an external
scheduler, not a logged-in user — it authenticates itself with the
`CRON_SECRET` header instead.

## 2. Set the shared secret

```bash
supabase secrets set CRON_SECRET=<generate-a-long-random-string>
```

You do **not** need to set `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`
— the Edge Functions runtime injects both automatically.

## 3. Schedule it

This project doesn't have `pg_cron`/`pg_net` enabled, so instead of a
database-side schedule, a `.github/workflows/auto-mode-runner.yml`
workflow has been added that calls the function every 15 minutes via
GitHub Actions' own scheduler (free on GitHub, no extra infra).

In your GitHub repo, add these two Actions secrets
(Settings → Secrets and variables → Actions):

- `SUPABASE_PROJECT_REF` — the `<project-ref>` part of your Supabase
  project URL (e.g. `abcdefghijklmno`)
- `CRON_SECRET` — the exact same value you set with `supabase secrets set`
  above

Once both secrets are set, the workflow will start running on its own
schedule. You can also trigger it manually any time from the repo's
Actions tab → "Run auto-mode task completion" → "Run workflow", which is
the fastest way to test it end-to-end after deploying.

If you'd rather not depend on GitHub Actions (e.g. this repo isn't on
GitHub, or you want something more precise than "every 15 minutes,
best-effort"), any external cron service that can POST a header works
the same way — e.g. cron-job.org, or enabling the `pg_cron` + `pg_net`
extensions in Supabase's Dashboard (Database → Extensions) later and
scheduling the call with `pg_cron`'s `cron.schedule` + `net.http_post`
instead.

## 4. Verify

Manually trigger the workflow (or `curl` the function directly with the
header below) and check the JSON response — it reports how many users
were processed and how many tasks were completed or skipped per user:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/auto-mode-runner" \
  -H "x-cron-secret: <CRON_SECRET>"
```

## One thing worth double-checking

`complete_task`'s exact daily-quota error message isn't visible from the
client code, so the runner uses a regex (`QUOTA_EXHAUSTED_RE` in
`index.ts`) to guess whether an RPC failure means "this user is out of
quota for today, stop trying" vs. a one-off error worth logging and
moving past. Once you've run this for real and can see what
`complete_task` actually returns when quota is used up, tighten that
regex to match the real message exactly.
