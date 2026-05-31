// supabase/functions/livepay-webhook/index.ts
// LivePay calls this URL when a deposit is confirmed or rejected
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LIVEPAY_API_KEY = Deno.env.get("LIVEPAY_API_KEY")!;

serve(async (req) => {
  // LivePay sends POST with JSON body
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Optional: verify the webhook is genuinely from LivePay
    const signature = req.headers.get("x-livepay-signature") ?? "";
    // If LivePay provides a webhook secret, verify here. For now we verify
    // the API key header they send back:
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader && authHeader !== `Bearer ${LIVEPAY_API_KEY}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const body = await req.json();
    console.log("LivePay webhook received:", JSON.stringify(body));

    // LivePay webhook payload shape (adjust field names to match their actual API):
    // { reference, status, amount, phone, internal_reference, ... }
    // LivePay uses customer_reference and "Success" (capital S)
    const reference = body.customer_reference ?? body.reference;
    const { status, amount, internal_reference } = body;

    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing reference" }), { status: 400 });
    }

    // Use service role to bypass RLS for crediting balance
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find the deposit by reference
    const { data: deposit, error: depErr } = await supabase
      .from("deposits")
      .select("*")
      .or(`reference.eq.${reference},livepay_ref.eq.${internal_reference ?? reference}`)
      .single();

    if (depErr || !deposit) {
      console.error("Deposit not found for reference:", reference);
      // Return 200 so LivePay doesn't keep retrying for unknown references
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // Ignore if already confirmed (avoid double-crediting)
    if (deposit.status === "confirmed") {
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // ── PAYMENT APPROVED ─────────────────────────────────────────
    if (status === "Success" || status === "successful" || status === "success" || status === "completed") {
      // The deposit.amount is what the user was charged (including our platform fee).
      // We credit exactly deposit.amount to their wallet — the fee was already collected
      // on top by the livepay-payment function when it added deposit_fee_pct to the request.
      // So credit the full deposit.amount as-is.
      const creditAmount = deposit.amount;

      // Credit user balance using RPC (atomic)
      const { error: rpcErr } = await supabase.rpc("credit_deposit", {
        p_user_id:    deposit.user_id,
        p_amount:     creditAmount,
        p_deposit_id: deposit.id,
      });

      if (rpcErr) {
        console.error("credit_deposit RPC failed:", rpcErr.message);
        const { data: profile } = await supabase
          .from("profiles")
          .select("balance")
          .eq("id", deposit.user_id)
          .single();

        await supabase
          .from("profiles")
          .update({ balance: (profile?.balance ?? 0) + creditAmount })
          .eq("id", deposit.user_id);

        await supabase.from("transactions").insert({
          user_id:     deposit.user_id,
          amount:      creditAmount,
          type:        "deposit",
          description: `Wallet deposit via ${deposit.method}`,
          created_at:  new Date().toISOString(),
        });
      }

      // Mark deposit confirmed
      await supabase
        .from("deposits")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
        .eq("id", deposit.id);

      // ── Referral bonus on activation ──────────────────────────
      // If this deposit was an activation fee payment, credit the referrer
      const { data: activation } = await supabase
        .from("activation_requests")
        .select("user_id")
        .eq("user_id", deposit.user_id)
        .eq("status", "pending")
        .single();

      if (activation) {
        // Load referral bonus amount from settings
        const { data: settingsRows } = await supabase.from("settings").select("*");
        const s = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));
        const refBonus = parseInt(s.ref1_rate ?? "3000");

        // Get who referred this user
        const { data: userProfile } = await supabase
          .from("profiles")
          .select("referred_by, name")
          .eq("id", deposit.user_id)
          .single();

        if (userProfile?.referred_by) {
          // Credit referrer
          await supabase
            .from("profiles")
            .update({ balance: supabase.rpc("increment_balance", { uid: userProfile.referred_by, amt: refBonus }) })
            .eq("id", userProfile.referred_by);

          // Simpler: direct increment
          const { data: refProfile } = await supabase
            .from("profiles")
            .select("balance")
            .eq("id", userProfile.referred_by)
            .single();

          await supabase
            .from("profiles")
            .update({ balance: (refProfile?.balance ?? 0) + refBonus })
            .eq("id", userProfile.referred_by);

          // Log referral transaction
          await supabase.from("transactions").insert({
            user_id:     userProfile.referred_by,
            amount:      refBonus,
            type:        "referral",
            description: `Referral bonus — ${userProfile.name} activated`,
            created_at:  new Date().toISOString(),
          });

          console.log(`✅ Referral bonus ${refBonus} UGX credited to ${userProfile.referred_by}`);
        }

        // Mark user as activated and close activation request
        await supabase
          .from("profiles")
          .update({ activated: true })
          .eq("id", deposit.user_id);

        await supabase
          .from("activation_requests")
          .update({ status: "confirmed" })
          .eq("user_id", deposit.user_id)
          .eq("status", "pending");
      }

      console.log(`✅ Deposit confirmed: ${deposit.amount} UGX for user ${deposit.user_id}`);
    }

    // ── PAYMENT FAILED / CANCELLED ───────────────────────────────
    else if (status === "Failed" || status === "failed" || status === "cancelled" || status === "rejected") {
      await supabase
        .from("deposits")
        .update({ status: "failed" })
        .eq("id", deposit.id);

      console.log(`❌ Deposit failed for reference: ${reference}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Webhook error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }
});
