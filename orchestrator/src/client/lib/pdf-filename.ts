import { detectProfileLanguage } from "@shared/language-detection";
import type {
  AppSettings,
  ChatStyleManualLanguage,
  ResumeProfile,
} from "@shared/types";
import { safeFilenamePart } from "@/lib/utils";

/**
 * Shared "{Name}_{Employer}_{type}.pdf" naming for downloaded application
 * documents, e.g. "Daniel_Guntermann_Mercor_resume.pdf". Keeps the resume and
 * cover letter names consistent across every surface that offers a download.
 */
export function buildPdfFilenames(args: {
  personName: string | null | undefined;
  employer: string | null | undefined;
  language: ChatStyleManualLanguage | undefined;
}): { resume: string; coverLetter: string } {
  const opts = { language: args.language };
  const base = `${safeFilenamePart(args.personName || "Unknown", opts)}_${safeFilenamePart(
    args.employer || "Unknown",
    opts,
  )}`;
  return {
    resume: `${base}_resume.pdf`,
    coverLetter: `${base}_cover_letter.pdf`,
  };
}

export function resolveFilenameLanguage(args: {
  settings: AppSettings | null;
  profile: ResumeProfile | null;
}): ChatStyleManualLanguage | undefined {
  const languageMode =
    args.settings?.chatStyleLanguageMode?.value ??
    args.settings?.chatStyleLanguageMode?.default ??
    "manual";

  if (languageMode === "manual") {
    return (
      args.settings?.chatStyleManualLanguage?.value ??
      args.settings?.chatStyleManualLanguage?.default ??
      "english"
    );
  }

  if (languageMode === "match-resume") {
    return args.profile
      ? (detectProfileLanguage(args.profile) ?? "english")
      : "english";
  }

  return "english";
}
