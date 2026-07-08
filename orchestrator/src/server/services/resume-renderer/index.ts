import type {
  LatexProjectLinkStyle,
  LatexTheme,
  PdfRenderer,
  TypstTheme,
} from "@shared/types";
import { buildResumeRenderDocument } from "./document";
import { renderLatexPdf } from "./latex";
import type { NormalizeResumeJsonOptions } from "./types";
import { renderTypstPdf } from "./typst";

export { buildResumeRenderDocument } from "./document";
export {
  getLatexTemplatePath,
  getTectonicBinary,
  readLatexTemplate,
} from "./latex";
export type * from "./types";
export {
  getTypstBinary,
  getTypstTemplatePath,
  readTypstTemplate,
} from "./typst";

type LocalPdfRenderer = Exclude<PdfRenderer, "rxresume">;

export async function renderResumePdf(args: {
  resumeJson: Record<string, unknown>;
  outputPath: string;
  jobId: string;
  language?: NormalizeResumeJsonOptions["language"];
  renderer?: LocalPdfRenderer;
  typstTheme?: TypstTheme;
  latexTheme?: LatexTheme;
  latexProjectLinkStyle?: LatexProjectLinkStyle;
}): Promise<void> {
  const document = buildResumeRenderDocument(args.resumeJson, {
    language: args.language,
    projectLinkStyle: args.latexProjectLinkStyle,
  });
  if (args.renderer === "typst") {
    await renderTypstPdf({
      document,
      outputPath: args.outputPath,
      jobId: args.jobId,
      typstTheme: args.typstTheme,
    });
    return;
  }

  await renderLatexPdf({
    document,
    outputPath: args.outputPath,
    jobId: args.jobId,
    latexTheme: args.latexTheme,
  });
}
