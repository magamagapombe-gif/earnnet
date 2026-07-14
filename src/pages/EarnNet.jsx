// src/pages/EarnNet.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import {
  supabase, signUpWithPhone, signInWithPhone, signOut, getProfile,
  getActiveTasks, completeTask, getTransactions, requestWithdrawal,
  getUserWithdrawals, requestDeposit, getUserDeposits, activateAccount,
  getReferralTree, getSettings,
  getInvestmentPlans, getUserInvestments, buyInvestmentPlan,
  requestInvestmentPayment, matureUserInvestments,
} from "../lib/supabase";

const fmt = (n) => "UGX " + Number(n || 0).toLocaleString();

const detectMethod = (phone) => {
  const n = (phone ?? "").replace(/\D/g, "");
  // Airtel Uganda: 070x, 075x, 074x, 020x
  if (/^(070|075|074|020|25670|25675|25674|25620)/.test(n)) return "airtel";
  // MTN Uganda: 077x, 078x, 076x, 031x, 039x (default)
  return "mtn";
};
const BRAND      = "#1D9E75";
const BRAND_DARK = "#0F6E56";
const BG_DARK    = "#0F2D22";

// ── VIP Tier styling — plans reference one of these by vip_tier ──
// (up to 10 plans can now share a tier; the tier itself just drives
// badge colour/gradient/perk copy. Task limit & multiplier live on
// the plan row itself, not here.)
const VIP_TIERS = {
  silver:   { label:"🥈 Silver",   color:"#1D9E75", gradient:"linear-gradient(135deg,#1a3d2b,#1D9E75)", bg:"#F5F5F5", badge:"#E1F5EE", badgeText:BRAND_DARK, perk:"Entry-level plans" },
  gold:     { label:"🥇 Gold",     color:"#185FA5", gradient:"linear-gradient(135deg,#185FA5,#4FA3E0)", bg:"#FAEEDA", badge:"#E6F1FB", badgeText:"#185FA5",  perk:"Mid-tier plans" },
  platinum: { label:"💎 Platinum", color:"#7B61FF", gradient:"linear-gradient(135deg,#4B0082,#7B61FF)", bg:"#F0EEFF", badge:"#F0EEFF", badgeText:"#7B61FF",  perk:"High-tier plans" },
  legend:   { label:"👑 Legend",   color:"#B8860B", gradient:"linear-gradient(135deg,#3D1C00,#B8860B,#FFD700)", bg:"#FFF8E1", badge:"#FFF8E1", badgeText:"#7A5000", perk:"Top-tier plans" },
};
const VIP_RANK = { silver:1, gold:2, platinum:3, legend:4 };

// Duration in months → display text
const fmtDuration = (months) =>
  months === 1 ? "1 month" : months === 12 ? "1 year" : `${months} months`;

// Given a user's investments, find the highest-ranked ACTIVE one.
// Each user_investments row is a self-contained snapshot (plan_name,
// plan_icon, vip_tier, task_limit, multiplier) taken at purchase
// time, so no lookup into a fixed plan table is needed here.
function getActiveTier(investments) {
  const active = (investments ?? []).filter(i => i.status === "active");
  if (active.length === 0) return null;
  const best = active.reduce((a, b) =>
    (VIP_RANK[b.vip_tier] ?? 0) > (VIP_RANK[a.vip_tier] ?? 0) ? b : a
  );
  return {
    vip_tier:   best.vip_tier,
    dailyTasks: best.task_limit,               // null = unlimited
    multiplier: Number(best.multiplier),
    icon:       best.plan_icon,
    planName:   best.plan_name,
    exclusiveTasks: best.vip_tier === "legend",
    ...VIP_TIERS[best.vip_tier],
  };
}

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

// ── Deposit polling hook ───────────────────────────────────────
function useDepositPolling(userId, onSuccess) {
  const [polling, setPolling]     = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const intervalRef               = useRef(null);
  const startedBalanceRef         = useRef(null);

  const startPolling = async (currentBalance) => {
    startedBalanceRef.current = currentBalance;
    setPolling(true);
    setConfirmed(false);
  };

  useEffect(() => {
    if (!polling) return;
    let attempts = 0;
    const maxAttempts = 60; // poll for up to 5 minutes (every 5s)

    intervalRef.current = setInterval(async () => {
      attempts++;
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("balance")
          .eq("id", userId)
          .single();

        if (profile && profile.balance > startedBalanceRef.current) {
          clearInterval(intervalRef.current);
          setPolling(false);
          setConfirmed(true);
          onSuccess(profile.balance);
        }
      } catch { /* keep polling */ }

      if (attempts >= maxAttempts) {
        clearInterval(intervalRef.current);
        setPolling(false);
      }
    }, 5000);

    return () => clearInterval(intervalRef.current);
  }, [polling, userId]);

  const stopPolling = () => {
    clearInterval(intervalRef.current);
    setPolling(false);
    setConfirmed(false);
  };

  return { polling, confirmed, startPolling, stopPolling };
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

// ── Live Activity Ticker ───────────────────────────────────────
const TICKER_EVENTS = [
  { icon:"💸", msg:"David from Kampala just withdrew UGX 32,000" },
  { icon:"✅", msg:"Mercy completed a YouTube task and earned UGX 500" },
  { icon:"👥", msg:"James referred a friend and earned UGX 3,000 commission" },
  { icon:"🌱", msg:"Sandra activated a 3-month Growth plan — 5% return" },
  { icon:"💸", msg:"Robert from Gulu withdrew UGX 18,000 to MTN MoMo" },
  { icon:"🔥", msg:"Patricia hit a 7-day streak and earned a bonus!" },
  { icon:"✅", msg:"Patrick watched a video ad and earned UGX 400" },
  { icon:"💎", msg:"Annet reached Gold VIP tier — bigger task rewards unlocked" },
  { icon:"💸", msg:"Emmanuel withdrew UGX 50,000 to Airtel Money" },
  { icon:"🌱", msg:"Grace invested in the 1-year Legend plan — 10% return" },
];

function LiveActivityTicker({ dark }) {
  const T = theme(dark);
  const [idx, setIdx]       = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setIdx(i => (i + 1) % TICKER_EVENTS.length); setVisible(true); }, 400);
    }, 3200);
    return () => clearInterval(interval);
  }, []);

  const ev = TICKER_EVENTS[idx];
  return (
    <div style={{ background:T.card, borderRadius:14, padding:"14px 18px", marginBottom:24, display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 8px rgba(0,0,0,0.07)", border:`0.5px solid ${T.border}`, transition:"opacity 0.35s", opacity: visible ? 1 : 0 }}>
      <div style={{ width:36, height:36, borderRadius:"50%", background:"#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{ev.icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:12, color:T.textSub, marginBottom:2 }}>🟢 Live activity</div>
        <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{ev.msg}</div>
      </div>
      <div style={{ width:8, height:8, borderRadius:"50%", background:"#1D9E75", flexShrink:0, animation:"pulse 1.5s infinite" }} />
      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(1.4)}}`}</style>
    </div>
  );
}

// ── Landing ────────────────────────────────────────────────────
function LandingPage({ onGetStarted, settings, dark, toggleDark }) {
  const T        = theme(dark);
  const features = [
    { icon: "📋", title: "Complete tasks",    desc: "Follow social pages, fill surveys, install apps — get paid instantly per task." },
    { icon: "👥", title: "Refer & earn",       desc: "Earn 10% + 5% commission across 2 levels when your referrals buy a growth plan." },
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
          🌱 Complete tasks & grow a plan today
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

        {/* ── Testimonials ── */}
        <h2 style={{ fontFamily:"'Sora',sans-serif", fontSize:26, fontWeight:700, textAlign:"center", marginBottom:8, color:T.text }}>What members say</h2>
        <p style={{ textAlign:"center", color:T.textSub, fontSize:14, marginBottom:32 }}>Real people earning real money in Uganda.</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:16, marginBottom:40 }}>
          {[
            { name:"Aisha M.",  loc:"Kampala", text:"I withdrew UGX 45,000 in my first week. Tasks are simple — watch videos, follow pages. 100% legit!", stars:5, initials:"AM" },
            { name:"Brian K.",  loc:"Jinja",   text:"Referred 8 friends and earned UGX 24,000 in commissions. Best side hustle I've found in Uganda.", stars:5, initials:"BK" },
            { name:"Sheila N.", loc:"Mbarara", text:"Payment goes straight to MTN MoMo in minutes. I was sceptical at first but EarnNet is the real deal.", stars:5, initials:"SN" },
          ].map(r => (
            <div key={r.name} style={{ background:T.card, borderRadius:16, padding:"20px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ display:"flex", gap:2, marginBottom:12 }}>
                {Array.from({length:r.stars}).map((_,i) => <span key={i} style={{ color:"#F5A623", fontSize:16 }}>★</span>)}
              </div>
              <div style={{ fontSize:13, color:T.textSub, lineHeight:1.7, marginBottom:16, fontStyle:"italic" }}>"{r.text}"</div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:"50%", background:`linear-gradient(135deg,${BRAND_DARK},${BRAND})`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:12, color:"white", flexShrink:0 }}>{r.initials}</div>
                <div>
                  <div style={{ fontWeight:600, fontSize:13, color:T.text }}>{r.name}</div>
                  <div style={{ fontSize:11, color:T.textSub }}>{r.loc} · Verified member</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Live Activity Ticker ── */}
        <LiveActivityTicker dark={dark} />

        <div style={{ background:`linear-gradient(135deg,${BG_DARK},${BRAND_DARK})`, borderRadius:20, padding:"40px 32px", textAlign:"center", color:"white", marginBottom:60, marginTop:32 }}>
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
          👥 Got a referral code? Add it below and your referrer earns when you buy a plan.
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
  const [investments, setInvestments]     = useState([]);
  const [investPlans, setInvestPlans]     = useState([]);
  const [toast, setToast]                 = useState(null);
  const [taskLoading, setTaskLoading]     = useState(false);
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [depositModal, setDepositModal]   = useState(false);
  const [activateModal, setActivateModal] = useState(false);
  const [investModal, setInvestModal]     = useState(null); // plan object or null
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

  const refreshProfileRef = useRef(refreshProfile);
  useEffect(() => { refreshProfileRef.current = refreshProfile; }, [refreshProfile]);

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

  const loadInvestments = useCallback(async () => {
    try {
      const [invs, plans] = await Promise.all([
        getUserInvestments(uid),
        getInvestmentPlans(),
      ]);
      const matured = await matureUserInvestments(uid);
      if (matured > 0) await refreshProfileRef.current();
      setInvestments(invs);
      setInvestPlans(plans);
    } catch {}
  }, [uid]);

  // Only re-run when uid changes, not on every callback recreation
  useEffect(() => {
    loadTasks(); loadWallet(); loadReferrals(); loadInvestments();
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCompleteTask = async (taskId, proofBase64) => {
    if (!profile?.activated) { setActivateModal(true); return; }
    try {
      await completeTask(uid, taskId, proofBase64);
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
    // Just call the API — the modal manages its own waiting/success screens
    await requestDeposit(uid, parseInt(amount), method, phone);
  };

  const handleActivate = async ({ method, phone }) => {
    // Just call the API — the modal manages its own waiting/success screens
    await activateAccount(uid, method, phone);
  };

  const tabs = [
    { id:"home",     icon:"🏠", label:"Home" },
    { id:"tasks",    icon:"📋", label:"Tasks" },
    { id:"grow",     icon:"🌱", label:"Grow" },
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
        {tab === "home"     && <HomeTab     profile={profile} tasks={tasks} settings={settings} onGoTasks={() => setTab("tasks")} onGoGrow={() => setTab("grow")} onWithdraw={() => setWithdrawModal(true)} onDeposit={() => setDepositModal(true)} onActivate={() => setActivateModal(true)} onSelectTask={setSelectedTask} txns={txns} investments={investments} dark={dark} />}
        {tab === "tasks"    && <TasksTab    tasks={tasks} loading={taskLoading} onComplete={handleCompleteTask} onRefresh={loadTasks} onSelectTask={setSelectedTask} investments={investments} onGoGrow={() => setTab("grow")} dark={dark} />}
        {tab === "grow"     && <GrowTab     profile={profile} investments={investments} plans={investPlans} onBuyPlan={setInvestModal} onRefresh={loadInvestments} dark={dark} />}
        {tab === "wallet"   && <WalletTab   profile={profile} txns={txns} withdrawals={withdrawals} deposits={deposits} settings={settings} onWithdraw={() => setWithdrawModal(true)} onDeposit={() => setDepositModal(true)} dark={dark} />}
        {tab === "referral" && <ReferralTab profile={profile} referrals={referrals} settings={settings} dark={dark} />}
        {tab === "profile"  && <ProfileTab  profile={profile} investments={investments} onSignOut={signOut} onActivate={() => setActivateModal(true)} onDeposit={() => setDepositModal(true)} dark={dark} />}
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
      {depositModal  && <DepositModal  settings={settings} userId={uid} currentBalance={profile?.balance ?? 0} onClose={() => setDepositModal(false)}  onSubmit={handleDeposit} refreshProfile={refreshProfile} dark={dark} />}
      {activateModal && <ActivateModal settings={settings} userId={uid} currentBalance={profile?.balance ?? 0} profile={profile} onClose={() => setActivateModal(false)} onSubmit={handleActivate} refreshProfile={refreshProfile} dark={dark} />}
      {investModal   && <InvestModal   plan={investModal} profile={profile} userId={uid} investments={investments} onClose={() => setInvestModal(null)} onSuccess={async () => { setInvestModal(null); await Promise.all([loadInvestments(), refreshProfile()]); showToast("Investment activated! Watch your profits grow 🌱"); }} dark={dark} />}
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
function ActivateModal({ settings, userId, currentBalance, profile, onClose, onSubmit, refreshProfile, dark }) {
  const [phone, setPhone]     = useState(profile?.phone ?? "");
  const [method, setMethod]   = useState(detectMethod(profile?.phone));
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");
  const [step, setStep]       = useState("form"); // "form" | "waiting" | "success"
  const fee = parseInt(settings.activation_fee ?? 10000);
  const handlePhoneChange = (val) => { setPhone(val); setMethod(detectMethod(val)); };
  const T   = theme(dark);

  const { startPolling, stopPolling } = useDepositPolling(userId, async () => {
    setStep("success");
    await refreshProfile();
  });

  const handleSubmit = async () => {
    setErr("");
    if (!phone) return setErr("Enter your mobile money number");
    setLoading(true);
    try {
      await onSubmit({ method, phone });
      await startPolling(currentBalance);
      setStep("waiting");
    } catch (e) {
      setErr(e.message ?? "Activation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { stopPolling(); onClose(); };

  if (step === "success") {
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }}>
        <div style={{ background:T.card, borderRadius:"24px 24px 0 0", padding:"40px 24px 48px", width:"100%", maxWidth:480, textAlign:"center", animation:"slideUp 0.25s ease" }}>
          <div style={{ fontSize:64, marginBottom:16 }}>⚡</div>
          <div style={{ fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:700, color:T.text, marginBottom:8 }}>Account activated!</div>
          <div style={{ fontSize:14, color:T.textSub, marginBottom:28, lineHeight:1.7 }}>
            You can now complete tasks, earn commissions, and withdraw your earnings.
          </div>
          <button style={{ ...S.primaryBtn, width:"auto", padding:"12px 40px" }} onClick={handleClose}>Start earning →</button>
        </div>
      </div>
    );
  }

  if (step === "waiting") {
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }}>
        <div style={{ background:T.card, borderRadius:"24px 24px 0 0", padding:"40px 24px 48px", width:"100%", maxWidth:480, textAlign:"center", animation:"slideUp 0.25s ease" }}>
          <div style={{ width:72, height:72, borderRadius:"50%", border:`4px solid ${dark ? "#2a5040" : "#eee"}`, borderTopColor:"#854F0B", margin:"0 auto 24px", animation:"spin 1s linear infinite" }} />
          <div style={{ fontFamily:"'Sora',sans-serif", fontSize:20, fontWeight:700, color:T.text, marginBottom:10 }}>Waiting for payment...</div>
          <div style={{ fontSize:14, color:T.textSub, lineHeight:1.7, marginBottom:8 }}>A payment prompt has been sent to</div>
          <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:8 }}>{phone}</div>
          <div style={{ fontSize:13, color:T.textSub, lineHeight:1.7, marginBottom:28 }}>
            Enter your {method.toUpperCase()} PIN to pay <strong style={{ color:T.text }}>{fmt(fee)}</strong> activation fee.
            Your account will be activated automatically once payment is confirmed.
          </div>
          <button onClick={handleClose} style={{ background:"none", border:`0.5px solid ${T.border}`, borderRadius:10, padding:"10px 24px", fontSize:13, color:T.textSub, cursor:"pointer" }}>
            Cancel
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

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
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Mobile money number</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="tel" placeholder="0700 000 000" value={phone} onChange={e => handlePhoneChange(e.target.value)} />
        <div style={{ background: method === "mtn" ? "#FAEEDA" : "#E6F1FB", borderRadius:8, padding:"8px 12px", marginTop:6, fontSize:12, fontWeight:600, color: method === "mtn" ? "#854F0B" : "#185FA5" }}>
          📶 {method === "mtn" ? "MTN Mobile Money detected" : "Airtel Money detected"}
        </div>
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Your mobile money number</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="tel" placeholder="0700 000 000" value={phone} onChange={e => setPhone(e.target.value)} />
        <div style={{ background:"#E1F5EE", borderRadius:10, padding:"10px 14px", fontSize:12, color:BRAND_DARK, margin:"14px 0" }}>
          ✅ Your account activates automatically once payment is confirmed — no waiting!
        </div>
        <button style={{ ...S.primaryBtn, padding:"13px 0" }} onClick={handleSubmit} disabled={loading}>
          {loading ? "Sending prompt..." : `Pay ${fmt(fee)} & activate →`}
        </button>
      </div>
    </div>
  );
}

// ── Deposit Modal ──────────────────────────────────────────────
function DepositModal({ settings, userId, currentBalance, profile, onClose, onSubmit, refreshProfile, dark }) {
  const [amount, setAmount]   = useState("");
  const [phone, setPhone]     = useState(profile?.phone ?? "");
  const [method, setMethod]   = useState(detectMethod(profile?.phone));
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");
  const [step, setStep]       = useState("form"); // "form" | "waiting" | "success"
  const [newBalance, setNewBalance] = useState(null);

  const handlePhoneChange = (val) => { setPhone(val); setMethod(detectMethod(val)); };

  const minDeposit   = parseInt(settings.min_deposit ?? 500);
  const quickAmounts = [5000, 10000, 20000, 50000];
  const amt          = parseInt(amount) || 0;
  const feePct       = parseFloat(settings?.deposit_fee_pct ?? 3);
  const platformFee  = amt ? Math.ceil(amt * feePct / 100) : 0;
  const totalCharge  = amt ? amt + platformFee : 0;
  const T            = theme(dark);

  const { startPolling, stopPolling } = useDepositPolling(userId, async (balance) => {
    setNewBalance(balance);
    setStep("success");
    await refreshProfile();
  });

  const handleSubmit = async () => {
    setErr("");
    if (!amt || amt < minDeposit) return setErr(`Minimum deposit is ${fmt(minDeposit)}`);
    if (!phone) return setErr("Enter your mobile money number");
    setLoading(true);
    try {
      await onSubmit({ amount: amt, method, phone });
      startPolling(currentBalance);
      setStep("waiting");
    } catch (e) {
      setErr(e.message ?? "Deposit failed");
      setLoading(false);
    }
  };

  const handleClose = () => { stopPolling(); onClose(); };

  if (step === "success") {
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }}>
        <div style={{ background:T.card, borderRadius:"24px 24px 0 0", padding:"40px 24px 48px", width:"100%", maxWidth:480, textAlign:"center", animation:"slideUp 0.25s ease" }}>
          <div style={{ fontSize:64, marginBottom:16 }}>🎉</div>
          <div style={{ fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:700, color:T.text, marginBottom:8 }}>
            Deposit confirmed!
          </div>
          <div style={{ fontSize:15, color:BRAND_DARK, fontWeight:600, marginBottom:6 }}>
            {fmt(amt)} added to your wallet
          </div>
          <div style={{ fontSize:13, color:T.textSub, marginBottom:28 }}>
            New balance: {fmt(newBalance)}
          </div>
          <button style={{ ...S.primaryBtn, width:"auto", padding:"12px 40px" }} onClick={handleClose}>
            Done ✓
          </button>
        </div>
      </div>
    );
  }

  if (step === "waiting") {
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }}>
        <div style={{ background:T.card, borderRadius:"24px 24px 0 0", padding:"40px 24px 48px", width:"100%", maxWidth:480, textAlign:"center", animation:"slideUp 0.25s ease" }}>
          <div style={{ width:72, height:72, borderRadius:"50%", border:`4px solid ${dark ? "#2a5040" : "#eee"}`, borderTopColor:BRAND, margin:"0 auto 24px", animation:"spin 1s linear infinite" }} />
          <div style={{ fontFamily:"'Sora',sans-serif", fontSize:20, fontWeight:700, color:T.text, marginBottom:10 }}>
            Waiting for payment...
          </div>
          <div style={{ fontSize:14, color:T.textSub, lineHeight:1.7, marginBottom:8 }}>
            A payment prompt has been sent to
          </div>
          <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:8 }}>{phone}</div>
          <div style={{ fontSize:13, color:T.textSub, lineHeight:1.7, marginBottom:28 }}>
            Enter your {method.toUpperCase()} PIN to approve <strong style={{ color:T.text }}>{fmt(amt)}</strong>.
            This screen will update automatically once payment is received.
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:28 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:BRAND, animation:"pulse 1.5s ease infinite" }} />
            <div style={{ fontSize:12, color:T.textSub }}>Checking for payment every 5 seconds...</div>
          </div>
          <button onClick={handleClose} style={{ background:"none", border:`0.5px solid ${T.border}`, borderRadius:10, padding:"10px 24px", fontSize:13, color:T.textSub, cursor:"pointer" }}>
            Cancel
          </button>
          <style>{`
            @keyframes spin { to { transform: rotate(360deg); } }
            @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
          `}</style>
        </div>
      </div>
    );
  }

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
        {amt > 0 && (
          <div style={{ background:dark ? "#142e20" : "#f8fafc", borderRadius:12, padding:"12px 14px", margin:"14px 0 4px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T.textSub, marginBottom:6 }}>
              <span>Wallet credit</span><span style={{ fontWeight:600, color:BRAND_DARK }}>{fmt(amt)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T.textSub, marginBottom:6 }}>
              <span>Platform fee ({feePct}%)</span><span>+{fmt(platformFee)}</span>
            </div>
            <div style={{ borderTop:`0.5px solid ${T.border}`, paddingTop:8, display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:14, color:T.text }}>
              <span>You will be charged</span><span style={{ color:BRAND }}>{fmt(totalCharge)}</span>
            </div>
          </div>
        )}
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Payment method</label>
        <select style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} value={method} onChange={e => setMethod(e.target.value)}>
          <option value="mtn">MTN Mobile Money</option>
          <option value="airtel">Airtel Money</option>
        </select>
        <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500, marginTop:14 }}>Mobile money number</label>
        <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text }} type="tel" placeholder="0700 000 000" value={phone} onChange={e => handlePhoneChange(e.target.value)} />
        <div style={{ background: method === "mtn" ? "#FAEEDA" : "#E6F1FB", borderRadius:8, padding:"8px 12px", marginTop:6, marginBottom:8, fontSize:12, fontWeight:600, color: method === "mtn" ? "#854F0B" : "#185FA5" }}>
          📶 {method === "mtn" ? "MTN Mobile Money detected" : "Airtel Money detected"}
        </div>
        <div style={{ background:"#E6F1FB", borderRadius:10, padding:"10px 14px", fontSize:12, color:"#185FA5", margin:"8px 0 14px" }}>
          ℹ️ You will receive a payment prompt on your phone. Enter your PIN to complete the deposit instantly.
        </div>
        <button style={{ ...S.primaryBtn, padding:"13px 0" }} onClick={handleSubmit} disabled={loading}>
          {loading ? "Sending prompt..." : `Deposit ${fmt(amt || minDeposit)} →`}
        </button>
      </div>
    </div>
  );
}

// ── Countdown Timer Hook ───────────────────────────────────────
function useCountdown(seconds, onComplete) {
  const [timeLeft, setTimeLeft] = useState(seconds);
  const [running, setRunning]   = useState(false);
  const [finished, setFinished] = useState(false);
  const ref = useRef(null);

  const start = () => { setTimeLeft(seconds); setRunning(true); setFinished(false); };

  useEffect(() => {
    if (!running) return;
    ref.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(ref.current);
          setRunning(false);
          setFinished(true);
          onComplete();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(ref.current);
  }, [running]);

  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  return { timeLeft, running, finished, start, display: fmt(timeLeft) };
}

// ── YouTube Watch Task ─────────────────────────────────────────
function YoutubeWatchTask({ task: t, profile, onBack, onComplete, dark }) {
  const T        = theme(dark);
  const duration = t.duration_seconds ?? 60;

  const [phase, setPhase]               = useState("ready");
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsed, setElapsed]           = useState(0);
  const [vidState, setVidState]         = useState("idle");

  const doneRef     = useRef(false);
  const intervalRef = useRef(null);
  const lastTickRef = useRef(null);
  const iframeRef   = useRef(null);

  const fmtTime = (s) => {
    const safe = Math.max(0, Math.round(s));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  };

  const getYTId = (url) => {
    if (!url) return null;
    const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  };
  const ytId = getYTId(t.link);

  // Send a command to the YT iframe player
  const ytCmd = (func) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func, args: [] }),
        "https://www.youtube.com"
      );
    } catch {}
  };

  // Once iframe loads, send playVideo — retry at 500ms and 1500ms
  // for slow devices. The button tap (handleStart) was the required
  // user gesture so autoplay is unlocked on mobile.
  const handleIframeLoad = () => {
    ytCmd("playVideo");
    setTimeout(() => ytCmd("playVideo"), 500);
    setTimeout(() => ytCmd("playVideo"), 1500);
  };

  // YouTube state events — pause timer when user pauses, resume when they play
  useEffect(() => {
    if (phase !== "watching") return;
    const handler = (e) => {
      if (!e.data) return;
      try {
        const msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (msg.event === "onStateChange") {
          const s = Number(msg.info);
          if (s === 1 || s === 3) { setVidState("playing");  setTimerRunning(true);  }
          else if (s === 2)       { setVidState("paused");   setTimerRunning(false); }
          else if (s === 0)       { setVidState("ended");    setTimerRunning(false); }
        }
      } catch {}
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [phase]);

  // Timer — performance.now() deltas every 250ms
  useEffect(() => {
    clearInterval(intervalRef.current);
    if (!timerRunning) { lastTickRef.current = null; return; }
    lastTickRef.current = performance.now();
    intervalRef.current = setInterval(() => {
      const now   = performance.now();
      const delta = (now - (lastTickRef.current ?? now)) / 1000;
      lastTickRef.current = now;
      setElapsed(prev => {
        const next = prev + delta;
        if (next >= duration && !doneRef.current) {
          doneRef.current = true;
          clearInterval(intervalRef.current);
          ytCmd("stopVideo"); // stop the video when time is up
          onComplete(t.id).then(() => setPhase("done")).catch(() => {});
          return duration;
        }
        return Math.min(next, duration);
      });
    }, 250);
    return () => clearInterval(intervalRef.current);
  }, [timerRunning, duration]);

  // Start task: mount the iframe (autoplay=1). The button tap IS the
  // required mobile user gesture. Timer starts only when YouTube fires
  // onStateChange=1 (actually playing) — keeps them perfectly in sync.
  const handleStart = () => {
    if (!profile?.activated) return;
    setPhase("watching");
    // timer starts via onStateChange handler, NOT here
  };

  if (phase === "done") return <TaskSuccessScreen reward={t.reward} onBack={onBack} dark={dark} />;

  const timeLeft  = Math.max(0, duration - elapsed);
  const pct       = Math.min(100, (elapsed / duration) * 100);
  const isPaused  = !timerRunning && phase === "watching";
  const durationLabel = duration < 60
    ? `${duration} seconds`
    : `${Math.ceil(duration / 60)} minute${duration >= 120 ? "s" : ""}`;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'DM Sans',sans-serif", paddingBottom:100 }}>
      <TaskHeader task={t} onBack={onBack} />
      <div style={{ padding:"0 16px", marginTop:-12 }}>
        <TaskStatBar task={t} dark={dark} />

        {/* Video */}
        {ytId ? (
          <div style={{ borderRadius:16, overflow:"hidden", marginBottom:14, background:"#000" }}>
            {phase === "watching" ? (
              <iframe
                ref={iframeRef}
                width="100%"
                src={`https://www.youtube.com/embed/${ytId}?autoplay=1&controls=1&enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(window.location.origin)}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                onLoad={handleIframeLoad}
                style={{ border:"none", display:"block", width:"100%", height:215 }}
              />
            ) : (
              <div style={{ height:215, background:`url(https://img.youtube.com/vi/${ytId}/hqdefault.jpg) center/cover no-repeat`, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:16 }}>
                <div style={{ width:66, height:66, borderRadius:"50%", background:"rgba(255,0,0,0.88)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 18px rgba(0,0,0,0.35)" }}>
                  <span style={{ fontSize:28, color:"white", marginLeft:6 }}>▶</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ background:"#FAECE7", borderRadius:14, padding:20, marginBottom:14, textAlign:"center", color:"#993C1D", fontSize:13, fontWeight:600 }}>
            ⚠️ No video link saved for this task. Contact support.
          </div>
        )}

        {/* Timer */}
        {phase === "watching" && (
          <div style={{ background:T.card, borderRadius:16, padding:"20px", marginBottom:14, textAlign:"center", boxShadow:"0 4px 16px rgba(0,0,0,0.08)" }}>
            <div style={{ fontSize:11, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.08em",
              color: isPaused ? "#E24B4A" : T.textSub }}>
              {isPaused ? "⏸ PAUSED — RESUME VIDEO TO CONTINUE" : timerRunning ? "▶ WATCHING — TIME REMAINING" : "⏳ STARTING VIDEO…"}
            </div>
            <div style={{ fontFamily:"'Sora',sans-serif", fontSize:56, fontWeight:700, letterSpacing:3,
              color: isPaused ? "#E24B4A" : timeLeft < 10 ? "#E24B4A" : BRAND_DARK }}>
              {fmtTime(timeLeft)}
            </div>
            <div style={{ height:10, background: dark ? "#2a5040" : "#eee", borderRadius:5, marginTop:16 }}>
              <div style={{ height:"100%", width:`${pct}%`, background: isPaused ? "#E24B4A" : BRAND, borderRadius:5, transition:"width 0.25s linear" }} />
            </div>
            <div style={{ fontSize:12, marginTop:10, fontWeight: isPaused ? 700 : 400,
              color: isPaused ? "#E24B4A" : T.textSub }}>
              {isPaused
                ? "⚠️ Timer paused — resume the video to continue earning"
                : "Timer runs while video plays ✓"}
            </div>
          </div>
        )}

        {/* Steps */}
        {phase === "ready" && (
          <div style={{ background:T.card, borderRadius:14, padding:"16px", marginBottom:14 }}>
            <div style={{ fontWeight:600, fontSize:14, marginBottom:12, color:T.text }}>How to earn {fmt(t.reward)}</div>
            {[
              ["Tap Start Task — video loads and plays automatically", BRAND_DARK, "#E1F5EE"],
              [`Watch ${durationLabel} without pausing`, BRAND_DARK, "#E1F5EE"],
              ["Pausing the video pauses the timer — no skipping!", "#993C1D", "#FAECE7"],
              ["Reward credits automatically when timer hits 0:00", BRAND_DARK, "#E1F5EE"],
            ].map(([s, tc, bg], i) => (
              <div key={i} style={{ display:"flex", gap:12, marginBottom:10, alignItems:"flex-start" }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background:bg, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:12, color:tc, flexShrink:0 }}>{i+1}</div>
                <div style={{ fontSize:13, color: tc === "#993C1D" ? "#993C1D" : T.textSub, lineHeight:1.6, paddingTop:4, fontWeight: tc === "#993C1D" ? 600 : 400 }}>{s}</div>
              </div>
            ))}
          </div>
        )}

        {!profile?.activated && <ActivationBanner />}
      </div>

      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, padding:"16px", background:T.card, borderTop:`0.5px solid ${T.border}` }}>
        {phase === "ready" && (
          <button style={{ ...S.primaryBtn, padding:"15px 0", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}
            onClick={handleStart} disabled={!profile?.activated}>
            {profile?.activated ? <>▶ Start Task &amp; Load Video</> : "⚡ Activate account to earn"}
          </button>
        )}
        {phase === "watching" && (
          <div style={{ textAlign:"center", padding:"8px 0" }}>
            <div style={{ fontSize:13, fontWeight: isPaused ? 700 : 400, color: isPaused ? "#E24B4A" : T.textSub }}>
              {isPaused ? "⏸ Resume the video to continue earning" : "▶ Keep watching — do not pause or skip"}
            </div>
          </div>
        )}
      </div>
      <TaskPageStyles />
    </div>
  );
}

// ── YouTube Subscribe Task ─────────────────────────────────────
function YoutubeSubscribeTask({ task: t, profile, onBack, onComplete, dark }) {
  const T        = theme(dark);
  const duration = t.duration_seconds ?? 30;
  const [phase, setPhase] = useState("ready"); // ready | timing | done

  const timer = useCountdown(duration, async () => {
    await onComplete(t.id);
    setPhase("done");
  });

  const handleStart = () => {
    if (!profile?.activated) return;
    if (t.link) window.open(t.link, "_blank");
    setPhase("timing");
    timer.start();
  };

  if (phase === "done") return <TaskSuccessScreen reward={t.reward} onBack={onBack} dark={dark} />;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'DM Sans',sans-serif", paddingBottom:100 }}>
      <TaskHeader task={t} onBack={onBack} />
      <div style={{ padding:"0 16px", marginTop:-12 }}>
        <TaskStatBar task={t} dark={dark} />

        {phase === "ready" && (
          <div style={{ background:T.card, borderRadius:14, padding:"16px", marginBottom:14 }}>
            <div style={{ fontWeight:600, fontSize:14, marginBottom:12, color:T.text }}>How to earn {fmt(t.reward)}</div>
            {[
              "Tap Start Task — YouTube opens",
              "Subscribe to the channel",
              "Come back here and wait for the timer to finish"
            ].map((s,i) => (
              <div key={i} style={{ display:"flex", gap:12, marginBottom:10, alignItems:"flex-start" }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background:"#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:12, color:BRAND_DARK, flexShrink:0 }}>{i+1}</div>
                <div style={{ fontSize:13, color:T.textSub, lineHeight:1.6, paddingTop:4 }}>{s}</div>
              </div>
            ))}
          </div>
        )}

        {phase === "timing" && (
          <div style={{ background:T.card, borderRadius:16, padding:"32px 20px", marginBottom:14, textAlign:"center", boxShadow:"0 4px 16px rgba(0,0,0,0.08)" }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📺</div>
            <div style={{ fontSize:11, color:T.textSub, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.08em" }}>Verifying your subscription</div>
            <div style={{ fontFamily:"'Sora',sans-serif", fontSize:52, fontWeight:700, color: timer.timeLeft < 10 ? "#E24B4A" : BRAND_DARK }}>
              {timer.display}
            </div>
            <div style={{ height:8, background: dark ? "#2a5040" : "#eee", borderRadius:4, marginTop:16 }}>
              <div style={{ height:"100%", width:`${((duration - timer.timeLeft) / duration) * 100}%`, background:BRAND, borderRadius:4, transition:"width 1s linear" }} />
            </div>
            <div style={{ fontSize:12, color:T.textSub, marginTop:12 }}>Stay on this page — reward credits when timer hits 0:00</div>
          </div>
        )}

        {!profile?.activated && <ActivationBanner />}
      </div>

      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, padding:"16px", background:T.card, borderTop:`0.5px solid ${T.border}` }}>
        {phase === "ready" && (
          <button style={{ ...S.primaryBtn, padding:"15px 0", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}
            onClick={handleStart} disabled={!profile?.activated}>
            {profile?.activated ? <>📺 Start Task &amp; Open YouTube</> : "⚡ Activate to earn"}
          </button>
        )}
        {phase === "timing" && (
          <div style={{ textAlign:"center", padding:"10px 0" }}>
            <div style={{ fontSize:13, color:T.textSub }}>⏱ Timer running — stay on this page</div>
          </div>
        )}
      </div>
      <TaskPageStyles />
    </div>
  );
}

// ── TikTok Task (Follow / Like / Watch / Comment) ──────────────
function TiktokTask({ task: t, profile, onBack, onComplete, dark }) {
  const T        = theme(dark);
  const duration = t.duration_seconds ?? 45;
  const [phase, setPhase]   = useState("ready"); // ready | timing | upload | done
  const [doing, setDoing]   = useState(false);
  const [proof, setProof]   = useState(null);   // base64 screenshot
  const [proofName, setProofName] = useState("");
  const [err, setErr]       = useState("");

  const timer = useCountdown(duration, () => setPhase("upload"));

  const handleStart = () => {
    if (!profile?.activated) return;
    if (t.link) window.open(t.link, "_blank");
    setPhase("timing");
    timer.start();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setProofName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setProof(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!proof) return setErr("Please upload a screenshot as proof");
    setErr("");
    setDoing(true);
    try {
      await onComplete(t.id, proof);
      setPhase("done");
    } catch(e) { setErr(e.message ?? "Submission failed"); }
    setDoing(false);
  };

  const actionLabel = { follow:"Follow", like:"Like", watch:"Watch", comment:"Comment" }[t.subtype] ?? t.subtype ?? "Complete";

  if (phase === "done") return <TaskSuccessScreen reward={t.reward} onBack={onBack} dark={dark} />;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'DM Sans',sans-serif", paddingBottom:100 }}>
      <TaskHeader task={t} onBack={onBack} />
      <div style={{ padding:"0 16px", marginTop:-12 }}>
        <TaskStatBar task={t} dark={dark} />

        {/* TikTok brand banner */}
        <div style={{ background:"linear-gradient(135deg,#010101,#69C9D0)", borderRadius:14, padding:"14px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:32 }}>🎵</span>
          <div>
            <div style={{ fontWeight:700, color:"white", fontSize:14 }}>TikTok Task — {actionLabel}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.75)", marginTop:2 }}>This task opens TikTok in your browser</div>
          </div>
        </div>

        {phase === "timing" && (
          <div style={{ background:T.card, borderRadius:16, padding:"24px 20px", marginBottom:14, textAlign:"center", boxShadow:"0 4px 16px rgba(0,0,0,0.08)" }}>
            <div style={{ fontSize:11, color:T.textSub, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.08em" }}>Verifying action</div>
            <div style={{ fontFamily:"'Sora',sans-serif", fontSize:48, fontWeight:700, color: timer.timeLeft < 10 ? "#E24B4A" : BRAND_DARK }}>
              {timer.display}
            </div>
            <div style={{ fontSize:12, color:T.textSub, marginTop:8 }}>Complete the {actionLabel.toLowerCase()} on TikTok then come back</div>
            <div style={{ height:6, background: dark ? "#2a5040" : "#eee", borderRadius:3, marginTop:14 }}>
              <div style={{ height:"100%", width:`${((duration - timer.timeLeft) / duration) * 100}%`, background:"#69C9D0", borderRadius:3, transition:"width 1s linear" }} />
            </div>
          </div>
        )}

        {phase === "upload" && (
          <div style={{ background:T.card, borderRadius:16, padding:"20px", marginBottom:14 }}>
            <div style={{ fontWeight:600, fontSize:15, marginBottom:6, color:T.text }}>📸 Upload proof screenshot</div>
            <div style={{ fontSize:13, color:T.textSub, marginBottom:16, lineHeight:1.6 }}>
              Take a screenshot showing you {actionLabel.toLowerCase()}ed on TikTok and upload it below.
            </div>
            {err && <div style={{ background:"#FAECE7", color:"#993C1D", borderRadius:8, padding:"10px 12px", fontSize:12, marginBottom:12 }}>{err}</div>}
            <label style={{ display:"block", border:`2px dashed ${proof ? BRAND : T.border}`, borderRadius:12, padding:"24px", textAlign:"center", cursor:"pointer", background: proof ? "#E1F5EE" : T.bg }}>
              <input type="file" accept="image/*" style={{ display:"none" }} onChange={handleFileChange} />
              {proof ? (
                <div>
                  <div style={{ fontSize:32, marginBottom:8 }}>✅</div>
                  <div style={{ fontSize:13, color:BRAND_DARK, fontWeight:600 }}>{proofName}</div>
                  <div style={{ fontSize:11, color:T.textSub, marginTop:4 }}>Tap to change</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize:32, marginBottom:8 }}>📷</div>
                  <div style={{ fontSize:13, color:T.textSub }}>Tap to upload screenshot</div>
                </div>
              )}
            </label>
          </div>
        )}

        {phase === "ready" && (
          <div style={{ background:T.card, borderRadius:14, padding:"16px", marginBottom:14 }}>
            <div style={{ fontWeight:600, fontSize:14, marginBottom:12, color:T.text }}>How to earn {fmt(t.reward)}</div>
            {[
              `Tap Start Task — TikTok opens in your browser`,
              `${actionLabel} the account/video as instructed`,
              `Come back here and wait for the timer`,
              `Upload a screenshot as proof — reward credits instantly`,
            ].map((s,i) => (
              <div key={i} style={{ display:"flex", gap:12, marginBottom:10, alignItems:"flex-start" }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background:"#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:12, color:BRAND_DARK, flexShrink:0 }}>{i+1}</div>
                <div style={{ fontSize:13, color:T.textSub, lineHeight:1.6, paddingTop:4 }}>{s}</div>
              </div>
            ))}
          </div>
        )}

        {!profile?.activated && <ActivationBanner />}
      </div>

      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, padding:"16px", background:T.card, borderTop:`0.5px solid ${T.border}` }}>
        {phase === "ready" && (
          <button style={{ ...S.primaryBtn, padding:"15px 0", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}
            onClick={handleStart} disabled={!profile?.activated}>
            {profile?.activated ? <>🎵 Start Task &amp; Open TikTok</> : "⚡ Activate to earn"}
          </button>
        )}
        {phase === "timing" && (
          <div style={{ textAlign:"center", padding:"10px 0" }}>
            <div style={{ fontSize:13, color:T.textSub }}>⏱ Timer running — come back after doing the task on TikTok</div>
          </div>
        )}
        {phase === "upload" && (
          <button style={{ ...S.primaryBtn, padding:"14px 0", fontSize:15 }} onClick={handleSubmit} disabled={doing}>
            {doing ? "Submitting..." : "Submit proof & claim reward →"}
          </button>
        )}
      </div>
      <TaskPageStyles />
    </div>
  );
}

// ── Generic Task (social / survey / install / review) ──────────
function GenericTask({ task: t, profile, onBack, onComplete, dark }) {
  const T = theme(dark);
  const [doing, setDoing] = useState(false);
  const [done, setDone]   = useState(false);
  const steps = {
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

  if (done) return <TaskSuccessScreen reward={t.reward} onBack={onBack} dark={dark} />;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'DM Sans',sans-serif", paddingBottom:100 }}>
      <TaskHeader task={t} onBack={onBack} />
      <div style={{ padding:"0 16px", marginTop:-12 }}>
        <TaskStatBar task={t} dark={dark} />
        {t.description && (
          <div style={{ background:T.card, borderRadius:14, padding:"16px", marginBottom:14 }}>
            <div style={{ fontWeight:600, fontSize:14, marginBottom:8, color:T.text }}>About this task</div>
            <p style={{ fontSize:13, color:T.textSub, lineHeight:1.7 }}>{t.description}</p>
          </div>
        )}
        <div style={{ background:T.card, borderRadius:14, padding:"16px", marginBottom:14 }}>
          <div style={{ fontWeight:600, fontSize:14, marginBottom:14, color:T.text }}>How to complete</div>
          {taskSteps.map((step, i) => (
            <div key={i} style={{ display:"flex", gap:12, marginBottom: i < taskSteps.length-1 ? 14 : 0, alignItems:"flex-start" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:"#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, color:BRAND_DARK, flexShrink:0 }}>{i+1}</div>
              <div style={{ fontSize:13, color:T.textSub, lineHeight:1.6, paddingTop:4 }}>{step}</div>
            </div>
          ))}
        </div>
        {t.link && (
          <a href={t.link} target="_blank" rel="noreferrer"
            style={{ display:"block", background:"#E1F5EE", color:BRAND_DARK, borderRadius:12, padding:"13px 16px", fontSize:14, fontWeight:600, textDecoration:"none", textAlign:"center", marginBottom:14 }}>
            🔗 Open task link →
          </a>
        )}
        {!profile?.activated && <ActivationBanner />}
      </div>
      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, padding:"16px", background:T.card, borderTop:`0.5px solid ${T.border}` }}>
        {t.link && !done && (
          <a href={t.link} target="_blank" rel="noreferrer"
            style={{ display:"block", background:"#E1F5EE", color:BRAND_DARK, borderRadius:12, padding:"12px 16px", fontSize:14, fontWeight:600, textDecoration:"none", textAlign:"center", marginBottom:10 }}>
            🔗 Open task link →
          </a>
        )}
        <button style={{ ...S.primaryBtn, padding:"15px 0", fontSize:16 }} onClick={handleDone} disabled={doing || !profile?.activated}>
          {doing ? "Submitting..." : profile?.activated ? "✓ Mark as Done & Claim Reward" : "⚡ Activate to earn"}
        </button>
      </div>
      <TaskPageStyles />
    </div>
  );
}

// ── Like Task (Products & Songs) ───────────────────────────────
// 30s hidden review timer → reactions unlock → instant credit
const REACTIONS = [
  { emoji:"❤️",  label:"Love it",    value:"love"    },
  { emoji:"👍",  label:"Like it",    value:"like"    },
  { emoji:"😐",  label:"It's okay",  value:"neutral" },
  { emoji:"👎",  label:"Not for me", value:"dislike" },
];

function LikeTask({ task: t, profile, onBack, onComplete, dark }) {
  const T            = theme(dark);
  const isSong       = t.type === "like_song";
  const REVIEW_SECS  = 30;

  const [phase,     setPhase]     = useState("viewing");   // viewing | reacting | done
  const [elapsed,   setElapsed]   = useState(0);
  const [reaction,  setReaction]  = useState(null);
  const [submitting,setSubmitting]= useState(false);
  const [showFx,    setShowFx]    = useState(false);       // reward animation
  const intervalRef = useRef(null);
  const startRef    = useRef(null);

  // Hidden 30-second timer starts immediately on mount
  useEffect(() => {
    startRef.current = performance.now();
    intervalRef.current = setInterval(() => {
      const el = (performance.now() - startRef.current) / 1000;
      setElapsed(el);
      if (el >= REVIEW_SECS) {
        clearInterval(intervalRef.current);
        setPhase("reacting");
      }
    }, 200);
    return () => clearInterval(intervalRef.current);
  }, []);

  const handleReact = async (r) => {
    if (submitting) return;
    setReaction(r);
    setSubmitting(true);
    setShowFx(true);
    try {
      await onComplete(t.id, null); // no proof needed
    } catch {}
    setSubmitting(false);
    setTimeout(() => setPhase("done"), 900);
  };

  if (phase === "done") return <LikeTaskSuccess task={t} reaction={reaction} onBack={onBack} dark={dark} />;

  const progress     = Math.min(100, (elapsed / REVIEW_SECS) * 100);
  const secsLeft     = Math.max(0, Math.ceil(REVIEW_SECS - elapsed));
  const unlocked     = phase === "reacting";

  // Parse extra metadata from task description JSON or fallback to task fields
  let meta = {};
  try { meta = JSON.parse(t.description ?? "{}"); } catch { meta = {}; }
  const coverUrl    = meta.cover_url   ?? t.image_url ?? null;
  const artistBrand = meta.artist      ?? meta.brand   ?? t.business ?? "";
  const genre       = meta.genre       ?? meta.category ?? "";
  const price       = meta.price       ?? null;
  const tagline     = meta.tagline     ?? meta.album    ?? "";

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'DM Sans',sans-serif", paddingBottom:120 }}>

      {/* Header */}
      <div style={{ background: isSong
        ? "linear-gradient(135deg,#1a0533,#7C3AED)"
        : "linear-gradient(135deg,#1a0a2e,#C2185B)",
        color:"white", padding:"20px 16px 32px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", right:-40, top:-40, width:160, height:160, borderRadius:"50%", background:"rgba(255,255,255,0.05)" }} />
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"white", borderRadius:10, padding:"7px 14px", fontSize:13, cursor:"pointer", marginBottom:20, position:"relative" }}>← Back</button>
        <div style={{ display:"flex", gap:6, marginBottom:12, position:"relative" }}>
          <span style={{ background:"rgba(255,255,255,0.2)", fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20 }}>
            {isSong ? "🎵 RATE SONG" : "🛍 RATE PRODUCT"}
          </span>
          <span style={{ background:"rgba(255,255,255,0.2)", fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20 }}>
            +{fmt(t.reward)}
          </span>
        </div>
        <div style={{ fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:700, lineHeight:1.2, position:"relative" }}>{t.title}</div>
        <div style={{ fontSize:13, opacity:0.8, marginTop:4, position:"relative" }}>{artistBrand}</div>
      </div>

      <div style={{ padding:"0 16px", marginTop:-16 }}>

        {/* Cover / Product image card */}
        <div style={{ background:T.card, borderRadius:20, overflow:"hidden", marginBottom:14, boxShadow:"0 8px 28px rgba(0,0,0,0.12)" }}>
          {coverUrl ? (
            <div style={{ position:"relative" }}>
              <img
                src={coverUrl}
                alt={t.title}
                style={{ width:"100%", height: isSong ? 280 : 240, objectFit:"cover", display:"block" }}
                onError={e => { e.target.style.display = "none"; }}
              />
              {isSong && (
                <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)", display:"flex", alignItems:"flex-end", padding:"18px 18px" }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:18, color:"white" }}>{t.title}</div>
                    {tagline && <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", marginTop:2 }}>{tagline}</div>}
                    {genre && <div style={{ fontSize:11, color:"rgba(255,255,255,0.6)", marginTop:2 }}>{genre}</div>}
                  </div>
                  {/* Vinyl disc animation */}
                  <div style={{ marginLeft:"auto", width:52, height:52, borderRadius:"50%", background:"linear-gradient(135deg,#222,#444)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 0 3px rgba(255,255,255,0.15)", animation: unlocked ? "none" : "spin 4s linear infinite", flexShrink:0 }}>
                    <div style={{ width:12, height:12, borderRadius:"50%", background:"#fff" }} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ height: isSong ? 200 : 160, background: isSong
              ? "linear-gradient(135deg,#1a0533,#7C3AED)"
              : "linear-gradient(135deg,#1a0a2e,#C2185B)",
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:72 }}>
              {isSong ? "🎵" : "🛍"}
            </div>
          )}

          {/* Product details (non-song only) */}
          {!isSong && (
            <div style={{ padding:"16px 18px" }}>
              {tagline && <div style={{ fontSize:13, color:T.textSub, lineHeight:1.6, marginBottom:8 }}>{tagline}</div>}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                <div>
                  {artistBrand && <div style={{ fontSize:12, color:T.textSub }}>By <strong style={{ color:T.text }}>{artistBrand}</strong></div>}
                  {genre && <div style={{ fontSize:11, color:T.textSub, marginTop:2 }}>{genre}</div>}
                </div>
                {price && (
                  <div style={{ background:"#E1F5EE", borderRadius:10, padding:"6px 14px", fontWeight:700, fontSize:15, color:BRAND_DARK }}>{price}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Progress indicator — subtle, not a countdown */}
        {!unlocked && (
          <div style={{ background:T.card, borderRadius:14, padding:"14px 18px", marginBottom:14, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div style={{ fontSize:13, color:T.textSub }}>
                {isSong ? "🎵 Listening…" : "🛍 Reviewing product…"}
              </div>
              <div style={{ fontSize:11, color:T.textSub }}>{secsLeft}s</div>
            </div>
            <div style={{ height:6, background: dark ? "#1a3d2b" : "#eee", borderRadius:3 }}>
              <div style={{ height:"100%", width:`${progress}%`, background: isSong
                ? "linear-gradient(90deg,#7C3AED,#C084FC)"
                : "linear-gradient(90deg,#C2185B,#F06292)",
                borderRadius:3, transition:"width 0.2s linear" }} />
            </div>
            <div style={{ fontSize:11, color:T.textSub, marginTop:8, textAlign:"center" }}>
              Take a moment to explore · Your rating unlocks soon
            </div>
          </div>
        )}

        {/* Reaction panel — slides in when unlocked */}
        {unlocked && (
          <div style={{ background:T.card, borderRadius:20, padding:"20px 18px", marginBottom:14, boxShadow:"0 4px 20px rgba(0,0,0,0.12)", animation:"slideUp 0.4s ease" }}>
            <div style={{ textAlign:"center", marginBottom:16 }}>
              <div style={{ fontSize:20, marginBottom:6 }}>✨ What do you think?</div>
              <div style={{ fontSize:13, color:T.textSub }}>
                {isSong ? "Give the song your honest reaction" : "Give this product your honest rating"}
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {REACTIONS.map(r => (
                <button
                  key={r.value}
                  onClick={() => handleReact(r)}
                  disabled={submitting}
                  style={{
                    background: reaction?.value === r.value
                      ? (isSong ? "#F3E8FF" : "#FCE4EC")
                      : (dark ? "#142e20" : "#f8fafc"),
                    border: `1.5px solid ${reaction?.value === r.value ? (isSong ? "#7C3AED" : "#C2185B") : T.border}`,
                    borderRadius:16, padding:"16px 10px", cursor:"pointer",
                    display:"flex", flexDirection:"column", alignItems:"center", gap:6,
                    transition:"all 0.15s", transform: reaction?.value === r.value ? "scale(1.04)" : "scale(1)",
                  }}
                >
                  <span style={{ fontSize:30 }}>{r.emoji}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:T.text }}>{r.label}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize:11, color:T.textSub, textAlign:"center", marginTop:12 }}>
              Tap any reaction to claim your {fmt(t.reward)}
            </div>
          </div>
        )}

        {/* Reward FX overlay */}
        {showFx && (
          <div style={{ position:"fixed", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none", zIndex:300 }}>
            <div style={{ background:"rgba(0,0,0,0.7)", borderRadius:24, padding:"28px 40px", textAlign:"center", animation:"popIn 0.35s ease" }}>
              <div style={{ fontSize:52, marginBottom:8 }}>{reaction?.emoji}</div>
              <div style={{ fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:700, color:"white" }}>+{fmt(t.reward)}</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.7)", marginTop:4 }}>Credited to your wallet!</div>
            </div>
          </div>
        )}

        {!profile?.activated && <ActivationBanner />}
      </div>

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes popIn   { from { opacity:0; transform:scale(0.7); } to { opacity:1; transform:scale(1); } }
      `}</style>
    </div>
  );
}

function LikeTaskSuccess({ task: t, reaction, onBack, dark }) {
  const T      = theme(dark);
  const isSong = t.type === "like_song";
  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:T.bg, padding:28, textAlign:"center" }}>
      <div style={{ fontSize:80, marginBottom:8 }}>{reaction?.emoji ?? "🎉"}</div>
      <div style={{ fontFamily:"'Sora',sans-serif", fontSize:26, fontWeight:700, color:T.text, marginBottom:8 }}>
        Thanks for your rating!
      </div>
      <div style={{ fontSize:16, fontWeight:700, color:BRAND_DARK, marginBottom:6 }}>
        +{fmt(t.reward)} added to your balance
      </div>
      <div style={{ fontSize:13, color:T.textSub, marginBottom:8, maxWidth:280, lineHeight:1.7 }}>
        Your "{reaction?.label}" reaction on <strong style={{ color:T.text }}>{t.title}</strong> helps {isSong ? "the artist" : "the brand"} understand their audience.
      </div>
      <div style={{ background: isSong ? "#F3E8FF" : "#FCE4EC", borderRadius:14, padding:"12px 20px", marginBottom:28, fontSize:13, color: isSong ? "#7C3AED" : "#C2185B", fontWeight:600 }}>
        {isSong ? "🎵 Keep rating songs to earn more!" : "🛍 More products waiting for your review!"}
      </div>
      <button style={{ ...S.primaryBtn, width:"auto", padding:"12px 36px" }} onClick={onBack}>
        Back to tasks
      </button>
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────
function TaskSuccessScreen({ reward, onBack, dark }) {
  const T = theme(dark);
  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:T.bg, padding:24 }}>
      <div style={{ fontSize:72, marginBottom:16 }}>🎉</div>
      <div style={{ fontFamily:"'Sora',sans-serif", fontSize:24, fontWeight:700, marginBottom:8, color:T.text }}>Task complete!</div>
      <div style={{ fontSize:16, color:BRAND_DARK, fontWeight:600, marginBottom:8 }}>+{fmt(reward)} added to your balance</div>
      <div style={{ fontSize:12, color:T.textSub, marginBottom:28, textAlign:"center" }}>Reward credited instantly. Admin reviews all completions.</div>
      <button style={{ ...S.primaryBtn, width:"auto", padding:"12px 32px" }} onClick={onBack}>Back to tasks</button>
    </div>
  );
}

function TaskHeader({ task: t, onBack }) {
  return (
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
  );
}

function TaskStatBar({ task: t, dark }) {
  const T = theme(dark);
  const pct       = t.budget > 0 ? Math.min(100, Math.round((t.used / t.budget) * 100)) : 0;
  const spotsLeft = (t.limit_count ?? 0) - (t.completions ?? 0);
  return (
    <div style={{ background:T.card, borderRadius:16, padding:"18px 20px", boxShadow:"0 4px 16px rgba(0,0,0,0.08)", marginBottom:14 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, textAlign:"center", marginBottom:12 }}>
        {[["REWARD",fmt(t.reward),BRAND_DARK,"'Sora',sans-serif",20],["TIME",t.time_est??"~5 min",T.text,"inherit",15],["SPOTS LEFT",spotsLeft,spotsLeft<20?"#E24B4A":T.text,"inherit",15]].map(([lbl,val,tc,ff,fs]) => (
          <div key={lbl}>
            <div style={{ fontSize:10, color:T.textSub, marginBottom:4 }}>{lbl}</div>
            <div style={{ fontFamily:ff, fontWeight:700, fontSize:fs, color:tc }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.textSub, marginBottom:6 }}>
        <span>Task progress</span><span>{t.completions??0} / {t.limit_count??"∞"}</span>
      </div>
      <div style={{ height:6, background: dark ? "#2a5040" : "#eee", borderRadius:3 }}>
        <div style={{ height:"100%", width:`${pct}%`, background:pct>80?"#E24B4A":BRAND, borderRadius:3, transition:"width 0.5s ease" }} />
      </div>
    </div>
  );
}

function ActivationBanner() {
  return (
    <div style={{ background:"#FAEEDA", borderRadius:14, padding:"14px 16px", marginBottom:14 }}>
      <div style={{ fontWeight:600, fontSize:14, color:"#854F0B", marginBottom:4 }}>⚡ Account not activated</div>
      <div style={{ fontSize:13, color:"#854F0B" }}>Activate your account to complete tasks and earn.</div>
    </div>
  );
}

function TaskPageStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Sans:wght@400;500;600&display=swap');
      * { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:'DM Sans',sans-serif; }
      button:active { transform:scale(0.97); }
    `}</style>
  );
}

// ── Task Detail Router ─────────────────────────────────────────
function TaskDetailPage({ task: t, profile, onBack, onComplete, dark }) {
  if (t.type === "youtube_watch")     return <YoutubeWatchTask     task={t} profile={profile} onBack={onBack} onComplete={onComplete} dark={dark} />;
  if (t.type === "youtube_subscribe") return <YoutubeSubscribeTask task={t} profile={profile} onBack={onBack} onComplete={onComplete} dark={dark} />;
  if (t.type === "tiktok")            return <TiktokTask           task={t} profile={profile} onBack={onBack} onComplete={onComplete} dark={dark} />;
  if (t.type === "like_product")      return <LikeTask             task={t} profile={profile} onBack={onBack} onComplete={onComplete} dark={dark} />;
  if (t.type === "like_song")         return <LikeTask             task={t} profile={profile} onBack={onBack} onComplete={onComplete} dark={dark} />;
  return <GenericTask task={t} profile={profile} onBack={onBack} onComplete={onComplete} dark={dark} />;
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
function HomeTab({ profile, tasks, settings, onGoTasks, onWithdraw, onDeposit, onActivate, onSelectTask, txns, onGoGrow, investments, dark }) {
  const streakDays  = profile?.streak_days ?? 0;
  const streakBonus = settings.streak_bonus ?? 5000;
  const T = theme(dark);
  const tierInfo = getActiveTier(investments);

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

      {/* Grow teaser */}
      <div style={{ background:`linear-gradient(135deg,${BG_DARK},#1a4030)`, borderRadius:16, margin:"0 16px 12px", padding:"16px 18px", cursor:"pointer", boxShadow:"0 4px 16px rgba(15,46,34,0.3)" }} onClick={onGoGrow}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:"white" }}>🌱 EarnNet Grow</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.7)", marginTop:3 }}>
              {tierInfo ? `${tierInfo.label} member` : "Invest & earn up to 10% return"}
            </div>
          </div>
          <div style={{ background:BRAND, color:"white", borderRadius:10, padding:"7px 14px", fontSize:12, fontWeight:600 }}>Invest →</div>
        </div>
      </div>

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
function TasksTab({ tasks, loading, onComplete, onRefresh, onSelectTask, investments, onGoGrow, dark }) {
  const [filter, setFilter] = useState("all");
  const T = theme(dark);

  // Gate: user must have an active investment plan
  const tierInfo      = getActiveTier(investments);
  const hasActivePlan = !!tierInfo;

  if (!hasActivePlan) {
    return (
      <div style={{ animation:"slideUp 0.3s ease", padding:"40px 24px", textAlign:"center" }}>
        <div style={{ fontSize:64, marginBottom:16 }}>🔒</div>
        <div style={{ fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:700, color:T.text, marginBottom:10 }}>
          Tasks are locked
        </div>
        <div style={{ fontSize:14, color:T.textSub, lineHeight:1.7, marginBottom:24, maxWidth:280, margin:"0 auto 24px" }}>
          Buy an investment plan to unlock daily tasks and start earning. Higher plans = more tasks per day and bigger rewards.
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:24, textAlign:"left" }}>
          {[["🥈 Silver plans","More tasks/day · reward boost"],["🥇 Gold plans","Even more tasks · bigger boost"],["💎 Platinum plans","High daily limit · strong boost"],["👑 Legend plans","Unlimited tasks · top boost"]].map(([name,desc]) => (
            <div key={name} style={{ background:T.card, borderRadius:12, padding:"12px 14px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight:700, fontSize:13, color:T.text, marginBottom:4 }}>{name}</div>
              <div style={{ fontSize:11, color:T.textSub }}>{desc}</div>
            </div>
          ))}
        </div>
        <button style={{ ...S.primaryBtn, width:"auto", padding:"13px 36px" }} onClick={onGoGrow}>
          View investment plans →
        </button>
      </div>
    );
  }

  // Filter tasks by plan access — Legend-only tasks hidden from non-Legend
  const isLegend = tierInfo?.vip_tier === "legend";
  const accessibleTasks = tasks.filter(t => {
    if (t.subtype === "legend_only") return isLegend;
    return true;
  });

  const categories = ["all", ...new Set(accessibleTasks.map(t => t.category).filter(Boolean))];
  const filtered   = filter === "all" ? accessibleTasks : accessibleTasks.filter(t => t.category === filter);

  return (
    <div style={{ animation:"slideUp 0.3s ease", paddingBottom:20 }}>
      {/* Daily limit banner */}
      {tierInfo && (
        <div style={{ margin:"12px 16px 0", background: dark ? "#142e20" : "#E1F5EE", borderRadius:12, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:12, color:BRAND_DARK }}>
            <strong>{tierInfo.dailyTasks === null ? "Unlimited" : `${tierInfo.dailyTasks} tasks`}</strong>/day · <strong>×{tierInfo.multiplier.toFixed(2)}</strong> reward boost
          </div>
          <span style={{ background:BRAND, color:"white", fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:20 }}>
            {tierInfo.planName} {tierInfo.icon}
          </span>
        </div>
      )}
      <div style={{ padding:"12px 16px 12px" }}>
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
  const typeMeta = {
    youtube_watch:     { label:"▶ Watch",        bg:"#FAECE7", tc:"#993C1D" },
    youtube_subscribe: { label:"📺 Subscribe",   bg:"#FAECE7", tc:"#993C1D" },
    tiktok:            { label:"🎵 TikTok",      bg:"#F3E8FF", tc:"#7C3AED" },
    social:            { label:"📱 Social",      bg:"#E6F1FB", tc:"#185FA5" },
    survey:            { label:"📋 Survey",      bg:"#E1F5EE", tc:"#0F6E56" },
    install:           { label:"⬇ Install",      bg:"#FAEEDA", tc:"#854F0B" },
    review:            { label:"⭐ Review",       bg:"#FEF9E1", tc:"#854F0B" },
    like_product:      { label:"🛍 Rate Product", bg:"#FCE4EC", tc:"#C2185B" },
    like_song:         { label:"🎵 Rate Song",    bg:"#F3E8FF", tc:"#7C3AED" },
  };
  const meta      = typeMeta[t.type] ?? typeMeta.social;
  const spotsLeft = (t.limit_count ?? 0) - (t.completions ?? 0);
  const isLike    = t.type === "like_product" || t.type === "like_song";
  const isSong    = t.type === "like_song";

  // Parse cover/image from description JSON
  let taskMeta = {};
  try { taskMeta = JSON.parse(t.description ?? "{}"); } catch {}
  const coverUrl    = taskMeta.cover_url ?? t.image_url ?? null;
  const artistBrand = taskMeta.artist ?? taskMeta.brand ?? t.business ?? "";
  const genre       = taskMeta.genre ?? taskMeta.category ?? "";

  // ── Rich visual card for like tasks ──
  if (isLike) {
    return (
      <div
        style={{ background:T.card, borderRadius:18, margin: compact ? "0 0 12px" : "0 16px 14px",
          boxShadow:"0 4px 16px rgba(0,0,0,0.09)", cursor:"pointer", overflow:"hidden",
          border:`0.5px solid ${T.border}` }}
        onClick={onSelect}
      >
        {/* Cover image */}
        <div style={{ position:"relative", height:140, background: isSong
          ? "linear-gradient(135deg,#1a0533,#7C3AED)"
          : "linear-gradient(135deg,#1a0a2e,#C2185B)",
          overflow:"hidden" }}>
          {coverUrl && (
            <img src={coverUrl} alt={t.title}
              style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}
              onError={e => { e.target.style.display = "none"; }}
            />
          )}
          {/* Gradient overlay */}
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)" }} />
          {/* Type badge */}
          <div style={{ position:"absolute", top:10, left:10 }}>
            <span style={{ background:meta.bg, color:meta.tc, fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:20, backdropFilter:"blur(4px)" }}>{meta.label}</span>
          </div>
          {/* Spots badge */}
          {spotsLeft > 0 && spotsLeft < 20 && (
            <div style={{ position:"absolute", top:10, right:10 }}>
              <span style={{ background:"#FAECE7", color:"#E24B4A", fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:20 }}>⚡ {spotsLeft} left</span>
            </div>
          )}
          {/* Song vinyl icon */}
          {isSong && (
            <div style={{ position:"absolute", right:14, bottom:14, width:40, height:40, borderRadius:"50%", background:"rgba(255,255,255,0.18)", display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(6px)" }}>
              <div style={{ width:12, height:12, borderRadius:"50%", background:"white", opacity:0.9 }} />
            </div>
          )}
          {/* Title overlay */}
          <div style={{ position:"absolute", bottom:10, left:12, right:60 }}>
            <div style={{ fontWeight:700, fontSize:15, color:"white", lineHeight:1.2, textShadow:"0 1px 4px rgba(0,0,0,0.5)" }}>{t.title}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.8)", marginTop:2 }}>{artistBrand}{genre ? ` · ${genre}` : ""}</div>
          </div>
        </div>

        {/* Bottom row */}
        <div style={{ padding:"12px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", gap:6 }}>
            {REACTIONS.slice(0,3).map(r => (
              <span key={r.value} style={{ fontSize:18, opacity:0.6 }}>{r.emoji}</span>
            ))}
            <span style={{ fontSize:11, color:T.textSub, alignSelf:"center", marginLeft:2 }}>React & earn</span>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontWeight:700, color: isSong ? "#7C3AED" : "#C2185B", fontSize:16 }}>{fmt(t.reward)}</div>
            <div style={{ fontSize:9, color:T.textSub }}>instant</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Standard task card ──
  return (
    <div style={{ background:T.card, borderRadius:16, padding:"14px 16px", margin: compact ? "0 0 10px" : "0 16px 12px", boxShadow:"0 2px 8px rgba(0,0,0,0.07)", cursor:"pointer", border:`0.5px solid ${T.border}` }} onClick={onSelect}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:48, height:48, borderRadius:13, background:t.color ?? "#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{t.icon ?? "📋"}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
            <span style={{ background:meta.bg, color:meta.tc, fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:20 }}>{meta.label}</span>
            {spotsLeft < 20 && spotsLeft > 0 && <span style={{ background:"#FAECE7", color:"#E24B4A", fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:20 }}>⚡ {spotsLeft} left</span>}
          </div>
          <div style={{ fontWeight:600, fontSize:14, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.title}</div>
          <div style={{ fontSize:11, color:T.textSub, marginTop:2 }}>{t.business}</div>
        </div>
        <div style={{ textAlign:"right", flexShrink:0 }}>
          <div style={{ fontWeight:700, color:BRAND_DARK, fontSize:16 }}>{fmt(t.reward)}</div>
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
  const minW = settings.min_withdrawal ?? 1000;

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
  const icons = { task:"✅", referral:"👥", withdrawal:"💸", bonus:"🎁", streak:"🔥", deposit:"💳", activation:"⚡", investment:"🌱", investment_profit:"💰" };
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

// ── Live Profit Counter Hook ───────────────────────────────────
// Calculates profit earned so far for a single active investment,
// ticking up in real time based on elapsed seconds.
function useLiveProfitCounter(investment) {
  const [profit, setProfit] = useState(0);

  useEffect(() => {
    if (!investment || investment.status !== "active") {
      setProfit(0);
      return;
    }
    const startMs       = new Date(investment.starts_at).getTime();
    const endMs         = new Date(investment.ends_at).getTime();
    const totalSeconds  = Math.max(1, (endMs - startMs) / 1000);
    const totalProfit   = investment.expected_profit;
    const perSecond     = totalProfit / totalSeconds;

    const tick = () => {
      const elapsedSeconds = Math.max(0, (Date.now() - startMs) / 1000);
      const capped         = Math.min(elapsedSeconds, totalSeconds);
      setProfit(Math.floor(capped * perSecond));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [investment?.id]);

  return profit;
}

// ── Grow Tab ───────────────────────────────────────────────────
function GrowTab({ profile, investments, plans, onBuyPlan, onRefresh, dark }) {
  const T           = theme(dark);
  const activeInvs  = investments.filter(i => i.status === "active");
  const historyInvs = investments.filter(i => i.status === "paid_out");

  // Highest active tier, derived from the investments themselves —
  // no dependency on a fixed 5-name plan list.
  const tierInfo = getActiveTier(investments);
  const vipInfo  = tierInfo ? VIP_TIERS[tierInfo.vip_tier] : null;

  // Total live profit ticker across all active investments
  const [displayProfit, setDisplayProfit] = useState(0);
  useEffect(() => {
    const calc = () => activeInvs.reduce((sum, inv) => {
      const startMs = new Date(inv.starts_at).getTime();
      const endMs   = new Date(inv.ends_at).getTime();
      const total   = Math.max(1, (endMs - startMs) / 1000);
      const ps      = inv.expected_profit / total;
      const el      = Math.max(0, (Date.now() - startMs) / 1000);
      return sum + Math.floor(Math.min(el, total) * ps);
    }, 0);
    setDisplayProfit(calc());
    const id = setInterval(() => setDisplayProfit(calc()), 1000);
    return () => clearInterval(id);
  }, [investments]);

  // Group buyable plans by period for display
  const periods = [1, 3, 6, 12];
  const plansByPeriod = periods.map(m => ({
    months: m,
    label: fmtDuration(m),
    items: plans.filter(p => p.duration_months === m),
  })).filter(g => g.items.length > 0);

  return (
    <div style={{ animation:"slideUp 0.3s ease", paddingBottom:100 }}>

      {/* ── Hero card ── */}
      <div style={{ background:`linear-gradient(135deg,${BG_DARK} 0%,#1a3d2b 50%,${BRAND_DARK} 100%)`,
        margin:16, borderRadius:24, padding:"28px 22px", color:"white",
        boxShadow:"0 8px 32px rgba(15,46,34,0.4)", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", right:-30, top:-30, width:130, height:130, borderRadius:"50%", background:"rgba(255,255,255,0.05)" }} />
        <div style={{ position:"absolute", right:20, bottom:-40, width:100, height:100, borderRadius:"50%", background:"rgba(255,255,255,0.04)" }} />
        <div style={{ fontSize:11, opacity:0.7, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>Total profit growing</div>
        <div style={{ fontFamily:"'Sora',sans-serif", fontSize:42, fontWeight:700, letterSpacing:-1, marginBottom:4 }}>
          {fmt(displayProfit)}
        </div>
        <div style={{ fontSize:12, opacity:0.65, marginBottom:20 }}>
          Across {activeInvs.length} active plan{activeInvs.length !== 1 ? "s" : ""} · updates every second
        </div>
        {/* Active tier badge */}
        {vipInfo ? (
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:"rgba(255,255,255,0.12)", borderRadius:12, padding:"8px 14px" }}>
            <span style={{ fontSize:20 }}>{vipInfo.label.split(" ")[0]}</span>
            <div>
              <div style={{ fontSize:12, fontWeight:700 }}>{vipInfo.label} Member</div>
              <div style={{ fontSize:10, opacity:0.75 }}>{vipInfo.perk}</div>
            </div>
          </div>
        ) : (
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:"rgba(255,255,255,0.10)", borderRadius:12, padding:"8px 14px" }}>
            <span style={{ fontSize:16 }}>🔒</span>
            <div style={{ fontSize:12, opacity:0.8 }}>Buy a plan to unlock tasks & earning boosts</div>
          </div>
        )}
      </div>

      {/* ── Task access summary card ── */}
      <div style={{ background:T.card, borderRadius:16, margin:"0 16px 16px", padding:"16px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
        <div style={{ fontWeight:600, fontSize:14, color:T.text, marginBottom:14 }}>📋 Your Task Access</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          {[
            ["Tasks/day",   tierInfo ? (tierInfo.dailyTasks === null ? "∞" : tierInfo.dailyTasks) : "0",       tierInfo ? tierInfo.color : "#aaa"],
            ["Reward boost", tierInfo ? `×${tierInfo.multiplier.toFixed(2)}` : "—",                            tierInfo ? tierInfo.color : "#aaa"],
            ["Exclusive",    tierInfo?.exclusiveTasks ? "Yes 👑" : (tierInfo ? "No" : "—"),                    tierInfo?.exclusiveTasks ? "#B8860B" : "#aaa"],
          ].map(([lbl, val, tc]) => (
            <div key={lbl} style={{ textAlign:"center", background: dark ? "#142e20" : "#f7faf9", borderRadius:12, padding:"12px 6px" }}>
              <div style={{ fontSize:10, color:T.textSub, marginBottom:4 }}>{lbl}</div>
              <div style={{ fontWeight:700, fontSize:15, color:tc }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Active investments ── */}
      {activeInvs.length > 0 && (
        <div style={{ padding:"0 16px", marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:15, color:T.text, marginBottom:12 }}>📈 Your active investments</div>
          {activeInvs.map(inv => <ActiveInvestmentCard key={inv.id} investment={inv} dark={dark} />)}
        </div>
      )}

      {/* ── Plans to buy, grouped by period ── */}
      <div style={{ padding:"0 16px", marginBottom:16 }}>
        <div style={{ fontWeight:600, fontSize:15, color:T.text, marginBottom:4 }}>Growth Plans</div>
        <div style={{ fontSize:12, color:T.textSub, marginBottom:14 }}>
          Pick a period, enter any amount at or above the minimum, and watch it grow.
        </div>
        {plansByPeriod.map(group => (
          <div key={group.months} style={{ marginBottom:18 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.textSub, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
              {group.label}
            </div>
            {group.items.map(plan => {
              const vt         = VIP_TIERS[plan.vip_tier] ?? VIP_TIERS.silver;
              const isLegend   = plan.vip_tier === "legend";
              const exampleProfit = Math.floor(plan.min_amount * plan.rate_percent / 100);

              return (
                <div key={plan.id} style={{
                  background: isLegend ? "linear-gradient(135deg,#1a1000,#2d1f00)" : T.card,
                  borderRadius:18, marginBottom:14, overflow:"hidden",
                  boxShadow: isLegend ? "0 8px 32px rgba(184,134,11,0.25)" : "0 4px 16px rgba(0,0,0,0.08)",
                  border: isLegend ? "1.5px solid #B8860B" : `0.5px solid ${T.border}`,
                }}>
                  {/* Plan header */}
                  <div style={{ background:vt.gradient, padding:"18px 20px", color:"white" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div>
                        {isLegend && <div style={{ fontSize:10, fontWeight:700, background:"rgba(255,215,0,0.25)", borderRadius:20, padding:"2px 10px", display:"inline-block", marginBottom:6, letterSpacing:"0.08em" }}>👑 MOST POWERFUL</div>}
                        <div style={{ fontSize:30, marginBottom:4 }}>{plan.icon}</div>
                        <div style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:20 }}>{plan.name}</div>
                        <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>
                          {plan.rate_percent}% return · {fmtDuration(plan.duration_months)}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:11, opacity:0.75 }}>Minimum</div>
                        <div style={{ fontFamily:"'Sora',sans-serif", fontSize:20, fontWeight:700 }}>{fmt(plan.min_amount)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Plan stats */}
                  <div style={{ padding:"14px 18px" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:14 }}>
                      {[
                        ["Min amount", fmt(plan.min_amount)],
                        [`Profit on min`, fmt(exampleProfit)],
                        ["Tasks/day", plan.task_limit === null ? "∞ 👑" : String(plan.task_limit)],
                        ["Boost",     `×${Number(plan.multiplier).toFixed(2)}`],
                      ].map(([lbl, val]) => (
                        <div key={lbl} style={{ textAlign:"center", background: isLegend ? "rgba(184,134,11,0.12)" : (dark ? "#142e20" : "#f7faf9"), borderRadius:10, padding:"10px 4px" }}>
                          <div style={{ fontSize:9, color: isLegend ? "#B8860B" : T.textSub, marginBottom:3 }}>{lbl}</div>
                          <div style={{ fontWeight:700, fontSize:12, color: isLegend ? "#FFD700" : T.text }}>{val}</div>
                        </div>
                      ))}
                    </div>

                    {isLegend && (
                      <div style={{ background:"rgba(184,134,11,0.15)", borderRadius:10, padding:"10px 14px", marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:18 }}>👑</span>
                        <div>
                          <div style={{ fontSize:12, fontWeight:700, color:"#FFD700" }}>Exclusive Legend Tasks</div>
                          <div style={{ fontSize:11, color:"#B8860B", marginTop:2 }}>High-paying tasks only Legend members can see</div>
                        </div>
                      </div>
                    )}

                    <button
                      style={{ ...S.primaryBtn, background:vt.gradient, padding:"12px 0", fontSize:14, fontWeight:700 }}
                      onClick={() => onBuyPlan(plan)}
                    >
                      Invest from {fmt(plan.min_amount)} →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Investment history ── */}
      {historyInvs.length > 0 && (
        <div style={{ padding:"0 16px", marginBottom:20 }}>
          <div style={{ fontWeight:600, fontSize:15, color:T.text, marginBottom:12 }}>📜 History</div>
          {historyInvs.map(inv => {
            const vt = VIP_TIERS[inv.vip_tier] ?? VIP_TIERS.silver;
            return (
              <div key={inv.id} style={{ background:T.card, borderRadius:14, padding:"14px 16px", marginBottom:10, boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:40, height:40, borderRadius:12, background:vt.gradient, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{inv.plan_icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, fontSize:14, color:T.text }}>{inv.plan_name} Plan</div>
                  <div style={{ fontSize:11, color:T.textSub, marginTop:2 }}>Matured {new Date(inv.credited_at ?? inv.ends_at).toLocaleDateString()}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:700, color:BRAND_DARK, fontSize:14 }}>+{fmt(inv.expected_profit)}</div>
                  <div style={{ fontSize:10, color:T.textSub }}>profit</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Active Investment Card (with live ticking profit) ──────────
function ActiveInvestmentCard({ investment: inv, dark }) {
  const T           = theme(dark);
  const vt          = VIP_TIERS[inv.vip_tier] ?? VIP_TIERS.silver;
  const liveProfit  = useLiveProfitCounter(inv);
  const totalProfit = inv.expected_profit;
  const pct         = totalProfit > 0 ? Math.min(100, Math.round((liveProfit / totalProfit) * 100)) : 0;

  const endsAt   = new Date(inv.ends_at);
  const now      = new Date();
  const msLeft   = Math.max(0, endsAt - now);
  const daysLeft = Math.floor(msLeft / 86400000);
  const hrsLeft  = Math.floor((msLeft % 86400000) / 3600000);

  return (
    <div style={{ background:T.card, borderRadius:18, marginBottom:12, overflow:"hidden", boxShadow:"0 4px 16px rgba(0,0,0,0.1)", border:`0.5px solid ${T.border}` }}>
      <div style={{ background:vt.gradient, padding:"14px 18px", color:"white", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:24 }}>{inv.plan_icon}</span>
          <div>
            <div style={{ fontWeight:700, fontSize:16 }}>{inv.plan_name} Plan</div>
            <div style={{ fontSize:11, opacity:0.8 }}>{inv.rate_percent}% return · {fmtDuration(inv.duration_months)}</div>
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:10, opacity:0.75 }}>Principal</div>
          <div style={{ fontWeight:700, fontSize:15 }}>{fmt(inv.amount)}</div>
        </div>
      </div>

      <div style={{ padding:"16px 18px" }}>
        {/* Live profit counter */}
        <div style={{ textAlign:"center", marginBottom:14, background: dark ? "#142e20" : "#f0faf6", borderRadius:14, padding:"14px" }}>
          <div style={{ fontSize:10, color:T.textSub, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>
            Profit earned so far
          </div>
          <div style={{ fontFamily:"'Sora',sans-serif", fontSize:32, fontWeight:700, color:BRAND_DARK, letterSpacing:-1 }}>
            {fmt(liveProfit)}
          </div>
          <div style={{ fontSize:11, color:T.textSub, marginTop:2 }}>
            of {fmt(totalProfit)} total · ticking up every second
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.textSub, marginBottom:5 }}>
            <span>{pct}% complete</span>
            <span>{daysLeft}d {hrsLeft}h remaining</span>
          </div>
          <div style={{ height:8, background: dark ? "#1a3d2b" : "#eee", borderRadius:4 }}>
            <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${BRAND},${BRAND_DARK})`, borderRadius:4, transition:"width 1s linear" }} />
          </div>
        </div>

        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.textSub }}>
          <span>Started {new Date(inv.starts_at).toLocaleDateString()}</span>
          <span>Matures {new Date(inv.ends_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

// ── Invest Modal ───────────────────────────────────────────────
function InvestModal({ plan, profile, userId, investments, onClose, onSuccess, dark }) {
  const T           = theme(dark);
  const vt           = VIP_TIERS[plan.vip_tier] ?? VIP_TIERS.silver;
  const [amount, setAmount]   = useState(String(plan.min_amount));
  const [phone, setPhone]     = useState(profile?.phone ?? "");
  const [method, setMethod]   = useState(detectMethod(profile?.phone));
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");
  const [step, setStep]       = useState("confirm"); // confirm | waiting | success

  const amountNum   = parseInt(amount, 10) || 0;
  const amountValid = amountNum >= plan.min_amount;
  const totalProfit = Math.floor(amountNum * plan.rate_percent / 100);

  const handlePhoneChange = (val) => { setPhone(val); setMethod(detectMethod(val)); };

  // Poll for balance change after LivePay prompt
  const { startPolling, stopPolling } = useDepositPolling(userId, async (newBalance) => {
    // Payment confirmed — now activate the plan in DB
    try {
      await buyInvestmentPlan(userId, plan.id, amountNum);
      setStep("success");
      await onSuccess();
    } catch (e) {
      setErr(e.message ?? "Investment failed after payment");
      setStep("confirm");
    }
  });

  const handleSubmit = async () => {
    setErr("");
    if (!amountValid) return setErr(`Minimum for this plan is ${fmt(plan.min_amount)}`);
    if (!phone) return setErr("Enter your mobile money number");
    setLoading(true);
    try {
      await requestInvestmentPayment(userId, amountNum, method, phone);
      startPolling(profile?.balance ?? 0);
      setStep("waiting");
    } catch (e) {
      setErr(e.message ?? "Payment request failed");
    }
    setLoading(false);
  };

  if (step === "success") {
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }}>
        <div style={{ background:T.card, borderRadius:"24px 24px 0 0", padding:"40px 24px 48px", width:"100%", maxWidth:480, textAlign:"center", animation:"slideUp 0.25s ease" }}>
          <div style={{ fontSize:64, marginBottom:16 }}>{plan.icon}</div>
          <div style={{ fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:700, color:T.text, marginBottom:8 }}>
            {plan.name} Plan Active!
          </div>
          <div style={{ fontSize:14, color:T.textSub, marginBottom:8, lineHeight:1.7 }}>
            Your investment is now growing. Come back to watch your profits tick up in real time.
          </div>
          <div style={{ background:"#E1F5EE", borderRadius:12, padding:"14px", marginBottom:24 }}>
            <div style={{ fontSize:12, color:T.textSub, marginBottom:4 }}>Expected profit at maturity</div>
            <div style={{ fontFamily:"'Sora',sans-serif", fontSize:28, fontWeight:700, color:BRAND_DARK }}>{fmt(totalProfit)}</div>
            <div style={{ fontSize:11, color:T.textSub, marginTop:2 }}>in {fmtDuration(plan.duration_months)}</div>
          </div>
          <button style={{ ...S.primaryBtn, width:"auto", padding:"12px 40px", background:vt.gradient }} onClick={onClose}>
            Watch it grow →
          </button>
        </div>
      </div>
    );
  }

  if (step === "waiting") {
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }}>
        <div style={{ background:T.card, borderRadius:"24px 24px 0 0", padding:"40px 24px 48px", width:"100%", maxWidth:480, textAlign:"center", animation:"slideUp 0.25s ease" }}>
          <div style={{ width:72, height:72, borderRadius:"50%", border:`4px solid ${dark ? "#2a5040" : "#eee"}`, borderTopColor:BRAND, margin:"0 auto 24px", animation:"spin 1s linear infinite" }} />
          <div style={{ fontFamily:"'Sora',sans-serif", fontSize:20, fontWeight:700, color:T.text, marginBottom:10 }}>
            Waiting for payment...
          </div>
          <div style={{ fontSize:14, color:T.textSub, lineHeight:1.7, marginBottom:8 }}>
            A payment prompt has been sent to
          </div>
          <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:8 }}>{phone}</div>
          <div style={{ fontSize:13, color:T.textSub, lineHeight:1.7, marginBottom:24 }}>
            Enter your {method.toUpperCase()} PIN to pay <strong style={{ color:T.text }}>{fmt(amountNum)}</strong>.
            Your {plan.name} plan activates automatically once confirmed.
          </div>
          <button onClick={() => { stopPolling(); setStep("confirm"); }} style={{ background:"none", border:`0.5px solid ${T.border}`, borderRadius:10, padding:"10px 24px", fontSize:13, color:T.textSub, cursor:"pointer" }}>
            Cancel
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 }} onClick={onClose}>
      <div style={{ background:T.card, borderRadius:"24px 24px 0 0", width:"100%", maxWidth:480, animation:"slideUp 0.25s ease", overflow:"hidden" }} onClick={e => e.stopPropagation()}>

        {/* Coloured header */}
        <div style={{ background:vt.gradient, padding:"20px 22px", color:"white" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontSize:28, marginBottom:4 }}>{plan.icon}</div>
              <div style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:20 }}>
                {plan.name} Plan
              </div>
              <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>
                {plan.rate_percent}% return · {fmtDuration(plan.duration_months)}
              </div>
            </div>
            <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", color:"white", borderRadius:10, width:32, height:32, fontSize:18, cursor:"pointer" }}>×</button>
          </div>
        </div>

        <div style={{ padding:"20px 22px 32px" }}>
          {err && <div style={{ background:"#FAECE7", color:"#993C1D", borderRadius:10, padding:"10px 14px", fontSize:13, marginBottom:12 }}>{err}</div>}

          <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500 }}>Amount to invest (min {fmt(plan.min_amount)})</label>
          <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${amountValid ? T.inputBrd : "#E24B4A"}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text, marginBottom:14 }} type="number" min={plan.min_amount} placeholder={String(plan.min_amount)} value={amount} onChange={e => setAmount(e.target.value)} />

          {/* Summary cards */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
            {[
              ["You pay", fmt(amountNum)],
              ["You earn", fmt(totalProfit)],
              ["Duration", fmtDuration(plan.duration_months)],
              ["Return rate", `${plan.rate_percent}%`],
            ].map(([lbl, val]) => (
              <div key={lbl} style={{ background: dark ? "#142e20" : "#f7faf9", borderRadius:12, padding:"12px", textAlign:"center" }}>
                <div style={{ fontSize:10, color:T.textSub, marginBottom:4 }}>{lbl}</div>
                <div style={{ fontWeight:700, fontSize:14, color:T.text }}>{val}</div>
              </div>
            ))}
          </div>

          <label style={{ display:"block", fontSize:11, color:T.textSub, marginBottom:6, fontWeight:500 }}>Mobile money number</label>
          <input style={{ width:"100%", padding:"11px 14px", border:`0.5px solid ${T.inputBrd}`, borderRadius:10, fontSize:14, background:T.inputBg, color:T.text, marginBottom:8 }} type="tel" placeholder="0700 000 000" value={phone} onChange={e => handlePhoneChange(e.target.value)} />
          <div style={{ background: method === "mtn" ? "#FAEEDA" : "#E6F1FB", borderRadius:8, padding:"8px 12px", fontSize:12, fontWeight:600, color: method === "mtn" ? "#854F0B" : "#185FA5", marginBottom:16 }}>
            📶 {method === "mtn" ? "MTN Mobile Money detected" : "Airtel Money detected"}
          </div>

          <button style={{ ...S.primaryBtn, padding:"14px 0", fontSize:15, background:vt.gradient, opacity: amountValid ? 1 : 0.6 }} onClick={handleSubmit} disabled={loading || !amountValid}>
            {loading ? "Sending prompt..." : `Pay ${fmt(amountNum)} & activate →`}
          </button>
          <p style={{ fontSize:11, color:T.textSub, textAlign:"center", marginTop:10, lineHeight:1.6 }}>
            Profit of {fmt(totalProfit)} credited to your balance at maturity.
            Principal also returned in full.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Withdraw Modal ─────────────────────────────────────────────
function WithdrawModal({ profile, settings, onClose, onSubmit, dark }) {
  const [amount, setAmount]   = useState("");
  const [phone, setPhone]     = useState(profile?.phone ?? "");
  const [method, setMethod]   = useState(detectMethod(profile?.phone));
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");
  const T = theme(dark);
  const min = parseInt(settings.min_withdrawal ?? 1000);
  const max = parseInt(settings.max_withdrawal ?? 1000000);
  const bal = profile?.balance ?? 0;

  const handlePhoneChange = (val) => { setPhone(val); setMethod(detectMethod(val)); };

  const handleSubmit = async () => {
    setErr("");
    const amt = parseInt(amount);
    // Withdrawal window: 7:00 AM – 7:00 PM EAT
    const now  = new Date();
    const hour = now.getHours(); // local device time (Uganda = UTC+3)
    if (hour < 7 || hour >= 19) return setErr("Withdrawals are only processed between 7:00 AM and 7:00 PM. Try again during business hours.");
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
        <p style={{ fontSize:11, color:T.textSub, textAlign:"center", marginTop:12 }}>💡 Withdrawals available 7:00 AM – 7:00 PM daily.</p>
      </div>
    </div>
  );
}

// ── Referral Tab ───────────────────────────────────────────────
function ReferralTab({ profile, referrals, settings, dark }) {
  const T = theme(dark);
  const ref1 = settings.ref1_rate ?? 10; // % of plan amount, paid to direct referrer
  const ref2 = settings.ref2_rate ?? 5;  // % of plan amount, paid to referrer's referrer
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
        <div style={{ fontWeight:600, fontSize:14, marginBottom:4, color:T.text }}>Commission rates</div>
        <div style={{ fontSize:11, color:T.textSub, marginBottom:14 }}>Paid when someone in your referral tree buys a growth plan — two levels deep.</div>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:"#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🥇</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, color:T.text, fontWeight:600 }}>Level 1 — people you directly refer</div>
            <div style={{ fontSize:11, color:T.textSub }}>When they buy any growth plan</div>
          </div>
          <div style={{ fontWeight:700, color:BRAND_DARK, fontSize:15 }}>{ref1}%</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:"#E6F1FB", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🥈</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, color:T.text, fontWeight:600 }}>Level 2 — people they refer</div>
            <div style={{ fontSize:11, color:T.textSub }}>When those people buy any growth plan</div>
          </div>
          <div style={{ fontWeight:700, color:"#185FA5", fontSize:15 }}>{ref2}%</div>
        </div>
      </div>
      <div style={{ padding:"0 16px" }}>
        <div style={{ fontWeight:600, fontSize:14, marginBottom:12, color:T.text }}>Your referrals ({referrals.length})</div>
        {referrals.length === 0
          ? <div style={{ background:T.card, borderRadius:14, padding:30, textAlign:"center", color:T.textSub }}>No referrals yet.<br />Share your code to start earning commission!</div>
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
function ProfileTab({ profile, investments, onSignOut, onActivate, onDeposit, dark }) {
  const T = theme(dark);
  const tierInfo = getActiveTier(investments);
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
          { label:"VIP Tier",        value: tierInfo?.label ?? "🔒 None yet" },
          { label:"Total invested",  value: fmt(profile?.total_invested) },
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