# Proxaim website sales process

Prepared using the billion-dollar-board skill: Hormozi's focus on a useful outcome and credible evidence, Brunson's staged customer journey and Godin's permission-based continuation. This is a process design, not advice or endorsement from those individuals.

## Current activation status

The implementation is local and has not been deployed or verified in Render. No notification or follow-up emails were sent while preparing it. Existing permission remains one introduction per business. Follow-up replies are drafts until Rachael chooses an automatic response policy. Prices, booking links and commercial terms need approved configuration.

## Journey and ownership

| Event | Next step | Timing | Completion evidence |
|---|---|---|---|
| Introduction accepted | Monitor the actual reply; preserve private preview | Planned cloud polling every 15 minutes, including weekends | CRM message ID and observed status |
| Explicit interested reply | Email Rachael a CRM link and prepare a tailored reply draft | Next monitor run, subject to sender and shared capacity checks | Unique inbound message ID |
| Ambiguous reply | Hold for human interpretation | Next monitor run | Original conversation |
| Automatic absence reply | Record a review task; check stated return date | Review in two business days; adapt to actual return date | Original automatic reply |
| Qualified interest | Identify priority service, decision maker, timing and budget | First conversation | Recorded requirements |
| Concept review | Explain two verified website issues and how the concept addresses them | Agreed review | Verified preview and prospect feedback |
| Discovery booked | Confirm agreed time and agenda | On verified booking | Calendar event or explicit agreement, not an inferred booking |
| Proposal sent | Give scope, exclusions, approved price, payment terms, delivery assumptions and one next step | After discovery | Exact proposal and send evidence |
| Proposal awaiting decision | Prepare a useful check-in draft | Two business days after actual proposal send | A question that resolves a real uncertainty |
| Still undecided | Prepare one closing-the-loop draft | Five business days after proposal, unless a different date was agreed | Latest reply/suppression check |
| Won | Verify agreement and payment; begin onboarding | On observed acceptance and payment | Agreement and payment reference |
| Handoff complete | Retire speculative preview; retain customer site and sales history | After handoff | Confirmed delivery and handoff record |
| Decline or opt-out | Stop the conversation and close the opportunity | Immediately | Actual reply or DND record |

These times are review targets. This implementation sends internal interest alerts only when enabled. It does not send sales replies, calendar bookings, quotes, payment requests or follow-up sequences automatically. The dashboard records completed stages and evidence. Intermediate review dates should be adapted to the prospect's agreed timing.

## First interested reply draft

Thank the prospect. Use the verified concept only if it exists and passed QA. Ask which service they most want the website to generate enquiries for. Invite a short call and ask for a suitable time until a verified booking link is supplied. Answer any specific question in their reply before using the draft. Do not send the generic draft unchanged when they asked about price, timing or a particular integration.

## Discovery agenda

1. Which service or customer type matters most, and what does a useful enquiry look like?
2. Who decides on the project, and what timing and budget have they agreed?
3. How do website enquiries and phone calls currently reach staff?
4. What existing brand assets and content can be reused with permission?
5. What phone, calendar and CRM systems would an optional booking or voice agent need to use?

Recommend the smallest relevant scope: a website, website plus enquiry handling, or website plus a compatible administrative voice/booking agent. Explain outcomes as intended improvements, not guaranteed revenue or claims that calls are currently being missed. For clinical practices restrict agents to administrative enquiries, appointment requests and staff handoff. Do not collect patient information, diagnose or propose triage.

## Proposal and check-in drafts

The proposal must include the agreed priority, verified website findings, deliverables, original brand assets, integrations requiring confirmation, exclusions, approved price and terms, responsibilities, realistic timeline and acceptance step. Do not invent a price, free offer, guarantee, testimonial, limited availability or payment link.

Two-business-day check-in draft:

> Hello, have you had a chance to review the proposal? Is there anything about the scope or next step you would like clarified? Proxaim, hello@proxaim.com.

Five-business-day closing draft:

> Hello, would you like to continue with the website proposal, revisit it on a date that suits you, or close it for now? Proxaim, hello@proxaim.com.

These are starting drafts. Personalise to the actual conversation and include the opt-out instruction. Any reply, opt-out, bounce, changed scope or agreed later date cancels a scheduled sales draft until reviewed. There is no cold follow-up sequence in this campaign.

## Alerts and controls

Configure WEBSITE_ALERT_EMAIL and WEBSITE_ALERT_CONTACT_ID for the verified existing internal recipient, then enable WEBSITE_ALERTS_ENABLED only after an actual cloud test. The proposed recipient is Rachael's Proxaim mailbox, pending her answer. The alert contains a business name, CRM link and next step, not the full message or clinical information. Keyword classification is conservative and can miss or misread interest; ambiguous replies remain in the review queue. It does not assess buying intent with an invented score.

A permanent reply identity prevents duplicate processing. Alert reservations occur before the provider call. Uncertain sends are never retried automatically and require reconciliation. Provider acceptance is not proof of delivery. Internal alerts consume shared email capacity and can be held when capacity or prerequisites cannot be verified. Reserved and uncertain alerts are shown in the private dashboard and require review.

The cloud worker and dashboard preserve the separate campaign and stop duplicate introductions. Do not enable the local and cloud senders together. Cloud cutover and the pending approval for publishing source are still required.
