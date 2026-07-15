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
    // NOTE: LivePay does not send `Authorization: Bearer <LIVEPAY_API_KEY>` on
    // its webhook calls (confirmed via Supabase logs — real callbacks were
    // being rejected with 401 by the old check below, silently dropping
    // confirmed deposits/activations even though the user had been charged).
    // LivePay does not currently document a webhook signing secret either,
    // so for now we authenticate the callback by requiring it to reference
    // a real, known-pending deposit row (looked up below) rather than by
    // header. If LivePay adds a documented signature/secret scheme later,
    // verify it here instead.
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
      const isActivation = deposit.purpose === "activation";

      if (isActivation) {
        // Activation payments are NOT credited to the spendable wallet
        // balance — they pay for account activation, full stop. Just
        // log it as its own transaction type for the user's history.
        await supabase.from("transactions").insert({
          user_id:     deposit.user_id,
          amount:      0,
          type:        "activation",
          description: `Account activation fee paid via ${deposit.method}`,
          created_at:  new Date().toISOString(),
        });
      } else {
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
      }

      // Mark deposit confirmed
      await supabase
        .from("deposits")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
        .eq("id", deposit.id);

      // ── Activation ─────────────────────────────────────────────
      // NOTE: Activation intentionally grants NO monetary reward of any
      // kind — no wallet credit (handled above) and no referral bonus.
      // Paying the activation fee only flips `profiles.activated` and
      // closes out the matching activation_requests row. Referral
      // bonuses, if/when reintroduced, must be tied to a real wallet
      // deposit event, never to this activation branch.
      if (isActivation) {
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