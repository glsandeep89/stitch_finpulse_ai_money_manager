import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AiOutputEmpty } from "../components/ai/AiOutputCard";
import { api } from "../lib/api";
import type { AiOutputsResponse } from "../lib/aiOutputs";
import { useAuth } from "../contexts/AuthContext";

const PRESET_CATEGORIES = [
  "Groceries",
  "Food and Drink",
  "Restaurants",
  "Travel",
  "Entertainment",
  "Gas Stations",
  "Shopping",
  "Rent and Utilities",
];

type BudgetRow = {
  id: string;
  category: string;
  amount_limit: number;
  period_start: string;
  period_end?: string | null;
  periodLabel?: string;
  spent?: number;
  remaining?: number;
  pct?: number;
  projectedOverage?: number;
};

type ProjectRow = {
  id: string;
  name: string;
  target_amount: number;
  spent_amount: number;
};

function fmt(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function monthOverviewLabel(): string {
  const d = new Date();
  return `${d.toLocaleString(undefined, { month: "long", year: "numeric" })} Overview`;
}

function projectedMonthEndSurplus(totalCap: number, totalSpent: number): string {
  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const d = Math.max(1, now.getDate());
  const pace = totalSpent / d;
  const projectedEom = pace * dim;
  const delta = totalCap - projectedEom;
  if (delta >= 0) {
    return `On track. Estimated to end month with ${fmt(delta)} surplus (linear estimate).`;
  }
  return `At current pace, spending may exceed total budgets by about ${fmt(-delta)} this month (estimate).`;
}

function categoryIcon(cat: string): string {
  const c = cat.toLowerCase();
  if (c.includes("grocery") || c.includes("food")) return "shopping_cart";
  if (c.includes("transport") || c.includes("gas")) return "directions_car";
  if (c.includes("util")) return "bolt";
  if (c.includes("travel")) return "flight";
  if (c.includes("dining") || c.includes("restaurant")) return "restaurant";
  return "category";
}

/** Decorative sub-rows — proportional split so UI matches Stitch export (`budget_web/code.html`). */
function projectSubRows(target: number, spent: number) {
  const weights = [0.32, 0.48, 0.2] as const;
  const labels = [
    { icon: "flight_takeoff", name: "Flights" },
    { icon: "hotel", name: "Accommodation" },
    { icon: "restaurant", name: "Meals & Transit" },
  ];
  const caps = weights.map((w) => target * w);
  const parts = weights.map((w) => spent * w);
  return labels.map((L, i) => ({
    ...L,
    spent: parts[i]!,
    cap: caps[i]!,
    pct: caps[i]! > 0 ? Math.min(100, (parts[i]! / caps[i]!) * 100) : 0,
  }));
}

export default function Budget() {
  const { session } = useAuth();
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [cat, setCat] = useState("Groceries");
  const [limit, setLimit] = useState("500");
  const [projName, setProjName] = useState("NYC Tech Conference");
  const [projTarget, setProjTarget] = useState("2500");
  const [err, setErr] = useState<string | null>(null);
  const addPanelRef = useRef<HTMLDivElement>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addTab, setAddTab] = useState<"category" | "project">("category");
  const [mappings, setMappings] = useState<
    { id: string; plaid_category_pattern: string; budget_category: string }[]
  >([]);
  const [mapPattern, setMapPattern] = useState("");
  const [mapTarget, setMapTarget] = useState("");
  const [goalAdjustments, setGoalAdjustments] = useState<
    { from: string; to: string; amount: number; reason: string }[]
  >([]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setErr(null);
    try {
      const [b, cats, p, mapRes, goalOut] = await Promise.all([
        api<{ budgets: BudgetRow[] }>("/budgets", { accessToken: session.access_token }),
        api<{ categories: string[] }>("/meta/transaction-categories", {
          accessToken: session.access_token,
        }).catch(() => ({ categories: [] as string[] })),
        api<{ projects: ProjectRow[] }>("/budget-projects", { accessToken: session.access_token }),
        api<{ mappings: { id: string; plaid_category_pattern: string; budget_category: string }[] }>(
          "/meta/category-mappings",
          { accessToken: session.access_token }
        ).catch(() => ({ mappings: [] })),
        api<AiOutputsResponse>("/ai-outputs?families=goal_adjustment", {
          accessToken: session.access_token,
        }).catch(() => ({ byFamily: {} as AiOutputsResponse["byFamily"] })),
      ]);
      setBudgets(b.budgets);
      setCategories(cats.categories);
      setProjects(p.projects ?? []);
      setMappings(mapRes.mappings ?? []);
      const adj = goalOut.byFamily?.goal_adjustment?.payload as
        | { adjustments?: { from: string; to: string; amount: number; reason: string }[] }
        | undefined;
      setGoalAdjustments(adj?.adjustments ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }, [session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const totalCap = budgets.reduce((s, b) => s + Number(b.amount_limit), 0);
    const totalSpent = budgets.reduce((s, b) => s + (b.spent ?? 0), 0);
    const remaining = Math.max(0, totalCap - totalSpent);
    const pct = totalCap > 0 ? Math.min(100, (totalSpent / totalCap) * 100) : 0;
    return { totalCap, totalSpent, remaining, pct };
  }, [budgets]);

  const projectionText = useMemo(
    () => projectedMonthEndSurplus(totals.totalCap, totals.totalSpent),
    [totals.totalCap, totals.totalSpent]
  );

  const alertBudget = useMemo(() => {
    const candidates = budgets.filter((b) => (b.pct ?? 0) >= 85);
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => ((b.pct ?? 0) > (a.pct ?? 0) ? b : a));
  }, [budgets]);

  const daysLeft = () => {
    const now = new Date();
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return dim - now.getDate();
  };

  const mergedCategoryOptions = [...new Set([...PRESET_CATEGORIES, ...categories])].sort((a, b) =>
    a.localeCompare(b)
  );

  const scrollToAdd = () => {
    setAddPanelOpen(true);
    setAddTab("category");
    addPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    addPanelRef.current?.querySelector("input")?.focus();
  };

  const scrollToAddProject = () => {
    setAddPanelOpen(true);
    setAddTab("project");
    document.getElementById("budget-add-project-name")?.focus();
    addPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const addBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;
    const start = new Date();
    start.setDate(1);
    await api("/budgets", {
      method: "POST",
      body: JSON.stringify({
        category: cat,
        amount_limit: Number(limit),
        period_start: start.toISOString().slice(0, 10),
      }),
      accessToken: session.access_token,
    });
    load();
  };

  const addProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;
    await api("/budget-projects", {
      method: "POST",
      body: JSON.stringify({
        name: projName,
        target_amount: Number(projTarget),
      }),
      accessToken: session.access_token,
    });
    load();
  };

  const addMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token || !mapPattern.trim() || !mapTarget.trim()) return;
    await api("/meta/category-mappings", {
      method: "POST",
      body: JSON.stringify({
        plaid_category_pattern: mapPattern.trim(),
        budget_category: mapTarget.trim(),
      }),
      accessToken: session.access_token,
    });
    setMapPattern("");
    setMapTarget("");
    load();
  };

  const removeMapping = async (id: string) => {
    if (!session?.access_token) return;
    await api(`/meta/category-mappings/${id}`, {
      method: "DELETE",
      accessToken: session.access_token,
    });
    load();
  };

  const jumpLinkClass =
    "px-3 py-1.5 rounded-full bg-surface-container-low border border-outline-variant/20 text-on-surface-variant hover:text-primary hover:border-primary/40 transition-colors";

  return (
    <div>
      {err ? <p className="text-sm text-error mb-4">{err}</p> : null}

      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-4xl font-headline font-bold text-on-background tracking-tight">Budget Planner</h2>
          <p className="text-on-surface-variant mt-2 font-body text-sm">{monthOverviewLabel()}</p>
        </div>
        <button
          type="button"
          onClick={scrollToAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-primary text-on-primary px-4 py-2.5 text-sm font-semibold shadow-sm"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Set New Goal
        </button>
      </div>

      <nav className="flex flex-wrap gap-2 mb-10 font-body text-sm" aria-label="Jump to budget section">
        <a href="#budget-overview" className={jumpLinkClass}>
          Overview
        </a>
        <a href="#budget-categories" className={jumpLinkClass}>
          Categories
        </a>
        <a href="#budget-projects" className={jumpLinkClass}>
          Projects
        </a>
        <a href="#budget-insights" className={jumpLinkClass}>
          Insights
        </a>
        <a href="#budget-rules" className={jumpLinkClass}>
          Rules
        </a>
        <a href="#budget-add" className={jumpLinkClass}>
          Add budgets
        </a>
      </nav>

      <section id="budget-overview" className="mb-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-surface-container-lowest p-8 rounded-stitch relative overflow-hidden shadow-ambient border border-outline-variant/10">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-primary-container" />
          <div className="flex justify-between items-start mb-8">
            <div>
              <h3 className="text-on-surface-variant font-body text-sm font-medium mb-1">Total Monthly Budget</h3>
              <div className="text-4xl font-headline font-bold text-on-background tracking-tight">
                {fmt(totals.totalCap)}
              </div>
            </div>
            <div className="text-right">
              <h3 className="text-on-surface-variant font-body text-sm font-medium mb-1">Remaining</h3>
              <div className="text-2xl font-headline font-semibold text-on-tertiary-container">{fmt(totals.remaining)}</div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-xs font-body font-medium text-on-surface-variant">
              <span>{fmt(totals.totalSpent)} Spent</span>
              <span>{totals.totalCap > 0 ? Math.round(totals.pct) : 0}%</span>
            </div>
            <div className="w-full h-3 bg-surface-container-high rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-tertiary-fixed-dim to-tertiary-fixed rounded-full shadow-[0_0_10px_rgba(78,222,163,0.3)]"
                style={{ width: `${Math.min(100, totals.pct)}%` }}
              />
            </div>
            <p className="text-xs text-on-surface-variant font-body pt-2">{projectionText}</p>
          </div>
        </div>

        <div className="bg-surface-container-low p-8 rounded-stitch flex flex-col justify-center border border-outline-variant/10">
          {alertBudget ? (
            <>
              <div className="flex items-center gap-3 mb-4 text-on-secondary-fixed-variant">
                <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                  warning
                </span>
                <h4 className="font-headline font-bold text-lg">{alertBudget.category}</h4>
              </div>
              <p className="text-sm font-body text-on-surface-variant mb-6">
                You have reached about {Math.round(alertBudget.pct ?? 0)}% of your {alertBudget.category} budget with{" "}
                {daysLeft()} days left in the month.
              </p>
              <Link
                to={`/creditcards?category=${encodeURIComponent(alertBudget.category)}`}
                className="bg-secondary-container text-on-secondary-container px-4 py-2 rounded-xl font-body text-sm font-medium hover:bg-secondary-container/80 transition-colors text-center"
              >
                Review Transactions
              </Link>
            </>
          ) : (
            <p className="text-sm text-on-surface-variant font-body">No category is at 85%+ usage yet.</p>
          )}
        </div>
      </section>

      <section id="budget-categories" className="mb-12">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <h3 className="text-xl font-headline font-bold text-on-background">Category breakdown</h3>
          <button
            type="button"
            onClick={scrollToAdd}
            className="text-sm font-body font-medium text-primary hover:underline w-fit"
          >
            Add category budget
          </button>
        </div>
        {budgets.length === 0 ? (
          <p className="text-sm text-on-surface-variant font-body">Add a category in Add budgets below.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {budgets.map((b) => {
              const spent = b.spent ?? 0;
              const cap = Number(b.amount_limit);
              const pct = b.pct ?? (cap > 0 ? Math.min(100, (spent / cap) * 100) : 0);
              const remaining = b.remaining ?? Math.max(0, cap - spent);
              const low = cap > 0 && remaining / cap < 0.15;
              return (
                <div
                  key={b.id}
                  className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/10 shadow-card group hover:-translate-y-1 transition-transform duration-300"
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-on-secondary-fixed-variant">
                        <span className="material-symbols-outlined">{categoryIcon(b.category)}</span>
                      </div>
                      <h4 className="font-headline font-bold text-on-background text-lg">{b.category}</h4>
                    </div>
                    <span className="text-sm font-body font-medium text-on-surface-variant">{Math.round(pct)}%</span>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-on-surface-variant">Progress</div>
                    <div className="flex justify-between text-xs font-body">
                      <span className="text-on-background font-medium">{fmt(spent)} spent</span>
                      <span className={low ? "text-error font-medium" : "text-on-surface-variant"}>
                        {fmt(spent)} / {fmt(cap)}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${low ? "bg-secondary-fixed-variant" : "bg-primary-container"}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    {low ? (
                      <div className="text-[11px] text-secondary-fixed-variant font-medium">Nearing limit!</div>
                    ) : (
                      <div className="text-[11px] text-on-surface-variant">{fmt(remaining)} remaining</div>
                    )}
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={scrollToAdd}
                      className="rounded-lg border border-outline-variant/20 px-3 py-2 text-sm hover:bg-surface-container"
                    >
                      Edit
                    </button>
                    <Link
                      to={`/creditcards?category=${encodeURIComponent(b.category)}`}
                      className="rounded-lg border border-outline-variant/20 px-3 py-2 text-sm text-center hover:bg-surface-container"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="budget-projects" className="mb-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 border-b border-outline-variant/20 pb-4">
          <h3 className="text-xl font-headline font-bold text-on-background">Project budgets</h3>
          <button
            type="button"
            onClick={scrollToAddProject}
            className="text-sm font-body font-medium text-primary hover:underline w-fit"
          >
            Add project budget
          </button>
        </div>
        {projects.length === 0 ? (
          <p className="text-sm text-on-surface-variant font-body mb-2">No project budgets yet.</p>
        ) : (
          projects.map((p) => {
            const target = Number(p.target_amount);
            const spent = Number(p.spent_amount);
            const rows = projectSubRows(target, spent);
            return (
              <div
                key={p.id}
                className="bg-surface-container-lowest rounded-stitch p-8 border border-outline-variant/10 shadow-ambient mb-8"
              >
                <div className="flex flex-col md:flex-row gap-10">
                  <div className="md:w-1/3 flex flex-col justify-between">
                    <div>
                      <div className="inline-block px-3 py-1 rounded-full bg-surface-container-high text-xs font-medium text-on-secondary-fixed-variant mb-4 font-body">
                        Project
                      </div>
                      <h4 className="text-3xl font-headline font-bold text-on-background mb-2">{p.name}</h4>
                      <p className="text-sm font-body text-on-surface-variant leading-relaxed">
                        Dedicated savings goal. Sub-line amounts are a proportional view of progress.
                      </p>
                    </div>
                    <div className="mt-8">
                      <div className="text-sm font-body text-on-surface-variant mb-1">Total project budget</div>
                      <div className="text-2xl font-headline font-bold text-on-background">{fmt(target)}</div>
                    </div>
                  </div>
                  <div className="md:w-2/3 space-y-6">
                    {rows.map((row) => (
                      <div key={row.name} className="group">
                        <div className="flex justify-between items-end mb-2">
                          <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-on-surface-variant text-lg">{row.icon}</span>
                            <span className="font-body text-sm font-medium text-on-background">{row.name}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-body text-sm font-medium text-on-background">{fmt(row.spent)}</span>
                            <span className="font-body text-xs text-on-surface-variant ml-1">/ {fmt(row.cap)}</span>
                          </div>
                        </div>
                        <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-colors ${
                              row.pct >= 99.5
                                ? "bg-on-tertiary-container group-hover:bg-tertiary-fixed-dim"
                                : "bg-primary-container group-hover:bg-primary"
                            }`}
                            style={{ width: `${Math.min(100, row.pct)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>

      <section id="budget-insights" className="mb-12 bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/10 shadow-ambient">
        <h3 className="text-lg font-headline font-bold text-on-background">Smart goal adjuster</h3>
        <p className="text-xs text-on-surface-variant font-body mt-1 mb-3">
          Suggestions refresh automatically after account sync.
        </p>
        {goalAdjustments.length === 0 ? (
          <AiOutputEmpty message="No rebalancing suggestions yet. They appear after sync when categories are over/under target." />
        ) : (
          <ul className="space-y-2 mt-3">
            {goalAdjustments.map((a, i) => (
              <li key={`${a.from}-${a.to}-${i}`} className="text-sm font-body bg-surface-container-low rounded-lg px-3 py-2">
                Move about <strong>{fmt(a.amount)}</strong> from <strong>{a.from}</strong> to <strong>{a.to}</strong>.
                <span className="text-on-surface-variant"> {a.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details
        id="budget-rules"
        className="mb-12 bg-surface-container-lowest rounded-2xl border border-outline-variant/10 shadow-ambient open:shadow-ambient"
      >
        <summary className="cursor-pointer list-none p-6 pb-0 font-headline font-bold text-on-background flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span>Budget rules (category mapping)</span>
          <span className="material-symbols-outlined text-on-surface-variant shrink-0">expand_more</span>
        </summary>
        <div className="p-6 pt-4">
          <p className="text-sm text-on-surface-variant font-body mb-4">
            When any imported category label contains your pattern (case-insensitive), that spend rolls into the budget row
            you name here (e.g. map &quot;Food and Drink&quot; → your &quot;Groceries&quot; budget).
          </p>
          {mappings.length === 0 ? (
            <p className="text-sm text-on-surface-variant font-body mb-4">No mappings yet.</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {mappings.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm font-body bg-surface-container-low rounded-lg px-3 py-2"
                >
                  <span className="text-on-surface">
                    <code className="text-xs bg-surface-container-high px-1 rounded">{m.plaid_category_pattern}</code>
                    <span className="mx-2 text-on-surface-variant">→</span>
                    <strong>{m.budget_category}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeMapping(m.id)}
                    className="text-xs text-error hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addMapping} className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="block text-xs text-on-surface-variant mb-1">Category label contains</label>
              <input
                className="w-full rounded-xl border border-outline-variant/30 px-3 py-2 text-sm"
                value={mapPattern}
                onChange={(e) => setMapPattern(e.target.value)}
                placeholder="e.g. Food and Drink"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-on-surface-variant mb-1">Count toward budget category</label>
              <input
                className="w-full rounded-xl border border-outline-variant/30 px-3 py-2 text-sm"
                value={mapTarget}
                onChange={(e) => setMapTarget(e.target.value)}
                placeholder="e.g. Groceries"
                list="budget-category-pick-map"
              />
              <datalist id="budget-category-pick-map">
                {mergedCategoryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <button type="submit" className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-medium">
              Add mapping
            </button>
          </form>
        </div>
      </details>

      <div
        id="budget-add"
        ref={addPanelRef}
        className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-10 border-t border-outline-variant/20 mt-8 scroll-mt-24"
      >
        <div className="lg:col-span-2 flex items-center justify-between rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
          <h3 className="font-headline font-semibold text-on-background">Create budget</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAddPanelOpen(true);
                setAddTab("category");
              }}
              className={`text-sm px-3 py-1 rounded-full border transition-colors ${
                addTab === "category"
                  ? "border-primary/40 text-primary bg-primary/10"
                  : "border-outline-variant/30 text-on-surface-variant"
              }`}
            >
              Category
            </button>
            <button
              type="button"
              onClick={() => {
                setAddPanelOpen(true);
                setAddTab("project");
              }}
              className={`text-sm px-3 py-1 rounded-full border transition-colors ${
                addTab === "project"
                  ? "border-primary/40 text-primary bg-primary/10"
                  : "border-outline-variant/30 text-on-surface-variant"
              }`}
            >
              Project
            </button>
            <button
              type="button"
              onClick={() => setAddPanelOpen((v) => !v)}
              className="text-sm text-primary hover:underline"
            >
              {addPanelOpen ? "Hide forms" : "Show forms"}
            </button>
          </div>
        </div>

        {addPanelOpen ? (
        <>
        <div
          className={`bg-surface-container-lowest p-6 rounded-2xl border ${
            addTab === "category" ? "border-primary/35" : "border-outline-variant/10"
          }`}
        >
          <h3 className="font-headline font-semibold mb-4 text-on-background">Add category budget</h3>
          <form onSubmit={addBudget} className="space-y-4">
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Category</label>
              <input
                className="w-full rounded-xl border border-outline-variant/30 px-3 py-2.5 text-sm font-body bg-surface-container-lowest"
                list="budget-category-pick"
                value={cat}
                onChange={(e) => setCat(e.target.value)}
              />
              <datalist id="budget-category-pick">
                {mergedCategoryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Monthly limit</label>
              <input
                type="number"
                className="w-full rounded-xl border border-outline-variant/30 px-3 py-2.5 text-sm"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </div>
            <button type="submit" className="bg-primary text-on-primary px-6 py-3 rounded-xl text-sm font-medium">
              Save budget
            </button>
          </form>
        </div>
        <div
          className={`bg-surface-container-lowest p-6 rounded-2xl border ${
            addTab === "project" ? "border-primary/35" : "border-outline-variant/10"
          }`}
        >
          <h3 className="font-headline font-semibold mb-4 text-on-background">Add project budget</h3>
          <form onSubmit={addProject} className="space-y-4">
            <input
              id="budget-add-project-name"
              className="w-full rounded-xl border border-outline-variant/30 px-3 py-2.5 text-sm"
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
              placeholder="Project name"
              aria-label="Project name"
            />
            <input
              type="number"
              className="w-full rounded-xl border border-outline-variant/30 px-3 py-2.5 text-sm"
              value={projTarget}
              onChange={(e) => setProjTarget(e.target.value)}
              placeholder="Target amount"
              aria-label="Target amount"
            />
            <button type="submit" className="bg-primary text-on-primary px-6 py-3 rounded-xl text-sm font-medium">
              Add project
            </button>
          </form>
        </div>
        </>
        ) : (
          <p className="lg:col-span-2 text-sm text-on-surface-variant px-1">
            Use the section actions above to create a category or project budget.
          </p>
        )}
      </div>
    </div>
  );
}
