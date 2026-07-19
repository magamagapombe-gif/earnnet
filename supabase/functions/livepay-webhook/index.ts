// supabase/functions/livepay-webhook/index.ts
// LivePay calls this URL when a deposit is confirmed or rejected
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LIVEPAY_API_KEY = Deno.env.get("LIVEPAY_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("LIVEPAY_WEBHOOK_SECRET")!;
// Must match byte-for-byte what's set as the "Collection Events" URL in the
// LivePay dashboard — it's part of the signed string.
const WEBHOOK_URL = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/livepay-webhook`;

async function verifySignature(sigHeader, status, customerRef, internalRef) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const received  = parts["v"];
  if (!timestamp || !received) return false;

  const stringToSign = WEBHOOK_URL + timestamp + status + customerRef + internalRef;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
  const expected = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected === received;
}

serve(async (req) => {
  // LivePay sends POST with JSON body
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // UPDATE: docs.livepay.me/webhooks confirms LivePay DOES support signed
    // webhooks (HMAC-SHA256 over webhook_url+timestamp+status+
    // customer_reference+internal_reference, sent as X-Webhook-Signature).
    // The note this replaced was written before that was known — we now
    // verify the signature below instead of trusting by reference alone.
    const body = await req.json();
    console.log("LivePay webhook received:", JSON.stringify(body));

    // LivePay uses customer_reference and "Success" (capital S)
    const reference = body.customer_reference ?? body.reference;
    const { status, amount, internal_reference } = body;

    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing reference" }), { status: 400 });
    }

    const sigHeader = req.headers.get("X-Webhook-Signature");
    const validSig = await verifySignature(sigHeader, status, reference, internal_reference ?? "");
    if (!validSig) {
      console.error("Invalid or missing webhook signature for deposit reference:", reference);
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
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
      .maybeSingle();

    if (depErr) {
      // A real query error (RLS, bad column, duplicate rows, etc) looks
      // identical to "no matching deposit" if we don't log it separately —
      // that's the difference between a fixable bug and a shrug.
      console.error("Deposit lookup query failed for reference:", reference, "—", depErr.message, depErr);
      return new Response(JSON.stringify({ error: "Lookup failed" }), { status: 500 });
    }
    if (!deposit) {
      console.error("Deposit not found for reference:", reference);
      // Return 200 so LivePay doesn't keep retrying for unknown references
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // Ignore if already confirmed (avoid double-crediting)
    if (deposit.status === "confirmed") {
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const normalizedStatus = String(status ?? "").trim().toLowerCase();
    const SUCCESS_STATUSES = new Set(["success", "successful", "completed"]);
    const FAILURE_STATUSES = new Set(["failed", "cancelled", "canceled", "rejected"]);

    // ── PAYMENT APPROVED ─────────────────────────────────────────
    if (SUCCESS_STATUSES.has(normalizedStatus)) {
      const isActivation = deposit.purpose === "activation";

      let creditSucceeded = true;

      if (isActivation) {
        // Activation payments are NOT credited to the spendable wallet
        // balance — they pay for account activation, full stop. Just
        // log it as its own transaction type for the user's history.
        const { error: actTxErr } = await supabase.from("transactions").insert({
          user_id:     deposit.user_id,
          amount:      0,
          type:        "activation",
          description: `Account activation fee paid via ${deposit.method}`,
          created_at:  new Date().toISOString(),
        });
        if (actTxErr) console.error("Activation transaction log insert failed (non-blocking):", actTxErr.message);
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
          const { data: profile, error: profErr } = await supabase
            .from("profiles")
            .select("balance")
            .eq("id", deposit.user_id)
            .single();

          if (profErr) {
            console.error("Fallback balance read failed:", profErr.message);
            creditSucceeded = false;
          } else {
            const { error: updErr } = await supabase
              .from("profiles")
              .update({ balance: (profile?.balance ?? 0) + creditAmount })
              .eq("id", deposit.user_id);

            const { error: txErr } = await supabase.from("transactions").insert({
              user_id:     deposit.user_id,
              amount:      creditAmount,
              type:        "deposit",
              description: `Wallet deposit via ${deposit.method}`,
              created_at:  new Date().toISOString(),
            });

            if (updErr || txErr) {
              console.error("Fallback balance credit failed:", updErr?.message, txErr?.message);
              creditSucceeded = false;
            }
          }
        }
      }

      if (!creditSucceeded) {
        // Do NOT mark this deposit confirmed — that would make it look
        // resolved in the admin/user-facing UI while the user's balance
        // was never actually touched. Returning 500 tells LivePay to
        // retry the webhook rather than silently accepting a payment
        // we failed to record.
        console.error(`🚨 Deposit ${deposit.id} for user ${deposit.user_id} received payment confirmation but crediting FAILED — left as "${deposit.status}", needs manual reconciliation.`);
        return new Response(JSON.stringify({ error: "Credit failed, will retry" }), { status: 500 });
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

      // ── Investment plan purchase ────────────────────────────────
      // This is the fix for the "money received, plan never bought"
      // incident: previously the ONLY place buy_vault_plan ever got
      // called was client-side, after the app itself polled and saw
      // the balance increase — meaning a locked phone, a backgrounded
      // app, or a closed tab right after entering the PIN could leave
      // the user credited-but-not-invested with nobody left to finish
      // the purchase. Now the webhook completes it itself, the moment
      // payment is confirmed, using the same atomic RPC the client
      // uses for a wallet-balance purchase — no client needs to be
      // present at all.
      if (deposit.purpose === "investment") {
        const { error: buyErr } = await supabase.rpc("buy_vault_plan", {
          p_user_id:    deposit.user_id,
          p_plan_level: deposit.plan_level,
          p_mode:       deposit.plan_mode ?? "manual",
        });

        if (buyErr) {
          // The payment WAS credited above — the user's money is safe
          // in their wallet balance. Only the purchase step failed, so
          // log loudly and leave a visible trail rather than silently
          // stranding them with a credited balance and no plan.
          console.error(`🚨 buy_vault_plan failed for deposit ${deposit.id} (user ${deposit.user_id}, level ${deposit.plan_level}, mode ${deposit.plan_mode}): ${buyErr.message} — funds are credited to wallet balance; plan purchase needs manual follow-up.`);
          const { error: flagTxErr } = await supabase.from("transactions").insert({
            user_id:     deposit.user_id,
            amount:      0,
            type:        "investment_purchase_failed",
            description: `Payment received but plan purchase failed (level ${deposit.plan_level}) — funds are in your wallet balance, contact support to complete the purchase.`,
            created_at:  new Date().toISOString(),
          });
          if (flagTxErr) console.error("Also failed to log the investment_purchase_failed flag row:", flagTxErr.message);
        } else {
          console.log(`✅ Investment plan purchased via webhook: level ${deposit.plan_level} (${deposit.plan_mode}) for user ${deposit.user_id}`);
        }
      }

      console.log(`✅ Deposit confirmed: ${deposit.amount} UGX for user ${deposit.user_id}`);
    }

    // ── PAYMENT FAILED / CANCELLED ───────────────────────────────
    else if (FAILURE_STATUSES.has(normalizedStatus)) {
      await supabase
        .from("deposits")
        .update({ status: "failed" })
        .eq("id", deposit.id);

      console.log(`❌ Deposit failed for reference: ${reference}`);
    }

    // ── UNRECOGNIZED STATUS ──────────────────────────────────────
    // This branch matters more than it looks: without it, any status
    // string LivePay sends that isn't in the two lists above (a new
    // value, different casing, a typo on either side) falls through
    // completely silently — no log line, no error, the deposit just
    // sits at "pending" forever and the money looks like it vanished.
    // If this incident is that failure mode, this line is what will
    // finally show up in the logs for it.
    else {
      console.error(`⚠️ Unrecognized LivePay status "${status}" for reference: ${reference} — deposit left as-is, needs manual review.`);
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