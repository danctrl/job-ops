/**
 * Service for generating tailored resume content (Summary, Headline, Skills).
 */

import { logger } from "@infra/logger";
import type {
  JobBrief,
  ResumeProfile,
  ResumeSkillsSettings,
  TailoringFeaturesSettings,
} from "@shared/types";
import { computeCoverage } from "./coverage";
import { enforceExperienceGuardrails } from "./experience-tailoring";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import { collectBriefTerms, enforceSkillGuardrails } from "./skill-selection";
import {
  getWritingStyle,
  stripKeywordLimitFromConstraints,
  stripLanguageDirectivesFromConstraints,
  stripWordLimitFromConstraints,
} from "./writing-style";

export interface TailoredData {
  summary: string;
  headline: string;
  skills: Array<{ name: string; keywords: string[] }>;
  /** Per-job rephrased experience bullets, or null when the feature is off. */
  experience: Array<{ company: string; bullets: string[] }> | null;
  /** ATS keyword coverage 0-100 vs the job brief, or null if no brief terms. */
  coverageScore: number | null;
}

export interface TailoringResult {
  success: boolean;
  data?: TailoredData;
  error?: string;
}

/** JSON schema for resume tailoring response. Experience is added on demand. */
function buildTailoringSchema(
  includeExperience: boolean,
): JsonSchemaDefinition {
  const properties: Record<string, unknown> = {
    headline: {
      type: "string",
      description: "Job title headline matching the JD exactly",
    },
    summary: {
      type: "string",
      description: "Tailored resume summary paragraph",
    },
    skills: {
      type: "array",
      description: "Skills sections with keywords tailored to the job",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Skill category name (e.g., Frontend, Backend)",
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "List of skills/technologies in this category",
          },
        },
        required: ["name", "keywords"],
        additionalProperties: false,
      },
    },
  };
  const required = ["headline", "summary", "skills"];

  if (includeExperience) {
    properties.experience = {
      type: "array",
      description:
        "Each experience entry's rephrased bullets (by company). Rephrase only; keep all facts and numbers.",
      items: {
        type: "object",
        properties: {
          company: {
            type: "string",
            description:
              "The exact company name of the experience entry from MY PROFILE",
          },
          bullets: {
            type: "array",
            items: { type: "string" },
            description: "Rephrased bullet points for this entry",
          },
        },
        required: ["company", "bullets"],
        additionalProperties: false,
      },
    };
    required.push("experience");
  }

  return {
    name: "resume_tailoring",
    schema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

/**
 * Generate tailored resume content (summary, headline, skills) for a job.
 */
export async function generateTailoring(
  jobDescription: string,
  profile: ResumeProfile,
  brief?: JobBrief | null,
  skillsSettings?: ResumeSkillsSettings | null,
  features?: TailoringFeaturesSettings | null,
): Promise<TailoringResult> {
  const [model, writingStyle] = await Promise.all([
    resolveLlmModel("tailoring"),
    getWritingStyle(),
  ]);
  const excludedGroupIds = skillsSettings?.excludedGroupIds ?? [];
  // The LLM selects skills from the master (minus "Don't select" groups);
  // deterministic guardrails below validate, cap, and floor its output.
  const prompt = await buildTailoringPrompt(
    profile,
    jobDescription,
    writingStyle,
    brief,
    excludedGroupIds,
    features,
  );

  const tailorExperience = features?.tailorExperience ?? false;
  const llm = await createConfiguredLlmService("tailoring");
  const result = await llm.callJson<TailoredData>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: buildTailoringSchema(tailorExperience),
  });

  if (!result.success) {
    const context = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    if (result.error.toLowerCase().includes("api key")) {
      const message = `LLM API key not set, cannot generate tailoring. (${context})`;
      logger.warn(message);
      return { success: false, error: message };
    }
    return {
      success: false,
      error: `${result.error} (${context})`,
    };
  }

  const { summary, headline, skills, experience } = result.data;

  // Basic validation
  if (!summary || !headline || !Array.isArray(skills)) {
    logger.warn("AI response missing required tailoring fields", result.data);
  }

  const finalSummary = sanitizeText(summary || "");
  const finalHeadline = sanitizeText(headline || "");
  const finalSkills = enforceSkillGuardrails(
    skills,
    profile.sections?.skills?.items,
    {
      maxTotal: skillsSettings?.maxKeywords,
      lockedGroupIds: skillsSettings?.lockedGroupIds,
      excludedGroupIds: skillsSettings?.excludedGroupIds,
    },
  );

  // Experience bullets: only when the feature is on, and only after the
  // truthfulness guardrails have vetted the LLM's rephrasing.
  const finalExperience = tailorExperience
    ? enforceExperienceGuardrails(
        experience,
        profile.sections?.experience?.items,
      )
    : null;

  // Coverage counts the actually-rendered bullets (tailored where present).
  const experienceBullets =
    finalExperience && finalExperience.length > 0
      ? finalExperience.flatMap((e) => e.bullets)
      : collectProfileExperienceBullets(profile);
  const coverage = computeCoverage(brief, {
    headline: finalHeadline,
    summary: finalSummary,
    skills: finalSkills,
    experienceBullets,
  });

  return {
    success: true,
    data: {
      summary: finalSummary,
      headline: finalHeadline,
      skills: finalSkills,
      experience: finalExperience,
      coverageScore: coverage.score,
    },
  };
}

/** Flatten the master profile's experience bullet points (plain text). */
function collectProfileExperienceBullets(profile: ResumeProfile): string[] {
  const items = profile.sections?.experience?.items ?? [];
  const bullets: string[] = [];
  for (const item of items) {
    const description = typeof item.summary === "string" ? item.summary : "";
    if (!description) continue;
    const text = description.replace(/<[^>]*>/g, " ");
    for (const line of text.split(/\n+/)) {
      const trimmed = line.trim();
      if (trimmed) bullets.push(trimmed);
    }
  }
  return bullets;
}

/**
 * Backwards compatibility wrapper if needed, or alias.
 */
export async function generateSummary(
  jobDescription: string,
  profile: ResumeProfile,
): Promise<{ success: boolean; summary?: string; error?: string }> {
  // If we just need summary, we can discard the rest (or cache it? but here we just return summary)
  const result = await generateTailoring(jobDescription, profile);
  return {
    success: result.success,
    summary: result.data?.summary,
    error: result.error,
  };
}

/** Drop "Don't select" skill groups from the profile before prompting. */
function excludeSkillGroups(
  skills: NonNullable<ResumeProfile["sections"]>["skills"],
  excludedGroupIds: readonly string[],
): NonNullable<ResumeProfile["sections"]>["skills"] {
  if (!skills || excludedGroupIds.length === 0) return skills;
  const excluded = new Set(excludedGroupIds);
  return {
    ...skills,
    items: (skills.items ?? []).filter((item) => !excluded.has(item.id)),
  };
}

async function buildTailoringPrompt(
  profile: ResumeProfile,
  jd: string,
  writingStyle: Awaited<ReturnType<typeof getWritingStyle>>,
  brief?: JobBrief | null,
  excludedGroupIds: readonly string[] = [],
  features?: TailoringFeaturesSettings | null,
): Promise<string> {
  const resolvedLanguage = resolveWritingOutputLanguage({
    style: writingStyle,
    profile,
    jobDescription: jd,
  });
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
  let effectiveConstraints = stripLanguageDirectivesFromConstraints(
    writingStyle.constraints,
  );
  if (writingStyle.summaryMaxWords != null) {
    effectiveConstraints = stripWordLimitFromConstraints(effectiveConstraints);
  }
  if (writingStyle.maxKeywordsPerSkill != null) {
    effectiveConstraints =
      stripKeywordLimitFromConstraints(effectiveConstraints);
  }

  // Extract only needed parts of profile to save tokens
  const relevantProfile = {
    basics: {
      name: profile.basics?.name,
      label: profile.basics?.label, // Original headline
      summary: profile.basics?.summary,
    },
    skills: excludeSkillGroups(profile.sections?.skills, excludedGroupIds),
    projects: profile.sections?.projects?.items?.map((p) => ({
      name: p.name,
      description: p.description,
      keywords: p.keywords,
    })),
    experience: profile.sections?.experience?.items?.map((e) => ({
      id: e.id,
      company: e.company,
      position: e.position,
      summary: e.summary,
    })),
  };

  const template = await getEffectivePromptTemplate("tailoringPromptTemplate");

  return renderPromptTemplate(template, {
    jobDescription: jd,
    profileJson: JSON.stringify(relevantProfile, null, 2),
    outputLanguage,
    jdKeywordsLine: (() => {
      const terms = collectBriefTerms(brief);
      return terms.length
        ? `\nJD KEY REQUIREMENTS (extracted — prioritize these when selecting skills):\n${terms
            .map((t) => `- ${t}`)
            .join("\n")}\n`
        : "";
    })(),
    summaryKeywordPushLine: features?.summaryKeywordPush
      ? "\n   - Weave in 2-3 of the JD KEY REQUIREMENTS I genuinely have, using the JD's exact wording."
      : "",
    softSkillRuleLine: features?.softSkillsOnlyIfMentioned
      ? "\n   - Include soft skills (e.g. communication, teamwork, leadership) only if the JD explicitly names them."
      : "",
    experienceInstructionsBlock: features?.tailorExperience
      ? `\n4. "experience" (Array of Objects) — REPHRASE my existing bullets:
   - For each experience entry in MY PROFILE, return { "company": <the exact company name>, "bullets": [...] } with its bullets rephrased to surface this job's terminology and the skills I genuinely used there.
   - STRICT TRUTH: keep every company, role, date and every number/metric exactly as in the original. Add no responsibilities, tools, or achievements that are not already implied by my original bullets. Never invent.
   - Keep the bullet count the same or fewer than the original (you may merge or trim, never inflate).
   - Keep each bullet TIGHT: at most two lines (prefer one). Stay about the original length — you may match it to weave in a JD keyword, but never pad with filler or run to a third line.
   - Vary the wording ACROSS entries: do not reuse the same phrase or opener (e.g. the same "acting as ..." tagline) in more than one experience entry.
   - Each rephrased bullet must stay anchored to the original bullet's facts (reuse its concrete nouns/actions); never introduce a responsibility, tool, or claim that is not in the original.
   - Only rephrase entries I actually list; do not add new experience entries.`
      : "",
    tone: writingStyle.tone,
    formality: writingStyle.formality,
    summaryMaxWordsLine:
      writingStyle.summaryMaxWords != null
        ? ` Maximum ${writingStyle.summaryMaxWords} ${writingStyle.summaryMaxWords === 1 ? "word" : "words"}.`
        : "",
    maxKeywordsPerSkillLine:
      writingStyle.maxKeywordsPerSkill != null
        ? `\n   - Maximum ${writingStyle.maxKeywordsPerSkill} ${writingStyle.maxKeywordsPerSkill === 1 ? "keyword" : "keywords"} per category. If a category has more, keep only the most JD-relevant ones.`
        : "",
    constraintsBullet: effectiveConstraints
      ? `- Additional constraints: ${effectiveConstraints}`
      : "",
    avoidTermsBullet: writingStyle.doNotUse
      ? `- Avoid these words or phrases: ${writingStyle.doNotUse}`
      : "",
  });
}

function sanitizeText(text: string): string {
  return text
    .replace(/\*\*[\s\S]*?\*\*/g, "") // remove markdown bold
    .trim();
}
