# Export

When the attorney asks for the Word file, call `export_draft_docx`. It
refuses on an unwaived Error or an open Inventor Question and lists each
one: report each one, and the open steps of `checklist.md`. The attorney
resolves it, or writes a waiver with a reason in `findings.md`.

It writes the description, the claims and the abstract as three .docx files
with the office page setup (EPO Rule 49 EPC, US 37 CFR 1.52). It does not
draw figures: tell the attorney that the drawing sheets are prepared
separately. Beside the files it writes `filing-manifest.md` with the values
the attorney declares at filing: claims, drawing sheets, the proposed
abstract figure and the pages. Report the page counts as estimates, and the
abstract figure as a proposal. It also writes `draft-application.full.docx`,
the whole application in one file for the attorney to read, not to file;
report each `[MISSING: ...]` placeholder in it with the checklist step or
note it names.
