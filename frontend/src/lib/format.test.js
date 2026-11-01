import { describe, expect, it } from "vitest";
import { timeAgo } from "./format";

describe("timeAgo", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  it("reads a SQLite UTC timestamp", () => {
    expect(timeAgo("2026-11-02 11:59:30", now)).toBe("just now");
    expect(timeAgo("2026-11-02 11:55:00", now)).toBe("5 min ago");
    expect(timeAgo("2026-11-02 09:00:00", now)).toBe("3 h ago");
    expect(timeAgo("2026-10-31 12:00:00", now)).toBe("2 d ago");
  });
  it("reads ISO strings and never goes negative", () => {
    expect(timeAgo("2026-11-02T12:00:30Z", now)).toBe("just now");
  });
});
