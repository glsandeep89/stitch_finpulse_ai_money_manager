import { describe, expect, it } from "vitest";
import {
  connectionLabel,
  inferPlaidStyleAccountType,
} from "./simplifinAccountClassification.js";

describe("connectionLabel", () => {
  it("resolves org_name from matching conn_id", () => {
    const connections = [
      { conn_id: "c1", org_name: "American Express", name: "My Link", org_id: "ORG" },
    ];
    expect(connectionLabel(connections, "c1")).toBe("American Express");
  });

  it("falls back to name then org_id", () => {
    const connections = [{ conn_id: "c2", org_id: "ORG-9", name: "Chase - Jim" }];
    expect(connectionLabel(connections, "c2")).toBe("Chase - Jim");
  });

  it("returns null when conn_id is missing or unknown", () => {
    expect(connectionLabel([{ conn_id: "a", name: "x" }], undefined)).toBeNull();
    expect(connectionLabel([{ conn_id: "a", name: "x" }], "missing")).toBeNull();
  });
});

describe("inferPlaidStyleAccountType", () => {
  it("classifies high yield savings as depository", () => {
    const o = inferPlaidStyleAccountType(
      { name: "High Yield Savings Account (9569)" },
      { connectionLabel: null }
    );
    expect(o).toEqual({ type: "depository", subtype: "savings" });
  });

  it("classifies Amex Blue Cash with institution hint as credit", () => {
    const o = inferPlaidStyleAccountType(
      { name: "Blue Cash Everyday® (7008)" },
      { connectionLabel: "American Express" }
    );
    expect(o).toEqual({ type: "credit", subtype: "credit card" });
  });

  it("returns other when name and institution give no strong signal", () => {
    const o = inferPlaidStyleAccountType({ name: "General Account" }, { connectionLabel: "Some Fintech" });
    expect(o).toEqual({ type: "other", subtype: null });
  });
});
