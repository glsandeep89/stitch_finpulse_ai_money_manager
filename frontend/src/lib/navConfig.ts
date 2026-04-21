/** Primary sidebar / desktop navigation (full list). */
export const desktopNav = [
  { to: "/", label: "Overview", icon: "dashboard" },
  { to: "/creditcards", label: "Credit Cards", icon: "credit_card" },
  { to: "/investments", label: "Investments", icon: "trending_up" },
  { to: "/mortgage", label: "Mortgage", icon: "home" },
  { to: "/insights", label: "Insights", icon: "insights" },
  { to: "/budget", label: "Budget", icon: "account_balance_wallet" },
  { to: "/household", label: "Household", icon: "group" },
  { to: "/settings", label: "Settings", icon: "settings" },
] as const;

/** Mobile bottom bar: first four destinations; rest are under “More”. */
export const mobilePrimaryNav = [
  { to: "/", label: "Overview", icon: "dashboard" },
  { to: "/creditcards", label: "Cards", icon: "credit_card" },
  { to: "/investments", label: "Invest", icon: "trending_up" },
  { to: "/budget", label: "Budget", icon: "account_balance_wallet" },
] as const;

export const mobileMoreNav = [
  { to: "/mortgage", label: "Mortgage", icon: "home" },
  { to: "/insights", label: "Insights", icon: "insights" },
  { to: "/household", label: "Household", icon: "group" },
  { to: "/settings", label: "Settings", icon: "settings" },
] as const;

export function isMobileMoreRouteActive(pathname: string): boolean {
  if (pathname === "/mortgage" || pathname === "/insights" || pathname === "/household") return true;
  return pathname === "/settings" || pathname.startsWith("/settings/");
}
