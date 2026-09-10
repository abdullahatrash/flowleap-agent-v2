# Prior-art candidate workflow reliability

The candidate report path now records completed `search_patents` and `get_patent_details` outcomes in extension-owned workspace storage, keyed by a hash of the chat session URI. Separate records preserve concurrent outcomes across extension reconstruction. The report writer generates query rows and a revision-specific JSON evidence companion from these records. It does not calculate documents reviewed from retrieval counts.

`prior-art-report` produces a candidate review, without injected ISR instructions or X/Y/A categories. Other report templates and free-form saves retain their contracts. Updating a candidate report uses the same template and revised evidence content and structured fields; the writer replaces the report and retains previous evidence companions. A failed validation returns actionable corrections before writing either file.

Mechanical checks verify required coverage/limitations/stopping/review fields, explicit source anchors, and application reader URLs in rendered input fields. Coverage can honestly remain unresolved when source metadata is unavailable. Source anchors preserve backend publication identifiers (including supplied kind codes), section, claim number and language. Claims segmentation state, returned/total claims and unavailable sections are retained. Overall section completeness and passage review remain unknown.

The source-grounded semantic review is a **model declaration**, not automated entailment verification. Prompt and skill instructions require checking dependency chains, preferred examples, qualifiers, inequalities, units, percentage denominators and bounded absence statements. Software scheduling, mechanical combinations and chemical compositions use the same explicit feature/combination/gap contract; the deterministic tests exercise that contract, not domain expertise.

## Validation

- Required `npm run gulp compile-extensions` passed using existing dependency trees.
- Copilot `tsgo --noEmit --project tsconfig.json` passed before tests.
- Focused Vitest suites cover persisted nine-outcome reconstruction (no invented tenth planned query), zero/failure outcomes, corruption/isolation, source identity, fabricated claim citations, candidate save/update compatibility, the search outcome hook, report templates and exact workspace paths including real trailing spaces.
- Skill drift check verifies the 25 canonical mirrors; the edited desktop skills are declared adaptations.

## Explicit limits and live replay cases

Only the instrumented search/detail tools are audited. Calls through `patent_api_request`, external searches, previous versions, uninvoked/skipped plans and interrupted calls can be absent; every report discloses this. A tool failure is recorded as failure, not zero results. There is no global interception of free-form saves or generic file-edit tools.

The existing offload/read-file path does not expose a durable patent-source identity and range observation to these tools. This change therefore does not claim to track passages actually read. Backend section/claim references suffice for this bounded change; paragraph anchor schemas and read observations are deferred. A citation resolving to a returned source does not prove that source supports the statement, and arbitrary external links/prose are not semantically validated.

Before claiming the full workflow reliable, replay the dental-composite task with the deployed model and verify dependent claims versus preferred examples, weight-percent denominator, and `<100` versus `≤100 nm`. Also replay a mechanical essential interlock combination with optional actuator embodiments, and a software fault-recovery workflow whose dependent claim adds synchronization. Check that each run targets unresolved combination gaps, synthesizes when results repeat, and declares remaining coverage. No application replay, deployment, or formal patentability assessment was performed for this change.
