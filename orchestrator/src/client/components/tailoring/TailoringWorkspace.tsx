import * as api from "@client/api";
import { useProfile } from "@client/hooks/useProfile";
import { useSettings } from "@client/hooks/useSettings";
import { useTracerReadiness } from "@client/hooks/useTracerReadiness";
import type { Job } from "@shared/types.js";
import { Check, CircleAlert, Loader2, Sparkles } from "lucide-react";
import type React from "react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Tip } from "@/client/components/Tip";
import { TooltipWhenDisabled } from "@/client/components/TooltipWhenDisabled";
import { formatUserFacingError } from "@/client/lib/error-format";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";
import {
  fromEditableSkillGroups,
  getOriginalHeadline,
  getOriginalSkills,
  getOriginalSummary,
  parseTailoredSkills,
  serializeTailoredSkills,
  toEditableSkillGroups,
} from "../tailoring-utils";
import { TailoringSections } from "./TailoringSections";
import {
  getTailoringSavePayloadKey,
  type TailoringSavePayload,
  useTailoringDraft,
} from "./useTailoringDraft";

interface TailoringWorkspaceBaseProps {
  job: Job;
  onDirtyChange?: (isDirty: boolean) => void;
  // When true, open the cover-letter accordion section (e.g. from the apply
  // prompt), then call onCoverLetterFocusConsumed to clear the request.
  focusCoverLetter?: boolean;
  onCoverLetterFocusConsumed?: () => void;
}

interface TailoringWorkspaceEditorProps extends TailoringWorkspaceBaseProps {
  mode: "editor";
  onUpdate: () => void | Promise<void>;
  onRegisterSave?: (save: () => Promise<void>) => void;
  onRegisterBuildPdf?: (build: (() => Promise<void>) | null) => void;
  onRegisterCoverLetterBuild?: (build: (() => Promise<void>) | null) => void;
  onBeforeGenerate?: () => boolean | Promise<boolean>;
}

type TailoringWorkspaceProps = TailoringWorkspaceEditorProps;
type TailoringSectionsProps = ComponentProps<typeof TailoringSections>;

interface TailoringBaseline {
  summary: string;
  headline: string;
  skillsJson: string;
}

type AutosaveStatus = "saved" | "unsaved" | "saving" | "error";
type TailoringGenerateTarget = "all" | "summary" | "headline" | "skills";

const AutosaveStatusIcon: React.FC<{ status: AutosaveStatus }> = ({
  status,
}) => {
  const copy =
    status === "saving"
      ? "Saving..."
      : status === "unsaved"
        ? "Unsaved changes"
        : status === "error"
          ? "Save failed"
          : "Saved";
  const iconClassName =
    status === "error"
      ? "text-rose-300"
      : status === "unsaved"
        ? "text-amber-300"
        : status === "saving"
          ? "text-muted-foreground"
          : "text-emerald-400/80";

  return (
    <Tip content={<p>{copy}</p>}>
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground"
        role="img"
        aria-label={copy}
      >
        {status === "saving" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : status === "error" || status === "unsaved" ? (
          <CircleAlert className={`h-3.5 w-3.5 ${iconClassName}`} />
        ) : (
          <Check className={`h-3.5 w-3.5 ${iconClassName}`} />
        )}
      </span>
    </Tip>
  );
};

const normalizeSkillsJson = (value: string | null | undefined) =>
  serializeTailoredSkills(parseTailoredSkills(value));
const textHasValue = (value: string) => value.trim().length > 0;

const toBaselineFromJob = (job: Job): TailoringBaseline => ({
  summary: job.tailoredSummary ?? "",
  headline: job.tailoredHeadline ?? "",
  skillsJson: normalizeSkillsJson(job.tailoredSkills),
});

const toSavePayloadFromJob = (job: Job): TailoringSavePayload => ({
  tailoredSummary: job.tailoredSummary ?? "",
  tailoredHeadline: job.tailoredHeadline ?? "",
  tailoredSkills: normalizeSkillsJson(job.tailoredSkills),
  jobDescription: job.jobDescription ?? "",
  selectedProjectIds: job.selectedProjectIds ?? "",
  tracerLinksEnabled: Boolean(job.tracerLinksEnabled),
});

export const TailoringWorkspace: React.FC<TailoringWorkspaceProps> = (
  props,
) => {
  const {
    catalog,
    isCatalogLoading,
    summary,
    setSummary,
    headline,
    setHeadline,
    jobDescription,
    setJobDescription,
    selectedIds,
    selectedIdsCsv,
    tracerLinksEnabled,
    setTracerLinksEnabled,
    skillsDraft,
    setSkillsDraft,
    openSkillGroupId,
    setOpenSkillGroupId,
    skillsJson,
    isDirty,
    savedPayloadKey,
    applyIncomingDraft,
    markSavedSnapshot,
    markSavedJob,
    handleToggleProject,
    handleAddSkillGroup,
    handleUpdateSkillGroup,
    handleRemoveSkillGroup,
  } = useTailoringDraft({
    job: props.job,
    onDirtyChange: props.onDirtyChange,
  });

  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("saved");
  const [generateTarget, setGenerateTarget] =
    useState<TailoringGenerateTarget | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const saveAgainRef = useRef(false);
  const latestPayloadRef = useRef<TailoringSavePayload | null>(null);
  const persistedPayloadKeyRef = useRef(savedPayloadKey);
  const isMountedRef = useRef(true);
  const { profile, error: profileError } = useProfile();
  const { settings, isLoading: isSettingsLoading } = useSettings();
  const { readiness: tracerReadiness, isChecking: isTracerReadinessChecking } =
    useTracerReadiness();

  const originalValues = useMemo(() => {
    const skillsDraft = toEditableSkillGroups(getOriginalSkills(profile));
    return {
      summary: getOriginalSummary(profile),
      headline: getOriginalHeadline(profile),
      skillsDraft,
      skillsJson: serializeTailoredSkills(fromEditableSkillGroups(skillsDraft)),
    };
  }, [profile]);
  const canUseOriginalValues = Boolean(profile) && !profileError;
  const [aiBaseline, setAiBaseline] = useState<TailoringBaseline>(() =>
    toBaselineFromJob(props.job),
  );

  useEffect(() => {
    setAiBaseline({
      summary: props.job.tailoredSummary ?? "",
      headline: props.job.tailoredHeadline ?? "",
      skillsJson: normalizeSkillsJson(props.job.tailoredSkills),
    });
  }, [
    props.job.tailoredSummary,
    props.job.tailoredHeadline,
    props.job.tailoredSkills,
  ]);

  const tracerEnableBlocked =
    !tracerLinksEnabled && !tracerReadiness?.canEnable;
  const tracerEnableBlockedReason =
    tracerReadiness?.canEnable === false
      ? (tracerReadiness.reason ??
        "Verify tracer links in Settings before enabling this job.")
      : null;

  const savePayload = useMemo<TailoringSavePayload>(
    () => ({
      tailoredSummary: summary,
      tailoredHeadline: headline,
      tailoredSkills: skillsJson,
      jobDescription,
      selectedProjectIds: selectedIdsCsv,
      tracerLinksEnabled,
    }),
    [
      summary,
      headline,
      skillsJson,
      jobDescription,
      selectedIdsCsv,
      tracerLinksEnabled,
    ],
  );
  const savePayloadKey = useMemo(
    () => getTailoringSavePayloadKey(savePayload),
    [savePayload],
  );

  useEffect(() => {
    latestPayloadRef.current = savePayload;
  }, [savePayload]);

  useEffect(() => {
    persistedPayloadKeyRef.current = savedPayloadKey;
  }, [savedPayloadKey]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  const runAutosaveLoop = useCallback(async () => {
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      await saveInFlightRef.current;
      return;
    }

    let didSave = false;
    const savePromise = (async () => {
      try {
        do {
          saveAgainRef.current = false;
          const snapshot = latestPayloadRef.current;
          if (!snapshot) return;

          if (
            getTailoringSavePayloadKey(snapshot) ===
            persistedPayloadKeyRef.current
          ) {
            if (isMountedRef.current) setAutosaveStatus("saved");
            return;
          }

          if (isMountedRef.current) setAutosaveStatus("saving");
          const snapshotKey = getTailoringSavePayloadKey(snapshot);
          const updatedJob = await api.updateJob(props.job.id, snapshot);
          didSave = true;
          if (!isMountedRef.current) return;
          const updatedPayload = toSavePayloadFromJob(updatedJob);

          const latestStillMatchesSnapshot =
            latestPayloadRef.current &&
            getTailoringSavePayloadKey(latestPayloadRef.current) ===
              snapshotKey;
          if (latestStillMatchesSnapshot) {
            markSavedSnapshot(snapshot);
            latestPayloadRef.current = snapshot;
          } else {
            markSavedJob(updatedJob);
          }
          persistedPayloadKeyRef.current = latestStillMatchesSnapshot
            ? snapshotKey
            : getTailoringSavePayloadKey(updatedPayload);

          const latestKey = latestPayloadRef.current
            ? getTailoringSavePayloadKey(latestPayloadRef.current)
            : persistedPayloadKeyRef.current;
          if (isMountedRef.current) {
            setAutosaveStatus(
              latestKey === persistedPayloadKeyRef.current
                ? "saved"
                : "unsaved",
            );
          }
        } while (
          saveAgainRef.current ||
          (latestPayloadRef.current &&
            getTailoringSavePayloadKey(latestPayloadRef.current) !==
              persistedPayloadKeyRef.current)
        );
      } catch {
        if (isMountedRef.current) setAutosaveStatus("error");
        throw new Error("Autosave failed");
      } finally {
        saveInFlightRef.current = null;
      }
    })();

    saveInFlightRef.current = savePromise;
    await savePromise;
    // Notify the parent so selectedJob's resumeFreshness re-derives (PDF goes
    // stale on edits) — keeps the Final-check/Build-PDF CTA consistent with the
    // cover-letter editor, which already refreshes on save.
    if (didSave) {
      void props.onUpdate();
    }
  }, [markSavedJob, markSavedSnapshot, props.job.id, props.onUpdate]);

  const flushAutosave = useCallback(async () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      await saveInFlightRef.current;
    }
    const latestPayload = latestPayloadRef.current;
    if (
      latestPayload &&
      getTailoringSavePayloadKey(latestPayload) !==
        persistedPayloadKeyRef.current
    ) {
      await runAutosaveLoop();
    }
  }, [runAutosaveLoop]);

  useEffect(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    if (!isDirty || savePayloadKey === persistedPayloadKeyRef.current) {
      if (!saveInFlightRef.current) setAutosaveStatus("saved");
      return;
    }

    setAutosaveStatus("unsaved");
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      return;
    }

    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void runAutosaveLoop().catch(() => {
        // The status state already reflects the failure; keep the draft local.
      });
    }, 800);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [isDirty, runAutosaveLoop, savePayloadKey]);

  useEffect(() => {
    if (!props.onRegisterSave) return;
    props.onRegisterSave(flushAutosave);
  }, [props.onRegisterSave, flushAutosave]);

  const handleGenerateTailoring = useCallback(
    async (target: TailoringGenerateTarget) => {
      try {
        setGenerateTarget(target);
        await flushAutosave();

        const updatedJob = await api.summarizeJob(props.job.id, {
          force: true,
          fields: target === "all" ? undefined : [target],
        });
        applyIncomingDraft(updatedJob);
        setAiBaseline(toBaselineFromJob(updatedJob));
        toast.success(
          target === "all"
            ? "Draft content generated"
            : `${target[0].toUpperCase()}${target.slice(1)} generated`,
        );
        await props.onUpdate();
      } catch (error) {
        showErrorToast(error, "AI generation failed");
      } finally {
        setGenerateTarget(null);
      }
    },
    [props.onUpdate, flushAutosave, props.job.id, applyIncomingDraft],
  );

  const handleSummarizeEditor = useCallback(async () => {
    await handleGenerateTailoring("all");
  }, [handleGenerateTailoring]);

  const handleGenerateSummary = useCallback(async () => {
    await handleGenerateTailoring("summary");
  }, [handleGenerateTailoring]);

  const handleGenerateHeadline = useCallback(async () => {
    await handleGenerateTailoring("headline");
  }, [handleGenerateTailoring]);

  const handleGenerateSkills = useCallback(async () => {
    await handleGenerateTailoring("skills");
  }, [handleGenerateTailoring]);

  const handleGeneratePdf = useCallback(async () => {
    try {
      const shouldProceed = props.onBeforeGenerate
        ? await props.onBeforeGenerate()
        : true;
      if (shouldProceed === false) return;

      setIsGeneratingPdf(true);
      await flushAutosave();
      await api.generateJobPdf(props.job.id);
      toast.success("Resume PDF generated");
      await props.onUpdate();
    } catch (error) {
      const message = formatUserFacingError(error, "PDF generation failed");
      if (/tracer/i.test(message)) {
        toast.error("Tracer links are unavailable right now", {
          description: message,
        });
      } else {
        showErrorToast(error, "PDF generation failed");
      }
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [props.onBeforeGenerate, props.onUpdate, flushAutosave, props.job.id]);

  useEffect(() => {
    props.onRegisterBuildPdf?.(handleGeneratePdf);
    return () => props.onRegisterBuildPdf?.(null);
  }, [props.onRegisterBuildPdf, handleGeneratePdf]);

  const handleUndoSummary = useCallback(() => {
    setSummary(originalValues.summary);
  }, [originalValues.summary, setSummary]);

  const handleUndoHeadline = useCallback(() => {
    setHeadline(originalValues.headline);
  }, [originalValues.headline, setHeadline]);

  const handleUndoSkills = useCallback(() => {
    setSkillsDraft(originalValues.skillsDraft);
  }, [originalValues.skillsDraft, setSkillsDraft]);

  const handleRedoSummary = useCallback(() => {
    setSummary(aiBaseline.summary);
  }, [aiBaseline.summary, setSummary]);

  const handleRedoHeadline = useCallback(() => {
    setHeadline(aiBaseline.headline);
  }, [aiBaseline.headline, setHeadline]);

  const handleRedoSkills = useCallback(() => {
    setSkillsDraft(
      toEditableSkillGroups(parseTailoredSkills(aiBaseline.skillsJson)),
    );
  }, [aiBaseline.skillsJson, setSkillsDraft]);

  // Once applied (or further), the application is sent — lock tailoring so it
  // can't be edited or rebuilt. Rebuilding would also flip the job back to
  // "ready" (the PDF commit sets status: ready), bouncing it out of Applied.
  const isPostApplication =
    props.job.status === "applied" || props.job.status === "in_progress";
  const appliedLockReason = isPostApplication
    ? "This job is already applied — tailoring is locked. You can still monitor it and ask the assistant."
    : null;
  // A custom-uploaded resume makes the tailored sections moot (they only feed a
  // generated PDF); an applied job is locked. Either way, make inputs read-only.
  const disableInputs =
    Boolean(generateTarget) ||
    isGeneratingPdf ||
    props.job.pdfSource === "uploaded" ||
    Boolean(appliedLockReason);
  const isDraftReady = textHasValue(summary) && textHasValue(headline);
  // A custom-uploaded resume can't be overwritten, and an applied job is locked;
  // both block tailoring (AI) and PDF generation, so surface one shared reason.
  const generateResumeReason =
    props.job.pdfSource === "uploaded"
      ? "You uploaded a custom resume. Delete it in Documents to tailor and generate from your content."
      : appliedLockReason;
  const tailoringSectionsProps = useMemo<TailoringSectionsProps>(
    () => ({
      catalog,
      isCatalogLoading,
      summary,
      headline,
      jobDescription,
      skillsDraft,
      selectedIds,
      resumeProjectsSettings: settings?.resumeProjects.value ?? null,
      isResumeProjectsSettingsLoading: isSettingsLoading,
      tracerLinksEnabled,
      tracerEnableBlocked,
      tracerEnableBlockedReason,
      tracerReadinessChecking: isTracerReadinessChecking,
      generatingSection:
        generateTarget === "summary" ||
        generateTarget === "headline" ||
        generateTarget === "skills"
          ? generateTarget
          : null,
      openSkillGroupId,
      disableInputs,
      onGenerateSummary: handleGenerateSummary,
      onGenerateHeadline: handleGenerateHeadline,
      onGenerateSkills: handleGenerateSkills,
      onSummaryChange: setSummary,
      onHeadlineChange: setHeadline,
      onUndoSummary: handleUndoSummary,
      onUndoHeadline: handleUndoHeadline,
      onUndoSkills: handleUndoSkills,
      onRedoSummary: handleRedoSummary,
      onRedoHeadline: handleRedoHeadline,
      onRedoSkills: handleRedoSkills,
      canUndoSummary:
        canUseOriginalValues && summary !== originalValues.summary,
      canUndoHeadline:
        canUseOriginalValues && headline !== originalValues.headline,
      canUndoSkills:
        canUseOriginalValues && skillsJson !== originalValues.skillsJson,
      canRedoSummary: summary !== aiBaseline.summary,
      canRedoHeadline: headline !== aiBaseline.headline,
      canRedoSkills: skillsJson !== aiBaseline.skillsJson,
      undoDisabledReason: canUseOriginalValues
        ? null
        : "Original base CV unavailable.",
      onDescriptionChange: setJobDescription,
      onSkillGroupOpenChange: setOpenSkillGroupId,
      onAddSkillGroup: handleAddSkillGroup,
      onUpdateSkillGroup: handleUpdateSkillGroup,
      onRemoveSkillGroup: handleRemoveSkillGroup,
      onToggleProject: handleToggleProject,
      onTracerLinksEnabledChange: setTracerLinksEnabled,
      job: props.job,
      onCoverLetterUpdate: props.onUpdate,
      focusCoverLetter: props.focusCoverLetter,
      onCoverLetterFocusConsumed: props.onCoverLetterFocusConsumed,
      onRegisterCoverLetterBuild: props.onRegisterCoverLetterBuild,
    }),
    [
      catalog,
      isCatalogLoading,
      summary,
      headline,
      jobDescription,
      skillsDraft,
      selectedIds,
      settings?.resumeProjects.value,
      isSettingsLoading,
      tracerLinksEnabled,
      tracerEnableBlocked,
      tracerEnableBlockedReason,
      isTracerReadinessChecking,
      generateTarget,
      openSkillGroupId,
      disableInputs,
      handleGenerateSummary,
      handleGenerateHeadline,
      handleGenerateSkills,
      setSummary,
      setHeadline,
      handleUndoSummary,
      handleUndoHeadline,
      handleUndoSkills,
      handleRedoSummary,
      handleRedoHeadline,
      handleRedoSkills,
      canUseOriginalValues,
      originalValues,
      skillsJson,
      aiBaseline,
      setJobDescription,
      setOpenSkillGroupId,
      handleAddSkillGroup,
      handleUpdateSkillGroup,
      handleRemoveSkillGroup,
      handleToggleProject,
      setTracerLinksEnabled,
      props.job,
      props.onUpdate,
      props.focusCoverLetter,
      props.onCoverLetterFocusConsumed,
      props.onRegisterCoverLetterBuild,
    ],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <div
          className={`flex min-h-16 items-center justify-between gap-3 rounded-md border px-3 py-3 ${
            isDraftReady
              ? "border-emerald-500/20 bg-emerald-500/[0.04]"
              : "border-amber-500/20 bg-amber-500/[0.04]"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                isDraftReady
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/45 bg-amber-500/10 text-amber-300"
              }`}
            >
              {isDraftReady ? (
                <Check className="h-4 w-4" />
              ) : (
                <CircleAlert className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground/90">
                {isDraftReady ? "Draft ready" : "Draft incomplete"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                {isDraftReady
                  ? "Review optional sections before building the PDF."
                  : "Generate Sections before building the PDF."}
              </p>
            </div>
          </div>
          {/* The idle "Saved" tick is misleading on an incomplete draft where
              nothing has been generated yet — only show it once the draft is
              ready. Saving/unsaved/error feedback still shows while editing. */}
          {isDraftReady || autosaveStatus !== "saved" ? (
            <AutosaveStatusIcon status={autosaveStatus} />
          ) : null}
        </div>

        {/* Single full-width Generate. Build PDF lives in the inspector header
            CTA now, so the second footer button would be redundant. */}
        <TooltipWhenDisabled
          reason={generateResumeReason}
          className="h-full w-full"
        >
          <Button
            onClick={handleSummarizeEditor}
            className="h-full min-h-11 w-full text-sm"
            disabled={
              Boolean(generateTarget) ||
              isGeneratingPdf ||
              Boolean(generateResumeReason)
            }
            variant="outline"
          >
            {generateTarget === "all" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate
          </Button>
        </TooltipWhenDisabled>
      </div>

      <TailoringSections {...tailoringSectionsProps} />
    </div>
  );
};
