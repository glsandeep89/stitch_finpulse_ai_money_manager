import { describe, expect, it } from "vitest";
import {
  cardmemberYearWindow,
  categoryKeyForRecommendation,
  profileRateForCategory,
  type CreditCardRewardsProfileRow,
} from "./dataService.js";

describe("rewards helpers", () => {
  it("maps merchant text to recommendation category", () => {
    expect(categoryKeyForRecommendation("Whole Foods Market")).toBe("grocery");
    expect(categoryKeyForRecommendation("Shell Station")).toBe("gas");
    expect(categoryKeyForRecommendation("Unknown Shop")).toBe("shopping");
  });

  it("computes current cardmember window anchored by start month/day", () => {
    const out = cardmemberYearWindow(8, 15, new Date("2026-04-21T00:00:00Z"));
    expect(out.start).toBe("2025-08-15");
    expect(out.end).toBe("2026-08-14");
  });

  it("uses category rate when present and base otherwise", () => {
    const profile = {
      id: "1",
      user_id: "u1",
      plaid_account_id: "a1",
      card_name: "Test Card",
      issuer: null,
      program: null,
      annual_fee: 95,
      cardmember_year_start_month: 1,
      cardmember_year_start_day: 1,
      points_cpp: 0.01,
      base_rate: 0.01,
      category_rates: { grocery: 0.03 },
      issuer_credits: [],
      enrichment_status: "ready",
      enrichment_source: "test",
      enrichment_error: null,
      last_enriched_at: null,
      updated_at: "2026-04-21T00:00:00Z",
    } satisfies CreditCardRewardsProfileRow;

    expect(profileRateForCategory(profile, "grocery")).toBe(0.03);
    expect(profileRateForCategory(profile, "travel")).toBe(0.01);
  });
});
