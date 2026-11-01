import { describe, expect, it } from "vitest";
import { wrapLines } from "./sharecard";

// 10 px per character keeps the arithmetic obvious.
const measure = (s) => s.length * 10;

describe("wrapLines", () => {
  it("keeps short text on one line", () => {
    expect(wrapLines(measure, "Manasilaayo", 400, 2)).toEqual(["Manasilaayo"]);
  });

  it("wraps at word boundaries", () => {
    expect(wrapLines(measure, "Chemtrails Over The Country Club", 200, 3)).toEqual(["Chemtrails Over The", "Country Club"]);
  });

  it("ends the last allowed line with an ellipsis when text overflows", () => {
    const lines = wrapLines(measure, "one two three four five six seven", 100, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(measure(lines[1])).toBeLessThanOrEqual(100);
  });

  it("cuts a single word longer than the line", () => {
    const [line] = wrapLines(measure, "Supercalifragilistic", 100, 1);
    expect(line.endsWith("…")).toBe(true);
    expect(measure(line)).toBeLessThanOrEqual(100);
  });

  it("returns nothing for empty text", () => {
    expect(wrapLines(measure, "   ", 100, 2)).toEqual([]);
  });
});
