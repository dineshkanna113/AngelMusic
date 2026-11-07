import { describe, expect, it } from "vitest";
import { annualSaving, formatPrice, isPremiumUser, monthlyEquivalent, planSummary } from "./billingMath";

describe("formatPrice", () => {
  it("formats minor units in the currency's own precision", () => {
    expect(formatPrice(499, "usd", "en-US")).toBe("$4.99");
    expect(formatPrice(4900, "jpy", "en-US")).toBe("¥4,900"); // yen has no minor unit
    expect(formatPrice(1000, "INR", "en-IN")).toBe("₹10.00");
  });
});

describe("monthlyEquivalent", () => {
  it("shows a yearly price per month and leaves monthly alone", () => {
    expect(monthlyEquivalent({ interval: "year", amount: 4800, currency: "usd" }, "en-US")).toBe("$4.00");
    expect(monthlyEquivalent({ interval: "month", amount: 499, currency: "usd" }, "en-US")).toBe("$4.99");
  });
});

describe("annualSaving", () => {
  const month = { interval: "month", amount: 500, currency: "usd" };
  it("is the real percentage saved by paying yearly", () => {
    expect(annualSaving(month, { interval: "year", amount: 4800, currency: "usd" })).toBe(20);
  });
  it("is null when yearly saves nothing or a price is missing", () => {
    expect(annualSaving(month, { interval: "year", amount: 6000, currency: "usd" })).toBeNull();
    expect(annualSaving(month, { interval: "year", amount: 7000, currency: "usd" })).toBeNull();
    expect(annualSaving(month, undefined)).toBeNull();
    expect(annualSaving(month, { interval: "year", amount: 4800, currency: "eur" })).toBeNull(); // different currency
  });
});

describe("isPremiumUser", () => {
  it("only treats an explicit false as free, so older servers keep working", () => {
    expect(isPremiumUser({ premium: true })).toBe(true);
    expect(isPremiumUser({ premium: false })).toBe(false);
    expect(isPremiumUser({})).toBe(true);
    expect(isPremiumUser(null)).toBe(true);
  });
});

describe("planSummary", () => {
  const free = { premium: false, source: "free", status: null };
  it("describes each way of having a plan", () => {
    expect(planSummary(free, "en-US")).toEqual({ title: "Free", detail: "" });
    expect(planSummary({ premium: true, source: "billing_off" }, "en-US").title).toBe("Everything unlocked");
    expect(planSummary({ premium: true, source: "comp", current_period_end: null }, "en-US").title).toBe("Premium (gift)");
    expect(planSummary({ premium: true, source: "subscription", status: "active", current_period_end: "2030-06-15 12:00:00", cancel_at_period_end: false }, "en-US"))
      .toEqual({ title: "Premium", detail: "Renews on June 15, 2030" });
    expect(planSummary({ premium: true, source: "subscription", status: "active", current_period_end: "2030-06-15 12:00:00", cancel_at_period_end: true }, "en-US").detail)
      .toBe("Ends on June 15, 2030");
    expect(planSummary({ premium: true, source: "subscription", status: "past_due", current_period_end: "2030-06-15 12:00:00" }, "en-US").detail)
      .toBe("Payment failed. Update your card to keep Premium.");
  });
});
