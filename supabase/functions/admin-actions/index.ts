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
      const { data, error } = await adminClient.from("tasks").insert({
        ...body.task,
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

      // Call LivePay to send money
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
        .update({ status: "paid", livepay_ref: lpData.reference, paid_at: new Date().toISOString() })
        .eq("id", body.withdrawalId);
      if (upErr) throw upErr;
      result = { paid: true };
    }

    // ── Reject withdrawal (refund balance) ───────────────────────
    else if (action === "reject_withdrawal") {
      const { data: w, error: wErr } = await adminClient
        .from("withdrawals")
        .select("user_id, amount")
        .eq("id", body.withdrawalId)
        .single();
      if (wErr || !w) throw new Error("Withdrawal not found");

      // Refund balance
      const { data: profile } = await adminClient
        .from("profiles")
        .select("balance")
        .eq("id", w.user_id)
        .single();
      await adminClient
        .from("profiles")
        .update({ balance: (profile?.balance ?? 0) + w.amount })
        .eq("id", w.user_id);

      await adminClient
        .from("withdrawals")
        .update({ status: "rejected" })
        .eq("id", body.withdrawalId);

      // Log refund transaction
      await adminClient.from("transactions").insert({
        user_id: w.user_id,
        amount: w.amount,
        type: "refund",
        description: "Withdrawal rejected — balance refunded",
        created_at: new Date().toISOString(),
      });
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
