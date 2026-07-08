import { describe, expect, it } from "vitest";
import {
  canonicalWorkplaceToken,
  normalizeWorkplaceType,
  stripWorkplaceFromLocation,
} from "./workplace";

describe("canonicalWorkplaceToken", () => {
  it("maps variants to canonical types", () => {
    expect(canonicalWorkplaceToken("Remote")).toBe("remote");
    expect(canonicalWorkplaceToken("home office")).toBe("remote");
    expect(canonicalWorkplaceToken("On-site")).toBe("onsite");
    expect(canonicalWorkplaceToken("vor ort")).toBe("onsite");
    expect(canonicalWorkplaceToken("Hybrid")).toBe("hybrid");
    expect(canonicalWorkplaceToken("Berlin")).toBeNull();
  });
});

describe("normalizeWorkplaceType (collapse rule)", () => {
  it("hybrid wins", () => {
    expect(normalizeWorkplaceType(["remote", "hybrid"])).toBe("hybrid");
  });
  it("remote + onsite collapses to hybrid", () => {
    expect(normalizeWorkplaceType(["remote", "on-site"])).toBe("hybrid");
  });
  it("single type passes through", () => {
    expect(normalizeWorkplaceType(["remote"])).toBe("remote");
    expect(normalizeWorkplaceType(["onsite"])).toBe("onsite");
  });
  it("returns null when no workplace signal", () => {
    expect(normalizeWorkplaceType([null, "Berlin", undefined])).toBeNull();
  });
});

describe("stripWorkplaceFromLocation", () => {
  it("splits pipe-separated workplace from the place", () => {
    expect(stripWorkplaceFromLocation("Berlin, Germany | On-site")).toEqual({
      location: "Berlin, Germany",
      workplaceType: "onsite",
    });
    expect(stripWorkplaceFromLocation("Germany | Remote")).toEqual({
      location: "Germany",
      workplaceType: "remote",
    });
  });

  it("collapses multiple workplace segments", () => {
    expect(
      stripWorkplaceFromLocation("Berlin, Germany | Remote | On-site"),
    ).toEqual({ location: "Berlin, Germany", workplaceType: "hybrid" });
  });

  it("handles comma-joined and parenthetical workplace", () => {
    expect(stripWorkplaceFromLocation("Berlin, Remote")).toEqual({
      location: "Berlin, Germany",
      workplaceType: "remote",
    });
    expect(stripWorkplaceFromLocation("Remote (Ireland)")).toEqual({
      location: "Ireland",
      workplaceType: "remote",
    });
    expect(stripWorkplaceFromLocation("Poland (Remote)")).toEqual({
      location: "Poland",
      workplaceType: "remote",
    });
    expect(stripWorkplaceFromLocation("Berlin (hybrid)")).toEqual({
      location: "Berlin, Germany",
      workplaceType: "hybrid",
    });
  });

  it("leaves a plain location untouched and returns null type", () => {
    expect(stripWorkplaceFromLocation("Berlin, Germany")).toEqual({
      location: "Berlin, Germany",
      workplaceType: null,
    });
  });

  it("dedupes while stripping", () => {
    expect(
      stripWorkplaceFromLocation("Berlin, Berlin, Germany | Remote"),
    ).toEqual({ location: "Berlin, Germany", workplaceType: "remote" });
  });
});
