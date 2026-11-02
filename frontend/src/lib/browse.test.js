import { describe, expect, it } from "vitest";
import { groupBy, newReleases } from "./browse";

const t = (id, genre, extra = {}) => ({ id, genre, has_cover: true, album_id: `a${id}`, ...extra });

describe("groupBy", () => {
  it("groups case-insensitively and keeps the most common spelling", () => {
    const groups = groupBy([t(1, "Rock"), t(2, "rock"), t(3, "Rock"), t(4, "Jazz")], "genre");
    expect(groups.map((g) => [g.label, g.count])).toEqual([["Rock", 3], ["Jazz", 1]]);
  });

  it("uses the first value of a multi-value tag", () => {
    const groups = groupBy([t(1, "Rock; Pop"), t(2, "Pop, Rock"), t(3, "Rock/Blues")], "genre");
    expect(groups.map((g) => [g.label, g.count])).toEqual([["Rock", 2], ["Pop", 1]]);
  });

  it("skips untagged tracks and returns nothing when none are tagged", () => {
    expect(groupBy([t(1, ""), t(2, "  "), t(3, undefined)], "genre")).toEqual([]);
  });

  it("orders ties alphabetically and exposes a cover and the matching tracks", () => {
    const groups = groupBy([t(1, "Soul", { has_cover: false }), t(2, "Soul"), t(3, "Blues")], "genre");
    expect(groups.map((g) => g.label)).toEqual(["Soul", "Blues"]);
    expect(groups[0].cover.id).toBe(2); // first track that has art
    expect(groups[0].tracks.map((x) => x.id)).toEqual([1, 2]);
    expect(groups[0].key).toBe("soul");
  });
});

describe("newReleases", () => {
  it("returns the most recently added albums first, capped", () => {
    const albums = [
      { id: "a", added_at: "2026-01-01 00:00:00" },
      { id: "b", added_at: "2026-03-01 00:00:00" },
      { id: "c", added_at: "2026-02-01 00:00:00" },
    ];
    expect(newReleases(albums, 2).map((a) => a.id)).toEqual(["b", "c"]);
    expect(albums.map((a) => a.id)).toEqual(["a", "b", "c"]); // input untouched
  });
});
