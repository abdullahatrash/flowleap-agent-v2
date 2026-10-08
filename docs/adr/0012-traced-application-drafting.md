# Traced application drafting: every sentence has a source, validators are code, gates are code

**Status:** accepted (2026-10-07)

FlowLeap ships a `claim-drafting` skill and an `invention-disclosure` skill. It does not draft
the specification, abstract and drawing descriptions of a patent application. Every competitor
(DeepIP, Solve Intelligence, Patlytics, Rowan) does, with one shape: disclosure in, full draft
out, attorney edits in Word, a review pass for consistency. The primary sources on AI-assisted
drafting (USPTO guidance of April 2024, the USPTO inventorship guidance revised 2025-11-28, ABA
Formal Opinion 512, the epi Guidelines of 2024, the 2026 California guidance) all put the duty
on the signer and name the same risks: embodiments the inventor never conceived, §112 and
Art. 123(2) support gaps, antecedent-basis errors, terminology drift, and the disclosure
leaving the attorney's control. Research record:
`docs/research/ai-patent-drafting-best-practices.md`.

We decide to build **Application Drafting** as a traced pipeline, not as a generator with a
review step.

## The decisions

1. **Every sentence of a Draft Application has a source.** The source is one of: a row of the
   Feature List, a span of the disclosure, an attorney instruction, the office template, or
   **Model-Proposed**. The paragraph carries an inline marker; the Working Record of the draft
   holds the sentence-level map. This is the **Verified-Data Contract** applied to prose.
   Rejected: a clean draft with provenance only in chat (the record must survive the chat), and
   sentence-level inline markers (unreadable in the editor).
2. **Model-Proposed is reserved for structure, never for technical content.** When a claim
   element or an example has no source in the disclosure, the model writes an **Inventor
   Question** instead of filling the gap. Boilerplate and transitions may be Model-Proposed.
   Past-tense results for experiments nobody ran are forbidden. Rejected: "fill and mark"
   (the USPTO "alternate embodiments not contemplated" risk and the EPO added-matter rule both
   bite on the filled text, marked or not).
3. **Human gates are read by code, never inferred from chat.** Drafting starts only when the
   Feature List carries the attorney's `confirmed` flag; the specification is generated only
   when the claims file carries the `approved` flag; export refuses while an Error finding or an
   Inventor Question is unresolved and unwaived. The tools read the flags from the files. This
   extends the key-gate doctrine (a gate is a user-action stop, read from state, never assumed).
   Rejected: trusting "I approve" in chat (the inferred-gate bug we already fixed once).
4. **Deterministic checks are code; model review is advice.** Antecedent basis, dependency
   targets and numbering, one independent claim per category (EPO), the multiple-dependency rule
   (US), abstract length, defined-term consistency, reference-numeral consistency against the
   figures list, and literal basis of every claim term in the specification run as typed-tool
   code with unit tests. A model review runs after them, cites passages, and writes under an
   Advisory heading. It never marks a draft "passed". Rejected: LLM self-review as the only
   gate (benchmarks show it is miscalibrated against attorneys).
5. **Waivers are part of the record.** An Error finding blocks export until the attorney waives
   it with a reason, and the reason is kept in the findings file. Notes never block.
6. **The attorney's edits are recorded by diff, not by trust.** The save keeps a generated
   snapshot; export diffs the edited draft against it and logs each changed paragraph in the
   Working Record. That record (disclosure version, model and provider, prompts, what the model
   proposed, what the attorney kept, changed or deleted) is the diligence and inventorship
   record the primary sources ask for.
7. **Style comes from the workspace, per client.** Exemplars live in a `style/` folder of the
   workspace, which is already one workspace per client. An exemplar shapes voice and structure
   only; it is never a source for a sentence. Empty folder means office template only, never
   another workspace.
8. **Office is chosen per draft, with one template and one validator set each.** US (37 CFR 1.77
   order) or EPO (Rule 42 EPC order). Rejected for v1: a single transatlantic draft (doubles the
   validator surface before either set is proven).
9. **Output is Markdown in the workspace, exported to .docx without markers.** The editor,
   markers, findings and record live on Markdown. The Word file is what the attorney finishes
   in. The record and findings stay beside the Markdown as the trail.

## Consequences

- Drafting is slower than a one-shot generator by design: two gates, one validator pass, one
  advisory pass. We publish no time-saved figure.
- Three typed tools and one save template enter the Patent Agent; a seventh Project Type enters
  the UI shell; six terms enter `CONTEXT.md`.
- Figures are supplied by the user as a figures list; the feature manages numerals in text and
  does not draw.
- The Agents window gets the same skill later through the normal skill sync; the editor Patent
  Agent is the first surface.
- The model and provider the disclosure goes to are stated in chat before the first drafting
  call and written in the record header. Local models through Ollama satisfy matters that
  cannot leave the machine.
