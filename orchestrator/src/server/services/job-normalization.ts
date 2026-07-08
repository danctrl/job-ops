import type { CreateJobInput } from "@shared/types/jobs";
import TurndownService from "turndown";
import { z } from "zod";

/**
 * Canonical job-description normalization applied at persistence time.
 *
 * Sources emit descriptions in three shapes:
 * - HTML (e.g. hiringcafe: `<h2>`, `<p>`, `<strong>`, `<ul>`)
 * - escaped Markdown (e.g. JobSpy/LinkedIn: `\-`, `**bold**`, `[text](url)`)
 * - plain text (e.g. startupjobs)
 *
 * We canonicalize everything to Markdown so the client renders one format, the
 * edit box shows readable text (not raw HTML), and downstream consumers
 * (LLM tailoring, cover letters, PDFs) never receive HTML tags/entities.
 *
 * HTML inputs are converted to Markdown; Markdown/plain inputs pass through
 * (they are already valid Markdown), with whitespace tidied.
 */
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
});

// Same tag heuristic the client uses to decide HTML-vs-text.
const HTML_TAG = /<([a-z][\w:-]*)(?:\s[^>]*)?>/i;

function tidyMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeJobDescription(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const markdown = HTML_TAG.test(trimmed)
    ? turndown.turndown(trimmed)
    : trimmed;

  return tidyMarkdown(markdown) || null;
}

/**
 * The invariants a job must satisfy before it can be persisted. The DB enforces
 * these as NOT NULL columns, but an empty/whitespace value or malformed URL
 * from an extractor would otherwise reach the DB and fail the whole batch with
 * a cryptic error. Validating here lets the pipeline skip the single bad row
 * and keep the rest.
 */
const criticalJobFields = z.object({
  source: z.string().min(1),
  title: z.string().trim().min(1),
  employer: z.string().trim().min(1),
  jobUrl: z.string().trim().url(),
});

export type JobInputValidation = { ok: true } | { ok: false; reason: string };

export function validateJobInput(input: CreateJobInput): JobInputValidation {
  const result = criticalJobFields.safeParse(input);
  if (result.success) return { ok: true };
  const reason = result.error.issues
    .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
    .join("; ");
  return { ok: false, reason };
}
