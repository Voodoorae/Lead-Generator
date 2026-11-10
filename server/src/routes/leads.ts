import { Router, type IRouter } from "express";
import { safeFetch } from "../lib/safe-url.js";
import { pool, ensureSchema } from "../lib/db.js";

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
    /privacy[-_ ]?policy|cookie[-_ ]?policy|\/privacy|informativa|cookie-law|pol[ií]tica[-_ ]?de[-_ ]?privacidad|aviso[-_ ]?legal/i.test(h);
  // Legal-disclosure signal: VAT id is mandatory on IT (P.IVA) and ES (CIF/NIF) business sites.
  const hasVatId = /partita\s?iva|p\.?\s?iva|vat\s?(no|number|id)|\bcif\b|\bnif\b/i.test(h);

  const blank = h.trim().length === 0; // fetch failed / behind WAF → can't judge
  const readable = !blank;

  // ── Secure pillar ──────────────────────────────────────────────────────────
  let secure = 0;
  if (isWordPress && !hasSecPlugin) { secure += 30; signals.push("No security plugin"); }
  if (isWordPress && hasSecPlugin) { signals.push("Security plugin present"); }
  if (isWeebly) { secure += 25; signals.push("Weebly — platform in maintenance mode"); }
  if (hasElementor) { secure += 15; signals.push("Elementor — documented CVE history"); cveRisk = true; }
  if (hasSliderRev) { secure += 15; signals.push("Slider Revolution — documented exploit history"); cveRisk = true; }
  if (hasWpBakery) { secure += 12; signals.push("WPBakery — documented CVE history"); cveRisk = true; }
  if (hasJQueryMigrate) { secure += 10; signals.push("jQuery Migrate — legacy codebase signal"); }
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
  if (!hasVatId) { compliant += 10; signals.push("No VAT/P.IVA/CIF disclosure"); }
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
  // Hooks avoid hardcoded CVE counts and dates (they become stale). Instead they
  // reference documented history or known exposure types, and link to verification.
  let emailHook = "";
  if (blank) {
    return { signals, pillars, severity, exposure, cms, cveRisk, emailHook, readable };
  }
  if (hasElementor) {
    emailHook = `I can see the site is built on Elementor — it has a documented CVE history. Worth checking what version and patching status you're on?`;
  } else if (hasSliderRev) {
    emailHook = `The site is running Slider Revolution, which has a history of critical exploits. No security layer is visible either — worth a quick look?`;
  } else if (hasWpBakery) {
    emailHook = `The site uses WPBakery Page Builder, which has a known CVE history. No security plugin visible either — worth auditing?`;
  } else if (isWeebly) {
    emailHook = `The site is built on Weebly — the platform has entered maintenance-only mode and is no longer actively developed. Worth confirming what that means for your roadmap?`;
  } else if (isWordPress && !hasSecPlugin) {
    emailHook = `The site is on WordPress with no security plugin visible — that's one of the most common vectors for SME site compromises. Worth 5 minutes to check?`;
  } else if (hasAnalytics && !hasCMP) {
    emailHook = `I noticed the site loads analytics/tracking before any cookie consent is shown — under GDPR that's a common exposure for Italian firms. Happy to flag what to fix?`;
  } else if (!hasPolicyLink) {
    emailHook = `I couldn't find a privacy or cookie policy linked on the site — that's usually the first thing a GDPR check flags. Worth a quick look?`;
  } else if (hasJQueryMigrate) {
    emailHook = `jQuery Migrate is active on the site — it's a reliable signal the codebase hasn't been updated in years. Happy to share what else that usually means?`;
  } else if (!hasSchema) {
    emailHook = `I searched for your business type on ChatGPT this morning — the site doesn't appear. The missing piece is usually schema markup. Worth a quick look?`;
  }

  return { signals, pillars, severity, exposure, cms, cveRisk, emailHook, readable };
}

// ── Helpers: page + policy fetching ──────────────────────────────────────────
// Direct server-side fetch, SSRF-guarded (same guard as stack-scanner/found-score/
// proxaim-web). allorigins was a CORS-bypass proxy; this route runs in Node, not
// a browser, so CORS never applied here, it was an unneeded third-party hop that
// went down (520/522) and took every scan with it. Kept as a fallback only, for
// the rare site that blocks a direct server fetch but not a rotating-IP proxy.
const PROXY = "https://api.allorigins.win/get?url=";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchPage(target: string, timeoutMs = 10000): Promise<string> {
  try {
    const res = await safeFetch(target, { headers: { "User-Agent": UA }, timeoutMs });
    if (res.ok) return await res.text();
  } catch {
    // fall through to the proxy
  }
  try {
    const resp = await fetch(PROXY + encodeURIComponent(target), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await resp.json()) as { contents?: string };
    return data.contents ?? "";
  } catch {
    return "";
  }
}

// Pull a contact email out of page HTML: mailto: links first (highest
// confidence — it's a click target, not incidental text), then a regex sweep
// of visible text for common inbox prefixes. Skips image/tracking-pixel
// addresses and anything on a third-party domain (e.g. a Gravatar or widget
// script leaking its own vendor address).
const GENERIC_PREFIXES = /^(info|contact|office|hello|enquiries|enquiry|admin|mail)@/i;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function extractEmailFromHtml(html: string, domain: string): string | null {
  if (!html || !domain) return null;

  const mailtoMatch = html.match(/mailto:([^"'?\s>]+)/i);
  if (mailtoMatch) {
    const addr = mailtoMatch[1].trim();
    if (EMAIL_RE.test(addr)) return addr.toLowerCase();
  }

  const found = html.match(EMAIL_RE) ?? [];
  const candidates = found
    .map((e) => e.toLowerCase())
    .filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/i.test(e)) // image filenames matched as "x@2x.png" style
    .filter((e) => e.endsWith(`@${domain}`) || e.includes(domain));

  if (candidates.length === 0) return null;
  // Prefer a generic company inbox (info@, contact@, …) over a personal-looking one.
  return candidates.find((e) => GENERIC_PREFIXES.test(e)) ?? candidates[0];
}

// If the homepage has no usable email, probe common contact-page paths on the
// same domain — the same pattern policyExists() uses for privacy pages.
async function findContactEmail(website: string, homepageHtml: string, domain: string): Promise<string | null> {
  const fromHome = extractEmailFromHtml(homepageHtml, domain);
  if (fromHome) return fromHome;

  let base: URL;
  try { base = new URL(website); } catch { return null; }
  const paths = ["/contact", "/contact-us", "/contacts", "/contatti", "/contacto"];
  for (const p of paths) {
    try {
      const html = await fetchPage(new URL(p, base).toString(), 6000);
      const email = extractEmailFromHtml(html, domain);
      if (email) return email;
    } catch { /* try next path */ }
  }
  return null;
}

// Confirm a privacy/cookie policy actually exists before the Compliant pillar
// claims it's missing. Policies live on subpages, not the homepage, so probe the
// common paths (EN + IT) and only trust a page that reads like a real policy.
async function policyExists(website: string, homepageHtml: string): Promise<boolean> {
  if (/privacy[-_ ]?policy|cookie[-_ ]?policy|\/privacy|informativa|cookie-law|pol[ií]tica[-_ ]?de[-_ ]?privacidad|aviso[-_ ]?legal/i.test(homepageHtml)) {
    return true; // already linked from the homepage
  }
  let base: URL;
  try { base = new URL(website); } catch { return false; }
  const paths = [
    "/privacy-policy", "/privacy", "/cookie-policy", "/privacy-policy/",
    "/cookie-policy/", "/informativa-privacy", "/privacy.html", "/cookie",
    "/politica-de-privacidad", "/aviso-legal", "/politica-de-cookies", "/proteccion-de-datos",
  ];
  for (const p of paths) {
    try {
      const html = await fetchPage(new URL(p, base).toString(), 6000);
      if (/privacy|informativa|cookie|gdpr|dati personali|data protection|privacidad|protecci[oó]n de datos|aviso legal/i.test(html) &&
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
  const { placeId, name, location, contactOnly } = req.body as {
    placeId?: string;
    name?: string;
    location?: string;
    contactOnly?: boolean;
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
        email: null,
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

    // Discovery needs only the verified Places identity; outreach checks the site separately.
    if(contactOnly===true) {
      res.json({placeId,name,website,domain,status:'discovered',email:null});
      return;
    }

    // Step 2: Fetch homepage. Tech-signal scoring only needs the first ~80KB
    // (head/nav markup), but a mailto: link is often deep in the footer of a
    // large page — cap that at a much higher ceiling so it isn't invisible to
    // email extraction on bigger sites.
    let pageHtml = "";
    let fullHtml = "";
    let fetchNote = "";
    try {
      const contents = await fetchPage(website);
      if (contents) {
        pageHtml = contents.substring(0, 80000);
        fullHtml = contents.substring(0, 500000);
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

    // Step 3b: Extract a contact email from the same fetch (using the fuller
    // capture, not the scoring-only 80KB slice), falling back to a same-domain
    // contact page. Best-effort — null just means "not found", it never
    // blocks or delays the score itself.
    const contactEmail = fullHtml ? await findContactEmail(website, fullHtml, domain) : null;

    // Step 4: Score from tech signals.
    const tech = detectTechSignals(pageHtml, { policyPresent });
    const status = tech.readable ? "scored" : "unreadable";

    res.json({
      placeId,
      name,
      website,
      domain,
      status,
      email: contactEmail,
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

// CSV export — workaround for sandbox restrictions on blob downloads
router.post("/export-csv", (req, res) => {
  try {
    const { filename } = req.body;
    let data;
    try {
      data = JSON.parse(req.body.data);
    } catch {
      res.status(400).json({ error: "Invalid data — must be JSON-encoded array" });
      return;
    }
    if (!Array.isArray(data) || data.length === 0) {
      res.status(400).json({ error: "Missing or empty data array" });
      return;
    }
    if (!filename) {
      res.status(400).json({ error: "Missing filename" });
      return;
    }

    const keys = Object.keys(data[0]);
    const header = keys.map(k => `"${String(k).replace(/"/g, '""')}"`).join(",");
    const rows = data.map(row =>
      keys.map(k => {
        const v = row[k];
        if (v === null || v === undefined) return "";
        if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
        return String(v);
      }).join(",")
    );
    const csv = [header, ...rows].join("\n");

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("export-csv failed:", msg);
    res.status(500).json({ error: msg });
  }
});

// ── Route: save a scored batch to Postgres ───────────────────────────────────
// Called once after scoreAll() finishes client-side, not per-lead — one round
// trip per search instead of sixty. Upserts on (domain, niche, location) so
// re-scanning the same area updates rather than duplicates.
interface SavedLead {
  name: string;
  domain: string;
  verdict: string;
  exposure: number;
  pillars: { found: number; secure: number; compliant: number };
  cms: string;
  cveRisk: boolean;
  signals: string[];
  emailHook: string;
  email: string | null;
  address: string;
  rating: number | null;
  reviewCount: number;
}

router.post("/leads/save", async (req, res) => {
  if (!pool) {
    res.json({ saved: 0, note: "DATABASE_URL not configured — not persisted" });
    return;
  }

  const { niche, location, leads } = req.body as {
    niche?: string;
    location?: string;
    leads?: SavedLead[];
  };

  if (!niche || !location || !Array.isArray(leads)) {
    res.status(400).json({ error: "Missing niche, location, or leads array" });
    return;
  }

  // Only leads with a real domain (excludes "no-website" rows) satisfy the
  // dedup key and are worth persisting.
  const rows = leads.filter((l) => l.domain && l.domain.trim());

  try {
    await ensureSchema();
    for (const l of rows) {
      await pool.query(
        `INSERT INTO leads
           (name, domain, verdict, exposure, pillars, cms, cve_risk, signals,
            email_hook, email, address, rating, reviews, niche, location, scanned_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
         ON CONFLICT (domain, niche, location) DO UPDATE SET
           name = EXCLUDED.name, verdict = EXCLUDED.verdict, exposure = EXCLUDED.exposure,
           pillars = EXCLUDED.pillars, cms = EXCLUDED.cms, cve_risk = EXCLUDED.cve_risk,
           signals = EXCLUDED.signals, email_hook = EXCLUDED.email_hook,
           email = EXCLUDED.email,
           address = EXCLUDED.address, rating = EXCLUDED.rating, reviews = EXCLUDED.reviews,
           scanned_at = now()`,
        [
          l.name, l.domain, l.verdict, l.exposure, JSON.stringify(l.pillars),
          l.cms, l.cveRisk, JSON.stringify(l.signals), l.emailHook, l.email ?? null, l.address,
          l.rating, l.reviewCount, niche, location,
        ],
      );
    }
    res.json({ saved: rows.length, skipped: leads.length - rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("leads/save failed:", msg);
    res.status(500).json({ error: msg });
  }
});

// ── Route: export the accumulated master CSV for one location ───────────────
// Distinct from POST /export-csv above (which exports only the current
// in-browser batch): this queries everything ever saved for a location,
// across every session, replacing the manual merge-CSVs workflow.
router.get("/leads/export", async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: "DATABASE_URL not configured — no persisted leads to export" });
    return;
  }

  const location = req.query.location as string | undefined;
  if (!location) {
    res.status(400).json({ error: "Missing location query param" });
    return;
  }

  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT name, domain, verdict, exposure, pillars, cms, cve_risk, signals,
              email_hook, email, address, rating, reviews, niche, scanned_at
       FROM leads WHERE location = $1
       ORDER BY exposure DESC NULLS LAST`,
      [location],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: `No saved leads found for location "${location}"` });
      return;
    }

    const header = [
      "Name", "Domain", "Verdict", "Exposure", "Found", "Secure", "Compliant",
      "CMS", "CVE Risk", "Signals", "Email Hook", "Email", "Address", "Rating", "Reviews",
      "Niche", "Scanned At",
    ].map((h) => `"${h}"`).join(",");

    const csvRows = result.rows.map((r) => {
      const pillars = r.pillars ?? { found: "", secure: "", compliant: "" };
      const signals = Array.isArray(r.signals) ? r.signals.join("; ") : "";
      const cells = [
        r.name, r.domain, r.verdict, r.exposure, pillars.found, pillars.secure,
        pillars.compliant, r.cms, r.cve_risk ? "YES" : "no", signals, r.email_hook, r.email,
        r.address, r.rating ?? "", r.reviews, r.niche, r.scanned_at,
      ];
      return cells.map((v) => {
        if (v === null || v === undefined) return "";
        if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
        return String(v);
      }).join(",");
    });

    const csv = [header, ...csvRows].join("\n");
    const filename = `MASTER-${location}-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("leads/export failed:", msg);
    res.status(500).json({ error: msg });
  }
});

export default router;

