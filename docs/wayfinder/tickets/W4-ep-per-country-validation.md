---
id: W4
title: Resolve & surface EP per-designated-state validation status
type: research
status: open
assignee:
blocked-by: []
---

## Question

Can an EP patent's **per-designated-state** validation/maintenance status be resolved from OPS
legal-status and/or the EP register, and how should the tool surface it?

Finding F13a: for EP 3 261 474 (the top FTO blocker) the legal-status feed showed a mix of
"lapsed in a contracting state" and "annual fee paid 2025" events but never *which* states — so
the FTO run could not confirm German (DE) validation from the CLI and had to defer to a DPMA
register check. For any EP-market FTO, "is this EP patent still in force in *my* target country"
is the decisive question, and the tool currently cannot answer it.

### Deliverable
A `/research` summary establishing whether OPS/register data can be parsed into per-state status
(and to what fidelity), then either (a) surface per-designated-state status where the data allows,
or (b) if the data is insufficient, have the tool explicitly hand the agent the national-register
next step with the target states named. Distinct from the out-of-scope DPMA *search* for DE-only
rights — this is about EP patents' national validation.
