---
name: legal-research
description: Read patent law from the office's own page (the MPEP, 35 USC and 37 CFR, the EPC and the EPO Guidelines, the PCT rules) and quote it with its URL and edition. Use for a patent-law or procedure question, the statutory basis for patentability, novelty, obviousness or written description, or when the user names a section such as 35 USC 103 or EPC Art. 54.
user-invocable: true
---

# Legal Research

Read patent law from the office's own page at the moment of the question, and quote the text
the page gives. This file holds the method only. The URL pattern of each office, one worked
example each, and the section map for common questions are in
[references/official-sources.md](references/official-sources.md).

## Steps

1. **Name the source.** Decide which kind of text answers the question: a statute (35 USC, the
   EPC articles, the PCT articles), a rule (37 CFR, the EPC Implementing Regulations, the PCT
   Regulations), office guidance (the MPEP, the EPO Guidelines, the PCT Applicant's Guide) or
   case law (the EPO Case Law book and Board decisions, the US court opinions). A question about
   what the examiner does goes to office guidance. A question about what the law requires goes to
   the statute or the rule. Take the office from the jurisdiction gate in the system prompt. Done
   when the source and the office are written down before the first fetch.

2. **Resolve the section.** When the user names a section ("MPEP 2143", "EPC Art. 123(2)",
   "Guidelines G-VII, 5", "PCT Rule 4.9"), build its URL from the pattern in the reference file.
   When the user asks in plain words, fetch the index page of the source and find the section
   from its titles, or start from the section map in the reference file. Read the edition year of
   a dated source (the EPO Guidelines, the Case Law book) from its index page, never from memory.
   Done when you have one URL for each section you need.

3. **Fetch and quote.** Fetch the page. Quote only text that the page returned, word for word,
   in quotation marks. Do not quote from memory. Do not change the words of a quote. A paraphrase
   is not a quote: mark it as your summary. Done when each quote in the answer is text of a
   fetched page.

4. **State the edition and the URL.** Give the URL of the page with each quote. Give the edition
   or the revision the page shows: the MPEP revision marker, the EPO Guidelines year, the "in
   force from" date of the PCT texts, the "up to date as of" date of the eCFR. When the page
   shows no edition, say so and give the date of the fetch. Done when each quote has a URL and an
   edition statement.

5. **Say what the page did not answer.** When the page does not hold the answer, say so. Name
   the page you read and the question that stays open. Do not fill the gap from memory. Do not
   report silence as "no such rule". When the fetch fails, say that the fetch failed and give the
   URL, so the user can open it. Done when each open question is named in the answer.
