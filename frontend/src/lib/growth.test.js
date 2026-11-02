import { describe, expect, it } from "vitest";
import { chartPoints, countdownParts, parseUtc } from "./growth";

const NOW = Date.parse("2030-01-01T00:00:00Z");

describe("parseUtc", () => {
  it("reads ISO and SQLite timestamps as UTC", () => {
    expect(parseUtc("2030-01-02T00:00:00Z")).toBe(Date.parse("2030-01-02T00:00:00Z"));
    expect(parseUtc("2030-01-02 00:00:00")).toBe(Date.parse("2030-01-02T00:00:00Z"));
    expect(parseUtc("2030-01-02T05:30:00+05:30")).toBe(Date.parse("2030-01-02T00:00:00Z"));
  });
});

describe("countdownParts", () => {
  it("splits the time left into days, hours, minutes and seconds", () => {
    expect(countdownParts("2030-01-03T04:05:06Z", NOW)).toEqual({ done: false, days: 2, hours: 4, minutes: 5, seconds: 6 });
  });
  it("is done, never negative, once the time has passed", () => {
    expect(countdownParts("2029-12-31T23:59:59Z", NOW)).toEqual({ done: true, days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(countdownParts("2030-01-01T00:00:00Z", NOW).done).toBe(true);
  });
  it("accepts the SQLite format", () => {
    expect(countdownParts("2030-01-01 00:01:00", NOW)).toMatchObject({ done: false, minutes: 1, seconds: 0 });
  });
});

describe("chartPoints", () => {
  const series = [{ date: "2030-01-01", plays: 0 }, { date: "2030-01-02", plays: 4 }, { date: "2030-01-03", plays: 2 }];
  it("scales to the largest day, with zero at the bottom", () => {
    const { points, max } = chartPoints(series, 200, 100, 0);
    expect(max).toBe(4);
    expect(points.map((p) => [p.x, p.y])).toEqual([[0, 100], [100, 0], [200, 50]]);
  });
  it("draws a flat line when nothing was played, and handles one day", () => {
    expect(chartPoints([{ date: "d", plays: 0 }, { date: "e", plays: 0 }], 100, 50, 0).points.map((p) => p.y)).toEqual([50, 50]);
    expect(chartPoints([{ date: "d", plays: 3 }], 100, 50, 0).points).toHaveLength(1);
  });
});
