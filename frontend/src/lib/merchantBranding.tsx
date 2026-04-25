import { useEffect, useMemo, useState } from "react";

const LOGO_DOMAIN_BY_MERCHANT: Record<string, string> = {
  cursor: "cursor.com",
  google: "google.com",
  disney: "disneyplus.com",
  "disney plus": "disneyplus.com",
  netflix: "netflix.com",
  spotify: "spotify.com",
  hulu: "hulu.com",
  amazon: "amazon.com",
  "amazon prime": "amazon.com",
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
  "h e b grocery": "heb.com",
  "house of desi": "houseofdesi.com",
  chase: "chase.com",
  paypal: "paypal.com",
  venmo: "venmo.com",
  uber: "uber.com",
  lyft: "lyft.com",
  walmart: "walmart.com",
  target: "target.com",
  costco: "costco.com",
  starbucks: "starbucks.com",
  mcdonalds: "mcdonalds.com",
  chipotle: "chipotle.com",
  wholefoods: "wholefoodsmarket.com",
  "whole foods": "wholefoodsmarket.com",
  "trader joes": "traderjoes.com",
  kroger: "kroger.com",
  shell: "shell.com",
  chevron: "chevron.com",
  exxon: "exxon.com",
  verizon: "verizon.com",
  xfinity: "xfinity.com",
  spectrum: "spectrum.com",
  remitly: "remitly.com",
  youtube: "youtube.com",
  "youtube tv": "youtube.com",
  "apple music": "apple.com",
  microsoft: "microsoft.com",
  openai: "openai.com",
  github: "github.com",
  notion: "notion.so",
  dropbox: "dropbox.com",
  zoom: "zoom.us",
  slack: "slack.com",
  adobe: "adobe.com",
  intuit: "intuit.com",
  turbotax: "intuit.com",
  quickbooks: "intuit.com",
};

/** Longer needles first — matched against `normalizeMerchantKey` display name. */
const MERCHANT_SUBSTRING_TO_DOMAIN: { needle: string; domain: string }[] = [
  { needle: "american express", domain: "americanexpress.com" },
  { needle: "capital one", domain: "capitalone.com" },
  { needle: "bank of america", domain: "bankofamerica.com" },
  { needle: "wells fargo", domain: "wellsfargo.com" },
  { needle: "discover card", domain: "discover.com" },
  { needle: "citibank", domain: "citi.com" },
  { needle: "citi card", domain: "citi.com" },
  { needle: "goldman sachs", domain: "goldmansachs.com" },
  { needle: "marcus by", domain: "marcus.com" },
  { needle: "synchrony", domain: "synchrony.com" },
  { needle: "comcast", domain: "xfinity.com" },
  { needle: "t mobile", domain: "t-mobile.com" },
  { needle: "tmobile", domain: "t-mobile.com" },
  { needle: "foodistaan", domain: "foodistaan.com" },
  { needle: "origin financial", domain: "origin.com" },
  { needle: "disney plus", domain: "disneyplus.com" },
  { needle: "home depot", domain: "homedepot.com" },
  { needle: "whole foods", domain: "wholefoodsmarket.com" },
  { needle: "trader joe", domain: "traderjoes.com" },
  { needle: "prime video", domain: "amazon.com" },
  { needle: "amazon web", domain: "aws.amazon.com" },
  { needle: "amazon", domain: "amazon.com" },
  { needle: "netflix", domain: "netflix.com" },
  { needle: "spotify", domain: "spotify.com" },
  { needle: "hulu", domain: "hulu.com" },
  { needle: "doordash", domain: "doordash.com" },
  { needle: "grubhub", domain: "grubhub.com" },
  { needle: "uber eats", domain: "ubereats.com" },
  { needle: "youtube", domain: "youtube.com" },
  { needle: "peacock", domain: "peacocktv.com" },
  { needle: "paramount", domain: "paramountplus.com" },
  { needle: "hbo max", domain: "max.com" },
  { needle: "max stream", domain: "max.com" },
  { needle: "chase", domain: "chase.com" },
  { needle: "paypal", domain: "paypal.com" },
  { needle: "venmo", domain: "venmo.com" },
  { needle: "walmart", domain: "walmart.com" },
  { needle: "target", domain: "target.com" },
  { needle: "costco", domain: "costco.com" },
  { needle: "starbucks", domain: "starbucks.com" },
  { needle: "chipotle", domain: "chipotle.com" },
  { needle: "mcdonald", domain: "mcdonalds.com" },
  { needle: "kroger", domain: "kroger.com" },
  { needle: "heb", domain: "heb.com" },
  { needle: "cursor", domain: "cursor.com" },
  { needle: "openai", domain: "openai.com" },
  { needle: "github", domain: "github.com" },
  { needle: "notion", domain: "notion.so" },
  { needle: "zoom", domain: "zoom.us" },
  { needle: "slack", domain: "slack.com" },
  { needle: "adobe", domain: "adobe.com" },
  { needle: "verizon", domain: "verizon.com" },
  { needle: "spectrum", domain: "spectrum.com" },
  { needle: "xfinity", domain: "xfinity.com" },
  { needle: "shell", domain: "shell.com" },
  { needle: "chevron", domain: "chevron.com" },
  { needle: "exxon", domain: "exxon.com" },
  { needle: "uber", domain: "uber.com" },
  { needle: "lyft", domain: "lyft.com" },
  { needle: "google", domain: "google.com" },
  { needle: "microsoft", domain: "microsoft.com" },
  { needle: "apple", domain: "apple.com" },
  { needle: "disney", domain: "disneyplus.com" },
].sort((a, b) => b.needle.length - a.needle.length);

const LOCAL_LOGO_BY_MERCHANT: Record<string, string> = {};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `needle` appears as a whole phrase in space-delimited `key`. */
function phraseInNormalizedKey(paddedKey: string, needleNorm: string): boolean {
  const n = needleNorm.trim();
  if (!n) return false;
  const re = new RegExp(`(^|\\s)${escapeRegExp(n)}(\\s|$)`, "i");
  return re.test(paddedKey);
}

export function resolveMerchantLogoDomain(merchantName: string): string | null {
  const display = cleanDisplayMerchant(merchantName);
  const key = normalizeMerchantKey(display);
  if (!key) return null;
  const exact = LOGO_DOMAIN_BY_MERCHANT[key];
  if (exact) return exact;
  const paddedKey = ` ${key} `;
  for (const { needle, domain } of MERCHANT_SUBSTRING_TO_DOMAIN) {
    const needleNorm = normalizeMerchantKey(needle);
    if (!needleNorm) continue;
    if (phraseInNormalizedKey(paddedKey, needleNorm)) return domain;
  }
  return null;
}

function remoteLogoUrlCandidates(domain: string): string[] {
  const d = domain.trim().toLowerCase();
  if (!d) return [];
  const token =
    typeof import.meta.env.VITE_MERCHANT_LOGO_TOKEN === "string"
      ? import.meta.env.VITE_MERCHANT_LOGO_TOKEN.trim()
      : "";
  const enc = encodeURIComponent(d);
  const out: string[] = [];
  if (token) {
    out.push(`https://img.logo.dev/${d}?token=${encodeURIComponent(token)}&size=128&format=png`);
  }
  out.push(`https://www.google.com/s2/favicons?domain=${enc}&sz=128`);
  out.push(`https://icons.duckduckgo.com/ip3/${d}.ico`);
  return out;
}

/** Direct image URL if local map has a URL; otherwise null (remote chain handled in MerchantLogo). */
export function logoUrlForMerchant(merchantName: string): string | null {
  const display = cleanDisplayMerchant(merchantName);
  const key = normalizeMerchantKey(display);
  if (!key) return null;
  const local = LOCAL_LOGO_BY_MERCHANT[key];
  if (local) return local;
  const domain = resolveMerchantLogoDomain(merchantName);
  if (!domain) return null;
  const cands = remoteLogoUrlCandidates(domain);
  return cands[0] ?? null;
}

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
  const [candidateIdx, setCandidateIdx] = useState(0);
  const displayMerchant = useMemo(() => cleanDisplayMerchant(merchantName), [merchantName]);
  const key = useMemo(() => normalizeMerchantKey(displayMerchant), [displayMerchant]);
  const localUrl = useMemo(() => (key ? LOCAL_LOGO_BY_MERCHANT[key] : undefined), [key]);
  const domain = useMemo(() => resolveMerchantLogoDomain(merchantName), [merchantName]);
  const remoteUrls = useMemo(() => (domain ? remoteLogoUrlCandidates(domain) : []), [domain]);

  useEffect(() => {
    setCandidateIdx(0);
  }, [merchantName, localUrl, domain]);

  const src = localUrl ?? remoteUrls[candidateIdx] ?? null;
  const exhausted = !localUrl && remoteUrls.length > 0 && candidateIdx >= remoteUrls.length;
  const showInitials = !src || exhausted;

  if (showInitials) {
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
      src={src}
      alt={`${displayMerchant} logo`}
      className={`${sizeClass} rounded-full border border-outline-variant/30 bg-white object-cover shrink-0`}
      onError={() => {
        if (localUrl) return;
        setCandidateIdx((i) => i + 1);
      }}
      loading="lazy"
    />
  );
}
