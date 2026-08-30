import test from "node:test";
import assert from "node:assert/strict";
import { detectTechSignals, extractEmailFromHtml } from "./leads.js";

test("worst-case WP site (tracking, no consent, CVE plugins) fails all pillars hard", () => {
  const html = `<html><head>
    <script src="https://www.googletagmanager.com/gtag/js"></script>
    <link href="/wp-content/themes/x"><script src="elementor.js"></script>
  </head><body>revslider</body></html>`;
  const r = detectTechSignals(html);
  assert.equal(r.readable, true);
  assert.ok(r.pillars.secure >= 67, `secure was ${r.pillars.secure}`);
  assert.ok(r.pillars.compliant >= 67, `compliant was ${r.pillars.compliant}`);
  assert.ok(r.exposure >= 80, `exposure was ${r.exposure}`);
  assert.equal(r.cms, "WordPress");
  assert.equal(r.cveRisk, true);
});

test("managed, clean, consented site scores ~0 and is not exposed", () => {
  const html = `<html><head>
    <script type="application/ld+json">{}</script>
    <meta property="og:title" content="x">
    <script src="cookiebot.js"></script>
    <script src="https://squarespace.com/x"></script>
    <script src="https://www.googletagmanager.com/gtag/js"></script>
    <a href="/privacy-policy">privacy</a> p.iva 123
  </head><body>hubspot</body></html>`;
  const r = detectTechSignals(html);
  assert.equal(r.pillars.secure, 0);
  assert.equal(r.pillars.compliant, 0); // consent + policy present, tracking covered
  assert.ok(r.exposure < 34, `exposure was ${r.exposure}`);
});

test("blank fetch is unreadable, zeroed, and produces no email hook (no false claims)", () => {
  const r = detectTechSignals("");
  assert.equal(r.readable, false);
  assert.deepEqual(r.pillars, { found: 0, secure: 0, compliant: 0 });
  assert.equal(r.emailHook, "");
  assert.equal(r.signals.length, 0);
});

test("policyPresent hint overrides homepage regex and lowers Compliant exposure", () => {
  const html = `<html><head><script src="https://www.googletagmanager.com/gtag/js"></script></head><body>no policy linked</body></html>`;
  const without = detectTechSignals(html);
  const withPolicy = detectTechSignals(html, { policyPresent: true });
  assert.ok(
    withPolicy.pillars.compliant < without.pillars.compliant,
    `expected ${withPolicy.pillars.compliant} < ${without.pillars.compliant}`,
  );
});

test("Spanish site with CIF and política de privacidad reads as compliant", () => {
  const html = `<html><head>
    <script type="application/ld+json">{}</script>
    <script src="cookiebot.js"></script>
    <script src="https://www.googletagmanager.com/gtag/js"></script>
    <a href="/politica-de-privacidad">privacidad</a> CIF B12345678
  </head><body>hubspot</body></html>`;
  const r = detectTechSignals(html);
  assert.equal(r.pillars.compliant, 0, `compliant was ${r.pillars.compliant}`);
});

test("tracking without consent yields a GDPR hook grounded in what was seen", () => {
  const html = `<html><head><script src="https://www.googletagmanager.com/gtag/js"></script></head>
    <body>partita iva 123 <a href="/privacy-policy">privacy</a></body></html>`;
  const r = detectTechSignals(html);
  assert.match(r.emailHook, /consent|gdpr|tracking/i);
});

test("extractEmailFromHtml prefers a mailto: link over incidental text", () => {
  const html = `<html><body>
    <a href="mailto:office@example.com">Email us</a>
    Also reach jane.doe@example.com for sales.
  </body></html>`;
  assert.equal(extractEmailFromHtml(html, "example.com"), "office@example.com");
});

test("extractEmailFromHtml falls back to regex-scanned text when no mailto link exists", () => {
  const html = `<html><body>Contact: info@example.com for details</body></html>`;
  assert.equal(extractEmailFromHtml(html, "example.com"), "info@example.com");
});

test("extractEmailFromHtml prefers a generic inbox over a personal-looking address", () => {
  const html = `<html><body>jane.doe@example.com or contact@example.com</body></html>`;
  assert.equal(extractEmailFromHtml(html, "example.com"), "contact@example.com");
});

test("extractEmailFromHtml ignores off-domain and image-filename false positives", () => {
  const html = `<html><body>
    <img src="logo@2x.png">
    Reach out via support@some-widget-vendor.com or visit us.
  </body></html>`;
  assert.equal(extractEmailFromHtml(html, "example.com"), null);
});

test("extractEmailFromHtml returns null with no email present", () => {
  const html = `<html><body>No contact details here.</body></html>`;
  assert.equal(extractEmailFromHtml(html, "example.com"), null);
});
