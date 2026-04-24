/** Shared display helpers for the signed-in user (shell + top bar). */

export function initialsFromUser(email: string | undefined): string {
  if (!email) return "?";
  const local = email.split("@")[0] ?? "";
  const parts = local.replace(/[._-]+/g, " ").trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase() || "?";
}

export function displayName(email: string | undefined): string {
  if (!email) return "User";
  const local = email.split("@")[0] ?? "";
  const parts = local.replace(/[._-]+/g, " ").trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]![0]}. ${parts[1]!.charAt(0).toUpperCase() + parts[1]!.slice(1)}`;
  }
  return local.slice(0, 24) || "User";
}

/** Short titles for the top bar when transaction search is hidden. */
export const routePageTitle: Record<string, string> = {
  "/": "Overview",
  "/transactions": "Transactions",
  "/creditcards": "Credit Cards",
  "/subscriptions": "Recurring",
  "/investments": "Investments",
  "/mortgage": "Mortgage",
  "/insights": "Insights",
  "/budget": "Budget",
  "/household": "Household",
  "/settings": "Settings",
  "/settings/advanced": "Advanced",
};
