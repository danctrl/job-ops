import * as api from "@client/api";
import { showErrorToast } from "@client/lib/error-toast";
import type { CoverLetterDetails, Job } from "@shared/types.js";
import { Loader2, Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TooltipWhenDisabled } from "@/client/components/TooltipWhenDisabled";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  SectionTriggerLabel,
  sectionClass,
  triggerClass,
} from "./TailoringSections";

type CoverLetterEditorProps = {
  job: Job;
  onUpdate?: (job: Job) => void | Promise<void>;
  // When set true (e.g. from the Final-check "Add cover letter" prompt),
  // generate the body and build the PDF once the section is open.
  autoGenerate?: boolean;
  // Lifts the cover-letter PDF build so a parent CTA can trigger it.
  onRegisterBuild?: (build: (() => Promise<void>) | null) => void;
};

const AUTOSAVE_DELAY_MS = 800;

const inputClass =
  "w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-60";

function detailsFromJob(job: Job): Required<CoverLetterDetails> {
  const d = job.coverLetterDetails ?? {};
  return {
    body: d.body ?? "",
    contactPerson: d.contactPerson ?? "",
    companyName: d.companyName ?? "",
    addressLines: d.addressLines ?? [],
    salutation: d.salutation ?? "",
    closing: d.closing ?? "",
  };
}

export const CoverLetterEditor: React.FC<CoverLetterEditorProps> = ({
  job,
  onUpdate,
  autoGenerate = false,
  onRegisterBuild,
}) => {
  const seed = useMemo(() => detailsFromJob(job), [job]);

  const [body, setBody] = useState(seed.body);
  const [contactPerson, setContactPerson] = useState(seed.contactPerson);
  const [companyName, setCompanyName] = useState(seed.companyName);
  const [addressText, setAddressText] = useState(seed.addressLines.join("\n"));
  const [salutation, setSalutation] = useState(seed.salutation);
  const [closing, setClosing] = useState(seed.closing);

  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGeneratingAddress, setIsGeneratingAddress] = useState(false);

  const lastJobIdRef = useRef(job.id);
  const savedKeyRef = useRef<string>("");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const details = useMemo<CoverLetterDetails>(
    () => ({
      body,
      contactPerson,
      companyName,
      addressLines: addressText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      salutation,
      closing,
    }),
    [body, contactPerson, companyName, addressText, salutation, closing],
  );

  const detailsKey = useMemo(() => JSON.stringify(details), [details]);

  // Reseed when switching jobs.
  useEffect(() => {
    if (job.id === lastJobIdRef.current) return;
    lastJobIdRef.current = job.id;
    const next = detailsFromJob(job);
    setBody(next.body);
    setContactPerson(next.contactPerson);
    setCompanyName(next.companyName);
    setAddressText(next.addressLines.join("\n"));
    setSalutation(next.salutation);
    setClosing(next.closing);
    savedKeyRef.current = "";
  }, [job]);

  // Establish the baseline saved key once per job so the first render isn't dirty.
  useEffect(() => {
    if (savedKeyRef.current === "") {
      const seeded = detailsFromJob(job);
      // Mirror the `details` memo (normalized addressLines) so the baseline
      // matches detailsKey exactly and the first render isn't falsely dirty.
      savedKeyRef.current = JSON.stringify({
        body: seeded.body,
        contactPerson: seeded.contactPerson,
        companyName: seeded.companyName,
        addressLines: seeded.addressLines
          .map((line) => line.trim())
          .filter(Boolean),
        salutation: seeded.salutation,
        closing: seeded.closing,
      });
    }
  }, [job]);

  // Debounced autosave of the editable details.
  useEffect(() => {
    if (savedKeyRef.current === "" || detailsKey === savedKeyRef.current) {
      return;
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      api
        .updateJob(job.id, { coverLetterDetails: details })
        .then((updated) => {
          savedKeyRef.current = detailsKey;
          void onUpdate?.(updated);
        })
        .catch((error) => {
          showErrorToast(error, "Failed to save cover letter details");
        });
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [detailsKey, details, job.id, onUpdate]);

  // Replace local editor state from a server job (e.g. after AI writes a new
  // body). The reseed effect above only fires on job-id changes, so staying on
  // the same job needs an explicit reseed or the new body shows only on reload.
  const reseedFromJob = (next: Job) => {
    const seeded = detailsFromJob(next);
    setBody(seeded.body);
    setContactPerson(seeded.contactPerson);
    setCompanyName(seeded.companyName);
    setAddressText(seeded.addressLines.join("\n"));
    setSalutation(seeded.salutation);
    setClosing(seeded.closing);
    savedKeyRef.current = JSON.stringify(seeded);
  };

  const handleUpdatePdf = async () => {
    try {
      const updated = await api.rerenderCoverLetter(job.id);
      await onUpdate?.(updated);
      toast.success("Cover letter generated");
    } catch (error) {
      showErrorToast(error, "Failed to update cover letter PDF");
    }
  };

  const handleGenerateAddress = async () => {
    try {
      setIsGeneratingAddress(true);
      const suggestion = await api.generateCoverLetterAddress(job.id);
      if (suggestion.addressLines.length > 0) {
        setAddressText(suggestion.addressLines.join("\n"));
      }
      if (suggestion.companyName && !companyName.trim()) {
        setCompanyName(suggestion.companyName);
      }
      if (suggestion.contactPerson && !contactPerson.trim()) {
        setContactPerson(suggestion.contactPerson);
      }
      toast.success("Address drafted — verify before sending");
    } catch (error) {
      showErrorToast(error, "Failed to generate address");
    } finally {
      setIsGeneratingAddress(false);
    }
  };

  const handleRegenerate = async () => {
    try {
      setIsRegenerating(true);
      // Write the body only (no PDF) so the user can review/edit before building,
      // mirroring the resume "Generate" → "Build PDF" flow.
      const updated = await api.generateCoverLetter(job.id, { render: false });
      reseedFromJob(updated);
      await onUpdate?.(updated);
      toast.success("Cover letter written");
    } catch (error) {
      showErrorToast(error, "Failed to regenerate cover letter");
    } finally {
      setIsRegenerating(false);
    }
  };

  const isUploaded = job.coverLetterSource === "uploaded";
  const hasContent = Boolean(job.coverLetterPath) || body.trim().length > 0;
  // Lock the editor (shown read-only/greyed) when the cover letter can't change:
  // a custom upload can't be overwritten, and an applied job is sent.
  const lockReason = isUploaded
    ? "You uploaded a custom cover letter. Delete it in Documents to edit or generate one from your content."
    : job.status === "applied" || job.status === "in_progress"
      ? "This job is already applied — the cover letter is locked."
      : null;
  const isLocked = Boolean(lockReason);

  // Auto-generate + build once when requested via the Final-check prompt, but
  // only if there's nothing yet and the editor isn't locked. Runs a single
  // time. Handlers are read through a ref so they don't need to be deps.
  const autoGenRanRef = useRef(false);
  const autoRunRef = useRef<() => Promise<void>>(async () => {});
  autoRunRef.current = async () => {
    await handleRegenerate();
    await handleUpdatePdf();
  };
  useEffect(() => {
    if (!autoGenerate || autoGenRanRef.current) return;
    if (isLocked || job.coverLetterPath || body.trim().length > 0) return;
    autoGenRanRef.current = true;
    void autoRunRef.current();
  }, [autoGenerate, isLocked, body, job.coverLetterPath]);

  // Lift the build so a parent CTA can rebuild the cover letter PDF. Read the
  // latest handler through a ref so the registration stays stable.
  const buildPdfRef = useRef(handleUpdatePdf);
  buildPdfRef.current = handleUpdatePdf;
  useEffect(() => {
    onRegisterBuild?.(() => buildPdfRef.current());
    return () => onRegisterBuild?.(null);
  }, [onRegisterBuild]);

  return (
    <AccordionItem value="cover-letter" className={sectionClass}>
      <AccordionTrigger className={triggerClass} aria-label="Cover letter">
        <SectionTriggerLabel
          title="Cover letter"
          state={hasContent ? "ready" : "optional"}
        />
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3 pt-3">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <TooltipWhenDisabled reason={lockReason}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleRegenerate()}
                disabled={isRegenerating || isLocked}
              >
                {isRegenerating ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                Generate
              </Button>
            </TooltipWhenDisabled>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact person">
              <input
                className={inputClass}
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                disabled={isLocked}
                placeholder="Hiring manager name"
              />
            </Field>
            <Field label="Company">
              <input
                className={inputClass}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={isLocked}
                placeholder={job.employer}
              />
            </Field>
          </div>
          <Field
            label="Address"
            action={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => void handleGenerateAddress()}
                disabled={isGeneratingAddress || isLocked}
              >
                {isGeneratingAddress ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-3 w-3" />
                )}
                Generate
              </Button>
            }
          >
            <textarea
              className={`${inputClass} min-h-[80px]`}
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
              disabled={isLocked}
              placeholder={"Street\nPostcode City\nCountry"}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Salutation">
              <input
                className={inputClass}
                value={salutation}
                onChange={(e) => setSalutation(e.target.value)}
                disabled={isLocked}
                placeholder="Dear Hiring Manager,"
              />
            </Field>
            <Field label="Closing">
              <input
                className={inputClass}
                value={closing}
                onChange={(e) => setClosing(e.target.value)}
                disabled={isLocked}
                placeholder="Sincerely,"
              />
            </Field>
          </div>
          <Field label="Body">
            <textarea
              className={`${inputClass} min-h-[260px] font-mono text-xs leading-5`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isLocked}
              placeholder="Generate a cover letter, then personalize the text here. Separate paragraphs with a blank line."
            />
          </Field>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};

const Field: React.FC<{
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, action, children }) => (
  <div className="space-y-1.5">
    <div className="flex min-h-6 items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {action}
    </div>
    {children}
  </div>
);
