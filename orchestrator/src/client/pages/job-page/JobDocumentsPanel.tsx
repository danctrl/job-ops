import * as api from "@client/api";
import { PdfCanvasPreview } from "@client/components/PdfCanvasPreview";
import type { Job, JobDocument } from "@shared/types.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  ExternalLink,
  File as FileIcon,
  FileSignature,
  FileText,
  ImageIcon,
  Loader2,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/client/components/ConfirmDelete";
import { Tip } from "@/client/components/Tip";
import { TooltipWhenDisabled } from "@/client/components/TooltipWhenDisabled";
import { showErrorToast } from "@/client/lib/error-toast";
import { fileToUploadPayload } from "@/client/lib/file-upload-payload";
import { uploadJobDocumentFromFile } from "@/client/lib/job-document-upload";
import {
  canPreviewJobDocumentAsObject,
  canPreviewJobDocumentAsText,
  formatJobDocumentByteSize,
  isJobDocumentPdf,
  isJobDocumentSafeInlineImage,
  isJobDocumentTextLike,
} from "@/client/lib/job-documents";
import {
  createJobCoverLetterObjectUrl,
  createJobDocumentObjectUrl,
  createJobPdfObjectUrl,
  downloadJobDocument,
  openJobCoverLetter,
  openJobDocument,
} from "@/client/lib/private-pdf";
import { queryKeys } from "@/client/lib/queryKeys";
import { useObjectUrl } from "@/client/lib/useObjectUrl";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatDateTime } from "@/lib/utils";

type JobDocumentsPanelProps = {
  job: Job;
  isStalePdf: boolean;
  isUploadingPdf: boolean;
  pdfActionsDisabled: boolean;
  pdfRegeneratingReason: string | null;
  stalePdfMessage: string;
  onUploadPdf: () => void;
  onViewPdf: () => void;
  onDownloadPdf: () => void;
  onDownloadCoverLetter: () => void;
  onRegeneratePdf: () => void | Promise<void>;
};

function DocumentIcon({
  document,
}: {
  document: Pick<JobDocument, "fileName" | "mediaType">;
}) {
  if (isJobDocumentPdf(document) || isJobDocumentTextLike(document)) {
    return <FileText className="h-3.5 w-3.5 text-sky-400/80" />;
  }
  if (isJobDocumentSafeInlineImage(document)) {
    return <ImageIcon className="h-3.5 w-3.5 text-emerald-400/80" />;
  }
  return <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />;
}

const FRESHNESS_PILL: Record<
  Job["resumeFreshness"],
  { label: string; className: string; tooltip: string }
> = {
  current: {
    label: "Up to date",
    className: "bg-emerald-500/10 text-emerald-300",
    tooltip: "The PDF matches your saved tailored content.",
  },
  stale: {
    label: "Out of date",
    className: "bg-amber-500/10 text-amber-300",
    tooltip:
      "Text saved — the PDF rebuilds automatically. Use Rebuild now to do it now.",
  },
  uploaded: {
    label: "Uploaded",
    className: "bg-sky-500/10 text-sky-300",
    tooltip: "Your uploaded file. It won't be changed automatically.",
  },
  regenerating: {
    label: "Updating…",
    className: "bg-amber-500/10 text-amber-300",
    tooltip: "Rebuilding the PDF from your latest changes…",
  },
  missing: {
    label: "Missing",
    className: "bg-amber-500/10 text-amber-300",
    tooltip: "No PDF has been generated yet.",
  },
};

const FreshnessPill: React.FC<{
  freshness: Job["resumeFreshness"];
  tooltip?: string;
}> = ({ freshness, tooltip }) => {
  const pill = FRESHNESS_PILL[freshness];
  return (
    <Tip content={tooltip ?? pill.tooltip} asChild>
      <Badge
        variant="outline"
        className={cn("border-0 text-[10px]", pill.className)}
      >
        {pill.label}
      </Badge>
    </Tip>
  );
};

const DocumentPreview: React.FC<{
  document: JobDocument;
}> = ({ document }) => {
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const canPreviewAsObject = canPreviewJobDocumentAsObject(document);
  const canPreviewAsText = canPreviewJobDocumentAsText(document);
  const loadObjectUrl = useCallback(
    () =>
      canPreviewAsObject
        ? createJobDocumentObjectUrl(document.jobId, document.id)
        : null,
    [canPreviewAsObject, document.id, document.jobId],
  );
  const { objectUrl, error } = useObjectUrl(loadObjectUrl);

  useEffect(() => {
    let cancelled = false;

    setTextPreview(null);
    setTextError(null);

    if (canPreviewAsText) {
      void api
        .getJobDocumentBlob(document.jobId, document.id)
        .then((blob) => blob.text())
        .then((text) => {
          if (!cancelled) setTextPreview(text.slice(0, 80_000));
        })
        .catch(() => {
          if (!cancelled) setTextError("Preview unavailable.");
        });
    }

    return () => {
      cancelled = true;
    };
  }, [canPreviewAsText, document.id, document.jobId]);

  if (!canPreviewAsObject && !canPreviewAsText) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-background/30 p-4 text-sm text-muted-foreground">
        This file type cannot be previewed here.
      </div>
    );
  }

  if (error || textError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error || textError}
      </div>
    );
  }

  if (canPreviewAsObject && objectUrl) {
    return isJobDocumentSafeInlineImage(document) ? (
      <div className="max-h-[560px] overflow-auto rounded-md border border-border/50 bg-background/40 p-3">
        <img
          src={objectUrl}
          alt={document.fileName}
          className="mx-auto max-h-[520px] max-w-full object-contain"
        />
      </div>
    ) : (
      <iframe
        title={document.fileName}
        src={objectUrl}
        className="h-[560px] w-full rounded-md border border-border/50 bg-background"
      />
    );
  }

  if (canPreviewAsText && textPreview !== null) {
    return (
      <pre className="max-h-[520px] overflow-auto rounded-md border border-border/50 bg-background/60 p-4 text-xs leading-6 text-foreground/80">
        {textPreview}
      </pre>
    );
  }

  return (
    <div className="flex min-h-32 items-center justify-center rounded-md border border-border/50 bg-background/30 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading preview
    </div>
  );
};

const ResumePdfPreview: React.FC<{ jobId: string }> = ({ jobId }) => {
  const loadObjectUrl = useCallback(
    () => createJobPdfObjectUrl(jobId),
    [jobId],
  );
  const { objectUrl, error } = useObjectUrl(loadObjectUrl);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-md border border-border/50 bg-background/30 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading preview
      </div>
    );
  }

  return (
    <PdfCanvasPreview
      src={objectUrl}
      title="Resume PDF"
      zoomable
      fit="page"
      className="h-[85vh] max-h-[1080px] min-h-[630px] w-full"
    />
  );
};

const CoverLetterPdfPreview: React.FC<{ jobId: string }> = ({ jobId }) => {
  const loadObjectUrl = useCallback(
    () => createJobCoverLetterObjectUrl(jobId),
    [jobId],
  );
  const { objectUrl, error } = useObjectUrl(loadObjectUrl);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-md border border-border/50 bg-background/30 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading preview
      </div>
    );
  }

  return (
    <PdfCanvasPreview
      src={objectUrl}
      title="Cover letter PDF"
      zoomable
      fit="page"
      className="h-[85vh] max-h-[1080px] min-h-[630px] w-full"
    />
  );
};

export const JobDocumentsPanel: React.FC<JobDocumentsPanelProps> = ({
  job,
  isStalePdf,
  isUploadingPdf,
  pdfActionsDisabled,
  pdfRegeneratingReason,
  stalePdfMessage,
  onUploadPdf,
  onViewPdf,
  onDownloadPdf,
  onDownloadCoverLetter,
  onRegeneratePdf,
}) => {
  const queryClient = useQueryClient();
  const uploadDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<JobDocument | null>(
    null,
  );
  const [isGeneratingCoverLetter, setIsGeneratingCoverLetter] = useState(false);
  const [isRegeneratingResume, setIsRegeneratingResume] = useState(false);
  const [isUploadingCoverLetter, setIsUploadingCoverLetter] = useState(false);
  const [pendingPdfDelete, setPendingPdfDelete] = useState<
    "resume" | "cover" | null
  >(null);
  const [isDeletingPdf, setIsDeletingPdf] = useState(false);
  const coverLetterInputRef = useRef<HTMLInputElement | null>(null);

  // Once applied, the application is sent — documents are read-only: no upload,
  // replace, delete or rebuild (rebuilding would also bounce the job out of
  // Applied). View/Download stay available.
  const isApplied = job.status === "applied" || job.status === "in_progress";

  const documentsQuery = useQuery({
    queryKey: queryKeys.jobs.documents(job.id),
    queryFn: () => api.getJobDocuments(job.id),
  });

  // Only the resume starts expanded; the cover letter stays collapsed.
  const defaultAccordionValues = useMemo(() => ["resume-pdf"], []);

  const handleRegenerateResume = async () => {
    try {
      setIsRegeneratingResume(true);
      await onRegeneratePdf();
    } finally {
      setIsRegeneratingResume(false);
    }
  };

  const handleGenerateCoverLetter = async () => {
    try {
      setIsGeneratingCoverLetter(true);
      await api.generateCoverLetter(job.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(job.id),
      });
      toast.success(
        job.coverLetterPath
          ? "Cover letter regenerated"
          : "Cover letter generated",
      );
    } catch (error) {
      showErrorToast(error, "Failed to generate cover letter");
    } finally {
      setIsGeneratingCoverLetter(false);
    }
  };

  const handleReplaceCoverLetter = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (coverLetterInputRef.current) coverLetterInputRef.current.value = "";
    if (!file) return;
    try {
      setIsUploadingCoverLetter(true);
      const payload = await fileToUploadPayload(
        file,
        "Cover letter PDF could not be encoded for upload.",
      );
      await api.uploadCoverLetterPdf(job.id, {
        fileName: payload.fileName,
        mediaType: payload.mediaType ?? undefined,
        dataBase64: payload.dataBase64,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(job.id),
      });
      toast.success("Cover letter uploaded");
    } catch (error) {
      showErrorToast(error, "Failed to replace cover letter");
    } finally {
      setIsUploadingCoverLetter(false);
    }
  };

  const refreshDocuments = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.jobs.documents(job.id),
    });
  };

  const handleUploadDocument = async (file: globalThis.File) => {
    try {
      setIsUploadingDocument(true);
      await uploadJobDocumentFromFile(job.id, file);
      await refreshDocuments();
      toast.success("Document uploaded");
    } catch (error) {
      showErrorToast(error, "Failed to upload document");
    } finally {
      setIsUploadingDocument(false);
      if (uploadDocumentInputRef.current) {
        uploadDocumentInputRef.current.value = "";
      }
    }
  };

  const handleDeleteDocument = async () => {
    if (!documentToDelete) return;
    try {
      await api.deleteJobDocument(job.id, documentToDelete.id);
      await refreshDocuments();
      toast.success("Document deleted");
    } catch (error) {
      showErrorToast(error, "Failed to delete document");
    } finally {
      setDocumentToDelete(null);
    }
  };

  const handleConfirmPdfDelete = async () => {
    const target = pendingPdfDelete;
    if (!target) return;
    try {
      setIsDeletingPdf(true);
      if (target === "resume") {
        await api.deleteJobPdf(job.id);
      } else {
        await api.deleteCoverLetterPdf(job.id);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(job.id),
      });
      toast.success(
        target === "resume"
          ? "Uploaded resume deleted"
          : "Uploaded cover letter deleted",
      );
    } catch (error) {
      showErrorToast(
        error,
        target === "resume"
          ? "Failed to delete resume PDF"
          : "Failed to delete cover letter PDF",
      );
    } finally {
      setIsDeletingPdf(false);
      setPendingPdfDelete(null);
    }
  };

  return (
    <>
      <section className="rounded-xl border border-border/50 bg-card/75">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2 text-base font-semibold">
            <FileText className="h-4 w-4" />
            Documents
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    isUploadingDocument ||
                    isUploadingPdf ||
                    isUploadingCoverLetter
                  }
                >
                  {isUploadingDocument ||
                  isUploadingPdf ||
                  isUploadingCoverLetter ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Upload PDF
                  <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => uploadDocumentInputRef.current?.click()}
                  disabled={isUploadingDocument}
                >
                  <FileIcon className="mr-2 h-4 w-4" />
                  Document
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onUploadPdf}
                  disabled={isUploadingPdf || isApplied}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Resume
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => coverLetterInputRef.current?.click()}
                  disabled={isUploadingCoverLetter || isApplied}
                >
                  <FileSignature className="mr-2 h-4 w-4" />
                  Cover letter
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <Accordion
            type="multiple"
            defaultValue={defaultAccordionValues}
            className="space-y-3"
          >
            {job.pdfPath ? (
              <AccordionItem
                value="resume-pdf"
                className="overflow-hidden rounded-lg border border-border/45 bg-muted/25"
              >
                <div className="relative">
                  <AccordionTrigger className="flex items-center justify-between gap-2 border-b border-border/35 bg-muted/5 px-3 py-2.5 pr-4 text-left hover:bg-muted/40 hover:no-underline">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                        <FileText className="h-3.5 w-3.5 text-sky-400/80" />
                        Resume
                        <FreshnessPill freshness={job.resumeFreshness} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground/65">
                        Generated or uploaded application material for this job.
                      </p>
                    </div>
                  </AccordionTrigger>
                  <div className="flex flex-wrap justify-end gap-1 border-b border-border/35 bg-muted/5 px-3 pb-2 sm:absolute sm:right-8 sm:top-1/2 sm:border-b-0 sm:bg-transparent sm:p-0 sm:-translate-y-1/2">
                    <TooltipWhenDisabled
                      reason={pdfRegeneratingReason}
                      className="w-auto"
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onViewPdf}
                        disabled={pdfActionsDisabled}
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Open
                      </Button>
                    </TooltipWhenDisabled>
                    <TooltipWhenDisabled
                      reason={pdfRegeneratingReason}
                      className="w-auto"
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onDownloadPdf}
                        disabled={pdfActionsDisabled}
                      >
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Download
                      </Button>
                    </TooltipWhenDisabled>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onUploadPdf}
                      disabled={isUploadingPdf || isApplied}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      Replace
                    </Button>
                    {job.pdfSource === "uploaded" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => setPendingPdfDelete("resume")}
                        disabled={isDeletingPdf || isApplied}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Delete
                      </Button>
                    ) : (
                      <Tip
                        content={
                          isApplied
                            ? "This job is already applied — building is locked."
                            : job.resumeFreshness === "current"
                              ? "Resume PDF is already up-to-date."
                              : "Rebuild the PDF now from your latest changes."
                        }
                        asChild
                        clickBehavior="none"
                      >
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleRegenerateResume()}
                          disabled={
                            isRegeneratingResume ||
                            Boolean(pdfRegeneratingReason) ||
                            job.resumeFreshness === "current" ||
                            isApplied
                          }
                        >
                          {isRegeneratingResume || pdfRegeneratingReason ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Rebuild now
                        </Button>
                      </Tip>
                    )}
                  </div>
                </div>
                <AccordionContent className="p-0">
                  <div className="space-y-3 bg-background/20 p-4">
                    {isStalePdf ? (
                      <div className="flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{stalePdfMessage}</span>
                      </div>
                    ) : null}
                    {/* Remount on each PDF change so the preview refetches the
                        new file (the object URL is keyed only on jobId). */}
                    <ResumePdfPreview
                      key={job.pdfGeneratedAt ?? job.pdfPath ?? "none"}
                      jobId={job.id}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {job.coverLetterPath ? (
              <AccordionItem
                value="cover-letter"
                className="overflow-hidden rounded-lg border border-border/45 bg-muted/25"
              >
                <div className="relative">
                  <AccordionTrigger className="flex items-center justify-between gap-2 border-b border-border/35 bg-muted/5 px-3 py-2.5 pr-4 text-left hover:bg-muted/40 hover:no-underline">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                        <FileSignature className="h-3.5 w-3.5 text-violet-400/80" />
                        Cover letter
                        <FreshnessPill
                          freshness={job.coverLetterFreshness}
                          tooltip={
                            job.coverLetterFreshness === "stale"
                              ? "This cover letter predates your latest changes. Use Rebuild now to refresh it."
                              : undefined
                          }
                        />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground/65">
                        AI-generated or uploaded cover letter for this job.
                      </p>
                    </div>
                  </AccordionTrigger>
                  <div className="flex flex-wrap justify-end gap-1 border-b border-border/35 bg-muted/5 px-3 pb-2 sm:absolute sm:right-8 sm:top-1/2 sm:border-b-0 sm:bg-transparent sm:p-0 sm:-translate-y-1/2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void openJobCoverLetter(job.id).catch((error) =>
                          showErrorToast(error, "Could not open cover letter"),
                        )
                      }
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onDownloadCoverLetter}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => coverLetterInputRef.current?.click()}
                      disabled={isUploadingCoverLetter || isApplied}
                    >
                      {isUploadingCoverLetter ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Replace
                    </Button>
                    {job.coverLetterSource === "uploaded" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => setPendingPdfDelete("cover")}
                        disabled={isDeletingPdf || isApplied}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Delete
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleGenerateCoverLetter()}
                        disabled={
                          isGeneratingCoverLetter ||
                          job.coverLetterFreshness === "current" ||
                          isApplied
                        }
                      >
                        {isGeneratingCoverLetter ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Rebuild now
                      </Button>
                    )}
                  </div>
                </div>
                <AccordionContent className="p-0">
                  <div className="space-y-3 bg-background/20 p-4">
                    <CoverLetterPdfPreview
                      key={
                        job.coverLetterGeneratedAt ??
                        job.coverLetterPath ??
                        "none"
                      }
                      jobId={job.id}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {documentsQuery.data?.map((document) => (
              <AccordionItem
                key={document.id}
                value={document.id}
                className="overflow-hidden rounded-lg border border-border/45 bg-muted/25"
              >
                <div className="relative">
                  <AccordionTrigger className="flex items-center justify-between gap-2 border-b border-border/35 bg-muted/5 px-3 py-2.5 pr-4 text-left hover:bg-muted/40 hover:no-underline">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground/90">
                        <DocumentIcon document={document} />
                        <span className="truncate">{document.fileName}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground/65">
                        {document.mediaType || "Unknown type"} ·{" "}
                        {formatJobDocumentByteSize(document.byteSize)} ·
                        Uploaded{" "}
                        {formatDateTime(document.createdAt) ??
                          document.createdAt}
                      </p>
                    </div>
                  </AccordionTrigger>
                  <div className="flex flex-wrap justify-end gap-1 border-b border-border/35 bg-muted/5 px-3 pb-2 sm:absolute sm:right-8 sm:top-1/2 sm:border-b-0 sm:bg-transparent sm:p-0 sm:-translate-y-1/2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void openJobDocument(job.id, document).catch((error) =>
                          showErrorToast(error, "Could not open document"),
                        )
                      }
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void downloadJobDocument(
                          job.id,
                          document.id,
                          document.fileName,
                        ).catch((error) =>
                          showErrorToast(error, "Could not download document"),
                        )
                      }
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDocumentToDelete(document)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
                <AccordionContent className="p-0">
                  <div className="bg-background/20 p-4">
                    <DocumentPreview document={document} />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {documentsQuery.isLoading ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-border/50 bg-background/25 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading documents
            </div>
          ) : null}

          {!job.pdfPath &&
          !job.coverLetterPath &&
          documentsQuery.data?.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-background/25 p-6 text-sm text-muted-foreground">
              No documents attached yet.
            </div>
          ) : null}
        </div>
      </section>

      <input
        ref={uploadDocumentInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void handleUploadDocument(file);
        }}
      />

      <input
        ref={coverLetterInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => void handleReplaceCoverLetter(event)}
      />

      <ConfirmDelete
        isOpen={Boolean(documentToDelete)}
        onClose={() => setDocumentToDelete(null)}
        onConfirm={handleDeleteDocument}
        title="Delete document?"
        description={`This removes ${documentToDelete?.fileName ?? "this document"} from this job.`}
      />

      <ConfirmDelete
        isOpen={Boolean(pendingPdfDelete)}
        onClose={() => setPendingPdfDelete(null)}
        onConfirm={handleConfirmPdfDelete}
        title={
          pendingPdfDelete === "cover"
            ? "Delete uploaded cover letter?"
            : "Delete uploaded resume?"
        }
        description={
          pendingPdfDelete === "cover"
            ? "This removes the uploaded cover letter PDF so you can generate one again."
            : "This removes the uploaded resume PDF so you can generate one again."
        }
      />
    </>
  );
};
