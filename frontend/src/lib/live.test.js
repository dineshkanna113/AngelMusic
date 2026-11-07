import { describe, expect, it } from "vitest";
import { formatListening, reasonText, rewindPeriods } from "./live";

describe("formatListening", () => {
  it("writes minutes under an hour and hours with minutes above it", () => {
    expect(formatListening(0)).toBe("0 min");
    expect(formatListening(59)).toBe("1 min");
    expect(formatListening(25 * 60)).toBe("25 min");
    expect(formatListening(60 * 60)).toBe("1 h");
    expect(formatListening(125 * 60)).toBe("2 h 5 min");
  });
});

describe("rewindPeriods", () => {
  it("offers this month, last month, this year and last year", () => {
    const list = rewindPeriods(new Date(Date.UTC(2026, 0, 15)));
    expect(list.map(([value]) => value)).toEqual(["month", "2025-12", "year", "2025"]);
    expect(list.map(([, label]) => label)).toEqual(["This month", "December 2025", "This year", "2025"]);
  });
  it("handles a mid-year month", () => {
    expect(rewindPeriods(new Date(Date.UTC(2026, 6, 1)))[1]).toEqual(["2026-06", "June 2026"]);
  });
});

describe("reasonText", () => {
  it("explains each kind of pick", () => {
    expect(reasonText({ kind: "listeners", because: "Manasilaayo" })).toBe("Listeners who play Manasilaayo also play this");
    expect(reasonText({ kind: "taste", because: "Lana Del Rey" })).toBe("More like Lana Del Rey");
    expect(reasonText({ kind: "popular", because: "" })).toBe("Popular on Yaapu right now");
    expect(reasonText(undefined)).toBe("");
  });
});
