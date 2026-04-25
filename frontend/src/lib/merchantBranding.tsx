import { useMemo, useState } from "react";

const LOGO_DOMAIN_BY_MERCHANT: Record<string, string> = {
  cursor: "cursor.com",
  google: "google.com",
  disney: "disneyplus.com",
  "disney plus": "disneyplus.com",
  netflix: "netflix.com",
  spotify: "spotify.com",
  hulu: "hulu.com",
  amazon: "amazon.com",
  doordash: "doordash.com",
  optimum: "optimum.net",
  "at&t": "att.com",
  atandt: "att.com",
  "home depot": "homedepot.com",
  "real green service": "trugreen.com",
  "signature pest management": "signaturepest.com",
  "pedernales electric cooperative": "pec.coop",
  "h e b": "heb.com",
  heb: "heb.com",
  "house of desi": "houseofdesi.com",
};

const LOCAL_LOGO_BY_MERCHANT: Record<string, string> = {};

export function normalizeMerchantKey(name: string | null | undefined) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanDisplayMerchant(name: string | null | undefined): string {
  const source = String(name ?? "").trim();
  if (!source) return "Unknown";
  const cleaned = source
    .replace(/\b(rock|johnson|cedar|burbank|park|city|serviittle|leander)\b/gi, " ")
    .replace(/\b(tx|ca|ar|ny|nj|fl|il|oh|wa|pa|co)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || source;
}

export function merchantInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

export function logoUrlForMerchant(merchantName: string): string | null {
  const key = normalizeMerchantKey(merchantName);
  if (!key) return null;
  const local = LOCAL_LOGO_BY_MERCHANT[key];
  if (local) return local;
  const domain = LOGO_DOMAIN_BY_MERCHANT[key];
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}

export function walletRailLabelFromMetadata(value: unknown): string | null {
  const rail = String(value ?? "").trim().toLowerCase();
  if (!rail) return null;
  if (rail.includes("samsung")) return "Samsung Pay";
  if (rail.includes("apple")) return "Apple Pay";
  if (rail.includes("google")) return "Google Pay";
  return null;
}

export function MerchantLogo({
  merchantName,
  sizeClass = "h-8 w-8",
}: {
  merchantName: string;
  sizeClass?: string;
}) {
  const [failed, setFailed] = useState(false);
  const displayMerchant = useMemo(() => cleanDisplayMerchant(merchantName), [merchantName]);
  const logoUrl = useMemo(() => logoUrlForMerchant(displayMerchant), [displayMerchant]);
  if (!logoUrl || failed) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-surface-container text-primary text-xs font-semibold flex items-center justify-center shrink-0`}
      >
        {merchantInitials(displayMerchant)}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt={`${displayMerchant} logo`}
      className={`${sizeClass} rounded-full border border-outline-variant/30 bg-white object-cover shrink-0`}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}
