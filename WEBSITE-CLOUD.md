# Proxaim website generator in Render

The cloud website routine runs independently of Codex, a desktop browser session and Rachael's computer. The existing separate 10am prospecting routine remains distinct.

Use the existing Frankfurt cron and database. Its new start command is `node server/scripts/run-daily-automations.mjs`. Set the UTC schedule to `*/15 * * * *`: reply monitoring runs every fifteen minutes; the website routine guards weekdays 09:00 Europe/London on the hour, and the existing routine guards weekdays 10:00 on the hour. Build with `cd server && npm ci && npx playwright install chromium --only-shell`, using `PLAYWRIGHT_BROWSERS_PATH=0` so the browser is included in the build artifact. The cloud service must pass an actual browser readiness run before cutover. Serial execution can delay a reply check while a longer discovery run finishes.

The website campaign uses Proxaim <hello@proxaim.com>, up to twenty introductory attempts per UK day and no follow-ups. It shares the 100-email ceiling and conservatively reserves eighty slots for other senders. All reservations, including failures and uncertainty, consume its allowance. The common outreach advisory lock prevents overlap with the existing cloud sender. Existing CRM contacts and other cloud sequence identities are excluded. Send reservations precede contact creation. Ambiguous contact creation or sending never retries automatically.

One-time configuration:

- Existing DATABASE_URL, GHL_API_TOKEN and GHL_LOCATION_ID stay in Render.
- WEBSITE_OUTREACH_ENABLED defaults off until readiness and workflow checks pass.
- WEBSITE_SENDER_TEST_ID points to the delivered internal Proxaim test. GHL_PROBE_CONTACT_ID supplies its existing recipient identity. The cloud API must verify the actual sender and delivery, not rely on its body.
- WEBSITE_WORKFLOW_SIGNATURE is set only after inspecting the published triggers. Changed workflow versions hold new contact creation automatically. Missing scope or inventory holds it too.
- WEBSITE_MIGRATION_SEED is private compressed JSON containing existing build data. It never enters the public repository. Existing local preview files and historical evidence remain recoverable.
- WEBSITE_DASHBOARD_TOKEN protects `/website-generator` on the branch web service. Do not put it in a URL, public source or logs. Opening the portal is optional; the worker does not depend on it.
- WEBSITE_TEST_DATE and WEBSITE_READINESS_ONLY are temporary verification controls. Clear both before normal scheduling.
- WEBSITE_ALERT_EMAIL and WEBSITE_ALERT_CONTACT_ID identify the verified existing internal notification recipient. WEBSITE_ALERTS_ENABLED defaults off until a real alert test succeeds. Alerts are reserved once per inbound reply and uncertain notifications never automatically retry. Internal alerts count towards shared capacity. See WEBSITE-SALES.md for the draft-based sales process and activation limits.

The renderer fetches only bounded public HTTPS resources, pins DNS, blocks private addresses, disables original website scripts and never submits forms. It saves desktop/mobile measurements and screenshots. Two concrete findings, corporate identity and a published verified mailbox are needed. Regulated sectors additionally need professional-identity evidence. Missing evidence holds a candidate rather than making up a poor-site claim. Client-rendered pages may remain held by these conservative checks.

Preview layouts use independently verified business details, original logos and available project imagery, observed colours and no added stock. Clinical previews avoid patient imagery. Private preview URLs require authentication; the introductory email contains no deployment or localhost link.

Replies stop unsolicited contact. Positive replies stay open for a sales conversation. Opt-outs retire the speculative preview. Won opportunities retire only after the handoff-complete outcome is recorded. After thirty days without a reply, a final current reply check closes an unanswered introduction. Retirement drops the speculative build payload and retains compact provenance, outcomes, permanent contact identities and attempt history. Customer sites are not deleted.

Cutover requires a real Render run proving database writes, migration import, browser launch, CRM inventory access and actual Proxaim sender verification. The local Codex schedule stays active until that succeeds; keep cloud sending off to avoid competing runners during verification. After cutover, disable the local sender schedule and migrate any newly queued local batch before removing local dependencies.
