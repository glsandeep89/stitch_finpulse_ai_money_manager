import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { AppShell } from "./components/AppShell";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import CreditCards from "./pages/CreditCards";
import Investments from "./pages/Investments";
import Mortgage from "./pages/Mortgage";
import Insights from "./pages/Insights";
import Budget from "./pages/Budget";
import Household from "./pages/Household";
import Settings from "./pages/Settings";
import SettingsAdvanced from "./pages/SettingsAdvanced";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route path="/" element={<Overview />} />
        <Route path="/creditcards" element={<CreditCards />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/mortgage" element={<Mortgage />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/household" element={<Household />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/advanced" element={<SettingsAdvanced />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
