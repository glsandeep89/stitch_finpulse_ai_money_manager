import { test, expect } from "@playwright/test";

test.describe("public shell", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/FinPulse/i);
  });
});
