import test from "node:test";
import assert from "node:assert/strict";
import { detectTechSignals } from "./leads.js";

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

test("tracking without consent yields a GDPR hook grounded in what was seen", () => {
  const html = `<html><head><script src="https://www.googletagmanager.com/gtag/js"></script></head>
    <body>partita iva 123 <a href="/privacy-policy">privacy</a></body></html>`;
  const r = detectTechSignals(html);
  assert.match(r.emailHook, /consent|gdpr|tracking/i);
});
