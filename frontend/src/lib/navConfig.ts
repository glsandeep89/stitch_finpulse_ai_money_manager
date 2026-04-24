/** Primary sidebar / desktop navigation (full list). */
export const desktopNav = [
  { to: "/", label: "Overview", icon: "dashboard" },
  { to: "/transactions", label: "Transactions", icon: "receipt_long" },
  { to: "/creditcards", label: "Credit Cards", icon: "credit_card" },
  { to: "/subscriptions", label: "Recurring", icon: "autorenew" },
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
  { to: "/transactions", label: "Txns", icon: "receipt_long" },
  { to: "/creditcards", label: "Cards", icon: "credit_card" },
  { to: "/subscriptions", label: "Recurring", icon: "autorenew" },
  { to: "/budget", label: "Budget", icon: "account_balance_wallet" },
] as const;

export const mobileMoreNav = [
  { to: "/investments", label: "Investments", icon: "trending_up" },
  { to: "/mortgage", label: "Mortgage", icon: "home" },
  { to: "/insights", label: "Insights", icon: "insights" },
  { to: "/household", label: "Household", icon: "group" },
  { to: "/settings", label: "Settings", icon: "settings" },
] as const;

export function isMobileMoreRouteActive(pathname: string): boolean {
  if (pathname === "/mortgage" || pathname === "/insights" || pathname === "/household" || pathname === "/investments") return true;
  return pathname === "/settings" || pathname.startsWith("/settings/");
}
