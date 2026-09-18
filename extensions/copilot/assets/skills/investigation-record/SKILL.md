---
name: investigation-record
description: The decision trail beside a patent deliverable, and the row format every skill that writes one uses: one row per judgment call with the evidence behind it, and a row for every statement the report is less sure of than it sounds. Use when another skill asks for a decision trail, or when the user asks for one on a report someone who did not watch the work will read. For a record of what was searched and retrieved rather than what was decided, use audit-report.
user-invocable: true
---

# Investigation record

A judgment call nobody wrote down is one a reviewer cannot check.

1. Open `analysis/decisions.tsv` in the workspace at the first judgment call, not at the end, with the header from [references/row-format.md](references/row-format.md). Append every later row; never rewrite the file. Done when the file exists with its header and each row was added by appending.
2. Append a row for each call that could have gone the other way: a scope or cutoff fixed, a jurisdiction included or left out, a reference dropped, a column read as a key, a conflict between two sources resolved. Not every action, and nothing self-evident. Done when every call that changes an answer has a row.
3. Put a pointer in the evidence cell, never an argument: a source anchor, the tool call and what it returned, a file path, a quoted line. Done when no evidence cell holds prose.
4. Before saving the report, read back what you wrote and find every statement you would not defend if a reviewer pushed on it: a number a tool returned that you did not check a second way, a conclusion resting on a single source, a mismatch you noticed and moved past. Each one gets a row marked `unresolved`. Done when no sentence in the report is more certain than the row behind it.
5. Supersede a call you reversed with a new row rather than editing the old one, name the trail in the report's limitations, and carry the `unresolved` rows into the summary you hand back. Done when a reader who opens only the report knows which calls to check first.
