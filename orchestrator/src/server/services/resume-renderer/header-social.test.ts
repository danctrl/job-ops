import { describe, expect, it } from "vitest";
import {
  composeHeaderSocialLinks,
  MAX_HEADER_SOCIAL_LINKS,
} from "./header-social";

describe("composeHeaderSocialLinks", () => {
  it("maps known networks to their icon + built URL", () => {
    const tex = composeHeaderSocialLinks([
      { network: "GitHub", username: "danctrl", url: null },
    ]);
    expect(tex).toBe(
      "\\href{https://github.com/danctrl}{\\faGithub\\space danctrl}",
    );
  });

  it("prefers an explicit URL and falls back to a link icon for unknown networks", () => {
    const tex = composeHeaderSocialLinks([
      {
        network: "Ko-fi",
        username: "danctrl",
        url: "https://ko-fi.com/danctrl",
      },
    ]);
    expect(tex).toContain(
      "\\href{https://ko-fi.com/danctrl}{\\faLink\\space danctrl}",
    );
  });

  it(`caps the header at ${MAX_HEADER_SOCIAL_LINKS} links`, () => {
    const profiles = Array.from({ length: 8 }, (_, i) => ({
      network: "GitHub",
      username: `user${i}`,
      url: null,
    }));
    const count = composeHeaderSocialLinks(profiles).split("\\href").length - 1;
    expect(count).toBe(MAX_HEADER_SOCIAL_LINKS);
  });

  it("returns an empty string when there are no profiles", () => {
    expect(composeHeaderSocialLinks([])).toBe("");
    expect(composeHeaderSocialLinks(null)).toBe("");
  });
});
