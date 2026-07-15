# auto-mode-runner

Completes tasks on behalf of users whose investment plans have
`mode = "auto"`. Nothing did this before — the old "Auto-mode" toggle
only flipped a database flag via `enable_auto_mode_for_plan`; nothing
ever acted on that flag.

This function is a thin wrapper around the `run_auto_mode_tasks()`
Postgres function, which already contains all the real logic (looping
every active auto-mode investment, crediting each one's remaining daily
slots at its own `task_reward`, paying referral commissions) and is
granted `execute` to `service_role` only — i.e. it was built specifically
to be called this way, from a trusted scheduled context, not by users.

An earlier version of this function called `complete_task` directly per
task per user. That was wrong: `complete_task` explicitly requires
`mode = 'manual'` in its plan lookup, so it can never select an
auto-mode investment — it would have either failed outright or drained
the wrong (manual) plan's quota. `run_auto_mode_tasks()` is the correct
entry point and the only one this function calls now.

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
— the Edge Functions runtime injects both automatically. The service
role key specifically matters here (not just as a convenience): 
`run_auto_mode_tasks()` is only granted to `service_role`, so this
function will fail with a permission error if it's ever called with
anything less privileged (e.g. the anon key).

## 3. Schedule it

This project doesn't have `pg_cron`/`pg_net` enabled, so instead of a
database-side schedule (the commented-out `cron.schedule(...)` at the
bottom of the SQL migration), a `.github/workflows/auto-mode-runner.yml`
workflow calls the function every 15 minutes via GitHub Actions' own
scheduler (free, no extra infra).

`run_auto_mode_tasks()` is idempotent per day (a plan already maxed out
for today is skipped), so calling it every 15 minutes instead of once a
day at a fixed hour is safe — and is actually an improvement over the
migration's own commented suggestion of a single daily 3am run, since a
plan switched to auto-mode mid-day now gets its tasks credited within
15 minutes instead of waiting until the next day.

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
GitHub, or you want tighter timing than "every 15 minutes,
best-effort"), any external cron service that can POST a header works
the same way — e.g. cron-job.org — or, later, enabling `pg_cron` +
`pg_net` in Supabase's Dashboard (Database → Extensions) and using the
`cron.schedule(...)` call already commented out at the bottom of the
migration.

## 4. Verify

Manually trigger the workflow (or `curl` the function directly with the
header below) and check the JSON response — `tasksCompleted` is the
total number of task-slots credited across every auto-mode plan,
system-wide, in that run:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/auto-mode-runner" \
  -H "x-cron-secret: <CRON_SECRET>"
```

```json
{ "success": true, "tasksCompleted": 4 }
```

`tasksCompleted: 0` on a run isn't necessarily a problem — it just means
every currently-active auto-mode plan has already used its full daily
quota for today (expected on repeated runs within the same day).
