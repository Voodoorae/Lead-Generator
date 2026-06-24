import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface PlaceResult {
  name: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  place_id?: string;
  website?: string;
  formatted_phone_number?: string;
  types?: string[];
}

interface PlaceDetails {
  website?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
}

// ── Proxaim Triptique scoring ────────────────────────────────────────────────
// Each pillar is scored 0–100, where 100 = maximally exposed (worst).
//   Found     — AI / search visibility (schema, OpenGraph, analytics, CRM)
//   Secure    — CVE / platform / hardening risk
//   Compliant — GDPR exposure (tracking without consent, no policy)
// The classifier (Hot/Warm/Cold) is intentionally NOT computed here: it is a
// RELATIVE band that needs the whole batch, so the client assigns it in one
// pass once every lead is scored. This function only emits raw exposure.

type Severity = "ok" | "moderate" | "critical";

interface PillarScores {
  found: number;
  secure: number;
  compliant: number;
}

function severityOf(score: number): Severity {
  if (score >= 67) return "critical";
  if (score >= 34) return "moderate";
  return "ok";
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export interface TechResult {
  signals: string[];
  pillars: PillarScores;
  severity: { found: Severity; secure: Severity; compliant: Severity };
  exposure: number; // 0–100 composite: 0.5*max + 0.5*mean of the three pillars
  cms: string;
  cveRisk: boolean;
  emailHook: string;
  readable: boolean; // false when the page couldn't be fetched/read
}

// `hints.policyPresent` lets the route override homepage policy-link detection
// with the result of an actual /privacy subpage probe (see scoreLead route),
// so the Compliant pillar never falsely claims "no privacy policy".
export function detectTechSignals(
  html: string,
  hints: { policyPresent?: boolean } = {},
): TechResult {
  const h = html.toLowerCase();
  const signals: string[] = [];
  let cms = "Unknown";
  let cveRisk = false;

  // ── CMS detection ──────────────────────────────────────────────────────────
  const isWordPress = /wp-content|wp-includes|wordpress/i.test(h);
  const isWeebly = /weebly/i.test(h);
  const isWix = /wix\.com/i.test(h);
  const isSquarespace = /squarespace/i.test(h);
  const isShopify = /shopify/i.test(h);
  const isManaged = isSquarespace || isShopify || isWix; // platform-hardened hosting

  if (isWordPress) { cms = "WordPress"; signals.push("WordPress"); }
  else if (isWeebly) { cms = "Weebly"; signals.push("Weebly"); }
  else if (isWix) { cms = "Wix"; signals.push("Wix"); }
  else if (isSquarespace) { cms = "Squarespace"; signals.push("Squarespace"); }
  else if (isShopify) { cms = "Shopify"; signals.push("Shopify"); }

  // ── Raw signals ────────────────────────────────────────────────────────────
  const hasElementor = /elementor/i.test(h);
  const hasJQueryMigrate = /jquery-migrate/i.test(h);
  const hasSliderRev = /slider.revolution|revslider/i.test(h);
  const hasWpBakery = /wpbakery|js_composer/i.test(h);
  const hasSecPlugin = /wordfence|ithemes|sucuri-waf|all-in-one-wp-security/i.test(h);
  const hasCloudflare = /cloudflare/i.test(h);
  const hasSchema = /application\/ld\+json|schema\.org/i.test(h);
  const hasOpenGraph = /property=["']og:/i.test(h);
  const hasAnalytics = /googletagmanager|gtag\(|google-analytics|facebook\.net\/.*fbevents|_ga/i.test(h);
  const hasCRM = /hubspot|intercom|drift|salesforce/i.test(h);
  // Consent Management Platform — detect the vendor SCRIPT (the rendered banner
  // is JS-injected and absent from proxied HTML; the loader <script> is present).
  const hasCMP = /cookiebot|iubenda|onetrust|cookieyes|usercentrics|complianz|axeptio|termly|cookie-law-info|borlabs|didomi|quantcast|osano/i.test(h);
  const hasPolicyLink = hints.policyPresent ??
    /privacy[-_ ]?policy|cookie[-_ ]?policy|\/privacy|informativa|cookie-law/i.test(h);
  // Italian legal-disclosure signal (VAT id is mandatory on IT business sites).
  const hasVatId = /partita\s?iva|p\.?\s?iva|vat\s?(no|number|id)/i.test(h);

  const blank = h.trim().length === 0; // fetch failed / behind WAF → can't judge
  const readable = !blank;

  // ── Secure pillar ──────────────────────────────────────────────────────────
  let secure = 0;
  if (isWordPress && !hasSecPlugin) { secure += 30; signals.push("No security plugin"); }
  if (isWordPress && hasSecPlugin) { signals.push("Security plugin present"); }
  if (isWeebly) { secure += 25; signals.push("Weebly — platform abandoned"); }
  if (hasElementor) { secure += 15; signals.push("Elementor (46+ CVEs)"); cveRisk = true; }
  if (hasSliderRev) { secure += 15; signals.push("Slider Revolution — exploit history"); cveRisk = true; }
  if (hasWpBakery) { secure += 12; signals.push("WPBakery — CVE history"); cveRisk = true; }
  if (hasJQueryMigrate) { secure += 10; signals.push("jQuery Migrate — legacy codebase"); }
  if (!hasCloudflare && (isWordPress || isWeebly)) { secure += 15; signals.push("No CDN/WAF"); }
  if (hasCloudflare) { secure -= 20; signals.push("Cloudflare present"); }
  if (isManaged) { secure -= 40; } // hosted platforms patch the stack for you
  secure = clamp100(secure);

  // ── Found pillar (AI / search visibility) ──────────────────────────────────
  let found = 0;
  if (!hasSchema) { found += 45; signals.push("No schema markup — AI invisible"); }
  if (!hasOpenGraph) { found += 20; signals.push("No OpenGraph — poor link/AI preview"); }
  if (!hasAnalytics) { found += 20; signals.push("No analytics — flying blind"); }
  if (!hasCRM) { found += 15; signals.push("No CRM detected"); }
  found = clamp100(found);

  // ── Compliant pillar (GDPR exposure) ───────────────────────────────────────
  let compliant = 0;
  if (hasAnalytics && !hasCMP) { compliant += 50; signals.push("Tracking with no consent banner — GDPR exposure"); }
  if (!hasPolicyLink) { compliant += 30; signals.push("No privacy/cookie policy link"); }
  if (!hasCMP) { compliant += 20; signals.push("No consent management detected"); }
  if (!hasVatId) { compliant += 10; signals.push("No VAT/P.IVA disclosure"); }
  compliant = clamp100(compliant);

  // If we couldn't fetch the page, absence-based signals are meaningless noise.
  // Zero everything out so a blank fetch never floats to the top of the batch.
  const pillars: PillarScores = blank
    ? { found: 0, secure: 0, compliant: 0 }
    : { found, secure, compliant };
  if (blank) signals.length = 0;

  const vals = [pillars.found, pillars.secure, pillars.compliant];
  const max = Math.max(...vals);
  const mean = (vals[0] + vals[1] + vals[2]) / 3;
  const exposure = Math.round(0.5 * max + 0.5 * mean);

  const severity = {
    found: severityOf(pillars.found),
    secure: severityOf(pillars.secure),
    compliant: severityOf(pillars.compliant),
  };

  // ── Email hook — pick the most cutting verified signal ──────────────────────
  // Never generate a hook from a page we couldn't read: every claim must be
  // verifiable, or the outreach email asserts something false.
  let emailHook = "";
  if (blank) {
    return { signals, pillars, severity, exposure, cms, cveRisk, emailHook, readable };
  }
  if (hasElementor) {
    emailHook = `I can see the site is built on Elementor — it currently has over 46 publicly disclosed CVEs. Is anyone keeping an eye on that?`;
  } else if (hasSliderRev) {
    emailHook = `The site is running Slider Revolution, which has a history of critical exploits. No security layer is visible either — worth a quick look?`;
  } else if (hasWpBakery) {
    emailHook = `The site uses WPBakery Page Builder, which has a CVE history worth being aware of. No security plugin visible either.`;
  } else if (isWeebly) {
    emailHook = `The site is built on Weebly — Square shut down the mobile app in December 2025 and the platform is effectively abandoned. Happy to show what that means for you?`;
  } else if (isWordPress && !hasSecPlugin) {
    emailHook = `The site is on WordPress with no security plugin visible — that's one of the most common vectors for SME site compromises. Worth 5 minutes to check?`;
  } else if (hasAnalytics && !hasCMP) {
    emailHook = `I noticed the site loads analytics/tracking before any cookie consent is shown — under GDPR that's a common exposure for Italian firms. Happy to flag what to fix?`;
  } else if (!hasPolicyLink) {
    emailHook = `I couldn't find a privacy or cookie policy linked on the site — that's usually the first thing a GDPR check flags. Worth a quick look?`;
  } else if (hasJQueryMigrate) {
    emailHook = `jQuery Migrate is active on the site — it's a reliable signal the codebase hasn't been updated in 3+ years. Happy to share what else that usually means?`;
  } else if (!hasSchema) {
    emailHook = `I searched for your business type on ChatGPT this morning — the site doesn't appear. The missing piece is usually schema markup. Worth a quick look?`;
  }

  return { signals, pillars, severity, exposure, cms, cveRisk, emailHook, readable };
}

// ── Helpers: page + policy fetching ──────────────────────────────────────────
const PROXY = "https://api.allorigins.win/get?url=";

async function fetchPage(target: string, timeoutMs = 10000): Promise<string> {
  const resp = await fetch(PROXY + encodeURIComponent(target), {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await resp.json()) as { contents?: string };
  return data.contents ?? "";
}

// Confirm a privacy/cookie policy actually exists before the Compliant pillar
// claims it's missing. Policies live on subpages, not the homepage, so probe the
// common paths (EN + IT) and only trust a page that reads like a real policy.
async function policyExists(website: string, homepageHtml: string): Promise<boolean> {
  if (/privacy[-_ ]?policy|cookie[-_ ]?policy|\/privacy|informativa|cookie-law/i.test(homepageHtml)) {
    return true; // already linked from the homepage
  }
  let base: URL;
  try { base = new URL(website); } catch { return false; }
  const paths = [
    "/privacy-policy", "/privacy", "/cookie-policy", "/privacy-policy/",
    "/cookie-policy/", "/informativa-privacy", "/privacy.html", "/cookie",
  ];
  for (const p of paths) {
    try {
      const html = await fetchPage(new URL(p, base).toString(), 6000);
      if (/privacy|informativa|cookie|gdpr|dati personali|data protection/i.test(html) &&
          html.trim().length > 300) {
        return true;
      }
    } catch { /* try next path */ }
  }
  return false;
}

// ── Route: search leads ──────────────────────────────────────────────────────
router.post("/leads", async (req, res) => {
  const { niche, location } = req.body as { niche?: string; location?: string };

  if (!niche || !location) {
    res.status(400).json({ error: "Missing niche or location" });
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GOOGLE_PLACES_API_KEY not configured on server" });
    return;
  }

  try {
    const query = encodeURIComponent(`${niche} in ${location}`);
    const baseUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;

    // Google returns 20 results per page + a next_page_token; the token needs a
    // short delay before it activates. Follow up to 3 pages (≈60 results).
    const all: PlaceResult[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < 3; page++) {
      const url = pageToken ? `${baseUrl}&pagetoken=${pageToken}` : baseUrl;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        if (page === 0) { res.status(502).json({ error: `Places API HTTP error: ${resp.status}` }); return; }
        break; // already have page 1 — return what we've got
      }

      const data = (await resp.json()) as {
        status: string;
        results: PlaceResult[];
        next_page_token?: string;
        error_message?: string;
      };

      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        if (page === 0) {
          res.status(502).json({
            error: `Places API status: ${data.status}${data.error_message ? " — " + data.error_message : ""}`,
          });
          return;
        }
        break;
      }

      all.push(...(data.results ?? []));
      if (!data.next_page_token) break;
      pageToken = data.next_page_token;
      await new Promise((r) => setTimeout(r, 2000)); // let the token activate
    }

    const leads = all.slice(0, 60).map((place) => ({
      name: place.name,
      address: place.formatted_address ?? "",
      rating: place.rating ?? null,
      reviewCount: place.user_ratings_total ?? 0,
      placeId: place.place_id ?? "",
      url: place.place_id
        ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
        : `https://www.google.com/search?q=${encodeURIComponent(place.name + " " + location)}`,
      types: (place.types ?? []).slice(0, 3),
    }));

    res.json({ leads, total: leads.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("leads fetch failed:", msg);
    res.status(502).json({ error: msg });
  }
});

// ── Route: score a single lead ───────────────────────────────────────────────
router.post("/score-lead", async (req, res) => {
  const { placeId, name, location } = req.body as {
    placeId?: string;
    name?: string;
    location?: string;
  };

  if (!placeId) {
    res.status(400).json({ error: "Missing placeId" });
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GOOGLE_PLACES_API_KEY not configured" });
    return;
  }

  try {
    // Step 1: Get website from Places Details API
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=website,formatted_phone_number&key=${apiKey}`;
    const detailsResp = await fetch(detailsUrl, { signal: AbortSignal.timeout(8000) });
    const detailsData = (await detailsResp.json()) as {
      status: string;
      result?: PlaceDetails;
    };

    const website = detailsData.result?.website ?? "";
    const domain = website
      ? website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")
      : "";

    if (!website) {
      res.json({
        placeId,
        name,
        website: "",
        domain: "",
        status: "no-website",
        pillars: { found: 0, secure: 0, compliant: 0 },
        severity: { found: "ok", secure: "ok", compliant: "ok" },
        exposure: 0,
        cms: "Unknown",
        cveRisk: false,
        signals: ["No website found in Google Places"],
        emailHook: "",
        fetchNote: "No website listed on Google Maps",
      });
      return;
    }

    // Step 2: Fetch homepage (up to ~80KB so footer scripts/links are seen).
    let pageHtml = "";
    let fetchNote = "";
    try {
      const contents = await fetchPage(website);
      if (contents) {
        pageHtml = contents.substring(0, 80000);
        fetchNote = "Page source fetched";
      } else {
        fetchNote = "Could not read page — likely behind WAF/Cloudflare";
      }
    } catch {
      fetchNote = "Fetch failed — site may be behind Cloudflare";
    }

    // Step 3: Confirm a privacy/cookie policy exists (subpage probe) so the
    // Compliant pillar never falsely flags one as missing. Only probe when we
    // actually read the homepage.
    const policyPresent = pageHtml ? await policyExists(website, pageHtml) : undefined;

    // Step 4: Score from tech signals.
    const tech = detectTechSignals(pageHtml, { policyPresent });
    const status = tech.readable ? "scored" : "unreadable";

    res.json({
      placeId,
      name,
      website,
      domain,
      status,
      pillars: tech.pillars,
      severity: tech.severity,
      exposure: tech.exposure,
      cms: tech.cms,
      cveRisk: tech.cveRisk,
      signals: tech.readable ? tech.signals : ["Site unreadable — behind WAF/Cloudflare or blocked"],
      emailHook: tech.emailHook,
      fetchNote,
      wappalyzerUrl: `https://www.wappalyzer.com/lookup/${domain}`,
      sucuriUrl: `https://sitecheck.sucuri.net/results/${domain}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("score-lead failed:", msg);
    res.status(502).json({ error: msg });
  }
});

export default router;
