// src/pages/EarnNet.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import {
  supabase, signUpWithPhone, signInWithPhone, signOut, getProfile,
  getActiveTasks, completeTask, getTransactions, requestWithdrawal,
  getUserWithdrawals, requestDeposit, getUserDeposits, activateAccount,
  getReferralTree, getSettings,
} from "../lib/supabase";

const fmt = (n) => "UGX " + Number(n || 0).toLocaleString();
const BRAND      = "#1D9E75";
const BRAND_DARK = "#0F6E56";
const BG_DARK    = "#0F2D22";

// ── Dark mode context ──────────────────────────────────────────
function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("earnnet_dark") === "1"; } catch { return false; }
  });
  const toggle = () => setDark(d => {
    const next = !d;
    try { localStorage.setItem("earnnet_dark", next ? "1" : "0"); } catch {}
    return next;
  });
  return [dark, toggle];
}

// ── Theme tokens ───────────────────────────────────────────────
function theme(dark) {
  return {
    bg:        dark ? "#0F2D22"  : "#f5f6f8",
    card:      dark ? "#1a3d2b"  : "#ffffff",
    border:    dark ? "#2a5040"  : "#eeeeee",
    text:      dark ? "#e8f5f0"  : "#111111",
    textSub:   dark ? "#7db89a"  : "#888888",
    inputBg:   dark ? "#142e20"  : "#fafafa",
    inputBrd:  dark ? "#2a5040"  : "#dddddd",
    navBg:     dark ? "#0e2b1f"  : "#ffffff",
    headerBg:  dark ? "#0e2b1f"  : "#ffffff",
    chipBg:    dark ? "#1a3d2b"  : "#ffffff",
    chipBrd:   dark ? "#2a5040"  : "#dddddd",
    notifBg:   dark ? "#142e20"  : "#ffffff",
    notifHover:dark ? "#1a3d2b"  : "#f8faf9",
  };
}

export default function EarnNet() {
  const [session, setSession]         = useState(null);
  const [profile, setProfile]         = useState(null);
  const [settings, setSettings]       = useState({});
  const [loading, setLoading]         = useState(true);
  const [showLanding, setShowLanding] = useState(true);
  const [dark, toggleDark]            = useDarkMode();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ref") || params.get("app") === "1") setShowLanding(false);
    getSettings().then(setSettings).catch(() => {});
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) { setShowLanding(false); loadProfile(session.user.id); }
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) { setShowLanding(false); loadProfile(s.user.id); }
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(uid) {
    setLoading(true);
    try { setProfile(await getProfile(uid)); } catch {}
    finally { setLoading(false); }
  }

  if (loading)      return <Splash dark={dark} />;
  if (showLanding)  return <LandingPage onGetStarted={() => setShowLanding(false)} settings={settings} dark={dark} toggleDark={toggleDark} />;
  if (!session)     return <AuthFlow settings={settings} dark={dark} toggleDark={toggleDark} />;
  return <MainApp session={session} profile={profile} settings={settings} refreshProfile={() => loadProfile(session.user.id)} dark={dark} toggleDark={toggleDark} />;
}

// ── Splash ─────────────────────────────────────────────────────
function Splash({ dark }) {
  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:BG_DARK, gap:8 }}>
      <div style={S.logoMark}>E</div>
      <div style={{ fontFamily:"'Sora',sans-serif", fontSize:32, fontWeight:700, color:"white", letterSpacing:-1 }}>EarnNet</div>
      <div style={{ fontSize:14, color:"rgba(255,255,255,0.5)" }}>Work. Refer. Earn.</div>
    </div>
  );
}

// ── Landing ────────────────────────────────────────────────────
function LandingPage({ onGetStarted, settings, dark, toggleDark }) {
  const bonus    = settings.signup_bonus ?? 2000;
  const T        = theme(dark);
  const features = [
    { icon: "📋", title: "Complete tasks",    desc: "Follow social pages, fill surveys, install apps — get paid instantly per task." },
    { icon: "👥", title: "Refer & earn",       desc: "Earn commission on 3 levels when your referrals complete tasks too." },
    { icon: "💸", title: "Withdraw anytime",   desc: "Cash out to MTN or Airtel Money. Processed within 24 hours." },
    { icon: "🔥", title: "Daily streak bonus", desc: "Log in 7 days in a row and earn a bonus on top of your task income." },
  ];
  const steps = [
    { n: "1", title: "Sign up free",          desc: "Create your account in under a minute." },
    { n: "2", title: "Activate your account", desc: "One small fee unlocks all earning features." },
    { n: "3", title: "Complete tasks",         desc: "Browse available tasks and get paid per completion." },
    { n: "4", title: "Withdraw your money",   desc: "Send earnings straight to your mobile money." },
  ];
  const stepColors = ["#E1F5EE","#FAEEDA","#E6F1FB","#F1EFE8"];
  const stepTc     = [BRAND_DARK,"#854F0B","#185FA5","#5F5E5A"];

  return (
    <div style={{ fontFamily:"'DM Sans', sans-serif", background:T.bg, minHeight:"100vh", transition:"background 0.3s" }}>
      <nav style={{ background:T.headerBg, borderBottom:`0.5px solid ${T.border}`, padding:"14px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ ...S.logoMark, width:32, height:32, fontSize:16 }}>E</div>
          <span style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:18, color:T.text }}>Earn<span style={{ color:BRAND }}>Net</span></span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <button onClick={toggleDark} style={{ background:"none", border:`0.5px solid ${T.border}`, borderRadius:10, width:34, height:34, cursor:"pointer", fontSize:16, color:T.text }}>
            {dark ? "☀️" : "🌙"}
          </button>
          <button style={{ ...S.primaryBtn, width:"auto", padding:"9px 20px", fontSize:13 }} onClick={onGetStarted}>Get started →</button>
        </div>
      </nav>

      <div style={{ background:`linear-gradient(135deg,${BG_DARK} 0%,${BRAND_DARK} 100%)`, color:"white", padding:"64px 24px 56px", textAlign:"center" }}>
        <div style={{ display:"inline-block", background:"rgba(255,255,255,0.12)", borderRadius:20, padding:"6px 16px", fontSize:12, fontWeight:600, marginBottom:20 }}>
          🎁 {fmt(bonus)} FREE when you join today
        </div>
        <h1 style={{ fontFamily:"'Sora',sans-serif", fontSize:"clamp(28px,8vw,48px)", fontWeight:700, lineHeight:1.15, maxWidth:560, margin:"0 auto 18px" }}>
          Earn real money doing simple online tasks
        </h1>
        <p style={{ fontSize:16, opacity:0.8, maxWidth:420, margin:"0 auto 32px", lineHeight:1.7 }}>
          Uganda's fastest-growing earning platform. Complete tasks, refer friends, and cash out to MTN or Airtel Money.
        </p>
        <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap" }}>
          <button style={{ background:BRAND, color:"white", border:"none", borderRadius:12, padding:"14px 32px", fontSize:15, fontWeight:700, cursor:"pointer" }} onClick={onGetStarted}>Start earning now →</button>
          <button style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"1px solid rgba(255,255,255,0.3)", borderRadius:12, padding:"14px 28px", fontSize:15, fontWeight:600, cursor:"pointer" }} onClick={onGetStarted}>Sign in</button>
        </div>
        <div style={{ marginTop:48, display:"flex", justifyContent:"center", gap:40, flexWrap:"wrap" }}>
          {[["10,000+","Members"],["UGX 50M+","Paid out"],["500+","Tasks daily"]].map(([val,lbl]) => (
            <div key={lbl} style={{ textAlign:"center" }}>
              <div style={{ fontFamily:"'Sora',sans-serif", fontSize:28, fontWeight:700 }}>{val}</div>
              <div style={{ fontSize:12, opacity:0.65, marginTop:2 }}>{lbl}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:800, margin:"0 auto", padding:"56px 24px 0" }}>
        <h2 style={{ fontFamily:"'Sora',sans-serif", fontSize:26, fontWeight:700, textAlign:"center", marginBottom:8, color:T.text }}>Why EarnNet?</h2>
        <p style={{ textAlign:"center", color:T.textSub, fontSize:14, marginBottom:40 }}>Simple ways to earn every day from your phone.</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:16, marginBottom:60 }}>
          {features.map(f => (
            <div key={f.title} style={{ background:T.card, borderRadius:16, padding:"22px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize:32, marginBottom:12 }}>{f.icon}</div>
              <div style={{ fontWeight:700, fontSize:15, marginBottom:8, color:T.text }}>{f.title}</div>
              <div style={{ fontSize:13, color:T.textSub, lineHeight:1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        <h2 style={{ fontFamily:"'Sora',sans-serif", fontSize:26, fontWeight:700, textAlign:"center", marginBottom:8, color:T.text }}>How it works</h2>
        <p style={{ textAlign:"center", color:T.textSub, fontSize:14, marginBottom:40 }}>Four simple steps to your first withdrawal.</p>
        <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:60 }}>
          {steps.map((s, i) => (
            <div key={s.n} style={{ background:T.card, borderRadius:16, padding:"18px 20px", display:"flex", alignItems:"center", gap:16, boxShadow:"0 2px 8px rgba(0,0,0,0.05)" }}>
              <div style={{ width:40, height:40, borderRadius:"50%", background:stepColors[i], display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:18, color:stepTc[i], flexShrink:0 }}>{s.n}</div>
              <div>
                <div style={{ fontWeight:600, fontSize:15, color:T.text }}>{s.title}</div>
                <div style={{ fontSize:13, color:T.textSub, marginTop:2 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background:`linear-gradient(135deg,${BG_DARK},${BRAND_DARK})`, borderRadius:20, padding:"40px 32px", textAlign:"center", color:"white", marginBottom:60 }}>
          <div style={{ fontFamily:"'Sora',sans-serif", fontSize:24, fontWeight:700, marginBottom:10 }}>Ready to start earning?</div>
          <div style={{ fontSize:14, opacity:0.8, marginBottom:24 }}>Join thousands of Ugandans earning from their phones every day.</div>
          <button style={{ background:BRAND, color:"white", border:"none", borderRadius:12, padding:"14px 40px", fontSize:15, fontWeight:700, cursor:"pointer" }} onClick={onGetStarted}>Create free account →</button>
        </div>
      </div>

      <div style={{ borderTop:`0.5px solid ${T.border}`, background:T.headerBg, padding:"24px", textAlign:"center", fontSize:12, color:T.textSub }}>
        © {new Date().getFullYear()} EarnNet · Uganda &nbsp;|&nbsp;
        {["Terms","Privacy","Support"].map((lbl,i) => [
          i > 0 && <span key={`sep${i}`}>&nbsp;|&nbsp;</span>,
          <button key={lbl} style={{ background:"none", border:"none", color:T.textSub, fontSize:12, cursor:"pointer", textDecoration:"underline" }} onClick={onGetStarted}>{lbl}</button>
        ])}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'DM Sans',sans-serif; }
        button:active { transform:scale(0.97); }
      `}</style>
    </div>
  );
}

// ── Auth ───────────────────────────────────────────────────────
function AuthFlow({ settings, dark, toggleDark }) {
  const [screen, setScreen] = useState("login");
  const ref = new URLSearchParams(window.location.search).get("ref") ?? "";
  return screen === "login"
    ? <LoginScreen onSwitch={() => setScreen("register")} dark={dark} toggleDark={toggleDark} />
    : <RegisterScreen onSwitch={() => setScreen("login")} defaultRef={ref} settings={settings} dark={dark} toggleDark={toggleDark} />;
}

function LoginScreen({ onSwitch, dark, toggleDark }) {
  const [phone, setPhone]     = useState("");
  const [pwd, setPwd]         = useState("");
  const [err, setErr]         = useState("");
  const [loading, setLoading] = useState(false);
  const T = theme(dark);

  const handleLogin = async () => {
    setErr(""); setLoading(true);
    try { await signInWithPhone(phone, pwd); }
    catch { setErr("Wrong phone or password. Try again."); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background: dark ? BG_DARK : "#0F2D22", padding:16, transition:"background 0.3s" }}>
      <div style={{ background:T.card, borderRadius:24, padding:"32px 28px", width:"100%", maxWidth:400, boxShadow:"0 24px 64px rgba(0,0,0,0.4)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={S.logoMark}>E</div>
            <span style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:20, color:T.text }}>Earn<span style={{ color:BRAND }}>Net</span></span>
          </div>
          <button onClick={toggleDark} style={{ background:"none", border:`0.5px solid ${T.border}`, borderRadius:10, width:34, height:34, cursor:"pointer", fontSize:16, color:T.text }}>{dark ? "☀️" : "🌙"}</button>
        </div>
        <h2 style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:22, marginBottom:6, color:T.text }}>Welcome back 👋</h2>
        <p style={{ fontSize:13, color:T.textSub, marginBottom:22 }}>Sign in to continue earning</p>
        {err && <div style={{ background:"#FAECE7", color:"#993C1D", borderRadius:10, padding:"10px 14px", fontSize:13, marginBottom:4, marginTop:10 }}>{err}</div>}
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Phone number</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="tel" placeholder="0700 000 000" value={phone} onChange={e => setPhone(e.target.value)} />
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Password</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="password" placeholder="••••••••" value={pwd} onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <button style={{ ...S.primaryBtn, marginTop:18 }} onClick={handleLogin} disabled={loading}>{loading ? "Signing in..." : "Sign in →"}</button>
        <p style={{ textAlign:"center", marginTop:20, fontSize:13, color:T.textSub }}>New here? <button style={{ background:"none", border:"none", color:BRAND, fontSize:13, fontWeight:600, cursor:"pointer" }} onClick={onSwitch}>Create account</button></p>
      </div>
    </div>
  );
}

function RegisterScreen({ onSwitch, defaultRef, settings, dark, toggleDark }) {
  const [name, setName]       = useState("");
  const [phone, setPhone]     = useState("");
  const [pwd, setPwd]         = useState("");
  const [refCode, setRefCode] = useState(defaultRef);
  const [err, setErr]         = useState("");
  const [loading, setLoading] = useState(false);
  const bonus = settings.signup_bonus ?? 2000;
  const T = theme(dark);

  const handleRegister = async () => {
    setErr(""); setLoading(true);
    try {
      if (!name || !phone || pwd.length < 6) throw new Error("Fill all fields. Password ≥ 6 chars.");
      await signUpWithPhone(phone, pwd, name, refCode);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background: dark ? BG_DARK : "#0F2D22", padding:16, transition:"background 0.3s" }}>
      <div style={{ background:T.card, borderRadius:24, padding:"32px 28px", width:"100%", maxWidth:400, boxShadow:"0 24px 64px rgba(0,0,0,0.4)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={S.logoMark}>E</div>
            <span style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:20, color:T.text }}>Earn<span style={{ color:BRAND }}>Net</span></span>
          </div>
          <button onClick={toggleDark} style={{ background:"none", border:`0.5px solid ${T.border}`, borderRadius:10, width:34, height:34, cursor:"pointer", fontSize:16, color:T.text }}>{dark ? "☀️" : "🌙"}</button>
        </div>
        <h2 style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:22, marginBottom:6, color:T.text }}>Create account</h2>
        <div style={{ background:"#E1F5EE", borderRadius:10, padding:"10px 14px", fontSize:13, color:BRAND_DARK, marginBottom:18 }}>
          🎁 Get <strong style={{ margin:"0 4px" }}>{fmt(bonus)}</strong> signup bonus instantly!
        </div>
        {err && <div style={{ background:"#FAECE7", color:"#993C1D", borderRadius:10, padding:"10px 14px", fontSize:13, marginBottom:4, marginTop:10 }}>{err}</div>}
        {[["Full name","text","Your name",name,setName],["Phone number","tel","0700 000 000",phone,setPhone],["Password","password","Min 6 characters",pwd,setPwd],["Referral code (optional)","text","e.g. ABC123",refCode,setRefCode]].map(([lbl,type,ph,val,set]) => (
          <div key={lbl}>
            <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>{lbl}</label>
            <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type={type} placeholder={ph} value={val} onChange={e => set(e.target.value)} />
          </div>
        ))}
        <button style={{ ...S.primaryBtn, marginTop:18 }} onClick={handleRegister} disabled={loading}>{loading ? "Creating account..." : "Join & start earning →"}</button>
        <p style={{ textAlign:"center", marginTop:20, fontSize:13, color:T.textSub }}>Already have an account? <button style={{ background:"none", border:"none", color:BRAND, fontSize:13, fontWeight:600, cursor:"pointer" }} onClick={onSwitch}>Sign in</button></p>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────
function MainApp({ session, profile, settings, refreshProfile, dark, toggleDark }) {
  const [tab, setTab]                     = useState("home");
  const [tasks, setTasks]                 = useState([]);
  const [txns, setTxns]                   = useState([]);
  const [withdrawals, setWithdrawals]     = useState([]);
  const [deposits, setDeposits]           = useState([]);
  const [referrals, setReferrals]         = useState([]);
  const [toast, setToast]                 = useState(null);
  const [taskLoading, setTaskLoading]     = useState(false);
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [depositModal, setDepositModal]   = useState(false);
  const [activateModal, setActivateModal] = useState(false);
  const [selectedTask, setSelectedTask]   = useState(null);
  const [notifOpen, setNotifOpen]         = useState(false);
  const uid = session.user.id;
  const T   = theme(dark);

  // Derive notifications from transactions
  const notifications = txns.slice(0, 5).map(tx => ({
    id: tx.id,
    icon: tx.type === "task" ? "✅" : tx.type === "referral" ? "👥" : tx.type === "bonus" ? "🎁" : tx.type === "streak" ? "🔥" : "💸",
    title: tx.description ?? tx.type,
    amount: tx.amount,
    time: new Date(tx.created_at).toLocaleDateString(),
  }));

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadTasks = useCallback(async () => {
    setTaskLoading(true);
    try { setTasks(await getActiveTasks(uid)); } catch {}
    finally { setTaskLoading(false); }
  }, [uid]);

  const loadWallet = useCallback(async () => {
    const [t, w, d] = await Promise.all([getTransactions(uid), getUserWithdrawals(uid), getUserDeposits(uid)]);
    setTxns(t); setWithdrawals(w); setDeposits(d);
  }, [uid]);

  const loadReferrals = useCallback(async () => {
    setReferrals(await getReferralTree(uid));
  }, [uid]);

  useEffect(() => { loadTasks(); loadWallet(); loadReferrals(); }, [loadTasks, loadWallet, loadReferrals]);

  const handleCompleteTask = async (taskId) => {
    if (!profile?.activated) { setActivateModal(true); return; }
    try {
      await completeTask(uid, taskId);
      showToast("Task completed! Balance updated ✓");
      await Promise.all([loadTasks(), refreshProfile(), loadWallet()]);
    } catch (e) { showToast(e.message ?? "Could not complete task", "error"); }
  };

  const handleWithdraw = async ({ amount, method, phone }) => {
    try {
      await requestWithdrawal(uid, parseInt(amount), method, phone);
      showToast("Withdrawal request submitted ✓");
      setWithdrawModal(false);
      await Promise.all([refreshProfile(), loadWallet()]);
    } catch (e) { showToast(e.message ?? "Withdrawal failed", "error"); }
  };

  const handleDeposit = async ({ amount, method, phone }) => {
    try {
      await requestDeposit(uid, parseInt(amount), method, phone);
      showToast("Deposit request submitted! We'll confirm shortly ✓");
      setDepositModal(false);
      await loadWallet();
    } catch (e) { showToast(e.message ?? "Deposit failed", "error"); }
  };

  const handleActivate = async ({ method, phone }) => {
    try {
      await activateAccount(uid, method, phone);
      showToast("Account activation request sent ✓ — we'll confirm within 24h");
      setActivateModal(false);
      await refreshProfile();
    } catch (e) { showToast(e.message ?? "Activation failed", "error"); }
  };

  const tabs = [
    { id:"home",     icon:"🏠", label:"Home" },
    { id:"tasks",    icon:"📋", label:"Tasks" },
    { id:"wallet",   icon:"💰", label:"Wallet" },
    { id:"referral", icon:"👥", label:"Refer" },
    { id:"profile",  icon:"👤", label:"Profile" },
  ];

  if (selectedTask) {
    return (
      <TaskDetailPage
        task={selectedTask}
        profile={profile}
        dark={dark}
        onBack={() => setSelectedTask(null)}
        onComplete={async (taskId) => { await handleCompleteTask(taskId); setSelectedTask(null); }}
      />
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", minHeight:"100vh", background:T.bg, maxWidth:480, margin:"0 auto", transition:"background 0.3s" }}>
      {/* Header */}
      <header style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", background:T.headerBg, borderBottom:`0.5px solid ${T.border}`, position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ ...S.logoMark, width:32, height:32, fontSize:16 }}>E</div>
          <span style={{ fontWeight:700, fontSize:18, color:T.text }}>Earn<span style={{ color:BRAND }}>Net</span></span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {!profile?.activated && (
            <button onClick={() => setActivateModal(true)}
              style={{ background:"#FAEEDA", color:"#854F0B", border:"none", borderRadius:20, padding:"4px 12px", fontSize:11, fontWeight:600, cursor:"pointer" }}>
              ⚡ Activate
            </button>
          )}
          {/* Dark mode toggle */}
          <button onClick={toggleDark} style={{ background:"none", border:`0.5px solid ${T.border}`, borderRadius:10, width:32, height:32, cursor:"pointer", fontSize:15, color:T.text, display:"flex", alignItems:"center", justifyContent:"center" }}>
            {dark ? "☀️" : "🌙"}
          </button>
          {/* Notifications bell */}
          <div style={{ position:"relative" }}>
            <button onClick={() => setNotifOpen(o => !o)} style={{ background:"none", border:`0.5px solid ${T.border}`, borderRadius:10, width:32, height:32, cursor:"pointer", fontSize:16, color:T.text, display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
              🔔
              {notifications.length > 0 && (
                <span style={{ position:"absolute", top:-4, right:-4, background:"#E24B4A", color:"white", fontSize:9, padding:"1px 5px", borderRadius:10, fontWeight:700 }}>
                  {Math.min(notifications.length, 9)}
                </span>
              )}
            </button>
            {notifOpen && (
              <div style={{ position:"absolute", right:0, top:"calc(100% + 8px)", width:280, background:T.notifBg, border:`0.5px solid ${T.border}`, borderRadius:16, boxShadow:"0 8px 24px rgba(0,0,0,0.15)", zIndex:200, overflow:"hidden" }}>
                <div style={{ padding:"12px 14px 10px", borderBottom:`0.5px solid ${T.border}`, fontWeight:700, fontSize:13, color:T.text }}>Recent activity</div>
                {notifications.length === 0
                  ? <div style={{ padding:20, textAlign:"center", color:T.textSub, fontSize:13 }}>No activity yet</div>
                  : notifications.map(n => (
                      <div key={n.id} style={{ padding:"10px 14px", borderBottom:`0.5px solid ${T.border}`, background:T.notifBg, cursor:"default" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                            <span style={{ fontSize:18 }}>{n.icon}</span>
                            <div>
                              <div style={{ fontSize:12, fontWeight:600, color:T.text }}>{n.title}</div>
                              <div style={{ fontSize:10, color:T.textSub }}>{n.time}</div>
                            </div>
                          </div>
                          <div style={{ fontSize:12, fontWeight:700, color: n.amount > 0 ? BRAND : "#E24B4A", whiteSpace:"nowrap" }}>
                            {n.amount > 0 ? "+" : ""}{fmt(n.amount)}
                          </div>
                        </div>
                      </div>
                    ))}
              </div>
            )}
          </div>
          <div style={{ width:34, height:34, borderRadius:"50%", background:BRAND, color:"white", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700 }}>
            {profile?.initials ?? "?"}
          </div>
        </div>
      </header>

      {/* Balance pill below header */}
      <div style={{ padding:"8px 16px 0", display:"flex", justifyContent:"flex-end" }}>
        <div style={{ background:"#E1F5EE", color:BRAND_DARK, padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600 }}>{fmt(profile?.balance)}</div>
      </div>

      <main style={{ flex:1, overflowY:"auto", paddingTop:4 }}>
        {tab === "home"     && <HomeTab     profile={profile} tasks={tasks} settings={settings} onGoTasks={() => setTab("tasks")} onWithdraw={() => setWithdrawModal(true)} onDeposit={() => setDepositModal(true)} onActivate={() => setActivateModal(true)} onSelectTask={setSelectedTask} txns={txns} dark={dark} />}
        {tab === "tasks"    && <TasksTab    tasks={tasks} loading={taskLoading} onComplete={handleCompleteTask} onRefresh={loadTasks} onSelectTask={setSelectedTask} dark={dark} />}
        {tab === "wallet"   && <WalletTab   profile={profile} txns={txns} withdrawals={withdrawals} deposits={deposits} settings={settings} onWithdraw={() => setWithdrawModal(true)} onDeposit={() => setDepositModal(true)} dark={dark} />}
        {tab === "referral" && <ReferralTab profile={profile} referrals={referrals} settings={settings} dark={dark} />}
        {tab === "profile"  && <ProfileTab  profile={profile} onSignOut={signOut} onActivate={() => setActivateModal(true)} onDeposit={() => setDepositModal(true)} dark={dark} />}
      </main>

      {/* Bottom nav */}
      <nav style={{ display:"flex", background:T.navBg, borderTop:`0.5px solid ${T.border}`, position:"sticky", bottom:0, zIndex:50 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"10px 0", background:"none", border:"none", color: tab === t.id ? BRAND : T.textSub, cursor:"pointer", transition:"color 0.15s" }}>
            <span style={{ fontSize:22 }}>{t.icon}</span>
            <span style={{ fontSize:10, marginTop:2 }}>{t.label}</span>
          </button>
        ))}
      </nav>

      {withdrawModal && <WithdrawModal profile={profile} settings={settings} onClose={() => setWithdrawModal(false)} onSubmit={handleWithdraw} dark={dark} />}
      {depositModal  && <DepositModal  settings={settings} onClose={() => setDepositModal(false)}  onSubmit={handleDeposit} dark={dark} />}
      {activateModal && <ActivateModal settings={settings} onClose={() => setActivateModal(false)} onSubmit={handleActivate} dark={dark} />}
      {toast && <div style={{ position:"fixed", bottom:80, left:"50%", transform:"translateX(-50%)", background: toast.type === "error" ? "#E24B4A" : BRAND, color:"white", padding:"12px 24px", borderRadius:14, fontSize:13, fontWeight:500, zIndex:300, boxShadow:"0 4px 20px rgba(0,0,0,0.25)", animation:"slideUp 0.3s ease", whiteSpace:"nowrap" }}>{toast.msg}</div>}

      {/* Close notif on outside click */}
      {notifOpen && <div style={{ position:"fixed", inset:0, zIndex:150 }} onClick={() => setNotifOpen(false)} />}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'DM Sans',sans-serif; background:${T.bg}; overscroll-behavior:none; transition:background 0.3s; }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-thumb { background:#ddd; border-radius:2px; }
        @keyframes slideUp { from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
        button:active { transform:scale(0.97); }
        input:focus, select:focus { outline:none; border-color:${BRAND} !important; }
      `}</style>
    </div>
  );
}

// ── Activate Modal ─────────────────────────────────────────────
function ActivateModal({ settings, onClose, onSubmit, dark }) {
  const [method, setMethod]   = useState("mtn");
  const [phone, setPhone]     = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");
  const fee = parseInt(settings.activation_fee ?? 5000);
  const T = theme(dark);

  const handleSubmit = async () => {
    setErr("");
    if (!phone) return setErr("Enter your mobile money number");
    setLoading(true);
    await onSubmit({ method, phone });
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }} onClick={onClose}>
      <div style={{ background:T.card, borderRadius:"24px 24px 0 0", padding:"24px 20px 36px", width:"100%", maxWidth:480, animation:"slideUp 0.25s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontWeight:700, fontSize:18, color:T.text }}>⚡ Activate account</div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:T.textSub }}>×</button>
        </div>
        <p style={{ fontSize:13, color:T.textSub, marginBottom:18, lineHeight:1.6 }}>
          A one-time activation fee of <strong style={{ color:T.text }}>{fmt(fee)}</strong> unlocks all task earning features and withdrawals.
        </p>
        <div style={{ background:"#E1F5EE", borderRadius:12, padding:"14px 16px", marginBottom:18 }}>
          {["✅ Complete all tasks and earn","💸 Request withdrawals","👥 Earn referral commissions","🔥 Streak bonuses"].map(b => (
            <div key={b} style={{ fontSize:13, color:BRAND_DARK, marginBottom:5 }}>{b}</div>
          ))}
        </div>
        {err && <div style={{ background:"#FAECE7", color:"#993C1D", borderRadius:10, padding:"10px 14px", fontSize:13, marginBottom:4 }}>{err}</div>}
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Pay via</label>
        <select style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} value={method} onChange={e => setMethod(e.target.value)}>
          <option value="mtn">MTN Mobile Money</option>
          <option value="airtel">Airtel Money</option>
        </select>
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Your mobile money number</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="tel" placeholder="0700 000 000" value={phone} onChange={e => setPhone(e.target.value)} />
        <div style={{ background:"#FAEEDA", borderRadius:10, padding:"10px 14px", fontSize:12, color:"#854F0B", margin:"14px 0" }}>
          ⚠️ Send <strong>{fmt(fee)}</strong> to our paybill, then submit below. We'll confirm and activate within 24 hours.
        </div>
        <button style={{ ...S.primaryBtn, padding:"13px 0" }} onClick={handleSubmit} disabled={loading}>
          {loading ? "Submitting..." : `Submit activation — ${fmt(fee)}`}
        </button>
      </div>
    </div>
  );
}

// ── Deposit Modal (with fee breakdown) ────────────────────────
function DepositModal({ settings, onClose, onSubmit, dark }) {
  const [amount, setAmount]   = useState("");
  const [method, setMethod]   = useState("mtn");
  const [phone, setPhone]     = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");
  const minDeposit   = parseInt(settings.min_deposit ?? 2000);
  // Platform fee from settings (e.g. 15 = 15%). Deposit fee is 0 for mobile money in Uganda.
  const depositFeeRate = 0; // adjust if your platform charges
  const quickAmounts = [5000, 10000, 20000, 50000];
  const amt    = parseInt(amount) || 0;
  const fee    = Math.round(amt * depositFeeRate);
  const total  = amt + fee;
  const T = theme(dark);

  const handleSubmit = async () => {
    setErr("");
    if (!amt || amt < minDeposit) return setErr(`Minimum deposit is ${fmt(minDeposit)}`);
    if (!phone) return setErr("Enter your mobile money number");
    setLoading(true);
    await onSubmit({ amount: amt, method, phone });
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }} onClick={onClose}>
      <div style={{ background:T.card, borderRadius:"24px 24px 0 0", padding:"24px 20px 36px", width:"100%", maxWidth:480, animation:"slideUp 0.25s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontWeight:700, fontSize:18, color:T.text }}>💳 Deposit funds</div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:T.textSub }}>×</button>
        </div>
        {err && <div style={{ background:"#FAECE7", color:"#993C1D", borderRadius:10, padding:"10px 14px", fontSize:13, marginBottom:4 }}>{err}</div>}
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:4 }}>Amount (UGX)</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="number" placeholder={`Min ${fmt(minDeposit)}`} value={amount} onChange={e => setAmount(e.target.value)} />
        <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
          {quickAmounts.map(a => (
            <button key={a} onClick={() => setAmount(String(a))}
              style={{ padding:"6px 14px", borderRadius:20, border:`0.5px solid ${amt === a ? BRAND : T.inputBrd}`, background:amt === a ? "#E1F5EE" : T.chipBg, color:amt === a ? BRAND_DARK : T.text, fontSize:12, cursor:"pointer", fontWeight:amt === a ? 600 : 400 }}>
              {fmt(a)}
            </button>
          ))}
        </div>

        {/* Fee breakdown */}
        {amt > 0 && (
          <div style={{ background:dark ? "#142e20" : "#f8fafc", borderRadius:12, padding:"12px 14px", margin:"14px 0 4px" }}>
            {[["Deposit amount", fmt(amt)],["Processing fee", fee > 0 ? fmt(fee) : "Free"]].map(([lbl, val]) => (
              <div key={lbl} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T.textSub, marginBottom:6 }}>
                <span>{lbl}</span><span>{val}</span>
              </div>
            ))}
            <div style={{ borderTop:`0.5px solid ${T.border}`, paddingTop:8, display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:14, color:T.text }}>
              <span>Total to send</span><span style={{ color:BRAND }}>{fmt(total)}</span>
            </div>
          </div>
        )}

        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Payment method</label>
        <select style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} value={method} onChange={e => setMethod(e.target.value)}>
          <option value="mtn">MTN Mobile Money</option>
          <option value="airtel">Airtel Money</option>
        </select>
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Mobile money number</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="tel" placeholder="0700 000 000" value={phone} onChange={e => setPhone(e.target.value)} />
        <div style={{ background:"#E6F1FB", borderRadius:10, padding:"10px 14px", fontSize:12, color:"#185FA5", margin:"14px 0" }}>
          ℹ️ Send the amount to our paybill, then submit. Your wallet will be credited once confirmed.
        </div>
        <button style={{ ...S.primaryBtn, padding:"13px 0" }} onClick={handleSubmit} disabled={loading}>
          {loading ? "Submitting..." : `Submit deposit — ${fmt(total || minDeposit)} →`}
        </button>
      </div>
    </div>
  );
}

// ── Task Detail ────────────────────────────────────────────────
function TaskDetailPage({ task: t, profile, onBack, onComplete, dark }) {
  const [doing, setDoing] = useState(false);
  const [done, setDone]   = useState(false);
  const T = theme(dark);
  const pct       = t.budget > 0 ? Math.min(100, Math.round((t.used / t.budget) * 100)) : 0;
  const spotsLeft = (t.limit_count ?? 0) - (t.completions ?? 0);
  const steps     = {
    social:  ["Open the link below","Follow / like the page or post","Come back and click Mark as Done"],
    survey:  ["Read the questions carefully","Answer honestly — takes about 5 minutes","Submit and mark as done here"],
    install: ["Download the app from the link","Open it and create an account","Mark done after logging in"],
    review:  ["Visit the page via the link","Leave a genuine review","Screenshot it, then mark done"],
  };
  const taskSteps = steps[t.type] ?? steps.social;

  const handleDone = async () => {
    setDoing(true);
    await onComplete(t.id);
    setDone(true);
    setDoing(false);
  };

  if (done) {
    return (
      <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:T.bg, padding:24 }}>
        <div style={{ fontSize:64, marginBottom:16 }}>🎉</div>
        <div style={{ fontFamily:"'Sora',sans-serif", fontSize:24, fontWeight:700, marginBottom:8, color:T.text }}>Task complete!</div>
        <div style={{ fontSize:16, color:BRAND_DARK, fontWeight:600, marginBottom:24 }}>+{fmt(t.reward)} added to your balance</div>
        <button style={{ ...S.primaryBtn, width:"auto", padding:"12px 32px" }} onClick={onBack}>Back to tasks</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'DM Sans',sans-serif", paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg,${BG_DARK},${BRAND_DARK})`, color:"white", padding:"20px 16px 28px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"white", borderRadius:10, padding:"7px 14px", fontSize:13, cursor:"pointer", marginBottom:20 }}>← Back</button>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:56, height:56, borderRadius:14, background:t.color ?? "#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0 }}>{t.icon ?? "📋"}</div>
          <div>
            <div style={{ fontSize:11, opacity:0.7, marginBottom:4 }}>{t.business}</div>
            <div style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:20, lineHeight:1.2 }}>{t.title}</div>
          </div>
        </div>
      </div>

      <div style={{ padding:"0 16px", marginTop:-12 }}>
        <div style={{ background:T.card, borderRadius:16, padding:"18px 20px", boxShadow:"0 4px 16px rgba(0,0,0,0.08)", marginBottom:16, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, textAlign:"center" }}>
          {[["REWARD", fmt(t.reward), BRAND_DARK, "'Sora',sans-serif", 20],["TIME", t.time_est ?? "~5 min",T.text,"inherit",16],["SPOTS LEFT", spotsLeft, spotsLeft < 20 ? "#E24B4A" : T.text,"inherit",16]].map(([lbl,val,tc,ff,fs]) => (
            <div key={lbl}>
              <div style={{ fontSize:10, color:T.textSub, marginBottom:4 }}>{lbl}</div>
              <div style={{ fontFamily:ff, fontWeight:700, fontSize:fs, color:tc }}>{val}</div>
            </div>
          ))}
        </div>

        <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T.textSub, marginBottom:8 }}>
            <span>Task progress</span><span>{t.completions ?? 0} / {t.limit_count ?? "∞"} completed</span>
          </div>
          <div style={{ height:8, background: dark ? "#2a5040" : "#eee", borderRadius:4 }}>
            <div style={{ height:"100%", width:`${pct}%`, background:pct > 80 ? "#E24B4A" : BRAND, borderRadius:4, transition:"width 0.5s ease" }} />
          </div>
        </div>

        {t.description && (
          <div style={{ background:T.card, borderRadius:14, padding:"16px", marginBottom:14 }}>
            <div style={{ fontWeight:600, fontSize:14, marginBottom:8, color:T.text }}>About this task</div>
            <p style={{ fontSize:13, color:T.textSub, lineHeight:1.7 }}>{t.description}</p>
          </div>
        )}

        <div style={{ background:T.card, borderRadius:14, padding:"16px", marginBottom:14 }}>
          <div style={{ fontWeight:600, fontSize:14, marginBottom:14, color:T.text }}>How to complete</div>
          {taskSteps.map((step, i) => (
            <div key={i} style={{ display:"flex", gap:12, marginBottom: i < taskSteps.length - 1 ? 14 : 0, alignItems:"flex-start" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:"#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, color:BRAND_DARK, flexShrink:0 }}>{i + 1}</div>
              <div style={{ fontSize:13, color:T.textSub, lineHeight:1.6, paddingTop:4 }}>{step}</div>
            </div>
          ))}
        </div>

        {!profile?.activated && (
          <div style={{ background:"#FAEEDA", borderRadius:14, padding:"14px 16px", marginBottom:14 }}>
            <div style={{ fontWeight:600, fontSize:14, color:"#854F0B", marginBottom:4 }}>⚡ Account not activated</div>
            <div style={{ fontSize:13, color:"#854F0B" }}>You need to activate your account to complete tasks and earn money.</div>
          </div>
        )}
      </div>

      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, padding:"16px", background:T.card, borderTop:`0.5px solid ${T.border}` }}>
        <button style={{ ...S.primaryBtn, padding:"14px 0", fontSize:15 }} onClick={handleDone} disabled={doing}>
          {doing ? "Submitting..." : profile?.activated ? "Mark as done ✓" : "⚡ Activate to earn"}
        </button>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'DM Sans',sans-serif; }
        button:active { transform:scale(0.97); }
      `}</style>
    </div>
  );
}

// ── Mini Earnings Chart ────────────────────────────────────────
// Pure CSS/SVG bar chart — no external lib needed
function EarningsChart({ txns, dark }) {
  const T = theme(dark);
  // Build last-7-days buckets
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { label: d.toLocaleDateString("en", { weekday:"short" }), date: d.toDateString(), total: 0 };
  });
  txns.filter(tx => tx.amount > 0).forEach(tx => {
    const d = new Date(tx.created_at).toDateString();
    const b = buckets.find(b => b.date === d);
    if (b) b.total += tx.amount;
  });
  const maxVal = Math.max(...buckets.map(b => b.total), 1);

  return (
    <div style={{ background:T.card, borderRadius:14, padding:"16px", margin:"0 16px 16px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
      <div style={{ fontWeight:600, fontSize:14, marginBottom:16, color:T.text }}>📈 Earnings – last 7 days</div>
      <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:80 }}>
        {buckets.map((b, i) => {
          const pct = Math.max((b.total / maxVal) * 100, b.total > 0 ? 8 : 2);
          return (
            <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
              <div style={{ width:"100%", height:b.total > 0 ? `${pct}%` : "2px", background: b.total > 0 ? BRAND : (dark ? "#2a5040" : "#eee"), borderRadius:4, transition:"height 0.4s ease", minHeight: b.total > 0 ? 4 : 2 }} title={fmt(b.total)} />
              <div style={{ fontSize:9, color:T.textSub, textAlign:"center" }}>{b.label}</div>
            </div>
          );
        })}
      </div>
      {buckets.every(b => b.total === 0) && (
        <div style={{ textAlign:"center", color:T.textSub, fontSize:12, marginTop:8 }}>Complete tasks to see your earnings here</div>
      )}
    </div>
  );
}

// ── Home Tab ───────────────────────────────────────────────────
function HomeTab({ profile, tasks, settings, onGoTasks, onWithdraw, onDeposit, onActivate, onSelectTask, txns, dark }) {
  const streakDays  = profile?.streak_days ?? 0;
  const streakBonus = settings.streak_bonus ?? 5000;
  const T = theme(dark);

  return (
    <div style={{ animation:"slideUp 0.3s ease", paddingBottom:20 }}>
      {!profile?.activated && (
        <div style={{ margin:"12px 16px 0", background:`linear-gradient(135deg,#FAEEDA,#fef3e2)`, borderRadius:14, padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }} onClick={onActivate}>
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:"#854F0B" }}>⚡ Activate to earn</div>
            <div style={{ fontSize:12, color:"#a0611a", marginTop:2 }}>One-time fee · Unlock all tasks</div>
          </div>
          <button style={{ background:"#854F0B", color:"white", border:"none", borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer" }}>Activate →</button>
        </div>
      )}

      <div style={{ background:`linear-gradient(135deg,${BG_DARK} 0%,${BRAND_DARK} 100%)`, color:"white", margin: profile?.activated ? 16 : "12px 16px 16px", borderRadius:20, padding:"24px 22px", boxShadow:"0 8px 32px rgba(15,46,34,0.35)" }}>
        <div style={{ fontSize:12, opacity:0.8, marginBottom:6 }}>Your balance</div>
        <div style={{ fontSize:40, fontWeight:700, fontFamily:"'Sora',sans-serif", letterSpacing:-1 }}>{fmt(profile?.balance)}</div>
        <div style={{ fontSize:12, opacity:0.7, marginTop:4 }}>Total earned: {fmt(profile?.total_earned)}</div>
        <div style={{ display:"flex", gap:10, marginTop:20, flexWrap:"wrap" }}>
          <button style={{ background:BRAND, color:"white", border:"none", borderRadius:10, padding:"10px 18px", fontSize:13, fontWeight:600, cursor:"pointer" }} onClick={onWithdraw}>Withdraw 💸</button>
          <button style={{ background:"rgba(255,255,255,0.2)", color:"white", border:"none", borderRadius:10, padding:"10px 18px", fontSize:13, fontWeight:600, cursor:"pointer" }} onClick={onDeposit}>Deposit 💳</button>
          <button style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"none", borderRadius:10, padding:"10px 18px", fontSize:13, fontWeight:600, cursor:"pointer" }} onClick={onGoTasks}>Earn →</button>
        </div>
      </div>

      {/* Earnings chart */}
      <EarningsChart txns={txns} dark={dark} />

      <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", margin:"0 16px 12px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontWeight:600, fontSize:15, color:T.text }}>🔥 Daily streak</div>
            <div style={{ fontSize:12, color:T.textSub, marginTop:3 }}>
              {streakDays >= 7 ? `You earned ${fmt(streakBonus)} streak bonus!` : `${7 - streakDays} more days for ${fmt(streakBonus)} bonus`}
            </div>
          </div>
          <div style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:28, color:BRAND }}>
            {streakDays}<span style={{ fontSize:14, fontWeight:400, color:T.textSub }}>/7</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:6, marginTop:14 }}>
          {[...Array(7)].map((_, i) => <div key={i} style={{ flex:1, height:6, borderRadius:3, background: i < streakDays ? BRAND : (dark ? "#2a5040" : "#eee") }} />)}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, margin:"0 16px 16px" }}>
        {[{ label:"Tasks done", value:profile?.tasks_done ?? 0, icon:"✅" },{ label:"Referrals", value:profile?.referrals ?? 0, icon:"👥" }].map(s => (
          <div key={s.label} style={{ background:T.card, borderRadius:14, padding:"14px 16px", margin:0, display:"flex", alignItems:"center", gap:12, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <span style={{ fontSize:28 }}>{s.icon}</span>
            <div>
              <div style={{ fontWeight:700, fontSize:22, fontFamily:"'Sora',sans-serif", color:T.text }}>{s.value}</div>
              <div style={{ fontSize:11, color:T.textSub }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ margin:"0 16px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <span style={{ fontWeight:600, fontSize:15, color:T.text }}>Available tasks</span>
          <button style={{ background:"none", border:"none", color:BRAND, fontSize:13, fontWeight:600, cursor:"pointer" }} onClick={onGoTasks}>See all →</button>
        </div>
        {tasks.slice(0, 3).map(t => <TaskCard key={t.id} task={t} onSelect={() => onSelectTask(t)} compact dark={dark} />)}
        {tasks.length === 0 && <div style={{ color:T.textSub, fontSize:13, textAlign:"center", padding:24 }}>All tasks done! Check back soon 🎉</div>}
      </div>
    </div>
  );
}

// ── Tasks Tab ──────────────────────────────────────────────────
function TasksTab({ tasks, loading, onComplete, onRefresh, onSelectTask, dark }) {
  const [filter, setFilter] = useState("all");
  const T = theme(dark);
  const categories = ["all", ...new Set(tasks.map(t => t.category).filter(Boolean))];
  const filtered   = filter === "all" ? tasks : tasks.filter(t => t.category === filter);

  return (
    <div style={{ animation:"slideUp 0.3s ease", paddingBottom:20 }}>
      <div style={{ padding:"0 16px 12px" }}>
        <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4 }}>
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ padding:"7px 16px", borderRadius:20, border:`0.5px solid ${filter === c ? BRAND : T.chipBrd}`, background: filter === c ? BRAND : T.chipBg, color: filter === c ? "white" : T.text, fontSize:12, cursor:"pointer", whiteSpace:"nowrap", fontWeight: filter === c ? 600 : 400 }}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {loading
        ? <div style={{ textAlign:"center", color:T.textSub, padding:40 }}>Loading tasks...</div>
        : filtered.length === 0
          ? <div style={{ textAlign:"center", color:T.textSub, padding:40 }}>No {filter} tasks right now.<br /><button style={{ background:"none", border:"none", color:BRAND, fontSize:13, fontWeight:600, cursor:"pointer", display:"block", margin:"12px auto 0" }} onClick={onRefresh}>Refresh</button></div>
          : filtered.map(t => <TaskCard key={t.id} task={t} onSelect={() => onSelectTask(t)} dark={dark} />)
      }
    </div>
  );
}

function TaskCard({ task: t, onSelect, compact, dark }) {
  const T = theme(dark);
  return (
    <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", margin: compact ? "0 0 10px" : "0 16px 12px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", cursor:"pointer" }} onClick={onSelect}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:44, height:44, borderRadius:12, background:t.color ?? "#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{t.icon ?? "📋"}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:600, fontSize:14, color:T.text }}>{t.title}</div>
          <div style={{ fontSize:11, color:T.textSub, marginTop:2 }}>{t.business} · {t.time_est ?? "~5 min"}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontWeight:700, color:t.text_color ?? BRAND_DARK, fontSize:15 }}>{fmt(t.reward)}</div>
          <div style={{ fontSize:10, color:T.textSub }}>per task</div>
        </div>
      </div>
    </div>
  );
}

// ── Wallet Tab ─────────────────────────────────────────────────
function WalletTab({ profile, txns, withdrawals, deposits, settings, onWithdraw, onDeposit, dark }) {
  const [view, setView] = useState("transactions");
  const T = theme(dark);
  const minW = settings.min_withdrawal ?? 5000;

  return (
    <div style={{ animation:"slideUp 0.3s ease", paddingBottom:20 }}>
      <div style={{ background:`linear-gradient(135deg,${BG_DARK} 0%,${BRAND_DARK} 100%)`, color:"white", margin:16, borderRadius:20, padding:"24px 22px", boxShadow:"0 8px 32px rgba(15,46,34,0.35)" }}>
        <div style={{ fontSize:12, opacity:0.8 }}>Available balance</div>
        <div style={{ fontSize:36, fontWeight:700, fontFamily:"'Sora',sans-serif", margin:"8px 0 4px" }}>{fmt(profile?.balance)}</div>
        <div style={{ fontSize:11, opacity:0.7 }}>Min withdrawal: {fmt(minW)}</div>
        <div style={{ display:"flex", gap:10, marginTop:16 }}>
          <button style={{ background:BRAND, color:"white", border:"none", borderRadius:10, padding:"10px 18px", fontSize:13, fontWeight:600, cursor:"pointer" }} onClick={onWithdraw}>Withdraw 💸</button>
          <button style={{ background:"rgba(255,255,255,0.2)", color:"white", border:"none", borderRadius:10, padding:"10px 18px", fontSize:13, fontWeight:600, cursor:"pointer" }} onClick={onDeposit}>Deposit 💳</button>
        </div>
      </div>

      <div style={{ display:"flex", gap:8, padding:"0 16px 16px" }}>
        {["transactions","withdrawals","deposits"].map(v => (
          <button key={v} onClick={() => setView(v)} style={{ padding:"7px 16px", borderRadius:20, border:`0.5px solid ${view === v ? BRAND : T.chipBrd}`, background: view === v ? BRAND : T.chipBg, color: view === v ? "white" : T.text, fontSize:12, cursor:"pointer", whiteSpace:"nowrap", fontWeight: view === v ? 600 : 400 }}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ padding:"0 16px" }}>
        {view === "transactions" && (txns.length === 0
          ? <div style={{ textAlign:"center", color:T.textSub, padding:30 }}>No transactions yet</div>
          : txns.map(tx => <TxRow key={tx.id} tx={tx} dark={dark} />)
        )}
        {view === "withdrawals" && (withdrawals.length === 0
          ? <div style={{ textAlign:"center", color:T.textSub, padding:30 }}>No withdrawal history</div>
          : withdrawals.map(w => (
              <div key={w.id} style={{ background:T.card, borderRadius:14, padding:"14px 16px", margin:"0 0 10px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:14, color:T.text }}>{fmt(w.amount)}</div>
                  <div style={{ fontSize:11, color:T.textSub, marginTop:2 }}>{w.method?.toUpperCase()} · {new Date(w.requested_at).toLocaleDateString()}</div>
                </div>
                <StatusPill status={w.status} />
              </div>
            ))
        )}
        {view === "deposits" && (deposits.length === 0
          ? <div style={{ textAlign:"center", color:T.textSub, padding:30 }}>No deposit history</div>
          : deposits.map(d => (
              <div key={d.id} style={{ background:T.card, borderRadius:14, padding:"14px 16px", margin:"0 0 10px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:14, color:T.text }}>+{fmt(d.amount)}</div>
                  <div style={{ fontSize:11, color:T.textSub, marginTop:2 }}>{d.method?.toUpperCase()} · {new Date(d.requested_at).toLocaleDateString()}</div>
                </div>
                <StatusPill status={d.status} />
              </div>
            ))
        )}
      </div>
    </div>
  );
}

function TxRow({ tx, dark }) {
  const T = theme(dark);
  const isCredit = tx.amount > 0;
  const icons    = { task:"✅", referral:"👥", withdrawal:"💸", bonus:"🎁", streak:"🔥", deposit:"💳", activation:"⚡" };
  return (
    <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", margin:"0 0 10px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"flex", alignItems:"center", gap:12 }}>
      <div style={{ width:38, height:38, borderRadius:10, background: isCredit ? "#E1F5EE" : "#FAECE7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>
        {icons[tx.type] ?? (isCredit ? "➕" : "➖")}
      </div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:500, fontSize:13, color:T.text }}>{tx.description ?? tx.type}</div>
        <div style={{ fontSize:11, color:T.textSub }}>{new Date(tx.created_at).toLocaleString()}</div>
      </div>
      <div style={{ fontWeight:700, fontSize:15, color: isCredit ? BRAND_DARK : "#E24B4A" }}>
        {isCredit ? "+" : ""}{fmt(tx.amount)}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = { pending:{bg:"#FAEEDA",tc:"#854F0B"}, processing:{bg:"#E6F1FB",tc:"#185FA5"}, paid:{bg:"#E1F5EE",tc:"#0F6E56"}, confirmed:{bg:"#E1F5EE",tc:"#0F6E56"}, rejected:{bg:"#FAECE7",tc:"#993C1D"} };
  const c   = map[status] ?? { bg:"#f0f0f0", tc:"#888" };
  return <span style={{ background:c.bg, color:c.tc, padding:"4px 12px", borderRadius:20, fontSize:11, fontWeight:600 }}>{status}</span>;
}

// ── Withdraw Modal ─────────────────────────────────────────────
function WithdrawModal({ profile, settings, onClose, onSubmit, dark }) {
  const [amount, setAmount]   = useState("");
  const [method, setMethod]   = useState("mtn");
  const [phone, setPhone]     = useState(profile?.phone ?? "");
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");
  const T = theme(dark);
  const min = parseInt(settings.min_withdrawal ?? 5000);
  const max = parseInt(settings.max_withdrawal ?? 1000000);
  const bal = profile?.balance ?? 0;

  const handleSubmit = async () => {
    setErr("");
    const amt = parseInt(amount);
    if (!amt || amt < min) return setErr(`Minimum withdrawal is ${fmt(min)}`);
    if (amt > max)         return setErr(`Maximum is ${fmt(max)}`);
    if (amt > bal)         return setErr("Insufficient balance");
    if (!phone)            return setErr("Enter your mobile money number");
    setLoading(true);
    await onSubmit({ amount: amt, method, phone });
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }} onClick={onClose}>
      <div style={{ background:T.card, borderRadius:"24px 24px 0 0", padding:"24px 20px 36px", width:"100%", maxWidth:480, animation:"slideUp 0.25s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontWeight:700, fontSize:18, color:T.text }}>Withdraw funds</div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:T.textSub }}>×</button>
        </div>
        <div style={{ background:"#E1F5EE", borderRadius:10, padding:"10px 14px", fontSize:13, color:BRAND_DARK, marginBottom:18 }}>Balance: <strong>{fmt(bal)}</strong></div>
        {err && <div style={{ background:"#FAECE7", color:"#993C1D", borderRadius:10, padding:"10px 14px", fontSize:13, marginBottom:4 }}>{err}</div>}
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:4 }}>Amount (UGX)</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="number" placeholder={`Min ${fmt(min)}`} value={amount} onChange={e => setAmount(e.target.value)} />
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Method</label>
        <select style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} value={method} onChange={e => setMethod(e.target.value)}>
          <option value="mtn">MTN Mobile Money</option>
          <option value="airtel">Airtel Money</option>
        </select>
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Mobile money number</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="tel" placeholder="0700 000 000" value={phone} onChange={e => setPhone(e.target.value)} />
        <button style={{ ...S.primaryBtn, marginTop:14, padding:"13px 0" }} onClick={handleSubmit} disabled={loading}>
          {loading ? "Submitting..." : "Request withdrawal →"}
        </button>
        <p style={{ fontSize:11, color:T.textSub, textAlign:"center", marginTop:12 }}>Processed within 24 hours on business days.</p>
      </div>
    </div>
  );
}

// ── Referral Tab ───────────────────────────────────────────────
function ReferralTab({ profile, referrals, settings, dark }) {
  const T = theme(dark);
  const ref1 = settings.ref1_rate ?? 10;
  const ref2 = settings.ref2_rate ?? 5;
  const ref3 = settings.ref3_rate ?? 2;
  const code = profile?.referral_code ?? "—";
  const link = `${window.location.origin}?ref=${code}`;
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };

  return (
    <div style={{ animation:"slideUp 0.3s ease", paddingBottom:20 }}>
      <div style={{ background:`linear-gradient(135deg,${BG_DARK} 0%,${BRAND_DARK} 100%)`, color:"white", margin:16, borderRadius:20, padding:"24px 22px", boxShadow:"0 8px 32px rgba(15,46,34,0.35)" }}>
        <div style={{ fontSize:14, opacity:0.8, marginBottom:4 }}>Your referral code</div>
        <div style={{ fontFamily:"'Sora',sans-serif", fontSize:36, fontWeight:700, letterSpacing:4, marginBottom:16 }}>{code}</div>
        <button style={{ background:BRAND, color:"white", border:"none", borderRadius:10, padding:"10px 18px", fontSize:13, fontWeight:600, cursor:"pointer" }} onClick={copy}>{copied ? "Link copied! ✓" : "Copy referral link 🔗"}</button>
      </div>
      <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", margin:"0 16px 16px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ fontWeight:600, fontSize:14, marginBottom:14, color:T.text }}>Commission rates</div>
        {[["🥇","Level 1 – Direct",ref1,"#E1F5EE",BRAND_DARK],["🥈","Level 2 – Their referrals",ref2,"#E6F1FB","#185FA5"],["🥉","Level 3 – Their referrals",ref3,"#FAEEDA","#854F0B"]].map(([icon,lbl,pct,bg,tc]) => (
          <div key={lbl} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
            <div style={{ width:38, height:38, borderRadius:10, background:bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{icon}</div>
            <div style={{ flex:1, fontSize:13, color:T.text }}>{lbl}</div>
            <div style={{ fontWeight:700, color:tc, fontSize:15 }}>{pct}%</div>
          </div>
        ))}
      </div>
      <div style={{ padding:"0 16px" }}>
        <div style={{ fontWeight:600, fontSize:14, marginBottom:12, color:T.text }}>Your referrals ({referrals.length})</div>
        {referrals.length === 0
          ? <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", textAlign:"center", color:T.textSub, padding:30 }}>No referrals yet.<br />Share your code to start earning commission!</div>
          : referrals.map(r => (
              <div key={r.id} style={{ background:T.card, borderRadius:14, padding:"14px 16px", margin:"0 0 10px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:36, height:36, borderRadius:"50%", background:"#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:600, color:BRAND_DARK }}>
                  {r.initials ?? r.name?.slice(0,2).toUpperCase()}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:500, fontSize:14, color:T.text }}>{r.name}</div>
                  <div style={{ fontSize:11, color:T.textSub }}>Joined {new Date(r.created_at).toLocaleDateString()}</div>
                </div>
                <div style={{ fontSize:11, fontWeight:600, color: r.activated ? BRAND_DARK : T.textSub }}>{r.activated ? "Active ✓" : "Pending"}</div>
              </div>
            ))}
      </div>
    </div>
  );
}

// ── Profile Tab ────────────────────────────────────────────────
function ProfileTab({ profile, onSignOut, onActivate, onDeposit, dark }) {
  const T = theme(dark);
  return (
    <div style={{ animation:"slideUp 0.3s ease", paddingBottom:20 }}>
      <div style={{ background:`linear-gradient(135deg,${BG_DARK} 0%,${BRAND_DARK} 100%)`, color:"white", margin:16, borderRadius:20, padding:"32px 24px", textAlign:"center", boxShadow:"0 8px 32px rgba(15,46,34,0.35)" }}>
        <div style={{ width:72, height:72, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, fontWeight:700, margin:"0 auto 14px", border:"3px solid rgba(255,255,255,0.4)" }}>
          {profile?.initials ?? "?"}
        </div>
        <div style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:22 }}>{profile?.name}</div>
        <div style={{ fontSize:13, opacity:0.75, marginTop:4 }}>{profile?.phone}</div>
        <div style={{ marginTop:12, display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
          {profile?.kyc_verified && <div style={{ background:"rgba(255,255,255,0.15)", borderRadius:20, padding:"4px 14px", fontSize:11 }}>✓ Verified</div>}
          {profile?.activated
            ? <div style={{ background:"rgba(29,158,117,0.3)", borderRadius:20, padding:"4px 14px", fontSize:11 }}>⚡ Activated</div>
            : <button onClick={onActivate} style={{ background:"#FAEEDA", color:"#854F0B", border:"none", borderRadius:20, padding:"4px 14px", fontSize:11, fontWeight:600, cursor:"pointer" }}>⚡ Not activated</button>}
        </div>
      </div>
      <div style={{ padding:"0 16px" }}>
        {[
          { label:"Member since",    value: profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : "—" },
          { label:"Total earned",    value: fmt(profile?.total_earned) },
          { label:"Tasks completed", value: profile?.tasks_done ?? 0 },
          { label:"Referral code",   value: profile?.referral_code ?? "—" },
          { label:"Account status",  value: profile?.activated ? "⚡ Activated" : "⏳ Not activated" },
          { label:"KYC status",      value: profile?.kyc_verified ? "✓ Verified" : "⏳ Pending" },
        ].map(row => (
          <div key={row.label} style={{ background:T.card, borderRadius:14, padding:"14px 16px", margin:"0 0 10px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:13, color:T.textSub }}>{row.label}</span>
            <span style={{ fontWeight:600, fontSize:13, color:T.text }}>{row.value}</span>
          </div>
        ))}
        {!profile?.activated && (
          <button style={{ ...S.primaryBtn, marginBottom:10, background:"#854F0B", padding:"13px 0" }} onClick={onActivate}>⚡ Activate account</button>
        )}
        <button style={{ ...S.primaryBtn, marginBottom:10, padding:"13px 0" }} onClick={onDeposit}>💳 Deposit funds</button>
        <button style={{ ...S.primaryBtn, background:"#FAECE7", color:"#993C1D", padding:"13px 0" }} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

// ── Shared style constants ─────────────────────────────────────
const S = {
  logoMark:   { width:40, height:40, borderRadius:12, background:BRAND, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:20, color:"white", flexShrink:0 },
  primaryBtn: { display:"block", padding:"12px 24px", background:BRAND, color:"white", border:"none", borderRadius:12, fontSize:14, fontWeight:600, cursor:"pointer", width:"100%" },
};
