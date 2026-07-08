import { describe, expect, it } from "vitest";
import { normalizePostedDate } from "./date";

describe("normalizePostedDate", () => {
  it("converts epoch-millisecond strings to ISO", () => {
    // 1782345600000 -> 2026-06-04T00:00:00.000Z
    expect(normalizePostedDate("1782345600000")).toBe(
      new Date(1782345600000).toISOString(),
    );
  });

  it("converts epoch-second strings to ISO", () => {
    expect(normalizePostedDate("1782345600")).toBe(
      new Date(1782345600000).toISOString(),
    );
  });

  it("canonicalizes ISO strings", () => {
    expect(normalizePostedDate("2026-06-18T00:00:00.000Z")).toBe(
      "2026-06-18T00:00:00.000Z",
    );
    expect(normalizePostedDate("2026-06-18")).toBe(
      new Date("2026-06-18").toISOString(),
    );
  });

  it("keeps relative/unrecognized text unchanged", () => {
    expect(normalizePostedDate("2 days ago")).toBe("2 days ago");
    expect(normalizePostedDate("yesterday")).toBe("yesterday");
  });

  it("returns null for null/empty input", () => {
    expect(normalizePostedDate(null)).toBeNull();
    expect(normalizePostedDate(undefined)).toBeNull();
    expect(normalizePostedDate("   ")).toBeNull();
  });

  it("keeps short numeric junk as-is instead of a bogus epoch", () => {
    expect(normalizePostedDate("2026")).toBe("2026");
  });
});
