import type { Job } from "@shared/types.js";
import {
  CONTRACT_TYPE_LABELS,
  normalizeContractType,
} from "@shared/utils/contract.js";
import { resolveWorkMode } from "@shared/utils/workplace.js";

const WORKMODE_LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

/** Display a seniority level, capitalizing extractor values like "mid"/"entry". */
export function formatLevel(level: string | null | undefined): string | null {
  const trimmed = level?.trim();
  if (!trimmed) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Resolve a job's work mode to a display label, or null when unknown. */
export function formatWorkmode(job: Job): string | null {
  const type = resolveWorkMode(job.workFromHomeType, job.isRemote);
  return type ? WORKMODE_LABELS[type] : null;
}

/**
 * Canonicalize a raw job_type ("Full Time", "fulltime", "Vollzeit",
 * "Werkstudent") into a clean display label via the shared vocabulary, or null
 * when unrecognized — so noise never leaks through as a title-cased value.
 */
export function formatContractType(
  raw: string | null | undefined,
): string | null {
  const type = normalizeContractType(raw);
  return type ? CONTRACT_TYPE_LABELS[type] : null;
}
