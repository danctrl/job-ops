import { normalizeLocation } from "./string";

/**
 * Canonical workplace arrangement. Kept single-valued: when a source lists
 * several (e.g. "Remote | On-site"), they collapse to one via
 * `normalizeWorkplaceType` — remote + on-site means hybrid.
 */
export type WorkplaceType = "remote" | "hybrid" | "onsite";

const TOKEN_PATTERNS: ReadonlyArray<readonly [WorkplaceType, RegExp]> = [
  ["hybrid", /^hybrid$/i],
  [
    "remote",
    /^(?:fully\s+)?remote$|^100\s*%?\s*remote$|^home\s?office$|^work\s+from\s+home$|^wfh$/i,
  ],
  [
    "onsite",
    /^on[\s-]?site$|^onsite$|^vor\s+ort$|^in\s+office$|^office\s+based$|^on[\s-]?premise$/i,
  ],
];

/** Map a single raw token to a canonical workplace type, or null. */
export function canonicalWorkplaceToken(value: string): WorkplaceType | null {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return null;
  for (const [type, pattern] of TOKEN_PATTERNS) {
    if (pattern.test(normalized)) return type;
  }
  return null;
}

/**
 * Collapse many workplace signals to a single canonical type.
 * Rule: hybrid wins; remote + on-site is hybrid; otherwise the lone type.
 */
export function normalizeWorkplaceType(
  signals: ReadonlyArray<string | null | undefined>,
): WorkplaceType | null {
  const seen = new Set<WorkplaceType>();
  for (const signal of signals) {
    if (!signal) continue;
    const type = canonicalWorkplaceToken(signal);
    if (type) seen.add(type);
  }
  if (seen.has("hybrid")) return "hybrid";
  if (seen.has("remote") && seen.has("onsite")) return "hybrid";
  if (seen.has("remote")) return "remote";
  if (seen.has("onsite")) return "onsite";
  return null;
}

/**
 * Resolve a job's canonical work mode from its stored `workFromHomeType` string
 * and the separate `isRemote` boolean, using the same collapse rule. This is the
 * single gate both the UI display and the "Missing or unclear" check use, so a
 * job can never show a work mode that the gap list also reports as missing.
 */
export function resolveWorkMode(
  workFromHomeType: string | null | undefined,
  isRemote?: boolean | null,
): WorkplaceType | null {
  return normalizeWorkplaceType([workFromHomeType, isRemote ? "remote" : null]);
}

/**
 * Split a raw location into a clean place string and its workplace type.
 * Workplace words belong in the workplace field, not the location, e.g.
 * "Berlin, Germany | On-site" -> { location: "Berlin, Germany", workplaceType: "onsite" }.
 * Handles pipe/slash separators, comma components, and "Remote (Place)".
 */
export function stripWorkplaceFromLocation(raw: string | null | undefined): {
  location: string;
  workplaceType: WorkplaceType | null;
} {
  if (!raw) return { location: "", workplaceType: null };

  const found: WorkplaceType[] = [];
  const keptSegments: string[] = [];

  for (const segment of raw.split(/\s*[|/]\s*/)) {
    const whole = canonicalWorkplaceToken(segment);
    if (whole) {
      found.push(whole);
      continue;
    }
    // "Remote (Ireland)" -> workplace remote, place Ireland
    // "Poland (Remote)" -> workplace remote, place Poland
    const paren = segment.match(/^(.*?)\s*\((.+)\)\s*$/);
    if (paren) {
      const prefixType = canonicalWorkplaceToken(paren[1]);
      if (prefixType) {
        found.push(prefixType);
        keptSegments.push(paren[2]);
        continue;
      }
      const innerType = canonicalWorkplaceToken(paren[2]);
      if (innerType) {
        found.push(innerType);
        if (paren[1].trim()) keptSegments.push(paren[1]);
        continue;
      }
    }
    const keptComponents: string[] = [];
    for (const component of segment.split(",")) {
      const trimmed = component.trim();
      if (!trimmed) continue;
      const componentType = canonicalWorkplaceToken(trimmed);
      if (componentType) found.push(componentType);
      else keptComponents.push(trimmed);
    }
    if (keptComponents.length) keptSegments.push(keptComponents.join(", "));
  }

  return {
    location: normalizeLocation(keptSegments.join(", ")),
    workplaceType: normalizeWorkplaceType(found),
  };
}
