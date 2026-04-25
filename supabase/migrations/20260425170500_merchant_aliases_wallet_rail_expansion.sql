-- Expand merchant alias coverage for wallet-rail descriptors and high-frequency uncategorized rows
insert into finpulse.merchant_aliases (merchant_pattern, match_type, canonical_merchant, default_category, priority)
values
  ('sampay\\*?\\s*h[\\s\\-]*e[\\s\\-]*b', 'regex', 'H-E-B', 'Groceries', 1),
  ('samsung\\s*pay\\s*h[\\s\\-]*e[\\s\\-]*b', 'regex', 'H-E-B', 'Groceries', 1),
  ('apple\\s*pay\\s*h[\\s\\-]*e[\\s\\-]*b', 'regex', 'H-E-B', 'Groceries', 1),
  ('google\\s*pay\\s*h[\\s\\-]*e[\\s\\-]*b', 'regex', 'H-E-B', 'Groceries', 1),
  ('h[\\s\\-]*e[\\s\\-]*b', 'regex', 'H-E-B', 'Groceries', 2),
  ('house of desi', 'exact', 'House of Desi', 'Restaurants', 2),
  ('remitly', 'exact', 'Remitly', 'Transfer', 2),
  ('origin financial', 'exact', 'Origin Financial', 'Financial Fees', 2)
on conflict (merchant_pattern, match_type) do update
set canonical_merchant = excluded.canonical_merchant,
    default_category = excluded.default_category,
    priority = excluded.priority,
    active = true;
