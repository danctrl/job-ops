import { PdfCanvasPreview } from "@client/components/PdfCanvasPreview";
import { showErrorToast } from "@client/lib/error-toast";
import {
  createCoverLetterSamplePreviewObjectUrl,
  downloadCoverLetterSamplePreview,
} from "@client/lib/private-pdf";
import { useObjectUrl } from "@client/lib/useObjectUrl";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import {
  COVER_LETTER_RENDERER_LABELS,
  COVER_LETTER_RENDERER_VALUES,
  COVER_LETTER_THEME_LABELS,
  COVER_LETTER_THEME_VALUES,
  type CoverLetterRenderer,
  type CoverLetterTheme,
  LATEX_THEME_LABELS,
  LATEX_THEME_VALUES,
  type LatexTheme,
} from "@shared/types.js";
import { Download, Loader2 } from "lucide-react";
import type React from "react";
import { useCallback } from "react";
import {
  type Path,
  type PathValue,
  useFormContext,
  useWatch,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CoverLetterSectionProps = {
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

export const CoverLetterSection: React.FC<CoverLetterSectionProps> = ({
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const { control, setValue } = useFormContext<UpdateSettingsInput>();

  const rendererValue = (useWatch({
    control,
    name: "coverLetterRenderer",
  }) ?? "typst") as CoverLetterRenderer;
  const themeValue = (useWatch({
    control,
    name: "coverLetterTheme",
  }) ?? "classic") as CoverLetterTheme;
  // The LaTeX cover letter shares the resume's latexTheme setting.
  const latexThemeValue = (useWatch({
    control,
    name: "latexTheme",
  }) ?? "jake") as LatexTheme;

  const disabled = isLoading || isSaving;

  const setDirtyTouchedValue = <TField extends Path<UpdateSettingsInput>>(
    field: TField,
    value: PathValue<UpdateSettingsInput, TField>,
  ) => setValue(field, value, { shouldDirty: true, shouldTouch: true });

  const loadPreview = useCallback(
    () =>
      createCoverLetterSamplePreviewObjectUrl({
        renderer: rendererValue,
        theme: themeValue,
        latexTheme: latexThemeValue,
      }),
    [rendererValue, themeValue, latexThemeValue],
  );
  const { objectUrl: previewUrl, error: previewError } =
    useObjectUrl(loadPreview);

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title="Cover letter"
      value="cover-letter"
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="cover-letter-renderer"
            className="text-sm font-medium"
          >
            Renderer
          </label>
          <Select
            value={rendererValue}
            onValueChange={(value) =>
              setDirtyTouchedValue(
                "coverLetterRenderer",
                value as CoverLetterRenderer,
              )
            }
            disabled={disabled}
          >
            <SelectTrigger id="cover-letter-renderer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COVER_LETTER_RENDERER_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {COVER_LETTER_RENDERER_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Engine used to compile the cover letter PDF.
          </p>
        </div>

        {rendererValue === "typst" ? (
          <div className="space-y-1.5">
            <label htmlFor="cover-letter-theme" className="text-sm font-medium">
              Template
            </label>
            <Select
              value={themeValue}
              onValueChange={(value) =>
                setDirtyTouchedValue(
                  "coverLetterTheme",
                  value as CoverLetterTheme,
                )
              }
              disabled={disabled}
            >
              <SelectTrigger id="cover-letter-theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COVER_LETTER_THEME_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {COVER_LETTER_THEME_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Typst template used for generated cover letters.
            </p>
          </div>
        ) : null}

        {rendererValue === "latex" ? (
          <div className="space-y-1.5">
            <label
              htmlFor="cover-letter-latex-theme"
              className="text-sm font-medium"
            >
              Template
            </label>
            <Select
              value={latexThemeValue}
              onValueChange={(value) =>
                setDirtyTouchedValue("latexTheme", value as LatexTheme)
              }
              disabled={disabled}
            >
              <SelectTrigger id="cover-letter-latex-theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LATEX_THEME_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {LATEX_THEME_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              LaTeX template used for generated cover letters. This is shared
              with the résumé LaTeX template — danctrl is the exact Awesome-CV
              design.
            </p>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Preview</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!previewUrl}
              onClick={() =>
                void downloadCoverLetterSamplePreview(
                  "cover-letter-sample.pdf",
                  {
                    renderer: rendererValue,
                    theme: themeValue,
                    latexTheme: latexThemeValue,
                  },
                ).catch((error) =>
                  showErrorToast(error, "Could not download preview"),
                )
              }
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>
          {previewError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {previewError}
            </div>
          ) : previewUrl ? (
            <PdfCanvasPreview
              src={previewUrl}
              title="Cover letter sample preview"
              zoomable
              fit="page"
              className="h-[85vh] max-h-[1080px] min-h-[630px] w-full"
            />
          ) : (
            <div className="flex h-[85vh] max-h-[1080px] min-h-[630px] w-full items-center justify-center rounded-md border border-border/50 bg-neutral-200 text-sm text-muted-foreground dark:bg-neutral-800">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Rendering sample preview
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Sample content rendered with the selected renderer and template.
          </p>
        </div>
      </div>
    </SettingsSectionFrame>
  );
};
