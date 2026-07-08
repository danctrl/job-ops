/**
 * Service for generating PDF resumes from the local Design Resume when available,
 * falling back to the configured Reactive Resume base resume otherwise.
 */

import { existsSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { AppError, type AppErrorCode, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import { getSetting } from "@server/repositories/settings";
import { getJobOpsPublicAvailability } from "@server/services/tracer-links";
import { safePdfFileName } from "@shared/filename-sanitizer";
import { settingsRegistry } from "@shared/settings-registry";
import type {
  ChatStyleManualLanguage,
  DesignResumePdfResponse,
  PdfRenderer,
} from "@shared/types";
import {
  getCurrentDesignResume,
  getDesignResumeForLanguage,
} from "./design-resume";
import { resolveWritingOutputLanguageForResumeJson } from "./output-language";
import {
  getLegacyJobPdfPath,
  getTenantDesignResumePdfPath,
  getTenantJobPdfPath,
  getTenantPdfDir,
} from "./pdf-storage";
import { renderResumePdf } from "./resume-renderer";
import {
  bracketizeResumeProse,
  localizeResumeStaticText,
  translateResumeBody,
} from "./resume-translation";
import {
  deleteResume as deleteRxResume,
  exportResumePdf as exportRxResumePdf,
  getResume as getRxResume,
  importResume as importRxResume,
  type PreparedRxResumePdfPayload,
  prepareTailoredResumeForPdf,
} from "./rxresume";
import { getConfiguredRxResumeBaseResumeId } from "./rxresume/baseResumeId";
import {
  mergeReactiveResumeV5Content,
  prepareReactiveResumeV5DocumentForExternalUse,
} from "./rxresume/document";
import { parseV5ResumeData } from "./rxresume/schema/v5";
import { getWritingStyle } from "./writing-style";

export interface PdfResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
  errorCode?: AppErrorCode;
}

export interface TailoredPdfContent {
  summary?: string | null;
  headline?: string | null;
  skills?: Array<{ name: string; keywords: string[] }> | null;
  experience?: Array<{ company: string; bullets: string[] }> | string | null;
}

export interface GeneratePdfOptions {
  tracerLinksEnabled?: boolean;
  requestOrigin?: string | null;
  tracerCompanyName?: string | null;
}

async function ensureOutputDir(): Promise<void> {
  const outputDir = getTenantPdfDir();
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }
}

async function resolvePdfRenderer(): Promise<PdfRenderer> {
  const storedValue = await getSetting("pdfRenderer");
  return (
    settingsRegistry.pdfRenderer.parse(storedValue ?? undefined) ??
    settingsRegistry.pdfRenderer.default()
  );
}

async function resolveTypstTheme() {
  const storedValue = await getSetting("typstTheme");
  return (
    settingsRegistry.typstTheme.parse(storedValue ?? undefined) ??
    settingsRegistry.typstTheme.default()
  );
}

async function resolveLatexTheme() {
  const storedValue = await getSetting("latexTheme");
  return (
    settingsRegistry.latexTheme.parse(storedValue ?? undefined) ??
    settingsRegistry.latexTheme.default()
  );
}

async function resolveLatexProjectLinkStyle() {
  const storedValue = await getSetting("latexProjectLinkStyle");
  return (
    settingsRegistry.latexProjectLinkStyle.parse(storedValue ?? undefined) ??
    settingsRegistry.latexProjectLinkStyle.default()
  );
}

async function resolveLocalResumeLanguage(
  resumeJson: Record<string, unknown>,
  jobDescription?: string | null,
) {
  const writingStyle = await getWritingStyle();
  return resolveWritingOutputLanguageForResumeJson({
    style: writingStyle,
    resumeJson,
    jobDescription,
  }).language;
}

/**
 * Resolves the target render language before the base resume is loaded, so we
 * can pick the language-specific master. Only "match-resume" mode needs a
 * resume to detect from; there we use the primary master.
 */
async function resolveRenderTargetLanguage(
  jobDescription?: string | null,
): Promise<ChatStyleManualLanguage> {
  const writingStyle = await getWritingStyle();
  let resumeJson: Record<string, unknown> = {};
  if (writingStyle.languageMode === "match-resume") {
    const primary = await getCurrentDesignResume();
    resumeJson = (primary?.resumeJson as Record<string, unknown>) ?? {};
  }
  return resolveWritingOutputLanguageForResumeJson({
    style: writingStyle,
    resumeJson,
    jobDescription,
  }).language;
}

async function downloadRxResumePdf(
  url: string,
  outputPath: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Reactive Resume PDF download failed with HTTP ${response.status}.`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(outputPath, bytes);
}

async function stripPictureWhenJobOpsIsNotHosted(args: {
  data: Record<string, unknown>;
  requestOrigin?: string | null;
}): Promise<Record<string, unknown>> {
  const picture =
    args.data.picture &&
    typeof args.data.picture === "object" &&
    !Array.isArray(args.data.picture)
      ? (args.data.picture as Record<string, unknown>)
      : null;
  if (!picture) return args.data;

  const pictureUrl = typeof picture.url === "string" ? picture.url.trim() : "";
  if (!/^\/api\/design-resume\/assets\/[^/]+\/content$/.test(pictureUrl)) {
    return args.data;
  }

  const availability = await getJobOpsPublicAvailability({
    requestOrigin: args.requestOrigin ?? null,
    force: false,
  });
  if (availability.isPubliclyAvailable) {
    return args.data;
  }

  return {
    ...args.data,
    picture: {
      ...picture,
      hidden: true,
      url: "",
    },
  };
}

async function renderRxResumePdf(args: {
  preparedResume: PreparedRxResumePdfPayload;
  outputPath: string;
  jobId: string;
  name?: string;
  requestOrigin?: string | null;
}): Promise<void> {
  const { preparedResume, outputPath, jobId } = args;
  let importedResumeId: string | null = null;
  const importData = prepareReactiveResumeV5DocumentForExternalUse(
    await stripPictureWhenJobOpsIsNotHosted({
      data: preparedResume.data,
      requestOrigin: args.requestOrigin ?? null,
    }),
    {
      requestOrigin: args.requestOrigin ?? null,
    },
  );

  try {
    importedResumeId = await importRxResume({
      name: args.name?.trim() || `JobOps Tailored Resume ${jobId}`,
      data: importData,
    });

    const exportResult = await exportRxResumePdf(importedResumeId);
    if (exportResult.kind === "pdf") {
      await writeFile(outputPath, exportResult.bytes);
    } else {
      await downloadRxResumePdf(exportResult.url, outputPath);
    }
  } finally {
    if (importedResumeId) {
      try {
        await deleteRxResume(importedResumeId);
      } catch (error) {
        logger.warn("Failed to clean up temporary Reactive Resume PDF export", {
          jobId,
          importedResumeId,
          error,
        });
      }
    }
  }
}

function classifyPdfGenerationError(error: unknown): AppErrorCode {
  if (error instanceof AppError) {
    return error.code;
  }

  if (
    error instanceof Error &&
    /Reactive Resume|RxResume/i.test(error.message)
  ) {
    return "UPSTREAM_ERROR";
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "REQUEST_TIMEOUT";
  }

  return "INTERNAL_ERROR";
}

async function resolveDesignResumeForRenderer(args: {
  renderer: PdfRenderer;
  requestOrigin?: string | null;
}): Promise<{
  documentId: string;
  title: string;
  data: Record<string, unknown>;
  mode: "v5";
}> {
  const designResume = await getCurrentDesignResume();
  if (!designResume?.resumeJson) {
    throw notFound("Resume Studio has not been imported yet.");
  }

  const localDocument = parseV5ResumeData(
    designResume.resumeJson as Record<string, unknown>,
  ) as Record<string, unknown>;

  if (
    args.renderer !== "rxresume" ||
    !designResume.sourceResumeId ||
    designResume.sourceMode !== "v5"
  ) {
    return {
      documentId: designResume.id,
      title: designResume.title,
      data: localDocument,
      mode: "v5",
    };
  }

  try {
    const upstreamResume = await getRxResume(designResume.sourceResumeId);

    if (!upstreamResume.data || typeof upstreamResume.data !== "object") {
      throw new Error("Reactive Resume base resume is empty or invalid.");
    }

    const upstreamDocument = parseV5ResumeData(
      upstreamResume.data as Record<string, unknown>,
    ) as Record<string, unknown>;

    return {
      documentId: designResume.id,
      title: designResume.title,
      data: mergeReactiveResumeV5Content(upstreamDocument, localDocument, {
        requestOrigin: args.requestOrigin ?? null,
      }) as Record<string, unknown>,
      mode: "v5",
    };
  } catch (error) {
    logger.warn(
      "Failed to refresh Reactive Resume template metadata for Design Resume rendering",
      {
        documentId: designResume.id,
        sourceResumeId: designResume.sourceResumeId,
        sourceMode: designResume.sourceMode,
        error,
      },
    );

    return {
      documentId: designResume.id,
      title: designResume.title,
      data: localDocument,
      mode: "v5",
    };
  }
}

async function loadBaseResumeSource(args: {
  renderer: PdfRenderer;
  requestOrigin?: string | null;
  language?: ChatStyleManualLanguage;
}): Promise<{
  data: Record<string, unknown>;
  mode: "v5";
}> {
  // Prefer a hand-authored master for the target language when one exists, so
  // tailoring merges onto the German text (and the translation pass no-ops).
  if (args.language && args.language !== "english") {
    const languageMaster = await getDesignResumeForLanguage(args.language);
    if (languageMaster?.resumeJson) {
      return {
        data: parseV5ResumeData(
          languageMaster.resumeJson as Record<string, unknown>,
        ) as Record<string, unknown>,
        mode: "v5",
      };
    }
  }

  const designResume = await getCurrentDesignResume();
  if (designResume?.resumeJson) {
    if (args.renderer === "rxresume") {
      const resolved = await resolveDesignResumeForRenderer({
        renderer: args.renderer,
        requestOrigin: args.requestOrigin ?? null,
      });
      return {
        data: resolved.data,
        mode: "v5",
      };
    }

    return {
      data: parseV5ResumeData(
        designResume.resumeJson as Record<string, unknown>,
      ) as Record<string, unknown>,
      mode: "v5",
    };
  }

  const { resumeId: baseResumeId } = await getConfiguredRxResumeBaseResumeId();
  if (!baseResumeId) {
    throw new Error(
      "No Resume Studio document found, and no Reactive Resume base resume is configured. Import a resume into Resume Studio or select a base resume in Settings.",
    );
  }

  const baseResume = await getRxResume(baseResumeId);
  if (!baseResume.data || typeof baseResume.data !== "object") {
    throw new Error("Reactive Resume base resume is empty or invalid.");
  }

  return {
    data: baseResume.data as Record<string, unknown>,
    mode: "v5",
  };
}

/**
 * Generate a tailored PDF resume for a job using the configured resume source.
 *
 * Flow:
 * 1. Prepare resume data with tailored content and project selection
 * 2. Normalize the tailored resume into the renderer document model
 * 3. Render a PDF with the active renderer
 */
export async function generatePdf(
  jobId: string,
  tailoredContent: TailoredPdfContent,
  jobDescription: string,
  _baseResumePath?: string, // Deprecated: now always uses Design Resume or the configured Reactive Resume base resume
  selectedProjectIds?: string | null,
  options?: GeneratePdfOptions,
): Promise<PdfResult> {
  let renderer: PdfRenderer | null = null;

  try {
    renderer = await resolvePdfRenderer();
    logger.info("Generating PDF resume", { jobId, renderer });

    // Ensure output directory exists
    await ensureOutputDir();

    // Resolve the target language up front so tailoring can merge onto the
    // language-specific master (if any) rather than the English primary.
    const language = await resolveRenderTargetLanguage(jobDescription);
    const baseResume = await loadBaseResumeSource({
      renderer,
      requestOrigin: options?.requestOrigin ?? null,
      language,
    });

    let preparedResume: Awaited<
      ReturnType<typeof prepareTailoredResumeForPdf>
    > | null = null;
    try {
      preparedResume = await prepareTailoredResumeForPdf({
        resumeData: baseResume.data,
        tailoredContent,
        jobDescription,
        selectedProjectIds,
        jobId,
        tracerLinks: {
          enabled: Boolean(options?.tracerLinksEnabled),
          requestOrigin: options?.requestOrigin ?? null,
          companyName: options?.tracerCompanyName ?? null,
        },
      });
    } catch (err) {
      logger.warn("Resume tailoring step failed during PDF generation", {
        jobId,
        error: err,
      });
      throw err;
    }

    const outputPath = getTenantJobPdfPath(jobId);
    // Localize onto the (possibly language-specific) base: section headings +
    // dates deterministically, prose via the LLM pass — which no-ops when the
    // base is already a hand-authored master in the target language.
    preparedResume.data = localizeResumeStaticText(
      preparedResume.data,
      language,
    );
    preparedResume.data = await translateResumeBody(
      preparedResume.data,
      language,
      jobId,
    );
    // Cosmetic: render round parentheses as square brackets (all themes + rxresume).
    preparedResume.data = bracketizeResumeProse(preparedResume.data);
    if (renderer !== "rxresume") {
      const [typstTheme, latexTheme, latexProjectLinkStyle] = await Promise.all(
        [
          renderer === "typst"
            ? resolveTypstTheme()
            : Promise.resolve(undefined),
          renderer === "latex"
            ? resolveLatexTheme()
            : Promise.resolve(undefined),
          renderer === "latex"
            ? resolveLatexProjectLinkStyle()
            : Promise.resolve(undefined),
        ],
      );
      await renderResumePdf({
        resumeJson: preparedResume.data,
        outputPath,
        jobId,
        language,
        renderer,
        typstTheme,
        latexTheme,
        latexProjectLinkStyle,
      });
    } else {
      await renderRxResumePdf({
        preparedResume,
        outputPath,
        jobId,
        requestOrigin: options?.requestOrigin ?? null,
      });
    }

    logger.info("PDF generated successfully", { jobId, outputPath, renderer });
    return { success: true, pdfPath: outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("PDF generation failed", { jobId, renderer, error });
    return {
      success: false,
      error: message,
      errorCode: classifyPdfGenerationError(error),
    };
  }
}

export async function generateDesignResumePdf(options?: {
  requestOrigin?: string | null;
  language?: ChatStyleManualLanguage;
}): Promise<DesignResumePdfResponse> {
  const renderer = await resolvePdfRenderer();
  const requestedLanguage =
    options?.language && options.language !== "english"
      ? options.language
      : undefined;

  // Preview/download the language-specific master when one is selected, else
  // the primary. Falls back to the primary if the requested master is missing.
  const languageMaster = requestedLanguage
    ? await getDesignResumeForLanguage(requestedLanguage)
    : null;
  const source = languageMaster
    ? {
        documentId: languageMaster.id,
        title: languageMaster.title,
        data: parseV5ResumeData(
          languageMaster.resumeJson as Record<string, unknown>,
        ) as Record<string, unknown>,
      }
    : await resolveDesignResumeForRenderer({
        renderer,
        requestOrigin: options?.requestOrigin ?? null,
      });

  const generatedAt = new Date().toISOString();
  const outputPath = getTenantDesignResumePdfPath();
  const preparedResume: PreparedRxResumePdfPayload = {
    mode: "v5",
    data: structuredClone(source.data) as Record<string, unknown>,
    projectCatalog: [],
    selectedProjectIds: [],
  };

  await ensureOutputDir();
  const language =
    requestedLanguage ?? (await resolveLocalResumeLanguage(source.data));
  const localizedData = localizeResumeStaticText(source.data, language);
  const translatedData = await translateResumeBody(
    localizedData,
    language,
    "design-resume",
  );
  // Cosmetic: render round parentheses as square brackets (all themes + rxresume).
  const styledData = bracketizeResumeProse(translatedData);
  preparedResume.data = styledData;

  logger.info("Generating Design Resume PDF", {
    renderer,
    documentId: source.documentId,
    language,
  });

  if (renderer !== "rxresume") {
    const typstTheme =
      renderer === "typst" ? await resolveTypstTheme() : undefined;
    const latexTheme =
      renderer === "latex" ? await resolveLatexTheme() : undefined;
    const latexProjectLinkStyle =
      renderer === "latex" ? await resolveLatexProjectLinkStyle() : undefined;
    await renderResumePdf({
      resumeJson: styledData,
      outputPath,
      jobId: "design-resume",
      language,
      renderer,
      typstTheme,
      latexTheme,
      latexProjectLinkStyle,
    });
  } else {
    await renderRxResumePdf({
      preparedResume,
      outputPath,
      jobId: "design-resume",
      name: source.title,
      requestOrigin: options?.requestOrigin ?? null,
    });
  }

  return {
    fileName: safePdfFileName(source.title, {
      fallbackBase: "Design_Resume",
      language,
    }),
    pdfUrl: `/api/design-resume/pdf?v=${encodeURIComponent(generatedAt)}`,
    generatedAt,
  };
}

/**
 * Check if a PDF exists for a job.
 */
export async function pdfExists(jobId: string): Promise<boolean> {
  const pdfPath = getTenantJobPdfPath(jobId);
  try {
    await access(pdfPath);
    return true;
  } catch {
    try {
      await access(getLegacyJobPdfPath(jobId));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get the path to a job's PDF.
 */
export function getPdfPath(jobId: string): string {
  const pdfPath = getTenantJobPdfPath(jobId);
  if (existsSync(pdfPath)) return pdfPath;
  return getLegacyJobPdfPath(jobId);
}
