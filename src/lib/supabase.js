// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables, then redeploy."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Auth helpers ───────────────────────────────────────────────

// Convert phone to a valid email Supabase will accept: u<digits>@earnnet.app
function phoneToEmail(phone) {
  return `u${phone.replace(/\D/g, "")}@earnnet.app`;
}

export async function signUpWithPhone(phone, password, name, referralCode) {
  const email = phoneToEmail(phone);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone, referral_code: referralCode } },
  });
  if (error) throw error;
  return data;
}

export async function signInWithPhone(phone, password) {
  const email = phoneToEmail(phone);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// ── Profile ────────────────────────────────────────────────────

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
  if (error) throw error;
}

// ── Tasks ──────────────────────────────────────────────────────

export async function getActiveTasks(userId) {
  const { data: completed } = await supabase
    .from("task_completions")
    .select("task_id")
    .eq("user_id", userId);
  const completedIds = (completed ?? []).map((c) => c.task_id);

  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, business, type, subtype, link, duration_seconds, icon, color, text_color, reward, budget, used, limit_count, completions, time_est, description, status")
    .eq("status", "active");
  if (error) throw error;

  return (data ?? []).filter((t) => !completedIds.includes(t.id));
}

export async function completeTask(userId, taskId, proofBase64) {
  // Upload proof screenshot if provided (TikTok tasks)
  let proofUrl = null;
  if (proofBase64) {
    const base64Data = proofBase64.split(",")[1];
    const byteChars  = atob(base64Data);
    const byteArr    = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob     = new Blob([byteArr], { type: "image/jpeg" });
    const fileName = `proof/${userId}/${taskId}-${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage.from("task-proofs").upload(fileName, blob, { upsert: true });
    if (!upErr) {
      const { data: urlData } = supabase.storage.from("task-proofs").getPublicUrl(fileName);
      proofUrl = urlData.publicUrl;
    }
  }

  const { data, error } = await supabase.rpc("complete_task", {
    p_user_id:  userId,
    p_task_id:  taskId,
    p_proof_url: proofUrl,
  });
  if (error) throw error;
  return data;
}

// ── Transactions ───────────────────────────────────────────────

export async function getTransactions(userId, limit = 20) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ── Withdrawals (via LivePay Edge Function) ────────────────────

export async function requestWithdrawal(userId, amount, method, phone) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/livepay-payment`,
    {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "withdraw", userId, amount, method, phone }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error ?? "Withdrawal failed");
  return data;
}

export async function getUserWithdrawals(userId) {
  const { data, error } = await supabase
    .from("withdrawals")
    .select("*")
    .eq("user_id", userId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── Deposits (via LivePay Edge Function) ──────────────────────

export async function requestDeposit(userId, amount, method, phone) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/livepay-payment`,
    {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "deposit", userId, amount, method, phone }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error ?? "Deposit failed");
  return data;
}

export async function getUserDeposits(userId) {
  const { data, error } = await supabase
    .from("deposits")
    .select("*")
    .eq("user_id", userId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── Account Activation ─────────────────────────────────────────

export async function activateAccount(userId, method, phone) {
  // Trigger LivePay collect for activation fee — reuses deposit flow
  const { data: { session } } = await supabase.auth.getSession();
  const { data: settings } = await supabase.from("settings").select("*");
  const s = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value]));
  const fee = parseInt(s.activation_fee ?? 5000);

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/livepay-payment`,
    {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "deposit", userId, amount: fee, method, phone }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error ?? "Activation payment failed");

  // Also log activation request for admin visibility
  await supabase.from("activation_requests").insert({
    user_id:      userId,
    method,
    phone_number: phone,
    status:       "pending",
  });

  return data;
}

// ── Referrals ──────────────────────────────────────────────────

export async function getReferralTree(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, initials, created_at, balance, activated")
    .eq("referred_by", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── Settings ───────────────────────────────────────────────────

export async function getSettings() {
  const { data } = await supabase.from("settings").select("*");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

// ── Admin: process withdrawal via LivePay API ──────────────────

export async function adminProcessWithdrawal(withdrawalId) {
  const { data, error } = await supabase.rpc("admin_process_withdrawal", {
    p_withdrawal_id: withdrawalId,
  });
  if (error) throw error;
  return data;
}

// ── Admin helpers (all go through Edge Function with service role) ──

async function adminFetch(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-actions`,
    {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error ?? "Admin action failed");
  return data;
}

export async function adminCreateTask(task) {
  return adminFetch({ action: "create_task", task });
}

export async function adminToggleTask(taskId, status) {
  return adminFetch({ action: "toggle_task", taskId, status });
}

export async function adminSaveSettings(settings) {
  return adminFetch({ action: "save_settings", settings });
}

export async function adminApproveWithdrawal(withdrawalId) {
  return adminFetch({ action: "approve_withdrawal", withdrawalId });
}

export async function adminRejectWithdrawal(withdrawalId) {
  return adminFetch({ action: "reject_withdrawal", withdrawalId });
}

export async function adminSuspendUser(userId, status) {
  return adminFetch({ action: "suspend_user", userId, status });
}

export async function adminVerifyBusiness(businessId) {
  return adminFetch({ action: "verify_business", businessId });
}

export async function adminDiscreditTask(completionId) {
  return adminFetch({ action: "discredit_task", completionId });
}

// ════════════════════════════════════════════════════════════════
//  EarnNet GROW — Investment & VIP Tier Functions
// ════════════════════════════════════════════════════════════════

// ── Investment Plans ───────────────────────────────────────────

/** Fetch all vault plan tiers (server-side source of truth).
 *  Not currently used by EarnNet.jsx — the UI keeps its own
 *  VAULT_PLANS ladder for instant rendering — but kept in sync
 *  with the `vault_plans` table for admin tooling / future use. */
export async function getInvestmentPlans() {
  const { data, error } = await supabase
    .from("vault_plans")
    .select("*")
    .order("level");
  if (error) throw error;
  return data ?? [];
}

/** Fetch all investments for a user (active + paid_out).
 *  Every field needed for display (name, icon, amount, rate,
 *  duration, vip tier, profit) is snapshotted directly onto each
 *  row at purchase time, so no join is needed. */
export async function getUserInvestments(userId) {
  const { data, error } = await supabase
    .from("user_investments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Buy a vault plan tier. Amount, task reward, and duration are all
 * fixed per level and looked up server-side from `vault_plans` — the
 * RPC never trusts a client-supplied amount/duration, so only the
 * level is sent. The LivePay deposit (if paying by mobile money)
 * must already be confirmed and sitting in the user's balance BEFORE
 * calling this — call it in the same polling-success callback you
 * use for deposits. Pays 2-level referral commission out of the
 * plan's amount server-side.
 */
export async function buyInvestmentPlan(userId, planLevel) {
  const { data, error } = await supabase.rpc("buy_vault_plan", {
    p_user_id:    userId,
    p_plan_level: planLevel,
  });
  if (error) throw error;
  return data;
}

/**
 * Reinvest: start a new plan tier using existing balance (e.g. a
 * matured payout) instead of a fresh mobile-money payment. No
 * referral commission is paid — it isn't new external money.
 */
export async function reinvestFromBalance(userId, planLevel) {
  const { data, error } = await supabase.rpc("reinvest_from_balance", {
    p_user_id:    userId,
    p_plan_level: planLevel,
  });
  if (error) throw error;
  return data;
}

/**
 * Request payment for an investment plan via LivePay.
 * Returns when the MoMo prompt has been sent — poll for balance
 * change using useDepositPolling, then call buyInvestmentPlan.
 */
export async function requestInvestmentPayment(userId, amount, method, phone) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/livepay-payment`,
    {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "deposit", userId, amount, method, phone }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error ?? "Payment failed");
  return data;
}

/**
 * Check & credit any matured investments for this user — pays out
 * principal + profit + any locked task earnings that accrued while
 * the plan was active. Safe to call on every app load — idempotent.
 */
export async function matureUserInvestments(userId) {
  const { data, error } = await supabase.rpc("mature_due_investments", {
    p_user_id: userId,
  });
  if (error) throw error;
  return data ?? 0; // returns count of investments matured
}