// supabase/functions/auto-mode-runner/index.ts
//
// Auto-mode's actual completion logic lives entirely in the
// `run_auto_mode_tasks()` Postgres function (granted `execute` to
// service_role only) — it loops every active auto-mode investment,
// credits each one's remaining daily slots at its own task_reward, and
// pays the same referral commissions a manual completion would. This
// function's only job is to invoke that RPC on a schedule.
//
// IMPORTANT: this deliberately does NOT call `complete_task` — that
// function explicitly requires `mode = 'manual'` in its investment
// lookup, so it can never select an auto-mode plan. An earlier version
// of this file called complete_task per-task per-user, which either
// failed outright or could have drained the wrong (manual) plan's
// quota. `run_auto_mode_tasks()` is the correct, and only, entry point.
//
// run_auto_mode_tasks() is idempotent per day — a plan whose quota is
// already maxed for today is skipped (`if v_slots_left <= 0 then
// continue`), so it's safe to call this on a short interval (e.g. every
// 15 minutes) rather than once a day. That also means a plan switched
// to auto-mode mid-day gets topped up on the next run instead of
// waiting for a single daily cron tick.
//
// Not triggered by pg_cron (not available on this project) — call this
// on a schedule from an external scheduler (GitHub Actions, cron-job.org,
// etc — see supabase/functions/auto-mode-runner/README.md) hitting:
//
//   POST https://<project-ref>.supabase.co/functions/v1/auto-mode-runner
//   Header: x-cron-secret: <CRON_SECRET>
//
// Deploy with: supabase functions deploy auto-mode-runner --no-verify-jwt
// Set the secret with: supabase secrets set CRON_SECRET=<some-random-string>
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
// by the Edge Functions runtime — no need to set those yourself. The
// service-role key is required here, not optional: run_auto_mode_tasks()
// is only granted to the service_role, so calling it with anything else
// — including the anon key — will fail with a permission error.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET      = Deno.env.get("CRON_SECRET"); // optional but strongly recommended

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ success: false, error: "Use POST" }, 405);
  }

  if (CRON_SECRET) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== CRON_SECRET) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ success: false, error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data, error } = await supabase.rpc("run_auto_mode_tasks");

  if (error) {
    return json({ success: false, error: error.message }, 500);
  }

  // run_auto_mode_tasks() returns the total number of task-slots it
  // just credited across every auto-mode plan, system-wide.
  return json({ success: true, tasksCompleted: data ?? 0 });
});
