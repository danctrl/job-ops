import { describe, expect, it } from "vitest";
import { computeStructuralGaps, type JobStructuralFields } from "./job-gaps";

const base: JobStructuralFields = {
  jobType: null,
  workFromHomeType: null,
  isRemote: null,
  salary: null,
  salaryMinAmount: null,
  salaryMaxAmount: null,
  location: null,
  jobLevel: null,
};

describe("computeStructuralGaps", () => {
  it("flags every field when all are blank", () => {
    expect(computeStructuralGaps(base)).toEqual([
      "Salary range not stated",
      "Contract type (full-time/part-time) not specified",
      "Work mode (remote/hybrid/onsite) not specified",
      "Exact location not specified",
      "Seniority level not specified",
    ]);
  });

  it("flags no structural gaps when all fields are populated", () => {
    expect(
      computeStructuralGaps({
        jobType: "full-time",
        workFromHomeType: "remote",
        isRemote: true,
        salary: "€60k",
        salaryMinAmount: 60000,
        salaryMaxAmount: null,
        location: "Berlin",
        jobLevel: "senior",
      }),
    ).toEqual([]);
  });

  it("reported case: contract present but work mode missing IS flagged", () => {
    const gaps = computeStructuralGaps({
      ...base,
      jobType: "full-time",
      location: "Berlin",
      jobLevel: "mid",
      salaryMinAmount: 50000,
    });
    expect(gaps).toContain("Work mode (remote/hybrid/onsite) not specified");
    expect(gaps).not.toContain(
      "Contract type (full-time/part-time) not specified",
    );
  });

  it("treats isRemote=true as a resolved work mode", () => {
    const gaps = computeStructuralGaps({ ...base, isRemote: true });
    expect(gaps).not.toContain(
      "Work mode (remote/hybrid/onsite) not specified",
    );
  });

  it("treats unrecognized contract noise as missing", () => {
    const gaps = computeStructuralGaps({ ...base, jobType: "m/w/d" });
    expect(gaps).toContain("Contract type (full-time/part-time) not specified");
  });
});
