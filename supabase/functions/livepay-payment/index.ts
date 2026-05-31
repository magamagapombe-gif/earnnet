// supabase/functions/livepay-payment/index.ts
// Handles both deposits (collect-money) and withdrawals (send-money) via LivePay API
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LIVEPAY_API_KEY     = Deno.env.get("LIVEPAY_API_KEY")!;
const LIVEPAY_ACCOUNT_NUM = Deno.env.get("LIVEPAY_ACCOUNT_NUM")!;
const LIVEPAY_BASE_URL    = "https://livepay.me/api";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Create Supabase client using the caller's JWT so RLS applies
    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { action, amount, phone, method, userId } = await req.json();

    // Ensure the user can only act on their own account
    if (userId !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── DEPOSIT (collect money FROM user) ─────────────────────
    if (action === "deposit") {
      const reference = `DEP-${userId.slice(0,8)}-${Date.now()}`.slice(0, 30);

      // Load platform deposit fee % from settings (default 3% to cover LivePay fee)
      const { data: settingsRows } = await supabase.from("settings").select("*");
      const s = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));
      const feePct     = parseFloat(s.deposit_fee_pct ?? "3");
      const platformFee = Math.ceil(amount * feePct / 100);
      const chargedAmount = amount + platformFee; // user pays this (e.g. 10000 + 300 = 10300)
      // amount is credited to wallet; chargedAmount is collected from phone

      // 1. Insert deposit record as "pending"
      const { data: deposit, error: dbErr } = await supabase
        .from("deposits")
        .insert({
          user_id:      userId,
          amount,                  // amount credited to wallet
          charged_amount: chargedAmount, // amount collected from phone
          platform_fee: platformFee,
          method,
          phone_number: phone,
          status:       "pending",
          reference,
        })
        .select()
        .single();

      if (dbErr) throw new Error(dbErr.message);

      // 2. Call LivePay collect-money (charge user chargedAmount, credit them amount)
      const lpRes = await fetch(`${LIVEPAY_BASE_URL}/collect-money`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${LIVEPAY_API_KEY}`,
        },
        body: JSON.stringify({
          accountNumber: LIVEPAY_ACCOUNT_NUM,
          phoneNumber:   phone,
          amount:        chargedAmount,
          currency:      "UGX",
          reference,
          description:   "EarnNet wallet deposit",
        }),
      });

      const lpData = await lpRes.json();

      if (!lpRes.ok || !lpData.success) {
        // Mark deposit as failed
        await supabase.from("deposits").update({ status: "failed" }).eq("id", deposit.id);
        throw new Error(lpData.error ?? "LivePay collection failed");
      }

      // 3. Update deposit with LivePay reference & mark processing
      await supabase.from("deposits").update({
        status:       "processing",
        livepay_ref:  lpData.internal_reference,
      }).eq("id", deposit.id);

      return new Response(JSON.stringify({
        success:   true,
        message:   "Payment prompt sent to your phone. Approve it to complete the deposit.",
        reference: lpData.reference,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── WITHDRAWAL (send money TO user) ───────────────────────
    if (action === "withdraw") {
      // 1. Fetch user profile & check balance
      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("balance, activated")
        .eq("id", userId)
        .single();

      if (profErr || !profile) throw new Error("Profile not found");
      if (!profile.activated)   throw new Error("Account not activated");
      if (profile.balance < amount) throw new Error("Insufficient balance");

      const reference = `WIT-${userId.slice(0,8)}-${Date.now()}`.slice(0, 30);

      // 2. Deduct balance immediately & insert withdrawal record
      const { error: rpcErr } = await supabase.rpc("deduct_balance_for_withdrawal", {
        p_user_id:   userId,
        p_amount:    amount,
        p_reference: reference,
        p_method:    method,
        p_phone:     phone,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      // 3. Get the new withdrawal record
      const { data: withdrawal } = await supabase
        .from("withdrawals")
        .select("id")
        .eq("reference", reference)
        .single();

      // 4. Call LivePay send-money
      const lpRes = await fetch(`${LIVEPAY_BASE_URL}/send-money`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${LIVEPAY_API_KEY}`,
        },
        body: JSON.stringify({
          accountNumber: LIVEPAY_ACCOUNT_NUM,
          phoneNumber:   phone,
          amount,
          currency:      "UGX",
          reference,
          description:   "EarnNet withdrawal payout",
        }),
      });

      const lpData = await lpRes.json();

      if (!lpRes.ok || !lpData.success) {
        // Refund balance if LivePay fails
        await supabase.rpc("refund_withdrawal", { p_withdrawal_id: withdrawal?.id });
        throw new Error(lpData.error ?? "LivePay payout failed");
      }

      // 5. Mark withdrawal as processing with LivePay ref
      await supabase.from("withdrawals").update({
        status:      "processing",
        livepay_ref: lpData.internal_reference,
      }).eq("reference", reference);

      return new Response(JSON.stringify({
        success: true,
        message: "Withdrawal is being processed. Funds will arrive shortly.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
