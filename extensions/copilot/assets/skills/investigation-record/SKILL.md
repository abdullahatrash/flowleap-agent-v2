---
name: investigation-record
description: Keep a decision trail beside a patent deliverable, one row per judgment call with the evidence behind it. Use when a research task will accumulate judgment calls, when a report will be read by someone who did not watch the work, or when another skill asks for a decision trail.
user-invocable: true
---

# Investigation record

A judgment call nobody wrote down is one a reviewer cannot check. The call you doubted while making it is the one that most needs a row.

1. Open `analysis/decisions.tsv` at the first judgment call, not at the end, with the header from [references/row-format.md](references/row-format.md). Done when the file exists with its header row.
2. Add a row for each call that could have gone the other way: a scope or cutoff fixed, a jurisdiction included or left out, a reference dropped, a column read as a key, a conflict between two sources resolved. Not every action, and nothing self-evident. Done when every call that changes an answer has a row.
3. Put a pointer in the evidence cell, never a claim: a source anchor, the tool call and what it returned, a file path, a quoted line. Done when no evidence cell holds prose.
4. Mark a call you could not settle as `unresolved` rather than letting the report read as certain, and supersede a call you reversed with a new row instead of editing the old one. Done when the trail reads in order and every open call is visible as open.
5. Name the record in the report's limitations, and put the unresolved rows in the summary you hand back. Done when a reader who opens only the report knows which calls to check first.
