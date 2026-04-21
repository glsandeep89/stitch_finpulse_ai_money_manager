/** Local calendar YYYY-MM-DD (avoids UTC shift on `toISOString()`). */
export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Rolling window ending today: `days` calendar days inclusive (e.g. 30 → from is 29 days before today). */
export function presetDateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  return { from: formatLocalYmd(from), to: formatLocalYmd(to) };
}

function eachDayYmd(fromStr: string, toStr: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const cur = new Date(fy!, fm! - 1, fd!);
  const end = new Date(ty!, tm! - 1, td!);
  if (cur > end) return [];
  while (cur <= end) {
    out.push(formatLocalYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export type CashFlowPoint = { label: string; date: string; income: number; spend: number };

/** Fill every day in [from, to] so Recharts lines are continuous (API omits empty days). */
export function densifyCashFlow(
  from: string,
  to: string,
  series: { date: string; income: number; spend: number }[]
): CashFlowPoint[] {
  const map = new Map(series.map((s) => [s.date, s]));
  return eachDayYmd(from, to).map((date) => {
    const s = map.get(date);
    return {
      date,
      label: date.slice(5),
      income: s?.income ?? 0,
      spend: s?.spend ?? 0,
    };
  });
}

export function sumNetCashFlow(points: CashFlowPoint[]): number {
  return points.reduce((s, p) => s + (p.income - p.spend), 0);
}
