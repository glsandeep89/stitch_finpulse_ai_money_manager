import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useScope } from "../contexts/ScopeContext";
import { initialsFromUser, routePageTitle } from "../lib/userDisplay";

/** Top app bar — ported from `reference/stitch-html/budget_web/code.html` */
export function TopBar() {
  const { user } = useAuth();
  const { scope, setScope } = useScope();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchDraft, setSearchDraft] = useState("");
  const initials = initialsFromUser(user?.email ?? undefined);
  const path = location.pathname;
  const showSearch = path === "/creditcards" || path === "/" || path === "/transactions";
  const pageTitle = routePageTitle[path] ?? "FinPulse";

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("q");
    if ((location.pathname === "/creditcards" || location.pathname === "/transactions") && q) {
      setSearchDraft(q);
    }
  }, [location.pathname, location.search]);

  const submitSearch = () => {
    const q = searchDraft.trim();
    navigate(q ? `/transactions?q=${encodeURIComponent(q)}` : "/transactions");
  };

  return (
    <header className="fixed top-0 right-0 w-full md:w-[calc(100%-16rem)] h-20 z-40 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md flex items-center justify-between gap-4 px-6 md:px-10 shadow-sm dark:shadow-none border-b border-slate-100 dark:border-slate-800 transition-all duration-200">
      <div
        className="hidden sm:flex items-center rounded-full border border-outline-variant/30 bg-surface-container-lowest p-0.5 text-xs font-medium shrink-0"
        role="group"
        aria-label="Data scope"
      >
        <button
          type="button"
          onClick={() => setScope("me")}
          className={`px-3 py-1.5 rounded-full transition-colors ${
            scope === "me" ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          Just me
        </button>
        <button
          type="button"
          onClick={() => setScope("household")}
          className={`px-3 py-1.5 rounded-full transition-colors ${
            scope === "household"
              ? "bg-primary text-on-primary"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          Household
        </button>
      </div>

      {showSearch ? (
        <div className="flex items-center flex-1 max-w-md min-w-0">
          <form
            className="relative w-full"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch();
            }}
            role="search"
          >
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl pointer-events-none">
              search
            </span>
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search transactions (merchant or category)…"
              className="w-full pl-10 pr-4 py-2 bg-transparent border-b border-outline-variant/20 focus:border-primary focus:bg-surface-container-lowest focus:ring-0 transition-all duration-200 text-sm font-body text-on-background placeholder:text-on-surface-variant/50 outline-none rounded-none"
              aria-label="Search transactions"
            />
          </form>
        </div>
      ) : (
        <div className="flex-1 min-w-0 flex items-center md:pl-2">
          <h1 className="font-headline text-lg md:text-xl font-semibold text-on-background truncate tracking-tight">
            {pageTitle}
          </h1>
        </div>
      )}

      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <button
          type="button"
          className="w-10 h-10 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 hover:text-black dark:hover:text-white transition-all duration-200"
          aria-label="Notifications"
        >
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <Link
          to="/settings"
          className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-surface-container-highest border border-outline-variant/20 flex items-center justify-center text-xs font-semibold text-on-surface hover:opacity-90 transition-opacity"
          title={user?.email ?? "Account"}
          aria-label="Account and settings"
        >
          {initials}
        </Link>
      </div>
    </header>
  );
}
