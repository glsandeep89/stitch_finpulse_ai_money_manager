/**
 * Map SimpleFIN accounts (no standard account "kind" in the protocol) to Plaid-style
 * type/subtype for linked_accounts and downstream credit/depository logic.
 */

export type SimplefinConnection = {
  conn_id: string;
  name?: string;
  org_id?: string;
  org_name?: string;
  org_url?: string;
  sfin_url?: string;
};

export type PlaidStyleClassification = {
  type: string;
  subtype: string | null;
};

type AccountLike = {
  name?: string;
  extra?: Record<string, unknown>;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

/**
 * Resolves a display / hint string from the Account Set's `connections` and the account's `conn_id`
 * (SimpleFIN v2). Prefer org_name, then connection name, then org_id.
 */
export function connectionLabel(
  connections: SimplefinConnection[] | undefined,
  connId: string | undefined
): string | null {
  if (!connId?.trim() || !connections?.length) return null;
  const c = connections.find((x) => x.conn_id === connId);
  if (!c) return null;
  const o = c.org_name?.trim();
  if (o) return o;
  const n = c.name?.trim();
  if (n) return n;
  const id = c.org_id?.trim();
  return id || null;
}

function stringFromExtra(extra: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!extra) return null;
  for (const k of keys) {
    const v = extra[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Known card-issuer / network hints in org or connection name (lowercase). */
function institutionSuggestsCreditCard(inst: string): boolean {
  return (
    /\b(american express|amex|discover|synchrony|barclay|barclays|mastercard|visa)\b/.test(inst) ||
    inst.startsWith("amex")
  );
}

/**
 * Heuristic classification. Order: optional extra hints, depository by name, explicit credit, loan, institution-based credit.
 */
export function inferPlaidStyleAccountType(
  acc: AccountLike,
  options?: { connectionLabel?: string | null }
): PlaidStyleClassification {
  const name = (acc.name ?? "").trim();
  const n = name.toLowerCase();
  const inst = norm(options?.connectionLabel);
  const extra = acc.extra;

  const productHint = stringFromExtra(extra, ["account-type", "account_type", "product", "account_type_name"]);
  if (productHint) {
    const p = productHint.toLowerCase();
    if (/\b(savings|save)\b/.test(p)) return { type: "depository", subtype: "savings" };
    if (/\b(checking|check)\b/.test(p)) return { type: "depository", subtype: "checking" };
    if (/\b(credit|card)\b/.test(p)) return { type: "credit", subtype: "credit card" };
    if (/\b(mortgage|loan|line of credit|loc|heloc)\b/.test(p)) {
      if (/\b(line of credit|loc|heloc)\b/.test(p)) return { type: "credit", subtype: "line of credit" };
      return { type: "loan", subtype: "loan" };
    }
  }

  // Depository — must run before generic "card" or institution-based heuristics
  if (
    /\b(savings|high yield|hysa|high-yield|money market|mmf)\b/.test(n) ||
    (/\b(cash|reserve|performance)\b/.test(n) && /\b(savings|saving|bank)\b/.test(n))
  ) {
    return { type: "depository", subtype: "savings" };
  }
  if (/\b(checking|check'g|chequing|debit)\b/.test(n)) {
    return { type: "depository", subtype: "checking" };
  }
  if (/\b(certificate of deposit|(^|\s)cd(\s|\(|$)|\bshare certificate)\b/.test(n)) {
    return { type: "depository", subtype: "cd" };
  }
  if (/\b(cash management|brokerage cash|settlement fund|sweep)\b/.test(n)) {
    return { type: "depository", subtype: "cash management" };
  }
  if (/\bmoney market\b/.test(n)) {
    return { type: "depository", subtype: "money market" };
  }

  // Credit — name signals
  if (/\b(credit card|cardmember|charge card|rewards card|world elite|mastercard|visa|discover|diners|platinum card)\b/.test(n)) {
    return { type: "credit", subtype: "credit card" };
  }
  if (/\b(american express|amex)\b/.test(n) && !/\b(savings|checking)\b/.test(n)) {
    return { type: "credit", subtype: "credit card" };
  }
  if (/\b(sapphire|strata|venture x|aer|delta skymiles|skymiles|hilton honors|bonvoy|freedom|quicksilver)\b/.test(n)) {
    if (!/\b(savings|checking|money market)\b/.test(n)) {
      return { type: "credit", subtype: "credit card" };
    }
  }
  if (/\b(blue cash|platinum|gold card|green card|everyday)\b/.test(n) && institutionSuggestsCreditCard(inst)) {
    if (!/\b(savings|checking)\b/.test(n)) {
      return { type: "credit", subtype: "credit card" };
    }
  }
  if (/[®™]/.test(name) && institutionSuggestsCreditCard(inst) && !/\b(savings|checking|money market|cd)\b/.test(n)) {
    return { type: "credit", subtype: "credit card" };
  }

  // Amex/Discover-typical org + ambiguous product (e.g. "Blue Cash Everyday®")
  if (inst && institutionSuggestsCreditCard(inst) && !/\b(savings|checking|money market|cd|mortgage|loan|line of credit)\b/.test(n)) {
    if (inst.includes("american express") || inst.includes("amex") || inst.includes("discover")) {
      return { type: "credit", subtype: "credit card" };
    }
  }

  if (/\b(heloc|home equity|line of credit|credit line)\b/.test(n)) {
    return { type: "credit", subtype: "line of credit" };
  }
  if (/\b(mortgage|auto loan|car loan|personal loan|student loan)\b/.test(n)) {
    return { type: "loan", subtype: "loan" };
  }

  return { type: "other", subtype: null };
}
