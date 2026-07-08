import {
  type ApplicationStage,
  type ApplicationTask,
  type Job,
  type JobNote,
  type ResumeProjectCatalogItem,
  STAGE_LABELS,
  type StageEvent,
} from "@shared/types.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ClipboardList,
  DollarSign,
  ExternalLink,
  FileText,
  MessageSquareText,
  PlusCircle,
  Sparkles,
} from "lucide-react";
import React from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import { JobBriefPane } from "@/client/components/JobBriefPane";
import { JobDescriptionPanel } from "@/client/components/JobDescriptionPanel";
import { JobStatusPills } from "@/client/components/JobStatusPills";
import { invalidateJobData } from "@/client/hooks/queries/invalidate";
import {
  useCheckSponsorMutation,
  useGenerateJobPdfMutation,
  useMarkAsAppliedMutation,
  useRescoreJobMutation,
  useSkipJobMutation,
  useUpdateJobMutation,
} from "@/client/hooks/queries/useJobMutations";
import { useProfile } from "@/client/hooks/useProfile";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { useSettings } from "@/client/hooks/useSettings";
import { celebrateOffer } from "@/client/lib/celebrate";
import { showErrorToast } from "@/client/lib/error-toast";
import { uploadJobPdfFromFile } from "@/client/lib/job-pdf-upload";
import { getRenderableJobDescription } from "@/client/lib/jobDescription";
import { logJobStageEvent } from "@/client/lib/logJobStageEvent";
import {
  buildPdfFilenames,
  resolveFilenameLanguage,
} from "@/client/lib/pdf-filename";
import {
  getPdfActionLabels,
  isPdfRegenerating,
  isPdfStale,
  PDF_REGENERATING_MESSAGE,
  STALE_PDF_MESSAGE,
} from "@/client/lib/pdf-freshness";
import {
  downloadJobCoverLetter,
  downloadJobPdf,
  openJobPdf,
} from "@/client/lib/private-pdf";
import { queryKeys } from "@/client/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  copyTextToClipboard,
  formatDateTime,
  formatJobForWebhook,
  formatJobSourceLabel,
  formatTimestamp,
  sourceLabel as sourceLabels,
} from "@/lib/utils";
import * as api from "../api";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { GhostwriterPanel } from "../components/ghostwriter/GhostwriterPanel";
import { JobDetailsEditDrawer } from "../components/JobDetailsEditDrawer";
import {
  type LogEventFormValues,
  LogEventModal,
} from "../components/LogEventModal";
import { getDeleteEventDescription } from "./job/deleteEventDescription";
import { JobTimeline } from "./job/Timeline";
import { JobDocumentsPanel } from "./job-page/JobDocumentsPanel";
import { JobEmailsPanel } from "./job-page/JobEmailsPanel";
import { JobNotesCard } from "./job-page/JobNotesCard";
import {
  type JobMemoryView,
  JobPageLeftSidebar,
} from "./job-page/JobPageLeftSidebar";
import { JobPageRightSidebar } from "./job-page/JobPageRightSidebar";
import { OverviewGhostwriterComposer } from "./job-page/OverviewGhostwriterComposer";
import { defaultStatusToken, statusTokens } from "./orchestrator/constants";

const normalizeMemoryView = (view: string | undefined): JobMemoryView => {
  if (view === "notes" || view === "note") return "note";
  if (
    view === "documents" ||
    view === "timeline" ||
    view === "emails" ||
    view === "ghostwriter"
  ) {
    return view;
  }
  return "overview";
};

type JobPageLocationState = {
  jobPageBackTo?: string;
};

const isValidJobPageBackTarget = (value: unknown): value is string =>
  typeof value === "string" &&
  value.startsWith("/") &&
  !value.startsWith("/job/");

const getFallbackBackTarget = (job: Job | null): string => {
  if (!job) return "/jobs/all";
  // Include the job id so the orchestrator list re-selects this job instead of
  // defaulting to the first entry (route: /jobs/:tab/:jobId).
  if (job.status === "ready" || job.status === "discovered") {
    return `/jobs/${job.status}/${job.id}`;
  }
  if (job.status === "applied") {
    return `/jobs/applied/${job.id}`;
  }
  if (job.status === "in_progress") {
    return "/applications/in-progress";
  }
  return `/jobs/all/${job.id}`;
};

const sortNotesByUpdatedAtDesc = (notes: JobNote[]) =>
  [...notes].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

const parseSelectedProjectIds = (value: string | null | undefined) =>
  value
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean) ?? [];

export const JobPage: React.FC = () => {
  const { id, view } = useParams<{ id: string; view?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [isLogModalOpen, setIsLogModalOpen] = React.useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [isEditDetailsOpen, setIsEditDetailsOpen] = React.useState(false);
  const [isUploadingPdf, setIsUploadingPdf] = React.useState(false);
  const [activeAction, setActiveAction] = React.useState<string | null>(null);
  const [eventToDelete, setEventToDelete] = React.useState<string | null>(null);
  const [editingEvent, setEditingEvent] = React.useState<StageEvent | null>(
    null,
  );
  const [catalog, setCatalog] = React.useState<ResumeProjectCatalogItem[]>([]);
  const pendingEventRef = React.useRef<StageEvent | null>(null);
  const uploadPdfInputRef = React.useRef<HTMLInputElement | null>(null);
  const { settings } = useSettings();
  const { personName, profile } = useProfile();
  const filenameLanguage = resolveFilenameLanguage({ settings, profile });
  const openEditDetails = React.useCallback(() => {
    window.setTimeout(() => setIsEditDetailsOpen(true), 0);
  }, []);

  const jobQuery = useQuery<Job | null>({
    queryKey: ["jobs", "detail", id ?? null] as const,
    queryFn: () => (id ? api.getJob(id) : Promise.resolve(null)),
    enabled: Boolean(id),
    // The PDF rebuilds automatically after tailoring/CV/settings edits. Poll
    // while it's stale or regenerating so the freshness pill and preview
    // advance stale → regenerating → up-to-date without a manual refresh, and
    // refetch on focus so returning from the Resume Studio picks up the change.
    refetchInterval: (query) => {
      const data = query.state.data ?? undefined;
      // Poll fast while the PDF is actively rebuilding so the spinner clears
      // promptly once the server finishes (bounded, short window).
      if (isPdfRegenerating(data)) return 800;
      if (isPdfStale(data)) return 2500;
      return false;
    },
    refetchOnWindowFocus: true,
  });
  const eventsQuery = useQuery<StageEvent[]>({
    queryKey: ["jobs", "stage-events", id ?? null] as const,
    queryFn: () => (id ? api.getJobStageEvents(id) : Promise.resolve([])),
    enabled: Boolean(id),
  });
  const notesQuery = useQuery<JobNote[]>({
    queryKey: queryKeys.jobs.notes(id ?? ""),
    queryFn: () => (id ? api.getJobNotes(id) : Promise.resolve([])),
    enabled: Boolean(id),
  });
  const tasksQuery = useQuery<ApplicationTask[]>({
    queryKey: ["jobs", "tasks", id ?? null] as const,
    queryFn: () => (id ? api.getJobTasks(id) : Promise.resolve([])),
    enabled: Boolean(id),
  });

  useQueryErrorToast(
    jobQuery.error,
    "Failed to load job details. Please try again.",
  );
  useQueryErrorToast(
    eventsQuery.error,
    "Failed to load job timeline. Please try again.",
  );
  useQueryErrorToast(
    tasksQuery.error,
    "Failed to load job tasks. Please try again.",
  );

  const markAsAppliedMutation = useMarkAsAppliedMutation();
  const updateJobMutation = useUpdateJobMutation();
  const skipJobMutation = useSkipJobMutation();
  const rescoreJobMutation = useRescoreJobMutation();
  const generatePdfMutation = useGenerateJobPdfMutation();
  const checkSponsorMutation = useCheckSponsorMutation();

  const job = jobQuery.data ?? null;
  const events = mergeEvents(eventsQuery.data ?? [], pendingEventRef.current);
  const notes = React.useMemo(
    () => sortNotesByUpdatedAtDesc(notesQuery.data ?? []),
    [notesQuery.data],
  );
  const tasks = tasksQuery.data ?? [];
  const isLoading =
    jobQuery.isLoading || eventsQuery.isLoading || tasksQuery.isLoading;
  const activeMemoryView = normalizeMemoryView(view);
  useQueryErrorToast(
    activeMemoryView === "note" ? null : notesQuery.error,
    "Failed to load notes. Please try again.",
  );
  const selectedProjectIds = React.useMemo(
    () => parseSelectedProjectIds(job?.selectedProjectIds),
    [job?.selectedProjectIds],
  );
  const selectedProjectIdsKey = selectedProjectIds.join(",");
  const selectedProjects = React.useMemo(
    () =>
      selectedProjectIds.map(
        (projectId) =>
          catalog.find((project) => project.id === projectId)?.name ??
          projectId,
      ),
    [catalog, selectedProjectIds],
  );
  const sourceLabel = job
    ? (sourceLabels[job.source] ?? formatJobSourceLabel(job.source))
    : "";
  const jobPageBackTo = React.useMemo(() => {
    const state = location.state as JobPageLocationState | null;
    return isValidJobPageBackTarget(state?.jobPageBackTo)
      ? state.jobPageBackTo
      : null;
  }, [location.state]);
  const jobPageNavigationState = React.useMemo(
    () => (jobPageBackTo ? { jobPageBackTo } : undefined),
    [jobPageBackTo],
  );

  React.useEffect(() => {
    if (!id || view !== "note") return;
    const search = location.search;
    navigate(`/job/${id}/notes${search}`, {
      replace: true,
      state: jobPageNavigationState,
    });
  }, [id, jobPageNavigationState, location.search, navigate, view]);

  React.useEffect(() => {
    let isCancelled = false;

    if (selectedProjectIdsKey.length === 0) {
      setCatalog([]);
      return () => {
        isCancelled = true;
      };
    }

    void api
      .getResumeProjectsCatalog()
      .then((nextCatalog) => {
        if (!isCancelled) {
          setCatalog(nextCatalog);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setCatalog([]);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedProjectIdsKey]);

  const loadData = React.useCallback(async () => {
    if (!id) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(id) }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.stageEvents(id),
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.tasks(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.notes(id) }),
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.jobs.all, "emails", id] as const,
      }),
    ]);
  }, [id, queryClient]);

  const handleLogEvent = async (
    values: LogEventFormValues,
    eventId?: string,
  ) => {
    if (!job) return;
    if (job.status !== "in_progress") {
      toast.error("Move this job to In Progress to track stages.");
      return;
    }

    const currentStage = events.at(-1)?.toStage ?? "applied";

    try {
      const { effectiveStage, newEvent } = await logJobStageEvent({
        jobId: job.id,
        currentStage,
        values,
        eventId,
      });

      if (newEvent) {
        pendingEventRef.current = newEvent;
      }

      await invalidateJobData(queryClient, job.id);
      pendingEventRef.current = null;
      setEditingEvent(null);
      toast.success(eventId ? "Event updated" : "Event logged");

      if (effectiveStage === "offer") {
        celebrateOffer();
      }
    } catch (error) {
      showErrorToast(error, "Failed to log event");
    }
  };

  const confirmDeleteEvent = (eventId: string) => {
    setEventToDelete(eventId);
    setIsDeleteModalOpen(true);
  };

  const handleDeleteEvent = async () => {
    if (!job || !eventToDelete) return;
    try {
      await api.deleteJobStageEvent(job.id, eventToDelete);
      await invalidateJobData(queryClient, job.id);
      toast.success("Event deleted");
    } catch (error) {
      showErrorToast(error, "Failed to delete event");
    } finally {
      setIsDeleteModalOpen(false);
      setEventToDelete(null);
    }
  };

  const handleEditEvent = (event: StageEvent) => {
    setEditingEvent(event);
    setIsLogModalOpen(true);
  };

  const runAction = React.useCallback(
    async (actionKey: string, task: () => Promise<void>) => {
      if (!job) return;
      try {
        setActiveAction(actionKey);
        await task();
        await loadData();
      } catch (error) {
        showErrorToast(error, "Failed to run action");
      } finally {
        setActiveAction(null);
      }
    },
    [job, loadData],
  );

  const handleMarkApplied = async () => {
    await runAction("mark-applied", async () => {
      if (!job) return;
      await markAsAppliedMutation.mutateAsync(job.id);
      toast.success("Marked as applied");
    });
  };

  const handleMoveToInProgress = async () => {
    await runAction("move-in-progress", async () => {
      if (!job) return;
      await updateJobMutation.mutateAsync({
        id: job.id,
        update: { status: "in_progress" },
      });
      toast.success("Moved to in progress");
    });
  };

  const handleSkip = async () => {
    await runAction("skip", async () => {
      if (!job) return;
      await skipJobMutation.mutateAsync(job.id);
      toast.message("Job skipped");
    });
  };

  const handleRescore = async () => {
    await runAction("rescore", async () => {
      if (!job) return;
      await rescoreJobMutation.mutateAsync(job.id);
      toast.success("Match recalculated");
    });
  };

  const handleRegeneratePdf = async () => {
    await runAction("regenerate-pdf", async () => {
      if (!job) return;
      await generatePdfMutation.mutateAsync(job.id);
      toast.success("Resume PDF generated");
    });
  };

  const handleCheckSponsor = async () => {
    await runAction("check-sponsor", async () => {
      if (!job) return;
      await checkSponsorMutation.mutateAsync(job.id);
      toast.success("Sponsor check completed");
    });
  };

  const handleCopyJobInfo = async () => {
    if (!job) return;
    try {
      await copyTextToClipboard(formatJobForWebhook(job));
      toast.success("Copied job info", {
        description: "Webhook payload copied to clipboard.",
      });
    } catch {
      toast.error("Could not copy job info");
    }
  };

  const handleSaveJobDescription = React.useCallback(
    async (jobDescription: string) => {
      if (!job) return;
      await updateJobMutation.mutateAsync({
        id: job.id,
        update: { jobDescription },
      });
      await loadData();
    },
    [job, loadData, updateJobMutation],
  );

  const handleUploadPdf = async (file: File) => {
    if (!job) return;

    try {
      setIsUploadingPdf(true);
      await uploadJobPdfFromFile(job.id, file);
      await loadData();
      toast.success("Resume uploaded");
    } catch (error) {
      showErrorToast(error, "Failed to upload resume PDF");
    } finally {
      setIsUploadingPdf(false);
      if (uploadPdfInputRef.current) {
        uploadPdfInputRef.current.value = "";
      }
    }
  };

  // Resume only — used by the Resume section's Download button so it never
  // pulls the cover letter along with it.
  const handleDownloadResume = async () => {
    if (!job || !job.pdfPath || pdfActionsDisabled) return;
    const filenames = buildPdfFilenames({
      personName,
      employer: job.employer,
      language: filenameLanguage,
    });
    try {
      await downloadJobPdf(job.id, filenames.resume);
    } catch (error) {
      showErrorToast(error, "Could not download resume PDF");
    }
  };

  const handleDownloadPdf = async () => {
    if (!job) return;
    const filenames = buildPdfFilenames({
      personName,
      employer: job.employer,
      language: filenameLanguage,
    });
    // Sequential: two anchor clicks in the same tick get collapsed into one
    // download by most browsers, so a single click would only save one file.
    if (job.pdfPath && !pdfActionsDisabled) {
      try {
        await downloadJobPdf(job.id, filenames.resume);
      } catch (error) {
        showErrorToast(error, "Could not download resume PDF");
      }
    }
    if (job.coverLetterPath) {
      try {
        await downloadJobCoverLetter(job.id, filenames.coverLetter);
      } catch (error) {
        showErrorToast(error, "Could not download cover letter PDF");
      }
    }
  };

  const handleViewJobDescription = () => {
    if (!job) return;
    navigate(`${baseJobPath}/documents`, { state: jobPageNavigationState });
    window.setTimeout(() => {
      document
        .getElementById("job-description-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const currentStage = job
    ? (events.at(-1)?.toStage ??
      (job.status === "applied" || job.status === "in_progress"
        ? "applied"
        : null))
    : null;
  const isClosedStage = currentStage === "closed";
  const isInProgress = job?.status === "in_progress";
  const canLogEvents = isInProgress && !isClosedStage;
  const jobLink = job ? job.applicationLink || job.jobUrl : null;
  const isBusy = activeAction !== null;
  const isRegeneratingPdf = isPdfRegenerating(job);
  const isStalePdf = isPdfStale(job);
  const pdfLabels = getPdfActionLabels(job);
  const pdfRegeneratingReason = isRegeneratingPdf
    ? PDF_REGENERATING_MESSAGE
    : null;
  const pdfActionsDisabled = !job?.pdfPath || isRegeneratingPdf;
  const isDiscovered = job?.status === "discovered";
  const isReady = job?.status === "ready";
  const isApplied = job?.status === "applied";
  const baseJobPath = id ? `/job/${id}` : "";
  const latestNote = notes[0] ?? null;
  const latestEvent = events.at(-1) ?? null;
  const latestEventTitle =
    latestEvent?.metadata?.eventLabel || latestEvent?.title || null;
  const jobDescriptionPreview = summarizeMemoryText(job?.jobDescription, 260);
  const latestNotePreview = summarizeMemoryText(latestNote?.content, 180);
  const initialGhostwriterPrompt =
    activeMemoryView === "ghostwriter" ? searchParams.get("prompt") : null;
  const clearInitialGhostwriterPrompt = React.useCallback(() => {
    navigate(`${baseJobPath}/ghostwriter`, {
      replace: true,
      state: jobPageNavigationState,
    });
  }, [baseJobPath, jobPageNavigationState, navigate]);
  const handleBack = React.useCallback(() => {
    navigate(jobPageBackTo ?? getFallbackBackTarget(job));
  }, [job, jobPageBackTo, navigate]);
  const pageGridClass =
    activeMemoryView === "overview"
      ? "grid items-start gap-4 grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)_18rem]"
      : "grid items-start gap-4 grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)]";

  if (!id) {
    return null;
  }

  return (
    <main className="mx-auto max-w-[92rem] px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        {job &&
          (() => {
            // Color the status badge from the shared status token map so it
            // matches the pill row (Saved=blue, Ready=yellow, applied/in-progress/
            // processing=green, skipped=red, expired=grey). Application-stage
            // labels (applied+) stay on the applied/in-progress green.
            const token = statusTokens[job.status] ?? defaultStatusToken;
            return (
              <Badge variant="outline" className={token.badge}>
                {currentStage
                  ? STAGE_LABELS[currentStage as ApplicationStage] ||
                    currentStage
                  : token.label}
              </Badge>
            );
          })()}
      </div>

      {!job && (
        <div className="rounded-lg border border-dashed border-border/40 p-6 text-sm text-muted-foreground">
          {isLoading ? "Loading application..." : "Application not found."}
        </div>
      )}

      {job && (
        <div className={pageGridClass}>
          <JobPageLeftSidebar
            job={job}
            activeMemoryView={activeMemoryView}
            baseJobPath={baseJobPath}
            navigationState={jobPageNavigationState}
            selectedProjects={selectedProjects}
            sourceLabel={sourceLabel}
          />

          <div className="space-y-4">
            {activeMemoryView === "overview" && (
              <section className="space-y-4">
                <OverviewGhostwriterComposer
                  job={job}
                  baseJobPath={baseJobPath}
                  hasNotes={notes.length > 0}
                  navigationState={jobPageNavigationState}
                />

                <JobStatusPills job={job} />

                <JobBriefPane job={job} />

                <div className="grid gap-4 lg:grid-cols-2">
                  <article className="rounded-xl border border-border/50 bg-card/75 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <MessageSquareText className="h-4 w-4 text-primary" />
                        Notes
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {notesQuery.isLoading
                          ? "Loading"
                          : `${notes.length} saved`}
                      </Badge>
                    </div>
                    <div className="mt-4 min-h-[5.5rem] rounded-lg border border-border/50 bg-background/25 p-3">
                      {latestNote ? (
                        <div>
                          <div className="text-sm font-medium">
                            {latestNote.title}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Updated{" "}
                            {formatDateTime(latestNote.updatedAt) ??
                              latestNote.updatedAt}
                          </div>
                          {latestNotePreview && (
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                              {latestNotePreview}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No notes or transcripts captured yet.
                        </div>
                      )}
                    </div>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="mt-4 w-full justify-between"
                    >
                      <Link
                        to={`${baseJobPath}/notes`}
                        state={jobPageNavigationState}
                      >
                        Open notes
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </article>

                  <article className="rounded-xl border border-border/50 bg-card/75 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <FileText className="h-4 w-4 text-primary" />
                        Documents
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {job.pdfPath ? "Resume ready" : "No resume PDF"}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-border/50 bg-background/25 p-3">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          Resume PDF
                        </div>
                        <div className="mt-2 text-sm font-medium">
                          {job.pdfPath ? "Stored for this job" : "Missing"}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/25 p-3">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          Job description
                        </div>
                        <div className="mt-2 text-sm font-medium">
                          {job.jobDescription ? "Saved" : "Missing"}
                        </div>
                      </div>
                    </div>
                    {jobDescriptionPreview && (
                      <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {jobDescriptionPreview}
                      </p>
                    )}
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="mt-4 w-full justify-between"
                    >
                      <Link
                        to={`${baseJobPath}/documents`}
                        state={jobPageNavigationState}
                      >
                        Open documents
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </article>

                  <article className="rounded-xl border border-border/50 bg-card/75 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <ClipboardList className="h-4 w-4 text-primary" />
                        Timeline
                      </div>
                      {currentStage && (
                        <Badge variant="secondary" className="text-[10px]">
                          {STAGE_LABELS[currentStage as ApplicationStage] ||
                            currentStage}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-4 min-h-[5.5rem] rounded-lg border border-border/50 bg-background/25 p-3">
                      {latestEvent ? (
                        <div>
                          <div className="text-sm font-medium">
                            {latestEventTitle}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatTimestamp(latestEvent.occurredAt)}
                          </div>
                          {latestEvent.metadata?.note && (
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                              {summarizeMemoryText(
                                latestEvent.metadata.note,
                                160,
                              )}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No timeline events yet.
                        </div>
                      )}
                    </div>
                    {canLogEvents ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-4 w-full justify-between"
                        onClick={() => setIsLogModalOpen(true)}
                      >
                        <span className="flex items-center gap-2">
                          <PlusCircle className="h-3.5 w-3.5" />
                          Log event
                        </span>
                      </Button>
                    ) : (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="mt-4 w-full justify-between"
                      >
                        <Link
                          to={`${baseJobPath}/timeline`}
                          state={jobPageNavigationState}
                        >
                          Open timeline
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                  </article>
                </div>
              </section>
            )}

            {activeMemoryView === "note" && job.id && (
              <JobNotesCard jobId={job.id} />
            )}

            {activeMemoryView === "documents" && (
              <div className="space-y-4">
                <JobDocumentsPanel
                  job={job}
                  isStalePdf={isStalePdf}
                  isUploadingPdf={isUploadingPdf}
                  pdfActionsDisabled={pdfActionsDisabled}
                  pdfRegeneratingReason={pdfRegeneratingReason}
                  stalePdfMessage={STALE_PDF_MESSAGE}
                  onUploadPdf={() => uploadPdfInputRef.current?.click()}
                  onViewPdf={() => {
                    if (pdfActionsDisabled) return;
                    void openJobPdf(job.id).catch((error) => {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Could not open PDF",
                      );
                    });
                  }}
                  onDownloadPdf={() => void handleDownloadResume()}
                  onDownloadCoverLetter={() =>
                    void downloadJobCoverLetter(
                      job.id,
                      buildPdfFilenames({
                        personName,
                        employer: job.employer,
                        language: filenameLanguage,
                      }).coverLetter,
                    ).catch((error) =>
                      showErrorToast(
                        error,
                        "Could not download cover letter PDF",
                      ),
                    )
                  }
                  onRegeneratePdf={handleRegeneratePdf}
                />

                <JobBriefPane job={job} />

                <div id="job-description-panel">
                  <JobDescriptionPanel
                    description={job.jobDescription}
                    jobUrl={job.jobUrl}
                    onSave={handleSaveJobDescription}
                  />
                </div>
              </div>
            )}

            {activeMemoryView === "timeline" && (
              <section className="rounded-xl border border-border/50 bg-card/85">
                <div className="border-b border-border/50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-base font-semibold">
                      <ClipboardList className="h-4 w-4" />
                      Timeline
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {job.salary && (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        >
                          <DollarSign className="mr-1 h-3.5 w-3.5" />
                          {job.salary}
                        </Badge>
                      )}
                      {currentStage && (
                        <Badge variant="secondary">
                          {STAGE_LABELS[currentStage as ApplicationStage] ||
                            currentStage}
                        </Badge>
                      )}
                      {canLogEvents && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => setIsLogModalOpen(true)}
                        >
                          <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                          Log event
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  {!isInProgress && (
                    <div className="mb-4 rounded-md border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                      Move this job to In Progress to track application stages.
                    </div>
                  )}
                  {isInProgress && isClosedStage && (
                    <div className="mb-4 rounded-md border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                      This application is closed. Stage logging is disabled.
                    </div>
                  )}
                  <JobTimeline
                    events={events}
                    discoveredAt={job.discoveredAt}
                    onEdit={isInProgress ? handleEditEvent : undefined}
                    onDelete={isInProgress ? confirmDeleteEvent : undefined}
                  />
                </div>
              </section>
            )}

            {activeMemoryView === "emails" && <JobEmailsPanel jobId={job.id} />}

            {activeMemoryView === "ghostwriter" && (
              <section className="">
                <div className="border-b border-border/50 px-4 py-3">
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <Sparkles className="h-4 w-4" />
                    Ghostwriter
                  </div>
                </div>
                <div className="h-[calc(100vh-140px)] px-4">
                  <GhostwriterPanel
                    job={job}
                    initialPrompt={initialGhostwriterPrompt}
                    onInitialPromptConsumed={clearInitialGhostwriterPrompt}
                  />
                </div>
              </section>
            )}
          </div>

          {activeMemoryView === "overview" && (
            <JobPageRightSidebar
              job={job}
              tasks={tasks}
              jobLink={jobLink}
              isDiscovered={Boolean(isDiscovered)}
              isReady={Boolean(isReady)}
              isApplied={Boolean(isApplied)}
              isInProgress={Boolean(isInProgress)}
              canLogEvents={canLogEvents}
              isBusy={isBusy}
              pdfActionsDisabled={pdfActionsDisabled}
              pdfDownloadLabel={pdfLabels.download}
              onStartTailoring={() =>
                navigate(`/jobs/discovered/${job.id}?inspector=tailoring`)
              }
              onMarkApplied={() => void handleMarkApplied()}
              onMoveToInProgress={() => void handleMoveToInProgress()}
              onOpenLogEvent={() => setIsLogModalOpen(true)}
              onEditTailoring={() =>
                navigate(`/jobs/ready/${job.id}?inspector=tailoring`)
              }
              onDownloadPdf={() => void handleDownloadPdf()}
              onSkip={() => void handleSkip()}
              onOpenEditDetails={openEditDetails}
              onViewJobDescription={handleViewJobDescription}
              onCopyJobInfo={() => void handleCopyJobInfo()}
              onRescore={() => void handleRescore()}
              onCheckSponsor={() => void handleCheckSponsor()}
            />
          )}
        </div>
      )}

      <LogEventModal
        isOpen={isLogModalOpen}
        onClose={() => {
          setIsLogModalOpen(false);
          setEditingEvent(null);
        }}
        onLog={handleLogEvent}
        editingEvent={editingEvent}
      />

      <ConfirmDelete
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setEventToDelete(null);
        }}
        onConfirm={handleDeleteEvent}
        description={getDeleteEventDescription(events, eventToDelete)}
      />

      <JobDetailsEditDrawer
        open={isEditDetailsOpen}
        onOpenChange={setIsEditDetailsOpen}
        job={job}
        onJobUpdated={loadData}
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
    </main>
  );
};

const mergeEvents = (events: StageEvent[], pending: StageEvent | null) => {
  if (!pending) return events;
  if (events.some((event) => event.id === pending.id)) return events;
  return [...events, pending].sort((a, b) => a.occurredAt - b.occurredAt);
};

const summarizeMemoryText = (
  value: string | null | undefined,
  maxLength: number,
) => {
  const text = getRenderableJobDescription(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#*_`>[\](){}-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
};
