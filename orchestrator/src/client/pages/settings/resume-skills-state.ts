import type { ProjectTailoringMode } from "@client/components/design-resume/DesignResumeListSection";
import type { ResumeSkillsSettings } from "@shared/types.js";

const DEFAULT_RESUME_SKILLS: ResumeSkillsSettings = {
  maxKeywords: 22,
  lockedGroupIds: [],
  excludedGroupIds: [],
};

export function normalizeResumeSkills(
  value: ResumeSkillsSettings | null | undefined,
): ResumeSkillsSettings {
  if (!value) return { ...DEFAULT_RESUME_SKILLS };
  return {
    maxKeywords: typeof value.maxKeywords === "number" ? value.maxKeywords : 22,
    lockedGroupIds: Array.isArray(value.lockedGroupIds)
      ? value.lockedGroupIds
      : [],
    excludedGroupIds: Array.isArray(value.excludedGroupIds)
      ? value.excludedGroupIds
      : [],
  };
}

/** Locked → "Always", excluded → "Don't select", otherwise the default "AI can select". */
export function getSkillTailoringMode(
  settings: ResumeSkillsSettings,
  groupId: string,
): ProjectTailoringMode {
  if (settings.lockedGroupIds.includes(groupId)) return "must-include";
  if (settings.excludedGroupIds.includes(groupId)) return "manual";
  return "ai-selectable";
}

export function setSkillTailoringMode(args: {
  settings: ResumeSkillsSettings;
  groupId: string;
  mode: ProjectTailoringMode;
}): ResumeSkillsSettings {
  const { settings, groupId, mode } = args;
  const lockedGroupIds = settings.lockedGroupIds.filter((id) => id !== groupId);
  const excludedGroupIds = settings.excludedGroupIds.filter(
    (id) => id !== groupId,
  );
  if (mode === "must-include") lockedGroupIds.push(groupId);
  else if (mode === "manual") excludedGroupIds.push(groupId);
  return { ...settings, lockedGroupIds, excludedGroupIds };
}
