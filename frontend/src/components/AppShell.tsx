import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useFinpulseBackgroundSync } from "../hooks/useFinpulseBackgroundSync";
import { desktopNav, isMobileMoreRouteActive, mobileMoreNav, mobilePrimaryNav } from "../lib/navConfig";
import { displayName, initialsFromUser } from "../lib/userDisplay";
import { FinPulseLogo } from "./FinPulseLogo";
import { TopBar } from "./TopBar";
import { AssistantPanel } from "./AssistantPanel";

/** Layout ported from `reference/stitch-html/budget_web/code.html` */
export function AppShell() {
  const { pathname } = useLocation();
  const { signOut, user, session } = useAuth();
  useFinpulseBackgroundSync(user?.id, session?.access_token);
  const [moreOpen, setMoreOpen] = useState(false);
  const initials = initialsFromUser(user?.email ?? undefined);
  const name = displayName(user?.email ?? undefined);

  return (
    <div className="min-h-screen flex bg-background text-on-background font-body pb-[4.5rem] md:pb-0">
      <nav className="hidden md:flex h-screen w-64 fixed left-0 top-0 bg-slate-50 dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 flex-col py-8 px-6 z-50">
        <div className="mb-12 flex items-center gap-3">
          <FinPulseLogo size={36} className="rounded-lg shrink-0 shadow-sm" />
          <div>
            <h1 className="text-2xl font-bold font-headline tracking-tight text-black dark:text-white leading-none">
              FinPulse
            </h1>
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest mt-1">Wealth Management</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 flex-grow font-body text-sm font-medium">
          {desktopNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl transition-colors scale-95 duration-150 ${
                  isActive
                    ? "text-black dark:text-white font-bold bg-slate-100 dark:bg-slate-800 border-l-4 border-black dark:border-emerald-400"
                    : "text-slate-500 dark:text-slate-400 hover:text-black dark:hover:text-emerald-300 hover:bg-slate-100/50"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
        <Link
          to="/settings"
          className="mt-auto flex items-center gap-3 px-4 py-3 pt-6 border-t border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-100/50 dark:hover:bg-slate-800/50 transition-colors -mx-1"
        >
          <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-sm font-semibold text-on-surface shrink-0">
            {initials}
          </div>
          <div className="flex flex-col min-w-0 text-left">
            <span className="text-sm font-semibold text-on-background truncate">{name}</span>
            <span className="text-xs text-on-surface-variant">Account & settings</span>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => signOut()}
          className="mt-2 text-left text-sm text-slate-600 hover:text-black px-4"
        >
          Sign out
        </button>
      </nav>

      <div className="flex-1 md:ml-64 flex flex-col min-h-screen relative">
        <TopBar />
        <main className="flex-1 pt-28 px-6 md:px-10 pb-16 md:pb-20 max-w-7xl mx-auto w-full">
          <Outlet />
        </main>
      </div>

      <AssistantPanel />

      {/* Mobile: primary tabs + More */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white dark:bg-slate-950 flex justify-around items-stretch py-1.5 text-[10px] text-center"
        aria-label="Main navigation"
      >
        {mobilePrimaryNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 min-w-0 px-0.5 py-1 rounded-lg ${
                isActive ? "text-black dark:text-white font-bold" : "text-slate-500"
              }`
            }
          >
            <span className="material-symbols-outlined text-[20px] leading-none">{item.icon}</span>
            <span className="truncate w-full mt-0.5">{item.label}</span>
          </NavLink>
        ))}
        <MobileMoreButton
          open={moreOpen}
          active={isMobileMoreRouteActive(pathname)}
          onOpen={() => setMoreOpen(true)}
        />
      </nav>

      {moreOpen ? (
        <>
          <button
            type="button"
            className="md:hidden fixed inset-0 z-[55] bg-black/40"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div className="md:hidden fixed bottom-[4.5rem] left-3 right-3 z-[56] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 pb-1">More</p>
            {mobileMoreNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${
                    isActive
                      ? "bg-slate-100 dark:bg-slate-800 text-black dark:text-white"
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80"
                  }`
                }
                onClick={() => setMoreOpen(false)}
              >
                <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MobileMoreButton({ open, active, onOpen }: { open: boolean; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex flex-col items-center justify-center flex-1 min-w-0 px-0.5 py-1 rounded-lg ${
        active || open ? "text-black dark:text-white font-bold" : "text-slate-500"
      }`}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label="More destinations"
    >
      <span className="material-symbols-outlined text-[20px] leading-none">more_horiz</span>
      <span className="truncate w-full mt-0.5">More</span>
    </button>
  );
}
