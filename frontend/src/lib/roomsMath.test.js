import { describe, expect, it } from "vitest";
import { clockOffset, isHeartbeat, needsSeek, positionAt, roomSocketUrl } from "./roomsMath";

describe("positionAt", () => {
  it("holds still while paused", () => {
    expect(positionAt({ position: 30, playing: false, server_time: 100 }, 160)).toBe(30);
  });
  it("advances by the time since the server stamped the state", () => {
    expect(positionAt({ position: 30, playing: true, server_time: 100 }, 104.5)).toBe(34.5);
  });
  it("never goes backwards when clocks disagree", () => {
    expect(positionAt({ position: 30, playing: true, server_time: 100 }, 99)).toBe(30);
  });
});

describe("clockOffset", () => {
  it("is the server clock minus the local clock, in seconds", () => {
    expect(clockOffset(1000, 990_000)).toBe(10);
  });
});

describe("needsSeek", () => {
  it("tolerates small drift and corrects big drift", () => {
    expect(needsSeek(10, 11.2)).toBe(false);
    expect(needsSeek(10, 8.4)).toBe(true);
    expect(needsSeek(10, 11.6, 2)).toBe(false);
  });
});

describe("isHeartbeat", () => {
  it("is a sync that repeats the track and play state already applied", () => {
    const applied = { track_id: "a", playing: true };
    expect(isHeartbeat(applied, { track_id: "a", playing: true })).toBe(true);
    expect(isHeartbeat(applied, { track_id: "b", playing: true })).toBe(false);
    expect(isHeartbeat(applied, { track_id: "a", playing: false })).toBe(false);
    expect(isHeartbeat(null, { track_id: "a", playing: true })).toBe(false);
  });
});

describe("roomSocketUrl", () => {
  it("follows the page's scheme when there is no API base", () => {
    expect(roomSocketUrl("", "ab12cd", { protocol: "https:", host: "yaapu.app" })).toBe("wss://yaapu.app/api/rooms/AB12CD/ws");
    expect(roomSocketUrl("", "ab12cd", { protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/api/rooms/AB12CD/ws");
  });
  it("uses an explicit API base", () => {
    expect(roomSocketUrl("https://api.yaapu.app", "ab12cd", { protocol: "http:", host: "x" })).toBe("wss://api.yaapu.app/api/rooms/AB12CD/ws");
  });
});
