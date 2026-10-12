# Draft Outline format

The **Draft Outline** is the plan between the Approved Claims and the Draft
Application: one table row per **Outline Item**, in draft order. The
validators read it in code. Write it exactly as shown.

The outline holds references only, never technical text. A source is a
Feature List row, a disclosure span, a figure or an answered Inventor
Question of this matter. Web research, published patents and exemplars are
never a source.

## File

```markdown
---
office: US
claims: <SHA-256 of the Approved Claims>
---
# Draft Outline

| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |
|------|---------|------|--------|-------------|---------|---------|----------|
```

- `office` is `US` or `EPO`, as in `feature-list.md`.
- `claims` is the SHA-256 of the Approved Claims the plan was made from. The
  `draft-outline` save writes it; do not compute it. The save refuses while
  `approved` in `claims.md` is not true.
- Write the header row with these eight columns, in this order.
- Write a `|` inside a cell as `\|`.

## Columns

| Column | Content | Example |
|--------|---------|---------|
| `Item` | `O1`, `O2`, ... in draft order. Each id once. | `O4` |
| `Section` | The heading of the office order: [US](us-section-order.md) or [EPO](epo-section-order.md). | `DETAILED DESCRIPTION` |
| `Kind` | `Template` for standard section text, `Technical` for a concept of the claims. | `Technical` |
| `Claims` | The claim numbers the item realises, comma-separated. List a dependent claim with the independent claim it depends on. A Template item may list claims (for example the summary). | `1, 3` |
| `Claim terms` | The claim terms the item explains, as the claims introduce them, comma-separated. Empty for a Template item. | `a sealing ring, an elastomer` |
| `Sources` | Comma-separated, in the forms below. Empty only when `Question` is filled. | `F3, §2.1, FIG. 2` |
| `Explain` | `yes` when the item needs a mechanism, parameter or example; `no` for a statement. | `yes` |
| `Question` | The open question of a Technical item that has no source, or no source for the part `Explain` asks for. Empty otherwise. | `What force does the spring apply to the piston 14?` |

## Source forms

| Form | Names | Exists when |
|------|-------|-------------|
| `F3` | A row of `feature-list.md` | The Feature List has row `F3` |
| `§2.1` | A span of the disclosure (section, page or paragraph as the disclosure numbers it) | Not checked in code: check it yourself |
| `FIG. 2` (also `Fig. 2`, `FIG. 2a`) | A figure of `figures.md` | `figures.md` has a heading for that figure |
| `IQ-4` | An answered Inventor Question | `inventor-answers.md` has an answer to `IQ-4` |

## Rules the validators read

1. A Template item has no claim terms.
2. A Technical item has at least one source or a question, never neither.
3. A source names a row, span, figure or answered question that exists.

The plan also covers the claims:

- Every claim term of every claim is in the `Claim terms` of a Technical
  item.
- Every dependent claim is in the `Claims` of a Technical item together with
  the independent claim it depends on (directly or through other dependent
  claims). That item plans the combination.

## How to plan

1. Write the Template items of the office order in that order: one row per
   section the draft has before the detailed description, for example the
   title, the background, the summary and the brief description of the
   drawings, then the opening of the detailed description.
2. Put the Technical items in their place, usually in the detailed
   description: one row per claim concept. A concept is an element with its
   embodiments, or a feature a dependent claim adds.
3. For each Technical item, name every source that states it. When the
   claim needs a mechanism, parameter or example and no source states it,
   write the `Question`.
4. Write the Template items after the detailed description last, for example
   the closing paragraph on equivalents and the abstract. The claims are not
   an item: the draft takes the Approved Claims unchanged.

An item can have sources and a question: draft what the sources state, and
write an Inventor Question for the rest. When the answer to a question is
filled in `inventor-answers.md`, add its `IQ-n` to `Sources`, clear the
`Question`, and save the outline again.

## Example

Claims: 1. A valve comprising a housing, a piston and a sealing ring.
2. The valve of claim 1, wherein the sealing ring is made of an elastomer.
3. The valve of claim 1, further comprising a spring.

| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |
|------|---------|------|--------|-------------|---------|---------|----------|
| O1 | BACKGROUND | Template |  |  | §1 | no |  |
| O2 | BRIEF DESCRIPTION OF THE DRAWINGS | Template |  |  | FIG. 1, FIG. 2 | no |  |
| O3 | DETAILED DESCRIPTION | Technical | 1 | a valve, a housing, a piston | F1, F2, FIG. 1 | yes |  |
| O4 | DETAILED DESCRIPTION | Technical | 1, 2 | a sealing ring, an elastomer | F3, §2.1, FIG. 2 | yes |  |
| O5 | DETAILED DESCRIPTION | Technical | 1, 3 | a spring |  | yes | Where does the spring sit, and what force does it apply to the piston 14? |

The title, summary and abstract rows are left out of this example. `O5`
yields an Inventor Question in the draft and no technical text.

## Outline findings

The `draft-outline` save and `validate_draft` report these rules. Each
finding names a line of `draft-outline.md` or `draft-application.md`.

| Rule | Severity | Means | What to do |
|------|----------|-------|------------|
| `outline-format` | Error | A line cannot be read: no `office`, no table with the eight columns, a row with the wrong number of cells, an id that is not `O<n>`, an id listed twice, a `Kind` other than `Template` or `Technical`, `Claims` that are not numbers, `Explain` other than `yes` or `no`, or a source in no known form. | Correct the line. |
| `outline-claims` | Error | The outline names no claims hash, or was made from other claims than the Approved Claims. | Plan again from the current Approved Claims and save the outline. |
| `outline-coverage` | Error | A claim term is in no Technical item, or a dependent claim is in no Technical item with its independent claim. | Add the term to the item that explains it, or list the claims together in the item that realises the combination. Add an item when none fits. |
| `outline-sources` | Error | A Template item has claim terms, a Technical item has neither source nor question, or a source does not exist in the matter files. | Move the terms to a Technical item; name a source or write the question; correct or remove the source. Never take a source from outside the matter. |
| `item-coverage` | Error | A Technical item with a source is in no paragraph (`item:O<n>`), or a paragraph names an item that is not a row. | Write the paragraph of the item, or correct the `item:` entry. |
| `item-coverage` | Note | A Template item is in no paragraph, or an item with only a question is in no paragraph. | Write the Template text, or make sure the draft has the Inventor Question. |
| `duplicate-sentence` | Note | One sentence is in two paragraphs. | Keep it in one place; see [integration-review.md](integration-review.md). |
