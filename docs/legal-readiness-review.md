# Ajani legal and trust readiness review

**Review date:** September 3, 2026
**Scope:** Public website, request intake, account creation, client portal foundations, demonstrations, client stories, AI processing, transcription, email notification, billing foundations, and published legal pages.
**Status:** Engineering and policy draft complete in development; owner decisions and licensed-counsel approval remain required before this is treated as final legal advice.

This review cannot guarantee that a regulator, platform, carrier, payment provider, or claimant will never challenge the service. It is a structured risk review and implementation record, not a legal opinion or compliance certification.

## Review team

Four specialist tracks reviewed the same product from different angles:

| Track | Primary responsibility | Boundary |
| --- | --- | --- |
| Privacy counsel agent | Data inventory, notices, rights, retention, processors, international transfers, children, AI and voice processing | Did not choose unknown entity, market, or jurisdiction facts |
| Terms counsel agent | Contract formation, project boundaries, accounts, ownership, communications, payment, warranty, liability, termination, disputes | Did not invent governing law, arbitration, address, or commercial positions |
| Product compliance agent | Public claims, demos, testimonials, healthcare language, consent operations, platform and accessibility risk | Did not certify substantiation, HIPAA, WCAG, or communications compliance |
| Engineering implementation | Converted supported findings into product copy, server controls, version evidence, policy pages, and tests | Did not deploy, migrate production data, or represent itself as licensed counsel |

## Changes implemented in development

- Rebuilt the Legal Center around five public documents: Terms, Privacy, Acceptable Use, Accessibility, and Service Providers & Subprocessors.
- Added one shared effective-date/version source for legal documents.
- Added a required, initially unchecked legal-acceptance checkbox at final request handoff.
- Required the acknowledgment in API validation and stored a server-stamped acceptance envelope in the saved request JSON.
- Made new saves, legacy re-acknowledgment, and claim fail closed unless the saved request contains the exact Terms, Acceptable Use, Privacy, and handoff-notice bundle currently presented by the product; historical tuples remain audit-only.
- Added a pending forward-only database migration that, once applied, validates the current acceptance inside the build-submission transaction, rejects unclaimed/null ownership, and snapshots the acceptance, user, organization, draft, approved revision, and content fingerprints into the trusted submission event.
- Added a capability-protected re-acknowledgment endpoint so an older saved draft can be reviewed and brought onto the current policy bundle without silently grandfathering stale assent.
- The pending migration moves legacy re-acknowledgment into a capability-protected database function that updates only the acceptance member, preventing a stale whole-payload write from erasing concurrent voice or workflow metadata.
- The pending migration moves voice-upload metadata into its own narrow database update for the same reason, so those two capability paths cannot overwrite one another's payload members.
- Once applied, the migration removes the broad authenticated-browser draft update path and limits current mutations to capability-protected server routes and narrow database functions.
- Added a linked Terms and Privacy notice beside account creation.
- Added an initially unchecked age, authority, recording-permission, and processing acknowledgment before microphone or AI use; the current version is retained for the tab and required by the transcription and AI endpoints before provider processing. Withdrawing it blocks re-entry to AI-assisted stages until it is checked again. Corrected wording that previously called an in-memory voice note “saved.”
- Disclosed browser/OS speech recognition, Deepgram transcription, Vercel AI Gateway, Anthropic, Supabase, Clerk, Resend, YouTube, and conditional Stripe processing.
- Enabled the AI Gateway no-prompt-training option on application requests.
- Added a high-confidence sensitive-input guard that routes flagged request content to local deterministic processing instead of external AI.
- Removed the unsupported public phrase “HIPAA-aware”; the public intake remains explicitly prohibited for PHI and other regulated data.
- Relabeled interactive demo state as a concept simulation rather than a live connected system.
- Made the default experience honor the operating system's reduced-motion preference while preserving full motion for users who have not requested a reduction.
- Added printable legal-page styles and a public privacy/security/accessibility contact path.

## Release blockers requiring owner or counsel decisions

These items cannot be completed truthfully from the repository alone.

| Priority | Decision or evidence required | Why it blocks final sign-off |
| --- | --- | --- |
| P0 | Exact legal entity name, entity type, DBA status, formation jurisdiction, and business mailing address | Terms and privacy notices need an identifiable operator and contracting party |
| P0 | Monitored legal/privacy/security contact and internal owner | A published right is not meaningful without a response process and accountable person |
| P0 | Intended customer type and markets: B2B only; U.S. states; UK/EEA; other countries | Governing law, notices, privacy rights, transfers, cookies, and consumer rules depend on scope |
| P0 | Governing law, venue, and dispute design; deliberate decision on arbitration and class waiver | These are business and jurisdiction choices, not neutral boilerplate |
| P0 | Review and apply `20260902000000_enforce_request_handoff_acceptance.sql` in a controlled database release, with rollback and invariant tests | The repository contains the atomic database guard, but this review intentionally did not mutate production |
| P0 | Archive the exact rendered/source text and a verified content hash for every accepted policy version | A version date records a label, not independently verifiable proof of the exact text presented |
| P0 | Decide whether the early voice/AI representation is legal assent or a point-of-collection acknowledgment, then add a server-issued processing receipt if reliance evidence is required | The product now sends and server-validates the current acknowledgment version, but it is not an immutable or identity-bound receipt |
| P0 | Testimonial/client-story releases and substantiation file | “Real client,” five-star, timeline, lead, booking, and outcome claims require dated evidence and permission |
| P0 | Healthcare posture, BAAs, vendor eligibility, risk analysis, incident plan, and emergency-routing boundary | No PHI may enter the current public or general-purpose AI path |
| P1 | DPA and vendor-contract register for Vercel, Clerk, Supabase, Deepgram, Anthropic, Resend, and Stripe | Public wording must match enforceable provider settings and transfer terms |
| P1 | Retention schedule for claimed drafts, original audio, project data, account data, logs, email copies, invoices, backups, and outreach records | Current code has concrete periods only for selected unclaimed/security records |
| P1 | Privacy-request runbook: verification, search, export, correction, deletion, exceptions, authorized agents, appeals, and processor forwarding | The public request channel needs an operational backend |
| P1 | Communications compliance program for every SMS, email, or automated-call build | Consent evidence, DNC/suppression, sender identity, quiet hours, opt-outs, and complaint handling are operational controls |
| P1 | Production cookie/network scan and UK/EEA decision for YouTube click-to-load or consent | Repository review cannot see dashboard-only analytics, cookies, or all production requests |
| P1 | Manual accessibility and assistive-technology review | Automated checks and the reduced-motion default are useful but cannot establish WCAG conformance |
| P1 | Online billing design before Stripe checkout or recurring plans are enabled | Price, renewal, cancellation, refund, consent, confirmation, and easy cancellation must be shown at purchase |
| P2 | Liability cap, carveouts, indemnity, confidentiality, IP, refund, service-level, and insurance alignment | These positions should match Ajani’s actual contracts and risk tolerance |

## Verified data and provider map

| Activity | Information | Current recipient or storage | Known repository retention/control |
| --- | --- | --- | --- |
| Public traffic protection | IP/user-agent-derived fingerprints, timestamps | Vercel request path and Supabase | Public request fingerprints 7 days; failed admin attempts 30 days |
| Voice capture | Audio, duration, size, MIME type, live/manual text | Browser memory; optional browser/OS recognition | Raw audio is not placed in browser storage |
| Immediate transcription | Audio and transcript metadata | Ajani server and Deepgram | Endpoint uses no-store; Deepgram request opts out of model improvement |
| Unfinished request | Written note, answers, route, brief, stage | Session storage in the current browser session | Cleared after completed handoff/deletion or by browser session behavior |
| AI shaping | Note, answers, route context | Vercel AI Gateway and/or Anthropic | No-prompt-training requested through Gateway; sensitive-input fallback added |
| Saved draft | Full request content, derived context, acceptance evidence, token hash | Supabase | Unclaimed draft and voice upload expire after 30 days |
| Submitted project | Transcript, approved route, events, approvals, project metadata | Supabase and authorized Ajani/client workspace users | Final period not yet approved |
| Request notification | Contact details and implementation brief | Resend and Ajani mailbox | Final provider/mailbox period not yet approved |
| Authentication | Identity, contact, session, organization and role | Clerk, optional Google/GitHub, synchronized account records | Processed webhook event metadata 90 days; project-record treatment varies |
| Embedded story video | Network/device and interaction data | YouTube privacy-enhanced embed | Loads when the lazy iframe enters the viewport; production scan pending |
| Billing, when activated | Customer, invoice, subscription, amount, status | Stripe and Supabase | Checkout not currently active; retention and renewal controls pending |

## Required operating records

### Policy and assent register

- Archive the exact HTML/PDF or source revision for every effective Terms, Privacy, and Acceptable Use version.
- Record `termsVersion`, `acceptableUseVersion`, `privacyVersion`, `noticeVersion`, `processingNoticeVersion`, server acceptance time, action, method, draft ID, authenticated submitter, and organization where available.
- Preserve historical versions for audit/read purposes, but require the currently presented bundle for new handoffs unless counsel explicitly approves a documented grandfathering rule.
- Require renewed acceptance when a material change changes user obligations or data use.

### Claims and client-proof register

For each testimonial, star rating, client name, image, “real client” statement, delivery window, revenue/savings claim, lead count, booking count, security statement, or healthcare statement, retain:

- exact published claim and placement;
- client/source, date range, sample, calculation, and limitations;
- source records and person responsible for verification;
- written name/logo/video/publicity release and current permission;
- any incentive or material relationship;
- review date and date the claim must be refreshed or removed.

### Privacy-request register

Log receipt, jurisdiction, identity-verification method, systems searched, providers contacted, exemptions, decision, response date, appeal, and deletion/export evidence. Do not put more identity evidence in the register than is needed to show the request was verified.

### Communications register

For client communications, retain consent source, notice text, timestamp, channel, recipient, purpose, sender, message/call record, revocation, suppression/DNC result, carrier registration where applicable, complaint, and remediation. Each client remains responsible for lawful source lists and instructions; Ajani remains responsible for its own conduct.

### Security and vendor evidence

Maintain current DPAs, transfer addenda, BAAs where applicable, vendor security reviews, provider configuration screenshots/exports, access reviews, incident contacts, backup/restore tests, dependency scans, secret-rotation records, and breach-notification decision trees.

## Recommended review cadence

- **Every release affecting collection or providers:** privacy and provider-list review.
- **Monthly:** failed cleanup jobs, request/abuse logs, privacy requests, consent/opt-out failures, provider incidents.
- **Quarterly:** production cookie/network scan, access review, claim substantiation refresh, legal-link and alternate-format test.
- **Annually:** full Terms/Privacy/AUP review, retention audit, vendor-contract review, incident exercise, manual accessibility review.
- **Before any new regulated workflow, country launch, payment plan, or outbound channel:** targeted licensed-counsel and security review.

## Primary reference points

- FTC privacy and security guidance: https://www.ftc.gov/business-guidance/privacy-security
- FTC digital advertising disclosures: https://www.ftc.gov/business-guidance/resources/com-disclosures-how-make-effective-disclosures-digital-advertising
- FTC CAN-SPAM guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- FTC endorsement guidance: https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking
- California privacy guidance: https://oag.ca.gov/privacy/ccpa
- Colorado Privacy Act guidance: https://coag.gov/resources/colorado-privacy-act/
- GDPR: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- ICO privacy information guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/
- HHS business-associate guidance: https://www.hhs.gov/hipaa/for-professionals/covered-entities/sample-business-associate-agreement-provisions/index.html
- DOJ web accessibility guidance: https://www.ada.gov/resources/web-guidance/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Vercel AI Product Terms: https://vercel.com/legal/ai-product-terms
- Vercel AI Gateway data controls: https://vercel.com/changelog/zero-data-retention-no-prompt-training-on-ai-gateway
- Deepgram Model Improvement Partnership documentation: https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program
