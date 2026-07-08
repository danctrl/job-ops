import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "@infra/logger";
import { getDataDir } from "@server/config/dataDir";
import type {
  CoverLetterRenderer,
  CoverLetterTheme,
  LatexTheme,
} from "@shared/types";
import {
  composeHeaderSocialLinks,
  emphasizeNamePrefix,
  type SocialProfileInput,
} from "./header-social";
import { prepareDanctrlAssets } from "./latex";

const TYPST_TIMEOUT_MS = 60_000;
const TECTONIC_TIMEOUT_MS = 120_000;
const TYPST_OUTPUT_FILENAME = "cover-letter.pdf";
const LATEX_OUTPUT_FILENAME = "cover-letter.pdf";
// Optional handwritten signature, read from the user's data dir (never the
// repo). When present it's staged next to the .tex and shown above the name.
const SIGNATURE_FILENAME = "signature.png";

/**
 * Resolve a directory that ships alongside this module, falling back to a
 * cwd-relative path. Mirrors the resolution used by the resume renderer's
 * latex.ts / typst.ts so it works both bundled and from source.
 */
function resolveRendererPath(...segments: string[]): string {
  try {
    if (import.meta.url.startsWith("file:")) {
      const modulePath = fileURLToPath(import.meta.url);
      const candidate = join(modulePath, "..", ...segments);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Fall through to cwd-based resolution below.
  }

  const cwd = process.cwd();
  const base = cwd.endsWith("/orchestrator")
    ? join(cwd, "src/server/services/resume-renderer")
    : join(cwd, "orchestrator/src/server/services/resume-renderer");
  return join(base, ...segments);
}

function getCoverLetterTypstTemplatePath(theme: CoverLetterTheme): string {
  return resolveRendererPath("cover-letter-themes", theme, "main.typ");
}

function getCoverLetterLatexTemplatePath(): string {
  return resolveRendererPath("cover-letter-templates", "jake-cover-letter.tex");
}

function getCoverLetterDanctrlTemplatePath(): string {
  return resolveRendererPath(
    "cover-letter-templates",
    "danctrl-cover-letter.tex",
  );
}

function normalizeText(value: string): string {
  return value
    .replace(/‐|‑|‒|–|—/g, "-")
    .replace(/•/g, "-")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function escapeTypst(value: string): string {
  return normalizeText(value).replace(/([\\#*$@_[\]{}<>`])/g, "\\$1");
}

function escapeLatex(value: string): string {
  return normalizeText(value)
    .replace(/\\/g, "￿")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/￿/g, "\\textbackslash{}");
}

function truncateOutput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 1200) return trimmed;
  return `${trimmed.slice(0, 1200)}...(truncated ${trimmed.length - 1200} chars)`;
}

async function runCompiler(args: {
  binary: string;
  spawnArgs: string[];
  cwd: string;
  timeoutMs: number;
  label: string;
  jobId: string;
  notFoundMessage: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(args.binary, args.spawnArgs, {
      cwd: args.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `${args.label} timed out after ${args.timeoutMs / 1000}s while rendering cover letter PDF.`,
        ),
      );
    }, args.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(args.notFoundMessage));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${args.label} failed with exit code ${code ?? "unknown"}. ${truncateOutput(stderr || stdout)}`,
        ),
      );
    });
  });
}

/**
 * Structured personal information used to build the Awesome-CV (danctrl) letter
 * header with FontAwesome social icons. Other renderers use the flat
 * `contactLine` instead and ignore this.
 */
export interface CoverLetterPersonalInfo {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  location?: string | null;
  /** Social profiles, rendered generically in the header's social row. */
  socialLinks?: SocialProfileInput[];
  headline?: string | null;
  quote?: string | null;
}

export interface RenderCoverLetterPdfArgs {
  renderer: CoverLetterRenderer;
  theme: CoverLetterTheme;
  latexTheme?: LatexTheme;
  name: string;
  contactLine: string;
  personal?: CoverLetterPersonalInfo;
  date: string;
  recipientLines: string[];
  salutation: string;
  paragraphs: string[];
  closing: string;
  outputPath: string;
  jobId: string;
  /**
   * Filename of a signature image staged next to the .tex (danctrl only). When
   * set, the closing renders the image above the typed name. The file itself is
   * copied into the build dir by the renderer; it never lives in the repo.
   */
  signatureFilename?: string | null;
}

async function renderWithTemplate(args: {
  template: string;
  outputFilename: string;
  binary: string;
  buildSpawnArgs: (typPath: string, outputPath: string) => string[];
  timeoutMs: number;
  label: string;
  notFoundMessage: string;
  sourceExtension: string;
  outputPath: string;
  jobId: string;
  prepareAssets?: (tempDir: string) => Promise<void>;
}): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "job-ops-cover-letter-"));
  const sourcePath = join(tempDir, `cover-letter.${args.sourceExtension}`);
  const compiledPdfPath = join(tempDir, args.outputFilename);

  try {
    await args.prepareAssets?.(tempDir);
    await writeFile(sourcePath, args.template, "utf8");
    await runCompiler({
      binary: args.binary,
      spawnArgs: args.buildSpawnArgs(sourcePath, compiledPdfPath),
      cwd: tempDir,
      timeoutMs: args.timeoutMs,
      label: args.label,
      jobId: args.jobId,
      notFoundMessage: args.notFoundMessage,
    });
    await copyFile(compiledPdfPath, args.outputPath);
    logger.info("Rendered cover letter PDF", {
      jobId: args.jobId,
      outputPath: args.outputPath,
      renderer: args.label,
    });
  } catch (error) {
    logger.error("Failed to render cover letter PDF", {
      jobId: args.jobId,
      outputPath: args.outputPath,
      renderer: args.label,
      error,
    });
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(
      (cleanupError) => {
        logger.warn(
          "Failed to cleanup temporary cover letter render directory",
          { jobId: args.jobId, tempDir, error: cleanupError },
        );
      },
    );
  }
}

async function renderCoverLetterTypst(
  args: RenderCoverLetterPdfArgs,
): Promise<void> {
  const recipient = args.recipientLines
    .filter((line) => line.trim().length > 0)
    .map((line) => escapeTypst(line))
    .join(" \\\n");

  const body = args.paragraphs
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => escapeTypst(paragraph))
    .join("\n\n#v(6pt)\n\n");

  const rawTemplate = await readFile(
    getCoverLetterTypstTemplatePath(args.theme),
    "utf8",
  );

  const template = rawTemplate
    .replaceAll("__NAME__", () => escapeTypst(args.name))
    .replace("__CONTACT__", () => escapeTypst(args.contactLine))
    .replace("__DATE__", () => escapeTypst(args.date))
    .replace("__RECIPIENT__", () => recipient || "#none")
    .replace("__SALUTATION__", () => escapeTypst(args.salutation))
    .replace("__BODY__", () => body)
    .replace("__CLOSING__", () => escapeTypst(args.closing));

  await renderWithTemplate({
    template,
    outputFilename: TYPST_OUTPUT_FILENAME,
    binary: process.env.TYPST_BIN?.trim() || "typst",
    buildSpawnArgs: (typPath, outputPath) => ["compile", typPath, outputPath],
    timeoutMs: TYPST_TIMEOUT_MS,
    label: "Typst",
    notFoundMessage:
      "Typst binary not found. Install typst or set TYPST_BIN to the executable path.",
    sourceExtension: "typ",
    outputPath: args.outputPath,
    jobId: args.jobId,
  });
}

async function renderCoverLetterLatex(
  args: RenderCoverLetterPdfArgs,
): Promise<void> {
  const recipient = args.recipientLines
    .filter((line) => line.trim().length > 0)
    .map((line) => escapeLatex(line))
    .join("\\\\\n");

  const body = args.paragraphs
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => escapeLatex(paragraph))
    .join("\n\n");

  const rawTemplate = await readFile(getCoverLetterLatexTemplatePath(), "utf8");

  const template = rawTemplate
    .replaceAll("__NAME__", () => escapeLatex(args.name))
    .replace("__CONTACT__", () => escapeLatex(args.contactLine))
    .replace("__DATE__", () => escapeLatex(args.date))
    .replace("__RECIPIENT__", () => recipient)
    .replace("__SALUTATION__", () => escapeLatex(args.salutation))
    .replace("__BODY__", () => body)
    .replace("__CLOSING__", () => escapeLatex(args.closing));

  await renderWithTemplate({
    template,
    outputFilename: LATEX_OUTPUT_FILENAME,
    binary: process.env.TECTONIC_BIN?.trim() || "tectonic",
    buildSpawnArgs: (texPath, _outputPath) => [
      "--outdir",
      join(texPath, ".."),
      texPath,
    ],
    timeoutMs: TECTONIC_TIMEOUT_MS,
    label: "Tectonic",
    notFoundMessage:
      "Tectonic binary not found. Install tectonic or set TECTONIC_BIN to the executable path.",
    sourceExtension: "tex",
    outputPath: args.outputPath,
    jobId: args.jobId,
  });
}

function splitName(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { first: trimmed, last: "" };
  return {
    first: trimmed.slice(0, spaceIndex),
    last: trimmed.slice(spaceIndex + 1),
  };
}

function cleanUrlForDisplay(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** Build the Awesome-CV preamble personal-information block for the letter header. */
function buildDanctrlPersonalInfo(args: RenderCoverLetterPdfArgs): string {
  const { first, last } = splitName(args.name);
  const personal = args.personal ?? {};
  const lines: string[] = [
    `\\name{${emphasizeNamePrefix(first, escapeLatex)}}{${escapeLatex(last)}}`,
  ];

  if (personal.headline) {
    lines.push(`\\position{${escapeLatex(personal.headline)}}`);
  }
  if (personal.phone) lines.push(`\\mobile{${escapeLatex(personal.phone)}}`);
  if (personal.email) lines.push(`\\email{${escapeLatex(personal.email)}}`);
  if (personal.website) {
    lines.push(
      `\\homepage{${escapeLatex(cleanUrlForDisplay(personal.website))}}`,
    );
  }
  if (personal.location) {
    lines.push(`\\address{${escapeLatex(personal.location)}}`);
  }
  const socialLinks = composeHeaderSocialLinks(personal.socialLinks);
  if (socialLinks) lines.push(`\\headersociallinks{${socialLinks}}`);
  if (personal.quote) {
    lines.push(`\\quote{\`\`${escapeLatex(personal.quote)}''}`);
  }
  if (args.signatureFilename) {
    lines.push(`\\signature{${args.signatureFilename}}`);
  }

  return lines.join("\n");
}

/** Fill the danctrl cover-letter template from the render args (pure, testable). */
export function buildDanctrlCoverLetterDocument(
  template: string,
  args: RenderCoverLetterPdfArgs,
): string {
  const recipientLines = args.recipientLines.filter(
    (line) => line.trim().length > 0,
  );
  const recipientName = recipientLines[0] ? escapeLatex(recipientLines[0]) : "";
  const recipientAddress = recipientLines
    .slice(1)
    .map((line) => escapeLatex(line))
    .join("\\\\\n");

  const body = args.paragraphs
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => escapeLatex(paragraph))
    .join("\n\n");

  return template
    .replace("__PERSONAL_INFO__", () => buildDanctrlPersonalInfo(args))
    .replace("__RECIPIENT_NAME__", () => recipientName)
    .replace("__RECIPIENT_ADDRESS__", () => recipientAddress)
    .replace("__DATE__", () => escapeLatex(args.date))
    .replace("__SALUTATION__", () => escapeLatex(args.salutation))
    .replace("__CLOSING__", () => escapeLatex(args.closing))
    .replace("__BODY__", () => body);
}

async function renderCoverLetterDanctrl(
  args: RenderCoverLetterPdfArgs,
): Promise<void> {
  // Include the signature only when the user has one in their data dir.
  const signaturePath = join(getDataDir(), SIGNATURE_FILENAME);
  const hasSignature = existsSync(signaturePath);
  const effectiveArgs: RenderCoverLetterPdfArgs = hasSignature
    ? { ...args, signatureFilename: SIGNATURE_FILENAME }
    : args;

  const rawTemplate = await readFile(
    getCoverLetterDanctrlTemplatePath(),
    "utf8",
  );
  const template = buildDanctrlCoverLetterDocument(rawTemplate, effectiveArgs);

  await renderWithTemplate({
    template,
    outputFilename: LATEX_OUTPUT_FILENAME,
    binary: process.env.TECTONIC_BIN?.trim() || "tectonic",
    buildSpawnArgs: (texPath, _outputPath) => [
      "--outdir",
      join(texPath, ".."),
      texPath,
    ],
    timeoutMs: TECTONIC_TIMEOUT_MS,
    label: "Tectonic",
    notFoundMessage:
      "Tectonic binary not found. Install tectonic or set TECTONIC_BIN to the executable path.",
    sourceExtension: "tex",
    outputPath: args.outputPath,
    jobId: args.jobId,
    prepareAssets: async (tempDir) => {
      await prepareDanctrlAssets(tempDir);
      if (hasSignature) {
        await copyFile(signaturePath, join(tempDir, SIGNATURE_FILENAME));
      }
    },
  });
}

export async function renderCoverLetterPdf(
  args: RenderCoverLetterPdfArgs,
): Promise<void> {
  if (args.renderer === "latex") {
    if (args.latexTheme === "danctrl") {
      await renderCoverLetterDanctrl(args);
      return;
    }
    await renderCoverLetterLatex(args);
    return;
  }
  await renderCoverLetterTypst(args);
}
