import type {
  DesignResumeDocument,
  LatexTheme,
  PdfRenderer,
  TypstTheme,
} from "@shared/types";
import {
  LATEX_THEME_LABELS,
  LATEX_THEME_VALUES,
  PDF_RENDERER_LABELS,
  PDF_RENDERER_VALUES,
  TYPST_THEME_LABELS,
  TYPST_THEME_VALUES,
} from "@shared/types";
import { Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DesignResumePdfPreview } from "./DesignResumePdfPreview";

type DesignResumePreviewPanelProps = {
  draft: DesignResumeDocument;
  pdfRenderer: PdfRenderer;
  typstTheme: TypstTheme;
  latexTheme: LatexTheme;
  isUpdatingRenderer: boolean;
  isDirty: boolean;
  saveState: "idle" | "saving" | "saved" | "error";
  onPdfRendererChange: (renderer: PdfRenderer) => void;
  onTypstThemeChange: (theme: TypstTheme) => void;
  onLatexThemeChange: (theme: LatexTheme) => void;
  className?: string;
};

export function DesignResumePreviewPanel({
  draft,
  pdfRenderer,
  typstTheme,
  latexTheme,
  isUpdatingRenderer,
  isDirty,
  saveState,
  onPdfRendererChange,
  onTypstThemeChange,
  onLatexThemeChange,
  className,
}: DesignResumePreviewPanelProps) {
  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", className)}
    >
      <div className="flex flex-wrap items-start justify-end gap-4 py-4">
        <Button variant="outline" size="sm" className="mr-auto gap-1.5" asChild>
          <Link to="/settings#cover-letter">
            <Mail className="h-4 w-4" />
            Cover letter settings
          </Link>
        </Button>
        <Select
          value={pdfRenderer}
          onValueChange={(value) => onPdfRendererChange(value as PdfRenderer)}
          disabled={isUpdatingRenderer}
        >
          <SelectTrigger id="design-resume-template" className="w-full sm:w-72">
            <SelectValue placeholder="Choose a template" />
          </SelectTrigger>
          <SelectContent>
            {PDF_RENDERER_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {PDF_RENDERER_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pdfRenderer === "typst" ? (
          <Select
            value={typstTheme}
            onValueChange={(value) => onTypstThemeChange(value as TypstTheme)}
            disabled={isUpdatingRenderer}
          >
            <SelectTrigger
              id="design-resume-typst-theme"
              className="w-full sm:w-52"
            >
              <SelectValue placeholder="Choose a Typst theme" />
            </SelectTrigger>
            <SelectContent>
              {TYPST_THEME_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {TYPST_THEME_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {pdfRenderer === "latex" ? (
          <Select
            value={latexTheme}
            onValueChange={(value) => onLatexThemeChange(value as LatexTheme)}
            disabled={isUpdatingRenderer}
          >
            <SelectTrigger
              id="design-resume-latex-theme"
              className="w-full sm:w-52"
            >
              <SelectValue placeholder="Choose a LaTeX template" />
            </SelectTrigger>
            <SelectContent>
              {LATEX_THEME_VALUES.filter((value) => value !== "jake").map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {LATEX_THEME_LABELS[value]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <DesignResumePdfPreview
          draft={draft}
          pdfRenderer={pdfRenderer}
          typstTheme={typstTheme}
          latexTheme={latexTheme}
          isUpdatingRenderer={isUpdatingRenderer}
          isDirty={isDirty}
          saveState={saveState}
        />
      </div>
    </section>
  );
}
