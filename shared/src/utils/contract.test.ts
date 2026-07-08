import { describe, expect, it } from "vitest";
import { formatContractType, normalizeContractType } from "./contract";

describe("normalizeContractType", () => {
  it("maps English variants", () => {
    expect(normalizeContractType("Full-Time")).toBe("full-time");
    expect(normalizeContractType("fulltime")).toBe("full-time");
    expect(normalizeContractType("Full Time")).toBe("full-time");
    expect(normalizeContractType("part-time")).toBe("part-time");
    expect(normalizeContractType("Internship")).toBe("internship");
    expect(normalizeContractType("Freelance")).toBe("freelance");
    expect(normalizeContractType("Contractor")).toBe("freelance");
    expect(normalizeContractType("Contract")).toBe("temporary");
    expect(normalizeContractType("Permanent")).toBe("permanent");
  });

  it("maps German variants", () => {
    expect(normalizeContractType("Vollzeit")).toBe("full-time");
    expect(normalizeContractType("Teilzeit")).toBe("part-time");
    expect(normalizeContractType("Werkstudent")).toBe("working-student");
    expect(normalizeContractType("Werkstudentin")).toBe("working-student");
    expect(normalizeContractType("Praktikum")).toBe("internship");
    expect(normalizeContractType("Ausbildung")).toBe("apprenticeship");
    expect(normalizeContractType("Duales Studium")).toBe("apprenticeship");
    expect(normalizeContractType("Festanstellung")).toBe("permanent");
    expect(normalizeContractType("unbefristet")).toBe("permanent");
    expect(normalizeContractType("befristet")).toBe("temporary");
    expect(normalizeContractType("Freiberuflich")).toBe("freelance");
  });

  it("applies priority: specific role beats generic time, time beats duration", () => {
    // Werkstudent wins over the parenthetical Teilzeit.
    expect(normalizeContractType("Werkstudent (Teilzeit)")).toBe(
      "working-student",
    );
    // Vollzeit (time) wins over Festanstellung (duration).
    expect(normalizeContractType("Vollzeit, Festanstellung")).toBe("full-time");
  });

  it("returns null for noise / unknown", () => {
    expect(normalizeContractType("")).toBeNull();
    expect(normalizeContractType(null)).toBeNull();
    expect(normalizeContractType(undefined)).toBeNull();
    expect(normalizeContractType("Software Engineer")).toBeNull();
    expect(normalizeContractType("m/w/d")).toBeNull();
  });
});

describe("formatContractType", () => {
  it("returns clean labels or null", () => {
    expect(formatContractType("vollzeit")).toBe("Full-time");
    expect(formatContractType("Werkstudent")).toBe("Werkstudent");
    expect(formatContractType("garbage")).toBeNull();
  });
});
