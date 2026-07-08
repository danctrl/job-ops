import { describe, expect, it } from "vitest";
import { parseSalary } from "./salary";

describe("parseSalary", () => {
  it("parses English ranges with thousands separators", () => {
    expect(parseSalary("€60,000 – €70,000 per year")).toEqual({
      text: "€60,000 – €70,000 per year",
      min: 60000,
      max: 70000,
      currency: "EUR",
      period: "year",
    });
  });

  it("parses k-suffixed ranges", () => {
    expect(parseSalary("60-70k EUR")).toMatchObject({
      min: 60000,
      max: 70000,
      currency: "EUR",
    });
  });

  it("parses German thousands + 'ab' floor", () => {
    expect(parseSalary("ab 55.000 € brutto / Jahr")).toMatchObject({
      min: 55000,
      max: null,
      currency: "EUR",
      period: "year",
    });
  });

  it("parses hourly with currency", () => {
    expect(parseSalary("40 €/h")).toMatchObject({
      min: null,
      max: 40,
      currency: "EUR",
      period: "hour",
    });
  });

  it("parses GBP and USD symbols", () => {
    expect(parseSalary("£45,000")).toMatchObject({
      max: 45000,
      currency: "GBP",
    });
    expect(parseSalary("$120,000/year")).toMatchObject({
      max: 120000,
      currency: "USD",
      period: "year",
    });
  });

  it("keeps text but nulls numbers when no amount present", () => {
    expect(parseSalary("competitive salary")).toEqual({
      text: "competitive salary",
      min: null,
      max: null,
      currency: null,
      period: null,
    });
  });

  it("returns null for empty input", () => {
    expect(parseSalary("")).toBeNull();
    expect(parseSalary(null)).toBeNull();
    expect(parseSalary(undefined)).toBeNull();
  });
});
