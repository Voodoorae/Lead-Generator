# Business suppression and paused deployment, 18 November 2026

The November incident was a reply from a colleague stored under a different CRM
contact from the original recipient. Checking only the original contact allowed
a follow-up after the colleague's refusal.

## Enforced cloud behaviour

- Every message submitted by `outreach-api.mjs` requires explicit
  `OUTREACH_SEND_APPROVED=true` and an installed suppression guard. The default is
  paused, including internal tests, acknowledgements and notifications.
- Before each submission the guard reads all contacts and all email history with
  pagination validation. Missing, incomplete or mismatched data blocks sending.
- Email and website identities use registrable domains. Corporate colleagues,
  known aliases, www and subdomains share a durable business hold. Public mailbox
  providers and the explicitly listed shared business networks do not collapse
  into one business. Network recipients require manual review.
- Every inbound email places the business on review hold. Clear refusal language
  near the start of the unquoted reply records an opt-out. Conditional language,
  long replies and automatic responses remain review holds. This is deliberately
  not a complete natural-language classifier. Neither category can be sent to.
- Existing DND/opt-out evidence is preserved. The cloud guard blocks matching
  contacts, including newly imported colleagues. GHL rejected a direct attempt
  to mirror newly found business opt-outs into email DND with HTTP 422 on 18
  November; this mirror remains pending and requires its own approved path.
  Data-quality holds remain mailbox-only.
- Holds stop existing sequences and cancel pending website acknowledgements.
  Records and historical messages are retained. New imports match durable holds.
- `node server/scripts/suppression-maintenance.mjs` performs the synchronization
  alone with a client that cannot send, regardless of environment configuration.

## Operational boundaries

Keep Render suspended, all three previous sending flags false, and the new
approval flag absent or false after deployment. Deploying is not permission to
resume. Native GHL workflows, manual sends and other applications do not pass
through this cloud guard. The paused GHL campaigns must remain paused; existing
email DND protects the individually marked records but not every future alias.

Unreviewed same-domain contacts are not automatically merged: coworkers and
branches can be legitimate separate contacts. Cleanup tags preserve CRM history.
An authorized human review is needed before releasing a reply hold. There is no
automatic expiry or release. Any future release feature must retain opt-outs.

The full-history pre-send check is intentionally conservative and potentially
expensive in API calls. Optimize only with a verified incremental ingestion and
freshness design. There remains a small interval between checking CRM and the
provider accepting an email; GHL offers no atomic business-wide check-and-send.

## Validation

The build's 65 tests, including 14 suppression tests, passed. All 12 server tests
passed and TypeScript built. Offline replay of the actual 65 inbound messages
identified the three refusal messages from mwclubb and S A Accountants, and held
other replies without recording their quoted footers as refusals.

A broader scripts test run has an existing unrelated website-identity assertion
failure, reproduced on unchanged commit 8cbb493. It is not hidden or fixed here.
No test messages are sent by these local tests.
