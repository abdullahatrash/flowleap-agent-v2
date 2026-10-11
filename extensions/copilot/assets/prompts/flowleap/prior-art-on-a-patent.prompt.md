---
name: flowleap-prior-art-on-a-patent
description: Prior-art search on a published patent, checked against what the examiners cited, with X/Y/A tags and the limits of the search
---
Run a prior-art search on {publication number, e.g. WO1999051190A1}.

1. Read claim 1 and split it into its elements (A, B, C ...), in plain words.
2. Get the Examiner Baseline: every document the offices cited in this family, with its category (X/Y/A) and the claims it was cited against.
3. Search EPO and USPTO for prior art published before the earliest priority date. Use classification and keyword searches. Show each query and its hit count.
4. Recall check: say which of the examiner-cited documents your searches found.
5. Focus on the elements the examiners did not cover. Look for anything closer than their category A documents.
6. For each candidate: which elements it shows, the passage it relies on, and a tentative X/Y/A tag. Say if you read only the abstract or the full text.
7. End with the limits of the search: what you did not search or did not read.

Save the report as outputs/prior-art-{publication number}.md
