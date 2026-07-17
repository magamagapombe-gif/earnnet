// supabase/functions/admin-actions/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Verify caller is a real authenticated user
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    // Check is_admin flag
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: profile } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!profile?.is_admin) throw new Error("Forbidden: not an admin");

    const body = await req.json();
    const { action } = body;
    let result: unknown;

    // ── Create task ──────────────────────────────────────────────
    if (action === "create_task") {
      // reward is intentionally NOT collected from the admin form —
      // each user is paid their own active plan's task_reward at
      // completion time (see complete_task RPC). tasks.reward is a
      // legacy not-null column that's unused by payout logic now,
      // so we just satisfy the constraint with 0 unless a value was
      // explicitly passed.
      const { data, error } = await adminClient.from("tasks").insert({
        ...body.task,
        reward: body.task.reward ?? 0,
        status: "active",
        used: 0,
        completions: 0,
        created_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      result = data;
    }

    // ── Toggle task status ───────────────────────────────────────
    else if (action === "toggle_task") {
      const { error } = await adminClient
        .from("tasks")
        .update({ status: body.status })
        .eq("id", body.taskId);
      if (error) throw error;
      result = { updated: true };
    }

    // ── Save settings ────────────────────────────────────────────
    else if (action === "save_settings") {
      const updates = Object.entries(body.settings).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      const { error } = await adminClient.from("settings").upsert(updates, { onConflict: "key" });
      if (error) throw error;
      result = { saved: true };
    }

    // ── Approve withdrawal (trigger LivePay payout) ──────────────
    else if (action === "approve_withdrawal") {
      const { data: w, error: wErr } = await adminClient
        .from("withdrawals")
        .select("*")
        .eq("id", body.withdrawalId)
        .single();
      if (wErr || !w) throw new Error("Withdrawal not found");

      // Guard against double-processing — two admins approving at once,
      // a retried request, or approving something already paid/rejected.
      if (w.status !== "pending") {
        throw new Error(`Withdrawal is already ${w.status} — nothing to approve.`);
      }

      // Call LivePay to initiate the payout. LivePay's payouts are async —
      // this call only confirms LivePay *accepted* the request, not that
      // money has actually landed. Mark "processing" here; the dedicated
      // livepay-payout-webhook function flips it to "paid" (or refunds and
      // marks "rejected") once LivePay calls back with the real outcome.
      const livepayUrl = Deno.env.get("LIVEPAY_URL")!;
      const livepayKey = Deno.env.get("LIVEPAY_API_KEY")!;
      const lpRes = await fetch(`${livepayUrl}/payout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${livepayKey}` },
        body: JSON.stringify({ amount: w.amount, phone: w.phone_number, method: w.method, reference: w.id }),
      });
      const lpData = await lpRes.json();
      if (!lpData.success) throw new Error(lpData.error ?? "LivePay payout failed");

      const { error: upErr } = await adminClient
        .from("withdrawals")
        .update({ status: "processing", livepay_ref: lpData.reference })
        .eq("id", body.withdrawalId);
      if (upErr) throw upErr;
      result = { processing: true };
    }

    // ── Reject withdrawal (refund balance) ───────────────────────
    else if (action === "reject_withdrawal") {
      const { data: w, error: wErr } = await adminClient
        .from("withdrawals")
        .select("id, status")
        .eq("id", body.withdrawalId)
        .single();
      if (wErr || !w) throw new Error("Withdrawal not found");

      // Guard against double-processing, same as approve_withdrawal.
      if (w.status !== "pending") {
        throw new Error(`Withdrawal is already ${w.status} — nothing to reject.`);
      }

      // Refund whichever bucket (referral/earnings) it was actually
      // deducted from — same RPC used when a LivePay payout fails, so
      // there's one source of truth for "how a withdrawal gets undone"
      // instead of this handler re-implementing it against a plain
      // `balance` column that isn't even where the money came from.
      const { error: refundErr } = await adminClient.rpc("refund_withdrawal_bucket", {
        p_withdrawal_id: body.withdrawalId,
      });
      if (refundErr) throw refundErr;

      const { error: upErr } = await adminClient
        .from("withdrawals")
        .update({ status: "rejected" })
        .eq("id", body.withdrawalId);
      if (upErr) throw upErr;

      result = { refunded: true };
    }

    // ── Suspend / restore user ───────────────────────────────────
    else if (action === "suspend_user") {
      const { error } = await adminClient
        .from("profiles")
        .update({ status: body.status })
        .eq("id", body.userId);
      if (error) throw error;
      result = { updated: true };
    }

    // ── Verify business ──────────────────────────────────────────
    else if (action === "verify_business") {
      const { error } = await adminClient
        .from("businesses")
        .update({ verified: true })
        .eq("id", body.businessId);
      if (error) throw error;
      result = { verified: true };
    }

    // ── Discredit task completion ────────────────────────────────
    else if (action === "discredit_task") {
      const { error } = await adminClient.rpc("admin_discredit_task", {
        p_completion_id: body.completionId,
        p_admin_id:      user.id,
      });
      if (error) throw error;
      result = { discredited: true };
    }

    // ── List KYC submissions ─────────────────────────────────────
    // Fetch kyc_submissions and profiles as two plain queries and merge
    // in JS, rather than a PostgREST embed (`profiles(name, phone)`).
    // The embed silently breaks the *entire* query — throwing before
    // any rows come back — if kyc_submissions.user_id isn't registered
    // as a recognized foreign key to profiles.id in the schema cache
    // (e.g. if it only references auth.users). This way a missing FK
    // just means blank name/phone instead of an empty queue.
    else if (action === "list_kyc_submissions") {
      let query = adminClient
        .from("kyc_submissions")
        .select("*")
        .order("submitted_at", { ascending: false });
      if (body.status) query = query.eq("status", body.status);
      const { data: subs, error } = await query;
      if (error) throw error;

      const userIds = [...new Set((subs ?? []).map((s) => s.user_id))];
      let profilesById: Record<string, unknown> = {};
      if (userIds.length) {
        const { data: profs, error: profErr } = await adminClient
          .from("profiles")
          .select("id, name, phone")
          .in("id", userIds);
        if (profErr) throw profErr;
        profilesById = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      }
      result = (subs ?? []).map((s) => ({ ...s, profiles: profilesById[s.user_id] ?? null }));
    }

    // ── Get a signed URL for a KYC document ──────────────────────
    // body.side must be 'front' or 'back' — matches front_path/back_path
    // on kyc_submissions, both stored in the private `kyc-documents` bucket.
    else if (action === "get_kyc_document_url") {
      if (body.side !== "front" && body.side !== "back") {
        throw new Error("side must be 'front' or 'back'");
      }
      const { data: sub, error: subErr } = await adminClient
        .from("kyc_submissions")
        .select("front_path, back_path")
        .eq("id", body.submissionId)
        .single();
      if (subErr || !sub) throw new Error("KYC submission not found");

      const path = body.side === "front" ? sub.front_path : sub.back_path;
      const { data: signed, error: signErr } = await adminClient
        .storage
        .from("kyc-documents")
        .createSignedUrl(path, 60 * 5); // 5 min expiry
      if (signErr) throw signErr;
      result = { url: signed.signedUrl };
    }

    // ── Approve KYC ───────────────────────────────────────────────
    else if (action === "approve_kyc") {
      const { data: sub, error: subErr } = await adminClient
        .from("kyc_submissions")
        .select("id, user_id, status")
        .eq("id", body.submissionId)
        .single();
      if (subErr || !sub) throw new Error("KYC submission not found");
      if (sub.status !== "pending") {
        throw new Error(`KYC submission is already ${sub.status} — nothing to approve.`);
      }

      // NOTE: reviewed_at/reviewed_by are not columns confirmed to exist
      // yet — add them via migration (see chat) or drop this block if
      // you don't want that audit trail.
      const { error: subUpErr } = await adminClient
        .from("kyc_submissions")
        .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: user.id })
        .eq("id", body.submissionId);
      if (subUpErr) throw subUpErr;

      // Keep both profile fields in sync — submitKyc() sets kyc_status
      // to "pending", so it needs to move to "approved" here too, not
      // just kyc_verified.
      const { error: profUpErr } = await adminClient
        .from("profiles")
        .update({ kyc_verified: true, kyc_status: "approved" })
        .eq("id", sub.user_id);
      if (profUpErr) throw profUpErr;

      result = { approved: true };
    }

    // ── Reject KYC ────────────────────────────────────────────────
    else if (action === "reject_kyc") {
      const { data: sub, error: subErr } = await adminClient
        .from("kyc_submissions")
        .select("id, status")
        .eq("id", body.submissionId)
        .single();
      if (subErr || !sub) throw new Error("KYC submission not found");
      if (sub.status !== "pending") {
        throw new Error(`KYC submission is already ${sub.status} — nothing to reject.`);
      }

      const { data: subRow } = await adminClient
        .from("kyc_submissions")
        .select("user_id")
        .eq("id", body.submissionId)
        .single();

      // Same audit-column caveat as approve_kyc above.
      const { error: upErr } = await adminClient
        .from("kyc_submissions")
        .update({
          status: "rejected",
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
          rejection_reason: body.reason ?? null,
        })
        .eq("id", body.submissionId);
      if (upErr) throw upErr;

      // Reset kyc_status so submitKyc()'s "already under review" guard
      // doesn't block the user's next attempt — submitKyc only blocks
      // on status !== 'rejected', so this just needs to not say 'pending'.
      if (subRow?.user_id) {
        await adminClient.from("profiles").update({ kyc_status: "rejected" }).eq("id", subRow.user_id);
      }

      result = { rejected: true };
    }

    else {
      throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});