/**
 * ATS coverage score: what fraction of the job brief's must-have terms actually
 * appear in the tailored CV text (headline + summary + skills + experience).
 * A rough proxy for the "~75% keyword match" ATS guideline.
 */

import type { JobBrief } from "@shared/types";
import { normalizeWhitespace } from "@shared/utils/string";
import { collectBriefTerms } from "./skill-selection";

export interface CoverageInput {
  headline?: string | null;
  summary?: string | null;
  skills?: ReadonlyArray<{ name?: string; keywords?: string[] }> | null;
  experienceBullets?: readonly string[] | null;
}

export interface CoverageResult {
  /** 0-100, or null when the brief carries no must-have terms. */
  score: number | null;
  covered: number;
  total: number;
  missing: string[];
}

function normalize(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `term` appears as a whole word/phrase inside `haystack`. */
function containsPhrase(haystack: string, term: string): boolean {
  if (!term) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`).test(
    haystack,
  );
}

/** Significant tokens (>=3 chars) of a brief term. */
function significantTokens(term: string): string[] {
  return (term.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3);
}

/**
 * A brief term counts as covered if the whole phrase appears, OR — for
 * multi-word requirements the CV phrases differently — if most of its
 * significant tokens appear as words in the CV (e.g. "support triage" covered
 * by "triage" + "support" anywhere).
 */
function isTermCovered(haystack: string, term: string): boolean {
  if (containsPhrase(haystack, term)) return true;
  const tokens = significantTokens(term);
  if (tokens.length < 2) return false;
  const present = tokens.filter((t) => containsPhrase(haystack, t)).length;
  return present / tokens.length >= 0.6;
}

function buildCvText(input: CoverageInput): string {
  const parts: string[] = [];
  if (input.headline) parts.push(input.headline);
  if (input.summary) parts.push(input.summary);
  for (const group of input.skills ?? []) {
    if (group?.name) parts.push(group.name);
    for (const kw of group?.keywords ?? []) parts.push(kw);
  }
  for (const bullet of input.experienceBullets ?? []) parts.push(bullet);
  return normalize(parts.join(" \n "));
}

export function computeCoverage(
  brief: JobBrief | null | undefined,
  input: CoverageInput,
): CoverageResult {
  const terms = collectBriefTerms(brief);
  if (terms.length === 0) {
    return { score: null, covered: 0, total: 0, missing: [] };
  }
  const cvText = buildCvText(input);
  const missing: string[] = [];
  let covered = 0;
  for (const term of terms) {
    if (isTermCovered(cvText, term)) covered++;
    else missing.push(term);
  }
  return {
    score: Math.round((covered / terms.length) * 100),
    covered,
    total: terms.length,
    missing,
  };
}
