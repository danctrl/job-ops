// Generic social-profile → header link mapping for the danctrl (Awesome-CV)
// theme. Any profile whose network name matches one of the entries below renders
// in the header's social row as an icon + handle. Unknown networks still render
// (with a generic link icon) as long as they carry a URL, so nothing a user adds
// silently disappears.
//
// Only the most popular networks are wired; everything else falls back to a
// generic link icon. Icon names are FontAwesome 5 macros verified to exist in
// the bundled font set. To add a network: add an entry with its `matcher`, FA5
// `icon`, and a `url` builder (or omit `url` to require the profile's own URL).

export interface SocialProfileInput {
  network?: string | null;
  username?: string | null;
  url?: string | null;
}

export interface SocialNetworkDef {
  /** Canonical key, also shown in the reference list. */
  key: string;
  /** FA5 icon macro, e.g. "\\faGithub". */
  icon: string;
  /** Matches the profile's `network` label (case-insensitive). */
  matcher: RegExp;
  /** Build a URL from a bare handle. Omit when only a full URL makes sense. */
  url?: (handle: string) => string;
}

/** Max social links shown in the header (keeps it to one tidy row). */
export const MAX_HEADER_SOCIAL_LINKS = 4;

/** The wired (popular) networks. Order is only cosmetic for the reference list. */
export const SOCIAL_NETWORKS: SocialNetworkDef[] = [
  {
    key: "GitHub",
    icon: "\\faGithub",
    matcher: /github/i,
    url: (h) => `https://github.com/${h}`,
  },
  {
    key: "GitLab",
    icon: "\\faGitlab",
    matcher: /gitlab/i,
    url: (h) => `https://gitlab.com/${h}`,
  },
  {
    key: "LinkedIn",
    icon: "\\faLinkedin",
    matcher: /linkedin/i,
    url: (h) => `https://www.linkedin.com/in/${h}`,
  },
  {
    key: "Twitter / X",
    icon: "\\faTwitter",
    matcher: /twitter|^x$/i,
    url: (h) => `https://twitter.com/${h}`,
  },
  {
    key: "Instagram",
    icon: "\\faInstagram",
    matcher: /instagram/i,
    url: (h) => `https://instagram.com/${h}`,
  },
  {
    key: "Facebook",
    icon: "\\faFacebook",
    matcher: /facebook/i,
    url: (h) => `https://facebook.com/${h}`,
  },
  {
    key: "YouTube",
    icon: "\\faYoutube",
    matcher: /youtube/i,
    url: (h) => `https://youtube.com/@${h}`,
  },
  {
    key: "Stack Overflow",
    icon: "\\faStackOverflow",
    matcher: /stack\s*overflow/i,
    url: (h) => `https://stackoverflow.com/users/${h}`,
  },
  {
    key: "Dev.to",
    icon: "\\faDev",
    matcher: /dev\.to|devto/i,
    url: (h) => `https://dev.to/${h}`,
  },
  {
    key: "Medium",
    icon: "\\faMedium",
    matcher: /medium/i,
    url: (h) => `https://medium.com/@${h}`,
  },
  { key: "Mastodon", icon: "\\faMastodon", matcher: /mastodon/i },
  {
    key: "Telegram",
    icon: "\\faTelegram",
    matcher: /telegram/i,
    url: (h) => `https://t.me/${h}`,
  },
];

/** Number of leading first-name characters accented in the header. */
export const NAME_ACCENT_PREFIX = 3;

/**
 * Wrap the first `count` characters of the first name in \textcolor{awesome}
 * (the theme accent) so e.g. "Daniel" renders "Dan" in emerald. `escape` is the
 * caller's LaTeX escaper. Names shorter than `count` are fully accented.
 */
export function emphasizeNamePrefix(
  first: string,
  escapeFn: (value: string) => string,
  count: number = NAME_ACCENT_PREFIX,
): string {
  const head = first.slice(0, count);
  const tail = first.slice(count);
  if (!head) return escapeFn(first);
  return `\\textcolor{awesome}{${escapeFn(head)}}${escapeFn(tail)}`;
}

/** Fallback icon for a profile whose network isn't in the map. */
const FALLBACK_ICON = "\\faLink";

function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, "￿")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/￿/g, "\\textbackslash{}");
}

function stripUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

function findNetwork(network: string): SocialNetworkDef | undefined {
  return SOCIAL_NETWORKS.find((entry) => entry.matcher.test(network));
}

/**
 * Compose the header social row for the danctrl class: an "\faIcon handle" per
 * profile joined by the header separator, capped at MAX_HEADER_SOCIAL_LINKS.
 * Returns "" when there is nothing to show (the caller then omits the whole
 * row). Feeds the class's `\headersociallinks{...}` command.
 */
export function composeHeaderSocialLinks(
  profiles: readonly SocialProfileInput[] | null | undefined,
): string {
  if (!profiles || profiles.length === 0) return "";
  const items: string[] = [];

  for (const profile of profiles) {
    if (items.length >= MAX_HEADER_SOCIAL_LINKS) break;

    const network = profile.network?.trim() ?? "";
    const handle = profile.username?.trim() ?? "";
    const rawUrl = profile.url?.trim() ?? "";
    const def = network ? findNetwork(network) : undefined;

    const url = rawUrl || (def?.url && handle ? def.url(handle) : "");
    // A profile with neither a handle nor a URL nor a network name is noise.
    const label = handle || (url ? stripUrl(url) : "") || network;
    if (!label) continue;

    const icon = def?.icon ?? FALLBACK_ICON;
    const body = `${icon}\\space ${escapeLatex(label)}`;
    items.push(url ? `\\href{${escapeLatex(url)}}{${body}}` : body);
  }

  return items.join("\\acvHeaderSocialSep ");
}
