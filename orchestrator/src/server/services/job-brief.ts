import { logger } from "@infra/logger";
import type { Job, JobBrief, UpdateJobInput } from "@shared/types";
import { normalizeContractType } from "@shared/utils/contract";
import { parseSalary } from "@shared/utils/salary";
import { normalizeWorkplaceType } from "@shared/utils/workplace";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";

/**
 * Structured job metadata extracted alongside the highlights. Each attribute
 * here is deliberately kept OUT of the highlight arrays (strict one-category
 * rule) and is merged back onto the Job row so both ingestion paths (scraper +
 * manual add) converge on the same schema vocabulary.
 */
export interface StructuredExtraction {
  company_name: string | null;
  location: string | null;
  work_mode: string | null;
  contract_type: string | null;
  seniority_level: string | null;
  salary_range: string | null;
}

export interface JobExtraction {
  jobBrief: string;
  structured: StructuredExtraction;
}

type RawExtraction = JobBrief & { structured?: Partial<StructuredExtraction> };

const SENIORITY_LEVELS = new Set(["entry", "mid", "senior", "lead"]);

// Drops LLM content gaps that restate a structural attribute — those are
// derived from the canonical job fields on the client (computeStructuralGaps),
// so an LLM copy would duplicate them.
const STRUCTURAL_GAP_PATTERN =
  /\b(salary|salaries|compensation|pay|wage|remuneration|contract type|full[- ]?time|part[- ]?time|fixed[- ]?term|permanent|freelance|internship|remote|hybrid|on[- ]?site|work mode|workplace|location|city|seniority|years? of experience|experience level)\b/i;

/**
 * Return only the LLM's CONTENT gaps, dropping anything that restates a
 * structural attribute (salary/contract/work mode/location/seniority). Those
 * structural gaps are derived from the canonical job row on the client, so the
 * gap list and the displayed field values share one source and cannot diverge.
 */
function buildMissingOrUnclear(llmContentGaps: string[]): string[] {
  return llmContentGaps.filter((gap) => !STRUCTURAL_GAP_PATTERN.test(gap));
}

const SYSTEM_PROMPT = `
You are an extraction agent for job postings. You receive the raw text of a job description (possibly with HTML remnants or Markdown) and extract structured data plus a concise job brief as JSON for a job search app.

Your job is NOT to judge whether the candidate is a good fit, give career advice, or rewrite the posting in marketing language. Extract only what the posting actually says. Never invent values.

STRICT RULE: every datum belongs to EXACTLY ONE category. Information must NOT appear twice. A logistical or contractual attribute captured in the structured object must never also appear inside skills_and_domain_highlights.

## structured object

- company_name: cleaned company name including legal form if present (e.g. "pulsation IT GmbH"), without phrases like "sucht", "stellt ein", or "is hiring". Empty string if unknown.
- location: city or region only. Never include remote/hybrid/onsite words here. Empty string if unknown.
- work_mode: exactly one of "remote", "hybrid", "onsite". Empty string if unknown.
- contract_type: the employment type as stated — e.g. full-time, part-time, freelance, internship, working student (Werkstudent), apprenticeship (Ausbildung), temporary/fixed-term (befristet), or permanent (Festanstellung). Empty string if unknown.
- seniority_level: exactly one of "entry", "mid", "senior", "lead". Empty string if unknown.
- salary_range: exactly as stated in the text (keep currency and interval). Empty string if not stated. Never invent a number.

## highlight arrays

Attributes that must NEVER go into skills_and_domain_highlights (they belong in the structured object):
- Location, city, or region
- Remote / hybrid / onsite working mode
- Full-time / part-time / contract type / fixed-term
- Salary or salary range
- Years of experience or seniority level
- Company name or legal form

skills_and_domain_highlights contains ONLY concrete professional competencies, technologies as a capability, domain topics, or methods (e.g. "Kubernetes infrastructure", "CI/CD automation", "Emergency services software"). Every entry must describe a skill or an area of responsibility — never a logistical or contractual attribute.

tools_mentioned contains ONLY named software or tools (e.g. "Notion", "Slack", "Terraform"), kept separate from skills_and_domain_highlights so that tools are not counted as competency claims. A named tool must appear in tools_mentioned, not in skills_and_domain_highlights.

role_summary: ONE active sentence following this pattern:
"[3-4 main responsibilities as verb phrases, comma-separated] at a [company type / industry in 2-4 words]."
Keep this pattern consistent across ALL jobs — tone and structure must not vary between postings.

Example (assistant role): "Coordinate founder schedules and travel, prepare customer and HR contracts, manage basic accounting documents, and support overall team operations at a B2B SaaS startup."
Example (tech role): "Build and operate Kubernetes-based infrastructure, automate CI/CD pipelines, safeguard production reliability, and support developer tooling at an emergency-services software company."

they_want: stated applicant requirements only, as short bullets. Must-have before nice-to-have; mark optional ones with a trailing "(nice-to-have)".
company_offers: concrete things the company says it offers, as short bullets.
missing_or_unclear: ONLY substantive/content gaps that cannot be captured by a structured field (e.g. "Reporting line unclear", "Team size not mentioned", "Start date not given"). Do NOT list salary, contract type, work mode, location, or seniority here — those gaps are generated deterministically from the structured object by the application, so listing them here creates duplicates. Return an empty array if there are no content gaps.

Rules:
- Only use information present in the job description.
- Do not mention the candidate.
- If a highlight category has no content, return an empty array. Do not fabricate filler.
- Return valid JSON only.
`.trim();

const stringList = (description: string, maxItems: number) => ({
  type: "array",
  description,
  maxItems,
  items: { type: "string" },
});

const structuredString = (description: string) => ({
  type: "string",
  description,
});

const JOB_BRIEF_SCHEMA: JsonSchemaDefinition = {
  name: "job_extraction",
  schema: {
    type: "object",
    properties: {
      structured: {
        type: "object",
        description:
          "Structured metadata. None of these values may also appear in the highlight arrays.",
        properties: {
          company_name: structuredString(
            "Cleaned company name incl. legal form, without 'sucht'/'stellt ein'/'is hiring'. Empty string if unknown.",
          ),
          location: structuredString(
            "City or region only, no remote/hybrid/onsite words. Empty string if unknown.",
          ),
          work_mode: structuredString(
            "One of: remote, hybrid, onsite. Empty string if unknown.",
          ),
          contract_type: structuredString(
            "The employment type as stated (e.g. full-time, part-time, freelance, internship, working student/Werkstudent, apprenticeship/Ausbildung, temporary/befristet, permanent/Festanstellung). Empty string if unknown.",
          ),
          seniority_level: structuredString(
            "One of: entry, mid, senior, lead. Empty string if unknown.",
          ),
          salary_range: structuredString(
            "As stated in the text (keep currency/interval). Empty string if not stated.",
          ),
        },
        required: [
          "company_name",
          "location",
          "work_mode",
          "contract_type",
          "seniority_level",
          "salary_range",
        ],
        additionalProperties: false,
      },
      role_summary: {
        type: "string",
        description:
          "One active sentence: '[3-4 responsibilities as verb phrases] at a [company type/industry].'",
      },
      skills_and_domain_highlights: stringList(
        "Concrete competencies, technologies-as-capability, domain topics, or methods only. No location/work-mode/contract/salary/seniority/company.",
        12,
      ),
      tools_mentioned: stringList(
        "Named software or tools only (e.g. Notion, Terraform), separate from skills.",
        12,
      ),
      they_want: stringList(
        "Stated applicant requirements only. Must-have before nice-to-have; suffix optional ones with '(nice-to-have)'.",
        6,
      ),
      company_offers: stringList(
        "Concrete things the company says it offers",
        5,
      ),
      missing_or_unclear: stringList(
        "Content gaps only (e.g. reporting line unclear, team size not mentioned). NOT salary/contract/work-mode/location/seniority — those are generated in code.",
        5,
      ),
    },
    required: [
      "structured",
      "role_summary",
      "skills_and_domain_highlights",
      "tools_mentioned",
      "they_want",
      "company_offers",
      "missing_or_unclear",
    ],
    additionalProperties: false,
  },
};

/**
 * Run the LLM extraction over a job description, returning both the serialized
 * highlight brief and the normalized structured metadata.
 */
export async function extractJobPosting(
  jobDescription: string | null | undefined,
  context: { jobId?: string } = {},
): Promise<JobExtraction | null> {
  const description = jobDescription?.trim();
  if (!description) return null;

  try {
    const model = await resolveLlmModel("scoring");
    const llm = await createConfiguredLlmService("scoring");
    const result = await llm.callJson<RawExtraction>({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(description) },
      ],
      jsonSchema: JOB_BRIEF_SCHEMA,
      maxRetries: 2,
      jobId: context.jobId,
    });

    if (!result.success) {
      logger.warn("Job extraction failed", {
        jobId: context.jobId,
        error: result.error,
      });
      return null;
    }

    const brief = normalizeJobBrief(result.data);
    if (!brief) {
      logger.warn("Job extraction returned invalid shape", {
        jobId: context.jobId,
      });
      return null;
    }

    const structured = normalizeStructured(result.data.structured);
    // The brief carries only content gaps; structural gaps (salary/contract/
    // work mode/location/seniority) are derived from the canonical job row on
    // the client so they always match the displayed values.
    brief.missing_or_unclear = buildMissingOrUnclear(brief.missing_or_unclear);

    return {
      jobBrief: JSON.stringify(brief),
      structured,
    };
  } catch (error) {
    logger.warn("Job extraction failed", {
      jobId: context.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Backwards-compatible wrapper returning only the serialized highlight brief.
 */
export async function generateJobBrief(
  jobDescription: string | null | undefined,
  context: { jobId?: string } = {},
): Promise<string | null> {
  const extraction = await extractJobPosting(jobDescription, context);
  return extraction?.jobBrief ?? null;
}

/**
 * Build the field updates implied by the structured extraction, applying the
 * merge policy: enum fields (contract/seniority) are authoritative for a
 * consistent vocabulary across ingestion paths; descriptive fields only fill
 * gaps so we never clobber richer scraper/manual data.
 */
export function mergeStructuredIntoJob(
  job: Pick<Job, "employer" | "location" | "salary" | "workFromHomeType">,
  structured: StructuredExtraction,
): UpdateJobInput {
  const update: UpdateJobInput = {};
  const isEmpty = (value: unknown) =>
    value == null || String(value).trim() === "";

  // Safe to overwrite — no downstream logic parses these values.
  if (structured.contract_type) update.jobType = structured.contract_type;
  if (structured.seniority_level) update.jobLevel = structured.seniority_level;

  // Fill-only: keep existing scraper/manual values when present.
  if (structured.company_name && isEmpty(job.employer)) {
    update.employer = structured.company_name;
  }
  if (structured.location && isEmpty(job.location)) {
    update.location = structured.location;
  }
  if (structured.salary_range && isEmpty(job.salary)) {
    update.salary =
      parseSalary(structured.salary_range)?.text ?? structured.salary_range;
  }
  // Work mode is authoritative from the JD. `structured.work_mode` is already
  // canonical (remote/hybrid/onsite or null). Overwrite whenever present — a
  // non-canonical scraper value must not survive and render blank while the gap
  // list, computed from the same field, silently disagrees (the reported bug).
  if (structured.work_mode) {
    update.workFromHomeType = structured.work_mode;
    update.isRemote = structured.work_mode === "remote";
  }

  return update;
}

function buildUserPrompt(jobDescription: string): string {
  return `
Extract structured data and a concise, no-BS job brief from this job description.

Return JSON in this exact shape:
{
  "structured": {
    "company_name": "",
    "location": "",
    "work_mode": "",
    "contract_type": "",
    "seniority_level": "",
    "salary_range": ""
  },
  "role_summary": "",
  "skills_and_domain_highlights": [],
  "tools_mentioned": [],
  "they_want": [],
  "company_offers": [],
  "missing_or_unclear": []
}

Rules:
- structured.* : follow the controlled vocabularies. Empty string when unknown; never invent. None of these values may be repeated in the highlight arrays.
- role_summary: one active sentence, pattern "[3-4 responsibilities as verb phrases] at a [company type/industry]".
- skills_and_domain_highlights: max 12 chips. ONLY concrete competencies, technologies-as-capability, domain topics, or methods. NEVER location, remote/hybrid/onsite, contract type, salary, seniority, or company name.
- tools_mentioned: max 12 named software/tools only (e.g. Notion, Terraform). Do not repeat these in skills_and_domain_highlights.
- they_want: max 6 short bullets, stated requirements only. Must-have first; suffix nice-to-haves with "(nice-to-have)".
- company_offers: max 5 short bullets for concrete things the company claims to provide.
- missing_or_unclear: max 5 short bullets for CONTENT gaps only (reporting line, team size, start date, etc.). Never salary, contract type, work mode, location, or seniority — those are added deterministically in code.

Job description:
${jobDescription}
`.trim();
}

function normalizeJobBrief(value: JobBrief): JobBrief | null {
  if (!value || typeof value !== "object") return null;
  if (typeof value.role_summary !== "string") return null;

  const tools = normalizeStringList(value.tools_mentioned, 12);
  const toolSet = new Set(tools.map((tool) => tool.toLowerCase()));
  // Anti-redundancy: a named tool must not also be claimed as a skill/domain highlight.
  const skills = normalizeStringList(
    value.skills_and_domain_highlights,
    12,
  ).filter((skill) => !toolSet.has(skill.toLowerCase()));

  return {
    role_summary: value.role_summary.trim() || "Not stated",
    skills_and_domain_highlights: skills,
    tools_mentioned: tools,
    they_want: normalizeStringList(value.they_want, 6),
    company_offers: normalizeStringList(value.company_offers, 5),
    missing_or_unclear: normalizeStringList(value.missing_or_unclear, 5),
  };
}

/**
 * Parse a job's stored `jobBrief` JSON column back into a validated JobBrief.
 * Returns null for missing/blank/malformed JSON or a brief that fails validation.
 */
export function parseStoredJobBrief(
  json: string | null | undefined,
): JobBrief | null {
  if (typeof json !== "string" || json.trim() === "") return null;
  try {
    return normalizeJobBrief(JSON.parse(json) as JobBrief);
  } catch {
    return null;
  }
}

function normalizeStructured(
  value: Partial<StructuredExtraction> | undefined,
): StructuredExtraction {
  const raw = value ?? {};
  const text = (input: unknown): string | null =>
    typeof input === "string" && input.trim() ? input.trim() : null;
  const oneOf = (input: unknown, allowed: Set<string>): string | null => {
    const token = text(input)?.toLowerCase();
    return token && allowed.has(token) ? token : null;
  };

  return {
    company_name: text(raw.company_name),
    location: text(raw.location),
    work_mode: normalizeWorkplaceType([text(raw.work_mode)]),
    contract_type: normalizeContractType(text(raw.contract_type)),
    seniority_level: oneOf(raw.seniority_level, SENIORITY_LEVELS),
    salary_range: text(raw.salary_range),
  };
}

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}
