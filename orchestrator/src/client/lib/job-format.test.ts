import { createJob } from "@shared/testing/factories.js";
import { describe, expect, it } from "vitest";
import { formatContractType, formatLevel, formatWorkmode } from "./job-format";

describe("formatLevel", () => {
  it("capitalizes the level and returns null when empty", () => {
    expect(formatLevel("mid")).toBe("Mid");
    expect(formatLevel("entry")).toBe("Entry");
    expect(formatLevel("Junior")).toBe("Junior");
    expect(formatLevel(null)).toBeNull();
    expect(formatLevel("  ")).toBeNull();
  });
});

describe("formatWorkmode", () => {
  it("maps the work-from-home type to a label", () => {
    expect(formatWorkmode(createJob({ workFromHomeType: "remote" }))).toBe(
      "Remote",
    );
    expect(formatWorkmode(createJob({ workFromHomeType: "hybrid" }))).toBe(
      "Hybrid",
    );
    expect(formatWorkmode(createJob({ workFromHomeType: "onsite" }))).toBe(
      "On-site",
    );
  });

  it("falls back to the isRemote flag and returns null when unknown", () => {
    expect(
      formatWorkmode(createJob({ workFromHomeType: null, isRemote: true })),
    ).toBe("Remote");
    expect(
      formatWorkmode(createJob({ workFromHomeType: null, isRemote: false })),
    ).toBeNull();
  });
});

describe("formatContractType", () => {
  it("canonicalizes messy contract strings", () => {
    expect(formatContractType("Full Time")).toBe("Full-time");
    expect(formatContractType("fulltime")).toBe("Full-time");
    expect(formatContractType("Full-Time")).toBe("Full-time");
    expect(formatContractType("internship")).toBe("Internship");
  });

  it("collapses a multi-value string to a single canonical label", () => {
    // Full-time outranks part-time when both appear.
    expect(formatContractType("Full Time, Part Time")).toBe("Full-time");
    expect(formatContractType("full-time, fulltime")).toBe("Full-time");
  });

  it("maps German employment types", () => {
    expect(formatContractType("Vollzeit")).toBe("Full-time");
    expect(formatContractType("Werkstudent")).toBe("Werkstudent");
    expect(formatContractType("Praktikum")).toBe("Internship");
  });

  it("returns null for empty or unrecognized input", () => {
    expect(formatContractType(null)).toBeNull();
    expect(formatContractType("")).toBeNull();
    expect(formatContractType("m/w/d")).toBeNull();
  });
});
