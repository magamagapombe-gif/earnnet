// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Auth helpers ───────────────────────────────────────────────

export async function signUpWithPhone(phone, password, name, referralCode) {
  const email = `${phone.replace(/\D/g, "")}@earnnet.app`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone, referral_code: referralCode } },
  });
  if (error) throw error;
  return data;
}

export async function signInWithPhone(phone, password) {
  const email = `${phone.replace(/\D/g, "")}@earnnet.app`;
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
    .select("*")
    .eq("status", "active");
  if (error) throw error;

  return (data ?? []).filter((t) => !completedIds.includes(t.id));
}

export async function completeTask(userId, taskId) {
  const { data, error } = await supabase.rpc("complete_task", {
    p_user_id: userId,
    p_task_id: taskId,
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

// ── Withdrawals ────────────────────────────────────────────────

export async function requestWithdrawal(userId, amount, method, phoneNumber) {
  const { data, error } = await supabase.rpc("request_withdrawal", {
    p_user_id: userId,
    p_amount: amount,
    p_method: method,
    p_phone_number: phoneNumber,
  });
  if (error) throw error;
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

// ── Deposits ───────────────────────────────────────────────────

export async function requestDeposit(userId, amount, method, phoneNumber) {
  const { data, error } = await supabase
    .from("deposits")
    .insert({
      user_id: userId,
      amount,
      method,
      phone_number: phoneNumber,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
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

export async function activateAccount(userId, method, phoneNumber) {
  // Insert an activation request record; admin will confirm and flip profile.activated = true
  const { data, error } = await supabase
    .from("activation_requests")
    .insert({
      user_id: userId,
      method,
      phone_number: phoneNumber,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
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
