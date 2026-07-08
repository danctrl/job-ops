/**
 * Post-LLM guardrails for the tailored skills section.
 *
 * The tailoring LLM SELECTS and prioritizes skills from the (full, cleaned)
 * master profile. These guardrails run on its output to guarantee correctness
 * deterministically:
 *   - anti-invention: every returned keyword must correspond to a real master
 *     skill (wording variants like "HTML" ~ "HTML5" are allowed);
 *   - dedup across the whole section;
 *   - a hard cap so the section never becomes a dump;
 *   - a floor: if the LLM returned too few (or nothing usable), backfill from
 *     the master so a CV never renders an empty/sparse skills section.
 */

import { calculateSimilarity } from "@shared/job-matching";
import type { JobBrief, ResumeProfile } from "@shared/types";
import { normalizeWhitespace } from "@shared/utils/string";

type SkillsSection = NonNullable<
  NonNullable<ResumeProfile["sections"]>["skills"]
>;
export type SkillItem = NonNullable<SkillsSection["items"]>[number];

/** A tailored skill group as returned by the LLM / rendered into the CV. */
export interface TailoredSkillGroup {
  name: string;
  keywords: string[];
}

/** Upper bound on total keywords across all groups (no dump). */
export const DEFAULT_MAX_TOTAL_KEYWORDS = 22;
/** Lower bound; below this we backfill from the master (never sparse). */
export const DEFAULT_MIN_TOTAL_KEYWORDS = 12;
/** Every master group is represented by at least this many keywords (no group nuked). */
export const DEFAULT_MIN_PER_GROUP = 1;
/** A returned keyword is considered real if it scores at least this vs a master term. */
const VALID_SIMILARITY = 70;

export interface SkillGuardrailOptions {
  maxTotal?: number;
  minTotal?: number;
  /** How many items a LOCKED ("always") group is guaranteed. */
  minPerGroup?: number;
  /** Master group ids forced to always appear ("Always" mode). */
  lockedGroupIds?: readonly string[];
  /** Master group ids removed from tailoring ("Don't select" mode). */
  excludedGroupIds?: readonly string[];
}

function normalizeTerm(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

/**
 * Flatten the job brief into a deduped set of normalized reference terms.
 * Used to hint the prompt (not for dropping).
 */
export function collectBriefTerms(
  brief: JobBrief | null | undefined,
): string[] {
  if (!brief) return [];
  const raw = [
    ...(brief.skills_and_domain_highlights ?? []),
    ...(brief.tools_mentioned ?? []),
    ...(brief.they_want ?? []),
  ];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of raw) {
    if (typeof term !== "string") continue;
    const normalized = normalizeTerm(term);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms;
}

function masterGroupName(item: SkillItem): string {
  return typeof item.name === "string" && item.name.trim()
    ? item.name
    : "Skills";
}

function masterKeywords(items: readonly SkillItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item.name === "string" && item.name.trim()) out.push(item.name);
    const kws = Array.isArray(item.keywords) ? item.keywords : [];
    for (const kw of kws) {
      if (typeof kw === "string" && kw.trim()) out.push(kw);
    }
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `needle` appears as a whole word inside `haystack`. */
function containsWord(haystack: string, needle: string): boolean {
  if (needle.length < 2) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`).test(
    haystack,
  );
}

/**
 * True if the keyword corresponds to a real master skill. Allows wording
 * variants (calculateSimilarity) and ATS dual-terms like "Kubernetes (K8s)"
 * or "Infrastructure as Code (IaC)" where a real skill appears as a word
 * inside the candidate.
 */
function isRealSkill(keyword: string, masterTerms: string[]): boolean {
  const candidate = normalizeTerm(keyword);
  if (!candidate) return false;
  for (const term of masterTerms) {
    const normalizedTerm = normalizeTerm(term);
    if (calculateSimilarity(candidate, normalizedTerm) >= VALID_SIMILARITY) {
      return true;
    }
    if (containsWord(candidate, normalizedTerm)) return true;
  }
  return false;
}

/**
 * Validate, dedup, cap and floor the LLM's selected skills against the master.
 * Returns groups ready to render. Never returns an empty list when the master
 * has skills.
 */
export function enforceSkillGuardrails(
  llmSkills: readonly TailoredSkillGroup[] | undefined | null,
  masterItems: readonly SkillItem[] | undefined | null,
  options: SkillGuardrailOptions = {},
): TailoredSkillGroup[] {
  const maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL_KEYWORDS;
  const minTotal = options.minTotal ?? DEFAULT_MIN_TOTAL_KEYWORDS;
  const minPerGroup = options.minPerGroup ?? DEFAULT_MIN_PER_GROUP;
  const lockedIds = new Set(options.lockedGroupIds ?? []);
  const excludedIds = new Set(options.excludedGroupIds ?? []);
  const allMaster = Array.isArray(masterItems) ? masterItems : [];
  // Groups in "Don't select" mode never take part in tailoring.
  const master = allMaster.filter((item) => !excludedIds.has(item.id));
  const excludedNames = new Set(
    allMaster
      .filter((item) => excludedIds.has(item.id))
      .map((item) => normalizeTerm(masterGroupName(item))),
  );
  const masterTerms = masterKeywords(master);

  const seen = new Set<string>();
  const groups: TailoredSkillGroup[] = [];
  const groupByName = new Map<string, TailoredSkillGroup>();

  const addKeyword = (groupName: string, keyword: string): boolean => {
    const key = normalizeTerm(keyword);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    let group = groupByName.get(groupName);
    if (!group) {
      group = { name: groupName, keywords: [] };
      groupByName.set(groupName, group);
      groups.push(group);
    }
    group.keywords.push(keyword);
    return true;
  };

  const totalKeywords = () =>
    groups.reduce((sum, group) => sum + group.keywords.length, 0);

  const lockedNames = new Set(
    master
      .filter((item) => lockedIds.has(item.id))
      .map((item) => normalizeTerm(masterGroupName(item))),
  );

  // 1. Take the LLM's selection, keeping only real (non-invented) skills and
  //    skipping any group the user set to "Don't select".
  for (const group of llmSkills ?? []) {
    if (!group || typeof group.name !== "string") continue;
    if (excludedNames.has(normalizeTerm(group.name))) continue;
    const kws = Array.isArray(group.keywords) ? group.keywords : [];
    for (const kw of kws) {
      if (typeof kw !== "string") continue;
      if (isRealSkill(kw, masterTerms)) addKeyword(group.name, kw);
    }
  }

  // 2. Representation: only LOCKED ("Always") groups are guaranteed to appear
  //    with at least minPerGroup items. AI-selectable groups are left to the LLM.
  for (const item of master) {
    if (!lockedIds.has(item.id)) continue;
    const name = masterGroupName(item);
    let have = groupByName.get(name)?.keywords.length ?? 0;
    if (have >= minPerGroup) continue;
    const kws = Array.isArray(item.keywords) ? item.keywords : [];
    for (const kw of kws) {
      if (have >= minPerGroup) break;
      if (typeof kw === "string" && addKeyword(name, kw)) have++;
    }
  }

  // 3. Cap: trim group tails until within maxTotal; never take a LOCKED group
  //    below minPerGroup (AI/other groups may be trimmed away entirely).
  while (totalKeywords() > maxTotal) {
    const trimable = groups
      .filter((g) => {
        const floor = lockedNames.has(normalizeTerm(g.name)) ? minPerGroup : 0;
        return g.keywords.length > floor;
      })
      .sort((a, b) => b.keywords.length - a.keywords.length)[0];
    if (!trimable) break;
    const removed = trimable.keywords.pop();
    if (removed) seen.delete(normalizeTerm(removed));
  }

  // 4. Floor: if too few survived, backfill from the master in original order.
  if (totalKeywords() < minTotal) {
    for (const item of master) {
      if (totalKeywords() >= minTotal) break;
      const name = masterGroupName(item);
      const kws = Array.isArray(item.keywords) ? item.keywords : [];
      for (const kw of kws) {
        if (totalKeywords() >= minTotal) break;
        if (typeof kw === "string") addKeyword(name, kw);
      }
    }
  }

  return groups.filter((group) => group.keywords.length > 0);
}
