/**
 * Canonical contract (employment) type. Single source of vocabulary shared by
 * both ingestion paths (scraper + manual add), the LLM extraction validator,
 * and the client display — so a job never shows one value while the "Missing or
 * unclear" list disagrees. Unknown input normalizes to `null`, which surfaces as
 * an explicit "not specified" gap rather than leaking raw noise.
 */
export type ContractType =
  | "full-time"
  | "part-time"
  | "freelance"
  | "internship"
  | "working-student"
  | "apprenticeship"
  | "temporary"
  | "permanent";

/** The canonical set, for validating LLM/enum output server-side. */
export const CONTRACT_TYPES: ReadonlySet<ContractType> = new Set<ContractType>([
  "full-time",
  "part-time",
  "freelance",
  "internship",
  "working-student",
  "apprenticeship",
  "temporary",
  "permanent",
]);

/** Human-readable label per canonical type, for UI display. */
export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  freelance: "Freelance",
  internship: "Internship",
  "working-student": "Werkstudent",
  apprenticeship: "Apprenticeship",
  temporary: "Temporary",
  permanent: "Permanent",
};

/**
 * Priority-ordered EN + DE patterns. First match wins, so more specific role
 * types (apprenticeship, working-student, internship) are checked before the
 * generic full-/part-time, and employment-duration signals (temporary,
 * permanent) come last — e.g. "Vollzeit, Festanstellung" → full-time, bare
 * "Festanstellung" → permanent. Tested against the whole, lowercased string.
 */
const CONTRACT_PATTERNS: ReadonlyArray<readonly [ContractType, RegExp]> = [
  [
    "apprenticeship",
    /ausbildung|auszubildende|azubi|apprentice(?:ship)?|duales?\s+studium|dual\s+study/,
  ],
  [
    "working-student",
    /werkstudent(?:in)?|working[\s-]*student|studentische\s+hilfskraft|studentenjob/,
  ],
  ["internship", /praktik(?:um|ant(?:in)?)|internship|\bintern\b|trainee/],
  [
    "freelance",
    /freelanc\w*|freiberuflich|selbst[aä]ndig|self[\s-]*employed|contractor\b|contract\s+work/,
  ],
  ["full-time", /full[\s-]*time|vollzeit|\bft\b/],
  ["part-time", /part[\s-]*time|teilzeit|minijob|geringf[üu]gig/],
  [
    "temporary",
    /tempor[aä]r\w*|\bbefristet\b|fixed[\s-]*term|zeitarbeit|interim|seasonal|\bcontract\b/,
  ],
  ["permanent", /permanent|unbefristet|festanstellung|festvertrag/],
];

/**
 * Map a raw contract/employment-type string (EN or DE, any casing/separators,
 * possibly multi-valued like "Full Time, Part Time" or "Werkstudent (Teilzeit)")
 * to a single canonical `ContractType`, or `null` when nothing is recognized.
 */
export function normalizeContractType(
  raw: string | null | undefined,
): ContractType | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return null;
  for (const [type, pattern] of CONTRACT_PATTERNS) {
    if (pattern.test(normalized)) return type;
  }
  return null;
}

/** Display label for a raw contract value, or null when unrecognized. */
export function formatContractType(
  raw: string | null | undefined,
): string | null {
  const type = normalizeContractType(raw);
  return type ? CONTRACT_TYPE_LABELS[type] : null;
}
