import { describe, expect, it } from "vitest";
import {
  extractJobLevel,
  htmlToText,
  normalizeEmployer,
  normalizeJobTitle,
  normalizeLocation,
  normalizeSalary,
  normalizeWhitespace,
  stripHtmlTags,
} from "./string";

describe("normalizeJobTitle", () => {
  it("strips a trailing '@ Company/Venture' suffix", () => {
    expect(
      normalizeJobTitle(
        "Founding Engineering Team Lead @ AI Cybersecurity Venture",
      ),
    ).toBe("Founding Engineering Team Lead");
    expect(
      normalizeJobTitle(
        "Founding Product Manager @ AI Identity Cybersecurity Venture",
      ),
    ).toBe("Founding Product Manager");
  });

  it("strips inline German gender markers on the role noun", () => {
    expect(normalizeJobTitle("Ingenieur*in als Begutachter")).toBe(
      "Ingenieur als Begutachter",
    );
    expect(normalizeJobTitle("Leiter/in IT Security")).toBe(
      "Leiter IT Security",
    );
    expect(normalizeJobTitle("Mitarbeiter:innen Support")).toBe(
      "Mitarbeiter Support",
    );
    expect(normalizeJobTitle("MitarbeiterInnen Support")).toBe(
      "Mitarbeiter Support",
    );
  });

  it("does not over-strip legitimate slashes or the word Innen", () => {
    // A '/' that is not a gender marker must survive (no tail truncation here).
    expect(normalizeJobTitle("Data / ML Engineer")).toBe("Data / ML Engineer");
    // "Internship" is the role, not contract noise to strip.
    expect(normalizeJobTitle("Cyber Security Internship")).toBe(
      "Cyber Security Internship",
    );
  });

  it("strips German contract noise after a dash, incl. parenthetical", () => {
    expect(
      normalizeJobTitle(
        "Produkt Owner – in Festanstellung (Voll- oder Teilzeit möglich)",
      ),
    ).toBe("Produkt Owner");
  });

  it("strips every parenthetical qualifier — contract, domain, work-mode", () => {
    expect(normalizeJobTitle("Data Analyst (Vollzeit)")).toBe("Data Analyst");
    expect(normalizeJobTitle("Data Analyst (remote, full-time)")).toBe(
      "Data Analyst",
    );
    // Business domain also belongs in the brief, not the title.
    expect(normalizeJobTitle("Data Analyst (Healthcare)")).toBe("Data Analyst");
  });

  it("strips trailing contract words with or without a separator", () => {
    expect(normalizeJobTitle("Software Engineer | Vollzeit")).toBe(
      "Software Engineer",
    );
    expect(normalizeJobTitle("Software Engineer - Full-time")).toBe(
      "Software Engineer",
    );
  });

  it("lifts the leading seniority level out of the title", () => {
    expect(normalizeJobTitle("(Associate) Product Manager")).toBe(
      "Product Manager",
    );
    expect(normalizeJobTitle("(Junior) AI Project Manager")).toBe(
      "AI Project Manager",
    );
    expect(normalizeJobTitle("Senior Product Owner")).toBe("Product Owner");
    expect(normalizeJobTitle("(Sr.) DevOps Engineer")).toBe("DevOps Engineer");
    // The level word as the whole title stays (nothing else to keep).
    expect(normalizeJobTitle("Associate")).toBe("Associate");
    // Ambiguous leading words are not treated as a level.
    expect(normalizeJobTitle("Lead Generation Specialist")).toBe(
      "Lead Generation Specialist",
    );
  });

  it("strips tool and domain parentheticals (they belong in the brief)", () => {
    expect(normalizeJobTitle("Infrastructure Engineer (Kubernetes)")).toBe(
      "Infrastructure Engineer",
    );
    expect(normalizeJobTitle("Product Manager (AI)")).toBe("Product Manager");
    expect(normalizeJobTitle("AI First Builder (Product Management)")).toBe(
      "AI First Builder",
    );
    expect(normalizeJobTitle("Product Manager (Mobile Apps/AI)")).toBe(
      "Product Manager",
    );
  });

  it("truncates the specialization/domain/team/location tail after a separator", () => {
    expect(
      normalizeJobTitle(
        "Product Owner CRM (HubSpot) – Digital Education mit Impact",
      ),
    ).toBe("Product Owner CRM");
    expect(normalizeJobTitle("Product Manager – MarTech")).toBe(
      "Product Manager",
    );
    expect(
      normalizeJobTitle("Associate Product Manager - Tax Enablement"),
    ).toBe("Product Manager");
    expect(normalizeJobTitle("Product Manager, Delivery Promise")).toBe(
      "Product Manager",
    );
    expect(
      normalizeJobTitle("Junior IT-Projektmanager – SAP & Intralogistik"),
    ).toBe("IT-Projektmanager");
    expect(
      normalizeJobTitle("Junior Product Manager -Bulgaria/Turkey/Pakistan"),
    ).toBe("Product Manager");
    // Internal hyphens and dual-role slashes stay.
    expect(normalizeJobTitle("Go-To-Market Analyst")).toBe(
      "Go-To-Market Analyst",
    );
    expect(
      normalizeJobTitle("Associate Product Owner / Business Analyst"),
    ).toBe("Product Owner / Business Analyst");
  });

  it("strips a trailing bare city from the title", () => {
    expect(
      normalizeJobTitle("Associate Product Owner Traineeprogramm Berlin"),
    ).toBe("Product Owner Traineeprogramm");
  });

  it("strips a trailing market-segment qualifier", () => {
    expect(
      normalizeJobTitle("Business Development Representative Mid-Market"),
    ).toBe("Business Development Representative");
    expect(normalizeJobTitle("Account Executive Enterprise")).toBe(
      "Account Executive",
    );
    // A leading segment word (part of the core role) is kept.
    expect(normalizeJobTitle("Enterprise Account Executive")).toBe(
      "Enterprise Account Executive",
    );
  });

  it("leaves clean level-free titles untouched", () => {
    expect(normalizeJobTitle("Product Owner")).toBe("Product Owner");
    expect(normalizeJobTitle("Data Analyst")).toBe("Data Analyst");
  });
});

describe("extractJobLevel", () => {
  it("reads the leading seniority level, canonicalized", () => {
    expect(extractJobLevel("Junior AI Project Manager")).toBe("Junior");
    expect(extractJobLevel("(Sr.) DevOps Engineer")).toBe("Senior");
    expect(extractJobLevel("(Associate) Product Manager")).toBe("Associate");
    expect(extractJobLevel("Werkstudent Marketing")).toBe("Werkstudent");
  });

  it("returns null when there is no leading level", () => {
    expect(extractJobLevel("Product Owner")).toBeNull();
    expect(extractJobLevel("Lead Generation Specialist")).toBeNull();
    expect(extractJobLevel("Associate")).toBeNull();
  });
});

describe("normalizeEmployer", () => {
  it("strips the startupjobs German 'bei ' prefix, keeping the legal form", () => {
    expect(normalizeEmployer("bei HUM Systems GmbH")).toBe("HUM Systems GmbH");
    expect(normalizeEmployer("bei Lautsprecher Teufel GmbH")).toBe(
      "Lautsprecher Teufel GmbH",
    );
    // Leading "bei [article]" also collapses to the company.
    expect(normalizeEmployer("bei der Init AG")).toBe("Init AG");
  });

  it("strips a German recruiting preamble, keeping only the company", () => {
    expect(normalizeEmployer("Dein Einstieg bei der Init AG")).toBe("Init AG");
    expect(normalizeEmployer("Dein Einstieg bei Init AG")).toBe("Init AG");
    expect(normalizeEmployer("Karriere bei der SAP SE")).toBe("SAP SE");
    expect(normalizeEmployer("Willkommen bei den Stadtwerken München")).toBe(
      "Stadtwerken München",
    );
    // A real name that merely contains "bei" must not be truncated.
    expect(normalizeEmployer("Weber bei der Arbeit GmbH")).toBe(
      "Weber bei der Arbeit GmbH",
    );
  });

  it("strips careers-page wrappers", () => {
    expect(normalizeEmployer("Careers at Marriott")).toBe("Marriott");
    expect(normalizeEmployer("Jobs at Acme")).toBe("Acme");
  });

  it("keeps the brand from a 'legal entity // brand' join", () => {
    expect(normalizeEmployer("DRTJ Organic Cosmetics GmbH // UND GRETEL")).toBe(
      "UND GRETEL",
    );
    expect(
      normalizeEmployer("bei DRTJ Organic Cosmetics GmbH // UND GRETEL"),
    ).toBe("UND GRETEL");
  });

  it("keeps the company from a 'company | tagline' join", () => {
    expect(
      normalizeEmployer("Pack GTM | SaaS Sales Recruitment in Germany"),
    ).toBe("Pack GTM");
  });

  it("leaves clean names untouched", () => {
    expect(normalizeEmployer("N26")).toBe("N26");
    expect(normalizeEmployer("Marriott Hotels & Resorts")).toBe(
      "Marriott Hotels & Resorts",
    );
  });
});

describe("normalizeLocation", () => {
  it("collapses adjacent duplicate city-state components", () => {
    expect(normalizeLocation("Berlin, Berlin, Germany")).toBe(
      "Berlin, Germany",
    );
    expect(normalizeLocation("Hamburg, Hamburg, Germany")).toBe(
      "Hamburg, Germany",
    );
  });

  it("is case-insensitive when comparing components", () => {
    expect(normalizeLocation("berlin, Berlin, Germany")).toBe(
      "berlin, Germany",
    );
  });

  it("normalizes inner whitespace and stray spacing around commas", () => {
    expect(normalizeLocation("Berlin ,  Berlin ,Germany")).toBe(
      "Berlin, Germany",
    );
    expect(normalizeLocation("San   Francisco, CA")).toBe("San Francisco, CA");
  });

  it("keeps a single component and a clean city+country pair", () => {
    expect(normalizeLocation("Remote")).toBe("Remote");
    expect(normalizeLocation("San Francisco, CA")).toBe("San Francisco, CA");
  });

  it("reduces 'or'-joined alternates to the first place plus first country", () => {
    expect(normalizeLocation("Berlin or Munich or Germany")).toBe(
      "Berlin, Germany",
    );
    expect(
      normalizeLocation("Koblenz or Berlin or Cologne or Hannover or Germany"),
    ).toBe("Koblenz, Germany");
    expect(
      normalizeLocation(
        "Berlin or Brandenburg or Germany or Austria or Switzerland",
      ),
    ).toBe("Berlin, Germany");
    expect(normalizeLocation("Berlin or Munich")).toBe("Berlin, Germany");
  });

  it("collapses any region/subdivision between city and country", () => {
    expect(
      normalizeLocation("Düsseldorf, North Rhine-Westphalia, Germany"),
    ).toBe("Düsseldorf, Germany");
    expect(normalizeLocation("Brussels, Brussels Region, Belgium")).toBe(
      "Brussels, Belgium",
    );
    // A leading city district collapses to its known city.
    expect(normalizeLocation("Neukölln, Berlin, Germany")).toBe(
      "Berlin, Germany",
    );
    expect(normalizeLocation("London, Greater London, United Kingdom")).toBe(
      "London, United Kingdom",
    );
    expect(normalizeLocation("Berlin, Mitte, Germany")).toBe("Berlin, Germany");
    // A leading region (not a city) collapses to the country only.
    expect(normalizeLocation("North Rhine-Westphalia, Germany")).toBe(
      "Germany",
    );
  });

  it("appends the country to a bare known city", () => {
    expect(normalizeLocation("Berlin")).toBe("Berlin, Germany");
    expect(normalizeLocation("München")).toBe("München, Germany");
    expect(normalizeLocation("Wien")).toBe("Wien, Austria");
    expect(normalizeLocation("Zürich")).toBe("Zürich, Switzerland");
    // Already has a country, or not a known city -> untouched.
    expect(normalizeLocation("Poland")).toBe("Poland");
    expect(normalizeLocation("Berlin, Germany")).toBe("Berlin, Germany");
    expect(normalizeLocation("Remote")).toBe("Remote");
  });

  it("drops empty components and returns empty string for blank input", () => {
    expect(normalizeLocation(", ,Germany")).toBe("Germany");
    expect(normalizeLocation("   ")).toBe("");
  });
});

describe("normalizeSalary", () => {
  it("unifies range separators and keeps the OTE qualifier", () => {
    expect(normalizeSalary("€80-90k OTE")).toBe("€80–90k OTE");
    expect(normalizeSalary("€80 - 90K OTE")).toBe("€80–90k OTE");
  });

  it("maps currency codes to symbols and hugs the amount", () => {
    expect(normalizeSalary("USD 120k")).toBe("$120k");
    expect(normalizeSalary("45k to 55k GBP")).toBe("£45k–55k");
  });

  it("collapses a repeated-currency range and keeps 'a year'", () => {
    expect(normalizeSalary("€40,000 - €60,000 a year")).toBe("€40k–60k a year");
    expect(normalizeSalary("€40k - €60k")).toBe("€40k–60k");
    expect(normalizeSalary("$50,000 a year")).toBe("$50k a year");
  });

  it("collapses full thousands to k-notation", () => {
    expect(normalizeSalary("EUR 80000 - 90000")).toBe("€80k–90k");
    expect(normalizeSalary("90.000")).toBe("90k");
    expect(normalizeSalary("€ 85.000 - 95.000")).toBe("€85k–95k");
    expect(normalizeSalary("85500")).toBe("85.5k");
    // Odd figures that aren't whole hundreds stay as-is.
    expect(normalizeSalary("82750")).toBe("82750");
  });

  it("returns null for empty, non-figure, or prose/benefits input", () => {
    expect(normalizeSalary(null)).toBeNull();
    expect(normalizeSalary("  ")).toBeNull();
    // No actual figure -> not a salary.
    expect(normalizeSalary("Competitive")).toBeNull();
    // Benefits prose that happens to contain a number -> rejected.
    expect(
      normalizeSalary(
        "Industry-competitive local salaries (plus equity package, €1,000 annual personal development budget, and home office budget)",
      ),
    ).toBeNull();
  });

  it("keeps a clean figure that carries only qualifier words", () => {
    expect(normalizeSalary("80000 - 90000 EUR gross per year")).toBe(
      "€80k–90k gross per year",
    );
    expect(normalizeSalary("up to €65k")).toBe("up to €65k");
  });
});

describe("htmlToText", () => {
  it("strips tags and preserves paragraph breaks", () => {
    const html = "<p>We are hiring.</p><p>Join <strong>us</strong>!</p>";
    expect(htmlToText(html)).toBe("We are hiring.\nJoin us !");
  });

  it("converts <br> to newlines", () => {
    expect(htmlToText("Line one<br>Line two<br/>Line three")).toBe(
      "Line one\nLine two\nLine three",
    );
  });

  it("turns list items into separate lines", () => {
    const html = "<ul><li>Python</li><li>TypeScript</li></ul>";
    expect(htmlToText(html)).toBe("Python\nTypeScript");
  });

  it("decodes common HTML entities", () => {
    expect(htmlToText("R&amp;D team &lt;3 &quot;code&quot;")).toBe(
      'R&D team <3 "code"',
    );
    expect(htmlToText("Ben &amp;amp; Jerry")).toBe("Ben &amp; Jerry");
  });

  it("is a no-op on clean markdown/plain text", () => {
    const markdown = "# Role\n\n- Build features\n- Ship code";
    expect(htmlToText(markdown)).toBe(markdown);
    expect(htmlToText("Berlin, Germany")).toBe("Berlin, Germany");
  });

  it("does not treat markdown autolinks as HTML", () => {
    expect(htmlToText("See <https://example.com> for details")).toBe(
      "See <https://example.com> for details",
    );
  });

  it("collapses excess blank lines to at most one", () => {
    expect(htmlToText("<p>A</p><p></p><p></p><p>B</p>")).toBe("A\n\nB");
  });
});

describe("stripHtmlTags / normalizeWhitespace", () => {
  it("stripHtmlTags flattens to a single normalized line", () => {
    expect(stripHtmlTags("<p>Hello</p>  <span>world</span>")).toBe(
      "Hello world",
    );
  });

  it("normalizeWhitespace collapses runs of whitespace", () => {
    expect(normalizeWhitespace("  a\t\nb   c ")).toBe("a b c");
  });
});
