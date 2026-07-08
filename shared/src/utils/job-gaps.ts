import type { Job } from "../types/jobs";
import { normalizeContractType } from "./contract";
import { resolveWorkMode } from "./workplace";

/**
 * The subset of a Job needed to decide structural gaps. Kept narrow so the
 * function works on partial rows (e.g. a freshly imported job with no brief).
 */
export type JobStructuralFields = Pick<
  Job,
  | "jobType"
  | "workFromHomeType"
  | "isRemote"
  | "salary"
  | "salaryMinAmount"
  | "salaryMaxAmount"
  | "location"
  | "jobLevel"
>;

/** Fixed labels + display order for the structural half of "Missing or unclear". */
const STRUCTURAL_GAP_LABELS = {
  salary: "Salary range not stated",
  contract: "Contract type (full-time/part-time) not specified",
  workMode: "Work mode (remote/hybrid/onsite) not specified",
  location: "Exact location not specified",
  seniority: "Seniority level not specified",
} as const;

const isBlank = (value: string | null | undefined): boolean =>
  value == null || value.trim() === "";

/**
 * Derive the structural "Missing or unclear" gaps from the SAME canonical row
 * fields the UI displays — so the gap list and the shown values can never
 * disagree, and gaps appear even for jobs that were never LLM-extracted. The
 * LLM/brief supplies only the content gaps, appended after these.
 */
export function computeStructuralGaps(job: JobStructuralFields): string[] {
  const gaps: string[] = [];

  const hasSalary =
    job.salaryMinAmount != null ||
    job.salaryMaxAmount != null ||
    !isBlank(job.salary);
  if (!hasSalary) gaps.push(STRUCTURAL_GAP_LABELS.salary);

  if (normalizeContractType(job.jobType) === null) {
    gaps.push(STRUCTURAL_GAP_LABELS.contract);
  }

  if (resolveWorkMode(job.workFromHomeType, job.isRemote) === null) {
    gaps.push(STRUCTURAL_GAP_LABELS.workMode);
  }

  if (isBlank(job.location)) gaps.push(STRUCTURAL_GAP_LABELS.location);

  if (isBlank(job.jobLevel)) gaps.push(STRUCTURAL_GAP_LABELS.seniority);

  return gaps;
}
