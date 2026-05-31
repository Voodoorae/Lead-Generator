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

// ── Tech signal detection from page source ──────────────────────────────────
function detectTechSignals(html: string): {
  signals: string[];
  score: number;
  verdict: "Hot" | "Warm" | "Cold";
  cms: string;
  cveRisk: boolean;
  emailHook: string;
} {
  const h = html.toLowerCase();
  const signals: string[] = [];
  let score = 0;
  let cms = "Unknown";
  let cveRisk = false;

  // CMS detection
  const isWordPress = /wp-content|wp-includes|wordpress/i.test(h);
  const isWeebly = /weebly/i.test(h);
  const isWix = /wix\.com/i.test(h);
  const isSquarespace = /squarespace/i.test(h);
  const isShopify = /shopify/i.test(h);

  if (isWordPress) { cms = "WordPress"; signals.push("WordPress"); }
  else if (isWeebly) { cms = "Weebly"; signals.push("Weebly"); }
  else if (isWix) { cms = "Wix"; signals.push("Wix"); }
  else if (isSquarespace) { cms = "Squarespace"; signals.push("Squarespace"); }
  else if (isShopify) { cms = "Shopify"; signals.push("Shopify"); }

  // High-value signals
  const hasElementor = /elementor/i.test(h);
  const hasJQueryMigrate = /jquery-migrate/i.test(h);
  const hasSliderRev = /slider.revolution|revslider/i.test(h);
  const hasWpBakery = /wpbakery|js_composer/i.test(h);
  const hasSecPlugin = /wordfence|ithemes|sucuri-waf|all-in-one-wp-security/i.test(h);
  const hasCloudflare = /cloudflare/i.test(h);
  const hasSchema = /application\/ld\+json|schema\.org/i.test(h);
  const hasAnalytics = /googletagmanager|gtag\(|google-analytics|_ga/i.test(h);
  const hasCRM = /hubspot|intercom|drift|salesforce/i.test(h);

  // Scoring
  if (isWordPress && !hasSecPlugin) { score += 4; signals.push("No security plugin"); }
  if (isWordPress && hasSecPlugin) { signals.push("Security plugin present"); }
  if (isWeebly) { score += 3; signals.push("Weebly — platform abandoned"); }
  if (hasElementor) { score += 2; signals.push("Elementor (46+ CVEs)"); cveRisk = true; }
  if (hasJQueryMigrate) { score += 2; signals.push("jQuery Migrate — legacy codebase"); }
  if (hasSliderRev) { score += 2; signals.push("Slider Revolution — exploit history"); cveRisk = true; }
  if (hasWpBakery) { score += 2; signals.push("WPBakery — CVE history"); cveRisk = true; }
  if (!hasCloudflare && (isWordPress || isWeebly)) { score += 2; signals.push("No CDN/WAF"); }
  if (hasCloudflare) { score -= 2; signals.push("Cloudflare present"); }
  if (!hasSchema) { score += 1; signals.push("No schema markup — AI invisible"); }
  if (!hasAnalytics) { score += 1; signals.push("No analytics detected"); }
  if (!hasCRM) { score += 1; signals.push("No CRM detected"); }
  if (isSquarespace || isShopify) { score -= 3; }

  score = Math.max(0, Math.min(10, score));

  const verdict: "Hot" | "Warm" | "Cold" =
    score >= 7 ? "Hot" : score >= 4 ? "Warm" : "Cold";

  // Generate a specific email hook based on what was found
  let emailHook = "";
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
  } else if (hasJQueryMigrate) {
    emailHook = `jQuery Migrate is active on the site — it's a reliable signal the codebase hasn't been updated in 3+ years. Happy to share what else that usually means?`;
  } else if (!hasSchema) {
    emailHook = `I searched for your business type on ChatGPT this morning — the site doesn't appear. The missing piece is usually schema markup. Worth a quick look?`;
  }

  return { signals, score, verdict, cms, cveRisk, emailHook };
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
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      res.status(502).json({ error: `Places API HTTP error: ${resp.status}` });
      return;
    }

    const data = (await resp.json()) as {
      status: string;
      results: PlaceResult[];
      error_message?: string;
    };

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      res.status(502).json({
        error: `Places API status: ${data.status}${data.error_message ? " — " + data.error_message : ""}`,
      });
      return;
    }

    const leads = (data.results ?? []).slice(0, 20).map((place) => ({
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
        score: 0,
        verdict: "Cold",
        cms: "Unknown",
        cveRisk: false,
        signals: ["No website found in Google Places"],
        emailHook: "",
        fetchNote: "No website listed on Google Maps",
      });
      return;
    }

    // Step 2: Fetch page source to detect tech stack
    let pageHtml = "";
    let fetchNote = "";

    try {
      const pageResp = await fetch(
        `https://api.allorigins.win/get?url=${encodeURIComponent(website)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      const pageData = (await pageResp.json()) as { contents?: string };
      if (pageData.contents) {
        pageHtml = pageData.contents.substring(0, 12000);
        fetchNote = "Page source fetched";
      } else {
        fetchNote = "Could not fetch page — behind WAF or Cloudflare";
      }
    } catch {
      fetchNote = "Fetch failed — site may be behind Cloudflare";
    }

    // Step 3: Score from tech signals
    const tech = detectTechSignals(pageHtml);

    res.json({
      placeId,
      name,
      website,
      domain,
      score: tech.score,
      verdict: tech.verdict,
      cms: tech.cms,
      cveRisk: tech.cveRisk,
      signals: tech.signals,
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
