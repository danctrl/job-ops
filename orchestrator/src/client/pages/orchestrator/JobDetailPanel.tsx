import * as api from "@client/api";
import {
  JobBriefPane,
  JobDescriptionPanel,
  JobHeader,
} from "@client/components";
import { GhostwriterDrawer } from "@client/components/ghostwriter/GhostwriterDrawer";
import { JobDetailsEditDrawer } from "@client/components/JobDetailsEditDrawer";
import { KbdHint } from "@client/components/KbdHint";
import { OpenJobListingButton } from "@client/components/OpenJobListingButton";
import { Tip } from "@client/components/Tip";
import { TooltipWhenDisabled } from "@client/components/TooltipWhenDisabled";
import { TailoringWorkspace } from "@client/components/tailoring/TailoringWorkspace";
import {
  useMarkAsAppliedMutation,
  useSkipJobMutation,
} from "@client/hooks/queries/useJobMutations";
import { useProfile } from "@client/hooks/useProfile";
import { useRescoreJob } from "@client/hooks/useRescoreJob";
import { useSettings } from "@client/hooks/useSettings";
import { fileToUploadPayload } from "@client/lib/file-upload-payload";
import { uploadJobDocumentFromFile } from "@client/lib/job-document-upload";
import { uploadJobPdfFromFile } from "@client/lib/job-pdf-upload";
import {
  buildPdfFilenames,
  resolveFilenameLanguage,
} from "@client/lib/pdf-filename";
import {
  isPdfRegenerating,
  isPdfStale,
  PDF_REGENERATING_MESSAGE,
  STALE_PDF_MESSAGE,
} from "@client/lib/pdf-freshness";
import {
  downloadJobCoverLetter,
  downloadJobPdf,
  openJobCoverLetter,
  openJobPdf,
} from "@client/lib/private-pdf";
import { queryKeys } from "@client/lib/queryKeys";
import type {
  Job,
  JobListItem,
  ResumeProjectCatalogItem,
} from "@shared/types.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  FileSignature,
  FileText,
  FolderKanban,
  Link2,
  Loader2,
  MoreHorizontal,
  Paperclip,
  RefreshCcw,
  Star,
  Upload,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { parseJobBrief } from "@/client/components/JobBriefPane";
import { showErrorToast } from "@/client/lib/error-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trackProductEvent } from "@/lib/analytics";
import { cn, copyTextToClipboard, formatJobForWebhook } from "@/lib/utils";
import type { FilterTab } from "./constants";

interface JobDetailPanelProps {
  activeTab: FilterTab;
  activeJobs: JobListItem[];
  selectedJob: Job | null;
  onSelectJobId: (jobId: string | null) => void;
  onJobUpdated: () => Promise<void>;
  onPauseRefreshChange?: (paused: boolean) => void;
}

type InspectorTab = "brief" | "tailoring" | "apply";

const tabCopy: Record<
  InspectorTab,
  {
    label: string;
    description: string;
    dotClassName: string;
    selectedClassName: string;
  }
> = {
  brief: {
    label: "Brief",
    description: "Read the role, fit, and job description.",
    dotClassName: "bg-sky-500/70",
    selectedClassName: "!border-sky-400/65 !bg-sky-500/20 !text-sky-100",
  },
  tailoring: {
    label: "Tailoring",
    description: "Shape the resume material for this job.",
    dotClassName: "bg-amber-500/70",
    selectedClassName: "!border-amber-400/65 !bg-amber-500/20 !text-amber-100",
  },
  apply: {
    label: "Apply",
    description: "Use the generated kit, Ghostwriter, and final actions.",
    dotClassName: "bg-emerald-500/70",
    selectedClassName:
      "!border-emerald-400/65 !bg-emerald-500/20 !text-emerald-100",
  },
};

const statusTone: Record<
  Job["status"],
  {
    shell: string;
    eyebrow: string;
    icon: string;
    button?: string;
  }
> = {
  discovered: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-sky-500/70",
  },
  processing: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-amber-500/70",
  },
  ready: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-emerald-500/70",
    button: "bg-emerald-600 text-white hover:bg-emerald-500",
  },
  applied: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-teal-500/70",
    button: "bg-teal-600 text-white hover:bg-teal-500",
  },
  in_progress: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-cyan-500/70",
  },
  skipped: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-rose-500/70",
  },
  expired: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-slate-500/70",
  },
};

const getPrimaryAction = (job: Job): string => {
  if (job.status === "processing") return "Processing";
  if (job.status === "ready") return "Mark Applied";
  if (job.status === "discovered") return "Start Tailoring";
  if (job.status === "applied") return "Move to In Progress";
  if (job.status === "in_progress") return "In Progress";
  if (job.status === "skipped") return "Skipped";
  if (job.status === "expired") return "Expired";
  return "Review Job";
};

// A freshly selected job opens on Brief so the user reads the role first —
// except a ready job, which is done building and opens on Apply so the
// application kit is front and center.
const getDefaultInspectorTab = (job: Job | null): InspectorTab => {
  if (job?.status === "ready") return "apply";
  return "brief";
};

const parseInspectorTab = (value: string | null): InspectorTab | null =>
  value === "brief" || value === "tailoring" || value === "apply"
    ? value
    : null;

const Stat: React.FC<{
  label: string;
  value?: string | null;
  tone?: "blue" | "green" | "neutral";
}> = ({ label, value, tone = "neutral" }) => {
  if (!value) return null;
  const toneClassName =
    tone === "blue"
      ? "border-sky-400/10 bg-muted/5"
      : tone === "green"
        ? "border-emerald-400/10 bg-muted/5"
        : "border-border/35 bg-muted/5";
  return (
    <div className={cn("min-w-0 rounded-md border px-3 py-2", toneClassName)}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-medium text-foreground/85">
        {value}
      </div>
    </div>
  );
};

const KitStatus: React.FC<{
  icon: React.ReactNode;
  label: string;
  ready: boolean;
  readyLabel?: string;
  optional?: boolean;
  action?: React.ReactNode;
}> = ({
  icon,
  label,
  ready,
  readyLabel = "Ready",
  optional = false,
  action,
}) => (
  <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border/30 px-3 py-2.5 last:border-b-0">
    <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <span className="text-muted-foreground/85">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
    <span className="flex shrink-0 items-center gap-2">
      {action}
      <span
        className={cn(
          "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
          ready
            ? "bg-emerald-500/10 text-emerald-300"
            : optional
              ? "bg-sky-500/10 text-sky-300"
              : "bg-amber-500/10 text-amber-300",
        )}
      >
        {ready ? readyLabel : optional ? "Optional" : "Missing"}
      </span>
    </span>
  </div>
);

export const JobDetailPanel: React.FC<JobDetailPanelProps> = ({
  activeTab,
  activeJobs,
  selectedJob,
  onSelectJobId,
  onJobUpdated,
  onPauseRefreshChange,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("brief");
  // Restore the inspector tab once when returning from the Job Page (it carries
  // the tab back via ?inspector=…), so the navigation circle closes.
  const initialInspectorFromUrlRef = useRef<InspectorTab | null>(
    parseInspectorTab(new URLSearchParams(location.search).get("inspector")),
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyPrompt, setApplyPrompt] = useState<
    "final-check-no-cover" | "confirm-apply" | null
  >(null);
  // Drives the Mark Applied button animation: spinning ring while the request
  // is in flight, then a checkmark that lingers briefly before the job moves.
  const [applyPhase, setApplyPhase] = useState<"idle" | "loading" | "success">(
    "idle",
  );
  // Local lock for the Tailoring "Build PDF" CTA so it rings + disables the
  // instant it's clicked, not only once the server flips pdfRegenerating.
  const [isBuildingPdf, setIsBuildingPdf] = useState(false);
  const [focusCoverLetter, setFocusCoverLetter] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isEditDetailsOpen, setIsEditDetailsOpen] = useState(false);
  const [catalog, setCatalog] = useState<ResumeProjectCatalogItem[]>([]);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [isGeneratingCoverLetter, setIsGeneratingCoverLetter] = useState(false);
  const [isUploadingCoverLetter, setIsUploadingCoverLetter] = useState(false);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [openedListingJobIds, setOpenedListingJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Resume Build PDF action, lifted from TailoringWorkspace so the inspector CTA
  // can trigger it when the draft is ready but the PDF isn't built yet.
  const buildPdfRef = useRef<(() => Promise<void>) | null>(null);
  const coverLetterBuildRef = useRef<(() => Promise<void>) | null>(null);
  // Stable registrars so the child's registration effect doesn't re-run each render.
  const registerBuildPdf = useCallback(
    (build: (() => Promise<void>) | null) => {
      buildPdfRef.current = build;
    },
    [],
  );
  const registerCoverLetterBuild = useCallback(
    (build: (() => Promise<void>) | null) => {
      coverLetterBuildRef.current = build;
    },
    [],
  );
  const uploadPdfInputRef = useRef<HTMLInputElement | null>(null);
  const uploadCoverLetterInputRef = useRef<HTMLInputElement | null>(null);
  const uploadDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const previousSelectionKeyRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const markAsAppliedMutation = useMarkAsAppliedMutation();
  const skipJobMutation = useSkipJobMutation();
  const { isRescoring, rescoreJob } = useRescoreJob(onJobUpdated);
  const { settings } = useSettings();
  const { personName, profile } = useProfile();
  const filenameLanguage = resolveFilenameLanguage({ settings, profile });

  const jobLink = selectedJob
    ? selectedJob.applicationLink || selectedJob.jobUrl
    : "#";
  const pdfFilenames = buildPdfFilenames({
    personName,
    employer: selectedJob?.employer,
    language: filenameLanguage,
  });
  const selectedPdfFilename = selectedJob ? pdfFilenames.resume : "resume.pdf";
  const selectedCoverLetterFilename = selectedJob
    ? pdfFilenames.coverLetter
    : "cover_letter.pdf";
  const selectedProjectIds = useMemo(
    () => selectedJob?.selectedProjectIds?.split(",").filter(Boolean) ?? [],
    [selectedJob?.selectedProjectIds],
  );
  const selectedProjects = useMemo(
    () =>
      selectedProjectIds
        .map((id) => catalog.find((project) => project.id === id)?.name ?? id)
        .filter(Boolean),
    [catalog, selectedProjectIds],
  );
  const additionalDocumentsQuery = useQuery({
    queryKey: queryKeys.jobs.documents(selectedJob?.id ?? "none"),
    queryFn: () => api.getJobDocuments(selectedJob?.id ?? ""),
    enabled: Boolean(selectedJob),
  });
  const additionalDocumentsCount = additionalDocumentsQuery.data?.length ?? 0;
  const hasTailoredSummary = Boolean(selectedJob?.tailoredSummary);
  const hasTailoredSkills = Boolean(selectedJob?.tailoredSkills);
  const hasResumePdf = Boolean(selectedJob?.pdfPath);
  const hasCoverLetter = Boolean(selectedJob?.coverLetterPath);
  // Uploaded PDFs are user-supplied and must never be overwritten by a rebuild.
  const resumeUploaded = selectedJob?.pdfSource === "uploaded";
  const coverUploaded = selectedJob?.coverLetterSource === "uploaded";
  const hasUploadedDoc = resumeUploaded || coverUploaded;
  const hasJobListing = Boolean(jobLink && jobLink !== "#");
  const hasOpenedJobListing = selectedJob
    ? openedListingJobIds.has(selectedJob.id)
    : false;
  const applicationKitReady =
    hasResumePdf &&
    (selectedJob?.resumeFreshness === "uploaded" ||
      (hasTailoredSummary && hasTailoredSkills));
  // Final check requires everything to be actually built. The resume PDF must be
  // current/uploaded, and if there's any cover-letter content it must be built
  // too (current/uploaded) — any hand/AI edit flips freshness so the button
  // re-greys until both PDFs are rebuilt. With no cover letter at all, the
  // no-cover prompt still applies.
  const resumeBuilt =
    selectedJob?.resumeFreshness === "current" ||
    selectedJob?.resumeFreshness === "uploaded";
  const coverLetterBuilt =
    selectedJob?.coverLetterFreshness === "current" ||
    selectedJob?.coverLetterFreshness === "uploaded";
  const hasCoverLetterContent =
    Boolean(selectedJob?.coverLetterPath) ||
    Boolean(selectedJob?.coverLetterDetails?.body?.trim());
  const finalCheckReady =
    resumeBuilt &&
    !selectedJob?.pdfRegenerating &&
    (!hasCoverLetterContent || coverLetterBuilt);
  // Draft is ready (resume sections generated) even if the PDF isn't built yet —
  // e.g. an auto-drafted high-rated job. Used to offer "Build PDF" instead of an
  // alarming "Finish tailoring" warning.
  const draftReady = hasTailoredSummary && hasTailoredSkills;
  const brief = parseJobBrief(selectedJob?.jobBrief || null);

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await api.getResumeProjectsCatalog());
    } catch {
      setCatalog([]);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    // Ignore transient null selections (e.g. while the job detail reloads after
    // a document upload bumps updatedAt). Only reset the inspector when the
    // selection genuinely changes to a different job or tab — otherwise a null
    // round-trip would bounce the user back to Brief.
    if (!selectedJob) return;
    const currentSelectionKey = `${activeTab}:${selectedJob.id}`;
    if (previousSelectionKeyRef.current === currentSelectionKey) return;
    previousSelectionKeyRef.current = currentSelectionKey;
    // On the first selection after mount, honor an inspector tab carried back
    // from the Job Page; otherwise fall back to the default (Brief).
    const restored = initialInspectorFromUrlRef.current;
    initialInspectorFromUrlRef.current = null;
    setInspectorTab(restored ?? getDefaultInspectorTab(selectedJob));
    setIsEditDetailsOpen(false);
    onPauseRefreshChange?.(false);
  }, [activeTab, selectedJob, onPauseRefreshChange]);

  useEffect(() => {
    return () => onPauseRefreshChange?.(false);
  }, [onPauseRefreshChange]);

  const handleJobMoved = useCallback(
    (jobId: string) => {
      const currentIndex = activeJobs.findIndex((job) => job.id === jobId);
      const nextJob =
        activeJobs[currentIndex + 1] || activeJobs[currentIndex - 1];
      onSelectJobId(nextJob?.id ?? null);
    },
    [activeJobs, onSelectJobId],
  );

  const handleSaveDescription = useCallback(
    async (jobDescription: string) => {
      if (!selectedJob) return;
      await api.updateJob(selectedJob.id, { jobDescription });
      await onJobUpdated();
    },
    [onJobUpdated, selectedJob],
  );

  const openEditDetails = useCallback(() => {
    window.setTimeout(() => setIsEditDetailsOpen(true), 0);
  }, []);

  const handleCopyInfo = useCallback(async () => {
    if (!selectedJob) return;

    try {
      await copyTextToClipboard(formatJobForWebhook(selectedJob));
      toast.success("Copied job info");
    } catch {
      toast.error("Could not copy job info");
    }
  }, [selectedJob]);

  const handleProcess = useCallback(async () => {
    if (!selectedJob) return;
    try {
      setIsProcessing(true);
      if (selectedJob.status === "ready") {
        await api.generateJobPdf(selectedJob.id);
        toast.success("PDF regenerated");
        trackProductEvent("jobs_job_action_completed", {
          action: "generate_pdf",
          result: "success",
          from_status: selectedJob.status,
        });
      } else {
        await api.processJob(selectedJob.id);
        toast.success("Job moved to Ready", {
          description: "Your tailored PDF has been generated.",
        });
        trackProductEvent("jobs_job_action_completed", {
          action: "process_job",
          result: "success",
          from_status: selectedJob.status,
          to_status: "ready",
        });
        handleJobMoved(selectedJob.id);
      }
      await onJobUpdated();
    } catch (error) {
      showErrorToast(error, "Failed to process job");
    } finally {
      setIsProcessing(false);
    }
  }, [handleJobMoved, onJobUpdated, selectedJob]);

  const confirmMarkApplied = useCallback(async () => {
    if (
      !selectedJob ||
      (selectedJob.status !== "ready" && selectedJob.status !== "discovered")
    )
      return;
    setApplyPrompt(null);
    try {
      setIsApplying(true);
      setApplyPhase("loading");
      await markAsAppliedMutation.mutateAsync(selectedJob.id);
      trackProductEvent("jobs_job_action_completed", {
        action: "mark_applied",
        result: "success",
        from_status: selectedJob.status,
        to_status: "applied",
      });
      // Hold the checkmark briefly so the success reads as a smooth beat
      // before the job moves to the Applied column.
      setApplyPhase("success");
      await new Promise((resolve) => setTimeout(resolve, 1300));
      toast.success("Marked as applied", {
        description: `${selectedJob.title} at ${selectedJob.employer}`,
      });
      handleJobMoved(selectedJob.id);
      await onJobUpdated();
    } catch (error) {
      showErrorToast(error, "Failed to mark as applied");
    } finally {
      setIsApplying(false);
      setApplyPhase("idle");
    }
  }, [handleJobMoved, markAsAppliedMutation, onJobUpdated, selectedJob]);

  // Mark Applied button visuals by phase: spinning ring → animated checkmark.
  const renderApplyIcon = (sizeClass: string) => {
    if (applyPhase === "loading") {
      return (
        <span
          className={cn(
            "inline-block animate-spin rounded-full border-2 border-white/40 border-t-white",
            sizeClass,
          )}
        />
      );
    }
    if (applyPhase === "success") {
      return (
        <CheckCircle2
          className={cn("animate-in zoom-in-50 duration-300", sizeClass)}
        />
      );
    }
    return <CheckCircle2 className={sizeClass} />;
  };
  const applyLabel =
    applyPhase === "loading"
      ? "Applying…"
      : applyPhase === "success"
        ? "Applied"
        : "Mark Applied";

  const handleCoverLetterFocusConsumed = useCallback(
    () => setFocusCoverLetter(false),
    [],
  );

  // Build every stale document so one click can unlock the final check: rebuild
  // the resume if it isn't current/uploaded, and the cover letter if it has
  // content that isn't current/uploaded. Locks the CTA for the whole duration.
  const handleBuildPdf = useCallback(async () => {
    if (isBuildingPdf || !selectedJob) return;
    const resumeNeedsBuild = !(
      selectedJob.resumeFreshness === "current" ||
      selectedJob.resumeFreshness === "uploaded"
    );
    const coverHasContent =
      Boolean(selectedJob.coverLetterPath) ||
      Boolean(selectedJob.coverLetterDetails?.body?.trim());
    const coverNeedsBuild =
      coverHasContent &&
      !(
        selectedJob.coverLetterFreshness === "current" ||
        selectedJob.coverLetterFreshness === "uploaded"
      );
    setIsBuildingPdf(true);
    try {
      if (resumeNeedsBuild) await buildPdfRef.current?.();
      if (coverNeedsBuild) await coverLetterBuildRef.current?.();
    } finally {
      setIsBuildingPdf(false);
    }
  }, [isBuildingPdf, selectedJob]);

  // Open the standalone Job Page, remembering where to return — including the
  // current inspector tab — so Back lands exactly where the user left.
  const openJobPage = useCallback(
    (view?: "timeline" | "documents" | "ghostwriter" | "notes") => {
      if (!selectedJob) return;
      const params = new URLSearchParams(location.search);
      params.set("inspector", inspectorTab);
      const backTo = `${location.pathname}?${params.toString()}`;
      const suffix = view ? `/${view}` : "";
      navigate(`/job/${selectedJob.id}${suffix}`, {
        state: { jobPageBackTo: backTo },
      });
    },
    [selectedJob, location.pathname, location.search, inspectorTab, navigate],
  );

  // Final check (tailoring → apply): needs a resume PDF. The cover-letter
  // question lives here now — if none is generated, ask before moving on.
  const requestFinalCheck = useCallback(() => {
    if (!hasResumePdf) return;
    if (!hasCoverLetter) {
      setApplyPrompt("final-check-no-cover");
      return;
    }
    setInspectorTab("apply");
  }, [hasResumePdf, hasCoverLetter]);

  // Mark applied (apply tab): resume PDF required, then a plain confirm. The
  // cover-letter prompt already happened at the final-check step.
  const requestMarkApplied = useCallback(() => {
    if (!selectedJob) return;
    if (selectedJob.status !== "ready" && selectedJob.status !== "discovered")
      return;
    if (!applicationKitReady) return;
    setApplyPrompt("confirm-apply");
  }, [selectedJob, applicationKitReady]);

  const handlePrimaryAction = useCallback(async () => {
    if (!selectedJob) return;
    if (selectedJob.status === "discovered") {
      setInspectorTab("tailoring");
      return;
    }
    if (selectedJob.status === "ready") {
      requestMarkApplied();
      return;
    }
    if (selectedJob.status === "applied") {
      try {
        setIsMoving(true);
        setApplyPhase("loading");
        await api.updateJob(selectedJob.id, { status: "in_progress" });
        trackProductEvent("jobs_job_action_completed", {
          action: "move_in_progress",
          result: "success",
          from_status: selectedJob.status,
          to_status: "in_progress",
        });
        // Hold the checkmark briefly, mirroring Mark Applied.
        setApplyPhase("success");
        await new Promise((resolve) => setTimeout(resolve, 1300));
        toast.success("Moved to in progress");
        await onJobUpdated();
      } catch (error) {
        showErrorToast(error, "Failed to move to in progress");
      } finally {
        setIsMoving(false);
        setApplyPhase("idle");
      }
      return;
    }
    setInspectorTab("brief");
  }, [requestMarkApplied, onJobUpdated, selectedJob]);

  const handleJobListingOpened = useCallback(() => {
    if (!selectedJob) return;
    setOpenedListingJobIds((current) => {
      const next = new Set(current);
      next.add(selectedJob.id);
      return next;
    });
  }, [selectedJob]);

  const handleSkip = useCallback(async () => {
    if (!selectedJob) return;
    try {
      await skipJobMutation.mutateAsync(selectedJob.id);
      trackProductEvent("jobs_job_action_completed", {
        action: "skip",
        result: "success",
        from_status: selectedJob.status,
        to_status: "skipped",
      });
      toast.message("Job skipped");
      handleJobMoved(selectedJob.id);
      await onJobUpdated();
    } catch (error) {
      showErrorToast(error, "Failed to skip");
    }
  }, [handleJobMoved, onJobUpdated, selectedJob, skipJobMutation]);

  const handleOpenPdf = useCallback(() => {
    if (!selectedJob || !selectedJob.pdfPath || isPdfRegenerating(selectedJob))
      return;
    void openJobPdf(selectedJob.id).catch((error) => {
      showErrorToast(error, "Could not open PDF");
    });
  }, [selectedJob]);

  const handleRegenerateCoverLetter = useCallback(async () => {
    if (!selectedJob) return;
    const hadCoverLetter = Boolean(selectedJob.coverLetterPath);
    try {
      setIsGeneratingCoverLetter(true);
      await api.generateCoverLetter(selectedJob.id);
      toast.success(
        hadCoverLetter ? "Cover letter regenerated" : "Cover letter generated",
      );
      await onJobUpdated();
    } catch (error) {
      showErrorToast(error, "Failed to generate cover letter");
    } finally {
      setIsGeneratingCoverLetter(false);
    }
  }, [onJobUpdated, selectedJob]);

  const handleOpenCoverLetter = useCallback(() => {
    if (!selectedJob || !selectedJob.coverLetterPath) return;
    void openJobCoverLetter(selectedJob.id).catch((error) => {
      showErrorToast(error, "Could not open cover letter");
    });
  }, [selectedJob]);

  // On the orchestrator view the resume and cover letter are treated as one set:
  // rebuild the resume, then the cover letter when one already exists. Uploaded
  // PDFs block this entirely (handled by the disabled state below).
  const handleRegenerateDocs = useCallback(async () => {
    await handleProcess();
    if (hasCoverLetter && !coverUploaded) {
      await handleRegenerateCoverLetter();
    }
  }, [
    handleProcess,
    handleRegenerateCoverLetter,
    hasCoverLetter,
    coverUploaded,
  ]);

  const handleDownloadAll = useCallback(async () => {
    if (!selectedJob) return;
    const hasResume =
      Boolean(selectedJob.pdfPath) && !isPdfRegenerating(selectedJob);
    const hasCover = Boolean(selectedJob.coverLetterPath);
    // Trigger downloads sequentially: two anchor clicks in the same tick get
    // collapsed into one by most browsers, so a single click would only ever
    // save one of the two files.
    if (hasResume) {
      try {
        await downloadJobPdf(selectedJob.id, selectedPdfFilename);
      } catch (error) {
        showErrorToast(error, "Could not download resume PDF");
      }
    }
    if (hasCover) {
      try {
        await downloadJobCoverLetter(
          selectedJob.id,
          selectedCoverLetterFilename,
        );
      } catch (error) {
        showErrorToast(error, "Could not download cover letter PDF");
      }
    }
  }, [selectedJob, selectedPdfFilename, selectedCoverLetterFilename]);

  const handleUploadPdf = useCallback(
    async (file: File) => {
      if (!selectedJob) return;
      try {
        setIsUploadingPdf(true);
        await uploadJobPdfFromFile(selectedJob.id, file);
        toast.success("Resume uploaded");
        await onJobUpdated();
      } catch (error) {
        showErrorToast(error, "Failed to upload PDF");
      } finally {
        setIsUploadingPdf(false);
        if (uploadPdfInputRef.current) {
          uploadPdfInputRef.current.value = "";
        }
      }
    },
    [onJobUpdated, selectedJob],
  );

  const handleUploadCoverLetter = useCallback(
    async (file: File) => {
      if (!selectedJob) return;
      try {
        setIsUploadingCoverLetter(true);
        const payload = await fileToUploadPayload(
          file,
          "PDF file could not be encoded for upload.",
        );
        await api.uploadCoverLetterPdf(selectedJob.id, {
          fileName: payload.fileName,
          mediaType: payload.mediaType ?? undefined,
          dataBase64: payload.dataBase64,
        });
        toast.success("Cover letter uploaded");
        await onJobUpdated();
      } catch (error) {
        showErrorToast(error, "Failed to upload cover letter");
      } finally {
        setIsUploadingCoverLetter(false);
        if (uploadCoverLetterInputRef.current) {
          uploadCoverLetterInputRef.current.value = "";
        }
      }
    },
    [onJobUpdated, selectedJob],
  );

  const handleUploadDocument = useCallback(
    async (file: File) => {
      if (!selectedJob) return;
      try {
        setIsUploadingDocument(true);
        await uploadJobDocumentFromFile(selectedJob.id, file);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.jobs.documents(selectedJob.id),
        });
        toast.success("Document uploaded");
      } catch (error) {
        showErrorToast(error, "Failed to upload document");
      } finally {
        setIsUploadingDocument(false);
        if (uploadDocumentInputRef.current) {
          uploadDocumentInputRef.current.value = "";
        }
      }
    },
    [queryClient, selectedJob],
  );

  if (!selectedJob) {
    return (
      <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border/50 bg-muted/20">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium text-muted-foreground">
            No job selected
          </div>
          <p className="max-w-[220px] text-xs text-muted-foreground/70">
            Select a job to see the brief, tailoring, and application kit.
          </p>
        </div>
      </div>
    );
  }

  const primaryBusy =
    isProcessing ||
    isApplying ||
    isMoving ||
    selectedJob.status === "processing";
  const canSkip = ["discovered", "ready"].includes(selectedJob.status);
  const isRegeneratingPdf = isPdfRegenerating(selectedJob);
  // The combined download only has something to fetch when the resume PDF is
  // ready (not mid-regeneration) or a cover letter exists.
  const canDownloadAnyPdf =
    (hasResumePdf && !isRegeneratingPdf) || hasCoverLetter;
  const isStalePdf = isPdfStale(selectedJob);
  const pdfRegeneratingReason = isRegeneratingPdf
    ? PDF_REGENERATING_MESSAGE
    : null;
  const pdfActionDisabled = !selectedJob.pdfPath || isRegeneratingPdf;
  // Combined resume + cover-letter rebuild. Greyed with a hover reason when an
  // uploaded PDF is present (can't overwrite it) or no resume exists yet.
  const regenerateBusy = isProcessing || isGeneratingCoverLetter;
  const isPostApplication =
    selectedJob.status === "applied" || selectedJob.status === "in_progress";
  // Rebuild is possible only when we own the tailored PDF: a resume exists, it
  // isn't an uploaded file (can't overwrite those), and the job is still
  // pre-application. Uploaded resumes fall back to "Final check" as the CTA.
  const canRebuildDocs = hasResumePdf && !hasUploadedDoc && !isPostApplication;

  // The header CTA walks a job through Brief → Tailoring → Apply while it is
  // still pre-application; once applied it falls back to the status action.
  const isPreApplication =
    selectedJob.status === "discovered" || selectedJob.status === "ready";
  const primaryStep: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void | Promise<void>;
    disabled: boolean;
    reason: string | null;
    showKbd: boolean;
    // null = use the status tone; otherwise a step-colored button class.
    colorClass: string | null;
  } = (() => {
    const busyIcon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    // Step colors so the flow reads left-to-right: Brief blue → Tailoring
    // amber → Apply green.
    const tailoringColor = "bg-amber-600 text-white hover:bg-amber-500";
    const applyColor = "bg-emerald-600 text-white hover:bg-emerald-500";
    if (isPreApplication && inspectorTab === "brief") {
      return {
        label: "Start Tailoring",
        icon: primaryBusy ? busyIcon : null,
        onClick: () => setInspectorTab("tailoring"),
        disabled: primaryBusy,
        reason: null,
        showKbd: false,
        colorClass: tailoringColor,
      };
    }
    if (isPreApplication && inspectorTab === "tailoring") {
      const building = isBuildingPdf || Boolean(selectedJob.pdfRegenerating);
      // States:
      //  - everything built (rebuildable) → amber "Rebuild" so the user can keep
      //    iterating; a separate green "Final check" button advances to Apply.
      //  - everything built (uploaded, not rebuildable) → green "Final check".
      //  - draft ready, PDF not built/stale → "Build PDF" (build it; e.g. an
      //    auto-drafted high-rated job arrives ready but unbuilt)
      //  - no sections yet   → amber "Finish tailoring" warning
      if (finalCheckReady && canRebuildDocs) {
        // Spin from the click (isProcessing flips synchronously) through the
        // server-side rebuild (pdfRegenerating), so the ring never lags.
        const rebuilding = building || isProcessing;
        return {
          label: rebuilding ? "Building…" : "Rebuild",
          icon: rebuilding ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          ),
          onClick: () => void handleRegenerateDocs(),
          disabled: primaryBusy || building,
          reason: null,
          showKbd: false,
          colorClass: tailoringColor,
        };
      }
      if (finalCheckReady) {
        return {
          label: "Final check",
          icon: primaryBusy ? busyIcon : null,
          onClick: requestFinalCheck,
          disabled: primaryBusy,
          reason: null,
          showKbd: false,
          colorClass: applyColor,
        };
      }
      if (draftReady) {
        return {
          label: building ? "Building…" : "Build PDF",
          icon: building ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          ),
          onClick: () => void handleBuildPdf(),
          disabled: primaryBusy || building,
          reason: null,
          showKbd: false,
          colorClass: tailoringColor,
        };
      }
      return {
        label: "Finish tailoring",
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        onClick: requestFinalCheck,
        disabled: true,
        reason: "Generate your resume sections first.",
        showKbd: false,
        colorClass: tailoringColor,
      };
    }
    if (isPreApplication) {
      // Apply tab. Only enabled once the application materials are ready.
      return {
        label: applyLabel,
        icon: renderApplyIcon("h-3.5 w-3.5"),
        onClick: requestMarkApplied,
        disabled: primaryBusy || !applicationKitReady,
        reason: applicationKitReady
          ? null
          : "Get your application materials ready first.",
        showKbd: selectedJob.status === "ready" && applyPhase === "idle",
        colorClass: applyColor,
      };
    }
    if (selectedJob.status === "applied") {
      // Move to In Progress shares the ring → checkmark animation.
      return {
        label:
          applyPhase === "loading"
            ? "Moving…"
            : applyPhase === "success"
              ? "Moved"
              : "Move to In Progress",
        icon: renderApplyIcon("h-3.5 w-3.5"),
        onClick: handlePrimaryAction,
        disabled: primaryBusy,
        reason: null,
        showKbd: false,
        colorClass: null,
      };
    }
    if (selectedJob.status === "in_progress") {
      // In-progress jobs are monitored on the Job Page timeline.
      return {
        label: "View Timeline",
        icon: null,
        onClick: () => openJobPage("timeline"),
        disabled: false,
        reason: null,
        showKbd: false,
        colorClass: null,
      };
    }
    // processing / skipped / expired: plain status action.
    return {
      label: getPrimaryAction(selectedJob),
      icon: primaryBusy ? busyIcon : <CheckCircle2 className="h-3.5 w-3.5" />,
      onClick: handlePrimaryAction,
      disabled: primaryBusy || selectedJob.status === "processing",
      reason: null,
      showKbd: false,
      colorClass: null,
    };
  })();

  const regenerateDocsReason = isPostApplication
    ? "This job is already applied — rebuilding is locked."
    : hasUploadedDoc
      ? "Delete the uploaded PDF in the job's documents to rebuild from your tailored content."
      : !hasResumePdf
        ? "Tailor this job and generate the resume first."
        : null;
  const tone = statusTone[selectedJob.status];
  const openListingIsPrimary =
    selectedJob.status === "ready" && hasJobListing && !hasOpenedJobListing;
  const activeApplyCtaClassName =
    "border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500 hover:text-white";
  // When the tailoring CTA is showing "Rebuild" (everything current + owned),
  // pair it with a green "Final check" advance button so the apply step — and
  // its no-cover-letter prompt — stays reachable without leaving the primary
  // slot occupied.
  const showTailoringFinalCheck =
    isPreApplication &&
    inspectorTab === "tailoring" &&
    finalCheckReady &&
    canRebuildDocs;
  return (
    <Tabs
      value={inspectorTab}
      onValueChange={(value) => setInspectorTab(value as InspectorTab)}
      className="flex min-h-0 min-w-0 flex-1 flex-col lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto p-1"
    >
      <TabsList className="grid h-auto grid-cols-3 gap-1 rounded-lg text-sm bg-muted/90 mb-4">
        {Object.entries(tabCopy).map(([value, copy]) => {
          const isSelected = inspectorTab === value;
          const trigger = (
            <TabsTrigger
              key={value}
              value={value}
              className={cn(
                "flex-1 flex items-center lg:flex-none gap-1.5",
                isSelected && copy.selectedClassName,
              )}
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full", copy.dotClassName)}
              />
              <span className="text-sm">{copy.label}</span>
            </TabsTrigger>
          );

          return (
            <Tip
              key={value}
              asChild
              content={<p>{copy.description}</p>}
              contentClassName="max-w-xs text-center"
            >
              {trigger}
            </Tip>
          );
        })}
      </TabsList>
      <JobHeader
        job={selectedJob}
        onCheckSponsor={async () => {
          await api.checkSponsor(selectedJob.id);
          await onJobUpdated();
        }}
        jobCTA={
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:shrink-0">
            <GhostwriterDrawer
              job={selectedJob}
              triggerLabel="Ask Ghostwriter"
              triggerVariant="ghost"
              triggerClassName="w-full min-w-0 justify-start overflow-hidden sm:w-auto"
            />
            <div className="col-start-1 row-start-2 flex min-w-0 gap-2 sm:contents">
              <TooltipWhenDisabled
                reason={primaryStep.disabled ? primaryStep.reason : null}
                className="min-w-0 flex-1 sm:w-auto sm:flex-none"
              >
                <Button
                  size="sm"
                  onClick={() => void primaryStep.onClick()}
                  disabled={primaryStep.disabled}
                  className={cn(
                    "w-full min-w-0 justify-start sm:w-auto sm:justify-center",
                    primaryStep.colorClass ?? tone.button,
                  )}
                >
                  <span className="relative z-10 inline-flex min-w-0 items-center gap-1.5">
                    {primaryStep.icon}
                    {primaryStep.label}
                    {primaryStep.showKbd ? (
                      <KbdHint shortcut="a" className="ml-1" />
                    ) : null}
                  </span>
                </Button>
              </TooltipWhenDisabled>
              {showTailoringFinalCheck ? (
                <Button
                  size="sm"
                  onClick={requestFinalCheck}
                  className={cn(
                    "min-w-0 flex-1 justify-center sm:w-auto sm:flex-none",
                    activeApplyCtaClassName,
                  )}
                >
                  <span className="relative z-10 inline-flex min-w-0 items-center gap-1.5">
                    Final check
                  </span>
                </Button>
              ) : null}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="More actions"
                  className="col-start-2 row-span-2 row-start-1 self-center"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={openEditDetails}>
                  <Edit2 className="mr-2 h-4 w-4" />
                  Edit details
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openJobPage()}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open Job Page
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleCopyInfo()}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy job info
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => rescoreJob(selectedJob.id)}
                  disabled={isRescoring || isPostApplication}
                >
                  <RefreshCcw
                    className={cn(
                      "mr-2 h-4 w-4",
                      isRescoring && "animate-spin",
                    )}
                  />
                  {isRescoring ? "Recalculating..." : "Recalculate match"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <Tip
                  asChild
                  content={regenerateDocsReason}
                  contentClassName="max-w-xs text-center"
                >
                  <DropdownMenuItem
                    onSelect={(event) => {
                      if (regenerateDocsReason || regenerateBusy) {
                        event.preventDefault();
                        return;
                      }
                      void handleRegenerateDocs();
                    }}
                    aria-disabled={Boolean(regenerateDocsReason)}
                    className={cn(
                      regenerateDocsReason &&
                        "cursor-not-allowed opacity-50 focus:bg-transparent",
                    )}
                  >
                    <RefreshCcw
                      className={cn(
                        "mr-2 h-4 w-4",
                        regenerateBusy && "animate-spin",
                      )}
                    />
                    Build PDF
                  </DropdownMenuItem>
                </Tip>
                <DropdownMenuSub open={isPostApplication ? false : undefined}>
                  <Tip
                    asChild
                    content={
                      isPostApplication
                        ? "This job is already applied — uploads are locked."
                        : null
                    }
                    contentClassName="max-w-xs text-center"
                  >
                    <DropdownMenuSubTrigger
                      aria-disabled={isPostApplication}
                      className={cn(
                        isPostApplication &&
                          "cursor-not-allowed opacity-50 focus:bg-transparent",
                      )}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {isUploadingPdf ||
                      isUploadingCoverLetter ||
                      isUploadingDocument
                        ? "Uploading..."
                        : "Upload PDF"}
                    </DropdownMenuSubTrigger>
                  </Tip>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      onSelect={() => uploadDocumentInputRef.current?.click()}
                      disabled={isUploadingDocument || isPostApplication}
                    >
                      <Paperclip className="mr-2 h-4 w-4" />
                      Upload document
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => uploadPdfInputRef.current?.click()}
                      disabled={
                        isUploadingPdf || isPostApplication || resumeUploaded
                      }
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      {selectedJob.pdfPath ? "Replace resume" : "Upload resume"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        uploadCoverLetterInputRef.current?.click()
                      }
                      disabled={
                        isUploadingCoverLetter ||
                        isPostApplication ||
                        coverUploaded
                      }
                    >
                      <FileSignature className="mr-2 h-4 w-4" />
                      {selectedJob.coverLetterPath
                        ? "Replace cover letter"
                        : "Upload cover letter"}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open PDF
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      onSelect={handleOpenPdf}
                      disabled={pdfActionDisabled}
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      Open resume
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={handleOpenCoverLetter}
                      disabled={!hasCoverLetter}
                    >
                      <FileSignature className="mr-2 h-4 w-4" />
                      Open cover letter
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  onSelect={() => void handleDownloadAll()}
                  disabled={!canDownloadAnyPdf}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </DropdownMenuItem>
                {canSkip && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => void handleSkip()}
                      className="text-destructive focus:text-destructive"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Skip job
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="flex min-w-0 flex-col rounded-lg rounded-t-none border border-t-0 border-border/50 bg-card p-4">
        <TabsContent value="brief" className="space-y-4">
          {!brief && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Role" value={selectedJob.roleFamily} />
              <Stat label="Location" value={selectedJob.location} tone="blue" />
              <Stat label="Salary" value={selectedJob.salary} tone="green" />
              <Stat label="Level" value={selectedJob.jobLevel} />
              <Stat label="Function" value={selectedJob.jobFunction} />
              <Stat label="Discipline" value={selectedJob.disciplines} />
            </div>
          )}

          <JobBriefPane job={selectedJob} />
          <JobDescriptionPanel
            description={selectedJob.jobDescription}
            jobUrl={selectedJob.jobUrl}
            onSave={isPostApplication ? undefined : handleSaveDescription}
            defaultOpen={false}
          />
        </TabsContent>

        <TabsContent value="tailoring">
          <TailoringWorkspace
            mode="editor"
            job={selectedJob}
            onUpdate={onJobUpdated}
            onDirtyChange={onPauseRefreshChange}
            focusCoverLetter={focusCoverLetter}
            onCoverLetterFocusConsumed={handleCoverLetterFocusConsumed}
            onRegisterBuildPdf={registerBuildPdf}
            onRegisterCoverLetterBuild={registerCoverLetterBuild}
          />
        </TabsContent>

        <TabsContent value="apply">
          <div className="space-y-5">
            {isStalePdf && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{STALE_PDF_MESSAGE}</span>
              </div>
            )}

            <div className="space-y-4">
              <div
                className={cn(
                  "flex min-h-16 flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
                  applicationKitReady
                    ? "border-emerald-500/20 bg-emerald-500/[0.04]"
                    : "border-amber-500/20 bg-amber-500/[0.04]",
                )}
              >
                <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                        applicationKitReady
                          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                          : "border-amber-500/45 bg-amber-500/10 text-amber-300",
                      )}
                    >
                      {applicationKitReady ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <CircleAlert className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground/90">
                        {applicationKitReady
                          ? "Application materials ready"
                          : "Application materials need review"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground/75">
                        {applicationKitReady
                          ? "Tailored summary, skills, and PDF are ready for this role."
                          : "Check the application kit before submitting this role."}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full justify-center sm:w-auto sm:shrink-0"
                    onClick={() => openJobPage()}
                  >
                    Open Job Page
                    <ArrowRight />
                  </Button>
                </div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <TooltipWhenDisabled
                reason={pdfRegeneratingReason}
                className="w-full"
              >
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDownloadAll()}
                  disabled={!canDownloadAnyPdf}
                >
                  <Download className="size-3.5" />
                  Download PDF
                  <KbdHint shortcut="d" className="ml-auto" />
                </Button>
              </TooltipWhenDisabled>
              <OpenJobListingButton
                href={jobLink}
                size="sm"
                className={cn(openListingIsPrimary && activeApplyCtaClassName)}
                shortcut="o"
                disabled={!hasJobListing}
                onClick={handleJobListingOpened}
              />
              <TooltipWhenDisabled
                reason={
                  canDownloadAnyPdf ? null : "Build or upload a PDF to view it."
                }
                className="w-full"
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => openJobPage("documents")}
                  disabled={!canDownloadAnyPdf}
                >
                  <FileText className="size-3.5" />
                  View PDF
                </Button>
              </TooltipWhenDisabled>
            </div>

            <div>
              <div className="mb-2 text-lg font-semibold tracking-normal text-foreground/90">
                Application Kit
              </div>
              <div className="overflow-hidden rounded-md border border-border/45 bg-muted/5">
                <KitStatus
                  icon={<FileText className="h-4 w-4" />}
                  label="Tailored summary"
                  ready={hasTailoredSummary}
                />
                <KitStatus
                  icon={<Star className="h-4 w-4" />}
                  label="Tailored skills"
                  ready={hasTailoredSkills}
                />
                <KitStatus
                  icon={<FileText className="h-4 w-4" />}
                  label="Resume"
                  ready={hasResumePdf}
                  readyLabel={
                    selectedJob.pdfSource === "uploaded" ? "Uploaded" : "Ready"
                  }
                />
                <KitStatus
                  icon={<FileSignature className="h-4 w-4" />}
                  label="Cover letter"
                  ready={hasCoverLetter}
                  readyLabel={
                    selectedJob.coverLetterSource === "uploaded"
                      ? "Uploaded"
                      : "Ready"
                  }
                  optional
                />
                <KitStatus
                  icon={<Paperclip className="h-4 w-4" />}
                  label="Additional documents"
                  ready={additionalDocumentsCount > 0}
                  readyLabel={`${additionalDocumentsCount} included`}
                  optional
                />
                <KitStatus
                  icon={<FolderKanban className="h-4 w-4" />}
                  label="Selected projects"
                  ready={selectedProjectIds.length > 0}
                  readyLabel={`${selectedProjectIds.length} included`}
                />
                <KitStatus
                  icon={<Link2 className="h-4 w-4" />}
                  label="Supporting links"
                  ready={false}
                  optional
                />
              </div>
            </div>

            <div>
              <div className="mb-2 text-lg font-semibold tracking-normal text-foreground/90">
                Selected projects
              </div>
              {selectedProjects.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedProjects.map((project) => (
                    <span
                      key={project}
                      className="rounded-md border border-border/35 bg-background/40 px-3 py-1.5 text-xs text-muted-foreground"
                    >
                      {project}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground/70">
                  No projects selected yet. Use Tailoring to choose the evidence
                  for this role.
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        <JobDetailsEditDrawer
          open={isEditDetailsOpen}
          onOpenChange={setIsEditDetailsOpen}
          job={selectedJob}
          onJobUpdated={onJobUpdated}
        />

        <input
          ref={uploadPdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              void handleUploadPdf(file);
            }
          }}
        />
        <input
          ref={uploadCoverLetterInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              void handleUploadCoverLetter(file);
            }
          }}
        />
        <input
          ref={uploadDocumentInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              void handleUploadDocument(file);
            }
          }}
        />
      </div>

      <AlertDialog
        open={applyPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setApplyPrompt(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {applyPrompt === "final-check-no-cover"
                ? "Continue without a cover letter?"
                : "Mark this job as applied?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {applyPrompt === "final-check-no-cover"
                ? "No cover letter has been generated for this job. Add one now, or continue to the final check with just your resume."
                : "Applying locks tailoring and documents — afterwards you can only monitor the job and ask the assistant."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {applyPrompt === "final-check-no-cover" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setApplyPrompt(null);
                    setInspectorTab("tailoring");
                    setFocusCoverLetter(true);
                  }}
                >
                  Add cover letter
                </Button>
                <AlertDialogAction onClick={() => setInspectorTab("apply")}>
                  Continue
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction onClick={() => void confirmMarkApplied()}>
                Mark applied
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
};
