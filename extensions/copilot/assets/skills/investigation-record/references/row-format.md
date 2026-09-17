# The decision row

Tab-separated, one row per judgment call, append only. Header:

```
when	call	why	evidence	status
```

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

The second row is what an unresolved call looks like: a real choice, made anyway, with the reason it might be wrong. The third is a number a tool returned that did not survive a second look, which is the case a provenance appendix cannot catch, because the number did come from a tool.

## What not to log

Retrievals that found what they were looking for. Tool calls that succeeded. Formatting choices. The order sections were written in. A row that no reader would ever act on is noise, and noise is what makes a trail go unread.
