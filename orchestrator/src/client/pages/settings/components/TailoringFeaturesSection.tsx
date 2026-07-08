import { useUpdateSettingsMutation } from "@client/hooks/queries/useSettingsMutation";
import { useSettings } from "@client/hooks/useSettings";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { TailoringFeaturesSettings } from "@shared/types";
import type React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

const DEFAULTS: TailoringFeaturesSettings = {
  tailorExperience: false,
  summaryKeywordPush: true,
  softSkillsOnlyIfMentioned: true,
  showCoverageScore: true,
};

type FeatureKey = keyof TailoringFeaturesSettings;

const FEATURES: Array<{ key: FeatureKey; label: string; description: string }> =
  [
    {
      key: "tailorExperience",
      label: "Tailor experience bullets per job",
      description:
        "Rephrase each experience entry's bullets to surface the job's terminology and the skills you genuinely used there. Facts, dates and numbers are kept exactly; nothing is invented. Off by default — review results before relying on it.",
    },
    {
      key: "summaryKeywordPush",
      label: "Weave JD keywords into the summary",
      description:
        "The tailored summary works in 2-3 of the job's key requirements you genuinely have, using the job ad's exact wording, for stronger ATS matching.",
    },
    {
      key: "softSkillsOnlyIfMentioned",
      label: "Soft skills only when the JD names them",
      description:
        "Keep generic soft skills (communication, teamwork, leadership) out of the tailored skills unless the job ad explicitly asks for them.",
    },
    {
      key: "showCoverageScore",
      label: "Show ATS coverage score",
      description:
        "Display how much of the job's must-have keywords the tailored CV covers, as a percentage.",
    },
  ];

function normalize(
  value: TailoringFeaturesSettings | null | undefined,
): TailoringFeaturesSettings {
  return {
    tailorExperience: value?.tailorExperience ?? DEFAULTS.tailorExperience,
    summaryKeywordPush:
      value?.summaryKeywordPush ?? DEFAULTS.summaryKeywordPush,
    softSkillsOnlyIfMentioned:
      value?.softSkillsOnlyIfMentioned ?? DEFAULTS.softSkillsOnlyIfMentioned,
    showCoverageScore: value?.showCoverageScore ?? DEFAULTS.showCoverageScore,
  };
}

export const TailoringFeaturesSection: React.FC<{
  layoutMode?: "accordion" | "panel";
}> = ({ layoutMode }) => {
  const { settings } = useSettings();
  const updateSettingsMutation = useUpdateSettingsMutation();
  const current = normalize(settings?.tailoringFeatures?.value);
  const disabled = !settings || updateSettingsMutation.isPending;

  const toggle = (key: FeatureKey, checked: boolean) => {
    updateSettingsMutation.mutate({
      tailoringFeatures: { ...current, [key]: checked },
    });
  };

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title="Tailoring Features"
      value="tailoring"
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Each toggle is saved automatically — the global “Save changes” button
          does not apply to this section.
          {updateSettingsMutation.isPending ? " Saving…" : ""}
        </p>
        {FEATURES.map((feature, index) => (
          <div key={feature.key}>
            {index > 0 ? <Separator className="mb-4" /> : null}
            <div className="flex items-start space-x-3">
              <Checkbox
                id={feature.key}
                checked={current[feature.key]}
                onCheckedChange={(checked) => {
                  if (checked !== "indeterminate") {
                    toggle(feature.key, checked === true);
                  }
                }}
                disabled={disabled}
              />
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={feature.key}
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  {feature.label}
                </label>
                <p className="text-xs text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </SettingsSectionFrame>
  );
};
