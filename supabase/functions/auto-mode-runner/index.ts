// supabase/functions/auto-mode-runner/index.ts
//
// Auto-mode was only ever a UI flag + `enable_auto_mode_for_plan` RPC call —
// nothing anywhere actually completed tasks on the user's behalf. This
// function is that missing piece: it finds every user with at least one
// active investment in mode="auto", and calls the SAME `complete_task` RPC
// the manual "Start Task" buttons call, once per available task, until
// the RPC itself says stop (quota reached / already completed / etc).
//
// Deliberately does NOT reimplement daily-quota or reward math — that
// logic already lives inside `complete_task` server-side and is trusted
// as the single source of truth. This function is just a very fast, very
// obedient version of a user tapping through their task list.
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
// by the Edge Functions runtime — no need to set those yourself.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET          = Deno.env.get("CRON_SECRET"); // optional but strongly recommended

// Task types that need a user-supplied proof screenshot — auto-mode has
// nothing to submit for these, so they're skipped entirely rather than
// calling complete_task with a null proof and hoping the RPC rejects it.
const PROOF_REQUIRED_TYPES = ["tiktok"];

// Heuristic for "this user is done for now, don't keep trying" vs a
// one-off failure worth logging and moving past. Adjust this regex to
// match your actual complete_task error message(s) once you can see them
// in practice — I don't have the RPC body to confirm the exact wording.
const QUOTA_EXHAUSTED_RE = /quota|limit|maximum|already completed|no.*(quota|slots)/i;

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

  // 1. Every distinct user with at least one active, auto-mode investment.
  const { data: autoInvestments, error: invErr } = await supabase
    .from("user_investments")
    .select("user_id")
    .eq("status", "active")
    .eq("mode", "auto");

  if (invErr) {
    return json({ success: false, error: invErr.message }, 500);
  }

  const userIds = [...new Set((autoInvestments ?? []).map((r) => r.user_id))];

  // 2. Active, non-proof-required tasks — fetched once and reused for
  //    every user (filtered per-user against what they've already done).
  const { data: tasks, error: taskErr } = await supabase
    .from("tasks")
    .select("id, type")
    .eq("status", "active");

  if (taskErr) {
    return json({ success: false, error: taskErr.message }, 500);
  }

  const autoCompletableTasks = (tasks ?? []).filter(
    (t) => !PROOF_REQUIRED_TYPES.includes(t.type)
  );

  const results = [];

  for (const userId of userIds) {
    const summary = { userId, completed: 0, skipped: 0, errors: [] };

    // Auto-mode shouldn't run for accounts that aren't activated —
    // mirrors the `disabled={!profile?.activated}` guard on every manual
    // task button in the UI.
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("activated")
      .eq("id", userId)
      .single();

    if (profErr || !profile?.activated) {
      summary.skipped = autoCompletableTasks.length;
      results.push(summary);
      continue;
    }

    const { data: completedRows, error: compErr } = await supabase
      .from("task_completions")
      .select("task_id")
      .eq("user_id", userId);

    if (compErr) {
      summary.errors.push({ message: compErr.message });
      results.push(summary);
      continue;
    }

    const completedIds = new Set((completedRows ?? []).map((r) => r.task_id));
    const available = autoCompletableTasks.filter((t) => !completedIds.has(t.id));

    for (const task of available) {
      const { error } = await supabase.rpc("complete_task", {
        p_user_id: userId,
        p_task_id: task.id,
        p_proof_url: null,
      });

      if (error) {
        summary.errors.push({ taskId: task.id, message: error.message });
        // The RPC is the source of truth on daily quota — once it starts
        // refusing, stop burning through the rest of this user's task
        // list this run rather than logging N more identical failures.
        if (QUOTA_EXHAUSTED_RE.test(error.message)) break;
        continue;
      }

      summary.completed += 1;
    }

    results.push(summary);
  }

  return json({
    success: true,
    usersProcessed: userIds.length,
    tasksConsidered: autoCompletableTasks.length,
    results,
  });
});
