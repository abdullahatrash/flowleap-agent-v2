# The decision row

Tab-separated, one row per judgment call, append only. This header, these five
columns, this order — it is the only shape, and every skill that writes the file
writes this one:

```
when	call	why	evidence	status
```

Do not invent a column set. A trail written as `date node status value evidence`
has been seen in the wild; it drops `why`, which is the column a reviewer reads
first, and it leaves two files in one workspace that cannot be read together.

| Column | What goes in it |
| --- | --- |
| `when` | ISO date, or date and time when order matters within a day. |
| `call` | What was decided, in one line, with the number or scope it changes. |
| `why` | The reason in plain words. Not a principle, the actual reason. |
| `evidence` | A pointer a reader can open: a source anchor, a tool call and its result, a file path, a quoted line. Never a sentence arguing the point. |
| `status` | `settled`, `unresolved`, or `superseded by <when> <call>`. |

Cells stay on one line. Strip tabs and newlines out of pasted text.

## Worked rows

These come from real runs. The third is the one that matters most.

```
2026-09-14	counted 4G-declared families on DIPG_PATF_ID, giving 38,892 not 62,536	DIPG_ID is one entry of a declaration's patent list and a family holds up to 40 of them	references/etsi-isld-columns.md; analysis/count_4g_huawei.py output	settled
2026-09-13	searched art published before 2009-01-19, the EP filing date	the US family member was filed 2008-04-16, so the honest cutoff is earlier; kept the later date because the request named the EP filing and disclosed the gap in the report	get_patent_family EP2110298B1	unresolved
2026-09-17	dropped "US application 10374408" from the priority line	the family lookup returns it but it matches no application in the USPTO record; the number the reader can check is US7722129B2	get_family EP2110298B1 member refType=priority; get_continuity 12103744	settled
```

The second row is what an unresolved call looks like: a real choice, made anyway, with the reason it might be wrong.

The third is the row step 4 exists for, and it is the one people miss. Nothing was weighed when that number was written, so it never felt like a decision — the report simply stated what a tool had returned while the reasoning behind it had already noticed the mismatch. A provenance check cannot catch it, because the number did come from a tool. Only reading the finished report back against your own certainty does. When step 4 finds one before the save, the row reads `unresolved` and the report says so; the row above is what it looks like after the check was done and the statement was corrected instead.

## What not to log

Retrievals that found what they were looking for. Tool calls that succeeded. Formatting choices. The order sections were written in. A row that no reader would ever act on is noise, and noise is what makes a trail go unread.

## The one exception: the opening scope

The scope a deliverable runs on — its subject, cutoff, jurisdictions, depth, output — is
set once before any search, and every later finding depends on it. Those rows belong at the
top of the trail even though each was chosen rather than weighed, because a reader checking
a conclusion starts by checking what it was scoped to. The investigation-brief skill writes them: a value the user or their documents confirmed is `settled`, a value
nobody confirmed is `unresolved`. Everything after those rows is a judgment call in the
ordinary sense, and the rest of this file governs it.
