// src/App.jsx
import EarnNet  from "./pages/EarnNet";
import AdminApp from "./pages/AdminApp";

export default function App() {
  // Simple routing: /admin → Admin panel, everything else → user app
  const isAdmin = window.location.pathname.startsWith("/admin");
  return isAdmin ? <AdminApp /> : <EarnNet />;
}
