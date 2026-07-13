// src/pages/AdminApp.jsx  –  Admin panel wired to Supabase
import { useState, useEffect } from "react";
import { supabase, adminApproveWithdrawal, adminRejectWithdrawal, adminSuspendUser, adminVerifyBusiness, adminCreateTask, adminToggleTask, adminSaveSettings } from "../lib/supabase";

const fmt = (n) => "UGX " + Number(n || 0).toLocaleString();

// ── Simple admin auth (Supabase email/password for admin user) ─
function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pwd, setPwd]     = useState("");
  const [err, setErr]     = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setErr(""); setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
      if (error) throw error;
      onLogin();
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F2D22" }}>
      <div style={{ background: "white", borderRadius: 20, padding: 36, width: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#1D9E75", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, color: "white" }}>E</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>EarnNet <span style={{ color: "#1D9E75" }}>Admin</span></div>
            <div style={{ fontSize: 11, color: "#aaa" }}>Secure access only</div>
          </div>
        </div>
        {err && <div style={{ background: "#FAECE7", color: "#993C1D", borderRadius: 8, padding: "10px 12px", fontSize: 12, marginBottom: 14 }}>{err}</div>}
        <label style={A.label}>Admin email</label>
        <input style={A.input} type="email" placeholder="admin@earnnet.app" value={email} onChange={e => setEmail(e.target.value)} />
        <label style={A.label}>Password</label>
        <input style={A.input} type="password" placeholder="••••••••" value={pwd} onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <button style={{ ...A.primaryBtn, width: "100%", padding: "12px 0", marginTop: 8 }} onClick={handleLogin} disabled={loading}>
          {loading ? "Signing in..." : "Sign in →"}
        </button>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const [authed, setAuthed]     = useState(false);
  const [tab, setTab]           = useState("overview");
  const [users, setUsers]       = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [tasks, setTasks]       = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [settings, setSettings] = useState({});
  const [stats, setStats]       = useState({});
  const [investments, setInvestments] = useState([]);
  const [invPlans, setInvPlans] = useState([]);
  const [toast, setToast]       = useState(null);
  const [userSearch, setUserSearch] = useState("");
  const [taskModal, setTaskModal] = useState(false);
  const [planModal, setPlanModal] = useState(null); // null | plan object | "new"
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setAuthed(true);
    });
  }, []);

  useEffect(() => {
    if (!authed) return;
    loadAll();
    // Realtime withdrawals
    const channel = supabase.channel("admin-withdrawals")
      .on("postgres_changes", { event: "*", schema: "public", table: "withdrawals" }, loadWithdrawals)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [authed]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadUsers(), loadWithdrawals(), loadTasks(), loadBusinesses(), loadSettings(), loadStats(), loadInvestments()]);
    setLoading(false);
  }

  async function loadInvestments() {
    const { data: invData } = await supabase
      .from("user_investments")
      .select("*, profiles(name, phone, vip_tier), investment_plans(name, daily_rate, duration_days)")
      .order("created_at", { ascending: false });
    setInvestments(invData ?? []);
    const { data: planData } = await supabase
      .from("investment_plans")
      .select("*")
      .order("sort_order");
    setInvPlans(planData ?? []);
  }

  async function loadUsers() {
    const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    setUsers(data ?? []);
  }

  async function loadWithdrawals() {
    const { data } = await supabase.from("withdrawals")
      .select("*, profiles(name, phone)")
      .order("requested_at", { ascending: false });
    setWithdrawals(data ?? []);
  }

  async function loadTasks() {
    const { data } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    setTasks(data ?? []);
  }

  async function loadBusinesses() {
    const { data } = await supabase.from("businesses").select("*").order("joined_at", { ascending: false });
    setBusinesses(data ?? []);
  }

  async function loadSettings() {
    const { data } = await supabase.from("settings").select("*");
    const obj = Object.fromEntries((data ?? []).map(r => [r.key, r.value]));
    setSettings(obj);
  }

  async function loadStats() {
    const [{ count: totalUsers }, { count: activeToday }, paidOut, pending, invActive] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("*", { count: "exact", head: true }).gte("last_login", new Date().toISOString().slice(0,10)),
      supabase.from("transactions").select("amount").eq("type", "withdrawal"),
      supabase.from("withdrawals").select("amount").eq("status", "pending"),
      supabase.from("user_investments").select("amount").eq("status", "active"),
    ]);
    const totalPaidOut       = (paidOut.data ?? []).reduce((s, t) => s + Math.abs(t.amount), 0);
    const pendingWithdrawals = (pending.data ?? []).reduce((s, t) => s + t.amount, 0);
    const totalInvested      = (invActive.data ?? []).reduce((s, t) => s + t.amount, 0);
    setStats({ totalUsers: totalUsers ?? 0, activeToday: activeToday ?? 0, totalPaidOut, pendingWithdrawals, totalInvested });
  }

  const handlePlanSave = async (planData) => {
    try {
      const minAmount = parseInt(planData.min_amount);
      const rate1m    = parseFloat(planData.rate_1m) / 100;
      const row = {
        name:           planData.name,
        min_amount:     minAmount,
        amount:         minAmount,               // legacy column, kept in sync
        rate_1m:        rate1m,
        rate_3m:        parseFloat(planData.rate_3m) / 100,
        rate_6m:        parseFloat(planData.rate_6m) / 100,
        rate_12m:       parseFloat(planData.rate_12m) / 100,
        daily_rate:     rate1m / 30,              // legacy column, kept in sync
        duration_days:  30,                       // legacy column, kept in sync
        task_limit:     planData.task_limit === "" ? null : parseInt(planData.task_limit),
        multiplier:     parseFloat(planData.multiplier),
        is_active:      planData.is_active,
      };
      if (planData.id) {
        await supabase.from("investment_plans").update(row).eq("id", planData.id);
      } else {
        await supabase.from("investment_plans").insert({
          ...row,
          sort_order: invPlans.length + 1,
          is_active: true,
        });
      }
      showToast("Plan saved ✓");
      setPlanModal(null);
      loadInvestments();
    } catch (e) { showToast(e.message ?? "Save failed", "error"); }
  };

  const handleApprove = async (id) => {
    try {
      await adminApproveWithdrawal(id);
      showToast("Withdrawal approved & sent via LivePay ✓");
      loadWithdrawals(); loadStats();
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleReject = async (id) => {
    try {
      await adminRejectWithdrawal(id);
      showToast("Withdrawal rejected & balance refunded");
      loadWithdrawals(); loadStats();
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleSuspendUser = async (id, currentStatus) => {
    try {
      const newStatus = currentStatus === "suspended" ? "active" : "suspended";
      await adminSuspendUser(id, newStatus);
      showToast("User status updated");
      loadUsers();
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleVerifyBusiness = async (id) => {
    try {
      await adminVerifyBusiness(id);
      showToast("Business verified ✓");
      loadBusinesses();
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleToggleTask = async (id, currentStatus) => {
    try {
      const newStatus = currentStatus === "active" ? "paused" : "active";
      await adminToggleTask(id, newStatus);
      showToast("Task status updated");
      loadTasks();
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleSaveSettings = async (newSettings) => {
    try {
      await adminSaveSettings(newSettings);
      showToast("Settings saved ✓");
    } catch (e) { showToast(e.message ?? "Save failed", "error"); }
  };

  const handleCreateTask = async (formData) => {
    try {
      await adminCreateTask({
        title: formData.title, business: formData.business, type: formData.type,
        subtype: formData.subtype || null,
        link: formData.link || null,
        duration_seconds: parseInt(formData.duration_seconds) || 60,
        icon: formData.icon, reward: parseInt(formData.reward), budget: parseInt(formData.budget),
        limit_count: parseInt(formData.limit), category: formData.type,
        color: "#E1F5EE", text_color: "#0F6E56", time_est: `${Math.ceil((parseInt(formData.duration_seconds)||60)/60)} min`,
      });
      showToast("Task created ✓");
      setTaskModal(false);
      loadTasks();
    } catch (e) { showToast(e.message, "error"); }
  };

  const filteredUsers = users.filter(u =>
    u.name?.toLowerCase().includes(userSearch.toLowerCase()) || u.phone?.includes(userSearch)
  );

  const pendingCount    = withdrawals.filter(w => w.status === "pending").length;
  const unverifiedBiz   = businesses.filter(b => !b.verified).length;

  if (!authed) return <AdminLogin onLogin={() => setAuthed(true)} />;

  return (
    <div style={A.shell}>
      {/* Sidebar */}
      <div style={A.sidebar}>
        <div style={A.sidebarLogo}>
          <div style={A.logoIcon}>E</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "white" }}>Earn<span style={{ color: "#5DCAA5" }}>Net</span></div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 1 }}>Admin Panel</div>
          </div>
        </div>
        <nav style={{ flex: 1 }}>
          {[
            { id: "overview",    icon: "📊", label: "Overview" },
            { id: "users",       icon: "👥", label: "Users" },
            { id: "withdrawals", icon: "💸", label: "Withdrawals", badge: pendingCount },
            { id: "tasks",       icon: "📋", label: "Tasks" },
            { id: "grow",        icon: "🌱", label: "Grow / Invest" },
            { id: "businesses",  icon: "🏢", label: "Businesses", badge: unverifiedBiz },
            { id: "settings",    icon: "⚙️", label: "Settings" },
          ].map(item => (
            <button key={item.id} onClick={() => setTab(item.id)}
              style={{ ...A.navItem, ...(tab === item.id ? A.navItemActive : {}) }}>
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge > 0 && <span style={A.navBadge}>{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.1)", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
          <button onClick={() => supabase.auth.signOut().then(() => setAuthed(false))}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 12 }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={A.main}>
        <div style={A.topbar}>
          <div style={{ fontWeight: 700, fontSize: 20 }}>
            {{ overview: "Dashboard Overview", users: "User Management", withdrawals: "Withdrawals",
               tasks: "Task Management", grow: "Grow & Investment Plans", businesses: "Businesses", settings: "Settings" }[tab]}
          </div>
          <div style={{ fontSize: 13, color: "#888" }}>{new Date().toDateString()}</div>
        </div>

        <div style={A.content}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: "#888" }}>Loading data...</div>
          ) : (
            <>
              {tab === "overview"    && <OverviewTab stats={stats} withdrawals={withdrawals} tasks={tasks} onApprove={handleApprove} />}
              {tab === "users"       && <UsersTab users={filteredUsers} search={userSearch} setSearch={setUserSearch} onSuspend={handleSuspendUser} />}
              {tab === "withdrawals" && <WithdrawalsTab withdrawals={withdrawals} onApprove={handleApprove} onReject={handleReject} />}
              {tab === "tasks"       && <TasksTab tasks={tasks} onToggle={handleToggleTask} onCreate={() => setTaskModal(true)} />}
              {tab === "grow"        && <GrowAdminTab investments={investments} plans={invPlans} onEditPlan={setPlanModal} onNewPlan={() => setPlanModal("new")} onRefresh={loadInvestments} />}
              {tab === "businesses"  && <BusinessesTab businesses={businesses} onVerify={handleVerifyBusiness} />}
              {tab === "settings"    && <SettingsTab settings={settings} onSave={handleSaveSettings} />}
            </>
          )}
        </div>
      </div>

      {taskModal && (
        <CreateTaskModal onClose={() => setTaskModal(false)} onCreate={handleCreateTask}
          businesses={businesses.filter(b => b.verified)} />
      )}

      {planModal && (
        <PlanModal
          plan={planModal === "new" ? null : planModal}
          onClose={() => setPlanModal(null)}
          onSave={handlePlanSave}
        />
      )}

      {toast && <div style={{ ...A.toast, background: toast.type === "error" ? "#E24B4A" : "#1D9E75" }}>{toast.msg}</div>}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Sans:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #f5f6f8; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
        @keyframes slideUp { from{transform:translateY(10px);opacity:0} to{transform:translateY(0);opacity:1} }
        button:active { transform: scale(0.97); }
        input:focus, select:focus { outline: none; border-color: #1D9E75 !important; }
      `}</style>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────
function OverviewTab({ stats, withdrawals, tasks, onApprove }) {
  return (
    <div style={{ animation: "slideUp 0.3s ease" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Users",        value: (stats.totalUsers ?? 0).toLocaleString(), icon: "👥", color: "#E6F1FB", tc: "#185FA5", sub: `${stats.activeToday ?? 0} active today` },
          { label: "Total Paid Out",      value: fmt(stats.totalPaidOut ?? 0),             icon: "💸", color: "#E1F5EE", tc: "#0F6E56", sub: "All time" },
          { label: "Pending Withdrawals", value: fmt(stats.pendingWithdrawals ?? 0),        icon: "⏳", color: "#FAEEDA", tc: "#854F0B", sub: `${withdrawals.filter(w=>w.status==="pending").length} requests` },
          { label: "Active Tasks",        value: tasks.filter(t=>t.status==="active").length, icon: "📋", color: "#FAECE7", tc: "#993C1D", sub: `${tasks.length} total` },
          { label: "Total Invested",      value: fmt(stats.totalInvested ?? 0),             icon: "🌱", color: "#FFF8E1", tc: "#7A5000", sub: "Active plans only" },
        ].map(k => (
          <div key={k.label} style={{ background: k.color, borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: k.tc, opacity: 0.8, fontWeight: 500 }}>{k.label}</div>
              <span style={{ fontSize: 22 }}>{k.icon}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.tc, marginBottom: 4 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: k.tc, opacity: 0.7 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={A.card}>
        <div style={{ ...A.cardTitle, marginBottom: 16 }}>Pending withdrawals</div>
        {withdrawals.filter(w => w.status === "pending").length === 0
          ? <div style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: 20 }}>No pending withdrawals 🎉</div>
          : withdrawals.filter(w => w.status === "pending").map(w => (
            <div key={w.id} style={{ ...A.tableRow, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{w.profiles?.name ?? w.user}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{w.profiles?.phone} · {w.method?.toUpperCase()} · {new Date(w.requested_at).toLocaleString()}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, marginRight: 16 }}>{fmt(w.amount)}</div>
              <button style={A.approveBtn} onClick={() => onApprove(w.id)}>Approve & Pay</button>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────
function UsersTab({ users, search, setSearch, onSuspend }) {
  const statusColors = { active: "#E1F5EE:#0F6E56", suspended: "#FAECE7:#993C1D", pending_kyc: "#FAEEDA:#854F0B" };
  return (
    <div style={{ animation: "slideUp 0.3s ease" }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <input style={A.searchInput} placeholder="Search by name or phone..." value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ background: "#E1F5EE", color: "#0F6E56", padding: "0 16px", borderRadius: 10, display: "flex", alignItems: "center", fontSize: 13, fontWeight: 500 }}>{users.length} users</div>
      </div>
      <div style={A.card}>
        <table style={A.table}>
          <thead>
            <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
              {["User", "Phone", "Balance", "KYC", "Status", "Joined", "Actions"].map(h => (
                <th key={h} style={A.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const [bg, tc] = (statusColors[u.status] ?? "#eee:#888").split(":");
              return (
                <tr key={u.id} style={{ borderBottom: "0.5px solid #f5f5f5" }}>
                  <td style={A.td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#E1F5EE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "#0F6E56", flexShrink: 0 }}>{u.initials}</div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                    </div>
                  </td>
                  <td style={A.td}><span style={{ fontSize: 12 }}>{u.phone}</span></td>
                  <td style={A.td}><span style={{ fontWeight: 600, color: "#1D9E75" }}>{fmt(u.balance)}</span></td>
                  <td style={A.td}>{u.kyc_verified ? <span style={{ color: "#1D9E75" }}>✓</span> : <span style={{ color: "#E24B4A" }}>✗</span>}</td>
                  <td style={A.td}><span style={{ background: bg, color: tc, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 500 }}>{u.status}</span></td>
                  <td style={A.td}><span style={{ fontSize: 11, color: "#888" }}>{new Date(u.created_at).toLocaleDateString()}</span></td>
                  <td style={A.td}>
                    <button onClick={() => onSuspend(u.id, u.status)}
                      style={{ ...A.actionBtn, color: u.status === "suspended" ? "#0F6E56" : "#E24B4A", borderColor: u.status === "suspended" ? "#0F6E56" : "#E24B4A" }}>
                      {u.status === "suspended" ? "Restore" : "Suspend"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {users.length === 0 && <div style={{ textAlign: "center", color: "#aaa", padding: 40 }}>No users found</div>}
      </div>
    </div>
  );
}

// ── Withdrawals ───────────────────────────────────────────────
function WithdrawalsTab({ withdrawals, onApprove, onReject }) {
  const [filter, setFilter] = useState("pending");
  const filtered = withdrawals.filter(w => filter === "all" || w.status === filter);
  const statusColor = { pending: "#FAEEDA:#854F0B", processing: "#E6F1FB:#185FA5", paid: "#E1F5EE:#0F6E56", rejected: "#FAECE7:#993C1D" };

  return (
    <div style={{ animation: "slideUp 0.3s ease" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["pending","processing","paid","rejected","all"].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ ...A.chip, ...(filter === s ? A.chipActive : {}) }}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s === "pending" && <span style={{ marginLeft: 6, background: "#E24B4A", color: "white", borderRadius: "50%", width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>{withdrawals.filter(w=>w.status==="pending").length}</span>}
          </button>
        ))}
      </div>
      <div style={A.card}>
        {filtered.map(w => {
          const [bg, tc] = (statusColor[w.status] ?? "#eee:#888").split(":");
          return (
            <div key={w.id} style={{ ...A.tableRow, alignItems: "center" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#E1F5EE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>💸</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{w.profiles?.name ?? "User"}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{w.profiles?.phone ?? w.phone_number} · {w.method?.toUpperCase()} · {new Date(w.requested_at).toLocaleString()}</div>
                {w.livepay_ref && <div style={{ fontSize: 11, color: "#1D9E75", marginTop: 2 }}>LivePay ref: {w.livepay_ref}</div>}
              </div>
              <div style={{ fontWeight: 700, fontSize: 17, marginRight: 16 }}>{fmt(w.amount)}</div>
              <span style={{ background: bg, color: tc, padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 500, marginRight: 12, minWidth: 80, textAlign: "center" }}>{w.status}</span>
              {w.status === "pending" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={A.approveBtn} onClick={() => onApprove(w.id)}>Approve & Pay</button>
                  <button style={{ ...A.approveBtn, background: "#FAECE7", color: "#993C1D" }} onClick={() => onReject(w.id)}>Reject</button>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: 40 }}>No {filter} withdrawals</div>}
      </div>
    </div>
  );
}

// ── Tasks ─────────────────────────────────────────────────────
function TasksTab({ tasks, onToggle, onCreate }) {
  return (
    <div style={{ animation: "slideUp 0.3s ease" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
        <button style={A.primaryBtn} onClick={onCreate}>+ Create Task</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {tasks.map(t => {
          const pct = t.budget > 0 ? Math.round((t.used / t.budget) * 100) : 0;
          return (
            <div key={t.id} style={A.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{t.business}</div>
                </div>
                <span style={{ background: t.status === "active" ? "#E1F5EE" : t.status === "paused" ? "#FAEEDA" : "#f0f0f0", color: t.status === "active" ? "#0F6E56" : t.status === "paused" ? "#854F0B" : "#888", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 500 }}>{t.status}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                <div style={{ background: "#f8f8f8", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: "#888" }}>Reward</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1D9E75" }}>{fmt(t.reward)}</div>
                </div>
                <div style={{ background: "#f8f8f8", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: "#888" }}>Completions</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t.completions}/{t.limit_count}</div>
                </div>
                <div style={{ background: "#f8f8f8", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: "#888" }}>Budget used</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{pct}%</div>
                </div>
              </div>
              <div style={{ height: 6, background: "#eee", borderRadius: 3, marginBottom: 14 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: pct > 80 ? "#E24B4A" : "#1D9E75", borderRadius: 3 }} />
              </div>
              {t.status !== "completed" && (
                <button onClick={() => onToggle(t.id, t.status)}
                  style={{ ...A.actionBtn, width: "100%", textAlign: "center", color: t.status === "active" ? "#854F0B" : "#0F6E56", borderColor: t.status === "active" ? "#854F0B" : "#0F6E56" }}>
                  {t.status === "active" ? "⏸ Pause task" : "▶ Resume task"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Businesses ────────────────────────────────────────────────
function BusinessesTab({ businesses, onVerify }) {
  return (
    <div style={{ animation: "slideUp 0.3s ease" }}>
      <div style={A.card}>
        <table style={A.table}>
          <thead>
            <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
              {["Business", "Email", "Credit", "Spent", "Tasks", "Status", "Actions"].map(h => (
                <th key={h} style={A.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {businesses.map(b => (
              <tr key={b.id} style={{ borderBottom: "0.5px solid #f5f5f5" }}>
                <td style={A.td}><div style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</div><div style={{ fontSize: 11, color: "#aaa" }}>Since {new Date(b.joined_at).toLocaleDateString()}</div></td>
                <td style={A.td}><span style={{ fontSize: 12 }}>{b.email}</span></td>
                <td style={A.td}><span style={{ fontWeight: 600 }}>{fmt(b.credit)}</span></td>
                <td style={A.td}>{fmt(b.spent)}</td>
                <td style={A.td}>{b.tasks}</td>
                <td style={A.td}>{b.verified ? <span style={{ color: "#1D9E75", fontSize: 12 }}>✓ Verified</span> : <span style={{ color: "#E24B4A", fontSize: 12 }}>⏳ Pending</span>}</td>
                <td style={A.td}>{!b.verified && <button style={{ ...A.actionBtn, color: "#0F6E56", borderColor: "#0F6E56" }} onClick={() => onVerify(b.id)}>Verify</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────
function SettingsTab({ settings, onSave }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch(e) { alert(e.message); }
    setSaving(false);
  };

  return (
    <div style={{ animation: "slideUp 0.3s ease", maxWidth: 600 }}>

      <div style={A.card}>
        <div style={A.cardTitle}>Activation & deposits</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div><label style={A.label}>Activation fee (UGX)</label><input style={A.input} type="number" value={form.activation_fee ?? ""} onChange={e => set("activation_fee", e.target.value)} /></div>
          <div><label style={A.label}>Referral bonus on activation (UGX)</label><input style={A.input} type="number" value={form.ref1_rate ?? ""} onChange={e => set("ref1_rate", e.target.value)} /></div>
          <div><label style={A.label}>Min deposit (UGX)</label><input style={A.input} type="number" value={form.min_deposit ?? ""} onChange={e => set("min_deposit", e.target.value)} /></div>
          <div><label style={A.label}>Deposit platform fee (%)</label><input style={A.input} type="number" value={form.deposit_fee_pct ?? ""} onChange={e => set("deposit_fee_pct", e.target.value)} /></div>
        </div>
      </div>

      <div style={{ ...A.card, marginTop: 16 }}>
        <div style={A.cardTitle}>Withdrawal limits</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div><label style={A.label}>Min withdrawal (UGX)</label><input style={A.input} type="number" value={form.min_withdrawal ?? ""} onChange={e => set("min_withdrawal", e.target.value)} /></div>
          <div><label style={A.label}>Max withdrawal (UGX)</label><input style={A.input} type="number" value={form.max_withdrawal ?? ""} onChange={e => set("max_withdrawal", e.target.value)} /></div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={A.label}>Withdrawal window</label>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <input style={{ ...A.input, width:"auto", flex:1 }} type="time" value={form.withdraw_open ?? "07:00"} onChange={e => set("withdraw_open", e.target.value)} />
              <span style={{ color:"#888", fontSize:13 }}>to</span>
              <input style={{ ...A.input, width:"auto", flex:1 }} type="time" value={form.withdraw_close ?? "19:00"} onChange={e => set("withdraw_close", e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...A.card, marginTop: 16 }}>
        <div style={A.cardTitle}>Rewards</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div><label style={A.label}>Sign-up bonus (UGX)</label><input style={A.input} type="number" value={form.signup_bonus ?? ""} onChange={e => set("signup_bonus", e.target.value)} /></div>
          <div><label style={A.label}>7-day streak bonus (UGX)</label><input style={A.input} type="number" value={form.streak_bonus ?? ""} onChange={e => set("streak_bonus", e.target.value)} /></div>
          <div><label style={A.label}>Platform fee on tasks (%)</label><input style={A.input} type="number" value={form.platform_fee ?? ""} onChange={e => set("platform_fee", e.target.value)} /></div>
        </div>
      </div>

      <button style={{ ...A.primaryBtn, marginTop: 20, width: "auto", padding: "12px 32px", opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : saved ? "Saved ✓" : "Save settings"}
      </button>
    </div>
  );
}

// ── Create Task Modal ─────────────────────────────────────────
function CreateTaskModal({ onClose, onCreate, businesses }) {
  const [form, setForm] = useState({ title: "", business: "", type: "youtube_watch", subtype: "", link: "", duration_seconds: 60, reward: "", budget: "", limit: "", icon: "▶️" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const typeIcons = { youtube_watch: "▶️", youtube_subscribe: "📺", tiktok: "🎵", social: "📱", survey: "📋", install: "⬇️", review: "⭐" };

  const handleCreate = async () => {
    setErr("");
    if (!form.title)    return setErr("Task title is required");
    if (!form.business) return setErr("Select a business");
    if (!form.reward)   return setErr("Reward amount is required");
    if (!form.budget)   return setErr("Budget is required");
    if (!form.limit)    return setErr("Max completions is required");
    if ((form.type === "youtube_watch" || form.type === "youtube_subscribe" || form.type === "tiktok") && !form.link)
      return setErr("Link is required for this task type");
    setLoading(true);
    try {
      await onCreate({ ...form, icon: typeIcons[form.type] ?? form.icon, category: form.type });
    } catch (e) {
      setErr(e.message ?? "Failed to create task");
    } finally {
      setLoading(false);
    }
  };

  const isTimed    = ["youtube_watch","youtube_subscribe","tiktok"].includes(form.type);
  const isTiktok   = form.type === "tiktok";
  const isLikeTask = form.type === "like_product" || form.type === "like_song";

  // Parse/set description JSON for like tasks
  const setMeta = (key, val) => {
    let meta = {};
    try { meta = JSON.parse(form.description || "{}"); } catch {}
    meta[key] = val;
    set("description", JSON.stringify(meta));
  };
  const getMeta = (key) => {
    try { return JSON.parse(form.description || "{}")[key] ?? ""; } catch { return ""; }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, overflowY: "auto", padding: "20px 0" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 20, padding: 28, width: 500, animation: "slideUp 0.3s ease", margin: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Create new task</div>
        {err && <div style={{ background: "#FAECE7", color: "#993C1D", borderRadius: 8, padding: "10px 12px", fontSize: 12, marginBottom: 14 }}>{err}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}><label style={A.label}>Task title</label><input style={A.input} placeholder="e.g. Watch our latest YouTube video" value={form.title} onChange={e => set("title", e.target.value)} /></div>

          <div><label style={A.label}>Task type</label>
            <select style={A.input} value={form.type} onChange={e => set("type", e.target.value)}>
              <optgroup label="YouTube">
                <option value="youtube_watch">▶️ YouTube Watch</option>
                <option value="youtube_subscribe">📺 YouTube Subscribe</option>
              </optgroup>
              <optgroup label="TikTok">
                <option value="tiktok">🎵 TikTok</option>
              </optgroup>
              <optgroup label="Like / Rate">
                <option value="like_product">🛍 Rate Product</option>
                <option value="like_song">🎵 Rate Song</option>
              </optgroup>
              <optgroup label="Other">
                <option value="social">📱 Social (general)</option>
                <option value="survey">📋 Survey</option>
                <option value="install">⬇️ App Install</option>
                <option value="review">⭐ Review</option>
              </optgroup>
            </select>
          </div>

          {/* Legend-only toggle */}
          <div style={{ display:"flex", alignItems:"center", gap:10, gridColumn:"1/-1", background:"#FFF8E1", borderRadius:10, padding:"10px 14px" }}>
            <input type="checkbox" id="legend_only" checked={form.subtype === "legend_only"} onChange={e => set("subtype", e.target.checked ? "legend_only" : "")} style={{ width:16, height:16, cursor:"pointer" }} />
            <label htmlFor="legend_only" style={{ fontSize:13, fontWeight:600, color:"#7A5000", cursor:"pointer" }}>
              👑 Legend-only task — only visible to Legend plan members
            </label>
          </div>

          {isTiktok && (
            <div><label style={A.label}>TikTok action</label>
              <select style={A.input} value={form.subtype === "legend_only" ? "" : form.subtype} onChange={e => set("subtype", e.target.value)}>
                <option value="follow">Follow account</option>
                <option value="like">Like video</option>
                <option value="watch">Watch video</option>
                <option value="comment">Comment on video</option>
              </select>
            </div>
          )}

          {/* Like task extra fields */}
          {isLikeTask && (<>
            <div style={{ gridColumn:"1/-1" }}><label style={A.label}>Cover image URL (product photo or song cover)</label><input style={A.input} placeholder="https://your-storage.com/image.jpg" value={getMeta("cover_url")} onChange={e => setMeta("cover_url", e.target.value)} /></div>
            <div><label style={A.label}>{form.type === "like_song" ? "Artist name" : "Brand name"}</label><input style={A.input} placeholder={form.type === "like_song" ? "e.g. Eddy Kenzo" : "e.g. Movit Uganda"} value={getMeta(form.type === "like_song" ? "artist" : "brand")} onChange={e => setMeta(form.type === "like_song" ? "artist" : "brand", e.target.value)} /></div>
            <div><label style={A.label}>{form.type === "like_song" ? "Genre" : "Category"}</label><input style={A.input} placeholder={form.type === "like_song" ? "e.g. Afrobeats" : "e.g. Hair Care"} value={getMeta("genre") || getMeta("category")} onChange={e => setMeta(form.type === "like_song" ? "genre" : "category", e.target.value)} /></div>
            {form.type === "like_song"
              ? <div><label style={A.label}>Album / EP name</label><input style={A.input} placeholder="e.g. Sitya Loss EP" value={getMeta("album")} onChange={e => setMeta("album", e.target.value)} /></div>
              : <div><label style={A.label}>Price (optional)</label><input style={A.input} placeholder="e.g. UGX 8,500" value={getMeta("price")} onChange={e => setMeta("price", e.target.value)} /></div>
            }
            <div style={{ gridColumn:"1/-1" }}><label style={A.label}>Tagline / description</label><input style={A.input} placeholder={form.type === "like_song" ? "e.g. Uganda's biggest hit" : "e.g. New formula, same great product"} value={getMeta("tagline")} onChange={e => setMeta("tagline", e.target.value)} /></div>
          </>)}

          <div><label style={A.label}>Business</label>
            <select style={A.input} value={form.business} onChange={e => set("business", e.target.value)}>
              <option value="">Select business</option>
              {(businesses ?? []).map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
              <option value="EarnNet">EarnNet (default)</option>
            </select>
          </div>

          {isTimed && (
            <div style={{ gridColumn: "1/-1" }}><label style={A.label}>{form.type === "youtube_watch" ? "YouTube video URL" : form.type === "youtube_subscribe" ? "YouTube channel URL" : "TikTok profile / video URL"}</label>
              <input style={A.input} placeholder="https://..." value={form.link} onChange={e => set("link", e.target.value)} />
            </div>
          )}

          {isTimed && (
            <div><label style={A.label}>Timer duration (seconds)</label>
              <input style={A.input} type="number" placeholder="60" value={form.duration_seconds} onChange={e => set("duration_seconds", parseInt(e.target.value))} />
            </div>
          )}

          <div><label style={A.label}>Reward per user (UGX)</label><input style={A.input} type="number" placeholder="500" value={form.reward} onChange={e => set("reward", e.target.value)} /></div>
          <div><label style={A.label}>Total budget (UGX)</label><input style={A.input} type="number" placeholder="250000" value={form.budget} onChange={e => set("budget", e.target.value)} /></div>
          <div><label style={A.label}>Max completions</label><input style={A.input} type="number" placeholder="500" value={form.limit} onChange={e => set("limit", e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button style={{ ...A.primaryBtn, flex: 1, padding: "12px 0", opacity: loading ? 0.7 : 1 }}
            onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create Task"}
          </button>
          <button style={{ flex: 1, padding: "12px 0", background: "transparent", border: "0.5px solid #ddd", borderRadius: 10, cursor: "pointer", fontSize: 14 }} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Grow / Investment Admin Tab ───────────────────────────────
const PLAN_COLORS = { Starter:"#1D9E75", Bronze:"#A0623A", Silver:"#8C9096", Growth:"#185FA5", Advance:"#2E9E7A", Premium:"#E5873A", Pro:"#D64545", Elite:"#7B61FF", Diamond:"#2AA9C2", Legend:"#B8860B" };
const PLAN_ICONS  = { Starter:"🌱", Bronze:"🥉", Silver:"🥈", Growth:"🌿", Advance:"🍃", Premium:"🌳", Pro:"⚡", Elite:"💎", Diamond:"💠", Legend:"👑" };
const DURATIONS_ADMIN = [
  { months: 1,  label: "1mo", rateKey: "rate_1m"  },
  { months: 3,  label: "3mo", rateKey: "rate_3m"  },
  { months: 6,  label: "6mo", rateKey: "rate_6m"  },
  { months: 12, label: "1yr", rateKey: "rate_12m" },
];

function GrowAdminTab({ investments, plans, onEditPlan, onNewPlan, onRefresh }) {
  const [filter, setFilter] = useState("all"); // all | active | paid_out
  const [search, setSearch] = useState("");

  const activeInvs  = investments.filter(i => i.status === "active");
  const totalInvested = activeInvs.reduce((s, i) => s + i.amount, 0);
  const totalProfit   = activeInvs.reduce((s, i) => s + Math.floor(i.amount * parseFloat(i.daily_rate) * i.duration_days), 0);

  // Per-plan investor counts
  const planCounts = plans.reduce((acc, p) => {
    acc[p.name] = investments.filter(i => i.plan_name === p.name && i.status === "active").length;
    return acc;
  }, {});

  const filtered = investments
    .filter(i => filter === "all" || i.status === filter)
    .filter(i => !search || i.profiles?.name?.toLowerCase().includes(search.toLowerCase()) || i.profiles?.phone?.includes(search));

  // Maturing soon (within 3 days)
  const maturingSoon = activeInvs.filter(i => {
    const days = (new Date(i.matures_at) - new Date()) / 86400000;
    return days >= 0 && days <= 3;
  });

  return (
    <div style={{ animation:"slideUp 0.3s ease" }}>

      {/* ── Stats row ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:24 }}>
        {[
          { label:"Active investments", value:activeInvs.length,   icon:"📈", color:"#E1F5EE", tc:"#0F6E56" },
          { label:"Total invested",     value:fmt(totalInvested),  icon:"💰", color:"#FFF8E1", tc:"#7A5000" },
          { label:"Expected profit",    value:fmt(totalProfit),    icon:"🎯", color:"#F3E8FF", tc:"#7C3AED" },
          { label:"Maturing in 3 days", value:maturingSoon.length, icon:"⏰", color:"#FAEEDA", tc:"#854F0B" },
        ].map(k => (
          <div key={k.label} style={{ background:k.color, borderRadius:16, padding:"18px 20px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ fontSize:11, color:k.tc, opacity:0.8, fontWeight:500 }}>{k.label}</div>
              <span style={{ fontSize:22 }}>{k.icon}</span>
            </div>
            <div style={{ fontSize:22, fontWeight:700, color:k.tc }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Plan management ── */}
      <div style={A.card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ ...A.cardTitle }}>Investment Plans</div>
          <button style={A.primaryBtn} onClick={onNewPlan}>+ New Plan</button>
        </div>
        <table style={A.table}>
          <thead>
            <tr style={{ borderBottom:"1px solid #f0f0f0" }}>
              {["Plan","Min Buy-in","1mo","3mo","6mo","1yr","Investors","Status","Actions"].map(h => (
                <th key={h} style={A.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plans.map(p => {
              const color = PLAN_COLORS[p.name] ?? "#888";
              return (
                <tr key={p.id} style={{ borderBottom:"0.5px solid #f5f5f5" }}>
                  <td style={A.td}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:20 }}>{PLAN_ICONS[p.name] ?? "📦"}</span>
                      <span style={{ fontWeight:600 }}>{p.name}</span>
                    </div>
                  </td>
                  <td style={A.td}>{fmt(p.min_amount ?? p.amount)}</td>
                  {DURATIONS_ADMIN.map(d => (
                    <td key={d.months} style={A.td}>
                      <span style={{ fontWeight:700, color }}>{Math.round((p[d.rateKey] ?? 0) * 100)}%</span>
                    </td>
                  ))}
                  <td style={A.td}>
                    <span style={{ background:"#E1F5EE", color:"#0F6E56", borderRadius:20, padding:"3px 10px", fontSize:12, fontWeight:600 }}>
                      {planCounts[p.name] ?? 0} active
                    </span>
                  </td>
                  <td style={A.td}>
                    <span style={{ background: p.is_active ? "#E1F5EE" : "#FAECE7", color: p.is_active ? "#0F6E56" : "#993C1D", borderRadius:20, padding:"3px 10px", fontSize:12, fontWeight:600 }}>
                      {p.is_active ? "Active" : "Paused"}
                    </span>
                  </td>
                  <td style={A.td}>
                    <button style={A.actionBtn} onClick={() => onEditPlan(p)}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── User investments table ── */}
      <div style={A.card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={A.cardTitle}>User Investments ({filtered.length})</div>
          <div style={{ display:"flex", gap:8 }}>
            <input style={{ ...A.searchInput, width:200 }} placeholder="Search user..." value={search} onChange={e => setSearch(e.target.value)} />
            {["all","active","paid_out"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ ...A.chip, ...(filter === f ? A.chipActive : {}) }}>
                {f === "all" ? "All" : f === "active" ? "Active" : "Completed"}
              </button>
            ))}
          </div>
        </div>
        <table style={A.table}>
          <thead>
            <tr style={{ borderBottom:"1px solid #f0f0f0" }}>
              {["User","Plan","Invested","Expected Profit","Started","Matures","Status"].map(h => (
                <th key={h} style={A.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={7} style={{ padding:30, textAlign:"center", color:"#aaa", fontSize:13 }}>No investments found</td></tr>
              : filtered.map(inv => {
                const profit   = Math.floor(inv.amount * parseFloat(inv.daily_rate) * inv.duration_days);
                const daysLeft = Math.max(0, Math.ceil((new Date(inv.matures_at) - new Date()) / 86400000));
                const isSoon   = daysLeft <= 3 && inv.status === "active";
                const color    = PLAN_COLORS[inv.plan_name] ?? "#888";
                return (
                  <tr key={inv.id} style={{ borderBottom:"0.5px solid #f5f5f5", background: isSoon ? "#FFFBF0" : "white" }}>
                    <td style={A.td}>
                      <div style={{ fontWeight:500 }}>{inv.profiles?.name ?? "—"}</div>
                      <div style={{ fontSize:11, color:"#888" }}>{inv.profiles?.phone}</div>
                    </td>
                    <td style={A.td}>
                      <span style={{ color, fontWeight:700, fontSize:13 }}>
                        {PLAN_ICONS[inv.plan_name]} {inv.plan_name}
                      </span>
                    </td>
                    <td style={A.td}>{fmt(inv.amount)}</td>
                    <td style={{ ...A.td, color:"#0F6E56", fontWeight:600 }}>+{fmt(profit)}</td>
                    <td style={{ ...A.td, fontSize:12, color:"#888" }}>{new Date(inv.starts_at).toLocaleDateString()}</td>
                    <td style={A.td}>
                      <div style={{ fontSize:12 }}>{new Date(inv.matures_at).toLocaleDateString()}</div>
                      {inv.status === "active" && (
                        <div style={{ fontSize:11, color: isSoon ? "#E24B4A" : "#888", fontWeight: isSoon ? 700 : 400 }}>
                          {isSoon ? `⚠️ ${daysLeft}d left` : `${daysLeft} days left`}
                        </div>
                      )}
                    </td>
                    <td style={A.td}>
                      <span style={{ background: inv.status === "active" ? "#E1F5EE" : inv.status === "paid_out" ? "#E6F1FB" : "#FAEEDA", color: inv.status === "active" ? "#0F6E56" : inv.status === "paid_out" ? "#185FA5" : "#854F0B", borderRadius:20, padding:"3px 10px", fontSize:12, fontWeight:600 }}>
                        {inv.status === "paid_out" ? "Paid out" : inv.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Plan Edit / Create Modal ──────────────────────────────────
function PlanModal({ plan, onClose, onSave }) {
  const isNew = !plan;
  const [form, setForm] = useState({
    id:         plan?.id ?? null,
    name:       plan?.name ?? "",
    min_amount: plan?.min_amount ?? plan?.amount ?? "",
    rate_1m:    plan ? (plan.rate_1m  * 100).toFixed(1) : "",
    rate_3m:    plan ? (plan.rate_3m  * 100).toFixed(1) : "",
    rate_6m:    plan ? (plan.rate_6m  * 100).toFixed(1) : "",
    rate_12m:   plan ? (plan.rate_12m * 100).toFixed(1) : "",
    task_limit: plan?.task_limit ?? "",
    multiplier: plan?.multiplier ?? "1.10",
    is_active:  plan?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const profitAt = (rateField) => {
    const amt = parseInt(form.min_amount || 0);
    const rate = parseFloat(form[rateField] || 0) / 100;
    return Math.floor(amt * rate);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }} onClick={onClose}>
      <div style={{ background:"white", borderRadius:20, padding:28, width:480, maxHeight:"90vh", overflowY:"auto", animation:"slideUp 0.3s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight:700, fontSize:18, marginBottom:20 }}>{isNew ? "Create Growth Plan" : `Edit ${plan.name} Plan`}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <div>
            <label style={A.label}>Plan name</label>
            <input style={A.input} placeholder="e.g. Starter" value={form.name} onChange={e => set("name", e.target.value)} />
          </div>
          <div>
            <label style={A.label}>Minimum buy-in (UGX)</label>
            <input style={A.input} type="number" placeholder="20000" value={form.min_amount} onChange={e => set("min_amount", e.target.value)} />
          </div>

          <div style={{ gridColumn:"1/-1", fontSize:12, fontWeight:600, color:"#888", marginTop:4 }}>Total return by period (%)</div>
          {[["rate_1m","1 month"],["rate_3m","3 months"],["rate_6m","6 months"],["rate_12m","1 year"]].map(([key,label]) => (
            <div key={key}>
              <label style={A.label}>{label}</label>
              <input style={A.input} type="number" step="0.1" placeholder="0" value={form[key]} onChange={e => set(key, e.target.value)} />
            </div>
          ))}

          <div>
            <label style={A.label}>Daily task limit (blank = unlimited)</label>
            <input style={A.input} type="number" placeholder="8" value={form.task_limit} onChange={e => set("task_limit", e.target.value)} />
          </div>
          <div>
            <label style={A.label}>Reward multiplier</label>
            <input style={A.input} type="number" step="0.01" placeholder="1.10" value={form.multiplier} onChange={e => set("multiplier", e.target.value)} />
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:10, paddingTop:8, gridColumn:"1/-1" }}>
            <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => set("is_active", e.target.checked)} style={{ width:16, height:16 }} />
            <label htmlFor="is_active" style={{ fontSize:13, fontWeight:500 }}>Plan is active (visible to users)</label>
          </div>
        </div>

        {form.min_amount > 0 && (
          <div style={{ background:"#E1F5EE", borderRadius:12, padding:"14px 16px", marginTop:16 }}>
            <div style={{ fontSize:12, color:"#0F6E56", marginBottom:8 }}>Profit preview at minimum buy-in ({fmt(form.min_amount)})</div>
            {[["rate_1m","1mo"],["rate_3m","3mo"],["rate_6m","6mo"],["rate_12m","1yr"]].map(([key,label]) => (
              <div key={key} style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginTop:2 }}>
                <span>{label}</span><strong style={{ color:"#0F6E56" }}>+{fmt(profitAt(key))}</strong>
              </div>
            ))}
          </div>
        )}

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button style={{ ...A.primaryBtn, flex:1, padding:"12px 0", opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : isNew ? "Create Plan" : "Save Changes"}
          </button>
          <button style={{ flex:1, padding:"12px 0", background:"transparent", border:"0.5px solid #ddd", borderRadius:10, cursor:"pointer", fontSize:14 }} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const A = {
  shell: { display: "flex", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif" },
  sidebar: { width: 220, background: "#0F2D22", display: "flex", flexDirection: "column", padding: "0 0 16px", flexShrink: 0 },
  sidebarLogo: { display: "flex", alignItems: "center", gap: 10, padding: "20px 16px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 8 },
  logoIcon: { width: 36, height: 36, borderRadius: 10, background: "#1D9E75", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, color: "white" },
  navItem: { display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", background: "none", border: "none", color: "rgba(255,255,255,0.65)", fontSize: 13, cursor: "pointer", width: "100%", textAlign: "left", transition: "all 0.15s" },
  navItemActive: { background: "rgba(255,255,255,0.1)", color: "white", fontWeight: 600 },
  navBadge: { background: "#E24B4A", color: "white", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 10 },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  topbar: { padding: "18px 28px", background: "white", borderBottom: "0.5px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" },
  content: { flex: 1, overflowY: "auto", padding: 28, background: "#f5f6f8" },
  card: { background: "white", borderRadius: 16, padding: "20px 22px", border: "0.5px solid #eee", marginBottom: 16 },
  cardTitle: { fontWeight: 600, fontSize: 14, color: "#333" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { padding: "8px 12px", textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" },
  td: { padding: "12px 12px", fontSize: 13, verticalAlign: "middle" },
  tableRow: { display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 0", borderBottom: "0.5px solid #f5f5f5" },
  approveBtn: { padding: "6px 14px", background: "#E1F5EE", color: "#0F6E56", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" },
  actionBtn: { padding: "6px 14px", background: "transparent", border: "0.5px solid #ddd", borderRadius: 8, fontSize: 12, cursor: "pointer" },
  chip: { padding: "7px 16px", borderRadius: 20, border: "0.5px solid #ddd", background: "white", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center" },
  chipActive: { background: "#1D9E75", color: "white", borderColor: "#1D9E75", fontWeight: 600 },
  searchInput: { flex: 1, padding: "10px 14px", border: "0.5px solid #ddd", borderRadius: 10, fontSize: 13, outline: "none" },
  primaryBtn: { padding: "10px 20px", background: "#1D9E75", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  label: { display: "block", fontSize: 11, color: "#888", marginBottom: 6, fontWeight: 500 },
  input: { width: "100%", padding: "10px 12px", border: "0.5px solid #ddd", borderRadius: 8, fontSize: 13, background: "#fafafa" },
  toast: { position: "fixed", bottom: 24, right: 24, color: "white", padding: "12px 20px", borderRadius: 12, fontSize: 13, fontWeight: 500, zIndex: 400, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", animation: "slideUp 0.3s ease" },
};
