/**
 * Translates the visible prose of a resume JSON (Reactive Resume v5 shape) into
 * a target language, leaving proper nouns, tech terms, dates and ATS-critical
 * fields (name, headline, skills) untouched.
 *
 * Runs at PDF render time, only when the resolved output language differs from
 * the resume's own language. Never throws: on any failure it returns the
 * original JSON so a render can still complete.
 */

import { logger } from "@infra/logger";
import { detectReactiveResumeV5Language } from "@shared/language-detection";
import type { ChatStyleManualLanguage } from "@shared/types";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import { getWritingLanguageLabel } from "./output-language";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import { getLatexResumeSectionTitles } from "./resume-renderer/document";
import { bracketizeText } from "./text-style";

interface TranslatableField {
  text: string;
  apply: (translated: string) => void;
}

/** JSON schema: a flat list of key/text pairs echoed back translated. */
const RESUME_TRANSLATION_SCHEMA: JsonSchemaDefinition = {
  name: "resume_translation",
  schema: {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            text: { type: "string" },
          },
          required: ["key", "text"],
          additionalProperties: false,
        },
      },
    },
    required: ["translations"],
    additionalProperties: false,
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Collects the translatable string fields from a resume, each with a setter
 * that writes the translation back into the same (cloned) object.
 *
 * Deliberately excludes: basics.name, basics.headline (ATS), company/institution
 * proper nouns, dates, URLs, and skills (keywords/names kept for ATS matching).
 */
function collectTranslatableFields(
  resume: Record<string, unknown>,
): TranslatableField[] {
  const fields: TranslatableField[] = [];

  const push = (owner: Record<string, unknown> | null, key: string): void => {
    if (!owner) return;
    const value = owner[key];
    if (typeof value === "string" && value.trim()) {
      fields.push({
        text: value,
        apply: (translated: string) => {
          owner[key] = translated;
        },
      });
    }
  };

  push(asRecord(resume.summary), "content");

  const sections = asRecord(resume.sections);
  if (!sections) return fields;

  const forEachItem = (
    sectionKey: string,
    handle: (item: Record<string, unknown>) => void,
  ): void => {
    const section = asRecord(sections[sectionKey]);
    for (const raw of asArray(section?.items)) {
      const item = asRecord(raw);
      if (!item || item.hidden === true) continue;
      handle(item);
    }
  };

  forEachItem("experience", (item) => {
    push(item, "position");
    push(item, "summary");
    push(item, "description");
    for (const raw of asArray(item.roles)) {
      const role = asRecord(raw);
      if (!role) continue;
      push(role, "position");
      push(role, "summary");
      push(role, "description");
    }
  });

  forEachItem("education", (item) => {
    push(item, "degree");
    push(item, "studyType");
    push(item, "area");
    push(item, "summary");
    push(item, "description");
  });

  forEachItem("projects", (item) => {
    push(item, "name");
    push(item, "summary");
    push(item, "description");
  });

  forEachItem("volunteer", (item) => {
    push(item, "position");
    push(item, "summary");
    push(item, "description");
  });

  return fields;
}

/**
 * Returns a copy of `resumeJson` with prose translated into `targetLanguage`.
 * No-ops (returns the original reference) when the resume is already in the
 * target language, its language can't be confidently detected, there is nothing
 * to translate, or the LLM call fails.
 */
export async function translateResumeBody(
  resumeJson: Record<string, unknown>,
  targetLanguage: ChatStyleManualLanguage,
  jobId?: string,
): Promise<Record<string, unknown>> {
  const sourceLanguage = detectReactiveResumeV5Language(resumeJson);
  if (!sourceLanguage || sourceLanguage === targetLanguage) {
    return resumeJson;
  }

  const clone = structuredClone(resumeJson);
  const fields = collectTranslatableFields(clone);
  if (fields.length === 0) {
    return resumeJson;
  }

  try {
    const [model, template] = await Promise.all([
      resolveLlmModel("tailoring"),
      getEffectivePromptTemplate("resumeTranslationPromptTemplate"),
    ]);

    const request = fields.map((field, index) => ({
      key: String(index),
      text: field.text,
    }));
    const prompt = renderPromptTemplate(template, {
      outputLanguage: getWritingLanguageLabel(targetLanguage),
      fieldsJson: JSON.stringify(request),
    });

    const llm = await createConfiguredLlmService("tailoring");
    const result = await llm.callJson<{
      translations: Array<{ key: string; text: string }>;
    }>({
      model,
      messages: [{ role: "user", content: prompt }],
      jsonSchema: RESUME_TRANSLATION_SCHEMA,
      jobId,
    });

    if (!result.success) {
      logger.warn("Resume translation failed; using original language", {
        jobId,
        targetLanguage,
        error: result.error,
      });
      return resumeJson;
    }

    for (const entry of result.data.translations ?? []) {
      const index = Number(entry.key);
      const field = fields[index];
      if (field && typeof entry.text === "string" && entry.text.trim()) {
        field.apply(entry.text);
      }
    }

    return clone;
  } catch (error) {
    logger.warn("Resume translation threw; using original language", {
      jobId,
      targetLanguage,
      error,
    });
    return resumeJson;
  }
}

// ---------------------------------------------------------------------------
// Deterministic localization (no LLM): section headings + date tokens.
// Runs whenever the target language is non-English, independent of the prose
// translation, so it also fixes English "Present"/headings in a hand-authored
// German master resume.
// ---------------------------------------------------------------------------

/** English → localized words that appear inside date strings (months + "Present"). */
const DATE_WORD_MAP: Record<
  ChatStyleManualLanguage,
  Array<[string, string]>
> = {
  english: [],
  german: [
    ["January", "Januar"],
    ["February", "Februar"],
    ["March", "März"],
    ["April", "April"],
    ["May", "Mai"],
    ["June", "Juni"],
    ["July", "Juli"],
    ["August", "August"],
    ["September", "September"],
    ["October", "Oktober"],
    ["November", "November"],
    ["December", "Dezember"],
    ["Jan", "Jan"],
    ["Feb", "Feb"],
    ["Mar", "Mär"],
    ["Apr", "Apr"],
    ["Jun", "Jun"],
    ["Jul", "Jul"],
    ["Aug", "Aug"],
    ["Sept", "Sep"],
    ["Sep", "Sep"],
    ["Oct", "Okt"],
    ["Nov", "Nov"],
    ["Dec", "Dez"],
    ["Present", "heute"],
    ["Current", "heute"],
    ["Today", "heute"],
    ["Now", "heute"],
    ["Ongoing", "laufend"],
  ],
  french: [
    ["January", "janvier"],
    ["February", "février"],
    ["March", "mars"],
    ["April", "avril"],
    ["May", "mai"],
    ["June", "juin"],
    ["July", "juillet"],
    ["August", "août"],
    ["September", "septembre"],
    ["October", "octobre"],
    ["November", "novembre"],
    ["December", "décembre"],
    ["Jan", "janv."],
    ["Feb", "févr."],
    ["Mar", "mars"],
    ["Apr", "avr."],
    ["Jun", "juin"],
    ["Jul", "juil."],
    ["Aug", "août"],
    ["Sept", "sept."],
    ["Sep", "sept."],
    ["Oct", "oct."],
    ["Nov", "nov."],
    ["Dec", "déc."],
    ["Present", "présent"],
    ["Current", "présent"],
    ["Today", "présent"],
    ["Now", "présent"],
    ["Ongoing", "en cours"],
  ],
  spanish: [
    ["January", "enero"],
    ["February", "febrero"],
    ["March", "marzo"],
    ["April", "abril"],
    ["May", "mayo"],
    ["June", "junio"],
    ["July", "julio"],
    ["August", "agosto"],
    ["September", "septiembre"],
    ["October", "octubre"],
    ["November", "noviembre"],
    ["December", "diciembre"],
    ["Jan", "ene."],
    ["Feb", "feb."],
    ["Mar", "mar."],
    ["Apr", "abr."],
    ["Jun", "jun."],
    ["Jul", "jul."],
    ["Aug", "ago."],
    ["Sept", "sept."],
    ["Sep", "sep."],
    ["Oct", "oct."],
    ["Nov", "nov."],
    ["Dec", "dic."],
    ["Present", "Actualidad"],
    ["Current", "Actualidad"],
    ["Today", "Actualidad"],
    ["Now", "Actualidad"],
    ["Ongoing", "en curso"],
  ],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface DateReplacer {
  re: RegExp;
  lookup: Map<string, string>;
}

function buildDateReplacer(language: ChatStyleManualLanguage): DateReplacer {
  const map = DATE_WORD_MAP[language];
  const keys = map
    .map(([en]) => en)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  return {
    re: new RegExp(`\\b(${keys.join("|")})\\b`, "gi"),
    lookup: new Map(map.map(([en, loc]) => [en.toLowerCase(), loc])),
  };
}

function localizeDateString(value: unknown, replacer: DateReplacer): unknown {
  if (typeof value !== "string" || !value.trim()) return value;
  return value.replace(
    replacer.re,
    (match) => replacer.lookup.get(match.toLowerCase()) ?? match,
  );
}

function localizeItemDates(
  item: Record<string, unknown>,
  replacer: DateReplacer,
): void {
  for (const key of ["period", "date"]) {
    if (typeof item[key] === "string") {
      item[key] = localizeDateString(item[key], replacer);
    }
  }
}

/**
 * Extra English section-heading spellings to treat as defaults, beyond the
 * LaTeX dictionary values. Notably Reactive Resume ships "Skills" and
 * "Volunteering" where our dictionary uses "Technical Skills" / "Volunteer",
 * so without these the seeded German master would keep the English heading.
 */
const EXTRA_ENGLISH_TITLE_VARIANTS: Record<string, string[]> = {
  summary: ["Profile", "About", "About Me"],
  experience: ["Work Experience", "Employment", "Professional Experience"],
  education: ["Education & Training"],
  skills: ["Skills", "Technical Skills", "Competencies"],
  certifications: ["Certificates"],
  volunteer: ["Volunteering", "Volunteer Experience"],
  references: ["Reference"],
};

/** True when `current` matches any known English default heading for `key`. */
function isEnglishDefaultTitle(
  key: string,
  current: string,
  englishLabel: string,
): boolean {
  const variants = new Set(
    [englishLabel, ...(EXTRA_ENGLISH_TITLE_VARIANTS[key] ?? [])].map((value) =>
      value.toLowerCase(),
    ),
  );
  return variants.has(current.toLowerCase());
}

/**
 * Replaces section headings and date tokens (month names, "Present") with the
 * target language, without calling an LLM. Section titles are only swapped when
 * they still hold a known English default, so custom headings survive.
 */
export function localizeResumeStaticText(
  resumeJson: Record<string, unknown>,
  language: ChatStyleManualLanguage,
): Record<string, unknown> {
  if (language === "english") return resumeJson;

  const clone = structuredClone(resumeJson);
  const englishTitles = getLatexResumeSectionTitles("english");
  const targetTitles = getLatexResumeSectionTitles(language);
  const replacer = buildDateReplacer(language);

  const sections = asRecord(clone.sections);
  if (sections) {
    for (const key of Object.keys(targetTitles) as Array<
      keyof typeof targetTitles
    >) {
      const section = asRecord(sections[key]);
      if (!section) continue;
      const current =
        typeof section.title === "string" ? section.title.trim() : "";
      // Empty titles already fall back to the localized dict at render time;
      // only overwrite a known English default.
      if (current && isEnglishDefaultTitle(key, current, englishTitles[key])) {
        section.title = targetTitles[key];
      }
    }

    for (const raw of Object.values(sections)) {
      const section = asRecord(raw);
      for (const itemRaw of asArray(section?.items)) {
        const item = asRecord(itemRaw);
        if (!item) continue;
        localizeItemDates(item, replacer);
        for (const roleRaw of asArray(item.roles)) {
          const role = asRecord(roleRaw);
          if (role) localizeItemDates(role, replacer);
        }
      }
    }
  }

  const summary = asRecord(clone.summary);
  if (summary && typeof summary.title === "string") {
    const current = summary.title.trim();
    if (
      current &&
      isEnglishDefaultTitle("summary", current, englishTitles.summary)
    ) {
      summary.title = targetTitles.summary;
    }
  }

  return clone;
}

// ---------------------------------------------------------------------------
// Cosmetic prose transform (no LLM): render round parentheses as square
// brackets. Applied at render time so it also catches LLM-generated text.
// ---------------------------------------------------------------------------

/**
 * Returns a copy of `resumeJson` with round parentheses swapped for square
 * brackets in visible prose. Mirrors the field set of `collectTranslatableFields`
 * (keep the two in sync) but ALSO includes skills (name + keywords), since skill
 * keywords like "Infrastructure as Code (IaC)" are exactly where this style
 * shows up. Contact/URL fields, dates and proper nouns are never visited.
 */
export function bracketizeResumeProse(
  resumeJson: Record<string, unknown>,
): Record<string, unknown> {
  const clone = structuredClone(resumeJson);

  const swap = (owner: Record<string, unknown> | null, key: string): void => {
    if (!owner) return;
    const value = owner[key];
    if (typeof value === "string" && value) {
      owner[key] = bracketizeText(value);
    }
  };

  swap(asRecord(clone.summary), "content");

  const sections = asRecord(clone.sections);
  if (!sections) return clone;

  const forEachItem = (
    sectionKey: string,
    handle: (item: Record<string, unknown>) => void,
  ): void => {
    const section = asRecord(sections[sectionKey]);
    for (const raw of asArray(section?.items)) {
      const item = asRecord(raw);
      if (!item || item.hidden === true) continue;
      handle(item);
    }
  };

  forEachItem("experience", (item) => {
    swap(item, "position");
    swap(item, "summary");
    swap(item, "description");
    for (const raw of asArray(item.roles)) {
      const role = asRecord(raw);
      if (!role) continue;
      swap(role, "position");
      swap(role, "summary");
      swap(role, "description");
    }
  });

  forEachItem("education", (item) => {
    swap(item, "degree");
    swap(item, "studyType");
    swap(item, "area");
    swap(item, "summary");
    swap(item, "description");
  });

  forEachItem("projects", (item) => {
    swap(item, "name");
    swap(item, "summary");
    swap(item, "description");
  });

  forEachItem("volunteer", (item) => {
    swap(item, "position");
    swap(item, "summary");
    swap(item, "description");
  });

  forEachItem("skills", (item) => {
    swap(item, "name");
    if (Array.isArray(item.keywords)) {
      item.keywords = item.keywords.map((kw) =>
        typeof kw === "string" ? bracketizeText(kw) : kw,
      );
    }
  });

  return clone;
}
