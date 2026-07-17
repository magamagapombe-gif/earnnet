// supabase/functions/livepay-payout-webhook/index.ts
// LivePay calls this URL when a payout (withdrawal) is confirmed or fails.
// Mirrors livepay-webhook (deposits), but for the withdrawals table, and
// refunds the user's bucket balance on failure instead of crediting it.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  // LivePay sends POST with JSON body
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // NOTE: same auth situation as livepay-webhook (deposits) — LivePay does
    // not send an Authorization header or a documented signing secret on its
    // webhook calls. We authenticate the callback by requiring it to
    // reference a real, known withdrawal row rather than by header. If
    // LivePay adds a documented signature scheme later, verify it here.
    const body = await req.json();
    console.log("LivePay payout webhook received:", JSON.stringify(body));

    // approve_withdrawal (admin-actions) sends `reference: w.id` when it
    // initiates the payout, so LivePay should echo that back as
    // customer_reference — same shape as the deposit webhook.
    const reference = body.customer_reference ?? body.reference;
    const { status, internal_reference } = body;

    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing reference" }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find the withdrawal by its own id (the reference we sent LivePay) or
    // by the livepay_ref we stored when initiating the payout.
    const { data: withdrawal, error: wErr } = await supabase
      .from("withdrawals")
      .select("*")
      .or(`id.eq.${reference},livepay_ref.eq.${internal_reference ?? reference}`)
      .single();

    if (wErr || !withdrawal) {
      console.error("Withdrawal not found for reference:", reference);
      // Return 200 so LivePay doesn't keep retrying for an unknown reference
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // Only act on withdrawals we're actually waiting on. Guards against
    // double-processing (retried callback, or a withdrawal an admin already
    // resolved some other way).
    if (withdrawal.status !== "processing") {
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // ── PAYOUT CONFIRMED ─────────────────────────────────────────
    if (status === "Success" || status === "successful" || status === "success" || status === "completed") {
      const { error: upErr } = await supabase
        .from("withdrawals")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", withdrawal.id);
      if (upErr) throw upErr;

      console.log(`✅ Payout confirmed: ${withdrawal.amount} UGX for withdrawal ${withdrawal.id}`);
    }

    // ── PAYOUT FAILED ────────────────────────────────────────────
    // The money never reached the user, so refund whichever bucket it was
    // deducted from at request time — same RPC used when an admin manually
    // rejects a still-pending withdrawal, so there's one source of truth
    // for "how a withdrawal gets undone".
    else if (status === "Failed" || status === "failed" || status === "cancelled" || status === "rejected") {
      const { error: refundErr } = await supabase.rpc("refund_withdrawal_bucket", {
        p_withdrawal_id: withdrawal.id,
      });
      if (refundErr) throw refundErr;

      const { error: upErr } = await supabase
        .from("withdrawals")
        .update({ status: "rejected" })
        .eq("id", withdrawal.id);
      if (upErr) throw upErr;

      console.log(`❌ Payout failed, refunded withdrawal ${withdrawal.id}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Payout webhook error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }
});
