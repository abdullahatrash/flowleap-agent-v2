# PRD 0007 · Team-review remediation: de-Copilot the UI, align prompt with tools, typed tools over the facade, and filing/UPC assistant features

Source: 5-agent team review of 2026-07-10 (UI-leak audit, prompt↔tool cross-check, feature-gap analysis, EPO filing domain study, UPC CMS domain study). Every finding below was independently spot-verified against the code before inclusion.

## Problem Statement

Patent AI ships today with three classes of user-facing debt and one missed opportunity:

1. **Residual Copilot branding.** Twelve verified, reachable "GitHub Copilot" surfaces remain in the UI — most prominently a Settings-editor category literally titled "GitHub Copilot Chat" sitting over hundreds of settings, a "GitHub Copilot — your AI pair programmer" welcome walkthrough, a title-bar "Copilot Sign In" menu item, and a survey toast that asks users to "help us make GitHub Copilot better" while posting to Microsoft telemetry. For a rebranded commercial product this reads as unfinished at best and confuses users about what they installed.

2. **The system prompt and the tool surface disagree.** Eight of the twenty registered patent tools have no routing in the system prompt, and in two places the prompt actively routes *away* from the correct tool: trends/landscape requests are sent to the search path while the analytics tool's own description says the opposite verbatim, and claim analysis is taught as a by-hand procedure while dedicated claim tools sit unused. One prompt line teaches an enum value that fails schema validation. A BYOK model following the prompt does more work, drifts more, and misses purpose-built deliverables like the deterministic claim chart.

3. **The backend is ahead of the IDE.** The `/v1/tools` facade already serves legal status, patent family (INPADOC), register events, US continuity, prosecution timeline, office-action citations, patent term, one-call patent summaries, and data-grounded multi-patent comparison — but none of these has a typed tool in the IDE. The FTO and portfolio skills that need this data most reach it by having the model hand-write raw OPS REST paths through the escape hatch, which is exactly where mid-tier BYOK models drift or fabricate. Report output is similarly constrained: seventeen bundled skills funnel into only three report templates.

4. **Filing and UPC domain knowledge is untapped.** Study of the EPO front-office and UPC CMS codebases surfaced assistant features practitioners need that no incumbent tool provides well: fee-reduction eligibility is a gap EPO itself never solved centrally (a literal `//TODO handle discounts` in its shared fee rules — every country hand-rolled incompatible rules), UPC opt-out eligibility has a hard, checkable blocker (unitary effect), Rules-of-Procedure citations reach users with no plain-language explanation, and the 12-month Paris / 30-month PCT windows plus excess-claims fees trip up filers who discover them too late.

## Solution

One remediation-plus-features pass, sliced so independent agents can execute layers concurrently in the shared working tree:

- **De-Copilot sweep**: rename/remove every verified user-visible Copilot/GitHub string and the Copilot glyph where it stands in for the product; disable the survey service outright (consistent with the BYOK no-content-telemetry stance).
- **Prompt↔tool alignment**: fix the analytics contradiction, teach the claim-analysis pair, prefer the one-shot details/figures tools, correct the invalid enum, teach `write_patent_results`, and remove dead detection flags — validated by the existing eval suite.
- **Typed tools over the facade**: wrap the nine already-deployed backend endpoints as typed tools on the `IPatentBackendClient` seam, then retarget the FTO/portfolio/office-action skills onto them so no skill hand-writes raw REST paths.
- **Report-template expansion**: grow the template set from three to eight so litigation and diligence deliverables render with professional structure.
- **Filing/UPC assistant features**: ship the skill-shaped features the domain study justified — UPC opt-out eligibility check, fee-reduction advisor, pre-filing readiness checklist, RoP explainer, excess-claims fee estimator — as bundled skills with reference material, using typed tools where the data already flows.

## User Stories

### Branding & trust

1. As a patent attorney evaluating Patent AI, I want the Settings editor to show a "Patent AI" category instead of "GitHub Copilot Chat", so that I trust I installed the product I paid attention to.
2. As a new user, I want the welcome walkthrough to introduce Patent AI's research workflow instead of "GitHub Copilot, your AI pair programmer", so that onboarding teaches me the product I actually have.
3. As a user, I want the title-bar sign-in item to say "FlowLeap Sign In", so that sign-in language is consistent everywhere.
4. As a user, I want to never see a toast asking me to "help make GitHub Copilot better", so that I'm not asked to improve a competitor's product from inside Patent AI.
5. As a privacy-conscious BYOK user, I want the Microsoft survey/telemetry service disabled rather than rebranded, so that no usage signal leaves my machine through legacy endpoints.
6. As a user confirming a tool action in chat, I want the confirmation card to say "Patent AI will install/execute…", so that the agent speaks with one identity.
7. As a user browsing the Command Palette, I want no commands categorized under "Copilot", so that command search reflects the product.
8. As a user reading setting descriptions, I want no references to "Copilot subscription", "GitHub.com", or "GitHub account" where FlowLeap auth is what's meant, so that settings text matches how the product actually works.
9. As a user, I want inline-chat failure messages and auth progress toasts to name Patent AI / FlowLeap, so that error states don't leak the old brand.
10. As a user, I want agent/provider icons to use a neutral or FlowLeap glyph instead of the recognizable Copilot logo, so that the visual identity is coherent.

### Prompt↔tool alignment

11. As a researcher asking for "patent filing trends in solid-state batteries", I want the agent to call the analytics tool directly and present its tables, so that I get the full-corpus answer in one step instead of a mis-routed keyword search.
12. As an inventor pasting my claim, I want the agent to run the claim-analysis tool first (elements, keywords, suggested codes) before searching, so that the search is grounded in a structured breakdown rather than ad-hoc reading.
13. As an attorney comparing my claim against found prior art, I want the agent to use the claim-comparison tool's element-by-element chart, so that I get the deterministic litigation-grade deliverable instead of free prose.
14. As a user asking "tell me about EP1234567", I want the agent to use the one-shot patent-details tool, so that I get biblio+claims+description in one call instead of a multi-step raw-API dance.
15. As a user asking to "show me the figures of this patent", I want the agent routed to the figures tool, so that drawings render inline instead of the agent claiming it can't display images.
16. As a user doing legal research across jurisdictions, I want the agent to omit the jurisdiction parameter for an all-sources search, so that the call never fails schema validation with an invented "all" value.
17. As a user receiving a research report, I want the agent to save it through the report-writing tool with a named template, so that reports carry consistent professional structure and the standard footer.
18. As a maintainer, I want the prompt's dead tool-detection flags removed and its duplicated jurisdiction-gate text compressed, so that the prompt stays auditable and token-lean.
19. As a maintainer, I want the eval suite to stay green across all prompt changes, so that routing fixes never regress the 40-example baseline.

### Typed tools over the facade

20. As an FTO analyst, I want a typed legal-status tool returning in-force/lapsed/expired per jurisdiction, so that clearance judgments rest on structured data instead of model-composed REST calls.
21. As an FTO analyst, I want a typed patent-family (INPADOC) tool, so that I see every jurisdiction a patent family touches before advising on freedom to operate.
22. As a portfolio analyst, I want a typed register-events tool, so that oppositions, transfers, and lapses appear as first-class data in due-diligence work.
23. As a US prosecutor, I want a typed continuity tool (parent/child chain), so that double-patenting exposure and priority chains are traceable in one call.
24. As a US prosecutor, I want a typed prosecution-timeline tool, so that office actions, responses, and RCEs render as a chronology without manual assembly.
25. As a prosecutor responding to an office action, I want a typed office-action-citations search tool, so that examiner-cited art arrives structured with categories rather than scraped.
26. As an FTO analyst, I want a typed patent-term tool with adjustment data, so that expiry estimates in my memos have a real source.
27. As any user asking about a specific patent, I want a typed one-call patent-summary tool, so that the common "tell me about X" turn costs one round-trip instead of three or four.
28. As an analyst comparing candidate references, I want a typed data-grounded compare-patents tool (2–10 documents), so that comparisons quote fetched text rather than the model's memory.
29. As a skill author, I want the FTO, portfolio, and office-action skills retargeted onto the new typed tools, so that no bundled skill instructs the model to hand-write raw OPS/ODP paths.
30. As an agent-routing maintainer, I want the new tools registered in the patent tool allow-list and taught in the system prompt with clear routing keywords, so that the model discovers them.

### Report templates

31. As a litigator, I want an invalidity claim-chart template, so that element-by-element invalidity contentions export in the format courts and clients expect.
32. As a litigator, I want an infringement/EoU chart template, so that evidence-of-use mapping renders consistently.
33. As counsel, I want a patentability-opinion template, so that novelty/inventive-step assessments follow a professional memo structure.
34. As an analyst, I want a landscape-report template, so that analytics-tool output lands in a structured deliverable.
35. As a diligence lead, I want a portfolio due-diligence memo template, so that portfolio reviews produce a standard artifact.

### Filing & UPC assistant features

36. As a European patent holder, I want to ask "can EP1234567 be opted out of the UPC?", and have the agent check unitary-effect status from register data and explain the blocker if one exists, so that I don't draft an opt-out that is legally impossible.
37. As a patent owner facing UPC exposure, I want the agent to explain the opt-out sub-actions (opt-out, withdrawal, correction, unauthorized-filing removal) and their requirements, so that I know which request applies to my situation.
38. As a solo inventor or SME, I want a fee-reduction advisor that asks about my jurisdiction and status and explains which reductions I qualify for and what proof is required, so that I don't overpay filing fees out of ignorance of hand-rolled national rules.
39. As a first-time filer, I want a pre-filing readiness checklist (description/claims/abstract present, priority within 12 months, PCT national-phase within 30 months, applicant/representative constraints, sequence-listing trigger), so that formal deficiencies surface before I touch an official portal.
40. As a party in UPC proceedings, I want to paste a Rule-of-Procedure citation (e.g. RoP 192, RoP 206, RoP 264) and get a plain-language explanation of what it governs and the typical time window, so that court documents become legible without counsel on every line.
41. As a drafter, I want an excess-claims fee estimate ("22 claims → surcharge on 7"), so that claim-count cost trade-offs are visible while drafting.
42. As a filer choosing a route, I want the agent to explain which parts of a PCT filing are validated by WIPO versus the receiving office, so that I understand why some errors surface late.
43. As a UPC litigant, I want the agent to explain which court divisions are available for my case and which languages of proceedings each allows, so that forum decisions account for language constraints.
44. As any user of these features, I want every output to carry the analysis-support-not-legal-advice note, so that the product's guidance boundary stays explicit.

## Implementation Decisions

- **Survey service**: neutralized at registration (null/no-op service), not string-rebranded. Removal follows the clean-contribution-removal rule: declaration, registration, and cross-references go together; a clean console is part of done.
- **Settings category**: retitle the configuration block; setting IDs (`github.copilot.*`) are retained for compatibility — this PRD renames display text only, consistent with the earlier decision to defer the settings-ID rename.
- **Walkthrough**: the GitHub Copilot walkthrough is removed, not rebranded (coding-assistant onboarding content is wrong for this product). This lands via existing issue #43 (dormant GitHub surfaces purge), which this PRD's sweep slice references rather than duplicates. A replacement Patent AI walkthrough is out of scope (belongs to the onboarding redesign, #79).
- **Prompt changes** all go through the existing single prompt-include seam (the patent instructions block included from the agent prompt). New routing branches: analytics (trends/landscape/top-assignees → analytics tool, present returned tables directly), claim analysis (user-owned claims → analyze first, compare after search), details/figures (one-shot tools preferred; guide+raw-request kept as the advanced path). The duplicated jurisdiction-gate restatement is compressed to fund the added branches. The subagent prompt's inert "read PDF" line is scoped to user-attached local files.
- **Typed tools** wrap facade endpoints via the existing `IPatentBackendClient` DI seam following the established tool pattern (typed input schema, shared error handler, markdown-table result rendering, citation types where applicable). Each tool follows the four-seam wiring: tool-name enum, contributed tool declaration with model description, implementation registration, and the patent-agent allow-list. Model descriptions carry routing triggers and defer-to guidance mirroring the existing typed-over-guide convention.
- **Facade endpoints wrapped** (all already deployed): legal status, patent family, register events, continuity, prosecution timeline, office-action citation search, patent term, patent summary, compare patents. No backend changes are in scope; the tools consume the `/v1/tools` facade contract as-is.
- **compare_patents vs compare_claims**: both remain; the prompt distinguishes them — compare_claims for user-drafted claim text against references (chart scaffold), compare_patents for published-document-to-document comparison (data-grounded).
- **Report templates**: extend the template union and tool input enum from three to eight (adding invalidity-claim-chart, eou-infringement-chart, patentability-opinion, landscape-report, portfolio-due-diligence-memo). Templates wrap model content in professional structure with the standard footer; the claim-chart templates reuse the element-by-element rendering shipped for claim comparison.
- **Skill retargeting**: FTO, portfolio, and office-action-response skills replace raw-path instructions with the new typed tool names. Skill descriptions remain the sole routing signal (path-only registration).
- **Filing/UPC features ship as bundled skills** in the existing skills asset directory, each with a `references/` directory carrying the domain material extracted from the EPO study (fee-reduction rules per jurisdiction, RoP summaries, filing-validation checklist, UPC division/language table, opt-out procedure notes). The opt-out eligibility check uses the unitary-patent register data already reachable through the typed/OPS surface for the unitary-effect blocker, and states explicitly that authoritative opt-out status requires the public UPC registry (linked, not scraped).
- **Legal-advice boundary**: filing/UPC skills inherit the existing once-per-response analysis-support note from the system prompt; skills do not restate it per section.
- **Sequencing**: prompt-routing additions for the new typed tools land with the tools themselves (tool slice includes its prompt lines), so no slice leaves the prompt referencing an unregistered tool name — the inverse failure mode of the misalignments this PRD fixes.

## Testing Decisions

- **External behavior only**: tests assert what a user or the model observes — rendered tool output, prompt text containing/omitting routing lines, template-wrapped report structure — never internal wiring.
- **Eval suite as the prompt gate**: the BYOK promptfoo suite (40-example baseline on gemini-2.5-pro) must stay green across all prompt changes; assert-only additions covering the new routing branches (analytics keywords, claim-tool selection, details/figures preference) re-grade free against the cache.
- **Typed tools**: unit tests per tool following the existing patent-tool test pattern (mock `IPatentBackendClient`, snapshot the rendered markdown via one `deepStrictEqual`-style snapshot per scenario; error paths through the shared error handler). Prior art: the existing search/citation/details tool tests. Respect the shared-tree vitest hazard: bare substring filters, never `-u` with full paths.
- **Prompt structure tests**: extend the existing prompt snapshot/unit tests to assert the new branches render when the corresponding tool is available and are absent otherwise (the tool-detection contract).
- **UI sweep**: grep-based leak assertions are brittle; acceptance is a manual smoke over the six prominent surfaces (Settings category, walkthrough absence, title-bar item, no survey toast, confirmation cards, palette categories) plus a clean console on launch.
- **Skills**: validated by the skills registration test pattern (description present, references resolve); content quality is exercised through eval examples where feasible (opt-out eligibility yes/no cases, excess-claims arithmetic).
- **HITL acceptance**: one live BYOK session exercising a Tier-A tool chain end-to-end (legal status + family on a real EP number through the deployed backend), matching the PRD 0004/0006 live-smoke convention.

## Out of Scope

- **Settings-ID rename** (`github.copilot.*` → `patent.*`): display text only in this PRD; the ID migration remains deferred as previously decided.
- **Replacement onboarding walkthrough**: belongs to the first-run onboarding redesign (#79).
- **Backend work of any kind**, including: CPC/IPC classification lookup endpoint, CN/JP/KR prior art via family expansion + machine translation, examiner/art-unit analytics aggregates, PTAB/EPO-opposition outcome data, and any UPC-registry opt-out status API. These are Tier-C roadmap items.
- **Authoritative UPC opt-out status lookup** (querying the live UPC registry): the skill checks the unitary-effect blocker and links the registry; it does not scrape or integrate it.
- **A deadline calculator with computed RoP time limits**: the RoP explainer describes typical windows; computing party-specific deadlines is legal-calendar territory and needs a maintained rules dataset that doesn't exist yet.
- **Double-patenting/terminal-disclaimer skill**: valuable but gated on the continuity tool landing first; file as follow-up after this PRD ships.
- **UPC pleading drafting**: the studied `upc-drafter` is an empty scaffold; there is no precedent to build on and no validated user demand yet.

## Further Notes

- Overlaps resolved during planning: existing issue #43 already covers the walkthrough/welcome purge (referenced, not duplicated); the sessions-window mobile-sheet leak was fixed under #93. The survey-service disable also advances the "purge dormant GitHub surfaces" goal of #43/#42.
- The de-Copilot sweep, prompt alignment, typed-tool slices, template expansion, and each filing/UPC skill are independently executable layers; concurrent agents must follow the shared-working-tree rules (stage only your issue's files, `git commit -- <paths>`, never `git add -A`).
- The domain study's citations (exact EPO/UPC config files backing every rule in the filing/UPC skills' reference material) are preserved in the review record and should be carried into the skills' `references/` files so the content is auditable.
- Fee amounts and reduction rules drift; the fee-advisor skill must date-stamp its reference tables and instruct the model to caveat that official fee schedules govern.
